import type { Capability } from '@/domain/policy'

type Pair = [es: string, en: string]

/**
 * La galería de Reportes: UNA lista con cada reporte del producto, su ruta, para quién es y qué permiso pide.
 * No hay constructor libre de reportes (el catálogo lo descarta): un reporte nuevo se agrega aquí y en su página.
 */
export type ReportDef = { key: string; path: string; title: Pair; desc: Pair; cap: Capability; group: 'sales' | 'field' | 'finance' | 'history' | 'health'; exportable: boolean }

export const REPORTS: ReportDef[] = [
  { key: 'panel-lt', path: '/panel-lt', title: ['Panel del LT', 'Leadership panel'], desc: ['Los números del negocio por mercado, embudo y equipo.', 'The business numbers by market, pipeline and team.'], cap: 'board.lt', group: 'sales', exportable: false },
  { key: 'mi-equipo', path: '/supervisor', title: ['Mi equipo', 'My team'], desc: ['Cómo va cada persona del equipo y qué necesita atención.', 'How each person on the team is doing and what needs attention.'], cap: 'board.supervisor', group: 'sales', exportable: false },
  { key: 'leads', path: '/reportes/leads', title: ['Leads captados y convertidos', 'Leads captured and converted'], desc: ['Por mes, fuente y mercado, con su tasa de conversión.', 'By month, source and market, with the conversion rate.'], cap: 'report.gallery', group: 'sales', exportable: true },
  { key: 'etapas', path: '/reportes/etapas', title: ['Negocios por etapa', 'Deals by stage'], desc: ['Cada embudo con sus etapas, los días en la etapa y los que no tienen próximo paso.', 'Each pipeline with its stages, days in stage and deals with no next step.'], cap: 'report.gallery', group: 'sales', exportable: true },
  { key: 'cerrados', path: '/reportes/cerrados', title: ['Negocios cerrados', 'Closed deals'], desc: ['Ganados y perdidos por persona y periodo.', 'Won and lost by person and period.'], cap: 'report.gallery', group: 'sales', exportable: false },
  { key: 'embudo', path: '/reportes/embudo', title: ['Embudo: motivos, revisitas, próximos pasos y origen', 'Pipeline: reasons, revisits, next steps and origin'], desc: ['Por qué se pierde, qué quedó sin próximo paso, de dónde vienen los leads y qué comercios refieren a otros.', 'Why deals are lost, what has no next step, where leads come from and which merchants refer others.'], cap: 'report.gallery', group: 'sales', exportable: false },
  { key: 'agencias', path: '/reportes/agencias', title: ['Agencia y equipo interno', 'Agency and in-house team'], desc: ['Los negocios que trajo una agencia junto a los del equipo interno.', 'Deals brought in by an agency next to the in-house team’s.'], cap: 'report.view', group: 'sales', exportable: true },
  { key: 'cuentas', path: '/reportes/cuentas', title: ['Cadenas, ISO y cuentas clave', 'Chains, ISOs and key accounts'], desc: ['Cada cadena o distribuidor con la suma de sus tiendas, las etapas largas y los próximos hitos.', 'Each chain or distributor with the sum of its stores, long stages and upcoming milestones.'], cap: 'report.gallery', group: 'sales', exportable: true },
  // reportes2 (REP-01, REP-03): tablero de cuentas clave con el pronóstico por categoría, y el tablero de Operaciones.
  { key: 'kam', path: '/reportes/kam', title: ['Cuentas clave (KAM)', 'Key accounts (KAM)'], desc: ['Las cuentas clave, sus tiendas y las oportunidades con su categoría de pronóstico. El pronóstico se envía por periodo y queda guardado por versión.', 'Key accounts, their stores and the opportunities with their forecast category. The forecast is submitted per period and kept by version.'], cap: 'board.kam', group: 'sales', exportable: false },
  { key: 'operaciones', path: '/reportes/operaciones', title: ['Tablero de Operaciones', 'Operations board'], desc: ['La cola de Operaciones en cifras: expedientes, devueltos, aprobados en mesa de control y entregas sin acuse.', 'The Operations queue in figures: files, returned, approved at the control desk and handoffs not acknowledged.'], cap: 'board.ops', group: 'sales', exportable: false },
  { key: 'pronostico', path: '/reportes/pronostico', title: ['Pronóstico', 'Forecast'], desc: ['Cuántos negocios abiertos se esperan ganar por tipo de venta, con su rango.', 'How many open deals are expected to be won per sales type, with a range.'], cap: 'report.view', group: 'sales', exportable: true },
  // Reporte del mercado (paquete mx, E18.F10): se enlaza desde la galería como los demás; sus descargas están en la propia pantalla.
  { key: 'mercado', path: '/reportes/mercado', title: ['Reporte del mercado', 'Market report'], desc: ['Leads capturados y convertidos, negocios por etapa y conteos por mes, con los leads por tipo de empresa y número de tiendas.', 'Leads captured and converted, deals by stage and monthly counts, with leads by company type and number of stores.'], cap: 'report.view', group: 'sales', exportable: false },
  { key: 'lo-que-llevo', path: '/reportes/lo-que-llevo', title: ['Lo que llevo', 'My running numbers'], desc: ['Tus altas, primeras ventas y tiendas que siguen vendiendo a 30, 60 y 90 días.', 'Your enrolled stores, first sales and stores still selling at 30, 60 and 90 days.'], cap: 'report.carry', group: 'field', exportable: false },
  { key: 'campo', path: '/reportes/campo', title: ['Reporte de campo', 'Field report'], desc: ['Altas y ganados por semana y lugar, y visitas por persona.', 'Stores enrolled and deals won by week and place, and visits by person.'], cap: 'report.view', group: 'field', exportable: false },
  { key: 'indicadores-campo', path: '/reportes/indicadores-campo', title: ['Indicadores de campo', 'Field indicators'], desc: ['Visitas por día, cobertura de cartera y efectividad, con las visitas confirmadas aparte.', 'Visits per day, book coverage and effectiveness, with confirmed visits shown apart.'], cap: 'report.view', group: 'field', exportable: true },
  { key: 'finanzas', path: '/reportes/finanzas', title: ['Finanzas: ganados por periodo', 'Finance: wins by period'], desc: ['Monto ganado por moneda y entidad legal, y el consolidado en USD con la tasa a la vista.', 'Amount won by currency and legal entity, and the USD total with the rate in view.'], cap: 'report.finance', group: 'finance', exportable: true },
  { key: 'consolidado', path: '/reportes/consolidado', title: ['Consolidado en USD', 'Consolidated in USD'], desc: ['Negocios abiertos y ganados en su moneda y en USD, por mercado, entidad legal o unidad de negocio, con la tasa guardada en cada negocio.', 'Open and won deals in their own currency and in USD, by market, legal entity or business unit, with the rate stored on each deal.'], cap: 'board.lt', group: 'finance', exportable: false },
  { key: 'historico', path: '/reportes/historico', title: ['Histórico', 'History'], desc: ['Foto diaria de negocios y cartera, cohortes y velocidad por etapa.', 'Daily snapshot of deals and merchants, cohorts and stage velocity.'], cap: 'report.view', group: 'history', exportable: true },
  { key: 'conciliacion', path: '/reportes/conciliacion', title: ['Conciliación con el archivo de ventas', 'Reconciliation with the sales file'], desc: ['Lo que dice CONTIGO contra lo que dice el archivo diario, con la lista de diferencias.', 'What CONTIGO says against what the daily file says, with the list of differences.'], cap: 'report.reconcile', group: 'health', exportable: true },
  { key: 'adopcion', path: '/reportes/adopcion', title: ['Adopción', 'Adoption'], desc: ['Uso real por persona y equipo: actividades, próximo paso al día y leads atendidos a tiempo.', 'Real use by person and team: activities, next step up to date and leads handled on time.'], cap: 'adoption.team', group: 'health', exportable: false },
  { key: 'indicadores', path: '/reportes/indicadores', title: ['Indicadores y responsables', 'Metrics and owners'], desc: ['Cómo se calcula cada cifra y quién responde por ella.', 'How each figure is calculated and who answers for it.'], cap: 'report.gallery', group: 'health', exportable: false },
]

export const GROUP_LABEL: Record<ReportDef['group'], Pair> = {
  sales: ['Ventas y embudos', 'Sales and pipelines'],
  field: ['Campo y cartera', 'Field and book'],
  finance: ['Finanzas', 'Finance'],
  history: ['Histórico', 'History'],
  health: ['Calidad del dato y uso', 'Data quality and use'],
}

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key)

/** Parámetros de URL que un reporte guardado puede llevar. Todo lo demás se descarta: no hay consultas libres. */
export const REPORT_PARAMS = ['periodo', 'desde', 'hasta', 'mercado', 'embudo', 'equipo', 'persona', 'fuente', 'ver', 'nivel', 'tipo', 'resultado', 'por'] as const

// ------------------------------------------------------------------ vistas guardadas (UX-03)
// reportes2 (E8.F4): también las personas de los comercios (contactos).
export type ViewObject = 'account' | 'lead' | 'deal' | 'activity' | 'contact'
/** Lista blanca de filtros por lista. Una vista es un conjunto de estos valores con nombre, nunca una consulta. */
export const VIEW_FILTERS: Record<ViewObject, readonly string[]> = {
  account: ['q', 'market', 'lifecycle', 'owner', 'kind', 'ver', 'region', 'city', 'territory', 'team', 'pipeline', 'visito', 'fondeo'],
  // tipo, embudo y tiendas: los filtros de campaña de México (tipo de empresa, embudo de campaña y número de tiendas) también se guardan.
  lead: ['market', 'status', 'owner', 'q', 'clock', 'source', 'sort', 'motor', 'equipo', 'tipo', 'embudo', 'tiendas_min', 'tiendas_max'],
  deal: ['pipeline', 'owner', 'paso', 'quietos', 'equipo', 'vista', 'orden'],
  activity: ['view'],
  contact: ['q', 'market', 'role', 'owner'],
}
export const VIEW_OBJECT_LABEL: Record<ViewObject, Pair> = {
  account: ['Comercios', 'Merchants'], lead: ['Leads', 'Leads'], deal: ['Negocios', 'Deals'], activity: ['Actividades', 'Activities'], contact: ['Personas de los comercios', 'Merchant contacts'],
}
const UUID = /^[0-9a-f-]{36}$/
/** La dirección de una vista: la lista con sus filtros. En Negocios, el embudo va en la ruta. */
export function viewHref(v: { id: string; object: ViewObject; filters: Record<string, string> }): string {
  const sp = new URLSearchParams()
  for (const k of VIEW_FILTERS[v.object]) if (v.filters[k] && !(v.object === 'deal' && k === 'pipeline')) sp.set(k, v.filters[k]!)
  sp.set('cola', v.id)
  const base = v.object === 'account' ? '/comercios' : v.object === 'lead' ? '/leads' : v.object === 'activity' ? '/actividades' : v.object === 'contact' ? '/personas'
    : v.filters.pipeline && UUID.test(v.filters.pipeline) ? `/pipelines/${v.filters.pipeline}` : '/pipelines'
  return `${base}?${sp.toString()}`
}
/** Las vistas que vienen de fábrica se guardaron en español: en inglés se leen en inglés. Las que crea cada equipo salen como las escribió. */
export const VIEW_EN: Record<string, string> = {
  'En riesgo': 'At risk', 'Revisitas vencidas': 'Overdue revisits', 'Altas sin fondeo': 'Onboarding with no funding', 'PDV en riesgo': 'Stores at risk', 'Sin persona asignada': 'No one assigned', 'Esperando primera venta': 'Awaiting first sale',
  'Negocios sin persona asignada': 'Deals with no owner', 'Negocios abiertos sin próximo paso': 'Open deals with no next step',
  'Leads sin persona asignada': 'Leads with no owner', 'Leads perdidos': 'Lost leads', 'Organizaciones de US': 'US organizations', 'Tareas del equipo': 'Team tasks', 'Negocios perdidos del mes en US': 'Deals lost this month in the US',
  // integraciones-migracion: lo reconstruido desde Pipedrive (reportes, filtros y tableros de México).
  'US · Negocios esperando en Aprobaciones, por persona': 'US · Deals waiting in Approvals, by owner',
  'US · Negocios sin próximo paso, por etapa': 'US · Deals with no next step, by stage',
  'US · Negocios nuevos por mes': 'US · New deals by month',
  'US · Conversión por etapa': 'US · Conversion by stage',
  'US · Tiempo en cada etapa': 'US · Time in each stage',
  'US · Vegas, negocios abiertos por persona': 'US · Vegas, open deals by owner',
  'US · Vegas, actividades por persona': 'US · Vegas, activities by owner',
  'US · Vegas, negocios abiertos por etapa': 'US · Vegas, open deals by stage',
  'US · Actividades por persona': 'US · Activities by owner',
  'US · Negocios perdidos por motivo': 'US · Deals lost by reason',
  'US · Negocios que entran a cada etapa por mes': 'US · Deals entering each stage by month',
  'US · Vegas, conversión de lead a ganado': 'US · Vegas, conversion from lead to won',
  'US · Alta de dealers sin persona asignada': 'US · Dealer sign-up with no owner',
  'Vegas · Revisión': 'Vegas · Audit',
  'Vegas · Perdidos': 'Vegas · Lost',
  'Vegas · Perdidos sin respuesta': 'Vegas · Lost, no response',
  'Vegas · Abiertos sin actividad registrada': 'Vegas · Open with no recorded activity',
  'Vegas · Abiertos sin persona de ventas': 'Vegas · Open with no sales owner',
  'Vegas · Abiertos sin próximo paso': 'Vegas · Open with no next step',
  'US · Organizaciones': 'US · Organizations',
  'US · Portal axexo Business': 'US · axexo Business Portal',
  'MX · Conciliación con el archivo de ventas': 'MX · Reconciliation with the sales file',
  'MX · Ganados por periodo': 'MX · Wins by period',
  'MX · Indicadores de campo': 'MX · Field indicators',
  'MX · Reporte de campo': 'MX · Field report',
  'MX · Negocios por etapa': 'MX · Deals by stage',
  'MX · Leads captados y convertidos': 'MX · Leads captured and converted',
  'MX · Reporte del mercado': 'MX · Market report',
  'MX · Cadenas y cuentas clave': 'MX · Chains and key accounts',
  'MX · Histórico': 'MX · History',
}
