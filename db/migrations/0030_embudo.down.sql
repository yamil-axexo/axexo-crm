-- Baja de 0030_embudo.
drop table crm.intake_retries;

drop function app.referral_public(text);
drop table crm.referral_codes;

drop function app.market_lead_of(text);
drop function app.rr_pick(uuid, integer, boolean);
drop function app.open_leads_of(uuid, text);
drop table crm.assignment_log;
drop table crm.assignment_rules;

drop table crm.conversion_events;
drop table crm.source_touches;
drop table crm.lead_labels;
drop index crm.leads_account_idx;
drop index crm.leads_referred_idx;
drop index crm.leads_labels_gin;
alter table crm.leads
  drop constraint leads_labels_check,
  drop column size_units, drop column labels, drop column referred_by_account_id,
  drop column referrer, drop column landing_page, drop column twclid, drop column li_fat_id, drop column ttclid;

drop table crm.ticket_refs;

alter table crm.leads drop constraint leads_disqualify_reason;
alter table crm.activities drop constraint activities_no_sale_reason;
drop table crm.unknown_reason_codes;
drop trigger loss_reasons_version on crm.loss_reasons;
drop function crm.reason_catalog_bump();
drop table crm.catalog_versions;
alter table crm.loss_reasons drop column updated_at;

alter table crm.contacts drop column best_time;

drop table crm.metric_restatements;
drop table crm.milestone_events;
drop table crm.account_milestones;
-- Las correcciones que quedaron en la historia de etapas vuelven a un valor que la restricción anterior admite.
update crm.deal_stage_events set cause = 'admin' where cause = 'correction';
alter table crm.deal_stage_events drop constraint deal_stage_events_cause_check;
alter table crm.deal_stage_events add constraint deal_stage_events_cause_check
  check (cause in ('user', 'transaction', 'rule', 'import', 'admin'));
alter table crm.ingest_batches drop column manifest;

drop trigger deals_stage_gate on crm.deals;
drop function crm.deal_stage_gate();
drop function crm.stage_missing(crm.deals, uuid, boolean);
drop table crm.deal_stage_gaps;
alter table crm.stages drop column conditions;
