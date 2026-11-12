-- 0011_distribution: reparto de cartera (11-nov-2026).
--
-- El problema: después de importar Pipedrive, miles de comercios y negocios quedaron a nombre de una cuenta de servicio
-- o de personas que ya no están. Quien tiene que repartirlos por territorio es supervisión y el líder de mercado, pero
-- supervisión solo veía lo de su equipo y lo que no tenía dueño, así que ni veía esos registros ni podía moverlos.
--
-- La regla ("sin dueño vigente"): un comercio o un lead no tiene dueño vigente cuando no tiene dueño, o cuando su dueño
-- no tiene hoy un rol de ventas (ventas, supervisión o líder de mercado) en el mercado del registro, o está inactivo.
-- Esos registros los ve y los reparte supervisión de ese mercado, además de quien ya los veía (líder de mercado,
-- operaciones, leadership y administración). Quien vende no los ve: sigue viendo lo suyo y los leads sin dueño (0008).
-- Los negocios, las tareas y los pendientes heredan el alcance del comercio, así que no necesitan política propia.

-- ------------------------------------------------------------ 1) quién vende hoy, por mercado
-- Devuelve llaves 'MX:<id de la persona>'. Se calcula una vez por consulta (va dentro de un sub-select en la política)
-- y solo lee membresías, que son pocas: la política no recorre comercios para decidir.
create or replace function app.seller_keys(p_markets text[]) returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array_agg(distinct m.market_code || ':' || m.user_id::text), '{}')
    from crm.memberships m
    join crm.users u on u.id = m.user_id and u.is_active
   where m.market_code = any(p_markets)
     and m.market_code = any(app.my_markets())            -- nadie pregunta por un mercado que no es suyo
     and m.role in ('rep','supervisor','market_lead')
     and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
$$;

-- Lo mismo, para los mercados donde la persona supervisa: es lo que usan las políticas.
create or replace function app.team_seller_keys() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select app.seller_keys(app.team_markets())
$$;

revoke execute on function app.seller_keys(text[]) from public;
revoke execute on function app.team_seller_keys() from public;
grant execute on function app.seller_keys(text[]) to contigo_app;
grant execute on function app.team_seller_keys() to contigo_app;

-- ------------------------------------------------------------ 2) políticas: supervisión ve y reparte lo que nadie atiende
drop policy accounts_read on crm.accounts;
create policy accounts_read on crm.accounts for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null
           or owner_id = any((select app.supervised_user_ids())::uuid[])
           or not ((market_code || ':' || owner_id::text) = any((select app.team_seller_keys())::text[]))))
  or owner_id = (select app.current_user_id())
  or (owner_id is null and territory_id = any((select app.my_territory_ids())::uuid[]))
  or ancestor_ids && (select app.scope_parent_ids())::uuid[]
);

-- La fila que resulta de un cambio de supervisión tiene que quedar en su equipo, sin dueño, o seguir sin dueño vigente
-- (editar el teléfono de un comercio de la cuenta de servicio no lo saca de donde está). No puede terminar a nombre
-- de alguien de otro equipo: eso lo decide el líder de mercado.
drop policy accounts_upd on crm.accounts;
create policy accounts_upd on crm.accounts for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null
             or owner_id = any((select app.supervised_user_ids())::uuid[])
             or not ((market_code || ':' || owner_id::text) = any((select app.team_seller_keys())::text[]))))
    or owner_id = (select app.current_user_id())
    or (owner_id is null and territory_id = any((select app.my_territory_ids())::uuid[]))
    or ancestor_ids && (select app.scope_parent_ids())::uuid[]
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null
             or owner_id = any((select app.supervised_user_ids())::uuid[])
             or not ((market_code || ':' || owner_id::text) = any((select app.team_seller_keys())::text[]))))
    or owner_id = (select app.current_user_id())
    or ancestor_ids && (select app.scope_parent_ids())::uuid[]
  );

drop policy leads_read on crm.leads;
create policy leads_read on crm.leads for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null
           or owner_id = any((select app.supervised_user_ids())::uuid[])
           or not ((market_code || ':' || owner_id::text) = any((select app.team_seller_keys())::text[]))))
  or owner_id = (select app.current_user_id())
  or (owner_id is null and market_code = any((select app.sell_markets())::text[]))
);

drop policy leads_upd on crm.leads;
create policy leads_upd on crm.leads for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null
             or owner_id = any((select app.supervised_user_ids())::uuid[])
             or not ((market_code || ':' || owner_id::text) = any((select app.team_seller_keys())::text[]))))
    or owner_id = (select app.current_user_id())
    or (owner_id is null and market_code = any((select app.sell_markets())::text[]))
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null
             or owner_id = any((select app.supervised_user_ids())::uuid[])
             or not ((market_code || ':' || owner_id::text) = any((select app.team_seller_keys())::text[]))))
    or owner_id = (select app.current_user_id())
  );

-- ------------------------------------------------------------ 3) buscar y filtrar por plaza
-- Ciudad y estado normalizados en una columna, para que "Monterrey" o "nuevo leon" encuentren con el índice de trigramas
-- (app.norm no es inmutable: no admite un índice por expresión).
alter table crm.accounts add column place_norm text not null default '';

create or replace function crm.account_place() returns trigger
language plpgsql set search_path = crm, app, public, extensions as $$
begin
  new.place_norm := btrim(app.norm(coalesce(new.locality, '') || ' ' || coalesce(new.region, '')));
  return new;
end $$;
create trigger accounts_place before insert or update of locality, region on crm.accounts
  for each row execute function crm.account_place();

-- Carga inicial sin disparar los demás disparadores: llenar esta columna no es un cambio del comercio (no mueve updated_at).
alter table crm.accounts disable trigger user;
update crm.accounts set place_norm = btrim(app.norm(coalesce(locality, '') || ' ' || coalesce(region, '')))
 where locality is not null or region is not null;
alter table crm.accounts enable trigger user;

create index accounts_place_trgm on crm.accounts using gin (place_norm gin_trgm_ops);
create index accounts_market_region_idx on crm.accounts (market_code, region) where archived_at is null;

-- Lo abierto de una persona en un mercado: es lo que cuenta Mi equipo y lo que mueve un reparto.
create index deals_open_owner_idx on crm.deals (market_code, owner_id) where status = 'open';
create index leads_open_owner_idx on crm.leads (market_code, owner_id) where status in ('new','contacted','qualified');

-- ------------------------------------------------------------ 4) territorios
-- Un territorio que ya no se usa se archiva: deja de ofrecerse, pero los comercios que lo tenían lo conservan.
alter table crm.territories add column archived_at timestamptz;

-- Un comercio solo lleva un territorio de su propio mercado. Y un comercio nuevo que nace sin territorio toma el de
-- su dueño cuando el dueño tiene uno solo en ese mercado (lo normal en D2D: una persona, una plaza). Si tiene varios
-- o ninguno, queda sin territorio y supervisión lo pone después. Vive en la base para que valga igual en la captura,
-- en la conversión de un lead y en lo que llega de las integraciones.
create or replace function crm.account_territory() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_one uuid;
begin
  if new.territory_id is not null then
    if not exists (select 1 from crm.territories t where t.id = new.territory_id and t.market_code = new.market_code) then
      raise exception 'territory belongs to another market' using errcode = '23514';
    end if;
  elsif tg_op = 'INSERT' and new.owner_id is not null then
    select (array_agg(t.id))[1] into v_one
      from crm.user_territories ut
      join crm.territories t on t.id = ut.territory_id
     where ut.user_id = new.owner_id and t.market_code = new.market_code and t.archived_at is null
    having count(*) = 1;
    new.territory_id := v_one;
  end if;
  return new;
end $$;
-- Solo al crear o al cambiar el territorio: un cambio de mercado lo sigue rechazando la política de la tabla, con su propio error.
create trigger accounts_territory before insert or update of territory_id on crm.accounts
  for each row execute function crm.account_territory();
