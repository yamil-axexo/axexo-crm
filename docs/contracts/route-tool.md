# Contrato genérico: tiendas por persona hacia la herramienta de rutas (propuesta)

Estado: propuesta. La herramienta la elige Ventas US: [pendiente: Ventas US]. Lo usa el conector `routes` (E5.F6, E12.F8).

## Autenticación
`Authorization: Bearer <ROUTE_TOOL_TOKEN>`. HTTPS obligatorio.

## GET /v1/health
`200 {"status":"ok"}`.

## PUT /v1/stores
Reemplaza la lista de tiendas de una persona:
```json
{ "contract": "route_stores v1", "owner_id": "uuid", "market": "US", "stores": [ { "account_id": "uuid", "name": "Tienda", "address": "...", "locality": "...", "region": "...", "postal_code": "...", "phone": "+1...", "contact": "...", "merchant_ref": "...", "approved_products": [], "txn_count_30d": 12, "last_visit_on": "2026-11-10" } ] }
```
Respuesta `2xx`. Los campos de cada tienda son los de `RouteStore` en `src/server/adapters/routes.ts`.
