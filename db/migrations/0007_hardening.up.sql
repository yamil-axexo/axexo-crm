-- 0007_hardening: hallazgos del comité de evaluación (11-nov-2026).

-- 1) Una actividad solo se liga a registros que la persona puede ver y que son de su mismo mercado.
--    Antes la política revisaba el comercio pero no el lead ni el negocio: con un comercio propio y el id de un lead
--    ajeno se podía dejar una nota en el lead de otro mercado. El dominio ya lo valida; esta es la segunda barrera.
drop policy activities_ins on crm.activities;
create policy activities_ins on crm.activities for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[])
  and (account_id is null or exists (select 1 from crm.accounts a where a.id = activities.account_id and a.market_code = activities.market_code))
  and (lead_id is null or exists (select 1 from crm.leads l where l.id = activities.lead_id and l.market_code = activities.market_code))
  and (deal_id is null or exists (select 1 from crm.deals d where d.id = activities.deal_id and d.market_code = activities.market_code))
);

-- 2) Bitácora de accesos: cada inicio y cierre de sesión deja un evento, con el tipo de sesión.
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
  insert into crm.audit_events (actor_id, action, object, object_id, after)
  values (p_user, 'session.started', 'session', p_user, jsonb_build_object('kind', p_kind));
end $$;

create or replace function app.session_delete(p_hash text) returns void
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_user uuid;
begin
  delete from crm.sessions where token_hash = p_hash returning user_id into v_user;
  if v_user is not null then
    insert into crm.audit_events (actor_id, action, object, object_id) values (v_user, 'session.ended', 'session', v_user);
  end if;
end $$;
