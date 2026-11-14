import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit } from '@/domain/common'
import { invalid, notFound, DomainError } from '@/lib/errors'
import { isMetricKey } from '@/lib/metric-defs'

// ================================================================== REP-03: categoría de pronóstico y envíos versionados
export const FORECAST_CATEGORIES = ['commit', 'best_case', 'pipeline', 'omitted'] as const
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number]
export const FORECAST_LABEL: Record<ForecastCategory, [string, string]> = {
  commit: ['Comprometido', 'Commit'], best_case: ['Mejor caso', 'Best case'], pipeline: ['En proceso', 'Pipeline'], omitted: ['Fuera', 'Omitted'],
}
const category = z.enum(FORECAST_CATEGORIES)

async function dealForForecast(tx: Tx, ctx: Ctx, dealId: string) {
  const rows = await tx<{ id: string; market_code: string; owner_id: string | null; status: string; kind: string }[]>`
    select d.id, d.market_code, d.owner_id, d.status, a.kind from crm.deals d join crm.accounts a on a.id = d.account_id where d.id = ${dealId}`
  const d = rows[0]
  if (!d) throw notFound()
  if (d.status !== 'open') throw invalid('Solo un negocio abierto lleva categoría de pronóstico.', 'Only an open deal carries a forecast category.')
  return d
}

/** La categoría la pone quien lleva la cuenta clave (KAM) o quien dirige. Ventas de calle no envía pronóstico (el catálogo lo descarta). */
export async function setForecastCategory(ctx: Ctx, dealId: string, value: string): Promise<void> {
  const cat = category.safeParse(value)
  if (!cat.success) throw invalid('Elige una categoría.', 'Choose a category.')
  await withUser(ctx.user.id, async (tx) => {
    const d = await dealForForecast(tx, ctx, dealId)
    ctx.assert('forecast.categorize', d.market_code)
    const manages = ctx.can('forecast.adjust', d.market_code)
    if (!manages && d.owner_id !== ctx.user.id) throw new DomainError('forbidden', 'Solo quien lleva el negocio pone su categoría.', 'Only the deal owner sets its category.', 403)
    const before = await tx<{ category: string }[]>`select category from crm.deal_forecast where deal_id = ${dealId}`
    await tx`insert into crm.deal_forecast (deal_id, market_code, category, set_by) values (${dealId}, ${d.market_code}, ${cat.data}, ${ctx.user.id})
             on conflict (deal_id) do update set category = excluded.category, set_by = excluded.set_by, set_at = now()`
    await audit(tx, ctx, 'deal.forecast_set', 'deal', dealId, d.market_code, before[0] ? { category: before[0].category } : null, { category: cat.data })
  })
}

/** Quien dirige ajusta la categoría al lado de la de quien lleva la cuenta, con nota. No la borra: las dos quedan. */
export async function adjustForecast(ctx: Ctx, dealId: string, value: string, note: string): Promise<void> {
  const cat = category.safeParse(value)
  const n = (note ?? '').trim()
  if (!cat.success) throw invalid('Elige una categoría.', 'Choose a category.')
  if (n.length < 3) throw invalid('Escribe por qué ajustas la categoría.', 'Write why you are adjusting the category.')
  await withUser(ctx.user.id, async (tx) => {
    const d = await dealForForecast(tx, ctx, dealId)
    ctx.assert('forecast.adjust', d.market_code)
    const cur = await tx<{ category: string; manager_category: string | null }[]>`select category, manager_category from crm.deal_forecast where deal_id = ${dealId}`
    if (!cur[0]) throw invalid('Quien lleva el negocio todavía no le puso categoría.', 'The deal owner has not set a category yet.')
    await tx`update crm.deal_forecast set manager_category = ${cat.data}, manager_note = ${n.slice(0, 300)}, adjusted_by = ${ctx.user.id}, adjusted_at = now() where deal_id = ${dealId}`
    await audit(tx, ctx, 'deal.forecast_adjusted', 'deal', dealId, d.market_code, { manager_category: cur[0].manager_category }, { manager_category: cat.data, owner_category: cur[0].category })
  })
}

export type SubmissionRow = { deal_id: string; title: string; account: string; amount_minor: number | null; currency: string; category: string; owner_category: string | null; owner_id: string | null; owner_name: string | null; territory: string | null }

/**
 * Envía el pronóstico del periodo: guarda POR VALOR cada negocio con su categoría, quién lo lleva y su territorio. Reorganizar
 * territorios o pasar cuentas después no cambia lo enviado. Cada envío del mismo periodo es una versión nueva (no se sobrescribe).
 */
export async function submitForecast(ctx: Ctx, input: { market: string; from: string; to: string; note?: string }): Promise<{ id: string; version: number; rows: number }> {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!iso.test(input.from) || !iso.test(input.to) || input.to < input.from) throw invalid('Revisa las fechas del periodo.', 'Check the period dates.')
  ctx.assert('forecast.submit', input.market)
  const note = (input.note ?? '').trim()
  return withUser(ctx.user.id, async (tx) => {
    // KAM: sus negocios. Quien supervisa o lidera: los negocios con categoría de las personas que ve en su alcance de mercado.
    const kamOnly = !ctx.can('forecast.adjust', input.market)
    const rows = await tx<SubmissionRow[]>`
      select d.id as deal_id, d.title, a.name as account, d.amount_minor::float8 as amount_minor, trim(d.currency) as currency,
             coalesce(f.manager_category, f.category) as category, f.category as owner_category, d.owner_id, u.full_name as owner_name,
             t.name as territory
        from crm.deals d join crm.accounts a on a.id = d.account_id
        join crm.deal_forecast f on f.deal_id = d.id
        left join crm.users u on u.id = d.owner_id
        left join crm.territories t on t.id = a.territory_id
       where d.status = 'open' and d.market_code = ${input.market}
         and ${kamOnly ? tx`d.owner_id = ${ctx.user.id}` : tx`(d.owner_id = any(app.supervised_user_ids()) or ${input.market} = any(app.full_markets()))`}
       order by d.title`
    if (!rows.length) throw invalid('No hay negocios abiertos con categoría para enviar.', 'There are no open deals with a category to submit.')
    const totals: Record<string, { n: number; amount_minor: number }> = {}
    for (const r of rows) {
      const k = `${r.category}:${r.currency}`
      totals[k] = { n: (totals[k]?.n ?? 0) + 1, amount_minor: (totals[k]?.amount_minor ?? 0) + (r.amount_minor ?? 0) }
    }
    const team = await tx<{ id: string; name: string }[]>`
      select t.id, t.name from crm.memberships m join crm.teams t on t.id = m.team_id
       where m.user_id = ${ctx.user.id} and m.market_code = ${input.market} and (m.valid_to is null or m.valid_to > now()) limit 1`
    const v = await tx<{ v: number }[]>`select coalesce(max(version), 0)::int + 1 as v from crm.forecast_submissions
      where submitted_by = ${ctx.user.id} and market_code = ${input.market} and period_from = ${input.from}`
    const ins = await tx<{ id: string }[]>`
      insert into crm.forecast_submissions (market_code, submitted_by, submitter_name, team_id, team_name, period_from, period_to, version, totals, rows, note)
      values (${input.market}, ${ctx.user.id}, ${ctx.user.name}, ${team[0]?.id ?? null}, ${team[0]?.name ?? null}, ${input.from}, ${input.to}, ${v[0]!.v},
              ${tx.json(totals as never)}, ${tx.json(rows as never)}, ${note.length >= 3 ? note.slice(0, 500) : null})
      returning id`
    await audit(tx, ctx, 'forecast.submitted', 'forecast_submission', ins[0]!.id, input.market, null, { version: v[0]!.v, rows: rows.length, from: input.from, to: input.to })
    return { id: ins[0]!.id, version: v[0]!.v, rows: rows.length }
  })
}

// ================================================================== REP-01: tableros por rol (Administración)
const BOARD_ROLES = ['kam', 'partner', 'ops', 'finance'] as const
/** Cambia la lista de un rol (de 5 a 7 cifras, en orden), su dueño y si C1 la confirmó. Todo queda en la bitácora. */
export async function saveRoleBoard(ctx: Ctx, input: { role: string; keys: string[]; owners?: Record<string, string>; confirm: boolean }): Promise<void> {
  ctx.assert('metric.owner')
  const role = z.enum(BOARD_ROLES).safeParse(input.role)
  if (!role.success) throw invalid('Ese rol no tiene tablero.', 'That role has no board.')
  const keys = [...new Set(input.keys.map((k) => k.trim()).filter(Boolean))]
  if (keys.length < 5 || keys.length > 7) throw invalid('Un tablero lleva de 5 a 7 indicadores.', 'A board carries 5 to 7 indicators.')
  if (keys.some((k) => !isMetricKey(k))) throw invalid('Hay un indicador sin definición.', 'There is an indicator with no definition.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ metric_key: string }[]>`select metric_key from crm.role_boards where role = ${role.data} order by position`
    await tx`delete from crm.role_boards where role = ${role.data}`
    for (const [i, k] of keys.entries()) {
      const owner = (input.owners?.[k] ?? '').trim()
      await tx`insert into crm.role_boards (role, position, metric_key, owner_label, confirmed, updated_by)
               values (${role.data}, ${i + 1}, ${k}, ${owner.length >= 2 ? owner.slice(0, 80) : null}, ${input.confirm}, ${ctx.user.id})`
    }
    await audit(tx, ctx, input.confirm ? 'metric.board_confirmed' : 'metric.board_updated', 'role_board', null, null,
      { role: role.data, keys: before.map((b) => b.metric_key) }, { role: role.data, keys, confirmed: input.confirm })
  })
}

// ================================================================== Valores propuestos (configurables desde Administración)
/** Los valores que dependen de otra persona: guardados como dato, con su dueño pendiente. Aquí está qué forma tiene cada uno. */
export const PROPOSED_SETTINGS = {
  'ingest.require_manifest': z.object({ value: z.boolean() }),
  'snapshots.window_days': z.object({ value: z.number().int().min(30).max(3650) }),
  'quality.exception_rules': z.object({ value: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(20), min_failing: z.number().int().min(1).max(1000) }),
  'adoption.rollout_rule': z.object({ supervisor_weeks: z.number().int().min(1).max(8), one_on_ones_min: z.number().int().min(0).max(20), result: z.enum(['active_30d', 'visits_per_enrollment']) }),
  'orders.brand': z.record(z.string(), z.unknown()),
} as const
export type ProposedKey = keyof typeof PROPOSED_SETTINGS
export const PROPOSED_OWNER: Record<ProposedKey, string> = {
  'ingest.require_manifest': 'Roxanna Quintero (Data y Reportería)', 'snapshots.window_days': 'Roxanna Quintero (Data y Reportería)', 'quality.exception_rules': 'C1 (Yamil Alvarez)',
  'adoption.rollout_rule': 'Yamil Alvarez y quienes lideran los mercados', 'orders.brand': 'Marketing',
}

export async function readProposed<K extends ProposedKey>(tx: Tx, key: K): Promise<(z.infer<(typeof PROPOSED_SETTINGS)[K]> & { proposed?: boolean; pending?: string }) | null> {
  const rows = await tx<{ value: Record<string, unknown> }[]>`select value from crm.settings where key = ${key}`
  return (rows[0]?.value as never) ?? null
}

/** Quien decide (o administración a su nombre) fija el valor: deja de ser propuesta. Volver a la propuesta es fijar el valor de antes. */
export async function setProposed(ctx: Ctx, key: string, value: Record<string, unknown>, confirm: boolean): Promise<void> {
  ctx.assert('config.manage')
  if (!(key in PROPOSED_SETTINGS)) throw invalid('Ese ajuste no existe.', 'That setting does not exist.')
  const k = key as ProposedKey
  const parsed = PROPOSED_SETTINGS[k].safeParse(value)
  if (!parsed.success) throw invalid('Revisa el valor.', 'Check the value.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await readProposed(tx, k)
    // La plantilla del pedido es por mercado: guardar un mercado no borra los demás.
    const base = k === 'orders.brand' && before ? Object.fromEntries(Object.entries(before).filter(([x]) => x.length === 2)) : {}
    const next = { ...base, ...(parsed.data as Record<string, unknown>), proposed: !confirm, pending: PROPOSED_OWNER[k] }
    await tx`insert into crm.settings (key, value) values (${k}, ${tx.json(next as never)}) on conflict (key) do update set value = excluded.value`
    await audit(tx, ctx, 'threshold.proposed_value_set', 'setting', null, null, before as Record<string, unknown> | null, { key: k, ...next })
  })
}

// ================================================================== GOB-03: 1:1 con el tablero y eventos de uso en el outbox
export async function recordOneOnOne(ctx: Ctx, input: { personId: string; heldOn: string; note?: string }): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.heldOn)) throw invalid('Revisa la fecha.', 'Check the date.')
  const note = (input.note ?? '').trim()
  await withUser(ctx.user.id, async (tx) => {
    const person = await tx<{ market_code: string }[]>`
      select m.market_code from crm.memberships m where m.user_id = ${input.personId} and m.market_code is not null
         and (m.valid_to is null or m.valid_to > now()) and ${input.personId} = any(app.supervised_user_ids()) limit 1`
    if (!person[0] || input.personId === ctx.user.id) throw invalid('Esa persona no es de tu equipo.', 'That person is not on your team.')
    ctx.assert('one_on_one.record', person[0].market_code)
    const ok = await tx<{ ok: boolean }[]>`select ${input.heldOn}::date <= (now() at time zone mk.timezone)::date and ${input.heldOn}::date > (now() at time zone mk.timezone)::date - 31 as ok
      from crm.markets mk where mk.code = ${person[0].market_code}`
    if (!ok[0]?.ok) throw invalid('La fecha tiene que ser de los últimos 30 días.', 'The date has to be within the last 30 days.')
    const ins = await tx<{ id: string }[]>`insert into crm.one_on_ones (market_code, supervisor_id, person_id, held_on, note)
      values (${person[0].market_code}, ${ctx.user.id}, ${input.personId}, ${input.heldOn}, ${note.length >= 3 ? note.slice(0, 300) : null})
      on conflict (supervisor_id, person_id, held_on) do nothing returning id`
    if (!ins[0]) return
    await audit(tx, ctx, 'usage.one_on_one_recorded', 'user', input.personId, person[0].market_code, null, { held_on: input.heldOn })
    await emit(tx, 'usage.one_on_one', 'user', ctx.user.id, person[0].market_code, { person_id: input.personId, held_on: input.heldOn })
  })
}

/** Uso que cuenta para la adopción (no los ingresos): sale por el outbox, como cualquier evento de dominio. */
export async function emitUsage(tx: Tx, ctx: Ctx, type: 'usage.board_opened' | 'usage.queue_item_done', market: string | null, data: Record<string, unknown>): Promise<void> {
  if (ctx.user.isSystem || ctx.viewAs) return
  if (type === 'usage.board_opened') {
    const recent = await tx`select 1 from crm.outbox_events where event_type = 'usage.board_opened' and aggregate_id = ${ctx.user.id} and created_at > now() - interval '1 hour' limit 1`
    if (recent[0]) return
  }
  await emit(tx, type, 'user', ctx.user.id, market, data)
}

// ================================================================== E8.F7: identidad de la persona en S5
export async function setUserAlias(ctx: Ctx, input: { userId: string; system: string; externalId: string }): Promise<void> {
  ctx.assert('user_alias.manage')
  const system = z.enum(['s5', 'sales_app']).safeParse(input.system)
  const ext = (input.externalId ?? '').trim()
  if (!system.success || ext.length < 1 || ext.length > 80) throw invalid('Revisa el sistema y el ID.', 'Check the system and the ID.')
  await withUser(ctx.user.id, async (tx) => {
    const taken = await tx`select 1 from crm.user_aliases where system = ${system.data} and external_id = ${ext} and valid_to is null and user_id <> ${input.userId}`
    if (taken[0]) throw invalid('Ese ID ya es de otra persona.', 'That ID already belongs to someone else.')
    const prev = await tx<{ external_id: string }[]>`update crm.user_aliases set valid_to = now() where user_id = ${input.userId} and system = ${system.data} and valid_to is null returning external_id`
    await tx`insert into crm.user_aliases (user_id, system, external_id, created_by) values (${input.userId}, ${system.data}, ${ext}, ${ctx.user.id})`
    await audit(tx, ctx, 'user.alias_set', 'user', input.userId, null, prev[0] ? { external_id: prev[0].external_id } : null, { system: system.data, external_id: ext })
  })
}
