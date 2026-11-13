-- 0027_security (down): quita lo de seguridad y deja las funciones de alcance como estaban en 0002 y 0011.
-- Las filas con rol de agencia o de partner se cierran y se borran: sin esta migración esos roles no existen.

do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'crm' and c.relkind in ('r','p') loop
    execute format('drop trigger if exists zz_audit_capture on crm.%I', t.relname);
    execute format('drop trigger if exists zz_audit_truncate on crm.%I', t.relname);
  end loop;
end $$;

drop policy memberships_admin_grant_ins on crm.memberships;
drop policy memberships_admin_grant_upd on crm.memberships;
alter policy routing_rules_admin_upd on crm.routing_rules using ((select app.has_area('config'))) with check ((select app.has_area('config')));

-- Administración por partes: las políticas vuelven a preguntar por la administración completa.
do $$
declare p record;
begin
  for p in select pol.tablename, pol.policyname, pol.qual, pol.with_check from pg_policies pol
            where pol.schemaname = 'crm' and (coalesce(pol.qual, '') ~ 'app\.has_area\(''(access|config|integrations)''::text\)' or coalesce(pol.with_check, '') ~ 'app\.has_area\(''(access|config|integrations)''::text\)') loop
    execute format('alter policy %I on crm.%I %s %s', p.policyname, p.tablename,
      case when p.qual is not null then 'using (' || regexp_replace(p.qual, 'app\.has_area\(''(access|config|integrations)''::text\)', 'app.is_admin()', 'g') || ')' else '' end,
      case when p.with_check is not null then 'with check (' || regexp_replace(p.with_check, 'app\.has_area\(''(access|config|integrations)''::text\)', 'app.is_admin()', 'g') || ')' else '' end);
  end loop;
end $$;

drop policy audit_read on crm.audit_events;
create policy audit_read on crm.audit_events for select to contigo_app using (
  (select app.is_global()) or market_code = any((select app.full_markets())::text[])
);

drop trigger if exists accounts_stamp_agency on crm.accounts;
drop trigger if exists leads_stamp_agency on crm.leads;
drop trigger if exists deals_stamp_agency on crm.deals;
drop trigger if exists leads_consent_row on crm.leads;
drop trigger if exists leads_consent_to_contact on crm.leads;
drop trigger if exists audit_events_stamp on crm.audit_events;
drop trigger if exists audit_events_export_read on crm.audit_events;
drop function if exists crm.stamp_agency();
drop function if exists crm.lead_consent_row();
drop function if exists crm.lead_consent_to_contact();
drop function if exists crm.audit_events_stamp();
drop function if exists crm.audit_events_export_read();

create or replace function crm.audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;
alter table crm.audit_events disable trigger audit_events_no_update;
alter table crm.audit_events drop column via, drop column redacted_at, drop column redaction_ref;
alter table crm.audit_events enable trigger audit_events_no_update;

drop policy accounts_team_read on crm.accounts;
drop policy accounts_team_upd on crm.accounts;
drop policy accounts_agency_read on crm.accounts;
drop policy accounts_partner_read on crm.accounts;
drop policy accounts_agency_wall on crm.accounts;
drop policy leads_agency_wall on crm.leads;
drop policy leads_agency_read on crm.leads;

drop schema audit cascade;

drop table crm.security_alerts;
drop table crm.secret_inventory;
drop table crm.access_review_items;
drop table crm.access_reviews;
drop table crm.view_as_sessions;
drop table crm.subject_requests;
drop table crm.retention_rules;
drop table crm.contact_suppressions;
drop table crm.consents;
drop table crm.account_sensitive;
drop table crm.sensitive_fields;
drop table crm.seat_approvals;
drop table crm.account_team;

drop function if exists app.security_scan();
drop function if exists app.security_setting_set(text, jsonb);
drop function if exists app.audit_archive_prepare(text);
drop function if exists app.can_review_access(text);
drop function if exists app.view_as_start(uuid, text, int);
drop function if exists app.view_as_current(uuid, uuid);
drop function if exists app.view_as_end(uuid, uuid);
drop function if exists app.subject_anonymize(uuid);
drop function if exists app.subject_export(uuid);
drop function if exists app.retention_apply(text);
drop function if exists app.retention_preview(text, int);
drop function if exists app.retention_candidates(text, int);
drop function if exists app.anonymize_contact(uuid);
drop function if exists app.anonymize_lead(uuid);
drop function if exists app.may_contact(text, text, text);
drop function if exists app.sensitive_set(uuid, text, text, text);
drop function if exists app.sensitive_reveal(uuid, text, text);
drop function if exists app.sensitive_list(uuid);
drop function if exists app.sensitive_can(text, uuid, text);
drop function if exists app.can_manage_account(uuid);
drop function if exists app.can_see_account(uuid);
drop function if exists app.search_allowed();
drop function if exists app.log_read(text, text, int, text, jsonb, uuid);

delete from crm.settings where key like 'security.%' or key like 'privacy.%';


drop trigger if exists api_clients_owner on crm.api_clients;
drop function if exists crm.api_client_owner();
-- Las funciones de autenticación de llaves vuelven a como las dejó 0021.
create or replace function app.api_client(p_hash text)
returns table (id uuid, name text, scopes text[])
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.name, c.scopes from crm.api_clients c
   where c.key_hash = p_hash and c.revoked_at is null and (c.retire_at is null or c.retire_at > now())
$$;
create or replace function app.api_key(p_hash text)
returns table (id uuid, name text, scopes text[], market_code text, mode text, rate_per_minute int, created_by uuid)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
begin
  update crm.api_clients c set last_used_at = now()
   where c.key_hash = p_hash and c.revoked_at is null and (c.retire_at is null or c.retire_at > now())
     and (c.last_used_at is null or c.last_used_at < now() - interval '1 minute');
  return query
    select c.id, c.name, c.scopes, c.market_code, c.mode, c.rate_per_minute, c.created_by from crm.api_clients c
     where c.key_hash = p_hash and c.revoked_at is null and (c.retire_at is null or c.retire_at > now());
end $$;
alter table crm.api_clients drop column owner_id, drop column expires_at;

-- "Ya lo lleva otra persona" vuelve a como la dejó 0013 (antes de quitar la columna de agencia).
create or replace function app.search_others(p_term text)
returns table (kind text, id uuid, name text, locality text, owner_name text, market_code text)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with t as (
    select btrim(translate(app.norm(coalesce(p_term, '')), '%_\', '')) as n,
           regexp_replace(coalesce(p_term, ''), '[^0-9]', '', 'g') as digits,
           app.current_user_id() as me,
           coalesce((select array_agg(distinct am.market_code) from app.active_memberships() am
                      where am.role in ('rep','supervisor','market_lead')), '{}') as mk
  ), acc as (
    select 'account'::text as kind, a.id, a.name, a.locality, u.full_name as owner_name, a.market_code
      from crm.accounts a join crm.users u on u.id = a.owner_id cross join t
     where t.me is not null and a.market_code = any(t.mk) and a.archived_at is null and a.merged_into is null
       and a.owner_id <> t.me
       and ((length(t.n) >= 3 and a.name_norm like '%' || t.n || '%')
            or (length(t.digits) >= 7 and a.phone like '%' || t.digits))
     order by a.name limit 5
  ), ld as (
    select 'lead'::text as kind, l.id, l.business_name as name, l.locality, u.full_name as owner_name, l.market_code
      from crm.leads l join crm.users u on u.id = l.owner_id cross join t
     where t.me is not null and l.market_code = any(t.mk) and l.status in ('new','contacted','qualified')
       and l.owner_id <> t.me
       and ((length(t.n) >= 3 and app.norm(l.business_name) like '%' || t.n || '%')
            or (length(t.digits) >= 7 and l.phone like '%' || t.digits))
     order by l.business_name limit 5
  )
  select * from acc union all select * from ld
$$;

alter table crm.contacts drop column anonymized_at;
alter table crm.deals drop column recruited_agency_id;
alter table crm.leads drop column recruited_agency_id, drop column anonymized_at;
alter table crm.accounts drop column recruited_agency_id;
alter table crm.teams drop column parent_team_id;
delete from crm.memberships where role in ('agency','partner');
alter table crm.memberships drop constraint memberships_agency_check, drop constraint memberships_partner_check,
  drop column admin_areas, drop column agency_id, drop column scope_account_id;
alter table crm.memberships drop constraint memberships_role_check;
alter table crm.memberships add constraint memberships_role_check check (role in ('admin','lt','market_lead','supervisor','rep','ops'));
drop table crm.agencies;

drop function if exists app.team_account_ids(boolean);
drop function if exists app.my_agency_ids();
drop function if exists app.partner_root_ids();
drop function if exists app.has_area(text);

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships() where role = 'admin')
$$;
drop function if exists app.active_memberships_x();

create or replace function app.write_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','supervisor','rep','ops')), '{}')
         end
$$;
create or replace function app.owner_roles() returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array['rep','supervisor','market_lead','ops']::text[]
$$;
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

