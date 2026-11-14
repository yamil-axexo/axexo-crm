import type { T } from '@/lib/format'

/** El nombre con el que el equipo conoce cada pantalla, a partir de su ruta. Lo usan "Reportar un problema" y la pestaña Problemas reportados de Administración. */
const SCREENS: [prefix: string, es: string, en: string][] = [
  ['/hoy', 'Hoy', 'Today'],
  ['/leads', 'Leads', 'Leads'],
  ['/pipelines', 'Negocios', 'Deals'],
  ['/deals', 'Negocios, detalle de un negocio o de un pedido', 'Deals, a deal or an order page'],
  ['/comercios/cerca', 'Cerca de mí', 'Near me'],
  ['/comercios', 'Comercios', 'Merchants'],
  ['/actividades', 'Actividades', 'Activities'],
  ['/buscar', 'Buscar', 'Search'],
  ['/supervisor', 'Mi equipo', 'My team'],
  ['/operaciones', 'Cola de Operaciones', 'Operations queue'],
  ['/panel-lt', 'Panel del LT', 'Leadership panel'],
  ['/reportes/cerrados', 'Negocios cerrados', 'Closed deals'],
  ['/reportes/campo', 'Reporte de campo', 'Field report'],
  ['/reportes/adopcion', 'Adopción', 'Adoption'],
  ['/reportes/consolidado', 'Consolidado en USD', 'Consolidated in USD'],
  ['/reportes/mercado', 'Reporte del mercado', 'Market report'],
  ['/arranque', 'Arranque y hojas', 'Rollout and sheets'],
  ['/cuidado', 'Cuidado de comercios', 'Merchant care'],
  ['/avisos/preferencias', 'Preferencias de avisos', 'Notice preferences'],
  ['/avisos', 'Avisos', 'Notices'],
  ['/colas', 'Colas del equipo', 'Team queues'],
  ['/anuncios', 'Anuncios', 'Announcements'],
  ['/como-se-usa', 'Ayuda de una pantalla', 'Help for a screen'],
  ['/admin/avisos', 'Administración, Avisos y plantillas', 'Administration, Notices and templates'],
  ['/reportes/leads', 'Reporte de leads captados y convertidos', 'Leads captured and converted report'],
  ['/reportes/etapas', 'Reporte de negocios por etapa', 'Deals by stage report'],
  ['/reportes/agencias', 'Reporte de agencia y equipo interno', 'Agency and in-house report'],
  ['/reportes/finanzas', 'Reporte de Finanzas', 'Finance report'],
  ['/reportes/cuentas', 'Cadenas, ISO y cuentas clave', 'Chains, ISOs and key accounts'],
  ['/reportes/historico', 'Reporte histórico', 'History report'],
  // reportes2
  ['/reportes/kam', 'Tablero de cuentas clave', 'Key accounts board'],
  ['/reportes/operaciones', 'Tablero de Operaciones', 'Operations board'],
  ['/personas', 'Personas de los comercios', 'Merchant contacts'],
  ['/admin/tableros', 'Administración, tableros y valores propuestos', 'Administration, boards and proposed values'],
  ['/reportes/conciliacion', 'Conciliación con el archivo de ventas', 'Reconciliation with the sales file'],
  ['/reportes/lo-que-llevo', 'Lo que llevo', 'My running numbers'],
  ['/reportes/indicadores-campo', 'Indicadores de campo', 'Field indicators'],
  ['/reportes/indicadores', 'Indicadores y responsables', 'Metrics and owners'],
  ['/reportes/pronostico', 'Pronóstico', 'Forecast'],
  ['/reportes/embudo', 'Reporte del embudo: motivos, revisitas, próximos pasos y origen', 'Pipeline report: reasons, revisits, next steps and origin'],
  ['/reportes', 'Reportes', 'Reports'],
  // Va antes de /admin: la primera ruta que coincide es la que nombra la pantalla.
  ['/admin/operaciones', 'Administración, Operaciones', 'Administration, Operations'],
  ['/admin/automatizaciones', 'Administración, Automatizaciones', 'Administration, Automations'],
  ['/admin/decisiones', 'Administración, Decisiones de negocio', 'Administration, Business decisions'],
  ['/admin/seguridad', 'Administración, Seguridad', 'Administration, Security'],
  ['/admin/cuidado', 'Administración, Cuidado de comercios', 'Administration, Merchant care'],
  ['/admin/embudo', 'Administración, Asignación y embudo', 'Administration, Assignment and pipeline'],
  ['/admin/integraciones', 'Administración, Eventos, API y datos', 'Administration, Events, API and data'],
  ['/admin/gobierno', 'Administración, Gobierno', 'Administration, Governance'],
  ['/admin/ia', 'Administración, IA y asistencia', 'Administration, AI and assistance'],
  ['/admin/plataforma', 'Administración, Plataforma', 'Administration, Platform'],
  ['/mcp/autorizar', 'Permiso para un agente', 'Permission for an agent'],
  ['/asistencia', 'Asistencia', 'Assistance'],
  ['/admin', 'Administración', 'Administration'],
  ['/importar', 'Importar un archivo', 'Import a file'],
  ['/partners/redes', 'Redes adquiridas', 'Acquired networks'],
  ['/partners', 'Partners', 'Partners'],
  ['/datos', 'Datos', 'Data'],
  ['/estado', 'Estado de CONTIGO', 'CONTIGO status'],
  ['/bienvenida', 'Primeros pasos', 'First steps'],
  ['/ayuda', 'Ayuda', 'Help'],
  ['/reportar', 'Reportar un problema', 'Report a problem'],
  ['/campo', 'Campo y canales', 'Field and channels'],
  ['/documentos', 'Documento generado', 'Generated document'],
  ['/solicitudes', 'Pedir un cambio', 'Request a change'],
]

// Renglones de medición que no son una ruta (GOB-07 / UX-04).
const SPECIAL: Record<string, [string, string]> = {
  telefono: ['Todas las pantallas, en el teléfono', 'All screens, on the phone'],
  buscar: ['Búsqueda', 'Search'],
  otra: ['Otra pantalla', 'Another screen'],
}

export function screenLabel(t: T, path: string | null | undefined): string {
  if (!path) return t('No se sabe', 'Unknown')
  const bare = path.split(/[?#]/)[0]!
  if (SPECIAL[bare]) return t(...SPECIAL[bare])
  const hit = SCREENS.find(([prefix]) => bare === prefix || bare.startsWith(`${prefix}/`))
  if (!hit) return path
  // La lista y el detalle de un registro no se llaman igual ("Leads" dos veces en Gobierno).
  const rest = bare.slice(hit[0].length)
  return rest.includes('[id]') ? t(`${hit[1]}, detalle`, `${hit[2]}, detail`) : t(hit[1], hit[2])
}
