import type { Ctx } from '@/server/context'
import { contactQueue } from '@/dal/datos2'
import { Badge, Card, CardTitle, Empty, Field } from '@/ui/kit'
import { Dialog, Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { day, phoneText } from '@/lib/format'
import { withUser } from '@/server/db'
import { canMergeHere } from '@/domain/contacts-dedup'
import { dismissContactPairAction, mergeContactsAction, undoContactMergeAction } from './actions'

type Pair = [es: string, en: string]
const SOURCE: Record<string, Pair> = {
  cleanup: ['Limpieza de teléfonos repetidos', 'Clean-up of repeated phones'],
  lead: ['Conversión de un lead', 'Lead conversion'],
  form: ['Segunda solicitud de un formulario', 'Second form request'],
  pipedrive: ['Carga de Pipedrive', 'Pipedrive load'],
  sales_app: ['Sales App', 'Sales App'],
  manual: ['Captura a mano', 'Manual entry'],
}

/**
 * DAT-02: contactos con el mismo teléfono. Un teléfono es de una sola persona por mercado; cuando dos registros lo traen con
 * nombres distintos, el segundo queda con el teléfono "en espera" y aquí una persona decide: es la misma (fusionar, se puede
 * deshacer) o no lo es (el par sale de la cola).
 */
export async function ContactosDuplicados({ ctx, market }: { ctx: Ctx; market: string | null }) {
  const { t, locale } = ctx
  const q = await contactQueue(ctx, market)
  const mergeIn = new Map<string, boolean>()
  await withUser(ctx.user.id, async (tx) => {
    for (const code of new Set([...q.pairs.map((p) => p.market_code), ...q.merges.map((m) => m.market_code)])) mergeIn.set(code, await canMergeHere(tx, ctx, code))
  })
  const phoneOf = (s: { phone: string | null; held_phone: string | null }) =>
    s.phone ? phoneText(s.phone) : s.held_phone ? t(`${phoneText(s.held_phone)} (en espera)`, `${phoneText(s.held_phone)} (on hold)`) : t('Sin teléfono', 'No phone')
  return (
    <Card pad={false} data-testid="contact-pairs">
      <div className="px-5 pt-6 md:px-7 md:pt-7">
        <CardTitle title={t('Contactos con el mismo teléfono', 'Contacts with the same phone')} hint={t('Un teléfono es de una sola persona en cada mercado. Si dos contactos lo traen con nombres distintos, el más reciente queda con el teléfono en espera hasta que alguien decida.', 'A phone belongs to one person in each market. If two contacts carry it with different names, the newer one keeps the phone on hold until someone decides.')} />
      </div>
      {q.pairs.length === 0 ? (
        <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('No hay contactos por decidir', 'No contacts to decide')} hint={t('Aparecen aquí cuando un lead, un formulario, la Sales App o la carga de Pipedrive traen un teléfono que ya es de otra persona.', 'They show here when a lead, a form, the Sales App or the Pipedrive load brings a phone that already belongs to someone else.')} /></div>
      ) : (
        <ul>
          {q.pairs.map((p) => (
            <li key={p.id} className="border-t border-line px-5 py-5 md:px-7" data-testid="contact-pair-row">
              <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-2"><Badge tone="warn">{t('Mismo teléfono', 'Same phone')}</Badge>{t(...(SOURCE[p.source] ?? [p.source, p.source]))}{ctx.markets.length > 1 && <span>· {p.market_code}</span>}</p>
              <NoticeForm action={mergeContactsAction} testId="contact-merge-form">
                <input type="hidden" name="a_id" value={p.a.id} /><input type="hidden" name="b_id" value={p.b.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  {[p.a, p.b].map((s, i) => (
                    <label key={s.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[14px] border border-line p-4 text-[14px]">
                      <input type="radio" name="keep" value={s.id} defaultChecked={s.id === p.suggested_keep} className="mt-0.5 h-5 w-5 shrink-0" data-testid={`contact-keep-${i === 0 ? 'a' : 'b'}`} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-strong [overflow-wrap:anywhere]" data-testid="contact-pair-name">{s.full_name}</span>
                        <span className="block text-muted-2">{phoneOf(s)}{s.email ? ` · ${s.email}` : ''}</span>
                        <span className="block text-[13px] text-muted">{s.accounts.length ? s.accounts.join(', ') : t('Sin cuenta', 'No account')} · {t(`desde el ${day(s.created_at, locale)}`, `since ${day(s.created_at, locale)}`)}</span>
                        {s.id === p.suggested_keep && <span className="mt-1 block text-[12.5px] font-medium text-blue-text">{t('Sugerido: el que se queda', 'Suggested: the one that stays')}</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                  {mergeIn.get(p.market_code) ? <Submit size="sm" testId="contact-merge">{t('Es la misma persona: fusionar', 'Same person: merge')}</Submit> : <span className="text-[13px] text-muted-2">{t('Fusionar no está abierto para tu rol en este mercado.', 'Merging is not open to your role in this market.')}</span>}
                </div>
              </NoticeForm>
              <NoticeForm action={dismissContactPairAction} className="mt-3 flex flex-wrap items-end gap-3" testId="contact-dismiss-form">
                <input type="hidden" name="pair_id" value={p.id} />
                <Field label={t('No son la misma persona: ¿por qué?', 'They are different people: why?')} className="min-w-56 flex-1"><input name="note" className="input" required minLength={5} maxLength={300} data-testid="contact-dismiss-note" /></Field>
                <Submit size="sm" variant="ghost" testId="contact-dismiss">{t('Descartar el par', 'Dismiss the pair')}</Submit>
              </NoticeForm>
            </li>
          ))}
        </ul>
      )}
      {q.open > q.pairs.length && <p className="border-t border-line px-5 py-4 text-[13px] text-muted md:px-7">{t(`Se muestran ${q.pairs.length} de ${q.open}.`, `Showing ${q.pairs.length} of ${q.open}.`)}</p>}
      {q.merges.length > 0 && (
        <div className="border-t border-line px-5 py-5 md:px-7" data-testid="contact-merges">
          <p className="mb-2 text-[14px] font-semibold text-strong">{t('Fusiones de contactos recientes', 'Recent contact merges')}</p>
          <ul>
            {q.merges.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-[14px]" data-testid="contact-merge-row" data-undone={m.undone_at ? 'yes' : 'no'}>
                <span className="min-w-0"><span className="text-muted-2">{m.source_name}</span> {t('se fusionó en', 'was merged into')} <span className="font-semibold text-strong">{m.target_name}</span>
                  <span className="block text-[13px] text-muted">{[m.merged_by, day(m.merged_at, locale)].filter(Boolean).join(' · ')}{m.undone_at ? t(` · se deshizo: ${m.undo_reason ?? ''}`, ` · undone: ${m.undo_reason ?? ''}`) : ''}</span></span>
                {!m.undone_at && mergeIn.get(m.market_code) && (
                  <Dialog trigger={t('Deshacer', 'Undo')} title={t('Deshacer la fusión del contacto', 'Undo the contact merge')} size="sm" testId="contact-undo">
                    <NoticeForm action={undoContactMergeAction} className="space-y-4 text-left">
                      <input type="hidden" name="event_id" value={m.id} />
                      <Field label={t('¿Por qué se deshace?', 'Why is it being undone?')}><input name="reason" className="input" required minLength={5} maxLength={300} data-testid="contact-undo-reason" /></Field>
                      <div className="flex justify-end"><Submit variant="danger" testId="contact-undo-confirm">{t('Deshacer la fusión', 'Undo the merge')}</Submit></div>
                    </NoticeForm>
                  </Dialog>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
