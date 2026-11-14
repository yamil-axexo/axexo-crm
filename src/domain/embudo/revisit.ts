import 'server-only'
import { resolveContact } from '@/domain/contacts-dedup'
import { z } from 'zod'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { toE164 } from '@/lib/format'
import { scrub } from '@/domain/pipedrive/mapping'
import { plainText } from '@/domain/untrusted'

/**
 * PIPE-05: la revisita a quien decide. Cuando la visita de la Sales App dice "hay que volver", además de marcar el negocio
 * queda una tarea de visita con fecha y con dueño (aunque el comercio no tenga negocio abierto: la revisita no se pierde),
 * y los datos de quien decide (nombre, rol, teléfono y mejor horario) quedan como contacto del comercio. Repetir el mismo
 * evento no duplica ni la tarea ni el contacto.
 */
export const decisionMakerContact = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(['owner', 'decision_maker', 'manager']).default('decision_maker'),
  phone: z.string().trim().max(30).nullable().optional(),
  best_time: z.string().trim().max(120).nullable().optional(),
})
export type DecisionMakerContact = z.infer<typeof decisionMakerContact>

export async function saveDecisionMaker(tx: Tx, sys: Ctx, acc: { id: string; market_code: string }, raw: DecisionMakerContact): Promise<string> {
  const name = scrub(plainText(raw.name)).slice(0, 120)
  const phone = raw.phone ? toE164(raw.phone, sys.market(acc.market_code).phoneCc) : null
  const bestTime = raw.best_time ? scrub(plainText(raw.best_time)).slice(0, 120) : null
  // La misma persona en el mismo comercio (por teléfono, o por nombre si no dejó teléfono) no se duplica: se completa.
  const have = await tx<{ id: string }[]>`
    select c.id from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
     where ac.account_id = ${acc.id} and ac.valid_to is null
       and ((${phone}::text is not null and c.phone = ${phone}) or lower(c.full_name) = lower(${name})) limit 1`
  let contactId = have[0]?.id
  if (contactId) {
    await tx`update crm.contacts set best_time = coalesce(${bestTime}, best_time), phone = coalesce(phone, ${phone}) where id = ${contactId}`
  } else {
    // DAT-02: si el teléfono ya es de otra persona del mercado, la misma detección que en todas las vías.
    contactId = (await resolveContact(tx, sys.user.id, { market: acc.market_code, name, phone, email: null, source: 'sales_app', extra: { bestTime } })).id
    await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id}, ${contactId}, ${acc.market_code}, ${raw.role})`
    await audit(tx, sys, 'contact.added', 'account', acc.id, acc.market_code, null, { contact_id: contactId, role: raw.role, source: 'sales_app' })
  }
  // Los negocios abiertos que todavía no dicen quién decide lo toman de aquí (sin marcar que ya se habló con esa persona).
  await tx`update crm.deals set decision_maker_id = ${contactId} where account_id = ${acc.id} and status = 'open' and decision_maker_id is null`
  return contactId
}

/** La tarea de revisita: una visita por hacer, con fecha y dueño, en el hilo del comercio y en Hoy de quien la lleva. */
export async function ensureRevisitTask(tx: Tx, sys: Ctx, p: { accountId: string; market: string; visitId: string; due: string; reason: string | null; visitorId: string | null }): Promise<string | null> {
  const seen = await tx<{ id: string }[]>`select id from crm.activities where account_id = ${p.accountId} and custom ->> 'revisit_of' = ${p.visitId} limit 1`
  if (seen[0]) return seen[0].id
  const ctxRows = await tx<{ owner_id: string | null; name: string; deal_id: string | null; deal_owner: string | null; locale: string }[]>`
    select a.owner_id, a.name, d.id as deal_id, d.owner_id as deal_owner, mk.default_locale as locale
      from crm.accounts a join crm.markets mk on mk.code = a.market_code
      left join lateral (select id, owner_id from crm.deals where account_id = a.id and status = 'open' order by created_at desc limit 1) d on true
     where a.id = ${p.accountId}`
  const c = ctxRows[0]
  if (!c) return null
  // Dueño: quien lleva el negocio abierto; si no hay negocio, quien lleva el comercio; si tampoco, quien hizo la visita.
  const owner = c.deal_owner ?? c.owner_id ?? p.visitorId
  if (!owner) return null
  // Si ya hay una visita por hacer para ese comercio, esa es la revisita: se le pone la marca y no se crea otra.
  const open = await tx<{ id: string }[]>`select id from crm.activities where account_id = ${p.accountId} and kind = 'visit' and done_at is null order by due_at limit 1`
  if (open[0]) {
    await tx`update crm.activities set custom = custom || ${tx.json({ revisit_of: p.visitId })} where id = ${open[0].id}`
    return open[0].id
  }
  const id = await newId(tx)
  const subject = (c.locale === 'en' ? `Go back to see the decision-maker: ${c.name}` : `Volver a ver a quien decide: ${c.name}`).slice(0, 200)
  await tx`insert into crm.activities (id, market_code, account_id, deal_id, kind, subject, body, due_at, owner_id, created_by, source, custom)
           values (${id}, ${p.market}, ${p.accountId}, ${c.deal_id}, 'visit', ${subject}, ${p.reason}, ${`${p.due}T15:00:00Z`}, ${owner}, ${sys.user.id}, 'sales_app', ${tx.json({ revisit_of: p.visitId })})`
  // ACT-02: en la venta puerta a puerta el próximo paso lo genera la visita: si el negocio no tenía uno vigente, es esta revisita.
  if (c.deal_id) {
    await tx`update crm.deals set next_step = ${subject}, next_step_due = ${p.due}::date
              where id = ${c.deal_id} and (next_step is null or next_step_due is null or next_step_due < ${p.due}::date - 2)`
  }
  await audit(tx, sys, 'activity.revisit_scheduled', 'account', p.accountId, p.market, null, { visit_id: p.visitId, due: p.due, owner_id: owner, deal_id: c.deal_id })
  return id
}
