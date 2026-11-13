import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { flags, platformValues, privacyNotices, redteamReviews, REDTEAM_CHECKLIST } from '@/domain/plataforma/admin'
import { mcpClients } from '@/domain/plataforma/mcp-oauth'
import { platformAdmin } from '@/dal/plataforma'
import { AGENTS } from '@/domain/ia/agents'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { mcpMode } from '@/server/adapters/ai'
import { Badge, Card, CardTitle, Empty, Field, PageHeader } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { day, num } from '@/lib/format'
import * as A from './actions'

export const dynamic = 'force-dynamic'

const row = 'flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0'
const small = 'text-[13px] text-muted'
const ROLES: Role[] = ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'agency', 'partner']
const AUDIENCE = { owner: ['A quien lo lleva', 'To whoever owns it'], market_leads: ['A quien lidera el mercado', 'To the market lead'], admins: ['A administración', 'To administration'] } as const
const CONSUMER = { automations: ['Automatizaciones por evento', 'Event automations'], notices: ['Avisos por evento', 'Event notices'], live: ['Pantallas en vivo', 'Live screens'] } as Record<string, [string, string]>

/**
 * Plataforma: funciones por rol (flags), valores propuestos con su dueño, avisos que salen de la cola de eventos,
 * revisión de red-team de cada agente, agentes con permiso de leer como una persona (MCP) y responsables de cada conexión.
 * La lee quien gobierna; la cambia administración.
 */
export default async function PlatformPage() {
  const ctx = await requireCtx()
  if (!ctx.can('platform.manage') && !ctx.can('gov.read')) notFound()
  const { t, locale } = ctx
  const manage = ctx.can('platform.manage')
  const [fl, values, data, reviews, clients, notices] = await Promise.all([flags(ctx), platformValues(ctx), platformAdmin(ctx), ctx.can('ia.oversee') ? redteamReviews(ctx) : Promise.resolve([]), mcpClients(ctx), privacyNotices(ctx)])
  const valueText = (v: (typeof values)[number]) =>
    v.kind === 'boolean' ? (v.value === true ? t('Encendido', 'On') : t('Apagado', 'Off')) : v.value === null || v.value === undefined ? t('Sin valor', 'No value') : v.kind === 'days' ? t(`${v.value} días`, `${v.value} days`) : String(v.value)
  return (
    <>
      <PageHeader eyebrow={t('Administración', 'Administration')} title={t('Plataforma', 'Platform')} desc={t('Funciones por rol, valores que todavía son propuesta, avisos por evento, agentes y responsables de cada conexión.', 'Features by role, values that are still a proposal, event notices, agents and owners of each connection.')} />
      <div className="space-y-8">
        <Card data-testid="flags-card">
          <CardTitle title={t('Funciones por rol y mercado', 'Features by role and market')} hint={t('Sin roles marcados aplica a todos; sin mercados, a todos los mercados. Cada cambio queda en la bitácora.', 'With no roles checked it applies to everyone; with no markets, to every market. Each change is logged.')} />
          <ul>
            {fl.map((f) => (
              <li key={f.key} className={row} data-testid={`flag-${f.key}`}>
                <div className="min-w-0 flex-1 basis-[240px]">
                  <p className="text-[15px] font-semibold text-strong">{t(f.label_es, f.label_en)}</p>
                  <p className={small}>{f.roles.length ? f.roles.map((r) => t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)).join(', ') : t('Todos los roles', 'All roles')} · {f.markets.length ? f.markets.join(', ') : t('Todos los mercados', 'All markets')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={f.enabled ? 'good' : 'neutral'}>{f.enabled ? t('Encendida', 'On') : t('Apagada', 'Off')}</Badge>
                  {manage && (
                    <Dialog trigger={t('Cambiar', 'Change')} title={t(f.label_es, f.label_en)} variant="quiet" size="sm" testId={`flag-edit-${f.key}`}>
                      <ActionForm action={A.setFlagAction} onOk="close">
                        <input type="hidden" name="key" value={f.key} />
                        <label className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="enabled" defaultChecked={f.enabled} className="size-5" data-testid="flag-enabled" />{t('Encendida', 'On')}</label>
                        <fieldset className="mt-3"><legend className="mb-2 text-[13px] font-semibold text-muted-2">{t('Solo para estos roles', 'Only for these roles')}</legend>
                          <div className="flex flex-wrap gap-x-4">{ROLES.map((r) => <label key={r} className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="roles" value={r} defaultChecked={f.roles.includes(r)} className="size-5" data-testid={`flag-role-${r}`} />{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</label>)}</div>
                        </fieldset>
                        <fieldset className="mt-3"><legend className="mb-2 text-[13px] font-semibold text-muted-2">{t('Solo en estos mercados', 'Only in these markets')}</legend>
                          <div className="flex flex-wrap gap-x-4">{ctx.markets.map((m) => <label key={m.code} className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="markets" value={m.code} defaultChecked={f.markets.includes(m.code)} className="size-5" />{m.name}</label>)}</div>
                        </fieldset>
                        <div className="mt-4"><Submit testId="flag-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="values-card">
          <CardTitle title={t('Valores propuestos', 'Proposed values')} hint={t('Datos que decide otra persona. Mientras no los confirme quien decide, quedan como propuesta y salen en Estado de CONTIGO.', 'Facts someone else decides. Until their owner confirms them, they stay as a proposal and show in CONTIGO status.')} />
          <ul>
            {values.map((v) => (
              <li key={v.key} className={row} data-testid={`value-${v.key}`}>
                <div className="min-w-0 flex-1 basis-[240px]">
                  <p className="text-[15px] font-semibold text-strong">{t(v.label_es, v.label_en)}</p>
                  <p className={small}>{t(v.help_es, v.help_en)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-strong" data-testid="value-current">{valueText(v)}</span>
                  {v.proposed ? <Badge tone="warn">{t(`Valor propuesto, pendiente: ${v.owner_label}`, `Proposed value, pending: ${v.owner_label}`)}</Badge> : <Badge tone="good">{t('Confirmado', 'Confirmed')}</Badge>}
                  {manage && v.kind !== 'text' && (
                    <Dialog trigger={t('Cambiar', 'Change')} title={t(v.label_es, v.label_en)} variant="quiet" size="sm" testId={`value-edit-${v.key}`}>
                      <ActionForm action={A.setValueAction} onOk="close">
                        <input type="hidden" name="key" value={v.key} />
                        <input type="hidden" name="kind" value={v.kind} />
                        {v.kind === 'boolean' ? (
                          <label className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="value" value="true" defaultChecked={v.value === true} className="size-5" />{t('Encendido', 'On')}</label>
                        ) : (
                          <Field label={t('Días', 'Days')} hint={t('Entre 30 y 3650. Vacío: sin plazo.', 'Between 30 and 3650. Empty: no period.')}><input name="value" type="number" min={30} max={3650} defaultValue={typeof v.value === 'number' ? v.value : ''} className="input" /></Field>
                        )}
                        <label className="mt-3 flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="confirmed" className="size-5" data-testid="value-confirmed" />{t(`Lo confirmó ${v.owner_label}`, `Confirmed by ${v.owner_label}`)}</label>
                        <div className="mt-4"><Submit testId="value-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="privacy-card">
          <CardTitle title={t('Aviso de privacidad por mercado', 'Privacy notice by market')} hint={t('El texto lo da Legal. Aquí se anota qué versión rige en cada mercado; los consentimientos nuevos guardan esa versión.', 'Legal provides the text. Here you record which version applies in each market; new consents keep that version.')} />
          <ul>
            {notices.map((n) => (
              <li key={n.code} className={row} data-testid={`privacy-${n.code}`}>
                <div className="min-w-0 flex-1 basis-[200px]"><p className="text-[15px] font-semibold text-strong">{n.name}</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  {n.version ? <Badge tone="good">{t(`Versión ${n.version}`, `Version ${n.version}`)}</Badge> : <Badge tone="warn">{t('Sin aviso vigente, pendiente: Legal', 'No notice in force, pending: Legal')}</Badge>}
                  {ctx.can('security.manage') && (
                    <Dialog trigger={t('Cambiar', 'Change')} title={t(`Aviso de privacidad, ${n.name}`, `Privacy notice, ${n.name}`)} variant="quiet" size="sm" testId={`privacy-edit-${n.code}`}>
                      <ActionForm action={A.setPrivacyNoticeAction} onOk="close">
                        <input type="hidden" name="market" value={n.code} />
                        <Field label={t('Versión que dio Legal', 'Version given by Legal')} hint={t('Vacío: sin aviso vigente.', 'Empty: no notice in force.')}><input name="version" className="input" maxLength={40} defaultValue={n.version ?? ''} data-testid="privacy-version" /></Field>
                        <div className="mt-4"><Submit testId="privacy-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="rules-card">
          <CardTitle title={t('Avisos por evento', 'Event notices')} hint={t('Salen de la cola de eventos: cuando pasa algo, se avisa a quien corresponde por el servicio de avisos (dentro de CONTIGO y, si la persona lo pidió, por correo, Slack, WhatsApp o push). Nunca a quien hizo el cambio.', 'They come from the event queue: when something happens, the right person is notified through the notice service (inside CONTIGO and, if the person asked, by email, Slack, WhatsApp or push). Never the person who made the change.')} />
          {data.rules.length === 0 ? <Empty title={t('No hay reglas de aviso por evento', 'There are no event notice rules')} /> : (
            <ul>
              {data.rules.map((r) => (
                <li key={r.id} className={row} data-testid={`rule-${r.event_type}`}>
                  <div className="min-w-0 flex-1 basis-[240px]">
                    <p className="text-[15px] font-semibold text-strong">{t(r.title_es, r.title_en)}</p>
                    <p className={small}>{t(AUDIENCE[r.audience][0], AUDIENCE[r.audience][1])}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.is_active ? 'good' : 'neutral'}>{r.is_active ? t('Encendida', 'On') : t('Apagada, propuesta', 'Off, proposed')}</Badge>
                    {manage && (
                      <ActionForm action={A.toggleRuleAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="active" value={r.is_active ? '0' : '1'} />
                        <Submit variant="quiet" size="sm" testId="rule-toggle">{r.is_active ? t('Apagar', 'Turn off') : t('Encender', 'Turn on')}</Submit>
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-4 border-t border-line pt-3" data-testid="consumers">
            {data.lag.map((c) => (
              <li key={c.consumer} className="flex flex-wrap justify-between gap-2 py-1.5 text-[13.5px]" data-testid={`consumer-${c.consumer}`}>
                <span className="text-strong">{CONSUMER[c.consumer] ? t(CONSUMER[c.consumer]![0], CONSUMER[c.consumer]![1]) : c.consumer}</span>
                <span className="text-muted-2">{t(`${num(c.pending, locale)} por leer · ${num(c.taken, locale)} leídos`, `${num(c.pending, locale)} to read · ${num(c.taken, locale)} read`)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {ctx.can('ia.oversee') && (
          <Card data-testid="redteam-card">
            <CardTitle title={t('Red-team de agentes', 'Agent red-team')} hint={t('Antes de que un agente redacte o proponga acciones, alguien de administración lo prueba con esta lista. Sin revisión aprobada no se puede encender.', 'Before an agent drafts or proposes actions, someone in administration tests it with this list. Without a passed review it cannot be turned on.')} />
            <ul>
              {AGENTS.map((a) => {
                const last = reviews.find((r) => r.agent_key === a.key)
                return (
                  <li key={a.key} className={row} data-testid={`redteam-${a.key}`}>
                    <div className="min-w-0 flex-1 basis-[240px]">
                      <p className="text-[15px] font-semibold text-strong">{t(a.name[0], a.name[1])}</p>
                      <p className={small}>{last ? t(`Última revisión: ${day(last.reviewed_at, locale)}${last.reviewer ? `, ${last.reviewer}` : ''}`, `Last review: ${day(last.reviewed_at, locale)}${last.reviewer ? `, ${last.reviewer}` : ''}`) : t('Sin revisión', 'No review')}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={last?.passed ? 'good' : 'warn'} >{last?.passed ? t('Aprobada', 'Passed') : t('Falta aprobar', 'Not passed')}</Badge>
                      {ctx.can('ia.manage') && (
                        <Dialog trigger={t('Revisar', 'Review')} title={t(`Red-team: ${a.name[0]}`, `Red-team: ${a.name[1]}`)} variant="quiet" size="md" testId={`redteam-open-${a.key}`}>
                          <ActionForm action={A.redteamAction} onOk="close">
                            <input type="hidden" name="agent" value={a.key} />
                            <ul className="space-y-1">
                              {REDTEAM_CHECKLIST.map((c) => <li key={c.key}><label className="flex min-h-11 items-start gap-3 py-1 text-[14px]"><input type="checkbox" name="checked" value={c.key} className="mt-0.5 size-5 shrink-0" data-testid={`redteam-item-${c.key}`} />{t(c.label[0], c.label[1])}</label></li>)}
                            </ul>
                            <Field label={t('Cómo lo probaste', 'How you tested it')} className="mt-3"><textarea name="notes" className="input min-h-20" required minLength={10} maxLength={2000} data-testid="redteam-notes" /></Field>
                            <div className="mt-4"><Submit testId="redteam-save">{t('Guardar revisión', 'Save review')}</Submit></div>
                          </ActionForm>
                        </Dialog>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}

        {ctx.can('integration.operate') && (
          <Card data-testid="mcp-clients-card">
            <CardTitle title={t('Agentes que leen como una persona', 'Agents that read as a person')} hint={mcpMode() === 'off' ? t('El servidor MCP está apagado: nadie puede usar estos permisos hasta que se encienda con su revisión de tecnología.', 'The MCP server is off: nobody can use these permissions until it is turned on with its technology review.') : t('Cada persona da permiso desde su propia sesión. Retirar un agente corta todos sus permisos.', 'Each person grants permission from their own session. Removing an agent cuts all its permissions.')} />
            {clients.length === 0 ? <Empty title={t('No hay agentes registrados', 'No agents are registered')} hint={t('Registra uno con su URL de regreso para que pueda pedir permiso.', 'Register one with its return URL so it can ask for permission.')} /> : (
              <ul>
                {clients.map((c) => (
                  <li key={c.client_id} className={row} data-testid="mcp-client">
                    <div className="min-w-0 flex-1 basis-[240px]">
                      <p className="text-[15px] font-semibold text-strong">{c.name}</p>
                      <p className={`${small} [overflow-wrap:anywhere]`}><code>{c.client_id}</code> · {c.redirect_uris[0]}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.revoked_at ? <Badge>{t('Retirado', 'Removed')}</Badge> : <Badge tone="info">{t(`${c.active_tokens} permisos vigentes`, `${c.active_tokens} active permissions`)}</Badge>}
                      {!c.revoked_at && (
                        <ActionForm action={A.revokeMcpClientAction}>
                          <input type="hidden" name="client_id" value={c.client_id} />
                          <Submit variant="danger" size="sm" testId="mcp-revoke">{t('Retirar', 'Remove')}</Submit>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={A.createMcpClientAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-5 md:grid-cols-[1fr_1.4fr_auto] md:items-end" testId="mcp-client-new">
              <Field label={t('Nombre del agente', 'Agent name')}><input name="name" className="input" required minLength={3} maxLength={80} data-testid="mcp-client-name" /></Field>
              <Field label={t('URL de regreso', 'Return URL')}><input name="redirect_uri" type="url" className="input" required data-testid="mcp-client-redirect" /></Field>
              <Submit testId="mcp-client-save">{t('Registrar', 'Register')}</Submit>
            </ActionForm>
          </Card>
        )}

        {ctx.can('security.read') && (
          <Card data-testid="secret-owners-card">
            <CardTitle title={t('Responsable y suplente de cada conexión', 'Owner and backup for each connection')} hint={t('El responsable, cada cuánto se rota y la última rotación se cargan en Seguridad, Llaves. Aquí va el suplente: recibe el aviso de rotación si no hay responsable.', 'The owner, rotation period and last rotation are set in Security, Keys. The backup goes here: they get the rotation notice if there is no owner.')} />
            <ul>
              {data.secrets.map((s) => (
                <li key={s.key} className={row} data-testid={`secret-${s.key}`}>
                  <div className="min-w-0 flex-1 basis-[240px]">
                    <p className="text-[15px] font-semibold text-strong">{t(s.label_es, s.label_en)}</p>
                    <p className={small}>{s.system_name} · {t('Responsable', 'Owner')}: {s.owner ?? t('pendiente: Yamil', 'pending: Yamil')} · {t('Suplente', 'Backup')}: {s.backup ?? t('pendiente: Yamil', 'pending: Yamil')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.overdue && <Badge tone="warn">{t('Rotación vencida', 'Rotation overdue')}</Badge>}
                    {!s.owner && !s.backup && <Badge tone="warn">{t('Sin responsable', 'No owner')}</Badge>}
                    {ctx.can('security.manage') && (
                      <Dialog trigger={t('Suplente', 'Backup')} title={t(s.label_es, s.label_en)} variant="quiet" size="sm" testId={`secret-backup-${s.key}`}>
                        <ActionForm action={A.setSecretBackupAction} onOk="close">
                          <input type="hidden" name="key" value={s.key} />
                          <Field label={t('Suplente', 'Backup')}>
                            <select name="backup_id" className="input" defaultValue={s.backup_owner_id ?? ''} data-testid="secret-backup-select">
                              <option value="">{t('Sin suplente', 'No backup')}</option>
                              {data.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </select>
                          </Field>
                          <div className="mt-4"><Submit testId="secret-backup-save">{t('Guardar', 'Save')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}
