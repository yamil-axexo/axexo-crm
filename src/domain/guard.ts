import 'server-only'
import { scrub } from '@/domain/pipedrive/mapping'
import { invalid } from '@/lib/errors'

/** CLABE (cuenta bancaria en México): 18 dígitos con dígito de control. */
function hasClabe(text: string): boolean {
  for (const m of text.matchAll(/(?<!\d)\d{18}(?!\d)/g)) {
    const d = m[0]
    const w = [3, 7, 1]
    let sum = 0
    for (let i = 0; i < 17; i++) sum += (Number(d[i]) * w[i % 3]!) % 10
    if ((10 - (sum % 10)) % 10 === Number(d[17])) return true
  }
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
