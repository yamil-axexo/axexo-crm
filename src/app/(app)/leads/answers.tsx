import type { Ctx } from '@/server/context'
import { withUser } from '@/server/db'
import { fieldDefs } from '@/dal/fields'
import { fieldText } from '@/ui/fields'
import { Card, CardTitle, KeyVal } from '@/ui/kit'

/** Lo que el formulario web pidió para calificar (puntos de venta, volumen, modelo de integración...) y el lead contestó. */
export async function LeadAnswers({ ctx, leadId }: { ctx: Ctx; leadId: string }) {
  const { t, locale } = ctx
  const rows = await withUser(ctx.user.id, (tx) => tx<{ market_code: string; motor: string; custom: Record<string, unknown> }[]>`select market_code, motor, custom from crm.leads where id = ${leadId}`)
  const lead = rows[0]
  if (!lead) return null
  const defs = (await fieldDefs(ctx, 'lead', lead.market_code, lead.motor)).filter((d) => d.mapped_to === null && fieldText(d, lead.custom[d.key], t, locale))
  if (defs.length === 0) return null
  return (
    <Card data-testid="lead-answers">
      <CardTitle title={t('Para calificar', 'To qualify')} hint={t('Lo que contestó en el formulario.', 'What they answered on the form.')} />
      <dl>{defs.map((d) => <KeyVal key={d.key} k={t(d.label_es, d.label_en)}>{fieldText(d, lead.custom[d.key], t, locale)}</KeyVal>)}</dl>
    </Card>
  )
}
