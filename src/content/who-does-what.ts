// E7.F2: quién hace qué. Una sola lista escrita, a la vista de todo el equipo en "Pedir un cambio".
// Sale de los principios P11 (administración configura, ventas opera) y P12 (lo compartido va primero) de los requerimientos.
type Pair = [es: string, en: string]

export const WHO_DOES_WHAT: { who: Pair; items: Pair[] }[] = [
  {
    who: ['Administración (Martech)', 'Administration (Martech)'],
    items: [
      ['Crea y cambia campos, embudos, etapas, formularios, turnos y catálogos.', 'Creates and changes fields, pipelines, stages, forms, rotations and catalogs.'],
      ['Da y quita accesos, y cuida que nadie que opera sea administrador.', 'Grants and removes access, and makes sure nobody who operates is an administrator.'],
      ['Cuida la calidad de los datos: duplicados, registros sin dueño, importaciones.', 'Looks after data quality: duplicates, records with no owner, imports.'],
      ['Capacita, mantiene la ayuda al día y revisa cada mes con el champion de cada equipo.', 'Trains, keeps the help up to date and reviews every month with each team’s champion.'],
      ['Anota por qué se hizo cada cambio de configuración, para que el siguiente mercado lo pueda repetir.', 'Records why each configuration change was made, so the next market can repeat it.'],
    ],
  },
  {
    who: ['Ventas y Operaciones', 'Sales and Operations'],
    items: [
      ['Llevan sus comercios, leads, negocios y actividades al día.', 'Keep their merchants, leads, deals and activities up to date.'],
      ['Arman sus propios filtros y reportes con lo que ya existe.', 'Build their own filters and reports with what already exists.'],
      ['Piden lo que les falta desde "Pedir un cambio", no por mensaje directo.', 'Ask for what is missing from "Request a change", not by direct message.'],
      ['Reportan lo que falla desde "Reportar un problema".', 'Report what is broken from "Report a problem".'],
    ],
  },
  {
    who: ['Champion de cada equipo', 'Each team’s champion'],
    items: [
      ['Es la primera persona a quien preguntar: resuelve dudas de uso y ayuda con filtros y reportes.', 'Is the first person to ask: answers how-to questions and helps with filters and reports.'],
      ['Junta lo que el equipo necesita y lo pide una sola vez, con su porqué.', 'Gathers what the team needs and asks for it once, with its purpose.'],
      ['Es el contacto de capacitación del equipo y se reúne cada mes con administración.', 'Is the team’s training contact and meets with administration every month.'],
    ],
  },
]

/** Lo que una solicitud tiene que traer para poder aprobarse. */
export const REQUEST_MUST_INCLUDE: Pair[] = [
  ['Qué necesitas, en una línea.', 'What you need, in one line.'],
  ['Para qué sirve: qué decisión o qué trabajo cambia si existe.', 'What it is for: which decision or which work changes if it exists.'],
  ['Para qué mercado. Si sirve a todos, se crea compartido: lo compartido va primero.', 'Which market it is for. If it serves everyone, it is created as shared: shared comes first.'],
  ['Si es una lista, sus opciones concretas, una por renglón.', 'If it is a list, its concrete options, one per line.'],
]
