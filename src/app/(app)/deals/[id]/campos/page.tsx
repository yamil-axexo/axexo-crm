import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { customValues, fieldDefs } from '@/dal/fields'
import { isEditable } from '@/domain/custom'
import { Card, LinkButton, PageHeader } from '@/ui/kit'
import { CustomFieldsForm } from '@/ui/fields-form'
import { saveDealCustomAction } from '@/app/(app)/campos-actions'

export default async function CustomFieldsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const row = await customValues(ctx, 'deal', id)
  if (!row || row.locked || !ctx.can('deal.edit', row.market_code)) notFound()
  const defs = (await fieldDefs(ctx, 'deal', row.market_code)).filter(isEditable)
  return (
    <>
      <PageHeader
        eyebrow={row.title}
        title={t('Campos del deal', 'Deal fields')}
        desc={t('Cada cambio queda en la bitácora con el valor anterior y el nuevo.', 'Every change is logged with the old and the new value.')}
        actions={<LinkButton href={`/deals/${id}`} testId="custom-back">{t('Volver', 'Back')}</LinkButton>}
      />
      <Card>
        <CustomFieldsForm
          id={id}
          defs={defs}
          values={row.custom}
          action={saveDealCustomAction}
          locale={locale}
          labels={{
            filter: t('Buscar un campo', 'Find a field'),
            save: t('Guardar cambios', 'Save changes'),
            yes: t('Sí', 'Yes'),
            no: t('No', 'No'),
            currency: t('Moneda', 'Currency'),
            onlyFilled: t('Solo los que tienen dato', 'Only fields with a value'),
            none: t('Ningún campo coincide.', 'No field matches.'),
          }}
        />
      </Card>
    </>
  )
}
