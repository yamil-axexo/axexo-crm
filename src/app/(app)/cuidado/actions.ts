'use server'

import { runAction, str } from '@/server/action'
import type { ActionResult } from '@/lib/errors'
import { HEALTH_GROUPS } from '@/lib/care'
import {
  ackHandoff, checkHandoffItem, closeAlert, createHandoff, lifecycleBacktest, publishHealth, runAlertsNow, runHealthNow, runLifecycleNow, runTiersNow,
  saveCareSettings, saveHealthWeights, savePlaybook, saveTierRules, setLifecycleWindow, setProductLine, setStageByHand, validateHealth,
} from '@/domain/care'
import {
  addFeedback, addReview, closeOpportunity, recordCompletion, recordManagerChange, runExpansionNow, saveExpansionRule, savePlan, saveRelationship, setFeedbackStatus, takeOpportunity,
} from '@/domain/care-accounts'

type R = ActionResult<unknown>
const on = (fd: FormData, key: string) => fd.get(key) === 'on' || fd.get(key) === '1'
const carePaths = (accountId?: string) => ['/cuidado', '/admin/cuidado', ...(accountId ? [`/comercios/${accountId}/cuidado`] : []), 'layout']

// ---------------------------------------------------------------- ciclo de vida
export async function windowAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const market = str(fd, 'market'), line = str(fd, 'line')
    if (str(fd, 'intent') === 'backtest') {
      const out = await lifecycleBacktest(ctx, market, line)
      if (!out.best) return { message: ['Todavía no hay datos propios suficientes para sugerir un umbral: hacen falta al menos 30 comercios con dos cortes de ventas separados por 25 días, y 5 que hayan dejado de vender.', 'There is not enough own data yet to suggest a threshold: at least 30 merchants with two sales cuts 25 days apart are needed, and 5 that stopped selling.'], revalidate: [] }
      const b = out.best
      await setLifecycleWindow(ctx, market, line, { riskBelow: b.threshold, recoverAt: Math.max(b.threshold + 3, Number(str(fd, 'recoverAt')) || 0), habitAt: str(fd, 'habitAt'), habitBelow: Math.max(Number(str(fd, 'habitBelow')) || 0, b.threshold + 3), churnAfterDays: str(fd, 'churnAfterDays'), minDaysInStage: str(fd, 'minDaysInStage') }, 'backtest', b.sample)
      return { message: [`Ventana calibrada con datos propios: entra a riesgo con menos de ${b.threshold} días con venta (muestra de ${b.sample} comercios, precisión ${b.hit_precision ?? 's/d'}, recall ${b.hit_recall ?? 's/d'}).`, `Window calibrated with own data: at risk below ${b.threshold} selling days (sample of ${b.sample} merchants, precision ${b.hit_precision ?? 'n/a'}, recall ${b.hit_recall ?? 'n/a'}).`], revalidate: carePaths() }
    }
    await setLifecycleWindow(ctx, market, line, { riskBelow: str(fd, 'riskBelow'), recoverAt: str(fd, 'recoverAt'), habitAt: str(fd, 'habitAt'), habitBelow: str(fd, 'habitBelow'), churnAfterDays: str(fd, 'churnAfterDays'), minDaysInStage: str(fd, 'minDaysInStage') })
    return { message: ['Ventana guardada.', 'Window saved.'], revalidate: carePaths() }
  })
}

export async function runNowAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const market = str(fd, 'market'), what = str(fd, 'what')
    if (what === 'lifecycle') {
      const n = await runLifecycleNow(ctx, market)
      return { message: [n === 1 ? '1 comercio cambió de etapa.' : `${n} comercios cambiaron de etapa.`, n === 1 ? '1 merchant changed stage.' : `${n} merchants changed stage.`], revalidate: carePaths() }
    }
    if (what === 'alerts') {
      const o = await runAlertsNow(ctx, market)
      return { message: [`Alertas nuevas: ${o.opened}. Cerradas: ${o.closed}. Tareas creadas: ${o.tasks}. Mensajes en cola: ${o.messages}.`, `New alerts: ${o.opened}. Closed: ${o.closed}. Tasks created: ${o.tasks}. Messages queued: ${o.messages}.`], revalidate: carePaths() }
    }
    if (what === 'health') {
      const n = await runHealthNow(ctx, market)
      return { message: [`Puntaje de hoy calculado para ${n} ${n === 1 ? 'comercio' : 'comercios'}.`, `Today’s score calculated for ${n} ${n === 1 ? 'merchant' : 'merchants'}.`], revalidate: carePaths() }
    }
    if (what === 'validate') {
      const rows = await validateHealth(ctx, market, Number(str(fd, 'horizon')) || 30)
      const all = rows.find((r) => r.tier === 'all')
      return { message: all ? [`Validación guardada: ${all.sample} comercios, precisión ${all.hit_precision ?? 's/d'}, recall ${all.hit_recall ?? 's/d'}.`, `Validation saved: ${all.sample} merchants, precision ${all.hit_precision ?? 'n/a'}, recall ${all.hit_recall ?? 'n/a'}.`] : ['Todavía no hay puntajes con la antigüedad suficiente para validar.', 'There are no scores old enough to validate yet.'], revalidate: carePaths() }
    }
    if (what === 'tiers') {
      const n = await runTiersNow(ctx, market)
      return { message: [n === 1 ? '1 comercio cambió de modelo de atención.' : `${n} comercios cambiaron de modelo de atención.`, n === 1 ? '1 merchant changed service model.' : `${n} merchants changed service model.`], revalidate: carePaths() }
    }
    const n = await runExpansionNow(ctx, market)
    return { message: [n === 1 ? '1 oportunidad nueva.' : `${n} oportunidades nuevas.`, n === 1 ? '1 new opportunity.' : `${n} new opportunities.`], revalidate: carePaths() }
  })
}

export async function productLineAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setProductLine(ctx, str(fd, 'accountId'), str(fd, 'line'))
    return { message: ['Línea de producto guardada.', 'Product line saved.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function stageAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const stage = str(fd, 'stage') === 'inactive' ? 'inactive' : 'churned'
    await setStageByHand(ctx, str(fd, 'accountId'), stage, str(fd, 'reason'))
    return { message: stage === 'churned' ? ['Comercio marcado como perdido.', 'Merchant marked as lost.'] : ['Comercio de vuelta en inactivo.', 'Merchant back to inactive.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

// ---------------------------------------------------------------- entregas
export async function handoffAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createHandoff(ctx, { accountId: str(fd, 'accountId'), toRole: str(fd, 'toRole') as never, toUserId: str(fd, 'toUserId'), dueOn: str(fd, 'dueOn'), note: str(fd, 'note') })
    return { message: ['Entrega creada. Quien recibe ya tiene el aviso y la tarea.', 'Handoff created. The receiver already has the notice and the task.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function handoffCheckAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await checkHandoffItem(ctx, str(fd, 'id'), str(fd, 'code'), str(fd, 'done') === '1')
    return { revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function handoffAckAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const accept = str(fd, 'intent') !== 'return'
    await ackHandoff(ctx, str(fd, 'id'), { accept, note: str(fd, 'note') })
    return { message: accept ? ['Acuse dado: ya cuidas este comercio.', 'Acknowledged: you now look after this merchant.'] : ['Entrega devuelta con su motivo.', 'Handoff sent back with its reason.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

// ---------------------------------------------------------------- alertas
export async function careSettingsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveCareSettings(ctx, str(fd, 'market'), { alertsOn: on(fd, 'alertsOn'), ownRulesOn: on(fd, 'ownRulesOn'), noFirstSaleDays: str(fd, 'noFirstSaleDays'), dropPct: str(fd, 'dropPct'), lowBalance: str(fd, 'lowBalance').trim() as never, holdoutPct: str(fd, 'holdoutPct'), escalateDays: str(fd, 'escalateDays'), whatsappCap: str(fd, 'whatsappCap') })
    return { message: ['Alertas guardadas.', 'Alerts saved.'], revalidate: carePaths() }
  })
}

export async function playbookAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await savePlaybook(ctx, { market: str(fd, 'market'), kind: str(fd, 'kind') as never, tier: (str(fd, 'tier') || 'any') as never, titleEs: str(fd, 'titleEs'), titleEn: str(fd, 'titleEn'), stepsEs: str(fd, 'stepsEs'), stepsEn: str(fd, 'stepsEn'), messageEs: str(fd, 'messageEs'), messageEn: str(fd, 'messageEn'), dueDays: str(fd, 'dueDays'), isActive: on(fd, 'isActive') })
    return { message: ['Guía de acción guardada.', 'Playbook saved.'], revalidate: carePaths() }
  })
}

export async function alertCloseAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const reason = str(fd, 'intent') === 'dismiss' ? 'dismissed' : 'done'
    await closeAlert(ctx, str(fd, 'id'), reason, str(fd, 'note'))
    return { message: reason === 'done' ? ['Alerta atendida.', 'Alert handled.'] : ['Alerta descartada.', 'Alert dismissed.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

// ---------------------------------------------------------------- salud y modelo de atención
export async function healthWeightsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const weights = Object.fromEntries(HEALTH_GROUPS.map((g) => [g, { weight: Number(str(fd, `w_${g}`)), active: on(fd, `a_${g}`) }]))
    await saveHealthWeights(ctx, str(fd, 'market') || null, weights)
    return { message: ['Pesos guardados. Valen desde el próximo cálculo.', 'Weights saved. They apply from the next calculation.'], revalidate: carePaths() }
  })
}

export async function healthPublishAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const pub = str(fd, 'on') === '1'
    await publishHealth(ctx, str(fd, 'market'), pub)
    return { message: pub ? ['Puntaje publicado: ya lo ve todo el equipo del mercado.', 'Score published: the whole market team can see it now.'] : ['El puntaje dejó de mostrarse al equipo.', 'The score is no longer shown to the team.'], revalidate: carePaths() }
  })
}

export async function tierRulesAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveTierRules(ctx, str(fd, 'market'), { high: str(fd, 'high'), pooled: str(fd, 'pooled'), low: str(fd, 'low'), rateBp: str(fd, 'rateBp'), hysteresisPct: str(fd, 'hysteresisPct') })
    return { message: ['Reglas del modelo de atención guardadas.', 'Service model rules saved.'], revalidate: carePaths() }
  })
}

// ---------------------------------------------------------------- capacitación y encargado
export async function completionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordCompletion(ctx, { accountId: str(fd, 'accountId'), personName: str(fd, 'personName'), courseKey: str(fd, 'courseKey'), courseTitle: str(fd, 'courseTitle'), completedOn: str(fd, 'completedOn') })
    return { message: ['Constancia registrada.', 'Completion recorded.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function managerChangeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordManagerChange(ctx, { accountId: str(fd, 'accountId'), changedOn: str(fd, 'changedOn'), newName: str(fd, 'newName'), note: str(fd, 'note'), source: (str(fd, 'source') || 'visit') as never })
    return { message: ['Cambio de encargado registrado. Queda como señal de riesgo hasta que termine su capacitación.', 'Manager change recorded. It stays as a risk signal until their training is done.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

// ---------------------------------------------------------------- expansión
export async function expansionRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveExpansionRule(ctx, { market: str(fd, 'market'), productLabel: str(fd, 'productLabel'), productId: str(fd, 'productId'), minActiveDays: str(fd, 'minActiveDays'), minDaysSinceFirst: str(fd, 'minDaysSinceFirst'), minTxn30d: str(fd, 'minTxn30d'), isActive: on(fd, 'isActive') })
    return { message: ['Regla guardada.', 'Rule saved.'], revalidate: carePaths() }
  })
}

export async function opportunityAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const intent = str(fd, 'intent')
    if (intent === 'take') {
      await takeOpportunity(ctx, str(fd, 'id'))
      return { message: ['Es tuya. Te quedó la tarea de ofrecer el producto.', 'It is yours. A task to offer the product is waiting for you.'], revalidate: carePaths(str(fd, 'accountId')) }
    }
    const result = intent === 'won' ? 'won' : intent === 'lost' ? 'lost' : 'dismissed'
    await closeOpportunity(ctx, str(fd, 'id'), result, str(fd, 'note'))
    return { message: ['Oportunidad cerrada.', 'Opportunity closed.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

// ---------------------------------------------------------------- plan de cuenta
export async function planAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await savePlan(ctx, str(fd, 'accountId'), { goals: str(fd, 'goals'), risks: str(fd, 'risks'), nextSteps: str(fd, 'nextSteps'), reviewEveryDays: str(fd, 'reviewEveryDays'), nextReviewOn: str(fd, 'nextReviewOn') as never })
    return { message: ['Plan guardado.', 'Plan saved.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function relationshipAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveRelationship(ctx, str(fd, 'accountId'), { productLabel: str(fd, 'productLabel'), health: str(fd, 'health') as never, note: str(fd, 'note') })
    return { message: ['Relación guardada.', 'Relationship saved.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function reviewAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const minutes = str(fd, 'minutes')
    const draft = str(fd, 'draft')
    await addReview(ctx, str(fd, 'accountId'), { heldOn: str(fd, 'heldOn'), attendees: str(fd, 'attendees'), minutes, agreements: str(fd, 'agreements'), draftSource: draft && minutes.trim().startsWith(draft.trim().slice(0, 40)) ? 'data' : 'manual' })
    return { message: ['Revisión guardada. La siguiente ya tiene fecha en el plan.', 'Review saved. The next one already has a date on the plan.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

// ---------------------------------------------------------------- comentarios de producto
export async function feedbackAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addFeedback(ctx, { accountId: str(fd, 'accountId'), topic: str(fd, 'topic'), kind: str(fd, 'kind') as never, note: str(fd, 'note') })
    return { message: ['Comentario registrado. Entra al resumen para Producto y Tecnología.', 'Feedback logged. It goes into the summary for Product and Technology.'], revalidate: carePaths(str(fd, 'accountId')) }
  })
}

export async function feedbackStatusAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setFeedbackStatus(ctx, str(fd, 'id'), str(fd, 'status') as never, str(fd, 'response'))
    return { message: ['Respuesta guardada.', 'Answer saved.'], revalidate: carePaths() }
  })
}
