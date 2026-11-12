drop function if exists app.search_others(text);
drop function if exists app.hand_lead(uuid, uuid);
drop function if exists app.business_due(text, timestamptz, int);
drop table if exists crm.market_hours;
drop index if exists crm.leads_market_created_idx;
drop index if exists crm.leads_phone_idx;

alter table crm.account_contacts disable trigger user;
update crm.account_contacts set role = 'staff' where role in ('purchasing','finance','technology');
alter table crm.account_contacts enable trigger user;
alter table crm.account_contacts drop constraint if exists account_contacts_role_check;
alter table crm.account_contacts add constraint account_contacts_role_check
  check (role in ('owner','decision_maker','manager','staff','billing'));

alter table crm.leads disable trigger user;
update crm.leads set source = 'manual' where source in ('walk_in','phone_in','event');
alter table crm.leads enable trigger user;
alter table crm.leads drop constraint if exists leads_source_check;
alter table crm.leads add constraint leads_source_check
  check (source in ('web_form','manual','import','referral','sales_app'));

alter table crm.web_forms drop column if exists account_kind;
alter table crm.leads drop column if exists extra_contacts, drop column if exists contact_role, drop column if exists account_kind;
