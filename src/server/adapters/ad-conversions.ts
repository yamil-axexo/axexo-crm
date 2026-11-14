import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { AD_PLATFORM_VARS, platformReady, sendConversions } from './live/providers'

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
  mode: ConnectorMode
  envVar: 'AD_CONVERSIONS'
  /** `rows`: con el conector encendido, el estado de cada conversión (sent, failed, o channel_off si su plataforma no tiene credencial). */
  send: (batch: AdConversion[]) => Promise<{ status: 'channel_off' | 'simulated' | 'live'; sent: number; rows?: Record<string, 'sent' | 'failed' | 'channel_off'> }>
}

const g = globalThis as unknown as { __contigoSimulatedConversions?: AdConversion[] }
/** Lo que el adaptador simulado habría mandado en este proceso (solo pruebas). */
export const simulatedConversions = () => (g.__contigoSimulatedConversions ??= [])

/** `live`: AD_CONVERSIONS=live, la aprobación y las credenciales completas de AL MENOS una plataforma (las demás se quedan en cola). */
export const AD_GATE = { envVar: 'AD_CONVERSIONS', credentials: [], anyOf: Object.values(AD_PLATFORM_VARS).filter((v) => v.length > 0) } as const
export function adConversionsAdapter(): AdConversionsAdapter {
  const mode = gate(AD_GATE).mode
  const simulated = mode === 'simulated'
  return {
    envVar: 'AD_CONVERSIONS',
    mode,
    send: async (batch) => {
      if (mode === 'live') {
        const rows: Record<string, 'sent' | 'failed' | 'channel_off'> = {}
        let sent = 0
        for (const platform of [...new Set(batch.map((b) => b.platform))]) {
          const part = batch.filter((b) => b.platform === platform)
          if (!platformReady(platform)) {
            for (const b of part) rows[b.id] = 'channel_off'
            continue
          }
          try {
            sent += await sendConversions(platform, part)
            for (const b of part) rows[b.id] = 'sent'
          } catch {
            for (const b of part) rows[b.id] = 'failed'
          }
        }
        return { status: 'live', sent, rows }
      }
      if (!simulated) return { status: 'channel_off', sent: 0 }
      simulatedConversions().push(...batch)
      return { status: 'simulated', sent: batch.length }
    },
  }
}
