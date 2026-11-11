import Link from 'next/link'
import type { ReactNode } from 'react'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow?: string; title: string; desc?: string; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-[28px] leading-9 font-semibold [overflow-wrap:anywhere]">{title}</h1>
        {desc && <p className="mt-1.5 text-[15px] text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}

export function Card({ children, className, pad = true, ...rest }: { children: ReactNode; className?: string; pad?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cx('card', pad && 'p-7', className)} {...rest}>
      {children}
    </section>
  )
}

export function CardTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[18px] leading-[26px] font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted-2',
  good: 'bg-green-100 text-brand-text',
  warn: 'bg-warn-bg text-amber-text',
  bad: 'bg-risk-bg text-red-text',
  info: 'bg-surface-3 text-strong',
  accent: 'bg-green-100 text-brand-text',
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap', TONES[tone])}>
      {children}
    </span>
  )
}

export function Stat({ label, value, hint, tone, href, testId }: { label: string; value: ReactNode; hint?: string; tone?: Tone; href?: string; testId?: string }) {
  const body = (
    <div className={cx('card h-full min-w-0 p-4 md:p-6', href && 'lift')} data-testid={testId}>
      <p className="text-[13px] font-medium text-muted-2">{label}</p>
      <p className={cx('num mt-2 text-[22px] leading-8 font-semibold [overflow-wrap:anywhere] md:text-[28px] md:leading-9', tone === 'bad' ? 'text-red-text' : tone === 'warn' ? 'text-amber-text' : tone === 'good' ? 'text-brand-text' : 'text-strong')}>{value}</p>
      {hint && <p className="mt-3 text-[13px] text-muted">{hint}</p>}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

const BTN = {
  primary: 'grad-bg text-on-sun hover:brightness-110',
  ghost: 'bg-surface text-strong border border-line-2 hover:bg-green-50',
  quiet: 'text-muted-2 hover:bg-surface-3',
  danger: 'bg-risk-bg text-red-text hover:brightness-95',
} as const

export function buttonClass(variant: keyof typeof BTN = 'ghost', size: 'sm' | 'md' = 'md') {
  return cx(
    'press inline-flex cursor-pointer items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-11 px-5 text-[15px]',
    BTN[variant],
  )
}

export function LinkButton({ href, children, variant = 'ghost', size = 'md', testId }: { href: string; children: ReactNode; variant?: keyof typeof BTN; size?: 'sm' | 'md'; testId?: string }) {
  return (
    <Link href={href} className={buttonClass(variant, size)} data-testid={testId}>
      {children}
    </Link>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-2 block text-[13px] font-semibold text-muted-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-line-2 px-8 py-12 text-center">
      <p className="text-[15px] font-semibold text-strong">{title}</p>
      {hint && <p className="mt-2 max-w-md text-[13.5px] text-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Pestañas y filtros como enlaces: el estado vive en la URL, así una vista se puede compartir. */
export function Pills({ items, current, label }: { items: { href: string; label: string; key: string; count?: number }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? 'page' : undefined}
          data-testid={`pill-${i.key || 'all'}`}
          className={cx(
            'press inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium',
            i.key === current ? 'bg-ink text-white' : 'bg-surface text-strong border border-line hover:bg-green-50',
          )}
        >
          {i.label}
          {i.count !== undefined && <span className={cx('num text-[13px]', i.key === current ? 'text-on-black' : 'text-muted')}>· {i.count}</span>}
        </Link>
      ))}
    </nav>
  )
}

export function Table({ head, children, testId, label }: { head: ReactNode; children: ReactNode; testId?: string; label?: string }) {
  return (
    // La tabla ancha se desplaza dentro de su caja: la región se enfoca para poder recorrerla con teclado.
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label ?? 'Tabla / Table'}>
      <table className="w-full border-collapse" data-testid={testId}>
        <thead className="table-head">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Bar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'good' | 'bad' }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-track" role="presentation">
      <div className={cx('h-full rounded-full', tone === 'good' ? 'bg-brand' : tone === 'bad' ? 'bg-red' : 'grad-bg')} style={{ width: `${w}%` }} />
    </div>
  )
}

export function KeyVal({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-3 first:border-t-0">
      <dt className="shrink-0 text-[13px] text-muted">{k}</dt>
      <dd className="min-w-0 text-right text-[14px] font-medium text-strong [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}
