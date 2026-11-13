-- 0040_datos2: residuos del paquete datos (ola 6).
-- DAT-02 teléfono único por mercado en contactos: limpieza de duplicados con fusión sugerida, cola, fusión con foto y deshacer.
-- Decisiones de negocio configurables con dueño (valor propuesto y pendiente de quién lo decide), listadas en Estado de CONTIGO.

-- ================================================================ DAT-02 contactos: un teléfono, una persona
alter table crm.contacts
  add column merged_into  uuid references crm.contacts(id),
  add column archived_at  timestamptz,
  -- Teléfono en espera: el de un contacto que repetía el de otro. Queda guardado (no se pierde) hasta que una persona decide el par.
  add column held_phone   text check (held_phone is null or held_phone ~ '^\+[1-9][0-9]{6,14}$');

-- Pares de contactos que parecen la misma persona. Nada se fusiona solo: una persona decide cada par.
create table crm.contact_pairs (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  a_id          uuid not null references crm.contacts(id),
  b_id          uuid not null references crm.contacts(id),
  match_kind    text not null default 'phone' check (match_kind in ('phone')),
  -- El que se sugiere conservar: el más antiguo, que es el que se quedó con el teléfono.
  suggested_keep uuid not null references crm.contacts(id),
  source        text not null check (source in ('cleanup','lead','form','pipedrive','sales_app','manual')),
  status        text not null default 'open' check (status in ('open','merged','dismissed')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  decided_by    uuid references crm.users(id),
  decided_at    timestamptz,
  detected_at   timestamptz not null default now(),
  check (a_id < b_id),
  check (suggested_keep in (a_id, b_id)),
  unique (a_id, b_id)
);
create index contact_pairs_open_idx on crm.contact_pairs (market_code, detected_at) where status = 'open';

-- Fusión de contactos: foto previa y lo que se movió, para deshacer.
create table crm.contact_merge_events (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  source_id     uuid not null references crm.contacts(id),
  target_id     uuid not null references crm.contacts(id),
  snapshot      jsonb not null,
  moved         jsonb not null,
  merged_by     uuid not null references crm.users(id),
  merged_at     timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     uuid references crm.users(id),
  undo_reason   text
);
create index contact_merge_events_idx on crm.contact_merge_events (market_code, merged_at desc);

do $$
declare t text;
begin
  foreach t in array array['contact_pairs','contact_merge_events'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
    execute format('revoke all on crm.%I from contigo_app', t);
    execute format('grant select, insert, update on crm.%I to contigo_app', t);
    execute format('create policy %I on crm.%I for select to contigo_app using (market_code = any((select app.my_markets())::text[]))', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check (market_code = any((select app.write_markets())::text[]))', t || '_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using (market_code = any((select app.write_markets())::text[])) with check (market_code = any((select app.write_markets())::text[]))', t || '_upd', t);
  end loop;
end $$;

-- Encola un par (si no estaba decidido ya). Lo usan la limpieza, la conversión de leads, los formularios y la carga de Pipedrive.
create or replace function app.contact_pair_queue(p_market text, p_keep uuid, p_other uuid, p_source text) returns void
language sql volatile security definer set search_path = crm, app, pg_catalog as $$
  insert into crm.contact_pairs (market_code, a_id, b_id, suggested_keep, source)
  select p_market, least(p_keep, p_other), greatest(p_keep, p_other), p_keep, p_source
   where p_keep <> p_other
  on conflict (a_id, b_id) do nothing
$$;
revoke execute on function app.contact_pair_queue(text, uuid, uuid, text) from public;
grant execute on function app.contact_pair_queue(text, uuid, uuid, text) to contigo_app;

-- Limpieza: en cada grupo de contactos del mismo mercado con el mismo teléfono, el más antiguo conserva el teléfono; los demás
-- lo pasan a "en espera" y quedan en la cola con la fusión sugerida hacia el más antiguo. No borra ni fusiona nada.
create or replace function app.contact_phone_cleanup() returns int
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare n int := 0; r record;
begin
  for r in
    select c.id, c.market_code, c.phone,
           first_value(c.id) over (partition by c.market_code, c.phone order by c.created_at, c.id) as keep_id
      from crm.contacts c
     where c.phone is not null and c.archived_at is null
  loop
    continue when r.id = r.keep_id;
    update crm.contacts set held_phone = phone, phone = null where id = r.id;
    perform app.contact_pair_queue(r.market_code, r.keep_id, r.id, 'cleanup');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.contact_phone_cleanup() from public;

select app.contact_phone_cleanup();
drop index if exists crm.contacts_phone_idx;
create unique index contacts_phone_uq on crm.contacts (market_code, phone) where phone is not null;

-- Busca, para una lista de teléfonos de un mercado, el contacto que ya los tiene. Mira todo el mercado aunque quien carga no vea
-- esos contactos (la carga de Pipedrive corre como usuario de sistema); devuelve lo mínimo.
create or replace function app.contacts_by_phones(p_market text, p_phones text[])
returns table (id uuid, phone text, full_name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.phone, c.full_name from crm.contacts c
   where (p_market = any(app.my_markets()) or app.current_user_id() = app.system_user_id())
     and c.market_code = p_market and c.phone = any(p_phones)
$$;
grant execute on function app.contacts_by_phones(text, text[]) to contigo_app;

-- Un contacto fusionado no vuelve a aparecer en la búsqueda por teléfono.
create or replace function app.contact_by_phone(p_market text, p_phone text)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.full_name from crm.contacts c
   where p_market = any(app.my_markets()) and c.market_code = p_market and p_phone is not null and c.phone = p_phone and c.archived_at is null
   order by c.created_at limit 1
$$;

-- Quien cuida los datos del mercado (administración, quien lidera, Operaciones) ve y corrige todos los contactos del mercado,
-- también los que no cuelgan de una cuenta (personas de Pipedrive sin organización, contactos en espera): si no, no se pueden fusionar.
create policy contacts_steward_read on crm.contacts for select to contigo_app using (market_code = any((select app.steward_markets())::text[]));
create policy contacts_steward_upd on crm.contacts for update to contigo_app
  using (market_code = any((select app.steward_markets())::text[])) with check (market_code = any((select app.steward_markets())::text[]));

-- Lo mínimo de un contacto para comparar un par en la cola, aunque quien revisa no vea sus cuentas.
create or replace function app.contact_brief(p_id uuid)
returns table (id uuid, full_name text, phone text, held_phone text, email citext, created_at timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.full_name, c.phone, c.held_phone, c.email, c.created_at from crm.contacts c
   where c.id = p_id and c.market_code = any(app.my_markets())
$$;
grant execute on function app.contact_brief(uuid) to contigo_app;

-- ================================================================ decisiones de negocio con dueño
-- Un valor que decide otra persona (metas, reglas, plazos): se construye con un valor propuesto conservador, se guarda como dato y
-- se ve en pantalla como "Valor propuesto, pendiente de <dueño>". `proposed` pasa a falso cuando la persona dueña lo confirma.
create table crm.decision_settings (
  id           uuid primary key default app.uuid_v7(),
  key          text not null check (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  market_code  text references crm.markets(code),
  value        jsonb not null,
  proposed     boolean not null default true,
  owner_label  text not null check (char_length(btrim(owner_label)) between 2 and 120),
  note         text check (note is null or char_length(note) <= 300),
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now()
);
create unique index decision_settings_key_uq on crm.decision_settings (key, coalesce(market_code, '*'));
alter table crm.decision_settings enable row level security;
alter table crm.decision_settings force row level security;   -- AUTHZ-03
revoke all on crm.decision_settings from contigo_app;
grant select, insert, update on crm.decision_settings to contigo_app;
create policy decision_settings_read on crm.decision_settings for select to contigo_app using ((select app.current_user_id()) is not null);
create policy decision_settings_ins on crm.decision_settings for insert to contigo_app with check ((select app.is_admin()));
create policy decision_settings_upd on crm.decision_settings for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- ================================================================ DAT-04 llaves: identificador fiscal y ubicación
-- Geohash de una coordenada (celda de unos 38 x 19 metros con 8 caracteres). Sin coordenadas, no hay llave.
create or replace function app.geohash(p_lat numeric, p_lon numeric, p_len int default 8) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  b32 constant text := '0123456789bcdefghjkmnpqrstuvwxyz';
  la0 float8 := -90; la1 float8 := 90; lo0 float8 := -180; lo1 float8 := 180;
  nbit int := 0; ch int := 0; even boolean := true; res text := ''; mid float8;
begin
  if p_lat is null or p_lon is null then return null; end if;
  while length(res) < p_len loop
    if even then
      mid := (lo0 + lo1) / 2;
      if p_lon::float8 >= mid then ch := ch * 2 + 1; lo0 := mid; else ch := ch * 2; lo1 := mid; end if;
    else
      mid := (la0 + la1) / 2;
      if p_lat::float8 >= mid then ch := ch * 2 + 1; la0 := mid; else ch := ch * 2; la1 := mid; end if;
    end if;
    even := not even; nbit := nbit + 1;
    if nbit = 5 then res := res || substr(b32, ch + 1, 1); nbit := 0; ch := 0; end if;
  end loop;
  return res;
end $$;
grant execute on function app.geohash(numeric, numeric, int) to contigo_app;

-- Pares de comercios que parecen el mismo, con todas las llaves: teléfono, correo, nombre y dirección, identificador fiscal
-- (por su huella), misma celda de ubicación con nombre parecido, y nombre parecido en la misma ciudad. Con p_ids, solo los
-- pares de esas cuentas contra el resto (alta por conversión de lead o por carga); sin p_ids, todo el mercado.
create or replace function app.account_pairs_for(p_market text, p_ids uuid[])
returns table (market_code text, a_id uuid, b_id uuid, kinds text[], sim real)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with live as (
    select id, market_code, name_norm, phone, email, locality, app.addr_key(address_line, locality) as addr,
           tax_id_blind_ix as tax, app.geohash(latitude, longitude, 8) as geo
      from crm.accounts where archived_at is null and (p_market is null or market_code = p_market)
  ), found as (
    select a.market_code, least(a.id, b.id) as a_id, greatest(a.id, b.id) as b_id,
           array_remove(array[
             case when a.phone is not null and a.phone = b.phone then 'phone' end,
             case when a.email is not null and a.email = b.email then 'email' end,
             case when a.addr is not null and a.addr = b.addr and a.name_norm = b.name_norm then 'name_address' end,
             case when a.tax is not null and a.tax = b.tax then 'tax_id' end,
             case when a.geo is not null and a.geo = b.geo and similarity(a.name_norm, b.name_norm) > 0.45 then 'geo' end,
             case when similarity(a.name_norm, b.name_norm) > 0.62 then 'name' end], null) as kinds,
           similarity(a.name_norm, b.name_norm) as sim
      from live a join live b on b.market_code = a.market_code and a.id <> b.id
       and ((p_ids is null and a.id < b.id) or (p_ids is not null and a.id = any(p_ids) and (not (b.id = any(p_ids)) or a.id < b.id)))
       and ((a.phone is not null and a.phone = b.phone)
            or (a.email is not null and a.email = b.email)
            or (a.addr is not null and a.addr = b.addr and a.name_norm = b.name_norm)
            or (a.tax is not null and a.tax = b.tax)
            or (a.geo is not null and a.geo = b.geo)
            or (length(a.name_norm) >= 4 and a.name_norm % b.name_norm and similarity(a.name_norm, b.name_norm) > 0.62
                and app.norm(a.locality) = app.norm(b.locality)))
  )
  select market_code, a_id, b_id, kinds, sim from found where cardinality(kinds) > 0
$$;
revoke execute on function app.account_pairs_for(text, uuid[]) from public;

create or replace function app.scan_duplicates(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, public, extensions, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is not null and app.current_user_id() is distinct from app.system_user_id()
     and not (app.is_admin() or (p_market is not null and p_market = any(app.lead_markets()))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with ins as (
    insert into crm.duplicate_pairs (market_code, a_id, b_id, match_kinds, strong, score)
    select f.market_code, f.a_id, f.b_id, f.kinds, f.kinds && array['phone','email','name_address','tax_id','geo'], round(f.sim::numeric, 3)
      from app.account_pairs_for(p_market, null) f
    on conflict (a_id, b_id) do update set match_kinds = excluded.match_kinds, strong = excluded.strong, score = excluded.score
      where crm.duplicate_pairs.status = 'open'
    returning 1
  )
  select count(*) into n from ins;
  update crm.duplicate_pairs p set status = 'dismissed', decision_note = 'archived', decided_at = now()
   where p.status = 'open' and exists (select 1 from crm.accounts a where a.id in (p.a_id, p.b_id) and a.archived_at is not null);
  return n;
end $$;

-- Al nacer un comercio por conversión de lead, por carga de Pipedrive o al capturar su identificador fiscal, sus pares entran a
-- la cola en ese momento (no esperan la búsqueda de la noche). No bloquea ni fusiona: una persona decide.
create or replace function app.queue_account_matches(p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = crm, app, public, extensions, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  with ins as (
    insert into crm.duplicate_pairs (market_code, a_id, b_id, match_kinds, strong, score)
    select f.market_code, f.a_id, f.b_id, f.kinds, f.kinds && array['phone','email','name_address','tax_id','geo'], round(f.sim::numeric, 3)
      from app.account_pairs_for(null, p_ids) f
     where f.market_code = any(app.write_markets()) or app.current_user_id() = app.system_user_id()
    on conflict (a_id, b_id) do update set match_kinds = excluded.match_kinds, strong = excluded.strong, score = excluded.score
      where crm.duplicate_pairs.status = 'open'
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;
grant execute on function app.queue_account_matches(uuid[]) to contigo_app;

-- Coincidencias al capturar, ahora también por identificador fiscal (huellas de lo escrito) y por ubicación.
drop function app.duplicate_matches(text, text, text, text, text, text, text, uuid);
create function app.duplicate_matches(p_market text, p_name text, p_phone text, p_email text, p_address text, p_locality text,
                                      p_external_id text default null, p_exclude uuid default null,
                                      p_tax_blinds text[] default null, p_lat numeric default null, p_lon numeric default null)
returns table (id uuid, name text, locality text, owner_name text, lifecycle text, match text, strong boolean)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with m as (
    select a.id, a.name, a.locality, a.owner_id, a.lifecycle,
           case when p_phone is not null and a.phone = p_phone then 'phone'
                when nullif(btrim(p_email), '') is not null and a.email = btrim(p_email)::citext then 'email'
                when p_tax_blinds is not null and a.tax_id_blind_ix = any(p_tax_blinds) then 'tax_id'
                when nullif(btrim(p_external_id), '') is not null and exists (
                       select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and lower(al.external_id) = lower(btrim(p_external_id))) then 'external_id'
                when nullif(btrim(p_external_id), '') is not null and upper(btrim(a.merchant_ref)) = upper(btrim(p_external_id)) then 'external_id'
                when app.addr_key(p_address, p_locality) is not null and a.name_norm = app.norm(p_name)
                     and app.addr_key(a.address_line, a.locality) = app.addr_key(p_address, p_locality) then 'name_address'
                when p_lat is not null and app.geohash(a.latitude, a.longitude, 8) = app.geohash(p_lat, p_lon, 8)
                     and similarity(a.name_norm, app.norm(p_name)) > 0.45 then 'geo'
                when length(app.norm(p_name)) >= 4 and similarity(a.name_norm, app.norm(p_name)) > 0.62 then 'name'
           end as match,
           similarity(a.name_norm, app.norm(p_name)) as sim
      from crm.accounts a
     where p_market = any(app.my_markets()) and a.market_code = p_market and a.archived_at is null
       and (p_exclude is null or a.id <> p_exclude)
  )
  select m.id, m.name, m.locality, u.full_name, m.lifecycle, m.match, m.match <> 'name'
    from m left join crm.users u on u.id = m.owner_id
   where m.match is not null
   order by (m.match <> 'name') desc, m.sim desc
   limit 5
$$;
grant execute on function app.duplicate_matches(text, text, text, text, text, text, text, uuid, text[], numeric, numeric) to contigo_app;

-- ================================================================ DAT-01 agregados a una fecha y comisión por nodo
-- El subárbol de una cuenta en un momento: las aristas vigentes ese día (crm.account_links), no el padre de hoy.
create or replace function app.subtree_at(p_root uuid, p_at timestamptz)
returns table (id uuid)
language sql stable set search_path = crm, app, pg_catalog as $$
  with recursive t(id) as (
    select p_root
    union
    select l.child_id from crm.account_links l join t on l.parent_id = t.id
     where l.valid_from <= p_at and (l.valid_to is null or l.valid_to > p_at)
  )
  select t.id from t
$$;
grant execute on function app.subtree_at(uuid, timestamptz) to contigo_app;

-- Lo que suma un nodo. Sin fecha: hoy (árbol vigente, etapa de vida de hoy). Con fecha: el árbol y las cifras de ese día; la
-- etapa de vida de ese día no se guarda, así que "activos" queda sin dato. Corre con los permisos de quien pregunta (RLS).
create or replace function app.node_totals(p_root uuid, p_day date default null)
returns table (open_deals int, open_amount text, won_deals int, active int, accounts int, txn_30d int, currency text, commission_30d text, as_of text)
language sql stable set search_path = crm, app, pg_catalog as $$
  with cut as (
    select case when p_day is null then now() else ((p_day + 1)::timestamp at time zone coalesce(
             (select mk.timezone from crm.accounts r join crm.markets mk on mk.code = r.market_code where r.id = p_root), 'UTC')) end as at
  ), node as (
    select d.id, d.lifecycle, d.market_code from crm.accounts d
     where d.archived_at is null and d.created_at <= (select at from cut)
       and (case when p_day is null then (d.id = p_root or d.ancestor_ids @> array[p_root]::uuid[])
                 else d.id in (select s.id from app.subtree_at(p_root, (select at from cut)) s) end)
  ), dl as (
    select x.* from crm.deals x where x.account_id in (select id from node) and x.created_at <= (select at from cut)
  ), mday as (
    select max(as_of) as d from crm.merchant_metrics_daily where as_of <= coalesce(p_day, as_of)
  ), cday as (
    select c.account_id, c.commission_minor_30d,
           row_number() over (partition by c.account_id order by c.as_of desc) as rn
      from crm.care_signals c where c.account_id in (select id from node) and c.as_of <= coalesce(p_day, c.as_of) and c.commission_minor_30d is not null
  )
  select (select count(*)::int from dl where (p_day is null and dl.status = 'open')
                                          or (p_day is not null and (dl.won_at is null or dl.won_at > (select at from cut)) and (dl.lost_at is null or dl.lost_at > (select at from cut)))),
         (select sum(dl.amount_minor)::text from dl where (p_day is null and dl.status = 'open')
                                          or (p_day is not null and (dl.won_at is null or dl.won_at > (select at from cut)) and (dl.lost_at is null or dl.lost_at > (select at from cut)))),
         (select count(*)::int from dl where dl.status = 'won' and (p_day is null or dl.won_at <= (select at from cut))),
         case when p_day is null then (select count(*)::int from node where lifecycle = 'active') end,
         (select count(*)::int from node),
         coalesce((select sum(m.txn_count_30d)::int from crm.merchant_metrics_daily m where m.account_id in (select id from node) and m.as_of = (select d from mday)), 0),
         (select mk.currency::text from crm.markets mk where mk.code = (select market_code from crm.accounts where id = p_root)),
         (select sum(commission_minor_30d)::text from cday where rn = 1),
         p_day::text
$$;
grant execute on function app.node_totals(uuid, date) to contigo_app;

-- ================================================================ DAT-05 reglas de valor, campos de contacto y actividad, paso a columna, plazo medido
-- Reglas del valor de un campo, con las palabras de JSON Schema (minimum, maximum, minLength, maxLength, pattern). El dominio
-- las aplica al guardar; un valor que no cumple no entra.
alter table crm.field_definitions add column value_schema jsonb not null default '{}'::jsonb
  check (jsonb_typeof(value_schema) = 'object' and value_schema - array['minimum','maximum','minLength','maxLength','pattern'] = '{}'::jsonb);

-- El plazo para decidir un campo propuesto vive ahora en Decisiones de negocio (field.approval_sla_days), en un solo lugar.
insert into crm.decision_settings (key, value, proposed, owner_label)
select 'field.approval_sla_days', to_jsonb((value #>> '{}')), true, 'Dan Mulligan o Michael Essiet'
  from crm.settings where key = 'field_approval_sla_days' and (value #>> '{}') in ('2','3','5');
delete from crm.settings where key = 'field_approval_sla_days';

-- Pedido de pasar un campo a columna real (porque entra a un filtro, a RLS o a una métrica). CONTIGO arma el cambio; lo aplica
-- una migración revisada (revisión técnica), no la pantalla. Cuando la columna existe, el pedido se marca hecho solo.
create table crm.field_promotions (
  id            uuid primary key default app.uuid_v7(),
  field_id      uuid not null references crm.field_definitions(id),
  market_code   text references crm.markets(code),
  reason        text not null check (char_length(btrim(reason)) between 10 and 400),
  column_name   text not null check (column_name ~ '^[a-z][a-z0-9_]{1,40}$'),
  migration_sql text not null,
  status        text not null default 'requested' check (status in ('requested','done','rejected')),
  requested_by  uuid not null references crm.users(id),
  requested_at  timestamptz not null default now(),
  closed_by     uuid references crm.users(id),
  closed_at     timestamptz,
  close_note    text
);
create unique index field_promotions_open_uq on crm.field_promotions (field_id) where status = 'requested';
alter table crm.field_promotions enable row level security;
alter table crm.field_promotions force row level security;   -- AUTHZ-03
revoke all on crm.field_promotions from contigo_app;
grant select, insert, update on crm.field_promotions to contigo_app;
create policy field_promotions_read on crm.field_promotions for select to contigo_app using ((select app.current_user_id()) is not null);
create policy field_promotions_ins on crm.field_promotions for insert to contigo_app
  with check ((select app.is_admin()) or market_code = any((select app.lead_markets())::text[]));
create policy field_promotions_upd on crm.field_promotions for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- ¿Ya existe la columna? Para cerrar solo el pedido cuando la migración se aplicó.
create or replace function app.column_exists(p_table text, p_column text) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from information_schema.columns where table_schema = 'crm' and table_name = p_table and column_name = p_column)
$$;
grant execute on function app.column_exists(text, text) to contigo_app;

-- ================================================================ MULTI-02 entidad en contratos y leads, hora de la cuenta en los relojes
-- El contrato lleva entidad legal, obligatoria; por defecto, la del comercio. Debe ser del mercado del contrato.
alter table crm.contracts add column legal_entity_id uuid references crm.legal_entities(id);
update crm.contracts c set legal_entity_id = coalesce(a.legal_entity_id, app.default_entity(c.market_code)) from crm.accounts a where a.id = c.account_id;
alter table crm.contracts alter column legal_entity_id set not null;
create or replace function crm.contract_entity_before() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
begin
  if new.legal_entity_id is null then
    new.legal_entity_id := coalesce((select a.legal_entity_id from crm.accounts a where a.id = new.account_id), app.default_entity(new.market_code));
  end if;
  if not exists (select 1 from crm.legal_entities e where e.id = new.legal_entity_id and e.market_code = new.market_code) then
    raise exception 'legal entity does not belong to the market' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger contracts_entity_before before insert or update of legal_entity_id, market_code on crm.contracts
  for each row execute function crm.contract_entity_before();

-- El lead también: entidad del mercado por defecto (la de la persona si su acceso está limitado a una entidad).
alter table crm.leads add column legal_entity_id uuid references crm.legal_entities(id);
update crm.leads l set legal_entity_id = coalesce((select a.legal_entity_id from crm.accounts a where a.id = l.account_id), app.default_entity(l.market_code));
alter table crm.leads alter column legal_entity_id set not null;
create or replace function crm.lead_entity_before() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
begin
  if new.legal_entity_id is null then
    new.legal_entity_id := coalesce((select a.legal_entity_id from crm.accounts a where a.id = coalesce(new.account_id, new.duplicate_of)), app.default_entity(new.market_code));
  end if;
  return new;
end $$;
create trigger leads_entity_before before insert on crm.leads for each row execute function crm.lead_entity_before();

-- Retirar una entidad (por ejemplo, la provisional cuando Legal confirma la lista) no deja leads ni contratos sin entidad: pasan a
-- la de por defecto del mercado. Si el mercado no tiene otra, la base no deja borrarla.
create or replace function crm.legal_entity_release() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
declare v uuid;
begin
  select e.id into v from crm.legal_entities e where e.market_code = old.market_code and e.id <> old.id and e.archived_at is null
   order by e.is_default desc, e.created_at, e.id limit 1;
  update crm.leads set legal_entity_id = v where legal_entity_id = old.id;
  update crm.contracts set legal_entity_id = v where legal_entity_id = old.id;
  return old;
end $$;
create trigger legal_entities_release before delete on crm.legal_entities for each row execute function crm.legal_entity_release();

-- Zona horaria del lead (opcional): la manda el formulario o la Sales App si la sabe. Sin ella, la del comercio si el lead ya es
-- de uno; sin comercio, la del mercado.
alter table crm.leads add column timezone text check (timezone is null or char_length(timezone) <= 60);

-- Reloj hábil con la hora de la cuenta: igual que app.business_due, en la zona que se le pasa (vacía = la del mercado).
create or replace function app.business_due(p_market text, p_from timestamptz, p_minutes int, p_tz text)
returns timestamptz
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  loc timestamp; day date; s timestamp; e timestamp;
  remaining numeric := greatest(coalesce(p_minutes, 60), 0);
  avail numeric; i int := 0;
begin
  select m.timezone into tz from crm.markets m where m.code = p_market;
  if p_tz is not null and exists (select 1 from pg_timezone_names z where z.name = p_tz) then tz := p_tz; end if;
  tz := coalesce(tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  loc := p_from at time zone tz;
  day := loc::date;
  while i < 370 loop
    if extract(isodow from day)::int = any(d) then
      s := greatest(loc, day + o);
      e := day + c;
      if s < e then
        avail := extract(epoch from (e - s)) / 60.0;
        if remaining <= avail then
          return (s + make_interval(secs => (remaining * 60)::double precision)) at time zone tz;
        end if;
        remaining := remaining - avail;
      end if;
    end if;
    day := day + 1;
    i := i + 1;
  end loop;
  return p_from + make_interval(mins => coalesce(p_minutes, 60));
end $$;
revoke execute on function app.business_due(text, timestamptz, int, text) from public;
grant execute on function app.business_due(text, timestamptz, int, text) to contigo_app;

-- La zona de un lead: la suya, la del comercio que ya es, o ninguna (el reloj usa la del mercado).
create or replace function app.lead_timezone(p_lead uuid) returns text
language sql stable set search_path = crm, app, pg_catalog as $$
  select coalesce(l.timezone, (select a.timezone from crm.accounts a where a.id = coalesce(l.account_id, l.duplicate_of))) from crm.leads l where l.id = p_lead
$$;
grant execute on function app.lead_timezone(uuid) to contigo_app;

