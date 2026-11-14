import 'server-only'

type Raw = Record<string, string | string[] | undefined>

/**
 * Parámetros de la URL como texto. Un parámetro repetido (?q=a&q=b) llega como arreglo y uno larguísimo no aporta nada:
 * las pantallas reciben siempre un solo valor, recortado. Sin esto, un enlace manipulado tiraba la página con un 500.
 */
export function flat<T extends Record<string, string | undefined>>(sp: Raw | T): T {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(sp as Raw)) {
    const first = Array.isArray(v) ? v[0] : v
    out[k] = typeof first === 'string' ? first.slice(0, 200) : undefined
  }
  return out as T
}
