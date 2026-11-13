import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { accountComms } from '@/dal/partners'
import { COMM_CHANNELS, COMM_LABEL, DIRECTION_LABEL } from '@/domain/comms'
import { readerTimeZone } from '@/server/timezone'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import * as A from '@/app/(app)/partners/actions'

export const dynamic = 'force-dynamic'

const row = 'border-t border-line py-4 first:border-t-0'
const small = 'text-[13px] text-muted'

/** ACT-03: correos, reuniones y mensajes registrados en el hilo, con la ventana de 24 horas de WhatsApp a la vista. */
export default async function CommsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await accountComms(ctx, id)
  if (!d) notFound()
  const tz = await readerTimeZone(ctx)
  const a = d.account
  const can = ctx.can('activity.write', a.market_code) && !ctx.viewAs
  const w = d.window
  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <PageHeader
        eyebrow={a.name}
        title={t('Correos, reuniones y mensajes', 'Emails, meetings and messages')}
        desc={t('Lo que se habla fuera de CONTIGO queda en el hilo de la cuenta. Por ahora se registra a mano; la captura automática de Gmail, Calendar y WhatsApp está apagada.', 'What is discussed outside CONTIGO goes into the account thread. For now it is logged by hand; automatic capture from Gmail, Calendar and WhatsApp is off.')}
        actions={<LinkButton href={`/comercios/${id}`} testId="comms-back">{t('Ir al hilo', 'Go to the thread')}</LinkButton>}
      />

      <Card data-testid="wa-window">
        <CardTitle
          title={t('Ventana de 24 horas de WhatsApp', 'WhatsApp 24-hour window')}
          hint={t('WhatsApp Business deja escribir libre solo dentro de las 24 horas desde el último mensaje del cliente. Fuera de la ventana, solo con plantilla aprobada.', 'WhatsApp Business only allows free-form messages within 24 hours of the client’s last message. Outside the window, only with an approved template.')}
          right={w.open ? <Badge tone="good">{t('Abierta', 'Open')}</Badge> : <Badge tone="neutral">{t('Cerrada', 'Closed')}</Badge>}
        />
        <p className="text-[14px] text-strong" data-testid="wa-window-text">
          {w.open && w.until
            ? t(`Abierta hasta ${dayTime(w.until, locale, tz)}.`, `Open until ${dayTime(w.until, locale, tz)}.`)
            : w.lastInbound
              ? t(`Cerrada: el último mensaje del cliente fue el ${dayTime(w.lastInbound, locale, tz)}.`, `Closed: the client’s last message was on ${dayTime(w.lastInbound, locale, tz)}.`)
              : t('Cerrada: no hay mensajes del cliente registrados.', 'Closed: no client messages logged.')}
        </p>
        {d.phone && <p className={small}>{t('Teléfono de la cuenta', 'Account phone')}: {d.phone}</p>}
      </Card>

      {can && (
        <Card data-testid="comm-new">
          <CardTitle title={t('Registrar', 'Log')} hint={t('No pegues datos de tarjetas, cuentas bancarias ni identificaciones: el texto se revisa al guardar.', 'Do not paste card, bank account or ID numbers: the text is checked when saving.')} />
          <ActionForm action={A.captureCommAction} onOk="reset" testId="comm-form">
            <input type="hidden" name="account_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Tipo', 'Type')}>
                <select name="channel" className="input" defaultValue="email" data-testid="comm-channel">
                  {COMM_CHANNELS.map((c) => <option key={c} value={c}>{t(...COMM_LABEL[c])}</option>)}
                </select>
              </Field>
              <Field label={t('Quién lo mandó (WhatsApp)', 'Who sent it (WhatsApp)')} hint={t('Para correo y reunión es opcional.', 'Optional for email and meeting.')}>
                <select name="direction" className="input" defaultValue="" data-testid="comm-direction">
                  <option value="">{t('Sin decir', 'Not set')}</option>
                  <option value="inbound">{t(...DIRECTION_LABEL.inbound)}</option>
                  <option value="outbound">{t(...DIRECTION_LABEL.outbound)}</option>
                </select>
              </Field>
              <Field label={t('Asunto', 'Subject')} className="sm:col-span-2"><input name="subject" className="input" required minLength={2} maxLength={200} data-testid="comm-subject" /></Field>
              <Field label={t('Participantes', 'Participants')} hint={t('Separados por coma.', 'Comma separated.')} className="sm:col-span-2"><input name="participants" className="input" maxLength={1000} data-testid="comm-participants" /></Field>
              <Field label={t('Resumen', 'Summary')} className="sm:col-span-2"><textarea name="summary" className="input min-h-24" maxLength={4000} data-testid="comm-summary" /></Field>
              <Field label={t('Cuándo (vacío: ahora)', 'When (empty: now)')}><input name="at" type="datetime-local" className="input" data-testid="comm-at" /></Field>
              <Field label={t('Duración en minutos (reunión)', 'Duration in minutes (meeting)')}><input name="minutes" type="number" min={0} max={600} className="input" /></Field>
            </div>
            <div className="mt-5"><Submit testId="comm-save">{t('Guardar en el hilo', 'Save to the thread')}</Submit></div>
          </ActionForm>
        </Card>
      )}

      <Card data-testid="comm-list-card">
        <CardTitle title={t('Registradas', 'Logged')} />
        {d.comms.length === 0 ? (
          <Empty title={t('Nada registrado todavía', 'Nothing logged yet')} hint={t('Cuando hables con la cuenta por correo, en una reunión o por WhatsApp, déjalo aquí: así el equipo ve el contexto completo.', 'When you talk to the account by email, in a meeting or on WhatsApp, log it here: the team then sees the full context.')} />
        ) : (
          <ul data-testid="comm-list">
            {d.comms.map((c) => (
              <li key={c.id} className={row} data-testid="comm-row">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-strong">
                  <Badge tone="neutral">{t(...COMM_LABEL[c.channel])}</Badge>{c.subject}
                </p>
                <p className={small}>
                  {dayTime(c.occurred_at, locale, tz)}
                  {c.direction ? ` · ${t(...DIRECTION_LABEL[c.direction as 'inbound'])}` : ''}
                  {c.participants.length ? ` · ${c.participants.join(', ')}` : ''}
                  {c.by ? ` · ${t('registró', 'logged by')} ${c.by}` : ''}
                </p>
                {c.body && <p className="mt-1 text-[14px] whitespace-pre-line text-strong">{c.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
