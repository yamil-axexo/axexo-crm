# Entornos de prueba por rama (AUT-04, GOB-04, GOB-08)

Estado: **documentado, no encendido**. Necesita la plataforma de producción y el visto bueno de tecnología. [pendiente: Dan Mulligan]

## Qué se quiere
Cada rama con su propio entorno: una base aislada con datos sintéticos y una vista previa de la app, que se borra al cerrar la rama. Nunca datos reales.

## Pasos (para quien opera la plataforma)
1. **Base por rama.** Encender branching en el proyecto de Supabase de pruebas (no el de producción). Cada rama crea su base con las migraciones del repositorio (`node scripts/migrate.mjs up`, conexión de dueño del esquema).
2. **Datos sintéticos.** Al crear la base, correr `node scripts/synthetic.mjs --market MX --accounts 2000 --depth 4` (y US, SV). El generador se niega a correr con `APP_ENV=production`. Nada de Pipedrive ni de copias de staging.
3. **Vista previa.** En Vercel, previews por rama con estas variables: `APP_ENV=staging`, `DATABASE_URL` y `MIGRATION_DATABASE_URL` de la base de la rama, y **sin** ninguna variable `*_ADAPTER=live` ni credenciales de proveedores (todo queda apagado).
4. **Acceso.** Previews detrás de la protección de Vercel (solo el equipo). `DEMO_PERSONAS=1` permitido solo ahí.
5. **Limpieza.** Al cerrar o fusionar la rama, se borran la base y la vista previa.
6. **Protección de la rama principal.** Dos revisores para fusionar a `design-v1`/`main` y las pruebas en verde. [pendiente: administradores del repositorio]

## Cómo se ve en CONTIGO
- `/estado` dice si el ambiente tiene datos reales (valor `staging_has_real_data`, en Administración, Plataforma).
- `/admin/gobierno` (Datos de prueba) muestra las corridas del generador.
