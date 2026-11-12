import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx, systemCtx } from '@/server/context'
import { getBookSources, getSupervisorBoard } from '@/dal/boards'
import { sellers } from '@/dal/leads'
import { ensureRulesFresh, EXCEPTION_KINDS } from '@/domain/rules'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago, pct } from '@/lib/format'
import { EXCEPTION, lab, qs } from '@/lib/labels'
import { resolveExceptionAction, runRulesAction } from './actions'
import { reassignAction } from '@/app/(app)/comercios/actions'
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
  const people = canReassign ? await sellers(ctx, sp.market) : []
  const book = canReassign ? await getBookSources(ctx) : { owners: [], regions: [] }
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
            hint={t('Leads de los últimos 14 días. Primer intento a tiempo: se intentó el contacto dentro del plazo. Contacto logrado: se habló con la persona. Visitas: últimos 7 días, desde la Sales App.', 'Leads from the last 14 days. First attempt on time: contact was attempted within the deadline. Reached: the person was spoken to. Visits: last 7 days, from the Sales App.')}
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
                <td className="num">{r.visits_7d} / {r.sales_7d} <span className="text-muted">({pct(r.sales_7d, r.visits_7d)})</span></td>
                <td className="num"><Link href={qs('/comercios', { owner: r.id, market: r.market_code })} className="text-blue-text underline">{r.accounts}</Link></td>
              </tr>
            ))}
          </Table>
        )}
        {canReassign && book.owners.length > 0 && (
          <div className="border-t border-line px-7 py-5">
            <Dialog trigger={t('Reasignar una cartera completa', 'Reassign a whole book')} title={t('Reasignar cartera', 'Reassign book')} size="sm" testId="reassign-book">
              <ActionForm action={reassignAction} onOk="close" className="space-y-4">
                <p className="text-[13.5px] text-muted-2">{t('Mueve los comercios de una persona a otra, con sus negocios y tareas abiertas, de 500 en 500. La atribución anterior queda con fecha de cierre.', 'Moves one person’s merchants to another, with their open deals and tasks, 500 at a time. The previous attribution is closed with a date.')}</p>
                <Field label={t('De', 'From')} hint={t('Incluye cuentas de servicio y personas que ya no están.', 'Includes service accounts and people who have left.')}><select name="from_user_id" className="input" required data-testid="book-from">{book.owners.map((o) => <option key={`${o.id}${o.market_code}`} value={`${o.id}|${o.market_code}`}>{o.full_name}{o.is_active ? '' : t(' (inactiva)', ' (inactive)')} · {o.market_code} ({o.accounts})</option>)}</select></Field>
                {book.regions.length > 0 && <Field label={t('Solo esta región', 'Only this region')} hint={t('Opcional. Tiene que ser del mismo mercado.', 'Optional. It must be in the same market.')}><select name="region" className="input" data-testid="book-region"><option value="">{t('Todas las regiones', 'All regions')}</option>{book.regions.map((r) => <option key={`${r.market_code}${r.region}`} value={`${r.market_code}|${r.region}`}>{r.market_code} · {r.region} ({r.accounts})</option>)}</select></Field>}
                <Field label={t('A', 'To')}><select name="to_user_id" className="input" data-testid="book-to">{people.map((p) => <option key={`${p.id}${p.market_code}`} value={p.id}>{p.full_name} · {p.market_code}</option>)}</select></Field>
                <div className="flex justify-end"><Submit testId="book-save">{t('Reasignar', 'Reassign')}</Submit></div>
              </ActionForm>
            </Dialog>
          </div>
        )}
      </Card>

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
                  <ActionForm action={resolveExceptionAction}>
                    <input type="hidden" name="id" value={e.id} /><input type="hidden" name="note" value="dismissed from queue" />
                    <Submit variant="quiet" size="sm" testId="exception-dismiss">{t('Descartar', 'Dismiss')}</Submit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
