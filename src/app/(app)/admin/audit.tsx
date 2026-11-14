import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { getAudit } from '@/dal/admin'
import { readerTimeZone } from '@/server/timezone'
import { Card, CardTitle, Empty, LinkButton, Table, buttonClass } from '@/ui/kit'
import { AutoSubmit, TimezoneSync } from '@/ui/admin'
import { AUDIT_GROUPS, AUDIT_OBJECT, actionLabel, diffRows, isAuditGroup, stamp, summary, zoneLabel, type AuditGroup } from '@/lib/audit'
import { num } from '@/lib/format'
import { isUuid } from '@/lib/ids'
import { qs } from '@/lib/labels'

export type AuditParams = { quien?: string; tipo?: string; registro?: string; id?: string; mercado?: string; desde?: string; hasta?: string; before?: string; after?: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Bitácora legible: hora en la zona de quien lee (con la zona escrita), acciones con nombre, el registro por su nombre
 * y con enlace cuando quien lee lo puede abrir, el antes y el después en palabras, filtros y paginación.
 */
export async function AuditTab({ ctx, sp }: { ctx: Ctx; sp: AuditParams }) {
  const { t, locale } = ctx
  const tz = await readerTimeZone(ctx)
  const f = {
    quien: isUuid(sp.quien) ? sp.quien : undefined,
    tipo: isAuditGroup(sp.tipo) ? sp.tipo : undefined,
    registro: sp.registro && sp.registro in AUDIT_OBJECT ? sp.registro : undefined,
    id: isUuid(sp.id) ? sp.id : undefined,
    mercado: ctx.markets.some((m) => m.code === sp.mercado) ? sp.mercado : undefined,
    desde: sp.desde && DAY.test(sp.desde) ? sp.desde : undefined,
    hasta: sp.hasta && DAY.test(sp.hasta) ? sp.hasta : undefined,
  }
  const d = await getAudit(ctx, { actor: f.quien, group: f.tipo, object: f.registro, id: f.id, market: f.mercado, from: f.desde, to: f.hasta, tz, before: sp.before, after: sp.after })
  const link = (patch: Record<string, string | undefined>) => qs('/admin', { tab: 'auditoria', ...f, ...patch })
  const filtered = Object.values(f).some(Boolean)
  const label = 'mb-1.5 block text-[12.5px] font-semibold text-muted-2'

  return (
    <Card pad={false} data-testid="admin-audit">
      <TimezoneSync current={tz} />
      <div className="px-5 pt-6 md:px-7 md:pt-7">
        <CardTitle title={t('Bitácora', 'Audit log')} hint={t('Cada cambio queda aquí con quién lo hizo y cuándo. Solo se agrega: nadie puede editarla ni borrarla, tampoco quien administra.', 'Every change is kept here with who made it and when. It is append-only: nobody can edit or delete it, administrators included.')} />
        <AutoSubmit action="/admin" className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 desk:grid-cols-6" testId="audit-filters">
          <input type="hidden" name="tab" value="auditoria" />
          {f.id && <input type="hidden" name="id" value={f.id} />}
          <label className="col-span-2 md:col-span-1 desk:col-span-2">
            <span className={label}>{t('Tipo de acción', 'Kind of action')}</span>
            <select name="tipo" className="input" defaultValue={f.tipo ?? ''} data-testid="audit-kind">
              {(Object.keys(AUDIT_GROUPS) as AuditGroup[]).map((k) => <option key={k} value={k}>{t(...AUDIT_GROUPS[k].label)}</option>)}
            </select>
          </label>
          <label className="col-span-2 md:col-span-1 desk:col-span-2">
            <span className={label}>{t('Quién lo hizo', 'Who did it')}</span>
            <select name="quien" className="input" defaultValue={f.quien ?? ''} data-testid="audit-actor">
              <option value="">{t('Cualquier persona', 'Anyone')}</option>
              {d.actors.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </label>
          <label className="col-span-2 md:col-span-1 desk:col-span-2">
            <span className={label}>{t('Registro afectado', 'Record affected')}</span>
            <select name="registro" className="input" defaultValue={f.registro ?? ''} data-testid="audit-object">
              <option value="">{t('Cualquier registro', 'Any record')}</option>
              {Object.keys(AUDIT_OBJECT).map((k) => <option key={k} value={k}>{t(...AUDIT_OBJECT[k]!)}</option>)}
            </select>
          </label>
          <label className="col-span-2 md:col-span-1 desk:col-span-2">
            <span className={label}>{t('Mercado', 'Market')}</span>
            <select name="mercado" className="input" defaultValue={f.mercado ?? ''} data-testid="audit-market">
              <option value="">{t('Todos', 'All')}</option>
              {ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>{t('Desde', 'From')}</span>
            <input type="date" name="desde" className="input" defaultValue={f.desde ?? ''} data-testid="audit-from" />
          </label>
          <label>
            <span className={label}>{t('Hasta', 'To')}</span>
            <input type="date" name="hasta" className="input" defaultValue={f.hasta ?? ''} data-testid="audit-to" />
          </label>
          <div className="col-span-2 flex flex-wrap items-end gap-3">
            <button type="submit" className={buttonClass('ghost')} data-testid="audit-apply">{t('Aplicar', 'Apply')}</button>
            {filtered && <LinkButton href="/admin?tab=auditoria" variant="quiet" testId="audit-clear">{t('Quitar filtros', 'Clear filters')}</LinkButton>}
          </div>
        </AutoSubmit>
        {f.id && (
          <p className="mt-4 text-[13.5px] text-strong" data-testid="audit-record">
            {t('Solo el historial de: ', 'Only the history of: ')}<strong>{d.names[f.id] ?? t('un registro', 'one record')}</strong>{' · '}
            <Link href={link({ id: undefined })} className="font-semibold text-blue-text underline">{t('ver todos los registros', 'see all records')}</Link>
          </p>
        )}
        <p className="mt-5 mb-4 text-[13px] text-muted-2" data-testid="audit-zone">
          {t(`${num(d.total, locale)} ${d.total === 1 ? 'evento' : 'eventos'}. Las horas están en ${zoneLabel(tz, locale)}.`, `${num(d.total, locale)} ${d.total === 1 ? 'event' : 'events'}. Times are in ${zoneLabel(tz, locale)}.`)}
        </p>
      </div>
      {d.items.length === 0 ? (
        <div className="p-7"><Empty title={filtered ? t('Ningún evento con esos filtros', 'No events match those filters') : t('Sin eventos todavía', 'No events yet')} hint={filtered ? t('Prueba con otro tipo de acción o con un rango de fechas más amplio.', 'Try another kind of action or a wider date range.') : undefined} /></div>
      ) : (
        <Table testId="audit-table" label={t('Eventos de la bitácora', 'Audit events')} head={<><th>{t('Cuándo', 'When')}</th><th>{t('Quién', 'Who')}</th><th>{t('Qué hizo', 'What they did')}</th><th>{t('Sobre', 'On')}</th><th>{t('Mercado', 'Market')}</th></>}>
          {d.items.map((e) => {
            const rows = diffRows(t, locale, e.before, e.after, d.names, e.action)
            const line = summary(t, locale, e.action, e.before, e.after, d.names)
            const name = e.object_id ? d.names[e.object_id] : null
            const href = e.object_id ? d.links[e.object_id] : null
            const kind = AUDIT_OBJECT[e.object] ? t(...AUDIT_OBJECT[e.object]!) : e.object
            return (
              <tr key={e.id} className="table-row align-top" data-testid="audit-row">
                <td className="text-[13px] whitespace-nowrap text-muted-2" data-testid="audit-when">{stamp(e.at, locale, tz)}</td>
                <td className="text-[13.5px]">{e.actor ?? t('Sin persona', 'No person')}</td>
                <td className="min-w-[220px]">
                  <span className="block text-[14px] font-semibold text-strong" data-testid="audit-what">{actionLabel(t, e.action)}</span>
                  {line && <span className="mt-0.5 block text-[13px] text-muted-2" data-testid="audit-summary">{line}</span>}
                  {rows.length > 0 && !e.action.startsWith('session.') && (
                    <details className="mt-1.5" data-testid="audit-detail">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-blue-text underline md:min-h-0">{t('Ver el antes y el después', 'See before and after')}</summary>
                      <dl className="mt-2 space-y-2 rounded-[10px] bg-surface-2 p-3 text-[13px]">
                        {rows.map((r) => (
                          <div key={r.key}>
                            <dt className="font-semibold text-strong">{r.label}</dt>
                            <dd className="text-muted-2 [overflow-wrap:anywhere]">
                              {r.before !== null && <span><span className="text-muted">{t('Antes: ', 'Before: ')}</span>{r.before}</span>}
                              {r.before !== null && r.after !== null && <span className="mx-2 text-muted" aria-hidden>→</span>}
                              {r.after !== null && <span><span className="text-muted">{r.before !== null ? t('Después: ', 'After: ') : ''}</span>{r.after}</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </td>
                <td className="min-w-[180px] text-[13.5px]">
                  <span className="block text-[12.5px] text-muted">{kind}</span>
                  {name && (href
                    ? <Link href={href} className="font-semibold text-blue-text underline [overflow-wrap:anywhere]" data-testid="audit-target">{name}</Link>
                    : <span className="font-semibold text-strong [overflow-wrap:anywhere]" data-testid="audit-target">{name}</span>)}
                  {e.object_id && !f.id && (
                    <Link href={link({ id: e.object_id, before: undefined, after: undefined })} className="mt-0.5 block text-[12.5px] text-blue-text underline" data-testid="audit-history">{t('Ver solo su historial', 'See only its history')}</Link>
                  )}
                </td>
                <td className="text-[13px]">{e.market_code ?? 'Global'}</td>
              </tr>
            )
          })}
        </Table>
      )}
      {(d.newer || d.older) && (
        <nav aria-label={t('Páginas de la bitácora', 'Audit log pages')} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-5 md:px-7" data-testid="audit-pages">
          {d.newer ? <LinkButton href={link({ after: d.newer })} size="md" testId="audit-newer">{t('Más recientes', 'Newer')}</LinkButton> : <span />}
          {d.older ? <LinkButton href={link({ before: d.older })} size="md" testId="audit-older">{t('Anteriores', 'Older')}</LinkButton> : <span />}
        </nav>
      )}
    </Card>
  )
}
