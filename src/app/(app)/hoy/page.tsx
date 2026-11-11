import Link from 'next/link'
import { requireCtx, systemCtx } from '@/server/context'
import { getToday, track } from '@/dal/boards'
import { ensureRulesFresh } from '@/domain/rules'
import { Card, CardTitle, Stat, Badge, Empty, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { ago, day, pct } from '@/lib/format'
import { EXCEPTION, lab } from '@/lib/labels'
import { completeTaskAction } from '@/app/(app)/actividades/actions'

export default async function HoyPage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  await ensureRulesFresh(await systemCtx())
  await track(ctx, 'view.hoy')
  const d = await getToday(ctx)
  const c = d.counts
  const sells = ctx.can('lead.work')
  const first = ctx.user.name.split(' ')[0]

  const exceptionHref = (e: (typeof d.exceptions)[number]) => (e.deal_id ? `/deals/${e.deal_id}` : e.lead_id ? `/leads/${e.lead_id}` : e.account_id ? `/comercios/${e.account_id}` : '/supervisor')

  return (
    <>
      <PageHeader
        eyebrow={day(new Date(), locale, ctx.markets[0]?.timezone)}
        title={t(`Hola, ${first}`, `Hi, ${first}`)}
        desc={
          sells
            ? t('Esto es lo que necesita tu atención hoy, en orden de urgencia.', 'This is what needs your attention today, most urgent first.')
            : t('Un resumen de lo que pasa en tu alcance.', 'A summary of what is happening in your scope.')
        }
      />

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat testId="stat-leads-overdue" label={t('Leads fuera de tiempo', 'Leads past response time')} value={c.leads_overdue} tone={c.leads_overdue ? 'bad' : 'good'} hint={t(`${c.leads_open} abiertos`, `${c.leads_open} open`)} href="/leads?owner=me&status=overdue" />
        <Stat testId="stat-tasks" label={t('Tareas para hoy', 'Tasks due today')} value={c.tasks_due} tone={c.tasks_overdue ? 'warn' : undefined} hint={t(`${c.tasks_overdue} vencidas`, `${c.tasks_overdue} overdue`)} href="/actividades" />
        <Stat testId="stat-revisits" label={t('Revisitas al decisor', 'Decision-maker revisits')} value={c.revisits} tone={c.revisits ? 'warn' : undefined} hint={t(`${c.deals_open} deals abiertos`, `${c.deals_open} open deals`)} href="/pipelines?owner=me" />
        <Stat testId="stat-awaiting" label={t('Esperando primera venta', 'Awaiting first sale')} value={c.deals_awaiting} hint={t('Se ganan cuando S5 reporta la venta', 'Won when S5 reports the sale')} href="/pipelines?owner=me" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
        <Card data-testid="today-attention">
          <CardTitle
            title={t('Necesita tu atención', 'Needs your attention')}
            hint={t('Lo detectan las reglas; desaparece solo cuando lo resuelves.', 'Detected by rules; it clears itself once you resolve it.')}
            right={c.exceptions > d.exceptions.length ? <Badge>{`${d.exceptions.length} / ${c.exceptions}`}</Badge> : undefined}
          />
          {d.exceptions.length === 0 ? (
            <Empty title={t('Nada urgente', 'Nothing urgent')} hint={t('No tienes excepciones abiertas.', 'You have no open exceptions.')} />
          ) : (
            <ul className="-mx-2">
              {d.exceptions.map((e) => (
                <li key={e.id}>
                  <Link href={exceptionHref(e)} className="row-hover flex items-center justify-between gap-4 rounded-2xl px-3 py-3.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-semibold text-strong">{String(e.detail.title ?? e.detail.name ?? '')}</span>
                      <span className="mt-0.5 block text-[13px] text-muted-2">
                        {lab(t, EXCEPTION[e.kind]?.label)} · {ago(e.opened_at, locale)}
                      </span>
                    </span>
                    <Badge tone={e.severity === 'high' ? 'bad' : e.severity === 'medium' ? 'warn' : 'neutral'}>{lab(t, EXCEPTION[e.kind]?.action)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="today-tasks">
          <CardTitle title={t('Tus tareas', 'Your tasks')} right={<Link href="/actividades" className="text-[13px] font-semibold text-blue-text">{t('Ver todas', 'See all')}</Link>} />
          {d.tasks.length === 0 ? (
            <Empty title={t('Sin tareas abiertas', 'No open tasks')} hint={t('Cada deal abierto lleva un próximo paso; aparecerá aquí.', 'Every open deal carries a next step; it will show up here.')} />
          ) : (
            <ul className="-mx-2">
              {d.tasks.map((task) => {
                const late = task.due_at && new Date(task.due_at) < new Date()
                return (
                  <li key={task.id} className="flex items-center justify-between gap-4 rounded-2xl px-3 py-3">
                    <Link href={task.deal_id ? `/deals/${task.deal_id}` : task.account_id ? `/comercios/${task.account_id}` : '/actividades'} className="min-w-0">
                      <span className="block truncate text-[14.5px] font-semibold text-strong">{task.subject}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted-2">
                        {task.account_name ?? '—'} · <span className={late ? 'font-semibold text-red-text' : ''}>{day(task.due_at, locale)}</span>
                      </span>
                    </Link>
                    <ActionForm action={completeTaskAction}>
                      <input type="hidden" name="id" value={task.id} />
                      <Submit variant="ghost" size="sm">{t('Hecha', 'Done')}</Submit>
                    </ActionForm>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card data-testid="today-leads">
          <CardTitle title={t('Leads por atender', 'Leads to work')} right={<Link href="/leads?owner=me&status=open" className="text-[13px] font-semibold text-blue-text">{t('Ver todos', 'See all')}</Link>} />
          {d.leads.length === 0 ? (
            <Empty title={t('Sin leads pendientes', 'No pending leads')} />
          ) : (
            <ul className="-mx-2">
              {d.leads.map((l) => {
                const late = l.status === 'new' && new Date(l.sla_due_at) < new Date()
                return (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="row-hover flex items-center justify-between gap-4 rounded-2xl px-3 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-semibold text-strong">{l.business_name}</span>
                        <span className="mt-0.5 block text-[13px] text-muted-2">{[l.locality, l.market_code].filter(Boolean).join(' · ')}</span>
                      </span>
                      {l.status === 'new' ? (
                        <Badge tone={late ? 'bad' : 'accent'}>{late ? t('Fuera de tiempo', 'Past response time') : t(`Vence ${ago(l.sla_due_at, locale)}`, `Due ${ago(l.sla_due_at, locale)}`)}</Badge>
                      ) : (
                        <Badge tone="info">{t('Contactado', 'Contacted')}</Badge>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card data-testid="today-field">
          <CardTitle title={t('Campo, últimos 7 días', 'Field, last 7 days')} hint={t('Las visitas se registran en la Sales App. Aquí solo se leen.', 'Visits are recorded in the Sales App. They are read-only here.')} />
          <dl className="grid grid-cols-3 gap-4">
            <div><dt className="text-[13px] text-muted">{t('Visitas', 'Visits')}</dt><dd className="display num mt-1 text-[28px] font-bold text-strong">{c.visits_7d}</dd></div>
            <div><dt className="text-[13px] text-muted">{t('Con venta', 'With a sale')}</dt><dd className="display num mt-1 text-[28px] font-bold text-strong">{c.sales_7d}</dd></div>
            <div><dt className="text-[13px] text-muted">{t('Efectividad', 'Effectiveness')}</dt><dd className="display num mt-1 text-[28px] font-bold text-strong">{pct(c.sales_7d, c.visits_7d)}</dd></div>
          </dl>
          {d.revisits.length > 0 && (
            <>
              <p className="eyebrow mt-7 mb-2">{t('Revisitas pendientes', 'Pending revisits')}</p>
              <ul className="-mx-2">
                {d.revisits.map((r) => (
                  <li key={r.id}>
                    <Link href={`/deals/${r.id}`} className="row-hover flex items-center justify-between gap-4 rounded-2xl px-3 py-2.5">
                      <span className="truncate text-[14px] font-medium text-strong">{r.title}</span>
                      <span className="text-[13px] text-muted-2">{day(r.revisit_due, locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
