import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CircleHelp, LineChart, ListChecks, LogOut, Search, Settings, Users } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { dockCounts } from '@/dal/boards'
import { AccountMenu, Dock, OfflineBanner, SearchBox, type DockItem } from '@/ui/shell'
import { ToastHost } from '@/ui/complete'
import { LogHost } from '@/ui/log'
import { logConfig } from '@/server/sheet'
import { ROLE_LABEL } from '@/domain/policy'
import { logout, setLocale } from '@/app/session-actions'

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
  const roles = [...new Set(ctx.memberships.map((x) => `${t(ROLE_LABEL[x.role].es, ROLE_LABEL[x.role].en)}${x.market ? ` · ${x.market}` : ''}`))].join(', ')
  const showAdmin = ctx.can('config.manage') || ctx.can('audit.read')
  const counts = await dockCounts(ctx)

  // Nunca más de 4 destinos: lo nuevo entra como vista dentro de uno de ellos (handoff, sección 4).
  const items: DockItem[] = [
    { key: 'today', href: '/hoy', label: m('nav.today'), match: ['/hoy', '/actividades'] },
    { key: 'leads', href: '/leads', label: m('nav.leads'), match: ['/leads'], badge: counts.leadsWaiting, badgeLabel: m('nav.leadsWaiting', { count: counts.leadsWaiting }) },
    { key: 'deals', href: '/pipelines', label: m('nav.deals'), match: ['/pipelines', '/deals'] },
    { key: 'merchants', href: '/comercios', label: m('nav.merchants'), match: ['/comercios'] },
  ]
  const create = [
    ...(ctx.can('lead.create') ? [{ href: '/leads#nuevo', label: m('nav.create.lead') }] : []),
    ...(ctx.can('account.create') ? [{ href: '/comercios#nuevo', label: m('nav.create.merchant') }] : []),
  ]
  // Registrar una visita, una llamada o una nota empieza en el dock: quien trabaja en la calle no abre primero la ficha.
  const canLog = ctx.can('activity.write')
  const menuLink = 'flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-strong hover:bg-green-50'

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-[36] flex h-[60px] items-center gap-4 border-b border-line bg-surface px-4 md:h-[64px] md:gap-6 md:px-8 desk:h-[72px] desk:px-10" data-testid="topbar">
        <Link href="/hoy" className="shrink-0" aria-label="axexo CONTIGO">
          <Image src="/contigo-on-light.png" alt="axexo CONTIGO" width={129} height={32} priority className="h-7 w-auto md:h-8" />
        </Link>
        <SearchBox placeholder={m('top.search')} label={m('top.searchLabel')} />
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <Link href="/buscar" aria-label={m('top.searchLabel')} className="press inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-strong md:hidden" data-testid="search-link">
            <Search size={20} strokeWidth={1.75} aria-hidden />
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
            </div>
            <div className="py-1">
              {ctx.can('board.supervisor') && <Link href="/supervisor" role="menuitem" className={menuLink} data-testid="nav-supervisor"><Users size={20} strokeWidth={1.75} aria-hidden />{m('top.team')}</Link>}
              {ctx.can('board.lt') && <Link href="/panel-lt" role="menuitem" className={menuLink} data-testid="nav-panel-lt"><LineChart size={20} strokeWidth={1.75} aria-hidden />{m('top.leadership')}</Link>}
              {showAdmin && <Link href="/admin" role="menuitem" className={menuLink} data-testid="nav-admin"><Settings size={20} strokeWidth={1.75} aria-hidden />{m('top.admin')}</Link>}
              <Link href="/bienvenida" role="menuitem" className={menuLink} data-testid="nav-welcome"><ListChecks size={20} strokeWidth={1.75} aria-hidden />{m('top.firstSteps')}</Link>
              <Link href="/ayuda" role="menuitem" className={menuLink} data-testid="nav-help"><CircleHelp size={20} strokeWidth={1.75} aria-hidden />{m('top.help')}</Link>
            </div>
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
      <OfflineBanner text={m('offline.banner')} tag={m('offline.tag')} blocked={m('offline.blocked')} />
      <main className="content-enter mx-auto w-full max-w-[1120px] px-4 pt-6 pb-[120px] md:px-8 md:pt-9 md:pb-[150px]">{children}</main>
      <Dock items={items} label={m('nav.main')} createLabel={m('nav.create')} create={create} logLabel={canLog ? t('Registrar actividad', 'Log activity') : undefined} />
      {canLog && <LogHost config={logConfig(ctx)} />}
      <ToastHost />
    </div>
  )
}
