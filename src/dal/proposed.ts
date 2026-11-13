import 'server-only'
import type { Ctx } from '@/server/context'
import { withUser } from '@/server/db'
import { decisionRows, DECISIONS } from '@/domain/decisions'
import { FUNNEL_SETTINGS, listFunnelSettings } from '@/domain/embudo2/settings'
import { THRESHOLDS, type ThresholdKey } from '@/domain/campo-canal/thresholds'
import { proposedValues as fieldProposed } from '@/dal/campo-canal'
import { pendingDecisions } from '@/dal/reportes2'

type Pair = [string, string]
/** Un valor con el que CONTIGO funciona mientras su dueño no lo fija. */
export type ProposedRow = {
  key: string
  source: 'decision' | 'funnel' | 'field' | 'board'
  label: Pair
  /** Dónde aplica y cuánto vale hoy, si se puede decir en una línea. */
  detail: Pair | null
  owner: string
  href: string
}

const OWNER_EN: Record<string, string> = {
  Ventas: 'Sales', 'Ventas y canales': 'Sales and channels', 'Ventas y Finanzas': 'Sales and Finance', 'Finanzas y Ventas': 'Finance and Sales',
  'Mesa de control': 'Control desk', Operaciones: 'Operations', Finanzas: 'Finance', Liderazgo: 'Leadership', 'Liderazgo comercial': 'Sales leadership',
  'Ventas US': 'US Sales', 'por definir': 'to be defined',
}
export const ownerEn = (o: string) => OWNER_EN[o] ?? o

/**
 * Una sola lista de valores propuestos para Estado de CONTIGO (ola 6). Cada paquete guarda los suyos donde los usa
 * (decisiones de negocio, valores del embudo, umbrales de campo y canales, tableros y ajustes de reportes); aquí se juntan,
 * cada uno con su dueño y la pantalla donde se fija.
 */
export async function allProposed(ctx: Ctx): Promise<ProposedRow[]> {
  const live = ctx.markets.filter((m) => m.status === 'live').map((m) => m.code)
  const [decisions, funnel, steps, field, boards] = await Promise.all([
    withUser(ctx.user.id, (tx) => decisionRows(tx, live)),
    listFunnelSettings(ctx),
    withUser(ctx.user.id, (tx) => tx<{ id: string; name_es: string; name_en: string; pending_owner: string }[]>`
      select t.id, p.name || ': ' || s.name_es as name_es, p.name || ': ' || s.name_en as name_en, t.pending_owner
        from crm.stage_transitions t join crm.pipelines p on p.id = t.pipeline_id join crm.stages s on s.id = t.to_stage_id
       where t.pending_owner is not null order by p.name`),
    fieldProposed(ctx),
    pendingDecisions(ctx),
  ])
  const out: ProposedRow[] = []
  // Decisiones de negocio (datos2): una fila por decisión, con los mercados que siguen en propuesta.
  for (const d of DECISIONS) {
    const rows = decisions.filter((r) => r.key === d.key && r.proposed)
    if (!rows.length) continue
    const opt = (v: string) => d.options.find((o) => o.value === v)?.label ?? [v, v] as Pair
    out.push({ key: d.key, source: 'decision', label: d.label, owner: d.owner, href: '/admin/decisiones',
      detail: [rows.map((r) => `${r.market ?? 'Todos'}: ${opt(r.value)[0]}`).join(' · '), rows.map((r) => `${r.market ?? 'All'}: ${opt(r.value)[1]}`).join(' · ')] })
  }
  // Valores del embudo (embudo2) y pasos de etapa en pausa.
  for (const def of FUNNEL_SETTINGS) {
    const rows = funnel.filter((r) => r.key === def.key && r.proposed)
    if (!rows.length) continue
    out.push({ key: def.key, source: 'funnel', label: [def.label.es, def.label.en], owner: rows[0]!.pending_owner ?? 'por definir', href: '/admin/embudo',
      detail: [rows.map((r) => r.market_code ?? 'Todos').join(' · '), rows.map((r) => r.market_code ?? 'All').join(' · ')] })
  }
  for (const s of steps) out.push({ key: `transition.${s.id}`, source: 'funnel', label: [`Paso a "${s.name_es}" (en pausa)`, `Step to "${s.name_en}" (paused)`], detail: null, owner: s.pending_owner, href: '/admin/automatizaciones' })
  // Umbrales de campo y canales (campo2).
  for (const k of [...new Set(field.map((x) => x.key))]) {
    const items = field.filter((x) => x.key === k)
    const def = THRESHOLDS[k as ThresholdKey]
    const label: Pair = k === 'clawback_policy' ? ['Política de reversos: días de ventana', 'Reversal policy: window days'] : k === 'health_weight' ? ['Salud: peso del punto de venta perfecto', 'Health: perfect store weight'] : def ? [def.es, def.en] : [k, k]
    out.push({ key: k, source: 'field', label, owner: items[0]!.owner, href: `/campo?tab=umbrales`,
      detail: [items.map((x) => `${x.market_code ?? 'Todos'}: ${x.value}`).join(' · '), items.map((x) => `${x.market_code ?? 'All'}: ${x.value}`).join(' · ')] })
  }
  // Tableros por rol y ajustes de reportes (reportes2).
  for (const b of boards) out.push({ key: b.key, source: 'board', label: b.label, detail: null, owner: b.pending, href: '/admin/tableros' })
  return out
}
