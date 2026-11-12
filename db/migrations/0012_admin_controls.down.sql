drop function app.system_status();

drop index crm.audit_events_action_idx;
drop index crm.audit_events_actor_idx;

alter table crm.stages drop column edited_by, drop column edited_at;

drop index crm.leads_utm_idx;
alter table crm.leads
  drop constraint leads_consent_dated,
  drop column consent_text, drop column consent_at,
  drop column fbclid, drop column gclid,
  drop column utm_term, drop column utm_content, drop column utm_campaign, drop column utm_medium, drop column utm_source;

-- El turno vuelve a la regla anterior: solo salta a personas desactivadas.
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

drop function app.works_in(uuid, text);
drop function app.can_sell_in(uuid, text);
