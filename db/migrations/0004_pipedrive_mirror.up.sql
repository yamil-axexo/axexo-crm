-- 0004_pipedrive_mirror: lo que hace falta para reemplazar Pipedrive con sus propios datos.
-- 1) Datos de referencia que antes solo vivían en el seed sintético (mercados, motivos base).
-- 2) Configuración espejo: varios pipelines por mercado, cierre por transacción por pipeline, registro de campos ampliado.
-- 3) Zona de aterrizaje de la importación (corridas, datos crudos ya depurados, referencias externas).
-- 4) Productos y partidas de deal (pipeline de pedidos).
-- Reglas del estándar: DATA-06, DATA-08, AUTHZ-03, AUTHZ-05, REL-07, PORT-03.

-- ---------------------------------------------------------------- datos de referencia
insert into crm.markets (code, name, currency, default_locale, locales, timezone, phone_cc, status, flags) values
  ('MX', 'México', 'MXN', 'es', '{es}', 'America/Mexico_City', '+52', 'live', '{}'),
  ('US', 'United States', 'USD', 'en', '{en,es}', 'America/New_York', '+1', 'live', '{}'),
  ('SV', 'El Salvador', 'USD', 'es', '{es}', 'America/El_Salvador', '+503', 'planned', '{}')
on conflict (code) do nothing;

insert into crm.loss_reasons (code, kind, label_es, label_en) values
  ('price', 'lost', 'Precio o comisión', 'Price or commission'),
  ('competitor', 'lost', 'Se fue con un competidor', 'Chose a competitor'),
  ('no_decision', 'lost', 'Sin decisión', 'No decision'),
  ('not_qualified', 'lost', 'No califica', 'Not qualified'),
  ('duplicate', 'lost', 'Duplicado', 'Duplicate'),
  ('no_response', 'lost', 'No responde', 'No response'),
  ('owner_absent', 'no_sale', 'No estaba el decisor', 'Decision-maker absent'),
  ('no_cash', 'no_sale', 'Sin efectivo hoy', 'No cash today'),
  ('has_stock', 'no_sale', 'Tiene inventario', 'Has stock'),
  ('not_interested', 'no_sale', 'No le interesa', 'Not interested'),
  ('closed', 'no_sale', 'Tienda cerrada', 'Store closed')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- embudos
-- Un mercado puede tener varios pipelines del mismo motor (por ejemplo, un evento y el alta regular).
alter table crm.pipelines drop constraint if exists pipelines_market_code_motor_key;
alter table crm.pipelines
  add column close_by_transaction boolean not null default true,   -- PIPE-06 por pipeline: un pedido no espera una primera transacción
  add column is_active boolean not null default true;
update crm.pipelines p set close_by_transaction = coalesce((m.flags ->> 'close_by_transaction')::boolean, true)
  from crm.markets m where m.code = p.market_code;

-- ---------------------------------------------------------------- registro de campos (DATA-08)
alter table crm.field_definitions drop constraint field_definitions_object_check;
alter table crm.field_definitions add constraint field_definitions_object_check
  check (object in ('account','deal','lead','contact','activity','product'));
alter table crm.field_definitions drop constraint field_definitions_data_type_check;
alter table crm.field_definitions add constraint field_definitions_data_type_check
  check (data_type in ('text','long_text','number','date','boolean','select','multiselect','money','user','phone'));
alter table crm.field_definitions drop constraint field_definitions_key_check;
alter table crm.field_definitions add constraint field_definitions_key_check check (key ~ '^[a-z][a-z0-9_]{1,60}$');
alter table crm.field_definitions
  add column position      int  not null default 0,
  add column source        text not null default 'manual' check (source in ('manual','pipedrive')),
  add column external_ref  text,          -- llave del campo en el sistema de origen
  add column mapped_to     text;          -- a dónde va el valor: null = custom; 'core:<columna>'; 'policy:<regla>'; 'skip'
create unique index field_definitions_external_uq on crm.field_definitions (source, object, external_ref) where external_ref is not null;

alter table crm.contacts
  add column custom   jsonb not null default '{}'::jsonb,
  add column owner_id uuid references crm.users(id);
alter table crm.leads
  add column custom jsonb not null default '{}'::jsonb;
alter table crm.activities
  add column custom     jsonb not null default '{}'::jsonb,
  add column type_label text;            -- tipo original cuando viene de otro sistema (Visit, Deadline, Portal Migration...)

-- ---------------------------------------------------------------- productos y partidas
create table crm.products (
  id           uuid primary key default app.uuid_v7(),
  name         text not null,
  code         text,
  unit         text,
  category     text,
  description  text,
  prices       jsonb not null default '[]'::jsonb,     -- [{currency, price_minor}]
  custom       jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table crm.deal_items (
  id                uuid primary key default app.uuid_v7(),
  deal_id           uuid not null references crm.deals(id),
  market_code       text not null references crm.markets(code),
  product_id        uuid references crm.products(id),
  name              text not null,
  quantity          numeric(14,3) not null default 1,
  unit_price_minor  bigint,
  sum_minor         bigint,
  currency          char(3) not null,
  discount          numeric(14,3),
  discount_type     text,
  comments          text,
  position          int not null default 0,
  created_at        timestamptz not null default now()
);
create index deal_items_deal_idx on crm.deal_items (deal_id, position);

-- ---------------------------------------------------------------- importación
-- Referencia entre el ID de origen y el ID canónico. Las cuentas usan account_aliases (DAT-03); todo lo demás vive aquí.
create table crm.external_refs (
  system       text not null,
  object       text not null,
  external_id  text not null,
  internal_id  uuid not null,
  created_at   timestamptz not null default now(),
  primary key (system, object, external_id)
);
create index external_refs_internal_idx on crm.external_refs (internal_id);

create table crm.import_runs (
  id           uuid primary key default app.uuid_v7(),
  source       text not null check (source in ('pipedrive')),
  status       text not null default 'running' check (status in ('running','done','failed','cancelled')),
  phase        text not null,
  cursor       jsonb not null default '{}'::jsonb,     -- posición dentro de la fase (reanudable)
  stats        jsonb not null default '{}'::jsonb,     -- conteos por objeto
  issues       jsonb not null default '[]'::jsonb,     -- avisos sin datos personales
  started_by   uuid references crm.users(id),
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create unique index import_runs_one_active on crm.import_runs (source) where status = 'running';

-- Copia cruda de lo que entrega el sistema de origen, ya sin los datos que el estándar prohíbe guardar (DATA-06).
-- Sirve para volver a correr el mapeo sin volver a llamar a la API. Se vacía cuando la migración queda aceptada.
create table crm.import_raw (
  source       text not null,
  object       text not null,
  external_id  text not null,
  parent_ref   text,                                   -- organización ligada, para resolver mercado sin recorrer todo
  payload      jsonb not null,
  fetched_at   timestamptz not null default now(),
  loaded_at    timestamptz,
  load_note    text,
  primary key (source, object, external_id)
);
create index import_raw_parent_idx on crm.import_raw (source, object, parent_ref);
create index import_raw_pending_idx on crm.import_raw (source, object, external_id) where loaded_at is null;

-- ---------------------------------------------------------------- RLS y privilegios de lo nuevo
do $$
declare t text;
begin
  foreach t in array array['products','deal_items','external_refs','import_runs','import_raw'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
  end loop;
end $$;

create policy products_read on crm.products for select to contigo_app using ((select app.current_user_id()) is not null);
create policy products_admin_ins on crm.products for insert to contigo_app with check ((select app.is_admin()));
create policy products_admin_upd on crm.products for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy deal_items_read on crm.deal_items for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_items.deal_id));
create policy deal_items_ins on crm.deal_items for insert to contigo_app
  with check (exists (select 1 from crm.deals d where d.id = deal_items.deal_id));
create policy deal_items_upd on crm.deal_items for update to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_items.deal_id))
  with check (exists (select 1 from crm.deals d where d.id = deal_items.deal_id));
create policy deal_items_writers_ins on crm.deal_items as restrictive for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));
create policy deal_items_writers_upd on crm.deal_items as restrictive for update to contigo_app
  using (true) with check (market_code = any((select app.write_markets())::text[]));

do $$
declare t text;
begin
  foreach t in array array['external_refs','import_runs','import_raw'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using ((select app.is_admin()))', t || '_admin_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_upd', t);
  end loop;
end $$;
create policy import_raw_admin_del on crm.import_raw for delete to contigo_app using ((select app.is_admin()));

grant select, insert, update on crm.products, crm.deal_items, crm.external_refs, crm.import_runs, crm.import_raw to contigo_app;
grant delete on crm.import_raw to contigo_app;      -- la zona cruda sí se vacía; no es una tabla de negocio

-- ---------------------------------------------------------------- identidad
-- Quien está en BOOTSTRAP_ADMIN_EMAILS queda como admin aunque la importación haya creado antes su usuario.
create or replace function app.sso_user(p_email text, p_subject text, p_name text, p_bootstrap_admin boolean)
returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_id uuid;
begin
  select id into v_id from crm.users where email = p_email::citext and is_active and not is_system;
  if v_id is null and p_bootstrap_admin then
    insert into crm.users (email, full_name, locale) values (p_email, coalesce(nullif(p_name, ''), p_email), 'es')
    returning id into v_id;
  end if;
  if v_id is not null and p_bootstrap_admin and not exists (
       select 1 from crm.memberships m where m.user_id = v_id and m.role = 'admin' and (m.valid_to is null or m.valid_to > now())) then
    insert into crm.memberships (user_id, market_code, role) values (v_id, null, 'admin');
    insert into crm.audit_events (actor_id, action, object, object_id, after)
    values (v_id, 'user.bootstrap_admin', 'user', v_id, jsonb_build_object('email', p_email));
  end if;
  if v_id is not null then
    update crm.users set auth_subject = p_subject, last_seen_at = now() where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function app.sso_user(text, text, text, boolean) from public;
grant execute on function app.sso_user(text, text, text, boolean) to contigo_app;
