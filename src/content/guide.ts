// Contenido de la entrada (landing), del primer ingreso y de la ayuda. Un solo lugar, en español y en inglés.
// Las preguntas, los pasos y la capacitación salen de los dos comités con los perfiles reales del equipo (el segundo, el 11-nov-2026).
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
// Los pasos salen de los "pasos de primer ingreso" del comité 2 (11-nov-2026), revisados contra cada pantalla
// con las funciones de la ola 2 ya integradas (conversión, cola de Operaciones, negocios cerrados, reparto, tasa).
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
      es: 'Un lead nuevo trae su meta de primer contacto. Llamar desde aquí deja el intento registrado. Si está sin asignar, "Tomar y llamar" lo deja a tu nombre.',
      en: 'A new lead carries its first-contact goal. Calling from here logs the attempt. If it has no owner, "Take and call" makes it yours.',
    },
    href: '/leads',
    cta: GO.leads,
  },
  convert: {
    key: 'convert',
    title: { es: 'Convierte un lead calificado en comercio y negocio', en: 'Convert a qualified lead into a merchant and a deal' },
    why: {
      es: 'En el lead, "Calificar" y luego "Convertir en comercio y negocio": eliges el embudo y confirmas el tipo de cuenta. Sus notas y llamadas pasan al hilo.',
      en: 'On the lead, "Qualify" and then "Convert to merchant and deal": you pick the pipeline and confirm the account type. Its notes and calls move to the thread.',
    },
    href: '/leads',
    cta: GO.leads,
  },
  mine: {
    key: 'mine',
    title: { es: 'Abre Comercios, toca "Míos" y confirma que están tus comercios', en: 'Open Merchants, tap "Mine" and confirm your merchants are there' },
    why: {
      es: 'Si falta alguno, avisa a tu supervisor hoy: puede seguir a nombre de otra persona. Antes de crear uno, búscalo por nombre o teléfono con el buscador de arriba.',
      en: 'If one is missing, tell your supervisor today: it may still be under someone else. Before adding one, search it by name or phone with the search box at the top.',
    },
    href: '/comercios?owner=me',
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
  teamHome: {
    key: 'team',
    title: { es: 'Empieza en Mi equipo: es tu pantalla de inicio', en: 'Start in My team: it is your home screen' },
    why: {
      es: 'Todas las personas que venden en tu mercado, por equipo y con subtotal. Más abajo, "Resultados por semana" trae las últimas 8 semanas.',
      en: 'Everyone who sells in your market, by team and with a subtotal. Further down, "Results by week" covers the last 8 weeks.',
    },
    href: '/supervisor',
    cta: GO.team,
  },
  exceptions: {
    key: 'exceptions',
    title: { es: 'Atiende o descarta un aviso de Pendientes del equipo', en: 'Handle or dismiss one item in Team alerts' },
    why: {
      es: 'La lista se llena sola con lo que se salió de la regla y cada aviso se cierra solo cuando se corrige. Nadie tiene que reportar nada.',
      en: 'The queue fills itself with what broke a rule, and each item closes on its own once it is fixed. Nobody has to report anything.',
    },
    href: '/supervisor',
    cta: GO.team,
  },
  reassign: {
    key: 'reassign',
    title: { es: 'Reasigna un lead a quien cubre esa zona', en: 'Reassign a lead to whoever covers that area' },
    why: {
      es: 'Abre el lead y cambia a la persona en "Quién lo lleva". En un comercio, el enlace "Reasignar" está junto a quien lo lleva. Queda en la bitácora con tu nombre.',
      en: 'Open the lead and change the owner under "Owner". On a merchant, the "Reassign" link sits next to the owner. It is logged with your name.',
    },
    href: '/leads',
    cta: GO.leads,
  },
  distribute: {
    key: 'distribute',
    title: { es: 'Reparte la cartera que quedó por repartir', en: 'Distribute the book that has no current owner' },
    why: {
      es: 'En Mi equipo, "Por repartir" te dice cuántos hay. "Repartir comercios" los pasa por plaza o territorio; "Reasignar cartera", los leads y negocios de una persona.',
      en: 'In My team, "No current owner" tells you how many there are. "Distribute merchants" hands them out by place or territory; "Reassign book", one person\'s leads and deals.',
    },
    href: '/supervisor',
    cta: GO.team,
  },
  closed: {
    key: 'closed',
    title: { es: 'Revisa los negocios cerrados', en: 'Review the closed deals' },
    why: {
      es: 'En tu menú, "Negocios cerrados": ganados y perdidos por persona y periodo. "Exportar CSV" baja lo que tienes filtrado.',
      en: 'In your menu, "Closed deals": won and lost by person and period. "Export CSV" downloads what you have filtered.',
    },
    href: '/reportes/cerrados',
    cta: { es: 'Ir a Negocios cerrados', en: 'Go to Closed deals' },
  },
  weekly: {
    key: 'weekly',
    title: { es: 'Abre el Reporte semanal de campo', en: 'Open the weekly field report' },
    why: {
      es: 'Desde Mi equipo, "Reporte de campo": puntos de venta dados de alta y negocios ganados por semana, por territorio o plaza, y visitas por persona.',
      en: 'From My team, "Field report": stores enrolled and deals won by week, by territory or place, and visits by person.',
    },
    href: '/reportes/campo',
    cta: { es: 'Ir al Reporte de campo', en: 'Go to the Field report' },
  },
  panel: {
    key: 'panel',
    title: { es: 'Empieza en el Panel del LT: es tu pantalla de inicio', en: 'Start in the Leadership panel: it is your home screen' },
    why: {
      es: 'Arriba eliges el periodo. Debajo de cada cifra, "Cómo se calcula" dice qué cuenta, de qué fechas es y de dónde sale.',
      en: 'At the top you pick the period. Under each figure, "How it is calculated" says what it counts, which dates it covers and where it comes from.',
    },
    href: '/panel-lt',
    cta: GO.panel,
  },
  panelMenu: {
    key: 'panel',
    title: { es: 'Abre el Panel del LT desde tu menú', en: 'Open the Leadership panel from your menu' },
    why: {
      es: 'Tu mercado del lead a la primera venta, por embudo y por equipo. Debajo de cada cifra, "Cómo se calcula" dice qué cuenta y de qué fechas es.',
      en: 'Your market from lead to first sale, by pipeline and by team. Under each figure, "How it is calculated" says what it counts and which dates it covers.',
    },
    href: '/panel-lt',
    cta: GO.panel,
  },
  winRule: {
    key: 'win-rule',
    title: { es: 'Revisa cómo se gana un negocio en cada embudo', en: 'Review how a deal is won in each pipeline' },
    why: {
      es: 'En "Embudos y campos", cada embudo dice si se gana con la primera transacción o a mano. En el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola.',
      en: 'Under "Pipelines and fields", each pipeline says whether it is won by the first transaction or by hand. During the pilot a deal is won by hand; when the first transaction arrives it will be confirmed on its own.',
    },
    href: '/admin?tab=embudos',
    cta: { es: 'Ir a Embudos y campos', en: 'Go to Pipelines and fields' },
  },
  opsQueue: {
    key: 'queue',
    title: { es: 'Empieza en tu cola: es tu pantalla de inicio', en: 'Start in your queue: it is your home screen' },
    why: {
      es: 'La Cola de Operaciones junta los negocios que Ventas ya entregó, con quién vendió y qué falta. También está en tu menú y en la barra, como "Cola".',
      en: 'The Operations queue gathers the deals Sales has handed over, with who sold them and what is missing. It is also in your menu and in the bar, as "Queue".',
    },
    href: '/operaciones',
    cta: { es: 'Ir a la Cola de Operaciones', en: 'Go to the Operations queue' },
  },
  opsTake: {
    key: 'take',
    title: { es: 'Toma un negocio de la cola', en: 'Take a deal from the queue' },
    why: {
      es: '"Tomar" lo deja a tu nombre y pasa a "Míos". Desde ahí solo Operaciones lo avanza.',
      en: '"Take" puts it under your name and it moves to "Mine". From there only Operations moves it forward.',
    },
    href: '/operaciones',
    cta: { es: 'Ir a la Cola de Operaciones', en: 'Go to the Operations queue' },
  },
  opsReturn: {
    key: 'return',
    title: { es: 'Si llegó incompleto, devuélvelo con el motivo', en: 'If it came in incomplete, send it back with the reason' },
    why: {
      es: 'En el negocio, "Devolver a Ventas": eliges el motivo y escribes qué falta. Vuelve a la etapa de Ventas anterior y a quien lo vendió le aparece en Hoy.',
      en: 'On the deal, "Send back to Sales": pick the reason and write what is missing. It returns to the previous Sales stage and shows in Today for whoever sold it.',
    },
    href: '/operaciones',
    cta: { es: 'Ir a la Cola de Operaciones', en: 'Go to the Operations queue' },
  },
  opsFields: {
    key: 'ops-fields',
    title: { es: 'Llena el Merchant ID y las aprobaciones', en: 'Fill in the Merchant ID and the approvals' },
    why: {
      es: 'En el negocio, sección Operaciones: Merchant ID, "Aprobación por proveedor", Documentos (el estado y un enlace, no el archivo) y Capacitación.',
      en: 'On the deal, Operations section: Merchant ID, "Provider approval", Documents (the status and a link, not the file) and Training.',
    },
    href: '/operaciones',
    cta: { es: 'Ir a la Cola de Operaciones', en: 'Go to the Operations queue' },
  },
  opsNote: {
    key: 'ops-note',
    title: { es: 'Deja tu próximo paso y avisa con una nota', en: 'Leave your next step and notify with a note' },
    why: {
      es: '"Próximo paso de Operaciones" va aparte del de quien vende: cada quien ve el suyo en Hoy. En una nota del negocio, "Avisar a" se lo muestra a esa persona en Hoy.',
      en: '"Operations next step" is separate from the seller\'s: each person sees their own in Today. On a deal note, "Notify" shows it to that person in Today.',
    },
    href: '/hoy',
    cta: GO.today,
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
      es: 'Administración es tu pantalla de inicio y abre en "Personas y acceso". Un acceso es un rol en un mercado y, si aplica, un equipo. Una supervisión sin equipo no ve a nadie.',
      en: 'Administration is your home screen and opens on "People and access". An access is a role in a market and, where it applies, a team. A supervisor with no team sees nobody.',
    },
    href: '/admin?tab=personas',
    cta: { es: 'Ir a Personas y acceso', en: 'Go to People and access' },
  },
  rotation: {
    key: 'rotation',
    title: { es: 'Confirma los turnos de leads y el horario hábil', en: 'Confirm the lead rotations and the business hours' },
    why: {
      es: 'En "Formularios y turnos": arriba, "Horario hábil por mercado" (el reloj de primer contacto solo corre en ese horario); abajo, quién recibe los leads de cada formulario y quién es el respaldo.',
      en: 'Under "Forms and rotation": at the top, "Business hours by market" (the first-contact clock only runs during those hours); below, who receives each form\'s leads and who the fallback is.',
    },
    href: '/admin?tab=entrada',
    cta: { es: 'Ir a Formularios y turnos', en: 'Go to Forms and rotation' },
  },
  territories: {
    key: 'territories',
    title: { es: 'Revisa los territorios de cada mercado', en: 'Review each market\'s territories' },
    why: {
      es: 'En "Territorios" los creas y dices a quién le toca cada uno. A los comercios se les pone territorio desde Comercios, con "Repartir".',
      en: 'Under "Territories" you create them and say who covers each one. Merchants get their territory from Merchants, with "Distribute".',
    },
    href: '/admin?tab=territorios',
    cta: { es: 'Ir a Territorios', en: 'Go to Territories' },
  },
  fx: {
    key: 'fx',
    title: { es: 'Carga la tasa de cambio a USD', en: 'Load the exchange rate to USD' },
    why: {
      es: 'En "Embudos y campos", "Tasa de cambio a USD": moneda, fecha, valor y de dónde sale. El Panel del LT la usa para sumar mercados; si falta, no consolida y lo dice.',
      en: 'Under "Pipelines and fields", "Exchange rate to USD": currency, date, value and where it comes from. The Leadership panel uses it to add markets up; if it is missing, it does not consolidate and says so.',
    },
    href: '/admin?tab=embudos',
    cta: { es: 'Ir a Embudos y campos', en: 'Go to Pipelines and fields' },
  },
  quality: {
    key: 'quality',
    title: { es: 'Abre Calidad de datos', en: 'Open Data quality' },
    why: {
      es: 'Ahí salen los comercios, negocios y leads sin asignar por mercado y los posibles duplicados. Llévale los sin asignar a quien lidera ese mercado.',
      en: 'Merchants, deals and leads with no owner per market and possible duplicates show up there. Take the unowned ones to that market\'s lead.',
    },
    href: '/admin?tab=calidad',
    cta: { es: 'Ir a Calidad de datos', en: 'Go to Data quality' },
  },
  reports: {
    key: 'reports',
    title: { es: 'Abre Problemas reportados y responde lo que el equipo reportó', en: 'Open Reported problems and answer what the team reported' },
    why: {
      es: 'Lo que cada persona manda desde "Reportar un problema" llega ahí. Respondes, marcas atendido y la persona ve tu respuesta.',
      en: 'What each person sends from "Report a problem" lands there. You answer, mark it handled and the person sees your reply.',
    },
    href: '/admin?tab=reportes',
    cta: { es: 'Ir a Problemas reportados', en: 'Go to Reported problems' },
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

// Cada rol empieza donde aterriza al entrar (homePath en domain/policy.ts): Ventas y supervisión en Hoy, Operaciones en su cola,
// quien lidera en Mi equipo, leadership en el Panel del LT y administración en Administración.
export const STEPS: Record<Track, Step[]> = {
  rep: [S.today, S.complete, S.leads, S.convert, S.mine, S.visit, S.nostep, S.report],
  supervisor: [S.teamNow, S.team, S.exceptions, S.reassign, S.distribute, S.closed, S.complete, S.report],
  lead: [S.teamHome, S.distribute, S.weekly, S.closed, S.exceptions, S.panelMenu, S.report],
  ops: [S.opsQueue, S.opsTake, S.opsReturn, S.opsFields, S.opsNote, S.report],
  lt: [S.panel, S.closed, S.team, S.readonly, S.missing],
  admin: [S.access, S.rotation, S.territories, S.winRule, S.fx, S.quality, S.reports, S.status],
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
      { es: 'Cada lead nuevo trae una meta de primer contacto, a la vista. El reloj solo corre en horario hábil.', en: 'Every new lead carries a first-contact goal, in plain sight. The clock only runs during business hours.' },
      { es: 'No hay correo ni calendario adentro: aquí va el comercio, el negocio y su seguimiento.', en: 'There is no email or calendar inside: this is for the merchant, the deal and its follow-up.' },
    ],
    asks: [ASK.nextStep, ASK.visit, ASK.firstAttempt],
  },
  supervisor: {
    changes: [
      { es: 'Mi equipo se arma solo con lo que la gente registra: nadie te llena un reporte.', en: 'My team builds itself from what people log: nobody fills in a report for you.' },
      { es: 'Tú reasignas: un lead, un comercio o una cartera, sin pedirlo a nadie.', en: 'You move owners: a lead, a merchant or a book, without asking anyone.' },
      { es: 'Pendientes del equipo te avisa lo que se salió de la regla.', en: 'Team alerts tell you what broke a rule.' },
      { es: 'Los ganados y perdidos de tu equipo están en "Negocios cerrados" y se exportan.', en: 'Your team\'s won and lost deals are under "Closed deals" and can be exported.' },
    ],
    asks: [
      { es: 'Revisa Mi equipo cada semana con tu gente, fila por fila.', en: 'Review My team every week with your people, row by row.' },
      { es: 'Reparte lo que quedó por repartir: lo que nadie lleva, nadie lo trabaja.', en: 'Distribute what has no current owner: what nobody holds, nobody works.' },
      ASK.nextStep,
      ASK.firstAttempt,
    ],
  },
  lead: {
    changes: [
      { es: 'Ves todo tu mercado en un lugar: embudos, equipos y lo que quedó por repartir.', en: 'You see your whole market in one place: pipelines, teams and what was left with no current owner.' },
      { es: 'Un negocio cuenta como ganado con la primera transacción, no con la firma. En el piloto se gana a mano, con la fecha real de cierre.', en: 'A deal counts as won at the first transaction, not at signing. During the pilot it is won by hand, with the actual close date.' },
      { es: 'El acceso es por rol: sumar a alguien no cuesta una licencia.', en: 'Access is by role: adding someone does not cost a license.' },
    ],
    asks: [
      { es: 'Decide con tus supervisores a quién le toca lo que quedó por repartir.', en: 'Decide with your supervisors how records with no current owner are distributed.' },
      { es: 'Saca el número de la semana del Reporte de campo, en lugar de una hoja aparte.', en: 'Take the weekly number from the Field report instead of a separate sheet.' },
      ASK.nextStep,
      ASK.firstAttempt,
    ],
  },
  ops: {
    changes: [
      { es: 'Ves la misma ficha que ventas: lo que anotas ahí no hay que repetirlo en otro lado.', en: 'You see the same record as sales: what you write there does not need repeating elsewhere.' },
      { es: 'Cada cambio de etapa queda con nombre y hora.', en: 'Every stage change is saved with a name and a time.' },
      { es: 'Lo que Ventas entrega llega a tu cola: ya no lo buscas en el tablero.', en: 'What Sales hands over lands in your queue: you no longer look for it on the board.' },
      { es: 'De cada documento se guarda el estado y un enlace a dónde está, no el archivo.', en: 'For each document CONTIGO keeps the status and a link to where it is, not the file.' },
    ],
    asks: [
      { es: 'Toma lo que entra a tu cola y, si llegó incompleto, devuélvelo con el motivo.', en: 'Take what enters your queue and, if it came in incomplete, send it back with the reason.' },
      { es: 'Anota el Merchant ID y el estado de cada aprobación el mismo día en que cambia.', en: 'Record the Merchant ID and each approval status the same day it changes.' },
      { es: 'Deja tu próximo paso de Operaciones con fecha en cada negocio que llevas.', en: 'Leave your dated Operations next step on every deal you carry.' },
    ],
  },
  lt: {
    changes: [
      { es: 'Entras directo al Panel del LT y ves los mercados sin pedir un reporte, en solo lectura.', en: 'You land on the Leadership panel and see the markets without asking for a report, read-only.' },
      { es: 'Ganado es primera transacción, no firma. En el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola.', en: 'Won means first transaction, not signing. During the pilot a deal is won by hand; when the first transaction arrives it will be confirmed on its own.' },
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
      { es: 'Responde lo que el equipo reportó en la pestaña Problemas reportados.', en: 'Answer what the team reported in the Reported problems tab.' },
      { es: 'Revisa los turnos de leads cada vez que alguien entra o sale.', en: 'Check the lead rotations every time someone joins or leaves.' },
      { es: 'Mantén cargada la tasa de cambio a USD: sin ella el panel no consolida.', en: 'Keep the exchange rate to USD loaded: without it the panel does not consolidate.' },
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
      es: 'El hilo junta notas, llamadas, cambios de etapa y de quién lo lleva. El árbol muestra la cadena y sus tiendas.',
      en: 'The thread gathers notes, calls, stage and owner changes. The tree shows the chain and its stores.',
    },
    visual: { shot: 'comercio' },
  },
  deals: {
    title: { es: 'Un negocio siempre lleva próximo paso', en: 'A deal always carries a next step' },
    text: {
      es: 'En el tablero mueves la tarjeta de etapa. Si la etapa pide algo (quién decide, un dato), se abre una hoja para completarlo ahí mismo.',
      en: 'On the board you move the card to the next stage. If the stage needs something (who decides, a detail), a sheet opens to fill it in right there.',
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
    title: { es: 'Tú decides quién lleva qué', en: 'You decide who owns what' },
    text: {
      es: 'Reasignas leads y comercios de tu equipo. Los leads sin asignar los ve cualquier vendedor del mercado y los puede tomar.',
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
      es: 'De lo que el equipo registra en CONTIGO, y cada cifra trae "Cómo se calcula". Las visitas automáticas y la primera venta llegarán solas cuando se conecten la Sales App y los datos de ventas.',
      en: 'From what the team logs in CONTIGO, and each figure carries "How it is calculated". Automatic visits and the first sale will arrive on their own once the Sales App and the sales data are connected.',
    },
    visual: { shot: 'panel' },
  },
  after: {
    title: { es: 'Lo que Ventas entrega llega a tu cola', en: 'What Sales hands over lands in your queue' },
    text: {
      es: 'Entras a la Cola de Operaciones. "Tomar" deja el negocio a tu nombre; si llegó incompleto, "Devolver a Ventas" lo regresa con el motivo. No creas negocios ni trabajas leads.',
      en: 'You land on the Operations queue. "Take" puts the deal under your name; if it came in incomplete, "Send back to Sales" returns it with the reason. You do not create deals or work leads.',
    },
    visual: { shot: 'negocios' },
  },
  opsDeal: {
    title: { es: 'En el negocio, tu sección es Operaciones', en: 'On the deal, your section is Operations' },
    text: {
      es: 'Merchant ID, aprobación por proveedor, documentos (el estado y un enlace) y capacitación. Tu próximo paso va aparte del de quien vende.',
      en: 'Merchant ID, provider approval, documents (the status and a link) and training. Your next step is separate from the seller\'s.',
    },
    visual: { shot: 'negocios' },
  },
  readOnly: {
    title: { es: 'Ves todo y no cambias nada', en: 'You see everything and change nothing' },
    text: {
      es: 'Entras al Panel del LT. Tu acceso es de solo lectura en todos los mercados: los botones para crear o editar no aparecen.',
      en: 'You land on the Leadership panel. Your access is read-only across all markets: the buttons to create or edit do not appear.',
    },
    visual: { art: 'readonly' },
  },
  config: {
    title: { es: 'Administración, pestaña por pestaña', en: 'Administration, tab by tab' },
    text: {
      es: 'Personas y acceso, Territorios, Embudos y campos, Formularios y turnos, Integraciones, Pipedrive, Calidad de datos, Problemas reportados, Auditoría y Operaciones.',
      en: 'People and access, Territories, Pipelines and fields, Forms and rotation, Integrations, Pipedrive, Data quality, Reported problems, Audit and Operations.',
    },
    visual: { shot: 'admin' },
  },
  logged: {
    title: { es: 'Todo cambio queda escrito', en: 'Every change is written down' },
    text: {
      es: 'Accesos, reasignaciones, etapas y configuración quedan en la bitácora con quién, qué y cuándo. Nada se borra: se cierra con fecha.',
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
    lead: { es: 'Además de tu propia cola, ves cómo va cada persona de tu equipo y mueves lo que quedó sin asignar.', en: 'Besides your own queue, you see how each person on your team is doing and move what was left without an owner.' },
    how: [HOW.teamView, HOW.owners, HOW.queue, HOW.deals],
  },
  lead: {
    lead: { es: 'Entras a Mi equipo y tienes la vista completa de tu mercado: los embudos, los equipos y lo que todavía está por repartir.', en: 'You land on My team and have the full view of your market: the pipelines, the teams and what does not have a real owner yet.' },
    how: [HOW.market, HOW.teamView, HOW.owners, HOW.numbers],
  },
  ops: {
    lead: { es: 'Ventas firma; tú llevas el negocio desde la entrega hasta que el comercio queda operando.', en: 'Sales signs; you carry the deal from the handover until the merchant is up and running.' },
    how: [HOW.after, HOW.opsDeal, HOW.record, HOW.logged],
  },
  lt: {
    lead: { es: 'Una sola vista de los mercados para seguir el embudo sin pedir reportes.', en: 'A single view of the markets to follow the pipeline without asking for reports.' },
    how: [HOW.readOnly, HOW.numbers, HOW.teamView, HOW.logged],
  },
  admin: {
    lead: { es: 'Tú mantienes la herramienta: accesos, embudos y etapas, turnos de leads y horario hábil, territorios, la tasa de cambio, la calidad de los datos y los reportes del equipo.', en: 'You keep the tool running: access, pipelines and stages, lead rotations and business hours, territories, the exchange rate, data quality and the team\'s reports.' },
    how: [HOW.config, HOW.logged, HOW.numbers, HOW.market],
  },
}

// ---------------------------------------------------------------- ayuda
// Regla: cada respuesta describe lo que existe hoy, con el nombre exacto del botón o la pantalla.
// Pasada final (ola 3): incluye lo que entró con leads, liderazgo, operaciones y b2b, revisado contra la pantalla integrada.
export type HelpTopic = 'start' | 'today' | 'leads' | 'deals' | 'ops' | 'merchants' | 'field' | 'team' | 'numbers' | 'data' | 'access' | 'admin' | 'limits' | 'support'
export type HelpItem = { id: string; topic: HelpTopic; tracks: 'all' | Track[]; q: L; a: L }

export const HELP_TOPICS: Record<HelpTopic, L> = {
  start: { es: 'Para empezar', en: 'Getting started' },
  today: { es: 'Hoy y el próximo paso', en: 'Today and the next step' },
  leads: { es: 'Leads', en: 'Leads' },
  deals: { es: 'Negocios', en: 'Deals' },
  merchants: { es: 'Comercios', en: 'Merchants' },
  ops: { es: 'Operaciones y pedidos', en: 'Operations and orders' },
  field: { es: 'Visitas y campo', en: 'Visits and field work' },
  team: { es: 'Equipo y quién lleva qué', en: 'Team and owners' },
  numbers: { es: 'Panel, cifras y reportes', en: 'Panel, figures and reports' },
  data: { es: 'Datos, Pipedrive e integraciones', en: 'Data, Pipedrive and integrations' },
  access: { es: 'Acceso y permisos', en: 'Access and permissions' },
  admin: { es: 'Administración', en: 'Administration' },
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
    q: { es: '¿Dónde están Mi equipo, el Panel del LT, Negocios cerrados y Administración?', en: 'Where are My team, the Leadership panel, Closed deals and Administration?' },
    a: { es: 'En tu menú: tus iniciales, arriba a la derecha. Ahí aparece solo lo que tu rol puede abrir, también Negocios cerrados. Además, cada rol entra a su pantalla: Ventas y supervisión a Hoy, Operaciones a su cola, quien lidera el mercado a Mi equipo, Leadership al Panel del LT y administración a Administración.', en: 'In your menu: your initials, top right. Only what your role can open shows up there, Closed deals included. Also, each role lands on its own screen: Sales and supervisors on Today, Operations on its queue, market leads on My team, Leadership on the Leadership panel and admins on Administration.' },
  },
  {
    id: 'first-steps-back', topic: 'start', tracks: 'all',
    q: { es: 'Escondí mis primeros pasos, ¿cómo los recupero?', en: 'I hid my first steps. How do I get them back?' },
    a: { es: 'En tu menú, en "Primeros pasos". Ahí mismo puedes volver a mostrar la lista en Hoy.', en: 'In your menu, under "First steps". From there you can show the list in Today again.' },
  },
  {
    id: 'role-home', topic: 'start', tracks: 'all',
    q: { es: '¿Por qué entro a otra pantalla y no a Hoy?', en: 'Why do I land on another screen and not on Today?' },
    a: { es: 'Cada rol entra a su pantalla de trabajo: Ventas y supervisión a Hoy, Operaciones a su cola, quien lidera el mercado a Mi equipo, Leadership al Panel del LT y administración a Administración. Hoy sigue en la barra para todos.', en: 'Each role lands on its work screen: Sales and supervisors on Today, Operations on its queue, market leads on My team, Leadership on the Leadership panel and admins on Administration. Today is still in the bar for everyone.' },
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
    a: { es: 'Porque un negocio abierto sin próximo paso es un negocio que nadie está moviendo. Si de verdad no hay nada que hacer, elige "Nada más: cerrar". No se puede en dos casos: un lead que no contestó y una sugerencia. Si el cliente pidió esperar, usa "Poner en pausa" en el negocio.', en: 'Because an open deal with no next step is a deal nobody is moving. If there is truly nothing to do, choose "Nothing else: close". Two cases do not allow it: a lead that did not answer and a suggestion. If the customer asked you to wait, use "Put on hold" on the deal.' },
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
    id: 'deal-next-today', topic: 'today', tracks: WORK,
    q: { es: 'Escribí el próximo paso en el negocio. ¿Me aparece en Hoy?', en: 'I typed the next step on the deal. Does it show in Today?' },
    a: { es: 'Sí. El día que toca aparece en Hoy de quien lleva el negocio y, al completarlo, CONTIGO te pide el siguiente. El de Operaciones va aparte: en un negocio puede haber dos próximos pasos, el de quien vende y el de Operaciones, y cada quien ve el suyo.', en: 'Yes. On its day it shows in Today for whoever carries the deal and, when you complete it, CONTIGO asks for the next one. The Operations one is separate: a deal can have two next steps, the seller\'s and Operations\', and each person sees their own.' },
  },
  {
    id: 'notice-note', topic: 'today', tracks: WORK,
    q: { es: '¿Cómo le aviso a alguien desde una nota?', en: 'How do I notify someone from a note?' },
    a: { es: 'Al escribir la nota en el negocio, elige a la persona en "Avisar a". Le aparece en Hoy, en "Te avisaron", con el enlace al negocio, y la quita con "Visto". El aviso sale solo con una nota. No se envía correo.', en: 'When you write the note on the deal, pick the person under "Notify". It shows in their Today, under "You were notified", with the link to the deal, and they clear it with "Seen". The notice only goes out with a note. No email is sent.' },
  },
  {
    id: 'today-empty', topic: 'today', tracks: SELL,
    q: { es: '¿Por qué Hoy me sale "Todo al día" si tengo trabajo?', en: 'Why does Today say "All caught up" when I have work?' },
    a: { es: 'Hoy muestra lo que está a tu nombre: leads nuevos, tareas con fecha, el próximo paso de tus negocios el día que toca, lo que te avisaron y sugerencias. Un próximo paso con fecha futura no aparece antes. Revisa Comercios, "Míos": si faltan comercios, pídele a tu supervisor que te los asigne.', en: 'Today shows what is under your name: new leads, dated tasks, the next step of your deals on its day, what people notified you about and suggestions. A next step dated in the future does not show earlier. Check Merchants, "Mine": if merchants are missing, ask your supervisor to assign them to you.' },
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
    a: { es: 'El tiempo que queda para el primer intento de contacto. Solo corre en el horario hábil de tu mercado, y el lead dice a qué hora vence. Se detiene cuando registras la llamada, aunque no conteste. El lead pasa a "Contactado" solo cuando hablaste con la persona.', en: 'The time left for the first contact attempt. It only runs during your market\'s business hours, and the lead says when it is due. It stops when you log the call, even if there is no answer. The lead becomes "Contacted" only when you spoke to the person.' },
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
    id: 'lead-hours', topic: 'leads', tracks: [...SELL, 'admin'],
    q: { es: '¿El reloj corre de noche o en fin de semana?', en: 'Does the clock run at night or on weekends?' },
    a: { es: 'No. Solo corre en el horario hábil de tu mercado. Un lead que entra de noche o en fin de semana empieza a contar cuando abre el siguiente día hábil, y el lead dice a qué hora vence, en hora del mercado. Administración cambia el horario en "Formularios y turnos", "Horario hábil por mercado".', en: 'No. It only runs during your market\'s business hours. A lead that comes in at night or on a weekend starts counting when the next business day opens, and the lead says when it is due, in market time. An admin changes the hours under "Forms and rotation", "Business hours by market".' },
  },
  {
    id: 'lead-take', topic: 'leads', tracks: SELL,
    q: { es: '¿Puedo tomar un lead sin asignar?', en: 'Can I take a lead with no owner?' },
    a: { es: 'Sí, si es de tu mercado. "Tomar y llamar" lo deja a tu nombre y abre la llamada. En Leads, el filtro "Sin asignar" te los junta. No puedes tomar el lead de otra persona: pídele que te lo pase.', en: 'Yes, if it is in your market. "Take and call" makes it yours and opens the call. In Leads, the "No owner" filter gathers them. You cannot take someone else\'s lead: ask them to pass it to you.' },
  },
  {
    id: 'lead-pass', topic: 'leads', tracks: SELL,
    q: { es: '¿Puedo pasarle un lead a un compañero? ¿Y soltarlo?', en: 'Can I pass a lead to a teammate? Or release it?' },
    a: { es: 'Sí. En el lead, en "Quién lo lleva", "Pasar a un compañero": eliges a quién y escribes una nota. Deja de ser tuyo y, si ya hubo contacto, el reloj no vuelve a empezar. "Soltar" lo deja sin asignar, con el motivo, y lo puede tomar cualquiera que venda en tu mercado. Las dos cosas quedan en la bitácora.', en: 'Yes. On the lead, under "Owner", "Pass to a teammate": pick who and write a note. It stops being yours and, if there was contact already, the clock does not restart. "Release" leaves it with no owner, with the reason, and anyone who sells in your market can take it. Both are logged.' },
  },
  {
    id: 'lead-rotation', topic: 'leads', tracks: [...SELL, 'admin'],
    q: { es: '¿Cómo se reparten los leads del formulario web?', en: 'How are web form leads distributed?' },
    a: { es: 'Por turno, entre las personas que administración puso en el turno de ese formulario. Si en el turno no queda nadie, el lead va al respaldo; si no hay respaldo, queda sin asignar y lo ve quien vende en ese mercado.', en: 'In rotation, among the people an admin put in that form\'s rotation. If nobody is left in the rotation, the lead goes to the fallback; with no fallback, it stays unowned and that market\'s sellers see it.' },
  },
  {
    id: 'lead-imported', topic: 'leads', tracks: SELL,
    q: { es: '¿Por qué tengo tantos leads sin reloj?', en: 'Why do I have so many leads with no clock?' },
    a: { es: 'Son los que venían de Pipedrive. No traen reloj y no entran a tu Hoy para no llenarlo. En Leads, el filtro "Sin reloj (importados)" te los junta para que los trabajes o los cierres a tu ritmo.', en: 'They came from Pipedrive. They carry no clock and do not enter your Today so it does not fill up. In Leads, the "No clock (imported)" filter gathers them for you to work or close at your own pace.' },
  },
  {
    id: 'lead-discard', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué hago con un lead que no va a ningún lado?', en: 'What do I do with a lead that is going nowhere?' },
    a: { es: 'Abre el lead y toca "Descartar". Te pide un motivo: elige el más cercano. El lead sale de tu lista y el motivo queda guardado.', en: 'Open the lead and tap "Disqualify". It asks for a reason: pick the closest one. The lead leaves your list and the reason is kept.' },
  },
  {
    id: 'lead-find', topic: 'leads', tracks: SELL,
    q: { es: '¿Cómo encuentro un lead entre cientos?', en: 'How do I find one lead among hundreds?' },
    a: { es: 'En Leads, "Buscar en la lista" encuentra por nombre, persona o teléfono. Filtra por "Reloj" (con reloj corriendo o sin reloj), por "Origen" y por quién lo lleva, elige el "Orden" (más recientes, más antiguos o vence primero) y toca "Aplicar".', en: 'In Leads, "Search this list" finds by name, person or phone. Filter by "Clock" (running or none), by "Source" and by owner, choose the "Order" (newest, oldest or due first) and tap "Apply".' },
  },
  {
    id: 'lead-bulk', topic: 'leads', tracks: SELL,
    q: { es: '¿Cómo cierro muchos leads viejos de una vez?', en: 'How do I close many old leads at once?' },
    a: { es: 'En Leads, marca las casillas o "Seleccionar los de esta página", elige el motivo y toca "Cerrar como no calificado". Quien vende cierra solo los suyos; supervisión y quien lidera, los de su alcance. Cada lead queda en la bitácora y no cuenta como contacto.', en: 'In Leads, tick the boxes or "Select the ones on this page", pick the reason and tap "Close as not qualified". Sellers close only their own; supervisors and market leads, the ones in their scope. Each lead is logged and it does not count as a contact.' },
  },
  {
    id: 'lead-new', topic: 'leads', tracks: SELL,
    q: { es: '¿Cómo agrego la tienda que acabo de visitar?', en: 'How do I add the store I just visited?' },
    a: { es: 'Toca + y "Lead", o en Leads, "Nuevo lead": nombre del negocio, teléfono, "De dónde salió" y tipo de negocio. Si ya hablaste con la persona, marca "Ya hablé con esta persona": queda como contactado y no empieza el reloj de primer contacto.', en: 'Tap + and "Lead", or in Leads, "New lead": business name, phone, "Where it came from" and business type. If you already spoke with the person, tick "I already spoke with this person": it is saved as contacted and the first-contact clock does not start.' },
  },
  {
    id: 'lead-convert', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué pasa cuando convierto un lead?', en: 'What happens when I convert a lead?' },
    a: { es: 'Ya calificado, "Convertir en comercio y negocio" crea el comercio como prospecto, su contacto y un negocio con próximo paso. Eliges el embudo, confirmas el tipo de cuenta y qué hace la persona en el negocio; si el comercio ya existe, lo ligas. Las notas, llamadas y tareas del lead pasan al hilo del comercio y del negocio.', en: 'Once qualified, "Convert to merchant and deal" creates the merchant as a prospect, its contact and a deal with a next step. You pick the pipeline, confirm the account type and what the person does in the business; if the merchant already exists, you link it. The lead\'s notes, calls and tasks move to the merchant and deal thread.' },
  },
  {
    id: 'lead-type', topic: 'leads', tracks: SELL,
    q: { es: 'Al convertir no sale el embudo que necesito. ¿Cómo cambio el tipo del lead?', en: 'When converting, the pipeline I need is not offered. How do I change the lead type?' },
    a: { es: 'En el lead, en Datos, "Corregir tipo o rol": cambias el tipo de negocio, el tipo de cuenta y qué hace la persona. Solo aparecen los tipos que tienen embudo en tu mercado. Si tu mercado todavía no tiene un embudo de ventas, el lead queda calificado y no se pierde: pide a administración que lo configure.', en: 'On the lead, under Details, "Fix type or role": you change the business type, the account type and what the person does. Only the types with a pipeline in your market show up. If your market has no sales pipeline yet, the lead stays qualified and is not lost: ask an admin to set one up.' },
  },
  {
    id: 'lead-contact-role', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué rol le pongo al contacto al convertir?', en: 'Which role do I give the contact when converting?' },
    a: { es: 'El que tiene en el negocio; por ejemplo dueño del comercio, encargado, quien decide, personal, compras o finanzas. Lo eliges en "Qué hace" la persona en el negocio, al crear el lead o al convertirlo. Si no lo sabes, deja "Todavía no sé" y corrígelo después en la ficha, en Contactos.', en: 'The one they hold in the business; for example owner, manager, decision-maker, staff, purchasing or finance. You choose it under the person\'s "role in the business", when creating the lead or converting it. If you do not know, leave "Not sure yet" and fix it later on the record, under Contacts.' },
  },
  {
    id: 'lead-twice', topic: 'leads', tracks: [...SELL, 'admin'],
    q: { es: 'La misma empresa llenó el formulario dos veces. ¿Tengo dos leads?', en: 'The same business filled in the form twice. Do I have two leads?' },
    a: { es: 'No. Si coincide el teléfono o el correo, la segunda solicitud se suma al lead que ya existe, o al comercio si ya lo convertiste, y deja en el hilo la nota "Segunda solicitud web de la misma empresa". Si el lead anterior se descartó, entra como lead nuevo.', en: 'No. If the phone or the email matches, the second request is added to the existing lead, or to the merchant if you already converted it, and leaves the note "Second web request from the same business" in the thread. If the earlier lead was disqualified, it comes in as a new lead.' },
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
    a: { es: 'Cada etapa pide lo suyo: un próximo paso con fecha, quién decide, algún dato. Al moverlo se abre una hoja con lo que falta; la llenas ahí y el negocio avanza. No se puede saltar etapas para evitarlo. Si el negocio ya está con Operaciones, solo Operaciones lo avanza.', en: 'Each stage asks for something: a dated next step, who decides, a detail. Moving it opens a sheet with what is missing; you fill it in there and the deal moves. You cannot skip stages to avoid it. If the deal is already with Operations, only Operations moves it forward.' },
  },
  {
    id: 'deal-decision', topic: 'deals', tracks: WORK,
    q: { es: '¿Por qué me pide haber hablado con quien decide?', en: 'Why does it ask whether I spoke with the decision-maker?' },
    a: { es: 'Hay etapas que no dejan entrar sin saber quién decide y haber hablado con esa persona. Agrega a la persona en la ficha del comercio (Datos, Contactos, "Agregar"). Luego, en el negocio, elígela en "Decisor" y marca "Ya hablé con quien decide" solo cuando sea cierto.', en: 'Some stages cannot be entered without a decision-maker identified and reached. Add the person on the merchant record (Details, Contacts, "Add"). Then, on the deal, pick them under "Decision-maker" and tick "I have spoken with the decision-maker" only when it is true.' },
  },
  {
    id: 'deal-won', topic: 'deals', tracks: 'all',
    q: { es: '¿Cómo se gana un negocio?', en: 'How is a deal won?' },
    a: { es: 'Un negocio de alta se gana cuando el comercio hace su primera transacción, no cuando firma. Regla del piloto: los tres embudos de primera transacción se ganan a mano. Toca "Marcar como ganado" en el negocio o en su tarjeta del tablero y pon la fecha real de cierre, hoy o anterior. Si pasó por Operaciones, lo marca Operaciones. Si no ves el botón, ese embudo sigue esperando la transacción: avisa a administración.', en: 'An enrollment deal is won when the merchant makes its first transaction, not when it signs. Pilot rule: the three first-transaction pipelines are won by hand. Tap "Mark as won" on the deal or on its board card and enter the actual close date, today or earlier. If it went through Operations, Operations marks it. If you do not see the button, that pipeline is still waiting for the transaction: tell an admin.' },
  },
  {
    id: 'deal-lost', topic: 'deals', tracks: WORK,
    q: { es: 'El comercio dijo que no. ¿Dónde lo pongo?', en: 'The merchant said no. Where do I put that?' },
    a: { es: 'Abre el negocio y toca "Marcar como perdido". Elige el motivo más cercano y deja el detalle en una nota. Los motivos cambian con el tipo de venta: cada embudo ofrece los suyos, más los que valen para todos.', en: 'Open the deal and tap "Mark as lost". Pick the closest reason and leave the detail in a note. Reasons change with the sale type: each pipeline offers its own, plus the ones that apply to all.' },
  },
  {
    id: 'deal-revisit', topic: 'deals', tracks: SELL,
    q: { es: '¿Qué pasa si elijo "Volver con quien decide"?', en: 'What happens if I choose "Go back for the decision-maker"?' },
    a: { es: 'El negocio queda marcado con revisita y "Visitar" queda elegido como lo que sigue.', en: 'The deal is flagged for a revisit and "Visit" is preselected as the next step.' },
  },
  {
    id: 'deal-stalled', topic: 'deals', tracks: 'all',
    q: { es: '¿Qué es un negocio estancado?', en: 'What is a stalled deal?' },
    a: { es: 'Uno que lleva en su etapa más días de los que esa etapa permite. Los días de cada etapa los define administración en "Embudos y campos". Un negocio en pausa no cuenta como estancado.', en: 'One that has been in its stage longer than that stage allows. An admin sets the days for each stage under "Pipelines and fields". A deal on hold does not count as stalled.' },
  },
  {
    id: 'deal-pause', topic: 'deals', tracks: WORK,
    q: { es: 'El cliente me pidió esperar. ¿Cómo pauso un negocio sin perderlo?', en: 'The customer asked me to wait. How do I pause a deal without losing it?' },
    a: { es: 'En el negocio, "Poner en pausa": escribe por qué y cuándo lo revisas. Sigue abierto, no cuenta como estancado ni sin próximo paso, y vuelve a Hoy el día de la revisión. "Retomar el negocio" lo regresa. En Negocios, el filtro "En pausa" los junta.', en: 'On the deal, "Put on hold": write why and when you will review it. It stays open, does not count as stalled or missing a next step, and comes back to Today on the review day. "Resume the deal" brings it back. In Deals, the "On hold" filter gathers them.' },
  },
  {
    id: 'deal-bulk', topic: 'deals', tracks: [...MANAGE, 'ops'],
    q: { es: '¿Cómo cierro muchos negocios muertos de una vez?', en: 'How do I close many dead deals at once?' },
    a: { es: 'En Negocios, en "Sin movimiento en más de", pon los días y toca "Ver negocios quietos". Marca los que quieras, elige el motivo y toca "Cerrar como perdido". Lo usan supervisión, quien lidera el mercado, Operaciones y administración. Cada negocio queda en la bitácora.', en: 'In Deals, under "No movement in more than", enter the days and tap "Show quiet deals". Tick the ones you want, pick the reason and tap "Close as lost". Supervisors, market leads, Operations and admins can use it. Each deal is logged.' },
  },
  {
    id: 'deal-b2b-stages', topic: 'deals', tracks: WORK,
    q: { es: '¿En qué etapa pongo a un cliente en integración o certificación?', en: 'Which stage do I use for a customer in integration or certification?' },
    a: { es: 'En la que tenga ese nombre en su embudo: las etapas se ven arriba del negocio y en el tablero, y las define administración en "Embudos y campos". Si a tu embudo le falta una etapa, pídela ahí; mientras tanto, deja el avance en el próximo paso o en una nota.', en: 'The one with that name in its pipeline: the stages show at the top of the deal and on the board, and an admin sets them under "Pipelines and fields". If your pipeline lacks a stage, ask for it there; until then, keep the progress in the next step or in a note.' },
  },
  {
    id: 'deal-next-options', topic: 'deals', tracks: WORK,
    q: { es: '¿Por qué mis opciones de "¿Qué sigue?" no son las de un compañero?', en: 'Why are my "What is next?" options not the same as a colleague\'s?' },
    a: { es: 'Dependen del tipo de venta del negocio: no se ofrece lo mismo en tiendas que en cadenas y distribuidores. Si eliges "Otra tarea", escribe cuál: sin eso no guarda.', en: 'They depend on the deal\'s sale type: stores are not offered the same as chains and distributors. If you choose "Other task", write which one: it does not save without it.' },
  },
  {
    id: 'deal-currency', topic: 'deals', tracks: 'all',
    q: { es: '¿Por qué los montos no se suman entre monedas?', en: 'Why are amounts not added across currencies?' },
    a: { es: 'Cada total va en su moneda. En el tablero, en las listas y en Negocios cerrados, CONTIGO no mezcla pesos con dólares. Solo el volumen del Panel del LT se consolida en USD, y ahí dice con qué tasa.', en: 'Each total stays in its currency. On the board, in lists and in Closed deals, CONTIGO does not mix pesos with dollars. Only the volume in the Leadership panel is consolidated in USD, and it says at which rate.' },
  },

  // ------------------------------------------------------------ operaciones y pedidos
  {
    id: 'ops-queue', topic: 'ops', tracks: ['ops', 'admin'],
    q: { es: '¿Dónde está mi cola y cómo sé que me entró un negocio?', en: 'Where is my queue and how do I know a deal came in?' },
    a: { es: 'Es donde entras al abrir CONTIGO. También está en la barra, como "Cola", y en tu menú, "Cola de Operaciones", con el número de los que esperan. "Sin tomar" son los que nadie lleva; "Tomar" lo deja a tu nombre y pasa a "Míos". Arriba ves cuántos tienen aprobación o capacitación pendiente.', en: 'It is where you land when you open CONTIGO. It is also in the bar, as "Queue", and in your menu, "Operations queue", with the number waiting. "Not taken" are the ones nobody carries; "Take" puts it under your name and it moves to "Mine". At the top you see how many have a pending approval or training.' },
  },
  {
    id: 'ops-handoff', topic: 'ops', tracks: [...SELL, 'ops'],
    q: { es: '¿Cómo le entrego un negocio a Operaciones y qué me pide?', en: 'How do I hand a deal over to Operations and what does it ask for?' },
    a: { es: 'Muévelo a la etapa de Operaciones de su embudo. Si falta algo, se abre una hoja con lo que esa etapa pide; en un pedido, al menos una línea de producto. Al entrar pasa a la Cola de Operaciones y en el negocio dice "Con Operaciones": desde ahí solo Operaciones lo avanza y lo cierra.', en: 'Move it to the Operations stage of its pipeline. If something is missing, a sheet opens with what that stage asks for; on an order, at least one product line. Once in, it goes to the Operations queue and the deal says "With Operations": from there only Operations moves and closes it.' },
  },
  {
    id: 'ops-return', topic: 'ops', tracks: [...SELL, 'ops'],
    q: { es: '¿Cómo devuelvo una solicitud incompleta y cómo se entera quien vende?', en: 'How do I send back an incomplete request and how does the seller find out?' },
    a: { es: 'En el negocio, "Devolver a Ventas": elige el motivo y escribe qué falta. El negocio vuelve a la etapa de Ventas anterior y a quien lo vendió le aparece en Hoy como "Operaciones devolvió", con el motivo. Quien vende corrige y lo vuelve a mover a la etapa de Operaciones.', en: 'On the deal, "Send back to Sales": pick the reason and write what is missing. The deal returns to the previous Sales stage and shows in the seller\'s Today as "Operations sent back", with the reason. The seller fixes it and moves it to the Operations stage again.' },
  },
  {
    id: 'ops-fields', topic: 'ops', tracks: ['ops', 'admin'],
    q: { es: '¿Dónde pongo el Merchant ID, la aprobación por proveedor y la capacitación?', en: 'Where do I put the Merchant ID, the provider approval and the training?' },
    a: { es: 'En el negocio, sección Operaciones. El Merchant ID se copia con "Copiar". "Aprobación por proveedor" lleva el estado de cada uno; "Documentos", el estado y un enlace a dónde está cada documento; "Capacitación", su estado y fecha. Identificaciones y datos bancarios no se guardan en CONTIGO.', en: 'On the deal, Operations section. The Merchant ID copies with "Copy". "Provider approval" holds each one\'s status; "Documents", the status and a link to where each document is; "Training", its status and date. IDs and bank details are not stored in CONTIGO.' },
  },
  {
    id: 'ops-alerts', topic: 'ops', tracks: ['ops'],
    q: { es: 'Soy de Operaciones. ¿Dónde veo los avisos y la bitácora de mi mercado?', en: 'I am in Operations. Where do I see the alerts and the audit log for my market?' },
    a: { es: 'En tu menú: "Avisos del mercado" abre la cola de lo que se salió de la regla en tus mercados, y "Administración", la sección Auditoría con la bitácora de tus mercados. La configuración la ves en solo lectura.', en: 'In your menu: "Market alerts" opens the queue of what broke a rule in your markets, and "Administration", the Audit section with the log for your markets. You see configuration read-only.' },
  },

  // ------------------------------------------------------------ comercios
  {
    id: 'merchant-find', topic: 'merchants', tracks: 'all',
    q: { es: '¿Cómo encuentro un comercio?', en: 'How do I find a merchant?' },
    a: { es: 'Con el buscador de arriba: por nombre, teléfono, nombre del contacto o ID. En computadora, la tecla "/" te lleva al buscador. En el teléfono, toca la lupa.', en: 'With the search box at the top: by name, phone, contact name or ID. On a desktop, the "/" key takes you to the search box. On a phone, tap the magnifying glass.' },
  },
  {
    id: 'merchant-missing', topic: 'merchants', tracks: SELL,
    q: { es: 'Busqué un comercio y no aparece, o dice "Existe y lo lleva otra persona". ¿Qué hago?', en: 'I searched a merchant and got nothing, or it says "It exists and someone else has it". What do I do?' },
    a: { es: 'Tú abres lo tuyo y lo que está sin asignar. Si es de un compañero de tu mercado, el buscador te lo dice: "Existe y lo lleva otra persona", con el nombre de quien lo lleva. No lo crees otra vez: si te toca atenderlo, pide a tu supervisión que te lo pase. Si no aparece nada, búscalo por teléfono antes de crearlo.', en: 'You open your own records and the ones with no owner. If it belongs to a teammate in your market, search tells you: "It exists and someone else has it", with that person\'s name. Do not add it again: if you should be working it, ask your supervisor to pass it to you. If nothing shows, search by phone before adding it.' },
  },
  {
    id: 'merchant-new', topic: 'merchants', tracks: SELL,
    q: { es: '¿Cómo agrego un comercio nuevo?', en: 'How do I add a new merchant?' },
    a: { es: 'Toca + y "Comercio", o en Comercios, "Nuevo comercio". Si se parece a uno que ya existe, te lo dice. Si de verdad es otro, marca "Crear de todos modos si se parece a uno que ya existe".', en: 'Tap + and "Merchant", or in Merchants, "New merchant". If it looks like an existing one, it tells you. If it really is a different one, tick "Create anyway if it looks like an existing one".' },
  },
  {
    id: 'merchant-contacts', topic: 'merchants', tracks: WORK,
    q: { es: 'Quien me atendió no es el dueño del comercio, o la cuenta tiene varios directivos. ¿Cómo los registro?', en: 'The person I spoke with is not the owner, or the account has several executives. How do I record them?' },
    a: { es: 'En la ficha, Datos, Contactos, "Agregar". Cada persona va con su rol: dueño del comercio, encargado, quien decide, y en cuentas grandes dirección, compras, finanzas, tecnología e integración, legal u operación. Una cuenta puede tener varios contactos; "Hacer principal" marca al principal.', en: 'On the record, Details, Contacts, "Add". Each person carries a role: owner, manager, decision-maker, and on large accounts executive, purchasing, finance, technology and integration, legal or operations. An account can have several contacts; "Make primary" marks the main one.' },
  },
  {
    id: 'merchant-health', topic: 'merchants', tracks: 'all',
    q: { es: '¿Qué significa la salud de un comercio?', en: 'What does a merchant\'s health mean?' },
    a: { es: 'Activo: está vendiendo. Sin transaccionar: ya se dio de alta y todavía no vende. En riesgo: bajó o dejó de vender. Recién llegado: acaba de entrar y todavía no tiene negocio. Estos estados dependen de los datos de ventas, que aún no están conectados.', en: 'Active: it is selling. Not transacting: it enrolled and is not selling yet. At risk: sales dropped or stopped. Just arrived: it just came in and has no deal yet. These states depend on sales data, which is not connected yet.' },
  },
  {
    id: 'merchant-tree', topic: 'merchants', tracks: 'all',
    q: { es: '¿Para qué sirve el árbol?', en: 'What is the tree for?' },
    a: { es: 'Muestra la cadena, el distribuidor o el ISO y las cuentas que cuelgan de él, con sus totales. Arriba de la ficha, "Pertenece a" lleva a la cuenta de arriba, y en ella "Sus cuentas" dice cuántas tiene. Sirve para ver una cuenta completa y no tienda por tienda.', en: 'It shows the chain, distributor or ISO and the accounts under it, with totals. At the top of the record, "Belongs to" leads to the parent account, and there "Its accounts" says how many it has. It lets you see a whole account instead of store by store.' },
  },
  {
    id: 'account-type', topic: 'merchants', tracks: WORK,
    q: { es: 'Me llegó un distribuidor y dice "Tienda". ¿Cómo cambio el tipo de cuenta?', en: 'A distributor came in and it says "Store". How do I change the account type?' },
    a: { es: 'En la ficha, pestaña Datos, "Tipo de cuenta": tienda, sucursal, cadena, corporativo, distribuidor, ISO o agregador. El nombre que ves arriba de la ficha y en la lista cambia con el tipo, y el cambio queda en la bitácora.', en: 'On the record, Details tab, "Account type": store, branch, chain, corporate, distributor, ISO or aggregator. The label at the top of the record and in the list changes with the type, and the change is logged.' },
  },
  {
    id: 'account-parent', topic: 'merchants', tracks: WORK,
    q: { es: '¿Cómo cuelgo una sucursal de su cadena, o un agente de su ISO?', en: 'How do I put a branch under its chain, or an agent under its ISO?' },
    a: { es: 'En la ficha de la cuenta de abajo, pestaña Datos, elige a quién "Pertenece a". Una tienda no puede tener cuentas debajo; los demás tipos sí. Quien vende arma el árbol con cuentas que son suyas; para mover las de otra persona, pídelo a tu supervisión.', en: 'On the lower account\'s record, Details tab, choose who it "Belongs to". A store cannot have accounts under it; the other types can. Sellers build the tree with accounts that are theirs; to move someone else\'s, ask your supervisor.' },
  },
  {
    id: 'merchant-sales', topic: 'merchants', tracks: 'all',
    q: { es: '¿Dónde veo las ventas de un comercio y de qué días son?', en: 'Where do I see a merchant\'s sales and which days they cover?' },
    a: { es: 'En la ficha, pestaña Datos, "Ventas": los últimos 30 días a la fecha de corte de los datos de ventas, que se lee ahí mismo, y los 30 días anteriores. Si no existe dato de ese periodo, lo dice. En staging los datos de ventas todavía no están conectados.', en: 'On the record, Details tab, "Sales": the last 30 days up to the sales data cutoff date, shown right there, and the previous 30 days. If there is no data for that period, it says so. On staging the sales data is not connected yet.' },
  },
  {
    id: 'merchant-reassigned-by', topic: 'merchants', tracks: 'all',
    q: { es: '¿Quién reasignó este comercio y de quién venía?', en: 'Who reassigned this merchant and who did it come from?' },
    a: { es: 'En el hilo del comercio: "Pasó a" la persona nueva, "venía de" la anterior y, debajo, "Lo reasignó" con el nombre de quien hizo el cambio.', en: 'In the merchant thread: "Moved to" the new person, "it came from" the previous one and, below, "Reassigned by" with the name of whoever made the change.' },
  },
  {
    id: 'merchant-order', topic: 'merchants', tracks: SELL,
    q: { es: '¿Dónde hago un pedido? ¿Puedo tener dos abiertos del mismo cliente?', en: 'Where do I enter an order? Can one customer have two open?' },
    a: { es: 'Si tu mercado tiene un embudo de pedidos: en la ficha, "Nuevo negocio" (o "Nuevo pedido" si ya tiene uno abierto), eliges ese embudo y, ya en el negocio, agregas las líneas con producto, cantidad y precio. El monto es la suma de las líneas. Un embudo de pedidos admite varios abiertos por comercio; uno de alta, solo uno.', en: 'If your market has an orders pipeline: on the record, "New deal" (or "New order" if it already has one open), pick that pipeline and, on the deal, add the lines with product, quantity and price. The amount is the sum of the lines. An orders pipeline allows several open per merchant; an enrollment one, only one.' },
  },
  {
    id: 'merchant-attribution', topic: 'merchants', tracks: 'all',
    q: { es: '¿Quién lleva un comercio y desde cuándo?', en: 'Who owns a merchant, and since when?' },
    a: { es: 'En la ficha, Datos, "Atribución": origen, canal y quién lo lleva, cada uno con su fecha. Lo anterior no se borra.', en: 'On the record, Details, "Attribution": source, channel and owner, each with its date. Earlier values are not deleted.' },
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
    a: { es: 'Ventas ve lo suyo, los leads sin asignar de su mercado y los comercios sin asignar de sus territorios. Supervisión, lo de su equipo. Líder de mercado y Operaciones, todo su mercado. Leadership y Administración, todos los mercados; Leadership, en solo lectura.', en: 'Sales sees their own records, the unowned leads of their market and the unowned merchants of their territories. Supervisors, their team\'s. Market leads and Operations, their whole market. Leadership and Administration, every market; Leadership, read-only.' },
  },
  {
    id: 'team-views', topic: 'team', tracks: ['supervisor', 'lead'],
    q: { es: '¿Dónde veo a mi equipo?', en: 'Where do I see my team?' },
    a: { es: 'En dos lugares. En Hoy, "Mi equipo": quién necesita apoyo ahora. En tu menú, "Mi equipo": la tabla por persona, "Resultados por semana", lo que quedó por repartir y Pendientes del equipo. Quien lidera el mercado entra directo ahí.', en: 'Two places. In Today, "My team": who needs support now. In your menu, "My team": the table per person, "Results by week", what has no current owner and Team alerts. Market leads land right there.' },
  },
  {
    id: 'metrics', topic: 'team', tracks: WATCH,
    q: { es: '¿Qué diferencia hay entre "Primer intento a tiempo" y "Contacto logrado"?', en: 'What is the difference between "First attempt on time" and "Reached"?' },
    a: { es: 'El primero cuenta los leads en los que se intentó el contacto dentro del plazo. El segundo, aquellos en los que se habló con la persona. Un intento no es un contacto.', en: 'The first counts leads where contact was attempted within the deadline. The second, those where the person was actually spoken to. An attempt is not a contact.' },
  },
  {
    id: 'team-who', topic: 'team', tracks: WATCH,
    q: { es: '¿Quién aparece en Mi equipo?', en: 'Who shows up in My team?' },
    a: { es: 'Todas las personas que venden en tu alcance, por equipo y con subtotal: quien lidera el mercado ve todos los equipos y supervisión, el suyo. Quien no tiene equipo sale en "Sin equipo". Arriba filtras por equipo.', en: 'Everyone who sells in your scope, by team and with a subtotal: market leads see every team and supervisors, their own. People with no team show under "No team". At the top you filter by team.' },
  },
  {
    id: 'team-none', topic: 'team', tracks: ['lead', 'admin'],
    q: { es: 'Mi equipo no tiene supervisión. ¿Quién lo revisa?', en: 'My team has no supervisor. Who reviews it?' },
    a: { es: 'Quien lidera el mercado. En Administración, "Personas y acceso", ese equipo sale con el aviso "Sin supervisión: lo cubre quien lidera el mercado".', en: 'Whoever leads the market. In Administration, "People and access", that team shows the notice "No supervisor: whoever leads the market covers it".' },
  },
  {
    id: 'filter-person', topic: 'team', tracks: WATCH,
    q: { es: '¿Cómo filtro el tablero o Comercios por persona, equipo o embudo?', en: 'How do I filter the board or Merchants by person, team or pipeline?' },
    a: { es: 'En Negocios, con los selectores "Equipo" y "Persona", junto al embudo. En Comercios, abre "Filtrar por quién lo lleva, equipo, embudo, plaza o territorio".', en: 'In Deals, with the "Team" and "Person" selectors, next to the pipeline. In Merchants, open "Filter by owner, team, pipeline, place or territory".' },
  },
  {
    id: 'exceptions', topic: 'team', tracks: MANAGE,
    q: { es: '¿Qué es "Pendientes del equipo" y qué hace "Descartar"?', en: 'What are Team alerts and what does "Dismiss" do?' },
    a: { es: 'Junta lo que se salió de la regla: un negocio sin próximo paso o estancado, una revisita pendiente, un comercio en riesgo o sin asignar. Cada aviso se cierra solo cuando se corrige. "Descartar" lo saca de la lista y no vuelve en 7 días, aunque siga sin corregirse.', en: 'It gathers what broke a rule: a deal with no next step or stalled, a pending revisit, a merchant at risk or with no owner. Each item closes on its own once it is fixed. "Dismiss" removes it from the list and it does not come back for 7 days, even if it is still not fixed.' },
  },
  {
    id: 'reassign', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo reasigno un lead o un comercio?', en: 'How do I reassign a lead or a merchant?' },
    a: { es: 'Comercio: abre la ficha y toca "Reasignar", junto a quien lo lleva; te pide confirmar. Lead: abre el lead y, en "Quién lo lleva", elige a la persona y toca "Reasignar". Para muchos a la vez, usa "Repartir" en Comercios o "Reasignar cartera" en Mi equipo. Quien vende puede pasar sus propios leads con "Pasar a un compañero".', en: 'Merchant: open the record and tap "Reassign", next to the owner; it asks you to confirm. Lead: open the lead and, under "Owner", pick the person and tap "Reassign". For many at once, use "Distribute" in Merchants or "Reassign book" in My team. Sellers can pass their own leads with "Pass to a teammate".' },
  },
  {
    id: 'moves-with', topic: 'team', tracks: MANAGE,
    q: { es: '¿Qué se va con el comercio cuando lo reasigno?', en: 'What moves with the merchant when I reassign it?' },
    a: { es: 'Sus negocios abiertos y sus pendientes. La historia se queda en la ficha y el cambio queda en la bitácora con tu nombre.', en: 'Its open deals and to-dos. The history stays on the record and the change is logged with your name.' },
  },
  {
    id: 'distribute', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo reparto por ciudad o territorio?', en: 'How do I distribute by city or territory?' },
    a: { es: 'En Comercios, abre "Filtrar por quién lo lleva, equipo, embudo, plaza o territorio" y luego "Repartir": marca varios o elige "Todos los de este filtro" y a quién se los pasas.', en: 'In Merchants, open "Filter by owner, team, pipeline, place or territory", then "Distribute": tick some or choose "Everything in this filter" and who gets them.' },
  },
  {
    id: 'book-part', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo paso solo los leads o los negocios de alguien?', en: 'How do I move only someone\'s leads or deals?' },
    a: { es: 'En Mi equipo, "Reasignar cartera": elige "Leads abiertos" o "Negocios abiertos".', en: 'In My team, "Reassign book": choose "Open leads" or "Open deals".' },
  },
  {
    id: 'house-account', topic: 'team', tracks: MANAGE,
    q: { es: '¿Qué es "por repartir" y quién lo ve?', en: 'What is "no current owner" and who sees it?' },
    a: { es: 'Es un comercio o lead sin asignar, o a nombre de una cuenta de servicio o de alguien que ya no vende en ese mercado. Lo ven supervisión y quien lidera el mercado, en Mi equipo. Quien vende no lo ve hasta que se le reparte.', en: 'It is a merchant or lead with no owner, or under a service account or someone who no longer sells in that market. Supervisors and the market lead see it, in My team. Sellers do not see it until it is distributed to them.' },
  },
  {
    id: 'move-to-team', topic: 'team', tracks: ['supervisor'],
    q: { es: '¿Por qué solo veo a mi equipo en "Pasar a"?', en: 'Why do I only see my team under "Move to"?' },
    a: { es: 'Supervisión reparte dentro de su equipo. Para pasar algo a otro equipo, pídelo a quien lidera el mercado.', en: 'Supervisors distribute within their team. To move something to another team, ask the market lead.' },
  },
  {
    id: 'notify-receiver', topic: 'team', tracks: MANAGE,
    q: { es: 'Cuando reparto comercios, ¿CONTIGO avisa a quien los recibe?', en: 'When I distribute merchants, does CONTIGO notify the receiver?' },
    a: { es: 'No. Avísale antes. El cambio queda en la bitácora con tu nombre y en el hilo del comercio se lee quién lo reasignó y de quién venía.', en: 'No. Tell them first. The change is logged with your name, and the merchant thread shows who reassigned it and who it came from.' },
  },
  {
    id: 'territories', topic: 'team', tracks: MANAGE,
    q: { es: '¿Dónde se crean los territorios?', en: 'Where are territories created?' },
    a: { es: 'En Administración, "Territorios". A los comercios se les pone territorio desde Comercios, con "Repartir".', en: 'In Administration, "Territories". Merchants get their territory from Merchants, with "Distribute".' },
  },
  {
    id: 'access-removed-book', topic: 'team', tracks: MANAGE,
    q: { es: 'Le quitaron el acceso a alguien. ¿Qué pasa con su cartera?', en: 'Someone\'s access was removed. What happens to their book?' },
    a: { es: 'Queda por repartir. Aparece en Administración, "Personas y acceso", y en Mi equipo con "Repartir comercios".', en: 'It has no current owner. It shows in Administration, "People and access", and in My team with "Distribute merchants".' },
  },
  {
    id: 'supervisor-own', topic: 'team', tracks: ['supervisor'],
    q: { es: '¿Puedo llevar cuentas propias además de supervisar?', en: 'Can I carry my own accounts besides supervising?' },
    a: { es: 'Sí. Supervisión también crea leads, comercios y negocios a su nombre. En Hoy, "Yo" es tu lista y "Mi equipo" la de tu gente.', en: 'Yes. Supervisors also create leads, merchants and deals under their own name. In Today, "Me" is your list and "My team" is your people\'s.' },
  },

  // ------------------------------------------------------------ panel, cifras y reportes
  {
    id: 'closed-deals', topic: 'numbers', tracks: WATCH,
    q: { es: '¿Dónde veo los negocios ganados y perdidos por persona y por mes? ¿Puedo exportar?', en: 'Where do I see deals won and lost by person and by month? Can I export?' },
    a: { es: 'En tu menú, "Negocios cerrados". Eliges periodo, embudo, equipo, persona y resultado; arriba están los totales y la tabla "Por persona". La fecha de cierre es el día en la zona horaria del mercado. "Exportar CSV" baja lo que tienes filtrado y cada exportación queda en la bitácora con tu nombre.', en: 'In your menu, "Closed deals". You pick period, pipeline, team, person and result; the totals and the "By person" table are at the top. The close date is the day in the market\'s time zone. "Export CSV" downloads what you have filtered and each export is logged with your name.' },
  },
  {
    id: 'panel-how', topic: 'numbers', tracks: ['lead', 'lt', 'admin'],
    q: { es: '¿Cómo se calcula cada cifra del panel y de qué periodo es?', en: 'How is each panel figure calculated and which period does it cover?' },
    a: { es: 'Toca "Cómo se calcula" debajo de la cifra. El panel usa tres ventanas y cada bloque dice la suya: leads, ganados y perdidos son del periodo que eliges arriba; comercios activos y negocios abiertos son la foto de hoy; las ventas son los 30 días de los datos de ventas a su fecha de corte.', en: 'Tap "How it is calculated" under the figure. The panel uses three windows and each block states its own: leads, won and lost belong to the period you pick at the top; active merchants and open deals are today\'s snapshot; sales are the 30 days in the sales data up to its cutoff date.' },
  },
  {
    id: 'panel-by-type', topic: 'numbers', tracks: ['lead', 'lt', 'admin'],
    q: { es: '¿Cómo veo D2D y B2B por separado?', en: 'How do I see D2D and B2B separately?' },
    a: { es: 'En el Panel del LT, "Por embudo": cada tipo de venta va en su línea, con sus leads, ganados, perdidos y abiertos. "Por equipo" hace lo mismo por equipo. En Negocios cerrados filtras por embudo.', en: 'In the Leadership panel, "By pipeline": each sale type has its own line, with its leads, won, lost and open. "By team" does the same per team. In Closed deals you filter by pipeline.' },
  },
  {
    id: 'fx-rate', topic: 'numbers', tracks: ['lead', 'lt', 'admin'],
    q: { es: '¿Con qué tasa se consolida a dólares y de qué fecha es?', en: 'Which rate is used to consolidate into dollars, and from which date?' },
    a: { es: 'Con la de fecha más reciente que cargó administración. El panel la muestra en "Volumen consolidado (USD)" con su valor, su fecha y de dónde sale. Si a una moneda le falta tasa, el panel no consolida y lo dice.', en: 'The most recently dated one loaded by an admin. The panel shows it under "Consolidated volume (USD)" with its value, its date and where it comes from. If a currency has no rate, the panel does not consolidate and says so.' },
  },
  {
    id: 'adoption', topic: 'numbers', tracks: ['lead', 'lt', 'admin'],
    q: { es: '¿Cómo sé quién está usando CONTIGO?', en: 'How do I know who is using CONTIGO?' },
    a: { es: 'En el Panel del LT, "Adopción": por persona, su último ingreso, cuántas veces entró y cuántas actividades registró en el periodo, y quién tiene acceso y nunca ha entrado. Son conteos: nunca lo que la persona escribió. La ven Leadership, quien lidera el mercado y administración.', en: 'In the Leadership panel, "Adoption": per person, their last sign-in, how many times they signed in and how many activities they logged in the period, and who has access and has never signed in. They are counts: never what the person wrote. Leadership, market leads and admins see it.' },
  },
  {
    id: 'field-report', topic: 'numbers', tracks: WATCH,
    q: { es: '¿De dónde saco el número de la semana por territorio?', en: 'Where do I get the weekly number by territory?' },
    a: { es: 'Del "Reporte de campo", desde Mi equipo o el Panel del LT: puntos de venta dados de alta y negocios ganados por semana, por territorio o por plaza, y visitas por persona. La semana va de lunes a domingo. Se baja con "Exportar altas y ganados" y "Exportar visitas".', en: 'From the "Field report", from My team or the Leadership panel: stores enrolled and deals won by week, by territory or by place, and visits by person. The week runs Monday to Sunday. Download it with "Export enrollments and wins" and "Export visits".' },
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
    a: { es: 'Fuera de CONTIGO, en la carpeta donde tu equipo ya los guarda. En el negocio, Operaciones anota el estado de cada documento y un enlace a dónde está, no el archivo. CONTIGO no guarda identificaciones ni cuentas bancarias.', en: 'Outside CONTIGO, in the folder where your team already keeps them. On the deal, Operations records the status of each document and a link to where it is, not the file. CONTIGO does not store IDs or bank accounts.' },
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
    a: { es: 'Sí. Los cambios de etapa, de quién lo lleva, de datos y los inicios de sesión quedan en la bitácora con tu nombre y la hora. Lo que solo consultas no se registra.', en: 'Yes. Stage, owner and data changes, and sign-ins, are logged with your name and the time. What you only look at is not logged.' },
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
    a: { es: 'Trabaja su cola: toma los negocios que Ventas entregó, los avanza, los devuelve con motivo y los cierra. Mantiene el Merchant ID, las aprobaciones, los documentos y la capacitación, completa los datos del comercio y deja notas y tareas. No crea comercios, leads ni negocios, y no reasigna: eso se pide a ventas o a quien lidera el mercado.', en: 'It works its queue: takes the deals Sales handed over, moves them forward, sends them back with a reason and closes them. It keeps the Merchant ID, approvals, documents and training, completes merchant details and leaves notes and tasks. It does not create merchants, leads or deals, and does not change owners: ask sales or the market lead for that.' },
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
    a: { es: 'Administración, "Personas y acceso", "Nuevo equipo": nombre, mercado y tipo de venta. Luego, al dar acceso, eliges el equipo. Quien tiene rol de supervisión en un equipo ve lo de su gente. Un equipo sin supervisión sale con el aviso "Sin supervisión: lo cubre quien lidera el mercado".', en: 'Administration, "People and access", "New team": name, market and sale type. Then, when granting access, you pick the team. Whoever holds the supervisor role on a team sees their people\'s records. A team with no supervisor shows the notice "No supervisor: whoever leads the market covers it".' },
  },
  {
    id: 'admin-rotation-empty', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Qué pasa si en un turno no queda nadie?', en: 'What if nobody is left in a rotation?' },
    a: { es: 'El lead va al respaldo; si no hay, queda sin asignar y lo ve quien vende en ese mercado.', en: 'The lead goes to the fallback; with none, it stays unowned and that market\'s sellers see it.' },
  },
  {
    id: 'admin-win', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cambio la forma en que se gana un negocio en un embudo?', en: 'How do I change how a deal is won in a pipeline?' },
    a: { es: 'Administración, "Embudos y campos". En cada embudo, marca o quita "Se gana con la primera transacción" y toca "Guardar". Sin marcar, se gana a mano. Como aplica desde ese momento a los negocios abiertos de ese embudo, la pantalla dice cuántos son y te pide confirmar con una casilla. El cambio queda en la bitácora.', en: 'Administration, "Pipelines and fields". On each pipeline, tick or untick "Won by the first transaction" and tap "Save". Unticked, it is won by hand. Because it applies from that moment to the open deals in that pipeline, the screen says how many there are and asks you to confirm with a checkbox. The change is logged.' },
  },
  {
    id: 'admin-stage', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cambio, agrego, muevo o quito una etapa?', en: 'How do I change, add, move or remove a stage?' },
    a: { es: 'Administración, "Embudos y campos". "Editar" en la fila de la etapa cambia su nombre, sus días y lo que pide para entrar. Más abajo, "Orden de las etapas": "Agregar etapa", "Subir", "Bajar" y "Archivar". Una etapa con negocios no se borra: se archiva y eliges a cuál pasan.', en: 'Administration, "Pipelines and fields". "Edit" on the stage row changes its name, its days and what it asks for to enter. Further down, "Stage order": "Add stage", "Move up", "Move down" and "Archive". A stage with deals is never deleted: it is archived and you choose the stage they move to.' },
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
    a: { es: 'Administración, "Problemas reportados". Cada reporte trae quién lo mandó, desde qué pantalla y qué tan urgente es. Escribe tu respuesta y toca "Responder y marcar atendido": la persona la ve en "Reportar un problema".', en: 'Administration, "Reported problems". Each report shows who sent it, from which screen and how urgent it is. Write your answer and tap "Answer and mark handled": the person sees it under "Report a problem".' },
  },
  {
    id: 'admin-hours', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Dónde cambio el horario hábil de un mercado?', en: 'Where do I change a market\'s business hours?' },
    a: { es: 'Administración, "Formularios y turnos", "Horario hábil por mercado": días hábiles, hora en que abre y en que cierra, y "Guardar horario". El reloj de primer contacto solo corre en ese horario. El cambio queda en la bitácora.', en: 'Administration, "Forms and rotation", "Business hours by market": business days, opening and closing time, and "Save hours". The first-contact clock only runs during those hours. The change is logged.' },
  },
  {
    id: 'admin-fx', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cargo la tasa de cambio?', en: 'How do I load the exchange rate?' },
    a: { es: 'Administración, "Embudos y campos", "Tasa de cambio a USD": moneda, fecha de la tasa, cuánto vale 1 unidad en USD y de dónde sale; luego "Guardar tasa". Vale la de fecha más reciente. CONTIGO no trae la tasa de ningún lado.', en: 'Administration, "Pipelines and fields", "Exchange rate to USD": currency, rate date, how much 1 unit is worth in USD and where it comes from; then "Save rate". The most recently dated one applies. CONTIGO does not fetch the rate from anywhere.' },
  },
  {
    id: 'admin-create', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo creo un embudo, un campo, un tipo de cuenta o un motivo de pérdida?', en: 'How do I create a pipeline, a field, an account type or a loss reason?' },
    a: { es: 'En "Embudos y campos": "Crear embudo" (nace con sus etapas, más Ganado y Perdido, y con cierre a mano), "Crear campo" (por mercado y tipo de venta), "Agregar tipo" y "Agregar motivo". No se crean campos que pidan tarjetas, cuentas bancarias, contraseñas ni identificaciones completas.', en: 'Under "Pipelines and fields": "Create pipeline" (it starts with its stages, plus Won and Lost, and closes by hand), "Create field" (by market and sale type), "Add type" and "Add reason". Fields that ask for cards, bank accounts, passwords or full IDs cannot be created.' },
  },
  {
    id: 'admin-form', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cambio lo que pide un formulario web?', en: 'How do I change what a web form asks for?' },
    a: { es: 'En "Embudos y campos", "Qué pide cada formulario web", "Editar": cambias el nombre visible, marcas los campos de lead que se suman a lo básico y eliges con qué tipo de cuenta nacen sus leads. Nombre, teléfono y negocio se piden siempre.', en: 'Under "Pipelines and fields", "What each web form asks for", "Edit": you change the visible name, tick the lead fields added to the basics and choose which account type its leads start with. Name, phone and business are always asked.' },
  },
  {
    id: 'admin-ops-catalogs', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Dónde se configuran los pedidos, las etapas de Operaciones y sus catálogos?', en: 'Where are orders, Operations stages and their catalogs set up?' },
    a: { es: 'En Administración, la sección "Operaciones": qué embudos admiten varios negocios abiertos y líneas de producto, cuáles son etapas de Operaciones, productos, proveedores, documentos requeridos y motivos de devolución a Ventas.', en: 'In Administration, the "Operations" section: which pipelines allow several open deals and product lines, which stages are Operations stages, products, providers, required documents and reasons for sending back to Sales.' },
  },

  // ------------------------------------------------------------ lo que no hace todavía
  {
    id: 'no-sales-app', topic: 'limits', tracks: 'all',
    q: { es: '¿Las visitas llegan solas desde la Sales App?', en: 'Do visits come in on their own from the Sales App?' },
    a: { es: 'Todavía no: la Sales App no está conectada. Mientras tanto, cada visita se registra a mano en CONTIGO, con "Visita" en la ficha.', en: 'Not yet: the Sales App is not connected. Until then, each visit is logged by hand in CONTIGO, with "Visit" on the record.' },
  },
  {
    id: 'no-offline', topic: 'limits', tracks: 'all',
    q: { es: '¿Puedo trabajar o leer sin conexión?', en: 'Can I work or read offline?' },
    a: { es: 'No. Sin señal solo puedes leer lo que ya está en pantalla. No se guarda nada ni se abre otra pantalla hasta que vuelva la señal.', en: 'No. With no signal you can only read what is already on screen. Nothing is saved and no other screen opens until the signal returns.' },
  },
  {
    id: 'no-files', topic: 'limits', tracks: 'all',
    q: { es: '¿Puedo adjuntar fotos, contratos o evidencia?', en: 'Can I attach photos, contracts or evidence?' },
    a: { es: 'No. CONTIGO no guarda fotos ni archivos. Deja lo importante en una nota y el archivo donde tu equipo ya lo guarda. De los documentos de un negocio se anota solo el estado y un enlace.', en: 'No. CONTIGO does not store photos or files. Leave what matters in a note and the file where your team already keeps it. For a deal\'s documents only the status and a link are recorded.' },
  },
  {
    id: 'no-email', topic: 'limits', tracks: 'all',
    q: { es: '¿CONTIGO me avisa por correo o por Slack cuando me cae algo?', en: 'Does CONTIGO email or Slack me when something lands on me?' },
    a: { es: 'No. No manda correos, mensajes de Slack ni avisos al teléfono. Lo que te toca aparece en Hoy y en Leads cuando abres CONTIGO; ahí también ves lo que te avisaron desde una nota y lo que Operaciones te devolvió.', en: 'No. It sends no emails, Slack messages or phone alerts. What is yours shows up in Today and in Leads when you open CONTIGO; that is also where you see what people notified you about from a note and what Operations sent back.' },
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
  {
    id: 'no-sales-data', topic: 'limits', tracks: 'all',
    q: { es: '¿La primera venta y las ventas de cada comercio llegan solas?', en: 'Do the first sale and each merchant\'s sales come in on their own?' },
    a: { es: 'Todavía no en staging: los datos de ventas no están conectados. Por eso en el piloto el negocio se gana a mano y la salud del comercio no se mueve sola.', en: 'Not yet on staging: the sales data is not connected. That is why during the pilot a deal is won by hand and merchant health does not move on its own.' },
  },
  {
    id: 'no-app', topic: 'limits', tracks: 'all',
    q: { es: '¿Hay una app para instalar desde la tienda de aplicaciones?', en: 'Is there an app to install from the app store?' },
    a: { es: 'No. CONTIGO se usa en el navegador, también en el teléfono. Puedes dejar un acceso directo en tu teléfono desde el menú del navegador.', en: 'No. CONTIGO runs in the browser, on a phone too. You can leave a shortcut on your phone from the browser menu.' },
  },
  {
    id: 'no-new-form', topic: 'limits', tracks: ['admin'],
    q: { es: '¿Puedo crear un formulario web nuevo desde Administración?', en: 'Can I create a new web form from Administration?' },
    a: { es: 'Todavía no. Desde la pantalla se edita lo que pide cada formulario que ya existe; crear uno nuevo se pide con "Reportar un problema".', en: 'Not yet. From the screen you edit what each existing form asks for; a new one is requested through "Report a problem".' },
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
// Qué tiene que saber hacer cada rol el día uno y la primera semana. Sale de las necesidades de capacitación del comité 2 (11-nov-2026),
// más lo que entró en la ola 2: conversión de leads, en pausa, cola y pedidos, negocios cerrados y exportar, tipo de cuenta y jerarquía.
// Sin fechas ni instructores: no existen todavía.
export type Training = { day1: L[]; week1: L[] }

export const TRAINING: Record<Track, Training> = {
  rep: {
    day1: [
      { es: 'Leer Hoy: Ahora, Vencido, Hoy y Sugerido. La lista ya viene armada.', en: 'Read Today: Now, Overdue, Today and Suggested. The list comes ready.' },
      { es: 'Completar una tarea y dejar el próximo paso con fecha.', en: 'Complete a task and leave the next step with a date.' },
      { es: 'Buscar un comercio por nombre o teléfono antes de crearlo, y leer su ficha: hilo, árbol y datos.', en: 'Search a merchant by name or phone before adding it, and read its record: thread, tree and details.' },
      { es: 'Llamar a un lead desde Leads y registrar cómo te fue: un intento no es un contacto.', en: 'Call a lead from Leads and log how it went: an attempt is not a contact.' },
      { es: 'Crear un lead de la tienda que visitaste, con "Ya hablé con esta persona", y saber que el reloj solo corre en horario hábil.', en: 'Create a lead for the store you visited, with "I already spoke with this person", and know that the clock only runs during business hours.' },
      { es: 'Registrar una visita con cómo te fue y quién visitó.', en: 'Log a visit with how it went and who visited.' },
    ],
    week1: [
      { es: 'Mover un negocio de etapa y resolver lo que la etapa pide: quién decide y próximo paso.', en: 'Move a deal to its next stage and resolve what the stage asks for: who decides and a next step.' },
      { es: 'Convertir un lead calificado: elegir el embudo, confirmar el tipo de cuenta y revisar el comercio y el negocio que nacen.', en: 'Convert a qualified lead: pick the pipeline, confirm the account type and review the merchant and the deal it creates.' },
      { es: 'Poner un negocio "En pausa" cuando el cliente pide esperar, con motivo y fecha de revisión, y retomarlo.', en: 'Put a deal "On hold" when the customer asks to wait, with a reason and a review date, and resume it.' },
      { es: 'Entregar un negocio a Operaciones y saber qué pasa si lo devuelven: aparece en Hoy con el motivo.', en: 'Hand a deal over to Operations and know what happens if it is sent back: it shows in Today with the reason.' },
      { es: 'Registrar a quien atiende y a quien decide como contactos distintos.', en: 'Record the clerk and the decision-maker as separate contacts.' },
      { es: 'Trabajar los leads importados: llamar los que valen y descartar el resto con su motivo.', en: 'Work the imported leads: call the ones worth it and disqualify the rest with a reason.' },
      { es: 'Pasar un lead a un compañero o soltarlo, y cerrar varios leads de una vez con su motivo.', en: 'Pass a lead to a teammate or release it, and close several leads at once with a reason.' },
      { es: 'En cuentas grandes: tipo de cuenta, a quién pertenece y los contactos con su rol.', en: 'On large accounts: account type, who it belongs to and the contacts with their role.' },
      { es: 'Cerrar un negocio que no avanza con "Marcar como perdido" y su motivo.', en: 'Close a deal that is not moving with "Mark as lost" and its reason.' },
      { es: 'Saber qué ves y qué no: lo tuyo y lo que está sin asignar. Lo demás se pide a supervisión.', en: 'Know what you see and what you do not: your own records and the unowned ones. The rest goes through your supervisor.' },
      { es: 'Saber qué no hace CONTIGO todavía: rutas, ubicación, mapa, fotos, avisos por correo y trabajo sin conexión.', en: 'Know what CONTIGO does not do yet: routes, location, map, photos, email notices and offline work.' },
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
      { es: 'Negocios cerrados: ganados y perdidos por persona y periodo, y exportar lo filtrado.', en: 'Closed deals: won and lost by person and period, and exporting what is filtered.' },
      { es: 'El Reporte de campo y "Resultados por semana" para la revisión semanal.', en: 'The Field report and "Results by week" for the weekly review.' },
      { es: 'Cerrar en bloque los negocios sin movimiento y los leads viejos, con su motivo.', en: 'Close in bulk the deals with no movement and the old leads, with a reason.' },
      { es: 'Pendientes del equipo: qué abre cada aviso, que se cierran solos y cuándo usar "Descartar".', en: 'Team alerts: what opens each item, that they close on their own and when to use "Dismiss".' },
      { es: 'Usar el tablero de Negocios como agenda de tu revisión semanal.', en: 'Use the Deals board as the agenda for your weekly review.' },
      { es: 'Exigir el próximo paso sin que se llene de fechas de relleno.', en: 'Hold the team to the next step without it filling up with filler dates.' },
      { es: 'La regla del piloto: los tres embudos de primera transacción se ganan a mano.', en: 'The pilot rule: the three first-transaction pipelines are won by hand.' },
      { es: 'Qué no ve tu rol (Panel del LT, configuración) y a quién pedirlo.', en: 'What your role does not see (Leadership panel, configuration) and who to ask.' },
    ],
  },
  lead: {
    day1: [
      { es: 'Dónde están tus pantallas: en tu menú, Mi equipo, Panel del LT y Administración (Embudos y campos, Auditoría).', en: 'Where your screens are: in your menu, My team, Leadership panel and Administration (Pipelines and fields, Audit).' },
      { es: 'Leer Mi equipo, tu pantalla de inicio: por equipo y con subtotal, y "Resultados por semana".', en: 'Read My team, your home screen: by team and with a subtotal, and "Results by week".' },
      { es: 'Leer el panel: qué cuenta como ganado y la diferencia entre "Primer intento a tiempo" y "Contacto logrado".', en: 'Read the panel: what counts as won and the difference between "First attempt on time" and "Reached".' },
      { es: 'El tablero de Negocios: elegir el embudo y filtrar "Sin próximo paso".', en: 'The Deals board: pick the pipeline and filter "No next step".' },
      { es: 'Reasignar un lead y un comercio.', en: 'Reassign a lead and a merchant.' },
    ],
    week1: [
      { es: 'Repartir lo que quedó por repartir, por plaza o territorio, y una cartera completa.', en: 'Distribute what has no current owner, by place or territory, and a whole book.' },
      { es: 'Negocios cerrados y Reporte de campo: filtrar por embudo, equipo y persona, y exportar.', en: 'Closed deals and the Field report: filter by pipeline, team and person, and export.' },
      { es: 'Leer el panel "Por embudo" para separar tiendas de cadenas y distribuidores, y "Cómo se calcula" en cada cifra.', en: 'Read the panel "By pipeline" to separate stores from chains and distributors, and "How it is calculated" on each figure.' },
      { es: 'Tipo de cuenta, jerarquía ("Pertenece a") y etapas del embudo de cadenas y distribuidores.', en: 'Account type, hierarchy ("Belongs to") and the stages of the chains and distributors pipeline.' },
      { es: 'Adopción: quién entra, cuánto registra y quién nunca ha entrado.', en: 'Adoption: who signs in, how much they log and who has never signed in.' },
      { es: 'Leer Mi equipo y decidir qué hacer con cada aviso: atender, reasignar o descartar.', en: 'Read My team and decide what to do with each item: handle, reassign or dismiss.' },
      { es: 'La regla del piloto: quién marca ganado a mano y dónde queda registrado.', en: 'The pilot rule: who marks a deal won by hand and where it is logged.' },
      { es: 'Qué pide cada etapa y dónde se ve (Administración, Embudos y campos).', en: 'What each stage asks for and where to see it (Administration, Pipelines and fields).' },
      { es: 'Cómo se pide un cambio de etapa, campo o turno: lo hace administración y queda en la bitácora.', en: 'How to ask for a stage, field or rotation change: an admin does it and it is logged.' },
      { es: 'Qué cifras dependen de conexiones que todavía no existen (Sales App y datos de ventas).', en: 'Which figures depend on connections that do not exist yet (Sales App and sales data).' },
    ],
  },
  ops: {
    day1: [
      { es: 'Leer tu cola, que es tu pantalla de inicio: "Sin tomar", "Míos" y lo que tiene aprobación o capacitación pendiente.', en: 'Read your queue, which is your home screen: "Not taken", "Mine" and what has a pending approval or training.' },
      { es: 'Tomar un negocio y devolverlo a Ventas con el motivo cuando llega incompleto.', en: 'Take a deal and send it back to Sales with the reason when it comes in incomplete.' },
      { es: 'Leer la historia de un negocio antes de tocarlo y dejar tu nota en el mismo lugar.', en: 'Read a deal\'s history before touching it and leave your note in the same place.' },
      { es: 'Llenar la sección Operaciones del negocio: Merchant ID, aprobación por proveedor, documentos (estado y enlace) y capacitación.', en: 'Fill in the deal\'s Operations section: Merchant ID, provider approval, documents (status and link) and training.' },
      { es: 'Dejar tu próximo paso de Operaciones con fecha para que aparezca en Hoy, y avisar a alguien desde una nota.', en: 'Leave your dated Operations next step so it shows in Today, and notify someone from a note.' },
    ],
    week1: [
      { es: 'Completar los datos del comercio: teléfono, dirección, contactos y campos adicionales.', en: 'Complete merchant details: phone, address, contacts and additional fields.' },
      { es: 'Pedidos: leer las líneas de producto de un pedido y saber que su monto es la suma de las líneas.', en: 'Orders: read an order\'s product lines and know that its amount is the sum of the lines.' },
      { es: 'Cerrar en bloque los negocios sin movimiento, con su motivo.', en: 'Close in bulk the deals with no movement, with a reason.' },
      { es: 'Qué no se escribe en CONTIGO: documentos, tarjetas, cuentas bancarias y contraseñas.', en: 'What is not written in CONTIGO: documents, cards, bank accounts and passwords.' },
      { es: 'Qué puede y qué no puede hacer Operaciones, y a quién pedir lo demás.', en: 'What Operations can and cannot do, and who to ask for the rest.' },
      { es: 'La regla del piloto: se gana a mano, con la fecha real de cierre, y lo que pasó por Operaciones lo marca Operaciones.', en: 'The pilot rule: a deal is won by hand, with the actual close date, and what went through Operations is marked by Operations.' },
    ],
  },
  lt: {
    day1: [
      { es: 'Tu pantalla de inicio es el Panel del LT: elegir el periodo y abrir "Cómo se calcula" en una cifra.', en: 'Your home screen is the Leadership panel: pick the period and open "How it is calculated" on a figure.' },
      { es: 'Tres definiciones: ganado es primera transacción y no firma; intento no es contacto; la salud del comercio viene de los datos de ventas.', en: 'Three definitions: won means first transaction, not signing; an attempt is not a contact; merchant health comes from the sales data.' },
      { es: 'Qué puede tu rol: ver todo, cambiar nada.', en: 'What your role can do: see everything, change nothing.' },
    ],
    week1: [
      { es: 'Leer Mi equipo por mercado, con sus Pendientes del equipo.', en: 'Read My team by market, with its Team alerts.' },
      { es: 'Negocios cerrados: ganados y perdidos por persona y periodo, y exportar.', en: 'Closed deals: won and lost by person and period, and exporting.' },
      { es: 'El consolidado en USD: con qué tasa se calcula, de qué fecha es y qué pasa si falta.', en: 'The USD total: which rate it uses, its date and what happens when it is missing.' },
      { es: 'Adopción y el Reporte de campo.', en: 'Adoption and the Field report.' },
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
      { es: 'Responder lo que el equipo reportó en la pestaña Problemas reportados.', en: 'Answer what the team reported in the Reported problems tab.' },
    ],
    week1: [
      { es: 'Turnos de leads: cómo rota, qué es el respaldo y qué mide el reloj de primer contacto.', en: 'Lead rotations: how they rotate, what the fallback is and what the first-contact clock measures.' },
      { es: 'Horario hábil por mercado y territorios: dónde se cambian y a quién le toca cada territorio.', en: 'Business hours by market and territories: where they are changed and who covers each territory.' },
      { es: 'Embudos y campos: agregar, mover y archivar etapas; crear un embudo, un campo, un tipo de cuenta o un motivo de pérdida.', en: 'Pipelines and fields: add, move and archive stages; create a pipeline, a field, an account type or a loss reason.' },
      { es: 'La tasa de cambio a USD y la sección Operaciones de Administración: etapas de Operaciones, productos, proveedores y documentos.', en: 'The exchange rate to USD and the Operations section of Administration: Operations stages, products, providers and documents.' },
      { es: 'La regla de cierre por embudo: primera transacción o a mano, y la regla del piloto.', en: 'The closing rule per pipeline: first transaction or by hand, and the pilot rule.' },
      { es: 'Calidad de datos: registros sin asignar por mercado y fusionar duplicados.', en: 'Data quality: unowned records per market and merging duplicates.' },
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
      { track: 'rep' as Track, points: [{ es: 'Tu día ya ordenado, en el teléfono y sin instalar nada', en: 'Your day already sorted, on your phone and with nothing to install' }, { es: 'Conviertes el lead en comercio y negocio sin capturarlo otra vez', en: 'You convert the lead into a merchant and a deal without typing it again' }, { es: 'Llamas, escribes por WhatsApp y registras la visita desde la ficha', en: 'You call, message on WhatsApp and log the visit from the record' }] },
      { track: 'supervisor' as Track, points: [{ es: 'Una fila por persona de tu equipo', en: 'One row per person on your team' }, { es: 'Repartes leads y comercios, uno o por territorio', en: 'You hand out leads and merchants, one by one or by territory' }, { es: 'Ves quién va tarde, qué negocio no tiene próximo paso y los cerrados por persona', en: 'You see who is late, which deal has no next step and closed deals by person' }] },
      { track: 'lead' as Track, points: [{ es: 'Todo tu mercado: embudos, equipos y cartera', en: 'Your whole market: pipelines, teams and book' }, { es: 'Lo que quedó por repartir, a la vista', en: 'What was left with no current owner, ready to distribute' }, { es: 'El Panel del LT, los negocios cerrados y el reporte semanal de campo de tu mercado', en: 'The Leadership panel, closed deals and the weekly field report for your market' }] },
      { track: 'ops' as Track, points: [{ es: 'Tu cola: lo que Ventas entregó, para tomarlo o devolverlo con el motivo', en: 'Your queue: what Sales handed over, to take it or send it back with the reason' }, { es: 'Merchant ID, aprobaciones, documentos y capacitación en el mismo negocio', en: 'Merchant ID, approvals, documents and training on the same deal' }, { es: 'Cada cambio de etapa queda con nombre y hora', en: 'Every stage change is saved with a name and a time' }] },
      { track: 'lt' as Track, points: [{ es: 'Todos los mercados, en solo lectura', en: 'Every market, read-only' }, { es: 'Embudo, respuesta a leads y comercios en riesgo, y cada cifra dice cómo se calcula', en: 'Pipeline, lead response and merchants at risk, and each figure says how it is calculated' }, { es: 'Negocios cerrados por persona, sin pedir reportes a nadie', en: 'Closed deals by person, without asking anyone for reports' }] },
      { track: 'admin' as Track, points: [{ es: 'Accesos por rol, con mercado, equipo y fecha de fin', en: 'Access by role, with market, team and end date' }, { es: 'Embudos y etapas, turnos de leads, horario hábil, territorios y calidad de datos', en: 'Pipelines and stages, lead rotations, business hours, territories and data quality' }, { es: 'Bitácora de cada cambio y reportes del equipo', en: 'An audit log of every change and the team\'s reports' }] },
    ],
  },
  status: {
    eyebrow: { es: 'Sin sorpresas', en: 'No surprises' },
    title: { es: 'Qué ya funciona y qué todavía no.', en: 'What works today and what does not yet.' },
    text: {
      es: 'Estás entrando a un piloto. Esto es lo que ya puedes usar y lo que CONTIGO todavía no hace, dicho de frente.',
      en: 'You are joining a pilot. This is what you can use already and what CONTIGO does not do yet, said plainly.',
    },
    // La regla del piloto, con las mismas palabras que el negocio muestra al marcarlo como ganado.
    rule: {
      es: 'En el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola.',
      en: 'During the pilot a deal is won by hand; when the first transaction arrives it will be confirmed on its own.',
    },
    rows: [
      { label: { es: 'Hoy, leads, negocios y comercios', en: 'Today, leads, deals and merchants' }, state: 'on' as const },
      { label: { es: 'Datos de Pipedrive de US y de México', en: 'Pipedrive data for the US and Mexico' }, state: 'on' as const },
      { label: { es: 'Visitas registradas a mano y reparto de cartera por territorio', en: 'Visits logged by hand and book distribution by territory' }, state: 'on' as const },
      { label: { es: 'Cola de Operaciones y pedidos con líneas de producto', en: 'Operations queue and orders with product lines' }, state: 'on' as const },
      { label: { es: 'Negocios cerrados y reporte semanal de campo, con exportación', en: 'Closed deals and the weekly field report, with export' }, state: 'on' as const },
      { label: { es: 'Visitas automáticas desde la Sales App', en: 'Automatic visits from the Sales App' }, state: 'soon' as const },
      { label: { es: 'Primera venta y ventas de cada comercio desde los datos de ventas', en: 'Each merchant\'s first sale and sales from the sales data' }, state: 'soon' as const },
      { label: { es: 'Trabajo sin conexión, fotos o archivos adjuntos, mapa, app instalable y avisos por correo o Slack', en: 'Offline work, photo or file attachments, map, installable app and email or Slack notices' }, state: 'soon' as const },
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
      { es: 'Lead convertido en comercio y negocio', en: 'Lead converted into merchant and deal' },
      { es: 'Negocios en pausa', en: 'Deals on hold' },
      { es: 'Cola de Operaciones', en: 'Operations queue' },
      { es: 'Pedidos con líneas de producto', en: 'Orders with product lines' },
      { es: 'Negocios cerrados por persona', en: 'Closed deals by person' },
      { es: 'Mi equipo', en: 'My team' },
      { es: 'Panel del LT', en: 'Leadership panel' },
      { es: 'Bitácora de cambios', en: 'Audit log' },
      { es: 'Español e inglés', en: 'Spanish and English' },
      { es: 'Teléfono, tablet y computadora', en: 'Phone, tablet and desktop' },
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

/** Fotos de archivo con licencia (Adobe Stock, cuenta de axexo, 11 y 12-nov-2026). Ilustran; no retratan a personas del equipo ni a comercios de axexo. */
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
