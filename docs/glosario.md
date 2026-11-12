# Glosario de producto de axexo CONTIGO (ES y EN)

Paquete `vocabulario`, 12-nov-2026. Lo cuidan `tests/unit/vocabulario.test.ts` (catálogos y textos del código) y `tests/e2e/zx-vocabulario.spec.ts` (texto a la vista por rol). Las reglas viven en `tests/support/vocab-rules.mjs`. La guía, la ayuda, la bienvenida y la entrada usan estos mismos términos.

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
| Punto de venta (en inglés) | punto de venta, tienda | store | point of sale, PDV |
| Meta de primer contacto de un lead | meta de primer contacto; "Primer contacto a tiempo" | first-contact goal; "First contact on time" | SLA, lead time |
| Pantalla de escritorio | computadora | computer | desktop (en español) |
| Avisos que CONTIGO deja a otros sistemas | avisos para otros sistemas | notices for other systems | outbox |
| Sin dato en una celda | — (solo, como marca) | — | guiones largos en una frase |

## Reglas de redacción

- Español neutro, sin voseo, con acentos y signos de apertura. "IA" en español, "AI" en inglés. "axexo" en minúscula, "CONTIGO" en mayúsculas.
- Sin guiones largos (ni — ni –) en frases. Sin "exitosamente", "por favor ten en cuenta" ni "Listo." al inicio de cada mensaje: el mensaje dice qué pasó ("12 comercios pasaron a Lucía Vega").
- Un error dice qué pasó y qué hacer ("Alguien ya lleva este lead. Pide a tu supervisor que lo reasigne.").
- En español nunca códigos ni nombres de tablas a la vista (`web_form`, `first_tx`, claves de rol o de etapa).
- "Lead" se queda como término del equipo en los dos idiomas.
- En inglés, hablar como el equipo de US: stores, doors, field sales, book (cartera).
