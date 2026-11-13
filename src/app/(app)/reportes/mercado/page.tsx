import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getMarketReport, REPORT_MONTHS } from '@/dal/mx'
import { track } from '@/dal/boards'
import { Card, CardTitle, Empty, PageHeader, Pills, Table } from '@/ui/kit'
import { ExportLink } from '@/ui/report'
import { money, monthYear, num, pct } from '@/lib/format'
import { MOTOR, SOURCE, lab, qs } from '@/lib/labels'
import { flat } from '@/server/params'

/** Barra de proporción: el largo dice cuánto pesa la fila frente a la mayor de su columna. Siempre va con su número al lado. */
function Bar({ value, max, tone = 'a' }: { value: number; max: number; tone?: 'a' | 'b' }) {
  const width = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0
  return <span aria-hidden className="block h-2 w-full min-w-[56px] overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: `${width}%`, background: tone === 'a' ? 'var(--cg-green-500)' : 'var(--cg-green-700, var(--cg-green-500))' }} /></span>
}

/**
 * Reporte de un mercado (E18.F10): leads capturados y convertidos, negocios por etapa y conteos por mes; y leads por tipo de
 * empresa y número de tiendas (E15.F5). Lo ven supervisión (lo de su equipo), quien lidera el mercado y leadership.
 */
export default async function MarketReportPage({ searchParams }: { searchParams: Promise<{ mercado?: string; meses?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const markets = ctx.markets.filter((m) => m.status === 'live' && ctx.can('report.view', m.code))
  if (markets.length === 0) notFound()
  const sp = flat(await searchParams)
  // México primero: es el mercado para el que se pidió este reporte; cualquier otro mercado en vivo se elige arriba.
  const market = markets.find((m) => m.code === sp.mercado) ?? markets.find((m) => m.code === 'MX') ?? markets[0]!
  const months = (REPORT_MONTHS as readonly number[]).includes(Number(sp.meses)) ? Number(sp.meses) : 6
  const data = await getMarketReport(ctx, market.code, months)
  await track(ctx, 'view.report.market')
  const params = { mercado: market.code, meses: String(months) }
  const canExport = ctx.can('report.export', market.code)
  const canMail = ctx.can('lead.mailing_export', market.code)
  const monthName = (m: string) => monthYear(`${m}-15T12:00:00Z`, locale)
  // Último día del mes 'YYYY-MM' (el día 0 del mes siguiente): es aritmética de calendario, no depende de la hora.
  const lastDay = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`
  const maxLeads = Math.max(1, ...data.monthly.map((r) => r.leads))
  const maxWon = Math.max(1, ...data.monthly.map((r) => r.won))
  const maxStage = Math.max(1, ...data.stages.map((r) => r.deals))
  const totals = data.monthly.reduce((a, r) => ({ leads: a.leads + r.leads, converted: a.converted + r.converted, won: a.won + r.won, lost: a.lost + r.lost }), { leads: 0, converted: 0, won: 0, lost: 0 })
  const pipelines = [...new Set(data.stages.map((s) => s.pipeline))]
  const bucket = (b: string) => (b === 'none' ? t('Sin dato', 'Not set') : b === '1' ? t('1 tienda', '1 store') : t(`${b} tiendas`, `${b} stores`))
  const none = t('Sin dato', 'Not set')

  return (
    <>
      <PageHeader
        title={t(`Reporte de ${market.name}`, `${market.name} report`)}
        desc={t('Leads capturados y convertidos, negocios por etapa y conteos por mes. Los meses son meses de calendario en la hora del mercado. Ves lo de tu alcance.', 'Leads captured and converted, deals by stage and monthly counts. Months are calendar months in the market’s time. You see what is in your scope.')}
        actions={canExport ? <ExportLink t={t} href={qs('/reportes/mercado/export', { ...params, que: 'mensual' })} testId="export-monthly">{t('Exportar meses (CSV)', 'Export months (CSV)')}</ExportLink> : undefined}
      />
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="market-report-filters">
        {markets.length > 1 && <Pills label={t('Mercado', 'Market')} current={market.code} items={markets.map((m) => ({ key: m.code, href: qs('/reportes/mercado', { mercado: m.code, meses: String(months) }), label: m.name }))} />}
        <Pills label={t('Periodo', 'Period')} current={String(months)} items={REPORT_MONTHS.map((n) => ({ key: String(n), href: qs('/reportes/mercado', { mercado: market.code, meses: String(n) }), label: t(`Últimos ${n} meses`, `Last ${n} months`) }))} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="market-totals">
        <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Leads capturados', 'Leads captured')}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-strong" data-testid="total-leads">{num(totals.leads, locale)}</p></div>
        <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Leads convertidos', 'Leads converted')}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-brand-text" data-testid="total-converted">{num(totals.converted, locale)}</p><p className="text-[13px] text-muted">{t(`${pct(totals.converted, totals.leads, locale)} de los capturados`, `${pct(totals.converted, totals.leads, locale)} of captured`)}</p></div>
        <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Negocios ganados', 'Deals won')}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-brand-text" data-testid="total-won">{num(totals.won, locale)}</p></div>
        <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Negocios perdidos', 'Deals lost')}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-strong" data-testid="total-lost">{num(totals.lost, locale)}</p></div>
      </div>

      <Card className="mt-6" pad={false} data-testid="market-monthly">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por mes', 'By month')} hint={t('Un lead cuenta en el mes en que llegó; una conversión, en el mes en que nació su negocio; un negocio ganado, en el mes de su fecha de cierre.', 'A lead counts in the month it arrived; a conversion, in the month its deal was created; a won deal, in the month of its close date.')} /></div>
        <Table testId="monthly-table" label={t('Conteos por mes', 'Monthly counts')} head={<><th>{t('Mes', 'Month')}</th><th>{t('Leads capturados', 'Leads captured')}</th><th>{t('Convertidos', 'Converted')}</th><th>{t('Negocios creados', 'Deals created')}</th><th>{t('Ganados', 'Won')}</th><th>{t('Perdidos', 'Lost')}</th></>}>
          {data.monthly.map((r) => (
            <tr key={r.month} className="table-row" data-testid="monthly-row">
              <td className="font-semibold whitespace-nowrap text-strong"><Link href={qs('/leads', { market: market.code, status: 'all', from: `${r.month}-01`, to: lastDay(r.month) })} className="underline decoration-line-2 underline-offset-4 hover:decoration-current">{monthName(r.month)}</Link></td>
              <td><span className="flex items-center gap-3"><span className="num w-10 shrink-0" data-testid="month-leads">{num(r.leads, locale)}</span><Bar value={r.leads} max={maxLeads} /></span></td>
              <td className="num" data-testid="month-converted">{num(r.converted, locale)}</td>
              <td className="num">{num(r.deals_created, locale)}</td>
              <td><span className="flex items-center gap-3"><span className="num w-10 shrink-0" data-testid="month-won">{num(r.won, locale)}</span><Bar value={r.won} max={maxWon} tone="b" /></span></td>
              <td className="num">{num(r.lost, locale)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card className="mt-6" pad={false} data-testid="market-stages">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 md:px-7 md:pt-6">
          <CardTitle title={t('Negocios abiertos por etapa', 'Open deals by stage')} hint={t('Lo que hay hoy en cada etapa de cada embudo.', 'What sits in each stage of each pipeline today.')} />
          {canExport && <ExportLink t={t} href={qs('/reportes/mercado/export', { ...params, que: 'etapas' })} testId="export-stages">{t('Exportar CSV', 'Export CSV')}</ExportLink>}
        </div>
        {data.stages.length === 0 ? (
          <div className="p-6"><Empty title={t('Este mercado todavía no tiene embudos', 'This market has no pipelines yet')} hint={t('Administración los crea en Embudos y campos.', 'Administration creates them under Pipelines and fields.')} /></div>
        ) : pipelines.map((name) => (
          <div key={name} className="border-t border-line first:border-t-0" data-testid="stage-group">
            <p className="px-5 pt-4 text-[14px] font-semibold text-strong md:px-7">{name} <span className="font-normal text-muted">· {lab(t, MOTOR[data.stages.find((s) => s.pipeline === name)!.motor])}</span></p>
            <Table label={name} head={<><th>{t('Etapa', 'Stage')}</th><th>{t('Negocios', 'Deals')}</th><th>{t('Monto', 'Amount')}</th></>}>
              {data.stages.filter((s) => s.pipeline === name).map((s) => (
                <tr key={`${name}:${s.position}`} className="table-row" data-testid="stage-row">
                  <td className="font-medium text-strong">{t(s.stage_es, s.stage_en)}</td>
                  <td><span className="flex items-center gap-3"><span className="num w-10 shrink-0">{num(s.deals, locale)}</span><Bar value={s.deals} max={maxStage} /></span></td>
                  <td className="num whitespace-nowrap">{s.amount === null ? t('s/d', 'n/a') : money(Number(s.amount), s.currency, locale)}</td>
                </tr>
              ))}
            </Table>
          </div>
        ))}
      </Card>

      <Card className="mt-6" pad={false} data-testid="market-types">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 md:px-7 md:pt-6">
          <CardTitle title={t('Leads por tipo de empresa y número de tiendas', 'Leads by company type and number of stores')} hint={t(`Leads que llegaron en los últimos ${months} meses. El tipo de empresa y el número de tiendas son campos del lead: también se filtran en Leads.`, `Leads that arrived in the last ${months} months. Company type and number of stores are fields on the lead: you can filter by them in Leads too.`)} />
          {canExport && <ExportLink t={t} href={qs('/reportes/mercado/export', { ...params, que: 'tipos' })} testId="export-types">{t('Exportar CSV', 'Export CSV')}</ExportLink>}
        </div>
        {data.types.length === 0 ? (
          <div className="p-6"><Empty title={t('Sin leads en este periodo', 'No leads in this period')} hint={t('Prueba con más meses.', 'Try more months.')} /></div>
        ) : (
          <Table testId="types-table" label={t('Leads por tipo de empresa', 'Leads by company type')} head={<><th>{t('Embudo de campaña', 'Campaign group')}</th><th>{t('Tipo de empresa', 'Company type')}</th><th>{t('Número de tiendas', 'Number of stores')}</th><th>{t('Leads', 'Leads')}</th><th>{t('Convertidos', 'Converted')}</th></>}>
            {data.types.map((r) => (
              <tr key={`${r.funnel}:${r.account_type}:${r.bucket}`} className="table-row" data-testid="type-row">
                <td>{r.funnel ?? none}</td>
                <td className="font-medium text-strong">{r.type_es ? t(r.type_es, r.type_en ?? r.type_es) : none}</td>
                <td className="whitespace-nowrap">{bucket(r.bucket)}</td>
                <td className="num"><Link href={qs('/leads', { market: market.code, status: 'all', tipo: r.account_type ?? undefined, embudo: r.funnel ?? undefined, from: data.from })} className="underline decoration-line-2 underline-offset-4 hover:decoration-current" data-testid="type-leads">{num(r.leads, locale)}</Link></td>
                <td className="num">{num(r.converted, locale)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card pad={false} data-testid="market-sources">
          <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Leads por origen y canal', 'Leads by source and channel')} hint={t('De dónde llegaron los leads del periodo.', 'Where the leads of the period came from.')} /></div>
          {data.sources.length === 0 ? (
            <div className="p-6"><Empty title={t('Sin leads en este periodo', 'No leads in this period')} /></div>
          ) : (
            <Table label={t('Leads por origen', 'Leads by source')} head={<><th>{t('Origen', 'Source')}</th><th>{t('Canal', 'Channel')}</th><th>{t('Leads', 'Leads')}</th><th>{t('Convertidos', 'Converted')}</th></>}>
              {data.sources.map((r) => (
                <tr key={`${r.source}:${r.funnel}:${r.channel_id}`} className="table-row" data-testid="source-row">
                  <td className="font-medium text-strong">{lab(t, SOURCE[r.source]) || r.source}{r.funnel ? ` · ${r.funnel}` : ''}</td>
                  <td className="[overflow-wrap:anywhere]">{r.channel_id ?? none}</td>
                  <td className="num">{num(r.leads, locale)}</td>
                  <td className="num">{num(r.converted, locale)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card data-testid="market-dead">
          <CardTitle title={t('Leads descartados: base de correo', 'Closed leads: mailing base')} hint={t('Un lead descartado sale de la lista de trabajo y no entra a ningún embudo. Conserva su identidad y su motivo, y sirve como base de correo solo si la persona aceptó recibir correos.', 'A closed lead leaves the work list and enters no pipeline. It keeps its identity and its reason, and it serves as a mailing base only if the person agreed to receive emails.')} />
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="text-[13px] text-muted">{t('Descartados', 'Closed')}</dt><dd className="num text-[22px] font-semibold text-strong" data-testid="dead-total">{num(data.dead.total, locale)}</dd></div>
            <div><dt className="text-[13px] text-muted">{t('Con correo', 'With email')}</dt><dd className="num text-[22px] font-semibold text-strong">{num(data.dead.with_email, locale)}</dd></div>
            <div><dt className="text-[13px] text-muted">{t('Aceptaron correos', 'Agreed to emails')}</dt><dd className="num text-[22px] font-semibold text-brand-text" data-testid="dead-consent">{num(data.dead.with_consent, locale)}</dd></div>
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href={qs('/leads', { market: market.code, status: 'disqualified' })} className="text-[14px] font-medium text-blue-text underline" data-testid="dead-list">{t('Ver los descartados', 'See the closed leads')}</Link>
            {canMail && <ExportLink t={t} href={qs('/reportes/mercado/export', { mercado: market.code, que: 'descartados' })} testId="export-dead">{t('Descargar base de correo (CSV)', 'Download mailing base (CSV)')}</ExportLink>}
          </div>
          {!canMail && <p className="mt-3 text-[13px] text-muted" data-testid="dead-no-export">{t('La descarga lleva correos: la hace quien lidera el mercado o administración.', 'The download carries emails: the market lead or administration does it.')}</p>}
        </Card>
      </div>
    </>
  )
}
