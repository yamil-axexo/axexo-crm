import 'server-only'

/**
 * Bóveda de documentos del alta (CAMPO-06). Es tecnología externa: CONTIGO NO guarda archivos. El expediente guarda el
 * estado de cada documento, quién lo validó y cuándo, y un enlace o la referencia que dejaría la bóveda.
 * Dos implementaciones:
 * `off` (por defecto): no llama a nada; abrir un documento queda en la bitácora de lectura con "Bóveda apagada".
 * `simulated` (solo con APP_ENV=test y CONTIGO_DOCUMENT_VAULT=simulated): devuelve un enlace de prueba, para las pruebas.
 * Encenderla pide: decisión del comité sobre la bóveda (una sola, compartida con Sales Core), bucket privado con enlaces
 * firmados cortos, clasificación y retención de datos personales, y la aprobación de tecnología.
 */
export type VaultMode = 'off' | 'simulated'
export type SignedUrl = { status: 'vault_off' } | { status: 'simulated'; url: string; expiresInSeconds: number }
export type DocumentVault = {
  mode: VaultMode
  envVar: 'CONTIGO_DOCUMENT_VAULT'
  /** Un enlace corto para leer el documento. Apagada: no hay enlace. */
  signedUrl: (storageRef: string) => Promise<SignedUrl>
}

const g = globalThis as unknown as { __contigoVaultReads?: string[] }
export const simulatedVaultReads = () => (g.__contigoVaultReads ??= [])

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
  }
}
