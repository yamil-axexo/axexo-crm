drop function if exists app.people_with_role(text, text[], uuid);
create or replace function app.people_with_role(p_market text, p_role text, p_for uuid) returns setof uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with valid as (
    select m.user_id, m.role, m.market_code, m.team_id
      from crm.memberships m join crm.users u on u.id = m.user_id
     where u.is_active and not u.is_system and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       and (m.market_code = p_market or (m.market_code is null and m.role = 'admin'))
  ),
  team as (
    select distinct v.user_id from valid v
     where p_role = 'supervisor' and v.role = 'supervisor' and p_for is not null
       and v.team_id in (select x.team_id from valid x where x.user_id = p_for and x.team_id is not null)
  )
  select user_id from team
  union
  select distinct v.user_id from valid v where v.role = p_role and not exists (select 1 from team)
$$;
revoke execute on function app.people_with_role(text, text, uuid) from public;
grant execute on function app.people_with_role(text, text, uuid) to contigo_app;
create or replace function app.people_with_role(p_market text, p_roles text[]) returns table (user_id uuid)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select distinct u.id from crm.users u join crm.memberships m on m.user_id = u.id
   where u.is_active and not u.is_system and (select app.current_user_id()) is not null
     and m.role = any(p_roles) and (m.market_code = p_market or (m.market_code is null and p_market is null))
     and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
$$;
grant execute on function app.people_with_role(text, text[]) to contigo_app;
alter table crm.market_comms
  add column whatsapp_daily_limit int check (whatsapp_daily_limit is null or whatsapp_daily_limit between 0 and 1000000),
  add column whatsapp_unit_cost numeric(12,4) check (whatsapp_unit_cost is null or whatsapp_unit_cost >= 0);
-- 0034_ia (down): quita la asistencia por reglas y el marco de AI. Las tareas que se crearon al aceptar sugerencias o aprobar
-- borradores son actividades normales y se quedan.
drop table if exists crm.ia_eval_runs;
drop table if exists crm.ia_eval_cases;
drop table if exists crm.ia_calls;
drop table if exists crm.ia_drafts;
drop table if exists crm.lead_classifications;
drop table if exists crm.lead_score_weights;
drop trigger if exists recommendations_cap on crm.recommendations;
drop table if exists crm.recommendations;
drop function if exists crm.recommendations_cap();
drop table if exists crm.ia_holdouts;
drop table if exists crm.ia_settings;
