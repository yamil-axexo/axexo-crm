import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { ACTION_TYPES, OPS, SOURCES, TEMPLATES, DEFAULTS, problemIn, type Action, type Condition, type Definition } from '@/domain/automation/catalog'
import { ensureDefaults, explain, insertDefinition, type Automation } from '@/domain/automation/engine'
import { findJob, runJob, type RunOutcome } from '@/server/jobs/runner'

// AUT-03: crear, cambiar, pausar y probar automatizaciones. Lo hace administración, con formularios; cada cambio sube
// la versión y queda en la bitácora con el antes y el después. Una automatización es de un mercado: no se puede mover a otro.

const condition = z.object({ field: z.string().max(40), op: z.enum(OPS), value: z.union([z.string().max(60), z.number()]).nullable().optional() })
const action = z.object({ type: z.enum(ACTION_TYPES) }).passthrough()
const input = z.object({
  nameEs: z.string().trim().min(3).max(120),
  nameEn: z.string().trim().min(3).max(120),
  motor: z.string().trim().max(20).optional().default(''),
  ownerId: z.guid().or(z.literal('')).optional(),
  conditions: z.array(condition).max(6),
  actions: z.array(action).min(1).max(3),
})
export type AutomationInput = z.input<typeof input>

/** Las plantillas disponibles: las reglas de base (por si un mercado quiere una segunda variante) y las de ejemplo. */
export const allTemplates = (): Definition[] => [...TEMPLATES, ...DEFAULTS]

async function checkDefinition(tx: Parameters<Parameters<typeof withUser>[1]>[0], market: string, def: { source: string; trigger: Definition['trigger']; conditions: Condition[]; actions: Action[] }): Promise<void> {
  const codes = await tx<{ code: string }[]>`select distinct s.code from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where p.market_code = ${market} and s.archived_at is null`
  const problem = problemIn(def, codes.map((c) => c.code))
  if (problem) throw invalid(problem.es, problem.en)
  for (const a of def.actions) {
    if (a.type === 'create_task' || a.type === 'notify') assertNoProhibited(a.text_es, a.text_en)
    if ((a.type === 'create_task' || a.type === 'notify' || a.type === 'assign') && a.to.startsWith('user:')) {
      const ok = await tx<{ ok: boolean }[]>`select app.works_in(${a.to.slice(5)}, ${market}) as ok`
      if (!ok[0]?.ok) throw invalid('La persona elegida tiene que trabajar en el mercado de la automatización.', 'The chosen person must work in the automation’s market.')
    }
  }
}

/** Crea una automatización a partir de una plantilla, en un mercado. Nace en pausa: se revisa, se prueba y se activa. */
export async function createFromTemplate(ctx: Ctx, market: string, templateKey: string): Promise<string> {
  ctx.assert('automation.manage')
  ctx.market(market)
  const tpl = allTemplates().find((t) => t.key === templateKey)
  if (!tpl) throw invalid('Elige una plantilla de la lista.', 'Pick a template from the list.')
  return withUser(ctx.user.id, async (tx) => {
    await ensureDefaults(tx)
    await checkDefinition(tx, market, tpl)
    const taken = await tx<{ key: string }[]>`select key from crm.automations where market_code = ${market} and key like ${tpl.key + '%'}`
    let key = tpl.key
    for (let i = 2; taken.some((t) => t.key === key); i++) key = `${tpl.key}_${i}`.slice(0, 60)
    await insertDefinition(tx, market, tpl, ctx.user.id, false, key)
    const row = await tx<{ id: string }[]>`select id from crm.automations where market_code = ${market} and key = ${key}`
    const id = row[0]!.id
    await audit(tx, ctx, 'automation.created', 'automation', id, market, null, { key, template: tpl.key, name: tpl.name.es, active: false })
    return id
  })
}

const COLS = 'id, market_code, motor, key, name_es, name_en, source, trigger_kind, trigger_event, conditions, actions, is_active, version'

/** Cambia nombre, tipo de venta, dueño, condiciones y acciones. El mercado, el tipo de registro y el disparador no cambian: para eso se crea otra. */
export async function saveAutomation(ctx: Ctx, id: string, raw: AutomationInput): Promise<void> {
  ctx.assert('automation.manage')
  const parsed = input.safeParse(raw)
  if (!parsed.success) throw invalid('Revisa el nombre en los dos idiomas (3 a 120 letras), las condiciones y las acciones.', 'Check the name in both languages (3 to 120 characters), the conditions and the actions.')
  const v = parsed.data
  assertNoProhibited(v.nameEs, v.nameEn)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(Automation & { owner_id: string | null })[]>`select ${tx.unsafe(COLS)}, owner_id from crm.automations where id = ${id} for update`
    const a = rows[0]
    if (!a) throw notFound('No encontramos esa automatización.', 'We could not find that automation.')
    const def = {
      source: a.source,
      trigger: a.trigger_kind === 'event' ? ({ kind: 'event', event: a.trigger_event! } as const) : ({ kind: 'schedule' } as const),
      conditions: v.conditions.map((c) => ({ field: c.field, op: c.op, ...(c.value === null || c.value === undefined || c.value === '' ? {} : { value: c.value }) })) as Condition[],
      actions: v.actions as unknown as Action[],
    }
    await checkDefinition(tx, a.market_code, def)
    if (v.motor) {
      const ok = await tx`select 1 from crm.pipelines where market_code = ${a.market_code} and motor = ${v.motor}`
      if (!ok[0]) throw invalid('Ese tipo de venta no tiene embudo en este mercado.', 'That sales type has no pipeline in this market.')
    }
    if (v.ownerId) {
      const ok = await tx<{ ok: boolean }[]>`select app.works_in(${v.ownerId}, ${a.market_code}) as ok`
      if (!ok[0]?.ok) throw invalid('Quien responde por la automatización tiene que trabajar en ese mercado.', 'The automation’s owner must work in that market.')
    }
    await tx`update crm.automations set name_es = ${v.nameEs}, name_en = ${v.nameEn}, motor = ${v.motor || null}, owner_id = ${v.ownerId || null},
              conditions = ${tx.json(def.conditions as never)}, actions = ${tx.json(def.actions as never)}, version = version + 1, updated_by = ${ctx.user.id}, updated_at = now()
              where id = ${id}`
    // Con otras condiciones, lo que ya había hecho deja de contar: cada registro se vuelve a evaluar con la versión nueva.
    await tx`delete from crm.automation_state where automation_id = ${id}`
    await audit(tx, ctx, 'automation.updated', 'automation', id, a.market_code,
      { name: a.name_es, motor: a.motor, owner_id: a.owner_id, conditions: a.conditions, actions: a.actions, version: a.version },
      { name: v.nameEs, motor: v.motor || null, owner_id: v.ownerId || null, conditions: def.conditions, actions: def.actions, version: a.version + 1 })
  })
}

export async function setAutomationActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  ctx.assert('automation.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; is_active: boolean; name_es: string }[]>`select market_code, is_active, name_es from crm.automations where id = ${id} for update`
    const a = rows[0]
    if (!a) throw notFound('No encontramos esa automatización.', 'We could not find that automation.')
    if (a.is_active === active) return
    await tx`update crm.automations set is_active = ${active}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, active ? 'automation.resumed' : 'automation.paused', 'automation', id, a.market_code, { active: a.is_active }, { active, name: a.name_es })
  })
}

export type TestResult = {
  found: boolean
  label: string | null
  inScope: boolean
  checks: boolean[]
  /** Con todas las condiciones cumplidas: haría sus acciones. */
  wouldAct: boolean
  /** Ya actuó sobre este registro y la condición no ha cambiado: no repetiría. */
  alreadyDone: boolean
}

/** "Qué haría": evalúa una automatización contra UN registro sin cambiar nada. Sirve antes de activarla y para entender una bitácora. */
export async function testAutomation(ctx: Ctx, id: string, recordId: string): Promise<TestResult> {
  ctx.assert('automation.read')
  if (!z.guid().safeParse(recordId).success) throw invalid('Pega el identificador del registro: es la última parte de la dirección de su ficha.', 'Paste the record identifier: it is the last part of its page address.')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Automation[]>`select ${tx.unsafe(COLS)} from crm.automations where id = ${id}`
    const a = rows[0]
    if (!a) throw notFound('No encontramos esa automatización.', 'We could not find that automation.')
    const x = await explain(tx, a, recordId)
    if (!x.rec) return { found: false, label: null, inScope: false, checks: [], wouldAct: false, alreadyDone: false }
    const state = await tx`select 1 from crm.automation_state where automation_id = ${id} and record_id = ${recordId}`
    return { found: true, label: x.rec.label, inScope: x.inScope, checks: x.checks, wouldAct: x.inScope && x.checks.every(Boolean), alreadyDone: state.length > 0 }
  })
}

/** "Correr ahora": corre una tarea programada sin esperar su turno. Queda en las corridas y en la bitácora, a nombre de quien la corrió. */
export async function runJobNow(ctx: Ctx, key: string): Promise<RunOutcome> {
  ctx.assert('job.run')
  const job = findJob(key)
  if (!job) throw notFound('Esa tarea programada no existe.', 'That scheduled job does not exist.')
  const out = await runJob(job, 'manual', { force: true, actorId: ctx.user.id })
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'job.run_manual', 'job', null, null, null, { job: key, status: out.status, done: out.done ?? 0 }))
  return out
}

export { SOURCES }
