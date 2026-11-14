-- 0010_field_work: trabajo de campo. La visita existe en CONTIGO mientras la Sales App no esté conectada.
--
-- 1) "Visita" es un tipo de actividad (requerimientos E12.F1 y E17.F1: la visita es una actividad con fecha en el comercio).
--    Abierta con fecha es una visita por hacer; hecha, lleva su resultado.
-- 2) Resultado de una visita: hubo venta o alta (sale), no hubo (no_sale), hay que volver con quien decide (revisit).
-- 3) Quién visitó, como nombre aparte del dueño (E16.F3): en México los vendedores de calle no son usuarios.
-- 4) Una sola lista de visitas para contar (crm.visit_log): las de la Sales App y las capturadas a mano, con su origen.
--    Cuando la Sales App trae la visita del mismo comercio y el mismo día, la capturada a mano deja de contar.

alter table crm.activities drop constraint activities_kind_check;
alter table crm.activities add constraint activities_kind_check
  check (kind in ('note','call','meeting','task','email','handoff','system','visit'));

alter table crm.activities drop constraint activities_outcome_check;
alter table crm.activities add constraint activities_outcome_check
  check (outcome is null or outcome in ('reached','no_answer','later','done','sale','no_sale','revisit'));

alter table crm.activities add column visited_by text;

-- Los resultados de visita son solo de visitas, y una visita hecha siempre dice cómo terminó.
alter table crm.activities add constraint activities_visit_outcome_check
  check (case when kind = 'visit' then (done_at is null and outcome is null)
                                    or (done_at is not null and outcome is not null and outcome in ('sale','no_sale','revisit'))
              else outcome is null or outcome not in ('sale','no_sale','revisit') end);
alter table crm.activities add constraint activities_visited_by_check
  check (visited_by is null or (kind = 'visit' and char_length(btrim(visited_by)) between 2 and 80));

create index activities_visit_done_idx on crm.activities (done_at) where kind = 'visit' and done_at is not null;
create index activities_visited_by_idx on crm.activities (market_code, visited_by) where visited_by is not null;

-- Visitas que cuentan, con su origen. La vista corre con los permisos de quien consulta (security_invoker):
-- RLS de visitas, actividades y comercios sigue decidiendo qué filas ve cada persona.
-- owner_id es de quién es la cartera: las visitas se cuentan por el dueño del comercio, no por quien fue.
create view crm.visit_log with (security_invoker = true) as
  select v.id, 'sales_app'::text as origin, v.market_code, v.account_id, a.owner_id, v.business_date, v.checked_in_at as visited_at,
         v.outcome, v.revisit, null::text as visited_by
    from crm.visits v
    join crm.accounts a on a.id = v.account_id
  union all
  select x.id, 'manual'::text, x.market_code, x.account_id, coalesce(a.owner_id, x.owner_id), (x.done_at at time zone mk.timezone)::date, x.done_at,
         case x.outcome when 'sale' then 'sale' else 'no_sale' end, x.outcome = 'revisit', x.visited_by
    from crm.activities x
    join crm.markets mk on mk.code = x.market_code
    left join crm.accounts a on a.id = x.account_id
   where x.kind = 'visit' and x.done_at is not null
     and not exists (select 1 from crm.visits s
                      where s.account_id = x.account_id and s.business_date = (x.done_at at time zone mk.timezone)::date);
revoke all on crm.visit_log from public;
grant select on crm.visit_log to contigo_app;

-- Nombres de quienes visitan ya usados en un mercado, para sugerirlos al capturar. Son personas del equipo de calle,
-- no usuarios: quien vende en ese mercado los ve aunque la visita sea de un comercio de otra cartera.
create function app.visitor_names(p_market text) returns table (name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select x.visited_by
    from crm.activities x
   where p_market = any(app.my_markets()) and x.market_code = p_market and x.visited_by is not null
   group by x.visited_by
   order by max(x.created_at) desc
   limit 40
$$;
revoke execute on function app.visitor_names(text) from public;
grant execute on function app.visitor_names(text) to contigo_app;
