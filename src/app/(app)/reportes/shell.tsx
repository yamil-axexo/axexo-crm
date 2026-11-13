import type { ReactNode } from 'react'
import { PageHeader } from '@/ui/kit'
import { ExportLink } from '@/ui/report'
import { BackToReports, SaveReport } from '@/ui/reportes'
import { saveReportAction } from './actions'
import type { loadReport } from './load'

type Loaded = Awaited<ReturnType<typeof loadReport>>

/** Encabezado común de un reporte: volver a la galería, título y descripción del catálogo, exportar (si puede) y guardar. */
export function ReportHeader({ r, extra, desc, children }: { r: Loaded; extra?: Record<string, string | undefined>; desc?: string; children?: ReactNode }) {
  const { t } = r.ctx
  return (
    <>
      <BackToReports t={t} />
      <PageHeader
        title={t(r.def.title[0], r.def.title[1])}
        desc={desc ?? t(r.def.desc[0], r.def.desc[1])}
        actions={<>
          {children}
          {r.canExport && <ExportLink t={t} href={r.exportHref(extra)}>{t('Exportar CSV', 'Export CSV')}</ExportLink>}
          <SaveReport t={t} action={saveReportAction} report={r.def.key} params={{ ...r.params, ...extra }} canShare={r.ctx.can('report.share')} />
        </>}
      />
    </>
  )
}

export const exportNote = (r: Loaded) => r.canExport
  ? <p className="mt-4 text-[13px] text-muted" data-testid="export-note">{r.ctx.t('El archivo trae las columnas de esta pantalla, sin teléfonos, correos ni contactos. Cada exportación queda en la bitácora con tu nombre, los filtros y el número de filas.', 'The file has the columns on this screen, with no phones, emails or contacts. Each export is logged with your name, the filters and the number of rows.')}</p>
  : null
