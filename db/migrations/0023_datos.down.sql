-- 0023_datos (down): quita lo que agregó el paquete datos. Los alias con un sistema nuevo pasan a "other" para que vuelva el check.
drop function if exists app.quality_snapshot();
drop function if exists app.quality_failing(text, text, int);
drop function if exists app.quality_measure();
drop function if exists app.user_team(uuid, text);
drop trigger if exists deal_ops_checks_to_account on crm.deal_ops_checks;
drop function if exists crm.deal_check_to_account_product();
drop table if exists crm.account_product_events;
drop table if exists crm.account_products;
drop function if exists crm.account_product_track();
alter table crm.ops_catalog drop column if exists sla_days;
alter table crm.products drop column if exists provider_id, drop column if exists legal_entity_id;

drop table if exists crm.quality_snapshots;
drop table if exists crm.quality_rules;

drop table if exists crm.process_memberships;
drop table if exists crm.process_lists;
drop function if exists app.field_usage();
drop index if exists crm.accounts_custom_gin, crm.deals_custom_gin, crm.leads_custom_gin;
delete from crm.settings where key = 'field_approval_sla_days';
drop trigger if exists field_definitions_imported on crm.field_definitions;
drop function if exists crm.field_imported_flag();
drop policy if exists field_definitions_lead_propose on crm.field_definitions;
delete from crm.field_definitions where status <> 'approved';
alter table crm.field_definitions drop constraint if exists field_definitions_proposed_inactive;
-- La marca untrusted es de 0021_events_api: vuelve a decir solo lo que decía antes de este paquete (texto libre).
update crm.field_definitions set untrusted = (data_type = 'text') where untrusted is distinct from (data_type = 'text');
alter table crm.field_definitions
  drop column if exists owner_id, drop column if exists purpose, drop column if exists decision, drop column if exists review_on,
  drop column if exists pii_class, drop column if exists origin, drop column if exists used_by,
  drop column if exists status, drop column if exists proposed_by, drop column if exists proposed_at, drop column if exists decided_by,
  drop column if exists decided_at, drop column if exists decision_note;
alter table crm.field_definitions add column untrusted boolean generated always as (data_type = 'text') stored;

drop policy if exists account_aliases_steward_ins on crm.account_aliases;
drop policy if exists account_aliases_steward_upd on crm.account_aliases;
drop function if exists app.alias_holder(text, text);
alter table crm.account_aliases drop column if exists note, drop column if exists created_by, drop column if exists closed_by;
alter table crm.account_aliases drop constraint if exists account_aliases_system_fkey;
update crm.account_aliases set system = 'other' where system not in ('sales_core','s5','pipedrive','zoho','emida','sky','movilway','other');
alter table crm.account_aliases add constraint account_aliases_system_check
  check (system in ('sales_core','s5','pipedrive','zoho','emida','sky','movilway','other'));
drop table if exists crm.alias_systems;

drop function if exists app.contact_by_phone(text, text);
drop trigger if exists account_contacts_primary_track on crm.account_contacts;
drop function if exists crm.contact_primary_track();
drop table if exists crm.contact_primary_history;
drop index if exists crm.contacts_phone_idx, crm.account_contacts_contact_idx;
alter table crm.account_contacts drop column if exists deal_id, drop column if exists end_reason;

drop trigger if exists accounts_tree_depth on crm.accounts;
drop function if exists crm.account_tree_depth();
update crm.accounts set account_type = 'chain' where account_type = 'region';
delete from crm.account_types where code = 'region';
alter table crm.account_types drop column if exists max_depth;
alter table crm.account_links drop column if exists reason;

drop table if exists crm.merge_events;
drop function if exists app.scan_duplicates(text);
drop table if exists crm.duplicate_pairs;
drop table if exists crm.duplicate_bypasses;
drop function if exists app.duplicate_matches(text, text, text, text, text, text, text, uuid);
drop function if exists app.addr_key(text, text);
drop function if exists app.steward_markets();
drop function if exists app.lead_markets();
