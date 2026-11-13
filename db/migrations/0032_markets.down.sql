-- 0032_markets (down): quita lo que agregó la migración. Los campos con una sección propia de mercado quedan sin sección.

drop trigger field_definitions_section on crm.field_definitions;
drop function crm.field_section_check();
update crm.field_definitions set section = null where section is not null and section not in ('qualify','terms','file');
alter table crm.field_definitions add constraint field_definitions_section_check check (section is null or section in ('qualify','terms','file'));
drop table crm.field_sections;

drop function app.account_header(uuid);
drop table crm.ficha_layouts;

drop table crm.whatsapp_windows;
drop table crm.whatsapp_rates;
drop table crm.whatsapp_templates;
drop table crm.whatsapp_accounts;

drop function app.geo_duplicates(uuid, int);
drop function app.accounts_near(numeric, numeric, int, int);
drop function app.distance_m(numeric, numeric, numeric, numeric);
drop table crm.address_formats;
drop index crm.accounts_geo_idx;
drop index crm.accounts_address_trgm;
drop trigger accounts_address on crm.accounts;
drop function crm.account_address_before();
alter table crm.accounts drop constraint accounts_geo_ck;
alter table crm.accounts
  drop column address_line2, drop column sublocality, drop column address_norm,
  drop column geo_source, drop column geo_accuracy_m, drop column geo_at, drop column geo_by;

drop function app.tax_id_matches(text, uuid);
drop table crm.tax_id_verifications;
drop table crm.tax_ids;

drop function app.fx_restamp();
drop trigger deals_fx on crm.deals;
drop function crm.deal_fx_before();
drop function app.fx_at(text, date);
alter table crm.deals
  drop column fx_rate, drop column fx_rate_date, drop column fx_source, drop column amount_usd_minor, drop column fx_frozen_at;

drop table crm.market_holidays;
drop function app.account_timezone(uuid);
drop policy deals_entity on crm.deals;
drop policy accounts_entity on crm.accounts;
drop function app.my_entity_ids();
drop function app.entity_limited_markets();
drop trigger deals_entity on crm.deals;
drop function crm.deal_entity_before();
alter table crm.deals drop column legal_entity_id, drop column business_unit;
drop trigger accounts_entity on crm.accounts;
drop function crm.account_entity_before();
drop index crm.accounts_entity_idx;
alter table crm.accounts alter column legal_entity_id drop not null;
alter table crm.accounts drop column business_unit, drop column timezone;
drop table crm.business_units;
drop function app.default_entity(text);
alter table crm.memberships drop column legal_entity_id;
alter table crm.users drop column legal_entity_id;
drop index crm.legal_entities_name_uq;
drop index crm.legal_entities_default_uq;
-- Las entidades provisionales que nadie usa se van; las que ya tienen comercios se quedan (no se borran datos de negocio).
delete from crm.legal_entities e where e.needs_review and not exists (select 1 from crm.accounts a where a.legal_entity_id = e.id);
alter table crm.legal_entities
  drop column short_name, drop column tax_country, drop column currency, drop column default_locale,
  drop column is_default, drop column needs_review, drop column archived_at;
