-- 0021_events_api: eventos de dominio publicados, API de lectura, importación y exportación con gobierno,
-- contrato con la Sales App, protección de formularios públicos y marca de texto no confiable (paquete eventos-api).

-- ---------------------------------------------------------------- 1) AUT-02: bandeja de salida y publicador
-- Cada evento lleva la versión de su esquema. La bandeja queda de solo inserción: la entrega se marca en otra tabla.
alter table crm.outbox_events add column version int not null default 1 check (version >= 1);
drop policy outbox_admin_upd on crm.outbox_events;
revoke update on crm.outbox_events from contigo_app;

-- Quién recibe eventos. El secreto para firmar NO se guarda: se deriva de una llave del servidor, del id y de secret_version.
create table crm.event_subscribers (
  id              uuid primary key default app.uuid_v7(),
  name            text not null check (char_length(btrim(name)) between 3 and 80),
  destination     text not null check (destination ~ '^https://[a-z0-9.-]+(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?$' and char_length(destination) <= 300),
  event_types     text[] not null check (cardinality(event_types) between 1 and 80),
  market_code     text references crm.markets(code),
  secret_version  int not null default 1 check (secret_version >= 1),
  status          text not null default 'active' check (status in ('active','paused','removed')),
  created_by      uuid not null references crm.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index event_subscribers_name_idx on crm.event_subscribers (lower(btrim(name))) where status <> 'removed';

-- Una fila por evento y suscriptor. "ready": listo para publicar (todavía no sale, o el canal está apagado).
create table crm.event_deliveries (
  id               uuid primary key default app.uuid_v7(),
  event_id         uuid not null references crm.outbox_events(id),
  subscriber_id    uuid not null references crm.event_subscribers(id),
  status           text not null default 'ready' check (status in ('ready','retrying','delivered','dead')),
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text check (last_error is null or char_length(last_error) <= 300),
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (event_id, subscriber_id)
);
create index event_deliveries_due_idx on crm.event_deliveries (next_attempt_at) where status in ('ready','retrying');
create index event_deliveries_sub_idx on crm.event_deliveries (subscriber_id, status);

do $$
declare t text;
begin
  foreach t in array array['event_subscribers','event_deliveries'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
    execute format('revoke all on crm.%I from contigo_app', t);
    execute format('grant select, insert, update on crm.%I to contigo_app', t);
    execute format('create policy %I on crm.%I for select to contigo_app using ((select app.is_admin()))', t || '_admin_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_upd', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2) AUT-04: llaves de la API y límite de frecuencia
alter table crm.api_clients
  add column market_code     text references crm.markets(code),
  add column mode            text not null default 'live' check (mode in ('live','test')),
  add column rate_per_minute int not null default 120 check (rate_per_minute between 1 and 6000),
  add column last_used_at    timestamptz,
  add column retire_at       timestamptz,
  add column rotated_from    uuid references crm.api_clients(id);

-- Una llave con fecha de retiro deja de valer sola ese día (rotación: dos vigentes a la vez).
create or replace function app.api_client(p_hash text)
returns table (id uuid, name text, scopes text[])
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.name, c.scopes from crm.api_clients c
   where c.key_hash = p_hash and c.revoked_at is null and (c.retire_at is null or c.retire_at > now())
$$;

-- Lo mismo, con lo que necesita la API de lectura; anota el último uso (a lo más una vez por minuto).
create function app.api_key(p_hash text)
returns table (id uuid, name text, scopes text[], market_code text, mode text, rate_per_minute int, created_by uuid)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
begin
  update crm.api_clients c set last_used_at = now()
   where c.key_hash = p_hash and c.revoked_at is null and (c.retire_at is null or c.retire_at > now())
     and (c.last_used_at is null or c.last_used_at < now() - interval '1 minute');
  return query
    select c.id, c.name, c.scopes, c.market_code, c.mode, c.rate_per_minute, c.created_by from crm.api_clients c
     where c.key_hash = p_hash and c.revoked_at is null and (c.retire_at is null or c.retire_at > now());
end $$;

-- Contadores del límite de frecuencia. Nadie los lee ni los escribe directo: solo la función de abajo.
create table crm.rate_counters (
  bucket        text not null check (char_length(bucket) between 3 and 200),
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (bucket, window_start)
);
alter table crm.rate_counters enable row level security;
alter table crm.rate_counters force row level security;   -- AUTHZ-03
revoke all on crm.rate_counters from contigo_app;

-- Ventana deslizante con dos contadores: la ventana actual más la parte de la anterior que todavía pesa.
-- Devuelve si pasa y, si no, cuántos segundos esperar (Retry-After). Cuenta también lo rechazado: insistir no ayuda.
create function app.rate_hit(p_bucket text, p_limit int, p_window_seconds int)
returns table (allowed boolean, retry_after int, used int)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare
  v_now     timestamptz := clock_timestamp();
  v_start   timestamptz;
  v_prev    int;
  v_cur     int;
  v_elapsed numeric;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_elapsed := extract(epoch from (v_now - v_start)) / p_window_seconds;
  select r.hits into v_prev from crm.rate_counters r
   where r.bucket = p_bucket and r.window_start = v_start - make_interval(secs => p_window_seconds);
  insert into crm.rate_counters as r (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = least(r.hits + 1, 1000000)
  returning r.hits into v_cur;
  if coalesce(v_prev, 0) * (1 - v_elapsed) + v_cur > p_limit then
    return query select false, greatest(1, ceil(p_window_seconds * (1 - v_elapsed))::int), v_cur;
  else
    return query select true, 0, v_cur;
  end if;
end $$;

create function app.rate_cleanup() returns int
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare v_n int; v_m int;
begin
  delete from crm.rate_counters where window_start < now() - interval '2 days';
  get diagnostics v_n = row_count;
  delete from crm.form_renders where rendered_at < now() - interval '2 days';
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;

-- ---------------------------------------------------------------- 3) SEG-10: formularios públicos
alter table crm.web_forms
  add column min_fill_seconds int check (min_fill_seconds between 0 and 120),
  add column rate_per_minute  int check (rate_per_minute between 1 and 600);

-- Cada vez que la página del formulario se muestra, queda anotada su llave: un envío que no viene de una página
-- que la app mostró, o que llega demasiado pronto, se rechaza. No guarda nada de la persona.
create table crm.form_renders (
  key          uuid primary key,
  slug         text not null,
  rendered_at  timestamptz not null default now(),
  used_at      timestamptz
);
alter table crm.form_renders enable row level security;
alter table crm.form_renders force row level security;   -- AUTHZ-03
revoke all on crm.form_renders from contigo_app;

create function app.form_render(p_slug text, p_key uuid) returns void
language sql volatile security definer set search_path = crm, app, pg_catalog as $$
  insert into crm.form_renders (key, slug)
  select p_key, f.slug from crm.web_forms f where f.slug = p_slug and f.is_active
  on conflict (key) do nothing
$$;

-- Segundos desde que se mostró la página con esa llave; null si la app nunca la mostró para ese formulario.
create function app.form_render_age(p_slug text, p_key uuid) returns numeric
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select extract(epoch from (clock_timestamp() - r.rendered_at)) from crm.form_renders r
   where r.key = p_key and r.slug = p_slug and r.rendered_at > now() - interval '1 day'
$$;

-- Límites del formulario (los suyos o null para usar los de la app).
create function app.form_limits(p_slug text)
returns table (min_fill_seconds int, rate_per_minute int)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select f.min_fill_seconds, f.rate_per_minute from crm.web_forms f where f.slug = p_slug and f.is_active
$$;

-- Lo rechazado no se guarda: solo se cuenta por formulario, día y motivo, para que administración vea si hay un ataque.
create table crm.intake_rejections (
  slug    text not null,
  day     date not null,
  reason  text not null check (reason in ('rate','too_fast','trap','no_render','bot','api_rate')),
  n       int not null default 0,
  primary key (slug, day, reason)
);
alter table crm.intake_rejections enable row level security;
alter table crm.intake_rejections force row level security;   -- AUTHZ-03
revoke all on crm.intake_rejections from contigo_app;
grant select on crm.intake_rejections to contigo_app;
create policy intake_rejections_admin_read on crm.intake_rejections for select to contigo_app using ((select app.is_admin()));

create function app.intake_rejected(p_slug text, p_reason text) returns void
language sql volatile security definer set search_path = crm, app, pg_catalog as $$
  insert into crm.intake_rejections as r (slug, day, reason, n)
  values (left(p_slug, 60), (now() at time zone 'UTC')::date, p_reason, 1)
  on conflict (slug, day, reason) do update set n = r.n + 1
$$;

-- ---------------------------------------------------------------- 4) CAMPO-01: mensajes muertos y reproceso
alter table crm.inbound_events drop constraint inbound_events_status_check;
alter table crm.inbound_events add constraint inbound_events_status_check check (status in ('received','processed','rejected','dead'));
alter table crm.inbound_events
  add column attempts     int not null default 0,
  add column replayed_at  timestamptz,
  add column replayed_by  uuid references crm.users(id);
create index inbound_events_dead_idx on crm.inbound_events (received_at desc) where status in ('rejected','dead');

-- ---------------------------------------------------------------- 5) AUT-07: importación por archivo y exportaciones
create function app.can_import(p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.is_admin() or exists (select 1 from app.active_memberships() m where m.market_code = p_market and m.role = 'market_lead')
$$;

-- El archivo no se guarda: de cada importación queda quién, cuándo, cuántas filas y qué pasó con cada una.
create table crm.csv_imports (
  id              uuid primary key default app.uuid_v7(),
  market_code     text not null references crm.markets(code),
  kind            text not null check (kind in ('accounts','contacts','leads')),
  file_name       text not null check (char_length(file_name) between 1 and 160),
  checksum        text not null check (checksum ~ '^[0-9a-f]{64}$'),
  rows_total      int not null default 0,
  rows_created    int not null default 0,
  rows_duplicate  int not null default 0,
  rows_rejected   int not null default 0,
  status          text not null default 'running' check (status in ('running','done','undone')),
  created_by      uuid not null references crm.users(id),
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  undone_at       timestamptz,
  undone_by       uuid references crm.users(id)
);
create index csv_imports_market_idx on crm.csv_imports (market_code, created_at desc);

create table crm.csv_import_rows (
  import_id  uuid not null references crm.csv_imports(id),
  row_no     int not null check (row_no >= 1),
  outcome    text not null check (outcome in ('created','duplicate','rejected','undone','kept')),
  object     text check (object in ('account','contact','lead')),
  object_id  uuid,
  detail     text check (detail is null or char_length(detail) <= 300),
  primary key (import_id, row_no)
);

alter table crm.csv_imports enable row level security;
alter table crm.csv_imports force row level security;   -- AUTHZ-03
revoke all on crm.csv_imports from contigo_app;
grant select, insert on crm.csv_imports to contigo_app;
grant update (rows_total, rows_created, rows_duplicate, rows_rejected, status, finished_at, undone_at, undone_by) on crm.csv_imports to contigo_app;
create policy csv_imports_read on crm.csv_imports for select to contigo_app using ((select app.can_import(market_code)));
create policy csv_imports_ins on crm.csv_imports for insert to contigo_app
  with check ((select app.can_import(market_code)) and created_by = (select app.current_user_id()));
create policy csv_imports_upd on crm.csv_imports for update to contigo_app
  using ((select app.can_import(market_code))) with check ((select app.can_import(market_code)));

alter table crm.csv_import_rows enable row level security;
alter table crm.csv_import_rows force row level security;   -- AUTHZ-03
revoke all on crm.csv_import_rows from contigo_app;
grant select, insert on crm.csv_import_rows to contigo_app;
grant update (outcome, detail) on crm.csv_import_rows to contigo_app;
create policy csv_import_rows_read on crm.csv_import_rows for select to contigo_app
  using (exists (select 1 from crm.csv_imports i where i.id = import_id and (select app.can_import(i.market_code))));
create policy csv_import_rows_ins on crm.csv_import_rows for insert to contigo_app
  with check (exists (select 1 from crm.csv_imports i where i.id = import_id and (select app.can_import(i.market_code))));
create policy csv_import_rows_upd on crm.csv_import_rows for update to contigo_app
  using (exists (select 1 from crm.csv_imports i where i.id = import_id and (select app.can_import(i.market_code))))
  with check (exists (select 1 from crm.csv_imports i where i.id = import_id and (select app.can_import(i.market_code))));

-- Deshacer una importación: lo que nadie tocó después se retira (el comercio se archiva, el lead se borra, el contacto se
-- desliga); lo que ya se trabajó se queda y se dice. Devuelve cuántas filas se deshicieron y cuántas se quedaron.
create function app.csv_import_undo(p_import uuid)
returns table (undone int, kept int)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare
  v_imp   crm.csv_imports%rowtype;
  r       record;
  v_undo  int := 0;
  v_keep  int := 0;
  v_ok    boolean;
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
        if exists (select 1 from crm.leads l where l.id = r.object_id and l.status = 'new')
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

-- Cada exportación: quién, qué, por qué, cuántas filas y con qué filtros. `alert` marca la que pasó el umbral diario.
create table crm.export_log (
  id           uuid primary key default app.uuid_v7(),
  user_id      uuid not null references crm.users(id),
  market_code  text references crm.markets(code),
  what         text not null check (what in ('closed_deals','field_stores','field_visits','accounts','leads')),
  reason       text not null check (char_length(btrim(reason)) between 8 and 300),
  rows         int not null check (rows >= 0),
  row_cap      int not null,
  truncated    boolean not null default false,
  filters      jsonb not null default '{}'::jsonb,
  alert        boolean not null default false,
  created_at   timestamptz not null default now()
);
create index export_log_user_idx on crm.export_log (user_id, created_at desc);
alter table crm.export_log enable row level security;
alter table crm.export_log force row level security;   -- AUTHZ-03
revoke all on crm.export_log from contigo_app;
grant select, insert on crm.export_log to contigo_app;
create policy export_log_read on crm.export_log for select to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.is_global()));
create policy export_log_ins on crm.export_log for insert to contigo_app
  with check (user_id = (select app.current_user_id()));

-- ---------------------------------------------------------------- 6) IA-07: texto que llega de fuera
-- Todo campo de texto libre es no confiable: lo puede haber escrito alguien de fuera. Ninguna función lo interpreta.
-- La marca se calcula sola: un campo de texto libre nace y queda marcado, también los que se creen después.
alter table crm.field_definitions add column untrusted boolean generated always as (data_type = 'text') stored;

-- Marca por registro: de dónde llegó el texto y en qué campos. Se muestra como texto plano, con su origen a la vista.
create table crm.untrusted_marks (
  object       text not null check (object in ('lead','account','contact','activity','visit')),
  object_id    uuid not null,
  market_code  text not null references crm.markets(code),
  origin       text not null check (origin in ('web_form','api_form','sales_app','csv_import')),
  fields       text[] not null check (cardinality(fields) >= 1),
  created_at   timestamptz not null default now(),
  primary key (object, object_id)
);
alter table crm.untrusted_marks enable row level security;
alter table crm.untrusted_marks force row level security;   -- AUTHZ-03
revoke all on crm.untrusted_marks from contigo_app;
grant select, insert on crm.untrusted_marks to contigo_app;
create policy untrusted_marks_read on crm.untrusted_marks for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]));
create policy untrusted_marks_ins on crm.untrusted_marks for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));

revoke execute on function app.api_key(text), app.rate_hit(text, int, int), app.rate_cleanup(), app.form_render(text, uuid),
  app.form_render_age(text, uuid), app.form_limits(text), app.intake_rejected(text, text), app.can_import(text), app.csv_import_undo(uuid) from public;
grant execute on function app.api_key(text), app.rate_hit(text, int, int), app.rate_cleanup(), app.form_render(text, uuid),
  app.form_render_age(text, uuid), app.form_limits(text), app.intake_rejected(text, text), app.can_import(text), app.csv_import_undo(uuid) to contigo_app;
