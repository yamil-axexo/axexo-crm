// Tipos de aviso y canales del servicio único (AUT-05). Lo leen el dominio y las pantallas: una sola lista.
export type Channel = 'in_app' | 'email' | 'slack' | 'whatsapp'
export const CHANNELS: Channel[] = ['in_app', 'email', 'slack', 'whatsapp']
export const OUTSIDE: Exclude<Channel, 'in_app'>[] = ['email', 'slack', 'whatsapp']

type Pair = [es: string, en: string]

export const CHANNEL_LABEL: Record<Channel, Pair> = {
  in_app: ['Dentro de CONTIGO', 'Inside CONTIGO'],
  email: ['Correo', 'Email'],
  slack: ['Slack', 'Slack'],
  whatsapp: ['WhatsApp', 'WhatsApp'],
}

export type KindDef = {
  label: Pair
  hint: Pair
  /** Canales que vienen encendidos si la persona no ha elegido. */
  defaults: Channel[]
  /** Aparece en Hoy hasta que la persona lo marca como visto. */
  action: boolean
  /** No se puede apagar dentro de CONTIGO (un anuncio, una devolución). */
  locked: boolean
  /** Sale aunque la persona tenga resumen diario: no puede esperar a mañana. */
  urgent: boolean
}

export const NOTICE_KINDS = {
  mention: { label: ['Te avisaron desde una nota', 'Someone notified you from a note'], hint: ['Alguien te eligió al escribir una nota.', 'Someone picked you when writing a note.'], defaults: ['in_app'], action: true, locked: true, urgent: false },
  returned: { label: ['Operaciones te devolvió un negocio', 'Operations sent a deal back to you'], hint: ['Con el motivo de la devolución.', 'With the reason it came back.'], defaults: ['in_app', 'email'], action: false, locked: true, urgent: true },
  deal_won: { label: ['Ganaron un negocio tuyo', 'A deal of yours was won'], hint: ['Cuando otra persona lo marca como ganado: el dealer ya está activo.', 'When someone else marks it as won: the dealer is now active.'], defaults: ['in_app', 'email'], action: true, locked: false, urgent: false },
  lead_arrived: { label: ['Te llegó un lead', 'A lead arrived for you'], hint: ['Al entrar un lead a tu nombre.', 'When a lead comes in under your name.'], defaults: ['in_app', 'email'], action: false, locked: false, urgent: true },
  lead_goal_missed: { label: ['Venció la meta de primer contacto', 'The first-contact goal ran out'], hint: ['Un lead tuyo sigue sin intento de contacto.', 'A lead of yours still has no contact attempt.'], defaults: ['in_app', 'email'], action: false, locked: false, urgent: true },
  lead_repeat: { label: ['Segunda solicitud web de la misma empresa', 'Second web request from the same business'], hint: ['La tarea queda en Hoy.', 'The task shows in Today.'], defaults: ['in_app'], action: false, locked: false, urgent: false },
  handoff: { label: ['Un negocio llegó a Operaciones', 'A deal reached Operations'], hint: ['Para el equipo de Operaciones del mercado.', 'For the market’s Operations team.'], defaults: ['in_app', 'email'], action: false, locked: false, urgent: false },
  order_sent: { label: ['Llegó un pedido a Operaciones', 'An order reached Operations'], hint: ['Con enlace al pedido listo para imprimir.', 'With a link to the printable order.'], defaults: ['in_app', 'email'], action: true, locked: false, urgent: false },
  lifecycle: { label: ['Cambios de un comercio que llevas', 'Changes on a merchant you own'], hint: ['Cuenta nueva, dealer activo, cambio de responsable, aprobación.', 'New account, dealer active, owner change, approval.'], defaults: ['in_app', 'email'], action: false, locked: false, urgent: false },
  training: { label: ['Capacitación de un dealer', 'Dealer training'], hint: ['Agenda, cambios y cuando no se presentó.', 'Schedule, changes and no-shows.'], defaults: ['in_app', 'email'], action: false, locked: false, urgent: false },
  announcement: { label: ['Anuncios a la red', 'Network announcements'], hint: ['Cambios de reglas, comisiones y caídas.', 'Rule changes, commissions and outages.'], defaults: ['in_app', 'email'], action: false, locked: true, urgent: true },
  approval: { label: ['Aprobaciones de pasos de etapa', 'Stage step approvals'], hint: ['Cuando deciden un paso que pediste y cuando una aprobación te toca.', 'When a step you asked for is decided and when an approval is yours.'], defaults: ['in_app', 'email'], action: true, locked: false, urgent: false },
  automation: { label: ['Avisos de una automatización', 'Notices from an automation'], hint: ['Los que manda una regla que administración configuró.', 'The ones a rule set up by administration sends.'], defaults: ['in_app'], action: true, locked: false, urgent: false },
  scheduled_report: { label: ['Reportes programados', 'Scheduled reports'], hint: ['El resumen de un reporte que programaste.', 'The summary of a report you scheduled.'], defaults: ['in_app', 'email'], action: false, locked: false, urgent: false },
  export_alert: { label: ['Exportaciones sobre el umbral diario', 'Exports over the daily threshold'], hint: ['Para administración: alguien pasó el umbral de archivos o filas en un día.', 'For administration: someone went over the daily file or row threshold.'], defaults: ['in_app', 'email'], action: true, locked: false, urgent: false },
  // Seguridad (0031): alertas para quien lleva la bitácora, y el aviso a quien recibe un acceso.
  security_alert: { label: ['Alertas de seguridad', 'Security alerts'], hint: ['Para quien lleva la bitácora: exportaciones, búsquedas o revelados sobre el umbral, llaves por vencer y cambios por fuera de la aplicación.', 'For whoever handles the audit log: exports, searches or reveals over the threshold, keys about to expire and changes outside the application.'], defaults: ['in_app', 'email'], action: true, locked: false, urgent: false },
  access_granted: { label: ['Te dieron un acceso', 'You were given access'], hint: ['Cuando Administración te da un rol o cambia lo que puedes hacer.', 'When Administration gives you a role or changes what you can do.'], defaults: ['in_app', 'email'], action: false, locked: true, urgent: false },
  report: { label: ['Respuesta a un problema que reportaste', 'Answer to a problem you reported'], hint: ['Y, para administración, cada reporte nuevo.', 'And, for administration, each new report.'], defaults: ['in_app'], action: false, locked: false, urgent: false },
} as const satisfies Record<string, KindDef>

export type NoticeKind = keyof typeof NOTICE_KINDS
export const KIND_KEYS = Object.keys(NOTICE_KINDS) as NoticeKind[]

export type Prefs = Partial<Record<NoticeKind, Partial<Record<Channel, boolean>>>>

/** ¿Recibe la persona este tipo por este canal? Su elección manda; si no eligió, vale lo que trae el tipo. */
export function wants(prefs: Prefs, kind: NoticeKind, channel: Channel): boolean {
  const def: KindDef = NOTICE_KINDS[kind]
  if (channel === 'in_app' && def.locked) return true
  const own = prefs[kind]?.[channel]
  return typeof own === 'boolean' ? own : def.defaults.includes(channel)
}

/** Estados de una fila del registro, como los lee una persona. */
export const DELIVERY_STATUS: Record<string, Pair> = {
  delivered: ['Entregado dentro de CONTIGO', 'Delivered inside CONTIGO'],
  queued_off: ['Listo para enviar. Canal apagado', 'Ready to send. Channel turned off'],
  simulated: ['Envío simulado (pruebas)', 'Simulated send (tests)'],
  held_hours: ['En espera: fuera del horario hábil', 'On hold: outside business hours'],
  held_digest: ['En espera: va en el resumen', 'On hold: goes in the summary'],
  held_limit: ['En espera: límite diario del canal', 'On hold: daily channel limit'],
  digested: ['Incluido en un resumen', 'Included in a summary'],
  skipped_consent: ['No sale: la persona no dio su consentimiento o pidió la baja', 'Not sent: the person gave no consent or opted out'],
  skipped_no_address: ['No sale: falta la dirección de destino', 'Not sent: the destination address is missing'],
  blocked_template: ['No sale: falta el texto de la plantilla', 'Not sent: the template text is missing'],
}

/** Variables que una plantilla puede usar. */
export const TEMPLATE_VARS = ['comercio', 'contacto', 'negocio', 'quien', 'mercado', 'fecha', 'detalle', 'enlace', 'titulo', 'texto'] as const
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARS)[number], string>>

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => (vars as Record<string, string | undefined>)[k] ?? '')
}
/** Variables escritas en un texto que no existen: la pantalla las señala antes de guardar. */
export function unknownVars(text: string): string[] {
  const known = new Set<string>(TEMPLATE_VARS)
  return [...new Set([...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => !known.has(k)))]
}
export const isPendingText = (text: string) => /\[(pendiente|pending):/i.test(text)

/** Qué plantillas existen: a quién van y qué las dispara, dicho para una persona. */
export const TEMPLATE_INFO: Record<string, { name: Pair; to: Pair; when: Pair }> = {
  lead_welcome: { name: ['Bienvenida a un lead', 'Welcome to a lead'], to: ['Al lead, a su correo', 'The lead, at their email'], when: ['Al crearse un lead desde un formulario web', 'When a web form creates a lead'] },
  lead_web_ack: { name: ['Acuse a un lead web', 'Acknowledgment to a web lead'], to: ['Al lead, a su correo', 'The lead, at their email'], when: ['Al llegar un lead por formulario web, si el mercado no tiene bienvenida', 'When a web form lead arrives, if the market has no welcome'] },
  ops_handoff: { name: ['Entrega a Operaciones', 'Hand-off to Operations'], to: ['A Operaciones del mercado', 'The market’s Operations team'], when: ['Al entrar un negocio a una etapa de Operaciones', 'When a deal enters an Operations stage'] },
  order_to_ops: { name: ['Pedido a Operaciones', 'Order to Operations'], to: ['Al buzón de pedidos del mercado', 'The market’s order mailbox'], when: ['Al tocar "Enviar a Operaciones" en un pedido', 'When someone taps "Send to Operations" on an order'] },
  account_new: { name: ['Cuenta nueva', 'New account'], to: ['A Operaciones del mercado', 'The market’s Operations team'], when: ['Al crearse un comercio', 'When a merchant is created'] },
  dealer_active: { name: ['Dealer activo', 'Dealer active'], to: ['A quien lleva el comercio', 'Whoever owns the merchant'], when: ['Al ganarse su negocio', 'When its deal is won'] },
  owner_changed: { name: ['Cambio de quién lo lleva', 'Owner changed'], to: ['A la persona que lo recibe', 'The person receiving it'], when: ['Al reasignar un comercio', 'When a merchant is reassigned'] },
  approval_visit: { name: ['Aprobación con tarea de visita', 'Approval with a visit task'], to: ['A quien vendió el negocio', 'Whoever sold the deal'], when: ['Al aprobar un proveedor en Operaciones', 'When Operations marks a provider as approved'] },
  dealer_closed: { name: ['Negocio cerrado sin alta', 'Deal closed without sign-up'], to: ['A quien lleva el comercio', 'Whoever owns the merchant'], when: ['Al perderse un negocio que otra persona cerró', 'When someone else closes the deal as lost'] },
  dealer_churned: { name: ['Comercio sin ventas', 'Merchant with no sales'], to: ['A quien lleva el comercio', 'Whoever owns the merchant'], when: ['Cuando los datos de ventas muestran 30 días sin ventas', 'When the sales data shows 30 days with no sales'] },
  notice: { name: ['Aviso general a una persona', 'General notice to a person'], to: ['A la persona avisada', 'The person notified'], when: ['Cualquier aviso sin plantilla propia', 'Any notice without its own template'] },
  digest: { name: ['Resumen diario', 'Daily summary'], to: ['A quien pidió resumen', 'Whoever asked for a summary'], when: ['Una vez al día, con lo que quedó en espera', 'Once a day, with what was on hold'] },
}
