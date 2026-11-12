import type { Ctx } from '@/server/context'
import { getHolders } from '@/dal/reparto'
import { LinkButton } from '@/ui/kit'
import { holderName, holdsText } from '@/lib/reparto-text'
import { qs } from '@/lib/labels'

/**
 * Personas y cuentas que ya no tienen un rol vigente de ventas ni de operaciones y todavía tienen cartera a su nombre. Aparece en
 * Personas y acceso para que quitar un acceso no deje registros olvidados: dice cuántos son y lleva a repartirlos.
 */
export async function VacantNotice({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const live = ctx.markets.filter((m) => m.status === 'live').map((m) => m.code)
  const held = (await getHolders(ctx, live)).filter((h) => h.owner_id && !h.current && h.accounts + h.deals + h.leads > 0)
  if (held.length === 0) return null
  return (
    <section className="card mb-8 p-6" data-testid="admin-vacant" aria-label={t('Cartera sin dueño vigente', 'Book with no current owner')}>
      <h2 className="text-[18px] leading-[26px] font-semibold">{t('Cartera sin dueño vigente', 'Book with no current owner')}</h2>
      <p className="mt-1 text-[13px] text-muted">{t('Estas personas o cuentas ya no tienen un rol de ventas ni de operaciones en ese mercado y siguen teniendo registros a su nombre. Los ve supervisión y quien lidera el mercado, para repartirlos.', 'These people or accounts no longer have a sales or operations role in that market and still hold records. Supervisors and the market lead can see them, to distribute them.')}</p>
      <ul className="mt-3">
        {held.slice(0, 12).map((h) => (
          <li key={`${h.owner_id}${h.market_code}`} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-line py-3.5 first:border-t-0" data-testid="admin-vacant-row">
            <p className="min-w-0 flex-1 basis-[260px] text-[14px] text-muted-2"><span className="font-semibold text-strong">{holderName(t, h)} · {h.market_code}.</span> {holdsText(t, locale, h)}</p>
            <LinkButton href={h.accounts > 0 ? qs('/comercios', { owner: h.owner_id, market: h.market_code, repartir: '1' }) : qs('/supervisor', { market: h.market_code })} testId="admin-vacant-go">{t('Repartir', 'Distribute')}</LinkButton>
          </li>
        ))}
      </ul>
      {held.length > 12 && <p className="mt-2 text-[13px] text-muted">{t(`Y ${held.length - 12} más, en Mi equipo.`, `And ${held.length - 12} more, in My team.`)}</p>}
    </section>
  )
}
