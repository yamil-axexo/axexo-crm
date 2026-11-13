import 'server-only'

/**
 * Conexiones del paquete campo2. Las tres están construidas y APAGADAS: ninguna llama a nada fuera de CONTIGO.
 * `off` (por defecto) deja lo que saldría en su cola con "Canal apagado" y no trae nada; `simulated` solo vale con
 * APP_ENV=test y registra lo que habría pasado, para las pruebas. Sin credenciales, sin URLs y sin llamadas de red.
 */
export type Campo2AdapterKey = 'feedback_to_pt' | 'academy_progress' | 'lakehouse_crossmatch'
type Pair = [es: string, en: string]
export const CAMPO2_ADAPTERS: Record<Campo2AdapterKey, { envVar: string; name: Pair; what: Pair; needs: Pair }> = {
  feedback_to_pt: {
    envVar: 'FEEDBACK_TO_PT_ADAPTER',
    name: ['Resumen semanal de comentarios hacia P&T', 'Weekly feedback digest to P&T'],
    what: ['Lleva a Product & Technology el conteo por tema de lo que dicen los comercios', 'Takes merchants’ feedback counts by topic to Product & Technology'],
    needs: ['Falta: que P&T diga dónde lo quiere recibir (correo, canal de Slack o evento) y la aprobación en la revisión de tecnología. Mientras tanto el resumen queda en CONTIGO y sale como evento de dominio en la cola.', 'Missing: P&T saying where it wants to receive it (email, Slack channel or event) and approval in the technology review. Meanwhile the digest stays in CONTIGO and goes out as a domain event in the queue.'],
  },
  academy_progress: {
    envVar: 'ACADEMY_PROGRESS_ADAPTER',
    name: ['Avance de capacitación de aliados (Kore Academy)', 'Partner training progress (Kore Academy)'],
    what: ['Trae cuánto lleva cada aliado de cada material de su nivel', 'Brings how far each partner is through each material of its tier'],
    needs: ['Falta: que Kore Academy exponga el avance por persona y curso con el identificador del aliado, y la aprobación en la revisión de tecnología. Mientras tanto quien lidera el mercado lo anota a mano.', 'Missing: Kore Academy exposing progress per person and course with the partner identifier, and approval in the technology review. Meanwhile the market lead records it by hand.'],
  },
  lakehouse_crossmatch: {
    envVar: 'LAKEHOUSE_CROSSMATCH_ADAPTER',
    name: ['Cruce de bases de aliados en el lakehouse', 'Partner base cross-match in the lakehouse'],
    what: ['Corre el cruce donde viven los datos de Data y Reportería', 'Runs the cross-match where Data and Reporting keeps the data'],
    needs: ['Falta: que Data y Reportería publique el cruce (índice ciego por teléfono y alias) y la aprobación en la revisión de tecnología. Mientras tanto el cruce corre dentro de CONTIGO con acceso restringido.', 'Missing: Data and Reporting publishing the cross-match (blind index by phone and alias) and approval in the technology review. Meanwhile the cross-match runs inside CONTIGO with restricted access.'],
  },
}

export const campo2Mode = (key: Campo2AdapterKey): 'off' | 'simulated' =>
  process.env.APP_ENV === 'test' && process.env[CAMPO2_ADAPTERS[key].envVar] === 'simulated' ? 'simulated' : 'off'

export function campo2AdapterStatus(): { key: Campo2AdapterKey; mode: 'off' | 'simulated'; envVar: string; name: Pair; what: Pair; needs: Pair }[] {
  return (Object.keys(CAMPO2_ADAPTERS) as Campo2AdapterKey[]).map((key) => ({ key, mode: campo2Mode(key), ...CAMPO2_ADAPTERS[key] }))
}

/** CS-08: entrega del resumen. Apagado: queda en cola. Simulado: se da por entregado (solo pruebas). */
export async function deliverFeedbackDigest(_digest: { id: string; total: number }): Promise<'queued_off' | 'simulated'> {
  return campo2Mode('feedback_to_pt') === 'simulated' ? 'simulated' : 'queued_off'
}

export type AcademyProgress = { externalId: string; partnerAccountId: string; materialId: string; learnerRef: string; progressPct: number; completedOn: string | null }
/** CANAL-06: avance por aliado y material. Apagado: no trae nada. Simulado: avance fijo por par, siempre el mismo. */
export async function pullAcademyProgress(pairs: { partnerAccountId: string; materialId: string }[], today: string): Promise<AcademyProgress[] | null> {
  if (campo2Mode('academy_progress') === 'off') return null
  return pairs.map((p, i) => {
    const pct = [40, 100, 70][i % 3]!
    return { externalId: `sim-${p.partnerAccountId.slice(0, 8)}-${p.materialId.slice(0, 8)}`, partnerAccountId: p.partnerAccountId, materialId: p.materialId, learnerRef: 'aliado-1', progressPct: pct, completedOn: pct === 100 ? today : null }
  })
}

/** CANAL-06: el cruce en el lakehouse. Apagado: null (el cruce corre en CONTIGO). */
export async function lakehouseCrossmatch(_market: string): Promise<number | null> {
  return campo2Mode('lakehouse_crossmatch') === 'simulated' ? 0 : null
}
