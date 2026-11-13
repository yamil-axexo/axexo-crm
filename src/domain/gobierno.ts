import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { RELEASE_CHECKLIST } from '@/content/release-checklist'

/**
 * Paquete gobierno (0033_gobierno): GOB-07 (objetivos de servicio, incidentes, pruebas de restauración), GOB-04 (dueños por
 * componente, mantenimiento, versiones con lista de salida, despliegues), GOB-09 (costos cargados a mano) y E7 (solicitudes
 * de configuración, motivo de cada cambio, champions, material por mercado).
 * Escribe administración ('gov.manage'); leen administración y leadership ('gov.read'). La base repite el límite con RLS.
 * Aquí no se inventa ningún valor: lo que nadie ha fijado queda vacío.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const name = z.string().trim().min(2).max(120)

// ------------------------------------------------------------------ GOB-07: objetivos

export const SLO_KEYS = ['availability', 'latency_page', 'latency_action', 'latency_api'] as const
export const RECOVERY_KEYS = ['rpo_minutes', 'rto_minutes', 'restore_test_days'] as const
export type ObjectiveKey = (typeof SLO_KEYS)[number] | (typeof RECOVERY_KEYS)[number]

/**
 * Fija el valor de un objetivo. Uno de servicio lo fija administración; uno de recuperación (cuánta información se puede
 * perder, en cuánto vuelve el servicio, cada cuánto se prueba restaurar) solo vale con quién lo acordó y en qué fecha.
 */
export async function setObjective(ctx: Ctx, raw: { key: string; target: string; agreedBy?: string; agreedOn?: string }): Promise<void> {
  ctx.assert('gov.manage')
  const key = raw.key as ObjectiveKey
  const recovery = (RECOVERY_KEYS as readonly string[]).includes(key)
  if (!recovery && !(SLO_KEYS as readonly string[]).includes(key)) throw notFound('No encontramos ese objetivo.', 'We could not find that objective.')
  const target = Number(raw.target.replace(',', '.'))
  if (!raw.target.trim() || !Number.isFinite(target) || target < 0) throw invalid('Escribe el valor del objetivo con números.', 'Enter the objective value as a number.')
  if (key === 'availability' && (target < 50 || target > 100)) throw invalid('La disponibilidad es un porcentaje entre 50 y 100.', 'Availability is a percentage between 50 and 100.')
  if (key !== 'availability' && target > 10_000_000) throw invalid('Ese valor es demasiado grande.', 'That value is too large.')
  const agreedBy = clean(raw.agreedBy)
  const agreedOn = clean(raw.agreedOn)
  if (recovery && (!agreedBy || agreedBy.length < 2 || !agreedOn || !isDay(agreedOn))) {
    throw invalid('Un objetivo de recuperación lleva quién lo acordó y en qué fecha. Sin eso no se guarda.', 'A recovery objective needs who agreed to it and on which date. Without that it is not saved.')
  }
  if (agreedOn && !isDay(agreedOn)) throw invalid('Revisa la fecha.', 'Check the date.')
  assertNoProhibited(agreedBy)
  await withUser(ctx.user.id, async (tx) => {
    const before = (await tx<{ target: string | null; agreed_by: string | null }[]>`select target, agreed_by from crm.service_objectives where key = ${key} for update`)[0]
    if (!before) throw notFound('No encontramos ese objetivo.', 'We could not find that objective.')
    await tx`update crm.service_objectives set target = ${target}, agreed_by = ${agreedBy}, agreed_on = ${agreedOn}, updated_by = ${ctx.user.id}, updated_at = now() where key = ${key}`
    await audit(tx, ctx, 'objective.set', 'service_objective', null, null, { key, target: before.target === null ? null : Number(before.target) }, { key, target, agreed_by: agreedBy, agreed_on: agreedOn })
  })
}

// ------------------------------------------------------------------ GOB-07: incidentes

export const SEVERITIES = ['high', 'medium', 'low'] as const
export const INCIDENT_STATUS = ['open', 'mitigated', 'closed'] as const

const incidentInput = z.object({
  title: z.string().trim().min(5).max(160),
  severity: z.enum(SEVERITIES),
  startedAt: z.date(),
  market: z.string().regex(/^[A-Z]{2}$/).or(z.literal('')),
  impact: z.string().trim().min(5).max(2000),
  requestId: z.string().trim().max(80).optional().default(''),
})

export async function openIncident(ctx: Ctx, raw: z.input<typeof incidentInput>): Promise<string> {
  ctx.assert('gov.manage')
  const parsed = incidentInput.safeParse(raw)
  if (!parsed.success) throw invalid('Un incidente lleva título, gravedad, cuándo empezó y a quién afectó.', 'An incident needs a title, a severity, when it started and who it affected.')
  const v = parsed.data
  if (v.startedAt.getTime() > Date.now() + 5 * 60_000) throw invalid('Un incidente no puede empezar en el futuro.', 'An incident cannot start in the future.')
  assertNoProhibited(v.title, v.impact)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.incidents (id, title, severity, started_at, market_code, impact, request_id, created_by)
             values (${id}, ${v.title}, ${v.severity}, ${v.startedAt}, ${v.market || null}, ${v.impact}, ${clean(v.requestId)}, ${ctx.user.id})`
    await audit(tx, ctx, 'incident.opened', 'incident', id, v.market || null, null, { title: v.title, severity: v.severity })
    return id
  })
}

/** Mitigar o cerrar. Cerrar pide la causa, lo que se hizo y cuándo se resolvió: un incidente no se cierra en blanco. */
export async function updateIncident(ctx: Ctx, raw: { id: string; status: string; cause?: string; actions?: string; resolvedAt?: Date | null }): Promise<void> {
  ctx.assert('gov.manage')
  if (!UUID.test(raw.id)) throw notFound('No encontramos ese incidente.', 'We could not find that incident.')
  const status = z.enum(INCIDENT_STATUS).safeParse(raw.status)
  if (!status.success) throw invalid('Elige el estado del incidente.', 'Choose the incident status.')
  const cause = clean(raw.cause)
  const actions = clean(raw.actions)
  assertNoProhibited(cause, actions)
  if (status.data === 'closed' && (!cause || !actions || !raw.resolvedAt)) {
    throw invalid('Para cerrar un incidente hace falta la causa, lo que se hizo y cuándo se resolvió.', 'Closing an incident needs the cause, what was done and when it was resolved.')
  }
  await withUser(ctx.user.id, async (tx) => {
    const before = (await tx<{ status: string; started_at: Date; market_code: string | null }[]>`select status, started_at, market_code from crm.incidents where id = ${raw.id} for update`)[0]
    if (!before) throw notFound('No encontramos ese incidente.', 'We could not find that incident.')
    if (before.status === 'closed') throw invalid('Ese incidente ya está cerrado.', 'That incident is already closed.')
    if (raw.resolvedAt && raw.resolvedAt < before.started_at) throw invalid('No se pudo resolver antes de empezar: revisa la fecha.', 'It cannot be resolved before it started: check the date.')
    await tx`update crm.incidents set status = ${status.data}, cause = coalesce(${cause}, cause), actions = coalesce(${actions}, actions),
             resolved_at = coalesce(${raw.resolvedAt ?? null}, resolved_at), updated_by = ${ctx.user.id}, updated_at = now() where id = ${raw.id}`
    await audit(tx, ctx, 'incident.updated', 'incident', raw.id, before.market_code, { status: before.status }, { status: status.data })
  })
}

// ------------------------------------------------------------------ GOB-07: pruebas de restauración

const restoreInput = z.object({
  testedOn: z.string().refine(isDay),
  testedBy: name,
  environment: z.enum(['staging', 'production']),
  minutes: z.number().int().min(0).max(100000).nullable(),
  dataLossMinutes: z.number().int().min(0).max(100000).nullable(),
  result: z.enum(['ok', 'failed']),
  evidence: z.string().trim().min(5).max(500),
  notes: z.string().trim().max(2000).optional().default(''),
})

/** Anota una prueba de restauración ya hecha. La prueba la hace quien opera la plataforma; aquí queda la evidencia. */
export async function recordRestoreTest(ctx: Ctx, raw: z.input<typeof restoreInput>): Promise<string> {
  ctx.assert('gov.manage')
  const parsed = restoreInput.safeParse(raw)
  if (!parsed.success) throw invalid('Una prueba de restauración lleva fecha, quién la hizo, en qué ambiente, el resultado y dónde está la evidencia.', 'A restore test needs a date, who ran it, the environment, the result and where the evidence is.')
  const v = parsed.data
  if (Date.parse(`${v.testedOn}T00:00:00Z`) > Date.now() + 86_400_000) throw invalid('Una prueba hecha no puede tener fecha futura.', 'A test already run cannot have a future date.')
  assertNoProhibited(v.testedBy, v.evidence, v.notes)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.restore_tests (id, tested_on, tested_by, environment, minutes, data_loss_minutes, result, evidence, notes, recorded_by)
             values (${id}, ${v.testedOn}, ${v.testedBy}, ${v.environment}, ${v.minutes}, ${v.dataLossMinutes}, ${v.result}, ${v.evidence}, ${clean(v.notes)}, ${ctx.user.id})`
    await audit(tx, ctx, 'restore_test.recorded', 'restore_test', id, null, null, { tested_on: v.testedOn, environment: v.environment, result: v.result, minutes: v.minutes })
    return id
  })
}

// ------------------------------------------------------------------ GOB-04: componentes

/** Dueño técnico y suplente de un componente. Son dos personas distintas; dejar un nombre vacío lo regresa a "Por definir". */
export async function setComponentOwners(ctx: Ctx, raw: { key: string; owner: string; backup: string }): Promise<void> {
  ctx.assert('gov.manage')
  const owner = clean(raw.owner)
  const backup = clean(raw.backup)
  for (const v of [owner, backup]) if (v && (v.length < 2 || v.length > 120)) throw invalid('Escribe el nombre completo de la persona.', 'Enter the person’s full name.')
  if (owner && backup && owner.toLowerCase() === backup.toLowerCase()) throw invalid('El suplente cubre al dueño cuando no está: tiene que ser otra persona.', 'The backup covers the owner when they are away: it has to be a different person.')
  assertNoProhibited(owner, backup)
  await withUser(ctx.user.id, async (tx) => {
    const before = (await tx<{ owner_name: string | null; backup_name: string | null }[]>`select owner_name, backup_name from crm.components where key = ${raw.key} for update`)[0]
    if (!before) throw notFound('No encontramos ese componente.', 'We could not find that component.')
    await tx`update crm.components set owner_name = ${owner}, backup_name = ${backup}, updated_by = ${ctx.user.id}, updated_at = now() where key = ${raw.key}`
    await audit(tx, ctx, 'component.owners_set', 'component', null, null, { key: raw.key, owner: before.owner_name, backup: before.backup_name }, { key: raw.key, owner, backup })
  })
}

// ------------------------------------------------------------------ GOB-04: mantenimiento

const windowInput = z.object({
  title: z.string().trim().min(5).max(160),
  startsAt: z.date(),
  endsAt: z.date(),
  market: z.string().regex(/^[A-Z]{2}$/).or(z.literal('')),
  impact: z.string().trim().min(5).max(1000),
})

export async function scheduleMaintenance(ctx: Ctx, raw: z.input<typeof windowInput>): Promise<string> {
  ctx.assert('gov.manage')
  const parsed = windowInput.safeParse(raw)
  if (!parsed.success) throw invalid('Una ventana de mantenimiento lleva título, inicio, fin y qué va a notar el equipo.', 'A maintenance window needs a title, a start, an end and what the team will notice.')
  const v = parsed.data
  if (v.endsAt <= v.startsAt) throw invalid('El fin tiene que ser después del inicio.', 'The end has to be after the start.')
  if (v.startsAt.getTime() < Date.now() - 60_000) throw invalid('Una ventana se agenda hacia adelante: el inicio ya pasó.', 'A window is scheduled ahead: the start has already passed.')
  assertNoProhibited(v.title, v.impact)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.maintenance_windows (id, title, starts_at, ends_at, market_code, impact, created_by)
             values (${id}, ${v.title}, ${v.startsAt}, ${v.endsAt}, ${v.market || null}, ${v.impact}, ${ctx.user.id})`
    await audit(tx, ctx, 'maintenance.scheduled', 'maintenance_window', id, v.market || null, null, { title: v.title, starts_at: v.startsAt.toISOString(), ends_at: v.endsAt.toISOString() })
    return id
  })
}

export async function setMaintenanceStatus(ctx: Ctx, id: string, status: string): Promise<void> {
  ctx.assert('gov.manage')
  if (!UUID.test(id) || (status !== 'done' && status !== 'cancelled')) throw notFound('No encontramos esa ventana.', 'We could not find that window.')
  await withUser(ctx.user.id, async (tx) => {
    const before = (await tx<{ status: string; market_code: string | null }[]>`select status, market_code from crm.maintenance_windows where id = ${id} for update`)[0]
    if (!before) throw notFound('No encontramos esa ventana.', 'We could not find that window.')
    if (before.status !== 'planned') throw invalid('Esa ventana ya se cerró.', 'That window is already closed.')
    await tx`update crm.maintenance_windows set status = ${status}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'maintenance.closed', 'maintenance_window', id, before.market_code, { status: before.status }, { status })
  })
}

// ------------------------------------------------------------------ GOB-04: versiones

const releaseInput = z.object({
  version: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/),
  titleEs: z.string().trim().min(3).max(140),
  titleEn: z.string().trim().min(3).max(140),
  notesEs: z.string().trim().min(5).max(3000),
  notesEn: z.string().trim().min(5).max(3000),
  plannedFor: z.string().refine((v) => v === '' || isDay(v)),
  touchesMoney: z.boolean(),
})

export async function createRelease(ctx: Ctx, raw: z.input<typeof releaseInput>): Promise<string> {
  ctx.assert('gov.manage')
  const parsed = releaseInput.safeParse(raw)
  if (!parsed.success) throw invalid('Una versión lleva número (letras, números y puntos), título y notas en español y en inglés.', 'A release needs a number (letters, digits and dots), a title and notes in Spanish and in English.')
  const v = parsed.data
  if (v.touchesMoney && !v.plannedFor) throw invalid('Si toca comisiones o el alta, la versión lleva la fecha desde la que vale.', 'If it touches commissions or enrollment, the release needs the date it takes effect.')
  assertNoProhibited(v.titleEs, v.titleEn, v.notesEs, v.notesEn)
  return withUser(ctx.user.id, async (tx) => {
    if ((await tx`select 1 from crm.releases where lower(version) = lower(${v.version})`)[0]) throw invalid('Ya hay una versión con ese número.', 'There is already a release with that number.')
    const id = await newId(tx)
    await tx`insert into crm.releases (id, version, title_es, title_en, notes_es, notes_en, planned_for, touches_money, created_by)
             values (${id}, ${v.version}, ${v.titleEs}, ${v.titleEn}, ${v.notesEs}, ${v.notesEn}, ${v.plannedFor || null}, ${v.touchesMoney}, ${ctx.user.id})`
    await audit(tx, ctx, 'release.created', 'release', id, null, null, { version: v.version, touches_money: v.touchesMoney, planned_for: v.plannedFor || null })
    return id
  })
}

type Check = { by: string; at: string; evidence: string }

/** Da por cumplido un punto de la lista de salida, con su evidencia (quién firmó, qué corrida, qué documento). */
export async function checkReleaseItem(ctx: Ctx, raw: { id: string; item: string; evidence: string }): Promise<void> {
  ctx.assert('gov.manage')
  if (!UUID.test(raw.id)) throw notFound('No encontramos esa versión.', 'We could not find that release.')
  const item = RELEASE_CHECKLIST.find((i) => i.key === raw.item)
  if (!item) throw notFound('Ese punto no está en la lista de salida.', 'That item is not on the go-live checklist.')
  const evidence = clean(raw.evidence)
  if (!evidence || evidence.length < 5 || evidence.length > 300) throw invalid('Escribe la evidencia: quién dio el visto bueno, qué corrida o qué documento.', 'Write the evidence: who signed off, which run or which document.')
  assertNoProhibited(evidence)
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<{ status: string; checklist: Record<string, Check> }[]>`select status, checklist from crm.releases where id = ${raw.id} for update`)[0]
    if (!r) throw notFound('No encontramos esa versión.', 'We could not find that release.')
    if (r.status === 'released') throw invalid('Esa versión ya salió: su lista no cambia.', 'That release is already out: its checklist does not change.')
    const checklist = { ...r.checklist, [item.key]: { by: ctx.user.name, at: new Date().toISOString(), evidence } }
    await tx`update crm.releases set checklist = ${tx.json(checklist)} where id = ${raw.id}`
    await audit(tx, ctx, 'release.item_checked', 'release', raw.id, null, null, { item: item.key, evidence })
  })
}

/** Lo que falta de la lista de salida de una versión. Vacío: puede salir. */
export const missingItems = (checklist: Record<string, unknown>) => RELEASE_CHECKLIST.filter((i) => !checklist[i.key]).map((i) => i.key)

/**
 * Anuncia la versión: sus notas quedan visibles para todo el equipo. Comunicar antes de liberar es la regla: una versión no
 * se marca como liberada sin anuncio previo. Devuelve el identificador para que quien llama publique el anuncio a la red.
 */
export async function announceRelease(ctx: Ctx, id: string): Promise<{ version: string; titleEs: string; titleEn: string; notesEs: string; notesEn: string; plannedFor: string | null; touchesMoney: boolean }> {
  ctx.assert('gov.manage')
  if (!UUID.test(id)) throw notFound('No encontramos esa versión.', 'We could not find that release.')
  return withUser(ctx.user.id, async (tx) => {
    const r = (await tx<{ status: string; version: string; title_es: string; title_en: string; notes_es: string; notes_en: string; planned_for: string | null; touches_money: boolean }[]>`
      select status, version, title_es, title_en, notes_es, notes_en, planned_for::text, touches_money from crm.releases where id = ${id} for update`)[0]
    if (!r) throw notFound('No encontramos esa versión.', 'We could not find that release.')
    if (r.status !== 'draft') throw invalid('Esa versión ya se anunció.', 'That release has already been announced.')
    await tx`update crm.releases set status = 'announced', announced_at = now(), announced_by = ${ctx.user.id} where id = ${id}`
    await audit(tx, ctx, 'release.announced', 'release', id, null, { status: 'draft' }, { status: 'announced', version: r.version, touches_money: r.touches_money })
    return { version: r.version, titleEs: r.title_es, titleEn: r.title_en, notesEs: r.notes_es, notesEn: r.notes_en, plannedFor: r.planned_for, touchesMoney: r.touches_money }
  })
}

/**
 * Marca la versión como liberada. Solo si ya se anunció y la lista de salida está completa (revisión de tecnología y
 * estándar de ingeniería incluidos). Si toca comisiones o alta, no sale antes de la fecha que se anunció.
 */
export async function markReleased(ctx: Ctx, id: string, today: string): Promise<void> {
  ctx.assert('gov.manage')
  if (!UUID.test(id)) throw notFound('No encontramos esa versión.', 'We could not find that release.')
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<{ status: string; version: string; checklist: Record<string, Check>; touches_money: boolean; planned_for: string | null }[]>`
      select status, version, checklist, touches_money, planned_for::text from crm.releases where id = ${id} for update`)[0]
    if (!r) throw notFound('No encontramos esa versión.', 'We could not find that release.')
    if (r.status === 'released') throw invalid('Esa versión ya está marcada como liberada.', 'That release is already marked as released.')
    if (r.status === 'draft') throw invalid('Primero anuncia la versión: el equipo se entera antes de que salga.', 'Announce the release first: the team hears about it before it goes out.')
    const missing = missingItems(r.checklist)
    if (missing.length > 0) {
      throw invalid(`Faltan ${missing.length} ${missing.length === 1 ? 'punto' : 'puntos'} de la lista de salida. Sin la lista completa, la versión no sale.`, `${missing.length} go-live checklist ${missing.length === 1 ? 'item is' : 'items are'} missing. Without the full checklist, the release does not go out.`)
    }
    if (r.touches_money && r.planned_for && today < r.planned_for) {
      throw invalid('Esta versión toca comisiones o el alta y se anunció para una fecha que todavía no llega.', 'This release touches commissions or enrollment and was announced for a date that has not arrived yet.')
    }
    await tx`update crm.releases set status = 'released', released_at = now(), released_by = ${ctx.user.id} where id = ${id}`
    await audit(tx, ctx, 'release.released', 'release', id, null, { status: r.status }, { status: 'released', version: r.version })
  })
}

// ------------------------------------------------------------------ GOB-04: despliegues

const deployInput = z.object({
  environment: z.enum(['staging', 'production']),
  commit: z.string().trim().toLowerCase().regex(/^[0-9a-f]{7,64}$/),
  deployedAt: z.date(),
  deployedBy: name,
  result: z.enum(['ok', 'rolled_back', 'failed']),
  releaseId: z.string().regex(UUID).or(z.literal('')),
  notes: z.string().trim().max(1000).optional().default(''),
})

/** Anota un despliegue a mano (quién lo hizo, cómo terminó). El commit que corre lo anota la app sola (deployWatch). */
export async function recordDeployment(ctx: Ctx, raw: z.input<typeof deployInput>): Promise<string> {
  ctx.assert('gov.manage')
  const parsed = deployInput.safeParse(raw)
  if (!parsed.success) throw invalid('Un despliegue lleva ambiente, commit (de 7 a 64 letras y números), cuándo, quién y cómo terminó.', 'A deployment needs an environment, a commit (7 to 64 letters and digits), when, who and how it ended.')
  const v = parsed.data
  if (v.deployedAt.getTime() > Date.now() + 5 * 60_000) throw invalid('Un despliegue anotado ya pasó: revisa la fecha.', 'A recorded deployment already happened: check the date.')
  assertNoProhibited(v.deployedBy, v.notes)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.deployments (id, environment, commit_sha, release_id, deployed_at, deployed_by, result, source, notes, recorded_by)
             values (${id}, ${v.environment}, ${v.commit}, ${v.releaseId || null}, ${v.deployedAt}, ${v.deployedBy}, ${v.result}, 'manual', ${clean(v.notes)}, ${ctx.user.id})`
    await audit(tx, ctx, 'deployment.recorded', 'deployment', id, null, null, { environment: v.environment, commit: v.commit.slice(0, 12), result: v.result })
    return id
  })
}

// ------------------------------------------------------------------ GOB-09: costos

export const COST_COMPONENTS = ['platform', 'database', 'third_party', 'ai', 'support', 'other'] as const
const costInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  kind: z.enum(['cost', 'reference']),
  component: z.enum(COST_COMPONENTS),
  label: z.string().trim().min(2).max(120),
  amount: z.string().trim(),
  note: z.string().trim().max(500).optional().default(''),
})

/** Carga un costo del mes (o una referencia contra la que se compara), en USD. Nada se estima: se carga lo que dice la factura. */
export async function addCost(ctx: Ctx, raw: z.input<typeof costInput>, currentMonth: string): Promise<string> {
  ctx.assert('gov.manage')
  const parsed = costInput.safeParse(raw)
  if (!parsed.success) throw invalid('Un costo lleva mes, componente, de qué es y el monto en USD.', 'A cost needs a month, a component, what it is for and the amount in USD.')
  const v = parsed.data
  const amount = Number(v.amount.replace(/,/g, ''))
  if (!/^\d{1,9}(,\d{3})*(\.\d{1,2})?$/.test(v.amount) || !Number.isFinite(amount) || amount > 9_999_999) throw invalid('Escribe el monto en USD, con punto para los centavos.', 'Enter the amount in USD, with a dot for cents.')
  if (v.month > currentMonth) throw invalid('No se cargan costos de un mes que todavía no empieza.', 'Costs of a month that has not started cannot be loaded.')
  assertNoProhibited(v.label, v.note)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.cost_entries (id, month, kind, component, label, amount_usd, note, created_by)
             values (${id}, ${`${v.month}-01`}, ${v.kind}, ${v.component}, ${v.label}, ${amount}, ${clean(v.note)}, ${ctx.user.id})`
    await audit(tx, ctx, 'cost.added', 'cost_entry', id, null, null, { month: v.month, kind: v.kind, component: v.component, label: v.label, amount_usd: amount })
    return id
  })
}

/** Un costo mal cargado se anula (queda a la vista, tachado) y se carga de nuevo. */
export async function voidCost(ctx: Ctx, id: string): Promise<void> {
  ctx.assert('gov.manage')
  if (!UUID.test(id)) throw notFound('No encontramos ese costo.', 'We could not find that cost.')
  await withUser(ctx.user.id, async (tx) => {
    const before = (await tx<{ voided_at: Date | null; label: string; amount_usd: string; month: string }[]>`select voided_at, label, amount_usd, to_char(month, 'YYYY-MM') as month from crm.cost_entries where id = ${id}`)[0]
    if (!before) throw notFound('No encontramos ese costo.', 'We could not find that cost.')
    // Sin `for update`: la base solo deja bloquear un costo vigente, y uno anulado tiene que poder leerse para decirlo.
    const done = before.voided_at ? [] : await tx`update crm.cost_entries set voided_by = ${ctx.user.id}, voided_at = now() where id = ${id} and voided_at is null returning id`
    if (!done.length) throw invalid('Ese costo ya estaba anulado.', 'That cost was already voided.')
    await audit(tx, ctx, 'cost.voided', 'cost_entry', id, null, { month: before.month, label: before.label, amount_usd: Number(before.amount_usd) }, { voided: true })
  })
}

// ------------------------------------------------------------------ E7.F6: solicitudes de configuración

export const REQUEST_KINDS = ['field', 'option', 'pipeline', 'report', 'other'] as const
const requestInput = z.object({
  kind: z.enum(REQUEST_KINDS),
  title: z.string().trim().min(3).max(120),
  purpose: z.string().trim().min(10).max(1000),
  market: z.string().regex(/^[A-Z]{2}$/).or(z.literal('')),
  options: z.string().trim().max(1000).optional().default(''),
})

/**
 * Pedir un cambio de configuración. La solicitud dice qué se pide, para qué sirve, para qué mercado (vacío: compartido,
 * que va primero) y, si es una lista, sus opciones. La puede mandar cualquier persona con acceso; decide administración.
 */
export async function createConfigRequest(ctx: Ctx, raw: z.input<typeof requestInput>): Promise<string> {
  ctx.assert('config.request')
  const parsed = requestInput.safeParse(raw)
  if (!parsed.success) throw invalid('Dinos qué necesitas y para qué sirve (al menos una frase). Sin el para qué, la solicitud no se puede aprobar.', 'Tell us what you need and what it is for (at least a sentence). Without the purpose, the request cannot be approved.')
  const v = parsed.data
  if (v.market && !ctx.markets.some((m) => m.code === v.market)) throw invalid('Ese mercado no es uno de los tuyos.', 'That market is not one of yours.')
  if (v.kind === 'option' && !v.options) throw invalid('Escribe las opciones que pides, una por renglón.', 'Write the options you are asking for, one per line.')
  assertNoProhibited(v.title, v.purpose, v.options)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.config_requests (id, kind, title, purpose, market_code, options, requested_by)
             values (${id}, ${v.kind}, ${v.title}, ${v.purpose}, ${v.market || null}, ${clean(v.options)}, ${ctx.user.id})`
    await audit(tx, ctx, 'config_request.created', 'config_request', id, v.market || null, null, { kind: v.kind, title: v.title, shared: !v.market })
    return id
  })
}

/** Aprobar, rechazar (con el porqué) o dar por hecha una solicitud. Solo administración. */
export async function decideConfigRequest(ctx: Ctx, raw: { id: string; decision: string; note?: string }): Promise<void> {
  ctx.assert('config.manage')
  if (!UUID.test(raw.id)) throw notFound('No encontramos esa solicitud.', 'We could not find that request.')
  const decision = z.enum(['approved', 'rejected', 'done']).safeParse(raw.decision)
  if (!decision.success) throw invalid('Elige qué se decide.', 'Choose the decision.')
  const note = clean(raw.note)
  if (decision.data === 'rejected' && (!note || note.length < 2)) throw invalid('Al rechazar, dile a la persona por qué.', 'When you reject, tell the person why.')
  assertNoProhibited(note)
  await withUser(ctx.user.id, async (tx) => {
    const before = (await tx<{ status: string; market_code: string | null; requested_by: string }[]>`select status, market_code, requested_by from crm.config_requests where id = ${raw.id} for update`)[0]
    if (!before) throw notFound('No encontramos esa solicitud.', 'We could not find that request.')
    const allowed = before.status === 'open' ? ['approved', 'rejected'] : before.status === 'approved' ? ['done', 'rejected'] : []
    if (!allowed.includes(decision.data)) throw invalid('Esa solicitud ya se decidió.', 'That request has already been decided.')
    await tx`update crm.config_requests set status = ${decision.data}, decided_by = ${ctx.user.id}, decided_at = now(), decision_note = coalesce(${note}, decision_note) where id = ${raw.id}`
    await audit(tx, ctx, 'config_request.decided', 'config_request', raw.id, before.market_code, { status: before.status }, { status: decision.data, requester: before.requested_by })
  })
}

// ------------------------------------------------------------------ E7.F7: el motivo de un cambio de configuración

/** Objetos de la bitácora que son configuración: para ellos se pide el porqué. */
export const CONFIG_OBJECTS = ['pipeline', 'stage', 'field', 'account_type', 'loss_reason', 'web_form', 'routing_rule', 'territory', 'market', 'market_hours', 'ops_catalog', 'product', 'fx_rate', 'api_client', 'service_objective', 'component'] as const

/** Anota por qué se hizo un cambio de configuración. Una vez por cambio; no se edita (igual que la bitácora). */
export async function annotateChange(ctx: Ctx, eventId: string, rawReason: string): Promise<void> {
  ctx.assert('config.manage')
  if (!UUID.test(eventId)) throw notFound('No encontramos ese cambio.', 'We could not find that change.')
  const reason = clean(rawReason)
  if (!reason || reason.length < 5 || reason.length > 1000) throw invalid('Escribe por qué se hizo el cambio, en una frase.', 'Write why the change was made, in a sentence.')
  assertNoProhibited(reason)
  await withUser(ctx.user.id, async (tx) => {
    const ev = (await tx<{ object: string; market_code: string | null }[]>`select object, market_code from crm.audit_events where id = ${eventId}`)[0]
    if (!ev || !(CONFIG_OBJECTS as readonly string[]).includes(ev.object)) throw notFound('Ese evento no es un cambio de configuración.', 'That event is not a configuration change.')
    if ((await tx`select 1 from crm.change_reasons where event_id = ${eventId}`)[0]) throw invalid('Ese cambio ya tiene su motivo.', 'That change already has its reason.')
    await tx`insert into crm.change_reasons (event_id, reason, created_by) values (${eventId}, ${reason}, ${ctx.user.id})`
    await audit(tx, ctx, 'change.reason_added', 'change_reason', eventId, ev.market_code, null, { object: ev.object })
  })
}

// ------------------------------------------------------------------ E7.F3: champions

/** Nombra (o quita, con `userId` vacío) al champion de un equipo: una persona que trabaja en ese equipo. */
export async function setChampion(ctx: Ctx, teamId: string, userId: string): Promise<void> {
  ctx.assert('config.manage')
  if (!UUID.test(teamId) || (userId !== '' && !UUID.test(userId))) throw notFound('No encontramos ese equipo.', 'We could not find that team.')
  await withUser(ctx.user.id, async (tx) => {
    const team = (await tx<{ market_code: string; name: string }[]>`select market_code, name from crm.teams where id = ${teamId}`)[0]
    if (!team) throw notFound('No encontramos ese equipo.', 'We could not find that team.')
    const before = (await tx<{ user_id: string }[]>`select user_id from crm.team_champions where team_id = ${teamId} for update`)[0]
    if (userId === '') {
      if (!before) return
      await tx`delete from crm.team_champions where team_id = ${teamId}`
      await audit(tx, ctx, 'champion.set', 'team', teamId, team.market_code, { champion: before.user_id }, { champion: null })
      return
    }
    const member = await tx`select 1 from crm.memberships m where m.user_id = ${userId} and m.team_id = ${teamId} and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())`
    if (!member[0]) throw invalid('El champion tiene que ser una persona que hoy trabaja en ese equipo.', 'The champion has to be a person who works on that team today.')
    await tx`insert into crm.team_champions (team_id, user_id, named_by) values (${teamId}, ${userId}, ${ctx.user.id})
             on conflict (team_id) do update set user_id = excluded.user_id, named_by = excluded.named_by, named_at = now()`
    await audit(tx, ctx, 'champion.set', 'team', teamId, team.market_code, { champion: before?.user_id ?? null }, { champion: userId })
  })
}

/** La revisión mensual de administración con el champion de un equipo: una por equipo y mes. */
export async function recordChampionReview(ctx: Ctx, raw: { teamId: string; month: string; notes: string }, currentMonth: string): Promise<void> {
  ctx.assert('config.manage')
  if (!UUID.test(raw.teamId)) throw notFound('No encontramos ese equipo.', 'We could not find that team.')
  const notes = clean(raw.notes)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month) || raw.month > currentMonth) throw invalid('Elige el mes de la revisión; no puede ser un mes futuro.', 'Choose the month of the review; it cannot be a future month.')
  if (!notes || notes.length < 5 || notes.length > 2000) throw invalid('Escribe qué se revisó y qué quedó acordado.', 'Write what was reviewed and what was agreed.')
  assertNoProhibited(notes)
  await withUser(ctx.user.id, async (tx) => {
    const team = (await tx<{ market_code: string }[]>`select market_code from crm.teams where id = ${raw.teamId}`)[0]
    if (!team) throw notFound('No encontramos ese equipo.', 'We could not find that team.')
    if (!(await tx`select 1 from crm.team_champions where team_id = ${raw.teamId}`)[0]) throw invalid('Ese equipo todavía no tiene champion: nómbralo primero.', 'That team has no champion yet: name one first.')
    if ((await tx`select 1 from crm.champion_reviews where team_id = ${raw.teamId} and month = ${`${raw.month}-01`}`)[0]) throw invalid('La revisión de ese mes ya está anotada.', 'That month’s review is already recorded.')
    const id = await newId(tx)
    await tx`insert into crm.champion_reviews (id, team_id, month, notes, reviewed_by) values (${id}, ${raw.teamId}, ${`${raw.month}-01`}, ${notes}, ${ctx.user.id})`
    await audit(tx, ctx, 'champion.reviewed', 'team', raw.teamId, team.market_code, null, { month: raw.month })
  })
}

// ------------------------------------------------------------------ E7.F9: material por mercado

export const MATERIAL_KINDS = ['deck', 'lead_guide', 'faq'] as const
const materialInput = z.object({
  market: z.string().regex(/^[A-Z]{2}$/),
  kind: z.enum(MATERIAL_KINDS),
  locale: z.enum(['es', 'en']),
  title: z.string().trim().min(3).max(140),
  url: z.string().trim().regex(/^https:\/\/\S{4,490}$/),
  inPortal: z.boolean(),
  pinned: z.boolean(),
})

/** Guarda dónde está un material de capacitación de un mercado (el enlace, nunca el archivo) y si ya está publicado y fijado. */
export async function saveMaterial(ctx: Ctx, raw: z.input<typeof materialInput>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = materialInput.safeParse(raw)
  if (!parsed.success) throw invalid('El material lleva mercado, tipo, idioma, título y un enlace que empiece con https://.', 'The material needs a market, a type, a language, a title and a link that starts with https://.')
  const v = parsed.data
  assertNoProhibited(v.title, v.url)
  await withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const rows = await tx<{ id: string }[]>`
      insert into crm.training_materials (market_code, kind, locale, title, url, in_portal, pinned, updated_by)
      values (${v.market}, ${v.kind}, ${v.locale}, ${v.title}, ${v.url}, ${v.inPortal}, ${v.pinned}, ${ctx.user.id})
      on conflict (market_code, kind, locale) do update
        set title = excluded.title, url = excluded.url, in_portal = excluded.in_portal, pinned = excluded.pinned, updated_by = excluded.updated_by, updated_at = now()
      returning id`
    await audit(tx, ctx, 'material.saved', 'training_material', rows[0]!.id, v.market, null, { kind: v.kind, locale: v.locale, in_portal: v.inPortal, pinned: v.pinned })
  })
}

export async function removeMaterial(ctx: Ctx, id: string): Promise<void> {
  ctx.assert('config.manage')
  if (!UUID.test(id)) throw notFound('No encontramos ese material.', 'We could not find that material.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; kind: string; locale: string }[]>`delete from crm.training_materials where id = ${id} returning market_code, kind, locale`
    if (!rows[0]) throw notFound('No encontramos ese material.', 'We could not find that material.')
    await audit(tx, ctx, 'material.removed', 'training_material', id, rows[0].market_code, { kind: rows[0].kind, locale: rows[0].locale }, null)
  })
}
