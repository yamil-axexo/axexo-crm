import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/**
 * UX-02: cómo se interpreta lo que alguien escribe en la búsqueda.
 * - Teléfono: el número completo normalizado a E.164 (con o sin código de país, con espacios o guiones), una lectura por
 *   cada mercado de la persona. Se compara EXACTO contra el teléfono guardado (que ya está en E.164): nunca por pedazo.
 * - Texto: palabras para la búsqueda de texto completo (índice GIN), cada una como prefijo.
 */
export function phoneCandidates(term: string, countries: string[]): string[] {
  const raw = term.trim()
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length < 7 || digits.length > 15) return []
  // Si trae letras no es un teléfono.
  if (/[a-z]/i.test(raw.replace(/ext\.?/i, ''))) return []
  const out = new Set<string>()
  const tryParse = (text: string, country?: CountryCode) => {
    const p = parsePhoneNumberFromString(text, country)
    if (p && p.isPossible()) out.add(p.number)
  }
  if (raw.startsWith('+') || raw.startsWith('00')) tryParse(raw.startsWith('00') ? `+${digits.slice(2)}` : raw)
  else for (const c of countries) tryParse(raw, c.toUpperCase() as CountryCode)
  return [...out]
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Prefijos para to_tsquery('simple', ...). `accents=false` quita acentos (para comparar con columnas normalizadas). */
export function textQuery(term: string, accents: boolean): string | null {
  const base = accents ? term.toLowerCase() : strip(term.toLowerCase())
  const words = base.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 6)
  if (words.length === 0) return null
  return words.map((w) => `${w}:*`).join(' & ')
}
