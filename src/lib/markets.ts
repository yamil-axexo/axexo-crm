// Constantes del paquete de mercados que usan el dominio, las lecturas y las pantallas. Sin base ni red.
import type { Role } from '@/domain/policy'

/** Zona horaria principal de cada estado de Estados Unidos (IANA). Los estados con dos zonas usan la de la mayoría de su población. */
export const US_STATE_ZONE: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York',
  DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago',
  TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver',
}

/** Zonas que se ofrecen para un comercio, por mercado. Vacío = la del mercado es la única. */
export const MARKET_ZONES: Record<string, string[]> = {
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico'],
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Chihuahua', 'America/Hermosillo', 'America/Tijuana'],
  BR: ['America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Rio_Branco'],
}

/** Datos que pueden ir arriba en la ficha. El orden y cuáles ve cada rol viven en crm.ficha_layouts. */
export const FICHA_FACTS = ['next_step', 'owner_team', 'tree', 'alerts', 'data_as_of', 'sales_30d', 'open_deal', 'contact', 'tax_id', 'entity'] as const
export type FichaFact = (typeof FICHA_FACTS)[number]

export const FICHA_FACT_LABEL: Record<FichaFact, { es: string; en: string }> = {
  next_step: { es: 'Próximo paso', en: 'Next step' },
  owner_team: { es: 'Quién lo lleva y su equipo', en: 'Owner and team' },
  tree: { es: 'Dónde está en la red', en: 'Place in the network' },
  alerts: { es: 'Avisos abiertos', en: 'Open alerts' },
  data_as_of: { es: 'Corte de los datos de ventas', en: 'Sales data as of' },
  sales_30d: { es: 'Ventas, últimos 30 días', en: 'Sales, last 30 days' },
  open_deal: { es: 'Negocio abierto', en: 'Open deal' },
  contact: { es: 'Contacto principal', en: 'Main contact' },
  tax_id: { es: 'Identificador fiscal', en: 'Tax ID' },
  entity: { es: 'Entidad legal y unidad de negocio', en: 'Legal entity and business unit' },
}

/** El rol con el que una persona lee la ficha en un mercado: el de más alcance entre los que tiene ahí. */
const ROLE_ORDER: Role[] = ['admin', 'lt', 'market_lead', 'supervisor', 'ops', 'rep']
export function fichaRole(roles: Role[]): Role {
  return ROLE_ORDER.find((r) => roles.includes(r)) ?? 'rep'
}

export const WA_CATEGORY: Record<string, { es: string; en: string }> = {
  utility: { es: 'Servicio (alta, primera venta, saldo)', en: 'Utility (signup, first sale, balance)' },
  marketing: { es: 'Promoción', en: 'Marketing' },
  authentication: { es: 'Código de acceso', en: 'Authentication' },
  service: { es: 'Respuesta dentro de la ventana', en: 'Reply inside the window' },
}
export const WA_STATUS: Record<string, { es: string; en: string }> = {
  draft: { es: 'Borrador', en: 'Draft' },
  submitted: { es: 'Enviada a aprobación', en: 'Submitted for approval' },
  approved: { es: 'Aprobada', en: 'Approved' },
  rejected: { es: 'Rechazada', en: 'Rejected' },
  paused: { es: 'En pausa', en: 'Paused' },
}

export const distanceText = (m: number, locale: 'es' | 'en') => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString(locale === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 1 })} km`)
