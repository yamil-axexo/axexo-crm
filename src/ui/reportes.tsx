import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Locale, T } from '@/lib/format'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { Field, cx } from '@/ui/kit'
import type { FormAction } from '@/ui/client'
import { VIEW_EN, viewHref, type ViewObject } from '@/lib/report-catalog'

/**
 * Piezas de la página Reportes y de las vistas guardadas. Las gráficas son SVG propio con los tokens de marca
 * (--cg-*): sin librerías. Cada gráfica lleva su tabla o su texto al lado: el dato nunca vive solo en el dibujo.
 */

/** Línea de tendencia. `label` la describe para lector de pantalla; los valores también van en texto junto a ella. */
export function Spark({ values, label, width = 132, height = 36, testId }: { values: number[]; label: string; width?: number; height?: number; testId?: string }) {
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? (width - 8) / (values.length - 1) : 0
  const pts = values.map((v, i) => [4 + i * step, height - 5 - (v / max) * (height - 10)] as const)
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="block shrink-0" data-testid={testId}>
      <line x1="4" y1={height - 5} x2={width - 4} y2={height - 5} stroke="var(--cg-line-200)" strokeWidth="1" />
      {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--cg-green-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {last && <circle cx={last[0]} cy={last[1]} r="3" fill="var(--cg-green-700)" />}
    </svg>
  )
}

/** Barras verticales por punto (días o meses), con eje base. */
export function Columns({ points, label, height = 120, testId }: { points: { key: string; value: number; title: string }[]; label: string; height?: number; testId?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const w = Math.max(240, points.length * 18)
  const bar = Math.max(6, Math.floor((w - 8) / Math.max(1, points.length)) - 4)
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label} className="block min-w-[240px]" data-testid={testId}>
        <line x1="0" y1={height - 1} x2={w} y2={height - 1} stroke="var(--cg-line-200)" strokeWidth="1" />
        {points.map((p, i) => {
          const h = Math.max(2, Math.round((p.value / max) * (height - 12)))
          return <rect key={p.key} x={4 + i * (bar + 4)} y={height - 1 - h} width={bar} height={h} rx="3" fill={i === points.length - 1 ? 'var(--cg-green-700)' : 'var(--cg-green-500)'}><title>{p.title}</title></rect>
        })}
      </svg>
    </div>
  )
}

/** Rango del pronóstico: una barra del mínimo al máximo con la marca del esperado. */
export function RangeBar({ low, expected, high, max, label }: { low: number; expected: number; high: number; max: number; label: string }) {
  const W = 220
  const x = (v: number) => (max > 0 ? 4 + (v / max) * (W - 8) : 4)
  return (
    <svg viewBox={`0 0 ${W} 22`} width={W} height="22" role="img" aria-label={label} className="block max-w-full">
      <line x1="4" y1="11" x2={W - 4} y2="11" stroke="var(--cg-line-200)" strokeWidth="2" strokeLinecap="round" />
      <line x1={x(low)} y1="11" x2={Math.max(x(low) + 2, x(high))} y2="11" stroke="var(--cg-green-500)" strokeWidth="8" strokeLinecap="round" />
      <circle cx={x(expected)} cy="11" r="5" fill="var(--cg-green-700)" stroke="var(--cg-surface)" strokeWidth="2" />
    </svg>
  )
}

/** Tabla simple de reporte: en móvil se desplaza dentro de su caja. Los números van alineados a la derecha. */
export function DataTable({ head, rows, testId, label, empty }: { head: { label: string; num?: boolean }[]; rows: { key: string; cells: ReactNode[]; testId?: string }[]; testId?: string; label: string; empty?: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[560px] border-collapse text-[14px]" data-testid={testId}>
        <thead>
          <tr className="border-y border-line text-left text-[13px] text-muted">
            {head.map((h) => <th key={h.label} scope="col" className={cx('px-3 py-2.5 font-medium first:pl-5 last:pr-5 md:first:pl-7 md:last:pr-7', h.num && 'text-right')}>{h.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-b-0" data-testid={r.testId}>
              {r.cells.map((c, i) => <td key={i} className={cx('px-3 py-3 align-top text-strong first:pl-5 last:pr-5 md:first:pl-7 md:last:pr-7', head[i]?.num && 'num text-right')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const linkClass = 'underline decoration-line-2 underline-offset-4 hover:decoration-brand'
export const BackToReports = ({ t }: { t: T }) => <p className="mb-3 text-[13px]"><Link href="/reportes" className={cx('inline-flex min-h-11 items-center font-medium text-brand-text', linkClass)} data-testid="back-reports">{t('Todos los reportes', 'All reports')}</Link></p>

/** Guardar este reporte con sus filtros: privado o compartido, y si se quiere, programado. */
export function SaveReport({ t, action, report, params, canShare }: { t: T; action: FormAction; report: string; params: Record<string, string | undefined>; canShare: boolean }) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => !!v))
  return (
    <Dialog trigger={t('Guardar reporte', 'Save report')} title={t('Guardar este reporte', 'Save this report')} testId="save-report">
      <ActionForm action={action} onOk="close" testId="save-report-form">
        <input type="hidden" name="report" value={report} />
        <input type="hidden" name="params" value={JSON.stringify(clean)} />
        <Field label={t('Nombre', 'Name')} hint={t('Se guarda con el periodo y los filtros que tienes puestos ahora.', 'It is saved with the period and filters you have on right now.')}>
          <input name="name" className="input" required minLength={2} maxLength={80} data-testid="save-report-name" />
        </Field>
        {canShare && (
          <label className="mt-4 flex min-h-11 items-center gap-3 text-[14px] text-strong">
            <input type="checkbox" name="shared" className="h-5 w-5 accent-[var(--cg-green-600)]" data-testid="save-report-shared" />
            {t('Compartir con mi equipo', 'Share with my team')}
          </label>
        )}
        <Field label={t('Programar', 'Schedule')} hint={t('El resumen te llega dentro de CONTIGO, en Reportes. Por correo todavía no: ese canal está apagado.', 'The summary arrives inside CONTIGO, in Reports. Not by email yet: that channel is off.')} className="mt-4">
          <select name="schedule" className="input" defaultValue="" data-testid="save-report-schedule">
            <option value="">{t('Sin programar', 'Not scheduled')}</option>
            <option value="daily">{t('Cada día', 'Every day')}</option>
            <option value="weekly">{t('Cada semana', 'Every week')}</option>
          </select>
        </Field>
        <div className="mt-6 flex justify-end"><Submit testId="save-report-submit">{t('Guardar', 'Save')}</Submit></div>
      </ActionForm>
    </Dialog>
  )
}

export type ViewChip = { id: string; object: ViewObject; name: string; filters: Record<string, string>; is_shared: boolean; mine: boolean; pinned: boolean }

/**
 * Vistas guardadas de una lista (UX-03): las de la persona y las compartidas, cada una con su enlace, fijar como cola y,
 * si es suya, borrar. "Guardar vista" guarda el filtro que la lista tiene puesto en este momento.
 */
export function ViewsBar({ t, object, views, current, filters, canShare, actions, activeFilters }: {
  t: T
  locale?: Locale
  object: ViewObject
  views: ViewChip[]
  /** La vista abierta (?cola=). */
  current?: string
  filters: Record<string, string | undefined>
  canShare: boolean
  actions: { save: FormAction; remove: FormAction; pin: FormAction }
  /** Cuántos filtros hay puestos: sin ninguno, la vista sería la lista completa y la pantalla lo dice. */
  activeFilters: number
}) {
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => !!v))
  const name = (v: ViewChip) => t(v.name, VIEW_EN[v.name] ?? v.name)
  const mini = 'press inline-flex h-11 items-center rounded-[10px] px-3 text-[13px] font-medium text-muted-2 hover:bg-surface-3'
  return (
    <section aria-label={t('Vistas guardadas', 'Saved views')} className="mt-4 rounded-[14px] border border-line bg-surface px-4 py-3" data-testid="views-bar">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <h2 className="mr-1 text-[13px] font-semibold text-muted-2">{t('Vistas guardadas', 'Saved views')}</h2>
        {views.length === 0 && <p className="text-[13px] text-muted" data-testid="views-empty">{t('Todavía no hay ninguna. Filtra la lista como la necesitas y guárdala con un nombre: queda a un toque y la puedes fijar como cola en tu menú.', 'There are none yet. Filter the list the way you need it and save it with a name: it stays one tap away and you can pin it as a queue in your menu.')}</p>}
        {views.map((v) => (
          <span key={v.id} className={cx('inline-flex items-center rounded-full border pr-1', current === v.id ? 'border-brand bg-green-50' : 'border-line')} data-testid="view-chip" data-view={v.name}>
            <Link href={viewHref(v)} aria-current={current === v.id ? 'page' : undefined} className="inline-flex min-h-11 items-center rounded-full pr-2 pl-4 text-[13.5px] font-semibold text-strong" data-testid="view-link">
              {name(v)}{v.is_shared && <span className="ml-2 text-[12px] font-medium text-muted">{t('del equipo', 'team')}</span>}
            </Link>
            <ActionForm action={actions.pin} className="inline-flex">
              <input type="hidden" name="id" value={v.id} /><input type="hidden" name="on" value={v.pinned ? '0' : '1'} />
              <button type="submit" className={mini} aria-label={v.pinned ? t(`Quitar "${name(v)}" de mi menú`, `Remove "${name(v)}" from my menu`) : t(`Fijar "${name(v)}" como cola en mi menú`, `Pin "${name(v)}" as a queue in my menu`)} data-testid="view-pin" aria-pressed={v.pinned}>{v.pinned ? t('Fijada', 'Pinned') : t('Fijar', 'Pin')}</button>
            </ActionForm>
            {v.mine && (
              <ActionForm action={actions.remove} className="inline-flex">
                <input type="hidden" name="id" value={v.id} />
                <button type="submit" className={mini} aria-label={t(`Borrar la vista "${name(v)}"`, `Delete the view "${name(v)}"`)} data-testid="view-delete">{t('Borrar', 'Delete')}</button>
              </ActionForm>
            )}
          </span>
        ))}
        <Dialog trigger={t('Guardar vista', 'Save view')} title={t('Guardar esta vista', 'Save this view')} testId="view-save" size="sm">
          <ActionForm action={actions.save} onOk="close" testId="view-save-form">
            <input type="hidden" name="object" value={object} />
            <input type="hidden" name="filters" value={JSON.stringify(clean)} />
            <p className="mb-4 text-[14px] text-muted-2" data-testid="view-save-what">
              {activeFilters > 0
                ? t('Se guarda la lista como la tienes ahora, con sus filtros. No guarda los registros: cada vez que la abras verás lo que cumpla esos filtros ese día.', 'The list is saved the way you have it now, with its filters. It does not save the records: each time you open it you see what matches those filters that day.')
                : t('Ahora no tienes ningún filtro puesto: esta vista abriría la lista completa. Puedes guardarla así o cerrar, filtrar y volver.', 'You have no filter on right now: this view would open the whole list. You can save it as is, or close, filter and come back.')}
            </p>
            <Field label={t('Nombre', 'Name')}><input name="name" className="input" required minLength={2} maxLength={60} data-testid="view-name" /></Field>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-[14px] text-strong"><input type="checkbox" name="pin" defaultChecked className="h-5 w-5 accent-[var(--cg-green-600)]" data-testid="view-pin-new" />{t('Fijarla como cola en mi menú', 'Pin it as a queue in my menu')}</label>
            {canShare && <label className="flex min-h-11 items-center gap-3 text-[14px] text-strong"><input type="checkbox" name="shared" className="h-5 w-5 accent-[var(--cg-green-600)]" data-testid="view-shared" />{t('Compartirla con mi equipo', 'Share it with my team')}</label>}
            <div className="mt-6 flex justify-end"><Submit testId="view-save-submit">{t('Guardar', 'Save')}</Submit></div>
          </ActionForm>
        </Dialog>
      </div>
    </section>
  )
}
