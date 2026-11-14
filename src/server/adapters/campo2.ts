import 'server-only'
import { gate, type ConnectorMode, type GateSpec } from './live/gate'
import { http } from './live/http'
import { SUPABASE_ADMIN, s5Manifest, s5Read } from './live/supabase'

/**
 * Conexiones del paquete campo2. Las tres están construidas y APAGADAS. `off` (por defecto) deja lo que saldría en su cola
 * con "Canal apagado" y no trae nada; `simulated` solo vale con APP_ENV=test. `live` (integración ola 7) sigue la regla
 * única de encendido (live/gate.ts): variable en "live", credenciales y la referencia del sign-off escrito.
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

/** Credenciales de cada conexión: P&T recibe el resumen en un endpoint propio; el avance sale del contrato de Kore Academy; el
 * cruce lo publica Data y Reportería como archivo en el bucket con manifiesto. */
export const CAMPO2_GATES: Record<Campo2AdapterKey, GateSpec> = {
  feedback_to_pt: { envVar: 'FEEDBACK_TO_PT_ADAPTER', credentials: ['FEEDBACK_TO_PT_URL', 'FEEDBACK_TO_PT_TOKEN'] },
  academy_progress: { envVar: 'ACADEMY_PROGRESS_ADAPTER', credentials: ['KORE_ACADEMY_URL', 'KORE_ACADEMY_TOKEN'] },
  lakehouse_crossmatch: { envVar: 'LAKEHOUSE_CROSSMATCH_ADAPTER', credentials: [...SUPABASE_ADMIN, 'S5_BUCKET'] },
}
export const campo2Mode = (key: Campo2AdapterKey): ConnectorMode => gate(CAMPO2_GATES[key]).mode
const urlOf = (raw: string | undefined) => { const u = new URL(raw ?? ''); return { origin: u.origin, host: u.host } }

export function campo2AdapterStatus(): { key: Campo2AdapterKey; mode: ConnectorMode; envVar: string; name: Pair; what: Pair; needs: Pair }[] {
  return (Object.keys(CAMPO2_ADAPTERS) as Campo2AdapterKey[]).map((key) => ({ key, mode: campo2Mode(key), ...CAMPO2_ADAPTERS[key] }))
}

/** CS-08: entrega del resumen. Apagado: queda en cola. Simulado: se da por entregado (solo pruebas). */
export async function deliverFeedbackDigest(digest: { id: string; total: number }): Promise<'queued_off' | 'simulated' | 'sent'> {
  const mode = campo2Mode('feedback_to_pt')
  if (mode !== 'live') return mode === 'simulated' ? 'simulated' : 'queued_off'
  const u = urlOf(process.env.FEEDBACK_TO_PT_URL)
  await http({ connector: 'feedback_to_pt', url: `${u.origin}${new URL(process.env.FEEDBACK_TO_PT_URL!).pathname}`, method: 'POST', allowHosts: [u.host],
    headers: { authorization: `Bearer ${process.env.FEEDBACK_TO_PT_TOKEN ?? ''}`, 'content-type': 'application/json' }, json: { digest_id: digest.id, total: digest.total } })
  return 'sent'
}

export type AcademyProgress = { externalId: string; partnerAccountId: string; materialId: string; learnerRef: string; progressPct: number; completedOn: string | null }
/** CANAL-06: avance por aliado y material. Apagado: no trae nada. Simulado: avance fijo por par, siempre el mismo. */
export async function pullAcademyProgress(pairs: { partnerAccountId: string; materialId: string; today: string }[]): Promise<AcademyProgress[] | null> {
  const mode = campo2Mode('academy_progress')
  if (mode === 'off') return null
  if (mode === 'live') {
    // Contrato de Kore Academy (docs/contracts/kore-academy-completions.md): GET /v1/progress por aliado y material.
    const k = urlOf(process.env.KORE_ACADEMY_URL)
    const out: AcademyProgress[] = []
    for (let i = 0; i < pairs.length; i += 100) {
      const q = new URLSearchParams({ pairs: pairs.slice(i, i + 100).map((p) => `${p.partnerAccountId}:${p.materialId}`).join(',') })
      const j = (await http({ connector: 'academy_progress', url: `${k.origin}/v1/progress?${q}`, allowHosts: [k.host], headers: { authorization: `Bearer ${process.env.KORE_ACADEMY_TOKEN ?? ''}` } }))
        .json<{ progress?: { id?: string; partner_ref?: string; material_ref?: string; learner_ref?: string; pct?: number; completed_on?: string | null }[] }>()
      for (const r of j.progress ?? []) {
        if (!r.id || !r.partner_ref || !r.material_ref || typeof r.pct !== 'number') continue
        out.push({ externalId: r.id.slice(0, 120), partnerAccountId: r.partner_ref, materialId: r.material_ref, learnerRef: (r.learner_ref ?? '').slice(0, 120), progressPct: Math.max(0, Math.min(100, Math.round(r.pct))), completedOn: r.completed_on && /^\d{4}-\d{2}-\d{2}$/.test(r.completed_on) ? r.completed_on : null })
      }
    }
    return out
  }
  return pairs.map((p, i) => {
    const pct = [40, 100, 70][i % 3]!
    return { externalId: `sim-${p.partnerAccountId.slice(0, 8)}-${p.materialId.slice(0, 8)}`, partnerAccountId: p.partnerAccountId, materialId: p.materialId, learnerRef: 'aliado-1', progressPct: pct, completedOn: pct === 100 ? p.today : null }
  })
}

/** CANAL-06: el cruce en el lakehouse. Apagado: null (el cruce corre en CONTIGO). */
export async function lakehouseCrossmatch(market: string): Promise<number | null> {
  const mode = campo2Mode('lakehouse_crossmatch')
  if (mode !== 'live') return mode === 'simulated' ? 0 : null
  // Data y Reportería publica el cruce como archivo "partner_crossmatch" en el manifiesto; se cuentan las coincidencias del mercado.
  const file = (await s5Manifest('lakehouse_crossmatch')).find((f) => f.kind === 'partner_crossmatch')
  if (!file) return null
  const rows = await s5Read('lakehouse_crossmatch', file)
  return Array.isArray(rows) ? rows.filter((r) => (r as { market?: string }).market === market).length : null
}
