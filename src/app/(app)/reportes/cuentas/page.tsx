import Link from 'next/link'
import { getKamBoard, getNodeReport } from '@/dal/reportes'
import { Card, CardTitle, Empty, NoData, Pills } from '@/ui/kit'
import { Def, ReportFilters } from '@/ui/report'
import { DataTable, linkClass } from '@/ui/reportes'
import { KIND, qs } from '@/lib/labels'
import { day, money, num } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/**
 * REP-01: agrupación por nodo del árbol de cuentas (cada cadena, ISO o distribuidor con el agregado de sus hijos) y tablero
 * de cuentas clave: sus cuentas, las etapas largas y los próximos hitos. "Mis cuentas" deja solo lo que lleva la persona o su equipo.
 */
export default async function AccountsReportPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('cuentas', searchParams, 'trimestre')
  const { ctx, period, f, sel, owners, multi } = r
  const { t, locale } = ctx
  // Quien vende entra a "Mis cuentas"; quien dirige ve todas y puede acotar.
  const sellerOnly = !ctx.can('report.view') && !ctx.can('deal.ops')
  const mine = sellerOnly || r.sp.ver === 'mias'
  const level = r.sp.nivel === 'todos' ? 'todos' : undefined
  const extra = { ver: mine ? 'mias' : undefined, nivel: level }
  const [nodes, kam] = await Promise.all([getNodeReport(ctx, period, { ...f, mine, level }), getKamBoard(ctx, { ...f, mine })])
  const base = { ...r.params, ...extra }
  return (
    <>
      <ReportHeader r={r} extra={extra} />
      <ReportFilters t={t} locale={locale} base="/reportes/cuentas" params={base} period={period.first} selects={[sel.market,
        { name: 'nivel', label: t('Nivel', 'Level'), all: t('Solo la cabeza de cada árbol', 'Only the top of each tree'), options: [{ value: 'todos', label: t('Todos los niveles', 'Every level') }] }]} />
      {!sellerOnly && <div className="mb-5"><Pills label={t('Alcance', 'Scope')} current={mine ? 'mias' : ''} items={[{ key: '', href: qs('/reportes/cuentas', { ...base, ver: undefined }), label: t('Todas las cuentas', 'All accounts') }, { key: 'mias', href: qs('/reportes/cuentas', { ...base, ver: 'mias' }), label: t('Mis cuentas', 'My accounts') }]} /></div>}

      <Card pad={false} data-testid="nodes-card">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por cadena, ISO o distribuidor', 'By chain, ISO or distributor')} hint={t('Cada fila suma todas las tiendas que cuelgan de esa cuenta, a cualquier profundidad.', 'Each row adds up every store under that account, at any depth.')} /></div>
        <DataTable testId="nodes-table" label={t('Cuentas con el agregado de sus tiendas', 'Accounts with the roll-up of their stores')}
          empty={<div className="p-7 pt-0"><Empty title={mine ? t('No llevas ninguna cadena ni distribuidor', 'You do not own any chain or distributor') : t('No hay cadenas ni distribuidores con estos filtros', 'No chains or distributors with these filters')} hint={t('Una tienda pasa a colgar de una cadena desde su ficha, en la pestaña Árbol.', 'A store is placed under a chain from its page, on the Tree tab.')} /></div>}
          head={[{ label: t('Cuenta', 'Account') }, { label: t('Quién la lleva', 'Owner') }, { label: t('Tiendas', 'Stores'), num: true }, { label: t('Activas', 'Active'), num: true }, { label: t('En riesgo o inactivas', 'At risk or inactive'), num: true }, { label: t('Negocios abiertos', 'Open deals'), num: true }, { label: t('Ganados en el periodo', 'Won in the period'), num: true }, { label: t('Volumen, 30 días', 'Volume, 30 days'), num: true }]}
          rows={nodes.map((n) => ({ key: n.id, testId: 'node-row', cells: [
            <span key="n" style={{ paddingLeft: level ? Math.min(n.depth, 4) * 14 : 0 }} className="block"><Link href={`/comercios/${n.id}?tab=arbol`} className={`font-semibold ${linkClass}`} data-testid="node-link">{n.name}</Link><span className="block text-[12.5px] text-muted">{KIND[n.kind] ? t(KIND[n.kind]![0], KIND[n.kind]![1]) : n.kind}{multi ? ` · ${n.market_code}` : ''}</span></span>,
            n.owner_name ?? t('Sin asignar', 'No owner'), num(n.stores, locale), num(n.active, locale), num(n.at_risk + n.inactive, locale), num(n.open_deals, locale), num(n.won, locale),
            Number(n.volume) > 0 ? money(Number(n.volume), n.currency, locale, true) : <NoData locale={locale} />,
          ] }))} />
      </Card>
      <Def t={t} k="nodeRollup" named owners={owners} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card pad={false} data-testid="kam-long">
          <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Etapas largas', 'Long stages')} hint={t('Negocios de cadenas y distribuidores que llevan en su etapa más de lo que la etapa permite.', 'Chain and distributor deals that have sat in their stage longer than the stage allows.')} /></div>
          {kam.long.length === 0 ? <div className="p-7 pt-0"><Empty title={t('Ningún negocio lleva de más en su etapa', 'No deal is overdue in its stage')} hint={t('Aquí aparece un negocio cuando pasa los días que su etapa permite sin moverse.', 'A deal shows up here when it passes the days its stage allows without moving.')} /></div> : (
            <ul className="divide-y divide-line border-t border-line">
              {kam.long.map((d) => (
                <li key={d.id} className="px-5 py-3 md:px-7" data-testid="kam-long-row">
                  <Link href={`/deals/${d.id}`} className={`text-[15px] font-semibold text-strong ${linkClass}`}>{d.account_name}</Link>
                  <p className="text-[13.5px] text-muted-2">{t(d.stage_es, d.stage_en)} · {t(`${d.days} días (la etapa permite ${d.rot_days})`, `${d.days} days (the stage allows ${d.rot_days})`)}{d.owner_name ? ` · ${d.owner_name}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card pad={false} data-testid="kam-milestones">
          <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Próximos hitos', 'Upcoming milestones')} hint={t('Próximos pasos con fecha en los siguientes 30 días.', 'Dated next steps in the next 30 days.')} /></div>
          {kam.milestones.length === 0 ? <div className="p-7 pt-0"><Empty title={t('Sin hitos en los próximos 30 días', 'No milestones in the next 30 days')} hint={t('Ponle próximo paso con fecha a cada negocio abierto y aparece aquí.', 'Give each open deal a dated next step and it shows up here.')} /></div> : (
            <ul className="divide-y divide-line border-t border-line">
              {kam.milestones.map((d) => (
                <li key={d.id} className="px-5 py-3 md:px-7" data-testid="kam-milestone-row">
                  <Link href={`/deals/${d.id}`} className={`text-[15px] font-semibold text-strong ${linkClass}`}>{d.account_name}</Link>
                  <p className="text-[13.5px] text-muted-2"><span className="num font-semibold text-strong">{day(d.next_step_due, locale)}</span> · {d.next_step ?? t('Próximo paso sin texto', 'Next step with no text')}{d.owner_name ? ` · ${d.owner_name}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Def t={t} k="longStage" named owners={owners} />
      {exportNote(r)}
    </>
  )
}
