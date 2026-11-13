-- 0031_us_ficha: la ficha de la tienda de US (épica E9 de los requerimientos).
-- Un mercado puede llevar la "ficha de dealer" (crm.markets.flags.dealer_record): ventas e identificadores primero, número de
-- sitio junto al Merchant ID, tipo de negocio, origen del comercio, reclutado por, Tax ID (últimos 4) y el portafolio de carriers.
-- El portafolio NO es un modelo nuevo: extiende crm.account_products (paquete datos, DAT-07) con el detalle por carrier.

-- ================================================================ 1) columnas de la tienda
alter table crm.account_types add column takes_business_type boolean not null default false;
comment on column crm.account_types.takes_business_type is 'E9.F4: solo las cuentas de este tipo (dealers) llevan tipo de negocio.';

-- E9.F4: formato de tienda de un dealer, por mercado. Lo amplía administración.
create table crm.business_types (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  code         text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es     text not null check (char_length(btrim(label_es)) between 2 and 60),
  label_en     text not null check (char_length(btrim(label_en)) between 2 and 60),
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (market_code, code)
);

-- E9.F12: agencias y otros socios que reclutan tiendas (el equipo propio no necesita registro).
create table crm.agencies (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  kind         text not null check (kind in ('agency','partner')),
  name         text not null check (char_length(btrim(name)) between 2 and 80),
  is_active    boolean not null default true,
  created_by   uuid references crm.users(id),
  created_at   timestamptz not null default now()
);
create unique index agencies_uq on crm.agencies (market_code, lower(btrim(name)));

alter table crm.accounts
  add column site_ref            text check (site_ref is null or char_length(site_ref) between 1 and 40),
  add column business_type       text,
  add column merchant_origin     text check (merchant_origin is null or merchant_origin in ('new_acquisition','emida_conversion')),
  add column merchant_origin_at  timestamptz,
  add column recruited_by        text check (recruited_by is null or recruited_by in ('field_team','agency','partner')),
  add column recruited_agency_id uuid references crm.agencies(id),
  add column recruited_at        timestamptz,
  add column retired_carriers    text check (retired_carriers is null or char_length(retired_carriers) <= 300),
  add constraint accounts_recruiter_shape check (
    (recruited_by is null and recruited_agency_id is null)
    or (recruited_by = 'field_team' and recruited_agency_id is null)
    or (recruited_by in ('agency','partner') and recruited_agency_id is not null));
comment on column crm.accounts.site_ref is 'E9.F2: número de sitio o terminal que el cliente ve en el portal, junto al Merchant ID. Lo llena Operaciones.';
comment on column crm.accounts.merchant_origin is 'E9.F5: alta nueva o conversión de EMIDA. Se fija una vez.';
comment on column crm.accounts.recruited_by is 'E9.F12: quién reclutó la tienda. Se fija una vez.';
comment on column crm.accounts.retired_carriers is 'E9.F8: carriers que ya no están vigentes, como texto.';
create index accounts_recruiter_idx on crm.accounts (market_code, recruited_by, recruited_agency_id);

alter table crm.deals
  add column recruited_by        text check (recruited_by is null or recruited_by in ('field_team','agency','partner')),
  add column recruited_agency_id uuid references crm.agencies(id);
create index deals_recruiter_idx on crm.deals (market_code, recruited_by, recruited_agency_id);

-- ================================================================ 2) portafolio de carriers: detalle sobre account_products
alter table crm.ops_catalog add column ref_label text check (ref_label is null or char_length(btrim(ref_label)) between 2 and 40);
comment on column crm.ops_catalog.ref_label is 'Proveedor: cómo se llama el identificador que da a cada tienda (por ejemplo "TMO ID").';
alter table crm.account_products
  add column carrier_ref   text check (carrier_ref is null or char_length(carrier_ref) between 1 and 60),
  add column kit_sent_on   date,
  add column sims_ordered  int check (sims_ordered is null or sims_ordered between 0 and 100000),
  add column training_on   date;

-- ================================================================ 3) reglas en la base
-- Origen y reclutador se fijan una vez; el tipo de negocio es solo de dealers; una tienda nueva de un mercado con ficha de dealer
-- nace como Dealer y como alta nueva.
create or replace function crm.account_dealer_record() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_dealer boolean; v_takes boolean;
begin
  if tg_op = 'UPDATE' then
    if old.merchant_origin is not null and new.merchant_origin is distinct from old.merchant_origin then
      raise exception 'merchant origin is set once' using errcode = '23514';
    end if;
    if old.recruited_by is not null and (new.recruited_by is distinct from old.recruited_by or new.recruited_agency_id is distinct from old.recruited_agency_id) then
      raise exception 'recruited by is set once' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then
    select coalesce((m.flags ->> 'dealer_record')::boolean, false) into v_dealer from crm.markets m where m.code = new.market_code;
    if coalesce(v_dealer, false) then
      if new.account_type = 'store' and exists (select 1 from crm.account_types t where t.code = 'dealer' and t.market_code = new.market_code and t.is_active) then
        new.account_type := 'dealer';
      end if;
      -- Lo que crea una persona es un alta nueva. Lo que carga el sistema (importación) queda sin definir hasta que llegue su ID de EMIDA o alguien lo fije.
      if new.merchant_origin is null and new.kind = 'store' and new.created_by is distinct from app.system_user_id() then
        new.merchant_origin := 'new_acquisition';
      end if;
    end if;
  end if;
  if new.merchant_origin is not null and new.merchant_origin_at is null then new.merchant_origin_at := now(); end if;
  if new.recruited_by is not null and new.recruited_at is null then new.recruited_at := now(); end if;
  if new.recruited_agency_id is not null and (tg_op = 'INSERT' or new.recruited_agency_id is distinct from old.recruited_agency_id)
     and not exists (select 1 from crm.agencies g where g.id = new.recruited_agency_id and g.market_code = new.market_code and g.kind = new.recruited_by) then
    raise exception 'agency does not belong to this market' using errcode = '23514';
  end if;
  if new.business_type is not null then
    select t.takes_business_type into v_takes from crm.account_types t
     where t.code = new.account_type and (t.market_code is null or t.market_code = new.market_code) order by t.market_code nulls last limit 1;
    if not coalesce(v_takes, false) then
      -- La cuenta dejó de ser dealer: el tipo de negocio se vacía solo. Ponerlo en una cuenta que no es dealer se rechaza.
      if tg_op = 'UPDATE' and new.business_type is not distinct from old.business_type then new.business_type := null;
      else raise exception 'business type is for dealers only' using errcode = '23514';
      end if;
    elsif (tg_op = 'INSERT' or new.business_type is distinct from old.business_type)
          and not exists (select 1 from crm.business_types b where b.market_code = new.market_code and b.code = new.business_type and b.is_active) then
      raise exception 'unknown business type' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
-- Corre después de accounts_type_sync (orden alfabético): el tipo ya viene resuelto.
create trigger accounts_us_dealer_record before insert or update on crm.accounts
  for each row execute function crm.account_dealer_record();

-- El reclutador de la tienda llega a sus negocios: los nuevos lo copian y, cuando se fija en la tienda, baja a los que no lo tenían.
create or replace function crm.deal_recruiter() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if old.recruited_by is not null and (new.recruited_by is distinct from old.recruited_by or new.recruited_agency_id is distinct from old.recruited_agency_id) then
      raise exception 'recruited by is set once' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.recruited_by is null and new.account_id is not null then
    select a.recruited_by, a.recruited_agency_id into new.recruited_by, new.recruited_agency_id from crm.accounts a where a.id = new.account_id;
  end if;
  return new;
end $$;
create trigger deals_us_recruiter before insert or update of recruited_by, recruited_agency_id on crm.deals
  for each row execute function crm.deal_recruiter();

create or replace function crm.account_recruiter_to_deals() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.recruited_by is not null and old.recruited_by is null then
    update crm.deals set recruited_by = new.recruited_by, recruited_agency_id = new.recruited_agency_id where account_id = new.id and recruited_by is null;
  end if;
  return null;
end $$;
create trigger accounts_us_recruiter_to_deals after update of recruited_by on crm.accounts
  for each row execute function crm.account_recruiter_to_deals();

-- E9.F5: una tienda que trae identificador de EMIDA y todavía no tiene origen es una conversión de EMIDA.
create or replace function crm.alias_sets_origin() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.system = 'emida' then
    update crm.accounts a set merchant_origin = 'emida_conversion'
     where a.id = new.account_id and a.merchant_origin is null and a.kind = 'store'
       and exists (select 1 from crm.markets m where m.code = a.market_code and coalesce((m.flags ->> 'dealer_record')::boolean, false));
  end if;
  return null;
end $$;
create trigger account_aliases_us_origin after insert on crm.account_aliases
  for each row execute function crm.alias_sets_origin();

-- ================================================================ 4) RLS forzado y privilegios
alter table crm.business_types enable row level security;
alter table crm.business_types force row level security;
alter table crm.agencies enable row level security;
alter table crm.agencies force row level security;
grant select, insert, update on crm.business_types, crm.agencies to contigo_app;
create policy business_types_read on crm.business_types for select to contigo_app using ((select app.current_user_id()) is not null);
create policy business_types_admin_ins on crm.business_types for insert to contigo_app with check ((select app.is_admin()));
create policy business_types_admin_upd on crm.business_types for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
-- Agencias: las ve quien ve el mercado; las da de alta y de baja administración o quien lidera ese mercado.
create policy agencies_read on crm.agencies for select to contigo_app
  using ((select app.is_global()) or market_code = any((select app.my_markets())::text[]));
create policy agencies_ins on crm.agencies for insert to contigo_app
  with check (market_code = any((select app.lead_markets())::text[]));
create policy agencies_upd on crm.agencies for update to contigo_app
  using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]));

-- ================================================================ 5) configuración de un mercado con ficha de dealer
-- Idempotente. La migración la aplica a US si el mercado ya existe (staging); el seed sintético la llama después de crear US.
-- p_carriers: carga además los carriers vigentes de los requerimientos (H2O, AT&T, T-Mobile, Gen Mobile, Ultra, LWP).
create or replace function crm.dealer_record_setup(p_market text, p_carriers boolean default false) returns void
language plpgsql set search_path = crm, app, pg_catalog as $$
begin
  if not exists (select 1 from crm.markets where code = p_market) then return; end if;
  update crm.markets set flags = flags || '{"dealer_record": true}'::jsonb where code = p_market;

  -- E9.F3 Channel Segment: qué es cada organización.
  insert into crm.account_types (market_code, code, label_es, label_en, kind, position, takes_business_type)
  select p_market, v.code, v.es, v.en, v.kind, v.pos, v.code = 'dealer'
    from (values ('dealer', 'Dealer', 'Dealer', 'store', 1), ('isp', 'ISP', 'ISP', 'organization', 2),
                 ('master_agent', 'Distribuidor o Master Agent', 'Distributor/Master Agent', 'distributor', 3),
                 ('carrier', 'Carrier', 'Carrier', 'organization', 4), ('tsp', 'TSP', 'TSP', 'organization', 5),
                 ('vendor', 'Vendor', 'Vendor', 'organization', 6)) v(code, es, en, kind, pos)
   where not exists (select 1 from crm.account_types t where t.code = v.code and t.market_code = p_market);
  -- Es configuración, no un cambio de cada comercio: no mueve su fecha de última edición ni dispara avisos.
  alter table crm.accounts disable trigger user;
  -- Las tiendas que ya existen son dealers; lo importado que dice su Channel Segment toma ese tipo si el nivel del árbol no cambia.
  update crm.accounts a set account_type = 'dealer' where a.market_code = p_market and a.account_type = 'store';
  update crm.accounts a set account_type = x.code
    from (values ('isp', 'isp', 'organization'), ('carrier', 'carrier', 'organization'), ('tsp', 'tsp', 'organization'), ('vendor', 'vendor', 'organization'),
                 ('distributor/master agent', 'master_agent', 'distributor'), ('master agent', 'master_agent', 'distributor')) x(label, code, kind)
   where a.market_code = p_market and lower(btrim(a.segment)) = x.label and a.kind = x.kind and a.account_type <> x.code;

  -- E9.F5: lo que ya trae identificador de EMIDA es una conversión.
  update crm.accounts a set merchant_origin = 'emida_conversion', merchant_origin_at = now()
   where a.market_code = p_market and a.merchant_origin is null and a.kind = 'store'
     and exists (select 1 from crm.account_aliases l where l.account_id = a.id and l.system = 'emida');
  alter table crm.accounts enable trigger user;

  -- E9.F4 Business Type.
  insert into crm.business_types (market_code, code, label_es, label_en, position)
  select p_market, v.code, v.es, v.en, v.pos
    from (values ('bodega_grocery', 'Bodega o abarrotes', 'Bodega/grocery', 1), ('wireless_shop', 'Tienda de celulares', 'Wireless/phone shop', 2),
                 ('convenience', 'Tienda de conveniencia', 'Convenience', 3), ('liquor', 'Licorería', 'Liquor', 4),
                 ('restaurant_taqueria', 'Restaurante o taquería', 'Restaurant/taqueria', 5), ('pharmacy', 'Farmacia', 'Pharmacy', 6),
                 ('laundromat', 'Lavandería', 'Laundromat', 7), ('check_cashing_msb', 'Cambio de cheques o MSB', 'Check cashing/MSB', 8),
                 ('repair_shop', 'Taller de reparación', 'Repair shop', 9), ('travel_agency', 'Agencia de viajes', 'Travel agency', 10),
                 ('other_retail', 'Otro comercio', 'Other retail', 11)) v(code, es, en, pos)
  on conflict (market_code, code) do nothing;

  -- E9.F6 Zone / Territory: los 15 valores. Los que ya existen con ese nombre se quedan como están.
  insert into crm.territories (market_code, code, name)
  select p_market, v.code, v.name
    from (values ('MD', 'Maryland'), ('LA-CA', 'Los Angeles CA'), ('OC-CA', 'Orange County CA'), ('NJ', 'New Jersey'), ('FL', 'Florida'),
                 ('DC', 'Washington DC'), ('NOVA', 'Northern Virginia'), ('BOS-MA', 'Boston MA'), ('CHI-IL', 'Chicago IL'), ('SAC-CA', 'Sacramento CA'),
                 ('SD-CA', 'San Diego CA'), ('LV-NV', 'Las Vegas NV'), ('FRES-CA', 'Fresno/Bakersfield CA'), ('AZ', 'Arizona'), ('HOU-TX', 'Houston TX')) v(code, name)
   where not exists (select 1 from crm.territories t where t.market_code = p_market
                      and (t.code = v.code or regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v.name), '[^a-z0-9]', '', 'g')));

  if p_carriers then
    insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position, ref_label)
    select p_market, 'provider', v.code, v.label, v.label, v.pos, v.ref
      from (values ('h2o', 'H2O', 10, 'HDN Account ID'), ('att', 'AT&T', 11, 'AT&T RT2 ID'), ('tmobile', 'T-Mobile', 12, 'TMO ID'),
                   ('gen_mobile', 'Gen Mobile', 13, null), ('ultra', 'Ultra', 14, 'Ultra Dealer Code'), ('lwp', 'LWP', 15, null)) v(code, label, pos, ref)
     where not exists (select 1 from crm.ops_catalog c where c.kind = 'provider' and coalesce(c.market_code, p_market) = p_market
                        and (c.code = v.code or regexp_replace(lower(c.label_en), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v.label), '[^a-z0-9]', '', 'g')));
    update crm.ops_catalog c set ref_label = v.ref
      from (values ('h2o', 'HDN Account ID'), ('att', 'AT&T RT2 ID'), ('tmobile', 'TMO ID'), ('ultra', 'Ultra Dealer Code')) v(code, ref)
     where c.kind = 'provider' and c.market_code = p_market and c.code = v.code and c.ref_label is null;
  end if;
end $$;
revoke all on function crm.dealer_record_setup(text, boolean) from public;

select crm.dealer_record_setup('US', true);
