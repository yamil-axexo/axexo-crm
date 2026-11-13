alter table crm.exceptions drop column if exists rule_key, drop column if exists rule_version;
update crm.exceptions set resolved_at = coalesce(resolved_at, now()), resolution = coalesce(resolution, 'rule_removed') where kind in ('low_balance','under_plan','perfect_store_low');
delete from crm.exceptions where kind in ('low_balance','under_plan','perfect_store_low');
alter table crm.exceptions drop constraint if exists exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event'));

drop function if exists app.claim_holder(text, text);
drop table if exists crm.rep_plans, crm.field_incidents, crm.perfect_store_scores, crm.account_competitors, crm.competitors,
  crm.credit_limit_requests, crm.account_funding, crm.channel_claims, crm.store_priority, crm.attribution_disputes,
  crm.reassignment_plans, crm.seller_profiles, crm.territory_owners, crm.channel_assignments, crm.document_reads,
  crm.onboarding_documents, crm.onboarding_files, crm.onboarding_requirements, crm.field_thresholds;

revoke update (reason) on crm.account_attributions from contigo_app;
alter table crm.account_attributions drop constraint if exists account_attributions_no_overlap;
alter table crm.account_attributions drop constraint if exists account_attributions_origin_kind;
alter table crm.account_attributions drop column if exists origin_kind, drop column if exists correction_of, drop column if exists reason;
drop function if exists app.cc_manages(text);
