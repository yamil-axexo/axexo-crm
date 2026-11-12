-- Integración con 0013 (leads): el lead y el formulario vuelven a guardar el nivel, y el rol vuelve a la lista de 0013.
alter table crm.leads drop constraint leads_contact_role_check;
alter table crm.leads disable trigger user;
update crm.leads set contact_role = case contact_role when 'executive' then 'decision_maker' else 'staff' end
 where contact_role in ('executive','legal','operations');
update crm.leads l set account_type = (select t.kind from crm.account_types t
                                        where t.code = l.account_type and (t.market_code is null or t.market_code = l.market_code)
                                        order by t.market_code nulls last limit 1)
 where l.account_type is not null;
alter table crm.leads enable trigger user;
alter table crm.leads add constraint leads_contact_role_check
  check (contact_role is null or contact_role in ('owner','decision_maker','manager','staff','billing','purchasing','finance','technology'));
drop trigger leads_account_type_check on crm.leads;
drop trigger web_forms_account_type_check on crm.web_forms;
drop function crm.catalog_account_type_check();
update crm.web_forms f set account_type = (select t.kind from crm.account_types t
                                            where t.code = f.account_type and (t.market_code is null or t.market_code = f.market_code)
                                            order by t.market_code nulls last limit 1)
 where f.account_type is not null;
alter table crm.leads rename column account_type to account_kind;
alter table crm.leads add constraint leads_account_kind_check
  check (account_kind is null or account_kind in ('organization','distributor','chain','store'));
alter table crm.web_forms rename column account_type to account_kind;
alter table crm.web_forms add constraint web_forms_account_kind_check
  check (account_kind is null or account_kind in ('organization','distributor','chain','store'));

drop function app.form_fields(text);
alter table crm.web_forms drop column ask_fields;

alter table crm.contacts drop column sms_capable, drop column preferred_locale;
drop index crm.account_contacts_primary_uq;
alter table crm.account_contacts drop column is_primary;
-- Vuelve a la lista que dejó 0013 (leads), que ya tenía compras, finanzas y tecnología.
update crm.account_contacts set role = case role when 'executive' then 'decision_maker' else 'staff' end
 where role in ('executive','legal','operations');
alter table crm.account_contacts drop constraint account_contacts_role_check;
alter table crm.account_contacts add constraint account_contacts_role_check
  check (role in ('owner','decision_maker','manager','staff','billing','purchasing','finance','technology'));

-- Los negocios y leads que usaron un motivo nuevo vuelven a un motivo base antes de borrar el catálogo.
update crm.deals set loss_reason_code = 'not_qualified' where loss_reason_code in (select code from crm.loss_reasons where motors is not null);
update crm.leads set disqualify_code = 'not_qualified' where disqualify_code in (select code from crm.loss_reasons where motors is not null);
delete from crm.loss_reasons where code in ('b2b_integration','b2b_certification','b2b_volume','b2b_integrator','b2b_postponed','store_closed_down',
  'store_no_interest','signup_blocked','other_provider','no_cash_handling','landline_only','product_not_offered','owner_unavailable');
alter table crm.loss_reasons drop column position, drop column motors;

drop trigger deals_pause_guard on crm.deals;
drop function crm.deal_pause_guard();
drop index crm.deals_paused_idx;
alter table crm.deals drop constraint deals_pause_complete,
  drop column pause_review_on, drop column pause_reason, drop column paused_by, drop column paused_at;

update crm.deal_stage_events set cause = 'user' where cause = 'admin';
alter table crm.deal_stage_events drop constraint deal_stage_events_cause_check;
alter table crm.deal_stage_events add constraint deal_stage_events_cause_check check (cause in ('user','transaction','rule','import'));
alter table crm.stages drop column archived_at;

delete from crm.field_definitions where key like 'b2b\_%' and motor = 'b2b' and source = 'manual';
alter table crm.field_definitions drop column in_intake, drop column applies_when, drop column section, drop column motor;

drop trigger accounts_type_sync on crm.accounts;
drop function crm.account_type_sync();
alter table crm.accounts drop column account_type;
drop table crm.account_types;
