-- 0012_admin_controls: controles de administración que pidió el comité del 11-nov-2026 (grupo administración y leadership).

-- 1) Ruteo de leads: el turno nunca entrega un lead a quien no tiene un rol vigente de ventas en ese mercado.
--    Antes solo saltaba a personas desactivadas: quitar el acceso no desactiva a la persona, así que el siguiente
--    lead web le llegaba a alguien que ya no podía entrar. Si en el turno no queda nadie y el respaldo tampoco vende
--    en el mercado, el lead queda sin dueño: lo ven quienes venden en ese mercado (0008_open_leads) y lo toma el primero.
create or replace function app.can_sell_in(p_user uuid, p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (
    select 1 from crm.users u
      join crm.memberships m on m.user_id = u.id
     where u.id = p_user and u.is_active and not u.is_system
       and m.market_code = p_market and m.role in ('rep','supervisor','market_lead')
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$$;

-- Quien puede llevar un registro de un mercado: vende ahí, opera ahí o administra. Sirve para avisar que un comercio,
-- un negocio o un lead quedó a nombre de alguien que ya no tiene acceso.
create or replace function app.works_in(p_user uuid, p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (
    select 1 from crm.users u
      join crm.memberships m on m.user_id = u.id
     where u.id = p_user and u.is_active and not u.is_system
       and (m.role = 'admin' or (m.market_code = p_market and m.role in ('rep','supervisor','market_lead','ops')))
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$$;

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
  if r.strategy <> 'fixed' then
    for i in 0 .. n - 1 loop
      pick := r.member_ids[((r.cursor + i) % n) + 1];
      if app.can_sell_in(pick, r.market_code) then
        update crm.routing_rules set cursor = (r.cursor + i + 1) % n where id = r.id;
        return pick;
      end if;
    end loop;
  end if;
  if r.fallback_id is not null and app.can_sell_in(r.fallback_id, r.market_code) then
    return r.fallback_id;
  end if;
  return null;
end $$;

-- 2) Origen de los leads web (E3.F6) y consentimiento con fecha (E3.F7).
--    Son columnas, no un JSON, para poder filtrar y agrupar por fuente y por campaña.
alter table crm.leads
  add column utm_source    text check (utm_source is null or length(utm_source) <= 200),
  add column utm_medium    text check (utm_medium is null or length(utm_medium) <= 200),
  add column utm_campaign  text check (utm_campaign is null or length(utm_campaign) <= 200),
  add column utm_content   text check (utm_content is null or length(utm_content) <= 200),
  add column utm_term      text check (utm_term is null or length(utm_term) <= 200),
  add column gclid         text check (gclid is null or length(gclid) <= 200),
  add column fbclid        text check (fbclid is null or length(fbclid) <= 200),
  add column consent_at    timestamptz,
  add column consent_text  text check (consent_text is null or length(consent_text) <= 400),
  add constraint leads_consent_dated check (consent_text is null or consent_at is not null);
create index leads_utm_idx on crm.leads (market_code, utm_source, utm_campaign) where utm_source is not null;

-- 3) Etapas editadas desde Administración: la importación de Pipedrive respeta lo que alguien corrigió a mano.
alter table crm.stages
  add column edited_at  timestamptz,
  add column edited_by  uuid references crm.users(id);

-- 4) Bitácora: índices para filtrar por persona y por tipo de acción sin recorrerla completa.
create index audit_events_actor_idx on crm.audit_events (actor_id, at desc);
create index audit_events_action_idx on crm.audit_events (action, at desc);

-- 5) Página de estado: administración y leadership ven qué versión del esquema corre y qué tan al día están los datos.
--    Las tablas de integración solo las lee administración; esta función entrega fechas y conteos, nunca contenido.
create or replace function app.system_status() returns jsonb
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
begin
  if not app.is_global() then
    raise exception 'system status is for administration and leadership' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'migrations', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'applied_at', s.applied_at) order by s.name), '[]'::jsonb)
                     from app.schema_migrations s),
    'pipedrive', (select jsonb_build_object('status', r.status, 'mode', r.cursor ->> 'mode', 'started_at', r.started_at, 'finished_at', r.finished_at)
                    from crm.import_runs r where r.source = 'pipedrive' order by r.started_at desc limit 1),
    's5', (select jsonb_build_object('as_of', b.as_of, 'loaded_at', b.loaded_at, 'simulated', exists (
                    select 1 from crm.audit_events a where a.action = 'integration.simulated' and a.after ->> 'key' = b.file_name))
             from crm.ingest_batches b where b.source = 's5' and b.status = 'loaded' order by b.loaded_at desc limit 1),
    'sales_app', (select jsonb_build_object('received_at', e.received_at, 'simulated', exists (
                    select 1 from crm.audit_events a where a.action = 'integration.simulated' and a.after ->> 'key' = e.idempotency_key))
                    from crm.inbound_events e where e.source = 'sales_app' order by e.received_at desc limit 1),
    'web_forms', (select jsonb_build_object('received_at', e.received_at)
                    from crm.inbound_events e where e.source = 'web_form' order by e.received_at desc limit 1),
    'keys', (select coalesce(jsonb_object_agg(x.scope, x.n), '{}'::jsonb)
               from (select s.scope, count(*)::int as n from crm.api_clients c, unnest(c.scopes) as s(scope)
                      where c.revoked_at is null group by s.scope) x),
    'outbox_pending', (select count(*)::int from crm.outbox_events where published_at is null)
  );
end $$;

revoke execute on function app.can_sell_in(uuid, text), app.works_in(uuid, text), app.system_status() from public;
grant execute on function app.can_sell_in(uuid, text), app.works_in(uuid, text), app.system_status() to contigo_app;
