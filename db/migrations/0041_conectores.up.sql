-- 0041_conectores: tercer modo `live` en cada adaptador (paquete conectores). Lo que cambia en la base:
-- 1) los estados "sent" y "failed" en las colas que antes solo conocían "channel_off" y "simulated";
-- 2) huella SHA-256 de lo que se guarda afuera (documentos generados y lotes de la bitácora);
-- 3) registro de "Probar conexión", archivos de S5 ya cargados, suscripciones de push y buzones con captura encendida;
-- 4) funciones de sistema para la copia de la bitácora, la rotación de llaves del cifrado de campos y el push.
-- Ningún dato de credencial vive en la base: las credenciales son variables de entorno.

-- ============================================================ 1) estados nuevos en las colas
alter table crm.notifications drop constraint notifications_status_check;
alter table crm.notifications add constraint notifications_status_check check (status in ('delivered','queued_off','simulated','sent','failed','held_hours','held_digest','held_limit','digested','skipped_consent','skipped_no_address','blocked_template'));
alter table crm.cs_messages drop constraint cs_messages_status_check;
alter table crm.cs_messages add constraint cs_messages_status_check check (status in ('queued_off','simulated','sent','failed','blocked_template','skipped_consent','held_limit'));
alter table crm.external_queue drop constraint external_queue_status_check;
alter table crm.external_queue add constraint external_queue_status_check check (status in ('channel_off','simulated','sent','failed'));
alter table crm.contracts drop constraint contracts_esign_state_check;
alter table crm.contracts add constraint contracts_esign_state_check check (esign_state is null or esign_state in ('channel_off','simulated','sent','failed'));
alter table crm.report_outbox drop constraint report_outbox_status_check;
alter table crm.report_outbox add constraint report_outbox_status_check check (status in ('channel_off','simulated','sent','failed'));
alter table crm.document_reads drop constraint document_reads_outcome_check;
alter table crm.document_reads add constraint document_reads_outcome_check check (outcome in ('vault_off','simulated','link','signed'));
alter table crm.activities drop constraint activities_source_check;
alter table crm.activities add constraint activities_source_check check (source in ('user','rule','sales_app','s5','import','capture'));
-- La llamada al modelo de AI y la evaluación anotan también el modo encendido.
alter table crm.ia_calls drop constraint ia_calls_mode_check;
alter table crm.ia_calls add constraint ia_calls_mode_check check (mode in ('off','simulated','rules','live'));
alter table crm.ia_eval_runs drop constraint ia_eval_runs_adapter_mode_check;
alter table crm.ia_eval_runs add constraint ia_eval_runs_adapter_mode_check check (adapter_mode in ('off','simulated','live'));
-- El valor cifrado ocupa más que el texto: AES-256-GCM en base64 de hasta 1,500 caracteres de texto.
alter table crm.account_sensitive drop constraint account_sensitive_value_check;
alter table crm.account_sensitive add constraint account_sensitive_value_check check (length(value) between 1 and 8000);

-- ============================================================ 2) huella de lo que se guarda afuera
alter table crm.generated_documents add column vault_sha256 text check (vault_sha256 is null or vault_sha256 ~ '^[0-9a-f]{64}$');
grant update (vault_sha256) on crm.generated_documents to contigo_app;
alter table audit.archive_batches add column ref text check (ref is null or char_length(ref) <= 300);
alter table audit.archive_batches add column file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');

-- ============================================================ 3) "Probar conexión" (solo administración, auditado)
create table crm.connector_tests (
  id          uuid primary key default app.uuid_v7(),
  connector   text not null check (connector ~ '^[a-z][a-z0-9_]{1,40}$'),
  mode        text not null check (mode in ('off','simulated','live')),
  ok          boolean not null,
  detail      text not null check (char_length(detail) between 1 and 300),
  ms          int check (ms is null or ms >= 0),
  tested_by   uuid not null references crm.users(id),
  tested_at   timestamptz not null default now()
);
create index connector_tests_idx on crm.connector_tests (connector, tested_at desc);
alter table crm.connector_tests enable row level security;
alter table crm.connector_tests force row level security;
grant select, insert on crm.connector_tests to contigo_app;
create policy connector_tests_read on crm.connector_tests for select to contigo_app using ((select app.is_admin()) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy connector_tests_ins on crm.connector_tests for insert to contigo_app with check ((select app.is_admin()) and tested_by = (select app.current_user_id()));

-- Archivos de S5 ya cargados por un conector encendido: no se carga dos veces el mismo archivo.
create table crm.connector_files (
  connector   text not null check (connector ~ '^[a-z][a-z0-9_]{1,40}$'),
  path        text not null check (char_length(path) between 1 and 400),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  as_of       date not null,
  row_count   int not null default 0 check (row_count >= 0),
  loaded_at   timestamptz not null default now(),
  primary key (connector, path)
);
alter table crm.connector_files enable row level security;
alter table crm.connector_files force row level security;
grant select, insert on crm.connector_files to contigo_app;
create policy connector_files_read on crm.connector_files for select to contigo_app using ((select app.has_area('integrations')) or exists (select 1 from app.active_memberships() m where m.role = 'lt'));
create policy connector_files_ins on crm.connector_files for insert to contigo_app with check ((select app.current_user_id()) = (select app.system_user_id()) or (select app.has_area('integrations')));

-- ============================================================ 4) AUT-05: suscripciones de push del navegador (cada persona, las suyas)
create table crm.push_subscriptions (
  id          uuid primary key default app.uuid_v7(),
  user_id     uuid not null references crm.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 800),
  p256dh      text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth        text not null check (auth ~ '^[A-Za-z0-9_-]{16,30}$'),
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on crm.push_subscriptions (user_id);
alter table crm.push_subscriptions enable row level security;
alter table crm.push_subscriptions force row level security;
grant select, insert, update, delete on crm.push_subscriptions to contigo_app;
create policy push_subscriptions_own on crm.push_subscriptions for all to contigo_app
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
-- Mandar un aviso a otra persona: solo por estas funciones (el aviso lo origina alguien distinto del dueño de la suscripción).
create or replace function app.push_targets(p_user uuid) returns table (id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select s.id, s.endpoint, s.p256dh, s.auth from crm.push_subscriptions s
   where s.user_id = p_user and app.current_user_id() is not null order by s.created_at desc limit 10
$$;
create or replace function app.push_forget(p_id uuid) returns void
language sql volatile security definer set search_path = crm, app, pg_catalog as $$
  delete from crm.push_subscriptions where id = p_id and app.current_user_id() is not null
$$;
revoke execute on function app.push_targets(uuid) from public;
revoke execute on function app.push_forget(uuid) from public;
grant execute on function app.push_targets(uuid) to contigo_app;
grant execute on function app.push_forget(uuid) to contigo_app;

-- ============================================================ 5) ACT-03: buzones con captura encendida (cada persona decide la suya)
create table crm.capture_mailboxes (
  user_id     uuid primary key references crm.users(id) on delete cascade,
  gmail       boolean not null default false,
  calendar    boolean not null default false,
  last_pull   timestamptz,
  updated_at  timestamptz not null default now()
);
alter table crm.capture_mailboxes enable row level security;
alter table crm.capture_mailboxes force row level security;
grant select, insert, update on crm.capture_mailboxes to contigo_app;
create policy capture_mailboxes_own on crm.capture_mailboxes for all to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.current_user_id()) = (select app.system_user_id()))
  with check (user_id = (select app.current_user_id()) or (select app.current_user_id()) = (select app.system_user_id()));
-- La tarea de captura (identidad de sistema) lee los buzones encendidos de personas activas.
create or replace function app.capture_owners() returns table (user_id uuid, email text, gmail boolean, calendar boolean, last_pull timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select m.user_id, lower(u.email::text), m.gmail, m.calendar, m.last_pull from crm.capture_mailboxes m join crm.users u on u.id = m.user_id
   where u.is_active and not u.is_system and (m.gmail or m.calendar) and app.current_user_id() = app.system_user_id()
$$;
revoke execute on function app.capture_owners() from public;
grant execute on function app.capture_owners() to contigo_app;

-- ============================================================ 6) SEG-03: copia de la bitácora encendida (lotes en cola, contenido y marca de salida)
create or replace function app.audit_archive_queue() returns table (id bigint, log_name text, from_id bigint, to_id bigint, sha256 text)
language plpgsql stable security definer set search_path = crm, app, audit, pg_catalog as $$
begin
  if app.current_user_id() is null or not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select b.id, b.log_name, b.from_id, b.to_id, b.sha256 from audit.archive_batches b where b.status = 'channel_off' order by b.id limit 20;
end $$;
create or replace function app.audit_archive_content(p_batch bigint) returns text
language plpgsql stable security definer set search_path = crm, app, audit, pg_catalog as $$
declare b record; v text;
begin
  if app.current_user_id() is null or not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from audit.archive_batches where id = p_batch;
  if not found then raise exception 'unknown batch' using errcode = '22023'; end if;
  execute format('select coalesce(string_agg(row_to_json(l)::text, E''\n'' order by l.id), '''') from audit.%I l where l.id between $1 and $2', b.log_name) into v using b.from_id, b.to_id;
  return v;
end $$;
create or replace function app.audit_archive_sent(p_batch bigint, p_ref text, p_sha text) returns void
language plpgsql volatile security definer set search_path = crm, app, audit, pg_catalog as $$
begin
  if app.current_user_id() is null or not (app.has_area('audit') or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  update audit.archive_batches set status = 'sent', sent_at = now(), ref = p_ref, file_sha256 = p_sha where id = p_batch and status = 'channel_off';
end $$;
revoke execute on function app.audit_archive_queue() from public;
revoke execute on function app.audit_archive_content(bigint) from public;
revoke execute on function app.audit_archive_sent(bigint, text, text) from public;
grant execute on function app.audit_archive_queue() to contigo_app;
grant execute on function app.audit_archive_content(bigint) to contigo_app;
grant execute on function app.audit_archive_sent(bigint, text, text) to contigo_app;

-- ============================================================ 7) SEG-02: rotación de la llave del cifrado de campos (solo la tarea de sistema)
create or replace function app.sensitive_rotation_batch(p_active text, p_limit int) returns table (account_id uuid, field_key text, value text, cipher text)
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
begin
  if app.current_user_id() is distinct from app.system_user_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select s.account_id, s.field_key, s.value, s.cipher from crm.account_sensitive s where s.cipher is distinct from p_active and s.cipher <> 'sim-b64'
    order by s.updated_at limit least(greatest(p_limit, 1), 500);
end $$;
create or replace function app.sensitive_rotate(p_account uuid, p_key text, p_old text, p_value text, p_cipher text) returns boolean
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  update crm.account_sensitive set value = p_value, cipher = p_cipher where account_id = p_account and field_key = p_key and cipher = p_old;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function app.sensitive_rotation_batch(text, int) from public;
revoke execute on function app.sensitive_rotate(uuid, text, text, text, text) from public;
grant execute on function app.sensitive_rotation_batch(text, int) to contigo_app;
grant execute on function app.sensitive_rotate(uuid, text, text, text, text) to contigo_app;

-- Tablas nuevas sin trigger de bitácora, con su motivo (la prueba de cobertura de la bitácora las busca aquí).
insert into audit.excluded_tables (table_name, reason) values
  ('connector_tests', 'Es en sí el registro de cada prueba de conexión; además deja evento connector.tested.'),
  ('connector_files', 'Registro técnico de archivos ya cargados; lo que la carga cambia deja su propio rastro.'),
  ('push_subscriptions', 'Datos técnicos del navegador de cada persona; activar y apagar deja evento push.subscribed y push.unsubscribed.'),
  ('capture_mailboxes', 'Preferencia de cada persona; el cambio deja evento capture.optin_changed.')
on conflict (table_name) do nothing;

-- Integración ola 7: el resumen semanal de campo2 (CS-08) ya puede salir encendido (live) hacia P&T.
alter table crm.feedback_digests drop constraint if exists feedback_digests_delivery_status_check;
alter table crm.feedback_digests add constraint feedback_digests_delivery_status_check check (delivery_status is null or delivery_status in ('queued_off','simulated','sent','failed'));
