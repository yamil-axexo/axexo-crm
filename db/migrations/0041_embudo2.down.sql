-- 0041_embudo2 (down)
drop trigger if exists saved_views_official on crm.saved_views;
drop function if exists app.saved_views_official();
drop index if exists crm.saved_views_official_idx;
alter table crm.saved_views drop column if exists official_role;

alter table crm.automations alter column owner_id drop not null;
drop trigger if exists automations_owner on crm.automations;
drop function if exists app.automations_owner();
drop function if exists app.default_automation_owner();
update crm.automations set owner_id = null where owner_review;
alter table crm.automations drop column if exists owner_review;

drop policy if exists activities_visibility on crm.activities;
drop trigger if exists activities_mark_corrected on crm.activities;
drop trigger if exists activities_no_delete on crm.activities;
drop trigger if exists activities_append_only on crm.activities;
drop function if exists app.activities_mark_corrected();
drop function if exists app.activities_no_delete();
drop function if exists app.activity_retention_apply();
drop function if exists app.activities_append_only();
alter table crm.activities drop column if exists corrected_at, drop column if exists corrects_id, drop column if exists visibility_class;

drop table if exists crm.routing_suggestions;
alter table crm.assignment_rules drop column if exists updated_by;
alter table crm.assignment_log drop column if exists account_id;

drop trigger if exists leads_sla_timer on crm.leads;
drop function if exists app.leads_sla_timer();
drop table if exists crm.sla_timers;
create or replace function app.business_due(p_market text, p_from timestamptz, p_minutes int) returns timestamptz
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  loc timestamp; day date; s timestamp; e timestamp;
  remaining numeric := greatest(coalesce(p_minutes, 60), 0);
  avail numeric; i int := 0;
begin
  select m.timezone into tz from crm.markets m where m.code = p_market;
  tz := coalesce(tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  loc := p_from at time zone tz;
  day := loc::date;
  while i < 370 loop
    if extract(isodow from day)::int = any(d) then
      s := greatest(loc, day + o);
      e := day + c;
      if s < e then
        avail := extract(epoch from (e - s)) / 60.0;
        if remaining <= avail then
          return (s + make_interval(secs => (remaining * 60)::double precision)) at time zone tz;
        end if;
        remaining := remaining - avail;
      end if;
    end if;
    day := day + 1;
    i := i + 1;
  end loop;
  return p_from + make_interval(mins => coalesce(p_minutes, 60));
end $$;
create or replace function app.business_minutes(p_market text, p_from timestamptz, p_to timestamptz) returns numeric
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  a timestamp; b timestamp; day date; s timestamp; e timestamp;
  total numeric := 0; i int := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then return 0; end if;
  select m.timezone into tz from crm.markets m where m.code = p_market;
  tz := coalesce(tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  a := p_from at time zone tz; b := p_to at time zone tz;
  day := a::date;
  while day <= b::date and i < 370 loop
    if extract(isodow from day)::int = any(d) then
      s := greatest(a, day + o);
      e := least(b, day + c);
      if s < e then total := total + extract(epoch from (e - s)) / 60.0; end if;
    end if;
    day := day + 1; i := i + 1;
  end loop;
  return total;
end $$;
drop function if exists app.business_due_tz(text, timestamptz, int, text);
drop function if exists app.business_minutes_tz(text, timestamptz, timestamptz, text);
alter table crm.leads drop column if exists timezone, drop column if exists first_contact_at;

alter table crm.stage_transitions drop column if exists pending_owner;
delete from crm.deal_evidence where url is null;
alter table crm.deal_evidence drop constraint if exists deal_evidence_what, drop column if exists storage_ref, drop column if exists content_hash, drop column if exists document_id;
alter table crm.deal_evidence alter column url set not null;

drop trigger if exists loss_reasons_cap on crm.loss_reasons;
drop function if exists app.loss_reasons_cap();
alter table crm.loss_reasons drop column if exists retired_by, drop column if exists retired_at;
grant delete on crm.loss_reasons to contigo_app;

update crm.automations set conditions = '[{"op":"eq","field":"stage_kind","value":"awaiting_txn"},{"op":"gt","field":"stage_age_days","value":7}]'::jsonb
 where key = 'activation_risk' and conditions = '[{"op":"eq","field":"stage_kind","value":"awaiting_txn"},{"op":"is_true","field":"over_stage_limit"}]'::jsonb;
update crm.automations set conditions = conditions - (select (i - 1)::int from jsonb_array_elements(conditions) with ordinality e(x, i) where x->>'field' = 'rotting' limit 1)
                                       || '[{"op":"is_true","field":"over_stage_limit"}]'::jsonb
 where conditions @> '[{"field":"rotting"}]'::jsonb;
alter table crm.stages drop column if exists rot_days_carrier, drop column if exists rot_days_customer;
update crm.deals set waiting_on = 'third_party' where waiting_on = 'carrier';
alter table crm.deals drop constraint if exists deals_waiting_on_check;
alter table crm.deals add constraint deals_waiting_on_check check (waiting_on is null or waiting_on in ('us','customer','third_party'));

drop trigger if exists deals_next_step_cap on crm.deals;
drop function if exists app.deals_next_step_cap();
delete from crm.exceptions where kind in ('lead_no_next_step','onboarding_no_next_step');
alter table crm.exceptions drop constraint if exists exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low'));

drop function if exists app.funnel_setting(text, text);
drop table if exists crm.funnel_settings;
