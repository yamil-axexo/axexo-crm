import { requireCtx } from '@/server/context'
import { audienceOf, liveAnnouncements, publishedBy, teamsFor, type Announcement } from '@/dal/announcements'
import { ACK_TOPICS, MAX_DAYS, TOPICS, TOPIC_LABEL, type Topic } from '@/domain/announcements'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { addDays, day, dayTime, isoDay } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { markAnnouncementAction, publishAnnouncementAction, withdrawAnnouncementAction } from './actions'

export const dynamic = 'force-dynamic'

/** Anuncios: lo que la red tiene que saber (cambios de reglas, comisiones, caídas, novedades), con lectura y acuse. */
export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ ver?: string; anuncio?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const canPublish = ctx.can('announcement.publish')
  const view = canPublish && sp.ver === 'publicados' ? 'published' : 'mine'
  const tz = ctx.markets[0]?.timezone ?? 'UTC'
  const today = isoDay(new Date(), tz)
  // El texto en el idioma de quien lee, si quien publicó lo escribió en los dos.
  const text = (a: Announcement) => (a.locale === locale || !a.title_other || !a.body_other ? { title: a.title, body: a.body } : { title: a.title_other, body: a.body_other })
  const topic = (k: string) => t(...(TOPIC_LABEL[k as Topic] ?? TOPIC_LABEL.general))
  const audience = (a: Announcement) => [a.market_code ? ctx.markets.find((m) => m.code === a.market_code)?.name ?? a.market_code : t('Todos los mercados', 'All markets'), a.team_name, a.role ? t(ROLE_LABEL[a.role as Role].es, ROLE_LABEL[a.role as Role].en) : null].filter(Boolean).join(' · ')

  return (
    <div data-testid="announcements">
      <PageHeader title={t('Anuncios', 'Announcements')} desc={t('Cambios de reglas, comisiones, caídas y novedades, antes de que pasen. Algunos piden que confirmes que te enteraste.', 'Rule changes, commissions, outages and news, before they happen. Some ask you to confirm you have seen them.')} />
      {canPublish && (
        <div className="mb-6"><Pills label={t('Ver', 'View')} current={view} items={[
          { key: 'mine', href: '/anuncios', label: t('Para mí', 'For me') },
          { key: 'published', href: qs('/anuncios', { ver: 'publicados' }), label: t('Publicar y ver acuses', 'Publish and see acknowledgments') },
        ]} /></div>
      )}
      {view === 'mine' ? <Mine /> : <Published />}
    </div>
  )

  async function Mine() {
    const rows = await liveAnnouncements(ctx)
    if (rows.length === 0)
      return <Empty title={t('No hay anuncios vigentes para ti', 'There are no current announcements for you')} hint={t('Cuando administración o quien lidera tu equipo publique uno, lo ves aquí y al entrar a CONTIGO.', 'When administration or your team lead publishes one, you see it here and when you open CONTIGO.')} />
    return (
      <ul className="space-y-4" data-testid="announcement-list">
        {rows.map((a) => {
          const x = text(a)
          const pendingAck = a.requires_ack && !a.ack_at
          return (
            <li key={a.id} id={a.id} className="card scroll-mt-24 p-5 md:p-6" data-testid="announcement" data-state={pendingAck ? 'ack-pending' : a.read_at ? 'read' : 'unread'}>
              <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-2">
                <Badge tone={ACK_TOPICS.includes(a.topic as Topic) ? 'warn' : 'neutral'}>{topic(a.topic)}</Badge>
                <span>{a.author} · {dayTime(a.starts_at, locale, tz)}{a.version > 1 ? ` · ${t(`versión ${a.version}`, `version ${a.version}`)}` : ''}</span>
              </p>
              <h2 className="mt-2 text-[18px] leading-[26px] font-semibold text-strong [overflow-wrap:anywhere]">{x.title}</h2>
              <p className="mt-1 text-[14.5px] leading-6 whitespace-pre-line text-strong [overflow-wrap:anywhere]">{x.body}</p>
              {a.effective_on && <p className="mt-2 text-[13.5px] font-medium text-strong" data-testid="announcement-effective">{t(`Vale desde el ${day(a.effective_on, locale)}.`, `Applies from ${day(a.effective_on, locale)}.`)}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {pendingAck ? (
                  <ActionForm action={markAnnouncementAction}>
                    <input type="hidden" name="announcement_id" value={a.id} /><input type="hidden" name="ack" value="1" />
                    <Submit size="sm" testId="announcement-ack">{t('Enterado', 'Got it')}</Submit>
                  </ActionForm>
                ) : !a.read_at ? (
                  <ActionForm action={markAnnouncementAction}>
                    <input type="hidden" name="announcement_id" value={a.id} />
                    <Submit variant="ghost" size="sm" testId="announcement-read">{t('Marcar leído', 'Mark as read')}</Submit>
                  </ActionForm>
                ) : (
                  <span className="text-[13.5px] text-muted-2" data-testid="announcement-done">{a.ack_at ? t(`Diste acuse el ${dayTime(a.ack_at, locale, tz)}.`, `You acknowledged it on ${dayTime(a.ack_at, locale, tz)}.`) : t(`Leído el ${dayTime(a.read_at, locale, tz)}.`, `Read on ${dayTime(a.read_at, locale, tz)}.`)}</span>
                )}
                {pendingAck && <span className="text-[13px] text-muted-2">{t('Este anuncio pide que confirmes que te enteraste.', 'This announcement asks you to confirm you have seen it.')}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  async function Published() {
    const [rows, teams] = await Promise.all([publishedBy(ctx), teamsFor(ctx)])
    const openId = rows.some((r) => r.id === sp.anuncio) ? sp.anuncio! : null
    const who = openId ? await audienceOf(ctx, openId) : []
    const markets = ctx.isAdmin ? ctx.markets : ctx.markets.filter((m) => ctx.can('announcement.publish', m.code))
    const topics = TOPICS.filter((k) => k !== 'release' || ctx.isAdmin)
    const form = (seriesId: string, a?: Announcement) => (
      <ActionForm action={publishAnnouncementAction} onOk="reset" testId={seriesId ? 'announcement-version-form' : 'announcement-form'}>
        <input type="hidden" name="series_id" value={seriesId} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={t('Tema', 'Topic')} hint={t('Un cambio de comisiones o de alta siempre pide acuse y fecha de entrada en vigor.', 'A commission or sign-up change always asks for acknowledgment and an effective date.')}>
            <select name="topic" defaultValue={a?.topic ?? 'general'} className="input" data-testid="ann-topic">{topics.map((k) => <option key={k} value={k}>{t(...TOPIC_LABEL[k])}</option>)}</select>
          </Field>
          <Field label={t('Vale hasta', 'Shown until')} hint={t(`Como máximo ${MAX_DAYS} días.`, `At most ${MAX_DAYS} days.`)}><input name="ends_on" type="date" required min={addDays(today, 1)} max={addDays(today, MAX_DAYS)} defaultValue={addDays(today, 14)} className="input" data-testid="ann-ends" /></Field>
          <Field label={t('Título', 'Title')} className="md:col-span-2"><input name="title" required minLength={3} maxLength={140} defaultValue={a?.title ?? ''} className="input" data-testid="ann-title" /></Field>
          <Field label={t('Texto', 'Text')} className="md:col-span-2"><textarea name="body" required rows={4} maxLength={3000} defaultValue={a?.body ?? ''} className="input" data-testid="ann-body" /></Field>
          <Field label={t('Mercado', 'Market')}>
            <select name="market" defaultValue={a?.market_code ?? (ctx.isAdmin ? '' : markets[0]?.code ?? '')} className="input" data-testid="ann-market">
              {ctx.isAdmin && <option value="">{t('Todos los mercados', 'All markets')}</option>}
              {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </Field>
          <Field label={t('Equipo (opcional)', 'Team (optional)')}>
            <select name="team_id" defaultValue={a?.team_id ?? ''} className="input" data-testid="ann-team">
              <option value="">{t('Todos los equipos', 'All teams')}</option>
              {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.market_code} · {tm.name}</option>)}
            </select>
          </Field>
          <Field label={t('Rol (opcional)', 'Role (optional)')}>
            <select name="role" defaultValue={a?.role ?? ''} className="input" data-testid="ann-role">
              <option value="">{t('Todos los roles', 'All roles')}</option>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</option>)}
            </select>
          </Field>
          <Field label={t('El cambio vale desde (si aplica)', 'The change applies from (if any)')}><input name="effective_on" type="date" min={addDays(today, 1)} defaultValue={a?.effective_on ?? ''} className="input" data-testid="ann-effective" /></Field>
        </div>
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13.5px] font-medium text-blue-text underline">{t('Escribirlo también en inglés', 'Also write it in Spanish')}</summary>
          <div className="mt-2 grid grid-cols-1 gap-3">
            <Field label={t('Título en inglés', 'Title in Spanish')}><input name="title_other" maxLength={140} defaultValue={a?.title_other ?? ''} className="input" /></Field>
            <Field label={t('Texto en inglés', 'Text in Spanish')}><textarea name="body_other" rows={3} maxLength={3000} defaultValue={a?.body_other ?? ''} className="input" /></Field>
          </div>
        </details>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-2 text-[14.5px] text-strong"><input type="checkbox" name="requires_ack" defaultChecked={a?.requires_ack ?? false} className="h-5 w-5" data-testid="ann-ack" />{t('Pedir que cada persona confirme que se enteró', 'Ask each person to confirm they have seen it')}</label>
          <Submit testId="ann-publish">{seriesId ? t('Publicar versión nueva', 'Publish new version') : t('Publicar', 'Publish')}</Submit>
        </div>
      </ActionForm>
    )
    return (
      <div className="space-y-8">
        <Card data-testid="announcement-new">
          <CardTitle title={t('Publicar un anuncio', 'Publish an announcement')} hint={t('Lo ve cada persona de la audiencia al entrar a CONTIGO y en su campana. Queda en la bitácora.', 'Each person in the audience sees it when they open CONTIGO and in their bell. It is logged.')} />
          {form('')}
        </Card>
        {rows.length === 0 ? (
          <Empty title={t('Todavía no has publicado anuncios', 'You have not published any announcements yet')} hint={t('Cuando publiques uno, aquí ves quién lo leyó y quién falta.', 'When you publish one, this is where you see who read it and who is missing.')} />
        ) : (
          <ul className="space-y-4" data-testid="published-list">
            {rows.map((a) => {
              const missing = a.requires_ack ? a.audience - a.acked : a.audience - a.read
              const live = a.status === 'published' && a.ends_at > new Date()
              return (
                <li key={a.id} className="card p-5 md:p-6" data-testid="published">
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-2">
                    <Badge tone={live ? 'good' : 'neutral'}>{a.status === 'withdrawn' ? t('Retirado', 'Withdrawn') : live ? t('Vigente', 'Current') : t('Terminó su vigencia', 'Expired')}</Badge>
                    <span>{topic(a.topic)} · {audience(a)} · {t(`versión ${a.version}`, `version ${a.version}`)} · {t(`hasta el ${day(isoDay(new Date(a.ends_at.getTime() - 1000), tz), locale)}`, `until ${day(isoDay(new Date(a.ends_at.getTime() - 1000), tz), locale)}`)}</span>
                  </p>
                  <h2 className="mt-2 text-[17px] font-semibold text-strong [overflow-wrap:anywhere]">{a.title}</h2>
                  <p className="mt-1 text-[14px] text-strong" data-testid="published-counts">
                    {a.requires_ack
                      ? t(`${a.acked} de ${a.audience} dieron acuse. ${missing === 0 ? 'No falta nadie.' : `Faltan ${missing}.`}`, `${a.acked} of ${a.audience} acknowledged. ${missing === 0 ? 'Nobody is missing.' : `${missing} missing.`}`)
                      : t(`${a.read} de ${a.audience} lo leyeron. ${missing === 0 ? 'No falta nadie.' : `Faltan ${missing}.`}`, `${a.read} of ${a.audience} read it. ${missing === 0 ? 'Nobody is missing.' : `${missing} missing.`}`)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a href={qs('/anuncios', { ver: 'publicados', anuncio: a.id })} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="published-who">{t('Ver quién falta', 'See who is missing')}</a>
                    {live && (
                      <>
                        <Dialog trigger={t('Cambiar (versión nueva)', 'Change (new version)')} title={t('Publicar una versión nueva', 'Publish a new version')} variant="ghost" size="sm" testId="published-edit">{form(a.series_id, a)}</Dialog>
                        <ActionForm action={withdrawAnnouncementAction}>
                          <input type="hidden" name="announcement_id" value={a.id} />
                          <Submit variant="quiet" size="sm" testId="published-withdraw">{t('Retirar', 'Withdraw')}</Submit>
                        </ActionForm>
                      </>
                    )}
                  </div>
                  {openId === a.id && (
                    <ul className="mt-3 divide-y divide-line border-t border-line" data-testid="published-audience">
                      {who.length === 0 && <li className="py-2 text-[14px] text-muted-2">{t('Nadie más está en esta audiencia.', 'Nobody else is in this audience.')}</li>}
                      {who.map((p) => (
                        <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]" data-testid="audience-row">
                          <span className="font-medium text-strong">{p.full_name}</span>
                          <Badge tone={p.ack_at ? 'good' : p.read_at ? (a.requires_ack ? 'warn' : 'good') : 'neutral'}>
                            {p.ack_at ? t(`Acuse: ${dayTime(p.ack_at, locale, tz)}`, `Acknowledged: ${dayTime(p.ack_at, locale, tz)}`) : p.read_at ? (a.requires_ack ? t('Lo leyó, falta su acuse', 'Read, acknowledgment missing') : t(`Leído: ${dayTime(p.read_at, locale, tz)}`, `Read: ${dayTime(p.read_at, locale, tz)}`)) : t('Falta', 'Missing')}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }
}
