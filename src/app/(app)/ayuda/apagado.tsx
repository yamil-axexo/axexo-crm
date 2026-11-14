import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { connectorStatus } from '@/server/adapters/registry'
import { allProposed, ownerEn, type ProposedRow } from '@/dal/proposed'
import { screenLabel } from '@/lib/screens'

/**
 * "Construido y apagado" (programa los 95): lo que CONTIGO ya tiene construido y no sale hacia afuera, con qué le falta y
 * quién lo enciende, más los valores propuestos con su dueño. Sale del mismo registro que Estado de CONTIGO
 * (src/server/adapters/registry.ts y src/dal/proposed.ts): nunca se escribe a mano, así no se queda atrás.
 */
export async function BuiltOff({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const list = connectorStatus()
  const off = list.filter((c) => c.mode !== 'live')
  const on = list.length - off.length
  // La lista de valores propuestos lee con los permisos de cada quien; si un rol no alcanza alguna parte, se muestra lo demás.
  let proposed: ProposedRow[] | null = null
  try { proposed = await allProposed(ctx) } catch { proposed = null }
  const canStatus = ctx.can('status.read')
  return (
    <section className="mt-12" data-testid="help-built-off" aria-labelledby="help-built-off-title">
      <h2 id="help-built-off-title" className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-strong">{t('Construido y apagado', 'Built and turned off')}</h2>
      <p className="mt-2 max-w-[70ch] text-[15px] leading-6 text-muted-2">
        {t(
          `Cada conexión hacia afuera está construida completa y no manda nada mientras esté apagada: lo que habría salido queda en una cola a la vista. Se enciende con tres cosas a la vez: su variable en "live", las credenciales del proveedor (en la plataforma, nunca en el código) y la referencia del sign-off escrito de Dan Mulligan o Michael Essiet. Hoy hay ${on} de ${list.length} encendidas.`,
          `Every outside connection is fully built and sends nothing while it is off: whatever would have gone out stays in a visible queue. It is turned on with three things at once: its variable set to "live", the provider credentials (on the platform, never in the code) and the reference of the written sign-off from Dan Mulligan or Michael Essiet. Today ${on} of ${list.length} are on.`,
        )}
      </p>
      <details className="mt-4 card px-5 py-3" data-testid="help-built-off-connectors">
        <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold text-strong">{t(`Conexiones apagadas (${off.length})`, `Connections turned off (${off.length})`)}</summary>
        <ul className="pb-2">
          {off.map(({ def }) => (
            <li key={def.key} className="border-t border-line py-3 first:border-t-0" data-testid="help-built-off-row" data-key={def.key}>
              <span className="block text-[15px] font-medium text-strong">{t(...def.name)}</span>
              <span className="block text-[13.5px] leading-5 text-muted-2 [overflow-wrap:anywhere]">{t('Qué falta y quién lo enciende: ', 'What is missing and who turns it on: ')}{t(...def.turnsOn)}</span>
            </li>
          ))}
        </ul>
      </details>
      {proposed && proposed.length > 0 && (
        <details className="mt-3 card px-5 py-3" data-testid="help-built-off-proposed">
          <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold text-strong">{t(`Valores propuestos y quién decide (${proposed.length})`, `Proposed values with an owner (${proposed.length})`)}</summary>
          <p className="text-[13.5px] leading-5 text-muted-2">{t('CONTIGO funciona con estos valores mientras quien decide no los fija. Cada uno dice quién lo decide y dónde se cambia.', 'CONTIGO runs with these values until the decision owner sets them. Each one says who decides it and where it is changed.')}</p>
          <ul className="pb-2">
            {proposed.map((u) => (
              <li key={u.key} className="border-t border-line py-3 first:border-t-0" data-testid="help-proposed-row">
                <span className="block text-[15px] font-medium text-strong">{t(...u.label)}</span>
                <span className="block text-[13.5px] leading-5 text-muted-2">
                  {t(`Lo decide: ${u.owner}. Se cambia en ${screenLabel(t, u.href)}.`, `Decided by: ${ownerEn(u.owner)}. Changed under ${screenLabel(t, u.href)}.`)}
                  {locale === 'en' && u.detail ? ` ${u.detail[1]}` : u.detail ? ` ${u.detail[0]}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canStatus && (
        <Link href="/estado" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold text-blue-text underline" data-testid="help-built-off-status">
          {t('Ver el detalle en Estado de CONTIGO', 'See the details in CONTIGO status')}
        </Link>
      )}
    </section>
  )
}
