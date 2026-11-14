# Contrato: constancias de Kore Academy hacia CONTIGO (propuesta)

Estado: propuesta, sin acordar. Dueño del lado de Kore Academy: [pendiente: equipo de Kore Academy]. Lo usa el conector `kore_academy` (CS-06).

## Autenticación
`Authorization: Bearer <KORE_ACADEMY_TOKEN>`. Solo lectura. HTTPS obligatorio.

## GET /v1/health
Respuesta `200 {"status":"ok"}`. La usa "Probar conexión".

## GET /v1/completions?since=YYYY-MM-DD&merchant_refs=REF1,REF2
Hasta 100 identificadores por llamada. Respuesta `200`:
```json
{ "completions": [ { "id": "k-123", "merchant_ref": "M-001", "person_name": "Encargado", "course_key": "intro-ventas", "course_title": "Primeros pasos para vender", "completed_on": "2026-11-10" } ] }
```
- `id`: único y estable (CONTIGO no carga dos veces el mismo).
- `merchant_ref`: el identificador del comercio que CONTIGO ya conoce. Sin él, la constancia no se puede ligar y se descarta.
- Filas sin `id`, `merchant_ref`, `course_key` o con `completed_on` mal formado se ignoran.
