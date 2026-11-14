import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'
import type { CheckItem } from '@/lib/care'

/** Lecturas del cuidado del comercio (CS-01 a CS-08). RLS decide las filas: cada quien ve lo de los comercios que ya ve. */
export type HealthPart = { grp: string; weight: number; points: number | null; basis: string; as_of: string | null; raw: number | null; baseline: number | null }
export type CareHandoff = { id: string; from_role: string; to_role: string; from_name: string | null; to_name: string; to_user_id: string; from_user_id: string | null; due_on: string; checklist: CheckItem[]; note: string | null; status: string; ack_at: Date | null; ack_note: string | null; ack_name: string | null; source: string; created_at: Date }
export type CareAlert = { id: string; kind: string; status: string; owner_name: string | null; in_holdout: boolean; digital_only: boolean; detail: Record<string, unknown>; opened_at: Date; closed_at: Date | null; close_reason: string | null; close_note: string | null; title_es: string | null; title_en: string | null; steps_es: string[] | null; steps_en: string[] | null; task_done: boolean | null; message_status: string | null }

export async function getAccountCare(ctx: Ctx, accountId: string) {
  if (!isUuid(accountId)) return null
  return withUser(ctx.user.id, async (tx) => {
    const accs = await tx<{ id: string; name: string; market_code: string; kind: string; lifecycle: string; lifecycle_at: Date; owner_id: string | null; owner_name: string | null; merchant_ref: string | null }[]>`
      select a.id, a.name, a.market_code, a.kind, a.lifecycle, a.lifecycle_at, a.owner_id, u.full_name as owner_name, a.merchant_ref
        from crm.accounts a left join crm.users u on u.id = a.owner_id where a.id = ${accountId} and a.archived_at is null`
    const a = accs[0]
    if (!a) return null
    const care = (await tx<{ stage: string; stage_at: Date; stage_source: string; stage_reason: string | null; product_line: string; care_owner_id: string | null; care_owner: string | null; care_role: string | null; service_tier: string | null; service_tier_at: Date | null; service_tier_basis: string | null }[]>`
      select c.stage, c.stage_at, c.stage_source, c.stage_reason, c.product_line, c.care_owner_id, u.full_name as care_owner, c.care_role, c.service_tier, c.service_tier_at, c.service_tier_basis
        from crm.account_care c left join crm.users u on u.id = c.care_owner_id where c.account_id = ${a.id}`)[0]
      ?? { stage: a.lifecycle, stage_at: a.lifecycle_at, stage_source: 'import', stage_reason: null, product_line: 'general', care_owner_id: null, care_owner: null, care_role: null, service_tier: null, service_tier_at: null, service_tier_basis: null }
    const win = (await tx<{ risk_below: number; recover_at: number; habit_at: number; habit_below: number; churn_after_days: number; min_days_in_stage: number }[]>`select * from app.lifecycle_window(${a.market_code}, ${care.product_line})`)[0]!
    const history = await tx<{ id: string; from_stage: string | null; to_stage: string; source: string; reason: string | null; actor: string | null; at: Date }[]>`
      select e.id, e.from_stage, e.to_stage, e.source, e.reason, case when u.is_system then null else u.full_name end as actor, e.at
        from crm.lifecycle_events e left join crm.users u on u.id = e.actor_id where e.account_id = ${a.id} order by e.at desc limit 20`
    const metrics = (await tx<{ as_of: string; txn_count_30d: number; active_days_30d: number; last_txn_at: Date | null; status: string | null }[]>`
      select as_of::text, txn_count_30d, active_days_30d, last_txn_at, status from crm.merchant_metrics_daily where account_id = ${a.id} order by as_of desc limit 1`)[0] ?? null
    const handoffs = await tx<CareHandoff[]>`
      select h.id, h.from_role, h.to_role, fu.full_name as from_name, tu.full_name as to_name, h.to_user_id, h.from_user_id, h.due_on::text, h.checklist, h.note, h.status, h.ack_at, h.ack_note, au.full_name as ack_name, h.source, h.created_at
        from crm.handoffs h join crm.users tu on tu.id = h.to_user_id left join crm.users fu on fu.id = h.from_user_id and not fu.is_system left join crm.users au on au.id = h.ack_by
       where h.account_id = ${a.id} order by h.created_at desc limit 20`
    const people = await tx<{ id: string; full_name: string }[]>`
      select u.id, u.full_name from crm.users u where u.is_active and not u.is_system
         and u.id in (select user_id from app.people_with_role(${a.market_code}, array['ops','rep','supervisor','market_lead'])) order by u.full_name`
    const alerts = await tx<CareAlert[]>`
      select al.id, al.kind, al.status, u.full_name as owner_name, al.in_holdout, al.digital_only, al.detail, al.opened_at, al.closed_at, al.close_reason, al.close_note,
             p.title_es, p.title_en, p.steps_es, p.steps_en, (act.done_at is not null) as task_done,
             (select m.status from crm.cs_messages m where m.alert_id = al.id order by m.created_at desc limit 1) as message_status
        from crm.cs_alerts al left join crm.users u on u.id = al.owner_id left join crm.playbooks p on p.id = al.playbook_id left join crm.activities act on act.id = al.activity_id
       where al.account_id = ${a.id} order by (al.status = 'open') desc, al.opened_at desc limit 12`
    // Permiso para mensajes de WhatsApp: el registro único es el de consentimientos por contacto (Seguridad).
    const waConsent = (await tx<{ full_name: string; granted_at: Date }[]>`
      select ct.full_name, cs.granted_at from crm.account_contacts ac join crm.contacts ct on ct.id = ac.contact_id
        join crm.consents cs on cs.contact_id = ct.id and cs.channel = 'whatsapp' and cs.revoked_at is null
       where ac.account_id = ${a.id} and (ac.valid_to is null or ac.valid_to > now()) and ct.phone is not null
         and (select mc.ok from app.may_contact('whatsapp', ct.phone, 'service') mc)
       order by (ac.role = 'manager') desc, cs.granted_at desc limit 1`)[0] ?? null
    const settings = (await tx<{ alerts_on: boolean; health_published: boolean; health_threshold: number; low_balance_minor: string | null }[]>`
      select alerts_on, health_published, health_threshold, low_balance_minor::text from crm.cs_settings where market_code = ${a.market_code}`)[0] ?? { alerts_on: false, health_published: false, health_threshold: 50, low_balance_minor: null }
    const health = (await tx<{ as_of: string; score: number; band: string; groups: HealthPart[]; lowest: string | null }[]>`
      select as_of::text, score, band, groups, lowest from crm.health_snapshots where account_id = ${a.id} order by as_of desc limit 1`)[0] ?? null
    const validation = (await tx<{ sample: number; hit_precision: string | null; hit_recall: string | null; run_at: Date; horizon_days: number }[]>`
      select sample, hit_precision::text, hit_recall::text, run_at, horizon_days from crm.health_validations where market_code = ${a.market_code} and tier = 'all' order by run_at desc limit 1`)[0] ?? null
    const completions = await tx<{ id: string; person_name: string; course_title: string; course_key: string; completed_on: string; source: string }[]>`
      select id, person_name, course_title, course_key, completed_on::text, source from crm.training_completions where account_id = ${a.id} order by completed_on desc, created_at desc limit 12`
    const managerChanges = await tx<{ id: string; changed_on: string; new_name: string; note: string | null; source: string; trained_at: Date | null; by: string | null }[]>`
      select mc.id, mc.changed_on::text, mc.new_name, mc.note, mc.source, mc.trained_at, u.full_name as by from crm.manager_changes mc left join crm.users u on u.id = mc.recorded_by
       where mc.account_id = ${a.id} order by mc.changed_on desc, mc.created_at desc limit 8`
    const opportunities = await tx<{ id: string; product_label: string; status: string; owner_name: string | null; evidence: Record<string, unknown>; close_note: string | null; created_at: Date }[]>`
      select o.id, o.product_label, o.status, u.full_name as owner_name, o.evidence, o.close_note, o.created_at
        from crm.expansion_opportunities o left join crm.users u on u.id = o.owner_id where o.account_id = ${a.id} order by (o.status in ('open','working')) desc, o.created_at desc limit 12`
    const plan = (await tx<{ goals: string | null; risks: string | null; next_steps: string | null; review_every_days: number; next_review_on: string | null; updated_at: Date }[]>`
      select goals, risks, next_steps, review_every_days, next_review_on::text, updated_at from crm.account_plans where account_id = ${a.id}`)[0] ?? null
    const relationships = await tx<{ id: string; product_label: string; health: string; note: string | null }[]>`
      select id, product_label, health, note from crm.account_relationships where account_id = ${a.id} order by product_label`
    const reviews = await tx<{ id: string; held_on: string; attendees: string | null; minutes: string; agreements: string | null; draft_source: string; by: string | null }[]>`
      select r.id, r.held_on::text, r.attendees, r.minutes, r.agreements, r.draft_source, u.full_name as by from crm.account_reviews r left join crm.users u on u.id = r.created_by
       where r.account_id = ${a.id} order by r.held_on desc, r.created_at desc limit 8`
    const contacts = await tx<{ role: string; full_name: string }[]>`
      select ac.role, c.full_name from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${a.id} and (ac.valid_to is null or ac.valid_to > now()) order by ac.role, c.full_name`
    const feedback = await tx<{ id: string; topic: string; kind: string; note: string | null; status: string; response: string | null; by: string | null; created_at: Date }[]>`
      select f.id, f.topic, f.kind, f.note, f.status, f.response, u.full_name as by, f.created_at from crm.product_feedback f left join crm.users u on u.id = f.created_by
       where f.account_id = ${a.id} order by f.created_at desc limit 12`
    const topics = await tx<{ code: string; label_es: string; label_en: string }[]>`select code, label_es, label_en from crm.feedback_topics where is_active order by sort`
    return { account: a, care, waConsent, window: win, history: [...history], metrics, handoffs: [...handoffs], people: [...people], alerts: [...alerts], settings, health, validation,
      completions: [...completions], managerChanges: [...managerChanges], opportunities: [...opportunities], plan, relationships: [...relationships], reviews: [...reviews], contacts: [...contacts], feedback: [...feedback], topics: [...topics] }
  })
}
export type AccountCare = NonNullable<Awaited<ReturnType<typeof getAccountCare>>>

/** La mesa de trabajo de un mercado: entregas esperando acuse, alertas abiertas, salud, expansión y comentarios de producto. */
export async function getCareBoard(ctx: Ctx, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const stages = await tx<{ stage: string; n: number }[]>`
      select coalesce(c.stage, a.lifecycle) as stage, count(*)::int as n from crm.accounts a left join crm.account_care c on c.account_id = a.id
       where a.market_code = ${market} and a.archived_at is null and a.merged_into is null group by 1`
    const handoffs = await tx<{ id: string; account_id: string; account: string; from_role: string; to_role: string; from_name: string | null; to_name: string; to_user_id: string; due_on: string; late: boolean; done: number; total: number; created_at: Date }[]>`
      select h.id, h.account_id, a.name as account, h.from_role, h.to_role, fu.full_name as from_name, tu.full_name as to_name, h.to_user_id, h.due_on::text,
             h.due_on < (now() at time zone mk.timezone)::date as late,
             (select count(*) from jsonb_array_elements(h.checklist) x where (x ->> 'done')::boolean)::int as done, jsonb_array_length(h.checklist) as total, h.created_at
        from crm.handoffs h join crm.accounts a on a.id = h.account_id join crm.markets mk on mk.code = h.market_code
        join crm.users tu on tu.id = h.to_user_id left join crm.users fu on fu.id = h.from_user_id and not fu.is_system
       where h.market_code = ${market} and h.status = 'pending' order by h.due_on, h.created_at limit 200`
    const alerts = await tx<{ id: string; account_id: string; account: string; kind: string; owner_name: string | null; in_holdout: boolean; digital_only: boolean; opened_at: Date; tier: string | null; title_es: string | null; title_en: string | null; message_status: string | null }[]>`
      select al.id, al.account_id, a.name as account, al.kind, u.full_name as owner_name, al.in_holdout, al.digital_only, al.opened_at, c.service_tier as tier, p.title_es, p.title_en,
             (select m.status from crm.cs_messages m where m.alert_id = al.id order by m.created_at desc limit 1) as message_status
        from crm.cs_alerts al join crm.accounts a on a.id = al.account_id left join crm.users u on u.id = al.owner_id
        left join crm.account_care c on c.account_id = a.id left join crm.playbooks p on p.id = al.playbook_id
       where al.market_code = ${market} and al.status = 'open' order by al.opened_at desc limit 200`
    // Medición contra el grupo de control: de las alertas con 14 (o 30) días cumplidos, qué parte volvió a vender, con guía y sin guía.
    const measure = await tx<{ kind: string; in_holdout: boolean; n14: number; back14: number; n30: number; back30: number }[]>`
      select kind, in_holdout, count(*) filter (where returned_14d is not null)::int as n14, count(*) filter (where returned_14d)::int as back14,
             count(*) filter (where returned_30d is not null)::int as n30, count(*) filter (where returned_30d)::int as back30
        from crm.cs_alerts where market_code = ${market} group by kind, in_holdout order by kind, in_holdout`
    const messages = await tx<{ status: string; n: number }[]>`select status, count(*)::int as n from crm.cs_messages where market_code = ${market} group by status order by status`
    const settings = (await tx<{ alerts_on: boolean; health_published: boolean; health_threshold: number; holdout_pct: number }[]>`
      select alerts_on, health_published, health_threshold, holdout_pct from crm.cs_settings where market_code = ${market}`)[0] ?? { alerts_on: false, health_published: false, health_threshold: 50, holdout_pct: 10 }
    const health = await tx<{ account_id: string; account: string; score: number; band: string; lowest: string | null; as_of: string; stage: string; tier: string | null }[]>`
      select h.account_id, a.name as account, h.score, h.band, h.lowest, h.as_of::text, coalesce(c.stage, a.lifecycle) as stage, c.service_tier as tier
        from crm.accounts a
        join lateral (select x.* from crm.health_snapshots x where x.account_id = a.id order by x.as_of desc limit 1) h on true
        left join crm.account_care c on c.account_id = a.id
       where a.market_code = ${market} and a.archived_at is null order by h.score, a.name limit 100`
    const tiers = await tx<{ tier: string | null; n: number }[]>`
      select c.service_tier as tier, count(*)::int as n from crm.accounts a left join crm.account_care c on c.account_id = a.id
       where a.market_code = ${market} and a.archived_at is null and a.merged_into is null and a.lifecycle not in ('prospect','churned') group by 1`
    const opportunities = await tx<{ id: string; account_id: string; account: string; product_label: string; status: string; owner_name: string | null; created_at: Date }[]>`
      select o.id, o.account_id, a.name as account, o.product_label, o.status, u.full_name as owner_name, o.created_at
        from crm.expansion_opportunities o join crm.accounts a on a.id = o.account_id left join crm.users u on u.id = o.owner_id
       where o.market_code = ${market} and (o.status in ('open','working') or o.closed_at > now() - interval '30 days') order by (o.status = 'open') desc, (o.status = 'working') desc, o.created_at desc limit 200`
    const feedback = await tx<{ id: string; account_id: string; account: string; topic: string; kind: string; note: string | null; status: string; response: string | null; by: string | null; created_at: Date }[]>`
      select f.id, f.account_id, a.name as account, f.topic, f.kind, f.note, f.status, f.response, u.full_name as by, f.created_at
        from crm.product_feedback f join crm.accounts a on a.id = f.account_id left join crm.users u on u.id = f.created_by
       where f.market_code = ${market} order by (f.status = 'new') desc, f.created_at desc limit 100`
    const byTopic = await tx<{ topic: string; n: number; friction: number; request: number }[]>`
      select topic, count(*)::int as n, count(*) filter (where kind = 'friction')::int as friction, count(*) filter (where kind = 'request')::int as request
        from crm.product_feedback where market_code = ${market} and created_at > now() - interval '90 days' group by topic order by n desc, topic`
    const topics = await tx<{ code: string; label_es: string; label_en: string }[]>`select code, label_es, label_en from crm.feedback_topics order by sort`
    const digests = await tx<{ id: string; period_start: string; period_end: string; total: number; counts: { market: string; topic: string; kind: string; count: number }[]; delivery_status: string | null }[]>`
      select id, period_start::text, period_end::text, total, counts, delivery_status from crm.feedback_digests order by period_start desc limit 4`
    return { stages: [...stages], handoffs: [...handoffs], alerts: [...alerts], measure: [...measure], messages: [...messages], settings, health: [...health], tiers: [...tiers],
      opportunities: [...opportunities], feedback: [...feedback], byTopic: [...byTopic], topics: [...topics], digests: [...digests] }
  })
}
export type CareBoard = Awaited<ReturnType<typeof getCareBoard>>

/** Lo que configura quien lidera el mercado o administra: ventanas, alertas, guías de acción, salud, modelo de atención y expansión. */
export async function getCareAdmin(ctx: Ctx, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const windows = await tx<{ product_line: string; risk_below: number; recover_at: number; habit_at: number; habit_below: number; churn_after_days: number; min_days_in_stage: number; calibrated_from: string; sample: number | null; updated_at: Date }[]>`
      select product_line, risk_below, recover_at, habit_at, habit_below, churn_after_days, min_days_in_stage, calibrated_from, sample, updated_at from crm.lifecycle_windows where market_code = ${market}`
    const settings = (await tx<{ alerts_on: boolean; own_rules_on: boolean; no_first_sale_days: number; drop_pct: number; low_balance_minor: string | null; holdout_pct: number; escalate_days: number; whatsapp_cap_per_owner: number;
      health_published: boolean; health_published_at: Date | null; health_threshold: number; tier_high_commission: string; tier_pooled_commission: string; tier_low_commission: string; tier_commission_rate_bp: number; tier_hysteresis_pct: number }[]>`
      select alerts_on, own_rules_on, no_first_sale_days, drop_pct, low_balance_minor::text, holdout_pct, escalate_days, whatsapp_cap_per_owner, health_published, health_published_at, health_threshold,
             tier_high_commission::text, tier_pooled_commission::text, tier_low_commission::text, tier_commission_rate_bp, tier_hysteresis_pct from crm.cs_settings where market_code = ${market}`)[0]
      ?? { alerts_on: false, own_rules_on: false, no_first_sale_days: 7, drop_pct: 40, low_balance_minor: null, holdout_pct: 10, escalate_days: 7, whatsapp_cap_per_owner: 20, health_published: false, health_published_at: null, health_threshold: 50,
           tier_high_commission: '50000', tier_pooled_commission: '10000', tier_low_commission: '2000', tier_commission_rate_bp: 100, tier_hysteresis_pct: 20 }
    const playbooks = await tx<{ id: string; market_code: string | null; alert_kind: string; tier: string; title_es: string; title_en: string; steps_es: string[]; steps_en: string[]; message_es: string | null; message_en: string | null; due_days: number; is_active: boolean }[]>`
      select distinct on (alert_kind, tier) id, market_code, alert_kind, tier, title_es, title_en, steps_es, steps_en, message_es, message_en, due_days, is_active
        from crm.playbooks where market_code is null or market_code = ${market} order by alert_kind, tier, market_code nulls last`
    const weights = await tx<{ grp: string; weight: number; is_active: boolean; market_code: string | null }[]>`
      select distinct on (grp) grp, weight, is_active, market_code from crm.health_config where market_code is null or market_code = ${market} order by grp, market_code nulls last`
    const validations = await tx<{ id: string; tier: string; horizon_days: number; threshold: number; sample: number; positives: number; hit_precision: string | null; hit_recall: string | null; run_at: Date }[]>`
      select id, tier, horizon_days, threshold, sample, positives, hit_precision::text, hit_recall::text, run_at from crm.health_validations
       where market_code = ${market} and run_at = (select max(run_at) from crm.health_validations where market_code = ${market}) order by (tier = 'all') desc, tier`
    const rules = await tx<{ id: string; product_label: string; product_id: string | null; min_active_days: number; min_days_since_first: number; min_txn_30d: number; is_active: boolean; open: number }[]>`
      select r.id, r.product_label, r.product_id, r.min_active_days, r.min_days_since_first, r.min_txn_30d, r.is_active,
             (select count(*) from crm.expansion_opportunities o where o.rule_id = r.id and o.status in ('open','working'))::int as open
        from crm.expansion_rules r where r.market_code = ${market} order by r.product_label`
    const products = await tx<{ id: string; name: string }[]>`select id, name from crm.products where is_active order by name limit 200`
    return { windows: [...windows], settings, playbooks: [...playbooks], weights: [...weights], validations: [...validations], rules: [...rules], products: [...products] }
  })
}
export type CareAdmin = Awaited<ReturnType<typeof getCareAdmin>>
