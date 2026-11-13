import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { networkLoads, networkSetup } from '@/dal/partners'
import { DEFAULT_MAPPING, NETWORK_SYSTEMS, NETWORK_TARGETS, TARGET_LABEL, MAX_ROWS } from '@/domain/network-loads'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader, Table } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { day, num } from '@/lib/format'
import { flat } from '@/server/params'
import * as A from '../actions'
import { LOAD_STATUS, SYSTEM_LABEL } from '@/lib/partner-labels'

export const dynamic = 'force-dynamic'

/** DAT-06: redes adquiridas. Se cargan aparte, se revisan y solo entran a la cartera por lotes después de las dos liberaciones. */
export default async function NetworksPage({ searchParams }: { searchParams: Promise<{ m?: string; s?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const markets = ctx.markets.filter((m) => ctx.can('network.load', m.code))
  if (markets.length === 0) notFound()
  const sp = flat(await searchParams)
  const market = markets.find((m) => m.code === sp.m)?.code ?? markets[0]!.code
  const system = (NETWORK_SYSTEMS as readonly string[]).includes(sp.s ?? '') ? sp.s! : 'emida'
  const [loads, setup] = await Promise.all([networkLoads(ctx), networkSetup(ctx, market)])
  const mapping = { ...DEFAULT_MAPPING, ...(setup.lastMapping[system] ?? {}) } as Record<string, string>
  return (
    <div className="mx-auto max-w-[1040px] space-y-8">
      <PageHeader
        eyebrow={t('Partners', 'Partners')}
        title={t('Redes adquiridas', 'Acquired networks')}
        desc={t('La red comprada entra a un espacio aparte: no se mezcla con la cartera hasta que legal y negocio la liberan. Ahí se revisan calidad y repetidos; después pasa por lotes, y cada lote se puede regresar.', 'The acquired network goes into a separate space: it does not mix with the portfolio until legal and business release it. Quality and duplicates are reviewed there; then it moves in batches, and each batch can be rolled back.')}
        actions={<LinkButton href="/partners" testId="nets-back">{t('Volver', 'Back')}</LinkButton>}
      />

      <Card pad={false} data-testid="loads-card">
        <div className="p-7 pb-0"><CardTitle title={t('Cargas', 'Loads')} /></div>
        {loads.length === 0 ? <div className="p-7"><Empty title={t('Sin redes cargadas', 'No networks loaded')} hint={t('Carga el archivo de la red con el formulario de abajo.', 'Load the network file with the form below.')} /></div> : (
          <Table label={t('Cargas', 'Loads')} testId="loads-table" head={<><th>{t('Red', 'Network')}</th><th>{t('Entidad legal', 'Legal entity')}</th><th>{t('Filas', 'Rows')}</th><th>{t('Listas', 'Ready')}</th><th>{t('Con problemas', 'With issues')}</th><th>{t('Repetidas', 'Duplicates')}</th><th>{t('Estado', 'Status')}</th></>}>
            {loads.map((l) => (
              <tr key={l.id} data-testid="load-row">
                <td><Link href={`/partners/redes/${l.id}`} className="font-medium text-blue-text hover:underline">{l.name}</Link><p className="text-[12.5px] text-muted">{t(...(SYSTEM_LABEL[l.source_system] ?? ['', '']))} · {day(l.created_at, locale)}</p></td>
                <td>{l.entity}</td>
                <td className="num">{num(l.rows_total, locale)}</td><td className="num">{num(l.ready, locale)}</td><td className="num">{num(l.errors, locale)}</td><td className="num">{num(l.duplicates, locale)}</td>
                <td><Badge tone={LOAD_STATUS[l.status]?.tone ?? 'neutral'}>{t(...(LOAD_STATUS[l.status]?.label ?? [l.status, l.status]))}</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card data-testid="load-new">
        <CardTitle title={t('Cargar una red', 'Load a network')} hint={t(`Archivo CSV, hasta ${num(MAX_ROWS, locale)} filas. El mapeo dice qué columna del archivo es cada dato; se guarda y la próxima carga del mismo sistema lo trae puesto.`, `CSV file, up to ${num(MAX_ROWS, locale)} rows. The mapping says which file column holds each field; it is saved and the next load from the same system brings it filled in.`)}
          right={<div className="flex flex-wrap gap-2">{NETWORK_SYSTEMS.map((s) => <LinkButton key={s} size="sm" variant={s === system ? 'primary' : 'ghost'} href={`/partners/redes?m=${market}&s=${s}`}>{t(...SYSTEM_LABEL[s]!)}</LinkButton>)}</div>} />
        <ActionForm action={A.stageNetworkAction} testId="load-form">
          <input type="hidden" name="market" value={market} />
          <input type="hidden" name="system" value={system} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Nombre de la carga', 'Load name')}><input name="name" className="input" required maxLength={120} data-testid="load-name" /></Field>
            <Field label={t('Entidad legal (solo ella la ve hasta liberar)', 'Legal entity (only it sees the load until release)')}>
              <select name="entity_id" className="input" required defaultValue={setup.entities[0]?.id ?? ''} data-testid="load-entity">
                {setup.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <Field label={t('Cuelga de (opcional)', 'Hangs from (optional)')} hint={t('La cuenta raíz de la red; sin ella, los nodos sin padre quedan sueltos.', 'The network’s root account; without it, nodes with no parent stay on their own.')}>
              <select name="root_account_id" className="input" defaultValue=""><option value="">{t('Sin raíz', 'No root')}</option>{setup.roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </Field>
            <Field label={t('Archivo CSV', 'CSV file')}><input name="file" type="file" accept=".csv,text/csv" className="input" required data-testid="load-file" /></Field>
          </div>
          <fieldset className="mt-6">
            <legend className="mb-3 text-[14px] font-semibold text-strong">{t('Mapeo de columnas', 'Column mapping')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {NETWORK_TARGETS.map((k) => (
                <Field key={k} label={t(...TARGET_LABEL[k])}><input name={`map_${k}`} className="input" defaultValue={mapping[k] ?? ''} data-testid={`map-${k}`} /></Field>
              ))}
            </div>
          </fieldset>
          <div className="mt-5"><Submit testId="load-save">{t('Cargar en espacio aparte', 'Load into separate space')}</Submit></div>
        </ActionForm>
      </Card>
    </div>
  )
}
