import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { qualityBoard, qualityQueue } from '@/dal/datos'
import { QUALITY_OWNER_ROLES } from '@/domain/gobierno'
import { Badge, Bar, Card, CardTitle, Empty, Field, Pills, Table } from '@/ui/kit'
import { Dialog, Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { ago, day, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { QUALITY_ROLE } from '@/lib/datos-labels'
import { setQualityRuleAction } from './actions'

const NO_TEAM = 'sin-equipo'

/**
 * GOB-02: tablero de calidad de datos. Cada regla tiene responsable; cada número es un enlace a la cola de registros que
 * hoy la incumplen. Cada quien mide lo que ve: supervisión, su equipo; quien lidera, su mercado; administración, todo.
 */
export async function CalidadTab({ ctx, market, team, rule }: { ctx: Ctx; market: string | null; team: string | null; rule: string | null }) {
  const { t, locale } = ctx
  const d = await qualityBoard(ctx)
  const admin = ctx.can('config.manage')
  const markets = ctx.markets.filter((m) => m.status === 'live' && d.cells.some((c) => c.market_code === m.code))
  const current = markets.find((m) => m.code === market) ?? markets[0]
  if (!current) return <Empty title={t('Todavía no hay registros que medir', 'There are no records to measure yet')} hint={t('Cuando haya comercios en tu alcance, aquí vas a ver qué les falta.', 'Once there are merchants in your scope, you will see what they are missing here.')} />
  const inMarket = d.cells.filter((c) => c.market_code === current.code)
  const teams = [...new Map(inMarket.filter((c) => c.team_id).map((c) => [c.team_id!, c.team_name ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const hasNoTeam = inMarket.some((c) => !c.team_id && c.total > 0)
  const teamKey = team && (teams.some(([id]) => id === team) || team === NO_TEAM) ? team : ''
  const cells = inMarket.filter((c) => (teamKey === '' ? true : teamKey === NO_TEAM ? !c.team_id : c.team_id === teamKey))
  const rules = d.rules.filter((r) => r.is_active || admin)
  const sum = (code: string) => cells.filter((c) => c.rule_code === code).reduce((acc, c) => ({ total: acc.total + c.total, failing: acc.failing + c.failing }), { total: 0, failing: 0 })
  // Tendencia: el corte más antiguo de los últimos 30 días contra lo que se mide hoy. Solo a nivel de mercado.
  const first = (code: string) => d.trend.find((x) => x.market_code === current.code && x.rule_code === code)
  const picked = rule ? rules.find((r) => r.code === rule) : undefined
  const queue = picked && !['duplicate', 'bypass', 'field_review'].includes(picked.code) ? await qualityQueue(ctx, picked.code, current.code) : []
  const base = { tab: 'calidad', mercado: current.code, equipo: teamKey || undefined }
  const queueHref = (code: string) =>
    code === 'duplicate' || code === 'bypass' ? qs('/datos', { tab: 'duplicados', mercado: current.code }) : code === 'field_review' ? qs('/datos', { tab: 'campos', vista: 'sin-decision' }) : `${qs('/datos', { ...base, regla: code })}#cola`
  const worst = rules.map((r) => ({ r, ...sum(r.code) })).filter((x) => x.r.is_active && x.failing > 0).length

  return (
    <div className="space-y-8" data-testid="quality-board">
      {markets.length > 1 && <Pills label={t('Mercado', 'Market')} current={current.code} items={markets.map((m) => ({ key: m.code, href: qs('/datos', { tab: 'calidad', mercado: m.code }), label: m.name }))} />}
      {(teams.length > 1 || (teams.length === 1 && hasNoTeam)) && (
        <Pills label={t('Equipo', 'Team')} current={teamKey} items={[{ key: '', href: qs('/datos', { tab: 'calidad', mercado: current.code }), label: t('Todos los equipos', 'All teams') },
          ...teams.map(([id, name]) => ({ key: id, href: qs('/datos', { tab: 'calidad', mercado: current.code, equipo: id }), label: name })),
          ...(hasNoTeam ? [{ key: NO_TEAM, href: qs('/datos', { tab: 'calidad', mercado: current.code, equipo: NO_TEAM }), label: t('Sin equipo', 'No team') }] : [])]} />
      )}
      <Card pad={false}>
        <div className="px-5 pt-6 md:px-7 md:pt-7">
          <CardTitle title={t(`Reglas de calidad en ${current.name}`, `Quality rules in ${current.name}`)}
            hint={worst === 0 ? t('Todo en orden: ninguna regla tiene registros por corregir.', 'All clear: no rule has records to fix.') : t(`${worst === 1 ? '1 regla tiene' : `${worst} reglas tienen`} registros por corregir. Toca el número para ver cuáles son.`, `${worst === 1 ? '1 rule has' : `${worst} rules have`} records to fix. Tap the number to see which.`)} />
        </div>
        <Table testId="quality-table" label={t('Reglas de calidad', 'Quality rules')} head={<><th>{t('Regla', 'Rule')}</th><th>{t('Responde', 'Owner')}</th><th>{t('Por corregir', 'To fix')}</th><th className="min-w-[150px]">{t('Completo', 'Complete')}</th><th>{t('Tendencia', 'Trend')}</th>{admin && <th><span className="sr-only">{t('Editar', 'Edit')}</span></th>}</>}>
          {rules.map((r) => {
            const s = sum(r.code)
            const f = teamKey === '' ? first(r.code) : undefined
            const delta = f ? s.failing - f.failing : null
            return (
              <tr key={r.code} className="table-row" data-testid="quality-row" data-rule={r.code}>
                <td>
                  <span className={r.is_active ? 'font-semibold text-strong' : 'text-muted line-through'}>{t(r.label_es, r.label_en)}</span>
                  {r.threshold !== null && <span className="ml-2 text-[13px] text-muted">{t(`más de ${r.threshold} días`, `over ${r.threshold} days`)}</span>}
                  <span className="block text-[13px] text-muted-2">{t(r.fix_es, r.fix_en)}</span>
                </td>
                <td className="text-[13.5px]" data-testid="quality-owner">{r.owner_name ?? t(...QUALITY_ROLE[r.owner_role]!)}</td>
                <td className="num">
                  {s.failing > 0 ? <Link href={queueHref(r.code)} className="inline-flex min-h-11 items-center font-semibold text-blue-text underline" data-testid="quality-open">{num(s.failing, locale)}</Link> : <span className="text-muted">0</span>}
                  <span className="text-[13px] text-muted"> {t('de', 'of')} {num(s.total, locale)}</span>
                </td>
                <td><div className="flex items-center gap-3"><Bar value={s.total - s.failing} max={s.total} tone={s.failing === 0 ? 'good' : 'accent'} /><span className="num w-11 shrink-0 text-right text-[13px] text-muted-2">{s.total > 0 ? `${Math.round(((s.total - s.failing) / s.total) * 100)}%` : t('n/a', 'n/a')}</span></div></td>
                <td className="text-[13.5px]" data-testid="quality-trend">
                  {delta === null ? <span className="text-muted">{teamKey === '' ? t('Sin corte anterior', 'No earlier snapshot') : t('Solo por mercado', 'Market level only')}</span>
                    : delta === 0 ? <span className="text-muted-2">{t('Igual que el', 'Same as on')} {day(f!.as_of, locale)}</span>
                      : <Badge tone={delta < 0 ? 'good' : 'warn'}>{delta < 0 ? t(`Bajó ${-delta} desde el ${day(f!.as_of, locale)}`, `Down ${-delta} since ${day(f!.as_of, locale)}`) : t(`Subió ${delta} desde el ${day(f!.as_of, locale)}`, `Up ${delta} since ${day(f!.as_of, locale)}`)}</Badge>}
                </td>
                {admin && (
                  <td className="text-right">
                    <Dialog trigger={t('Editar', 'Edit')} title={t(`Regla: ${r.label_es}`, `Rule: ${r.label_en}`)} size="sm" testId="quality-edit">
                      <NoticeForm action={setQualityRuleAction} className="space-y-4 text-left">
                        <input type="hidden" name="code" value={r.code} />
                        <Field label={t('Responde por la regla', 'Who owns the rule')}><select name="owner_role" className="input" defaultValue={r.owner_role} data-testid="quality-owner-role">{QUALITY_OWNER_ROLES.map((k) => <option key={k} value={k}>{t(...QUALITY_ROLE[k]!)}</option>)}</select></Field>
                        <Field label={t('Persona responsable (opcional)', 'Person in charge (optional)')}><select name="owner_id" className="input" defaultValue={r.owner_id ?? ''} data-testid="quality-owner-person"><option value="">{t('Solo el rol', 'Role only')}</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
                        {r.threshold !== null && <Field label={t('Días sin movimiento para contarlo', 'Days with no activity to count it')}><input name="threshold" type="number" min={7} max={730} className="input !w-32" defaultValue={r.threshold} required /></Field>}
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="active" className="h-5 w-5 shrink-0" defaultChecked={r.is_active} />{t('La regla se mide', 'The rule is measured')}</label>
                        <div className="flex justify-end"><Submit testId="quality-save">{t('Guardar', 'Save')}</Submit></div>
                      </NoticeForm>
                    </Dialog>
                  </td>
                )}
              </tr>
            )
          })}
        </Table>
        <p className="px-5 py-4 text-[13px] text-muted md:px-7">{t('La tendencia compara lo de hoy con el corte más antiguo de los últimos 30 días. El corte se guarda una vez al día.', 'The trend compares today with the oldest snapshot of the last 30 days. A snapshot is saved once a day.')}</p>
      </Card>

      {picked && (
        <Card pad={false} id="cola" data-testid="quality-queue">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t(picked.label_es, picked.label_en)} hint={t(picked.fix_es, picked.fix_en)} /></div>
          {queue.length === 0 ? <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('Nada por corregir aquí', 'Nothing to fix here')} hint={t('Ningún registro de tu alcance incumple esta regla hoy.', 'No record in your scope breaks this rule today.')} /></div> : (
            <Table label={t('Registros por corregir', 'Records to fix')} head={<><th>{t('Registro', 'Record')}</th><th>{t('Quién lo lleva', 'Owner')}</th><th>{t('Último cambio', 'Last change')}</th></>}>
              {queue.map((q) => (
                <tr key={q.id} className="table-row" data-testid="quality-queue-row">
                  <td><Link href={q.kind === 'deal' ? `/deals/${q.id}` : `/comercios/${q.id}?tab=datos`} className="inline-flex min-h-11 items-center font-semibold text-blue-text underline">{q.name}</Link></td>
                  <td className="text-[13.5px]">{q.who ?? <span className="text-amber-text">{t('Sin asignar', 'Unassigned')}</span>}</td>
                  <td className="text-[13.5px] text-muted-2">{ago(q.since, locale)}</td>
                </tr>
              ))}
            </Table>
          )}
          {queue.length >= 100 && <p className="px-5 py-4 text-[13px] text-muted md:px-7">{t('Se muestran los primeros 100, del más antiguo al más reciente.', 'Showing the first 100, oldest first.')}</p>}
        </Card>
      )}
    </div>
  )
}
