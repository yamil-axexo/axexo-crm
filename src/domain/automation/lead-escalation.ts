import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'
import { peopleWithRole } from '@/domain/automation/people'

// LEAD-04: escalamiento del primer contacto. Al vencer la meta sin ningún intento, se le avisa a supervisión; si pasan
// N horas hábiles más sin intento, a quien lidera el mercado. Cada mercado lo enciende y fija sus horas; nace apagado,
// porque la meta se fija con la línea base del propio mercado. El aviso llega como tarea en Hoy, ligada al lead.

export const LEVEL_LABEL: Record<number, { es: string; en: string }> = {
  1: { es: 'Avisado a supervisión', en: 'Supervisor notified' },
  2: { es: 'Avisado a quien lidera', en: 'Market lead notified' },
}

type Due = { id: string; market_code: string; business_name: string; owner_id: string | null; owner_name: string | null; escalation_level: number; level2_hours: number }

async function escalationTask(tx: Tx, sys: Ctx, l: Due, level: number, userId: string): Promise<void> {
  const u = await tx<{ locale: 'es' | 'en' }[]>`select locale from crm.users where id = ${userId}`
  const en = u[0]?.locale === 'en'
  const who = l.owner_name ?? (en ? 'nobody' : 'nadie')
  const subject = (level === 1
    ? (en ? `Lead with no first contact: ${l.business_name}. Owner: ${who}.` : `Lead sin primer contacto: ${l.business_name}. Lo lleva ${who}.`)
    : (en ? `Lead still with no first contact after ${l.level2_hours} more business hours: ${l.business_name}. Owner: ${who}.`
          : `Lead sigue sin primer contacto después de ${l.level2_hours} horas hábiles más: ${l.business_name}. Lo lleva ${who}.`)).slice(0, 200)
  await tx`insert into crm.activities (market_code, lead_id, kind, subject, due_at, owner_id, created_by, source, custom)
           values (${l.market_code}, ${l.id}, 'task', ${subject}, now(), ${userId}, ${sys.user.id}, 'rule', ${tx.json({ lead_escalation: level })})`
}

/** Corre por horario, como sistema. Devuelve cuántos leads subieron de nivel. Correrla dos veces no avisa dos veces. */
export async function escalateLeads(tx: Tx, sys: Ctx): Promise<number> {
  // Lo que ya se atendió (o se cerró) deja de estar escalado: sus avisos pendientes se cierran solos.
  await tx`update crm.activities a set done_at = now(), outcome = 'done'
            where a.done_at is null and a.custom ? 'lead_escalation' and a.lead_id is not null
              and exists (select 1 from crm.leads l where l.id = a.lead_id and (l.first_touch_at is not null or l.status <> 'new'))`
  const due = await tx<Due[]>`
    select l.id, l.market_code, l.business_name, l.owner_id, u.full_name as owner_name, l.escalation_level, e.level2_hours
      from crm.leads l
      join crm.lead_escalation e on e.market_code = l.market_code and e.is_active
      left join crm.users u on u.id = l.owner_id
     where l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now()
       and (l.escalation_level = 0 or (l.escalation_level = 1 and app.business_due(l.market_code, l.sla_due_at, e.level2_hours * 60) < now()))
     order by l.sla_due_at limit 200 for update of l skip locked`
  for (const l of due) {
    const level = l.escalation_level + 1
    let people = await peopleWithRole(tx, l.market_code, level === 1 ? 'supervisor' : 'market_lead', l.owner_id)
    // Un mercado sin supervisión no deja el lead en el aire: el primer aviso sube directo a quien lidera.
    if (people.length === 0 && level === 1) people = await peopleWithRole(tx, l.market_code, 'market_lead', null)
    for (const p of people.filter((x) => x !== l.owner_id)) await escalationTask(tx, sys, l, level, p)
    await tx`update crm.leads set escalation_level = ${level}, escalated_at = now() where id = ${l.id}`
    await audit(tx, sys, 'lead.escalated', 'lead', l.id, l.market_code, { level: l.escalation_level }, { level, people: people.length })
  }
  return due.length
}

/** Encender, apagar o cambiar las horas del segundo aviso de un mercado. */
export async function saveLeadEscalation(ctx: Ctx, market: string, input: { active: boolean; hours: number }): Promise<void> {
  ctx.assert('config.manage')
  ctx.market(market)
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 72) throw invalid('El segundo aviso va de 1 a 72 horas hábiles después del primero.', 'The second notice goes from 1 to 72 business hours after the first.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ is_active: boolean; level2_hours: number }[]>`select is_active, level2_hours from crm.lead_escalation where market_code = ${market} for update`
    await tx`insert into crm.lead_escalation (market_code, is_active, level2_hours, updated_by) values (${market}, ${input.active}, ${input.hours}, ${ctx.user.id})
             on conflict (market_code) do update set is_active = excluded.is_active, level2_hours = excluded.level2_hours, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'routing.escalation_updated', 'routing_rule', null, market, before[0] ? { active: before[0].is_active, hours: before[0].level2_hours } : null, { active: input.active, hours: input.hours })
  })
}
