-- 0015_operations: pedidos con líneas, entrega de Ventas a Operaciones, cola de Operaciones, avisos y campos que Operaciones mantiene.

-- 1) Embudos de pedidos: un comercio puede tener varios negocios abiertos y el negocio lleva líneas de producto.
alter table crm.pipelines
  add column multi_open boolean not null default false,
  add column has_items  boolean not null default false;
update crm.pipelines set multi_open = true, has_items = true where motor = 'orders';

-- 2) Etapas de Operaciones: al entrar a una, el negocio pasa a la cola de Operaciones del mercado.
alter table crm.stages add column is_ops boolean not null default false;

-- 3) Catálogo simple de productos por mercado (lo mantiene administración). El precio va en la moneda del mercado.
alter table crm.products
  add column market_code      text references crm.markets(code),
  add column unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0);
create index products_market_idx on crm.products (market_code) where is_active;
create policy deal_items_del on crm.deal_items for delete to contigo_app
  using (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.deals d where d.id = deal_items.deal_id));
grant delete on crm.deal_items to contigo_app;

-- 4) El negocio tiene dos responsables: quien vende (owner_id) y quien lo lleva en Operaciones (ops_owner_id),
--    cada quien con su próximo paso. Capacitación: pendiente, agendada con fecha, hecha.
alter table crm.deals
  add column ops_owner_id      uuid references crm.users(id),
  add column ops_next_step     text,
  add column ops_next_step_due date,
  add column ops_entered_at    timestamptz,
  add column training_status   text not null default 'pending' check (training_status in ('pending','scheduled','done')),
  add column training_on       date,
  add constraint deals_training_dated check (training_status <> 'scheduled' or training_on is not null);
create index deals_ops_owner_idx on crm.deals (ops_owner_id) where status = 'open';

-- Merchant ID que Operaciones anota en la ficha (referencia operativa; no es un dato sensible).
alter table crm.accounts add column merchant_ref text check (merchant_ref is null or length(merchant_ref) between 1 and 40);

-- 5) El próximo paso de un negocio es una tarea de su responsable: así llega a Hoy. deal_step dice de cuál carril es.
alter table crm.activities add column deal_step text check (deal_step is null or deal_step in ('sales','ops'));
create index activities_deal_step_idx on crm.activities (deal_id, deal_step) where done_at is null and deal_step is not null;
-- Cómo terminó una tarea de Operaciones. El resultado general (outcome) queda en 'done': los resultados de ventas y de visita no cambian.
alter table crm.activities add column ops_outcome text
  check (ops_outcome is null or ops_outcome in ('docs_received','sent_provider','approved','rejected','training_done','waiting'));
-- Lo que ya existe: cada negocio abierto con próximo paso con fecha y sin tarea abierta recibe la suya.
insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, source, deal_step)
select d.market_code, d.account_id, d.id, 'task', d.next_step, (d.next_step_due::text || 'T15:00:00Z')::timestamptz, d.owner_id, d.owner_id, 'rule', 'sales'
  from crm.deals d
 where d.status = 'open' and d.next_step is not null and d.next_step_due is not null and d.owner_id is not null
   and not exists (select 1 from crm.activities a where a.deal_id = d.id and a.done_at is null and a.kind in ('task','call','meeting','visit','handoff'));

-- 6) Catálogos de Operaciones por mercado: proveedores (carriers), documentos requeridos y motivos de devolución.
create table crm.ops_catalog (
  id           uuid primary key default app.uuid_v7(),
  market_code  text references crm.markets(code),          -- nulo: vale en todos los mercados
  kind         text not null check (kind in ('provider','document','return_reason')),
  code         text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label_es     text not null check (length(label_es) between 2 and 80),
  label_en     text not null check (length(label_en) between 2 and 80),
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index ops_catalog_uq on crm.ops_catalog (coalesce(market_code, ''), kind, code);

-- Motivos de devolución de Operaciones a Ventas: valen en todos los mercados y administración los puede cambiar.
insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position) values
  (null, 'return_reason', 'docs_missing', 'Faltan documentos', 'Documents are missing', 1),
  (null, 'return_reason', 'data_incomplete', 'Datos incompletos o incorrectos', 'Details are incomplete or wrong', 2),
  (null, 'return_reason', 'not_signed', 'Falta la firma del comercio', 'The merchant has not signed', 3),
  (null, 'return_reason', 'other', 'Otro motivo', 'Another reason', 9);

-- Estado por negocio de cada proveedor (pendiente, enviada, aprobada, rechazada) y de cada documento (falta, recibido, validado).
-- Del documento se guarda dónde está (un enlace), nunca el archivo.
create table crm.deal_ops_checks (
  id           uuid primary key default app.uuid_v7(),
  deal_id      uuid not null references crm.deals(id),
  market_code  text not null references crm.markets(code),
  catalog_id   uuid not null references crm.ops_catalog(id),
  status       text not null check (status in ('pending','sent','approved','rejected','missing','received','validated')),
  on_date      date,
  link         text check (link is null or (link ~ '^https://' and length(link) <= 500)),
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  unique (deal_id, catalog_id)
);

-- 7) Avisos dentro de CONTIGO: alguien te avisó desde una nota, o Operaciones te devolvió un negocio.
create table crm.notices (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  user_id       uuid not null references crm.users(id),
  from_user_id  uuid not null references crm.users(id),
  kind          text not null check (kind in ('mention','returned')),
  account_id    uuid references crm.accounts(id),
  deal_id       uuid references crm.deals(id),
  activity_id   uuid references crm.activities(id),
  body          text not null check (length(body) between 1 and 600),
  seen_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index notices_user_idx on crm.notices (user_id, created_at desc) where seen_at is null;

-- Mercados donde la persona es de Operaciones (o administra).
create or replace function app.ops_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships() where role = 'ops'), '{}')
         end
$$;
grant execute on function app.ops_markets() to contigo_app;

do $$
declare t text;
begin
  foreach t in array array['ops_catalog','deal_ops_checks','notices'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
  end loop;
end $$;
grant select, insert, update on crm.ops_catalog, crm.deal_ops_checks, crm.notices to contigo_app;

create policy ops_catalog_read on crm.ops_catalog for select to contigo_app using ((select app.current_user_id()) is not null);
create policy ops_catalog_admin_ins on crm.ops_catalog for insert to contigo_app with check ((select app.is_admin()));
create policy ops_catalog_admin_upd on crm.ops_catalog for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy deal_ops_checks_read on crm.deal_ops_checks for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_ops_checks.deal_id));
create policy deal_ops_checks_ins on crm.deal_ops_checks for insert to contigo_app
  with check (market_code = any((select app.ops_markets())::text[])
              and exists (select 1 from crm.deals d where d.id = deal_ops_checks.deal_id and d.market_code = deal_ops_checks.market_code));
create policy deal_ops_checks_upd on crm.deal_ops_checks for update to contigo_app
  using (market_code = any((select app.ops_markets())::text[]))
  with check (market_code = any((select app.ops_markets())::text[]));

create policy notices_read on crm.notices for select to contigo_app
  using (user_id = (select app.current_user_id()) or from_user_id = (select app.current_user_id()));
create policy notices_ins on crm.notices for insert to contigo_app
  with check (from_user_id = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[]));
create policy notices_upd on crm.notices for update to contigo_app
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));

-- 8) Separación de funciones, segunda barrera: dentro de las etapas de Operaciones solo avanza Operaciones (o administración),
--    y nunca quien vendió el negocio. Perder el negocio o regresarlo a Ventas no es avanzar.
create or replace function app.deals_ops_guard() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare
  v_uid uuid := app.current_user_id();
  v_from int; v_to int; v_kind text; v_pipe uuid;
begin
  -- Sin identidad (migraciones) o con rol de administración (importación, integraciones de sistema) no aplica: la regla es para quien vende.
  if new.stage_id is not distinct from old.stage_id or v_uid is null or app.is_admin() then return new; end if;
  select position, pipeline_id into v_from, v_pipe from crm.stages where id = old.stage_id;
  select position, kind into v_to, v_kind from crm.stages where id = new.stage_id;
  if v_kind = 'lost' or v_to <= v_from then return new; end if;
  if exists (select 1 from crm.stages s where s.pipeline_id = v_pipe and s.is_ops and s.position >= v_from and s.position < v_to) then
    if v_uid = old.owner_id or not (old.market_code = any(app.ops_markets())) then
      raise exception 'only Operations moves a deal forward inside Operations stages' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger deals_ops_guard before update of stage_id on crm.deals for each row execute function app.deals_ops_guard();

-- Las tareas pendientes de Operaciones también se asignan a quien no es dueño del comercio: la política de actividades ya lo permite
-- (mercado propio y registro visible). Los negocios se actualizan con la política existente (Operaciones ve todo su mercado).
