import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { myCenter } from '@/dal/notices'
import { Empty, PageHeader, Pills } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { NOTICE_KINDS, type KindDef, type NoticeKind } from '@/lib/notice-kinds'
import { ago } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { allReadAction, noticeReadAction } from './actions'

export const dynamic = 'force-dynamic'

/** Centro de avisos: todo lo que CONTIGO le avisó a la persona, leído y sin leer, con enlace al registro. */
export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const only = flat(await searchParams).ver === 'todos' ? 'all' : 'unread'
  const rows = await myCenter(ctx, only)
  const now = new Date()
  const kindLabel = (k: string) => {
    const def: KindDef | undefined = k in NOTICE_KINDS ? NOTICE_KINDS[k as NoticeKind] : undefined
    return def ? t(def.label[0], def.label[1]) : t('Aviso', 'Notice')
  }
  const href = (n: (typeof rows)[number]) => n.link ?? (n.announcement_id ? '/anuncios' : n.deal_id ? `/deals/${n.deal_id}` : n.lead_id ? `/leads/${n.lead_id}` : n.account_id ? `/comercios/${n.account_id}` : null)
  return (
    <div data-testid="notices">
      <PageHeader
        title={t('Avisos', 'Notices')}
        desc={t('Lo que CONTIGO te avisó. Los que piden acción también salen en Hoy.', 'What CONTIGO told you. The ones that need action also show in Today.')}
        actions={<Link href="/avisos/preferencias" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="notices-prefs-link">{t('Preferencias de avisos', 'Notice preferences')}</Link>}
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Pills label={t('Ver', 'View')} current={only} items={[
          { key: 'unread', href: '/avisos', label: t('Sin leer', 'Unread') },
          { key: 'all', href: qs('/avisos', { ver: 'todos' }), label: t('Todos', 'All') },
        ]} />
        {only === 'unread' && rows.length > 0 && (
          <ActionForm action={allReadAction}><Submit variant="ghost" size="sm" testId="notices-all-read">{t('Marcar todo como leído', 'Mark all as read')}</Submit></ActionForm>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty
          title={only === 'unread' ? t('No tienes avisos sin leer', 'You have no unread notices') : t('Todavía no tienes avisos', 'You have no notices yet')}
          hint={t('Aquí aparece cuando te llega un lead, te devuelven un negocio, alguien te avisa desde una nota o hay un anuncio para tu equipo.', 'This is where it shows when a lead arrives for you, a deal comes back, someone notifies you from a note or there is an announcement for your team.')}
          action={only === 'unread' ? <Link href={qs('/avisos', { ver: 'todos' })} className="font-medium text-blue-text underline">{t('Ver los ya leídos', 'See the ones already read')}</Link> : undefined}
        />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden" data-testid="notices-list">
          {rows.map((n) => {
            const to = href(n)
            return (
              <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5" data-testid="notice-row" data-unread={n.seen_at ? undefined : 'true'}>
                <div className="min-w-[220px] flex-1">
                  <p className="text-[12.5px] font-medium text-muted-2">
                    {!n.seen_at && <span className="mr-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[12px] font-semibold text-brand-text">{t('Sin leer', 'Unread')}</span>}
                    {kindLabel(n.kind)} · {ago(n.created_at, locale, now)}
                  </p>
                  <p className="mt-0.5 text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{n.title ?? n.from_name}</p>
                  <p className="text-[14px] text-muted-2 [overflow-wrap:anywhere]">{n.body}</p>
                </div>
                {to && <Link href={to} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="notice-open">{t('Abrir', 'Open')}</Link>}
                {!n.seen_at && !n.announcement_id && (
                  <ActionForm action={noticeReadAction}>
                    <input type="hidden" name="notice_id" value={n.id} />
                    <Submit variant="ghost" size="sm" testId="notice-read">{t('Marcar leído', 'Mark as read')}</Submit>
                  </ActionForm>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
