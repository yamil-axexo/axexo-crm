-- Paquete campo-canal (programa "los 95", ola 3): expediente de alta y mesa de control (CAMPO-06), cartera por canal y
-- plan de reparto en borrador (CAMPO-03), avisos de saldo bajo y de quien va bajo su meta (CAMPO-04), atribución con
-- vigencias que no se enciman y correcciones como filas nuevas (CANAL-03), prioridad diaria de tiendas (CAMPO-02),
-- registros de canal con ventana de protección (CANAL-02), fondeo, saldo y límite de crédito (CANAL-07), disputas de
-- atribución (CANAL-08), competencia en el punto de venta (CAMPO-07), puntaje de punto de venta perfecto (CAMPO-08) e
-- incidentes de campo con acceso restringido (SEG-06).
-- Regla de la casa: nada se borra; toda tabla con RLS forzado; los documentos NO se guardan aquí (solo estado y enlace).

create extension if not exists btree_gist with schema public;

-- Quien administra o lidera ese mercado. Es el círculo que ve lo restringido (registros de canal, incidentes, disputas).
create or replace function app.cc_manages(m text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.is_admin() or exists (select 1 from app.active_memberships() x where x.role = 'market_lead' and x.market_code = m)
$$;
revoke execute on function app.cc_manages(text) from public;
grant execute on function app.cc_manages(text) to contigo_app;

-- ------------------------------------------------------------ 0) umbrales como metadata con versión
-- Cada cambio cierra la fila vigente y abre otra con versión + 1 y motivo: el pasado no se edita.
create table crm.field_thresholds (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  key          text not null check (key ~ '^[a-z0-9_]{3,60}$'),
  value        numeric not null,
  version      int not null default 1 check (version >= 1),
  reason       text check (reason is null or char_length(reason) between 3 and 300),
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz,
  set_by       uuid references crm.users(id)
);
create unique index field_thresholds_live_uq on crm.field_thresholds (market_code, key) where valid_to is null;
create unique index field_thresholds_version_uq on crm.field_thresholds (market_code, key, version);

-- ------------------------------------------------------------ 1) CAMPO-06 expediente y mesa de control
-- Formulario maestro por país: qué pide cada tipo de persona y cada forma de pago. Es metadata, no columnas.
create table crm.onboarding_requirements (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  person_type  text not null check (person_type in ('individual','company')),
  funding      text not null check (funding in ('prepaid','ach_credit','any')),
  code         text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label_es     text not null check (char_length(label_es) between 2 and 120),
  label_en     text not null check (char_length(label_en) between 2 and 120),
  feeds        text not null default 'carriers' check (feeds in ('carriers','credit','both')),
  pii_class    text not null default 'none' check (pii_class in ('none','business','personal')),
  retention_days int not null default 1825 check (retention_days between 30 and 3650),
  position     int not null default 0,
  is_active    boolean not null default true,
  unique (market_code, person_type, funding, code)
);

create table crm.onboarding_files (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id),
  market_code   text not null references crm.markets(code),
  person_type   text not null check (person_type in ('individual','company')),
  funding       text not null check (funding in ('prepaid','ach_credit')),
  status        text not null default 'draft' check (status in ('draft','submitted','in_review','returned','approved','auto_approved')),
  captured_via  text not null default 'contigo' check (captured_via in ('contigo','sales_app','link')),
  visited_at    timestamptz,
  submitted_at  timestamptz,
  due_at        timestamptz,
  assigned_to   uuid references crm.users(id),
  decided_by    uuid references crm.users(id),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) between 3 and 500),
  first_txn_at  timestamptz,
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now()
);
-- Un expediente vivo por comercio (el devuelto sigue vivo hasta que se corrige).
create unique index onboarding_files_live_uq on crm.onboarding_files (account_id) where status not in ('approved','auto_approved');
create index onboarding_files_queue_idx on crm.onboarding_files (market_code, status, due_at);

create table crm.onboarding_documents (
  id            uuid primary key default app.uuid_v7(),
  file_id       uuid not null references crm.onboarding_files(id),
  account_id    uuid not null references crm.accounts(id),
  market_code   text not null references crm.markets(code),
  requirement   text not null,
  status        text not null default 'missing' check (status in ('missing','received','valid','rejected')),
  -- Nunca el archivo: el enlace al sistema que lo guarda, o la referencia que dejaría la bóveda (apagada).
  link          text check (link is null or (char_length(link) <= 500 and link ~ '^https://')),
  storage_ref   text check (storage_ref is null or char_length(storage_ref) <= 200),
  content_hash  text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  pii_class     text not null default 'none' check (pii_class in ('none','business','personal')),
  retention_until date,
  note          text check (note is null or char_length(note) between 2 and 500),
  validated_by  uuid references crm.users(id),
  validated_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (file_id, requirement),
  check ((status in ('valid','rejected')) = (validated_by is not null and validated_at is not null))
);

-- Bitácora de lectura de documentos: quién pidió abrir cuál y cuándo (la bóveda devolvería un enlace corto firmado).
create table crm.document_reads (
  id           uuid primary key default app.uuid_v7(),
  document_id  uuid not null references crm.onboarding_documents(id),
  market_code  text not null references crm.markets(code),
  user_id      uuid not null references crm.users(id),
  outcome      text not null check (outcome in ('vault_off','simulated','link')),
  read_at      timestamptz not null default now()
);

-- ------------------------------------------------------------ 2) CAMPO-03 canal como eje, polos con dueño, plan en borrador
create table crm.channel_assignments (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  channel      text not null check (channel ~ '^[a-z0-9_]{2,30}$'),
  user_id      uuid references crm.users(id),
  duty         text not null check (duty in ('hunter','farmer')),
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz,
  reason       text check (reason is null or char_length(reason) between 3 and 300),
  created_by   uuid references crm.users(id),
  constraint channel_assignments_no_overlap exclude using gist
    (account_id with =, duty with =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') with &&)
);
create index channel_assignments_user_idx on crm.channel_assignments (user_id) where valid_to is null;

create table crm.territory_owners (
  id            uuid primary key default app.uuid_v7(),
  territory_id  uuid not null references crm.territories(id),
  market_code   text not null references crm.markets(code),
  user_id       uuid not null references crm.users(id),
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  created_by    uuid references crm.users(id),
  constraint territory_owners_no_overlap exclude using gist
    (territory_id with =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') with &&)
);

-- Perfil de quien vende: abre cartera (hunter), la cuida (farmer) o ambas.
create table crm.seller_profiles (
  user_id      uuid not null references crm.users(id),
  market_code  text not null references crm.markets(code),
  profile      text not null check (profile in ('hunter','farmer','both')),
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  primary key (user_id, market_code)
);

create table crm.reassignment_plans (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  status       text not null default 'draft' check (status in ('draft','applied','discarded')),
  to_user_id   uuid not null references crm.users(id),
  account_ids  uuid[] not null check (cardinality(account_ids) between 1 and 5000),
  diff         jsonb not null default '{}'::jsonb,
  note         text check (note is null or char_length(note) between 3 and 300),
  created_by   uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  applied_by   uuid references crm.users(id),
  applied_at   timestamptz,
  moved        int
);

-- ------------------------------------------------------------ 3) CANAL-03 atribución: motivo, corrección y vigencias sin encimarse
alter table crm.account_attributions
  add column reason        text check (reason is null or char_length(reason) between 3 and 300),
  add column correction_of uuid references crm.account_attributions(id),
  add column origin_kind   text check (origin_kind is null or origin_kind in ('network_conversion','new_acquisition'));
alter table crm.account_attributions add constraint account_attributions_origin_kind check (origin_kind is null or layer = 'origin');

-- Antes de la restricción: si algún comercio quedó con dos filas vigentes en la misma capa (por ejemplo, una fusión
-- antigua), la anterior se cierra donde empieza la siguiente. No se borra nada.
with o as (
  select id, lead(effective_from) over (partition by account_id, layer order by effective_from, id) as next_from, effective_from, effective_to
    from crm.account_attributions
)
update crm.account_attributions t set effective_to = greatest(o.effective_from, o.next_from)
  from o where o.id = t.id and o.next_from is not null and (o.effective_to is null or o.effective_to > o.next_from);
update crm.account_attributions set effective_to = effective_from where effective_to is not null and effective_to < effective_from;

alter table crm.account_attributions add constraint account_attributions_no_overlap exclude using gist
  (account_id with =, layer with =, tstzrange(effective_from, coalesce(effective_to, 'infinity'::timestamptz), '[)') with &&);

-- ------------------------------------------------------------ 4) CANAL-08 disputas y ajustes de atribución
create table crm.attribution_disputes (
  id             uuid primary key default app.uuid_v7(),
  account_id     uuid not null references crm.accounts(id),
  market_code    text not null references crm.markets(code),
  layer          text not null check (layer in ('origin','channel','owner')),
  kind           text not null default 'dispute' check (kind in ('dispute','adjustment','reversal')),
  claimant_id    uuid not null references crm.users(id),
  claimed_kind   text not null check (claimed_kind in ('user','team','partner')),
  claimed_ref    text not null check (char_length(claimed_ref) between 1 and 80),
  claimed_label  text not null check (char_length(claimed_label) between 2 and 120),
  reason         text not null check (char_length(reason) between 5 and 500),
  status         text not null default 'open' check (status in ('open','approved','rejected')),
  sla_due_at     timestamptz not null,
  arbiter_id     uuid references crm.users(id),
  resolution     text check (resolution is null or char_length(resolution) between 3 and 500),
  resolved_at    timestamptz,
  correction_id  uuid references crm.account_attributions(id),
  created_at     timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null)),
  check (arbiter_id is null or arbiter_id <> claimant_id)
);
create index attribution_disputes_queue_idx on crm.attribution_disputes (market_code, status, sla_due_at);

-- ------------------------------------------------------------ 5) CAMPO-02 prioridad diaria de tiendas
create table crm.store_priority (
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  day          date not null,
  owner_id     uuid references crm.users(id),
  segment      text not null check (segment in ('a','b','c','d')),
  score        int not null check (score between 0 and 100),
  reasons      jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  holdout      boolean not null default false,
  computed_at  timestamptz not null default now(),
  primary key (account_id, day)
);
create index store_priority_owner_idx on crm.store_priority (market_code, day, owner_id, score desc);

-- ------------------------------------------------------------ 6) CANAL-02 registros de canal con ventana de protección
create table crm.channel_claims (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  account_id       uuid references crm.accounts(id),
  store_name       text not null check (char_length(store_name) between 2 and 160),
  store_key        text not null check (char_length(store_key) between 2 and 200),
  node_ref         text not null check (char_length(node_ref) between 1 and 80),
  node_label       text not null check (char_length(node_label) between 2 and 120),
  channel          text not null check (channel ~ '^[a-z0-9_]{2,30}$'),
  status           text not null default 'active' check (status in ('active','expired','rejected','released')),
  expires_at       timestamptz not null,
  extensions       int not null default 0 check (extensions between 0 and 5),
  evidence         text check (evidence is null or char_length(evidence) between 5 and 500),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) between 3 and 300),
  registered_by    uuid not null references crm.users(id),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  check ((status = 'rejected') = (rejection_reason is not null))
);
-- Un solo registro activo por tienda en el mercado: el primero que llegó.
create unique index channel_claims_active_uq on crm.channel_claims (market_code, store_key) where status = 'active';

-- ------------------------------------------------------------ 7) CANAL-07 fondeo, saldo y límite de crédito
-- Llega del archivo de ventas (conexión apagada) o del simulador de Administración. Nunca se teclea un saldo.
create table crm.account_funding (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id),
  market_code   text not null references crm.markets(code),
  method        text not null check (method in ('prepaid','ach_credit')),
  balance_minor bigint not null,
  credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor >= 0),
  as_of         date not null,
  source        text not null check (source in ('sales_file','simulator')),
  loaded_at     timestamptz not null default now(),
  unique (account_id, as_of, source)
);
create index account_funding_latest_idx on crm.account_funding (account_id, as_of desc);

create table crm.credit_limit_requests (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id),
  market_code   text not null references crm.markets(code),
  amount_minor  bigint not null check (amount_minor > 0),
  reason        text not null check (char_length(reason) between 5 and 300),
  status        text not null default 'requested' check (status in ('requested','approved','rejected')),
  requested_by  uuid not null references crm.users(id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references crm.users(id),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) between 3 and 300),
  check ((status = 'requested') = (decided_by is null)),
  check (decided_by is null or decided_by <> requested_by)
);

-- ------------------------------------------------------------ 8) CAMPO-07 competencia en el punto de venta
create table crm.competitors (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  name         text not null check (char_length(name) between 2 and 80),
  is_active    boolean not null default true,
  created_by   uuid references crm.users(id),
  unique (market_code, name)
);
create table crm.account_competitors (
  id             uuid primary key default app.uuid_v7(),
  account_id     uuid not null references crm.accounts(id),
  market_code    text not null references crm.markets(code),
  competitor_id  uuid not null references crm.competitors(id),
  product        text check (product is null or char_length(product) between 2 and 80),
  price_minor    bigint check (price_minor is null or price_minor >= 0),
  observed_on    date not null,
  source         text not null check (source in ('visit','onboarding','dealer_tabs','sales_app')),
  recorded_by    uuid references crm.users(id),
  created_at     timestamptz not null default now()
);
create index account_competitors_account_idx on crm.account_competitors (account_id, observed_on desc);

-- ------------------------------------------------------------ 9) CAMPO-08 punto de venta perfecto (llega de la Sales App)
create table crm.perfect_store_scores (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  score        int not null check (score between 0 and 100),
  items_ok     int not null check (items_ok >= 0),
  items_total  int not null check (items_total between 1 and 10 and items_ok <= items_total),
  observed_at  timestamptz not null,
  source       text not null default 'sales_app' check (source in ('sales_app','test')),
  visit_ref    text check (visit_ref is null or char_length(visit_ref) <= 80),
  received_at  timestamptz not null default now(),
  unique (account_id, observed_at)
);

-- ------------------------------------------------------------ 10) SEG-06 incidentes de campo (registro confidencial)
create table crm.field_incidents (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  account_id    uuid references crm.accounts(id),
  party_kind    text not null check (party_kind in ('user','street_seller','partner','other')),
  party_ref     text check (party_ref is null or char_length(party_ref) <= 80),
  party_label   text not null check (char_length(party_label) between 2 and 120),
  type          text not null check (type in ('conduct','complaint','fraud_suspicion','equipment','other')),
  occurred_on   date not null,
  description   text not null check (char_length(description) between 10 and 2000),
  status        text not null default 'open' check (status in ('open','in_review','closed')),
  reported_by   uuid not null references crm.users(id),
  assigned_to   uuid references crm.users(id),
  resolution    text check (resolution is null or char_length(resolution) between 3 and 1000),
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  check ((status = 'closed') = (closed_at is not null and resolution is not null))
);

-- ------------------------------------------------------------ 11) CAMPO-04 metas por persona y avisos nuevos
create table crm.rep_plans (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  user_id       uuid not null references crm.users(id),
  month         date not null check (extract(day from month) = 1),
  target_won    int not null check (target_won between 1 and 1000),
  set_by        uuid references crm.users(id),
  updated_at    timestamptz not null default now(),
  unique (user_id, market_code, month)
);
alter table crm.exceptions drop constraint if exists exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low'));
alter table crm.exceptions add column rule_key text, add column rule_version int;

-- ------------------------------------------------------------ RLS (AUTHZ-03)
do $$
declare t text;
begin
  -- Tablas que cuelgan de un comercio: heredan su alcance y solo escribe quien escribe en el mercado.
  foreach t in array array['onboarding_files','onboarding_documents','channel_assignments','store_priority','account_funding',
                           'credit_limit_requests','account_competitors','perfect_store_scores'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format($f$create policy %I on crm.%I for select to contigo_app using (exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_read', t, t);
    execute format($f$create policy %I on crm.%I for insert to contigo_app with check (
      market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id and a.market_code = %I.market_code))$f$, t || '_ins', t, t, t);
    execute format($f$create policy %I on crm.%I for update to contigo_app
      using (exists (select 1 from crm.accounts a where a.id = %I.account_id))
      with check (market_code = any((select app.write_markets())::text[]))$f$, t || '_upd', t, t);
  end loop;
  -- Metadata del mercado: la lee quien trabaja en él; la cambia quien lo lidera o administra.
  foreach t in array array['field_thresholds','onboarding_requirements','territory_owners','seller_profiles','competitors','rep_plans','reassignment_plans'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format($f$create policy %I on crm.%I for select to contigo_app using (market_code = any((select app.my_markets())::text[]))$f$, t || '_read', t);
    execute format($f$create policy %I on crm.%I for insert to contigo_app with check ((select app.cc_manages(market_code)))$f$, t || '_ins', t);
    execute format($f$create policy %I on crm.%I for update to contigo_app using ((select app.cc_manages(market_code))) with check ((select app.cc_manages(market_code)))$f$, t || '_upd', t);
  end loop;
end $$;

-- Quien vende registra visitas y altas con competencia y pide límites; la lista de competidores la amplía también supervisión.
create policy competitors_ins_team on crm.competitors for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));
-- Supervisión arma el plan de reparto de su equipo (el dominio limita a quién y qué).
create policy reassignment_plans_ins_team on crm.reassignment_plans for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]) and created_by = (select app.current_user_id()));
create policy reassignment_plans_upd_team on crm.reassignment_plans for update to contigo_app
  using (created_by = (select app.current_user_id())) with check (created_by = (select app.current_user_id()));

-- Lectura de documentos: la bitácora la escribe quien abre; la lee quien lidera o administra.
alter table crm.document_reads enable row level security;
alter table crm.document_reads force row level security;
create policy document_reads_ins on crm.document_reads for insert to contigo_app
  with check (user_id = (select app.current_user_id()) and exists (select 1 from crm.onboarding_documents d where d.id = document_reads.document_id));
create policy document_reads_read on crm.document_reads for select to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.cc_manages(market_code)));

-- Registros de canal: la venta directa no los ve. Solo quien lidera o administra el mercado (y lo registra por el aliado).
alter table crm.channel_claims enable row level security;
alter table crm.channel_claims force row level security;
create policy channel_claims_read on crm.channel_claims for select to contigo_app using ((select app.cc_manages(market_code)));
create policy channel_claims_ins on crm.channel_claims for insert to contigo_app
  with check ((select app.cc_manages(market_code)) and registered_by = (select app.current_user_id()));
create policy channel_claims_upd on crm.channel_claims for update to contigo_app
  using ((select app.cc_manages(market_code))) with check ((select app.cc_manages(market_code)));
-- Respuesta mínima de existencia para quien registra: si la tienda ya tiene registro activo y hasta cuándo, sin decir de quién.
create or replace function app.claim_holder(m text, k text) returns table (held boolean, until timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select true, c.expires_at from crm.channel_claims c where c.market_code = m and c.store_key = k and c.status = 'active' and app.cc_manages(m)
$$;
revoke execute on function app.claim_holder(text, text) from public;
grant execute on function app.claim_holder(text, text) to contigo_app;

-- Disputas: las ve quien las levantó y quien arbitra.
alter table crm.attribution_disputes enable row level security;
alter table crm.attribution_disputes force row level security;
create policy attribution_disputes_read on crm.attribution_disputes for select to contigo_app
  using (claimant_id = (select app.current_user_id()) or (select app.cc_manages(market_code)));
create policy attribution_disputes_ins on crm.attribution_disputes for insert to contigo_app
  with check (claimant_id = (select app.current_user_id()) and status = 'open'
              and market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.accounts a where a.id = attribution_disputes.account_id));
create policy attribution_disputes_upd on crm.attribution_disputes for update to contigo_app
  using ((select app.cc_manages(market_code))) with check ((select app.cc_manages(market_code)) and arbiter_id = (select app.current_user_id()));

-- Incidentes: confidenciales. Los ve quien los reportó y quien lidera o administra el mercado; nadie más.
alter table crm.field_incidents enable row level security;
alter table crm.field_incidents force row level security;
create policy field_incidents_read on crm.field_incidents for select to contigo_app
  using (reported_by = (select app.current_user_id()) or (select app.cc_manages(market_code)));
create policy field_incidents_ins on crm.field_incidents for insert to contigo_app
  with check (reported_by = (select app.current_user_id()) and status = 'open' and market_code = any((select app.write_markets())::text[]));
create policy field_incidents_upd on crm.field_incidents for update to contigo_app
  using ((select app.cc_manages(market_code))) with check ((select app.cc_manages(market_code)));

-- Privilegios: lo histórico no se edita (sin delete en ninguna; update solo en columnas de estado).
grant select, insert on crm.field_thresholds, crm.onboarding_requirements, crm.onboarding_files, crm.onboarding_documents, crm.document_reads,
  crm.channel_assignments, crm.territory_owners, crm.seller_profiles, crm.reassignment_plans, crm.attribution_disputes, crm.store_priority,
  crm.channel_claims, crm.account_funding, crm.credit_limit_requests, crm.competitors, crm.account_competitors, crm.perfect_store_scores,
  crm.field_incidents, crm.rep_plans to contigo_app;
grant update (valid_to) on crm.field_thresholds, crm.channel_assignments, crm.territory_owners to contigo_app;
grant update (label_es, label_en, is_active, position) on crm.onboarding_requirements to contigo_app;
grant update (status, submitted_at, due_at, assigned_to, decided_by, decided_at, decision_note, first_txn_at) on crm.onboarding_files to contigo_app;
grant update (status, link, storage_ref, content_hash, retention_until, note, validated_by, validated_at, updated_at) on crm.onboarding_documents to contigo_app;
grant update (profile, updated_by, updated_at) on crm.seller_profiles to contigo_app;
grant update (status, diff, applied_by, applied_at, moved) on crm.reassignment_plans to contigo_app;
grant update (status, arbiter_id, resolution, resolved_at, correction_id) on crm.attribution_disputes to contigo_app;
grant update (score, reasons, holdout, segment, owner_id, computed_at) on crm.store_priority to contigo_app;
grant update (status, expires_at, extensions, evidence, rejection_reason, closed_at, account_id) on crm.channel_claims to contigo_app;
grant update (status, decided_by, decided_at, decision_note) on crm.credit_limit_requests to contigo_app;
grant update (is_active) on crm.competitors to contigo_app;
grant update (status, assigned_to, resolution, closed_at) on crm.field_incidents to contigo_app;
grant update (target_won, set_by, updated_at) on crm.rep_plans to contigo_app;
grant update (reason) on crm.account_attributions to contigo_app;

-- ------------------------------------------------------------ metadata de arranque (por defecto, conservadora)
-- Umbrales: se calibran el primer trimestre; cada cambio deja versión nueva con motivo.
insert into crm.field_thresholds (market_code, key, value, reason)
select m.code, k, v, 'Valor inicial del paquete campo-canal; calibrar el primer trimestre'
  from crm.markets m cross join (values
    ('under_plan_pct', 60), ('perfect_store_min', 60),
    ('claim_window_days', 14), ('claim_extension_days', 14), ('claim_max_extensions', 2),
    ('control_desk_sla_hours', 24), ('prepaid_auto_approve', 1),
    ('visit_every_days_a', 7), ('visit_every_days_b', 14), ('visit_every_days_c', 30), ('visit_every_days_d', 60),
    ('no_sale_days', 7), ('holdout_pct', 10), ('dispute_sla_days', 5)) v(k, v);

-- Formulario maestro: lo mínimo que se pide hoy por país. Ningún requisito guarda el documento, solo su estado.
insert into crm.onboarding_requirements (market_code, person_type, funding, code, label_es, label_en, feeds, pii_class, position)
select m, p, f, c, es, en, fd, pii, pos from (values
  ('US', 'company', 'any', 'business_license', 'Licencia del negocio', 'Business license', 'carriers', 'business', 1),
  ('US', 'company', 'any', 'tax_id_letter', 'Carta del número fiscal (EIN)', 'Tax ID letter (EIN)', 'both', 'business', 2),
  ('US', 'company', 'ach_credit', 'ach_authorization', 'Autorización ACH firmada', 'Signed ACH authorization', 'credit', 'business', 3),
  ('US', 'company', 'ach_credit', 'credit_application', 'Solicitud de crédito', 'Credit application', 'credit', 'business', 4),
  ('US', 'individual', 'any', 'owner_id_check', 'Identidad del dueño verificada', 'Owner identity verified', 'carriers', 'personal', 1),
  ('US', 'individual', 'any', 'business_license', 'Licencia del negocio', 'Business license', 'carriers', 'business', 2),
  ('US', 'individual', 'ach_credit', 'ach_authorization', 'Autorización ACH firmada', 'Signed ACH authorization', 'credit', 'business', 3),
  ('MX', 'company', 'any', 'constancia_fiscal', 'Constancia de situación fiscal', 'Tax status certificate', 'both', 'business', 1),
  ('MX', 'company', 'any', 'acta_constitutiva', 'Acta constitutiva', 'Articles of incorporation', 'carriers', 'business', 2),
  ('MX', 'company', 'any', 'comprobante_domicilio', 'Comprobante de domicilio', 'Proof of address', 'carriers', 'business', 3),
  ('MX', 'individual', 'any', 'constancia_fiscal', 'Constancia de situación fiscal', 'Tax status certificate', 'both', 'business', 1),
  ('MX', 'individual', 'any', 'identidad_verificada', 'Identidad del titular verificada', 'Holder identity verified', 'carriers', 'personal', 2),
  ('MX', 'individual', 'any', 'comprobante_domicilio', 'Comprobante de domicilio', 'Proof of address', 'carriers', 'business', 3)
) v(m, p, f, c, es, en, fd, pii, pos)
where exists (select 1 from crm.markets x where x.code = v.m);

insert into crm.competitors (market_code, name)
select m, n from (values ('MX', 'Otra plataforma de recargas'), ('MX', 'Terminal bancaria'), ('US', 'Other top-up platform'), ('US', 'Bank terminal')) v(m, n)
where exists (select 1 from crm.markets x where x.code = v.m);

-- ------------------------------------------------------------ integración ola 4: un solo saldo y una sola regla de saldo bajo
-- El saldo de un comercio llega por el archivo de fondeo (CANAL-07) o por las señales de cuidado (CS-02). Todos los que lo
-- leen (alerta de saldo bajo de Cuidado de comercios, puntaje de salud y prioridad de visita) usan esta vista: el dato más
-- reciente gana. El umbral es uno solo, el de Cuidado de comercios por mercado (crm.cs_settings.low_balance_minor, vacío =
-- sin alerta) y la alerta es una sola, la de Cuidado de comercios (crm.cs_alerts): campo-canal ya no abre su propio aviso.
create view crm.account_balance_latest with (security_invoker = true) as
  select distinct on (x.account_id) x.account_id, x.balance_minor, x.as_of, x.source
    from (select f.account_id, f.balance_minor, f.as_of, f.source, f.loaded_at from crm.account_funding f
          union all
          select s.account_id, s.balance_minor, s.as_of, s.source, s.loaded_at from crm.care_signals s where s.balance_minor is not null) x
   order by x.account_id, x.as_of desc, x.loaded_at desc;
grant select on crm.account_balance_latest to contigo_app;

create or replace function app.health_snapshot_run(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with base as (
    select a.id, a.market_code, (now() at time zone mk.timezone)::date as today, c.service_tier, st.health_decay_days as decay,
           m.as_of as m_as_of, m.txn_count_30d as txn, m.active_days_30d as d,
           (select avg(h.txn_count_30d)::numeric from crm.merchant_metrics_daily h where h.account_id = a.id and h.as_of between m.as_of - 120 and m.as_of - 28) as baseline,
           s.as_of as s_as_of, bl.balance_minor, bl.as_of as b_as_of, s.product_count_30d, s.open_tickets, s.urgent_tickets, st.low_balance_minor,
           w.risk_below, w.habit_at
      from crm.accounts a
      join crm.markets mk on mk.code = a.market_code
      join crm.cs_settings st on st.market_code = a.market_code
      left join crm.account_care c on c.account_id = a.id
      cross join lateral app.lifecycle_window(a.market_code, c.product_line) w
      join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
      left join lateral (select x.* from crm.care_signals x where x.account_id = a.id order by x.as_of desc limit 1) s on true
      left join crm.account_balance_latest bl on bl.account_id = a.id
     where a.archived_at is null and a.merged_into is null and a.lifecycle in ('active','at_risk','inactive')
       and (p_market is null or a.market_code = p_market)
  ), sig as (
    select b.*,
           greatest(0, 1 - greatest(0, b.today - b.m_as_of - 2)::numeric / b.decay) as m_fresh,
           case when b.s_as_of is null then null else greatest(0, 1 - greatest(0, b.today - b.s_as_of - 2)::numeric / b.decay) end as s_fresh,
           case when b.b_as_of is null then null else greatest(0, 1 - greatest(0, b.today - b.b_as_of - 2)::numeric / b.decay) end as b_fresh,
           -- transacciones: contra su propia línea base si la hay; si no, contra el umbral de hábito del mercado
           least(1, case when b.baseline is not null and b.baseline > 0 then b.txn / b.baseline else b.d::numeric / b.habit_at end) as v_txn,
           case when b.product_count_30d is null then null else least(1, b.product_count_30d / 3.0) end as v_mix,
           case when b.open_tickets is null then null else greatest(0, 1 - (b.open_tickets + 2 * coalesce(b.urgent_tickets, 0)) / 5.0) end as v_tickets,
           case when b.balance_minor is null or b.low_balance_minor is null then null else least(1, b.balance_minor::numeric / greatest(1, b.low_balance_minor * 2)) end as v_balance
      from base b
  ), parts as (
    select g.id, g.market_code, g.today, g.service_tier, cfg.grp, cfg.weight,
           case cfg.grp when 'transactions' then g.v_txn * g.m_fresh when 'mix' then g.v_mix * g.s_fresh when 'tickets' then g.v_tickets * g.s_fresh else g.v_balance * g.b_fresh end as v,
           case cfg.grp when 'transactions' then case when g.baseline is not null and g.baseline > 0 then 'vs_baseline' else 'vs_habit' end else 'signal' end as basis,
           case cfg.grp when 'transactions' then g.m_as_of when 'balance' then g.b_as_of else g.s_as_of end as data_as_of,
           case cfg.grp when 'transactions' then g.txn::numeric when 'mix' then g.product_count_30d::numeric when 'tickets' then g.open_tickets::numeric else g.balance_minor::numeric end as raw,
           case when cfg.grp = 'transactions' then round(g.baseline, 1) end as baseline
      from sig g
      join lateral (select distinct on (h.grp) h.grp, h.weight from crm.health_config h
                     where h.is_active and h.weight > 0 and (h.market_code is null or h.market_code = g.market_code)
                     order by h.grp, h.market_code nulls last) cfg on true
  ), agg as (
    select p.id, p.market_code, p.today, p.service_tier,
           sum(p.weight) filter (where p.v is not null) as max_pts,
           sum(p.weight * p.v) filter (where p.v is not null) as pts,
           jsonb_agg(jsonb_build_object('grp', p.grp, 'weight', p.weight, 'points', case when p.v is null then null else round(p.weight * p.v, 1) end,
                                        'basis', p.basis, 'as_of', p.data_as_of, 'raw', p.raw, 'baseline', p.baseline) order by p.grp) as groups,
           (array_agg(p.grp order by p.v nulls last, p.weight desc))[1] as lowest
      from parts p group by p.id, p.market_code, p.today, p.service_tier
  ), ins as (
    insert into crm.health_snapshots (account_id, as_of, market_code, score, band, groups, lowest, tier)
    select a.id, a.today, a.market_code, round(100 * a.pts / a.max_pts)::int,
           case when 100 * a.pts / a.max_pts >= 70 then 'good' when 100 * a.pts / a.max_pts >= (select health_threshold from crm.cs_settings s where s.market_code = a.market_code) then 'watch' else 'risk' end,
           a.groups, a.lowest, a.service_tier
      from agg a where a.max_pts > 0
    on conflict (account_id, as_of) do update set score = excluded.score, band = excluded.band, groups = excluded.groups, lowest = excluded.lowest, tier = excluded.tier, created_at = now()
    returning 1
  )
  select count(*)::int into n from ins;
  return n;
end $$;
