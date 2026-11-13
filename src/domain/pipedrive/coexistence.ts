import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { STAGE_COMPANIONS, type Obj } from './edits'

/**
 * E6.F2 y GOB-05: lo que una persona decide en la convivencia con Pipedrive.
 * - Un choque (el mismo campo cambió en CONTIGO y en Pipedrive): quedarse con lo de CONTIGO o usar lo de Pipedrive.
 * - El corte de un mercado: fecha planeada, congelar Pipedrive, y apagarlo cuando ya corrió la última sincronización.
 * - La cifra de una meta.
 */
const TABLE: Record<Obj, string> = { account: 'crm.accounts', contact: 'crm.contacts', deal: 'crm.deals' }

async function setBase(tx: Tx, object: Obj, recordId: string, market: string, field: string, value: unknown): Promise<void> {
  const v = value !== null && typeof value === 'object' ? ((value as Record<string, unknown>)[field] ?? null) : value
  await tx`insert into crm.import_baselines (object, record_id, market_code, fields) values (${object}, ${recordId}, ${market}, jsonb_build_object(${field}::text, ${v as string | null}::text))
           on conflict (object, record_id) do update set fields = crm.import_baselines.fields || jsonb_build_object(${field}::text, ${v as string | null}::text), updated_at = now()`
}

export async function resolveConflict(ctx: Ctx, id: string, choice: 'keep' | 'take'): Promise<void> {
  if (choice !== 'keep' && choice !== 'take') throw invalid('Elige con qué valor te quedas.', 'Choose which value to keep.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ object: Obj; record_id: string; market_code: string; field: string; contigo_value: unknown; pipedrive_value: unknown; status: string }[]>`
      select object, record_id, market_code, field, contigo_value, pipedrive_value, status from crm.import_conflicts where id = ${id} for update`
    const c = rows[0]
    if (!c) throw notFound()
    ctx.assert('migration.decide', c.market_code)
    if (c.status !== 'open') throw invalid('Ese choque ya se decidió.', 'That clash was already decided.')
    if (choice === 'take') {
      if (c.object === 'deal' && c.field === 'stage_id') {
        const pd = (c.pipedrive_value ?? {}) as Record<string, string | null>
        const cur = await tx<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${c.record_id} for update`
        if (!cur[0]) throw notFound()
        const sets: Record<string, string | null> = { stage_id: pd.stage_id ?? null }
        for (const k of STAGE_COMPANIONS) if (k !== 'stage_entered_at') sets[k] = pd[k] ?? null
        if (!sets.stage_id) throw invalid('Pipedrive no trae una etapa para este negocio.', 'Pipedrive does not bring a stage for this deal.')
        await tx`update crm.deals set stage_id = ${sets.stage_id}, pipeline_id = coalesce(${sets.pipeline_id}::uuid, pipeline_id), status = coalesce(${sets.status}, status),
                   won_at = ${sets.won_at}::timestamptz, lost_at = ${sets.lost_at}::timestamptz, loss_reason_code = ${sets.loss_reason_code}, loss_note = ${sets.loss_note},
                   closed_by = ${sets.closed_by}, stage_entered_at = now()
                 where id = ${c.record_id}`
        await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
                 values (${c.record_id}, ${c.market_code}, ${cur[0].stage_id}, ${sets.stage_id}, ${ctx.user.id}, 'import')`
      } else {
        await tx`update ${tx.unsafe(TABLE[c.object])} set ${tx(c.field)} = ${c.pipedrive_value as string | null} where id = ${c.record_id}`
      }
    }
    // Desde aquí la base es lo que trajo Pipedrive: si Pipedrive no vuelve a cambiar, no hay choque nuevo.
    await setBase(tx, c.object, c.record_id, c.market_code, c.field, c.pipedrive_value)
    await tx`update crm.import_conflicts set status = ${choice === 'keep' ? 'kept' : 'taken'}, decided_by = ${ctx.user.id}, decided_at = now() where id = ${id}`
    await audit(tx, ctx, choice === 'keep' ? 'import.conflict_kept' : 'import.conflict_taken', c.object, c.record_id, c.market_code,
      { field: c.field, value: c.contigo_value }, { field: c.field, value: choice === 'keep' ? c.contigo_value : c.pipedrive_value })
  })
}

const cutoverInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('date'), cutoffOn: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]) }),
  z.object({ action: z.literal('freeze') }),
  z.object({ action: z.literal('unfreeze') }),
  z.object({ action: z.literal('off') }),
])
export type CutoverInput = z.input<typeof cutoverInput>

/**
 * E6.F3: el corte es un congelamiento, una última sincronización y después solo CONTIGO.
 * Congelar: el equipo deja de editar en Pipedrive. La siguiente carga es la última sincronización. Apagar: solo después de esa
 * carga y sin choques por decidir; desde ahí la recarga ya no toca registros del mercado. Apagar no se deshace desde la pantalla.
 */
export async function setCutover(ctx: Ctx, market: string, raw: CutoverInput): Promise<void> {
  ctx.assert('migration.decide', market)
  const parsed = cutoverInput.safeParse(raw)
  if (!parsed.success) throw invalid('Revisa la fecha de corte (AAAA-MM-DD).', 'Check the cutover date (YYYY-MM-DD).')
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const mk = await tx`select 1 from crm.markets where code = ${market} and status = 'live'`
    if (!mk[0]) throw notFound()
    await tx`insert into crm.pipedrive_cutover (market_code, updated_by) values (${market}, ${ctx.user.id}) on conflict do nothing`
    const rows = await tx<{ cutoff_on: string | null; frozen_at: Date | null; last_sync_at: Date | null; pipedrive_off_at: Date | null }[]>`
      select cutoff_on::text, frozen_at, last_sync_at, pipedrive_off_at from crm.pipedrive_cutover where market_code = ${market} for update`
    const c = rows[0]!
    if (c.pipedrive_off_at) throw invalid('Pipedrive ya está apagado para este mercado.', 'Pipedrive is already off for this market.')
    if (v.action === 'date') {
      await tx`update crm.pipedrive_cutover set cutoff_on = ${v.cutoffOn || null}::date, updated_by = ${ctx.user.id}, updated_at = now() where market_code = ${market}`
    } else if (v.action === 'freeze') {
      if (c.frozen_at) throw invalid('Ya está congelado.', 'It is already frozen.')
      if (!c.cutoff_on) throw invalid('Primero pon la fecha de corte.', 'Set the cutover date first.')
      await tx`update crm.pipedrive_cutover set frozen_at = now(), last_sync_at = null, updated_by = ${ctx.user.id}, updated_at = now() where market_code = ${market}`
    } else if (v.action === 'unfreeze') {
      if (!c.frozen_at) throw invalid('No está congelado.', 'It is not frozen.')
      await tx`update crm.pipedrive_cutover set frozen_at = null, last_sync_at = null, updated_by = ${ctx.user.id}, updated_at = now() where market_code = ${market}`
    } else {
      if (!c.frozen_at || !c.last_sync_at) throw invalid('Antes de apagar: congela Pipedrive y corre la última sincronización.', 'Before switching off: freeze Pipedrive and run the last sync.')
      const open = await tx<{ n: number }[]>`select count(*)::int as n from crm.import_conflicts where market_code = ${market} and status = 'open'`
      if ((open[0]?.n ?? 0) > 0) throw invalid('Quedan choques por decidir en este mercado.', 'There are clashes left to decide in this market.')
      await tx`update crm.pipedrive_cutover set pipedrive_off_at = now(), updated_by = ${ctx.user.id}, updated_at = now() where market_code = ${market}`
    }
    await audit(tx, ctx, 'import.cutover_updated', 'market', null, market,
      { cutoff_on: c.cutoff_on, frozen: Boolean(c.frozen_at) }, { action: v.action, ...(v.action === 'date' ? { cutoff_on: v.cutoffOn || null } : {}) })
  })
}

/** La cifra de una meta. Vacía: la meta sigue mostrando el avance y dice que falta la cifra. */
export async function setGoalTarget(ctx: Ctx, id: string, raw: string): Promise<void> {
  const t = raw.trim()
  const target = t === '' ? null : Number(t)
  if (target !== null && !(Number.isInteger(target) && target >= 1 && target <= 100000)) throw invalid('La meta es un número entero entre 1 y 100,000.', 'The goal is a whole number between 1 and 100,000.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; target: number | null }[]>`select market_code, target from crm.goals where id = ${id} for update`
    const g = rows[0]
    if (!g) throw notFound()
    ctx.assert('goal.manage', g.market_code)
    if (g.target === target) return
    await tx`update crm.goals set target = ${target}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'goal.updated', 'goal', id, g.market_code, { target: g.target }, { target })
  })
}
