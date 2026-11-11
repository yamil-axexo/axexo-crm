import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getAccount, parentOptions } from '@/dal/accounts'
import { sellers } from '@/dal/leads'
import { Badge, Card, CardTitle, Field, KeyVal, PageHeader, Stat } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago, day, dayTime, money, num } from '@/lib/format'
import { ACTIVITY, ALIAS_SYSTEM, ATTRIBUTION_LAYER, CONTACT_ROLE, KIND, LIFECYCLE, MOTOR, lab } from '@/lib/labels'
import { addContactAction, reassignAction, setParentAction, updateAccountAction } from '../actions'
import { addActivityAction, completeTaskAction } from '@/app/(app)/actividades/actions'
import { createDealAction } from '@/app/(app)/pipelines/actions'

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getAccount(ctx, id)
  if (!data) notFound()
  const { account: a, ancestors, rollup, children, contacts, aliases, attributions, deals, metrics, tasks, timeline, pipelines } = data
  const market = ctx.market(a.market_code)
  const canEdit = !a.archived_at && ctx.can('account.edit', a.market_code)
  const canReassign = !a.archived_at && ctx.can('account.reassign', a.market_code)
  const canSell = !a.archived_at && ctx.can('deal.create', a.market_code)
  const [people, parents] = canReassign ? await Promise.all([sellers(ctx, a.market_code), parentOptions(ctx, a.market_code)]) : [[], []]
  const isParent = a.kind !== 'store'
  const openDeal = deals.find((d) => d.status === 'open')
  const today = new Date().toISOString().slice(0, 10)

  const visitText = (it: (typeof timeline)[number]) => {
    const m = it.meta as { rejection?: string | null; revisit?: boolean; minutes?: number | null }
    const base = it.title === 'sale' ? t('Visita con venta', 'Visit with a sale') : t('Visita sin venta', 'Visit with no sale')
    return `${base}${m.rejection ? ` · ${m.rejection}` : ''}${m.revisit ? ` · ${t('pide revisita', 'needs a revisit')}` : ''}${m.minutes ? ` · ${m.minutes} min` : ''}`
  }

  return (
    <>
      {ancestors.length > 0 && (
        <nav aria-label={t('Jerarquía', 'Hierarchy')} className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-2" data-testid="breadcrumb">
          {ancestors.map((p) => (
            <span key={p.id} className="flex items-center gap-2"><Link href={`/comercios/${p.id}`} className="font-semibold text-blue-text underline">{p.name}</Link><span aria-hidden>›</span></span>
          ))}
          <span>{a.name}</span>
        </nav>
      )}
      <PageHeader
        eyebrow={`${lab(t, KIND[a.kind])} · ${market.name}${a.segment ? ` · ${lab(t, MOTOR[a.segment])}` : ''}`}
        title={a.name}
        desc={[a.locality, a.region].filter(Boolean).join(', ')}
        actions={
          <>
            <Badge tone={LIFECYCLE[a.lifecycle]?.tone}>{lab(t, LIFECYCLE[a.lifecycle]?.label)}</Badge>
            {a.archived_at && <Badge tone="bad">{t('Archivado (fusionado)', 'Archived (merged)')}</Badge>}
            {canSell && !openDeal && pipelines.length > 0 && (
              <Dialog trigger={t('Nuevo deal', 'New deal')} title={t('Nuevo deal', 'New deal')} variant="primary" testId="new-deal">
                <ActionForm action={createDealAction} className="grid grid-cols-2 gap-4">
                  <input type="hidden" name="account_id" value={a.id} />
                  <Field label="Pipeline" className="col-span-2"><select name="pipeline_id" className="input">{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                  <Field label={t('Título', 'Title')} className="col-span-2"><input name="title" className="input" required defaultValue={`${t('Alta', 'Onboarding')}: ${a.name}`} /></Field>
                  <Field label={t('Próximo paso', 'Next step')} className="col-span-2"><input name="next_step" className="input" required minLength={2} data-testid="new-deal-step" /></Field>
                  <Field label={t('Fecha', 'Date')}><input name="next_step_due" type="date" className="input" required defaultValue={today} /></Field>
                  <Field label={t(`Monto (${market.currency})`, `Amount (${market.currency})`)}><input name="amount" className="input" inputMode="decimal" /></Field>
                  <div className="col-span-2 flex justify-end"><Submit testId="save-deal">{t('Crear deal', 'Create deal')}</Submit></div>
                </ActionForm>
              </Dialog>
            )}
          </>
        }
      />

      {/* UX-01: lo importante arriba. */}
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4" data-testid="account-facts">
        <Stat label={t('Dueño', 'Owner')} value={<span className="text-[22px]">{a.owner_name ?? (ancestors.length ? t('Por su cadena', 'Via its chain') : t('Sin dueño', 'No owner'))}</span>} hint={a.territory ?? undefined} tone={!a.owner_name && !ancestors.length ? 'warn' : undefined} />
        {isParent ? (
          <>
            <Stat testId="rollup-stores" label={t('Tiendas en su red', 'Stores in its network')} value={num(rollup.stores, locale)} hint={t(`${rollup.active} activas · ${rollup.onboarding} en alta · ${rollup.at_risk} en riesgo`, `${rollup.active} active · ${rollup.onboarding} onboarding · ${rollup.at_risk} at risk`)} />
            <Stat label={t('Ventas de la red, 30 días', 'Network sales, 30 days')} value={num(rollup.txn_30d, locale)} hint={rollup.volume_30d ? money(Number(rollup.volume_30d), rollup.currency ?? market.currency, locale, true) : undefined} />
          </>
        ) : (
          <>
            <Stat testId="fact-sales" label={t('Ventas, 30 días', 'Sales, 30 days')} value={metrics ? num(metrics.txn_count_30d, locale) : '—'} hint={metrics ? `${money(Number(metrics.volume_minor_30d), metrics.currency, locale, true)} · ${t(`${metrics.active_days_30d} días activos`, `${metrics.active_days_30d} active days`)}` : t('Todavía no transacciona', 'Not transacting yet')} />
            <Stat label={t('Primera venta', 'First sale')} value={<span className="text-[22px]">{metrics?.first_txn_at ? day(metrics.first_txn_at, locale, market.timezone) : '—'}</span>} hint={metrics?.last_txn_at ? t(`Última: ${ago(metrics.last_txn_at, locale)}`, `Last: ${ago(metrics.last_txn_at, locale)}`) : undefined} />
          </>
        )}
        <Stat label={t('Deal', 'Deal')} value={<span className="text-[22px]">{openDeal ? t(openDeal.stage_es, openDeal.stage_en) : deals[0] ? (deals[0].status === 'won' ? t('Ganado', 'Won') : t('Perdido', 'Lost')) : '—'}</span>} hint={openDeal?.next_step ? `→ ${openDeal.next_step}` : undefined} href={openDeal ? `/deals/${openDeal.id}` : deals[0] ? `/deals/${deals[0].id}` : undefined} tone={openDeal?.revisit_needed ? 'warn' : undefined} />
      </div>
      {metrics && <p className="mt-3 text-[12.5px] text-muted" data-testid="metrics-asof">{t(`Ventas según S5, con corte al ${day(metrics.as_of, locale)}.`, `Sales per S5, as of ${day(metrics.as_of, locale)}.`)}</p>}

      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {isParent && (
            <Card data-testid="account-children">
              <CardTitle title={t('Su red', 'Its network')} hint={t('Los totales de arriba suman todo lo que cuelga de esta cuenta, a cualquier nivel.', 'The totals above add up everything under this account, at any depth.')} />
              {children.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía no tiene cuentas hijas.', 'It has no child accounts yet.')}</p> : (
                <ul className="-mx-2 grid grid-cols-1 gap-x-6 md:grid-cols-2">
                  {children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/comercios/${c.id}`} className="row-hover flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5" data-testid="child-row">
                        <span className="min-w-0"><span className="block truncate text-[14px] font-semibold text-strong">{c.name}</span><span className="text-[12.5px] text-muted-2">{[c.locality, c.txn_count_30d !== null ? t(`${c.txn_count_30d} ventas`, `${c.txn_count_30d} sales`) : null].filter(Boolean).join(' · ')}</span></span>
                        <Badge tone={LIFECYCLE[c.lifecycle]?.tone}>{lab(t, LIFECYCLE[c.lifecycle]?.label)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {tasks.length > 0 && (
            <Card data-testid="account-tasks">
              <CardTitle title={t('Pendientes', 'Open items')} />
              <ul>
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-4 border-t border-line py-3 first:border-t-0">
                    <span><span className="block text-[14px] font-semibold text-strong">{task.subject}</span><span className="text-[12.5px] text-muted-2">{[lab(t, ACTIVITY[task.kind]), task.owner_name, day(task.due_at, locale)].filter(Boolean).join(' · ')}</span></span>
                    {ctx.can('activity.write', a.market_code) && <ActionForm action={completeTaskAction}><input type="hidden" name="id" value={task.id} /><Submit variant="ghost" size="sm">{t('Hecha', 'Done')}</Submit></ActionForm>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card data-testid="account-timeline">
            <CardTitle title="Timeline" hint={t('Notas y llamadas del equipo, visitas que llegan de la Sales App, cambios de etapa y de dueño.', 'Team notes and calls, visits that arrive from the Sales App, stage and owner changes.')} />
            {ctx.can('activity.write', a.market_code) && !a.archived_at && (
              <ActionForm action={addActivityAction} onOk="reset" className="mb-6">
                <input type="hidden" name="account_id" value={a.id} />
                <div className="flex flex-wrap gap-3">
                  <select name="kind" className="input !w-36" aria-label={t('Tipo', 'Type')} data-testid="activity-kind">
                    <option value="note">{lab(t, ACTIVITY.note)}</option><option value="call">{lab(t, ACTIVITY.call)}</option><option value="meeting">{lab(t, ACTIVITY.meeting)}</option><option value="task">{lab(t, ACTIVITY.task)}</option>
                  </select>
                  <input name="subject" className="input !w-auto flex-1" required minLength={2} placeholder={t('¿Qué pasó o qué sigue?', 'What happened or what is next?')} data-testid="activity-subject" />
                  <input name="due_at" type="date" className="input !w-44" aria-label={t('Fecha (para tareas)', 'Date (for tasks)')} data-testid="activity-due" />
                  <Submit variant="ghost" testId="activity-add">{t('Agregar', 'Add')}</Submit>
                </div>
              </ActionForm>
            )}
            {timeline.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía no ha pasado nada con este comercio.', 'Nothing has happened with this merchant yet.')}</p> : (
              <ul className="space-y-4">
                {timeline.map((it, i) => (
                  <li key={i} className={`border-l-2 pl-4 ${it.kind === 'visit' ? 'border-sky/60' : it.kind === 'stage' ? 'border-brand/60' : 'border-line-2'}`} data-testid={`tl-${it.kind}`}>
                    <p className="text-[14px] font-semibold text-strong">
                      {it.kind === 'visit' ? visitText(it) : it.kind === 'stage' ? `${t('Pasó a', 'Moved to')} "${t(it.title, it.body ?? it.title)}"` : it.kind === 'attribution' ? t(`Dueño: ${it.title}`, `Owner: ${it.title}`) : it.title}
                    </p>
                    {it.body && !['stage'].includes(it.kind) && <p className="mt-0.5 text-[13.5px] text-muted-2">{it.body}</p>}
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {lab(t, ACTIVITY[it.kind])} · {it.kind === 'stage' && (it.meta as { cause?: string }).cause === 'transaction' ? t('Primera transacción (S5)', 'First transaction (S5)') : (it.actor ?? '—')} · {dayTime(it.at, locale, market.timezone)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card data-testid="account-contacts">
            <CardTitle
              title={t('Contactos', 'Contacts')}
              right={canEdit ? (
                <Dialog trigger={t('Agregar', 'Add')} title={t('Nuevo contacto', 'New contact')} size="sm" testId="add-contact">
                  <ActionForm action={addContactAction} onOk="close" className="grid grid-cols-2 gap-4">
                    <input type="hidden" name="account_id" value={a.id} />
                    <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="full_name" className="input" required minLength={2} data-testid="contact-name" /></Field>
                    <Field label={t('Rol', 'Role')}><select name="role" className="input" data-testid="contact-role">{Object.entries(CONTACT_ROLE).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                    <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" /></Field>
                    <Field label={t('Correo', 'Email')} className="col-span-2"><input name="email" type="email" className="input" /></Field>
                    <div className="col-span-2 flex justify-end"><Submit testId="save-contact">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                </Dialog>
              ) : undefined}
            />
            <ul className="space-y-3">
              {contacts.map((c) => (
                <li key={c.id} data-testid="contact-row">
                  <p className="text-[14px] font-semibold text-strong">{c.full_name} <span className="ml-1 text-[12.5px] font-medium text-muted-2">{lab(t, CONTACT_ROLE[c.role])}</span></p>
                  <p className="text-[13px] text-muted-2">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</p>
                </li>
              ))}
              {contacts.length === 0 && <li className="text-[14px] text-muted">{t('Sin contactos todavía.', 'No contacts yet.')}</li>}
            </ul>
          </Card>

          <Card data-testid="account-attribution">
            <CardTitle title={t('Atribución', 'Attribution')} hint={t('Tres capas, cada una con fecha. Lo anterior no se borra.', 'Three layers, each one dated. Nothing earlier is erased.')} />
            <ul className="space-y-3">
              {attributions.map((at, i) => (
                <li key={i} className={at.effective_to ? 'opacity-55' : ''}>
                  <p className="text-[13px] text-muted">{lab(t, ATTRIBUTION_LAYER[at.layer])}</p>
                  <p className="text-[14px] font-semibold text-strong">{at.party_label}</p>
                  <p className="text-[12.5px] text-muted-2">{t('desde', 'since')} {day(at.effective_from, locale, market.timezone)}{at.effective_to ? ` ${t('hasta', 'until')} ${day(at.effective_to, locale, market.timezone)}` : ''}</p>
                </li>
              ))}
            </ul>
            {canReassign && (
              <ActionForm action={reassignAction} className="mt-6 border-t border-line pt-5">
                <input type="hidden" name="account_id" value={a.id} />
                <Field label={t('Reasignar dueño', 'Reassign owner')}>
                  <select name="to_user_id" className="input" defaultValue={a.owner_id ?? ''} data-testid="reassign-to">
                    {!a.owner_id && <option value="" disabled>{t('Elige a alguien', 'Pick someone')}</option>}
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </Field>
                <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="reassign-save">{t('Reasignar', 'Reassign')}</Submit></div>
              </ActionForm>
            )}
          </Card>

          <Card data-testid="account-aliases">
            <CardTitle title={t('IDs en otros sistemas', 'IDs in other systems')} hint={t('Este comercio tiene un solo ID en CONTIGO; los demás sistemas se ligan como alias.', 'This merchant has one ID in CONTIGO; other systems link to it as aliases.')} />
            <dl>
              <KeyVal k="CONTIGO"><code className="text-[12.5px]">{a.id.slice(0, 13)}…</code></KeyVal>
              {aliases.map((al, i) => <KeyVal key={i} k={ALIAS_SYSTEM[al.system] ?? al.system}><code className="text-[12.5px]" data-testid="alias-value">{al.external_id}</code></KeyVal>)}
            </dl>
            {aliases.length === 0 && <p className="mt-2 text-[13px] text-muted">{t('Todavía no existe en la Sales App ni en S5.', 'It does not exist in the Sales App or S5 yet.')}</p>}
          </Card>

          {canEdit && (
            <Card>
              <CardTitle title={t('Datos del comercio', 'Merchant details')} />
              <ActionForm action={updateAccountAction} className="space-y-4">
                <input type="hidden" name="id" value={a.id} />
                <Field label={t('Nombre', 'Name')}><input name="name" className="input" defaultValue={a.name} required data-testid="edit-name" /></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" defaultValue={a.phone ?? ''} data-testid="edit-phone" /></Field>
                <Field label={t('Correo', 'Email')}><input name="email" className="input" defaultValue={a.email ?? ''} /></Field>
                <Field label={t('Dirección', 'Address')}><input name="address_line" className="input" defaultValue={a.address_line ?? ''} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t('Ciudad', 'City')}><input name="locality" className="input" defaultValue={a.locality ?? ''} /></Field>
                  <Field label={t('Estado o región', 'State or region')}><input name="region" className="input" defaultValue={a.region ?? ''} /></Field>
                </div>
                <input type="hidden" name="postal_code" value={a.postal_code ?? ''} />
                <div className="flex justify-end"><Submit variant="ghost" testId="edit-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
              {canReassign && (
                <ActionForm action={setParentAction} className="mt-6 border-t border-line pt-5">
                  <input type="hidden" name="id" value={a.id} />
                  <Field label={t('Pertenece a', 'Belongs to')}>
                    <select name="parent_id" className="input" defaultValue={a.parent_id ?? ''} data-testid="parent-select">
                      <option value="">{t('Independiente', 'Independent')}</option>
                      {parents.filter((p) => p.id !== a.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="parent-save">{t('Mover en el árbol', 'Move in the tree')}</Submit></div>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
