drop trigger if exists deals_ops_guard on crm.deals;
drop function if exists app.deals_ops_guard();
drop table if exists crm.notices;
drop table if exists crm.deal_ops_checks;
drop table if exists crm.ops_catalog;
drop function if exists app.ops_markets();
-- Las tareas creadas por próximos pasos quedan como tareas normales.
alter table crm.activities drop column ops_outcome;
drop index if exists crm.activities_deal_step_idx;
alter table crm.activities drop column deal_step;
alter table crm.accounts drop column merchant_ref;
drop index if exists crm.deals_ops_owner_idx;
alter table crm.deals drop constraint deals_training_dated;
alter table crm.deals drop column ops_owner_id, drop column ops_next_step, drop column ops_next_step_due, drop column ops_entered_at,
  drop column training_status, drop column training_on;
revoke delete on crm.deal_items from contigo_app;
drop policy if exists deal_items_del on crm.deal_items;
drop index if exists crm.products_market_idx;
alter table crm.products drop column market_code, drop column unit_price_minor;
alter table crm.stages drop column is_ops;
alter table crm.pipelines drop column multi_open, drop column has_items;
