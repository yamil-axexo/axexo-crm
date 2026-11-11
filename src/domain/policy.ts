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
  'deal.create': SELLERS,
  'deal.edit': SELLERS,
  'deal.move': SELLERS,
  'account.create': SELLERS,
  'account.edit': [...SELLERS, 'ops'],
  'account.reassign': MANAGERS,
  'account.merge': ['admin'],
  'activity.write': [...SELLERS, 'ops'],
  'exception.resolve': [...MANAGERS, 'ops', 'rep'],
  'board.supervisor': [...MANAGERS, 'lt'],
  'board.lt': ['admin', 'lt', 'market_lead'],
  'audit.read': ['admin', 'lt', 'market_lead'],
  'config.manage': ['admin'],
  'integration.operate': ['admin'],
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

export type Membership = { market: string | null; role: Role; teamId: string | null }

/** Un rol global (admin, lt) vale en todos los mercados; los demás solo en el suyo. */
export function can(memberships: Membership[], cap: Capability, market?: string | null): boolean {
  const allowed = CAPABILITIES[cap] as readonly Role[]
  return memberships.some((m) => allowed.includes(m.role) && (m.market === null || !market || m.market === market))
}

export function rolesIn(memberships: Membership[], market: string): Role[] {
  return memberships.filter((m) => m.market === null || m.market === market).map((m) => m.role)
}
