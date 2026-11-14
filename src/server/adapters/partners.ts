import 'server-only'
import { gate, type ConnectorMode, type GateSpec } from './live/gate'
import { GOOGLE_SA, calendarEvents, gmailMetadata } from './live/google'
import { SUPABASE_ADMIN, inviteExternal } from './live/supabase'
import { esignProvider } from './live/providers'
import { errorCode } from './live/http'

/**
 * Adaptadores del paquete partners-contratos. Todos construidos y APAGADOS: no llaman a nada y la operación queda en
 * crm.external_queue con estado "Canal apagado". `simulated` solo vale con APP_ENV=test y anota lo que habría salido.
 * Encender cualquiera pasa primero por la revisión de tecnología (Dan Mulligan o Michael Essiet).
 */
type Mode = ConnectorMode
type Pair = [es: string, en: string]
const g = globalThis as unknown as { __contigoPartnerCalls?: { adapter: string; payload: Record<string, unknown> }[] }
/** Lo que los adaptadores simulados habrían hecho en este proceso (solo pruebas). */
export const simulatedPartnerCalls = () => (g.__contigoPartnerCalls ??= [])
export type ExternalState = 'channel_off' | 'simulated' | 'sent' | 'failed'
const record = (adapter: string, payload: Record<string, unknown>, mode: Mode): 'channel_off' | 'simulated' => {
  if (mode !== 'simulated') return 'channel_off'
  simulatedPartnerCalls().push({ adapter, payload })
  return 'simulated'
}

export const ESIGN_ENV = 'CONTIGO_ESIGN_ADAPTER'
export const EXTERNAL_IDENTITY_ENV = 'CONTIGO_EXTERNAL_IDENTITY_ADAPTER'
export const GMAIL_ENV = 'CONTIGO_GMAIL_CAPTURE_ADAPTER'
export const CALENDAR_ENV = 'CONTIGO_CALENDAR_CAPTURE_ADAPTER'
export const WHATSAPP_CAPTURE_ENV = 'CONTIGO_WHATSAPP_CAPTURE_ADAPTER'

export const PARTNER_GATES: Record<'esign' | 'external_identity' | 'gmail' | 'calendar' | 'whatsapp_capture', GateSpec> = {
  esign: { envVar: ESIGN_ENV, credentials: ['DROPBOX_SIGN_API_KEY'] },
  external_identity: { envVar: EXTERNAL_IDENTITY_ENV, credentials: [...SUPABASE_ADMIN] },
  gmail: { envVar: GMAIL_ENV, credentials: [...GOOGLE_SA] },
  calendar: { envVar: CALENDAR_ENV, credentials: [...GOOGLE_SA] },
  whatsapp_capture: { envVar: WHATSAPP_CAPTURE_ENV, credentials: ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] },
}
const modeOf = (key: keyof typeof PARTNER_GATES): Mode => gate(PARTNER_GATES[key]).mode

/** Firma electrónica (comprada, no propia): interfaz genérica, proveedor de referencia Dropbox Sign. Pide la firma de un contrato. */
export type SignatureInput = { contractId: string; title?: string; signerEmail?: string; signerName?: string; documentUrl?: string }
export const esignAdapter = () => {
  const mode = modeOf('esign')
  return {
    mode,
    envVar: ESIGN_ENV,
    requestSignature: async (p: SignatureInput): Promise<ExternalState> => {
      if (mode !== 'live') return record('esign', { contractId: p.contractId }, mode)
      if (!p.signerEmail || !p.signerName || !p.documentUrl) return 'failed'
      try {
        await esignProvider().send({ contractId: p.contractId, title: p.title ?? 'Contrato', signerEmail: p.signerEmail, signerName: p.signerName, documentUrl: p.documentUrl })
        return 'sent'
      } catch {
        return 'failed'
      }
    },
  }
}
/** Identidad de usuarios externos (partners y clientes): invitación por enlace de Supabase Auth a quien no es de los dominios admitidos. */
export const externalIdentityAdapter = () => {
  const mode = modeOf('external_identity')
  return {
    mode,
    envVar: EXTERNAL_IDENTITY_ENV,
    invite: async (p: { accountId: string; email?: string | null; redirectTo?: string | null }): Promise<ExternalState> => {
      if (mode !== 'live') return record('external_identity', { accountId: p.accountId }, mode)
      if (!p.email) return 'failed'
      try {
        await inviteExternal(p.email, { account_id: p.accountId, kind: 'external' }, p.redirectTo ?? null)
        return 'sent'
      } catch {
        return 'failed'
      }
    },
  }
}
/**
 * Captura de correo y calendario (Gmail y Google Calendar API, solo lectura y solo metadatos) y de WhatsApp (webhook entrante).
 * Sincronizan hacia el hilo, nunca de afuera hacia los contactos, y solo con contactos conocidos (src/domain/conectores/capture.ts).
 * Apagadas: no leen nada. `pull` lee los buzones que se le pasan (los que su dueño encendió) desde `since`.
 */
export type CapturedMessage = { accountId: string; channel: 'email' | 'meeting' | 'whatsapp'; externalRef: string; subject: string; participants: string[]; occurredAt: string; direction?: 'inbound' | 'outbound'; phone?: string }
export type RawCapture = { source: 'gmail' | 'calendar'; mailbox: string; externalRef: string; subject: string; participants: string[]; occurredAt: string; endsAt: string | null; direction: 'inbound' | 'outbound' | null }
type CaptureAdapter = { mode: Mode; envVar: string; pull: (mailboxes?: string[], since?: Date) => Promise<RawCapture[]>; error?: string }
const g2 = globalThis as unknown as { __contigoSimulatedCapture?: RawCapture[] }
/** Solo pruebas: lo que la captura simulada entrega en la próxima lectura. */
export const simulatedCaptures = () => (g2.__contigoSimulatedCapture ??= [])
export const gmailCaptureAdapter = (): CaptureAdapter => {
  const mode = modeOf('gmail')
  return {
    mode, envVar: GMAIL_ENV,
    pull: async (mailboxes = [], since = new Date(Date.now() - 86_400_000)) => {
      if (mode === 'simulated') return simulatedCaptures().filter((c) => c.source === 'gmail').splice(0)
      if (mode !== 'live') return []
      const out: RawCapture[] = []
      for (const mb of mailboxes) {
        for (const m of await gmailMetadata(mb, Math.floor(since.getTime() / 1000))) {
          const outbound = m.from.includes(mb.toLowerCase())
          out.push({ source: 'gmail', mailbox: mb, externalRef: `${mb}:${m.id}`.slice(0, 200), subject: m.subject, participants: [...new Set([...m.from, ...m.to])].filter((x) => x !== mb.toLowerCase()), occurredAt: m.date, endsAt: null, direction: outbound ? 'outbound' : 'inbound' })
        }
      }
      return out
    },
  }
}
export const calendarCaptureAdapter = (): CaptureAdapter => {
  const mode = modeOf('calendar')
  return {
    mode, envVar: CALENDAR_ENV,
    pull: async (mailboxes = [], since = new Date(Date.now() - 86_400_000)) => {
      if (mode === 'simulated') return simulatedCaptures().filter((c) => c.source === 'calendar').splice(0)
      if (mode !== 'live') return []
      const out: RawCapture[] = []
      const until = new Date().toISOString()
      for (const mb of mailboxes) {
        for (const e of await calendarEvents(mb, since.toISOString(), until)) {
          out.push({ source: 'calendar', mailbox: mb, externalRef: `${mb}:${e.id}`.slice(0, 200), subject: e.summary, participants: e.attendees.filter((x) => x !== mb.toLowerCase()), occurredAt: e.start, endsAt: e.end, direction: null })
        }
      }
      return out
    },
  }
}
/** WhatsApp entra por el webhook (/api/webhooks/whatsapp), no por lectura: `pull` no trae nada. */
export const whatsappCaptureAdapter = (): CaptureAdapter => ({ mode: modeOf('whatsapp_capture'), envVar: WHATSAPP_CAPTURE_ENV, pull: async () => [] })
export const captureError = errorCode

/** Para "Estado de CONTIGO": cada adaptador del paquete, si está apagado y qué falta para encenderlo. */
export function partnersAdapterStatus(): { key: string; name: Pair; what: Pair; mode: Mode; envVar: string; needs: Pair }[] {
  return [
    {
      key: 'esign', name: ['Firma electrónica de contratos', 'Electronic signature for contracts'], what: ['Manda el contrato a firmar y recibe la firma', 'Sends the contract for signature and receives it'], mode: esignAdapter().mode, envVar: ESIGN_ENV,
      needs: ['Mientras tanto "firmado" se marca a mano con fecha, quién firmó y el enlace al documento. Falta: elegir y comprar el proveedor de firma y su aprobación en la revisión de tecnología.', 'Meanwhile "signed" is marked by hand with the date, who signed and the document link. Missing: choosing and buying the signature provider and its technology review approval.'],
    },
    {
      key: 'external_identity', name: ['Entrada de usuarios externos (partners y clientes)', 'Sign-in for external users (partners and clients)'], what: ['El portal de partners y el plan compartido con el cliente', 'The partner portal and the plan shared with the client'], mode: externalIdentityAdapter().mode, envVar: EXTERNAL_IDENTITY_ENV,
      needs: ['El rol de partner ya funciona por subárbol y el token de lectura ya sirve. Falta: decidir cómo entran las personas de afuera (identidad, alta y baja) y su aprobación en la revisión de tecnología.', 'The partner role already works by subtree and the read token already works. Missing: deciding how outside people sign in (identity, onboarding and removal) and its technology review approval.'],
    },
    {
      key: 'gmail', name: ['Captura de correos (Gmail)', 'Email capture (Gmail)'], what: ['Correos con contactos conocidos al hilo de la cuenta', 'Emails with known contacts into the account thread'], mode: gmailCaptureAdapter().mode, envVar: GMAIL_ENV,
      needs: ['Mientras tanto el correo se registra a mano en el hilo. Falta: acceso de solo lectura con alcance mínimo, monitoreo del acceso y su aprobación en la revisión de tecnología.', 'Meanwhile the email is logged by hand in the thread. Missing: read-only access with minimum scope, access monitoring and its technology review approval.'],
    },
    {
      key: 'calendar', name: ['Captura de reuniones (Google Calendar)', 'Meeting capture (Google Calendar)'], what: ['Reuniones con contactos conocidos al hilo de la cuenta', 'Meetings with known contacts into the account thread'], mode: calendarCaptureAdapter().mode, envVar: CALENDAR_ENV,
      needs: ['Mientras tanto la reunión se registra a mano en el hilo. Falta: acceso de solo lectura con alcance mínimo, monitoreo del acceso y su aprobación en la revisión de tecnología.', 'Meanwhile the meeting is logged by hand in the thread. Missing: read-only access with minimum scope, access monitoring and its technology review approval.'],
    },
    {
      key: 'whatsapp_capture', name: ['Captura de WhatsApp', 'WhatsApp capture'], what: ['Mensajes ligados por teléfono al hilo, con la ventana de 24 horas', 'Messages linked by phone to the thread, with the 24-hour window'], mode: whatsappCaptureAdapter().mode, envVar: WHATSAPP_CAPTURE_ENV,
      needs: ['Mientras tanto el mensaje se registra a mano y la ventana de 24 horas ya se calcula. Falta: la cuenta de WhatsApp Business (Cloud API o proveedor), su aprobación en la revisión de tecnología.', 'Meanwhile the message is logged by hand and the 24-hour window is already computed. Missing: the WhatsApp Business account (Cloud API or provider) and its technology review approval.'],
    },
  ]
}
