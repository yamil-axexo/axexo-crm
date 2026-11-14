'use server'

import { runAction, str } from '@/server/action'
import { addEvalCase, recordSpotCheck, runEvaluation, setHoldout, setIaSettings, setLeadWeights } from '@/domain/ia/commands'
import { SCORE_FACTORS, type ScoreFactor } from '@/domain/ia/rules'
import { AI_FEATURES, type AiFeature } from '@/server/adapters/ai'
import { invalid, type ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const PATHS = ['/admin/ia', '/asistencia', '/estado']

export async function setIaSettingsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setIaSettings(ctx, str(fd, 'market'), { level: str(fd, 'level') as never, supervisorId: str(fd, 'supervisor'), quietDays: str(fd, 'quiet_days') })
    return { message: ['Guardado. Aplica desde la siguiente corrida de sugerencias.', 'Saved. It applies from the next suggestions run.'], revalidate: PATHS }
  })
}

export async function recordSpotCheckAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordSpotCheck(ctx, str(fd, 'market'), str(fd, 'note'))
    return { message: ['Revisión registrada.', 'Review logged.'], revalidate: PATHS }
  })
}

export async function setHoldoutAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setHoldout(ctx, str(fd, 'territory'), str(fd, 'on') === '1')
    return { message: ['Grupo de control actualizado.', 'Control group updated.'], revalidate: PATHS }
  })
}

export async function setLeadWeightsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const w: Partial<Record<ScoreFactor, number>> = {}
    for (const f of SCORE_FACTORS) {
      const raw = str(fd, `w_${f}`).trim()
      if (raw === '') continue
      if (!/^-?\d{1,2}$/.test(raw)) throw invalid('Cada peso va de -50 a 50, en números enteros.', 'Each weight goes from -50 to 50, in whole numbers.')
      w[f] = Number(raw)
    }
    await setLeadWeights(ctx, str(fd, 'market'), w)
    return { message: ['Pesos guardados. El puntaje de cada lead ya los usa.', 'Weights saved. Each lead’s score already uses them.'], revalidate: [...PATHS, '/leads'] }
  })
}

export async function runEvaluationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const f = str(fd, 'feature')
    if (!(AI_FEATURES as readonly string[]).includes(f)) throw invalid('Elige una función.', 'Choose a feature.')
    const out = await runEvaluation(ctx, f as AiFeature)
    const r = out[0]!
    return { message: [`Evaluación corrida: las reglas acertaron ${r.passed} de ${r.total}.`, `Evaluation run: the rules got ${r.passed} of ${r.total} right.`], revalidate: PATHS }
  })
}

export async function addEvalCaseAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addEvalCase(ctx, { feature: str(fd, 'feature') as never, label: str(fd, 'label'), question: str(fd, 'question'), expected: str(fd, 'expected'), adversarial: str(fd, 'adversarial') === '1' })
    return { message: ['Caso agregado. Corre la evaluación para incluirlo.', 'Case added. Run the evaluation to include it.'], revalidate: PATHS }
  })
}
