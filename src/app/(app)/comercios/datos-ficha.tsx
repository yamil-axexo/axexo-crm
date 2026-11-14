import Link from 'next/link'
import type { Ctx } from '@/server/context'
import type { accountIdentity, NodeTotals } from '@/dal/datos'
import { PRODUCT_STATUSES } from '@/domain/gobierno'
import { Badge, Field, KeyVal, NoData, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CopyButton } from '@/ui/confirm'
import { ago, day, isoDay, money, num } from '@/lib/format'
import { CONTACT_ROLE, lab } from '@/lib/labels'
import { PRODUCT_STATUS, PRODUCT_TONE, SURVIVOR_LABEL, contactRolesFor } from '@/lib/datos-labels'
import { addAliasAction, closeAliasAction, endContactAction, setAccountProductAction, setProcessStatusAction, undoMergeAction, updateContactAction } from '@/app/(app)/datos/actions'

// Secciones de la ficha que agrega el paquete datos: totales del nodo y movimientos en el árbol (DAT-01), edición, baja e
// historia de contactos (DAT-02), ID de otros sistemas con alta y cierre (DAT-03), fusiones (DAT-04), productos (DAT-07)
// y listas de proceso del mercado (DAT-05).

type Identity = Awaited<ReturnType<typeof accountIdentity>>
const section = 'border-t border-line pt-6'
const h3 = 'text-[15px] leading-6 font-semibold'

/** DAT-01: lo que suma este nodo con todo lo que cuelga de él. */
export function TreeTotals({ ctx, totals, moves, tz, accountId, asOf = null }: { ctx: Ctx; totals: NodeTotals | null; moves: Identity['moves']; tz: string; accountId?: string; asOf?: string | null }) {
  const { t, locale } = ctx
  const cell = 'rounded-[12px] border border-line bg-surface px-3 py-2.5'
  return (
    <div className="mb-5 space-y-4" data-testid="tree-totals">
      {totals && accountId && (
        <form method="get" action={`/comercios/${accountId}`} className="flex flex-wrap items-end gap-2" data-testid="tree-asof">
          <input type="hidden" name="tab" value="arbol" />
          <label className="text-[13px] text-muted">{t('Ver cómo estaba el día', 'See how it stood on')}
            <input type="date" name="al" defaultValue={asOf ?? ''} max={isoDay(new Date(), tz)} className="input mt-1 !w-auto" data-testid="tree-asof-date" /></label>
          <button type="submit" className="press inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[13px] font-medium text-strong" data-testid="tree-asof-go">{t('Ver', 'Show')}</button>
          {asOf && <a href={`/comercios/${accountId}?tab=arbol`} className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-text underline">{t('Volver a hoy', 'Back to today')}</a>}
        </form>
      )}
      {totals && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className={cell}><dt className="text-[13px] text-muted">{t('Negocios abiertos', 'Open deals')}</dt><dd className="num text-[18px] font-semibold text-strong" data-testid="node-open">{num(totals.open_deals, locale)}</dd>
          {totals.open_amount && Number(totals.open_amount) > 0 && <dd className="text-[13px] text-muted-2">{money(Number(totals.open_amount), totals.currency ?? 'USD', locale, true)}</dd>}</div>
        <div className={cell}><dt className="text-[13px] text-muted">{t('Negocios ganados', 'Deals won')}</dt><dd className="num text-[18px] font-semibold text-strong" data-testid="node-won">{num(totals.won_deals, locale)}</dd></div>
        <div className={cell}><dt className="text-[13px] text-muted">{t('Comercios activos', 'Active merchants')}</dt><dd className="num text-[18px] font-semibold text-strong" data-testid="node-active">{totals.active === null ? <NoData locale={locale} /> : num(totals.active, locale)}</dd><dd className="text-[13px] text-muted-2">{t(`de ${num(totals.accounts, locale)} cuentas`, `of ${num(totals.accounts, locale)} accounts`)}</dd></div>
        <div className={cell}><dt className="text-[13px] text-muted">{t('Ventas en 30 días', 'Sales in 30 days')}</dt><dd className="num text-[18px] font-semibold text-strong" data-testid="node-sales">{num(totals.txn_30d, locale)}</dd></div>
        <div className={cell}><dt className="text-[13px] text-muted">{t('Comisión en 30 días', 'Commission in 30 days')}</dt><dd className="num text-[18px] font-semibold text-strong" data-testid="node-commission">{totals.commission_30d === null ? <NoData locale={locale} /> : money(Number(totals.commission_30d), totals.currency ?? 'USD', locale, true)}</dd></div>
      </dl>}
      {totals && <p className="text-[13px] text-muted" data-testid="tree-totals-note">{asOf
        ? t(`Así estaba el ${day(asOf, locale)}: el árbol de ese día y el último corte de ventas hasta esa fecha. La etapa de cada comercio ese día no se guarda.`, `How it stood on ${day(asOf, locale)}: that day's tree and the latest sales cut up to that date. Each merchant's stage on that day is not stored.`)
        : t('Suma esta cuenta y todo lo que cuelga de ella, hasta donde tú la ves. La comisión llega por la conexión de señales; sin ella, queda sin dato.', 'Adds up this account and everything under it, as far as you can see it. Commission arrives through the signals connection; without it, there is no figure.')}</p>}
      {moves.length > 0 && (
        <details className="rounded-[12px] border border-line px-4 py-3" data-testid="tree-moves">
          <summary className="cursor-pointer text-[14px] font-medium text-strong">{t('Movimientos en el árbol', 'Moves in the tree')} ({moves.length})</summary>
          <ul className="mt-3 space-y-3">
            {moves.map((mv, i) => (
              <li key={i} className={mv.valid_to ? 'text-muted-2' : undefined} data-testid="tree-move">
                <p className="text-[14px] font-medium">{t('Bajo', 'Under')} {mv.parent_name}</p>
                <p className="text-[13px] text-muted-2">{t('desde', 'since')} {day(mv.valid_from, locale, tz)}{mv.valid_to ? ` ${t('hasta', 'until')} ${day(mv.valid_to, locale, tz)}` : ''}{mv.by_name ? ` · ${mv.by_name}` : ''}</p>
                {mv.reason && <p className="text-[13px] text-muted-2" data-testid="tree-move-reason">{t('Motivo', 'Reason')}: {mv.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

type Contact = { id: string; full_name: string; role: string; phone: string | null; email: string | null; is_primary: boolean; preferred_locale: string | null; sms_capable: boolean | null }

/** DAT-02: corregir y dar de baja a un contacto desde su renglón, y en qué otras cuentas está. */
export function ContactTools({ ctx, accountId, segment, contact, others, canEdit }: { ctx: Ctx; accountId: string; segment: string | null; contact: Contact; others: { id: string; name: string }[]; canEdit: boolean }) {
  const { t } = ctx
  const roles = contactRolesFor(segment, Object.keys(CONTACT_ROLE))
  return (
    <>
      {others.length > 0 && (
        <p className="text-[13px] text-muted-2" data-testid="contact-also">{t('También está en', 'Also on')}: {others.map((o, i) => <span key={o.id}>{i > 0 ? ', ' : ''}<Link href={`/comercios/${o.id}?tab=datos`} className="font-medium text-blue-text underline">{o.name}</Link></span>)}</p>
      )}
      {canEdit && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Dialog trigger={t('Editar', 'Edit')} title={t(`Editar a ${contact.full_name}`, `Edit ${contact.full_name}`)} size="sm" variant="quiet" testId="contact-edit">
            <ActionForm action={updateContactAction} onOk="close" className="grid grid-cols-2 gap-4">
              <input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="contact_id" value={contact.id} />
              <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="full_name" className="input" required minLength={2} defaultValue={contact.full_name} data-testid="contact-edit-name" /></Field>
              <Field label={t('Rol en esta cuenta', 'Role on this account')}><select name="role" className="input" defaultValue={contact.role} data-testid="contact-edit-role">{[...new Set([contact.role, ...roles])].map((k) => <option key={k} value={k}>{lab(t, CONTACT_ROLE[k], k)}</option>)}</select></Field>
              <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" defaultValue={contact.phone ?? ''} data-testid="contact-edit-phone" /></Field>
              <Field label={t('Correo', 'Email')} className="col-span-2"><input name="email" type="email" className="input" defaultValue={contact.email ?? ''} /></Field>
              <Field label={t('Idioma preferido', 'Preferred language')} className="col-span-2 sm:col-span-1"><select name="locale" className="input" defaultValue={contact.preferred_locale ?? ''}><option value="">{t('Sin dato', 'Not set')}</option><option value="es">{t('Español', 'Spanish')}</option><option value="en">{t('Inglés', 'English')}</option></select></Field>
              <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="sms" className="h-5 w-5 shrink-0" defaultChecked={!!contact.sms_capable} />{t('Su teléfono es un móvil que recibe SMS', 'Their phone is a mobile that gets SMS')}</label>
              {others.length > 0 && <p className="col-span-2 text-[13px] text-muted">{t('Nombre, teléfono y correo cambian en todas las cuentas donde está esta persona. El rol, solo en esta.', 'Name, phone and email change on every account this person is on. The role, only on this one.')}</p>}
              <div className="col-span-2 flex justify-end"><Submit testId="contact-edit-save">{t('Guardar', 'Save')}</Submit></div>
            </ActionForm>
          </Dialog>
          <Dialog trigger={t('Dar de baja', 'Remove')} title={t(`Dar de baja a ${contact.full_name}`, `Remove ${contact.full_name}`)} size="sm" variant="quiet" testId="contact-end">
            <ActionForm action={endContactAction} onOk="close" className="space-y-4">
              <input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="contact_id" value={contact.id} />
              <p className="text-[14px] text-muted-2">{t('Deja de ser contacto de esta cuenta desde hoy. No se borra: queda en la historia con su fecha.', 'They stop being a contact of this account as of today. Nothing is erased: it stays in the history with its date.')}</p>
              <Field label={t('¿Por qué?', 'Why?')}><input name="reason" className="input" required minLength={3} maxLength={300} placeholder={t('Ya no trabaja ahí', 'No longer works there')} data-testid="contact-end-reason" /></Field>
              <div className="flex justify-end"><Submit variant="danger" testId="contact-end-save">{t('Dar de baja', 'Remove')}</Submit></div>
            </ActionForm>
          </Dialog>
        </div>
      )}
    </>
  )
}

/** DAT-02: quién fue el contacto principal y quién dejó de ser contacto, con fechas. */
export function ContactHistory({ ctx, identity, tz }: { ctx: Ctx; identity: Identity; tz: string }) {
  const { t, locale } = ctx
  const turns = identity.primaries
  if (turns.length <= 1 && identity.past.length === 0) return null
  return (
    <details className="mt-4 rounded-[12px] border border-line px-4 py-3" data-testid="contact-history">
      <summary className="cursor-pointer text-[14px] font-medium text-strong">{t('Historia de contactos', 'Contact history')}</summary>
      {turns.length > 0 && (
        <>
          <p className="mt-3 text-[13px] font-semibold text-muted-2">{t('Contacto principal', 'Primary contact')}</p>
          <ul className="mt-1 space-y-2">
            {turns.map((p, i) => (
              <li key={i} className="text-[14px]" data-testid="primary-turn"><span className={p.to_at ? 'text-muted-2' : 'font-medium text-strong'}>{p.full_name}</span>
                <span className="block text-[13px] text-muted-2">{t('desde', 'since')} {day(p.from_at, locale, tz)}{p.to_at ? ` ${t('hasta', 'until')} ${day(p.to_at, locale, tz)}` : ''}{p.by_name ? ` · ${t('lo cambió', 'changed by')} ${p.by_name}` : ''}</span></li>
            ))}
          </ul>
        </>
      )}
      {identity.past.length > 0 && (
        <>
          <p className="mt-4 text-[13px] font-semibold text-muted-2">{t('Ya no son contacto', 'No longer contacts')}</p>
          <ul className="mt-1 space-y-2">
            {identity.past.map((p, i) => (
              <li key={i} className="text-[14px] text-muted-2" data-testid="past-contact">{p.full_name} · {lab(t, CONTACT_ROLE[p.role], p.role)}
                <span className="block text-[13px]">{day(p.valid_from, locale, tz)} {t('a', 'to')} {day(p.valid_to, locale, tz)}{p.end_reason && p.end_reason !== 'merge' ? ` · ${p.end_reason}` : ''}</span></li>
            ))}
          </ul>
        </>
      )}
    </details>
  )
}

/** DAT-03: los ID que este comercio tiene en otros sistemas, con alta a mano, cierre con fecha e historia. */
export function AliasSection({ ctx, accountId, identity, canManage, canInternal, tz }: { ctx: Ctx; accountId: string; identity: Identity; canManage: boolean; /** Los ID de sistemas de axexo los escribe la integración: a mano, solo administración. */ canInternal: boolean; tz: string }) {
  const { t, locale } = ctx
  const systems = identity.systems.filter((s) => canInternal || s.kind !== 'internal')
  const live = identity.aliases.filter((a) => !a.valid_to)
  const closed = identity.aliases.filter((a) => a.valid_to)
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className={h3}>{t('IDs en otros sistemas', 'IDs in other systems')}</h3>
        {canManage && (
          <Dialog trigger={t('Agregar ID', 'Add ID')} title={t('Agregar un ID de otro sistema', 'Add an ID from another system')} size="sm" testId="alias-add">
            <ActionForm action={addAliasAction} onOk="close" className="space-y-4">
              <input type="hidden" name="account_id" value={accountId} />
              <Field label={t('Sistema', 'System')}><select name="system" className="input" data-testid="alias-system">{systems.map((s) => <option key={s.code} value={s.code}>{t(s.label_es, s.label_en)}</option>)}</select></Field>
              <Field label={t('ID en ese sistema', 'ID in that system')} hint={t('El identificador tal como aparece allá. Nunca una identificación fiscal completa ni una cuenta bancaria.', 'The identifier exactly as it shows there. Never a full tax ID or a bank account.')}><input name="external_id" className="input" required maxLength={80} data-testid="alias-id" /></Field>
              <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" className="input" maxLength={300} /></Field>
              <div className="flex justify-end"><Submit testId="alias-save">{t('Agregar', 'Add')}</Submit></div>
            </ActionForm>
          </Dialog>
        )}
      </div>
      <p className="text-[13px] text-muted">{t('Este comercio tiene un solo ID en CONTIGO; los demás sistemas se ligan como alias y se puede buscar por cualquiera.', 'This merchant has one ID in CONTIGO; other systems link to it as aliases and it can be found by any of them.')}</p>
      <dl className="mt-2">
        <KeyVal k="CONTIGO"><code className="text-[13px]">{accountId.slice(0, 13)}…</code></KeyVal>
        {live.map((al) => (
          <KeyVal key={al.id} k={t(al.label_es, al.label_en)}>
            <code className="text-[13px]" data-testid="alias-value">{al.external_id}</code>
            <CopyButton value={al.external_id} label={t(`Copiar el ID de ${al.label_es}`, `Copy the ${al.label_en} ID`)} done={t('ID copiado.', 'ID copied.')} />
            {canManage && (canInternal || al.kind !== 'internal') && (
              <Dialog trigger={t('Cerrar', 'Close')} title={t(`Cerrar el ID de ${al.label_es}`, `Close the ${al.label_en} ID`)} size="sm" variant="quiet" testId="alias-close">
                <ActionForm action={closeAliasAction} onOk="close" className="space-y-4">
                  <input type="hidden" name="alias_id" value={al.id} />
                  <p className="text-[14px] text-muted-2">{t(`"${al.external_id}" deja de ser de este comercio desde hoy y queda en su historia. Si cambió de ID, agrega después el nuevo.`, `"${al.external_id}" stops belonging to this merchant as of today and stays in its history. If the ID changed, add the new one afterwards.`)}</p>
                  <Field label={t('¿Por qué se cierra?', 'Why is it being closed?')}><input name="reason" className="input" required minLength={3} maxLength={300} data-testid="alias-close-reason" /></Field>
                  <div className="flex justify-end"><Submit variant="danger" testId="alias-close-save">{t('Cerrar ID', 'Close ID')}</Submit></div>
                </ActionForm>
              </Dialog>
            )}
          </KeyVal>
        ))}
      </dl>
      {live.length === 0 && <p className="mt-2 text-[13px] text-muted">{t('Todavía no existe en la Sales App ni en los datos de ventas.', 'It is not in the Sales App or the sales data yet.')}</p>}
      {closed.length > 0 && (
        <details className="mt-3 rounded-[12px] border border-line px-4 py-3" data-testid="alias-history">
          <summary className="cursor-pointer text-[14px] font-medium text-strong">{t('ID anteriores', 'Earlier IDs')} ({closed.length})</summary>
          <ul className="mt-3 space-y-2">
            {closed.map((al) => (
              <li key={al.id} className="text-[14px] text-muted-2" data-testid="alias-closed">{t(al.label_es, al.label_en)}: <code className="text-[13px]">{al.external_id}</code>
                <span className="block text-[13px]">{day(al.valid_from, locale, tz)} {t('a', 'to')} {day(al.valid_to, locale, tz)}{al.note ? ` · ${al.note}` : ''}</span></li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

/** DAT-07: productos de este comercio y en qué va cada uno con su proveedor. */
export function ProductsSection({ ctx, accountId, identity, canManage }: { ctx: Ctx; accountId: string; identity: Identity; canManage: boolean }) {
  const { t, locale } = ctx
  if (identity.products.length === 0 && !canManage) return null
  const statusSelect = (def: string) => <select name="status" className="input" defaultValue={def} data-testid="product-status">{PRODUCT_STATUSES.map((k) => <option key={k} value={k}>{t(...PRODUCT_STATUS[k]!)}</option>)}</select>
  return (
    <section className={section} data-testid="account-products">
      <div className="flex items-center justify-between gap-3">
        <h3 className={h3}>{t('Productos y proveedores', 'Products and providers')}</h3>
        {canManage && (identity.catalog.length > 0 || identity.providers.length > 0) && (
          <Dialog trigger={t('Agregar', 'Add')} title={t('Agregar un producto', 'Add a product')} size="sm" testId="product-add">
            <ActionForm action={setAccountProductAction} onOk="close" className="space-y-4">
              <input type="hidden" name="account_id" value={accountId} />
              <Field label={t('Producto', 'Product')}><select name="product_id" className="input" data-testid="product-pick"><option value="">{t('Solo el alta con el proveedor', 'Provider sign-up only')}</option>{identity.catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label={t('Proveedor', 'Provider')} hint={t('Si lo dejas así, se toma el proveedor del producto.', 'Leave it like this to use the product’s provider.')}><select name="provider_id" className="input" data-testid="product-provider-pick"><option value="">{t('El del producto', 'The product’s')}</option>{identity.providers.map((p) => <option key={p.id} value={p.id}>{t(p.label_es, p.label_en)}</option>)}</select></Field>
              <Field label={t('Estado', 'Status')}>{statusSelect('requested')}</Field>
              <div className="flex justify-end"><Submit testId="product-save">{t('Agregar', 'Add')}</Submit></div>
            </ActionForm>
          </Dialog>
        )}
      </div>
      {identity.products.length === 0 ? <p className="mt-2 text-[15px] text-muted">{t('Sin productos registrados todavía.', 'No products on record yet.')}</p> : (
        <ul className="mt-2 space-y-3">
          {identity.products.map((p) => (
            <li key={p.id} data-testid="product-item">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium text-strong">
                {p.product_name ?? t('Alta con el proveedor', 'Provider sign-up')}
                {p.provider_es && <span className="text-[13px] font-normal text-muted">{t(p.provider_es, p.provider_en ?? p.provider_es)}</span>}
                <span data-testid="product-state"><Badge tone={PRODUCT_TONE[p.status]}>{lab(t, PRODUCT_STATUS[p.status], p.status)}</Badge></span>
                {p.late && <span data-testid="product-late"><Badge tone="bad">{t(`Fuera del plazo de ${p.sla_days} días`, `Past the ${p.sla_days}-day deadline`)}</Badge></span>}
              </p>
              <p className="text-[13px] text-muted-2">
                {[t(`solicitado ${ago(p.requested_at, locale)}`, `requested ${ago(p.requested_at, locale)}`), p.submitted_at ? t(`enviado ${ago(p.submitted_at, locale)}`, `sent ${ago(p.submitted_at, locale)}`) : null,
                  p.decided_at ? t(`respuesta ${ago(p.decided_at, locale)}`, `answer ${ago(p.decided_at, locale)}`) : null, p.activated_at ? t(`activo ${ago(p.activated_at, locale)}`, `active ${ago(p.activated_at, locale)}`) : null].filter(Boolean).join(' · ')}
                {p.deal_id && <> · <Link href={`/deals/${p.deal_id}`} className="font-medium text-blue-text underline">{t('ver el negocio', 'see the deal')}</Link></>}
              </p>
              {canManage && (
                <ActionForm action={setAccountProductAction} className="mt-1 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="product_id" value={p.product_id ?? ''} /><input type="hidden" name="provider_id" value={p.provider_id ?? ''} />
                  <label className="text-[13px] text-muted-2">{t('Cambiar estado', 'Change status')}<span className="mt-1 block w-56">{statusSelect(p.status)}</span></label>
                  <Submit variant="quiet" size="sm" testId="product-status-save">{t('Guardar', 'Save')}</Submit>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** DAT-05: listas de proceso del mercado en las que está (o puede entrar) este comercio. */
export function ProcessSection({ ctx, accountId, identity, canEdit }: { ctx: Ctx; accountId: string; identity: Identity; canEdit: boolean }) {
  const { t, locale } = ctx
  if (identity.processes.length === 0) return null
  return (
    <section className={section} data-testid="account-processes">
      <h3 className={h3}>{t('Procesos', 'Processes')}</h3>
      <p className="text-[13px] text-muted">{t('Lo que este mercado sigue al lado del embudo.', 'What this market tracks alongside the pipeline.')}</p>
      <ul className="mt-3 space-y-4">
        {identity.processes.map((p) => {
          const current = p.statuses.find((s) => s.code === p.status)
          return (
            <li key={p.list_id} data-testid="process-item">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-strong">{t(p.name_es, p.name_en)}
                {current ? <span data-testid="process-state"><Badge tone={p.ended_at ? 'good' : 'info'}>{t(current.es, current.en)}</Badge></span> : <span className="text-[13px] font-normal text-muted">{t('no está en esta lista', 'not on this list')}</span>}
                {p.status_at && <span className="text-[13px] font-normal text-muted">{ago(p.status_at, locale)}</span>}
              </p>
              {p.attributes.filter((a) => p.attrs[a.key]).map((a) => <p key={a.key} className="text-[13px] text-muted-2">{t(a.es, a.en)}: {p.attrs[a.key]}</p>)}
              {canEdit && (p.is_active || p.membership_id) && (
                <ActionForm action={setProcessStatusAction} className={cx('mt-1 grid gap-2', p.attributes.length ? 'sm:grid-cols-2' : '')}>
                  <input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="list_id" value={p.list_id} />
                  <label className="text-[13px] text-muted-2">{current && !p.ended_at ? t('Cambiar estado', 'Change status') : t('Poner en la lista', 'Put on the list')}
                    <select name="status" className="input mt-1" defaultValue={p.ended_at ? p.statuses[0]!.code : (p.status ?? p.statuses[0]!.code)} data-testid="process-status">{p.statuses.map((s) => <option key={s.code} value={s.code}>{t(s.es, s.en)}</option>)}</select></label>
                  {p.attributes.map((a) => <label key={a.key} className="text-[13px] text-muted-2">{t(a.es, a.en)}<input name={`attr_${a.key}`} className="input mt-1" maxLength={200} defaultValue={p.ended_at ? '' : (p.attrs[a.key] ?? '')} data-testid="process-attr" /></label>)}
                  <div className="flex items-end"><Submit variant="quiet" size="sm" testId="process-status-save">{t('Guardar', 'Save')}</Submit></div>
                </ActionForm>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** DAT-04: fusiones en las que participó este comercio, con qué dato ganó y la opción de deshacer. */
export function MergeSection({ ctx, accountId, identity, tz }: { ctx: Ctx; accountId: string; identity: Identity; tz: string }) {
  const { t, locale } = ctx
  if (identity.merges.length === 0) return null
  return (
    <section className={section} data-testid="account-merges">
      <h3 className={h3}>{t('Fusiones', 'Merges')}</h3>
      <ul className="mt-2 space-y-3">
        {identity.merges.map((e) => {
          const taken = Object.entries(e.fields).filter(([, v]) => v.winner === 'source').map(([f]) => lab(t, SURVIVOR_LABEL[f], f))
          const other = e.target_id === accountId ? { id: e.source_id, name: e.source_name } : { id: e.target_id, name: e.target_name }
          return (
            <li key={e.id} data-testid="account-merge">
              <p className="text-[14px] text-strong">{e.target_id === accountId ? t(`Aquí se fusionó "${other.name}"`, `"${other.name}" was merged into this one`) : t(`Se fusionó en "${other.name}"`, `Merged into "${other.name}"`)}</p>
              <p className="text-[13px] text-muted-2">{[e.merged_by, day(e.merged_at, locale, tz), taken.length ? t(`del otro se tomó: ${taken.join(', ')}`, `taken from the other: ${taken.join(', ')}`) : null].filter(Boolean).join(' · ')}</p>
              {e.undone_at ? <p className="text-[13px] text-amber-text">{t(`Se deshizo el ${day(e.undone_at, locale, tz)}`, `Undone on ${day(e.undone_at, locale, tz)}`)}{e.undo_reason ? `: ${e.undo_reason}` : ''}</p> : ctx.can('account.merge') && (
                <Dialog trigger={t('Deshacer la fusión', 'Undo the merge')} title={t('Deshacer la fusión', 'Undo the merge')} size="sm" variant="quiet" testId="account-merge-undo">
                  <ActionForm action={undoMergeAction} onOk="close" className="space-y-4">
                    <input type="hidden" name="event_id" value={e.id} />
                    <p className="text-[14px] text-muted-2">{t(`"${e.source_name}" vuelve a existir con sus datos de antes y recupera lo que se había movido. Lo registrado después se queda aquí.`, `"${e.source_name}" exists again with its earlier details and gets back what had been moved. Anything logged afterwards stays here.`)}</p>
                    <Field label={t('¿Por qué se deshace?', 'Why is it being undone?')}><input name="reason" className="input" required minLength={5} maxLength={300} data-testid="account-undo-reason" /></Field>
                    <div className="flex justify-end"><Submit variant="danger" testId="account-undo-save">{t('Deshacer', 'Undo')}</Submit></div>
                  </ActionForm>
                </Dialog>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
