# Scope against the full feature catalog (95 items)

Generated on 13-Nov-2026 by the `gobierno` package of the build program. It replaces the earlier scope note, which listed 20 pilot items and 35 foundation items and gave several as built that the audit of 12-Nov-2026 found partial.

## How to read it
- **Sources.** The catalog `CRM-catalogo-funcionalidades-2026-11-11` (95 items), the audit of 12-Nov-2026 (state before the build program) and, for every item a package of the program has already reported, that package's own result with its evidence. An item with no package report yet keeps the audited state and says so in its "Source" line.
- **Built** means the item does what the catalog says, can be used from the screen by the role it is for, in Spanish and English, at 1440 and 390 px, with database or domain tests and an end-to-end test of the main flow. Code with no screen, or a screen with no rule in the domain, does not count.
- **Built, external channel off** means everything inside CONTIGO is built and the part that talks to the outside is an adapter that is turned off until Michael Essiet or Dan Mulligan sign off (Tech Implementation Review).
- **Partial** always says exactly what is missing and who unblocks it.
- Evidence and "missing" lines are carried verbatim from the audit and the package reports, in Spanish, so nothing is reworded on the way. Status, structure and this guide are in English like the rest of `docs/`.
- The final re-audit of the 95 (same auditors, state after) supersedes this file when the program closes. Until then, regenerate it after each wave is integrated.

## Where the 95 stand
| Status | Items |
|---|---|
| Built | 5 |
| Built, external channel off | 6 |
| Partial | 52 |
| Missing | 30 |
| Not applicable | 2 |
| **Total** | **95** |

34 items carry a package report from the build program; 61 still show the audited state of 12-Nov-2026 because their package has not reported.

Check made when this file was generated: the package reports cite 169 file paths as evidence and 169 of them exist in this tree.

## By domain
| Domain | Items | Built | Built, channel off | Partial | Missing | Not applicable |
|---|---|---|---|---|---|---|
| DAT · Modelo de datos, jerarquía e identidad | 7 | 0 | 1 | 5 | 1 | 0 |
| LEAD · Captura, atribución, ruteo y SLA | 5 | 0 | 0 | 4 | 1 | 0 |
| PIPE · Pipelines, etapas, transiciones y cierre | 8 | 1 | 1 | 4 | 2 | 0 |
| ACT · Actividades, timeline y tareas | 3 | 0 | 0 | 2 | 1 | 0 |
| CAMPO · Integración con la app de campo, supervisión y alta | 8 | 0 | 1 | 4 | 3 | 0 |
| CANAL · Canal, PRM, atribución y comisiones | 8 | 1 | 0 | 1 | 5 | 1 |
| CS · Customer success B2B | 8 | 0 | 0 | 3 | 5 | 0 |
| REP · Reportes, métricas y forecast | 4 | 0 | 0 | 4 | 0 | 0 |
| AUT · Automatización, eventos e integraciones | 7 | 1 | 1 | 5 | 0 | 0 |
| IA · IA asistida, agentes y guardas | 8 | 1 | 0 | 1 | 6 | 0 |
| MULTI · Multi-país, moneda, entidad, IDs fiscales y WhatsApp | 5 | 0 | 0 | 2 | 3 | 0 |
| SEG · Seguridad, privacidad y cumplimiento | 10 | 0 | 1 | 5 | 3 | 1 |
| UX · Experiencia de uso | 4 | 0 | 0 | 4 | 0 | 0 |
| GOB · Gobierno, adopción y operación | 10 | 1 | 1 | 8 | 0 | 0 |

## Item by item

### DAT · Modelo de datos, jerarquía e identidad

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| DAT-01 | Jerarquía de cuentas de N niveles con roll-ups | Must | F1 | Partial |
| DAT-02 | Relación contacto-cuenta con rol y vigencia | Must | F1 | Partial |
| DAT-03 | ID canónico y tabla de alias de IDs externos | Must | F1 | Built, external channel off |
| DAT-04 | Deduplicación y golden record | Must | F1 | Partial |
| DAT-05 | Campos por mercado vía metadata y procesos paralelos | Must | F1 | Partial |
| DAT-06 | Kit de ingesta de red adquirida con segregación previa | Should | F2 | Missing |
| DAT-07 | Catálogo de productos y matriz de productos por PDV con estado por carrier | Should | F1 | Partial |

**DAT-01 · Jerarquía de cuentas de N niveles con roll-ups: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: ficha pestaña Árbol (totales del nodo: negocios abiertos y su monto, ganados, comercios activos, ventas 30 días; 'Movimientos en el árbol' con motivo, fechas y quién), ficha Datos 'Pertenece a' con motivo y fecha efectiva, /datos?tab=catalogos 'Niveles del árbol por tipo de cuenta'. Dominio: setParent con motivo y fecha efectiva (hoy o pasada), conserva historia, atribución y a quien la lleva; crm.account_types.max_depth con trigger crm.account_tree_depth; src/dal/datos.ts nodeTotals. Seed: ISO > agente > 2 PDV (US) y cadena > región > 2 sucursales (MX). Pruebas: tests/db/datos.test.ts 'DAT-01' (3), tests/e2e/zx-datos.spec.ts 'jerarquía con agregados' (2).
- Missing: Agregados consultables a una fecha pasada (vistas materializadas con as_of): hoy se calculan en vivo. Agregado de comisiones por nodo: el dato no existe (CANAL-05). Regla de quién lleva a los hijos al mover una cuenta: por defecto se conserva y la pantalla avisa cuando no coincide con quien lleva la matriz.
- Who unblocks or what it depends on: Yamil y Comercial deciden qué pasa con quien lleva la cuenta al moverla; CANAL-05 para comisiones

**DAT-02 · Relación contacto-cuenta con rol y vigencia: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: ficha Datos 'Contactos' (Agregar liga al contacto que ya existe por teléfono y lo dice; 'También está en'; Editar; Hacer principal; Dar de baja con motivo; 'Historia de contactos' con quién fue el principal y desde cuándo), negocio 'Personas en este negocio' (rol de un contacto en ese negocio, misma tabla). Dominio: addContactLinked, updateContact, endContact, setDealContact, endDealContact; crm.contact_primary_history la escribe un trigger; account_contacts.deal_id. Roles ofrecidos según tipo de venta. Pruebas: tests/db/datos.test.ts 'DAT-02' (3), tests/e2e/zx-datos.spec.ts 'contactos y alias' y 'personas en un negocio' (2).
- Missing: Teléfono único garantizado por la base: hoy lo cuida el dominio (liga en vez de duplicar y no deja repetirlo al editar); no hay índice único porque los datos importados y sembrados traen teléfonos repetidos. No hay fusión de contactos que ya estaban duplicados.
- Who unblocks or what it depends on: Limpieza de contactos repetidos tras la migración de Pipedrive (GOB-05) para poder poner el índice único

**DAT-03 · ID canónico y tabla de alias de IDs externos: Built, external channel off.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: ficha Datos 'IDs en otros sistemas' (Agregar ID, Cerrar con motivo, 'ID anteriores' con vigencia), /buscar encuentra por cualquier alias, /datos?tab=catalogos 'Sistemas de origen de ID' (Agregar sistema). Dominio: addAlias (choque detectado con el nombre del comercio que lo tiene, app.alias_holder), closeAlias, createAliasSystem; crm.alias_systems reemplaza el check (Sales App, Merchant ID, Pipedrive, Zoho, EMIDA, Sky, Movilway, InComm, proveedor o carrier, más los que agregue administración). Los ID de sistemas de axexo solo los toca administración; los de sistemas externos, también Operaciones y quien lidera el mercado. Bitácora alias.added y alias.closed; eventos account.alias_issued y account.alias_closed al outbox. Pruebas: tests/db/datos.test.ts 'DAT-03' (2), tests/e2e/zx-datos.spec.ts 'Operaciones agrega un ID de otro sistema...'.
- Adapter turned off: Publicación de la tabla de alias a S5: los eventos quedan en el outbox; el publicador es del paquete eventos-api (AUT-02). El ID fiscal completo no entra como alias (estándar de datos).
- Who unblocks or what it depends on: Paquete eventos-api para publicar; S5 para el contrato de datos

**DAT-04 · Deduplicación y golden record: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: /comercios (alta: aviso con llaves fuertes, motivo obligatorio), /datos?tab=duplicados (cola, comparación lado a lado, fusionar eligiendo valores, descartar par, avisos saltados, fusiones recientes con Deshacer), ficha Datos 'Fusiones'. Dominio: src/domain/accounts.ts createAccount (app.duplicate_matches: teléfono, correo, ID externo, nombre más dirección normalizados, nombre parecido; llave fuerte bloquea a quien vende; salto con motivo queda en crm.duplicate_bypasses), src/domain/datos.ts mergeAccounts (crm.merge_events: foto de los dos registros, qué se movió, regla de supervivencia por campo), undoMerge, scanDuplicates (app.scan_duplicates en lote, tarea datos.duplicate_scan), dismissPair, reviewBypass. Pruebas: tests/db/datos.test.ts 'DAT-04' (5), tests/e2e/zx-datos.spec.ts 'duplicados y registro único' (3).
- Missing: Del catálogo: llave de ID fiscal (el repositorio no captura ni cifra el ID fiscal; solo existe el índice ciego sin alimentar) y llave por geohash (ningún comercio tiene coordenadas). La importación de Pipedrive y la conversión de leads siguen con la detección anterior (teléfono y nombre); la búsqueda en lote sí alcanza esos registros después.
- Who unblocks or what it depends on: Seguridad/Legal para la captura cifrada del ID fiscal; equipo de la Sales App para que lleguen coordenadas

**DAT-05 · Campos por mercado vía metadata y procesos paralelos: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: /datos?tab=campos (registro, Proponer campo, Aprobar, Rechazar, Editar etiqueta, opciones y gobierno, Archivar; vistas Vigentes, Sin decisión, Propuestas, Archivados), /datos?tab=catalogos (Mercados: agregar y abrir; Formularios web: crear y pausar; Turnos de leads: crear y pausar; Listas de proceso por mercado: crear y retirar), ficha Datos 'Procesos' (poner al comercio en una lista, cambiar estado y sus datos). Dominio: src/domain/gobierno.ts proposeField, decideField, updateField, createMarket, updateMarket, createWebForm, createRoutingRule, createProcessList, setProcessStatus. Índices GIN sobre custom de comercios, negocios y leads. Pruebas: tests/db/datos.test.ts 'DAT-05 / GOB-01' (4), tests/e2e/zx-datos.spec.ts 'campos, mercados y catálogos' (2).
- Missing: Validación de los valores con JSON Schema (hoy validación de tipo en el dominio). Mecanismo asistido para promover un campo a columna (sigue siendo una migración). Crear campos de contacto y de actividad desde la pantalla (el registro los muestra; se crean para comercio, negocio y lead).
- Who unblocks or what it depends on: Decisión de arquitectura (Dan Mulligan o Michael Essiet) sobre JSON Schema y promoción a columna

**DAT-06 · Kit de ingesta de red adquirida con segregación previa: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `partners-contratos` of the program has not reported yet.
- Evidence: No hay kit de ingesta. Lo único reutilizable: la importación de Pipedrive (src/domain/pipedrive/, crm.import_runs e import_raw, reanudable), los sistemas 'emida', 'sky' y 'movilway' en account_aliases, y accounts.legal_entity_id (columna sin uso en src/).
- Missing: Todo el ítem: import genérico con mapeo guardado, mapeo de IDs a alias, carga del subárbol, atribución de origen 'conversión de red', dedupe contra la base, reporte de calidad por nodo y visibilidad segregada por entidad legal hasta la liberación de legal y negocio.
- Who unblocks or what it depends on: DAT-01, DAT-03, DAT-04, CANAL-03; SEG (segregación por entidad legal); liberación legal por red (legal y negocio)

**DAT-07 · Catálogo de productos y matriz de productos por PDV con estado por carrier: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: ficha Datos 'Productos y proveedores' (estado Solicitado, Enviado al proveedor, Aprobado, Activo, Rechazado, Suspendido, con fechas y 'Fuera del plazo de N días'; Operaciones agrega y cambia), /datos?tab=productos (proveedores con plazo editable, en espera y fuera de plazo; catálogo por mercado con proveedor; matriz filtrable por mercado, proveedor, estado y plazo; 'Activos que no lo tienen' como base de expansión). Modelo único: crm.account_products con historia en crm.account_product_events; un trigger en crm.deal_ops_checks (lo que Operaciones marca en el negocio) escribe la misma matriz. Reloj por proveedor en crm.ops_catalog.sla_days. Pruebas: tests/db/datos.test.ts 'DAT-07' (3), tests/e2e/zx-datos.spec.ts 'productos por comercio' (2).
- Missing: Entidad legal del producto: la columna existe, sin pantalla. La base de expansión es una lista de a quién ofrecerle el producto; no abre negocios de expansión. El filtro por producto está en Datos, no en la lista de Comercios.
- Who unblocks or what it depends on: Operaciones de US y MX para cargar el catálogo real de productos, proveedores y plazos

### LEAD · Captura, atribución, ruteo y SLA

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| LEAD-01 | Prospecto dentro del objeto cuenta | Must | F1 | Partial |
| LEAD-02 | Captura multicanal con atribución (UTM, click IDs, CTWA) | Should | F1 | Partial |
| LEAD-03 | Ruteo y asignación | Must | F1 | Partial |
| LEAD-04 | SLA de primer contacto con escalamiento | Should | F2 | Partial |
| LEAD-05 | Referidos comercio a comercio con atribución | Could | F2 | Missing |

**LEAD-01 · Prospecto dentro del objeto cuenta: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: Camino directo construido: src/domain/accounts.ts:createAccount crea la cuenta en lifecycle 'prospect' con nombre, canal, teléfono E.164 y ciudad, con dedupe en línea; src/domain/deals.ts:createDeal abre el negocio como hijo de la cuenta. El ciclo de vida solo lo mueve el dominio (ingestStore, ingestMetricsFile). Pero el producto también tiene un objeto lead aparte (crm.leads) con conversión: src/domain/leads.ts:convertLead crea cuenta, contactos, atribución y negocio. Pantallas: /leads, /leads/<id>, /comercios. Prueba: tests/db/domain.test.ts 'un lead no se convierte sin calificar; al convertir nace cuenta, contacto, atribución, deal y tarea'.
- Missing: El ítem pide un solo registro (el prospecto es la cuenta) y marca como 'don't' el doble registro lead + cuenta. CONTIGO hace lo contrario para formularios web y altas a mano de leads: nace un lead y luego se convierte. Falta decidir y, si manda el catálogo, unificar: que el formulario cree la cuenta en estado prospecto y que la bandeja de leads sea una vista de cuentas prospecto.
- Who unblocks or what it depends on: Decisión de Yamil: el catálogo (LEAD-01) contradice los requerimientos v1 (E3.F1: las solicitudes web llegan como leads, nunca como negocios; E16.F11 sigue abierto)

**LEAD-02 · Captura multicanal con atribución (UTM, click IDs, CTWA): Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: Columnas en crm.leads: utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, consent_at, consent_text (0012). src/domain/leads.ts:intakeFromForm las guarda al crear y una segunda solicitud no las sobrescribe (repeatRequest). Pantalla: /leads/<id> 'De dónde vino' y 'Consentimiento'. Origen comercial: leads.source (web_form, walk_in, referral, phone_in, event, manual) y capa 'origin' en account_attributions.
- Missing: 1) lead_source_touch append-only con primer y último toque: solo se guarda el primero, el último toque no queda en ningún lado. 2) ctwa_clid (Click to WhatsApp), QR del PDV y referido como origen técnico. 3) Página y referrer. 4) El origen técnico no pasa del lead a la cuenta ni al negocio al convertir. 5) F2: devolución de eventos a Meta (QualifiedLead, Purchase) con idempotencia; no hay worker ni publicador.
- Who unblocks or what it depends on: AUT-02 (publicador del outbox), PIPE-06 (primera transacción), CANAL-03; Martech para los parámetros del sitio

**LEAD-03 · Ruteo y asignación: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: crm.routing_rules + app.rr_next (turno rotativo atómico; 0012: nunca entrega a quien no vende en el mercado, respaldo, o queda sin dueño visible al mercado). src/domain/leads.ts:intakeFromForm asigna por la regla del formulario; assignLead, takeLead, passLead, releaseLead. Bitácora de cada asignación (lead.created con owner_id, lead.assigned). Pantalla: /admin?tab=entrada 'Formularios y turnos' (visto: 3 formularios, turnos con conteo de 30 días). Pruebas: tests/db/domain.test.ts 'el formulario web reparte por turno y es idempotente'; tests/e2e/flows.spec.ts 'el turno de un formulario se cambia desde administración'.
- Missing: 1) Reglas ordenadas con condición y acción (assignment_rule priority/condition/action): hoy hay una regla fija por formulario; la estrategia 'territory' existe en el check pero rr_next la trata igual que el turno. 2) Herencia del dueño del nodo padre antes que el turno (el PDV de una cadena atendida va al KAM): no existe; createAccount pone de dueño a quien captura. 3) Ruteo por territorio y por canal. 4) 'Tienda saturada': sugerencia al supervisor para pasar al canal indirecto. 5) Ruteo de cuentas que nacen por Sales App o importación (solo se rutean leads web).
- Who unblocks or what it depends on: DAT-01 (árbol), CAMPO-03 (territorios), PIPE-04 (motivo saturada); reglas de dueño de largo plazo (liderazgo comercial, requerimiento E16.F1 abierto)

**LEAD-04 · SLA de primer contacto con escalamiento: Partial.**
- Source: package `automatizaciones`, 13-Nov-2026.
- Evidence: Escalamiento del primer contacto en dos niveles, configurable por mercado en /admin/automatizaciones?v=leads (crm.lead_escalation; nace apagado): al vencer la meta sin intento, tarea en Hoy para supervisión; N horas hábiles después, para quien lidera. Visible en la guardia de leads de /supervisor ('Avisado a supervisión' / 'Avisado a quien lidera'). Corre por horario (job automatizaciones.escalamiento), no repite, se reinicia si el reloj vuelve a empezar y cierra sus avisos con el primer intento. Reasignación al vencer disponible como automatización (plantilla 'lead_overdue_reassign', en pausa). Pruebas: tests/db/automatizaciones.test.ts 'LEAD-04...' (3, incluida la reasignación); E2E zx-automatizaciones.
- Missing: 1) El reloj se sigue deteniendo con el primer intento, no con el contacto efectivo. 2) Zona horaria y calendario son los del mercado, no los del punto de venta; sin días feriados. 3) No hay tabla genérica de relojes para otras metas. 4) La línea base de 4 semanas en dealers antes de fijar la meta es una decisión de negocio. 5) El aviso solo llega dentro de CONTIGO.
- Adapter turned off: Correo, Slack y push (del paquete avisos)
- Who unblocks or what it depends on: Quien lidera ventas US (meta con línea base); Dan Mulligan o Michael Essiet (canales de aviso)

**LEAD-05 · Referidos comercio a comercio con atribución: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: Solo existe 'referral' como valor de origen de un lead a mano (src/domain/leads.ts:MANUAL_SOURCES). No guarda quién refirió.
- Missing: Todo el ítem: código o QR de referido por PDV, comercio referente ligado al referido, capa de atribución del referente, y recompensa que se dispara con la primera transacción del referido.
- Who unblocks or what it depends on: PIPE-06, CANAL-03, CANAL-05; reglas del programa (comercial)

### PIPE · Pipelines, etapas, transiciones y cierre

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| PIPE-01 | Pipelines por motor con criterios de salida y campos por etapa | Must | F1 | Partial |
| PIPE-02 | Transiciones con dueño, evidencia y SLA (tipo Blueprint) | Should | F1 | Built, external channel off |
| PIPE-03 | Rotting y estancamiento | Should | F1 | Built |
| PIPE-04 | Motivos de pérdida y de no-venta codificados | Must | F1 | Partial |
| PIPE-05 | Revisita al decisor visible en el embudo | Must | F1 | Partial |
| PIPE-06 | Cierre por evento transaccional (primer fondeo, primera transacción) | Must | F1 | Partial |
| PIPE-07 | Oferta comercial y contrato como objeto (CPQ-lite) | Should | F2 | Missing |
| PIPE-08 | Plan de integración compartido para KAM (mutual action plan) | Could | F2 | Missing |

**PIPE-01 · Pipelines por motor con criterios de salida y campos por etapa: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: crm.pipelines y crm.stages (required_fields, exit_es/exit_en, rot_days) como datos. Regla en un solo lugar: src/domain/deals.ts:missingForStage, aplicada en moveDeal (suma lo que piden las etapas que se saltan) y createDeal. Administración crea embudos y etapas y edita requisitos: src/domain/b2b.ts:createPipeline/createStage, src/domain/admin.ts; pantalla /admin?tab=embudos (visto: 5 embudos: MX d2d, MX b2b, US dealer, US orders, SV b2b). Pruebas: tests/db/domain.test.ts 'la etapa exige sus campos y perder exige motivo codificado'; tests/e2e/flows.spec.ts 'una etapa no deja entrar sin lo que pide: monto, decisor y próximo paso'.
- Missing: 1) 'En toda vía de escritura': la regla vive solo en el dominio. La base no la impone (no hay fn_move_stage ni se revoca el update de stage_id a contigo_app) y la importación de Pipedrive escribe etapas sin validar requisitos. 2) Un embudo por motor con variaciones de país por metadata: hoy el embudo es por mercado y motor (el 'don't' del ítem). 3) Requisitos condicionales por etapa (los campos tienen applies_when, los requisitos no). 4) En D2D los requeridos no llegan del evento de la Sales App.
- Who unblocks or what it depends on: CAMPO-01 (conexión viva con la Sales App); decisión de arquitectura: embudo global por motor o por mercado (Yamil con Dan)

**PIPE-02 · Transiciones con dueño, evidencia y SLA (tipo Blueprint): Built, external channel off.**
- Source: package `automatizaciones`, 13-Nov-2026.
- Evidence: Pasos de etapa como datos (crm.stage_transitions: de, a, quién puede, evidencia requerida, aprobación con aprobador por rol o persona, suplente y plazo en horas hábiles) en /admin/automatizaciones?v=pasos. Evidencia como enlace con nota (crm.deal_evidence) y aprobación en la ficha del negocio (/deals/<id>, tarjeta 'Evidencia y aprobaciones'): quien pide ve 'Esperando aprobación de X', al aprobador le llega a Hoy, vencido el plazo pasa al suplente (job automatizaciones.escalamiento), todo en bitácora. Meta de tiempo por etapa (stages.sla_hours) con reloj en la ficha y escalamiento por la plantilla 'Meta de etapa vencida'. Acciones posteriores: automatizaciones por evento 'un negocio cambia de etapa'. Una sola función mueve etapas (moveDealTx). Pruebas: tests/db/automatizaciones.test.ts 'PIPE-02...' (6); E2E zx-automatizaciones.
- Missing: La evidencia es un enlace con nota, no un archivo con hash: el almacenamiento de archivos está apagado y los documentos de identidad y bancarios siguen prohibidos en CONTIGO. No hay pasos preconfigurados (alta de dealer, crédito ACH).
- Adapter turned off: Almacenamiento de archivos (sin adaptador en este paquete: la evidencia es enlace)
- Who unblocks or what it depends on: Comité, decisión 9 sobre la bóveda de documentos; Dan Mulligan o Michael Essiet para el almacenamiento

**PIPE-03 · Rotting y estancamiento: Built.**
- Source: package `automatizaciones`, 13-Nov-2026.
- Evidence: Estancamiento por horario: job automatizaciones.reglas cada 15 min (corridas en /admin/automatizaciones?v=tareas). Umbral por etapa editable (/admin?tab=embudos, ya existía) más plazo propio cuando se espera a un tercero (stages.rot_days_waiting, en /admin/automatizaciones?v=pasos). Incluye etapas de Operaciones (definición 'stalled_ops'; el aviso es de quien lo lleva en Operaciones). Respeta 'En pausa'. Campo 'A quién se espera' en la ficha del negocio (deals.waiting_on). Genera aviso (excepción) o tarea según la automatización (plantilla 'stalled_task'). El umbral de 'alta sin primera venta' ya es un valor editable de su definición. Pruebas: tests/db/automatizaciones.test.ts 'PIPE-03...' (3); E2E zx-automatizaciones.
- Missing: La espera distingue 'a nosotros', 'al cliente' y 'a un tercero'; no hay catálogo de operadores (DAT-07). 'Alta sin primera venta' usa los días escritos en su automatización (7), no el campo de días de la etapa.

**PIPE-04 · Motivos de pérdida y de no-venta codificados: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: crm.loss_reasons (code, kind lost/no_sale, etiquetas ES/EN, mercado, motors). Obligatorio al perder: check en crm.deals y src/domain/deals.ts:moveDeal (valida que el motivo sea del embudo). Obligatorio en visita sin venta: src/domain/followup.ts:assertNoSaleReason; la Sales App manda el código en el evento (ingestVisit lo valida). Administración agrega motivos y decide en qué embudos se ofrecen (createLossReason). Pantalla: /admin?tab=embudos 'Motivos de pérdida por embudo' y 'Motivos codificados'. Pruebas: tests/e2e/flows.spec.ts 'cerrar como perdido exige motivo y queda en el panel'; tests/db/b2b.test.ts 'cada embudo ofrece los motivos de su tipo de venta y el dominio no acepta los de otro'.
- Missing: 1) Catálogo corto y cerrado: hoy hay 19 motivos de pérdida y 5 de no-venta; D2D en MX ofrece 14 de pérdida (6 globales + 8), sin tope de 2 extensiones por mercado. 2) Versión del catálogo. 3) Publicar el catálogo a la Sales App: no hay API de lectura; un código que CONTIGO no conoce se guarda como nulo sin aviso (ingestVisit), así que pueden divergir. 4) Custodia de C1 con cambios trimestrales (hoy cualquier administración agrega).
- Who unblocks or what it depends on: AUT-04 (API de lectura) y CAMPO-01 (Sales App); C1 para recortar el catálogo

**PIPE-05 · Revisita al decisor visible en el embudo: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: Evento de la Sales App: src/domain/integrations.ts:ingestVisit marca en los negocios abiertos revisit_needed, revisit_reason y revisit_due (día de la visita + 2). Visita a mano con resultado 'Hay que volver': src/domain/followup.ts:applyVisitOutcome y la hoja pide el próximo paso (visita por hacer con fecha y dueño). Tablero: distintivo 'Revisita a quien decide' y conteo (/pipelines, visto: 10 con revisita). Cola: regla revisit_due ('Revisita pendiente a quien decide' en /supervisor, 13 abiertas). El negocio guarda quien decide como contacto de la cuenta (decision_maker_id, decision_maker_met). Pruebas: tests/db/domain.test.ts 'la revisita queda en el deal, la visita con decisor la limpia, y repetir el evento no duplica'; tests/e2e/flows.spec.ts 'una visita sin decisor que llega de la Sales App marca la revisita en el deal'.
- Missing: 1) El evento de la Sales App no trae ni guarda los datos del decisor (nombre, rol, teléfono, mejor horario): no existe decision_maker_contact en el contrato y el consumidor no crea el contacto. 'Mejor horario' no existe en ningún lado. 2) El evento no crea una tarea de revisita con dueño: solo marca el negocio; la tarea nace solo en la captura a mano. 3) Si el comercio no tiene negocio abierto, la revisita se pierde (el update no toca nada). 4) KPI visitas por alta. 5) Meta y costo de 'no estaba el decisor' (línea base del piloto).
- Who unblocks or what it depends on: CAMPO-01 y contrato sales-app-events-v1 (equipo de la Sales App); DAT-02

**PIPE-06 · Cierre por evento transaccional (primer fondeo, primera transacción): Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: src/domain/integrations.ts:ingestMetricsFile (POST /api/v1/metrics/daily): idempotente por checksum del archivo, cuarentena si el tamaño cambia más de 20%, gana el negocio con la fecha de first_txn_at (closed_by 'transaction'), activa el comercio y crea la entrega a Operaciones. moveDeal rechaza ganar a mano cuando el embudo cierra por transacción ('won_by_transaction'). Ciclo de vida active/at_risk/inactive desde S5. Pruebas: tests/db/domain.test.ts 'la primera transacción gana el deal con la fecha de la transacción, una sola vez'; tests/e2e/flows.spec.ts 'la primera transacción de S5 gana el deal, activa el comercio y abre el handoff'. En los datos: 211 negocios ganados por transacción.
- Missing: 1) Primer fondeo: no hay first_funding_at, ni etapa 'fondeado', ni método de fondeo (efectivo, SPEI, ACH, Pix). 2) habit_at como estado aparte. 3) Correcciones como evento compensatorio: un archivo corregido del mismo corte sobrescribe las cifras (queda en bitácora, pero un negocio ya ganado no se revierte). 4) Manifiesto del archivo. 5) No hay conexión viva con S5: el endpoint y el contrato están propuestos. 6) El cierre por transacción se puede apagar por embudo (configurePipeline) y entonces se gana a mano.
- Who unblocks or what it depends on: S5 (Roxanna, Mauricio): contrato merchant-metrics-daily-v1 con fondeo y método; AUT-06; decisión de Yamil sobre qué embudos pueden ganarse a mano

**PIPE-07 · Oferta comercial y contrato como objeto (CPQ-lite): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `partners-contratos` of the program has not reported yet.
- Evidence: No hay objeto de términos comerciales. Lo más cercano: campos de texto b2b_commission y b2b_settlement en la cuenta (0016, solo MX B2B, sección 'terms') y líneas de producto por negocio (crm.deal_items) en pedidos.
- Missing: Todo el ítem: commercial_terms versionado por cuenta y entidad (comisión por producto, prepago o crédito ACH, fees, NDA, vencimientos, renovaciones), propuesta y contrato generados desde el registro, firma electrónica comprada, y términos que alimentan atribución y statements.
- Who unblocks or what it depends on: DAT-07, CANAL-05, decisión #9 (bóveda de documentos); Tech Implementation Review para el proveedor de firma (Dan o Michael)

**PIPE-08 · Plan de integración compartido para KAM (mutual action plan): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `partners-contratos` of the program has not reported yet.
- Evidence: No hay plan de hitos. Lo más cercano: el embudo MX B2B tiene etapas Integración, Pruebas y Certificación, y la lista de próximos pasos B2B incluye kickoff, pruebas y certificación (src/domain/followup.ts:NEXT_SETS.b2b). Un negocio lleva un solo próximo paso por carril.
- Missing: Todo el ítem: plantilla de hitos (specs, sandbox, certificación) ligada al negocio KAM, tareas con dueño incluidas las del cliente y las de P&T, vista compartida con el cliente y medición de días a certificación.
- Who unblocks or what it depends on: SEG (identidad y permisos de externos), ADR-004; proceso de certificación (líder B2B y P&T)

### ACT · Actividades, timeline y tareas

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| ACT-01 | Timeline único con actividades y notas de primera clase | Must | F1 | Partial |
| ACT-02 | Próximo paso obligatorio | Must | F1 | Partial |
| ACT-03 | Captura de comunicaciones (email, calendario, WhatsApp) | Should | F2 | Missing |

**ACT-01 · Timeline único con actividades y notas de primera clase: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: crm.activities (nota, llamada, reunión, tarea, correo, entrega, sistema, visita; con source) y crm.visits (Sales App). src/dal/accounts.ts:getAccount arma un solo hilo con actividades, visitas de la Sales App, cambios de etapa y cambios de dueño. La historia es de la cuenta: reasignar y fusionar no la mueven de lugar; al convertir un lead su historia pasa a la cuenta. Reportable: /reportes/campo cuenta visitas (crm.visit_log sin duplicar Sales App y captura a mano). Pantalla: /comercios/<id> pestaña Hilo (visto). src/domain/activities.ts:recordActivity.
- Missing: 1) Roll-up por jerarquía: el hilo de una cadena solo muestra lo de esa cuenta, no lo de sus sucursales. 2) Tickets (Zendesk) y resumen semanal de S5 como entradas del hilo. 3) Tabla append-only y particionada por mes: las actividades se actualizan en sitio (done_at, kind, subject) y no hay partición. 4) visibility_class por actividad. 5) Retención definida. 6) El hilo corta en 60 entradas sin paginar.
- Who unblocks or what it depends on: DAT-01, CS (Zendesk), REP-04 (S5); política de retención (Yamil)

**ACT-02 · Próximo paso obligatorio: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `embudo` of the program has not reported yet.
- Evidence: src/domain/deals.ts: createDeal exige próximo paso con fecha; missingForStage lo exige al entrar a toda etapa abierta; syncDealStep lo guarda como tarea real del responsable (llega a Hoy). Regla no_next_step (sin paso o vencido hace más de 2 días) en src/domain/rules.ts; /supervisor muestra 'sin próximo paso' por persona (9 abiertas). Completar una tarea, visita o llamada pide qué sigue (src/domain/queue.ts:completeItem, recordActivity). Pruebas: tests/db/domain.test.ts 'un próximo paso sin fecha no se guarda'; tests/e2e/flows.spec.ts 'arreglar el problema cierra la excepción sola: poner próximo paso la quita de la cola'.
- Missing: 1) 'Todo registro abierto': la regla solo cubre negocios; un lead ya contactado o una cuenta en alta sin negocio pueden quedar sin tarea siguiente y sin aviso. 2) Reporte de próximos pasos a más de 60 días: no existe y la fecha admite hasta 366 días (el 'don't' de fechas lejanas para callar la alerta). 3) En D2D el evento de visita de la Sales App no genera el próximo paso. 4) Vista 'sin próximo paso' como lista propia (hoy es un conteo y avisos en la cola).
- Who unblocks or what it depends on: PIPE-05, CAMPO-01

**ACT-03 · Captura de comunicaciones (email, calendario, WhatsApp): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `partners-contratos` of the program has not reported yet.
- Evidence: No hay sincronización de correo, calendario ni WhatsApp. Existe el tipo de actividad 'email' para registrar a mano y enlaces wa.me que abren WhatsApp sin registrar nada (src/app/(app)/leads/[id]/page.tsx). README: ninguna integración viva salvo la importación de Pipedrive. docs/scope.md deja fuera el buzón de WhatsApp.
- Missing: Todo el ítem: sync unidireccional de correo y calendario hacia actividades (solo hilos con contactos conocidos), WhatsApp por Cloud API o BSP ligado por teléfono E.164, ventana de 24 h visible, escaneo de datos sensibles en el texto y tokens con alcance mínimo y monitoreo.
- Who unblocks or what it depends on: DAT-02 (contactos con teléfono único), SEG (tokens y consentimiento), CANAL (WhatsApp); Tech Implementation Review (Dan o Michael)

### CAMPO · Integración con la app de campo, supervisión y alta

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CAMPO-01 | Contrato de eventos CRM y Sales App, un solo creador de PDV | Must | F1 | Built, external channel off |
| CAMPO-02 | Next best store y frecuencias por segmento | Should | F2 | Missing |
| CAMPO-03 | Cartera, territorios y reasignación | Must | F1 | Partial |
| CAMPO-04 | Tablero del supervisor y cola de excepciones | Must | F1 | Partial |
| CAMPO-05 | KPIs de campo con trust score de visita | Should | F2 | Partial |
| CAMPO-06 | Expediente de alta y mesa de control | Must | F1 | Partial |
| CAMPO-07 | Inteligencia competitiva en el PDV | Should | F2 | Missing |
| CAMPO-08 | Score 'PDV perfecto' consumido desde la Sales App | Could | F2 | Missing |

**CAMPO-01 · Contrato de eventos CRM y Sales App, un solo creador de PDV: Built, external channel off.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: POST /api/v1/events/sales-app recibe visit.checked_out, store.created, onboarding.submitted y merchant.approved (src/domain/integrations.ts). Un solo creador de PDV: se busca por ID de Sales Core, luego por teléfono en el mercado, y solo entonces se crea; quien llega segundo se liga. Mensajes fuera de contrato o de un punto de venta desconocido quedan detenidos con motivo y se reprocesan. Pantalla /admin/integraciones?tab=sales-app: matriz de campos, eventos, simulador y mensajes detenidos. docs/contracts/sales-app-events-v1.md (matriz generada) y sales-app-events-v1.schema.json. Pruebas: tests/db/eventos-api2.test.ts (2 casos), tests/e2e/zx-eventos-api.spec.ts (1 caso).
- Missing: Lo que no depende del código: firmar el contrato con el equipo que lleva la Sales App y Sales Core, y conectar su sistema con una llave events:write. La primera transacción sigue llegando por el archivo diario de ventas, no como evento.
- Adapter turned off: conexión real con la Sales App (no hay adaptador saliente: es una entrada con llave)
- Who unblocks or what it depends on: Dan Mulligan (equipo de la Sales App y Sales Core)

**CAMPO-02 · Next best store y frecuencias por segmento: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: No existe store_priority ni publicación a la Sales App (sin tabla en db/migrations, sin API de lectura). Lo más cercano: Hoy muestra hasta 5 'Sugerido por CONTIGO' con su razón (src/dal/queue.ts SUGGESTED_PER_DAY, observado con marco.pena), que salen de las excepciones, no de una prioridad por PDV.
- Missing: store_priority(account_id, date, score, reasons, holdout) con reglas explicables; 3 a 4 segmentos con frecuencia; publicación por API o evento a la Sales App; holdout por territorio desde el inicio.
- Who unblocks or what it depends on: CAMPO-01 conectado; AUT-04 (API de lectura) o AUT-02 (eventos salientes); segmentos y frecuencias definidos por ventas; datos de S5

**CAMPO-03 · Cartera, territorios y reasignación: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: Código: src/domain/reparto.ts (reassignAccounts, reassignByFilter por lotes de 500, previewAccounts, reassignLeads, reassignDeals, takeAccount, setTerritory y setTerritoryByFilter) y src/domain/territories.ts. Pantallas: /comercios?repartir=1 (ana.robles: filtros por quién lo lleva, equipo, plaza, territorio), /supervisor 'Reasignar cartera' y 'Por repartir' (fernando.ibarra), /admin?tab=territorios (4 territorios MX con personas). Pruebas: tests/db/reparto.test.ts 'el comercio se va con sus negocios, sus tareas y sus pendientes abiertos, y la atribución anterior queda con fecha'; tests/e2e/reparto.spec.ts; tests/e2e/campo.spec.ts 'reasignar un comercio pide confirmación, dice qué se va con él'. La historia se conserva: la capa owner se cierra con fecha, el origen no cambia y queda evento en la bitácora.
- Missing: 1) Canal como eje de asignación separado (no hay channel_assignment; solo territorio geográfico). 2) Polo con dueño (territory_owner): user_territories es una relación sin rol. 3) reassignment_plan en borrador con diff previo: hoy hay conteo previo (comercios, negocios, tareas) y confirmación, sin plan guardado ni vista previa del cambio de visibilidad (don't del ítem). 4) Separar captación (hunter) de mantenimiento (farmer). 5) La aplicación va por lotes de 500, cada uno en su transacción, no en una sola.
- Who unblocks or what it depends on: Ventas: definición de polos y de hunter/farmer; ADR-003 (visibilidad)

**CAMPO-04 · Tablero del supervisor y cola de excepciones: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: Pantalla: /supervisor con fernando.ibarra (tabla por persona con leads, negocios, revisitas, visitas con venta, ventas 30 días y cartera; guardia de leads; 'Pendientes del equipo' con 66 abiertos por tipo; Descartar con motivo). Código: src/domain/rules.ts:evaluateRules (9 tipos; abre y cierra sola), resolveException; tabla crm.exceptions con owner_id, opened_at, resolved_at, resolution. Pruebas: tests/db/domain.test.ts 'reglas (CAMPO-04, CS-03)'; tests/e2e/campo.spec.ts 'descartar un pendiente del equipo pide confirmación, guarda el motivo'.
- Missing: 1) Excepción de saldo bajo (el archivo de S5 no trae saldo). 2) Excepción de reps bajo plan (no hay metas ni cuotas). 3) Reglas en metadata con rule_id y rule_version: hoy son SQL en código con umbrales fijos (ACTIVATION_GRACE_DAYS=7, AT_RISK_BELOW_ACTIVE_DAYS=5); solo los días de estancamiento por etapa se editan en Administración. 4) Calibración de umbrales. 5) Dueño en toda excepción: las de registros sin asignar salen 'Sin asignar'.
- Who unblocks or what it depends on: CANAL-07 (saldo desde S5); metas por rep (ventas); S5 conectado

**CAMPO-05 · KPIs de campo con trust score de visita: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantalla /reportes/indicadores-campo: visitas por día, cobertura de cartera, efectividad y visitas por alta, por persona y total, con la señal de confianza a la vista (confirmadas por la Sales App, registradas a mano, fuera de la cuenta por señal baja). Columnas crm.visits.trust_score y trust_flags listas; una visita con señal menor a 50 no cuenta. Definiciones fieldPerDay, fieldCoverage, fieldEffect, fieldPerStore y fieldTrust en metric-defs con Ventas como responsable. Pruebas: tests/db/reportes.test.ts ('los indicadores de campo separan visitas confirmadas por la Sales App de las registradas a mano y dejan fuera las de señal baja'); tests/e2e/zx-reportes.spec.ts ('indicadores de campo con la señal de confianza').
- Missing: 1) La Sales App no manda trust_score ni trust_flags: el contrato de eventos no los trae y src/domain/integrations.ts no los lee todavía (las columnas existen; hoy ninguna visita se excluye). 2) Cumplimiento de ruta y distribución numérica no se construyeron: no hay rutas planeadas en CONTIGO. 3) El umbral de 50 es un valor por defecto sin acordar con Ventas.
- Who unblocks or what it depends on: Equipo de la Sales App (enviar la señal de confianza en el evento de visita); Ventas (umbral y definiciones)

**CAMPO-06 · Expediente de alta y mesa de control: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: Pantallas: /operaciones con tom.reyes (15 en cola; por negocio '3 documentos por recibir, 2 proveedores sin respuesta, capacitación pendiente', Tomar) y /deals/[id] sección Operaciones (Tomar, Devolver a Ventas con motivo, aprobación por proveedor, estado de cada documento con enlace, capacitación, Merchant ID). Código: src/domain/ops.ts (takeDeal, setOpsCheck, setTraining, setMerchantRef), tablas crm.ops_catalog y crm.deal_ops_checks, trigger app.deals_ops_guard (0015). Pruebas: tests/db/operaciones.test.ts 'entrega de Ventas a Operaciones, cola y devolución'; tests/e2e/zx-operaciones.spec.ts. En B2B MX la ficha tiene sección 'Expediente' con estado por documento (campos b2b_doc_*, 0016).
- Missing: 1) Expediente digital capturado una vez: hoy solo se guarda el estado y un enlace; el documento, el tax ID y los datos de crédito viven fuera. 2) Formulario maestro por país que alimente carriers y crédito. 3) Captura en la Sales App o por link autenticado. 4) Bóveda: bucket privado, URLs firmadas cortas, document(pii_class, hash, retention_until) y log de lectura. 5) Autoaprobación por reglas para prepago. 6) Medición visita a aprobación y aprobación a primera transacción. 7) En los datos sintéticos MX no tiene etapa de Operaciones configurada (cola MX vacía con valeria.soto).
- Who unblocks or what it depends on: Decisión #9 del comité sobre la bóveda de documentos (docs/scope.md); acuerdo con Sales Core para no tener dos bóvedas; SEG (clasificación y retención de PII)

**CAMPO-07 · Inteligencia competitiva en el PDV: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: No hay account_competitor ni captura en visita o alta. Lo único: campo de texto libre b2b_competitors 'Plataformas que usa hoy' en cuentas B2B de MX (migración 0016; visto vacío en la ficha con diana.cruz) y el motivo de pérdida 'competitor'.
- Missing: account_competitor(account_id, competitor, observed_at, source) con catálogo de competidores; captura en la visita y en el alta para D2D y dealers (incluidas las pestañas abiertas del dealer); uso en ruteo a canal indirecto y alertas de pérdida de share. El campo actual es texto libre sin fecha ni fuente, lo que el ítem pide evitar.
- Who unblocks or what it depends on: Catálogo de competidores (ventas); CAMPO-01 si se captura en la Sales App

**CAMPO-08 · Score 'PDV perfecto' consumido desde la Sales App: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: Sin rastro en código ni en el contrato: visit.checked_out v1 (src/domain/integrations.ts:visitEvent) no trae checklist ni score, y crm.visits no tiene dónde guardarlo.
- Missing: Checklist de 5 a 7 ítems evaluado en la Sales App que viaje en el evento de visita; columnas de score y fecha en CONTIGO; uso en excepciones y en salud.
- Who unblocks or what it depends on: Sales App construya el checklist (sin verificar que exista); CAMPO-01 conectado; CS-02

### CANAL · Canal, PRM, atribución y comisiones

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CANAL-01 | Portal de partners con visibilidad por subárbol | Should | F2 | Missing |
| CANAL-02 | Registro de PDV u oportunidad y reglas de compromiso | Should | F2 | Missing |
| CANAL-03 | Atribución en 3 capas con fecha efectiva | Must | F1 | Partial |
| CANAL-04 | Motor de comisiones y residuales | Won't | F3 | Not applicable |
| CANAL-05 | Visibilidad de comisión e incentivos por actividad sostenida | Should | F1 | Built |
| CANAL-06 | Tiers de partner, enablement y cruce de bases | Could | F3 | Missing |
| CANAL-07 | Fondeo, saldo y límite de crédito por nodo | Should | F2 | Missing |
| CANAL-08 | Disputas, ajustes y clawbacks de atribución y comisión | Should | F2 | Missing |

**CANAL-01 · Portal de partners con visibilidad por subárbol: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `partners-contratos` of the program has not reported yet.
- Evidence: No hay usuarios externos: los roles son admin, lt, market_lead, supervisor, rep y ops (crm.memberships, 0001_core) y la entrada es SSO interno (ADR-004). No hay API de lectura (solo tres entradas: eventos, métricas, formularios). Base aprovechable: árbol de cuentas con ancestor_ids y RLS por subárbol para dueños internos (app.scope_parent_ids, 0002_access).
- Missing: Todo: usuario externo atado a party_node_id, token acotado al subárbol, API primero, superficie en axexo Business, alta delegada de usuarios y sub-dealers, estado del alta visible al partner, 'ver como' auditado, políticas default-deny probadas en CI, baja automática al desvincular el nodo.
- Who unblocks or what it depends on: AUT-04 (API de lectura); CAMPO-06 (estado del alta); P&T dueño de axexo Business; SEG

**CANAL-02 · Registro de PDV u oportunidad y reglas de compromiso: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: No existe claim ni job de vencimiento. Relacionado: app.duplicate_candidates y app.search_others (0013_leads) ya dan una respuesta mínima de existencia (nombre, ciudad, quién lo lleva) para uso interno.
- Missing: claim(account_id, node_id, channel, status, expires_at, rejection_reason), dedupe al registrar, RLS que aísle los claims de la venta directa, job de vencimiento, extensión con evidencia de actividad, reglas publicadas al partner.
- Who unblocks or what it depends on: CANAL-01; reglas de compromiso escritas (ventas y canales); job programado

**CANAL-03 · Atribución en 3 capas con fecha efectiva: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: Tabla crm.account_attributions (0001_core: layer origin, channel, owner; effective_from y effective_to). Se registra sola: src/domain/accounts.ts:createAccount, src/domain/leads.ts (conversión), src/domain/integrations.ts:ingestStore, src/domain/pipedrive/load.ts. La reasignación cierra la fila owner y abre otra (src/domain/reparto.ts:moveAccounts); el origen no se toca. Pantalla: ficha del comercio, pestaña Datos, 'Atribución' (Origen: Formulario web; Canal: D2D Centro; Quién lo lleva: Marco Peña; cada una con fecha). Pruebas: tests/db/domain.test.ts 'reasignar mueve deals y tareas abiertas y fecha la atribución'; tests/db/reparto.test.ts. Base sintética: 1,228 filas, sin vigencias dobles.
- Missing: 1) Constraint de exclusión contra vigencias solapadas (no hay EXCLUDE ni índice único; la fusión de cuentas mueve filas y puede dejar dos vigentes por capa: src/domain/accounts.ts:161). 2) Columnas reason y correction_of y flujo de corrección como fila nueva: origen y canal no se corrigen desde ninguna pantalla. 3) El origen no distingue conversión de red de adquisición nueva (guarda formulario, persona o importación). 4) La segunda capa guarda el canal o motor, no el equipo reclutador. 5) Reporte de excepciones por ciclo (comercios sin rep activo). 6) Arbitraje de Finanzas.
- Who unblocks or what it depends on: Finanzas y ventas: definición de las tres capas y de quién arbitra; CANAL-08 usa correction_of

**CANAL-04 · Motor de comisiones y residuales: Not applicable.**
- Source: audit of 12-Nov-2026 (before the build program).
- Evidence: El catálogo lo marca Won't (F3). docs/scope.md lo deja fuera a propósito ('commission calculation'). En código solo existe el campo de texto b2b_commission 'Comisión acordada' (0016).
- Who unblocks or what it depends on: P&T confirme si EMIDA o Movilway ya liquidan

**CANAL-05 · Visibilidad de comisión e incentivos por actividad sostenida: Built.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantalla /reportes/lo-que-llevo (ventas; supervisión y quien lidera pueden elegir a una persona de su alcance): altas, primeras ventas y activos a 30, 60 y 90 días de su cartera, por periodo, con la nota de que el pago lo calcula otro sistema. Sin montos, sin comisión y sin lugar en una tabla. Definiciones carryStores, carryFirstSales y carryActive en metric-defs. Pruebas: tests/db/reportes.test.ts ('altas, primeras ventas y activos a 30, 60 y 90 días salen de la cartera de la persona y del archivo de ventas'); tests/e2e/zx-reportes.spec.ts ('quien vende ve sus altas, primeras ventas y activos a 30, 60 y 90 días, sin montos de comisión').
- Missing: Descartado por el catálogo para esta fase y no construido: cálculo de comisiones, marca estimado contra publicado y commission_statement (F2). 'Activo a N días' se lee del archivo de ventas más cercano a esa fecha (7 días de margen): si Data y Reportería publica cohortes propias a 60 y 90 días, hay que leerlas de ahí. Sin vista para ACE ni aliados (no existen como usuarios).
- Who unblocks or what it depends on: Ventas y Finanzas (reglas de incentivo escritas); Data y Reportería (cohortes a 60 y 90 días)

**CANAL-06 · Tiers de partner, enablement y cruce de bases: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `partners-contratos` of the program has not reported yet.
- Evidence: Sin tiers, sin integración con Kore Academy y sin cruce de bases en código ni en migraciones.
- Missing: Tier recalculado por período con criterios publicados; enablement leído de Kore Academy; cruce de bases como job en el lakehouse sobre llaves fuertes con acceso restringido.
- Who unblocks or what it depends on: CANAL-01; Kore Academy exponga avance; S5 (lakehouse); criterios de tier (canales)

**CANAL-07 · Fondeo, saldo y límite de crédito por nodo: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: El contrato del archivo diario (docs/contracts/merchant-metrics-daily-v1.md, src/domain/integrations.ts:metricRow) no trae saldo, fondeo ni límite de crédito. La ficha muestra ventas de 30 días con fecha de corte. Único rastro: campo de negocio account_funding 'Cuenta ACH o prepago' (select, US).
- Missing: Método de fondeo, historial, saldo y límite de crédito por nodo en la ficha, leídos de S5 o del core con fecha de corte; límite de crédito aprobado por transición con aprobador.
- Who unblocks or what it depends on: S5 o el core expongan saldo y fondeo (sin verificar); contrato de S5 acordado

**CANAL-08 · Disputas, ajustes y clawbacks de atribución y comisión: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: No hay dispute ni cola de ajustes; account_attributions no tiene correction_of.
- Missing: dispute(account_id, layer, claimant, status, arbiter, resolution) con SLA y árbitro; resultado auditado como fila nueva de atribución; política de clawback aprobada antes de mostrar montos.
- Who unblocks or what it depends on: CANAL-03 (correction_of); CANAL-05; política de clawback (Finanzas y ventas)

### CS · Customer success B2B

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CS-01 | Lifecycle del comercio con handoffs con dueño | Must | F1 | Partial |
| CS-02 | Health score explicable y validado | Should | F2 | Missing |
| CS-03 | Alertas tempranas y playbooks de activación y reactivación | Must | F1 | Partial |
| CS-04 | Segmentación dinámica por modelo de atención | Should | F2 | Missing |
| CS-05 | Account management corporativo/API | Should | F2 | Missing |
| CS-06 | Capacitación del comercio y cambio de encargado | Should | F2 | Partial |
| CS-07 | Pipeline de expansión y cross-sell sobre comercio activo | Should | F2 | Missing |
| CS-08 | Feedback de producto desde campo | Could | F2 | Missing |

**CS-01 · Lifecycle del comercio con handoffs con dueño: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: Código: src/domain/integrations.ts:loadMetrics mueve la etapa de vida con el archivo de S5 (primera transacción pasa a activo; menos de 5 días con venta en 30 pasa a en riesgo o inactivo; vuelve a activo con 5 o más) y crea la actividad 'handoff' a Operaciones con dueño y fecha a 2 días. Entrega Ventas a Operaciones por etapa (is_ops, Tomar y Devolver). Pantalla: ficha, Datos, 'Etapa de vida: En alta · desde 10 nov 2026'. Pruebas: tests/db/domain.test.ts 'la primera transacción gana el deal con la fecha de la transacción, una sola vez'; tests/db/operaciones.test.ts.
- Missing: 1) Estados hábito, reactivado y perdido derivados (churned solo llega por importación). 2) Histéresis: entra y sale de riesgo con el mismo umbral. 3) Ventanas por producto calibradas por backtest (un solo umbral fijo en código). 4) Historial de estados (solo se guarda el último cambio, lifecycle_at). 5) handoff(account_id, from_role, to_role, at, checklist) como entidad y el tramo a CS o AM (solo existe ventas a Operaciones). 6) Job diario: hoy depende de que llegue el archivo; S5 no está conectado.
- Who unblocks or what it depends on: S5 conectado y contrato acordado; umbrales con datos propios (S5 y ventas); CS-05 (AM)

**CS-02 · Health score explicable y validado: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: La columna 'Salud' de /comercios es una etiqueta derivada de la etapa de vida y de si hay negocio abierto (src/lib/health.ts:healthOf), no un score.
- Missing: health_measure y health_score_snapshot diaria por grupos (transacciones vs línea base, mix, tickets, saldo) con tope, decay y explicación; conteos y severidad de Zendesk; backtest con precisión y recall por segmento antes de mostrarlo.
- Who unblocks or what it depends on: S5 con línea base; Zendesk (CS); CANAL-07 (saldo); CS-01

**CS-03 · Alertas tempranas y playbooks de activación y reactivación: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: Código: src/domain/rules.ts reglas activation_risk (negocio esperando primera venta más de 7 días) y reactivation (comercio en riesgo). Pantallas: /supervisor 'Alta sin primera venta · 4' y 'Comercio en riesgo · 28'; en Hoy de marco.pena aparece 'Sugerido por CONTIGO: Ayudar a Tienda El Milagro 11 a hacer su primera venta'. Cada aviso tiene dueño y se cierra solo, al completarlo o al descartarlo con motivo. Prueba: tests/db/domain.test.ts 'reglas (CAMPO-04, CS-03)'.
- Missing: 1) El aviso es una sugerencia (máximo 5 por día en Hoy), no una tarea creada al dueño de cartera. 2) Alertas de saldo bajo y de caída vs línea base; el comercio inactivo no genera aviso. 3) Playbooks. 4) Digital primero: plantillas utility de WhatsApp con consentimiento y límite por portafolio. 5) Dueño según modelo de atención. 6) Medición de retorno a 14 y 30 días contra holdout. 7) N configurable (constante en código).
- Who unblocks or what it depends on: CS-04 (modelo de atención); CANAL-07 (saldo); S5 con línea base; consentimiento de mensajes (SEG)

**CS-04 · Segmentación dinámica por modelo de atención: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: No hay service_tier ni comisión generada por cuenta en el modelo (db/migrations, src/domain).
- Missing: service_tier derivado por reglas con histéresis (comisión generada como variable principal y TPV como secundaria), recalculado, sobre la misma capa de datos.
- Who unblocks or what it depends on: Comisión generada por cuenta desde S5 o desde quien liquida; reglas de CS y ventas

**CS-05 · Account management corporativo/API: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: No hay rol de AM, relationship ni account_plan. Operaciones puede quedar como dueño después del alta (tests/db/reparto.test.ts 'Operaciones cuenta como dueño vigente'), pero no es un AM nombrado por handoff.
- Missing: AM nombrado por handoff como dueño post-venta de KAM; relationship(account_id, product, health) con rollup; account_plan; borrador de QBR con datos de S5.
- Who unblocks or what it depends on: CS-01 (handoff a AM); CS-02; S5; IA

**CS-06 · Capacitación del comercio y cambio de encargado: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: Capacitación por negocio que mantiene Operaciones: deals.training_status y training_on (0015), src/domain/ops.ts:setTraining, pantalla /deals/[id] 'Capacitación' (Pendiente, Agendada, Hecha) y contador 'Pendientes de capacitación' en /operaciones. El contacto tiene rol 'manager' con vigencia (crm.account_contacts).
- Missing: 1) training_completion desde Kore Academy por evento y por encargado: hoy es un estado manual por negocio. 2) Cambio de encargado capturado en la visita como señal de riesgo. 3) Que ambos alimenten las alertas de CS-03.
- Who unblocks or what it depends on: Kore Academy emita eventos de avance (sin verificar); CAMPO-01 (evento de visita con cambio de encargado); CS-03

**CS-07 · Pipeline de expansión y cross-sell sobre comercio activo: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: No hay oportunidad de expansión ni reglas de elegibilidad. Base aprovechable: embudos con varios negocios abiertos por comercio y líneas de producto (pipelines.multi_open y has_items, embudo de pedidos US, 0015).
- Missing: Oportunidad de expansión hija de la cuenta activa, creada por reglas de elegibilidad sobre actividad real de S5, usando la matriz de productos.
- Who unblocks or what it depends on: DAT-07 (matriz de productos, no está en este PR); S5; CS-01

**CS-08 · Feedback de producto desde campo: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ciclo-cs` of the program has not reported yet.
- Evidence: No hay tipo de actividad de feedback ni taxonomía de fricciones. /reportar (crm.problem_reports, 0017) es para problemas con CONTIGO, no del comercio. Los motivos de no venta sí son codificados, pero cubren otra cosa (PIPE-04).
- Missing: Tipo de actividad con taxonomía corta y estable; resumen periódico a P&T con conteo por tema y mercado.
- Who unblocks or what it depends on: Taxonomía acordada con P&T y ventas; canal del resumen (si se automatiza por correo o Slack, es tecnología nueva)

### REP · Reportes, métricas y forecast

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| REP-01 | Dashboards por rol y jerarquía (panel del LT) | Must | F1 | Partial |
| REP-02 | Snapshots históricos, eventos de etapa y cohortes | Must | F1 | Partial |
| REP-03 | Forecast por motor | Could | F3 | Partial |
| REP-04 | Capa de métricas única y conciliación con S5 | Must | F1 | Partial |

**REP-01 · Dashboards por rol y jerarquía (panel del LT): Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantallas: /reportes (galería por rol + Mis reportes + Reportes que te llegaron), /reportes/indicadores (cada indicador con definición y quién responde; administración lo edita, queda en crm.metric_owners y en la bitácora), /reportes/cuentas (agregado por cadena, ISO o distribuidor con sus hijos a cualquier profundidad + tablero de cuentas clave: etapas largas y próximos hitos; 'Mis cuentas'), /reportes/leads, /reportes/etapas, /reportes/agencias, /reportes/finanzas. Reportes guardados (privado o compartido con el mercado) y programados (job reportes.scheduled: deja el resumen dentro de CONTIGO). El Panel del LT y cada reporte muestran quién responde en 'Cómo se calcula'. Pruebas: tests/db/reportes.test.ts ('el dueño lo cambia administración', 'cada cadena suma todas sus tiendas', 'un reporte guardado es privado', 'un reporte programado llega a su dueño'); tests/e2e/zx-reportes.spec.ts ('está en el menú de todos y cada rol ve los reportes de su alcance', 'cada indicador tiene definición y quién responde', 'cadenas y distribuidores con el agregado', 'un reporte se guarda con sus filtros').
- Missing: Lo que pide el encargo quedó construido. Contra el catálogo falta: 1) Tablero de partner (no existe ese rol ni usuarios aliados: depende de CANAL-03) y un tablero propio de Operaciones (hoy: su cola y los reportes de la galería). 2) No existe un rol KAM: el tablero de cuentas clave lo ve quien lleva cuentas B2B y quien dirige. 3) El envío por correo del reporte programado queda apagado (adaptador report_mail); Slack no se construyó. 4) La entrega vive en Reportes ('Reportes que te llegaron', tabla crm.report_deliveries): falta recablearla al servicio único de avisos (src/domain/notify.ts) cuando el paquete avisos esté integrado. 5) Los responsables por defecto son por área: C1 debe confirmar los 5 a 7 indicadores por rol y su responsable. 6) El corte 'por tipo de venta' sigue resolviéndose por embudo. 7) Las pantallas anteriores (Mi equipo, Hoy, Operaciones) no se reescribieron para leer sus textos de metric-defs: solo el Panel del LT y los reportes nuevos lo hacen.
- Adapter turned off: report_mail (REPORT_MAIL_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (Tech Implementation Review del correo); Yamil / C1 (indicadores y responsables por rol)

**REP-02 · Snapshots históricos, eventos de etapa y cohortes: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Migración 0022: crm.pipeline_snapshots y crm.portfolio_snapshots, función app.take_report_snapshots() (SECURITY DEFINER: cuenta el mercado completo, no lo que ve quien corre la tarea), job reportes.snapshot en src/server/jobs/reportes.ts. Pantalla /reportes/historico: foto diaria con gráfica SVG, cohortes de leads del mes convertidos a 30, 60 y 90 días, cohortes de altas con primera venta, velocidad por etapa (mediana y percentil 90), y el archivo de salida en cola con 'Canal apagado'. Pruebas: tests/db/reportes.test.ts ('la foto la toma la tarea con identidad propia, cuenta todo el mercado y se puede repetir el mismo día', 'quien vende no puede tomar la foto', 'la velocidad por etapa mide lo que tarda un negocio'); tests/e2e/zx-reportes.spec.ts ('la foto diaria se toma, el histórico muestra cohortes y velocidad').
- Missing: Lo que pide el encargo quedó construido. Contra el catálogo falta: 1) Cohortes por semana de alta, canal y persona (hoy: por mes y mercado). 2) La exportación de la foto al lakehouse queda apagada: destino y formato sin acordar con Data y Reportería. 3) El job está registrado en JOBS pero nadie lo corre por horario hasta que el paquete automatizaciones integre el corredor (hoy: botón 'Tomar la foto ahora' para administración). 4) Sin particionado ni política de ventana corta (una fila por etapa por día). 5) 'Pull-through' de Operaciones no se construyó como indicador propio (la velocidad por etapa sí incluye las etapas de Operaciones). 6) La foto diaria solo la ven los roles de mercado completo; supervisión ve cohortes y velocidad de su equipo.
- Adapter turned off: snapshot_file (SNAPSHOT_FILE_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (Tech Implementation Review); Roxanna Quintero / Data y Reportería (destino y formato del archivo)

**REP-03 · Forecast por motor: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantalla /reportes/pronostico: por embudo (tipo de venta), negocios abiertos por etapa por su tasa histórica de avance (ganados de los que pasaron por la etapa y ya cerraron, últimos 365 días), con rango (intervalo al 80%) y el supuesto a la vista; cuando hay menos de 5 cerrados usa la probabilidad configurada en la etapa con 15 puntos de margen y lo dice. Exportable. Pruebas: tests/db/reportes.test.ts ('la tasa de una etapa sale de la historia cuando hay muestra, con un rango', 'el pronóstico cuenta los negocios abiertos de cada etapa dentro del alcance'); tests/e2e/zx-reportes.spec.ts ('el pronóstico da un rango por embudo con su supuesto a la vista').
- Missing: Lo que el catálogo pide para F2 y F3 y no se construyó: categorías de pronóstico en el negocio de cuentas clave con ajuste de quien dirige, forecast_submission versionada, y la proyección estadística D2D por cohortes en el lakehouse. El pronóstico es en número de negocios; el monto esperado por moneda no se muestra.
- Who unblocks or what it depends on: Yamil (decidir si F2/F3 entran); Data y Reportería (proyección D2D por cohortes)

**REP-04 · Capa de métricas única y conciliación con S5: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: src/lib/metric-defs.ts: 44 definiciones con ventana, fuente y responsable (prueba 'cada indicador tiene definición, ventana, fuente y dueño'). El archivo de ventas acepta el estado del comercio (campo opcional status) y, cuando viene, manda el archivo; la regla propia queda solo como respaldo para filas sin estado (src/domain/integrations.ts; prueba 'cuando el archivo trae el estado del comercio, manda el archivo'). Conciliación: /reportes/conciliacion compara ganados por primera venta contra primeras ventas del archivo, lista las diferencias por comercio y por tipo, con umbral de 2% y fecha de corte; job reportes.reconcile guarda cada corrida (crm.reconciliation_runs). Comercios muestra la fecha de corte de los datos de ventas. Pruebas: tests/db/reportes.test.ts ('lista los ganados sin primera venta en el archivo...'); tests/e2e/zx-reportes.spec.ts ('la conciliación compara ganados contra primeras ventas del archivo y lista las diferencias').
- Missing: 1) El archivo real todavía no trae el estado del comercio: mientras llegue sin él, 'activo' y 'en riesgo' siguen saliendo de la regla de respaldo de CONTIGO (5 días de venta en 30). El contrato docs/contracts/merchant-metrics-daily-v1.md quedó actualizado con el campo opcional, sin acordar con Data y Reportería. 2) No todas las pantallas anteriores leen sus textos de metric-defs (Mi equipo, Hoy, ficha). 3) Sin TPV por producto ni comisión. 4) Sin archivo de manifiesto. 5) No hay conexión real con el lakehouse: el archivo sigue entrando por Administración o por la API.
- Who unblocks or what it depends on: Roxanna Quintero / Data y Reportería (definición de activo y en riesgo, y el campo status en el archivo)

### AUT · Automatización, eventos e integraciones

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| AUT-01 | Capa de dominio única para reglas | Must | F1 | Partial |
| AUT-02 | Eventos de dominio (outbox) | Must | F1 | Partial |
| AUT-03 | Workflows, SLAs y aprobaciones como transiciones | Should | F1 | Built, external channel off |
| AUT-04 | API y entornos de prueba | Must | F1 | Partial |
| AUT-05 | Servicio de notificaciones centralizado | Should | F2 | Partial |
| AUT-06 | Ingesta del lakehouse por archivos diarios | Should | F1 | Partial |
| AUT-07 | Import y export masivo gobernado | Should | F1 | Built |

**AUT-01 · Capa de dominio única para reglas: Partial.**
- Source: package `automatizaciones`, 13-Nov-2026.
- Evidence: src/domain/intake.ts: las mismas reglas de entrada para pantalla (createAccount), API (ingestStore, que ahora crea el comercio con insertAccountTx, la función de alta), importación de Pipedrive (accountRule, dealRule, leadRule antes de cada inserción; la fila que no cumple se salta con motivo en el resumen) y automatizaciones (toda acción llama a moveDealTx, assignLeadTx, setWaitingOnTx y a la guarda de datos prohibidos). Invariante en Postgres para toda vía: trigger crm.deal_integrity (etapa de su embudo, embudo de su mercado). Pruebas de contrato por vía: tests/db/automatizaciones.test.ts 'AUT-01: la misma regla en toda vía de entrada (contrato)' (4) y tests/unit/automatizaciones.test.ts (ninguna tabla de negocio se escribe fuera de src/domain).
- Missing: 1) contigo_app conserva INSERT y UPDATE directos sobre crm: pasar a escritura solo por funciones de Postgres es un cambio de arquitectura que pide Tech Implementation Review. 2) La importación sigue escribiendo por lotes con su propio SQL (por volumen), validando cada fila con las reglas compartidas; un negocio abierto importado sin próximo paso entra y se cuenta, no se rechaza. 3) La prueba de contrato de importación ejercita las funciones que llama el cargador, no una corrida completa contra el Pipedrive simulado. 4) Validaciones fiscales (MULTI-03) no son de este paquete.
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (Tech Implementation Review: dónde viven las reglas, TypeScript o funciones Postgres)

**AUT-02 · Eventos de dominio (outbox): Partial.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: Pantalla /admin/integraciones?tab=eventos (administración): catálogo versionado de 79 eventos con esquema y ejemplo, lista de lo que no emite y por qué, suscriptores (destino https, eventos, mercado, secreto, pausa, baja), entregas en reintento y mensajes muertos con Reenviar, y Publicar ahora. Código: src/domain/events/catalog.ts (decide: lista explícita), src/domain/common.ts (audit emite en la misma transacción), src/domain/publisher.ts, job eventos-api.publish en src/server/jobs/eventos-api.ts. Contrato: docs/contracts/domain-events-v1.md (generado). Pruebas: tests/db/eventos-api.test.ts (9 casos de AUT-02), tests/unit/eventos-api-contracts.test.ts, tests/e2e/zx-eventos-api.spec.ts (2 casos).
- Missing: 1) Entrega real: el adaptador solo tiene off y simulated; la implementación HTTP no se escribió a propósito (regla: sin llamadas de red). Para encender: aprobar el transporte, escribir la entrega en src/server/adapters/event-delivery.ts, poner CONTIGO_EVENT_SIGNING_KEY y CONTIGO_EVENT_DELIVERY. 2) UI en vivo por Broadcast (punto 5 de la auditoría): no venía en el encargo y es tecnología nueva. 3) Nadie suscrito todavía (Sales Core, S5): depende de P&T. 4) El corredor que decide cuándo corre el job lo construye el paquete automatizaciones.
- Adapter turned off: event-delivery (CONTIGO_EVENT_DELIVERY)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (Tech Implementation Review del transporte; decidir si hay bus de P&T)

**AUT-03 · Workflows, SLAs y aprobaciones como transiciones: Built, external channel off.**
- Source: package `automatizaciones`, 13-Nov-2026.
- Evidence: Pantalla /admin/automatizaciones (lista por mercado, detalle 'Cuando/Si/Entonces', crear desde plantilla, formularios de condiciones y acciones, pausar, 'Probar contra un registro', bitácora por regla) y /admin/automatizaciones?v=pasos (pasos con aprobación). Migración 0019 (crm.automations, automation_log, automation_state, stage_transitions, approvals). Motor: src/domain/automation/engine.ts; las 9 reglas de src/domain/rules.ts son definiciones sembradas por mercado (DEFAULTS en catalog.ts) y evaluateRules conserva su contrato. Disparo por horario (job automatizaciones.reglas) y por evento del dominio leyendo la cola de eventos (job automatizaciones.eventos). Pruebas: tests/db/automatizaciones.test.ts 'AUT-03: las reglas son datos...' (5), tests/unit/automatizaciones.test.ts, tests/e2e/zx-automatizaciones.spec.ts. Verificado el 13-nov: vitest completo 459 pruebas en 36 archivos en verde; E2E zx-automatizaciones 5 de 5 en verde.
- Missing: No hay pasos con aprobación preconfigurados (alta, crédito ACH): se configuran en pantalla; quién aprueba y quién suple lo definen C1 y mesa de control. Los avisos de una automatización llegan como tarea en Hoy; correo, Slack o push dependen del paquete avisos.
- Adapter turned off: Disparo externo por horario (CRON_SECRET)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (secreto y programador de la plataforma); C1 y mesa de control (aprobadores)

**AUT-04 · API y entornos de prueba: Partial.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: GET /api/v1/accounts, /deals, /leads, /activities y /catalogs con llave de un mercado y alcances mínimos, cursor, filtros validados y los permisos de quien creó la llave (RLS). Límite por llave y por IP en la base con 429 y Retry-After; 20 llaves inválidas por minuto por IP y después 429. Rotación con dos llaves vigentes y fecha de retiro, último uso, revocar con confirmación. Pantalla /admin/integraciones?tab=api con llaves y documentación. docs/contracts/api-v1.md y api-v1.openapi.json (generados). Llaves de prueba ctg_test_: leen un juego sintético en memoria (src/server/api-sandbox.ts), nunca las tablas del negocio. Pruebas: tests/db/eventos-api.test.ts (5 casos de AUT-04), tests/e2e/zx-eventos-api.spec.ts (2 casos).
- Missing: 1) API de escritura general sobre el dominio (el encargo pidió lectura). 2) Tokens de socios acotados a un subárbol: hoy la llave se acota a un mercado. 3) Entornos por rama (branches de Supabase, previews de Vercel): no se tocó infraestructura; se resolvió con llaves de prueba. 4) La API v1 no expone teléfonos, correos, nombres de contacto ni texto de notas: si un consumidor los necesita, es decisión de C1.
- Who unblocks or what it depends on: Yamil Alvarez (alcance de la v1 y datos de contacto); Dan Mulligan (plataforma y entornos por rama)

**AUT-05 · Servicio de notificaciones centralizado: Partial.**
- Source: package `avisos`, 13-Nov-2026.
- Evidence: Servicio único src/domain/notify.ts (notify, notifyMany, notifyOutside) con registro crm.notifications (canal, plantilla, destinatario, costo, estado). Pantallas: campana con contador en la barra, /avisos (leído y sin leer, enlace al registro), /avisos/preferencias (tipo por canal y resumen diario), Hoy muestra los que piden acción, /admin/avisos (canales, cola de salida, plantillas, por mercado), /estado (cada canal apagado y qué falta). Horario hábil, resumen y límite diario de WhatsApp en dominio. Menciones, devoluciones, negocio ganado, segunda solicitud web y llegada de lead pasan por el servicio. Pruebas: tests/db/avisos.test.ts, tests/unit/avisos.test.ts, tests/e2e/zx-avisos.spec.ts.
- Missing: 1) Canal push: no se construyó (no estaba en el encargo; pide service worker y proveedor). 2) El servicio se llama dentro de la transacción del cambio; no se alimenta del publicador del outbox (AUT-02, paquete eventos-api). 3) Correo, Slack y WhatsApp quedan apagados; WhatsApp a personas no tiene a dónde ir porque CONTIGO no guarda su teléfono. 4) Las tareas avisos.release y avisos.digest corren cuando exista el corredor del paquete automatizaciones.
- Adapter turned off: email (EMAIL_ADAPTER), slack (SLACK_ADAPTER), whatsapp (WHATSAPP_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (revisión de tecnología)

**AUT-06 · Ingesta del lakehouse por archivos diarios: Partial.**
- Source: audit of 12-Nov-2026 (before the build program).
- Evidence: src/domain/integrations.ts:ingestMetricsFile y loadMetrics: lote en crm.ingest_batches (as_of, file_name, checksum, row_count, mode, status, matched, unmatched), idempotente por checksum, cuarentena si un archivo completo cambia más de 20% de tamaño, rechazo completo si el formato no cumple, gana el negocio y mueve el estado del comercio. Frescura visible en /estado ('Último archivo: corte del..., cargado el...') y en /admin?tab=integraciones 'Archivos diarios de ventas: 255 de 255 filas ligadas' (observado). Pruebas: tests/db/domain.test.ts 'un archivo completo que cambia más de 20% de tamaño queda en cuarentena...' y 'el archivo de S5 con formato inválido se rechaza completo'.
- Missing: 1) No hay alerta si el archivo no llega: /estado muestra el último corte, pero nada abre un aviso ni notifica. 2) Reprocesar un corte ya cargado con otro contenido sobrescribe los valores (on conflict do update) sin evento compensatorio ni valor anterior: queda el lote y su auditoría, no la corrección. 3) Datos tardíos: un archivo con as_of anterior al último cargado aplica cambios de estado igual; sin verificar en prueba, no hay guarda en el código. 4) No hay archivo de manifiesto: la carga es un JSON por POST de hasta 20,000 filas, no un archivo con manifiesto. 5) Sin conexión real con S5 (solo el botón de prueba de Administración y la llave metrics:write).
- Who unblocks or what it depends on: S5 (Data & Reporting): formato, horario y manifiesto; AUT-03 y AUT-05 para la alerta

**AUT-07 · Import y export masivo gobernado: Built.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: Importar: /importar (administración y líder de mercado; enlace desde Comercios y Leads): plantilla descargable, vista previa que valida todo sin escribir (errores y duplicados por fila con las reglas de DAT-04), corrida en lotes por los comandos de dominio y guard.ts, bitácora por fila con reporte descargable, y Deshacer. El archivo se procesa en memoria y no se guarda. Exportar: motivo obligatorio, tope por rol, crm.export_log con filtros y conteo, alerta por umbral diario; aplica a negocios cerrados y reporte de campo, y agrega comercios y leads de lo filtrado (/comercios/export, /leads/export). Administración lo ve en /admin/integraciones?tab=datos. Pruebas: tests/db/eventos-api2.test.ts (10 casos), tests/e2e/zx-eventos-api.spec.ts (2 casos).

### IA · IA asistida, agentes y guardas

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| IA-01 | Captura asistida (voz, documentos, conversaciones) | Should | F2 | Missing |
| IA-02 | Next best action explicable | Could | F3 | Partial |
| IA-03 | Calificación y clasificación de leads asistida | Could | F3 | Missing |
| IA-04 | Agentes con autonomía graduada | Could | F2 | Missing |
| IA-05 | Consulta en lenguaje natural sobre métricas definidas | Could | F2 | Missing |
| IA-06 | Servidor MCP del CRM | Could | F2 | Missing |
| IA-07 | Guardas contra inyección y fuga de datos | Must | F1 | Built |
| IA-08 | Evaluación de IA | Should | F2 | Missing |

**IA-01 · Captura asistida (voz, documentos, conversaciones): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sin funciones de IA en el repo: package.json sin SDK de modelos; /estado lista 'Funciones de IA' en 'Lo que todavía no está' (src/content/status.ts). No existe draft_fields.
- Missing: Todo: captura por voz, OCR de documentos del alta y transcripts a campos en borrador con confianza y confirmación humana.
- Who unblocks or what it depends on: Sales App (graba y envía), IA-07, IA-08, bóveda de documentos (los documentos son dato prohibido en CONTIGO); Tech Implementation Review (regla 13 del workspace)

**IA-02 · Next best action explicable: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sugerencias por reglas con razón visible en /hoy, bloque 'Sugerido por CONTIGO' (observado: 'Ayudar a ... a hacer su primera venta · Alta sin primera venta'): src/dal/queue.ts toma de la cola de avisos una sugerencia por registro, hasta 5 por día (SUGGESTED_PER_DAY). Atenderla exige próximo paso con fecha y guarda la resolución ('scheduled' o 'dismissed' en crm.exceptions). Pruebas: tests/db/hardening.test.ts 'una sugerencia no se cierra con nada más: pide un próximo paso con fecha' y 'QA-12: atender una sugerencia cierra los demás avisos abiertos del mismo negocio'.
- Missing: 1) No hay tabla recommendation con señal, vencimiento, si se siguió y qué pasó después (solo la resolución del aviso). 2) El límite es 5 por persona y día, no hasta 3 por cuenta o ruta. 3) No hay holdout por territorio ni medición de resultado. 4) No hay señales de uso (dealers que reducen uso) más allá del estado en riesgo.
- Who unblocks or what it depends on: REP-02 (resultado medible), CAMPO-03 (territorios para el holdout), AUT-06

**IA-03 · Calificación y clasificación de leads asistida: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sin clasificación asistida: el tipo de venta y el tipo de cuenta del lead los pone el formulario o la persona (src/domain/leads.ts). Sin SDK de modelos.
- Missing: Todo: reglas de clasificación por motor, clasificador de texto libre con salida tipada y confirmación humana.
- Who unblocks or what it depends on: IA-07 (red-team antes), IA-08, LEAD-03; Tech Implementation Review (regla 13 del workspace)

**IA-04 · Agentes con autonomía graduada: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sin agentes ni brief de cuenta. Sin SDK de modelos en package.json.
- Missing: Todo: brief de cuenta de solo lectura, cola de borradores con aprobación, costo por acción y dueño de la supervisión.
- Who unblocks or what it depends on: IA-07, IA-08, IA-06 o herramientas tipadas, AUT-04 (lectura); Tech Implementation Review (regla 13 del workspace)

**IA-05 · Consulta en lenguaje natural sobre métricas definidas: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sin consulta en lenguaje natural. Base aprovechable: src/lib/metric-defs.ts ya tiene las definiciones del panel en un solo lugar.
- Missing: Todo: herramienta que solo invoque métricas registradas con la identidad del usuario y devuelva definición y fecha de corte.
- Who unblocks or what it depends on: REP-04 (capa de métricas), IA-07, IA-08; Tech Implementation Review (regla 13 del workspace)

**IA-06 · Servidor MCP del CRM: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sin servidor MCP: no hay rutas ni dependencias MCP en el repo.
- Missing: Todo: servidor de lectura con OAuth por usuario, herramientas apagadas por defecto y por rol, límite de filas y auditoría con actor y vía; después el de escritura.
- Who unblocks or what it depends on: AUT-04 (API de lectura), SEG-01, SEG-03; Tech Implementation Review (regla 13 del workspace) (el catálogo lo exige)

**IA-07 · Guardas contra inyección y fuga de datos: Built.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: Marca untrusted: columna calculada en crm.field_definitions (todo campo de texto libre) y crm.untrusted_marks por registro con su origen (formulario web, API de formularios, Sales App, archivo importado). El texto se guarda tal cual, sin caracteres invisibles, y se muestra como texto plano con el aviso Texto recibido de fuera en el lead y en el comercio. Código: src/domain/untrusted.ts, src/ui/untrusted.tsx. Pruebas: tests/db/eventos-api2.test.ts (2 casos de IA-07 y marcas en importación y Sales App), tests/e2e/zx-eventos-api.spec.ts (texto con HTML y enlace: ni imagen ni enlace nuevos).
- Missing: Lo que el catálogo pide para cuando exista una función de AI y hoy no aplica: allowlist de salida a nivel red, lector y actor separados, red-team antes de cada agente y bitácora con prompt y llamada a herramienta. No hay funciones de AI en CONTIGO.
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (cuando se proponga la primera función de AI)

**IA-08 · Evaluación de IA: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `ia` of the program has not reported yet.
- Evidence: Sin sets de evaluación, prompts versionados ni costo por acción (no hay IA que evaluar).
- Missing: Todo: sets por caso de uso, umbral por campo, regresión automática al cambiar prompt o modelo y costo por acción.
- Who unblocks or what it depends on: IA-01, IA-03, IA-04 (casos de uso), GOB-04 (CI)

### MULTI · Multi-país, moneda, entidad, IDs fiscales y WhatsApp

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| MULTI-01 | Multi-moneda con tasa fechada | Must | F1 | Partial |
| MULTI-02 | Entidad legal y localización (idioma, zona horaria) | Must | F1 | Partial |
| MULTI-03 | Identificadores fiscales por país con validación en 3 capas | Must | F1 | Missing |
| MULTI-04 | Direcciones por país y geolocalización | Should | F1 | Missing |
| MULTI-05 | WhatsApp por mercado (WABA, costos, plantillas) | Should | F2 | Missing |

**MULTI-01 · Multi-moneda con tasa fechada: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: Montos en unidades menores con moneda ISO (crm.deals.amount_minor + currency; deal_items; merchant_metrics_daily). Tasa fechada con fuente en crm.fx_rates (currency, as_of, usd_rate, source, loaded_by, loaded_at) que administración carga en pantalla (src/domain/reports.ts:setFxRate, auditado). /panel-lt muestra monto original y convertido con tasa, fecha y fuente ('MXN 1.4 M · USD 71.9 k; Tasa usada: 1 MXN = 0.05 USD, con fecha del 11 nov 2026', observado). Pruebas: tests/e2e/zx-liderazgo.spec.ts 'sin tasa cargada no consolida y lo dice; administración la carga con fecha y fuente'; tests/unit/rules.test.ts 'el dinero se guarda en unidades menores...'.
- Missing: 1) El monto no guarda su tasa: faltan fx_rate, fx_rate_date, fx_source y amount_usd por monto. 2) Los cerrados no congelan la tasa. 3) Las tasas no vienen de S5: se cargan a mano y las cargadas son de prueba. 4) Solo se consolida a USD el volumen de 30 días; los montos de negocios se suman por moneda sin convertir (/reportes/cerrados lo dice). 5) El panel usa la tasa más reciente, no la de la fecha de cada monto.
- Who unblocks or what it depends on: S5 (tasas fechadas); decisión de la regla única de rollup (Finanzas y LT)

**MULTI-02 · Entidad legal y localización (idioma, zona horaria): Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: crm.markets con moneda, idioma por defecto, zona IANA y región de datos; crm.legal_entities y accounts.legal_entity_id existen en el esquema (0001_core.up.sql:43 y 120). UI en ES y EN con etiquetas separadas de valores (label_es/label_en, name_es/name_en; src/messages/es.json y en.json). Horario hábil por mercado (crm.market_hours, 0013) y 'hoy' medido en la zona del mercado. Pruebas: tests/db/hardening.test.ts 'S-05: hoy es el día del mercado, no el del servidor...'; tests/unit/market-day.test.ts.
- Missing: 1) La entidad legal no se usa: ningún archivo de src lee ni escribe legal_entity_id (grep sin resultados); la semilla la llena, un comercio creado en la app queda sin entidad; no se ve en ninguna pantalla. 2) No existe el objeto contrato, así que no hay entidad obligatoria en contrato. 3) No hay política RLS por entidad para segregar redes adquiridas. 4) La zona horaria es por mercado, no por cuenta (US completo corre en hora del Este). 5) Sin calendarios de días festivos por país (horario lunes a viernes). 6) Las personas solo pueden usar es o en (crm.users.locale), aunque el mercado admite pt.
- Who unblocks or what it depends on: Objeto contrato (CANAL), SEG-01 (RLS), MULTI-05 (WABA por entidad); Legal y Finanzas definen las entidades

**MULTI-03 · Identificadores fiscales por país con validación en 3 capas: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: Solo dos columnas sin uso en crm.accounts: tax_id_last4 y tax_id_blind_ix (0001_core.up.sql:141-142); ningún código de src las escribe ni las lee, y en la base sintética están vacías (0 de 439). README: 'fiscal ID capture and encryption' figura en 'Not in this repository yet'.
- Missing: Todo: captura del identificador fiscal como texto normalizado, validador por país (formato y dígito verificador para RFC, NIT, EIN, CNPJ alfanumérico), verificación contra registro oficial vía proveedor, listas de riesgo y tabla tax_id_verification con fecha y fuente; búsqueda por coincidencia exacta.
- Who unblocks or what it depends on: Legal y Seguridad: si el valor completo se guarda y dónde; elección de proveedor [pendiente: Compliance]; Tech Implementation Review (regla 13 del workspace)

**MULTI-04 · Direcciones por país y geolocalización: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: Existen columnas latitude y longitude en crm.accounts (0001_core.up.sql:139-140) pero ningún código las usa y en la base sintética están vacías (0 de 439). La dirección es un formulario genérico igual para todos los países (address_line, locality, region, postal_code, country). La ficha muestra la dirección y un enlace 'Cómo llegar'; la vista Mapa dice 'El mapa llega después' (observado en /comercios). El contrato de la Sales App (store.created) no trae coordenadas.
- Missing: 1) Captura de coordenadas (desde la Sales App o al dar de alta). 2) Uso de coordenadas en dedupe y cobertura (hoy dedupe es por teléfono y nombre). 3) Formularios de dirección guiados por metadata de país (address_format). 4) Vista de mapa.
- Who unblocks or what it depends on: Contrato con Sales App (coordenadas en el evento), DAT-04, CAMPO-03; Tech Implementation Review (regla 13 del workspace) (el catálogo lo exige para PostGIS)

**MULTI-05 · WhatsApp por mercado (WABA, costos, plantillas): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: Solo enlaces a WhatsApp desde Hoy y la ficha (src/ui/queue.tsx 'now-whatsapp', abre la app del teléfono). No hay whatsapp_account, plantillas, webhook de costos ni ventana visible.
- Missing: Todo: WABA por entidad y mercado, plantillas por idioma y categoría, costo por mensaje y ventana abierta visible.
- Who unblocks or what it depends on: MULTI-02 (entidad legal), AUT-05, CANAL (bandeja), cuentas de Meta por mercado [pendiente: Marketing y Legal]; Tech Implementation Review (regla 13 del workspace)

### SEG · Seguridad, privacidad y cumplimiento

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| SEG-01 | Permisos por rol, territorio y fila (RLS) | Must | F1 | Partial |
| SEG-02 | Seguridad por campo (comisiones, splits, datos sensibles) | Must | F1 | Missing |
| SEG-03 | Audit log inmutable y monitoreo de exportes | Must | F1 | Partial |
| SEG-04 | Consentimiento, datos sensibles y retención | Must | F1 | Partial |
| SEG-05 | Offline seguro con escritura | Won't | F3 | Not applicable |
| SEG-06 | Código de conducta e incidentes de campo | Should | F2 | Missing |
| SEG-07 | Ciclo de vida de identidades | Should | F1 | Partial |
| SEG-08 | Gestión de secretos y credenciales de integración | Should | F1 | Partial |
| SEG-09 | Derechos de titulares (acceso, rectificación, eliminación) | Should | F2 | Missing |
| SEG-10 | Protección de endpoints públicos | Should | F2 | Built, external channel off |

**SEG-01 · Permisos por rol, territorio y fila (RLS): Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Código: db/migrations/0002_access.up.sql (RLS habilitado y forzado en todo el esquema crm; funciones de alcance app.my_markets, app.full_markets, app.supervised_user_ids, app.my_territory_ids, app.scope_parent_ids; políticas accounts_read/accounts_upd y herencia a deals, contactos, visitas, métricas), 0011_distribution (app.owner_roles, app.owner_keys), 0013_leads (app.search_others: existe y quién lo lleva, solo nombre, ciudad y dueño), 0001_core (índices owner, territorio y GIN sobre ancestor_ids), src/domain/policy.ts (matriz CAPABILITIES). Pruebas: tests/db/permissions.test.ts ('todas las tablas de crm tienen RLS habilitado y forzado', 'un vendedor ve lo suyo y lo que no tiene dueño en su territorio; nunca lo de otro vendedor', 'un supervisor ve a su equipo, no a los otros equipos de su mercado', 'quien lleva una cadena ve todas sus tiendas, a cualquier profundidad'), tests/db/leads.test.ts ('quien vende ve que el comercio de otra persona existe y quién lo lleva, sin teléfono ni enlace; nunca cruza mercados'); corren en CI (.github/workflows/ci.yml, paso AUTHZ-08). Verificado en vivo: base con 49 tablas en crm, 0 sin RLS forzado; contigo_app sin BYPASSRLS ni superusuario; ventas y supervisión reciben 404 en /admin, /estado y /reportes/adopcion.
- Missing: 1) Equipo de cuenta con roles (account_team): hoy solo hay un dueño por comercio y un segundo dueño de Operaciones en el negocio, así que propiedad y participación no están separadas. 2) Jerarquía de managers de varios niveles: solo existe supervisión de un equipo y líder de mercado. 3) Alcance por entidad legal o por subárbol de partner: accounts.legal_entity_id no entra en ninguna política y no hay usuarios externos (ISO, dealer). 4) Administración por partes: 'admin' es un solo rol global con toda la configuración, integraciones, fusiones y accesos (el catálogo lo marca como 'no hacer'). 5) Venta directa y canal ISO del mismo mercado: líder de mercado, Operaciones y Leadership ven todo el mercado, y dos supervisiones del mismo mercado ven la misma bolsa de registros sin dueño vigente (lo reconoce ADR-003). 6) No existe una función única can_see_account(uid, account_id): la regla vive repartida en políticas y funciones auxiliares (equivalente funcional, no un hueco por sí mismo).
- Who unblocks or what it depends on: Decisión de si habrá usuarios de partners (CANAL-*, MULTI-*); decisión de separar el rol de administración (Yamil, Dan Mulligan); definición de la jerarquía comercial por mercado (líderes de mercado).

**SEG-02 · Seguridad por campo (comisiones, splits, datos sensibles): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: No existe seguridad por columna. Lo único cercano: crm.field_definitions.data_class ('public','internal','confidential') que solo vuelve el campo no editable para todos (src/domain/custom.ts isEditable) y lo saca de formularios de alta (src/dal/b2b.ts); no restringe quién lo ve. Los datos sensibles se evitan en lugar de protegerse: accounts.tax_id_last4 (solo 4 caracteres), reglas 'policy:last4' y 'omit' del importador (src/domain/pipedrive/mapping.ts) y rechazo de tarjeta, SSN y CLABE en texto libre (src/domain/guard.ts assertNoProhibited). No hay tablas account_sensitive ni commission_*, ni enmascarado con revelado auditado, ni cifrado por campo.
- Missing: Todo el ítem: tablas separadas para columnas sensibles con RLS propia, visibilidad y edición por rol y por subárbol (el ISO ve las comisiones de su subárbol, el dealer no ve el split del ISO), enmascarado por defecto con revelado que deje evento en la bitácora, y cifrado con mecanismo aprobado en revisión técnica.
- Who unblocks or what it depends on: CANAL-05 (visibilidad de comisiones, no construido: decisiones #4 y #5 del comité), SEG-01 (subárbol de partner), plataforma de producción y KMS (Dan Mulligan, Squad 6), Tech Implementation Review del mecanismo de cifrado (Dan Mulligan o Michael Essiet).

**SEG-03 · Audit log inmutable y monitoreo de exportes: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Código: db/migrations/0001_core.up.sql (crm.audit_events con actor, acción, objeto, antes y después; triggers audit_events_no_update y audit_events_no_truncate), 0002_access (política audit_ins: nadie firma por otra persona; contigo_app sin UPDATE ni DELETE), 0007_hardening (session.started y session.ended), src/domain/common.ts audit() llamada desde cada comando de dominio en la misma transacción, src/domain/reports.ts (evento report.exported con filtros y número de filas). Pantalla: /admin?tab=auditoria con filtros por tipo de acción (incluye Configuración, Exportaciones, Inicios de sesión), persona, registro, mercado y fechas. Pruebas: tests/db/permissions.test.ts ('la bitácora es de solo inserción incluso para el dueño del esquema', 'nadie firma un evento de auditoría a nombre de otra persona'), tests/db/hardening.test.ts ('iniciar y cerrar sesión dejan su evento'), tests/db/liderazgo.test.ts ('exportar el reporte de campo deja evento y respeta el permiso'), tests/e2e/admin.spec.ts ('bitácora: hora de quien lee...'). Verificado en vivo: UPDATE y DELETE sobre crm.audit_events como superusuario fallan con 'audit_events is append-only' (transacción revertida).
- Missing: 1) La bitácora la escribe el código de la aplicación, no un trigger de base: 0 triggers de auditoría en tablas de negocio (verificado), así que un cambio por SQL directo, por migración o por una función SECURITY DEFINER que no llame a audit() no deja rastro. 2) No registra la vía (pantalla, API, importación, agente): no hay columna y request_id nunca se llena. 3) Vive en el mismo esquema crm que los datos, no en un esquema aparte. 4) No hay config_audit separado: configuración y datos comparten tabla (se distinguen por filtro). 5) Sin copia diaria fuera de la base (lakehouse u object storage). 6) Sin alertas por volumen de lectura o de exportes por usuario o por llave; los exportes solo quedan registrados. 7) Las lecturas de datos personales no se registran. 8) El uso de llaves de API no deja evento por llave.
- Who unblocks or what it depends on: Plataforma de producción (ADR-002, Dan Mulligan); destino de la copia (S5 Data & Reporting); dueño de los controles SOX y SOC [pendiente: dueño de controles SOX/SOC]; umbrales de alerta (Yamil).

**SEG-04 · Consentimiento, datos sensibles y retención: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Código: db/migrations/0012_admin_controls.up.sql (leads.consent_at y consent_text con restricción leads_consent_dated), src/domain/leads.ts (intakeFromForm guarda el consentimiento de correo con fecha y texto), src/domain/guard.ts (assertNoProhibited: tarjeta, SSN y CLABE con dígito de control) aplicado en activities, deals, leads, followup, ops, b2b, admin y problem-reports; src/domain/pipedrive/mapping.ts (scrub, last4, omit); scripts/scan-prohibited.mjs --db en CI. Pruebas: tests/db/admin.test.ts ('guarda de dónde vino el lead y el consentimiento con su fecha y su texto', 'sin casilla marcada no hay consentimiento'), tests/db/hardening.test.ts ('una tarjeta, un SSN o una CLABE no entran por notas, asuntos ni próximo paso'), tests/unit/scanner.test.ts ('detecta tarjetas válidas por Luhn y deja pasar teléfonos y folios'). Pantalla: detalle del lead muestra origen y consentimiento.
- Missing: 1) Tabla consent(contact_id, channel, category, source, at, revoked_at): hoy el consentimiento es un par de columnas en el lead web, solo para correo, sin canal ni categoría, y no pasa al contacto al convertir. 2) Opt-out: no hay revocación ni bloqueo de contacto. 3) 'Consentimiento antes de la primera plantilla': no hay mensajería saliente. 4) Captura de documentos e IDs por formulario seguro (WhatsApp Flows o enlace autenticado): no existe; el expediente B2B guarda solo el estado del documento. 5) DLP: el catálogo pide enmascarar y avisar, y bloquear solo tarjeta válida; hoy se rechaza al guardar en los tres casos, y no cubre todos los textos libres (SEC-08 parcial). 6) Retención por tipo de dato: sin reglas ni depuración. 7) markets.privacy_notice_version está vacío en los tres mercados.
- Who unblocks or what it depends on: Legal: plazos de retención, versión del aviso de privacidad y categorías de consentimiento [pendiente: Legal]; decisión de bóveda de documentos (comité #9, CAMPO-06); canal de WhatsApp (CANAL-*); decisión de producto sobre rechazar o enmascarar (Yamil).

**SEG-05 · Offline seguro con escritura: Not applicable.**
- Source: audit of 12-Nov-2026 (before the build program).
- Evidence: El catálogo lo marca Won't y Descartar (F3). El producto es consistente con el 'no hacer': no acepta escrituras sin conexión; muestra aviso de sin señal y deshabilita guardar (ADR-006, 'No signal'), y la lectura con datos guardados en el equipo quedó deliberadamente fuera.
- Who unblocks or what it depends on: Si se reabre: decisión explícita de Michael Essiet o Dan Mulligan con el dueño de los controles SOX y SOC (ADR-006) y telemetría de conectividad de supervisores.

**SEG-06 · Código de conducta e incidentes de campo: Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `campo-canal` of the program has not reported yet.
- Evidence: Sin tabla, comando ni pantalla de incidentes: búsqueda de 'incident' en src y db/migrations sin resultados. Lo más cercano es crm.problem_reports (0017), que son reportes de fallas de la herramienta, no quejas de conducta. crm.visits no trae eventos de instalación o retiro.
- Missing: Tabla incident(account_id, party_id, type, reported_by, status) con acceso restringido y auditado, pantalla de registro y seguimiento separada de las notas comerciales, eventos de instalación y retiro desde la Sales App, y el enlace con atribución y trust score.
- Who unblocks or what it depends on: Conexión real de la Sales App (CAMPO-01, hoy solo contrato), trust score y atribución (CANAL-*), definición de tipos de incidente y de quién los ve (Compliance, líderes de mercado).

**SEG-07 · Ciclo de vida de identidades: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Código: src/server/adapters/identity.ts (Google OIDC detrás de un adaptador, allowedEmail fuerza el dominio en el servidor), src/app/auth/callback/route.ts, src/server/context.ts (sesión propia de 12 h con token opaco; el cargador exige una membresía vigente en cada solicitud), src/domain/admin.ts (grantAccess con confirmAdmin, setMembershipExpiry, endMembership que también saca a la persona de los turnos de leads), src/env.ts (rechaza personas de prueba en producción). Pantalla: /admin?tab=personas ('Dar acceso', 'Cambiar o quitar este acceso', vencimiento). Pruebas: tests/db/sso.test.ts (5), tests/db/admin.test.ts ('un acceso con fecha vale hasta el final de ese día...', 'siempre queda una administración sin fecha de vencimiento', 'dar Administración pide una confirmación aparte'), tests/e2e/admin.spec.ts ('quitar el acceso: confirma con lo que la persona tiene a su nombre...').
- Missing: 1) Baja automática: no hay sincronización con Google Directory ni baja al desvincular un nodo; la baja es manual o por fecha de vencimiento (AUTHZ-09: Not yet). 2) MFA obligatorio para roles con exporte: CONTIGO no lo exige ni lo verifica; depende de la política de Google Workspace. 3) 'Ver como' auditado: no existe (la página /estado lo lista como pendiente). 4) Usuarios de partners y ACE: no hay usuarios externos. 5) Aviso a la persona cuando recibe acceso: no existe.
- Who unblocks or what it depends on: Administrador de Google Workspace: política de MFA [pendiente: Workspace admin]; cliente OAuth configurado en staging; decisión sobre usuarios de partners (SEG-01); Tech Implementation Review de la sincronización de directorio.

**SEG-08 · Gestión de secretos y credenciales de integración: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Código: crm.api_clients (name, key_prefix, key_hash, scopes, created_by, created_at, revoked_at), src/domain/admin.ts (createApiClient: la llave se muestra una vez y solo se guarda su huella; revokeApiClient), src/server/api.ts (apiHandler valida llave y scope), src/env.ts (valida la forma de DATABASE_URL antes de llegar al driver), scripts/scan-prohibited.mjs (secretos en el repo, en CI). Pantalla: /admin?tab=integraciones, 'Llaves de API' con tres scopes (forms:write, events:write, metrics:write). Pruebas: tests/db/admin.test.ts ('cuenta las llaves vigentes por permiso y deja de contarlas al revocarlas'), tests/db/permissions.test.ts ('la tabla de sesiones y las llaves de API no se leen directo ni siendo admin'), tests/e2e/admin.spec.ts ('integraciones: revocar una llave pide confirmación...'), tests/unit/env.test.ts.
- Missing: 1) Inventario de los secretos salientes (PIPEDRIVE_API_TOKEN, llaves del proveedor de identidad, contraseña de la base): viven como variables del host, sin dueño, sin fecha de rotación y fuera de cualquier pantalla. 2) Dueño y fecha de rotación por llave entrante: la tabla no tiene esos campos ni vencimiento. 3) Rotación programada y gestor de secretos: no hay. 4) Último uso y alertas de uso anómalo por llave: no se registra el uso. 5) Tokens de Graph, Google, Meta, BSP, KYB y Claude API: esas integraciones no existen todavía.
- Who unblocks or what it depends on: Plataforma de producción y gestor de secretos (Dan Mulligan, Squad 6); KEY-02, KEY-03 y KEY-05 del estándar, abiertos; SEG-03 para las alertas.

**SEG-09 · Derechos de titulares (acceso, rectificación, eliminación): Missing.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Sin tabla de solicitudes ni rutina de anonimización: búsqueda de 'anonymi', 'data_request', 'subject_request' en src y db/migrations sin resultados. Base útil ya construida: nada se borra (contigo_app sin DELETE en tablas de negocio; fusionar archiva), lo que protege bitácora y atribución.
- Missing: Flujo completo: request(subject, type, country, due_at, status), pantalla y cola con plazos por país, exporte de los datos de un titular (acceso), rectificación trazada, y anonimización de datos personales que conserve IDs y montos sin romper bitácora ni atribución (la bitácora guarda antes y después con datos personales y es inmutable: hay que decidir cómo se trata).
- Who unblocks or what it depends on: Legal: plazos y alcance por país [pendiente: Legal]; SEG-04 (retención); decisión sobre datos personales dentro de audit_events (dueño de controles SOX/SOC).

**SEG-10 · Protección de endpoints públicos: Built, external channel off.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: Formularios públicos /f/[slug]: límite por IP y por formulario (vistas y envíos), llave de la página, tiempo mínimo entre carga y envío, campo trampa y adaptador anti-bot. Lo rechazado no se guarda (solo un conteo por motivo) y la respuesta es la misma para todos los motivos. La API de formularios tiene límite por llave y por IP con 429. Pantalla /admin/integraciones?tab=formularios: límites por formulario y rechazos de 7 días; /estado muestra el adaptador. Código: src/domain/form-guard.ts, src/server/protect.ts, app.rate_hit. Pruebas: tests/db/eventos-api2.test.ts (2 casos), tests/e2e/zx-eventos-api.spec.ts (1 caso).
- Missing: La página pública responde 200 con el aviso de espera, no un 429: el código de estado real pide mover el límite al borde. Links de alta: no existen todavía, no hay qué proteger.
- Adapter turned off: antibot (CONTIGO_ANTIBOT)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (aprobar el servicio anti-bot)

### UX · Experiencia de uso

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| UX-01 | Ficha de cuenta con lo importante arriba | Must | F1 | Partial |
| UX-02 | Velocidad, UI optimista y búsqueda por cualquier alias | Must | F1 | Partial |
| UX-03 | Vistas guardadas como colas y estados vacíos útiles | Must | F1 | Partial |
| UX-04 | Móvil para supervisores y KAM | Should | F1 | Partial |

**UX-01 · Ficha de cuenta con lo importante arriba: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: Ficha en /comercios?ficha=<id> y /comercios/<id> (src/app/(app)/comercios/ficha.tsx): arriba van tipo de cuenta, nombre, salud (estado de vida), quién lo lleva con 'Reasignar', 'Pertenece a' (cuenta madre), dirección, bloque 'Lo siguiente' con el próximo paso y botones de contacto; el resto en pestañas Hilo, Árbol y Datos. Observado como ventas (390 px), supervisión y operaciones (1440 px). Prueba: tests/e2e/comercios.spec.ts 'la ficha no saca de la lista: panel en desktop, al lado en tablet, pantalla completa en móvil'.
- Missing: 1) El encabezado no muestra equipo, alertas abiertas ni fecha de corte (la fecha de corte está en la pestaña Datos). 2) Posición en el árbol: solo la cuenta madre inmediata; la cadena completa está en la pestaña Árbol. 3) No hay layout por rol en metadata: la ficha es la misma para todos los roles y solo cambian los botones según permiso (el don't del catálogo). 4) No hay RPC de encabezado con presupuesto de latencia (getAccount trae todo). 5) Sin evidencia de shadowing con supervisores y mesa de control.
- Who unblocks or what it depends on: DAT-05 (metadata), C1 define los 5 datos de arriba por rol con shadowing

**UX-02 · Velocidad, UI optimista y búsqueda por cualquier alias: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `seguridad` of the program has not reported yet.
- Evidence: Búsqueda global en /buscar (src/dal/accounts.ts:searchAll): nombre con pg_trgm, persona de contacto, teléfono, ID de otro sistema (alias) e ID de CONTIGO; también leads y negocios; la tecla '/' enfoca el buscador (observado). Pruebas: tests/e2e/comercios.spec.ts 'buscar encuentra por nombre, persona, teléfono con o sin lada y por el ID de otro sistema'; tests/e2e/shell.spec.ts 'en desktop la tecla / lleva a buscar'.
- Missing: 1) No hay UI optimista con rollback (useOptimistic solo en la lista de primeros pasos). 2) No hay paleta de comandos (Ctrl+K no hace nada, observado). 3) No se busca por identificador fiscal (no existe, MULTI-03). 4) Teléfono y alias se buscan por fragmento (like '%...%' con 4 dígitos o más; 'SC-MX-5' devolvió 7 comercios, observado): el catálogo pide solo coincidencia exacta normalizada para no permitir enumeración. 5) Sin búsqueda de texto completo. 6) Latencia sin medir: no hay p95 en Android de gama baja (standard-compliance PERF-01 'Not yet'); en local las pantallas cargaron en 0.7 a 1.2 s, que no es una medición válida.
- Who unblocks or what it depends on: MULTI-03 (tax ID), medición en teléfono real (GOB), decisión de producto sobre búsqueda por fragmento de teléfono

**UX-03 · Vistas guardadas como colas y estados vacíos útiles: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Barra 'Vistas guardadas' en /comercios, /leads, /pipelines/<embudo>?vista=lista y /actividades: guardar el filtro actual con nombre, fijarla como cola (aparece en el menú en 'Mis colas' con contador), compartirla con el equipo (supervisión; quien lidera y administración, con todos) y borrarla; estados vacíos que dicen qué hacer. Filtros por lista blanca (VIEW_FILTERS), sin consultas libres; tope de 12 vistas por lista y 5 colas fijadas. Vistas de fábrica que reconstruyen filtros de Pipedrive: 'Negocios sin persona asignada', 'Negocios abiertos sin próximo paso', 'Organizaciones de US', 'Leads sin persona asignada', 'Tareas del equipo', y el reporte compartido 'Negocios perdidos del mes en US'. Pruebas: tests/db/reportes.test.ts (3 pruebas de 'vistas guardadas como colas'); tests/e2e/zx-reportes.spec.ts ('quien vende guarda su filtro de Comercios como vista, la fija como cola con contador en su menú y la borra', 'supervisión comparte una vista de Leads con su equipo; hay vistas en Negocios y en Actividades').
- Missing: Lo que pide el encargo quedó construido. Contra el catálogo falta: 1) Las 3 colas oficiales por rol (revisitas vencidas, altas sin fondeo, PDV en riesgo) no están definidas por C1; de fábrica solo existe 'En riesgo'. 'Revisitas vencidas' y 'altas sin fondeo' necesitan filtros que hoy no están en la lista blanca ('altas sin fondeo' depende de CAMPO-06). 2) Filtros de Pipedrive sin campo equivalente, no reconstruidos: 'Vegas AWPE - Audit', 'US · axexo Business Portal' y 'US - People' (no hay lista de personas). 3) En Negocios la barra vive en la vista Lista, no en el tablero: sobre el tablero empujaba las columnas y hacía fallar el arrastre de la prueba existente negocios.spec ('cambiar de etapa pide el próximo paso'). Las vistas y colas de Negocios abren la vista Lista. 4) El contador vive en el menú de la persona ('Mis colas'), no en el dock (tope de 4 destinos).
- Who unblocks or what it depends on: Yamil / C1 (las 3 colas oficiales por rol)

**UX-04 · Móvil para supervisores y KAM: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `mercados` of the program has not reported yet.
- Evidence: Web responsive: a 390 px sin desborde horizontal en /hoy, /supervisor, /comercios, ficha, /reportes/cerrados y /operaciones (observado con Playwright, capturas en tmp-c). Pruebas: tests/e2e/zy-sweep.spec.ts (cada pantalla a 1440, 1024 y 390 con axe); tests/e2e/zx-liderazgo.spec.ts 'en 390 px cada persona se lee como tarjeta...'; tests/e2e/reparto.spec.ts 'la lista en el teléfono: dueño a la vista, filtros por plaza y repartir sin desbordes'.
- Missing: 1) No hay aprobaciones de un toque porque no hay aprobaciones (AUT-03). 2) No hay deep links desde la Sales App: la ficha solo abre por el ID de CONTIGO (/comercios/<uuid>), no por el ID de Sales Core, y el contrato no define el enlace. 3) No hay cache de lectura: sin señal la app avisa y no muestra datos (/estado lo declara). 4) Velocidad en teléfono real sin medir.
- Who unblocks or what it depends on: AUT-03 (aprobaciones), acuerdo con el equipo de la Sales App para el enlace, UX-02 (latencia)

### GOB · Gobierno, adopción y operación

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| GOB-01 | Registro de campos (field registry) | Must | F1 | Built |
| GOB-02 | Tablero de calidad de datos | Should | F1 | Partial |
| GOB-03 | Adopción, métricas de uso y change management | Must | F1 | Partial |
| GOB-04 | Gobierno de releases y mantenimiento | Must | F1 | Partial |
| GOB-05 | Migración y convivencia con Pipedrive y Zoho | Should | F1 | Partial |
| GOB-06 | Avisos a la red con acuse | Should | F2 | Built, external channel off |
| GOB-07 | Observabilidad, respaldo y recuperación | Should | F1 | Partial |
| GOB-08 | Datos de prueba sintéticos por mercado | Should | F1 | Partial |
| GOB-09 | Costo unitario del CRM (FinOps) | Should | F1 | Partial |
| GOB-10 | Soporte y entrenamiento in-app | Should | F1 | Partial |

**GOB-01 · Registro de campos (field registry): Built.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: crm.field_definitions con dueño, propósito, decisión que habilita, fecha de revisión, clase de dato personal, marca de dato de fuera sin validar, de dónde viene y quién lo usa, estado de propuesta y quién decidió. 'Sin decisión documentada no hay campo': createField y proposeField la exigen. Flujo: quien lidera el mercado propone, administración aprueba o rechaza con motivo; plazo publicado en crm.settings (field_approval_sla_days = 3) y propuesta marcada 'Fuera de plazo'. Uso por campo (app.field_usage) con marca 'Sin uso' para retirar. Lo que llega de Pipedrive entra marcado y aparece en 'Sin decisión'. Pantalla: /datos?tab=campos y 'Crear campo' en /admin?tab=embudos (ahora pide la decisión). Pruebas: tests/db/datos.test.ts 'DAT-05 / GOB-01', tests/e2e/zx-datos.spec.ts 'quien lidera el mercado propone un campo...'.
- Who unblocks or what it depends on: Yamil: nombrar a los responsables de cada campo existente (los sembrados y los de Pipedrive quedan en la vista 'Sin decisión')

**GOB-02 · Tablero de calidad de datos: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantalla: /datos?tab=calidad para administración, quien lidera, supervisión (solo su equipo), Operaciones y Leadership: 15 reglas con responsable (rol y persona), por mercado y por equipo, por corregir, porcentaje completo, tendencia contra el corte más antiguo de 30 días y enlace del número a la cola que lo corrige; 'Guardar el corte de hoy'. Reglas: sin quién los lleve, sin teléfono, sin contacto, sin dirección, PDV sin ubicación, activos sin ID externo, duplicados por decidir, avisos saltados, sin movimiento reciente, negocios sin próximo paso, negocios sin un dato que pide su etapa, atribución que no coincide, ventas sin comercio, proveedor fuera de plazo, campos sin decisión. Base: app.quality_measure (cada quien mide lo que ve), app.quality_failing, crm.quality_snapshots, tarea datos.quality_snapshot. Pruebas: tests/db/datos.test.ts 'GOB-02' (4), tests/e2e/zx-datos.spec.ts 'tablero de calidad' (2).
- Missing: Diferencias con S5 como conciliación completa (hoy solo se cuentan las ventas que llegaron sin comercio; la conciliación es REP-04). Las reglas tienen su cola en Datos; no abren avisos en la cola de Mi equipo. La tendencia necesita que corra el corte diario (lo corre el paquete automatizaciones) o el botón de administración.
- Who unblocks or what it depends on: REP-04 para la conciliación con S5; paquete automatizaciones para correr el corte diario

**GOB-03 · Adopción, métricas de uso y change management: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantalla /reportes/adopcion reescrita: uso real por persona y por equipo (actividades registradas por semana con tendencia de 8 semanas en SVG, próximo paso al día, leads atendidos a tiempo) y señal 'Listo para ampliar' por equipo (quien supervisa abrió el tablero de su equipo esta semana + el equipo tiene comercios activos). Ya no cuenta ni muestra ingresos. Supervisión ve a su equipo (capacidad adoption.team). Pruebas: tests/db/reportes.test.ts ('adopción mide uso real por persona con tendencia semanal; supervisión solo ve a su equipo'); tests/e2e/zx-reportes.spec.ts ('supervisión ve el uso real de su equipo con tendencia semanal, sin ingresos; ventas no entra'); tests/e2e/zx-liderazgo.spec.ts y zx-ajustes-lider.spec.ts cambiadas a propósito.
- Missing: 1) La métrica de paso a despliegue es una propuesta por defecto: falta que Yamil y quienes lideran mercado la confirmen. 2) Los eventos de uso siguen en crm.usage_events, fuera del outbox. 3) Soporte por WhatsApp y enlace a Kore Academy no son de este paquete (GOB-10). 4) 'Colas atendidas' como indicador de adopción no se construyó (las colas fijadas son nuevas: todavía no hay historia).
- Who unblocks or what it depends on: Yamil y líderes de mercado (métrica de paso a despliegue y orden de despliegue)

**GOB-04 · Gobierno de releases y mantenimiento: Partial.**
- Source: package `gobierno`, 13-Nov-2026.
- Evidence: /admin/gobierno (Versiones): responsable técnico y suplente por componente (7 componentes, sin nombres, dos personas distintas), calendario de mantenimiento por mercado, versiones con notas ES y EN que se anuncian antes de salir (salen por Anuncios y quedan en /solicitudes), lista de salida de 8 puntos con evidencia (revisión de tecnología y estándar incluidos) sin la cual la versión no se libera, registro de despliegues (job gobierno.deploy_watch anota el commit que corre). Plantilla de PR con la lista. Runbook docs/runbooks/despliegue-y-vuelta-atras.md. tests/db/gobierno.test.ts (GOB-04, 6 pruebas), E2E.
- Missing: Nombres de responsable y suplente [pendiente: Dan Mulligan]. Segunda persona que haya desplegado y vuelto atrás. Banderas por rol y mecanismo general de banderas (sigue una bandera por mercado y por embudo). Vistas previas por rama con datos del generador (plataforma). Protección de rama con dos revisores [pendiente: administradores del repositorio]. Visto bueno de Tech Implementation Review de lo ya desplegado en staging.
- Who unblocks or what it depends on: Dan Mulligan; Michael Essiet; administradores del repositorio

**GOB-05 · Migración y convivencia con Pipedrive y Zoho: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); package `integraciones-migracion` of the program has not reported yet.
- Evidence: Código: src/server/adapters/pipedrive.ts (solo lectura, respeta límites del API), src/domain/pipedrive/ (import.ts con tres etapas reanudables: configuración, copia cruda y carga; modos todo, solo cambios y reaplicar mapeo; mapping.ts con last4, omit y scrub; refs.ts), crm.external_refs, crm.import_runs, crm.import_raw, alias 'pipedrive' en account_aliases. Pantalla: /admin?tab=pipedrive (qué se copió y qué se cargó, no cargados con motivo, mapeo de campos, inventario de webhooks, vaciar la copia cruda). Pruebas: tests/db/pipedrive.test.ts (importación completa, segunda completa, delta y reaplicar mapeo), tests/e2e/zz-pipedrive.spec.ts, tests/unit/pipedrive-mapping.test.ts, contra un Pipedrive simulado.
- Missing: 1) Zoho: no hay importador ni mapeo. 2) Convivencia por mercado con criterios de salida medidos y corte: no hay pantalla, métrica ni plan en el producto; la importación es de una sola dirección y se corre a mano. 3) Dedupe en la carga: la carga empata por alias de Pipedrive y external_refs (no duplica al repetir), y al terminar corre las reglas (src/domain/pipedrive/load.ts, evaluateRules), que solo abren avisos de posible duplicado por teléfono igual: no fusiona ni frena duplicados al cargar. 4) Mapeo contra el registro de campos descartando lo que no habilita una decisión: hoy entran todos los campos custom. 5) Historial: no migra cambios de etapa pasados, adjuntos, hilos de correo, relaciones entre organizaciones, automatizaciones ni filtros (docs/pipedrive-migration.md). 6) Carga por AUT-07 (importador masivo): no construido. 7) Falta saber qué campo de Pipedrive es la referencia de comercio de S5 [pendiente: S5 Data & Reporting].
- Who unblocks or what it depends on: AUT-07, GOB-01, DAT-04; decisión de qué se migra de Zoho y de qué producto (Yamil); criterios de salida por mercado (líderes de mercado); ADR-005 y su sign-off (Dan Mulligan o Michael Essiet); almacenamiento de objetos (ADR-002).

**GOB-06 · Avisos a la red con acuse: Built, external channel off.**
- Source: package `avisos`, 13-Nov-2026.
- Evidence: /anuncios: publicar con audiencia (mercado, equipo, rol), vigencia, tema y acuse; cada persona lo ve al entrar (franja en toda pantalla), en su campana y en Hoy si pide acuse; lo marca leído o Enterado; quien publica ve quién falta; versión nueva reinicia el acuse; retiro; todo en bitácora (announcement.*). Cambio de comisiones o de alta: acuse obligatorio y fecha de entrada en vigor posterior al anuncio (regla en dominio y en la base). Pruebas: tests/db/avisos2.test.ts (GOB-06), tests/e2e/zx-avisos.spec.ts.
- Missing: El candado que impide cambiar una comisión o una regla de alta sin anuncio previo no se puede poner: CONTIGO no tiene módulo de comisiones (CANAL-05). Llega solo a quienes son usuarios; reps de calle e ISOs sin usuario dependen del canal de WhatsApp, que está apagado.
- Adapter turned off: whatsapp (WHATSAPP_ADAPTER), email (EMAIL_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (revisión de tecnología)

**GOB-07 · Observabilidad, respaldo y recuperación: Partial.**
- Source: package `gobierno`, 13-Nov-2026.
- Evidence: /admin/gobierno (Servicio): objetivos de servicio medidos por CONTIGO (disponibilidad, abrir una pantalla, guardar un cambio, API) con tablero por pantalla, errores con referencia, incidentes que no cierran sin causa y acciones, objetivos de recuperación con quién y cuándo, registro de pruebas de restauración (vacío). /estado muestra los objetivos. Identificador de petición de punta a punta (proxy, acciones, API, bitácora, errores). Alerta diaria a administración si un objetivo no se cumple (job gobierno.slo_watch). Runbook docs/runbooks/respaldo-y-restauracion.md. tests/db/gobierno.test.ts (GOB-07, 8 pruebas), tests/e2e/zx-gobierno.spec.ts.
- Missing: Recuperación a un punto en el tiempo habilitada y primera prueba de restauración (es de la plataforma; ADR-002 abierto). RPO, RTO y frecuencia de prueba: sin valor, [pendiente: Dan Mulligan]. Valores de los objetivos de servicio: los fija una persona, hoy sin fijar. Dictamen de residencia de datos [pendiente: Legal]. Trazas hacia una herramienta externa: adaptador apagado.
- Adapter turned off: traces (TRACES_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan (plataforma, RPO y RTO); Michael Essiet o Dan Mulligan (herramienta de trazas); Legal (residencia)

**GOB-08 · Datos de prueba sintéticos por mercado: Partial.**
- Source: package `gobierno`, 13-Nov-2026.
- Evidence: scripts/synthetic.mjs y scripts/synthetic-lib.mjs: generador reproducible por mercado (MX, US, SV), volumen y profundidad configurables (hasta 8 niveles), últimos 4 de una identificación fiscal con formato válido (RFC con dígito verificador, EIN, NIT), coordenadas, 7 días de ventas, 10 casos límite; idempotente; nunca en producción. /admin/gobierno (Datos de prueba): origen de los datos del ambiente, regla y corridas. Usado en pruebas de aislamiento por mercado y de cadena. Runbook docs/runbooks/staging-a-datos-sinteticos.md. tests/db/gobierno.test.ts (GOB-08, 3 pruebas), E2E.
- Missing: Staging sigue con datos reales de Pipedrive (excepción de ADR-005 sin firma): pasarlo a datos del generador es decisión de Michael Essiet o Dan Mulligan; el procedimiento está escrito y no se ejecutó. Vistas previas por rama (plataforma). El generador todavía no se usa en las pruebas de contrato.
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan

**GOB-09 · Costo unitario del CRM (FinOps): Partial.**
- Source: package `gobierno`, 13-Nov-2026.
- Evidence: /admin/gobierno (Costos): costos cargados a mano por mes y componente (plataforma, base, terceros, IA, soporte, otro), costo por persona activa y por comercio a cargo, referencia contra qué se compara (licencias que se dejan de pagar), anular sin editar, todo en bitácora. Vacío hasta que alguien cargue. Lo leen administración y leadership. tests/db/gobierno.test.ts (GOB-09), E2E.
- Missing: Costo por acción de IA: hoy n/a, CONTIGO no llama a ningún modelo (lo cierra el paquete ia registrando cada acción). Entrega mensual a Finanzas: no hay rol de Finanzas ni formato [pendiente: Finanzas]. Lectura automática de facturación: adaptador apagado.
- Adapter turned off: billing (BILLING_ADAPTER)
- Who unblocks or what it depends on: Finanzas (formato y costo de soporte); Dan Mulligan (plataforma con facturación legible)

**GOB-10 · Soporte y entrenamiento in-app: Partial.**
- Source: package `avisos`, 13-Nov-2026.
- Evidence: Ayuda contextual: enlace "¿Cómo se usa esto?" al pie de cada pantalla que abre /como-se-usa con las preguntas de esa pantalla (src/content/screen-help.ts) y la lección de Kore Academy si administración cargó el enlace (/admin/avisos, Lecciones por pantalla). Novedades de versión al entrar: anuncio de tema Novedades de CONTIGO, publicado por administración. Reporte con tiempos: recibido, en revisión (botón Empezar a revisar), respondido, con plazo por urgencia configurable por mercado y aviso a quien reportó (/reportar, /admin?tab=reportes). Pruebas: tests/db/avisos2.test.ts (GOB-10), tests/unit/avisos.test.ts, tests/e2e/zx-avisos.spec.ts.
- Missing: 1) Enlaces de las lecciones de Kore Academy: el campo existe, las direcciones no. 2) Canal de soporte por WhatsApp apagado y sin número definido. 3) Plazos de respuesta sin valor: no se inventaron, los pone administración. 4) Registro de qué se busca en la Ayuda (insumo de mejoras): no hecho, vive en ayuda/* y ui/help.tsx, que son del paquete de contenido.
- Adapter turned off: whatsapp (WHATSAPP_ADAPTER)
- Who unblocks or what it depends on: Responsable de Kore Academy (enlaces); Yamil y Customer Support (dueño, número y plazos del soporte); Michael Essiet o Dan Mulligan (revisión de tecnología)

## The 180 requirements
Source: `axexo-crm-requirements-v1` audited on 12-Nov-2026 (180 requirements). State before the build program: 58 built, 81 partial, 35 missing, 2 not applicable, 4 not verified.

Requirements already reported by a package of the program (49): 39 built, 10 partial. One line each:

| Requirement | Status | Package | Missing |
|---|---|---|---|
| E7.F2 | Built | `gobierno` | n/a |
| E7.F3 | Built | `gobierno` | Los nombres: ningún equipo tiene champion nombrado (el requerimiento los deja abiertos). |
| E7.F6 | Built | `gobierno` | n/a |
| E7.F7 | Built | `gobierno` | n/a |
| E7.F8 | Built | `gobierno` | n/a |
| E7.F9 | Partial | `gobierno` | El material mismo (presentación, guía de leads y preguntas frecuentes por mercado) no existe todavía y no está publicado en el portal de aprendizaje: [pendiente: Kore Academy]. |
| E10.F1 | Built | `us-embudo` | En staging las etapas vienen de la importación de Pipedrive: confirmar ahí que son las nueve (se renombran, crean y reordenan desde /admin). |
| E10.F2 | Partial | `us-embudo` | Operaciones todavía captura el estado por proveedor en el negocio y la tienda lo lee de ahí. La captura directa en la tienda es E9.F8 y E9.F10 del paquete us-ficha: al integrar, esa sección debe leer del portafolio de proveedores de la tienda. |
| E10.F3 | Built | `us-embudo` | n/a |
| E10.F5 | Built | `us-embudo` | n/a |
| E10.F6 | Built | `us-embudo` | n/a |
| E10.F7 | Built | `us-embudo` | n/a |
| E10.F8 | Built | `us-embudo` | n/a |
| E10.F9 | Built | `us-embudo` | n/a |
| E10.F10 | Built | `us-embudo` | n/a |
| E10.F11 | Built | `us-embudo` | n/a |
| E10.F13 | Built | `us-embudo` | n/a |
| E10.F14 | Built | `us-embudo` | n/a |
| E11.F1 | Built | `us-embudo` | n/a |
| E11.F3 | Partial | `us-embudo` | El imprimible de avisos no trae los datos nuevos del pedido (crm.deal_orders: paquetería, número de cliente, entrega, PO, dirección, términos, descripción) ni el descuento por línea (deal_items.discount_pct). Al integrar: sumarlos a orderPrint y a su pantalla. No lo pude hacer aquí porque ese código no está en design-v1. |
| E11.F4 | Partial | `us-embudo` | Lo mismo que E11.F3: el envío debe llevar los datos nuevos del pedido. El correo real sigue apagado (adaptador de avisos). |
| E11.F5 | Built | `us-embudo` | n/a |
| E12.F1 | Built | `us-embudo` | n/a |
| E12.F2 | Built | `us-embudo` | n/a |
| E12.F3 | Built | `us-embudo` | n/a |
| E12.F4 | Partial | `us-embudo` | Los ocho propósitos son una lista inicial mía, no la del sistema anterior: el documento no la trae. Falta que ventas de US confirme los ocho reales y se carguen desde la pantalla (no requiere código). |
| E12.F6 | Partial | `us-embudo` | Finanzas todavía no tiene acceso propio: hoy la descarga quien tiene permiso de exportar (administración, leadership, líder de mercado, supervisión). El acceso de Finanzas es E8.F5 (paquete reportes o seguridad). También sigue abierta la decisión de qué fuente usa Finanzas (por defecto, la herramienta de rutas). |
| E12.F8 | Partial | `us-embudo` | Elegir la herramienta de rutas, su aprobación de tecnología, exponer src/dal/routes.ts por la API de lectura de eventos-api y encender ROUTE_TOOL. El armado de la ruta y las millas los hace la herramienta externa. |
| E13.F1 | Built | `avisos` | El correo no sale: canal apagado. |
| E13.F2 | Built | `avisos` | Destinatarios por defecto internos (quien lleva el comercio, Operaciones): el requerimiento está abierto sobre si van al dealer. 'Dealer no longer open' se interpretó como negocio perdido. Los textos son borradores editables. El correo no sale: canal apagado. |
| E13.F3 | Built | `avisos` | El correo no sale: canal apagado. Por defecto exige consentimiento también para el acuse (se cambia por plantilla). |
| E13.F4 | Built | `avisos` | El enlace del video de recorrido está vacío hasta que administración lo cargue. |
| E14.F2 | Built | `mx` | n/a |
| E14.F3 | Built | `mx` | La carga completa desde las hojas (E18.F7 y F8) es del paquete integraciones-migracion: si trae su propio importador de tiendas, hay que dejar uno solo. |
| E14.F5 | Built | `mx` | Decisión por defecto: se conservaron Negociación, Pruebas y Alta y capacitación (las pidió el comité B2B) y se sumaron NDA y Contrato en el orden del documento. La lista final la decide el equipo B2B. |
| E14.F8 | Built | `mx` | Decisión por defecto: el embudo B2B de México se queda en 'primera transacción' (la recomendación del documento para todos los mercados). Pasarlo a 'contrato firmado o primera transacción' es un cambio en esa pantalla. |
| E15.F2 | Built | `mx` | n/a |
| E15.F3 | Built | `mx` | Decisión por defecto: la pregunta no es obligatoria (un lead nunca se pierde por un campo); sin respuesta, el lead nace sin tipo y se completa al calificar. |
| E15.F5 | Built | `mx` | n/a |
| E15.F6 | Partial | `mx` | El aviso fuera de la pantalla (correo o Slack) es del servicio de avisos del paquete avisos, que lo deja construido y apagado. Este paquete no agregó otro canal para no duplicarlo. |
| E15.F8 | Partial | `mx` | Al integrar: en src/domain/leads.ts el paquete avisos pregunta `opts.source === 'web_form'`; con este paquete los leads de campaña de México llegan como 'web_campaign' y se quedarían sin bienvenida. Hay que usar `isWebSource(opts.source)` (src/lib/lead-source.ts). La misma línea de `emit('lead.assigned')` trae conflicto de texto entre los dos paquetes. |
| E15.F9 | Built | `mx` | La alerta fuera de CONTIGO al llegar y al vencer la meta es del servicio de avisos (paquete avisos), apagada. |
| E16.F2 | Built | `mx` | Decisiones por defecto: un territorio sin gerente no cambia nada (regiones sin cobertura); al nombrar gerente pasan a él solo las tiendas que nadie llevaba o que llevaba el gerente anterior. Ningún territorio trae gerente cargado: lo elige administración. |
| E17.F4 | Built | `mx` | Decisión por defecto (el requerimiento está abierto): mientras las hojas viven, las visitas entran pegándolas; no hay conexión a la hoja. |
| E18.F2 | Built | `mx` | Decisión por defecto: la regla viene apagada en todos los mercados; la activa quien lidera el mercado o administración. |
| E18.F5 | Partial | `mx` | La presentación, la guía ya publicada y las sesiones: los produce y los da una persona. El producto guarda el enlace y quién lo dio por hecho. |
| E18.F6 | Built | `mx` | Seguir el método es trabajo de personas; el producto lo ordena y deja constancia. |
| E18.F9 | Built | `mx` | Decisión por defecto (el requerimiento está abierto): la base de correo es una descarga; no hay envío desde CONTIGO. |
| E18.F10 | Built | `mx` | Si el paquete reportes trae un centro de reportes, este reporte se enlaza desde ahí. |

## Deliberately out, per the committee's "what not to build"
Routing, check-in and GPS (Sales App), offline writes, commission calculation, KYB and OCR, a WhatsApp inbox, a visual workflow builder, a free-form report builder and autonomous agents. Catalog items that touch these are built up to the boundary and say so in their line.

## External technology: built and turned off
Email, Slack, WhatsApp, push, file storage, e-signature, maps and geocoding, tax providers, AI models, the Google directory, Zendesk, Zoho, event delivery over HTTP, traces and billing reads sit behind adapters in `src/server/adapters`. Each has an `off` implementation (default: it calls nothing and leaves the operation in a visible queue) and a `simulated` one for tests only. One environment variable per adapter turns it on; none is set. The status page (`/estado`) lists each adapter and what is missing to turn it on.

## Related documents
- Controls of the Engineering Standard, one by one: `docs/standard-compliance.md`.
- Decisions: `docs/adr/` (platform ADR-002, authorization ADR-003, identity ADR-004, Pipedrive data in staging ADR-005, design ADR-006).
- Runbooks: `docs/runbooks/` (backup and restore, deployment and rollback, moving staging to synthetic data).
- Pipedrive replacement: `docs/pipedrive-migration.md`. Contracts: `docs/contracts/`. Vocabulary: `docs/glosario.md`.
