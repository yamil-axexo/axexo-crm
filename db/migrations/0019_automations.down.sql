drop trigger leads_escalation_reset on crm.leads;
drop function crm.lead_escalation_reset();
drop function app.people_with_role(text, text, uuid);
drop function app.business_minutes(text, timestamptz, timestamptz);
drop trigger deals_integrity on crm.deals;
drop function crm.deal_integrity();

alter table crm.leads drop column escalated_at, drop column escalation_level;
drop table crm.lead_escalation;

drop index crm.activities_approval_idx;
alter table crm.activities drop column approval_id;
drop table crm.approvals;
drop table crm.deal_evidence;
drop table crm.stage_transitions;

alter table crm.stages drop column sla_hours, drop column rot_days_waiting;
alter table crm.deals drop column waiting_on;

alter table crm.exceptions drop column automation_id;
drop table crm.automation_state;
drop table crm.automation_log;
drop table crm.automations;

delete from crm.settings where key = 'jobs_last_tick';
drop table crm.job_runs;
