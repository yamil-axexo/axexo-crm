import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { env } from '@/env'
import { getApiAdmin, getEventsAdmin, getExports, getFormsAdmin, getImports, getSalesAppAdmin } from '@/dal/eventos-api'
import { eventCatalog, eventExample, eventSchema, silentActions } from '@/domain/events/catalog'
import { FIELD_MATRIX, INBOUND_EVENTS, OWNER_LABEL, stuckReason } from '@/domain/events/sales-app-contract'
import { API_ERRORS, API_PAGE, API_RESOURCES, CATALOGS, READ_SCOPES } from '@/domain/api-spec'
import { API_SCOPES } from '@/domain/admin'
import { ROTATION_DAYS } from '@/domain/api-keys'
import { BACKOFF_MINUTES, MAX_ATTEMPTS } from '@/domain/publisher'
import { EXPORT_CAPS, EXPORT_DAILY } from '@/domain/exports'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { deliveryMode, signingKey } from '@/server/adapters/event-delivery'
import { antibotMode } from '@/server/adapters/antibot'
import { LIMITS, defaultMinFillSeconds } from '@/server/protect'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, RevealOnce, Submit } from '@/ui/client'
import { CloseDialog, NoticeArea } from '@/ui/admin'
import { ago, day, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { createApiKeyAction, createSubscriberAction, publishNowAction, replayInboundAction, resendDeliveryAction, rotateApiKeyAction, rotateSubscriberAction, setFormLimitsAction, simulateContractAction, subscriberStatusAction } from './actions'
import { revokeApiClientAction } from '../actions'

const TABS = ['eventos', 'api', 'sales-app', 'formularios', 'datos'] as const
type Tab = (typeof TABS)[number]

/** Administración > Integraciones: eventos que salen, API de lectura, contrato con la Sales App, formularios públicos y datos que entran o salen por archivo. */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('integration.operate')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'eventos'
  const labels: Record<Tab, string> = {
    eventos: t('Eventos que salen', 'Outgoing events'), api: t('API de lectura', 'Read API'), 'sales-app': t('Contrato con la Sales App', 'Sales App contract'),
    formularios: t('Formularios públicos', 'Public forms'), datos: t('Importar y exportar', 'Import and export'),
  }
  const live = ctx.markets.filter((m) => m.status === 'live')
  const close = t('Cerrar aviso', 'Dismiss notice')
  const off = (on: boolean) => <Badge tone={on ? 'warn' : 'neutral'}>{on ? t('Simulado (pruebas)', 'Simulated (tests)') : t('Canal apagado', 'Channel off')}</Badge>
  const code = 'rounded bg-surface-3 px-1.5 py-0.5 text-[12.5px] text-strong'
  const pre = 'mt-2 max-h-72 overflow-auto rounded-[12px] bg-surface-3 p-3 text-[12px] leading-5 text-strong'

  return (
    <>
      <p className="mb-3"><Link href="/admin?tab=integraciones" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="integrations-back">{t('Volver a Administración', 'Back to Administration')}</Link></p>
      <PageHeader eyebrow={t('Administración', 'Administration')} title={t('Eventos, API y datos', 'Events, API and data')}
        desc={t('Lo que CONTIGO le avisa a otros sistemas, lo que les deja leer, lo que recibe de la Sales App y lo que entra o sale por archivo. Nada se conecta hacia afuera sin aprobación: los canales están apagados y aquí se ve qué falta para encenderlos.', 'What CONTIGO tells other systems, what it lets them read, what it receives from the Sales App and what comes in or goes out by file. Nothing connects outward without approval: the channels are off and this page shows what it takes to turn them on.')} />
      <div className="mb-8"><Pills label={t('Secciones', 'Sections')} current={tab} items={TABS.map((k) => ({ key: k, href: qs('/admin/integraciones', { tab: k }), label: labels[k] }))} /></div>
      <NoticeArea closeLabel={close}>
        {tab === 'eventos' && <Events />}
        {tab === 'api' && <Api />}
        {tab === 'sales-app' && <SalesApp />}
        {tab === 'formularios' && <Forms />}
        {tab === 'datos' && <Data />}
      </NoticeArea>
    </>
  )

  async function Events() {
    const d = await getEventsAdmin(ctx)
    const catalog = eventCatalog()
    const silent = silentActions()
    const mode = deliveryMode()
    const st: Record<string, [string, string, 'good' | 'warn' | 'bad' | 'neutral']> = { ready: ['lista para publicar', 'ready to publish', 'neutral'], retrying: ['en reintento', 'retrying', 'warn'], dead: ['mensaje muerto', 'dead letter', 'bad'], delivered: ['entregada', 'delivered', 'good'] }
    return (
      <div className="space-y-8" data-testid="events-tab">
        <div className="rounded-[22px] bg-surface-3 px-6 py-5 text-[14px] text-muted-2" data-testid="events-status">
          <p className="flex flex-wrap items-center gap-3"><strong className="text-strong">{t('Entrega a suscriptores', 'Delivery to subscribers')}</strong>{off(mode === 'simulated')}</p>
          <p className="mt-2">{mode === 'off'
            ? t('Cada cambio guarda su evento en la misma operación y queda listo para publicar. Hoy nada sale de CONTIGO. Para encender el canal hace falta: 1) aprobación del transporte en Tech Implementation Review, 2) la llave de firma del servidor y 3) activar la variable CONTIGO_EVENT_DELIVERY.', 'Every change stores its event in the same operation and it stays ready to publish. Today nothing leaves CONTIGO. Turning the channel on takes: 1) approval of the transport in Tech Implementation Review, 2) the server signing key and 3) setting the CONTIGO_EVENT_DELIVERY variable.')
            : t('Modo de pruebas: las entregas se simulan dentro de este ambiente y nada sale a internet.', 'Test mode: deliveries are simulated inside this environment and nothing goes to the internet.')}</p>
          <p className="mt-2" data-testid="events-totals">{t(`${num(d.totals.events, locale)} eventos guardados de ${num(d.totals.types, locale)} tipos${d.totals.last_at ? `; el último, ${ago(d.totals.last_at, locale)}` : ''}. Llave de firma: ${signingKey() ? 'presente' : 'falta'}.`, `${num(d.totals.events, locale)} events stored across ${num(d.totals.types, locale)} types${d.totals.last_at ? `; the latest, ${ago(d.totals.last_at, locale)}` : ''}. Signing key: ${signingKey() ? 'present' : 'missing'}.`)}</p>
        </div>

        <Card data-testid="subscribers">
          <CardTitle title={t('Suscriptores', 'Subscribers')} hint={t('Cada suscriptor recibe solo los eventos que pidió, de su mercado, firmados con su secreto. El secreto no se guarda en la base: se muestra aquí cuando lo creas o lo rotas.', 'Each subscriber gets only the events it asked for, from its market, signed with its secret. The secret is not stored in the database: it is shown here when you create or rotate it.')} />
          {d.subscribers.length === 0 ? <Empty title={t('Todavía no hay suscriptores', 'No subscribers yet')} hint={t('Da de alta el primero abajo. Mientras el canal esté apagado, sus eventos se van juntando listos para publicar.', 'Add the first one below. While the channel is off, its events pile up ready to publish.')} /> : (
            <ul className="divide-y divide-line">
              {d.subscribers.map((s) => (
                <li key={s.id} className="py-4" data-testid="subscriber-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-strong">{s.name} <span className="ml-2 align-middle"><Badge tone={s.status === 'active' ? 'good' : 'warn'}>{s.status === 'active' ? t('activo', 'active') : t('en pausa', 'paused')}</Badge></span></p>
                      <p className="mt-1 text-[13px] text-muted-2 [overflow-wrap:anywhere]"><code className="text-[12.5px]">{s.destination}</code> · {s.market_code ?? t('todos los mercados', 'all markets')} · {s.event_types[0] === '*' ? t('todos los eventos', 'all events') : t(`${s.event_types.length} ${s.event_types.length === 1 ? 'evento' : 'eventos'}`, `${s.event_types.length} ${s.event_types.length === 1 ? 'event' : 'events'}`)}</p>
                      <p className="mt-1 text-[13px] text-muted-2" data-testid="subscriber-counts">{t(`${num(s.ready, locale)} listas para publicar · ${num(s.delivered, locale)} entregadas · ${num(s.retrying, locale)} en reintento · ${num(s.dead, locale)} muertas`, `${num(s.ready, locale)} ready to publish · ${num(s.delivered, locale)} delivered · ${num(s.retrying, locale)} retrying · ${num(s.dead, locale)} dead`)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={subscriberStatusAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value={s.status === 'active' ? 'paused' : 'active'} /><Submit variant="ghost" size="sm" testId="subscriber-toggle">{s.status === 'active' ? t('Pausar', 'Pause') : t('Reactivar', 'Turn back on')}</Submit></ActionForm>
                      <Dialog trigger={t('Quitar', 'Remove')} title={t(`Quitar a "${s.name}"`, `Remove "${s.name}"`)} variant="quiet" size="sm" testId="subscriber-remove">
                        <p className="text-[14px] text-muted-2">{t('Deja de recibir eventos y sale de esta lista. Sus entregas pendientes ya no salen. Si lo necesitas otra vez, se da de alta de nuevo.', 'It stops receiving events and leaves this list. Its pending deliveries no longer go out. If you need it again, add it again.')}</p>
                        <ActionForm action={subscriberStatusAction} className="mt-6"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value="removed" />
                          <div className="flex flex-wrap justify-end gap-3"><CloseDialog>{t('Cancelar', 'Cancel')}</CloseDialog><Submit variant="danger" testId="subscriber-remove-confirm">{t('Quitar suscriptor', 'Remove subscriber')}</Submit></div></ActionForm>
                      </Dialog>
                    </div>
                  </div>
                  <details className="mt-2 text-[13px]"><summary className="cursor-pointer font-medium text-blue-text">{t('Rotar el secreto', 'Rotate the secret')}</summary>
                    <RevealOnce action={rotateSubscriberAction} label={t('Secreto nuevo. Cópialo ahora: no se vuelve a mostrar.', 'New secret. Copy it now: it will not be shown again.')} copyLabel={t('Copiar', 'Copy')} copiedLabel={t('Copiado', 'Copied')}>
                      <input type="hidden" name="id" value={s.id} />
                      <p className="mt-2 text-muted-2">{t('Desde ese momento se firma con el secreto nuevo. Avisa antes a quien recibe.', 'From that moment the new secret signs. Tell the receiver first.')}</p>
                      <div className="mt-2"><Submit variant="ghost" size="sm" testId="subscriber-rotate">{t('Rotar', 'Rotate')}</Submit></div>
                    </RevealOnce>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 border-t border-line pt-6">
            <p className="mb-4 text-[14.5px] font-semibold text-strong">{t('Nuevo suscriptor', 'New subscriber')}</p>
            <RevealOnce action={createSubscriberAction} label={t('Secreto del suscriptor. Cópialo ahora: no se vuelve a mostrar.', 'Subscriber secret. Copy it now: it will not be shown again.')} copyLabel={t('Copiar', 'Copy')} copiedLabel={t('Copiado', 'Copied')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label={t('Nombre del sistema', 'System name')}><input name="name" className="input" required minLength={3} maxLength={80} data-testid="subscriber-name" /></Field>
                <Field label={t('Destino (https)', 'Destination (https)')}><input name="destination" className="input" required type="url" placeholder="https://" maxLength={300} data-testid="subscriber-destination" /></Field>
                <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="subscriber-market"><option value="">{t('Todos', 'All')}</option>{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
              </div>
              <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="all_events" className="h-5 w-5 shrink-0" defaultChecked data-testid="subscriber-all" />{t('Todos los eventos del catálogo', 'Every event in the catalog')}</label>
              <details className="text-[13.5px]"><summary className="cursor-pointer font-medium text-blue-text">{t('O elegir eventos uno por uno (quita la marca de arriba)', 'Or pick events one by one (untick the box above)')}</summary>
                <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                  {catalog.map((e) => <label key={e.type} className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" name="event" value={e.type} className="h-5 w-5 shrink-0" /><code className="text-[12.5px] [overflow-wrap:anywhere]">{e.type}</code></label>)}
                </div>
              </details>
              <div className="mt-4"><Submit variant="ghost" testId="subscriber-create">{t('Dar de alta', 'Add subscriber')}</Submit></div>
            </RevealOnce>
          </div>
        </Card>

        <Card data-testid="deliveries">
          <CardTitle title={t('Entregas que piden atención', 'Deliveries that need attention')}
            hint={t(`Una entrega que falla se reintenta a los ${BACKOFF_MINUTES.join(', ')} minutos. Al intento ${MAX_ATTEMPTS} queda en mensajes muertos hasta que alguien la reenvíe.`, `A failed delivery is retried after ${BACKOFF_MINUTES.join(', ')} minutes. On attempt ${MAX_ATTEMPTS} it becomes a dead letter until someone resends it.`)}
            right={<ActionForm action={publishNowAction}><Submit variant="ghost" size="sm" testId="publish-now">{t('Publicar ahora', 'Publish now')}</Submit></ActionForm>} />
          {d.attention.length === 0 ? <p className="text-[14px] text-muted" data-testid="deliveries-empty">{t('Nada detenido: no hay entregas en reintento ni mensajes muertos.', 'Nothing held: no deliveries retrying and no dead letters.')}</p> : (
            <ul className="divide-y divide-line">
              {d.attention.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]" data-testid="delivery-row">
                  <span className="min-w-0"><code className="text-[12.5px]">{x.event_type}</code> <span className="text-muted-2">→ {x.subscriber}</span>
                    <span className="block text-[12.5px] text-muted-2">{t(`${x.attempts} ${x.attempts === 1 ? 'intento' : 'intentos'}`, `${x.attempts} ${x.attempts === 1 ? 'attempt' : 'attempts'}`)}{x.last_error ? ` · ${x.last_error}` : ''} · {ago(x.updated_at, locale)}</span></span>
                  <span className="flex items-center gap-3"><Badge tone={st[x.status]![2]}>{t(st[x.status]![0], st[x.status]![1])}</Badge>
                    <ActionForm action={resendDeliveryAction}><input type="hidden" name="id" value={x.id} /><Submit variant="ghost" size="sm" testId="delivery-resend">{t('Reenviar', 'Resend')}</Submit></ActionForm></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="event-catalog">
          <CardTitle title={t('Catálogo de eventos', 'Event catalog')} hint={t(`${catalog.length} eventos, cada uno con su versión, su esquema y un ejemplo. El mismo catálogo está en docs/contracts/domain-events-v1.md para compartirlo con Product & Technology. Un cambio que rompe a quien consume sube la versión.`, `${catalog.length} events, each with its version, schema and an example. The same catalog lives in docs/contracts/domain-events-v1.md to share with Product & Technology. A change that breaks consumers bumps the version.`)} />
          <ul className="divide-y divide-line">
            {catalog.map((e) => (
              <li key={e.type} className="py-2.5" data-testid="event-row">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-[14px]"><code className={code}>{e.type}</code><Badge>v{e.version}</Badge><span className="text-muted-2">{t(e.about[0], e.about[1])}</span></summary>
                  <div className="pb-3 text-[13px] text-muted-2">
                    <p className="mt-1">{e.source === 'explicit' ? t('Lleva sus propios datos:', 'It carries its own data:') : t('Sale junto con la bitácora. Lleva qué campos cambiaron y quién, nunca los valores:', 'It goes out along with the audit log. It carries which fields changed and who, never the values:')}</p>
                    <ul className="mt-1 list-disc pl-5">{Object.entries(e.data).map(([k, f]) => <li key={k}><code className="text-[12.5px] text-strong">{k}</code> ({f.type}{f.required === false ? t(', opcional', ', optional') : ''}): {t(f.about[0], f.about[1])}</li>)}</ul>
                    <p className="mt-3 font-semibold text-strong">{t('Ejemplo', 'Example')}</p>
                    <pre className={pre}>{JSON.stringify(eventExample(e), null, 2)}</pre>
                    <p className="mt-3 font-semibold text-strong">{t('Esquema', 'Schema')}</p>
                    <pre className={pre}>{JSON.stringify(eventSchema(e), null, 2)}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="event-silent">
          <CardTitle title={t('Qué no emite evento y por qué', 'What emits no event and why')} hint={t('La otra mitad de la lista: acciones que quedan en la bitácora y no se publican.', 'The other half of the list: actions that are logged and not published.')} />
          <ul className="space-y-2 text-[13.5px]">
            {silent.map((s) => <li key={s.action} data-testid="silent-row"><code className={code}>{s.action}</code> <span className="text-strong">{t(s.label[0], s.label[1])}.</span> <span className="text-muted-2">{t(s.why[0], s.why[1])}</span>{s.unclassified && <span className="ml-2"><Badge tone="warn">{t('sin clasificar', 'not classified')}</Badge></span>}</li>)}
          </ul>
        </Card>

        <Card data-testid="event-recent">
          <CardTitle title={t('Últimos eventos guardados', 'Latest stored events')} />
          {d.recent.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía no hay eventos: aparecen con el primer cambio.', 'No events yet: they show up with the first change.')}</p> : (
            <ul className="space-y-2.5">{d.recent.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]"><span><code className="text-[12.5px]">{o.event_type}</code> <span className="text-muted-2">v{o.version}</span></span><span className="text-muted-2">{o.market_code ?? t('sin mercado', 'no market')} · {ago(o.created_at, locale)}</span></li>)}</ul>
          )}
        </Card>
      </div>
    )
  }

  async function Api() {
    const d = await getApiAdmin(ctx)
    const scopeText: Record<string, string> = {
      'forms:write': t('crea leads desde un formulario del sitio web', 'creates leads from a website form'), 'events:write': t('manda eventos de la Sales App', 'sends Sales App events'), 'metrics:write': t('carga el archivo diario de ventas', 'loads the daily sales file'),
      'accounts:read': t('lee comercios', 'reads merchants'), 'deals:read': t('lee negocios', 'reads deals'), 'leads:read': t('lee leads', 'reads leads'), 'activities:read': t('lee actividades', 'reads activities'), 'catalogs:read': t('lee catálogos', 'reads catalogs'),
    }
    return (
      <div className="space-y-8" data-testid="api-tab">
        <Card data-testid="api-keys">
          <CardTitle title={t('Llaves', 'Keys')} hint={t('Una llave de lectura es de un solo mercado y lleva solo los permisos que elijas. Lee con tu mismo alcance: nunca ve más que tú, y si pierdes el acceso a ese mercado, deja de leer. Se muestra una vez; en la base queda solo su huella.', 'A read key belongs to one market and carries only the scopes you pick. It reads with your own reach: it never sees more than you do, and if you lose access to that market it stops reading. It is shown once; only its fingerprint is stored.')} />
          <RevealOnce action={createApiKeyAction} label={t('Copia esta llave ahora. No se vuelve a mostrar.', 'Copy this key now. It will not be shown again.')} copyLabel={t('Copiar', 'Copy')} copiedLabel={t('Copiada', 'Copied')}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label={t('Nombre del sistema', 'System name')}><input name="name" className="input" required minLength={3} maxLength={80} data-testid="key-name" /></Field>
              <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="key-market"><option value="">{t('Sin mercado (solo entradas)', 'No market (inbound only)')}</option>{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
              <Field label={t('Tipo', 'Type')}><select name="mode" className="input" data-testid="key-mode"><option value="live">{t('Real', 'Live')}</option><option value="test">{t('De prueba (datos sintéticos)', 'Test (synthetic data)')}</option></select></Field>
              <Field label={t('Solicitudes por minuto', 'Requests per minute')}><input name="rate" type="number" inputMode="numeric" min={1} max={6000} defaultValue={120} className="input" data-testid="key-rate" /></Field>
            </div>
            <fieldset className="mt-4 grid grid-cols-1 gap-x-6 text-[13.5px] sm:grid-cols-2">
              <legend className="mb-1 text-[13px] font-semibold text-muted-2">{t('Qué puede hacer esta llave', 'What this key can do')}</legend>
              {[...READ_SCOPES, ...API_SCOPES].map((sc) => <label key={sc} className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" name="scope" value={sc} className="h-5 w-5 shrink-0" data-testid={`key-scope-${sc}`} /><span><code className="text-[12.5px] text-strong">{sc}</code> <span className="text-muted-2">{scopeText[sc]}</span></span></label>)}
            </fieldset>
            <div className="mt-4"><Submit variant="ghost" testId="key-create">{t('Crear llave', 'Create key')}</Submit></div>
          </RevealOnce>
          <ul className="mt-6 divide-y divide-line">
            {d.keys.map((c) => {
              const dead = Boolean(c.revoked_at) || c.retired
              return (
                <li key={c.id} className="py-3 text-[14px]" data-testid="key-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-semibold text-strong">{c.name}</span> <code className="ml-2 text-[12.5px] text-muted-2">{c.key_prefix}…</code>
                      <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">{c.mode === 'test' && <Badge tone="info">{t('de prueba', 'test')}</Badge>}{c.market_code && <Badge>{c.market_code}</Badge>}
                        {c.revoked_at ? <Badge tone="bad">{t('revocada', 'revoked')}</Badge> : c.retired ? <Badge tone="neutral">{t('retirada', 'retired')}</Badge> : c.retire_at ? <Badge tone="warn">{t(`vigente hasta el ${day(c.retire_at, locale)}`, `valid until ${day(c.retire_at, locale)}`)}</Badge> : <Badge tone="good">{t('vigente', 'valid')}</Badge>}</span>
                      <span className="mt-1 block text-[12.5px] text-muted-2 [overflow-wrap:anywhere]">{c.scopes.join(', ')} · {t(`${c.rate_per_minute} por minuto`, `${c.rate_per_minute} per minute`)}</span>
                      <span className="block text-[12.5px] text-muted-2" data-testid="key-used">{c.last_used_at ? t(`Último uso: ${ago(c.last_used_at, locale)}`, `Last used: ${ago(c.last_used_at, locale)}`) : t('Nunca se ha usado', 'Never used')} · {t(`creada el ${day(c.created_at, locale)}${c.created_by ? ` por ${c.created_by}` : ''}`, `created ${day(c.created_at, locale)}${c.created_by ? ` by ${c.created_by}` : ''}`)}{c.rotated_from ? ` · ${t('nació de una rotación', 'born from a rotation')}` : ''}</span>
                    </span>
                    {!dead && (
                      <Dialog trigger={t('Revocar', 'Revoke')} title={t(`Revocar la llave "${c.name}"`, `Revoke the "${c.name}" key`)} variant="quiet" size="sm" testId="key-revoke">
                        <p className="text-[14px] text-muted-2">{t('La llave deja de servir en ese instante y no se puede reactivar. Si lo que quieres es cambiarla sin corte, usa Rotar.', 'The key stops working right away and cannot be turned back on. If what you want is to replace it with no outage, use Rotate.')}</p>
                        <ActionForm action={revokeApiClientAction} className="mt-6"><input type="hidden" name="id" value={c.id} />
                          <div className="flex flex-wrap justify-end gap-3"><CloseDialog>{t('Cancelar', 'Cancel')}</CloseDialog><Submit variant="danger" testId="key-revoke-confirm">{t('Revocar llave', 'Revoke key')}</Submit></div></ActionForm>
                      </Dialog>
                    )}
                  </div>
                  {!dead && !c.retire_at && (
                    <details className="mt-1 text-[13px]"><summary className="cursor-pointer font-medium text-blue-text" data-testid="key-rotate-open">{t('Rotar', 'Rotate')}</summary>
                      <RevealOnce action={rotateApiKeyAction} label={t('Llave nueva. Cópiala ahora: no se vuelve a mostrar.', 'New key. Copy it now: it will not be shown again.')} copyLabel={t('Copiar', 'Copy')} copiedLabel={t('Copiada', 'Copied')}>
                        <input type="hidden" name="id" value={c.id} />
                        <p className="mt-2 text-muted-2">{t('Nace una llave nueva con el mismo mercado y permisos. La anterior sigue valiendo los días que digas, para que el otro sistema cambie sin corte, y después deja de valer sola.', 'A new key is created with the same market and scopes. The previous one stays valid for the days you set, so the other system can switch with no outage, and then stops working on its own.')}</p>
                        <div className="mt-2 flex flex-wrap items-end gap-3">
                          <Field label={t('Días que sigue vigente la anterior', 'Days the previous one stays valid')}><input name="days" type="number" inputMode="numeric" min={ROTATION_DAYS.min} max={ROTATION_DAYS.max} defaultValue={ROTATION_DAYS.default} className="input !w-28" data-testid="key-rotate-days" /></Field>
                          <Submit variant="ghost" size="sm" testId="key-rotate">{t('Rotar llave', 'Rotate key')}</Submit>
                        </div>
                      </RevealOnce>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>

        <Card data-testid="api-docs">
          <CardTitle title={t('Documentación de la API v1', 'API v1 documentation')} hint={t('Solo lectura. La misma definición genera docs/contracts/api-v1.md y docs/contracts/api-v1.openapi.json.', 'Read only. The same definition generates docs/contracts/api-v1.md and docs/contracts/api-v1.openapi.json.')} />
          <div className="space-y-2 text-[13.5px] text-muted-2">
            <p>{t('Cada solicitud lleva el encabezado', 'Every request carries the header')} <code className={code}>Authorization: Bearer ctg_…</code></p>
            <p>{t(`Paginación por cursor: limit (1 a ${API_PAGE.max}, por defecto ${API_PAGE.default}) y cursor (el next_cursor de la página anterior). Los registros salen del más antiguo al más nuevo; next_cursor es null en la última página.`, `Cursor pagination: limit (1 to ${API_PAGE.max}, default ${API_PAGE.default}) and cursor (the previous page’s next_cursor). Records come oldest first; next_cursor is null on the last page.`)}</p>
            <p>{t(`Límite de frecuencia: el de la llave (por minuto) y ${LIMITS.apiPerIp} por minuto por dirección. Pasado el tope la respuesta es 429 con Retry-After en segundos. Con ${LIMITS.apiAuthFailPerIp} llaves inválidas en un minuto desde la misma dirección, también 429.`, `Rate limit: the key’s own (per minute) and ${LIMITS.apiPerIp} per minute per address. Past the limit the answer is 429 with Retry-After in seconds. After ${LIMITS.apiAuthFailPerIp} invalid keys in a minute from the same address, 429 as well.`)}</p>
            <p data-testid="api-sandbox-note">{t('Llaves de prueba (ctg_test_…): leen un juego fijo de datos sintéticos, con nombres inventados, que nunca toca los registros reales. Sirven para probar paginación, filtros, permisos y límites en cualquier ambiente. La respuesta lleva el encabezado x-contigo-data: synthetic.', 'Test keys (ctg_test_…): they read a fixed set of synthetic data, with made-up names, that never touches real records. Use them to try pagination, filters, scopes and limits in any environment. The response carries the header x-contigo-data: synthetic.')}</p>
          </div>
          <ul className="mt-5 divide-y divide-line">
            {API_RESOURCES.map((r) => (
              <li key={r.name} className="py-2.5" data-testid="api-resource">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-[14px]"><code className={code}>GET {r.path}</code><Badge>{r.scope}</Badge><span className="text-muted-2">{t(r.about[0], r.about[1])}</span></summary>
                  <div className="pb-3 text-[13px] text-muted-2">
                    <p className="mt-2 font-semibold text-strong">{t('Filtros', 'Filters')}</p>
                    <ul className="mt-1 list-disc pl-5">{r.filters.map((f) => <li key={f.name}><code className="text-[12.5px] text-strong">{f.name}</code>: {t(f.about[0], f.about[1])}{f.values ? ` (${f.values.join(', ')})` : ''}</li>)}</ul>
                    <p className="mt-3 font-semibold text-strong">{t('Campos', 'Fields')}</p>
                    <ul className="mt-1 list-disc pl-5">{r.fields.map((f) => <li key={f.name}><code className="text-[12.5px] text-strong">{f.name}</code> ({f.type}{f.nullable ? t(', puede venir vacío', ', may be null') : ''}): {t(f.about[0], f.about[1])}</li>)}</ul>
                  </div>
                </details>
              </li>
            ))}
            <li className="py-3 text-[14px]" data-testid="api-resource"><code className={code}>GET {CATALOGS.path}</code> <Badge>{CATALOGS.scope}</Badge> <span className="text-[13.5px] text-muted-2">{t(CATALOGS.about[0], CATALOGS.about[1])}</span></li>
          </ul>
          <p className="mt-5 text-[13px] font-semibold text-strong">{t('Respuestas de error', 'Error responses')}</p>
          <ul className="mt-1 space-y-1 text-[13px] text-muted-2">{API_ERRORS.map((e) => <li key={e.code}><code className={code}>{e.status} {e.code}</code> {t(e.about[0], e.about[1])}</li>)}</ul>
        </Card>
      </div>
    )
  }

  async function SalesApp() {
    const d = await getSalesAppAdmin(ctx)
    const staging = env().APP_ENV !== 'production'
    return (
      <div className="space-y-8" data-testid="salesapp-tab">
        <div className="rounded-[22px] bg-surface-3 px-6 py-5 text-[14px] text-muted-2" data-testid="salesapp-status">
          <strong className="text-strong">{t('Contrato propuesto, sin conexión real todavía.', 'Proposed contract, no live connection yet.')}</strong>{' '}
          {t('CONTIGO ya entiende los cuatro eventos y sabe qué hacer con los que no puede procesar. Falta que el equipo dueño de la Sales App y de Sales Core firme el contrato y conecte su sistema con una llave events:write.', 'CONTIGO already understands the four events and knows what to do with the ones it cannot process. The team that owns the Sales App and Sales Core still has to sign the contract and connect their system with an events:write key.')}
          <span className="mt-2 block" data-testid="salesapp-counts">{t(`Recibidos: ${num(d.counts.processed ?? 0, locale)} procesados, ${num(d.counts.rejected ?? 0, locale)} sin comercio y ${num(d.counts.dead ?? 0, locale)} muertos.`, `Received: ${num(d.counts.processed ?? 0, locale)} processed, ${num(d.counts.rejected ?? 0, locale)} with no merchant and ${num(d.counts.dead ?? 0, locale)} dead.`)}</span>
        </div>

        <Card pad={false} data-testid="contract-matrix">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Quién es dueño de cada dato', 'Who owns each piece of data')} hint={t('La Sales App ejecuta la visita y el alta; CONTIGO es dueño de la cuenta, la jerarquía, el embudo y la cartera. Cuando los dos tienen el dato, manda el dueño.', 'The Sales App runs the visit and the onboarding; CONTIGO owns the account, the hierarchy, the pipeline and the portfolio. When both hold the data, the owner wins.')} /></div>
          <Table testId="matrix-table" label={t('Matriz de campos del contrato', 'Contract field matrix')} head={<><th>{t('Dato', 'Data')}</th><th>{t('Dueño', 'Owner')}</th><th>{t('Viaja en', 'Travels in')}</th><th>{t('Regla', 'Rule')}</th></>}>
            {FIELD_MATRIX.map((r) => (
              <tr key={r.field[1]} className="table-row align-top" data-testid="matrix-row">
                <td className="font-medium text-strong">{t(r.field[0], r.field[1])}</td>
                <td><Badge tone={r.owner === 'contigo' ? 'accent' : 'neutral'}>{t(OWNER_LABEL[r.owner][0], OWNER_LABEL[r.owner][1])}</Badge></td>
                <td><code className="text-[12.5px] [overflow-wrap:anywhere]">{r.travels}</code></td>
                <td className="text-[13.5px] text-muted-2">{t(r.rule[0], r.rule[1])}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card data-testid="contract-events">
          <CardTitle title={t('Eventos que CONTIGO recibe', 'Events CONTIGO receives')} hint={t('Todos llegan a POST /api/v1/events/sales-app con una llave events:write. El mismo event_id dos veces se procesa una. Los esquemas están en docs/contracts/sales-app-events-v1.schema.json.', 'They all arrive at POST /api/v1/events/sales-app with an events:write key. The same event_id twice is processed once. The schemas are in docs/contracts/sales-app-events-v1.schema.json.')} />
          <ul className="space-y-2.5 text-[13.5px]">{INBOUND_EVENTS.map((e) => <li key={e.type} data-testid="inbound-def"><code className={code}>{e.type}</code> <Badge>v{e.version}</Badge> <span className="text-strong">{t(e.about[0], e.about[1])}</span> <span className="text-muted-2">{t('Obligatorios:', 'Required:')} {e.required.join(', ')}</span></li>)}</ul>
        </Card>

        {staging && (
          <Card data-testid="contract-sim">
            <CardTitle title={t('Simulador (no existe en producción)', 'Simulator (not available in production)')} hint={t('Manda el mismo mensaje que mandaría la Sales App, por el mismo camino. Cambia registros de este ambiente y queda en la bitácora quién lo corrió.', 'Sends the same message the Sales App would, down the same path. It changes records in this environment and the audit log keeps who ran it.')} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <ActionForm action={simulateContractAction} className="card-2 p-5" testId="sim-onboarding">
                <input type="hidden" name="kind" value="onboarding" />
                <p className="text-[14.5px] font-semibold text-strong">{t('Alta enviada', 'Onboarding submitted')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('El comercio pasa a "En alta" y la entrada queda en su hilo.', 'The merchant moves to "Onboarding" and the entry lands in its thread.')}</p>
                <Field label={t('ID del punto de venta', 'Store ID')}><input name="customer_id" className="input" required list="sim-aliases" data-testid="sim-onboarding-id" /></Field>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-onboarding-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
              <ActionForm action={simulateContractAction} className="card-2 p-5" testId="sim-approved">
                <input type="hidden" name="kind" value="approved" />
                <p className="text-[14.5px] font-semibold text-strong">{t('Comercio aprobado', 'Merchant approved')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('El comercio recibe su Merchant ID. No gana el negocio.', 'The merchant gets its Merchant ID. It does not win the deal.')}</p>
                <Field label={t('ID del punto de venta', 'Store ID')}><input name="customer_id" className="input" required list="sim-aliases" data-testid="sim-approved-id" /></Field>
                <Field label="Merchant ID" className="mt-3"><input name="merchant_ref" className="input" required pattern="[A-Za-z0-9._-]+" maxLength={40} data-testid="sim-approved-ref" /></Field>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-approved-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
              <ActionForm action={simulateContractAction} className="card-2 p-5" testId="sim-invalid">
                <input type="hidden" name="kind" value="invalid" />
                <input type="hidden" name="customer_id" value="SC-XX-000000" />
                <p className="text-[14.5px] font-semibold text-strong">{t('Mensaje fuera de contrato', 'Message outside the contract')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('Un tipo de evento que el contrato no tiene. Debe quedar en mensajes muertos con su motivo.', 'An event type the contract does not have. It should land in dead letters with the reason.')}</p>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-invalid-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
            </div>
            <datalist id="sim-aliases">{d.linkable.map((a) => <option key={a.alias} value={a.alias}>{a.name}</option>)}</datalist>
          </Card>
        )}

        <Card data-testid="inbound-stuck">
          <CardTitle title={t('Mensajes detenidos', 'Held messages')} hint={t('Lo que llegó y no se pudo procesar: fuera de contrato (muerto) o de un punto de venta que todavía no conocemos. No se pierde: se reprocesa desde aquí cuando ya se pueda.', 'What arrived and could not be processed: outside the contract (dead) or from a store we do not know yet. It is not lost: reprocess it from here once it can go through.')} />
          {d.stuck.length === 0 ? <p className="text-[14px] text-muted" data-testid="stuck-empty">{t('Nada detenido.', 'Nothing held.')}</p> : (
            <ul className="divide-y divide-line">
              {d.stuck.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]" data-testid="stuck-row">
                  <span className="min-w-0"><code className="text-[12.5px]">{e.event_type}</code> <Badge tone={e.status === 'dead' ? 'bad' : 'warn'}>{e.status === 'dead' ? t('muerto', 'dead') : t('sin comercio', 'no merchant')}</Badge>
                    <span className="block text-[12.5px] text-muted-2" data-testid="stuck-reason">{t(...stuckReason(e.error))} · {t(`${e.attempts} ${e.attempts === 1 ? 'intento' : 'intentos'}`, `${e.attempts} ${e.attempts === 1 ? 'attempt' : 'attempts'}`)} · {ago(e.received_at, locale)}</span></span>
                  <ActionForm action={replayInboundAction}><input type="hidden" name="id" value={e.id} /><Submit variant="ghost" size="sm" testId="stuck-replay">{t('Reprocesar', 'Reprocess')}</Submit></ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }

  async function Forms() {
    const d = await getFormsAdmin(ctx)
    const reason: Record<string, [string, string]> = { rate: ['pasó el límite por dirección', 'over the per-address limit'], too_fast: ['envió demasiado rápido', 'submitted too fast'], trap: ['llenó el campo trampa', 'filled the trap field'], no_render: ['no venía de una página que mostramos', 'did not come from a page we showed'], bot: ['no pasó la verificación anti-bot', 'failed the anti-bot check'], api_rate: ['pasó el límite de la API', 'over the API limit'] }
    const bot = antibotMode()
    return (
      <div className="space-y-8" data-testid="forms-tab">
        <div className="rounded-[22px] bg-surface-3 px-6 py-5 text-[14px] text-muted-2" data-testid="forms-status">
          <p className="flex flex-wrap items-center gap-3"><strong className="text-strong">{t('Verificación anti-bot', 'Anti-bot check')}</strong>{off(bot === 'simulated')}</p>
          <p className="mt-2">{t('Las otras defensas están activas: límite por dirección y por formulario, tiempo mínimo entre abrir la página y enviar, campo trampa y llave de la página. Para encender la verificación anti-bot hace falta aprobar el servicio en Tech Implementation Review y activar la variable CONTIGO_ANTIBOT.', 'The other defenses are on: a limit per address and per form, a minimum time between opening the page and sending, a trap field and the page key. Turning the anti-bot check on takes approving the service in Tech Implementation Review and setting the CONTIGO_ANTIBOT variable.')}</p>
          <p className="mt-2" data-testid="forms-defaults">{t(`Valores generales: ${LIMITS.formSubmitsPerIp} envíos y ${LIMITS.formViewsPerIp} vistas por minuto por dirección; ${defaultMinFillSeconds()} segundos como mínimo para llenar. Lo rechazado no se guarda y quien envía recibe siempre la misma respuesta, sin detalle.`, `General values: ${LIMITS.formSubmitsPerIp} submissions and ${LIMITS.formViewsPerIp} views per minute per address; at least ${defaultMinFillSeconds()} seconds to fill in. Whatever is rejected is not stored and the sender always gets the same answer, with no detail.`)}</p>
        </div>
        <Card data-testid="forms-limits">
          <CardTitle title={t('Límites por formulario', 'Limits per form')} hint={t('Deja un campo vacío para usar el valor general.', 'Leave a field empty to use the general value.')} />
          <ul className="divide-y divide-line">
            {d.forms.map((f) => {
              const rej = d.rejected.filter((r) => r.slug === f.slug)
              return (
                <li key={f.id} className="py-4" data-testid="form-limit-row">
                  <p className="text-[15px] font-semibold text-strong">{f.name} <span className="ml-2 text-[12.5px] font-normal text-muted-2">/f/{f.slug} · {f.market_code}</span></p>
                  <p className="mt-1 text-[13px] text-muted-2" data-testid="form-rejections">{rej.length === 0 ? t('Sin rechazos en los últimos 7 días.', 'No rejections in the last 7 days.') : t('Rechazos en 7 días: ', 'Rejections in 7 days: ') + rej.map((r) => `${num(r.n, locale)} ${t(...(reason[r.reason] ?? [r.reason, r.reason]))}`).join(' · ')}</p>
                  <ActionForm action={setFormLimitsAction} className="mt-3 flex flex-wrap items-end gap-4">
                    <input type="hidden" name="id" value={f.id} />
                    <Field label={t('Segundos mínimos para llenar', 'Minimum seconds to fill in')}><input name="min_fill_seconds" type="number" inputMode="numeric" min={0} max={120} defaultValue={f.min_fill_seconds ?? ''} className="input !w-32" data-testid="form-min-seconds" /></Field>
                    <Field label={t('Envíos por minuto por dirección', 'Submissions per minute per address')}><input name="rate_per_minute" type="number" inputMode="numeric" min={1} max={600} defaultValue={f.rate_per_minute ?? ''} className="input !w-32" data-testid="form-rate" /></Field>
                    <Submit variant="ghost" size="sm" testId="form-limits-save">{t('Guardar', 'Save')}</Submit>
                  </ActionForm>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    )
  }

  async function Data() {
    const [exp, imports] = await Promise.all([getExports(ctx), getImports(ctx)])
    const what: Record<string, [string, string]> = { closed_deals: ['Negocios cerrados', 'Closed deals'], field_stores: ['Campo: altas y ganados', 'Field: enrollments and wins'], field_visits: ['Campo: visitas', 'Field: visits'], accounts: ['Comercios', 'Merchants'], leads: ['Leads', 'Leads'] }
    return (
      <div className="space-y-8" data-testid="data-tab">
        {exp.alerts > 0 && <p role="status" className="rounded-[14px] bg-warn-bg px-5 py-4 text-[14px] font-medium text-amber-text" data-testid="export-alert">{t(`${num(exp.alerts, locale)} ${exp.alerts === 1 ? 'exportación pasó' : 'exportaciones pasaron'} el umbral diario en los últimos 7 días. Están marcadas abajo: revisa quién, qué y para qué.`, `${num(exp.alerts, locale)} ${exp.alerts === 1 ? 'export went' : 'exports went'} over the daily threshold in the last 7 days. They are flagged below: check who, what and what for.`)}</p>}
        <Card data-testid="export-rules">
          <CardTitle title={t('Reglas de exportación', 'Export rules')} hint={t('Valen para toda descarga: negocios cerrados, reporte de campo, comercios y leads.', 'They apply to every download: closed deals, field report, merchants and leads.')} />
          <ul className="space-y-1.5 text-[13.5px] text-muted-2">
            <li>{t('Toda exportación pide un motivo y queda en la bitácora con filtros y número de filas.', 'Every export asks for a reason and is logged with its filters and row count.')}</li>
            <li data-testid="export-caps">{t('Tope de filas por archivo: ', 'Row limit per file: ')}{(Object.entries(EXPORT_CAPS) as [Role, number][]).map(([r, n]) => `${t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)} ${num(n, locale)}`).join(' · ')}. {t('Ventas y Operaciones no exportan.', 'Sales and Operations do not export.')}</li>
            <li>{t(`Alerta: quien pase de ${num(EXPORT_DAILY.rows, locale)} filas o ${EXPORT_DAILY.files} archivos en 24 horas queda marcado aquí y en la bitácora.`, `Alert: anyone going over ${num(EXPORT_DAILY.rows, locale)} rows or ${EXPORT_DAILY.files} files in 24 hours is flagged here and in the audit log.`)}</li>
          </ul>
        </Card>
        <Card pad={false} data-testid="export-log">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Exportaciones recientes', 'Recent exports')} /></div>
          {exp.rows.length === 0 ? <div className="px-5 pb-7 md:px-7"><Empty title={t('Nadie ha exportado todavía', 'Nobody has exported yet')} hint={t('Cuando alguien baje un archivo, aquí queda quién, qué y para qué.', 'When someone downloads a file, who, what and what for shows up here.')} /></div> : (
            <Table testId="export-table" label={t('Exportaciones recientes', 'Recent exports')} head={<><th>{t('Quién', 'Who')}</th><th>{t('Qué', 'What')}</th><th>{t('Motivo', 'Reason')}</th><th>{t('Filas', 'Rows')}</th><th>{t('Cuándo', 'When')}</th></>}>
              {exp.rows.map((e) => (
                <tr key={e.id} className="table-row align-top" data-testid="export-row">
                  <td className="font-medium text-strong">{e.who}{e.alert && <span className="ml-2"><Badge tone="warn">{t('sobre el umbral', 'over the threshold')}</Badge></span>}</td>
                  <td>{t(...(what[e.what] ?? [e.what, e.what]))}{e.market_code ? ` · ${e.market_code}` : ''}</td>
                  <td className="max-w-[320px] text-[13.5px] text-muted-2 [overflow-wrap:anywhere]">{e.reason}</td>
                  <td className="num">{num(e.rows, locale)}{e.truncated && <span className="ml-1 text-[12.5px] text-amber-text">{t(`(tope ${num(e.row_cap, locale)})`, `(limit ${num(e.row_cap, locale)})`)}</span>}</td>
                  <td className="text-[13.5px] text-muted-2">{ago(e.created_at, locale)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card data-testid="import-summary-card">
          <CardTitle title={t('Importaciones por archivo', 'File imports')} hint={t('Comercios, contactos y leads por CSV, con vista previa, reporte por fila y deshacer.', 'Merchants, contacts and leads by CSV, with a preview, a per-row report and undo.')}
            right={<Link href="/importar" className="text-[14px] font-medium text-blue-text underline" data-testid="go-import">{t('Abrir Importar', 'Open Import')}</Link>} />
          <p className="text-[13.5px] text-muted-2" data-testid="import-count">{imports.length === 0 ? t('Todavía no hay importaciones.', 'No imports yet.') : t(`${num(imports.length, locale)} ${imports.length === 1 ? 'importación' : 'importaciones'}; la última, de ${imports[0]!.created_by}, ${ago(imports[0]!.created_at, locale)}.`, `${num(imports.length, locale)} ${imports.length === 1 ? 'import' : 'imports'}; the latest, by ${imports[0]!.created_by}, ${ago(imports[0]!.created_at, locale)}.`)}</p>
        </Card>
      </div>
    )
  }
}
