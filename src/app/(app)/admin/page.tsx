import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { env } from '@/env'
import { getAudit, getConfig, getDataQuality, getIntake, getIntegrations, getUsers } from '@/dal/admin'
import { sellers } from '@/dal/leads'
import { API_SCOPES } from '@/domain/admin'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { FIELD_LABEL } from '@/domain/deals'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, RevealOnce, Submit } from '@/ui/client'
import { ago, day, dayTime, num } from '@/lib/format'
import { LIFECYCLE, MOTOR, lab, qs } from '@/lib/labels'
import { configurePipelineAction, createApiClientAction, endMembershipAction, grantMembershipAction, revokeApiClientAction, setRoutingMembersAction, simulateMetricsAction, simulateStoreAction, simulateVisitAction } from './actions'
import { PipedriveTab } from './pipedrive'
import { mergeAction } from '@/app/(app)/comercios/actions'

// La importación corre por pasos cortos; aun así se le da margen a cada llamada.
export const maxDuration = 60

const TABS = ['personas', 'embudos', 'entrada', 'integraciones', 'pipedrive', 'calidad', 'auditoria'] as const
type Tab = (typeof TABS)[number]

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; before?: string }> }) {
  const ctx = await requireCtx()
  const admin = ctx.can('config.manage')
  if (!admin && !ctx.can('audit.read')) notFound()
  const { t, locale } = ctx
  const sp = await searchParams
  const allowed: Tab[] = admin ? [...TABS] : ['embudos', 'auditoria']
  const tab: Tab = allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : allowed[0]!
  const labels: Record<Tab, string> = {
    personas: t('Personas y acceso', 'People and access'),
    embudos: t('Embudos y campos', 'Pipelines and fields'),
    entrada: t('Formularios y turnos', 'Forms and rotation'),
    integraciones: t('Integraciones', 'Integrations'),
    pipedrive: 'Pipedrive',
    calidad: t('Calidad de datos', 'Data quality'),
    auditoria: t('Auditoría', 'Audit'),
  }
  const live = ctx.markets.filter((m) => m.status === 'live')
  const staging = env().APP_ENV !== 'production'

  return (
    <>
      <PageHeader title={t('Administración', 'Administration')} desc={t('La configuración se hace aquí y queda en la bitácora. Ventas opera; administración configura.', 'Configuration happens here and is logged. Sales operates; administration configures.')} />
      <div className="mb-8"><Pills label={t('Secciones', 'Sections')} current={tab} items={allowed.map((k) => ({ key: k, href: qs('/admin', { tab: k }), label: labels[k] }))} /></div>
      {tab === 'personas' && <People />}
      {tab === 'embudos' && <Config />}
      {tab === 'entrada' && <Intake />}
      {tab === 'integraciones' && <Integrations />}
      {tab === 'pipedrive' && <PipedriveTab ctx={ctx} />}
      {tab === 'calidad' && <Quality />}
      {tab === 'auditoria' && <Audit />}
    </>
  )

  async function People() {
    const d = await getUsers(ctx)
    return (
      <Card pad={false} data-testid="admin-people">
        <div className="flex items-start justify-between gap-4 px-7 pt-7">
          <CardTitle title={t('Personas', 'People')} hint={t('El acceso es una membresía con rol y mercado. Quitarlo la cierra con fecha; no borra a la persona ni su historial.', 'Access is a membership with a role and a market. Removing it closes it with a date; the person and their history stay.')} />
          <Dialog trigger={t('Dar acceso', 'Grant access')} title={t('Dar acceso', 'Grant access')} variant="primary" testId="grant-open">
            <ActionForm action={grantMembershipAction} onOk="close" className="grid grid-cols-2 gap-4">
              <Field label={t('Correo', 'Email')} className="col-span-2" hint={t(`Solo cuentas de ${env().AUTH_ALLOWED_DOMAIN}.`, `Only ${env().AUTH_ALLOWED_DOMAIN} accounts.`)}><input name="email" type="email" className="input" required data-testid="grant-email" /></Field>
              <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="full_name" className="input" required minLength={2} data-testid="grant-name" /></Field>
              <Field label={t('Rol', 'Role')}><select name="role" className="input" data-testid="grant-role">{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</option>)}</select></Field>
              <Field label={t('Mercado', 'Market')} hint={t('Vacío para roles globales.', 'Empty for global roles.')}><select name="market" className="input" data-testid="grant-market"><option value="">—</option>{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
              <Field label={t('Equipo', 'Team')} className="col-span-2"><select name="team_id" className="input"><option value="">—</option>{d.teams.map((x) => <option key={x.id} value={x.id}>{x.market_code} · {x.name}</option>)}</select></Field>
              <div className="col-span-2 flex justify-end"><Submit testId="grant-save">{t('Dar acceso', 'Grant access')}</Submit></div>
            </ActionForm>
          </Dialog>
        </div>
        <Table testId="people-table" head={<><th>{t('Persona', 'Person')}</th><th>{t('Acceso', 'Access')}</th><th>{t('Días activos (14)', 'Active days (14)')}</th><th>{t('Acciones (14 días)', 'Actions (14 days)')}</th><th>{t('Última vez', 'Last seen')}</th></>}>
          {d.users.map((u) => (
            <tr key={u.id} className="table-row" data-testid="person-row">
              <td><span className="block font-semibold text-strong">{u.full_name}</span><span className="text-[12.5px] text-muted-2">{u.email}{u.is_synthetic ? ` · ${t('sintética', 'synthetic')}` : ''}</span></td>
              <td>
                <div className="flex flex-wrap gap-2">
                  {d.memberships.filter((m) => m.user_id === u.id).map((m) => (
                    <ActionForm key={m.id} action={endMembershipAction} className="inline-flex">
                      <input type="hidden" name="id" value={m.id} />
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 py-1 pr-1 pl-3 text-[12px] font-semibold text-muted-2">
                        {t(ROLE_LABEL[m.role as Role].es, ROLE_LABEL[m.role as Role].en)}{m.market_code ? ` · ${m.market_code}` : ''}{m.team ? ` · ${m.team}` : ''}
                        <button className="rounded-full px-1.5 text-muted hover:bg-red/15 hover:text-red-text" aria-label={t('Quitar acceso', 'Remove access')} data-testid="membership-end">✕</button>
                      </span>
                    </ActionForm>
                  ))}
                </div>
              </td>
              <td className="num">{u.active_days}</td>
              <td className="num">{u.actions}</td>
              <td className="text-[13px] text-muted-2">{u.last_seen ? ago(u.last_seen, locale) : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    )
  }

  async function Config() {
    const d = await getConfig(ctx)
    return (
      <div className="space-y-8" data-testid="admin-config">
        {d.pipelines.map((p) => (
          <Card key={p.id} pad={false}>
            <div className="px-7 pt-7"><CardTitle title={`${p.market_code} · ${p.name}`} hint={lab(t, MOTOR[p.motor])} /></div>
            <Table head={<><th>#</th><th>{t('Etapa', 'Stage')}</th><th>{t('Para entrar hace falta', 'Required to enter')}</th><th>{t('Criterio de salida', 'Exit criteria')}</th><th>{t('Se estanca a los', 'Stalls after')}</th></>}>
              {d.stages.filter((s) => s.pipeline_id === p.id).map((s) => (
                <tr key={s.position} className="table-row">
                  <td className="num text-muted">{s.position}</td>
                  <td><span className="font-semibold text-strong">{t(s.name_es, s.name_en)}</span>{s.kind === 'awaiting_txn' && <span className="ml-2"><Badge tone="info">{t('espera a S5', 'waits for S5')}</Badge></span>}{s.kind === 'won' && <span className="ml-2"><Badge tone="good">{p.close_by_transaction ? t('solo por transacción', 'by transaction only') : t('cierre manual', 'closed by hand')}</Badge></span>}</td>
                  <td className="text-[13.5px] text-muted-2">{[...(s.kind === 'open' ? ['next_step'] : []), ...s.required_fields].filter((v, i, a) => a.indexOf(v) === i).map((f) => t(FIELD_LABEL[f]?.es ?? f, FIELD_LABEL[f]?.en ?? f)).join(', ') || (s.kind === 'lost' ? t('motivo de pérdida', 'loss reason') : '—')}</td>
                  <td className="text-[13.5px] text-muted-2">{t(s.exit_es, s.exit_en) || '—'}</td>
                  <td className="num text-[13.5px]">{s.rot_days ? t(`${s.rot_days} días`, `${s.rot_days} days`) : '—'}</td>
                </tr>
              ))}
            </Table>
            {admin && (
              <ActionForm action={configurePipelineAction} className="flex flex-wrap items-end gap-5 border-t border-line px-7 py-5" testId="pipeline-config">
                <input type="hidden" name="pipeline_id" value={p.id} />
                <label className="flex items-center gap-2 pb-3 text-[13.5px]"><input type="checkbox" name="close_by_transaction" className="h-4 w-4" defaultChecked={p.close_by_transaction} data-testid="pipeline-cbt" />{t('Se gana con la primera transacción (S5)', 'Won by the first transaction (S5)')}</label>
                <Field label={t('Etapa que espera la transacción', 'Stage that waits for the transaction')}>
                  <select name="awaiting_stage_id" className="input !w-64" defaultValue={d.stages.find((s) => s.pipeline_id === p.id && s.kind === 'awaiting_txn')?.id ?? ''}>
                    <option value="">{t('Ninguna', 'None')}</option>
                    {d.stages.filter((s) => s.pipeline_id === p.id && (s.kind === 'open' || s.kind === 'awaiting_txn')).map((s) => <option key={s.id} value={s.id}>{t(s.name_es, s.name_en)}</option>)}
                  </select>
                </Field>
                <Submit variant="ghost" size="sm" testId="pipeline-config-save">{t('Guardar', 'Save')}</Submit>
              </ActionForm>
            )}
          </Card>
        ))}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <Card><CardTitle title={t('Registro de campos', 'Field registry')} hint={t('Los campos por mercado son metadata: se agregan sin tocar el esquema.', 'Per-market fields are metadata: they are added without touching the schema.')} />
            {d.imported.length > 0 && <p className="mb-4 text-[13.5px] text-muted-2" data-testid="imported-fields">{t('Importados de Pipedrive: ', 'Imported from Pipedrive: ')}{d.imported.map((x) => `${x.object} ${x.n}`).join(' · ')}. <Link href="/admin?tab=pipedrive" className="underline">{t('Ver el mapeo', 'See the mapping')}</Link></p>}
            <ul className="space-y-2.5">{d.fields.map((f) => <li key={`${f.object}${f.key}${f.market_code}`} className="flex items-center justify-between gap-3 text-[14px]"><span><code className="text-[12.5px] text-muted-2">{f.object}.{f.key}</code> <span className="ml-2 font-medium text-strong">{t(f.label_es, f.label_en)}</span></span><span className="flex gap-2"><Badge>{f.market_code ?? t('todos', 'all')}</Badge><Badge>{f.data_class}</Badge></span></li>)}</ul>
          </Card>
          <Card><CardTitle title={t('Motivos codificados', 'Coded reasons')} hint={t('Mismos códigos en todos los mercados; la etiqueta cambia con el idioma.', 'Same codes in every market; the label changes with the language.')} />
            <ul className="space-y-2.5">{d.reasons.map((r) => <li key={r.code} className="flex items-center justify-between gap-3 text-[14px]"><span className="font-medium text-strong">{t(r.label_es, r.label_en)}</span><Badge tone={r.kind === 'lost' ? 'bad' : 'warn'}>{r.kind === 'lost' ? t('pérdida de deal', 'deal loss') : t('visita sin venta', 'no-sale visit')}</Badge></li>)}</ul>
          </Card>
        </div>
      </div>
    )
  }

  async function Intake() {
    const [d, people] = await Promise.all([getIntake(ctx), sellers(ctx)])
    return (
      <div className="space-y-8" data-testid="admin-intake">
        <Card pad={false}>
          <div className="px-7 pt-7"><CardTitle title={t('Formularios web', 'Web forms')} hint={t('Cada formulario tiene una página lista para usar y una API para conectarlo desde el sitio web.', 'Each form has a ready-to-use page and an API to connect it from the website.')} /></div>
          <Table testId="form-table" head={<><th>{t('Formulario', 'Form')}</th><th>{t('Página', 'Page')}</th><th>API</th><th>{t('Reparte por', 'Routed by')}</th><th>{t('Leads 30 días', 'Leads, 30 days')}</th></>}>
            {d.forms.map((f) => (
              <tr key={f.id} className="table-row" data-testid="form-row">
                <td><span className="block font-semibold text-strong">{f.name}</span><span className="text-[12.5px] text-muted-2">{f.market_code} · {lab(t, MOTOR[f.motor])}</span></td>
                <td><Link href={`/f/${f.slug}`} className="text-[13.5px] text-blue-text underline" data-testid="form-link">/f/{f.slug}</Link></td>
                <td><code className="text-[12.5px] text-muted-2">POST /api/v1/forms/{f.slug}</code></td>
                <td className="text-[13.5px]">{f.rule ?? '—'}</td>
                <td className="num">{f.leads_30d}</td>
              </tr>
            ))}
          </Table>
        </Card>
        {d.rules.map((r) => {
          const pool = people.filter((p) => p.market_code === r.market_code)
          return (
            <Card key={r.id} data-testid="rule-card">
              <CardTitle title={r.name} hint={t(`Turno rotativo · respuesta en ${r.sla_minutes} min · si nadie está disponible va a ${r.fallback ?? '—'}`, `Round robin · response within ${r.sla_minutes} min · falls back to ${r.fallback ?? '—'}`)} right={<Badge>{r.market_code}</Badge>} />
              <ActionForm action={setRoutingMembersAction}>
                <input type="hidden" name="rule_id" value={r.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pool.map((p) => {
                    const idx = r.member_ids.indexOf(p.id)
                    return (
                      <label key={p.id} className="card-2 flex cursor-pointer items-center gap-3 px-4 py-3">
                        <input type="checkbox" name="member_id" value={p.id} defaultChecked={idx >= 0} className="h-4 w-4" data-testid="rule-member" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-strong">{p.full_name}</span><span className="text-[12.5px] text-muted-2">{t(`${d.load[p.id] ?? 0} leads en 30 días`, `${d.load[p.id] ?? 0} leads in 30 days`)}</span></span>
                        {idx >= 0 && idx === r.cursor % Math.max(1, r.member_ids.length) && <Badge tone="accent">{t('sigue', 'next')}</Badge>}
                      </label>
                    )
                  })}
                </div>
                <div className="mt-5 flex justify-end"><Submit variant="ghost" testId="rule-save">{t('Guardar turno', 'Save rotation')}</Submit></div>
              </ActionForm>
            </Card>
          )
        })}
      </div>
    )
  }

  async function Integrations() {
    const d = await getIntegrations(ctx)
    return (
      <div className="space-y-8" data-testid="admin-integrations">
        <div className="rounded-[22px] bg-surface-3 px-6 py-5 text-[14px] text-muted-2" data-testid="integration-status">
          <strong className="text-strong">{t('Estado: contrato propuesto, sin conexión real todavía.', 'Status: proposed contract, no live connection yet.')}</strong>{' '}
          {t('CONTIGO ya recibe eventos de la Sales App y el archivo diario de S5 por una API versionada. Falta que los equipos dueños de esos sistemas acuerden el contrato y lo conecten.', 'CONTIGO already accepts Sales App events and the S5 daily file through a versioned API. The teams that own those systems still need to agree on the contract and connect it.')}
        </div>

        {staging && (
          <Card data-testid="integration-lab">
            <CardTitle title={t('Probar el contrato (solo staging)', 'Try the contract (staging only)')} hint={t('Cada botón manda el mismo mensaje que mandaría el sistema real, por el mismo camino.', 'Each button sends the same message the real system would, down the same path.')} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <ActionForm action={simulateMetricsAction} className="card-2 p-5" testId="sim-metrics">
                <p className="text-[14.5px] font-semibold text-strong">{t('S5: primera transacción', 'S5: first transaction')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('Carga un archivo diario con la primera venta de un comercio que está esperando. Su deal se gana solo.', 'Loads a daily file with the first sale of a waiting merchant. Its deal wins on its own.')}</p>
                <Field label={t('Comercio esperando primera venta', 'Merchant awaiting first sale')}>
                  <select name="merchant_ref" className="input" data-testid="sim-metrics-ref">{d.awaiting.map((a) => <option key={a.alias} value={a.alias}>{a.name} · {a.alias}</option>)}</select>
                </Field>
                <input type="hidden" name="currency" value={d.awaiting[0]?.currency ?? 'USD'} />
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-metrics-send">{t('Cargar archivo', 'Load file')}</Submit></div>
              </ActionForm>
              <ActionForm action={simulateVisitAction} className="card-2 p-5" testId="sim-visit">
                <p className="text-[14.5px] font-semibold text-strong">{t('Sales App: visita', 'Sales App: visit')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('Una visita sin decisor deja el deal marcado con revisita.', 'A visit with no decision-maker flags the deal for a revisit.')}</p>
                <Field label={t('Comercio', 'Merchant')}><select name="customer_id" className="input" data-testid="sim-visit-ref">{d.visitable.map((a) => <option key={a.alias} value={a.alias}>{a.name} · {a.alias}</option>)}<option value="SC-XX-000000">{t('ID que no existe', 'An ID that does not exist')}</option></select></Field>
                <Field label={t('Resultado', 'Outcome')} className="mt-3"><select name="outcome" className="input" data-testid="sim-visit-outcome"><option value="revisit">{t('Sin venta: no estaba el decisor', 'No sale: decision-maker absent')}</option><option value="sale">{t('Con venta', 'With a sale')}</option><option value="no_sale">{t('Sin venta: tiene inventario', 'No sale: has stock')}</option></select></Field>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-visit-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
              <ActionForm action={simulateStoreAction} onOk="reset" className="card-2 p-5" testId="sim-store">
                <p className="text-[14.5px] font-semibold text-strong">{t('Sales App: PDV nuevo', 'Sales App: new store')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('El PDV nace en la Sales App. CONTIGO le emite su ID o lo liga al prospecto que ya existía.', 'The store is born in the Sales App. CONTIGO issues its ID or links it to the prospect that already existed.')}</p>
                <Field label={t('Nombre', 'Name')}><input name="name" className="input" required minLength={2} data-testid="sim-store-name" /></Field>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={t('Mercado', 'Market')}><select name="market" className="input">{live.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}</select></Field>
                  <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" data-testid="sim-store-phone" /></Field>
                </div>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-store-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <Card data-testid="inbound-log"><CardTitle title={t('Lo que llegó', 'What came in')} hint={t('Cada mensaje lleva una llave: si llega dos veces, se procesa una.', 'Every message carries a key: if it arrives twice, it is processed once.')} />
            {d.events.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía no llega nada.', 'Nothing has arrived yet.')}</p> : (
              <ul className="space-y-2.5">{d.events.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 text-[13.5px]" data-testid="inbound-row"><span><code className="text-[12.5px]">{e.source} · {e.event_type}</code><span className="ml-2 text-muted">{ago(e.received_at, locale)}</span></span><Badge tone={e.status === 'processed' ? 'good' : e.status === 'rejected' ? 'bad' : 'neutral'}>{e.status === 'processed' ? t('procesado', 'processed') : e.status === 'rejected' ? t('sin comercio', 'no merchant') : t('recibido', 'received')}</Badge></li>)}</ul>
            )}
            <p className="eyebrow mt-7 mb-3">{t('Archivos diarios de S5', 'S5 daily files')}</p>
            <ul className="space-y-2.5">{d.batches.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 text-[13.5px]" data-testid="batch-row"><span className="truncate"><code className="text-[12.5px]">{b.file_name}</code></span><span className="shrink-0 text-muted-2">{t(`${num(b.matched, locale)} de ${num(b.row_count, locale)} filas ligadas`, `${num(b.matched, locale)} of ${num(b.row_count, locale)} rows matched`)} · {day(b.as_of, locale)}</span></li>)}</ul>
          </Card>
          <Card data-testid="outbox-log"><CardTitle title={t('Lo que sale (outbox)', 'What goes out (outbox)')} hint={t('Los eventos se guardan en la misma transacción que el cambio. Falta conectar quién los publica.', 'Events are stored in the same transaction as the change. The publisher still needs to be connected.')} right={<Badge tone={d.outboxPending ? 'warn' : 'good'}>{t(`${num(d.outboxPending, locale)} por publicar`, `${num(d.outboxPending, locale)} to publish`)}</Badge>} />
            <ul className="space-y-2.5">{d.outbox.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 text-[13.5px]"><code className="text-[12.5px]">{o.event_type}</code><span className="text-muted-2">{o.market_code ?? '—'} · {ago(o.created_at, locale)}</span></li>)}</ul>
          </Card>
        </div>

        <Card data-testid="api-clients">
          <CardTitle title={t('Llaves de API', 'API keys')} hint={t('La llave se muestra una sola vez. En la base solo queda su huella.', 'The key is shown once. Only its fingerprint is stored.')} />
          <RevealOnce action={createApiClientAction} label={t('Copia esta llave ahora. No se vuelve a mostrar.', 'Copy this key now. It will not be shown again.')}>
            <div className="flex flex-wrap items-end gap-4">
              <Field label={t('Nombre del sistema', 'System name')}><input name="name" className="input !w-64" required minLength={3} data-testid="api-name" /></Field>
              <fieldset className="flex flex-wrap gap-x-4 gap-y-2 pb-3 text-[13.5px]"><legend className="sr-only">Scopes</legend>{API_SCOPES.map((s) => <label key={s} className="flex items-center gap-2"><input type="checkbox" name="scope" value={s} className="h-4 w-4" defaultChecked={s === 'events:write'} />{s}</label>)}</fieldset>
              <Submit variant="ghost" testId="api-create">{t('Crear llave', 'Create key')}</Submit>
            </div>
          </RevealOnce>
          <ul className="mt-6 space-y-2.5">
            {d.clients.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-[14px]" data-testid="api-row">
                <span><span className="font-semibold text-strong">{c.name}</span> <code className="ml-2 text-[12.5px] text-muted-2">{c.key_prefix}…</code> <span className="ml-2 text-[12.5px] text-muted">{c.scopes.join(', ')}</span></span>
                {c.revoked_at ? <Badge tone="bad">{t('revocada', 'revoked')}</Badge> : <ActionForm action={revokeApiClientAction}><input type="hidden" name="id" value={c.id} /><Submit variant="quiet" size="sm" testId="api-revoke">{t('Revocar', 'Revoke')}</Submit></ActionForm>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    )
  }

  async function Quality() {
    const d = await getDataQuality(ctx)
    return (
      <div className="space-y-8" data-testid="admin-quality">
        <Card pad={false}>
          <div className="px-7 pt-7"><CardTitle title={t('Huecos por mercado', 'Gaps by market')} /></div>
          <Table head={<><th>{t('Mercado', 'Market')}</th><th>{t('Comercios', 'Merchants')}</th><th>{t('Sin dueño', 'No owner')}</th><th>{t('Sin teléfono', 'No phone')}</th><th>{t('Sin contacto', 'No contact')}</th><th>{t('Sin ID externo', 'No external ID')}</th></>}>
            {d.gaps.map((g) => <tr key={g.market_code} className="table-row"><td className="font-semibold text-strong">{g.market_code}</td><td className="num">{num(g.total, locale)}</td><td className="num">{g.no_owner}</td><td className="num">{g.no_phone}</td><td className="num">{g.no_contact}</td><td className="num">{g.no_alias}</td></tr>)}
          </Table>
        </Card>
        <Card data-testid="duplicates">
          <CardTitle title={t('Posibles duplicados', 'Possible duplicates')} hint={t('Fusionar pasa todo al comercio que se queda y archiva el otro. Nada se borra.', 'Merging moves everything to the surviving merchant and archives the other. Nothing is deleted.')} />
          {d.dups.length === 0 ? <Empty title={t('Sin duplicados detectados', 'No duplicates detected')} hint={t('Se detectan por teléfono al capturar y cada vez que corren las reglas.', 'They are detected by phone on entry and every time the rules run.')} /> : (
            <ul>
              {d.dups.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-4 first:border-t-0" data-testid="dup-row">
                  <span className="text-[14px]">
                    <Link href={`/comercios/${x.a_id}`} className="font-semibold text-strong underline">{x.a_name}</Link> <span className="text-muted-2">({lab(t, LIFECYCLE[x.a_lifecycle]?.label)})</span>
                    <span className="mx-2 text-muted">↔</span>
                    <Link href={`/comercios/${x.b_id}`} className="font-semibold text-strong underline">{x.b_name}</Link> <span className="text-muted-2">({lab(t, LIFECYCLE[x.b_lifecycle]?.label)})</span>
                  </span>
                  <ActionForm action={mergeAction} className="flex items-center gap-2">
                    <input type="hidden" name="source_id" value={x.b_id} /><input type="hidden" name="target_id" value={x.a_id} />
                    <Submit variant="ghost" size="sm" testId="merge">{t(`Fusionar en "${x.a_name}"`, `Merge into "${x.a_name}"`)}</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }

  async function Audit() {
    const d = await getAudit(ctx, { before: sp.before })
    return (
      <Card pad={false} data-testid="admin-audit">
        <div className="px-7 pt-7"><CardTitle title={t('Bitácora', 'Audit log')} hint={t('Solo se agrega. Ni la aplicación ni quien administra puede editarla o borrarla.', 'Append-only. Neither the application nor an admin can edit or delete it.')} /></div>
        <Table testId="audit-table" head={<><th>{t('Cuándo', 'When')}</th><th>{t('Quién', 'Who')}</th><th>{t('Qué', 'What')}</th><th>{t('Sobre', 'On')}</th><th>{t('Mercado', 'Market')}</th></>}>
          {d.items.map((e) => (
            <tr key={e.id} className="table-row" data-testid="audit-row">
              <td className="text-[13px] whitespace-nowrap text-muted-2">{dayTime(e.at, locale)}</td>
              <td className="text-[13.5px]">{e.actor ?? '—'}</td>
              <td><code className="text-[12.5px] text-strong">{e.action}</code></td>
              <td className="text-[13px] text-muted-2">{e.object}{e.object_id ? ` · ${e.object_id.slice(0, 8)}` : ''}</td>
              <td className="text-[13px]">{e.market_code ?? '—'}</td>
            </tr>
          ))}
        </Table>
        {d.items.length === 0 && <div className="p-7"><Empty title={t('Sin eventos todavía', 'No events yet')} /></div>}
        {d.next && <div className="flex justify-center border-t border-line py-5"><LinkButton href={qs('/admin', { tab: 'auditoria', before: d.next })} size="sm">{t('Ver más', 'Load more')}</LinkButton></div>}
      </Card>
    )
  }
}
