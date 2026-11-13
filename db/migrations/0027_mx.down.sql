-- 0027_mx (down): quita lo que agregó el paquete mx. Las etapas que la plantilla renombró conservan su nombre nuevo
-- (son datos de configuración que administración edita); las dos etapas que agregó (NDA y Contrato) se archivan si
-- tienen negocios y se borran si no.

drop policy rollout_key_people_del on crm.rollout_key_people;
drop policy rollout_key_people_ins on crm.rollout_key_people;
drop policy rollout_key_people_read on crm.rollout_key_people;
drop policy rollout_steps_upd on crm.rollout_steps;
drop policy rollout_steps_ins on crm.rollout_steps;
drop policy rollout_steps_read on crm.rollout_steps;
drop policy market_rollout_upd on crm.market_rollout;
drop policy market_rollout_ins on crm.market_rollout;
drop policy market_rollout_read on crm.market_rollout;
drop trigger memberships_rollout_guard on crm.memberships;
drop function crm.membership_rollout_guard();
drop table crm.rollout_steps;
drop table crm.rollout_key_people;
drop table crm.market_rollout;
drop function app.rollout_people(text);
drop function app.lead_markets();

drop table crm.sheet_rows;
drop table crm.sheet_loads;
drop function app.manage_markets();

drop function crm.apply_mx_stage_template();
update crm.stages s set required_fields = array_remove(array_remove(required_fields, 'field:b2b_nda_signed_on'), 'field:b2b_contract_signed_on')
 where required_fields && '{field:b2b_nda_signed_on,field:b2b_contract_signed_on}'::text[];
update crm.stages s set archived_at = coalesce(archived_at, now())
 where s.code in ('nda', 'contrato') and exists (select 1 from crm.pipelines p where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'b2b')
   and (exists (select 1 from crm.deals d where d.stage_id = s.id)
        or exists (select 1 from crm.deal_stage_events e where e.to_stage_id = s.id or e.from_stage_id = s.id));
delete from crm.stages s
 where s.code in ('nda', 'contrato') and s.archived_at is null
   and exists (select 1 from crm.pipelines p where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'b2b');
delete from crm.field_definitions where object = 'deal' and market_code = 'MX' and key in ('b2b_nda_signed_on', 'b2b_contract_signed_on');
alter table crm.pipelines drop column txn_also_wins;

drop trigger accounts_territory_owner on crm.accounts;
drop function crm.account_territory_owner();
drop function app.apply_territory_owner(uuid);
drop index crm.territories_manager_idx;
alter table crm.territories drop column manager_id;

drop trigger market_hours_sla_sync on crm.market_hours;
drop function crm.market_hours_sla_sync();
drop trigger routing_rules_sla_sync on crm.routing_rules;
drop function crm.routing_sla_sync();
drop function app.business_day_minutes(text);
alter table crm.routing_rules drop column sla_business_days;

drop function app.store_count(jsonb);
drop function app.form_offer_types(text);

-- Los leads de campaña vuelven a "Formulario web" antes de quitar el origen de la lista.
alter table crm.leads disable trigger user;
update crm.leads set source = 'web_form' where source = 'web_campaign';
alter table crm.leads enable trigger user;
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conrelid = 'crm.leads'::regclass and conname = 'leads_source_check';
  if def is not null and position('web_campaign' in def) > 0 then
    def := replace(def, ', ''web_campaign''::text', '');
    execute 'alter table crm.leads drop constraint leads_source_check';
    execute 'alter table crm.leads add constraint leads_source_check ' || def;
  end if;
end $$;
drop index crm.leads_type_idx;
drop index crm.leads_funnel_idx;
alter table crm.leads drop column channel_id, drop column funnel;
alter table crm.web_forms drop column offer_types, drop column is_campaign, drop column channel_id, drop column funnel;
