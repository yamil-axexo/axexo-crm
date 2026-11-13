import { RoleBoard } from '@/ui/role-board'
import { ReportFilters } from '@/ui/report'
import { boardConfig, opsBoard } from '@/dal/role-boards'
import { emitUsage } from '@/domain/reportes2'
import { withUser } from '@/server/db'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader } from '../shell'

/** REP-01 (reportes2): el tablero de Operaciones. Su cola en cifras, cada una con definición, dueño y enlace a la cola que la corrige. */
export default async function OpsBoardPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('operaciones', searchParams)
  const { ctx, f, owners, sel } = r
  const { t, locale } = ctx
  const items = await boardConfig(ctx, 'ops')
  const values = await opsBoard(ctx, f.market ?? null)
  if (!ctx.viewAs) await withUser(ctx.user.id, (tx) => emitUsage(tx, ctx, 'usage.board_opened', f.market ?? null, { board: 'ops' }))
  return (
    <>
      <ReportHeader r={r} />
      <ReportFilters t={t} locale={locale} base="/reportes/operaciones" params={r.params} periods={[]} selects={[sel.market]} />
      <RoleBoard t={t} locale={locale} items={items} values={values} owners={owners} testId="ops-board"
        hrefs={{ opsQueue: '/operaciones', opsOverdue: '/campo?tab=expedientes', opsReturned: '/campo?tab=expedientes', opsHandoffsOpen: '/operaciones' }} />
    </>
  )
}
