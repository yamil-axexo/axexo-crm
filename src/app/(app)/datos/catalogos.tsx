import type { Ctx } from '@/server/context'
import { dataCatalogs } from '@/dal/datos'
import { MOTORS } from '@/domain/b2b'
import { Badge, Card, CardTitle, Empty, Field, Table } from '@/ui/kit'
import { Dialog, Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { num } from '@/lib/format'
import { KIND, MOTOR, lab } from '@/lib/labels'
import { ALIAS_KIND, ROUTING_STRATEGY } from '@/lib/datos-labels'
import { AgenciasCard } from './agencias'
import { createAliasSystemAction, createMarketAction, createProcessListAction, createRoutingRuleAction, createWebFormAction, setTypeDepthAction, toggleProcessListAction, toggleRoutingRuleAction,
  toggleWebFormAction, updateMarketAction } from './actions'

/**
 * DAT-05: lo que antes pedía una migración ahora se hace desde la pantalla: mercados, formularios web, turnos de leads,
 * sistemas de origen de identificadores, niveles del árbol por tipo de cuenta y listas de proceso por mercado.
 */
export async function CatalogosTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const d = await dataCatalogs(ctx)
  const admin = ctx.can('config.manage')
  const marketsOf = (cap: 'process.define') => d.markets.filter((m) => ctx.can(cap, m.code))
  const marketSelect = (name = 'market', all?: string) => (
    <select name={name} className="input" data-testid={`cat-${name}`}>{all && <option value="">{all}</option>}{d.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
  )
  const row = 'flex flex-wrap items-center justify-between gap-3 border-t border-line py-4 first:border-t-0'

  return (
    <div className="space-y-8" data-testid="catalogs-tab">
      <AgenciasCard ctx={ctx} />
      {admin && (
        <Card pad={false} data-testid="markets-card">
          <div className="px-5 pt-6 md:px-7 md:pt-7">
            <CardTitle title={t('Mercados', 'Markets')} hint={t('Un mercado nuevo nace en preparación: se le crea su embudo, su equipo y su horario, y después se abre.', 'A new market starts as being set up: create its pipeline, team and hours, then open it.')}
              right={
                <Dialog trigger={t('Agregar mercado', 'Add market')} title={t('Agregar un mercado', 'Add a market')} variant="primary" testId="market-new">
                  <NoticeForm action={createMarketAction} className="grid grid-cols-2 gap-4 text-left" testId="market-form">
                    <Field label={t('Código del país (2 letras)', 'Country code (2 letters)')}><input name="code" className="input uppercase" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" data-testid="market-code" /></Field>
                    <Field label={t('Nombre', 'Name')}><input name="name" className="input" required minLength={2} maxLength={60} data-testid="market-name" /></Field>
                    <Field label={t('Moneda (3 letras)', 'Currency (3 letters)')}><input name="currency" className="input uppercase" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" data-testid="market-currency" /></Field>
                    <Field label={t('Idioma', 'Language')}><select name="locale" className="input"><option value="es">{t('Español', 'Spanish')}</option><option value="en">{t('Inglés', 'English')}</option></select></Field>
                    <Field label={t('Zona horaria', 'Time zone')} hint={t('Nombre completo, por ejemplo America/Bogota.', 'Full name, for example America/Bogota.')}><input name="timezone" className="input" required minLength={3} maxLength={60} data-testid="market-timezone" /></Field>
                    <Field label={t('Clave telefónica', 'Dialing code')} hint={t('Con el signo +, por ejemplo +57.', 'With the + sign, for example +57.')}><input name="phone_cc" className="input" required pattern="\+[1-9][0-9]{0,3}" data-testid="market-phone" /></Field>
                    <div className="col-span-2 flex justify-end"><Submit testId="market-save">{t('Agregar mercado', 'Add market')}</Submit></div>
                  </NoticeForm>
                </Dialog>
              } />
          </div>
          <Table label={t('Mercados', 'Markets')} head={<><th>{t('Mercado', 'Market')}</th><th>{t('Moneda', 'Currency')}</th><th>{t('Zona horaria', 'Time zone')}</th><th>{t('Comercios', 'Merchants')}</th><th>{t('Estado', 'Status')}</th><th className="relative"><span className="sr-only">{t('Editar', 'Edit')}</span></th></>}>
            {d.markets.map((m) => (
              <tr key={m.code} className="table-row" data-testid="market-row" data-code={m.code}>
                <td><span className="font-semibold text-strong">{m.name}</span> <span className="text-muted">{m.code}</span></td>
                <td>{m.currency}</td><td className="text-[13.5px]">{m.timezone}</td><td className="num">{num(m.accounts, locale)}</td>
                <td>{m.status === 'live' ? <Badge tone="good">{t('Abierto', 'Open')}</Badge> : <Badge tone="warn">{t('En preparación', 'Being set up')}</Badge>}{m.pipelines === 0 && <span className="ml-2 text-[13px] text-muted">{t('sin embudo', 'no pipeline')}</span>}</td>
                <td className="text-right">
                  <Dialog trigger={t('Editar', 'Edit')} title={t(`Mercado: ${m.name}`, `Market: ${m.name}`)} size="sm" testId="market-edit">
                    <NoticeForm action={updateMarketAction} className="space-y-4 text-left">
                      <input type="hidden" name="code" value={m.code} />
                      <Field label={t('Nombre', 'Name')}><input name="name" className="input" required minLength={2} maxLength={60} defaultValue={m.name} /></Field>
                      <Field label={t('Estado', 'Status')} hint={t('Para abrirlo hace falta al menos un embudo con sus etapas.', 'Opening it needs at least one pipeline with its stages.')}>
                        <select name="status" className="input" defaultValue={m.status} data-testid="market-status"><option value="planned">{t('En preparación', 'Being set up')}</option><option value="live">{t('Abierto', 'Open')}</option></select>
                      </Field>
                      <div className="flex justify-end"><Submit testId="market-update">{t('Guardar', 'Save')}</Submit></div>
                    </NoticeForm>
                  </Dialog>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {admin && (
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <Card data-testid="forms-card">
            <CardTitle title={t('Formularios web', 'Web forms')} hint={t('Cada formulario entrega sus solicitudes a un turno de leads.', 'Each form hands its requests to a lead rotation.')}
              right={
                <Dialog trigger={t('Crear formulario', 'Create form')} title={t('Crear un formulario web', 'Create a web form')} variant="primary" testId="form-new">
                  <NoticeForm action={createWebFormAction} className="grid grid-cols-2 gap-4 text-left" testId="form-form">
                    <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="name" className="input" required minLength={2} maxLength={80} data-testid="form-name" /></Field>
                    <Field label={t('Dirección del formulario', 'Form address')} className="col-span-2" hint={t('Letras minúsculas, números y guiones. Queda en /f/ seguido de esta dirección.', 'Lowercase letters, numbers and hyphens. It lives at /f/ followed by this address.')}><input name="slug" className="input" required pattern="[a-z0-9\-]{3,60}" data-testid="form-slug" /></Field>
                    <Field label={t('Mercado', 'Market')}>{marketSelect()}</Field>
                    <Field label={t('Tipo de venta', 'Sale type')}><select name="motor" className="input">{MOTORS.map((k) => <option key={k} value={k}>{lab(t, MOTOR[k])}</option>)}</select></Field>
                    <Field label={t('Idioma', 'Language')}><select name="locale" className="input"><option value="es">{t('Español', 'Spanish')}</option><option value="en">{t('Inglés', 'English')}</option></select></Field>
                    <Field label={t('Turno que recibe', 'Rotation that gets them')}><select name="routing_rule_id" className="input"><option value="">{t('Sin turno (quedan por repartir)', 'No rotation (left to distribute)')}</option>{d.rules.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.market_code} · {r.name}</option>)}</select></Field>
                    <div className="col-span-2 flex justify-end"><Submit testId="form-save">{t('Crear formulario', 'Create form')}</Submit></div>
                  </NoticeForm>
                </Dialog>
              } />
            {d.forms.length === 0 ? <Empty title={t('Sin formularios', 'No forms')} hint={t('Crea el primero para recibir solicitudes del sitio web.', 'Create the first one to take requests from the website.')} /> : (
              <ul>
                {d.forms.map((f) => (
                  <li key={f.id} className={row} data-testid="form-row">
                    <span className="min-w-0 text-[14px]"><span className={f.is_active ? 'font-semibold text-strong' : 'text-muted line-through'}>{f.name}</span>
                      <span className="block text-[13px] text-muted-2 [overflow-wrap:anywhere]">{f.market_code} · /f/{f.slug} · {lab(t, MOTOR[f.motor])} · {f.rule_name ?? t('sin turno', 'no rotation')} · {t(`${num(f.leads, locale)} solicitudes`, `${num(f.leads, locale)} requests`)}</span></span>
                    <NoticeForm action={toggleWebFormAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="active" value={f.is_active ? 'false' : 'true'} /><Submit variant="quiet" size="sm" testId="form-toggle">{f.is_active ? t('Pausar', 'Pause') : t('Activar', 'Turn on')}</Submit></NoticeForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="rules-card">
            <CardTitle title={t('Turnos de leads', 'Lead rotations')} hint={t('Quién recibe los leads que llegan y en cuántos minutos hay que hacer el primer contacto.', 'Who gets incoming leads and within how many minutes first contact is due.')}
              right={
                <Dialog trigger={t('Crear turno', 'Create rotation')} title={t('Crear un turno de leads', 'Create a lead rotation')} variant="primary" testId="rule-new">
                  <NoticeForm action={createRoutingRuleAction} className="grid grid-cols-2 gap-4 text-left" testId="rule-form">
                    <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="name" className="input" required minLength={2} maxLength={80} data-testid="rule-name" /></Field>
                    <Field label={t('Mercado', 'Market')}>{marketSelect()}</Field>
                    <Field label={t('Cómo se reparte', 'How it hands out')}><select name="strategy" className="input" data-testid="rule-strategy">{Object.entries(ROUTING_STRATEGY).map(([k, v]) => <option key={k} value={k}>{t(...v)}</option>)}</select></Field>
                    <fieldset className="col-span-2">
                      <legend className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Personas del turno (solo cuentan las del mercado elegido)', 'People in the rotation (only those in the chosen market count)')}</legend>
                      <div className="grid max-h-56 gap-x-4 overflow-y-auto sm:grid-cols-2">{d.sellers.map((s) => <label key={`${s.id}${s.market_code}`} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="member_id" value={s.id} className="h-5 w-5 shrink-0" data-testid="rule-member" data-market={s.market_code} />{s.full_name} <span className="text-muted">{s.market_code}</span></label>)}</div>
                    </fieldset>
                    <Field label={t('Respaldo si nadie del turno puede', 'Fallback if nobody in the rotation can')}><select name="fallback_id" className="input"><option value="">{t('Nadie', 'Nobody')}</option>{d.sellers.map((s) => <option key={`${s.id}${s.market_code}`} value={s.id}>{s.full_name} · {s.market_code}</option>)}</select></Field>
                    <Field label={t('Minutos para el primer contacto', 'Minutes to first contact')}><input name="sla_minutes" type="number" min={5} max={10080} className="input" required defaultValue={60} /></Field>
                    <div className="col-span-2 flex justify-end"><Submit testId="rule-save">{t('Crear turno', 'Create rotation')}</Submit></div>
                  </NoticeForm>
                </Dialog>
              } />
            {d.rules.length === 0 ? <Empty title={t('Sin turnos', 'No rotations')} hint={t('Crea uno para que los leads lleguen a alguien.', 'Create one so leads reach someone.')} /> : (
              <ul>
                {d.rules.map((r) => (
                  <li key={r.id} className={row} data-testid="rule-row">
                    <span className="min-w-0 text-[14px]"><span className={r.is_active ? 'font-semibold text-strong' : 'text-muted line-through'}>{r.name}</span>
                      <span className="block text-[13px] text-muted-2">{r.market_code} · {lab(t, ROUTING_STRATEGY[r.strategy])} · {t(`${r.sla_minutes} min`, `${r.sla_minutes} min`)} · {r.members.length ? r.members.join(', ') : (r.fallback ?? t('sin personas', 'no people'))}</span></span>
                    <NoticeForm action={toggleRoutingRuleAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.is_active ? 'false' : 'true'} /><Submit variant="quiet" size="sm" testId="rule-toggle">{r.is_active ? t('Pausar', 'Pause') : t('Activar', 'Turn on')}</Submit></NoticeForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-2">
        {admin && (
          <Card data-testid="systems-card">
            <CardTitle title={t('Sistemas de origen de ID', 'ID source systems')} hint={t('De qué sistemas puede traer un ID un comercio: la Sales App, una red adquirida, un proveedor. El ID fiscal completo no se guarda aquí.', 'Which systems a merchant can carry an ID from: the Sales App, an acquired network, a provider. The full tax ID is not stored here.')}
              right={
                <Dialog trigger={t('Agregar sistema', 'Add system')} title={t('Agregar un sistema de origen', 'Add a source system')} variant="primary" size="sm" testId="system-new">
                  <NoticeForm action={createAliasSystemAction} className="space-y-4 text-left" testId="system-form">
                    <Field label={t('Nombre en español', 'Name in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={60} data-testid="system-label-es" /></Field>
                    <Field label={t('Nombre en inglés', 'Name in English')}><input name="label_en" className="input" required minLength={2} maxLength={60} data-testid="system-label-en" /></Field>
                    <Field label={t('Qué es', 'What it is')}><select name="kind" className="input" defaultValue="carrier">{Object.entries(ALIAS_KIND).map(([k, v]) => <option key={k} value={k}>{t(...v)}</option>)}</select></Field>
                    <Field label={t('Mercado', 'Market')}>{marketSelect('market', t('Todos los mercados', 'All markets'))}</Field>
                    <div className="flex justify-end"><Submit testId="system-save">{t('Agregar sistema', 'Add system')}</Submit></div>
                  </NoticeForm>
                </Dialog>
              } />
            <ul>
              {d.systems.map((s) => (
                <li key={s.code} className={row} data-testid="system-row">
                  <span className="text-[14px]"><span className="font-semibold text-strong">{t(s.label_es, s.label_en)}</span><span className="block text-[13px] text-muted-2">{lab(t, ALIAS_KIND[s.kind])} · {s.market_code ?? t('todos los mercados', 'all markets')}</span></span>
                  <span className="num text-[13px] text-muted">{t(`${num(s.in_use, locale)} comercios`, `${num(s.in_use, locale)} merchants`)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {admin && (
          <Card data-testid="depth-card">
            <CardTitle title={t('Niveles del árbol por tipo de cuenta', 'Tree levels by account type')} hint={t('Cuántos niveles admite un árbol cuya raíz es de ese tipo, contando la raíz. Un ISO con sus agentes y sus puntos de venta son 3. Vacío: sin límite.', 'How many levels a tree rooted in that type allows, counting the root. An ISO with its agents and their stores is 3. Empty: no limit.')} />
            <ul>
              {d.types.map((ty) => (
                <li key={ty.id} className={row} data-testid="depth-row" data-code={ty.code}>
                  <span className="text-[14px]"><span className={ty.is_active ? 'font-semibold text-strong' : 'text-muted line-through'}>{t(ty.label_es, ty.label_en)}</span><span className="block text-[13px] text-muted-2">{lab(t, KIND[ty.kind])} · {ty.market_code ?? t('todos los mercados', 'all markets')}</span></span>
                  <NoticeForm action={setTypeDepthAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={ty.id} />
                    <input name="max_depth" type="number" min={1} max={12} className="input !w-20" defaultValue={ty.max_depth ?? ''} aria-label={t(`Niveles de ${ty.label_es}`, `Levels for ${ty.label_en}`)} data-testid="depth-input" />
                    <Submit variant="quiet" size="sm" testId="depth-save">{t('Guardar', 'Save')}</Submit>
                  </NoticeForm>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card data-testid="process-card">
        <CardTitle title={t('Listas de proceso por mercado', 'Process lists by market')} hint={t('Un proceso que corre al lado del embudo, con sus propios estados y sus propios datos: una capacitación, una campaña con un proveedor. Aparece en la ficha de cada comercio de ese mercado.', 'A process that runs alongside the pipeline, with its own statuses and details: a training, a campaign with a provider. It shows on each merchant record in that market.')}
          right={marketsOf('process.define').length > 0 ? (
            <Dialog trigger={t('Crear lista', 'Create list')} title={t('Crear una lista de proceso', 'Create a process list')} variant="primary" testId="process-new">
              <NoticeForm action={createProcessListAction} className="grid grid-cols-2 gap-4 text-left" testId="process-form">
                <Field label={t('Nombre en español', 'Name in Spanish')}><input name="name_es" className="input" required minLength={2} maxLength={80} data-testid="process-name-es" /></Field>
                <Field label={t('Nombre en inglés', 'Name in English')}><input name="name_en" className="input" required minLength={2} maxLength={80} data-testid="process-name-en" /></Field>
                <Field label={t('Mercado', 'Market')} className="col-span-2"><select name="market" className="input" data-testid="process-market">{marketsOf('process.define').map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                <Field label={t('Estados, uno por renglón', 'Statuses, one per line')} className="col-span-2" hint={t('Escribe "Español | English". El último estado cierra el proceso.', 'Write "Español | English". The last status closes the process.')}><textarea name="statuses" rows={4} required className="input !h-auto py-3" data-testid="process-statuses" /></Field>
                <Field label={t('Datos propios de la lista, uno por renglón (opcional)', 'The list’s own details, one per line (optional)')} className="col-span-2" hint={t('Por ejemplo "Fecha de la sesión | Session date". Nunca tarjetas, cuentas ni identificaciones.', 'One per line, as "Spanish text | English text". Never cards, accounts or IDs.')}><textarea name="attributes" rows={2} className="input !h-auto py-3" data-testid="process-attributes" /></Field>
                <div className="col-span-2 flex justify-end"><Submit testId="process-save">{t('Crear lista', 'Create list')}</Submit></div>
              </NoticeForm>
            </Dialog>
          ) : undefined} />
        {d.lists.length === 0 ? <Empty title={t('Todavía no hay listas de proceso', 'No process lists yet')} hint={t('Crea una cuando un mercado necesite seguir algo que no es una etapa del embudo.', 'Create one when a market needs to track something that is not a pipeline stage.')} /> : (
          <ul>
            {d.lists.map((l) => (
              <li key={l.id} className={row} data-testid="process-row">
                <span className="min-w-0 text-[14px]"><span className={l.is_active ? 'font-semibold text-strong' : 'text-muted line-through'}>{t(l.name_es, l.name_en)}</span>
                  <span className="block text-[13px] text-muted-2 [overflow-wrap:anywhere]">{l.market_code} · {l.statuses.map((s) => t(s.es, s.en)).join(', ')}{l.attributes.length ? ` · ${t('datos', 'details')}: ${l.attributes.map((a) => t(a.es, a.en)).join(', ')}` : ''} · {t(`${num(l.members, locale)} comercios en curso`, `${num(l.members, locale)} merchants in progress`)}</span></span>
                {ctx.can('process.define', l.market_code) && <NoticeForm action={toggleProcessListAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="active" value={l.is_active ? 'false' : 'true'} /><Submit variant="quiet" size="sm" testId="process-toggle">{l.is_active ? t('Retirar', 'Retire') : t('Activar', 'Activate')}</Submit></NoticeForm>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
