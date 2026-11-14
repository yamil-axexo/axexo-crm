// Ayuda contextual (GOB-10): qué preguntas de la Ayuda responden "¿cómo se usa esta pantalla?".
// Solo apunta a preguntas que ya existen en guide.ts; una prueba falla si alguna deja de existir.
type Pair = [es: string, en: string]

export const SCREEN_HELP: { prefix: string; name: Pair; ids: string[] }[] = [
  { prefix: '/hoy', name: ['Hoy', 'Today'], ids: ['today-order', 'next-step', 'today-empty'] },
  { prefix: '/leads', name: ['Leads', 'Leads'], ids: ['lead-new', 'lead-clock', 'lead-convert'] },
  { prefix: '/pipelines', name: ['Negocios', 'Deals'], ids: ['deal-move', 'deal-won', 'deal-lost'] },
  { prefix: '/deals', name: ['Detalle de un negocio o de un pedido', 'A deal or an order page'], ids: ['deal-move', 'ops-handoff', 'merchant-order'] },
  { prefix: '/comercios', name: ['Comercios', 'Merchants'], ids: ['merchant-new', 'merchant-find', 'merchant-contacts'] },
  { prefix: '/actividades', name: ['Actividades', 'Activities'], ids: ['log-activity', 'visits', 'remind'] },
  { prefix: '/buscar', name: ['Buscar', 'Search'], ids: ['merchant-find', 'lead-find'] },
  { prefix: '/supervisor', name: ['Mi equipo', 'My team'], ids: ['team-views', 'exceptions', 'reassign'] },
  { prefix: '/operaciones', name: ['Cola de Operaciones', 'Operations queue'], ids: ['ops-queue', 'ops-return', 'ops-fields'] },
  { prefix: '/panel-lt', name: ['Panel del LT', 'Leadership panel'], ids: ['panel-how', 'numbers-source', 'metrics'] },
  { prefix: '/reportes', name: ['Reportes', 'Reports'], ids: ['closed-deals', 'field-report', 'adoption'] },
  { prefix: '/admin', name: ['Administración', 'Administration'], ids: ['admin-access', 'admin-stage', 'admin-audit'] },
  { prefix: '/estado', name: ['Estado de CONTIGO', 'CONTIGO status'], ids: ['data-source', 'pipedrive'] },
  { prefix: '/avisos', name: ['Avisos', 'Notices'], ids: ['notify-receiver', 'notice-note', 'lead-alert'] },
  { prefix: '/anuncios', name: ['Anuncios', 'Announcements'], ids: ['who-sees-changes', 'who-to-ask'] },
  { prefix: '/reportar', name: ['Reportar un problema', 'Report a problem'], ids: ['report-problem', 'report-answer', 'report-what'] },
]

/** La pantalla de ayuda que corresponde a una ruta: la primera cuyo prefijo coincide. */
export function screenHelpFor(path: string | null | undefined) {
  if (!path) return null
  return SCREEN_HELP.find((s) => path === s.prefix || path.startsWith(`${s.prefix}/`)) ?? null
}
