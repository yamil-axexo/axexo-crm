import { notFound } from 'next/navigation'
import { Check } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { getRollout, getSheetLoads } from '@/dal/mx'
import { SHEET_MAX_ROWS } from '@/domain/sheet-loads'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { track } from '@/dal/boards'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, cx } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { ago, day, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { keyPersonAction, loadMigratedAction, loadVisitsAction, openToTeamAction, rolloutStepAction, setLeadersFirstAction } from './actions'

const LEADER_ROLES = ['market_lead', 'supervisor', 'ops']

/**
 * Arranque de un mercado (E18.F2, F5, F6) y carga desde las hojas mientras se retiran (E17.F4, E14.F3).
 * Lo ve quien dirige un equipo o el mercado, y leadership; lo cambia quien lidera el mercado y administración.
 */
export default async function RolloutPage({ searchParams }: { searchParams: Promise<{ mercado?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const markets = ctx.markets.filter((m) => ctx.can('rollout.read', m.code) || ctx.can('visit.sheet_load', m.code))
  if (markets.length === 0) notFound()
  const sp = flat(await searchParams)
  const market = markets.find((m) => m.code === sp.mercado) ?? markets.find((m) => m.code === 'MX') ?? markets[0]!
  const canRead = ctx.can('rollout.read', market.code)
  const manage = ctx.can('rollout.manage', market.code)
  const canVisits = ctx.can('visit.sheet_load', market.code)
  const canMigrated = ctx.can('deal.migrated_load', market.code)
  const [r, loads] = await Promise.all([canRead ? getRollout(ctx, market.code) : null, canVisits ? getSheetLoads(ctx, market.code) : []])
  await track(ctx, 'view.rollout')
  const leaders = r?.people.filter((p) => LEADER_ROLES.includes(p.role) || p.is_key) ?? []
  const team = r?.people.filter((p) => !LEADER_ROLES.includes(p.role) && !p.is_key) ?? []
  const leadersLeft = r?.steps.filter((s) => s.phase === 'leaders' && !s.done_at).length ?? 0
  const open = !!r?.teamOpenedAt
  const person = (p: NonNullable<typeof r>['people'][number]) => (
    <li key={p.user_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2.5 first:border-t-0" data-testid="rollout-person">
      <span className="min-w-0"><span className="text-[14.5px] font-medium text-strong">{p.full_name}</span> <span className="text-[13px] text-muted">· {t(...(Object.values(ROLE_LABEL[p.role as Role] ?? { es: p.role, en: p.role }) as [string, string]))}{p.team ? ` · ${p.team}` : ''}{p.is_key ? ` · ${t('persona clave', 'key person')}` : ''}</span></span>
      <span className={cx('text-[13px]', p.last_login ? 'text-muted' : 'font-medium text-amber-text')}>{p.last_login ? t(`entró ${ago(p.last_login, locale)}`, `signed in ${ago(p.last_login, locale)}`) : t('todavía no entra', 'has not signed in yet')}</span>
    </li>
  )
  const paste = (kind: 'visits' | 'migrated') => (
    <ActionForm action={kind === 'visits' ? loadVisitsAction : loadMigratedAction} onOk="reset" testId={`sheet-${kind}`}>
      <input type="hidden" name="market" value={market.code} />
      <Field label={t('De qué hoja son (opcional)', 'Which sheet they come from (optional)')}><input name="label" className="input" maxLength={120} data-testid={`sheet-${kind}-label`} /></Field>
      <Field className="mt-4" label={t('Filas de la hoja, con su fila de títulos', 'Sheet rows, with their title row')}
        hint={kind === 'visits'
          ? t(`Copia las columnas desde la hoja y pégalas aquí. Títulos: Comercio (Merchant ID, teléfono o nombre exacto), Fecha, Quién visitó, Estado, Acción, Comentarios. Hasta ${SHEET_MAX_ROWS} filas.`, `Copy the columns from the sheet and paste them here. Titles: Store (Merchant ID, phone or exact name), Date, Visited by, Status, Action, Comments. Up to ${SHEET_MAX_ROWS} rows.`)
          : t(`Copia las columnas desde la hoja y pégalas aquí. Títulos: Comercio (Merchant ID, teléfono o nombre exacto) y Fecha de migración. Hasta ${SHEET_MAX_ROWS} filas.`, `Copy the columns from the sheet and paste them here. Titles: Store (Merchant ID, phone or exact name) and Migration date. Up to ${SHEET_MAX_ROWS} rows.`)}>
        <textarea name="rows" rows={6} required className="input font-mono text-[13px]" spellCheck={false} data-testid={`sheet-${kind}-rows`} />
      </Field>
      <div className="mt-4 flex justify-end"><Submit testId={`sheet-${kind}-save`}>{kind === 'visits' ? t('Cargar visitas', 'Load visits') : t('Cargar tiendas migradas', 'Load migrated stores')}</Submit></div>
    </ActionForm>
  )

  return (
    <>
      <PageHeader
        title={t(`Arranque de ${market.name}`, `${market.name} rollout`)}
        desc={t('Primero entra quien lidera; después, el equipo de campo. Aquí se lleva el avance del arranque y se cargan las visitas y las tiendas migradas que siguen en hojas.', 'Leaders come in first; the field team follows. This is where the rollout is tracked and where visits and migrated stores still kept on sheets are loaded.')}
      />
      {markets.length > 1 && <div className="mb-6"><Pills label={t('Mercado', 'Market')} current={market.code} items={markets.map((m) => ({ key: m.code, href: qs('/arranque', { mercado: m.code }), label: m.name }))} /></div>}

      {r && (
        <>
          <Card data-testid="rollout-access">
            <CardTitle
              title={t('Primero quienes lideran', 'Leaders first')}
              hint={t('Con la regla activa, en este mercado solo se da acceso de Ventas a las personas clave. Dirección, líder de mercado, supervisión y Operaciones entran siempre. Al abrir al equipo, entra el resto.', 'With the rule on, only key people get Sales access in this market. The general manager, market lead, supervisors and Operations always come in. Once it opens to the team, everyone else follows.')}
              right={<Badge tone={open ? 'good' : r.leadersFirst ? 'warn' : 'neutral'}>{open ? t('Abierto al equipo', 'Open to the team') : r.leadersFirst ? t('Solo quienes lideran', 'Leaders only') : t('Sin regla', 'No rule')}</Badge>}
            />
            <p className="text-[14px] text-strong" data-testid="rollout-state">
              {open ? t(`El mercado se abrió al equipo de campo el ${day(r.teamOpenedAt, locale, market.timezone)}.`, `The market opened to the field team on ${day(r.teamOpenedAt, locale, market.timezone)}.`)
                : r.leadersFirst ? t(leadersLeft === 0 ? 'Los pasos de quienes lideran están completos: ya se puede abrir al equipo.' : `Faltan ${leadersLeft} ${leadersLeft === 1 ? 'paso' : 'pasos'} de quienes lideran para abrir al equipo.`, leadersLeft === 0 ? 'The leaders’ steps are complete: it can open to the team now.' : `${leadersLeft} ${leadersLeft === 1 ? 'leader step' : 'leader steps'} to go before opening to the team.`)
                : t('Hoy cualquier acceso de Ventas entra. Activa la regla para que primero entren quienes lideran.', 'Any Sales access can come in today. Turn the rule on so leaders come in first.')}
            </p>
            {manage && (
              <div className="mt-4 flex flex-wrap gap-3">
                {!open && (
                  <ActionForm action={setLeadersFirstAction}>
                    <input type="hidden" name="market" value={market.code} /><input type="hidden" name="on" value={r.leadersFirst ? '0' : '1'} />
                    <Submit variant="ghost" testId="leaders-first-toggle">{r.leadersFirst ? t('Apagar la regla', 'Turn the rule off') : t('Activar: primero quienes lideran', 'Turn on: leaders first')}</Submit>
                  </ActionForm>
                )}
                {r.leadersFirst && !open && (
                  <ActionForm action={openToTeamAction}>
                    <input type="hidden" name="market" value={market.code} />
                    <Submit testId="open-team">{t('Abrir al equipo de campo', 'Open to the field team')}</Submit>
                  </ActionForm>
                )}
                {open && (
                  <ActionForm action={setLeadersFirstAction}>
                    <input type="hidden" name="market" value={market.code} /><input type="hidden" name="on" value="0" />
                    <Submit variant="quiet" testId="leaders-first-reset">{t('Quitar la regla de este mercado', 'Remove the rule from this market')}</Submit>
                  </ActionForm>
                )}
              </div>
            )}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section data-testid="rollout-leaders">
                <h3 className="mb-1 text-[14px] font-semibold text-strong">{t(`Quienes lideran y personas clave (${num(leaders.length, locale)})`, `Leaders and key people (${num(leaders.length, locale)})`)}</h3>
                {leaders.length === 0 ? <p className="text-[13.5px] text-muted">{t('Todavía nadie de este grupo tiene acceso. Se da en Administración, Personas y acceso.', 'Nobody in this group has access yet. Access is granted under Administration, People and access.')}</p> : <ul>{leaders.map(person)}</ul>}
              </section>
              <section data-testid="rollout-team">
                <h3 className="mb-1 text-[14px] font-semibold text-strong">{t(`Equipo de campo (${num(team.length, locale)})`, `Field team (${num(team.length, locale)})`)}</h3>
                {team.length === 0 ? <p className="text-[13.5px] text-muted">{t('Todavía nadie del equipo de campo tiene acceso.', 'Nobody on the field team has access yet.')}</p> : <ul>{team.map(person)}</ul>}
              </section>
            </div>
            {(manage || r.keyPeople.length > 0) && (
              <section className="mt-6 border-t border-line pt-5" data-testid="rollout-key">
                <h3 className="text-[14px] font-semibold text-strong">{t('Personas clave', 'Key people')}</h3>
                <p className="mt-1 text-[13px] text-muted">{t('Gente de Ventas que entra con quienes lideran, antes que el resto. Se anota por correo, tenga o no acceso todavía.', 'Sales people who come in with the leaders, ahead of the rest. They are listed by email, whether or not they have access yet.')}</p>
                {r.keyPeople.length > 0 && (
                  <ul className="mt-3">
                    {r.keyPeople.map((email) => (
                      <li key={email} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2 first:border-t-0" data-testid="key-person">
                        <span className="min-w-0 text-[14px] text-strong [overflow-wrap:anywhere]">{email}</span>
                        {manage && (
                          <ActionForm action={keyPersonAction}>
                            <input type="hidden" name="market" value={market.code} /><input type="hidden" name="email" value={email} /><input type="hidden" name="on" value="0" />
                            <Submit variant="quiet" size="sm" testId="key-remove">{t('Quitar', 'Remove')}</Submit>
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {manage && (
                  <ActionForm action={keyPersonAction} onOk="reset" className="mt-3 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="market" value={market.code} /><input type="hidden" name="on" value="1" />
                    <Field label={t('Correo de la persona', 'The person’s email')} className="min-w-0 flex-1 basis-64"><input name="email" type="email" required className="input" data-testid="key-email" /></Field>
                    <Submit variant="ghost" testId="key-add">{t('Agregar persona clave', 'Add key person')}</Submit>
                  </ActionForm>
                )}
              </section>
            )}
          </Card>

          <Card className="mt-6" data-testid="rollout-steps">
            <CardTitle title={t('Pasos del arranque', 'Rollout steps')} hint={t('El método: se configura primero, se muestra la herramienta terminada, y después vienen la presentación, la guía de leads, el recorrido grabado, las sesiones en español, el acompañamiento y las actualizaciones. Se enseña el proceso, no la herramienta.', 'The method: configure first, show the finished tool, then the deck, the lead guide, the recorded walkthrough, the sessions in Spanish, being present and the updates. Teach the process, not the tool.')} />
            {(['leaders', 'team'] as const).map((phase) => (
              <section key={phase} className="mt-2 first:mt-0" data-testid={`steps-${phase}`}>
                <h3 className="border-b border-line pb-2 text-[13px] font-semibold tracking-wide text-muted-2 uppercase">{phase === 'leaders' ? t('Con quienes lideran', 'With the leaders') : t('Con el equipo de campo', 'With the field team')}</h3>
                <ul>
                  {r.steps.filter((s) => s.phase === phase).map((s) => (
                    <li key={s.code} className="border-b border-line py-4 last:border-b-0" data-testid={`step-${s.code}`} data-done={s.done_at ? '1' : '0'}>
                      <div className="flex items-start gap-3">
                        <span className={cx('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', s.done_at ? 'border-transparent bg-green-100 text-brand-text' : 'border-line-2 text-transparent')} aria-hidden><Check size={15} strokeWidth={2.5} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-medium text-strong">{t(s.es, s.en)} <span className="sr-only">{s.done_at ? t('(hecho)', '(done)') : t('(pendiente)', '(to do)')}</span></p>
                          <p className="text-[13px] text-muted">{t(s.hintEs, s.hintEn)}</p>
                          {s.done_at && <p className="mt-1 text-[13px] text-muted-2" data-testid="step-done-by">{t(`Hecho el ${day(s.done_at, locale, market.timezone)}${s.done_by ? `, por ${s.done_by}` : ''}.`, `Done on ${day(s.done_at, locale, market.timezone)}${s.done_by ? `, by ${s.done_by}` : ''}.`)}</p>}
                          {s.note && <p className="mt-1 text-[13.5px] text-strong">{s.note}</p>}
                          {s.link && <p className="mt-1 text-[13.5px]"><a href={s.link} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-text underline [overflow-wrap:anywhere]" data-testid="step-link">{t('Abrir el material', 'Open the material')}</a></p>}
                          {manage && s.code !== 'team_access' && (
                            <ActionForm action={rolloutStepAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                              <input type="hidden" name="market" value={market.code} /><input type="hidden" name="step" value={s.code} />
                              <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" className="input" maxLength={300} defaultValue={s.note ?? ''} data-testid="step-note" /></Field>
                              {s.hasLink
                                ? <Field label={t('Enlace al material (https)', 'Link to the material (https)')}><input name="link" type="url" className="input" maxLength={300} defaultValue={s.link ?? ''} placeholder="https://" data-testid="step-link-input" /></Field>
                                : <span className="hidden sm:block" />}
                              <div className="flex flex-wrap items-center gap-3">
                                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="done" defaultChecked={!!s.done_at} className="h-5 w-5 shrink-0" data-testid="step-check" /><span>{t('Hecho', 'Done')}</span></label>
                                <Submit variant="ghost" size="sm" testId="step-save">{t('Guardar', 'Save')}</Submit>
                              </div>
                            </ActionForm>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </Card>
        </>
      )}

      {canVisits && (
        <Card className="mt-6" data-testid="sheet-loads">
          <CardTitle title={t('Carga desde las hojas', 'Load from the sheets')} hint={t('Mientras las hojas se retiran: lo que el equipo de campo sigue anotando ahí entra a CONTIGO sin capturarlo dos veces. Volver a pegar las mismas filas no duplica nada.', 'While the sheets are being retired: what the field team still writes there comes into CONTIGO without typing it twice. Pasting the same rows again duplicates nothing.')} />
          <div className={cx('grid grid-cols-1 gap-8', canMigrated && 'lg:grid-cols-2')}>
            <section>
              <h3 className="mb-3 text-[15px] font-semibold text-strong">{t('Visitas', 'Visits')}</h3>
              <p className="mb-4 text-[13.5px] text-muted">{t('Cada fila queda como una visita fechada en el hilo del comercio, con quién visitó, resultado y comentario.', 'Each row becomes a dated visit on the merchant’s thread, with who visited, the result and the comment.')}</p>
              {paste('visits')}
            </section>
            {canMigrated && (
              <section>
                <h3 className="mb-3 text-[15px] font-semibold text-strong">{t('Tiendas migradas', 'Migrated stores')}</h3>
                <p className="mb-4 text-[13.5px] text-muted">{t('Cada tienda queda con un negocio ganado en su fecha real de migración: los ganados por mes cuentan la historia como fue.', 'Each store ends up with one deal won on its real migration date, so won-by-month counts tell the history as it was.')}</p>
                {paste('migrated')}
              </section>
            )}
          </div>
          <section className="mt-8 border-t border-line pt-5" data-testid="sheet-history">
            <h3 className="mb-3 text-[15px] font-semibold text-strong">{t('Cargas recientes', 'Recent loads')}</h3>
            {loads.length === 0 ? (
              <Empty title={t('Todavía no hay cargas', 'No loads yet')} hint={t('La primera aparece aquí con cuántas filas entraron y cuáles hay que corregir en la hoja.', 'The first one shows up here with how many rows came in and which ones need fixing on the sheet.')} />
            ) : (
              <ul>
                {loads.map((l) => (
                  <li key={l.id} className="border-t border-line py-3 first:border-t-0" data-testid="sheet-load">
                    <p className="text-[14.5px] font-medium text-strong">{l.kind === 'visits' ? t('Visitas', 'Visits') : t('Tiendas migradas', 'Migrated stores')}{l.label ? ` · ${l.label}` : ''}</p>
                    <p className="text-[13px] text-muted" data-testid="sheet-load-counts">{t(`${l.rows_loaded} cargadas · ${l.rows_known} ya estaban · ${l.rows_failed} con problema · ${l.by ?? 's/d'}, ${ago(l.created_at, locale)}`, `${l.rows_loaded} loaded · ${l.rows_known} already there · ${l.rows_failed} with a problem · ${l.by ?? 'n/a'}, ${ago(l.created_at, locale)}`)}</p>
                    {l.problems.length > 0 && (
                      <ul className="mt-2 rounded-[10px] bg-warn-bg px-4 py-3 text-[13.5px] text-amber-text" data-testid="sheet-problems">
                        {l.problems.slice(0, 20).map((p) => <li key={`${l.id}:${p.row}:${p.es}`}>{t(`Fila ${p.row}: ${p.es}`, `Row ${p.row}: ${p.en}`)}</li>)}
                        {l.problems.length > 20 && <li>{t(`Y ${l.problems.length - 20} más.`, `And ${l.problems.length - 20} more.`)}</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Card>
      )}
    </>
  )
}
