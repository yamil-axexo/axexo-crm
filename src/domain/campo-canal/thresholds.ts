import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * Umbrales del paquete campo-canal como metadata con versión (CAMPO-04, CAMPO-02, CANAL-02, CAMPO-06): cada cambio
 * cierra la fila vigente y abre otra con versión nueva y motivo. Las reglas leen el valor vigente y anotan su versión.
 */
export const THRESHOLDS = {
  under_plan_pct: { es: 'Bajo meta: % de lo esperado a la fecha', en: 'Under plan: % of expected to date', min: 1, max: 100 },
  perfect_store_min: { es: 'Punto de venta perfecto: puntaje mínimo', en: 'Perfect store: minimum score', min: 0, max: 100 },
  claim_window_days: { es: 'Registro de canal: días de protección', en: 'Channel registration: protection days', min: 1, max: 90 },
  claim_extension_days: { es: 'Registro de canal: días por extensión', en: 'Channel registration: days per extension', min: 1, max: 60 },
  claim_max_extensions: { es: 'Registro de canal: extensiones máximas', en: 'Channel registration: maximum extensions', min: 0, max: 5 },
  control_desk_sla_hours: { es: 'Mesa de control: horas para resolver', en: 'Control desk: hours to resolve', min: 1, max: 240 },
  prepaid_auto_approve: { es: 'Autoaprobar prepago (1 sí, 0 no)', en: 'Auto-approve prepaid (1 yes, 0 no)', min: 0, max: 1 },
  visit_every_days_a: { es: 'Visitar segmento A cada (días)', en: 'Visit segment A every (days)', min: 1, max: 120 },
  visit_every_days_b: { es: 'Visitar segmento B cada (días)', en: 'Visit segment B every (days)', min: 1, max: 120 },
  visit_every_days_c: { es: 'Visitar segmento C cada (días)', en: 'Visit segment C every (days)', min: 1, max: 120 },
  visit_every_days_d: { es: 'Visitar segmento D cada (días)', en: 'Visit segment D every (days)', min: 1, max: 180 },
  no_sale_days: { es: 'Sin venta por (días)', en: 'No sale for (days)', min: 1, max: 60 },
  holdout_pct: { es: 'Grupo de control por territorio (%)', en: 'Control group per territory (%)', min: 0, max: 50 },
  dispute_sla_days: { es: 'Disputas: días para resolver', en: 'Disputes: days to resolve', min: 1, max: 30 },
  // Paquete campo2 (0042): nacen como valor propuesto con dueño pendiente (field_thresholds.pending_owner).
  trust_min_score: { es: 'Visitas: señal mínima de la Sales App para contar', en: 'Visits: minimum Sales App signal to count', min: 0, max: 100 },
  route_daily_stores: { es: 'Ruta del día: tiendas por persona', en: 'Daily route: stores per person', min: 1, max: 60 },
  competitor_alert_visits: { es: 'Competencia: visitas con competencia para avisar', en: 'Competition: visits with a competitor before an alert', min: 1, max: 10 },
  competitor_window_days: { es: 'Competencia: días que se miran', en: 'Competition: days looked at', min: 7, max: 180 },
  indirect_route_visits: { es: 'Competencia: visitas sin venta para sugerir canal indirecto', en: 'Competition: visits with no sale before suggesting the indirect channel', min: 1, max: 10 },
  perfect_store_health_days: { es: 'Punto de venta perfecto: días que vale en la salud', en: 'Perfect store: days it counts in health', min: 7, max: 180 },
  threshold_review_days: { es: 'Calibración: revisar cada umbral cada (días)', en: 'Calibration: review each threshold every (days)', min: 14, max: 365 },
  onboarding_link_days: { es: 'Enlace de expediente: días de vigencia', en: 'Onboarding link: days valid', min: 1, max: 30 },
} as const
export type ThresholdKey = keyof typeof THRESHOLDS
export const THRESHOLD_KEYS = Object.keys(THRESHOLDS) as ThresholdKey[]

/** Quién tiene que confirmar el valor propuesto de cada umbral nuevo. Se muestra como "[pendiente: dueño]". */
export const THRESHOLD_OWNER: Partial<Record<ThresholdKey, string>> = {
  trust_min_score: 'Ventas', route_daily_stores: 'Ventas', competitor_alert_visits: 'Ventas', competitor_window_days: 'Ventas',
  indirect_route_visits: 'Ventas y canales', perfect_store_health_days: 'Customer Success', threshold_review_days: 'Ventas', onboarding_link_days: 'Mesa de control',
}

export type Threshold = { value: number; version: number }

/** Valor vigente y su versión. Si un mercado no lo tiene, el valor de arranque más conservador (sin versión: 0). */
export async function threshold(tx: Tx, market: string, key: ThresholdKey): Promise<Threshold> {
  const rows = await tx<{ value: string; version: number }[]>`
    select value::text, version from crm.field_thresholds where market_code = ${market} and key = ${key} and valid_to is null`
  if (rows[0]) return { value: Number(rows[0].value), version: rows[0].version }
  const fallback: Record<ThresholdKey, number> = {
    under_plan_pct: 60, perfect_store_min: 60, claim_window_days: 14, claim_extension_days: 14, claim_max_extensions: 2,
    control_desk_sla_hours: 24, prepaid_auto_approve: 0, visit_every_days_a: 7, visit_every_days_b: 14, visit_every_days_c: 30, visit_every_days_d: 60,
    no_sale_days: 7, holdout_pct: 10, dispute_sla_days: 5,
    // Respaldo si un mercado nuevo no trae la fila propuesta de 0042 (la migración las siembra como dato).
    trust_min_score: 50, route_daily_stores: 10, competitor_alert_visits: 2, competitor_window_days: 60, indirect_route_visits: 3,
    perfect_store_health_days: 60, threshold_review_days: 90, onboarding_link_days: 7,
  }
  return { value: fallback[key], version: 0 }
}

const input = z.object({ market: z.string().min(2).max(3), key: z.enum(THRESHOLD_KEYS as [ThresholdKey, ...ThresholdKey[]]), value: z.coerce.number(), reason: z.string() })

export async function setThreshold(ctx: Ctx, raw: { market: string; key: string; value: string | number; reason: string }): Promise<number> {
  const p = input.safeParse(raw)
  if (!p.success) throw invalid('Elige el umbral y escribe un número.', 'Choose the threshold and type a number.')
  const { market, key, value } = p.data
  ctx.assert('threshold.manage', market)
  const def = THRESHOLDS[key]
  if (!Number.isFinite(value) || value < def.min || value > def.max) throw invalid(`El valor va de ${def.min} a ${def.max}.`, `The value goes from ${def.min} to ${def.max}.`)
  const reason = clean(p.data.reason)
  if (!reason || reason.length < 3) throw invalid('Escribe por qué cambia: queda con la versión nueva.', 'Write why it changes: it stays with the new version.')
  return withUser(ctx.user.id, async (tx) => {
    const cur = await tx<{ id: string; value: string; version: number }[]>`
      select id, value::text, version from crm.field_thresholds where market_code = ${market} and key = ${key} and valid_to is null for update`
    if (!ctx.markets.some((m) => m.code === market)) throw notFound()
    const version = (cur[0]?.version ?? 0) + 1
    if (cur[0]) await tx`update crm.field_thresholds set valid_to = now() where id = ${cur[0].id}`
    await tx`insert into crm.field_thresholds (market_code, key, value, version, reason, set_by) values (${market}, ${key}, ${value}, ${version}, ${reason.slice(0, 300)}, ${ctx.user.id})`
    await audit(tx, ctx, 'threshold.changed', 'threshold', null, market, cur[0] ? { key, value: Number(cur[0].value), version: cur[0].version } : null, { key, value, version, reason })
    return version
  })
}
