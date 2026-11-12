import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'

const hoursInput = z.object({
  market: z.string().length(2),
  /** Días hábiles, 1 = lunes ... 7 = domingo. */
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})

/**
 * Horario hábil de un mercado: dentro de él corre el reloj de primer contacto de los leads (app.business_due).
 * Lo cambia administración. Vale para los leads que entren después; los que ya tienen fecha de vencimiento la conservan.
 */
export async function setMarketHours(ctx: Ctx, input: z.input<typeof hoursInput>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = hoursInput.safeParse(input)
  if (!parsed.success) throw invalid('Elige al menos un día y una hora de apertura y de cierre.', 'Choose at least one day, an opening time and a closing time.')
  const v = parsed.data
  if (v.opens >= v.closes) throw invalid('La hora de cierre tiene que ser después de la de apertura.', 'The closing time must be after the opening time.')
  const days = [...new Set(v.days)].sort((a, b) => a - b)
  ctx.market(v.market)
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ days: number[]; opens: string; closes: string }[]>`
      select days, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes from crm.market_hours where market_code = ${v.market} for update`
    await tx`insert into crm.market_hours (market_code, days, opens, closes, updated_by, updated_at)
             values (${v.market}, ${days}::int[], ${v.opens}::time, ${v.closes}::time, ${ctx.user.id}, now())
             on conflict (market_code) do update set days = excluded.days, opens = excluded.opens, closes = excluded.closes,
                                                     updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    await audit(tx, ctx, 'routing.hours_updated', 'market', null, v.market, before[0] ?? null, { days, opens: v.opens, closes: v.closes })
  })
}
