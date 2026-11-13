import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'

/**
 * ACT-01: el hilo es de solo agregar. Lo que ya pasó (una actividad hecha) no se reescribe: se corrige con una fila nueva
 * que apunta a la original, y las dos quedan a la vista. La base lo repite (trigger activities_append_only).
 */
const correction = z.object({ subject: z.string().trim().min(2).max(200), body: z.string().trim().max(4000).optional().default(''), reason: z.string().trim().min(3).max(200) })

export async function correctActivity(ctx: Ctx, activityId: string, raw: z.input<typeof correction>): Promise<string> {
  const p = correction.safeParse(raw)
  if (!p.success) throw invalid('Escribe la corrección y por qué la haces.', 'Write the correction and why you are making it.')
  const v = p.data
  assertNoProhibited(v.subject, v.body, v.reason)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; account_id: string | null; deal_id: string | null; lead_id: string | null; kind: string; done_at: Date | null; created_by: string | null; visibility_class: string; corrected_at: Date | null }[]>`
      select market_code, account_id, deal_id, lead_id, kind, done_at, created_by, visibility_class, corrected_at from crm.activities where id = ${activityId}`
    const a = rows[0]
    if (!a) throw notFound()
    ctx.assert('activity.correct', a.market_code)
    if (!a.done_at) throw invalid('Una tarea pendiente se edita o se completa; la corrección es para lo que ya pasó.', 'A pending task is edited or completed; corrections are for what already happened.')
    if (a.corrected_at) throw invalid('Esta actividad ya tiene una corrección. Corrige la más reciente.', 'This activity already has a correction. Correct the latest one.')
    if (a.created_by !== ctx.user.id && !ctx.memberships.some((m) => ['admin', 'market_lead', 'supervisor'].includes(m.role))) {
      throw invalid('La corrige quien la escribió o quien dirige.', 'It is corrected by whoever wrote it or by a manager.')
    }
    const id = await newId(tx)
    const body = [v.body, `${ctx.locale === 'en' ? 'Correction' : 'Corrección'}: ${v.reason}`].filter(Boolean).join('\n\n')
    await tx`insert into crm.activities (id, market_code, account_id, deal_id, lead_id, kind, subject, body, done_at, owner_id, created_by, visibility_class, corrects_id)
             values (${id}, ${a.market_code}, ${a.account_id}, ${a.deal_id}, ${a.lead_id}, ${a.kind}, ${v.subject}, ${body}, now(), ${ctx.user.id}, ${ctx.user.id}, ${a.visibility_class}, ${activityId})`
    await audit(tx, ctx, 'activity.corrected', 'activity', id, a.market_code, { activity_id: activityId }, { corrects: activityId, reason: v.reason })
    return id
  })
}

/** Retención (crm.funnel_settings 'activity_retention_months'): vacío no borra nada. Devuelve cuántas filas quitó. */
export async function applyActivityRetention(tx: Tx): Promise<number> {
  const r = await tx<{ n: number }[]>`select app.activity_retention_apply() as n`
  return r[0]?.n ?? 0
}

/**
 * ACT-01: el resumen semanal de ventas (archivo de ventas) entra al hilo del comercio como UNA entrada por semana, nunca
 * fila a fila. Toma la semana anterior completa en el día del mercado.
 */
export async function weeklySalesSummary(tx: Tx, systemUserId: string): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    with wk as (
      select m.code, to_char((now() at time zone m.timezone)::date, 'IYYY-"W"IW') as week, (now() at time zone m.timezone)::date as today from crm.markets m
    ), latest as (
      select distinct on (l.account_id) l.account_id, l.market_code, l.as_of, w.week
        from crm.store_sales_lines l join wk w on w.code = l.market_code
       where l.as_of > w.today - 7
       order by l.account_id, l.as_of desc
    ), agg as (
      select x.account_id, x.market_code, x.as_of, x.week,
             coalesce(sum(l.mtd) filter (where l.line_kind = 'activations'), 0)::bigint as act,
             coalesce(sum(l.mtd) filter (where l.line_kind = 'payments'), 0)::bigint as pay, min(l.currency) as cur
        from latest x join crm.store_sales_lines l on l.account_id = x.account_id and l.as_of = x.as_of
       group by 1, 2, 3, 4
    )
    insert into crm.activities (market_code, account_id, kind, subject, body, done_at, created_by, source, custom)
    select g.market_code, g.account_id, 'system', 'Resumen semanal de ventas (' || g.week || ')',
           'Corte al ' || to_char(g.as_of, 'DD/MM/YYYY') || ': ' || g.act || ' activaciones en el mes; pagos del mes ' || to_char(g.pay / 100.0, 'FM999,999,990.00') || coalesce(' ' || g.cur, '') || '.',
           now(), ${systemUserId}, 's5', jsonb_build_object('weekly_summary', g.week, 'as_of', g.as_of::text, 'activations_mtd', g.act, 'payments_mtd_minor', g.pay)
      from agg g
     where not exists (select 1 from crm.activities x where x.account_id = g.account_id and x.source = 's5' and x.custom ->> 'weekly_summary' = g.week)
    returning id`
  return rows.length
}
