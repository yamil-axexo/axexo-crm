-- 0031_security: bitácora escrita por la base (SEG-03), equipo de cuenta, jerarquía, alcance por entidad legal, agencia y
-- partner, Administración por partes (SEG-01), campos sensibles (SEG-02), consentimiento, baja y retención (SEG-04),
-- "ver como", recertificación de accesos (SEG-07), solicitudes de titulares (SEG-09), inventario de llaves (SEG-08).
-- No certifica SOX ni SOC: construye el control. Lo que sale de la base (copia de la bitácora, directorio, cifrado) queda apagado.

-- ============================================================ 1) SEG-03: bitácora en esquema aparte, escrita por triggers
create schema if not exists audit;
revoke all on schema audit from public;
grant usage on schema audit to contigo_app;

create table audit.data_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default clock_timestamp(),
  txid           bigint not null default txid_current(),
  table_name     text not null,
  op             char(1) not null check (op in ('I','U','D','T')),
  row_id         text,
  market_code    text,
  actor_id       uuid,
  db_role        text not null default session_user,
  via            text not null,
  request_id     text,
  before         jsonb,
  after          jsonb,
  changed        text[],
  redacted_at    timestamptz,
  redaction_ref  uuid
);
create index data_log_row_idx on audit.data_log (table_name, row_id, id desc);
create index data_log_at_idx on audit.data_log (at desc);
create index data_log_actor_idx on audit.data_log (actor_id, at desc);

create table audit.config_log (like audit.data_log including defaults including constraints including identity);
alter table audit.config_log add primary key (id);
create index config_log_row_idx on audit.config_log (table_name, row_id, id desc);
create index config_log_at_idx on audit.config_log (at desc);

-- Lecturas que salen de CONTIGO o que recorren mucho: exportaciones, búsquedas, revelados, uso de llaves.
create table audit.read_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default clock_timestamp(),
  actor_id     uuid,
  key_id       uuid,
  via          text not null,
  kind         text not null check (kind in ('export','search','list','reveal','subject_export','api','view_as')),
  object       text not null,
  row_count    int not null default 0,
  market_code  text,
  detail       jsonb
);
create index read_log_actor_idx on audit.read_log (actor_id, at desc);
create index read_log_key_idx on audit.read_log (key_id, at desc) where key_id is not null;
create index read_log_at_idx on audit.read_log (at desc);

-- La copia fuera de la base sale por lotes con su huella. Sin destino aprobado, el lote queda en "canal apagado".
create table audit.archive_batches (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  log_name    text not null check (log_name in ('data_log','config_log')),
  from_id     bigint not null,
  to_id       bigint not null,
  row_count   int not null,
  sha256      text not null,
  status      text not null default 'channel_off' check (status in ('channel_off','simulated','sent')),
  sent_at     timestamptz
);

-- Tablas de crm que NO llevan trigger de bitácora, cada una con su motivo. Una prueba falla si aparece una tabla sin trigger y sin fila aquí.
create table audit.excluded_tables (
  table_name  text primary key,
  reason      text not null
);
insert into audit.excluded_tables (table_name, reason) values
  ('sessions', 'Tokens de sesión: el inicio y el cierre ya dejan evento; la fila guarda una huella que no debe copiarse.'),
  ('audit_events', 'Es la bitácora que escribe la aplicación; no se audita a sí misma.'),
  ('usage_events', 'Conteo de uso por pantalla: volumen alto, sin datos de negocio.'),
  ('inbound_events', 'Mensajes crudos de integraciones: lo que producen sí queda registrado en la tabla de destino.'),
  ('outbox_events', 'Cola de salida: copia de un cambio que ya quedó registrado en su tabla.'),
  ('import_raw', 'Copia cruda de Pipedrive, se vacía al terminar la migración.'),
  ('external_refs', 'Mapa técnico de identificadores de la importación.'),
  ('merchant_metrics_daily', 'Cifras diarias por comercio que llegan cada noche: la carga queda registrada por lote.'),
  ('user_onboarding', 'Pasos de primeros pasos vistos por cada persona: no es dato de negocio.');

-- Columnas que nunca se copian a la bitácora (huellas de llaves) o que se copian tapadas (valor de un campo sensible).
create or replace function audit.scrub(p_table text, p_row jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case when p_row is null then null
              when p_table = 'account_sensitive' then (p_row - 'value') || jsonb_build_object('value', '[protegido]')
              else p_row - 'key_hash' - 'token_hash' end
$$;

create or replace function audit.capture() returns trigger
language plpgsql security definer set search_path = audit, crm, app, pg_catalog as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_changed text[]; v_actor uuid; v_via text; v_req text; v_id text;
begin
  if tg_op = 'TRUNCATE' then
    v_row := null;
  else
    if tg_op <> 'INSERT' then v_old := audit.scrub(tg_table_name, to_jsonb(old)); end if;
    if tg_op <> 'DELETE' then v_new := audit.scrub(tg_table_name, to_jsonb(new)); end if;
    v_row := coalesce(v_new, v_old);
    if tg_op = 'UPDATE' then
      select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
        from jsonb_each(v_new) n where n.value is distinct from v_old -> n.key;
      -- Una fila que solo cambió su marca de último uso no es un cambio de datos.
      if v_changed <@ array['last_seen_at','last_used_at','use_count']::text[] then return null; end if;
    end if;
  end if;
  v_actor := nullif(current_setting('app.user_id', true), '')::uuid;
  v_via := nullif(current_setting('app.via', true), '');
  -- Sin identidad de la aplicación es SQL directo (consola, migración). Con identidad y sin vía declarada, la pantalla.
  if v_via is null then v_via := case when v_actor is null then 'sql' else 'screen' end; end if;
  if v_via = 'screen' and v_actor is not null and exists (select 1 from crm.users u where u.id = v_actor and u.is_system) then
    v_via := 'system';
  end if;
  v_req := nullif(current_setting('app.request_id', true), '');
  v_id := coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'code',
                   nullif(concat_ws(':', v_row ->> 'user_id', v_row ->> 'territory_id', v_row ->> 'membership_id', v_row ->> 'account_id', v_row ->> 'field_key'), ''),
                   v_row ->> 'market_code');
  if tg_argv[0] = 'config' then
    insert into audit.config_log (table_name, op, row_id, market_code, actor_id, via, request_id, before, after, changed)
    values (tg_table_name, left(tg_op, 1), v_id, v_row ->> 'market_code', v_actor, v_via, v_req, v_old, v_new, v_changed);
  else
    insert into audit.data_log (table_name, op, row_id, market_code, actor_id, via, request_id, before, after, changed)
    values (tg_table_name, left(tg_op, 1), v_id, v_row ->> 'market_code', v_actor, v_via, v_req, v_old, v_new, v_changed);
  end if;
  return null;
end $$;

-- Solo inserción. La única modificación admitida es tapar datos personales por una solicitud de eliminación en curso
-- (audit.redaction_ref apunta a esa solicitud): se conserva quién, cuándo, qué tabla, qué fila y qué columnas cambiaron.
create or replace function audit.immutable() returns trigger
language plpgsql set search_path = audit, crm, app, pg_catalog as $$
declare v_ref uuid;
begin
  if tg_op = 'UPDATE' then
    v_ref := nullif(current_setting('audit.redaction_ref', true), '')::uuid;
    if v_ref is not null and new.redaction_ref = v_ref and new.redacted_at is not null
       and exists (select 1 from crm.subject_requests r where r.id = v_ref and r.kind = 'erasure' and r.status = 'in_progress')
       and (to_jsonb(new) - 'before' - 'after' - 'redacted_at' - 'redaction_ref') = (to_jsonb(old) - 'before' - 'after' - 'redacted_at' - 'redaction_ref') then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create or replace function audit.append_only() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['data_log','config_log'] loop
    execute format('create trigger %I before update or delete on audit.%I for each row execute function audit.immutable()', t || '_no_update', t);
    execute format('create trigger %I before truncate on audit.%I for each statement execute function audit.append_only()', t || '_no_truncate', t);
  end loop;
  create trigger read_log_no_update before update or delete on audit.read_log for each row execute function audit.append_only();
  create trigger read_log_no_truncate before truncate on audit.read_log for each statement execute function audit.append_only();
  -- Un lote de copia solo cambia de estado (de "canal apagado" a enviado); nunca se borra.
  create trigger archive_batches_no_delete before delete on audit.archive_batches for each row execute function audit.append_only();
  create trigger archive_batches_no_truncate before truncate on audit.archive_batches for each statement execute function audit.append_only();
end $$;

create or replace function audit.attach(p_table text, p_kind text default null) returns void
language plpgsql set search_path = audit, crm, app, pg_catalog as $$
declare
  v_kind text := coalesce(p_kind, case when p_table = any(array[
    'markets','legal_entities','teams','territories','memberships','user_territories','settings','pipelines','stages','loss_reasons',
    'routing_rules','web_forms','fx_rates','api_clients','field_definitions','account_types','market_hours','ops_catalog','products','users',
    'agencies','sensitive_fields','retention_rules','account_team','secret_inventory','seat_approvals','access_reviews','access_review_items']) then 'config' else 'data' end);
begin
  execute format('drop trigger if exists zz_audit_capture on crm.%I', p_table);
  execute format('drop trigger if exists zz_audit_truncate on crm.%I', p_table);
  execute format('create trigger zz_audit_capture after insert or update or delete on crm.%I for each row execute function audit.capture(%L)', p_table, v_kind);
  execute format('create trigger zz_audit_truncate after truncate on crm.%I for each statement execute function audit.capture(%L)', p_table, v_kind);
end $$;

/** Pone el trigger en toda tabla de crm que no esté en la lista de excluidas. Se puede volver a llamar: una migración posterior que cree tablas la llama al final. */
create or replace function audit.attach_all() returns int
language plpgsql set search_path = audit, crm, app, pg_catalog as $$
declare t record; n int := 0;
begin
  for t in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'crm' and c.relkind in ('r','p') and not c.relispartition
              and c.relname not in (select table_name from audit.excluded_tables) loop
    perform audit.attach(t.relname);
    n := n + 1;
  end loop;
  return n;
end $$;

-- La bitácora de la aplicación (crm.audit_events) gana la vía y el identificador de la solicitud, puestos por la base.
alter table crm.audit_events add column via text, add column redacted_at timestamptz, add column redaction_ref uuid;
create or replace function crm.audit_events_stamp() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
declare v_via text := nullif(current_setting('app.via', true), '');
begin
  if v_via is null then v_via := case when nullif(current_setting('app.user_id', true), '') is null then 'sql' else 'screen' end; end if;
  if v_via = 'screen' and exists (select 1 from crm.users u where u.id = new.actor_id and u.is_system) then v_via := 'system'; end if;
  new.via := v_via;
  new.request_id := coalesce(new.request_id, nullif(current_setting('app.request_id', true), ''));
  return new;
end $$;
create trigger audit_events_stamp before insert on crm.audit_events for each row execute function crm.audit_events_stamp();

create or replace function crm.audit_events_immutable() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
declare v_ref uuid;
begin
  if tg_op = 'UPDATE' then
    v_ref := nullif(current_setting('audit.redaction_ref', true), '')::uuid;
    if v_ref is not null and new.redaction_ref = v_ref and new.redacted_at is not null
       and exists (select 1 from crm.subject_requests r where r.id = v_ref and r.kind = 'erasure' and r.status = 'in_progress')
       and (to_jsonb(new) - 'before' - 'after' - 'redacted_at' - 'redaction_ref') = (to_jsonb(old) - 'before' - 'after' - 'redacted_at' - 'redaction_ref') then
      return new;
    end if;
  end if;
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;

create or replace function app.log_read(p_kind text, p_object text, p_rows int, p_market text default null, p_detail jsonb default null, p_key uuid default null)
returns void
language plpgsql security definer set search_path = audit, crm, app, pg_catalog as $$
begin
  insert into audit.read_log (actor_id, key_id, via, kind, object, row_count, market_code, detail)
  values (app.current_user_id(), p_key, coalesce(nullif(current_setting('app.via', true), ''), 'screen'), p_kind, p_object, coalesce(p_rows, 0), p_market, p_detail);
end $$;

-- Toda exportación deja evento en la bitácora de la aplicación (`*.exported`). La base copia ese hecho al registro de lecturas,
-- con quién, qué y cuántas filas: el monitoreo no depende de que cada pantalla de exportación se acuerde de avisar.
create or replace function crm.audit_events_export_read() returns trigger
language plpgsql security definer set search_path = audit, crm, app, pg_catalog as $$
begin
  insert into audit.read_log (actor_id, via, kind, object, row_count, market_code, detail)
  values (new.actor_id, coalesce(new.via, 'screen'), 'export', coalesce(new.after ->> 'report', new.object),
          case when (new.after ->> 'rows') ~ '^[0-9]{1,9}$' then (new.after ->> 'rows')::int else 0 end, new.market_code,
          jsonb_build_object('action', new.action, 'audit_event_id', new.id));
  return null;
end $$;
create trigger audit_events_export_read after insert on crm.audit_events for each row
  when (new.action like '%.exported' and new.action <> 'subject_request.exported')
  execute function crm.audit_events_export_read();

/** UX-02: límite de frecuencia de la búsqueda, por persona. Cuenta sus búsquedas del último minuto sin dejarle leer el registro. */
create or replace function app.search_allowed() returns boolean
language sql stable security definer set search_path = audit, crm, app, pg_catalog as $$
  select (select count(*) from audit.read_log l where l.actor_id = app.current_user_id() and l.kind = 'search' and l.at > now() - interval '1 minute')
       < coalesce((select (value #>> '{}')::int from crm.settings where key = 'security.search_per_minute'), 30)
$$;

-- ============================================================ 2) SEG-01: Administración por partes, jerarquía, entidad legal, agencia, partner
alter table crm.memberships drop constraint memberships_role_check;
alter table crm.memberships add constraint memberships_role_check
  check (role in ('admin','lt','market_lead','supervisor','rep','ops','agency','partner'));

create table crm.agencies (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  name          text not null,
  pipeline_id   uuid references crm.pipelines(id),      -- su embudo: si está puesto, sus negocios solo nacen ahí
  territory_id  uuid references crm.territories(id),    -- su región: si está puesta, sus comercios nacen con ese territorio
  is_active     boolean not null default true,
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now(),
  unique (market_code, name)
);

alter table crm.memberships
  add column admin_areas text[] check (admin_areas is null or (role = 'admin' and admin_areas <@ array['access','config','audit','integrations']::text[] and cardinality(admin_areas) > 0)),
  add column legal_entity_id uuid references crm.legal_entities(id),
  add column agency_id uuid references crm.agencies(id),
  add column scope_account_id uuid references crm.accounts(id),
  add constraint memberships_agency_check check ((role = 'agency') = (agency_id is not null)),
  add constraint memberships_partner_check check ((role = 'partner') = (scope_account_id is not null));
alter table crm.teams add column parent_team_id uuid references crm.teams(id) check (parent_team_id is null or parent_team_id <> id);
alter table crm.accounts add column recruited_agency_id uuid references crm.agencies(id);
alter table crm.leads add column recruited_agency_id uuid references crm.agencies(id), add column anonymized_at timestamptz;
alter table crm.deals add column recruited_agency_id uuid references crm.agencies(id);
alter table crm.contacts add column anonymized_at timestamptz;
create index accounts_agency_idx on crm.accounts (recruited_agency_id) where recruited_agency_id is not null;
create index leads_agency_idx on crm.leads (recruited_agency_id) where recruited_agency_id is not null;

create or replace function app.active_memberships_x()
returns table (id uuid, market_code text, role text, team_id uuid, admin_areas text[], legal_entity_id uuid, agency_id uuid, scope_account_id uuid)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select m.id, m.market_code, m.role, m.team_id, m.admin_areas, m.legal_entity_id, m.agency_id, m.scope_account_id
    from crm.memberships m
    join crm.users u on u.id = m.user_id and u.is_active
   where m.user_id = app.current_user_id()
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
$$;

-- Administración completa: el rol sin partes. Quien tiene solo una parte no pasa por aquí; pasa por app.has_area().
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships_x() where role = 'admin' and admin_areas is null)
$$;

create or replace function app.has_area(p_area text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships_x() where role = 'admin' and (admin_areas is null or p_area = any(admin_areas)))
$$;

create or replace function app.write_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','supervisor','rep','ops','agency')), '{}')
         end
$$;

-- Una agencia que lleva registros cuenta como dueña vigente de lo suyo.
create or replace function app.owner_roles() returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array['rep','supervisor','market_lead','ops','agency']::text[]
$$;

-- Supervisión de varios niveles: quien supervisa un equipo ve también a los equipos que cuelgan de él.
create or replace function app.supervised_user_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with recursive mine as (
    select team_id as id from app.active_memberships() where role = 'supervisor' and team_id is not null
    union
    select t.id from crm.teams t join mine on t.parent_team_id = mine.id
  )
  select array(
    select app.current_user_id()
    union
    select m.user_id
      from crm.memberships m
     where m.team_id in (select id from mine)
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
  )
$$;

create or replace function app.my_agency_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(select agency_id from app.active_memberships_x() where role = 'agency'), '{}')
$$;

create or replace function app.partner_root_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(select scope_account_id from app.active_memberships_x() where role = 'partner'), '{}')
$$;

-- Mercados donde la persona NO está limitada a una entidad legal (rol global, o al menos un rol del mercado sin entidad).
create or replace function app.entity_open_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_global()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships_x() where legal_entity_id is null), '{}')
         end
$$;
create or replace function app.my_entity_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(select legal_entity_id from app.active_memberships_x() where legal_entity_id is not null), '{}')
$$;

-- Equipo de cuenta: quién más trabaja un comercio además de quien lo lleva, y con qué permiso.
create table crm.account_team (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  user_id      uuid not null references crm.users(id),
  function     text not null default 'support' check (function in ('support','specialist','operations','executive','other')),
  access       text not null default 'read' check (access in ('read','edit')),
  note         text,
  added_by     uuid references crm.users(id),
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz
);
create unique index account_team_one_active on crm.account_team (account_id, user_id) where valid_to is null;
create index account_team_user_idx on crm.account_team (user_id) where valid_to is null;

create or replace function app.team_account_ids(p_edit boolean) returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(
    select at.account_id from crm.account_team at
     where at.user_id = app.current_user_id() and at.valid_to is null and (not p_edit or at.access = 'edit')
       and at.market_code = any(app.my_markets())
  ), '{}')
$$;

create policy accounts_team_read on crm.accounts for select to contigo_app
  using (id = any((select app.team_account_ids(false))::uuid[]));
create policy accounts_team_upd on crm.accounts for update to contigo_app
  using (id = any((select app.team_account_ids(true))::uuid[]))
  with check (id = any((select app.team_account_ids(true))::uuid[]));
create policy accounts_agency_read on crm.accounts for select to contigo_app
  using (recruited_agency_id = any((select app.my_agency_ids())::uuid[]));
create policy accounts_partner_read on crm.accounts for select to contigo_app
  using (id = any((select app.partner_root_ids())::uuid[]) or ancestor_ids && (select app.partner_root_ids())::uuid[]);
create policy leads_agency_read on crm.leads for select to contigo_app
  using (recruited_agency_id = any((select app.my_agency_ids())::uuid[]));
-- Alcance por entidad legal: se suma con AND a todo lo anterior. Un comercio sin entidad legal no queda escondido.
create policy accounts_entity_scope on crm.accounts as restrictive for select to contigo_app using (
  legal_entity_id is null
  or market_code = any((select app.entity_open_markets())::text[])
  or legal_entity_id = any((select app.my_entity_ids())::uuid[])
);

/** La regla de quién ve un comercio, en una sola función (la usan las funciones que leen por encima de RLS). Una prueba la compara con las políticas. */
create or replace function app.can_see_account(p_account uuid) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (
    select 1 from crm.accounts a
     where a.id = p_account
       and (a.market_code = any(app.full_markets())
            or (a.market_code = any(app.team_markets())
                and (a.owner_id is null or a.owner_id = any(app.supervised_user_ids())
                     or not ((a.market_code || ':' || a.owner_id::text) = any(app.team_owner_keys()))))
            or a.owner_id = app.current_user_id()
            or (a.owner_id is null and a.territory_id = any(app.my_territory_ids()))
            or a.ancestor_ids && app.scope_parent_ids()
            or a.id = any(app.team_account_ids(false))
            or a.recruited_agency_id = any(app.my_agency_ids())
            or a.id = any(app.partner_root_ids()) or a.ancestor_ids && app.partner_root_ids())
       and (a.legal_entity_id is null or a.market_code = any(app.entity_open_markets()) or a.legal_entity_id = any(app.my_entity_ids()))
  )
$$;

/** Quién arma el equipo de una cuenta: quien la lleva, su supervisión o quien lidera el mercado. */
create or replace function app.can_manage_account(p_account uuid) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (
    select 1 from crm.accounts a
     where a.id = p_account
       and (a.owner_id = app.current_user_id()
            or exists (select 1 from app.active_memberships() m where m.role in ('market_lead') and m.market_code = a.market_code)
            or app.is_admin()
            or (a.market_code = any(app.team_markets()) and a.owner_id = any(app.supervised_user_ids())))
  )
$$;

-- Lo que crea una persona de agencia queda marcado con su agencia, en su embudo y en su región.
create or replace function crm.stamp_agency() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_agency crm.agencies;
begin
  select a.* into v_agency from crm.agencies a
   where a.id = (select m.agency_id from app.active_memberships_x() m where m.role = 'agency' and m.market_code = new.market_code limit 1)
     and not exists (select 1 from app.active_memberships_x() o where o.role <> 'agency' and (o.market_code = new.market_code or o.market_code is null));
  if v_agency.id is not null then
    new.recruited_agency_id := v_agency.id;
    if tg_table_name = 'accounts' then
      if v_agency.territory_id is not null then new.territory_id := v_agency.territory_id; end if;
    elsif tg_table_name = 'deals' then
      if v_agency.pipeline_id is not null and new.pipeline_id <> v_agency.pipeline_id then
        raise exception 'agency works only in its own pipeline' using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'deals' then
    if new.recruited_agency_id is null then
      select a.recruited_agency_id into new.recruited_agency_id from crm.accounts a where a.id = new.account_id;
    end if;
  end if;
  return new;
end $$;
create trigger accounts_stamp_agency before insert on crm.accounts for each row execute function crm.stamp_agency();
create trigger leads_stamp_agency before insert on crm.leads for each row execute function crm.stamp_agency();
create trigger deals_stamp_agency before insert on crm.deals for each row execute function crm.stamp_agency();

-- E4.F9: quién aprobó el asiento (quien tiene el presupuesto), con fecha y referencia.
create table crm.seat_approvals (
  membership_id  uuid primary key references crm.memberships(id),
  approver_name  text not null check (length(btrim(approver_name)) between 2 and 120),
  approved_on    date not null,
  reference      text,
  recorded_by    uuid not null references crm.users(id),
  recorded_at    timestamptz not null default now()
);

-- ============================================================ 3) SEG-02: campos sensibles en tabla aparte, sin lectura directa
create table crm.sensitive_fields (
  key             text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  label_es        text not null,
  label_en        text not null,
  view_roles      text[] not null default '{}',
  edit_roles      text[] not null default '{}',
  owner_can_view  boolean not null default true,
  owner_can_edit  boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
insert into crm.sensitive_fields (key, label_es, label_en, view_roles, edit_roles, owner_can_view, owner_can_edit) values
  ('commercial_terms', 'Términos comerciales', 'Commercial terms', '{admin,market_lead,supervisor}', '{admin,market_lead}', true, true),
  ('agreed_commission', 'Comisión acordada', 'Agreed commission', '{admin,market_lead}', '{admin,market_lead}', true, false);

create table crm.account_sensitive (
  account_id   uuid not null references crm.accounts(id),
  field_key    text not null references crm.sensitive_fields(key),
  market_code  text not null references crm.markets(code),
  value        text not null check (length(value) between 1 and 2000),
  cipher       text not null default 'none',          -- 'none' mientras el cifrado con llaves gestionadas esté apagado
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  primary key (account_id, field_key)
);

create or replace function app.sensitive_can(p_key text, p_account uuid, p_mode text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.can_see_account(p_account) and exists (
    select 1 from crm.sensitive_fields f join crm.accounts a on a.id = p_account
     where f.key = p_key and f.is_active
       and ((case when p_mode = 'edit' then f.owner_can_edit else f.owner_can_view end and a.owner_id = app.current_user_id())
            or exists (select 1 from app.active_memberships_x() m
                        where (m.market_code = a.market_code or m.market_code is null)
                          and (m.role <> 'admin' or m.admin_areas is null)
                          and m.role = any(case when p_mode = 'edit' then f.edit_roles else f.view_roles end)))
  )
$$;

/** Lo que se muestra tapado: qué campos sensibles tiene el comercio y qué puede hacer quien mira. Nunca el valor. */
create or replace function app.sensitive_list(p_account uuid)
returns table (field_key text, label_es text, label_en text, has_value boolean, can_view boolean, can_edit boolean, updated_at timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select f.key, f.label_es, f.label_en, s.account_id is not null,
         app.sensitive_can(f.key, p_account, 'view'), app.sensitive_can(f.key, p_account, 'edit'), s.updated_at
    from crm.sensitive_fields f
    left join crm.account_sensitive s on s.field_key = f.key and s.account_id = p_account
   where f.is_active and app.can_see_account(p_account)
     and (app.sensitive_can(f.key, p_account, 'view') or app.sensitive_can(f.key, p_account, 'edit'))
   order by f.label_es
$$;

/** Revelar: pide motivo, deja evento en la bitácora y en el registro de lecturas, y solo entonces devuelve el valor. */
create or replace function app.sensitive_reveal(p_account uuid, p_key text, p_reason text)
returns table (value text, cipher text)
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare v_value text; v_cipher text; v_market text;
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if not app.sensitive_can(p_key, p_account, 'view') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select s.value, s.cipher, s.market_code into v_value, v_cipher, v_market from crm.account_sensitive s where s.account_id = p_account and s.field_key = p_key;
  if v_value is null then return; end if;
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
  values (app.current_user_id(), 'sensitive.revealed', 'account', p_account, v_market, jsonb_build_object('field', p_key, 'reason', btrim(p_reason)));
  perform app.log_read('reveal', 'account_sensitive', 1, v_market, jsonb_build_object('field', p_key, 'account_id', p_account));
  return query select v_value, v_cipher;
end $$;

create or replace function app.sensitive_set(p_account uuid, p_key text, p_value text, p_cipher text default 'none') returns void
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare v_market text; v_had boolean;
begin
  if not app.sensitive_can(p_key, p_account, 'edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select a.market_code into v_market from crm.accounts a where a.id = p_account;
  if not (v_market = any(app.write_markets())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select true into v_had from crm.account_sensitive s where s.account_id = p_account and s.field_key = p_key;
  insert into crm.account_sensitive (account_id, field_key, market_code, value, cipher, updated_by)
  values (p_account, p_key, v_market, p_value, p_cipher, app.current_user_id())
  on conflict (account_id, field_key) do update set value = excluded.value, cipher = excluded.cipher, updated_by = excluded.updated_by, updated_at = now();
  -- El evento dice qué campo cambió y quién; el valor no se copia a la bitácora.
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
  values (app.current_user_id(), 'sensitive.updated', 'account', p_account, v_market, jsonb_build_object('field', p_key, 'replaced', coalesce(v_had, false)));
end $$;

-- ============================================================ 4) SEG-04: consentimiento, baja y retención
create table crm.consents (
  id              uuid primary key default app.uuid_v7(),
  market_code     text not null references crm.markets(code),
  contact_id      uuid references crm.contacts(id),
  lead_id         uuid references crm.leads(id),
  channel         text not null check (channel in ('email','phone','sms','whatsapp')),
  category        text not null check (category in ('service','marketing')),
  source          text not null check (source in ('web_form','verbal','written','import')),
  evidence        text check (evidence is null or length(evidence) <= 500),
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_reason  text,
  recorded_by     uuid references crm.users(id),
  created_at      timestamptz not null default now(),
  check (contact_id is not null or lead_id is not null)
);
create index consents_contact_idx on crm.consents (contact_id) where contact_id is not null;
create index consents_lead_idx on crm.consents (lead_id) where lead_id is not null;

-- Baja: se guarda por canal y dirección, para que valga aunque el contacto se duplique o se vuelva a capturar.
create table crm.contact_suppressions (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  channel       text not null check (channel in ('email','phone','sms','whatsapp','all')),
  address_norm  text not null check (length(address_norm) between 3 and 320),
  reason        text,
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now(),
  lifted_at     timestamptz,
  lifted_by     uuid references crm.users(id)
);
create unique index contact_suppressions_active on crm.contact_suppressions (channel, address_norm) where lifted_at is null;

/** Lo que todo envío a un contacto pregunta antes de salir. Una baja manda siempre; lo comercial además pide consentimiento vigente. */
create or replace function app.may_contact(p_channel text, p_address text, p_category text default 'service')
returns table (ok boolean, why text)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with a as (select lower(btrim(coalesce(p_address, ''))) as addr)
  select case when a.addr = '' then false
              when exists (select 1 from crm.contact_suppressions s where s.lifted_at is null and s.address_norm = a.addr and s.channel in (p_channel, 'all')) then false
              when p_category = 'marketing' and not exists (
                     select 1 from crm.consents c
                       left join crm.contacts ct on ct.id = c.contact_id
                       left join crm.leads l on l.id = c.lead_id
                      where c.revoked_at is null and c.channel = p_channel and c.category = 'marketing'
                        and a.addr in (lower(ct.email::text), ct.phone, lower(l.email::text), l.phone)) then false
              else true end,
         case when a.addr = '' then 'no_address'
              when exists (select 1 from crm.contact_suppressions s where s.lifted_at is null and s.address_norm = a.addr and s.channel in (p_channel, 'all')) then 'opted_out'
              when p_category = 'marketing' and not exists (
                     select 1 from crm.consents c
                       left join crm.contacts ct on ct.id = c.contact_id
                       left join crm.leads l on l.id = c.lead_id
                      where c.revoked_at is null and c.channel = p_channel and c.category = 'marketing'
                        and a.addr in (lower(ct.email::text), ct.phone, lower(l.email::text), l.phone)) then 'no_consent'
              else 'ok' end
    from a
$$;

-- El consentimiento que entra por un formulario web queda también como registro propio, por canal y categoría.
create or replace function crm.lead_consent_row() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.consent_at is not null and (tg_op = 'INSERT' or old.consent_at is null) then
    insert into crm.consents (market_code, lead_id, channel, category, source, evidence, granted_at, recorded_by)
    values (new.market_code, new.id, 'email', 'marketing', 'web_form', left(new.consent_text, 500), new.consent_at, app.current_user_id());
  end if;
  return null;
end $$;
create trigger leads_consent_row after insert or update of consent_at on crm.leads for each row execute function crm.lead_consent_row();
insert into crm.consents (market_code, lead_id, channel, category, source, evidence, granted_at)
  select l.market_code, l.id, 'email', 'marketing', 'web_form', left(l.consent_text, 500), l.consent_at from crm.leads l where l.consent_at is not null;

create table crm.retention_rules (
  key           text primary key,
  label_es      text not null,
  label_en      text not null,
  action        text not null check (action in ('anonymize','archive')),
  after_days    int check (after_days is null or after_days between 30 and 3650),   -- el plazo lo define Legal: nace vacío
  is_active     boolean not null default false,
  updated_by    uuid references crm.users(id),
  updated_at    timestamptz,
  last_run_at   timestamptz,
  last_done     int,
  check (not is_active or after_days is not null)
);
insert into crm.retention_rules (key, label_es, label_en, action) values
  ('leads_disqualified', 'Leads descartados: se anonimiza la persona de contacto', 'Disqualified leads: the contact person is anonymized', 'anonymize'),
  ('contacts_unlinked', 'Contactos que ya no están en ningún comercio: se anonimizan', 'Contacts no longer linked to any merchant: anonymized', 'anonymize'),
  ('suppressions_lifted', 'Bajas levantadas: se archivan', 'Lifted opt-outs: archived', 'archive');

create or replace function app.retention_candidates(p_key text, p_days int)
returns table (kind text, id uuid, label text, since timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select 'lead'::text, l.id, l.business_name, l.updated_at from crm.leads l
   where p_key = 'leads_disqualified' and l.status = 'disqualified' and l.anonymized_at is null
     and l.updated_at < now() - make_interval(days => p_days)
  union all
  select 'contact'::text, c.id, '#' || left(c.id::text, 8), c.created_at from crm.contacts c
   where p_key = 'contacts_unlinked' and c.anonymized_at is null and c.created_at < now() - make_interval(days => p_days)
     and not exists (select 1 from crm.account_contacts ac where ac.contact_id = c.id and (ac.valid_to is null or ac.valid_to > now() - make_interval(days => p_days)))
  union all
  select 'suppression'::text, s.id, s.channel, s.lifted_at from crm.contact_suppressions s
   where p_key = 'suppressions_lifted' and s.lifted_at is not null and s.lifted_at < now() - make_interval(days => p_days) and s.address_norm <> '[archivado]'
$$;

create or replace function app.anonymize_contact(p_contact uuid) returns void
language sql security definer set search_path = crm, app, pg_catalog as $$
  update crm.contacts set full_name = '[anonimizado]', phone = null, email = null, anonymized_at = now() where id = p_contact and anonymized_at is null;
  update crm.consents set evidence = null, revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, 'anonymized') where contact_id = p_contact;
$$;
create or replace function app.anonymize_lead(p_lead uuid) returns void
language sql security definer set search_path = crm, app, pg_catalog as $$
  update crm.leads set contact_name = '[anonimizado]', phone = null, email = null, message = null, anonymized_at = now(), updated_at = updated_at
   where id = p_lead and anonymized_at is null;
  update crm.consents set evidence = null, revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, 'anonymized') where lead_id = p_lead;
$$;

/** Vista previa: cuántos registros tocaría la regla con el plazo dado, sin cambiar nada. */
create or replace function app.retention_preview(p_key text, p_days int default null)
returns table (total int, sample jsonb)
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare v_days int;
begin
  if not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(p_days, r.after_days) into v_days from crm.retention_rules r where r.key = p_key;
  if v_days is null then return query select 0, '[]'::jsonb; return; end if;
  return query
    select (select count(*)::int from app.retention_candidates(p_key, v_days)),
           coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'label', x.label, 'since', x.since))
                       from (select * from app.retention_candidates(p_key, v_days) order by since limit 8) x), '[]'::jsonb);
end $$;

create or replace function app.retention_apply(p_key text) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r crm.retention_rules; c record; n int := 0;
begin
  if not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from crm.retention_rules where key = p_key for update;
  if not found or not r.is_active or r.after_days is null then return 0; end if;
  for c in select * from app.retention_candidates(p_key, r.after_days) loop
    if c.kind = 'lead' then perform app.anonymize_lead(c.id);
    elsif c.kind = 'contact' then perform app.anonymize_contact(c.id);
    else update crm.contact_suppressions set address_norm = '[archivado]', reason = null where id = c.id;
    end if;
    n := n + 1;
  end loop;
  update crm.retention_rules set last_run_at = now(), last_done = n where key = p_key;
  if n > 0 then
    insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
    values (app.current_user_id(), 'retention.applied', 'retention_rule', null, null, jsonb_build_object('rule', p_key, 'records', n, 'after_days', r.after_days));
  end if;
  return n;
end $$;

-- ============================================================ 5) SEG-09: solicitudes de titulares
create table crm.subject_requests (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  kind             text not null check (kind in ('access','rectification','erasure')),
  subject_name     text not null check (length(btrim(subject_name)) between 2 and 160),
  subject_contact  text check (subject_contact is null or length(subject_contact) <= 200),
  contact_id       uuid references crm.contacts(id),
  lead_id          uuid references crm.leads(id),
  detail           text check (detail is null or length(detail) <= 2000),
  received_on      date not null,
  due_on           date,                                 -- el plazo por país lo define Legal: sin plazo cargado queda vacío
  status           text not null default 'received' check (status in ('received','in_progress','done','rejected')),
  assignee_id      uuid references crm.users(id),
  resolution       text check (resolution is null or length(resolution) <= 2000),
  exported_at      timestamptz,
  anonymized_at    timestamptz,
  created_by       uuid not null references crm.users(id),
  created_at       timestamptz not null default now(),
  closed_by        uuid references crm.users(id),
  closed_at        timestamptz,
  check ((status in ('done','rejected')) = (closed_at is not null))
);

/** Todo lo que CONTIGO guarda de la persona de una solicitud, para entregárselo. Deja registro de que se sacó. */
create or replace function app.subject_export(p_request uuid) returns jsonb
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare r crm.subject_requests; v jsonb;
begin
  if not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from crm.subject_requests where id = p_request;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  v := jsonb_build_object(
    'request', jsonb_build_object('id', r.id, 'kind', r.kind, 'market', r.market_code, 'received_on', r.received_on),
    'contact', (select to_jsonb(c) - 'created_by' from crm.contacts c where c.id = r.contact_id),
    'merchants', coalesce((select jsonb_agg(jsonb_build_object('merchant', a.name, 'role', ac.role, 'from', ac.valid_from, 'to', ac.valid_to))
                             from crm.account_contacts ac join crm.accounts a on a.id = ac.account_id where ac.contact_id = r.contact_id), '[]'::jsonb),
    'lead', (select jsonb_build_object('business_name', l.business_name, 'contact_name', l.contact_name, 'phone', l.phone, 'email', l.email,
                                       'locality', l.locality, 'message', l.message, 'source', l.source, 'status', l.status, 'created_at', l.created_at)
               from crm.leads l where l.id = r.lead_id),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('channel', c.channel, 'category', c.category, 'source', c.source, 'evidence', c.evidence,
                                                              'granted_at', c.granted_at, 'revoked_at', c.revoked_at))
                            from crm.consents c where (r.contact_id is not null and c.contact_id = r.contact_id) or (r.lead_id is not null and c.lead_id = r.lead_id)), '[]'::jsonb));
  update crm.subject_requests set exported_at = now() where id = p_request;
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
  values (app.current_user_id(), 'subject_request.exported', 'subject_request', p_request, r.market_code, jsonb_build_object('kind', r.kind));
  perform app.log_read('subject_export', 'subject_request', 1, r.market_code, jsonb_build_object('request_id', p_request));
  return v;
end $$;

create or replace function audit.redact(p jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case when p is null then null else
    (select coalesce(jsonb_object_agg(e.key, case when e.key in ('full_name','contact_name','phone','email','message','subject_name','subject_contact','evidence')
                                                  and jsonb_typeof(e.value) <> 'null' then '"[anonimizado]"'::jsonb else e.value end), '{}'::jsonb)
       from jsonb_each(p) e) end
$$;

/**
 * Eliminación: se anonimiza el dato y se conserva el hecho. El contacto y el lead pierden nombre, teléfono, correo y mensaje;
 * los IDs, los montos, quién hizo qué y cuándo se quedan. En las bitácoras se tapan esos mismos datos en las filas de esa persona.
 */
create or replace function app.subject_anonymize(p_request uuid) returns int
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare r crm.subject_requests; n int := 0; k int;
begin
  if not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from crm.subject_requests where id = p_request for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if r.kind <> 'erasure' or r.status <> 'in_progress' or (r.contact_id is null and r.lead_id is null) then
    raise exception 'request is not an erasure in progress with a linked person' using errcode = '22023';
  end if;
  if r.contact_id is not null then perform app.anonymize_contact(r.contact_id); end if;
  if r.lead_id is not null then perform app.anonymize_lead(r.lead_id); end if;
  perform set_config('audit.redaction_ref', p_request::text, true);
  update audit.data_log set before = audit.redact(before), after = audit.redact(after), redacted_at = now(), redaction_ref = p_request
   where redacted_at is null and ((table_name = 'contacts' and row_id = r.contact_id::text) or (table_name = 'leads' and row_id = r.lead_id::text));
  get diagnostics k = row_count; n := n + k;
  update crm.audit_events set before = audit.redact(before), after = audit.redact(after), redacted_at = now(), redaction_ref = p_request
   where redacted_at is null and object_id in (r.contact_id, r.lead_id) and object in ('contact','lead');
  get diagnostics k = row_count; n := n + k;
  perform set_config('audit.redaction_ref', '', true);
  update crm.subject_requests set anonymized_at = now(), subject_contact = null where id = p_request;
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
  values (app.current_user_id(), 'subject_request.anonymized', 'subject_request', p_request, r.market_code, jsonb_build_object('log_rows_redacted', n));
  return n;
end $$;

-- ============================================================ 6) SEG-07: "ver como", accesos sin uso y recertificación
create table crm.view_as_sessions (
  id          uuid primary key default app.uuid_v7(),
  actor_id    uuid not null references crm.users(id),
  target_id   uuid not null references crm.users(id),
  reason      text not null check (length(btrim(reason)) >= 10),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz,
  check (actor_id <> target_id)
);

create or replace function app.view_as_start(p_target uuid, p_reason text, p_minutes int) returns uuid
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare v_id uuid; v_min int := least(greatest(coalesce(p_minutes, 15), 5), 60);
begin
  if not app.has_area('access') then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_target = app.current_user_id() or not exists (select 1 from crm.users u where u.id = p_target and u.is_active and not u.is_system) then
    raise exception 'not a person to view as' using errcode = '22023';
  end if;
  update crm.view_as_sessions set ended_at = now() where actor_id = app.current_user_id() and ended_at is null;
  insert into crm.view_as_sessions (actor_id, target_id, reason, expires_at)
  values (app.current_user_id(), p_target, btrim(p_reason), now() + make_interval(mins => v_min)) returning id into v_id;
  insert into crm.audit_events (actor_id, action, object, object_id, after)
  values (app.current_user_id(), 'view_as.started', 'user', p_target, jsonb_build_object('reason', btrim(p_reason), 'minutes', v_min, 'session_id', v_id));
  perform app.log_read('view_as', 'user', 1, null, jsonb_build_object('target_id', p_target, 'session_id', v_id));
  return v_id;
end $$;

create or replace function app.view_as_current(p_id uuid, p_actor uuid)
returns table (target_id uuid, expires_at timestamptz, actor_name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select s.target_id, s.expires_at, a.full_name
    from crm.view_as_sessions s
    join crm.users a on a.id = s.actor_id and a.is_active
    join crm.users t on t.id = s.target_id and t.is_active and not t.is_system
   where s.id = p_id and s.actor_id = p_actor and s.ended_at is null and s.expires_at > now()
     and exists (select 1 from crm.memberships m where m.user_id = s.actor_id and m.role = 'admin'
                  and (m.admin_areas is null or 'access' = any(m.admin_areas)) and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$$;

create or replace function app.view_as_end(p_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_target uuid;
begin
  update crm.view_as_sessions set ended_at = now() where id = p_id and actor_id = p_actor and ended_at is null returning target_id into v_target;
  if v_target is not null then
    insert into crm.audit_events (actor_id, action, object, object_id, after)
    values (p_actor, 'view_as.ended', 'user', v_target, jsonb_build_object('session_id', p_id));
  end if;
end $$;

create table crm.access_reviews (
  id           uuid primary key default app.uuid_v7(),
  market_code  text references crm.markets(code),          -- null = roles sin mercado (Administración, Leadership)
  opened_at    timestamptz not null default now(),
  opened_by    uuid references crm.users(id),
  due_on       date not null,
  closed_at    timestamptz,
  closed_by    uuid references crm.users(id),
  note         text
);
create table crm.access_review_items (
  id              uuid primary key default app.uuid_v7(),
  review_id       uuid not null references crm.access_reviews(id),
  market_code     text references crm.markets(code),
  membership_id   uuid not null references crm.memberships(id),
  user_id         uuid not null references crm.users(id),
  role            text not null,
  last_active_at  timestamptz,
  decision        text check (decision in ('keep','remove')),
  decided_by      uuid references crm.users(id),
  decided_at      timestamptz,
  note            text,
  unique (review_id, membership_id)
);

/** Quién acusa la revisión de un mercado: quien lo lidera. La de los roles sin mercado, quien administra accesos. */
create or replace function app.can_review_access(p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.has_area('access')
      or (p_market is not null and exists (select 1 from app.active_memberships() m where m.role = 'market_lead' and m.market_code = p_market))
$$;

-- ============================================================ 7) SEG-08: llaves e inventario de secretos, sin valores
alter table crm.api_clients
  add column owner_id uuid references crm.users(id),
  add column expires_at timestamptz,
  add column last_used_at timestamptz,
  add column use_count bigint not null default 0,
  add column rotated_from uuid references crm.api_clients(id);
update crm.api_clients set owner_id = created_by where owner_id is null;
-- Una llave nace con dueño: quien la creó, salvo que se diga otra persona. Lo pone la base para que valga por cualquier vía.
create or replace function crm.api_client_owner() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.owner_id := coalesce(new.owner_id, new.created_by);
  return new;
end $$;
create trigger api_clients_owner before insert on crm.api_clients for each row execute function crm.api_client_owner();

create or replace function app.api_client(p_hash text)
returns table (id uuid, name text, scopes text[])
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.name, c.scopes from crm.api_clients c
   where c.key_hash = p_hash and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
$$;

/** Cada llamada con una llave deja su último uso y una fila en el registro de lecturas, por llave. */
create or replace function app.api_client_used(p_id uuid, p_scope text) returns void
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
begin
  update crm.api_clients set last_used_at = now(), use_count = use_count + 1 where id = p_id;
  insert into audit.read_log (actor_id, key_id, via, kind, object, row_count, detail)
  values (null, p_id, 'api', 'api', coalesce(p_scope, 'api'), 1, null);
end $$;

-- Lo que CONTIGO usa para conectarse hacia afuera. Aquí vive el nombre de la variable, su dueño y su rotación; el valor, nunca.
create table crm.secret_inventory (
  key                text primary key check (key ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  label_es           text not null,
  label_en           text not null,
  system_name        text not null,
  owner_id           uuid references crm.users(id),
  rotate_every_days  int check (rotate_every_days is null or rotate_every_days between 1 and 730),
  last_rotated_on    date,
  note               text check (note is null or length(note) <= 500),
  updated_by         uuid references crm.users(id),
  updated_at         timestamptz
);
insert into crm.secret_inventory (key, label_es, label_en, system_name) values
  ('DATABASE_URL', 'Conexión a la base de datos', 'Database connection', 'Postgres'),
  ('PIPEDRIVE_API_TOKEN', 'Llave para leer Pipedrive', 'Key to read Pipedrive', 'Pipedrive'),
  ('SUPABASE_PUBLISHABLE_KEY', 'Llave del proveedor de identidad (ingreso con Google)', 'Identity provider key (Google sign-in)', 'Supabase Auth'),
  ('MIGRATION_DATABASE_URL', 'Conexión del dueño del esquema, para migraciones', 'Schema owner connection, for migrations', 'Postgres');

-- ============================================================ 8) alertas de seguridad
create table crm.security_alerts (
  id            uuid primary key default app.uuid_v7(),
  at            timestamptz not null default now(),
  kind          text not null check (kind in ('exports_per_day','export_rows_per_day','searches_per_hour','reveals_per_day','api_calls_per_hour','key_expiring','key_unused','secret_rotation_due','direct_sql_change')),
  subject_key   text not null,                   -- persona, llave o secreto al que se refiere
  actor_id      uuid references crm.users(id),
  key_id        uuid references crm.api_clients(id),
  period        text not null,                   -- día u hora que se midió
  observed      int not null,
  threshold     int not null,
  status        text not null default 'open' check (status in ('open','acknowledged')),
  ack_by        uuid references crm.users(id),
  ack_at        timestamptz,
  ack_note      text,
  unique (kind, subject_key, period)
);
insert into crm.settings (key, value) values
  ('security.thresholds', '{"exports_per_day":5,"export_rows_per_day":5000,"searches_per_hour":120,"reveals_per_day":20,"api_calls_per_hour":2000,"key_unused_days":90,"key_expiring_days":14}'::jsonb),
  ('security.search_per_minute', '30'::jsonb),
  ('security.unused_days', '30'::jsonb),
  ('security.review_every_days', '90'::jsonb)
on conflict (key) do nothing;

/** Revisa el registro de lecturas y el inventario contra los umbrales y abre las alertas que falten. Se puede correr dos veces. */
create or replace function app.security_scan() returns int
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare th jsonb; n int := 0; k int;
begin
  if app.current_user_id() is not null and not (app.has_area('audit') or app.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select value into th from crm.settings where key = 'security.thresholds';
  th := coalesce(th, '{}'::jsonb);
  insert into crm.security_alerts (kind, subject_key, actor_id, period, observed, threshold)
  select x.kind, x.actor_id::text, x.actor_id, x.period, x.observed, (th ->> x.kind)::int from (
    select 'exports_per_day' as kind, r.actor_id, to_char(r.at, 'YYYY-MM-DD') as period, count(*)::int as observed
      from audit.read_log r where r.kind = 'export' and r.actor_id is not null and r.at > now() - interval '2 days' group by 2, 3
    union all
    select 'export_rows_per_day', r.actor_id, to_char(r.at, 'YYYY-MM-DD'), sum(r.row_count)::int
      from audit.read_log r where r.kind = 'export' and r.actor_id is not null and r.at > now() - interval '2 days' group by 2, 3
    union all
    select 'searches_per_hour', r.actor_id, to_char(r.at, 'YYYY-MM-DD HH24'), count(*)::int
      from audit.read_log r where r.kind = 'search' and r.actor_id is not null and r.at > now() - interval '1 day' group by 2, 3
    union all
    select 'reveals_per_day', r.actor_id, to_char(r.at, 'YYYY-MM-DD'), count(*)::int
      from audit.read_log r where r.kind = 'reveal' and r.actor_id is not null and r.at > now() - interval '2 days' group by 2, 3
  ) x where (th ->> x.kind) is not null and x.observed > (th ->> x.kind)::int
  on conflict (kind, subject_key, period) do update set observed = excluded.observed where crm.security_alerts.status = 'open';
  get diagnostics k = row_count; n := n + k;

  insert into crm.security_alerts (kind, subject_key, key_id, period, observed, threshold)
  select 'api_calls_per_hour', r.key_id::text, r.key_id, to_char(r.at, 'YYYY-MM-DD HH24'), count(*)::int, (th ->> 'api_calls_per_hour')::int
    from audit.read_log r where r.kind = 'api' and r.key_id is not null and r.at > now() - interval '1 day'
   group by r.key_id, to_char(r.at, 'YYYY-MM-DD HH24')
  having (th ->> 'api_calls_per_hour') is not null and count(*) > (th ->> 'api_calls_per_hour')::int
  on conflict (kind, subject_key, period) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into crm.security_alerts (kind, subject_key, key_id, period, observed, threshold)
  select 'key_expiring', c.id::text, c.id, to_char(c.expires_at, 'YYYY-MM-DD'), greatest((c.expires_at::date - now()::date), 0), (th ->> 'key_expiring_days')::int
    from crm.api_clients c
   where c.revoked_at is null and c.expires_at is not null and (th ->> 'key_expiring_days') is not null
     and c.expires_at < now() + make_interval(days => (th ->> 'key_expiring_days')::int)
  on conflict (kind, subject_key, period) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into crm.security_alerts (kind, subject_key, key_id, period, observed, threshold)
  select 'key_unused', c.id::text, c.id, to_char(now(), 'YYYY-MM'), (now()::date - coalesce(c.last_used_at, c.created_at)::date), (th ->> 'key_unused_days')::int
    from crm.api_clients c
   where c.revoked_at is null and (c.expires_at is null or c.expires_at > now()) and (th ->> 'key_unused_days') is not null
     and coalesce(c.last_used_at, c.created_at) < now() - make_interval(days => (th ->> 'key_unused_days')::int)
  on conflict (kind, subject_key, period) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into crm.security_alerts (kind, subject_key, period, observed, threshold)
  select 'secret_rotation_due', s.key, to_char(now(), 'YYYY-MM'), (now()::date - s.last_rotated_on), s.rotate_every_days
    from crm.secret_inventory s
   where s.rotate_every_days is not null and s.last_rotated_on is not null and s.last_rotated_on + s.rotate_every_days < now()::date
  on conflict (kind, subject_key, period) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Un cambio en datos de negocio que no pasó por la aplicación (consola o script): una alerta por día y tabla.
  insert into crm.security_alerts (kind, subject_key, period, observed, threshold)
  select 'direct_sql_change', l.table_name, to_char(l.at, 'YYYY-MM-DD'), count(*)::int, 0
    from audit.data_log l where l.via = 'sql' and l.at > now() - interval '2 days'
     and not exists (select 1 from app.schema_migrations sm where sm.applied_at between l.at - interval '10 minutes' and l.at + interval '10 minutes')
   group by l.table_name, to_char(l.at, 'YYYY-MM-DD')
  on conflict (kind, subject_key, period) do update set observed = excluded.observed where crm.security_alerts.status = 'open';
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

/** Umbrales y plazos de seguridad y privacidad: los cambia la parte "bitácora y privacidad", no la de configuración. */
create or replace function app.security_setting_set(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if not app.has_area('audit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key !~ '^(security|privacy)\.[a-z_.]{2,60}$' then raise exception 'unknown setting' using errcode = '22023'; end if;
  insert into crm.settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
end $$;

/** Arma los lotes de la copia fuera de la base con su huella. Con el destino apagado, el lote queda esperando en "canal apagado". */
create or replace function app.audit_archive_prepare(p_status text default 'channel_off') returns int
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare v_from bigint; v_to bigint; v_n int; v_hash text; n int := 0; t text;
begin
  if app.current_user_id() is not null and not (app.has_area('audit') or app.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  foreach t in array array['data_log','config_log'] loop
    select coalesce(max(to_id), 0) + 1 into v_from from audit.archive_batches where log_name = t;
    execute format('select max(id), count(*)::int, encode(sha256(convert_to(coalesce(string_agg(md5(l::text), '''' order by l.id), ''''), ''UTF8'')), ''hex'')
                      from (select * from audit.%I where id >= $1 order by id limit 50000) l', t) into v_to, v_n, v_hash using v_from;
    if v_n > 0 then
      insert into audit.archive_batches (log_name, from_id, to_id, row_count, sha256, status, sent_at)
      values (t, v_from, v_to, v_n, v_hash, p_status, case when p_status = 'channel_off' then null else now() end);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ============================================================ 9) RLS forzado, políticas y privilegios de lo nuevo
do $$
declare t text;
begin
  foreach t in array array['agencies','account_team','seat_approvals','sensitive_fields','account_sensitive','consents','contact_suppressions',
                           'retention_rules','subject_requests','view_as_sessions','access_reviews','access_review_items','secret_inventory','security_alerts'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
  end loop;
  foreach t in array array['data_log','config_log','read_log','archive_batches','excluded_tables'] loop
    execute format('alter table audit.%I enable row level security', t);
    execute format('alter table audit.%I force row level security', t);
  end loop;
end $$;

-- Bitácoras: lee quien tiene la parte "bitácora" de Administración o Leadership; quien lidera u opera un mercado, la de sus mercados.
create policy data_log_read on audit.data_log for select to contigo_app using (
  (select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt')
  or (market_code = any((select app.full_markets())::text[]) and not (select app.is_global()))
);
create policy config_log_read on audit.config_log for select to contigo_app using ((select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy read_log_read on audit.read_log for select to contigo_app using ((select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy archive_batches_read on audit.archive_batches for select to contigo_app using ((select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy excluded_tables_read on audit.excluded_tables for select to contigo_app using ((select app.current_user_id()) is not null);
grant select on audit.data_log, audit.config_log, audit.read_log, audit.archive_batches, audit.excluded_tables to contigo_app;

-- La bitácora de la aplicación se lee con la misma regla: la parte "bitácora", Leadership o el mercado propio.
drop policy audit_read on crm.audit_events;
create policy audit_read on crm.audit_events for select to contigo_app using (
  (select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt')
  or market_code = any((select app.full_markets())::text[])
);

-- Administración por partes: cada tabla de configuración la escribe la parte que le toca.
do $$
declare p record; v_area text;
begin
  for p in select pol.tablename, pol.policyname, pol.cmd, pol.qual, pol.with_check from pg_policies pol
            where pol.schemaname = 'crm' and (coalesce(pol.qual, '') like '%app.is_admin()%' or coalesce(pol.with_check, '') like '%app.is_admin()%') loop
    v_area := case
      when p.tablename in ('memberships','users','teams') then 'access'
      when p.tablename in ('api_clients','inbound_events','ingest_batches','outbox_events','import_runs','import_raw','external_refs') then 'integrations'
      when p.tablename in ('markets','legal_entities','territories','pipelines','stages','loss_reasons','field_definitions','routing_rules','web_forms',
                           'fx_rates','settings','products','account_types','market_hours','ops_catalog','user_territories') then 'config'
      else null end;
    if v_area is null then continue; end if;
    execute format('alter policy %I on crm.%I %s %s', p.policyname, p.tablename,
      case when p.qual is not null then 'using (' || replace(p.qual, 'app.is_admin()', format('app.has_area(%L)', v_area)) || ')' else '' end,
      case when p.with_check is not null then 'with check (' || replace(p.with_check, 'app.is_admin()', format('app.has_area(%L)', v_area)) || ')' else '' end);
  end loop;
end $$;

-- Quitar un acceso también saca a la persona de los turnos de leads: la parte Accesos puede hacer ese cambio.
alter policy routing_rules_admin_upd on crm.routing_rules
  using ((select app.has_area('config')) or (select app.has_area('access')))
  with check ((select app.has_area('config')) or (select app.has_area('access')));
-- Dar, cambiar o quitar Administración (completa o por partes) es solo de la administración completa: una parte no se da más poder.
create policy memberships_admin_grant_ins on crm.memberships as restrictive for insert to contigo_app
  with check (role <> 'admin' or (select app.is_admin()));
create policy memberships_admin_grant_upd on crm.memberships as restrictive for update to contigo_app
  using (role <> 'admin' or (select app.is_admin())) with check (role <> 'admin' or (select app.is_admin()));

create policy agencies_read on crm.agencies for select to contigo_app using ((select app.current_user_id()) is not null);
create policy agencies_ins on crm.agencies for insert to contigo_app with check ((select app.has_area('access')));
create policy agencies_upd on crm.agencies for update to contigo_app using ((select app.has_area('access'))) with check ((select app.has_area('access')));

create policy account_team_read on crm.account_team for select to contigo_app
  using (user_id = (select app.current_user_id()) or exists (select 1 from crm.accounts a where a.id = account_team.account_id));
create policy account_team_ins on crm.account_team for insert to contigo_app
  with check (added_by = (select app.current_user_id()) and app.can_manage_account(account_id) and market_code = any((select app.write_markets())::text[]));
create policy account_team_upd on crm.account_team for update to contigo_app
  using (app.can_manage_account(account_id)) with check (app.can_manage_account(account_id) and market_code = any((select app.write_markets())::text[]));

create policy seat_approvals_read on crm.seat_approvals for select to contigo_app
  using ((select app.has_area('access')) or (select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy seat_approvals_ins on crm.seat_approvals for insert to contigo_app
  with check ((select app.has_area('access')) and recorded_by = (select app.current_user_id()));

create policy sensitive_fields_read on crm.sensitive_fields for select to contigo_app using ((select app.current_user_id()) is not null);
create policy sensitive_fields_ins on crm.sensitive_fields for insert to contigo_app with check ((select app.has_area('config')));
create policy sensitive_fields_upd on crm.sensitive_fields for update to contigo_app using ((select app.has_area('config'))) with check ((select app.has_area('config')));
-- crm.account_sensitive no tiene políticas ni privilegios: solo se toca desde app.sensitive_*.

create policy consents_read on crm.consents for select to contigo_app using (
  (contact_id is not null and exists (select 1 from crm.contacts c where c.id = consents.contact_id))
  or (lead_id is not null and exists (select 1 from crm.leads l where l.id = consents.lead_id))
);
create policy consents_ins on crm.consents for insert to contigo_app with check (
  market_code = any((select app.write_markets())::text[]) and recorded_by = (select app.current_user_id())
  and ((contact_id is not null and exists (select 1 from crm.contacts c where c.id = consents.contact_id))
       or (lead_id is not null and exists (select 1 from crm.leads l where l.id = consents.lead_id)))
);
create policy consents_upd on crm.consents for update to contigo_app
  using ((contact_id is not null and exists (select 1 from crm.contacts c where c.id = consents.contact_id))
         or (lead_id is not null and exists (select 1 from crm.leads l where l.id = consents.lead_id)))
  with check (market_code = any((select app.write_markets())::text[]));

create policy contact_suppressions_read on crm.contact_suppressions for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]));
create policy contact_suppressions_ins on crm.contact_suppressions for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]) and created_by = (select app.current_user_id()));
-- Levantar una baja lo hace quien lidera el mercado o quien lleva privacidad: no quien vende.
create policy contact_suppressions_upd on crm.contact_suppressions for update to contigo_app
  using ((select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'market_lead' and m.market_code = contact_suppressions.market_code))
  with check (true);

do $$
declare t text;
begin
  foreach t in array array['retention_rules','subject_requests','security_alerts'] loop
    execute format($f$create policy %I on crm.%I for select to contigo_app
      using ((select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'))$f$, t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.has_area(''audit'')))', t || '_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.has_area(''audit''))) with check ((select app.has_area(''audit'')))', t || '_upd', t);
  end loop;
end $$;

create policy secret_inventory_read on crm.secret_inventory for select to contigo_app
  using ((select app.has_area('integrations')) or (select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy secret_inventory_upd on crm.secret_inventory for update to contigo_app
  using ((select app.has_area('integrations'))) with check ((select app.has_area('integrations')));

create policy access_reviews_read on crm.access_reviews for select to contigo_app
  using (app.can_review_access(market_code) or (select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy access_reviews_ins on crm.access_reviews for insert to contigo_app with check ((select app.has_area('access')));
create policy access_reviews_upd on crm.access_reviews for update to contigo_app
  using (app.can_review_access(market_code)) with check (app.can_review_access(market_code));
create policy access_review_items_read on crm.access_review_items for select to contigo_app
  using (app.can_review_access(market_code) or (select app.has_area('audit')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy access_review_items_ins on crm.access_review_items for insert to contigo_app with check ((select app.has_area('access')));
create policy access_review_items_upd on crm.access_review_items for update to contigo_app
  using (app.can_review_access(market_code)) with check (app.can_review_access(market_code));

revoke all on all tables in schema audit from public;
grant select, insert, update on crm.agencies, crm.account_team, crm.sensitive_fields, crm.consents, crm.contact_suppressions, crm.retention_rules,
  crm.subject_requests, crm.security_alerts, crm.access_reviews, crm.access_review_items to contigo_app;
grant select, insert on crm.seat_approvals to contigo_app;
grant select, update on crm.secret_inventory to contigo_app;
revoke all on crm.account_sensitive, crm.view_as_sessions from contigo_app;
revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to contigo_app;
revoke execute on function app.anonymize_contact(uuid), app.anonymize_lead(uuid), app.retention_candidates(text, int) from contigo_app;
revoke execute on all functions in schema audit from public, contigo_app;

-- Al final, cuando todas las tablas existen: el trigger de bitácora en cada tabla de crm que no esté excluida.
select audit.attach_all();
