import type { Tx } from '@/server/db'
import type { RawCapture } from '@/server/adapters/partners'
import type { InboundWa } from '@/server/adapters/live/messaging'

/**
 * ACT-03: ingesta de la captura (Gmail, Google Calendar y WhatsApp). Regla: se liga SOLO a comercios con un contacto
 * conocido (por correo o por teléfono); lo demás se descarta sin guardar nada. Solo se guardan metadatos (asunto, quién,
 * cuándo); nunca el cuerpo del correo ni el texto del mensaje. Cada pieza entra una sola vez (fuente + referencia externa).
 * Corre con la identidad de sistema (tarea programada o webhook).
 */
export type IngestResult = { linked: number; discarded: number; duplicates: number }

async function accountsByEmail(tx: Tx, emails: string[]): Promise<{ account_id: string; market_code: string }[]> {
  if (emails.length === 0) return []
  return tx<{ account_id: string; market_code: string }[]>`
    select distinct ac.account_id, a.market_code from crm.contacts c
      join crm.account_contacts ac on ac.contact_id = c.id and ac.valid_to is null
      join crm.accounts a on a.id = ac.account_id and a.archived_at is null
     where lower(c.email::text) = any(${emails.map((e) => e.toLowerCase())}::text[])
     limit 5`
}
async function accountsByPhone(tx: Tx, phone: string): Promise<{ account_id: string; market_code: string }[]> {
  return tx<{ account_id: string; market_code: string }[]>`
    select distinct x.account_id, x.market_code from (
      select ac.account_id, a.market_code from crm.contacts c join crm.account_contacts ac on ac.contact_id = c.id and ac.valid_to is null
        join crm.accounts a on a.id = ac.account_id and a.archived_at is null where c.phone = ${phone}
      union
      select a.id, a.market_code from crm.accounts a where a.phone = ${phone} and a.archived_at is null) x
     limit 5`
}

async function insertComm(tx: Tx, systemId: string, p: { accountId: string; market: string; channel: 'email' | 'meeting' | 'whatsapp'; kind: 'email' | 'meeting' | 'note'; subject: string; direction: 'inbound' | 'outbound' | null; participants: string[]; at: string; endsAt: string | null; source: 'gmail' | 'calendar' | 'whatsapp_api'; ref: string; phone: string | null; ownerId: string | null }): Promise<boolean> {
  const dup = await tx`select 1 from crm.activity_comms where source = ${p.source} and external_ref = ${`${p.ref}#${p.accountId}`.slice(0, 200)}`
  if (dup.length) return false
  const id = (await tx<{ id: string }[]>`select app.uuid_v7() as id`)[0]!.id
  await tx`insert into crm.activities (id, market_code, account_id, kind, subject, done_at, owner_id, created_by, source)
           values (${id}, ${p.market}, ${p.accountId}, ${p.kind}, ${p.subject.slice(0, 200) || '(sin asunto)'}, ${p.at}, ${p.ownerId}, ${systemId}, 'capture')`
  await tx`insert into crm.activity_comms (activity_id, market_code, account_id, channel, direction, participants, occurred_at, ends_at, source, external_ref, phone_e164, created_by)
           values (${id}, ${p.market}, ${p.accountId}, ${p.channel}, ${p.direction}, ${p.participants.slice(0, 30).map((x) => x.slice(0, 160))}::text[], ${p.at}, ${p.endsAt}, ${p.source}, ${`${p.ref}#${p.accountId}`.slice(0, 200)}, ${p.phone}, ${systemId})`
  return true
}

/** Correos y reuniones leídos de los buzones encendidos. `owners`: correo del buzón -> persona de CONTIGO. */
export async function ingestMailAndMeetings(tx: Tx, systemId: string, items: RawCapture[], owners: Map<string, string>): Promise<IngestResult> {
  const out: IngestResult = { linked: 0, discarded: 0, duplicates: 0 }
  for (const it of items) {
    const accounts = await accountsByEmail(tx, it.participants)
    if (accounts.length === 0) {
      out.discarded++
      continue
    }
    for (const a of accounts) {
      const ok = await insertComm(tx, systemId, {
        accountId: a.account_id, market: a.market_code, channel: it.source === 'gmail' ? 'email' : 'meeting', kind: it.source === 'gmail' ? 'email' : 'meeting',
        subject: it.subject, direction: it.direction, participants: it.participants, at: it.occurredAt, endsAt: it.endsAt, source: it.source, ref: it.externalRef, phone: null, ownerId: owners.get(it.mailbox.toLowerCase()) ?? null,
      })
      if (ok) out.linked++
      else out.duplicates++
    }
  }
  return out
}

/** Mensajes entrantes de WhatsApp (webhook): se ligan por teléfono; abren la ventana de 24 horas del comercio. */
export async function ingestWhatsapp(tx: Tx, systemId: string, msgs: InboundWa[]): Promise<IngestResult> {
  const out: IngestResult = { linked: 0, discarded: 0, duplicates: 0 }
  for (const m of msgs) {
    const accounts = await accountsByPhone(tx, m.from)
    if (accounts.length === 0) {
      out.discarded++
      continue
    }
    for (const a of accounts) {
      const ok = await insertComm(tx, systemId, { accountId: a.account_id, market: a.market_code, channel: 'whatsapp', kind: 'note', subject: `WhatsApp: mensaje del comercio (${m.type})`, direction: 'inbound', participants: [m.from], at: m.timestamp, endsAt: null, source: 'whatsapp_api', ref: m.id, phone: m.from, ownerId: null })
      if (ok) out.linked++
      else out.duplicates++
    }
  }
  return out
}
