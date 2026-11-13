import 'server-only'

/**
 * Conexiones del cuidado del comercio (CS-02, CS-05, CS-06). Las cuatro están construidas y APAGADAS: ninguna llama a nada
 * fuera de CONTIGO. `off` (por defecto) no trae ni manda nada y la pantalla lo dice; `simulated` solo vale con APP_ENV=test
 * y produce datos de mentira, siempre los mismos, para las pruebas. No hay implementación real: conectar cualquiera pasa
 * primero por la revisión de tecnología. Sin credenciales, sin URLs y sin llamadas de red.
 */
export type CareAdapterKey = 'care_signals' | 'zendesk_counts' | 'kore_academy' | 'ai_draft'
type Pair = [es: string, en: string]
export const CARE_ADAPTERS: Record<CareAdapterKey, { envVar: string; name: Pair; needs: Pair }> = {
  care_signals: {
    envVar: 'CARE_SIGNALS_ADAPTER',
    name: ['Saldo, comisión y productos por comercio', 'Balance, commission and products per merchant'],
    needs: ['Falta: que Data y Reportería agregue saldo, comisión de 30 días y número de productos al archivo diario de ventas, y aprobar la conexión en la revisión de tecnología.', 'Missing: Data and Reporting adding balance, 30-day commission and product count to the daily sales file, and approval of the connection in the technology review.'],
  },
  zendesk_counts: {
    envVar: 'ZENDESK_COUNTS_ADAPTER',
    name: ['Conteo de solicitudes de soporte (Zendesk)', 'Support request counts (Zendesk)'],
    needs: ['Falta: aprobación en la revisión de tecnología, una credencial de solo lectura y la llave que une cada organización de Zendesk con su comercio. Solo se leerán conteos y urgencia, nunca el texto.', 'Missing: approval in the technology review, a read-only credential and the key that links each Zendesk organization to its merchant. Only counts and urgency will be read, never the text.'],
  },
  kore_academy: {
    envVar: 'KORE_ACADEMY_ADAPTER',
    name: ['Constancias de capacitación (Kore Academy)', 'Training completions (Kore Academy)'],
    needs: ['Falta: que Kore Academy emita el evento de curso terminado con el identificador del comercio, y aprobar la conexión en la revisión de tecnología. Mientras tanto, Operaciones registra la constancia a mano.', 'Missing: Kore Academy emitting the course-completed event with the merchant identifier, and approval of the connection in the technology review. Meanwhile, Operations records the completion by hand.'],
  },
  ai_draft: {
    envVar: 'AI_DRAFT_ADAPTER',
    name: ['Borrador de revisión de cuenta con AI', 'Account review draft with AI'],
    needs: ['Falta: un modelo de AI aprobado en la revisión de tecnología y la regla de qué datos puede leer. Mientras tanto, el borrador se arma solo con los datos que CONTIGO ya tiene, sin AI.', 'Missing: an AI model approved in the technology review and the rule for which data it may read. Meanwhile, the draft is built only from the data CONTIGO already has, with no AI.'],
  },
}

export const careAdapterMode = (key: CareAdapterKey): 'off' | 'simulated' =>
  process.env.APP_ENV === 'test' && process.env[CARE_ADAPTERS[key].envVar] === 'simulated' ? 'simulated' : 'off'

/** Para "Estado de CONTIGO": cada conexión, si está apagada y qué falta para encenderla. */
export function careAdapterStatus(): { key: CareAdapterKey; mode: 'off' | 'simulated'; envVar: string; name: Pair; needs: Pair }[] {
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
  if (careAdapterMode('care_signals') === 'off') return null
  return accounts.map((a) => ({ accountId: a.id, balanceMinor: (h(a.id) % 40) * 5000, commissionMinor30d: Math.round(a.volumeMinor30d * 0.012), productCount30d: 1 + (h(a.id + 'p') % 4) }))
}

export type TicketRow = { accountId: string; open: number; urgent: number }
/** Conteos de solicitudes abiertas por comercio. Apagada: no devuelve nada. */
export async function pullTicketCounts(accountIds: string[]): Promise<TicketRow[] | null> {
  if (careAdapterMode('zendesk_counts') === 'off') return null
  return accountIds.map((id) => ({ accountId: id, open: h(id + 't') % 4, urgent: h(id + 'u') % 7 === 0 ? 1 : 0 }))
}

export type CompletionEvent = { externalId: string; merchantRef: string; personName: string; courseKey: string; courseTitle: string; completedOn: string }
/** Cursos terminados desde la última lectura. Apagada: no devuelve nada. Simulada: un curso por cada identificador que se le pase. */
export async function pullCompletions(merchantRefs: string[], today: string): Promise<CompletionEvent[] | null> {
  if (careAdapterMode('kore_academy') === 'off') return null
  return merchantRefs.map((ref) => ({ externalId: `sim-${ref}-intro`, merchantRef: ref, personName: 'Encargado de prueba', courseKey: 'intro-ventas', courseTitle: 'Primeros pasos para vender', completedOn: today }))
}

/** Redacción con AI de la revisión de cuenta. Apagada: devuelve null y la pantalla ofrece el borrador con datos. */
export async function aiReviewDraft(facts: string[]): Promise<string | null> {
  if (careAdapterMode('ai_draft') === 'off') return null
  return `[Simulación de pruebas] ${facts.join(' ')}`
}
