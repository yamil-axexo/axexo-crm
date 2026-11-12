import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { env } from '@/env'
import { getUsers, type AccessFilter, type MembershipRow } from '@/dal/admin'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { Badge, Card, CardTitle, Empty, Field, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CloseDialog, GrantFields, NoticeArea, NoticeForm } from '@/ui/admin'
import { ago, day } from '@/lib/format'
import { MOTOR, lab, qs } from '@/lib/labels'
import { domainList } from '@/lib/domains'
import { VacantNotice } from './sin-dueno'
import { createTeamAction, endMembershipAction, grantMembershipAction, setMembershipExpiryAction } from './actions'

const list = (items: string[], and: string) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}` : (items[0] ?? ''))

/** Personas y acceso: quién entra, con qué rol, hasta cuándo, y qué pasa con lo suyo cuando se le quita. */
export async function PeopleTab({ ctx, access, today }: { ctx: Ctx; access: AccessFilter; today: string }) {
  const { t, locale } = ctx
  const d = await getUsers(ctx, access)
  const live = ctx.markets.filter((m) => m.status === 'live')
  const domains = env().AUTH_ALLOWED_DOMAINS
  const roleText = (m: MembershipRow) => [t(ROLE_LABEL[m.role as Role].es, ROLE_LABEL[m.role as Role].en), m.market_code, m.team].filter(Boolean).join(' · ')
  const owned = (m: MembershipRow) => {
    const n = (count: number, one: [string, string], many: [string, string]) => (count ? `${count} ${count === 1 ? t(...one) : t(...many)}` : '')
    return list([n(m.accounts, ['comercio', 'merchant'], ['comercios', 'merchants']), n(m.deals, ['negocio abierto', 'open deal'], ['negocios abiertos', 'open deals']), n(m.leads, ['lead abierto', 'open lead'], ['leads abiertos', 'open leads'])].filter(Boolean), t('y', 'and'))
  }

  return (
    <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
      {/* Debajo del aviso de lo que se acaba de hacer: quién tiene cartera sin dueño vigente y el botón para repartirla. */}
      <VacantNotice ctx={ctx} />
      <Card pad={false} data-testid="admin-people">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-6 md:px-7 md:pt-7">
          <div className="min-w-0 flex-1 basis-64">
            <CardTitle title={t('Personas', 'People')} hint={t('El acceso es un rol en un mercado. Quitarlo lo cierra con fecha de hoy; la persona y su historial se quedan.', 'Access is a role in a market. Removing it closes it as of today; the person and their history stay.')} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Dialog trigger={t('Nuevo equipo', 'New team')} title={t('Nuevo equipo', 'New team')} testId="team-open">
              <ActionForm action={createTeamAction} onOk="close" className="grid grid-cols-2 gap-4">
                <Field label={t('Nombre', 'Name')} className="col-span-2" hint={t('Quien supervisa un equipo ve lo de su gente.', 'Whoever supervises a team sees their people\'s records.')}><input name="name" className="input" required minLength={2} maxLength={60} data-testid="team-name" /></Field>
                <Field label={t('Mercado', 'Market')}><select name="market" className="input" required data-testid="team-market">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                <Field label={t('Tipo de venta', 'Sales motion')}><select name="motor" className="input" data-testid="team-motor">{Object.keys(MOTOR).map((k) => <option key={k} value={k}>{lab(t, MOTOR[k])}</option>)}</select></Field>
                <div className="col-span-2 flex justify-end"><Submit testId="team-save">{t('Crear equipo', 'Create team')}</Submit></div>
              </ActionForm>
            </Dialog>
            <Dialog trigger={t('Dar acceso', 'Grant access')} title={t('Dar acceso', 'Grant access')} variant="primary" testId="grant-open">
              <NoticeForm action={grantMembershipAction} className="grid grid-cols-2 gap-4" testId="grant-form">
                <GrantFields
                  roles={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: t(ROLE_LABEL[r].es, ROLE_LABEL[r].en) }))}
                  markets={live.map((m) => ({ code: m.code, name: m.name }))}
                  teams={d.teams.map((x) => ({ id: x.id, name: x.name, market: x.market_code }))}
                  today={today}
                  labels={{
                    email: t('Correo', 'Email'),
                    emailHint: t(`Tiene que ser una cuenta de ${domainList(domains, 'o')}.`, `It has to be a ${domainList(domains, 'or')} account.`),
                    name: t('Nombre', 'Name'),
                    role: t('Rol', 'Role'),
                    market: t('Mercado', 'Market'),
                    team: t('Equipo', 'Team'),
                    teamHint: t('Opcional. Solo aparecen los equipos de ese mercado.', 'Optional. Only teams in that market are listed.'),
                    noTeam: t('Sin equipo', 'No team'),
                    expires: t('Vence el (opcional)', 'Expires on (optional)'),
                    expiresHint: t('El acceso vale hasta el final de ese día y deja de valer solo. Úsalo para personas externas o temporales.', 'Access works until the end of that day and stops on its own. Use it for external or temporary people.'),
                    adminHint: t('Administración puede dar y quitar accesos, crear llaves de API, cambiar embudos y turnos, e importar de Pipedrive. Si la persona es externa o temporal, ponle fecha de vencimiento.', 'Administration can grant and remove access, create API keys, change pipelines and rotations, and import from Pipedrive. If the person is external or temporary, set an expiry date.'),
                    adminConfirm: t('Sí, quiero darle Administración', 'Yes, I want to grant Administration'),
                    supervisorWarn: t('Sin equipo, esta supervisión no va a ver los registros de nadie más. Puedes guardar así y asignar el equipo después.', 'With no team, this supervisor will not see anyone else’s records. You can save it like this and assign the team later.'),
                    globalHint: t('Este rol vale en todos los mercados: no lleva mercado ni equipo.', 'This role works in every market: it has no market or team.'),
                  }}
                />
                <div className="col-span-2 flex justify-end"><Submit testId="grant-save">{t('Dar acceso', 'Grant access')}</Submit></div>
              </NoticeForm>
            </Dialog>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4 md:px-7" data-testid="team-list">
          <span className="text-[13px] font-medium text-muted-2">{t('Equipos:', 'Teams:')}</span>
          {d.teams.length === 0 && <span className="text-[13px] text-muted">{t('todavía no hay ninguno', 'none yet')}</span>}
          {d.teams.map((x) => <span key={x.id} className="rounded-full bg-surface-3 px-3 py-1 text-[12.5px] font-semibold text-muted-2" data-testid="team-chip">{x.market_code} · {x.name} · {x.members}</span>)}
        </div>
        <div className="px-5 pt-5 md:px-7">
          <Pills
            label={t('Filtrar personas por acceso', 'Filter people by access')}
            current={access}
            items={[
              { key: 'con', href: qs('/admin', { tab: 'personas' }), label: t('Con acceso', 'With access'), count: d.counts.con },
              { key: 'sin', href: qs('/admin', { tab: 'personas', acceso: 'sin' }), label: t('Sin acceso', 'No access'), count: d.counts.sin },
              { key: 'todas', href: qs('/admin', { tab: 'personas', acceso: 'todas' }), label: t('Todas', 'Everyone'), count: d.counts.todas },
            ]}
          />
        </div>
        {d.users.length === 0 ? (
          <div className="p-7"><Empty title={access === 'sin' ? t('Nadie se ha quedado sin acceso', 'Nobody has lost access') : t('Sin personas', 'No people')} /></div>
        ) : (
          <Table testId="people-table" label={t('Personas y su acceso', 'People and their access')} head={<><th>{t('Persona', 'Person')}</th><th>{t('Acceso', 'Access')}</th><th>{t('Días activos (14)', 'Active days (14)')}</th><th>{t('Acciones (14 días)', 'Actions (14 days)')}</th><th>{t('Última vez', 'Last seen')}</th></>}>
            {d.users.map((u) => {
              const mine = d.memberships.filter((m) => m.user_id === u.id)
              return (
                <tr key={u.id} className="table-row" data-testid="person-row">
                  <td><span className="block font-semibold text-strong">{u.full_name}</span><span className="text-[12.5px] text-muted-2">{u.email}{u.is_synthetic ? ` · ${t('sintética', 'synthetic')}` : ''}</span></td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {mine.length === 0 && (
                        <span className="text-[13px] text-muted-2" data-testid="no-access">
                          {u.ended_at ? t(`Sin acceso desde el ${day(u.ended_at, locale)}`, `No access since ${day(u.ended_at, locale)}`) : t('Sin acceso', 'No access')}
                        </span>
                      )}
                      {mine.map((m) => {
                        const others = mine.filter((x) => x.id !== m.id)
                        const things = owned(m)
                        const soon = m.expires_in_days !== null && m.expires_in_days <= 7
                        return (
                          <Dialog
                            key={m.id}
                            testId="membership-open"
                            title={t(`Acceso de ${u.full_name}`, `${u.full_name}'s access`)}
                            triggerClass="press relative inline-flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-[22px] bg-surface-3 px-4 py-1.5 text-left text-[13px] font-semibold text-strong hover:bg-green-50"
                            trigger={
                              <>
                                <span>{roleText(m)}</span>
                                {m.role === 'supervisor' && !m.team && <Badge tone="warn">{t('sin equipo', 'no team')}</Badge>}
                                {m.expires && <Badge tone={soon ? 'warn' : 'neutral'}>{t(`vence el ${day(m.expires, locale)}`, `expires ${day(m.expires, locale)}`)}</Badge>}
                                <span className="sr-only">{t('Cambiar o quitar este acceso', 'Change or remove this access')}</span>
                              </>
                            }
                          >
                            <p className="text-[15px] font-semibold text-strong" data-testid="membership-role">{roleText(m)}</p>
                            {m.role === 'supervisor' && !m.team && <p className="mt-2 rounded-[10px] bg-warn-bg px-4 py-3 text-[13.5px] font-medium text-amber-text">{t('Esta supervisión no tiene equipo: no ve los registros de nadie más. Para asignarlo, quita este acceso y vuelve a darlo con el equipo.', 'This supervisor has no team: they do not see anyone else’s records. To assign one, remove this access and grant it again with the team.')}</p>}

                            <NoticeForm action={setMembershipExpiryAction} className="mt-6" testId="expiry-form">
                              <input type="hidden" name="id" value={m.id} />
                              <div className="flex flex-wrap items-end gap-3">
                                <Field label={t('Vence el', 'Expires on')} className="min-w-[180px] flex-1">
                                  <input name="expires" type="date" className="input" defaultValue={m.expires ?? ''} min={today} data-testid="expiry-date" />
                                </Field>
                                <Submit variant="ghost" testId="expiry-save">{t('Guardar fecha', 'Save date')}</Submit>
                              </div>
                              <p className="mt-2 text-[12.5px] text-muted">{m.market_code
                                ? t('Vacío: no vence. Con fecha, el acceso vale hasta el final de ese día en la hora del mercado y deja de valer solo.', 'Empty: it does not expire. With a date, access works until the end of that day in the market’s time and stops on its own.')
                                : t('Vacío: no vence. Con fecha, el acceso vale hasta el final de ese día en hora UTC (las 8 de la noche en Puerto Rico) y deja de valer solo.', 'Empty: it does not expire. With a date, access works until the end of that day in UTC (8 p.m. in Puerto Rico) and stops on its own.')}</p>
                            </NoticeForm>

                            <div className="mt-7 border-t border-line pt-6" data-testid="end-impact">
                              <h3 className="text-[16px] font-semibold">{t('Quitar este acceso', 'Remove this access')}</h3>
                              <p className="mt-2 text-[14px] text-strong" data-testid="end-owned">
                                {things
                                  ? t(`${u.full_name} tiene a su nombre ${things}${m.market_code ? ` en ${m.market_code}` : ''}.`, `${u.full_name} has ${things} in their name${m.market_code ? ` in ${m.market_code}` : ''}.`)
                                  : t(`${u.full_name} no tiene comercios, negocios ni leads abiertos a su nombre${m.market_code ? ` en ${m.market_code}` : ''}.`, `${u.full_name} has no merchants, open deals or open leads in their name${m.market_code ? ` in ${m.market_code}` : ''}.`)}
                              </p>
                              <p className="mt-4 text-[13px] font-semibold text-muted-2">{t('Qué va a pasar', 'What will happen')}</p>
                              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] text-muted-2">
                                <li>{others.length === 0
                                  ? t('Pierde este rol hoy y ya no va a poder entrar a CONTIGO.', 'They lose this role today and will no longer be able to sign in to CONTIGO.')
                                  : t(`Pierde este rol hoy. Conserva: ${others.map(roleText).join(', ')}.`, `They lose this role today. They keep: ${others.map(roleText).join(', ')}.`)}</li>
                                {m.leaves_rules.length > 0 && <li data-testid="end-rules">{t(`Sale de los turnos de leads: ${m.leaves_rules.join(', ')}. Los leads nuevos ya no le llegan.`, `They leave the lead rotations: ${m.leaves_rules.join(', ')}. New leads stop going to them.`)}</li>}
                                {m.fallback_of.length > 0 && <li>{t(`Deja de ser el respaldo de: ${m.fallback_of.join(', ')}. Ese turno queda sin respaldo hasta que alguien lo defina.`, `They stop being the fallback of: ${m.fallback_of.join(', ')}. That rotation has no fallback until someone sets one.`)}</li>}
                                {things && m.vacates && <li data-testid="end-vacates">{t('Lo que tiene a su nombre no se mueve solo: queda sin dueño vigente. Supervisión y quien lidera el mercado lo ven en ', 'What they have in their name does not move on its own: it is left with no current owner. Supervisors and the market lead see it in ')}<Link href={qs('/supervisor', { market: m.market_code })} className="font-semibold text-blue-text underline">{t('Mi equipo', 'My team')}</Link>{t(', en "Sin dueño vigente", para repartirlo.', ', under "No current owner", to distribute it.')}</li>}
                                {things && !m.vacates && <li data-testid="end-keeps">{m.market_code
                                  ? t('Lo que tiene a su nombre sigue siendo suyo: conserva otro rol con el que lleva cartera en este mercado.', 'What they have in their name stays theirs: they keep another role that carries records in this market.')
                                  : t('Lo que tiene a su nombre no se mueve: este rol no decide quién lleva la cartera de un mercado.', 'What they have in their name does not move: this role does not decide who carries a market’s records.')}</li>}
                                <li>{t('Su historial se queda y puedes volver a darle acceso cuando haga falta.', 'Their history stays and you can grant access again whenever needed.')}</li>
                              </ul>
                              <NoticeForm action={endMembershipAction} className="mt-6">
                                <input type="hidden" name="id" value={m.id} />
                                <div className="flex flex-wrap justify-end gap-3">
                                  <CloseDialog>{t('Cancelar', 'Cancel')}</CloseDialog>
                                  <Submit variant="danger" testId="membership-end">{t('Quitar acceso', 'Remove access')}</Submit>
                                </div>
                              </NoticeForm>
                            </div>
                          </Dialog>
                        )
                      })}
                    </div>
                  </td>
                  <td className="num">{u.active_days}</td>
                  <td className="num">{u.actions}</td>
                  <td className="text-[13px] text-muted-2">{u.last_seen ? ago(u.last_seen, locale) : t('Nunca', 'Never')}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>
    </NoticeArea>
  )
}

export const accessFilter = (v: string | undefined): AccessFilter => (v === 'sin' || v === 'todas' ? v : 'con')
