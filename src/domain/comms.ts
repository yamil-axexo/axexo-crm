import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { toE164 } from '@/lib/format'
import { invalid, notFound } from '@/lib/errors'

/**
 * ACT-03: captura de comunicaciones. Un correo, una reunión o un mensaje de WhatsApp quedan en el hilo de la cuenta como
 * actividad, con su asunto, participantes y resumen. Hoy se registran a mano; la sincronización con Gmail, Google Calendar
 * y WhatsApp por API son adaptadores apagados que escribirían en el mismo modelo (fuente, referencia externa, teléfono E.164).
 * El texto pasa por el mismo escaneo de datos prohibidos que cualquier nota.
 */
type Pair = [es: string, en: string]
export const COMM_CHANNELS = ['email', 'meeting', 'whatsapp'] as const
export type CommChannel = (typeof COMM_CHANNELS)[number]
export const COMM_LABEL: Record<CommChannel, Pair> = { email: ['Correo', 'Email'], meeting: ['Reunión', 'Meeting'], whatsapp: ['WhatsApp', 'WhatsApp'] }
export const DIRECTION_LABEL: Record<'inbound' | 'outbound', Pair> = { inbound: ['Lo mandó el cliente', 'Sent by the client'], outbound: ['Lo mandamos nosotros', 'Sent by us'] }
/** WhatsApp Business deja escribir libre solo dentro de las 24 horas desde el último mensaje del cliente. */
export const WINDOW_HOURS = 24

const input = z.object({
  accountId: z.guid(),
  channel: z.enum(COMM_CHANNELS),
  subject: z.string().trim().min(2).max(200),
  participants: z.string().max(1000).optional().default(''),
  summary: z.string().trim().max(4000).optional().default(''),
  /** AAAA-MM-DDTHH:MM en la hora de quien captura; vacío es ahora. */
  at: z.string().optional().default(''),
  minutes: z.coerce.number().int().min(0).max(600).optional().default(0),
  direction: z.enum(['inbound', 'outbound']).or(z.literal('')).optional().default(''),
  phone: z.string().max(30).optional().default(''),
})
export type CommInput = z.input<typeof input>

/** Registra la comunicación en el hilo: la actividad y su detalle, en una sola transacción. */
export async function captureComm(ctx: Ctx, raw: CommInput, tz = 'UTC'): Promise<string> {
  const p = input.safeParse(raw)
  if (!p.success) throw invalid('Escribe el asunto (2 caracteres o más) y elige el tipo.', 'Write the subject (2 characters or more) and choose the type.')
  const v = p.data
  const participants = v.participants.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30).map((s) => s.slice(0, 160))
  assertNoProhibited(v.subject, v.summary, ...participants)
  if (v.channel === 'whatsapp' && !v.direction) throw invalid('En WhatsApp di quién mandó el mensaje: así se sabe si la ventana de 24 horas está abierta.', 'For WhatsApp, say who sent the message: that is how we know whether the 24-hour window is open.')
  if (v.at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.at)) throw invalid('Revisa la fecha y la hora.', 'Check the date and time.')
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ id: string; market_code: string; phone: string | null }[]>`select id, market_code, phone from crm.accounts where id = ${v.accountId} and archived_at is null`
    const a = acc[0]
    if (!a) throw notFound()
    ctx.assert('activity.write', a.market_code)
    const cc = (await tx<{ phone_cc: string }[]>`select phone_cc from crm.markets where code = ${a.market_code}`)[0]?.phone_cc ?? '+1'
    const phone = v.channel === 'whatsapp' ? (v.phone ? toE164(v.phone, cc) : a.phone) : null
    if (v.channel === 'whatsapp' && v.phone && !phone) throw invalid('Revisa el teléfono de WhatsApp.', 'Check the WhatsApp phone number.')
    const at = v.at ? tx`(${v.at}::timestamp at time zone ${tz})` : tx`now()`
    const when = (await tx<{ t: Date }[]>`select ${at} as t`)[0]!.t
    if (when.getTime() > Date.now() + 5 * 60_000) throw invalid('La comunicación ya tuvo que pasar: la fecha no puede ser futura.', 'The communication must have already happened: the date cannot be in the future.')
    const id = await newId(tx)
    const kind = v.channel === 'whatsapp' ? 'note' : v.channel
    const subject = v.channel === 'whatsapp' ? `WhatsApp: ${v.subject}`.slice(0, 200) : v.subject
    await tx`insert into crm.activities (id, market_code, account_id, kind, subject, body, done_at, owner_id, created_by, source)
             values (${id}, ${a.market_code}, ${a.id}, ${kind}, ${subject}, ${v.summary || null}, ${when}, ${ctx.user.id}, ${ctx.user.id}, 'user')`
    await tx`insert into crm.activity_comms (activity_id, market_code, account_id, channel, direction, participants, occurred_at, ends_at, source, phone_e164, created_by)
             values (${id}, ${a.market_code}, ${a.id}, ${v.channel}, ${v.direction || null}, ${participants}::text[], ${when},
                     ${v.minutes ? new Date(when.getTime() + v.minutes * 60_000) : null}, 'manual', ${phone}, ${ctx.user.id})`
    await audit(tx, ctx, 'activity.comm_captured', 'activity', id, a.market_code, null, { channel: v.channel, direction: v.direction || null, participants: participants.length, source: 'manual' })
    return id
  })
}

export type WindowState = { open: boolean; until: Date | null; lastInbound: Date | null }
/** La ventana de 24 horas de WhatsApp de una cuenta: abierta hasta 24 horas después del último mensaje del cliente. */
export async function whatsappWindow(tx: Tx, accountId: string): Promise<WindowState> {
  const rows = await tx<{ last: Date | null }[]>`
    select max(occurred_at) as last from crm.activity_comms where account_id = ${accountId} and channel = 'whatsapp' and direction = 'inbound'`
  const last = rows[0]?.last ?? null
  if (!last) return { open: false, until: null, lastInbound: null }
  const until = new Date(new Date(last).getTime() + WINDOW_HOURS * 3_600_000)
  return { open: until.getTime() > Date.now(), until, lastInbound: new Date(last) }
}
