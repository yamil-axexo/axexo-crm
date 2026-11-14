import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { getConflicts, getCutover, getOrphans, getRebuild, type RebuildRow } from '@/dal/coexistence'
import { Badge, Card, CardTitle, Empty, NoData } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { resolveConflictAction, setCutoverAction } from './pipedrive-actions'

// Solo la primera letra en minúscula: los nombres propios (Pipedrive, CONTIGO) se quedan como son.
const lowerFirst = (x: string) => (x.length > 1 && x[1] === x[1]!.toUpperCase() && /[A-Z]/.test(x[1]!) ? x : x.charAt(0).toLowerCase() + x.slice(1))

type Pair = [es: string, en: string]

const FIELD: Record<string, Pair> = {
  name: ['Nombre', 'Name'], full_name: ['Nombre', 'Name'], title: ['Título', 'Title'], owner_id: ['Quién lo lleva', 'Owner'], phone: ['Teléfono', 'Phone'],
  email: ['Correo', 'Email'], segment: ['Segmento', 'Segment'], territory_id: ['Territorio', 'Territory'], address_line: ['Dirección', 'Address'],
  locality: ['Ciudad', 'City'], region: ['Estado', 'State'], postal_code: ['Código postal', 'Postal code'], amount_minor: ['Monto', 'Amount'], stage_id: ['Etapa', 'Stage'],
}
const OBJECT: Record<string, Pair> = { account: ['Comercio', 'Merchant'], contact: ['Contacto', 'Contact'], deal: ['Negocio', 'Deal'] }
const KIND: Record<string, Pair> = {
  automation: ['Automatizaciones', 'Automations'], assignment: ['Asignación automática', 'Automatic assignment'], report: ['Reportes de Insights', 'Insights reports'],
  dashboard: ['Tableros de Insights', 'Insights dashboards'], goal: ['Metas', 'Goals'], filter: ['Filtros del equipo', 'Team filters'],
}
const STATUS: Record<RebuildRow['status'], { label: Pair; tone: 'good' | 'warn' | 'neutral' }> = {
  built: { label: ['ya existe', 'in place'], tone: 'good' },
  off: { label: ['apagada', 'off'], tone: 'neutral' },
  pending: { label: ['falta algo', 'something missing'], tone: 'warn' },
}
const link = (o: string, id: string) => (o === 'deal' ? `/deals/${id}` : o === 'account' ? `/comercios/${id}` : null)

/** GOB-05 y E6.F2/F3/F6: convivencia por mercado, choques por decidir y lo que falta por reconstruir de Pipedrive. */
export async function CoexistenceCards({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const [markets, conflicts, rebuild, orphans] = await Promise.all([getCutover(ctx), getConflicts(ctx), getRebuild(ctx), getOrphans(ctx)])
  const canDecide = ctx.can('migration.decide')
  const pending = rebuild.filter((r) => r.status !== 'built').length
  const kinds = [...new Set(rebuild.map((r) => r.kind))]
  return (
    <>
      <Card data-testid="cutover">
        <CardTitle
          title={t('Convivencia con Pipedrive por mercado', 'Coexistence with Pipedrive by market')}
          hint={t('El corte es un congelamiento, una última sincronización y después solo CONTIGO. Cada criterio se mide aquí; lo que está en gris es lo que falta para apagar Pipedrive.', 'The cutover is a freeze, a last sync, then CONTIGO only. Each criterion is measured here; what is grey is what is missing to switch Pipedrive off.')}
        />
        <div className="grid gap-5 lg:grid-cols-2">
          {markets.map((m) => {
            const missing = m.criteria.filter((c) => !c.ok)
            return (
              <section key={m.market} className="rounded-[14px] border border-line-2 p-5" data-testid={`cutover-${m.market}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-strong">{m.name}</h3>
                  {m.pipedrive_off_at ? <Badge tone="good">{t('Pipedrive apagado', 'Pipedrive off')}</Badge>
                    : m.frozen_at ? <Badge tone="warn">{t('Pipedrive congelado', 'Pipedrive frozen')}</Badge>
                    : <Badge>{t('Conviven los dos', 'Both in use')}</Badge>}
                </div>
                <ul className="space-y-1.5 text-[13.5px]">
                  {m.criteria.map((c) => (
                    <li key={c.key} className="flex items-start gap-2" data-testid={`criterion-${c.key}`} data-ok={c.ok ? 'yes' : 'no'}>
                      <span aria-hidden className={c.ok ? 'mt-1.5 inline-block size-2 shrink-0 rounded-full bg-green-600' : 'mt-1.5 inline-block size-2 shrink-0 rounded-full bg-line-2'} />
                      <span><span className={c.ok ? 'text-strong' : 'text-muted'}>{t(c.label[0], c.label[1])}</span> <span className="text-muted-2">{t(c.detail[0], c.detail[1])}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] text-muted" data-testid="cutover-missing">
                  {m.pipedrive_off_at ? t(`Apagado el ${dayTime(m.pipedrive_off_at, locale, 'UTC')}.`, `Switched off on ${dayTime(m.pipedrive_off_at, locale, 'UTC')}.`)
                    : missing.length === 0 ? t('Todo listo: ya se puede apagar Pipedrive en este mercado.', 'All set: Pipedrive can be switched off in this market.')
                    : t(`Falta para apagar Pipedrive: ${missing.map((c) => lowerFirst(c.label[0])).join(', ')}.`, `Missing to switch Pipedrive off: ${missing.map((c) => lowerFirst(c.label[1])).join(', ')}.`)}
                </p>
                {canDecide && !m.pipedrive_off_at && (
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <ActionForm action={setCutoverAction} className="flex flex-wrap items-end gap-2" testId={`cutover-date-${m.market}`}>
                      <input type="hidden" name="market" value={m.market} />
                      <input type="hidden" name="op" value="date" />
                      <label className="text-[13px] text-muted">{t('Fecha de corte', 'Cutover date')}
                        <input type="date" name="cutoff_on" defaultValue={m.cutoff_on ?? ''} className="input mt-1 block !w-44" data-testid={`cutoff-${m.market}`} />
                      </label>
                      <Submit variant="ghost" size="sm" testId={`cutoff-save-${m.market}`}>{t('Guardar fecha', 'Save date')}</Submit>
                    </ActionForm>
                    <ActionForm action={setCutoverAction}>
                      <input type="hidden" name="market" value={m.market} />
                      <input type="hidden" name="op" value={m.frozen_at ? 'unfreeze' : 'freeze'} />
                      <Submit variant="ghost" size="sm" testId={`freeze-${m.market}`}>{m.frozen_at ? t('Descongelar', 'Unfreeze') : t('Congelar Pipedrive', 'Freeze Pipedrive')}</Submit>
                    </ActionForm>
                    {m.frozen_at && m.last_sync_at && (
                      <ActionForm action={setCutoverAction}>
                        <input type="hidden" name="market" value={m.market} />
                        <input type="hidden" name="op" value="off" />
                        <Submit variant="danger" size="sm" testId={`off-${m.market}`}>{t('Apagar Pipedrive en este mercado', 'Switch Pipedrive off in this market')}</Submit>
                      </ActionForm>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </Card>

      <Card data-testid="conflicts">
        <CardTitle
          title={t(`Choques por decidir (${conflicts.open})`, `Clashes to decide (${conflicts.open})`)}
          hint={t('Lo editado en CONTIGO manda: la recarga no lo pisa. Cuando el mismo campo cambió en CONTIGO y en Pipedrive, se queda lo de CONTIGO y aquí decides.', 'What was edited in CONTIGO wins: a reload does not overwrite it. When the same field changed in CONTIGO and in Pipedrive, the CONTIGO value stays and you decide here.')}
        />
        {conflicts.rows.length === 0 ? (
          <Empty title={t('No hay choques por decidir', 'No clashes to decide')} hint={t('Aparecen aquí después de una recarga, si alguien cambió en Pipedrive algo que ya se había editado en CONTIGO.', 'They show up here after a reload, if someone changed in Pipedrive something already edited in CONTIGO.')} />
        ) : (
          <ul className="divide-y divide-line">
            {conflicts.rows.map((c) => {
              const href = link(c.object, c.record_id)
              const label = c.record_label || t('(sin nombre)', '(no name)')
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]" data-testid="conflict-row">
                  <div className="min-w-0">
                    <p className="text-strong">
                      {t(OBJECT[c.object]![0], OBJECT[c.object]![1])} · {href ? <Link href={href} className="underline">{label}</Link> : label} · <span className="font-medium">{t(FIELD[c.field]?.[0] ?? c.field, FIELD[c.field]?.[1] ?? c.field)}</span>
                      <span className="ml-2 text-muted-2">{c.market_code}</span>
                    </p>
                    <p className="text-muted">
                      {t('En CONTIGO: ', 'In CONTIGO: ')}<span className="text-strong" data-testid="conflict-contigo">{c.contigo ?? <NoData locale={locale} />}</span>
                      {' · '}{t('En Pipedrive: ', 'In Pipedrive: ')}<span className="text-strong" data-testid="conflict-pipedrive">{c.pipedrive ?? <NoData locale={locale} />}</span>
                    </p>
                  </div>
                  {canDecide && (
                    <div className="flex gap-2">
                      <ActionForm action={resolveConflictAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="choice" value="keep" /><Submit variant="ghost" size="sm" testId="conflict-keep">{t('Quedarse con CONTIGO', 'Keep CONTIGO')}</Submit></ActionForm>
                      <ActionForm action={resolveConflictAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="choice" value="take" /><Submit variant="ghost" size="sm" testId="conflict-take">{t('Usar Pipedrive', 'Use Pipedrive')}</Submit></ActionForm>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card data-testid="orphans">
        <CardTitle
          title={t(`Ya no están en Pipedrive (${orphans.total})`, `No longer in Pipedrive (${orphans.total})`)}
          hint={t('Registros cargados que la última importación completa ya no trajo: se borraron o se fusionaron en Pipedrive. CONTIGO no los borra; ábrelos y decide si se archivan, se fusionan o se quedan.', 'Loaded records the last full import no longer brought: they were deleted or merged in Pipedrive. CONTIGO does not delete them; open them and decide whether to archive, merge or keep them.')}
        />
        {orphans.rows.length === 0 ? <Empty title={t('Nada que revisar', 'Nothing to review')} hint={t('Aparecen aquí después de una importación completa.', 'They show up here after a full import.')} /> : (
          <ul className="divide-y divide-line">
            {orphans.rows.map((o) => {
              const obj = o.object === 'organization' ? 'account' : o.object === 'person' ? 'contact' : 'deal'
              const href = o.record_id ? link(obj, o.record_id) : null
              const label = o.label || t('(sin nombre)', '(no name)')
              return (
                <li key={`${o.object}:${o.external_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]" data-testid="orphan-row">
                  <span className="text-strong">{t(OBJECT[obj]![0], OBJECT[obj]![1])} · {href ? <Link href={href} className="underline">{label}</Link> : label}</span>
                  <span className="text-muted-2">{o.market_code ?? ''} · {t('visto por última vez', 'last seen')} {dayTime(o.fetched_at, locale, 'UTC')}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card data-testid="rebuild">
        <CardTitle
          title={t('Qué falta por reconstruir', 'What is left to rebuild')}
          hint={t(`Lo que el equipo armó en Pipedrive y dónde quedó en CONTIGO. ${pending === 0 ? 'Todo existe.' : `${pending} piezas están apagadas o les falta algo.`}`, `What the team built in Pipedrive and where it lives in CONTIGO. ${pending === 0 ? 'Everything exists.' : `${pending} pieces are off or missing something.`}`)}
        />
        {rebuild.length === 0 ? <Empty title={t('Sin inventario', 'No inventory')} hint={t('El inventario se siembra con la migración de la base.', 'The inventory is seeded by the database migration.')} /> : (
          <div className="space-y-6">
            {kinds.map((k) => (
              <section key={k}>
                <h3 className="mb-2 text-[14px] font-semibold text-strong">{t(KIND[k]?.[0] ?? k, KIND[k]?.[1] ?? k)}</h3>
                <ul className="space-y-3">
                  {rebuild.filter((r) => r.kind === k).map((r) => (
                    <li key={r.pd_name} className="flex min-h-11 flex-wrap items-start justify-between gap-2 text-[13.5px]" data-testid="rebuild-row" data-status={r.status}>
                      <div className="min-w-0 max-w-[60ch]">
                        <p className="text-strong"><span lang="en">{r.pd_name}</span>{r.market_code ? <span className="ml-2 text-muted-2">{r.market_code}</span> : null}</p>
                        <p className="text-muted">{t(r.note_es ?? '', r.note_en ?? '')}</p>
                      </div>
                      <span className="flex items-center gap-2">
                        <Badge tone={STATUS[r.status].tone}>{t(STATUS[r.status].label[0], STATUS[r.status].label[1])}</Badge>
                        {r.contigo_path && <Link href={r.contigo_path} className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 underline">{t('Abrir', 'Open')}</Link>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
