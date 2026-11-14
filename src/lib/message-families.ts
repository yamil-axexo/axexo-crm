// Claves de mensajes que se arman en el código con una parte variable (`suggest.${kind}`, `health.${h}`...).
// TypeScript solo revisa las claves escritas completas; estas no. Cada familia declara aquí de dónde salen sus valores,
// y tests/db/ajustes3.test.ts falla si una clave de la familia falta en es.json o en.json, o si aparece en el código
// una familia nueva sin declarar. Así una regla o un tipo de aviso nuevo no llega a Hoy como "suggest.algo".
import { NEXTS, OPS_RESULTS, RESULTS, VISIT_RESULTS } from '@/domain/followup'

/** Tipos de aviso de la cola (crm.exceptions.kind). La prueba los compara con la restricción de la base. */
export const QUEUE_KINDS = ['lead_sla', 'revisit_due', 'activation_risk', 'no_next_step', 'stalled_deal', 'reactivation', 'unowned_account', 'duplicate_suspect', 'unmatched_event', 'under_plan', 'perfect_store_low', 'lead_no_next_step', 'onboarding_no_next_step', 'competitor_share_loss', 'indirect_route', 'data_quality'] as const

export const HEALTHS = ['active', 'idle', 'risk', 'new'] as const

export const MESSAGE_FAMILIES: Record<string, readonly string[]> = {
  'suggest.': QUEUE_KINDS,
  'ctx.': QUEUE_KINDS,
  'health.': HEALTHS,
  'complete.next.': NEXTS,
  'complete.nextTitle.': NEXTS.filter((n) => n !== 'none'),
  'complete.result.': [...RESULTS, ...VISIT_RESULTS, ...OPS_RESULTS],
}
