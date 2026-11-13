import 'server-only'
import { takeEvents } from '@/domain/plataforma/outbox'
import type postgres from 'postgres'
import { marketToday, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { moveDealTx } from '@/domain/deals'
import { assignLeadTx } from '@/domain/leads'
import { DomainError } from '@/lib/errors'
import { ADDED_DEFAULT_KEYS, CUSTOM_PREFIX, DEFAULTS, FIELDS, NOTICE_KINDS, isCustomField, type Action, type Condition, type Definition, type NoticeKind, type Source } from '@/domain/automation/catalog'
import { runRebuiltAction, type RebuiltAction } from '@/domain/automation/rebuilt'
import { resolveTarget } from '@/domain/automation/people'
import { setWaitingOnTx } from '@/domain/automation/transitions'
import { notify } from '@/domain/notify'

// AUT-03: el motor de las automatizaciones. Lee las definiciones de la base y hace lo que dicen. No hay una regla
// escrita aquí: aquí solo está qué registros existen (los "conjuntos") y cómo se ejecuta cada tipo de acción, y toda
// acción pasa por la capa de dominio (AUT-01): la misma función que usa la pantalla, con sus mismas validaciones.

type Frag = postgres.PendingQuery<postgres.Row[]>

export type Automation = {
  id: string
  market_code: string
  motor: string | null
  key: string
  name_es: string
  name_en: string
  source: Source
  trigger_kind: 'schedule' | 'event'
  trigger_event: string | null
  conditions: Condition[]
  actions: Action[]
  is_active: boolean
  version: number
}

type Rec = {
  id: string
  market_code: string
  account_id: string | null
  deal_id: string | null
  lead_id: string | null
  owner_id: string | null
  ball_owner_id: string | null
  label: string | null
}

/**
 * Los conjuntos de registros sobre los que una automatización puede mirar. Cada columna con nombre de campo del catálogo
 * (`FIELDS`) es algo sobre lo que una condición puede preguntar; "hoy" es el día del mercado, nunca el del servidor.
 */
function recordSet(tx: Tx, source: Source): Frag {
  if (source === 'deal') {
    return tx`(
      select d.id, d.market_code, d.account_id, d.id as deal_id, null::uuid as lead_id, d.owner_id,
             case when s.is_ops then coalesce(d.ops_owner_id, d.owner_id) else d.owner_id end as ball_owner_id,
             p.motor, d.title as label, d.title, d.stage_entered_at, d.revisit_due, d.revisit_reason, lim.days as limit_days,
             s.kind as stage_kind, s.code as stage_code, s.is_ops as is_ops_stage, (d.paused_at is not null) as paused,
             extract(epoch from (now() - d.stage_entered_at)) / 86400.0 as stage_age_days,
             (lim.days > 0 and d.stage_entered_at < now() - make_interval(days => lim.days)) as over_stage_limit,
             (lim.days > 0 and d.stage_entered_at < now() - make_interval(days => lim.days)
               and (coalesce(app.funnel_setting(d.market_code, 'rot_respects_next_step') #>> '{}', 'true') <> 'true'
                    or d.next_step_due is null or d.next_step_due < ${marketToday(tx, tx`d.market_code`)})) as rotting,
             d.next_step_due,
             (s.sla_hours is not null and app.business_minutes(d.market_code, d.stage_entered_at, now()) > s.sla_hours * 60) as over_stage_sla,
             case when d.next_step is null or d.next_step_due is null then 9999 else ${marketToday(tx, tx`d.market_code`)} - d.next_step_due end as next_step_days_late,
             d.revisit_needed, ${marketToday(tx, tx`d.market_code`)} - d.revisit_due as revisit_days_late,
             exists (select 1 from crm.activities x where x.account_id = d.account_id and x.kind = 'visit' and x.done_at is null) as has_open_visit,
             d.waiting_on, d.amount_minor / 100.0 as amount, d.id::text as dedupe_id, d.pipeline_id, d.custom
        from crm.deals d
        join crm.stages s on s.id = d.stage_id
        join crm.pipelines p on p.id = d.pipeline_id
        -- PIPE-03: cada espera con su umbral (al cliente, al carrier, a otro tercero); sin umbral propio, el de la etapa.
        cross join lateral (select case d.waiting_on
                                     when 'third_party' then coalesce(s.rot_days_waiting, s.rot_days)
                                     when 'customer' then coalesce(s.rot_days_customer, s.rot_days)
                                     when 'carrier' then coalesce(s.rot_days_carrier, s.rot_days_waiting, s.rot_days)
                                     else s.rot_days end as days) lim
       where d.status = 'open')`
  }
  if (source === 'lead') {
    return tx`(
      select l.id, l.market_code, l.account_id, null::uuid as deal_id, l.id as lead_id, l.owner_id, l.owner_id as ball_owner_id,
             l.motor, l.business_name as label, l.business_name, l.sla_due_at,
             l.status, (l.first_touch_at is not null) as touched, (l.sla_due_at < now()) as first_contact_overdue,
             case when l.sla_due_at < now() then app.business_minutes_tz(l.market_code, l.sla_due_at, now(), app.lead_timezone(l.id)) / 60.0 else 0 end as overdue_business_hours,
             (l.owner_id is not null) as has_owner, l.id::text as dedupe_id,
             (case when coalesce(app.funnel_setting(l.market_code, 'lead_sla_clock') #>> '{}', 'contact') = 'attempt' then l.first_touch_at else l.first_contact_at end) is null
               and l.status = 'new' as contact_pending,
             (l.status in ('contacted', 'qualified') and not exists (select 1 from crm.activities x where x.lead_id = l.id and x.done_at is null
               and x.kind in ('task', 'visit', 'call', 'meeting'))) as no_next_task
        from crm.leads l
       where l.status in ('new', 'contacted', 'qualified'))`
  }
  if (source === 'account') {
    return tx`(
      select a.id, a.market_code, a.id as account_id, null::uuid as deal_id, null::uuid as lead_id, a.owner_id, a.owner_id as ball_owner_id,
             a.segment as motor, a.name as label, a.name, a.lifecycle, a.lifecycle_at,
             (a.lifecycle in ('active', 'at_risk', 'onboarding')) as is_customer,
             (a.owner_id is not null) as has_owner, (a.parent_id is not null) as is_branch, a.id::text as dedupe_id, a.custom,
             (a.lifecycle = 'onboarding' and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open')
               and not exists (select 1 from crm.activities x where x.account_id = a.id and x.done_at is null
                                and x.kind in ('task', 'visit', 'call', 'meeting', 'handoff'))) as onboarding_no_next_task
        from crm.accounts a
       where a.archived_at is null)`
  }
  // Un aviso por comercio repetido (contra el más antiguo con ese teléfono), no uno por cada par.
  return tx`(
    select b.id, b.market_code, a.id as account_id, null::uuid as deal_id, null::uuid as lead_id, b.owner_id, b.owner_id as ball_owner_id,
           b.segment as motor, a.name as label, a.name, b.id as other_id, b.name as other_name, a.id::text || ':' || b.id::text as dedupe_id
      from crm.accounts b
      join lateral (select o.id, o.name from crm.accounts o
                     where o.market_code = b.market_code and o.phone = b.phone and o.id < b.id and o.archived_at is null
                     order by o.id limit 1) a on true
     where b.phone is not null and b.archived_at is null)`
}

/** El detalle que lleva cada tipo de aviso: es lo que la cola de quien supervisa sabe mostrar. */
function noticeDetail(tx: Tx, kind: NoticeKind): Frag {
  switch (kind) {
    case 'lead_sla': return tx`jsonb_build_object('name', r.business_name, 'due', r.sla_due_at)`
    case 'revisit_due': return tx`jsonb_build_object('title', r.title, 'due', r.revisit_due, 'reason', r.revisit_reason)`
    case 'activation_risk': return tx`jsonb_build_object('title', r.title, 'since', r.stage_entered_at)`
    case 'no_next_step': return tx`jsonb_build_object('title', r.title)`
    case 'stalled_deal': return tx`jsonb_build_object('title', r.title, 'since', r.stage_entered_at, 'limit_days', r.limit_days, 'next_step_due', r.next_step_due)
                                   || case when r.waiting_on is null then '{}'::jsonb else jsonb_build_object('waiting_on', r.waiting_on) end`
    case 'reactivation': return tx`jsonb_build_object('name', r.name, 'since', r.lifecycle_at)`
    case 'unowned_account': return tx`jsonb_build_object('name', r.name, 'lifecycle', r.lifecycle)`
    case 'duplicate_suspect': return tx`jsonb_build_object('name', r.name, 'other_id', r.other_id, 'other_name', r.other_name, 'match', 'phone')`
    case 'lead_no_next_step': return tx`jsonb_build_object('name', r.business_name, 'status', r.status)`
    case 'onboarding_no_next_step': return tx`jsonb_build_object('name', r.name, 'since', r.lifecycle_at)`
  }
}

function conditionSql(tx: Tx, source: Source, c: Condition): Frag {
  if (isCustomField(c.field)) {
    const v = tx`nullif(btrim(r.custom ->> ${c.field.slice(CUSTOM_PREFIX.length)}), '')`
    if (c.op === 'is_empty') return tx`${v} is null`
    if (c.op === 'not_empty') return tx`${v} is not null`
    if (c.op === 'eq') return tx`coalesce(lower(${v}) = lower(${String(c.value ?? '')}), false)`
    return tx`lower(${v}) is distinct from lower(${String(c.value ?? '')})`
  }
  if (c.field === 'pipeline_id') return tx`coalesce(r.pipeline_id::text = ${String(c.value ?? '')}, false)`
  if (c.field === 'owner_id') return tx`coalesce(r.owner_id::text = any(${String(c.value ?? '').split(',').filter(Boolean)}::text[]), false)`
  const f = FIELDS[source].find((x) => x.key === c.field)
  if (!f) throw new Error(`automation condition on unknown field ${c.field}`)
  const col = tx`r.${tx(f.key)}`
  switch (c.op) {
    case 'is_true': return tx`coalesce(${col}, false)`
    case 'is_false': return tx`not coalesce(${col}, false)`
    case 'is_empty': return tx`${col} is null`
    case 'not_empty': return tx`${col} is not null`
    case 'eq': return f.type === 'number' ? tx`${col} = ${Number(c.value)}::numeric` : tx`coalesce(${col} = ${String(c.value)}, false)`
    case 'ne': return tx`${col} is distinct from ${String(c.value)}`
    case 'gt': return tx`coalesce(${col} > ${Number(c.value)}::numeric, false)`
    case 'gte': return tx`coalesce(${col} >= ${Number(c.value)}::numeric, false)`
    case 'lt': return tx`coalesce(${col} < ${Number(c.value)}::numeric, false)`
    case 'lte': return tx`coalesce(${col} <= ${Number(c.value)}::numeric, false)`
    case 'in': return tx`coalesce(${col}::text = any(${String(c.value ?? '').split(',').filter(Boolean)}::text[]), false)`
  }
}

const allOf = (tx: Tx, parts: Frag[]): Frag => parts.reduce((acc, p) => tx`${acc} and ${p}`, tx`true`)

/** Los registros de una automatización: los de su mercado (y su tipo de venta) que cumplen todas sus condiciones. */
function scope(tx: Tx, a: Automation): Frag {
  return tx`r.market_code = ${a.market_code} and (${a.motor}::text is null or r.motor = ${a.motor})`
}
const matching = (tx: Tx, a: Automation): Frag => tx`${scope(tx, a)} and ${allOf(tx, a.conditions.map((c) => conditionSql(tx, a.source, c)))}`

/** Cada mercado nace con las reglas de base. Un mercado nuevo las recibe la primera vez que corre el motor. Lo reconstruido desde Pipedrive no cuenta como "ya tiene reglas". */
export async function ensureDefaults(tx: Tx): Promise<number> {
  const markets = await tx<{ code: string }[]>`select m.code from crm.markets m where not exists (select 1 from crm.automations a where a.market_code = m.code and a.pipedrive_ref is null) order by m.code`
  let n = 0
  for (const m of markets) for (const d of DEFAULTS) n += await insertDefinition(tx, m.code, d, null, true)
  // Reglas de base que llegaron después (ACT-02): los mercados que ya tenían las suyas también las reciben, una sola vez.
  const added = DEFAULTS.filter((d) => (ADDED_DEFAULT_KEYS as readonly string[]).includes(d.key))
  const missing = await tx<{ code: string; key: string }[]>`
    select m.code, k.key from crm.markets m cross join unnest(${added.map((d) => d.key)}::text[]) k(key)
     where exists (select 1 from crm.automations a where a.market_code = m.code and a.pipedrive_ref is null)
       and not exists (select 1 from crm.automations a where a.market_code = m.code and a.key = k.key)`
  for (const x of missing) n += await insertDefinition(tx, x.code, added.find((d) => d.key === x.key)!, null, true)
  return n
}

export async function insertDefinition(tx: Tx, market: string, d: Definition, userId: string | null, active: boolean, key = d.key): Promise<number> {
  const rows = await tx`
    insert into crm.automations (market_code, motor, key, name_es, name_en, source, trigger_kind, trigger_event, conditions, actions, is_active, owner_id, created_by, updated_by)
    values (${market}, ${d.motor ?? null}, ${key}, ${d.name.es}, ${d.name.en}, ${d.source}, ${d.trigger.kind}, ${d.trigger.kind === 'event' ? d.trigger.event : null},
            ${tx.json(d.conditions as never)}, ${tx.json(d.actions as never)}, ${active}, ${userId}, ${userId}, ${userId})
    on conflict (market_code, key) do nothing returning id`
  return rows.length
}

const COLS = 'id, market_code, motor, key, name_es, name_en, source, trigger_kind, trigger_event, conditions, actions, is_active, version'
export async function loadAutomations(tx: Tx, where: 'schedule' | 'event'): Promise<Automation[]> {
  return tx<Automation[]>`select ${tx.unsafe(COLS)} from crm.automations where is_active and trigger_kind = ${where} order by market_code, created_at, id`
}

async function log(tx: Tx, a: Automation, rec: Pick<Rec, 'id' | 'label'> | null, outcome: 'done' | 'skipped' | 'failed' | 'closed', detail: Record<string, unknown>): Promise<void> {
  await tx`insert into crm.automation_log (automation_id, version, market_code, object, record_id, record_label, outcome, detail)
           values (${a.id}, ${a.version}, ${a.market_code}, ${a.source}, ${rec?.id ?? null}, ${rec?.label?.slice(0, 200) ?? null}, ${outcome}, ${tx.json(detail as never)})`
}

/**
 * Avisos de la cola: cada automatización con la acción "abrir un aviso" lo abre mientras su condición exista y lo cierra
 * sola cuando deja de existir. Es una sola sentencia para todas, igual que antes; lo nuevo es que deja bitácora por regla.
 */
async function reconcileNotices(tx: Tx, list: Automation[]): Promise<void> {
  const parts: Frag[] = []
  for (const a of list) {
    for (const act of a.actions) {
      if (act.type !== 'open_exception') continue
      // En una etapa de Operaciones el balón lo tiene quien la lleva ahí: el aviso de estancado es suyo.
      const owner = act.kind === 'stalled_deal' ? tx`r.ball_owner_id` : act.kind === 'unowned_account' ? tx`null::uuid` : tx`r.owner_id`
      parts.push(tx`
        select ${act.kind}::text as kind, ${act.severity}::text as severity, r.market_code, r.account_id, r.deal_id, r.lead_id, ${owner} as owner_id,
               ${noticeDetail(tx, act.kind)} as detail, ${act.kind + ':'} || r.dedupe_id as dedupe_key,
               ${a.id}::uuid as automation_id, ${a.version}::int as version, ${a.source}::text as object, r.id as record_id, r.label
          from ${recordSet(tx, a.source)} r where ${matching(tx, a)}`)
    }
  }
  const empty = tx`
    select null::text as kind, null::text as severity, null::text as market_code, null::uuid as account_id, null::uuid as deal_id, null::uuid as lead_id, null::uuid as owner_id,
           null::jsonb as detail, null::text as dedupe_key, null::uuid as automation_id, null::int as version, null::text as object, null::uuid as record_id, null::text as label where false`
  const cond = parts.reduce((acc, p) => tx`${acc} union all ${p}`, empty)
  await tx`
    with cond as materialized (${cond}),
    closed as (
      update crm.exceptions e set resolved_at = now(), resolution = 'auto'
       where e.resolved_at is null and e.kind = any(${[...NOTICE_KINDS]}::text[])
         and not exists (select 1 from cond c where c.dedupe_key = e.dedupe_key)
      returning e.automation_id, e.market_code, e.kind, coalesce(e.deal_id, e.lead_id, e.account_id) as record_id, e.detail
    ),
    opened as (
      insert into crm.exceptions (market_code, kind, severity, account_id, deal_id, lead_id, owner_id, detail, dedupe_key, automation_id)
      select distinct on (c.dedupe_key) c.market_code, c.kind, c.severity, c.account_id, c.deal_id, c.lead_id, c.owner_id, c.detail, c.dedupe_key, c.automation_id
        from cond c
       where not exists (select 1 from crm.exceptions e where e.dedupe_key = c.dedupe_key and e.resolved_at is null)
         and not exists (select 1 from crm.exceptions e where e.dedupe_key = c.dedupe_key and e.resolution in ('dismissed', 'scheduled') and e.resolved_at > now() - interval '7 days')
       order by c.dedupe_key
      on conflict do nothing
      returning dedupe_key
    ),
    log_closed as (
      insert into crm.automation_log (automation_id, version, market_code, object, record_id, record_label, outcome, detail)
      select x.automation_id, a.version, x.market_code, a.source, x.record_id, coalesce(x.detail ->> 'title', x.detail ->> 'name'), 'closed',
             jsonb_build_object('action', 'open_exception', 'kind', x.kind)
        from closed x join crm.automations a on a.id = x.automation_id
    )
    insert into crm.automation_log (automation_id, version, market_code, object, record_id, record_label, outcome, detail)
    select distinct on (c.dedupe_key) c.automation_id, c.version, c.market_code, c.object, c.record_id, left(c.label, 200), 'done',
           jsonb_build_object('action', 'open_exception', 'kind', c.kind)
      from cond c join opened o on o.dedupe_key = c.dedupe_key order by c.dedupe_key`
}

/** Por qué una acción no se hizo, dicho en los dos idiomas: es lo que queda en la bitácora de la regla. */
const why = (e: unknown): { es: string; en: string } | null => (e instanceof DomainError ? { es: e.es, en: e.en } : null)

/** Una tarea en Hoy para una persona, creada por una automatización: trabajo con fecha, que se completa. */
async function ruleTask(tx: Tx, sys: Ctx, a: Automation, rec: Rec, userId: string, text: { es: string; en: string }, dueDays: number): Promise<void> {
  const u = await tx<{ locale: 'es' | 'en' }[]>`select locale from crm.users where id = ${userId}`
  const en = u[0]?.locale === 'en'
  const subject = `${en ? text.en : text.es}${rec.label ? ` · ${rec.label}` : ''}`.slice(0, 200)
  sys.assert('activity.write', rec.market_code)
  assertNoProhibited(subject)
  const rows = await tx<{ id: string }[]>`
    insert into crm.activities (market_code, account_id, deal_id, lead_id, kind, subject, due_at, owner_id, created_by, source)
    values (${rec.market_code}, ${rec.account_id}, ${rec.deal_id}, ${rec.lead_id}, 'task', ${subject},
            ((${marketToday(tx, rec.market_code)} + ${dueDays}::int)::text || 'T15:00:00Z')::timestamptz, ${userId}, ${sys.user.id}, 'rule')
    returning id`
  await audit(tx, sys, 'automation.task_created', 'activity', rows[0]!.id, rec.market_code, null, { automation_id: a.id, user_id: userId, deal_id: rec.deal_id, lead_id: rec.lead_id, account_id: rec.account_id })
}

/**
 * "Avisar a una persona o a un rol": sale por el servicio único de avisos (src/domain/notify.ts), como todo aviso. Llega a
 * la campana, al centro de avisos y a Hoy hasta que la persona lo ve; por correo o Slack según su preferencia (canales apagados).
 */
async function ruleNotice(tx: Tx, sys: Ctx, a: Automation, rec: Rec, userId: string, text: { es: string; en: string }): Promise<void> {
  const label = rec.label ? ` · ${rec.label}` : ''
  const title: [string, string] = [`${text.es}${label}`.slice(0, 160), `${text.en}${label}`.slice(0, 160)]
  assertNoProhibited(title[0], title[1])
  const link = rec.deal_id ? `/deals/${rec.deal_id}` : rec.lead_id ? `/leads/${rec.lead_id}` : rec.account_id ? `/comercios/${rec.account_id}` : null
  const out = await notify(tx, sys, {
    to: userId, kind: 'automation', market: rec.market_code, title, link, needsAction: true,
    body: [`Te avisa la automatización "${a.name_es}".`, `Sent by the "${a.name_en}" automation.`],
    dealId: rec.deal_id, leadId: rec.lead_id, accountId: rec.account_id,
  })
  await audit(tx, sys, 'automation.notified', 'notice', out.noticeId, rec.market_code, null, { automation_id: a.id, user_id: userId, deal_id: rec.deal_id, lead_id: rec.lead_id, account_id: rec.account_id })
}

/** Ejecuta UNA acción sobre UN registro, por la capa de dominio. Devuelve qué hizo; lanza un error de dominio si no se pudo. */
async function act(tx: Tx, sys: Ctx, a: Automation, action: Exclude<Action, { type: 'open_exception' }>, rec: Rec): Promise<Record<string, unknown>> {
  if (action.type === 'create_task' || action.type === 'notify') {
    const people = await resolveTarget(tx, action.to, rec)
    if (people.length === 0) throw new DomainError('no_target', 'No hay a quién dársela: nadie tiene ese rol en el mercado.', 'There is nobody to give it to: no one has that role in the market.')
    for (const p of people) {
      if (action.type === 'notify') await ruleNotice(tx, sys, a, rec, p, { es: action.text_es, en: action.text_en })
      else await ruleTask(tx, sys, a, rec, p, { es: action.text_es, en: action.text_en }, action.due_days)
    }
    return { action: action.type, people: people.length }
  }
  if (action.type === 'assign') {
    const people = await resolveTarget(tx, action.to, rec)
    const to = people[0]
    if (!to || !rec.lead_id) throw new DomainError('no_target', 'No hay a quién asignarlo en ese mercado.', 'There is nobody to assign it to in that market.')
    if (rec.owner_id === to) throw new DomainError('same_owner', 'Ya lo lleva esa persona.', 'That person already owns it.')
    await assignLeadTx(tx, sys, rec.lead_id, to)
    return { action: 'assign', to }
  }
  if (action.type === 'move_stage') {
    const st = await tx<{ id: string }[]>`
      select s.id from crm.stages s join crm.deals d on d.pipeline_id = s.pipeline_id where d.id = ${rec.deal_id} and s.code = ${action.stage_code} and s.archived_at is null`
    if (!st[0]) throw new DomainError('no_stage', 'El embudo de ese negocio no tiene esa etapa.', 'The pipeline of that deal does not have that stage.')
    await moveDealTx(tx, sys, rec.deal_id!, st[0].id, undefined, undefined, { byRule: true })
    return { action: 'move_stage', stage_code: action.stage_code }
  }
  if (action.type === 'set_field') {
    await setWaitingOnTx(tx, sys, rec.deal_id!, action.value)
    return { action: 'set_field', field: action.field, value: action.value }
  }
  return runRebuiltAction(tx, sys, { id: a.id, source: a.source }, action as RebuiltAction, rec)
}

/** Las acciones de una automatización sobre un registro. Cada una en su punto de guardado: si una falla, no deja nada a medias. */
async function runActions(tx: Tx, sys: Ctx, a: Automation, rec: Rec): Promise<'done' | 'skipped' | 'failed'> {
  let worst: 'done' | 'skipped' | 'failed' = 'done'
  for (const action of a.actions) {
    if (action.type === 'open_exception') continue
    try {
      const did = await tx.savepoint((sp) => act(sp as unknown as Tx, sys, a, action, rec))
      await log(tx, a, rec, 'done', did)
    } catch (e) {
      const reason = why(e)
      if (!reason) {
        await log(tx, a, rec, 'failed', { action: action.type, error: (e as { code?: string }).code ?? 'error' })
        worst = 'failed'
        continue
      }
      await log(tx, a, rec, 'skipped', { action: action.type, reason })
      if (worst === 'done') worst = 'skipped'
    }
  }
  return worst
}

export const MAX_PER_RUN = 200

/** Acciones por horario: se hacen una vez por registro mientras la condición siga igual; cuando deja de cumplirse, el registro queda libre para la próxima vez. */
async function runScheduled(tx: Tx, sys: Ctx, a: Automation): Promise<number> {
  await tx`delete from crm.automation_state st where st.automation_id = ${a.id}
            and not exists (select 1 from ${recordSet(tx, a.source)} r where r.id = st.record_id and ${matching(tx, a)})`
  const recs = await tx<Rec[]>`
    select r.id, r.market_code, r.account_id, r.deal_id, r.lead_id, r.owner_id, r.ball_owner_id, r.label
      from ${recordSet(tx, a.source)} r
     where ${matching(tx, a)} and not exists (select 1 from crm.automation_state st where st.automation_id = ${a.id} and st.record_id = r.id)
     order by r.id limit ${MAX_PER_RUN}`
  for (const rec of recs) {
    await runActions(tx, sys, a, rec)
    await tx`insert into crm.automation_state (automation_id, record_id) values (${a.id}, ${rec.id}) on conflict do nothing`
  }
  return recs.length
}

/** Corre todas las automatizaciones por horario. Devuelve cuántos avisos abrió y cerró (lo que antes devolvía `evaluateRules`). */
export async function runSchedule(tx: Tx, sys: Ctx | null): Promise<{ opened: number; closed: number; acted: number }> {
  // Una revisión a la vez: la tarea programada y la revisión al abrir un tablero toman el mismo candado antes de tocar
  // los avisos, para que dos transacciones no se esperen una a la otra.
  await tx`select 1 from crm.settings where key = 'rules_last_run' for update`
  await ensureDefaults(tx)
  const before = await tx<{ n: number }[]>`select count(*)::int as n from crm.exceptions where resolved_at is null`
  const list = await loadAutomations(tx, 'schedule')
  await reconcileNotices(tx, list)
  let acted = 0
  if (sys) for (const a of list) if (a.actions.some((x) => x.type !== 'open_exception')) acted += await runScheduled(tx, sys, a)
  await tx`update crm.settings set value = to_jsonb(now()) where key = 'rules_last_run'`
  const after = await tx<{ n: number; auto: number }[]>`
    select count(*) filter (where resolved_at is null)::int as n,
           count(*) filter (where resolution = 'auto' and resolved_at > now() - interval '5 seconds')::int as auto from crm.exceptions`
  const closed = after[0]?.auto ?? 0
  return { opened: Math.max(0, (after[0]?.n ?? 0) - (before[0]?.n ?? 0) + closed), closed, acted }
}

/** Qué condiciones cumple y cuáles no un registro, una por una. Lo usan "probar contra un registro" y la bitácora de eventos. */
export async function explain(tx: Tx, a: Automation, recordId: string): Promise<{ rec: Rec | null; inScope: boolean; checks: boolean[] }> {
  const flags = a.conditions.map((c, i) => tx`, (${conditionSql(tx, a.source, c)}) as ${tx('c' + i)}`)
  const rows = await tx<(Rec & { in_scope: boolean } & Record<string, boolean>)[]>`
    select r.id, r.market_code, r.account_id, r.deal_id, r.lead_id, r.owner_id, r.ball_owner_id, r.label, (${scope(tx, a)}) as in_scope
           ${flags.length ? flags.reduce((acc, f) => tx`${acc}${f}`) : tx`, true as c_none`}
      from ${recordSet(tx, a.source)} r where r.id = ${recordId} limit 1`
  const r = rows[0]
  if (!r) return { rec: null, inScope: false, checks: [] }
  return { rec: r, inScope: r.in_scope, checks: a.conditions.map((_, i) => Boolean(r['c' + i])) }
}

export const EVENT_BATCH = 300

/**
 * Automatizaciones por evento: lee la cola de eventos del dominio desde donde se quedó y, por cada evento, corre las
 * automatizaciones de ese mercado que lo escuchan. Solo lee la cola (no la marca como publicada: eso es de quien publica hacia afuera).
 */
export async function runEvents(tx: Tx, sys: Ctx): Promise<{ events: number; acted: number }> {
  // AUT-02: la cola se lee por transacción confirmada (app.outbox_take), no por id con margen de tiempo. La primera vez se
  // empieza desde ahora: los eventos viejos no disparan automatizaciones que no existían.
  const events = await takeEvents(tx, 'automations', EVENT_BATCH)
  if (events.length === 0) return { events: 0, acted: 0 }
  const list = await loadAutomations(tx, 'event')
  let acted = 0
  for (const ev of events) {
    for (const a of list) {
      if (a.trigger_event !== ev.event_type || a.market_code !== ev.market_code) continue
      const x = await explain(tx, a, ev.aggregate_id)
      if (!x.rec) continue
      if (!x.inScope) continue
      const failed = x.checks.findIndex((ok) => !ok)
      if (failed >= 0) {
        await log(tx, a, x.rec, 'skipped', { event: ev.event_type, condition: a.conditions[failed] })
        continue
      }
      await runActions(tx, sys, a, x.rec)
      acted++
    }
  }
  return { events: events.length, acted }
}
