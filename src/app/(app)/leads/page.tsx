import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { listLeads } from '@/dal/leads'
import { track } from '@/dal/boards'
import { Badge, Card, Empty, Field, PageHeader, Pills, Table, LinkButton } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago } from '@/lib/format'
import { LEAD_STATUS, MOTOR, SOURCE, lab, qs } from '@/lib/labels'
import { createLeadAction } from './actions'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ market?: string; status?: string; owner?: string; q?: string; before?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const sp = await searchParams
  const status = sp.status ?? 'open'
  const data = await listLeads(ctx, { ...sp, status: status === 'all' ? undefined : status })
  await track(ctx, 'view.leads')
  const live = ctx.markets.filter((m) => m.status === 'live')
  const link = (patch: Record<string, string | undefined>) => qs('/leads', { market: sp.market, status, owner: sp.owner, q: sp.q, ...patch, before: undefined })
  const now = new Date()

  return (
    <>
      <PageHeader
        title="Leads"
        desc={t('Todo lead entra con dueño y tiempo de respuesta. Los de formulario se reparten solos por turno.', 'Every lead comes in with an owner and a response time. Form leads are distributed in rotation.')}
        actions={
          ctx.can('lead.create') ? (
            <Dialog trigger={t('Nuevo lead', 'New lead')} title={t('Nuevo lead', 'New lead')} variant="primary" testId="new-lead">
              <ActionForm action={createLeadAction} className="grid grid-cols-2 gap-4">
                <Field label={t('Mercado', 'Market')}>
                  <select name="market" className="input" defaultValue={live[0]?.code}>
                    {live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </select>
                </Field>
                <Field label={t('Tipo de negocio', 'Business type')}>
                  <select name="motor" className="input">
                    {Object.entries(MOTOR).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}
                  </select>
                </Field>
                <Field label={t('Nombre del negocio', 'Business name')} className="col-span-2"><input name="business_name" className="input" required minLength={2} /></Field>
                <Field label={t('Persona de contacto', 'Contact person')}><input name="contact_name" className="input" required minLength={2} /></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" /></Field>
                <Field label={t('Correo', 'Email')}><input name="email" type="email" className="input" /></Field>
                <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
                <div className="col-span-2 mt-2 flex justify-end"><Submit testId="save-lead">{t('Guardar lead', 'Save lead')}</Submit></div>
              </ActionForm>
            </Dialog>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Pills
          label={t('Estado', 'Status')}
          current={status}
          items={[
            { key: 'open', href: link({ status: 'open' }), label: t('Abiertos', 'Open'), count: data.counts.open ?? 0 },
            { key: 'overdue', href: link({ status: 'overdue' }), label: t('Fuera de tiempo', 'Past response time'), count: data.counts.overdue ?? 0 },
            { key: 'new', href: link({ status: 'new' }), label: t('Nuevos', 'New'), count: data.counts.new ?? 0 },
            { key: 'qualified', href: link({ status: 'qualified' }), label: t('Calificados', 'Qualified'), count: data.counts.qualified ?? 0 },
            { key: 'converted', href: link({ status: 'converted' }), label: t('Convertidos', 'Converted'), count: data.counts.converted ?? 0 },
            { key: 'all', href: link({ status: 'all' }), label: t('Todos', 'All') },
          ]}
        />
        <div className="flex gap-2">
          <Pills
            label={t('Dueño', 'Owner')}
            current={sp.owner ?? ''}
            items={[
              { key: '', href: link({ owner: undefined }), label: t('De todos', 'Everyone') },
              { key: 'me', href: link({ owner: 'me' }), label: t('Míos', 'Mine') },
            ]}
          />
        </div>
      </div>

      <Card className="mt-6" pad={false}>
        {data.items.length === 0 ? (
          <div className="p-7"><Empty title={t('Sin leads en esta vista', 'No leads in this view')} hint={t('Prueba otro filtro o captura uno nuevo.', 'Try another filter or add a new one.')} /></div>
        ) : (
          <Table
            testId="lead-table"
            head={<><th>{t('Negocio', 'Business')}</th><th>{t('Origen', 'Source')}</th><th>{t('Dueño', 'Owner')}</th><th>{t('Estado', 'Status')}</th><th>{t('Respuesta', 'Response')}</th></>}
          >
            {data.items.map((l) => {
              const late = l.status === 'new' && new Date(l.sla_due_at) < now
              return (
                <tr key={l.id} className="table-row row-hover" data-testid="lead-row">
                  <td>
                    <Link href={`/leads/${l.id}`} className="block">
                      <span className="block font-semibold text-strong">{l.business_name}</span>
                      <span className="text-[13px] text-muted-2">{[l.contact_name, l.locality, l.market_code].filter(Boolean).join(' · ')}</span>
                    </Link>
                  </td>
                  <td><span className="text-[13.5px]">{lab(t, SOURCE[l.source])}</span><span className="block text-[12.5px] text-muted">{lab(t, MOTOR[l.motor])}</span></td>
                  <td>{l.owner_name ?? <Badge tone="warn">{t('Sin dueño', 'No owner')}</Badge>}</td>
                  <td>
                    <Badge tone={LEAD_STATUS[l.status]?.tone}>{lab(t, LEAD_STATUS[l.status]?.label)}</Badge>
                    {l.duplicate_of && <span className="ml-2"><Badge tone="warn">{t('Posible duplicado', 'Possible duplicate')}</Badge></span>}
                  </td>
                  <td className="text-[13.5px]">
                    {l.status === 'new' ? (
                      <span className={late ? 'font-semibold text-red-text' : 'text-muted-2'}>{late ? t(`Venció ${ago(l.sla_due_at, locale)}`, `Was due ${ago(l.sla_due_at, locale)}`) : t(`Vence ${ago(l.sla_due_at, locale)}`, `Due ${ago(l.sla_due_at, locale)}`)}</span>
                    ) : l.first_touch_at ? (
                      <span className="text-muted-2">{new Date(l.first_touch_at) <= new Date(l.sla_due_at) ? t('A tiempo', 'On time') : t('Tarde', 'Late')}</span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>
      {data.next && <div className="mt-6 flex justify-center"><LinkButton href={qs('/leads', { market: sp.market, status, owner: sp.owner, q: sp.q, before: data.next })} testId="more">{t('Ver más', 'Load more')}</LinkButton></div>}
    </>
  )
}
