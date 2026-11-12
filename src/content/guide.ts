// Contenido de la entrada (landing), del primer ingreso y de la ayuda. Un solo lugar, en español y en inglés.
// Las preguntas, los pasos y la capacitación salen de los dos comités con los perfiles reales del equipo (11 y 12-nov-2026).
// Regla dura: ningún texto describe algo que no existe o que funciona distinto. Cada afirmación se revisó contra la pantalla.
import type { Membership, Role } from '@/domain/policy'

export type L = { es: string; en: string }
export type Track = 'rep' | 'supervisor' | 'lead' | 'ops' | 'lt' | 'admin'

const ORDER: [Role, Track][] = [
  ['admin', 'admin'],
  ['market_lead', 'lead'],
  ['supervisor', 'supervisor'],
  ['ops', 'ops'],
  ['rep', 'rep'],
  ['lt', 'lt'],
]

/** El recorrido que le toca a una persona: el de su rol con más alcance. Quien solo lee recibe el de leadership. */
export function trackOf(memberships: readonly Pick<Membership, 'role'>[]): Track {
  for (const [role, track] of ORDER) if (memberships.some((m) => m.role === role)) return track
  return 'rep'
}

export const TRACK_LABEL: Record<Track, L> = {
  rep: { es: 'Ventas', en: 'Sales' },
  supervisor: { es: 'Supervisión', en: 'Supervisor' },
  lead: { es: 'Líder de mercado', en: 'Market lead' },
  ops: { es: 'Operaciones', en: 'Operations' },
  lt: { es: 'Leadership', en: 'Leadership' },
  admin: { es: 'Administración', en: 'Admin' },
}

// ---------------------------------------------------------------- primer ingreso
// Los pasos salen de los "pasos de primer ingreso" del comité 2 (12-nov-2026), revisados contra cada pantalla.
export type Step = { key: string; title: L; why: L; href: string; cta: L }

const GO = {
  today: { es: 'Ir a Hoy', en: 'Go to Today' },
  leads: { es: 'Ir a Leads', en: 'Go to Leads' },
  deals: { es: 'Ir a Negocios', en: 'Go to Deals' },
  merchants: { es: 'Ir a Comercios', en: 'Go to Merchants' },
  team: { es: 'Ir a Mi equipo', en: 'Go to My team' },
  panel: { es: 'Ir al Panel del LT', en: 'Go to the Leadership panel' },
  report: { es: 'Abrir Reportar un problema', en: 'Open Report a problem' },
} satisfies Record<string, L>

const S = {
  today: {
    key: 'today',
    title: { es: 'Abre Hoy y mira qué sigue', en: 'Open Today and see what is next' },
    why: {
      es: 'Tu lista ya viene ordenada: arriba lo más urgente, luego lo vencido, lo de hoy y hasta cinco sugerencias. No tienes que armarla.',
      en: 'Your list comes sorted: the most urgent item on top, then overdue, today and up to five suggestions. You do not have to build it.',
    },
    href: '/hoy',
    cta: GO.today,
  },
  complete: {
    key: 'complete',
    title: { es: 'Completa una tarea y deja el próximo paso', en: 'Complete a task and leave the next step' },
    why: {
      es: 'Al terminar algo, CONTIGO te pregunta cómo te fue y qué sigue. Con eso ningún comercio se queda sin seguimiento.',
      en: 'When you finish something, CONTIGO asks how it went and what comes next. That way no merchant is left without follow-up.',
    },
    href: '/hoy',
    cta: GO.today,
  },
  leads: {
    key: 'leads',
    title: { es: 'Abre Leads y llama al que tiene menos tiempo', en: 'Open Leads and call the one with the least time left' },
    why: {
      es: 'Un lead nuevo trae su meta de primer contacto. Llamar desde aquí deja el intento registrado. Si no tiene dueño, "Tomar y llamar" lo deja a tu nombre.',
      en: 'A new lead carries its first-contact goal. Calling from here logs the attempt. If it has no owner, "Take and call" makes it yours.',
    },
    href: '/leads',
    cta: GO.leads,
  },
  mine: {
    key: 'mine',
    title: { es: 'Abre Comercios, toca "Míos" y confirma que están tus comercios', en: 'Open Merchants, tap "Mine" and confirm your merchants are there' },
    why: {
      es: 'Si falta alguno, avisa a tu supervisor hoy: puede seguir a nombre de otra persona.',
      en: 'If one is missing, tell your supervisor today: it may still be under someone else.',
    },
    href: '/comercios?owner=me',
    cta: GO.merchants,
  },
  find: {
    key: 'find',
    title: { es: 'Busca un comercio por teléfono antes de crearlo', en: 'Search a merchant by phone before adding it' },
    why: {
      es: 'El buscador de arriba encuentra por nombre, teléfono, contacto o ID. Abre la ficha: ahí están el hilo, el árbol y los datos.',
      en: 'The search box at the top finds by name, phone, contact or ID. Open the record: the thread, the tree and the details are there.',
    },
    href: '/comercios',
    cta: GO.merchants,
  },
  visit: {
    key: 'visit',
    title: { es: 'Registra una visita o deja una nota en una ficha', en: 'Log a visit or leave a note on a record' },
    why: {
      es: 'En la ficha, "Visita" guarda cómo te fue y quién visitó; "Nota", lo que hablaron. Queda en el comercio, no en tu teléfono.',
      en: 'On the record, "Visit" saves how it went and who visited; "Note", what you discussed. It stays with the merchant, not on your phone.',
    },
    href: '/comercios?owner=me',
    cta: GO.merchants,
  },
  nostep: {
    key: 'nostep',
    title: { es: 'Ponle próximo paso a tus negocios que no lo tienen', en: 'Give a next step to your deals that have none' },
    why: {
      es: 'Los negocios que venían de Pipedrive llegaron sin próximo paso. En Negocios, el filtro "Sin próximo paso" te los junta.',
      en: 'Deals that came from Pipedrive arrived with no next step. In Deals, the "No next step" filter gathers them for you.',
    },
    href: '/pipelines',
    cta: GO.deals,
  },
  report: {
    key: 'report',
    title: { es: 'Si algo falla o te hace falta, repórtalo', en: 'If something breaks or is missing, report it' },
    why: {
      es: 'En tu menú está "Reportar un problema". La pantalla donde estabas se llena sola y la respuesta te llega ahí mismo.',
      en: 'Your menu has "Report a problem". The screen you were on fills in by itself and the answer comes back right there.',
    },
    href: '/reportar',
    cta: GO.report,
  },
  teamNow: {
    key: 'team-now',
    title: { es: 'En Hoy, cambia a "Mi equipo"', en: 'In Today, switch to "My team"' },
    why: {
      es: 'Ves quién necesita apoyo ahora, también desde el teléfono. "Yo" te regresa a tu propia lista.',
      en: 'You see who needs support right now, from your phone too. "Me" takes you back to your own list.',
    },
    href: '/hoy',
    cta: GO.today,
  },
  team: {
    key: 'team',
    title: { es: 'Abre Mi equipo y lee la fila de una persona', en: 'Open My team and read one person\'s row' },
    why: {
      es: 'Por persona: leads abiertos, primer intento a tiempo, contacto logrado, negocios sin próximo paso y revisitas. Es la tabla para tu revisión semanal.',
      en: 'Per person: open leads, first attempt on time, reached, deals with no next step and revisits. It is the table for your weekly review.',
    },
    href: '/supervisor',
    cta: GO.team,
  },
  exceptions: {
    key: 'exceptions',
    title: { es: 'Atiende o descarta un aviso de la cola de excepciones', en: 'Handle or dismiss one item in the exception queue' },
    why: {
      es: 'La cola se llena sola con lo que se salió de la regla y cada aviso se cierra solo cuando se corrige. Nadie tiene que reportar nada.',
      en: 'The queue fills itself with what broke a rule, and each item closes on its own once it is fixed. Nobody has to report anything.',
    },
    href: '/supervisor',
    cta: GO.team,
  },
  reassign: {
    key: 'reassign',
    title: { es: 'Reasigna un lead a quien cubre esa zona', en: 'Reassign a lead to whoever covers that area' },
    why: {
      es: 'Abre el lead y cambia el dueño en "Dueño". En un comercio, el enlace "Reasignar" está junto al dueño. Queda en la bitácora con tu nombre.',
      en: 'Open the lead and change the owner under "Owner". On a merchant, the "Reassign" link sits next to the owner. It is logged with your name.',
    },
    href: '/leads',
    cta: GO.leads,
  },
  distribute: {
    key: 'distribute',
    title: { es: 'Reparte los comercios que no tienen dueño vigente', en: 'Distribute the merchants with no current owner' },
    why: {
      es: 'En Mi equipo, "Sin dueño vigente" te dice cuántos hay y "Repartir comercios" te lleva a pasarlos por plaza o territorio.',
      en: 'In My team, "No current owner" tells you how many there are and "Distribute merchants" takes you to hand them out by place or territory.',
    },
    href: '/supervisor',
    cta: GO.team,
  },
  board: {
    key: 'board',
    title: { es: 'Recorre el tablero de Negocios de tu mercado', en: 'Walk the Deals board for your market' },
    why: {
      es: 'Cada columna es una etapa con su conteo. Arriba eliges el embudo y el filtro "Sin próximo paso".',
      en: 'Each column is a stage with its count. At the top you pick the pipeline and the "No next step" filter.',
    },
    href: '/pipelines',
    cta: GO.deals,
  },
  panel: {
    key: 'panel',
    title: { es: 'Abre el Panel del LT desde tu menú', en: 'Open the Leadership panel from your menu' },
    why: {
      es: 'Por mercado: leads, calificados, negocios abiertos, los que esperan su primera venta y ganados, con primer intento a tiempo y contacto logrado.',
      en: 'Per market: leads, qualified, open deals, the ones awaiting their first sale and won, with first attempt on time and reached.',
    },
    href: '/panel-lt',
    cta: GO.panel,
  },
  winRule: {
    key: 'win-rule',
    title: { es: 'Revisa cómo se gana un negocio en cada embudo', en: 'Review how a deal is won in each pipeline' },
    why: {
      es: 'En Administración, "Embudos y campos": cada embudo se gana con la primera transacción o a mano. En el piloto, los tres de primera transacción se ganan a mano.',
      en: 'In Administration, "Pipelines and fields": each pipeline is won by first transaction or by hand. During the pilot, the three first-transaction pipelines are won by hand.',
    },
    href: '/admin?tab=embudos',
    cta: { es: 'Ir a Embudos y campos', en: 'Go to Pipelines and fields' },
  },
  audit: {
    key: 'audit',
    title: { es: 'Mira la bitácora', en: 'Look at the audit log' },
    why: {
      es: 'En Administración, "Auditoría": quién cambió qué y cuándo. Solo se agrega; nadie la edita ni la borra.',
      en: 'In Administration, "Audit": who changed what and when. It is append-only; nobody edits or deletes it.',
    },
    href: '/admin?tab=auditoria',
    cta: { es: 'Ir a Auditoría', en: 'Go to Audit' },
  },
  opsBoard: {
    key: 'handoff',
    title: { es: 'Abre Negocios y ubica los que ya están en tus etapas', en: 'Open Deals and find the ones already in your stages' },
    why: {
      es: 'El tablero es tu lista de trabajo por ahora: cada columna dice cuántos negocios hay en esa etapa y cuántos días lleva cada uno.',
      en: 'The board is your work list for now: each column shows how many deals are in that stage and how many days each has been there.',
    },
    href: '/pipelines',
    cta: GO.deals,
  },
  opsNote: {
    key: 'ops-note',
    title: { es: 'Abre un negocio, lee su historia y deja una nota', en: 'Open a deal, read its history and leave a note' },
    why: {
      es: 'Ves quién lo vendió y lo que ventas dejó anotado. Tu nota queda en el mismo lugar, para no repetirla en otro lado.',
      en: 'You see who sold it and what sales wrote down. Your note sits in the same place, so you do not repeat it elsewhere.',
    },
    href: '/pipelines',
    cta: GO.deals,
  },
  move: {
    key: 'move',
    title: { es: 'Mueve un negocio de etapa', en: 'Move a deal to the next stage' },
    why: {
      es: 'Con el botón de la página del negocio. Si la etapa pide algo, te lo dice ahí. El cambio queda con tu nombre en la bitácora.',
      en: 'With the button on the deal page. If the stage needs something, it tells you there. The change is logged with your name.',
    },
    href: '/pipelines',
    cta: GO.deals,
  },
  opsTask: {
    key: 'ops-task',
    title: { es: 'Agenda tu propia tarea con fecha en un comercio', en: 'Schedule your own dated task on a merchant' },
    why: {
      es: 'En la ficha, "Actividad" y "Tarea con fecha". Ese día aparece en tu Hoy.',
      en: 'On the record, "Activity" and "Task with a date". That day it shows up in your Today.',
    },
    href: '/comercios',
    cta: GO.merchants,
  },
  merchantData: {
    key: 'merchant-data',
    title: { es: 'Completa los datos de un comercio', en: 'Complete the details of a merchant' },
    why: {
      es: 'En la pestaña Datos de la ficha corriges teléfono, dirección, contactos y campos adicionales. Cada cambio queda registrado.',
      en: 'In the Details tab of the record you fix the phone, address, contacts and additional fields. Every change is logged.',
    },
    href: '/comercios',
    cta: GO.merchants,
  },
  readonly: {
    key: 'readonly',
    title: { es: 'Abre un comercio y confirma que no tienes botones para editar', en: 'Open a merchant and confirm you have no edit buttons' },
    why: {
      es: 'Tu acceso es de solo lectura en todos los mercados: ves todo y no cambias nada por error.',
      en: 'Your access is read-only across all markets: you see everything and cannot change anything by mistake.',
    },
    href: '/comercios',
    cta: GO.merchants,
  },
  missing: {
    key: 'report',
    title: { es: 'Dinos qué cifra te hizo falta', en: 'Tell us which figure you missed' },
    why: {
      es: 'En tu menú, "Reportar un problema", con la opción de pedir algo. Con eso se decide qué entra al panel.',
      en: 'In your menu, "Report a problem", with the option to ask for something. That is how we decide what goes into the panel.',
    },
    href: '/reportar',
    cta: GO.report,
  },
  access: {
    key: 'access',
    title: { es: 'Revisa quién tiene acceso y con qué rol', en: 'Review who has access and with which role' },
    why: {
      es: 'En Administración, "Personas y acceso". Un acceso es un rol en un mercado y, si aplica, un equipo. Una supervisión sin equipo no ve a nadie.',
      en: 'In Administration, "People and access". An access is a role in a market and, where it applies, a team. A supervisor with no team sees nobody.',
    },
    href: '/admin?tab=personas',
    cta: { es: 'Ir a Personas y acceso', en: 'Go to People and access' },
  },
  rotation: {
    key: 'rotation',
    title: { es: 'Confirma quién está en cada turno de leads', en: 'Confirm who is in each lead rotation' },
    why: {
      es: 'En "Formularios y turnos" ves quién recibe los leads de cada formulario y quién es el respaldo. De ahí sale a quién le cae cada lead.',
      en: 'Under "Forms and rotation" you see who receives the leads of each form and who the fallback is. That decides who gets each lead.',
    },
    href: '/admin?tab=entrada',
    cta: { es: 'Ir a Formularios y turnos', en: 'Go to Forms and rotation' },
  },
  quality: {
    key: 'quality',
    title: { es: 'Abre Calidad de datos', en: 'Open Data quality' },
    why: {
      es: 'Ahí salen los comercios, negocios y leads sin dueño por mercado y los posibles duplicados. Llévale los sin dueño a quien lidera ese mercado.',
      en: 'Merchants, deals and leads with no owner per market and possible duplicates show up there. Take the unowned ones to that market\'s lead.',
    },
    href: '/admin?tab=calidad',
    cta: { es: 'Ir a Calidad de datos', en: 'Go to Data quality' },
  },
  pipedrive: {
    key: 'pipedrive',
    title: { es: 'En Pipedrive, revisa la columna "No cargados"', en: 'Under Pipedrive, check the "Not loaded" column' },
    why: {
      es: 'Te dice qué tan completa quedó la copia de Pipedrive y qué registros se quedaron fuera.',
      en: 'It tells you how complete the Pipedrive copy is and which records were left out.',
    },
    href: '/admin?tab=pipedrive',
    cta: { es: 'Ir a Pipedrive', en: 'Go to Pipedrive' },
  },
  reports: {
    key: 'reports',
    title: { es: 'Abre Reportes y responde lo que el equipo reportó', en: 'Open Reports and answer what the team reported' },
    why: {
      es: 'Lo que cada persona manda desde "Reportar un problema" llega ahí. Respondes, marcas atendido y la persona ve tu respuesta.',
      en: 'What each person sends from "Report a problem" lands there. You answer, mark it handled and the person sees your reply.',
    },
    href: '/admin?tab=reportes',
    cta: { es: 'Ir a Reportes', en: 'Go to Reports' },
  },
  status: {
    key: 'status',
    title: { es: 'Abre Estado de CONTIGO', en: 'Open CONTIGO status' },
    why: {
      es: 'Dice qué versión corre, qué tan al día están los datos y qué integraciones faltan. Es lo que te van a preguntar.',
      en: 'It shows the running version, how fresh the data is and which integrations are missing. It is what people will ask you.',
    },
    href: '/estado',
    cta: { es: 'Ir a Estado de CONTIGO', en: 'Go to CONTIGO status' },
  },
} satisfies Record<string, Step>

export const STEPS: Record<Track, Step[]> = {
  rep: [S.today, S.complete, S.leads, S.mine, S.find, S.visit, S.nostep, S.report],
  supervisor: [S.teamNow, S.team, S.exceptions, S.reassign, S.distribute, S.board, S.complete, S.report],
  lead: [S.panel, S.team, S.exceptions, S.board, S.distribute, S.audit, S.report],
  ops: [S.opsBoard, S.opsNote, S.move, S.opsTask, S.merchantData, S.report],
  lt: [S.panel, S.team, S.winRule, S.readonly, S.missing],
  admin: [S.access, S.rotation, S.winRule, S.quality, S.pipedrive, S.audit, S.reports, S.status],
}

// ---------------------------------------------------------------- hábitos por rol
/** Lo que cambia frente a Pipedrive y lo que se le pide a cada rol. Va en la bienvenida, debajo de los primeros pasos. */
export type Habits = { changes: L[]; asks: L[] }

const ASK = {
  nextStep: { es: 'Próximo paso siempre: ningún negocio abierto se queda sin qué sigue y cuándo.', en: 'Always a next step: no open deal is left without what comes next and when.' },
  visit: { es: 'Registra la visita el mismo día, con cómo te fue y quién visitó.', en: 'Log the visit the same day, with how it went and who visited.' },
  firstAttempt: { es: 'Primer intento a tiempo: llama al lead nuevo antes de que venza su meta.', en: 'First attempt on time: call the new lead before its goal runs out.' },
} satisfies Record<string, L>

export const HABITS: Record<Track, Habits> = {
  rep: {
    changes: [
      { es: 'No armas filtros ni listas: Hoy ya trae tu día ordenado.', en: 'You do not build filters or lists: Today already has your day sorted.' },
      { es: 'Al completar algo, CONTIGO te pide el próximo paso. En Pipedrive era opcional.', en: 'When you complete something, CONTIGO asks for the next step. In Pipedrive it was optional.' },
      { es: 'Cada lead nuevo trae una meta de primer contacto, a la vista.', en: 'Every new lead carries a first-contact goal, in plain sight.' },
      { es: 'No hay correo ni calendario adentro: aquí va el comercio, el negocio y su seguimiento.', en: 'There is no email or calendar inside: this is for the merchant, the deal and its follow-up.' },
    ],
    asks: [ASK.nextStep, ASK.visit, ASK.firstAttempt],
  },
  supervisor: {
    changes: [
      { es: 'Mi equipo se arma solo con lo que la gente registra: nadie te llena un reporte.', en: 'My team builds itself from what people log: nobody fills in a report for you.' },
      { es: 'Tú mueves dueños: un lead, un comercio o una cartera, sin pedirlo a nadie.', en: 'You move owners: a lead, a merchant or a book, without asking anyone.' },
      { es: 'La cola de excepciones te avisa lo que se salió de la regla.', en: 'The exception queue tells you what broke a rule.' },
    ],
    asks: [
      { es: 'Revisa Mi equipo cada semana con tu gente, fila por fila.', en: 'Review My team every week with your people, row by row.' },
      { es: 'Reparte lo que no tiene dueño vigente: lo que nadie tiene, nadie lo trabaja.', en: 'Distribute what has no current owner: what nobody holds, nobody works.' },
      ASK.nextStep,
      ASK.firstAttempt,
    ],
  },
  lead: {
    changes: [
      { es: 'Ves todo tu mercado en un lugar: embudos, equipos y lo que quedó sin dueño vigente.', en: 'You see your whole market in one place: pipelines, teams and what was left with no current owner.' },
      { es: 'Un negocio cuenta como ganado con la primera transacción, no con la firma. En el piloto se marca a mano.', en: 'A deal counts as won at the first transaction, not at signing. During the pilot it is marked by hand.' },
      { es: 'El acceso es por rol: sumar a alguien no cuesta una licencia.', en: 'Access is by role: adding someone does not cost a license.' },
    ],
    asks: [
      { es: 'Decide con tus supervisores cómo se reparte lo que no tiene dueño vigente.', en: 'Decide with your supervisors how records with no current owner are distributed.' },
      { es: 'Usa el tablero de Negocios en tu revisión, en lugar de una hoja aparte.', en: 'Use the Deals board in your review instead of a separate sheet.' },
      ASK.nextStep,
      ASK.firstAttempt,
    ],
  },
  ops: {
    changes: [
      { es: 'Ves la misma ficha que ventas: lo que anotas ahí no hay que repetirlo en otro lado.', en: 'You see the same record as sales: what you write there does not need repeating elsewhere.' },
      { es: 'Cada cambio de etapa queda con nombre y hora.', en: 'Every stage change is saved with a name and a time.' },
      { es: 'Los documentos del comercio se quedan fuera: CONTIGO no guarda archivos.', en: 'Merchant documents stay outside: CONTIGO does not store files.' },
    ],
    asks: [
      { es: 'Deja una nota con lo que hiciste o lo que falta, en el negocio.', en: 'Leave a note on the deal with what you did or what is missing.' },
      { es: 'Mueve el negocio de etapa el mismo día en que pasa.', en: 'Move the deal to its stage the same day it happens.' },
      { es: 'Mantén al día el teléfono, la dirección y los contactos del comercio.', en: 'Keep the merchant\'s phone, address and contacts current.' },
    ],
  },
  lt: {
    changes: [
      { es: 'Ves los mercados sin pedir un reporte, en solo lectura.', en: 'You see the markets without asking for a report, read-only.' },
      { es: 'Ganado es primera transacción, no firma. En el piloto, los tres embudos de primera transacción se ganan a mano.', en: 'Won means first transaction, not signing. During the pilot, the three first-transaction pipelines are won by hand.' },
      { es: 'Intento no es contacto: "Primer intento a tiempo" y "Contacto logrado" son dos números distintos.', en: 'An attempt is not a contact: "First attempt on time" and "Reached" are two different numbers.' },
    ],
    asks: [
      { es: 'Pide las cifras desde el panel y dinos cuál te hizo falta.', en: 'Take the figures from the panel and tell us which one you missed.' },
      { es: 'Respalda los tres hábitos del equipo: próximo paso siempre, visita registrada y primer intento a tiempo.', en: 'Back the team\'s three habits: always a next step, visits logged and first attempt on time.' },
    ],
  },
  admin: {
    changes: [
      { es: 'El acceso es un rol en un mercado, con equipo y fecha de fin si hace falta. No hay licencias por usuario.', en: 'Access is a role in a market, with a team and an end date when needed. There are no per-user licenses.' },
      { es: 'Todo cambio de configuración queda en la bitácora. Nada se borra: se cierra con fecha.', en: 'Every configuration change is logged. Nothing is deleted: it is ended with a date.' },
      { es: 'Las automatizaciones, los archivos y los correos de Pipedrive no se trajeron.', en: 'Pipedrive automations, files and emails were not brought over.' },
    ],
    asks: [
      { es: 'Al quitar un acceso, reparte su cartera el mismo día.', en: 'When you remove access, distribute that person\'s book the same day.' },
      { es: 'Responde los reportes del equipo en la pestaña Reportes.', en: 'Answer the team\'s reports in the Reports tab.' },
      { es: 'Revisa los turnos de leads cada vez que alguien entra o sale.', en: 'Check the lead rotations every time someone joins or leaves.' },
    ],
  },
}

/** Pantallas reales del producto capturadas con datos de prueba (public/landing, scripts/landing-shots.mjs). */
export type Shot = 'hoy' | 'leads' | 'negocios' | 'comercio' | 'equipo' | 'panel' | 'completar' | 'admin'
/** Apoyo visual de un paso: una captura real o una ilustración. */
export type Visual = { shot: Shot } | { art: 'log' | 'readonly' }
export type How = { title: L; text: L; visual: Visual }
export type Intro = { lead: L; how: How[] }

const HOW = {
  queue: {
    title: { es: 'Hoy te dice qué sigue', en: 'Today tells you what is next' },
    text: {
      es: 'Arriba, lo siguiente: el pendiente más urgente, con el botón para llamar. Abajo, lo vencido, lo de hoy y las sugerencias.',
      en: 'At the top, what is next: the most urgent item, with the call button. Below, overdue, today and suggestions.',
    },
    visual: { shot: 'hoy' },
  },
  done: {
    title: { es: 'Al terminar, dices cómo te fue', en: 'When you finish, you say how it went' },
    text: {
      es: 'Tocas el círculo, eliges el resultado y dejas el próximo paso con fecha. Son tres toques.',
      en: 'Tap the circle, pick the result and leave the next step with a date. Three taps.',
    },
    visual: { shot: 'completar' },
  },
  record: {
    title: { es: 'Todo lo de un comercio está en su ficha', en: 'Everything about a merchant is on its record' },
    text: {
      es: 'El hilo junta notas, llamadas, cambios de etapa y de dueño. El árbol muestra la cadena y sus tiendas.',
      en: 'The thread gathers notes, calls, stage and owner changes. The tree shows the chain and its stores.',
    },
    visual: { shot: 'comercio' },
  },
  deals: {
    title: { es: 'Un negocio siempre lleva próximo paso', en: 'A deal always carries a next step' },
    text: {
      es: 'En el tablero mueves la tarjeta de etapa. Si la etapa pide algo (quién decide, un dato), te lo dice ahí mismo.',
      en: 'On the board you move the card to the next stage. If the stage needs something (who decides, a detail), it tells you right there.',
    },
    visual: { shot: 'negocios' },
  },
  teamView: {
    title: { es: 'Mi equipo: una fila por persona', en: 'My team: one row per person' },
    text: {
      es: 'Leads abiertos y tardíos, primer intento a tiempo, contacto logrado, negocios sin próximo paso y revisitas.',
      en: 'Open and late leads, first attempt on time, reached, deals with no next step and revisits.',
    },
    visual: { shot: 'equipo' },
  },
  owners: {
    title: { es: 'Tú decides quién es dueño de qué', en: 'You decide who owns what' },
    text: {
      es: 'Reasignas leads y comercios de tu equipo. Los leads sin dueño los ve cualquier vendedor del mercado y los puede tomar.',
      en: 'You reassign your team\'s leads and merchants. Leads with no owner are visible to any seller in the market, who can take them.',
    },
    visual: { shot: 'leads' },
  },
  market: {
    title: { es: 'Ves todo tu mercado', en: 'You see your whole market' },
    text: {
      es: 'Todos los embudos, todos los equipos y los registros que quedaron a nombre de la cuenta de la casa o de personas que ya no están.',
      en: 'Every pipeline, every team, and the records still held by the house account or by people who have left.',
    },
    visual: { shot: 'negocios' },
  },
  numbers: {
    title: { es: 'De dónde salen los números', en: 'Where the numbers come from' },
    text: {
      es: 'De lo que el equipo registra en CONTIGO. Las visitas automáticas y la primera venta llegarán solas cuando se conecten la Sales App y los datos de ventas.',
      en: 'From what the team logs in CONTIGO. Automatic visits and the first sale will arrive on their own once the Sales App and the sales data are connected.',
    },
    visual: { shot: 'panel' },
  },
  after: {
    title: { es: 'Recibes el negocio después del alta', en: 'You receive the deal after enrollment' },
    text: {
      es: 'Lo encuentras en el tablero, en las etapas que te tocan. Lo editas, lo mueves y completas los datos del comercio. No creas negocios ni trabajas leads.',
      en: 'You find it on the board, in the stages you own. You edit it, move it and complete the merchant details. You do not create deals or work leads.',
    },
    visual: { shot: 'negocios' },
  },
  readOnly: {
    title: { es: 'Ves todo y no cambias nada', en: 'You see everything and change nothing' },
    text: {
      es: 'Tu acceso es de solo lectura en todos los mercados. Los botones para crear o editar no aparecen.',
      en: 'Your access is read-only across all markets. The buttons to create or edit do not appear.',
    },
    visual: { art: 'readonly' },
  },
  config: {
    title: { es: 'Administración, pestaña por pestaña', en: 'Administration, tab by tab' },
    text: {
      es: 'Personas y acceso, Territorios, Embudos y campos, Formularios y turnos, Integraciones, Pipedrive, Calidad de datos, Reportes y Auditoría.',
      en: 'People and access, Territories, Pipelines and fields, Forms and rotation, Integrations, Pipedrive, Data quality, Reports and Audit.',
    },
    visual: { shot: 'admin' },
  },
  logged: {
    title: { es: 'Todo cambio queda escrito', en: 'Every change is written down' },
    text: {
      es: 'Accesos, dueños, etapas y configuración quedan en la bitácora con quién, qué y cuándo. Nada se borra: se cierra con fecha.',
      en: 'Access, owners, stages and configuration are logged with who, what and when. Nothing is deleted: it is ended with a date.',
    },
    visual: { art: 'log' },
  },
} satisfies Record<string, How>

export const INTRO: Record<Track, Intro> = {
  rep: {
    lead: { es: 'CONTIGO ordena tu día: qué comercio sigue, qué quedó pendiente y qué negocio necesita un próximo paso.', en: 'CONTIGO sorts your day: which merchant is next, what is pending and which deal needs a next step.' },
    how: [HOW.queue, HOW.done, HOW.record, HOW.deals],
  },
  supervisor: {
    lead: { es: 'Además de tu propia cola, ves cómo va cada persona de tu equipo y mueves lo que se quedó sin dueño.', en: 'Besides your own queue, you see how each person on your team is doing and move what was left without an owner.' },
    how: [HOW.teamView, HOW.owners, HOW.queue, HOW.deals],
  },
  lead: {
    lead: { es: 'Tienes la vista completa de tu mercado: los embudos, los equipos y lo que todavía no tiene un dueño real.', en: 'You have the full view of your market: the pipelines, the teams and what does not have a real owner yet.' },
    how: [HOW.market, HOW.teamView, HOW.owners, HOW.numbers],
  },
  ops: {
    lead: { es: 'Ventas firma; tú llevas el negocio desde la entrega hasta que el comercio queda operando.', en: 'Sales signs; you carry the deal from the handover until the merchant is up and running.' },
    how: [HOW.after, HOW.queue, HOW.record, HOW.logged],
  },
  lt: {
    lead: { es: 'Una sola vista de los mercados para seguir el embudo sin pedir reportes.', en: 'A single view of the markets to follow the pipeline without asking for reports.' },
    how: [HOW.readOnly, HOW.numbers, HOW.teamView, HOW.logged],
  },
  admin: {
    lead: { es: 'Tú mantienes la herramienta: accesos, embudos, turnos de leads, integraciones, la calidad de los datos y los reportes del equipo.', en: 'You keep the tool running: access, pipelines, lead rotations, integrations, data quality and the team\'s reports.' },
    how: [HOW.config, HOW.logged, HOW.numbers, HOW.market],
  },
}

// ---------------------------------------------------------------- ayuda
// Regla: cada respuesta describe lo que existe hoy, con el nombre exacto del botón o la pantalla.
// Lo que otros paquetes están construyendo se escribe después de integrarlos (ver contenido-pendiente-ola3.md).
export type HelpTopic = 'start' | 'today' | 'leads' | 'deals' | 'merchants' | 'field' | 'team' | 'data' | 'access' | 'admin' | 'limits' | 'support'
export type HelpItem = { id: string; topic: HelpTopic; tracks: 'all' | Track[]; q: L; a: L }

export const HELP_TOPICS: Record<HelpTopic, L> = {
  start: { es: 'Para empezar', en: 'Getting started' },
  today: { es: 'Hoy y el próximo paso', en: 'Today and the next step' },
  leads: { es: 'Leads', en: 'Leads' },
  deals: { es: 'Negocios', en: 'Deals' },
  merchants: { es: 'Comercios', en: 'Merchants' },
  field: { es: 'Visitas y campo', en: 'Visits and field work' },
  team: { es: 'Equipo y dueños', en: 'Team and owners' },
  data: { es: 'Datos, Pipedrive e integraciones', en: 'Data, Pipedrive and integrations' },
  access: { es: 'Acceso y permisos', en: 'Access and permissions' },
  admin: { es: 'Administración', en: 'Admin' },
  limits: { es: 'Lo que CONTIGO no hace todavía', en: 'What CONTIGO does not do yet' },
  support: { es: 'Reportar un problema', en: 'Report a problem' },
}

const SELL: Track[] = ['rep', 'supervisor', 'lead']
const WORK: Track[] = ['rep', 'supervisor', 'lead', 'ops']
const MANAGE: Track[] = ['supervisor', 'lead', 'admin']
const WATCH: Track[] = ['supervisor', 'lead', 'lt', 'admin']

export const HELP: HelpItem[] = [
  // ------------------------------------------------------------ para empezar
  {
    id: 'what-is', topic: 'start', tracks: 'all',
    q: { es: '¿Qué es CONTIGO?', en: 'What is CONTIGO?' },
    a: { es: 'Es el CRM de axexo: leads, negocios, comercios y su seguimiento en un solo lugar, para todos los mercados. Reemplaza a Pipedrive.', en: 'It is axexo\'s CRM: leads, deals, merchants and their follow-up in one place, for every market. It replaces Pipedrive.' },
  },
  {
    id: 'pipedrive', topic: 'start', tracks: 'all',
    q: { es: '¿Sigo usando Pipedrive?', en: 'Do I keep using Pipedrive?' },
    a: { es: 'Durante el piloto, sí: Pipedrive sigue siendo el sistema de trabajo y CONTIGO tiene una copia de sus datos para probar. Lo que registres aquí no vuelve a Pipedrive. Te avisaremos la fecha del cambio.', en: 'During the pilot, yes: Pipedrive remains the working system and CONTIGO holds a copy of its data for testing. What you log here does not go back to Pipedrive. We will tell you the switch date.' },
  },
  {
    id: 'phone', topic: 'start', tracks: 'all',
    q: { es: '¿Hay una app o funciona en el teléfono?', en: 'Is there an app, or does it work on a phone?' },
    a: { es: 'Funciona en el navegador del teléfono, con la misma dirección, y la pantalla se acomoda sola. No hay una app que instalar. Puedes agregarla a tu pantalla de inicio desde el menú del navegador.', en: 'It works in your phone\'s browser, at the same address, and the screen adapts on its own. There is no app to install. You can add it to your home screen from the browser menu.' },
  },
  {
    id: 'offline', topic: 'start', tracks: 'all',
    q: { es: '¿Qué pasa si me quedo sin señal?', en: 'What happens if I lose signal?' },
    a: { es: 'Aparece un aviso arriba y los botones de guardar se detienen para que no pierdas nada. Lo que ya está en pantalla lo puedes leer. Cuando vuelve la señal sigues donde estabas. Todavía no se puede trabajar sin conexión.', en: 'A notice appears at the top and the save buttons pause so you lose nothing. You can read what is already on screen. When the signal returns you carry on where you were. Working offline is not available yet.' },
  },
  {
    id: 'language', topic: 'start', tracks: 'all',
    q: { es: '¿Cómo cambio el idioma?', en: 'How do I change the language?' },
    a: { es: 'En computadora y tablet, con el botón ES / EN de la barra de arriba, junto a tus iniciales. En el teléfono, abre tu menú (tus iniciales) y toca "Cambiar idioma a inglés". Se queda guardado.', en: 'On a computer or tablet, with the ES / EN button in the top bar, next to your initials. On a phone, open your menu (your initials) and tap "Switch language to Spanish". It stays saved.' },
  },
  {
    id: 'menu', topic: 'start', tracks: WATCH,
    q: { es: '¿Dónde están Mi equipo, el Panel del LT y Administración?', en: 'Where are My team, the Leadership panel and Administration?' },
    a: { es: 'En tu menú: tus iniciales, arriba a la derecha. Ahí aparece solo lo que tu rol puede abrir. La app abre en Hoy, que es la lista de trabajo de ventas.', en: 'In your menu: your initials, top right. Only what your role can open shows up there. The app opens on Today, which is the sales work list.' },
  },
  {
    id: 'first-steps-back', topic: 'start', tracks: 'all',
    q: { es: 'Escondí mis primeros pasos, ¿cómo los recupero?', en: 'I hid my first steps. How do I get them back?' },
    a: { es: 'En tu menú, en "Primeros pasos". Ahí mismo puedes volver a mostrar la lista en Hoy.', en: 'In your menu, under "First steps". From there you can show the list in Today again.' },
  },
  {
    id: 'entry-real', topic: 'start', tracks: 'all',
    q: { es: '¿Las pantallas, cifras y fotos de la entrada son reales?', en: 'Are the screens, figures and photos on the entry page real?' },
    a: { es: 'Las pantallas son de CONTIGO con datos de prueba. Las cifras de las gráficas son de ejemplo y las fotos son de archivo.', en: 'The screens are CONTIGO with test data. The chart figures are examples and the photos are stock.' },
  },

  // ------------------------------------------------------------ hoy
  {
    id: 'today-order', topic: 'today', tracks: WORK,
    q: { es: '¿Cómo se ordena mi lista de Hoy?', en: 'How is my Today list sorted?' },
    a: { es: 'Primero los leads con el reloj corriendo, luego lo vencido, luego lo de hoy y al final hasta cinco sugerencias, una por comercio, empezando por las más importantes.', en: 'First leads with the clock running, then overdue, then today, and finally up to five suggestions, one per merchant, most important first.' },
  },
  {
    id: 'suggestions', topic: 'today', tracks: WORK,
    q: { es: '¿Qué es una sugerencia y por qué solo veo cinco?', en: 'What is a suggestion and why do I only see five?' },
    a: { es: 'Es un aviso de CONTIGO: un negocio sin próximo paso, uno que lleva mucho en la misma etapa, una revisita pendiente. Se muestran cinco por día para que la lista se pueda terminar. El resto está en Negocios, con el filtro "Sin próximo paso".', en: 'It is a notice from CONTIGO: a deal with no next step, one stuck in a stage, a pending revisit. Five show per day so the list can be finished. The rest are in Deals, under the "No next step" filter.' },
  },
  {
    id: 'next-step', topic: 'today', tracks: WORK,
    q: { es: '¿Por qué siempre me pide el próximo paso?', en: 'Why does it always ask for the next step?' },
    a: { es: 'Porque un negocio abierto sin próximo paso es un negocio que nadie está moviendo. Si de verdad no hay nada que hacer, elige "Nada más: cerrar". No se puede en dos casos: un lead que no contestó y una sugerencia.', en: 'Because an open deal with no next step is a deal nobody is moving. If there is truly nothing to do, choose "Nothing else: close". Two cases do not allow it: a lead that did not answer and a suggestion.' },
  },
  {
    id: 'log-activity', topic: 'today', tracks: WORK,
    q: { es: '¿Cómo registro algo que no estaba en mi lista?', en: 'How do I log something that was not on my list?' },
    a: { es: 'Toca + y "Registrar actividad". También puedes abrir la ficha del comercio y tocar Visita, Nota o Actividad. Todo lo que registras queda ligado a un comercio, un lead o un negocio.', en: 'Tap + and "Log activity". You can also open the merchant record and tap Visit, Note or Activity. Everything you log is tied to a merchant, a lead or a deal.' },
  },
  {
    id: 'remind', topic: 'today', tracks: WORK,
    q: { es: '¿Cómo me recuerdo volver a un comercio?', en: 'How do I remind myself to go back to a merchant?' },
    a: { es: 'Abre la ficha, toca Actividad, elige "Tarea con fecha" o "Visita por hacer (con fecha)", escribe para qué y pon el día. Ese día aparece en tu Hoy.', en: 'Open the record, tap Activity, choose "Task with a date" or "Planned visit (with a date)", write what for and pick the day. That day it shows up in your Today.' },
  },
  {
    id: 'today-empty', topic: 'today', tracks: SELL,
    q: { es: '¿Por qué Hoy me sale "Todo al día" si tengo trabajo?', en: 'Why does Today say "All caught up" when I have work?' },
    a: { es: 'Hoy muestra lo que está a tu nombre: tareas con fecha, leads nuevos y sugerencias de tus negocios. Revisa Comercios, "Míos". Si faltan comercios, pídele a tu supervisor que te los asigne.', en: 'Today shows what is under your name: dated tasks, new leads and suggestions from your deals. Check Merchants, "Mine". If merchants are missing, ask your supervisor to assign them to you.' },
  },
  {
    id: 'call-back', topic: 'today', tracks: SELL,
    q: { es: 'Volví de una llamada y me pregunta cómo me fue. ¿Y si no llamé?', en: 'I came back from a call and it asks how it went. What if I did not call?' },
    a: { es: 'Toca Cancelar: no se guarda nada.', en: 'Tap Cancel: nothing is saved.' },
  },

  // ------------------------------------------------------------ leads
  {
    id: 'lead-clock', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué mide el reloj de un lead?', en: 'What does a lead\'s clock measure?' },
    a: { es: 'El tiempo que queda para el primer intento de contacto. Se detiene cuando registras la llamada, aunque no conteste. El lead pasa a "Contactado" solo cuando hablaste con la persona.', en: 'The time left for the first contact attempt. It stops when you log the call, even if there is no answer. The lead becomes "Contacted" only when you spoke to the person.' },
  },
  {
    id: 'lead-no-answer', topic: 'leads', tracks: SELL,
    q: { es: 'Llamé y no contestó. ¿Ya cuenta como contactado?', en: 'I called and nobody answered. Does it count as contacted?' },
    a: { es: 'No. El intento queda guardado y CONTIGO te pide programar el siguiente. Cuenta como contactado cuando hablas con la persona.', en: 'No. The attempt is saved and CONTIGO asks you to schedule the next one. It counts as contacted when you speak with the person.' },
  },
  {
    id: 'lead-late', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué significa "Pasó la meta"?', en: 'What does "Past the goal" mean?' },
    a: { es: 'Que el lead no tuvo un primer intento de contacto dentro del tiempo que marca su reloj. Llámalo de todos modos y registra cómo te fue.', en: 'That the lead had no first contact attempt within the time on its clock. Call it anyway and log how it went.' },
  },
  {
    id: 'lead-take', topic: 'leads', tracks: SELL,
    q: { es: '¿Puedo tomar un lead sin dueño?', en: 'Can I take a lead with no owner?' },
    a: { es: 'Sí, si es de tu mercado. "Tomar y llamar" lo deja a tu nombre y abre la llamada. No puedes tomar el lead de otra persona.', en: 'Yes, if it is in your market. "Take and call" makes it yours and opens the call. You cannot take someone else\'s lead.' },
  },
  {
    id: 'lead-rotation', topic: 'leads', tracks: [...SELL, 'admin'],
    q: { es: '¿Cómo se reparten los leads del formulario web?', en: 'How are web form leads distributed?' },
    a: { es: 'Por turno, entre las personas que administración puso en el turno de ese formulario. Si en el turno no queda nadie, el lead va al respaldo; si no hay respaldo, queda sin dueño y lo ve quien vende en ese mercado.', en: 'In rotation, among the people an admin put in that form\'s rotation. If nobody is left in the rotation, the lead goes to the fallback; with no fallback, it stays unowned and that market\'s sellers see it.' },
  },
  {
    id: 'lead-imported', topic: 'leads', tracks: SELL,
    q: { es: '¿Por qué tengo tantos leads sin reloj?', en: 'Why do I have so many leads with no clock?' },
    a: { es: 'Son los que venían de Pipedrive. No traen reloj y no entran a tu Hoy para no llenarlo. Están en Leads para que los trabajes o los descartes a tu ritmo.', en: 'They came from Pipedrive. They carry no clock and do not enter your Today so it does not fill up. They sit in Leads for you to work or discard at your own pace.' },
  },
  {
    id: 'lead-discard', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué hago con un lead que no va a ningún lado?', en: 'What do I do with a lead that is going nowhere?' },
    a: { es: 'Abre el lead y toca "Descartar". Te pide un motivo: elige el más cercano. El lead sale de tu lista y el motivo queda guardado.', en: 'Open the lead and tap "Disqualify". It asks for a reason: pick the closest one. The lead leaves your list and the reason is kept.' },
  },
  {
    id: 'lead-source', topic: 'leads', tracks: [...SELL, 'admin'],
    q: { es: '¿Dónde veo de qué campaña vino un lead y si aceptó correos?', en: 'Where do I see a lead\'s campaign and email consent?' },
    a: { es: 'En el detalle del lead, en "De dónde vino". Ahí mismo dice si dio su consentimiento para recibir correos.', en: 'In the lead detail, under "Where it came from". It also says whether the person agreed to receive emails.' },
  },

  // ------------------------------------------------------------ negocios
  {
    id: 'deal-move', topic: 'deals', tracks: WORK,
    q: { es: '¿Por qué no me deja mover un negocio de etapa?', en: 'Why can I not move a deal to the next stage?' },
    a: { es: 'Cada etapa pide lo suyo: un próximo paso con fecha, quién decide, algún dato. La página del negocio te dice qué falta. No se puede saltar etapas para evitarlo.', en: 'Each stage asks for something: a dated next step, who decides, a detail. The deal page tells you what is missing. You cannot skip stages to avoid it.' },
  },
  {
    id: 'deal-decision', topic: 'deals', tracks: WORK,
    q: { es: '¿Por qué me pide haber hablado con quien decide?', en: 'Why does it ask whether I spoke with the decision-maker?' },
    a: { es: 'Hay etapas que no dejan entrar sin un decisor identificado y contactado. Agrega a la persona en la ficha del comercio (Datos, Contactos, "Agregar"). Luego, en el negocio, elígela en "Decisor" y marca "Ya hablé con el decisor" solo cuando sea cierto.', en: 'Some stages cannot be entered without a decision-maker identified and reached. Add the person on the merchant record (Details, Contacts, "Add"). Then, on the deal, pick them under "Decision-maker" and tick "I have spoken with the decision-maker" only when it is true.' },
  },
  {
    id: 'deal-won', topic: 'deals', tracks: 'all',
    q: { es: '¿Cómo se gana un negocio?', en: 'How is a deal won?' },
    a: { es: 'Un negocio de alta se gana cuando el comercio hace su primera transacción, no cuando firma. Regla del piloto: los tres embudos de primera transacción se ganan a mano. Abre el negocio y toca "Marcar como ganado". Si no ves el botón, ese embudo sigue esperando la transacción: avisa a quien administra CONTIGO.', en: 'An enrollment deal is won when the merchant makes its first transaction, not when it signs. Pilot rule: the three first-transaction pipelines are won by hand. Open the deal and tap "Mark as won". If you do not see the button, that pipeline is still waiting for the transaction: tell a CONTIGO admin.' },
  },
  {
    id: 'deal-lost', topic: 'deals', tracks: WORK,
    q: { es: 'El comercio dijo que no. ¿Dónde lo pongo?', en: 'The merchant said no. Where do I put that?' },
    a: { es: 'Abre el negocio y toca "Marcar como perdido". Elige el motivo más cercano y deja el detalle de lo que te dijeron en una nota.', en: 'Open the deal and tap "Mark as lost". Pick the closest reason and leave the detail of what they told you in a note.' },
  },
  {
    id: 'deal-revisit', topic: 'deals', tracks: SELL,
    q: { es: '¿Qué pasa si elijo "Volver con quien decide"?', en: 'What happens if I choose "Go back for the decision-maker"?' },
    a: { es: 'El negocio queda marcado con revisita y "Visitar" queda elegido como lo que sigue.', en: 'The deal is flagged for a revisit and "Visit" is preselected as the next step.' },
  },
  {
    id: 'deal-stalled', topic: 'deals', tracks: 'all',
    q: { es: '¿Qué es un negocio estancado?', en: 'What is a stalled deal?' },
    a: { es: 'Uno que lleva en su etapa más días de los que esa etapa permite. Los días de cada etapa los define administración en "Embudos y campos".', en: 'One that has been in its stage longer than that stage allows. An admin sets the days for each stage under "Pipelines and fields".' },
  },
  {
    id: 'deal-currency', topic: 'deals', tracks: 'all',
    q: { es: '¿Por qué los montos no se suman entre monedas?', en: 'Why are amounts not added across currencies?' },
    a: { es: 'Cada total va en su moneda. En el tablero y en las listas, CONTIGO no mezcla pesos con dólares.', en: 'Each total stays in its currency. On the board and in lists, CONTIGO does not mix pesos with dollars.' },
  },

  // ------------------------------------------------------------ comercios
  {
    id: 'merchant-find', topic: 'merchants', tracks: 'all',
    q: { es: '¿Cómo encuentro un comercio?', en: 'How do I find a merchant?' },
    a: { es: 'Con el buscador de arriba: por nombre, teléfono, nombre del contacto o ID. En escritorio, la tecla "/" te lleva al buscador. En el teléfono, toca la lupa.', en: 'With the search box at the top: by name, phone, contact name or ID. On a desktop, the "/" key takes you to the search box. On a phone, tap the magnifying glass.' },
  },
  {
    id: 'merchant-missing', topic: 'merchants', tracks: SELL,
    q: { es: 'Busqué un comercio y no aparece. ¿Es nuevo o es de otra persona?', en: 'I searched a merchant and got nothing. Is it new or someone else\'s?' },
    a: { es: 'Puede ser cualquiera de las dos: tú ves lo tuyo y lo que no tiene dueño. Búscalo por teléfono y, si no aparece, pregunta a tu supervisor antes de crearlo. Si lo creas, CONTIGO te avisa cuando se parece a uno que ya existe.', en: 'It can be either: you see your own records and the ones with no owner. Search by phone and, if it still does not show, ask your supervisor before adding it. If you add it, CONTIGO warns you when it looks like an existing one.' },
  },
  {
    id: 'merchant-new', topic: 'merchants', tracks: SELL,
    q: { es: '¿Cómo agrego un comercio nuevo?', en: 'How do I add a new merchant?' },
    a: { es: 'Toca + y "Comercio", o en Comercios, "Nuevo comercio". Si se parece a uno que ya existe, te lo dice. Si de verdad es otro, marca "Crear de todos modos si se parece a uno que ya existe".', en: 'Tap + and "Merchant", or in Merchants, "New merchant". If it looks like an existing one, it tells you. If it really is a different one, tick "Create anyway if it looks like an existing one".' },
  },
  {
    id: 'merchant-contacts', topic: 'merchants', tracks: WORK,
    q: { es: 'Quien me atendió no es el dueño. ¿Cómo registro a los dos?', en: 'The person I spoke with is not the owner. How do I record both?' },
    a: { es: 'En la ficha, Datos, Contactos, "Agregar". Cada persona va con su rol, así que quien atiende y quien decide quedan por separado.', en: 'On the record, Details, Contacts, "Add". Each person carries a role, so the clerk and the decision-maker are kept apart.' },
  },
  {
    id: 'merchant-health', topic: 'merchants', tracks: 'all',
    q: { es: '¿Qué significa la salud de un comercio?', en: 'What does a merchant\'s health mean?' },
    a: { es: 'Activo: está vendiendo. Sin transaccionar: ya se dio de alta y todavía no vende. En riesgo: bajó o dejó de vender. Lead nuevo: todavía es prospecto. Estos estados dependen de los datos de ventas, que aún no están conectados.', en: 'Active: it is selling. Not transacting: it enrolled and is not selling yet. At risk: sales dropped or stopped. New lead: still a prospect. These states depend on sales data, which is not connected yet.' },
  },
  {
    id: 'merchant-tree', topic: 'merchants', tracks: 'all',
    q: { es: '¿Para qué sirve el árbol?', en: 'What is the tree for?' },
    a: { es: 'Muestra la cadena o el distribuidor y las tiendas que cuelgan de él, con sus totales. Sirve para ver una cuenta completa y no tienda por tienda.', en: 'It shows the chain or distributor and the stores under it, with totals. It lets you see a whole account instead of store by store.' },
  },
  {
    id: 'merchant-attribution', topic: 'merchants', tracks: 'all',
    q: { es: '¿Quién es el dueño de un comercio y desde cuándo?', en: 'Who owns a merchant, and since when?' },
    a: { es: 'En la ficha, Datos, "Atribución": origen, canal y dueño, cada uno con su fecha. Lo anterior no se borra.', en: 'On the record, Details, "Attribution": source, channel and owner, each with its date. Earlier values are not deleted.' },
  },
  {
    id: 'merchant-directions', topic: 'merchants', tracks: SELL,
    q: { es: '¿Cómo llego a la tienda?', en: 'How do I get to the store?' },
    a: { es: 'En la ficha, bajo el nombre, "Cómo llegar" abre tu app de mapas. Si no aparece, falta la dirección: agrégala con "Agregar dirección" o en Datos.', en: 'On the merchant record, under the name, "Directions" opens your maps app. If it is missing, there is no address yet: add it with "Add address" or in Details.' },
  },

  // ------------------------------------------------------------ visitas y campo
  {
    id: 'visits', topic: 'field', tracks: 'all',
    q: { es: '¿Dónde registro una visita?', en: 'Where do I log a visit?' },
    a: { es: 'Toca + y "Registrar actividad", o abre la ficha y toca "Visita". Elige cómo te fue, el día y, si no fuiste tú, quién visitó. Cuando la Sales App se conecte, las visitas llegarán solas y no se contarán dos veces.', en: 'Tap + and "Log activity", or open the merchant and tap "Visit". Choose how it went, the day and, if it was not you, who visited. Once the Sales App is connected, visits will come in on their own and will not be counted twice.' },
  },
  {
    id: 'street-rep', topic: 'field', tracks: SELL,
    q: { es: '¿Dónde pongo al vendedor de calle?', en: 'Where do I put the street rep?' },
    a: { es: 'En cada visita, en "¿Quién visitó?". CONTIGO sugiere los nombres ya usados en tu mercado. La visita cuenta para quien lleva el comercio.', en: 'On each visit, under "Who visited?". CONTIGO suggests the names already used in your market. The visit counts for whoever owns the merchant.' },
  },
  {
    id: 'visits-team', topic: 'field', tracks: WATCH,
    q: { es: '¿De dónde salen las visitas de Mi equipo?', en: 'Where do the visits in My team come from?' },
    a: { es: 'De las que el equipo registra en CONTIGO y de las que lleguen de la Sales App. Si la misma está en las dos, cuenta una vez.', en: 'From the ones the team logs in CONTIGO and the ones that arrive from the Sales App. If the same visit is in both, it counts once.' },
  },

  // ------------------------------------------------------------ equipo y dueños
  {
    id: 'see-what', topic: 'team', tracks: 'all',
    q: { es: '¿Qué puedo ver?', en: 'What can I see?' },
    a: { es: 'Ventas ve lo suyo, los leads sin dueño de su mercado y los comercios sin dueño de sus territorios. Supervisión, lo de su equipo. Líder de mercado y Operaciones, todo su mercado. Leadership y Administración, todos los mercados; Leadership, en solo lectura.', en: 'Sales sees their own records, the unowned leads of their market and the unowned merchants of their territories. Supervisors, their team\'s. Market leads and Operations, their whole market. Leadership and Administration, every market; Leadership, read-only.' },
  },
  {
    id: 'team-views', topic: 'team', tracks: ['supervisor', 'lead'],
    q: { es: '¿Dónde veo a mi equipo?', en: 'Where do I see my team?' },
    a: { es: 'En dos lugares. En Hoy, "Mi equipo": quién necesita apoyo ahora. En tu menú, "Mi equipo": la tabla por persona, lo que no tiene dueño vigente y la cola de excepciones.', en: 'Two places. In Today, "My team": who needs support now. In your menu, "My team": the table per person, what has no current owner and the exception queue.' },
  },
  {
    id: 'metrics', topic: 'team', tracks: WATCH,
    q: { es: '¿Qué diferencia hay entre "Primer intento a tiempo" y "Contacto logrado"?', en: 'What is the difference between "First attempt on time" and "Reached"?' },
    a: { es: 'El primero cuenta los leads en los que se intentó el contacto dentro del plazo. El segundo, aquellos en los que se habló con la persona. Un intento no es un contacto.', en: 'The first counts leads where contact was attempted within the deadline. The second, those where the person was actually spoken to. An attempt is not a contact.' },
  },
  {
    id: 'exceptions', topic: 'team', tracks: MANAGE,
    q: { es: '¿Qué es la cola de excepciones y qué hace "Descartar"?', en: 'What is the exception queue and what does "Dismiss" do?' },
    a: { es: 'Junta lo que se salió de la regla: un negocio sin próximo paso o estancado, una revisita pendiente, un comercio en riesgo o sin dueño. Cada aviso se cierra solo cuando se corrige. "Descartar" lo saca de la lista y no vuelve en 7 días, aunque siga sin corregirse.', en: 'It gathers what broke a rule: a deal with no next step or stalled, a pending revisit, a merchant at risk or with no owner. Each item closes on its own once it is fixed. "Dismiss" removes it from the list and it does not come back for 7 days, even if it is still not fixed.' },
  },
  {
    id: 'reassign', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo reasigno un lead o un comercio?', en: 'How do I reassign a lead or a merchant?' },
    a: { es: 'Comercio: abre la ficha y toca "Reasignar", junto al dueño; te pide confirmar. Lead: abre el lead y, en "Dueño", elige a la persona y toca "Reasignar". Para muchos a la vez, usa "Repartir" en Comercios o "Reasignar cartera" en Mi equipo.', en: 'Merchant: open the record and tap "Reassign", next to the owner; it asks you to confirm. Lead: open the lead and, under "Owner", pick the person and tap "Reassign". For many at once, use "Distribute" in Merchants or "Reassign book" in My team.' },
  },
  {
    id: 'moves-with', topic: 'team', tracks: MANAGE,
    q: { es: '¿Qué se va con el comercio cuando lo reasigno?', en: 'What moves with the merchant when I reassign it?' },
    a: { es: 'Sus negocios y tareas abiertas. La historia se queda en la ficha y el cambio queda en la bitácora con tu nombre.', en: 'Its open deals and tasks. The history stays on the record and the change is logged with your name.' },
  },
  {
    id: 'distribute', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo reparto por ciudad o territorio?', en: 'How do I distribute by city or territory?' },
    a: { es: 'En Comercios, abre "Filtrar por dueño, plaza o territorio" y luego "Repartir": marca varios o elige "Todos los de este filtro" y a quién se los pasas.', en: 'In Merchants, open "Filter by owner, place or territory", then "Distribute": tick some or choose "Everything in this filter" and who gets them.' },
  },
  {
    id: 'book-part', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo paso solo los leads o los negocios de alguien?', en: 'How do I move only someone\'s leads or deals?' },
    a: { es: 'En Mi equipo, "Reasignar cartera": elige "Leads abiertos" o "Negocios abiertos".', en: 'In My team, "Reassign book": choose "Open leads" or "Open deals".' },
  },
  {
    id: 'house-account', topic: 'team', tracks: MANAGE,
    q: { es: '¿Qué es "sin dueño vigente" y quién lo ve?', en: 'What is "no current owner" and who sees it?' },
    a: { es: 'Es un comercio o lead sin dueño, o a nombre de una cuenta de servicio o de alguien que ya no vende en ese mercado. Lo ven supervisión y quien lidera el mercado, en Mi equipo. Quien vende no lo ve hasta que se le reparte.', en: 'It is a merchant or lead with no owner, or under a service account or someone who no longer sells in that market. Supervisors and the market lead see it, in My team. Sellers do not see it until it is distributed to them.' },
  },
  {
    id: 'move-to-team', topic: 'team', tracks: ['supervisor'],
    q: { es: '¿Por qué solo veo a mi equipo en "Pasar a"?', en: 'Why do I only see my team under "Move to"?' },
    a: { es: 'Supervisión reparte dentro de su equipo. Para pasar algo a otro equipo, pídelo a quien lidera el mercado.', en: 'Supervisors distribute within their team. To move something to another team, ask the market lead.' },
  },
  {
    id: 'notify-receiver', topic: 'team', tracks: MANAGE,
    q: { es: 'Cuando reparto comercios, ¿CONTIGO avisa a quien los recibe?', en: 'When I distribute merchants, does CONTIGO notify the receiver?' },
    a: { es: 'No. Avísale antes. El cambio queda en la bitácora con tu nombre.', en: 'No. Tell them first. The change is logged with your name.' },
  },
  {
    id: 'territories', topic: 'team', tracks: MANAGE,
    q: { es: '¿Dónde se crean los territorios?', en: 'Where are territories created?' },
    a: { es: 'En Administración, "Territorios". A los comercios se les pone territorio desde Comercios, con "Repartir".', en: 'In Administration, "Territories". Merchants get their territory from Merchants, with "Distribute".' },
  },
  {
    id: 'access-removed-book', topic: 'team', tracks: MANAGE,
    q: { es: 'Le quitaron el acceso a alguien. ¿Qué pasa con su cartera?', en: 'Someone\'s access was removed. What happens to their book?' },
    a: { es: 'Queda sin dueño vigente. Aparece en Administración, "Personas y acceso", y en Mi equipo con "Repartir comercios".', en: 'It has no current owner. It shows in Administration, "People and access", and in My team with "Distribute merchants".' },
  },
  {
    id: 'supervisor-own', topic: 'team', tracks: ['supervisor'],
    q: { es: '¿Puedo llevar cuentas propias además de supervisar?', en: 'Can I carry my own accounts besides supervising?' },
    a: { es: 'Sí. Supervisión también crea leads, comercios y negocios a su nombre. En Hoy, "Yo" es tu lista y "Mi equipo" la de tu gente.', en: 'Yes. Supervisors also create leads, merchants and deals under their own name. In Today, "Me" is your list and "My team" is your people\'s.' },
  },

  // ------------------------------------------------------------ datos
  {
    id: 'data-source', topic: 'data', tracks: 'all',
    q: { es: '¿De dónde salieron los datos que veo?', en: 'Where did the data I see come from?' },
    a: { es: 'De una copia de Pipedrive: comercios, contactos, negocios, leads, notas y productos de US y de México. Lo que cambies en Pipedrive después de esa copia no aparece aquí.', en: 'From a copy of Pipedrive: merchants, contacts, deals, leads, notes and products for the US and Mexico. What you change in Pipedrive after that copy does not show up here.' },
  },
  {
    id: 'pipedrive-history', topic: 'data', tracks: 'all',
    q: { es: '¿Está aquí todo lo de Pipedrive?', en: 'Is everything from Pipedrive in here?' },
    a: { es: 'Las notas y actividades importadas están en el hilo de cada comercio y en cada negocio. No se trajeron los correos, los archivos adjuntos, las automatizaciones ni los filtros guardados.', en: 'Imported notes and activities are on each merchant\'s thread and on each deal. Emails, attachments, automations and saved filters were not brought over.' },
  },
  {
    id: 'sales-app', topic: 'data', tracks: 'all',
    q: { es: '¿CONTIGO ya está conectado con la Sales App y con los datos de ventas?', en: 'Is CONTIGO already connected to the Sales App and the sales data?' },
    a: { es: 'Todavía no. Está listo para recibir las visitas y las tiendas nuevas de la Sales App y las transacciones de cada comercio, pero esas conexiones aún no están encendidas.', en: 'Not yet. It is ready to receive visits and new stores from the Sales App and each merchant\'s transactions, but those connections are not switched on yet.' },
  },
  {
    id: 'numbers-source', topic: 'data', tracks: WATCH,
    q: { es: '¿De dónde sale cada número?', en: 'Where does each number come from?' },
    a: { es: 'Leads, negocios y seguimiento salen de lo que el equipo registra en CONTIGO. Las ventas y los comercios activos dependen de los datos de ventas, y las visitas automáticas de la Sales App: las dos conexiones están pendientes.', en: 'Leads, deals and follow-up come from what the team logs in CONTIGO. Sales and active merchants depend on the sales data, and automatic visits on the Sales App: both connections are pending.' },
  },
  {
    id: 'sensitive', topic: 'data', tracks: 'all',
    q: { es: '¿Qué no debo escribir en una nota?', en: 'What should I not write in a note?' },
    a: { es: 'Números de tarjeta, cuentas bancarias, CLABE, números de seguro social, contraseñas ni identificaciones oficiales completas. CONTIGO rechaza los que reconoce.', en: 'Card numbers, bank accounts, CLABE, Social Security numbers, passwords or full official IDs. CONTIGO refuses the ones it recognizes.' },
  },
  {
    id: 'documents', topic: 'data', tracks: 'all',
    q: { es: '¿Dónde van los documentos del comercio?', en: 'Where do merchant documents go?' },
    a: { es: 'Fuera de CONTIGO, en la carpeta donde tu equipo ya los guarda. CONTIGO no guarda documentos, identificaciones ni cuentas bancarias.', en: 'Outside CONTIGO, in the folder where your team already keeps them. CONTIGO does not store documents, IDs or bank accounts.' },
  },

  // ------------------------------------------------------------ acceso
  {
    id: 'sign-in', topic: 'access', tracks: 'all',
    q: { es: '¿Con qué cuenta entro?', en: 'Which account do I sign in with?' },
    a: { es: 'Con tu cuenta de trabajo de Google. No hay contraseña propia de CONTIGO. Si te dice que tu cuenta todavía no tiene acceso, pídelo a quien administra CONTIGO.', en: 'With your Google work account. CONTIGO has no password of its own. If it says your account does not have access yet, ask a CONTIGO admin.' },
  },
  {
    id: 'session', topic: 'access', tracks: 'all',
    q: { es: '¿Por qué me pide entrar otra vez?', en: 'Why does it ask me to sign in again?' },
    a: { es: 'La sesión dura 12 horas. Después vuelves a entrar con Google.', en: 'A session lasts 12 hours. After that you sign in with Google again.' },
  },
  {
    id: 'who-sees-changes', topic: 'access', tracks: 'all',
    q: { es: '¿Queda registro de lo que hago?', en: 'Is there a record of what I do?' },
    a: { es: 'Sí. Los cambios de etapa, de dueño, de datos y los inicios de sesión quedan en la bitácora con tu nombre y la hora. Lo que solo consultas no se registra.', en: 'Yes. Stage, owner and data changes, and sign-ins, are logged with your name and the time. What you only look at is not logged.' },
  },
  {
    id: 'other-markets', topic: 'access', tracks: 'all',
    q: { es: '¿Veo los datos de otros mercados?', en: 'Do I see other markets\' data?' },
    a: { es: 'No, salvo que tengas un rol en ese mercado. Leadership y Administración ven todos.', en: 'No, unless you hold a role in that market. Leadership and Administration see them all.' },
  },
  {
    id: 'read-only', topic: 'access', tracks: ['lt', 'admin'],
    q: { es: '¿Qué es "Estado de CONTIGO" y qué significa "Solo lectura"?', en: 'What is "CONTIGO status" and what does "Read-only" mean?' },
    a: { es: 'Estado dice qué versión corre, qué tan al día están los datos y qué falta; lo ven Administración y Leadership, en su menú. Solo lectura: ves todo y no cambias nada.', en: 'Status shows the running version, data freshness and what is missing; Administration and Leadership see it, in their menu. Read-only: you see everything and change nothing.' },
  },
  {
    id: 'ops-scope', topic: 'access', tracks: ['ops'],
    q: { es: '¿Qué hace Operaciones en CONTIGO?', en: 'What does Operations do in CONTIGO?' },
    a: { es: 'Edita y mueve los negocios de su mercado, completa los datos de los comercios y deja notas y tareas. No crea comercios, leads ni negocios, y no cambia dueños: eso se pide a ventas o a quien lidera el mercado.', en: 'It edits and moves the deals of its market, completes merchant details and leaves notes and tasks. It does not create merchants, leads or deals, and does not change owners: ask sales or the market lead for that.' },
  },

  // ------------------------------------------------------------ administración
  {
    id: 'admin-access', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo doy acceso a alguien?', en: 'How do I give someone access?' },
    a: { es: 'Administración, "Personas y acceso", "Dar acceso": correo, nombre, rol, mercado y equipo. Administración y Leadership no llevan mercado ni equipo.', en: 'Administration, "People and access", "Grant access": email, name, role, market and team. Administration and Leadership take no market or team.' },
  },
  {
    id: 'admin-remove', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo quito un acceso y qué pasa con lo suyo?', en: 'How do I remove access and what happens to their records?' },
    a: { es: 'Toca el rol de la persona y elige "Quitar acceso". Antes de confirmar ves cuántos comercios, negocios y leads tiene. Sale de los turnos al momento; lo suyo sigue a su nombre hasta que lo reasignes en Mi equipo.', en: 'Tap the person\'s role and choose "Remove access". Before confirming you see how many merchants, deals and leads they hold. They leave the rotations right away; their records stay theirs until you reassign them in My team.' },
  },
  {
    id: 'admin-expiry', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo le pongo fecha de fin a un acceso?', en: 'How do I set an end date on access?' },
    a: { es: 'En "Dar acceso" o tocando el rol, llena "Vence el". Vale hasta el final de ese día y deja de valer solo.', en: 'In "Grant access" or by tapping the role, fill "Expires on". It works until the end of that day and stops on its own.' },
  },
  {
    id: 'admin-teams', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo creo un equipo?', en: 'How do I create a team?' },
    a: { es: 'Administración, "Personas y acceso", "Nuevo equipo": nombre, mercado y tipo de venta. Luego, al dar acceso, eliges el equipo. Quien tiene rol de supervisión en un equipo ve lo de su gente.', en: 'Administration, "People and access", "New team": name, market and sales motion. Then, when granting access, you pick the team. Whoever holds the supervisor role on a team sees their people\'s records.' },
  },
  {
    id: 'admin-rotation-empty', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Qué pasa si en un turno no queda nadie?', en: 'What if nobody is left in a rotation?' },
    a: { es: 'El lead va al respaldo; si no hay, queda sin dueño y lo ve quien vende en ese mercado.', en: 'The lead goes to the fallback; with none, it stays unowned and that market\'s sellers see it.' },
  },
  {
    id: 'admin-win', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cambio la forma en que se gana un negocio en un embudo?', en: 'How do I change how a deal is won in a pipeline?' },
    a: { es: 'Administración, "Embudos y campos". En cada embudo, marca o quita "Se gana con la primera transacción" y toca "Guardar". Sin marcar, se gana a mano. El cambio queda en la bitácora.', en: 'Administration, "Pipelines and fields". On each pipeline, tick or untick "Won by the first transaction" and tap "Save". Unticked, it is won by hand. The change is logged.' },
  },
  {
    id: 'admin-stage', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cambio el nombre o los días de una etapa?', en: 'How do I rename a stage or change its days?' },
    a: { es: 'Administración, "Embudos y campos", "Editar" en la fila de la etapa.', en: 'Administration, "Pipelines and fields", "Edit" on the stage row.' },
  },
  {
    id: 'admin-merge', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo fusiono dos comercios duplicados?', en: 'How do I merge two duplicate merchants?' },
    a: { es: 'Administración, "Calidad de datos", "Posibles duplicados", "Fusionar". Todo pasa al comercio que se queda y el otro se archiva. Nada se borra.', en: 'Administration, "Data quality", "Possible duplicates", "Merge". Everything moves to the surviving merchant and the other is archived. Nothing is deleted.' },
  },
  {
    id: 'admin-audit', topic: 'admin', tracks: ['admin', 'lead', 'lt'],
    q: { es: '¿Cómo leo la bitácora?', en: 'How do I read the audit log?' },
    a: { es: 'Cada fila dice cuándo, quién, qué hizo y sobre qué. Las horas están en tu zona, escrita arriba. Filtra por persona, tipo, registro o fechas y abre "Ver el antes y el después".', en: 'Each row says when, who, what and on which record. Times are in your zone, written above. Filter by person, kind, record or dates and open "See before and after".' },
  },
  {
    id: 'admin-reports', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Dónde veo lo que el equipo reporta?', en: 'Where do I see what the team reports?' },
    a: { es: 'Administración, "Reportes". Cada reporte trae quién lo mandó, desde qué pantalla y qué tan urgente es. Escribe tu respuesta y toca "Responder y marcar atendido": la persona la ve en "Reportar un problema".', en: 'Administration, "Reports". Each report shows who sent it, from which screen and how urgent it is. Write your answer and tap "Answer and mark handled": the person sees it under "Report a problem".' },
  },

  // ------------------------------------------------------------ lo que no hace todavía
  {
    id: 'no-sales-app', topic: 'limits', tracks: 'all',
    q: { es: '¿Las visitas llegan solas desde la Sales App?', en: 'Do visits come in on their own from the Sales App?' },
    a: { es: 'Todavía no: la Sales App no está conectada. Mientras tanto, cada visita se registra a mano en CONTIGO.', en: 'Not yet: the Sales App is not connected. Until then, each visit is logged by hand in CONTIGO.' },
  },
  {
    id: 'no-offline', topic: 'limits', tracks: 'all',
    q: { es: '¿Puedo trabajar o leer sin conexión?', en: 'Can I work or read offline?' },
    a: { es: 'No. Sin señal solo puedes leer lo que ya está en pantalla. No se guarda nada ni se abre otra pantalla hasta que vuelva la señal.', en: 'No. With no signal you can only read what is already on screen. Nothing is saved and no other screen opens until the signal returns.' },
  },
  {
    id: 'no-files', topic: 'limits', tracks: 'all',
    q: { es: '¿Puedo adjuntar fotos, contratos o evidencia?', en: 'Can I attach photos, contracts or evidence?' },
    a: { es: 'No. CONTIGO no guarda fotos ni archivos. Deja lo importante en una nota y el archivo donde tu equipo ya lo guarda.', en: 'No. CONTIGO does not store photos or files. Leave what matters in a note and the file where your team already keeps it.' },
  },
  {
    id: 'no-email', topic: 'limits', tracks: 'all',
    q: { es: '¿CONTIGO me avisa por correo cuando me cae algo?', en: 'Does CONTIGO email me when something lands on me?' },
    a: { es: 'No. No manda correos ni avisos al teléfono. Lo que te toca aparece en Hoy y en Leads cuando abres CONTIGO.', en: 'No. It sends no emails and no phone alerts. What is yours shows up in Today and in Leads when you open CONTIGO.' },
  },
  {
    id: 'no-mail-calendar', topic: 'limits', tracks: 'all',
    q: { es: '¿Puedo mandar correos o ver mi calendario desde aquí?', en: 'Can I send email or see my calendar from here?' },
    a: { es: 'No. El correo y el calendario siguen en tus herramientas de siempre.', en: 'No. Email and calendar stay in the tools you already use.' },
  },
  {
    id: 'no-routes', topic: 'limits', tracks: SELL,
    q: { es: '¿Dónde veo la ruta del día o hago check-in con ubicación?', en: 'Where do I see the day\'s route or check in with location?' },
    a: { es: 'CONTIGO no arma rutas ni registra ubicación. Aquí llevas el comercio, el negocio y el seguimiento.', en: 'CONTIGO does not build routes or record location. Here you keep the merchant, the deal and the follow-up.' },
  },
  {
    id: 'no-map', topic: 'limits', tracks: 'all',
    q: { es: '¿Dónde está el mapa de comercios?', en: 'Where is the merchants map?' },
    a: { es: 'Todavía no existe. En Comercios puedes filtrar por plaza o territorio y, en cada ficha con dirección, abrir "Cómo llegar".', en: 'It does not exist yet. In Merchants you can filter by place or territory and, on each record with an address, open "Directions".' },
  },

  // ------------------------------------------------------------ reportar un problema
  {
    id: 'report-problem', topic: 'support', tracks: 'all',
    q: { es: '¿Dónde reporto un problema o pido algo?', en: 'Where do I report a problem or ask for something?' },
    a: { es: 'En tu menú, "Reportar un problema". Escribe qué pasó y qué tan urgente es; la pantalla donde estabas se llena sola. Lo recibe administración.', en: 'In your menu, "Report a problem". Write what happened and how urgent it is; the screen you were on fills in by itself. Administration receives it.' },
  },
  {
    id: 'report-answer', topic: 'support', tracks: 'all',
    q: { es: '¿Cómo sé si ya atendieron mi reporte?', en: 'How do I know my report was handled?' },
    a: { es: 'Vuelve a "Reportar un problema": abajo están tus reportes, y el que ya se atendió trae la respuesta. CONTIGO no manda aviso, así que revísalo ahí.', en: 'Go back to "Report a problem": your reports are listed below, and a handled one shows the answer. CONTIGO sends no notice, so check it there.' },
  },
  {
    id: 'report-what', topic: 'support', tracks: 'all',
    q: { es: '¿Qué pongo en un reporte?', en: 'What do I put in a report?' },
    a: { es: 'Qué intentabas hacer, qué pasó y con qué comercio o negocio, por su nombre. No pegues tarjetas, cuentas bancarias ni contraseñas: CONTIGO no las guarda.', en: 'What you were trying to do, what happened and with which merchant or deal, by name. Do not paste cards, bank accounts or passwords: CONTIGO does not store them.' },
  },
  {
    id: 'who-to-ask', topic: 'support', tracks: 'all',
    q: { es: '¿A quién acudo?', en: 'Who do I go to?' },
    a: { es: 'Para dudas de uso, esta Ayuda. Para un acceso, quien administra CONTIGO. Para algo que falla o que hace falta, "Reportar un problema". Para tu cartera o un comercio que no ves, tu supervisor.', en: 'For how-to questions, this Help. For access, a CONTIGO admin. For something broken or missing, "Report a problem". For your book or a merchant you cannot see, your supervisor.' },
  },
]

// ---------------------------------------------------------------- capacitación
// Qué tiene que saber hacer cada rol el día uno y la primera semana. Sale de las necesidades de capacitación del comité 2.
// Sin fechas ni instructores: no existen todavía.
export type Training = { day1: L[]; week1: L[] }

export const TRAINING: Record<Track, Training> = {
  rep: {
    day1: [
      { es: 'Leer Hoy: Ahora, Vencido, Hoy y Sugerido. La lista ya viene armada.', en: 'Read Today: Now, Overdue, Today and Suggested. The list comes ready.' },
      { es: 'Completar una tarea y dejar el próximo paso con fecha.', en: 'Complete a task and leave the next step with a date.' },
      { es: 'Buscar un comercio por nombre o teléfono antes de crearlo, y leer su ficha: hilo, árbol y datos.', en: 'Search a merchant by name or phone before adding it, and read its record: thread, tree and details.' },
      { es: 'Llamar a un lead desde Leads y registrar cómo te fue: un intento no es un contacto.', en: 'Call a lead from Leads and log how it went: an attempt is not a contact.' },
      { es: 'Registrar una visita con cómo te fue y quién visitó.', en: 'Log a visit with how it went and who visited.' },
    ],
    week1: [
      { es: 'Mover un negocio de etapa y resolver lo que la etapa pide: quién decide y próximo paso.', en: 'Move a deal to its next stage and resolve what the stage asks for: who decides and a next step.' },
      { es: 'Registrar a quien atiende y a quien decide como contactos distintos.', en: 'Record the clerk and the decision-maker as separate contacts.' },
      { es: 'Trabajar los leads importados: llamar los que valen y descartar el resto con su motivo.', en: 'Work the imported leads: call the ones worth it and disqualify the rest with a reason.' },
      { es: 'Cerrar un negocio que no avanza con "Marcar como perdido" y su motivo.', en: 'Close a deal that is not moving with "Mark as lost" and its reason.' },
      { es: 'Saber qué ves y qué no: lo tuyo y lo que no tiene dueño. Lo demás se pide a supervisión.', en: 'Know what you see and what you do not: your own records and the unowned ones. The rest goes through your supervisor.' },
      { es: 'Saber qué no hace CONTIGO todavía: rutas, ubicación, fotos, correo y trabajo sin conexión.', en: 'Know what CONTIGO does not do yet: routes, location, photos, email and offline work.' },
    ],
  },
  supervisor: {
    day1: [
      { es: 'Las dos vistas de equipo: Hoy, "Mi equipo" (quién necesita apoyo ahora) y Mi equipo en el menú (tabla y avisos).', en: 'The two team views: Today, "My team" (who needs support now) and My team in the menu (table and alerts).' },
      { es: 'Leer las columnas: "Primer intento a tiempo" contra "Contacto logrado", "Sin próximo paso" y "Revisitas".', en: 'Read the columns: "First attempt on time" versus "Reached", "No next step" and "Revisits".' },
      { es: 'Reasignar un lead y un comercio, y saber qué se va con el comercio.', en: 'Reassign a lead and a merchant, and know what moves with the merchant.' },
      { es: 'Trabajar tu propia cartera en "Yo" y cambiar a "Mi equipo".', en: 'Work your own book under "Me" and switch to "My team".' },
    ],
    week1: [
      { es: 'Repartir en bloque: por plaza o territorio desde Comercios y una cartera desde Mi equipo.', en: 'Distribute in bulk: by place or territory from Merchants and a whole book from My team.' },
      { es: 'La cola de excepciones: qué abre cada aviso, que se cierran solos y cuándo usar "Descartar".', en: 'The exception queue: what opens each item, that they close on their own and when to use "Dismiss".' },
      { es: 'Usar el tablero de Negocios como agenda de tu revisión semanal.', en: 'Use the Deals board as the agenda for your weekly review.' },
      { es: 'Exigir el próximo paso sin que se llene de fechas de relleno.', en: 'Hold the team to the next step without it filling up with filler dates.' },
      { es: 'La regla del piloto: los tres embudos de primera transacción se ganan a mano.', en: 'The pilot rule: the three first-transaction pipelines are won by hand.' },
      { es: 'Qué no ve tu rol (Panel del LT, configuración) y a quién pedirlo.', en: 'What your role does not see (Leadership panel, configuration) and who to ask.' },
    ],
  },
  lead: {
    day1: [
      { es: 'Dónde están tus pantallas: en tu menú, Mi equipo, Panel del LT y Administración (Embudos y campos, Auditoría).', en: 'Where your screens are: in your menu, My team, Leadership panel and Administration (Pipelines and fields, Audit).' },
      { es: 'Leer el panel: qué cuenta como ganado y la diferencia entre "Primer intento a tiempo" y "Contacto logrado".', en: 'Read the panel: what counts as won and the difference between "First attempt on time" and "Reached".' },
      { es: 'El tablero de Negocios: elegir el embudo y filtrar "Sin próximo paso".', en: 'The Deals board: pick the pipeline and filter "No next step".' },
      { es: 'Reasignar un lead y un comercio.', en: 'Reassign a lead and a merchant.' },
    ],
    week1: [
      { es: 'Repartir lo que no tiene dueño vigente, por plaza o territorio, y una cartera completa.', en: 'Distribute what has no current owner, by place or territory, and a whole book.' },
      { es: 'Leer Mi equipo y decidir qué hacer con cada aviso: atender, reasignar o descartar.', en: 'Read My team and decide what to do with each item: handle, reassign or dismiss.' },
      { es: 'La regla del piloto: quién marca ganado a mano y dónde queda registrado.', en: 'The pilot rule: who marks a deal won by hand and where it is logged.' },
      { es: 'Qué pide cada etapa y dónde se ve (Administración, Embudos y campos).', en: 'What each stage asks for and where to see it (Administration, Pipelines and fields).' },
      { es: 'Cómo se pide un cambio de etapa, campo o turno: lo hace administración y queda en la bitácora.', en: 'How to ask for a stage, field or rotation change: an admin does it and it is logged.' },
      { es: 'Qué cifras dependen de conexiones que todavía no existen (Sales App y datos de ventas).', en: 'Which figures depend on connections that do not exist yet (Sales App and sales data).' },
    ],
  },
  ops: {
    day1: [
      { es: 'Encontrar tu trabajo en el tablero de Negocios: el embudo, tus etapas y los días en etapa.', en: 'Find your work on the Deals board: the pipeline, your stages and the days in stage.' },
      { es: 'Leer la historia de un negocio antes de tocarlo y dejar tu nota en el mismo lugar.', en: 'Read a deal\'s history before touching it and leave your note in the same place.' },
      { es: 'Mover un negocio de etapa y regresarlo una etapa, con el motivo en una nota.', en: 'Move a deal forward and send it back a stage, with the reason in a note.' },
      { es: 'Agendar tus propias tareas con fecha para que aparezcan en Hoy.', en: 'Schedule your own dated tasks so they show in Today.' },
    ],
    week1: [
      { es: 'Completar los datos del comercio: teléfono, dirección, contactos y campos adicionales.', en: 'Complete merchant details: phone, address, contacts and additional fields.' },
      { es: 'Qué no se escribe en CONTIGO: documentos, tarjetas, cuentas bancarias y contraseñas.', en: 'What is not written in CONTIGO: documents, cards, bank accounts and passwords.' },
      { es: 'Qué puede y qué no puede hacer Operaciones, y a quién pedir lo demás.', en: 'What Operations can and cannot do, and who to ask for the rest.' },
      { es: 'La regla del piloto para marcar ganado a mano.', en: 'The pilot rule for marking a deal won by hand.' },
    ],
  },
  lt: {
    day1: [
      { es: 'Dónde está tu panel: en tu menú, Panel del LT.', en: 'Where your panel is: in your menu, Leadership panel.' },
      { es: 'Tres definiciones: ganado es primera transacción y no firma; intento no es contacto; la salud del comercio viene de los datos de ventas.', en: 'Three definitions: won means first transaction, not signing; an attempt is not a contact; merchant health comes from the sales data.' },
      { es: 'Qué puede tu rol: ver todo, cambiar nada.', en: 'What your role can do: see everything, change nothing.' },
    ],
    week1: [
      { es: 'Leer Mi equipo por mercado, con su cola de excepciones.', en: 'Read My team by market, with its exception queue.' },
      { es: 'Qué depende de conexiones que todavía no existen y cómo se ve una cifra sin conectar.', en: 'What depends on connections that do not exist yet and what an unconnected figure looks like.' },
      { es: 'Leer la bitácora: quién cambió qué y cuándo.', en: 'Read the audit log: who changed what and when.' },
      { es: 'Por dónde pedir una cifra nueva: "Reportar un problema", con la opción de pedir algo.', en: 'Where to ask for a new figure: "Report a problem", with the option to ask for something.' },
    ],
  },
  admin: {
    day1: [
      { es: 'El modelo de acceso: un acceso es rol, mercado y equipo. Qué ve y qué cambia cada rol.', en: 'The access model: an access is role, market and team. What each role sees and changes.' },
      { es: 'Dar acceso, ponerle fecha de fin y quitarlo.', en: 'Grant access, set an end date and remove it.' },
      { es: 'La rutina de baja: quitar el acceso, revisar los turnos y repartir la cartera.', en: 'The offboarding routine: remove access, check the rotations and distribute the book.' },
      { es: 'Responder los reportes del equipo en la pestaña Reportes.', en: 'Answer the team\'s reports in the Reports tab.' },
    ],
    week1: [
      { es: 'Turnos de leads: cómo rota, qué es el respaldo y qué mide el reloj de primer contacto.', en: 'Lead rotations: how they rotate, what the fallback is and what the first-contact clock measures.' },
      { es: 'La regla de cierre por embudo: primera transacción o a mano, y la regla del piloto.', en: 'The closing rule per pipeline: first transaction or by hand, and the pilot rule.' },
      { es: 'Calidad de datos: registros sin dueño por mercado y fusionar duplicados.', en: 'Data quality: unowned records per market and merging duplicates.' },
      { es: 'La pestaña Pipedrive: qué no se trajo y cómo leer "No cargados".', en: 'The Pipedrive tab: what was not brought over and how to read "Not loaded".' },
      { es: 'Leer la bitácora con sus filtros y Estado de CONTIGO.', en: 'Read the audit log with its filters, and CONTIGO status.' },
      { es: 'Qué no hace CONTIGO todavía, para responderle al equipo sin prometer.', en: 'What CONTIGO does not do yet, so you can answer the team without promising.' },
    ],
  },
}

// ---------------------------------------------------------------- entrada (landing)
export const LANDING = {
  nav: [
    { href: '#como', label: { es: 'Cómo funciona', en: 'How it works' } },
    { href: '#roles', label: { es: 'Por rol', en: 'By role' } },
    { href: '#estado', label: { es: 'Qué ya funciona', en: 'What works today' } },
    { href: '#preguntas', label: { es: 'Preguntas', en: 'Questions' } },
  ],
  hero: {
    eyebrow: { es: 'El CRM de axexo', en: 'axexo\'s CRM' },
    title: { es: 'Cada comercio, con su próximo paso.', en: 'Every merchant, with its next step.' },
    sub: {
      es: 'Leads, negocios y comercios de todos los mercados en un solo lugar. Entras y ya sabes a quién llamar, qué quedó pendiente y qué negocio se está enfriando.',
      en: 'Leads, deals and merchants from every market in one place. You sign in and already know who to call, what is pending and which deal is going cold.',
    },
    secondary: { es: 'Ver cómo funciona', en: 'See how it works' },
    // El hilo de un comercio de ejemplo: lo hecho y, al final, su próximo paso.
    thread: [
      { when: { es: 'Ayer', en: 'Yesterday' }, what: { es: 'Llamada: no contestó', en: 'Call: no answer' }, done: true },
      { when: { es: 'Hoy', en: 'Today' }, what: { es: 'Llamada: contactado', en: 'Call: reached' }, done: true },
      { when: { es: 'Mañana', en: 'Tomorrow' }, what: { es: 'Enviar propuesta', en: 'Send proposal' }, done: false },
    ],
  },
  day: {
    eyebrow: { es: 'Tu día', en: 'Your day' },
    title: { es: 'Tres toques y sigues con el siguiente.', en: 'Three taps and on to the next one.' },
    steps: [
      { title: { es: 'Abres Hoy', en: 'Open Today' }, text: { es: 'Tu cola ya está ordenada: lo vencido, lo de hoy y cinco sugerencias.', en: 'Your queue is already sorted: overdue, today and five suggestions.' } },
      { title: { es: 'Llamas y dices cómo te fue', en: 'Call and say how it went' }, text: { es: 'Contactado, no contestó o llamar después. Un toque.', en: 'Reached, no answer or call later. One tap.' } },
      { title: { es: 'Dejas el próximo paso', en: 'Leave the next step' }, text: { es: 'Con fecha. Mañana aparece solo en tu cola.', en: 'With a date. Tomorrow it shows up in your queue on its own.' } },
    ],
  },
  roles: {
    eyebrow: { es: 'Hecho para cada quien', en: 'Built for each of you' },
    title: { es: 'Cada rol ve lo que necesita para su trabajo.', en: 'Each role sees what it needs to do its job.' },
    cards: [
      { track: 'rep' as Track, points: [{ es: 'Tu día ya ordenado, en el teléfono y sin instalar nada', en: 'Your day already sorted, on your phone and with nothing to install' }, { es: 'Buscas el comercio por nombre o teléfono antes de entrar', en: 'You search the merchant by name or phone before walking in' }, { es: 'Llamas, escribes por WhatsApp y registras la visita desde la ficha', en: 'You call, message on WhatsApp and log the visit from the record' }] },
      { track: 'supervisor' as Track, points: [{ es: 'Una fila por persona de tu equipo', en: 'One row per person on your team' }, { es: 'Repartes leads y comercios, uno o por territorio', en: 'You hand out leads and merchants, one by one or by territory' }, { es: 'Ves quién va tarde y qué negocio no tiene próximo paso', en: 'You see who is late and which deal has no next step' }] },
      { track: 'lead' as Track, points: [{ es: 'Todo tu mercado: embudos, equipos y cartera', en: 'Your whole market: pipelines, teams and book' }, { es: 'Lo que quedó sin dueño vigente, listo para repartir', en: 'What was left with no current owner, ready to distribute' }, { es: 'El Panel del LT de tu mercado', en: 'The Leadership panel for your market' }] },
      { track: 'ops' as Track, points: [{ es: 'La misma ficha que ve ventas: lo anotado no se repite', en: 'The same record sales sees: nothing gets written twice' }, { es: 'Editas el negocio y lo mueves hasta el final', en: 'You edit the deal and move it to the end' }, { es: 'Cada cambio de etapa queda con nombre y hora', en: 'Every stage change is saved with a name and a time' }] },
      { track: 'lt' as Track, points: [{ es: 'Todos los mercados, en solo lectura', en: 'Every market, read-only' }, { es: 'Embudo, respuesta a leads y comercios en riesgo', en: 'Pipeline, lead response and merchants at risk' }, { es: 'Sin pedir reportes a nadie', en: 'Without asking anyone for reports' }] },
      { track: 'admin' as Track, points: [{ es: 'Accesos por rol, con mercado, equipo y fecha de fin', en: 'Access by role, with market, team and end date' }, { es: 'Embudos, turnos de leads, territorios y calidad de datos', en: 'Pipelines, lead rotations, territories and data quality' }, { es: 'Bitácora de cada cambio y reportes del equipo', en: 'An audit log of every change and the team\'s reports' }] },
    ],
  },
  status: {
    eyebrow: { es: 'Sin sorpresas', en: 'No surprises' },
    title: { es: 'Qué ya funciona y qué todavía no.', en: 'What works today and what does not yet.' },
    text: {
      es: 'Estás entrando a un piloto. Esto es lo que ya puedes usar y lo que CONTIGO todavía no hace, dicho de frente.',
      en: 'You are joining a pilot. This is what you can use already and what CONTIGO does not do yet, said plainly.',
    },
    rows: [
      { label: { es: 'Hoy, leads, negocios y comercios', en: 'Today, leads, deals and merchants' }, state: 'on' as const },
      { label: { es: 'Datos de Pipedrive de US y de México', en: 'Pipedrive data for the US and Mexico' }, state: 'on' as const },
      { label: { es: 'Visitas registradas a mano y reparto de cartera por territorio', en: 'Visits logged by hand and book distribution by territory' }, state: 'on' as const },
      { label: { es: 'Visitas automáticas desde la Sales App', en: 'Automatic visits from the Sales App' }, state: 'soon' as const },
      { label: { es: 'Primera venta de cada comercio desde los datos de ventas', en: 'Each merchant\'s first sale from the sales data' }, state: 'soon' as const },
      { label: { es: 'Trabajo sin conexión, fotos o archivos adjuntos y avisos por correo', en: 'Offline work, photo or file attachments and email notices' }, state: 'soon' as const },
    ],
    on: { es: 'Funcionando', en: 'Working' },
    soon: { es: 'Todavía no', en: 'Not yet' },
  },
  facts: {
    title: { es: 'Pensado para que no se te quede nada.', en: 'Built so nothing slips.' },
    cards: [
      { figure: '5', title: { es: 'sugerencias al día', en: 'suggestions a day' }, text: { es: 'Las más importantes primero, una por comercio. Una cola que se puede terminar.', en: 'Most important first, one per merchant. A queue you can finish.' } },
      { figure: '1', title: { es: 'próximo paso por negocio', en: 'next step per deal' }, text: { es: 'Con fecha. Un negocio abierto sin próximo paso se marca en ámbar.', en: 'With a date. An open deal with no next step turns amber.' } },
      { figure: '2', title: { es: 'idiomas', en: 'languages' }, text: { es: 'Español e inglés. Abre en el idioma de tu navegador y lo cambias cuando quieras.', en: 'Spanish and English. It opens in your browser\'s language and you switch whenever you like.' } },
      { figure: '0', title: { es: 'licencias por usuario', en: 'per-user licenses' }, text: { es: 'Es de axexo: sumar a alguien al equipo no cuesta una licencia más.', en: 'It belongs to axexo: adding someone to the team does not cost another license.' } },
    ],
  },
  demo: {
    tag: { es: 'Demo en vivo. Tócala.', en: 'Live demo. Tap it.' },
    label: { es: 'Demo de la cola de Hoy, con comercios de ejemplo', en: 'Demo of the Today queue, with example merchants' },
    screen: { es: 'Hoy', en: 'Today' },
    pending: { es: '{n} pendientes', en: '{n} to do' },
    pendingOne: { es: '1 pendiente', en: '1 to do' },
    now: { es: 'Ahora', en: 'Now' },
    later: { es: 'Después', en: 'Up next' },
    complete: { es: 'Completar', en: 'Complete' },
    completeOf: { es: 'Completar: {title}', en: 'Complete: {title}' },
    result: { es: '¿Cómo te fue?', en: 'How did it go?' },
    next: { es: '¿Qué sigue?', en: 'What is next?' },
    save: { es: 'Guardar y programar', en: 'Save and schedule' },
    cancel: { es: 'Cancelar', en: 'Cancel' },
    results: [
      { es: 'Contactado', en: 'Reached' },
      { es: 'No contestó', en: 'No answer' },
      { es: 'Llamar después', en: 'Call later' },
    ],
    nexts: [
      { es: 'Llamar', en: 'Call' },
      { es: 'Enviar propuesta', en: 'Send proposal' },
      { es: 'Reunión', en: 'Meeting' },
    ],
    toast: { es: 'Hecho. Próximo paso: {next}, mañana.', en: 'Done. Next step: {next}, tomorrow.' },
    clock: { es: 'Primer contacto vence en {time}', en: 'First contact due in {time}' },
    items: [
      { title: { es: 'Llamar a Abarrotes La Esquina', en: 'Call Corner Market' }, context: { es: 'Lead nuevo del formulario web', en: 'New lead from the web form' }, chip: { es: 'Lead nuevo', en: 'New lead' }, tone: 'clock' as const },
      { title: { es: 'Enviar propuesta a Miscelánea Don Beto', en: 'Send proposal to Sunrise Wireless' }, context: { es: 'Negocio en Interés del decisor', en: 'Deal in Decision-maker interested' }, chip: { es: 'Vencido', en: 'Overdue' }, tone: 'late' as const },
      { title: { es: 'Confirmar visita con Súper El Mirador', en: 'Confirm visit with Bayview Grocery' }, context: { es: 'Negocio en Alta iniciada', en: 'Deal in Enrollment started' }, chip: { es: 'Hoy 11:00', en: 'Today 11:00' }, tone: 'today' as const },
      { title: { es: 'Recargas El Sol no tiene próximo paso', en: 'Main Street Cellular has no next step' }, context: { es: 'Negocio en Tienda visitada', en: 'Deal in Store visited' }, chip: { es: 'Sugerido', en: 'Suggested' }, tone: 'suggested' as const },
    ],
    empty: { title: { es: 'Todo al día', en: 'All caught up' }, text: { es: 'Cada comercio quedó con su próximo paso.', en: 'Every merchant has its next step.' } },
    again: { es: 'Volver a empezar', en: 'Start over' },
    pause: { es: 'Pausar la demo', en: 'Pause the demo' },
    play: { es: 'Reproducir la demo', en: 'Play the demo' },
    note: { es: 'Comercios de ejemplo', en: 'Example merchants' },
  },
  ribbon: {
    label: { es: 'Lo que ya funciona', en: 'What works today' },
    pause: { es: 'Pausar la cinta', en: 'Pause the ticker' },
    play: { es: 'Mover la cinta', en: 'Play the ticker' },
    items: [
      { es: 'Cola de Hoy', en: 'Today queue' },
      { es: 'Leads con reloj', en: 'Leads with a clock' },
      { es: 'Tablero de negocios', en: 'Deals board' },
      { es: 'Ficha del comercio', en: 'Merchant record' },
      { es: 'Árbol de la cadena', en: 'Chain tree' },
      { es: 'Llamada y WhatsApp desde la ficha', en: 'Call and WhatsApp from the record' },
      { es: 'Visitas con quién visitó', en: 'Visits with who visited' },
      { es: 'Reparto por plaza o territorio', en: 'Distribution by place or territory' },
      { es: 'Mi equipo', en: 'My team' },
      { es: 'Panel del LT', en: 'Leadership panel' },
      { es: 'Bitácora de cambios', en: 'Audit log' },
      { es: 'Español e inglés', en: 'Spanish and English' },
      { es: 'Teléfono, tablet y escritorio', en: 'Phone, tablet and desktop' },
    ],
  },
  tour: {
    eyebrow: { es: 'El producto', en: 'The product' },
    title: { es: 'Míralo por dentro.', en: 'See it from the inside.' },
    note: { es: 'Pantallas reales de CONTIGO, con datos de prueba.', en: 'Real CONTIGO screens, with test data.' },
    tabs: { es: 'Pantallas de CONTIGO', en: 'CONTIGO screens' },
    pause: { es: 'Pausar el recorrido', en: 'Pause the tour' },
    play: { es: 'Reproducir el recorrido', en: 'Play the tour' },
    screens: [
      { shot: 'hoy' as Shot, label: { es: 'Hoy', en: 'Today' }, caption: { es: 'Tu cola del día, con lo más urgente arriba.', en: 'Your queue for the day, most urgent on top.' } },
      { shot: 'leads' as Shot, label: { es: 'Leads', en: 'Leads' }, caption: { es: 'Cada lead nuevo trae su reloj de primer contacto.', en: 'Every new lead carries its first-contact clock.' } },
      { shot: 'negocios' as Shot, label: { es: 'Negocios', en: 'Deals' }, caption: { es: 'Una columna por etapa, y cada tarjeta con su próximo paso.', en: 'One column per stage, and every card with its next step.' } },
      { shot: 'comercio' as Shot, label: { es: 'Comercios', en: 'Merchants' }, caption: { es: 'La ficha junta el hilo, el árbol de la cadena y los datos.', en: 'The record gathers the thread, the chain tree and the details.' } },
      { shot: 'equipo' as Shot, label: { es: 'Mi equipo', en: 'My team' }, caption: { es: 'Una fila por persona: quién va al día y quién va tarde.', en: 'One row per person: who is on track and who is late.' } },
      { shot: 'panel' as Shot, label: { es: 'Panel del LT', en: 'Leadership panel' }, caption: { es: 'Cada mercado, del lead al negocio ganado. Las ventas se sumarán cuando se conecten los datos de ventas.', en: 'Each market, from lead to won deal. Sales will be added once the sales data is connected.' } },
    ],
  },
  moments: {
    eyebrow: { es: 'Lo que hace por ti', en: 'What it does for you' },
    title: { es: 'Menos perseguir pendientes. Más hablar con comercios.', en: 'Less chasing loose ends. More talking to merchants.' },
    cards: [
      { art: 'queue' as const, title: { es: 'Tu cola se ordena sola', en: 'Your queue sorts itself' }, text: { es: 'Primero el lead con el reloj corriendo. Luego lo vencido, lo de hoy y cinco sugerencias.', en: 'First the lead with the clock running. Then overdue, today and five suggestions.' } },
      { art: 'clock' as const, title: { es: 'Cada lead nuevo trae su reloj', en: 'Every new lead carries a clock' }, text: { es: 'Marca cuánto queda para el primer intento. Se detiene cuando registras la llamada.', en: 'It shows how long is left for the first attempt. It stops when you log the call.' } },
      { art: 'tree' as const, title: { es: 'La cadena completa, en un árbol', en: 'The whole chain, in one tree' }, text: { es: 'La cadena o el distribuidor arriba y sus tiendas abajo, con sus totales.', en: 'The chain or distributor on top and its stores below, with totals.' } },
      { art: 'stage' as const, title: { es: 'El negocio avanza con su próximo paso', en: 'The deal moves on with its next step' }, text: { es: 'Mueves la tarjeta de etapa. Si la etapa pide algo, te lo dice ahí mismo.', en: 'You move the card to the next stage. If the stage needs something, it tells you right there.' } },
    ],
  },
  numbers: {
    eyebrow: { es: 'Para quien dirige', en: 'For those who lead' },
    title: { es: 'Tu mercado, de un vistazo.', en: 'Your market at a glance.' },
    text: { es: 'Mi equipo y el Panel del LT se arman solos con lo que el equipo registra. Nadie llena un reporte.', en: 'My team and the Leadership panel build themselves from what the team logs. Nobody fills in a report.' },
    badge: { es: 'Ejemplo', en: 'Example' },
    note: { es: 'Cifras de ejemplo para mostrar cómo se ve. No son datos de axexo.', en: 'Example figures to show what it looks like. They are not axexo data.' },
    funnel: {
      title: { es: 'Negocios por etapa', en: 'Deals by stage' },
      stages: [
        { label: { es: 'Tienda visitada', en: 'Store visited' }, value: 48 },
        { label: { es: 'Interés del decisor', en: 'Decision-maker interested' }, value: 31 },
        { label: { es: 'Alta iniciada', en: 'Enrollment started' }, value: 22 },
        { label: { es: 'Esperando primera venta', en: 'Awaiting first sale' }, value: 14 },
      ],
    },
    response: {
      title: { es: 'Respuesta a leads', en: 'Lead response' },
      first: { es: 'Primer intento a tiempo', en: 'First attempt on time' },
      reached: { es: 'Contacto logrado', en: 'Reached' },
      teams: [
        { label: { es: 'Equipo Centro', en: 'Central team' }, first: 92, reached: 71 },
        { label: { es: 'Equipo Norte', en: 'North team' }, first: 81, reached: 63 },
        { label: { es: 'Equipo Sur', en: 'South team' }, first: 74, reached: 58 },
      ],
    },
    rings: [
      { label: { es: 'Negocios con próximo paso', en: 'Deals with a next step' }, value: 92 },
      { label: { es: 'Leads atendidos a tiempo', en: 'Leads answered on time' }, value: 84 },
    ],
  },
  people: {
    eyebrow: { es: 'Del otro lado', en: 'On the other side' },
    title: { es: 'Detrás de cada pendiente hay un comercio.', en: 'Behind every task there is a merchant.' },
    text: { es: 'CONTIGO existe para que ninguno se quede esperando tu llamada.', en: 'CONTIGO exists so none of them is left waiting for your call.' },
    credit: { es: 'Fotos de archivo, con fines ilustrativos.', en: 'Stock photos, for illustration only.' },
  },
  cta: {
    title: { es: 'Entra con tu cuenta de trabajo.', en: 'Sign in with your work account.' },
    text: { es: 'Con tu cuenta de Google del trabajo. La primera vez te recibe una guía corta con los primeros pasos de tu rol.', en: 'With your Google work account. The first time, a short guide welcomes you with the first steps for your role.' },
    secondary: { es: 'Leer las preguntas', en: 'Read the questions' },
  },
  faq: {
    eyebrow: { es: 'Antes de entrar', en: 'Before you sign in' },
    title: { es: '¿Tienes dudas?', en: 'Have questions?' },
    ids: ['sign-in', 'pipedrive', 'phone', 'see-what', 'visits', 'who-to-ask'],
  },
  help: {
    title: { es: 'La ayuda está adentro.', en: 'Help is inside.' },
    text: { es: 'Ya con tu sesión abierta, en tu menú encuentras la Ayuda, tus primeros pasos y "Reportar un problema". Si no puedes entrar, pídele el acceso a quien administra CONTIGO.', en: 'Once you are signed in, your menu has Help, your first steps and "Report a problem". If you cannot get in, ask a CONTIGO admin for access.' },
  },
  footer: {
    tagline: { es: 'El CRM de axexo, para todos los mercados.', en: 'axexo\'s CRM, for every market.' },
    note: { es: 'Herramienta interna de axexo. Uso exclusivo del equipo.', en: 'Internal axexo tool. For team use only.' },
  },
}

/** Qué muestra cada captura, para quien no la ve. */
export const SHOT_ALT: Record<Shot, L> = {
  hoy: { es: 'Pantalla Hoy: la tarjeta Ahora con el pendiente más urgente y, debajo, la lista de vencidos y de hoy.', en: 'Today screen: the Now card with the most urgent item and, below, the overdue and today lists.' },
  leads: { es: 'Pantalla Leads: cada lead con su reloj de primer contacto y el botón para llamar.', en: 'Leads screen: each lead with its first-contact clock and the call button.' },
  negocios: { es: 'Tablero de Negocios: una columna por etapa y, en cada tarjeta, su próximo paso.', en: 'Deals board: one column per stage and, on each card, its next step.' },
  comercio: { es: 'Ficha de un comercio: lo siguiente, los botones para llamar y escribir, y el hilo con su historia.', en: 'A merchant record: what is next, the call and message buttons, and the thread with its history.' },
  equipo: { es: 'Mi equipo: una fila por persona con sus leads, primer intento a tiempo, contacto logrado y negocios.', en: 'My team: one row per person with leads, first attempt on time, reached and deals.' },
  panel: { es: 'Panel del LT: por mercado, leads, negocios por etapa, primer intento a tiempo y contacto logrado.', en: 'Leadership panel: per market, leads, deals by stage, first attempt on time and reached.' },
  completar: { es: 'Hoja Completar: cómo te fue, qué sigue y cuándo, antes de guardar.', en: 'Complete sheet: how it went, what is next and when, before saving.' },
  admin: { es: 'Administración: sus pestañas y la lista de personas con acceso.', en: 'Admin: its tabs and the list of people with access.' },
}

/** Fotos de archivo con licencia (Adobe Stock, cuenta de axexo, 11-nov-2026). Ilustran; no retratan a personas del equipo ni a comercios de axexo. */
export type Photo = 'llamada' | 'asesor' | 'equipo' | 'mostrador' | 'retrato' | 'seguimiento' | 'calle'
export const PHOTOS: Record<Photo, { w: number; h: number; alt: L }> = {
  llamada: { w: 1400, h: 788, alt: { es: 'Una persona atiende una llamada detrás del mostrador de una panadería.', en: 'A person takes a phone call behind a bakery counter.' } },
  asesor: { w: 820, h: 1229, alt: { es: 'Una persona muestra un teléfono dentro de una tienda de tecnología.', en: 'A person holds up a phone inside a technology store.' } },
  equipo: { w: 1400, h: 933, alt: { es: 'Cinco personas revisan juntas una laptop sobre una mesa.', en: 'Five people look at a laptop together at a table.' } },
  mostrador: { w: 1400, h: 933, alt: { es: 'Una persona sonríe mientras cobra en el mostrador de una tienda.', en: 'A person smiles while ringing up a sale at a store counter.' } },
  retrato: { w: 1400, h: 933, alt: { es: 'Una persona con delantal sonríe dentro de su tienda.', en: 'A person in an apron smiles inside their store.' } },
  seguimiento: { w: 1000, h: 1140, alt: { es: 'Una persona habla por teléfono y toma nota sobre un mostrador.', en: 'A person talks on the phone and takes notes at a counter.' } },
  calle: { w: 1400, h: 1050, alt: { es: 'Una persona de pie en la calle sonríe mientras mira su teléfono, con un edificio de ladrillo al fondo.', en: 'A person standing on a street smiles while looking at their phone, with a brick building behind.' } },
}
