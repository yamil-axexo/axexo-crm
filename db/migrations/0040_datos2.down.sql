-- 0040_datos2 (down)
drop function if exists app.column_exists(text, text);
drop table if exists crm.field_promotions;
insert into crm.settings (key, value)
select 'field_approval_sla_days', to_jsonb((coalesce((select value #>> '{}' from crm.decision_settings where key = 'field.approval_sla_days' and market_code is null), '3'))::int)
on conflict (key) do nothing;
alter table crm.field_definitions drop column value_schema;
drop function if exists app.node_totals(uuid, date);
drop function if exists app.subtree_at(uuid, timestamptz);
drop table if exists crm.decision_settings;
drop function if exists app.contact_brief(uuid);
drop policy if exists contacts_steward_read on crm.contacts;
drop policy if exists contacts_steward_upd on crm.contacts;
drop function if exists app.duplicate_matches(text, text, text, text, text, text, text, uuid, text[], numeric, numeric);
create function app.duplicate_matches(p_market text, p_name text, p_phone text, p_email text, p_address text, p_locality text,
                                      p_external_id text default null, p_exclude uuid default null)
returns table (id uuid, name text, locality text, owner_name text, lifecycle text, match text, strong boolean)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with m as (
    select a.id, a.name, a.locality, a.owner_id, a.lifecycle,
           case when p_phone is not null and a.phone = p_phone then 'phone'
                when nullif(btrim(p_email), '') is not null and a.email = btrim(p_email)::citext then 'email'
                when nullif(btrim(p_external_id), '') is not null and exists (
                       select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and lower(al.external_id) = lower(btrim(p_external_id))) then 'external_id'
                when nullif(btrim(p_external_id), '') is not null and upper(btrim(a.merchant_ref)) = upper(btrim(p_external_id)) then 'external_id'
                when app.addr_key(p_address, p_locality) is not null and a.name_norm = app.norm(p_name)
                     and app.addr_key(a.address_line, a.locality) = app.addr_key(p_address, p_locality) then 'name_address'
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
grant execute on function app.duplicate_matches(text, text, text, text, text, text, text, uuid) to contigo_app;
drop function if exists app.queue_account_matches(uuid[]);
create or replace function app.scan_duplicates(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, public, extensions, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is not null and app.current_user_id() is distinct from app.system_user_id()
     and not (app.is_admin() or (p_market is not null and p_market = any(app.lead_markets()))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with live as (
    select id, market_code, name_norm, phone, email, locality, app.addr_key(address_line, locality) as addr
      from crm.accounts where archived_at is null and (p_market is null or market_code = p_market)
  ), found as (
    select a.market_code, a.id as a_id, b.id as b_id,
           array_remove(array[
             case when a.phone is not null and a.phone = b.phone then 'phone' end,
             case when a.email is not null and a.email = b.email then 'email' end,
             case when a.addr is not null and a.addr = b.addr and a.name_norm = b.name_norm then 'name_address' end,
             case when similarity(a.name_norm, b.name_norm) > 0.62 then 'name' end], null) as kinds,
           similarity(a.name_norm, b.name_norm) as sim
      from live a join live b on b.market_code = a.market_code and a.id < b.id
       and ((a.phone is not null and a.phone = b.phone)
            or (a.email is not null and a.email = b.email)
            or (a.addr is not null and a.addr = b.addr and a.name_norm = b.name_norm)
            or (length(a.name_norm) >= 4 and a.name_norm % b.name_norm and similarity(a.name_norm, b.name_norm) > 0.62
                and app.norm(a.locality) = app.norm(b.locality)))
  ), ins as (
    insert into crm.duplicate_pairs (market_code, a_id, b_id, match_kinds, strong, score)
    select market_code, a_id, b_id, kinds, kinds && array['phone','email','name_address'], round(sim::numeric, 3)
      from found where cardinality(kinds) > 0
    on conflict (a_id, b_id) do update set match_kinds = excluded.match_kinds, strong = excluded.strong, score = excluded.score
      where crm.duplicate_pairs.status = 'open'
    returning 1
  )
  select count(*) into n from ins;
  update crm.duplicate_pairs p set status = 'dismissed', decision_note = 'archived', decided_at = now()
   where p.status = 'open' and exists (select 1 from crm.accounts a where a.id in (p.a_id, p.b_id) and a.archived_at is not null);
  return n;
end $$;
drop function if exists app.account_pairs_for(text, uuid[]);
drop function if exists app.geohash(numeric, numeric, int);
create or replace function app.contact_by_phone(p_market text, p_phone text)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.full_name from crm.contacts c
   where p_market = any(app.my_markets()) and c.market_code = p_market and p_phone is not null and c.phone = p_phone
   order by c.created_at limit 1
$$;
drop function if exists app.contacts_by_phones(text, text[]);
drop index if exists crm.contacts_phone_uq;
create index contacts_phone_idx on crm.contacts (market_code, phone) where phone is not null;
-- El teléfono en espera vuelve a su contacto (deja de haber índice único).
update crm.contacts set phone = held_phone where held_phone is not null and phone is null;
drop function if exists app.contact_phone_cleanup();
drop function if exists app.contact_pair_queue(text, uuid, uuid, text);
drop table if exists crm.contact_merge_events;
drop table if exists crm.contact_pairs;
alter table crm.contacts drop column held_phone, drop column archived_at, drop column merged_into;
