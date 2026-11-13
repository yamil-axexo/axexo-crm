import type { T } from '@/lib/format'

/** El nombre con el que el equipo conoce cada pantalla, a partir de su ruta. Lo usan "Reportar un problema" y la pestaña Problemas reportados de Administración. */
const SCREENS: [prefix: string, es: string, en: string][] = [
  ['/hoy', 'Hoy', 'Today'],
  ['/leads', 'Leads', 'Leads'],
  ['/pipelines', 'Negocios', 'Deals'],
  ['/deals', 'Negocios, detalle de un negocio o de un pedido', 'Deals, a deal or an order page'],
  ['/comercios', 'Comercios', 'Merchants'],
  ['/actividades', 'Actividades', 'Activities'],
  ['/buscar', 'Buscar', 'Search'],
  ['/supervisor', 'Mi equipo', 'My team'],
  ['/operaciones', 'Cola de Operaciones', 'Operations queue'],
  ['/panel-lt', 'Panel del LT', 'Leadership panel'],
  ['/reportes/cerrados', 'Negocios cerrados', 'Closed deals'],
  ['/reportes/campo', 'Reporte de campo', 'Field report'],
  ['/reportes/adopcion', 'Adopción', 'Adoption'],
  ['/avisos/preferencias', 'Preferencias de avisos', 'Notice preferences'],
  ['/avisos', 'Avisos', 'Notices'],
  ['/anuncios', 'Anuncios', 'Announcements'],
  ['/como-se-usa', 'Ayuda de una pantalla', 'Help for a screen'],
  ['/admin/avisos', 'Administración, Avisos y plantillas', 'Administration, Notices and templates'],
  // Va antes de /admin: la primera ruta que coincide es la que nombra la pantalla.
  ['/admin/operaciones', 'Administración, Operaciones', 'Administration, Operations'],
  ['/admin', 'Administración', 'Administration'],
  ['/estado', 'Estado de CONTIGO', 'CONTIGO status'],
  ['/bienvenida', 'Primeros pasos', 'First steps'],
  ['/ayuda', 'Ayuda', 'Help'],
  ['/reportar', 'Reportar un problema', 'Report a problem'],
]

export function screenLabel(t: T, path: string | null | undefined): string {
  if (!path) return t('No se sabe', 'Unknown')
  const hit = SCREENS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  return hit ? t(hit[1], hit[2]) : path
}
