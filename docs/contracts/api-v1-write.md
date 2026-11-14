# API v1: escritura general (AUT-04)

Estado: construido. Lo usa quien tenga una llave `ctg_` de un mercado con permisos de escritura. Las llaves de prueba (`ctg_test_`) no escriben.

## Reglas
- Cada operación llama al **mismo comando del dominio que usa la pantalla**: mismas validaciones, mismos permisos, misma bitácora (`crm.audit_events`, con vía `api`) y el mismo evento en la cola (`crm.outbox_events`).
- La llave actúa **como la persona que la creó**, con su rol y su alcance (RLS), y **solo en el mercado de la llave**. Un registro de otro mercado responde `404` (no se revela que existe).
- Permisos (scopes): `accounts:write`, `deals:write`, `leads:write`, `activities:write`. Una llave sin el permiso responde `403` con `required_scope`.
- Límite por llave y por IP (`429` con `retry-after`), igual que la lectura. Cada respuesta lleva `x-request-id`.
- Errores: `400 invalid_json`, `401 unauthorized`, `403 forbidden`, `404 not_found`, `422 invalid` (con `message` en inglés), `500 internal` (con `request_id`).
- Texto libre: una cuenta bancaria o un SSN se tapan (quedan los últimos 4) y la respuesta trae `"masked": true`; una tarjeta válida se rechaza con `422`.
- Reintentos: v1 de escritura **no** acepta `Idempotency-Key`; un reintento de `POST` puede duplicar la actividad o el lead. Quien integra reintenta solo ante `429` o errores de red sin respuesta. [pendiente: Dan Mulligan, si se pide idempotencia en escritura]

## Operaciones
| Método y ruta | Permiso | Comando del dominio | Cuerpo |
|---|---|---|---|
| `POST /api/v1/activities` | `activities:write` | `recordActivity` | `kind` (note, call, meeting, task, visit), uno de `account_id`/`deal_id`/`lead_id`, `subject`, `body`, `due_at` (tarea o visita por hacer), `outcome` |
| `POST /api/v1/leads` | `leads:write` | `createLead` | `sale_type`, `business_name`, `contact_name`, `phone`, `email`, `locality`, `message` |
| `PATCH /api/v1/deals/{id}` | `deals:write` | `moveDeal` | `stage_id`, `loss_reason_code` y `loss_note` (si la etapa es de pérdida), `next_step` {`step`, `due` AAAA-MM-DD} |
| `PATCH /api/v1/accounts/{id}` | `accounts:write` | `updateAccount` | `name`, `phone`, `email`, `address_line`, `locality`, `region`, `postal_code` (solo lo que cambia) |

Respuestas: `201 {"id": "..."}` al crear; `200 {"id": "...", "status": "moved" | "pending"}` al mover (pending = espera aprobación de una persona); `200 {"id": "..."}` al corregir un comercio.

Fuera de v1 (decisión de C1): contactos y notas como recurso propio. Los campos desconocidos se rechazan (`422`).

Definición OpenAPI: `api-v1-write.openapi.json`. Pruebas: `tests/db/plataforma.test.ts` (AUT-04 y GOB-08, con datos del generador sintético) y `tests/e2e/zx-plataforma.spec.ts` (por HTTP).
