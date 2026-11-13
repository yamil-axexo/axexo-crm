import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { withUser } from '@/server/db'
import { Badge, Card, CardTitle } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { ago } from '@/lib/format'
import { decideSuggestionAction } from '@/app/(app)/embudo2-actions'

/**
 * LEAD-03 (embudo2): tiendas saturadas. Cuando a quien le tocaba un lead ya tenía su tope, el sistema sugiere pasarlo al canal
 * indirecto; supervisión confirma o descarta. Nada sale de la ruta de nadie sin esta decisión.
 */
export async function SaturationSuggestions({ ctx }: { ctx: Ctx }) {
  if (!ctx.can('routing.suggestion')) return null
  const { t, locale } = ctx
  const rows = await withUser(ctx.user.id, (tx) => tx<{ id: string; lead_id: string; business_name: string; owner: string | null; rules: string[]; created_at: Date }[]>`
    select s.id, s.lead_id, l.business_name, u.full_name as owner, coalesce(array(select jsonb_array_elements_text(s.detail -> 'rules')), '{}') as rules, s.created_at
      from crm.routing_suggestions s join crm.leads l on l.id = s.lead_id left join crm.users u on u.id = l.owner_id
     where s.status = 'open' order by s.created_at desc limit 20`)
  if (rows.length === 0) return null
  return (
    <Card className="mb-6" data-testid="saturation-suggestions">
      <CardTitle title={t('Tiendas saturadas: sugerencias', 'Saturated stores: suggestions')} hint={t('A quien le tocaba ya tenía su tope de leads abiertos. Confirma para pasar el lead al canal indirecto (te queda la tarea) o descarta para dejarlo como está.', 'The person it was meant for already had their cap of open leads. Confirm to hand the lead to the indirect channel (you get the task) or dismiss to leave it as is.')} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="suggestion-row">
            <span className="min-w-[200px] flex-1">
              <Link href={`/leads/${r.lead_id}`} className="text-[15px] font-semibold text-strong underline-offset-4 hover:underline">{r.business_name}</Link>
              <span className="block text-[12.5px] text-muted-2">{[r.owner ? t(`lo tiene ${r.owner}`, `owned by ${r.owner}`) : t('sin persona asignada', 'no one assigned'), r.rules.length ? t(`tope lleno en: ${r.rules.join(', ')}`, `cap reached in: ${r.rules.join(', ')}`) : '', ago(r.created_at, locale)].filter(Boolean).join(' · ')}</span>
            </span>
            <Badge tone="warn">{t('Sugerencia', 'Suggestion')}</Badge>
            <ActionForm action={decideSuggestionAction} className="flex gap-2" testId="suggestion-form">
              <input type="hidden" name="id" value={r.id} />
              <Submit size="sm" name="decision" value="confirm" testId="suggestion-confirm">{t('Confirmar', 'Confirm')}</Submit>
              <Submit size="sm" variant="ghost" name="decision" value="dismiss" testId="suggestion-dismiss">{t('Descartar', 'Dismiss')}</Submit>
            </ActionForm>
          </li>
        ))}
      </ul>
    </Card>
  )
}
