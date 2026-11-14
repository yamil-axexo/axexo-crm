-- 0036_integraciones2: lo que el paquete de integraciones y migración dejó abierto.
-- 1) E5.F1/F2: cifras de ventas por tienda (activaciones por carrier y volumen de pago por producto: mes a la fecha,
--    mes anterior y 90 días) que llegan cada noche en su propio archivo (docs/contracts/store-sales-daily-v1.md).
--    Sin actividad = null (la pantalla lo muestra vacío, nunca en cero).
-- 2) E5.F3/F4/F5: cargas visibles. Cada carga (Pipedrive, datos de ventas, Sales App, importaciones) deja inicio y fin en
--    crm.load_runs, tiene responsable y hora esperada (crm.data_loads), respeta la ventana diaria sin cargas de su mercado
--    (crm.load_windows) y el calendario de mantenimiento (crm.maintenance_windows), y nunca corre junto con otra (índice único: una sola carga "running" a la vez).
-- 3) E5.F6: el check-in que devuelve la herramienta de rutas entra como visita (fuente "route_tool").
-- 4) E5.F9: documentos generados (pedido, propuesta, carta) con su estado en la bóveda (apagada).
-- 5) E6.F4: respaldos de lo importado de Pipedrive, auditados. E6.F8: recargas de un mercado en ambiente de prueba.
-- 6) E18.F7/F8: importación de la hoja de leads de México (los leads muertos entran cerrados con motivo y se pueden deshacer).

-- ------------------------------------------------------------------ 1) cifras de ventas por tienda
create table crm.store_sales_lines (
  account_id   uuid not null references crm.accounts(id),
  as_of        date not null,
  market_code  text not null references crm.markets(code),
  line_kind    text not null check (line_kind in ('activations','payments')),
  line_key     text not null check (char_length(line_key) between 1 and 60),
  mtd          bigint check (mtd is null or mtd > 0),
  prev_month   bigint check (prev_month is null or prev_month > 0),
  d90          bigint check (d90 is null or d90 > 0),
  currency     char(3),
  batch_id     uuid references crm.ingest_batches(id),
  primary key (account_id, as_of, line_kind, line_key),
  check ((line_kind = 'payments') = (currency is not null))
);
create index store_sales_lines_market_idx on crm.store_sales_lines (market_code, as_of desc);
alter table crm.store_sales_lines enable row level security;
alter table crm.store_sales_lines force row level security;   -- AUTHZ-03
revoke all on crm.store_sales_lines from contigo_app;
grant select, insert, update, delete on crm.store_sales_lines to contigo_app;
create policy store_sales_lines_read on crm.store_sales_lines for select to contigo_app using (
  exists (select 1 from crm.accounts a where a.id = store_sales_lines.account_id));
create policy store_sales_lines_sys_ins on crm.store_sales_lines for insert to contigo_app with check ((select app.is_admin()));
create policy store_sales_lines_sys_upd on crm.store_sales_lines for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
create policy store_sales_lines_sys_del on crm.store_sales_lines for delete to contigo_app using ((select app.is_admin()));


-- ------------------------------------------------------------------ 2) cargas visibles
-- ¿Quien está puede importar en algún mercado? (las importaciones de hojas también son cargas)
create or replace function app.can_import_any() returns boolean
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  select exists (select 1 from crm.markets m where app.can_import(m.code))
$$;
revoke all on function app.can_import_any() from public;
grant execute on function app.can_import_any() to contigo_app;

create table crm.data_loads (
  key          text primary key check (key ~ '^[a-z_]{3,40}$'),
  label_es     text not null check (char_length(label_es) between 3 and 80),
  label_en     text not null check (char_length(label_en) between 3 and 80),
  job_key      text check (job_key is null or job_key ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  owner_id     uuid references crm.users(id),
  -- Hora local (del mercado de referencia) a la que la carga ya debió terminar. Null: no tiene hora fija.
  expected_by  time,
  clock_market text references crm.markets(code),
  -- Mercados que toca; vacío = todos. La ventana de mantenimiento de cualquiera de ellos la detiene.
  markets      text[] not null default '{}',
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  check ((expected_by is null) or (clock_market is not null))
);
alter table crm.data_loads enable row level security;
alter table crm.data_loads force row level security;   -- AUTHZ-03
revoke all on crm.data_loads from contigo_app;
grant select, update on crm.data_loads to contigo_app;
create policy data_loads_read on crm.data_loads for select to contigo_app using ((select app.current_user_id()) is not null);
create policy data_loads_upd on crm.data_loads for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
insert into crm.data_loads (key, label_es, label_en, job_key, expected_by, clock_market) values
  ('pipedrive',   'Carga de Pipedrive',              'Pipedrive load',        null, null, null),
  ('sales_file',  'Archivo diario de ventas',        'Daily sales file',      'embudo.sales_file_pull', '07:00', 'MX'),
  ('store_sales', 'Cifras de ventas por tienda',     'Store sales figures',   'integraciones2.store_sales_nightly', '07:00', 'MX'),
  ('sales_app',   'Eventos de la Sales App',         'Sales App events',      null, null, null),
  ('imports',     'Importaciones de hojas',          'Sheet imports',         null, null, null);

-- Un solo registro de corridas: el del corredor de tareas programadas (crm.job_runs, 0019). Una carga de datos es una corrida
-- con su llave de carga (load_key) que además puede estar corriendo, en pausa o "no llegó". crm.load_runs es solo una vista
-- de esas corridas, para leer y escribir las cargas con sus nombres; no guarda nada aparte.
alter table crm.job_runs
  add column load_key text references crm.data_loads(key),
  alter column started_at set default now(),
  alter column finished_at drop not null;
alter table crm.job_runs drop constraint job_runs_trigger_check, drop constraint job_runs_status_check;
alter table crm.job_runs
  add constraint job_runs_trigger_check check (trigger in ('cron','visit','manual','api','watch')),
  add constraint job_runs_status_check check (status in ('ok','failed') or (load_key is not null and status in ('running','paused','late'))),
  add constraint job_runs_running_check check ((status = 'running') = (finished_at is null));
-- E5.F4: nunca dos cargas a la vez. La base lo garantiza: solo puede haber una corrida "running" (solo las cargas corren así).
create unique index job_runs_one_running on crm.job_runs ((true)) where status = 'running';
create index job_runs_load_idx on crm.job_runs (load_key, started_at desc) where load_key is not null;
-- La corrida de una carga sin tarea propia (Pipedrive, importaciones, Sales App) se anota como "load.<llave>".
create function crm.job_runs_load_key() returns trigger language plpgsql as $$
begin
  if new.job_key is null and new.load_key is not null then
    new.job_key := coalesce((select l.job_key from crm.data_loads l where l.key = new.load_key), 'load.' || new.load_key);
  end if;
  -- Una carga que empieza no ha terminado (la columna tiene "ahora" por defecto para las corridas ya cerradas).
  if new.status = 'running' then new.finished_at := null; end if;
  return new;
end $$;
create trigger job_runs_load_key before insert on crm.job_runs for each row execute function crm.job_runs_load_key();
grant update (status, finished_at, done, note, error, duration_ms) on crm.job_runs to contigo_app;
create policy job_runs_load_read on crm.job_runs for select to contigo_app using (load_key is not null and (select app.current_user_id()) is not null);
create policy job_runs_load_ins on crm.job_runs for insert to contigo_app with check (load_key is not null and ((select app.is_admin()) or (select app.can_import_any())));
create policy job_runs_load_upd on crm.job_runs for update to contigo_app using (load_key is not null and ((select app.is_admin()) or (select app.can_import_any())))
  with check (load_key is not null and ((select app.is_admin()) or (select app.can_import_any())));
create view crm.load_runs with (security_invoker = true) as
  select id, load_key, trigger, status, started_at, finished_at, done, note, error, actor_id, duration_ms, job_key from crm.job_runs where load_key is not null;
-- Una carga nueva nace corriendo (la tabla de corridas no tiene valor por defecto para el estado).
alter view crm.load_runs alter column status set default 'running';
grant select, insert, update on crm.load_runs to contigo_app;

create table crm.load_windows (
  market_code  text primary key references crm.markets(code),
  starts_local time not null,
  ends_local   time not null,
  is_active    boolean not null default true,
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  check (starts_local <> ends_local)
);
alter table crm.load_windows enable row level security;
alter table crm.load_windows force row level security;   -- AUTHZ-03
revoke all on crm.load_windows from contigo_app;
grant select, insert, update, delete on crm.load_windows to contigo_app;
create policy load_windows_read on crm.load_windows for select to contigo_app using ((select app.current_user_id()) is not null);
create policy load_windows_write on crm.load_windows for all to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- ¿El mercado está ahora en mantenimiento? Dos fuentes: su ventana diaria sin cargas (crm.load_windows, puede cruzar la
-- medianoche: 22:00 a 02:00) y el calendario de mantenimiento de gobierno (crm.maintenance_windows, 0028): una ventana
-- planeada de ese mercado o de todos los mercados.
create or replace function app.in_maintenance(p_market text, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  select coalesce((
    select case when w.starts_local < w.ends_local then t >= w.starts_local and t < w.ends_local
                else t >= w.starts_local or t < w.ends_local end
      from crm.load_windows w join crm.markets m on m.code = w.market_code,
           lateral (select (p_at at time zone m.timezone)::time as t) x
     where w.market_code = p_market and w.is_active), false)
  or exists (select 1 from crm.maintenance_windows mw
              where mw.status = 'planned' and p_at >= mw.starts_at and p_at < mw.ends_at
                and (mw.market_code is null or mw.market_code = p_market))
$$;
revoke all on function app.in_maintenance(text, timestamptz) from public;
grant execute on function app.in_maintenance(text, timestamptz) to contigo_app;


-- ------------------------------------------------------------------ 3) check-in de la herramienta de rutas
alter table crm.inbound_events drop constraint if exists inbound_events_source_check;
alter table crm.inbound_events add constraint inbound_events_source_check check (source in ('sales_app','s5','web_form','route_tool'));
alter table crm.untrusted_marks drop constraint if exists untrusted_marks_origin_check;
alter table crm.untrusted_marks add constraint untrusted_marks_origin_check check (origin in ('web_form','api_form','sales_app','csv_import','route_tool'));

-- ------------------------------------------------------------------ 4) documentos generados
create table crm.generated_documents (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  account_id    uuid not null references crm.accounts(id),
  deal_id       uuid references crm.deals(id),
  kind          text not null check (kind in ('order','proposal','letter')),
  title         text not null check (char_length(btrim(title)) between 3 and 160),
  body          text not null check (char_length(body) between 1 and 8000),
  vault_status  text not null default 'channel_off' check (vault_status in ('channel_off','simulated','stored')),
  vault_ref     text check (vault_ref is null or char_length(vault_ref) <= 200),
  emailed_to    text check (emailed_to is null or char_length(emailed_to) <= 160),
  emailed_at    timestamptz,
  email_status  text check (email_status is null or char_length(email_status) <= 40),
  created_by    uuid not null references crm.users(id),
  created_at    timestamptz not null default now()
);
create index generated_documents_account_idx on crm.generated_documents (account_id, created_at desc);
alter table crm.generated_documents enable row level security;
alter table crm.generated_documents force row level security;   -- AUTHZ-03
revoke all on crm.generated_documents from contigo_app;
grant select, insert on crm.generated_documents to contigo_app;
grant update (vault_status, vault_ref, emailed_to, emailed_at, email_status) on crm.generated_documents to contigo_app;
create policy generated_documents_read on crm.generated_documents for select to contigo_app using (
  exists (select 1 from crm.accounts a where a.id = generated_documents.account_id));
create policy generated_documents_ins on crm.generated_documents for insert to contigo_app with check (
  created_by = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[])
  and exists (select 1 from crm.accounts a where a.id = generated_documents.account_id));
create policy generated_documents_upd on crm.generated_documents for update to contigo_app
  using (market_code = any((select app.write_markets())::text[])) with check (market_code = any((select app.write_markets())::text[]));

-- ------------------------------------------------------------------ 5) respaldos de Pipedrive y recargas de prueba
create table crm.pipedrive_backups (
  id          uuid primary key default app.uuid_v7(),
  created_by  uuid not null references crm.users(id),
  created_at  timestamptz not null default now(),
  rows        int not null check (rows >= 0),
  objects     jsonb not null default '{}'::jsonb check (jsonb_typeof(objects) = 'object'),
  format      text not null default 'contigo-pipedrive-backup/v1' check (format = 'contigo-pipedrive-backup/v1'),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$')
);
alter table crm.pipedrive_backups enable row level security;
alter table crm.pipedrive_backups force row level security;   -- AUTHZ-03
revoke all on crm.pipedrive_backups from contigo_app;
grant select, insert on crm.pipedrive_backups to contigo_app;
create policy pipedrive_backups_admin on crm.pipedrive_backups for all to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()) and created_by = (select app.current_user_id()));

-- ------------------------------------------------------------------ 6) hoja de leads de México
alter table crm.csv_imports drop constraint if exists csv_imports_kind_check;
alter table crm.csv_imports add constraint csv_imports_kind_check check (kind in ('accounts','contacts','leads','mx_leads'));

-- Deshacer: un lead que entró cerrado desde la hoja (muerto con motivo) también se retira si nadie lo trabajó.
create or replace function app.csv_import_undo(p_import uuid) returns table (undone int, kept int)
language plpgsql security definer set search_path = pg_catalog, crm, app as $$
declare
  v_imp crm.csv_imports;
  r crm.csv_import_rows;
  v_undo int := 0;
  v_keep int := 0;
  v_ok boolean;
begin
  select * into v_imp from crm.csv_imports where id = p_import for update;
  if v_imp.id is null or not app.can_import(v_imp.market_code) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_imp.status <> 'done' then
    raise exception 'import is not finished or was already undone' using errcode = '22023';
  end if;
  for r in select * from crm.csv_import_rows where import_id = p_import and outcome = 'created' order by row_no loop
    v_ok := false;
    begin
      if r.object = 'lead' then
        if exists (select 1 from crm.leads l where l.id = r.object_id
                     and (l.status = 'new' or (l.status = 'disqualified' and r.detail = 'closed_on_import')))
           and not exists (select 1 from crm.activities a where a.lead_id = r.object_id)
           and not exists (select 1 from crm.deals d where d.lead_id = r.object_id) then
          delete from crm.untrusted_marks where object = 'lead' and object_id = r.object_id;
          delete from crm.leads where id = r.object_id;
          v_ok := true;
        end if;
      elsif r.object = 'account' then
        if exists (select 1 from crm.accounts a where a.id = r.object_id and a.archived_at is null and a.lifecycle = 'prospect')
           and not exists (select 1 from crm.deals d where d.account_id = r.object_id)
           and not exists (select 1 from crm.activities a where a.account_id = r.object_id)
           and not exists (select 1 from crm.accounts c where c.parent_id = r.object_id and c.archived_at is null) then
          update crm.accounts set archived_at = now(), phone = null where id = r.object_id;
          v_ok := true;
        end if;
      elsif r.object = 'contact' then
        update crm.account_contacts set valid_to = now(), is_primary = false where contact_id = r.object_id and valid_to is null;
        v_ok := found;
      end if;
    exception when foreign_key_violation then
      v_ok := false;
    end;
    if v_ok then
      v_undo := v_undo + 1;
      update crm.csv_import_rows set outcome = 'undone' where import_id = p_import and row_no = r.row_no;
    else
      v_keep := v_keep + 1;
      update crm.csv_import_rows set outcome = 'kept', detail = 'worked_after_import' where import_id = p_import and row_no = r.row_no;
    end if;
  end loop;
  update crm.csv_imports set status = 'undone', undone_at = now(), undone_by = app.current_user_id() where id = p_import;
  return query select v_undo, v_keep;
end $$;

-- ------------------------------------------------------------------ 7) E6.F8: borrar un mercado en ambiente de prueba
-- Borra los datos de negocio del mercado (no su configuración, accesos, bitácora ni bajas de contacto) en varias pasadas para
-- respetar las llaves foráneas. Si algo no se puede borrar, no borra nada y dice qué tabla lo impidió. La aplicación solo
-- la llama fuera de producción y con confirmación escrita (src/domain/test-reset.ts). Después, la recarga desde el espejo
-- de Pipedrive vuelve a crear lo que vino de allá.
create or replace function app.reset_test_market(p_market text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, crm, app as $$
declare
  v_tables text[] := array['untrusted_marks','notices','notifications','generated_documents','store_sales_lines','merchant_metrics_daily','metric_restatements',
    'milestone_events','account_milestones','conversion_events','source_touches','deal_evidence','deal_ops_checks','deal_orders','order_dispatches','deal_items',
    'deal_stage_gaps','deal_stage_events','approvals','assignment_log','lead_escalation','exceptions','import_conflicts','import_baselines','duplicate_bypasses',
    'duplicate_pairs','merge_events','ticket_refs','tax_id_verifications','tax_ids','account_sensitive','account_product_events','account_products',
    'account_team','account_attributions','contact_primary_history','process_memberships','training_sessions','whatsapp_windows','source_touches',
    'referral_codes','consents','visits','activities','deals','leads','account_contacts','account_aliases','accounts','contacts'];
  v_counts jsonb := '{}'::jsonb;
  v_left text[];
  t text;
  n int;
  pass int;
begin
  if not app.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from crm.markets where code = p_market) then raise exception 'unknown market' using errcode = '22023'; end if;
  -- Integración de la ola 4: además de la lista, toda tabla con mercado que apunta a comercios, leads, negocios, contactos o
  -- actividades (cuidado de comercios, campo y canales, partners, asistencia y lo que venga). Así ningún paquete nuevo deja
  -- el borrado a medias por no estar en la lista.
  select coalesce(array_agg(distinct c.relname::text), '{}') || v_tables into v_tables
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace ns on ns.oid = c.relnamespace
    join pg_class r on r.oid = k.confrelid
   where ns.nspname = 'crm' and k.contype = 'f' and c.relkind = 'r' and r.relname in ('accounts','leads','deals','contacts','activities')
     and c.relname <> all(v_tables) and c.relname not in ('memberships')   -- los accesos no son datos del mercado
     and exists (select 1 from pg_attribute at where at.attrelid = c.oid and at.attname = 'market_code' and not at.attisdropped);
  -- Tablas sin mercado que apuntan a registros del mercado.
  delete from crm.account_links l where exists (select 1 from crm.accounts a where a.market_code = p_market and (a.id = l.child_id or a.id = l.parent_id));
  -- Un acceso de partner apunta a un comercio del mercado (su subárbol): sin el comercio, el acceso no tiene a qué apuntar.
  if exists (select 1 from information_schema.columns where table_schema = 'crm' and table_name = 'memberships' and column_name = 'scope_account_id') then
    execute 'delete from crm.memberships m where m.scope_account_id in (select x.id from crm.accounts x where x.market_code = $1)' using p_market;
  end if;
  if to_regclass('crm.intake_retries') is not null then
    execute 'delete from crm.intake_retries r where exists (select 1 from crm.leads x where x.id = r.lead_id and x.market_code = $1)' using p_market;
  end if;
  if to_regclass('crm.synthetic_accounts') is not null then
    execute 'delete from crm.synthetic_accounts s where exists (select 1 from crm.accounts x where x.id = s.account_id and x.market_code = $1)' using p_market;
  end if;
  for pass in 1..12 loop
    v_left := '{}';
    foreach t in array v_tables loop
      continue when to_regclass('crm.' || t) is null;
      begin
        if t = 'accounts' then
          execute 'update crm.accounts set parent_id = null where market_code = $1 and parent_id is not null' using p_market;
        end if;
        execute format('delete from crm.%I where market_code = $1', t) using p_market;
        get diagnostics n = row_count;
        if n > 0 then v_counts := jsonb_set(v_counts, array[t], to_jsonb(coalesce((v_counts ->> t)::int, 0) + n)); end if;
      exception when foreign_key_violation or raise_exception or check_violation then
        v_left := v_left || t;
      end;
    end loop;
    exit when cardinality(v_left) = 0;
  end loop;
  if cardinality(v_left) > 0 then
    raise exception 'could not wipe: %', array_to_string(v_left, ',') using errcode = '23503';
  end if;
  -- Lo que vino de Pipedrive se puede volver a cargar: se sueltan las referencias que quedaron sin registro y el espejo
  -- vuelve a quedar pendiente de carga (la recarga con "aplicar el mapeo de nuevo" solo crea lo que falta).
  delete from crm.external_refs r where r.system = 'pipedrive' and r.object in ('organization','person','deal','activity','note','lead')
    and not exists (select 1 from crm.accounts a where a.id = r.internal_id) and not exists (select 1 from crm.contacts c where c.id = r.internal_id)
    and not exists (select 1 from crm.deals d where d.id = r.internal_id) and not exists (select 1 from crm.activities x where x.id = r.internal_id)
    and not exists (select 1 from crm.leads l where l.id = r.internal_id);
  update crm.import_raw set loaded_at = null, load_note = null where source = 'pipedrive' and object not like 'cfg:%';
  return v_counts;
end $$;
revoke all on function app.reset_test_market(text) from public;
grant execute on function app.reset_test_market(text) to contigo_app;
