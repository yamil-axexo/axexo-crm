import type { Tx } from '@/server/db'
import type { Job } from './types'
import { notify, peopleWithRole, releaseHeld, sendDigests } from '@/domain/notify'

/** Las tareas corren sin persona con sesión: toman la identidad del usuario de sistema si el corredor no la fijó. */
async function systemActor(tx: Tx): Promise<{ user: { id: string } }> {
  const rows = await tx<{ me: string | null; sys: string }[]>`select app.current_user_id() as me, app.system_user_id() as sys`
  const id = rows[0]!.me ?? rows[0]!.sys
  if (!rows[0]!.me) await tx`select set_config('app.user_id', ${id}, true)`
  return { user: { id } }
}

/** E15.F9: la meta de primer contacto venció y nadie lo ha intentado. Avisa una sola vez por lead. */
export async function leadGoalMissed(tx: Tx): Promise<{ done: number; note?: string }> {
  const actor = await systemActor(tx)
  const leads = await tx<{ id: string; market_code: string; owner_id: string | null; business_name: string }[]>`
    select l.id, l.market_code, l.owner_id, l.business_name from crm.leads l
     where l.status = 'new' and l.first_touch_at is null and l.sla_due_at is not null and l.sla_due_at < now()
       and not exists (select 1 from crm.notices n where n.lead_id = l.id and n.kind = 'lead_goal_missed')
     order by l.sla_due_at limit 200`
  let done = 0
  for (const l of leads) {
    // Con dueño, a quien lo lleva. Sin dueño, a quien reparte los leads del mercado.
    const to = l.owner_id ? [l.owner_id] : await peopleWithRole(tx, l.market_code, ['supervisor', 'market_lead'])
    for (const user of to) {
      const r = await notify(tx, actor, {
        to: user, kind: 'lead_goal_missed', market: l.market_code, link: `/leads/${l.id}`, leadId: l.id,
        title: [`Venció la meta de primer contacto: ${l.business_name}`, `The first-contact goal ran out: ${l.business_name}`],
        body: l.owner_id ? ['Sigue sin intento de contacto. Llámalo y registra el resultado.', 'It still has no contact attempt. Call and log the result.']
          : ['Nadie lo ha tomado y la meta ya venció. Asígnalo a alguien.', 'Nobody has taken it and the goal already ran out. Assign it to someone.'],
      })
      if (r.noticeId) done++
    }
  }
  return { done }
}

export const avisosJobs: Job[] = [
  {
    key: 'avisos.lead_goal', everyMinutes: 5,
    description: { es: 'Avisa cuando vence la meta de primer contacto de un lead', en: 'Notifies when a lead’s first-contact goal runs out' },
    run: leadGoalMissed,
  },
  {
    key: 'avisos.release', everyMinutes: 15,
    description: { es: 'Libera los mensajes que esperaban al horario hábil', en: 'Releases messages that were waiting for business hours' },
    run: async (tx) => { await systemActor(tx); return { done: await releaseHeld(tx) } },
  },
  {
    key: 'avisos.digest', everyMinutes: 1440,
    description: { es: 'Arma el resumen diario de avisos por persona', en: 'Builds each person’s daily notice summary' },
    run: async (tx) => { const a = await systemActor(tx); return { done: await sendDigests(tx, a.user.id) } },
  },
]
