import type { Tx } from '@/server/db'
import { AI_FEATURES, aiAdapter, PROMPT_VERSION } from '@/server/adapters/ai'

type Run = { done: number; note?: string }
const sysAudit = (tx: Tx, action: string, object: string, after: Record<string, unknown>) =>
  tx`insert into crm.audit_events (actor_id, action, object, after) values (app.system_user_id(), ${action}, ${object}, ${tx.json(after as never)})`

/**
 * REP-02 (reportes2): foto diaria por equipo y ventana corta. La foto la toma una función con dueño (cuenta todo el equipo, no lo
 * que ve quien corre). La ventana sale de Administración (valor propuesto mientras Data y Reportería no la fije) y solo borra lo
 * que ya se entregó en archivo: con el canal apagado no se borra nada.
 */
export async function teamSnapshotAndWindow(tx: Tx): Promise<Run> {
  const taken = await tx<{ n: number }[]>`select app.take_team_snapshots() as n`
  const w = await tx<{ days: number | null }[]>`select (value ->> 'value')::int as days from crm.settings where key = 'snapshots.window_days'`
  const days = w[0]?.days ?? null
  const pruned = days ? (await tx<{ n: number }[]>`select app.prune_report_snapshots(${days}) as n`)[0]!.n : 0
  if (pruned > 0) await sysAudit(tx, 'snapshot.pruned', 'snapshot', { rows: pruned, window_days: days })
  return { done: taken[0]?.n ?? 0, note: `pruned ${pruned}` }
}

/** Reglas que pueden abrir avisos: cuentan registros de cada persona. Cada una dice qué cuenta. */
const RULE_SQL: Record<string, (tx: Tx) => ReturnType<Tx>> = {
  no_phone: (tx) => tx`select a.owner_id, a.market_code, count(*)::int as n from crm.accounts a where a.archived_at is null and a.owner_id is not null and a.phone is null group by 1, 2`,
  no_address: (tx) => tx`select a.owner_id, a.market_code, count(*)::int as n from crm.accounts a where a.archived_at is null and a.owner_id is not null and (a.address_line is null or a.locality is null) group by 1, 2`,
  no_coords: (tx) => tx`select a.owner_id, a.market_code, count(*)::int as n from crm.accounts a where a.archived_at is null and a.owner_id is not null and a.kind = 'store' and a.latitude is null group by 1, 2`,
  no_contact: (tx) => tx`select a.owner_id, a.market_code, count(*)::int as n from crm.accounts a where a.archived_at is null and a.owner_id is not null
    and not exists (select 1 from crm.account_contacts ac where ac.account_id = a.id and ac.valid_to is null) group by 1, 2`,
  s5_diff: (tx) => tx`select r.owner_id, r.market_code, count(*)::int as n from crm.reconciliation_diffs r where r.kind is not null and r.owner_id is not null group by 1, 2`,
}
export const QUALITY_NOTICE_RULES = Object.keys(RULE_SQL)

/**
 * GOB-02 (reportes2): reglas preventivas dentro de la cola de avisos. Por cada regla elegida en Administración, quien tiene al
 * menos N registros por corregir recibe un aviso en su cola (lo ve su supervisión en Mi equipo). Cuando baja del mínimo, se cierra solo.
 * Valor propuesto: ninguna regla elegida, hasta que C1 decida cuáles y desde cuántos.
 */
export async function openQualityExceptions(tx: Tx): Promise<Run> {
  const cfg = await tx<{ value: { value?: string[]; min_failing?: number } }[]>`select value from crm.settings where key = 'quality.exception_rules'`
  const rules = (cfg[0]?.value?.value ?? []).filter((r) => r in RULE_SQL)
  const min = Math.max(1, cfg[0]?.value?.min_failing ?? 5)
  let opened = 0, closed = 0
  for (const rule of QUALITY_NOTICE_RULES) {
    const active = rules.includes(rule)
    const rows = active ? ((await RULE_SQL[rule]!(tx)) as unknown as { owner_id: string; market_code: string; n: number }[]) : []
    const due = rows.filter((r) => r.n >= min)
    for (const r of due) {
      const ins = await tx`insert into crm.exceptions (market_code, kind, severity, owner_id, detail, dedupe_key, rule_key)
        values (${r.market_code}, 'data_quality', 'low', ${r.owner_id}, ${tx.json({ rule, failing: r.n, min } as never)}, ${`dq:${rule}:${r.owner_id}`}, ${rule})
        on conflict (dedupe_key) where resolved_at is null do update set detail = excluded.detail returning (xmax = 0) as inserted`
      if ((ins[0] as { inserted?: boolean } | undefined)?.inserted) opened++
    }
    const keep = due.map((r) => `dq:${rule}:${r.owner_id}`)
    const c = await tx`update crm.exceptions set resolved_at = now(), resolution = 'auto_cleared'
      where kind = 'data_quality' and rule_key = ${rule} and resolved_at is null and not (dedupe_key = any(${keep}::text[]))`
    closed += c.count
  }
  if (opened || closed) await sysAudit(tx, 'quality.exceptions_opened', 'exception', { opened, closed, rules, min })
  return { done: opened + closed, note: rules.length ? `${opened} opened, ${closed} closed` : 'no rules chosen (proposed value)' }
}

/**
 * IA-08 (reportes2): regresión automática. Si una función no tiene corrida de evaluación con la versión de instrucciones y el
 * modo del modelo vigentes, la corre sola (contra las reglas y contra el adaptador). Con el adaptador apagado, la del adaptador
 * no pasa y la función sigue apagada: cambiar de modelo o de instrucciones nunca enciende nada sin regresión.
 */
export async function iaRegression(tx: Tx): Promise<Run> {
  const mode = aiAdapter().mode
  const pending: string[] = []
  for (const f of AI_FEATURES) {
    const last = await tx`select 1 from crm.ia_eval_runs where feature = ${f} and prompt_version = ${PROMPT_VERSION[f]} and adapter_mode = ${mode} limit 1`
    const cases = await tx`select 1 from crm.ia_eval_cases where feature = ${f} and is_active limit 1`
    if (!last[0] && cases[0]) pending.push(f)
  }
  if (!pending.length) return { done: 0, note: 'up to date' }
  // La corrida la hace el mismo comando de la pantalla, con la identidad del sistema (queda en la bitácora como corrida sola).
  const { systemCtx } = await import('@/server/context')
  const { runEvaluation } = await import('@/domain/ia/commands')
  const sys = await systemCtx()
  for (const f of pending) await runEvaluation(sys, f as (typeof AI_FEATURES)[number])
  await sysAudit(tx, 'ia.eval_auto_run', 'ia_eval', { features: pending, adapter_mode: mode, versions: Object.fromEntries(pending.map((f) => [f, PROMPT_VERSION[f as (typeof AI_FEATURES)[number]]])) })
  return { done: pending.length, note: `ran ${pending.join(', ')}` }
}
