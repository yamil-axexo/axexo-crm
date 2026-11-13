import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { withUser } from '@/server/db'
import { allBoards, type BoardRole } from '@/dal/role-boards'
import { proposedValues, peopleAliases } from '@/dal/reportes2'
import { PROPOSED_OWNER, type ProposedKey } from '@/domain/reportes2'
import { QUALITY_NOTICE_RULES } from '@/domain/reportes2-jobs'
import { METRICS, METRIC_KEYS, type MetricKey } from '@/lib/metric-defs'
import { ROLE_LABEL } from '@/domain/policy'
import { Badge, Card, CardTitle, Empty, Field, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { day } from '@/lib/format'
import { proposedAction, roleBoardAction, userAliasAction } from '../../reportes/kam/actions'

export const dynamic = 'force-dynamic'

const ROLES: BoardRole[] = ['kam', 'partner', 'ops', 'finance']
const PREFIX: Record<BoardRole, string> = { kam: 'kam', partner: 'partner', ops: 'ops', finance: 'finance' }
const RULE_LABEL: Record<string, [string, string]> = {
  no_phone: ['Comercios sin teléfono', 'Merchants with no phone'], no_address: ['Comercios sin dirección', 'Merchants with no address'],
  no_coords: ['Puntos de venta sin ubicación', 'Stores with no location'], no_contact: ['Comercios sin contacto', 'Merchants with no contact'],
  s5_diff: ['Diferencias con el archivo de ventas', 'Differences with the sales file'],
}

/**
 * reportes2: lo que depende de que otra persona decida, guardado como dato y marcado como propuesta hasta que lo fija quien
 * responde. Tableros por rol (C1), valores del archivo de ventas y de la ventana corta (Data y Reportería), reglas que abren
 * avisos (C1), regla de paso a despliegue (Yamil y quienes lideran), plantilla del pedido (Marketing) e IDs de las personas en S5.
 */
export default async function BoardsAdminPage() {
  const ctx = await requireCtx()
  if (!ctx.can('metric.owner') && !ctx.can('config.manage') && !ctx.can('user_alias.manage')) notFound()
  const { t, locale } = ctx
  const [boards, proposed, people] = await Promise.all([allBoards(ctx), withUser(ctx.user.id, (tx) => proposedValues(tx)), ctx.can('user_alias.manage') ? peopleAliases(ctx) : Promise.resolve([])])
  const pendingBadge = (pending: string) => <Badge tone="warn">{t(`Valor propuesto, [pendiente: ${pending}]`, `Proposed value, [pending: ${pending}]`)}</Badge>
  const setBadge = <Badge tone="good">{t('Fijado', 'Set')}</Badge>
  const pv = (k: ProposedKey) => proposed[k] ?? null

  return (
    <div className="space-y-8">
      <PageHeader title={t('Tableros y valores propuestos', 'Boards and proposed values')}
        desc={t('Lo que decide otra persona vive aquí como dato: mientras no lo fije, la pantalla lo dice como propuesta y Estado de CONTIGO lo lista con su dueño.', 'What someone else decides lives here as data: until they set it, the screen shows it as a proposal and CONTIGO status lists it with its owner.')} />

      {ctx.can('metric.owner') && (
        <Card data-testid="role-boards-admin">
          <CardTitle title={t('Tableros por rol', 'Boards by role')} hint={t('De 5 a 7 indicadores por rol, en orden. Cada uno tiene su definición en Indicadores y responsables; aquí se elige cuáles van y quién responde.', '5 to 7 indicators per role, in order. Each one has its definition in Metrics and owners; here you choose which go and who answers for them.')} />
          <div className="grid gap-6 lg:grid-cols-2">
            {ROLES.map((role) => {
              const rows = boards.filter((b) => b.role === role)
              const chosen = new Set(rows.map((r) => r.metric_key))
              const options = METRIC_KEYS.filter((k) => k.startsWith(PREFIX[role]) || chosen.has(k))
              const confirmed = rows.length > 0 && rows.every((r) => r.confirmed)
              return (
                <ActionForm key={role} action={roleBoardAction} className="rounded-[14px] border border-line p-4" testId={`role-board-${role}`}>
                  <input type="hidden" name="role" value={role} />
                  <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-strong">{t(ROLE_LABEL[role].es, ROLE_LABEL[role].en)} {confirmed ? setBadge : pendingBadge(rows[0]?.pending_owner ?? 'C1 (Yamil Alvarez)')}</p>
                  <ul className="space-y-1">
                    {options.map((k) => {
                      const row = rows.find((r) => r.metric_key === k)
                      return (
                        <li key={k} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
                          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                            <input type="checkbox" name="keys" value={k} defaultChecked={chosen.has(k)} className="h-5 w-5 shrink-0" data-testid={`rb-key-${role}-${k}`} />
                            {t(METRICS[k as MetricKey].label[0], METRICS[k as MetricKey].label[1])}
                          </label>
                          <input name={`owner_${k}`} className="input !h-10" defaultValue={row?.owner_label ?? ''} maxLength={80} placeholder={t(METRICS[k as MetricKey].owner[0], METRICS[k as MetricKey].owner[1])} aria-label={t('Quién responde', 'Who answers for it')} />
                        </li>
                      )
                    })}
                  </ul>
                  <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="confirm" defaultChecked={confirmed} className="h-5 w-5 shrink-0" data-testid={`rb-confirm-${role}`} />{t('Quien decide confirmó esta lista', 'The decision owner confirmed this list')}</label>
                  <div className="mt-3"><Submit size="sm" testId={`rb-save-${role}`}>{t('Guardar', 'Save')}</Submit></div>
                </ActionForm>
              )
            })}
          </div>
        </Card>
      )}

      {ctx.can('config.manage') && (
        <Card data-testid="proposed-admin">
          <CardTitle title={t('Valores propuestos', 'Proposed values')} hint={t('Cada valor dice de quién depende. Guardarlo marcado como "fijado" lo saca de la lista de pendientes.', 'Each value says who it depends on. Saving it marked as "set" takes it off the pending list.')} />
          <div className="grid gap-5 lg:grid-cols-2">
            <ActionForm action={proposedAction} className="rounded-[14px] border border-line p-4" testId="pv-manifest">
              <input type="hidden" name="key" value="ingest.require_manifest" />
              <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-strong">{t('Manifiesto obligatorio en el archivo de ventas', 'Manifest required in the sales file')} {pv('ingest.require_manifest')?.proposed !== false ? pendingBadge(PROPOSED_OWNER['ingest.require_manifest']) : setBadge}</p>
              <Field label={t('Un archivo sin manifiesto', 'A file with no manifest')}>
                <select name="value" className="input" defaultValue={String(pv('ingest.require_manifest')?.value ?? false)} data-testid="pv-manifest-value">
                  <option value="false">{t('Entra (propuesta mientras el manifiesto no llega)', 'Gets in (proposal while the manifest is not delivered)')}</option>
                  <option value="true">{t('No entra', 'Is rejected')}</option>
                </select>
              </Field>
              <ConfirmAndSave t={t} testId="pv-manifest" />
            </ActionForm>

            <ActionForm action={proposedAction} className="rounded-[14px] border border-line p-4" testId="pv-window">
              <input type="hidden" name="key" value="snapshots.window_days" />
              <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-strong">{t('Ventana corta de la foto diaria', 'Short window of the daily snapshot')} {pv('snapshots.window_days')?.proposed !== false ? pendingBadge(PROPOSED_OWNER['snapshots.window_days']) : setBadge}</p>
              <Field label={t('Días que se quedan en CONTIGO', 'Days kept in CONTIGO')} hint={t('Solo se borra lo que ya se entregó al lakehouse. Con el canal apagado no se borra nada.', 'Only what was already delivered to the lakehouse is removed. With the channel off nothing is removed.')}>
                <input name="value" type="number" min={30} max={3650} className="input" defaultValue={Number(pv('snapshots.window_days')?.value ?? 90)} data-testid="pv-window-value" />
              </Field>
              <ConfirmAndSave t={t} testId="pv-window" />
            </ActionForm>

            <ActionForm action={proposedAction} className="rounded-[14px] border border-line p-4" testId="pv-quality">
              <input type="hidden" name="key" value="quality.exception_rules" />
              <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-strong">{t('Reglas de calidad que abren avisos', 'Data quality rules that open notices')} {pv('quality.exception_rules')?.proposed !== false ? pendingBadge(PROPOSED_OWNER['quality.exception_rules']) : setBadge}</p>
              {QUALITY_NOTICE_RULES.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                  <input type="checkbox" name="rules" value={r} defaultChecked={((pv('quality.exception_rules')?.value as string[] | undefined) ?? []).includes(r)} className="h-5 w-5 shrink-0" data-testid={`pv-quality-${r}`} />
                  {t(...(RULE_LABEL[r] ?? [r, r]))}
                </label>
              ))}
              <Field label={t('Desde cuántos registros por persona', 'From how many records per person')}>
                <input name="min_failing" type="number" min={1} max={1000} className="input" defaultValue={Number(pv('quality.exception_rules')?.min_failing ?? 5)} data-testid="pv-quality-min" />
              </Field>
              <ConfirmAndSave t={t} testId="pv-quality" />
            </ActionForm>

            <ActionForm action={proposedAction} className="rounded-[14px] border border-line p-4" testId="pv-rollout">
              <input type="hidden" name="key" value="adoption.rollout_rule" />
              <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-strong">{t('Paso a despliegue', 'Rollout readiness')} {pv('adoption.rollout_rule')?.proposed !== false ? pendingBadge(PROPOSED_OWNER['adoption.rollout_rule']) : setBadge}</p>
              <Field label={t('Semanas seguidas en que quien supervisa abre el tablero', 'Weeks in a row the supervisor opens the board')}>
                <input name="supervisor_weeks" type="number" min={1} max={8} className="input" defaultValue={Number(pv('adoption.rollout_rule')?.supervisor_weeks ?? 3)} data-testid="pv-rollout-weeks" />
              </Field>
              <Field label={t('1:1 con el tablero en 30 días (mínimo)', '1:1s with the board in 30 days (minimum)')}>
                <input name="one_on_ones_min" type="number" min={0} max={20} className="input" defaultValue={Number(pv('adoption.rollout_rule')?.one_on_ones_min ?? 1)} />
              </Field>
              <Field label={t('Resultado que cuenta', 'Outcome that counts')}>
                <select name="result" className="input" defaultValue={String(pv('adoption.rollout_rule')?.result ?? 'active_30d')}>
                  <option value="active_30d">{t('Comercios activos a 30 días', 'Merchants active at 30 days')}</option>
                  <option value="visits_per_enrollment">{t('Visitas por alta', 'Visits per enrollment')}</option>
                </select>
              </Field>
              <ConfirmAndSave t={t} testId="pv-rollout" />
            </ActionForm>

            <ActionForm action={proposedAction} className="rounded-[14px] border border-line p-4" testId="pv-brand">
              <input type="hidden" name="key" value="orders.brand" />
              <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-strong">{t('Encabezado del PDF del pedido', 'Order PDF header')} {pv('orders.brand')?.proposed !== false ? pendingBadge(PROPOSED_OWNER['orders.brand']) : setBadge}</p>
              <Field label={t('Mercado', 'Market')}>
                <select name="market" className="input" defaultValue={ctx.markets[0]?.code}>{ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
              </Field>
              <Field label={t('Empresa que va en el pedido', 'Company on the order')}><input name="company" className="input" maxLength={80} data-testid="pv-brand-company" /></Field>
              <Field label={t('Línea bajo el nombre (opcional)', 'Line under the name (optional)')}><input name="tagline" className="input" maxLength={120} /></Field>
              <p className="text-[13px] text-muted">{t('Hoy: ', 'Today: ')}{Object.entries(pv('orders.brand') ?? {}).filter(([k]) => k.length === 2).map(([k, v]) => `${k}: ${(v as { company?: string | null }).company ?? t('sin empresa', 'no company')}`).join(' · ') || t('sin plantilla', 'no template')}. {t('El logotipo lo entrega Marketing.', 'Marketing delivers the logo.')}</p>
              <ConfirmAndSave t={t} testId="pv-brand" />
            </ActionForm>
          </div>
        </Card>
      )}

      {ctx.can('user_alias.manage') && (
        <Card data-testid="user-aliases">
          <CardTitle title={t('ID de cada persona en el archivo de ventas (S5)', 'Each person’s ID in the sales file (S5)')}
            hint={t('Los reportes diarios de ventas y activaciones leen quién lleva cada comercio. Con este ID, la lectura de CONTIGO (API v1) dice quién es la persona en S5, no solo su ID en CONTIGO.', 'The daily sales and activation reports read who owns each merchant. With this ID, CONTIGO’s read API (v1) says who the person is in S5, not just their CONTIGO ID.')} />
          {people.length === 0 ? <Empty title={t('Sin personas', 'No people')} /> : (
            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-end justify-between gap-3 py-3" data-testid="user-alias-row">
                  <div className="min-w-0"><p className="font-medium text-strong">{p.full_name}</p>
                    <p className="text-[13px] text-muted">{p.s5 ? t(`S5: ${p.s5} desde el ${day(p.since!, locale)}`, `S5: ${p.s5} since ${day(p.since!, locale)}`) : t('Sin ID en S5', 'No S5 ID')}</p></div>
                  <ActionForm action={userAliasAction} className="flex items-end gap-2">
                    <input type="hidden" name="user" value={p.id} /><input type="hidden" name="system" value="s5" />
                    <Field label={t('ID en S5', 'S5 ID')}><input name="external_id" className="input !h-11 !w-40" required maxLength={80} defaultValue={p.s5 ?? ''} data-testid="user-alias-input" /></Field>
                    <Submit size="sm" variant="ghost" testId="user-alias-save">{t('Guardar', 'Save')}</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function ConfirmAndSave({ t, testId }: { t: (es: string, en: string) => string; testId: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="confirm" className="h-5 w-5 shrink-0" data-testid={`${testId}-confirm`} />{t('Lo fijó quien decide', 'Set by the decision owner')}</label>
      <Submit size="sm" testId={`${testId}-save`}>{t('Guardar', 'Save')}</Submit>
    </div>
  )
}
