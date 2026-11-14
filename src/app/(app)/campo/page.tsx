import { notFound } from 'next/navigation'
import { requireCtx, type Ctx } from '@/server/context'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Table, shown } from '@/ui/kit'
import { ActionForm, RevealOnce, Submit } from '@/ui/client'
import { day, dayTime, isoDay, money, num } from '@/lib/format'
import * as dal from '@/dal/campo-canal'
import { THRESHOLDS } from '@/domain/campo-canal/thresholds'
import { documentVault } from '@/server/adapters/document-vault'
import { fundingFeed } from '@/server/adapters/funding-feed'
import { logIncidentView } from '@/domain/campo-canal/campo'
import * as A from './actions'

export const dynamic = 'force-dynamic'

type T = Ctx['t']
type Tab = 'prioridad' | 'expedientes' | 'cartera' | 'atribucion' | 'disputas' | 'registros' | 'credito' | 'competencia' | 'pdv' | 'incidentes' | 'umbrales'

const th = 'px-3 py-2 text-left text-[12.5px] font-semibold text-muted-2'
const td = 'border-t border-line px-3 py-3 align-top text-[14px] text-strong'
const sel = 'input'

/**
 * Campo y canales (paquete campo-canal): una pantalla con una pestaña por tarea. Cada pestaña aparece solo si el rol
 * la puede usar; lo restringido (registros de canal, incidentes) además lo filtra la base.
 */
export default async function CampoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  const { t } = ctx
  const sp = flat(await searchParams)
  const tabs: { key: Tab; label: string; ok: boolean }[] = [
    { key: 'prioridad', label: t('Prioridad de hoy', 'Today’s priority'), ok: ctx.can('priority.read') || ctx.isGlobal },
    { key: 'expedientes', label: t('Expedientes', 'Enrollment files'), ok: ctx.can('onboarding.capture') || ctx.can('onboarding.review') },
    { key: 'cartera', label: t('Cartera', 'Portfolio'), ok: ctx.can('portfolio.plan') },
    { key: 'atribucion', label: t('Atribución', 'Attribution'), ok: ctx.can('attribution.correct') || ctx.can('dispute.raise') || ctx.isGlobal },
    { key: 'disputas', label: t('Disputas', 'Disputes'), ok: ctx.can('dispute.raise') || ctx.can('dispute.arbitrate') },
    { key: 'registros', label: t('Registros de canal', 'Channel registrations'), ok: ctx.can('claim.manage') },
    { key: 'credito', label: t('Fondeo y crédito', 'Funding and credit'), ok: ctx.can('credit.request') || ctx.can('credit.approve') || ctx.isGlobal },
    { key: 'competencia', label: t('Competencia', 'Competition'), ok: ctx.can('competitor.record') || ctx.isGlobal },
    { key: 'pdv', label: t('Punto de venta perfecto', 'Perfect store'), ok: ctx.can('priority.read') || ctx.can('board.supervisor') || ctx.isGlobal },
    { key: 'incidentes', label: t('Incidentes', 'Incidents'), ok: ctx.can('incident.report') || ctx.can('incident.manage') },
    { key: 'umbrales', label: t('Umbrales y metas', 'Thresholds and targets'), ok: ctx.can('threshold.manage') || ctx.can('plan.set') },
  ]
  const allowed = tabs.filter((x) => x.ok)
  if (allowed.length === 0) notFound()
  const tab = (allowed.find((x) => x.key === sp.tab)?.key ?? allowed[0]!.key) as Tab
  const market = ctx.markets.find((m) => m.code === sp.mercado) ?? ctx.markets.find((m) => m.status === 'live') ?? ctx.markets[0]!
  const account = await dal.accountName(ctx, sp.cuenta)
  const acc = account && account.market_code === market.code ? account : null
  const tz = await readerTimeZone(ctx)
  const href = (k: string) => `/campo?tab=${k}&mercado=${market.code}${acc ? `&cuenta=${acc.id}` : ''}`
  const needsAccount: Tab[] = ['atribucion', 'credito', 'competencia', 'cartera']

  return (
    <div className="mx-auto max-w-[1180px]" data-testid="campo">
      <PageHeader
        title={t('Campo y canales', 'Field and channels')}
        desc={t('Expedientes de alta, cartera, atribución, registros de canal, crédito, competencia e incidentes, en un solo lugar.', 'Enrollment files, portfolio, attribution, channel registrations, credit, competition and incidents, in one place.')}
      />
      <div className="mb-5 flex flex-col gap-4">
        <Pills items={allowed.map((x) => ({ key: x.key, href: href(x.key), label: x.label }))} current={tab} label={t('Secciones', 'Sections')} />
        <form method="get" action="/campo" className="flex flex-wrap items-end gap-3" data-testid="campo-picker">
          <input type="hidden" name="tab" value={tab} />
          {ctx.markets.length > 1 && (
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted-2">{t('Mercado', 'Market')}
              <select name="mercado" defaultValue={market.code} className={sel} data-testid="campo-market">{ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
            </label>
          )}
          {ctx.markets.length === 1 && <input type="hidden" name="mercado" value={market.code} />}
          {needsAccount.includes(tab) && (
            <label className="flex min-w-[240px] flex-col gap-1 text-[13px] font-semibold text-muted-2">{t('Comercio', 'Merchant')}
              <select name="cuenta" defaultValue={acc?.id ?? ''} className={sel} data-testid="campo-account">
                <option value="">{t('Elige un comercio', 'Choose a merchant')}</option>
                {(await dal.marketAccounts(ctx, market.code)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <button className="press inline-flex h-11 items-center rounded-full border border-line px-5 text-[14px] font-semibold text-strong hover:bg-green-50" data-testid="campo-go">{t('Ver', 'Show')}</button>
        </form>
      </div>

      {tab === 'prioridad' && <Priority ctx={ctx} market={market.code} />}
      {tab === 'expedientes' && <Files ctx={ctx} market={market.code} tz={tz} accountId={sp.cuenta} fileId={sp.expediente} />}
      {tab === 'cartera' && <Portfolio ctx={ctx} market={market.code} acc={acc} tz={tz} />}
      {tab === 'atribucion' && <Attribution ctx={ctx} market={market.code} acc={acc} tz={tz} month={sp.ciclo ?? ''} />}
      {tab === 'disputas' && <Disputes ctx={ctx} market={market.code} tz={tz} />}
      {tab === 'registros' && <Claims ctx={ctx} market={market.code} tz={tz} />}
      {tab === 'credito' && <Credit ctx={ctx} market={market.code} currency={market.currency} acc={acc} tz={tz} />}
      {tab === 'competencia' && <Competition ctx={ctx} market={market.code} currency={market.currency} acc={acc} />}
      {tab === 'pdv' && <PerfectStore ctx={ctx} market={market.code} tz={tz} />}
      {tab === 'incidentes' && <Incidents ctx={ctx} market={market.code} tz={tz} open={sp.incidente} />}
      {tab === 'umbrales' && <Thresholds ctx={ctx} market={market.code} tz={tz} />}
      {needsAccount.includes(tab) && !acc && tab !== 'cartera' && (
        <Empty title={t('Elige un comercio arriba', 'Choose a merchant above')} hint={t('Esta sección trabaja sobre un comercio a la vez.', 'This section works on one merchant at a time.')} />
      )}
    </div>
  )
}

const REASON: Record<string, [string, string]> = {
  revisit_overdue: ['Visita atrasada', 'Visit overdue'], never_visited: ['Nunca visitada', 'Never visited'], no_sale: ['Sin venta', 'No sales'],
  at_risk: ['En riesgo', 'At risk'], low_balance: ['Saldo bajo', 'Low balance'],
}
const reasonText = (t: T, r: { code: string; days?: number }) => `${t(...(REASON[r.code] ?? [r.code, r.code]))}${r.days ? t(` (${r.days} días)`, ` (${r.days} days)`) : ''}`

async function Priority({ ctx, market }: { ctx: Ctx; market: string }) {
  const { t, locale } = ctx
  const mine = !ctx.can('board.supervisor', market)
  const p = await dal.priorityToday(ctx, market, mine)
  return (
    <Card data-testid="priority">
      <CardTitle title={mine ? t('Tus tiendas para hoy', 'Your stores for today') : t('Tiendas para hoy en el mercado', 'Stores for today in the market')}
        hint={t('Reglas a la vista, no un modelo: segmento por ventas de 30 días, frecuencia de visita por segmento y la razón de cada tienda. La Sales App lo lee por la API para armar la ruta.', 'Visible rules, not a model: segment by 30-day sales, visit frequency per segment and each store’s reason. The Sales App reads it through the API to build the route.')} />
      {p.rows.length === 0 ? (
        <Empty title={t('Todavía no hay prioridad calculada', 'No priority computed yet')} hint={t('Se calcula una vez al día con la tarea programada. Si no hay tiendas activas con quien las lleve, no aparece nada.', 'It is computed once a day by the scheduled job. If there are no active stores with an owner, nothing shows.')} />
      ) : (
        <>
        {/* En el teléfono el porqué va a la vista, debajo del nombre: es lo que dice a qué se va a cada tienda. */}
        <ul className="divide-y divide-line md:hidden" data-testid="priority-list">
          {p.rows.map((r) => (
            <li key={r.account_id} className="py-3" data-testid="priority-item">
              <a className="flex min-h-11 items-center justify-between gap-3 font-semibold text-strong underline-offset-2 hover:underline" href={`/comercios/${r.account_id}`}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{r.account}</span>
                <span className="num shrink-0 text-[13px] font-medium text-muted-2">{r.segment.toUpperCase()} · {num(r.score, locale)}</span>
              </a>
              <p className="text-[14px] text-muted-2" data-testid="priority-why">{r.reasons.map((x) => reasonText(t, x)).join(', ')}</p>
              {!mine && <p className="text-[13px] text-muted">{shown(r.owner ?? null) ?? t('Sin asignar', 'No owner')}</p>}
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
        <Table label={t('Prioridad', 'Priority')} testId="priority-table" head={<><th className={th}>{t('Tienda', 'Store')}</th><th className={th}>{t('Segmento', 'Segment')}</th><th className={th}>{t('Puntaje', 'Score')}</th><th className={th}>{t('Por qué', 'Why')}</th>{!mine && <th className={th}>{t('Quién la lleva', 'Owner')}</th>}</>}>
          {p.rows.map((r) => (
            <tr key={r.account_id} data-testid="priority-row">
              <td className={td}><a className="font-semibold underline-offset-2 hover:underline" href={`/comercios/${r.account_id}`}>{r.account}</a></td>
              <td className={td}>{r.segment.toUpperCase()}</td>
              <td className={`${td} num`}>{num(r.score, locale)}</td>
              <td className={td}>{r.reasons.map((x) => reasonText(t, x)).join(', ')}</td>
              {!mine && <td className={td}>{shown(r.owner ?? null) ?? t('Sin asignar', 'No owner')}</td>}
            </tr>
          ))}
        </Table>
        </div>
        </>
      )}
      <p className="mt-4 text-[13px] text-muted" data-testid="priority-holdout">
        {p.day ? t(`Cálculo del ${day(p.day, locale)}. ${p.holdout} tiendas están en el grupo de control de su territorio y no se listan, para medir si la prioridad ayuda.`, `Computed on ${day(p.day, locale)}. ${p.holdout} stores are in their territory’s control group and are not listed, to measure whether the priority helps.`) : ''}
      </p>
    </Card>
  )
}

const FILE_STATUS: Record<string, [string, string, 'good' | 'warn' | 'neutral' | 'bad']> = {
  draft: ['En captura', 'Being captured', 'neutral'], submitted: ['En la mesa', 'At the desk', 'warn'], in_review: ['En revisión', 'In review', 'warn'],
  returned: ['Devuelto', 'Returned', 'bad'], approved: ['Aprobado', 'Approved', 'good'], auto_approved: ['Aprobado por regla', 'Approved by rule', 'good'],
}
const DOC_STATUS: Record<string, [string, string, 'good' | 'warn' | 'neutral' | 'bad']> = {
  missing: ['Falta', 'Missing', 'neutral'], received: ['Recibido', 'Received', 'warn'], valid: ['Válido', 'Valid', 'good'], rejected: ['Rechazado', 'Rejected', 'bad'],
}

async function Files({ ctx, market, tz, accountId, fileId }: { ctx: Ctx; market: string; tz: string; accountId?: string; fileId?: string }) {
  const { t, locale } = ctx
  const review = ctx.can('onboarding.review', market)
  const capture = ctx.can('onboarding.capture', market)
  const [desk, open, decided, times, accounts, ops] = await Promise.all([
    dal.onboardingFiles(ctx, market, 'desk'), dal.onboardingFiles(ctx, market, 'open'), dal.onboardingFiles(ctx, market, 'decided'),
    dal.onboardingTimes(ctx, market), capture ? dal.marketAccounts(ctx, market) : Promise.resolve([]), review ? dal.marketPeople(ctx, market, ['ops']) : Promise.resolve([]),
  ])
  const current = [...desk, ...open, ...decided].find((f) => f.id === fileId) ?? null
  const docs = current ? await dal.fileDocuments(ctx, current.id) : []
  const extras = current ? await dal.fileExtras(ctx, current.id, current.account_id) : null
  const vault = documentVault()
  const row = (f: dal.FileRow) => (
    <tr key={f.id} data-testid="file-row" data-status={f.status}>
      <td className={td}><a className="font-semibold underline-offset-2 hover:underline" href={`/campo?tab=expedientes&mercado=${market}&expediente=${f.id}`}>{f.account}</a></td>
      <td className={td}><Badge tone={FILE_STATUS[f.status]?.[2] ?? 'neutral'}>{t(FILE_STATUS[f.status]![0], FILE_STATUS[f.status]![1])}</Badge></td>
      <td className={td}>{f.funding === 'prepaid' ? t('Prepago', 'Prepaid') : t('Crédito ACH', 'ACH credit')}</td>
      <td className={`${td} num`}>{f.docs_valid}/{f.docs_total}{f.docs_missing ? t(` (faltan ${f.docs_missing})`, ` (${f.docs_missing} missing)`) : ''}</td>
      <td className={td}>{f.due_at ? <span className={f.overdue ? 'font-semibold text-red' : ''}>{dayTime(f.due_at, locale, tz)}{f.overdue ? t(' (vencido)', ' (overdue)') : ''}</span> : shown(day(null, locale))}</td>
      <td className={td}>{f.assigned ?? shown(day(null, locale))}</td>
    </tr>
  )
  const head = <><th className={th}>{t('Comercio', 'Merchant')}</th><th className={th}>{t('Estado', 'Status')}</th><th className={th}>{t('Pago', 'Payment')}</th><th className={th}>{t('Documentos válidos', 'Valid documents')}</th><th className={th}>{t('Plazo', 'Deadline')}</th><th className={th}>{t('Quién lo tiene', 'Who has it')}</th></>
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" role="note" data-testid="vault-off">
        {vault.mode === 'off'
          ? t('Bóveda de documentos: apagada. CONTIGO guarda el estado de cada documento, quién lo validó y cuándo, y un enlace al sistema que lo tiene. Nunca el archivo, ni identificaciones o cuentas por chat.', 'Document vault: off. CONTIGO keeps each document’s status, who validated it and when, and a link to the system that holds it. Never the file, nor IDs or accounts over chat.')
          : t('Bóveda de documentos: simulada (solo pruebas).', 'Document vault: simulated (tests only).')}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="file-times">
        <Card><p className="text-[13px] text-muted-2">{t('Aprobados en 90 días', 'Approved in 90 days')}</p><p className="num mt-1 text-[24px] font-semibold">{num(times.approved, locale)}</p></Card>
        <Card><p className="text-[13px] text-muted-2">{t('De la visita a la aprobación', 'Visit to approval')}</p><p className="num mt-1 text-[24px] font-semibold">{times.visit_to_approval_h === null ? shown(num(null, locale)) : t(`${times.visit_to_approval_h} h`, `${times.visit_to_approval_h} h`)}</p></Card>
        <Card><p className="text-[13px] text-muted-2">{t('De la aprobación a la primera venta', 'Approval to first sale')}</p><p className="num mt-1 text-[24px] font-semibold">{times.approval_to_first_txn_d === null ? shown(num(null, locale)) : t(`${times.approval_to_first_txn_d} días`, `${times.approval_to_first_txn_d} days`)}</p></Card>
      </div>
      {current && (
        <Card data-testid="file-detail">
          <CardTitle title={`${t('Expediente de', 'File for')} ${current.account}`} hint={`${t(FILE_STATUS[current.status]![0], FILE_STATUS[current.status]![1])} · ${current.person_type === 'company' ? t('Persona moral', 'Company') : t('Persona física', 'Individual')} · ${current.funding === 'prepaid' ? t('Prepago', 'Prepaid') : t('Crédito ACH', 'ACH credit')}${current.decision_note ? ` · ${current.decision_note}` : ''}`} />
          <ul className="flex flex-col">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 md:flex-row md:items-start md:justify-between" data-testid="doc-row" data-status={d.status}>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-strong">{t(d.label_es ?? d.requirement, d.label_en ?? d.requirement)} <Badge tone={DOC_STATUS[d.status]![2]}>{t(DOC_STATUS[d.status]![0], DOC_STATUS[d.status]![1])}</Badge></p>
                  <p className="mt-1 text-[13px] text-muted">
                    {d.feeds === 'credit' ? t('Alimenta crédito', 'Feeds credit') : d.feeds === 'both' ? t('Alimenta proveedores y crédito', 'Feeds carriers and credit') : t('Alimenta proveedores', 'Feeds carriers')}
                    {d.pii_class === 'personal' ? t(' · dato personal', ' · personal data') : ''}{d.retention_until ? t(` · se conserva hasta ${day(d.retention_until, locale)}`, ` · kept until ${day(d.retention_until, locale)}`) : ''}
                    {d.validated_by ? t(` · revisó ${d.validated_by}, ${dayTime(d.validated_at, locale, tz)}`, ` · reviewed by ${d.validated_by}, ${dayTime(d.validated_at, locale, tz)}`) : ''}{d.note ? ` · ${d.note}` : ''}
                    {d.reads ? t(` · abierto ${d.reads} veces`, ` · opened ${d.reads} times`) : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {capture && ['draft', 'returned'].includes(current.status) && (
                    <ActionForm action={A.markReceivedAction} className="flex flex-wrap gap-2" testId="doc-receive">
                      <input type="hidden" name="id" value={d.id} />
                      <input name="link" type="url" placeholder="https://" aria-label={t('Enlace al documento', 'Link to the document')} className="input w-[220px]" defaultValue={d.link ?? ''} />
                      <Submit size="sm" variant="ghost">{t('Recibido', 'Received')}</Submit>
                    </ActionForm>
                  )}
                  {review && ['submitted', 'in_review'].includes(current.status) && d.status !== 'missing' && (
                    <ActionForm action={A.reviewDocumentAction} className="flex flex-wrap gap-2" testId="doc-review">
                      <input type="hidden" name="id" value={d.id} />
                      <input name="note" placeholder={t('Observación', 'Comment')} aria-label={t('Observación', 'Comment')} className="input w-[200px]" />
                      <Submit size="sm" name="verdict" value="valid" testId="doc-valid">{t('Válido', 'Valid')}</Submit>
                      <Submit size="sm" variant="ghost" name="verdict" value="rejected" testId="doc-reject">{t('Rechazar', 'Reject')}</Submit>
                    </ActionForm>
                  )}
                  {d.status !== 'missing' && (
                    <ActionForm action={A.openDocumentAction} testId="doc-open"><input type="hidden" name="id" value={d.id} /><Submit size="sm" variant="quiet">{t('Abrir', 'Open')}</Submit></ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-3" data-testid="file-extras">
            <div>
              <p className="text-[13px] font-semibold text-strong">{t('Cómo se capturó', 'How it was captured')}</p>
              <p className="mt-1 text-[13px] text-muted">{current.captured_via === 'sales_app' ? t('Desde la Sales App, al enviar el alta.', 'From the Sales App, when the sign-up was sent.') : current.captured_via === 'link' ? t('Con el enlace de captura.', 'With the capture link.') : t('En CONTIGO.', 'In CONTIGO.')}{extras && extras.links > 0 ? t(` Enlaces vigentes: ${extras.links}.`, ` Active links: ${extras.links}.`) : ''}</p>
              {capture && ['draft', 'returned'].includes(current.status) && (
                <div className="mt-2">
                  <RevealOnce action={A.onboardingLinkAction} label={t('Cópialo ahora: no se vuelve a mostrar. Quien lo abra solo puede dejar los enlaces de los documentos de este expediente.', 'Copy it now: it is not shown again. Whoever opens it can only leave the document links for this file.')} copyLabel={t('Copiar', 'Copy')}>
                    <input type="hidden" name="id" value={current.id} />
                    <Submit size="sm" variant="ghost" testId="file-link">{t('Crear enlace para el comercio', 'Create a link for the merchant')}</Submit>
                  </RevealOnce>
                </div>
              )}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-strong">{t('Identificador fiscal', 'Tax ID')}</p>
              <p className="mt-1 text-[13px] text-muted">{t('Va como dato reservado del comercio: se ve tapado y cada revelado queda en la bitácora.', 'It goes as the merchant’s restricted data: it shows masked and every reveal is logged.')}</p>
              {capture && (
                <ActionForm action={A.taxIdAction} className="mt-2 flex flex-wrap gap-2" testId="file-taxid">
                  <input type="hidden" name="accountId" value={current.account_id} />
                  <input name="value" className="input w-[200px]" aria-label={t('Identificador fiscal', 'Tax ID')} required maxLength={40} autoComplete="off" />
                  <Submit size="sm" variant="ghost">{t('Guardar', 'Save')}</Submit>
                </ActionForm>
              )}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-strong">{t('Datos de crédito', 'Credit data')}</p>
              <p className="mt-1 text-[13px] text-muted" data-testid="file-credit">{current.funding === 'prepaid' ? t('Prepago: no pide crédito.', 'Prepaid: no credit needed.') : extras?.credit ? t(`Solicitud de límite: ${extras.credit.status === 'approved' ? 'aprobada' : extras.credit.status === 'rejected' ? 'rechazada' : 'por decidir'} (${day(extras.credit.requested_at, locale, tz)}).`, `Limit request: ${extras.credit.status === 'approved' ? 'approved' : extras.credit.status === 'rejected' ? 'rejected' : 'pending'} (${day(extras.credit.requested_at, locale, tz)}).`) : t('Crédito ACH sin solicitud de límite todavía: se pide en la pestaña Crédito.', 'ACH credit with no limit request yet: it is requested in the Credit tab.')}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
            {capture && ['draft', 'returned'].includes(current.status) && (
              <ActionForm action={A.submitFileAction} testId="file-submit"><input type="hidden" name="id" value={current.id} /><Submit testId="file-submit-btn">{t('Enviar a la mesa de control', 'Send to the control desk')}</Submit></ActionForm>
            )}
            {review && ['submitted', 'in_review'].includes(current.status) && (
              <>
                <ActionForm action={A.assignFileAction} className="flex flex-wrap gap-2" testId="file-assign">
                  <input type="hidden" name="id" value={current.id} />
                  <select name="to" className={sel} aria-label={t('Para quién', 'For whom')} defaultValue=""><option value="">{t('Para mí', 'For me')}</option>{ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                  <Submit variant="ghost">{t('Asignar', 'Assign')}</Submit>
                </ActionForm>
                <ActionForm action={A.decideFileAction} className="flex flex-wrap gap-2" testId="file-decide">
                  <input type="hidden" name="id" value={current.id} />
                  <input name="note" className="input w-[240px]" placeholder={t('Motivo si lo devuelves', 'Reason if you return it')} aria-label={t('Motivo', 'Reason')} />
                  <Submit name="decision" value="approve" testId="file-approve">{t('Aprobar', 'Approve')}</Submit>
                  <Submit variant="ghost" name="decision" value="return" testId="file-return">{t('Devolver a Ventas', 'Return to Sales')}</Submit>
                </ActionForm>
              </>
            )}
          </div>
        </Card>
      )}
      {review && (
        <Card data-testid="desk">
          <CardTitle title={t('Mesa de control', 'Control desk')} hint={t('Ordenada por plazo. Toma uno o repártelo a alguien de Operaciones.', 'Sorted by deadline. Take one or assign it to someone in Operations.')} />
          {desk.length === 0 ? <Empty title={t('No hay expedientes esperando', 'No files waiting')} hint={t('Cuando alguien envíe un expediente, aparece aquí con su plazo.', 'When someone sends a file, it shows up here with its deadline.')} /> : <Table head={head} label={t('Mesa de control', 'Control desk')}>{desk.map(row)}</Table>}
        </Card>
      )}
      {capture && (
        <Card data-testid="file-new">
          <CardTitle title={t('Abrir expediente', 'Open a file')} hint={t('Se captura una sola vez. La lista de documentos sale del formulario maestro del país según el tipo de persona y la forma de pago.', 'It is captured once. The document list comes from the country’s master form by type of person and payment method.')} />
          <ActionForm action={A.openFileAction} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end" testId="file-open">
            <Field label={t('Comercio', 'Merchant')}><select name="accountId" className={sel} defaultValue={accountId ?? ''} required data-testid="file-account"><option value="">{t('Elige', 'Choose')}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label={t('Tipo de persona', 'Type of person')}><select name="personType" className={sel} data-testid="file-person"><option value="company">{t('Persona moral', 'Company')}</option><option value="individual">{t('Persona física', 'Individual')}</option></select></Field>
            <Field label={t('Forma de pago', 'Payment method')}><select name="funding" className={sel} data-testid="file-funding"><option value="prepaid">{t('Prepago', 'Prepaid')}</option><option value="ach_credit">{t('Crédito ACH', 'ACH credit')}</option></select></Field>
            <Field label={t('Fecha de la visita', 'Visit date')}><input type="date" name="visitedOn" className="input" /></Field>
            <Submit testId="file-open-btn">{t('Abrir', 'Open')}</Submit>
          </ActionForm>
        </Card>
      )}
      <Card data-testid="files-open">
        <CardTitle title={t('En captura o devueltos', 'Being captured or returned')} />
        {open.length === 0 ? <Empty title={t('Nada en captura', 'Nothing being captured')} /> : <Table head={head} label={t('En captura', 'Being captured')}>{open.map(row)}</Table>}
      </Card>
      {decided.length > 0 && <Card><CardTitle title={t('Aprobados', 'Approved')} /><Table head={head} label={t('Aprobados', 'Approved')}>{decided.slice(0, 20).map(row)}</Table></Card>}
    </div>
  )
}

async function Portfolio({ ctx, market, acc, tz }: { ctx: Ctx; market: string; acc: { id: string; name: string } | null; tz: string }) {
  const { t, locale } = ctx
  const [people, list, owners, profiles] = await Promise.all([dal.marketPeople(ctx, market), dal.plans(ctx, market), dal.territoryOwners(ctx, market), dal.sellerProfiles(ctx, market)])
  const assignments = acc ? await dal.channelAssignments(ctx, acc.id) : []
  const own = ctx.can('territory.own', market)
  const peopleSel = (name: string, testId: string, empty?: string) => (
    <select name={name} className={sel} required={!empty} data-testid={testId} defaultValue=""><option value="">{empty ?? t('Elige', 'Choose')}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
  )
  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="plan-new">
        <CardTitle title={t('Plan de reparto en borrador', 'Draft reassignment plan')} hint={t('Primero se guarda y se ve quién gana y quién pierde visibilidad. Nada se mueve hasta aplicarlo, y se aplica entero o nada.', 'It is saved first and you see who gains and who loses visibility. Nothing moves until it is applied, and it applies whole or not at all.')} />
        <ActionForm action={A.draftPlanAction} className="grid grid-cols-1 gap-4 md:grid-cols-4 md:items-end" testId="plan-form">
          <input type="hidden" name="market" value={market} />
          <Field label={t('Comercios que lleva', 'Merchants owned by')}>{peopleSel('from', 'plan-from')}</Field>
          <Field label={t('Pasan a', 'Move to')}>{peopleSel('to', 'plan-to')}</Field>
          <Field label={t('Nota', 'Note')}><input name="note" className="input" maxLength={300} /></Field>
          <Submit testId="plan-draft">{t('Guardar borrador', 'Save draft')}</Submit>
        </ActionForm>
      </Card>
      <Card data-testid="plans">
        <CardTitle title={t('Planes', 'Plans')} />
        {list.length === 0 ? <Empty title={t('Sin planes todavía', 'No plans yet')} hint={t('Los borradores aparecen aquí con su comparación.', 'Drafts show up here with their comparison.')} /> : (
          <ul>{list.map((p) => (
            <li key={p.id} className="border-t border-line py-4 first:border-t-0" data-testid="plan-row" data-status={p.status}>
              <p className="text-[15px] font-semibold text-strong">{t(`${p.diff.accounts} comercios a ${p.to_name}`, `${p.diff.accounts} merchants to ${p.to_name}`)} <Badge tone={p.status === 'draft' ? 'warn' : p.status === 'applied' ? 'good' : 'neutral'}>{p.status === 'draft' ? t('Borrador', 'Draft') : p.status === 'applied' ? t('Aplicado', 'Applied') : t('Descartado', 'Discarded')}</Badge></p>
              <p className="mt-1 text-[13px] text-muted">{t(`${p.diff.deals} negocios abiertos y ${p.diff.tasks} tareas se van con ellos. Lo armó ${p.created_by}, ${dayTime(p.created_at, locale, tz)}.`, `${p.diff.deals} open deals and ${p.diff.tasks} tasks go with them. Prepared by ${p.created_by}, ${dayTime(p.created_at, locale, tz)}.`)}{p.note ? ` ${p.note}` : ''}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="plan-diff">
                <p className="text-[14px]"><span className="font-semibold">{t('Dejan de verlos: ', 'Stop seeing them: ')}</span>{p.diff.lose.length ? p.diff.lose.map((x) => `${x.name} (${x.count})`).join(', ') : t('nadie', 'nobody')}</p>
                <p className="text-[14px]"><span className="font-semibold">{t('Empiezan a verlos: ', 'Start seeing them: ')}</span>{p.diff.gain.length ? p.diff.gain.map((x) => x.name).join(', ') : t('nadie nuevo', 'nobody new')}</p>
              </div>
              {p.status === 'draft' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionForm action={A.applyPlanAction} testId="plan-apply"><input type="hidden" name="id" value={p.id} /><Submit size="sm" testId="plan-apply-btn">{t('Aplicar plan', 'Apply plan')}</Submit></ActionForm>
                  <ActionForm action={A.discardPlanAction}><input type="hidden" name="id" value={p.id} /><Submit size="sm" variant="ghost">{t('Descartar', 'Discard')}</Submit></ActionForm>
                </div>
              )}
              {p.status === 'applied' && <p className="mt-2 text-[13px] text-muted">{t(`Se movieron ${p.moved ?? 0}, ${dayTime(p.applied_at, locale, tz)}.`, `${p.moved ?? 0} moved, ${dayTime(p.applied_at, locale, tz)}.`)}</p>}
            </li>
          ))}</ul>
        )}
      </Card>
      <Card data-testid="channel-axis">
        <CardTitle title={t('Canal del comercio: quién abre y quién cuida', 'Merchant channel: who opens and who keeps it')} hint={t('El canal es un eje aparte del territorio. Cada cambio cierra la asignación anterior con fecha.', 'The channel is an axis separate from the territory. Each change closes the previous assignment with a date.')} />
        {!acc ? <Empty title={t('Elige un comercio arriba', 'Choose a merchant above')} /> : (
          <>
            <ActionForm action={A.channelAction} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end" testId="channel-form">
              <input type="hidden" name="accountId" value={acc.id} />
              <Field label={t('Canal', 'Channel')}><input name="channel" className="input" placeholder="d2d" pattern="[a-z0-9_]{2,30}" required /></Field>
              <Field label={t('Papel', 'Role')}><select name="duty" className={sel}><option value="hunter">{t('Abre (captación)', 'Opens (hunter)')}</option><option value="farmer">{t('Cuida (mantenimiento)', 'Keeps (farmer)')}</option></select></Field>
              <Field label={t('Persona', 'Person')}>{peopleSel('userId', 'channel-user', t('Nadie por ahora', 'Nobody for now'))}</Field>
              <Field label={t('Motivo', 'Reason')}><input name="reason" className="input" required minLength={3} /></Field>
              <Submit>{t('Guardar', 'Save')}</Submit>
            </ActionForm>
            <ul className="mt-4">{assignments.map((a, i) => (
              <li key={i} className="border-t border-line py-2 text-[14px]">{a.duty === 'hunter' ? t('Abre', 'Opens') : t('Cuida', 'Keeps')} · {a.channel} · {a.person ?? t('nadie', 'nobody')} · {day(a.valid_from, locale, tz)}{a.valid_to ? `${t(' a ', ' to ')}${day(a.valid_to, locale, tz)}` : t(' (vigente)', ' (current)')}{a.reason ? ` · ${a.reason}` : ''}</li>
            ))}</ul>
          </>
        )}
      </Card>
      <Card data-testid="territory-owners">
        <CardTitle title={t('Quién responde por cada territorio', 'Who is responsible for each territory')} hint={t('Cada territorio con una persona que responde por él, y el perfil de cada quien vende.', 'Each territory with a person responsible for it, and each seller’s profile.')} />
        <ul>{owners.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 md:flex-row md:items-center md:justify-between">
            <span className="text-[15px]"><span className="font-semibold">{o.name}</span>: {o.owner ?? t('nadie responde todavía', 'nobody yet')}{o.since ? t(` desde ${day(o.since, locale, tz)}`, ` since ${day(o.since, locale, tz)}`) : ''}</span>
            {own && <ActionForm action={A.territoryOwnerAction} className="flex gap-2"><input type="hidden" name="territory" value={o.id} />{peopleSel('userId', 'territory-user')}<Submit size="sm" variant="ghost">{t('Asignar', 'Assign')}</Submit></ActionForm>}
          </li>
        ))}</ul>
        <ul className="mt-4">{people.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 border-t border-line py-3 md:flex-row md:items-center md:justify-between" data-testid="profile-row">
            <span className="text-[15px]">{p.name}: {profiles[p.id] === 'hunter' ? t('abre cartera', 'opens accounts') : profiles[p.id] === 'farmer' ? t('cuida cartera', 'keeps accounts') : profiles[p.id] === 'both' ? t('abre y cuida', 'opens and keeps') : t('sin perfil', 'no profile')}</span>
            {own && <ActionForm action={A.profileAction} className="flex gap-2"><input type="hidden" name="market" value={market} /><input type="hidden" name="userId" value={p.id} />
              <select name="profile" className={sel} aria-label={t('Perfil', 'Profile')} defaultValue={profiles[p.id] ?? 'both'}><option value="hunter">{t('Abre', 'Opens')}</option><option value="farmer">{t('Cuida', 'Keeps')}</option><option value="both">{t('Ambas', 'Both')}</option></select>
              <Submit size="sm" variant="ghost">{t('Guardar', 'Save')}</Submit></ActionForm>}
          </li>
        ))}</ul>
      </Card>
    </div>
  )
}

const LAYER: Record<string, [string, string]> = { origin: ['Origen', 'Origin'], channel: ['Canal o equipo', 'Channel or team'], owner: ['Quién lo lleva', 'Owner'] }
const ORIGIN_KIND: Record<string, [string, string]> = { network_conversion: ['Red adquirida', 'Acquired network'], new_acquisition: ['Alta nueva', 'New sign-up'] }

async function Attribution({ ctx, market, acc, tz, month }: { ctx: Ctx; market: string; acc: { id: string; name: string } | null; tz: string; month: string }) {
  const { t, locale } = ctx
  const mk = ctx.market(market)
  const ym = /^\d{4}-\d{2}$/.test(month) ? month : isoDay(new Date(), mk.timezone).slice(0, 7)
  const cycle = ctx.can('attribution.correct', market) || ctx.isGlobal ? await dal.attributionCycle(ctx, market, ym) : null
  const hist = acc ? await dal.attributionHistory(ctx, acc.id) : []
  return (
    <div className="flex flex-col gap-6">
      {acc && (
        <Card data-testid="attr-history">
          <CardTitle title={`${t('Atribución de', 'Attribution for')} ${acc.name}`} hint={t('Tres capas, cada una con vigencia. Una corrección es una fila nueva que apunta a la anterior; el pasado no se edita.', 'Three layers, each with dates. A correction is a new row pointing to the previous one; the past is not edited.')} />
          <Table label={t('Historia', 'History')} head={<><th className={th}>{t('Capa', 'Layer')}</th><th className={th}>{t('A quién', 'Who')}</th><th className={th}>{t('Vigencia', 'Valid')}</th><th className={th}>{t('Motivo', 'Reason')}</th></>}>
            {hist.map((h) => (
              <tr key={h.id} data-testid="attr-row" data-layer={h.layer} data-live={h.effective_to ? 'no' : 'yes'}>
                <td className={td}>{t(...LAYER[h.layer]!)}{h.origin_kind ? ` · ${t(...ORIGIN_KIND[h.origin_kind]!)}` : ''}</td>
                <td className={td}>{h.party_label}</td>
                <td className={td}>{day(h.effective_from, locale, tz)}{h.effective_to ? `${t(' a ', ' to ')}${day(h.effective_to, locale, tz)}` : t(' (vigente)', ' (current)')}</td>
                <td className={td}>{h.reason ?? (h.correction_of ? t('Corrección', 'Correction') : shown(day(null, locale)))}{h.by ? ` · ${h.by}` : ''}</td>
              </tr>
            ))}
          </Table>
          {ctx.can('attribution.correct', market) && (
            <ActionForm action={A.correctAction} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-6 md:items-end" testId="attr-correct">
              <input type="hidden" name="accountId" value={acc.id} />
              <Field label={t('Capa', 'Layer')}><select name="layer" className={sel} data-testid="attr-layer"><option value="origin">{t('Origen', 'Origin')}</option><option value="channel">{t('Canal o equipo', 'Channel or team')}</option></select></Field>
              <Field label={t('Tipo', 'Kind')}><select name="partyKind" className={sel}><option value="team">{t('Equipo', 'Team')}</option><option value="partner">{t('Aliado', 'Partner')}</option><option value="user">{t('Persona', 'Person')}</option></select></Field>
              <Field label={t('Nombre', 'Name')}><input name="partyLabel" className="input" required minLength={2} data-testid="attr-label" /></Field>
              <Field label={t('Origen', 'Origin')}><select name="originKind" className={sel} data-testid="attr-kind"><option value="">{t('Sin cambiar', 'Unchanged')}</option><option value="network_conversion">{t('Red adquirida', 'Acquired network')}</option><option value="new_acquisition">{t('Alta nueva', 'New sign-up')}</option></select></Field>
              <Field label={t('Motivo', 'Reason')}><input name="reason" className="input" required minLength={3} data-testid="attr-reason" /></Field>
              <Submit testId="attr-save">{t('Corregir', 'Correct')}</Submit>
            </ActionForm>
          )}
        </Card>
      )}
      {cycle && (
        <Card data-testid="attr-cycle">
          <CardTitle title={t('Reporte del ciclo', 'Cycle report')} hint={t('Comercios con huecos de atribución, correcciones y disputas del mes.', 'Merchants with attribution gaps, corrections and disputes for the month.')}
            right={<form method="get" action="/campo" className="flex gap-2"><input type="hidden" name="tab" value="atribucion" /><input type="hidden" name="mercado" value={market} /><input type="month" name="ciclo" defaultValue={ym} className="input" aria-label={t('Mes', 'Month')} /><button className="press h-11 rounded-full border border-line px-4 text-[14px] font-semibold">{t('Ver', 'Show')}</button></form>} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              [t('Lo lleva alguien sin fila vigente', 'Owned with no current row'), cycle.no_owner_row], [t('Sin origen', 'No origin'), cycle.no_origin],
              [t('Origen sin clasificar', 'Origin not classified'), cycle.unclassified_origin], [t('Red adquirida', 'Acquired network'), cycle.network],
              [t('Alta nueva', 'New sign-up'), cycle.acquisition], [t('Correcciones del mes', 'Corrections this month'), cycle.corrections],
              [t('Disputas del mes', 'Disputes this month'), cycle.disputes_opened], [t('Disputas vencidas', 'Overdue disputes'), cycle.disputes_open_late],
            ] as [string, number][]).map(([k, v]) => <div key={k} className="rounded-[12px] bg-surface-2 px-4 py-3"><p className="text-[12.5px] text-muted-2">{k}</p><p className="num text-[20px] font-semibold">{num(v, locale)}</p></div>)}
          </div>
          {ctx.can('attribution.correct', market) && (
            <ActionForm action={A.reclassifyAction} className="mt-4 flex flex-wrap items-center gap-3" testId="attr-reclassify">
              <input type="hidden" name="market" value={market} />
              <p className="min-w-0 flex-1 basis-72 text-[13.5px] text-muted-2">{t('Cada alta nueva ya nace con su origen clasificado y con el equipo que la reclutó. Esta corrida aplica la misma regla a lo que ya existía: red adquirida si el comercio trae un ID de una red o ese origen; alta nueva en lo demás. Queda en la bitácora con sus conteos.', 'Every new sign-up is born with its origin classified and the team that recruited it. This run applies the same rule to what already existed: acquired network if the merchant carries an ID from a network or that origin; new sign-up otherwise. It is logged with its counts.')}</p>
              <Submit variant="ghost" testId="attr-reclassify-run">{t('Clasificar lo pendiente', 'Classify what is pending')}</Submit>
            </ActionForm>
          )}
          {cycle.gaps.length > 0 && <ul className="mt-4">{cycle.gaps.map((g) => <li key={g.id} className="border-t border-line py-2 text-[14px]"><a className="underline-offset-2 hover:underline" href={`/campo?tab=atribucion&mercado=${market}&cuenta=${g.id}`}>{g.name}</a> · {g.issue === 'no_origin' ? t('sin origen', 'no origin') : t('quien lo lleva no tiene fila vigente', 'owner has no current row')}</li>)}</ul>}
        </Card>
      )}
    </div>
  )
}

async function Disputes({ ctx, market, tz }: { ctx: Ctx; market: string; tz: string }) {
  const { t, locale } = ctx
  const [list, accounts] = await Promise.all([dal.disputes(ctx, market), ctx.can('dispute.raise', market) ? dal.marketAccounts(ctx, market) : Promise.resolve([])])
  const arb = ctx.can('dispute.arbitrate', market)
  const [policy, leads] = await Promise.all([dal.channelPolicy(ctx, market), ctx.can('channel_policy.manage', market) ? dal.marketPeople(ctx, market, ['market_lead']) : Promise.resolve([])])
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" role="note" data-testid="clawback-note">
        {t('Sin montos: aquí no se muestran cantidades. La política de reversos de abajo dice qué pasa cuando se aprueba una disputa, un ajuste o un reverso.', 'No amounts: no amounts are shown here. The reversal policy below says what happens when a dispute, an adjustment or a reversal is approved.')}
      </p>
      <Card data-testid="channel-policy">
        <CardTitle title={t('Política de reversos y quién arbitra', 'Reversal policy and who arbitrates')}
          right={policy ? <Badge tone={policy.status === 'approved' ? 'good' : 'warn'}>{policy.status === 'approved' ? t(`Aprobada, versión ${policy.version}`, `Approved, version ${policy.version}`) : t(`Propuesta, versión ${policy.version}`, `Proposed, version ${policy.version}`)}</Badge> : undefined} />
        {policy ? (
          <>
            <p className="text-[14px] whitespace-pre-wrap text-strong" data-testid="policy-text">{t(policy.policy_es, policy.policy_en)}</p>
            <p className="mt-2 text-[13px] text-muted-2">{t(`Ventana: ${policy.clawback_days} días. Arbitra: ${policy.arbiter ?? 'quien lidera el mercado (distinto de quien levantó la disputa) o administración'}.`, `Window: ${policy.clawback_days} days. Arbiter: ${policy.arbiter ?? 'the market lead (someone other than whoever raised it) or administration'}.`)}</p>
            {policy.status === 'approved'
              ? <p className="mt-1 text-[13px] text-muted-2">{t(`Aprobada por Finanzas (${policy.approved_finance_by}) y por Ventas (${policy.approved_sales_by}).`, `Approved by Finance (${policy.approved_finance_by}) and by Sales (${policy.approved_sales_by}).`)}</p>
              : <p className="mt-1 text-[13px] text-amber-text" data-testid="policy-pending">{t(`Valor propuesto, [pendiente: ${policy.pending_owner ?? 'Finanzas y Ventas'}]`, `Proposed value, [pending: ${policy.pending_owner === 'Finanzas y Ventas' || !policy.pending_owner ? 'Finance and Sales' : policy.pending_owner}]`)}</p>}
          </>
        ) : <Empty title={t('Este mercado todavía no tiene política', 'This market has no policy yet')} />}
        {ctx.can('channel_policy.manage', market) && (
          <details className="mt-4">
            <summary className="press inline-flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-brand-text">{t('Escribir una versión nueva', 'Write a new version')}</summary>
            <ActionForm action={A.channelPolicyAction} className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2" testId="policy-form">
              <input type="hidden" name="market" value={market} />
              <Field label={t('Política (español)', 'Policy (Spanish)')}><textarea name="policyEs" className="input min-h-[96px]" required minLength={20} defaultValue={policy?.policy_es ?? ''} /></Field>
              <Field label={t('Política (inglés)', 'Policy (English)')}><textarea name="policyEn" className="input min-h-[96px]" required minLength={20} defaultValue={policy?.policy_en ?? ''} /></Field>
              <Field label={t('Días de ventana', 'Window days')}><input name="clawbackDays" type="number" min={0} max={365} className="input" required defaultValue={policy?.clawback_days ?? ''} /></Field>
              <Field label={t('Quién arbitra', 'Arbiter')}><select name="arbiterId" className={sel} defaultValue={policy?.arbiter_id ?? ''}><option value="">{t('Quien lidera el mercado', 'The market lead')}</option>{leads.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label={t('Aprobó por Finanzas (nombre)', 'Approved for Finance (name)')}><input name="financeBy" className="input" maxLength={120} /></Field>
              <Field label={t('Aprobó por Ventas (nombre)', 'Approved for Sales (name)')}><input name="salesBy" className="input" maxLength={120} /></Field>
              <Field label={t('Motivo del cambio', 'Reason for the change')}><input name="reason" className="input" required minLength={3} data-testid="policy-reason" /></Field>
              <div className="md:col-span-2"><p className="mb-3 text-[13px] text-muted-2">{t('Sin las dos aprobaciones queda como propuesta.', 'Without both approvals it stays as a proposal.')}</p><Submit testId="policy-save">{t('Guardar versión', 'Save version')}</Submit></div>
            </ActionForm>
          </details>
        )}
      </Card>
      {ctx.can('dispute.raise', market) && (
        <Card data-testid="dispute-new">
          <CardTitle title={t('Levantar una disputa o ajuste', 'Raise a dispute or adjustment')} />
          <ActionForm action={A.raiseDisputeAction} className="grid grid-cols-1 gap-4 md:grid-cols-3" testId="dispute-form">
            <Field label={t('Comercio', 'Merchant')}><select name="accountId" className={sel} required data-testid="dispute-account"><option value="">{t('Elige', 'Choose')}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label={t('Capa', 'Layer')}><select name="layer" className={sel}><option value="origin">{t('Origen', 'Origin')}</option><option value="channel">{t('Canal o equipo', 'Channel or team')}</option></select></Field>
            <Field label={t('Tipo', 'Type')}><select name="kind" className={sel}><option value="dispute">{t('Disputa', 'Dispute')}</option><option value="adjustment">{t('Ajuste', 'Adjustment')}</option><option value="reversal">{t('Reverso', 'Reversal')}</option></select></Field>
            <Field label={t('Debería ser de (tipo)', 'Should belong to (kind)')}><select name="claimedKind" className={sel}><option value="user">{t('Persona', 'Person')}</option><option value="team">{t('Equipo', 'Team')}</option><option value="partner">{t('Aliado', 'Partner')}</option></select></Field>
            <Field label={t('Nombre', 'Name')}><input name="claimedLabel" className="input" required minLength={2} data-testid="dispute-claimed" /></Field>
            <Field label={t('Por qué', 'Why')}><input name="reason" className="input" required minLength={5} data-testid="dispute-reason" /></Field>
            <div className="md:col-span-3"><Submit testId="dispute-send">{t('Enviar', 'Send')}</Submit></div>
          </ActionForm>
        </Card>
      )}
      <Card data-testid="disputes">
        <CardTitle title={t('Disputas', 'Disputes')} hint={t('Cada una con plazo, árbitro y resultado. Aprobar crea la fila corregida; nada se borra.', 'Each with a deadline, arbiter and outcome. Approving creates the corrected row; nothing is deleted.')} />
        {list.length === 0 ? <Empty title={t('Sin disputas', 'No disputes')} /> : (
          <ul>{list.map((d) => (
            <li key={d.id} className="border-t border-line py-4 first:border-t-0" data-testid="dispute-row" data-status={d.status}>
              <p className="text-[15px] font-semibold">{d.account} · {t(...LAYER[d.layer]!)} → {d.claimed_label} <Badge tone={d.status === 'open' ? (d.late ? 'bad' : 'warn') : d.status === 'approved' ? 'good' : 'neutral'}>{d.status === 'open' ? (d.late ? t('Vencida', 'Overdue') : t('Abierta', 'Open')) : d.status === 'approved' ? t('Aprobada', 'Approved') : t('Rechazada', 'Rejected')}</Badge></p>
              <p className="mt-1 text-[13px] text-muted">{d.claimant} · {d.reason} · {t('plazo', 'deadline')} {dayTime(d.sla_due_at, locale, tz)}{d.arbiter ? ` · ${t('resolvió', 'resolved by')} ${d.arbiter}: ${d.resolution}` : ''}</p>
              {arb && d.status === 'open' && d.claimant_id !== ctx.user.id && (
                <ActionForm action={A.resolveDisputeAction} className="mt-2 flex flex-wrap gap-2" testId="dispute-resolve">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="resolution" className="input w-[260px]" placeholder={t('Resolución', 'Resolution')} aria-label={t('Resolución', 'Resolution')} required minLength={3} />
                  <Submit size="sm" name="decision" value="approve" testId="dispute-approve">{t('Aprobar', 'Approve')}</Submit>
                  <Submit size="sm" variant="ghost" name="decision" value="reject">{t('Rechazar', 'Reject')}</Submit>
                </ActionForm>
              )}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  )
}

async function Claims({ ctx, market, tz }: { ctx: Ctx; market: string; tz: string }) {
  const { t, locale } = ctx
  const list = await dal.claims(ctx, market)
  const ST: Record<string, [string, string, 'good' | 'warn' | 'neutral' | 'bad']> = { active: ['Vigente', 'Active', 'good'], expired: ['Vencido', 'Expired', 'neutral'], rejected: ['Rechazado', 'Rejected', 'bad'], released: ['Liberado', 'Released', 'neutral'] }
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" role="note" data-testid="claims-rules">
        {t('Reglas publicadas al aliado: el primero que registra una tienda la tiene durante la ventana del mercado (ver Umbrales). Se extiende solo con evidencia de actividad, hasta el máximo de extensiones. Una tienda que ya es cliente no se registra. Quien llega después solo sabe que ya tiene registro y hasta cuándo. La venta directa no ve estos registros.', 'Rules published to the partner: whoever registers a store first holds it for the market’s window (see Thresholds). It is extended only with evidence of activity, up to the maximum extensions. A store that is already a customer is not registered. Whoever comes later only learns that it is registered and until when. Direct sales does not see these registrations.')}
      </p>
      <Card data-testid="claim-new">
        <CardTitle title={t('Registrar tienda u oportunidad', 'Register a store or opportunity')} />
        <ActionForm action={A.registerClaimAction} className="grid grid-cols-1 gap-4 md:grid-cols-6 md:items-end" testId="claim-form">
          <input type="hidden" name="market" value={market} />
          <Field label={t('Tienda', 'Store')}><input name="storeName" className="input" required minLength={2} data-testid="claim-store" /></Field>
          <Field label={t('Ciudad', 'City')}><input name="city" className="input" data-testid="claim-city" /></Field>
          <Field label={t('Aliado', 'Partner')}><input name="nodeLabel" className="input" required minLength={2} data-testid="claim-node" /></Field>
          <Field label={t('Clave del aliado', 'Partner key')}><input name="nodeRef" className="input" required data-testid="claim-ref" /></Field>
          <Field label={t('Canal', 'Channel')}><input name="channel" className="input" defaultValue="indirect" pattern="[a-z0-9_]{2,30}" required /></Field>
          <Submit testId="claim-save">{t('Registrar', 'Register')}</Submit>
        </ActionForm>
      </Card>
      <Card data-testid="claims">
        <CardTitle title={t('Registros', 'Registrations')} />
        {list.length === 0 ? <Empty title={t('Sin registros', 'No registrations')} /> : (
          <ul>{list.map((c) => (
            <li key={c.id} className="border-t border-line py-4 first:border-t-0" data-testid="claim-row" data-status={c.status}>
              <p className="text-[15px] font-semibold">{c.store_name} · {c.node_label} <Badge tone={ST[c.status]![2]}>{t(ST[c.status]![0], ST[c.status]![1])}</Badge></p>
              <p className="mt-1 text-[13px] text-muted">{c.channel}{c.registered_via === 'partner' ? t(' · lo registró el aliado', ' · registered by the partner') : ''} · {c.status === 'active' ? t(`hasta ${dayTime(c.expires_at, locale, tz)}`, `until ${dayTime(c.expires_at, locale, tz)}`) : ''}{c.extensions ? t(` · ${c.extensions} extensiones`, ` · ${c.extensions} extensions`) : ''}{c.rejection_reason ? ` · ${c.rejection_reason}` : ''}</p>
              {c.status === 'active' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionForm action={A.extendClaimAction} className="flex gap-2" testId="claim-extend"><input type="hidden" name="id" value={c.id} /><input name="evidence" className="input w-[240px]" placeholder={t('Actividad con la tienda', 'Activity with the store')} aria-label={t('Evidencia', 'Evidence')} /><Submit size="sm" variant="ghost">{t('Extender', 'Extend')}</Submit></ActionForm>
                  <ActionForm action={A.rejectClaimAction} className="flex gap-2"><input type="hidden" name="id" value={c.id} /><input name="reason" className="input w-[200px]" placeholder={t('Motivo', 'Reason')} aria-label={t('Motivo', 'Reason')} /><Submit size="sm" variant="ghost">{t('Rechazar', 'Reject')}</Submit></ActionForm>
                </div>
              )}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  )
}

async function Credit({ ctx, market, currency, acc, tz }: { ctx: Ctx; market: string; currency: string; acc: { id: string; name: string } | null; tz: string }) {
  const { t, locale } = ctx
  const [rows, requests] = await Promise.all([acc ? dal.funding(ctx, acc.id) : Promise.resolve([]), dal.creditRequests(ctx, market, acc?.id)])
  const feed = fundingFeed()
  const last = rows[0]
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" role="note" data-testid="funding-off">
        {feed.mode === 'off' ? t('Archivo de ventas con fondeo y saldo: conexión apagada. El saldo nunca se escribe a mano: llega del archivo de ventas o del core con su fecha de corte.', 'Sales file with funding and balance: connection off. The balance is never typed in: it comes from the sales file or the core with its cut-off date.') : t('Fondeo: simulado (solo pruebas).', 'Funding: simulated (tests only).')}
      </p>
      {acc && (
        <Card data-testid="funding">
          <CardTitle title={`${t('Fondeo de', 'Funding for')} ${acc.name}`} hint={last ? t(`Corte del ${day(last.as_of, locale)}`, `As of ${day(last.as_of, locale)}`) : undefined} />
          {!last ? <Empty title={t('Sin dato del archivo de ventas', 'No data from the sales file')} hint={t('Cuando se encienda la conexión, aquí aparecen método, saldo y límite con su fecha de corte.', 'Once the connection is on, method, balance and limit show here with their cut-off date.')} /> : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="funding-latest">
                <div className="rounded-[12px] bg-surface-2 px-4 py-3"><p className="text-[12.5px] text-muted-2">{t('Método', 'Method')}</p><p className="text-[18px] font-semibold">{last.method === 'prepaid' ? t('Prepago', 'Prepaid') : t('Crédito ACH', 'ACH credit')}</p></div>
                <div className="rounded-[12px] bg-surface-2 px-4 py-3"><p className="text-[12.5px] text-muted-2">{t('Saldo', 'Balance')}</p><p className="num text-[18px] font-semibold">{money(Number(last.balance_minor), currency, locale)}</p></div>
                <div className="rounded-[12px] bg-surface-2 px-4 py-3"><p className="text-[12.5px] text-muted-2">{t('Límite de crédito', 'Credit limit')}</p><p className="num text-[18px] font-semibold">{shown(money(last.credit_limit_minor === null ? null : Number(last.credit_limit_minor), currency, locale))}</p></div>
              </div>
              <ul className="mt-4">{rows.map((r, i) => <li key={i} className="border-t border-line py-2 text-[13.5px]">{day(r.as_of, locale)} · {money(Number(r.balance_minor), currency, locale)} · {r.source === 'simulator' ? <Badge tone="warn">{t('Dato simulado', 'Simulated value')}</Badge> : t('Archivo de ventas', 'Sales file')}</li>)}</ul>
            </>
          )}
          {ctx.can('funding.simulate', market) && (
            <ActionForm action={A.simulateFundingAction} className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-4 md:items-end" testId="funding-sim">
              <input type="hidden" name="accountId" value={acc.id} />
              <Field label={t('Simulador: método', 'Simulator: method')}><select name="method" className={sel}><option value="prepaid">{t('Prepago', 'Prepaid')}</option><option value="ach_credit">{t('Crédito ACH', 'ACH credit')}</option></select></Field>
              <Field label={t('Saldo de prueba', 'Test balance')}><input name="balance" type="number" step="0.01" className="input" required data-testid="funding-sim-balance" /></Field>
              <Field label={t('Límite de prueba', 'Test limit')}><input name="creditLimit" type="number" step="0.01" min="0" className="input" /></Field>
              <Submit variant="ghost" testId="funding-sim-save">{t('Cargar dato simulado', 'Load simulated value')}</Submit>
            </ActionForm>
          )}
          {ctx.can('credit.request', market) && (
            <ActionForm action={A.requestCreditAction} className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-3 md:items-end" testId="credit-request">
              <input type="hidden" name="accountId" value={acc.id} />
              <Field label={t('Límite que pides', 'Limit you ask for')}><input name="amount" type="number" step="0.01" min="1" className="input" required data-testid="credit-amount" /></Field>
              <Field label={t('Por qué', 'Why')}><input name="reason" className="input" required minLength={5} data-testid="credit-reason" /></Field>
              <Submit testId="credit-send">{t('Pedir límite', 'Request limit')}</Submit>
            </ActionForm>
          )}
        </Card>
      )}
      <Card data-testid="credit-requests">
        <CardTitle title={t('Solicitudes de límite', 'Limit requests')} hint={t('El límite es un dato aprobado: lo decide alguien distinto de quien lo pidió.', 'The limit is an approved value: someone other than the requester decides it.')} />
        {requests.length === 0 ? <Empty title={t('Sin solicitudes', 'No requests')} /> : (
          <ul>{requests.map((r) => (
            <li key={r.id} className="border-t border-line py-3 first:border-t-0" data-testid="credit-row" data-status={r.status}>
              <p className="text-[15px] font-semibold">{r.account} · {money(Number(r.amount_minor), currency, locale)} <Badge tone={r.status === 'requested' ? 'warn' : r.status === 'approved' ? 'good' : 'neutral'}>{r.status === 'requested' ? t('Por aprobar', 'Pending') : r.status === 'approved' ? t('Aprobado', 'Approved') : t('Rechazado', 'Rejected')}</Badge></p>
              <p className="text-[13px] text-muted">{r.requested_by} · {dayTime(r.requested_at, locale, tz)} · {r.reason}{r.decided_by ? ` · ${r.decided_by}: ${r.decision_note}` : ''}</p>
              {r.status === 'requested' && ctx.can('credit.approve', market) && r.requested_by_id !== ctx.user.id && (
                <ActionForm action={A.decideCreditAction} className="mt-2 flex flex-wrap gap-2" testId="credit-decide"><input type="hidden" name="id" value={r.id} /><input name="note" className="input w-[220px]" placeholder={t('Nota', 'Note')} aria-label={t('Nota', 'Note')} /><Submit size="sm" name="decision" value="approve">{t('Aprobar', 'Approve')}</Submit><Submit size="sm" variant="ghost" name="decision" value="reject">{t('Rechazar', 'Reject')}</Submit></ActionForm>
              )}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  )
}

async function Competition({ ctx, market, currency, acc }: { ctx: Ctx; market: string; currency: string; acc: { id: string; name: string } | null }) {
  const { t, locale } = ctx
  const mk = ctx.market(market)
  const [list, report, obs] = await Promise.all([dal.competitors(ctx, market), dal.competitorReport(ctx, market), acc ? dal.accountCompetitors(ctx, acc.id) : Promise.resolve([])])
  const SRC: Record<string, [string, string]> = { visit: ['Visita', 'Visit'], onboarding: ['Alta', 'Sign-up'], dealer_tabs: ['Pestañas abiertas del dealer', 'Dealer’s open tabs'], sales_app: ['Sales App', 'Sales App'] }
  const today = isoDay(new Date(), mk.timezone)
  return (
    <div className="flex flex-col gap-6">
      {acc && ctx.can('competitor.record', market) && (
        <Card data-testid="competitor-new">
          <CardTitle title={`${t('Competencia en', 'Competition at')} ${acc.name}`} hint={t('Dato estructurado con fecha y fuente: qué competidor, qué producto y a qué precio. No en notas.', 'Structured data with date and source: which competitor, which product and at what price. Not in notes.')} />
          <ActionForm action={A.recordCompetitorAction} className="grid grid-cols-1 gap-4 md:grid-cols-6 md:items-end" testId="competitor-form">
            <input type="hidden" name="accountId" value={acc.id} />
            <Field label={t('Competidor', 'Competitor')}><select name="competitorId" className={sel} required data-testid="competitor-select"><option value="">{t('Elige', 'Choose')}</option>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label={t('Producto', 'Product')}><input name="product" className="input" data-testid="competitor-product" /></Field>
            <Field label={t('Precio observado', 'Observed price')}><input name="price" inputMode="decimal" className="input" data-testid="competitor-price" /></Field>
            <Field label={t('Fecha', 'Date')}><input name="observedOn" type="date" defaultValue={today} className="input" required /></Field>
            <Field label={t('Dónde', 'Where')}><select name="source" className={sel}><option value="visit">{t('Visita', 'Visit')}</option><option value="onboarding">{t('Alta', 'Sign-up')}</option><option value="dealer_tabs">{t('Pestañas abiertas del dealer', 'Dealer’s open tabs')}</option></select></Field>
            <Submit testId="competitor-save">{t('Guardar', 'Save')}</Submit>
          </ActionForm>
          <ul className="mt-4">{obs.map((o, i) => <li key={i} className="border-t border-line py-2 text-[14px]" data-testid="competitor-obs">{o.competitor}{o.product ? ` · ${o.product}` : ''}{o.price_minor ? ` · ${money(Number(o.price_minor), currency, locale)}` : ''} · {day(o.observed_on, locale)} · {t(...(SRC[o.source] ?? [o.source, o.source]))}{o.by ? ` · ${o.by}` : ''}</li>)}</ul>
        </Card>
      )}
      <Card data-testid="competitor-report">
        <CardTitle title={t('Competencia en el mercado', 'Competition in the market')} />
        <Table label={t('Competencia', 'Competition')} head={<><th className={th}>{t('Competidor', 'Competitor')}</th><th className={th}>{t('Tiendas', 'Stores')}</th><th className={th}>{t('Observaciones', 'Observations')}</th><th className={th}>{t('Precio promedio', 'Average price')}</th><th className={th}>{t('Última vez', 'Last seen')}</th></>}>
          {report.map((r) => <tr key={r.competitor}><td className={td}>{r.competitor}</td><td className={`${td} num`}>{num(r.stores, locale)}</td><td className={`${td} num`}>{num(r.observations, locale)}</td><td className={`${td} num`}>{shown(money(r.avg_price_minor === null ? null : Number(r.avg_price_minor), currency, locale))}</td><td className={td}>{shown(day(r.last_seen, locale))}</td></tr>)}
        </Table>
        {ctx.can('competitor.record', market) && (
          <ActionForm action={A.addCompetitorAction} className="mt-4 flex flex-wrap gap-2" testId="competitor-add"><input type="hidden" name="market" value={market} /><input name="name" className="input w-[240px]" placeholder={t('Competidor nuevo', 'New competitor')} aria-label={t('Competidor nuevo', 'New competitor')} required /><Submit variant="ghost">{t('Agregar a la lista', 'Add to the list')}</Submit></ActionForm>
        )}
      </Card>
    </div>
  )
}

async function PerfectStore({ ctx, market, tz }: { ctx: Ctx; market: string; tz: string }) {
  const { t, locale } = ctx
  const rows = await dal.perfectStores(ctx, market)
  return (
    <Card data-testid="perfect-store">
      <CardTitle title={t('Punto de venta perfecto', 'Perfect store')} hint={t('El checklist (material, productos habilitados, saldo, encargado capacitado, quien decide identificado) vive en la Sales App y llega con la visita. Aquí se guarda el puntaje y la fecha, y alimenta los avisos y la API.', 'The checklist (materials, enabled products, balance, trained clerk, decision-maker identified) lives in the Sales App and arrives with the visit. Here the score and date are kept, and feed the notices and the API.')} />
      {rows.length === 0 ? <Empty title={t('Todavía no llega ningún puntaje', 'No score has arrived yet')} hint={t('Llega cuando la Sales App manda la visita con su checklist.', 'It arrives when the Sales App sends the visit with its checklist.')} /> : (
        <Table label={t('Puntajes', 'Scores')} head={<><th className={th}>{t('Tienda', 'Store')}</th><th className={th}>{t('Puntaje', 'Score')}</th><th className={th}>{t('Ítems', 'Items')}</th><th className={th}>{t('Fecha', 'Date')}</th></>}>
          {rows.map((r) => <tr key={r.account_id} data-testid="perfect-row"><td className={td}>{r.account}</td><td className={`${td} num`}>{r.score}</td><td className={`${td} num`}>{r.items_ok}/{r.items_total}</td><td className={td}>{dayTime(r.observed_at, locale, tz)}</td></tr>)}
        </Table>
      )}
    </Card>
  )
}

async function Incidents({ ctx, market, tz, open }: { ctx: Ctx; market: string; tz: string; open?: string }) {
  const { t, locale } = ctx
  const mk = ctx.market(market)
  const [list, accounts] = await Promise.all([dal.incidents(ctx, market), dal.marketAccounts(ctx, market)])
  const manage = ctx.can('incident.manage', market)
  if (open && list.some((i) => i.id === open)) {
    await logIncidentView(ctx, open)
  }
  const TYPE: Record<string, [string, string]> = { conduct: ['Conducta', 'Conduct'], complaint: ['Queja', 'Complaint'], fraud_suspicion: ['Sospecha de fraude', 'Fraud suspicion'], equipment: ['Material instalado o retirado', 'Equipment installed or removed'], other: ['Otro', 'Other'] }
  const today = isoDay(new Date(), mk.timezone)
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" role="note" data-testid="incident-note">
        {t('Registro confidencial, aparte de las notas comerciales. Lo ve quien lo reporta y quien lidera el mercado o administra; cada vez que alguien abre uno queda en la bitácora.', 'Confidential record, separate from sales notes. It is seen by whoever reports it and by the market lead or administration; every time someone opens one it is logged.')}
      </p>
      {ctx.can('incident.report', market) && (
        <Card data-testid="incident-new">
          <CardTitle title={t('Reportar un incidente de campo', 'Report a field incident')} />
          <ActionForm action={A.reportIncidentAction} onOk="reset" className="grid grid-cols-1 gap-4 md:grid-cols-3" testId="incident-form">
            <input type="hidden" name="market" value={market} />
            <Field label={t('Sobre quién', 'About whom')}><select name="partyKind" className={sel}><option value="user">{t('Persona del equipo', 'Team member')}</option><option value="street_seller">{t('Vendedor de calle', 'Street seller')}</option><option value="partner">{t('Aliado', 'Partner')}</option><option value="other">{t('Otro', 'Other')}</option></select></Field>
            <Field label={t('Nombre', 'Name')}><input name="partyLabel" className="input" required minLength={2} data-testid="incident-party" /></Field>
            <Field label={t('Tipo', 'Type')}><select name="type" className={sel} data-testid="incident-type">{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{t(...v)}</option>)}</select></Field>
            <Field label={t('Comercio (si aplica)', 'Merchant (if any)')}><select name="accountId" className={sel}><option value="">{t('Ninguno', 'None')}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label={t('Cuándo pasó', 'When it happened')}><input name="occurredOn" type="date" defaultValue={today} max={today} className="input" required /></Field>
            <Field label={t('Qué pasó', 'What happened')}><textarea name="description" className="input min-h-[88px] py-3" required minLength={10} maxLength={2000} data-testid="incident-desc" /></Field>
            <div className="md:col-span-3"><Submit testId="incident-send">{t('Reportar', 'Report')}</Submit></div>
          </ActionForm>
        </Card>
      )}
      <Card data-testid="incidents">
        <CardTitle title={manage ? t('Incidentes del mercado', 'Market incidents') : t('Lo que reportaste', 'What you reported')} />
        {list.length === 0 ? <Empty title={t('Sin incidentes', 'No incidents')} /> : (
          <ul>{list.map((i) => (
            <li key={i.id} className="border-t border-line py-4 first:border-t-0" data-testid="incident-row" data-status={i.status}>
              <p className="text-[15px] font-semibold"><a className="underline-offset-2 hover:underline" href={`/campo?tab=incidentes&mercado=${market}&incidente=${i.id}`}>{t(...TYPE[i.type]!)} · {i.party_label}</a> <Badge tone={i.status === 'closed' ? 'neutral' : i.status === 'in_review' ? 'warn' : 'bad'}>{i.status === 'open' ? t('Abierto', 'Open') : i.status === 'in_review' ? t('En atención', 'Being handled') : t('Cerrado', 'Closed')}</Badge></p>
              <p className="mt-1 text-[13px] text-muted">{day(i.occurred_on, locale)}{i.account ? ` · ${i.account}` : ''} · {t('reportó', 'reported by')} {i.reported_by}{i.assigned ? ` · ${t('atiende', 'handled by')} ${i.assigned}` : ''} · {dayTime(i.created_at, locale, tz)}</p>
              {open === i.id && <p className="mt-2 text-[14px] whitespace-pre-wrap text-strong" data-testid="incident-detail">{i.description}{i.resolution ? `\n${t('Resolución', 'Resolution')}: ${i.resolution}` : ''}</p>}
              {open === i.id && (Object.keys(i.attribution).length > 0 || i.trust_score !== null || i.equipment) && (
                <p className="mt-2 text-[13px] text-muted-2" data-testid="incident-links">
                  {[i.attribution.origin ? t(`Origen: ${i.attribution.origin}`, `Origin: ${i.attribution.origin}`) : null,
                    i.attribution.channel ? t(`Canal: ${i.attribution.channel}`, `Channel: ${i.attribution.channel}`) : null,
                    i.attribution.owner ? t(`Lo llevaba: ${i.attribution.owner}`, `Owner: ${i.attribution.owner}`) : null,
                    i.trust_score !== null ? t(`Señal de la visita: ${i.trust_score}`, `Visit signal: ${i.trust_score}`) : i.visit_linked ? t('Visita de ese día, sin señal', 'Visit that day, no signal') : null,
                    i.equipment ? `${i.equipment.kind === 'installed' ? t('Equipo instalado', 'Equipment installed') : t('Equipo retirado', 'Equipment removed')}: ${i.equipment.equipment_type}${i.equipment.equipment_ref ? ` ${i.equipment.equipment_ref}` : ''}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {manage && i.status !== 'closed' && (
                <ActionForm action={A.handleIncidentAction} className="mt-2 flex flex-wrap gap-2" testId="incident-handle">
                  <input type="hidden" name="id" value={i.id} />
                  <input name="resolution" className="input w-[260px]" placeholder={t('Cómo se atendió', 'How it was handled')} aria-label={t('Resolución', 'Resolution')} />
                  {i.status === 'open' && <Submit size="sm" variant="ghost" name="action" value="take">{t('Tomar', 'Take')}</Submit>}
                  <Submit size="sm" name="action" value="close" testId="incident-close">{t('Cerrar', 'Close')}</Submit>
                </ActionForm>
              )}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  )
}

async function Thresholds({ ctx, market, tz }: { ctx: Ctx; market: string; tz: string }) {
  const { t, locale } = ctx
  const mk = ctx.market(market)
  const [rows, plansList, people] = await Promise.all([dal.thresholds(ctx, market), dal.repPlans(ctx, market), dal.marketPeople(ctx, market, ['rep'])])
  const month = isoDay(new Date(), mk.timezone).slice(0, 7)
  return (
    <div className="flex flex-col gap-6">
      {ctx.can('threshold.manage', market) && (
        <Card data-testid="thresholds">
          <CardTitle title={t('Umbrales', 'Thresholds')} hint={t('Cada cambio queda como versión nueva con su motivo; los avisos anotan la versión que los abrió. Calibrar el primer trimestre.', 'Each change stays as a new version with its reason; notices record the version that opened them. Calibrate during the first quarter.')} />
          <ul>{rows.map((r) => {
            const def = THRESHOLDS[r.key as keyof typeof THRESHOLDS]
            return (
              <li key={r.key} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 md:flex-row md:items-center md:justify-between" data-testid="threshold-row" data-key={r.key}>
                <span className="text-[14.5px]"><span className="font-semibold">{t(def.es, def.en)}</span>: <span className="num">{Number.isNaN(r.value) ? shown(num(null, locale)) : num(r.value, locale)}</span> <span className="text-[12.5px] text-muted">{t(`versión ${r.version}`, `version ${r.version}`)}{r.by ? ` · ${r.by}` : ''}{r.valid_from ? ` · ${day(r.valid_from, locale, tz)}` : ''}</span>
                  {r.pending_owner && <span className="mt-1 block text-[12.5px] text-amber-text" data-testid="threshold-proposed">{t(`Valor propuesto, [pendiente: ${r.pending_owner}]`, `Proposed value, [pending: ${r.pending_owner}]`)}</span>}
                  {r.review_due && <span className={`mt-1 block text-[12.5px] ${r.review_late ? 'font-medium text-red-text' : 'text-muted'}`} data-testid="threshold-review">{r.review_late ? t(`Calibración vencida: tocaba revisarlo el ${day(r.review_due, locale)}`, `Calibration overdue: it was due for review on ${day(r.review_due, locale)}`) : t(`Próxima calibración: ${day(r.review_due, locale)}`, `Next calibration: ${day(r.review_due, locale)}`)}</span>}</span>
                <ActionForm action={A.setThresholdAction} className="flex flex-wrap gap-2"><input type="hidden" name="market" value={market} /><input type="hidden" name="key" value={r.key} />
                  <input name="value" type="number" step="any" min={def.min} max={def.max} className="input w-[120px]" aria-label={t('Valor nuevo', 'New value')} required />
                  <input name="reason" className="input w-[200px]" placeholder={t('Motivo', 'Reason')} aria-label={t('Motivo', 'Reason')} required minLength={3} />
                  <Submit size="sm" variant="ghost">{t('Cambiar', 'Change')}</Submit></ActionForm>
              </li>
            )
          })}</ul>
        </Card>
      )}
      {ctx.can('plan.set', market) && (
        <Card data-testid="rep-plans">
          <CardTitle title={t('Metas del mes por persona', 'Monthly targets per person')} hint={t('Altas ganadas esperadas en el mes. Quien va por debajo del porcentaje del umbral aparece en los avisos de Mi equipo.', 'Won sign-ups expected in the month. Whoever is below the threshold percentage shows up in the My team notices.')} />
          <ActionForm action={A.repPlanAction} className="grid grid-cols-1 gap-4 md:grid-cols-4 md:items-end" testId="rep-plan-form">
            <input type="hidden" name="market" value={market} />
            <Field label={t('Persona', 'Person')}><select name="userId" className={sel} required><option value="">{t('Elige', 'Choose')}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label={t('Mes', 'Month')}><input name="month" type="month" defaultValue={month} className="input" required /></Field>
            <Field label={t('Meta de altas ganadas', 'Won sign-up target')}><input name="target" type="number" min={1} max={1000} className="input" required /></Field>
            <Submit>{t('Guardar meta', 'Save target')}</Submit>
          </ActionForm>
          <ul className="mt-4">{plansList.map((p) => <li key={`${p.user_id}${p.month}`} className="border-t border-line py-2 text-[14px]">{p.name} · {p.month} · {t(`${p.won} de ${p.target_won}`, `${p.won} of ${p.target_won}`)}</li>)}</ul>
        </Card>
      )}
    </div>
  )
}
