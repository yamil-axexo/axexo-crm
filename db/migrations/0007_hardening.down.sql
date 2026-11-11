drop policy activities_ins on crm.activities;
create policy activities_ins on crm.activities for insert to contigo_app with check (
  market_code = any((select app.my_markets())::text[])
  and (account_id is null or exists (select 1 from crm.accounts a where a.id = activities.account_id))
);

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

create or replace function app.session_delete(p_hash text) returns void
language sql security definer set search_path = crm, app, pg_catalog as $$
  delete from crm.sessions where token_hash = p_hash
$$;
