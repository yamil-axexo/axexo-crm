import Link from 'next/link'
import { headers } from 'next/headers'
import type { Ctx } from '@/server/context'
import { accountChoices, accountEmbudo, dealEmbudo, leadEmbudo, type Milestones, type Touch } from '@/dal/embudo'
import { FUNDING_LABEL, FUNDING_METHODS, MILESTONES, MILESTONE_LABEL, type FundingMethod, type Milestone } from '@/domain/embudo/closing'
import { PLATFORM_LABEL, type Platform } from '@/domain/embudo/attribution'
import { TICKET_STATUS, TICKET_STATUS_LABEL, TICKET_SYSTEMS } from '@/domain/embudo/tickets'
import { supportDeskAdapter } from '@/server/adapters/support-desk'
import { FIELD_LABEL } from '@/domain/deals'
import { qrSvg } from '@/lib/qr'
import { Badge, Card, CardTitle, Field, KeyVal, buttonClass } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { LEAD_STATUS, SOURCE, lab } from '@/lib/labels'
import { day, dayTime } from '@/lib/format'
import { addTicketAction, correctMilestoneAction, linkLeadAction, referralCodeAction, setLeadLabelsAction, setTicketStatusAction } from '@/app/(app)/embudo-actions'

/** Paneles del paquete embudo que se muestran dentro del negocio, del comercio y del lead. */

function MilestoneList({ ctx, ms, cut, tz }: { ctx: Ctx; ms: Milestones | null; cut: string | null; tz: string }) {
  const { t, locale } = ctx
  const none = t('Todavía no', 'Not yet')
  return (
    <div data-testid="milestones">
    <dl className="space-y-1">
      <KeyVal k={t('Primer fondeo', 'First funding')}><span data-testid="ms-funding">{ms?.first_funding_at ? `${day(ms.first_funding_at, locale, tz)} · ${t(FUNDING_LABEL[(ms.funding_method ?? 'other') as FundingMethod].es, FUNDING_LABEL[(ms.funding_method ?? 'other') as FundingMethod].en)}` : none}</span></KeyVal>
      <KeyVal k={t('Primera transacción', 'First transaction')}><span data-testid="ms-first-txn">{ms?.first_txn_at ? day(ms.first_txn_at, locale, tz) : none}</span></KeyVal>
      <KeyVal k={t('Hábito', 'Habit')}><span data-testid="ms-habit">{ms?.habit_at ? day(ms.habit_at, locale, tz) : none}</span></KeyVal>
      </dl>
      <p className="pt-1 text-[12.5px] text-muted" data-testid="ms-cut">{cut ? t(`Lo pone el archivo de ventas, con un día de atraso. Último corte: ${day(cut, locale)}.`, `Set by the sales file, one day behind. Last cut: ${day(cut, locale)}.`) : t('Lo pone el archivo de ventas. Todavía no se ha cargado ninguno.', 'Set by the sales file. None has been loaded yet.')}</p>
    </div>
  )
}

function CorrectionDialog({ ctx, accountId, today }: { ctx: Ctx; accountId: string; today: string }) {
  const { t } = ctx
  return (
    <Dialog trigger={t('Corregir un hito', 'Correct a milestone')} title={t('Corregir un hito del comercio', 'Correct a merchant milestone')} size="sm" testId="milestone-correct">
      <ActionForm action={correctMilestoneAction} onOk="close" testId="milestone-form">
        <input type="hidden" name="account_id" value={accountId} />
        <p className="mb-4 text-[13.5px] text-muted-2">{t('La fecha no se edita: queda un evento de corrección con el valor anterior. Si anulas la primera transacción, el negocio que se ganó con ella vuelve a abrirse.', 'The date is not edited: a correction event keeps the previous value. If you void the first transaction, the deal it won is opened again.')}</p>
        <Field label={t('Qué hito', 'Which milestone')}><select name="kind" className="input" defaultValue="first_txn" data-testid="correct-kind">{MILESTONES.map((k) => <option key={k} value={k}>{t(MILESTONE_LABEL[k].es, MILESTONE_LABEL[k].en)}</option>)}</select></Field>
        <Field label={t('Qué pasó', 'What happened')} className="mt-4"><select name="action" className="input" defaultValue="void" data-testid="correct-action"><option value="void">{t('No ocurrió: anularlo', 'It did not happen: void it')}</option><option value="restate">{t('Ocurrió otro día: corregir la fecha', 'It happened on another day: correct the date')}</option></select></Field>
        <Field label={t('Fecha correcta (solo si corriges la fecha)', 'Right date (only when correcting the date)')} className="mt-4"><input name="at" type="date" className="input" max={today} data-testid="correct-date" /></Field>
        <Field label={t('Método de fondeo (solo para el primer fondeo)', 'Funding method (first funding only)')} className="mt-4"><select name="method" className="input" defaultValue=""><option value="">{t('Sin cambio', 'No change')}</option>{FUNDING_METHODS.map((m) => <option key={m} value={m}>{t(FUNDING_LABEL[m].es, FUNDING_LABEL[m].en)}</option>)}</select></Field>
        <Field label={t('Motivo de la corrección', 'Reason for the correction')} className="mt-4"><textarea name="reason" rows={2} required minLength={5} maxLength={300} className="input" data-testid="correct-reason" /></Field>
        <div className="mt-5 flex justify-end"><Submit testId="correct-save">{t('Guardar corrección', 'Save correction')}</Submit></div>
      </ActionForm>
    </Dialog>
  )
}

function TouchList({ ctx, touches, tz }: { ctx: Ctx; touches: Touch[]; tz: string }) {
  const { t, locale } = ctx
  if (touches.length === 0) return <p className="text-[14px] text-muted" data-testid="touches-empty">{t('No trae datos de campaña ni de anuncio.', 'It carries no campaign or ad data.')}</p>
  return (
    <ul className="space-y-3" data-testid="touches">
      {touches.map((x, i) => (
        <li key={i} className="text-[14px]" data-testid="touch">
          <p className="font-medium text-strong">{x.touch === 'first' ? t('Primer toque', 'First touch') : t('Último toque', 'Last touch')} · {dayTime(x.touched_at, locale, tz)}{x.platform ? ` · ${t('clic de', 'click from')} ${PLATFORM_LABEL[x.platform as Platform] ?? x.platform}${x.ctwa_clid ? t(' (anuncio que abre WhatsApp)', ' (ad that opens WhatsApp)') : ''}` : ''}</p>
          <p className="text-[13px] text-muted-2 [overflow-wrap:anywhere]">
            {[x.utm_source && `${t('fuente', 'source')}: ${x.utm_source}`, x.utm_medium && `${t('medio', 'medium')}: ${x.utm_medium}`, x.utm_campaign && `${t('campaña', 'campaign')}: ${x.utm_campaign}`,
              x.landing_page && `${t('página de llegada', 'landing page')}: ${x.landing_page}`, x.referrer && `${t('venía de', 'came from')}: ${x.referrer}`, x.referrer_account && `${t('lo refirió', 'referred by')}: ${x.referrer_account}`].filter(Boolean).join(' · ') || t('Sin datos de campaña', 'No campaign data')}
          </p>
        </li>
      ))}
    </ul>
  )
}

/** En el negocio: hitos de cierre, corrección, lo que le falta para su etapa si entró sin cumplirla, y de dónde vino. */
export async function DealEmbudoPanel({ ctx, dealId }: { ctx: Ctx; dealId: string }) {
  const d = await dealEmbudo(ctx, dealId)
  if (!d) return null
  const { t } = ctx
  const market = ctx.market(d.market_code)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: market.timezone }).format(new Date())
  return (
    <>
      {d.gap && (
        <div className="rounded-[16px] bg-warn-bg px-6 py-5" role="status" data-testid="stage-gap-banner">
          <p className="text-[15px] font-semibold text-amber-text">{t('Este negocio entró a su etapa sin lo que la etapa pide', 'This deal entered its stage without what the stage asks for')}</p>
          <p className="mt-1 text-[13.5px] text-strong">{t(`Llegó por ${d.gap.source === 'import' ? 'importación' : 'un movimiento de administración'}. Le falta: `, `It came in through ${d.gap.source === 'import' ? 'an import' : 'an administration move'}. Missing: `)}
            {d.gap.missing.map((m) => (FIELD_LABEL[m] ? t(FIELD_LABEL[m]!.es, FIELD_LABEL[m]!.en) : m.replace(/^field:/, ''))).join(', ')}. {t('No se puede mover de etapa hasta completarlo.', 'It cannot change stage until that is filled in.')}</p>
        </div>
      )}
      <Card data-testid="deal-closing">
        <CardTitle title={t('Cierre por venta real', 'Closing by real sales')}
          hint={d.close_by_transaction ? t('Este embudo se gana solo: el primer fondeo lo pasa a esperar la primera venta y la primera transacción lo gana.', 'This pipeline is won on its own: the first funding moves it to waiting for the first sale and the first transaction wins it.') : t('En este embudo el negocio se gana a mano. Los hitos del comercio se muestran igual.', 'In this pipeline the deal is won by hand. The merchant’s milestones are shown anyway.')}
          right={ctx.can('deal.correct_win', d.market_code) ? <CorrectionDialog ctx={ctx} accountId={d.account_id} today={today} /> : undefined} />
        <MilestoneList ctx={ctx} ms={d.milestones} cut={d.cut} tz={market.timezone} />
        {d.corrections.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-line pt-3 text-[13.5px]" data-testid="corrections">
            {d.corrections.map((c, i) => (
              <li key={i} data-testid="correction">{t(MILESTONE_LABEL[c.kind as Milestone].es, MILESTONE_LABEL[c.kind as Milestone].en)}: {c.action === 'void' ? t('anulado', 'voided') : t('fecha corregida', 'date corrected')}
                {c.previous_at ? ` (${t('antes', 'was')} ${day(c.previous_at, ctx.locale, market.timezone)})` : ''} · {c.reason} · {c.actor ?? t('archivo de ventas', 'sales file')}, {day(c.created_at, ctx.locale, market.timezone)}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card data-testid="deal-origin">
        <CardTitle title={t('De dónde vino', 'Where it came from')} hint={t('La atribución del lead viaja al negocio al convertir.', 'The lead’s attribution travels to the deal on conversion.')} />
        <TouchList ctx={ctx} touches={d.touches} tz={market.timezone} />
      </Card>
    </>
  )
}

/** En el comercio, pestaña Hilo: tickets de soporte como referencia y entrada al hilo completo (con sucursales). */
export async function AccountThreadPanel({ ctx, accountId, market, canWrite }: { ctx: Ctx; accountId: string; market: string; canWrite: boolean }) {
  const a = await accountEmbudo(ctx, accountId)
  const { t, locale } = ctx
  const desk = supportDeskAdapter()
  return (
    <section className="mt-8 border-t border-line pt-6" data-testid="account-thread-extras">
      <p className="mb-4"><Link href={`/comercios/${accountId}/hilo${a.children > 0 ? '?sucursales=1' : ''}`} className={buttonClass('ghost', 'sm')} data-testid="full-thread-link">
        {a.children > 0 ? t(`Ver hilo completo, con sus ${a.children} sucursales`, `See the full thread, with its ${a.children} branches`) : t('Ver hilo completo', 'See the full thread')}</Link></p>
      <h3 className="text-[15px] font-semibold text-strong">{t('Tickets de soporte', 'Support tickets')}</h3>
      <p className="mb-3 text-[13px] text-muted">{t('Se guarda la referencia (número y asunto), no el ticket. La conexión con la mesa de soporte está apagada: el estado es el que le pongas aquí.', 'The reference is stored (number and subject), not the ticket. The connection to the support desk is off: the status is whatever you set here.')}</p>
      {a.tickets.length === 0 ? <p className="text-[14px] text-muted" data-testid="tickets-empty">{t('Este comercio no tiene tickets ligados.', 'This merchant has no linked tickets.')}</p> : (
        <ul className="space-y-3" data-testid="tickets">
          {a.tickets.map((k) => {
            const url = desk.ticketUrl(k.system, k.external_ref)
            return (
              <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px]" data-testid="ticket">
                <span className="font-medium text-strong [overflow-wrap:anywhere]">{url ? <a href={url} className="underline" rel="noreferrer">{k.external_ref}</a> : k.external_ref} · {k.subject}</span>
                <Badge tone={k.status === 'solved' ? 'good' : k.status === 'open' ? 'warn' : 'neutral'}>{t(TICKET_STATUS_LABEL[k.status as 'open'].es, TICKET_STATUS_LABEL[k.status as 'open'].en)}</Badge>
                <span className="text-[13px] text-muted">{k.by ?? ''} · {day(k.created_at, locale, ctx.market(market).timezone)}</span>
                {canWrite && k.status !== 'solved' && (
                  <ActionForm action={setTicketStatusAction}><input type="hidden" name="ticket_id" value={k.id} /><input type="hidden" name="status" value="solved" /><Submit variant="ghost" size="sm" testId="ticket-solved">{t('Marcar resuelto', 'Mark solved')}</Submit></ActionForm>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canWrite && (
        <ActionForm action={addTicketAction} className="mt-4 grid gap-3 md:grid-cols-4" onOk="reset" testId="ticket-form">
          <input type="hidden" name="account_id" value={accountId} />
          <Field label={t('Sistema', 'System')}><select name="system" className="input" defaultValue="zendesk">{TICKET_SYSTEMS.map((s) => <option key={s} value={s}>{s === 'zendesk' ? 'Zendesk' : s === 'zoho' ? 'Zoho Desk' : t('Otro', 'Other')}</option>)}</select></Field>
          <Field label={t('Número del ticket', 'Ticket number')}><input name="ref" className="input" required maxLength={40} pattern="[A-Za-z0-9#_\-]{1,40}" data-testid="ticket-ref" /></Field>
          <Field label={t('De qué trata', 'What it is about')}><input name="subject" className="input" required minLength={2} maxLength={200} data-testid="ticket-subject" /></Field>
          <Field label={t('Estado', 'Status')}><select name="status" className="input" defaultValue="open">{TICKET_STATUS.map((s) => <option key={s} value={s}>{t(TICKET_STATUS_LABEL[s].es, TICKET_STATUS_LABEL[s].en)}</option>)}</select></Field>
          <div className="md:col-span-4 flex justify-end"><Submit variant="ghost" size="sm" testId="ticket-save">{t('Agregar ticket al hilo', 'Add ticket to the thread')}</Submit></div>
        </ActionForm>
      )}
    </section>
  )
}

/** En el comercio, pestaña Datos: hitos de venta, leads abiertos y pasados, y su enlace de referido con código QR. */
export async function AccountDataPanel({ ctx, accountId, market, canEdit }: { ctx: Ctx; accountId: string; market: string; canEdit: boolean }) {
  const a = await accountEmbudo(ctx, accountId)
  const { t, locale } = ctx
  const mk = ctx.market(market)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: mk.timezone }).format(new Date())
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const origin = host ? `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')}://${host}` : ''
  const link = a.referral ? `${origin}/r/${a.referral.code}` : null
  return (
    <div className="mt-8 space-y-8" data-testid="account-embudo">
      <section data-testid="account-milestones">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-strong">{t('Hitos de venta', 'Sales milestones')}</h3>
          {ctx.can('deal.correct_win', market) && <CorrectionDialog ctx={ctx} accountId={accountId} today={today} />}
        </div>
        <MilestoneList ctx={ctx} ms={a.milestones} cut={a.cut} tz={mk.timezone} />
        {a.events.filter((e) => e.action !== 'set').length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px] text-muted-2" data-testid="milestone-history">
            {a.events.filter((e) => e.action !== 'set').map((e, i) => <li key={i}>{t(MILESTONE_LABEL[e.kind as Milestone].es, MILESTONE_LABEL[e.kind as Milestone].en)}: {e.action === 'void' ? t('anulado', 'voided') : t('fecha corregida', 'date corrected')} · {e.reason} · {e.actor ?? t('archivo de ventas', 'sales file')}, {day(e.created_at, locale, mk.timezone)}</li>)}
          </ul>
        )}
      </section>

      <section data-testid="account-leads">
        <h3 className="mb-2 text-[15px] font-semibold text-strong">{t('Leads de este comercio', 'Leads for this merchant')}</h3>
        {a.leads.length === 0 ? <p className="text-[14px] text-muted" data-testid="account-leads-empty">{t('Ningún lead está ligado a este comercio. Un lead se puede ligar desde su pantalla, antes de convertirlo.', 'No lead is linked to this merchant. A lead can be linked from its own screen, before converting it.')}</p> : (
          <ul className="space-y-2">
            {a.leads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]" data-testid="account-lead">
                <Link href={`/leads/${l.id}`} className="font-medium text-blue-text underline">{l.business_name}</Link>
                <Badge tone={LEAD_STATUS[l.status]?.tone ?? 'neutral'}>{lab(t, LEAD_STATUS[l.status]?.label, l.status)}</Badge>
                <span className="text-[13px] text-muted">{lab(t, SOURCE[l.source], l.source)} · {day(l.created_at, locale, mk.timezone)}{l.owner ? ` · ${l.owner}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="account-referral">
        <h3 className="mb-1 text-[15px] font-semibold text-strong">{t('Enlace de referido', 'Referral link')}</h3>
        <p className="mb-3 text-[13px] text-muted">{t('El comercio comparte su enlace o su código QR. El lead que entra por ahí queda atribuido a este comercio. Cuenta el referido que llega a su primera venta.', 'The merchant shares its link or QR code. A lead that comes in that way is attributed to this merchant. What counts is the referral that reaches its first sale.')}</p>
        {a.referral && link ? (
          <div className="flex flex-wrap items-start gap-6">
            <div className="h-[168px] w-[168px] shrink-0 rounded-[12px] border border-line bg-white p-2" data-testid="referral-qr" dangerouslySetInnerHTML={{ __html: qrSvg(link, t('Código QR del enlace de referido', 'QR code of the referral link')) }} />
            <div className="min-w-0 space-y-1">
              <p className="text-[14px] text-strong">{t('Código', 'Code')}: <strong data-testid="referral-code">{a.referral.code}</strong> {!a.referral.is_active && <Badge tone="warn">{t('En pausa', 'Paused')}</Badge>}</p>
              <p className="text-[13.5px] [overflow-wrap:anywhere]" data-testid="referral-link">{link}</p>
              <p className="text-[13.5px] text-muted-2" data-testid="referral-counts">{t(`${a.referral.referred} referidos · ${a.referral.converted} convertidos · ${a.referral.first_sale} con primera venta`, `${a.referral.referred} referred · ${a.referral.converted} converted · ${a.referral.first_sale} with first sale`)}</p>
              {canEdit && <ActionForm action={referralCodeAction}><input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="op" value={a.referral.is_active ? 'off' : 'on'} />
                <Submit variant="ghost" size="sm" testId="referral-toggle">{a.referral.is_active ? t('Pausar enlace', 'Pause link') : t('Activar enlace', 'Turn link on')}</Submit></ActionForm>}
            </div>
          </div>
        ) : canEdit ? (
          <ActionForm action={referralCodeAction}><input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="op" value="create" /><Submit variant="ghost" size="sm" testId="referral-create">{t('Crear enlace de referido', 'Create referral link')}</Submit></ActionForm>
        ) : <p className="text-[14px] text-muted">{t('Este comercio todavía no tiene enlace de referido.', 'This merchant has no referral link yet.')}</p>}
      </section>
    </div>
  )
}

/** En el lead: atribución completa, quién lo refirió, a qué comercio está ligado, etiquetas y qué regla lo asignó. */
export async function LeadEmbudoPanel({ ctx, leadId, canWork, search }: { ctx: Ctx; leadId: string; canWork: boolean; search?: string }) {
  const l = await leadEmbudo(ctx, leadId)
  if (!l) return null
  const { t } = ctx
  const mk = ctx.market(l.market_code)
  const open = ['new', 'contacted', 'qualified'].includes(l.status)
  const choices = canWork && open && search ? await accountChoices(ctx, l.market_code, search) : []
  return (
    <>
      <Card data-testid="lead-touches">
        <CardTitle title={t('Atribución completa', 'Full attribution')} hint={t('Cada llegada queda como un toque. El primero nunca se pisa con el último.', 'Each arrival is stored as a touch. The first is never overwritten by the last.')} />
        {l.referred_by && <p className="mb-3 text-[14.5px] text-strong" data-testid="lead-referred-by">{t('Lo refirió: ', 'Referred by: ')}<Link href={`/comercios/${l.referred_by_id}`} className="text-blue-text underline">{l.referred_by}</Link></p>}
        <TouchList ctx={ctx} touches={l.touches} tz={mk.timezone} />
        {l.routed && <p className="mt-4 border-t border-line pt-3 text-[13.5px] text-muted-2" data-testid="lead-routed">{t('Asignación al entrar: ', 'Assignment on arrival: ')}
          {l.routed.rule_name ? t(`regla "${l.routed.rule_name}"`, `rule "${l.routed.rule_name}"`) : l.routed.action === 'form_rotation' ? t('turno del formulario', 'form rotation') : l.routed.action === 'market_lead' ? t('quien lidera el mercado, porque no había nadie más disponible', 'the market lead, because nobody else was available') : t('sin asignar', 'no owner')}
          {l.routed.owner ? ` · ${l.routed.owner}` : ''}</p>}
      </Card>
      <Card data-testid="lead-link">
        <CardTitle title={t('Comercio y etiquetas', 'Merchant and labels')} hint={t('Si este lead es de un comercio que ya existe, lígalo: al convertirlo el negocio entra en ese comercio y no nace otro.', 'If this lead belongs to a merchant that already exists, link it: when converted, the deal goes into that merchant and no new one is created.')} />
        {l.account_id ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="lead-linked">
            <p className="text-[14.5px] text-strong">{t('Ligado a: ', 'Linked to: ')}<Link href={`/comercios/${l.account_id}`} className="text-blue-text underline" data-testid="lead-linked-account">{l.account_name}</Link></p>
            {canWork && open && <ActionForm action={linkLeadAction}><input type="hidden" name="lead_id" value={leadId} /><input type="hidden" name="account_id" value="" /><Submit variant="ghost" size="sm" testId="lead-unlink">{t('Quitar', 'Remove')}</Submit></ActionForm>}
          </div>
        ) : canWork && open ? (
          <>
            <form method="get" action={`/leads/${leadId}`} className="flex flex-wrap items-end gap-3" data-testid="lead-link-search">
              <Field label={t('Buscar comercio por nombre', 'Find a merchant by name')}><input name="comercio" className="input" defaultValue={search ?? ''} minLength={2} maxLength={80} required data-testid="lead-link-q" /></Field>
              <button type="submit" className={buttonClass('ghost', 'md')} data-testid="lead-link-find">{t('Buscar', 'Search')}</button>
            </form>
            {search && choices.length === 0 && <p className="mt-3 text-[14px] text-muted" data-testid="lead-link-none">{t('No encontramos un comercio con ese nombre en este mercado.', 'We found no merchant with that name in this market.')}</p>}
            {choices.length > 0 && (
              <ul className="mt-3 space-y-2" data-testid="lead-link-choices">
                {choices.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 text-[14px]">
                    <span className="font-medium text-strong">{c.name}</span>{c.locality && <span className="text-muted">{c.locality}</span>}
                    <ActionForm action={linkLeadAction}><input type="hidden" name="lead_id" value={leadId} /><input type="hidden" name="account_id" value={c.id} /><Submit variant="ghost" size="sm" testId="lead-link-pick">{t('Ligar a este comercio', 'Link to this merchant')}</Submit></ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : <p className="text-[14px] text-muted">{t('No está ligado a un comercio existente.', 'It is not linked to an existing merchant.')}</p>}
        <ActionForm action={setLeadLabelsAction} className="mt-5 border-t border-line pt-4" testId="lead-labels-form">
          <input type="hidden" name="lead_id" value={leadId} />
          <fieldset disabled={!canWork}>
            <legend className="text-[13px] font-medium text-muted-2">{t('Etiquetas', 'Labels')}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {l.labelCatalog.map((b) => <label key={b.code} className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="labels" value={b.code} defaultChecked={l.labels.includes(b.code)} className="h-5 w-5" data-testid={`label-${b.code}`} />{t(b.label_es, b.label_en)}</label>)}
            </div>
          </fieldset>
          {canWork && <div className="mt-2 flex justify-end"><Submit variant="ghost" size="sm" testId="lead-labels-save">{t('Guardar etiquetas', 'Save labels')}</Submit></div>}
        </ActionForm>
      </Card>
    </>
  )
}
