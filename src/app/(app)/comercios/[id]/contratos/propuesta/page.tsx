import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { proposal } from '@/dal/partners'
import { SETTLEMENT_LABEL } from '@/domain/partners'
import { LinkButton } from '@/ui/kit'
import { PrintButton } from '@/ui/orders'
import { day, num } from '@/lib/format'
import { flat } from '@/server/params'

export const dynamic = 'force-dynamic'

/**
 * PIPE-07: la propuesta, generada de la plantilla con los términos guardados (vista imprimible; desde el navegador se guarda como
 * PDF). No se escribe a mano: si algo cambia, se guarda una versión nueva de los términos y la propuesta sale de ella.
 */
export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  const v = flat(await searchParams).v
  if (!/^[0-9a-f-]{36}$/.test(id) || (v && !/^[0-9a-f-]{36}$/.test(v))) notFound()
  const d = await proposal(ctx, id, v ?? null)
  if (!d) notFound()
  const { account: a, terms: tr } = d
  return (
    <div data-testid="proposal-print">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <LinkButton href={`/comercios/${id}/contratos`} testId="proposal-back">{t('Volver', 'Back')}</LinkButton>
        <PrintButton label={t('Imprimir o guardar como PDF', 'Print or save as PDF')} />
      </div>
      <article className="order-sheet card mx-auto max-w-[820px] p-6 md:p-10" data-testid="proposal-sheet">
        <p className="eyebrow">axexo</p>
        <h1 className="mt-1 text-[26px] leading-8 font-semibold">{t('Propuesta comercial', 'Commercial proposal')}</h1>
        <p className="mt-1 text-[14px] text-muted">{t(`Versión ${tr.version} de los términos`, `Terms version ${tr.version}`)} · {day(tr.created_at, locale)}</p>

        <section className="mt-7">
          <h2 className="text-[15px] font-semibold text-strong">{t('Para', 'For')}</h2>
          <p className="mt-1 text-[15px] text-strong" data-testid="proposal-account">{a.name}</p>
          <p className="text-[13.5px] text-muted">{[a.locality, a.region].filter(Boolean).join(', ')}</p>
          {a.entity && <p className="text-[13.5px] text-muted">{t('Con', 'With')} {a.entity}</p>}
        </section>

        <section className="mt-7">
          <h2 className="text-[15px] font-semibold text-strong">{t('Comisión por producto', 'Commission per product')}</h2>
          <table className="mt-2 w-full border-collapse text-[14px]" data-testid="proposal-lines">
            <thead><tr className="border-b border-line text-left"><th scope="col" className="py-2 pr-3">{t('Producto', 'Product')}</th><th scope="col" className="py-2 text-right">{t('Comisión', 'Commission')}</th></tr></thead>
            <tbody>
              {tr.commission_lines.map((l) => (
                <tr key={l.product} className="border-b border-line"><td className="py-2.5 pr-3 text-strong">{l.product}</td><td className="num py-2.5 text-right text-strong">{num(l.pct, locale)}%</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-7">
          <h2 className="text-[15px] font-semibold text-strong">{t('Condiciones', 'Conditions')}</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13.5px] text-strong md:grid-cols-2 print:grid-cols-2">
            <div><dt className="inline text-muted">{t('Liquidación', 'Settlement')}: </dt><dd className="inline">{t(...SETTLEMENT_LABEL[tr.settlement as 'prepaid'])}</dd></div>
            <div><dt className="inline text-muted">{t('Plazo', 'Term')}: </dt><dd className="inline">{t(`${tr.term_months} meses`, `${tr.term_months} months`)}</dd></div>
            <div><dt className="inline text-muted">{t('Vigencia', 'Valid')}: </dt><dd className="inline">{day(tr.valid_from, locale)} {t('a', 'to')} {day(tr.valid_to, locale)}</dd></div>
            <div><dt className="inline text-muted">{t('Renovación', 'Renewal')}: </dt><dd className="inline">{t(`aviso ${tr.renewal_notice_days} días antes del fin`, `notice ${tr.renewal_notice_days} days before the end`)}</dd></div>
            <div><dt className="inline text-muted">{t('Confidencialidad', 'Confidentiality')}: </dt><dd className="inline">{tr.nda ? t('Con acuerdo firmado', 'Signed NDA') : t('Por firmar', 'To be signed')}</dd></div>
            {tr.fees && <div><dt className="inline text-muted">{t('Cargos', 'Fees')}: </dt><dd className="inline">{tr.fees}</dd></div>}
          </dl>
          {tr.note && <p className="mt-3 text-[13.5px] text-strong">{tr.note}</p>}
        </section>
        <p className="mt-10 text-[12.5px] text-muted">{t('Esta propuesta no es un contrato. El contrato se firma aparte, con estos mismos términos.', 'This proposal is not a contract. The contract is signed separately, with these same terms.')}</p>
      </article>
    </div>
  )
}
