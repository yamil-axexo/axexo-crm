import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { notify } from '@/domain/notify'
import { recordStageGaps } from '@/domain/embudo/stage-conditions'
import { enqueueConversions } from '@/domain/embudo/attribution'

/**
 * PIPE-06: cierre por evento transaccional. Tres hitos del comercio, cada uno por separado y con su historia:
 * primer fondeo (con su método), primera transacción y hábito. Los pone el archivo de ventas, nunca una persona a mano.
 * Un hito ya puesto no se pisa: si resultó no ser cierto se corrige con un evento que lo anula o lo reexpresa, y la
 * corrección deshace lo que el hito había provocado (el negocio ganado vuelve a abrirse) dejando rastro de todo.
 */
export const FUNDING_METHODS = ['cash', 'spei', 'ach', 'pix', 'other'] as const
export type FundingMethod = (typeof FUNDING_METHODS)[number]
export const FUNDING_LABEL: Record<FundingMethod, { es: string; en: string }> = {
  cash: { es: 'Efectivo', en: 'Cash' },
  spei: { es: 'SPEI', en: 'SPEI' },
  ach: { es: 'ACH', en: 'ACH' },
  pix: { es: 'Pix', en: 'Pix' },
  other: { es: 'Otro', en: 'Other' },
}
export const MILESTONES = ['first_funding', 'first_txn', 'habit'] as const
export type Milestone = (typeof MILESTONES)[number]
export const MILESTONE_LABEL: Record<Milestone, { es: string; en: string }> = {
  first_funding: { es: 'Primer fondeo', en: 'First funding' },
  first_txn: { es: 'Primera transacción', en: 'First transaction' },
  habit: { es: 'Hábito', en: 'Habit' },
}
const COLUMN: Record<Milestone, 'first_funding_at' | 'first_txn_at' | 'habit_at'> = { first_funding: 'first_funding_at', first_txn: 'first_txn_at', habit: 'habit_at' }

const iso = z.string().datetime({ offset: true })
/** Campos nuevos del archivo de ventas (todos opcionales: el contrato vigente sigue valiendo). */
export const closingRowFields = {
  first_funding_at: iso.nullable().optional(),
  funding_method: z.enum(FUNDING_METHODS).nullable().optional(),
  habit_at: iso.nullable().optional(),
}
export const correctionRow = z.object({
  merchant_ref: z.string().min(1).max(80),
  kind: z.enum(MILESTONES),
  action: z.enum(['void', 'restate']),
  at: iso.optional(),
  method: z.enum(FUNDING_METHODS).optional(),
  reason: z.string().trim().min(3).max(300),
})
export const closingFileFields = {
  /** Manifiesto del archivo: cuántas filas dice traer. Si no cuadra con lo que llegó, no se aplica nada. */
  manifest: z.object({ row_count: z.number().int().nonnegative(), generated_at: iso.optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).optional(),
  corrections: z.array(correctionRow).max(2000).optional(),
}
type FileLike = {
  as_of: string
  rows: { merchant_ref: string; first_txn_at?: string | null; last_txn_at?: string | null; txn_count_30d: number; volume_minor_30d: number; active_days_30d: number; status?: string | null
          first_funding_at?: string | null; funding_method?: FundingMethod | null; habit_at?: string | null }[]
  manifest?: { row_count: number; generated_at?: string; sha256?: string }
  corrections?: z.infer<typeof correctionRow>[]
}

export const manifestProblem = (file: FileLike): boolean => file.manifest !== undefined && file.manifest.row_count !== file.rows.length

/**
 * Antes de cargar: si el archivo vuelve a traer un corte que ya estaba cargado y las cifras de un comercio cambian,
 * el antes y el después quedan guardados. La carga no sobrescribe en silencio.
 */
export async function recordRestatements(tx: Tx, file: FileLike, batchId: string): Promise<number> {
  const rows = await tx`
    with r as (
      select * from jsonb_to_recordset(${tx.json(file.rows as never)}) as x(merchant_ref text, txn_count_30d int, volume_minor_30d bigint, active_days_30d int, status text)
    ), m as (
      select distinct on (al.account_id) r.*, al.account_id
        from r join crm.account_aliases al on al.external_id = r.merchant_ref and al.system in ('s5','sales_core') and al.valid_to is null
    )
    insert into crm.metric_restatements (account_id, market_code, as_of, batch_id, before, after)
    select d.account_id, d.market_code, d.as_of, ${batchId},
           jsonb_build_object('txn_count_30d', d.txn_count_30d, 'volume_minor_30d', d.volume_minor_30d, 'active_days_30d', d.active_days_30d, 'status', d.status, 'batch_id', d.batch_id),
           jsonb_build_object('txn_count_30d', m.txn_count_30d, 'volume_minor_30d', m.volume_minor_30d, 'active_days_30d', m.active_days_30d, 'status', m.status)
      from m join crm.merchant_metrics_daily d on d.account_id = m.account_id and d.as_of = ${file.as_of}
     where (d.txn_count_30d, d.volume_minor_30d, d.active_days_30d, d.status) is distinct from (m.txn_count_30d, m.volume_minor_30d, m.active_days_30d, m.status)
    returning 1`
  return rows.length
}

export type ClosingResult = { funded: number; habits: number; corrections: number; restated: number; conversions: number }

/**
 * Después de cargar las cifras y de ganar los negocios con primera transacción: guarda los hitos nuevos (sin pisar los que
 * ya estaban), pasa a "esperando la primera venta" los negocios de los comercios que acaban de fondear, aplica las
 * correcciones que trae el archivo y deja en cola las conversiones para las plataformas de anuncios.
 */
export async function applyClosing(tx: Tx, sys: Ctx, file: FileLike, batchId: string, won: { id: string; account_id: string; market_code: string }[]): Promise<ClosingResult> {
  // Es una carga del sistema: lo que una etapa pida y falte queda anotado; el fondeo real no se rechaza.
  await recordStageGaps(tx)
  const fresh = await tx<{ account_id: string; market_code: string; kind: Milestone }[]>`
    with r as (
      select * from jsonb_to_recordset(${tx.json(file.rows as never)}) as x(merchant_ref text, first_txn_at timestamptz, first_funding_at timestamptz, funding_method text, habit_at timestamptz)
    ), m as (
      select distinct on (al.account_id) r.*, al.account_id, a.market_code
        from r join crm.account_aliases al on al.external_id = r.merchant_ref and al.system in ('s5','sales_core') and al.valid_to is null
               join crm.accounts a on a.id = al.account_id and a.archived_at is null
    ), cur as (
      select m.*, ms.first_funding_at as c_fund, ms.first_txn_at as c_txn, ms.habit_at as c_habit
        from m left join crm.account_milestones ms on ms.account_id = m.account_id
    ), up as (
      insert into crm.account_milestones (account_id, market_code, first_funding_at, funding_method, first_txn_at, habit_at, as_of)
      select account_id, market_code, first_funding_at, case when first_funding_at is not null then coalesce(funding_method, 'other') end, first_txn_at, habit_at, ${file.as_of}
        from cur where coalesce(first_funding_at, first_txn_at, habit_at) is not null
      on conflict (account_id) do update set
        funding_method = case when crm.account_milestones.first_funding_at is null then excluded.funding_method else crm.account_milestones.funding_method end,
        first_funding_at = coalesce(crm.account_milestones.first_funding_at, excluded.first_funding_at),
        first_txn_at = coalesce(crm.account_milestones.first_txn_at, excluded.first_txn_at),
        habit_at = coalesce(crm.account_milestones.habit_at, excluded.habit_at),
        as_of = excluded.as_of, updated_at = now()
    )
    insert into crm.milestone_events (account_id, market_code, kind, action, occurred_at, method, source, batch_id)
    select account_id, market_code, 'first_funding', 'set', first_funding_at, coalesce(funding_method, 'other'), 's5', ${batchId} from cur where first_funding_at is not null and c_fund is null
    union all
    select account_id, market_code, 'first_txn', 'set', first_txn_at, null, 's5', ${batchId} from cur where first_txn_at is not null and c_txn is null
    union all
    select account_id, market_code, 'habit', 'set', habit_at, null, 's5', ${batchId} from cur where habit_at is not null and c_habit is null
    returning account_id, market_code, kind`

  // El comercio que acaba de fondear pasa solo a la etapa que espera la primera venta (si su embudo cierra por transacción y va antes).
  const fundedAccounts = fresh.filter((f) => f.kind === 'first_funding').map((f) => f.account_id)
  const moved = fundedAccounts.length === 0 ? [] : await tx<{ id: string; market_code: string; from_stage: string; to_stage: string }[]>`
    with target as (
      select d.id, d.market_code, d.stage_id as from_stage, w.id as to_stage
        from crm.deals d
        join crm.pipelines p on p.id = d.pipeline_id and p.close_by_transaction
        join crm.stages c on c.id = d.stage_id
        join lateral (select s.id, s.position from crm.stages s where s.pipeline_id = d.pipeline_id and s.kind = 'awaiting_txn' and s.archived_at is null order by s.position limit 1) w on true
       where d.status = 'open' and d.account_id = any(${fundedAccounts}::uuid[]) and c.position < w.position
    ), ev as (
      insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
      select id, market_code, from_stage, to_stage, ${sys.user.id}, 'transaction' from target
    )
    update crm.deals d set stage_id = t.to_stage, stage_entered_at = now() from target t where d.id = t.id
    returning d.id, d.market_code, t.from_stage, t.to_stage`
  for (const d of moved) await audit(tx, sys, 'deal.funded', 'deal', d.id, d.market_code, { stage_id: d.from_stage }, { stage_id: d.to_stage, as_of: file.as_of })

  let corrections = 0
  let restated = 0
  for (const c of file.corrections ?? []) {
    const acc = await tx<{ id: string; market_code: string }[]>`
      select a.id, a.market_code from crm.account_aliases al join crm.accounts a on a.id = al.account_id
       where al.external_id = ${c.merchant_ref} and al.system in ('s5','sales_core') and al.valid_to is null and a.archived_at is null limit 1`
    if (!acc[0]) continue
    const done = await correctMilestoneTx(tx, sys, { accountId: acc[0].id, kind: c.kind, action: c.action, at: c.at ?? null, method: c.method ?? null, reason: c.reason, source: 's5', batchId })
    if (done) {
      corrections += 1
      if (c.action === 'restate') restated += 1
    }
  }
  // LEAD-02: la primera transacción es la conversión "compra" para la plataforma de la que vino el clic (envío apagado).
  let conversions = 0
  for (const w of won) conversions += await enqueueConversions(tx, { market: w.market_code, event: 'purchase', dealId: w.id, accountId: w.account_id })
  return { funded: moved.length, habits: fresh.filter((f) => f.kind === 'habit').length, corrections, restated, conversions }
}

type Correction = { accountId: string; kind: Milestone; action: 'void' | 'restate'; at: string | null; method: FundingMethod | null; reason: string; source: 's5' | 'user'; batchId?: string | null }

/**
 * La corrección compensatoria. No edita la fecha en sitio: agrega un evento que anula o reexpresa el hito, guarda el valor
 * anterior y deshace o corrige lo que el hito provocó. Devuelve false si no había nada que corregir (repetirla no hace nada).
 */
export async function correctMilestoneTx(tx: Tx, ctx: Ctx, c: Correction): Promise<boolean> {
  const col = COLUMN[c.kind]
  const rows = await tx<{ market_code: string; first_funding_at: Date | null; first_txn_at: Date | null; habit_at: Date | null; name: string }[]>`
    select a.market_code, ms.first_funding_at, ms.first_txn_at, ms.habit_at, a.name
      from crm.accounts a left join crm.account_milestones ms on ms.account_id = a.id where a.id = ${c.accountId} for update of a`
  const cur = rows[0]
  if (!cur) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  const previous = cur[col]
  if (c.action === 'void' && !previous) return false
  if (c.action === 'restate') {
    if (!c.at) throw invalid('Para corregir la fecha hace falta la fecha correcta.', 'To correct the date, the right date is needed.')
    if (new Date(c.at).getTime() > Date.now()) throw invalid('La fecha corregida no puede ser futura.', 'The corrected date cannot be in the future.')
    if (previous && previous.getTime() === new Date(c.at).getTime()) return false
  }
  const market = cur.market_code
  await tx`insert into crm.milestone_events (account_id, market_code, kind, action, occurred_at, previous_at, method, reason, source, batch_id, actor_id)
           values (${c.accountId}, ${market}, ${c.kind}, ${c.action}, ${c.action === 'void' ? null : c.at}, ${previous}, ${c.method}, ${c.reason}, ${c.source}, ${c.batchId ?? null}, ${ctx.user.id})`
  const at = c.action === 'void' ? null : c.at
  if (c.kind === 'first_funding') {
    await tx`insert into crm.account_milestones (account_id, market_code, first_funding_at, funding_method) values (${c.accountId}, ${market}, ${at}, ${at ? (c.method ?? 'other') : null})
             on conflict (account_id) do update set first_funding_at = excluded.first_funding_at,
               funding_method = case when excluded.first_funding_at is null then null else coalesce(${c.method}, crm.account_milestones.funding_method, 'other') end, updated_at = now()`
  } else if (c.kind === 'habit') {
    await tx`insert into crm.account_milestones (account_id, market_code, habit_at) values (${c.accountId}, ${market}, ${at})
             on conflict (account_id) do update set habit_at = excluded.habit_at, updated_at = now()`
  } else {
    await tx`insert into crm.account_milestones (account_id, market_code, first_txn_at) values (${c.accountId}, ${market}, ${at})
             on conflict (account_id) do update set first_txn_at = excluded.first_txn_at, updated_at = now()`
  }
  await audit(tx, ctx, 'account.milestone_corrected', 'account', c.accountId, market, { [col]: previous ? previous.toISOString() : null },
    { kind: c.kind, action: c.action, [col]: at, reason: c.reason, source: c.source })
  if (c.kind !== 'first_txn') return true

  // La primera transacción ganó negocios: la corrección los alcanza.
  const deals = await tx<{ id: string; title: string; owner_id: string | null; won_at: Date | null; stage_id: string; pipeline_id: string }[]>`
    select id, title, owner_id, won_at, stage_id, pipeline_id from crm.deals
     where account_id = ${c.accountId} and status = 'won' and closed_by = 'transaction' for update`
  if (c.action === 'restate') {
    for (const d of deals) {
      await tx`update crm.deals set won_at = ${c.at} where id = ${d.id}`
      await audit(tx, ctx, 'deal.win_redated', 'deal', d.id, market, { won_at: d.won_at ? d.won_at.toISOString() : null }, { won_at: c.at, reason: c.reason })
    }
    return true
  }
  await recordStageGaps(tx)
  const today = (await tx<{ d: string }[]>`select ${marketToday(tx, market)}::text as d`)[0]!.d
  for (const d of deals) {
    // Vuelve a la etapa de la que salió cuando se ganó (o a la que espera la primera venta, o a la primera del embudo).
    const back = await tx<{ id: string }[]>`
      select s.id from crm.stages s
       where s.pipeline_id = ${d.pipeline_id} and s.archived_at is null and s.kind in ('open', 'awaiting_txn')
       order by (s.id = (select e.from_stage_id from crm.deal_stage_events e where e.deal_id = ${d.id} and e.cause = 'transaction' and e.to_stage_id = ${d.stage_id} order by e.at desc limit 1)) desc,
                (s.kind = 'awaiting_txn') desc, s.position limit 1`
    if (!back[0]) continue
    const owner = d.owner_id ? await tx<{ locale: string | null }[]>`select locale from crm.users where id = ${d.owner_id}` : []
    const step = owner[0]?.locale === 'en' ? 'Review: the first sale was corrected, this deal is open again' : 'Revisar: la primera venta se corrigió y este negocio volvió a abrirse'
    await tx`update crm.deals set status = 'open', stage_id = ${back[0].id}, won_at = null, closed_by = null, stage_entered_at = now(),
              next_step = ${step}, next_step_due = ${today} where id = ${d.id}`
    await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause) values (${d.id}, ${market}, ${d.stage_id}, ${back[0].id}, ${ctx.user.id}, 'correction')`
    // La entrega a Operaciones que nació con la venta ya no aplica; el próximo paso vuelve a quien lleva el negocio.
    await tx`update crm.activities set done_at = now(), outcome = 'done' where deal_id = ${d.id} and kind = 'handoff' and source = 's5' and done_at is null`
    if (d.owner_id) {
      await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, deal_step, source)
               values (${market}, ${c.accountId}, ${d.id}, 'task', ${step}, ${`${today}T15:00:00Z`}, ${d.owner_id}, ${ctx.user.id}, 'sales', 'rule')`
      if (d.owner_id !== ctx.user.id)
        await notify(tx, ctx, {
          to: d.owner_id, kind: 'returned', market, link: `/deals/${d.id}`, accountId: c.accountId, dealId: d.id,
          title: [`${d.title} volvió a abrirse`, `${d.title} is open again`],
          body: [`La primera venta de ${cur.name} se corrigió: ${c.reason}`, `The first sale of ${cur.name} was corrected: ${c.reason}`],
        })
    }
    await audit(tx, ctx, 'deal.win_corrected', 'deal', d.id, market, { status: 'won', won_at: d.won_at ? d.won_at.toISOString() : null, stage_id: d.stage_id },
      { status: 'open', stage_id: back[0].id, reason: c.reason, source: c.source })
  }
  // El comercio deja de contar como activo: nunca tuvo su primera venta.
  const lc = await tx<{ lifecycle: string }[]>`update crm.accounts set lifecycle = 'onboarding' where id = ${c.accountId} and lifecycle in ('active', 'at_risk', 'inactive') returning lifecycle`
  if (lc[0]) await audit(tx, ctx, 'account.lifecycle_corrected', 'account', c.accountId, market, null, { lifecycle: 'onboarding', reason: c.reason })
  return true
}

const userCorrection = z.object({
  kind: z.enum(MILESTONES),
  action: z.enum(['void', 'restate']),
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  method: z.enum(FUNDING_METHODS).or(z.literal('')).optional(),
  reason: z.string().trim().min(5).max(300),
})

/** Quien lidera el mercado o administra corrige un hito que resultó no ser cierto. Siempre con motivo. */
export async function correctMilestone(ctx: Ctx, accountId: string, input: z.input<typeof userCorrection>): Promise<boolean> {
  const p = userCorrection.safeParse(input)
  if (!p.success) throw invalid('Escribe el motivo de la corrección (de 5 a 300 letras).', 'Enter the reason for the correction (5 to 300 characters).')
  const v = p.data
  assertNoProhibited(v.reason)
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId}`
    if (!acc[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('deal.correct_win', acc[0].market_code)
    const tz = ctx.market(acc[0].market_code).timezone
    const at = v.action === 'restate' && v.at ? (await tx<{ at: Date }[]>`select ((${v.at}::date + time '12:00') at time zone ${tz}) as at`)[0]!.at.toISOString() : null
    const done = await correctMilestoneTx(tx, ctx, { accountId, kind: v.kind, action: v.action, at, method: v.method || null, reason: v.reason, source: 'user' })
    if (!done) throw invalid('No hay nada que corregir: ese hito no está puesto o ya tiene esa fecha.', 'There is nothing to correct: that milestone is not set or already has that date.')
    return done
  })
}
