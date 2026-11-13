-- 0034_ia (down): quita la asistencia por reglas y el marco de AI. Las tareas que se crearon al aceptar sugerencias o aprobar
-- borradores son actividades normales y se quedan.
drop table if exists crm.ia_eval_runs;
drop table if exists crm.ia_eval_cases;
drop table if exists crm.ia_calls;
drop table if exists crm.ia_drafts;
drop table if exists crm.lead_classifications;
drop table if exists crm.lead_score_weights;
drop trigger if exists recommendations_cap on crm.recommendations;
drop table if exists crm.recommendations;
drop function if exists crm.recommendations_cap();
drop table if exists crm.ia_holdouts;
drop table if exists crm.ia_settings;
