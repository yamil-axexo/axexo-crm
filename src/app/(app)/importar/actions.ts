'use server'

import { runAction, str } from '@/server/action'
import { IMPORT_KINDS, IMPORT_MAX_BYTES, previewImport, runImport, undoImport, type ImportKind } from '@/domain/csv-import'
import { invalid, type ActionResult } from '@/lib/errors'

export type ImportState =
  | { step: 'preview'; checksum: string; fileName: string; total: number; ok: number; duplicates: number; errors: number; fileProblem: string | null; rows: { rowNo: number; status: 'duplicate' | 'error'; label: string; problems: string[] }[]; more: number }
  | { step: 'done'; id: string; total: number; created: number; duplicates: number; rejected: number }

const SHOWN = 100

/** Un solo formulario para los dos pasos: revisar (no escribe nada) e importar. El archivo viaja en la solicitud y no se guarda. */
export async function importCsvAction(_: ActionResult<ImportState> | null, fd: FormData): Promise<ActionResult<ImportState>> {
  return runAction<ImportState>(async (ctx) => {
    const kind = str(fd, 'kind') as ImportKind
    if (!IMPORT_KINDS.includes(kind)) throw invalid('Elige qué vas a importar.', 'Pick what to import.')
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) throw invalid('Elige un archivo CSV.', 'Pick a CSV file.')
    if (file.size > IMPORT_MAX_BYTES) throw invalid('El archivo pesa más de 900 KB. Divídelo en partes.', 'The file is larger than 900 KB. Split it into parts.')
    const base = { kind, market: str(fd, 'market'), fileName: (file.name || 'archivo.csv').slice(0, 160), text: await file.text() }
    if (str(fd, 'intent') === 'run') {
      const out = await runImport(ctx, { ...base, checksum: str(fd, 'checksum') })
      return {
        data: { step: 'done', ...out },
        message: [`Importación terminada: ${out.created} creados, ${out.duplicates} duplicados que no se tocaron y ${out.rejected} rechazados.`, `Import finished: ${out.created} created, ${out.duplicates} duplicates left untouched and ${out.rejected} rejected.`],
      }
    }
    const p = await previewImport(ctx, base)
    const bad = p.rows.filter((r) => r.status !== 'ok')
    return {
      revalidate: [],
      data: {
        step: 'preview', checksum: p.checksum, fileName: p.fileName, total: p.total, ok: p.ok, duplicates: p.duplicates, errors: p.errors,
        fileProblem: p.fileProblem ? ctx.t(p.fileProblem[0], p.fileProblem[1]) : null,
        rows: bad.slice(0, SHOWN).map((r) => ({ rowNo: r.rowNo, status: r.status as 'duplicate' | 'error', label: r.label.slice(0, 80), problems: r.problems.map((x) => ctx.t(x[0], x[1])) })),
        more: Math.max(0, bad.length - SHOWN),
      },
    }
  })
}

export async function undoImportAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    const out = await undoImport(ctx, str(fd, 'id'))
    return { message: [`Importación deshecha: ${out.undone} registros retirados${out.kept ? ` y ${out.kept} que se quedan porque alguien ya los trabajó` : ''}.`, `Import undone: ${out.undone} records removed${out.kept ? ` and ${out.kept} kept because someone already worked them` : ''}.`] }
  })
}
