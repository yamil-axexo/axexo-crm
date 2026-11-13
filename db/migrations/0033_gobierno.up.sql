-- Paquete gobierno (GOB-07, GOB-04, GOB-09, GOB-08, E7.F2 a F9).
-- Todo lo que mide, registra o gobierna la operación de CONTIGO desde adentro: objetivos de servicio y su medición,
-- errores con el identificador de la petición, incidentes, pruebas de restauración, dueños por componente, mantenimiento,
-- versiones con su lista de salida, despliegues, costos cargados a mano, corridas del generador de datos de prueba,
-- solicitudes de configuración con aprobación, el motivo de cada cambio de configuración, champions y material por mercado.
-- Ninguna tabla guarda datos de comercios ni de personas fuera de quién hizo el registro.

-- ------------------------------------------------------------------ GOB-07: identificador de petición en la bitácora
-- La columna existe desde 0001; desde aquí se llena sola con el identificador que la app fija en la transacción.
alter table crm.audit_events alter column request_id set default nullif(current_setting('app.request_id', true), '');
create index audit_events_request_idx on crm.audit_events (request_id) where request_id is not null;

-- ------------------------------------------------------------------ GOB-07: medición por día, tipo y pantalla
-- Un renglón por día, tipo y pantalla, con conteos y un histograma de tiempos. No guarda quién ni qué registro.
create table crm.request_metrics (
  day       date not null,
  kind      text not null check (kind in ('page', 'action', 'api', 'probe')),
  screen    text not null check (char_length(screen) between 1 and 80),
  n         integer not null default 0 check (n >= 0),
  errors    integer not null default 0 check (errors >= 0),
  total_ms  bigint not null default 0 check (total_ms >= 0),
  -- Cuántas respuestas cayeron en cada tramo: hasta 200 ms, 500 ms, 1 s, 2 s, 4 s y más de 4 s.
  buckets   integer[] not null default '{0,0,0,0,0,0}' check (array_length(buckets, 1) = 6),
  primary key (day, kind, screen)
);
alter table crm.request_metrics enable row level security;
alter table crm.request_metrics force row level security;
grant select on crm.request_metrics to contigo_app;
create policy request_metrics_read on crm.request_metrics for select to contigo_app using ((select app.is_global()));

create or replace function app.record_request(p_kind text, p_screen text, p_ms integer, p_error boolean)
returns void language plpgsql security definer set search_path = pg_catalog, crm, app as $$
declare
  v_ms integer := greatest(0, least(coalesce(p_ms, 0), 600000));
  v_bucket integer := case when v_ms <= 200 then 1 when v_ms <= 500 then 2 when v_ms <= 1000 then 3 when v_ms <= 2000 then 4 when v_ms <= 4000 then 5 else 6 end;
  v_buckets integer[] := '{0,0,0,0,0,0}';
begin
  if p_kind not in ('page', 'action', 'api', 'probe') or p_screen is null or char_length(p_screen) not between 1 and 80 then
    return;
  end if;
  v_buckets[v_bucket] := 1;
  insert into crm.request_metrics as m (day, kind, screen, n, errors, total_ms, buckets)
  values ((now() at time zone 'utc')::date, p_kind, p_screen, 1, case when p_error then 1 else 0 end, v_ms, v_buckets)
  on conflict (day, kind, screen) do update
    set n = m.n + 1,
        errors = m.errors + case when p_error then 1 else 0 end,
        total_ms = m.total_ms + v_ms,
        buckets = array(select m.buckets[i] + case when i = v_bucket then 1 else 0 end from generate_series(1, 6) i);
end $$;
revoke all on function app.record_request(text, text, integer, boolean) from public;
grant execute on function app.record_request(text, text, integer, boolean) to contigo_app;

-- ------------------------------------------------------------------ GOB-07: errores, con el identificador de la petición
-- Solo el tipo de error, dónde pasó y el identificador: nunca el mensaje ni los datos que traía.
create table crm.error_events (
  id          uuid primary key default app.uuid_v7(),
  at          timestamptz not null default now(),
  request_id  text check (request_id is null or char_length(request_id) <= 80),
  kind        text not null check (kind in ('page', 'action', 'api', 'job')),
  screen      text not null check (char_length(screen) between 1 and 80),
  name        text not null check (char_length(name) between 1 and 80),
  code        text check (code is null or char_length(code) <= 40)
);
create index error_events_at_idx on crm.error_events (at desc);
create index error_events_request_idx on crm.error_events (request_id) where request_id is not null;
alter table crm.error_events enable row level security;
alter table crm.error_events force row level security;
grant select on crm.error_events to contigo_app;
create policy error_events_read on crm.error_events for select to contigo_app using ((select app.is_global()));

create or replace function app.record_error(p_request_id text, p_kind text, p_screen text, p_name text, p_code text)
returns void language plpgsql security definer set search_path = pg_catalog, crm, app as $$
begin
  if p_kind not in ('page', 'action', 'api', 'job') then return; end if;
  insert into crm.error_events (request_id, kind, screen, name, code)
  values (nullif(left(coalesce(p_request_id, ''), 80), ''), p_kind, left(coalesce(nullif(p_screen, ''), 'otra'), 80),
          left(coalesce(nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.-]', '', 'g'), ''), 'Error'), 80),
          nullif(left(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9_.-]', '', 'g'), 40), ''));
end $$;
revoke all on function app.record_error(text, text, text, text, text) from public;
grant execute on function app.record_error(text, text, text, text, text) to contigo_app;

-- ------------------------------------------------------------------ GOB-07: objetivos de servicio y de recuperación
-- Qué se mide viene fijo; el valor del objetivo lo pone una persona. Sin valor, la pantalla dice "Por definir".
create table crm.service_objectives (
  key         text primary key check (key ~ '^[a-z_]{3,40}$'),
  kind        text not null check (kind in ('slo', 'recovery')),
  position    integer not null,
  target      numeric(12, 2) check (target is null or target >= 0),
  agreed_by   text check (agreed_by is null or char_length(agreed_by) between 2 and 120),
  agreed_on   date,
  updated_by  uuid references crm.users(id),
  updated_at  timestamptz,
  -- Un objetivo de recuperación solo vale con quién lo acordó y cuándo.
  constraint service_objectives_recovery check (kind <> 'recovery' or target is null or (agreed_by is not null and agreed_on is not null))
);
insert into crm.service_objectives (key, kind, position) values
  ('availability', 'slo', 1), ('latency_page', 'slo', 2), ('latency_action', 'slo', 3), ('latency_api', 'slo', 4),
  ('rpo_minutes', 'recovery', 5), ('rto_minutes', 'recovery', 6), ('restore_test_days', 'recovery', 7);
alter table crm.service_objectives enable row level security;
alter table crm.service_objectives force row level security;
grant select on crm.service_objectives to contigo_app;
grant update (target, agreed_by, agreed_on, updated_by, updated_at) on crm.service_objectives to contigo_app;
create policy service_objectives_read on crm.service_objectives for select to contigo_app using ((select app.is_global()));
create policy service_objectives_upd on crm.service_objectives for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ GOB-07: incidentes
create table crm.incidents (
  id           uuid primary key default app.uuid_v7(),
  title        text not null check (char_length(title) between 5 and 160),
  severity     text not null check (severity in ('high', 'medium', 'low')),
  status       text not null default 'open' check (status in ('open', 'mitigated', 'closed')),
  started_at   timestamptz not null,
  resolved_at  timestamptz,
  market_code  text references crm.markets(code),
  impact       text not null check (char_length(impact) between 5 and 2000),
  cause        text check (cause is null or char_length(cause) <= 2000),
  actions      text check (actions is null or char_length(actions) <= 2000),
  request_id   text check (request_id is null or char_length(request_id) <= 80),
  created_by   uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz,
  -- Un incidente se cierra con su causa, lo que se hizo y cuándo se resolvió.
  constraint incidents_closed check (status <> 'closed' or (resolved_at is not null and cause is not null and actions is not null)),
  constraint incidents_order check (resolved_at is null or resolved_at >= started_at)
);
create index incidents_started_idx on crm.incidents (started_at desc);
alter table crm.incidents enable row level security;
alter table crm.incidents force row level security;
grant select, insert on crm.incidents to contigo_app;
grant update (status, resolved_at, impact, cause, actions, updated_by, updated_at) on crm.incidents to contigo_app;
create policy incidents_read on crm.incidents for select to contigo_app using ((select app.is_global()));
create policy incidents_ins on crm.incidents for insert to contigo_app
  with check ((select app.is_admin()) and created_by = (select app.current_user_id()));
create policy incidents_upd on crm.incidents for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ GOB-07: pruebas de restauración (nace vacío)
create table crm.restore_tests (
  id            uuid primary key default app.uuid_v7(),
  tested_on     date not null,
  tested_by     text not null check (char_length(tested_by) between 2 and 120),
  environment   text not null check (environment in ('staging', 'production')),
  backup_from   timestamptz,
  minutes       integer check (minutes is null or minutes between 0 and 100000),
  data_loss_minutes integer check (data_loss_minutes is null or data_loss_minutes between 0 and 100000),
  result        text not null check (result in ('ok', 'failed')),
  evidence      text not null check (char_length(evidence) between 5 and 500),
  notes         text check (notes is null or char_length(notes) <= 2000),
  recorded_by   uuid not null references crm.users(id),
  created_at    timestamptz not null default now()
);
create index restore_tests_on_idx on crm.restore_tests (tested_on desc);
alter table crm.restore_tests enable row level security;
alter table crm.restore_tests force row level security;
grant select, insert on crm.restore_tests to contigo_app;
create policy restore_tests_read on crm.restore_tests for select to contigo_app using ((select app.is_global()));
create policy restore_tests_ins on crm.restore_tests for insert to contigo_app
  with check ((select app.is_admin()) and recorded_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ GOB-04: componentes con dueño técnico y suplente
create table crm.components (
  key          text primary key check (key ~ '^[a-z_]{3,40}$'),
  position     integer not null,
  name_es      text not null,
  name_en      text not null,
  owner_name   text check (owner_name is null or char_length(owner_name) between 2 and 120),
  backup_name  text check (backup_name is null or char_length(backup_name) between 2 and 120),
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz,
  -- El suplente cubre al dueño: no puede ser la misma persona.
  constraint components_two_people check (owner_name is null or backup_name is null or lower(btrim(owner_name)) <> lower(btrim(backup_name)))
);
insert into crm.components (key, position, name_es, name_en) values
  ('app', 1, 'Aplicación web', 'Web application'),
  ('database', 2, 'Base de datos y respaldos', 'Database and backups'),
  ('identity', 3, 'Ingreso con Google', 'Google sign-in'),
  ('deploy', 4, 'Despliegue y vuelta atrás', 'Deployment and rollback'),
  ('inbound_api', 5, 'API de entrada (Sales App, datos de ventas, formularios)', 'Inbound API (Sales App, sales data, forms)'),
  ('pipedrive_import', 6, 'Importación de Pipedrive', 'Pipedrive import'),
  ('jobs', 7, 'Tareas programadas', 'Scheduled jobs');
alter table crm.components enable row level security;
alter table crm.components force row level security;
grant select on crm.components to contigo_app;
grant update (owner_name, backup_name, updated_by, updated_at) on crm.components to contigo_app;
create policy components_read on crm.components for select to contigo_app using ((select app.is_global()));
create policy components_upd on crm.components for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ GOB-04: calendario de mantenimiento
create table crm.maintenance_windows (
  id           uuid primary key default app.uuid_v7(),
  title        text not null check (char_length(title) between 5 and 160),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  market_code  text references crm.markets(code),
  impact       text not null check (char_length(impact) between 5 and 1000),
  status       text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_by   uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz,
  check (ends_at > starts_at)
);
create index maintenance_windows_start_idx on crm.maintenance_windows (starts_at desc);
alter table crm.maintenance_windows enable row level security;
alter table crm.maintenance_windows force row level security;
grant select, insert on crm.maintenance_windows to contigo_app;
grant update (status, updated_by, updated_at) on crm.maintenance_windows to contigo_app;
-- El calendario lo ve cualquier persona con acceso: una ventana global, todas; una de mercado, quien trabaja en él.
create policy maintenance_read on crm.maintenance_windows for select to contigo_app
  using ((select app.current_user_id()) is not null and (market_code is null or market_code = any((select app.my_markets())::text[])));
create policy maintenance_ins on crm.maintenance_windows for insert to contigo_app
  with check ((select app.is_admin()) and created_by = (select app.current_user_id()));
create policy maintenance_upd on crm.maintenance_windows for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ GOB-04: versiones con notas y lista de salida
create table crm.releases (
  id             uuid primary key default app.uuid_v7(),
  version        text not null unique check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  title_es       text not null check (char_length(title_es) between 3 and 140),
  title_en       text not null check (char_length(title_en) between 3 and 140),
  notes_es       text not null check (char_length(notes_es) between 5 and 3000),
  notes_en       text not null check (char_length(notes_en) between 5 and 3000),
  planned_for    date,
  -- Toca comisiones o el alta de comercios: exige aviso previo con fecha de entrada en vigor.
  touches_money  boolean not null default false,
  status         text not null default 'draft' check (status in ('draft', 'announced', 'released')),
  announced_at   timestamptz,
  announced_by   uuid references crm.users(id),
  announcement_id uuid,
  released_at    timestamptz,
  released_by    uuid references crm.users(id),
  -- Lista de salida: por punto, quién lo dio por cumplido, cuándo y con qué evidencia.
  checklist      jsonb not null default '{}'::jsonb,
  created_by     uuid not null references crm.users(id),
  created_at     timestamptz not null default now(),
  constraint releases_announced check ((status = 'draft') = (announced_at is null)),
  -- Comunicar antes de liberar: no hay versión liberada sin aviso previo.
  constraint releases_released check ((status = 'released') = (released_at is not null) and (released_at is null or released_at >= announced_at)),
  constraint releases_money check (not touches_money or status = 'draft' or planned_for is not null)
);
create index releases_created_idx on crm.releases (created_at desc);
alter table crm.releases enable row level security;
alter table crm.releases force row level security;
grant select, insert on crm.releases to contigo_app;
grant update (title_es, title_en, notes_es, notes_en, planned_for, touches_money, status, announced_at, announced_by, announcement_id, released_at, released_by, checklist) on crm.releases to contigo_app;
-- Las notas de una versión anunciada o liberada las lee cualquier persona con acceso; un borrador, solo administración y leadership.
create policy releases_read on crm.releases for select to contigo_app
  using ((select app.is_global()) or ((select app.current_user_id()) is not null and status <> 'draft'));
create policy releases_ins on crm.releases for insert to contigo_app
  with check ((select app.is_admin()) and created_by = (select app.current_user_id()) and status = 'draft');
create policy releases_upd on crm.releases for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ------------------------------------------------------------------ GOB-04: registro de cada despliegue
create table crm.deployments (
  id           uuid primary key default app.uuid_v7(),
  environment  text not null check (environment in ('development', 'test', 'staging', 'production')),
  commit_sha   text not null check (commit_sha ~ '^[0-9a-f]{7,64}$'),
  ref          text check (ref is null or char_length(ref) <= 200),
  release_id   uuid references crm.releases(id),
  deployed_at  timestamptz not null default now(),
  deployed_by  text check (deployed_by is null or char_length(deployed_by) between 2 and 120),
  result       text not null default 'ok' check (result in ('ok', 'rolled_back', 'failed')),
  -- 'detected': la app vio un commit nuevo al correr; 'manual': lo anotó una persona.
  source       text not null check (source in ('detected', 'manual')),
  notes        text check (notes is null or char_length(notes) <= 1000),
  recorded_by  uuid references crm.users(id),
  created_at   timestamptz not null default now()
);
create unique index deployments_detected_uq on crm.deployments (environment, commit_sha) where source = 'detected';
create index deployments_at_idx on crm.deployments (deployed_at desc);
alter table crm.deployments enable row level security;
alter table crm.deployments force row level security;
grant select, insert on crm.deployments to contigo_app;
create policy deployments_read on crm.deployments for select to contigo_app using ((select app.is_global()));
create policy deployments_ins on crm.deployments for insert to contigo_app
  with check ((select app.is_admin()) and recorded_by = (select app.current_user_id()) and source = 'manual');

-- La app anota sola el commit que corre (sin persona): una vez por ambiente y commit.
create or replace function app.record_deployment(p_environment text, p_commit text, p_ref text)
returns boolean language plpgsql security definer set search_path = pg_catalog, crm, app as $$
declare v_count integer;
begin
  if p_commit is null or p_commit !~ '^[0-9a-f]{7,64}$' or p_environment not in ('development', 'test', 'staging', 'production') then
    return false;
  end if;
  insert into crm.deployments (environment, commit_sha, ref, source) values (p_environment, lower(p_commit), left(p_ref, 200), 'detected')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;
revoke all on function app.record_deployment(text, text, text) from public;
grant execute on function app.record_deployment(text, text, text) to contigo_app;

-- ------------------------------------------------------------------ GOB-09: costos cargados a mano
create table crm.cost_entries (
  id          uuid primary key default app.uuid_v7(),
  month       date not null check (extract(day from month) = 1),
  -- 'cost': lo que cuesta operar CONTIGO; 'reference': contra qué se compara (licencias que se dejan de pagar).
  kind        text not null check (kind in ('cost', 'reference')),
  component   text not null check (component in ('platform', 'database', 'third_party', 'ai', 'support', 'other')),
  label       text not null check (char_length(label) between 2 and 120),
  amount_usd  numeric(12, 2) not null check (amount_usd >= 0),
  note        text check (note is null or char_length(note) <= 500),
  source      text not null default 'manual' check (source in ('manual', 'billing')),
  created_by  uuid not null references crm.users(id),
  created_at  timestamptz not null default now(),
  voided_by   uuid references crm.users(id),
  voided_at   timestamptz,
  constraint cost_entries_void check ((voided_by is null) = (voided_at is null))
);
create index cost_entries_month_idx on crm.cost_entries (month desc);
alter table crm.cost_entries enable row level security;
alter table crm.cost_entries force row level security;
grant select, insert on crm.cost_entries to contigo_app;
-- Un costo mal cargado se anula y se carga de nuevo: el monto no se edita.
grant update (voided_by, voided_at) on crm.cost_entries to contigo_app;
create policy cost_entries_read on crm.cost_entries for select to contigo_app using ((select app.is_global()));
create policy cost_entries_ins on crm.cost_entries for insert to contigo_app
  with check ((select app.is_admin()) and created_by = (select app.current_user_id()) and voided_at is null);
create policy cost_entries_void on crm.cost_entries for update to contigo_app
  using ((select app.is_admin()) and voided_at is null) with check ((select app.is_admin()) and voided_by = (select app.current_user_id()));

-- Denominadores del costo unitario por mes: personas que entraron y comercios con alguien a cargo. Sin nombres.
create or replace function app.cost_denominators(p_month date)
returns table (active_people integer, managed_accounts integer)
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  select
    case when (select app.is_global()) then (
      select count(distinct e.actor_id)::int from crm.audit_events e join crm.users u on u.id = e.actor_id
       where e.action = 'session.started' and not u.is_system
         and e.at >= p_month::timestamptz and e.at < (p_month + interval '1 month')::timestamptz) end,
    case when (select app.is_global()) then (
      select count(*)::int from crm.accounts a
       where a.owner_id is not null and a.merged_into is null
         and a.created_at < (p_month + interval '1 month')::timestamptz
         and (a.archived_at is null or a.archived_at >= (p_month + interval '1 month')::timestamptz)) end
$$;
revoke all on function app.cost_denominators(date) from public;
grant execute on function app.cost_denominators(date) to contigo_app;

-- ------------------------------------------------------------------ GOB-08: corridas del generador de datos de prueba
create table crm.synthetic_runs (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  seed         integer not null,
  accounts     integer not null check (accounts between 1 and 200000),
  depth        integer not null check (depth between 1 and 8),
  edge_cases   boolean not null default true,
  created      jsonb not null default '{}'::jsonb,
  run_by       text not null check (char_length(run_by) between 2 and 120),
  at           timestamptz not null default now()
);
create table crm.synthetic_accounts (
  account_id  uuid primary key references crm.accounts(id) on delete cascade,
  run_id      uuid not null references crm.synthetic_runs(id) on delete cascade
);
create index synthetic_accounts_run_idx on crm.synthetic_accounts (run_id);
alter table crm.synthetic_runs enable row level security;
alter table crm.synthetic_runs force row level security;
alter table crm.synthetic_accounts enable row level security;
alter table crm.synthetic_accounts force row level security;
grant select on crm.synthetic_runs, crm.synthetic_accounts to contigo_app;
create policy synthetic_runs_read on crm.synthetic_runs for select to contigo_app using ((select app.is_global()));
create policy synthetic_accounts_read on crm.synthetic_accounts for select to contigo_app using ((select app.is_global()));

-- De dónde salieron los datos de este ambiente: cuántos comercios son del generador, de la semilla o de una importación.
create or replace function app.data_origin()
returns table (accounts_total integer, accounts_generated integer, accounts_imported integer, people_real integer, people_synthetic integer)
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  select
    case when (select app.is_global()) then (select count(*)::int from crm.accounts) end,
    case when (select app.is_global()) then (select count(*)::int from crm.synthetic_accounts) end,
    case when (select app.is_global()) then (select count(*)::int from crm.account_aliases where system = 'pipedrive') end,
    case when (select app.is_global()) then (select count(*)::int from crm.users where not is_synthetic and not is_system and is_active) end,
    case when (select app.is_global()) then (select count(*)::int from crm.users where is_synthetic and is_active) end
$$;
revoke all on function app.data_origin() from public;
grant execute on function app.data_origin() to contigo_app;

-- ------------------------------------------------------------------ E7.F6: solicitudes de configuración con aprobación
create table crm.config_requests (
  id             uuid primary key default app.uuid_v7(),
  kind           text not null check (kind in ('field', 'option', 'pipeline', 'report', 'other')),
  title          text not null check (char_length(title) between 3 and 120),
  purpose        text not null check (char_length(purpose) between 10 and 1000),
  market_code    text references crm.markets(code),   -- vacío: compartido entre mercados (va primero)
  options        text check (options is null or char_length(options) <= 1000),
  status         text not null default 'open' check (status in ('open', 'approved', 'rejected', 'done')),
  requested_by   uuid not null references crm.users(id),
  created_at     timestamptz not null default now(),
  decided_by     uuid references crm.users(id),
  decided_at     timestamptz,
  decision_note  text check (decision_note is null or char_length(decision_note) between 2 and 1000),
  field_id       uuid references crm.field_definitions(id),
  constraint config_requests_decided check ((status = 'open') = (decided_by is null) and (decided_by is null) = (decided_at is null)),
  constraint config_requests_rejected check (status <> 'rejected' or decision_note is not null)
);
create index config_requests_status_idx on crm.config_requests (status, created_at desc);
create index config_requests_user_idx on crm.config_requests (requested_by, created_at desc);
alter table crm.config_requests enable row level security;
alter table crm.config_requests force row level security;
grant select, insert on crm.config_requests to contigo_app;
grant update (status, decided_by, decided_at, decision_note, field_id) on crm.config_requests to contigo_app;
create policy config_requests_read on crm.config_requests for select to contigo_app
  using (requested_by = (select app.current_user_id()) or (select app.is_global()));
create policy config_requests_ins on crm.config_requests for insert to contigo_app
  with check (requested_by = (select app.current_user_id()) and status = 'open' and decided_by is null and field_id is null
              and (market_code is null or market_code = any((select app.my_markets())::text[])));
create policy config_requests_decide on crm.config_requests for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and decided_by = (select app.current_user_id()));

-- Un campo nuevo lleva escrito para qué sirve y, si nació de una solicitud, cuál.
alter table crm.field_definitions
  add column purpose text check (purpose is null or char_length(purpose) between 10 and 1000),
  add column request_id uuid references crm.config_requests(id);

-- ------------------------------------------------------------------ E7.F7: el motivo de cada cambio de configuración
-- La bitácora no se edita: el motivo vive al lado, una vez por evento, y tampoco se edita.
create table crm.change_reasons (
  event_id    uuid primary key references crm.audit_events(id),
  reason      text not null check (char_length(reason) between 5 and 1000),
  created_by  uuid not null references crm.users(id),
  created_at  timestamptz not null default now()
);
alter table crm.change_reasons enable row level security;
alter table crm.change_reasons force row level security;
grant select, insert on crm.change_reasons to contigo_app;
create policy change_reasons_read on crm.change_reasons for select to contigo_app
  using ((select app.is_global()) or exists (select 1 from crm.audit_events e where e.id = event_id));
create policy change_reasons_ins on crm.change_reasons for insert to contigo_app
  with check ((select app.is_admin()) and created_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ E7.F3: champion por equipo y revisión mensual
create table crm.team_champions (
  team_id   uuid primary key references crm.teams(id) on delete cascade,
  user_id   uuid not null references crm.users(id),
  named_by  uuid not null references crm.users(id),
  named_at  timestamptz not null default now()
);
create table crm.champion_reviews (
  id           uuid primary key default app.uuid_v7(),
  team_id      uuid not null references crm.teams(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  notes        text not null check (char_length(notes) between 5 and 2000),
  reviewed_by  uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  unique (team_id, month)
);
alter table crm.team_champions enable row level security;
alter table crm.team_champions force row level security;
alter table crm.champion_reviews enable row level security;
alter table crm.champion_reviews force row level security;
grant select, insert, update, delete on crm.team_champions to contigo_app;
grant select, insert on crm.champion_reviews to contigo_app;
-- Quién es el champion de cada equipo lo ve cualquier persona con acceso (igual que los equipos).
create policy team_champions_read on crm.team_champions for select to contigo_app using ((select app.current_user_id()) is not null);
create policy team_champions_ins on crm.team_champions for insert to contigo_app
  with check ((select app.is_admin()) and named_by = (select app.current_user_id()));
create policy team_champions_upd on crm.team_champions for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and named_by = (select app.current_user_id()));
create policy team_champions_del on crm.team_champions for delete to contigo_app using ((select app.is_admin()));
create policy champion_reviews_read on crm.champion_reviews for select to contigo_app using ((select app.is_global()));
create policy champion_reviews_ins on crm.champion_reviews for insert to contigo_app
  with check ((select app.is_admin()) and reviewed_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ E7.F9: material de capacitación por mercado
-- Del material se guarda el enlace y dónde está publicado, nunca el archivo.
create table crm.training_materials (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  kind         text not null check (kind in ('deck', 'lead_guide', 'faq')),
  locale       text not null check (locale in ('es', 'en')),
  title        text not null check (char_length(title) between 3 and 140),
  url          text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) between 12 and 500),
  in_portal    boolean not null default false,
  pinned       boolean not null default false,
  updated_by   uuid not null references crm.users(id),
  updated_at   timestamptz not null default now(),
  unique (market_code, kind, locale)
);
alter table crm.training_materials enable row level security;
alter table crm.training_materials force row level security;
grant select, insert, update, delete on crm.training_materials to contigo_app;
create policy training_materials_read on crm.training_materials for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]));
create policy training_materials_ins on crm.training_materials for insert to contigo_app
  with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));
create policy training_materials_upd on crm.training_materials for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));
create policy training_materials_del on crm.training_materials for delete to contigo_app using ((select app.is_admin()));
