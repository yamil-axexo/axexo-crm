-- 0045_integraciones2: lo que el paquete de integraciones y migración dejó abierto.
-- 1) E5.F1/F2: cifras de ventas por tienda (activaciones por carrier y volumen de pago por producto: mes a la fecha,
--    mes anterior y 90 días) que llegan cada noche en su propio archivo (docs/contracts/store-sales-daily-v1.md).
--    Sin actividad = null (la pantalla lo muestra vacío, nunca en cero).
-- 2) E5.F3/F4/F5: cargas visibles. Cada carga (Pipedrive, datos de ventas, Sales App, importaciones) deja inicio y fin en
--    crm.load_runs, tiene responsable y hora esperada (crm.data_loads), respeta la ventana de mantenimiento de su mercado
--    (crm.maintenance_windows) y nunca corre junto con otra (índice único: una sola carga "running" a la vez).
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
grant select, insert, update on crm.store_sales_lines to contigo_app;
create policy store_sales_lines_read on crm.store_sales_lines for select to contigo_app using (
  exists (select 1 from crm.accounts a where a.id = store_sales_lines.account_id));
create policy store_sales_lines_sys_ins on crm.store_sales_lines for insert to contigo_app with check ((select app.is_admin()));
create policy store_sales_lines_sys_upd on crm.store_sales_lines for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));


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

create table crm.load_runs (
  id           uuid primary key default app.uuid_v7(),
  load_key     text not null references crm.data_loads(key),
  trigger      text not null check (trigger in ('cron','visit','manual','api','watch')),
  status       text not null default 'running' check (status in ('running','ok','failed','paused','late')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  done         int not null default 0 check (done >= 0),
  note         text check (note is null or char_length(note) <= 500),
  error        text check (error is null or char_length(error) <= 80),
  actor_id     uuid references crm.users(id),
  check ((status = 'running') = (finished_at is null))
);
-- E5.F4: nunca dos cargas a la vez. La base lo garantiza: solo puede haber una fila "running".
create unique index load_runs_one_running on crm.load_runs ((true)) where status = 'running';
create index load_runs_key_idx on crm.load_runs (load_key, started_at desc);
alter table crm.load_runs enable row level security;
alter table crm.load_runs force row level security;   -- AUTHZ-03
revoke all on crm.load_runs from contigo_app;
grant select, insert, update on crm.load_runs to contigo_app;
create policy load_runs_read on crm.load_runs for select to contigo_app using ((select app.current_user_id()) is not null);
create policy load_runs_ins on crm.load_runs for insert to contigo_app with check ((select app.is_admin()) or (select app.can_import_any()));
create policy load_runs_upd on crm.load_runs for update to contigo_app using ((select app.is_admin()) or (select app.can_import_any())) with check ((select app.is_admin()) or (select app.can_import_any()));

create table crm.maintenance_windows (
  market_code  text primary key references crm.markets(code),
  starts_local time not null,
  ends_local   time not null,
  is_active    boolean not null default true,
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  check (starts_local <> ends_local)
);
alter table crm.maintenance_windows enable row level security;
alter table crm.maintenance_windows force row level security;   -- AUTHZ-03
revoke all on crm.maintenance_windows from contigo_app;
grant select, insert, update, delete on crm.maintenance_windows to contigo_app;
create policy maintenance_windows_read on crm.maintenance_windows for select to contigo_app using ((select app.current_user_id()) is not null);
create policy maintenance_windows_write on crm.maintenance_windows for all to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- ¿El mercado está ahora dentro de su ventana? La ventana puede cruzar la medianoche (22:00 a 02:00).
create or replace function app.in_maintenance(p_market text, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  select coalesce((
    select case when w.starts_local < w.ends_local then t >= w.starts_local and t < w.ends_local
                else t >= w.starts_local or t < w.ends_local end
      from crm.maintenance_windows w join crm.markets m on m.code = w.market_code,
           lateral (select (p_at at time zone m.timezone)::time as t) x
     where w.market_code = p_market and w.is_active), false)
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
