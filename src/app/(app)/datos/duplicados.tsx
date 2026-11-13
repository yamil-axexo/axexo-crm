import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { duplicateQueue, type Side } from '@/dal/datos'
import { SURVIVOR_FIELDS } from '@/domain/datos'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, Pills, Table, NoData } from '@/ui/kit'
import { Dialog, Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { ago, day, num, phoneText } from '@/lib/format'
import { LIFECYCLE, MOTOR, lab, qs } from '@/lib/labels'
import { MATCH_KIND, SURVIVOR_LABEL, SURVIVOR_REASON } from '@/lib/datos-labels'
import { dismissPairAction, mergePairAction, reviewBypassAction, scanDuplicatesAction, undoMergeAction } from './actions'

/**
 * DAT-04: cola de duplicados. Dos registros se comparan lado a lado, una persona decide cuál queda y qué valor gana en
 * cada campo, y la fusión guarda la foto previa para poder deshacerla. Nada se fusiona solo.
 */
export async function DuplicadosTab({ ctx, market, pairId }: { ctx: Ctx; market: string | null; pairId: string | null }) {
  const { t, locale } = ctx
  const d = await duplicateQueue(ctx, market, null)
  const picked = pairId ? (await duplicateQueue(ctx, null, pairId)).pairs[0] : undefined
  const markets = ctx.markets.filter((m) => m.status === 'live')
  const canReview = (m: string) => ctx.can('duplicate.review', m)
  const canMerge = (m: string) => ctx.can('account.merge', m)
  const scanMarkets = markets.filter((m) => canReview(m.code))
  const totalOpen = d.counts.filter((c) => !market || c.market_code === market).reduce((a, c) => a + c.open, 0)
  // Las fechas se dicen en el día del mercado, no en el del servidor.
  const tzOf = (code: string) => ctx.markets.find((x) => x.code === code)?.timezone ?? 'UTC'
  const kinds = (ks: string[]) => ks.map((k) => <Badge key={k} tone={k === 'name' ? 'neutral' : 'warn'}>{lab(t, MATCH_KIND[k], k)}</Badge>)
  const value = (s: Side, f: string): string | null => {
    if (f === 'territory_id') return s.territory
    if (f === 'owner_id') return s.owner_name
    if (f === 'segment') return s.segment ? lab(t, MOTOR[s.segment], s.segment) : null
    if (f === 'phone') return s.phone ? phoneText(s.phone) : null
    return (s as unknown as Record<string, string | null>)[f] ?? null
  }

  return (
    <div className="space-y-8" data-testid="duplicates-tab">
      {markets.length > 1 && <Pills label={t('Mercado', 'Market')} current={market ?? ''} items={[{ key: '', href: qs('/datos', { tab: 'duplicados' }), label: t('Todos', 'All') }, ...markets.map((m) => ({ key: m.code, href: qs('/datos', { tab: 'duplicados', mercado: m.code }), label: m.name, count: d.counts.find((c) => c.market_code === m.code)?.open ?? 0 }))]} />}

      {picked && (
        <Card pad={false} id="comparar" data-testid="pair-compare">
          <div className="px-5 pt-6 md:px-7 md:pt-7">
            <CardTitle title={t('Comparar los dos registros', 'Compare the two records')} hint={t('Elige cuál se queda. En cada campo gana el dato del que se queda; si no lo tiene, toma el del otro. Puedes elegir a mano el valor del otro registro.', 'Choose which one stays. For each field the surviving record’s value wins; if it has none, it takes the other one’s. You can pick the other record’s value by hand.')}
              right={<LinkButton href={qs('/datos', { tab: 'duplicados', mercado: market })} size="sm">{t('Cerrar', 'Close')}</LinkButton>} />
            <p className="mb-4 flex flex-wrap gap-2">{kinds(picked.match_kinds)}</p>
          </div>
          <NoticeForm action={mergePairAction} testId="merge-form">
            <input type="hidden" name="a_id" value={picked.a.id} /><input type="hidden" name="b_id" value={picked.b.id} />
            <Table label={t('Comparación lado a lado', 'Side-by-side comparison')} head={<><th>{t('Campo', 'Field')}</th><th>{picked.a.name}</th><th>{picked.b.name}</th></>}>
              <tr className="table-row">
                <td className="font-semibold text-strong">{t('Se queda', 'Stays')}</td>
                {[picked.a, picked.b].map((s, i) => (
                  <td key={s.id}><label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]"><input type="radio" name="keep" value={s.id} defaultChecked={i === 0} className="h-5 w-5 shrink-0" data-testid={`keep-${i === 0 ? 'a' : 'b'}`} />{t('Este es el que queda', 'Keep this one')}</label></td>
                ))}
              </tr>
              {SURVIVOR_FIELDS.map((f) => {
                const va = value(picked.a, f)
                const vb = value(picked.b, f)
                const differ = va !== vb && va !== null && vb !== null
                return (
                  <tr key={f} className="table-row" data-testid="compare-row" data-field={f} data-differ={differ ? 'yes' : 'no'}>
                    <td className="text-[13.5px] text-muted-2">{lab(t, SURVIVOR_LABEL[f])}</td>
                    {[{ s: picked.a, v: va }, { s: picked.b, v: vb }].map(({ s, v }, i) => (
                      <td key={s.id} className="text-[14px]">
                        {differ ? (
                          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name={`pick_${f}`} value={s.id} className="h-5 w-5 shrink-0" data-testid={`pick-${f}-${i === 0 ? 'a' : 'b'}`} /><span className="[overflow-wrap:anywhere]">{v}</span></label>
                        ) : v ? <span className="[overflow-wrap:anywhere]">{v}</span> : <NoData locale={locale} />}
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr className="table-row">
                <td className="text-[13.5px] text-muted-2">{t('Lo que cuelga de cada uno', 'What hangs off each one')}</td>
                {[picked.a, picked.b].map((s) => (
                  <td key={s.id} className="text-[13.5px] text-muted-2" data-testid="compare-counts">
                    <Link href={`/comercios/${s.id}`} className="font-medium text-blue-text underline">{t('Abrir ficha', 'Open record')}</Link>
                    <span className="block">{lab(t, LIFECYCLE[s.lifecycle]?.label, s.lifecycle)} · {t(`creado el ${day(s.created_at, locale, tzOf(picked.market_code))}`, `created on ${day(s.created_at, locale, tzOf(picked.market_code))}`)}</span>
                    <span className="block">{t(`${s.deals} negocios · ${s.activities} actividades · ${s.contacts} contactos · ${s.aliases} ID de otros sistemas`, `${s.deals} deals · ${s.activities} activities · ${s.contacts} contacts · ${s.aliases} IDs from other systems`)}</span>
                  </td>
                ))}
              </tr>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 md:px-7">
              <p className="max-w-xl text-[13px] text-muted">{t('Al fusionar, todo lo del otro registro (negocios, visitas, actividades, contactos, ID de otros sistemas, productos) pasa al que queda y el otro se archiva. Se puede deshacer.', 'On merging, everything on the other record (deals, visits, activities, contacts, IDs from other systems, products) moves to the one that stays and the other is archived. It can be undone.')}</p>
              {canMerge(picked.market_code) ? <Submit testId="merge-confirm">{t('Fusionar', 'Merge')}</Submit> : <span className="text-[13px] text-muted-2" data-testid="merge-admin-only">{t('Fusionar es de administración. Tú puedes descartar el par.', 'Merging is for administration. You can dismiss the pair.')}</span>}
            </div>
          </NoticeForm>
          {canReview(picked.market_code) && (
            <NoticeForm action={dismissPairAction} className="border-t border-line px-5 py-5 md:px-7" testId="dismiss-form">
              <input type="hidden" name="pair_id" value={picked.id} />
              <Field label={t('No son el mismo comercio: ¿por qué?', 'They are not the same merchant: why?')} hint={t('El par sale de la cola y no vuelve a aparecer.', 'The pair leaves the queue and does not come back.')}>
                <input name="note" className="input" required minLength={5} maxLength={300} data-testid="dismiss-note" />
              </Field>
              <div className="mt-3 flex justify-end"><Submit variant="ghost" testId="dismiss-confirm">{t('Descartar el par', 'Dismiss the pair')}</Submit></div>
            </NoticeForm>
          )}
        </Card>
      )}

      <Card pad={false} data-testid="pair-queue">
        <div className="px-5 pt-6 md:px-7 md:pt-7">
          <CardTitle title={t('Pares por decidir', 'Pairs to decide')} hint={t('Primero los que comparten una llave fuerte: teléfono, correo, o nombre y dirección iguales. Después, los de nombre parecido en la misma ciudad.', 'First the ones that share a strong key: same phone, same email, or same name and address. Then the ones with a similar name in the same city.')} />
          {scanMarkets.length > 0 && (
              <NoticeForm action={scanDuplicatesAction} className="mb-5 flex flex-wrap items-end gap-2" testId="scan-form">
                {scanMarkets.length > 1 ? <select name="market" className="input !w-auto" defaultValue={market ?? scanMarkets[0]!.code} aria-label={t('Mercado donde buscar', 'Market to search')}>{scanMarkets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select> : <input type="hidden" name="market" value={scanMarkets[0]!.code} />}
                <Submit variant="ghost" size="sm" testId="scan-run">{t('Buscar ahora', 'Search now')}</Submit>
              </NoticeForm>
          )}

        </div>
        {d.pairs.length === 0 ? (
          <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('No hay pares por decidir', 'No pairs to decide')} hint={t('La búsqueda corre una vez al día. Con "Buscar ahora" corre en este momento.', 'The search runs once a day. "Search now" runs it right away.')} /></div>
        ) : (
          <ul>
            {d.pairs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 md:px-7" data-testid="pair-row" data-strong={p.strong ? 'yes' : 'no'}>
                <span className="min-w-0 text-[14px]">
                  <span className="font-semibold text-strong [overflow-wrap:anywhere]">{p.a.name}</span><span className="mx-2 text-muted">{t('y', 'and')}</span><span className="font-semibold text-strong [overflow-wrap:anywhere]">{p.b.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-2">{ctx.markets.length > 1 && <span>{p.market_code}</span>}{[p.a.locality, p.b.locality].filter(Boolean)[0] && <span>{[p.a.locality, p.b.locality].filter(Boolean)[0]}</span>}{kinds(p.match_kinds)}</span>
                </span>
                <LinkButton href={`${qs('/datos', { tab: 'duplicados', mercado: market, par: p.id })}#comparar`} size="sm" testId="pair-open">{t('Comparar', 'Compare')}</LinkButton>
              </li>
            ))}
          </ul>
        )}
        {totalOpen > d.pairs.length && <p className="border-t border-line px-5 py-4 text-[13px] text-muted md:px-7">{t(`Se muestran ${d.pairs.length} de ${num(totalOpen, locale)}. Al decidir uno, entra el siguiente.`, `Showing ${d.pairs.length} of ${num(totalOpen, locale)}. As you decide one, the next comes in.`)}</p>}
      </Card>

      <Card data-testid="bypass-list">
        <CardTitle title={t('Avisos de duplicado que se saltaron', 'Skipped duplicate warnings')} hint={t('Alguien creó un comercio aunque se parecía a otro y escribió por qué. Aquí se revisa cada uno.', 'Someone created a merchant even though it looked like another one and said why. Each one is reviewed here.')} />
        {d.bypasses.length === 0 ? <Empty title={t('Nada por revisar', 'Nothing to review')} hint={t('Cuando alguien cree un comercio a pesar del aviso, aparece aquí con su motivo.', 'When someone creates a merchant despite the warning, it shows here with the reason.')} /> : (
          <ul>
            {d.bypasses.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-4 first:border-t-0" data-testid="bypass-row">
                <span className="min-w-0 text-[14px]">
                  <Link href={`/comercios/${b.account_id}`} className="font-semibold text-strong underline [overflow-wrap:anywhere]">{b.account_name}</Link>
                  <span className="text-muted-2"> {t('se parece a', 'looks like')} {b.matched.join(', ')}</span>
                  <span className="mt-1 block text-[13px] text-muted-2">{t('Motivo', 'Reason')}: <span className="text-strong" data-testid="bypass-reason">{b.reason}</span></span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">{b.actor} · {ago(b.created_at, locale)} {kinds(b.match_kinds)}</span>
                </span>
                {canReview(b.market_code) && (
                  <NoticeForm action={reviewBypassAction}><input type="hidden" name="bypass_id" value={b.id} /><input type="hidden" name="note" value="" /><Submit variant="ghost" size="sm" testId="bypass-review">{t('Marcar revisado', 'Mark reviewed')}</Submit></NoticeForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="merge-history">
        <CardTitle title={t('Fusiones recientes', 'Recent merges')} hint={t('Cada fusión guarda cómo estaban los dos registros. Deshacerla los separa otra vez; lo que se registró después se queda con el que quedó.', 'Each merge keeps how both records were. Undoing it splits them again; anything logged afterwards stays with the surviving one.')} />
        {d.merges.length === 0 ? <Empty title={t('Todavía no hay fusiones', 'No merges yet')} hint={t('Las fusiones aparecen aquí con quién las hizo y qué dato ganó en cada campo.', 'Merges show here with who did them and which value won for each field.')} /> : (
          <ul>
            {d.merges.map((e) => {
              const taken = Object.entries(e.fields).filter(([, v]) => v.winner === 'source')
              const movedCount = Object.entries(e.moved).filter(([k]) => !['contacts_closed', 'contacts_unprimary', 'metric_days'].includes(k)).reduce((a, [, v]) => a + v.length, 0)
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-4 first:border-t-0" data-testid="merge-row" data-undone={e.undone_at ? 'yes' : 'no'}>
                  <span className="min-w-0 text-[14px]">
                    <span className="text-muted-2 [overflow-wrap:anywhere]">{e.source_name}</span><span className="mx-2 text-muted">{t('se fusionó en', 'was merged into')}</span>
                    <Link href={`/comercios/${e.target_id}`} className="font-semibold text-strong underline [overflow-wrap:anywhere]">{e.target_name}</Link>
                    <span className="mt-1 block text-[13px] text-muted">{[e.merged_by, day(e.merged_at, locale, tzOf(e.market_code)), t(`${movedCount} registros movidos`, `${movedCount} records moved`)].filter(Boolean).join(' · ')}</span>
                    {taken.length > 0 && <span className="mt-1 block text-[13px] text-muted-2" data-testid="merge-survivors">{t('Del archivado se tomó', 'Taken from the archived one')}: {taken.map(([f, v]) => `${lab(t, SURVIVOR_LABEL[f], f)} (${lab(t, SURVIVOR_REASON[v.reason])})`).join('; ')}</span>}
                    {e.undone_at && <span className="mt-1 block text-[13px] text-amber-text" data-testid="merge-undone">{t(`Se deshizo el ${day(e.undone_at, locale, tzOf(e.market_code))}: ${e.undo_reason ?? ''}`, `Undone on ${day(e.undone_at, locale, tzOf(e.market_code))}: ${e.undo_reason ?? ''}`)}</span>}
                  </span>
                  {!e.undone_at && ctx.can('account.merge') && (
                    <Dialog trigger={t('Deshacer', 'Undo')} title={t('Deshacer la fusión', 'Undo the merge')} size="sm" testId="merge-undo">
                      <NoticeForm action={undoMergeAction} className="space-y-4 text-left">
                        <input type="hidden" name="event_id" value={e.id} />
                        <p className="text-[14px] text-muted-2">{t(`"${e.source_name}" vuelve a existir con sus datos de antes y recupera lo que se había movido.`, `"${e.source_name}" exists again with its earlier details and gets back what had been moved.`)}</p>
                        <Field label={t('¿Por qué se deshace?', 'Why is it being undone?')}><input name="reason" className="input" required minLength={5} maxLength={300} data-testid="undo-reason" /></Field>
                        <div className="flex justify-end"><Submit variant="danger" testId="undo-confirm">{t('Deshacer la fusión', 'Undo the merge')}</Submit></div>
                      </NoticeForm>
                    </Dialog>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
