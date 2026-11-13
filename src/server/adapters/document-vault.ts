import 'server-only'

/**
 * E5.F9: bóveda de documentos (almacenamiento de archivos). Es un sistema externo y está APAGADO.
 * `off` (por defecto): no guarda nada afuera; el documento vive en CONTIGO como texto y queda su enlace imprimible.
 * `simulated` (solo con APP_ENV=test y DOCUMENT_VAULT=simulated): anota lo que habría guardado, para las pruebas.
 * Encenderlo pasa por la revisión de tecnología (Dan Mulligan o Michael Essiet) y la elección del almacenamiento.
 */
export type VaultAdapter = { mode: 'off' | 'simulated'; envVar: 'DOCUMENT_VAULT'; store: (doc: { id: string; title: string }) => Promise<{ status: 'channel_off' | 'simulated'; ref: string | null }> }

const g = globalThis as unknown as { __contigoVault?: { id: string; title: string }[] }
export const simulatedVault = () => (g.__contigoVault ??= [])

export function documentVault(): VaultAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env.DOCUMENT_VAULT === 'simulated'
  return {
    mode: simulated ? 'simulated' : 'off',
    envVar: 'DOCUMENT_VAULT',
    store: async (doc) => {
      if (!simulated) return { status: 'channel_off', ref: null }
      simulatedVault().push(doc)
      return { status: 'simulated', ref: `sim:${doc.id}` }
    },
  }
}
