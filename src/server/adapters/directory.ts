import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { GOOGLE_SA, directoryActiveEmails } from './live/google'

/**
 * SEG-07: baja automática cuando la cuenta de Google deja de existir (directorio de Google Workspace).
 * Apagado por defecto: no consulta nada. `simulated` solo en pruebas: devuelve la lista que la prueba le deja.
 * `live`: DIRECTORY_ADAPTER=live, cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL y _KEY) con delegación de solo lectura
 * del directorio, GOOGLE_ADMIN_SUBJECT (la persona administradora a la que suplanta) y la aprobación.
 */
export type DirectoryMode = ConnectorMode
export const DIRECTORY_ENV = 'DIRECTORY_ADAPTER'
export const DIRECTORY_GATE = { envVar: DIRECTORY_ENV, credentials: [...GOOGLE_SA, 'GOOGLE_ADMIN_SUBJECT'] } as const

export function directoryMode(): DirectoryMode {
  return gate(DIRECTORY_GATE).mode
}

const g = globalThis as unknown as { __contigoDirectoryGone?: string[] }

/** Solo pruebas: correos que el directorio simulado reporta como cuentas que ya no existen. */
export function simulateDirectoryGone(emails: string[]): void {
  g.__contigoDirectoryGone = emails.map((e) => e.toLowerCase())
}

/**
 * Correos cuya cuenta ya no existe o está suspendida, de entre los que CONTIGO conoce (`known`, solo de los dominios de la
 * organización). Con el adaptador apagado devuelve null: no se sabe. Si el directorio viene vacío, falla: nunca se le quita
 * el acceso a todos por una respuesta rara.
 */
export async function directoryGone(known: string[] = []): Promise<string[] | null> {
  const mode = directoryMode()
  if (mode === 'off') return null
  if (mode === 'live') {
    const active = await directoryActiveEmails()
    return known.map((e) => e.toLowerCase()).filter((e) => !active.has(e))
  }
  return g.__contigoDirectoryGone ?? []
}
