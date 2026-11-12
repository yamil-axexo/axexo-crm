import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { getTerritoryAdmin } from '@/dal/reparto'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { Badge, Card, CardTitle, Empty, buttonClass } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { archiveTerritoryAction, createTerritoryAction, renameTerritoryAction, setUserTerritoriesAction } from './territorios-actions'

/**
 * Territorios por mercado: el catálogo y a quién le toca cada uno. La lista real la decide el negocio; aquí no viene cargada.
 * Poner un territorio a los comercios se hace en bloque desde la lista de Comercios (Repartir).
 */
export async function TerritoriosTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const d = await getTerritoryAdmin(ctx)
  const live = ctx.markets.filter((m) => m.status === 'live')
  return (
    <div className="space-y-8" data-testid="admin-territories">
      {live.map((mk) => {
        const all = d.territories.filter((x) => x.market_code === mk.code)
        const current = all.filter((x) => !x.archived_at)
        const people = d.people.filter((p) => p.market_code === mk.code)
        const loose = d.unassigned.find((u) => u.market_code === mk.code)?.accounts ?? 0
        return (
          <Card key={mk.code} data-testid={`territories-${mk.code}`}>
            <CardTitle
              title={t(`Territorios de ${mk.name}`, `Territories in ${mk.name}`)}
              hint={t('Sirven para repartir por plaza. Quien vende ve los comercios sin dueño de sus territorios, y un comercio nuevo nace con el territorio de su dueño cuando tiene uno solo.', 'They are used to distribute by area. A seller sees the unowned merchants in their territories, and a new merchant starts with its owner’s territory when the owner has a single one.')}
              right={<Badge>{t(`${current.length} vigentes`, `${current.length} current`)}</Badge>}
            />
            <ActionForm action={createTerritoryAction} onOk="reset" className="mb-6" testId="territory-create">
              <input type="hidden" name="market" value={mk.code} />
              <label className="block text-[13px] font-semibold text-muted-2" htmlFor={`territory-new-${mk.code}`}>{t('Nuevo territorio', 'New territory')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <input id={`territory-new-${mk.code}`} name="name" className="input min-w-0 flex-1 basis-56" required minLength={2} maxLength={60} placeholder={t('Nombre, como lo dice el equipo', 'Name, the way the team says it')} data-testid="territory-name" />
                <Submit variant="ghost" testId="territory-add">{t('Agregar', 'Add')}</Submit>
              </div>
            </ActionForm>

            {all.length === 0 ? (
              <Empty title={t(`Todavía no hay territorios en ${mk.name}`, `No territories in ${mk.name} yet`)} hint={t('Agrega el primero arriba. Después se ponen a los comercios desde Comercios, con Repartir.', 'Add the first one above. Then set them on merchants from Merchants, with Distribute.')} />
            ) : (
              <ul data-testid="territory-list">
                {all.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0" data-testid="territory-row">
                    <ActionForm action={renameTerritoryAction} className="min-w-0 flex-1 basis-[280px]">
                      <input type="hidden" name="id" value={x.id} />
                      <label className="block text-[13px] text-muted" htmlFor={`territory-${x.id}`}>
                        {t(`${num(x.accounts, locale)} ${x.accounts === 1 ? 'comercio' : 'comercios'} · ${num(x.people, locale)} ${x.people === 1 ? 'persona' : 'personas'}`, `${num(x.accounts, locale)} ${x.accounts === 1 ? 'merchant' : 'merchants'} · ${num(x.people, locale)} ${x.people === 1 ? 'person' : 'people'}`)}
                        {x.archived_at ? ` · ${t('archivado', 'archived')}` : ''}
                      </label>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <input id={`territory-${x.id}`} name="name" defaultValue={x.name} className="input min-w-0 flex-1 basis-48" required minLength={2} maxLength={60} disabled={!!x.archived_at} data-testid="territory-rename" />
                        {!x.archived_at && <Submit variant="ghost" testId="territory-rename-save">{t('Guardar nombre', 'Save name')}</Submit>}
                      </div>
                    </ActionForm>
                    <div className="flex flex-wrap items-center gap-2">
                      {!x.archived_at && x.accounts > 0 && <Link href={qs('/comercios', { market: mk.code, territory: x.id })} className={buttonClass('quiet')} data-testid="territory-accounts">{t('Ver comercios', 'See merchants')}</Link>}
                      <ActionForm action={archiveTerritoryAction}>
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="archived" value={x.archived_at ? '0' : '1'} />
                        <Submit variant="quiet" testId="territory-archive">{x.archived_at ? t('Recuperar', 'Restore') : t('Archivar', 'Archive')}</Submit>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {loose > 0 && (
              <p className="mt-5 border-t border-line pt-4 text-[14px] text-muted-2" data-testid="territory-loose">
                {t(`${num(loose, locale)} ${loose === 1 ? 'comercio' : 'comercios'} sin territorio en ${mk.name}. `, `${num(loose, locale)} ${loose === 1 ? 'merchant' : 'merchants'} with no territory in ${mk.name}. `)}
                <Link href={qs('/comercios', { market: mk.code, territory: 'none', repartir: '1' })} className="font-medium text-blue-text underline">{t('Verlos y ponerles territorio', 'See them and set a territory')}</Link>
              </p>
            )}

            {current.length > 0 && (
              <div className="mt-7 border-t border-line pt-6" data-testid="territory-people">
                <h3 className="text-[16px] font-semibold">{t('A quién le toca cada territorio', 'Who covers each territory')}</h3>
                <p className="mt-1 text-[13px] text-muted">{t('Solo aparece quien vende hoy en este mercado.', 'Only people who sell in this market today are listed.')}</p>
                {people.length === 0 ? <p className="mt-4 text-[14px] text-muted">{t('Todavía nadie tiene rol de ventas en este mercado.', 'Nobody has a sales role in this market yet.')}</p> : (
                  <ul className="mt-2">
                    {people.map((p) => (
                      <li key={p.id} className="border-t border-line py-4 first:border-t-0" data-testid="territory-person">
                        <ActionForm action={setUserTerritoriesAction}>
                          <input type="hidden" name="user_id" value={p.id} /><input type="hidden" name="market" value={mk.code} />
                          <fieldset>
                            <legend className="text-[15px] font-semibold text-strong">{p.full_name} <span className="font-normal text-muted">· {t(ROLE_LABEL[p.role as Role].es, ROLE_LABEL[p.role as Role].en)}{p.team ? ` · ${p.team}` : ''}</span></legend>
                            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                              {current.map((x) => (
                                <label key={x.id} className="flex min-h-11 items-center gap-2 text-[14px] text-strong">
                                  <input type="checkbox" name="territory_id" value={x.id} defaultChecked={p.territory_ids.includes(x.id)} className="h-4 w-4" data-testid="territory-check" />
                                  {x.name}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <div className="mt-2"><Submit variant="ghost" testId="territory-person-save">{t('Guardar', 'Save')}</Submit></div>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
