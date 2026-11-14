// Reglas de traducción Pipedrive → CONTIGO. Funciones puras (sin base ni red) para que cada regla tenga prueba (AUT-01).
// Qué campo va a qué columna se decide aquí y queda visible en Administración → Pipedrive (columna "Destino").
import { toE164 } from '@/lib/format'

export type PdObject = 'organization' | 'person' | 'deal' | 'activity' | 'product'
export type CrmObject = 'account' | 'contact' | 'deal' | 'activity' | 'product'
export const CRM_OBJECT: Record<PdObject, CrmObject> = { organization: 'account', person: 'contact', deal: 'deal', activity: 'activity', product: 'product' }

export type DataType = 'text' | 'long_text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect' | 'money' | 'user' | 'phone'

export type PdField = {
  code: string
  name: string
  type: string
  options: { id: string; label: string }[]
  custom: boolean
}

export type FieldPlan = {
  object: CrmObject
  key: string
  label: string
  dataType: DataType
  options: string[]
  externalRef: string
  custom: boolean // true = vive en custom_fields del registro de Pipedrive; false = campo estándar en el primer nivel
  mappedTo: string | null
  dataClass: 'internal' | 'confidential'
  position: number
  pdType: string
  pdOptions: { id: string; label: string }[]
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
export const normName = (s: string) => strip(s).replace(/\s+/g, ' ').trim()

/** La API v2 y la v1 nombran distinto las mismas propiedades; aquí quedan en una sola forma. */
export function normalizeField(raw: Record<string, unknown>): PdField | null {
  const code = String(raw.field_code ?? raw.key ?? '')
  const name = String(raw.field_name ?? raw.name ?? '')
  if (!code || !name) return null
  const opts = Array.isArray(raw.options) ? raw.options : []
  return {
    code,
    name,
    type: String(raw.field_type ?? 'varchar'),
    options: opts
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
      .map((o) => ({ id: String(o.id), label: String(o.label ?? o.id) })),
    custom: typeof raw.is_custom_field === 'boolean' ? raw.is_custom_field : /^[0-9a-f]{40}$/.test(code),
  }
}

type Rule = { match: RegExp; to: string }

// Campos de Pipedrive que en CONTIGO son columnas del modelo y no campos custom.
const CORE_RULES: Record<PdObject, Rule[]> = {
  organization: [
    { match: /^market$/, to: 'core:market' },
    { match: /^lifecycle stage$/, to: 'core:lifecycle' },
    { match: /^zone \/ territory$/, to: 'core:territory' },
    { match: /^channel segment$/, to: 'core:segment' },
    { match: /^latitude$/, to: 'core:latitude' },
    { match: /^longitude$/, to: 'core:longitude' },
    { match: /^merchant id emida$/, to: 'alias:emida' },
    { match: /^phone number associated$/, to: 'core:phone' },
    { match: /^email associated$/, to: 'core:email' },
    { match: /^city$/, to: 'core:locality' },
    { match: /^state$/, to: 'core:region' },
  ],
  person: [
    { match: /^market$/, to: 'core:market' },
    { match: /^decision maker$/, to: 'core:decision_maker' },
    { match: /^job title$/, to: 'core:role' },
  ],
  deal: [],
  activity: [],
  product: [],
}

// DATA-06: identificadores oficiales completos y datos financieros de personas no se guardan.
// "last4" conserva los últimos 4 caracteres para reconocer el registro; "omit" no guarda nada.
const POLICY_RULES: Rule[] = [
  { match: /\b(tax id|rfc|ein|curp|nit|tin|vat number)\b/, to: 'policy:last4' },
  { match: /\b(ssn|social security|passport|drivers? licen[cs]e|account number|routing number|clabe|iban|card number|cvv|password|contrasena)\b/, to: 'policy:omit' },
]
const FREE_TEXT_TYPES = new Set(['varchar', 'varchar_auto', 'text', 'int', 'double'])

// Campos estándar de Pipedrive que no tienen columna propia en CONTIGO y se conservan como campo adicional.
const EXTRA_STANDARD: Record<PdObject, string[]> = {
  organization: ['label_ids', 'website', 'linkedin', 'industry', 'annual_revenue', 'employee_count'],
  person: ['label_ids', 'job_title', 'notes', 'phones', 'emails'],
  deal: ['label_ids', 'origin', 'channel', 'probability', 'expected_close_date'],
  activity: ['priority', 'outcome', 'public_description', 'duration'],
  product: [],
}

const TYPE_MAP: Record<string, DataType> = {
  varchar: 'text', varchar_auto: 'text', varchar_options: 'text', text: 'long_text', double: 'number', int: 'number', monetary: 'money',
  date: 'date', enum: 'select', set: 'multiselect', user: 'user', phone: 'phone', boolean: 'boolean',
}

export function slugKey(name: string, taken: Set<string>): string {
  let base = strip(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
  if (!/^[a-z]/.test(base)) base = `f_${base}`.replace(/_+$/g, '')
  if (base.length < 2) base = 'field'
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`
  taken.add(key)
  return key
}

/**
 * Decide, para cada campo de un objeto de Pipedrive, su definición en CONTIGO.
 * `existing` conserva la llave de un campo ya importado aunque en Pipedrive le hayan cambiado el nombre.
 */
export function planFields(pd: PdObject, fields: PdField[], existing: Map<string, string>, taken: Set<string>): FieldPlan[] {
  const out: FieldPlan[] = []
  const extras = new Set(EXTRA_STANDARD[pd])
  fields.forEach((f, i) => {
    if (!f.custom && !extras.has(f.code)) return
    const n = normName(f.name)
    let mappedTo: string | null = null
    let dataClass: FieldPlan['dataClass'] = 'internal'
    if (f.custom) {
      mappedTo = CORE_RULES[pd].find((r) => r.match.test(n))?.to ?? null
      if (!mappedTo && FREE_TEXT_TYPES.has(f.type)) mappedTo = POLICY_RULES.find((r) => r.match.test(n))?.to ?? null
      if (mappedTo?.startsWith('policy:')) dataClass = 'confidential'
    }
    const prior = existing.get(f.code)
    if (prior) taken.add(prior)
    out.push({
      object: CRM_OBJECT[pd],
      key: prior ?? slugKey(f.name, taken),
      label: f.name,
      dataType: TYPE_MAP[f.type] ?? 'text',
      options: f.options.map((o) => o.label),
      externalRef: f.code,
      custom: f.custom,
      mappedTo,
      dataClass,
      position: i,
      pdType: f.type,
      pdOptions: f.options,
    })
  })
  return out
}

// ---------------------------------------------------------------- valores
const luhn = (digits: string) => {
  let sum = 0
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = Number(digits[i])
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}
export const OMITTED = '[dato omitido]'

/**
 * Número de tarjeta: longitud y prefijo de una marca real, y dígito de control. Un IMEI también pasa el dígito de control
 * (15 dígitos, casi siempre empieza con 35) y aquí es un dato de trabajo: con el prefijo y la longitud por marca no se confunde.
 */
export const isCard = (d: string) =>
  !/^(\d)\1+$/.test(d) &&
  ((d.length === 16 && /^(4|5[1-5]|2[2-7]|6|35)/.test(d)) || (d.length === 15 && /^3[47]/.test(d)) || (d.length === 14 && /^3[068]/.test(d)) || (d.length === 13 && /^4/.test(d)) || (d.length === 19 && /^[46]/.test(d))) &&
  luhn(d)

/** SEC-08: si un texto libre trae una tarjeta o un SSN, ese fragmento no entra a la base. */
export function scrub(text: string): string {
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
      const d = m.replace(/\D/g, '')
      const tail = /[ -]$/.test(m) ? m.slice(-1) : ''
      return isCard(d) ? OMITTED + tail : m
    })
    .replace(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, OMITTED)
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&apos;': "'" }
export function htmlToText(html: string | null | undefined, max = 8000): string {
  if (!html) return ''
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|nbsp|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return scrub(text).slice(0, max)
}

export const last4 = (v: unknown): string | null => {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s ? s.slice(-4) : null
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const optionLabel = (raw: unknown, options: { id: string; label: string }[]): string | undefined => {
  if (isEmpty(raw)) return undefined
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as { id?: unknown; label?: unknown }
    if (typeof o.label === 'string' && o.label) return o.label
    raw = o.id
  }
  const id = String(raw)
  return options.find((o) => o.id === id)?.label ?? options.find((o) => o.label === id)?.label ?? id
}

/** Valor crudo del campo dentro del registro de Pipedrive (custom_fields en v2, primer nivel en v1 y en campos estándar). */
export function rawValue(payload: Record<string, unknown>, plan: Pick<FieldPlan, 'externalRef' | 'custom'>): unknown {
  if (plan.custom) {
    const cf = payload.custom_fields as Record<string, unknown> | undefined
    if (cf && plan.externalRef in cf) return cf[plan.externalRef]
  }
  return payload[plan.externalRef]
}

/** Convierte un valor de Pipedrive al formato que guarda CONTIGO en `custom`. undefined = no hay valor. */
export function convertValue(plan: Pick<FieldPlan, 'dataType' | 'pdType' | 'pdOptions'>, raw: unknown, users: Map<string, string>): unknown {
  if (isEmpty(raw)) return undefined
  switch (plan.dataType) {
    case 'select':
      return optionLabel(raw, plan.pdOptions)
    case 'multiselect': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim())
      const labels = list.map((x) => optionLabel(x, plan.pdOptions)).filter((x): x is string => Boolean(x))
      return labels.length ? labels : undefined
    }
    case 'money': {
      const o = (typeof raw === 'object' && raw !== null ? raw : { value: raw }) as { value?: unknown; amount?: unknown; currency?: unknown }
      const amount = Number(o.value ?? o.amount)
      if (!Number.isFinite(amount)) return undefined
      return { amount, currency: typeof o.currency === 'string' && o.currency ? o.currency : null }
    }
    case 'number': {
      const n = Number(typeof raw === 'object' && raw !== null ? (raw as { value?: unknown }).value : raw)
      return Number.isFinite(n) ? n : undefined
    }
    case 'date': {
      const s = String(typeof raw === 'object' && raw !== null ? (raw as { value?: unknown }).value : raw)
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined
    }
    case 'boolean':
      return raw === true || raw === 1 || raw === '1' || raw === 'true'
    case 'user': {
      const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : raw
      return users.get(String(id)) ?? `#${String(id)}`
    }
    case 'phone': {
      if (Array.isArray(raw)) {
        const vals = raw.map((x) => (typeof x === 'object' && x !== null ? String((x as { value?: unknown }).value ?? '') : String(x))).filter(Boolean)
        return vals.length ? vals.join(', ') : undefined
      }
      return String(typeof raw === 'object' && raw !== null ? ((raw as { value?: unknown }).value ?? '') : raw).trim() || undefined
    }
    default: {
      if (Array.isArray(raw)) {
        const vals = raw.map((x) => (typeof x === 'object' && x !== null ? String((x as { value?: unknown; label?: unknown }).value ?? (x as { label?: unknown }).label ?? '') : String(x))).filter(Boolean)
        return vals.length ? scrub(vals.join(', ')).slice(0, 4000) : undefined
      }
      if (typeof raw === 'object' && raw !== null) {
        const o = raw as Record<string, unknown>
        if (plan.pdType === 'daterange' || plan.pdType === 'timerange') return [o.value, o.until].filter(Boolean).join(' → ') || undefined
        const v = o.formatted_address ?? o.value ?? o.name ?? o.label
        return v ? scrub(String(v)).slice(0, 4000) : undefined
      }
      const s = scrub(String(raw)).trim()
      return s ? s.slice(0, 4000) : undefined
    }
  }
}

// ---------------------------------------------------------------- mercado, motor, etapas de vida
const COUNTRY: Record<string, string> = {
  mx: 'MX', mex: 'MX', mexico: 'MX',
  us: 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states': 'US', 'united states of america': 'US', 'estados unidos': 'US', eeuu: 'US',
  sv: 'SV', 'el salvador': 'SV',
}
export const countryCode = (name: unknown): string | null => (typeof name === 'string' ? (COUNTRY[normName(name)] ?? null) : null)

export function marketFromPipelineName(name: string): string | null {
  const m = /^\s*([A-Za-z]{2})\s*[-\u2013\u2014:|]/.exec(name)
  return m ? m[1]!.toUpperCase() : null
}

export function marketFromPhone(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.replace(/[\s()-]/g, '') : ''
  if (s.startsWith('+52')) return 'MX'
  if (s.startsWith('+503')) return 'SV'
  if (/^\+1\d{10}$/.test(s)) return 'US'
  return null
}

export function motorFromPipelineName(name: string): string {
  const n = normName(name)
  if (/conference|expo|event|feria/.test(n)) return 'event'
  if (/order|pedido/.test(n)) return 'orders'
  if (/d2d|store|tienda/.test(n)) return 'd2d'
  if (/b2b|iso|cadena|distribu/.test(n)) return 'b2b'
  if (/dealer/.test(n)) return 'dealer'
  return 'other'
}
/** PIPE-06: los embudos de alta se cierran con la primera transacción; eventos y pedidos se cierran a mano. */
export const closesByTransaction = (motor: string) => motor === 'd2d' || motor === 'b2b' || motor === 'dealer'

const LIFECYCLES = ['prospect', 'onboarding', 'active', 'at_risk', 'inactive', 'churned'] as const
export type Lifecycle = (typeof LIFECYCLES)[number]
export function lifecycleFromLabel(label: unknown): Lifecycle | null {
  if (typeof label !== 'string') return null
  const n = normName(label)
  if (/inactiv/.test(n)) return 'inactive'
  if (/churn|baja|lost/.test(n)) return 'churned'
  if (/risk|riesgo/.test(n)) return 'at_risk'
  if (/onboard|alta/.test(n)) return 'onboarding'
  if (/activ/.test(n)) return 'active'
  if (/prospect|lead/.test(n)) return 'prospect'
  return null
}

export function contactRole(jobTitle: unknown, decisionMaker: unknown): 'owner' | 'decision_maker' | 'manager' | 'staff' {
  const j = typeof jobTitle === 'string' ? normName(jobTitle) : ''
  const dm = typeof decisionMaker === 'string' ? /^(yes|si|true)$/.test(normName(decisionMaker)) : decisionMaker === true
  if (/owner|dueno|propietari/.test(j)) return 'owner'
  if (dm) return 'decision_maker'
  if (/manager|gerente|encargad/.test(j)) return 'manager'
  return 'staff'
}

export function activityKind(typeKey: string, typeName: string): 'call' | 'meeting' | 'task' | 'email' {
  const n = normName(`${typeKey} ${typeName}`)
  if (/call|llamada/.test(n)) return 'call'
  if (/email|correo/.test(n)) return 'email'
  if (/meeting|lunch|visit|reunion|visita/.test(n)) return 'meeting'
  return 'task'
}

export function lossCode(text: string): string {
  const slug = strip(text).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return `pd_${slug || 'unspecified'}`
}

export const phoneE164 = (raw: unknown, phoneCc: string): string | null => {
  if (Array.isArray(raw)) {
    const primary = raw.find((x) => typeof x === 'object' && x !== null && (x as { primary?: boolean }).primary) ?? raw[0]
    raw = typeof primary === 'object' && primary !== null ? (primary as { value?: unknown }).value : primary
  }
  return typeof raw === 'string' ? toE164(raw, phoneCc) : null
}

export const primaryValue = (list: unknown): string | null => {
  if (!Array.isArray(list)) return typeof list === 'string' && list ? list : null
  const pick = list.find((x) => typeof x === 'object' && x !== null && (x as { primary?: boolean }).primary) ?? list[0]
  const v = typeof pick === 'object' && pick !== null ? (pick as { value?: unknown }).value : pick
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export const validEmail = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : null
}

export const toMinor = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 1e13 ? Math.round(n * 100) : null
}

export const isoTime = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : v.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const coord = (v: unknown, max: number): number | null => {
  const n = Number(v)
  return v !== null && v !== '' && Number.isFinite(n) && Math.abs(n) <= max && n !== 0 ? Math.round(n * 1e6) / 1e6 : null
}
