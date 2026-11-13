delete from crm.deal_ops_checks where catalog_id in (select id from crm.ops_catalog where market_code = 'US' and kind = 'document' and code in ('sellers_permit','drivers_license','voided_check','premises_photo'));
delete from crm.ops_catalog where market_code = 'US' and kind = 'document' and code in ('sellers_permit','drivers_license','voided_check','premises_photo');
delete from crm.ops_catalog where market_code = 'US' and kind = 'return_reason'
   and code in ('docs_missing','not_signed','entity_mismatch','duplicate_merchant','merchant_withdrew','docs_expired','data_incomplete','other');

drop index crm.activities_visit_reason_idx;
alter table crm.activities drop column visit_reason;
drop table crm.visit_reasons;

drop table crm.deal_orders;
alter table crm.deal_items drop column discount_pct;

drop trigger deals_sales_rep on crm.deals;
drop function app.deals_sales_rep();
alter table crm.pipelines drop column ops_lead_id;
alter table crm.deals drop column sales_rep_frozen_at, drop column sales_rep_id;

alter table crm.stages drop column highlight_fields;
