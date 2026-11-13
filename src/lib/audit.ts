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
  // Paquete datos2 (0040)
  'contact.merged': ['Fusionó un contacto duplicado', 'Merged a duplicate contact'],
  'contact.merge_undone': ['Deshizo la fusión de un contacto', 'Undid a contact merge'],
  'contact.pair_dismissed': ['Marcó que dos contactos no son la misma persona', 'Marked two contacts as different people'],
  'decision.set': ['Cambió una decisión de negocio', 'Changed a business decision'],
  'lead.held': ['Retuvo una solicitud sin dueño', 'Held a request with no owner'],
  'lead.held_released': ['Liberó una solicitud retenida', 'Released a held request'],
  'account.owner_followed_parent': ['El comercio tomó el dueño de su cuenta de arriba', 'The merchant took the owner of the record above'],
  'field.promotion_requested': ['Pidió pasar un campo a columna', 'Requested promoting a field to a column'],
  'expansion.deal_opened': ['Abrió un negocio de expansión', 'Opened an expansion deal'],
  'product.entity_set': ['Cambió la entidad legal de un producto', 'Changed a product’s legal entity'],
  'account.timezone_set': ['Cambió la zona horaria de un comercio', 'Changed a merchant’s time zone'],
  'seat.requested': ['Pidió un asiento para una persona', 'Requested a seat for a person'],
  'market.reset_blocked': ['Intentó borrar y recargar un mercado en producción', 'Tried to wipe and reload a market in production'],
  'contact.updated': ['Corrigió los datos de un contacto', 'Edited a contact'],
  'contact.ended': ['Dio de baja a un contacto en una cuenta', 'Removed a contact from an account'],
  'account.unmerged': ['Deshizo una fusión de comercios', 'Undid a merchant merge'],
  'duplicate.bypassed': ['Creó un comercio aunque se parecía a otro, con motivo', 'Created a merchant despite a duplicate warning, with a reason'],
  'duplicate.scanned': ['Buscó duplicados en un mercado', 'Scanned a market for duplicates'],
  'duplicate.dismissed': ['Descartó un par de posibles duplicados', 'Dismissed a pair of possible duplicates'],
  'duplicate.bypass_reviewed': ['Revisó un aviso de duplicado que se había saltado', 'Reviewed a skipped duplicate warning'],
  'alias.added': ['Agregó un ID de otro sistema a un comercio', 'Added an ID from another system to a merchant'],
  'alias.closed': ['Cerró un ID de otro sistema de un comercio', 'Closed a merchant’s ID from another system'],
  'alias_system.created': ['Agregó un sistema de origen de identificadores', 'Added a source system for identifiers'],
  'field.updated': ['Cambió un campo del registro', 'Edited a registry field'],
  'field.proposed': ['Propuso un campo nuevo', 'Proposed a new field'],
  'field.approved': ['Aprobó un campo propuesto', 'Approved a proposed field'],
  'field.rejected': ['Rechazó un campo propuesto', 'Rejected a proposed field'],
  'form.created': ['Creó un formulario web', 'Created a web form'],
  'form.toggled': ['Activó o pausó un formulario web', 'Turned a web form on or off'],
  'routing.rule_created': ['Creó un turno de leads', 'Created a lead rotation'],
  'routing.rule_toggled': ['Activó o pausó un turno de leads', 'Turned a lead rotation on or off'],
  // Paquete ia (0034)
  'recommendation.accepted': ['Aceptó una sugerencia y dejó la tarea con fecha', 'Accepted a suggestion and set the task with a date'],
  'recommendation.dismissed': ['Descartó una sugerencia, con motivo', 'Dismissed a suggestion, with a reason'],
  'ia.settings_changed': ['Cambió el nivel de asistencia de un mercado', 'Changed a market’s assistance level'],
  'ia.spot_checked': ['Registró la revisión semanal de la asistencia', 'Logged the weekly review of the assistance'],
  'ia.holdout_added': ['Puso un territorio como grupo de control', 'Made a territory a control group'],
  'ia.holdout_removed': ['Quitó un territorio del grupo de control', 'Removed a territory from the control group'],
  'ia.draft_approved': ['Aprobó un borrador de tarea', 'Approved a task draft'],
  'ia.draft_rejected': ['Rechazó un borrador de tarea, con motivo', 'Rejected a task draft, with a reason'],
  'ia.lead_weights_changed': ['Cambió los pesos de la calificación de leads', 'Changed the lead scoring weights'],
  'ia.lead_classified': ['Confirmó la clasificación de un lead', 'Confirmed a lead’s classification'],
  'ia.eval_run': ['Corrió la evaluación de una función', 'Ran a feature’s evaluation'],
  'ia.eval_case_added': ['Agregó un caso a la evaluación', 'Added a case to the evaluation'],
  'ia.mcp_read': ['Un agente leyó datos por el servidor MCP', 'An agent read data through the MCP server'],
  // Paquete embudo (0029)
  'routing.assignment_rule_created': ['Creó una regla de asignación de leads', 'Created a lead assignment rule'],
  'routing.assignment_rule_toggled': ['Activó o pausó una regla de asignación de leads', 'Turned a lead assignment rule on or off'],
  'routing.assignment_rule_changed': ['Cambió el tope de una regla de asignación', 'Changed the cap of an assignment rule'],
  'routing.assignment_rule_moved': ['Cambió el orden de una regla de asignación', 'Changed the order of an assignment rule'],
  'stage.condition_set': ['Cambió la condición de un requisito de etapa', 'Changed the condition of a stage requirement'],
  'deal.funded': ['El primer fondeo pasó un negocio a esperar la primera venta', 'The first funding moved a deal to waiting for the first sale'],
  'deal.win_corrected': ['Reabrió un negocio ganado: la primera venta se corrigió', 'Reopened a won deal: the first sale was corrected'],
  'deal.win_redated': ['Corrigió la fecha en que se ganó un negocio', 'Corrected the date a deal was won'],
  'account.milestone_corrected': ['Corrigió un hito de venta de un comercio', 'Corrected a merchant’s sales milestone'],
  'account.lifecycle_corrected': ['Regresó un comercio a "en alta" por una corrección', 'Moved a merchant back to onboarding after a correction'],
  'account.referral_code_created': ['Creó el enlace de referido de un comercio', 'Created a merchant’s referral link'],
  'account.referral_qualified': ['Un referido de este comercio hizo su primera venta', 'A referral from this merchant made its first sale'],
  'account.referral_code_toggled': ['Activó o pausó el enlace de referido de un comercio', 'Turned a merchant’s referral link on or off'],
  'account.ticket_linked': ['Ligó un ticket de soporte al hilo de un comercio', 'Linked a support ticket to a merchant’s thread'],
  'account.ticket_status_changed': ['Cambió el estado de un ticket de soporte', 'Changed the status of a support ticket'],
  'activity.revisit_scheduled': ['Dejó programada la revisita a quien decide', 'Scheduled the revisit to the decision-maker'],
  'lead.referred': ['Entró un lead referido por un comercio', 'A lead referred by a merchant came in'],
  'lead.linked_to_account': ['Ligó un lead a un comercio existente', 'Linked a lead to an existing merchant'],
  'lead.unlinked_from_account': ['Quitó la liga de un lead con un comercio', 'Unlinked a lead from a merchant'],
  'lead.labels_changed': ['Cambió las etiquetas de un lead', 'Changed a lead’s labels'],
  'lead.label_created': ['Agregó una etiqueta de lead', 'Added a lead label'],
  'integration.intake_held': ['Retuvo un envío de formulario que no se pudo guardar', 'Held a form submission that could not be saved'],
  'integration.intake_retried': ['Reintentó a mano un envío de formulario retenido', 'Retried a held form submission by hand'],
  'market.created': ['Agregó un mercado', 'Added a market'],
  'market.updated': ['Cambió un mercado', 'Edited a market'],
  'account_type.depth_set': ['Cambió los niveles que admite un tipo de cuenta', 'Changed how many levels an account type allows'],
  'process.list_created': ['Creó una lista de proceso', 'Created a process list'],
  'process.list_toggled': ['Activó o retiró una lista de proceso', 'Turned a process list on or off'],
  'process.enrolled': ['Puso un comercio en una lista de proceso', 'Put a merchant on a process list'],
  'process.status_changed': ['Cambió el estado de un comercio en una lista de proceso', 'Changed a merchant’s status on a process list'],
  'quality.rule_updated': ['Cambió una regla de calidad de datos', 'Edited a data quality rule'],
  'quality.snapshot_saved': ['Guardó el corte de calidad de datos de hoy', 'Saved today’s data quality snapshot'],
  'deal.contact_role_set': ['Puso o cambió el rol de una persona en un negocio', 'Set or changed a person’s role on a deal'],
  'deal.contact_role_ended': ['Quitó a una persona de un negocio', 'Removed a person from a deal'],
  'account.product_set': ['Cambió un producto de un comercio o su estado con el proveedor', 'Changed a merchant’s product or its provider status'],
  'provider.sla_set': ['Cambió el plazo de respuesta de un proveedor', 'Changed a provider’s response deadline'],
  'account.store_profile_set': ['Cambió el número de sitio, el tipo de negocio o los carriers anteriores de una tienda', 'Changed a store’s site number, business type or earlier carriers'],
  'account.origin_set': ['Fijó el origen de un comercio', 'Set a merchant’s origin'],
  'account.recruiter_set': ['Fijó quién reclutó una tienda', 'Set who recruited a store'],
  'account.tax_id_set': ['Cambió los últimos 4 del Tax ID de una tienda', 'Changed the last 4 of a store’s Tax ID'],
  'account.carrier_detail_set': ['Cambió el detalle de un carrier en una tienda', 'Changed a carrier’s details on a store'],
  'account.carrier_label_set': ['Cambió el nombre del identificador que da un carrier', 'Changed the name of the ID a carrier issues'],
  'team.agency_created': ['Agregó una agencia o socio que recluta tiendas', 'Added an agency or partner that recruits stores'],
  'team.agency_retired': ['Dio de baja una agencia o socio', 'Retired an agency or partner'],
  'team.agency_restored': ['Reactivó una agencia o socio', 'Restored an agency or partner'],
  'product.provider_set': ['Cambió el proveedor de un producto', 'Changed a product’s provider'],
  'market.holiday_added': ['Agregó un día festivo', 'Added a holiday'],
  'market.holiday_removed': ['Quitó un día festivo', 'Removed a holiday'],
  'entity.created': ['Agregó una entidad legal', 'Added a legal entity'],
  'entity.updated': ['Cambió una entidad legal', 'Edited a legal entity'],
  'user.entity_set': ['Cambió la entidad legal de una persona', 'Changed a person’s legal entity'],
  'account.profile_set': ['Cambió entidad, unidad de negocio o zona horaria de un comercio', 'Changed a merchant’s entity, business unit or time zone'],
  'account.address_set': ['Cambió la dirección de un comercio', 'Changed a merchant’s address'],
  'account.located': ['Guardó la ubicación de un comercio', 'Saved a merchant’s location'],
  'account.location_cleared': ['Quitó la ubicación de un comercio', 'Removed a merchant’s location'],
  'taxid.captured': ['Capturó un identificador fiscal', 'Captured a tax ID'],
  'taxid.reviewed': ['Revisó un identificador fiscal', 'Reviewed a tax ID'],
  'whatsapp.account_saved': ['Guardó el número de WhatsApp de un mercado', 'Saved a market’s WhatsApp number'],
  'whatsapp.template_saved': ['Guardó una plantilla de WhatsApp', 'Saved a WhatsApp template'],
  'whatsapp.template_status': ['Cambió el estado de una plantilla de WhatsApp', 'Changed a WhatsApp template’s status'],
  'whatsapp.rate_saved': ['Cargó un costo por mensaje de WhatsApp', 'Loaded a WhatsApp cost per message'],
  'account.whatsapp_window': ['Anotó que el comercio escribió por WhatsApp', 'Noted that the merchant wrote on WhatsApp'],
  'ficha.layout_set': ['Cambió los datos de arriba de la ficha para un rol', 'Changed the top facts of the merchant page for a role'],
  'field_section.created': ['Agregó una sección de campos', 'Added a field section'],
  'field.section_set': ['Movió un campo de sección', 'Moved a field to another section'],
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
  'deal.order_updated': ['Cambió los datos de envío de un pedido', 'Edited an order’s shipping details'],
  'deal.ops_assigned': ['Un negocio quedó a nombre de quien lidera Operaciones', 'A deal was assigned to the Operations lead'],
  'deal.turn_assigned': ['Un negocio pasó por turno a otra persona', 'A deal went in turn to another person'],
  'pipeline.visit_reason_created': ['Agregó un propósito de visita', 'Added a visit purpose'],
  'pipeline.visit_reason_updated': ['Cambió un propósito de visita', 'Edited a visit purpose'],
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
  'routing.target_set': ['Cambió la meta de respuesta de un turno', 'Changed a rotation’s response target'],
  'form.campaign_set': ['Cambió el embudo de campaña, el canal o los tipos de empresa de un formulario', 'Changed a form’s campaign group, channel or company types'],
  'territory.manager_set': ['Cambió el gerente de un territorio', 'Changed a territory’s manager'],
  'account.owner_by_territory': ['Una tienda pasó al gerente de su territorio', 'A store went to its territory manager'],
  'pipeline.win_rule_set': ['Cambió la regla para ganar de un embudo', 'Changed a pipeline’s win rule'],
  'sheet.visits_loaded': ['Cargó visitas desde la hoja', 'Loaded visits from the sheet'],
  'sheet.migrated_loaded': ['Cargó tiendas migradas desde la hoja', 'Loaded migrated stores from the sheet'],
  'deal.won_on_migration': ['Negocio ganado en la fecha real de migración', 'Deal won on the real migration date'],
  'rollout.step_set': ['Cambió un paso del arranque del mercado', 'Changed a market rollout step'],
  'rollout.leaders_first_set': ['Cambió la regla de primero quienes lideran', 'Changed the leaders-first rule'],
  'rollout.team_opened': ['Abrió el mercado al equipo de campo', 'Opened the market to the field team'],
  'rollout.key_person_added': ['Agregó una persona clave al arranque', 'Added a key person to the rollout'],
  'rollout.key_person_removed': ['Quitó una persona clave del arranque', 'Removed a key person from the rollout'],
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
  'import.conflict_kept': ['Decidió quedarse con lo de CONTIGO en un choque con Pipedrive', 'Kept the CONTIGO value in a clash with Pipedrive'],
  'import.conflict_taken': ['Decidió usar lo de Pipedrive en un choque', 'Used the Pipedrive value in a clash'],
  'import.cutover_updated': ['Cambió la convivencia con Pipedrive de un mercado', 'Changed the Pipedrive coexistence of a market'],
  'goal.updated': ['Cambió una meta', 'Changed a goal'],
  'rules.evaluated': ['Evaluó las reglas a mano', 'Ran the rules by hand'],
  'onboarding.opened': ['Abrió un expediente de alta', 'Opened an enrollment file'],
  'onboarding.document_received': ['Marcó un documento del expediente como recibido', 'Marked an enrollment document as received'],
  'onboarding.submitted': ['Envió un expediente a la mesa de control', 'Sent an enrollment file to the control desk'],
  'onboarding.auto_approved': ['Expediente de prepago aprobado por regla', 'Prepaid enrollment file approved by rule'],
  'onboarding.assigned': ['Tomó o repartió un expediente de la mesa de control', 'Took or assigned a control desk file'],
  'onboarding.document_reviewed': ['Validó o rechazó un documento del expediente', 'Validated or rejected an enrollment document'],
  'onboarding.approved': ['Aprobó un expediente de alta', 'Approved an enrollment file'],
  'onboarding.returned': ['Devolvió un expediente de alta con motivo', 'Returned an enrollment file with a reason'],
  'onboarding.document_opened': ['Pidió abrir un documento del expediente', 'Asked to open an enrollment document'],
  'threshold.changed': ['Cambió un umbral (versión nueva)', 'Changed a threshold (new version)'],
  'channel.assigned': ['Asignó el canal de un comercio', 'Assigned a merchant’s channel'],
  'territory.owner_set': ['Puso quién responde por un territorio', 'Set who owns a territory'],
  'seller.profile_set': ['Cambió el perfil de quien vende (abre o cuida cartera)', 'Changed a seller’s profile (opens or keeps accounts)'],
  'portfolio.plan_drafted': ['Guardó un plan de reparto en borrador', 'Saved a draft reassignment plan'],
  'portfolio.plan_applied': ['Aplicó un plan de reparto', 'Applied a reassignment plan'],
  'portfolio.plan_discarded': ['Descartó un plan de reparto', 'Discarded a reassignment plan'],
  'attribution.corrected': ['Corrigió la atribución de un comercio (fila nueva)', 'Corrected a merchant’s attribution (new row)'],
  'dispute.raised': ['Levantó una disputa de atribución', 'Raised an attribution dispute'],
  'dispute.resolved': ['Resolvió una disputa de atribución', 'Resolved an attribution dispute'],
  'claim.registered': ['Registró una tienda a nombre de un canal', 'Registered a store for a channel'],
  'claim.extended': ['Extendió un registro de canal con evidencia', 'Extended a channel registration with evidence'],
  'claim.rejected': ['Rechazó un registro de canal con motivo', 'Rejected a channel registration with a reason'],
  'funding.simulated': ['Cargó un dato de fondeo simulado', 'Loaded a simulated funding value'],
  'credit.requested': ['Pidió un límite de crédito', 'Requested a credit limit'],
  'credit.decided': ['Aprobó o rechazó un límite de crédito', 'Approved or rejected a credit limit'],
  'competitor.added': ['Agregó un competidor a la lista', 'Added a competitor to the list'],
  'competitor.observed': ['Registró competencia en un punto de venta', 'Recorded competition at a store'],
  'plan.set': ['Puso la meta del mes de una persona', 'Set a person’s monthly target'],
  'field_incident.reported': ['Reportó un incidente de campo', 'Reported a field incident'],
  'field_incident.taken': ['Tomó un incidente de campo', 'Took a field incident'],
  'field_incident.closed': ['Cerró un incidente de campo', 'Closed a field incident'],
  'field_incident.viewed': ['Abrió el detalle de un incidente de campo', 'Opened a field incident'],
  'report.created': ['Reportó un problema o pidió algo', 'Reported a problem or asked for something'],
  'report.answered': ['Respondió un reporte del equipo', 'Answered a team report'],
  'report.exported': ['Exportó un reporte', 'Exported a report'],
  'fx.rate_set': ['Cargó una tasa de cambio', 'Loaded an exchange rate'],
  // avisos (0020): servicio de avisos, plantillas, anuncios, pedido a Operaciones, capacitación y reportes
  'notice.all_seen': ['Marcó todos sus avisos como leídos', 'Marked all notices as read'],
  'notice.prefs_saved': ['Cambió sus preferencias de avisos', 'Changed notice preferences'],
  'template.saved': ['Guardó una versión nueva de una plantilla', 'Saved a new version of a template'],
  'comms.saved': ['Cambió la configuración de avisos de un mercado', 'Changed a market’s notice settings'],
  'help.lesson_saved': ['Cambió la lección de una pantalla', 'Changed a screen’s lesson'],
  'announcement.published': ['Publicó un anuncio', 'Published an announcement'],
  'announcement.updated': ['Publicó una versión nueva de un anuncio', 'Published a new version of an announcement'],
  'announcement.withdrawn': ['Retiró un anuncio', 'Withdrew an announcement'],
  'announcement.read': ['Leyó un anuncio', 'Read an announcement'],
  'announcement.acknowledged': ['Dio acuse de un anuncio', 'Acknowledged an announcement'],
  'order.sent_to_ops': ['Envió un pedido a Operaciones', 'Sent an order to Operations'],
  'order.received': ['Recibió un pedido en Operaciones', 'Received an order in Operations'],
  'training.scheduled': ['Agendó una capacitación', 'Scheduled a training'],
  'training.done': ['Marcó una capacitación como hecha', 'Marked a training as done'],
  'training.no_show': ['Anotó que el dealer no se presentó a la capacitación', 'Recorded that the dealer missed the training'],
  'training.cancelled': ['Canceló una capacitación', 'Cancelled a training'],
  'report.taken': ['Empezó a revisar un reporte del equipo', 'Started reviewing a team report'],
  'event_subscriber.created': ['Dio de alta un suscriptor de eventos', 'Added an event subscriber'],
  'event_subscriber.status_changed': ['Pausó, reactivó o quitó un suscriptor de eventos', 'Paused, resumed or removed an event subscriber'],
  'event_subscriber.secret_rotated': ['Rotó el secreto de un suscriptor de eventos', 'Rotated an event subscriber’s secret'],
  'event_delivery.resent': ['Reenvió un evento a un suscriptor', 'Resent an event to a subscriber'],
  'api_client.rotated': ['Rotó una llave de API', 'Rotated an API key'],
  'integration.onboarding_received': ['Llegó el alta de un comercio desde la Sales App', 'A merchant’s onboarding arrived from the Sales App'],
  'integration.merchant_approved': ['Llegó la aprobación de un comercio', 'A merchant’s approval arrived'],
  'integration.dead_letter': ['Un mensaje de la Sales App quedó en mensajes muertos', 'A Sales App message went to dead letters'],
  'inbound.replayed': ['Reprocesó un mensaje detenido', 'Reprocessed a held message'],
  'csv_import.completed': ['Importó un archivo', 'Imported a file'],
  // integraciones2
  'integration.store_sales_loaded': ['Cargó las cifras de ventas por tienda', 'Loaded the store sales figures'],
  'integration.route_checkin': ['Recibió un check-in de la herramienta de rutas', 'Received a route tool check-in'],
  'load.configured': ['Cambió el responsable u horario de una carga', 'Changed a load’s owner or schedule'],
  'load.window_set': ['Cambió la ventana sin cargas de un mercado', 'Changed a market’s no-load window'],
  'document.generated': ['Generó un documento', 'Generated a document'],
  'document.emailed': ['Mandó un documento por correo', 'Emailed a document'],
  'pipedrive.backup_downloaded': ['Bajó el respaldo de Pipedrive', 'Downloaded the Pipedrive backup'],
  'market.reset_test': ['Borró y recargó un mercado de prueba', 'Wiped and reloaded a test market'],
  'csv_import.undone': ['Deshizo una importación', 'Undid an import'],
  'export.alert': ['Pasó el umbral diario de exportaciones', 'Went over the daily export threshold'],
  'saved_report.saved': ['Guardó un reporte', 'Saved a report'],
  'saved_report.deleted': ['Borró un reporte guardado', 'Deleted a saved report'],
  'saved_report.scheduled': ['Programó un reporte', 'Scheduled a report'],
  'saved_report.delivered': ['Entregó un reporte programado', 'Delivered a scheduled report'],
  'snapshot.taken': ['Tomó la foto diaria', 'Took the daily snapshot'],
  'reconciliation.ran': ['Concilió con el archivo de ventas', 'Reconciled with the sales file'],
  'agency.labels_set': ['Cambió quién cuenta como agencia', 'Changed who counts as an agency'],
  'metric.owner_set': ['Cambió quién responde por un indicador', 'Changed who answers for a metric'],
  'saved_view.saved': ['Guardó una vista', 'Saved a view'],
  'saved_view.deleted': ['Borró una vista', 'Deleted a view'],
  'saved_view.pinned': ['Fijó una vista como cola', 'Pinned a view as a queue'],
  'saved_view.unpinned': ['Quitó una cola de su menú', 'Removed a queue from the menu'],
  // Gobierno (paquete gobierno)
  'objective.set': ['Fijó un objetivo de servicio o de recuperación', 'Set a service or recovery objective'],
  'incident.opened': ['Abrió un incidente', 'Opened an incident'],
  'incident.updated': ['Actualizó un incidente', 'Updated an incident'],
  'restore_test.recorded': ['Anotó una prueba de restauración', 'Recorded a restore test'],
  'component.owners_set': ['Cambió quién responde por un componente', 'Changed who answers for a component'],
  'maintenance.scheduled': ['Agendó una ventana de mantenimiento', 'Scheduled a maintenance window'],
  'maintenance.closed': ['Cerró una ventana de mantenimiento', 'Closed a maintenance window'],
  'release.created': ['Creó una versión', 'Created a release'],
  'release.item_checked': ['Dio por cumplido un punto de la lista de salida', 'Marked a go-live checklist item as done'],
  'release.announced': ['Anunció una versión', 'Announced a release'],
  'release.released': ['Marcó una versión como liberada', 'Marked a release as released'],
  'deployment.recorded': ['Anotó un despliegue', 'Recorded a deployment'],
  'cost.added': ['Cargó un costo', 'Loaded a cost'],
  'cost.voided': ['Anuló un costo', 'Voided a cost'],
  'config_request.created': ['Pidió un cambio de configuración', 'Asked for a configuration change'],
  'config_request.decided': ['Decidió una solicitud de configuración', 'Decided a configuration request'],
  'change.reason_added': ['Anotó por qué se hizo un cambio de configuración', 'Recorded why a configuration change was made'],
  'champion.set': ['Cambió el champion de un equipo', 'Changed a team’s champion'],
  'champion.reviewed': ['Anotó la revisión mensual con un champion', 'Recorded the monthly review with a champion'],
  'material.saved': ['Guardó un material de capacitación', 'Saved a training material'],
  'material.removed': ['Quitó un material de capacitación', 'Removed a training material'],
  'session.started': ['Inició sesión', 'Signed in'],
  'session.ended': ['Cerró sesión', 'Signed out'],
  // 0027 seguridad
  'membership.areas_changed': ['Cambió qué partes administra una persona', 'Changed which parts a person administers'],
  'membership.entity_changed': ['Limitó un acceso a una entidad legal', 'Limited an access to a legal entity'],
  'membership.ended_by_directory': ['Quitó un acceso porque la cuenta de Google ya no existe', 'Removed access because the Google account no longer exists'],
  'team.parent_changed': ['Cambió de quién depende un equipo', 'Changed which team a team reports to'],
  'agency.created': ['Creó una agencia', 'Created an agency'],
  'seat.approved': ['Registró quién aprobó un asiento', 'Recorded who approved a seat'],
  // Paquete partners-contratos (0033)
  'terms.versioned': ['Guardó una versión de los términos comerciales', 'Saved a version of the commercial terms'],
  'contract.created': ['Creó un contrato desde los términos', 'Created a contract from the terms'],
  'contract.renewed': ['Creó la renovación de un contrato', 'Created a contract renewal'],
  'contract.status_changed': ['Cambió el estado de un contrato', 'Changed a contract’s status'],
  'contract.signed': ['Marcó un contrato como firmado', 'Marked a contract as signed'],
  'contract.renewal_noticed': ['Avisó que un contrato está por renovarse', 'Gave notice that a contract is due for renewal'],
  'partner.registered': ['Registró una cuenta como partner', 'Registered an account as a partner'],
  'partner.invite_queued': ['Dejó en cola la invitación de un usuario externo', 'Queued an external user invitation'],
  'partner.crossmatch_run': ['Corrió el cruce de bases de partners', 'Ran the partner base cross-match'],
  'partner_token.created': ['Creó un token de lectura de partner', 'Created a partner read token'],
  'partner_token.revoked': ['Revocó un token de lectura de partner', 'Revoked a partner read token'],
  'partner_tier.saved': ['Guardó un nivel de partner y sus criterios', 'Saved a partner tier and its criteria'],
  'partner_tier.material_added': ['Agregó material de habilitación a un nivel', 'Added enablement material to a tier'],
  'partner_tier.recalculated': ['Recalculó los niveles de partner', 'Recalculated partner tiers'],
  'plan.created': ['Creó un plan de integración', 'Created an integration plan'],
  'plan.milestone_added': ['Agregó un hito al plan de integración', 'Added a milestone to the integration plan'],
  'plan.milestone_updated': ['Cambió un hito del plan de integración', 'Changed an integration plan milestone'],
  'plan.shared': ['Pidió acceso del cliente al plan de integración', 'Requested client access to the integration plan'],
  'network_load.staged': ['Cargó una red adquirida en su espacio aparte', 'Loaded an acquired network into its separate space'],
  'network_load.legal_released': ['Dio la liberación de legal a una red adquirida', 'Gave the legal release for an acquired network'],
  'network_load.business_released': ['Dio la liberación de negocio a una red adquirida', 'Gave the business release for an acquired network'],
  'network_load.promoted': ['Pasó a la cartera un lote de una red adquirida', 'Moved a batch of an acquired network into the portfolio'],
  'network_load.rolled_back': ['Regresó un lote de una red adquirida', 'Rolled back a batch of an acquired network'],
  'activity.comm_captured': ['Registró un correo, una reunión o un mensaje en el hilo', 'Logged an email, a meeting or a message in the thread'],
  'account.team_added': ['Sumó a alguien al equipo de la cuenta', 'Added someone to the account team'],
  'account.team_removed': ['Sacó a alguien del equipo de la cuenta', 'Removed someone from the account team'],
  'sensitive_field.created': ['Creó un campo reservado', 'Created a restricted field'],
  'sensitive_field.updated': ['Cambió quién ve un campo reservado', 'Changed who sees a restricted field'],
  'sensitive.updated': ['Guardó un dato reservado', 'Saved restricted data'],
  'sensitive.revealed': ['Reveló un dato reservado', 'Revealed restricted data'],
  'consent.recorded': ['Registró un consentimiento', 'Recorded a consent'],
  'consent.revoked': ['Retiró un consentimiento', 'Withdrew a consent'],
  'consent.opted_out': ['Registró una baja de contacto', 'Recorded an opt-out'],
  'consent.opt_out_lifted': ['Levantó una baja de contacto', 'Lifted an opt-out'],
  'retention.rule_changed': ['Cambió una regla de retención', 'Changed a retention rule'],
  'retention.applied': ['Aplicó una regla de retención', 'Applied a retention rule'],
  'subject_request.created': ['Registró una solicitud de una persona sobre sus datos', 'Recorded a person’s request about their data'],
  'subject_request.updated': ['Actualizó una solicitud sobre datos personales', 'Updated a personal data request'],
  'subject_request.closed': ['Cerró una solicitud sobre datos personales', 'Closed a personal data request'],
  'subject_request.exported': ['Sacó los datos de una persona para entregárselos', 'Pulled a person’s data to hand it over'],
  'subject_request.anonymized': ['Anonimizó los datos de una persona', 'Anonymized a person’s data'],
  'view_as.started': ['Empezó a ver CONTIGO como otra persona', 'Started viewing CONTIGO as someone else'],
  'view_as.ended': ['Dejó de ver como otra persona', 'Stopped viewing as someone else'],
  'access_review.opened': ['Abrió una revisión de accesos', 'Opened an access review'],
  'access_review.decided': ['Decidió un acceso en la revisión', 'Decided an access in the review'],
  'access_review.closed': ['Cerró una revisión de accesos', 'Closed an access review'],
  'api_client.updated': ['Cambió quién responde por una llave de API o su vencimiento', 'Changed the owner or expiry of an API key'],
  'secret.updated': ['Actualizó el inventario de una conexión', 'Updated a connection’s inventory entry'],
  'security.thresholds_changed': ['Cambió los umbrales de alerta', 'Changed the alert thresholds'],
  'security.due_days_changed': ['Cambió el plazo de respuesta a solicitudes de datos', 'Changed the response period for data requests'],
  'security.alert_acknowledged': ['Revisó una alerta de seguridad', 'Reviewed a security alert'],
  // Cuidado del comercio (paquete ciclo-cs)
  'care.window_set': ['Cambió una ventana del ciclo de vida', 'Changed a lifecycle window'],
  'care.product_line_set': ['Cambió la línea de producto de un comercio', 'Changed a merchant’s product line'],
  'care.lifecycle_run': ['Recalculó las etapas de vida de un mercado', 'Recalculated a market’s lifecycle stages'],
  'care.stage_set': ['Cambió a mano la etapa de vida de un comercio', 'Changed a merchant’s lifecycle stage by hand'],
  'care.handoff_created': ['Entregó un comercio a otro equipo', 'Handed a merchant off to another team'],
  'care.handoff_checked': ['Marcó un punto de la lista de una entrega', 'Ticked an item on a handoff list'],
  'care.handoff_acknowledged': ['Dio el acuse de una entrega', 'Acknowledged a handoff'],
  'care.handoff_returned': ['Devolvió una entrega', 'Sent a handoff back'],
  'care.settings_saved': ['Cambió los números de las alertas de un mercado', 'Changed a market’s alert settings'],
  'care.playbook_saved': ['Cambió una guía de acción', 'Changed a playbook'],
  'care.alerts_run': ['Evaluó las alertas de un mercado', 'Evaluated a market’s alerts'],
  'care.alert_done': ['Atendió una alerta de un comercio', 'Handled a merchant alert'],
  'care.alert_dismissed': ['Descartó una alerta de un comercio', 'Dismissed a merchant alert'],
  'care.health_weights_saved': ['Cambió los pesos del puntaje de salud', 'Changed the health score weights'],
  'care.health_run': ['Calculó el puntaje de salud de un mercado', 'Calculated a market’s health score'],
  'care.health_validated': ['Validó el puntaje de salud contra lo que pasó', 'Validated the health score against what happened'],
  'care.health_published': ['Publicó el puntaje de salud al equipo', 'Published the health score to the team'],
  'care.health_unpublished': ['Dejó de publicar el puntaje de salud', 'Stopped publishing the health score'],
  'care.tier_rules_saved': ['Cambió las reglas del modelo de atención', 'Changed the service model rules'],
  'care.tiers_run': ['Recalculó el modelo de atención de un mercado', 'Recalculated a market’s service model'],
  'care.training_recorded': ['Registró una constancia de capacitación', 'Recorded a training completion'],
  'care.manager_changed': ['Registró un cambio de encargado', 'Recorded a manager change'],
  'care.expansion_rule_saved': ['Cambió una regla de expansión', 'Changed an expansion rule'],
  'care.expansion_run': ['Buscó oportunidades de expansión en un mercado', 'Looked for expansion opportunities in a market'],
  'care.expansion_taken': ['Tomó una oportunidad de expansión', 'Took an expansion opportunity'],
  'care.expansion_won': ['Cerró una oportunidad de expansión: el comercio aceptó', 'Closed an expansion opportunity: the merchant accepted'],
  'care.expansion_lost': ['Cerró una oportunidad de expansión: el comercio no aceptó', 'Closed an expansion opportunity: the merchant declined'],
  'care.expansion_dismissed': ['Descartó una oportunidad de expansión', 'Dismissed an expansion opportunity'],
  'care.plan_saved': ['Cambió el plan de una cuenta', 'Changed an account plan'],
  'care.relationship_saved': ['Cambió la relación por producto de una cuenta', 'Changed an account’s relationship by product'],
  'care.review_added': ['Registró una revisión de cuenta con su minuta', 'Recorded an account review with its minutes'],
  'care.feedback_added': ['Registró un comentario de producto', 'Logged product feedback'],
  'care.feedback_status_set': ['Respondió un comentario de producto', 'Answered product feedback'],
}

/** Tipos de acción para filtrar la bitácora. El valor vacío es la vista de entrada: todo menos inicios y cierres de sesión. */
export const AUDIT_GROUPS = {
  '': { label: ['Cambios (sin inicios de sesión)', 'Changes (no sign-ins)'] as Pair, like: null, not: ['session.%'] },
  access: { label: ['Accesos y equipos', 'Access and teams'] as Pair, like: ['membership.%', 'team.%', 'user.%', 'street_seller.%'], not: null },
  config: { label: ['Configuración', 'Configuration'] as Pair, like: ['pipeline.%', 'stage.%', 'routing.%', 'api_client.%', 'event_subscriber.%', 'territory.%', 'field.%', 'account_type.%', 'loss_reason.%', 'form.%', 'fx.%', 'template.%', 'comms.%', 'help.%', 'market.%', 'alias_system.%', 'process.list_%', 'quality.%', 'provider.%', 'product.%', 'rollout.%', 'entity.%', 'whatsapp.%', 'ficha.%', 'field_section.%'], not: null },
  notices: { label: ['Avisos y anuncios', 'Notices and announcements'] as Pair, like: ['announcement.%', 'notice.%'], not: null },
  // 'report.' lo comparten dos cosas distintas: lo que alguien exporta (liderazgo) y lo que el equipo reporta (contenido).
  exports: { label: ['Exportaciones', 'Exports'] as Pair, like: ['report.exported', 'export.%'], not: null },
  integrations: { label: ['Integraciones y reglas', 'Integrations and rules'] as Pair, like: ['integration.%', 'import.%', 'rules.%', 'automation.%', 'job.%', 'csv_import.%', 'inbound.%', 'event_delivery.%', 'sheet.%', 'load.%', 'pipedrive.%'], not: null },
  records: { label: ['Comercios, negocios y leads', 'Merchants, deals and leads'] as Pair, like: ['account.%', 'document.%', 'contact.%', 'deal.%', 'lead.%', 'activity.%', 'exception.%', 'order.%', 'training.%', 'duplicate.%', 'alias.%', 'process.enrolled', 'process.status_changed', 'taxid.%', 'care.%', 'terms.%', 'contract.%', 'plan.created', 'plan.milestone_%', 'plan.shared', 'partner.%', 'partner_token.%', 'partner_tier.%', 'network_load.%'], not: null },
  reports: { label: ['Problemas reportados', 'Reported problems'] as Pair, like: ['report.created', 'report.answered', 'report.taken'], not: null },
  // Paquete reportes: reportes y vistas guardadas, responsables de indicadores, foto diaria y conciliación.
  saved: { label: ['Reportes, vistas e indicadores', 'Reports, views and metrics'] as Pair, like: ['saved_report.%', 'saved_view.%', 'metric.%', 'goal.%', 'snapshot.%', 'reconciliation.%', 'agency.%'], not: null },
  security: { label: ['Seguridad y privacidad', 'Security and privacy'] as Pair, like: ['sensitive.%', 'sensitive_field.%', 'consent.%', 'retention.%', 'subject_request.%', 'view_as.%', 'access_review.%', 'security.%', 'secret.%', 'seat.%'], not: null },
  // Paquete gobierno: servicio, versiones, costos, solicitudes y motivos de cambio.
  governance: { label: ['Gobierno', 'Governance'] as Pair, like: ['objective.%', 'incident.%', 'restore_test.%', 'component.%', 'maintenance.%', 'release.%', 'deployment.%', 'cost.%', 'config_request.%', 'change.%', 'champion.%', 'material.%'], not: null },
  field: { label: ['Campo y canales', 'Field and channels'] as Pair, like: ['onboarding.%', 'threshold.%', 'channel.%', 'seller.%', 'portfolio.%', 'attribution.%', 'dispute.%', 'claim.%', 'funding.%', 'credit.%', 'competitor.%', 'plan.set', 'field_incident.%'], not: null },
  // Paquete ia: sugerencias, nivel de asistencia por mercado, borradores, pesos y evaluación.
  ia: { label: ['Sugerencias y asistencia', 'Suggestions and assistance'] as Pair, like: ['ia.%', 'recommendation.%'], not: null },
  sessions: { label: ['Inicios y cierres de sesión', 'Sign-ins and sign-outs'] as Pair, like: ['session.%'], not: null },
  all: { label: ['Todo', 'Everything'] as Pair, like: null, not: null },
} as const
export type AuditGroup = keyof typeof AUDIT_GROUPS
export const isAuditGroup = (v: string | undefined): v is AuditGroup => v !== undefined && v in AUDIT_GROUPS

/** Tipos de registro por los que se filtra, con su nombre. */
export const AUDIT_OBJECT: Record<string, Pair> = {
  contact_pair: ['Par de contactos', 'Contact pair'],
  decision: ['Decisión de negocio', 'Business decision'],
  held_lead: ['Solicitud retenida', 'Held request'],
  onboarding_file: ['Expediente de alta', 'Enrollment file'],
  threshold: ['Umbral', 'Threshold'],
  reassignment_plan: ['Plan de reparto', 'Reassignment plan'],
  attribution_dispute: ['Disputa de atribución', 'Attribution dispute'],
  channel_claim: ['Registro de canal', 'Channel registration'],
  competitor: ['Competidor', 'Competitor'],
  field_incident: ['Incidente de campo', 'Field incident'],
  recommendation: ['Sugerencia', 'Suggestion'],
  ia_settings: ['Nivel de asistencia', 'Assistance level'],
  ia_draft: ['Borrador de tarea', 'Task draft'],
  ia_eval: ['Evaluación', 'Evaluation'],
  lead_score_weights: ['Pesos de calificación', 'Scoring weights'],
  agency: ['Agencia o socio', 'Agency or partner'],
  network_load: ['Red adquirida', 'Acquired network'],
  partner_tier: ['Nivel de partner', 'Partner tier'],
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
  event_subscriber: ['Suscriptor de eventos', 'Event subscriber'],
  event_delivery: ['Entrega de un evento', 'Event delivery'],
  inbound_event: ['Mensaje recibido', 'Received message'],
  csv_import: ['Importación por archivo', 'File import'],
  import_run: ['Importación de Pipedrive', 'Pipedrive import'],
  ingest_batch: ['Archivo de ventas', 'Sales file'],
  data_load: ['Carga de datos', 'Data load'],
  assignment_rule: ['Regla de asignación', 'Assignment rule'],
  intake_retry: ['Envío de formulario retenido', 'Held form submission'],
  lead_label: ['Etiqueta de lead', 'Lead label'],
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
  template: ['Plantilla de mensaje', 'Message template'],
  announcement: ['Anuncio', 'Announcement'],
  screen: ['Pantalla', 'Screen'],
  training: ['Capacitación', 'Training'],
  product: ['Producto', 'Product'],
  legal_entity: ['Entidad legal', 'Legal entity'],
  whatsapp_account: ['Número de WhatsApp', 'WhatsApp number'],
  whatsapp_template: ['Plantilla de WhatsApp', 'WhatsApp template'],
  whatsapp_rate: ['Costo de WhatsApp', 'WhatsApp cost'],
  ficha_layout: ['Datos de arriba de la ficha', 'Top facts of the merchant page'],
  field_section: ['Sección de campos', 'Field section'],
  sheet_load: ['Carga desde la hoja', 'Load from the sheet'],
  sensitive_field: ['Campo reservado', 'Restricted field'],
  contact: ['Contacto', 'Contact'],
  suppression: ['Baja de contacto', 'Opt-out'],
  retention_rule: ['Regla de retención', 'Retention rule'],
  subject_request: ['Solicitud sobre datos personales', 'Personal data request'],
  access_review: ['Revisión de accesos', 'Access review'],
  secret: ['Conexión hacia afuera', 'Outbound connection'],
  security: ['Seguridad', 'Security'],
  security_alert: ['Alerta de seguridad', 'Security alert'],
  service_objective: ['Objetivo de servicio', 'Service objective'],
  incident: ['Incidente', 'Incident'],
  restore_test: ['Prueba de restauración', 'Restore test'],
  component: ['Componente', 'Component'],
  maintenance_window: ['Ventana de mantenimiento', 'Maintenance window'],
  release: ['Versión', 'Release'],
  deployment: ['Despliegue', 'Deployment'],
  cost_entry: ['Costo', 'Cost'],
  config_request: ['Solicitud de configuración', 'Configuration request'],
  change_reason: ['Motivo de un cambio', 'Reason for a change'],
  training_material: ['Material de capacitación', 'Training material'],
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
