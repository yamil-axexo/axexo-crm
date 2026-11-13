import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { after } from 'next/server'
import { tickJobs } from '@/server/jobs/runner'
import { Activity, BarChart3, Bell, CircleHelp, Database, Eye, Megaphone, FileSpreadsheet, GitPullRequestArrow, Handshake, ListFilter, LifeBuoy, Lightbulb, LineChart, ListChecks, LogOut, MapPinned, Rocket, Search, Settings, Users, HeartPulse } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { dockCounts } from '@/dal/boards'
import { AccountMenu, Dock, LeadAlertToggle, LeadWatch, OfflineBanner, SearchBox, type DockItem } from '@/ui/shell'
import { ToastHost } from '@/ui/complete'
import { ReportLink } from '@/ui/problem-report'
import { LogHost } from '@/ui/log'
import { Beacon } from '@/ui/beacon'
import { logConfig, opsVoice } from '@/server/sheet'
import { opsWaiting } from '@/dal/ops'
import { officialQueues, pinnedQueues } from '@/dal/reportes'
import { VIEW_EN, VIEW_OBJECT_LABEL, viewHref } from '@/lib/report-catalog'
import { ROLE_LABEL, homePath, isReadOnly } from '@/domain/policy'
import { logout, setLocale } from '@/app/session-actions'
import { stopViewAsAction } from '@/app/(app)/admin/seguridad/view-as-actions'
import { CommandPalette } from '@/ui/palette'
import { readerTimeZone } from '@/server/timezone'
import { unreadNotices } from '@/dal/notices'
import { HideOn, ScreenHelpFooter } from '@/ui/notices'
import { pendingAnnouncements } from '@/dal/announcements'
import { markAnnouncementAction } from '@/app/(app)/anuncios/actions'
import { ActionForm, Submit } from '@/ui/client'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx()
  const { t, m } = ctx
  // Tareas programadas, disparo oportunista: lo que ya toca corre después de responder, sin hacer esperar a nadie.
  after(() => tickJobs())
  const roles = [...new Set(ctx.memberships.map((x) => `${t(ROLE_LABEL[x.role].es, ROLE_LABEL[x.role].en)}${x.market ? ` · ${x.market}` : ''}`))].join(', ')
  const showAdmin = ctx.can('config.manage') || ctx.can('audit.read') || ctx.can('access.manage') || ctx.can('integration.operate') || ctx.can('security.read')
  // Quien solo tiene Leadership ve todo y no cambia nada: la barra lo dice siempre, en cualquier pantalla.
  const readOnly = isReadOnly(ctx.memberships)
  const counts = await dockCounts(ctx)
  // La campana: cuántos avisos sin leer tiene la persona (AUT-05).
  const unread = ctx.user.isSystem ? 0 : await unreadNotices(ctx)
  // Anuncios vigentes que la persona no ha leído o que piden acuse: los ve al entrar, en cualquier pantalla (GOB-06).
  const announcements = ctx.user.isSystem ? [] : await pendingAnnouncements(ctx)
  const first = announcements[0]
  const firstText = first ? (first.locale === ctx.locale || !first.title_other || !first.body_other ? { title: first.title, body: first.body } : { title: first.title_other, body: first.body_other }) : null
  const bellLabel = unread > 0 ? t(`Avisos: ${unread} sin leer`, `Notices: ${unread} unread`) : t('Avisos', 'Notices')
  // Quien trabaja o reparte leads: con la app abierta, el contador se actualiza solo y la pestaña avisa cuando llega uno.
  const watchLeads = !ctx.user.isSystem && (ctx.can('lead.work') || ctx.can('lead.assign'))

  // Operaciones no trabaja leads: en su lugar tiene su cola, con el conteo de lo que nadie ha tomado.
  const ops = opsVoice(ctx)
  const waiting = ctx.can('deal.ops') ? await opsWaiting(ctx) : 0
  const queueLabel = t(`${waiting} ${waiting === 1 ? 'negocio sin tomar' : 'negocios sin tomar'} en la cola de Operaciones`, `${waiting} ${waiting === 1 ? 'deal' : 'deals'} not taken in the Operations queue`)
  // Nunca más de 4 destinos: lo nuevo entra como vista dentro de uno de ellos (handoff, sección 4).
  const items: DockItem[] = [
    { key: 'today', href: '/hoy', label: m('nav.today'), match: ['/hoy', '/actividades'] },
    ops
      ? { key: 'queue', href: '/operaciones', label: t('Cola', 'Queue'), match: ['/operaciones'], badge: waiting, badgeLabel: queueLabel }
      : { key: 'leads', href: '/leads', label: m('nav.leads'), match: ['/leads'], badge: counts.leadsWaiting, badgeLabel: m('nav.leadsWaiting', { count: counts.leadsWaiting }) },
    { key: 'deals', href: '/pipelines', label: m('nav.deals'), match: ['/pipelines', '/deals'] },
    { key: 'merchants', href: '/comercios', label: m('nav.merchants'), match: ['/comercios'] },
  ]
  const create = [
    ...(ctx.can('lead.create') ? [{ href: '/leads#nuevo', label: m('nav.create.lead') }] : []),
    ...(ctx.can('account.create') ? [{ href: '/comercios#nuevo', label: m('nav.create.merchant') }] : []),
  ]
  // Registrar una visita, una llamada o una nota empieza en el dock: quien trabaja en la calle no abre primero la ficha.
  const canLog = ctx.can('activity.write')
  const viewAsUntil = ctx.viewAs ? new Intl.DateTimeFormat(ctx.locale === 'en' ? 'en-US' : 'es-MX', { hour: 'numeric', minute: '2-digit', timeZone: await readerTimeZone(ctx) }).format(new Date(ctx.viewAs.until)) : ''
  // Colas fijadas por la persona (vistas guardadas), con su contador.
  const queues = await pinnedQueues(ctx)
  // UX-03 (embudo2): las colas oficiales del rol, con su total en la barra principal.
  const official = await officialQueues(ctx)
  const officialTotal = official.reduce((n, q) => n + (q.count ?? 0), 0)
  const menuLink = 'flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-strong hover:bg-green-50'
  // UX-02: la paleta (Ctrl+K) ofrece los mismos destinos que la persona ya tiene en el dock y en su menú, ni uno más.
  const palette = [
    ...items.map((i) => ({ href: i.href, label: i.label })),
    ...create,
    ...(ctx.can('board.supervisor') ? [{ href: '/supervisor', label: m('top.team') }] : []),
    ...(ctx.can('report.gallery') ? [{ href: '/reportes', label: t('Reportes', 'Reports') }] : []),
    ...(ctx.can('view.save') ? [{ href: '/personas', label: t('Personas de los comercios', 'Merchant contacts') }] : []),
    ...(ctx.can('ia.read') || ctx.can('ia.ask') ? [{ href: '/asistencia', label: t('Asistencia', 'Assistance') }] : []),
    ...(ctx.can('board.lt') ? [{ href: '/panel-lt', label: m('top.leadership') }] : []),
    ...(showAdmin ? [{ href: '/admin', label: m('top.admin') }] : []),
    ...(ctx.can('security.read') || ctx.can('access.manage') ? [{ href: '/admin/seguridad', label: t('Seguridad', 'Security') }] : []),
    ...(ctx.can('status.read') ? [{ href: '/estado', label: t('Estado de CONTIGO', 'CONTIGO status') }] : []),
    { href: '/avisos', label: t('Avisos y anuncios', 'Notices and announcements') },
    { href: '/bienvenida', label: m('top.firstSteps') },
    { href: '/ayuda', label: m('top.help') },
  ]

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-[36] flex h-[60px] items-center gap-4 border-b border-line bg-surface px-4 md:h-[64px] md:gap-6 md:px-8 desk:h-[72px] desk:px-10" data-testid="topbar">
        <Link href={homePath(ctx.memberships)} className="shrink-0" aria-label="axexo CONTIGO" data-testid="home-link">
          <Image src="/contigo-on-light.png" alt="axexo CONTIGO" width={129} height={32} priority className="h-7 w-auto md:h-8" />
        </Link>
        <SearchBox placeholder={m('top.search')} label={m('top.searchLabel')} />
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {readOnly && (
            <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-3 px-2.5 text-[12px] font-semibold whitespace-nowrap text-strong md:px-3 md:text-[12.5px]" title={t('Tu rol ve todo y no cambia nada.', 'Your role sees everything and changes nothing.')} data-testid="read-only">
              <Eye size={15} strokeWidth={1.75} aria-hidden className="hidden md:block" />
              {t('Solo lectura', 'Read-only')}
            </span>
          )}
          <Link href="/buscar" aria-label={m('top.searchLabel')} className="press inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-strong md:hidden" data-testid="search-link">
            <Search size={20} strokeWidth={1.75} aria-hidden />
          </Link>
          {official.length > 0 && (
            <Link href="/colas" className="press relative inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full border border-line px-1.5 text-[13px] font-semibold text-strong hover:bg-green-50 md:px-3" data-testid="nav-official-queues">
              <ListChecks size={18} strokeWidth={1.75} aria-hidden className="hidden md:block" />
              <span className="sr-only md:not-sr-only">{t('Colas', 'Queues')}</span>
              <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11.5px] font-semibold text-white" data-testid="nav-official-count">{officialTotal > 99 ? '99+' : officialTotal}</span>
            </Link>
          )}
          <Link href="/avisos" aria-label={bellLabel} title={bellLabel} className={`press relative h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-strong hover:bg-green-50 ${readOnly ? 'hidden md:inline-flex' : 'inline-flex'}`} data-testid="bell">
            <Bell size={20} strokeWidth={1.75} aria-hidden />
            {unread > 0 && <span className="num absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11.5px] font-semibold text-white" data-testid="bell-count">{unread > 99 ? '99+' : unread}</span>}
          </Link>
          <form action={setLocale}>
            <input type="hidden" name="locale" value={ctx.locale === 'es' ? 'en' : 'es'} />
            <button aria-label={`${ctx.locale.toUpperCase()}: ${m('top.language')}`} className="press hidden h-10 min-w-11 items-center justify-center rounded-full border border-line px-3 text-[13px] font-semibold text-strong hover:bg-green-50 md:inline-flex" data-testid="locale-toggle">
              {ctx.locale.toUpperCase()}
            </button>
          </form>
          <AccountMenu initials={initials(ctx.user.name)} label={`${initials(ctx.user.name)}: ${m('top.account')}`}>
            <div className="border-b border-line px-3 pt-2 pb-3">
              <p className="text-[15px] font-semibold text-strong" data-testid="me-name">{ctx.user.name}</p>
              <p className="text-[13px] text-muted" data-testid="me-roles">{roles}</p>
              {readOnly && <p className="mt-1 text-[12.5px] text-muted-2" data-testid="me-read-only">{t('Solo lectura: ves todo y no cambias nada.', 'Read-only: you see everything and change nothing.')}</p>}
            </div>
            <div className="py-1">
              {/* Quien solo lee no tiene la campana en la barra del teléfono (ahí va "Solo lectura"): entra a sus avisos desde aquí. */}
              {readOnly && <Link href="/avisos" role="menuitem" className={menuLink} data-testid="nav-notices"><Bell size={20} strokeWidth={1.75} aria-hidden />{t('Avisos y anuncios', 'Notices and announcements')}{unread > 0 ? ` (${unread})` : ''}</Link>}
              {ctx.can('deal.ops') && <Link href="/operaciones" role="menuitem" className={menuLink} data-testid="nav-ops-queue"><ListChecks size={20} strokeWidth={1.75} aria-hidden />{t('Cola de Operaciones', 'Operations queue')}{waiting > 0 ? ` (${waiting})` : ''}</Link>}
              {ctx.can('board.supervisor') ? <Link href="/supervisor" role="menuitem" className={menuLink} data-testid="nav-supervisor"><Users size={20} strokeWidth={1.75} aria-hidden />{m('top.team')}</Link>
                : ctx.can('exception.read') && <Link href="/supervisor" role="menuitem" className={menuLink} data-testid="nav-alerts"><Users size={20} strokeWidth={1.75} aria-hidden />{t('Avisos del mercado', 'Market alerts')}</Link>}
              {queues.length > 0 && (
                <div className="border-b border-line pb-1" data-testid="nav-queues">
                  <p className="px-3 pt-1 pb-0.5 text-[12px] font-semibold text-muted-2">{t('Mis colas', 'My queues')}</p>
                  {queues.map((q) => (
                    <Link key={q.id} href={viewHref(q)} role="menuitem" className={`${menuLink} justify-between`} data-testid="nav-queue">
                      <span className="flex min-w-0 items-center gap-3"><ListFilter size={20} strokeWidth={1.75} aria-hidden className="shrink-0" /><span className="truncate">{t(q.name, VIEW_EN[q.name] ?? q.name)}</span><span className="sr-only">, {t(VIEW_OBJECT_LABEL[q.object][0], VIEW_OBJECT_LABEL[q.object][1])}</span></span>
                      {q.count !== null && <span className="num shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[12.5px] font-semibold text-strong" data-testid="nav-queue-count">{q.count}</span>}
                    </Link>
                  ))}
                </div>
              )}
              {/* Cuidado de comercios: quien administra llega desde Administración (su menú ya no cabe en un teléfono). */}
              {!ctx.can('config.manage') && <Link href="/cuidado" role="menuitem" className={menuLink} data-testid="nav-care"><HeartPulse size={20} strokeWidth={1.75} aria-hidden />{t('Cuidado de comercios', 'Merchant care')}</Link>}
              {/* Campo y canales (paquete campo-canal). Administración entra desde Administración > Mercados. */}
              {!ctx.can('config.manage') && (ctx.can('priority.read') || ctx.can('onboarding.review') || ctx.can('incident.report')) && <Link href="/campo" role="menuitem" className={menuLink} data-testid="nav-field"><MapPinned size={20} strokeWidth={1.75} aria-hidden />{t('Campo y canales', 'Field and channels')}</Link>}
              {/* Quien administra llega a Asistencia desde Administración, IA y asistencia (y desde la paleta): su menú ya no cabe en un teléfono. */}
              {!ctx.can('config.manage') && (ctx.can('ia.read') || ctx.can('ia.ask')) && <Link href="/asistencia" role="menuitem" className={menuLink} data-testid="nav-assist"><Lightbulb size={20} strokeWidth={1.75} aria-hidden />{t('Asistencia', 'Assistance')}</Link>}
              {ctx.can('report.gallery') && <Link href="/reportes" role="menuitem" className={menuLink} data-testid="nav-reports"><BarChart3 size={20} strokeWidth={1.75} aria-hidden />{t('Reportes', 'Reports')}</Link>}
              {/* reportes2 (E8.F4): la lista de personas de los comercios, con vistas por equipo. */}
              {ctx.can('view.save') && <Link href="/personas" role="menuitem" className={menuLink} data-testid="nav-contacts"><Users size={20} strokeWidth={1.75} aria-hidden />{t('Personas de los comercios', 'Merchant contacts')}</Link>}
              {(ctx.can('report.view') || ctx.can('report.own')) && <Link href="/reportes/cerrados" role="menuitem" className={menuLink} data-testid="nav-closed"><FileSpreadsheet size={20} strokeWidth={1.75} aria-hidden />{t('Negocios cerrados', 'Closed deals')}</Link>}
              {/* Quien administra llega a estas dos pantallas desde Administración: su menú ya no cabe en un teléfono con más entradas. */}
              {!ctx.can('config.manage') && ctx.can('report.view') && <Link href="/reportes/mercado" role="menuitem" className={menuLink} data-testid="nav-market-report"><BarChart3 size={20} strokeWidth={1.75} aria-hidden />{t('Reporte del mercado', 'Market report')}</Link>}
              {!ctx.can('config.manage') && (ctx.can('rollout.read') || ctx.can('visit.sheet_load')) && <Link href="/arranque" role="menuitem" className={menuLink} data-testid="nav-rollout"><Rocket size={20} strokeWidth={1.75} aria-hidden />{t('Arranque y hojas', 'Rollout and sheets')}</Link>}
              {ctx.can('board.lt') && <Link href="/panel-lt" role="menuitem" className={menuLink} data-testid="nav-panel-lt"><LineChart size={20} strokeWidth={1.75} aria-hidden />{m('top.leadership')}</Link>}
              {/* Con la ola 1 de los 95 el menú de quien administra dejó de caber en un teléfono: Datos y Estado de CONTIGO le quedan en las secciones de Administración (Integraciones y datos, Control). Los demás roles los conservan aquí. */}
              {!ctx.can('config.manage') && (ctx.can('data.quality') || ctx.isGlobal) && <Link href="/datos" role="menuitem" className={menuLink} data-testid="nav-data"><Database size={20} strokeWidth={1.75} aria-hidden />{t('Datos', 'Data')}</Link>}
              {/* Quien administra llega a Partners desde Administración > Mercados. */}
              {!ctx.can('config.manage') && (ctx.can('partner.manage') || ctx.can('partner.portal')) && <Link href="/partners" role="menuitem" className={menuLink} data-testid="nav-partners"><Handshake size={20} strokeWidth={1.75} aria-hidden />{ctx.can('partner.manage') ? t('Partners', 'Partners') : t('Mi red', 'My network')}</Link>}
              {showAdmin && <Link href="/admin" role="menuitem" className={menuLink} data-testid="nav-admin"><Settings size={20} strokeWidth={1.75} aria-hidden />{m('top.admin')}</Link>}
              {!ctx.can('config.manage') && ctx.can('status.read') && <Link href="/estado" role="menuitem" className={menuLink} data-testid="nav-status"><Activity size={20} strokeWidth={1.75} aria-hidden />{t('Estado de CONTIGO', 'CONTIGO status')}</Link>}
              <Link href="/bienvenida" role="menuitem" className={menuLink} data-testid="nav-welcome"><ListChecks size={20} strokeWidth={1.75} aria-hidden />{m('top.firstSteps')}</Link>
              <Link href="/ayuda" role="menuitem" className={menuLink} data-testid="nav-help"><CircleHelp size={20} strokeWidth={1.75} aria-hidden />{m('top.help')}</Link>
              {/* Administración decide las solicitudes desde Gobierno; en su menú no cabe una entrada más en el teléfono. */}
              {!ctx.can('config.manage') && <Link href="/solicitudes" role="menuitem" className={menuLink} data-testid="nav-requests"><GitPullRequestArrow size={20} strokeWidth={1.75} aria-hidden />{t('Pedir un cambio', 'Request a change')}</Link>}
              <ReportLink className={menuLink} testId="nav-report"><LifeBuoy size={20} strokeWidth={1.75} aria-hidden />{t('Reportar un problema', 'Report a problem')}</ReportLink>
            </div>
            {watchLeads && (
              <LeadAlertToggle labels={{
                off: t('Avisarme cuando llegue un lead', 'Tell me when a lead arrives'),
                on: t('Avisos de lead nuevo: activados', 'New lead alerts: on'),
                hint: t('Aviso de este navegador, solo con CONTIGO abierto en una pestaña. No llega por correo ni por Slack.', 'An alert from this browser, only while CONTIGO is open in a tab. It does not arrive by email or Slack.'),
                blocked: t('El navegador tiene bloqueados los avisos de CONTIGO. Permítelos en la configuración del sitio y vuelve a intentarlo.', 'The browser is blocking alerts from CONTIGO. Allow them in the site settings and try again.'),
                unsupported: t('Este navegador no puede mostrar avisos. El contador de Leads y el título de la pestaña sí se actualizan solos.', 'This browser cannot show alerts. The Leads counter and the tab title still update on their own.'),
                enabled: t('Listo. Mientras CONTIGO esté abierto en una pestaña, este navegador te avisa cuando llegue un lead.', 'Done. While CONTIGO is open in a tab, this browser tells you when a lead arrives.'),
                disabled: t('Avisos de lead nuevo desactivados en este navegador.', 'New lead alerts turned off in this browser.'),
              }} />
            )}
            <form action={setLocale} className="border-t border-line pt-1 md:hidden">
              <input type="hidden" name="locale" value={ctx.locale === 'es' ? 'en' : 'es'} />
              <button role="menuitem" className={`${menuLink} w-full`}>{m('top.language')}</button>
            </form>
            <form action={logout} className="border-t border-line pt-1">
              <button role="menuitem" className={`${menuLink} w-full`} data-testid="logout"><LogOut size={20} strokeWidth={1.75} aria-hidden />{m('top.signOut')}</button>
            </form>
          </AccountMenu>
        </div>
      </header>
      {ctx.viewAs && (
        <div role="status" className="sticky top-[60px] z-[35] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-line bg-warn-bg px-4 py-2.5 text-[13.5px] font-medium text-amber-text md:top-[64px] desk:top-[72px]" data-testid="view-as-banner">
          <span>
            <Eye size={15} strokeWidth={1.75} aria-hidden className="mr-1.5 inline-block align-[-2px]" />
            {t(`${ctx.viewAs.actorName}: estás viendo CONTIGO como ${ctx.user.name}. Solo lectura, hasta las ${viewAsUntil}.`, `${ctx.viewAs.actorName}: you are viewing CONTIGO as ${ctx.user.name}. Read-only, until ${viewAsUntil}.`)}
          </span>
          <form action={stopViewAsAction}>
            <button className="inline-flex min-h-11 items-center rounded-full border border-current px-4 text-[13px] font-semibold" data-testid="view-as-stop">{t('Dejar de ver como', 'Stop viewing as')}</button>
          </form>
        </div>
      )}
      <CommandPalette items={palette} labels={{ title: t('Ir a una pantalla o buscar', 'Go to a screen or search'), placeholder: t('Escribe a dónde quieres ir o qué buscas', 'Type where you want to go or what you are looking for'), search: t('Buscar', 'Search for'), hint: t('Flechas para elegir, Enter para ir, Esc para cerrar', 'Arrows to choose, Enter to go, Esc to close'), close: t('Cerrar', 'Close') }} />
      <Beacon />
      <OfflineBanner text={m('offline.banner')} tag={m('offline.tag')} blocked={m('offline.blocked')} />
      <main className="content-enter mx-auto w-full max-w-[1120px] px-4 pt-6 pb-[120px] md:px-8 md:pt-9 md:pb-[150px]">
        {first && firstText && (
          <HideOn prefixes={['/anuncios']}>
            <aside aria-label={t('Anuncio', 'Announcement')} className="card mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 border-l-[#24815f] px-4 py-3.5 md:px-5 print:hidden" data-testid="announce-banner">
              <p className="min-w-[220px] flex-1 text-[14.5px] text-strong">
                <span className="mr-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-text"><Megaphone size={16} strokeWidth={1.75} aria-hidden />{first.topic === 'release' ? t('Novedades de CONTIGO', 'What is new in CONTIGO') : t('Anuncio', 'Announcement')}</span>
                <span className="font-semibold [overflow-wrap:anywhere]" data-testid="announce-banner-title">{firstText.title}</span>
                <span className="line-clamp-2 block text-[14px] text-muted-2 [overflow-wrap:anywhere]">{firstText.body}</span>
              </p>
              <Link href={`/anuncios#${first.id}`} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="announce-banner-open">
                {announcements.length > 1 ? t(`Ver los ${announcements.length} anuncios`, `See all ${announcements.length} announcements`) : t('Leer completo', 'Read in full')}
              </Link>
              <ActionForm action={markAnnouncementAction}>
                <input type="hidden" name="announcement_id" value={first.id} /><input type="hidden" name="ack" value={first.requires_ack ? '1' : '0'} />
                <Submit variant={first.requires_ack ? 'primary' : 'ghost'} size="sm" testId="announce-banner-ack">{first.requires_ack ? t('Enterado', 'Got it') : t('Marcar leído', 'Mark as read')}</Submit>
              </ActionForm>
            </aside>
          </HideOn>
        )}
        {children}<ScreenHelpFooter label={t('¿Cómo se usa esto?', 'How do I use this?')} /></main>
      <Dock items={items} label={m('nav.main')} createLabel={m('nav.create')} create={create} logLabel={canLog ? t('Registrar actividad', 'Log activity') : undefined} />
      {watchLeads && (
        <LeadWatch
          initial={{ leadsWaiting: counts.leadsWaiting, latest: counts.latest }}
          labels={{
            one: t('Lead nuevo', 'New lead'), many: t('Leads nuevos', 'New leads'),
            toast: t('Llegó un lead: {name}. Está en Leads y en Hoy.', 'A lead arrived: {name}. It is in Leads and in Today.'),
            notifyTitle: t('Lead nuevo en axexo CONTIGO', 'New lead in axexo CONTIGO'),
            notifyBody: t('{name}. La meta de primer contacto ya está corriendo.', '{name}. The first-contact goal is already running.'),
          }}
        />
      )}
      {canLog && <LogHost config={logConfig(ctx)} />}
      <ToastHost />
    </div>
  )
}
