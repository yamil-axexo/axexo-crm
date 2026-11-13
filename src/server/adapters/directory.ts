import 'server-only'

/**
 * SEG-07: baja automática cuando la cuenta de Google deja de existir (directorio de Google Workspace).
 * Apagado por defecto: no consulta nada. `simulated` solo en pruebas: devuelve la lista que la prueba le deja.
 * Para encenderlo hace falta la revisión técnica de la sincronización y una cuenta de servicio de solo lectura del directorio.
 */
export type DirectoryMode = 'off' | 'simulated'
export const DIRECTORY_ENV = 'DIRECTORY_ADAPTER'

export function directoryMode(): DirectoryMode {
  return process.env[DIRECTORY_ENV] === 'simulated' && process.env.APP_ENV === 'test' ? 'simulated' : 'off'
}

const g = globalThis as unknown as { __contigoDirectoryGone?: string[] }

/** Solo pruebas: correos que el directorio simulado reporta como cuentas que ya no existen. */
export function simulateDirectoryGone(emails: string[]): void {
  g.__contigoDirectoryGone = emails.map((e) => e.toLowerCase())
}

/** Correos cuya cuenta ya no existe o está suspendida. Con el adaptador apagado devuelve null: no se sabe. */
export async function directoryGone(): Promise<string[] | null> {
  if (directoryMode() === 'off') return null
  return g.__contigoDirectoryGone ?? []
}
