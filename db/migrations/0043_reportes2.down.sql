-- quality_measure vuelve a su versión anterior (sin la regla s5_diff).
CREATE OR REPLACE FUNCTION app.quality_measure()
 RETURNS TABLE(market_code text, team_id uuid, rule_code text, total integer, failing integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'crm', 'app', 'public', 'pg_catalog'
AS $function$
  with acct as (
    select a.id, a.market_code, a.kind, a.owner_id, a.parent_id, a.phone, a.address_line, a.locality, a.latitude, a.lifecycle, a.merchant_ref, a.updated_at,
           app.user_team(a.owner_id, a.market_code) as team_id
      from crm.accounts a where a.archived_at is null
  ), cfg as (
    select coalesce((select threshold from crm.quality_rules where code = 'stale'), 180) as stale_days
  )
  select x.market_code, x.team_id, 'no_owner', count(*)::int, (count(*) filter (where x.owner_id is null and x.parent_id is null))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_phone', count(*)::int, (count(*) filter (where x.phone is null))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_contact', count(*)::int,
         (count(*) filter (where not exists (select 1 from crm.account_contacts ac where ac.account_id = x.id and ac.valid_to is null)))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_address', count(*)::int, (count(*) filter (where x.address_line is null or x.locality is null))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_coords', count(*)::int, (count(*) filter (where x.latitude is null))::int from acct x where x.kind = 'store' group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_alias', count(*)::int,
         (count(*) filter (where x.merchant_ref is null and not exists (select 1 from crm.account_aliases al where al.account_id = x.id and al.valid_to is null)))::int
    from acct x where x.lifecycle <> 'prospect' group by 1, 2
  union all
  select x.market_code, x.team_id, 'stale', count(*)::int,
         (count(*) filter (where x.updated_at < now() - make_interval(days => cfg.stale_days)
            and not exists (select 1 from crm.activities ac where ac.account_id = x.id and ac.created_at > now() - make_interval(days => cfg.stale_days))
            and not exists (select 1 from crm.visits v where v.account_id = x.id and v.checked_in_at > now() - make_interval(days => cfg.stale_days))))::int
    from acct x cross join cfg group by 1, 2
  union all
  select mk.code, null::uuid, 'duplicate', (select count(*)::int from acct x where x.market_code = mk.code),
         (select count(*)::int from crm.duplicate_pairs p where p.market_code = mk.code and p.status = 'open')
    from crm.markets mk where mk.status = 'live' and mk.code = any(app.my_markets())
  union all
  select b.market_code, app.user_team(b.actor_id, b.market_code), 'bypass', count(*)::int, (count(*) filter (where b.reviewed_at is null))::int
    from crm.duplicate_bypasses b group by 1, 2
  union all
  select d.market_code, app.user_team(d.owner_id, d.market_code), 'deal_no_step', count(*)::int, (count(*) filter (where d.next_step is null or d.next_step_due is null))::int
    from crm.deals d where d.status = 'open' group by 1, 2
  union all
  select p.market_code, null::uuid, 'provider_late', count(*)::int,
         (count(*) filter (where k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days)))::int
    from crm.account_products p left join crm.ops_catalog k on k.id = p.provider_id where p.status = 'submitted' group by 1
  union all
  select d.market_code, app.user_team(d.owner_id, d.market_code), 'stage_fields', count(*)::int,
         (count(*) filter (where exists (select 1 from crm.stages st, unnest(st.required_fields) tk where st.id = d.stage_id and tk like 'field:%' and not (d.custom ? substr(tk, 7)))))::int
    from crm.deals d where d.status = 'open' group by 1, 2
  union all
  select x.market_code, x.team_id, 'attribution_gap', count(*)::int,
         (count(*) filter (where not exists (select 1 from crm.account_attributions t where t.account_id = x.id and t.layer = 'owner' and t.effective_to is null and t.party_ref = x.owner_id::text)))::int
    from acct x where x.owner_id is not null group by 1, 2
  union all
  select mk.code, null::uuid, 'sales_unmatched', (select count(*)::int from crm.exceptions e where e.market_code = mk.code and e.kind = 'unmatched_event'),
         (select count(*)::int from crm.exceptions e where e.market_code = mk.code and e.kind = 'unmatched_event' and e.resolved_at is null)
    from crm.markets mk where mk.status = 'live' and mk.code = any(app.my_markets())
  union all
  select mk.code, null::uuid, 'field_review', count(f.id)::int,
         (count(f.id) filter (where f.decision is null or f.owner_id is null or f.review_on is null or f.review_on < (now() at time zone mk.timezone)::date))::int
    from crm.markets mk join crm.field_definitions f on f.is_active and (f.market_code is null or f.market_code = mk.code)
   where mk.status = 'live' and mk.code = any(app.my_markets()) group by mk.code
$function$;
delete from crm.quality_snapshots where rule_code = 's5_diff';
delete from crm.quality_rules where code = 's5_diff';
-- 0043 reportes2: vuelve todo a como lo dejó 0042 (funciones con su definición anterior).
delete from crm.settings where key in ('ingest.require_manifest','snapshots.window_days','quality.exception_rules','adoption.rollout_rule','orders.brand');
delete from crm.saved_views where object = 'contact';
alter table crm.saved_views drop constraint saved_views_object_check;
alter table crm.saved_views add constraint saved_views_object_check check (object = any (array['account','lead','deal','activity']));
drop table crm.user_aliases;
drop table crm.one_on_ones;
update crm.exceptions set resolved_at = coalesce(resolved_at, now()), resolution = coalesce(resolution, 'rollback') where kind = 'data_quality';
delete from crm.exceptions where kind = 'data_quality';
alter table crm.exceptions drop constraint exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind = any (array['lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk','reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low']));
drop function app.prune_report_snapshots(int);
drop function app.take_team_snapshots();
drop index crm.pipeline_snapshots_date_idx; drop index crm.portfolio_snapshots_date_idx;
alter table crm.pipeline_snapshots drop column exported_at; alter table crm.portfolio_snapshots drop column exported_at;
drop table crm.team_snapshots;
alter table crm.merchant_metrics_daily drop column tpv_by_product, drop column commission_minor_30d;
drop table crm.forecast_submissions; drop table crm.deal_forecast; drop table crm.role_boards;
drop function app.ai_action_costs(date, date);
drop policy cost_entries_finance_read on crm.cost_entries;
CREATE OR REPLACE FUNCTION app.cost_denominators(p_month date)
 RETURNS TABLE(active_people integer, managed_accounts integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'crm', 'app'
AS $function$
  select
    case when (select app.is_global()) then (
      select count(distinct e.actor_id)::int from crm.audit_events e join crm.users u on u.id = e.actor_id
       where e.action = 'session.started' and not u.is_system
         and e.at >= p_month::timestamptz and e.at < (p_month + interval '1 month')::timestamptz) end,
    case when (select app.is_global()) then (
      select count(*)::int from crm.accounts a
       where a.owner_id is not null and a.merged_into is null
         and a.created_at < (p_month + interval '1 month')::timestamptz
         and (a.archived_at is null or a.archived_at >= (p_month + interval '1 month')::timestamptz)) end
$function$

;
CREATE OR REPLACE FUNCTION app.works_in(p_user uuid, p_market text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'crm', 'app', 'pg_catalog'
AS $function$
  select exists (
    select 1 from crm.users u
      join crm.memberships m on m.user_id = u.id
     where u.id = p_user and u.is_active and not u.is_system
       and (m.role = 'admin' or (m.market_code = p_market and m.role in ('rep','supervisor','market_lead','ops')))
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$function$

;
CREATE OR REPLACE FUNCTION app.can_sell_in(p_user uuid, p_market text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'crm', 'app', 'pg_catalog'
AS $function$
  select exists (
    select 1 from crm.users u
      join crm.memberships m on m.user_id = u.id
     where u.id = p_user and u.is_active and not u.is_system
       and m.market_code = p_market and m.role in ('rep','supervisor','market_lead')
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$function$

;
CREATE OR REPLACE FUNCTION app.sell_markets()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'crm', 'app', 'pg_catalog'
AS $function$
  select coalesce((select array_agg(distinct market_code) from app.active_memberships() where role = 'rep'), '{}')
$function$

;
CREATE OR REPLACE FUNCTION app.write_markets()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'crm', 'app', 'pg_catalog'
AS $function$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','supervisor','rep','ops','agency')), '{}')
         end
$function$

;
CREATE OR REPLACE FUNCTION app.owner_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  select array['rep','supervisor','market_lead','ops','agency']::text[]
$function$

;
CREATE OR REPLACE FUNCTION app.full_markets()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'crm', 'app', 'pg_catalog'
AS $function$
  select case when app.is_global()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','ops')), '{}')
         end
$function$

;
drop function app.is_finance();
delete from crm.memberships where role in ('finance','kam');
alter table crm.memberships drop constraint memberships_role_check;
alter table crm.memberships add constraint memberships_role_check check (role in ('admin','lt','market_lead','supervisor','rep','ops','agency','partner'));
