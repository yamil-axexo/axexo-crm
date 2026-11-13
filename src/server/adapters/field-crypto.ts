import 'server-only'

/**
 * SEG-02: cifrado por campo con llaves gestionadas (KMS de la plataforma de producción).
 * Apagado por defecto: el valor se guarda como está, protegido por permisos, tabla aparte y revelado registrado.
 * `simulated` solo en pruebas: una transformación reversible que deja ver que el camino de cifrar y descifrar se usa.
 * Para encenderlo hace falta el mecanismo aprobado en la revisión técnica y una implementación `live` aquí.
 */
export type CryptoMode = 'off' | 'simulated'
export const FIELD_CRYPTO_ENV = 'FIELD_CRYPTO_ADAPTER'

export function fieldCryptoMode(): CryptoMode {
  return process.env[FIELD_CRYPTO_ENV] === 'simulated' && process.env.APP_ENV === 'test' ? 'simulated' : 'off'
}

export function seal(plain: string): { cipher: string; payload: string } {
  if (fieldCryptoMode() === 'simulated') return { cipher: 'sim-b64', payload: Buffer.from(plain, 'utf8').toString('base64') }
  return { cipher: 'none', payload: plain }
}

export function open(cipher: string, payload: string): string {
  if (cipher === 'sim-b64') return Buffer.from(payload, 'base64').toString('utf8')
  return payload
}
