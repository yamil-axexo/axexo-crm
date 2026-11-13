import 'server-only'

/**
 * Bóveda de documentos: UNA sola para todo CONTIGO (documentos del expediente de alta, CAMPO-06, y documentos generados,
 * E5.F9). Es tecnología externa y está APAGADA: CONTIGO no guarda archivos. El expediente guarda estado, quién validó, cuándo
 * y la referencia; los documentos generados viven en CONTIGO como texto con su enlace imprimible y su PDF.
 * `off` (por defecto): no llama a nada; abrir un documento del alta queda en la bitácora de lectura con "Bóveda apagada" y un
 * documento generado no se guarda afuera.
 * `simulated` (solo con APP_ENV=test y CONTIGO_DOCUMENT_VAULT=simulated): enlaces y referencias de prueba.
 * Encenderla pide: decisión del comité sobre la bóveda (una sola, compartida con Sales Core), bucket privado con enlaces
 * firmados cortos, clasificación y retención de datos personales, y la aprobación de tecnología (Dan Mulligan o Michael Essiet).
 */
export type VaultMode = 'off' | 'simulated'
export type SignedUrl = { status: 'vault_off' } | { status: 'simulated'; url: string; expiresInSeconds: number }
export type DocumentVault = {
  mode: VaultMode
  envVar: 'CONTIGO_DOCUMENT_VAULT'
  /** Un enlace corto para leer el documento. Apagada: no hay enlace. */
  signedUrl: (storageRef: string) => Promise<SignedUrl>
  /** Guardar un documento generado. Apagada: no guarda nada afuera. */
  store: (doc: { id: string; title: string }) => Promise<{ status: 'channel_off' | 'simulated'; ref: string | null }>
}
export type VaultAdapter = DocumentVault

const g = globalThis as unknown as { __contigoVaultReads?: string[]; __contigoVault?: { id: string; title: string }[] }
export const simulatedVaultReads = () => (g.__contigoVaultReads ??= [])
export const simulatedVault = () => (g.__contigoVault ??= [])

export function documentVault(): DocumentVault {
  const simulated = process.env.APP_ENV === 'test' && process.env.CONTIGO_DOCUMENT_VAULT === 'simulated'
  return {
    mode: simulated ? 'simulated' : 'off',
    envVar: 'CONTIGO_DOCUMENT_VAULT',
    signedUrl: async (ref) => {
      if (!simulated) return { status: 'vault_off' }
      simulatedVaultReads().push(ref)
      return { status: 'simulated', url: `https://vault.invalid/${encodeURIComponent(ref)}`, expiresInSeconds: 60 }
    },
    store: async (doc) => {
      if (!simulated) return { status: 'channel_off', ref: null }
      simulatedVault().push(doc)
      return { status: 'simulated', ref: `sim:${doc.id}` }
    },
  }
}
