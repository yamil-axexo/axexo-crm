-- 0031_us_ficha (down). Los tipos de cuenta de US vuelven al catálogo general antes de quitarlos.
drop function if exists crm.dealer_record_setup(text, boolean);
drop trigger if exists account_aliases_us_origin on crm.account_aliases;
drop function if exists crm.alias_sets_origin();
drop trigger if exists accounts_us_recruiter_to_deals on crm.accounts;
drop function if exists crm.account_recruiter_to_deals();
drop trigger if exists deals_us_recruiter on crm.deals;
drop function if exists crm.deal_recruiter();
drop trigger if exists accounts_us_dealer_record on crm.accounts;
drop function if exists crm.account_dealer_record();

update crm.accounts a set account_type = case a.kind when 'store' then case when a.parent_id is null then 'store' else 'branch' end
                                                     when 'chain' then 'chain' when 'distributor' then 'distributor' else 'corporate' end
 where a.account_type in ('dealer','isp','master_agent','carrier','tsp','vendor')
   and exists (select 1 from crm.account_types t where t.code = a.account_type and t.market_code = a.market_code);
update crm.leads l set account_type = null where l.account_type in ('dealer','isp','master_agent','carrier','tsp','vendor')
   and not exists (select 1 from crm.account_types t where t.code = l.account_type and t.market_code is null);
delete from crm.account_types t where t.market_code is not null and t.code in ('dealer','isp','master_agent','carrier','tsp','vendor');
update crm.markets set flags = flags - 'dealer_record';

alter table crm.account_products drop column carrier_ref, drop column kit_sent_on, drop column sims_ordered, drop column training_on;
alter table crm.ops_catalog drop column ref_label;
drop index if exists crm.deals_recruiter_idx;
alter table crm.deals drop column recruited_by, drop column recruited_agency_id;
drop index if exists crm.accounts_recruiter_idx;
alter table crm.accounts drop constraint accounts_recruiter_shape;
alter table crm.accounts drop column site_ref, drop column business_type, drop column merchant_origin, drop column merchant_origin_at,
  drop column recruited_by, drop column recruited_agency_id, drop column recruited_at, drop column retired_carriers;
drop table crm.agencies;
drop table crm.business_types;
alter table crm.account_types drop column takes_business_type;
-- Los territorios y los carriers que cargó la configuración se quedan: pueden tener comercios y solicitudes.
