-- 0045_plataforma: lo que quedaba abierto de la plataforma (ola 7).
-- 1) AUT-02: cursor de la cola por transacción confirmada (xid8), no por id con margen de tiempo. Cada consumidor guarda su
--    horizonte: todo evento de una transacción anterior al horizonte ya se procesó; lo que está entre el horizonte y la
--    transacción abierta más vieja se anota uno por uno. Una transacción larga que confirma tarde ya no queda saltada.
--    Señales en vivo (crm.live_signals) para refrescar pantallas; Broadcast hacia afuera va detrás de su adaptador.
-- 2) AUT-05: reglas de aviso por evento de la cola (crm.event_notice_rules): el servicio de avisos se alimenta del outbox.
-- 3) UX-02: teléfono exacto en E.164 con índice; texto completo con índice GIN en comercios, leads y negocios.
-- 4) SEG-02: datos reservados también en negocio y contacto (crm.record_sensitive), con las mismas reglas que en comercio.
-- 5) SEG-08: suplente del responsable de cada conexión. GOB-04: flags por rol y mercado (crm.feature_flags).
-- 6) Valores propuestos con su dueño (crm.platform_values). GOB-07: prueba de restauración local registrada.
-- 7) IA-06: OAuth 2.1 con PKCE para que un agente entre al servidor MCP como la persona.
-- 8) IA-07: revisión de red-team por agente, requisito para encenderlo.

-- ------------------------------------------------------------------ 1) AUT-02
alter table crm.outbox_events add column txid xid8 not null default pg_current_xact_id();
create index outbox_txid_idx on crm.outbox_events (txid, id);

create table crm.outbox_consumers (
  consumer    text primary key check (consumer ~ '^[a-z][a-z0-9_.]{2,40}$'),
  horizon     xid8 not null,
  taken       bigint not null default 0,
  updated_at  timestamptz not null default now()
);
create table crm.outbox_consumed (
  consumer  text not null references crm.outbox_consumers(consumer),
  event_id  uuid not null references crm.outbox_events(id),
  txid      xid8 not null,
  primary key (consumer, event_id)
);
create index outbox_consumed_txid_idx on crm.outbox_consumed (consumer, txid);
alter table crm.outbox_consumers enable row level security;
alter table crm.outbox_consumers force row level security;
alter table crm.outbox_consumed enable row level security;
alter table crm.outbox_consumed force row level security;
revoke all on crm.outbox_consumers, crm.outbox_consumed from contigo_app;
grant select on crm.outbox_consumers to contigo_app;
create policy outbox_consumers_read on crm.outbox_consumers for select to contigo_app using ((select app.is_admin()));
-- crm.outbox_consumed no tiene privilegios para la app: solo la escribe app.outbox_take.

/**
 * Toma hasta p_limit eventos nuevos para un consumidor y los anota como tomados en la misma transacción (si la transacción
 * del consumidor se revierte, la anotación también). Solo mira eventos de transacciones ya terminadas (txid menor que la
 * transacción abierta más vieja); cuando no queda nada pendiente debajo de ese punto, el horizonte avanza y las anotaciones
 * viejas se borran. La primera vez empieza desde ahora: los eventos viejos no disparan nada nuevo.
 */
create or replace function app.outbox_take(p_consumer text, p_limit int)
returns table (id uuid, event_type text, aggregate text, aggregate_id uuid, market_code text, payload jsonb, version int, created_at timestamptz)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare v_h xid8; v_x xid8; v_n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_x := pg_snapshot_xmin(pg_current_snapshot());
  select c.horizon into v_h from crm.outbox_consumers c where c.consumer = p_consumer for update;
  if v_h is null then
    insert into crm.outbox_consumers (consumer, horizon) values (p_consumer, v_x) on conflict do nothing;
    return;
  end if;
  return query
    with picked as (
      select e.id, e.event_type, e.aggregate, e.aggregate_id, e.market_code, e.payload, e.version, e.created_at, e.txid
        from crm.outbox_events e
       where e.txid >= v_h and e.txid < v_x
         and not exists (select 1 from crm.outbox_consumed d where d.consumer = p_consumer and d.event_id = e.id)
       order by e.txid, e.id
       limit greatest(p_limit, 1)
    ), mark as (
      insert into crm.outbox_consumed (consumer, event_id, txid) select p_consumer, p.id, p.txid from picked p
    )
    select p.id, p.event_type, p.aggregate, p.aggregate_id, p.market_code, p.payload, p.version, p.created_at from picked p order by p.txid, p.id;
  get diagnostics v_n = row_count;
  update crm.outbox_consumers c set taken = c.taken + v_n, updated_at = now(),
         horizon = case when v_n < greatest(p_limit, 1) then v_x else c.horizon end
   where c.consumer = p_consumer;
  if v_n < greatest(p_limit, 1) then
    delete from crm.outbox_consumed d where d.consumer = p_consumer and d.txid < v_x;
  end if;
end $$;
revoke all on function app.outbox_take(text, int) from public;
grant execute on function app.outbox_take(text, int) to contigo_app;

/** Cuántos eventos le faltan a cada consumidor (para Estado de CONTIGO). */
create or replace function app.outbox_lag()
returns table (consumer text, pending bigint, taken bigint, updated_at timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.consumer,
         (select count(*) from crm.outbox_events e where e.txid >= c.horizon
            and not exists (select 1 from crm.outbox_consumed d where d.consumer = c.consumer and d.event_id = e.id)),
         c.taken, c.updated_at
    from crm.outbox_consumers c
   where app.is_admin() or app.is_global()
   order by c.consumer
$$;
revoke all on function app.outbox_lag() from public;
grant execute on function app.outbox_lag() to contigo_app;

-- Señales en vivo: un renglón por tema (mercado y tipo de registro) con la hora del último cambio. No lleva datos de nadie.
create table crm.live_signals (
  topic        text primary key check (char_length(topic) between 3 and 80),
  market_code  text references crm.markets(code),
  last_at      timestamptz not null default now(),
  n            bigint not null default 0
);
alter table crm.live_signals enable row level security;
alter table crm.live_signals force row level security;
revoke all on crm.live_signals from contigo_app;
grant select, insert, update on crm.live_signals to contigo_app;
create policy live_signals_read on crm.live_signals for select to contigo_app
  using (market_code is null or market_code = any(app.my_markets()) or (select app.current_user_id()) = (select app.system_user_id()));
create policy live_signals_ins on crm.live_signals for insert to contigo_app with check ((select app.current_user_id()) = (select app.system_user_id()));
create policy live_signals_upd on crm.live_signals for update to contigo_app
  using ((select app.current_user_id()) = (select app.system_user_id())) with check ((select app.current_user_id()) = (select app.system_user_id()));

insert into audit.excluded_tables (table_name, reason) values
  ('outbox_consumers', 'Cursor de cada consumidor de la cola: cambia en cada pasada y no es un dato de negocio.'),
  ('outbox_consumed', 'Anotación técnica de lo que un consumidor ya tomó de la cola.'),
  ('live_signals', 'Marca de la hora del último cambio por tema, para refrescar pantallas.')
on conflict do nothing;

-- ------------------------------------------------------------------ 2) AUT-05: avisos desde la cola
create table crm.event_notice_rules (
  id          uuid primary key default app.uuid_v7(),
  event_type  text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  notice_kind text not null check (notice_kind ~ '^[a-z_]{3,40}$'),
  audience    text not null check (audience in ('owner', 'market_leads', 'admins')),
  title_es    text not null check (char_length(title_es) between 3 and 120),
  title_en    text not null check (char_length(title_en) between 3 and 120),
  body_es     text not null check (char_length(body_es) between 3 and 400),
  body_en     text not null check (char_length(body_en) between 3 and 400),
  is_active   boolean not null default false,
  updated_by  uuid references crm.users(id),
  updated_at  timestamptz,
  unique (event_type, audience)
);
alter table crm.event_notice_rules enable row level security;
alter table crm.event_notice_rules force row level security;
revoke all on crm.event_notice_rules from contigo_app;
grant select, update (is_active, updated_by, updated_at) on crm.event_notice_rules to contigo_app;
create policy event_notice_rules_read on crm.event_notice_rules for select to contigo_app
  using ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()));
create policy event_notice_rules_upd on crm.event_notice_rules for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
-- Propuestas, apagadas: administración decide cuáles encender.
insert into crm.event_notice_rules (event_type, notice_kind, audience, title_es, title_en, body_es, body_en) values
  ('deal.lost', 'lifecycle', 'owner', 'Se cerró un negocio sin alta', 'A deal was closed without sign-up', 'Revisa el motivo en el negocio.', 'Check the reason on the deal.'),
  ('account.owner_changed', 'lifecycle', 'owner', 'Ahora llevas este comercio', 'You now own this merchant', 'Revisa su ficha y su próximo paso.', 'Check its record and its next step.'),
  ('api_client.created', 'security_alert', 'admins', 'Se creó una llave de API', 'An API key was created', 'Revisa quién la creó y sus permisos en Integraciones.', 'Check who created it and its scopes in Integrations.');

-- ------------------------------------------------------------------ 3) UX-02
create index if not exists accounts_phone_idx on crm.accounts (phone) where phone is not null;
create index if not exists contacts_phone_idx on crm.contacts (phone) where phone is not null;
create index if not exists leads_phone_idx on crm.leads (phone) where phone is not null;
alter table crm.accounts add column search_tsv tsvector generated always as (to_tsvector('simple'::regconfig, coalesce(name_norm, '') || ' ' || coalesce(address_norm, ''))) stored;
alter table crm.leads add column search_tsv tsvector generated always as (to_tsvector('simple'::regconfig, lower(coalesce(business_name, '') || ' ' || coalesce(contact_name, '')))) stored;
alter table crm.deals add column search_tsv tsvector generated always as (to_tsvector('simple'::regconfig, lower(coalesce(title, '')))) stored;
create index accounts_search_tsv_idx on crm.accounts using gin (search_tsv);
create index leads_search_tsv_idx on crm.leads using gin (search_tsv);
create index deals_search_tsv_idx on crm.deals using gin (search_tsv);

/** "Existe y lo lleva X" con teléfono exacto: el número llega ya normalizado a E.164 (una o varias lecturas por mercado). */
create or replace function app.search_others_exact(p_term text, p_phones text[])
returns table (kind text, id uuid, name text, locality text, owner_name text, market_code text)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with t as (
    select btrim(translate(app.norm(coalesce(p_term, '')), '%_\', '')) as n,
           coalesce(p_phones, '{}') as phones,
           app.current_user_id() as me,
           coalesce((select array_agg(distinct am.market_code) from app.active_memberships() am
                      where am.role in ('rep','supervisor','market_lead')), '{}') as mk
  ), acc as (
    select 'account'::text as kind, a.id, a.name, a.locality, u.full_name as owner_name, a.market_code
      from crm.accounts a join crm.users u on u.id = a.owner_id cross join t
     where t.me is not null and a.market_code = any(t.mk) and a.archived_at is null and a.merged_into is null
       and a.owner_id <> t.me
       and (a.recruited_agency_id is null or a.market_code = any(app.full_markets()))
       and ((length(t.n) >= 3 and a.name_norm like '%' || t.n || '%') or a.phone = any(t.phones))
     order by a.name limit 5
  ), ld as (
    select 'lead'::text as kind, l.id, l.business_name as name, l.locality, u.full_name as owner_name, l.market_code
      from crm.leads l join crm.users u on u.id = l.owner_id cross join t
     where t.me is not null and l.market_code = any(t.mk) and l.status in ('new','contacted','qualified')
       and l.owner_id <> t.me
       and (l.recruited_agency_id is null or l.market_code = any(app.full_markets()))
       and ((length(t.n) >= 3 and app.norm(l.business_name) like '%' || t.n || '%') or l.phone = any(t.phones))
     order by l.business_name limit 5
  )
  select * from acc union all select * from ld
$$;
revoke all on function app.search_others_exact(text, text[]) from public;
grant execute on function app.search_others_exact(text, text[]) to contigo_app;

-- ------------------------------------------------------------------ 4) SEG-02: datos reservados en negocio y contacto
alter table crm.sensitive_fields add column applies_to text[] not null default '{account}'
  check (applies_to <> '{}' and applies_to <@ array['account','deal','contact']);
insert into crm.sensitive_fields (key, label_es, label_en, view_roles, edit_roles, owner_can_view, owner_can_edit, applies_to) values
  ('deal_commission_split', 'Reparto de comisión del negocio', 'Deal commission split', '{admin,market_lead}', '{admin,market_lead}', false, false, '{deal}'),
  ('deal_special_terms', 'Condiciones especiales del negocio', 'Deal special terms', '{admin,market_lead,supervisor}', '{admin,market_lead}', true, false, '{deal}'),
  ('contact_private_note', 'Nota reservada del contacto', 'Private contact note', '{admin,market_lead,supervisor}', '{admin,market_lead,supervisor}', false, false, '{contact}');

create table crm.record_sensitive (
  object       text not null check (object in ('deal', 'contact')),
  object_id    uuid not null,
  field_key    text not null references crm.sensitive_fields(key),
  market_code  text references crm.markets(code),
  value        text not null check (length(value) between 1 and 2000),
  cipher       text not null default 'none',
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  primary key (object, object_id, field_key)
);
alter table crm.record_sensitive enable row level security;
alter table crm.record_sensitive force row level security;
revoke all on crm.record_sensitive from contigo_app;
-- Sin privilegios para la app: solo las funciones app.record_sensitive_*.

/** Quién ve el registro y quién lo lleva: un negocio por su comercio y su dueño; un contacto por los comercios a los que está ligado. */
create or replace function app.record_scope(p_object text, p_id uuid)
returns table (visible boolean, owner_id uuid, market_code text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.can_see_account(d.account_id), d.owner_id, d.market_code from crm.deals d where p_object = 'deal' and d.id = p_id
  union all
  select exists (select 1 from crm.account_contacts ac where ac.contact_id = c.id and ac.valid_to is null and app.can_see_account(ac.account_id)),
         null::uuid,
         (select a.market_code from crm.account_contacts ac join crm.accounts a on a.id = ac.account_id where ac.contact_id = c.id and ac.valid_to is null order by ac.account_id limit 1)
    from crm.contacts c where p_object = 'contact' and c.id = p_id
$$;

create or replace function app.record_sensitive_can(p_object text, p_id uuid, p_key text, p_mode text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce((
    select s.visible and exists (
      select 1 from crm.sensitive_fields f
       where f.key = p_key and f.is_active and p_object = any(f.applies_to)
         and ((case when p_mode = 'edit' then f.owner_can_edit else f.owner_can_view end and s.owner_id = app.current_user_id())
              or exists (select 1 from app.active_memberships_x() m
                          where (m.market_code = s.market_code or m.market_code is null)
                            and (m.role <> 'admin' or m.admin_areas is null)
                            and m.role = any(case when p_mode = 'edit' then f.edit_roles else f.view_roles end))))
      from app.record_scope(p_object, p_id) s limit 1), false)
$$;

create or replace function app.record_sensitive_list(p_object text, p_id uuid)
returns table (field_key text, label_es text, label_en text, has_value boolean, can_view boolean, can_edit boolean, updated_at timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select f.key, f.label_es, f.label_en, s.object_id is not null,
         app.record_sensitive_can(p_object, p_id, f.key, 'view'), app.record_sensitive_can(p_object, p_id, f.key, 'edit'), s.updated_at
    from crm.sensitive_fields f
    left join crm.record_sensitive s on s.object = p_object and s.object_id = p_id and s.field_key = f.key
   where f.is_active and p_object = any(f.applies_to)
     and (app.record_sensitive_can(p_object, p_id, f.key, 'view') or app.record_sensitive_can(p_object, p_id, f.key, 'edit'))
   order by f.label_es
$$;

create or replace function app.record_sensitive_reveal(p_object text, p_id uuid, p_key text, p_reason text)
returns table (value text, cipher text)
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare v_value text; v_cipher text; v_market text;
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if not app.record_sensitive_can(p_object, p_id, p_key, 'view') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select s.value, s.cipher, s.market_code into v_value, v_cipher, v_market from crm.record_sensitive s
   where s.object = p_object and s.object_id = p_id and s.field_key = p_key;
  if v_value is null then return; end if;
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
  values (app.current_user_id(), 'sensitive.revealed', p_object, p_id, v_market, jsonb_build_object('field', p_key, 'reason', btrim(p_reason)));
  perform app.log_read('reveal', p_object, 1, v_market, jsonb_build_object('field', p_key));
  return query select v_value, v_cipher;
end $$;

create or replace function app.record_sensitive_set(p_object text, p_id uuid, p_key text, p_value text, p_cipher text default 'none') returns void
language plpgsql security definer set search_path = crm, app, audit, pg_catalog as $$
declare v_market text; v_had boolean;
begin
  if not app.record_sensitive_can(p_object, p_id, p_key, 'edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select s.market_code into v_market from app.record_scope(p_object, p_id) s limit 1;
  if v_market is not null and not (v_market = any(app.write_markets())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select true into v_had from crm.record_sensitive s where s.object = p_object and s.object_id = p_id and s.field_key = p_key;
  if p_value is null or btrim(p_value) = '' then
    delete from crm.record_sensitive s where s.object = p_object and s.object_id = p_id and s.field_key = p_key;
  else
    insert into crm.record_sensitive (object, object_id, field_key, market_code, value, cipher, updated_by)
    values (p_object, p_id, p_key, v_market, p_value, p_cipher, app.current_user_id())
    on conflict (object, object_id, field_key) do update set value = excluded.value, cipher = excluded.cipher, updated_by = excluded.updated_by, updated_at = now();
  end if;
  -- El valor nunca entra a la bitácora: solo qué campo y si ya tenía valor.
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, before, after)
  values (app.current_user_id(), 'sensitive.set', p_object, p_id, v_market, jsonb_build_object('field', p_key, 'had_value', coalesce(v_had, false)),
          jsonb_build_object('field', p_key, 'has_value', not (p_value is null or btrim(p_value) = '')));
end $$;
revoke all on function app.record_scope(text, uuid), app.record_sensitive_can(text, uuid, text, text), app.record_sensitive_list(text, uuid),
  app.record_sensitive_reveal(text, uuid, text, text), app.record_sensitive_set(text, uuid, text, text, text) from public;
grant execute on function app.record_sensitive_list(text, uuid), app.record_sensitive_reveal(text, uuid, text, text),
  app.record_sensitive_set(text, uuid, text, text, text) to contigo_app;

-- ------------------------------------------------------------------ 5) SEG-08 y GOB-04
alter table crm.secret_inventory add column backup_owner_id uuid references crm.users(id),
  add column rotation_alerted_on date,
  add constraint secret_inventory_two_people check (owner_id is null or backup_owner_id is null or owner_id <> backup_owner_id);
grant update (backup_owner_id) on crm.secret_inventory to contigo_app;

create table crm.feature_flags (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  label_es    text not null check (char_length(label_es) between 3 and 120),
  label_en    text not null check (char_length(label_en) between 3 and 120),
  enabled     boolean not null default false,
  -- Vacío = todos los roles / todos los mercados.
  roles       text[] not null default '{}' check (roles <@ array['admin','lt','market_lead','supervisor','rep','ops','agency','partner']),
  markets     text[] not null default '{}',
  updated_by  uuid references crm.users(id),
  updated_at  timestamptz
);
alter table crm.feature_flags enable row level security;
alter table crm.feature_flags force row level security;
revoke all on crm.feature_flags from contigo_app;
grant select, update (enabled, roles, markets, updated_by, updated_at) on crm.feature_flags to contigo_app;
create policy feature_flags_read on crm.feature_flags for select to contigo_app using (true);
create policy feature_flags_upd on crm.feature_flags for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
insert into crm.feature_flags (key, label_es, label_en, enabled) values
  ('live_updates', 'Pantallas que se actualizan solas cuando cambia algo', 'Screens that refresh by themselves when something changes', true),
  ('optimistic_actions', 'Acciones rápidas que se ven al instante y se deshacen si fallan', 'Quick actions that show instantly and roll back if they fail', true);

-- ------------------------------------------------------------------ 6) valores propuestos con su dueño
create table crm.platform_values (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  label_es    text not null,
  label_en    text not null,
  help_es     text not null,
  help_en     text not null,
  kind        text not null check (kind in ('boolean', 'days', 'text')),
  value       jsonb,
  -- Mientras sea propuesta, la pantalla dice "Valor propuesto" y Estado de CONTIGO la lista con su dueño.
  proposed    boolean not null default true,
  owner_label text not null check (char_length(owner_label) between 3 and 80),
  updated_by  uuid references crm.users(id),
  updated_at  timestamptz
);
alter table crm.platform_values enable row level security;
alter table crm.platform_values force row level security;
revoke all on crm.platform_values from contigo_app;
grant select, update (value, proposed, updated_by, updated_at) on crm.platform_values to contigo_app;
create policy platform_values_read on crm.platform_values for select to contigo_app using (true);
create policy platform_values_upd on crm.platform_values for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
insert into crm.platform_values (key, label_es, label_en, help_es, help_en, kind, value, owner_label) values
  ('offline_read_cache', 'Lectura sin señal en el teléfono', 'Offline reading on the phone',
   'Si está encendido, el teléfono guarda la última ficha abierta para leerla sin señal. Apagado mientras Seguridad no decida.',
   'When on, the phone keeps the last record opened to read it without signal. Off until Security decides.', 'boolean', 'false', 'Seguridad'),
  ('audit_retention_days', 'Cuánto se guarda la bitácora', 'How long the audit log is kept',
   'Vacío: no se borra nada. El plazo lo fijan Legal y Seguridad.', 'Empty: nothing is deleted. Legal and Security set the period.', 'days', null, 'Legal y Seguridad'),
  ('staging_has_real_data', 'El ambiente de pruebas tiene datos reales', 'The test environment holds real data',
   'Mientras esté encendido, Estado de CONTIGO lo avisa arriba. Se apaga cuando el ambiente pase a datos sintéticos.',
   'While on, CONTIGO status warns about it at the top. It goes off when the environment moves to synthetic data.', 'boolean', 'false', 'Michael Essiet o Dan Mulligan'),
  ('secret_owners', 'Responsable y suplente de cada conexión', 'Owner and backup for each connection',
   'Se cargan en Seguridad, Llaves. Mientras falten, la conexión sale como pendiente.', 'They are set in Security, Keys. While missing, the connection shows as pending.', 'text', null, 'Yamil'),
  ('recovery_objectives', 'Objetivos de recuperación (RPO y RTO) y de servicio', 'Recovery (RPO and RTO) and service objectives',
   'Se fijan en Gobierno, Servicio, con quién los acordó y cuándo.', 'They are set in Governance, Service, with who agreed and when.', 'text', null, 'Dan Mulligan'),
  ('tax_id_full_exception', 'Excepción para guardar el identificador fiscal completo', 'Exception to keep the full tax ID',
   'Sin excepción escrita se guardan solo los últimos 4. Ver docs/excepcion-id-fiscal.md.', 'Without a written exception only the last 4 are kept. See docs/excepcion-id-fiscal.md.', 'text', null, 'Legal y Seguridad');

-- GOB-07: la prueba de restauración automatizada corre en local contra la base de prueba y queda registrada.
alter table crm.restore_tests drop constraint if exists restore_tests_environment_check;
alter table crm.restore_tests add constraint restore_tests_environment_check check (environment in ('staging', 'production', 'local'));
alter table crm.restore_tests add column counts jsonb;

-- ------------------------------------------------------------------ 7) IA-06: OAuth 2.1 con PKCE para el servidor MCP
create table crm.mcp_oauth_clients (
  client_id     text primary key check (client_id ~ '^mcpc_[A-Za-z0-9_-]{16,64}$'),
  name          text not null check (char_length(name) between 3 and 80),
  redirect_uris text[] not null check (array_length(redirect_uris, 1) between 1 and 5),
  created_by    uuid not null references crm.users(id),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create table crm.mcp_oauth_codes (
  code_hash      text primary key,
  client_id      text not null references crm.mcp_oauth_clients(client_id),
  user_id        uuid not null references crm.users(id),
  redirect_uri   text not null,
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  scope          text not null default 'crm:read',
  expires_at     timestamptz not null,
  used_at        timestamptz
);
create table crm.mcp_oauth_tokens (
  token_hash    text primary key,
  client_id     text not null references crm.mcp_oauth_clients(client_id),
  user_id       uuid not null references crm.users(id),
  scope         text not null default 'crm:read',
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
alter table crm.mcp_oauth_clients enable row level security;
alter table crm.mcp_oauth_clients force row level security;
alter table crm.mcp_oauth_codes enable row level security;
alter table crm.mcp_oauth_codes force row level security;
alter table crm.mcp_oauth_tokens enable row level security;
alter table crm.mcp_oauth_tokens force row level security;
revoke all on crm.mcp_oauth_clients, crm.mcp_oauth_codes, crm.mcp_oauth_tokens from contigo_app;
grant select, insert, update (revoked_at) on crm.mcp_oauth_clients to contigo_app;
create policy mcp_oauth_clients_read on crm.mcp_oauth_clients for select to contigo_app using ((select app.is_admin()));
create policy mcp_oauth_clients_ins on crm.mcp_oauth_clients for insert to contigo_app with check ((select app.is_admin()) and created_by = (select app.current_user_id()));
create policy mcp_oauth_clients_upd on crm.mcp_oauth_clients for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update (revoked_at) on crm.mcp_oauth_tokens to contigo_app;
-- La persona ve y revoca sus propios permisos de agentes.
create policy mcp_oauth_tokens_own on crm.mcp_oauth_tokens for select to contigo_app using (user_id = (select app.current_user_id()) or (select app.is_admin()));
create policy mcp_oauth_tokens_rev on crm.mcp_oauth_tokens for update to contigo_app using (user_id = (select app.current_user_id()) or (select app.is_admin()))
  with check (user_id = (select app.current_user_id()) or (select app.is_admin()));

/** La persona con sesión autoriza a un cliente: deja un código de un solo uso, de 5 minutos, atado al reto PKCE (S256). */
create or replace function app.mcp_oauth_issue_code(p_client text, p_redirect text, p_challenge text, p_code_hash text)
returns void
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if app.current_user_id() is null or app.current_user_id() = app.system_user_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from crm.mcp_oauth_clients c where c.client_id = p_client and c.revoked_at is null and p_redirect = any(c.redirect_uris)) then
    raise exception 'unknown client or redirect' using errcode = '22023';
  end if;
  insert into crm.mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
  values (p_code_hash, p_client, app.current_user_id(), p_redirect, p_challenge, now() + interval '5 minutes');
  insert into crm.audit_events (actor_id, action, object, after)
  values (app.current_user_id(), 'mcp_oauth.authorized', 'mcp_oauth_client', jsonb_build_object('client_id', p_client));
end $$;

/** Canje del código (sin sesión): devuelve el reto guardado y a quién pertenece; el código queda usado aunque falle la verificación. */
create or replace function app.mcp_oauth_redeem(p_code_hash text, p_client text, p_redirect text)
returns table (user_id uuid, code_challenge text, scope text)
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r crm.mcp_oauth_codes%rowtype;
begin
  select * into r from crm.mcp_oauth_codes c where c.code_hash = p_code_hash for update;
  if r.code_hash is null or r.used_at is not null or r.expires_at < now() or r.client_id <> p_client or r.redirect_uri <> p_redirect then
    if r.code_hash is not null then update crm.mcp_oauth_codes set used_at = coalesce(used_at, now()) where code_hash = p_code_hash; end if;
    return;
  end if;
  update crm.mcp_oauth_codes set used_at = now() where code_hash = p_code_hash;
  return query select r.user_id, r.code_challenge, r.scope;
end $$;

create or replace function app.mcp_oauth_store_token(p_token_hash text, p_client text, p_user uuid, p_scope text, p_minutes int)
returns void
language sql security definer set search_path = crm, app, pg_catalog as $$
  insert into crm.mcp_oauth_tokens (token_hash, client_id, user_id, scope, expires_at)
  values (p_token_hash, p_client, p_user, p_scope, now() + make_interval(mins => least(greatest(p_minutes, 5), 60)))
$$;

/** El token de acceso de un agente: a quién representa, si sigue vigente y si la persona sigue activa. */
create or replace function app.mcp_oauth_user(p_token_hash text)
returns table (user_id uuid, client_id text, scope text)
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  return query
    update crm.mcp_oauth_tokens t set last_used_at = now()
      from crm.users u, crm.mcp_oauth_clients c
     where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > now()
       and u.id = t.user_id and u.is_active and c.client_id = t.client_id and c.revoked_at is null
    returning t.user_id, t.client_id, t.scope;
end $$;
revoke all on function app.mcp_oauth_issue_code(text, text, text, text), app.mcp_oauth_redeem(text, text, text),
  app.mcp_oauth_store_token(text, text, uuid, text, int), app.mcp_oauth_user(text) from public;
grant execute on function app.mcp_oauth_issue_code(text, text, text, text), app.mcp_oauth_redeem(text, text, text),
  app.mcp_oauth_store_token(text, text, uuid, text, int), app.mcp_oauth_user(text) to contigo_app;

-- ------------------------------------------------------------------ 8) IA-07: red-team por agente
create table crm.agent_redteam_reviews (
  id           uuid primary key default app.uuid_v7(),
  agent_key    text not null check (agent_key ~ '^[a-z_]{3,60}$'),
  checklist    jsonb not null,
  passed       boolean not null,
  notes        text check (notes is null or char_length(notes) <= 2000),
  reviewed_by  uuid not null references crm.users(id),
  reviewed_at  timestamptz not null default now()
);
create index agent_redteam_reviews_agent_idx on crm.agent_redteam_reviews (agent_key, reviewed_at desc);
alter table crm.agent_redteam_reviews enable row level security;
alter table crm.agent_redteam_reviews force row level security;
revoke all on crm.agent_redteam_reviews from contigo_app;
grant select, insert on crm.agent_redteam_reviews to contigo_app;
create policy agent_redteam_read on crm.agent_redteam_reviews for select to contigo_app using ((select app.is_global()) or (select app.is_admin()));
create policy agent_redteam_ins on crm.agent_redteam_reviews for insert to contigo_app with check ((select app.is_admin()) and reviewed_by = (select app.current_user_id()));

select audit.attach_all();
