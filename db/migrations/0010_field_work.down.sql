drop function if exists app.visitor_names(text);
drop view if exists crm.visit_log;
drop index if exists crm.activities_visited_by_idx;
drop index if exists crm.activities_visit_done_idx;
alter table crm.activities drop constraint if exists activities_visited_by_check;
alter table crm.activities drop constraint if exists activities_visit_outcome_check;

-- Lo capturado como visita no se borra: vuelve a ser una reunión (como antes de esta migración) y conserva en el texto
-- cómo terminó y quién fue. Una visita por hacer vuelve a ser una tarea.
update crm.activities
   set body = nullif(concat_ws(E'\n', body,
                case outcome when 'sale' then 'Visita: hubo venta o alta' when 'no_sale' then 'Visita: no hubo venta' when 'revisit' then 'Visita: volver con quien decide' end,
                case when visited_by is not null then 'Visitó: ' || visited_by end), ''),
       type_label = coalesce(type_label, 'Visit'),
       kind = case when done_at is null then 'task' else 'meeting' end,
       outcome = null
 where kind = 'visit';

alter table crm.activities drop column if exists visited_by;
alter table crm.activities drop constraint activities_outcome_check;
alter table crm.activities add constraint activities_outcome_check
  check (outcome is null or outcome in ('reached', 'no_answer', 'later', 'done'));
alter table crm.activities drop constraint activities_kind_check;
alter table crm.activities add constraint activities_kind_check
  check (kind in ('note','call','meeting','task','email','handoff','system'));
