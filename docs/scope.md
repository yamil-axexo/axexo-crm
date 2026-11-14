# Scope against the full feature catalog (95 items)

Generated on 13-Nov-2026, first by the `gobierno` package of the build program and regenerated at integration 95-6 (packages integrated in `design-v1`: `automatizaciones`, `avisos`, `datos`, `eventos-api`, `reportes`, `embudo`, `integraciones-migracion`, `mx`, `us-embudo`, `us-ficha`, `campo-canal`, `ciclo-cs`, `gobierno`, `mercados`, `seguridad`, `partners-contratos`, `ia`, `integraciones2`, `datos2`, `embudo2`, `campo2`, `reportes2`). It replaces the earlier scope note, which listed 20 pilot items and 35 foundation items and gave several as built that the audit of 12-Nov-2026 found partial.

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
| Built | 33 |
| Built, external channel off | 33 |
| Partial | 27 |
| Missing | 0 |
| Not applicable | 2 |
| **Total** | **95** |

93 items carry a package report from the build program; 2 still show the audited state of 12-Nov-2026 because their package has not been integrated yet.

Check made when this file was generated: the integrated package reports cite 263 file paths as evidence and 262 of them exist in this tree.

## By domain
| Domain | Items | Built | Built, channel off | Partial | Missing | Not applicable |
|---|---|---|---|---|---|---|
| DAT · Modelo de datos, jerarquía e identidad | 7 | 5 | 2 | 0 | 0 | 0 |
| LEAD · Captura, atribución, ruteo y SLA | 5 | 2 | 1 | 2 | 0 | 0 |
| PIPE · Pipelines, etapas, transiciones y cierre | 8 | 2 | 3 | 3 | 0 | 0 |
| ACT · Actividades, timeline y tareas | 3 | 1 | 0 | 2 | 0 | 0 |
| CAMPO · Integración con la app de campo, supervisión y alta | 8 | 5 | 3 | 0 | 0 | 0 |
| CANAL · Canal, PRM, atribución y comisiones | 8 | 4 | 1 | 2 | 0 | 1 |
| CS · Customer success B2B | 8 | 2 | 6 | 0 | 0 | 0 |
| REP · Reportes, métricas y forecast | 4 | 0 | 3 | 1 | 0 | 0 |
| AUT · Automatización, eventos e integraciones | 7 | 2 | 1 | 4 | 0 | 0 |
| IA · IA asistida, agentes y guardas | 8 | 1 | 3 | 4 | 0 | 0 |
| MULTI · Multi-país, moneda, entidad, IDs fiscales y WhatsApp | 5 | 0 | 4 | 1 | 0 | 0 |
| SEG · Seguridad, privacidad y cumplimiento | 10 | 4 | 3 | 2 | 0 | 1 |
| UX · Experiencia de uso | 4 | 2 | 0 | 2 | 0 | 0 |
| GOB · Gobierno, adopción y operación | 10 | 3 | 3 | 4 | 0 | 0 |

## Item by item

### DAT · Modelo de datos, jerarquía e identidad

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| DAT-01 | Jerarquía de cuentas de N niveles con roll-ups | Must | F1 | Built, external channel off |
| DAT-02 | Relación contacto-cuenta con rol y vigencia | Must | F1 | Built |
| DAT-03 | ID canónico y tabla de alias de IDs externos | Must | F1 | Built, external channel off |
| DAT-04 | Deduplicación y golden record | Must | F1 | Built |
| DAT-05 | Campos por mercado vía metadata y procesos paralelos | Must | F1 | Built |
| DAT-06 | Kit de ingesta de red adquirida con segregación previa | Should | F2 | Built |
| DAT-07 | Catálogo de productos y matriz de productos por PDV con estado por carrier | Should | F1 | Built |

**DAT-01 · Jerarquía de cuentas de N niveles con roll-ups: Built, external channel off.**
- Source: package `datos2`, 13-Nov-2026.
- Evidence: app.node_totals(raíz, día) con el árbol de ese día (app.subtree_at sobre account_links fechados), comisión 30 días por nodo (crm.care_signals), ficha Árbol con 'Ver cómo estaba el día'; regla de dueño al re-parentar como decisión 'tree.reparent_owner' (conservar / tomar el de arriba con subárbol, auditado). tests DAT-01 (2), E2E.
- Missing: Etapa de vida en fechas pasadas no se guarda (se muestra sin dato). Cálculo en vivo, no vista materializada. Comisión depende de que llegue la señal.
- Adapter turned off: conexión de señales (care_signals) existente
- Who unblocks or what it depends on: Yamil Alvarez y Comercial (regla de dueño); CANAL-05 (comisiones)

**DAT-02 · Relación contacto-cuenta con rol y vigencia: Built.**
- Source: package `datos2`, 13-Nov-2026.
- Evidence: 0040: índice único crm.contacts(market_code, phone), limpieza app.contact_phone_cleanup (teléfono en espera + par sugerido), cola crm.contact_pairs, fusión con foto y deshacer (src/domain/contacts-dedup.ts); conversión de leads, segunda solicitud, Sales App y carga de Pipedrive pasan por resolveContact/phoneDedup. Pantalla /datos?tab=duplicados 'Contactos con el mismo teléfono'. tests/db/datos2.test.ts DAT-02 (6), E2E zx-datos2.

**DAT-03 · ID canónico y tabla de alias de IDs externos: Built, external channel off.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: Pantallas: ficha Datos 'IDs en otros sistemas' (Agregar ID, Cerrar con motivo, 'ID anteriores' con vigencia), /buscar encuentra por cualquier alias, /datos?tab=catalogos 'Sistemas de origen de ID' (Agregar sistema). Dominio: addAlias (choque detectado con el nombre del comercio que lo tiene, app.alias_holder), closeAlias, createAliasSystem; crm.alias_systems reemplaza el check (Sales App, Merchant ID, Pipedrive, Zoho, EMIDA, Sky, Movilway, InComm, proveedor o carrier, más los que agregue administración). Los ID de sistemas de axexo solo los toca administración; los de sistemas externos, también Operaciones y quien lidera el mercado. Bitácora alias.added y alias.closed; eventos account.alias_issued y account.alias_closed al outbox. Pruebas: tests/db/datos.test.ts 'DAT-03' (2), tests/e2e/zx-datos.spec.ts 'Operaciones agrega un ID de otro sistema...'.
- Adapter turned off: Publicación de la tabla de alias a S5: los eventos quedan en el outbox; el publicador es del paquete eventos-api (AUT-02). El ID fiscal completo no entra como alias (estándar de datos).
- Who unblocks or what it depends on: Paquete eventos-api para publicar; S5 para el contrato de datos

**DAT-04 · Deduplicación y golden record: Built.**
- Source: package `datos2`, 13-Nov-2026.
- Evidence: Llaves tax_id (huella) y geo (geohash 8 + nombre parecido) en app.duplicate_matches, app.scan_duplicates y app.account_pairs_for; ID fiscal opcional en el alta (/comercios); conversión de lead, carga de Pipedrive y captura de ID fiscal encolan pares al momento (app.queue_account_matches). tests DAT-04 (4).
- Missing: Sin coordenadas reales la llave geo no actúa (los comercios no las traen; el alta acepta latitude/longitude si la Sales App las manda).
- Who unblocks or what it depends on: Sales App (coordenadas)

**DAT-05 · Campos por mercado vía metadata y procesos paralelos: Built.**
- Source: package `datos2`, 13-Nov-2026.
- Evidence: field_definitions.value_schema (minimum, maximum, minLength, maxLength, pattern) aplicado en domain/custom.ts; campos de contacto y actividad proponibles y editables (/comercios/<id>/contactos/<cid>); pedido 'Pasar a columna' con SQL preparado (crm.field_promotions) que se cierra solo al existir la columna; plazo medido en Datos > Campos desde decisión 'field.approval_sla_days'. tests DAT-05 (3), E2E.
- Missing: Subconjunto de JSON Schema, sin librería; la columna la aplica una migración revisada (no la pantalla).
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (plazo y decisión JSON Schema)

**DAT-06 · Kit de ingesta de red adquirida con segregación previa: Built.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /partners/redes y /partners/redes/[id] (carga CSV con el lector de la importación a espacio segregado por entidad legal, mapeo de columnas guardado por sistema, problemas y repetidos por alias/teléfono/nombre+ciudad, reporte de calidad por nodo, liberación de legal y de negocio por dos personas, promoción por lotes con árbol, alias y origen 'conversión de red', marcha atrás por lote con bitácora); tests/db/partners.test.ts (DAT-06, 2 pruebas), e2e red
- Missing: Archivos grandes (más de 2 MB o 5,000 filas) necesitarían almacenamiento de archivos; hoy se parten en varias cargas.

**DAT-07 · Catálogo de productos y matriz de productos por PDV con estado por carrier: Built.**
- Source: package `datos2`, 13-Nov-2026.
- Evidence: Entidad legal del producto editable en /datos?tab=productos; 'Abrir negocios de expansión' desde la base (src/domain/products2.ts, deal + account_products ligado); catálogo real marcado como decisión 'product.catalog_source'. tests DAT-07 (2), E2E.
- Missing: Catálogo real de productos, proveedores y plazos no cargado (datos de ejemplo).
- Who unblocks or what it depends on: Operaciones US y MX

### LEAD · Captura, atribución, ruteo y SLA

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| LEAD-01 | Prospecto dentro del objeto cuenta | Must | F1 | Partial |
| LEAD-02 | Captura multicanal con atribución (UTM, click IDs, CTWA) | Should | F1 | Built, external channel off |
| LEAD-03 | Ruteo y asignación | Must | F1 | Built |
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

**LEAD-03 · Ruteo y asignación: Built.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Sugerencia de tienda saturada (crm.routing_suggestions) que supervisión confirma o descarta en /supervisor; comercios sin dueño de la Sales App e importación pasan por las reglas (routeNewAccount, bitácora con account_id); condición y nombre de la regla editables en /admin/embudo. tests/db/embudo2.test.ts 'LEAD-03'; e2e zx-embudo2.
- Missing: La regla automática de saturación espera ~3 meses de datos de PIPE-04 (por diseño del ítem).
- Who unblocks or what it depends on: Liderazgo comercial

**LEAD-04 · SLA de primer contacto con escalamiento: Partial.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Reloj genérico crm.sla_timers (started, due, attempt, met); se cierra con el contacto efectivo (leads.first_contact_at, configurable a 'intento'); horario hábil salta feriados del mercado y usa la zona del punto de venta (leads.timezone, campo opcional del formulario web, contrato web-forms-v1). tests/db/embudo2.test.ts 'LEAD-04'.
- Missing: Línea base de 4 semanas en dealers: valor configurable propuesto, sin meta fijada. La zona del PDV solo llega si el formulario la manda.
- Who unblocks or what it depends on: Liderazgo de ventas US

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
| PIPE-07 | Oferta comercial y contrato como objeto (CPQ-lite) | Should | F2 | Partial |
| PIPE-08 | Plan de integración compartido para KAM (mutual action plan) | Could | F2 | Built, external channel off |

**PIPE-01 · Pipelines por motor con criterios de salida y campos por etapa: Partial.**
- Source: package `embudo`, 13-Nov-2026, checked at integration 95-2.
- Evidence: La base impone los requisitos de etapa en toda vía de escritura: trigger crm.deal_stage_gate + crm.stage_missing (migración 0030), misma lectura que deals.ts:missingForStage. Importación de Pipedrive, carga de hojas y archivar etapa ya no saltan en silencio: lo que falta queda en crm.deal_stage_gaps, se ve en el negocio (aviso 'entró a su etapa sin lo que la etapa pide') y en /reportes/embudo. Requisitos con condición (mercado, tipo de cuenta, monto) en dominio y base: src/domain/embudo/stage-conditions.ts, pantalla /admin/embudo ('Embudos por tipo de venta y requisitos con condición', agrupado por tipo de venta con sus mercados). Pruebas: tests/db/embudo.test.ts 'PIPE-01' (3), tests/e2e/zx-embudo.spec.ts (condición).
- Missing: 1) Un solo embudo por tipo de venta compartido entre mercados: hoy sigue habiendo un embudo por mercado y tipo de venta; lo que quedó es la variante por metadata (condición por mercado) y la vista agrupada. Unificarlos cambia crm.pipelines.market_code y RLS: decisión de arquitectura. 2) En D2D los requisitos no llegan del evento de la Sales App (el contrato no los trae). 3) La base usa un trigger, no una función única con el update de stage_id revocado: el efecto es el mismo (ninguna escritura lo salta) sin reescribir las seis vías que hoy mueven etapas.
- Who unblocks or what it depends on: Yamil con Dan Mulligan (embudo global por tipo de venta); equipo de la Sales App (requisitos en el evento)

**PIPE-02 · Transiciones con dueño, evidencia y SLA (tipo Blueprint): Built, external channel off.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Evidencia como documento del expediente (document_id, content_hash, storage_ref) o huella SHA-256 en la ficha del negocio; pasos de alta MX (alta a espera) y crédito ACH US (carrier a aprobado) sembrados en pausa con aprobador Operaciones y suplente, 'Valor propuesto [pendiente: Operaciones]', activables con un clic. tests/db/embudo2.test.ts 'PIPE-02'; e2e zx-embudo2.
- Missing: Operaciones confirma los dos pasos; ningún stage tiene sla_hours fijado (cifra de negocio).
- Adapter turned off: CONTIGO_DOCUMENT_VAULT (bóveda): guarda referencia y huella, no el archivo
- Who unblocks or what it depends on: Operaciones; Comité/Dan Mulligan o Michael Essiet para la bóveda

**PIPE-03 · Rotting y estancamiento: Built.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Espera al cliente y al carrier con umbral propio (stages.rot_days_customer/carrier, waiting_on 'carrier'); estancado = umbral vencido y sin próximo paso por venir (campo rotting); alta sin primera venta con el umbral de su etapa. /admin/automatizaciones?v=pasos, ficha del negocio. tests/db/embudo2.test.ts 'PIPE-03'.

**PIPE-04 · Motivos de pérdida y de no-venta codificados: Partial.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Custodia como permiso (reason.custody, solo administración/C1); tope configurable de base (10) y por mercado (2) aplicado al agregar o reactivar, motivos de no venta también; nunca se borran (revoke delete, retired_at). Tarjeta 'Tope del catálogo de motivos' en /admin/embudo. tests/db/embudo2.test.ts 'PIPE-04'.
- Missing: Elegir cuáles de los motivos actuales quedan (hoy hay más de 10 de base activos; no se pueden agregar más hasta apagar). Ventas propone por Solicitudes; no hay calendario trimestral automático.
- Who unblocks or what it depends on: Yamil (C1) con ventas

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

**PIPE-07 · Oferta comercial y contrato como objeto (CPQ-lite): Partial.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Líneas de comisión ligadas al catálogo de productos (product_id/product_code, marca 'sin ligar'); estado de comisiones del mes (vista previa) en /comercios/<id>/contratos calculado con términos vigentes, pagos del archivo de ventas y canal atribuido. tests/db/embudo2.test.ts 'PIPE-07'.
- Missing: Pago y cierre de statements son de CANAL-05; firma electrónica sigue apagada.
- Adapter turned off: CONTIGO_ESIGN_ADAPTER (firma electrónica)
- Who unblocks or what it depends on: Finanzas/CANAL-05; Dan Mulligan o Michael Essiet (proveedor de firma)

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
| ACT-02 | Próximo paso obligatorio | Must | F1 | Built |
| ACT-03 | Captura de comunicaciones (email, calendario, WhatsApp) | Should | F2 | Partial |

**ACT-01 · Timeline único con actividades y notas de primera clase: Partial.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Append-only: lo hecho no se reescribe ni se borra desde la app (triggers), corrección como fila nueva (corrects_id) con 'Corregir' en el hilo; visibility_class por actividad (equipo, quien dirige, reservada) con RLS; retención configurable (vacía = guarda todo) con job embudo2.activity_retention; resumen semanal del archivo de ventas como una entrada por semana (job embudo2.weekly_sales_summary). tests/db/embudo2.test.ts 'ACT-01'; e2e zx-embudo2.
- Missing: Partición mensual de la tabla (no hecha: riesgo alto de migración sin necesidad con el volumen actual). Retención sin valor [pendiente: Yamil]. Estado de tickets depende del adaptador.
- Adapter turned off: SUPPORT_DESK (mesa de soporte)
- Who unblocks or what it depends on: Yamil (retención); Eliana Alvarez; Dan Mulligan o Michael Essiet

**ACT-02 · Próximo paso obligatorio: Built.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Avisos lead_no_next_step y onboarding_no_next_step en la cola de supervisión (reglas de base nuevas, engine.ts); tope de fecha del próximo paso en dominio (embudo2/settings.ts) y base (trigger deals_next_step_cap), configurable en /admin/embudo. tests/db/embudo2.test.ts 'ACT-02'; e2e zx-embudo2.
- Missing: Tope de 90 días es valor propuesto [pendiente: Liderazgo comercial].
- Who unblocks or what it depends on: Liderazgo comercial

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
| CAMPO-04 | Tablero del supervisor y cola de excepciones | Must | F1 | Built, external channel off |
| CAMPO-05 | KPIs de campo con trust score de visita | Should | F2 | Built |
| CAMPO-06 | Expediente de alta y mesa de control | Must | F1 | Built, external channel off |
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

**CAMPO-04 · Tablero del supervisor y cola de excepciones: Built, external channel off.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: Trigger crm.exception_route_owner (0042): aviso sin dueño cae a dueño del territorio, supervisión o quien lidera, con detail.routed_to; motor de automatizaciones ya no cierra avisos que no son suyos (engine.ts); /campo?tab=umbrales muestra valor propuesto y fecha de calibración (threshold_review_days); tests/db/campo2.test.ts CAMPO-04, e2e zx-campo2
- Missing: Saldo real depende de la conexión de fondeo (sin cambio)
- Adapter turned off: funding-feed
- Who unblocks or what it depends on: Roxanna Quintero (datos S5); Ventas (calibración)

**CAMPO-05 · KPIs de campo con trust score de visita: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: visit.checked_out trae trust_score/trust_flags (contrato v1 opcional); umbral trust_min_score por mercado (propuesto 50); cumplimiento de ruta y distribución numérica en /reportes/indicadores-campo; tests/db/campo2.test.ts CAMPO-05, e2e
- Missing: Que la Sales App mande la señal; confirmar el umbral y la definición de ruta
- Who unblocks or what it depends on: Equipo Sales App; Ventas

**CAMPO-06 · Expediente de alta y mesa de control: Built, external channel off.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: onboarding.submitted abre o completa el expediente (openFileFromSalesAppTx); enlace de captura con código /e/<token>; Tax ID como dato reservado; crédito ACH a la vista en el expediente; tests/db/campo2.test.ts CAMPO-06, e2e zx-campo2
- Missing: Bóveda de documentos sigue apagada (solo enlace)
- Adapter turned off: document-vault
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet; comité (bóveda única con Sales Core)

**CAMPO-07 · Inteligencia competitiva en el PDV: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: evaluateCompetitionTx (campo.ts): avisos competitor_share_loss e indirect_route con umbrales versionados y cierre solo; tests/db/campo2.test.ts CAMPO-07
- Missing: Confirmar umbrales propuestos
- Who unblocks or what it depends on: Ventas y canales

**CAMPO-08 · Score 'PDV perfecto' consumido desde la Sales App: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: Grupo perfect_store en health_config (peso propuesto 10) y app.health_snapshot_run (0042); tests/db/campo2.test.ts CAMPO-08; e2e zx-ciclo-cs (5 grupos)
- Missing: Que la Sales App mande el checklist; confirmar peso
- Who unblocks or what it depends on: Equipo Sales App; Customer Success

### CANAL · Canal, PRM, atribución y comisiones

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| CANAL-01 | Portal de partners con visibilidad por subárbol | Should | F2 | Partial |
| CANAL-02 | Registro de PDV u oportunidad y reglas de compromiso | Should | F2 | Built |
| CANAL-03 | Atribución en 3 capas con fecha efectiva | Must | F1 | Built |
| CANAL-04 | Motor de comisiones y residuales | Won't | F3 | Not applicable |
| CANAL-05 | Visibilidad de comisión e incentivos por actividad sostenida | Should | F1 | Built |
| CANAL-06 | Tiers de partner, enablement y cruce de bases | Could | F3 | Built, external channel off |
| CANAL-07 | Fondeo, saldo y límite de crédito por nodo | Should | F2 | Partial |
| CANAL-08 | Disputas, ajustes y clawbacks de atribución y comisión | Should | F2 | Built |

**CANAL-01 · Portal de partners con visibilidad por subárbol: Partial.**
- Source: package `partners-contratos`, 13-Nov-2026.
- Evidence: /partners (portal del partner: su subárbol por RLS con estado del alta y etapa, nivel y material; para quien maneja: dar acceso de partner, invitar externo en cola, tokens), GET /api/partners/v1/accounts con token por subárbol (corre con la identidad del partner, RLS), baja automática al archivar o fusionar el nodo (trigger), persona sintética iso.partner; tests/db/partners.test.ts (CANAL-01, 3 pruebas), e2e portal y token
- Missing: Entrada de usuarios externos (adaptador apagado) y, por eso, el alta delegada de usuarios y sub-dealers desde el portal y la superficie dentro de axexo Business. 'Ver como' auditado ya existe (seguridad).
- Adapter turned off: external_identity (CONTIGO_EXTERNAL_IDENTITY_ADAPTER)
- Who unblocks or what it depends on: Dan Mulligan o Michael Essiet (identidad de externos) y P&T dueño de axexo Business

**CANAL-02 · Registro de PDV u oportunidad y reglas de compromiso: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: El aliado registra y ve sus registros y las reglas en /partners (RLS por nodo, app.claim_check); quien lidera los ve marcados; tests/db/campo2.test.ts CANAL-02, e2e
- Missing: Confirmar ventana 14+2x14
- Who unblocks or what it depends on: Ventas y canales

**CANAL-03 · Atribución en 3 capas con fecha efectiva: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: stampAttributionTx en toda alta (pantalla, lead, Sales App, red): origen clasificado por regla y capa de canal = equipo o agencia reclutadora; corrida auditada /campo?tab=atribucion (attribution.reclassified); tests/db/campo2.test.ts CANAL-03, e2e
- Missing: Árbitro de Finanzas como persona nombrada: hoy el árbitro nombrable debe liderar el mercado o administrar
- Who unblocks or what it depends on: Finanzas y Ventas

**CANAL-04 · Motor de comisiones y residuales: Not applicable.**
- Source: audit of 12-Nov-2026 (before the build program); no package of the program owns it.
- Evidence: El catálogo lo marca Won't (F3). docs/scope.md lo deja fuera a propósito ('commission calculation'). En código solo existe el campo de texto b2b_commission 'Comisión acordada' (0016).
- Who unblocks or what it depends on: P&T confirme si EMIDA o Movilway ya liquidan

**CANAL-05 · Visibilidad de comisión e incentivos por actividad sostenida: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: crm.commission_statements estimado/publicado (solo conteos, publicar exige reglas escritas); vista en /reportes/lo-que-llevo y portal /partners; premio por umbral y por equipo; job campo2.statements; tests y e2e
- Missing: Reglas escritas y umbral del premio (propuesto 10)
- Who unblocks or what it depends on: Ventas y Finanzas

**CANAL-06 · Tiers de partner, enablement y cruce de bases: Built, external channel off.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: crm.enablement_progress con registro a mano y job campo2.academy_progress; avance en portal y admin /partners; cruce dice dónde corre
- Missing: Avance real desde Kore Academy y cruce en el lakehouse
- Adapter turned off: academy_progress, lakehouse_crossmatch
- Who unblocks or what it depends on: Kore Academy; Data y Reportería; Dan Mulligan o Michael Essiet

**CANAL-07 · Fondeo, saldo y límite de crédito por nodo: Partial.**
- Source: package `campo-canal`, 13-Nov-2026.
- Evidence: account_funding (método, saldo, límite, fecha de corte, fuente), historial y simulador marcado como tal (solo administración, fuera de producción) en /campo?tab=credito; límite de crédito pedido y aprobado por otra persona (credit_limit_requests); adaptador funding-feed apagado y tarea campo-canal.funding_pull; tests y e2e
- Missing: El dato real: el archivo de ventas o el core no exponen fondeo, saldo ni límite. El límite aprobado no se escribe al core.
- Adapter turned off: funding-feed (CONTIGO_FUNDING_FEED)
- Who unblocks or what it depends on: Datos S5 (Roxanna Quintero) o core; Michael Essiet o Dan Mulligan

**CANAL-08 · Disputas, ajustes y clawbacks de atribución y comisión: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: crm.channel_policies versionada (ventana, texto ES/EN, árbitro nombrado, aprobación Finanzas+Ventas); resolveDispute respeta el árbitro; /campo?tab=disputas; tests y e2e
- Missing: Aprobación escrita de la política propuesta
- Who unblocks or what it depends on: Finanzas y Ventas

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
| CS-08 | Feedback de producto desde campo | Could | F2 | Built, external channel off |

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
- Source: package `campo2`, 13-Nov-2026.
- Evidence: visit.checked_out.manager_change -> recordManagerChangeTx (misma alerta); tests/db/campo2.test.ts CS-06
- Missing: Evento de Kore Academy (adaptador existente apagado)
- Adapter turned off: kore_academy
- Who unblocks or what it depends on: Kore Academy; Dan Mulligan o Michael Essiet

**CS-07 · Pipeline de expansión y cross-sell sobre comercio activo: Built.**
- Source: package `ciclo-cs`, 13-Nov-2026.
- Evidence: crm.expansion_rules por mercado (opcional producto del catálogo), app.expansion_run solo sobre activos con actividad real y sin el producto en la matriz, crm.expansion_opportunities hija de la cuenta con embudo por tomar/en conversación/aceptó/no aceptó, tarea al tomar, no reabre en 90 días. Prueba CS-07.

**CS-08 · Feedback de producto desde campo: Built, external channel off.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: feedbackDigest entrega por adaptador feedback_to_pt (cola 'Canal apagado') y emite evento de dominio feedback.digest_sent; /cuidado muestra estado; tests
- Missing: Canal de recepción de P&T
- Adapter turned off: feedback_to_pt
- Who unblocks or what it depends on: P&T (Dan Mulligan)

### REP · Reportes, métricas y forecast

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| REP-01 | Dashboards por rol y jerarquía (panel del LT) | Must | F1 | Built, external channel off |
| REP-02 | Snapshots históricos, eventos de etapa y cohortes | Must | F1 | Built, external channel off |
| REP-03 | Forecast por motor | Could | F3 | Partial |
| REP-04 | Capa de métricas única y conciliación con S5 | Must | F1 | Built, external channel off |

**REP-01 · Dashboards por rol y jerarquía (panel del LT): Built, external channel off.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: Roles finance y kam en src/domain/policy.ts; tableros por rol de 5 a 7 indicadores con definición y dueño (crm.role_boards, src/dal/role-boards.ts, src/ui/role-board.tsx): /reportes/kam, /reportes/operaciones, /partners (portal del partner con 6 cifras y su definición); Panel del LT por tipo de venta (/panel-lt); /admin/tableros para cambiar y confirmar la lista. Pruebas: tests/db/reportes2.test.ts 'tableros por rol...' (6), tests/e2e/zx-reportes2.spec.ts (KAM, Operaciones, partner, Panel del LT, Administración).
- Missing: Los indicadores por rol salen marcados 'Valor propuesto, [pendiente: C1 (Yamil Alvarez)]' hasta que C1 los confirme en /admin/tableros. Envío por correo y por Slack apagados.
- Adapter turned off: REPORT_MAIL_ADAPTER, REPORT_SLACK_ADAPTER (nuevo, cola con 'Canal apagado')
- Who unblocks or what it depends on: Yamil Alvarez (C1) confirma indicadores; Dan Mulligan o Michael Essiet aprueban correo y Slack

**REP-02 · Snapshots históricos, eventos de etapa y cohortes: Built, external channel off.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: /reportes/historico: cohortes de leads por semana, canal y persona con el alcance de quien mira; foto por equipo (crm.team_snapshots, app.take_team_snapshots, job reportes2.team_snapshot) que supervisión ve para su equipo; ventana corta configurable (snapshots.window_days=90, propuesto) que solo borra fotos ya entregadas; indicador opsPullThrough (mesa de control) en el tablero de Operaciones. Pruebas: tests/db/reportes2.test.ts 'histórico...' (3), E2E 'supervisión ve la foto de su equipo y corta las cohortes'.
- Missing: Exportación de la foto al lakehouse apagada: destino y formato sin acordar. Sin particionado físico de tablas (ventana corta + índices por fecha en su lugar, decisión por defecto).
- Adapter turned off: SNAPSHOT_FILE_ADAPTER
- Who unblocks or what it depends on: Roxanna Quintero (S5): destino y formato del archivo y la ventana

**REP-03 · Forecast por motor: Partial.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: Categoría de pronóstico en la oportunidad (crm.deal_forecast: commit, best_case, pipeline, omitted) que pone KAM y ajuste de quien dirige al lado con nota; envíos versionados (crm.forecast_submissions) que no cambian al reorganizar territorios ni pasar la cuenta; /reportes/kam. Pruebas: tests/db/reportes2.test.ts 'pronóstico por categoría...' (2), E2E 'la persona KAM ... envía el pronóstico; quien dirige ajusta'.
- Missing: Proyección estadística D2D de altas y activaciones por cohorte: vive en S5, no en CONTIGO. Las categorías son propuesta hasta que C1 las confirme.
- Who unblocks or what it depends on: Roxanna Quintero (S5) para la proyección D2D; Yamil Alvarez (C1) para las categorías

**REP-04 · Capa de métricas única y conciliación con S5: Built, external channel off.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: Ficha del comercio dice de dónde sale el estado (archivo de ventas con su corte, o regla de respaldo marcada '[pendiente: Roxanna Quintero]') con su definición de metric-defs; TPV por producto y comisión si el archivo los trae (crm.merchant_metrics_daily.tpv_by_product, commission_minor_30d); contrato docs/contracts/merchant-metrics-daily-v1.md con status, TPV y comisión opcionales; diferencias con el archivo como regla de calidad s5_diff. Pruebas: tests/db/reportes2.test.ts 'archivo de ventas...' y 'las diferencias con el archivo de ventas son una regla de calidad con dueño'.
- Missing: Que S5 publique status, TPV por producto y comisión en el archivo real; mientras no, CONTIGO usa su regla de respaldo y lo dice en pantalla.
- Adapter turned off: SALES_FILE (adaptador sales_file)
- Who unblocks or what it depends on: Roxanna Quintero (S5)

### AUT · Automatización, eventos e integraciones

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| AUT-01 | Capa de dominio única para reglas | Must | F1 | Partial |
| AUT-02 | Eventos de dominio (outbox) | Must | F1 | Partial |
| AUT-03 | Workflows, SLAs y aprobaciones como transiciones | Should | F1 | Built |
| AUT-04 | API y entornos de prueba | Must | F1 | Partial |
| AUT-05 | Servicio de notificaciones centralizado | Should | F2 | Partial |
| AUT-06 | Ingesta del lakehouse por archivos diarios | Should | F1 | Built, external channel off |
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

**AUT-03 · Workflows, SLAs y aprobaciones como transiciones: Built.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: owner_id obligatorio (not null y trigger); las sin dueño quedan con administración y marcadas 'Responsable por confirmar' en /admin/automatizaciones con botón Confirmar; no se guarda sin responsable; aprobaciones de alta y crédito ACH en el seed (en pausa, propuestas). tests/db/embudo2.test.ts 'AUT-03'; e2e zx-embudo2 y zx-automatizaciones.
- Missing: Programar el cron en el despliegue (vercel.json) sigue fuera del alcance.
- Who unblocks or what it depends on: Administración (confirmar responsables); Operaciones (activar pasos)

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

**AUT-06 · Ingesta del lakehouse por archivos diarios: Built, external channel off.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: src/domain/integrations.ts: un archivo con corte anterior al último aplicado a los mismos comercios se rechaza (stale_as_of, 409) y no cambia su estado; manifiesto obligatorio configurable (ingest.require_manifest, propuesto apagado, en /admin/tableros y /estado). Contrato actualizado. Pruebas: tests/db/reportes2.test.ts 'un archivo con corte anterior...' y 'con el manifiesto obligatorio...'.
- Missing: La carga real desde S5 sigue apagada (entra por API o Administración); el manifiesto obligatorio se enciende cuando S5 lo mande en cada archivo.
- Adapter turned off: SALES_FILE (adaptador sales_file)
- Who unblocks or what it depends on: Roxanna Quintero (S5)

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
| IA-08 | Evaluación de IA | Should | F2 | Partial |

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

**IA-08 · Evaluación de IA: Partial.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: Job reportes2.ia_regression: si cambia la versión de instrucciones o el modo del modelo, corre la evaluación sola y no la repite; costo por acción de IA en el tablero de Finanzas. Prueba: tests/db/reportes2.test.ts 'la regresión de IA corre sola...' y 'Finanzas lee ... por acción de IA'.
- Missing: Casos reales anonimizados por caso de uso (hoy 19 sintéticos). Correr contra un modelo real requiere encender el adaptador de IA.
- Adapter turned off: AI_ADAPTER
- Who unblocks or what it depends on: Yamil Alvarez (C1): casos anonimizados; Dan Mulligan o Michael Essiet: encender AI_ADAPTER

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
- Source: package `datos2`, 13-Nov-2026.
- Evidence: contracts.legal_entity_id NOT NULL con default del comercio y chequeo de mercado; leads.legal_entity_id NOT NULL; leads.timezone opcional; app.business_due con zona (lead: la suya o la del comercio; SLA de etapa: app.account_timezone); tarea 'datos.account_timezones' pone la zona del estado (US y MX, solo estados enteros). tests MULTI-02 (3).
- Missing: Interfaz en portugués no hecha (todo el producto usa t(es,en)). Hoy (tareas del día) sigue con el día del mercado. La zona por estado se aplica cuando corra la tarea en staging.
- Who unblocks or what it depends on: Legal y Finanzas (lista de entidades); decisión de abrir Brasil para portugués

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
| SEG-06 | Código de conducta e incidentes de campo | Should | F2 | Built |
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

**SEG-06 · Código de conducta e incidentes de campo: Built.**
- Source: package `campo2`, 13-Nov-2026.
- Evidence: Evento equipment.changed -> crm.equipment_events; incidente ligado a equipo, visita, trust score y atribución del día (incidentLinks); /campo?tab=incidentes; tests/db/campo2.test.ts SEG-06
- Missing: Que la Sales App mande el evento; Compliance confirma tipos
- Who unblocks or what it depends on: Equipo Sales App; Compliance

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
| UX-03 | Vistas guardadas como colas y estados vacíos útiles | Must | F1 | Built |
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

**UX-03 · Vistas guardadas como colas y estados vacíos útiles: Built.**
- Source: package `embudo2`, 13-Nov-2026.
- Evidence: Colas oficiales por rol (saved_views.official_role): Revisitas vencidas (ventas), Altas sin fondeo (Operaciones), En riesgo (supervisión); filtros paso=revisita-vencida y fondeo=sin en la lista blanca; contador en la barra principal y página /colas; vistas guardadas también en el tablero de Negocios. tests/db/embudo2.test.ts 'UX-03'; e2e zx-embudo2.
- Missing: Las colas por rol son propuesta [pendiente: C1].
- Who unblocks or what it depends on: C1

**UX-04 · Móvil para supervisores y KAM: Partial.**
- Source: package `mercados`, 13-Nov-2026, checked at integration 95-2.
- Evidence: Enlace directo /comercios/ref/<ID de la Sales App, Merchant ID o ID de CONTIGO> que no revela comercios fuera del alcance. A 390 px, sin desbordes y con axe limpio: ficha y pestaña Datos como quien lidera y como Operaciones, revisión del identificador fiscal de un toque, Cerca de mí, Consolidado y Administración de mercados. Pruebas: tests/db/mercados.test.ts 'UX-04'; zx-mercados 'UX-04' y los recorridos a 390 px.
- Missing: 1) Sin caché de lectura sin señal: no la construí porque deja datos de comercios guardados en teléfonos personales (decisión de Seguridad). 2) El enlace existe de este lado; falta que la Sales App lo use. 3) Velocidad en un teléfono real sin medir. 4) Las aprobaciones de pasos de etapa son del paquete automatizaciones: no las verifiqué a 390 px.
- Who unblocks or what it depends on: Seguridad (caché en el teléfono); equipo de la Sales App (enlace)

### GOB · Gobierno, adopción y operación

| ID | Feature | Priority | Phase | Status |
|---|---|---|---|---|
| GOB-01 | Registro de campos (field registry) | Must | F1 | Built |
| GOB-02 | Tablero de calidad de datos | Should | F1 | Built |
| GOB-03 | Adopción, métricas de uso y change management | Must | F1 | Built |
| GOB-04 | Gobierno de releases y mantenimiento | Must | F1 | Partial |
| GOB-05 | Migración y convivencia con Pipedrive y Zoho | Should | F1 | Built, external channel off |
| GOB-06 | Avisos a la red con acuse | Should | F2 | Built, external channel off |
| GOB-07 | Observabilidad, respaldo y recuperación | Should | F1 | Partial |
| GOB-08 | Datos de prueba sintéticos por mercado | Should | F1 | Partial |
| GOB-09 | Costo unitario del CRM (FinOps) | Should | F1 | Built, external channel off |
| GOB-10 | Soporte y entrenamiento in-app | Should | F1 | Partial |

**GOB-01 · Registro de campos (field registry): Built.**
- Source: package `datos`, 13-Nov-2026.
- Evidence: crm.field_definitions con dueño, propósito, decisión que habilita, fecha de revisión, clase de dato personal, marca de dato de fuera sin validar, de dónde viene y quién lo usa, estado de propuesta y quién decidió. 'Sin decisión documentada no hay campo': createField y proposeField la exigen. Flujo: quien lidera el mercado propone, administración aprueba o rechaza con motivo; plazo publicado en crm.settings (field_approval_sla_days = 3) y propuesta marcada 'Fuera de plazo'. Uso por campo (app.field_usage) con marca 'Sin uso' para retirar. Lo que llega de Pipedrive entra marcado y aparece en 'Sin decisión'. Pantalla: /datos?tab=campos y 'Crear campo' en /admin?tab=embudos (ahora pide la decisión). Pruebas: tests/db/datos.test.ts 'DAT-05 / GOB-01', tests/e2e/zx-datos.spec.ts 'quien lidera el mercado propone un campo...'. Integración de la ola 1 (13-nov): la marca "llega de fuera sin validar" comparte columna con IA-07 (0021): un campo de texto libre siempre la lleva y la pantalla lo dice.
- Who unblocks or what it depends on: Yamil: nombrar a los responsables de cada campo existente (los sembrados y los de Pipedrive quedan en la vista 'Sin decisión')

**GOB-02 · Tablero de calidad de datos: Built.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: Job reportes2.quality_notices: las reglas elegidas en Administración (quality.exception_rules, propuesto vacío, mínimo 5) abren un aviso data_quality por persona en la cola de Mi equipo y lo cierran al bajar del mínimo; supervisión ve los avisos de su equipo (RLS); regla s5_diff 'Diferencias con el archivo de ventas' con dueño. Pruebas: tests/db/reportes2.test.ts 'calidad de datos dentro de la cola de avisos' (2).
- Missing: Qué reglas abren avisos lo decide C1 (hoy ninguna, valor propuesto). La tendencia sigue dependiendo del corte diario.
- Who unblocks or what it depends on: Yamil Alvarez (C1)

**GOB-03 · Adopción, métricas de uso y change management: Built.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: 1:1 con el tablero (crm.one_on_ones, anotada por supervisión en /reportes/adopcion), colas atendidas y tablero abierto como eventos de uso por el outbox (usage.board_opened, usage.queue_item_done en src/domain/events/catalog.ts); regla de paso a despliegue como dato propuesto (adoption.rollout_rule). Pruebas: tests/db/reportes2.test.ts 'adopción...' (2), E2E 'quien supervisa anota una 1:1'.
- Missing: La regla de paso a despliegue es propuesta hasta que la confirmen. Soporte por WhatsApp sigue apagado (GOB-10, de otro paquete).
- Who unblocks or what it depends on: Yamil Alvarez y quienes lideran los mercados

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

**GOB-09 · Costo unitario del CRM (FinOps): Built, external channel off.**
- Source: package `reportes2`, 13-Nov-2026.
- Evidence: Rol de Finanzas lee los costos por mes con costo por persona activa y por acción de IA (/reportes/finanzas, tablero de Finanzas); sin costos cargados no muestra cifra. Pruebas: tests/db/reportes2.test.ts 'Finanzas lee los costos por mes...', E2E 'Finanzas entra a su reporte, ve el costo de CONTIGO'.
- Missing: Lectura automática de la facturación apagada; los costos se cargan a mano en /admin/gobierno.
- Adapter turned off: BILLING_ADAPTER
- Who unblocks or what it depends on: Finanzas (cargar costos); Dan Mulligan (facturación)

**GOB-10 · Soporte y entrenamiento in-app: Partial.**
- Source: package `avisos`, 13-Nov-2026.
- Evidence: Ayuda contextual: enlace "¿Cómo se usa esto?" al pie de cada pantalla que abre /como-se-usa con las preguntas de esa pantalla (src/content/screen-help.ts) y la lección de Kore Academy si administración cargó el enlace (/admin/avisos, Lecciones por pantalla). Novedades de versión al entrar: anuncio de tema Novedades de CONTIGO, publicado por administración. Reporte con tiempos: recibido, en revisión (botón Empezar a revisar), respondido, con plazo por urgencia configurable por mercado y aviso a quien reportó (/reportar, /admin?tab=reportes). Pruebas: tests/db/avisos2.test.ts (GOB-10), tests/unit/avisos.test.ts, tests/e2e/zx-avisos.spec.ts.
- Missing: 1) Enlaces de las lecciones de Kore Academy: el campo existe, las direcciones no. 2) Canal de soporte por WhatsApp apagado y sin número definido. 3) Plazos de respuesta sin valor: no se inventaron, los pone administración. 4) Registro de qué se busca en la Ayuda (insumo de mejoras): no hecho, vive en ayuda/* y ui/help.tsx, que son del paquete de contenido.
- Adapter turned off: whatsapp (WHATSAPP_ADAPTER)
- Who unblocks or what it depends on: Responsable de Kore Academy (enlaces); Yamil y Customer Support (dueño, número y plazos del soporte); Michael Essiet o Dan Mulligan (revisión de tecnología)

## The 180 requirements
Source: `axexo-crm-requirements-v1` audited on 12-Nov-2026 (180 requirements). State before the build program: 58 built, 81 partial, 35 missing, 2 not applicable, 4 not verified.

Requirements already reported by an integrated package of the program (94): 87 built, 7 partial. One line each:

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
| E3.F10 | Built | `datos2` | n/a |
| E4.F2 | Built | `datos2` | Decisión por defecto: apagado en todos los mercados (también US) hasta que Martech lo encienda en Administración, Decisiones de negocio. |
| E4.F4 | Built | `seguridad` | La persona de agencia necesita una cuenta de Google de la organización (no hay ingreso para externos). Integración 95-2: ligado a E9.F12. Un solo catálogo de agencias (crm.agencies de 0027 con la clase agencia o socio de 0030); lo que crea la agencia confinada nace con "Reclutado por" de su clase (tests/db/integracion-95-2.test.ts). |
| E4.F9 | Built | `datos2` | Usuarios de partner y los que crea la carga de Pipedrive no pasan por el candado (siguen en 'accesos sin aprobación'). |
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
| E6.F8 | Built | `datos2` | Permitirlo en producción es decisión de Dan Mulligan (se cambia por migración). |
| E7.F2 | Built | `gobierno` | n/a |
| E7.F3 | Built | `gobierno` | Los nombres: ningún equipo tiene champion nombrado (el requerimiento los deja abiertos). |
| E7.F6 | Built | `gobierno` | n/a |
| E7.F7 | Built | `gobierno` | n/a |
| E7.F8 | Built | `gobierno` | n/a |
| E7.F9 | Partial | `gobierno` | El material mismo (presentación, guía de leads y preguntas frecuentes por mercado) no existe todavía y no está publicado en el portal de aprendizaje: [pendiente: Kore Academy]. |
| E8.F3 | Built | `campo2` | n/a |
| E8.F4 | Built | `reportes2` | n/a |
| E8.F5 | Built | `reportes2` | Confirmar con Finanzas el acceso (decisión por defecto: solo lectura de sus reportes). |
| E8.F7 | Built | `reportes2` | Que S5 lea owner_ref en sus reportes diarios y Administración cargue los IDs en S5 de cada persona. |
| E9.F1 | Built | `us-ficha` | El requerimiento deja el acomodo como abierto: falta que el equipo de campo lo confirme. |
| E9.F2 | Built | `us-ficha` | Definición y fuente del número siguen abiertas en el documento; se construyó el supuesto de trabajo (texto que llena Operaciones). |
| E9.F3 | Built | `us-ficha` | Los tipos generales (cadena, corporativo) siguen disponibles en US para armar árboles. Lo importado que no es tienda toma su tipo por Channel Segment al correr la configuración, no en cada recarga (regla del importador, paquete integraciones-migracion). |
| E9.F4 | Built | `us-ficha` | n/a |
| E9.F5 | Built | `us-ficha` | Las reglas son 'Proposed' en el documento. Lo importado sin ID de EMIDA queda 'Sin definir' hasta que alguien lo fije; el importador no lee el campo Merchant Origin de Pipedrive. |
| E9.F6 | Built | `us-ficha` | n/a |
| E9.F8 | Built | `us-ficha` | Los seis carriers reales (H2O, AT&T, T-Mobile, Gen Mobile, Ultra, LWP) están listos en crm.dealer_record_setup('US', true) pero NO se cargan solos: cada proveedor activo cuenta como aprobación pendiente en los negocios abiertos de Operaciones. La lista de campos es 'Proposed'; se guarda un identificador por carrier; 'HDN Account ID' quedó como identificador de H2O (por confirmar). |
| E9.F9 | Built | `us-ficha` | n/a |
| E9.F10 | Built | `us-ficha` | n/a |
| E9.F11 | Built | `datos2` | Listas reales y fuente del estado de baja las definen Operaciones y ventas US. |
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
| E11.F3 | Built | `reportes2` | Logotipo y encabezado definitivos de Empower: valor propuesto hasta que Marketing los entregue. |
| E11.F4 | Built | `us-embudo` | El correo real al buzón de pedidos sigue apagado. |
| E11.F5 | Built | `us-embudo` | n/a |
| E12.F1 | Built | `us-embudo` | n/a |
| E12.F2 | Built | `us-embudo` | n/a |
| E12.F3 | Built | `us-embudo` | n/a |
| E12.F4 | Partial | `embudo2` | La lista real del sistema anterior confirmada por ventas US. |
| E12.F6 | Built | `reportes2` | Finanzas confirma que esa es su fuente (decisión por defecto: la descarga de CONTIGO). |
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
