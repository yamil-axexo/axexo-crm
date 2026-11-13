// AUT-03: el vocabulario de las automatizaciones. Una automatización es un dato: sobre qué registros mira (source),
// cuándo (por horario o al ocurrir un evento), qué condiciones pide y qué hace. Este archivo es puro (sin base ni
// servidor): lo leen el motor, los formularios de Administración y las pruebas, para que la lista exista una sola vez.

type Pair = { es: string; en: string }

export const SOURCES = ['deal', 'lead', 'account', 'account_pair'] as const
export type Source = (typeof SOURCES)[number]

export const SOURCE_LABEL: Record<Source, Pair> = {
  deal: { es: 'Negocios abiertos', en: 'Open deals' },
  lead: { es: 'Leads', en: 'Leads' },
  account: { es: 'Comercios', en: 'Merchants' },
  account_pair: { es: 'Comercios con el mismo teléfono', en: 'Merchants sharing a phone number' },
}

export type FieldType = 'number' | 'boolean' | 'choice'
export type FieldDef = {
  key: string; type: FieldType; label: Pair; options?: { value: string; label: Pair }[]
  /** Las opciones salen de los embudos del mercado (códigos de etapa, embudos o personas), no de una lista fija. */
  dynamic?: 'stage' | 'pipeline' | 'user'
  /** Campos que usan las automatizaciones reconstruidas desde Pipedrive; el formulario de Administración no los ofrece. */
  hidden?: boolean
}

const yes = (key: string, es: string, en: string): FieldDef => ({ key, type: 'boolean', label: { es, en } })
const num = (key: string, es: string, en: string): FieldDef => ({ key, type: 'number', label: { es, en } })
const pick = (key: string, es: string, en: string, options: [string, string, string][]): FieldDef => ({
  key, type: 'choice', label: { es, en }, options: options.map(([value, oes, oen]) => ({ value, label: { es: oes, en: oen } })),
})

/** Los campos del registro sobre los que una condición puede preguntar. Cada uno es una columna del conjunto que arma el motor. */
export const FIELDS: Record<Source, FieldDef[]> = {
  deal: [
    pick('stage_kind', 'Tipo de etapa', 'Stage type', [['open', 'abierta', 'open'], ['awaiting_txn', 'espera la primera venta', 'waiting for the first sale']]),
    { key: 'stage_code', type: 'choice', label: { es: 'Etapa actual', en: 'Current stage' }, dynamic: 'stage' },
    yes('is_ops_stage', 'Está en una etapa de Operaciones', 'It is in an Operations stage'),
    yes('paused', 'Está en pausa', 'It is paused'),
    num('stage_age_days', 'Días en la etapa actual', 'Days in the current stage'),
    yes('over_stage_limit', 'Pasó los días de estancamiento de su etapa', 'It passed the stall limit of its stage'),
    yes('over_stage_sla', 'Venció la meta de tiempo de su etapa', 'The time goal of its stage has passed'),
    num('next_step_days_late', 'Días de atraso del próximo paso (sin próximo paso cuenta como 9999)', 'Days the next step is late (no next step counts as 9999)'),
    yes('revisit_needed', 'Tiene una revisita pendiente', 'It has a revisit pending'),
    num('revisit_days_late', 'Días desde que tocaba la revisita', 'Days since the revisit was due'),
    yes('has_open_visit', 'Ya hay una visita por hacer en ese comercio', 'A visit is already planned for that merchant'),
    pick('waiting_on', 'A quién se espera', 'Who it is waiting on', [['us', 'a nosotros', 'us'], ['customer', 'al cliente', 'the customer'], ['third_party', 'a un tercero', 'a third party']]),
    num('amount', 'Monto esperado', 'Expected amount'),
    { key: 'pipeline_id', type: 'choice', label: { es: 'Embudo', en: 'Pipeline' }, dynamic: 'pipeline', hidden: true },
    { key: 'owner_id', type: 'choice', label: { es: 'Quien lleva el negocio', en: 'Deal owner' }, dynamic: 'user', hidden: true },
  ],
  lead: [
    pick('status', 'Estado del lead', 'Lead status', [['new', 'nuevo', 'new'], ['contacted', 'contactado', 'contacted'], ['qualified', 'calificado', 'qualified']]),
    yes('touched', 'Ya hubo un primer intento de contacto', 'There has been a first contact attempt'),
    yes('first_contact_overdue', 'Venció la meta de primer contacto', 'The first contact goal has passed'),
    num('overdue_business_hours', 'Horas hábiles desde que venció la meta', 'Business hours since the goal passed'),
    yes('has_owner', 'Tiene responsable', 'It has an owner'),
  ],
  account: [
    pick('lifecycle', 'Etapa del comercio', 'Merchant stage', [['prospect', 'prospecto', 'prospect'], ['onboarding', 'en alta', 'onboarding'], ['active', 'activo', 'active'], ['at_risk', 'en riesgo', 'at risk'], ['inactive', 'inactivo', 'inactive'], ['churned', 'perdido', 'churned']]),
    yes('is_customer', 'Ya es cliente (en alta, activo o en riesgo)', 'It is already a customer (onboarding, active or at risk)'),
    yes('has_owner', 'Tiene responsable', 'It has an owner'),
    yes('is_branch', 'Es sucursal de otro comercio', 'It is a branch of another merchant'),
  ],
  account_pair: [],
}

export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_true', 'is_false', 'is_empty', 'not_empty', 'in'] as const
export type Op = (typeof OPS)[number]
export const OP_LABEL: Record<Op, Pair> = {
  eq: { es: 'es', en: 'is' },
  ne: { es: 'no es', en: 'is not' },
  gt: { es: 'es mayor que', en: 'is greater than' },
  gte: { es: 'es al menos', en: 'is at least' },
  lt: { es: 'es menor que', en: 'is less than' },
  lte: { es: 'es a lo sumo', en: 'is at most' },
  is_true: { es: 'sí', en: 'yes' },
  is_false: { es: 'no', en: 'no' },
  is_empty: { es: 'está vacío', en: 'is empty' },
  not_empty: { es: 'tiene valor', en: 'has a value' },
  in: { es: 'es una de', en: 'is one of' },
}
export const OPS_FOR: Record<FieldType, Op[]> = {
  number: ['gt', 'gte', 'lt', 'lte', 'eq'],
  boolean: ['is_true', 'is_false'],
  choice: ['eq', 'ne', 'is_empty', 'not_empty'],
}

export type Condition = { field: string; op: Op; value?: string | number | null }

/** Eventos del dominio que pueden disparar una automatización (los mismos que salen por la cola de eventos). */
export const EVENTS: Record<string, { source: Source; label: Pair }> = {
  'deal.created': { source: 'deal', label: { es: 'Se crea un negocio', en: 'A deal is created' } },
  'deal.stage_changed': { source: 'deal', label: { es: 'Un negocio cambia de etapa', en: 'A deal changes stage' } },
  'lead.created': { source: 'lead', label: { es: 'Entra un lead', en: 'A lead comes in' } },
  'account.created': { source: 'account', label: { es: 'Se crea un comercio', en: 'A merchant is created' } },
  'deal.owner_changed': { source: 'deal', label: { es: 'Cambia quien lleva un negocio', en: 'A deal changes owner' } },
  'account.updated': { source: 'account', label: { es: 'Se editan los datos de un comercio', en: 'A merchant is edited' } },
  'account.custom_updated': { source: 'account', label: { es: 'Se edita un campo adicional de un comercio', en: 'An additional merchant field is edited' } },
}

/**
 * Campos adicionales (los que vinieron de Pipedrive o se definieron en Administración) como condición: `custom:<clave>`.
 * Solo se pregunta si está vacío, si tiene valor, o si es igual o distinto a un texto.
 */
export const CUSTOM_PREFIX = 'custom:'
const CUSTOM_RE = /^custom:[a-z][a-z0-9_]{1,40}$/
export const isCustomField = (field: string) => CUSTOM_RE.test(field)
const CUSTOM_OPS: Op[] = ['eq', 'ne', 'is_empty', 'not_empty']

export const ACTION_TYPES = ['open_exception', 'create_task', 'notify', 'assign', 'move_stage', 'set_field'] as const
/** Acciones que nacieron con lo reconstruido desde Pipedrive. El formulario no las ofrece todavía: se encienden, se apagan y se ven en la bitácora. */
export const REBUILT_ACTION_TYPES = ['set_custom', 'send_email', 'ops_handoff', 'assign_turn'] as const
export const ALL_ACTION_TYPES = [...ACTION_TYPES, ...REBUILT_ACTION_TYPES] as const
export type ActionType = (typeof ACTION_TYPES)[number]
export const ACTION_LABEL: Record<ActionType, Pair> = {
  open_exception: { es: 'Abrir un aviso en la cola de quien supervisa', en: 'Open a notice in the supervisor queue' },
  create_task: { es: 'Crear una tarea', en: 'Create a task' },
  notify: { es: 'Avisar a una persona o a un rol', en: 'Notify a person or a role' },
  assign: { es: 'Asignar el lead', en: 'Assign the lead' },
  move_stage: { es: 'Cambiar de etapa, si el paso lo permite', en: 'Change stage, if the step allows it' },
  set_field: { es: 'Marcar un campo', en: 'Set a field' },
}
export const REBUILT_ACTION_LABEL: Record<(typeof REBUILT_ACTION_TYPES)[number], Pair> = {
  set_custom: { es: 'Llenar un campo adicional', en: 'Fill in an additional field' },
  send_email: { es: 'Dejar listo un correo al contacto', en: 'Prepare an email to the contact' },
  ops_handoff: { es: 'Pasar el negocio a Operaciones', en: 'Hand the deal to Operations' },
  assign_turn: { es: 'Repartir por turno', en: 'Assign in turn' },
}

/** A quién le toca: quien lleva el registro, un rol del mercado, o una persona. */
export const TARGET_ROLES = ['supervisor', 'market_lead', 'ops', 'admin'] as const
export type Target = 'owner' | `role:${(typeof TARGET_ROLES)[number]}` | `user:${string}`
export const isTarget = (v: string): v is Target =>
  v === 'owner' || (TARGET_ROLES as readonly string[]).includes(v.replace(/^role:/, '')) && v.startsWith('role:') || /^user:[0-9a-f-]{36}$/.test(v)

/** Los tipos de aviso de la cola (los que la base admite). Una automatización abre uno de estos. */
export const NOTICE_KINDS = ['lead_sla', 'revisit_due', 'activation_risk', 'no_next_step', 'stalled_deal', 'reactivation', 'unowned_account', 'duplicate_suspect'] as const
export type NoticeKind = (typeof NOTICE_KINDS)[number]
/** Qué registros puede señalar cada tipo de aviso: decide el detalle que lleva. */
export const NOTICE_SOURCE: Record<NoticeKind, Source> = {
  lead_sla: 'lead', revisit_due: 'deal', activation_risk: 'deal', no_next_step: 'deal', stalled_deal: 'deal',
  reactivation: 'account', unowned_account: 'account', duplicate_suspect: 'account_pair',
}
export const SEVERITIES = ['low', 'medium', 'high'] as const

/** Campos que una automatización puede marcar. Lista corta a propósito: marcar un campo no es editar el registro entero. */
export const SETTABLE: Record<string, { source: Source; label: Pair; values: { value: string; label: Pair }[] }> = {
  waiting_on: {
    source: 'deal', label: { es: 'A quién se espera', en: 'Who it is waiting on' },
    values: [
      { value: 'us', label: { es: 'a nosotros', en: 'us' } },
      { value: 'customer', label: { es: 'al cliente', en: 'the customer' } },
      { value: 'third_party', label: { es: 'a un tercero', en: 'a third party' } },
      { value: '', label: { es: 'a nadie', en: 'nobody' } },
    ],
  },
}

export type Action =
  | { type: 'open_exception'; kind: NoticeKind; severity: (typeof SEVERITIES)[number] }
  | { type: 'create_task'; to: Target; text_es: string; text_en: string; due_days: number }
  | { type: 'notify'; to: Target; text_es: string; text_en: string }
  | { type: 'assign'; to: Target }
  | { type: 'move_stage'; stage_code: string }
  | { type: 'set_field'; field: string; value: string }
  /** Llena un campo adicional con quien lleva el registro, con un texto fijo o con la fecha de hoy. `keep`: si ya tiene valor, no lo cambia. */
  | { type: 'set_custom'; field: string; from: 'owner' | 'value' | 'today'; value?: string; keep: boolean }
  /** Deja listo un correo con una plantilla del servicio de avisos para el contacto del negocio. Con el canal apagado, no sale. */
  | { type: 'send_email'; template: string }
  /** El negocio queda con Operaciones: en su cola (`queue`) o con una persona de Operaciones (`user:<id>`). */
  | { type: 'ops_handoff'; to: 'queue' | `user:${string}` }
  /** Quien lleva el negocio pasa a ser la siguiente persona del turno indicado. */
  | { type: 'assign_turn'; rule_id: string }

export type Definition = {
  key: string
  name: Pair
  source: Source
  motor?: string | null
  trigger: { kind: 'schedule' } | { kind: 'event'; event: string }
  conditions: Condition[]
  actions: Action[]
}

const cond = (field: string, op: Op, value?: string | number): Condition => ({ field, op, ...(value === undefined ? {} : { value }) })
const notice = (kind: NoticeKind, severity: 'low' | 'medium' | 'high'): Action => ({ type: 'open_exception', kind, severity })

/**
 * Las reglas con las que nace cada mercado. Las nueve primeras son las que antes estaban escritas en el código
 * (`evaluateRules`): mismas condiciones, mismos avisos. `stalled_ops` cubre lo que quedaba fuera: las etapas de Operaciones.
 */
export const DEFAULTS: Definition[] = [
  { key: 'lead_sla', name: { es: 'Lead sin primer contacto a tiempo', en: 'Lead with no first contact on time' }, source: 'lead', trigger: { kind: 'schedule' },
    conditions: [cond('status', 'eq', 'new'), cond('touched', 'is_false'), cond('first_contact_overdue', 'is_true')], actions: [notice('lead_sla', 'high')] },
  { key: 'revisit_due', name: { es: 'Revisita pendiente', en: 'Revisit due' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('revisit_needed', 'is_true'), cond('revisit_days_late', 'gte', 0), cond('has_open_visit', 'is_false')], actions: [notice('revisit_due', 'high')] },
  { key: 'activation_risk', name: { es: 'Alta sin primera venta', en: 'Signed up, no first sale' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('stage_kind', 'eq', 'awaiting_txn'), cond('stage_age_days', 'gt', 7)], actions: [notice('activation_risk', 'high')] },
  { key: 'no_next_step', name: { es: 'Negocio sin próximo paso', en: 'Deal with no next step' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('stage_kind', 'eq', 'open'), cond('is_ops_stage', 'is_false'), cond('paused', 'is_false'), cond('next_step_days_late', 'gt', 2)], actions: [notice('no_next_step', 'medium')] },
  { key: 'stalled_deal', name: { es: 'Negocio estancado', en: 'Stalled deal' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('stage_kind', 'eq', 'open'), cond('is_ops_stage', 'is_false'), cond('paused', 'is_false'), cond('over_stage_limit', 'is_true')], actions: [notice('stalled_deal', 'medium')] },
  { key: 'stalled_ops', name: { es: 'Negocio estancado en Operaciones', en: 'Deal stalled in Operations' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('is_ops_stage', 'is_true'), cond('paused', 'is_false'), cond('over_stage_limit', 'is_true')], actions: [notice('stalled_deal', 'medium')] },
  { key: 'reactivation', name: { es: 'Comercio en riesgo', en: 'Merchant at risk' }, source: 'account', trigger: { kind: 'schedule' },
    conditions: [cond('lifecycle', 'eq', 'at_risk')], actions: [notice('reactivation', 'medium')] },
  { key: 'unowned_account', name: { es: 'Comercio sin responsable', en: 'Merchant with no owner' }, source: 'account', trigger: { kind: 'schedule' },
    conditions: [cond('has_owner', 'is_false'), cond('is_branch', 'is_false'), cond('is_customer', 'is_true')], actions: [notice('unowned_account', 'low')] },
  { key: 'duplicate_suspect', name: { es: 'Posible comercio repetido', en: 'Possible duplicate merchant' }, source: 'account_pair', trigger: { kind: 'schedule' },
    conditions: [], actions: [notice('duplicate_suspect', 'medium')] },
]

/** Plantillas para crear una automatización nueva desde Administración. Nacen en pausa: quien administra las revisa y las activa. */
export const TEMPLATES: Definition[] = [
  { key: 'stage_goal_passed', name: { es: 'Meta de etapa vencida: avisar a supervisión', en: 'Stage time goal passed: notify the supervisor' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('over_stage_sla', 'is_true'), cond('paused', 'is_false')],
    actions: [{ type: 'notify', to: 'role:supervisor', text_es: 'Venció la meta de tiempo de la etapa', text_en: 'The stage time goal has passed' }] },
  { key: 'stalled_task', name: { es: 'Negocio estancado: tarea para quien lo lleva', en: 'Stalled deal: task for its owner' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('over_stage_limit', 'is_true'), cond('paused', 'is_false')],
    actions: [{ type: 'create_task', to: 'owner', text_es: 'Mover o cerrar este negocio: lleva demasiados días en la misma etapa', text_en: 'Move or close this deal: it has been too long in the same stage', due_days: 1 }] },
  { key: 'waiting_third_party', name: { es: 'Espera de un tercero vencida: avisar a quien lidera', en: 'Third-party wait passed: notify the market lead' }, source: 'deal', trigger: { kind: 'schedule' },
    conditions: [cond('waiting_on', 'eq', 'third_party'), cond('over_stage_limit', 'is_true')],
    actions: [{ type: 'notify', to: 'role:market_lead', text_es: 'Un tercero no ha respondido en el plazo de la etapa', text_en: 'A third party has not answered within the stage limit' }] },
  { key: 'new_deal_review', name: { es: 'Negocio nuevo de monto alto: avisar a supervisión', en: 'New high-value deal: notify the supervisor' }, source: 'deal', trigger: { kind: 'event', event: 'deal.created' },
    conditions: [cond('amount', 'gte', 100000)],
    actions: [{ type: 'notify', to: 'role:supervisor', text_es: 'Entró un negocio de monto alto', text_en: 'A high-value deal came in' }] },
  { key: 'lead_overdue_reassign', name: { es: 'Lead sin primer contacto por 8 horas hábiles: pasa a supervisión', en: 'Lead with no first contact for 8 business hours: goes to the supervisor' }, source: 'lead', trigger: { kind: 'schedule' },
    conditions: [cond('status', 'eq', 'new'), cond('touched', 'is_false'), cond('overdue_business_hours', 'gte', 8)],
    actions: [{ type: 'assign', to: 'role:supervisor' }] },
  { key: 'stage_entered_task', name: { es: 'Al llegar a una etapa: tarea para quien lleva el negocio', en: 'On reaching a stage: task for the deal owner' }, source: 'deal', trigger: { kind: 'event', event: 'deal.stage_changed' },
    conditions: [cond('stage_kind', 'eq', 'awaiting_txn')],
    actions: [{ type: 'create_task', to: 'owner', text_es: 'Ayudar al comercio a hacer su primera venta', text_en: 'Help the merchant make its first sale', due_days: 2 }] },
  { key: 'lead_no_owner', name: { es: 'Lead sin responsable: tarea para supervisión', en: 'Lead with no owner: task for the supervisor' }, source: 'lead', trigger: { kind: 'schedule' },
    conditions: [cond('status', 'eq', 'new'), cond('has_owner', 'is_false')],
    actions: [{ type: 'create_task', to: 'role:supervisor', text_es: 'Asignar este lead: nadie lo lleva', text_en: 'Assign this lead: nobody owns it', due_days: 0 }] },
]

const fieldOf = (source: Source, key: string): FieldDef | undefined => FIELDS[source].find((f) => f.key === key)

/** Revisa que una definición use solo lo que el motor sabe hacer. Devuelve el primer problema, en los dos idiomas, o null. */
export function problemIn(def: { source: string; trigger: Definition['trigger']; conditions: Condition[]; actions: Action[] }, stageCodes?: string[]): Pair | null {
  if (!(SOURCES as readonly string[]).includes(def.source)) return { es: 'Elige sobre qué registros trabaja.', en: 'Choose which records it works on.' }
  const source = def.source as Source
  if (def.trigger.kind === 'event') {
    const ev = EVENTS[def.trigger.event]
    if (!ev || ev.source !== source) return { es: 'Ese evento no es de este tipo de registro.', en: 'That event does not belong to this kind of record.' }
  }
  for (const c of def.conditions) {
    if (isCustomField(c.field)) {
      if (source !== 'deal' && source !== 'account') return { es: 'Los campos adicionales aplican a negocios y comercios.', en: 'Additional fields apply to deals and merchants.' }
      if (!CUSTOM_OPS.includes(c.op)) return { es: 'Con un campo adicional solo se pregunta si está vacío o si es igual a un texto.', en: 'With an additional field you can only ask whether it is empty or equal to a text.' }
      if ((c.op === 'eq' || c.op === 'ne') && !(typeof c.value === 'string' && c.value.length >= 1 && c.value.length <= 60)) return { es: 'Escribe el texto con el que se compara.', en: 'Write the text to compare with.' }
      continue
    }
    const f = fieldOf(source, c.field)
    if (!f) return { es: 'Una condición usa un campo que no existe para este tipo de registro.', en: 'A condition uses a field that does not exist for this kind of record.' }
    if (f.dynamic === 'user') {
      if (c.op !== 'in' || typeof (c.value ?? '') !== 'string' || !String(c.value ?? '').split(',').filter(Boolean).every((x) => /^[0-9a-f-]{36}$/.test(x))) return { es: 'Elige las personas de la lista.', en: 'Pick the people on the list.' }
      continue
    }
    if (f.dynamic === 'pipeline') {
      if (c.op !== 'eq' || !/^[0-9a-f-]{36}$/.test(String(c.value ?? ''))) return { es: 'Elige un embudo de este mercado.', en: 'Pick a pipeline in this market.' }
      continue
    }
    if (!OPS_FOR[f.type].includes(c.op)) return { es: `La condición sobre "${f.label.es}" usa una comparación que no aplica.`, en: `The condition on "${f.label.en}" uses a comparison that does not apply.` }
    if (f.type === 'number' && !Number.isFinite(Number(c.value))) return { es: `La condición sobre "${f.label.es}" necesita un número.`, en: `The condition on "${f.label.en}" needs a number.` }
    if (f.dynamic === 'stage') {
      if ((c.op === 'eq' || c.op === 'ne') && (!/^[a-z0-9_]{2,40}$/.test(String(c.value ?? '')) || (stageCodes && !stageCodes.includes(String(c.value))))) return { es: 'Elige una etapa de un embudo de este mercado.', en: 'Pick a stage from a pipeline in this market.' }
      continue
    }
    if (f.type === 'choice' && (c.op === 'eq' || c.op === 'ne') && !f.options?.some((o) => o.value === c.value)) return { es: `Elige un valor de la lista para "${f.label.es}".`, en: `Pick a value from the list for "${f.label.en}".` }
  }
  if (def.actions.length < 1 || def.actions.length > 3) return { es: 'Una automatización hace entre una y tres cosas.', en: 'An automation does between one and three things.' }
  for (const a of def.actions) {
    if (a.type === 'open_exception') {
      if (def.trigger.kind !== 'schedule') return { es: 'Los avisos de la cola se abren y se cierran solos por horario, no con un evento.', en: 'Queue notices open and close on a schedule, not on an event.' }
      if (!(NOTICE_KINDS as readonly string[]).includes(a.kind) || NOTICE_SOURCE[a.kind] !== source) return { es: 'Ese tipo de aviso no es para este tipo de registro.', en: 'That kind of notice is not for this kind of record.' }
      if (!(SEVERITIES as readonly string[]).includes(a.severity)) return { es: 'Elige la urgencia del aviso.', en: 'Pick how urgent the notice is.' }
    } else if (a.type === 'create_task' || a.type === 'notify') {
      if (source === 'account_pair') return { es: 'Para comercios repetidos solo se abre el aviso.', en: 'For duplicate merchants only the notice is available.' }
      if (!isTarget(a.to)) return { es: 'Elige para quién es.', en: 'Choose who it is for.' }
      if (a.text_es.trim().length < 3 || a.text_es.length > 160 || a.text_en.trim().length < 3 || a.text_en.length > 160) return { es: 'Escribe el texto en español y en inglés (3 a 160 letras).', en: 'Write the text in Spanish and in English (3 to 160 characters).' }
      if (a.type === 'create_task' && !(Number.isInteger(a.due_days) && a.due_days >= 0 && a.due_days <= 30)) return { es: 'La tarea vence entre hoy (0) y 30 días.', en: 'The task is due between today (0) and 30 days.' }
    } else if (a.type === 'assign') {
      if (source !== 'lead') return { es: 'Asignar aplica a leads.', en: 'Assigning applies to leads.' }
      if (!isTarget(a.to) || a.to === 'owner') return { es: 'Elige a qué persona o rol se asigna.', en: 'Choose the person or role it is assigned to.' }
    } else if (a.type === 'move_stage') {
      if (source !== 'deal') return { es: 'Solo un negocio cambia de etapa.', en: 'Only a deal changes stage.' }
      if (!/^[a-z0-9_]{2,40}$/.test(a.stage_code) || (stageCodes && !stageCodes.includes(a.stage_code))) return { es: 'Elige una etapa de un embudo de este mercado.', en: 'Pick a stage from a pipeline in this market.' }
    } else if (a.type === 'set_field') {
      const s = SETTABLE[a.field]
      if (!s || s.source !== source || !s.values.some((v) => v.value === a.value)) return { es: 'Ese campo no se puede marcar desde una automatización.', en: 'That field cannot be set from an automation.' }
    } else if (a.type === 'set_custom') {
      if (source !== 'deal' && source !== 'account') return { es: 'Los campos adicionales aplican a negocios y comercios.', en: 'Additional fields apply to deals and merchants.' }
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(a.field) || !['owner', 'value', 'today'].includes(a.from)) return { es: 'Elige el campo y con qué se llena.', en: 'Choose the field and what fills it.' }
      if (a.from === 'value' && !(typeof a.value === 'string' && a.value.trim().length >= 1 && a.value.length <= 120)) return { es: 'Escribe el valor con que se llena (1 a 120 letras).', en: 'Write the value it is filled with (1 to 120 characters).' }
    } else if (a.type === 'send_email') {
      if (source !== 'deal' || !/^[a-z0-9_]{3,40}$/.test(a.template)) return { es: 'El correo sale de una plantilla y va al contacto de un negocio.', en: 'The email comes from a template and goes to a deal contact.' }
    } else if (a.type === 'ops_handoff') {
      if (source !== 'deal' || !(a.to === 'queue' || /^user:[0-9a-f-]{36}$/.test(a.to))) return { es: 'Elige si va a la cola de Operaciones o a una persona.', en: 'Choose whether it goes to the Operations queue or to a person.' }
    } else if (a.type === 'assign_turn') {
      if (source !== 'deal' || !/^[0-9a-f-]{36}$/.test(a.rule_id)) return { es: 'Elige el turno.', en: 'Choose the turn.' }
    } else return { es: 'Una acción no es de las que existen.', en: 'An action is not one of the available ones.' }
  }
  return null
}

const targetText = (to: string, people: Record<string, string>): Pair => {
  if (to === 'owner') return { es: 'quien lleva el registro', en: 'the record owner' }
  if (to.startsWith('role:')) {
    const r = to.slice(5)
    const names: Record<string, Pair> = { supervisor: { es: 'supervisión', en: 'the supervisor' }, market_lead: { es: 'quien lidera el mercado', en: 'the market lead' }, ops: { es: 'Operaciones', en: 'Operations' }, admin: { es: 'administración', en: 'administration' } }
    return names[r] ?? { es: r, en: r }
  }
  const name = people[to.slice(5)]
  return name ? { es: name, en: name } : { es: 'una persona', en: 'a person' }
}

/** "Cuando… si… entonces…": la definición dicha como la diría una persona del equipo. */
export function describe(def: { source: Source; trigger: Definition['trigger']; conditions: Condition[]; actions: Action[] }, people: Record<string, string> = {}, stageNames: Record<string, Pair> = {}, pipelineNames: Record<string, Pair> = {}): { when: Pair; ifs: Pair[]; then: Pair[] } {
  const when: Pair = def.trigger.kind === 'event'
    ? { es: `Cuando ${(EVENTS[def.trigger.event]?.label.es ?? def.trigger.event).toLowerCase()}`, en: `When ${(EVENTS[def.trigger.event]?.label.en ?? def.trigger.event).toLowerCase()}` }
    : { es: `Cada vez que corre la revisión por horario, sobre ${SOURCE_LABEL[def.source].es.toLowerCase()}`, en: `Each time the scheduled check runs, over ${SOURCE_LABEL[def.source].en.toLowerCase()}` }
  const ifs = def.conditions.map((c): Pair => {
    if (isCustomField(c.field)) {
      const k = c.field.slice(CUSTOM_PREFIX.length)
      if (c.op === 'is_empty' || c.op === 'not_empty') return { es: `El campo "${k}" ${OP_LABEL[c.op].es}`, en: `The "${k}" field ${OP_LABEL[c.op].en}` }
      return { es: `El campo "${k}" ${OP_LABEL[c.op].es} "${c.value}"`, en: `The "${k}" field ${OP_LABEL[c.op].en} "${c.value}"` }
    }
    if (c.field === 'pipeline_id') return { es: `Embudo: ${pipelineNames[String(c.value)]?.es ?? 'el elegido'}`, en: `Pipeline: ${pipelineNames[String(c.value)]?.en ?? 'the chosen one'}` }
    if (c.field === 'owner_id') {
      const ids = String(c.value ?? '').split(',').filter(Boolean)
      return ids.length ? { es: `Lo lleva una de estas personas: ${ids.map((x) => people[x] ?? 'una persona').join(', ')}`, en: `Owned by one of these people: ${ids.map((x) => people[x] ?? 'a person').join(', ')}` }
        : { es: 'Lo lleva una de las personas de la lista (la lista está vacía: no aplica a nadie todavía)', en: 'Owned by one of the people on the list (the list is empty: it applies to nobody yet)' }
    }
    const f = fieldOf(def.source, c.field)
    const label = f?.label ?? { es: c.field, en: c.field }
    if (c.op === 'is_true') return { es: label.es, en: label.en }
    if (c.op === 'is_false') return { es: `No: ${label.es.toLowerCase()}`, en: `Not: ${label.en.toLowerCase()}` }
    if (c.op === 'is_empty' || c.op === 'not_empty') return { es: `${label.es} ${OP_LABEL[c.op].es}`, en: `${label.en} ${OP_LABEL[c.op].en}` }
    const opt = f?.dynamic === 'stage' ? stageNames[String(c.value)] : f?.options?.find((o) => o.value === c.value)?.label
    return { es: `${label.es} ${OP_LABEL[c.op].es} ${opt?.es ?? c.value}`, en: `${label.en} ${OP_LABEL[c.op].en} ${opt?.en ?? c.value}` }
  })
  const then = def.actions.map((a): Pair => {
    if (a.type === 'open_exception') return { es: 'Abre un aviso en la cola de quien supervisa, y lo cierra solo cuando deja de cumplirse', en: 'Opens a notice in the supervisor queue, and closes it on its own once it no longer applies' }
    if (a.type === 'create_task') return { es: `Crea una tarea para ${targetText(a.to, people).es}: "${a.text_es}", con fecha ${a.due_days === 0 ? 'de hoy' : `a ${a.due_days} ${a.due_days === 1 ? 'día' : 'días'}`}`, en: `Creates a task for ${targetText(a.to, people).en}: "${a.text_en}", due ${a.due_days === 0 ? 'today' : `in ${a.due_days} ${a.due_days === 1 ? 'day' : 'days'}`}` }
    if (a.type === 'notify') return { es: `Avisa a ${targetText(a.to, people).es}: "${a.text_es}"`, en: `Notifies ${targetText(a.to, people).en}: "${a.text_en}"` }
    if (a.type === 'assign') return { es: `Asigna el registro a ${targetText(a.to, people).es}`, en: `Assigns the record to ${targetText(a.to, people).en}` }
    if (a.type === 'set_custom') {
      const what: Pair = a.from === 'owner' ? { es: 'quien lleva el registro', en: 'the record owner' } : a.from === 'today' ? { es: 'la fecha de hoy', en: "today's date" } : { es: `"${a.value}"`, en: `"${a.value}"` }
      return { es: `Llena el campo "${a.field}" con ${what.es}${a.keep ? ', solo si está vacío' : ''}`, en: `Fills the "${a.field}" field with ${what.en}${a.keep ? ', only if it is empty' : ''}` }
    }
    if (a.type === 'send_email') return { es: `Deja listo un correo al contacto del negocio con la plantilla "${a.template}" (sale solo cuando el canal de correo esté encendido)`, en: `Prepares an email to the deal contact with the "${a.template}" template (it goes out only once the email channel is on)` }
    if (a.type === 'ops_handoff') return a.to === 'queue'
      ? { es: 'Deja el negocio en la cola de Operaciones, con quien lidera Operaciones del embudo; quien lo vendió se conserva', en: 'Leaves the deal in the Operations queue, with the pipeline Operations lead; the seller is kept' }
      : { es: `Pasa el negocio a ${people[a.to.slice(5)] ?? 'una persona'} en Operaciones`, en: `Hands the deal to ${people[a.to.slice(5)] ?? 'a person'} in Operations` }
    if (a.type === 'assign_turn') return { es: 'Pasa el negocio a la siguiente persona del turno', en: 'Gives the deal to the next person in the turn' }
    if (a.type === 'move_stage') return { es: `Cambia el negocio a la etapa "${stageNames[a.stage_code]?.es ?? a.stage_code}", si el paso lo permite`, en: `Moves the deal to the "${stageNames[a.stage_code]?.en ?? a.stage_code}" stage, if the step allows it` }
    const s = SETTABLE[a.field]
    const v = s?.values.find((x) => x.value === a.value)?.label
    return { es: `Marca "${s?.label.es ?? a.field}": ${v?.es ?? a.value}`, en: `Sets "${s?.label.en ?? a.field}": ${v?.en ?? a.value}` }
  })
  return { when, ifs, then }
}
