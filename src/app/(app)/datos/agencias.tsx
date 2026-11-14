import type { Ctx } from '@/server/context'
import { agenciesAdmin } from '@/dal/store-record'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { Dialog, Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { num } from '@/lib/format'
import { createAgencyAction, setProviderRefLabelAction, toggleAgencyAction } from '@/app/(app)/comercios/tienda-actions'

/**
 * E9.F12: agencias y otros socios que reclutan tiendas, por mercado. Es la lista que ofrece "Reclutado por" en el alta y en la
 * ficha de la tienda. Y E9.F8: cómo se llama el identificador que cada operador (carrier) le da a una tienda.
 */
export async function AgenciasCard({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  // La única pantalla que agrega y da de baja agencias (Seguridad solo da acceso a su gente): todos los mercados que la persona administra.
  const markets = ctx.markets.filter((m) => ctx.can('agency.manage', m.code))
  if (markets.length === 0) return null
  const d = await agenciesAdmin(ctx)
  const row = 'flex flex-wrap items-center justify-between gap-3 border-t border-line py-4 first:border-t-0'
  return (
    <div className="grid items-start gap-8 lg:grid-cols-2">
      <Card data-testid="agencies-card">
        <CardTitle title={t('Agencias y socios que reclutan', 'Agencies and partners that recruit')} hint={t('Lo que se puede elegir en "Reclutado por" al crear una tienda. El equipo de campo de axexo siempre está en la lista.', 'What can be picked under "Recruited by" when a store is created. The axexo field team is always on the list.')}
          right={
            <Dialog trigger={t('Agregar', 'Add')} title={t('Agregar una agencia o socio', 'Add an agency or partner')} variant="primary" size="sm" testId="agency-new">
              <NoticeForm action={createAgencyAction} className="space-y-4 text-left" testId="agency-form">
                <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="agency-market">{markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                <Field label={t('Qué es', 'What it is')}><select name="kind" className="input" data-testid="agency-kind"><option value="agency">{t('Agencia', 'Agency')}</option><option value="partner">{t('Otro socio', 'Other partner')}</option></select></Field>
                <Field label={t('Nombre', 'Name')}><input name="name" className="input" required minLength={2} maxLength={80} data-testid="agency-name" /></Field>
                <Field label={t('Su embudo (opcional)', 'Its pipeline (optional)')} hint={t('Si lo eliges, los negocios de su gente solo nacen ahí.', 'If you choose one, its people’s deals are only created there.')}><select name="pipeline_id" className="input" defaultValue="" data-testid="agency-pipeline"><option value="">{t('Cualquiera del mercado', 'Any in the market')}</option>{d.pipelines.map((p) => <option key={p.id} value={p.id}>{p.market_code} · {p.name}</option>)}</select></Field>
                <Field label={t('Su región (opcional)', 'Its region (optional)')} hint={t('Si la eliges, los comercios de su gente nacen con ese territorio.', 'If you choose one, its people’s merchants start with that territory.')}><select name="territory_id" className="input" defaultValue="" data-testid="agency-territory"><option value="">{t('Sin región fija', 'No fixed region')}</option>{d.territories.map((p) => <option key={p.id} value={p.id}>{p.market_code} · {p.name}</option>)}</select></Field>
                <div className="flex justify-end"><Submit testId="agency-save">{t('Agregar', 'Add')}</Submit></div>
              </NoticeForm>
            </Dialog>
          } />
        {d.agencies.length === 0 ? <p className="mt-3 text-[15px] text-muted" data-testid="agencies-empty">{t('Todavía no hay agencias ni socios. Agrega la primera para poder elegirla al crear una tienda.', 'There are no agencies or partners yet. Add the first one so it can be picked when a store is created.')}</p> : (
          <ul className="mt-2">
            {d.agencies.map((g) => (
              <li key={g.id} className={row} data-testid="agency-row">
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-strong [overflow-wrap:anywhere]">{g.name}</span>
                  <span className="text-[13px] text-muted-2">{[g.kind === 'agency' ? t('Agencia', 'Agency') : t('Otro socio', 'Other partner'), markets.length > 1 ? g.market_name : null,
                    t(`${num(g.stores, locale)} ${g.stores === 1 ? 'tienda reclutada' : 'tiendas reclutadas'}`, `${num(g.stores, locale)} ${g.stores === 1 ? 'store recruited' : 'stores recruited'}`)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex items-center gap-2">
                  {!g.is_active && <Badge tone="neutral">{t('De baja', 'Retired')}</Badge>}
                  <NoticeForm action={toggleAgencyAction}>
                    <input type="hidden" name="id" value={g.id} /><input type="hidden" name="active" value={g.is_active ? '0' : '1'} />
                    <Submit variant="quiet" size="sm" testId="agency-toggle">{g.is_active ? t('Dar de baja', 'Retire') : t('Reactivar', 'Restore')}</Submit>
                  </NoticeForm>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {d.providers.length > 0 && (
        <Card data-testid="carrier-labels-card">
          <CardTitle title={t('Identificador que da cada operador', 'ID each carrier issues')} hint={t('El nombre con el que el equipo conoce ese identificador. Aparece en el portafolio de operadores de la tienda.', 'The name the team knows that ID by. It shows on the store’s carrier portfolio.')} />
          <ul className="mt-2">
            {d.providers.map((p) => (
              <li key={p.id} className={row} data-testid="carrier-label-row">
                <span className="min-w-0 text-[15px] font-medium text-strong">{t(p.label_es, p.label_en)}{p.market_name && markets.length > 1 ? <span className="text-[13px] font-normal text-muted-2"> · {p.market_name}</span> : null}</span>
                <NoticeForm action={setProviderRefLabelAction} className="flex items-center gap-2">
                  <input type="hidden" name="provider_id" value={p.id} />
                  <input name="ref_label" className="input !w-48" maxLength={40} defaultValue={p.ref_label ?? ''} placeholder={t('Identificador', 'Carrier ID')} aria-label={t(`Nombre del identificador de ${p.label_es}`, `Name of the ${p.label_en} ID`)} data-testid="carrier-label-input" />
                  <Submit variant="quiet" size="sm" testId="carrier-label-save">{t('Guardar', 'Save')}</Submit>
                </NoticeForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
