

-- Integración de la ola 4: una sola app.people_with_role. Antes había dos (automatizaciones: un rol y una persona de
-- referencia; avisos: varios roles). Esta hace las dos cosas: varios roles; con 'supervisor' entre ellos y una persona de
-- referencia, primero quienes supervisan su equipo. La administración global entra cuando se pide el rol 'admin'.
drop function app.people_with_role(text, text, uuid);
drop function app.people_with_role(text, text[]);
create function app.people_with_role(p_market text, p_roles text[], p_for uuid default null) returns table (user_id uuid)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with valid as (
    select m.user_id, m.role, m.team_id
      from crm.memberships m join crm.users u on u.id = m.user_id
     where u.is_active and not u.is_system and (select app.current_user_id()) is not null
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       and (m.market_code = p_market or (m.market_code is null and (p_market is null or m.role = 'admin')))
  ),
  team as (
    select distinct v.user_id from valid v
     where 'supervisor' = any(p_roles) and v.role = 'supervisor' and p_for is not null
       and v.team_id in (select x.team_id from valid x where x.user_id = p_for and x.team_id is not null)
  )
  select t.user_id from team t
  union
  select distinct v.user_id from valid v where v.role = any(p_roles) and not exists (select 1 from team)
$$;
revoke execute on function app.people_with_role(text, text[], uuid) from public;
grant execute on function app.people_with_role(text, text[], uuid) to contigo_app;
