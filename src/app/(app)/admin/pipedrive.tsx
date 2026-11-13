import type { Ctx } from '@/server/context'
import { getImportStatus } from '@/dal/imports'
import { STEPS } from '@/domain/pipedrive/import'
import { Badge, Card, CardTitle, Empty, Table, NoData } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { ImportRunner } from '@/ui/import-runner'
import { ago, dayTime, num } from '@/lib/format'
import { MOTOR, lab } from '@/lib/labels'
import { CoexistenceCards } from './coexistence'
import { cancelImportAction, importStepAction, purgeRawAction, resumeImportAction, startImportAction } from './actions'

type Pair = [es: string, en: string]

const OBJECTS: { key: string; label: Pair; into: Pair }[] = [
  { key: 'organization', label: ['Organizaciones', 'Organizations'], into: ['Comercios', 'Merchants'] },
  { key: 'person', label: ['Personas', 'People'], into: ['Contactos', 'Contacts'] },
  { key: 'deal', label: ['Negocios', 'Deals'], into: ['Negocios', 'Deals'] },
  { key: 'lead', label: ['Leads', 'Leads'], into: ['Leads', 'Leads'] },
  { key: 'activity', label: ['Actividades', 'Activities'], into: ['Actividades', 'Activities'] },
  { key: 'note', label: ['Notas', 'Notes'], into: ['Notas en el hilo', 'Thread notes'] },
  { key: 'product', label: ['Productos', 'Products'], into: ['Productos', 'Products'] },
  { key: 'deal_product', label: ['Productos de los negocios', 'Deal products'], into: ['Líneas del negocio', 'Deal line items'] },
]

const PHASE: Record<string, Pair> = {
  config: ['Copiando la configuración', 'Copying the configuration'],
  finish: ['Cerrando: accesos, próximos pasos y reglas', 'Finishing: access, next steps and rules'],
}
const SKIP: Record<string, Pair> = {
  no_market: ['sin mercado identificable', 'no identifiable market'],
  // Reglas de entrada (las mismas de la pantalla y la API): la fila que no cumple no entra.
  rule_name: ['sin nombre válido', 'no valid name'],
  rule_prohibited: ['traía un dato que CONTIGO no guarda', 'it carried data CONTIGO does not store'],
  rule_phone: ['teléfono inválido', 'invalid phone number'],
  rule_amount: ['monto inválido', 'invalid amount'],
  rule_lost_reason: ['perdido sin motivo', 'lost with no reason'],
  pipeline_out_of_scope: ['embudo fuera de US y MX', 'pipeline outside US and MX'],
  archived_open: ['archivado sin cerrar', 'archived while open'],
  deleted: ['borrado en Pipedrive', 'deleted in Pipedrive'],
  no_stage: ['etapa inexistente', 'missing stage'],
  no_link: ['sin comercio, negocio ni lead', 'no merchant, deal or lead'],
  no_deal: ['su negocio no se cargó', 'its deal was not loaded'],
  empty: ['sin texto', 'no text'],
  merged_in_contigo: ['ya fusionado en CONTIGO', 'already merged in CONTIGO'],
  market_cut_over: ['su mercado ya apagó Pipedrive', 'its market already switched Pipedrive off'],
}
const ISSUE: Record<string, Pair> = {
  pipedrive_unauthorized: ['Pipedrive rechazó el token. Revisa PIPEDRIVE_API_TOKEN en el servidor y que sea de un usuario administrador.', 'Pipedrive rejected the token. Check PIPEDRIVE_API_TOKEN on the server and that it belongs to an admin user.'],
  pipedrive_not_configured: ['Falta PIPEDRIVE_API_TOKEN en el servidor.', 'PIPEDRIVE_API_TOKEN is missing on the server.'],
  pipedrive_upstream: ['Pipedrive no respondió. Reanuda en unos minutos.', 'Pipedrive did not respond. Resume in a few minutes.'],
  pipedrive_not_found: ['Pipedrive ya no ofrece una de las listas que se pidieron.', 'Pipedrive no longer offers one of the requested lists.'],
  pipeline_out_of_scope: ['Embudo sin prefijo de mercado activo (US o MX): no se importó.', 'Pipeline with no live market prefix (US or MX): not imported.'],
  config_unavailable: ['El token no tiene permiso para leer esta parte de la configuración.', 'The token is not allowed to read this part of the configuration.'],
  error: ['Un paso falló. El detalle técnico quedó en el log del servidor.', 'A step failed. The technical detail is in the server log.'],
}
const DEST: Record<string, Pair> = {
  'core:market': ['Mercado del registro', 'Record market'],
  'core:lifecycle': ['Etapa de vida del comercio', 'Merchant lifecycle'],
  'core:territory': ['Territorio', 'Territory'],
  'core:segment': ['Segmento', 'Segment'],
  'core:latitude': ['Ubicación (latitud)', 'Location (latitude)'],
  'core:longitude': ['Ubicación (longitud)', 'Location (longitude)'],
  'core:phone': ['Teléfono del comercio', 'Merchant phone'],
  'core:email': ['Correo del comercio', 'Merchant email'],
  'core:locality': ['Ciudad (si la dirección no la trae)', 'City (when the address lacks it)'],
  'core:region': ['Estado (si la dirección no lo trae)', 'State (when the address lacks it)'],
  'core:decision_maker': ['Rol del contacto en el comercio', 'Contact role at the merchant'],
  'core:role': ['Rol del contacto en el comercio', 'Contact role at the merchant'],
  'alias:emida': ['ID externo EMIDA (buscable)', 'EMIDA external ID (searchable)'],
  'policy:last4': ['Solo los últimos 4 caracteres (DATA-06)', 'Last 4 characters only (DATA-06)'],
  'policy:omit': ['No se guarda (DATA-06)', 'Not stored (DATA-06)'],
}
const OBJ: Record<string, Pair> = {
  account: ['Comercio', 'Merchant'], contact: ['Contacto', 'Contact'], deal: ['Negocio y lead', 'Deal and lead'], activity: ['Actividad', 'Activity'], product: ['Producto', 'Product'],
}

export async function PipedriveTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const d = await getImportStatus(ctx)
  const run = d.run
  const running = run?.status === 'running'
  const everDone = d.history.some((r) => r.status === 'done')
  const stats = run?.stats ?? {}
  const idx = run ? STEPS.indexOf(run.phase as (typeof STEPS)[number]) : -1
  const phaseLabel = (p: string) => {
    if (PHASE[p]) return lab(t, PHASE[p])
    const o = OBJECTS.find((x) => x.key === p.slice(2).replace('_archived', ''))
    const name = o ? lab(t, o.label).toLowerCase() : p
    return p.startsWith('x:') ? t(`Copiando ${name} de Pipedrive`, `Copying ${name} from Pipedrive`) : t(`Cargando ${name} a CONTIGO`, `Loading ${name} into CONTIGO`)
  }
  const skippedFor = (obj: string) => Object.entries(stats.skipped ?? {}).filter(([k]) => k.startsWith(`${obj}:`)).map(([k, n]) => ({ reason: k.split(':')[1]!, n }))
  const rawOf = (obj: string) => d.raw.find((r) => r.object === obj)
  const byObject = [...new Set(d.fields.map((f) => f.object))]

  return (
    <div className="space-y-8" data-testid="admin-pipedrive">
      <Card data-testid="import-status">
        <CardTitle
          title={t('Migración desde Pipedrive', 'Migration from Pipedrive')}
          hint={t(
            'Copia la configuración y todos los registros de US y MX. Solo lee: en Pipedrive no cambia nada. Se puede repetir; no duplica.',
            'Copies the configuration and every US and MX record. Read-only: nothing changes in Pipedrive. It can be repeated; it does not duplicate.',
          )}
          right={!d.configured ? <Badge tone="warn">{t('falta el token', 'token missing')}</Badge> : running ? <Badge tone="info">{t('corriendo', 'running')}</Badge> : run?.status === 'failed' ? <Badge tone="bad">{t('detenida', 'stopped')}</Badge> : run?.status === 'done' ? <Badge tone="good">{t('completa', 'complete')}</Badge> : <Badge>{t('sin correr', 'not run yet')}</Badge>}
        />
        {!d.configured && (
          <p className="mb-5 rounded-2xl bg-amber/14 px-4 py-3 text-[13.5px] text-amber-text" data-testid="import-no-token">
            {t('El servidor no tiene PIPEDRIVE_API_TOKEN. Se agrega como variable Sensitive en el hosting y se redespliega.', 'The server has no PIPEDRIVE_API_TOKEN. Add it as a Sensitive variable on the host and redeploy.')}
          </p>
        )}
        {run && (
          <div className="mb-6" data-testid="import-progress">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-[15px] font-semibold text-strong" data-testid="import-phase">
                {run.status === 'done' ? t('Terminó', 'Finished') : phaseLabel(run.phase)}
                {run.status !== 'done' && idx >= 0 && <span className="ml-2 text-[13px] font-normal text-muted-2">{t(`paso ${idx + 1} de ${STEPS.length}`, `step ${idx + 1} of ${STEPS.length}`)}</span>}
              </p>
              <p className="text-[12.5px] text-muted">
                {t('Inició', 'Started')} {dayTime(run.started_at, locale)} · {run.finished_at ? `${t('terminó', 'finished')} ${dayTime(run.finished_at, locale)}` : `${t('último avance', 'last progress')} ${ago(run.updated_at, locale)}`}
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${run.status === 'done' ? 100 : Math.max(3, Math.round(((idx + 1) / STEPS.length) * 100))}%` }} />
            </div>
            <div className="mt-3">
              <ImportRunner active={running} step={importStepAction} labels={{ working: t('Trabajando. Deja esta pestaña abierta.', 'Working. Keep this tab open.'), waiting: t('Pipedrive pidió una pausa. Sigue sola en un momento.', 'Pipedrive asked for a pause. It continues on its own shortly.'), paused: t('Se perdió la conexión. Recarga la página para seguir.', 'The connection was lost. Reload the page to continue.') }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-start gap-3">
          {!running && run?.status === 'failed' && (
            <ActionForm action={resumeImportAction}><Submit testId="import-resume">{t('Reanudar donde se detuvo', 'Resume where it stopped')}</Submit></ActionForm>
          )}
          {!running && (
            <ActionForm action={startImportAction}><input type="hidden" name="mode" value="full" /><Submit variant={everDone || run?.status === 'failed' ? 'ghost' : 'primary'} testId="import-full">{everDone ? t('Importar todo de nuevo', 'Import everything again') : t('Importar todo', 'Import everything')}</Submit></ActionForm>
          )}
          {!running && everDone && (
            <>
              <ActionForm action={startImportAction}><input type="hidden" name="mode" value="delta" /><Submit testId="import-delta">{t('Traer solo lo que cambió', 'Bring only what changed')}</Submit></ActionForm>
              <ActionForm action={startImportAction}><input type="hidden" name="mode" value="remap" /><Submit variant="ghost" testId="import-remap">{t('Volver a aplicar el mapeo', 'Apply the mapping again')}</Submit></ActionForm>
              <ActionForm action={purgeRawAction}><Submit variant="quiet" testId="import-purge">{t('Vaciar la copia cruda', 'Empty the raw copy')}</Submit></ActionForm>
            </>
          )}
          {running && <ActionForm action={cancelImportAction}><Submit variant="quiet" testId="import-cancel">{t('Detener', 'Stop')}</Submit></ActionForm>}
        </div>
        {run && run.issues.length > 0 && (
          <ul className="mt-6 space-y-2" data-testid="import-issues">
            {run.issues.map((i, n) => (
              <li key={n} className="rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2">
                <span className="font-medium text-strong">{lab(t, ISSUE[i.code], i.code)}</span>
                {i.detail ? <span className="ml-2 text-muted">{i.detail}</span> : null}
                <span className="ml-2 text-[12px] text-muted">({phaseLabel(i.step)})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CoexistenceCards ctx={ctx} />

      <Card pad={false} data-testid="import-counts">
        <div className="px-7 pt-7"><CardTitle title={t('Qué se copió y qué se cargó', 'What was copied and what was loaded')} hint={t('Lo que no se carga queda contado con su motivo. Nada se descarta en silencio.', 'Anything not loaded is counted with its reason. Nothing is dropped silently.')} /></div>
        <Table head={<><th>Pipedrive</th><th>{t('Copiados', 'Copied')}</th><th>CONTIGO</th><th>{t('Nuevos', 'New')}</th><th>{t('Actualizados', 'Updated')}</th><th>{t('No cargados', 'Not loaded')}</th><th>{t('Pendientes', 'Pending')}</th></>}>
          {OBJECTS.map((o) => {
            const raw = rawOf(o.key)
            const sk = skippedFor(o.key)
            return (
              <tr key={o.key} className="table-row" data-testid={`count-${o.key}`}>
                <td className="font-semibold text-strong">{lab(t, o.label)}</td>
                <td className="num">{num(raw?.total ?? stats.extracted?.[o.key] ?? 0, locale)}</td>
                <td className="text-[13.5px] text-muted-2">{lab(t, o.into)}</td>
                <td className="num" data-testid="count-created">{num(stats.created?.[o.key] ?? 0, locale)}</td>
                <td className="num">{num(stats.updated?.[o.key] ?? 0, locale)}</td>
                <td className="text-[13px] text-muted-2">{sk.length ? sk.map((s) => `${num(s.n, locale)} ${lab(t, SKIP[s.reason], s.reason)}`).join(' · ') : <NoData locale={locale} />}</td>
                <td className="num">{num(raw?.pending ?? 0, locale)}</td>
              </tr>
            )
          })}
        </Table>
        <p className="px-7 pb-6 text-[12.5px] text-muted">
          {t(`Además. Comercios creados para negocios sin organización: ${num(stats.created?.account_from_deal ?? 0, locale)}. IDs de EMIDA ligados: ${num(stats.created?.alias_emida ?? 0, locale)}. Accesos de ventas otorgados: ${num(stats.created?.membership ?? 0, locale)}.`,
            `Also. Merchants created for deals with no organization: ${num(stats.created?.account_from_deal ?? 0, locale)}. EMIDA IDs linked: ${num(stats.created?.alias_emida ?? 0, locale)}. Sales access grants: ${num(stats.created?.membership ?? 0, locale)}.`)}
        </p>
      </Card>

      <div className="space-y-8">
        <Card pad={false} data-testid="import-totals">
          <div className="px-7 pt-7"><CardTitle title={t('Lo que hay hoy en CONTIGO', 'What CONTIGO holds today')} /></div>
          <Table head={<><th>{t('Mercado', 'Market')}</th><th>{t('Comercios', 'Merchants')}</th><th>{t('Contactos', 'Contacts')}</th><th>{t('Negocios', 'Deals')}</th><th>Leads</th><th>{t('Actividades', 'Activities')}</th></>}>
            {d.totals.map((m) => <tr key={m.market_code} className="table-row"><td className="font-semibold text-strong">{m.market_code}</td><td className="num">{num(m.accounts, locale)}</td><td className="num">{num(m.contacts, locale)}</td><td className="num">{num(m.deals, locale)}</td><td className="num">{num(m.leads, locale)}</td><td className="num">{num(m.activities, locale)}</td></tr>)}
          </Table>
          <p className="px-7 pb-6 text-[12.5px] text-muted" data-testid="import-users">
            {t(`Personas de Pipedrive: ${d.users.total}. Con acceso a CONTIGO: ${d.users.with_access}. Entran como ventas en el mercado donde llevan registros; los demás roles se dan en Personas y acceso.`,
              `Pipedrive users: ${d.users.total}. With CONTIGO access: ${d.users.with_access}. They enter as sales in the market where they own records; other roles are granted in People and access.`)}
          </p>
        </Card>

        <Card pad={false} data-testid="import-pipelines">
          <div className="px-7 pt-7"><CardTitle title={t('Embudos copiados', 'Pipelines copied')} hint={t('El cierre por primera transacción se ajusta por embudo en Embudos y campos.', 'Closing by first transaction is set per pipeline in Pipelines and fields.')} /></div>
          {d.pipelines.length === 0 ? <div className="p-7 pt-2"><Empty title={t('Todavía no hay embudos de Pipedrive', 'No Pipedrive pipelines yet')} /></div> : (
            <Table head={<><th>{t('Embudo', 'Pipeline')}</th><th>{t('Etapas', 'Stages')}</th><th>{t('Abiertos', 'Open')}</th><th>{t('Ganados', 'Won')}</th><th>{t('Perdidos', 'Lost')}</th><th>{t('Se gana', 'Won by')}</th></>}>
              {d.pipelines.map((p) => (
                <tr key={p.id} className="table-row" data-testid="import-pipeline-row">
                  <td><span className="block font-semibold text-strong">{p.name}</span><span className="text-[12.5px] text-muted-2">{p.market_code} · {lab(t, MOTOR[p.motor], p.motor)}</span></td>
                  <td className="num">{p.stages}</td><td className="num">{num(p.open, locale)}</td><td className="num">{num(p.won, locale)}</td><td className="num">{num(p.lost, locale)}</td>
                  <td className="text-[13px] text-muted-2">{p.close_by_transaction ? t('primera transacción', 'first transaction') : t('a mano', 'by hand')}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card data-testid="import-mapping">
        <CardTitle title={t('Mapeo de campos', 'Field mapping')} hint={t('Cada campo custom de Pipedrive existe en CONTIGO. La mayoría queda como campo adicional; los de abajo alimentan una columna del modelo o tienen una restricción.', 'Every Pipedrive custom field exists in CONTIGO. Most stay as additional fields; the ones below feed a model column or carry a restriction.')} />
        {d.fields.length === 0 ? <Empty title={t('Sin campos importados todavía', 'No imported fields yet')} /> : (
          <div className="space-y-6">
            {byObject.map((o) => {
              const all = d.fields.filter((f) => f.object === o)
              const special = all.filter((f) => f.mapped_to)
              return (
                <section key={o} data-testid={`mapping-${o}`}>
                  <h3 className="text-[14px] font-semibold text-strong">{lab(t, OBJ[o], o)} <span className="ml-2 text-[12.5px] font-normal text-muted-2">{t(`${all.length} campos, ${all.length - special.length} como campo adicional`, `${all.length} fields, ${all.length - special.length} as additional fields`)}</span></h3>
                  {special.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {special.map((f) => (
                        <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]" data-testid="mapping-row">
                          <span className="font-medium text-strong">{f.label_en}</span>
                          <span className="flex items-center gap-2 text-muted-2">→ {lab(t, DEST[f.mapped_to!], f.mapped_to!)}{f.mapped_to!.startsWith('policy:') && <Badge tone="warn">{t('restringido', 'restricted')}</Badge>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[13px] text-muted-2 underline">{t('Ver todos los campos', 'See every field')}</summary>
                    <ul className="mt-3 columns-1 gap-8 text-[13px] text-muted-2 sm:columns-2 xl:columns-3">
                      {all.map((f) => <li key={f.key} className="break-inside-avoid py-0.5">{f.label_en} <span className="text-muted">· {f.data_type}</span></li>)}
                    </ul>
                  </details>
                </section>
              )
            })}
          </div>
        )}
      </Card>

      <Card data-testid="import-connections">
        <CardTitle title={t('Conexiones y automatizaciones de Pipedrive', 'Pipedrive connections and automations')} hint={t('Inventario de lo que hoy depende de Pipedrive, para decidir cómo se reemplaza cada pieza. No se guardan credenciales ni parámetros de las URLs.', 'Inventory of what depends on Pipedrive today, to decide how each piece gets replaced. No credentials or URL parameters are stored.')} />
        {d.webhooks.length === 0 ? <p className="text-[13.5px] text-muted-2">{t('Sin webhooks registrados, o el token no puede leerlos.', 'No webhooks registered, or the token cannot read them.')}</p> : (
          <ul className="space-y-2">
            {d.webhooks.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]" data-testid="webhook-row">
                <span><code className="text-[12.5px] text-strong">{w.event}</code>{w.name ? <span className="ml-2 text-muted-2">{w.name}</span> : null}</span>
                <span className="flex items-center gap-2 text-muted-2">{w.target ?? <NoData locale={locale} />}<Badge tone={w.active ? 'good' : 'neutral'}>{w.active ? t('activo', 'active') : t('inactivo', 'inactive')}</Badge></span>
              </li>
            ))}
          </ul>
        )}
        {d.inventory.length > 0 && <p className="mt-5 text-[13px] text-muted-2">{d.inventory.map((x) => `${x.object.replace('_', ' ')}: ${x.n}`).join(' · ')}</p>}
        <p className="mt-4 text-[13px] text-muted">{t('Las automatizaciones, los reportes y las metas de Pipedrive no se leen por API: se levantaron de la pantalla y se reconstruyeron en CONTIGO. Dónde quedó cada uno está en "Qué falta por reconstruir".', 'Pipedrive automations, reports and goals cannot be read through the API: they were taken from the screen and rebuilt in CONTIGO. Where each one lives is in "What is left to rebuild".')}</p>
      </Card>
    </div>
  )
}
