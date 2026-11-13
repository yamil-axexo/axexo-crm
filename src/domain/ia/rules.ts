/**
 * Versión por reglas de las funciones del dominio IA. Es la que funciona hoy y la que el adaptador de AI (apagado) devuelve.
 * Todo aquí es puro: lo usan los comandos, la evaluación (IA-08) y las pruebas. Ninguna regla interpreta texto libre
 * como instrucción: el texto de fuera no cambia ninguna respuesta (IA-07).
 */
type Pair = [es: string, en: string]

// ================================================================ IA-02: siguiente mejor acción
export const NEXT_RULES = ['no_first_sale', 'quiet_dropping', 'quiet', 'revisit'] as const
export type NextRule = (typeof NEXT_RULES)[number]
export type NextFacts = {
  lifecycle: string
  daysSinceCreated?: number
  firstTxn: boolean
  /** Días desde el último contacto hecho (visita, llamada, nota, reunión). Sin ninguno, desde el alta. */
  daysQuiet: number
  /** Transacciones de los últimos 30 días según el archivo más reciente y según el de hace ~30 días. */
  txnNow?: number | null
  txnBefore?: number | null
  revisit?: boolean
}
export type NextSignal = { rule: NextRule; days: number; dropPct?: number; daysSinceCreated?: number }

/** Cuántos días sin contacto cuentan como "mucho" para cada regla. `quiet` usa el umbral del mercado. */
export const QUIET_FLOOR = 21
/** Caída de transacciones que cuenta como "su venta cayó" (en porcentaje). */
export const DROP_PCT = 20
export const MAX_PER_ACCOUNT = 3

/** Las reglas que aplican a una cuenta, en orden de prioridad (máximo 3). */
export function nextActions(f: NextFacts, quietDays = 9): NextSignal[] {
  const out: NextSignal[] = []
  if (f.revisit) out.push({ rule: 'revisit', days: f.daysQuiet })
  if (f.lifecycle === 'onboarding' && !f.firstTxn && (f.daysSinceCreated ?? 0) >= 7) out.push({ rule: 'no_first_sale', days: f.daysQuiet, daysSinceCreated: f.daysSinceCreated })
  const drop = f.txnBefore && f.txnBefore > 0 && f.txnNow != null ? Math.round(((f.txnBefore - f.txnNow) / f.txnBefore) * 100) : 0
  if (['active', 'at_risk'].includes(f.lifecycle) && f.daysQuiet >= quietDays && drop >= DROP_PCT) out.push({ rule: 'quiet_dropping', days: f.daysQuiet, dropPct: drop })
  else if (['active', 'at_risk'].includes(f.lifecycle) && f.daysQuiet >= Math.max(QUIET_FLOOR, quietDays)) out.push({ rule: 'quiet', days: f.daysQuiet })
  return out.slice(0, MAX_PER_ACCOUNT)
}

/** La primera regla que aplica, o "none": es la respuesta que se evalúa. */
export const topAction = (f: NextFacts, quietDays = 9): NextRule | 'none' => nextActions(f, quietDays)[0]?.rule ?? 'none'

export const NEXT_TITLE: Record<NextRule, Pair> = {
  no_first_sale: ['Ayudar a hacer su primera venta', 'Help them make their first sale'],
  quiet_dropping: ['Llamar o visitar: su venta va a la baja', 'Call or visit: their sales are dropping'],
  quiet: ['Ponerse en contacto', 'Get in touch'],
  revisit: ['Hacer la revisita pendiente', 'Do the pending revisit'],
}

/** El porqué, con los números de la señal. */
export function nextReason(s: { rule: NextRule; days?: number; dropPct?: number; daysSinceCreated?: number }): Pair {
  const d = s.days ?? 0
  const dd = (n: number, es: string, en: string): Pair => [`${n} ${n === 1 ? es : `${es}s`}`, `${n} ${n === 1 ? en : `${en}s`}`]
  const [des, den] = dd(d, 'día', 'day')
  switch (s.rule) {
    case 'no_first_sale': {
      const [ces, cen] = dd(s.daysSinceCreated ?? 0, 'día', 'day')
      return [`Porque se dio de alta hace ${ces} y todavía no tiene su primera venta.`, `Because it was onboarded ${cen} ago and has no first sale yet.`]
    }
    case 'quiet_dropping':
      return [`Porque lleva ${des} sin contacto y su venta cayó ${s.dropPct ?? 0}% contra el mes anterior.`, `Because it has gone ${den} without contact and its sales fell ${s.dropPct ?? 0}% against the previous month.`]
    case 'quiet':
      return [`Porque lleva ${des} sin contacto.`, `Because it has gone ${den} without contact.`]
    case 'revisit':
      return ['Porque quedó una revisita pendiente en un negocio abierto.', 'Because a revisit is pending on an open deal.']
  }
}

export const DISMISS_CODES = ['already_done', 'not_relevant', 'wrong_data', 'other'] as const
export type DismissCode = (typeof DISMISS_CODES)[number]
export const DISMISS_LABEL: Record<DismissCode, Pair> = {
  already_done: ['Ya lo hice', 'Already done'],
  not_relevant: ['No aplica a esta cuenta', 'Does not apply to this account'],
  wrong_data: ['Los datos están mal', 'The data is wrong'],
  other: ['Otro motivo', 'Other reason'],
}

// ================================================================ IA-03: calificación y clasificación de leads
export const LEAD_CLASSES = ['dealer', 'store', 'chain', 'partner', 'unqualified'] as const
export type LeadClass = (typeof LEAD_CLASSES)[number]
export const LEAD_CLASS_LABEL: Record<LeadClass, Pair> = {
  dealer: ['Dealer', 'Dealer'],
  store: ['Punto de venta', 'Store'],
  chain: ['Cadena', 'Chain'],
  partner: ['Partner', 'Partner'],
  unqualified: ['No calificado', 'Not qualified'],
}

export type LeadFacts = {
  status: string
  motor?: string | null
  accountType?: string | null
  source?: string | null
  phone?: boolean
  email?: boolean
  businessName?: boolean
  locality?: boolean
  consent?: boolean
  referral?: boolean
  touched?: boolean
  duplicate?: boolean
  /** Texto libre del lead. Es contenido no confiable: las reglas NO lo leen. */
  message?: string | null
}

const PARTNER_TYPES = ['iso', 'iso_agent', 'aggregator', 'distributor', 'master_agent', 'carrier', 'tsp', 'vendor']
const CHAIN_TYPES = ['chain', 'corporate', 'region']

/** Clasificación por reglas, solo con datos estructurados. Sin tipo de cuenta ni tipo de venta: null (por confirmar). */
export function classifyLead(f: LeadFacts): { cls: LeadClass | null; why: Pair } {
  if (f.status === 'disqualified') return { cls: 'unqualified', why: ['Se descartó el lead.', 'The lead was disqualified.'] }
  const at = f.accountType ?? ''
  if (at === 'dealer' || at === 'isp') return { cls: 'dealer', why: ['El tipo de cuenta es dealer.', 'The account type is dealer.'] }
  if (PARTNER_TYPES.includes(at)) return { cls: 'partner', why: ['El tipo de cuenta revende o agrupa a otros comercios.', 'The account type resells or groups other merchants.'] }
  if (CHAIN_TYPES.includes(at)) return { cls: 'chain', why: ['El tipo de cuenta es una cadena o un corporativo.', 'The account type is a chain or a corporate.'] }
  if (at === 'store' || at === 'branch') return { cls: 'store', why: ['El tipo de cuenta es un punto de venta.', 'The account type is a store.'] }
  if (f.motor === 'dealer') return { cls: 'dealer', why: ['El tipo de venta es dealer.', 'The sale type is dealer.'] }
  if (f.motor === 'd2d') return { cls: 'store', why: ['El tipo de venta es de puerta en puerta: un punto de venta.', 'The sale type is door to door: a store.'] }
  if (f.motor === 'b2b') return { cls: 'chain', why: ['El tipo de venta es corporativo.', 'The sale type is corporate.'] }
  return { cls: null, why: ['Falta el tipo de cuenta o el tipo de venta para clasificarlo.', 'The account type or the sale type is missing to classify it.'] }
}

export const SCORE_FACTORS = ['phone', 'email', 'business_name', 'locality', 'account_type', 'consent', 'referral', 'web_form', 'touched', 'duplicate'] as const
export type ScoreFactor = (typeof SCORE_FACTORS)[number]
export const DEFAULT_WEIGHTS: Record<ScoreFactor, number> = {
  phone: 20, email: 10, business_name: 10, locality: 5, account_type: 10, consent: 10, referral: 20, web_form: 10, touched: 15, duplicate: -30,
}
export const FACTOR_LABEL: Record<ScoreFactor, Pair> = {
  phone: ['Tiene teléfono', 'Has a phone'],
  email: ['Tiene correo', 'Has an email'],
  business_name: ['Tiene nombre del negocio', 'Has a business name'],
  locality: ['Tiene ciudad o colonia', 'Has a city or area'],
  account_type: ['Tiene tipo de cuenta', 'Has an account type'],
  consent: ['Dio su consentimiento de contacto', 'Gave contact consent'],
  referral: ['Lo refirió un comercio', 'Referred by a merchant'],
  web_form: ['Llegó por un formulario web', 'Came from a web form'],
  touched: ['Ya se le contactó', 'Already contacted'],
  duplicate: ['Se parece a un comercio que ya existe', 'Looks like an existing merchant'],
}

const has = (f: LeadFacts, k: ScoreFactor): boolean => {
  switch (k) {
    case 'phone': return !!f.phone
    case 'email': return !!f.email
    case 'business_name': return !!f.businessName
    case 'locality': return !!f.locality
    case 'account_type': return !!f.accountType
    case 'consent': return !!f.consent
    case 'referral': return !!f.referral
    case 'web_form': return f.source === 'web_form'
    case 'touched': return !!f.touched
    case 'duplicate': return !!f.duplicate
  }
}

/** Puntaje de 0 a 100 con cada punto explicado. Los pesos los edita administración por mercado. */
export function scoreLead(f: LeadFacts, weights: Partial<Record<ScoreFactor, number>> = {}): { score: number; parts: { factor: ScoreFactor; points: number }[] } {
  const w = { ...DEFAULT_WEIGHTS, ...weights }
  const parts = SCORE_FACTORS.filter((k) => has(f, k) && w[k] !== 0).map((k) => ({ factor: k, points: w[k] }))
  const raw = parts.reduce((s, p) => s + p.points, 0)
  return { score: Math.max(0, Math.min(100, raw)), parts }
}

// ================================================================ IA-05: preguntas sobre métricas definidas
export const ASKABLE = ['won', 'lost', 'leads', 'qualified', 'open', 'awaiting', 'active', 'risk', 'revisits'] as const
export type Askable = (typeof ASKABLE)[number]
/** Las que dependen del periodo; las demás son una foto de este momento. */
export const PERIODIC: readonly Askable[] = ['won', 'lost', 'leads', 'qualified']

export const QUESTION: Record<Askable, Pair> = {
  won: ['¿Cuántos negocios se ganaron?', 'How many deals were won?'],
  lost: ['¿Cuántos negocios se perdieron?', 'How many deals were lost?'],
  leads: ['¿Cuántos leads llegaron?', 'How many leads came in?'],
  qualified: ['¿Cuántos leads se calificaron?', 'How many leads were qualified?'],
  open: ['¿Cuántos negocios hay abiertos?', 'How many deals are open?'],
  awaiting: ['¿Cuántos negocios esperan su primera venta?', 'How many deals are waiting for their first sale?'],
  active: ['¿Cuántos comercios están activos?', 'How many merchants are active?'],
  risk: ['¿Cuántos comercios están en riesgo?', 'How many merchants are at risk?'],
  revisits: ['¿Cuántas revisitas hay pendientes?', 'How many revisits are pending?'],
}

const KEYWORDS: Record<Askable, string[][]> = {
  won: [['ganad', 'ganar', 'gano', 'won', 'cerrad', 'closed won']],
  lost: [['perdid', 'perdi', 'lost']],
  qualified: [['calificad', 'qualified']],
  leads: [['lead', 'prospect']],
  awaiting: [['primera venta', 'first sale', 'esperan', 'waiting', 'awaiting']],
  open: [['abierto', 'open']],
  active: [['activo', 'active']],
  risk: [['riesgo', 'risk']],
  revisits: [['revisita', 'revisit']],
}
// Lo que no se contesta aquí aunque parezca una cifra: datos de personas, sueldos, SQL o saltarse los permisos.
const OUT_OF_SCOPE = ['sueldo', 'salario', 'salary', 'sql', 'select ', 'permiso', 'permission', 'contraseña', 'password', 'tarjeta', 'card number', 'ignora', 'ignore']

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Busca la pregunta definida que corresponde al texto. Si no hay una, es "fuera de lo definido": no se adivina. */
export function matchQuestion(text: string): Askable | 'out_of_scope' {
  const q = ` ${norm(text)} `
  if (OUT_OF_SCOPE.some((w) => q.includes(w))) return 'out_of_scope'
  // Orden: lo más específico primero (calificados antes que leads, primera venta antes que abiertos).
  const order: Askable[] = ['awaiting', 'qualified', 'won', 'lost', 'revisits', 'risk', 'active', 'open', 'leads']
  for (const k of order) if (KEYWORDS[k].some((group) => group.some((w) => q.includes(w)))) return k
  return 'out_of_scope'
}

export const ASK_PERIODS = ['semana', 'mes', 'mes-pasado', '30d', 'trimestre'] as const
export type AskPeriod = (typeof ASK_PERIODS)[number]
/** El periodo que dice el texto, si dice alguno. */
export function periodIn(text: string): AskPeriod | null {
  const q = norm(text)
  if (/mes pasado|last month|mes anterior/.test(q)) return 'mes-pasado'
  if (/semana|week/.test(q)) return 'semana'
  if (/trimestre|quarter/.test(q)) return 'trimestre'
  if (/30 dias|30 days|ultimos 30/.test(q)) return '30d'
  if (/este mes|this month|\bmes\b|month/.test(q)) return 'mes'
  return null
}

// ================================================================ IA-01: captura asistida
/** Lo dictado entra como borrador: o se rechaza (trae un dato prohibido) o queda para que la persona lo revise. */
export type CaptureVerdict = 'draft' | 'rejected'
