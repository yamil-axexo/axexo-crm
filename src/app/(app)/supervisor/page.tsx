import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx, systemCtx } from '@/server/context'
import { getSupervisorBoard } from '@/dal/boards'
import { getRepartoSources } from '@/dal/reparto'
import { ensureRulesFresh, EXCEPTION_KINDS } from '@/domain/rules'
import { Badge, Card, CardTitle, Empty, LinkButton, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { RepartoForm } from '@/ui/reparto'
import { ago, pct } from '@/lib/format'
import { holderName, holdsText } from '@/lib/reparto-text'
import { EXCEPTION, lab, qs } from '@/lib/labels'
import { runRulesAction } from './actions'
import { dismissExceptionAction } from '@/app/(app)/actividades/log-actions'
import { ConfirmButton } from '@/ui/confirm'
import { repartoPreviewAction, repartoStepAction } from '@/app/(app)/reparto-actions'
import { flat } from '@/server/params'

export default async function SupervisorPage({ searchParams }: { searchParams: Promise<{ market?: string; kind?: string; owner?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('board.supervisor')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  await ensureRulesFresh(await systemCtx())
  const board = await getSupervisorBoard(ctx, sp)
  const live = ctx.markets.filter((m) => m.status === 'live')
  const canReassign = ctx.can('account.reassign', sp.market)
  const sources = canReassign ? await getRepartoSources(ctx) : null
  // Lo que nadie atiende: sin dueño, o a nombre de una cuenta de servicio o de alguien que ya no vende ni opera en ese mercado.
  const vacant = (sources?.holders ?? []).filter((h) => !h.current && (!sp.market || h.market_code === sp.market) && h.accounts + h.deals + h.leads > 0)
  const totalOpen = Object.values(board.byKind).reduce((a, b) => a + b, 0)
  const link = (patch: Record<string, string | undefined>) => qs('/supervisor', { market: sp.market, kind: sp.kind, owner: sp.owner, ...patch })
  const href = (e: (typeof board.queue)[number]) => (e.deal_id ? `/deals/${e.deal_id}` : e.lead_id ? `/leads/${e.lead_id}` : e.account_id ? `/comercios/${e.account_id}` : '/admin?tab=integraciones')

  return (
    <>
      <PageHeader
        title={t('Supervisión', 'Supervision')}
        desc={t('El equipo de un vistazo y la cola de lo que se salió de la regla. Nadie captura nada extra para alimentar esta pantalla.', 'The team at a glance and the queue of what broke a rule. Nobody enters anything extra to feed this screen.')}
        actions={ctx.can('rules.run') ? <ActionForm action={runRulesAction}><Submit variant="ghost" testId="run-rules">{t('Evaluar reglas ahora', 'Evaluate rules now')}</Submit></ActionForm> : undefined}
      />
      {live.length > 1 && (
        <div className="mb-6">
          <Pills label={t('Mercado', 'Market')} current={sp.market ?? ''} items={[{ key: '', href: link({ market: undefined }), label: t('Todos', 'All') }, ...live.map((m) => ({ key: m.code, href: link({ market: m.code }), label: m.name }))]} />
        </div>
      )}

      <Card pad={false} data-testid="team-board">
        <div className="px-7 pt-7">
          <CardTitle
            title={t('Equipo', 'Team')}
            hint={t('Leads de los últimos 14 días. Primer intento a tiempo: se intentó el contacto dentro del plazo. Contacto logrado: se habló con la persona. Visitas: últimos 7 días, las registradas en CONTIGO y las que lleguen de la Sales App, sin contar dos veces la misma.', 'Leads from the last 14 days. First attempt on time: contact was attempted within the deadline. Reached: the person was spoken to. Visits: last 7 days, the ones logged in CONTIGO and the ones that arrive from the Sales App, never counting the same one twice.')}
          />
        </div>
        {board.reps.length === 0 ? <div className="p-7"><Empty title={t('Sin vendedores en tu alcance', 'No sales reps in your scope')} /></div> : (
          <Table testId="rep-table" head={<><th>{t('Vendedor', 'Rep')}</th><th>{t('Leads abiertos', 'Open leads')}</th><th>{t('Primer intento a tiempo', 'First attempt on time')}</th><th>{t('Contacto logrado', 'Reached')}</th><th>{t('Negocios abiertos', 'Open deals')}</th><th>{t('Sin próximo paso', 'No next step')}</th><th>{t('Revisitas', 'Revisits')}</th><th>{t('Esperando venta', 'Awaiting sale')}</th><th>{t('Visitas / con venta', 'Visits / with sale')}</th><th>{t('Cartera', 'Book')}</th></>}>
            {board.reps.map((r) => (
              <tr key={`${r.id}-${r.market_code}`} className="table-row" data-testid="rep-row">
                <td><span className="block font-semibold text-strong">{r.full_name}</span><span className="text-[12.5px] text-muted-2">{[r.team, r.market_code].filter(Boolean).join(' · ')}</span></td>
                <td className="num">{r.leads_open}{r.leads_overdue > 0 && <span className="ml-2"><Badge tone="bad">{t(`${r.leads_overdue} tarde`, `${r.leads_overdue} late`)}</Badge></span>}</td>
                <td className="num" data-testid="rep-attempt">{pct(r.sla_met, r.sla_judged)}</td>
                <td className="num" data-testid="rep-reached">{pct(r.reached, r.sla_judged)}</td>
                <td className="num">{r.deals_open}{r.stalled > 0 && <span className="ml-2"><Badge tone="warn">{t(`${r.stalled} estancados`, `${r.stalled} stalled`)}</Badge></span>}</td>
                <td className="num">{r.no_next_step > 0 ? <Badge tone="bad">{r.no_next_step}</Badge> : 0}</td>
                <td className="num">{r.revisits > 0 ? <Badge tone="warn">{r.revisits}</Badge> : 0}</td>
                <td className="num">{r.awaiting}</td>
                <td className="num" data-testid="rep-visits">{r.visits_7d} / {r.sales_7d} <span className="text-muted">({pct(r.sales_7d, r.visits_7d)})</span></td>
                <td className="num"><Link href={qs('/comercios', { owner: r.id, market: r.market_code })} className="text-blue-text underline">{r.accounts}</Link></td>
              </tr>
            ))}
          </Table>
        )}
        {sources && sources.markets.length > 0 && (
          <div className="border-t border-line px-7 py-5">
            <Dialog trigger={t('Reasignar cartera', 'Reassign book')} title={t('Reasignar cartera', 'Reassign book')} testId="reassign-book">
              <RepartoForm locale={locale} markets={sp.market ? sources.markets.filter((m) => m.code === sp.market) : sources.markets} holders={sources.holders} regions={sources.regions} territories={sources.territories} people={sources.people} actions={{ preview: repartoPreviewAction, step: repartoStepAction }} />
            </Dialog>
          </div>
        )}
      </Card>

      {vacant.length > 0 && (
        <Card className="mt-8" data-testid="vacant-block">
          <CardTitle
            title={t('Sin dueño vigente', 'No current owner')}
            hint={t('Lo que nadie atiende hoy: no tiene dueño, o está a nombre de una cuenta de servicio o de alguien que ya no vende ni opera en este mercado. Repártelo por dueño, región, ciudad o territorio.', 'What nobody is working today: it has no owner, or it sits under a service account or someone who no longer sells or runs operations in this market. Distribute it by owner, region, city or territory.')}
          />
          <ul>
            {vacant.slice(0, 20).map((h) => (
              <li key={`${h.owner_id}${h.market_code}`} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0" data-testid="vacant-row">
                <div className="min-w-0 flex-1 basis-[260px]">
                  <p className="text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{holderName(t, h)}{live.length > 1 ? ` · ${h.market_code}` : ''}</p>
                  <p className="mt-0.5 text-[14px] text-muted-2" data-testid="vacant-holds">{holdsText(t, locale, h)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {h.leads > 0 && <LinkButton href={qs('/leads', { owner: h.owner_id ?? 'none', market: h.market_code, status: 'open' })} variant="quiet" testId="vacant-leads">{t('Ver sus leads', 'See the leads')}</LinkButton>}
                  {h.accounts > 0 && <LinkButton href={qs('/comercios', { owner: h.owner_id ?? 'none', market: h.market_code, repartir: '1' })} testId="vacant-go">{t('Repartir comercios', 'Distribute merchants')}</LinkButton>}
                </div>
              </li>
            ))}
          </ul>
          {vacant.length > 20 && <p className="mt-3 text-[13px] text-muted">{t(`Y ${vacant.length - 20} más. Usa "Reasignar cartera" para verlos todos.`, `And ${vacant.length - 20} more. Use "Reassign book" to see them all.`)}</p>}
          <p className="mt-4 border-t border-line pt-4 text-[13px] text-muted">{t('Los leads y los negocios que no se van con un comercio se pasan desde "Reasignar cartera", arriba.', 'Leads and deals that do not move with a merchant are passed from "Reassign book", above.')}</p>
        </Card>
      )}

      <Card className="mt-8" data-testid="exception-queue">
        <CardTitle
          title={t('Cola de excepciones', 'Exception queue')}
          hint={board.rulesAt ? t(`Reglas evaluadas ${ago(board.rulesAt, locale)}. Una excepción se cierra sola cuando se corrige.`, `Rules evaluated ${ago(board.rulesAt, locale)}. An exception closes itself once it is fixed.`) : undefined}
          right={<Badge tone={totalOpen ? 'warn' : 'good'}>{t(`${totalOpen} abiertas`, `${totalOpen} open`)}</Badge>}
        />
        <Pills
          label={t('Tipo', 'Type')}
          current={sp.kind ?? ''}
          items={[
            { key: '', href: link({ kind: undefined }), label: t('Todas', 'All'), count: totalOpen },
            ...EXCEPTION_KINDS.filter((k) => board.byKind[k]).map((k) => ({ key: k, href: link({ kind: k }), label: lab(t, EXCEPTION[k]?.label), count: board.byKind[k] })),
          ]}
        />
        {board.queue.length === 0 ? <div className="mt-6"><Empty title={t('Nada fuera de regla', 'Nothing off-rule')} /></div> : (
          <ul className="mt-5">
            {board.queue.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line py-3.5 first:border-t-0" data-testid="exception-row">
                <Link href={href(e)} className="min-w-0 flex-1 basis-[240px]">
                  <span className="block truncate text-[14.5px] font-semibold text-strong">{String(e.detail.title ?? e.detail.name ?? e.detail.customer_id ?? '')}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-2">{[lab(t, EXCEPTION[e.kind]?.label), e.owner_name ?? t('Sin dueño', 'No owner'), e.market_code, ago(e.opened_at, locale)].join(' · ')}</span>
                </Link>
                <Badge tone={e.severity === 'high' ? 'bad' : e.severity === 'medium' ? 'warn' : 'neutral'}>{lab(t, EXCEPTION[e.kind]?.action)}</Badge>
                {ctx.can('exception.resolve', e.market_code) && (
                  <ConfirmButton
                    action={dismissExceptionAction}
                    fields={{ id: e.id }}
                    label={t('Descartar', 'Dismiss')}
                    title={t('¿Descartar este pendiente?', 'Dismiss this item?')}
                    body={t(`"${String(e.detail.title ?? e.detail.name ?? lab(t, EXCEPTION[e.kind]?.label))}" sale de la lista del equipo y no vuelve en 7 días, aunque siga sin corregirse. Queda registrado quién lo descartó.`, `"${String(e.detail.title ?? e.detail.name ?? lab(t, EXCEPTION[e.kind]?.label))}" leaves the team list and does not come back for 7 days, even if it is still not fixed. Who dismissed it stays on record.`)}
                    note={{ name: 'note', label: t('Motivo (opcional)', 'Reason (optional)') }}
                    confirm={t('Sí, descartar', 'Yes, dismiss')}
                    cancel={t('Cancelar', 'Cancel')}
                    variant="quiet"
                    testId="exception-dismiss"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
