import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { missingForStage, type StageKind } from '@/domain/deals'
import { isUuid } from '@/lib/ids'
import { teamFilter } from '@/dal/reports'

export type PipelineInfo = { id: string; market_code: string; motor: string; name: string; open_deals: number }

export async function listPipelines(ctx: Ctx): Promise<PipelineInfo[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<PipelineInfo[]>`
      select p.id, p.market_code, p.motor, p.name,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'open') as open_deals
        from crm.pipelines p join crm.markets m on m.code = p.market_code
       where p.market_code = any(app.my_markets()) and m.status = 'live' and p.is_active
       order by p.market_code, p.position`
    return [...rows]
  })
}

export type Stage = {
  id: string
  position: number
  code: string
  name_es: string
  name_en: string
  kind: StageKind
  probability: number
  rot_days: number
  required_fields: string[]
  exit_es: string
  exit_en: string
  /** Etapa de Operaciones: al entrar, el negocio pasa a su cola. */
  is_ops: boolean
}

export type BoardDeal = {
  id: string
  stage_id: string
  title: string
  account_id: string
  account_name: string
  owner_name: string | null
  amount_minor: string | null
  currency: string
  next_step: string | null
  next_step_due: string | null
  revisit_needed: boolean
  revisit_due: string | null
  stage_entered_at: Date
  decision_maker_id: string | null
  decision_maker_met: boolean
  paused_at: Date | null
  pause_review_on: string | null
  owner_id: string | null
  ops_owner_name: string | null
  ops_next_step: string | null
  ops_next_step_due: string | null
}

export const BOARD_LIMIT = 40

export async function getBoard(ctx: Ctx, pipelineId: string, f: { owner?: string; noStep?: boolean; paused?: boolean; team?: string }) {
  return withUser(ctx.user.id, async (tx) => {
    const pipes = await tx<{ id: string; market_code: string; motor: string; name: string; close_by_transaction: boolean; has_items: boolean }[]>`
      select id, market_code, motor, name, close_by_transaction, has_items from crm.pipelines where id = ${pipelineId} and market_code = any(app.my_markets())`
    const pipeline = pipes[0]
    if (!pipeline) return null
    const stages = await tx<Stage[]>`select id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en, is_ops
      from crm.stages where pipeline_id = ${pipelineId} and archived_at is null order by position`
    // Persona y equipo se combinan: el equipo es el vigente de quien lleva el negocio ('none': sin equipo o sin dueño).
    const owner = tx`${f.owner === 'me' ? tx`and d.owner_id = ${ctx.user.id}` : f.owner === 'none' ? tx`and d.owner_id is null` : isUuid(f.owner) ? tx`and d.owner_id = ${f.owner}` : tx``} ${teamFilter(tx, 'd', f.team)}`
    const deals = await tx<BoardDeal[]>`
      select * from (
        select d.id, d.stage_id, d.title, d.account_id, a.name as account_name, u.full_name as owner_name, d.amount_minor::text, d.currency,
               d.next_step, d.next_step_due::text, d.revisit_needed, d.revisit_due::text, d.stage_entered_at, d.decision_maker_id, d.decision_maker_met,
               d.paused_at, d.pause_review_on::text,
               d.owner_id, (select o.full_name from crm.users o where o.id = d.ops_owner_id) as ops_owner_name, d.ops_next_step, d.ops_next_step_due::text,
               row_number() over (partition by d.stage_id order by ${f.noStep ? tx`d.amount_minor desc nulls last, d.created_at desc` : tx`d.revisit_needed desc, d.stage_entered_at`}) as rn
          from crm.deals d join crm.accounts a on a.id = d.account_id left join crm.users u on u.id = d.owner_id
         where d.pipeline_id = ${pipelineId} and d.status = 'open' ${owner}
           ${f.noStep ? tx`and (d.next_step is null or d.next_step_due is null)` : tx``}
           ${f.paused ? tx`and d.paused_at is not null` : tx``}) x
       where rn <= ${f.noStep ? BOARD_LIMIT * 3 : BOARD_LIMIT}`
    const totals = await tx<{ stage_id: string; n: number; amount: string | null; revisits: number; no_step: number; paused: number }[]>`
      select d.stage_id, count(*)::int as n, sum(d.amount_minor)::text as amount, count(*) filter (where d.revisit_needed)::int as revisits,
             count(*) filter (where d.paused_at is not null)::int as paused,
             count(*) filter (where d.next_step is null or d.next_step_due is null)::int as no_step
        from crm.deals d where d.pipeline_id = ${pipelineId} and d.status = 'open' ${owner} group by d.stage_id`
    // Con un filtro puesto ("Sin próximo paso", "En pausa"), cada columna cuenta y suma solo lo que se ve.
    const shown = f.noStep || f.paused ? await tx<{ stage_id: string; n: number; amount: string | null }[]>`
      select d.stage_id, count(*)::int as n, sum(d.amount_minor)::text as amount
        from crm.deals d where d.pipeline_id = ${pipelineId} and d.status = 'open' ${owner}
         ${f.noStep ? tx`and (d.next_step is null or d.next_step_due is null)` : tx``}
         ${f.paused ? tx`and d.paused_at is not null` : tx``} group by d.stage_id` : null
    // Cada negocio lleva su moneda: el resumen suma por moneda, sin convertir.
    const amounts = await tx<{ currency: string; amount: string }[]>`
      select d.currency, sum(d.amount_minor)::text as amount from crm.deals d
       where d.pipeline_id = ${pipelineId} and d.status = 'open' and d.amount_minor is not null ${owner} group by d.currency order by sum(d.amount_minor) desc`
    const closed = await tx<{ won: number; lost: number }[]>`
      select count(*) filter (where d.status = 'won' and d.won_at > now() - interval '30 days')::int as won,
             count(*) filter (where d.status = 'lost' and d.lost_at > now() - interval '30 days')::int as lost
        from crm.deals d where d.pipeline_id = ${pipelineId} ${owner}`
    return { pipeline, stages: [...stages], deals: [...deals], totals: [...totals], shown: shown ? [...shown] : null, amounts: [...amounts], closed: closed[0] ?? { won: 0, lost: 0 } }
  })
}

export async function getDeal(ctx: Ctx, id: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<
      (BoardDeal & { market_code: string; pipeline_id: string; pipeline_name: string; status: 'open' | 'won' | 'lost'; loss_reason_code: string | null;
        loss_note: string | null; won_at: Date | null; lost_at: Date | null; closed_by: string | null; revisit_reason: string | null; created_at: Date; account_lifecycle: string; custom: Record<string, unknown>; close_by_transaction: boolean;
        motor: string; pause_reason: string | null })[]
    >`select d.id, d.stage_id, d.title, d.account_id, a.name as account_name, u.full_name as owner_name, d.amount_minor::text, d.currency,
             d.next_step, d.next_step_due::text, d.revisit_needed, d.revisit_due::text, d.stage_entered_at, d.decision_maker_id, d.decision_maker_met,
             d.owner_id, (select o.full_name from crm.users o where o.id = d.ops_owner_id) as ops_owner_name, d.ops_next_step, d.ops_next_step_due::text,
             d.market_code, d.pipeline_id, p.name as pipeline_name, d.status, d.loss_reason_code, d.loss_note, d.won_at, d.lost_at, d.closed_by,
             d.revisit_reason, d.created_at, a.lifecycle as account_lifecycle, d.custom, p.close_by_transaction, p.motor, d.paused_at, d.pause_review_on::text, d.pause_reason
        from crm.deals d join crm.accounts a on a.id = d.account_id join crm.pipelines p on p.id = d.pipeline_id left join crm.users u on u.id = d.owner_id
       where d.id = ${id}`
    const deal = rows[0]
    if (!deal) return null
    const stages = await tx<Stage[]>`select id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en, is_ops
      from crm.stages where pipeline_id = ${deal.pipeline_id} and (archived_at is null or id = ${deal.stage_id}) order by position`
    const contacts = await tx<{ id: string; full_name: string; role: string }[]>`
      select c.id, c.full_name, ac.role from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${deal.account_id} and ac.valid_to is null order by ac.role, c.full_name`
    const events = await tx<{ at: Date; from_es: string | null; from_en: string | null; to_es: string; to_en: string; actor: string | null; cause: string }[]>`
      select e.at, f.name_es as from_es, f.name_en as from_en, t.name_es as to_es, t.name_en as to_en, u.full_name as actor, e.cause
        from crm.deal_stage_events e left join crm.stages f on f.id = e.from_stage_id join crm.stages t on t.id = e.to_stage_id
        left join crm.users u on u.id = e.actor_id where e.deal_id = ${id} order by e.at desc`
    // Lo hecho se ordena y se fecha por el día en que se hizo, no por el día en que se creó la tarea.
    const activities = await tx<{ id: string; kind: string; subject: string; body: string | null; due_at: Date | null; done_at: Date | null; created_at: Date; author: string | null; outcome: string | null; visited_by: string | null }[]>`
      select a.id, a.kind, a.subject, a.body, a.due_at, a.done_at, a.created_at, u.full_name as author, coalesce(a.ops_outcome, a.outcome) as outcome, a.visited_by
        from crm.activities a left join crm.users u on u.id = a.created_by where a.deal_id = ${id} order by coalesce(a.done_at, a.created_at) desc limit 40`
    const items = await tx<{ id: string; name: string; quantity: string; unit_price_minor: string | null; sum_minor: string | null; currency: string; comments: string | null }[]>`
      select id, name, quantity::text, unit_price_minor::text, sum_minor::text, currency, comments from crm.deal_items where deal_id = ${id} order by position, created_at`
    const current = stages.find((s) => s.id === deal.stage_id)
    const next = current ? stages.find((s) => s.position === current.position + 1 && s.kind !== 'lost') : undefined
    const missingNext = next && next.kind !== 'won' ? missingForStage({ ...deal, items_count: items.length }, next) : []
    return { deal, stages: [...stages], contacts: [...contacts], events: [...events], activities: [...activities], items: [...items], current, next, missingNext }
  })
}
