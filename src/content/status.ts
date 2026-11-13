// Página de estado: lo que CONTIGO todavía no hace y lo que nadie ha definido.
// Cada renglón sale de un documento del repositorio o del comité del 11-nov-2026; si cambia el producto, se cambia aquí.
// No lleva nombres de personas: quién define cada pendiente se decide fuera de la herramienta.

type Pair = [es: string, en: string]

/** Datos de operación que hoy nadie ha definido. La página los muestra como "Por definir", sin inventar un valor. */
export const UNDEFINED_ITEMS: { key: string; label: Pair; why: Pair }[] = [
  { key: 'owner', label: ['Responsable técnico', 'Technical owner'], why: ['Quién responde por la herramienta y quién la cubre cuando no está. Se anota por componente en Administración, Gobierno.', 'Who answers for the tool and who covers when they are away. It is recorded per component in Administration, Governance.'] },
  { key: 'backup', label: ['Respaldo de la base de datos', 'Database backup'], why: ['Cada cuánto se respalda y dónde queda la copia.', 'How often it is backed up and where the copy is kept.'] },
  { key: 'restore', label: ['Última restauración probada', 'Last tested restore'], why: ['Todavía no se ha probado recuperar la base desde un respaldo. Cada prueba se anota en Administración, Gobierno.', 'Recovering the database from a backup has not been tested yet. Each test is recorded in Administration, Governance.'] },
  { key: 'plan', label: ['Plan de restauración', 'Restore plan'], why: ['Cuánta información se puede perder como máximo y en cuánto tiempo vuelve el servicio. Lo acordado se anota en Administración, Gobierno.', 'How much data can be lost at most and how long the service takes to come back. What is agreed is recorded in Administration, Governance.'] },
  { key: 'cost', label: ['Costo mensual de operación', 'Monthly running cost'], why: ['Infraestructura y personas. CONTIGO no cobra licencias por usuario. Los costos se cargan en Administración, Gobierno.', 'Infrastructure and people. CONTIGO has no per-user licences. Costs are loaded in Administration, Governance.'] },
  { key: 'production', label: ['Plataforma de producción', 'Production platform'], why: ['Dónde va a correr cuando salga de staging.', 'Where it will run once it leaves staging.'] },
  { key: 'support', label: ['Canal de soporte', 'Support channel'], why: ['A dónde escribe el equipo cuando algo falla.', 'Where the team writes when something fails.'] },
]

/** Lo que todavía no está. Fuente entre paréntesis en el código, no en pantalla. */
export const NOT_YET: { group: Pair; items: Pair[] }[] = [
  {
    group: ['Conexiones', 'Connections'],
    items: [
      // docs/scope.md: CAMPO-01 "contract and intake built; no live connection"
      ['Conexión real con la Sales App y con los datos de ventas. El contrato existe y se prueba desde Administración, pero ningún sistema manda datos todavía.', 'A live connection to the Sales App and to the sales data. The contract exists and is tested from Administration, but no system sends data yet.'],
      // AUT-02: publicador construido; la entrega HTTP es un adaptador apagado hasta que P&T apruebe el transporte
      ['Entrega real de eventos a otros sistemas. CONTIGO los guarda y sabe repartirlos, reintentar y reenviar; el canal está apagado hasta que se apruebe el transporte.', 'Live delivery of events to other systems. CONTIGO stores them and knows how to hand them out, retry and resend; the channel is off until the transport is approved.'],
      // AUT-04: API de lectura v1 construida; falta la API de escritura general y los tokens de partner por subárbol
      ['API para escribir datos de CONTIGO desde otro sistema y llaves de socios acotadas a una parte del árbol. Hoy la API lee (comercios, negocios, leads, actividades y catálogos) y recibe formularios, eventos y el archivo de ventas.', 'An API to write CONTIGO data from another system and partner keys limited to part of the tree. Today the API reads (merchants, deals, leads, activities and catalogs) and receives forms, events and the sales file.'],
      // docs/pipedrive-migration.md: la corrida es manual; "Not migrated in this PR"
      ['Importación de Pipedrive programada. Hoy la corre a mano una persona de administración. No se migran automatizaciones, archivos adjuntos, hilos de correo, relaciones entre organizaciones ni filtros guardados.', 'A scheduled Pipedrive import. Today an administrator runs it by hand. Automations, attachments, email threads, organization relationships and saved filters are not migrated.'],
      // docs/scope.md: MULTI-01 "synthetic rates"
      ['Tipo de cambio real. Las tasas cargadas son de prueba.', 'A real exchange rate. The rates loaded are test values.'],
    ],
  },
  {
    group: ['Trabajo diario', 'Daily work'],
    items: [
      // comité: "Comunicación integrada (sin correo, calendario, telefonía ni secuencias)"
      ['Correo, calendario, telefonía y secuencias dentro de CONTIGO.', 'Email, calendar, telephony and sequences inside CONTIGO.'],
      // ADR-006: "Offline reading with data stored on the device"
      ['Lectura sin conexión. Sin señal, CONTIGO avisa y no deja guardar; no muestra datos guardados en el equipo.', 'Offline reading. With no signal, CONTIGO says so and blocks saving; it shows no data stored on the device.'],
      // ADR-006: "Terminales tab", "Map view"
      ['Pestaña de terminales en la ficha del comercio y vista de mapa.', 'A terminals tab on the merchant record and a map view.'],
      // docs/scope.md: CAMPO-06, CANAL-05; comité: "Órdenes, documentos y firma"
      ['Expediente de alta con documentos, firma, órdenes y visibilidad de comisiones.', 'An enrollment file with documents, signatures, orders and commission visibility.'],
      // docs/scope.md: UX-03 parcial; "free-form report builder" fuera
      ['Reportes propios y vistas guardadas por cada persona.', 'Custom reports and views saved by each person.'],
      // docs/scope.md: IA-07 "no AI features"
      ['Funciones de IA.', 'AI features.'],
    ],
  },
  {
    group: ['Administración', 'Administration'],
    items: [
      // docs/scope.md: DAT-05 "no editor for definitions"; comité 2: Embudos y campos
      ['Crear formularios web, turnos o mercados desde la pantalla. Hoy se crean embudos, etapas, campos, tipos de cuenta y motivos de pérdida, y de un formulario que ya existe se edita el nombre y qué campos pide.', 'Creating web forms, rotations or markets from the screen. Today you can create pipelines, stages, fields, account types and loss reasons, and for an existing form you can edit its name and which fields it asks for.'],
      // ADR-004: AUTHZ-09 "Deprovisioning by Google Directory sync is not built"
      ['Baja automática cuando alguien sale de Google Workspace. El acceso se quita en Administración o se le pone fecha de vencimiento.', 'Automatic removal when someone leaves Google Workspace. Access is removed in Administration or given an expiry date.'],
      // comité 2: "Ver como"; aviso al dar acceso
      ['Ver la herramienta como la ve otra persona, y avisarle por correo cuando recibe acceso.', 'Seeing the tool as another person sees it, and emailing them when they are granted access.'],
    ],
  },
  {
    group: ['Controles y operación', 'Controls and operations'],
    items: [
      // docs/standard-compliance.md: REL-03, REL-04 "Open"; comité: "sin pentest, sin restauración probada"
      ['Respaldo con restauración probada, prueba de penetración y plataforma de producción.', 'Backups with a tested restore, a penetration test and a production platform.'],
      // SEC-06: límite de frecuencia en formularios públicos y API (en la base); falta en búsquedas y el desafío anti-bot real
      ['Límite de frecuencia en las búsquedas y verificación anti-bot real en los formularios. Formularios públicos y API ya tienen límite.', 'Rate limiting on searches and a live anti-bot check on forms. Public forms and the API already have a limit.'],
      // docs/standard-compliance.md: OBS-03 "Reads of PII are not logged; no export to object storage"
      ['Registro de quién consulta datos personales y copia de la bitácora fuera de la base.', 'A record of who reads personal data and a copy of the audit log outside the database.'],
      // docs/standard-compliance.md: DATA-11 "Retention and purge [pending: Legal]"
      ['Reglas de retención y depuración de datos.', 'Data retention and purge rules.'],
      // ADR-004: "MFA is an IdP policy"
      ['Segundo factor al entrar: depende de la política de la cuenta de Google, no de CONTIGO.', 'A second factor at sign-in: it depends on the Google account policy, not on CONTIGO.'],
      // ADR-006: "Performance targets ... are not measured yet"
      ['Medición de velocidad en un teléfono real y con datos móviles.', 'Speed measured on a real phone over mobile data.'],
    ],
  },
]
