import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { networkLoad } from '@/dal/partners'
import { TARGET_LABEL, type NetworkTarget } from '@/domain/network-loads'
import { ISSUE_LABEL, LOAD_STATUS, ROW_STATUS, SYSTEM_LABEL } from '@/lib/partner-labels'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader, Table } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { day, num } from '@/lib/format'
import * as A from '../../actions'

export const dynamic = 'force-dynamic'

const small = 'text-[13px] text-muted'

/** DAT-06: una red cargada. Reporte de calidad por nodo, repetidos, liberaciones, promoción por lotes y marcha atrás. */
export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await networkLoad(ctx, id)
  if (!d) notFound()
  const l = d.load
  const st = LOAD_STATUS[l.status]
  const issue = (k: string) => t(...(ISSUE_LABEL[k] ?? [k, k]))
  return (
    <div className="mx-auto max-w-[1040px] space-y-8">
      <PageHeader
        eyebrow={`${t(...(SYSTEM_LABEL[l.source_system] ?? ['', '']))} · ${l.entity}`}
        title={l.name}
        desc={t(`Cargada el ${day(l.created_at, locale)}${l.created_by_name ? ` por ${l.created_by_name}` : ''}. ${num(l.rows_total, locale)} filas.`, `Loaded on ${day(l.created_at, locale)}${l.created_by_name ? ` by ${l.created_by_name}` : ''}. ${num(l.rows_total, locale)} rows.`)}
        actions={<><Badge tone={st?.tone ?? 'neutral'}>{t(...(st?.label ?? [l.status, l.status]))}</Badge><LinkButton href="/partners/redes" testId="net-back">{t('Volver', 'Back')}</LinkButton></>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {([['ready', l.ready], ['error', l.errors], ['duplicate', l.duplicates], ['promoted', l.promoted]] as const).map(([k, n]) => (
          <Card key={k} data-testid={`net-count-${k}`}><p className={small}>{t(...ROW_STATUS[k]!.label)}</p><p className="text-[26px] font-semibold">{num(n, locale)}</p></Card>
        ))}
      </div>

      <Card data-testid="net-release">
        <CardTitle title={t('Liberación', 'Release')} hint={t('Mientras no la liberen legal y negocio, la red solo se compara contra la cartera de su misma entidad legal y no entra a la cartera. Dan la liberación dos personas distintas.', 'Until legal and business release it, the network is only compared against its own legal entity’s portfolio and does not enter the portfolio. Two different people give the release.')} />
        <ul className="space-y-2 text-[14px] text-strong">
          <li data-testid="release-legal">{t('Legal', 'Legal')}: {l.legal_release_at ? t(`liberó ${l.legal_by} el ${day(l.legal_release_at, locale)}`, `released by ${l.legal_by} on ${day(l.legal_release_at, locale)}`) : t('pendiente', 'pending')}</li>
          <li data-testid="release-business">{t('Negocio', 'Business')}: {l.business_release_at ? t(`liberó ${l.business_by} el ${day(l.business_release_at, locale)}`, `released by ${l.business_by} on ${day(l.business_release_at, locale)}`) : t('pendiente', 'pending')}</li>
        </ul>
        {l.status === 'staged' && (
          <div className="mt-5 flex flex-wrap gap-3">
            {!l.legal_release_at && ctx.can('network.release_legal', l.market_code) && (
              <ActionForm action={A.releaseNetworkAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="kind" value="legal" /><Submit size="sm" variant="ghost" testId="release-legal-btn">{t('Dar liberación de legal', 'Give legal release')}</Submit></ActionForm>
            )}
            {!l.business_release_at && ctx.can('network.release_business', l.market_code) && (
              <ActionForm action={A.releaseNetworkAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="kind" value="business" /><Submit size="sm" variant="ghost" testId="release-business-btn">{t('Dar liberación de negocio', 'Give business release')}</Submit></ActionForm>
            )}
          </div>
        )}
      </Card>

      {(l.status === 'released' || d.batches.length > 0) && (
        <Card data-testid="net-batches">
          <CardTitle title={t('Paso a la cartera por lotes', 'Moving into the portfolio in batches')} hint={t('Cada comercio nace con su ID del sistema de origen, su lugar en el árbol y el origen "conversión de red". Las repetidas y las filas con problemas no pasan.', 'Each merchant is created with its source system ID, its place in the tree and the "network conversion" origin. Duplicates and rows with issues do not move.')} />
          {l.status === 'released' && l.ready > 0 && (
            <ActionForm action={A.promoteBatchAction} className="mb-5 flex flex-wrap items-end gap-3" testId="promote-form">
              <input type="hidden" name="id" value={l.id} />
              <Field label={t('Tamaño del lote', 'Batch size')}><input name="size" type="number" min={1} max={1000} defaultValue={200} className="input" /></Field>
              <Submit testId="promote-btn">{t('Pasar el siguiente lote', 'Move the next batch')}</Submit>
            </ActionForm>
          )}
          {d.batches.length === 0 ? <Empty title={t('Ningún lote todavía', 'No batches yet')} /> : (
            <ul data-testid="batch-list">
              {d.batches.map((b) => (
                <li key={b.batch} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0" data-testid="batch-row">
                  <p className="text-[14px] text-strong">{t(`Lote ${b.batch}: ${b.promoted} en la cartera${b.kept ? `, ${b.kept} se quedaron` : ''}`, `Batch ${b.batch}: ${b.promoted} in the portfolio${b.kept ? `, ${b.kept} stayed` : ''}`)}</p>
                  {b.promoted > 0 && (
                    <ActionForm action={A.rollbackBatchAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="batch" value={b.batch} /><Submit size="sm" variant="quiet" testId="rollback-btn">{t('Regresar este lote', 'Roll back this batch')}</Submit></ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card data-testid="net-quality">
        <CardTitle title={t('Reporte de calidad', 'Quality report')} hint={t('Por nodo: de quién cuelga cada fila en el archivo.', 'By node: what each row hangs from in the file.')} />
        {d.issues.length > 0 && (
          <ul className="mb-5 flex flex-wrap gap-2" data-testid="net-issues">
            {d.issues.map((i) => <li key={i.issue}><Badge tone="warn">{issue(i.issue)}: {num(i.n, locale)}</Badge></li>)}
          </ul>
        )}
        <Table label={t('Calidad por nodo', 'Quality by node')} testId="net-nodes" head={<><th>{t('Nodo', 'Node')}</th><th>{t('Filas', 'Rows')}</th><th>{t('Listas', 'Ready')}</th><th>{t('Con problemas', 'With issues')}</th><th>{t('Repetidas', 'Duplicates')}</th><th>{t('En la cartera', 'In the portfolio')}</th></>}>
          {d.byNode.map((n) => (
            <tr key={n.node}><td>{n.node || t('Raíz de la red', 'Network root')}</td><td className="num">{num(n.total, locale)}</td><td className="num">{num(n.ready, locale)}</td><td className="num">{num(n.errors, locale)}</td><td className="num">{num(n.duplicates, locale)}</td><td className="num">{num(n.promoted, locale)}</td></tr>
          ))}
        </Table>
      </Card>

      <Card pad={false} data-testid="net-rows">
        <div className="p-7 pb-0"><CardTitle title={t('Filas', 'Rows')} hint={t(`Primero las que piden revisión. Mapeo: ${Object.entries(l.mapping).map(([k, v]) => `${TARGET_LABEL[k as NetworkTarget]?.[0] ?? k} = ${v}`).join(', ')}.`, `Those needing review first. Mapping: ${Object.entries(l.mapping).map(([k, v]) => `${TARGET_LABEL[k as NetworkTarget]?.[1] ?? k} = ${v}`).join(', ')}.`)} /></div>
        <Table label={t('Filas', 'Rows')} testId="net-rows-table" head={<><th>{t('Fila', 'Row')}</th><th>ID</th><th>{t('Nombre', 'Name')}</th><th>{t('Estado', 'Status')}</th><th>{t('Detalle', 'Detail')}</th></>}>
          {d.rows.map((r) => (
            <tr key={r.line} data-testid="net-row">
              <td className="num">{r.line}</td><td>{r.external_id}</td><td>{r.name}<p className={small}>{[r.phone, r.locality].filter(Boolean).join(' · ')}</p></td>
              <td><Badge tone={ROW_STATUS[r.status]?.tone ?? 'neutral'}>{t(...(ROW_STATUS[r.status]?.label ?? [r.status, r.status]))}</Badge></td>
              <td className="text-[13px]">
                {r.issues.map(issue).join(', ')}
                {r.dup_key && <>{issue(`dup_${r.dup_key}`)}{r.dup_id && <>: <Link href={`/comercios/${r.dup_id}`} className="text-blue-text hover:underline">{r.dup_name}</Link></>}</>}
                {r.account_id && <Link href={`/comercios/${r.account_id}`} className="text-blue-text hover:underline">{t('Ver comercio', 'View merchant')}</Link>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
