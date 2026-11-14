import 'server-only'
import { egressFetch, EGRESS_ALLOWLIST } from '@/server/net/egress'

/**
 * AUT-02: UI en vivo por Broadcast (Supabase Realtime). Adaptador APAGADO por defecto.
 * Dentro de CONTIGO las pantallas se refrescan solas leyendo crm.live_signals (sin salir a ningún lado). Este adaptador manda
 * además la misma señal por Broadcast para que el navegador no tenga que preguntar: solo tema, tipo de evento y hora, nunca datos.
 * `off` (por defecto): no llama a nada. `simulated` (solo APP_ENV=test y REALTIME_ADAPTER=simulated): anota lo que habría salido.
 * `live`: REALTIME_ADAPTER=live, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y REALTIME_ADAPTER_APPROVAL (referencia del sign-off
 * escrito de Dan Mulligan o Michael Essiet). Si falta cualquiera, queda en `off` y Estado de CONTIGO dice qué falta.
 */
export type LiveSignal = { topic: string; event: string; at: string }
export type RealtimeMode = 'off' | 'simulated' | 'live'
export const REALTIME_ENV = { envVar: 'REALTIME_ADAPTER', credentials: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], approval: 'REALTIME_ADAPTER_APPROVAL' } as const

const g = globalThis as unknown as { __contigoSimulatedBroadcast?: LiveSignal[] }
export const simulatedBroadcasts = () => (g.__contigoSimulatedBroadcast ??= [])

export function realtimeMissing(): string[] {
  const missing: string[] = []
  if (process.env.REALTIME_ADAPTER !== 'live') missing.push(REALTIME_ENV.envVar)
  for (const c of REALTIME_ENV.credentials) if (!process.env[c]) missing.push(c)
  if (!process.env[REALTIME_ENV.approval]) missing.push(REALTIME_ENV.approval)
  return missing
}

export function realtimeMode(): RealtimeMode {
  if (process.env.APP_ENV === 'test' && process.env.REALTIME_ADAPTER === 'simulated') return 'simulated'
  return realtimeMissing().length === 0 ? 'live' : 'off'
}

export async function broadcast(signals: LiveSignal[]): Promise<{ mode: RealtimeMode; sent: number }> {
  const mode = realtimeMode()
  if (mode === 'off' || signals.length === 0) return { mode, sent: 0 }
  if (mode === 'simulated') {
    simulatedBroadcasts().push(...signals)
    return { mode, sent: signals.length }
  }
  const base = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await egressFetch(new URL('/realtime/v1/api/broadcast', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify({ messages: signals.map((s) => ({ topic: `contigo:${s.topic}`, event: 'changed', payload: { event: s.event, at: s.at }, private: true })) }),
    signal: AbortSignal.timeout(10_000),
  }, { purpose: 'supabase', allowHosts: EGRESS_ALLOWLIST.supabase })
  return { mode, sent: res.ok ? signals.length : 0 }
}
