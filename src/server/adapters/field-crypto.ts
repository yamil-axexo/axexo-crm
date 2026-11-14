import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { activeKeyVersion, aesOpen, aesSeal } from './live/providers'

/**
 * SEG-02: cifrado por campo. `live`: AES-256-GCM con llave por variable de entorno y rotación por versión
 * (FIELD_CRYPTO_KEYS = "v1:<base64 de 32 bytes>,v2:...", FIELD_CRYPTO_ACTIVE = "v2"). Se cifra con la versión activa y se
 * lee con cualquiera de la lista; la tarea `conectores.rotar_llaves` vuelve a cifrar lo que quedó con una versión vieja.
 * El servicio de llaves final (KMS) queda [pendiente: Dan Mulligan]: esta implementación es el puente aprobable.
 * Apagado por defecto: el valor se guarda como está, protegido por permisos, tabla aparte y revelado registrado.
 * `simulated` solo en pruebas: una transformación reversible que deja ver que el camino de cifrar y descifrar se usa.
 */
export type CryptoMode = ConnectorMode
export const FIELD_CRYPTO_ENV = 'FIELD_CRYPTO_ADAPTER'
export const FIELD_CRYPTO_GATE = { envVar: FIELD_CRYPTO_ENV, credentials: ['FIELD_CRYPTO_KEYS', 'FIELD_CRYPTO_ACTIVE'] } as const

export function fieldCryptoMode(): CryptoMode {
  const m = gate(FIELD_CRYPTO_GATE).mode
  // Encendido con una versión activa que no está en la lista: no se cifra con nada raro; queda apagado.
  return m === 'live' && !activeKeyVersion() ? 'off' : m
}

export function seal(plain: string): { cipher: string; payload: string } {
  const m = fieldCryptoMode()
  if (m === 'live') return aesSeal(plain)
  if (m === 'simulated') return { cipher: 'sim-b64', payload: Buffer.from(plain, 'utf8').toString('base64') }
  return { cipher: 'none', payload: plain }
}

export function open(cipher: string, payload: string): string {
  if (cipher === 'sim-b64') return Buffer.from(payload, 'base64').toString('utf8')
  if (cipher.startsWith('aes256gcm:')) return aesOpen(cipher, payload)
  return payload
}

/** La etiqueta con la que se cifra hoy (para encontrar lo que hay que rotar). Null si no está encendido. */
export const activeCipher = (): string | null => (fieldCryptoMode() === 'live' ? `aes256gcm:${activeKeyVersion()}` : null)
