-- 0001_core: esquema base de axexo CONTIGO.
-- Reglas del estándar: DATA-01..09, AUTHZ-02, REL-06, REL-07, OBS-03, PORT-03.
-- Todo vive fuera de "public" para que ninguna API automática lo exponga (PORT-02).

create schema if not exists app;
create schema if not exists crm;
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;
create extension if not exists citext with schema public;

-- DATA-09: UUID v7 (ordenable por tiempo) sin depender de la versión del motor.
create or replace function app.uuid_v7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
              from 1 for 6),
      52, 1), 53, 1), 'hex')::uuid
$$;

create or replace function app.norm(t text) returns text
language sql stable set search_path = public, extensions, pg_catalog as $$
  select lower(unaccent(coalesce(t, '')))
$$;

-- ---------------------------------------------------------------- mercados
create table crm.markets (
  code            text primary key check (code ~ '^[A-Z]{2}$'),
  name            text not null,
  currency        char(3) not null,
  default_locale  text not null check (default_locale in ('es','en','pt')),
  locales         text[] not null default '{es}',
  timezone        text not null,                              -- zona IANA (DATA-04)
  data_region     text not null default 'us-east-1',          -- DATA-02 / COMP-01
  privacy_notice_version text,                                -- DATA-02: [pendiente: Legal]
  phone_cc        text not null,
  status          text not null default 'live' check (status in ('live','planned')),
  flags           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table crm.legal_entities (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  name         text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- identidad
create table crm.users (
  id            uuid primary key default app.uuid_v7(),
  email         citext not null unique,
  full_name     text not null,
  locale        text not null default 'es' check (locale in ('es','en')),
  is_active     boolean not null default true,
  is_system     boolean not null default false,
  is_synthetic  boolean not null default false,
  auth_subject  text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table crm.teams (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  name         text not null,
  motor        text not null,
  created_at   timestamptz not null default now(),
  unique (market_code, name)
);

create table crm.territories (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  code         text not null,
  name         text not null,
  unique (market_code, code)
);

-- AUTHZ-02: los permisos viven en tablas de membresía con vigencia, no en el código.
create table crm.memberships (
  id           uuid primary key default app.uuid_v7(),
  user_id      uuid not null references crm.users(id),
  market_code  text references crm.markets(code),          -- null = global
  role         text not null check (role in ('admin','lt','market_lead','supervisor','rep','ops')),
  team_id      uuid references crm.teams(id),
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz,
  created_at   timestamptz not null default now(),
  check ((role in ('admin','lt')) = (market_code is null))
);
create index memberships_user_idx on crm.memberships (user_id);
create index memberships_team_idx on crm.memberships (team_id);

create table crm.user_territories (
  user_id       uuid not null references crm.users(id),
  territory_id  uuid not null references crm.territories(id),
  primary key (user_id, territory_id)
);

-- Sesiones opacas (solo guarda el hash del token).
create table crm.sessions (
  token_hash  text primary key,
  user_id     uuid not null references crm.users(id),
  kind        text not null check (kind in ('persona','sso')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create table crm.settings (
  key    text primary key,
  value  jsonb not null
);

-- ---------------------------------------------------------------- cuentas
create table crm.accounts (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  legal_entity_id  uuid references crm.legal_entities(id),
  parent_id        uuid references crm.accounts(id),
  ancestor_ids     uuid[] not null default '{}',            -- DAT-01: cadena de ancestros, raíz primero
  kind             text not null check (kind in ('organization','distributor','chain','store')),
  name             text not null,
  name_norm        text not null default '',
  segment          text,
  lifecycle        text not null default 'prospect'
                   check (lifecycle in ('prospect','onboarding','active','at_risk','inactive','churned')),
  lifecycle_at     timestamptz not null default now(),
  owner_id         uuid references crm.users(id),
  territory_id     uuid references crm.territories(id),
  phone            text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),   -- DATA-05
  email            citext,
  address_line     text,
  locality         text,
  region           text,
  postal_code      text,
  country          char(2),
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  tax_id_last4     text check (tax_id_last4 is null or tax_id_last4 ~ '^[A-Z0-9]{1,4}$'),
  tax_id_blind_ix  text,                                    -- DATA-06: índice ciego; el valor completo no se guarda aquí
  custom           jsonb not null default '{}'::jsonb,      -- DATA-08
  merged_into      uuid references crm.accounts(id),
  archived_at      timestamptz,
  created_by       uuid references crm.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index accounts_market_owner_idx on crm.accounts (market_code, owner_id);
create index accounts_parent_idx on crm.accounts (parent_id);
create index accounts_ancestors_idx on crm.accounts using gin (ancestor_ids);
create index accounts_territory_idx on crm.accounts (territory_id);
create index accounts_lifecycle_idx on crm.accounts (market_code, lifecycle);
create index accounts_name_trgm on crm.accounts using gin (name_norm gin_trgm_ops);  -- PERF-05
create index accounts_phone_idx on crm.accounts (phone);

-- DAT-01: la relación padre-hijo guarda vigencia; el padre actual se refleja en accounts.parent_id.
create table crm.account_links (
  id          uuid primary key default app.uuid_v7(),
  child_id    uuid not null references crm.accounts(id),
  parent_id   uuid not null references crm.accounts(id),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  created_by  uuid references crm.users(id)
);
create index account_links_child_idx on crm.account_links (child_id);

-- DAT-03: ID canónico (accounts.id) y alias de sistemas externos.
create table crm.account_aliases (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  system       text not null check (system in ('sales_core','s5','pipedrive','zoho','emida','sky','movilway','other')),
  external_id  text not null,
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz
);
create unique index account_aliases_live_uq on crm.account_aliases (system, external_id) where valid_to is null;
create index account_aliases_account_idx on crm.account_aliases (account_id);

create table crm.contacts (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  full_name    text not null,
  phone        text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  email        citext,
  created_by   uuid references crm.users(id),
  created_at   timestamptz not null default now()
);

-- DAT-02: el vínculo contacto-cuenta lleva rol y vigencia.
create table crm.account_contacts (
  id                 uuid primary key default app.uuid_v7(),
  account_id         uuid not null references crm.accounts(id),
  contact_id         uuid not null references crm.contacts(id),
  market_code        text not null references crm.markets(code),
  role               text not null default 'staff' check (role in ('owner','decision_maker','manager','staff','billing')),
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz
);
create index account_contacts_account_idx on crm.account_contacts (account_id);

-- CANAL-03: atribución en tres capas con fecha efectiva.
create table crm.account_attributions (
  id              uuid primary key default app.uuid_v7(),
  account_id      uuid not null references crm.accounts(id),
  market_code     text not null references crm.markets(code),
  layer           text not null check (layer in ('origin','channel','owner')),
  party_kind      text not null check (party_kind in ('user','team','partner','form','import')),
  party_ref       text not null,
  party_label     text not null,
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  created_by      uuid references crm.users(id)
);
create index account_attr_account_idx on crm.account_attributions (account_id, layer);

-- ---------------------------------------------------------------- embudo
create table crm.pipelines (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  motor        text not null,
  name         text not null,
  position     int not null default 0,
  unique (market_code, motor)
);

create table crm.stages (
  id               uuid primary key default app.uuid_v7(),
  pipeline_id      uuid not null references crm.pipelines(id),
  position         int not null,
  code             text not null,
  name_es          text not null,
  name_en          text not null,
  kind             text not null check (kind in ('open','awaiting_txn','won','lost')),
  probability      int not null default 0 check (probability between 0 and 100),
  rot_days         int not null default 14,
  required_fields  text[] not null default '{}',
  exit_es          text not null default '',
  exit_en          text not null default '',
  unique (pipeline_id, position),
  unique (pipeline_id, code)
);

create table crm.loss_reasons (
  id           uuid primary key default app.uuid_v7(),
  code         text not null unique,
  kind         text not null check (kind in ('lost','no_sale')),
  label_es     text not null,
  label_en     text not null,
  market_code  text references crm.markets(code),
  is_active    boolean not null default true
);

create table crm.routing_rules (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  name         text not null,
  strategy     text not null check (strategy in ('round_robin','territory','fixed')),
  member_ids   uuid[] not null default '{}',
  cursor       int not null default 0,
  fallback_id  uuid references crm.users(id),
  sla_minutes  int not null default 60,
  is_active    boolean not null default true
);

create table crm.web_forms (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name             text not null,
  motor            text not null,
  locale           text not null default 'es',
  routing_rule_id  uuid references crm.routing_rules(id),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table crm.leads (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  account_id       uuid references crm.accounts(id),          -- LEAD-01: el prospecto vive en la cuenta
  source           text not null check (source in ('web_form','manual','import','referral','sales_app')),
  form_id          uuid references crm.web_forms(id),
  motor            text not null,
  business_name    text not null,
  contact_name     text not null,
  phone            text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  email            citext,
  locality         text,
  message          text,
  status           text not null default 'new' check (status in ('new','contacted','qualified','disqualified','converted')),
  disqualify_code  text references crm.loss_reasons(code),
  owner_id         uuid references crm.users(id),
  assigned_at      timestamptz,
  sla_due_at       timestamptz,
  first_touch_at   timestamptz,
  duplicate_of     uuid references crm.accounts(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index leads_market_status_idx on crm.leads (market_code, status);
create index leads_owner_idx on crm.leads (owner_id);

create table crm.deals (
  id                   uuid primary key default app.uuid_v7(),
  market_code          text not null references crm.markets(code),
  pipeline_id          uuid not null references crm.pipelines(id),
  stage_id             uuid not null references crm.stages(id),
  account_id           uuid not null references crm.accounts(id),
  lead_id              uuid references crm.leads(id),
  owner_id             uuid references crm.users(id),
  title                text not null,
  amount_minor         bigint check (amount_minor is null or amount_minor >= 0),   -- DATA-03
  currency             char(3) not null,
  status               text not null default 'open' check (status in ('open','won','lost')),
  loss_reason_code     text references crm.loss_reasons(code),
  loss_note            text,
  next_step            text,
  next_step_due        date,
  decision_maker_id    uuid references crm.contacts(id),
  decision_maker_met   boolean not null default false,
  revisit_needed       boolean not null default false,
  revisit_reason       text,
  revisit_due          date,
  stage_entered_at     timestamptz not null default now(),
  won_at               timestamptz,
  lost_at              timestamptz,
  closed_by            text check (closed_by in ('transaction','manual')),
  custom               jsonb not null default '{}'::jsonb,
  created_by           uuid references crm.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (status <> 'lost' or loss_reason_code is not null)
);
create index deals_pipeline_stage_idx on crm.deals (pipeline_id, stage_id) where status = 'open';
create index deals_account_idx on crm.deals (account_id);
create index deals_owner_idx on crm.deals (owner_id);

-- REP-02: cada cambio de etapa es un evento; no se sobreescribe la historia.
create table crm.deal_stage_events (
  id             uuid primary key default app.uuid_v7(),
  deal_id        uuid not null references crm.deals(id),
  market_code    text not null references crm.markets(code),
  from_stage_id  uuid references crm.stages(id),
  to_stage_id    uuid not null references crm.stages(id),
  actor_id       uuid references crm.users(id),
  cause          text not null default 'user' check (cause in ('user','transaction','rule','import')),
  at             timestamptz not null default now()
);
create index deal_stage_events_deal_idx on crm.deal_stage_events (deal_id, at);

create table crm.activities (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  account_id   uuid references crm.accounts(id),
  deal_id      uuid references crm.deals(id),
  lead_id      uuid references crm.leads(id),
  kind         text not null check (kind in ('note','call','meeting','task','email','handoff','system')),
  subject      text not null,
  body         text,
  due_at       timestamptz,
  done_at      timestamptz,
  owner_id     uuid references crm.users(id),
  created_by   uuid references crm.users(id),
  source       text not null default 'user' check (source in ('user','rule','sales_app','s5','import')),
  created_at   timestamptz not null default now()
);
create index activities_account_idx on crm.activities (account_id, created_at desc);
create index activities_owner_open_idx on crm.activities (owner_id, due_at) where done_at is null;

-- CAMPO-01: la visita la registra la Sales App; aquí solo se lee (principio "la visita se registra una vez").
create table crm.visits (
  id                  uuid primary key default app.uuid_v7(),
  market_code         text not null references crm.markets(code),
  account_id          uuid not null references crm.accounts(id),
  external_visit_id   text not null unique,
  salesperson_ref     text not null,
  user_id             uuid references crm.users(id),
  business_date       date not null,
  checked_in_at       timestamptz not null,
  checked_out_at      timestamptz,
  duration_seconds    int,
  outcome             text not null check (outcome in ('sale','no_sale','open')),
  rejection_code      text references crm.loss_reasons(code),
  revisit             boolean not null default false,
  revisit_reason      text,
  decision_maker_seen boolean,
  auto_closed         boolean not null default false,
  note                text,
  inbound_event_id    uuid,
  created_at          timestamptz not null default now()
);
create index visits_account_idx on crm.visits (account_id, checked_in_at desc);
create index visits_user_idx on crm.visits (user_id, business_date);

-- ---------------------------------------------------------------- integración
-- REL-07: toda entrada lleva llave de idempotencia.
create table crm.inbound_events (
  id               uuid primary key default app.uuid_v7(),
  source           text not null check (source in ('sales_app','s5','web_form')),
  event_type       text not null,
  idempotency_key  text not null,
  market_code      text references crm.markets(code),
  payload          jsonb not null,
  status           text not null default 'received' check (status in ('received','processed','rejected')),
  error            text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (source, idempotency_key)
);

-- REL-06: outbox transaccional.
create table crm.outbox_events (
  id            uuid primary key default app.uuid_v7(),
  event_type    text not null,
  aggregate     text not null,
  aggregate_id  uuid not null,
  market_code   text,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index outbox_pending_idx on crm.outbox_events (created_at) where published_at is null;

create table crm.ingest_batches (
  id          uuid primary key default app.uuid_v7(),
  source      text not null,
  as_of       date not null,
  file_name   text not null,
  checksum    text not null,
  row_count   int not null default 0,
  matched     int not null default 0,
  unmatched   int not null default 0,
  mode        text not null default 'full' check (mode in ('full','delta')),
  status      text not null default 'loaded' check (status in ('loaded','rejected')),
  reject_reason text,
  loaded_at   timestamptz not null default now(),
  unique (source, checksum)
);

-- REP-04 / AUT-06: agregados diarios del lakehouse (S5). Nunca transacciones individuales.
create table crm.merchant_metrics_daily (
  account_id          uuid not null references crm.accounts(id),
  as_of               date not null,
  market_code         text not null references crm.markets(code),
  first_txn_at        timestamptz,
  last_txn_at         timestamptz,
  txn_count_30d       int not null default 0,
  volume_minor_30d    bigint not null default 0,
  currency            char(3) not null,
  active_days_30d     int not null default 0,
  batch_id            uuid references crm.ingest_batches(id),
  primary key (account_id, as_of)
);

create table crm.fx_rates (
  currency   char(3) not null,
  as_of      date not null,
  usd_rate   numeric(18,8) not null,       -- 1 unidad de la moneda en USD (MULTI-01: tasa fechada)
  source     text not null,
  primary key (currency, as_of)
);

create table crm.api_clients (
  id          uuid primary key default app.uuid_v7(),
  name        text not null,
  key_prefix  text not null,
  key_hash    text not null unique,
  scopes      text[] not null,
  created_by  uuid references crm.users(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- ---------------------------------------------------------------- operación
-- CAMPO-04 / CS-03: cola de excepciones que generan las reglas.
create table crm.exceptions (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  kind         text not null check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk','reactivation','unowned_account','duplicate_suspect','unmatched_event')),
  severity     text not null default 'medium' check (severity in ('low','medium','high')),
  account_id   uuid references crm.accounts(id),
  deal_id      uuid references crm.deals(id),
  lead_id      uuid references crm.leads(id),
  owner_id     uuid references crm.users(id),
  detail       jsonb not null default '{}'::jsonb,
  dedupe_key   text not null,
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references crm.users(id),
  resolution   text
);
create unique index exceptions_open_uq on crm.exceptions (dedupe_key) where resolved_at is null;
create index exceptions_owner_idx on crm.exceptions (owner_id) where resolved_at is null;

-- GOB-01 / DATA-08: registro de campos; los campos por mercado son metadata, no columnas.
create table crm.field_definitions (
  id            uuid primary key default app.uuid_v7(),
  object        text not null check (object in ('account','deal','lead','contact')),
  key           text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es      text not null,
  label_en      text not null,
  data_type     text not null check (data_type in ('text','number','date','boolean','select')),
  options       jsonb not null default '[]'::jsonb,
  market_code   text references crm.markets(code),
  data_class    text not null default 'internal' check (data_class in ('public','internal','confidential')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index field_definitions_uq on crm.field_definitions (object, key, coalesce(market_code, '*'));

create table crm.saved_views (
  id         uuid primary key default app.uuid_v7(),
  user_id    uuid not null references crm.users(id),
  object     text not null check (object in ('account','lead','deal')),
  name       text not null,
  filters    jsonb not null,
  is_shared  boolean not null default false,
  created_at timestamptz not null default now()
);

-- OBS-03: bitácora de auditoría de solo inserción.
create table crm.audit_events (
  id           uuid primary key default app.uuid_v7(),
  at           timestamptz not null default now(),
  actor_id     uuid,
  action       text not null,
  object       text not null,
  object_id    uuid,
  market_code  text,
  before       jsonb,
  after        jsonb,
  request_id   text
);
create index audit_events_object_idx on crm.audit_events (object, object_id, at desc);
create index audit_events_at_idx on crm.audit_events (at desc);

create or replace function crm.audit_events_immutable() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;
create trigger audit_events_no_update before update or delete on crm.audit_events
  for each row execute function crm.audit_events_immutable();
create trigger audit_events_no_truncate before truncate on crm.audit_events
  for each statement execute function crm.audit_events_immutable();

create table crm.usage_events (
  id       uuid primary key default app.uuid_v7(),
  user_id  uuid not null references crm.users(id),
  event    text not null,
  at       timestamptz not null default now()
);
create index usage_events_user_idx on crm.usage_events (user_id, at desc);

-- ---------------------------------------------------------------- triggers
create or replace function crm.touch_account() returns trigger
language plpgsql set search_path = crm, app, public, extensions as $$
begin
  new.name_norm := app.norm(new.name);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.lifecycle is distinct from old.lifecycle then new.lifecycle_at := now(); end if;
  end if;
  return new;
end $$;
create trigger accounts_touch before insert or update on crm.accounts
  for each row execute function crm.touch_account();

create or replace function crm.touch_updated() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger deals_touch before update on crm.deals for each row execute function crm.touch_updated();
create trigger leads_touch before update on crm.leads for each row execute function crm.touch_updated();

-- DAT-01: el árbol no admite ciclos y cada cuenta conoce a sus ancestros.
-- SECURITY DEFINER: la integridad del árbol no depende de qué filas ve quien edita.
create or replace function crm.account_tree_before() returns trigger
language plpgsql security definer set search_path = crm, app, public as $$
declare p_anc uuid[];
begin
  if new.parent_id is null then
    new.ancestor_ids := '{}';
    return new;
  end if;
  select ancestor_ids into p_anc from crm.accounts where id = new.parent_id;
  if not found then
    raise exception 'parent account not found' using errcode = '23503';
  end if;
  if new.parent_id = new.id or new.id = any(p_anc) then
    raise exception 'account hierarchy cycle' using errcode = '23514';
  end if;
  new.ancestor_ids := p_anc || new.parent_id;
  return new;
end $$;
create trigger accounts_tree_before before insert or update of parent_id on crm.accounts
  for each row execute function crm.account_tree_before();

create or replace function crm.account_tree_after() returns trigger
language plpgsql security definer set search_path = crm, app, public as $$
begin
  if new.parent_id is distinct from old.parent_id then
    update crm.accounts d
       set ancestor_ids = new.ancestor_ids
                          || d.ancestor_ids[array_position(d.ancestor_ids, new.id):]
     where d.ancestor_ids @> array[new.id];
  end if;
  return null;
end $$;
create trigger accounts_tree_after after update of parent_id on crm.accounts
  for each row execute function crm.account_tree_after();
