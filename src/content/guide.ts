// Contenido de la entrada (landing), del primer ingreso y de la ayuda. Un solo lugar, en español y en inglés.
// Las preguntas y los pasos salen del comité con los perfiles reales del equipo (11-nov-2026): docs/guide-sources.md.
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
export type Step = { key: string; title: L; why: L; href: string; cta: L }

const S = {
  today: {
    key: 'today',
    title: { es: 'Abre Hoy y mira qué sigue', en: 'Open Today and see what is next' },
    why: {
      es: 'Tu cola ya viene ordenada: primero lo vencido, luego lo de hoy y hasta cinco sugerencias. No tienes que armar tu lista.',
      en: 'Your queue comes sorted: overdue first, then today, then up to five suggestions. You do not have to build your list.',
    },
    href: '/hoy',
    cta: { es: 'Ir a Hoy', en: 'Go to Today' },
  },
  complete: {
    key: 'complete',
    title: { es: 'Completa una tarea y deja el próximo paso', en: 'Complete a task and leave the next step' },
    why: {
      es: 'Al terminar algo, CONTIGO te pregunta cómo te fue y qué sigue. Con eso ningún comercio se queda sin seguimiento.',
      en: 'When you finish something, CONTIGO asks how it went and what comes next. That way no merchant is left without follow-up.',
    },
    href: '/hoy',
    cta: { es: 'Ir a Hoy', en: 'Go to Today' },
  },
  leads: {
    key: 'leads',
    title: { es: 'Revisa tus leads y llama al que tiene el reloj corriendo', en: 'Check your leads and call the one with the clock running' },
    why: {
      es: 'Un lead nuevo trae un reloj de primer contacto. Si no tiene dueño, "Tomar y llamar" lo deja a tu nombre y abre la llamada.',
      en: 'A new lead carries a first-contact clock. If it has no owner, "Take and call" makes it yours and opens the call.',
    },
    href: '/leads',
    cta: { es: 'Ir a Leads', en: 'Go to Leads' },
  },
  find: {
    key: 'find',
    title: { es: 'Busca un comercio por nombre o por teléfono', en: 'Find a merchant by name or phone' },
    why: {
      es: 'El buscador de arriba encuentra por nombre, teléfono, contacto o ID. Abre la ficha: ahí están el hilo, el árbol y los datos.',
      en: 'The search box at the top finds by name, phone, contact or ID. Open the record: the thread, the tree and the details are there.',
    },
    href: '/comercios',
    cta: { es: 'Ir a Comercios', en: 'Go to Merchants' },
  },
  note: {
    key: 'note',
    title: { es: 'Deja una nota en la ficha de un comercio', en: 'Leave a note on a merchant record' },
    why: {
      es: 'Lo que hablaste con el comercio va en su hilo, no en tu teléfono. Desde la ficha también llamas o escribes por WhatsApp.',
      en: 'What you discussed with the merchant goes in its thread, not on your phone. From the record you can also call or message on WhatsApp.',
    },
    href: '/comercios',
    cta: { es: 'Ir a Comercios', en: 'Go to Merchants' },
  },
  nostep: {
    key: 'nostep',
    title: { es: 'Ponle próximo paso a tus negocios que no lo tienen', en: 'Give a next step to your deals that have none' },
    why: {
      es: 'Los negocios que venían de Pipedrive llegaron sin próximo paso. En Negocios, el filtro "Sin próximo paso" te los junta.',
      en: 'Deals that came from Pipedrive arrived with no next step. In Deals, the "No next step" filter gathers them for you.',
    },
    href: '/pipelines',
    cta: { es: 'Ir a Negocios', en: 'Go to Deals' },
  },
  team: {
    key: 'team',
    title: { es: 'Abre Mi equipo y revisa quién va tarde', en: 'Open My team and see who is running late' },
    why: {
      es: 'Ves por persona sus leads abiertos, el primer intento a tiempo, el contacto logrado y los negocios sin próximo paso.',
      en: 'Per person you see open leads, first attempt on time, reached, and deals with no next step.',
    },
    href: '/supervisor',
    cta: { es: 'Ir a Mi equipo', en: 'Go to My team' },
  },
  reassign: {
    key: 'reassign',
    title: { es: 'Reasigna un lead o un comercio', en: 'Reassign a lead or a merchant' },
    why: {
      es: 'Cuando alguien sale o cambia de zona, tú cambias el dueño desde el detalle del lead o la ficha del comercio. Queda en la bitácora.',
      en: 'When someone leaves or changes territory, you change the owner from the lead detail or the merchant record. It is logged.',
    },
    href: '/leads',
    cta: { es: 'Ir a Leads', en: 'Go to Leads' },
  },
  board: {
    key: 'board',
    title: { es: 'Mira el tablero de negocios de tu mercado', en: 'Look at the deals board for your market' },
    why: {
      es: 'Cada columna es una etapa con su conteo y su monto. Una tarjeta en ámbar no tiene próximo paso.',
      en: 'Each column is a stage with its count and amount. An amber card has no next step.',
    },
    href: '/pipelines',
    cta: { es: 'Ir a Negocios', en: 'Go to Deals' },
  },
  panel: {
    key: 'panel',
    title: { es: 'Abre el Panel del LT', en: 'Open the Leadership panel' },
    why: {
      es: 'Por mercado: leads del mes, primer intento a tiempo, contacto logrado, negocios por etapa y comercios en riesgo.',
      en: 'Per market: leads this month, first attempt on time, reached, deals by stage and merchants at risk.',
    },
    href: '/panel-lt',
    cta: { es: 'Ir al Panel del LT', en: 'Go to the Leadership panel' },
  },
  handoff: {
    key: 'handoff',
    title: { es: 'Encuentra en Negocios los que ya están en tus etapas', en: 'Find in Deals the ones already in your stages' },
    why: {
      es: 'Ventas lleva el negocio hasta la firma. Desde ahí sigue contigo: en el tablero, las etapas de aprobación y alta son las tuyas.',
      en: 'Sales carries the deal up to signing. From there it is yours: on the board, the approval and setup stages are the ones you own.',
    },
    href: '/pipelines',
    cta: { es: 'Ir a Negocios', en: 'Go to Deals' },
  },
  move: {
    key: 'move',
    title: { es: 'Mueve un negocio de etapa', en: 'Move a deal to the next stage' },
    why: {
      es: 'Puedes editar y mover los negocios de tu mercado. Cada cambio queda con tu nombre en la bitácora.',
      en: 'You can edit and move the deals of your market. Every change is logged with your name.',
    },
    href: '/pipelines',
    cta: { es: 'Ir a Negocios', en: 'Go to Deals' },
  },
  merchantData: {
    key: 'merchant-data',
    title: { es: 'Completa los datos de un comercio', en: 'Complete the details of a merchant' },
    why: {
      es: 'En la pestaña Datos de la ficha corriges teléfono, contactos y campos propios del comercio.',
      en: 'In the Details tab of the record you fix the phone, the contacts and the merchant\'s own fields.',
    },
    href: '/comercios',
    cta: { es: 'Ir a Comercios', en: 'Go to Merchants' },
  },
  readonly: {
    key: 'readonly',
    title: { es: 'Recorre Negocios y Comercios', en: 'Browse Deals and Merchants' },
    why: {
      es: 'Tu acceso es de solo lectura en todos los mercados: ves todo y no cambias nada, así que puedes explorar con confianza.',
      en: 'Your access is read-only across all markets: you see everything and change nothing, so you can explore freely.',
    },
    href: '/pipelines',
    cta: { es: 'Ir a Negocios', en: 'Go to Deals' },
  },
  access: {
    key: 'access',
    title: { es: 'Revisa quién tiene acceso y con qué rol', en: 'Review who has access and with which role' },
    why: {
      es: 'En Administración, Personas: das acceso agregando un rol y lo quitas cerrándolo. Nada se borra y todo queda en la bitácora.',
      en: 'In Admin, People: you give access by adding a role and remove it by ending it. Nothing is deleted and everything is logged.',
    },
    href: '/admin?tab=personas',
    cta: { es: 'Ir a Personas', en: 'Go to People' },
  },
  pipelines: {
    key: 'pipelines',
    title: { es: 'Revisa cómo se gana un negocio en cada embudo', en: 'Review how a deal is won in each pipeline' },
    why: {
      es: 'Cada embudo se gana a mano o con la primera transacción. Durante el piloto los de alta se ganan a mano.',
      en: 'Each pipeline is won by hand or by the first transaction. During the pilot, enrollment pipelines are won by hand.',
    },
    href: '/admin?tab=embudos',
    cta: { es: 'Ir a Embudos', en: 'Go to Pipelines' },
  },
  quality: {
    key: 'quality',
    title: { es: 'Abre Calidad de datos', en: 'Open Data quality' },
    why: {
      es: 'Ahí salen los posibles duplicados y los registros sin dueño. Es lo primero que conviene limpiar después de la importación.',
      en: 'Possible duplicates and records with no owner show up there. It is the first thing to clean after the import.',
    },
    href: '/admin?tab=calidad',
    cta: { es: 'Ir a Calidad', en: 'Go to Data quality' },
  },
  audit: {
    key: 'audit',
    title: { es: 'Mira la bitácora', en: 'Look at the audit log' },
    why: {
      es: 'Quién cambió qué y cuándo: accesos, etapas, dueños, configuración e inicios de sesión.',
      en: 'Who changed what and when: access, stages, owners, configuration and sign-ins.',
    },
    href: '/admin?tab=auditoria',
    cta: { es: 'Ir a la bitácora', en: 'Go to the audit log' },
  },
  help: {
    key: 'help',
    title: { es: 'Guarda dónde está la Ayuda', en: 'Note where Help is' },
    why: {
      es: 'En tu menú (tu inicial, arriba a la derecha) están la Ayuda y estos primeros pasos, por si quieres volver.',
      en: 'In your menu (your initial, top right) you will find Help and these first steps, in case you want to come back.',
    },
    href: '/ayuda',
    cta: { es: 'Abrir Ayuda', en: 'Open Help' },
  },
} satisfies Record<string, Step>

export const STEPS: Record<Track, Step[]> = {
  rep: [S.today, S.complete, S.leads, S.find, S.note, S.nostep, S.help],
  supervisor: [S.team, S.reassign, S.board, S.today, S.complete, S.nostep, S.help],
  lead: [S.panel, S.team, S.board, S.reassign, S.nostep, S.help],
  ops: [S.handoff, S.move, S.merchantData, S.find, S.note, S.help],
  lt: [S.panel, S.team, S.readonly, S.help],
  admin: [S.access, S.pipelines, S.quality, S.audit, S.panel, S.help],
}

export type Intro = { lead: L; how: { title: L; text: L }[] }

const HOW = {
  queue: {
    title: { es: 'Hoy te dice qué sigue', en: 'Today tells you what is next' },
    text: {
      es: 'Arriba, lo siguiente: el pendiente más urgente, con el botón para llamar. Abajo, lo vencido, lo de hoy y las sugerencias.',
      en: 'At the top, what is next: the most urgent item, with the call button. Below, overdue, today and suggestions.',
    },
  },
  done: {
    title: { es: 'Al terminar, dices cómo te fue', en: 'When you finish, you say how it went' },
    text: {
      es: 'Tocas el círculo, eliges el resultado y dejas el próximo paso con fecha. Son tres toques.',
      en: 'Tap the circle, pick the result and leave the next step with a date. Three taps.',
    },
  },
  record: {
    title: { es: 'Todo lo de un comercio está en su ficha', en: 'Everything about a merchant is on its record' },
    text: {
      es: 'El hilo junta notas, llamadas, cambios de etapa y de dueño. El árbol muestra la cadena y sus tiendas.',
      en: 'The thread gathers notes, calls, stage and owner changes. The tree shows the chain and its stores.',
    },
  },
  deals: {
    title: { es: 'Un negocio siempre lleva próximo paso', en: 'A deal always carries a next step' },
    text: {
      es: 'En el tablero mueves la tarjeta de etapa. Si la etapa pide algo (quién decide, un dato), te lo dice ahí mismo.',
      en: 'On the board you move the card to the next stage. If the stage needs something (who decides, a detail), it tells you right there.',
    },
  },
  teamView: {
    title: { es: 'Mi equipo: una fila por persona', en: 'My team: one row per person' },
    text: {
      es: 'Leads abiertos y tardíos, primer intento a tiempo, contacto logrado, negocios sin próximo paso y revisitas.',
      en: 'Open and late leads, first attempt on time, reached, deals with no next step and revisits.',
    },
  },
  owners: {
    title: { es: 'Tú decides quién es dueño de qué', en: 'You decide who owns what' },
    text: {
      es: 'Reasignas leads y comercios de tu equipo. Los leads sin dueño los ve cualquier vendedor del mercado y los puede tomar.',
      en: 'You reassign your team\'s leads and merchants. Leads with no owner are visible to any seller in the market, who can take them.',
    },
  },
  market: {
    title: { es: 'Ves todo tu mercado', en: 'You see your whole market' },
    text: {
      es: 'Todos los embudos, todos los equipos y los registros que quedaron a nombre de la cuenta de la casa o de personas que ya no están.',
      en: 'Every pipeline, every team, and the records still held by the house account or by people who have left.',
    },
  },
  numbers: {
    title: { es: 'De dónde salen los números', en: 'Where the numbers come from' },
    text: {
      es: 'De lo que el equipo registra en CONTIGO. Las visitas de campo y la primera venta llegarán solas cuando se conecten la Sales App y S5.',
      en: 'From what the team logs in CONTIGO. Field visits and the first sale will arrive on their own once the Sales App and S5 are connected.',
    },
  },
  after: {
    title: { es: 'Recibes el negocio después del alta', en: 'You receive the deal after enrollment' },
    text: {
      es: 'Lo encuentras en el tablero, en las etapas que te tocan. Lo editas, lo mueves y completas los datos del comercio. No creas negocios ni trabajas leads.',
      en: 'You find it on the board, in the stages you own. You edit it, move it and complete the merchant details. You do not create deals or work leads.',
    },
  },
  readOnly: {
    title: { es: 'Ves todo y no cambias nada', en: 'You see everything and change nothing' },
    text: {
      es: 'Tu acceso es de solo lectura en todos los mercados. Los botones para crear o editar no aparecen.',
      en: 'Your access is read-only across all markets. The buttons to create or edit do not appear.',
    },
  },
  config: {
    title: { es: 'Administración tiene siete pestañas', en: 'Admin has seven tabs' },
    text: {
      es: 'Personas, Embudos, Entrada de leads, Integraciones, Pipedrive, Calidad de datos y Bitácora.',
      en: 'People, Pipelines, Lead intake, Integrations, Pipedrive, Data quality and Audit log.',
    },
  },
  logged: {
    title: { es: 'Todo cambio queda escrito', en: 'Every change is written down' },
    text: {
      es: 'Accesos, dueños, etapas y configuración quedan en la bitácora con quién, qué y cuándo. Nada se borra: se cierra con fecha.',
      en: 'Access, owners, stages and configuration are logged with who, what and when. Nothing is deleted: it is ended with a date.',
    },
  },
} satisfies Record<string, { title: L; text: L }>

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
    lead: { es: 'Tú mantienes la herramienta: accesos, embudos, entrada de leads, integraciones y la calidad de los datos.', en: 'You keep the tool running: access, pipelines, lead intake, integrations and data quality.' },
    how: [HOW.config, HOW.logged, HOW.numbers, HOW.market],
  },
}

// ---------------------------------------------------------------- ayuda
export type HelpTopic = 'start' | 'today' | 'leads' | 'deals' | 'merchants' | 'team' | 'data' | 'access' | 'admin'
export type HelpItem = { id: string; topic: HelpTopic; tracks: 'all' | Track[]; q: L; a: L }

export const HELP_TOPICS: Record<HelpTopic, L> = {
  start: { es: 'Para empezar', en: 'Getting started' },
  today: { es: 'Hoy y el próximo paso', en: 'Today and the next step' },
  leads: { es: 'Leads', en: 'Leads' },
  deals: { es: 'Negocios', en: 'Deals' },
  merchants: { es: 'Comercios', en: 'Merchants' },
  team: { es: 'Equipo y dueños', en: 'Team and owners' },
  data: { es: 'Datos, Pipedrive e integraciones', en: 'Data, Pipedrive and integrations' },
  access: { es: 'Acceso y permisos', en: 'Access and permissions' },
  admin: { es: 'Administración', en: 'Admin' },
}

const SELL: Track[] = ['rep', 'supervisor', 'lead']
const MANAGE: Track[] = ['supervisor', 'lead', 'admin']

export const HELP: HelpItem[] = [
  {
    id: 'what-is', topic: 'start', tracks: 'all',
    q: { es: '¿Qué es CONTIGO?', en: 'What is CONTIGO?' },
    a: { es: 'Es el CRM de axexo: leads, negocios, comercios y su seguimiento en un solo lugar, para todos los mercados. Reemplaza a Pipedrive.', en: 'It is axexo\'s CRM: leads, deals, merchants and their follow-up in one place, for every market. It replaces Pipedrive.' },
  },
  {
    id: 'pipedrive', topic: 'start', tracks: 'all',
    q: { es: '¿Sigo usando Pipedrive?', en: 'Do I keep using Pipedrive?' },
    a: { es: 'Durante la prueba, sí: Pipedrive sigue siendo el sistema de trabajo y CONTIGO tiene una copia de sus datos para probar. Lo que registres aquí no vuelve a Pipedrive. Te avisaremos la fecha del cambio.', en: 'During the trial, yes: Pipedrive remains the working system and CONTIGO holds a copy of its data for testing. What you log here does not go back to Pipedrive. We will tell you the switch date.' },
  },
  {
    id: 'phone', topic: 'start', tracks: 'all',
    q: { es: '¿Funciona en el teléfono?', en: 'Does it work on a phone?' },
    a: { es: 'Sí. Es la misma dirección en el navegador del teléfono y la pantalla se acomoda sola. No hay una app que instalar. Puedes agregarla a tu pantalla de inicio desde el menú del navegador.', en: 'Yes. It is the same address in your phone\'s browser and the screen adapts on its own. There is no app to install. You can add it to your home screen from the browser menu.' },
  },
  {
    id: 'offline', topic: 'start', tracks: 'all',
    q: { es: '¿Qué pasa si me quedo sin señal?', en: 'What happens if I lose signal?' },
    a: { es: 'Aparece un aviso arriba y los botones de guardar se detienen para que no pierdas nada. Lo que ya está en pantalla lo puedes leer. Cuando vuelve la señal sigues donde estabas. Todavía no se puede trabajar sin conexión.', en: 'A notice appears at the top and the save buttons pause so you lose nothing. You can read what is already on screen. When the signal returns you carry on where you were. Working offline is not available yet.' },
  },
  {
    id: 'language', topic: 'start', tracks: 'all',
    q: { es: '¿Cómo cambio el idioma?', en: 'How do I change the language?' },
    a: { es: 'En tu menú (tu inicial, arriba a la derecha) está el cambio entre español e inglés. Se queda guardado.', en: 'In your menu (your initial, top right) you can switch between Spanish and English. It stays saved.' },
  },
  {
    id: 'today-order', topic: 'today', tracks: ['rep', 'supervisor', 'lead', 'ops'],
    q: { es: '¿Cómo se ordena mi cola de Hoy?', en: 'How is my Today queue sorted?' },
    a: { es: 'Primero los leads con el reloj corriendo, luego lo vencido, luego lo de hoy y al final hasta cinco sugerencias, una por comercio, empezando por las más importantes.', en: 'First leads with the clock running, then overdue, then today, and finally up to five suggestions, one per merchant, most important first.' },
  },
  {
    id: 'suggestions', topic: 'today', tracks: ['rep', 'supervisor', 'lead', 'ops'],
    q: { es: '¿Qué es una sugerencia y por qué solo veo cinco?', en: 'What is a suggestion and why do I only see five?' },
    a: { es: 'Es un aviso de CONTIGO: un negocio sin próximo paso, uno que lleva mucho en la misma etapa, una revisita pendiente. Se muestran cinco por día para que la cola se pueda terminar. El resto está en Negocios, con el filtro "Sin próximo paso".', en: 'It is a notice from CONTIGO: a deal with no next step, one stuck in a stage, a pending revisit. Five show per day so the queue can be finished. The rest are in Deals, under the "No next step" filter.' },
  },
  {
    id: 'next-step', topic: 'today', tracks: ['rep', 'supervisor', 'lead', 'ops'],
    q: { es: '¿Por qué siempre me pide el próximo paso?', en: 'Why does it always ask for the next step?' },
    a: { es: 'Porque un negocio abierto sin próximo paso es un negocio que nadie está moviendo. Si de verdad no hay nada que hacer, puedes cerrar la tarea sin programar otra, salvo en dos casos: un lead que no contestó y una sugerencia.', en: 'Because an open deal with no next step is a deal nobody is moving. If there is truly nothing to do, you can close the task without scheduling another, except in two cases: a lead that did not answer and a suggestion.' },
  },
  {
    id: 'log-activity', topic: 'today', tracks: ['rep', 'supervisor', 'lead', 'ops'],
    q: { es: '¿Cómo registro algo que no estaba en mi cola?', en: 'How do I log something that was not in my queue?' },
    a: { es: 'Busca el comercio (arriba, por nombre o teléfono), abre su ficha y toca Nota o Actividad. Todo lo que registras queda ligado a un comercio, un lead o un negocio.', en: 'Find the merchant (top bar, by name or phone), open its record and tap Note or Activity. Everything you log is tied to a merchant, a lead or a deal.' },
  },
  {
    id: 'visits', topic: 'today', tracks: 'all',
    q: { es: '¿Dónde registro mis visitas?', en: 'Where do I log my visits?' },
    a: { es: 'Las visitas se registran en la Sales App, no aquí. Cuando la Sales App se conecte, cada visita aparecerá sola en el hilo del comercio. Mientras tanto, si necesitas dejar constancia, usa una nota en la ficha.', en: 'Visits are logged in the Sales App, not here. Once the Sales App is connected, each visit will show up on its own in the merchant\'s thread. Until then, if you need a record, leave a note on the merchant.' },
  },
  {
    id: 'lead-clock', topic: 'leads', tracks: SELL,
    q: { es: '¿Qué mide el reloj de un lead?', en: 'What does a lead\'s clock measure?' },
    a: { es: 'El tiempo que queda para el primer intento de contacto. Se detiene cuando registras la llamada, aunque no conteste. El lead pasa a "Contactado" solo cuando hablaste con la persona.', en: 'The time left for the first contact attempt. It stops when you log the call, even if there is no answer. The lead becomes "Contacted" only when you spoke to the person.' },
  },
  {
    id: 'lead-take', topic: 'leads', tracks: SELL,
    q: { es: '¿Puedo tomar un lead sin dueño?', en: 'Can I take a lead with no owner?' },
    a: { es: 'Sí, si es de tu mercado. "Tomar y llamar" lo deja a tu nombre y abre la llamada. No puedes tomar el lead de otra persona: eso lo reasigna tu supervisor.', en: 'Yes, if it is in your market. "Take and call" makes it yours and opens the call. You cannot take someone else\'s lead: your supervisor reassigns it.' },
  },
  {
    id: 'lead-imported', topic: 'leads', tracks: SELL,
    q: { es: '¿Por qué tengo tantos leads sin reloj?', en: 'Why do I have so many leads with no clock?' },
    a: { es: 'Son los que venían de Pipedrive. No traen reloj y no entran a tu cola de Hoy para no llenarla. Están en Leads para que los trabajes o los descartes a tu ritmo.', en: 'They came from Pipedrive. They carry no clock and do not enter your Today queue so it does not fill up. They sit in Leads for you to work or discard at your own pace.' },
  },
  {
    id: 'deal-move', topic: 'deals', tracks: ['rep', 'supervisor', 'lead', 'ops'],
    q: { es: '¿Por qué no me deja mover un negocio de etapa?', en: 'Why can I not move a deal to the next stage?' },
    a: { es: 'Cada etapa pide lo suyo: un próximo paso con fecha, quién decide, algún dato. El mensaje te dice qué falta. No se puede saltar etapas para evitarlo.', en: 'Each stage asks for something: a dated next step, who decides, a detail. The message tells you what is missing. You cannot skip stages to avoid it.' },
  },
  {
    id: 'deal-won', topic: 'deals', tracks: 'all',
    q: { es: '¿Cómo se gana un negocio?', en: 'How is a deal won?' },
    a: { es: 'Durante la prueba, a mano: lo mueves a la etapa de ganado. Más adelante los negocios de alta se ganarán solos cuando el comercio haga su primera transacción.', en: 'During the trial, by hand: you move it to the won stage. Later on, enrollment deals will be won automatically when the merchant makes its first transaction.' },
  },
  {
    id: 'deal-currency', topic: 'deals', tracks: 'all',
    q: { es: '¿Por qué los montos no se suman entre monedas?', en: 'Why are amounts not added across currencies?' },
    a: { es: 'Cada total va en su moneda. CONTIGO no convierte pesos a dólares ni al revés.', en: 'Each total stays in its currency. CONTIGO does not convert pesos to dollars or back.' },
  },
  {
    id: 'merchant-find', topic: 'merchants', tracks: 'all',
    q: { es: '¿Cómo encuentro un comercio?', en: 'How do I find a merchant?' },
    a: { es: 'Con el buscador de arriba: por nombre, teléfono, nombre del contacto o ID. En escritorio, la tecla "/" te lleva al buscador.', en: 'With the search box at the top: by name, phone, contact name or ID. On a desktop, the "/" key takes you to the search box.' },
  },
  {
    id: 'merchant-health', topic: 'merchants', tracks: 'all',
    q: { es: '¿Qué significa la salud de un comercio?', en: 'What does a merchant\'s health mean?' },
    a: { es: 'Activo: está vendiendo. Sin transaccionar: ya se dio de alta y todavía no vende. En riesgo: bajó o dejó de vender. Lead nuevo: todavía es prospecto. Estos estados dependen de los datos de transacciones, que aún no están conectados.', en: 'Active: it is selling. Not transacting: it enrolled and is not selling yet. At risk: sales dropped or stopped. New lead: still a prospect. These states depend on transaction data, which is not connected yet.' },
  },
  {
    id: 'merchant-tree', topic: 'merchants', tracks: 'all',
    q: { es: '¿Para qué sirve el árbol?', en: 'What is the tree for?' },
    a: { es: 'Muestra la cadena o el distribuidor y las tiendas que cuelgan de él, con sus totales. Sirve para ver una cuenta completa y no tienda por tienda.', en: 'It shows the chain or distributor and the stores under it, with totals. It lets you see a whole account instead of store by store.' },
  },
  {
    id: 'see-what', topic: 'team', tracks: 'all',
    q: { es: '¿Qué puedo ver?', en: 'What can I see?' },
    a: { es: 'Ventas ve lo suyo y los leads sin dueño de su mercado. Supervisión, lo de su equipo. Líder de mercado y Operaciones, todo su mercado. Leadership, todos los mercados en solo lectura.', en: 'Sales sees their own records and the unowned leads of their market. Supervisors, their team\'s. Market leads and Operations, their whole market. Leadership, every market, read-only.' },
  },
  {
    id: 'reassign', topic: 'team', tracks: MANAGE,
    q: { es: '¿Cómo reasigno un lead o un comercio?', en: 'How do I reassign a lead or a merchant?' },
    a: { es: 'Desde el detalle del lead o la ficha del comercio, en Dueño. Se hace uno por uno; todavía no hay reasignación en bloque.', en: 'From the lead detail or the merchant record, under Owner. It is done one at a time; there is no bulk reassignment yet.' },
  },
  {
    id: 'house-account', topic: 'team', tracks: MANAGE,
    q: { es: '¿De quién son los registros que nadie atiende?', en: 'Who owns the records nobody is working?' },
    a: { es: 'Los que venían a nombre de una cuenta de servicio o de alguien que ya no está siguen así hasta que el líder del mercado los reparta. El líder de mercado los ve todos.', en: 'Records that came under a service account or someone who has left stay that way until the market lead distributes them. The market lead sees them all.' },
  },
  {
    id: 'metrics', topic: 'team', tracks: ['supervisor', 'lead', 'lt', 'admin'],
    q: { es: '¿Qué diferencia hay entre "Primer intento a tiempo" y "Contacto logrado"?', en: 'What is the difference between "First attempt on time" and "Reached"?' },
    a: { es: 'El primero cuenta los leads en los que se intentó el contacto dentro del plazo. El segundo, aquellos en los que se habló con la persona. Los dos se calculan sobre los mismos leads.', en: 'The first counts leads where contact was attempted within the deadline. The second, those where the person was actually spoken to. Both are computed over the same leads.' },
  },
  {
    id: 'data-source', topic: 'data', tracks: 'all',
    q: { es: '¿De dónde salieron los datos que veo?', en: 'Where did the data I see come from?' },
    a: { es: 'De una copia de Pipedrive: comercios, contactos, negocios, leads, notas y productos de US y de México. Lo que cambies en Pipedrive después de esa copia no aparece aquí.', en: 'From a copy of Pipedrive: merchants, contacts, deals, leads, notes and products for the US and Mexico. What you change in Pipedrive after that copy does not show up here.' },
  },
  {
    id: 'sales-app', topic: 'data', tracks: 'all',
    q: { es: '¿CONTIGO ya está conectado con la Sales App y con S5?', en: 'Is CONTIGO already connected to the Sales App and S5?' },
    a: { es: 'Todavía no. Está listo para recibir las visitas y las tiendas nuevas de la Sales App y las transacciones de S5, pero esas conexiones aún no están encendidas.', en: 'Not yet. It is ready to receive visits and new stores from the Sales App and transactions from S5, but those connections are not switched on yet.' },
  },
  {
    id: 'export', topic: 'data', tracks: 'all',
    q: { es: '¿Puedo exportar a Excel o armar mis propios reportes?', en: 'Can I export to Excel or build my own reports?' },
    a: { es: 'Todavía no. Lo que hay hoy es Mi equipo y el Panel del LT. Si necesitas un dato que no está ahí, pídelo a quien administra CONTIGO.', en: 'Not yet. What exists today is My team and the Leadership panel. If you need a figure that is not there, ask a CONTIGO admin.' },
  },
  {
    id: 'sensitive', topic: 'data', tracks: 'all',
    q: { es: '¿Qué no debo escribir en una nota?', en: 'What should I not write in a note?' },
    a: { es: 'Números de tarjeta, cuentas bancarias, CLABE, números de seguro social, contraseñas ni identificaciones oficiales completas. CONTIGO rechaza los que reconoce. Los documentos del comercio se quedan fuera del CRM.', en: 'Card numbers, bank accounts, CLABE, Social Security numbers, passwords or full official IDs. CONTIGO refuses the ones it recognizes. Merchant documents stay outside the CRM.' },
  },
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
    id: 'admin-access', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo doy o quito acceso?', en: 'How do I give or remove access?' },
    a: { es: 'Administración, Personas. Dar acceso es agregar un rol con su mercado. Quitarlo es cerrar ese rol: la persona deja de entrar cuando vence su sesión, en 12 horas como máximo.', en: 'Admin, People. Giving access is adding a role with its market. Removing it is ending that role: the person stops getting in when their session expires, 12 hours at most.' },
  },
  {
    id: 'admin-teams', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo creo un equipo?', en: 'How do I create a team?' },
    a: { es: 'Todavía no hay pantalla para eso: los equipos se cargan por base de datos. Pídelo a quien mantiene CONTIGO.', en: 'There is no screen for that yet: teams are loaded in the database. Ask whoever maintains CONTIGO.' },
  },
  {
    id: 'admin-win', topic: 'admin', tracks: ['admin'],
    q: { es: '¿Cómo cambio la forma en que se gana un negocio en un embudo?', en: 'How do I change how a deal is won in a pipeline?' },
    a: { es: 'Administración, Embudos. Cada embudo tiene un interruptor: a mano o por primera transacción. El cambio queda en la bitácora.', en: 'Admin, Pipelines. Each pipeline has a switch: by hand or by first transaction. The change is logged.' },
  },
]

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
      { track: 'rep' as Track, points: [{ es: 'Tu cola de Hoy, tus leads y tus negocios', en: 'Your Today queue, your leads and your deals' }, { es: 'Tomas los leads sin dueño de tu mercado', en: 'You take the unowned leads of your market' }, { es: 'Llamas y escribes por WhatsApp desde la ficha', en: 'You call and message on WhatsApp from the record' }] },
      { track: 'supervisor' as Track, points: [{ es: 'Una fila por persona de tu equipo', en: 'One row per person on your team' }, { es: 'Reasignas leads y comercios', en: 'You reassign leads and merchants' }, { es: 'Ves quién va tarde y qué negocio no tiene próximo paso', en: 'You see who is late and which deal has no next step' }] },
      { track: 'lead' as Track, points: [{ es: 'Todo tu mercado: embudos, equipos y cartera', en: 'Your whole market: pipelines, teams and book' }, { es: 'Los registros que quedaron sin un dueño real', en: 'The records left without a real owner' }, { es: 'El Panel del LT de tu mercado', en: 'The Leadership panel for your market' }] },
      { track: 'ops' as Track, points: [{ es: 'Recibes el negocio después del alta', en: 'You receive the deal after enrollment' }, { es: 'Lo editas y lo mueves hasta el final', en: 'You edit it and move it to the end' }, { es: 'Completas los datos del comercio', en: 'You complete the merchant details' }] },
      { track: 'lt' as Track, points: [{ es: 'Todos los mercados, en solo lectura', en: 'Every market, read-only' }, { es: 'Embudo, respuesta a leads y comercios en riesgo', en: 'Pipeline, lead response and merchants at risk' }, { es: 'Sin pedir reportes a nadie', en: 'Without asking anyone for reports' }] },
      { track: 'admin' as Track, points: [{ es: 'Accesos, embudos y entrada de leads', en: 'Access, pipelines and lead intake' }, { es: 'Calidad de datos e importación desde Pipedrive', en: 'Data quality and the Pipedrive import' }, { es: 'Bitácora de cada cambio', en: 'An audit log of every change' }] },
    ],
  },
  status: {
    eyebrow: { es: 'Sin sorpresas', en: 'No surprises' },
    title: { es: 'Qué ya funciona y qué viene.', en: 'What works today and what is coming.' },
    text: {
      es: 'Estás entrando a una prueba. Esto es lo que ya puedes usar y lo que todavía no está conectado.',
      en: 'You are joining a trial. This is what you can use already and what is not connected yet.',
    },
    rows: [
      { label: { es: 'Hoy, leads, negocios y comercios', en: 'Today, leads, deals and merchants' }, state: 'on' as const },
      { label: { es: 'Datos de Pipedrive de US y de México', en: 'Pipedrive data for the US and Mexico' }, state: 'on' as const },
      { label: { es: 'Teléfono, tablet y escritorio, en español y en inglés', en: 'Phone, tablet and desktop, in Spanish and English' }, state: 'on' as const },
      { label: { es: 'Visitas de campo desde la Sales App', en: 'Field visits from the Sales App' }, state: 'soon' as const },
      { label: { es: 'Primera venta de cada comercio desde S5', en: 'Each merchant\'s first sale from S5' }, state: 'soon' as const },
      { label: { es: 'Exportes, reportes propios y trabajo sin conexión', en: 'Exports, custom reports and offline work' }, state: 'soon' as const },
    ],
    on: { es: 'Funcionando', en: 'Working' },
    soon: { es: 'Próximamente', en: 'Coming soon' },
  },
  facts: {
    title: { es: 'Pensado para que no se te quede nada.', en: 'Built so nothing slips.' },
    cards: [
      { figure: '5', title: { es: 'sugerencias al día', en: 'suggestions a day' }, text: { es: 'Las más importantes primero, una por comercio. Una cola que se puede terminar.', en: 'Most important first, one per merchant. A queue you can finish.' } },
      { figure: '1', title: { es: 'próximo paso por negocio', en: 'next step per deal' }, text: { es: 'Con fecha. Un negocio abierto sin próximo paso se marca en ámbar.', en: 'With a date. An open deal with no next step turns amber.' } },
      { figure: '2', title: { es: 'idiomas', en: 'languages' }, text: { es: 'Español e inglés, con el cambio en tu menú.', en: 'Spanish and English, with the switch in your menu.' } },
      { figure: '0', title: { es: 'licencias por usuario', en: 'per-user licenses' }, text: { es: 'Es de axexo: sumar a alguien al equipo no cuesta una licencia más.', en: 'It belongs to axexo: adding someone to the team does not cost another license.' } },
    ],
  },
  cta: {
    title: { es: 'Entra con tu cuenta de trabajo.', en: 'Sign in with your work account.' },
    text: { es: 'La primera vez te recibe una guía corta con tus primeros pasos.', en: 'The first time, a short guide welcomes you with your first steps.' },
    secondary: { es: 'Leer las preguntas', en: 'Read the questions' },
  },
  faq: {
    eyebrow: { es: 'Antes de entrar', en: 'Before you sign in' },
    title: { es: '¿Tienes dudas?', en: 'Have questions?' },
    ids: ['sign-in', 'pipedrive', 'phone', 'data-source', 'see-what', 'visits'],
  },
  help: {
    title: { es: 'La ayuda está adentro.', en: 'Help is inside.' },
    text: { es: 'Ya con tu sesión abierta, en tu menú encuentras la Ayuda y tus primeros pasos.', en: 'Once you are signed in, your menu has Help and your first steps.' },
  },
  footer: {
    tagline: { es: 'El CRM de axexo, para todos los mercados.', en: 'axexo\'s CRM, for every market.' },
    note: { es: 'Herramienta interna de axexo. Uso exclusivo del equipo.', en: 'Internal axexo tool. For team use only.' },
  },
}
