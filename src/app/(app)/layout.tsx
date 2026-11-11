import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CalendarCheck, Inbox, KanbanSquare, Store, ListTodo, Users, LineChart, Settings, Search, LogOut } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { NavLink } from '@/ui/client'
import { ROLE_LABEL } from '@/domain/policy'
import { logout, setLocale } from '@/app/session-actions'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx()
  const { t } = ctx
  const roles = [...new Set(ctx.memberships.map((m) => `${t(ROLE_LABEL[m.role].es, ROLE_LABEL[m.role].en)}${m.market ? ` · ${m.market}` : ''}`))].join(', ')
  const showTeam = ctx.can('board.supervisor') || ctx.can('board.lt')
  const showAdmin = ctx.can('config.manage') || ctx.can('audit.read')

  return (
    <div className="flex min-h-full">
      <aside className="on-ink rail sticky top-0 flex h-screen w-[250px] shrink-0 flex-col px-5 py-7" data-testid="sidebar">
        <Link href="/hoy" className="mb-9 block px-2">
          <Image src="/contigo-on-dark.png" alt="axexo CONTIGO" width={180} height={44} priority className="h-9 w-auto" />
        </Link>
        <nav aria-label={t('Principal', 'Main')} className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
          <NavLink href="/hoy" testId="nav-hoy"><CalendarCheck size={18} />{t('Hoy', 'Today')}</NavLink>
          <NavLink href="/leads" testId="nav-leads"><Inbox size={18} />Leads</NavLink>
          <NavLink href="/pipelines" testId="nav-pipelines"><KanbanSquare size={18} />Pipelines</NavLink>
          <NavLink href="/comercios" testId="nav-comercios"><Store size={18} />{t('Comercios', 'Merchants')}</NavLink>
          <NavLink href="/actividades" testId="nav-actividades"><ListTodo size={18} />{t('Actividades', 'Activities')}</NavLink>
          {showTeam && <p className="eyebrow mt-7 mb-2 px-4">{t('Equipo', 'Team')}</p>}
          {ctx.can('board.supervisor') && <NavLink href="/supervisor" testId="nav-supervisor"><Users size={18} />{t('Supervisión', 'Supervision')}</NavLink>}
          {ctx.can('board.lt') && <NavLink href="/panel-lt" testId="nav-panel-lt"><LineChart size={18} />{t('Panel del LT', 'Leadership panel')}</NavLink>}
          {showAdmin && <p className="eyebrow mt-7 mb-2 px-4">{t('Configurar', 'Configure')}</p>}
          {showAdmin && <NavLink href="/admin" testId="nav-admin"><Settings size={18} />{t('Administración', 'Administration')}</NavLink>}
        </nav>
        <div className="mt-6 rounded-[20px] bg-white/6 p-4">
          <p className="text-[14px] font-semibold text-white" data-testid="me-name">{ctx.user.name}</p>
          <p className="mt-0.5 text-[12px] text-[#9aa0bd]" data-testid="me-roles">{roles}</p>
          <div className="mt-3 flex items-center gap-2">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={ctx.locale === 'es' ? 'en' : 'es'} />
              <button className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10" data-testid="locale-toggle">
                {ctx.locale === 'es' ? 'EN' : 'ES'}
              </button>
            </form>
            <form action={logout}>
              <button className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10" data-testid="logout">
                <LogOut size={13} />
                {t('Salir', 'Sign out')}
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1280px] px-12 pt-8 pb-20">
          <form action="/buscar" method="get" role="search" className="mb-10 flex items-center gap-3">
            <div className="relative w-full max-w-xl">
              <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
              <input
                name="q"
                type="search"
                className="input !h-12 !rounded-full !bg-surface !pl-11"
                placeholder={t('Busca por nombre, teléfono o ID externo', 'Search by name, phone or external ID')}
                aria-label={t('Buscar', 'Search')}
                data-testid="global-search"
              />
            </div>
          </form>
          <main>{children}</main>
        </div>
      </div>
    </div>
  )
}
