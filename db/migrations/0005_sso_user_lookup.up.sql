-- 0005_sso_user_lookup: el login con Google fallaba con "type citext does not exist".
-- app.sso_user corre con search_path = crm, app, pg_catalog (SECURITY DEFINER) y nombraba el tipo citext,
-- que vive en el esquema de extensiones. La búsqueda ya no nombra el tipo: compara el correo en minúsculas.
create or replace function app.sso_user(p_email text, p_subject text, p_name text, p_bootstrap_admin boolean)
returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_id uuid;
begin
  select id into v_id from crm.users where lower(email::text) = lower(p_email) and is_active and not is_system;
  if v_id is null and p_bootstrap_admin then
    insert into crm.users (email, full_name, locale) values (lower(p_email), coalesce(nullif(p_name, ''), p_email), 'es')
    returning id into v_id;
  end if;
  if v_id is not null and p_bootstrap_admin and not exists (
       select 1 from crm.memberships m where m.user_id = v_id and m.role = 'admin' and (m.valid_to is null or m.valid_to > now())) then
    insert into crm.memberships (user_id, market_code, role) values (v_id, null, 'admin');
    insert into crm.audit_events (actor_id, action, object, object_id, after)
    values (v_id, 'user.bootstrap_admin', 'user', v_id, jsonb_build_object('email', lower(p_email)));
  end if;
  if v_id is not null then
    update crm.users set auth_subject = p_subject, last_seen_at = now() where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function app.sso_user(text, text, text, boolean) from public;
grant execute on function app.sso_user(text, text, text, boolean) to contigo_app;
