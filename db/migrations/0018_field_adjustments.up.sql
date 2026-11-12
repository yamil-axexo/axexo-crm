-- 0018_field_adjustments: ajustes de la ronda de aceptación (ola 4, paquete ajustes-campo).
--
-- 1) Catálogo de vendedores de calle por mercado y equipo (E16.F3). No son usuarios: supervisión y quien lidera los dan de
--    alta, de baja y dicen a qué persona de ventas responden. El campo "¿Quién visitó?" sugiere primero los del catálogo.
-- 2) Motivo de una visita sin venta (catálogo de motivos de calle, kind = 'no_sale').
-- 3) Índice para buscar un Merchant ID dentro del mercado (aviso de duplicado).
-- 4) Los motivos de pérdida de calle que agregó 0016 son de México: en otros mercados quedan los generales.
-- 5) La lista de alta de Operaciones (documentos, proveedores, capacitación) aplica por embudo.

-- ---------------------------------------------------------------- 1) vendedores de calle
create table crm.street_sellers (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  team_id      uuid references crm.teams(id),
  name         text not null check (char_length(btrim(name)) between 2 and 80 and name !~ '[0-9]'),
  reports_to   uuid references crm.users(id),          -- la persona de ventas que lleva la cartera donde trabaja
  is_active    boolean not null default true,
  created_by   uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  constraint street_sellers_ended check (is_active = (ended_at is null))
);
create unique index street_sellers_name_idx on crm.street_sellers (market_code, lower(btrim(name))) where is_active;
create index street_sellers_reports_idx on crm.street_sellers (reports_to) where is_active;

-- Quién mantiene el catálogo: administración, quien lidera el mercado y supervisión (solo en su equipo).
create function app.can_manage_street(p_market text, p_team uuid) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.is_admin() or exists (
    select 1 from app.active_memberships() m
     where m.market_code = p_market
       and (m.role = 'market_lead' or (m.role = 'supervisor' and (m.team_id is null or m.team_id = p_team))))
$$;
revoke execute on function app.can_manage_street(text, uuid) from public;
grant execute on function app.can_manage_street(text, uuid) to contigo_app;

alter table crm.street_sellers enable row level security;
alter table crm.street_sellers force row level security;   -- AUTHZ-03
revoke all on crm.street_sellers from contigo_app;
grant select, insert on crm.street_sellers to contigo_app;
grant update (team_id, reports_to, is_active, ended_at) on crm.street_sellers to contigo_app;   -- el nombre no se edita: baja y alta nueva
create policy street_sellers_read on crm.street_sellers for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]));
create policy street_sellers_ins on crm.street_sellers for insert to contigo_app
  with check ((select app.can_manage_street(market_code, team_id)) and created_by = (select app.current_user_id()));
create policy street_sellers_upd on crm.street_sellers for update to contigo_app
  using ((select app.can_manage_street(market_code, team_id)))
  with check ((select app.can_manage_street(market_code, team_id)));

-- Sugerencias de "¿Quién visitó?": primero el catálogo vigente (en orden alfabético), después los nombres ya usados.
create or replace function app.visitor_names(p_market text) returns table (name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select name from (
    select s.name, 0 as grp, null::timestamptz as last
      from crm.street_sellers s
     where p_market = any(app.my_markets()) and s.market_code = p_market and s.is_active
    union all
    select x.visited_by, 1, max(x.created_at)
      from crm.activities x
     where p_market = any(app.my_markets()) and x.market_code = p_market and x.visited_by is not null
       and not exists (select 1 from crm.street_sellers s where s.market_code = p_market and s.is_active and lower(btrim(s.name)) = lower(btrim(x.visited_by)))
     group by x.visited_by
  ) n
  order by grp, last desc nulls last, name
  limit 60
$$;

-- ---------------------------------------------------------------- 2) motivo de la visita sin venta
alter table crm.activities add column no_sale_code text references crm.loss_reasons(code);
alter table crm.activities add constraint activities_no_sale_code_check
  check (no_sale_code is null or (kind = 'visit' and outcome = 'no_sale'));

-- ---------------------------------------------------------------- 3) Merchant ID
create index accounts_merchant_ref_idx on crm.accounts (market_code, upper(btrim(merchant_ref))) where merchant_ref is not null;

-- ---------------------------------------------------------------- 4) motivos de pérdida de calle: de México
update crm.loss_reasons set market_code = 'MX'
 where code in ('store_closed_down','store_no_interest','signup_blocked','other_provider','no_cash_handling','landline_only','product_not_offered','owner_unavailable')
   and market_code is null and exists (select 1 from crm.markets where code = 'MX');

-- ---------------------------------------------------------------- 5) lista de alta por embudo
-- Un embudo de pedidos o de recompra (varios abiertos a la vez) no es un alta: su negocio no lleva documentos, proveedores ni capacitación.
alter table crm.pipelines add column ops_checklist boolean not null default true;
update crm.pipelines set ops_checklist = false where multi_open;
