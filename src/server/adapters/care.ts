import 'server-only'
import { aiAdapter, aiDraftText } from '@/server/adapters/ai'
import { gate, type ConnectorMode } from './live/gate'
import { SUPABASE_ADMIN, s5Manifest, s5Read } from './live/supabase'
import { koreCompletions, zendeskCounts } from './live/providers'

/**
 * Conexiones del cuidado del comercio (CS-02, CS-05, CS-06). Las tres están construidas y APAGADAS: ninguna llama a nada
 * fuera de CONTIGO. `off` (por defecto) no trae ni manda nada y la pantalla lo dice; `simulated` solo vale con APP_ENV=test
 * y produce datos de mentira, siempre los mismos, para las pruebas. No hay implementación real: conectar cualquiera pasa
 * primero por la revisión de tecnología. Sin credenciales, sin URLs y sin llamadas de red.
 */
export type CareAdapterKey = 'care_signals' | 'zendesk_counts' | 'kore_academy'
type Pair = [es: string, en: string]
export const CARE_ADAPTERS: Record<CareAdapterKey, { envVar: string; name: Pair; needs: Pair; credentials: readonly string[] }> = {
  care_signals: {
    envVar: 'CARE_SIGNALS_ADAPTER', credentials: [...SUPABASE_ADMIN, 'S5_BUCKET'],
    name: ['Saldo, comisión y productos por comercio', 'Balance, commission and products per merchant'],
    needs: ['Falta: que Data y Reportería agregue saldo, comisión de 30 días y número de productos al archivo diario de ventas, y aprobar la conexión en la revisión de tecnología.', 'Missing: Data and Reporting adding balance, 30-day commission and product count to the daily sales file, and approval of the connection in the technology review.'],
  },
  zendesk_counts: {
    envVar: 'ZENDESK_COUNTS_ADAPTER', credentials: ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN'],
    name: ['Conteo de solicitudes de soporte (Zendesk)', 'Support request counts (Zendesk)'],
    needs: ['Falta: aprobación en la revisión de tecnología, una credencial de solo lectura y la llave que une cada organización de Zendesk con su comercio. Solo se leerán conteos y urgencia, nunca el texto.', 'Missing: approval in the technology review, a read-only credential and the key that links each Zendesk organization to its merchant. Only counts and urgency will be read, never the text.'],
  },
  kore_academy: {
    envVar: 'KORE_ACADEMY_ADAPTER', credentials: ['KORE_ACADEMY_URL', 'KORE_ACADEMY_TOKEN'],
    name: ['Constancias de capacitación (Kore Academy)', 'Training completions (Kore Academy)'],
    needs: ['Falta: que Kore Academy emita el evento de curso terminado con el identificador del comercio, y aprobar la conexión en la revisión de tecnología. Mientras tanto, Operaciones registra la constancia a mano.', 'Missing: Kore Academy emitting the course-completed event with the merchant identifier, and approval of the connection in the technology review. Meanwhile, Operations records the completion by hand.'],
  },
}

export const careAdapterMode = (key: CareAdapterKey): ConnectorMode => gate({ envVar: CARE_ADAPTERS[key].envVar, credentials: CARE_ADAPTERS[key].credentials }).mode

/** Para "Estado de CONTIGO": cada conexión, si está apagada y qué falta para encenderla. */
export function careAdapterStatus(): { key: CareAdapterKey; mode: ConnectorMode; envVar: string; name: Pair; needs: Pair }[] {
  return (Object.keys(CARE_ADAPTERS) as CareAdapterKey[]).map((key) => ({ key, mode: careAdapterMode(key), ...CARE_ADAPTERS[key] }))
}

const h = (s: string) => {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0
  return x
}

export type SignalRow = { accountId: string; balanceMinor: number | null; commissionMinor30d: number | null; productCount30d: number | null }
/** Señales por comercio. Apagada: no devuelve nada. Simulada: valores fijos por comercio. */
export async function pullCareSignals(accounts: { id: string; volumeMinor30d: number }[]): Promise<SignalRow[] | null> {
  const mode = careAdapterMode('care_signals')
  if (mode === 'off') return null
  if (mode === 'live') {
    // Archivo "care_signals" de S5 (manifiesto en su bucket): el más reciente. Solo se devuelven los comercios pedidos.
    const files = (await s5Manifest('care_signals')).filter((f) => f.kind === 'care_signals').sort((a, b) => b.as_of.localeCompare(a.as_of))
    if (!files[0]) return []
    const rows = (await s5Read('care_signals', files[0])) as { rows?: { account_id?: string; balance_minor?: number | null; commission_minor_30d?: number | null; product_count_30d?: number | null }[] }
    const want = new Set(accounts.map((a) => a.id))
    return (rows.rows ?? []).filter((r) => r.account_id && want.has(r.account_id)).map((r) => ({ accountId: r.account_id!, balanceMinor: r.balance_minor ?? null, commissionMinor30d: r.commission_minor_30d ?? null, productCount30d: r.product_count_30d ?? null }))
  }
  return accounts.map((a) => ({ accountId: a.id, balanceMinor: (h(a.id) % 40) * 5000, commissionMinor30d: Math.round(a.volumeMinor30d * 0.012), productCount30d: 1 + (h(a.id + 'p') % 4) }))
}

export type TicketRow = { accountId: string; open: number; urgent: number }
/** Conteos de solicitudes abiertas por comercio. Apagada: no devuelve nada. */
export async function pullTicketCounts(accountIds: string[]): Promise<TicketRow[] | null> {
  const mode = careAdapterMode('zendesk_counts')
  if (mode === 'off') return null
  if (mode === 'live') {
    const out: TicketRow[] = []
    for (const id of accountIds) {
      const c = await zendeskCounts(id)
      if (c) out.push({ accountId: id, ...c })
    }
    return out
  }
  return accountIds.map((id) => ({ accountId: id, open: h(id + 't') % 4, urgent: h(id + 'u') % 7 === 0 ? 1 : 0 }))
}

export type CompletionEvent = { externalId: string; merchantRef: string; personName: string; courseKey: string; courseTitle: string; completedOn: string }
/** Cursos terminados desde la última lectura. Apagada: no devuelve nada. Simulada: un curso por cada identificador que se le pase. */
export async function pullCompletions(merchantRefs: string[], today: string): Promise<CompletionEvent[] | null> {
  const mode = careAdapterMode('kore_academy')
  if (mode === 'off') return null
  if (mode === 'live') {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number]
    const t = new Date(Date.UTC(y, m - 1, d - 30))
    const since = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
    return koreCompletions(merchantRefs, since)
  }
  return merchantRefs.map((ref) => ({ externalId: `sim-${ref}-intro`, merchantRef: ref, personName: 'Encargado de prueba', courseKey: 'intro-ventas', courseTitle: 'Primeros pasos para vender', completedOn: today }))
}

/**
 * Redacción con AI de la revisión de cuenta. Pasa por el adaptador único de AI (`@/server/adapters/ai`, AI_ADAPTER): no hay
 * otro interruptor. Apagado: devuelve null y la pantalla ofrece el borrador con datos.
 */
export const aiReviewDraftMode = (): ConnectorMode => aiAdapter().mode
export async function aiReviewDraft(facts: string[]): Promise<string | null> {
  if (aiReviewDraftMode() === 'off') return null
  if (aiReviewDraftMode() === 'live') return (await aiDraftText(facts))?.text ?? null
  return `[Simulación de pruebas] ${facts.join(' ')}`
}
