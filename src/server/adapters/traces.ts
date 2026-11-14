import 'server-only'
import { randomBytes } from 'node:crypto'
import { gate, type ConnectorMode } from './live/gate'
import { otlpExport, type OtlpSpan } from './live/providers'

/**
 * GOB-07 / OBS-02: trazas hacia una herramienta externa de observabilidad. Adaptador APAGADO.
 * `off` (por defecto): no llama a nada; la medición interna (crm.request_metrics y crm.error_events) sigue funcionando.
 * `simulated` (solo con APP_ENV=test y TRACES_ADAPTER=simulated): anota en memoria lo que habría salido, para las pruebas.
 * No hay implementación real ni credenciales: conectar un proveedor pasa primero por la revisión de tecnología.
 */
export type Span = { requestId: string; kind: 'page' | 'action' | 'api' | 'job'; screen: string; ms: number; error: boolean }
export type TracesAdapter = { mode: ConnectorMode; envVar: string; export: (span: Span) => 'dropped_off' | 'simulated' | 'queued' }
/** `live`: TRACES_ADAPTER=live, OTEL_EXPORTER_OTLP_ENDPOINT (https) y la aprobación; OTEL_EXPORTER_OTLP_HEADERS si el proveedor pide llave.
 * Las trazas se juntan en memoria y salen por lotes (cada 50 o cada 10 segundos). Solo salen pantalla, tipo, duración y error. */
export const TRACES_GATE = { envVar: 'TRACES_ADAPTER', credentials: ['OTEL_EXPORTER_OTLP_ENDPOINT'] } as const
const buffer: OtlpSpan[] = []
let timer: ReturnType<typeof setTimeout> | null = null
export async function flushTraces(): Promise<number> {
  if (timer) clearTimeout(timer)
  timer = null
  const batch = buffer.splice(0, 500)
  if (batch.length === 0) return 0
  try {
    return await otlpExport(batch)
  } catch {
    return 0 // las trazas son de mejor esfuerzo: si el destino no contesta, se pierden y la medición interna sigue
  }
}

const g = globalThis as unknown as { __contigoSimulatedSpans?: Span[] }
/** Lo que el adaptador simulado habría mandado en este proceso (solo pruebas). */
export const simulatedSpans = () => (g.__contigoSimulatedSpans ??= [])

export function tracesAdapter(): TracesAdapter {
  const mode = gate(TRACES_GATE).mode
  const simulated = mode === 'simulated'
  return {
    mode,
    envVar: 'TRACES_ADAPTER',
    export: (span) => {
      if (mode === 'live') {
        const end = Date.now()
        buffer.push({ traceId: randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), name: `${span.kind} ${span.screen}`.slice(0, 120), startMs: end - span.ms, endMs: end, error: span.error, attributes: { 'contigo.request_id': span.requestId, 'contigo.kind': span.kind, 'contigo.screen': span.screen } })
        if (buffer.length >= 50) void flushTraces()
        else timer ??= setTimeout(() => void flushTraces(), 10_000)
        return 'queued'
      }
      if (!simulated) return 'dropped_off'
      simulatedSpans().push(span)
      return 'simulated'
    },
  }
}
