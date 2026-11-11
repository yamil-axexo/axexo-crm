-- 0002_access: identidad de sesión, funciones de alcance, RLS forzado y privilegios mínimos.
-- Reglas del estándar: AUTHZ-03, AUTHZ-04, AUTHZ-05, SEC-02, OBS-03.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'contigo_app') then
    create role contigo_app login noinherit nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

-- Las extensiones viven en "public" (o en "extensions" si el proveedor ya las tenía ahí): el rol las resuelve en ambos casos.
alter role contigo_app set search_path = public, extensions;
grant usage on schema public to contigo_app;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    grant usage on schema extensions to contigo_app;
  end if;
end $$;

-- AUTHZ-04: la identidad llega por set_config('app.user_id', $1, true) dentro de la transacción.
create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Las funciones de alcance son SECURITY DEFINER: leen membresías sin pasar por las políticas
-- que ellas mismas alimentan. El dueño de las migraciones necesita BYPASSRLS (ver ADR-003).
create or replace function app.active_memberships()
returns table (market_code text, role text, team_id uuid)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select m.market_code, m.role, m.team_id
    from crm.memberships m
    join crm.users u on u.id = m.user_id and u.is_active
   where m.user_id = app.current_user_id()
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships() where role = 'admin')
$$;

create or replace function app.is_global() returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships() where role in ('admin','lt'))
$$;

create or replace function app.my_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_global()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()), '{}')
         end
$$;

-- Mercados donde la persona puede escribir. El rol "lt" es de solo lectura: ve todo y no cambia nada.
create or replace function app.write_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','supervisor','rep','ops')), '{}')
         end
$$;

-- Mercados donde la persona ve todo (líder de mercado, operaciones, o rol global).
create or replace function app.full_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_global()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','ops')), '{}')
         end
$$;

create or replace function app.team_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce((select array_agg(distinct market_code) from app.active_memberships()
                    where role = 'supervisor'), '{}')
$$;

-- La persona y, si supervisa equipos, quienes pertenecen a ellos.
create or replace function app.supervised_user_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select array(
    select app.current_user_id()
    union
    select m.user_id
      from crm.memberships m
     where m.team_id in (select team_id from app.active_memberships() where role = 'supervisor' and team_id is not null)
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
  )
$$;

create or replace function app.my_territory_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(select territory_id from crm.user_territories where user_id = app.current_user_id()), '{}')
$$;

-- Cuentas con hijos (cadenas, distribuidores, organizaciones) que la persona o su equipo llevan:
-- quien lleva el padre ve todo el árbol que cuelga de él.
create or replace function app.scope_parent_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(
    select a.id from crm.accounts a
     where a.owner_id = any(app.supervised_user_ids()) and a.kind <> 'store'
  ), '{}')
$$;

create or replace function app.system_user_id() returns uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select id from crm.users where is_system order by created_at limit 1
$$;

-- ------------------------------------------------------------ sesiones
create or replace function app.demo_personas_enabled() returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce((select (value)::boolean from crm.settings where key = 'demo_personas'), false)
$$;

create or replace function app.persona_list()
returns table (id uuid, full_name text, email text, roles text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select u.id, u.full_name, u.email::text,
         string_agg(m.role || coalesce(':' || m.market_code, ''), ', ' order by m.market_code nulls first)
    from crm.users u
    join crm.memberships m on m.user_id = u.id and (m.valid_to is null or m.valid_to > now())
   where app.demo_personas_enabled() and u.is_synthetic and u.is_active and not u.is_system
   group by u.id, u.full_name, u.email
   order by min(case m.role when 'admin' then 0 when 'lt' then 1 when 'market_lead' then 2
                             when 'supervisor' then 3 when 'ops' then 4 else 5 end), u.full_name
$$;

create or replace function app.session_create(p_user uuid, p_hash text, p_kind text, p_ttl_hours int)
returns void
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if p_kind = 'persona' then
    if not app.demo_personas_enabled() then
      raise exception 'demo personas are disabled' using errcode = '42501';
    end if;
    if not exists (select 1 from crm.users where id = p_user and is_synthetic and is_active and not is_system) then
      raise exception 'not a demo persona' using errcode = '42501';
    end if;
  elsif p_kind <> 'sso' then
    raise exception 'unknown session kind' using errcode = '22023';
  end if;
  delete from crm.sessions where expires_at < now();
  insert into crm.sessions (token_hash, user_id, kind, expires_at)
  values (p_hash, p_user, p_kind, now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 24)));
end $$;

create or replace function app.session_user(p_hash text) returns uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select s.user_id from crm.sessions s join crm.users u on u.id = s.user_id and u.is_active
   where s.token_hash = p_hash and s.expires_at > now()
$$;

create or replace function app.session_delete(p_hash text) returns void
language sql security definer set search_path = crm, app, pg_catalog as $$
  delete from crm.sessions where token_hash = p_hash
$$;

-- AUTHZ-01: el dominio se valida en el servidor antes de llamar aquí; esta función solo resuelve la persona.
create or replace function app.sso_user(p_email text, p_subject text, p_name text, p_bootstrap_admin boolean)
returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_id uuid;
begin
  select id into v_id from crm.users where email = p_email::citext and is_active and not is_system;
  if v_id is null and p_bootstrap_admin then
    insert into crm.users (email, full_name, locale) values (p_email, coalesce(nullif(p_name, ''), p_email), 'es')
    returning id into v_id;
    insert into crm.memberships (user_id, market_code, role) values (v_id, null, 'admin');
    insert into crm.audit_events (actor_id, action, object, object_id, after)
    values (v_id, 'user.bootstrap_admin', 'user', v_id, jsonb_build_object('email', p_email));
  end if;
  if v_id is not null then
    update crm.users set auth_subject = p_subject, last_seen_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function app.api_client(p_hash text)
returns table (id uuid, name text, scopes text[])
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.name, c.scopes from crm.api_clients c where c.key_hash = p_hash and c.revoked_at is null
$$;

create or replace function app.form_public(p_slug text)
returns table (id uuid, market_code text, name text, motor text, locale text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select f.id, f.market_code, f.name, f.motor, f.locale from crm.web_forms f where f.slug = p_slug and f.is_active
$$;


-- DAT-04: la búsqueda de duplicados mira todo el mercado aunque quien captura no vea esas cuentas;
-- devuelve lo mínimo (nombre, localidad y dueño) para decidir sin exponer la ficha.
create or replace function app.duplicate_candidates(p_market text, p_name text, p_phone text, p_exclude uuid default null)
returns table (id uuid, name text, locality text, owner_name text, lifecycle text, match text)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  select a.id, a.name, a.locality, u.full_name, a.lifecycle,
         case when p_phone is not null and a.phone = p_phone then 'phone' else 'name' end
    from crm.accounts a
    left join crm.users u on u.id = a.owner_id
   where p_market = any(app.my_markets())
     and a.market_code = p_market
     and a.archived_at is null
     and (p_exclude is null or a.id <> p_exclude)
     and ((p_phone is not null and a.phone = p_phone)
          or (length(app.norm(p_name)) >= 4 and similarity(a.name_norm, app.norm(p_name)) > 0.62))
   order by (p_phone is not null and a.phone = p_phone) desc, similarity(a.name_norm, app.norm(p_name)) desc
   limit 5
$$;

-- LEAD-03: round robin atómico; el cursor avanza bajo bloqueo de fila.
create or replace function app.rr_next(p_rule uuid) returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r crm.routing_rules; n int; i int; pick uuid;
begin
  select * into r from crm.routing_rules where id = p_rule and is_active for update;
  if not found then return null; end if;
  if not (r.market_code = any(app.my_markets())) then
    raise exception 'routing rule out of scope' using errcode = '42501';
  end if;
  n := coalesce(array_length(r.member_ids, 1), 0);
  if r.strategy = 'fixed' or n = 0 then return r.fallback_id; end if;
  for i in 0 .. n - 1 loop
    pick := r.member_ids[((r.cursor + i) % n) + 1];
    if exists (select 1 from crm.users u where u.id = pick and u.is_active) then
      update crm.routing_rules set cursor = (r.cursor + i + 1) % n where id = r.id;
      return pick;
    end if;
  end loop;
  return r.fallback_id;
end $$;

-- ------------------------------------------------------------ RLS forzado en todo el esquema
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'crm' loop
    execute format('alter table crm.%I enable row level security', t.tablename);
    execute format('alter table crm.%I force row level security', t.tablename);   -- AUTHZ-03
  end loop;
end $$;

-- Catálogos y configuración: lee cualquier persona autenticada, escribe solo admin (P11).
do $$
declare t text;
begin
  foreach t in array array['markets','legal_entities','teams','territories','pipelines','stages','loss_reasons',
                           'field_definitions','routing_rules','web_forms','fx_rates','settings','users','user_territories'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using ((select app.current_user_id()) is not null)', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_upd', t);
  end loop;
end $$;
create policy user_territories_admin_del on crm.user_territories for delete to contigo_app using ((select app.is_admin()));

create policy memberships_read on crm.memberships for select to contigo_app using (
  user_id = (select app.current_user_id())
  or (select app.is_global())
  or market_code = any((select app.my_markets())::text[])
);
create policy memberships_admin_ins on crm.memberships for insert to contigo_app with check ((select app.is_admin()));
create policy memberships_admin_upd on crm.memberships for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Cuentas: el alcance sale del rol en el mercado, del equipo, del territorio y del árbol.
create policy accounts_read on crm.accounts for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
  or owner_id = (select app.current_user_id())
  or (owner_id is null and territory_id = any((select app.my_territory_ids())::uuid[]))
  or ancestor_ids && (select app.scope_parent_ids())::uuid[]
);
create policy accounts_ins on crm.accounts for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[])
);
create policy accounts_upd on crm.accounts for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
    or (owner_id is null and territory_id = any((select app.my_territory_ids())::uuid[]))
    or ancestor_ids && (select app.scope_parent_ids())::uuid[]
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
    or ancestor_ids && (select app.scope_parent_ids())::uuid[]
  );

-- Tablas hijas: heredan el alcance de la cuenta.
do $$
declare t text;
begin
  foreach t in array array['account_contacts','account_attributions'] loop
    execute format($f$create policy %I on crm.%I for select to contigo_app using (
      exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_read', t, t);
    execute format($f$create policy %I on crm.%I for insert to contigo_app with check (
      market_code = any((select app.my_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_ins', t, t);
    execute format($f$create policy %I on crm.%I for update to contigo_app
      using (exists (select 1 from crm.accounts a where a.id = %I.account_id))
      with check (exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_upd', t, t, t);
  end loop;
end $$;

create policy account_links_read on crm.account_links for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = account_links.child_id));
create policy account_links_ins on crm.account_links for insert to contigo_app
  with check (exists (select 1 from crm.accounts a where a.id = account_links.child_id));
create policy account_links_upd on crm.account_links for update to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = account_links.child_id))
  with check (exists (select 1 from crm.accounts a where a.id = account_links.child_id));

-- Alias, visitas y métricas: los escribe solo la integración (usuario de sistema, rol admin).
do $$
declare t text;
begin
  foreach t in array array['account_aliases','visits','merchant_metrics_daily'] loop
    execute format($f$create policy %I on crm.%I for select to contigo_app using (
      exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_read', t, t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_sys_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_sys_upd', t);
  end loop;
end $$;

create policy contacts_read on crm.contacts for select to contigo_app using (
  created_by = (select app.current_user_id())
  or exists (select 1 from crm.account_contacts ac where ac.contact_id = contacts.id)
);
create policy contacts_ins on crm.contacts for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[]) and created_by = (select app.current_user_id())
);
create policy contacts_upd on crm.contacts for update to contigo_app
  using (created_by = (select app.current_user_id())
         or exists (select 1 from crm.account_contacts ac where ac.contact_id = contacts.id))
  with check (market_code = any((select app.my_markets())::text[]));

create policy leads_read on crm.leads for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
  or owner_id = (select app.current_user_id())
);
create policy leads_ins on crm.leads for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[])
);
create policy leads_upd on crm.leads for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
  );

create policy deals_read on crm.deals for select to contigo_app using (
  owner_id = (select app.current_user_id())
  or exists (select 1 from crm.accounts a where a.id = deals.account_id)
);
create policy deals_ins on crm.deals for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[])
  and exists (select 1 from crm.accounts a where a.id = deals.account_id)
);
create policy deals_upd on crm.deals for update to contigo_app
  using (owner_id = (select app.current_user_id())
         or exists (select 1 from crm.accounts a where a.id = deals.account_id))
  with check (owner_id = (select app.current_user_id())
         or exists (select 1 from crm.accounts a where a.id = deals.account_id));

create policy deal_stage_events_read on crm.deal_stage_events for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_stage_events.deal_id));
create policy deal_stage_events_ins on crm.deal_stage_events for insert to contigo_app
  with check (exists (select 1 from crm.deals d where d.id = deal_stage_events.deal_id));

create policy activities_read on crm.activities for select to contigo_app using (
  owner_id = (select app.current_user_id())
  or created_by = (select app.current_user_id())
  or (account_id is not null and exists (select 1 from crm.accounts a where a.id = activities.account_id))
  or (lead_id is not null and exists (select 1 from crm.leads l where l.id = activities.lead_id))
);
create policy activities_ins on crm.activities for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[])
  and (account_id is null or exists (select 1 from crm.accounts a where a.id = activities.account_id))
);
create policy activities_upd on crm.activities for update to contigo_app
  using (
    owner_id = (select app.current_user_id())
    or created_by = (select app.current_user_id())
    or (account_id is not null and exists (select 1 from crm.accounts a where a.id = activities.account_id))
    or (lead_id is not null and exists (select 1 from crm.leads l where l.id = activities.lead_id))
  )
  with check (market_code = any((select app.my_markets())::text[]));

create policy exceptions_read on crm.exceptions for select to contigo_app using (
  owner_id = (select app.current_user_id())
  or market_code = any((select app.full_markets())::text[])
  or (account_id is not null and exists (select 1 from crm.accounts a where a.id = exceptions.account_id))
  or (lead_id is not null and exists (select 1 from crm.leads l where l.id = exceptions.lead_id))
);
create policy exceptions_sys_ins on crm.exceptions for insert to contigo_app with check ((select app.is_admin()));
create policy exceptions_upd on crm.exceptions for update to contigo_app
  using (
    owner_id = (select app.current_user_id())
    or market_code = any((select app.full_markets())::text[])
    or (account_id is not null and exists (select 1 from crm.accounts a where a.id = exceptions.account_id))
    or (lead_id is not null and exists (select 1 from crm.leads l where l.id = exceptions.lead_id))
  )
  with check (market_code = any((select app.my_markets())::text[]));

create policy saved_views_read on crm.saved_views for select to contigo_app
  using (user_id = (select app.current_user_id()) or is_shared);
create policy saved_views_ins on crm.saved_views for insert to contigo_app
  with check (user_id = (select app.current_user_id()));
create policy saved_views_upd on crm.saved_views for update to contigo_app
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
create policy saved_views_del on crm.saved_views for delete to contigo_app
  using (user_id = (select app.current_user_id()));

-- Auditoría: cualquiera inserta lo suyo, nadie edita, lee quien gobierna el mercado.
create policy audit_ins on crm.audit_events for insert to contigo_app
  with check (actor_id = (select app.current_user_id()));
create policy audit_read on crm.audit_events for select to contigo_app using (
  (select app.is_global()) or market_code = any((select app.full_markets())::text[])
);

create policy outbox_ins on crm.outbox_events for insert to contigo_app
  with check ((select app.current_user_id()) is not null);
create policy outbox_admin_read on crm.outbox_events for select to contigo_app using ((select app.is_admin()));
create policy outbox_admin_upd on crm.outbox_events for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()));

do $$
declare t text;
begin
  foreach t in array array['inbound_events','ingest_batches','api_clients'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using ((select app.is_admin()))', t || '_admin_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((select app.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_upd', t);
  end loop;
end $$;

create policy usage_ins on crm.usage_events for insert to contigo_app
  with check (user_id = (select app.current_user_id()));
create policy usage_read on crm.usage_events for select to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.is_global()));

-- Candado adicional (política RESTRICTIVE): en toda tabla de negocio solo escribe quien tiene un rol de escritura
-- en ese mercado. Se suma con AND a las políticas de arriba, así que un rol de solo lectura no escribe por ningún camino.
do $$
declare t text;
begin
  foreach t in array array['accounts','account_contacts','account_attributions','account_aliases','contacts','leads','deals',
                           'deal_stage_events','activities','visits','exceptions','merchant_metrics_daily'] loop
    execute format($f$create policy %I on crm.%I as restrictive for insert to contigo_app
      with check (market_code = any((select app.write_markets())::text[]))$f$, t || '_writers_ins', t);
    execute format($f$create policy %I on crm.%I as restrictive for update to contigo_app
      using (true) with check (market_code = any((select app.write_markets())::text[]))$f$, t || '_writers_upd', t);
  end loop;
end $$;

-- crm.sessions no tiene políticas ni privilegios: solo se toca desde las funciones de sesión.

-- ------------------------------------------------------------ privilegios (AUTHZ-05)
revoke all on schema crm, app from public;
grant usage on schema crm, app to contigo_app;
revoke all on all tables in schema crm from public, contigo_app;
grant select, insert, update on all tables in schema crm to contigo_app;
revoke all on crm.sessions from contigo_app;
revoke update on crm.audit_events from contigo_app;
grant delete on crm.saved_views, crm.user_territories to contigo_app;
revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to contigo_app;
alter default privileges in schema crm revoke all on tables from public;
