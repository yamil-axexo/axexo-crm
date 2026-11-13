import Link from 'next/link'
import type { T } from '@/lib/format'
import { buttonClass } from '@/ui/kit'
import { ExportLink } from '@/ui/report'

/** AUT-07: exportar lo filtrado (con motivo) e importar por archivo, en la lista donde se usa. Solo aparece para quien puede. */
export function DataTools({ t, canExport, canImport, exportHref, exportLabel, importHref }: { t: T; canExport: boolean; canImport: boolean; exportHref: string; exportLabel: string; importHref: string }) {
  if (!canExport && !canImport) return null
  return (
    <div className="mb-5 flex flex-wrap items-center justify-end gap-3" data-testid="data-tools">
      {canImport && <Link href={importHref} className={buttonClass('ghost')} data-testid="import-link">{t('Importar archivo', 'Import a file')}</Link>}
      {canExport && <ExportLink t={t} href={exportHref} testId="export-list">{exportLabel}</ExportLink>}
    </div>
  )
}
