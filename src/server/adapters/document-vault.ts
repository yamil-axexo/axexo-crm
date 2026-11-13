import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { SUPABASE_ADMIN, storagePut, storageSign } from './live/supabase'
import { errorCode } from './live/http'

/**
 * Bóveda de documentos: UNA sola para todo CONTIGO (documentos del expediente de alta, CAMPO-06, y documentos generados,
 * E5.F9). `live` = Supabase Storage, bucket privado, enlaces firmados de 60 segundos y huella SHA-256 guardada.
 * `off` (por defecto): no llama a nada; abrir un documento del alta queda en la bitácora de lectura con "Bóveda apagada" y un
 * documento generado no se guarda afuera.
 * `simulated` (solo con APP_ENV=test y CONTIGO_DOCUMENT_VAULT=simulated): enlaces y referencias de prueba.
 * Encenderla: CONTIGO_DOCUMENT_VAULT=live, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTIGO_VAULT_BUCKET (privado) y
 * CONTIGO_DOCUMENT_VAULT_APPROVAL con la referencia del sign-off (Dan Mulligan o Michael Essiet).
 */
export type VaultMode = ConnectorMode
export type SignedUrl = { status: 'vault_off' } | { status: 'simulated' | 'signed'; url: string; expiresInSeconds: number } | { status: 'failed'; error: string }
export type StoreResult = { status: 'channel_off' | 'simulated' | 'stored' | 'failed'; ref: string | null; sha256?: string; error?: string }
export type DocumentVault = {
  mode: VaultMode
  envVar: 'CONTIGO_DOCUMENT_VAULT'
  /** Un enlace corto para leer el documento. Apagada: no hay enlace. */
  signedUrl: (storageRef: string) => Promise<SignedUrl>
  /** Guardar un documento generado. Apagada: no guarda nada afuera. */
  store: (doc: { id: string; title: string; content?: string; contentType?: string }) => Promise<StoreResult>
}
export type VaultAdapter = DocumentVault
export const VAULT_GATE = { envVar: 'CONTIGO_DOCUMENT_VAULT', credentials: [...SUPABASE_ADMIN, 'CONTIGO_VAULT_BUCKET'] } as const
export const VAULT_URL_SECONDS = 60

const g = globalThis as unknown as { __contigoVaultReads?: string[]; __contigoVault?: { id: string; title: string }[] }
export const simulatedVaultReads = () => (g.__contigoVaultReads ??= [])
export const simulatedVault = () => (g.__contigoVault ??= [])

/** "bucket/ruta" o solo "ruta" (en el bucket de la bóveda). */
const split = (ref: string): { bucket: string; path: string } => {
  const bucket = process.env.CONTIGO_VAULT_BUCKET ?? ''
  return ref.startsWith(`${bucket}/`) ? { bucket, path: ref.slice(bucket.length + 1) } : { bucket, path: ref }
}

export function documentVault(): DocumentVault {
  const mode = gate(VAULT_GATE).mode
  return {
    mode,
    envVar: 'CONTIGO_DOCUMENT_VAULT',
    signedUrl: async (ref) => {
      if (mode === 'live') {
        try {
          const s = split(ref)
          return { status: 'signed', url: await storageSign('document_vault', s.bucket, s.path, VAULT_URL_SECONDS), expiresInSeconds: VAULT_URL_SECONDS }
        } catch (e) {
          return { status: 'failed', error: errorCode(e) }
        }
      }
      if (mode !== 'simulated') return { status: 'vault_off' }
      simulatedVaultReads().push(ref)
      return { status: 'simulated', url: `https://vault.invalid/${encodeURIComponent(ref)}`, expiresInSeconds: 60 }
    },
    store: async (doc) => {
      if (mode === 'live') {
        try {
          const out = await storagePut('document_vault', process.env.CONTIGO_VAULT_BUCKET ?? '', `generated/${doc.id}.txt`, doc.content ?? doc.title, doc.contentType ?? 'text/plain; charset=utf-8')
          return { status: 'stored', ref: out.ref, sha256: out.sha256 }
        } catch (e) {
          return { status: 'failed', ref: null, error: errorCode(e) }
        }
      }
      if (mode !== 'simulated') return { status: 'channel_off', ref: null }
      simulatedVault().push(doc)
      return { status: 'simulated', ref: `sim:${doc.id}` }
    },
  }
}
