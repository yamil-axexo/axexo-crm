import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx, type Ctx } from '@/server/context'
import { getAccessControl, getDbLog, getKeys, getMonitoring, getPrivacy, getViewAs } from '@/dal/security'
import { ADMIN_AREAS, AREA_LABEL, ROLE_LABEL, type Role } from '@/domain/policy'
import { REQUEST_KINDS, THRESHOLD_KEYS } from '@/domain/security'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, buttonClass } from '@/ui/kit'
import { ActionForm, Dialog, RevealOnce, Submit } from '@/ui/client'
import { day, dayTime, isoDay, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'
import { auditArchiveMode, AUDIT_ARCHIVE_ENV } from '@/server/adapters/audit-archive'
import { directoryMode, DIRECTORY_ENV } from '@/server/adapters/directory'
import { fieldCryptoMode, FIELD_CRYPTO_ENV } from '@/server/adapters/field-crypto'
import * as A from './actions'
import { ALERT_KIND, REQUEST_KIND, REQUEST_STATUS, THRESHOLD_LABEL, VIA_LABEL, CHANNEL_LABEL } from './labels'

export const dynamic = 'force-dynamic'

const SECTIONS = ['alertas', 'accesos', 'privacidad', 'llaves', 'bitacora'] as const
type Section = (typeof SECTIONS)[number]
const row = 'flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0'
const small = 'text-[13px] text-muted'

/** Seguridad y privacidad: lo que la base registra sola, quién tiene acceso a qué, los datos reservados y las llaves. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ s?: string; log?: string; via?: string }> }) {
  const ctx = await requireCtx()
  const { t } = ctx
  const sees: Record<Section, boolean> = {
    alertas: ctx.can('security.read'),
    accesos: ctx.can('access.manage') || ctx.can('access.review') || ctx.can('security.read'),
    privacidad: ctx.can('security.read'),
    llaves: ctx.can('integration.operate') || ctx.can('security.read'),
    bitacora: ctx.can('audit.read'),
  }
  const allowed = SECTIONS.filter((k) => sees[k])
  if (allowed.length === 0) notFound()
  const sp = flat(await searchParams)
  const s: Section = allowed.includes(sp.s as Section) ? (sp.s as Section) : allowed[0]!
  const labels: Record<Section, string> = {
    alertas: t('Alertas y lecturas', 'Alerts and reads'),
    accesos: t('Accesos', 'Access'),
    privacidad: t('Datos reservados y privacidad', 'Restricted data and privacy'),
    llaves: t('Llaves y conexiones', 'Keys and connections'),
    bitacora: t('Bitácora de la base', 'Database log'),
  }
  const tz = await readerTimeZone(ctx)
  return (
    <>
      <PageHeader
        eyebrow={t('Administración', 'Administration')}
        title={t('Seguridad', 'Security')}
        desc={t('Lo que la base registra sola, quién tiene acceso a qué, los datos reservados y las llaves. Todo cambio de esta pantalla queda en la bitácora.', 'What the database records on its own, who has access to what, restricted data and keys. Every change on this screen is logged.')}
        actions={<Link href="/admin" className={buttonClass('quiet')} data-testid="security-back">{t('Volver a Administración', 'Back to Administration')}</Link>}
      />
      <div className="mb-8"><Pills label={t('Secciones de seguridad', 'Security sections')} current={s} items={allowed.map((k) => ({ key: k, href: qs('/admin/seguridad', { s: k }), label: labels[k] }))} /></div>
      {s === 'alertas' && <Monitoring ctx={ctx} tz={tz} />}
      {s === 'accesos' && <Access ctx={ctx} tz={tz} />}
      {s === 'privacidad' && <Privacy ctx={ctx} tz={tz} />}
      {s === 'llaves' && <Keys ctx={ctx} tz={tz} />}
      {s === 'bitacora' && <DbLog ctx={ctx} tz={tz} which={sp.log === 'config' ? 'config' : 'data'} via={sp.via ?? ''} />}
    </>
  )
}

type P = { ctx: Ctx; tz: string }
const off = (ctx: Ctx, envName: string, need: [string, string]) => (
  <p className="mt-3 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-muted-2" data-testid={`adapter-${envName}`}>
    <Badge tone="neutral">{ctx.t('Canal apagado', 'Channel off')}</Badge> <span className="ml-1">{ctx.t(need[0], need[1])}</span> <code className="text-[12px]">{envName}</code>
  </p>
)

async function Monitoring({ ctx, tz }: P) {
  const { t, locale } = ctx
  const d = await getMonitoring(ctx)
  const manage = ctx.can('security.manage')
  const open = d.alerts.filter((a) => a.status === 'open')
  return (
    <div className="space-y-8" data-testid="security-monitoring">
      <Card data-testid="alerts-card">
        <CardTitle
          title={t('Alertas', 'Alerts')}
          hint={t('Se abren cuando alguien exporta, busca o revela más de lo que marcan los umbrales, cuando una llave está por vencer o sin uso, y cuando un dato cambia por fuera de la aplicación.', 'They open when someone exports, searches or reveals more than the thresholds allow, when a key is about to expire or unused, and when data changes outside the application.')}
          right={<Badge tone={open.length ? 'warn' : 'good'}>{t(`${open.length} sin revisar`, `${open.length} to review`)}</Badge>}
        />
        {manage && <ActionForm action={A.scanAction} className="mb-5"><Submit variant="ghost" testId="scan-now">{t('Revisar ahora', 'Check now')}</Submit></ActionForm>}
        {d.alerts.length === 0 ? (
          <Empty title={t('Sin alertas', 'No alerts')} hint={t('La revisión corre cada hora. Cuando algo pase de un umbral, aparece aquí con quién, cuánto y cuándo.', 'The check runs every hour. When something goes over a threshold it shows up here with who, how much and when.')} />
        ) : (
          <ul data-testid="alert-list">
            {d.alerts.map((a) => (
              <li key={a.id} className={row} data-testid="alert-row">
                <div className="min-w-0 flex-1 basis-[260px]">
                  <p className="text-[15px] font-semibold text-strong">{t(ALERT_KIND[a.kind]?.[0] ?? a.kind, ALERT_KIND[a.kind]?.[1] ?? a.kind)}</p>
                  <p className={small}>{a.subject} · {a.period} · {a.threshold > 0 ? t(`${num(a.observed, locale)} de un umbral de ${num(a.threshold, locale)}`, `${num(a.observed, locale)} against a threshold of ${num(a.threshold, locale)}`) : t(`${num(a.observed, locale)} cambios`, `${num(a.observed, locale)} changes`)}</p>
                  {a.status === 'acknowledged' && <p className={small}>{t(`Revisó ${a.ack_name ?? 's/d'}: ${a.ack_note ?? ''}`, `Reviewed by ${a.ack_name ?? 'n/a'}: ${a.ack_note ?? ''}`)}</p>}
                </div>
                {a.status === 'open' && manage ? (
                  <ActionForm action={A.ackAlertAction} className="basis-[280px]">
                    <input type="hidden" name="id" value={a.id} />
                    <label className="sr-only" htmlFor={`ack-${a.id}`}>{t('Qué revisaste', 'What you checked')}</label>
                    <div className="flex flex-wrap gap-2">
                      <input id={`ack-${a.id}`} name="note" className="input min-w-0 flex-1 basis-40" required minLength={5} maxLength={300} placeholder={t('Qué revisaste', 'What you checked')} data-testid="ack-note" />
                      <Submit variant="ghost" testId="ack-save">{t('Marcar revisada', 'Mark reviewed')}</Submit>
                    </div>
                  </ActionForm>
                ) : <Badge tone={a.status === 'open' ? 'warn' : 'neutral'}>{a.status === 'open' ? t('Sin revisar', 'To review') : t('Revisada', 'Reviewed')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="reads-card">
        <CardTitle title={t('Lo que salió o se consultó en 7 días', 'What left or was looked up in 7 days')} hint={t('Exportaciones, búsquedas, revelados de datos reservados, "ver como" y llamadas con llave. La base lo registra por persona y por llave.', 'Exports, searches, reveals of restricted data, "view as" and calls made with a key. The database records it per person and per key.')} />
        {d.reads.length === 0 ? <Empty title={t('Nada todavía', 'Nothing yet')} hint={t('Cuando alguien exporte, busque o revele un dato reservado, se cuenta aquí.', 'When someone exports, searches or reveals restricted data, it is counted here.')} /> : (
          <ul data-testid="read-list">
            {d.reads.map((r, i) => (
              <li key={i} className={row}>
                <span className="text-[15px] font-medium text-strong">{r.name}</span>
                <span className={small}>{t(READ_KIND[r.kind]?.[0] ?? r.kind, READ_KIND[r.kind]?.[1] ?? r.kind)} · {t(`${num(r.times, locale)} veces, ${num(r.row_total, locale)} filas`, `${num(r.times, locale)} times, ${num(r.row_total, locale)} rows`)} · {dayTime(r.last_at, locale, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {manage && (
        <Card data-testid="thresholds-card">
          <CardTitle title={t('Umbrales', 'Thresholds')} hint={t('Valores de arranque. Ajústalos a lo que es normal en la operación: por encima de esto se abre una alerta.', 'Starting values. Adjust them to what is normal in the operation: above this an alert opens.')} />
          <ActionForm action={A.thresholdsAction}>
            <div className="grid gap-4 sm:grid-cols-2">
              {THRESHOLD_KEYS.map((k) => (
                <Field key={k} label={t(THRESHOLD_LABEL[k]?.[0] ?? k, THRESHOLD_LABEL[k]?.[1] ?? k)}>
                  <input name={k} type="number" min={1} max={1000000} required defaultValue={d.thresholds[k] ?? ''} className="input" data-testid={`threshold-${k}`} />
                </Field>
              ))}
            </div>
            <div className="mt-4"><Submit variant="ghost" testId="thresholds-save">{t('Guardar umbrales', 'Save thresholds')}</Submit></div>
          </ActionForm>
        </Card>
      )}

      <Card data-testid="archive-card">
        <CardTitle title={t('Bitácora y copia fuera de la base', 'Audit log and off-database copy')} hint={t('La base escribe una fila por cada cambio en las tablas de negocio y de configuración, también si el cambio entra por SQL directo. Nadie la edita ni la borra.', 'The database writes a row for every change to business and configuration tables, also when the change comes in through direct SQL. Nobody edits or deletes it.')} />
        <p className="text-[14px] text-strong" data-testid="log-counts">{t(`${num(d.logs.dataRows, locale)} filas de datos y ${num(d.logs.configRows, locale)} de configuración.`, `${num(d.logs.dataRows, locale)} data rows and ${num(d.logs.configRows, locale)} configuration rows.`)}</p>
        {d.logs.via.length > 0 && <p className={`${small} mt-1`}>{t('Últimos 7 días, por vía: ', 'Last 7 days, by channel: ')}{d.logs.via.map((v) => `${t(VIA_LABEL[v.via]?.[0] ?? v.via, VIA_LABEL[v.via]?.[1] ?? v.via)} ${num(v.n, locale)}`).join(' · ')}</p>}
        {auditArchiveMode() === 'off' && off(ctx, AUDIT_ARCHIVE_ENV, ['La copia diaria fuera de la base está construida y apagada. Falta: un destino aprobado en la revisión técnica (almacenamiento de objetos o el lago de datos). Mientras tanto, cada lote queda aquí con su huella.', 'The daily off-database copy is built and turned off. Missing: a destination approved in the technical review (object storage or the data lake). Meanwhile each batch stays here with its fingerprint.'])}
        {manage && <ActionForm action={A.archiveAction} className="mt-4"><Submit variant="ghost" testId="archive-now">{t('Armar el lote de hoy', 'Build today’s batch')}</Submit></ActionForm>}
        {d.batches.length > 0 && (
          <ul className="mt-4" data-testid="batch-list">
            {d.batches.map((b) => (
              <li key={b.id} className={row}>
                <span className="text-[14px] text-strong">{b.log_name === 'config_log' ? t('Configuración', 'Configuration') : t('Datos', 'Data')} · {t(`${num(b.row_count, locale)} filas`, `${num(b.row_count, locale)} rows`)} · {dayTime(b.created_at, locale, tz)}</span>
                <span className="flex flex-wrap items-center gap-2"><code className="text-[12px] text-muted">{b.sha256.slice(0, 16)}</code><Badge tone={b.status === 'channel_off' ? 'neutral' : 'good'}>{b.status === 'channel_off' ? t('Canal apagado', 'Channel off') : b.status === 'simulated' ? t('Simulado', 'Simulated') : t('Enviado', 'Sent')}</Badge></span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-5">
          <summary className="cursor-pointer text-[13.5px] font-semibold text-strong">{t(`Tablas que no llevan bitácora (${d.logs.excluded.length}), con su motivo`, `Tables with no log (${d.logs.excluded.length}), with the reason`)}</summary>
          <ul className="mt-2 space-y-1.5">{d.logs.excluded.map((e) => <li key={e.table_name} className={small}><code className="text-[12px]">{e.table_name}</code>: {e.reason}</li>)}</ul>
        </details>
      </Card>
    </div>
  )
}

const READ_KIND: Record<string, [string, string]> = {
  export: ['Exportó', 'Exported'], search: ['Buscó', 'Searched'], list: ['Listó', 'Listed'], reveal: ['Reveló un dato reservado', 'Revealed restricted data'],
  subject_export: ['Sacó los datos de una persona', 'Pulled a person’s data'], api: ['Llamadas con llave', 'Calls with a key'], view_as: ['Vio como otra persona', 'Viewed as someone else'],
}

async function Access({ ctx, tz }: P) {
  const { t, locale } = ctx
  const d = await getAccessControl(ctx)
  if (!d) notFound()
  const manage = ctx.can('access.manage')
  const full = ctx.isAdmin
  const view = ctx.can('user.view_as') ? await getViewAs(ctx) : null
  const role = (r: Role) => t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)
  const today = isoDay(new Date(), tz)
  const live = ctx.markets.filter((m) => m.status === 'live')
  return (
    <div className="space-y-8" data-testid="security-access">
      {view && (
        <Card data-testid="view-as-card">
          <CardTitle title={t('Ver como otra persona', 'View as someone else')} hint={t('Ves CONTIGO como lo ve esa persona, en solo lectura: no puedes cambiar, exportar ni revelar nada. Pide motivo, dura lo que elijas (máximo 60 minutos) y queda en la bitácora.', 'You see CONTIGO the way that person sees it, read-only: you cannot change, export or reveal anything. It asks for a reason, lasts as long as you choose (60 minutes at most) and is logged.')} />
          <ActionForm action={A.viewAsAction} testId="view-as-form">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Persona', 'Person')}>
                <select name="target_id" className="input" required defaultValue="" data-testid="view-as-target">
                  <option value="" disabled>{t('Elige a quién', 'Choose who')}</option>
                  {view.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </Field>
              <Field label={t('Tiempo', 'Time')}>
                <select name="minutes" className="input" defaultValue="15" data-testid="view-as-minutes">
                  {[15, 30, 60].map((n) => <option key={n} value={n}>{t(`${n} minutos`, `${n} minutes`)}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t('Para qué', 'What for')} hint={t('Por ejemplo: "Revisar por qué no ve la tienda que le asignaron ayer".', 'For example: "Check why they cannot see the store assigned yesterday".')} className="mt-4">
              <input name="reason" className="input" required minLength={10} maxLength={300} data-testid="view-as-reason" />
            </Field>
            <div className="mt-4"><Submit testId="view-as-start">{t('Ver como esta persona', 'View as this person')}</Submit></div>
          </ActionForm>
          {view.recent.length > 0 && (
            <ul className="mt-5" data-testid="view-as-recent">
              {view.recent.map((r, i) => <li key={i} className={`${small} border-t border-line py-2 first:border-t-0`}>{dayTime(r.at, locale, tz)} · {t(`${r.actor} vio como ${r.target}`, `${r.actor} viewed as ${r.target}`)}: {r.reason}</li>)}
            </ul>
          )}
        </Card>
      )}

      {(manage || ctx.can('security.read')) && (
        <Card data-testid="admin-areas-card">
          <CardTitle title={t('Quién administra qué', 'Who administers what')} hint={t('Administración ya no es todo o nada: una persona puede tener solo accesos, solo embudos y campos, solo bitácora y privacidad, o solo integraciones. Quien tiene una parte no trabaja registros ni se da más poder.', 'Administration is no longer all or nothing: a person can hold only access, only pipelines and fields, only audit log and privacy, or only integrations. Someone with one part does not work records or grant themselves more.')} />
          <ul data-testid="admin-areas-list">
            {d.admins.map((a) => (
              <li key={a.membership_id} className={row} data-testid="admin-areas-row">
                <div className="min-w-0 basis-[200px]">
                  <p className="text-[15px] font-semibold text-strong">{a.full_name}</p>
                  <p className={small} data-testid="admin-areas-now">{a.areas ? a.areas.map((x) => t(AREA_LABEL[x].es, AREA_LABEL[x].en)).join(', ') : t('Toda la administración', 'Full administration')}</p>
                </div>
                {full && a.user_id !== ctx.user.id && (
                  <ActionForm action={A.adminAreasAction} className="flex-1 basis-[320px]">
                    <input type="hidden" name="membership_id" value={a.membership_id} />
                    <fieldset>
                      <legend className="sr-only">{t(`Partes de ${a.full_name}`, `Parts for ${a.full_name}`)}</legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="radio" name="scope" value="all" defaultChecked={!a.areas} className="h-4 w-4" data-testid="areas-all" />{t('Toda', 'Full')}</label>
                        <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="radio" name="scope" value="parts" defaultChecked={!!a.areas} className="h-4 w-4" data-testid="areas-parts" />{t('Solo estas partes:', 'Only these parts:')}</label>
                        {ADMIN_AREAS.map((x) => (
                          <label key={x} className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="area" value={x} defaultChecked={a.areas?.includes(x)} className="h-4 w-4" data-testid={`area-${x}`} />{t(AREA_LABEL[x].es, AREA_LABEL[x].en)}</label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="mt-2"><Submit variant="ghost" testId="areas-save">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {!full && <p className={`${small} mt-3`}>{t('Cambiar las partes de una persona administradora lo hace quien tiene toda la administración.', 'Changing an administrator’s parts is done by someone with full administration.')}</p>}
        </Card>
      )}

      {d.reviews.length + (manage ? 1 : 0) > 0 && (
        <Card data-testid="reviews-card">
          <CardTitle title={t('Revisión periódica de accesos', 'Periodic access review')} hint={t('Una foto de quién tiene qué. Quien lidera cada mercado dice qué acceso se mantiene y cuál se quita, y cierra la revisión con su acuse. Los accesos sin mercado los acusa quien administra accesos.', 'A snapshot of who has what. Each market lead says which access stays and which goes, and closes the review with their sign-off. Access with no market is signed off by whoever administers access.')} />
          {manage && (
            <ActionForm action={A.openReviewAction} className="mb-6" testId="review-open-form">
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('Alcance', 'Scope')} className="min-w-0 flex-1 basis-48">
                  <select name="market" className="input" defaultValue={live[0]?.code ?? ''} data-testid="review-market">
                    {live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                    <option value="">{t('Roles sin mercado (Administración, Leadership)', 'Roles with no market (Administration, Leadership)')}</option>
                  </select>
                </Field>
                <Field label={t('Fecha límite', 'Due date')} className="basis-44"><input type="date" name="due_on" className="input" required min={today} data-testid="review-due" /></Field>
                <Submit variant="ghost" testId="review-open">{t('Abrir revisión', 'Open review')}</Submit>
              </div>
            </ActionForm>
          )}
          {d.reviews.length === 0 ? <Empty title={t('Todavía no hay revisiones', 'No reviews yet')} hint={t('Abre la primera arriba. La configuración por defecto propone una cada 90 días.', 'Open the first one above. The default setting suggests one every 90 days.')} /> : d.reviews.map((r) => {
            const items = d.items.filter((i) => i.review_id === r.id)
            const canDecide = !r.closed_at && ctx.can('access.review', r.market_code) && (r.market_code !== null || manage)
            return (
              <section key={r.id} className="border-t border-line py-5 first:border-t-0" data-testid="review">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[16px] font-semibold">{r.market_code ?? t('Roles sin mercado', 'Roles with no market')} · {t(`abierta el ${day(r.opened_at, locale, tz)}, vence el ${r.due_on}`, `opened ${day(r.opened_at, locale, tz)}, due ${r.due_on}`)}</h3>
                  {r.closed_at ? <Badge tone="good">{t(`Cerrada con acuse de ${r.closed_name ?? 's/d'}`, `Closed, signed off by ${r.closed_name ?? 'n/a'}`)}</Badge> : <Badge tone="warn">{t(`${r.pending} de ${r.total} por decidir`, `${r.pending} of ${r.total} to decide`)}</Badge>}
                </div>
                <ul className="mt-2">
                  {items.map((i) => (
                    <li key={i.id} className={row} data-testid="review-item">
                      <div className="min-w-0 basis-[220px]">
                        <p className="text-[15px] font-medium text-strong">{i.full_name}</p>
                        <p className={small}>{role(i.role)} · {i.last_active_at ? t(`último uso ${day(i.last_active_at, locale, tz)}`, `last used ${day(i.last_active_at, locale, tz)}`) : t('sin uso registrado', 'no use on record')}</p>
                      </div>
                      {canDecide && i.user_id !== ctx.user.id ? (
                        <ActionForm action={A.decideItemAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={i.id} /><input type="hidden" name="note" value="" />
                          {i.decision && <Badge tone={i.decision === 'keep' ? 'good' : 'bad'}>{i.decision === 'keep' ? t('Se mantiene', 'Stays') : t('Se quita', 'Goes')}</Badge>}
                          <Submit variant="ghost" size="sm" name="decision" value="keep" testId="review-keep">{t('Mantener', 'Keep')}</Submit>
                          <Submit variant="quiet" size="sm" name="decision" value="remove" testId="review-remove">{t('Quitar', 'Remove')}</Submit>
                        </ActionForm>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={i.decision === 'keep' ? 'good' : i.decision === 'remove' ? 'bad' : 'neutral'}>{i.decision === 'keep' ? t('Se mantiene', 'Stays') : i.decision === 'remove' ? t('Se quita', 'Goes') : i.user_id === ctx.user.id ? t('Tu acceso lo acusa otra persona', 'Someone else signs off yours') : t('Sin decidir', 'Undecided')}</Badge>
                          {i.decision === 'remove' && i.still_active && manage && (
                            <ActionForm action={A.removeReviewedAction}><input type="hidden" name="membership_id" value={i.membership_id} /><Submit variant="danger" size="sm" testId="review-execute">{t('Quitar el acceso ahora', 'Remove access now')}</Submit></ActionForm>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {canDecide && <ActionForm action={A.closeReviewAction} className="mt-3"><input type="hidden" name="id" value={r.id} /><Submit variant="ghost" testId="review-close">{t('Cerrar la revisión con mi acuse', 'Close the review with my sign-off')}</Submit></ActionForm>}
              </section>
            )
          })}
        </Card>
      )}

      {(manage || ctx.can('security.read')) && (
        <>
          <Card data-testid="unused-card">
            <CardTitle title={t(`Accesos sin uso en ${d.unusedDays} días`, `Access not used in ${d.unusedDays} days`)} hint={t('Personas con acceso vigente que no han entrado. Mientras la baja automática por el directorio de Google esté apagada, esta lista es el control: revisa y quita lo que ya no haga falta desde Personas y acceso.', 'People with current access who have not signed in. While automatic removal through the Google directory is off, this list is the control: review and remove what is no longer needed from People and access.')} right={<Badge tone={d.unused.length ? 'warn' : 'good'}>{num(d.unused.length, locale)}</Badge>} />
            {directoryMode() === 'off' && off(ctx, DIRECTORY_ENV, ['La baja automática cuando la cuenta de Google deja de existir está construida y apagada. Falta: la revisión técnica de la sincronización y una cuenta de servicio de solo lectura del directorio.', 'Automatic removal when the Google account stops existing is built and turned off. Missing: the technical review of the sync and a read-only service account for the directory.'])}
            {d.unused.length === 0 ? <p className={`${small} mt-4`}>{t('Todas las personas con acceso lo usaron en ese plazo.', 'Everyone with access used it in that period.')}</p> : (
              <ul className="mt-4" data-testid="unused-list">
                {d.unused.slice(0, 40).map((u) => <li key={u.user_id} className={row}><span className="text-[15px] font-medium text-strong">{u.full_name}</span><span className={small}>{u.last_active_at ? t(`último uso ${day(u.last_active_at, locale, tz)}`, `last used ${day(u.last_active_at, locale, tz)}`) : t('nunca ha entrado', 'never signed in')}</span></li>)}
              </ul>
            )}
            {manage && <p className="mt-4"><Link href="/admin?tab=personas" className="text-[14px] font-medium text-blue-text underline">{t('Ir a Personas y acceso', 'Go to People and access')}</Link></p>}
          </Card>

          <Card data-testid="seats-card">
            <CardTitle title={t('Asientos y quién los aprobó', 'Seats and who approved them')} hint={t('Cada acceso es un asiento. Aquí queda quién lo aprobó (quien tiene el presupuesto), cuándo y con qué referencia.', 'Every access is a seat. This records who approved it (the budget holder), when and with what reference.')} right={<Badge tone={d.seats.some((x) => !x.approver_name) ? 'warn' : 'good'}>{t(`${d.seats.filter((x) => !x.approver_name).length} sin aprobación registrada`, `${d.seats.filter((x) => !x.approver_name).length} with no approval on record`)}</Badge>} />
            <ul data-testid="seat-list">
              {d.seats.slice(0, 60).map((x) => (
                <li key={x.membership_id} className={row} data-testid="seat-row">
                  <div className="min-w-0 basis-[220px]">
                    <p className="text-[15px] font-medium text-strong">{x.full_name}</p>
                    <p className={small}>{role(x.role)}{x.market_code ? ` · ${x.market_code}` : ''} · {t(`desde ${day(x.since, locale, tz)}`, `since ${day(x.since, locale, tz)}`)}</p>
                  </div>
                  {x.approver_name ? <span className={small} data-testid="seat-approved">{t(`Aprobó ${x.approver_name} el ${x.approved_on}`, `Approved by ${x.approver_name} on ${x.approved_on}`)}{x.reference ? ` · ${x.reference}` : ''}</span> : manage ? (
                    <Dialog trigger={t('Registrar aprobación', 'Record approval')} title={t(`Aprobación del asiento de ${x.full_name}`, `Seat approval for ${x.full_name}`)} size="sm" testId="seat-open">
                      <ActionForm action={A.seatAction} onOk="close">
                        <input type="hidden" name="membership_id" value={x.membership_id} />
                        <Field label={t('Quién aprobó (quien tiene el presupuesto)', 'Who approved (the budget holder)')}><input name="approver_name" className="input" required minLength={2} maxLength={120} data-testid="seat-approver" /></Field>
                        <Field label={t('Fecha de aprobación', 'Approval date')} className="mt-4"><input type="date" name="approved_on" className="input" required max={today} defaultValue={today} data-testid="seat-date" /></Field>
                        <Field label={t('Referencia (opcional)', 'Reference (optional)')} hint={t('Dónde quedó la aprobación: un correo, un ticket, una minuta.', 'Where the approval lives: an email, a ticket, meeting notes.')} className="mt-4"><input name="reference" className="input" maxLength={200} data-testid="seat-ref" /></Field>
                        <div className="mt-5"><Submit testId="seat-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  ) : <Badge tone="warn">{t('Sin aprobación registrada', 'No approval on record')}</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {manage && (
        <>
          <Card data-testid="agencies-card">
            <CardTitle title={t('Agencias externas', 'External agencies')} hint={t('Una persona de agencia captura y trabaja leads, comercios y negocios, y solo ve lo que su agencia reclutó. No exporta, no fusiona, no reasigna y no toma lo de nadie. Todo lo que crea queda marcado con su agencia.', 'An agency user captures and works leads, merchants and deals, and only sees what their agency recruited. They do not export, merge, reassign or take anyone’s records. Everything they create is tagged with their agency.')} />
            <ActionForm action={A.createAgencyAction} onOk="reset" className="mb-6" testId="agency-form">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="agency-market">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                <Field label={t('Nombre de la agencia', 'Agency name')}><input name="name" className="input" required minLength={2} maxLength={80} data-testid="agency-name" /></Field>
                <Field label={t('Su embudo (opcional)', 'Its pipeline (optional)')} hint={t('Si lo eliges, sus negocios solo nacen ahí.', 'If you choose one, its deals are only created there.')}><select name="pipeline_id" className="input" defaultValue=""><option value="">{t('Cualquiera del mercado', 'Any in the market')}</option>{d.pipelines.map((p) => <option key={p.id} value={p.id}>{p.market_code} · {p.name}</option>)}</select></Field>
                <Field label={t('Su región (opcional)', 'Its region (optional)')} hint={t('Si la eliges, sus comercios nacen con ese territorio.', 'If you choose one, its merchants start with that territory.')}><select name="territory_id" className="input" defaultValue=""><option value="">{t('Sin región fija', 'No fixed region')}</option>{d.territories.map((p) => <option key={p.id} value={p.id}>{p.market_code} · {p.name}</option>)}</select></Field>
              </div>
              <div className="mt-4"><Submit variant="ghost" testId="agency-add">{t('Crear agencia', 'Create agency')}</Submit></div>
            </ActionForm>
            {d.agencies.length === 0 ? <Empty title={t('Todavía no hay agencias', 'No agencies yet')} hint={t('Crea la primera arriba y después dale acceso a su gente.', 'Create the first one above and then give its people access.')} /> : (
              <>
                <ul data-testid="agency-list">
                  {d.agencies.map((a) => <li key={a.id} className={row} data-testid="agency-row"><span className="text-[15px] font-semibold text-strong">{a.market_code} · {a.name}</span><span className={small}>{[a.pipeline, a.territory].filter(Boolean).join(' · ') || t('sin embudo ni región fijos', 'no fixed pipeline or region')} · {t(`${a.people} personas, ${a.accounts} comercios, ${a.leads} leads`, `${a.people} people, ${a.accounts} merchants, ${a.leads} leads`)}</span></li>)}
                </ul>
                <ActionForm action={A.grantAgencyAction} onOk="reset" className="mt-6 border-t border-line pt-6" testId="agency-grant-form">
                  <h3 className="mb-3 text-[16px] font-semibold">{t('Dar acceso a una persona de agencia', 'Give access to an agency user')}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('Agencia', 'Agency')}><select name="agency_id" className="input" data-testid="agency-grant-agency">{d.agencies.map((a) => <option key={a.id} value={a.id}>{a.market_code} · {a.name}</option>)}</select></Field>
                    <Field label={t('Correo', 'Email')}><input name="email" type="email" className="input" required data-testid="agency-grant-email" /></Field>
                    <Field label={t('Nombre completo', 'Full name')}><input name="full_name" className="input" required minLength={2} maxLength={120} data-testid="agency-grant-name" /></Field>
                    <Field label={t('Vence el (opcional)', 'Expires on (optional)')}><input name="expires" type="date" className="input" min={today} /></Field>
                  </div>
                  <div className="mt-4"><Submit variant="ghost" testId="agency-grant">{t('Dar acceso', 'Give access')}</Submit></div>
                </ActionForm>
              </>
            )}
          </Card>

          <Card data-testid="hierarchy-card">
            <CardTitle title={t('Jerarquía de supervisión', 'Team reporting lines')} hint={t('Un equipo puede colgar de otro. Quien supervisa el de arriba ve también lo que llevan los equipos de abajo, a cualquier profundidad.', 'A team can report to another. Whoever supervises the upper one also sees what the teams below carry, at any depth.')} />
            {d.teams.length === 0 ? <Empty title={t('Todavía no hay equipos', 'No teams yet')} hint={t('Los equipos se crean en Personas y acceso.', 'Teams are created in People and access.')} /> : (
              <ul data-testid="team-tree">
                {d.teams.map((team) => (
                  <li key={team.id} className={row} data-testid="team-row">
                    <span className="min-w-0 basis-[200px] text-[15px] font-medium text-strong">{team.market_code} · {team.name}</span>
                    <ActionForm action={A.teamParentAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="team_id" value={team.id} />
                      <label className="sr-only" htmlFor={`parent-${team.id}`}>{t(`De qué equipo cuelga ${team.name}`, `Which team ${team.name} reports to`)}</label>
                      <select id={`parent-${team.id}`} name="parent_id" className="input w-auto min-w-0" defaultValue={team.parent_team_id ?? ''} data-testid="team-parent">
                        <option value="">{t('No cuelga de otro', 'Reports to no team')}</option>
                        {d.teams.filter((x) => x.market_code === team.market_code && x.id !== team.id).map((x) => <option key={x.id} value={x.id}>{t(`Cuelga de ${x.name}`, `Reports to ${x.name}`)}</option>)}
                      </select>
                      <Submit variant="ghost" size="sm" testId="team-parent-save">{t('Guardar', 'Save')}</Submit>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="entity-card">
            <CardTitle title={t('Alcance por entidad legal', 'Scope by legal entity')} hint={t('Limita un rol de mercado a los comercios de una entidad legal. Los comercios sin entidad legal siguen a la vista.', 'Limits a market role to the merchants of one legal entity. Merchants with no legal entity stay visible.')} />
            {d.entities.length === 0 ? <Empty title={t('No hay entidades legales cargadas', 'No legal entities loaded')} hint={t('Cuando existan, aquí se elige a quién se limita a cuál.', 'Once they exist, this is where you choose who is limited to which.')} /> : (
              <ul data-testid="entity-list">
                {d.scoped.slice(0, 80).map((m) => (
                  <li key={m.membership_id} className={row}>
                    <span className="min-w-0 basis-[220px] text-[15px] font-medium text-strong">{m.full_name} <span className="font-normal text-muted">· {role(m.role)} · {m.market_code}</span></span>
                    <ActionForm action={A.entityAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <label className="sr-only" htmlFor={`ent-${m.membership_id}`}>{t(`Entidad legal de ${m.full_name}`, `Legal entity for ${m.full_name}`)}</label>
                      <select id={`ent-${m.membership_id}`} name="legal_entity_id" className="input w-auto min-w-0" defaultValue={m.legal_entity_id ?? ''} data-testid="entity-select">
                        <option value="">{t('Todo el mercado', 'Whole market')}</option>
                        {d.entities.filter((e) => e.market_code === m.market_code).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                      <Submit variant="ghost" size="sm" testId="entity-save">{t('Guardar', 'Save')}</Submit>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

async function Privacy({ ctx, tz }: P) {
  const { t, locale } = ctx
  const d = await getPrivacy(ctx)
  const manage = ctx.can('security.manage')
  const config = ctx.can('config.manage')
  const today = isoDay(new Date(), tz)
  const live = ctx.markets.filter((m) => m.status === 'live')
  const mon = manage ? await getMonitoring(ctx) : null
  const roles: Role[] = ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'partner']
  return (
    <div className="space-y-8" data-testid="security-privacy">
      <Card data-testid="sensitive-card">
        <CardTitle title={t('Campos reservados', 'Restricted fields')} hint={t('Viven en una tabla aparte de la ficha y se muestran tapados. Verlos pide un motivo y queda en la bitácora. Aquí se decide qué rol los ve y cuál los edita. Tarjetas, cuentas bancarias e identificaciones completas siguen sin guardarse en ningún campo.', 'They live in a table apart from the merchant record and show masked. Seeing them asks for a reason and is logged. This is where you decide which role sees them and which edits them. Cards, bank accounts and full IDs are still not stored in any field.')} />
        {fieldCryptoMode() === 'off' && off(ctx, FIELD_CRYPTO_ENV, ['El cifrado por campo con llaves gestionadas está construido y apagado. Falta: el mecanismo aprobado en la revisión técnica y el gestor de llaves de la plataforma de producción. Mientras tanto protegen el permiso, la tabla aparte y el revelado registrado.', 'Field encryption with managed keys is built and turned off. Missing: the mechanism approved in the technical review and the production platform’s key manager. Meanwhile the permission, the separate table and the logged reveal protect them.'])}
        <ul className="mt-4" data-testid="sensitive-fields">
          {d.fields.map((f) => (
            <li key={f.key} className="border-t border-line py-5 first:border-t-0" data-testid="sensitive-field">
              <ActionForm action={A.sensitiveFieldAction}>
                <input type="hidden" name="key" value={f.key} />
                <fieldset disabled={!config}>
                  <legend className="text-[15px] font-semibold text-strong">{t(f.label_es, f.label_en)} {!f.is_active && <Badge>{t('apagado', 'off')}</Badge>}</legend>
                  <p className={`${small} mt-2`}>{t('Lo ven', 'Seen by')}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {roles.map((r) => <label key={r} className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="view" value={r} defaultChecked={f.view_roles.includes(r)} className="h-4 w-4" />{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</label>)}
                    <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="owner_view" defaultChecked={f.owner_can_view} className="h-4 w-4" />{t('Quien lleva la cuenta', 'The account owner')}</label>
                  </div>
                  <p className={`${small} mt-2`}>{t('Lo editan', 'Edited by')}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {(['admin', 'market_lead', 'supervisor', 'rep', 'ops'] as Role[]).map((r) => <label key={r} className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="edit" value={r} defaultChecked={f.edit_roles.includes(r)} className="h-4 w-4" />{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</label>)}
                    <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="owner_edit" defaultChecked={f.owner_can_edit} className="h-4 w-4" />{t('Quien lleva la cuenta', 'The account owner')}</label>
                    <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="active" defaultChecked={f.is_active} className="h-4 w-4" />{t('Campo en uso', 'Field in use')}</label>
                  </div>
                </fieldset>
                {config && <div className="mt-2"><Submit variant="ghost" size="sm" testId="sensitive-field-save">{t('Guardar', 'Save')}</Submit></div>}
              </ActionForm>
            </li>
          ))}
        </ul>
        {config && (
          <ActionForm action={A.createSensitiveFieldAction} onOk="reset" className="mt-4 border-t border-line pt-5" testId="sensitive-new">
            <h3 className="mb-3 text-[16px] font-semibold">{t('Nuevo campo reservado', 'New restricted field')}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('Clave', 'Key')} hint={t('Minúsculas y guion bajo', 'Lowercase and underscore')}><input name="key" className="input" required pattern="[a-z][a-z0-9_]{2,40}" /></Field>
              <Field label={t('Nombre en español', 'Name in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={60} /></Field>
              <Field label={t('Nombre en inglés', 'Name in English')}><input name="label_en" className="input" required minLength={2} maxLength={60} /></Field>
            </div>
            <div className="mt-4"><Submit variant="ghost">{t('Crear campo', 'Create field')}</Submit></div>
          </ActionForm>
        )}
      </Card>

      <Card data-testid="retention-card">
        <CardTitle title={t('Retención', 'Retention')} hint={t('Qué se anonimiza o se archiva y a los cuántos días. El plazo lo define Legal: una regla sin plazo no se puede encender. Antes de aplicar, la vista previa dice cuántos registros tocaría. La bitácora conserva el hecho; el dato personal se va.', 'What is anonymized or archived and after how many days. Legal defines the period: a rule with no period cannot be turned on. Before applying, the preview says how many records it would touch. The log keeps the fact; the personal data goes.')} />
        <ul data-testid="retention-list">
          {d.rules.map((r) => {
            const pv = d.previews[r.key]
            return (
              <li key={r.key} className="border-t border-line py-5 first:border-t-0" data-testid="retention-rule">
                <p className="text-[15px] font-semibold text-strong">{t(r.label_es, r.label_en)} {r.is_active ? <Badge tone="good">{t('encendida', 'on')}</Badge> : <Badge>{t('apagada', 'off')}</Badge>}</p>
                <p className={small} data-testid="retention-preview">
                  {r.after_days === null ? t('Plazo por definir con Legal.', 'Period to be defined with Legal.') : pv ? t(`Vista previa: hoy tocaría ${num(pv.total, locale)} ${pv.total === 1 ? 'registro' : 'registros'}${pv.sample.length ? `, por ejemplo: ${pv.sample.slice(0, 3).map((x) => x.label).join(', ')}` : ''}.`, `Preview: today it would touch ${num(pv.total, locale)} ${pv.total === 1 ? 'record' : 'records'}${pv.sample.length ? `, for example: ${pv.sample.slice(0, 3).map((x) => x.label).join(', ')}` : ''}.`) : t(`Plazo: ${r.after_days} días.`, `Period: ${r.after_days} days.`)}
                  {r.last_run_at ? ` ${t(`Última corrida: ${dayTime(r.last_run_at, locale, tz)}, ${r.last_done ?? 0} registros.`, `Last run: ${dayTime(r.last_run_at, locale, tz)}, ${r.last_done ?? 0} records.`)}` : ''}
                </p>
                {manage && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <ActionForm action={A.retentionAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="key" value={r.key} />
                      <Field label={t('Días', 'Days')} className="basis-28"><input name="after_days" type="number" min={30} max={3650} defaultValue={r.after_days ?? ''} className="input" data-testid="retention-days" /></Field>
                      <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="active" defaultChecked={r.is_active} className="h-4 w-4" data-testid="retention-active" />{t('Encendida', 'On')}</label>
                      <Submit variant="ghost" testId="retention-save">{t('Guardar', 'Save')}</Submit>
                    </ActionForm>
                    {r.is_active && <ActionForm action={A.applyRetentionAction}><input type="hidden" name="key" value={r.key} /><Submit variant="quiet" testId="retention-apply">{t('Aplicar ahora', 'Apply now')}</Submit></ActionForm>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      <Card data-testid="requests-card">
        <CardTitle title={t('Solicitudes de titulares', 'Data subject requests')} hint={t('Cuando una persona pide ver, corregir o eliminar sus datos. Cada solicitud lleva país, plazo, quién la atiende y cómo se cerró. Eliminar anonimiza: se va el dato personal y se conservan los IDs, los montos y quién hizo qué.', 'When a person asks to see, correct or erase their data. Each request has a country, a deadline, who handles it and how it was closed. Erasing anonymizes: the personal data goes and the IDs, amounts and who did what stay.')} />
        {manage && (
          <>
            <div className="mb-5 flex flex-wrap gap-3" data-testid="due-days">
              {live.map((m) => (
                <ActionForm key={m.code} action={A.dueDaysAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="market" value={m.code} />
                  <Field label={t(`Plazo en ${m.name} (días)`, `Deadline in ${m.name} (days)`)} hint={mon?.dueDays[m.code] ? undefined : t('Por definir con Legal', 'To be defined with Legal')} className="basis-52"><input name="days" type="number" min={1} max={365} defaultValue={mon?.dueDays[m.code] ?? ''} className="input" data-testid={`due-${m.code}`} /></Field>
                  <Submit variant="ghost" size="sm" testId={`due-save-${m.code}`}>{t('Guardar', 'Save')}</Submit>
                </ActionForm>
              ))}
            </div>
            <Dialog trigger={t('Registrar solicitud', 'Record a request')} title={t('Nueva solicitud', 'New request')} testId="request-open">
              <ActionForm action={A.createRequestAction} onOk="close">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('País', 'Country')}><select name="market" className="input" data-testid="request-market">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                  <Field label={t('Qué pide', 'What they ask')}><select name="kind" className="input" data-testid="request-kind">{REQUEST_KINDS.map((k) => <option key={k} value={k}>{t(REQUEST_KIND[k]?.[0] ?? k, REQUEST_KIND[k]?.[1] ?? k)}</option>)}</select></Field>
                  <Field label={t('Nombre de la persona', 'Person’s name')}><input name="subject_name" className="input" required minLength={2} maxLength={160} data-testid="request-name" /></Field>
                  <Field label={t('Llegó el', 'Arrived on')}><input name="received_on" type="date" className="input" required max={today} defaultValue={today} data-testid="request-date" /></Field>
                </div>
                <Field label={t('Cómo contactarla (opcional)', 'How to reach them (optional)')} className="mt-4"><input name="subject_contact" className="input" maxLength={200} /></Field>
                <Field label={t('ID del contacto en CONTIGO (opcional)', 'Contact ID in CONTIGO (optional)')} hint={t('Se puede ligar después. Sin contacto o lead ligado no se puede exportar ni anonimizar.', 'It can be linked later. Without a linked contact or lead nothing can be exported or anonymized.')} className="mt-4"><input name="contact_id" className="input" pattern="[0-9a-fA-F-]{36}" data-testid="request-contact" /></Field>
                <Field label={t('ID del lead (opcional)', 'Lead ID (optional)')} className="mt-4"><input name="lead_id" className="input" pattern="[0-9a-fA-F-]{36}" data-testid="request-lead" /></Field>
                <Field label={t('Detalle (opcional)', 'Detail (optional)')} className="mt-4"><textarea name="detail" className="input min-h-20" maxLength={1500} /></Field>
                <div className="mt-5"><Submit testId="request-save">{t('Registrar', 'Record')}</Submit></div>
              </ActionForm>
            </Dialog>
          </>
        )}
        {d.requests.length === 0 ? <div className="mt-5"><Empty title={t('Sin solicitudes', 'No requests')} hint={t('Cuando llegue una, regístrala aquí el mismo día: el plazo corre desde que llegó.', 'When one arrives, record it here the same day: the deadline runs from when it arrived.')} /></div> : (
          <ul className="mt-5" data-testid="request-list">
            {d.requests.map((r) => {
              const open = r.status === 'received' || r.status === 'in_progress'
              return (
                <li key={r.id} className="border-t border-line py-5 first:border-t-0" data-testid="request-row">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[15px] font-semibold text-strong">{r.subject_name} · {t(REQUEST_KIND[r.kind]?.[0] ?? r.kind, REQUEST_KIND[r.kind]?.[1] ?? r.kind)} · {r.market_code}</p>
                    <span className="flex flex-wrap gap-2">
                      <Badge tone={open ? (r.overdue ? 'bad' : 'warn') : 'neutral'}>{t(REQUEST_STATUS[r.status]?.[0] ?? r.status, REQUEST_STATUS[r.status]?.[1] ?? r.status)}</Badge>
                      {r.anonymized_at && <Badge tone="good">{t('Anonimizada', 'Anonymized')}</Badge>}
                    </span>
                  </div>
                  <p className={small}>{t(`Llegó el ${r.received_on}`, `Arrived ${r.received_on}`)} · {r.due_on ? t(`vence el ${r.due_on}${r.overdue ? ' (vencida)' : ''}`, `due ${r.due_on}${r.overdue ? ' (overdue)' : ''}`) : t('plazo por definir con Legal', 'deadline to be defined with Legal')} · {t(`atiende ${r.assignee ?? 's/d'}`, `handled by ${r.assignee ?? 'n/a'}`)}{r.resolution ? ` · ${r.resolution}` : ''}</p>
                  {manage && open && (
                    <div className="mt-3 flex flex-wrap items-start gap-3">
                      <Dialog trigger={t('Actualizar', 'Update')} title={t(`Solicitud de ${r.subject_name}`, `Request from ${r.subject_name}`)} size="sm" testId="request-update-open">
                        <ActionForm action={A.updateRequestAction} onOk="close">
                          <input type="hidden" name="id" value={r.id} />
                          <Field label={t('Estado', 'Status')}><select name="status" className="input" defaultValue={r.status === 'received' ? 'in_progress' : r.status} data-testid="request-status">{(['in_progress', 'done', 'rejected'] as const).map((k) => <option key={k} value={k}>{t(REQUEST_STATUS[k]![0], REQUEST_STATUS[k]![1])}</option>)}</select></Field>
                          <Field label={t('Qué se hizo o por qué no procede', 'What was done or why it does not apply')} className="mt-4"><textarea name="resolution" className="input min-h-20" maxLength={1500} defaultValue={r.resolution ?? ''} data-testid="request-resolution" /></Field>
                          <div className="mt-5"><Submit testId="request-update-save">{t('Guardar', 'Save')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                      {r.linked && <a href={`/admin/seguridad/titular/${r.id}`} className={buttonClass('ghost')} data-testid="request-export">{t('Descargar sus datos', 'Download their data')}</a>}
                      {r.linked && r.kind === 'erasure' && r.status === 'in_progress' && !r.anonymized_at && (
                        <Dialog trigger={t('Anonimizar', 'Anonymize')} title={t(`Anonimizar a ${r.subject_name}`, `Anonymize ${r.subject_name}`)} variant="danger" testId="request-anon-open">
                          <ActionForm action={A.anonymizeAction} onOk="close">
                            <input type="hidden" name="id" value={r.id} />
                            <p className="text-[14px] text-strong">{t('Se borran el nombre, el teléfono, el correo y el mensaje de esta persona, también dentro de la bitácora. Se conservan los IDs, los montos, las fechas y quién hizo qué. No se puede deshacer.', 'This person’s name, phone, email and message are erased, inside the log too. IDs, amounts, dates and who did what are kept. It cannot be undone.')}</p>
                            <Field label={t('Para confirmar escribe ANONIMIZAR', 'To confirm type ANONYMIZE')} className="mt-4"><input name="confirm" className="input" required data-testid="request-anon-confirm" /></Field>
                            <div className="mt-5"><Submit variant="danger" testId="request-anon-save">{t('Anonimizar', 'Anonymize')}</Submit></div>
                          </ActionForm>
                        </Dialog>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card data-testid="suppressions-card">
        <CardTitle title={t('Bajas registradas', 'Opt-outs on record')} hint={t('Una dirección dada de baja no recibe nada por ese canal: todo envío a un contacto pregunta aquí antes de salir. Las bajas se registran desde la ficha del comercio.', 'An address that opted out gets nothing on that channel: every send to a contact checks here before going out. Opt-outs are recorded from the merchant record.')} />
        {d.suppressions.length === 0 ? <Empty title={t('Sin bajas', 'No opt-outs')} hint={t('Cuando alguien pida no ser contactado, regístralo en la ficha del comercio, en "Equipo y datos reservados".', 'When someone asks not to be contacted, record it on the merchant record, under "Team and restricted data".')} /> : (
          <ul data-testid="suppression-list">
            {d.suppressions.map((x) => <li key={x.id} className={row}><span className="text-[14px] text-strong">{x.market_code} · {t(CHANNEL_LABEL[x.channel]?.[0] ?? x.channel, CHANNEL_LABEL[x.channel]?.[1] ?? x.channel)} · {mask(x.address_norm)}</span><span className={small}>{day(x.created_at, locale, tz)}{x.lifted_at ? ` · ${t('levantada', 'lifted')}` : ''}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** Una dirección dada de baja se muestra a medias: alcanza para reconocerla, no para copiarla. */
const mask = (a: string) => (a.includes('@') ? `${a.slice(0, 2)}•••@${a.split('@')[1]}` : a.length > 4 ? `•••${a.slice(-4)}` : a)

async function Keys({ ctx, tz }: P) {
  const { t, locale } = ctx
  const d = await getKeys(ctx)
  if (!d) notFound()
  const manage = ctx.can('integration.operate')
  const today = isoDay(new Date(), tz)
  return (
    <div className="space-y-8" data-testid="security-keys">
      <Card data-testid="keys-card">
        <CardTitle title={t('Llaves de API', 'API keys')} hint={t('El inventario de llaves: quién responde por cada una, cuándo vence, cuándo se usó por última vez y de cuál salió por rotación. Aquí se les pone responsable y vencimiento; se crean, se rotan y se revocan en Integraciones. Nunca se muestra el valor.', 'The key inventory: who owns each one, when it expires, when it was last used and which key it replaced. Set the owner and the expiry here; keys are created, rotated and revoked in Integrations. The value is never shown.')} />
        {d.keys.length === 0 ? <Empty title={t('Todavía no hay llaves', 'No keys yet')} hint={t('Se crean en Administración, Integraciones.', 'They are created in Administration, Integrations.')} /> : (
          <ul data-testid="key-list">
            {d.keys.map((k) => (
              <li key={k.id} className="border-t border-line py-5 first:border-t-0" data-testid="key-row">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[15px] font-semibold text-strong">{k.name} <code className="ml-1 text-[12px] font-normal text-muted">{k.key_prefix}…</code></p>
                  <Badge tone={k.revoked_at ? 'neutral' : k.expired ? 'bad' : 'good'}>{k.revoked_at ? t('Revocada', 'Revoked') : k.expired ? t('Vencida', 'Expired') : t('Vigente', 'Active')}</Badge>
                </div>
                <p className={small} data-testid="key-meta">{k.scopes.join(', ')} · {t(`responsable: ${k.owner ?? 'sin responsable'}`, `owner: ${k.owner ?? 'nobody yet'}`)} · {k.expires ? t(`vence el ${k.expires}`, `expires ${k.expires}`) : t('sin vencimiento', 'no expiry')} · {k.retires ? t(`se retira el ${k.retires} por rotación · `, `retires ${k.retires} after rotation · `) : ''}{k.rotated_from ? t('salió de una rotación · ', 'came from a rotation · ') : ''}{k.last_used_at ? t(`último uso ${dayTime(k.last_used_at, locale, tz)}`, `last used ${dayTime(k.last_used_at, locale, tz)}`) : t('sin uso', 'never used')}</p>
                {manage && !k.revoked_at && !k.expired && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <ActionForm action={A.keyMetaAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={k.id} />
                      <Field label={t('Responsable', 'Owner')} className="basis-52"><select name="owner_id" className="input" defaultValue={k.owner_id ?? ''} data-testid="key-owner"><option value="">{t('Sin responsable', 'Nobody yet')}</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
                      <Field label={t('Vence el', 'Expires on')} className="basis-44"><input type="date" name="expires" className="input" min={today} defaultValue={k.expires ?? ''} data-testid="key-expires" /></Field>
                      <Submit variant="ghost" testId="key-save">{t('Guardar', 'Save')}</Submit>
                    </ActionForm>
                    <Link href="/admin/integraciones" className={buttonClass('quiet')} data-testid="key-rotate-link">{t('Rotar o revocar en Integraciones', 'Rotate or revoke in Integrations')}</Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="secrets-card">
        <CardTitle title={t('Inventario de secretos de salida', 'Outbound secrets inventory')} hint={t('Lo que CONTIGO usa para conectarse hacia afuera. Aquí vive el nombre, quién responde por ella y la rotación; el valor nunca se guarda ni se muestra en CONTIGO: vive en la plataforma donde corre.', 'What CONTIGO uses to connect outward. This holds the name, the owner and the rotation; the value is never stored or shown in CONTIGO: it lives in the platform it runs on.')} />
        <ul data-testid="secret-list">
          {d.secrets.map((x) => (
            <li key={x.key} className="border-t border-line py-5 first:border-t-0" data-testid="secret-row">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[15px] font-semibold text-strong">{t(x.label_es, x.label_en)} <code className="ml-1 text-[12px] font-normal text-muted">{x.key}</code></p>
                <span className="flex flex-wrap gap-2"><Badge tone={x.configured ? 'good' : 'neutral'}>{x.configured ? t('Configurada en este ambiente', 'Set in this environment') : t('Sin configurar aquí', 'Not set here')}</Badge>{x.due && <Badge tone="bad">{t('Rotación vencida', 'Rotation overdue')}</Badge>}</span>
              </div>
              <p className={small}>{x.system_name} · {t(`responsable: ${x.owner ?? 'sin responsable'}`, `owner: ${x.owner ?? 'nobody yet'}`)} · {x.rotate_every_days ? t(`se rota cada ${x.rotate_every_days} días`, `rotated every ${x.rotate_every_days} days`) : t('sin rotación definida', 'no rotation defined')} · {x.last_rotated_on ? t(`última rotación ${x.last_rotated_on}`, `last rotated ${x.last_rotated_on}`) : t('última rotación sin registrar', 'last rotation not recorded')}</p>
              {manage && (
                <ActionForm action={A.secretMetaAction} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="key" value={x.key} /><input type="hidden" name="note" value={x.note ?? ''} />
                  <Field label={t('Responsable', 'Owner')} className="basis-52"><select name="owner_id" className="input" defaultValue={x.owner_id ?? ''} data-testid="secret-owner"><option value="">{t('Sin responsable', 'Nobody yet')}</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
                  <Field label={t('Rotar cada (días)', 'Rotate every (days)')} className="basis-36"><input name="rotate_every_days" type="number" min={1} max={730} defaultValue={x.rotate_every_days ?? ''} className="input" data-testid="secret-days" /></Field>
                  <Field label={t('Última rotación', 'Last rotation')} className="basis-44"><input name="last_rotated_on" type="date" max={today} defaultValue={x.last_rotated_on ?? ''} className="input" data-testid="secret-date" /></Field>
                  <Submit variant="ghost" testId="secret-save">{t('Guardar', 'Save')}</Submit>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-muted-2">{t('La rotación automática con un gestor de secretos depende de la plataforma de producción. Hasta entonces, este inventario avisa cuando una rotación se pasa de su fecha.', 'Automatic rotation with a secrets manager depends on the production platform. Until then, this inventory raises an alert when a rotation is past its date.')}</p>
      </Card>
    </div>
  )
}

async function DbLog({ ctx, tz, which, via }: P & { which: 'data' | 'config'; via: string }) {
  const { t, locale } = ctx
  const rows = await getDbLog(ctx, which, via || null)
  const ops: Record<string, [string, string]> = { I: ['Alta', 'Insert'], U: ['Cambio', 'Update'], D: ['Borrado', 'Delete'], T: ['Vaciado', 'Truncate'] }
  return (
    <div className="space-y-6" data-testid="security-dblog">
      <p className="text-[14px] text-muted-2">{t('Esta bitácora la escribe la base de datos, no la aplicación: registra cada cambio con la tabla, la fila, las columnas, quién y por dónde entró. Los detalles legibles de cada acción siguen en Auditoría.', 'The database writes this log, not the application: it records every change with the table, the row, the columns, who and through which channel. The readable detail of each action is still in Audit.')}</p>
      <Pills label={t('Qué bitácora', 'Which log')} current={which} items={[{ key: 'data', href: qs('/admin/seguridad', { s: 'bitacora', log: 'data', via }), label: t('Datos', 'Data') }, { key: 'config', href: qs('/admin/seguridad', { s: 'bitacora', log: 'config', via }), label: t('Configuración', 'Configuration') }]} />
      <Pills label={t('Por dónde entró', 'Channel')} current={via} items={[{ key: '', href: qs('/admin/seguridad', { s: 'bitacora', log: which }), label: t('Todas las vías', 'All channels') }, ...Object.entries(VIA_LABEL).map(([k, v]) => ({ key: k, href: qs('/admin/seguridad', { s: 'bitacora', log: which, via: k }), label: t(v[0], v[1]) }))]} />
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-7"><Empty title={t('Sin filas con ese filtro', 'No rows for that filter')} hint={t('Prueba con otra vía o con la otra bitácora.', 'Try another channel or the other log.')} /></div> : (
          <ul className="px-5 md:px-7" data-testid="dblog-list">
            {rows.map((r) => (
              <li key={r.id} className={row} data-testid="dblog-row">
                <div className="min-w-0 flex-1 basis-[260px]">
                  <p className="text-[14.5px] font-medium text-strong">{t(ops[r.op]?.[0] ?? r.op, ops[r.op]?.[1] ?? r.op)} · <code className="text-[13px]">{r.table_name}</code>{r.market_code ? ` · ${r.market_code}` : ''}</p>
                  <p className={`${small} [overflow-wrap:anywhere]`}>{r.changed?.length ? `${t('Columnas', 'Columns')}: ${r.changed.join(', ')}` : r.row_id ?? 's/d'}{r.redacted ? ` · ${t('datos personales anonimizados', 'personal data anonymized')}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-[13.5px] text-strong">{r.actor ?? (r.via === 'sql' ? t(`SQL directo (${r.db_role})`, `Direct SQL (${r.db_role})`) : 's/d')}</p>
                  <p className={small}><Badge tone={r.via === 'sql' ? 'warn' : 'neutral'}>{t(VIA_LABEL[r.via]?.[0] ?? r.via, VIA_LABEL[r.via]?.[1] ?? r.via)}</Badge> {dayTime(r.at, locale, tz)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
