import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import Link from 'next/link'
import { customValues, fieldDefs, stageFieldMarks } from '@/dal/fields'
import { isEditable } from '@/domain/custom'
import { Card, LinkButton, PageHeader } from '@/ui/kit'
import { CustomFieldsForm } from '@/ui/fields-form'
import { saveDealCustomAction } from '@/app/(app)/campos-actions'

export default async function CustomFieldsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ver?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const row = await customValues(ctx, 'deal', id)
  if (!row || row.locked || !ctx.can('deal.edit', row.market_code)) notFound()
  const all = (await fieldDefs(ctx, 'deal', row.market_code, row.motor)).filter(isEditable)
  // Lo que la etapa destaca y lo que pide la siguiente va primero y marcado (E10.F7). "ver=destacados" muestra solo eso.
  const stage = await stageFieldMarks(ctx, id)
  const marks: Record<string, string> = {}
  for (const k of stage?.highlight ?? []) marks[k] = t(`Destacado en "${stage!.stage_es}"`, `Highlighted in "${stage!.stage_en}"`)
  for (const k of stage?.next ?? []) marks[k] = t(`Lo pide "${stage!.next_es}"`, `Required by "${stage!.next_en}"`)
  const marked = all.filter((d) => marks[d.key])
  const only = (await searchParams).ver === 'destacados' && marked.length > 0
  const defs = only ? marked : [...marked, ...all.filter((d) => !marks[d.key])]
  return (
    <>
      <PageHeader
        eyebrow={row.title}
        title={t('Campos del negocio', 'Deal fields')}
        desc={t('Cada cambio queda en la bitácora con el valor anterior y el nuevo.', 'Every change is logged with the old and the new value.')}
        actions={<LinkButton href={`/deals/${id}`} testId="custom-back">{t('Volver', 'Back')}</LinkButton>}
      />
      {marked.length > 0 && (
        <p className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted-2" data-testid="custom-scope">
          {only ? t(`Aquí está lo que esta etapa destaca y lo que pide la siguiente: ${marked.length} campos.`, `This is what this stage highlights and what the next one requires: ${marked.length} fields.`) : t('Lo que esta etapa destaca y lo que pide la siguiente va primero.', 'What this stage highlights and what the next one requires comes first.')}
          <Link href={only ? `/deals/${id}/campos` : `/deals/${id}/campos?ver=destacados`} className="font-semibold text-blue-text underline" data-testid="custom-scope-toggle">{only ? t('Ver todos los campos', 'See all fields') : t('Ver solo lo destacado', 'See only the highlighted fields')}</Link>
        </p>
      )}
      <Card>
        <CustomFieldsForm
          id={id}
          marks={marks}
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
