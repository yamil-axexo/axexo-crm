// Cuidado del comercio (CS-01 a CS-08): etiquetas y listas que comparten el dominio y las pantallas. Una sola lista de cada cosa.
type Pair = [es: string, en: string]
type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'

export const STAGES = ['prospect', 'onboarding', 'active', 'habit', 'at_risk', 'inactive', 'reactivated', 'churned'] as const
export type Stage = (typeof STAGES)[number]
export const STAGE: Record<Stage, { label: Pair; tone: Tone; hint: Pair }> = {
  prospect: { label: ['Prospecto', 'Prospect'], tone: 'neutral', hint: ['Todavía no empieza su alta.', 'Onboarding has not started yet.'] },
  onboarding: { label: ['En alta', 'Onboarding'], tone: 'info', hint: ['Está en alta y todavía no hace su primera venta.', 'Onboarding, with no first sale yet.'] },
  active: { label: ['Activo', 'Active'], tone: 'good', hint: ['Ya vende.', 'It is selling.'] },
  habit: { label: ['Con hábito', 'Habit'], tone: 'good', hint: ['Vende la mayoría de los días.', 'It sells on most days.'] },
  at_risk: { label: ['En riesgo', 'At risk'], tone: 'warn', hint: ['Vende pocos días.', 'It sells on few days.'] },
  inactive: { label: ['Inactivo', 'Inactive'], tone: 'bad', hint: ['Sin ventas en los últimos 30 días.', 'No sales in the last 30 days.'] },
  reactivated: { label: ['Reactivado', 'Reactivated'], tone: 'accent', hint: ['Volvió a vender después de estar inactivo.', 'It is selling again after being inactive.'] },
  churned: { label: ['Perdido', 'Lost'], tone: 'bad', hint: ['Lleva demasiado tiempo sin vender.', 'It has gone too long without selling.'] },
}
/** La etapa resumida que guardan los comercios (seis valores): hábito y reactivado cuentan como activo. */
export const coarseStage = (s: Stage): string => (s === 'habit' || s === 'reactivated' ? 'active' : s)

export const STAGE_SOURCE: Record<string, Pair> = {
  sales_file: ['Archivo de ventas', 'Sales file'],
  rules: ['Reglas de CONTIGO', 'CONTIGO rules'],
  manual: ['Una persona', 'A person'],
  import: ['Importación', 'Import'],
}
export const STAGE_REASON: Record<string, Pair> = {
  first_sale: ['hizo su primera venta', 'made its first sale'],
  habit_at: ['alcanzó los días con venta que marcan hábito', 'reached the selling days that mark a habit'],
  habit_below: ['bajó de los días con venta que sostienen el hábito', 'fell below the selling days that keep the habit'],
  risk_below: ['bajó del mínimo de días con venta', 'fell below the minimum selling days'],
  recover_at: ['recuperó los días con venta que piden las reglas', 'recovered the selling days the rules ask for'],
  no_sales: ['dejó de vender', 'stopped selling'],
  churn_after_days: ['pasó el plazo sin ventas', 'passed the limit with no sales'],
  settled: ['lleva 30 días vendiendo otra vez', 'has been selling again for 30 days'],
}

export const PRODUCT_LINES = ['general', 'topups', 'remittances', 'bill_pay'] as const
export type ProductLine = (typeof PRODUCT_LINES)[number]
export const PRODUCT_LINE: Record<ProductLine, Pair> = {
  general: ['General', 'General'],
  topups: ['Recargas', 'Top-ups'],
  remittances: ['Remesas', 'Remittances'],
  bill_pay: ['Pago de servicios', 'Bill pay'],
}

export const HANDOFF_ROLES = ['sales', 'ops', 'cs', 'am'] as const
export type HandoffRole = (typeof HANDOFF_ROLES)[number]
export const HANDOFF_ROLE: Record<HandoffRole, Pair> = {
  sales: ['Ventas', 'Sales'],
  ops: ['Operaciones', 'Operations'],
  cs: ['Customer Support', 'Customer Support'],
  am: ['Quien cuida la cuenta', 'Account manager'],
}
export const HANDOFF_STATUS: Record<string, { label: Pair; tone: Tone }> = {
  pending: { label: ['Esperando acuse', 'Waiting for acknowledgment'], tone: 'warn' },
  acknowledged: { label: ['Recibida', 'Acknowledged'], tone: 'good' },
  returned: { label: ['Devuelta', 'Sent back'], tone: 'bad' },
}
export type CheckItem = { code: string; es: string; en: string; done: boolean }
/** Qué se entrega en cada tramo. La lista viaja con la entrega: quien recibe ve qué viene y qué falta. */
export function defaultChecklist(to: HandoffRole): CheckItem[] {
  const item = (code: string, es: string, en: string): CheckItem => ({ code, es, en, done: false })
  if (to === 'ops') return [
    item('contact', 'Contacto del encargado confirmado', 'Manager contact confirmed'),
    item('docs', 'Documentos del alta completos', 'Onboarding documents complete'),
    item('promise', 'Lo que se le prometió al comercio, anotado', 'What the merchant was promised, written down'),
  ]
  if (to === 'sales') return [
    item('reason', 'Motivo de la devolución, anotado', 'Reason for sending it back, written down'),
    item('next', 'Qué tiene que pasar para retomarlo', 'What has to happen to pick it up again'),
  ]
  return [
    item('first_sale', 'Primera venta hecha', 'First sale done'),
    item('training', 'Capacitación del encargado hecha', 'Manager training done'),
    item('products', 'Productos y proveedores activos, revisados', 'Active products and providers, reviewed'),
    item('open_issues', 'Pendientes abiertos, anotados', 'Open issues, written down'),
  ]
}

export const TIERS = ['high', 'pooled', 'low', 'tech'] as const
export type Tier = (typeof TIERS)[number]
export const TIER: Record<Tier, { label: Pair; hint: Pair }> = {
  high: { label: ['Atención dedicada', 'Dedicated'], hint: ['Una persona con nombre cuida la cuenta.', 'A named person looks after the account.'] },
  pooled: { label: ['Atención en equipo', 'Pooled'], hint: ['La atiende el equipo, por turnos.', 'The team looks after it, in turns.'] },
  low: { label: ['Atención ligera', 'Light touch'], hint: ['Mensajes primero; una persona cuando hace falta.', 'Messages first; a person when needed.'] },
  tech: { label: ['Atención digital', 'Digital'], hint: ['Mensajes automáticos; una persona solo por excepción.', 'Automatic messages; a person only by exception.'] },
}
export const TIER_BASIS: Record<string, Pair> = {
  commission: ['por la comisión que genera', 'by the commission it generates'],
  volume: ['por su volumen de ventas (no hay dato de comisión)', 'by its sales volume (no commission data)'],
  account_type: ['por el tipo de cuenta', 'by account type'],
}

export const ALERT_KINDS = ['no_first_sale', 'drop_vs_baseline', 'low_balance', 'inactive', 'manager_change'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]
export const ALERT: Record<AlertKind, { label: Pair; hint: Pair }> = {
  no_first_sale: { label: ['Alta sin primera venta', 'Onboarded, no first sale'], hint: ['Terminó su alta y pasan los días sin vender.', 'Onboarding is done and days go by with no sale.'] },
  drop_vs_baseline: { label: ['Vende menos que antes', 'Selling less than before'], hint: ['Cayó contra lo que el mismo comercio vendía.', 'It dropped against what the same merchant used to sell.'] },
  low_balance: { label: ['Saldo bajo', 'Low balance'], hint: ['Su saldo para vender está por terminarse.', 'Its selling balance is about to run out.'] },
  inactive: { label: ['Dejó de vender', 'Stopped selling'], hint: ['Sin ventas en los últimos 30 días.', 'No sales in the last 30 days.'] },
  manager_change: { label: ['Cambió el encargado', 'New manager'], hint: ['Hay un encargado nuevo sin capacitar.', 'There is a new manager with no training yet.'] },
}
export const ALERT_CLOSE: Record<string, Pair> = {
  recovered: ['Se resolvió sola', 'Resolved on its own'],
  done: ['Atendida', 'Handled'],
  dismissed: ['Descartada', 'Dismissed'],
}
export const MESSAGE_STATUS: Record<string, Pair> = {
  queued_off: ['Listo para enviar. Canal apagado', 'Ready to send. Channel off'],
  simulated: ['Enviado (simulación de pruebas)', 'Sent (test simulation)'],
  skipped_consent: ['No se envía: el comercio no ha dado permiso', 'Not sent: the merchant has not given permission'],
  held_limit: ['En espera: se alcanzó el límite del día', 'On hold: the daily limit was reached'],
}

export const HEALTH_GROUPS = ['transactions', 'mix', 'tickets', 'balance'] as const
export type HealthGroup = (typeof HEALTH_GROUPS)[number]
export const HEALTH_GROUP: Record<HealthGroup, { label: Pair; hint: Pair; off: Pair }> = {
  transactions: { label: ['Ventas', 'Sales'], hint: ['Cuánto vende contra lo que el mismo comercio vendía; sin historia, contra los días que marcan hábito.', 'How much it sells against what the same merchant used to sell; with no history, against the days that mark a habit.'], off: ['Sin datos de ventas', 'No sales data'] },
  mix: { label: ['Productos que usa', 'Products in use'], hint: ['Cuántos productos distintos vendió en 30 días.', 'How many different products it sold in 30 days.'], off: ['Sin dato: conexión apagada', 'No data: connection off'] },
  tickets: { label: ['Solicitudes de soporte', 'Support requests'], hint: ['Solicitudes abiertas y urgentes. De Zendesk solo llegan conteos.', 'Open and urgent requests. Only counts come from Zendesk.'], off: ['Sin dato: conexión con Zendesk apagada', 'No data: Zendesk connection off'] },
  balance: { label: ['Saldo', 'Balance'], hint: ['Saldo disponible contra el mínimo del mercado.', 'Available balance against the market minimum.'], off: ['Sin dato: conexión apagada', 'No data: connection off'] },
}
export const HEALTH_BAND: Record<string, { label: Pair; tone: Tone }> = {
  good: { label: ['Bien', 'Good'], tone: 'good' },
  watch: { label: ['Para vigilar', 'Watch'], tone: 'warn' },
  risk: { label: ['En riesgo', 'At risk'], tone: 'bad' },
}
/** Mínimo de comercios en la validación para poder publicar el puntaje. */
export const HEALTH_MIN_SAMPLE = 30

export const EXPANSION_STATUS: Record<string, { label: Pair; tone: Tone }> = {
  open: { label: ['Por tomar', 'To take'], tone: 'accent' },
  working: { label: ['En conversación', 'In conversation'], tone: 'info' },
  won: { label: ['Aceptó', 'Accepted'], tone: 'good' },
  lost: { label: ['No aceptó', 'Declined'], tone: 'neutral' },
  dismissed: { label: ['Descartada', 'Dismissed'], tone: 'neutral' },
}
export const REL_HEALTH: Record<string, { label: Pair; tone: Tone }> = {
  good: { label: ['Bien', 'Good'], tone: 'good' },
  watch: { label: ['Para vigilar', 'Watch'], tone: 'warn' },
  risk: { label: ['En riesgo', 'At risk'], tone: 'bad' },
}
export const FEEDBACK_KIND: Record<string, Pair> = { friction: ['Algo le estorba', 'Something gets in the way'], request: ['Algo que pide', 'Something they ask for'] }
export const FEEDBACK_STATUS: Record<string, { label: Pair; tone: Tone }> = {
  new: { label: ['Nuevo', 'New'], tone: 'accent' },
  seen: { label: ['Visto por Producto', 'Seen by Product'], tone: 'info' },
  planned: { label: ['En plan', 'Planned'], tone: 'info' },
  done: { label: ['Resuelto', 'Done'], tone: 'good' },
  declined: { label: ['No se hará', 'Will not be done'], tone: 'neutral' },
}
export const CONTACT_ROLE: Record<string, Pair> = {
  owner: ['Dueño', 'Owner'],
  decision_maker: ['Quien decide', 'Decision maker'],
  manager: ['Encargado', 'Manager'],
  billing: ['Pagos y facturas', 'Billing'],
  staff: ['Personal', 'Staff'],
}
/** Cuentas que llevan plan de cuenta y revisiones: cadenas, distribuidores, organizaciones y las de atención dedicada. */
export const isCorporate = (kind: string, tier: string | null) => kind !== 'store' || tier === 'high'
