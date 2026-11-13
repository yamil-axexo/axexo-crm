-- 0023_datos: identidad, jerarquía y gobierno de datos (paquete datos del programa "los 95").
-- DAT-04 duplicados con llaves fuertes, cola, fusión con foto previa y deshacer.
-- DAT-01 mover en el árbol con motivo y fecha efectiva, profundidad máxima por tipo.
-- DAT-02 contacto en varias cuentas, histórico de quién fue el contacto principal, baja con vigencia.
-- DAT-03 sistemas de alias como catálogo, alta y cierre de alias a mano.
-- DAT-05 / GOB-01 gobierno de campos (dueño, propósito, decisión, revisión, clase de dato), propuestas y procesos por mercado.
-- GOB-02 reglas de calidad con responsable y cortes para la tendencia.
-- DAT-07 productos por mercado con proveedor y matriz de productos por comercio.

-- ================================================================ helpers de alcance
create or replace function app.lead_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships() where role = 'market_lead'), '{}')
         end
$$;

-- Mercados donde la persona cuida los datos: administración, quien lidera el mercado y Operaciones.
create or replace function app.steward_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships() where role in ('market_lead','ops')), '{}')
         end
$$;
grant execute on function app.lead_markets(), app.steward_markets() to contigo_app;

-- ================================================================ DAT-04 duplicados
-- Llave de dirección: letras y números de la calle más la localidad, sin acentos ni signos. Solo sirve para comparar igualdad exacta
-- junto con el nombre; nunca se compara "parecido" de direcciones.
create or replace function app.addr_key(p_line text, p_locality text) returns text
language sql stable set search_path = public, extensions, app, pg_catalog as $$
  select case when length(regexp_replace(app.norm(p_line), '[^a-z0-9]+', '', 'g')) >= 6
              then regexp_replace(app.norm(p_line), '[^a-z0-9]+', '', 'g') || '|' || regexp_replace(app.norm(p_locality), '[^a-z0-9]+', '', 'g')
         end
$$;

-- Coincidencias al capturar: llaves fuertes (teléfono, correo, identificador externo, nombre más dirección) y nombre parecido.
-- Mira todo el mercado aunque quien captura no vea esas cuentas; devuelve lo mínimo para decidir.
create or replace function app.duplicate_matches(p_market text, p_name text, p_phone text, p_email text, p_address text, p_locality text,
                                                 p_external_id text default null, p_exclude uuid default null)
returns table (id uuid, name text, locality text, owner_name text, lifecycle text, match text, strong boolean)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with m as (
    select a.id, a.name, a.locality, a.owner_id, a.lifecycle,
           case when p_phone is not null and a.phone = p_phone then 'phone'
                when nullif(btrim(p_email), '') is not null and a.email = btrim(p_email)::citext then 'email'
                when nullif(btrim(p_external_id), '') is not null and exists (
                       select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and lower(al.external_id) = lower(btrim(p_external_id))) then 'external_id'
                when nullif(btrim(p_external_id), '') is not null and upper(btrim(a.merchant_ref)) = upper(btrim(p_external_id)) then 'external_id'
                when app.addr_key(p_address, p_locality) is not null and a.name_norm = app.norm(p_name)
                     and app.addr_key(a.address_line, a.locality) = app.addr_key(p_address, p_locality) then 'name_address'
                when length(app.norm(p_name)) >= 4 and similarity(a.name_norm, app.norm(p_name)) > 0.62 then 'name'
           end as match,
           similarity(a.name_norm, app.norm(p_name)) as sim
      from crm.accounts a
     where p_market = any(app.my_markets()) and a.market_code = p_market and a.archived_at is null
       and (p_exclude is null or a.id <> p_exclude)
  )
  select m.id, m.name, m.locality, u.full_name, m.lifecycle, m.match, m.match <> 'name'
    from m left join crm.users u on u.id = m.owner_id
   where m.match is not null
   order by (m.match <> 'name') desc, m.sim desc
   limit 5
$$;
grant execute on function app.duplicate_matches(text, text, text, text, text, text, text, uuid) to contigo_app;

-- Avisos de duplicado que alguien se saltó, con su motivo: la mesa de control los revisa.
create table crm.duplicate_bypasses (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  account_id   uuid not null references crm.accounts(id),
  matched_ids  uuid[] not null,
  match_kinds  text[] not null,
  strong       boolean not null default false,
  reason       text not null check (char_length(btrim(reason)) between 10 and 400),
  actor_id     uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references crm.users(id),
  review_note  text
);
create index duplicate_bypasses_open_idx on crm.duplicate_bypasses (market_code, created_at desc) where reviewed_at is null;

-- Cola de pares que parecen el mismo comercio. La llena la búsqueda en lote; una persona decide cada par.
create table crm.duplicate_pairs (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  a_id         uuid not null references crm.accounts(id),
  b_id         uuid not null references crm.accounts(id),
  match_kinds  text[] not null,
  strong       boolean not null default false,
  score        numeric(4,3) not null default 0,
  status       text not null default 'open' check (status in ('open','merged','dismissed')),
  decision_note text,
  decided_by   uuid references crm.users(id),
  decided_at   timestamptz,
  detected_at  timestamptz not null default now(),
  check (a_id < b_id),
  unique (a_id, b_id)
);
create index duplicate_pairs_open_idx on crm.duplicate_pairs (market_code, strong desc, score desc) where status = 'open';

-- Búsqueda en lote: teléfono, correo, nombre más dirección (llaves fuertes) y nombre parecido en la misma localidad.
-- Un par ya decidido ("no son el mismo") no vuelve a abrirse. Es segura de correr dos veces.
create or replace function app.scan_duplicates(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, public, extensions, pg_catalog as $$
declare n int;
begin
  -- La corre la tarea programada (sin persona o como usuario de sistema), administración, o quien lidera ese mercado.
  if app.current_user_id() is not null and app.current_user_id() is distinct from app.system_user_id()
     and not (app.is_admin() or (p_market is not null and p_market = any(app.lead_markets()))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with live as (
    select id, market_code, name_norm, phone, email, locality, app.addr_key(address_line, locality) as addr
      from crm.accounts where archived_at is null and (p_market is null or market_code = p_market)
  ), found as (
    select a.market_code, a.id as a_id, b.id as b_id,
           array_remove(array[
             case when a.phone is not null and a.phone = b.phone then 'phone' end,
             case when a.email is not null and a.email = b.email then 'email' end,
             case when a.addr is not null and a.addr = b.addr and a.name_norm = b.name_norm then 'name_address' end,
             case when similarity(a.name_norm, b.name_norm) > 0.62 then 'name' end], null) as kinds,
           similarity(a.name_norm, b.name_norm) as sim
      from live a join live b on b.market_code = a.market_code and a.id < b.id
       and ((a.phone is not null and a.phone = b.phone)
            or (a.email is not null and a.email = b.email)
            or (a.addr is not null and a.addr = b.addr and a.name_norm = b.name_norm)
            or (length(a.name_norm) >= 4 and a.name_norm % b.name_norm and similarity(a.name_norm, b.name_norm) > 0.62
                and app.norm(a.locality) = app.norm(b.locality)))
  ), ins as (
    insert into crm.duplicate_pairs (market_code, a_id, b_id, match_kinds, strong, score)
    select market_code, a_id, b_id, kinds, kinds && array['phone','email','name_address'], round(sim::numeric, 3)
      from found where cardinality(kinds) > 0
    on conflict (a_id, b_id) do update set match_kinds = excluded.match_kinds, strong = excluded.strong, score = excluded.score
      where crm.duplicate_pairs.status = 'open'
    returning 1
  )
  select count(*) into n from ins;
  -- Un par abierto cuyo comercio ya se archivó deja de estar pendiente.
  update crm.duplicate_pairs p set status = 'dismissed', decision_note = 'archived', decided_at = now()
   where p.status = 'open' and exists (select 1 from crm.accounts a where a.id in (p.a_id, p.b_id) and a.archived_at is not null);
  return n;
end $$;
grant execute on function app.scan_duplicates(text) to contigo_app;

-- Fusión con foto previa: cómo estaban los dos registros, qué se movió y qué valor ganó en cada campo. Con eso se deshace.
create table crm.merge_events (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  source_id     uuid not null references crm.accounts(id),
  target_id     uuid not null references crm.accounts(id),
  snapshot      jsonb not null,
  moved         jsonb not null default '{}'::jsonb,
  survivorship  jsonb not null default '{}'::jsonb,
  merged_by     uuid not null references crm.users(id),
  merged_at     timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     uuid references crm.users(id),
  undo_reason   text
);
create index merge_events_target_idx on crm.merge_events (target_id, merged_at desc);
create index merge_events_source_idx on crm.merge_events (source_id);

-- ================================================================ DAT-01 árbol
alter table crm.account_links add column reason text check (reason is null or char_length(btrim(reason)) between 5 and 300);
alter table crm.account_types add column max_depth int check (max_depth is null or max_depth between 1 and 12);
comment on column crm.account_types.max_depth is 'Niveles que admite un árbol cuya raíz es de este tipo, contando la raíz. Nulo: sin límite.';
update crm.account_types set max_depth = 4 where code in ('iso','distributor','aggregator','corporate') and market_code is null;
update crm.account_types set max_depth = 3 where code = 'chain' and market_code is null;
insert into crm.account_types (code, label_es, label_en, kind, position) values ('region', 'Región de cadena', 'Chain region', 'chain', 35)
  on conflict do nothing;

-- La base repite el límite: un árbol no crece más allá de lo que admite el tipo de su raíz.
create or replace function crm.account_tree_depth() returns trigger
language plpgsql security definer set search_path = crm, app, public, pg_catalog as $$
declare v_root uuid; v_max int; v_depth int;
begin
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then return null; end if;
  v_root := coalesce(new.ancestor_ids[1], new.id);
  select t.max_depth into v_max from crm.accounts r
    join crm.account_types t on t.code = r.account_type and (t.market_code is null or t.market_code = r.market_code)
   where r.id = v_root order by t.market_code nulls last limit 1;
  if v_max is null then return null; end if;
  select coalesce(max(cardinality(d.ancestor_ids)), 0) + 1 into v_depth from crm.accounts d where d.id = v_root or d.ancestor_ids @> array[v_root];
  if v_depth > v_max then
    raise exception 'account hierarchy too deep' using errcode = '23514';
  end if;
  return null;
end $$;
create trigger accounts_tree_depth after insert or update of parent_id on crm.accounts
  for each row execute function crm.account_tree_depth();

-- ================================================================ DAT-02 contactos
alter table crm.account_contacts add column deal_id uuid references crm.deals(id);
alter table crm.account_contacts add column end_reason text check (end_reason is null or char_length(end_reason) <= 300);
create index account_contacts_contact_idx on crm.account_contacts (contact_id) where valid_to is null;
create index contacts_phone_idx on crm.contacts (market_code, phone) where phone is not null;
comment on column crm.account_contacts.deal_id is 'Con negocio: el rol de la persona en ese negocio. Nulo: su rol en la cuenta.';

-- Quién fue el contacto principal de una cuenta y cuándo. Lo escribe la base: ningún camino cambia al principal sin dejar rastro.
create table crm.contact_primary_history (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id),
  contact_id   uuid not null references crm.contacts(id),
  market_code  text not null references crm.markets(code),
  from_at      timestamptz not null default now(),
  to_at        timestamptz,
  changed_by   uuid references crm.users(id)
);
create index contact_primary_history_account_idx on crm.contact_primary_history (account_id, from_at desc);
insert into crm.contact_primary_history (account_id, contact_id, market_code, from_at)
  select account_id, contact_id, market_code, valid_from from crm.account_contacts where is_primary and valid_to is null;

create or replace function crm.contact_primary_track() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare was boolean := tg_op = 'UPDATE' and old.is_primary and old.valid_to is null;
        isnow boolean := new.is_primary and new.valid_to is null;
begin
  if was and (not isnow or new.account_id <> old.account_id) then
    update crm.contact_primary_history set to_at = now()
     where account_id = old.account_id and contact_id = old.contact_id and to_at is null;
  end if;
  if isnow and (not was or new.account_id <> old.account_id) then
    insert into crm.contact_primary_history (account_id, contact_id, market_code, changed_by)
    values (new.account_id, new.contact_id, new.market_code, app.current_user_id());
  end if;
  return null;
end $$;
create trigger account_contacts_primary_track after insert or update of is_primary, valid_to, account_id on crm.account_contacts
  for each row execute function crm.contact_primary_track();

-- La misma persona no se captura dos veces: el teléfono encuentra al contacto del mercado aunque quien captura no vea su otra cuenta.
create or replace function app.contact_by_phone(p_market text, p_phone text)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.full_name from crm.contacts c
   where p_market = any(app.my_markets()) and c.market_code = p_market and p_phone is not null and c.phone = p_phone
   order by c.created_at limit 1
$$;
grant execute on function app.contact_by_phone(text, text) to contigo_app;

-- ================================================================ DAT-03 alias
create table crm.alias_systems (
  code         text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es     text not null check (char_length(btrim(label_es)) between 2 and 60),
  label_en     text not null check (char_length(btrim(label_en)) between 2 and 60),
  kind         text not null default 'other' check (kind in ('internal','network','carrier','crm','other')),
  market_code  text references crm.markets(code),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
insert into crm.alias_systems (code, label_es, label_en, kind) values
  ('sales_core', 'Sales App', 'Sales App', 'internal'),
  ('s5', 'Merchant ID', 'Merchant ID', 'internal'),
  ('pipedrive', 'Pipedrive', 'Pipedrive', 'crm'),
  ('zoho', 'Zoho', 'Zoho', 'crm'),
  ('emida', 'EMIDA', 'EMIDA', 'network'),
  ('sky', 'Sky', 'Sky', 'network'),
  ('movilway', 'Movilway', 'Movilway', 'network'),
  ('incomm', 'InComm', 'InComm', 'network'),
  ('carrier', 'Proveedor o carrier', 'Provider or carrier', 'carrier'),
  ('other', 'Otro', 'Other', 'other');
alter table crm.account_aliases drop constraint account_aliases_system_check;
alter table crm.account_aliases add constraint account_aliases_system_fkey foreign key (system) references crm.alias_systems(code);
alter table crm.account_aliases add column note text check (note is null or char_length(note) <= 300);
alter table crm.account_aliases add column created_by uuid references crm.users(id);
alter table crm.account_aliases add column closed_by uuid references crm.users(id);

-- A quién pertenece hoy un identificador externo, aunque quien pregunta no vea esa cuenta: así el choque se explica.
create or replace function app.alias_holder(p_system text, p_external_id text)
returns table (account_id uuid, name text, market_code text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select a.id, a.name, a.market_code from crm.account_aliases al join crm.accounts a on a.id = al.account_id
   where app.current_user_id() is not null and al.system = p_system and al.external_id = btrim(p_external_id) and al.valid_to is null
     and a.market_code = any(app.my_markets())
   limit 1
$$;
grant execute on function app.alias_holder(text, text) to contigo_app;

-- Quien cuida los datos del mercado (líder de mercado, Operaciones) agrega y cierra alias, no solo administración.
create policy account_aliases_steward_ins on crm.account_aliases for insert to contigo_app
  with check (market_code = any((select app.steward_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = account_aliases.account_id));
create policy account_aliases_steward_upd on crm.account_aliases for update to contigo_app
  using (market_code = any((select app.steward_markets())::text[])) with check (market_code = any((select app.steward_markets())::text[]));

-- ================================================================ DAT-05 / GOB-01 campos
alter table crm.field_definitions
  add column owner_id     uuid references crm.users(id),
  add column purpose      text check (purpose is null or char_length(purpose) <= 400),
  add column decision     text check (decision is null or char_length(decision) <= 400),
  add column review_on    date,
  add column pii_class    text not null default 'none' check (pii_class in ('none','personal','sensitive')),
  add column untrusted    boolean not null default false,
  add column origin       text check (origin is null or char_length(origin) <= 200),
  add column used_by      text check (used_by is null or char_length(used_by) <= 200),
  add column status       text not null default 'approved' check (status in ('proposed','approved','rejected')),
  add column proposed_by  uuid references crm.users(id),
  add column proposed_at  timestamptz,
  add column decided_by   uuid references crm.users(id),
  add column decided_at   timestamptz,
  add column decision_note text check (decision_note is null or char_length(decision_note) <= 400);
-- Lo que llegó de Pipedrive entró sin revisión: se marca como dato de origen externo sin validar.
update crm.field_definitions set untrusted = true, origin = 'Pipedrive' where source = 'pipedrive';
-- Un campo propuesto no se muestra en las fichas hasta que administración lo aprueba.
alter table crm.field_definitions add constraint field_definitions_proposed_inactive check (status = 'approved' or not is_active);
create policy field_definitions_lead_propose on crm.field_definitions for insert to contigo_app
  with check (status = 'proposed' and not is_active and market_code is not null and market_code = any((select app.lead_markets())::text[])
              and proposed_by = (select app.current_user_id()));

insert into crm.settings (key, value) values ('field_approval_sla_days', '3'::jsonb) on conflict (key) do nothing;

-- Los valores viven en jsonb con índice: buscar por un campo adicional no recorre toda la tabla.
create index accounts_custom_gin on crm.accounts using gin (custom jsonb_path_ops);
create index deals_custom_gin on crm.deals using gin (custom jsonb_path_ops);
create index leads_custom_gin on crm.leads using gin (custom jsonb_path_ops);

-- Uso de cada campo: cuántos registros lo traen. Sale en el registro de campos para retirar lo que nadie usa.
create or replace function app.field_usage()
returns table (field_id uuid, filled int, total int)
language sql stable set search_path = crm, app, pg_catalog as $$
  select f.id,
         case f.object when 'account' then (select count(*)::int from crm.accounts a where a.archived_at is null and (f.market_code is null or a.market_code = f.market_code) and a.custom ? f.key)
                       when 'deal' then (select count(*)::int from crm.deals d where (f.market_code is null or d.market_code = f.market_code) and d.custom ? f.key)
                       when 'lead' then (select count(*)::int from crm.leads l where (f.market_code is null or l.market_code = f.market_code) and l.custom ? f.key)
                       else 0 end,
         case f.object when 'account' then (select count(*)::int from crm.accounts a where a.archived_at is null and (f.market_code is null or a.market_code = f.market_code))
                       when 'deal' then (select count(*)::int from crm.deals d where (f.market_code is null or d.market_code = f.market_code))
                       when 'lead' then (select count(*)::int from crm.leads l where (f.market_code is null or l.market_code = f.market_code))
                       else 0 end
    from crm.field_definitions f
$$;
grant execute on function app.field_usage() to contigo_app;

-- Procesos paralelos por mercado: una lista con sus propios estados y datos (capacitación, una campaña), sin tocar el embudo.
create table crm.process_lists (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  code         text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_es      text not null check (char_length(btrim(name_es)) between 2 and 80),
  name_en      text not null check (char_length(btrim(name_en)) between 2 and 80),
  statuses     jsonb not null,     -- [{code, es, en}] en orden; el último cierra el proceso
  attributes   jsonb not null default '[]'::jsonb,   -- [{key, es, en}] datos propios de la lista
  is_active    boolean not null default true,
  created_by   uuid references crm.users(id),
  created_at   timestamptz not null default now(),
  unique (market_code, code)
);
create table crm.process_memberships (
  id           uuid primary key default app.uuid_v7(),
  list_id      uuid not null references crm.process_lists(id),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  status       text not null,
  attrs        jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  status_at    timestamptz not null default now(),
  ended_at     timestamptz,
  updated_by   uuid references crm.users(id)
);
create unique index process_memberships_live_uq on crm.process_memberships (list_id, account_id) where ended_at is null;
create index process_memberships_account_idx on crm.process_memberships (account_id);

-- ================================================================ GOB-02 calidad
create table crm.quality_rules (
  code         text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es     text not null,
  label_en     text not null,
  fix_es       text not null,
  fix_en       text not null,
  owner_role   text not null check (owner_role in ('admin','market_lead','supervisor','ops')),
  owner_id     uuid references crm.users(id),
  threshold    int,                 -- días, para las reglas de vencimiento
  position     int not null default 0,
  is_active    boolean not null default true
);
insert into crm.quality_rules (code, label_es, label_en, fix_es, fix_en, owner_role, threshold, position) values
  ('no_owner',     'Comercios sin quién los lleve', 'Merchants with no owner', 'Asígnalos desde Mi equipo o desde la ficha.', 'Assign them from My team or from the record.', 'supervisor', null, 10),
  ('no_phone',     'Comercios sin teléfono', 'Merchants with no phone', 'Captura el teléfono en la ficha, en Datos.', 'Enter the phone on the record, under Details.', 'supervisor', null, 20),
  ('no_contact',   'Comercios sin contacto', 'Merchants with no contact', 'Agrega a la persona con quien se habla.', 'Add the person you talk to.', 'supervisor', null, 30),
  ('no_address',   'Comercios sin dirección', 'Merchants with no address', 'Captura calle y ciudad en la ficha.', 'Enter street and city on the record.', 'supervisor', null, 40),
  ('no_coords',    'Puntos de venta sin ubicación en el mapa', 'Stores with no map location', 'La ubicación llega con la visita de la Sales App.', 'The location comes with the Sales App visit.', 'ops', null, 50),
  ('no_alias',     'Comercios activos sin ID en otros sistemas', 'Active merchants with no ID in other systems', 'Liga su ID de la Sales App o su Merchant ID.', 'Link its Sales App ID or its Merchant ID.', 'ops', null, 60),
  ('duplicate',    'Duplicados probables por decidir', 'Probable duplicates to decide', 'Compara los dos registros y fusiona o descarta.', 'Compare the two records and merge or dismiss.', 'admin', null, 70),
  ('bypass',       'Avisos de duplicado que se saltaron, sin revisar', 'Skipped duplicate warnings not yet reviewed', 'Lee el motivo y marca la revisión.', 'Read the reason and mark it reviewed.', 'market_lead', null, 80),
  ('stale',        'Comercios sin movimiento reciente', 'Merchants with no recent activity', 'Confirma que los datos siguen vigentes con una visita o una llamada.', 'Confirm the details still hold with a visit or a call.', 'supervisor', 180, 90),
  ('deal_no_step', 'Negocios abiertos sin próximo paso', 'Open deals with no next step', 'Pon el próximo paso con su fecha.', 'Set the next step and its date.', 'supervisor', null, 100),
  ('provider_late','Solicitudes a proveedor fuera de plazo', 'Provider requests past their deadline', 'Da seguimiento con el proveedor.', 'Follow up with the provider.', 'ops', null, 110),
  ('field_review', 'Campos con revisión vencida o sin decisión', 'Fields past review or with no decision', 'Documenta la decisión o retira el campo.', 'Document the decision or retire the field.', 'admin', null, 120);

-- Un corte por día, mercado, equipo y regla: de ahí sale la tendencia.
create table crm.quality_snapshots (
  as_of        date not null,
  market_code  text not null references crm.markets(code),
  team_id      uuid references crm.teams(id),
  rule_code    text not null references crm.quality_rules(code),
  total        int not null,
  failing      int not null,
  created_at   timestamptz not null default now()
);
create unique index quality_snapshots_uq on crm.quality_snapshots (as_of, market_code, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_code);

-- El equipo de quien lleva un registro en un mercado (para agrupar la calidad por equipo sin exponer las membresías).
create or replace function app.user_team(p_user uuid, p_market text) returns uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select m.team_id from crm.memberships m
   where m.user_id = p_user and m.market_code = p_market and m.team_id is not null
     and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
   order by m.valid_from limit 1
$$;
grant execute on function app.user_team(uuid, text) to contigo_app;

-- ================================================================ DAT-07 productos por comercio
alter table crm.products add column provider_id uuid references crm.ops_catalog(id);
alter table crm.products add column legal_entity_id uuid references crm.legal_entities(id);
alter table crm.ops_catalog add column sla_days int check (sla_days is null or sla_days between 1 and 120);
comment on column crm.ops_catalog.sla_days is 'Proveedor: días que puede tardar en responder una solicitud antes de marcarse fuera de plazo.';

-- Qué productos tiene cada comercio y en qué estado va cada uno con su proveedor. El estado por proveedor que Operaciones
-- marca en un negocio (deal_ops_checks) escribe aquí: es un solo modelo, visto desde el negocio o desde el comercio.
create table crm.account_products (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id),
  market_code   text not null references crm.markets(code),
  product_id    uuid references crm.products(id),
  provider_id   uuid references crm.ops_catalog(id),
  status        text not null default 'requested' check (status in ('requested','submitted','approved','active','rejected','suspended')),
  requested_at  timestamptz not null default now(),
  submitted_at  timestamptz,
  decided_at    timestamptz,
  activated_at  timestamptz,
  status_at     timestamptz not null default now(),
  deal_id       uuid references crm.deals(id),
  note          text check (note is null or char_length(note) <= 300),
  updated_by    uuid references crm.users(id),
  updated_at    timestamptz not null default now(),
  check (product_id is not null or provider_id is not null)
);
create unique index account_products_uq on crm.account_products
  (account_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(provider_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index account_products_status_idx on crm.account_products (market_code, status);
create index account_products_provider_idx on crm.account_products (provider_id, status);

create table crm.account_product_events (
  id                  uuid primary key default app.uuid_v7(),
  account_product_id  uuid not null references crm.account_products(id),
  market_code         text not null references crm.markets(code),
  from_status         text,
  to_status           text not null,
  actor_id            uuid references crm.users(id),
  at                  timestamptz not null default now()
);
create index account_product_events_idx on crm.account_product_events (account_product_id, at);

create or replace function crm.account_product_track() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into crm.account_product_events (account_product_id, market_code, from_status, to_status, actor_id)
    values (new.id, new.market_code, case when tg_op = 'UPDATE' then old.status end, new.status, app.current_user_id());
  end if;
  return null;
end $$;
create trigger account_products_track after insert or update of status on crm.account_products
  for each row execute function crm.account_product_track();

-- El estado por proveedor de un negocio alimenta la matriz del comercio.
create or replace function crm.deal_check_to_account_product() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_account uuid; v_kind text; v_status text;
begin
  select kind into v_kind from crm.ops_catalog where id = new.catalog_id;
  if v_kind is distinct from 'provider' then return null; end if;
  select account_id into v_account from crm.deals where id = new.deal_id;
  v_status := case new.status when 'pending' then 'requested' when 'sent' then 'submitted' when 'approved' then 'approved' when 'rejected' then 'rejected' end;
  if v_account is null or v_status is null then return null; end if;
  insert into crm.account_products (account_id, market_code, provider_id, status, submitted_at, decided_at, deal_id, updated_by)
  values (v_account, new.market_code, new.catalog_id, v_status,
          case when v_status = 'submitted' then coalesce(new.on_date::timestamptz, now()) end,
          case when v_status in ('approved','rejected') then coalesce(new.on_date::timestamptz, now()) end, new.deal_id, new.updated_by)
  on conflict (account_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(provider_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set status = case when crm.account_products.status in ('active','suspended') then crm.account_products.status else excluded.status end,
                submitted_at = coalesce(excluded.submitted_at, crm.account_products.submitted_at),
                decided_at = coalesce(excluded.decided_at, crm.account_products.decided_at),
                status_at = case when crm.account_products.status in ('active','suspended') or crm.account_products.status = excluded.status then crm.account_products.status_at else now() end,
                deal_id = excluded.deal_id, updated_by = excluded.updated_by, updated_at = now();
  return null;
end $$;
create trigger deal_ops_checks_to_account after insert or update of status, on_date on crm.deal_ops_checks
  for each row execute function crm.deal_check_to_account_product();

-- Lo que ya estaba marcado en negocios entra a la matriz.
insert into crm.account_products (account_id, market_code, provider_id, status, submitted_at, decided_at, deal_id, updated_by, status_at)
select distinct on (d.account_id, c.catalog_id) d.account_id, c.market_code, c.catalog_id,
       case c.status when 'pending' then 'requested' when 'sent' then 'submitted' when 'approved' then 'approved' else 'rejected' end,
       case when c.status = 'sent' then coalesce(c.on_date::timestamptz, c.updated_at) end,
       case when c.status in ('approved','rejected') then coalesce(c.on_date::timestamptz, c.updated_at) end,
       c.deal_id, c.updated_by, c.updated_at
  from crm.deal_ops_checks c join crm.deals d on d.id = c.deal_id join crm.ops_catalog k on k.id = c.catalog_id and k.kind = 'provider'
 where c.status in ('pending','sent','approved','rejected')
 order by d.account_id, c.catalog_id, c.updated_at desc;

-- ================================================================ RLS forzado y privilegios
do $$
declare t text;
begin
  foreach t in array array['duplicate_bypasses','duplicate_pairs','merge_events','contact_primary_history','alias_systems','process_lists',
                           'process_memberships','quality_rules','quality_snapshots','account_products','account_product_events'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
  end loop;
end $$;

grant select, insert, update on crm.duplicate_bypasses, crm.duplicate_pairs, crm.merge_events, crm.alias_systems, crm.process_lists,
  crm.process_memberships, crm.quality_rules, crm.account_products to contigo_app;
grant select on crm.contact_primary_history, crm.account_product_events to contigo_app;
grant select, insert on crm.quality_snapshots to contigo_app;

-- Avisos saltados: quien lo saltó ve el suyo; quien cuida los datos o supervisa a esa persona, los de su alcance.
create policy duplicate_bypasses_read on crm.duplicate_bypasses for select to contigo_app
  using (actor_id = (select app.current_user_id()) or market_code = any((select app.full_markets())::text[])
         or (market_code = any((select app.team_markets())::text[]) and actor_id = any((select app.supervised_user_ids())::uuid[])));
create policy duplicate_bypasses_ins on crm.duplicate_bypasses for insert to contigo_app
  with check (actor_id = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[]));
create policy duplicate_bypasses_upd on crm.duplicate_bypasses for update to contigo_app
  using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]));

-- Cola de duplicados y fusiones: las ve quien ve todo el mercado; decide quien lidera el mercado o administra; fusiona administración.
create policy duplicate_pairs_read on crm.duplicate_pairs for select to contigo_app using (market_code = any((select app.full_markets())::text[]));
create policy duplicate_pairs_upd on crm.duplicate_pairs for update to contigo_app
  using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]));
create policy merge_events_read on crm.merge_events for select to contigo_app using (market_code = any((select app.full_markets())::text[]));
create policy merge_events_ins on crm.merge_events for insert to contigo_app with check ((select app.is_admin()) and merged_by = (select app.current_user_id()));
create policy merge_events_upd on crm.merge_events for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy contact_primary_history_read on crm.contact_primary_history for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = contact_primary_history.account_id));

-- Catálogos: lee cualquier persona con sesión, escribe administración.
do $$
declare t text;
begin
  foreach t in array array['alias_systems','quality_rules'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using ((select app.current_user_id()) is not null)', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_upd', t);
  end loop;
end $$;

-- Listas de proceso: las define quien lidera el mercado o administra; las ve quien trabaja en ese mercado.
create policy process_lists_read on crm.process_lists for select to contigo_app using (market_code = any((select app.my_markets())::text[]));
create policy process_lists_ins on crm.process_lists for insert to contigo_app with check (market_code = any((select app.lead_markets())::text[]));
create policy process_lists_upd on crm.process_lists for update to contigo_app
  using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]));
create policy process_memberships_read on crm.process_memberships for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = process_memberships.account_id));
create policy process_memberships_ins on crm.process_memberships for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = process_memberships.account_id and a.market_code = process_memberships.market_code));
create policy process_memberships_upd on crm.process_memberships for update to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = process_memberships.account_id))
  with check (market_code = any((select app.write_markets())::text[]));

-- Cortes de calidad: los del mercado completo, quien ve todo el mercado; los de un equipo, también quien lo supervisa.
create policy quality_snapshots_read on crm.quality_snapshots for select to contigo_app
  using (market_code = any((select app.full_markets())::text[])
         or (team_id is not null and team_id in (select team_id from app.active_memberships() where role = 'supervisor')));
create policy quality_snapshots_ins on crm.quality_snapshots for insert to contigo_app
  with check ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()));

-- Matriz de productos: se ve con el comercio; la escribe Operaciones o administración del mercado.
create policy account_products_read on crm.account_products for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = account_products.account_id));
create policy account_products_ins on crm.account_products for insert to contigo_app
  with check (market_code = any((select app.ops_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = account_products.account_id and a.market_code = account_products.market_code));
create policy account_products_upd on crm.account_products for update to contigo_app
  using (market_code = any((select app.ops_markets())::text[])) with check (market_code = any((select app.ops_markets())::text[]));
create policy account_product_events_read on crm.account_product_events for select to contigo_app
  using (exists (select 1 from crm.account_products p where p.id = account_product_events.account_product_id));

-- ================================================================ GOB-02 medición de las reglas de calidad
-- Una sola definición de cada regla. Corre con los permisos de quien la llama: cada quien mide lo que ve
-- (supervisión, su equipo; quien lidera, su mercado). El corte diario la llama desde una función con dueño y ve todo.
create or replace function app.quality_measure()
returns table (market_code text, team_id uuid, rule_code text, total int, failing int)
language sql stable set search_path = crm, app, public, pg_catalog as $$
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
  select mk.code, null::uuid, 'field_review', count(f.id)::int,
         (count(f.id) filter (where f.decision is null or f.owner_id is null or f.review_on is null or f.review_on < (now() at time zone mk.timezone)::date))::int
    from crm.markets mk join crm.field_definitions f on f.is_active and (f.market_code is null or f.market_code = mk.code)
   where mk.status = 'live' and mk.code = any(app.my_markets()) group by mk.code
$$;
grant execute on function app.quality_measure() to contigo_app;

-- La cola de una regla: los registros que hoy la incumplen en un mercado, para abrirlos y corregirlos.
create or replace function app.quality_failing(p_rule text, p_market text, p_limit int default 100)
returns table (kind text, id uuid, name text, who text, since timestamptz)
language sql stable set search_path = crm, app, public, pg_catalog as $$
  with cfg as (select coalesce((select threshold from crm.quality_rules where code = 'stale'), 180) as stale_days)
  (select 'account', a.id, a.name, u.full_name, a.updated_at
     from crm.accounts a cross join cfg left join crm.users u on u.id = a.owner_id
    where a.archived_at is null and a.market_code = p_market and case p_rule
            when 'no_owner' then a.owner_id is null and a.parent_id is null
            when 'no_phone' then a.phone is null
            when 'no_contact' then not exists (select 1 from crm.account_contacts ac where ac.account_id = a.id and ac.valid_to is null)
            when 'no_address' then a.address_line is null or a.locality is null
            when 'no_coords' then a.kind = 'store' and a.latitude is null
            when 'no_alias' then a.lifecycle <> 'prospect' and a.merchant_ref is null and not exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null)
            when 'stale' then a.updated_at < now() - make_interval(days => cfg.stale_days)
                 and not exists (select 1 from crm.activities ac where ac.account_id = a.id and ac.created_at > now() - make_interval(days => cfg.stale_days))
                 and not exists (select 1 from crm.visits v where v.account_id = a.id and v.checked_in_at > now() - make_interval(days => cfg.stale_days))
            when 'provider_late' then exists (select 1 from crm.account_products p join crm.ops_catalog k on k.id = p.provider_id
                   where p.account_id = a.id and p.status = 'submitted' and k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days))
            else false end
    order by a.updated_at limit greatest(1, least(p_limit, 500)))
  union all
  (select 'deal', d.id, d.title, u.full_name, d.updated_at
     from crm.deals d left join crm.users u on u.id = d.owner_id
    where p_rule = 'deal_no_step' and d.market_code = p_market and d.status = 'open' and (d.next_step is null or d.next_step_due is null)
    order by d.updated_at limit greatest(1, least(p_limit, 500)))
$$;
grant execute on function app.quality_failing(text, text, int) to contigo_app;

-- Corte del día: guarda la medición de todo (mercado, equipo, regla). Segura de correr dos veces: el corte de hoy se reemplaza.
create or replace function app.quality_snapshot() returns int
language plpgsql security definer set search_path = crm, app, public, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is not null and app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Dentro de esta función la medición ve todos los mercados: se fija una identidad de sistema solo para app.my_markets().
  perform set_config('app.user_id', app.system_user_id()::text, true);
  with ins as (
    insert into crm.quality_snapshots (as_of, market_code, team_id, rule_code, total, failing)
    select (now() at time zone mk.timezone)::date, q.market_code, q.team_id, q.rule_code, q.total, q.failing
      from app.quality_measure() q join crm.markets mk on mk.code = q.market_code
    on conflict (as_of, market_code, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_code)
    do update set total = excluded.total, failing = excluded.failing, created_at = now()
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;
grant execute on function app.quality_snapshot() to contigo_app;
