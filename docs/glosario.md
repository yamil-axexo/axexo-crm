# Glosario de producto de axexo CONTIGO (ES y EN)

Paquete `vocabulario`, 12-nov-2026; el paquete contenido95 (14-nov-2026) sumó los términos del programa "los 95"; la integración final lo extendió a la guía y a la marca de sin dato. Lo cuidan `tests/unit/vocabulario.test.ts` (catálogos, textos del código y la guía en `src/content/guide.ts`) y `tests/e2e/zx-vocabulario.spec.ts` (texto a la vista por rol, incluidas Ayuda y Primeros pasos). Las reglas viven en `tests/support/vocab-rules.mjs`. La guía, la ayuda, la bienvenida y la entrada usan estos mismos términos.

## Términos (un nombre para cada cosa)

| Concepto | Español | English | No usar |
|---|---|---|---|
| Menú | Hoy, Leads, Negocios, Comercios | Today, Leads, Deals, Merchants | |
| Menú de la cuenta | Mi equipo, Panel del LT, Administración | My team, Leadership panel, Administration | Supervisión / Supervision como título de pantalla, LT panel |
| Oportunidad de venta | negocio | deal | deal (en español) |
| Camino de un negocio | embudo; sus pasos son etapas | pipeline; stage | pipeline, stage (en español); funnel (en inglés) |
| Historial de un comercio o negocio | hilo | thread | timeline (en los dos idiomas) |
| Persona de axexo que lleva el registro | quién lo lleva; "Lo lleva: Nombre" | owner; "Owner: Name" | dueño, owner (en español) |
| Registro que nadie lleva | sin asignar | no owner | sin dueño |
| Lo lleva una cuenta de servicio o alguien que hoy no vende ni opera en ese mercado (incluye lo sin asignar) | por repartir | no current owner | sin dueño vigente, dueño sin acceso |
| Etiqueta de esa persona en las listas | (no vende ni opera en este mercado) | (does not sell or run operations in this market) | (sin rol de ventas) |
| Contacto que es dueño de la tienda | dueño del comercio | store owner | "Dueño" a secas como rol de contacto |
| Mover registros entre personas | repartir, reasignar; se van "con sus negocios abiertos y sus pendientes" | distribute, reassign; "with their open deals and to-dos" | tareas abiertas (ahora incluye visitas por hacer) |
| Lo que hay que hacer | pendiente(s) | to-do(s) | |
| Avisos de la regla en Mi equipo | Pendientes del equipo; "Actualizar avisos"; "Qué hacer: ..." | Team alerts; "Refresh alerts"; "What to do: ..." | Cola de excepciones, Evaluar reglas, excepción |
| Archivo diario de ventas (el sistema de datos) | datos de ventas; archivo diario de ventas | sales data; daily sales file | S5 |
| ID del comercio en los datos de ventas | Merchant ID | Merchant ID | S5 (merchant ID) |
| Forma de vender (D2D, cadenas, dealers, pedidos) | tipo de venta | sale type | motor, sales motion |
| D2D | Tiendas, puerta a puerta | Stores, door to door | D2D sin explicar |
| Tienda que acaba de entrar, sin negocio | Recién llegado | Just arrived | Lead nuevo como estado de una tienda |
| Tienda activa sin nada pendiente | Al día | All caught up | pintarla como "Sin próximo paso" en ámbar |
| Paso de Ventas a Operaciones | entrega a Operaciones | handoff | handoff (en español) |
| Lista de trabajo de Operaciones | Cola de Operaciones | Operations queue | |
| Pestaña de Administración con lo que el equipo manda desde "Reportar un problema" | Problemas reportados | Reported problems | Reportes / Reports (esos son los de liderazgo: Negocios cerrados, Reporte de campo, Adopción) |
| Punto de venta (en inglés) | punto de venta, tienda | store | point of sale, PDV |
| Meta de primer contacto de un lead | meta de primer contacto; "Primer contacto a tiempo" | first-contact goal; "First contact on time" | SLA, lead time |
| Pantalla de escritorio | computadora | computer | desktop (en español) |
| Avisos que CONTIGO deja a otros sistemas | avisos para otros sistemas | notices for other systems | outbox |
| Sin dato en una celda o en un valor | s/d (con la explicación "Sin dato" al pasar el cursor y para el lector de pantalla) | n/a ("No data") | guiones largos, ni en una frase ni solos como marca |

## Términos del programa "los 95" (olas 1 a 7, paquete contenido95, 14-nov-2026)

| Concepto | Español | English | No usar |
|---|---|---|---|
| Algo que CONTIGO hace solo (cuándo, si, entonces) | automatización | automation | flujo, workflow (en español) |
| De una etapa a otra, con quién lo da, evidencia y aprobación | paso de etapa | stage step | transición (a la vista) |
| Prueba de un paso, siempre como enlace | evidencia | evidence | adjunto (CONTIGO no guarda el archivo) |
| Visto bueno de un paso; quien lo cubre si no contesta | aprobación; suplente | approval; backup | |
| Horas hábiles que un negocio puede estar en una etapa | meta de tiempo de la etapa | stage time goal | SLA |
| Trabajo que corre por horario y cada vez que corre | tareas programadas; corrida | scheduled jobs; run | cron, job (en español) |
| Lo que le llega a una persona (campana, Avisos, Hoy) | aviso | notice | notificación push (en español, mientras está apagado) |
| Por dónde quiere cada quien sus avisos | Preferencias de avisos; resumen diario | Notice preferences; daily summary | |
| Mensaje para un equipo que pide confirmación | anuncio; "Enterado"; acuse | announcement; "Got it"; acknowledgment | |
| Mensajes que esperan salir por un canal apagado | cola de salida; "Canal apagado" | outgoing queue; "Channel off" | outbox |
| Conexión con otro sistema, construida y sin encender | conector; construido y apagado | connector; built and turned off | integración pendiente |
| Requisitos para encender un conector | su variable en "live", las credenciales y el sign-off escrito de Dan Mulligan o Michael Essiet | its variable set to "live", the credentials and the written sign-off from Dan Mulligan or Michael Essiet | |
| Valor con el que CONTIGO funciona mientras quien decide no lo fija | valor propuesto; "Valor propuesto, [pendiente: quién]" | proposed value; "Proposed value, [pending: who]" | default, valor por defecto |
| Registro del cambio de algo que salió hacia otro sistema | evento; suscriptor; mensaje muerto | event; subscriber; dead letter | webhook (a la vista en español) |
| Acceso de otro sistema | llave de API (rotar, revocar, llave de prueba) | API key (rotate, revoke, test key) | token (en español, salvo el del partner) |
| Mensaje de la Sales App que no se pudo procesar | mensaje detenido; "Reprocesar" | held message; "Reprocess" | |
| Filtro con nombre | vista guardada; fijarla como cola | saved view; pin it as a queue | filtro guardado |
| Colas oficiales y fijadas de un rol | Colas del equipo | Team queues | bandeja |
| Reporte con periodo y filtros guardados | reporte guardado; programar | saved report; schedule | |
| Cifra con una sola definición y su responsable | "Cómo se calcula"; quién responde por este número | "How it is calculated"; who answers for this number | KPI (a la vista en español) |
| Foto de los negocios abiertos por día | foto diaria | daily snapshot | |
| Dos comercios que son el mismo | duplicado; fusionar; deshacer la fusión | duplicate; merge; undo the merge | |
| Contacto de varios comercios | contacto compartido; teléfono en espera | shared contact; phone on hold | |
| Etapa del comercio después de la venta | etapa de vida (Prospecto, En alta, Activo, Con hábito, En riesgo, Inactivo, Reactivado) | lifecycle stage | |
| Paso de un comercio a otro equipo | entrega entre equipos; acuse | handoff between teams; acknowledgment | handoff (en español) |
| Lista de documentos del alta | expediente de alta; mesa de control | enrollment file; control desk | |
| Venta registrada por un canal | registro de canal; atribución; disputa | channel registration; attribution; dispute | |
| Sociedad que factura en un mercado | entidad legal | legal entity | razón social (a la vista) |
| Total de varios mercados en dólares | consolidado en USD; "sin convertir" | consolidated in USD; "not converted" | |
| Identificador fiscal guardado como últimos 4 y huella | identificador fiscal; "por revisar" | tax ID; "to review" | RFC o EIN completo |
| Bitácora y alertas de seguridad | Seguridad; "Ver como otra persona"; administrar por partes | Security; "View as someone else"; administering by parts | |
| Persona que pide ver, corregir o eliminar sus datos | solicitud de titular | data subject request | |
| Pantalla de servicio, versiones, costos y cambios | Gobierno; objetivos de servicio; incidente; champion | Governance; service objectives; incident; champion | |
| Pedido de un campo, una opción o un reporte | Pedir un cambio | Request a change | |
| Rol que lee las cifras de ventas y costo | Finanzas | Finance | |
| Rol que lleva cuentas clave | Cuentas clave (KAM) | Key accounts (KAM) | |
| Sugerencias por reglas, borradores y preguntas sobre cifras | Asistencia (la IA está apagada) | Assistance (AI is off) | asistente con IA (mientras esté apagada) |
| Plan de una red o un partner | plan de integración; términos y contratos; nivel | integration plan; terms and contracts; tier | |

## Reglas de redacción

- Español neutro, sin voseo, con acentos y signos de apertura. "IA" en español, "AI" en inglés. "axexo" en minúscula, "CONTIGO" en mayúsculas.
- Sin guiones largos (los dos signos de raya, el largo y el medio) en ningún texto a la vista ni en el código de `src` fuera de los comentarios. Un valor vacío se marca con "s/d" o "n/a" (`noData` en `src/lib/no-data.ts`, componente `NoData` en `src/ui/kit.tsx`). Sin "exitosamente", "por favor ten en cuenta" ni "Listo." al inicio de cada mensaje: el mensaje dice qué pasó ("12 comercios pasaron a Lucía Vega").
- Un error dice qué pasó y qué hacer ("Alguien ya lleva este lead. Pide a tu supervisor que lo reasigne.").
- En español nunca códigos ni nombres de tablas a la vista (`web_form`, `first_tx`, claves de rol o de etapa).
- "Lead" se queda como término del equipo en los dos idiomas.
- En inglés, hablar como el equipo de US: stores, doors, field sales, book (cartera).
