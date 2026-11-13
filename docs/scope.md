# Scope against the full feature catalog (95 items)

Generated on 13-Nov-2026, first by the `gobierno` package of the build program and regenerated at integration 95-2 (packages integrated in `design-v1`: `automatizaciones`, `avisos`, `datos`, `eventos-api`, `reportes`, `embudo`, `integraciones-migracion`, `mx`, `us-embudo`, `us-ficha`, `campo-canal`, `ciclo-cs`, `gobierno`, `mercados`, `seguridad`, `partners-contratos`, `ia`, `integraciones2`). It replaces the earlier scope note, which listed 20 pilot items and 35 foundation items and gave several as built that the audit of 12-Nov-2026 found partial.

## How to read it
- **Sources.** The catalog `CRM-catalogo-funcionalidades-2026-11-11` (95 items), the audit of 12-Nov-2026 (state before the build program) and, for every item a package integrated in `design-v1` has reported, that package's result with its evidence, as checked by the integrator. An item with no integrated package report keeps the audited state and says so in its "Source" line.
- **Built** means the item does what the catalog says, can be used from the screen by the role it is for, in Spanish and English, at 1440 and 390 px, with database or domain tests and an end-to-end test of the main flow. Code with no screen, or a screen with no rule in the domain, does not count.
- **Built, external channel off** means everything inside CONTIGO is built and the part that talks to the outside is an adapter that is turned off until Michael Essiet or Dan Mulligan sign off (Tech Implementation Review).
- **Partial** always says exactly what is missing and who unblocks it.
- Evidence and "missing" lines are carried verbatim from the audit and the package reports, in Spanish, so nothing is reworded on the way. Status, structure and this guide are in English like the rest of `docs/`.
- The final re-audit of the 95 (same auditors, state after) supersedes this file when the program closes. Until then, regenerate it after each wave is integrated.

## Where the 95 stand
| Status | Items |
|---|---|
| Built | 22 |
| Built, external channel off | 26 |
| Partial | 45 |
| Missing | 0 |
| Not applicable | 2 |
| **Total** | **95** |

92 items carry a package report from the build program; 3 still show the audited state of 12-Nov-2026 because their package has not been integrated yet.

Check made when this file was generated: the integrated package reports cite 288 file paths as evidence and 287 of them exist in this tree.

## By domain
| Domain | Items | Built | Built, channel off | Partial | Missing | Not applicable |
|---|---|---|---|---|---|---|
| DAT · Modelo de datos, jerarquía e identidad | 7 | 1 | 1 | 5 | 0 | 0 |
| LEAD · Captura, atribución, ruteo y SLA | 5 | 1 | 1 | 3 | 0 | 0 |
| PIPE · Pipelines, etapas, transiciones y cierre | 8 | 2 | 4 | 2 | 0 | 0 |
| ACT · Actividades, timeline y tareas | 3 | 0 | 0 | 3 | 0 | 0 |
| CAMPO · Integración con la app de campo, supervisión y alta | 8 | 4 | 1 | 3 | 0 | 0 |
| CANAL · Canal, PRM, atribución y comisiones | 8 | 4 | 0 | 3 | 0 | 1 |
| CS · Customer success B2B | 8 | 3 | 5 | 0 | 0 | 0 |
| REP · Reportes, métricas y forecast | 4 | 0 | 0 | 4 | 0 | 0 |
| AUT · Automatización, eventos e integraciones | 7 | 1 | 1 | 5 | 0 | 0 |
| IA · IA asistida, agentes y guardas | 8 | 1 | 4 | 3 | 0 | 0 |
| MULTI · Multi-país, moneda, entidad, IDs fiscales y WhatsApp | 5 | 0 | 4 | 1 | 0 | 0 |
| SEG · Seguridad, privacidad y cumplimiento | 10 | 3 | 3 | 3 | 0 | 1 |
| UX · Experiencia de uso | 4 | 1 | 0 | 3 | 0 | 0 |
| GOB · Gobierno, adopción y operación | 10 | 1 | 2 | 7 | 0 | 0 |

## Item by item

### DAT · Modelo de datos, jerarquía e identidad

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| DAT-01 | Jerarquía de cuentas de N niveles con roll-ups | Must | F1 | Partial |
| DAT-02 | Relación contacto-cuenta con rol y vigencia | Must | F1 | Partial |
| DAT-03 | ID canónico y tabla de alias de IDs externos | Must | F1 | Built, external channel off |
| DAT-04 | Deduplicación y golden record | Must | F1 | Partial |
| DAT-05 | Campos por mercado vía metadata y procesos paralelos | Must | F1 | Partial |
| DAT-06 | Kit de ingesta de red adquirida con segregación previa | Should | F2 | Built |
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

**DAT-06 · Kit de ingesta de red adquirida con segregación previa: Built.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /partners/redes y /partners/redes/[id] (carga CSV con el lector de la importación a espacio segregado por entidad legal, mapeo de columnas guardado por sistema, problemas y repetidos por alias/teléfono/nombre+ciudad, reporte de calidad por nodo, liberación de legal y de negocio por dos personas, promoción por lotes con árbol, alias y origen 'conversión de red', marcha atrás por lote con bitácora); tests/db/partners.test.ts (DAT-06, 2 pruebas), e2e red
- Missing: Archivos grandes (más de 2 MB o 5,000 filas) necesitarían almacenamiento de archivos; hoy se parten en varias cargas.

**DAT-07 · Catálogo de productos y matriz de productos por PDV con estado por carrier: Partial.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: ficha Datos 'Productos y proveedores' (estado Solicitado, Enviado al proveedor, Aprobado, Activo, Rechazado, Suspendido, con fechas y 'Fuera del plazo de N días'; Operaciones agrega y cambia), /datos?tab=productos (proveedores con plazo editable, en espera y fuera de plazo; catálogo por mercado con proveedor; matriz filtrable por mercado, proveedor, estado y plazo; 'Activos que no lo tienen' como base de expansión). Modelo único: crm.account_products con historia en crm.account_product_events; un trigger en crm.deal_ops_checks (lo que Operaciones marca en el negocio) escribe la misma matriz. Reloj por proveedor en crm.ops_catalog.sla_days. Pruebas: tests/db/datos.test.ts 'DAT-07' (3), tests/e2e/zx-datos.spec.ts 'productos por comercio' (2). Integración de la ola 1 (13-nov): la sección "Productos y proveedores" de la ficha es la única vista de la aprobación por proveedor (E10.F2 de us-embudo lee de aquí).
- Missing: Entidad legal del producto: la columna existe, sin pantalla. La base de expansión es una lista de a quién ofrecerle el producto; no abre negocios de expansión. El filtro por producto está en Datos, no en la lista de Comercios.
- Who unblocks or what it depends on: Operaciones de US y MX para cargar el catálogo real de productos, proveedores y plazos

### LEAD · Captura, atribución, ruteo y SLA

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| LEAD-01 | Prospecto dentro del objeto cuenta | Must | F1 | Partial |
| LEAD-02 | Captura multicanal con atribución (UTM, click IDs, CTWA) | Should | F1 | Built, external channel off |
| LEAD-03 | Ruteo y asignación | Must | F1 | Partial |
| LEAD-04 | SLA de primer contacto con escalamiento | Should | F2 | Partial |
| LEAD-05 | Referidos comercio a comercio con atribución | Could | F2 | Built |

**LEAD-01 · Prospecto dentro del objeto cuenta: Partial.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Sin rehacer el modelo: un lead abierto se liga a un comercio existente desde su pantalla ('Comercio y etiquetas'), el comercio muestra sus leads abiertos y pasados (pestaña Datos) y al convertir un lead ligado el negocio entra en ese comercio, con su historia. src/domain/embudo/lead-links.ts. Pruebas: tests/db/embudo.test.ts 'un lead ligado a un comercio existente...', E2E.
- Missing: El catálogo pide que el prospecto sea la cuenta (sin objeto lead); los requerimientos v1 (E3.F1) confirman el lead como objeto aparte que se convierte. Se dejó el lead. Falta la decisión.
- Who unblocks or what it depends on: Yamil

**LEAD-02 · Captura multicanal con atribución (UTM, click IDs, CTWA): Built, external channel off.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Toques que solo se agregan, primero y último (crm.source_touches); UTM, clics de Google, Meta, TikTok, LinkedIn, X y Click to WhatsApp, página de llegada y de origen (sin lo que venga tras '?'), referido. Viaja al comercio y al negocio al convertir ('De dónde vino' en /deals/<id>). Filtros en /leads (fuente o campaña, clic de anuncio) y reporte en /reportes/embudo. Conversiones 'lead calificado' y 'primera transacción' en cola con llave propia (crm.conversion_events), visibles en /admin/embudo. Pruebas: tests/db/embudo.test.ts 'la atribución completa...', E2E.
- Adapter turned off: ad-conversions (AD_CONVERSIONS): envío a Google, Meta, TikTok, LinkedIn y X. La cola se llena y cada conversión queda como 'Canal apagado'.
- Who unblocks or what it depends on: MarTech (la auditoría dice 'Martech'; titular pendiente de confirmar: cuentas de anuncios y nombre de evento por plataforma); Dan Mulligan o Michael Essiet (aprobación)

**LEAD-03 · Ruteo y asignación: Partial.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Reglas ordenadas con condición (formulario, origen, tipo de venta, territorio, número de tiendas) y acción (heredar de quien lleva el comercio o su cuenta padre, persona, turno rotativo, quien cubre el territorio), tope por persona, simulador que no gasta el turno y bitácora: crm.assignment_rules, crm.assignment_log, app.rr_pick; src/domain/embudo/routing.ts; pantalla /admin/embudo. Aplican al formulario web y a leads importados. Pruebas: tests/db/embudo.test.ts 'LEAD-03 y E3.F10' (3), E2E regla + simulador + lead real.
- Missing: 1) 'Tienda saturada' como sugerencia para pasar al canal indirecto que el supervisor confirma: quedó el tope y el registro de a quién se saltó, no la sugerencia. 2) Rutear comercios que nacen por la Sales App (solo se rutean leads). 3) Una regla se pausa, se reordena y cambia de tope; para cambiar su condición se crea otra.
- Who unblocks or what it depends on: Liderazgo comercial (reglas de dueño de largo plazo, E16.F1)

**LEAD-04 · SLA de primer contacto con escalamiento: Partial.**
- Source: package `automatizaciones`, 13-Nov-2026.
- Evidence: Escalamiento del primer contacto en dos niveles, configurable por mercado en /admin/automatizaciones?v=leads (crm.lead_escalation; nace apagado): al vencer la meta sin intento, tarea en Hoy para supervisión; N horas hábiles después, para quien lidera. Visible en la guardia de leads de /supervisor ('Avisado a supervisión' / 'Avisado a quien lidera'). Corre por horario (job automatizaciones.escalamiento), no repite, se reinicia si el reloj vuelve a empezar y cierra sus avisos con el primer intento. Reasignación al vencer disponible como automatización (plantilla 'lead_overdue_reassign', en pausa). Pruebas: tests/db/automatizaciones.test.ts 'LEAD-04...' (3, incluida la reasignación); E2E zx-automatizaciones. Integración de la ola 1 (13-nov): el escalamiento avisa por el servicio único (tipo lead_escalated: campana, centro de avisos, Hoy hasta que se atiende el lead; correo y Slack por preferencia, apagados), ya no crea tareas. Pruebas: tests/db/automatizaciones.test.ts, tests/db/integracion-95-1.test.ts, tests/e2e/zx-integracion-95-1.spec.ts.
- Missing: 1) El reloj se sigue deteniendo con el primer intento, no con el contacto efectivo. 2) Zona horaria y calendario son los del mercado, no los del punto de venta; sin días feriados. 3) No hay tabla genérica de relojes para otras metas. 4) La línea base de 4 semanas en dealers antes de fijar la meta es una decisión de negocio. 5) El aviso solo llega dentro de CONTIGO.
- Adapter turned off: Correo, Slack y push (del paquete avisos)
- Who unblocks or what it depends on: Quien lidera ventas US (meta con línea base); Dan Mulligan o Michael Essiet (canales de aviso)

**LEAD-05 · Referidos comercio a comercio con atribución: Built.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Código y enlace de referido por comercio (/r/<código>, crm.referral_codes) con código QR propio en SVG (src/lib/qr.ts, sin librería nueva; verificado con un lector); el lead que entra por ahí queda atribuido al comercio (leads.referred_by_account_id y toque de origen, sin tocar las tres capas de atribución); cuando el referido hace su primera transacción queda en la bitácora del comercio que refirió y quien lo lleva recibe aviso; reporte de referidos (referidos, convertidos, con primera venta) en /reportes/embudo. Pruebas: tests/db/embudo.test.ts 'el enlace de referido...', E2E.
- Missing: El premio y su monto son reglas del programa: CONTIGO marca cuándo se cumple la condición, no calcula ni paga.
- Who unblocks or what it depends on: Liderazgo comercial (reglas del programa de referidos)

### PIPE · Pipelines, etapas, transiciones y cierre

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| PIPE-01 | Pipelines por motor con criterios de salida y campos por etapa | Must | F1 | Partial |
| PIPE-02 | Transiciones con dueño, evidencia y SLA (tipo Blueprint) | Should | F1 | Built, external channel off |
| PIPE-03 | Rotting y estancamiento | Should | F1 | Built |
| PIPE-04 | Motivos de pérdida y de no-venta codificados | Must | F1 | Partial |
| PIPE-05 | Revisita al decisor visible en el embudo | Must | F1 | Built |
| PIPE-06 | Cierre por evento transaccional (primer fondeo, primera transacción) | Must | F1 | Built, external channel off |
| PIPE-07 | Oferta comercial y contrato como objeto (CPQ-lite) | Should | F2 | Built, external channel off |
| PIPE-08 | Plan de integración compartido para KAM (mutual action plan) | Could | F2 | Built, external channel off |

**PIPE-01 · Pipelines por motor con criterios de salida y campos por etapa: Partial.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: La base impone los requisitos de etapa en toda vía de escritura: trigger crm.deal_stage_gate + crm.stage_missing (migración 0030), misma lectura que deals.ts:missingForStage. Importación de Pipedrive, carga de hojas y archivar etapa ya no saltan en silencio: lo que falta queda en crm.deal_stage_gaps, se ve en el negocio (aviso 'entró a su etapa sin lo que la etapa pide') y en /reportes/embudo. Requisitos con condición (mercado, tipo de cuenta, monto) en dominio y base: src/domain/embudo/stage-conditions.ts, pantalla /admin/embudo ('Embudos por tipo de venta y requisitos con condición', agrupado por tipo de venta con sus mercados). Pruebas: tests/db/embudo.test.ts 'PIPE-01' (3), tests/e2e/zx-embudo.spec.ts (condición).
- Missing: 1) Un solo embudo por tipo de venta compartido entre mercados: hoy sigue habiendo un embudo por mercado y tipo de venta; lo que quedó es la variante por metadata (condición por mercado) y la vista agrupada. Unificarlos cambia crm.pipelines.market_code y RLS: decisión de arquitectura. 2) En D2D los requisitos no llegan del evento de la Sales App (el contrato no los trae). 3) La base usa un trigger, no una función única con el update de stage_id revocado: el efecto es el mismo (ninguna escritura lo salta) sin reescribir las seis vías que hoy mueven etapas.
- Who unblocks or what it depends on: Yamil con Dan Mulligan (embudo global por tipo de venta); equipo de la Sales App (requisitos en el evento)

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
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: El motivo es obligatorio también en la base (checks activities_no_sale_reason y leads_disqualify_reason, además del de negocios). Catálogo con versión que sube sola (crm.catalog_versions) y publicada en GET /api/v1/catalogs (reason_catalog.version, is_active, motors). Código desconocido que llega de la Sales App: contado y a la vista (crm.unknown_reason_codes, /admin/embudo 'Catálogo de motivos'). Reporte por tipo de venta y mercado, pérdida y no venta: /reportes/embudo. Pruebas: tests/db/embudo.test.ts 'un código de motivo desconocido...'.
- Missing: Recortar el catálogo a 6-10 motivos con máximo 2 extensiones por mercado (hoy 19 de pérdida y 5 de no venta) y la custodia trimestral de C1: no se impuso el tope porque dejaría fuera motivos que hoy usan los equipos.
- Who unblocks or what it depends on: C1 (Yamil) con ventas: qué motivos quedan

**PIPE-05 · Revisita al decisor visible en el embudo: Built.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: El evento de visita acepta decision_maker_contact (nombre, rol, teléfono, mejor horario) y revisit_due: quien decide queda como contacto del comercio sin duplicar (crm.contacts.best_time), la revisita queda como tarea de visita con fecha y dueño aunque no haya negocio abierto, y el negocio toma el próximo paso (src/domain/embudo/revisit.ts). En el embudo: distintivo en la tarjeta (ya existía), filtro 'Revisita a quien decide (N)' en /pipelines/<id>?paso=revisita y conteo. Visitas por alta ganada en /reportes/embudo. Pruebas: tests/db/embudo.test.ts 'PIPE-05 y PIPE-04' (2 de 3), E2E filtro.
- Missing: La meta de visitas por alta y el costo de 'no estaba quien decide' salen de la línea base del piloto: no hay dato y no se inventó.
- Who unblocks or what it depends on: Liderazgo comercial MX (meta desde la línea base del piloto)

**PIPE-06 · Cierre por evento transaccional (primer fondeo, primera transacción): Built, external channel off.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Primer fondeo con método (efectivo, SPEI, ACH, Pix, otro), primera transacción y hábito por separado: crm.account_milestones + historia que solo se agrega crm.milestone_events. El archivo de ventas acepta first_funding_at, funding_method, habit_at, manifest y corrections (src/domain/embudo/closing.ts, docs/contracts/merchant-metrics-daily-v1.md). El fondeo pasa el negocio a 'esperando la primera venta'; la transacción lo gana. Manifiesto que no cuadra rechaza el archivo (409). Un corte recargado con otras cifras guarda antes y después (crm.metric_restatements). Corrección compensatoria: anular o corregir fecha, por archivo o por quien lidera el mercado ('Corregir un hito' en /deals/<id> y en el comercio, pestaña Datos; permiso deal.correct_win): reabre el negocio con evento de causa 'correction', tarea y aviso a quien lo lleva, comercio de vuelta a 'en alta'. Fecha de corte visible. Pruebas: tests/db/embudo.test.ts 'PIPE-06' (5), E2E 'quien lidera corrige un ganado que no lo era'.
- Missing: Decisión pendiente (no es construcción): qué embudos pueden ganarse a mano (close_by_transaction se puede apagar por embudo). El contrato con fondeo, método y hábito no está acordado con Data y Reportería.
- Adapter turned off: sales-file (SALES_FILE): ir a buscar el archivo. Hoy entra por POST /api/v1/metrics/daily.
- Who unblocks or what it depends on: Roxanna Quintero y Mauricio Fernandez (contrato y dónde se deja el archivo); Dan Mulligan o Michael Essiet (aprobación de tecnología); Yamil (embudos que se ganan a mano)

**PIPE-07 · Oferta comercial y contrato como objeto (CPQ-lite): Built, external channel off.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /comercios/[id]/contratos (términos versionados por cuenta y entidad, contrato con estado borrador/enviado/firmado/vigente/vencido/cancelado, renovación), /comercios/[id]/contratos/propuesta (vista imprimible desde la plantilla), tarea partners.contracts (vigente, vencido, aviso de renovación); tests/db/partners.test.ts (PIPE-07, 5 pruebas), tests/e2e/zx-partners-contratos.spec.ts
- Missing: Firma electrónica real (adaptador apagado, 'firmado' se marca a mano con fecha, firmante y enlace). Que los términos alimenten atribución y statements queda para el paquete de comisiones (CANAL-05).
- Adapter turned off: esign (CONTIGO_ESIGN_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (revisión de tecnología del proveedor de firma)

**PIPE-08 · Plan de integración compartido para KAM (mutual action plan): Built, external channel off.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /comercios/[id]/plan (plantilla de 6 hitos specs/sandbox/certificación/salida, dueño por hito de cada lado, fechas, estado, vencidos, días a certificación como línea base, ligado opcional al negocio); tests/db/partners.test.ts (PIPE-08), e2e plan
- Missing: Vista del cliente (misma identidad de externos, apagada: 'Compartir con el cliente' queda en cola).
- Adapter turned off: external_identity (CONTIGO_EXTERNAL_IDENTITY_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet

### ACT · Actividades, timeline y tareas

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| ACT-01 | Timeline único con actividades y notas de primera clase | Must | F1 | Partial |
| ACT-02 | Próximo paso obligatorio | Must | F1 | Partial |
| ACT-03 | Captura de comunicaciones (email, calendario, WhatsApp) | Should | F2 | Partial |

**ACT-01 · Timeline único con actividades y notas de primera clase: Partial.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Hilo completo del comercio, paginado, con actividades y notas, visitas de la Sales App, cambios de etapa, hitos de venta y tickets, y con lo de sus sucursales si se pide: /comercios/<id>/hilo (src/dal/embudo.ts:fullThread). Tickets de soporte como referencia (crm.ticket_refs; pestaña Hilo, 'Tickets de soporte'). Pruebas: tests/db/embudo.test.ts (tickets), E2E 'un ticket de soporte entra al hilo...'.
- Missing: Resumen semanal de ventas como entrada del hilo; tabla de actividades que solo se agrega y particionada por mes; clase de visibilidad por actividad; política de retención.
- Adapter turned off: support-desk (SUPPORT_DESK): traer el estado del ticket y abrirlo desde CONTIGO.
- Who unblocks or what it depends on: Customer Support (Eliana Alvarez, según CLAUDE.md del workspace: dirección de la mesa de soporte); Dan Mulligan o Michael Essiet (aprobación); Yamil (retención)

**ACT-02 · Próximo paso obligatorio: Partial.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: La base no deja un negocio abierto en una etapa sin próximo paso con fecha por ninguna vía (trigger de PIPE-01). Lista propia 'Sin próximo paso' (negocios, leads ya contactados y comercios en alta sin tarea siguiente) y 'Próximos pasos a más de 60 días' en /reportes/embudo, cada quien con su alcance. En D2D la revisita que llega de la Sales App deja el próximo paso del negocio.
- Missing: Leads y comercios en alta sin tarea siguiente salen en la lista, pero no abren aviso en la cola de supervisión (el tipo de aviso 'sin próximo paso' sigue siendo solo de negocios). La fecha del próximo paso sigue admitiendo hasta 366 días: se reporta, no se bloquea.

**ACT-03 · Captura de comunicaciones (email, calendario, WhatsApp): Partial.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /comercios/[id]/comunicaciones (correo, reunión o WhatsApp registrados a mano en el hilo con asunto, participantes, resumen, fecha y duración; escaneo de datos prohibidos; ventana de 24 h calculada y visible), modelo crm.activity_comms con fuente, referencia externa y teléfono E.164 listo para la sincronización; tests/db/partners.test.ts (ACT-03, 2 pruebas), e2e
- Missing: La sincronización automática (Gmail, Google Calendar, WhatsApp Cloud API o BSP): adaptadores apagados sin implementación real.
- Adapter turned off: gmail (CONTIGO_GMAIL_CAPTURE_ADAPTER), calendar (CONTIGO_CALENDAR_CAPTURE_ADAPTER), whatsapp_capture (CONTIGO_WHATSAPP_CAPTURE_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (revisión de tecnología de Gmail, Calendar y WhatsApp)

### CAMPO · Integración con la app de campo, supervisión y alta

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CAMPO-01 | Contrato de eventos CRM y Sales App, un solo creador de PDV | Must | F1 | Built, external channel off |
| CAMPO-02 | Next best store y frecuencias por segmento | Should | F2 | Built |
| CAMPO-03 | Cartera, territorios y reasignación | Must | F1 | Built |
| CAMPO-04 | Tablero del supervisor y cola de excepciones | Must | F1 | Partial |
| CAMPO-05 | KPIs de campo con trust score de visita | Should | F2 | Partial |
| CAMPO-06 | Expediente de alta y mesa de control | Must | F1 | Partial |
| CAMPO-07 | Inteligencia competitiva en el PDV | Should | F2 | Built |
| CAMPO-08 | Score 'PDV perfecto' consumido desde la Sales App | Could | F2 | Built |

**CAMPO-01 · Contrato de eventos CRM y Sales App, un solo creador de PDV: Built, external channel off.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: POST /api/v1/events/sales-app recibe visit.checked_out, store.created, onboarding.submitted y merchant.approved (src/domain/integrations.ts). Un solo creador de PDV: se busca por ID de Sales Core, luego por teléfono en el mercado, y solo entonces se crea; quien llega segundo se liga. Mensajes fuera de contrato o de un punto de venta desconocido quedan detenidos con motivo y se reprocesan. Pantalla /admin/integraciones?tab=sales-app: matriz de campos, eventos, simulador y mensajes detenidos. docs/contracts/sales-app-events-v1.md (matriz generada) y sales-app-events-v1.schema.json. Pruebas: tests/db/eventos-api2.test.ts (2 casos), tests/e2e/zx-eventos-api.spec.ts (1 caso).
- Missing: Lo que no depende del código: firmar el contrato con el equipo que lleva la Sales App y Sales Core, y conectar su sistema con una llave events:write. La primera transacción sigue llegando por el archivo diario de ventas, no como evento.
- Adapter turned off: conexión real con la Sales App (no hay adaptador saliente: es una entrada con llave)
- Who unblocks or what it depends on: Dan Mulligan (equipo de la Sales App y Sales Core)

**CAMPO-02 · Next best store y frecuencias por segmento: Built.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: store_priority con segmento A a D, frecuencia por segmento (umbral), puntaje, razones visibles y grupo de control por territorio; tarea campo-canal.store_priority; /campo?tab=prioridad; API GET /api/v1/field-signals para la Sales App; tests/db/campo-canal.test.ts 'CAMPO-02'
- Missing: Segmentos y frecuencias son valores de arranque: Ventas debe confirmarlos. La Sales App todavía no lee la API.
- Who unblocks or what it depends on: Ventas (segmentos y frecuencias)

**CAMPO-03 · Cartera, territorios y reasignación: Built.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: /campo?tab=cartera: plan de reparto en borrador con quién deja de ver y quién empieza a ver, aplicado en una sola transacción; canal como eje (channel_assignments, quién abre y quién cuida, con vigencia sin encimarse); polos con quien responde (territory_owners); perfil abre/cuida/ambas (seller_profiles); tests/db/campo-canal.test.ts 'CAMPO-03'; e2e plan en borrador

**CAMPO-04 · Tablero del supervisor y cola de excepciones: Partial.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: Avisos low_balance, under_plan y perfect_store_low con dueño, rule_key y rule_version (tarea campo-canal.field_exceptions); umbrales con versión y motivo en /campo?tab=umbrales (field_thresholds); metas por persona (rep_plans); salen en Mi equipo; tests/db/campo-canal.test.ts 'CANAL-07 y CAMPO-04'; integración ola 4: el aviso de saldo bajo pasó a la regla única de Cuidado de comercios (crm.cs_alerts); aquí quedan punto de venta y meta
- Missing: El saldo real depende de que el archivo de ventas lo traiga (hoy simulado). Calibrar umbrales el primer trimestre. Las reglas antiguas del motor de automatizaciones no se migraron a field_thresholds.
- Adapter turned off: funding-feed (CONTIGO_FUNDING_FEED)
- Who unblocks or what it depends on: Datos S5 (Roxanna Quintero) para el saldo; Ventas para metas y calibración

**CAMPO-05 · KPIs de campo con trust score de visita: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantalla /reportes/indicadores-campo: visitas por día, cobertura de cartera, efectividad y visitas por alta, por persona y total, con la señal de confianza a la vista (confirmadas por la Sales App, registradas a mano, fuera de la cuenta por señal baja). Columnas crm.visits.trust_score y trust_flags listas; una visita con señal menor a 50 no cuenta. Definiciones fieldPerDay, fieldCoverage, fieldEffect, fieldPerStore y fieldTrust en metric-defs con Ventas como responsable. Pruebas: tests/db/reportes.test.ts ('los indicadores de campo separan visitas confirmadas por la Sales App de las registradas a mano y dejan fuera las de señal baja'); tests/e2e/zx-reportes.spec.ts ('indicadores de campo con la señal de confianza').
- Missing: 1) La Sales App no manda trust_score ni trust_flags: el contrato de eventos no los trae y src/domain/integrations.ts no los lee todavía (las columnas existen; hoy ninguna visita se excluye). 2) Cumplimiento de ruta y distribución numérica no se construyeron: no hay rutas planeadas en CONTIGO. 3) El umbral de 50 es un valor por defecto sin acordar con Ventas.
- Who unblocks or what it depends on: Equipo de la Sales App (enviar la señal de confianza en el evento de visita); Ventas (umbral y definiciones)

**CAMPO-06 · Expediente de alta y mesa de control: Partial.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: /campo?tab=expedientes (abrir expediente, documentos con estado/enlace/quién validó/retención, mesa de control con plazo y reparto, aprobar/devolver, autoaprobación de prepago por regla, medición visita a aprobación y aprobación a primera venta); tablas onboarding_requirements (formulario maestro por país), onboarding_files, onboarding_documents, document_reads (0041); tests/db/campo-canal.test.ts 'CAMPO-06'; tests/e2e/zx-campo-canal.spec.ts
- Missing: La bóveda (archivo en bucket privado, URLs firmadas cortas) está apagada: hoy se guarda estado y enlace, nunca el archivo. Captura desde la Sales App o link autenticado: el contrato acepta captured_via pero no hay evento ni link. Datos de crédito y tax ID completos siguen fuera por el estándar.
- Adapter turned off: document-vault (CONTIGO_DOCUMENT_VAULT)
- Who unblocks or what it depends on: Comité (decisión #9, una sola bóveda con Sales Core); Michael Essiet o Dan Mulligan (aprobación de tecnología)

**CAMPO-07 · Inteligencia competitiva en el PDV: Built.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: competitors (lista por mercado) y account_competitors (competidor, producto, precio observado, fecha, fuente: visita, alta, pestañas abiertas del dealer o Sales App); captura en /campo?tab=competencia y en el evento visit.checked_out (campo competitors); reporte por competidor; tests y e2e
- Missing: Uso en ruteo a canal indirecto y alertas de pérdida de share: no construido (falta definir la regla con Ventas).
- Who unblocks or what it depends on: Ventas

**CAMPO-08 · Score 'PDV perfecto' consumido desde la Sales App: Built.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: perfect_store_scores (puntaje, ítems, fecha) desde el evento visit.checked_out (campo perfect_store); aviso perfect_store_low con umbral; /campo?tab=pdv; expuesto en GET /api/v1/field-signals; tests
- Missing: El checklist vive en la Sales App y todavía no lo manda.
- Who unblocks or what it depends on: Equipo de la Sales App

### CANAL · Canal, PRM, atribución y comisiones

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CANAL-01 | Portal de partners con visibilidad por subárbol | Should | F2 | Partial |
| CANAL-02 | Registro de PDV u oportunidad y reglas de compromiso | Should | F2 | Built |
| CANAL-03 | Atribución en 3 capas con fecha efectiva | Must | F1 | Built |
| CANAL-04 | Motor de comisiones y residuales | Won't | F3 | Not applicable |
| CANAL-05 | Visibilidad de comisión e incentivos por actividad sostenida | Should | F1 | Built |
| CANAL-06 | Tiers de partner, enablement y cruce de bases | Could | F3 | Built |
| CANAL-07 | Fondeo, saldo y límite de crédito por nodo | Should | F2 | Partial |
| CANAL-08 | Disputas, ajustes y clawbacks de atribución y comisión | Should | F2 | Partial |

**CANAL-01 · Portal de partners con visibilidad por subárbol: Partial.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /partners (portal del partner: su subárbol por RLS con estado del alta y etapa, nivel y material; para quien maneja: dar acceso de partner, invitar externo en cola, tokens), GET /api/partners/v1/accounts con token por subárbol (corre con la identidad del partner, RLS), baja automática al archivar o fusionar el nodo (trigger), persona sintética iso.partner; tests/db/partners.test.ts (CANAL-01, 3 pruebas), e2e portal y token
- Missing: Entrada de usuarios externos (adaptador apagado) y, por eso, el alta delegada de usuarios y sub-dealers desde el portal y la superficie dentro de axexo Business. 'Ver como' auditado ya existe (seguridad).
- Adapter turned off: external_identity (CONTIGO_EXTERNAL_IDENTITY_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (identidad de externos) y P&T dueño de axexo Business

**CANAL-02 · Registro de PDV u oportunidad y reglas de compromiso: Built.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: channel_claims con ventana de protección (umbral), extensión con evidencia hasta un máximo, rechazo con motivo, respuesta mínima (hasta cuándo, sin decir de quién), no se registra una tienda que ya es cliente, RLS que deja fuera a la venta directa, tarea campo-canal.claims_expiry; /campo?tab=registros con las reglas publicadas; tests y e2e
- Missing: Ventana por defecto 14 días con 2 extensiones de 14: decisión por defecto, a confirmar por Ventas y canales. No hay portal del aliado: registra quien lidera el mercado a su nombre.
- Who unblocks or what it depends on: Ventas y canales (reglas de compromiso)

**CANAL-03 · Atribución en 3 capas con fecha efectiva: Built.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: Restricción de exclusión account_attributions_no_overlap (btree_gist); columnas reason, correction_of, origin_kind (red adquirida o alta nueva); corrección de origen y canal como fila nueva en /campo?tab=atribucion; reporte del ciclo (huecos, correcciones, disputas); la fusión ya no encima vigencias (src/domain/datos.ts); tests/db/campo-canal.test.ts 'CANAL-03'; e2e
- Missing: Arbitraje de Finanzas: no existe rol de Finanzas, por defecto arbitra quien lidera el mercado o administración.
- Who unblocks or what it depends on: Finanzas y Ventas (quién arbitra)

**CANAL-04 · Motor de comisiones y residuales: Not applicable.**
- Source: audit of 12-Nov-2026 (before the build program); no package of the program owns it.
- Evidence: El catálogo lo marca Won't (F3). docs/scope.md lo deja fuera a propósito ('commission calculation'). En código solo existe el campo de texto b2b_commission 'Comisión acordada' (0016).
- Who unblocks or what it depends on: P&T confirme si EMIDA o Movilway ya liquidan

**CANAL-05 · Visibilidad de comisión e incentivos por actividad sostenida: Built.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantalla /reportes/lo-que-llevo (ventas; supervisión y quien lidera pueden elegir a una persona de su alcance): altas, primeras ventas y activos a 30, 60 y 90 días de su cartera, por periodo, con la nota de que el pago lo calcula otro sistema. Sin montos, sin comisión y sin lugar en una tabla. Definiciones carryStores, carryFirstSales y carryActive en metric-defs. Pruebas: tests/db/reportes.test.ts ('altas, primeras ventas y activos a 30, 60 y 90 días salen de la cartera de la persona y del archivo de ventas'); tests/e2e/zx-reportes.spec.ts ('quien vende ve sus altas, primeras ventas y activos a 30, 60 y 90 días, sin montos de comisión').
- Missing: Descartado por el catálogo para esta fase y no construido: cálculo de comisiones, marca estimado contra publicado y commission_statement (F2). 'Activo a N días' se lee del archivo de ventas más cercano a esa fecha (7 días de margen): si Data y Reportería publica cohortes propias a 60 y 90 días, hay que leerlas de ahí. Sin vista para ACE ni aliados (no existen como usuarios).
- Who unblocks or what it depends on: Ventas y Finanzas (reglas de incentivo escritas); Data y Reportería (cohortes a 60 y 90 días)

**CANAL-06 · Tiers de partner, enablement y cruce de bases: Built.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /partners (registro de partners, niveles con criterios publicados: puntos activos, calidad de altas a 90 días, cumplimiento; material por nivel como enlace a Kore Academy; cruce de bases por teléfono, alias e índice ciego fiscal con acceso restringido), tareas partners.tiers y partners.crossmatch, historial por período; tests/db/partners.test.ts (CANAL-06, 3 pruebas), e2e
- Missing: Leer el avance real de Kore Academy (hoy solo el enlace) y correr el cruce en el lakehouse de S5 (hoy corre en la base de CONTIGO).
- Who unblocks or what it depends on: Kore Academy (exponer avance) y Data y Reportería (lakehouse)

**CANAL-07 · Fondeo, saldo y límite de crédito por nodo: Partial.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: account_funding (método, saldo, límite, fecha de corte, fuente), historial y simulador marcado como tal (solo administración, fuera de producción) en /campo?tab=credito; límite de crédito pedido y aprobado por otra persona (credit_limit_requests); adaptador funding-feed apagado y tarea campo-canal.funding_pull; tests y e2e
- Missing: El dato real: el archivo de ventas o el core no exponen fondeo, saldo ni límite. El límite aprobado no se escribe al core.
- Adapter turned off: funding-feed (CONTIGO_FUNDING_FEED)
- Who unblocks or what it depends on: Datos S5 (Roxanna Quintero) o core; Michael Essiet o Dan Mulligan

**CANAL-08 · Disputas, ajustes y clawbacks de atribución y comisión: Partial.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: attribution_disputes (disputa, ajuste, reverso) con plazo (umbral), árbitro distinto de quien la levanta, resultado auditado y fila corregida con correction_of; /campo?tab=disputas sin montos; tests y e2e
- Missing: Política de clawback por escrito: hasta que exista no se muestra ningún monto.
- Who unblocks or what it depends on: Finanzas y Ventas (política de clawback)

### CS · Customer success B2B

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CS-01 | Lifecycle del comercio con handoffs con dueño | Must | F1 | Built |
| CS-02 | Health score explicable y validado | Should | F2 | Built, external channel off |
| CS-03 | Alertas tempranas y playbooks de activación y reactivación | Must | F1 | Built, external channel off |
| CS-04 | Segmentación dinámica por modelo de atención | Should | F2 | Built, external channel off |
| CS-05 | Account management corporativo/API | Should | F2 | Built, external channel off |
| CS-06 | Capacitación del comercio y cambio de encargado | Should | F2 | Built, external channel off |
| CS-07 | Pipeline de expansión y cross-sell sobre comercio activo | Should | F2 | Built |
| CS-08 | Feedback de producto desde campo | Could | F2 | Built |

**CS-01 · Lifecycle del comercio con handoffs con dueño: Built.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: Migración 0042: crm.account_care (8 etapas), crm.lifecycle_events (historial con origen), crm.lifecycle_windows (por mercado y línea de producto, histéresis, días mínimos en etapa), app.lifecycle_recalc, app.lifecycle_backtest, crm.handoffs (de/a papel, dueño, fecha, lista, acuse). Pantallas /comercios/<id>/cuidado, /cuidado, /admin/cuidado. Job ciclo-cs.lifecycle. tests/db/ciclo-cs.test.ts (CS-01, 10 pruebas); tests/e2e/zx-ciclo-cs.spec.ts.
- Missing: Umbrales calibrados con datos propios reales: la calibración está construida y pide 30 comercios con dos cortes; hoy hay valores de fábrica (5/8/20/15/90/3) marcados como tales.
- Who unblocks or what it depends on: Data y Reportería (archivo de ventas con historia suficiente)

**CS-02 · Health score explicable y validado: Built, external channel off.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: crm.health_config (pesos editables), app.health_snapshot_run (tope por grupo, decay, explicación por grupo guardada), crm.health_validations y app.health_backtest (precisión y recall por modelo de atención); no se publica sin validación de 30+ comercios. Pruebas CS-02 (4).
- Missing: Publicación real pendiente de validación con datos de producción. Grupos mix/tickets/saldo sin dato hasta encender conexiones.
- Adapter turned off: zendesk_counts (ZENDESK_COUNTS_ADAPTER); care_signals (CARE_SIGNALS_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (Zendesk); Data y Reportería (señales)

**CS-03 · Alertas tempranas y playbooks de activación y reactivación: Built, external channel off.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: crm.cs_settings (N, caída, saldo bajo, grupo de control, límite de mensajes), crm.playbooks editables por mercado y modelo de atención, crm.cs_alerts crea tarea con pasos al dueño según modelo de atención, cierre solo, medición returned_14d/30d contra grupo de control, crm.cs_messages con consentimiento del registro de Seguridad (crm.consents, app.may_contact). Job ciclo-cs.alerts. Pruebas CS-03 (4).; integración ola 4: es la única regla de saldo bajo (umbral de Cuidado de comercios; saldo de crm.account_balance_latest, que junta fondeo y señales)
- Missing: Alertas apagadas por defecto en cada mercado (decisión por defecto): las enciende quien lidera. Saldo bajo depende de la conexión de señales.
- Adapter turned off: whatsapp (WHATSAPP_ADAPTER); care_signals (saldo)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (WhatsApp Business); Data y Reportería (saldo)

**CS-04 · Segmentación dinámica por modelo de atención: Built, external channel off.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: service_tier en crm.account_care, app.service_tier_recalc con comisión como variable principal y volumen como secundaria, histéresis por margen, tipo de cuenta manda; historial crm.service_tier_events; umbrales en /admin/cuidado. Prueba CS-04.
- Missing: Comisión real por comercio: hoy se estima con volumen x tasa del mercado y la pantalla lo dice.
- Adapter turned off: care_signals
- Who unblocks or what it depends on: Data y Reportería o quien liquida

**CS-05 · Account management corporativo/API: Built, external channel off.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: Quien cuida la cuenta se nombra por entrega con acuse (to_role am); crm.account_plans, crm.account_relationships (rollup a la más débil), crm.account_reviews con minuta y próxima revisión; borrador con datos sin IA. Solo cadenas, distribuidores, organizaciones y dedicadas. Prueba CS-05.; integración ola 4: el borrador con IA pasa por el adaptador único de AI (AI_ADAPTER), sin interruptor propio
- Missing: Borrador de QBR con IA.
- Adapter turned off: ai_draft (AI_DRAFT_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan

**CS-06 · Capacitación del comercio y cambio de encargado: Built, external channel off.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: crm.training_completions (fuente kore_academy o manual, sin contenido), crm.manager_changes desde la visita; ambos alimentan alertas (manager_change) y la constancia la cierra. Pruebas CS-06 (2).
- Missing: Evento real de Kore Academy.
- Adapter turned off: kore_academy (KORE_ACADEMY_ADAPTER)
- Who unblocks or what it depends on: Equipo de Kore Academy y Michael Essiet o Dan Mulligan

**CS-07 · Pipeline de expansión y cross-sell sobre comercio activo: Built.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: crm.expansion_rules por mercado (opcional producto del catálogo), app.expansion_run solo sobre activos con actividad real y sin el producto en la matriz, crm.expansion_opportunities hija de la cuenta con embudo por tomar/en conversación/aceptó/no aceptó, tarea al tomar, no reabre en 90 días. Prueba CS-07.

**CS-08 · Feedback de producto desde campo: Built.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: crm.feedback_topics (8 temas fijos), crm.product_feedback con tipo y estado, nota en el hilo, respuesta de quien lidera, conteo por tema en /cuidado?vista=comentarios, resumen semanal crm.feedback_digests (job ciclo-cs.feedback_digest). Prueba CS-08.
- Missing: Envío del resumen por correo o Slack (dentro de CONTIGO sí se ve).

### REP · Reportes, métricas y forecast

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| REP-01 | Dashboards por rol y jerarquía (panel del LT) | Must | F1 | Partial |
| REP-02 | Snapshots históricos, eventos de etapa y cohortes | Must | F1 | Partial |
| REP-03 | Forecast por motor | Could | F3 | Partial |
| REP-04 | Capa de métricas única y conciliación con S5 | Must | F1 | Partial |

**REP-01 · Dashboards por rol y jerarquía (panel del LT): Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Pantallas: /reportes (galería por rol + Mis reportes + Reportes que te llegaron), /reportes/indicadores (cada indicador con definición y quién responde; administración lo edita, queda en crm.metric_owners y en la bitácora), /reportes/cuentas (agregado por cadena, ISO o distribuidor con sus hijos a cualquier profundidad + tablero de cuentas clave: etapas largas y próximos hitos; 'Mis cuentas'), /reportes/leads, /reportes/etapas, /reportes/agencias, /reportes/finanzas. Reportes guardados (privado o compartido con el mercado) y programados (job reportes.scheduled: deja el resumen dentro de CONTIGO). El Panel del LT y cada reporte muestran quién responde en 'Cómo se calcula'. Pruebas: tests/db/reportes.test.ts ('el dueño lo cambia administración', 'cada cadena suma todas sus tiendas', 'un reporte guardado es privado', 'un reporte programado llega a su dueño'); tests/e2e/zx-reportes.spec.ts ('está en el menú de todos y cada rol ve los reportes de su alcance', 'cada indicador tiene definición y quién responde', 'cadenas y distribuidores con el agregado', 'un reporte se guarda con sus filtros'). Integración de la ola 1 (13-nov): el Reporte del mercado (mx) está en la galería.
- Missing: Lo que pide el encargo quedó construido. Contra el catálogo falta: 1) Tablero de partner (no existe ese rol ni usuarios aliados: depende de CANAL-03) y un tablero propio de Operaciones (hoy: su cola y los reportes de la galería). 2) No existe un rol KAM: el tablero de cuentas clave lo ve quien lleva cuentas B2B y quien dirige. 3) El envío por correo del reporte programado queda apagado (adaptador report_mail); Slack no se construyó. 4) La entrega vive en Reportes ('Reportes que te llegaron', tabla crm.report_deliveries): falta recablearla al servicio único de avisos (src/domain/notify.ts) cuando el paquete avisos esté integrado. 5) Los responsables por defecto son por área: C1 debe confirmar los 5 a 7 indicadores por rol y su responsable. 6) El corte 'por tipo de venta' sigue resolviéndose por embudo. 7) Las pantallas anteriores (Mi equipo, Hoy, Operaciones) no se reescribieron para leer sus textos de metric-defs: solo el Panel del LT y los reportes nuevos lo hacen.
- Adapter turned off: report_mail (REPORT_MAIL_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (Tech Implementation Review del correo); Yamil / C1 (indicadores y responsables por rol)

**REP-02 · Snapshots históricos, eventos de etapa y cohortes: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Migración 0022: crm.pipeline_snapshots y crm.portfolio_snapshots, función app.take_report_snapshots() (SECURITY DEFINER: cuenta el mercado completo, no lo que ve quien corre la tarea), job reportes.snapshot en src/server/jobs/reportes.ts. Pantalla /reportes/historico: foto diaria con gráfica SVG, cohortes de leads del mes convertidos a 30, 60 y 90 días, cohortes de altas con primera venta, velocidad por etapa (mediana y percentil 90), y el archivo de salida en cola con 'Canal apagado'. Pruebas: tests/db/reportes.test.ts ('la foto la toma la tarea con identidad propia, cuenta todo el mercado y se puede repetir el mismo día', 'quien vende no puede tomar la foto', 'la velocidad por etapa mide lo que tarda un negocio'); tests/e2e/zx-reportes.spec.ts ('la foto diaria se toma, el histórico muestra cohortes y velocidad'). Integración de la ola 1 (13-nov): verificado y sin cambio: Mi equipo, Hoy y la ficha todavía no leen sus cifras de la capa de indicadores (queda para la ola de residuos).
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
- Evidence: src/domain/intake.ts: las mismas reglas de entrada para pantalla (createAccount), API (ingestStore, que ahora crea el comercio con insertAccountTx, la función de alta), importación de Pipedrive (accountRule, dealRule, leadRule antes de cada inserción; la fila que no cumple se salta con motivo en el resumen) y automatizaciones (toda acción llama a moveDealTx, assignLeadTx, setWaitingOnTx y a la guarda de datos prohibidos). Invariante en Postgres para toda vía: trigger crm.deal_integrity (etapa de su embudo, embudo de su mercado). Pruebas de contrato por vía: tests/db/automatizaciones.test.ts 'AUT-01: la misma regla en toda vía de entrada (contrato)' (4) y tests/unit/automatizaciones.test.ts (ninguna tabla de negocio se escribe fuera de src/domain). Integración de la ola 1 (13-nov): dos escrituras que quedaban fuera del dominio se movieron: límites de formularios (src/domain/form-guard.ts setFormLimits) y la cola del archivo de la foto diaria (src/domain/reportes.ts). El alta de tienda desde la Sales App rechaza el dato prohibido en el nombre igual que la pantalla (antes lo guardaba tachado).
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
- Evidence: Pantalla /admin/automatizaciones (lista por mercado, detalle 'Cuando/Si/Entonces', crear desde plantilla, formularios de condiciones y acciones, pausar, 'Probar contra un registro', bitácora por regla) y /admin/automatizaciones?v=pasos (pasos con aprobación). Migración 0019 (crm.automations, automation_log, automation_state, stage_transitions, approvals). Motor: src/domain/automation/engine.ts; las 9 reglas de src/domain/rules.ts son definiciones sembradas por mercado (DEFAULTS en catalog.ts) y evaluateRules conserva su contrato. Disparo por horario (job automatizaciones.reglas) y por evento del dominio leyendo la cola de eventos (job automatizaciones.eventos). Pruebas: tests/db/automatizaciones.test.ts 'AUT-03: las reglas son datos...' (5), tests/unit/automatizaciones.test.ts, tests/e2e/zx-automatizaciones.spec.ts. Verificado el 13-nov: vitest completo 459 pruebas en 36 archivos en verde; E2E zx-automatizaciones 5 de 5 en verde. Integración de la ola 1 (13-nov): la acción "Avisar a una persona o a un rol" manda un aviso por el servicio único (tipo automation), ya no una tarea con prefijo "Aviso:". Pruebas: tests/db/automatizaciones.test.ts.
- Missing: No hay pasos con aprobación preconfigurados (alta, crédito ACH): se configuran en pantalla; quién aprueba y quién suple lo definen C1 y mesa de control. Los avisos de una automatización llegan como tarea en Hoy; correo, Slack o push dependen del paquete avisos.
- Adapter turned off: Disparo externo por horario (CRON_SECRET)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (secreto y programador de la plataforma); C1 y mesa de control (aprobadores)

**AUT-04 · API y entornos de prueba: Partial.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: GET /api/v1/accounts, /deals, /leads, /activities y /catalogs con llave de un mercado y alcances mínimos, cursor, filtros validados y los permisos de quien creó la llave (RLS). Límite por llave y por IP en la base con 429 y Retry-After; 20 llaves inválidas por minuto por IP y después 429. Rotación con dos llaves vigentes y fecha de retiro, último uso, revocar con confirmación. Pantalla /admin/integraciones?tab=api con llaves y documentación. docs/contracts/api-v1.md y api-v1.openapi.json (generados). Llaves de prueba ctg_test_: leen un juego sintético en memoria (src/server/api-sandbox.ts), nunca las tablas del negocio. Pruebas: tests/db/eventos-api.test.ts (5 casos de AUT-04), tests/e2e/zx-eventos-api.spec.ts (2 casos). Integración de la ola 1 (13-nov): las llaves de lectura y de escritura se crean, rotan y revocan en una sola pantalla y por una sola función (src/domain/api-keys.ts); se quitó la tarjeta de llaves de la pestaña anterior.
- Missing: 1) API de escritura general sobre el dominio (el encargo pidió lectura). 2) Tokens de socios acotados a un subárbol: hoy la llave se acota a un mercado. 3) Entornos por rama (branches de Supabase, previews de Vercel): no se tocó infraestructura; se resolvió con llaves de prueba. 4) La API v1 no expone teléfonos, correos, nombres de contacto ni texto de notas: si un consumidor los necesita, es decisión de C1.
- Who unblocks or what it depends on: Yamil Alvarez (alcance de la v1 y datos de contacto); Dan Mulligan (plataforma y entornos por rama)

**AUT-05 · Servicio de notificaciones centralizado: Partial.**
- Source: package `avisos`, 13-Nov-2026.
- Evidence: Servicio único src/domain/notify.ts (notify, notifyMany, notifyOutside) con registro crm.notifications (canal, plantilla, destinatario, costo, estado). Pantallas: campana con contador en la barra, /avisos (leído y sin leer, enlace al registro), /avisos/preferencias (tipo por canal y resumen diario), Hoy muestra los que piden acción, /admin/avisos (canales, cola de salida, plantillas, por mercado), /estado (cada canal apagado y qué falta). Horario hábil, resumen y límite diario de WhatsApp en dominio. Menciones, devoluciones, negocio ganado, segunda solicitud web y llegada de lead pasan por el servicio. Pruebas: tests/db/avisos.test.ts, tests/unit/avisos.test.ts, tests/e2e/zx-avisos.spec.ts. Integración de la ola 1 (13-nov): el corredor ya corre avisos.lead_goal, avisos.release y avisos.digest. También pasan por notify.ts los avisos de una automatización (tipo automation), el escalamiento de leads (lead_escalated), los reportes programados (scheduled_report) y la alerta de exportaciones a administración (export_alert). Prueba de que nadie escribe avisos por su lado: tests/db/integracion-95-1.test.ts.
- Missing: 1) Canal push: no se construyó (no estaba en el encargo; pide service worker y proveedor). 2) El servicio se llama dentro de la transacción del cambio; no se alimenta del publicador del outbox (AUT-02, paquete eventos-api). 3) Correo, Slack y WhatsApp quedan apagados; WhatsApp a personas no tiene a dónde ir porque CONTIGO no guarda su teléfono.
- Adapter turned off: email (EMAIL_ADAPTER), slack (SLACK_ADAPTER), whatsapp (WHATSAPP_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (revisión de tecnología)

**AUT-06 · Ingesta del lakehouse por archivos diarios: Partial.**
- Source: audit of 12-Nov-2026 (before the build program); no package of the program owns it.
- Evidence: src/domain/integrations.ts:ingestMetricsFile y loadMetrics: lote en crm.ingest_batches (as_of, file_name, checksum, row_count, mode, status, matched, unmatched), idempotente por checksum, cuarentena si un archivo completo cambia más de 20% de tamaño, rechazo completo si el formato no cumple, gana el negocio y mueve el estado del comercio. Frescura visible en /estado ('Último archivo: corte del..., cargado el...') y en /admin?tab=integraciones 'Archivos diarios de ventas: 255 de 255 filas ligadas' (observado). Pruebas: tests/db/domain.test.ts 'un archivo completo que cambia más de 20% de tamaño queda en cuarentena...' y 'el archivo de S5 con formato inválido se rechaza completo'.
- Missing: 1) No hay alerta si el archivo no llega: /estado muestra el último corte, pero nada abre un aviso ni notifica. 2) Reprocesar un corte ya cargado con otro contenido sobrescribe los valores (on conflict do update) sin evento compensatorio ni valor anterior: queda el lote y su auditoría, no la corrección. 3) Datos tardíos: un archivo con as_of anterior al último cargado aplica cambios de estado igual; sin verificar en prueba, no hay guarda en el código. 4) No hay archivo de manifiesto: la carga es un JSON por POST de hasta 20,000 filas, no un archivo con manifiesto. 5) Sin conexión real con S5 (solo el botón de prueba de Administración y la llave metrics:write).
- Who unblocks or what it depends on: S5 (Data & Reporting): formato, horario y manifiesto; AUT-03 y AUT-05 para la alerta

**AUT-07 · Import y export masivo gobernado: Built.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: Importar: /importar (administración y líder de mercado; enlace desde Comercios y Leads): plantilla descargable, vista previa que valida todo sin escribir (errores y duplicados por fila con las reglas de DAT-04), corrida en lotes por los comandos de dominio y guard.ts, bitácora por fila con reporte descargable, y Deshacer. El archivo se procesa en memoria y no se guarda. Exportar: motivo obligatorio, tope por rol, crm.export_log con filtros y conteo, alerta por umbral diario; aplica a negocios cerrados y reporte de campo, y agrega comercios y leads de lo filtrado (/comercios/export, /leads/export). Administración lo ve en /admin/integraciones?tab=datos. Pruebas: tests/db/eventos-api2.test.ts (10 casos), tests/e2e/zx-eventos-api.spec.ts (2 casos). Integración de la ola 1 (13-nov): las ocho descargas del producto (comercios, leads, cerrados, campo, galería, detalle de visitas, reporte del mercado y base de correo) pasan por la misma regla; la alerta del umbral diario le llega a administración por el servicio de avisos; la bitácora de exportaciones nombra cada tipo. Pruebas: tests/db/integracion-95-1.test.ts, tests/e2e/zx-integracion-95-1.spec.ts.

### IA · IA asistida, agentes y guardas

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| IA-01 | Captura asistida (voz, documentos, conversaciones) | Should | F2 | Partial |
| IA-02 | Next best action explicable | Could | F3 | Built |
| IA-03 | Calificación y clasificación de leads asistida | Could | F3 | Built, external channel off |
| IA-04 | Agentes con autonomía graduada | Could | F2 | Built, external channel off |
| IA-05 | Consulta en lenguaje natural sobre métricas definidas | Could | F2 | Built, external channel off |
| IA-06 | Servidor MCP del CRM | Could | F2 | Partial |
| IA-07 | Guardas contra inyección y fuga de datos | Must | F1 | Partial |
| IA-08 | Evaluación de IA | Should | F2 | Built, external channel off |

**IA-01 · Captura asistida (voz, documentos, conversaciones): Partial.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: Nota del comercio con botón 'Dictar' (reconocimiento de voz del navegador, solo si existe), texto en borrador que la persona revisa antes de guardar, sin audio guardado: src/ui/dictation.tsx; caso de evaluación 'capture' rechaza datos prohibidos
- Missing: OCR de documentos del alta y transcripción de reuniones a draft_fields con confianza: dependen de la bóveda de documentos, de la Sales App y de un servicio aprobado; quedan apagados en el adaptador. Dictado en el registro de visita (hoy solo en la nota).
- Adapter turned off: AI_ADAPTER (lectura de documentos y transcripción)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan; dueño de la bóveda de documentos

**IA-02 · Next best action explicable: Built.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: /asistencia (Sugerencias), ficha /comercios/[id] bloque 'Antes de la visita'; crm.recommendations (señal, vence, si se siguió, qué pasó, grupo de control por territorio en /admin/ia); jobs ia.next_actions e ia.measure; tests/db/ia.test.ts IA-02; tests/e2e/zx-ia.spec.ts 1 y 2
- Missing: Límite por ruta (hoy es por comercio). El 'ayudan o no' solo se afirma con 30 medidas por grupo y algún territorio marcado como control: decisión de quien lidera.

**IA-03 · Calificación y clasificación de leads asistida: Built, external channel off.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: Lead /leads/[id] tarjeta 'Calificación' (puntaje con cada punto, clase propuesta, confirmación humana); pesos por mercado en /admin/ia?tab=calificacion; crm.lead_score_weights, crm.lead_classifications; tests/db/ia.test.ts IA-03; e2e zx-ia 3
- Missing: Clasificación de texto libre con modelo: construida tras el adaptador y apagada (lista cerrada de 5 clases, texto citado como no confiable, sin herramientas).
- Adapter turned off: AI_ADAPTER (src/server/adapters/ai.ts)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (revisión de tecnología)

**IA-04 · Agentes con autonomía graduada: Built, external channel off.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: /admin/ia: nivel por mercado (apagado, sugiere, redacta, ejecuta con aprobación), quien supervisa obligatorio, revisión semanal, costo por acción; /asistencia?tab=borradores aprobar o rechazar con motivo; resumen de cuenta de solo lectura en la ficha; registro en crm.ia_calls y bitácora; agente único por reglas con prueba de la tríada (src/domain/ia/agents.ts); tests IA-04; e2e zx-ia 5
- Missing: Agentes con modelo: no hay ninguno (apagado por regla).
- Adapter turned off: AI_ADAPTER
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan

**IA-05 · Consulta en lenguaje natural sobre métricas definidas: Built, external channel off.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: /asistencia?tab=preguntas: 9 preguntas sobre lib/metric-defs.ts con periodo, mercado y equipo; número + definición + corte; fuera de lo definido no contesta; permisos de la persona (RLS); tests/db/ia.test.ts IA-05; e2e zx-ia 4
- Missing: Interpretación libre de preguntas con modelo: apagada.
- Adapter turned off: AI_ADAPTER
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan

**IA-06 · Servidor MCP del CRM: Partial.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: src/server/mcp/tools.ts (4 herramientas de solo lectura, como la persona, capacidad por herramienta, 50 filas, bitácora ia.mcp_read con vía mcp); src/app/api/mcp/route.ts responde 404 sin MCP_SERVER; docs/mcp.md; /admin/ia?tab=mcp; tests IA-06; e2e zx-ia 6
- Missing: Ingreso por persona para agentes (OAuth 2.1 con PKCE) y el servidor de escritura (después).
- Adapter turned off: MCP_SERVER
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan

**IA-07 · Guardas contra inyección y fuga de datos: Partial.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: Verificado lo de eventos-api (marca de origen no confiable). Agregado: lista de dominios de salida en el adaptador (AI_EGRESS_ALLOWLIST, vacía = no sale nada), salida solo de lista cerrada, texto de fuera citado como dato, separación lector/actor revisada en código y prueba, registro de cada llamada con versión, herramienta y diff (crm.ia_calls), casos de inyección en la evaluación
- Missing: Lista de permitidos de salida a nivel red (es de la plataforma, no de la app).
- Adapter turned off: AI_ADAPTER
- Who unblocks or what it depends on: Dueño de la plataforma de producción

**IA-08 · Evaluación de IA: Built, external channel off.**
- Source: package `ia`, 13-Nov-2026.
- Evidence: crm.ia_eval_cases (19 casos sintéticos, 4 de engaño) y crm.ia_eval_runs; corrida contra reglas y contra el adaptador; regla de encendido featureOn (adaptador encendido + última corrida con la versión vigente sobre el umbral); tablero /admin/ia?tab=evaluacion con agregar caso; tests IA-08; e2e zx-ia 6
- Missing: Disparo automático de la evaluación en CI al cambiar versión o modelo (hoy cambiar PROMPT_VERSION invalida el encendido hasta correrla a mano); costo por acción no se suma todavía al tablero de costos de Gobierno.
- Adapter turned off: AI_ADAPTER

### MULTI · Multi-país, moneda, entidad, IDs fiscales y WhatsApp

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| MULTI-01 | Multi-moneda con tasa fechada | Must | F1 | Built, external channel off |
| MULTI-02 | Entidad legal y localización (idioma, zona horaria) | Must | F1 | Partial |
| MULTI-03 | Identificadores fiscales por país con validación en 3 capas | Must | F1 | Built, external channel off |
| MULTI-04 | Direcciones por país y geolocalización | Should | F1 | Built, external channel off |
| MULTI-05 | WhatsApp por mercado (WABA, costos, plantillas) | Should | F2 | Built, external channel off |

**MULTI-01 · Multi-moneda con tasa fechada: Built, external channel off.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: crm.deals guarda fx_rate, fx_rate_date, fx_source, amount_usd_minor y fx_frozen_at (0032): abierto usa la tasa vigente del día, al cerrar la congela. /reportes/consolidado (abiertos con ponderado por etapa y ganados; corte por mercado, entidad legal o unidad de negocio; monto original y USD; 'sin convertir' aparte). Una sola regla: Finanzas (/reportes/finanzas) y el Panel del LT ya no usan la tasa más reciente (Finanzas: la guardada en cada negocio; panel: la vigente en la fecha de corte de los datos). Job mercados.fx_restamp registrado. Pruebas: tests/db/mercados.test.ts 'MULTI-01' (5), tests/e2e/zx-mercados.spec.ts 'MULTI-01 y E1.F10' (2). Integración 95-2: el Panel del LT convierte el volumen con app.fx_at a la fecha de corte del archivo de ventas.
- Missing: Las tasas se cargan a mano: la carga automática desde los datos de ventas está construida y apagada. Las partidas de un negocio (deal_items) siguen la tasa de su negocio; no guardan una propia. Finanzas y el LT confirman la regla única (decisión por defecto: tasa guardada en el negocio).
- Adapter turned off: FX_FEED_ADAPTER (tasas fechadas desde los datos de ventas)
- Who unblocks or what it depends on: Roxanna Quintero (S5 publica tasas fechadas) y Finanzas confirma la fuente

**MULTI-02 · Entidad legal y localización (idioma, zona horaria): Partial.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Entidad legal obligatoria en comercio y negocio (hereda del comercio), en persona y como límite del acceso (crm.memberships.legal_entity_id) con política RLS restrictiva en accounts y deals; actividades y demás hijos la heredan por sus políticas. Zona horaria IANA por comercio (en US sale del estado) y festivos por mercado. Administración, Mercados y entidades (/admin?tab=mercados): entidades, personas por entidad, festivos, lista de lo que le falta a cada mercado. Ficha, Datos: entidad, unidad de negocio y hora. Reportes cortan por entidad (Consolidado, Finanzas). Pruebas: tests/db/mercados.test.ts 'MULTI-02' (5); zx-mercados 'MULTI-02 y E1.F1' (2).
- Missing: 1) No existe el objeto contrato (paquete partners-contratos): hasta entonces la entidad es obligatoria en el negocio. 2) Las personas solo usan es o en: no hay interfaz en portugués. 3) Los relojes de lead y Hoy siguen midiendo en la hora del mercado; la hora del comercio se usa en la ficha y su encabezado. 4) Los leads no llevan entidad. 5) Las entidades reales las definen Legal y Finanzas (las sembradas son sintéticas).
- Who unblocks or what it depends on: Legal y Finanzas (lista de entidades); paquete partners-contratos (contrato)

**MULTI-03 · Identificadores fiscales por país con validación en 3 capas: Built, external channel off.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Captura una vez en la ficha (Datos, 'Identificador fiscal'): capa 1 interna con formato y dígito verificador para RFC (MX), EIN (US, rechaza SSN), NIT (CO y SV) y CNPJ alfanumérico (BR); capa 2 y 3 (registro oficial y listas de riesgo) por adaptador apagado; revisión humana por otra persona con nota, con aviso a quien revisa y a quien capturó (notify.ts). Se guardan últimos 4, huella (HMAC) y estado en crm.tax_ids y cada capa en crm.tax_id_verifications; el valor completo no queda en ninguna tabla ni en la bitácora. Búsqueda exacta en /buscar, en su propio campo (viaja en el cuerpo, no en la dirección). Pruebas: tests/unit/mercados.test.ts (6 de formato), tests/db/mercados.test.ts 'MULTI-03' (5), zx-mercados 'MULTI-03' (2). Integración 95-2: la ficha de dealer de US (E9.F13) usa este mismo modelo y este mismo resguardo.
- Missing: DECISIÓN ABIERTA: el estándar prohíbe guardar el identificador completo; hoy se descarta tras validarlo. Si Legal y Seguridad deciden guardarlo, el adaptador de resguardo ya está. Falta elegir proveedor de verificación fiscal y de listas de riesgo. En staging y producción la huella necesita la llave BLIND_INDEX_KEY (sin ella no se detectan repetidos y la pantalla lo dice).
- Adapter turned off: TAX_REGISTRY_ADAPTER (registro oficial y listas de riesgo), PROTECTED_DATA_ADAPTER (resguardo del valor completo), BLIND_INDEX_KEY (llave de la huella)
- Who unblocks or what it depends on: Compliance (proveedor), Legal y Seguridad (valor completo), Dan Mulligan o Michael Essiet (revisión de tecnología)

**MULTI-04 · Direcciones por país y geolocalización: Built, external channel off.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Formato de dirección por país en crm.address_formats (campos, orden, obligatorios, código postal): la ficha pinta el formulario desde ahí. Dirección normalizada con índice para buscar por calle. Coordenadas a mano, desde el teléfono (permiso del navegador) o desde el evento store.created de la Sales App (opcional, no pisa lo guardado). Distancia, 'Cerca de mí' (/comercios/cerca) y posibles repetidos a menos de 60 m calculados en la base, sin proveedor. Pruebas: tests/db/mercados.test.ts 'MULTI-04' (3); zx-mercados 'MULTI-04 y E2.F1' (2, una a 390 px con geolocalización).
- Missing: Mapa y geocodificación por dirección: construidos como adaptador y apagados (la vista Mapa lo dice y manda a Cerca de mí). Cambié el encabezado Permissions-Policy a geolocation=(self): antes bloqueaba la ubicación del teléfono para todos.
- Adapter turned off: GEOCODING_ADAPTER (mapa y geocodificación)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (proveedor de mapas en la revisión de tecnología)

**MULTI-05 · WhatsApp por mercado (WABA, costos, plantillas): Built, external channel off.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Por mercado y entidad: número (crm.whatsapp_accounts, uno activo por mercado y entidad), plantillas por idioma y categoría con estado de aprobación, costo por mensaje con vigencia y fuente, y ventana de 24 h (72 h desde anuncio) visible en la ficha y en su encabezado. Enlace wa.me del número del mercado en la ficha para que el comercio escriba primero. Un solo interruptor con el canal de avisos (WHATSAPP_ADAPTER). Pruebas: tests/db/mercados.test.ts 'MULTI-05' (2); zx-mercados 'MULTI-05' (1). Integración 95-2: es el único modelo de WhatsApp: el servicio de avisos (notify.ts) toma de aquí el costo y el límite diario; Avisos, Canales ya no los pide.
- Missing: No sale ni entra ningún mensaje: envío, recepción (la ventana se anota a mano con 'El comercio me escribió') y costos reales por webhook esperan la cuenta de WhatsApp Business. Sin código QR (pide una dependencia nueva): queda el enlace.
- Adapter turned off: WHATSAPP_ADAPTER
- Who unblocks or what it depends on: Marketing y Legal (cuenta de WhatsApp Business por mercado y plantillas aprobadas por Meta); Dan Mulligan o Michael Essiet (revisión de tecnología)

### SEG · Seguridad, privacidad y cumplimiento

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| SEG-01 | Permisos por rol, territorio y fila (RLS) | Must | F1 | Built |
| SEG-02 | Seguridad por campo (comisiones, splits, datos sensibles) | Must | F1 | Built, external channel off |
| SEG-03 | Audit log inmutable y monitoreo de exportes | Must | F1 | Built, external channel off |
| SEG-04 | Consentimiento, datos sensibles y retención | Must | F1 | Partial |
| SEG-05 | Offline seguro con escritura | Won't | F3 | Not applicable |
| SEG-06 | Código de conducta e incidentes de campo | Should | F2 | Partial |
| SEG-07 | Ciclo de vida de identidades | Should | F1 | Partial |
| SEG-08 | Gestión de secretos y credenciales de integración | Should | F1 | Built |
| SEG-09 | Derechos de titulares (acceso, rectificación, eliminación) | Should | F2 | Built |
| SEG-10 | Protección de endpoints públicos | Should | F2 | Built, external channel off |

**SEG-01 · Permisos por rol, territorio y fila (RLS): Built.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Administración por partes (memberships.admin_areas, app.has_area, CAP_AREA en policy.ts), equipo de cuenta (crm.account_team, /comercios/<id>/equipo), jerarquía de equipos, alcance por entidad legal, rol Agencia confinado, rol Partner de solo lectura por árbol, muro entre venta directa y agencia, app.can_see_account. /admin/seguridad?s=accesos. tests/db/seguridad.test.ts (SEG-01, 7 pruebas) Integración 95-2: el alcance por entidad legal es uno solo (el de 0026_markets: memberships.legal_entity_id, app.entity_limited_markets, políticas accounts_entity y deals_entity); el muro de agencia deja a supervisión ver las tiendas de su equipo.
- Missing: Una parte de Administración sigue leyendo todos los mercados (es rol global, como Leadership): estrecharlo es decisión.
- Who unblocks or what it depends on: Yamil Alvarez (decisión de alcance de lectura de administración parcial)

**SEG-02 · Seguridad por campo (comisiones, splits, datos sensibles): Built, external channel off.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: crm.sensitive_fields y crm.account_sensitive (sin privilegios para la app; solo funciones app.sensitive_*), visibilidad y edición por rol y por quien lleva la cuenta, tapado con revelado bajo motivo registrado en bitácora y en lecturas; el valor nunca entra a la bitácora. /comercios/<id>/equipo y /admin/seguridad?s=privacidad. tests/db/seguridad.test.ts (SEG-02, 2 pruebas); E2E revela con motivo
- Missing: Cifrado con llaves gestionadas apagado (el valor se guarda sin cifrar, protegido por permisos). Solo existen campos reservados de comercio (no de negocio ni de contacto).
- Adapter turned off: FIELD_CRYPTO_ADAPTER
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (servicio de llaves aprobado)

**SEG-03 · Audit log inmutable y monitoreo de exportes: Built, external channel off.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Migración 0031: esquema audit (data_log, config_log, read_log, archive_batches) escrito por triggers en toda tabla de crm, con vía y solicitud, solo inserción; alertas (app.security_scan, job seguridad.alertas) avisadas por el servicio de avisos. Pantalla /admin/seguridad (Alertas y lecturas, Bitácora de la base). tests/db/seguridad.test.ts (SEG-03, 11 pruebas); tests/e2e/zx-seguridad.spec.ts
- Missing: La copia fuera de la base no sale (adaptador apagado). No se registran las lecturas de listas en pantalla (sí exportaciones, búsquedas, revelados, ver como y lecturas con llave). Los datos del antes y el después quedan completos en la bitácora: falta decidir retención y tamaño.
- Adapter turned off: AUDIT_ARCHIVE_ADAPTER
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (destino aprobado: almacenamiento de objetos o lakehouse)

**SEG-04 · Consentimiento, datos sensibles y retención: Partial.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: crm.consents por contacto o lead, canal y categoría con evidencia y fecha; baja en crm.contact_suppressions; app.may_contact la preguntan el servicio de avisos (notifyOutside, releaseHeld) y la base de correo de leads; el consentimiento pasa del lead al contacto al convertir; reglas de retención con vista previa y job seguridad.retencion. tests/db/seguridad.test.ts (SEG-04, 5 pruebas); E2E registra consentimiento y baja
- Missing: Las reglas de retención nacen apagadas y sin plazo (lo define Legal). Captura segura de documentos e identificaciones: no construida (necesita proveedor aprobado). El guard sigue rechazando en vez de enmascarar y avisar. markets.privacy_notice_version sigue vacío.
- Who unblocks or what it depends on: Legal (plazos de retención y versión del aviso de privacidad)

**SEG-05 · Offline seguro con escritura: Not applicable.**
- Source: audit of 12-Nov-2026 (before the build program); no package of the program owns it.
- Evidence: El catálogo lo marca Won't y Descartar (F3). El producto es consistente con el 'no hacer': no acepta escrituras sin conexión; muestra aviso de sin señal y deshabilita guardar (ADR-006, 'No signal'), y la lectura con datos guardados en el equipo quedó deliberadamente fuera.
- Who unblocks or what it depends on: Si se reabre: decisión explícita de Michael Essiet o Dan Mulligan con el dueño de los controles SOX y SOC (ADR-006) y telemetría de conectividad de supervisores.

**SEG-06 · Código de conducta e incidentes de campo: Partial.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: field_incidents confidencial (RLS: quien reporta y quien lidera o administra), tomar y cerrar con resolución, cada apertura queda en la bitácora (field_incident.viewed) sin copiar el texto, aparte de las notas; /campo?tab=incidentes; tests y e2e
- Missing: Eventos de instalación y retiro desde la Sales App y el enlace con trust score: dependen de la conexión real de la Sales App.
- Who unblocks or what it depends on: Equipo de la Sales App; Compliance (tipos y quién ve)

**SEG-07 · Ciclo de vida de identidades: Partial.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Ver como: solo lectura, con motivo, máximo 60 minutos, registrado, barra en toda pantalla (app.view_as_*, runAction corta toda acción). Reporte de accesos sin uso, revisión periódica con acuse de quien lidera, aviso a la persona cuando recibe un acceso. /admin/seguridad?s=accesos. tests/db/seguridad.test.ts (SEG-07, 4 pruebas); E2E de ver como
- Missing: Baja automática por directorio de Google apagada. MFA obligatorio para roles con exportación: CONTIGO no ve el segundo factor (política de Google Workspace).
- Adapter turned off: DIRECTORY_ADAPTER
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (cuenta de servicio de solo lectura del directorio); IT (política de MFA en Google Workspace)

**SEG-08 · Gestión de secretos y credenciales de integración: Built.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Inventario de conexiones de salida sin valores (crm.secret_inventory: responsable, cada cuánto se rota, última rotación, si la variable existe); llaves de API con responsable y vencimiento sobre lo que hizo eventos-api (rotación, último uso); alertas de llave por vencer, sin uso, rotación vencida, llamadas por hora y filas por día. /admin/seguridad?s=llaves. tests/db/seguridad.test.ts (SEG-08, 2 pruebas)
- Missing: No hay gestor de secretos ni rotación automática: CONTIGO avisa, la rotación la hace una persona en la plataforma. El inventario se llena a mano.

**SEG-09 · Derechos de titulares (acceso, rectificación, eliminación): Built.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: crm.subject_requests (acceso, rectificación, eliminación) con país, plazo, quién atiende y cierre; exportación de lo que hay de la persona (/admin/seguridad/titular/<id>); anonimización que tapa el dato en el contacto, el lead y las bitácoras y conserva IDs, montos, fechas y quién hizo qué. tests/db/seguridad.test.ts (SEG-09); E2E registra una solicitud
- Missing: Los plazos por país están vacíos hasta que Legal los defina (la solicitud nace sin fecha límite). La solicitud se liga a un contacto o un lead por su ID, a mano.
- Who unblocks or what it depends on: Legal (plazo de respuesta por país)

**SEG-10 · Protección de endpoints públicos: Built, external channel off.**
- Source: package `eventos-api`, 13-Nov-2026.
- Evidence: Formularios públicos /f/[slug]: límite por IP y por formulario (vistas y envíos), llave de la página, tiempo mínimo entre carga y envío, campo trampa y adaptador anti-bot. Lo rechazado no se guarda (solo un conteo por motivo) y la respuesta es la misma para todos los motivos. La API de formularios tiene límite por llave y por IP con 429. Pantalla /admin/integraciones?tab=formularios: límites por formulario y rechazos de 7 días; /estado muestra el adaptador. Código: src/domain/form-guard.ts, src/server/protect.ts, app.rate_hit. Pruebas: tests/db/eventos-api2.test.ts (2 casos), tests/e2e/zx-eventos-api.spec.ts (1 caso).
- Missing: La página pública responde 200 con el aviso de espera, no un 429: el código de estado real pide mover el límite al borde. Links de alta: no existen todavía, no hay qué proteger.
- Adapter turned off: antibot (CONTIGO_ANTIBOT)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (aprobar el servicio anti-bot)

### UX · Experiencia de uso

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| UX-01 | Ficha de cuenta con lo importante arriba | Must | F1 | Built |
| UX-02 | Velocidad, UI optimista y búsqueda por cualquier alias | Must | F1 | Partial |
| UX-03 | Vistas guardadas como colas y estados vacíos útiles | Must | F1 | Partial |
| UX-04 | Móvil para supervisores y KAM | Should | F1 | Partial |

**UX-01 · Ficha de cuenta con lo importante arriba: Built.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Encabezado de la ficha con hasta cinco datos por rol (próximo paso, quién lo lleva y su equipo, dónde está en la red, avisos abiertos, corte de los datos, ventas 30 días, negocio abierto, contacto, identificador fiscal, entidad): viven en crm.ficha_layouts y administración los cambia. Una sola llamada (app.account_header) con presupuesto de 150 ms probado. Pruebas: tests/db/mercados.test.ts 'UX-01' (2); zx-mercados 'UX-01 y E2.F5'.
- Missing: Los cinco datos por rol son un punto de partida: C1 los confirma acompañando a supervisión y a Operaciones (el catálogo lo pide).
- Who unblocks or what it depends on: Yamil Alvarez (C1): sesión de acompañamiento con supervisión y Operaciones

**UX-02 · Velocidad, UI optimista y búsqueda por cualquier alias: Partial.**
- Source: package `seguridad`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Teléfono solo por número completo (7 dígitos o más) y alias solo exacto; 30 búsquedas por persona por minuto contadas por la base; cada búsqueda queda en el registro de lecturas. Paleta de comandos con Ctrl+K (src/ui/palette.tsx). tests/db/seguridad.test.ts (UX-02); E2E de búsqueda y paleta
- Missing: Interfaz optimista con vuelta atrás: no hecha. Latencia p95 en Android de gama baja: sin medir. Búsqueda de texto completo: no hecha. Identificador fiscal: existe (crm.tax_ids, paquete mercados) y se busca por su campo propio en /buscar, no por fragmento.

**UX-03 · Vistas guardadas como colas y estados vacíos útiles: Partial.**
- Source: package `reportes`, 13-Nov-2026.
- Evidence: Barra 'Vistas guardadas' en /comercios, /leads, /pipelines/<embudo>?vista=lista y /actividades: guardar el filtro actual con nombre, fijarla como cola (aparece en el menú en 'Mis colas' con contador), compartirla con el equipo (supervisión; quien lidera y administración, con todos) y borrarla; estados vacíos que dicen qué hacer. Filtros por lista blanca (VIEW_FILTERS), sin consultas libres; tope de 12 vistas por lista y 5 colas fijadas. Vistas de fábrica que reconstruyen filtros de Pipedrive: 'Negocios sin persona asignada', 'Negocios abiertos sin próximo paso', 'Organizaciones de US', 'Leads sin persona asignada', 'Tareas del equipo', y el reporte compartido 'Negocios perdidos del mes en US'. Pruebas: tests/db/reportes.test.ts (3 pruebas de 'vistas guardadas como colas'); tests/e2e/zx-reportes.spec.ts ('quien vende guarda su filtro de Comercios como vista, la fija como cola con contador en su menú y la borra', 'supervisión comparte una vista de Leads con su equipo; hay vistas en Negocios y en Actividades'). Integración de la ola 1 (13-nov): las vistas guardadas de Leads conservan los filtros de campaña de México (tipo, embudo, tiendas).
- Missing: Lo que pide el encargo quedó construido. Contra el catálogo falta: 1) Las 3 colas oficiales por rol (revisitas vencidas, altas sin fondeo, PDV en riesgo) no están definidas por C1; de fábrica solo existe 'En riesgo'. 'Revisitas vencidas' y 'altas sin fondeo' necesitan filtros que hoy no están en la lista blanca ('altas sin fondeo' depende de CAMPO-06). 2) Filtros de Pipedrive sin campo equivalente, no reconstruidos: 'Vegas AWPE - Audit', 'US · axexo Business Portal' y 'US - People' (no hay lista de personas). 3) En Negocios la barra vive en la vista Lista, no en el tablero: sobre el tablero empujaba las columnas y hacía fallar el arrastre de la prueba existente negocios.spec ('cambiar de etapa pide el próximo paso'). Las vistas y colas de Negocios abren la vista Lista. 4) El contador vive en el menú de la persona ('Mis colas'), no en el dock (tope de 4 destinos).
- Who unblocks or what it depends on: Yamil / C1 (las 3 colas oficiales por rol)

**UX-04 · Móvil para supervisores y KAM: Partial.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Enlace directo /comercios/ref/<ID de la Sales App, Merchant ID o ID de CONTIGO> que no revela comercios fuera del alcance. A 390 px, sin desbordes y con axe limpio: ficha y pestaña Datos como quien lidera y como Operaciones, revisión del identificador fiscal de un toque, Cerca de mí, Consolidado y Administración de mercados. Pruebas: tests/db/mercados.test.ts 'UX-04'; zx-mercados 'UX-04' y los recorridos a 390 px.
- Missing: 1) Sin caché de lectura sin señal: no la construí porque deja datos de comercios guardados en teléfonos personales (decisión de Seguridad). 2) El enlace existe de este lado; falta que la Sales App lo use. 3) Velocidad en un teléfono real sin medir. 4) Las aprobaciones de pasos de etapa son del paquete automatizaciones: no las verifiqué a 390 px.
- Who unblocks or what it depends on: Seguridad (caché en el teléfono); equipo de la Sales App (enlace)

### GOB · Gobierno, adopción y operación

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| GOB-01 | Registro de campos (field registry) | Must | F1 | Built |
| GOB-02 | Tablero de calidad de datos | Should | F1 | Partial |
| GOB-03 | Adopción, métricas de uso y change management | Must | F1 | Partial |
| GOB-04 | Gobierno de releases y mantenimiento | Must | F1 | Partial |
| GOB-05 | Migración y convivencia con Pipedrive y Zoho | Should | F1 | Built, external channel off |
| GOB-06 | Avisos a la red con acuse | Should | F2 | Built, external channel off |
| GOB-07 | Observabilidad, respaldo y recuperación | Should | F1 | Partial |
| GOB-08 | Datos de prueba sintéticos por mercado | Should | F1 | Partial |
| GOB-09 | Costo unitario del CRM (FinOps) | Should | F1 | Partial |
| GOB-10 | Soporte y entrenamiento in-app | Should | F1 | Partial |

**GOB-01 · Registro de campos (field registry): Built.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: crm.field_definitions con dueño, propósito, decisión que habilita, fecha de revisión, clase de dato personal, marca de dato de fuera sin validar, de dónde viene y quién lo usa, estado de propuesta y quién decidió. 'Sin decisión documentada no hay campo': createField y proposeField la exigen. Flujo: quien lidera el mercado propone, administración aprueba o rechaza con motivo; plazo publicado en crm.settings (field_approval_sla_days = 3) y propuesta marcada 'Fuera de plazo'. Uso por campo (app.field_usage) con marca 'Sin uso' para retirar. Lo que llega de Pipedrive entra marcado y aparece en 'Sin decisión'. Pantalla: /datos?tab=campos y 'Crear campo' en /admin?tab=embudos (ahora pide la decisión). Pruebas: tests/db/datos.test.ts 'DAT-05 / GOB-01', tests/e2e/zx-datos.spec.ts 'quien lidera el mercado propone un campo...'. Integración de la ola 1 (13-nov): la marca "llega de fuera sin validar" comparte columna con IA-07 (0021): un campo de texto libre siempre la lleva y la pantalla lo dice.
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
- Source: package `gobierno`, 13-Nov-2026, checked at integration 95-2.
- Evidence: /admin/gobierno (Versiones): responsable técnico y suplente por componente (7 componentes, sin nombres, dos personas distintas), calendario de mantenimiento por mercado, versiones con notas ES y EN que se anuncian antes de salir (salen por Anuncios y quedan en /solicitudes), lista de salida de 8 puntos con evidencia (revisión de tecnología y estándar incluidos) sin la cual la versión no se libera, registro de despliegues (job gobierno.deploy_watch anota el commit que corre). Plantilla de PR con la lista. Runbook docs/runbooks/despliegue-y-vuelta-atras.md. tests/db/gobierno.test.ts (GOB-04, 6 pruebas), E2E.
- Missing: Nombres de responsable y suplente [pendiente: Dan Mulligan]. Segunda persona que haya desplegado y vuelto atrás. Banderas por rol y mecanismo general de banderas (sigue una bandera por mercado y por embudo). Vistas previas por rama con datos del generador (plataforma). Protección de rama con dos revisores [pendiente: administradores del repositorio]. Visto bueno de Tech Implementation Review de lo ya desplegado en staging.
- Who unblocks or what it depends on: Dan Mulligan; Michael Essiet; administradores del repositorio

**GOB-05 · Migración y convivencia con Pipedrive y Zoho: Built, external channel off.**
- Source: package `integraciones2`, 13-Nov-2026.
- Evidence: Carga de Pipedrive: historial de etapas (/v1/deals/{id}/flow) y matriz de organizaciones (/v1/organizationRelationships) pedidos por registro y cargados (src/domain/pipedrive/import.ts, load.ts); reglas de duplicados de datos al terminar cada carga, solo a la cola; probado contra el Pipedrive simulado
- Missing: Del paquete anterior siguen abiertos: filtro 'US - People' y condicion exacta de 'US - axexo Business Portal'
- Adapter turned off: zoho (ZOHO_ADAPTER)
- Who unblocks or what it depends on: LuisRo Sanabria (filtros)

**GOB-06 · Avisos a la red con acuse: Built, external channel off.**
- Source: package `avisos`, 13-Nov-2026.
- Evidence: /anuncios: publicar con audiencia (mercado, equipo, rol), vigencia, tema y acuse; cada persona lo ve al entrar (franja en toda pantalla), en su campana y en Hoy si pide acuse; lo marca leído o Enterado; quien publica ve quién falta; versión nueva reinicia el acuse; retiro; todo en bitácora (announcement.*). Cambio de comisiones o de alta: acuse obligatorio y fecha de entrada en vigor posterior al anuncio (regla en dominio y en la base). Pruebas: tests/db/avisos2.test.ts (GOB-06), tests/e2e/zx-avisos.spec.ts.
- Missing: El candado que impide cambiar una comisión o una regla de alta sin anuncio previo no se puede poner: CONTIGO no tiene módulo de comisiones (CANAL-05). Llega solo a quienes son usuarios; reps de calle e ISOs sin usuario dependen del canal de WhatsApp, que está apagado.
- Adapter turned off: whatsapp (WHATSAPP_ADAPTER), email (EMAIL_ADAPTER)
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan (revisión de tecnología)

**GOB-07 · Observabilidad, respaldo y recuperación: Partial.**
- Source: package `gobierno`, 13-Nov-2026, checked at integration 95-2.
- Evidence: /admin/gobierno (Servicio): objetivos de servicio medidos por CONTIGO (disponibilidad, abrir una pantalla, guardar un cambio, API) con tablero por pantalla, errores con referencia, incidentes que no cierran sin causa y acciones, objetivos de recuperación con quién y cuándo, registro de pruebas de restauración (vacío). /estado muestra los objetivos. Identificador de petición de punta a punta (proxy, acciones, API, bitácora, errores). Alerta diaria a administración si un objetivo no se cumple (job gobierno.slo_watch). Runbook docs/runbooks/respaldo-y-restauracion.md. tests/db/gobierno.test.ts (GOB-07, 8 pruebas), tests/e2e/zx-gobierno.spec.ts.
- Missing: Recuperación a un punto en el tiempo habilitada y primera prueba de restauración (es de la plataforma; ADR-002 abierto). RPO, RTO y frecuencia de prueba: sin valor, [pendiente: Dan Mulligan]. Valores de los objetivos de servicio: los fija una persona, hoy sin fijar. Dictamen de residencia de datos [pendiente: Legal]. Trazas hacia una herramienta externa: adaptador apagado.
- Adapter turned off: traces (TRACES_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan (plataforma, RPO y RTO); Michael Essiet o Dan Mulligan (herramienta de trazas); Legal (residencia)

**GOB-08 · Datos de prueba sintéticos por mercado: Partial.**
- Source: package `gobierno`, 13-Nov-2026, checked at integration 95-2.
- Evidence: scripts/synthetic.mjs y scripts/synthetic-lib.mjs: generador reproducible por mercado (MX, US, SV), volumen y profundidad configurables (hasta 8 niveles), últimos 4 de una identificación fiscal con formato válido (RFC con dígito verificador, EIN, NIT), coordenadas, 7 días de ventas, 10 casos límite; idempotente; nunca en producción. /admin/gobierno (Datos de prueba): origen de los datos del ambiente, regla y corridas. Usado en pruebas de aislamiento por mercado y de cadena. Runbook docs/runbooks/staging-a-datos-sinteticos.md. tests/db/gobierno.test.ts (GOB-08, 3 pruebas), E2E.
- Missing: Staging sigue con datos reales de Pipedrive (excepción de ADR-005 sin firma): pasarlo a datos del generador es decisión de Michael Essiet o Dan Mulligan; el procedimiento está escrito y no se ejecutó. Vistas previas por rama (plataforma). El generador todavía no se usa en las pruebas de contrato.
- Who unblocks or what it depends on: Michael Essiet o Dan Mulligan

**GOB-09 · Costo unitario del CRM (FinOps): Partial.**
- Source: package `gobierno`, 13-Nov-2026, checked at integration 95-2.
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

Requirements already reported by an integrated package of the program (90): 80 built, 10 partial. One line each:

| Requirement | Status | Package | Missing |
|---|---|---|---|
| E1.F1 | Built | `mercados` | n/a |
| E1.F4 | Built | `mercados` | n/a |
| E1.F10 | Built | `mercados` | n/a |
| E2.F1 | Built | `mercados` | n/a |
| E2.F4 | Built | `mercados` | n/a |
| E2.F5 | Built | `mercados` | Qué secciones lleva cada equipo sigue abierto en el requerimiento: hoy existen las tres comunes y las que administración agregue. |
| E3.F3 | Built | `embudo` | Las 8 etiquetas de Pipedrive no se mapearon a este catálogo: entran cuando se defina la importación. |
| E3.F6 | Built | `embudo` | n/a |
| E3.F8 | Built | `embudo` | n/a |
| E3.F10 | Built | `embudo` | Decisión por defecto: no se rechaza el lead. Solo queda sin dueño (visible al mercado) si el mercado no tiene a nadie que lo lidere. |
| E4.F2 | Partial | `seguridad` | Cambiar dueño, fusionar y editar en bloque por usuarios operativos, y un rol de Finanzas: siguen cerrados. Es decisión de permisos; se dejó la opción más restrictiva. |
| E4.F4 | Built | `seguridad` | La persona de agencia necesita una cuenta de Google de la organización (no hay ingreso para externos). Integración 95-2: ligado a E9.F12. Un solo catálogo de agencias (crm.agencies de 0027 con la clase agencia o socio de 0030); lo que crea la agencia confinada nace con "Reclutado por" de su clase (tests/db/integracion-95-2.test.ts). |
| E4.F9 | Built | `seguridad` | Es registro posterior: dar el acceso no exige la aprobación antes. |
| E5.F1 | Built | `integraciones2` | Contrato confirmado y lugar donde Data y Reporteria deja el archivo |
| E5.F2 | Built | `integraciones2` | n/a |
| E5.F3 | Built | `integraciones2` | Responsables reales de cada carga (se ponen en /estado) |
| E5.F4 | Built | `integraciones2` | n/a |
| E5.F5 | Built | `integraciones2` | n/a |
| E5.F6 | Built | `integraciones2` | Elegir la herramienta de rutas y conectarla |
| E5.F7 | Built | `integraciones2` | n/a |
| E5.F9 | Built | `integraciones2` | Elegir almacenamiento para la boveda |
| E6.F2 | Built | `integraciones-migracion` | n/a |
| E6.F3 | Built | `integraciones-migracion` | Fecha real de corte por mercado (decision de negocio) |
| E6.F4 | Built | `integraciones2` | Dueno y lugar de guarda del respaldo |
| E6.F5 | Built | `integraciones-migracion` | Sin prueba E2E propia (verificar en staging con datos cargados) |
| E6.F6 | Built | `integraciones-migracion` | n/a |
| E6.F8 | Built | `integraciones2` | n/a |
| E7.F2 | Built | `gobierno` | n/a |
| E7.F3 | Built | `gobierno` | Los nombres: ningún equipo tiene champion nombrado (el requerimiento los deja abiertos). |
| E7.F6 | Built | `gobierno` | n/a |
| E7.F7 | Built | `gobierno` | n/a |
| E7.F8 | Built | `gobierno` | n/a |
| E7.F9 | Partial | `gobierno` | El material mismo (presentación, guía de leads y preguntas frecuentes por mercado) no existe todavía y no está publicado en el portal de aprendizaje: [pendiente: Kore Academy]. |
| E9.F1 | Built | `us-ficha` | El requerimiento deja el acomodo como abierto: falta que el equipo de campo lo confirme. |
| E9.F2 | Built | `us-ficha` | Definición y fuente del número siguen abiertas en el documento; se construyó el supuesto de trabajo (texto que llena Operaciones). |
| E9.F3 | Built | `us-ficha` | Los tipos generales (cadena, corporativo) siguen disponibles en US para armar árboles. Lo importado que no es tienda toma su tipo por Channel Segment al correr la configuración, no en cada recarga (regla del importador, paquete integraciones-migracion). |
| E9.F4 | Built | `us-ficha` | n/a |
| E9.F5 | Built | `us-ficha` | Las reglas son 'Proposed' en el documento. Lo importado sin ID de EMIDA queda 'Sin definir' hasta que alguien lo fije; el importador no lee el campo Merchant Origin de Pipedrive. |
| E9.F6 | Built | `us-ficha` | n/a |
| E9.F8 | Built | `us-ficha` | Los seis carriers reales (H2O, AT&T, T-Mobile, Gen Mobile, Ultra, LWP) están listos en crm.dealer_record_setup('US', true) pero NO se cargan solos: cada proveedor activo cuenta como aprobación pendiente en los negocios abiertos de Operaciones. La lista de campos es 'Proposed'; se guarda un identificador por carrier; 'HDN Account ID' quedó como identificador de H2O (por confirmar). |
| E9.F9 | Built | `us-ficha` | n/a |
| E9.F10 | Built | `us-ficha` | n/a |
| E9.F11 | Partial | `us-ficha` | No se pudo contrastar con los 221 campos de organización importados en staging (sin acceso): hay que confirmar nombres para que no queden duplicados, y cuáles de los 221 usa el equipo. Las listas de opciones no están definidas (entran como texto) y la fuente del estado de baja sigue abierta. |
| E9.F12 | Built | `us-ficha` | El reporte agencia contra equipo propio (E8.F3) es de otro paquete. Integración 95-2: un solo catálogo de agencias con el de la agencia confinada (E4.F4, paquete seguridad); hay dos entradas para editarlo (Datos, Catálogos y Administración, Seguridad, Accesos). |
| E9.F13 | Partial | `us-ficha` | El requerimiento pide el identificador completo y el estándar (DATA-06) lo prohíbe: ganó el estándar. Falta la decisión: excepción escrita, resguardo cifrado y aprobación de tecnología. |
| E10.F1 | Built | `us-embudo` | En staging las etapas vienen de la importación de Pipedrive: confirmar ahí que son las nueve (se renombran, crean y reordenan desde /admin). |
| E10.F2 | Built | `us-ficha` | n/a |
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
| E11.F3 | Built | `us-embudo` | n/a |
| E11.F4 | Built | `us-embudo` | El correo real al buzón de pedidos sigue apagado. |
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
| E15.F8 | Partial | `mx` | Hecho al integrar: src/domain/leads.ts usa isWebSource, así que un lead de campaña (web_campaign) recibe bienvenida o acuse. Sigue pendiente lo mismo que en avisos: el texto confirmado de la bienvenida de México, la dirección de salida y la versión en inglés. Canal de correo apagado. |
| E15.F9 | Built | `mx` | La alerta fuera de CONTIGO al llegar y al vencer la meta es del servicio de avisos (paquete avisos), apagada. |
| E16.F2 | Built | `mx` | Decisiones por defecto: un territorio sin gerente no cambia nada (regiones sin cobertura); al nombrar gerente pasan a él solo las tiendas que nadie llevaba o que llevaba el gerente anterior. Ningún territorio trae gerente cargado: lo elige administración. |
| E17.F4 | Built | `mx` | Decisión por defecto (el requerimiento está abierto): mientras las hojas viven, las visitas entran pegándolas; no hay conexión a la hoja. |
| E18.F2 | Built | `mx` | Decisión por defecto: la regla viene apagada en todos los mercados; la activa quien lidera el mercado o administración. |
| E18.F5 | Partial | `mx` | La presentación, la guía ya publicada y las sesiones: los produce y los da una persona. El producto guarda el enlace y quién lo dio por hecho. |
| E18.F6 | Built | `mx` | Seguir el método es trabajo de personas; el producto lo ordena y deja constancia. |
| E18.F7 | Built | `integraciones2` | n/a |
| E18.F8 | Built | `integraciones2` | n/a |
| E18.F9 | Built | `mx` | Decisión por defecto (el requerimiento está abierto): la base de correo es una descarga; no hay envío desde CONTIGO. |
| E18.F10 | Built | `mx` | n/a |

## Deliberately out, per the committee's "what not to build"
Routing, check-in and GPS (Sales App), offline writes, commission calculation, KYB and OCR, a WhatsApp inbox, a visual workflow builder, a free-form report builder and autonomous agents. Catalog items that touch these are built up to the boundary and say so in their line.

## External technology: built and turned off
Email, Slack, WhatsApp, push, file storage, e-signature, maps and geocoding, tax providers, AI models, the Google directory, Zendesk, Zoho, event delivery over HTTP, traces and billing reads sit behind adapters in `src/server/adapters`. Each has an `off` implementation (default: it calls nothing and leaves the operation in a visible queue) and a `simulated` one for tests only. One environment variable per adapter turns it on; none is set. The status page (`/estado`) lists each adapter and what is missing to turn it on.

## Related documents
- Controls of the Engineering Standard, one by one: `docs/standard-compliance.md`.
- Decisions: `docs/adr/` (platform ADR-002, authorization ADR-003, identity ADR-004, Pipedrive data in staging ADR-005, design ADR-006).
- Runbooks: `docs/runbooks/` (backup and restore, deployment and rollback, moving staging to synthetic data).
- Pipedrive replacement: `docs/pipedrive-migration.md`. Contracts: `docs/contracts/`. Vocabulary: `docs/glosario.md`.
