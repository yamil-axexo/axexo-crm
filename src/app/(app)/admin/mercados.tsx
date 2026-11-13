import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { getMarketsAdmin } from '@/dal/markets'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ROLE_LABEL } from '@/domain/policy'
import { day, isoDay, num, zoneName } from '@/lib/format'
import { FICHA_FACTS, FICHA_FACT_LABEL, WA_CATEGORY, WA_STATUS } from '@/lib/markets'
import { whatsappMarketMode } from '@/server/adapters/markets'
import {
  addHolidayAction, createEntityAction, createFieldSectionAction, removeHolidayAction, saveWhatsappAccountAction, saveWhatsappRateAction, saveWhatsappTemplateAction,
  setFichaLayoutAction, setFieldSectionAction, setUserEntityAction, setWhatsappTemplateStatusAction, updateEntityAction,
} from './mercados-actions'

const TEAM: Record<string, [string, string]> = { sales: ['Ventas', 'Sales'], ops: ['Operaciones', 'Operations'], support: ['Soporte', 'Support'], finance: ['Finanzas', 'Finance'], all: ['Todos', 'Everyone'] }

/**
 * Administración · Mercados: mercados y su estado, entidades legales, festivos, WhatsApp por mercado (apagado),
 * los datos de arriba de la ficha por rol y las secciones de campos. Cada cambio queda en la bitácora.
 */
export async function MercadosTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const d = await getMarketsAdmin(ctx)
  const today = isoDay(new Date())
  const wa = whatsappMarketMode()
  const check = (ok: boolean, es: string, en: string) => <li className={ok ? 'text-brand-text' : 'text-amber-text'}>{ok ? '✓' : '○'} {t(es, en)}</li>

  return (
    <div className="space-y-8" data-testid="admin-markets">
      <Card data-testid="markets-card">
        <CardTitle title={t('Mercados', 'Markets')} hint={t('Lo que cada mercado necesita para operar. Uno nuevo nace en preparación y conviene abrirlo cuando tiene embudo, entidad legal confirmada y equipo.', 'What each market needs to operate. A new one starts in preparation and is best opened once it has a pipeline, a confirmed legal entity and a team.')} />
        <ul className="divide-y divide-line">
          {d.markets.map((m) => (
            <li key={m.code} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-4" data-testid="market-row" data-market={m.code}>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-strong">{m.name} <span className="font-normal text-muted-2">· {m.code}</span> <span className="ml-1" data-testid="market-status" data-status={m.status}><Badge tone={m.status === 'live' ? 'good' : 'neutral'}>{m.status === 'live' ? t('En operación', 'Live') : t('En preparación', 'In preparation')}</Badge></span></p>
                <p className="mt-0.5 text-[13px] text-muted-2">{m.currency} · {zoneName(m.timezone, locale)} · {m.phone_cc} · {t(`${num(m.accounts, locale)} ${m.accounts === 1 ? 'comercio' : 'comercios'}`, `${num(m.accounts, locale)} ${m.accounts === 1 ? 'merchant' : 'merchants'}`)}</p>
                {m.status === 'planned' && (
                  <ul className="mt-2 space-y-0.5 text-[13px]" data-testid="market-ready">
                    {check(m.ready.pipelines > 0, 'Embudo con etapas', 'Pipeline with stages')}
                    {check(m.ready.entity, 'Entidad legal confirmada', 'Legal entity confirmed')}
                    {check(m.ready.people > 0, 'Al menos una persona con acceso', 'At least one person with access')}
                    {check(m.ready.rate, 'Tasa de cambio a USD (para el consolidado)', 'Exchange rate to USD (for the consolidated view)')}
                    {check(m.ready.territories > 0, 'Territorios (opcional)', 'Territories (optional)')}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13.5px] text-muted">{t('Un mercado se agrega y se abre en ', 'A market is added and opened under ')}<Link href="/datos?tab=catalogos" className="font-medium text-blue-text underline" data-testid="markets-catalog-link">{t('Datos, Mercados y catálogos', 'Data, Markets and catalogs')}</Link>{t('. Aquí se confirma su entidad legal, se cargan sus festivos y se ve lo que le falta.', '. Here you confirm its legal entity, load its holidays and see what it still needs.')}</p>
      </Card>

      <Card data-testid="entities-card">
        <CardTitle title={t('Entidades legales', 'Legal entities')} hint={t('Cada comercio y cada negocio pertenece a una entidad. Un comercio nuevo toma la de por defecto de su mercado.', 'Every merchant and every deal belongs to an entity. A new merchant takes its market’s default one.')} />
        <ul className="divide-y divide-line">
          {d.entities.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3" data-testid="entity-row">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-strong [overflow-wrap:anywhere]"><span data-testid="entity-row-name">{e.name}</span> <span className="font-normal text-muted-2">· {e.market_code}</span>
                  {e.is_default && <span className="ml-2"><Badge tone="accent">{t('por defecto', 'default')}</Badge></span>}
                  {e.needs_review && <span className="ml-2" data-testid="entity-review"><Badge tone="warn">{t('nombre por confirmar', 'name to be confirmed')}</Badge></span>}
                </p>
                <p className="text-[13px] text-muted-2">{t(`${num(e.accounts, locale)} comercios · ${num(e.deals, locale)} negocios · ${num(e.people, locale)} personas`, `${num(e.accounts, locale)} merchants · ${num(e.deals, locale)} deals · ${num(e.people, locale)} people`)}</p>
              </div>
              <Dialog trigger={t('Editar', 'Edit')} title={t('Editar entidad legal', 'Edit legal entity')} size="sm" variant="quiet" testId="entity-edit">
                <ActionForm action={updateEntityAction} onOk="close" className="grid grid-cols-1 gap-4" testId="entity-edit-form">
                  <input type="hidden" name="id" value={e.id} />
                  <Field label={t('Nombre', 'Name')} hint={e.needs_review ? t('CONTIGO puso el nombre del mercado para no dejar comercios sin entidad. Escribe el nombre legal correcto.', 'CONTIGO used the market’s name so no merchant was left without an entity. Enter the correct legal name.') : undefined}><input name="name" className="input" required minLength={2} maxLength={120} defaultValue={e.name} data-testid="entity-edit-name" /></Field>
                  {!e.is_default && <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="make_default" className="h-5 w-5 shrink-0" />{t('Usarla por defecto en este mercado', 'Use it by default in this market')}</label>}
                  <div className="flex justify-end"><Submit testId="entity-edit-save">{t('Guardar', 'Save')}</Submit></div>
                </ActionForm>
              </Dialog>
            </li>
          ))}
        </ul>
        <ActionForm action={createEntityAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-3" testId="entity-form">
          <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="entity-market">{d.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
          <Field label={t('Nombre de la entidad', 'Entity name')} className="sm:col-span-2"><input name="name" className="input" required minLength={2} maxLength={120} data-testid="entity-name-input" /></Field>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] sm:col-span-2"><input type="checkbox" name="make_default" className="h-5 w-5 shrink-0" />{t('Usarla por defecto en ese mercado', 'Use it by default in that market')}</label>
          <div className="flex justify-end"><Submit variant="ghost" testId="entity-save">{t('Agregar entidad', 'Add entity')}</Submit></div>
        </ActionForm>

        <div className="mt-6 border-t border-line pt-5" data-testid="people-entity">
          <p className="text-[14.5px] font-semibold text-strong">{t('Personas por entidad', 'People by entity')}</p>
          <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('Di a qué entidad pertenece cada persona. Si marcas el límite, en ese mercado solo ve los comercios y negocios de su entidad (sirve para una red adquirida).', 'Say which entity each person belongs to. If you tick the limit, in that market they only see their entity’s merchants and deals (useful for an acquired network).')}</p>
          <ActionForm action={setUserEntityAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3" testId="user-entity-form">
            <Field label={t('Persona', 'Person')}><select name="user_id" className="input" data-testid="user-entity-user">{d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.markets.length ? ` · ${p.markets.join(', ')}` : ''}</option>)}</select></Field>
            <Field label={t('Entidad', 'Entity')}><select name="entity_id" className="input" data-testid="user-entity-entity"><option value="">{t('Sin entidad', 'No entity')}</option>{d.entities.map((e) => <option key={e.id} value={e.id}>{e.market_code} · {e.name}</option>)}</select></Field>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-[14px]"><input type="checkbox" name="limit" className="h-5 w-5 shrink-0" data-testid="user-entity-limit" />{t('Limitar su acceso a esa entidad', 'Limit their access to that entity')}</label>
            <div className="flex justify-end sm:col-span-3"><Submit variant="ghost" size="sm" testId="user-entity-save">{t('Guardar', 'Save')}</Submit></div>
          </ActionForm>
          {d.people.some((p) => p.legal_entity_id) && (
            <ul className="mt-3 space-y-1 text-[13.5px]" data-testid="user-entity-list">
              {d.people.filter((p) => p.legal_entity_id).map((p) => <li key={p.id} data-testid="user-entity-row"><span className="font-medium text-strong">{p.full_name}</span> <span className="text-muted-2">· {d.entities.find((e) => e.id === p.legal_entity_id)?.name ?? ''}{p.limited ? ` · ${t('acceso limitado a su entidad', 'access limited to their entity')}` : ''}</span></li>)}
            </ul>
          )}
        </div>
      </Card>

      <Card data-testid="units-card">
        <CardTitle title={t('Unidades de negocio', 'Business units')} hint={t('Van al lado del mercado en cada comercio y negocio. Se eligen en la ficha del comercio.', 'They sit beside the market on every merchant and deal. They are picked on the merchant page.')} />
        <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2" data-testid="units-list">
          {d.units.map((u) => <li key={u.code} className="flex items-baseline justify-between gap-3 text-[14px]" data-testid="unit-row"><span className="font-medium text-strong">{t(u.label_es, u.label_en)}</span><span className="num text-muted-2">{t(`${num(u.accounts, locale)} comercios`, `${num(u.accounts, locale)} merchants`)}</span></li>)}
        </ul>
      </Card>

      <Card data-testid="holidays-card">
        <CardTitle title={t('Días festivos', 'Holidays')} hint={t('Un próximo paso por defecto no cae en festivo. CONTIGO no trae calendarios de ningún lado: los días se cargan aquí.', 'A default next step never lands on a holiday. CONTIGO brings calendars from nowhere: the days are loaded here.')} />
        {d.holidays.length === 0 ? <p className="text-[14px] text-muted" data-testid="holidays-empty">{t('Todavía no hay días festivos cargados. Agrega los del año de cada mercado.', 'No holidays loaded yet. Add each market’s holidays for the year.')}</p> : (
          <ul className="divide-y divide-line" data-testid="holidays-list">
            {d.holidays.map((h) => (
              <li key={`${h.market_code}${h.day}`} className="flex flex-wrap items-center justify-between gap-3 py-2 text-[14px]" data-testid="holiday-row">
                <span><span className="font-medium text-strong">{day(h.day, locale)}</span> <span className="text-muted-2">· {h.market_code} · {h.name}</span></span>
                <ActionForm action={removeHolidayAction}><input type="hidden" name="market" value={h.market_code} /><input type="hidden" name="day" value={h.day} /><Submit variant="quiet" size="sm" testId="holiday-remove">{t('Quitar', 'Remove')}</Submit></ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addHolidayAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-4" testId="holiday-form">
          <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="holiday-market">{d.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
          <Field label={t('Fecha', 'Date')}><input type="date" name="day" className="input" required defaultValue={today} data-testid="holiday-day" /></Field>
          <Field label={t('Qué se celebra', 'What is observed')} className="sm:col-span-2"><input name="name" className="input" required minLength={2} maxLength={80} data-testid="holiday-name" /></Field>
          <div className="flex justify-end sm:col-span-4"><Submit variant="ghost" size="sm" testId="holiday-save">{t('Agregar día festivo', 'Add holiday')}</Submit></div>
        </ActionForm>
      </Card>

      <Card data-testid="whatsapp-card">
        <CardTitle title={t('WhatsApp por mercado', 'WhatsApp per market')} hint={t('Un número por mercado y entidad, sus plantillas por idioma y lo que cuesta cada mensaje. Todo queda listo aquí; el envío desde CONTIGO sigue apagado.', 'One number per market and entity, its templates per language and what each message costs. Everything is set up here; sending from CONTIGO stays off.')}
          right={<span data-testid="whatsapp-mode" data-mode={wa.mode}><Badge tone={wa.mode === 'off' ? 'neutral' : 'warn'}>{wa.mode === 'off' ? t('Canal apagado', 'Channel off') : t('Simulado (pruebas)', 'Simulated (tests)')}</Badge></span>} />
        <p className="mb-4 rounded-[12px] bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2" data-testid="whatsapp-rules">
          {t('Reglas que ya se cuidan aquí: nunca un solo número para todos los países; las plantillas no venden ni cobran (WhatsApp no admite catálogos ni pagos para productos financieros o de prepago); y lo más barato es que el comercio escriba primero: dentro de las 24 horas la respuesta no cuesta.', 'Rules already enforced here: never one number for every country; templates do not sell or charge (WhatsApp does not allow catalogs or payments for financial or prepaid products); and the cheapest path is the merchant writing first: within 24 hours the reply costs nothing.')}
        </p>
        {d.whatsapp.length === 0 ? <p className="text-[14px] text-muted" data-testid="whatsapp-empty">{t('Ningún mercado tiene número configurado todavía.', 'No market has a number set up yet.')}</p> : (
          <ul className="divide-y divide-line" data-testid="whatsapp-accounts">
            {d.whatsapp.map((w) => (
              <li key={w.id} className="py-3" data-testid="whatsapp-account">
                <p className="text-[15px] font-medium text-strong">{w.display_name} <span className="font-normal text-muted-2">· {w.market_code} · {w.entity}</span></p>
                <p className="text-[13px] text-muted-2">{w.phone ?? t('sin número todavía', 'no number yet')}{w.daily_limit ? ` · ${t(`hasta ${num(w.daily_limit, locale)} mensajes al día`, `up to ${num(w.daily_limit, locale)} messages a day`)}` : ''}</p>
                <ul className="mt-2 space-y-2">
                  {d.templates.filter((x) => x.account_id === w.id).map((x) => (
                    <li key={x.id} className="rounded-[10px] bg-surface-2 px-3 py-2" data-testid="whatsapp-template">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13.5px] font-medium text-strong"><code className="text-[12.5px]">{x.key}</code> · {x.locale.toUpperCase()} · {t(WA_CATEGORY[x.category]?.es ?? x.category, WA_CATEGORY[x.category]?.en ?? x.category)}</p>
                        <ActionForm action={setWhatsappTemplateStatusAction} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={x.id} />
                          <select name="status" className="input !w-48 !py-1.5 text-[13px]" defaultValue={x.status} aria-label={t('Estado de la plantilla', 'Template status')} data-testid="template-status">{Object.entries(WA_STATUS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select>
                          <Submit variant="quiet" size="sm" testId="template-status-save">{t('Guardar', 'Save')}</Submit>
                        </ActionForm>
                      </div>
                      <p className="mt-1 text-[13px] whitespace-pre-line text-muted-2 [overflow-wrap:anywhere]">{x.body}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-1 gap-6 border-t border-line pt-5 xl:grid-cols-3">
          <ActionForm action={saveWhatsappAccountAction} onOk="reset" className="space-y-3" testId="whatsapp-account-form">
            <p className="text-[14.5px] font-semibold text-strong">{t('Número de un mercado', 'A market’s number')}</p>
            <Field label={t('Mercado y entidad', 'Market and entity')}>
              <WaEntity markets={d.markets.map((m) => m.code)} entities={d.entities} />
            </Field>
            <Field label={t('Nombre que ve el comercio', 'Name the merchant sees')}><input name="display_name" className="input" required minLength={2} maxLength={80} data-testid="wa-display-name" /></Field>
            <Field label={t('Número (opcional)', 'Number (optional)')}><input name="phone" className="input" inputMode="tel" data-testid="wa-phone" /></Field>
            <Field label={t('Tope de mensajes al día (opcional)', 'Daily message cap (optional)')}><input name="daily_limit" type="number" min={1} className="input" inputMode="numeric" /></Field>
            <Submit variant="ghost" size="sm" testId="wa-account-save">{t('Guardar número', 'Save number')}</Submit>
          </ActionForm>
          <ActionForm action={saveWhatsappTemplateAction} onOk="reset" className="space-y-3" testId="whatsapp-template-form">
            <p className="text-[14.5px] font-semibold text-strong">{t('Plantilla', 'Template')}</p>
            {d.whatsapp.length === 0 ? <p className="text-[13.5px] text-muted-2">{t('Primero guarda el número de un mercado.', 'Save a market’s number first.')}</p> : (
              <>
                <Field label={t('Número', 'Number')}><select name="account_id" className="input" data-testid="wa-template-account">{d.whatsapp.map((w) => <option key={w.id} value={w.id}>{w.market_code} · {w.display_name}</option>)}</select></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('Nombre interno', 'Internal name')}><input name="key" className="input" required pattern="[a-z][a-z0-9_]{2,60}" placeholder="alta_confirmada" data-testid="wa-template-key" /></Field>
                  <Field label={t('Idioma', 'Language')}><select name="locale" className="input" defaultValue={locale}><option value="es">{t('Español', 'Spanish')}</option><option value="en">{t('Inglés', 'English')}</option><option value="pt">{t('Portugués', 'Portuguese')}</option></select></Field>
                </div>
                <Field label={t('Categoría', 'Category')}><select name="category" className="input" defaultValue="utility" data-testid="wa-template-category">{(['utility', 'marketing', 'authentication'] as const).map((k) => <option key={k} value={k}>{t(WA_CATEGORY[k]!.es, WA_CATEGORY[k]!.en)}</option>)}</select></Field>
                <Field label={t('Texto', 'Text')}><textarea name="body" className="input min-h-28" required minLength={5} maxLength={1024} data-testid="wa-template-body" /></Field>
                <Submit variant="ghost" size="sm" testId="wa-template-save">{t('Guardar plantilla', 'Save template')}</Submit>
              </>
            )}
          </ActionForm>
          <ActionForm action={saveWhatsappRateAction} onOk="reset" className="space-y-3" testId="whatsapp-rate-form">
            <p className="text-[14.5px] font-semibold text-strong">{t('Costo por mensaje', 'Cost per message')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Mercado', 'Market')}><select name="market" className="input">{d.markets.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}</select></Field>
              <Field label={t('Categoría', 'Category')}><select name="category" className="input">{Object.entries(WA_CATEGORY).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></Field>
              <Field label={t('Costo', 'Cost')}><input name="cost" className="input" inputMode="decimal" required pattern="[0-9]*[.]?[0-9]+" data-testid="wa-rate-cost" /></Field>
              <Field label={t('Moneda', 'Currency')}><input name="currency" className="input" required minLength={3} maxLength={3} defaultValue="USD" /></Field>
            </div>
            <Field label={t('Vale desde', 'Applies from')}><input type="date" name="effective_from" className="input" required defaultValue={today} /></Field>
            <Field label={t('De dónde sale', 'Where it comes from')}><input name="source" className="input" required minLength={3} maxLength={120} data-testid="wa-rate-source" /></Field>
            <Submit variant="ghost" size="sm" testId="wa-rate-save">{t('Guardar costo', 'Save cost')}</Submit>
            {d.rates.length > 0 && <ul className="space-y-1 text-[13px] text-muted-2" data-testid="wa-rates">{d.rates.map((r) => <li key={`${r.market_code}${r.category}`} data-testid="wa-rate-row">{r.market_code} · {t(WA_CATEGORY[r.category]?.es ?? r.category, WA_CATEGORY[r.category]?.en ?? r.category)}: <span className="num font-medium text-strong">{Number(r.cost)} {r.currency}</span> · {t(`desde el ${day(r.effective_from, locale)}`, `from ${day(r.effective_from, locale)}`)} · {r.source}</li>)}</ul>}
          </ActionForm>
        </div>
      </Card>

      <Card data-testid="layouts-card">
        <CardTitle title={t('Ficha del comercio: lo de arriba, por rol', 'Merchant page: the top, by role')} hint={t('Hasta cinco datos por rol, en el orden en que se leen. Estado, quién lo lleva y "Lo siguiente" salen siempre.', 'Up to five facts per role, in reading order. Status, owner and "Next" always show.')} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {d.layouts.map((l) => (
            <ActionForm key={l.role} action={setFichaLayoutAction} className="card-2 p-4" testId="layout-form">
              <input type="hidden" name="role" value={l.role} />
              <p className="mb-3 text-[14.5px] font-semibold text-strong" data-testid="layout-role">{t(ROLE_LABEL[l.role].es, ROLE_LABEL[l.role].en)}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <select key={i} name="fact" className="input" defaultValue={l.facts[i] ?? ''} aria-label={t(`Dato ${i + 1}`, `Fact ${i + 1}`)} data-testid={`layout-fact-${i}`}>
                    <option value="">{t('Ninguno', 'None')}</option>
                    {FICHA_FACTS.map((f) => <option key={f} value={f}>{t(FICHA_FACT_LABEL[f].es, FICHA_FACT_LABEL[f].en)}</option>)}
                  </select>
                ))}
              </div>
              <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="layout-save">{t('Guardar', 'Save')}</Submit></div>
            </ActionForm>
          ))}
        </div>
      </Card>

      <Card data-testid="sections-card">
        <CardTitle title={t('Secciones de campos', 'Field sections')} hint={t('Los campos adicionales se agrupan en secciones por equipo. Las de todos los mercados son las mismas; un mercado puede agregar las suyas.', 'Additional fields are grouped in sections by team. The ones for every market are the same; a market may add its own.')} />
        <ul className="divide-y divide-line" data-testid="sections-list">
          {d.sections.map((s) => <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-[14px]" data-testid="section-row"><span><span className="font-medium text-strong">{t(s.label_es, s.label_en)}</span> <span className="text-muted-2">· {s.market_code ?? t('todos los mercados', 'every market')} · {t(TEAM[s.team ?? 'all']![0], TEAM[s.team ?? 'all']![1])}</span></span><span className="num text-muted-2">{t(`${num(s.fields, locale)} campos`, `${num(s.fields, locale)} fields`)}</span></li>)}
        </ul>
        <div className="mt-4 grid grid-cols-1 gap-6 border-t border-line pt-5 xl:grid-cols-2">
          <ActionForm action={createFieldSectionAction} onOk="reset" className="grid grid-cols-2 gap-3" testId="section-form">
            <p className="col-span-2 text-[14.5px] font-semibold text-strong">{t('Sección nueva', 'New section')}</p>
            <Field label={t('Nombre en español', 'Name in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={60} data-testid="section-es" /></Field>
            <Field label={t('Nombre en inglés', 'Name in English')}><input name="label_en" className="input" required minLength={2} maxLength={60} data-testid="section-en" /></Field>
            <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="section-market"><option value="">{t('Todos', 'All')}</option>{d.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
            <Field label={t('Equipo que la usa', 'Team that uses it')}><select name="team" className="input" defaultValue="sales">{Object.entries(TEAM).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
            <div className="col-span-2 flex justify-end"><Submit variant="ghost" size="sm" testId="section-save">{t('Agregar sección', 'Add section')}</Submit></div>
          </ActionForm>
          <ActionForm action={setFieldSectionAction} className="grid grid-cols-1 gap-3" testId="field-section-form">
            <p className="text-[14.5px] font-semibold text-strong">{t('Mover un campo a una sección', 'Move a field into a section')}</p>
            {d.fields.length === 0 ? <p className="text-[13.5px] text-muted-2">{t('Todavía no hay campos adicionales. Créalos en "Embudos y campos".', 'There are no additional fields yet. Create them under "Pipelines and fields".')}</p> : (
              <>
                <Field label={t('Campo', 'Field')}><select name="field_id" className="input" data-testid="field-section-field">{d.fields.map((f) => <option key={f.id} value={f.id}>{f.object === 'deal' ? t('Negocio', 'Deal') : t('Comercio', 'Merchant')} · {t(f.label_es, f.label_en)}{f.market_code ? ` · ${f.market_code}` : ''}</option>)}</select></Field>
                <Field label={t('Sección', 'Section')}><select name="section" className="input" data-testid="field-section-section"><option value="">{t('Sin sección', 'No section')}</option>{d.sections.map((s) => <option key={s.id} value={s.code}>{t(s.label_es, s.label_en)}{s.market_code ? ` · ${s.market_code}` : ''}</option>)}</select></Field>
                <div className="flex justify-end"><Submit variant="ghost" size="sm" testId="field-section-save">{t('Mover campo', 'Move field')}</Submit></div>
              </>
            )}
          </ActionForm>
        </div>
      </Card>
    </div>
  )
}

/** Mercado y entidad en un solo control: el valor lleva los dos para que no se elija una entidad de otro mercado. */
function WaEntity({ markets, entities }: { markets: string[]; entities: { id: string; market_code: string; name: string }[] }) {
  return (
    <>
      <select name="entity_id" className="input" required data-testid="wa-entity">
        {markets.flatMap((m) => entities.filter((e) => e.market_code === m).map((e) => <option key={e.id} value={e.id}>{m} · {e.name}</option>))}
      </select>
    </>
  )
}
