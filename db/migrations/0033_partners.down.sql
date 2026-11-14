-- 0033_partners (down). Los comercios promovidos desde una red se quedan; solo pierden la marca de origen nueva.
drop table if exists crm.activity_comms;
drop table if exists crm.network_load_rows;
drop table if exists crm.network_loads;
drop function if exists app.network_load_visible(text, uuid);
update crm.accounts set merchant_origin = null, merchant_origin_at = null where merchant_origin = 'network_conversion';
alter table crm.accounts drop constraint if exists accounts_merchant_origin_check;
alter table crm.accounts add constraint accounts_merchant_origin_check
  check (merchant_origin is null or merchant_origin in ('new_acquisition','emida_conversion'));
drop table if exists crm.partner_overlaps;
drop table if exists crm.partner_enablement;
drop table if exists crm.partner_tier_history;
drop table if exists crm.partner_profiles;
drop table if exists crm.partner_tiers;
drop table if exists crm.plan_milestones;
drop table if exists crm.integration_plans;
drop trigger if exists accounts_partner_unlinked on crm.accounts;
drop function if exists crm.partner_node_unlinked();
drop function if exists app.partner_token_user(text);
drop table if exists crm.partner_tokens;
drop table if exists crm.contracts;
drop table if exists crm.commercial_terms;
drop function if exists app.partner_manager(text);
drop table if exists crm.external_queue;
