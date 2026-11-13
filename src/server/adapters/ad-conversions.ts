import 'server-only'

/**
 * LEAD-02: devolución de conversiones a las plataformas de anuncios (Google, Meta, TikTok, LinkedIn, X). Es tecnología
 * externa: CONTIGO deja lista la cola (crm.conversion_events) y este adaptador es la puerta hacia afuera.
 * `off` (por defecto): no llama a nada; cada conversión queda en la cola con estado "Canal apagado".
 * `simulated` (solo con APP_ENV=test y AD_CONVERSIONS=simulated): anota lo que habría salido, para las pruebas.
 * No hay implementación real: encenderlo pasa primero por la revisión de tecnología, y falta por plataforma la cuenta de
 * anuncios, su credencial y el nombre del evento que cada una espera.
 */
export type AdConversion = { id: string; platform: 'google' | 'meta' | 'tiktok' | 'linkedin' | 'x'; event: 'qualified_lead' | 'purchase'; click_id: string; dedupe_key: string; occurred_at: string }
export type AdConversionsAdapter = {
  mode: 'off' | 'simulated'
  envVar: 'AD_CONVERSIONS'
  send: (batch: AdConversion[]) => Promise<{ status: 'channel_off' | 'simulated'; sent: number }>
}

const g = globalThis as unknown as { __contigoSimulatedConversions?: AdConversion[] }
/** Lo que el adaptador simulado habría mandado en este proceso (solo pruebas). */
export const simulatedConversions = () => (g.__contigoSimulatedConversions ??= [])

export function adConversionsAdapter(): AdConversionsAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env.AD_CONVERSIONS === 'simulated'
  return {
    envVar: 'AD_CONVERSIONS',
    mode: simulated ? 'simulated' : 'off',
    send: async (batch) => {
      if (!simulated) return { status: 'channel_off', sent: 0 }
      simulatedConversions().push(...batch)
      return { status: 'simulated', sent: batch.length }
    },
  }
}
