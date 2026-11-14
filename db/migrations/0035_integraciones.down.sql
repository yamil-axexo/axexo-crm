-- 0035_integraciones (down): quita lo que agregó el paquete integraciones-migracion.
-- Lo que la reconstrucción creó en tablas de otros paquetes (automatizaciones, turno, reportes y vistas guardadas, plantillas) se borra
-- solo si sigue siendo de fábrica (dueño: el usuario del sistema) y no tiene historia que lo amarre.
drop function if exists crm.pipedrive_rebuild_apply();

delete from crm.automation_state where automation_id in (select id from crm.automations where pipedrive_ref is not null);
delete from crm.automation_log where automation_id in (select id from crm.automations where pipedrive_ref is not null);
update crm.exceptions set automation_id = null where automation_id in (select id from crm.automations where pipedrive_ref is not null);
delete from crm.automations where pipedrive_ref is not null;
delete from crm.saved_reports where id in (select contigo_id from crm.pipedrive_rebuild where contigo_kind = 'saved_report' and contigo_id is not null)
   or (user_id = app.system_user_id() and name like 'MX · %');
delete from crm.saved_views where id in (select contigo_id from crm.pipedrive_rebuild where contigo_kind = 'saved_view' and contigo_id is not null);
delete from crm.routing_rules where pipedrive_ref is not null;
delete from crm.message_templates where key in ('vegas_2026_welcome', 'vegas_2026_followup') and market_code = 'US';

drop table crm.pipedrive_rebuild;
drop table crm.goals;
drop table crm.report_boards;
alter table crm.routing_rules drop column pipedrive_ref, drop column pipeline_id;
alter table crm.automations drop column touched_by_person, drop column off_reason_en, drop column off_reason_es,
  drop column description_en, drop column description_es, drop column pipedrive_ref;
drop table crm.pipedrive_cutover;
drop table crm.import_conflicts;
drop table crm.import_baselines;
