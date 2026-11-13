# Enlace de la Sales App a la ficha de CONTIGO (UX-04), v1

Estado: construido en CONTIGO; [pendiente: equipo de la Sales App] para usarlo.

- URL: `https://<host de CONTIGO>/comercios/ref/<id>` donde `<id>` es el ID de la Sales App, el Merchant ID o el ID de CONTIGO.
- Abre la ficha del comercio si la persona con sesión la puede ver; si no, una pantalla que no revela si existe.
- Sin sesión, pasa por el inicio de sesión y vuelve a la ficha.
- No lleva datos en la URL más allá del identificador. No usar parámetros con nombres, teléfonos ni montos.
- Pensado para teléfono (390 px): la ficha, las aprobaciones de un toque y el registro de visita se prueban a ese ancho (`tests/e2e/zx-plataforma.spec.ts`).
- Lectura sin señal: apagada mientras Seguridad no decida (valor `offline_read_cache` en Administración, Plataforma).
