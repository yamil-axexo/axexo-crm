-- 0043_ajustes3: tareas guardadas con la clave interna como título (Hoy, "Hacerlo" sobre una sugerencia cuyo texto
-- faltaba en los catálogos). Se reescribe el título con el texto que debió tener, en el idioma del mercado y con el
-- nombre del registro. Solo toca tareas nacidas de una regla cuyo título es exactamente "suggest.<tipo>".
with fix as (
  select a.id, m.default_locale as loc, substr(a.subject, 9) as kind,
         coalesce(ac.name, l.business_name, d.title, '') as name
    from crm.activities a
    join crm.markets m on m.code = a.market_code
    left join crm.accounts ac on ac.id = a.account_id
    left join crm.leads l on l.id = a.lead_id
    left join crm.deals d on d.id = a.deal_id
   where a.source = 'rule' and a.subject ~ '^suggest\.[a-z_]+$'
)
update crm.activities a
   set subject = btrim(case
     when f.loc = 'en' then case f.kind
       when 'lead_no_next_step' then 'Schedule the next task with ' || f.name
       when 'onboarding_no_next_step' then 'Schedule the next onboarding step for ' || f.name
       when 'under_plan' then 'Go over this month’s target with ' || f.name
       when 'perfect_store_low' then 'Visit ' || f.name || ' and complete what is missing'
       when 'competitor_share_loss' then 'Visit ' || f.name || ': a competitor is gaining ground'
       when 'indirect_route' then 'Decide whether ' || f.name || ' goes to a partner'
       when 'data_quality' then 'Fill in the missing data'
       else 'Follow up with ' || f.name end
     else case f.kind
       when 'lead_no_next_step' then 'Agendar la siguiente tarea con ' || f.name
       when 'onboarding_no_next_step' then 'Agendar el siguiente paso del alta de ' || f.name
       when 'under_plan' then 'Revisar la meta del mes con ' || f.name
       when 'perfect_store_low' then 'Visitar ' || f.name || ' y completar lo que falta'
       when 'competitor_share_loss' then 'Visitar ' || f.name || ': la competencia gana espacio'
       when 'indirect_route' then 'Decidir si ' || f.name || ' pasa a un aliado'
       when 'data_quality' then 'Completar los datos que faltan'
       else 'Dar seguimiento a ' || f.name end
   end)
  from fix f
 where a.id = f.id;

-- D2D de México: "Contactada" es "ya se habló con alguien de la tienda" (Ayuda y salida de Prospecto). Pedir quien decide
-- para entrar ahí obligaba a llenar al decisor sin serlo. Quien decide se pide al entrar a "Comprometida" ("quien decide
-- aceptó"). Solo en etapas que nadie editó desde Administración.
update crm.stages s set required_fields = array_remove(s.required_fields, 'decision_maker')
  from crm.pipelines p
 where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'd2d' and s.code = 'interes' and s.edited_at is null;

-- Aviso sin dueño: caía a la primera supervisión del mercado, aunque fuera de otro tipo de venta (la supervisión B2B recibía
-- los negocios de tiendas sin asignar en su Hoy). Ahora prefiere la supervisión cuyo equipo vende ese tipo (embudo del
-- negocio, canal del comercio o tipo del lead); si no hay, sigue la regla de antes.
create or replace function app.exception_fallback_owner_motor(p_market text, p_account uuid, p_motor text, out user_id uuid, out via text)
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
begin
  if p_account is not null then
    select o.user_id, 'territory_owner' into user_id, via
      from crm.accounts a join crm.territory_owners o on o.territory_id = a.territory_id and o.valid_to is null
      join crm.users u on u.id = o.user_id and u.is_active
     where a.id = p_account limit 1;
    if user_id is not null then return; end if;
  end if;
  select m.user_id, m.role into user_id, via
    from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
    left join crm.teams t on t.id = m.team_id
   where m.market_code = p_market and m.role in ('supervisor', 'market_lead') and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
   order by case when m.role = 'supervisor' and p_motor is not null and t.motor = p_motor then 0
                 when m.role = 'supervisor' and (p_motor is null or t.motor is null) then 1
                 when m.role = 'market_lead' then 2 else 3 end, m.created_at, m.id limit 1;
end $$;
revoke execute on function app.exception_fallback_owner_motor(text, uuid, text) from public;

create or replace function app.exception_record_motor(p_account uuid, p_deal uuid, p_lead uuid) returns text
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce((select p.motor from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.id = p_deal),
                  (select l.motor from crm.leads l where l.id = p_lead),
                  (select a.segment from crm.accounts a where a.id = p_account))
$$;
revoke execute on function app.exception_record_motor(uuid, uuid, uuid) from public;

create or replace function crm.exception_route_owner() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r record; v_account uuid;
begin
  if new.owner_id is not null then return new; end if;
  v_account := coalesce(new.account_id, (select d.account_id from crm.deals d where d.id = new.deal_id));
  select * into r from app.exception_fallback_owner_motor(new.market_code, v_account, app.exception_record_motor(v_account, new.deal_id, new.lead_id));
  if r.user_id is not null then
    new.owner_id := r.user_id;
    new.detail := coalesce(new.detail, '{}'::jsonb) || jsonb_build_object('routed_to', r.via);
  end if;
  return new;
end $$;

-- Los abiertos que ya cayeron a la supervisión de otro tipo de venta se vuelven a repartir con la regla nueva.
update crm.exceptions e set owner_id = f.user_id, detail = e.detail || jsonb_build_object('routed_to', f.via)
  from (select x.id, (app.exception_fallback_owner_motor(x.market_code, coalesce(x.account_id, (select d.account_id from crm.deals d where d.id = x.deal_id)),
                        app.exception_record_motor(coalesce(x.account_id, (select d.account_id from crm.deals d where d.id = x.deal_id)), x.deal_id, x.lead_id))).*
          from crm.exceptions x where x.resolved_at is null and x.detail ? 'routed_to' and x.detail ->> 'routed_to' in ('supervisor', 'market_lead')) f
 where f.id = e.id and f.user_id is not null and f.user_id is distinct from e.owner_id;

-- Último contacto con un comercio: lo registrado en CONTIGO (visita, llamada, nota, reunión) y también las visitas que
-- llegan de la Sales App (crm.visits). "Días sin contacto" ignoraba las de la Sales App. Una sola definición para la tarjeta
-- "Antes de la visita", las sugerencias de Asistencia y su medición. Corre con los permisos de quien pregunta.
create or replace function app.last_contact_at(p_account uuid) returns timestamptz
language sql stable set search_path = crm, app, pg_catalog as $$
  select nullif(greatest(
    coalesce((select max(x.done_at) from crm.activities x where x.account_id = p_account and x.done_at is not null and x.kind in ('visit','call','note','meeting')), '-infinity'::timestamptz),
    coalesce((select max(v.checked_in_at) from crm.visits v where v.account_id = p_account), '-infinity'::timestamptz)), '-infinity'::timestamptz)
$$;
grant execute on function app.last_contact_at(uuid) to contigo_app;

-- Documentos de Operaciones: "Vencido" además de Falta, Recibido y Validado ("Documentos vencidos" ya era motivo de
-- devolución, pero no se podía marcar un documento así).
alter table crm.deal_ops_checks drop constraint if exists deal_ops_checks_status_check;
alter table crm.deal_ops_checks add constraint deal_ops_checks_status_check
  check (status in ('pending','sent','approved','rejected','missing','received','validated','expired'));
