import type postgres from 'postgres'

/**
 * Caso de reparto que los datos sintéticos no traen: comercios, negocios, tareas y leads a nombre de una cuenta de servicio,
 * de una persona inactiva y de alguien que ya no vende en el mercado. Todo lleva el prefijo "Reparto" o el correo
 * reparto.*@contigo.test, para poder quitarlo al terminar sin tocar lo demás.
 *
 * MX · Cuenta de servicio (sin rol): 26 comercios (16 en Monterrey, Nuevo León; 10 en Torreón, Coahuila), 6 negocios abiertos con su tarea, 5 leads abiertos.
 * MX · Exvendedora (su rol en MX ya cerró; sigue vendiendo en US): 4 comercios en Saltillo, Coahuila.
 * US · Persona inactiva (su rol sigue abierto, pero la persona está inactiva): 9 comercios en Tampa, FL, con 9 negocios abiertos, y 3 leads abiertos.
 */
export const REPARTO = { casaMx: 26, casaMonterrey: 16, casaTorreon: 10, casaDeals: 6, casaLeads: 5, exMx: 4, salioUs: 9, salioLeads: 3 } as const

type Sql = postgres.Sql

export async function seedReparto(sql: Sql): Promise<{ casa: string; salio: string; exmx: string }> {
  await cleanReparto(sql)
  const [ids] = await sql<{ casa: string; salio: string; exmx: string }[]>`
    select md5('contigo:reparto.casa')::uuid as casa, md5('contigo:reparto.salio')::uuid as salio, md5('contigo:reparto.exmx')::uuid as exmx`
  const { casa, salio, exmx } = ids!
  await sql`insert into crm.users (id, email, full_name, locale, is_active, is_synthetic) values
    (${casa}, 'reparto.casa@contigo.test', 'Cuenta de servicio (sintética)', 'es', true, true),
    (${salio}, 'reparto.salio@contigo.test', 'Persona inactiva (sintética)', 'en', false, true),
    (${exmx}, 'reparto.exmx@contigo.test', 'Exvendedora MX (sintética)', 'es', true, true)`
  await sql`insert into crm.memberships (user_id, market_code, role, valid_from, valid_to) values
    (${salio}, 'US', 'rep', now() - interval '300 days', null),
    (${exmx}, 'MX', 'rep', now() - interval '300 days', now() - interval '10 days'),
    (${exmx}, 'US', 'rep', now() - interval '9 days', null)`
  await sql`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country, created_at)
    select 'MX', 'store', 'Reparto Abarrotes ' || lpad(n::text, 2, '0'), 'd2d', case when n % 2 = 0 then 'active' else 'prospect' end, ${casa},
           case when n <= 16 then 'Monterrey' else 'Torreón' end, case when n <= 16 then 'Nuevo León' else 'Coahuila' end, 'MX', now() - interval '90 days'
      from generate_series(1, ${REPARTO.casaMx}) n`
  await sql`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country, created_at)
    select 'MX', 'store', 'Reparto Exvendedora ' || lpad(n::text, 2, '0'), 'd2d', 'active', ${exmx}, 'Saltillo', 'Coahuila', 'MX', now() - interval '90 days'
      from generate_series(1, ${REPARTO.exMx}) n`
  await sql`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country, created_at)
    select 'US', 'store', 'Reparto Wireless ' || lpad(n::text, 2, '0'), 'dealer', 'active', ${salio}, 'Tampa', 'FL', 'US', now() - interval '90 days'
      from generate_series(1, ${REPARTO.salioUs}) n`
  // Negocios abiertos con próximo paso vigente y su tarea: lo que se va con el comercio al repartir.
  await sql`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
    select a.market_code, md5('contigo:p-mx-d2d')::uuid, md5('contigo:s-mx-d2d-visitada')::uuid, a.id, a.owner_id, 'Alta: ' || a.name, 'MXN', 'Visitar la tienda',
           (now() at time zone 'America/Mexico_City')::date + 5, a.owner_id
      from crm.accounts a where a.name like 'Reparto Abarrotes %' and right(a.name, 2)::int <= ${REPARTO.casaDeals}`
  await sql`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
    select a.market_code, md5('contigo:p-us-dealer')::uuid, md5('contigo:s-us-dealer-qualified')::uuid, a.id, a.owner_id, 'Onboarding: ' || a.name, 'USD', 'Visit the store',
           (now() at time zone 'America/New_York')::date + 5, a.owner_id
      from crm.accounts a where a.name like 'Reparto Wireless %'`
  await sql`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by)
    select d.market_code, d.account_id, d.id, 'task', d.next_step, now() + interval '5 days', d.owner_id, d.owner_id
      from crm.deals d join crm.accounts a on a.id = d.account_id where a.name like 'Reparto %'`
  await sql`insert into crm.leads (market_code, source, motor, business_name, contact_name, email, locality, status, owner_id, assigned_at)
    select 'MX', 'import', 'd2d', 'Reparto Lead Tienda ' || lpad(n::text, 2, '0'), 'Contacto de prueba', 'reparto.lead' || n || '@contigo.test', 'Monterrey', 'new', ${casa}, now() - interval '30 days'
      from generate_series(1, ${REPARTO.casaLeads}) n`
  await sql`insert into crm.leads (market_code, source, motor, business_name, contact_name, email, locality, status, owner_id, assigned_at)
    select 'US', 'import', 'dealer', 'Reparto Lead Store ' || lpad(n::text, 2, '0'), 'Test contact', 'reparto.uslead' || n || '@contigo.test', 'Tampa', 'new', ${salio}, now() - interval '30 days'
      from generate_series(1, ${REPARTO.salioLeads}) n`
  return { casa, salio, exmx }
}

/** Quita todo lo que dejó el caso de reparto (y lo que las pruebas crearon con el mismo prefijo). */
export async function cleanReparto(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`create temp table _r_acc on commit drop as select id from crm.accounts where name like 'Reparto %'`
    await tx`create temp table _r_lead on commit drop as select id from crm.leads where business_name like 'Reparto %'`
    await tx`create temp table _r_deal on commit drop as select id from crm.deals where account_id in (select id from _r_acc)`
    await tx`create temp table _r_user on commit drop as select id from crm.users where email like 'reparto.%@contigo.test'`
    await tx`delete from crm.exceptions where account_id in (select id from _r_acc) or deal_id in (select id from _r_deal) or lead_id in (select id from _r_lead)`
    await tx`delete from crm.activities where account_id in (select id from _r_acc) or deal_id in (select id from _r_deal) or lead_id in (select id from _r_lead)`
    await tx`delete from crm.deal_stage_events where deal_id in (select id from _r_deal)`
    await tx`delete from crm.deals where id in (select id from _r_deal)`
    await tx`delete from crm.leads where id in (select id from _r_lead)`
    await tx`delete from crm.account_attributions where account_id in (select id from _r_acc)`
    await tx`delete from crm.account_links where child_id in (select id from _r_acc)`
    await tx`delete from crm.accounts where id in (select id from _r_acc)`
    await tx`delete from crm.user_territories where user_id in (select id from _r_user) or territory_id in (select id from crm.territories where name like 'Reparto %')`
    await tx`delete from crm.territories where name like 'Reparto %'`
    await tx`delete from crm.memberships where user_id in (select id from _r_user)`
    await tx`delete from crm.user_onboarding where user_id in (select id from _r_user)`
    await tx`delete from crm.users where id in (select id from _r_user)`
  })
}
