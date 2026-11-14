import 'server-only'
import { isCard, scrub } from '@/domain/pipedrive/mapping'
import { invalid } from '@/lib/errors'

/** CLABE (cuenta bancaria en México): 18 dígitos con dígito de control. */
function isClabe(d: string): boolean {
  const w = [3, 7, 1]
  let sum = 0
  for (let i = 0; i < 17; i++) sum += (Number(d[i]) * w[i % 3]!) % 10
  return (10 - (sum % 10)) % 10 === Number(d[17])
}
function hasClabe(text: string): boolean {
  for (const m of text.matchAll(/(?<!\d)\d{18}(?!\d)/g)) if (isClabe(m[0])) return true
  return false
}

/**
 * SEG-04 (DLP): en texto libre, una cuenta bancaria (CLABE) o un SSN se tapan y quedan solo los últimos 4, y quien escribe
 * recibe el aviso; no se rechaza la nota entera. Una tarjeta válida (marca, longitud y dígito de control) NO se tapa aquí:
 * sigue bloqueando al guardar (assertNoProhibited), porque ni siquiera tapada debe entrar a CONTIGO.
 */
export function dlpMask(text: string): { text: string; masked: boolean } {
  if (!text) return { text, masked: false }
  let masked = false
  const out = text
    .replace(/(?<!\d)\d{18}(?!\d)/g, (d) => {
      if (!isClabe(d)) return d
      masked = true
      return `[cuenta ••${d.slice(-4)}]`
    })
    .replace(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)(\d{4})\b/g, (_m, last: string) => {
      masked = true
      return `[SSN ••${last}]`
    })
  return { text: out, masked }
}

/** ¿Trae una tarjeta válida? (la única que bloquea). */
export function hasCardNumber(text: string | null | undefined): boolean {
  if (!text) return false
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) if (isCard(m[0].replace(/\D/g, ''))) return true
  return false
}

/**
 * SEC-08 / DATA-06: una tarjeta, un SSN o una cuenta bancaria no entran por texto libre (notas, asuntos, próximo paso).
 * Se rechaza al guardar y se le dice a la persona por qué; no se guarda una versión recortada a escondidas.
 */
/** ¿Alguno de los textos trae un dato que CONTIGO no guarda? Es la única detección: la usan la pantalla, la API, la importación y las automatizaciones. */
export function hasProhibited(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => Boolean(t) && (scrub(t!) !== t || hasClabe(t!)))
}

export function assertNoProhibited(...texts: (string | null | undefined)[]): void {
  if (hasProhibited(...texts)) {
    throw invalid(
      'Ese texto parece traer un número de tarjeta, de cuenta bancaria o un SSN. Ese dato no se guarda en CONTIGO: quítalo e intenta de nuevo.',
      'That text looks like it has a card number, a bank account number or an SSN. CONTIGO does not store that: remove it and try again.',
    )
  }
}
