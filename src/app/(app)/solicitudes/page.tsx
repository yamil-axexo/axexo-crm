import { requireCtx } from '@/server/context'
import { readerTimeZone } from '@/server/timezone'
import { maintenance, materials, myChampions, myConfigRequests, releases } from '@/dal/gobierno'
import { REQUEST_KINDS } from '@/domain/gobierno'
import { REQUEST_MUST_INCLUDE, WHO_DOES_WHAT } from '@/content/who-does-what'
import { Badge, Card, CardTitle, Empty, Field, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { day, dayTime } from '@/lib/format'
import { MATERIAL_LABEL, REQUEST_KIND_LABEL, REQUEST_STATUS_LABEL } from '@/lib/gobierno-labels'
import { createRequestAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Pedir un cambio (E7.F2, F3, F6, F9; GOB-04): quién hace qué, a quién preguntar primero, el formulario para pedir un campo
 * o un cambio con su porqué, mis solicitudes con su respuesta, el material de capacitación de mi mercado, lo que viene de
 * mantenimiento y las notas de las versiones. La abre cualquier persona con acceso.
 */
export default async function RequestsPage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const [mine, champs, mats, windows, rel, tz] = await Promise.all([myConfigRequests(ctx), myChampions(ctx), materials(ctx), maintenance(ctx, true), releases(ctx, 6), readerTimeZone(ctx)])
  const notes = rel.filter((r) => r.status !== 'draft')
  const canAsk = ctx.can('config.request')

  return (
    <div className="mx-auto max-w-[860px] space-y-8" data-testid="requests">
      <PageHeader title={t('Pedir un cambio', 'Request a change')}
        desc={t('Administración configura CONTIGO; tú lo usas y pides lo que te falta. Aquí está quién hace qué, cómo pedir un campo o un cambio y qué viene.', 'Administration configures CONTIGO; you use it and ask for what is missing. Here is who does what, how to ask for a field or a change, and what is coming.')} />

      <Card data-testid="who-does-what">
        <CardTitle title={t('Quién hace qué', 'Who does what')} hint={t('Para saber a quién pedirle cada cosa.', 'So you know who to ask for each thing.')} />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 desk:grid-cols-3">
          {WHO_DOES_WHAT.map((g) => (
            <section key={g.who[1]}>
              <h3 className="text-[14px] font-semibold text-strong">{t(...g.who)}</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13.5px] text-muted-2">{g.items.map((i) => <li key={i[1]}>{t(...i)}</li>)}</ul>
            </section>
          ))}
        </div>
        {champs.length > 0 && (
          <ul className="mt-6 border-t border-line pt-4" data-testid="my-champions">
            {champs.map((c) => (
              <li key={c.team} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[14px]" data-testid="my-champion">
                <span className="text-muted-2">{t(`Champion de ${c.team}`, `Champion of ${c.team}`)}</span>
                <span className="font-semibold text-strong">{c.champion ?? t('Todavía no se nombra', 'Not named yet')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canAsk && (
        <Card data-testid="request-new">
          <CardTitle title={t('Pide un campo o un cambio', 'Ask for a field or a change')} hint={t('Si algo falla, usa "Reportar un problema". Esto es para lo que falta en la configuración.', 'If something is broken, use "Report a problem". This is for what is missing in the configuration.')} />
          <ul className="mb-5 list-disc space-y-1 rounded-[14px] bg-surface-2 px-5 py-4 pl-9 text-[13.5px] text-muted-2" data-testid="request-must">
            {REQUEST_MUST_INCLUDE.map((i) => <li key={i[1]}>{t(...i)}</li>)}
          </ul>
          <ActionForm action={createRequestAction} onOk="reset" className="grid grid-cols-2 gap-4" testId="request-form">
            <Field label={t('Qué pides', 'What you are asking for')} className="col-span-2 sm:col-span-1">
              <select name="kind" className="input" data-testid="request-kind">{REQUEST_KINDS.map((k) => <option key={k} value={k}>{t(...REQUEST_KIND_LABEL[k]!)}</option>)}</select>
            </Field>
            <Field label={t('Para qué mercado', 'For which market')} className="col-span-2 sm:col-span-1">
              <select name="market" className="input" defaultValue="" data-testid="request-market">
                <option value="">{t('Todos (compartido)', 'All (shared)')}</option>
                {ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
            </Field>
            <Field label={t('En una línea', 'In one line')} className="col-span-2"><input name="title" className="input" required minLength={3} maxLength={120} data-testid="request-title" /></Field>
            <Field label={t('¿Para qué sirve?', 'What is it for?')} hint={t('Qué decisión o qué trabajo cambia si existe. Sin tarjetas, cuentas bancarias ni contraseñas.', 'Which decision or which work changes if it exists. No cards, bank accounts or passwords.')} className="col-span-2">
              <textarea name="purpose" className="input min-h-[104px] py-3" required minLength={10} maxLength={1000} data-testid="request-purpose" />
            </Field>
            <Field label={t('Opciones, una por renglón (si es una lista)', 'Options, one per line (if it is a list)')} className="col-span-2"><textarea name="options" rows={3} className="input !h-auto py-3" maxLength={1000} data-testid="request-options" /></Field>
            <div className="col-span-2 flex justify-end"><Submit testId="request-send">{t('Enviar solicitud', 'Send request')}</Submit></div>
          </ActionForm>
        </Card>
      )}

      <Card data-testid="request-mine">
        <CardTitle title={t('Tus solicitudes', 'Your requests')} hint={t('Las ves tú y administración. La decisión aparece aquí.', 'You and administration see them. The decision shows up here.')} />
        {mine.length === 0 ? (
          <Empty title={t('Todavía no has pedido nada', 'You have not asked for anything yet')} hint={t('Cuando mandes una solicitud, queda aquí con su respuesta.', 'When you send a request, it stays here with its answer.')} />
        ) : (
          <ul>
            {mine.map((r) => (
              <li key={r.id} className="border-t border-line py-4 first:border-t-0 first:pt-0" data-testid="request-row" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === 'open' ? 'warn' : r.status === 'rejected' ? 'bad' : 'good'}>{t(...REQUEST_STATUS_LABEL[r.status]!)}</Badge>
                  <span className="text-[13px] text-muted">{t(...REQUEST_KIND_LABEL[r.kind]!)} · {r.market_code ?? t('Compartido', 'Shared')} · {dayTime(r.created_at, locale, tz)}</span>
                </div>
                <p className="mt-2 text-[15px] font-semibold text-strong">{r.title}</p>
                <p className="mt-1 text-[14px] whitespace-pre-wrap text-strong">{r.purpose}</p>
                {r.decision_note && <p className="mt-2 rounded-[14px] bg-green-50 px-4 py-3 text-[14px] text-strong" data-testid="request-answer">{t(`Respuesta de ${r.decided_by_name ?? 'administración'}: `, `Answer from ${r.decided_by_name ?? 'administration'}: `)}{r.decision_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="my-materials">
        <CardTitle title={t('Material de capacitación de tu mercado', 'Your market’s training material')} hint={t('Presentación de inicio, guía de leads y preguntas frecuentes. Se abren fuera de CONTIGO.', 'Onboarding deck, lead guide and FAQ. They open outside CONTIGO.')} />
        {mats.length === 0 ? (
          <Empty title={t('Todavía no hay material cargado para tu mercado', 'No material has been loaded for your market yet')} hint={t('Mientras tanto, los primeros pasos y la ayuda están dentro de CONTIGO, en el menú de tu cuenta.', 'Meanwhile, the first steps and the help are inside CONTIGO, in your account menu.')} />
        ) : (
          <ul>
            {mats.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="my-material">
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-blue-text underline [overflow-wrap:anywhere]">{m.title}</a>
                <span className="text-[13px] text-muted-2">{t(...MATERIAL_LABEL[m.kind]!)} · {m.market_code} · {m.locale.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="my-maintenance">
        <CardTitle title={t('Mantenimiento que viene', 'Upcoming maintenance')} hint={t('Ventanas en las que CONTIGO puede estar lento o fuera.', 'Windows when CONTIGO may be slow or down.')} />
        {windows.length === 0 ? (
          <Empty title={t('Nada agendado', 'Nothing scheduled')} hint={t('Cuando haya un mantenimiento planeado, aparece aquí antes de que pase.', 'When maintenance is planned, it shows here before it happens.')} />
        ) : (
          <ul>
            {windows.map((w) => (
              <li key={w.id} className="border-t border-line py-3 text-[14px] first:border-t-0" data-testid="my-maintenance-row">
                <span className="block font-semibold text-strong">{w.title}</span>
                <span className="block text-[13px] text-muted-2">{dayTime(w.starts_at, locale, tz)} {t('a', 'to')} {dayTime(w.ends_at, locale, tz)}</span>
                <span className="text-[13px] text-muted-2">{w.impact}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="release-notes">
        <CardTitle title={t('Notas de versión', 'Release notes')} hint={t('Qué cambió o va a cambiar en CONTIGO. Una versión se anuncia aquí antes de salir.', 'What changed or is about to change in CONTIGO. A release is announced here before it goes out.')} />
        {notes.length === 0 ? (
          <Empty title={t('Todavía no hay notas de versión', 'No release notes yet')} hint={t('Cuando se anuncie una versión, sus notas quedan aquí.', 'When a release is announced, its notes stay here.')} />
        ) : (
          <ul>
            {notes.map((r) => (
              <li key={r.id} className="border-t border-line py-4 first:border-t-0 first:pt-0" data-testid="release-note" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === 'released' ? 'good' : 'info'}>{r.status === 'released' ? t('Ya salió', 'Already out') : t('Viene', 'Coming')}</Badge>
                  {r.touches_money && <Badge tone="warn">{t('Toca comisiones o alta', 'Touches commissions or enrollment')}</Badge>}
                  <span className="text-[15px] font-semibold text-strong">{r.version} · {t(r.title_es, r.title_en)}</span>
                </div>
                {r.planned_for && r.status !== 'released' && <p className="mt-1 text-[13px] text-muted-2">{t(`Vale desde el ${day(r.planned_for, locale)}`, `Takes effect on ${day(r.planned_for, locale)}`)}</p>}
                <p className="mt-2 text-[14px] leading-6 whitespace-pre-wrap text-strong">{t(r.notes_es, r.notes_en)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
