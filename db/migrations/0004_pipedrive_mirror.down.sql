-- Revierte 0004. Los mercados y motivos base se quedan: otras filas ya pueden depender de ellos.
-- Si existen dos pipelines con el mismo mercado y motor, la restricción única no vuelve: hay que resolverlo antes.
drop table if exists crm.import_raw, crm.import_runs, crm.external_refs, crm.deal_items, crm.products;

alter table crm.activities drop column if exists custom, drop column if exists type_label;
alter table crm.leads drop column if exists custom;
alter table crm.contacts drop column if exists custom, drop column if exists owner_id;

delete from crm.field_definitions where source = 'pipedrive' or object in ('activity','product')
   or data_type in ('long_text','multiselect','money','user','phone');
drop index if exists crm.field_definitions_external_uq;
alter table crm.field_definitions
  drop column if exists position, drop column if exists source, drop column if exists external_ref, drop column if exists mapped_to;
alter table crm.field_definitions drop constraint field_definitions_key_check;
alter table crm.field_definitions add constraint field_definitions_key_check check (key ~ '^[a-z][a-z0-9_]{1,40}$');
alter table crm.field_definitions drop constraint field_definitions_data_type_check;
alter table crm.field_definitions add constraint field_definitions_data_type_check
  check (data_type in ('text','number','date','boolean','select'));
alter table crm.field_definitions drop constraint field_definitions_object_check;
alter table crm.field_definitions add constraint field_definitions_object_check
  check (object in ('account','deal','lead','contact'));

alter table crm.pipelines drop column if exists close_by_transaction, drop column if exists is_active;
alter table crm.pipelines add constraint pipelines_market_code_motor_key unique (market_code, motor);

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
