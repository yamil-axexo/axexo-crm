import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { ItemType } from '@/domain/queue'

export type QueueGroup = 'late' | 'today' | 'suggested'
export type QueueRow = {
  type: ItemType
  id: string
  group: QueueGroup
  /** task: asunto; lead: negocio; suggestion: tipo de regla */
  subject: string
  kind: string
  name: string | null
  phone: string | null
  market: string
  due: Date | null
  created: Date
  accountId: string | null
  dealId: string | null
  leadId: string | null
  stage: string | null
  detail: Record<string, unknown>
}
export type Queue = { rows: QueueRow[]; counts: Record<QueueGroup, number>; backlog: number; tz: string }

/** Cuántas filas trae la cola por grupo. Lo que no cabe se cuenta y se anuncia ("Y n más"). */
export const QUEUE_PAGE = 25

/**
 * Cuántas sugerencias entran a Hoy. Las reglas pueden tener miles de registros abiertos (por ejemplo, tras importar
 * un CRM anterior, donde casi ningún negocio trae próximo paso): Hoy muestra las más importantes, una por registro,
 * y dice cuántas más hay. El resto se trabaja en Negocios y Comercios, con sus filtros.
 */
export const SUGGESTED_PER_DAY = 5

/**
 * La cola de Hoy de una persona (handoff, sección 6), en orden de urgencia:
 * lead con reloj de primer contacto > vencidos > hoy por hora > sugeridos por las reglas.
 * "Hoy" se mide en la zona horaria del mercado de quien mira.
 */
export async function getQueue(ctx: Ctx): Promise<Queue> {
  const tz = ctx.markets[0]?.timezone ?? 'UTC'
  const me = ctx.user.id
  return withUser(me, async (tx) => {
    const day = await tx<{ start: Date; end: Date }[]>`
      select date_trunc('day', now() at time zone ${tz}) at time zone ${tz} as start,
             (date_trunc('day', now() at time zone ${tz}) + interval '1 day') at time zone ${tz} as "end"`
    const { start, end } = day[0]!

    const leads = await tx<{ id: string; business_name: string; phone: string | null; market_code: string; sla_due_at: Date | null; created_at: Date; source: string }[]>`
      select l.id, l.business_name, l.phone, l.market_code, l.sla_due_at, l.created_at, l.source from crm.leads l
       where l.owner_id = ${me} and l.status = 'new' and l.first_touch_at is null and l.sla_due_at is not null
       order by l.sla_due_at limit ${QUEUE_PAGE}`
    const tasks = await tx<{ id: string; kind: string; subject: string; due_at: Date | null; created_at: Date; market_code: string; account_id: string | null; deal_id: string | null; lead_id: string | null; name: string | null; phone: string | null; stage: string | null }[]>`
      select a.id, a.kind, a.subject, a.due_at, a.created_at, a.market_code, a.account_id, a.deal_id, a.lead_id,
             coalesce(ac.name, l.business_name) as name, coalesce(ac.phone, l.phone) as phone, ${ctx.locale === 'en' ? tx`s.name_en` : tx`s.name_es`} as stage
        from crm.activities a
        left join crm.accounts ac on ac.id = a.account_id
        left join crm.leads l on l.id = a.lead_id
        left join crm.deals d on d.id = a.deal_id and d.status = 'open'
        left join crm.stages s on s.id = d.stage_id
       where a.owner_id = ${me} and a.done_at is null and a.kind in ('task', 'handoff', 'call', 'meeting', 'email')
         and (a.due_at is null or a.due_at < ${end})
       order by a.due_at nulls last, a.created_at limit ${QUEUE_PAGE * 2}`
    // Una sugerencia por registro (si un negocio no tiene próximo paso y además está estancado, gana "sin próximo paso"),
    // primero las de mayor severidad y, entre iguales, los negocios de mayor monto y los más recientes.
    const suggestions = await tx<{ id: string; kind: string; market_code: string; account_id: string | null; deal_id: string | null; lead_id: string | null; detail: Record<string, unknown>; opened_at: Date; name: string | null; phone: string | null }[]>`
      select * from (
        select distinct on (coalesce(e.deal_id, e.account_id, e.lead_id, e.id))
               e.id, e.kind, e.severity, e.market_code, e.account_id, e.deal_id, e.lead_id, e.detail, e.opened_at,
               coalesce(ac.name, l.business_name) as name, coalesce(ac.phone, l.phone) as phone, d.amount_minor, d.created_at as deal_created
          from crm.exceptions e
          left join crm.accounts ac on ac.id = e.account_id
          left join crm.leads l on l.id = e.lead_id
          left join crm.deals d on d.id = e.deal_id
         where e.resolved_at is null and e.owner_id = ${me} and e.kind <> 'lead_sla'
         order by coalesce(e.deal_id, e.account_id, e.lead_id, e.id), (e.kind = 'no_next_step') desc, e.opened_at) s
       order by case s.severity when 'high' then 0 when 'medium' then 1 else 2 end, s.amount_minor desc nulls last, s.deal_created desc nulls last, s.opened_at desc
       limit ${SUGGESTED_PER_DAY}`
    const totals = await tx<{ leads_late: number; leads_today: number; tasks_late: number; tasks_today: number; suggested: number }[]>`
      select (select count(*)::int from crm.leads where owner_id = ${me} and status = 'new' and first_touch_at is null and sla_due_at < now()) as leads_late,
             (select count(*)::int from crm.leads where owner_id = ${me} and status = 'new' and first_touch_at is null and sla_due_at >= now()) as leads_today,
             (select count(*)::int from crm.activities where owner_id = ${me} and done_at is null and kind in ('task', 'handoff', 'call', 'meeting', 'email') and due_at < ${start}) as tasks_late,
             (select count(*)::int from crm.activities where owner_id = ${me} and done_at is null and kind in ('task', 'handoff', 'call', 'meeting', 'email') and (due_at is null or (due_at >= ${start} and due_at < ${end}))) as tasks_today,
             (select count(distinct coalesce(deal_id, account_id, lead_id, id))::int from crm.exceptions where resolved_at is null and owner_id = ${me} and kind <> 'lead_sla') as suggested`
    const c = totals[0]!
    const now = new Date()

    const rows: QueueRow[] = [
      ...leads.map((l): QueueRow => ({
        type: 'lead', id: l.id, group: l.sla_due_at && l.sla_due_at < now ? 'late' : 'today', subject: l.business_name, kind: l.source, name: l.business_name, phone: l.phone,
        market: l.market_code, due: l.sla_due_at, created: l.created_at, accountId: null, dealId: null, leadId: l.id, stage: null, detail: {},
      })),
      ...tasks.map((a): QueueRow => ({
        type: 'task', id: a.id, group: a.due_at && a.due_at < start ? 'late' : 'today', subject: a.subject, kind: a.kind, name: a.name, phone: a.phone,
        market: a.market_code, due: a.due_at, created: a.created_at, accountId: a.account_id, dealId: a.deal_id, leadId: a.lead_id, stage: a.stage, detail: {},
      })),
      ...suggestions.map((e): QueueRow => ({
        type: 'suggestion', id: e.id, group: 'suggested', subject: e.kind, kind: e.kind, name: e.name ?? (String(e.detail.name ?? e.detail.title ?? '') || null), phone: e.phone,
        market: e.market_code, due: null, created: e.opened_at, accountId: e.account_id, dealId: e.deal_id, leadId: e.lead_id, stage: null, detail: e.detail,
      })),
    ]
    const shown = Math.min(c.suggested, SUGGESTED_PER_DAY)
    return { rows, counts: { late: c.leads_late + c.tasks_late, today: c.leads_today + c.tasks_today, suggested: shown }, backlog: c.suggested - shown, tz }
  })
}

export type TeamRow = { id: string; full_name: string; market_code: string; late: number; leads_waiting: number; cold: number }

/** Negocio frío: abierto y sin actividad registrada en este tiempo. */
export const COLD_DAYS = 14

/** Mi equipo (handoff, sección 6): una fila por persona con lo que su supervisor necesita ver de un vistazo. */
export async function getTeamQueue(ctx: Ctx): Promise<TeamRow[]> {
  const tz = ctx.markets[0]?.timezone ?? 'UTC'
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<TeamRow[]>`
      select distinct on (u.full_name, u.id) u.id, u.full_name, m.market_code,
             (select count(*)::int from crm.activities a where a.owner_id = u.id and a.done_at is null and a.kind in ('task', 'handoff', 'call', 'meeting', 'email')
                and a.due_at < date_trunc('day', now() at time zone ${tz}) at time zone ${tz})
             + (select count(*)::int from crm.leads l where l.owner_id = u.id and l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now()) as late,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.status = 'new' and l.first_touch_at is null and l.sla_due_at is not null) as leads_waiting,
             (select count(*)::int from crm.deals d join crm.stages s on s.id = d.stage_id
               where d.owner_id = u.id and d.status = 'open' and s.kind = 'open' and d.created_at < now() - make_interval(days => ${COLD_DAYS})
                 and not exists (select 1 from crm.activities a where a.deal_id = d.id and coalesce(a.done_at, a.created_at) > now() - make_interval(days => ${COLD_DAYS}))) as cold
        from crm.users u join crm.memberships m on m.user_id = u.id and m.role = 'rep' and (m.valid_to is null or m.valid_to > now())
       where u.is_active and u.id <> ${ctx.user.id} and (m.market_code = any(app.full_markets()) or u.id = any(app.supervised_user_ids()))
       order by u.full_name, u.id, m.market_code`
    return [...rows]
  })
}
