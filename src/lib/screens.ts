import type { T } from '@/lib/format'

/** El nombre con el que el equipo conoce cada pantalla, a partir de su ruta. Lo usan "Reportar un problema" y la pestaña Reportes. */
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
  // Va antes de /admin: la primera ruta que coincide es la que nombra la pantalla.
  ['/admin/operaciones', 'Catálogos de Operaciones', 'Operations catalogs'],
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
