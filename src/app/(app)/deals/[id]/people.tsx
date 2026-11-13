import type { Ctx } from '@/server/context'
import { dealPeople } from '@/dal/datos'
import { Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { phoneText } from '@/lib/format'
import { CONTACT_ROLE, lab } from '@/lib/labels'
import { contactRolesFor } from '@/lib/datos-labels'
import { endDealContactAction, setDealContactAction } from '@/app/(app)/datos/actions'

/**
 * DAT-02: quién participa en este negocio y con qué rol (quién decide, quién firma, quién paga). Son contactos de la cuenta:
 * el rol en el negocio se guarda en la misma tabla que su rol en la cuenta, no en un segundo lugar.
 */
export async function DealPeople({ ctx, dealId, accountId, segment, canEdit }: { ctx: Ctx; dealId: string; accountId: string; segment: string | null; canEdit: boolean }) {
  const { t } = ctx
  const d = await dealPeople(ctx, dealId, accountId)
  if (d.people.length === 0 && (!canEdit || d.candidates.length === 0)) return null
  const roles = contactRolesFor(segment, Object.keys(CONTACT_ROLE))
  const free = d.candidates.filter((c) => !d.people.some((p) => p.contact_id === c.id))
  return (
    <Card data-testid="deal-people">
      <CardTitle title={t('Personas en este negocio', 'People on this deal')} hint={t('Con qué rol participa cada contacto de la cuenta en este negocio.', 'The role each account contact plays on this deal.')} />
      {d.people.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía nadie. Elige a un contacto de la cuenta y su rol aquí.', 'Nobody yet. Pick an account contact and their role here.')}</p> : (
        <ul className="space-y-3">
          {d.people.map((p) => (
            <li key={p.contact_id} className="flex flex-wrap items-center justify-between gap-3" data-testid="deal-person">
              <span className="text-[15px] font-medium text-strong">{p.full_name} <span className="text-[13px] font-normal text-muted">{lab(t, CONTACT_ROLE[p.role], p.role)}{p.phone ? ` · ${phoneText(p.phone)}` : ''}</span></span>
              {canEdit && (
                <ActionForm action={endDealContactAction}><input type="hidden" name="deal_id" value={dealId} /><input type="hidden" name="contact_id" value={p.contact_id} />
                  <Submit variant="quiet" size="sm" testId="deal-person-remove">{t('Quitar', 'Remove')}</Submit></ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && free.length > 0 && (
        <ActionForm action={setDealContactAction} onOk="reset" className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4" testId="deal-person-form">
          <input type="hidden" name="deal_id" value={dealId} />
          <Field label={t('Contacto de la cuenta', 'Account contact')}><select name="contact_id" className="input" data-testid="deal-person-contact">{free.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></Field>
          <Field label={t('Rol en este negocio', 'Role on this deal')}><select name="role" className="input" defaultValue="decision_maker" data-testid="deal-person-role">{roles.map((k) => <option key={k} value={k}>{lab(t, CONTACT_ROLE[k])}</option>)}</select></Field>
          <div className="col-span-2 flex justify-end"><Submit variant="ghost" size="sm" testId="deal-person-add">{t('Agregar al negocio', 'Add to the deal')}</Submit></div>
        </ActionForm>
      )}
    </Card>
  )
}
