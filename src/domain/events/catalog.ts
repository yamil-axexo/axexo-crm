import { AUDIT_ACTION } from '@/lib/audit'

// AUT-02: catálogo versionado de eventos de dominio. Es la única fuente: de aquí salen la pantalla de Administración,
// docs/contracts/domain-events-v1.md y lo que valida el publicador. Un cambio que rompe a quien consume sube la versión.
type Pair = [es: string, en: string]
export type FieldType = 'string' | 'uuid' | 'integer' | 'boolean' | 'string[]'
export type FieldSpec = { type: FieldType; required?: boolean; about: Pair }
export type EventDef = {
  type: string
  version: number
  /** Sobre qué registro habla el evento. */
  aggregate: string
  about: Pair
  data: Record<string, FieldSpec>
  example: Record<string, unknown>
  /** `explicit`: el comando lo emite con sus datos. `audit`: sale solo, junto con el evento de bitácora del mismo nombre. */
  source: 'explicit' | 'audit'
}

const f = (type: FieldType, es: string, en: string, required = true): FieldSpec => ({ type, required, about: [es, en] })
const ID = '0193a1f0-7c1e-7b2a-9d3e-5a1b2c3d4e5f'
const ID2 = '0193a1f0-8d2f-7c3b-8e4f-6b2c3d4e5f60'

export const EXPLICIT_EVENTS: EventDef[] = [
  { type: 'account.created', version: 1, aggregate: 'account', source: 'explicit', about: ['Se creó un comercio.', 'A merchant was created.'],
    data: { kind: f('string', 'Nivel: store, chain, distributor u organization.', 'Level: store, chain, distributor or organization.') }, example: { kind: 'store' } },
  { type: 'account.merged', version: 1, aggregate: 'account', source: 'explicit', about: ['Un comercio duplicado se fusionó en este.', 'A duplicate merchant was merged into this one.'],
    data: { source_id: f('uuid', 'El comercio que se fusionó y quedó archivado.', 'The merchant that was merged and archived.') }, example: { source_id: ID2 } },
  { type: 'account.alias_issued', version: 1, aggregate: 'account', source: 'explicit', about: ['CONTIGO ligó su ID del comercio con el ID de otro sistema.', 'CONTIGO linked its merchant ID to another system’s ID.'],
    data: { system: f('string', 'Sistema al que pertenece el otro ID.', 'System that owns the other ID.'), external_id: f('string', 'ID en ese sistema.', 'ID in that system.'), account_id: f('uuid', 'ID del comercio en CONTIGO.', 'Merchant ID in CONTIGO.') },
    example: { system: 'sales_core', external_id: 'SC-MX-000123', account_id: ID } },
  { type: 'account.reassigned', version: 1, aggregate: 'user', source: 'explicit', about: ['Se pasaron comercios a otra persona. El registro es quien los recibe.', 'Merchants were moved to another person. The record is whoever receives them.'],
    data: { count: f('integer', 'Cuántos comercios.', 'How many merchants.') }, example: { count: 12 } },
  { type: 'lead.created', version: 1, aggregate: 'lead', source: 'explicit', about: ['Entró un lead.', 'A lead came in.'],
    data: { source: f('string', 'De dónde llegó.', 'Where it came from.'), motor: f('string', 'Tipo de venta.', 'Sale type.') }, example: { source: 'web_form', motor: 'd2d' } },
  { type: 'lead.assigned', version: 1, aggregate: 'lead', source: 'explicit', about: ['Un lead quedó a nombre de alguien.', 'A lead was assigned to someone.'],
    data: { owner_id: f('uuid', 'Quién lo lleva ahora.', 'Who owns it now.'), previous_owner_id: f('uuid', 'Quién lo llevaba.', 'Who owned it before.', false), by: f('string', 'Cómo: routing, creation, taken, assignment, passed o reassignment.', 'How: routing, creation, taken, assignment, passed or reassignment.'), motor: f('string', 'Tipo de venta.', 'Sale type.', false), sla_due: f('boolean', 'Si corre el reloj de primer contacto.', 'Whether the first-contact clock is running.', false) },
    example: { owner_id: ID2, by: 'routing', motor: 'd2d', sla_due: true } },
  { type: 'lead.reassigned', version: 1, aggregate: 'user', source: 'explicit', about: ['Se pasaron leads abiertos a otra persona.', 'Open leads were moved to another person.'],
    data: { count: f('integer', 'Cuántos leads.', 'How many leads.') }, example: { count: 4 } },
  { type: 'lead.converted', version: 1, aggregate: 'lead', source: 'explicit', about: ['Un lead se convirtió en comercio con su negocio.', 'A lead became a merchant with its deal.'],
    data: { account_id: f('uuid', 'El comercio.', 'The merchant.'), deal_id: f('uuid', 'El negocio.', 'The deal.') }, example: { account_id: ID, deal_id: ID2 } },
  { type: 'deal.created', version: 1, aggregate: 'deal', source: 'explicit', about: ['Se abrió un negocio.', 'A deal was opened.'],
    data: { account_id: f('uuid', 'El comercio.', 'The merchant.') }, example: { account_id: ID } },
  { type: 'deal.stage_changed', version: 1, aggregate: 'deal', source: 'explicit', about: ['Un negocio cambió de etapa.', 'A deal moved to another stage.'],
    data: { from: f('uuid', 'Etapa anterior.', 'Previous stage.'), to: f('uuid', 'Etapa nueva.', 'New stage.'), kind: f('string', 'Tipo de la etapa nueva: open, awaiting_txn, won o lost.', 'Kind of the new stage: open, awaiting_txn, won or lost.') },
    example: { from: ID, to: ID2, kind: 'open' } },
  { type: 'deal.reassigned', version: 1, aggregate: 'user', source: 'explicit', about: ['Se pasaron negocios abiertos a otra persona.', 'Open deals were moved to another person.'],
    data: { count: f('integer', 'Cuántos negocios.', 'How many deals.') }, example: { count: 7 } },
  { type: 'deal.won', version: 1, aggregate: 'deal', source: 'explicit', about: ['Un negocio se ganó con la primera transacción del comercio.', 'A deal was won by the merchant’s first transaction.'],
    data: { account_id: f('uuid', 'El comercio.', 'The merchant.'), closed_by: f('string', 'Cómo se cerró: transaction.', 'How it closed: transaction.') }, example: { account_id: ID, closed_by: 'transaction' } },
]

/** Lo que llevan los eventos que salen junto con la bitácora: qué registro, qué campos cambiaron y quién. Nunca valores ni datos personales. */
export const AUDIT_EVENT_DATA: Record<string, FieldSpec> = {
  changed: f('string[]', 'Nombres de los campos que cambiaron (sin valores).', 'Names of the fields that changed (no values).'),
  actor_id: f('uuid', 'Quién hizo el cambio.', 'Who made the change.'),
}

export type Decision =
  | { emit: 'explicit'; as: string }
  | { emit: 'auto' }
  | { emit: false; why: Pair; unclassified?: boolean }

/** Acciones de bitácora cuyo comando ya emite un evento con sus propios datos (no se emite dos veces). */
const EXPLICIT_FOR: Record<string, string> = {
  'account.created': 'account.created', 'account.merged': 'account.merged', 'account.reassigned': 'account.reassigned',
  'lead.created': 'lead.created', 'lead.assigned': 'lead.assigned', 'lead.taken': 'lead.assigned', 'lead.passed': 'lead.assigned',
  'lead.reassigned': 'lead.reassigned', 'lead.converted': 'lead.converted', 'deal.created': 'deal.created',
  'deal.stage_changed': 'deal.stage_changed', 'deal.reassigned': 'deal.reassigned', 'deal.won_by_transaction': 'deal.won',
  'integration.store_received': 'account.alias_issued',
}

const WHY = {
  session: ['Inicios y cierres de sesión no cambian datos del negocio.', 'Sign-ins and sign-outs do not change business data.'] as Pair,
  inbound: ['Es la llegada de un dato de otro sistema: quien lo mandó ya lo sabe. El cambio que provoca (por ejemplo, un negocio ganado) sí emite su propio evento.', 'It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event.'] as Pair,
  migration: ['Es una carga histórica o por archivo: cada registro creado emite su propio evento; la corrida en sí no.', 'It is a historical or file load: each record created emits its own event; the run itself does not.'] as Pair,
  read: ['Es una lectura que sale de CONTIGO o un reporte interno del equipo: queda en la bitácora, no cambia registros.', 'It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records.'] as Pair,
  plumbing: ['Es operación de las propias integraciones (llaves, suscriptores, reenvíos): publicarla sería un evento sobre los eventos.', 'It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events.'] as Pair,
  notice: ['Es un aviso entre personas dentro de CONTIGO, no un cambio del registro.', 'It is a notice between people inside CONTIGO, not a change to the record.'] as Pair,
  rules: ['Correr las reglas a mano abre o cierra avisos internos; no cambia comercios, leads ni negocios.', 'Running the rules opens or closes internal notices; it changes no merchants, leads or deals.'] as Pair,
  quality: ['Es trabajo interno de calidad de datos (colas, mediciones, revisiones de repetidos): cuando termina en un cambio del registro, como una fusión o una edición, ese cambio emite su propio evento.', 'It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event.'] as Pair,
  internal: ['Es configuración interna de CONTIGO (métricas, plantillas de avisos, ayuda, arranque de un mercado): no cambia comercios, leads ni negocios.', 'It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals.'] as Pair,
  jobs: ['Es la corrida a mano de una tarea programada: lo que la tarea cambie emite su propio evento; la corrida en sí no.', 'It is a manual run of a scheduled job: whatever the job changes emits its own event; the run itself does not.'] as Pair,
  security: ['Es un control de seguridad o de privacidad (datos reservados, consentimiento, solicitudes de titulares, revisiones de accesos, ver como, llaves): queda en la bitácora. Publicarlo sacaría de CONTIGO datos de control o de personas.', 'It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO.'] as Pair,
  unknown: ['Acción nueva sin clasificar: no emite hasta que alguien decida aquí si es un cambio de dominio.', 'New action not classified yet: it emits nothing until someone decides here whether it is a domain change.'] as Pair,
}

/** Prefijos que NO emiten, con su porqué. Lo demás de la lista de abajo emite. */
const SILENT: [prefix: string, why: Pair][] = [
  ['session.', WHY.session], ['integration.', WHY.inbound], ['import.', WHY.migration], ['csv_import.', WHY.migration],
  ['report.', WHY.read], ['export.', WHY.read], ['api_client.', WHY.plumbing], ['event_subscriber.', WHY.plumbing], ['event_delivery.', WHY.plumbing],
  ['inbound.', WHY.plumbing], ['rules.', WHY.rules], ['activity.notice_', WHY.notice],
  // Ola 1 de los 95. Avisos, anuncios y lo que una automatización le avisa o le deja de tarea a una persona:
  ['notice.', WHY.notice], ['announcement.', WHY.notice], ['automation.task_created', WHY.notice], ['automation.notified', WHY.notice],
  // reportes guardados, vistas guardadas, fotos diarias y conciliación son lecturas o reportes internos:
  ['saved_report.', WHY.read], ['saved_view.', WHY.read], ['snapshot.', WHY.read], ['reconciliation.', WHY.read],
  // cargas desde hojas (visitas pegadas, tiendas migradas): cada registro creado emite el suyo:
  ['sheet.', WHY.migration],
  ['duplicate.', WHY.quality], ['quality.', WHY.quality], ['job.', WHY.jobs],
  // Seguridad (0027):
  ['seat.', WHY.security], ['sensitive.', WHY.security], ['sensitive_field.', WHY.security], ['consent.', WHY.security], ['retention.', WHY.security],
  ['subject_request.', WHY.security], ['view_as.', WHY.security], ['access_review.', WHY.security], ['secret.', WHY.security], ['security.', WHY.security],
  ['template.', WHY.internal], ['comms.', WHY.internal], ['help.', WHY.internal], ['metric.', WHY.internal], ['rollout.', WHY.internal],
  // Paquete mercados: qué datos van arriba en la ficha por rol y cómo se agrupan los campos es acomodo de pantalla.
  ['ficha.', WHY.internal], ['field_section.', WHY.internal],
  // Paquete partners-contratos: tokens de lectura (operación de integraciones), niveles y material (configuración interna),
  // la carga de una red (cada comercio promovido emite account.created) y la invitación en cola de un externo.
  ['partner_token.', WHY.plumbing], ['partner_tier.', WHY.internal], ['network_load.', WHY.migration], ['partner.invite_queued', WHY.notice],
  ['partner.crossmatch_run', WHY.quality],
]
// Paquete gobierno: objetivos de servicio, incidentes, pruebas de restauración, responsables, versiones, despliegues, costos,
// solicitudes de cambio, motivos, champions y material. Son registros de cómo se opera CONTIGO, no cambios de comercios, leads o negocios.
const WHY_GOVERNANCE: Pair = ['Es un registro de cómo se opera CONTIGO (servicio, versiones, costos, solicitudes): queda en la bitácora y no cambia comercios, leads ni negocios.', 'It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals.']
for (const prefix of ['objective.', 'incident.', 'restore_test.', 'component.', 'maintenance.', 'release.', 'deployment.', 'cost.', 'config_request.', 'change.', 'champion.', 'material.']) SILENT.push([prefix, WHY_GOVERNANCE])
/** Prefijos de registros y configuración del negocio: todo cambio emite. */
const DOMAIN = ['account.', 'contact.', 'deal.', 'lead.', 'activity.', 'exception.', 'territory.', 'membership.', 'team.', 'user.', 'pipeline.', 'stage.',
  'routing.', 'field.', 'account_type.', 'loss_reason.', 'form.', 'street_seller.', 'fx.',
  // Ola 1 de los 95: identificadores de otros sistemas, mercados, procesos por comercio, proveedores y productos, pedidos,
  // capacitación del dealer, etiquetas de agencias y la configuración de las automatizaciones.
  'alias.', 'alias_system.', 'market.', 'process.', 'provider.', 'product.', 'order.', 'training.', 'agency.', 'automation.',
  // Paquete mercados: entidad legal, identificador fiscal (el evento lleva qué campos cambiaron, nunca el identificador) y
  // la configuración de WhatsApp de un mercado.
  'entity.', 'taxid.', 'whatsapp.',
  // Paquete partners-contratos: términos (el evento lleva qué campos cambiaron, nunca los porcentajes), contratos, planes de
  // integración y el registro de una cuenta como partner.
  'terms.', 'contract.', 'plan.', 'partner.']

/** La lista explícita: para cada acción de la bitácora, si emite un evento de dominio, cuál y, si no, por qué. */
export function decide(action: string): Decision {
  const explicit = EXPLICIT_FOR[action]
  if (explicit) return { emit: 'explicit', as: explicit }
  for (const [prefix, why] of SILENT) if (action.startsWith(prefix)) return { emit: false, why }
  if (DOMAIN.some((p) => action.startsWith(p))) return { emit: 'auto' }
  return { emit: false, why: WHY.unknown, unclassified: true }
}

/** Eventos que salen junto con la bitácora, con el nombre legible de la acción. */
export function auditEvents(): EventDef[] {
  return Object.keys(AUDIT_ACTION).filter((a) => decide(a).emit === 'auto').sort().map((a) => ({
    type: a, version: 1, aggregate: a.split('.')[0]!, source: 'audit' as const,
    about: [`${AUDIT_ACTION[a]![0]}.`, `${AUDIT_ACTION[a]![1]}.`] as Pair,
    data: AUDIT_EVENT_DATA, example: { changed: ['name'], actor_id: ID2 },
  }))
}

export function eventCatalog(): EventDef[] {
  return [...EXPLICIT_EVENTS, ...auditEvents()].sort((a, b) => a.type.localeCompare(b.type))
}
export const eventTypes = (): string[] => eventCatalog().map((e) => e.type)

/** Acciones de la bitácora que no emiten, con su porqué: la otra mitad de la lista. */
export function silentActions(): { action: string; label: Pair; why: Pair; unclassified: boolean }[] {
  return Object.keys(AUDIT_ACTION).sort().flatMap((a) => {
    const d = decide(a)
    return d.emit === false ? [{ action: a, label: AUDIT_ACTION[a]!, why: d.why, unclassified: Boolean(d.unclassified) }] : []
  })
}

const JSON_TYPE: Record<FieldType, Record<string, unknown>> = {
  string: { type: 'string' }, uuid: { type: 'string', format: 'uuid' }, integer: { type: 'integer' }, boolean: { type: 'boolean' },
  'string[]': { type: 'array', items: { type: 'string' } },
}

/** Esquema JSON (2020-12) del mensaje completo de un evento, con su sobre. */
export function eventSchema(e: EventDef): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `contigo/events/${e.type}/v${e.version}`,
    type: 'object',
    required: ['id', 'type', 'version', 'occurred_at', 'aggregate', 'data'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: { const: e.type },
      version: { const: e.version },
      occurred_at: { type: 'string', format: 'date-time' },
      market: { type: ['string', 'null'] },
      aggregate: { type: 'object', required: ['type', 'id'], properties: { type: { const: e.aggregate }, id: { type: 'string', format: 'uuid' } } },
      data: {
        type: 'object',
        required: Object.entries(e.data).filter(([, s]) => s.required !== false).map(([k]) => k),
        properties: Object.fromEntries(Object.entries(e.data).map(([k, s]) => [k, { ...JSON_TYPE[s.type], description: s.about[1] }])),
      },
    },
  }
}

export type Envelope = { id: string; type: string; version: number; occurred_at: string; market: string | null; aggregate: { type: string; id: string }; data: Record<string, unknown> }

export function eventExample(e: EventDef): Envelope {
  return { id: ID, type: e.type, version: e.version, occurred_at: '2026-11-12T15:04:05.000Z', market: 'MX', aggregate: { type: e.aggregate, id: ID }, data: e.example }
}

/** Registro sin un id único (por ejemplo, una tasa de cambio): el evento lleva este id para decir "no aplica". */
export const NO_AGGREGATE = '00000000-0000-0000-0000-000000000000'
