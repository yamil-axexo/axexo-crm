import 'server-only'
import { marketToday, withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { StageConditions } from '@/domain/embudo/stage-conditions'
import type { RuleMatch, RouteStep } from '@/domain/embudo/routing'

/** Lecturas del paquete embudo. Todas corren con la identidad de quien mira: RLS decide qué filas ve. */

export type Milestones = { first_funding_at: Date | null; funding_method: string | null; first_txn_at: Date | null; habit_at: Date | null; as_of: string | null }
export type MilestoneEvent = { kind: string; action: string; occurred_at: Date | null; previous_at: Date | null; method: string | null; reason: string | null; source: string; created_at: Date; actor: string | null }
export type Touch = { touch: 'first' | 'last'; touched_at: Date; source: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null
  gclid: string | null; fbclid: string | null; ttclid: string | null; li_fat_id: string | null; twclid: string | null; landing_page: string | null; referrer: string | null; platform: string | null; referrer_account: string | null }
const TOUCH_COLS = `t.touch, t.touched_at, t.source, t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.utm_term, t.gclid, t.fbclid, t.ttclid, t.li_fat_id, t.twclid, t.landing_page, t.referrer, t.platform`

/** Fecha de corte del archivo de ventas más reciente (los hitos se ven con un día de atraso). */
const lastCut = async (tx: Parameters<Parameters<typeof withUser>[1]>[0]) =>
  (await tx<{ as_of: string | null }[]>`select max(as_of)::text as as_of from crm.ingest_batches where source = 's5' and status = 'loaded'`)[0]?.as_of ?? null

export async function accountEmbudo(ctx: Ctx, accountId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const ms = await tx<Milestones[]>`select first_funding_at, funding_method, first_txn_at, habit_at, as_of::text from crm.account_milestones where account_id = ${accountId}`
    const events = await tx<MilestoneEvent[]>`
      select e.kind, e.action, e.occurred_at, e.previous_at, e.method, e.reason, e.source, e.created_at, u.full_name as actor
        from crm.milestone_events e left join crm.users u on u.id = e.actor_id where e.account_id = ${accountId} order by e.created_at desc limit 12`
    const leads = await tx<{ id: string; business_name: string; status: string; source: string; created_at: Date; owner: string | null }[]>`
      select l.id, l.business_name, l.status, l.source, l.created_at, u.full_name as owner
        from crm.leads l left join crm.users u on u.id = l.owner_id where l.account_id = ${accountId} order by (l.status in ('new','contacted','qualified')) desc, l.created_at desc limit 20`
    const tickets = await tx<{ id: string; system: string; external_ref: string; subject: string; status: string; created_at: Date; by: string | null }[]>`
      select k.id, k.system, k.external_ref, k.subject, k.status, k.created_at, u.full_name as by
        from crm.ticket_refs k left join crm.users u on u.id = k.created_by where k.account_id = ${accountId} order by k.created_at desc limit 30`
    const referral = await tx<{ code: string; is_active: boolean; referred: number; converted: number; first_sale: number }[]>`
      select r.code, r.is_active,
             (select count(*)::int from crm.leads l where l.referred_by_account_id = r.account_id) as referred,
             (select count(*)::int from crm.leads l where l.referred_by_account_id = r.account_id and l.status = 'converted') as converted,
             (select count(*)::int from crm.leads l join crm.account_milestones m on m.account_id = l.account_id and m.first_txn_at is not null where l.referred_by_account_id = r.account_id) as first_sale
        from crm.referral_codes r where r.account_id = ${accountId}`
    const children = await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where ${accountId} = any(ancestor_ids) and archived_at is null`
    return { milestones: ms[0] ?? null, events: [...events], leads: [...leads], tickets: [...tickets], referral: referral[0] ?? null, cut: await lastCut(tx), children: children[0]?.n ?? 0 }
  })
}

export type ThreadEntry = { id: string; at: Date; kind: string; title: string; detail: string | null; who: string | null; account_id: string; account_name: string }
export const THREAD_PAGE = 50
/** ACT-01: el hilo completo de un comercio, paginado, con lo de sus sucursales (si se pide) y sus tickets de soporte como entradas. */
export async function fullThread(ctx: Ctx, accountId: string, opts: { withChildren: boolean; before?: string | null }) {
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ id: string; name: string; market_code: string }[]>`select id, name, market_code from crm.accounts where id = ${accountId}`
    if (!acc[0]) return null
    const scope = opts.withChildren ? tx`(a.id = ${accountId} or ${accountId} = any(a.ancestor_ids))` : tx`a.id = ${accountId}`
    const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before) : null
    const rows = await tx<ThreadEntry[]>`
      select * from (
        select x.id::text, coalesce(x.done_at, x.created_at) as at, x.kind, x.subject as title, x.body as detail, u.full_name as who, a.id as account_id, a.name as account_name
          from crm.activities x join crm.accounts a on a.id = x.account_id left join crm.users u on u.id = coalesce(x.owner_id, x.created_by)
         where ${scope} and a.archived_at is null and (x.done_at is not null or x.kind in ('note', 'system'))
        union all
        select v.id::text, v.checked_in_at, 'sales_app_visit', v.outcome, v.note, u.full_name, a.id, a.name
          from crm.visits v join crm.accounts a on a.id = v.account_id left join crm.users u on u.id = v.user_id where ${scope} and a.archived_at is null
        union all
        select k.id::text, k.created_at, 'ticket', k.system || ' ' || k.external_ref || ': ' || k.subject, k.status, u.full_name, a.id, a.name
          from crm.ticket_refs k join crm.accounts a on a.id = k.account_id left join crm.users u on u.id = k.created_by where ${scope} and a.archived_at is null
        union all
        select e.id::text, e.at, 'stage', coalesce(s.name_es, '') || '|' || coalesce(s.name_en, ''), d.title, u.full_name, a.id, a.name
          from crm.deal_stage_events e join crm.deals d on d.id = e.deal_id join crm.accounts a on a.id = d.account_id
          join crm.stages s on s.id = e.to_stage_id left join crm.users u on u.id = e.actor_id where ${scope} and a.archived_at is null
        union all
        select m.id::text, m.created_at, 'milestone', m.kind || ':' || m.action, m.reason, u.full_name, a.id, a.name
          from crm.milestone_events m join crm.accounts a on a.id = m.account_id left join crm.users u on u.id = m.actor_id where ${scope} and a.archived_at is null
      ) t where ${before ? tx`t.at < ${before}` : tx`true`} order by t.at desc, t.id limit ${THREAD_PAGE + 1}`
    const items = rows.slice(0, THREAD_PAGE)
    return { account: acc[0], items, next: rows.length > THREAD_PAGE ? items[items.length - 1]!.at.toISOString() : null }
  })
}

export async function dealEmbudo(ctx: Ctx, dealId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const d = await tx<{ account_id: string; market_code: string; status: string; closed_by: string | null; lead_id: string | null; close_by_transaction: boolean; stage_id: string }[]>`
      select d.account_id, d.market_code, d.status, d.closed_by, d.lead_id, p.close_by_transaction, d.stage_id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.id = ${dealId}`
    if (!d[0]) return null
    const ms = await tx<Milestones[]>`select first_funding_at, funding_method, first_txn_at, habit_at, as_of::text from crm.account_milestones where account_id = ${d[0].account_id}`
    const corrections = await tx<MilestoneEvent[]>`
      select e.kind, e.action, e.occurred_at, e.previous_at, e.method, e.reason, e.source, e.created_at, u.full_name as actor
        from crm.milestone_events e left join crm.users u on u.id = e.actor_id where e.account_id = ${d[0].account_id} and e.action <> 'set' order by e.created_at desc limit 5`
    const touches = await tx<Touch[]>`
      select ${tx.unsafe(TOUCH_COLS)}, ra.name as referrer_account from crm.source_touches t left join crm.accounts ra on ra.id = t.referral_account_id
       where t.deal_id = ${dealId} order by t.touched_at`
    // Lo que quedó anotado al entrar sin requisitos solo se muestra mientras siga faltando (la base lo recalcula con el negocio de hoy).
    const gap = await tx<{ missing: string[]; source: string; recorded_at: Date }[]>`
      select crm.stage_missing(d, d.stage_id, false) as missing, g.source, g.recorded_at
        from crm.deal_stage_gaps g join crm.deals d on d.id = g.deal_id where g.deal_id = ${dealId} and d.status = 'open' and g.stage_id = d.stage_id`
    return { ...d[0], milestones: ms[0] ?? null, corrections: [...corrections], touches: [...touches], gap: gap[0] && gap[0].missing.length ? gap[0] : null, cut: await lastCut(tx) }
  })
}

export async function leadEmbudo(ctx: Ctx, leadId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const l = await tx<{ market_code: string; status: string; labels: string[]; account_id: string | null; account_name: string | null; referred_by: string | null; referred_by_id: string | null; landing_page: string | null; referrer: string | null
                         ttclid: string | null; li_fat_id: string | null; twclid: string | null }[]>`
      select l.market_code, l.status, l.labels, l.account_id, a.name as account_name, ra.name as referred_by, l.referred_by_account_id as referred_by_id, l.landing_page, l.referrer, l.ttclid, l.li_fat_id, l.twclid
        from crm.leads l left join crm.accounts a on a.id = l.account_id left join crm.accounts ra on ra.id = l.referred_by_account_id where l.id = ${leadId}`
    if (!l[0]) return null
    const touches = await tx<Touch[]>`
      select ${tx.unsafe(TOUCH_COLS)}, ra.name as referrer_account from crm.source_touches t left join crm.accounts ra on ra.id = t.referral_account_id
       where t.lead_id = ${leadId} order by t.touched_at`
    const labels = await tx<{ code: string; label_es: string; label_en: string }[]>`select code, label_es, label_en from crm.lead_labels where is_active order by position, code`
    const routed = await tx<{ rule_name: string | null; action: string; owner: string | null; created_at: Date; detail: { steps?: RouteStep[] } }[]>`
      select g.rule_name, g.action, u.full_name as owner, g.created_at, g.detail from crm.assignment_log g left join crm.users u on u.id = g.owner_id where g.lead_id = ${leadId} order by g.created_at desc limit 1`
    return { ...l[0], touches: [...touches], labelCatalog: [...labels], routed: routed[0] ?? null }
  })
}

/** Comercios del mercado para ligar un lead: por nombre, los que la persona puede ver. */
export async function accountChoices(ctx: Ctx, market: string, q: string) {
  const term = q.trim().slice(0, 80)
  if (term.length < 2) return []
  return withUser(ctx.user.id, (tx) => tx<{ id: string; name: string; locality: string | null }[]>`
    select id, name, locality from crm.accounts where market_code = ${market} and archived_at is null and merged_into is null and name ilike ${'%' + term.replace(/[%_\\]/g, '') + '%'} order by name limit 12`)
}

export async function leadLabelCatalog(ctx: Ctx) {
  return withUser(ctx.user.id, (tx) => tx<{ code: string; label_es: string; label_en: string }[]>`select code, label_es, label_en from crm.lead_labels where is_active order by position, code`)
}

export type AssignmentRuleRow = { id: string; market_code: string; position: number; name: string; is_active: boolean; match: RuleMatch; action: string; user_name: string | null; rotation_name: string | null; cap_open: number | null; sla_minutes: number | null }
export async function embudoAdmin(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const rules = await tx<AssignmentRuleRow[]>`
      select r.id, r.market_code, r.position, r.name, r.is_active, r.match, r.action, u.full_name as user_name, rr.name as rotation_name, r.cap_open, r.sla_minutes
        from crm.assignment_rules r left join crm.users u on u.id = r.user_id left join crm.routing_rules rr on rr.id = r.routing_rule_id order by r.market_code, r.position`
    const rotations = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.routing_rules where is_active order by market_code, name`
    const forms = await tx<{ id: string; market_code: string; name: string; motor: string }[]>`select id, market_code, name, motor from crm.web_forms where is_active order by market_code, name`
    const territories = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.territories where archived_at is null order by market_code, name`
    const log = await tx<{ id: string; market_code: string; lead_id: string | null; lead: string | null; rule_name: string | null; action: string; owner: string | null; created_at: Date; detail: { steps?: RouteStep[] } }[]>`
      select g.id, g.market_code, g.lead_id, l.business_name as lead, g.rule_name, g.action, u.full_name as owner, g.created_at, g.detail
        from crm.assignment_log g left join crm.leads l on l.id = g.lead_id left join crm.users u on u.id = g.owner_id order by g.created_at desc limit 25`
    const stages = await tx<{ id: string; pipeline: string; market_code: string; motor: string; name_es: string; name_en: string; position: number; kind: string; required_fields: string[]; conditions: StageConditions }[]>`
      select s.id, p.name as pipeline, p.market_code, p.motor, s.name_es, s.name_en, s.position, s.kind, s.required_fields, s.conditions
        from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where p.is_active and s.archived_at is null order by p.motor, p.market_code, s.position`
    const version = await tx<{ version: number; changed_at: Date }[]>`select version, changed_at from crm.catalog_versions where catalog = 'reason_codes'`
    const unknown = await tx<{ source: string; code: string; market_code: string | null; hits: number; last_seen: Date }[]>`select source, code, market_code, hits, last_seen from crm.unknown_reason_codes order by last_seen desc limit 30`
    const reasonCounts = await tx<{ kind: string; scope: string; n: number }[]>`
      select kind, coalesce(market_code, '*') as scope, count(*)::int as n from crm.loss_reasons where is_active group by 1, 2 order by 1, 2`
    const labels = await tx<{ code: string; label_es: string; label_en: string; used: number }[]>`
      select b.code, b.label_es, b.label_en, (select count(*)::int from crm.leads l where b.code = any(l.labels)) as used from crm.lead_labels b where b.is_active order by b.position, b.code`
    const retries = await tx<{ id: string; slug: string; status: string; attempts: number; error: string | null; created_at: Date; next_attempt_at: Date }[]>`
      select id, slug, status, attempts, error, created_at, next_attempt_at from crm.intake_retries where status <> 'done' order by created_at desc limit 30`
    const conversions = await tx<{ platform: string; event_name: string; status: string; n: number }[]>`
      select platform, event_name, status, count(*)::int as n from crm.conversion_events group by 1, 2, 3 order by 1, 2, 3`
    return { rules: [...rules], rotations: [...rotations], forms: [...forms], territories: [...territories], log: [...log], stages: [...stages], version: version[0] ?? null,
      unknown: [...unknown], reasonCounts: [...reasonCounts], labels: [...labels], retries: [...retries], conversions: [...conversions] }
  })
}

export const REPORT_DAYS = [30, 90, 365] as const
export async function embudoReport(ctx: Ctx, f: { market?: string; days: number }) {
  const mk = f.market && ctx.markets.some((m) => m.code === f.market) ? f.market : null
  return withUser(ctx.user.id, async (tx) => {
    const inMarket = (col: ReturnType<typeof tx>) => (mk ? tx`and ${col} = ${mk}` : tx``)
    const since = tx`now() - make_interval(days => ${f.days})`
    // PIPE-04: motivos de pérdida por tipo de venta y mercado, y motivos de no venta (visitas de la Sales App y capturadas aquí).
    const lost = await tx<{ market_code: string; motor: string; code: string; label_es: string; label_en: string; n: number }[]>`
      select d.market_code, p.motor, r.code, r.label_es, r.label_en, count(*)::int as n
        from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.loss_reasons r on r.code = d.loss_reason_code
       where d.status = 'lost' and d.lost_at >= ${since} ${inMarket(tx`d.market_code`)} group by 1, 2, 3, 4, 5 order by 1, 2, n desc`
    const noSale = await tx<{ market_code: string; code: string; label_es: string; label_en: string; n: number }[]>`
      select x.market_code, r.code, r.label_es, r.label_en, count(*)::int as n from (
        select v.market_code, v.rejection_code as code from crm.visits v where v.outcome = 'no_sale' and v.rejection_code is not null and v.checked_in_at >= ${since}
        union all
        select a.market_code, a.no_sale_code from crm.activities a where a.kind = 'visit' and a.outcome = 'no_sale' and a.no_sale_code is not null and a.done_at >= ${since}
      ) x join crm.loss_reasons r on r.code = x.code where true ${inMarket(tx`x.market_code`)} group by 1, 2, 3, 4 order by 1, n desc`
    // PIPE-05: revisitas a quien decide y visitas por alta.
    const revisits = await tx<{ pending: number; overdue: number }[]>`
      select count(*)::int as pending, count(*) filter (where d.revisit_due < ${marketToday(tx, tx`d.market_code`)})::int as overdue
        from crm.deals d where d.status = 'open' and d.revisit_needed ${inMarket(tx`d.market_code`)}`
    const visitsPerWin = await tx<{ market_code: string; wins: number; visits: number }[]>`
      select d.market_code, count(*)::int as wins,
             coalesce(sum((select count(*) from crm.visits v where v.account_id = d.account_id and v.checked_in_at <= d.won_at)
                        + (select count(*) from crm.activities a where a.account_id = d.account_id and a.kind = 'visit' and a.done_at is not null and a.done_at <= d.won_at and a.source <> 'sales_app')), 0)::int as visits
        from crm.deals d join crm.pipelines p on p.id = d.pipeline_id and p.motor = 'd2d'
       where d.status = 'won' and d.won_at >= ${since} ${inMarket(tx`d.market_code`)} group by 1 order by 1`
    // ACT-02: registros abiertos sin próximo paso, y próximos pasos a más de 60 días.
    const noStepDeals = await tx<{ id: string; title: string; account: string; owner: string | null; market_code: string }[]>`
      select d.id, d.title, a.name as account, u.full_name as owner, d.market_code from crm.deals d join crm.accounts a on a.id = d.account_id left join crm.users u on u.id = d.owner_id
       where d.status = 'open' and d.paused_at is null and (d.next_step is null or d.next_step_due is null) ${inMarket(tx`d.market_code`)} order by d.stage_entered_at limit 50`
    const noStepLeads = await tx<{ id: string; business_name: string; owner: string | null; status: string; market_code: string }[]>`
      select l.id, l.business_name, u.full_name as owner, l.status, l.market_code from crm.leads l left join crm.users u on u.id = l.owner_id
       where l.status in ('contacted', 'qualified') ${inMarket(tx`l.market_code`)}
         and not exists (select 1 from crm.activities x where x.lead_id = l.id and x.done_at is null and x.kind in ('task', 'visit', 'call', 'meeting'))
       order by l.updated_at limit 50`
    const noStepAccounts = await tx<{ id: string; name: string; owner: string | null; market_code: string }[]>`
      select a.id, a.name, u.full_name as owner, a.market_code from crm.accounts a left join crm.users u on u.id = a.owner_id
       where a.lifecycle = 'onboarding' and a.archived_at is null ${inMarket(tx`a.market_code`)}
         and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open')
         and not exists (select 1 from crm.activities x where x.account_id = a.id and x.done_at is null and x.kind in ('task', 'visit', 'call', 'meeting', 'handoff'))
       order by a.lifecycle_at limit 50`
    const farSteps = await tx<{ id: string; title: string; account: string; owner: string | null; due: string; days: number; market_code: string }[]>`
      select d.id, d.title, a.name as account, u.full_name as owner, d.next_step_due::text as due, (d.next_step_due - ${marketToday(tx, tx`d.market_code`)})::int as days, d.market_code
        from crm.deals d join crm.accounts a on a.id = d.account_id left join crm.users u on u.id = d.owner_id
       where d.status = 'open' and d.next_step_due > ${marketToday(tx, tx`d.market_code`)} + 60 ${inMarket(tx`d.market_code`)} order by d.next_step_due desc limit 50`
    // PIPE-01: negocios que entraron a su etapa sin lo que pide (importación o movimiento de administración) y todavía no lo completan.
    const gaps = await tx<{ id: string; title: string; account: string; stage_es: string; stage_en: string; missing: string[]; source: string; market_code: string }[]>`
      select d.id, d.title, a.name as account, s.name_es as stage_es, s.name_en as stage_en, crm.stage_missing(d, d.stage_id, false) as missing, g.source, d.market_code
        from crm.deal_stage_gaps g join crm.deals d on d.id = g.deal_id and d.status = 'open' and d.stage_id = g.stage_id
        join crm.accounts a on a.id = d.account_id join crm.stages s on s.id = d.stage_id
       where coalesce(array_length(crm.stage_missing(d, d.stage_id, false), 1), 0) > 0 ${inMarket(tx`d.market_code`)} order by g.recorded_at desc limit 50`
    // LEAD-02: atribución. Leads por fuente, campaña y plataforma del clic; cuántos se convirtieron y cuántos negocios se ganaron.
    const attribution = await tx<{ source: string; campaign: string; platform: string; leads: number; converted: number; won: number }[]>`
      select coalesce(t.utm_source, '') as source, coalesce(t.utm_campaign, '') as campaign, coalesce(t.platform, '') as platform,
             count(*)::int as leads, count(*) filter (where l.status = 'converted')::int as converted,
             count(*) filter (where exists (select 1 from crm.deals d where d.lead_id = l.id and d.status = 'won'))::int as won
        from crm.source_touches t join crm.leads l on l.id = t.lead_id
       where t.touch = 'first' and t.touched_at >= ${since} ${inMarket(tx`t.market_code`)} group by 1, 2, 3 order by leads desc limit 60`
    // LEAD-05: referidos por comercio que refiere. "Con primera venta" es lo que cuenta para el programa.
    const referrals = await tx<{ id: string; name: string; code: string | null; referred: number; converted: number; first_sale: number; market_code: string }[]>`
      select a.id, a.name, r.code, count(l.id)::int as referred, count(l.id) filter (where l.status = 'converted')::int as converted,
             count(l.id) filter (where exists (select 1 from crm.account_milestones m where m.account_id = l.account_id and m.first_txn_at is not null))::int as first_sale, a.market_code
        from crm.leads l join crm.accounts a on a.id = l.referred_by_account_id left join crm.referral_codes r on r.account_id = a.id
       where l.created_at >= ${since} ${inMarket(tx`l.market_code`)} group by a.id, a.name, r.code, a.market_code order by referred desc limit 60`
    return { lost: [...lost], noSale: [...noSale], revisits: revisits[0] ?? { pending: 0, overdue: 0 }, visitsPerWin: [...visitsPerWin], noStepDeals: [...noStepDeals], noStepLeads: [...noStepLeads],
      noStepAccounts: [...noStepAccounts], farSteps: [...farSteps], gaps: [...gaps], attribution: [...attribution], referrals: [...referrals], cut: await lastCut(tx), market: mk }
  })
}
