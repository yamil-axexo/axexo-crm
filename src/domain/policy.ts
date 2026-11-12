// AUT-01: una sola definición de quién puede hacer qué. La usan la UI, las acciones de servidor y la API.
// La base repite el límite con RLS (AUTHZ-03): esta tabla decide la acción, RLS decide la fila.
export type Role = 'admin' | 'lt' | 'market_lead' | 'supervisor' | 'rep' | 'ops'

export const ROLE_LABEL: Record<Role, { es: string; en: string }> = {
  admin: { es: 'Administración', en: 'Admin' },
  lt: { es: 'Leadership', en: 'Leadership' },
  market_lead: { es: 'Líder de mercado', en: 'Market lead' },
  supervisor: { es: 'Supervisión', en: 'Supervisor' },
  rep: { es: 'Ventas', en: 'Sales' },
  ops: { es: 'Operaciones', en: 'Operations' },
}

const SELLERS: Role[] = ['admin', 'market_lead', 'supervisor', 'rep']
const MANAGERS: Role[] = ['admin', 'market_lead', 'supervisor']

export const CAPABILITIES = {
  'lead.create': SELLERS,
  'lead.work': SELLERS,
  'lead.assign': MANAGERS,
  // Reparto: pasar negocios abiertos de una persona a otra sin mover el comercio, y poner territorio a comercios.
  // Supervisión reparte dentro de su equipo; el líder de mercado, en todo su mercado (ver domain/reparto.ts).
  'deal.reassign': MANAGERS,
  'account.territory': MANAGERS,
  'deal.create': SELLERS,
  // Operaciones recibe el negocio después del alta y lo lleva hasta el final: lo edita y lo mueve en su mercado.
  // No crea negocios. Cada cambio queda en la bitácora con su nombre, igual que el de quien vende.
  'deal.edit': [...SELLERS, 'ops'],
  'deal.move': [...SELLERS, 'ops'],
  'account.create': SELLERS,
  'account.edit': [...SELLERS, 'ops'],
  'account.reassign': MANAGERS,
  'account.merge': ['admin'],
  'activity.write': [...SELLERS, 'ops'],
  'exception.resolve': [...MANAGERS, 'ops', 'rep'],
  // Operaciones ve el tablero y la cola de avisos de sus mercados: ya resolvía avisos, ahora los ve juntos.
  'board.supervisor': [...MANAGERS, 'lt', 'ops'],
  // Evaluar las reglas a mano abre y cierra excepciones para todos: es un cambio de datos, así que Leadership (solo lectura) no lo corre.
  'rules.run': MANAGERS,
  'board.lt': ['admin', 'lt', 'market_lead'],
  // La bitácora se lee en solo lectura y dentro del alcance: leadership toda, quien lidera y operaciones la de sus mercados (RLS).
  'audit.read': ['admin', 'lt', 'market_lead', 'ops'],
  // Reportes de resultados (negocios cerrados, reporte semanal de campo). Supervisión ve y exporta lo de su equipo.
  // Exportar es una lectura que sale de CONTIGO: lleva permiso propio y deja evento en la bitácora con filtros y filas.
  'report.view': ['admin', 'lt', 'market_lead', 'supervisor'],
  'report.export': ['admin', 'lt', 'market_lead', 'supervisor'],
  // Adopción: conteos de uso por persona. No la ve supervisión ni ventas.
  'adoption.read': ['admin', 'lt', 'market_lead'],
  'config.manage': ['admin'],
  'integration.operate': ['admin'],
  // Página de estado: ambiente, versión, frescura de los datos e integraciones. La ven quien administra y quien responde por los controles.
  'status.read': ['admin', 'lt'],
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

export type Membership = { market: string | null; role: Role; teamId: string | null }

/** Un rol global (admin, lt) vale en todos los mercados; los demás solo en el suyo. */
export function can(memberships: Membership[], cap: Capability, market?: string | null): boolean {
  const allowed = CAPABILITIES[cap] as readonly Role[]
  return memberships.some((m) => allowed.includes(m.role) && (m.market === null || !market || m.market === market))
}

/** Solo lectura: la persona ve, pero ninguno de sus roles vigentes le deja cambiar nada (hoy, quien solo tiene Leadership). */
export function isReadOnly(memberships: Membership[]): boolean {
  return memberships.length > 0 && memberships.every((m) => m.role === 'lt')
}

export function rolesIn(memberships: Membership[], market: string): Role[] {
  return memberships.filter((m) => m.market === null || m.market === market).map((m) => m.role)
}
