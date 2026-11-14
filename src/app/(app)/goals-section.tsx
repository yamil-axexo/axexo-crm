import type { Ctx } from '@/server/context'
import { getGoals } from '@/dal/coexistence'
import { Bar, Card, CardTitle } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { setGoalTargetAction } from './admin/pipedrive-actions'

/** Metas del mercado (la "Deals won" de Pipedrive) con su avance del periodo. Se muestran en el Panel y en Mi equipo. */
export async function GoalsSection({ ctx, market }: { ctx: Ctx; market?: string | null }) {
  const { t } = ctx
  const goals = await getGoals(ctx, market)
  if (goals.length === 0) return null
  return (
    <Card className="mb-6" data-testid="goals">
      <CardTitle title={t('Metas', 'Goals')} hint={t('Negocios ganados en el periodo en curso, contados en el día del mercado.', 'Deals won in the current period, counted on the market day.')} />
      <ul className="grid gap-4 md:grid-cols-2">
        {goals.map((g) => (
          <li key={g.id} className="rounded-[14px] border border-line-2 p-4" data-testid="goal" data-market={g.market_code}>
            <p className="text-[14px] font-semibold text-strong">{t(g.name_es, g.name_en)} <span className="ml-1 text-[12.5px] font-normal text-muted-2">{g.market_code} · {g.period === 'month' ? t('mes', 'month') : t('trimestre', 'quarter')}</span></p>
            <p className="mt-1 text-[22px] font-semibold text-strong" data-testid="goal-progress">
              {g.done}{g.target ? <span className="text-[15px] font-normal text-muted-2"> {t('de', 'of')} {g.target}</span> : null}
            </p>
            {g.target ? <Bar value={g.done} max={g.target} tone={g.done >= g.target ? 'good' : 'accent'} />
              : <p className="text-[13px] text-muted" data-testid="goal-no-target">{t('Falta la cifra de la meta: la pone quien lidera el mercado.', 'The goal figure is missing: the market lead sets it.')}</p>}
            {g.can_edit && (
              <ActionForm action={setGoalTargetAction} className="mt-3 flex flex-wrap items-end gap-2" testId="goal-form">
                <input type="hidden" name="id" value={g.id} />
                <label className="text-[13px] text-muted">{t('Cifra de la meta', 'Goal figure')}
                  <input name="target" type="number" min={1} max={100000} defaultValue={g.target ?? ''} className="input mt-1 block !w-32" data-testid="goal-target" />
                </label>
                <Submit variant="ghost" size="sm" testId="goal-save">{t('Guardar', 'Save')}</Submit>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
