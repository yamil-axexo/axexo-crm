import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { helpLessons, marketComms, outsideQueue, templates } from '@/dal/notices'
import { channelStatus } from '@/server/adapters/channels'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { CHANNEL_LABEL, DELIVERY_STATUS, TEMPLATE_INFO, TEMPLATE_VARS, isPendingText, renderTemplate, type Channel, type TemplateVars } from '@/lib/notice-kinds'
import { dayTime } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'
import { SCREEN_HELP } from '@/content/screen-help'
import { saveCommsAction, saveLessonAction, saveTemplateAction } from '@/app/(app)/avisos/actions'

export const dynamic = 'force-dynamic'

const SECTIONS = ['canales', 'cola', 'plantillas', 'mercados', 'lecciones'] as const
type Section = (typeof SECTIONS)[number]

/** Administración de avisos: canales y su estado, la cola de salida, plantillas, configuración por mercado y lecciones por pantalla. */
export default async function NoticeAdminPage({ searchParams }: { searchParams: Promise<{ ver?: string; canal?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('config.manage')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const section: Section = SECTIONS.includes(sp.ver as Section) ? (sp.ver as Section) : 'canales'
  const tz = await readerTimeZone(ctx)
  const labels: Record<Section, string> = {
    canales: t('Canales', 'Channels'), cola: t('Cola de salida', 'Outgoing queue'), plantillas: t('Plantillas', 'Templates'),
    mercados: t('Por mercado', 'Per market'), lecciones: t('Lecciones por pantalla', 'Lessons per screen'),
  }
  // Datos de ejemplo para la vista previa: genéricos, no son de ningún comercio real.
  const sample: TemplateVars = {
    comercio: t('Tienda Ejemplo', 'Sample Store'), contacto: t('Persona de ejemplo', 'Sample person'), negocio: t('Alta de Tienda Ejemplo', 'Sample Store sign-up'),
    quien: ctx.user.name, mercado: ctx.markets[0]?.name ?? 's/d', fecha: dayTime(new Date(), locale, tz), detalle: t('Detalle de ejemplo', 'Sample detail'),
    enlace: '/deals/…', titulo: t('Título de ejemplo', 'Sample title'), texto: t('Texto de ejemplo', 'Sample text'),
  }
  return (
    <>
      <p className="mb-3"><Link href="/admin" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="notice-admin-back">{t('Volver a Administración', 'Back to Administration')}</Link></p>
      <PageHeader eyebrow={t('Administración', 'Administration')} title={t('Avisos y plantillas', 'Notices and templates')}
        desc={t('Por dónde avisa CONTIGO, qué está esperando salir y con qué texto. Todo cambio queda en la bitácora.', 'Where CONTIGO sends notices, what is waiting to go out and with which text. Every change is logged.')} />
      <div className="mb-8"><Pills label={t('Secciones', 'Sections')} current={section} items={SECTIONS.map((k) => ({ key: k, href: qs('/admin/avisos', { ver: k }), label: labels[k] }))} /></div>
      {section === 'canales' && <Channels />}
      {section === 'cola' && <Queue />}
      {section === 'plantillas' && <Templates />}
      {section === 'mercados' && <Markets />}
      {section === 'lecciones' && <Lessons />}
    </>
  )

  async function Channels() {
    const { counts } = await outsideQueue(ctx, null)
    const n = (channel: string, status: string) => counts.find((c) => c.channel === channel && c.status === status)?.n ?? 0
    return (
      <Card pad={false} data-testid="channels">
        <div className="px-5 pt-6 md:px-7"><CardTitle title={t('Canales', 'Channels')} hint={t('Dentro de CONTIGO siempre está encendido. Los canales de afuera están construidos y apagados: se encienden después de la revisión de tecnología.', 'Inside CONTIGO is always on. The outside channels are built and turned off: they are turned on after the technology review.')} /></div>
        <ul className="divide-y divide-line border-t border-line">
          <li className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-[160px_180px_1fr] md:items-center md:px-7" data-testid="channel-in_app">
            <span className="text-[15px] font-semibold text-strong">{t(...CHANNEL_LABEL.in_app)}</span>
            <span><Badge tone="good">{t('Encendido', 'On')}</Badge></span>
            <span className="text-[13.5px] text-muted-2">{t(`${n('in_app', 'delivered')} avisos entregados: campana, centro de avisos y Hoy.`, `${n('in_app', 'delivered')} notices delivered: bell, notice center and Today.`)}</span>
          </li>
          {channelStatus().map((c) => (
            <li key={c.channel} className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-[160px_180px_1fr] md:items-center md:px-7" data-testid={`channel-${c.channel}`}>
              <span className="text-[15px] font-semibold text-strong">{t(...CHANNEL_LABEL[c.channel])}</span>
              <span><Badge tone={c.mode === 'off' ? 'neutral' : 'warn'}>{c.mode === 'off' ? t('Canal apagado', 'Channel off') : t('Simulado (pruebas)', 'Simulated (tests)')}</Badge></span>
              <span className="text-[13.5px] text-muted-2">
                {t(`${n(c.channel, 'queued_off')} listos para enviar.`, `${n(c.channel, 'queued_off')} ready to send.`)} {t(...c.needs)}{' '}
                <Link href={qs('/admin/avisos', { ver: 'cola', canal: c.channel })} className="font-medium text-blue-text underline">{t('Ver su cola', 'See its queue')}</Link>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  async function Queue() {
    const channel = ['email', 'slack', 'whatsapp'].includes(sp.canal ?? '') ? sp.canal! : null
    const { rows } = await outsideQueue(ctx, channel)
    return (
      <div data-testid="outside-queue">
        <div className="mb-4"><Pills label={t('Canal', 'Channel')} current={channel ?? ''} items={[
          { key: '', href: qs('/admin/avisos', { ver: 'cola' }), label: t('Todos', 'All') },
          ...(['email', 'slack', 'whatsapp'] as Channel[]).map((c) => ({ key: c as string, href: qs('/admin/avisos', { ver: 'cola', canal: c }), label: t(...CHANNEL_LABEL[c]) })),
        ]} /></div>
        {rows.length === 0 ? (
          <Empty title={t('No hay nada en la cola', 'Nothing in the queue')} hint={t('Cuando un aviso tenga que salir por correo, Slack o WhatsApp, aparece aquí con su estado. Con el canal apagado no sale nada.', 'When a notice has to go out by email, Slack or WhatsApp, it shows here with its status. With the channel off nothing is sent.')} />
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3.5 md:px-6" data-testid="queue-row" data-status={r.status}>
                <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-2">
                  <Badge tone={r.status === 'queued_off' ? 'warn' : r.status === 'simulated' ? 'good' : 'neutral'}>{t(...(DELIVERY_STATUS[r.status] ?? [r.status, r.status]))}</Badge>
                  <span>{t(...CHANNEL_LABEL[r.channel as Channel])}{r.market_code ? ` · ${r.market_code}` : ''} · {dayTime(r.created_at, locale, tz)}</span>
                  {r.release_at && <span>{t(`sale el ${dayTime(r.release_at, locale, tz)}`, `goes out ${dayTime(r.release_at, locale, tz)}`)}</span>}
                </p>
                <p className="mt-1 text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{r.subject}</p>
                <p className="text-[13.5px] text-muted-2 [overflow-wrap:anywhere]">
                  {t('Para', 'To')}: {r.recipient_kind === 'lead' ? t('un lead', 'a lead') : r.recipient_kind === 'mailbox' ? t('buzón', 'mailbox') : (r.recipient_name ?? 's/d')}
                  {r.recipient_address ? ` (${r.recipient_address})` : ''}
                  {r.template_key ? ` · ${t('plantilla', 'template')}: ${TEMPLATE_INFO[r.template_key] ? t(...TEMPLATE_INFO[r.template_key]!.name) : r.template_key}, ${t('versión', 'version')} ${r.template_version}` : ''}
                  {' · '}{t('costo', 'cost')}: {r.cost ? `${r.cost} ${r.cost_currency ?? ''}` : t('n/a', 'n/a')}
                </p>
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13.5px] font-medium text-blue-text underline">{t('Ver el texto', 'See the text')}</summary>
                  <p className="rounded-[10px] bg-surface-3 px-4 py-3 text-[13.5px] whitespace-pre-wrap text-strong [overflow-wrap:anywhere]">{r.body}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  async function Templates() {
    const list = await templates(ctx)
    return (
      <div className="space-y-6" data-testid="templates">
        <p className="rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong">
          {t('Variables que puedes usar', 'Variables you can use')}: {TEMPLATE_VARS.map((v) => `{{${v}}}`).join(' ')}
        </p>
        {list.map((tpl) => {
          const info = TEMPLATE_INFO[tpl.key]
          const pending = isPendingText(tpl.body_es) || isPendingText(tpl.subject_es)
          return (
            <Card key={tpl.id} data-testid={`template-${tpl.key}`}>
              <CardTitle title={`${info ? t(...info.name) : tpl.key}${tpl.market_code ? ` · ${tpl.market_code}` : ''}`}
                hint={info ? `${t('Va', 'Goes')}: ${t(...info.to).toLowerCase()}. ${t('Sale', 'Sent')}: ${t(...info.when).toLowerCase()}.` : undefined}
                right={<Badge tone={pending ? 'warn' : tpl.is_active ? 'good' : 'neutral'}>{pending ? t('Falta el texto', 'Text missing') : tpl.is_active ? t(`Versión ${tpl.version}`, `Version ${tpl.version}`) : t('Apagada', 'Off')}</Badge>} />
              <p className="mb-3 text-[12.5px] text-muted-2">
                {t(`Versión ${tpl.version} de ${tpl.versions}`, `Version ${tpl.version} of ${tpl.versions}`)}{tpl.by_name ? ` · ${tpl.by_name}` : ''} · {dayTime(tpl.created_at, locale, tz)}
                {pending ? ` · ${t('Mientras falte el texto, este mensaje no entra a la cola de salida.', 'While the text is missing, this message does not enter the outgoing queue.')}` : ''}
              </p>
              <ActionForm action={saveTemplateAction}>
                <input type="hidden" name="key" value={tpl.key} /><input type="hidden" name="market" value={tpl.market_code ?? ''} />
                <div className="grid grid-cols-1 gap-4 desk:grid-cols-2">
                  <div className="space-y-3">
                    <Field label={t('Asunto en español', 'Subject in Spanish')}><input name="subject_es" defaultValue={tpl.subject_es} maxLength={200} className="input" data-testid="tpl-subject-es" /></Field>
                    <Field label={t('Texto en español', 'Text in Spanish')}><textarea name="body_es" defaultValue={tpl.body_es} rows={6} maxLength={4000} className="input" data-testid="tpl-body-es" /></Field>
                  </div>
                  <div className="space-y-3">
                    <Field label={t('Asunto en inglés', 'Subject in English')}><input name="subject_en" defaultValue={tpl.subject_en} maxLength={200} className="input" data-testid="tpl-subject-en" /></Field>
                    <Field label={t('Texto en inglés', 'Text in English')}><textarea name="body_en" defaultValue={tpl.body_en} rows={6} maxLength={4000} className="input" data-testid="tpl-body-en" /></Field>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1">
                  <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="active" defaultChecked={tpl.is_active} className="h-5 w-5" />{t('Plantilla encendida', 'Template on')}</label>
                  {tpl.recipient === 'lead' && <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="needs_consent" defaultChecked={tpl.needs_consent} className="h-5 w-5" />{t('Solo a leads que aceptaron recibir correos', 'Only to leads who agreed to receive emails')}</label>}
                  <span className="ml-auto"><Submit variant="ghost" size="sm" testId="tpl-save">{t('Guardar versión nueva', 'Save new version')}</Submit></span>
                </div>
              </ActionForm>
              <details className="mt-2" data-testid="tpl-preview">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13.5px] font-medium text-blue-text underline">{t('Vista previa con datos de ejemplo', 'Preview with sample data')}</summary>
                <div className="rounded-[10px] bg-surface-3 px-4 py-3 text-[13.5px] text-strong [overflow-wrap:anywhere]">
                  <p className="font-semibold">{renderTemplate(locale === 'en' ? tpl.subject_en : tpl.subject_es, sample)}</p>
                  <p className="mt-1 whitespace-pre-wrap">{renderTemplate(locale === 'en' ? tpl.body_en : tpl.body_es, sample)}</p>
                </div>
              </details>
            </Card>
          )
        })}
      </div>
    )
  }

  async function Markets() {
    const list = await marketComms(ctx)
    const v = (x: string | number | null) => (x === null ? '' : String(x))
    return (
      <div className="space-y-6" data-testid="market-comms">
        {list.map((c) => (
          <Card key={c.market_code} data-testid={`comms-${c.market_code}`}>
            <CardTitle title={ctx.market(c.market_code).name} hint={t('Lo que no se ha definido se deja vacío: CONTIGO no pone un valor por su cuenta.', 'Leave empty what has not been defined: CONTIGO does not fill in a value on its own.')} />
            <ActionForm action={saveCommsAction}>
              <input type="hidden" name="market" value={c.market_code} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label={t('Buzón de pedidos de Operaciones', 'Operations order mailbox')} hint={t('A dónde iría el correo de cada pedido enviado.', 'Where the email for each sent order would go.')}><input name="orders_mailbox" type="email" defaultValue={v(c.orders_mailbox)} className="input" data-testid="comms-mailbox" /></Field>
                <Field label={t('Dirección de salida de los correos', 'Sender address for emails')}><input name="sender_address" type="email" defaultValue={v(c.sender_address)} className="input" /></Field>
                <Field label={t('Video de recorrido del portal', 'Portal walkthrough video')} hint={t('Enlace que se comparte al agendar la capacitación de un dealer.', 'Link shared when a dealer’s training is scheduled.')}><input name="walkthrough_url" type="url" defaultValue={v(c.walkthrough_url)} className="input" data-testid="comms-video" /></Field>
                <Field label={t('WhatsApp de soporte', 'Support WhatsApp')} hint={t('Con + y código de país. El canal sigue apagado hasta su aprobación.', 'With + and country code. The channel stays off until it is approved.')}><input name="support_whatsapp" defaultValue={v(c.support_whatsapp)} className="input" /></Field>
                <Field label={t('Límite diario de mensajes de WhatsApp', 'Daily WhatsApp message limit')} hint={t('El límite de Meta se comparte entre todos los números de la empresa.', 'Meta’s limit is shared across all the company’s numbers.')}><input name="whatsapp_daily_limit" inputMode="numeric" defaultValue={v(c.whatsapp_daily_limit)} className="input" /></Field>
                <Field label={t('Costo por correo', 'Cost per email')} hint={t('En la moneda del mercado.', 'In the market’s currency.')}><input name="email_unit_cost" inputMode="decimal" defaultValue={v(c.email_unit_cost)} className="input" /></Field>
                <Field label={t('Costo por mensaje de WhatsApp', 'Cost per WhatsApp message')}><input name="whatsapp_unit_cost" inputMode="decimal" defaultValue={v(c.whatsapp_unit_cost)} className="input" /></Field>
              </div>
              <fieldset className="mt-4">
                <legend className="text-[13px] font-semibold text-muted-2">{t('Plazo para responder un reporte, en horas, según su urgencia', 'Hours to answer a report, by urgency')}</legend>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <Field label={t('Alta', 'High')}><input name="support_hours_high" inputMode="numeric" defaultValue={v(c.support_hours_high)} className="input" data-testid="comms-hours-high" /></Field>
                  <Field label={t('Normal', 'Normal')}><input name="support_hours_normal" inputMode="numeric" defaultValue={v(c.support_hours_normal)} className="input" /></Field>
                  <Field label={t('Baja', 'Low')}><input name="support_hours_low" inputMode="numeric" defaultValue={v(c.support_hours_low)} className="input" /></Field>
                </div>
              </fieldset>
              <div className="mt-4 flex justify-end"><Submit variant="ghost" size="sm" testId="comms-save">{t('Guardar', 'Save')}</Submit></div>
            </ActionForm>
          </Card>
        ))}
      </div>
    )
  }

  async function Lessons() {
    const lessons = await helpLessons(ctx)
    return (
      <Card data-testid="lessons">
        <CardTitle title={t('Lección de Kore Academy por pantalla', 'Kore Academy lesson per screen')} hint={t('Si una pantalla tiene lección, "¿Cómo se usa esto?" la ofrece junto a las preguntas. Sin enlace no se muestra nada.', 'If a screen has a lesson, "How do I use this?" offers it next to the questions. With no link nothing is shown.')} />
        <ul className="divide-y divide-line">
          {SCREEN_HELP.map((s) => (
            <li key={s.prefix} className="py-3" data-testid="lesson-row">
              <ActionForm action={saveLessonAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="screen" value={s.prefix} />
                <Field label={t(s.name[0], s.name[1])} className="min-w-[240px] flex-1"><input name="url" type="url" placeholder="https://" defaultValue={lessons[s.prefix] ?? ''} className="input" data-testid="lesson-url" /></Field>
                <Submit variant="ghost" size="sm" testId="lesson-save">{t('Guardar', 'Save')}</Submit>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
    )
  }
}
