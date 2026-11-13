import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { DomainError, invalid } from '@/lib/errors'
import { assertNoProhibited } from '@/domain/guard'

/**
 * Arranque de un mercado (E18.F2, F5, F6). El método es el del documento de requerimientos: primero se configura, se muestra
 * la herramienta terminada a quienes lideran, y solo después entra el equipo de campo, con presentación, guía de leads,
 * recorrido grabado, sesiones en español, acompañamiento en los primeros usos y actualizaciones con las preguntas que salgan.
 * Los pasos son los mismos para cualquier mercado (E18.F11): lo que cambia es el avance de cada uno.
 */
export type RolloutStep = { code: string; phase: 'leaders' | 'team'; es: string; en: string; hintEs: string; hintEn: string; link?: boolean }

export const ROLLOUT_STEPS: readonly RolloutStep[] = [
  { code: 'configure', phase: 'leaders', es: 'Configurar CONTIGO antes de mostrarlo', en: 'Configure CONTIGO before showing it',
    hintEs: 'Embudos, campos, territorios, formularios y turnos del mercado, listos.', hintEn: 'Pipelines, fields, territories, forms and rotations for the market, ready.' },
  { code: 'leaders_access', phase: 'leaders', es: 'Dar acceso a dirección, gerentes y personas clave', en: 'Give access to the general manager, managers and key people',
    hintEs: 'Quien lidera el mercado, supervisión, Operaciones y las personas clave de la lista.', hintEn: 'The market lead, supervisors, Operations and the key people on the list.' },
  { code: 'leaders_demo', phase: 'leaders', es: 'Mostrar la herramienta terminada a quienes lideran', en: 'Show the finished tool to the leaders',
    hintEs: 'Con sus datos ya cargados. Se enseña el proceso, no los botones.', hintEn: 'With their data already loaded. Teach the process, not the buttons.' },
  { code: 'deck', phase: 'leaders', es: 'Presentación de arranque en español', en: 'Onboarding deck in Spanish', link: true,
    hintEs: 'La presentación con la que se abre cada sesión.', hintEn: 'The deck that opens each session.' },
  { code: 'lead_guide', phase: 'leaders', es: 'Guía de leads en español', en: 'Lead guide in Spanish', link: true,
    hintEs: 'Cómo llega un lead, quién lo recibe, en cuánto tiempo se responde y cómo se convierte.', hintEn: 'How a lead arrives, who gets it, how fast it is answered and how it converts.' },
  { code: 'recording', phase: 'leaders', es: 'Recorrido grabado', en: 'Recorded walkthrough', link: true,
    hintEs: 'Un recorrido de punta a punta que el equipo puede volver a ver.', hintEn: 'An end-to-end walkthrough the team can watch again.' },
  { code: 'team_access', phase: 'team', es: 'Dar acceso al equipo de campo', en: 'Give access to the field team',
    hintEs: 'Se marca solo al abrir el mercado al equipo.', hintEn: 'It is ticked on its own when the market opens to the team.' },
  { code: 'sessions', phase: 'team', es: 'Sesiones en español con el equipo', en: 'Sessions in Spanish with the team',
    hintEs: 'Por tipo de venta: tiendas, y cadenas y distribuidores.', hintEn: 'By sale type: stores, and chains and distributors.' },
  { code: 'first_runs', phase: 'team', es: 'Acompañar los primeros usos', en: 'Be present at the first runs',
    hintEs: 'Alguien del arranque está con el equipo los primeros días.', hintEn: 'Someone from the rollout is with the team during the first days.' },
  { code: 'faq_updates', phase: 'team', es: 'Actualizar la guía con las preguntas que salieron', en: 'Update the guide with the questions that came up',
    hintEs: 'Lo que el equipo preguntó entra a la ayuda y a la guía.', hintEn: 'What the team asked goes into the help and the guide.' },
  { code: 'short_videos', phase: 'team', es: 'Videos cortos', en: 'Short videos', link: true,
    hintEs: 'Un video por tarea: recibir un lead, registrar una visita, mover un negocio.', hintEn: 'One video per task: taking a lead, logging a visit, moving a deal.' },
]

const stepOf = (code: string) => ROLLOUT_STEPS.find((s) => s.code === code)

async function leadersDone(tx: Parameters<Parameters<typeof withUser>[1]>[0], market: string): Promise<string[]> {
  const done = await tx<{ step: string }[]>`select step from crm.rollout_steps where market_code = ${market} and done_at is not null`
  return ROLLOUT_STEPS.filter((s) => s.phase === 'leaders' && !done.some((d) => d.step === s.code)).map((s) => s.code)
}

const LEADERS_FIRST = (missing: string[]) => new DomainError('leaders_first',
  `Primero quienes lideran: falta terminar ${missing.length === 1 ? 'un paso' : `${missing.length} pasos`} de esa parte (${missing.map((c) => stepOf(c)!.es).join('; ')}).`,
  `Leaders first: ${missing.length === 1 ? 'one step' : `${missing.length} steps`} of that part still to finish (${missing.map((c) => stepOf(c)!.en).join('; ')}).`)

/** Marca o desmarca un paso del arranque, con nota y, donde aplica, el enlace al material. Un paso del equipo no se marca antes que los de quienes lideran. */
export async function setRolloutStep(ctx: Ctx, market: string, code: string, input: { done: boolean; note?: string; link?: string }): Promise<void> {
  ctx.assert('rollout.manage', market)
  ctx.market(market)
  const step = stepOf(code)
  if (!step) throw invalid('Ese paso no existe.', 'That step does not exist.')
  const note = (input.note ?? '').trim().slice(0, 300) || null
  const link = (input.link ?? '').trim() || null
  assertNoProhibited(note)
  if (link && (!step.link || !z.string().url().safeParse(link).success || !link.startsWith('https://') || link.length > 300)) {
    throw invalid('El enlace tiene que empezar con https:// y medir hasta 300 caracteres.', 'The link must start with https:// and be up to 300 characters long.')
  }
  await withUser(ctx.user.id, async (tx) => {
    if (input.done && step.phase === 'team') {
      const missing = await leadersDone(tx, market)
      if (missing.length) throw LEADERS_FIRST(missing)
    }
    const prev = await tx<{ done_at: Date | null; note: string | null; link: string | null }[]>`select done_at, note, link from crm.rollout_steps where market_code = ${market} and step = ${code} for update`
    const was = prev[0] ?? { done_at: null, note: null, link: null }
    if (Boolean(was.done_at) === input.done && was.note === note && was.link === link) return
    await tx`insert into crm.rollout_steps (market_code, step, done_at, done_by, note, link)
             values (${market}, ${code}, ${input.done ? tx`now()` : null}, ${input.done ? ctx.user.id : null}, ${note}, ${link})
             on conflict (market_code, step) do update set
               done_at = case when ${input.done} then coalesce(crm.rollout_steps.done_at, now()) else null end,
               done_by = case when ${input.done} then coalesce(crm.rollout_steps.done_by, ${ctx.user.id}) else null end,
               note = excluded.note, link = excluded.link, updated_at = now()`
    await audit(tx, ctx, 'rollout.step_set', 'market', null, market, { step: code, done: Boolean(was.done_at) }, { step: code, done: input.done, ...(link ? { link: true } : {}) })
  })
}

/**
 * "Primero quienes lideran": mientras esté activo, en ese mercado solo se puede dar acceso de Ventas a las personas clave
 * de la lista; dirección, líder de mercado, supervisión y Operaciones entran siempre. La base repite el límite.
 */
export async function setLeadersFirst(ctx: Ctx, market: string, on: boolean): Promise<void> {
  ctx.assert('rollout.manage', market)
  ctx.market(market)
  await withUser(ctx.user.id, async (tx) => {
    const prev = await tx<{ leaders_first: boolean; team_opened_at: Date | null }[]>`select leaders_first, team_opened_at from crm.market_rollout where market_code = ${market} for update`
    if ((prev[0]?.leaders_first ?? false) === on && !(on && prev[0]?.team_opened_at)) return
    await tx`insert into crm.market_rollout (market_code, leaders_first, team_opened_at, updated_by) values (${market}, ${on}, null, ${ctx.user.id})
             on conflict (market_code) do update set leaders_first = ${on}, team_opened_at = null, updated_by = ${ctx.user.id}, updated_at = now()`
    await audit(tx, ctx, 'rollout.leaders_first_set', 'market', null, market, { leaders_first: prev[0]?.leaders_first ?? false }, { leaders_first: on })
  })
}

/** Abre el mercado al equipo de campo. Solo cuando los pasos de quienes lideran están terminados. */
export async function openToTeam(ctx: Ctx, market: string): Promise<void> {
  ctx.assert('rollout.manage', market)
  ctx.market(market)
  await withUser(ctx.user.id, async (tx) => {
    const missing = await leadersDone(tx, market)
    if (missing.length) throw LEADERS_FIRST(missing)
    await tx`insert into crm.market_rollout (market_code, leaders_first, team_opened_at, updated_by) values (${market}, true, now(), ${ctx.user.id})
             on conflict (market_code) do update set team_opened_at = coalesce(crm.market_rollout.team_opened_at, now()), updated_by = ${ctx.user.id}, updated_at = now()`
    await tx`insert into crm.rollout_steps (market_code, step, done_at, done_by) values (${market}, 'team_access', now(), ${ctx.user.id})
             on conflict (market_code, step) do update set done_at = coalesce(crm.rollout_steps.done_at, now()), done_by = coalesce(crm.rollout_steps.done_by, ${ctx.user.id}), updated_at = now()`
    await audit(tx, ctx, 'rollout.team_opened', 'market', null, market, null, { team_open: true })
  })
}

const emailInput = z.string().trim().toLowerCase().email().max(160)

/** Persona clave: alguien de Ventas que entra con quienes lideran, antes que el resto del equipo. Se anota por correo, tenga o no acceso todavía. */
export async function setKeyPerson(ctx: Ctx, market: string, rawEmail: string, on: boolean): Promise<void> {
  ctx.assert('rollout.manage', market)
  ctx.market(market)
  const email = emailInput.safeParse(rawEmail)
  if (!email.success) throw invalid('Escribe un correo válido.', 'Enter a valid email.')
  await withUser(ctx.user.id, async (tx) => {
    const done = on
      ? await tx`insert into crm.rollout_key_people (market_code, email, added_by) values (${market}, ${email.data}, ${ctx.user.id}) on conflict do nothing returning 1`
      : await tx`delete from crm.rollout_key_people where market_code = ${market} and email = ${email.data} returning 1`
    if (done.length === 0) return
    // La bitácora no guarda el correo: dice que la lista cambió y cuántas personas quedan.
    const left = await tx<{ n: number }[]>`select count(*)::int as n from crm.rollout_key_people where market_code = ${market}`
    await audit(tx, ctx, on ? 'rollout.key_person_added' : 'rollout.key_person_removed', 'market', null, market, null, { key_people: left[0]?.n ?? 0 })
  })
}

/**
 * Antes de dar un acceso de Ventas: si el mercado está en "primero quienes lideran" y la persona no es clave, se explica
 * por qué no entra todavía (la base lo rechazaría de todos modos, sin explicación).
 */
export async function assertRolloutAllows(tx: Parameters<Parameters<typeof withUser>[1]>[0], market: string | null | undefined, role: string, email: string): Promise<void> {
  if (role !== 'rep' || !market) return
  const rows = await tx<{ blocked: boolean }[]>`
    select exists (select 1 from crm.market_rollout r where r.market_code = ${market} and r.leaders_first and r.team_opened_at is null)
           and not exists (select 1 from crm.rollout_key_people k where k.market_code = ${market} and k.email = ${email}::citext) as blocked`
  if (rows[0]?.blocked) {
    throw new DomainError('leaders_first',
      'Este mercado está en "primero quienes lideran": todavía no se abre al equipo de campo. Agrega a la persona como clave en Arranque del mercado, o abre el mercado al equipo.',
      'This market is in "leaders first": it is not open to the field team yet. Add the person as key under Market rollout, or open the market to the team.')
  }
}
