import 'server-only'
import { tracesAdapter } from './traces'
import { billingAdapter } from './billing'

/** Para "Estado de CONTIGO": los adaptadores del paquete gobierno, si están apagados y qué falta para encenderlos. */
export function gobiernoAdapterStatus(): { key: 'traces' | 'billing' | 'backup'; name: [es: string, en: string]; mode: 'off' | 'simulated'; envVar: string | null; needs: [es: string, en: string] }[] {
  return [
    {
      key: 'traces', name: ['Trazas hacia una herramienta de observabilidad', 'Traces to an observability tool'], mode: tracesAdapter().mode, envVar: tracesAdapter().envVar,
      needs: ['Falta: elegir la herramienta de trazas y alertas, aprobarla en la revisión de tecnología y cargar su llave en el ambiente. La medición interna ya funciona sin ella.', 'Missing: choosing the tracing and alerting tool, approving it in the technology review and loading its key in the environment. The internal measurement already works without it.'],
    },
    {
      key: 'billing', name: ['Lectura automática de facturación', 'Automatic billing read'], mode: billingAdapter().mode, envVar: billingAdapter().envVar,
      needs: ['Falta: acceso de solo lectura a la facturación de cada proveedor, aprobado en la revisión de tecnología. Mientras tanto, administración carga los costos a mano.', 'Missing: read-only access to each provider’s billing, approved in the technology review. Meanwhile, administration loads the costs by hand.'],
    },
    {
      key: 'backup', name: ['Respaldo con recuperación a un punto en el tiempo', 'Backup with point-in-time recovery'], mode: 'off', envVar: null,
      needs: ['Es de la plataforma, no de CONTIGO: falta la plataforma de producción, activar la recuperación a un punto en el tiempo y la primera prueba de restauración. El procedimiento está en docs/runbooks/respaldo-y-restauracion.md.', 'It belongs to the platform, not to CONTIGO: missing the production platform, turning on point-in-time recovery and the first restore test. The procedure is in docs/runbooks/respaldo-y-restauracion.md.'],
    },
  ]
}
