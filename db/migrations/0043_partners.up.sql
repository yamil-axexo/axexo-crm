-- 0043_partners: términos comerciales y contratos (PIPE-07), portal de partners por subárbol y su token de lectura (CANAL-01),
-- plan compartido de integración (PIPE-08), niveles de partner, habilitación y cruce de bases (CANAL-06), kit de ingesta de
-- red adquirida en espacio segregado (DAT-06) y captura de comunicaciones en el hilo (ACT-03).
-- Lo que sale hacia afuera (firma electrónica, identidad de externos, Gmail, Calendar, WhatsApp) es un adaptador apagado:
-- la operación queda en crm.external_queue con estado "Canal apagado".

-- ============================================================ 0) cola visible de lo que saldría por un adaptador apagado
create table crm.external_queue (
  id           uuid primary key default app.uuid_v7(),
  adapter      text not null check (adapter in ('esign','external_identity','gmail','calendar','whatsapp_capture')),
  object       text not null check (object ~ '^[a-z_]{3,40}$'),
  object_id    uuid,
  market_code  text references crm.markets(code),
  summary      text not null check (char_length(summary) between 1 and 300),
  status       text not null default 'channel_off' check (status in ('channel_off','simulated')),
  created_by   uuid references crm.users(id),
  created_at   timestamptz not null default now()
);
create index external_queue_adapter_idx on crm.external_queue (adapter, created_at desc);
alter table crm.external_queue enable row level security;
alter table crm.external_queue force row level security;
grant select, insert on crm.external_queue to contigo_app;
create policy external_queue_read on crm.external_queue for select to contigo_app
  using (created_by = (select app.current_user_id()) or (select app.has_area('integrations')));
create policy external_queue_ins on crm.external_queue for insert to contigo_app
  with check (created_by = (select app.current_user_id()));

-- Quién maneja los partners y las redes de un mercado: administración completa o quien lidera ese mercado.
create or replace function app.partner_manager(p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.is_admin() or exists (select 1 from app.active_memberships_x() m where m.role = 'market_lead' and m.market_code = p_market)
$$;
revoke execute on function app.partner_manager(text) from public;
grant execute on function app.partner_manager(text) to contigo_app;

-- ============================================================ 1) PIPE-07: términos comerciales versionados y contratos
create table crm.commercial_terms (
  id                   uuid primary key default app.uuid_v7(),
  account_id           uuid not null references crm.accounts(id),
  market_code          text not null references crm.markets(code),
  legal_entity_id      uuid references crm.legal_entities(id),
  version              int not null check (version >= 1),
  -- Comisión pactada por producto: [{ "product": "Recargas", "pct": 4.5 }]. Al menos una línea.
  commission_lines     jsonb not null check (jsonb_typeof(commission_lines) = 'array' and jsonb_array_length(commission_lines) between 1 and 20),
  settlement           text not null check (settlement in ('prepaid','ach_credit','other')),
  fees                 text check (fees is null or char_length(fees) <= 300),
  nda                  boolean not null default false,
  term_months          int not null check (term_months between 1 and 120),
  valid_from           date not null,
  valid_to             date not null check (valid_to > valid_from),
  renewal_notice_days  int not null default 30 check (renewal_notice_days between 0 and 365),
  note                 text check (note is null or char_length(note) <= 500),
  supersedes           uuid references crm.commercial_terms(id),
  is_current           boolean not null default true,
  created_by           uuid references crm.users(id),
  created_at           timestamptz not null default now(),
  unique (account_id, version)
);
create unique index commercial_terms_current_uq on crm.commercial_terms (account_id) where is_current;
alter table crm.commercial_terms enable row level security;
alter table crm.commercial_terms force row level security;
grant select, insert, update (is_current) on crm.commercial_terms to contigo_app;
-- Los términos son dato reservado (SEG-02, campo 'commercial_terms'): los ve y los cambia quien el campo deja.
create policy commercial_terms_read on crm.commercial_terms for select to contigo_app
  using ((select app.sensitive_can('commercial_terms', account_id, 'view')));
create policy commercial_terms_ins on crm.commercial_terms for insert to contigo_app
  with check ((select app.sensitive_can('commercial_terms', account_id, 'edit')) and created_by = (select app.current_user_id()));
create policy commercial_terms_upd on crm.commercial_terms for update to contigo_app
  using ((select app.sensitive_can('commercial_terms', account_id, 'edit')))
  with check ((select app.sensitive_can('commercial_terms', account_id, 'edit')));

create table crm.contracts (
  id                   uuid primary key default app.uuid_v7(),
  account_id           uuid not null references crm.accounts(id),
  market_code          text not null references crm.markets(code),
  terms_id             uuid not null references crm.commercial_terms(id),
  status               text not null default 'draft' check (status in ('draft','sent','signed','active','expired','cancelled')),
  starts_on            date not null,
  ends_on              date not null check (ends_on > starts_on),
  renewal_notice_days  int not null default 30 check (renewal_notice_days between 0 and 365),
  sent_at              timestamptz,
  signed_on            date,
  signed_by_name       text check (signed_by_name is null or char_length(btrim(signed_by_name)) between 2 and 120),
  document_url         text check (document_url is null or (document_url ~ '^https://[^ ]+$' and char_length(document_url) <= 400)),
  marked_by            uuid references crm.users(id),
  esign_state          text check (esign_state is null or esign_state in ('channel_off','simulated')),
  renewal_noticed_at   timestamptz,
  renewed_from         uuid references crm.contracts(id),
  created_by           uuid references crm.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- "Firmado" a mano: con fecha, quién firmó y dónde vive el documento.
  constraint contracts_signed_shape check (status not in ('signed','active','expired') or (signed_on is not null and signed_by_name is not null and document_url is not null))
);
create index contracts_account_idx on crm.contracts (account_id, created_at desc);
create index contracts_due_idx on crm.contracts (status, ends_on) where status in ('signed','active');
alter table crm.contracts enable row level security;
alter table crm.contracts force row level security;
grant select, insert, update on crm.contracts to contigo_app;
create policy contracts_read on crm.contracts for select to contigo_app using ((select app.can_see_account(account_id)));
create policy contracts_ins on crm.contracts for insert to contigo_app
  with check ((select app.can_see_account(account_id)) and market_code = any((select app.write_markets())::text[]));
create policy contracts_upd on crm.contracts for update to contigo_app
  using ((select app.can_see_account(account_id)) and market_code = any((select app.write_markets())::text[]))
  with check ((select app.can_see_account(account_id)) and market_code = any((select app.write_markets())::text[]));

-- ============================================================ 2) CANAL-01: token de lectura por subárbol y baja automática
create table crm.partner_tokens (
  id                uuid primary key default app.uuid_v7(),
  scope_account_id  uuid not null references crm.accounts(id),
  market_code       text not null references crm.markets(code),
  user_id           uuid not null references crm.users(id),   -- la persona de partner cuya visibilidad usa el token (RLS)
  label             text not null check (char_length(btrim(label)) between 2 and 80),
  token_hash        text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by        uuid references crm.users(id),
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid references crm.users(id)
);
alter table crm.partner_tokens enable row level security;
alter table crm.partner_tokens force row level security;
grant select, insert, update (revoked_at, revoked_by) on crm.partner_tokens to contigo_app;
create policy partner_tokens_read on crm.partner_tokens for select to contigo_app using ((select app.partner_manager(market_code)));
create policy partner_tokens_ins on crm.partner_tokens for insert to contigo_app with check ((select app.partner_manager(market_code)));
create policy partner_tokens_upd on crm.partner_tokens for update to contigo_app
  using ((select app.partner_manager(market_code))) with check ((select app.partner_manager(market_code)));

/** API de lectura: de un token (su huella) a la persona de partner que lo respalda. Vale solo con el acceso de partner vigente al mismo nodo. */
create or replace function app.partner_token_user(p_hash text)
returns table (token_id uuid, user_id uuid, scope_account_id uuid)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
begin
  return query
  update crm.partner_tokens t set last_used_at = now()
   where t.token_hash = p_hash and t.revoked_at is null
     and exists (select 1 from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
                  where m.user_id = t.user_id and m.role = 'partner' and m.scope_account_id = t.scope_account_id
                    and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
     and exists (select 1 from crm.accounts a where a.id = t.scope_account_id and a.archived_at is null and a.merged_into is null)
  returning t.id, t.user_id, t.scope_account_id;
end $$;
revoke execute on function app.partner_token_user(text) from public;
grant execute on function app.partner_token_user(text) to contigo_app;

-- Baja automática al desvincular el nodo: si la cuenta raíz se archiva o se fusiona, se cierra el acceso de partner y sus tokens.
create or replace function crm.partner_node_unlinked() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if (new.archived_at is not null and old.archived_at is null) or (new.merged_into is not null and old.merged_into is null) then
    update crm.memberships set valid_to = now()
     where role = 'partner' and scope_account_id = new.id and (valid_to is null or valid_to > now());
    update crm.partner_tokens set revoked_at = now() where scope_account_id = new.id and revoked_at is null;
  end if;
  return new;
end $$;
create trigger accounts_partner_unlinked after update of archived_at, merged_into on crm.accounts
  for each row execute function crm.partner_node_unlinked();

-- ============================================================ 3) PIPE-08: plan compartido de integración
create table crm.integration_plans (
  id             uuid primary key default app.uuid_v7(),
  account_id     uuid not null references crm.accounts(id),
  deal_id        uuid references crm.deals(id),
  market_code    text not null references crm.markets(code),
  title          text not null check (char_length(btrim(title)) between 2 and 120),
  started_on     date not null,
  certified_on   date,
  client_access  text not null default 'off' check (client_access in ('off','requested')),
  created_by     uuid references crm.users(id),
  created_at     timestamptz not null default now()
);
create unique index integration_plans_deal_uq on crm.integration_plans (deal_id) where deal_id is not null;
create index integration_plans_account_idx on crm.integration_plans (account_id);
create table crm.plan_milestones (
  id             uuid primary key default app.uuid_v7(),
  plan_id        uuid not null references crm.integration_plans(id) on delete cascade,
  account_id     uuid not null references crm.accounts(id),
  market_code    text not null references crm.markets(code),
  position       int not null,
  phase          text not null check (phase in ('specs','sandbox','certification','go_live','other')),
  title          text not null check (char_length(btrim(title)) between 2 and 160),
  side           text not null check (side in ('client','axexo')),
  owner_user_id  uuid references crm.users(id),
  owner_name     text check (owner_name is null or char_length(btrim(owner_name)) between 2 and 120),
  due_on         date,
  status         text not null default 'pending' check (status in ('pending','in_progress','done','blocked')),
  done_on        date,
  note           text check (note is null or char_length(note) <= 300),
  updated_at     timestamptz not null default now(),
  -- Dueño por hito, incluidos los del cliente: del lado de axexo una persona de CONTIGO; del lado del cliente, su nombre.
  constraint plan_milestones_owner check ((side = 'axexo' and owner_user_id is not null) or (side = 'client' and owner_name is not null)),
  constraint plan_milestones_done check ((status = 'done') = (done_on is not null))
);
create index plan_milestones_plan_idx on crm.plan_milestones (plan_id, position);
do $$
declare t text;
begin
  foreach t in array array['integration_plans','plan_milestones'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format('grant select, insert, update on crm.%I to contigo_app', t);
    execute format('create policy %I on crm.%I for select to contigo_app using ((select app.can_see_account(account_id)))', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.can_see_account(account_id)) and market_code = any((select app.write_markets())::text[]))', t || '_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.can_see_account(account_id)) and market_code = any((select app.write_markets())::text[])) with check ((select app.can_see_account(account_id)) and market_code = any((select app.write_markets())::text[]))', t || '_upd', t);
  end loop;
end $$;

-- ============================================================ 4) CANAL-06: niveles, habilitación y cruce de bases
create table crm.partner_tiers (
  id                  uuid primary key default app.uuid_v7(),
  market_code         text not null references crm.markets(code),
  code                text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name_es             text not null check (char_length(btrim(name_es)) between 2 and 40),
  name_en             text not null check (char_length(btrim(name_en)) between 2 and 40),
  rank                int not null check (rank between 1 and 10),
  min_active          int not null default 0 check (min_active >= 0),
  min_quality_pct     int not null default 0 check (min_quality_pct between 0 and 100),
  min_compliance_pct  int not null default 0 check (min_compliance_pct between 0 and 100),
  is_active           boolean not null default true,
  unique (market_code, code),
  unique (market_code, rank)
);
create table crm.partner_profiles (
  account_id   uuid primary key references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  since        date not null,
  tier_code    text,
  tier_period  text check (tier_period is null or tier_period ~ '^\d{4}-\d{2}$'),
  metrics      jsonb not null default '{}'::jsonb,
  computed_at  timestamptz,
  created_by   uuid references crm.users(id),
  ended_at     timestamptz
);
create table crm.partner_tier_history (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  period       text not null check (period ~ '^\d{4}-\d{2}$'),
  tier_code    text,
  metrics      jsonb not null,
  computed_at  timestamptz not null default now(),
  unique (account_id, period)
);
create table crm.partner_enablement (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  tier_code    text not null,
  title_es     text not null check (char_length(btrim(title_es)) between 2 and 120),
  title_en     text not null check (char_length(btrim(title_en)) between 2 and 120),
  -- Integrar Kore Academy, no duplicar: aquí solo vive el enlace al curso.
  url          text not null check (url ~ '^https://[^ ]+$' and char_length(url) <= 400),
  is_active    boolean not null default true,
  created_by   uuid references crm.users(id),
  created_at   timestamptz not null default now()
);
create table crm.partner_overlaps (
  id                  uuid primary key default app.uuid_v7(),
  partner_account_id  uuid not null references crm.accounts(id),
  market_code         text not null references crm.markets(code),
  node_account_id     uuid not null references crm.accounts(id),
  own_account_id      uuid not null references crm.accounts(id),
  match_key           text not null check (match_key in ('phone','alias','tax_id')),
  computed_at         timestamptz not null default now(),
  unique (partner_account_id, node_account_id, own_account_id, match_key)
);
alter table crm.partner_tiers enable row level security;          alter table crm.partner_tiers force row level security;
alter table crm.partner_profiles enable row level security;       alter table crm.partner_profiles force row level security;
alter table crm.partner_tier_history enable row level security;   alter table crm.partner_tier_history force row level security;
alter table crm.partner_enablement enable row level security;     alter table crm.partner_enablement force row level security;
alter table crm.partner_overlaps enable row level security;       alter table crm.partner_overlaps force row level security;
grant select, insert, update on crm.partner_tiers, crm.partner_profiles, crm.partner_tier_history, crm.partner_enablement to contigo_app;
grant select, insert, delete on crm.partner_overlaps to contigo_app;
-- Criterios publicados: cualquiera con acceso los lee. Los cambia quien maneja los partners del mercado.
create policy partner_tiers_read on crm.partner_tiers for select to contigo_app using ((select app.current_user_id()) is not null);
create policy partner_tiers_ins on crm.partner_tiers for insert to contigo_app with check ((select app.partner_manager(market_code)));
create policy partner_tiers_upd on crm.partner_tiers for update to contigo_app using ((select app.partner_manager(market_code))) with check ((select app.partner_manager(market_code)));
create policy partner_enablement_read on crm.partner_enablement for select to contigo_app using ((select app.current_user_id()) is not null);
create policy partner_enablement_ins on crm.partner_enablement for insert to contigo_app with check ((select app.partner_manager(market_code)));
create policy partner_enablement_upd on crm.partner_enablement for update to contigo_app using ((select app.partner_manager(market_code))) with check ((select app.partner_manager(market_code)));
create policy partner_profiles_read on crm.partner_profiles for select to contigo_app using ((select app.can_see_account(account_id)));
create policy partner_profiles_ins on crm.partner_profiles for insert to contigo_app with check ((select app.partner_manager(market_code)));
create policy partner_profiles_upd on crm.partner_profiles for update to contigo_app using ((select app.partner_manager(market_code))) with check ((select app.partner_manager(market_code)));
create policy partner_tier_history_read on crm.partner_tier_history for select to contigo_app using ((select app.can_see_account(account_id)));
create policy partner_tier_history_ins on crm.partner_tier_history for insert to contigo_app with check ((select app.partner_manager(market_code)));
create policy partner_tier_history_upd on crm.partner_tier_history for update to contigo_app using ((select app.partner_manager(market_code))) with check ((select app.partner_manager(market_code)));
-- El cruce de bases tiene acceso restringido: solo quien maneja los partners del mercado.
create policy partner_overlaps_read on crm.partner_overlaps for select to contigo_app using ((select app.partner_manager(market_code)));
create policy partner_overlaps_ins on crm.partner_overlaps for insert to contigo_app with check ((select app.partner_manager(market_code)));
create policy partner_overlaps_del on crm.partner_overlaps for delete to contigo_app using ((select app.partner_manager(market_code)));

-- ============================================================ 5) DAT-06: red adquirida en espacio segregado
alter table crm.accounts drop constraint if exists accounts_merchant_origin_check;
alter table crm.accounts add constraint accounts_merchant_origin_check
  check (merchant_origin is null or merchant_origin in ('new_acquisition','emida_conversion','network_conversion'));

create table crm.network_loads (
  id                   uuid primary key default app.uuid_v7(),
  market_code          text not null references crm.markets(code),
  legal_entity_id      uuid not null references crm.legal_entities(id),
  name                 text not null check (char_length(btrim(name)) between 2 and 120),
  source_system        text not null check (source_system in ('emida','sky','movilway','other')),
  mapping              jsonb not null default '{}'::jsonb,
  root_account_id      uuid references crm.accounts(id),
  status               text not null default 'staged' check (status in ('staged','released','done','rolled_back')),
  legal_release_by     uuid references crm.users(id),
  legal_release_at     timestamptz,
  business_release_by  uuid references crm.users(id),
  business_release_at  timestamptz,
  rows_total           int not null default 0,
  created_by           uuid references crm.users(id),
  created_at           timestamptz not null default now()
);
create table crm.network_load_rows (
  id                  uuid primary key default app.uuid_v7(),
  load_id             uuid not null references crm.network_loads(id) on delete cascade,
  market_code         text not null references crm.markets(code),
  line                int not null,
  external_id         text not null check (char_length(external_id) between 1 and 80),
  parent_external_id  text check (parent_external_id is null or char_length(parent_external_id) between 1 and 80),
  name                text not null check (char_length(name) between 1 and 160),
  kind                text not null default 'store' check (kind in ('organization','distributor','chain','store')),
  phone               text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  locality            text check (locality is null or char_length(locality) <= 120),
  region              text check (region is null or char_length(region) <= 120),
  status              text not null default 'ready' check (status in ('ready','error','duplicate','promoted','rolled_back','kept')),
  issues              text[] not null default '{}',
  dup_account_id      uuid references crm.accounts(id),
  dup_key             text check (dup_key is null or dup_key in ('alias','phone','name','in_file')),
  batch               int,
  account_id          uuid references crm.accounts(id),
  promoted_at         timestamptz,
  unique (load_id, external_id)
);
create index network_load_rows_load_idx on crm.network_load_rows (load_id, line);
-- Lo cargado lo ve solo quien maneja las redes del mercado y, si su acceso está limitado a entidades, solo las de su entidad.
create or replace function app.network_load_visible(p_market text, p_entity uuid) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.partner_manager(p_market)
     and (app.is_admin() or not (p_market = any(app.entity_limited_markets())) or p_entity = any(app.my_entity_ids()))
$$;
revoke execute on function app.network_load_visible(text, uuid) from public;
grant execute on function app.network_load_visible(text, uuid) to contigo_app;
alter table crm.network_loads enable row level security;       alter table crm.network_loads force row level security;
alter table crm.network_load_rows enable row level security;   alter table crm.network_load_rows force row level security;
grant select, insert, update on crm.network_loads, crm.network_load_rows to contigo_app;
create policy network_loads_all on crm.network_loads for all to contigo_app
  using ((select app.network_load_visible(market_code, legal_entity_id)))
  with check ((select app.network_load_visible(market_code, legal_entity_id)));
create policy network_load_rows_all on crm.network_load_rows for all to contigo_app
  using (exists (select 1 from crm.network_loads l where l.id = network_load_rows.load_id))
  with check (exists (select 1 from crm.network_loads l where l.id = network_load_rows.load_id));

-- ============================================================ 6) ACT-03: captura de comunicaciones en el hilo
create table crm.activity_comms (
  activity_id   uuid primary key references crm.activities(id),
  market_code   text not null references crm.markets(code),
  account_id    uuid not null references crm.accounts(id),
  channel       text not null check (channel in ('email','meeting','whatsapp')),
  direction     text check (direction is null or direction in ('inbound','outbound')),
  participants  text[] not null default '{}' check (cardinality(participants) <= 30),
  occurred_at   timestamptz not null,
  ends_at       timestamptz check (ends_at is null or ends_at >= occurred_at),
  source        text not null default 'manual' check (source in ('manual','gmail','calendar','whatsapp_api')),
  external_ref  text check (external_ref is null or char_length(external_ref) <= 200),
  phone_e164    text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now(),
  constraint activity_comms_whatsapp check (channel <> 'whatsapp' or direction is not null)
);
create unique index activity_comms_external_uq on crm.activity_comms (source, external_ref) where external_ref is not null;
create index activity_comms_account_idx on crm.activity_comms (account_id, channel, occurred_at desc);
alter table crm.activity_comms enable row level security;
alter table crm.activity_comms force row level security;
grant select, insert on crm.activity_comms to contigo_app;
create policy activity_comms_read on crm.activity_comms for select to contigo_app
  using (exists (select 1 from crm.activities a where a.id = activity_comms.activity_id));
create policy activity_comms_ins on crm.activity_comms for insert to contigo_app
  with check (exists (select 1 from crm.activities a where a.id = activity_comms.activity_id)
              and market_code = any((select app.write_markets())::text[]) and created_by = (select app.current_user_id()));

select audit.attach_all();
