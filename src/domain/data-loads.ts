import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { LOAD_KEYS } from '@/server/loads'

/** E5.F3: responsable y hora esperada de una carga. Sin hora, la carga no se vigila por horario. */
const loadInput = z.object({
  key: z.enum(LOAD_KEYS),
  owner: z.string().uuid().nullable(),
  expectedBy: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  clockMarket: z.string().length(2).nullable(),
})
export async function configureLoad(ctx: Ctx, raw: z.input<typeof loadInput>): Promise<void> {
  const v = loadInput.safeParse(raw)
  if (!v.success) throw invalid('Revisa la hora (HH:MM) y la persona.', 'Check the time (HH:MM) and the person.')
  const { key, owner, expectedBy, clockMarket } = v.data
  ctx.assert('load.configure')
  if (expectedBy && !clockMarket) throw invalid('Con hora esperada, elige el mercado de cuyo reloj se toma.', 'With an expected time, pick the market whose clock it uses.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ owner_id: string | null; expected_by: string | null; clock_market: string | null }[]>`select owner_id, to_char(expected_by, 'HH24:MI') as expected_by, clock_market from crm.data_loads where key = ${key}`
    if (!before[0]) throw notFound()
    if (owner) {
      const ok = await tx`select 1 from crm.users where id = ${owner} and is_active`
      if (!ok[0]) throw invalid('Esa persona no está activa.', 'That person is not active.')
    }
    await tx`update crm.data_loads set owner_id = ${owner}, expected_by = ${expectedBy}::time, clock_market = ${expectedBy ? clockMarket : null},
             updated_by = ${ctx.user.id}, updated_at = now() where key = ${key}`
    await audit(tx, ctx, 'load.configured', 'data_load', null, null, before[0], { key, owner_id: owner, expected_by: expectedBy, clock_market: expectedBy ? clockMarket : null })
  })
}

/** E5.F4: ventana diaria sin cargas de un mercado (hora local). Apagarla la deja guardada sin efecto. */
const windowInput = z.object({
  market: z.string().length(2),
  starts: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  ends: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  active: z.boolean(),
})
export async function setLoadWindow(ctx: Ctx, raw: z.input<typeof windowInput>): Promise<void> {
  const v = windowInput.safeParse(raw)
  if (!v.success) throw invalid('Pon la hora de inicio y de fin (HH:MM).', 'Enter the start and end time (HH:MM).')
  const { market, starts, ends, active } = v.data
  ctx.assert('load.configure')
  ctx.market(market)
  if (starts === ends) throw invalid('El inicio y el fin no pueden ser la misma hora.', 'The start and end cannot be the same time.')
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.load_windows (market_code, starts_local, ends_local, is_active, updated_by)
             values (${market}, ${starts}::time, ${ends}::time, ${active}, ${ctx.user.id})
             on conflict (market_code) do update set starts_local = excluded.starts_local, ends_local = excluded.ends_local,
               is_active = excluded.is_active, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'load.window_set', 'market', null, market, null, { starts, ends, active })
  })
}
