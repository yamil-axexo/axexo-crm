import 'server-only'
import { hasProhibited } from '@/domain/guard'
import { DomainError } from '@/lib/errors'

// AUT-01: las reglas de entrada de un registro, en un solo lugar. Las aplican igual las cuatro vías por las que un
// comercio, un negocio o un lead entra a CONTIGO: la pantalla, la API, la importación y las automatizaciones.
// La pantalla y la API rechazan y dicen por qué; la importación, que trae miles de filas, salta la fila y deja el
// motivo en el resumen de la corrida. La regla es la misma función en los tres casos (tests/db/automatizaciones.test.ts).

export type Broken = 'name' | 'prohibited' | 'phone' | 'amount' | 'lost_reason'

const E164 = /^\+[1-9][0-9]{6,14}$/
const named = (s: string | null | undefined, min = 2, max = 240) => {
  const n = (s ?? '').trim().length
  return n >= min && n <= max
}

export function accountRule(a: { name: string | null | undefined; phone?: string | null }): Broken | null {
  if (!named(a.name)) return 'name'
  if (hasProhibited(a.name)) return 'prohibited'
  if (a.phone && !E164.test(a.phone)) return 'phone'
  return null
}

export function dealRule(d: { title: string | null | undefined; amount_minor?: number | string | null; status?: string | null; loss_reason_code?: string | null; next_step?: string | null; loss_note?: string | null }): Broken | null {
  if (!named(d.title)) return 'name'
  if (hasProhibited(d.title, d.next_step, d.loss_note)) return 'prohibited'
  if (d.amount_minor !== null && d.amount_minor !== undefined && !(Number(d.amount_minor) >= 0)) return 'amount'
  if (d.status === 'lost' && !d.loss_reason_code) return 'lost_reason'
  return null
}

export function leadRule(l: { business_name: string | null | undefined; contact_name?: string | null; phone?: string | null; message?: string | null }): Broken | null {
  if (!named(l.business_name)) return 'name'
  if (hasProhibited(l.business_name, l.contact_name, l.message)) return 'prohibited'
  if (l.phone && !E164.test(l.phone)) return 'phone'
  return null
}

const TEXT: Record<Broken, [es: string, en: string]> = {
  name: ['El nombre va de 2 a 240 letras.', 'The name must be 2 to 240 characters.'],
  prohibited: ['Ese texto parece traer un número de tarjeta, de cuenta bancaria o un SSN. Ese dato no se guarda en CONTIGO: quítalo e intenta de nuevo.', 'That text looks like it has a card number, a bank account number or an SSN. CONTIGO does not store that: remove it and try again.'],
  phone: ['El teléfono no parece válido.', 'The phone number does not look valid.'],
  amount: ['El monto es un número de cero en adelante.', 'The amount is a number, zero or more.'],
  lost_reason: ['Un negocio perdido lleva motivo.', 'A lost deal carries a reason.'],
}

/** El mismo incumplimiento, dicho a una persona (pantalla y API). */
export const intakeError = (b: Broken) => new DomainError(b === 'prohibited' ? 'invalid' : 'invalid', TEXT[b][0], TEXT[b][1])
/** El mismo incumplimiento, como motivo de una fila que la importación salta. */
export const skipReason = (b: Broken) => `rule_${b}`
