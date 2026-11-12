import type { T } from '@/lib/format'

/** El nombre con el que el equipo conoce cada pantalla, a partir de su ruta. Lo usan "Reportar un problema" y la pestaña Reportes. */
const SCREENS: [prefix: string, es: string, en: string][] = [
  ['/hoy', 'Hoy', 'Today'],
  ['/leads', 'Leads', 'Leads'],
  ['/pipelines', 'Negocios', 'Deals'],
  ['/deals', 'Negocios, detalle de un negocio', 'Deals, a deal page'],
  ['/comercios', 'Comercios', 'Merchants'],
  ['/actividades', 'Actividades', 'Activities'],
  ['/buscar', 'Buscar', 'Search'],
  ['/supervisor', 'Mi equipo', 'My team'],
  ['/panel-lt', 'Panel del LT', 'Leadership panel'],
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
