import { zoneName, type Locale, type T } from '@/lib/format'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { ACTIVITY, EXCEPTION, LEAD_STATUS, MOTOR, SOURCE } from '@/lib/labels'

type Pair = [es: string, en: string]

/**
 * Bitácora legible: cada acción que la aplicación registra tiene su nombre en español y en inglés.
 * Una prueba recorre el código y falla si aparece una acción nueva sin nombre aquí (tests/unit/audit-labels.test.ts).
 */
export const AUDIT_ACTION: Record<string, Pair> = {
  'account.created': ['Creó un comercio', 'Created a merchant'],
  'account.updated': ['Cambió los datos de un comercio', 'Edited a merchant'],
  'account.custom_updated': ['Cambió campos adicionales de un comercio', 'Edited a merchant’s additional fields'],
  'account.parent_changed': ['Cambió la cadena de un comercio', 'Changed a merchant’s parent'],
  'account.reassigned': ['Reasignó comercios', 'Reassigned merchants'],
  'account.territory_set': ['Cambió el territorio de comercios', 'Changed the territory of merchants'],
  'account.merged': ['Fusionó un comercio duplicado', 'Merged a duplicate merchant'],
  'contact.added': ['Agregó un contacto', 'Added a contact'],
  'activity.added': ['Registró una actividad', 'Logged an activity'],
  'activity.completed': ['Completó una actividad', 'Completed an activity'],
  'deal.created': ['Creó un negocio', 'Created a deal'],
  'deal.updated': ['Cambió un negocio', 'Edited a deal'],
  'deal.custom_updated': ['Cambió campos adicionales de un negocio', 'Edited a deal’s additional fields'],
  'deal.reassigned': ['Reasignó negocios abiertos', 'Reassigned open deals'],
  'deal.stage_changed': ['Movió un negocio de etapa', 'Moved a deal to another stage'],
  'deal.won_by_transaction': ['Negocio ganado por primera transacción', 'Deal won by first transaction'],
  'deal.item_added': ['Agregó una línea al pedido', 'Added a line to the order'],
  'deal.item_removed': ['Quitó una línea del pedido', 'Removed a line from the order'],
  'deal.handed_to_ops': ['Entregó un negocio a Operaciones', 'Handed a deal over to Operations'],
  'deal.returned_to_sales': ['Devolvió un negocio a Ventas', 'Sent a deal back to Sales'],
  'deal.ops_taken': ['Tomó un negocio en Operaciones', 'Took a deal in Operations'],
  'deal.ops_check': ['Cambió el estado de un proveedor o documento', 'Changed a provider or document status'],
  'deal.training': ['Cambió la capacitación de un negocio', 'Changed a deal’s training'],
  'account.merchant_ref': ['Cambió el Merchant ID de un comercio', 'Changed a merchant’s Merchant ID'],
  'account.taken': ['Tomó una tienda sin asignar', 'Took a store with no owner'],
  'street_seller.added': ['Dio de alta a un vendedor de calle', 'Added a street seller'],
  'street_seller.updated': ['Cambió a quién responde un vendedor de calle', 'Changed who a street seller reports to'],
  'street_seller.ended': ['Dio de baja a un vendedor de calle', 'Removed a street seller'],
  'activity.notice_sent': ['Avisó a alguien desde una nota', 'Notified someone from a note'],
  'activity.notice_seen': ['Marcó un aviso como visto', 'Marked a notice as seen'],
  'pipeline.ops_configured': ['Cambió las propiedades de pedidos y Operaciones de un embudo', 'Changed a pipeline’s order and Operations settings'],
  'pipeline.catalog_created': ['Agregó un elemento a un catálogo de Operaciones', 'Added an item to an Operations catalog'],
  'pipeline.catalog_updated': ['Cambió un elemento de un catálogo de Operaciones', 'Edited an item in an Operations catalog'],
  'pipeline.product_created': ['Agregó un producto al catálogo', 'Added a product to the catalog'],
  'pipeline.product_updated': ['Cambió un producto del catálogo', 'Edited a catalog product'],
  'lead.created': ['Creó un lead', 'Created a lead'],
  'lead.assigned': ['Asignó un lead', 'Assigned a lead'],
  'lead.reassigned': ['Reasignó leads abiertos', 'Reassigned open leads'],
  'lead.taken': ['Tomó un lead', 'Took a lead'],
  'lead.attempted': ['Intentó contactar un lead', 'Tried to reach a lead'],
  'lead.contacted': ['Contactó un lead', 'Reached a lead'],
  'lead.qualified': ['Calificó un lead', 'Qualified a lead'],
  'lead.disqualified': ['Descartó un lead', 'Disqualified a lead'],
  'lead.converted': ['Convirtió un lead en comercio', 'Converted a lead into a merchant'],
  'lead.updated': ['Corrigió el tipo o el rol de un lead', 'Fixed a lead’s type or role'],
  'lead.passed': ['Pasó un lead a un compañero', 'Passed a lead to a teammate'],
  'lead.released': ['Soltó un lead', 'Released a lead'],
  'lead.repeat_request': ['Llegó otra solicitud web de la misma empresa', 'Another web request came in from the same business'],
  'routing.hours_updated': ['Cambió el horario hábil de un mercado', 'Changed a market’s business hours'],
  'routing.escalation_updated': ['Cambió el escalamiento del primer contacto de un mercado', 'Changed a market’s first-contact escalation'],
  'lead.escalated': ['Escaló un lead sin primer contacto', 'Escalated a lead with no first contact'],
  'deal.approval_requested': ['Pidió la aprobación de un paso', 'Asked for approval of a step'],
  'deal.approval_approved': ['Aprobó un paso', 'Approved a step'],
  'deal.approval_rejected': ['No aprobó un paso', 'Declined a step'],
  'deal.approval_escalated': ['Una aprobación venció y pasó al suplente', 'An approval ran out of time and went to the backup'],
  'deal.evidence_added': ['Agregó evidencia a un negocio', 'Added evidence to a deal'],
  'deal.waiting_on': ['Cambió a quién espera un negocio', 'Changed who a deal is waiting on'],
  'pipeline.step_saved': ['Cambió quién da un paso de etapa y qué pide', 'Changed who takes a stage step and what it requires'],
  'pipeline.stage_times': ['Cambió la meta de tiempo de una etapa', 'Changed a stage’s time goal'],
  'automation.created': ['Creó una automatización', 'Created an automation'],
  'automation.updated': ['Cambió una automatización', 'Edited an automation'],
  'automation.paused': ['Pausó una automatización', 'Paused an automation'],
  'automation.resumed': ['Activó una automatización', 'Turned an automation on'],
  'automation.task_created': ['Una automatización creó una tarea', 'An automation created a task'],
  'automation.notified': ['Una automatización avisó a una persona', 'An automation notified a person'],
  'job.run_manual': ['Corrió una tarea programada a mano', 'Ran a scheduled job by hand'],
  'exception.dismissed': ['Descartó un aviso', 'Dismissed an alert'],
  'exception.scheduled': ['Atendió un aviso con un próximo paso', 'Handled an alert with a next step'],
  'membership.granted': ['Dio acceso', 'Granted access'],
  'membership.ended': ['Quitó un acceso', 'Removed access'],
  'membership.expiry_changed': ['Cambió el vencimiento de un acceso', 'Changed when an access expires'],
  // La lista de arranque del ambiente (BOOTSTRAP_ADMIN_EMAILS) le dio Administración a esta persona al entrar: nadie se la otorgó desde la pantalla.
  'user.bootstrap_admin': ['Recibió Administración por la lista de arranque del ambiente', 'Got Administration from the environment’s bootstrap list'],
  'team.created': ['Creó un equipo', 'Created a team'],
  'user.territories_changed': ['Cambió los territorios de una persona', 'Changed a person’s territories'],
  'territory.created': ['Creó un territorio', 'Created a territory'],
  'territory.renamed': ['Cambió el nombre de un territorio', 'Renamed a territory'],
  'territory.archived': ['Archivó un territorio', 'Archived a territory'],
  'territory.restored': ['Volvió a activar un territorio', 'Restored a territory'],
  'pipeline.configured': ['Cambió la regla de cierre de un embudo', 'Changed a pipeline’s closing rule'],
  'stage.updated': ['Cambió una etapa', 'Edited a stage'],
  'stage.created': ['Agregó una etapa', 'Added a stage'],
  'stage.reordered': ['Cambió el orden de una etapa', 'Reordered a stage'],
  'stage.archived': ['Archivó una etapa', 'Archived a stage'],
  'pipeline.created': ['Creó un embudo', 'Created a pipeline'],
  'field.created': ['Creó un campo', 'Created a field'],
  'field.retired': ['Retiró un campo', 'Retired a field'],
  'field.restored': ['Volvió a activar un campo', 'Restored a field'],
  'account_type.created': ['Agregó un tipo de cuenta', 'Added an account type'],
  'account_type.retired': ['Retiró un tipo de cuenta', 'Retired an account type'],
  'account_type.restored': ['Volvió a activar un tipo de cuenta', 'Restored an account type'],
  'loss_reason.created': ['Agregó un motivo de pérdida', 'Added a loss reason'],
  'loss_reason.updated': ['Cambió un motivo de pérdida', 'Edited a loss reason'],
  'form.updated': ['Cambió un formulario web', 'Edited a web form'],
  'account.type_changed': ['Cambió el tipo de cuenta de un comercio', 'Changed a merchant’s account type'],
  'contact.primary_set': ['Cambió el contacto principal', 'Changed the primary contact'],
  'deal.paused': ['Puso un negocio en pausa', 'Put a deal on hold'],
  'deal.resumed': ['Retomó un negocio en pausa', 'Resumed a deal on hold'],
  'routing.members_changed': ['Cambió un turno de leads', 'Changed a lead rotation'],
  'api_client.created': ['Creó una llave de API', 'Created an API key'],
  'api_client.revoked': ['Revocó una llave de API', 'Revoked an API key'],
  'integration.visit_received': ['Llegó una visita de la Sales App', 'A Sales App visit came in'],
  'integration.store_received': ['Llegó un punto de venta de la Sales App', 'A store came in from the Sales App'],
  'integration.metrics_loaded': ['Se cargó el archivo diario de ventas', 'The daily sales file was loaded'],
  'integration.metrics_quarantined': ['Archivo de ventas apartado para revisión', 'Sales file set aside for review'],
  'integration.simulated': ['Probó una integración desde Administración', 'Tested an integration from Administration'],
  'import.started': ['Inició la importación de Pipedrive', 'Started the Pipedrive import'],
  'import.resumed': ['Reanudó la importación de Pipedrive', 'Resumed the Pipedrive import'],
  'import.cancelled': ['Detuvo la importación de Pipedrive', 'Stopped the Pipedrive import'],
  'import.completed': ['Terminó la importación de Pipedrive', 'The Pipedrive import finished'],
  'import.raw_purged': ['Vació la copia cruda de Pipedrive', 'Emptied the raw Pipedrive copy'],
  'rules.evaluated': ['Evaluó las reglas a mano', 'Ran the rules by hand'],
  'report.created': ['Reportó un problema o pidió algo', 'Reported a problem or asked for something'],
  'report.answered': ['Respondió un reporte del equipo', 'Answered a team report'],
  'report.exported': ['Exportó un reporte', 'Exported a report'],
  'fx.rate_set': ['Cargó una tasa de cambio', 'Loaded an exchange rate'],
  'session.started': ['Inició sesión', 'Signed in'],
  'session.ended': ['Cerró sesión', 'Signed out'],
}

/** Tipos de acción para filtrar la bitácora. El valor vacío es la vista de entrada: todo menos inicios y cierres de sesión. */
export const AUDIT_GROUPS = {
  '': { label: ['Cambios (sin inicios de sesión)', 'Changes (no sign-ins)'] as Pair, like: null, not: ['session.%'] },
  access: { label: ['Accesos y equipos', 'Access and teams'] as Pair, like: ['membership.%', 'team.%', 'user.%', 'street_seller.%'], not: null },
  config: { label: ['Configuración', 'Configuration'] as Pair, like: ['pipeline.%', 'stage.%', 'routing.%', 'api_client.%', 'territory.%', 'field.%', 'account_type.%', 'loss_reason.%', 'form.%', 'fx.%'], not: null },
  // 'report.' lo comparten dos cosas distintas: lo que alguien exporta (liderazgo) y lo que el equipo reporta (contenido).
  exports: { label: ['Exportaciones', 'Exports'] as Pair, like: ['report.exported'], not: null },
  integrations: { label: ['Integraciones y reglas', 'Integrations and rules'] as Pair, like: ['integration.%', 'import.%', 'rules.%', 'automation.%', 'job.%'], not: null },
  records: { label: ['Comercios, negocios y leads', 'Merchants, deals and leads'] as Pair, like: ['account.%', 'contact.%', 'deal.%', 'lead.%', 'activity.%', 'exception.%'], not: null },
  reports: { label: ['Problemas reportados', 'Reported problems'] as Pair, like: ['report.created', 'report.answered'], not: null },
  sessions: { label: ['Inicios y cierres de sesión', 'Sign-ins and sign-outs'] as Pair, like: ['session.%'], not: null },
  all: { label: ['Todo', 'Everything'] as Pair, like: null, not: null },
} as const
export type AuditGroup = keyof typeof AUDIT_GROUPS
export const isAuditGroup = (v: string | undefined): v is AuditGroup => v !== undefined && v in AUDIT_GROUPS

/** Tipos de registro por los que se filtra, con su nombre. */
export const AUDIT_OBJECT: Record<string, Pair> = {
  account: ['Comercio', 'Merchant'],
  deal: ['Negocio', 'Deal'],
  lead: ['Lead', 'Lead'],
  user: ['Persona', 'Person'],
  activity: ['Actividad', 'Activity'],
  exception: ['Aviso', 'Alert'],
  team: ['Equipo', 'Team'],
  territory: ['Territorio', 'Territory'],
  problem_report: ['Reporte de un problema', 'Problem report'],
  street_seller: ['Vendedor de calle', 'Street seller'],
  pipeline: ['Embudo', 'Pipeline'],
  stage: ['Etapa', 'Stage'],
  field: ['Campo', 'Field'],
  account_type: ['Tipo de cuenta', 'Account type'],
  loss_reason: ['Motivo de pérdida', 'Loss reason'],
  form: ['Formulario web', 'Web form'],
  routing_rule: ['Turno de leads', 'Lead rotation'],
  api_client: ['Llave de API', 'API key'],
  import_run: ['Importación de Pipedrive', 'Pipedrive import'],
  ingest_batch: ['Archivo de ventas', 'Sales file'],
  integration: ['Integración', 'Integration'],
  rules: ['Reglas', 'Rules'],
  automation: ['Automatización', 'Automation'],
  job: ['Tarea programada', 'Scheduled job'],
  market: ['Mercado', 'Market'],
  report: ['Reporte exportado', 'Exported report'],
  fx_rate: ['Tasa de cambio', 'Exchange rate'],
  session: ['Sesión', 'Session'],
  notice: ['Aviso de una nota', 'Notice from a note'],
  ops_catalog: ['Catálogo de Operaciones', 'Operations catalog'],
  product: ['Producto', 'Product'],
}

/** Los reportes que se pueden exportar, con su nombre. */
export const REPORT_NAME: Record<string, Pair> = {
  closed_deals: ['Negocios cerrados', 'Closed deals'],
  field_stores: ['Reporte semanal de campo: altas y ganados', 'Weekly field report: enrollments and wins'],
  field_visits: ['Reporte semanal de campo: visitas por persona', 'Weekly field report: visits by person'],
}

export const actionLabel = (t: T, action: string) => {
  const pair = AUDIT_ACTION[action]
  return pair ? t(pair[0], pair[1]) : action
}

// ------------------------------------------------------------------ antes y después, en palabras
type Json = unknown
export type Names = Record<string, string>

const FIELD: Record<string, Pair> = {
  role: ['Rol', 'Role'],
  market: ['Mercado', 'Market'],
  team_id: ['Equipo', 'Team'],
  expires: ['Vence el', 'Expires on'],
  owner_id: ['Quién lo lleva', 'Owner'],
  to_user_id: ['Pasan a', 'Moved to'],
  status: ['Estado', 'Status'],
  stage_id: ['Etapa', 'Stage'],
  kind: ['Tipo', 'Type'],
  reason: ['Motivo', 'Reason'],
  name: ['Nombre', 'Name'],
  name_es: ['Nombre en español', 'Name in Spanish'],
  name_en: ['Nombre en inglés', 'Name in English'],
  rot_days: ['Se estanca a los', 'Stalls after'],
  required_fields: ['Pide para entrar', 'Required to enter'],
  close_by_transaction: ['Se gana con la primera transacción', 'Won by the first transaction'],
  awaiting_stage_id: ['Etapa que espera la transacción', 'Stage that waits for the transaction'],
  member_ids: ['Personas en el turno', 'People in the rotation'],
  fallback_id: ['Respaldo', 'Fallback'],
  scopes: ['Permisos', 'Scopes'],
  source: ['Origen', 'Source'],
  motor: ['Tipo de venta', 'Sale type'],
  count: ['Cantidad', 'Count'],
  account_ids: ['Comercios movidos', 'Merchants moved'],
  lead_ids: ['Leads movidos', 'Leads moved'],
  deal_ids: ['Negocios movidos', 'Deals moved'],
  from_user_ids: ['Eran de', 'They belonged to'],
  from: ['Eran de', 'They belonged to'],
  to_name: ['Nombre de quien recibe', 'Name of who receives'],
  tasks: ['Tareas y visitas abiertas que se fueron con ellos', 'Open tasks and visits moved with them'],
  territory_id: ['Territorio', 'Territory'],
  territory: ['Nombre del territorio', 'Territory name'],
  territory_ids: ['Territorios', 'Territories'],
  no_current_owner: ['Lo suyo quedó por repartir', 'Their records were left with no current owner'],
  account_id: ['Comercio', 'Merchant'],
  parent_id: ['Cadena', 'Parent'],
  source_id: ['Comercio archivado', 'Archived merchant'],
  source_name: ['Nombre del archivado', 'Archived name'],
  target_id: ['Comercio que se queda', 'Surviving merchant'],
  deal_id: ['Negocio', 'Deal'],
  pipeline_id: ['Embudo', 'Pipeline'],
  next_step: ['Próximo paso', 'Next step'],
  next_step_due: ['Fecha del próximo paso', 'Next step date'],
  next: ['Qué sigue', 'What is next'],
  outcome: ['Resultado', 'Outcome'],
  opened: ['Avisos nuevos', 'New alerts'],
  closed: ['Avisos resueltos solos', 'Alerts cleared on their own'],
  removed_from_rules: ['Salió de los turnos', 'Removed from rotations'],
  fallback_cleared: ['Dejó de ser respaldo de', 'No longer the fallback of'],
  accounts: ['Comercios a su nombre', 'Merchants in their name'],
  deals: ['Negocios abiertos a su nombre', 'Open deals in their name'],
  leads: ['Leads abiertos a su nombre', 'Open leads in their name'],
  consent: ['Consentimiento para correos', 'Email consent'],
  utm_source: ['Fuente de campaña', 'Campaign source'],
  utm_campaign: ['Campaña', 'Campaign'],
  title: ['Título', 'Title'],
  amount_minor: ['Monto', 'Amount'],
  mode: ['Modo', 'Mode'],
  rows: ['Filas', 'Rows'],
  as_of: ['Fecha de corte', 'As-of date'],
  key: ['Mensaje de prueba', 'Test message'],
  email: ['Correo', 'Email'],
  forced_duplicate: ['Se guardó aunque parecía duplicado', 'Saved although it looked like a duplicate'],
  customer_id: ['ID en la Sales App', 'Sales App ID'],
  visit_id: ['Visita', 'Visit'],
  sale: ['Con venta', 'With a sale'],
  revisit: ['Pide revisita', 'Needs a revisit'],
  matched: ['Filas ligadas', 'Rows matched'],
  unmatched: ['Filas sin comercio', 'Rows with no merchant'],
  deals_won: ['Negocios ganados', 'Deals won'],
  follows: ['Sigue a la actividad', 'Follows the activity'],
  origin: ['Dónde se registró', 'Where it was logged'],
  on: ['Día de la visita', 'Day of the visit'],
  visited_by: ['Quién visitó', 'Who visited'],
  revisit_needed: ['Pide revisita', 'Needs a revisit'],
  by: ['Por', 'Because of'],
  contact_id: ['Contacto', 'Contact'],
  link: ['Enlace', 'Link'],
  task_for: ['Tarea para', 'Task for'],
  person_added: ['Se agregó la persona', 'Person added'],
  scope: ['Alcance', 'Scope'],
  external: ['Persona externa', 'External person'],
  confirmed: ['Confirmación explícita', 'Explicit confirmation'],
}

const VALUE: Record<string, Pair> = {
  provider: ['Proveedor', 'Provider'],
  sent: ['Enviado', 'Sent'],
  all_markets: ['Ve y cambia todo, en todos los mercados', 'Sees and changes everything, in every market'],
  amount: ['monto esperado', 'expected amount'],
  decision_maker: ['quien decide, identificado y contactado', 'decision-maker identified and reached'],
  next_step: ['próximo paso con fecha', 'next step with a date'],
  access_removed: ['Se le quitó el acceso', 'Their access was removed'],
  open: ['Abierto', 'Open'],
  won: ['Ganado', 'Won'],
  lost: ['Perdido', 'Lost'],
  awaiting_txn: ['Esperando primera venta', 'Awaiting first sale'],
  persona: ['Persona de prueba', 'Test persona'],
  sso: ['Cuenta de Google', 'Google account'],
  visit: ['Visita de la Sales App', 'Sales App visit'],
  store: ['Punto de venta nuevo', 'New store'],
  metrics: ['Archivo diario de ventas', 'Daily sales file'],
  full: ['Completa', 'Full'],
  delta: ['Solo lo que cambió', 'Only what changed'],
  remap: ['Volver a aplicar el mapeo', 'Re-apply the mapping'],
  reached: ['Se logró el contacto', 'Reached'],
  no_answer: ['No contestó', 'No answer'],
  done: ['Hecho', 'Done'],
  later: ['Después', 'Later'],
  none: ['Nada más', 'Nothing else'],
  manual: ['En CONTIGO, a mano', 'In CONTIGO, by hand'],
  manual_visit: ['Una visita registrada en CONTIGO', 'A visit logged in CONTIGO'],
  sale: ['Hubo venta o alta', 'Sale or sign-up'],
  no_sale: ['No hubo venta', 'No sale'],
  revisit: ['Volver con quien decide', 'Go back for the decision-maker'],
  vacant: ['Por repartir', 'No current owner'],
}

/** "Qué sigue" al completar o registrar una actividad: los mismos nombres que la hoja de completar. */
const NEXT: Record<string, Pair> = {
  call: ['Llamar', 'Call'],
  visit: ['Visitar', 'Visit'],
  proposal: ['Enviar propuesta', 'Send proposal'],
  meeting: ['Reunión', 'Meeting'],
  task: ['Otra tarea', 'Other task'],
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Todos los identificadores que aparecen en un antes o un después, para traer sus nombres en una sola consulta por tipo. */
export function idsIn(value: Json, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (UUID.test(value)) out.add(value)
  } else if (Array.isArray(value)) value.forEach((v) => idsIn(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => idsIn(v, out))
  return out
}

function word(t: T, locale: Locale, key: string, v: Json, names: Names, action = ''): string {
  if (v === null || v === undefined || v === '') return t('nada', 'nothing')
  if (typeof v === 'boolean') return v ? t('Sí', 'Yes') : 'No'
  if (typeof v === 'number') {
    if (key === 'rot_days') return v === 0 ? t('nunca', 'never') : t(`${v} días`, `${v} days`)
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX').format(v)
  }
  if (Array.isArray(v)) {
    if (key === 'account_ids') return t(`${v.length} comercios`, `${v.length} merchants`)
    if (key === 'lead_ids') return t(`${v.length} leads`, `${v.length} leads`)
    if (key === 'deal_ids') return t(`${v.length} negocios`, `${v.length} deals`)
    return v.length === 0 ? t('nadie', 'nobody') : v.map((x) => word(t, locale, key, x, names, action)).join(', ')
  }
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 160)
  const s = String(v)
  if (UUID.test(s)) return names[s] ?? t('un registro que ya no puedes ver', 'a record you can no longer see')
  if (key === 'role' && s in ROLE_LABEL) return t(ROLE_LABEL[s as Role].es, ROLE_LABEL[s as Role].en)
  if (key === 'status' && LEAD_STATUS[s]) return t(...LEAD_STATUS[s].label)
  if (key === 'source' && SOURCE[s]) return t(...SOURCE[s])
  if (key === 'motor' && MOTOR[s]) return t(...MOTOR[s])
  if (key === 'kind' && EXCEPTION[s]) return t(...EXCEPTION[s].label)
  // En una actividad, "visit" es la visita que alguien registró o dejó por hacer; en una integración, la que llega de la Sales App.
  if (key === 'kind' && action.startsWith('activity.') && ACTIVITY[s]) return t(...ACTIVITY[s])
  if (key === 'next' && NEXT[s]) return t(...NEXT[s])
  if ((key === 'expires' || key === 'next_step_due' || key === 'as_of' || key === 'next' || key === 'on') && DAY.test(s)) {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T12:00:00Z`))
  }
  if ((key === 'from' || key === 'from_user_ids') && s === 'none') return t('nadie (estaban sin asignar)', 'nobody (they had no owner)')
  if (VALUE[s]) return t(...VALUE[s])
  return s.length > 160 ? `${s.slice(0, 160)}…` : s
}

const empty = (v: Json) => v === null || v === undefined || (Array.isArray(v) && v.length === 0)

export type DiffRow = { key: string; label: string; before: string | null; after: string | null }

/** El antes y el después de un evento, campo por campo y con nombres en vez de identificadores. */
export function diffRows(t: T, locale: Locale, before: Record<string, Json> | null, after: Record<string, Json> | null, names: Names, action = ''): DiffRow[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  return keys
    .filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    // Una lista vacía que antes no existía no dice nada ("salió de los turnos: nadie"): no se muestra.
    .filter((k) => !(empty(before?.[k]) && empty(after?.[k])))
    // Una clave interna sin nombre legible no se muestra: el detalle es para personas, no para leer la base.
    .filter((k) => Boolean(FIELD[k]))
    .map((k) => ({
      key: k,
      label: t(...FIELD[k]!),
      before: before && k in before ? word(t, locale, k, before[k], names, action) : null,
      after: after && k in after ? word(t, locale, k, after[k], names, action) : null,
    }))
}

/** Lo esencial de un evento en una línea, para leerlo sin abrir el detalle: "Ventas · US · vence el 30 nov 2026". */
export function summary(t: T, locale: Locale, action: string, before: Record<string, Json> | null, after: Record<string, Json> | null, names: Names): string {
  const w = (key: string, v: Json) => word(t, locale, key, v, names, action)
  const src = { ...(before ?? {}), ...(after ?? {}) }
  if (action.startsWith('membership.')) {
    const parts = [w('role', src.role), src.market ? String(src.market) : null, src.team_id ? w('team_id', src.team_id) : null]
    if (action === 'membership.granted' && after?.expires) parts.push(t(`vence el ${w('expires', after.expires)}`, `expires on ${w('expires', after.expires)}`))
    if (action === 'membership.expiry_changed') parts.push(after?.expires ? t(`ahora vence el ${w('expires', after.expires)}`, `now expires on ${w('expires', after.expires)}`) : t('ya no vence', 'no longer expires'))
    const out = Array.isArray(after?.removed_from_rules) && after.removed_from_rules.length ? t(`salió de: ${w('removed_from_rules', after.removed_from_rules)}`, `removed from: ${w('removed_from_rules', after.removed_from_rules)}`) : null
    return [...parts, out].filter(Boolean).join(' · ')
  }
  if (action === 'deal.stage_changed') return t(`de ${w('stage_id', before?.stage_id)} a ${w('stage_id', after?.stage_id)}`, `from ${w('stage_id', before?.stage_id)} to ${w('stage_id', after?.stage_id)}`)
  if (action === 'lead.assigned' || action === 'lead.taken' || action === 'lead.passed') return t(`de ${w('owner_id', before?.owner_id)} a ${w('owner_id', after?.owner_id)}`, `from ${w('owner_id', before?.owner_id)} to ${w('owner_id', after?.owner_id)}`)
  if (action === 'account.reassigned') return t(`${w('count', before?.count)} comercios a ${w('to_user_id', after?.to_user_id)}`, `${w('count', before?.count)} merchants to ${w('to_user_id', after?.to_user_id)}`)
  if (action === 'lead.reassigned') return t(`${w('count', before?.count)} leads a ${w('to_user_id', after?.to_user_id)}`, `${w('count', before?.count)} leads to ${w('to_user_id', after?.to_user_id)}`)
  if (action === 'deal.reassigned') return t(`${w('count', before?.count)} negocios a ${w('to_user_id', after?.to_user_id)}`, `${w('count', before?.count)} deals to ${w('to_user_id', after?.to_user_id)}`)
  if (action === 'account.territory_set') return t(`${w('count', before?.count)} comercios: ${after?.territory ? w('territory', after.territory) : 'sin territorio'}`, `${w('count', before?.count)} merchants: ${after?.territory ? w('territory', after.territory) : 'no territory'}`)
  if (action.startsWith('territory.')) return w('name', after?.name)
  if (action === 'routing.members_changed') return w('member_ids', after?.member_ids)
  if (action === 'pipeline.configured') return after?.close_by_transaction ? t('se gana con la primera transacción', 'won by the first transaction') : t('se cierra a mano', 'closed by hand')
  if (action === 'rules.evaluated') return t(`${w('opened', after?.opened)} avisos nuevos, ${w('closed', after?.closed)} resueltos solos`, `${w('opened', after?.opened)} new alerts, ${w('closed', after?.closed)} cleared on their own`)
  if (action === 'integration.simulated') return w('kind', after?.kind)
  if (action === 'activity.added' || action === 'activity.completed') return [after?.kind ? w('kind', after.kind) : null, after?.outcome ? w('outcome', after.outcome) : null].filter(Boolean).join(' · ')
  if (action === 'api_client.created') return w('scopes', after?.scopes)
  if (action === 'session.started') return w('kind', after?.kind)
  if (action === 'report.exported') {
    const name = REPORT_NAME[String(after?.report)]
    return [name ? t(name[0], name[1]) : String(after?.report ?? ''), t(`${Number(after?.rows ?? 0)} filas`, `${Number(after?.rows ?? 0)} rows`)].join(' · ')
  }
  if (action === 'fx.rate_set') return t(`1 ${String(after?.currency)} = ${String(after?.usd_rate)} USD, tasa del ${String(after?.as_of)}`, `1 ${String(after?.currency)} = ${String(after?.usd_rate)} USD, rate dated ${String(after?.as_of)}`)
  return ''
}

// ------------------------------------------------------------------ hora de quien lee
/** Una zona horaria IANA que este servidor conoce. Lo que llega del navegador se valida antes de usarlo. */
export function validTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** "hora de Puerto Rico (GMT-4)": la zona escrita, para que nadie tenga que adivinar en qué hora está la bitácora. */
export function zoneLabel(timeZone: string, locale: Locale, at = new Date()): string {
  if (timeZone === 'UTC') return locale === 'en' ? 'UTC time' : 'hora UTC'
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? ''
  // Las zonas con nombre propio se dicen por su nombre ("hora del Este"); las demás, por su ciudad.
  return `${zoneName(timeZone, locale, undefined, true)} (${offset})`
}

/** Fecha y hora de un evento, con segundos: "11 nov 2026, 9:02:15 p.m.". */
export function stamp(d: Date | string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone })
    .format(typeof d === 'string' ? new Date(d) : d)
}
