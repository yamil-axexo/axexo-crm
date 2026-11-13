# Contrato genérico: verificación de identificador fiscal (propuesta)

Estado: propuesta. El proveedor lo elige Compliance: [pendiente: Compliance]. Lo usa el conector `tax_registry` (MULTI-03).
Si el proveedor elegido no habla este contrato, se escribe un adaptador delgado que lo traduzca.

## Autenticación
`Authorization: Bearer <TAX_REGISTRY_TOKEN>`. HTTPS obligatorio.

## GET /v1/health
`200 {"status":"ok"}`.

## POST /v1/verify
Petición:
```json
{ "type": "mx_rfc", "country": "MX", "id": "XAXX010101000", "legal_name": "Comercio de ejemplo", "postal_code": "06600" }
```
Respuesta `200 {"result": "match" | "mismatch", "provider": "nombre-corto"}`.
El identificador completo viaja solo en esta llamada; CONTIGO no lo guarda (guarda últimos 4 y huella). Sin respuesta válida, la verificación queda pendiente y una persona revisa.
