-- 0024_us_enrollment: alta de dealers de US (E10), pedidos (E11) y visitas con propósito (E12).

-- 1) Campo destacado por etapa (E10.F7): lo que conviene llenar al estar en la etapa, sin que sea requisito para entrar.
--    Mismo vocabulario que required_fields: 'amount', 'decision_maker', 'next_step', 'items' o 'field:<clave>'.
alter table crm.stages add column highlight_fields text[] not null default '{}';

-- 2) Quién vendió (E10.F11): sigue a quien lleva el negocio hasta que entra a una etapa de Operaciones; desde ahí queda fijo.
--    Líder de Operaciones del embudo (E10.F10): recibe el negocio al entrar a Operaciones si nadie lo ha tomado.
alter table crm.deals
  add column sales_rep_id        uuid references crm.users(id),
  add column sales_rep_frozen_at timestamptz;
alter table crm.pipelines add column ops_lead_id uuid references crm.users(id);

-- Lo que ya está (o estuvo) con Operaciones queda con quien lo llevaba al entregar.
update crm.deals set sales_rep_id = owner_id, sales_rep_frozen_at = coalesce(ops_entered_at, now())
 where ops_entered_at is not null and owner_id is not null;

-- La base repite la regla en todo camino (mover, importar, integración): al entrar a una etapa de Operaciones se fija
-- quién vendió, y una vez fijo no cambia aunque el negocio se reasigne.
create or replace function app.deals_sales_rep() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and old.sales_rep_frozen_at is not null then
    if new.sales_rep_id is distinct from old.sales_rep_id or new.sales_rep_frozen_at is distinct from old.sales_rep_frozen_at then
      raise exception 'the sales rep of a deal is fixed once it reaches Operations' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.owner_id is not null and exists (select 1 from crm.stages s where s.id = new.stage_id and s.is_ops) then
    new.sales_rep_id := new.owner_id;
    new.sales_rep_frozen_at := now();
  else
    new.sales_rep_id := null;
    new.sales_rep_frozen_at := null;
  end if;
  return new;
end $$;
create trigger deals_sales_rep before insert or update on crm.deals for each row execute function app.deals_sales_rep();

-- 3) Pedido (E11.F1): descuento por línea y los datos de envío del pedido.
alter table crm.deal_items add column discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100);

create table crm.deal_orders (
  deal_id          uuid primary key references crm.deals(id),
  market_code      text not null references crm.markets(code),
  carrier          text not null default 'FedEx' check (length(carrier) between 1 and 60),
  customer_number  text check (customer_number is null or length(customer_number) <= 40),
  due_on           date,
  po_number        text check (po_number is null or length(po_number) <= 40),
  ship_to          text check (ship_to is null or length(ship_to) <= 400),
  terms            text check (terms is null or length(terms) <= 120),
  description      text check (description is null or length(description) <= 1000),
  updated_by       uuid references crm.users(id),
  updated_at       timestamptz not null default now()
);
alter table crm.deal_orders enable row level security;
alter table crm.deal_orders force row level security;   -- AUTHZ-03
grant select, insert, update on crm.deal_orders to contigo_app;
create policy deal_orders_read on crm.deal_orders for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_orders.deal_id));
create policy deal_orders_ins on crm.deal_orders for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.deals d where d.id = deal_orders.deal_id and d.market_code = deal_orders.market_code));
create policy deal_orders_upd on crm.deal_orders for update to contigo_app
  using (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.deals d where d.id = deal_orders.deal_id))
  with check (market_code = any((select app.write_markets())::text[]));

-- 4) Propósito de la visita (E12.F1, E12.F4): catálogo por mercado que mantiene administración, con los de campaña marcados.
create table crm.visit_reasons (
  id           uuid primary key default app.uuid_v7(),
  market_code  text references crm.markets(code),
  code         text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es     text not null check (length(label_es) between 2 and 80),
  label_en     text not null check (length(label_en) between 2 and 80),
  is_campaign  boolean not null default false,
  is_active    boolean not null default true,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create unique index visit_reasons_uq on crm.visit_reasons (coalesce(market_code, ''), code);
alter table crm.visit_reasons enable row level security;
alter table crm.visit_reasons force row level security;   -- AUTHZ-03
grant select, insert, update on crm.visit_reasons to contigo_app;
create policy visit_reasons_read on crm.visit_reasons for select to contigo_app using ((select app.current_user_id()) is not null);
create policy visit_reasons_admin_ins on crm.visit_reasons for insert to contigo_app with check ((select app.is_admin()));
create policy visit_reasons_admin_upd on crm.visit_reasons for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

alter table crm.activities add column visit_reason text;
create index activities_visit_reason_idx on crm.activities (market_code, visit_reason) where visit_reason is not null;

-- Lista inicial para US: ocho propósitos de la práctica de campo, uno de campaña. Administración la ajusta desde la pantalla.
insert into crm.visit_reasons (market_code, code, label_es, label_en, is_campaign, position)
select 'US', v.code, v.es, v.en, v.camp, v.pos from (values
  ('prospecting', 'Prospección o primera visita', 'Prospecting or first visit', false, 1),
  ('follow_up', 'Seguimiento', 'Follow-up', false, 2),
  ('documents', 'Documentos y contrato', 'Documents and contract', false, 3),
  ('training', 'Capacitación', 'Training', false, 4),
  ('delivery', 'Entrega de material o producto', 'Material or product drop-off', false, 5),
  ('support', 'Soporte o problema del comercio', 'Support or store issue', false, 6),
  ('campaign', 'Campaña o promoción', 'Campaign or promotion', true, 7),
  ('relationship', 'Visita de relación', 'Relationship visit', false, 8)
) v(code, es, en, camp, pos)
where exists (select 1 from crm.markets m where m.code = 'US');

-- 5) Motivos de devolución de Operaciones a Ventas en US (E10.F13): la lista son seis. Un motivo del mercado con el mismo
--    código que uno general lo reemplaza en ese mercado (y, si está inactivo, lo esconde ahí).
insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position, is_active)
select 'US', 'return_reason', v.code, v.es, v.en, v.pos, v.active from (values
  ('docs_missing', 'Faltan documentos', 'Documents missing', 1, true),
  ('not_signed', 'Contrato sin firmar', 'Contract not signed', 2, true),
  ('entity_mismatch', 'Los datos de la entidad no coinciden', 'Entity details mismatch', 3, true),
  ('duplicate_merchant', 'Comercio duplicado', 'Duplicate merchant', 4, true),
  ('merchant_withdrew', 'El comercio desistió', 'Merchant withdrew', 5, true),
  ('docs_expired', 'Documentos vencidos', 'Documents expired', 6, true),
  ('data_incomplete', 'Datos incompletos o incorrectos', 'Details are incomplete or wrong', 7, false),
  ('other', 'Otro motivo', 'Another reason', 9, false)
) v(code, es, en, pos, active)
where exists (select 1 from crm.markets m where m.code = 'US')
on conflict do nothing;

-- 6) Lista de documentos legales del alta en US (E10.F14): se lleva el estado y dónde está cada uno, nunca el documento.
insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position)
select 'US', 'document', v.code, v.es, v.en, v.pos from (values
  ('sellers_permit', 'Permiso de vendedor (seller''s permit)', 'Seller''s permit', 11),
  ('drivers_license', 'Licencia de conducir', 'Driver''s license', 12),
  ('voided_check', 'Cheque anulado', 'Voided check', 13),
  ('premises_photo', 'Foto del local', 'Premises photo', 14)
) v(code, es, en, pos)
where exists (select 1 from crm.markets m where m.code = 'US')
on conflict do nothing;
