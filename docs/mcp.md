# Servidor MCP de CONTIGO (IA-06): apagado

Estado: construido y apagado. Sin la variable `MCP_SERVER` no existe ninguna ruta (`/api/mcp` responde 404). El valor
`simulated` solo vale con `APP_ENV=test`, para las pruebas. No hay valor de producción: encenderlo pasa por la revisión de
tecnología (Michael Essiet o Dan Mulligan, engineering@axexo.com).

## Qué hace
- Protocolo: JSON-RPC sobre HTTP (`initialize`, `tools/list`, `tools/call`).
- Solo lectura. No hay ninguna herramienta que escriba. Un servidor de escritura sería otro, aparte y después.
- Corre como la persona autenticada, con sus capacidades (`src/domain/policy.ts`) y con la base filtrando lo que no ve (RLS).
  Nunca con una cuenta de servicio ni con llaves de la plataforma de base de datos.
- `tools/list` solo enseña las herramientas que la persona puede usar.
- Máximo 50 filas por herramienta (`MCP_ROW_LIMIT`).
- Cada llamada deja un evento `ia.mcp_read` en la bitácora (actor, herramienta, vía `mcp`) y una fila en `crm.ia_calls`
  (huella de la entrada, nunca el texto).

## Herramientas (src/server/mcp/tools.ts)
| Herramienta | Capacidad | Qué devuelve |
|---|---|---|
| `search_records` | `ia.read` | Comercios, leads y negocios por nombre, teléfono completo o ID externo |
| `my_suggestions` | `ia.read` | Sugerencias de siguiente acción abiertas de la persona, con su porqué |
| `account_brief` | `ia.read` | Resumen de un comercio: días sin contacto, negocios y pendientes, transacciones de 30 días |
| `ask_metric` | `ia.ask` | Una cifra definida (lib/metric-defs.ts) con su definición; lo demás, `out_of_scope` |

## Ingreso por persona: OAuth 2.1 con PKCE (construido, apagado con el servidor)
`src/domain/plataforma/mcp-oauth.ts`, tablas `crm.mcp_oauth_clients`, `crm.mcp_oauth_codes`, `crm.mcp_oauth_tokens` (0042).
1. Administración registra el agente en Administración, Plataforma ("Agentes que leen como una persona"): nombre y URL de regreso (https, o http a 127.0.0.1 para una app local). Recibe su `client_id` (`mcpc_...`). Es un cliente público: sin secreto.
2. El agente manda a la persona a `/mcp/autorizar?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...`.
3. La persona, con su sesión, ve qué agente pide y acepta. Sale un código de un solo uso, de 5 minutos, atado al reto PKCE; queda `mcp_oauth.authorized` en la bitácora.
4. El agente canjea en `POST /api/mcp/oauth/token` (form: `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri`, `code_verifier`) y recibe un token `mcpt_...` de 60 minutos. Sin token de renovación: al vencer, la persona vuelve a autorizar.
5. Cada llamada a `/api/mcp` con `Authorization: Bearer mcpt_...` corre como la persona (sus capacidades por herramienta y su alcance). Sin token válido: `401` con `WWW-Authenticate` que apunta a `/.well-known/oauth-protected-resource`.
6. Metadatos: `/.well-known/oauth-authorization-server` (RFC 8414) y `/.well-known/oauth-protected-resource` (RFC 9728).
7. Retirar el agente corta todos sus tokens al momento. Solo se guardan huellas (sha-256) de códigos y tokens.

## Qué falta para encenderlo
1. Revisión de tecnología con sign-off escrito. [pendiente: Dan Mulligan o Michael Essiet]
2. Definir la variable de entorno en el ambiente aprobado.
3. Servidor de escritura separado: después, por diseño (solo lectura en v1).
