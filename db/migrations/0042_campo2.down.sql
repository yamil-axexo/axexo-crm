-- 0042_campo2 (down)
alter table crm.feedback_digests drop column if exists delivery_status, drop column if exists delivered_at;
drop table if exists crm.channel_policies;
drop table if exists crm.enablement_progress;
drop table if exists crm.commission_statements;
drop function if exists app.claim_check(text, text, text, text);
drop policy if exists channel_claims_partner_read on crm.channel_claims;
drop policy if exists channel_claims_partner_ins on crm.channel_claims;
alter table crm.channel_claims drop column if exists registered_via;
alter table crm.field_incidents drop column if exists visit_id, drop column if exists equipment_event_id, drop column if exists trust_score, drop column if exists attribution;
drop table if exists crm.equipment_events;
delete from crm.account_sensitive where field_key = 'tax_id';
delete from crm.sensitive_fields where key = 'tax_id';
drop table if exists crm.onboarding_links;
delete from crm.health_config where grp = 'perfect_store';
alter table crm.health_config drop constraint if exists health_config_grp_check;
alter table crm.health_config add constraint health_config_grp_check check (grp in ('transactions','mix','tickets','balance'));
update crm.exceptions set resolved_at = now(), resolution = 'auto_closed' where kind in ('competitor_share_loss','indirect_route') and resolved_at is null;
delete from crm.exceptions where kind in ('competitor_share_loss','indirect_route');
alter table crm.exceptions drop constraint if exists exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low'));
drop trigger if exists exceptions_route_owner on crm.exceptions;
drop function if exists crm.exception_route_owner();
drop function if exists app.exception_fallback_owner(text, uuid);
update crm.exceptions set owner_id = null, detail = detail - 'routed_to' where detail ? 'routed_to';
delete from crm.field_thresholds where pending_owner is not null and key in ('trust_min_score','route_daily_stores','competitor_alert_visits','competitor_window_days','indirect_route_visits','perfect_store_health_days','threshold_review_days','onboarding_link_days','incentive_active_90') and version = 1;
alter table crm.field_thresholds drop column if exists pending_owner;
create or replace function app.health_snapshot_run(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with base as (
    select a.id, a.market_code, (now() at time zone mk.timezone)::date as today, c.service_tier, st.health_decay_days as decay,
           m.as_of as m_as_of, m.txn_count_30d as txn, m.active_days_30d as d,
           (select avg(h.txn_count_30d)::numeric from crm.merchant_metrics_daily h where h.account_id = a.id and h.as_of between m.as_of - 120 and m.as_of - 28) as baseline,
           s.as_of as s_as_of, bl.balance_minor, bl.as_of as b_as_of, s.product_count_30d, s.open_tickets, s.urgent_tickets, st.low_balance_minor,
           w.risk_below, w.habit_at
      from crm.accounts a
      join crm.markets mk on mk.code = a.market_code
      join crm.cs_settings st on st.market_code = a.market_code
      left join crm.account_care c on c.account_id = a.id
      cross join lateral app.lifecycle_window(a.market_code, c.product_line) w
      join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
      left join lateral (select x.* from crm.care_signals x where x.account_id = a.id order by x.as_of desc limit 1) s on true
      left join crm.account_balance_latest bl on bl.account_id = a.id
     where a.archived_at is null and a.merged_into is null and a.lifecycle in ('active','at_risk','inactive')
       and (p_market is null or a.market_code = p_market)
  ), sig as (
    select b.*,
           greatest(0, 1 - greatest(0, b.today - b.m_as_of - 2)::numeric / b.decay) as m_fresh,
           case when b.s_as_of is null then null else greatest(0, 1 - greatest(0, b.today - b.s_as_of - 2)::numeric / b.decay) end as s_fresh,
           case when b.b_as_of is null then null else greatest(0, 1 - greatest(0, b.today - b.b_as_of - 2)::numeric / b.decay) end as b_fresh,
           -- transacciones: contra su propia línea base si la hay; si no, contra el umbral de hábito del mercado
           least(1, case when b.baseline is not null and b.baseline > 0 then b.txn / b.baseline else b.d::numeric / b.habit_at end) as v_txn,
           case when b.product_count_30d is null then null else least(1, b.product_count_30d / 3.0) end as v_mix,
           case when b.open_tickets is null then null else greatest(0, 1 - (b.open_tickets + 2 * coalesce(b.urgent_tickets, 0)) / 5.0) end as v_tickets,
           case when b.balance_minor is null or b.low_balance_minor is null then null else least(1, b.balance_minor::numeric / greatest(1, b.low_balance_minor * 2)) end as v_balance
      from base b
  ), parts as (
    select g.id, g.market_code, g.today, g.service_tier, cfg.grp, cfg.weight,
           case cfg.grp when 'transactions' then g.v_txn * g.m_fresh when 'mix' then g.v_mix * g.s_fresh when 'tickets' then g.v_tickets * g.s_fresh else g.v_balance * g.b_fresh end as v,
           case cfg.grp when 'transactions' then case when g.baseline is not null and g.baseline > 0 then 'vs_baseline' else 'vs_habit' end else 'signal' end as basis,
           case cfg.grp when 'transactions' then g.m_as_of when 'balance' then g.b_as_of else g.s_as_of end as data_as_of,
           case cfg.grp when 'transactions' then g.txn::numeric when 'mix' then g.product_count_30d::numeric when 'tickets' then g.open_tickets::numeric else g.balance_minor::numeric end as raw,
           case when cfg.grp = 'transactions' then round(g.baseline, 1) end as baseline
      from sig g
      join lateral (select distinct on (h.grp) h.grp, h.weight from crm.health_config h
                     where h.is_active and h.weight > 0 and (h.market_code is null or h.market_code = g.market_code)
                     order by h.grp, h.market_code nulls last) cfg on true
  ), agg as (
    select p.id, p.market_code, p.today, p.service_tier,
           sum(p.weight) filter (where p.v is not null) as max_pts,
           sum(p.weight * p.v) filter (where p.v is not null) as pts,
           jsonb_agg(jsonb_build_object('grp', p.grp, 'weight', p.weight, 'points', case when p.v is null then null else round(p.weight * p.v, 1) end,
                                        'basis', p.basis, 'as_of', p.data_as_of, 'raw', p.raw, 'baseline', p.baseline) order by p.grp) as groups,
           (array_agg(p.grp order by p.v nulls last, p.weight desc))[1] as lowest
      from parts p group by p.id, p.market_code, p.today, p.service_tier
  ), ins as (
    insert into crm.health_snapshots (account_id, as_of, market_code, score, band, groups, lowest, tier)
    select a.id, a.today, a.market_code, round(100 * a.pts / a.max_pts)::int,
           case when 100 * a.pts / a.max_pts >= 70 then 'good' when 100 * a.pts / a.max_pts >= (select health_threshold from crm.cs_settings s where s.market_code = a.market_code) then 'watch' else 'risk' end,
           a.groups, a.lowest, a.service_tier
      from agg a where a.max_pts > 0
    on conflict (account_id, as_of) do update set score = excluded.score, band = excluded.band, groups = excluded.groups, lowest = excluded.lowest, tier = excluded.tier, created_at = now()
    returning 1
  )
  select count(*)::int into n from ins;
  return n;
end $$;
revoke execute on function app.health_snapshot_run(text) from public;
grant execute on function app.health_snapshot_run(text) to contigo_app;