import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { withUser } from '@/server/db'
import { fieldDefs } from '@/dal/fields'
import { isEditable } from '@/domain/custom'
import { Card, LinkButton, PageHeader } from '@/ui/kit'
import { CustomFieldsForm } from '@/ui/fields-form'
import { saveContactCustomAction } from '@/app/(app)/campos-actions'

/** DAT-05 (datos2): los campos adicionales de un contacto, que un mercado propone y administración aprueba en Datos, Campos. */
export default async function ContactFieldsPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id, cid } = await params
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(cid)) notFound()
  const row = (await withUser(ctx.user.id, (tx) => tx<{ full_name: string; market_code: string; custom: Record<string, unknown>; account: string }[]>`
    select c.full_name, c.market_code, c.custom, a.name as account from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id join crm.accounts a on a.id = ac.account_id
     where ac.account_id = ${id} and ac.contact_id = ${cid} and ac.valid_to is null and c.archived_at is null limit 1`))[0]
  if (!row || !ctx.can('account.edit', row.market_code)) notFound()
  const defs = (await fieldDefs(ctx, 'contact', row.market_code)).filter(isEditable)
  return (
    <>
      <PageHeader eyebrow={row.account} title={t(`Campos de ${row.full_name}`, `Fields for ${row.full_name}`)}
        desc={t('Cada cambio queda en la bitácora con el valor anterior y el nuevo.', 'Every change is logged with the old and the new value.')}
        actions={<LinkButton href={`/comercios/${id}?tab=datos`} testId="contact-custom-back">{t('Volver', 'Back')}</LinkButton>} />
      <Card>
        <CustomFieldsForm id={cid} defs={defs} values={row.custom} action={saveContactCustomAction} locale={locale}
          labels={{ filter: t('Buscar un campo', 'Find a field'), save: t('Guardar cambios', 'Save changes'), yes: t('Sí', 'Yes'), no: t('No', 'No'), currency: t('Moneda', 'Currency'),
            onlyFilled: t('Solo los que tienen dato', 'Only fields with a value'), none: t('Ningún campo coincide.', 'No field matches.') }} />
      </Card>
    </>
  )
}
