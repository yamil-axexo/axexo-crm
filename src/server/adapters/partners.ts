import 'server-only'

/**
 * Adaptadores del paquete partners-contratos. Todos construidos y APAGADOS: no llaman a nada y la operación queda en
 * crm.external_queue con estado "Canal apagado". `simulated` solo vale con APP_ENV=test y anota lo que habría salido.
 * Encender cualquiera pasa primero por la revisión de tecnología (Dan Mulligan o Michael Essiet).
 */
type Mode = 'off' | 'simulated'
type Pair = [es: string, en: string]
const modeOf = (envVar: string): Mode => (process.env.APP_ENV === 'test' && process.env[envVar] === 'simulated' ? 'simulated' : 'off')
const g = globalThis as unknown as { __contigoPartnerCalls?: { adapter: string; payload: Record<string, unknown> }[] }
/** Lo que los adaptadores simulados habrían hecho en este proceso (solo pruebas). */
export const simulatedPartnerCalls = () => (g.__contigoPartnerCalls ??= [])
const record = (adapter: string, payload: Record<string, unknown>, mode: Mode): 'channel_off' | 'simulated' => {
  if (mode === 'off') return 'channel_off'
  simulatedPartnerCalls().push({ adapter, payload })
  return 'simulated'
}

export const ESIGN_ENV = 'CONTIGO_ESIGN_ADAPTER'
export const EXTERNAL_IDENTITY_ENV = 'CONTIGO_EXTERNAL_IDENTITY_ADAPTER'
export const GMAIL_ENV = 'CONTIGO_GMAIL_CAPTURE_ADAPTER'
export const CALENDAR_ENV = 'CONTIGO_CALENDAR_CAPTURE_ADAPTER'
export const WHATSAPP_CAPTURE_ENV = 'CONTIGO_WHATSAPP_CAPTURE_ADAPTER'

/** Firma electrónica (comprada, no propia). Pide la firma de un contrato. */
export const esignAdapter = () => {
  const mode = modeOf(ESIGN_ENV)
  return { mode, envVar: ESIGN_ENV, requestSignature: async (p: { contractId: string }) => record('esign', p, mode) }
}
/** Identidad de usuarios externos (partners y clientes): invitar y dar entrada a quien no es de los dominios admitidos. */
export const externalIdentityAdapter = () => {
  const mode = modeOf(EXTERNAL_IDENTITY_ENV)
  return { mode, envVar: EXTERNAL_IDENTITY_ENV, invite: async (p: { accountId: string }) => record('external_identity', p, mode) }
}
/**
 * Captura de correo y calendario (Gmail y Google Calendar API, solo lectura) y de WhatsApp (Cloud API o proveedor).
 * Sincronizan hacia el hilo, nunca de afuera hacia los contactos, y solo hilos con contactos conocidos. Apagadas: no leen nada.
 */
export type CapturedMessage = { accountId: string; channel: 'email' | 'meeting' | 'whatsapp'; externalRef: string; subject: string; participants: string[]; occurredAt: string; direction?: 'inbound' | 'outbound'; phone?: string }
const capture = (envVar: string) => {
  const mode = modeOf(envVar)
  return { mode, envVar, pull: async (): Promise<CapturedMessage[]> => [] }
}
export const gmailCaptureAdapter = () => capture(GMAIL_ENV)
export const calendarCaptureAdapter = () => capture(CALENDAR_ENV)
export const whatsappCaptureAdapter = () => capture(WHATSAPP_CAPTURE_ENV)

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
