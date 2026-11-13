# Excepción al estándar DATA-06: identificador fiscal completo (E9.F13, MULTI-03)

Estado: **borrador de excepción**. [pendiente: Legal y Seguridad]

## Hoy (construido)
- El identificador fiscal se captura **una vez** (Datos, La tienda) y CONTIGO guarda **solo los últimos 4** y una huella para buscarlo exacto. La pantalla lo dice.
- Los documentos (hoja del pedido, propuesta) lo toman de ahí **enmascarado**.
- El número completo, si se captura, pasa por el resguardo protegido (`PROTECTED_DATA_VAULT`, adaptador apagado). Con el resguardo apagado no se guarda en ningún lado.
- Una prueba (`tests/db/plataforma.test.ts`, "E9.F13") revisa que ninguna columna de la base guarde un identificador fiscal completo.

## Lo que pide la excepción
1. **Para qué**: documentos fiscales y de alta que exigen el identificador completo (por mercado: RFC en MX, EIN en US, NIT en SV).
2. **Dónde vive**: solo en el resguardo cifrado (bóveda con llaves gestionadas), nunca en tablas de `crm`, en la bitácora, en exportaciones ni en la cola de eventos.
3. **Quién lo ve**: el documento lo arma el servidor en el momento; ninguna pantalla lo muestra completo. Cada uso queda en el registro de lecturas.
4. **Cuánto se guarda**: plazo de retención fijado por Legal (valor `audit_retention_days` y regla de retención propia).
5. **Quién firma**: Legal y Seguridad, con revisión de tecnología de Dan Mulligan o Michael Essiet.

## Para encender
Firmada la excepción: `PROTECTED_DATA_VAULT` con su aprobación (ver `docs/adapters.md`) y marcar el valor `tax_id_full_exception` como confirmado en Administración, Plataforma.
