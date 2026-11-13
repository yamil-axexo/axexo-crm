-- 0032_markets: mercados, moneda, entidad legal, identificador fiscal, direcciones, WhatsApp por mercado y encabezado de la ficha.
-- Catálogo: MULTI-01 a MULTI-05, UX-01, UX-04. Requerimientos: E1.F1, E1.F4, E1.F10, E2.F1, E2.F4, E2.F5.
-- Sin sentencias que borren datos. Recorre crm.accounts y crm.deals una vez para rellenar entidad y tasa.

-- =====================================================================================================
-- 1) MULTI-02 · Entidad legal: cada comercio, negocio y persona pertenece a una
-- =====================================================================================================
alter table crm.legal_entities
  add column short_name     text,
  add column tax_country    char(2),
  add column currency       char(3),
  add column default_locale text check (default_locale is null or default_locale in ('es','en','pt')),
  add column is_default     boolean not null default false,
  add column needs_review   boolean not null default false,   -- creada sola para no dejar comercios sin entidad: Legal y Finanzas confirman el nombre
  add column archived_at    timestamptz;

-- Un mercado sin entidad recibe una provisional con el nombre del mercado, marcada para revisión.
insert into crm.legal_entities (market_code, name, needs_review)
select m.code, m.name, true from crm.markets m
 where not exists (select 1 from crm.legal_entities e where e.market_code = m.code);

update crm.legal_entities e set is_default = true
 where e.id = (select x.id from crm.legal_entities x where x.market_code = e.market_code order by x.created_at, x.id limit 1);
create unique index legal_entities_default_uq on crm.legal_entities (market_code) where is_default and archived_at is null;
create unique index legal_entities_name_uq on crm.legal_entities (market_code, lower(name)) where archived_at is null;

alter table crm.users       add column legal_entity_id uuid references crm.legal_entities(id);
-- Límite por entidad: con una entidad aquí, ese acceso solo alcanza los comercios y negocios de esa entidad (redes adquiridas).
alter table crm.memberships add column legal_entity_id uuid references crm.legal_entities(id);

-- La entidad por defecto de un mercado. Si quien pregunta tiene el acceso limitado a una entidad en ese mercado, es la suya.
-- SECURITY DEFINER: crea la entidad provisional si el mercado no tiene ninguna, aunque quien captura no administre.
create or replace function app.default_entity(p_market text) returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v uuid;
begin
  select m.legal_entity_id into v
    from crm.memberships m
   where m.user_id = app.current_user_id() and m.market_code = p_market and m.legal_entity_id is not null
     and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
     and not exists (select 1 from crm.memberships o
                      where o.user_id = m.user_id and (o.market_code = p_market or o.market_code is null) and o.legal_entity_id is null
                        and o.valid_from <= now() and (o.valid_to is null or o.valid_to > now()))
   order by m.valid_from limit 1;
  if v is not null then return v; end if;
  select id into v from crm.legal_entities where market_code = p_market and is_default and archived_at is null;
  if v is null then
    select id into v from crm.legal_entities where market_code = p_market and archived_at is null order by created_at, id limit 1;
  end if;
  if v is null then
    insert into crm.legal_entities (market_code, name, needs_review, is_default)
    select code, name, true, true from crm.markets where code = p_market
    returning id into v;
  end if;
  return v;
end $$;
revoke execute on function app.default_entity(text) from public;
grant execute on function app.default_entity(text) to contigo_app;

-- Zona horaria por comercio (IANA). Vacía = la del mercado. "Hora de la cuenta, no del usuario."
alter table crm.accounts add column timezone text;
-- E1.F4: unidad de negocio al lado del mercado.
create table crm.business_units (
  code      text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es  text not null,
  label_en  text not null,
  position  int not null default 0,
  is_active boolean not null default true
);
insert into crm.business_units (code, label_es, label_en, position) values
  ('strategic_partnerships', 'Strategic Partnerships', 'Strategic Partnerships', 1),
  ('lla_cwc', 'LLA/CWC', 'LLA/CWC', 2),
  ('internacional', 'Internacional', 'Internacional', 3),
  ('usa', 'USA', 'USA', 4),
  ('mexico', 'Mexico', 'Mexico', 5),
  ('sky_panama', 'Sky Solutions Panama', 'Sky Solutions Panama', 6),
  ('sky_el_salvador', 'Sky Solutions El Salvador', 'Sky Solutions El Salvador', 7),
  ('colombia', 'Colombia', 'Colombia', 8);
alter table crm.accounts add column business_unit text references crm.business_units(code);
alter table crm.deals
  add column legal_entity_id uuid references crm.legal_entities(id),
  add column business_unit   text references crm.business_units(code);

create or replace function crm.account_entity_before() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
begin
  if new.legal_entity_id is null then
    new.legal_entity_id := app.default_entity(new.market_code);
  elsif tg_op = 'UPDATE' and new.market_code is distinct from old.market_code and new.legal_entity_id is not distinct from old.legal_entity_id then
    -- Cambia de mercado sin decir entidad: toma la de por defecto del mercado nuevo. Si el cambio se permite o no lo sigue
    -- decidiendo la política de alcance (quien vende no cambia un comercio de mercado).
    new.legal_entity_id := app.default_entity(new.market_code);
  elsif tg_op = 'INSERT' or new.legal_entity_id is distinct from old.legal_entity_id then
    if not exists (select 1 from crm.legal_entities e where e.id = new.legal_entity_id and e.market_code = new.market_code) then
      raise exception 'legal entity does not belong to the market' using errcode = '23514';
    end if;
  end if;
  if new.timezone is not null and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone) then
    if not exists (select 1 from pg_timezone_names z where z.name = new.timezone) then
      raise exception 'unknown time zone' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger accounts_entity before insert or update of legal_entity_id, market_code, timezone on crm.accounts
  for each row execute function crm.account_entity_before();

-- Los rellenos de esta migración no son un cambio de quien usa la herramienta: no mueven "updated_at".
alter table crm.accounts disable trigger accounts_touch;
alter table crm.deals disable trigger deals_touch;
update crm.accounts a set legal_entity_id = (select e.id from crm.legal_entities e where e.market_code = a.market_code and e.is_default)
 where a.legal_entity_id is null;
alter table crm.accounts alter column legal_entity_id set not null;
create index accounts_entity_idx on crm.accounts (legal_entity_id);

-- El negocio hereda entidad y unidad de negocio de su comercio. Mientras no exista el objeto contrato, el negocio es
-- donde la entidad es obligatoria; el contrato la heredará de aquí.
create or replace function crm.deal_entity_before() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare a record;
begin
  select legal_entity_id, business_unit, market_code into a from crm.accounts where id = new.account_id;
  if new.legal_entity_id is null then new.legal_entity_id := a.legal_entity_id; end if;
  if tg_op = 'INSERT' and new.business_unit is null then new.business_unit := a.business_unit; end if;
  if not exists (select 1 from crm.legal_entities e where e.id = new.legal_entity_id and e.market_code = new.market_code) then
    raise exception 'legal entity does not belong to the market' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger deals_entity before insert or update of legal_entity_id, account_id on crm.deals
  for each row execute function crm.deal_entity_before();

update crm.deals d set legal_entity_id = a.legal_entity_id from crm.accounts a where a.id = d.account_id and d.legal_entity_id is null;
alter table crm.deals alter column legal_entity_id set not null;
create index deals_entity_idx on crm.deals (legal_entity_id);

-- Mercados donde TODOS los accesos vigentes de la persona están limitados a una entidad, y esas entidades.
create or replace function app.entity_limited_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(
    select m.market_code from crm.memberships m
     where m.user_id = app.current_user_id() and m.market_code is not null
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
     group by m.market_code having bool_and(m.legal_entity_id is not null)), '{}')
$$;
create or replace function app.my_entity_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(
    select distinct m.legal_entity_id from crm.memberships m
     where m.user_id = app.current_user_id() and m.legal_entity_id is not null
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())), '{}')
$$;
revoke execute on function app.entity_limited_markets() from public;
revoke execute on function app.my_entity_ids() from public;
grant execute on function app.entity_limited_markets() to contigo_app;
grant execute on function app.my_entity_ids() to contigo_app;

-- Política RESTRICTIVA: se suma a las de alcance. Quien tiene el acceso limitado a una entidad no ve ni cambia lo de otra.
create policy accounts_entity on crm.accounts as restrictive for all to contigo_app using (
  (select app.is_global())
  or not (market_code = any((select app.entity_limited_markets())::text[]))
  or legal_entity_id = any((select app.my_entity_ids())::uuid[])
);
create policy deals_entity on crm.deals as restrictive for all to contigo_app using (
  (select app.is_global())
  or not (market_code = any((select app.entity_limited_markets())::text[]))
  or legal_entity_id = any((select app.my_entity_ids())::uuid[])
);

create or replace function app.account_timezone(p_account uuid) returns text
language sql stable set search_path = crm, app, pg_catalog as $$
  select coalesce(a.timezone, m.timezone) from crm.accounts a join crm.markets m on m.code = a.market_code where a.id = p_account
$$;
grant execute on function app.account_timezone(uuid) to contigo_app;

-- Días festivos por mercado: los carga administración; un próximo paso por defecto no cae en festivo.
create table crm.market_holidays (
  market_code text not null references crm.markets(code),
  day         date not null,
  name        text not null check (length(name) between 2 and 80),
  created_by  uuid references crm.users(id),
  created_at  timestamptz not null default now(),
  primary key (market_code, day)
);
alter table crm.market_holidays enable row level security;
alter table crm.market_holidays force row level security;
grant select, insert, update, delete on crm.market_holidays to contigo_app;
create policy market_holidays_read on crm.market_holidays for select to contigo_app using ((select app.current_user_id()) is not null);
create policy market_holidays_admin_ins on crm.market_holidays for insert to contigo_app with check ((select app.is_admin()));
create policy market_holidays_admin_upd on crm.market_holidays for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
create policy market_holidays_admin_del on crm.market_holidays for delete to contigo_app using ((select app.is_admin()));

alter table crm.business_units enable row level security;
alter table crm.business_units force row level security;
grant select, insert, update on crm.business_units to contigo_app;
create policy business_units_read on crm.business_units for select to contigo_app using ((select app.current_user_id()) is not null);
create policy business_units_admin_ins on crm.business_units for insert to contigo_app with check ((select app.is_admin()));
create policy business_units_admin_upd on crm.business_units for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- =====================================================================================================
-- 2) MULTI-01 · Cada monto guarda la tasa con la que se convirtió, su fecha y su fuente
-- =====================================================================================================
alter table crm.deals
  add column fx_rate          numeric(18,8),
  add column fx_rate_date     date,
  add column fx_source        text,
  add column amount_usd_minor bigint,
  add column fx_frozen_at     timestamptz;     -- al cerrar, la tasa queda congelada

-- La tasa vigente en un día: la de fecha más reciente que no pasa de ese día. USD no se convierte.
create or replace function app.fx_at(p_currency text, p_day date)
returns table (usd_rate numeric, as_of date, source text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select 1::numeric, p_day, 'USD'::text where trim(p_currency) = 'USD'
  union all
  (select f.usd_rate, f.as_of, f.source from crm.fx_rates f
    where trim(p_currency) <> 'USD' and f.currency = trim(p_currency) and f.as_of <= p_day
    order by f.as_of desc limit 1)
$$;
revoke execute on function app.fx_at(text, date) from public;
grant execute on function app.fx_at(text, date) to contigo_app;

create or replace function crm.deal_fx_before() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r record; d date; tz text;
begin
  -- Cerrado y ya sellado: no se vuelve a convertir aunque después se cargue otra tasa.
  if tg_op = 'UPDATE' and old.fx_frozen_at is not null and old.fx_rate is not null and new.status <> 'open' and old.status = new.status
     and new.amount_minor is not distinct from old.amount_minor and new.currency = old.currency then
    new.fx_rate := old.fx_rate; new.fx_rate_date := old.fx_rate_date; new.fx_source := old.fx_source;
    new.amount_usd_minor := old.amount_usd_minor; new.fx_frozen_at := old.fx_frozen_at;
    return new;
  end if;
  select timezone into tz from crm.markets where code = new.market_code;
  d := (coalesce(case new.status when 'won' then new.won_at when 'lost' then new.lost_at end, now()) at time zone coalesce(tz, 'UTC'))::date;
  if new.amount_minor is null then
    new.fx_rate := null; new.fx_rate_date := null; new.fx_source := null; new.amount_usd_minor := null;
  else
    select * into r from app.fx_at(new.currency::text, d);
    if found then
      new.fx_rate := r.usd_rate; new.fx_rate_date := r.as_of; new.fx_source := r.source;
      new.amount_usd_minor := round(new.amount_minor * r.usd_rate);
    else
      new.fx_rate := null; new.fx_rate_date := null; new.fx_source := null; new.amount_usd_minor := null;
    end if;
  end if;
  new.fx_frozen_at := case when new.status = 'open' then null else now() end;
  return new;
end $$;
-- Corre antes que deals_touch (orden alfabético): cualquier cambio de monto, moneda o estado vuelve a sellar.
create trigger deals_fx before insert or update of amount_minor, currency, status, won_at, lost_at on crm.deals
  for each row execute function crm.deal_fx_before();

-- Vuelve a sellar los negocios abiertos con la tasa de hoy y rellena los cerrados que quedaron sin tasa (con la de su
-- fecha de cierre, si ya se cargó). Los cerrados ya sellados no se tocan. Devuelve cuántos cambió.
create or replace function app.fx_restamp() returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  with due as (
    select d.id
      from crm.deals d
      join crm.markets m on m.code = d.market_code
      left join lateral app.fx_at(d.currency::text,
        (coalesce(case d.status when 'won' then d.won_at when 'lost' then d.lost_at end, now()) at time zone m.timezone)::date) r on true
     where d.amount_minor is not null
       and ((d.status = 'open' and (d.fx_rate is distinct from r.usd_rate or d.fx_rate_date is distinct from r.as_of or d.fx_source is distinct from r.source))
            or (d.status <> 'open' and d.fx_rate is null and r.usd_rate is not null))
  )
  update crm.deals d set currency = d.currency from due where due.id = d.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.fx_restamp() from public;
grant execute on function app.fx_restamp() to contigo_app;

-- Relleno histórico: cada negocio queda con la tasa de su fecha (cierre, o hoy si sigue abierto), cuando hay una cargada.
update crm.deals set currency = currency where amount_minor is not null;

-- =====================================================================================================
-- 3) MULTI-03 · Identificador fiscal: últimos 4, huella y estado. El valor completo no se guarda aquí.
-- =====================================================================================================
create table crm.tax_ids (
  id               uuid primary key default app.uuid_v7(),
  account_id       uuid not null references crm.accounts(id),
  market_code      text not null references crm.markets(code),
  country          char(2) not null,
  id_type          text not null check (id_type in ('mx_rfc','us_ein','co_nit','sv_nit','br_cnpj','other')),
  last4            text not null check (last4 ~ '^[A-Z0-9]{1,4}$'),
  blind_ix         text,                                   -- huella con llave del servidor; vacía si el ambiente no tiene la llave
  checksum_ok      boolean,                                -- null: ese tipo no trae dígito verificador
  status           text not null check (status in ('format_valid','needs_review','verified','rejected')),
  registry_status  text not null default 'queued_off' check (registry_status in ('queued_off','sent','match','mismatch','error')),
  legal_name       text,
  tax_regime       text,
  tax_postal_code  text,
  captured_by      uuid references crm.users(id),
  captured_at      timestamptz not null default now(),
  reviewed_by      uuid references crm.users(id),
  reviewed_at      timestamptz,
  review_note      text,
  valid_to         timestamptz
);
create unique index tax_ids_live_uq on crm.tax_ids (account_id) where valid_to is null;
create index tax_ids_blind_idx on crm.tax_ids (blind_ix) where valid_to is null and blind_ix is not null;

-- Cada capa de validación deja su resultado con fecha y fuente.
create table crm.tax_id_verifications (
  id          uuid primary key default app.uuid_v7(),
  tax_id_id   uuid not null references crm.tax_ids(id),
  account_id  uuid not null references crm.accounts(id),
  market_code text not null references crm.markets(code),
  layer       text not null check (layer in ('format','registry','risk_list','human')),
  provider    text not null,
  result      text not null check (result in ('pass','fail','review','queued_off')),
  detail      text,
  actor_id    uuid references crm.users(id),
  at          timestamptz not null default now()
);
create index tax_id_verifications_tax_idx on crm.tax_id_verifications (tax_id_id, at);

do $$
declare t text;
begin
  foreach t in array array['tax_ids','tax_id_verifications'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format('grant select, insert, update on crm.%I to contigo_app', t);
    execute format($f$create policy %I on crm.%I for select to contigo_app using (
      exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_read', t, t);
    execute format($f$create policy %I on crm.%I for insert to contigo_app with check (
      market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_ins', t, t);
    execute format($f$create policy %I on crm.%I for update to contigo_app
      using (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id))
      with check (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_upd', t, t, t);
  end loop;
end $$;

-- ¿Ese identificador ya está en otro comercio? Mira todo el alcance de mercados de quien pregunta y devuelve lo mínimo.
create or replace function app.tax_id_matches(p_blind text, p_exclude uuid default null)
returns table (account_id uuid, name text, market_code text, locality text, owner_name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select a.id, a.name, a.market_code, a.locality, u.full_name
    from crm.tax_ids t
    join crm.accounts a on a.id = t.account_id and a.archived_at is null
    left join crm.users u on u.id = a.owner_id
   where p_blind is not null and t.blind_ix = p_blind and t.valid_to is null
     and a.market_code = any(app.my_markets())
     and (p_exclude is null or a.id <> p_exclude)
   order by a.name limit 10
$$;
revoke execute on function app.tax_id_matches(text, uuid) from public;
grant execute on function app.tax_id_matches(text, uuid) to contigo_app;

-- =====================================================================================================
-- 4) MULTI-04 · Direcciones por país y coordenadas
-- =====================================================================================================
alter table crm.accounts
  add column address_line2  text,
  add column sublocality    text,          -- colonia, barrio, urbanización, bairro
  add column address_norm   text not null default '',
  add column geo_source     text check (geo_source is null or geo_source in ('manual','device','sales_app','geocoder','import')),
  add column geo_accuracy_m int check (geo_accuracy_m is null or geo_accuracy_m >= 0),
  add column geo_at         timestamptz,
  add column geo_by         uuid references crm.users(id);
alter table crm.accounts add constraint accounts_geo_ck check (
  (latitude is null) = (longitude is null)
  and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180)));

create or replace function crm.account_address_before() returns trigger
language plpgsql set search_path = crm, app, public, extensions, pg_catalog as $$
begin
  new.address_norm := app.norm(regexp_replace(concat_ws(' ', new.address_line, new.address_line2, new.sublocality, new.postal_code), '\s+', ' ', 'g'));
  return new;
end $$;
create trigger accounts_address before insert or update of address_line, address_line2, sublocality, postal_code on crm.accounts
  for each row execute function crm.account_address_before();
update crm.accounts set address_line = address_line where address_line is not null or postal_code is not null;
alter table crm.accounts enable trigger accounts_touch;
alter table crm.deals enable trigger deals_touch;
create index accounts_address_trgm on crm.accounts using gin (address_norm gin_trgm_ops);
create index accounts_geo_idx on crm.accounts (latitude, longitude) where latitude is not null;

-- Formato de dirección por país: qué campos, en qué orden, cómo se llaman y cómo se valida el código postal.
create table crm.address_formats (
  country        char(2) primary key,
  fields         jsonb not null,           -- [{key, es, en, required}] en el orden en que se piden
  postal_regex   text,
  postal_example text,
  regions        jsonb not null default '[]'::jsonb,   -- lista cerrada de estados o provincias, si el país la tiene
  updated_by     uuid references crm.users(id),
  updated_at     timestamptz not null default now()
);
alter table crm.address_formats enable row level security;
alter table crm.address_formats force row level security;
grant select, insert, update on crm.address_formats to contigo_app;
create policy address_formats_read on crm.address_formats for select to contigo_app using ((select app.current_user_id()) is not null);
create policy address_formats_admin_ins on crm.address_formats for insert to contigo_app with check ((select app.is_admin()));
create policy address_formats_admin_upd on crm.address_formats for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

insert into crm.address_formats (country, fields, postal_regex, postal_example, regions) values
  ('MX', '[{"key":"address_line","es":"Calle y número","en":"Street and number","required":true},
           {"key":"address_line2","es":"Interior o referencia","en":"Unit or reference","required":false},
           {"key":"sublocality","es":"Colonia","en":"Neighborhood (colonia)","required":true},
           {"key":"postal_code","es":"Código postal","en":"Postal code","required":true},
           {"key":"locality","es":"Municipio o alcaldía","en":"Municipality","required":true},
           {"key":"region","es":"Estado","en":"State","required":true}]', '^[0-9]{5}$', '06600', '[]'),
  ('US', '[{"key":"address_line","es":"Calle y número","en":"Street address","required":true},
           {"key":"address_line2","es":"Suite o unidad","en":"Suite or unit","required":false},
           {"key":"locality","es":"Ciudad","en":"City","required":true},
           {"key":"region","es":"Estado","en":"State","required":true},
           {"key":"postal_code","es":"ZIP","en":"ZIP code","required":true}]', '^[0-9]{5}(-[0-9]{4})?$', '20850',
         '["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]'),
  ('PR', '[{"key":"address_line","es":"Calle y número","en":"Street address","required":true},
           {"key":"sublocality","es":"Urbanización o barrio","en":"Urbanización or barrio","required":false},
           {"key":"locality","es":"Municipio","en":"Municipality","required":true},
           {"key":"postal_code","es":"Código postal","en":"ZIP code","required":true}]', '^00[679][0-9]{2}(-[0-9]{4})?$', '00901', '[]'),
  ('CO', '[{"key":"address_line","es":"Dirección","en":"Address","required":true},
           {"key":"sublocality","es":"Barrio","en":"Neighborhood (barrio)","required":false},
           {"key":"locality","es":"Municipio","en":"Municipality","required":true},
           {"key":"region","es":"Departamento","en":"Department","required":true},
           {"key":"postal_code","es":"Código postal","en":"Postal code","required":false}]', '^[0-9]{6}$', '110111', '[]'),
  ('SV', '[{"key":"address_line","es":"Dirección","en":"Address","required":true},
           {"key":"sublocality","es":"Colonia o cantón","en":"Neighborhood (colonia)","required":false},
           {"key":"locality","es":"Municipio","en":"Municipality","required":true},
           {"key":"region","es":"Departamento","en":"Department","required":true}]', null, null, '[]'),
  ('BR', '[{"key":"address_line","es":"Calle y número","en":"Street and number","required":true},
           {"key":"address_line2","es":"Complemento","en":"Complement","required":false},
           {"key":"sublocality","es":"Barrio (bairro)","en":"Neighborhood (bairro)","required":true},
           {"key":"locality","es":"Ciudad","en":"City","required":true},
           {"key":"region","es":"Estado (UF)","en":"State (UF)","required":true},
           {"key":"postal_code","es":"CEP","en":"CEP","required":true}]', '^[0-9]{5}-?[0-9]{3}$', '01310-100',
         '["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]'),
  ('PA', '[{"key":"address_line","es":"Dirección","en":"Address","required":true},
           {"key":"sublocality","es":"Corregimiento","en":"Corregimiento","required":false},
           {"key":"locality","es":"Distrito","en":"District","required":true},
           {"key":"region","es":"Provincia","en":"Province","required":true}]', null, null, '[]'),
  ('ZZ', '[{"key":"address_line","es":"Dirección","en":"Address","required":true},
           {"key":"address_line2","es":"Referencia","en":"Reference","required":false},
           {"key":"locality","es":"Ciudad o distrito","en":"City or district","required":true},
           {"key":"region","es":"Estado, provincia o parroquia","en":"State, province or parish","required":false},
           {"key":"postal_code","es":"Código postal","en":"Postal code","required":false}]', null, null, '[]');

-- Distancia en metros entre dos puntos (haversine). Sin extensión ni proveedor de mapas.
create or replace function app.distance_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) returns int
language sql immutable parallel safe as $$
  select round(2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2)
    + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lon2 - lon1)::float8) / 2), 2)))))::int
$$;
grant execute on function app.distance_m(numeric, numeric, numeric, numeric) to contigo_app;

-- "Cerca de mí": comercios con coordenadas dentro de un radio, del más cercano al más lejano. Respeta el alcance (RLS).
create or replace function app.accounts_near(p_lat numeric, p_lon numeric, p_radius_m int default 2000, p_limit int default 40)
returns table (id uuid, name text, market_code text, lifecycle text, locality text, address_line text, owner_name text, phone text, distance_m int)
language sql stable set search_path = crm, app, pg_catalog as $$
  select a.id, a.name, a.market_code, a.lifecycle, a.locality, a.address_line, u.full_name, a.phone,
         app.distance_m(p_lat, p_lon, a.latitude, a.longitude)
    from crm.accounts a left join crm.users u on u.id = a.owner_id
   where a.archived_at is null and a.latitude is not null
     and a.latitude between p_lat - (least(greatest(p_radius_m, 50), 50000) / 111000.0)::numeric
                        and p_lat + (least(greatest(p_radius_m, 50), 50000) / 111000.0)::numeric
     and a.longitude between p_lon - (least(greatest(p_radius_m, 50), 50000) / (111000.0 * greatest(cos(radians(p_lat::float8)), 0.05)))::numeric
                         and p_lon + (least(greatest(p_radius_m, 50), 50000) / (111000.0 * greatest(cos(radians(p_lat::float8)), 0.05)))::numeric
     and app.distance_m(p_lat, p_lon, a.latitude, a.longitude) <= least(greatest(p_radius_m, 50), 50000)
   order by 9, a.name
   limit least(greatest(p_limit, 1), 100)
$$;
grant execute on function app.accounts_near(numeric, numeric, int, int) to contigo_app;

-- Posibles duplicados por ubicación: otros comercios del mismo mercado a menos de p_radius_m. Como la búsqueda de
-- duplicados por nombre y teléfono, mira todo el mercado y devuelve lo mínimo.
create or replace function app.geo_duplicates(p_account uuid, p_radius_m int default 60)
returns table (id uuid, name text, locality text, owner_name text, distance_m int)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select b.id, b.name, b.locality, u.full_name, app.distance_m(a.latitude, a.longitude, b.latitude, b.longitude)
    from crm.accounts a
    join crm.accounts b on b.market_code = a.market_code and b.id <> a.id and b.archived_at is null and b.latitude is not null
     and b.latitude between a.latitude - 0.01 and a.latitude + 0.01 and b.longitude between a.longitude - 0.01 and a.longitude + 0.01
    left join crm.users u on u.id = b.owner_id
   where a.id = p_account and a.latitude is not null and a.market_code = any(app.my_markets())
     and app.distance_m(a.latitude, a.longitude, b.latitude, b.longitude) <= least(greatest(p_radius_m, 10), 500)
   order by 5 limit 5
$$;
revoke execute on function app.geo_duplicates(uuid, int) from public;
grant execute on function app.geo_duplicates(uuid, int) to contigo_app;

-- =====================================================================================================
-- 5) MULTI-05 · WhatsApp por mercado y entidad: número, plantillas, costos y ventana. Canal apagado.
-- =====================================================================================================
create table crm.whatsapp_accounts (
  id              uuid primary key default app.uuid_v7(),
  market_code     text not null references crm.markets(code),
  legal_entity_id uuid not null references crm.legal_entities(id),
  display_name    text not null check (length(display_name) between 2 and 80),
  phone           text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  external_ref    text,                       -- identificador de la cuenta en el proveedor; no es una credencial
  daily_limit     int check (daily_limit is null or daily_limit > 0),
  is_active       boolean not null default true,
  created_by      uuid references crm.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Un número por mercado y entidad: nunca una sola cuenta para todos los países.
create unique index whatsapp_accounts_uq on crm.whatsapp_accounts (market_code, legal_entity_id) where is_active;

create table crm.whatsapp_templates (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.whatsapp_accounts(id),
  market_code   text not null references crm.markets(code),
  key           text not null check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  locale        text not null check (locale in ('es','en','pt')),
  category      text not null check (category in ('utility','marketing','authentication')),
  body          text not null check (length(body) between 5 and 1024),
  status        text not null default 'draft' check (status in ('draft','submitted','approved','rejected','paused')),
  is_active     boolean not null default true,
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index whatsapp_templates_uq on crm.whatsapp_templates (account_id, key, locale) where is_active;

-- Costo por mensaje, por mercado y categoría, con vigencia y fuente. Lo carga administración.
create table crm.whatsapp_rates (
  id             uuid primary key default app.uuid_v7(),
  market_code    text not null references crm.markets(code),
  category       text not null check (category in ('utility','marketing','authentication','service')),
  currency       char(3) not null,
  cost           numeric(12,6) not null check (cost >= 0),
  effective_from date not null,
  source         text not null check (length(source) between 3 and 120),
  loaded_by      uuid references crm.users(id),
  loaded_at      timestamptz not null default now(),
  unique (market_code, category, effective_from)
);

-- Ventana abierta: cuando el comercio escribe, hay 24 horas para responderle sin plantilla (72 si llegó por un anuncio).
create table crm.whatsapp_windows (
  id          uuid primary key default app.uuid_v7(),
  account_id  uuid not null references crm.accounts(id),
  market_code text not null references crm.markets(code),
  kind        text not null check (kind in ('service_24h','ad_72h')),
  opened_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  source      text not null check (source in ('manual','provider')),
  opened_by   uuid references crm.users(id)
);
create index whatsapp_windows_account_idx on crm.whatsapp_windows (account_id, expires_at desc);

do $$
declare t text;
begin
  foreach t in array array['whatsapp_accounts','whatsapp_templates','whatsapp_rates'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format('grant select, insert, update on crm.%I to contigo_app', t);
    execute format('create policy %I on crm.%I for select to contigo_app using (market_code = any((select app.my_markets())::text[]))', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_upd', t);
  end loop;
end $$;
alter table crm.whatsapp_windows enable row level security;
alter table crm.whatsapp_windows force row level security;
grant select, insert on crm.whatsapp_windows to contigo_app;
create policy whatsapp_windows_read on crm.whatsapp_windows for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = whatsapp_windows.account_id));
create policy whatsapp_windows_ins on crm.whatsapp_windows for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = whatsapp_windows.account_id));

-- =====================================================================================================
-- 6) UX-01 · Encabezado de la ficha: los datos de arriba dependen del rol y viven en una tabla
-- =====================================================================================================
create table crm.ficha_layouts (
  role        text primary key check (role in ('admin','lt','market_lead','supervisor','rep','ops')),
  facts       text[] not null check (cardinality(facts) between 1 and 5),
  updated_by  uuid references crm.users(id),
  updated_at  timestamptz not null default now()
);
alter table crm.ficha_layouts enable row level security;
alter table crm.ficha_layouts force row level security;
grant select, insert, update on crm.ficha_layouts to contigo_app;
create policy ficha_layouts_read on crm.ficha_layouts for select to contigo_app using ((select app.current_user_id()) is not null);
create policy ficha_layouts_admin_ins on crm.ficha_layouts for insert to contigo_app with check ((select app.is_admin()));
create policy ficha_layouts_admin_upd on crm.ficha_layouts for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
-- Punto de partida por rol [pendiente: C1 lo confirma acompañando a supervisión y a mesa de control]. Se cambia en Administración.
insert into crm.ficha_layouts (role, facts) values
  ('rep',         '{next_step,alerts,contact,sales_30d,data_as_of}'),
  ('supervisor',  '{owner_team,alerts,next_step,sales_30d,data_as_of}'),
  ('market_lead', '{owner_team,tree,alerts,sales_30d,data_as_of}'),
  ('ops',         '{open_deal,tax_id,entity,alerts,data_as_of}'),
  ('lt',          '{tree,entity,sales_30d,owner_team,data_as_of}'),
  ('admin',       '{owner_team,tree,entity,alerts,data_as_of}');

-- Todo lo que el encabezado necesita en una sola llamada. SECURITY INVOKER: solo devuelve lo que el rol puede ver.
create or replace function app.account_header(p_account uuid) returns jsonb
language sql stable set search_path = crm, app, pg_catalog as $$
  select jsonb_build_object(
    'id', a.id, 'market', a.market_code, 'lifecycle', a.lifecycle, 'lifecycle_at', a.lifecycle_at,
    'owner', u.full_name,
    'team', (select t.name from crm.memberships m join crm.teams t on t.id = m.team_id
              where m.user_id = a.owner_id and m.market_code = a.market_code and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
              order by m.valid_from desc limit 1),
    'path', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by o.ord)
                        from unnest(a.ancestor_ids) with ordinality o(pid, ord) join crm.accounts p on p.id = o.pid), '[]'::jsonb),
    'below', (select count(*)::int from crm.accounts c where c.ancestor_ids @> array[a.id] and c.archived_at is null),
    'alerts', (select count(*)::int from crm.exceptions e where e.account_id = a.id and e.resolved_at is null),
    'alert_kinds', coalesce((select jsonb_agg(k) from (select distinct e.kind as k from crm.exceptions e where e.account_id = a.id and e.resolved_at is null order by 1 limit 3) x), '[]'::jsonb),
    'data_as_of', mm.as_of, 'txn_30d', mm.txn_count_30d, 'volume_minor_30d', mm.volume_minor_30d, 'volume_currency', trim(mm.currency),
    'next_step', (select jsonb_build_object('text', d.next_step, 'due', d.next_step_due, 'deal_id', d.id) from crm.deals d
                   where d.account_id = a.id and d.status = 'open' and d.next_step is not null order by d.next_step_due nulls last, d.created_at limit 1),
    'open_deal', (select jsonb_build_object('id', d.id, 'stage_es', s.name_es, 'stage_en', s.name_en, 'amount_minor', d.amount_minor, 'currency', trim(d.currency),
                                            'amount_usd_minor', d.amount_usd_minor, 'fx_rate_date', d.fx_rate_date)
                    from crm.deals d join crm.stages s on s.id = d.stage_id where d.account_id = a.id and d.status = 'open' order by d.created_at desc limit 1),
    'entity', le.name, 'entity_review', le.needs_review, 'business_unit', a.business_unit,
    'tax', (select jsonb_build_object('status', t.status, 'last4', t.last4, 'type', t.id_type) from crm.tax_ids t where t.account_id = a.id and t.valid_to is null),
    'contact', (select jsonb_build_object('name', c.full_name, 'phone', c.phone, 'role', ac.role) from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
                 where ac.account_id = a.id and ac.valid_to is null order by ac.is_primary desc, ac.valid_from limit 1),
    'timezone', coalesce(a.timezone, mk.timezone), 'own_timezone', a.timezone is not null,
    'whatsapp_until', (select max(w.expires_at) from crm.whatsapp_windows w where w.account_id = a.id and w.expires_at > now())
  )
    from crm.accounts a
    join crm.markets mk on mk.code = a.market_code
    join crm.legal_entities le on le.id = a.legal_entity_id
    left join crm.users u on u.id = a.owner_id
    left join lateral (select m.as_of, m.txn_count_30d, m.volume_minor_30d, m.currency from crm.merchant_metrics_daily m
                        where m.account_id = a.id order by m.as_of desc limit 1) mm on true
   where a.id = p_account
$$;
grant execute on function app.account_header(uuid) to contigo_app;

-- =====================================================================================================
-- 7) E2.F5 · Secciones de campos: las tres de siempre para todos los mercados, y cada mercado agrega las suyas
-- =====================================================================================================
create table crm.field_sections (
  id          uuid primary key default app.uuid_v7(),
  code        text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  market_code text references crm.markets(code),        -- null = todos los mercados
  label_es    text not null,
  label_en    text not null,
  team        text check (team is null or team in ('sales','ops','support','finance','all')),
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index field_sections_uq on crm.field_sections (code, coalesce(market_code, '*'));
alter table crm.field_sections enable row level security;
alter table crm.field_sections force row level security;
grant select, insert, update on crm.field_sections to contigo_app;
create policy field_sections_read on crm.field_sections for select to contigo_app using ((select app.current_user_id()) is not null);
create policy field_sections_admin_ins on crm.field_sections for insert to contigo_app with check ((select app.is_admin()));
create policy field_sections_admin_upd on crm.field_sections for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
insert into crm.field_sections (code, market_code, label_es, label_en, team, position) values
  ('qualify', null, 'Para calificar', 'To qualify', 'sales', 1),
  ('terms',   null, 'Términos comerciales', 'Commercial terms', 'sales', 2),
  ('file',    null, 'Expediente', 'File', 'ops', 3);

alter table crm.field_definitions drop constraint if exists field_definitions_section_check;
create or replace function crm.field_section_check() returns trigger
language plpgsql set search_path = crm, app, pg_catalog as $$
begin
  if new.section is not null and not exists (
       select 1 from crm.field_sections s where s.code = new.section and s.is_active and (s.market_code is null or s.market_code = new.market_code)) then
    raise exception 'unknown field section for this market' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger field_definitions_section before insert or update of section, market_code on crm.field_definitions
  for each row execute function crm.field_section_check();
