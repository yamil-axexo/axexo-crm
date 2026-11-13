import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { recordStageGaps } from '@/domain/embudo/stage-conditions'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { scrub } from '@/domain/pipedrive/mapping'

// Paquete b2b (comité del 11-nov-2026): tipo de cuenta, pausa de un negocio y lo que administración configura desde la pantalla
// (tipos de cuenta, etapas, embudos, campos, motivos de pérdida y formularios). Cada cambio deja evento en la bitácora.

export const MOTORS = ['d2d', 'b2b', 'dealer', 'event', 'orders', 'other'] as const
export const LEVELS = ['store', 'chain', 'distributor', 'organization'] as const
export const FIELD_OBJECTS = ['account', 'deal', 'lead'] as const
export const FIELD_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'boolean'] as const

const label = z.string().trim().min(2).max(60)
const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)

/** Un código que no choca con los que ya existen: el nombre en minúsculas y, si hace falta, un número al final. */
async function freeCode(base: string, taken: (code: string) => Promise<boolean>): Promise<string> {
  const root = /^[a-z]/.test(base) && base.length >= 2 ? base : `x_${base}`.slice(0, 34)
  for (let i = 0; i < 50; i++) {
    const code = i === 0 ? root : `${root}_${i + 1}`
    if (!(await taken(code))) return code
  }
  throw invalid('Ya hay muchos con ese nombre: elige otro.', 'There are already many with that name: pick another.')
}

/**
 * Un campo nuevo nunca pide datos que CONTIGO no guarda (tarjetas, cuentas bancarias, CLABE, SSN, contraseñas, identificaciones completas).
 * `assertNoProhibited` frena los números; esto frena la etiqueta que los pediría.
 */
function assertAllowedLabel(...labels: string[]): void {
  assertNoProhibited(...labels)
  const bad = /clabe|ssn|seguro social|social security|tarjeta|card number|contrase|password|cuenta bancaria|bank account|n[uú]mero de cuenta|account number|curp|rfc completo|pasaporte|passport number/i
  if (labels.some((l) => bad.test(l))) {
    throw invalid(
      'Ese campo pediría un dato que CONTIGO no guarda (tarjetas, cuentas bancarias, contraseñas o identificaciones completas). Guarda solo el estado del documento.',
      'That field would ask for data CONTIGO does not store (cards, bank accounts, passwords or full IDs). Store only the status of the document.',
    )
  }
}

// ---------------------------------------------------------------- tipo de cuenta

/** Cambia el tipo de una cuenta. El nivel en el árbol sale del tipo; una cuenta con sub-cuentas no pasa a ser tienda. */
export async function setAccountType(ctx: Ctx, accountId: string, code: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; account_type: string; kind: string; archived_at: Date | null }[]>`
      select market_code, account_type, kind, archived_at from crm.accounts where id = ${accountId} for update`
    const a = rows[0]
    if (!a || a.archived_at) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('account.edit', a.market_code)
    if (code === a.account_type) return
    const types = await tx<{ kind: string }[]>`
      select kind from crm.account_types where code = ${code} and is_active and (market_code is null or market_code = ${a.market_code})
       order by market_code nulls last limit 1`
    const type = types[0]
    if (!type) throw invalid('Ese tipo de cuenta no existe en este mercado.', 'That account type does not exist in this market.')
    if (type.kind === 'store') {
      const kids = await tx`select 1 from crm.accounts where parent_id = ${accountId} and archived_at is null limit 1`
      if (kids[0]) throw invalid('Esta cuenta tiene otras cuentas debajo: muévelas antes de cambiarla a un tipo de tienda.', 'This account has other accounts under it: move them before changing it to a store type.')
    }
    await tx`update crm.accounts set account_type = ${code} where id = ${accountId}`
    await audit(tx, ctx, 'account.type_changed', 'account', accountId, a.market_code, { account_type: a.account_type, kind: a.kind }, { account_type: code, kind: type.kind })
  })
}

const typeInput = z.object({ market: z.string().length(2).or(z.literal('')), labelEs: label, labelEn: label, level: z.enum(LEVELS) })

/** Administración agrega un tipo de cuenta al catálogo de un mercado (o de todos). */
export async function createAccountType(ctx: Ctx, input: z.input<typeof typeInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = typeInput.safeParse(input)
  if (!parsed.success) throw invalid('El tipo lleva nombre en español y en inglés, y su nivel.', 'A type needs a name in Spanish and in English, and its level.')
  const v = parsed.data
  assertNoProhibited(v.labelEs, v.labelEn)
  return withUser(ctx.user.id, async (tx) => {
    const market = v.market || null
    if (market && !(await tx`select 1 from crm.markets where code = ${market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const clash = await tx`select 1 from crm.account_types where (market_code is null or ${market}::text is null or market_code = ${market})
      and (lower(label_es) = lower(${v.labelEs}) or lower(label_en) = lower(${v.labelEn}))`
    if (clash[0]) throw invalid('Ya hay un tipo de cuenta con ese nombre.', 'There is already an account type with that name.')
    const code = await freeCode(slug(v.labelEn), async (c) => !!(await tx`select 1 from crm.account_types where code = ${c}`)[0])
    await tx`insert into crm.account_types (market_code, code, label_es, label_en, kind, position)
             values (${market}, ${code}, ${v.labelEs}, ${v.labelEn}, ${v.level}, (select coalesce(max(position), 0) + 10 from crm.account_types))`
    await audit(tx, ctx, 'account_type.created', 'account_type', null, market, null, { code, label_es: v.labelEs, label_en: v.labelEn, level: v.level })
    return code
  })
}

/** Quitar un tipo del catálogo no cambia las cuentas que ya lo tienen: deja de ofrecerse para las nuevas. */
export async function setAccountTypeActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; market_code: string | null; is_active: boolean }[]>`select code, market_code, is_active from crm.account_types where id = ${id} for update`
    const t = rows[0]
    if (!t) throw notFound()
    if (t.is_active === active) return
    await tx`update crm.account_types set is_active = ${active} where id = ${id}`
    await audit(tx, ctx, active ? 'account_type.restored' : 'account_type.retired', 'account_type', id, t.market_code, { is_active: t.is_active }, { is_active: active, code: t.code })
  })
}

// ---------------------------------------------------------------- en pausa

const pauseInput = z.object({ reason: z.string().trim().min(2).max(300), reviewOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

/**
 * "En pausa" (stand by): el negocio sigue abierto, con motivo y fecha de revisión. No cuenta como estancado ni sin próximo paso,
 * se puede filtrar en el tablero y vuelve a Hoy el día de la revisión.
 */
export async function pauseDeal(ctx: Ctx, dealId: string, input: z.input<typeof pauseInput>): Promise<void> {
  const parsed = pauseInput.safeParse(input)
  if (!parsed.success) throw invalid('Escribe por qué queda en pausa y cuándo lo revisas.', 'Write why it is on hold and when you will review it.')
  const v = parsed.data
  assertNoProhibited(v.reason)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; status: string; title: string; account_id: string; owner_id: string | null; paused_at: Date | null; pause_reason: string | null; pause_review_on: string | null }[]>`
      select market_code, status, title, account_id, owner_id, paused_at, pause_reason, pause_review_on::text from crm.deals where id = ${dealId} for update`
    const d = rows[0]
    if (!d) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
    ctx.assert('deal.edit', d.market_code)
    if (d.status !== 'open') throw invalid('Solo un negocio abierto se pone en pausa.', 'Only an open deal can be put on hold.')
    const ok = await tx<{ ok: boolean }[]>`select ${v.reviewOn}::date > ${marketToday(tx, d.market_code)} and ${v.reviewOn}::date <= ${marketToday(tx, d.market_code)} + 366 as ok`
    if (!ok[0]?.ok) throw invalid('La fecha de revisión va de mañana en adelante, dentro de un año.', 'The review date must be tomorrow or later, within a year.')
    // Las tareas abiertas del negocio se cierran como "para después" y queda una sola: revisarlo en la fecha elegida. Así vuelve a Hoy ese día.
    // Lo que Operaciones tiene pendiente en el negocio (su carril) no se toca: la pausa es de quien vende.
    const closed = await tx`update crm.activities set done_at = now(), outcome = 'later'
                             where deal_id = ${dealId} and done_at is null and kind in ('task', 'call', 'meeting', 'email') and deal_step is distinct from 'ops' returning id`
    const subject = ctx.t(`Revisar negocio en pausa: ${d.title}`, `Review deal on hold: ${d.title}`).slice(0, 200)
    // La revisión es el próximo paso de quien vende (carril 'sales'): una sola tarea, la misma que muestra el negocio.
    await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, body, due_at, owner_id, created_by, custom, deal_step)
             values (${d.market_code}, ${d.account_id}, ${dealId}, 'task', ${subject}, ${v.reason}, ${`${v.reviewOn}T15:00:00Z`}, ${d.owner_id ?? ctx.user.id}, ${ctx.user.id}, ${tx.json({ pause_review: true })}, 'sales')`
    await tx`update crm.deals set paused_at = coalesce(paused_at, now()), paused_by = ${ctx.user.id}, pause_reason = ${v.reason}, pause_review_on = ${v.reviewOn},
              next_step = ${subject}, next_step_due = ${v.reviewOn} where id = ${dealId}`
    // Los avisos de "sin movimiento" abiertos se cierran con la pausa: no esperan a la siguiente evaluación de reglas.
    await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = 'auto'
              where deal_id = ${dealId} and resolved_at is null and kind in ('stalled_deal', 'no_next_step')`
    await audit(tx, ctx, 'deal.paused', 'deal', dealId, d.market_code, { paused: !!d.paused_at, reason: d.pause_reason, review_on: d.pause_review_on }, { paused: true, reason: v.reason, review_on: v.reviewOn, tasks_closed: closed.length })
  })
}

/** Retomar un negocio en pausa. El tiempo en la etapa vuelve a contar desde hoy, para que no aparezca como estancado al instante. */
export async function resumeDeal(ctx: Ctx, dealId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; paused_at: Date | null; pause_reason: string | null }[]>`select market_code, paused_at, pause_reason from crm.deals where id = ${dealId} for update`
    const d = rows[0]
    if (!d) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
    ctx.assert('deal.edit', d.market_code)
    if (!d.paused_at) return
    // Al retomar, "Revisar negocio en pausa" deja de ser el próximo paso: el negocio queda sin próximo paso hasta que quien lo lleva escriba el nuevo.
    await tx`update crm.deals set paused_at = null, paused_by = null, pause_reason = null, pause_review_on = null, stage_entered_at = now(),
              next_step = case when exists (select 1 from crm.activities x where x.deal_id = ${dealId} and x.done_at is null and x.kind = 'task' and x.custom ? 'pause_review') then null else next_step end,
              next_step_due = case when exists (select 1 from crm.activities x where x.deal_id = ${dealId} and x.done_at is null and x.kind = 'task' and x.custom ? 'pause_review') then null else next_step_due end
              where id = ${dealId}`
    await tx`update crm.activities set done_at = now(), outcome = 'done' where deal_id = ${dealId} and done_at is null and kind = 'task' and custom ? 'pause_review'`
    await audit(tx, ctx, 'deal.resumed', 'deal', dealId, d.market_code, { paused: true, reason: d.pause_reason }, { paused: false })
  })
}

// ---------------------------------------------------------------- contactos

/** El contacto principal de una cuenta: uno solo. Marcar otro quita la marca al anterior. */
export async function setPrimaryContact(ctx: Ctx, accountId: string, contactId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId} and archived_at is null for update`
    const a = rows[0]
    if (!a) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('account.edit', a.market_code)
    const link = await tx<{ id: string; is_primary: boolean }[]>`select id, is_primary from crm.account_contacts where account_id = ${accountId} and contact_id = ${contactId} and valid_to is null`
    if (!link[0]) throw invalid('Ese contacto no es de esta cuenta.', 'That contact does not belong to this account.')
    if (link[0].is_primary) return
    const prev = await tx<{ contact_id: string }[]>`update crm.account_contacts set is_primary = false where account_id = ${accountId} and is_primary and valid_to is null returning contact_id`
    await tx`update crm.account_contacts set is_primary = true where id = ${link[0].id}`
    await audit(tx, ctx, 'contact.primary_set', 'account', accountId, a.market_code, { contact_id: prev[0]?.contact_id ?? null }, { contact_id: contactId })
  })
}

// ---------------------------------------------------------------- etapas y embudos

type StageRow = { id: string; pipeline_id: string; market_code: string; position: number; kind: string; name_es: string; name_en: string; archived_at: Date | null }

async function loadStage(tx: Tx, stageId: string): Promise<StageRow> {
  const rows = await tx<StageRow[]>`
    select s.id, s.pipeline_id, p.market_code, s.position, s.kind, s.name_es, s.name_en, s.archived_at
      from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where s.id = ${stageId}`
  if (!rows[0]) throw notFound('No encontramos esa etapa.', 'We could not find that stage.')
  // El orden del embudo cambia bajo candado: dos personas no reordenan a la vez.
  await tx`select 1 from crm.pipelines where id = ${rows[0].pipeline_id} for update`
  return rows[0]
}

/** Deja las etapas vigentes de un embudo en el orden dado (1, 2, 3...). Las archivadas quedan fuera, de la 1000 en adelante. */
async function renumber(tx: Tx, pipelineId: string, ids: string[]): Promise<void> {
  await tx`update crm.stages set position = position + 100000 where pipeline_id = ${pipelineId} and archived_at is null`
  await tx`update crm.stages s set position = o.ord::int from unnest(${ids}::uuid[]) with ordinality o(id, ord) where s.id = o.id`
}

const liveStages = (tx: Tx, pipelineId: string) =>
  tx<{ id: string; kind: string; position: number }[]>`select id, kind, position from crm.stages where pipeline_id = ${pipelineId} and archived_at is null order by position`

const stageInput = z.object({ nameEs: label, nameEn: label, rotDays: z.number().int().min(0).max(365).optional().default(14) })

/** Agrega una etapa abierta al final de las etapas de trabajo: antes de la que espera la primera venta y de las de cierre. */
export async function createStage(ctx: Ctx, pipelineId: string, input: z.input<typeof stageInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = stageInput.safeParse(input)
  if (!parsed.success) throw invalid('La etapa lleva nombre en español y en inglés.', 'A stage needs a name in Spanish and in English.')
  const v = parsed.data
  assertNoProhibited(v.nameEs, v.nameEn)
  return withUser(ctx.user.id, async (tx) => {
    const pipes = await tx<{ market_code: string }[]>`select market_code from crm.pipelines where id = ${pipelineId} for update`
    const p = pipes[0]
    if (!p) throw notFound('No encontramos ese embudo.', 'We could not find that pipeline.')
    const clash = await tx`select 1 from crm.stages where pipeline_id = ${pipelineId} and archived_at is null
      and (lower(name_es) = lower(${v.nameEs}) or lower(name_en) = lower(${v.nameEn}))`
    if (clash[0]) throw invalid('Ya hay otra etapa con ese nombre en este embudo.', 'There is already another stage with that name in this pipeline.')
    const stages = await liveStages(tx, pipelineId)
    const open = stages.filter((s) => s.kind === 'open')
    const rest = stages.filter((s) => s.kind !== 'open')
    const id = await newId(tx)
    const code = await freeCode(slug(v.nameEs), async (c) => !!(await tx`select 1 from crm.stages where pipeline_id = ${pipelineId} and code = ${c}`)[0])
    const prob = Math.min(80, 10 + open.length * 10)
    await tx`insert into crm.stages (id, pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, edited_at, edited_by)
             values (${id}, ${pipelineId}, ${200000 + stages.length}, ${code}, ${v.nameEs}, ${v.nameEn}, 'open', ${prob}, ${v.rotDays}, now(), ${ctx.user.id})`
    await renumber(tx, pipelineId, [...open.map((s) => s.id), id, ...rest.map((s) => s.id)])
    await audit(tx, ctx, 'stage.created', 'stage', id, p.market_code, null, { pipeline_id: pipelineId, name_es: v.nameEs, name_en: v.nameEn, position: open.length + 1 })
    return id
  })
}

/** Sube o baja una etapa de trabajo un lugar. Las de cierre (ganado, perdido) se quedan al final. */
export async function moveStage(ctx: Ctx, stageId: string, dir: 'up' | 'down'): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const s = await loadStage(tx, stageId)
    if (s.archived_at || s.kind === 'won' || s.kind === 'lost') throw invalid('Solo se reordenan las etapas de trabajo.', 'Only working stages can be reordered.')
    const stages = await liveStages(tx, s.pipeline_id)
    const i = stages.findIndex((x) => x.id === stageId)
    const j = dir === 'up' ? i - 1 : i + 1
    const other = stages[j]
    if (!other || other.kind === 'won' || other.kind === 'lost') throw invalid('Esa etapa ya está en el extremo.', 'That stage is already at the end.')
    const ids = stages.map((x) => x.id)
    ids[i] = other.id
    ids[j] = stageId
    await renumber(tx, s.pipeline_id, ids)
    await audit(tx, ctx, 'stage.reordered', 'stage', stageId, s.market_code, { position: i + 1 }, { position: j + 1, name_es: s.name_es })
  })
}

/**
 * Archivar una etapa: no se borra. Si tiene negocios abiertos, se dice a qué etapa pasan y se mueven en ese momento,
 * cada uno con su evento de cambio de etapa a nombre de quien archivó.
 */
export async function archiveStage(ctx: Ctx, stageId: string, moveToStageId: string | null): Promise<{ moved: number }> {
  ctx.assert('config.manage')
  return withUser(ctx.user.id, async (tx) => {
    const s = await loadStage(tx, stageId)
    if (s.archived_at) return { moved: 0 }
    if (s.kind === 'won' || s.kind === 'lost') throw invalid('Las etapas de cierre no se archivan.', 'Closing stages cannot be archived.')
    if (s.kind === 'awaiting_txn') throw invalid('Esta etapa espera la primera venta. Cambia primero cómo se gana el embudo.', 'This stage waits for the first sale. Change how the pipeline is won first.')
    const stages = await liveStages(tx, s.pipeline_id)
    if (stages.filter((x) => x.kind === 'open').length <= 1) throw invalid('Un embudo necesita al menos una etapa de trabajo.', 'A pipeline needs at least one working stage.')
    const deals = await tx<{ id: string; market_code: string }[]>`select id, market_code from crm.deals where stage_id = ${stageId} and status = 'open' for update`
    if (deals.length > 0) {
      const to = stages.find((x) => x.id === moveToStageId && x.id !== stageId && (x.kind === 'open' || x.kind === 'awaiting_txn'))
      if (!to) throw invalid(`Esta etapa tiene ${deals.length === 1 ? '1 negocio abierto' : `${deals.length} negocios abiertos`}: elige a qué etapa pasan.`, `This stage has ${deals.length === 1 ? '1 open deal' : `${deals.length} open deals`}: choose the stage they move to.`)
      const ids = deals.map((d) => d.id)
      // PIPE-01: es un movimiento forzado; lo que a un negocio le falte para la etapa nueva queda anotado, no en silencio.
      await recordStageGaps(tx, 'admin')
      await tx`update crm.deals set stage_id = ${to.id}, stage_entered_at = now() where id = any(${ids}::uuid[])`
      await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
               select d.id, d.market_code, ${stageId}, ${to.id}, ${ctx.user.id}, 'admin' from crm.deals d where d.id = any(${ids}::uuid[])`
    }
    await tx`update crm.stages set archived_at = now(), edited_at = now(), edited_by = ${ctx.user.id},
              position = (select greatest(coalesce(max(position), 0), 999) + 1 from crm.stages where pipeline_id = ${s.pipeline_id} and archived_at is not null)
              where id = ${stageId}`
    await renumber(tx, s.pipeline_id, stages.filter((x) => x.id !== stageId).map((x) => x.id))
    await audit(tx, ctx, 'stage.archived', 'stage', stageId, s.market_code, { name_es: s.name_es, name_en: s.name_en }, { moved_deals: deals.length, moved_to: deals.length ? moveToStageId : null })
    return { moved: deals.length }
  })
}

const pipelineInput = z.object({
  market: z.string().length(2),
  motor: z.enum(MOTORS),
  name: z.string().trim().min(2).max(80),
  stages: z.array(z.object({ es: label, en: label })).min(1).max(15),
})

/**
 * Un embudo nuevo nace con sus etapas de trabajo, más "Ganado" y "Perdido". Se gana a mano; si después debe ganarse
 * con la primera transacción, administración cambia la regla en la misma pantalla.
 */
export async function createPipeline(ctx: Ctx, input: z.input<typeof pipelineInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = pipelineInput.safeParse(input)
  if (!parsed.success) throw invalid('El embudo lleva nombre, mercado, tipo de venta y al menos una etapa (nombre en español y en inglés, de 2 a 60 letras).', 'A pipeline needs a name, market, sale type and at least one stage (name in Spanish and in English, 2 to 60 characters).')
  const v = parsed.data
  assertNoProhibited(v.name, ...v.stages.flatMap((s) => [s.es, s.en]))
  const es = v.stages.map((s) => s.es.toLowerCase())
  const en = v.stages.map((s) => s.en.toLowerCase())
  if (new Set(es).size !== es.length || new Set(en).size !== en.length) throw invalid('Dos etapas no pueden llamarse igual.', 'Two stages cannot share a name.')
  return withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const clash = await tx`select 1 from crm.pipelines where market_code = ${v.market} and is_active and lower(name) = lower(${v.name})`
    if (clash[0]) throw invalid('Ya hay un embudo con ese nombre en ese mercado.', 'There is already a pipeline with that name in that market.')
    const id = await newId(tx)
    await tx`insert into crm.pipelines (id, market_code, motor, name, position, close_by_transaction)
             values (${id}, ${v.market}, ${v.motor}, ${v.name}, (select coalesce(max(position), 0) + 1 from crm.pipelines where market_code = ${v.market}), false)`
    const codes = new Set<string>()
    let pos = 0
    for (const s of v.stages) {
      const code = await freeCode(slug(s.es), async (c) => codes.has(c))
      codes.add(code)
      pos += 1
      await tx`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, edited_at, edited_by)
               values (${id}, ${pos}, ${code}, ${s.es}, ${s.en}, 'open', ${Math.min(90, Math.round((pos / (v.stages.length + 1)) * 100))}, 14, now(), ${ctx.user.id})`
    }
    await tx`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, edited_at, edited_by) values
      (${id}, ${pos + 1}, 'won', 'Ganado', 'Won', 'won', 100, 0, now(), ${ctx.user.id}),
      (${id}, ${pos + 2}, 'lost', 'Perdido', 'Lost', 'lost', 0, 0, now(), ${ctx.user.id})`
    await audit(tx, ctx, 'pipeline.created', 'pipeline', id, v.market, null, { name: v.name, motor: v.motor, stages: v.stages.map((s) => s.es) })
    return id
  })
}

// ---------------------------------------------------------------- campos

const fieldInput = z.object({
  object: z.enum(FIELD_OBJECTS),
  market: z.string().length(2).or(z.literal('')),
  motor: z.enum(MOTORS).or(z.literal('')),
  labelEs: label,
  labelEn: label,
  dataType: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  inIntake: z.boolean().optional().default(false),
  /** GOB-01: la decisión que el campo habilita. Sin decisión documentada no hay campo. */
  decision: z.string().trim().max(400).optional().default(''),
  purpose: z.string().trim().max(400).optional().default(''),
  /** Quién responde por el campo. Sin elegir, quien lo crea. */
  ownerId: z.guid().or(z.literal('')).optional().default(''),
  /** E7.F6: si el campo nació de una solicitud aprobada (Pedir un cambio), va su identificador y la solicitud queda hecha. */
  requestId: z.string().regex(/^[0-9a-f-]{36}$/i).or(z.literal('')).optional().default(''),
})

/**
 * Un campo nuevo para comercio, negocio o lead, por mercado y tipo de venta. Aparece en la ficha y, si se marca, en el alta.
 * Nace con su gobierno: la decisión que habilita, quién responde por él y una fecha de revisión a seis meses (se cambian en Datos, Campos).
 * La decisión escrita queda además como el motivo del cambio en la bitácora (E7.F7).
 */
export async function createField(ctx: Ctx, input: z.input<typeof fieldInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = fieldInput.safeParse(input)
  if (!parsed.success) {
    throw invalid('El campo lleva nombre en español y en inglés (de 2 a 60 letras) y su tipo.', 'A field needs a name in Spanish and in English (2 to 60 characters) and its type.')
  }
  const v = parsed.data
  assertAllowedLabel(v.labelEs, v.labelEn, ...v.options)
  const listed = v.dataType === 'select' || v.dataType === 'multiselect'
  const options = listed ? [...new Set(v.options)] : []
  if (listed && options.length < 2) throw invalid('Una lista lleva al menos dos opciones, una por renglón.', 'A list needs at least two options, one per line.')
  if (v.decision.length < 10) throw invalid('Escribe qué decisión habilita este campo (al menos 10 letras). Sin decisión no hay campo.', 'Say which decision this field enables (at least 10 characters). No decision, no field.')
  assertNoProhibited(v.decision, v.purpose)
  return withUser(ctx.user.id, async (tx) => {
    const market = v.market || null
    if (v.ownerId && !(await tx`select 1 from crm.users where id = ${v.ownerId} and is_active and not is_system`)[0]) throw invalid('Esa persona no está activa en CONTIGO.', 'That person is not active in CONTIGO.')
    if (market && !(await tx`select 1 from crm.markets where code = ${market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const clash = await tx`select 1 from crm.field_definitions where object = ${v.object} and is_active
      and (market_code is null or ${market}::text is null or market_code = ${market})
      and (motor is null or ${v.motor || null}::text is null or motor = ${v.motor || null})
      and (lower(label_es) = lower(${v.labelEs}) or lower(label_en) = lower(${v.labelEn}))`
    if (clash[0]) throw invalid('Ya hay un campo con ese nombre.', 'There is already a field with that name.')
    // Si nace de una solicitud, tiene que ser una de campo, aprobada y todavía sin crear.
    if (v.requestId) {
      const req = (await tx<{ kind: string; status: string; field_id: string | null }[]>`select kind, status, field_id from crm.config_requests where id = ${v.requestId} for update`)[0]
      if (!req || req.kind !== 'field' || req.status !== 'approved' || req.field_id) throw invalid('Esa solicitud no está aprobada o ya tiene su campo.', 'That request is not approved or already has its field.')
    }
    const key = await freeCode(slug(v.labelEn), async (k) => !!(await tx`select 1 from crm.field_definitions where object = ${v.object} and key = ${k}`)[0])
    const id = await newId(tx)
    await tx`insert into crm.field_definitions (id, object, key, label_es, label_en, data_type, options, market_code, motor, in_intake, position, decision, purpose, owner_id, review_on, decided_by, decided_at, request_id)
             values (${id}, ${v.object}, ${key}, ${v.labelEs}, ${v.labelEn}, ${v.dataType}, ${tx.json(options)}, ${market}, ${v.motor || null}, ${v.inIntake && v.object === 'account'},
                     (select coalesce(max(position), 0) + 1 from crm.field_definitions where object = ${v.object}),
                     ${v.decision}, ${v.purpose || null}, ${v.ownerId || ctx.user.id}, (now() + interval '6 months')::date, ${ctx.user.id}, now(), ${v.requestId || null})`
    await audit(tx, ctx, 'field.created', 'field', id, market, null, { object: v.object, key, label_es: v.labelEs, data_type: v.dataType, motor: v.motor || null, decision: v.decision, shared: market === null, from_request: !!v.requestId })
    // E7.F7: el porqué del cambio queda junto al evento, sin tener que anotarlo después.
    await tx`insert into crm.change_reasons (event_id, reason, created_by)
             select e.id, ${v.decision}, ${ctx.user.id} from crm.audit_events e where e.action = 'field.created' and e.object_id = ${id} order by e.at desc limit 1`
    if (v.requestId) await tx`update crm.config_requests set status = 'done', field_id = ${id}, decided_by = ${ctx.user.id}, decided_at = now() where id = ${v.requestId}`
    return id
  })
}

/** Quitar un campo no borra lo capturado: deja de mostrarse y de pedirse. Se puede volver a activar. */
export async function setFieldActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ object: string; key: string; market_code: string | null; is_active: boolean; mapped_to: string | null }[]>`
      select object, key, market_code, is_active, mapped_to from crm.field_definitions where id = ${id} for update`
    const f = rows[0]
    if (!f) throw notFound()
    if (f.is_active === active) return
    await tx`update crm.field_definitions set is_active = ${active} where id = ${id}`
    await audit(tx, ctx, active ? 'field.restored' : 'field.retired', 'field', id, f.market_code, { is_active: f.is_active }, { is_active: active, object: f.object, key: f.key })
  })
}

// ---------------------------------------------------------------- motivos de pérdida

const reasonInput = z.object({ labelEs: label, labelEn: label, market: z.string().length(2).or(z.literal('')), motors: z.array(z.enum(MOTORS)).max(MOTORS.length), kind: z.enum(['lost', 'no_sale']).optional().default('lost') })

/**
 * PIPE-04: cuántos motivos activos hay y cuántos caben. Base (todos los mercados) con tope `reason_core_max`; cada mercado
 * puede agregar hasta `reason_max_extensions` propios. Los topes son valores de crm.funnel_settings (propuestos, C1 decide).
 */
async function reasonRoom(tx: Tx, kind: string, market: string | null, except: string | null): Promise<{ n: number; cap: number | null }> {
  const r = await tx<{ n: number; cap: number | null }[]>`
    select (select count(*)::int from crm.loss_reasons where kind = ${kind} and is_active and market_code is not distinct from ${market} and code is distinct from ${except}) as n,
           (app.funnel_setting(${market}, ${market ? 'reason_max_extensions' : 'reason_core_max'}) #>> '{}')::int as cap`
  return r[0]!
}
const fullMsg = (market: string | null, cap: number) => invalid(
  market ? `Este mercado ya tiene ${cap} motivos propios activos, el tope. Desactiva uno antes de agregar otro.` : `Ya hay ${cap} motivos de base activos, el tope. Desactiva uno antes de agregar otro.`,
  market ? `This market already has ${cap} active reasons of its own, the cap. Turn one off before adding another.` : `There are already ${cap} active base reasons, the cap. Turn one off before adding another.`)

/** Un motivo nuevo (de pérdida o de no venta). Sin tipos de venta marcados, vale para todos los embudos. Lo agrega quien custodia el catálogo. */
export async function createLossReason(ctx: Ctx, input: z.input<typeof reasonInput>): Promise<string> {
  ctx.assert('reason.custody')
  const parsed = reasonInput.safeParse(input)
  if (!parsed.success) throw invalid('El motivo lleva nombre en español y en inglés.', 'A reason needs a name in Spanish and in English.')
  const v = parsed.data
  assertNoProhibited(v.labelEs, v.labelEn)
  return withUser(ctx.user.id, async (tx) => {
    const market = v.market || null
    if (market && !(await tx`select 1 from crm.markets where code = ${market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const room = await reasonRoom(tx, v.kind, market, null)
    if (room.cap !== null && room.n >= room.cap) throw fullMsg(market, room.cap)
    const code = await freeCode(slug(v.labelEn), async (c) => !!(await tx`select 1 from crm.loss_reasons where code = ${c}`)[0])
    await tx`insert into crm.loss_reasons (code, kind, label_es, label_en, market_code, motors, position)
             values (${code}, ${v.kind}, ${v.labelEs}, ${v.labelEn}, ${market}, ${v.motors.length ? v.motors : null}::text[], (select coalesce(max(position), 0) + 1 from crm.loss_reasons))`
    await audit(tx, ctx, 'loss_reason.created', 'loss_reason', null, market, null, { code, kind: v.kind, label_es: v.labelEs, motors: v.motors })
    return code
  })
}

/** En qué embudos se ofrece un motivo (por tipo de venta) y si sigue vigente. Lo ya registrado con ese motivo no cambia: un motivo nunca se borra. */
export async function updateLossReason(ctx: Ctx, code: string, input: { motors: string[]; active: boolean }): Promise<void> {
  ctx.assert('reason.custody')
  const motors = z.array(z.enum(MOTORS)).max(MOTORS.length).safeParse(input.motors)
  if (!motors.success) throw invalid('Revisa los tipos de venta.', 'Check the sale types.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ kind: string; market_code: string | null; motors: string[] | null; is_active: boolean }[]>`
      select kind, market_code, motors, is_active from crm.loss_reasons where code = ${code} for update`
    const r = rows[0]
    if (!r) throw notFound()
    const next = motors.data.length ? [...motors.data].sort() : null
    const before = { motors: r.motors ? [...r.motors].sort() : null, is_active: r.is_active }
    const after = { motors: next, is_active: input.active }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    if (input.active && !r.is_active) {
      const room = await reasonRoom(tx, r.kind, r.market_code, code)
      if (room.cap !== null && room.n >= room.cap) throw fullMsg(r.market_code, room.cap)
    }
    await tx`update crm.loss_reasons set motors = ${next}::text[], is_active = ${input.active},
               retired_at = case when ${input.active} then null else coalesce(retired_at, now()) end,
               retired_by = case when ${input.active} then null else coalesce(retired_by, ${ctx.user.id}::uuid) end where code = ${code}`
    await audit(tx, ctx, 'loss_reason.updated', 'loss_reason', null, r.market_code, before, { ...after, code, kind: r.kind })
  })
}

// ---------------------------------------------------------------- formularios

/**
 * Lo que administración cambia de un formulario web: su nombre visible, qué campos adicionales pide y con qué tipo de
 * cuenta nacen sus leads (del catálogo de tipos de cuenta; vacío: el del tipo de venta). Sin `accountType` no se toca.
 */
export async function updateForm(ctx: Ctx, formId: string, input: { name: string; askFields: string[]; accountType?: string | null }): Promise<void> {
  ctx.assert('config.manage')
  const name = z.string().trim().min(2).max(80).safeParse(input.name)
  if (!name.success) throw invalid('El formulario lleva un nombre de 2 a 80 letras.', 'A form needs a name of 2 to 80 characters.')
  assertNoProhibited(name.data)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; motor: string; name: string; ask_fields: string[]; account_type: string | null }[]>`select market_code, motor, name, ask_fields, account_type from crm.web_forms where id = ${formId} for update`
    const f = rows[0]
    if (!f) throw notFound()
    const defs = await tx<{ key: string }[]>`
      select key from crm.field_definitions where object = 'lead' and is_active and mapped_to is null and data_class <> 'confidential'
         and data_type in ('text', 'number', 'select', 'date', 'boolean')
         and (market_code is null or market_code = ${f.market_code}) and (motor is null or motor = ${f.motor}) order by position, key`
    const ask = defs.map((d) => d.key).filter((k) => input.askFields.includes(k))
    const type = input.accountType === undefined ? f.account_type : (input.accountType ?? '').trim() || null
    if (type && type !== f.account_type) {
      const known = await tx`select 1 from crm.account_types where code = ${type} and is_active and (market_code is null or market_code = ${f.market_code}) limit 1`
      if (!known[0]) throw invalid('Elige un tipo de cuenta de la lista.', 'Pick an account type from the list.')
    }
    if (f.name === name.data && JSON.stringify(f.ask_fields) === JSON.stringify(ask) && type === f.account_type) return
    await tx`update crm.web_forms set name = ${name.data}, ask_fields = ${ask}::text[], account_type = ${type} where id = ${formId}`
    await audit(tx, ctx, 'form.updated', 'form', formId, f.market_code, { name: f.name, ask_fields: f.ask_fields, account_type: f.account_type }, { name: name.data, ask_fields: ask, account_type: type })
  })
}

// ---------------------------------------------------------------- lo que pide un formulario web

/**
 * Guarda en el lead lo que el formulario web pidió además de lo básico (llegan como `x_<llave>`). Lo que no es un campo
 * del formulario se ignora y un valor que no cuadra con su tipo se descarta: un formulario público nunca se rechaza por esto.
 */
export async function saveFormAnswers(tx: Tx, leadId: string, formId: string, raw: unknown): Promise<void> {
  if (typeof raw !== 'object' || raw === null) return
  const body = raw as Record<string, unknown>
  const defs = await tx<{ key: string; data_type: string; options: string[] }[]>`
    select d.key, d.data_type, d.options from crm.web_forms f
      join crm.field_definitions d on d.object = 'lead' and d.key = any(f.ask_fields) and d.is_active and d.mapped_to is null and d.data_class <> 'confidential'
       and (d.market_code is null or d.market_code = f.market_code) and (d.motor is null or d.motor = f.motor)
     where f.id = ${formId}`
  const custom: Record<string, string | number | boolean> = {}
  for (const d of defs) {
    const v = body[`x_${d.key}`]
    const s = (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').trim()
    if (!s) continue
    if (d.data_type === 'number') {
      const n = Number(s)
      if (Number.isFinite(n) && n >= 0 && n < 1e15) custom[d.key] = n
    } else if (d.data_type === 'select') {
      if (d.options.includes(s)) custom[d.key] = s
    } else if (d.data_type === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) custom[d.key] = s
    } else if (d.data_type === 'boolean') {
      if (s === 'true' || s === 'false') custom[d.key] = s === 'true'
    } else if (d.data_type === 'text') {
      // SEC-08: lo que llega del formulario público se guarda sin el dato prohibido.
      const clean = scrub(s).slice(0, 300)
      if (clean) custom[d.key] = clean
    }
  }
  if (Object.keys(custom).length > 0) await tx`update crm.leads set custom = custom || ${tx.json(custom)} where id = ${leadId}`
}
