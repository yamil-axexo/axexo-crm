import 'server-only'

/**
 * GOB-07 / OBS-02: trazas hacia una herramienta externa de observabilidad. Adaptador APAGADO.
 * `off` (por defecto): no llama a nada; la medición interna (crm.request_metrics y crm.error_events) sigue funcionando.
 * `simulated` (solo con APP_ENV=test y TRACES_ADAPTER=simulated): anota en memoria lo que habría salido, para las pruebas.
 * No hay implementación real ni credenciales: conectar un proveedor pasa primero por la revisión de tecnología.
 */
export type Span = { requestId: string; kind: 'page' | 'action' | 'api' | 'job'; screen: string; ms: number; error: boolean }
export type TracesAdapter = { mode: 'off' | 'simulated'; envVar: string; export: (span: Span) => 'dropped_off' | 'simulated' }

const g = globalThis as unknown as { __contigoSimulatedSpans?: Span[] }
/** Lo que el adaptador simulado habría mandado en este proceso (solo pruebas). */
export const simulatedSpans = () => (g.__contigoSimulatedSpans ??= [])

export function tracesAdapter(): TracesAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env.TRACES_ADAPTER === 'simulated'
  return {
    mode: simulated ? 'simulated' : 'off',
    envVar: 'TRACES_ADAPTER',
    export: (span) => {
      if (!simulated) return 'dropped_off'
      simulatedSpans().push(span)
      return 'simulated'
    },
  }
}
