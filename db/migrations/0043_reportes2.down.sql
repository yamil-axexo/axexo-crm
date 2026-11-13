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
