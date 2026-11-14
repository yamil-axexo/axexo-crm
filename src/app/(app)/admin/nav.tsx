import Link from 'next/link'
import { cx } from '@/ui/kit'

export type AdminNavItem = { key: string; href: string; label: string }
export type AdminNavGroup = { key: string; label: string; items: AdminNavItem[] }

/**
 * Las secciones de Administración, agrupadas por tema. Con la ola 1 de los 95 pasaron de nueve a quince: en una sola fila
 * ya no se leían. Es una sola navegación ("Secciones") con un grupo por tema; cada grupo acomoda sus entradas en renglones,
 * así cabe igual en 390 px. Un grupo sin entradas para el rol no se muestra.
 */
export function AdminNav({ label, groups, current }: { label: string; groups: AdminNavGroup[]; current: string }) {
  const shown = groups.filter((g) => g.items.length > 0)
  return (
    <nav aria-label={label} className="mb-8 grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3" data-testid="admin-sections">
      {shown.map((g) => (
        <div key={g.key} role="group" aria-label={g.label} data-testid={`admin-group-${g.key}`}>
          <p className="mb-2 text-[12.5px] font-semibold tracking-wide text-muted-2 uppercase" aria-hidden>{g.label}</p>
          <div className="flex flex-wrap gap-2">
            {g.items.map((i) => (
              <Link
                key={i.key}
                href={i.href}
                aria-current={i.key === current ? 'page' : undefined}
                data-testid={`pill-${i.key}`}
                className={cx('press inline-flex min-h-11 items-center rounded-full px-4 text-[13px] font-medium', i.key === current ? 'bg-ink text-white' : 'border border-line bg-surface text-strong hover:bg-green-50')}
              >
                {i.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}
