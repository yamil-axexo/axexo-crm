drop index if exists crm.leads_waiting_idx;
alter table crm.activities drop column if exists outcome;
