// MULTI-03: validación del identificador fiscal, capa 1 (formato y dígito verificador). Puro: sin base, sin red.
// El identificador es TEXTO normalizado (letras y números), nunca un número: el CNPJ de Brasil trae letras desde julio de 2026.

export type TaxIdType = 'mx_rfc' | 'us_ein' | 'co_nit' | 'sv_nit' | 'br_cnpj' | 'other'

export const TAX_ID_TYPES: { type: TaxIdType; country: string; es: string; en: string; example: string }[] = [
  { type: 'mx_rfc', country: 'MX', es: 'RFC (México)', en: 'RFC (Mexico)', example: 'ABC680524P76' },
  { type: 'us_ein', country: 'US', es: 'EIN (Estados Unidos y Puerto Rico)', en: 'EIN (United States and Puerto Rico)', example: '12-3456789' },
  { type: 'co_nit', country: 'CO', es: 'NIT (Colombia)', en: 'NIT (Colombia)', example: '800088702-2' },
  { type: 'sv_nit', country: 'SV', es: 'NIT (El Salvador)', en: 'NIT (El Salvador)', example: '0614-050707-104-8' },
  { type: 'br_cnpj', country: 'BR', es: 'CNPJ (Brasil)', en: 'CNPJ (Brazil)', example: '12.ABC.345/01DE-35' },
  { type: 'other', country: 'ZZ', es: 'Otro país (sin validador: lo revisa una persona)', en: 'Another country (no validator: a person reviews it)', example: '' },
]

/** El tipo que se propone para un mercado. Un país sin validador propio cae en "otro" y pasa a revisión humana. */
export function taxIdTypeFor(country: string): TaxIdType {
  const c = country.toUpperCase()
  if (c === 'MX') return 'mx_rfc'
  if (c === 'US' || c === 'PR') return 'us_ein'
  if (c === 'CO') return 'co_nit'
  if (c === 'SV') return 'sv_nit'
  if (c === 'BR') return 'br_cnpj'
  return 'other'
}

export type TaxIdProblem = 'empty' | 'format' | 'ssn' | 'generic' | 'date' | 'prefix'

export type TaxIdCheck = {
  /** Texto normalizado: mayúsculas, sin espacios, puntos, guiones ni diagonales. Solo vive en memoria durante la captura. */
  normalized: string
  formatOk: boolean
  /** null: ese tipo no trae dígito verificador (EIN, otros países). */
  checksumOk: boolean | null
  problem?: TaxIdProblem
  /** Persona física (RFC de 13) o moral (RFC de 12); solo México. */
  person?: 'natural' | 'legal'
}

export function normalizeTaxId(raw: string): string {
  return raw.normalize('NFC').toUpperCase().replace(/[\s.\-/_]/g, '')
}

const RFC_ALPHABET = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ'
function rfcCheckDigit(body: string): string {
  const padded = ('   ' + body).slice(-12)
  let sum = 0
  for (let i = 0; i < padded.length; i++) sum += RFC_ALPHABET.indexOf(padded[i]!) * (13 - i)
  return RFC_ALPHABET[(11 - (sum % 11)) % 11]!
}
const validYmd = (yy: string, mm: string, dd: string) => {
  const m = Number(mm)
  const d = Number(dd)
  if (m < 1 || m > 12 || d < 1) return false
  // Sin siglo no se sabe si el año es bisiesto: febrero admite 29.
  return d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]! && /^\d{2}$/.test(yy)
}

function checkRfc(n: string): TaxIdCheck {
  const m = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z0-9]{2})([0-9A])$/.exec(n)
  if (!m) return { normalized: n, formatOk: false, checksumOk: null, problem: 'format' }
  // Los RFC genéricos (público en general, extranjeros) no identifican a ningún comercio.
  if (n === 'XAXX010101000' || n === 'XEXX010101000') return { normalized: n, formatOk: false, checksumOk: null, problem: 'generic' }
  if (!validYmd(m[2]!, m[3]!, m[4]!)) return { normalized: n, formatOk: false, checksumOk: null, problem: 'date' }
  return { normalized: n, formatOk: true, checksumOk: rfcCheckDigit(n.slice(0, -1)) === n.slice(-1), person: m[1]!.length === 4 ? 'natural' : 'legal' }
}

// Prefijos que el IRS ha asignado a un EIN. El EIN no trae dígito verificador.
const EIN_PREFIXES = new Set(
  ['01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16', '20', '21', '22', '23', '24', '25', '26', '27', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
    '40', '41', '42', '43', '44', '45', '46', '47', '48', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66', '67', '68',
    '71', '72', '73', '74', '75', '76', '77', '80', '81', '82', '83', '84', '85', '86', '87', '88', '90', '91', '92', '93', '94', '95', '98', '99'],
)
function checkEin(raw: string, n: string): TaxIdCheck {
  // Un SSN (tres, dos y cuatro números) nunca se captura como identificador fiscal: el estándar lo prohíbe. Se pide el EIN.
  if (/^\s*\d{3}[-\s]\d{2}[-\s]\d{4}\s*$/.test(raw)) return { normalized: '', formatOk: false, checksumOk: null, problem: 'ssn' }
  if (!/^\d{9}$/.test(n)) return { normalized: n, formatOk: false, checksumOk: null, problem: 'format' }
  if (!EIN_PREFIXES.has(n.slice(0, 2))) return { normalized: n, formatOk: false, checksumOk: null, problem: 'prefix' }
  return { normalized: n, formatOk: true, checksumOk: null }
}

function checkNitCo(n: string): TaxIdCheck {
  if (!/^\d{8,16}$/.test(n)) return { normalized: n, formatOk: false, checksumOk: null, problem: 'format' }
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
  const body = n.slice(0, -1).split('').reverse()
  const sum = body.reduce((acc, d, i) => acc + weights[i]! * Number(d), 0) % 11
  return { normalized: n, formatOk: true, checksumOk: '01987654321'[sum] === n.slice(-1) }
}

function checkNitSv(n: string): TaxIdCheck {
  if (!/^[0149]\d{13}$/.test(n)) return { normalized: n, formatOk: false, checksumOk: null, problem: 'format' }
  const digits = n.slice(0, 13).split('').map(Number)
  let expected: number
  if (n.slice(10, 13) <= '100') {
    const total = digits.reduce((acc, d, i) => acc + d * (14 - i), 0)
    expected = (total % 11) % 10
  } else {
    const weights = [2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    const total = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0)
    expected = (((-total % 11) + 11) % 11) % 10
  }
  return { normalized: n, formatOk: true, checksumOk: String(expected) === n.slice(-1) }
}

function checkCnpj(n: string): TaxIdCheck {
  // Doce posiciones de letras o números y dos dígitos verificadores. Cada carácter vale su código menos 48.
  if (!/^[0-9A-Z]{12}\d{2}$/.test(n) || /^(.)\1{13}$/.test(n)) return { normalized: n, formatOk: false, checksumOk: null, problem: 'format' }
  const dv = (s: string) => {
    let weight = 2
    let total = 0
    for (let i = s.length - 1; i >= 0; i--) {
      total += (s.charCodeAt(i) - 48) * weight
      weight = weight === 9 ? 2 : weight + 1
    }
    const r = total % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(n.slice(0, 12))
  const d2 = dv(n.slice(0, 12) + d1)
  return { normalized: n, formatOk: true, checksumOk: `${d1}${d2}` === n.slice(12) }
}

/** Capa 1: formato y dígito verificador, según el tipo. No consulta ningún registro. */
export function checkTaxId(type: TaxIdType, raw: string): TaxIdCheck {
  const n = normalizeTaxId(raw)
  if (!n) return { normalized: '', formatOk: false, checksumOk: null, problem: 'empty' }
  if (type === 'mx_rfc') return checkRfc(n)
  if (type === 'us_ein') return checkEin(raw, n)
  if (type === 'co_nit') return checkNitCo(n)
  if (type === 'sv_nit') return checkNitSv(n)
  if (type === 'br_cnpj') return checkCnpj(n)
  // Sin validador propio: letras y números, entre 5 y 20. Lo confirma una persona con el documento a la vista.
  if (/^\s*\d{3}[-\s]\d{2}[-\s]\d{4}\s*$/.test(raw)) return { normalized: '', formatOk: false, checksumOk: null, problem: 'ssn' }
  return /^[0-9A-Z]{5,20}$/.test(n) ? { normalized: n, formatOk: true, checksumOk: null } : { normalized: n, formatOk: false, checksumOk: null, problem: 'format' }
}

export const taxIdLast4 = (normalized: string) => normalized.replace(/[^A-Z0-9]/g, '').slice(-4)

/** Cómo se muestra un identificador ya guardado: solo los últimos 4. */
export const maskedTaxId = (last4: string) => `•••• ${last4}`

export const TAX_STATUS: Record<'format_valid' | 'needs_review' | 'verified' | 'rejected', { es: string; en: string; tone: 'good' | 'warn' | 'bad' | 'info' }> = {
  format_valid: { es: 'Formato válido, falta revisarlo', en: 'Valid format, review pending', tone: 'info' },
  needs_review: { es: 'Necesita revisión', en: 'Needs review', tone: 'warn' },
  verified: { es: 'Revisado y aprobado', en: 'Reviewed and approved', tone: 'good' },
  rejected: { es: 'Rechazado', en: 'Rejected', tone: 'bad' },
}
