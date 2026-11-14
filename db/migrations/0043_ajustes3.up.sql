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
