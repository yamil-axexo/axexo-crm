import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { flat } from '@/server/params'
import { REPORT_DAYS, embudoReport } from '@/dal/embudo'
import { Card, CardTitle, PageHeader, Pills, Stat } from '@/ui/kit'
import { BackToReports, DataTable, linkClass } from '@/ui/reportes'
import { FIELD_LABEL } from '@/domain/deals'
import { PLATFORM_LABEL, type Platform } from '@/domain/embudo/attribution'
import { LEAD_STATUS, MOTOR, lab, qs } from '@/lib/labels'
import { day, num } from '@/lib/format'

/**
 * Reporte del embudo (paquete embudo): motivos de pérdida y de no venta, revisitas a quien decide, próximos pasos que
 * faltan o quedaron muy lejos, de dónde vienen los leads y referidos entre comercios. Cada quien ve lo de su alcance.
 */
export default async function EmbudoReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  if (!ctx.can('report.gallery')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const days = (REPORT_DAYS as readonly number[]).includes(Number(sp.dias)) ? Number(sp.dias) : 90
  const r = await embudoReport(ctx, { market: sp.mercado, days })
  const href = (over: Record<string, string | undefined>) => qs('/reportes/embudo', { dias: String(days), mercado: r.market ?? undefined, ...over })
  const multi = ctx.markets.filter((m) => m.status === 'live').length > 1
  const empty = (text: string) => <p className="px-5 py-4 text-[14px] text-muted md:px-7">{text}</p>
  const missing = (tokens: string[]) => tokens.map((m) => (FIELD_LABEL[m] ? t(FIELD_LABEL[m]!.es, FIELD_LABEL[m]!.en) : m.replace(/^field:/, ''))).join(', ')
  const totalLost = r.lost.reduce((a, b) => a + b.n, 0)
  const totalNoSale = r.noSale.reduce((a, b) => a + b.n, 0)

  return (
    <>
      <BackToReports t={t} />
      <PageHeader title={t('Embudo: motivos, revisitas, próximos pasos y origen', 'Pipeline: reasons, revisits, next steps and origin')}
        desc={t('Por qué se pierde, qué quedó sin siguiente paso, de dónde llegan los leads y qué comercios refieren a otros.', 'Why deals are lost, what has no next step, where leads come from and which merchants refer others.')} />
      <div className="mb-3"><Pills label={t('Periodo', 'Period')} current={String(days)} items={REPORT_DAYS.map((d) => ({ key: String(d), href: href({ dias: String(d) }), label: t(`Últimos ${d} días`, `Last ${d} days`) }))} /></div>
      {multi && <div className="mb-6"><Pills label={t('Mercado', 'Market')} current={r.market ?? 'todos'} items={[{ key: 'todos', href: href({ mercado: undefined }), label: t('Todos', 'All') }, ...ctx.markets.filter((m) => m.status === 'live').map((m) => ({ key: m.code, href: href({ mercado: m.code }), label: m.name }))]} /></div>}
      <p className="mb-6 text-[13px] text-muted" data-testid="embudo-cut">
        {r.cut ? t(`Los hitos de venta (fondeo, primera transacción, hábito) llegan con el archivo de ventas. Último corte cargado: ${day(r.cut, locale)}.`, `Sales milestones (funding, first transaction, habit) arrive with the sales file. Last cut loaded: ${day(r.cut, locale)}.`)
               : t('Los hitos de venta llegan con el archivo de ventas. Todavía no se ha cargado ninguno.', 'Sales milestones arrive with the sales file. None has been loaded yet.')}
      </p>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t('Negocios perdidos', 'Deals lost')} value={num(totalLost, locale)} testId="stat-lost" />
        <Stat label={t('Visitas sin venta', 'Visits with no sale')} value={num(totalNoSale, locale)} testId="stat-no-sale" />
        <Stat label={t('Revisitas a quien decide', 'Revisits to the decision-maker')} value={num(r.revisits.pending, locale)} hint={t(`${r.revisits.overdue} vencidas`, `${r.revisits.overdue} overdue`)} tone={r.revisits.overdue > 0 ? 'warn' : undefined} testId="stat-revisits" />
        <Stat label={t('Abiertos sin próximo paso', 'Open with no next step')} value={num(r.noStepDeals.length + r.noStepLeads.length + r.noStepAccounts.length, locale)} tone={r.noStepDeals.length + r.noStepLeads.length + r.noStepAccounts.length > 0 ? 'warn' : undefined} testId="stat-no-step" />
      </div>

      <div className="space-y-8">
        <Card pad={false} data-testid="report-reasons">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Motivos de pérdida, por tipo de venta y mercado', 'Loss reasons, by sales type and market')} hint={t('Todo negocio perdido lleva su motivo del catálogo: sin motivo no se cierra.', 'Every lost deal carries a reason from the catalog: it cannot be closed without one.')} /></div>
          <DataTable testId="lost-table" label={t('Motivos de pérdida', 'Loss reasons')} empty={empty(t('No se perdió ningún negocio en este periodo.', 'No deal was lost in this period.'))}
            head={[{ label: t('Mercado', 'Market') }, { label: t('Tipo de venta', 'Sales type') }, { label: t('Motivo', 'Reason') }, { label: t('Negocios', 'Deals'), num: true }, { label: t('Parte', 'Share'), num: true }]}
            rows={r.lost.map((x) => ({ key: `${x.market_code}-${x.motor}-${x.code}`, cells: [x.market_code, lab(t, MOTOR[x.motor], x.motor), t(x.label_es, x.label_en), num(x.n, locale), `${Math.round((x.n * 100) / Math.max(totalLost, 1))}%`] }))} />
          <div className="border-t border-line px-5 pt-5 md:px-7"><CardTitle title={t('Motivos de no venta en visitas', 'No-sale reasons on visits')} hint={t('Suma las visitas que llegan de la Sales App y las que se capturan aquí.', 'Adds visits arriving from the Sales App and those captured here.')} /></div>
          <DataTable testId="no-sale-table" label={t('Motivos de no venta', 'No-sale reasons')} empty={empty(t('No hay visitas sin venta en este periodo.', 'There are no visits with no sale in this period.'))}
            head={[{ label: t('Mercado', 'Market') }, { label: t('Motivo', 'Reason') }, { label: t('Visitas', 'Visits'), num: true }]}
            rows={r.noSale.map((x) => ({ key: `${x.market_code}-${x.code}`, cells: [x.market_code, t(x.label_es, x.label_en), num(x.n, locale)] }))} />
        </Card>

        <Card pad={false} data-testid="report-revisits">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Visitas por alta ganada (tiendas)', 'Visits per store won')} hint={t('Cuántas visitas hicieron falta, en promedio, para ganar una tienda. Si sube, "no estaba quien decide" está costando visitas.', 'How many visits it took, on average, to win a store. If it rises, "the decision-maker was not there" is costing visits.')}
            right={<Link href="/pipelines?revisita=1" className={linkClass} data-testid="report-revisit-link">{t('Ver negocios con revisita', 'See deals with a revisit')}</Link>} /></div>
          <DataTable testId="visits-per-win" label={t('Visitas por alta', 'Visits per win')} empty={empty(t('No se ganó ninguna tienda en este periodo.', 'No store was won in this period.'))}
            head={[{ label: t('Mercado', 'Market') }, { label: t('Tiendas ganadas', 'Stores won'), num: true }, { label: t('Visitas antes de ganar', 'Visits before the win'), num: true }, { label: t('Visitas por alta', 'Visits per win'), num: true }]}
            rows={r.visitsPerWin.map((x) => ({ key: x.market_code, cells: [x.market_code, num(x.wins, locale), num(x.visits, locale), (x.visits / Math.max(x.wins, 1)).toFixed(1)] }))} />
        </Card>

        <Card pad={false} data-testid="report-next-steps">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Sin próximo paso', 'No next step')} hint={t('Negocios abiertos, leads ya contactados y comercios en alta que no tienen una tarea siguiente con fecha y con alguien que la lleve.', 'Open deals, leads already contacted and merchants being onboarded that have no next task with a date and an owner.')} /></div>
          <DataTable testId="no-step-table" label={t('Sin próximo paso', 'No next step')} empty={empty(t('Todo lo abierto tiene próximo paso.', 'Everything open has a next step.'))}
            head={[{ label: t('Qué es', 'What') }, { label: t('Registro', 'Record') }, { label: t('Quién lo lleva', 'Owner') }, { label: t('Mercado', 'Market') }]}
            rows={[
              ...r.noStepDeals.map((x) => ({ key: `d-${x.id}`, cells: [t('Negocio', 'Deal'), <Link key="l" href={`/deals/${x.id}`} className={linkClass}>{x.title} · {x.account}</Link>, x.owner ?? t('Sin asignar', 'Unassigned'), x.market_code] })),
              ...r.noStepLeads.map((x) => ({ key: `l-${x.id}`, cells: [`${t('Lead', 'Lead')} (${lab(t, LEAD_STATUS[x.status]?.label, x.status)})`, <Link key="l" href={`/leads/${x.id}`} className={linkClass}>{x.business_name}</Link>, x.owner ?? t('Sin asignar', 'Unassigned'), x.market_code] })),
              ...r.noStepAccounts.map((x) => ({ key: `a-${x.id}`, cells: [t('Comercio en alta', 'Merchant being onboarded'), <Link key="l" href={`/comercios/${x.id}`} className={linkClass}>{x.name}</Link>, x.owner ?? t('Sin asignar', 'Unassigned'), x.market_code] })),
            ]} />
          <div className="border-t border-line px-5 pt-5 md:px-7"><CardTitle title={t('Próximos pasos a más de 60 días', 'Next steps more than 60 days out')} hint={t('Una fecha muy lejana apaga el aviso sin que pase nada. Conviene revisarlas una por una.', 'A far-off date silences the alert while nothing happens. They are worth reviewing one by one.')} /></div>
          <DataTable testId="far-steps-table" label={t('Próximos pasos lejanos', 'Far next steps')} empty={empty(t('Ningún próximo paso está a más de 60 días.', 'No next step is more than 60 days out.'))}
            head={[{ label: t('Negocio', 'Deal') }, { label: t('Quién lo lleva', 'Owner') }, { label: t('Fecha', 'Date') }, { label: t('Días', 'Days'), num: true }]}
            rows={r.farSteps.map((x) => ({ key: x.id, cells: [<Link key="l" href={`/deals/${x.id}`} className={linkClass}>{x.title} · {x.account}</Link>, x.owner ?? t('Sin asignar', 'Unassigned'), day(x.due, locale), num(x.days, locale)] }))} />
        </Card>

        <Card pad={false} data-testid="report-gaps">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Entraron a su etapa sin lo que la etapa pide', 'Entered their stage without what the stage asks for')} hint={t('Negocios que llegaron por importación o por un movimiento de administración. Nadie puede moverlos de etapa hasta completar lo que falta.', 'Deals that arrived by import or by an administration move. Nobody can move them to another stage until what is missing is filled in.')} /></div>
          <DataTable testId="gaps-table" label={t('Negocios con requisitos pendientes', 'Deals with pending requirements')} empty={empty(t('Ningún negocio está en una etapa sin lo que pide.', 'No deal sits in a stage without what it asks for.'))}
            head={[{ label: t('Negocio', 'Deal') }, { label: t('Etapa', 'Stage') }, { label: t('Le falta', 'Missing') }, { label: t('Cómo entró', 'How it came in') }]}
            rows={r.gaps.map((x) => ({ key: x.id, testId: 'gap-row', cells: [<Link key="l" href={`/deals/${x.id}`} className={linkClass}>{x.title} · {x.account}</Link>, t(x.stage_es, x.stage_en), missing(x.missing), x.source === 'import' ? t('Importación', 'Import') : t('Movimiento de administración', 'Administration move')] }))} />
        </Card>

        <Card pad={false} data-testid="report-attribution">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('De dónde vienen los leads', 'Where leads come from')} hint={t('Por fuente, campaña y plataforma del clic (primer toque). La atribución viaja al comercio y al negocio al convertir.', 'By source, campaign and click platform (first touch). Attribution travels to the merchant and the deal on conversion.')} /></div>
          <DataTable testId="attribution-table" label={t('Atribución', 'Attribution')} empty={empty(t('Ningún lead de este periodo trae datos de campaña.', 'No lead in this period carries campaign data.'))}
            head={[{ label: t('Fuente', 'Source') }, { label: t('Campaña', 'Campaign') }, { label: t('Plataforma del clic', 'Click platform') }, { label: t('Leads', 'Leads'), num: true }, { label: t('Convertidos', 'Converted'), num: true }, { label: t('Negocios ganados', 'Deals won'), num: true }]}
            rows={r.attribution.map((x) => ({ key: `${x.source}|${x.campaign}|${x.platform}`, cells: [
              x.source ? <Link key="s" href={qs('/leads', { utm: x.source })} className={linkClass}>{x.source}</Link> : t('Sin fuente', 'No source'), x.campaign || t('Sin campaña', 'No campaign'),
              x.platform ? PLATFORM_LABEL[x.platform as Platform] ?? x.platform : t('Sin clic de anuncio', 'No ad click'), num(x.leads, locale), num(x.converted, locale), num(x.won, locale)] }))} />
        </Card>

        <Card pad={false} data-testid="report-referrals">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Referidos entre comercios', 'Merchant-to-merchant referrals')} hint={t('Cada comercio con su enlace de referido. Cuenta el referido que ya hizo su primera venta, no el alta vacía.', 'Each merchant with its referral link. What counts is the referral that already made its first sale, not an empty sign-up.')} /></div>
          <DataTable testId="referrals-table" label={t('Referidos', 'Referrals')} empty={empty(t('Ningún lead de este periodo llegó por el enlace de referido de un comercio.', 'No lead in this period came through a merchant’s referral link.'))}
            head={[{ label: t('Comercio que refiere', 'Referring merchant') }, { label: t('Código', 'Code') }, { label: t('Referidos', 'Referred'), num: true }, { label: t('Convertidos', 'Converted'), num: true }, { label: t('Con primera venta', 'With first sale'), num: true }]}
            rows={r.referrals.map((x) => ({ key: x.id, testId: 'referral-row', cells: [<Link key="l" href={`/comercios/${x.id}?tab=datos`} className={linkClass}>{x.name}</Link>, x.code ?? t('n/a', 'n/a'), num(x.referred, locale), num(x.converted, locale), num(x.first_sale, locale)] }))} />
        </Card>
      </div>
    </>
  )
}
