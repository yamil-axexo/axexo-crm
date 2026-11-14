drop function app.adoption(timestamptz, timestamptz);
drop index crm.deals_lost_idx;
drop index crm.deals_won_idx;
alter table crm.fx_rates drop column loaded_at, drop column loaded_by;
