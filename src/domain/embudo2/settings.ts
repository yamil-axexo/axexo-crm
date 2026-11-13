import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * Valores del embudo que decide el negocio, no quien construye (crm.funnel_settings). Cada uno nace como "valor propuesto"
 * con su dueño pendiente; administración lo cambia o lo confirma, y queda en la bitácora. Se leen por mercado: el valor del
 * mercado gana sobre el general.
 */
type Pair = { es: string; en: string }
export type SettingDef = { key: string; label: Pair; help: Pair; kind: 'int' | 'choice' | 'bool' | 'int_or_null'; min?: number; max?: number; options?: { value: string; label: Pair }[] }

export const FUNNEL_SETTINGS: SettingDef[] = [
  { key: 'next_step_max_days', kind: 'int', min: 7, max: 366,
    label: { es: 'Días máximos para la fecha del próximo paso', en: 'Maximum days ahead for the next step date' },
    help: { es: 'Una fecha más lejana no se acepta: así nadie calla la alerta con fechas a meses.', en: 'A later date is not accepted, so nobody silences the alert with dates months away.' } },
  { key: 'reason_core_max', kind: 'int', min: 3, max: 30,
    label: { es: 'Motivos de base por tipo (pérdida o no venta)', en: 'Base reasons per type (loss or no sale)' },
    help: { es: 'Tope de motivos activos para todos los mercados.', en: 'Cap of active reasons for all markets.' } },
  { key: 'reason_max_extensions', kind: 'int', min: 0, max: 10,
    label: { es: 'Motivos propios de un mercado, por tipo', en: 'Market-specific reasons, per type' },
    help: { es: 'Cuántos motivos puede agregar cada mercado además de los de base.', en: 'How many reasons each market can add on top of the base ones.' } },
  { key: 'lead_sla_clock', kind: 'choice',
    label: { es: 'El reloj de primer contacto se cierra con', en: 'The first contact clock stops with' },
    help: { es: 'Contacto efectivo: alguien respondió. Primer intento: se registró una llamada o mensaje, aunque nadie contestara.', en: 'Effective contact: someone answered. First attempt: a call or message was logged, even if nobody answered.' },
    options: [{ value: 'contact', label: { es: 'el contacto efectivo', en: 'the effective contact' } }, { value: 'attempt', label: { es: 'el primer intento', en: 'the first attempt' } }] },
  { key: 'lead_sla_baseline_weeks', kind: 'int', min: 1, max: 26,
    label: { es: 'Semanas de línea base antes de fijar la meta', en: 'Baseline weeks before setting the goal' },
    help: { es: 'La meta de primer contacto se fija con la medición propia de estas semanas, no con cifras de afuera.', en: 'The first contact goal is set with our own measurement over these weeks, not outside figures.' } },
  { key: 'activity_retention_months', kind: 'int_or_null', min: 12, max: 240,
    label: { es: 'Meses que se guardan las actividades terminadas', en: 'Months finished activities are kept' },
    help: { es: 'Vacío: se guardan todas. Con un número, la tarea programada borra las terminadas más viejas que eso.', en: 'Empty: all are kept. With a number, the scheduled job removes finished ones older than that.' } },
  { key: 'rot_respects_next_step', kind: 'bool',
    label: { es: 'Un próximo paso con fecha por venir detiene el aviso de estancado', en: 'An upcoming dated next step holds off the stalled notice' },
    help: { es: 'El tope de días del próximo paso evita que esto se use para callar el aviso.', en: 'The next step day cap keeps this from being used to silence the notice.' } },
  { key: 'visit_purposes_confirmed', kind: 'bool',
    label: { es: 'Lista de propósitos de visita confirmada por ventas', en: 'Visit purpose list confirmed by sales' },
    help: { es: 'Mientras no se confirme, la lista se muestra como propuesta.', en: 'Until confirmed, the list is shown as a proposal.' } },
]

export type SettingRow = { id: string; market_code: string | null; key: string; value: unknown; proposed: boolean; pending_owner: string | null; updated_at: Date }

/** El valor vigente de un mercado (o el general). */
export async function funnelSetting<T = unknown>(tx: Tx, market: string | null, key: string): Promise<T | null> {
  const r = await tx<{ v: unknown }[]>`select app.funnel_setting(${market}, ${key}) as v`
  return (r[0]?.v ?? null) as T | null
}

export async function listFunnelSettings(ctx: Ctx): Promise<SettingRow[]> {
  return withUser(ctx.user.id, (tx) => tx<SettingRow[]>`
    select id, market_code, key, value, proposed, pending_owner, updated_at from crm.funnel_settings order by key, market_code nulls first`).then((r) => [...r])
}

/** Cambiar (o confirmar) un valor. Confirmarlo sin cambiarlo también quita la marca de "propuesto". */
export async function saveFunnelSetting(ctx: Ctx, input: { key: string; market: string | null; value: string; confirm: boolean }): Promise<void> {
  ctx.assert('config.manage')
  const def = FUNNEL_SETTINGS.find((d) => d.key === input.key)
  if (!def) throw notFound()
  let value: unknown
  const raw = input.value.trim()
  if (def.kind === 'bool') value = raw === 'true'
  else if (def.kind === 'choice') {
    if (!def.options!.some((o) => o.value === raw)) throw invalid('Elige un valor de la lista.', 'Pick a value from the list.')
    value = raw
  } else if (def.kind === 'int_or_null' && raw === '') value = null
  else {
    const n = z.coerce.number().int().min(def.min!).max(def.max!).safeParse(raw)
    if (!n.success) throw invalid(`Escribe un número entre ${def.min} y ${def.max}.`, `Enter a number between ${def.min} and ${def.max}.`)
    value = n.data
  }
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ value: unknown; proposed: boolean }[]>`
      select value, proposed from crm.funnel_settings where key = ${def.key} and market_code is not distinct from ${input.market} for update`
    if (before[0]) {
      await tx`update crm.funnel_settings set value = ${tx.json(value as never)}, proposed = ${before[0].proposed && !input.confirm && JSON.stringify(before[0].value) === JSON.stringify(value)},
                 updated_by = ${ctx.user.id}, updated_at = now() where key = ${def.key} and market_code is not distinct from ${input.market}`
    } else {
      await tx`insert into crm.funnel_settings (market_code, key, value, proposed, pending_owner, updated_by) values (${input.market}, ${def.key}, ${tx.json(value as never)}, false, null, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'funnel.setting_changed', 'funnel_setting', null, input.market, before[0] ? { key: def.key, value: before[0].value } : null, { key: def.key, value, confirmed: input.confirm })
  })
}

/** ACT-02: la fecha del próximo paso, dentro del tope del mercado. */
export async function assertNextStepWithinCap(tx: Tx, market: string, due: string): Promise<void> {
  const r = await tx<{ cap: number | null; ok: boolean }[]>`
    select (app.funnel_setting(${market}, 'next_step_max_days'))::text::int as cap,
           coalesce(${due}::date <= (now() at time zone (select timezone from crm.markets where code = ${market}))::date + (app.funnel_setting(${market}, 'next_step_max_days'))::text::int, true) as ok`
  if (r[0] && !r[0].ok) throw invalid(`La fecha del próximo paso puede ir hasta ${r[0].cap} días adelante. Si falta más, pon un paso intermedio.`, `The next step date can be up to ${r[0].cap} days ahead. If it is further out, set an intermediate step.`)
}
