import 'server-only'

/**
 * Regla única de encendido de un conector ("construido completo y apagado").
 * Un adaptador sale hacia afuera (`live`) SOLO si se cumplen las tres a la vez:
 *   1. `<VARIABLE>=live`
 *   2. todas las variables de credencial del proveedor presentes (nunca se leen ni se muestran sus valores)
 *   3. `<VARIABLE>_APPROVAL` con la referencia del sign-off escrito (Dan Mulligan o Michael Essiet), texto libre
 * Si falta cualquiera, queda en `off` y `missing` dice exactamente qué falta (solo nombres de variables).
 * `simulated` sigue existiendo solo con APP_ENV=test.
 */
export type ConnectorMode = 'off' | 'simulated' | 'live'
export type GateSpec = {
  envVar: string
  /** Variables que tienen que existir para que el conector salga. */
  credentials: readonly string[]
  /** Variante: basta con que UNO de estos grupos esté completo (por ejemplo, una plataforma de anuncios). */
  anyOf?: readonly (readonly string[])[]
}
export type Gate = { mode: ConnectorMode; missing: string[]; approval: string | null; requested: 'off' | 'simulated' | 'live' }

export const approvalVar = (envVar: string) => `${envVar}_APPROVAL`
const present = (name: string) => {
  const v = process.env[name]
  return typeof v === 'string' && v.trim().length > 0
}

/** La referencia del sign-off: texto libre, recortado, sin saltos de línea. Menos de 3 caracteres no cuenta. */
export function approvalRef(envVar: string): string | null {
  const raw = process.env[approvalVar(envVar)]
  if (!raw) return null
  const v = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
  return v.length >= 3 ? v : null
}

export function gate(spec: GateSpec): Gate {
  const raw = (process.env[spec.envVar] ?? '').trim()
  const approval = approvalRef(spec.envVar)
  if (raw === 'simulated' && process.env.APP_ENV === 'test') return { mode: 'simulated', missing: [], approval, requested: 'simulated' }
  const missing: string[] = []
  if (raw !== 'live') missing.push(spec.envVar)
  for (const c of spec.credentials) if (!present(c)) missing.push(c)
  if (spec.anyOf && spec.anyOf.length > 0 && !spec.anyOf.some((group) => group.every(present))) {
    // Ningún grupo completo: se listan las variables de todos los grupos, sin repetir.
    for (const c of new Set(spec.anyOf.flat())) if (!present(c) && !missing.includes(c)) missing.push(c)
  }
  if (!approval) missing.push(approvalVar(spec.envVar))
  return { mode: missing.length === 0 ? 'live' : 'off', missing, approval, requested: raw === 'live' ? 'live' : 'off' }
}

/** Atajo: el modo nada más. */
export const modeOf = (spec: GateSpec): ConnectorMode => gate(spec).mode
