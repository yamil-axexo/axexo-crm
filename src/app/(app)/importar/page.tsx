import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getImports } from '@/dal/eventos-api'
import { IMPORT_COLUMNS, IMPORT_KINDS, IMPORT_MAX_ROWS, KIND_LABEL, type ImportKind } from '@/domain/csv-import'
import { Badge, Card, CardTitle, Empty, PageHeader, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CloseDialog } from '@/ui/admin'
import { ImportCsv } from '@/ui/import-csv'
import { day, num } from '@/lib/format'
import { importCsvAction, undoImportAction } from './actions'

export const maxDuration = 60

/** AUT-07: importar comercios, contactos y leads por archivo, con vista previa, bitácora por fila y deshacer. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('data.import')) notFound()
  const { t, locale } = ctx
  const sp = await searchParams
  const kind: ImportKind = IMPORT_KINDS.includes(sp.tipo as ImportKind) ? (sp.tipo as ImportKind) : 'accounts'
  const markets = ctx.markets.filter((m) => m.status === 'live' && ctx.can('data.import', m.code))
  const imports = await getImports(ctx)
  const plural = (n: number, one: string, many: string) => `${num(n, locale)} ${n === 1 ? one : many}`
  return (
    <>
      <PageHeader eyebrow={t('Datos', 'Data')} title={t('Importar un archivo', 'Import a file')}
        desc={t('Sube un CSV de comercios, contactos o leads. Primero se revisa completo y te decimos qué filas tienen problema; no se escribe nada hasta que confirmas. Cada fila pasa por las mismas reglas que el alta a mano.', 'Upload a CSV of merchants, contacts or leads. It is checked in full first and you see which rows have a problem; nothing is written until you confirm. Every row goes through the same rules as adding it by hand.')} />
      <div className="space-y-8">
        <Card data-testid="import-card">
          <CardTitle title={t('Archivo', 'File')} hint={t(`Hasta ${num(IMPORT_MAX_ROWS, locale)} filas y 900 KB por archivo. El archivo no se guarda: solo queda la bitácora de qué pasó con cada fila.`, `Up to ${num(IMPORT_MAX_ROWS, locale)} rows and 900 KB per file. The file is not stored: only the log of what happened to each row is kept.`)} />
          <ImportCsv action={importCsvAction} initialKind={kind}
            kinds={IMPORT_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k][0], KIND_LABEL[k][1]) }))}
            markets={markets.map((m) => ({ code: m.code, name: m.name }))}
            labels={{
              kind: t('Qué vas a importar', 'What to import'), market: t('Mercado', 'Market'), file: t('Archivo CSV', 'CSV file'),
              fileHint: t('Separado por comas o por punto y coma, con encabezados en la primera fila. Baja la plantilla para ver las columnas.', 'Comma or semicolon separated, with headers in the first row. Download the template to see the columns.'),
              check: t('Revisar archivo', 'Check file'), checking: t('Revisando...', 'Checking...'), again: t('Revisar otra vez', 'Check again'),
              run: (n) => t(`Importar ${plural(n, 'fila', 'filas')}`, `Import ${plural(n, 'row', 'rows')}`), running: t('Importando...', 'Importing...'),
              template: t('Bajar plantilla', 'Download template'),
              summary: (s) => t(`${plural(s.total, 'fila', 'filas')}: ${num(s.ok, locale)} listas para importar, ${num(s.duplicates, locale)} duplicadas y ${num(s.errors, locale)} con error.`, `${plural(s.total, 'row', 'rows')}: ${num(s.ok, locale)} ready to import, ${num(s.duplicates, locale)} duplicates and ${num(s.errors, locale)} with errors.`),
              nothing: t('Ninguna fila se puede importar. Corrige el archivo y revísalo otra vez.', 'No row can be imported. Fix the file and check it again.'),
              row: t('Fila', 'Row'), what: t('Registro', 'Record'), why: t('Qué pasa', 'What is wrong'), duplicate: t('duplicada', 'duplicate'), error: t('error', 'error'),
              more: (n) => t(`Y ${plural(n, 'fila más', 'filas más')} con problema. El reporte por fila queda disponible al importar.`, `And ${plural(n, 'more row', 'more rows')} with a problem. The per-row report is available after importing.`),
              changed: t('Cambiaste algo: revisa el archivo otra vez antes de importar.', 'You changed something: check the file again before importing.'),
              allGood: t('Todas las filas están listas.', 'Every row is ready.'),
            }} />
          <details className="mt-6 text-[13.5px]" data-testid="import-columns">
            <summary className="cursor-pointer font-semibold text-strong">{t('Columnas de cada plantilla', 'Columns in each template')}</summary>
            <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-3">
              {IMPORT_KINDS.map((k) => (
                <div key={k}>
                  <p className="font-semibold text-strong">{t(KIND_LABEL[k][0], KIND_LABEL[k][1])}</p>
                  <ul className="mt-2 space-y-1.5 text-muted-2">
                    {IMPORT_COLUMNS[k].map((c) => <li key={c.key}><code className="text-[12.5px] text-strong">{locale === 'en' ? c.names[1] : c.names[0]}</code>{c.required ? <span className="text-red-text"> *</span> : null} <span>{t(c.label[0], c.label[1])}</span></li>)}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-muted">{t('Con * las obligatorias. Los comercios importados quedan a tu nombre y se reparten desde Comercios; los leads entran sin dueño, a la vista del mercado.', 'Required ones carry a *. Imported merchants are assigned to you and can be redistributed from Merchants; leads come in with no owner, visible to the market.')}</p>
          </details>
        </Card>

        <Card pad={false} data-testid="import-history">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Importaciones', 'Imports')} hint={t('Deshacer retira lo que nadie ha trabajado desde entonces: el comercio se archiva, el lead se borra y el contacto se desliga. Lo que ya se trabajó se queda.', 'Undo removes whatever nobody has worked since: the merchant is archived, the lead is deleted and the contact is unlinked. Whatever was already worked stays.')} /></div>
          {imports.length === 0 ? (
            <div className="px-5 pb-7 md:px-7"><Empty title={t('Todavía no hay importaciones', 'No imports yet')} hint={t('Cuando subas un archivo, aquí queda qué pasó con cada uno.', 'When you upload a file, what happened to each one shows up here.')} /></div>
          ) : (
            <Table testId="import-table" label={t('Importaciones', 'Imports')} head={<><th>{t('Archivo', 'File')}</th><th>{t('Qué', 'What')}</th><th>{t('Filas', 'Rows')}</th><th>{t('Quién y cuándo', 'Who and when')}</th><th>{t('Estado', 'Status')}</th><th><span className="sr-only">{t('Acciones', 'Actions')}</span></th></>}>
              {imports.map((i) => (
                <tr key={i.id} className="table-row" data-testid="import-row">
                  <td className="max-w-[220px] [overflow-wrap:anywhere]"><span className="font-semibold text-strong">{i.file_name}</span></td>
                  <td>{t(KIND_LABEL[i.kind as ImportKind][0], KIND_LABEL[i.kind as ImportKind][1])} · {i.market_code}</td>
                  <td className="text-[13.5px]" data-testid="import-counts">{t(`${num(i.rows_created, locale)} creadas, ${num(i.rows_duplicate, locale)} duplicadas, ${num(i.rows_rejected, locale)} rechazadas`, `${num(i.rows_created, locale)} created, ${num(i.rows_duplicate, locale)} duplicates, ${num(i.rows_rejected, locale)} rejected`)}</td>
                  <td className="text-[13.5px] text-muted-2">{i.created_by} · {day(i.created_at, locale)}</td>
                  <td><Badge tone={i.status === 'done' ? 'good' : i.status === 'undone' ? 'neutral' : 'warn'}>{i.status === 'done' ? t('terminada', 'finished') : i.status === 'undone' ? t('deshecha', 'undone') : t('en curso', 'running')}</Badge></td>
                  <td className="text-right whitespace-nowrap">
                    <Link href={`/importar/reporte?id=${i.id}`} prefetch={false} className="mr-3 text-[13.5px] font-medium text-blue-text underline" data-testid="import-report">{t('Reporte por fila', 'Per-row report')}</Link>
                    {i.status === 'done' && i.rows_created > 0 && (
                      <Dialog trigger={t('Deshacer', 'Undo')} title={t(`Deshacer la importación de "${i.file_name}"`, `Undo the import of "${i.file_name}"`)} variant="quiet" size="sm" testId="import-undo">
                        <p className="text-left text-[14px] whitespace-normal text-muted-2">{t(`Se retiran los ${num(i.rows_created, locale)} registros que creó, salvo los que alguien ya trabajó. Queda en la bitácora.`, `The ${num(i.rows_created, locale)} records it created are removed, except the ones someone already worked. It is logged.`)}</p>
                        <ActionForm action={undoImportAction} className="mt-6">
                          <input type="hidden" name="id" value={i.id} />
                          <div className="flex flex-wrap justify-end gap-3"><CloseDialog>{t('Cancelar', 'Cancel')}</CloseDialog><Submit variant="danger" testId="import-undo-confirm">{t('Deshacer importación', 'Undo import')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}
