import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { MOTORS } from '@/domain/b2b'
import { invalid, notFound } from '@/lib/errors'

const label = z.string().trim().min(2).max(60)
const slugOf = (s: string, max = 36) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, max)

// ================================================================ GOB-01 / DAT-05: gobierno de campos

export const PII_CLASSES = ['none', 'personal', 'sensitive'] as const
const governance = z.object({
  ownerId: z.guid(),
  purpose: z.string().trim().min(5).max(400),
  /** La decisión que el campo habilita: sin decisión documentada no hay campo. */
  decision: z.string().trim().min(10).max(400),
  reviewOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  piiClass: z.enum(PII_CLASSES),
  dataClass: z.enum(['public', 'internal', 'confidential']).optional().default('internal'),
  untrusted: z.boolean().optional().default(false),
  origin: z.string().trim().max(200).optional().default(''),
  usedBy: z.string().trim().max(200).optional().default(''),
})
export type GovernanceInput = z.input<typeof governance>

function parseGovernance(input: GovernanceInput) {
  const parsed = governance.safeParse(input)
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] ?? '')
    if (f === 'decision') throw invalid('Escribe qué decisión habilita este campo (al menos 10 letras). Sin decisión no hay campo.', 'Say which decision this field enables (at least 10 characters). No decision, no field.')
    if (f === 'ownerId') throw invalid('Elige a la persona que responde por este campo.', 'Pick the person who owns this field.')
    if (f === 'purpose') throw invalid('Escribe para qué sirve el campo (al menos 5 letras).', 'Say what the field is for (at least 5 characters).')
    if (f === 'reviewOn') throw invalid('Pon la fecha en que se revisa si el campo sigue haciendo falta.', 'Set the date to review whether the field is still needed.')
    throw invalid('Revisa los datos de gobierno del campo.', 'Check the field’s governance details.')
  }
  assertNoProhibited(parsed.data.purpose, parsed.data.decision, parsed.data.origin, parsed.data.usedBy)
  return parsed.data
}

async function assertOwner(tx: Tx, ownerId: string) {
  if (!(await tx`select 1 from crm.users where id = ${ownerId} and is_active and not is_system`)[0]) throw invalid('Esa persona no está activa en CONTIGO.', 'That person is not active in CONTIGO.')
}

const fieldEdit = z.object({ labelEs: label, labelEn: label, options: z.array(z.string().trim().min(1).max(60)).max(30).optional() })

/** Editor del registro: cambia la etiqueta (la llave no cambia, así lo capturado no se pierde), las opciones y el gobierno del campo. */
export async function updateField(ctx: Ctx, id: string, input: z.input<typeof fieldEdit> & GovernanceInput): Promise<void> {
  ctx.assert('config.manage')
  const base = fieldEdit.safeParse(input)
  if (!base.success) throw invalid('El campo lleva nombre en español y en inglés (de 2 a 60 letras).', 'A field needs a name in Spanish and in English (2 to 60 characters).')
  const g = parseGovernance(input)
  assertNoProhibited(base.data.labelEs, base.data.labelEn, ...(base.data.options ?? []))
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ object: string; key: string; market_code: string | null; label_es: string; label_en: string; data_type: string; options: string[]; decision: string | null; owner_id: string | null }[]>`
      select object, key, market_code, label_es, label_en, data_type, options, decision, owner_id from crm.field_definitions where id = ${id} for update`
    const f = rows[0]
    if (!f) throw notFound()
    await assertOwner(tx, g.ownerId)
    const today = (await tx<{ d: string }[]>`select ${marketToday(tx, f.market_code ?? 'MX')}::text as d`)[0]!.d
    if (g.reviewOn <= today) throw invalid('La fecha de revisión tiene que ser futura.', 'The review date must be in the future.')
    // En una lista se pueden agregar opciones; las que ya existen no se quitan desde aquí (hay registros que las usan).
    let options = f.options
    if (f.data_type === 'select' && base.data.options) {
      const next = [...new Set(base.data.options)]
      const lost = f.options.filter((o) => !next.includes(o))
      if (lost.length) throw invalid(`No se quitan opciones que ya existen (${lost.join(', ')}): hay registros que las usan. Puedes agregar nuevas.`, `Existing options cannot be removed (${lost.join(', ')}): records use them. You can add new ones.`)
      options = next
    }
    await tx`update crm.field_definitions set label_es = ${base.data.labelEs}, label_en = ${base.data.labelEn}, options = ${tx.json(options)},
              owner_id = ${g.ownerId}, purpose = ${g.purpose}, decision = ${g.decision}, review_on = ${g.reviewOn}, pii_class = ${g.piiClass}, data_class = ${g.dataClass},
              untrusted = ${g.untrusted}, origin = ${clean(g.origin)}, used_by = ${clean(g.usedBy)} where id = ${id}`
    await audit(tx, ctx, 'field.updated', 'field', id, f.market_code, { label_es: f.label_es, decision: f.decision, owner_id: f.owner_id },
      { label_es: base.data.labelEs, decision: g.decision, owner_id: g.ownerId, review_on: g.reviewOn, pii_class: g.piiClass, object: f.object, key: f.key })
  })
}

const proposal = z.object({
  object: z.enum(['account', 'deal', 'lead']),
  market: z.string().length(2),
  motor: z.enum(MOTORS).or(z.literal('')).optional().default(''),
  labelEs: label,
  labelEn: label,
  dataType: z.enum(['text', 'number', 'select', 'date', 'boolean']),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
})

/**
 * Quien lidera un mercado propone un campo para SU mercado, con dueño y la decisión que habilita. No aparece en ninguna ficha
 * hasta que administración lo aprueba. El plazo publicado para responder está en `field_approval_sla_days`.
 */
export async function proposeField(ctx: Ctx, input: z.input<typeof proposal> & GovernanceInput): Promise<string> {
  const parsed = proposal.safeParse(input)
  if (!parsed.success) throw invalid('El campo lleva mercado, nombre en español y en inglés (de 2 a 60 letras) y su tipo.', 'A field needs a market, a name in Spanish and in English (2 to 60 characters) and its type.')
  const v = parsed.data
  ctx.assert('field.propose', v.market)
  const g = parseGovernance(input)
  assertNoProhibited(v.labelEs, v.labelEn, ...v.options)
  const options = v.dataType === 'select' ? [...new Set(v.options)] : []
  if (v.dataType === 'select' && options.length < 2) throw invalid('Una lista lleva al menos dos opciones, una por renglón.', 'A list needs at least two options, one per line.')
  return withUser(ctx.user.id, async (tx) => {
    await assertOwner(tx, g.ownerId)
    const clash = await tx`select 1 from crm.field_definitions where object = ${v.object} and (is_active or status = 'proposed') and (market_code is null or market_code = ${v.market})
      and (lower(label_es) = lower(${v.labelEs}) or lower(label_en) = lower(${v.labelEn}))`
    if (clash[0]) throw invalid('Ya hay un campo o una propuesta con ese nombre.', 'There is already a field or a proposal with that name.')
    const base = slugOf(v.labelEn, 50) || 'field'
    let key = base.length >= 2 ? base : `${base}_x`
    for (let i = 2; (await tx`select 1 from crm.field_definitions where object = ${v.object} and key = ${key}`)[0]; i++) key = `${base}_${i}`
    const id = await newId(tx)
    await tx`insert into crm.field_definitions (id, object, key, label_es, label_en, data_type, options, market_code, motor, is_active, status, proposed_by, proposed_at,
               owner_id, purpose, decision, review_on, pii_class, data_class, untrusted, origin, used_by, position)
             values (${id}, ${v.object}, ${key}, ${v.labelEs}, ${v.labelEn}, ${v.dataType}, ${tx.json(options)}, ${v.market}, ${v.motor || null}, false, 'proposed', ${ctx.user.id}, now(),
               ${g.ownerId}, ${g.purpose}, ${g.decision}, ${g.reviewOn}, ${g.piiClass}, ${g.dataClass}, ${g.untrusted}, ${clean(g.origin)}, ${clean(g.usedBy)},
               (select coalesce(max(position), 0) + 1 from crm.field_definitions where object = ${v.object}))`
    await audit(tx, ctx, 'field.proposed', 'field', id, v.market, null, { object: v.object, key, label_es: v.labelEs, decision: g.decision })
    return id
  })
}

/** Administración decide una propuesta: aprobada, el campo aparece en las fichas de su mercado; rechazada, queda con su motivo. */
export async function decideField(ctx: Ctx, id: string, approve: boolean, note: string): Promise<void> {
  ctx.assert('config.manage')
  const why = note.trim()
  if (!approve && why.length < 5) throw invalid('Escribe por qué se rechaza (al menos 5 letras): quien lo propuso lo va a leer.', 'Say why it is rejected (at least 5 characters): the person who proposed it will read it.')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ status: string; market_code: string | null; key: string; object: string }[]>`select status, market_code, key, object from crm.field_definitions where id = ${id} for update`
    const f = rows[0]
    if (!f) throw notFound()
    if (f.status !== 'proposed') throw invalid('Esa propuesta ya se decidió.', 'That proposal was already decided.')
    await tx`update crm.field_definitions set status = ${approve ? 'approved' : 'rejected'}, is_active = ${approve}, decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${clean(why.slice(0, 400))} where id = ${id}`
    await audit(tx, ctx, approve ? 'field.approved' : 'field.rejected', 'field', id, f.market_code, { status: 'proposed' }, { object: f.object, key: f.key, note: clean(why) })
  })
}

// ================================================================ DAT-05: formularios, turnos y mercados desde la pantalla

const formInput = z.object({
  market: z.string().length(2),
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,60}$/),
  motor: z.enum(MOTORS),
  locale: z.enum(['es', 'en']),
  routingRuleId: z.guid().or(z.literal('')).optional().default(''),
})

/** Un formulario web nuevo, sin migración: mercado, tipo de venta, idioma y a qué turno entrega sus leads. */
export async function createWebForm(ctx: Ctx, input: z.input<typeof formInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = formInput.safeParse(input)
  if (!parsed.success) {
    if (String(parsed.error.issues[0]?.path[0]) === 'slug') throw invalid('La dirección del formulario lleva de 3 a 60 letras minúsculas, números o guiones.', 'The form address takes 3 to 60 lowercase letters, numbers or hyphens.')
    throw invalid('El formulario lleva mercado, nombre, dirección, tipo de venta e idioma.', 'A form needs a market, name, address, sales type and language.')
  }
  const v = parsed.data
  assertNoProhibited(v.name)
  return withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    if ((await tx`select 1 from crm.web_forms where slug = ${v.slug}`)[0]) throw invalid('Ya hay un formulario con esa dirección.', 'There is already a form with that address.')
    if (v.routingRuleId && !(await tx`select 1 from crm.routing_rules where id = ${v.routingRuleId} and market_code = ${v.market}`)[0]) throw invalid('Ese turno no es de este mercado.', 'That rotation does not belong to this market.')
    const id = await newId(tx)
    await tx`insert into crm.web_forms (id, market_code, slug, name, motor, locale, routing_rule_id) values (${id}, ${v.market}, ${v.slug}, ${v.name}, ${v.motor}, ${v.locale}, ${v.routingRuleId || null})`
    await audit(tx, ctx, 'form.created', 'form', id, v.market, null, { slug: v.slug, name: v.name, motor: v.motor })
    return id
  })
}

export async function setWebFormActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; is_active: boolean }[]>`select market_code, is_active from crm.web_forms where id = ${id} for update`
    if (!rows[0]) throw notFound()
    if (rows[0].is_active === active) return
    await tx`update crm.web_forms set is_active = ${active} where id = ${id}`
    await audit(tx, ctx, 'form.toggled', 'form', id, rows[0].market_code, { is_active: rows[0].is_active }, { is_active: active })
  })
}

const ruleInput = z.object({
  market: z.string().length(2),
  name: z.string().trim().min(2).max(80),
  strategy: z.enum(['round_robin', 'territory', 'fixed']),
  memberIds: z.array(z.guid()).max(60),
  fallbackId: z.guid().or(z.literal('')).optional().default(''),
  slaMinutes: z.number().int().min(5).max(7 * 24 * 60),
})

/** Un turno de leads nuevo, sin migración. Solo entran personas que hoy venden en ese mercado. */
export async function createRoutingRule(ctx: Ctx, input: z.input<typeof ruleInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = ruleInput.safeParse(input)
  if (!parsed.success) throw invalid('El turno lleva mercado, nombre, forma de reparto y minutos para el primer contacto (de 5 minutos a 7 días).', 'A rotation needs a market, a name, how it hands out leads and minutes to first contact (5 minutes to 7 days).')
  const v = parsed.data
  assertNoProhibited(v.name)
  return withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    if ((await tx`select 1 from crm.routing_rules where market_code = ${v.market} and lower(name) = lower(${v.name})`)[0]) throw invalid('Ya hay un turno con ese nombre en ese mercado.', 'There is already a rotation with that name in that market.')
    const people = [...new Set([...v.memberIds, ...(v.fallbackId ? [v.fallbackId] : [])])]
    for (const p of people) {
      const ok = await tx<{ ok: boolean }[]>`select app.can_sell_in(${p}, ${v.market}) as ok`
      if (!ok[0]?.ok) throw invalid('En el turno solo entran personas que hoy venden en ese mercado.', 'Only people who sell in that market today can be in the rotation.')
    }
    if (v.strategy !== 'fixed' && v.memberIds.length === 0) throw invalid('Elige al menos a una persona para el turno.', 'Pick at least one person for the rotation.')
    if (v.strategy === 'fixed' && !v.fallbackId) throw invalid('Un turno fijo lleva a la persona que recibe todo.', 'A fixed rotation needs the person who gets everything.')
    const id = await newId(tx)
    await tx`insert into crm.routing_rules (id, market_code, name, strategy, member_ids, fallback_id, sla_minutes) values (${id}, ${v.market}, ${v.name}, ${v.strategy}, ${v.memberIds}::uuid[], ${v.fallbackId || null}, ${v.slaMinutes})`
    await audit(tx, ctx, 'routing.rule_created', 'routing_rule', id, v.market, null, { name: v.name, strategy: v.strategy, member_ids: v.memberIds, sla_minutes: v.slaMinutes })
    return id
  })
}

export async function setRoutingRuleActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; is_active: boolean }[]>`select market_code, is_active from crm.routing_rules where id = ${id} for update`
    if (!rows[0]) throw notFound()
    if (rows[0].is_active === active) return
    if (!active && (await tx`select 1 from crm.web_forms where routing_rule_id = ${id} and is_active`)[0]) throw invalid('Hay un formulario activo que entrega a este turno. Pausa antes el formulario o cámbiale el turno.', 'An active form hands its leads to this rotation. Pause the form first or point it to another rotation.')
    await tx`update crm.routing_rules set is_active = ${active} where id = ${id}`
    await audit(tx, ctx, 'routing.rule_toggled', 'routing_rule', id, rows[0].market_code, { is_active: rows[0].is_active }, { is_active: active })
  })
}

const marketInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  name: z.string().trim().min(2).max(60),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  locale: z.enum(['es', 'en']),
  timezone: z.string().trim().min(3).max(60),
  phoneCc: z.string().trim().regex(/^\+[1-9][0-9]{0,3}$/),
})

/**
 * Un mercado nuevo, sin migración. Nace "en preparación": no recibe registros hasta que administración lo abre, ya con su
 * embudo, su equipo y su horario. Así un mercado a medio configurar no aparece en los selectores de quien vende.
 */
export async function createMarket(ctx: Ctx, input: z.input<typeof marketInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = marketInput.safeParse(input)
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] ?? '')
    if (f === 'code') throw invalid('El código del mercado son dos letras (el del país).', 'The market code is two letters (the country’s).')
    if (f === 'currency') throw invalid('La moneda son tres letras (por ejemplo MXN o USD).', 'The currency is three letters (for example MXN or USD).')
    if (f === 'phoneCc') throw invalid('La clave telefónica empieza con + y lleva de 1 a 4 números.', 'The dialing code starts with + and has 1 to 4 digits.')
    throw invalid('El mercado lleva código, nombre, moneda, idioma, zona horaria y clave telefónica.', 'A market needs a code, name, currency, language, time zone and dialing code.')
  }
  const v = parsed.data
  return withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from pg_timezone_names where name = ${v.timezone}`)[0]) throw invalid('Esa zona horaria no existe. Usa el nombre completo, por ejemplo America/Bogota.', 'That time zone does not exist. Use the full name, for example America/Bogota.')
    if ((await tx`select 1 from crm.markets where code = ${v.code}`)[0]) throw invalid('Ya existe un mercado con ese código.', 'There is already a market with that code.')
    await tx`insert into crm.markets (code, name, currency, default_locale, locales, timezone, phone_cc, status) values (${v.code}, ${v.name}, ${v.currency}, ${v.locale}, ${[v.locale]}::text[], ${v.timezone}, ${v.phoneCc}, 'planned')`
    await tx`insert into crm.market_hours (market_code, updated_by) values (${v.code}, ${ctx.user.id}) on conflict do nothing`
    await audit(tx, ctx, 'market.created', 'market', null, v.code, null, { code: v.code, name: v.name, currency: v.currency, timezone: v.timezone, status: 'planned' })
    return v.code
  })
}

/** Abrir un mercado (o volverlo a "en preparación") y corregir su nombre. Para abrirlo hace falta al menos un embudo con etapas. */
export async function updateMarket(ctx: Ctx, code: string, input: { name: string; status: 'live' | 'planned' }): Promise<void> {
  ctx.assert('config.manage')
  const name = input.name.trim()
  if (name.length < 2 || name.length > 60) throw invalid('El mercado lleva un nombre de 2 a 60 letras.', 'A market needs a name of 2 to 60 characters.')
  if (input.status !== 'live' && input.status !== 'planned') throw invalid('Elige si el mercado está abierto o en preparación.', 'Choose whether the market is open or being set up.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ name: string; status: string }[]>`select name, status from crm.markets where code = ${code} for update`
    const m = rows[0]
    if (!m) throw notFound()
    if (input.status === 'live' && m.status !== 'live') {
      const ready = await tx`select 1 from crm.pipelines p where p.market_code = ${code} and exists (select 1 from crm.stages s where s.pipeline_id = p.id) limit 1`
      if (!ready[0]) throw invalid('Antes de abrir el mercado créale un embudo con sus etapas, en Administración, Embudos y campos.', 'Before opening the market, create a pipeline with its stages for it, under Administration, Pipelines and fields.')
    }
    if (input.status === 'planned' && m.status === 'live' && (await tx`select 1 from crm.accounts where market_code = ${code} limit 1`)[0])
      throw invalid('Ese mercado ya tiene comercios: no vuelve a "en preparación".', 'That market already has merchants: it cannot go back to being set up.')
    if (m.name === name && m.status === input.status) return
    await tx`update crm.markets set name = ${name}, status = ${input.status} where code = ${code}`
    await audit(tx, ctx, 'market.updated', 'market', null, code, { name: m.name, status: m.status }, { name, status: input.status })
  })
}

/** DAT-01: cuántos niveles admite un árbol cuya raíz es de este tipo (contando la raíz). Vacío: sin límite. */
export async function setTypeDepth(ctx: Ctx, typeId: string, maxDepth: number | null): Promise<void> {
  ctx.assert('config.manage')
  if (maxDepth !== null && (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 12)) throw invalid('Los niveles van de 1 a 12, o vacío para no poner límite.', 'Levels go from 1 to 12, or empty for no limit.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; market_code: string | null; max_depth: number | null }[]>`select code, market_code, max_depth from crm.account_types where id = ${typeId} for update`
    const ty = rows[0]
    if (!ty) throw notFound()
    if (ty.max_depth === maxDepth) return
    if (maxDepth !== null) {
      // No se baja el límite por debajo de un árbol que ya existe: primero se acomoda el árbol.
      const deepest = await tx<{ d: number | null }[]>`
        select max((select coalesce(max(cardinality(d.ancestor_ids)), 0) + 1 from crm.accounts d where d.id = r.id or d.ancestor_ids @> array[r.id])) as d
          from crm.accounts r where r.parent_id is null and r.account_type = ${ty.code} and r.archived_at is null and (${ty.market_code}::text is null or r.market_code = ${ty.market_code})`
      if ((deepest[0]?.d ?? 0) > maxDepth) throw invalid(`Ya hay un árbol de este tipo con ${deepest[0]!.d} niveles. Acomoda ese árbol antes de bajar el límite.`, `There is already a tree of this type with ${deepest[0]!.d} levels. Rearrange that tree before lowering the limit.`)
    }
    await tx`update crm.account_types set max_depth = ${maxDepth} where id = ${typeId}`
    await audit(tx, ctx, 'account_type.depth_set', 'account_type', typeId, ty.market_code, { max_depth: ty.max_depth }, { code: ty.code, max_depth: maxDepth })
  })
}

// ================================================================ DAT-05: procesos paralelos por mercado

export type ProcessStatus = { code: string; es: string; en: string }
export type ProcessAttr = { key: string; es: string; en: string }
/** Un renglón por elemento: "Texto en español | Text in English". Sin la barra, el mismo texto vale para los dos idiomas. */
const pairs = (lines: string[]) =>
  lines.map((l) => {
    const [es, en] = l.split('|').map((x) => x.trim())
    return { es: es ?? '', en: en || es || '' }
  }).filter((p) => p.es.length >= 2 && p.es.length <= 60 && p.en.length <= 60)

/**
 * Una lista de proceso del mercado (capacitación, una campaña con un proveedor): sus propios estados y sus propios datos,
 * al lado del embudo y sin tocarlo. La define quien lidera el mercado o administración, desde la pantalla.
 */
export async function createProcessList(ctx: Ctx, input: { market: string; nameEs: string; nameEn: string; statuses: string[]; attributes: string[] }): Promise<string> {
  ctx.assert('process.define', input.market)
  const names = z.object({ nameEs: z.string().trim().min(2).max(80), nameEn: z.string().trim().min(2).max(80) }).safeParse(input)
  if (!names.success) throw invalid('La lista lleva nombre en español y en inglés (de 2 a 80 letras).', 'A list needs a name in Spanish and in English (2 to 80 characters).')
  const st = pairs(input.statuses)
  const at = pairs(input.attributes)
  if (st.length < 2 || st.length > 12) throw invalid('La lista lleva de 2 a 12 estados, uno por renglón. El último es el que la cierra.', 'A list takes 2 to 12 statuses, one per line. The last one closes it.')
  if (at.length > 10) throw invalid('Una lista lleva hasta 10 datos propios.', 'A list takes up to 10 details of its own.')
  assertNoProhibited(names.data.nameEs, names.data.nameEn, ...st.flatMap((s) => [s.es, s.en]), ...at.flatMap((s) => [s.es, s.en]))
  const uniq = <T extends { es: string; en: string }>(xs: T[], field: 'code' | 'key') => {
    const seen = new Set<string>()
    return xs.map((x, i) => {
      let k = slugOf(x.en, 30) || `${field}_${i + 1}`
      if (k.length < 2) k = `${field}_${i + 1}`
      while (seen.has(k)) k = `${k}_${i + 1}`
      seen.add(k)
      return { [field]: k, es: x.es, en: x.en }
    })
  }
  const statuses = uniq(st, 'code')
  const attributes = uniq(at, 'key')
  return withUser(ctx.user.id, async (tx) => {
    ctx.market(input.market)
    const base = slugOf(names.data.nameEn) || 'list'
    let code = base.length >= 2 ? base : `${base}_x`
    for (let i = 2; (await tx`select 1 from crm.process_lists where market_code = ${input.market} and code = ${code}`)[0]; i++) code = `${base}_${i}`
    if ((await tx`select 1 from crm.process_lists where market_code = ${input.market} and is_active and (lower(name_es) = lower(${names.data.nameEs}) or lower(name_en) = lower(${names.data.nameEn}))`)[0])
      throw invalid('Ya hay una lista con ese nombre en ese mercado.', 'There is already a list with that name in that market.')
    const id = await newId(tx)
    await tx`insert into crm.process_lists (id, market_code, code, name_es, name_en, statuses, attributes, created_by)
             values (${id}, ${input.market}, ${code}, ${names.data.nameEs}, ${names.data.nameEn}, ${tx.json(statuses)}, ${tx.json(attributes)}, ${ctx.user.id})`
    await audit(tx, ctx, 'process.list_created', 'process_list', id, input.market, null, { code, name_es: names.data.nameEs, statuses: statuses.length, attributes: attributes.length })
    return id
  })
}

export async function setProcessListActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; is_active: boolean }[]>`select market_code, is_active from crm.process_lists where id = ${id} for update`
    if (!rows[0]) throw notFound()
    ctx.assert('process.define', rows[0].market_code)
    if (rows[0].is_active === active) return
    await tx`update crm.process_lists set is_active = ${active} where id = ${id}`
    await audit(tx, ctx, 'process.list_toggled', 'process_list', id, rows[0].market_code, { is_active: rows[0].is_active }, { is_active: active })
  })
}

/** Poner un comercio en una lista de proceso o cambiar su estado y sus datos. El último estado de la lista cierra el proceso. */
export async function setProcessStatus(ctx: Ctx, accountId: string, listId: string, status: string, attrs: Record<string, string> = {}): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId} and archived_at is null`
    if (!acc[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('account.edit', acc[0].market_code)
    const lists = await tx<{ market_code: string; statuses: ProcessStatus[]; attributes: ProcessAttr[]; is_active: boolean }[]>`select market_code, statuses, attributes, is_active from crm.process_lists where id = ${listId}`
    const list = lists[0]
    if (!list || list.market_code !== acc[0].market_code) throw invalid('Esa lista no es del mercado de este comercio.', 'That list does not belong to this merchant’s market.')
    if (!list.statuses.some((s) => s.code === status)) throw invalid('Elige un estado de la lista.', 'Pick a status from the list.')
    const clean_: Record<string, string> = {}
    for (const a of list.attributes) {
      const val = (attrs[a.key] ?? '').trim().slice(0, 200)
      if (val) clean_[a.key] = val
    }
    assertNoProhibited(...Object.values(clean_))
    const closes = list.statuses[list.statuses.length - 1]!.code === status
    const live = await tx<{ id: string; status: string }[]>`select id, status from crm.process_memberships where list_id = ${listId} and account_id = ${accountId} and ended_at is null for update`
    if (live[0]) {
      await tx`update crm.process_memberships set status = ${status}, attrs = ${tx.json(clean_)}, status_at = case when status = ${status} then status_at else now() end,
                ended_at = ${closes ? tx`now()` : tx`null`}, updated_by = ${ctx.user.id} where id = ${live[0].id}`
      await audit(tx, ctx, 'process.status_changed', 'account', accountId, acc[0].market_code, { list_id: listId, status: live[0].status }, { status, closed: closes })
    } else {
      if (!list.is_active) throw invalid('Esa lista ya no se usa.', 'That list is no longer in use.')
      await tx`insert into crm.process_memberships (list_id, account_id, market_code, status, attrs, ended_at, updated_by)
               values (${listId}, ${accountId}, ${acc[0].market_code}, ${status}, ${tx.json(clean_)}, ${closes ? tx`now()` : tx`null`}, ${ctx.user.id})`
      await audit(tx, ctx, 'process.enrolled', 'account', accountId, acc[0].market_code, null, { list_id: listId, status })
    }
  })
}

// ================================================================ GOB-02: reglas de calidad con responsable

export const QUALITY_OWNER_ROLES = ['admin', 'market_lead', 'supervisor', 'ops'] as const

/** Cada regla de calidad tiene quién responde por ella (un rol y, si se quiere, una persona) y, las de vencimiento, sus días. */
export async function setQualityRule(ctx: Ctx, code: string, input: { ownerRole: string; ownerId: string; threshold: number | null; active: boolean }): Promise<void> {
  ctx.assert('config.manage')
  if (!(QUALITY_OWNER_ROLES as readonly string[]).includes(input.ownerRole)) throw invalid('Elige quién responde por la regla.', 'Pick who owns the rule.')
  if (input.threshold !== null && (!Number.isInteger(input.threshold) || input.threshold < 7 || input.threshold > 730)) throw invalid('Los días van de 7 a 730.', 'Days go from 7 to 730.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ owner_role: string; owner_id: string | null; threshold: number | null; is_active: boolean }[]>`select owner_role, owner_id, threshold, is_active from crm.quality_rules where code = ${code} for update`
    const r = rows[0]
    if (!r) throw notFound()
    if (input.ownerId) await assertOwner(tx, input.ownerId)
    const threshold = r.threshold === null ? null : (input.threshold ?? r.threshold)
    await tx`update crm.quality_rules set owner_role = ${input.ownerRole}, owner_id = ${input.ownerId || null}, threshold = ${threshold}, is_active = ${input.active} where code = ${code}`
    await audit(tx, ctx, 'quality.rule_updated', 'quality_rule', null, null, { code, ...r }, { code, owner_role: input.ownerRole, owner_id: input.ownerId || null, threshold, is_active: input.active })
  })
}

// ================================================================ DAT-07: productos por comercio

export const PRODUCT_STATUSES = ['requested', 'submitted', 'approved', 'active', 'rejected', 'suspended'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/**
 * Un producto de un comercio y su estado con el proveedor: solicitado, enviado al proveedor, aprobado, activo, rechazado o
 * suspendido, cada paso con su fecha. Es el mismo registro que alimenta el estado por proveedor que Operaciones marca en un negocio.
 */
export async function setAccountProduct(ctx: Ctx, accountId: string, input: { productId: string; providerId: string; status: string; note?: string }): Promise<string> {
  if (!(PRODUCT_STATUSES as readonly string[]).includes(input.status)) throw invalid('Elige un estado de la lista.', 'Pick a status from the list.')
  const status = input.status as ProductStatus
  const note = (input.note ?? '').trim().slice(0, 300)
  assertNoProhibited(note)
  if (!input.productId && !input.providerId) throw invalid('Elige el producto o el proveedor.', 'Pick the product or the provider.')
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId} and archived_at is null`
    if (!acc[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    const market = acc[0].market_code
    ctx.assert('account.products', market)
    let providerId = input.providerId || null
    if (input.productId) {
      const p = await tx<{ provider_id: string | null }[]>`select provider_id from crm.products where id = ${input.productId} and is_active and (market_code is null or market_code = ${market})`
      if (!p[0]) throw invalid('Ese producto no es del catálogo de este mercado.', 'That product is not in this market’s catalog.')
      providerId = providerId ?? p[0].provider_id
    }
    if (providerId && !(await tx`select 1 from crm.ops_catalog where id = ${providerId} and kind = 'provider' and (market_code is null or market_code = ${market})`)[0])
      throw invalid('Ese proveedor no es de este mercado.', 'That provider does not belong to this market.')
    const live = await tx<{ id: string; status: string }[]>`
      select id, status from crm.account_products where account_id = ${accountId} and product_id is not distinct from ${input.productId || null}::uuid and provider_id is not distinct from ${providerId}::uuid for update`
    let id = live[0]?.id
    if (id) {
      if (live[0]!.status === status && !note) return id
      await tx`update crm.account_products set status = ${status}, note = ${clean(note)}, updated_by = ${ctx.user.id}, updated_at = now(),
                status_at = case when status = ${status} then status_at else now() end,
                submitted_at = case when ${status} = 'submitted' then now() else submitted_at end,
                decided_at = case when ${status} in ('approved','rejected') then now() else decided_at end,
                activated_at = case when ${status} = 'active' then now() else activated_at end where id = ${id}`
    } else {
      id = await newId(tx)
      await tx`insert into crm.account_products (id, account_id, market_code, product_id, provider_id, status, note, updated_by, submitted_at, decided_at, activated_at)
               values (${id}, ${accountId}, ${market}, ${input.productId || null}, ${providerId}, ${status}, ${clean(note)}, ${ctx.user.id},
                       ${status === 'submitted' ? tx`now()` : tx`null`}, ${status === 'approved' || status === 'rejected' ? tx`now()` : tx`null`}, ${status === 'active' ? tx`now()` : tx`null`})`
    }
    await audit(tx, ctx, 'account.product_set', 'account', accountId, market, live[0] ? { status: live[0].status } : null, { product_id: input.productId || null, provider_id: providerId, status })
    return id
  })
}

/** Reloj por proveedor: cuántos días puede tardar en responder una solicitud antes de marcarse fuera de plazo. */
export async function setProviderSla(ctx: Ctx, providerId: string, days: number | null): Promise<void> {
  ctx.assert('config.manage')
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 120)) throw invalid('El plazo va de 1 a 120 días, o vacío para no medirlo.', 'The deadline goes from 1 to 120 days, or empty to not track it.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; sla_days: number | null; code: string }[]>`select market_code, sla_days, code from crm.ops_catalog where id = ${providerId} and kind = 'provider' for update`
    if (!rows[0]) throw notFound()
    if (rows[0].sla_days === days) return
    await tx`update crm.ops_catalog set sla_days = ${days} where id = ${providerId}`
    await audit(tx, ctx, 'provider.sla_set', 'ops_catalog', providerId, rows[0].market_code, { sla_days: rows[0].sla_days }, { code: rows[0].code, sla_days: days })
  })
}

/** A qué proveedor o carrier pertenece un producto del catálogo. */
export async function setProductProvider(ctx: Ctx, productId: string, providerId: string | null): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; provider_id: string | null }[]>`select market_code, provider_id from crm.products where id = ${productId} for update`
    const p = rows[0]
    if (!p) throw notFound()
    if (providerId && !(await tx`select 1 from crm.ops_catalog where id = ${providerId} and kind = 'provider' and (market_code is null or ${p.market_code}::text is null or market_code = ${p.market_code})`)[0])
      throw invalid('Ese proveedor no es del mercado del producto.', 'That provider does not belong to the product’s market.')
    if (p.provider_id === providerId) return
    await tx`update crm.products set provider_id = ${providerId} where id = ${productId}`
    await audit(tx, ctx, 'product.provider_set', 'product', productId, p.market_code, { provider_id: p.provider_id }, { provider_id: providerId })
  })
}
