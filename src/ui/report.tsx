import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Locale, T } from '@/lib/format'
import { day } from '@/lib/format'
import { METRICS, type MetricKey } from '@/lib/metric-defs'
import { PERIOD_KEYS, PERIOD_LABEL, type Period, type PeriodKey } from '@/lib/periods'
import { NavSelect } from '@/ui/board'
import { buttonClass, cx, shown } from '@/ui/kit'

/** "Cómo se calcula": la definición de una cifra, a un toque y sin salir de la pantalla. */
export function Def({ t, k, testId, named, owners }: { t: T; k: MetricKey; testId?: string; named?: boolean; owners?: Record<string, string> }) {
  const d = METRICS[k]
  const row = (label: string, text: string) => (
    <div className="mt-2 first:mt-0"><dt className="text-[12px] font-semibold text-muted-2">{label}</dt><dd className="text-[13px] text-strong">{text}</dd></div>
  )
  return (
    <details className="mt-1" data-testid={testId ?? `def-${k}`}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] font-medium text-brand-text underline underline-offset-2">{t('Cómo se calcula', 'How it is calculated')}{named ? `: ${t(d.label[0], d.label[1])}` : ''}</summary>
      <dl className="rounded-[12px] bg-surface-3 px-3.5 py-3">
        {row(t('Qué cuenta', 'What it counts'), t(d.what[0], d.what[1]))}
        {'num' in d && row(t('Numerador', 'Numerator'), t(d.num[0], d.num[1]))}
        {'den' in d && row(t('Denominador', 'Denominator'), t(d.den[0], d.den[1]))}
        {row(t('Ventana', 'Window'), t(d.window[0], d.window[1]))}
        {row(t('Fuente', 'Source'), t(d.source[0], d.source[1]))}
        {row(t('Quién responde por este número', 'Who answers for this number'), owners?.[k] ?? t(d.owner[0], d.owner[1]))}
      </dl>
    </details>
  )
}

/** Una cifra con su nombre, su enlace a la lista que la respalda y su definición. */
export function Metric({ t, k, value, hint, href, label, tone, testId, owners }: { t: T; k: MetricKey; value: ReactNode; hint?: string; href?: string; label?: string; tone?: 'good' | 'warn'; testId?: string; owners?: Record<string, string> }) {
  const d = METRICS[k]
  const text = <span className={cx('num text-[22px] leading-8 font-semibold [overflow-wrap:anywhere] md:text-[26px] md:leading-9', tone === 'good' ? 'text-brand-text' : tone === 'warn' ? 'text-amber-text' : 'text-strong')}>{shown(value)}</span>
  return (
    <div className="card min-w-0 p-4 md:p-5" data-testid={testId}>
      <p className="text-[13px] font-medium text-muted-2">{label ?? t(d.label[0], d.label[1])}</p>
      <p className="mt-1.5">
        {href ? (
          <Link href={href} className="inline-flex min-h-11 items-center underline decoration-line-2 underline-offset-4 hover:decoration-brand" data-testid={testId ? `${testId}-link` : undefined}>
            <span className="sr-only">{label ?? t(d.label[0], d.label[1])}: </span>{text}<span className="sr-only">, {t('ver la lista', 'see the list')}</span>
          </Link>
        ) : text}
      </p>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <Def t={t} k={k} owners={owners} />
    </div>
  )
}

export const periodText = (t: T, locale: Locale, p: Period) =>
  p.from === p.to ? day(p.from, locale) : t(`del ${day(p.from, locale)} al ${day(p.to, locale)}`, `${day(p.from, locale)} to ${day(p.to, locale)}`)

export type Option = { value: string; label: string }

/**
 * Filtros de un reporte: cada selector navega a la misma pantalla con el filtro en la URL, así la vista se puede compartir.
 * El rango de fechas es un formulario GET normal (funciona sin JavaScript) que conserva los demás filtros.
 */
export function ReportFilters({ t, locale, base, params, period, periods = PERIOD_KEYS, selects, zone }: {
  t: T
  locale: Locale
  base: string
  params: Record<string, string | undefined>
  period?: Period
  periods?: readonly PeriodKey[]
  selects: { name: string; label: string; all: string; options: Option[]; testId?: string }[]
  /** Cuando el periodo no va por mercado sino en una sola zona (la de quien lee), su nombre. */
  zone?: string
}) {
  const href = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) sp.set(k, v)
    const s = sp.toString()
    return s ? `${base}?${s}` : base
  }
  const pHref = (k: PeriodKey) => href({ periodo: k, desde: k === 'rango' && period ? period.from : undefined, hasta: k === 'rango' && period ? period.to : undefined })
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-3 gap-y-3" data-testid="report-filters">
      {period && (
        <label className="block min-w-0">
          <span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Periodo', 'Period')}</span>
          <NavSelect label={t('Periodo', 'Period')} value={pHref(period.key)} testId="filter-periodo"
            options={periods.map((k) => ({ href: pHref(k), label: t(PERIOD_LABEL[k][0], PERIOD_LABEL[k][1]) }))} />
        </label>
      )}
      {selects.filter((s) => s.options.length > 0).map((s) => (
        <label key={s.name} className="block min-w-0">
          <span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{s.label}</span>
          <NavSelect label={s.label} value={href({})} testId={s.testId ?? `filter-${s.name}`}
            options={[{ href: href({ [s.name]: undefined }), label: s.all }, ...s.options.map((o) => ({ href: href({ [s.name]: o.value }), label: o.label }))]} />
        </label>
      ))}
      {period?.key === 'rango' && (
        <form method="get" action={base} className="flex flex-wrap items-end gap-3" data-testid="range-form">
          {Object.entries(params).filter(([k, v]) => v && k !== 'desde' && k !== 'hasta').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Desde', 'From')}</span><input type="date" name="desde" defaultValue={period.from} className="input !w-auto" required /></label>
          <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Hasta', 'To')}</span><input type="date" name="hasta" defaultValue={period.to} className="input !w-auto" required /></label>
          <button type="submit" className={buttonClass('ghost')} data-testid="range-apply">{t('Aplicar', 'Apply')}</button>
        </form>
      )}
      {period && <p className="basis-full text-[13px] text-muted" data-testid="period-text">{zone ? t(`Periodo: ${periodText(t, locale, period)}, en ${zone}.`, `Period: ${periodText(t, locale, period)}, in ${zone}.`) : t(`Periodo: ${periodText(t, locale, period)}. Cada mercado cuenta sus días en su zona horaria.`, `Period: ${periodText(t, locale, period)}. Each market counts its days in its own time zone.`)}</p>}
    </div>
  )
}

/**
 * Exportar con motivo (AUT-07). Es un <details> con un formulario GET normal: la descarga la responde una ruta del servidor,
 * que valida el permiso, exige el motivo, aplica el tope del rol y deja el evento. Funciona sin JavaScript.
 */
export function ExportLink({ href, children, testId, t }: { href: string; children: ReactNode; testId?: string; t: T }) {
  const [path, query = ''] = href.split('?')
  const params = [...new URLSearchParams(query)]
  const id = testId ?? 'export-csv'
  return (
    <details className="relative max-md:w-full" data-testid={`${id}-box`}>
      <summary className={cx(buttonClass('ghost'), 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')} data-testid={id} data-href={href}>{children}</summary>
      <form method="get" action={path} className="card z-30 mt-2 space-y-3 p-4 text-left shadow-lg max-md:w-full md:absolute md:right-0 md:w-[22rem]" data-testid={`${id}-form`}>
        {params.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="block text-[13px] font-semibold text-muted-2">
          {t('¿Para qué necesitas el archivo?', 'What do you need the file for?')}
          <input name="motivo" className="input mt-1.5" required minLength={8} maxLength={300} autoComplete="off" data-testid={`${id}-reason`} />
        </label>
        <p className="text-[12.5px] text-muted">{t('El motivo queda en la bitácora con tu nombre, los filtros y el número de filas. El archivo tiene un tope de filas según tu rol.', 'The reason is logged with your name, the filters and the number of rows. The file has a row limit that depends on your role.')}</p>
        <button type="submit" className={buttonClass('primary', 'sm')} data-testid={`${id}-go`}>{t('Descargar archivo', 'Download file')}</button>
      </form>
    </details>
  )
}

/** De dónde sale una tasa, en palabras. El valor del ambiente de prueba se dice como lo que es: un ejemplo. */
export const fxSource = (t: T, r: { source: string }) =>
  r.source === 'synthetic' ? t('valor de ejemplo del ambiente de prueba, no es una tasa real', 'sample value from the test environment, not a real rate') : r.source
