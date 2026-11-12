-- Leads sin dueño a la vista de quien vende (decisión de Yamil, 11-nov-2026).
-- Antes solo supervisión, líder de mercado y administración veían un lead sin dueño, así que "Tomar y llamar"
-- no existía para el vendedor. Ahora quien tiene rol de ventas en un mercado ve los leads sin dueño de ese mercado
-- y puede quedarse con uno. No puede editarlo sin tomarlo: la fila resultante tiene que ser suya.

create or replace function app.sell_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce((select array_agg(distinct market_code) from app.active_memberships() where role = 'rep'), '{}')
$$;
revoke execute on function app.sell_markets() from public;
grant execute on function app.sell_markets() to contigo_app;

drop policy leads_read on crm.leads;
create policy leads_read on crm.leads for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
  or owner_id = (select app.current_user_id())
  or (owner_id is null and market_code = any((select app.sell_markets())::text[]))
);

drop policy leads_upd on crm.leads;
create policy leads_upd on crm.leads for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
    or (owner_id is null and market_code = any((select app.sell_markets())::text[]))
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
  );
