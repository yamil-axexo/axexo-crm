// AUT-01: una sola definición de quién puede hacer qué. La usan la UI, las acciones de servidor y la API.
// La base repite el límite con RLS (AUTHZ-03): esta tabla decide la acción, RLS decide la fila.
export type Role = 'admin' | 'lt' | 'market_lead' | 'supervisor' | 'rep' | 'ops'

export const ROLE_LABEL: Record<Role, { es: string; en: string }> = {
  admin: { es: 'Administración', en: 'Administration' },
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
  // Quien vende puede pasar un lead SUYO a otra persona que vende en su mercado, con nota (decisión de la ola 2, por defecto).
  'lead.pass': SELLERS,
  // Reparto: pasar negocios abiertos de una persona a otra sin mover el comercio, y poner territorio a comercios.
  // Supervisión reparte dentro de su equipo; el líder de mercado, en todo su mercado (ver domain/reparto.ts).
  'deal.reassign': MANAGERS,
  'account.territory': MANAGERS,
  // Catálogo de vendedores de calle (no son usuarios): alta, baja y a quién responden. Supervisión, en su equipo.
  'street.manage': MANAGERS,
  'deal.create': SELLERS,
  // Operaciones recibe el negocio después del alta y lo lleva hasta el final: lo edita y lo mueve en su mercado.
  // No crea negocios. Cada cambio queda en la bitácora con su nombre, igual que el de quien vende.
  'deal.edit': [...SELLERS, 'ops'],
  'deal.move': [...SELLERS, 'ops'],
  // Operaciones trabaja su cola: toma negocios en etapas de Operaciones, los avanza, los devuelve a Ventas con motivo
  // y mantiene sus campos (Merchant ID, proveedores, documentos, capacitación). Quien vende no tiene esta capacidad.
  'deal.ops': ['admin', 'ops'],
  // Cerrar en bloque los negocios sin movimiento: Operaciones, supervisión y quien lidera.
  'deal.bulk_close': [...MANAGERS, 'ops'],
  'account.create': SELLERS,
  'account.edit': [...SELLERS, 'ops'],
  'account.reassign': MANAGERS,
  // Tomar un comercio sin asignar: quien dirige, cualquiera de su alcance; quien vende, solo los de sus territorios
  // (el mismo límite que ya pone la base en accounts_upd; ver domain/reparto.ts).
  'account.take': SELLERS,
  // Armar el árbol: quien dirige mueve cualquier cuenta de su alcance; quien vende, solo entre cuentas que son suyas (ver domain/accounts.ts).
  'account.tree': SELLERS,
  'account.merge': ['admin'],
  'activity.write': [...SELLERS, 'ops'],
  'exception.resolve': [...MANAGERS, 'ops', 'rep'],
  'board.supervisor': [...MANAGERS, 'lt'],
  // La cola de avisos del alcance, en solo lectura para leadership. Operaciones ve la de sus mercados (ya resolvía avisos
  // uno por uno): entra a la misma pantalla, sin el tablero del equipo de ventas.
  'exception.read': [...MANAGERS, 'lt', 'ops'],
  // Evaluar las reglas a mano abre y cierra excepciones para todos: es un cambio de datos, así que Leadership (solo lectura) no lo corre.
  'rules.run': MANAGERS,
  'board.lt': ['admin', 'lt', 'market_lead'],
  // La bitácora se lee en solo lectura y dentro del alcance: leadership toda, quien lidera y operaciones la de sus mercados (RLS).
  'audit.read': ['admin', 'lt', 'market_lead', 'ops'],
  // Reportes de resultados (negocios cerrados, reporte semanal de campo). Supervisión ve y exporta lo de su equipo.
  // Exportar es una lectura que sale de CONTIGO: lleva permiso propio y deja evento en la bitácora con filtros y filas.
  'report.view': ['admin', 'lt', 'market_lead', 'supervisor'],
  'report.export': ['admin', 'lt', 'market_lead', 'supervisor'],
  // Quien vende ve SUS negocios cerrados (los que lleva), sin exportar ni ver los de nadie más.
  'report.own': ['rep'],
  // Adopción: conteos de uso por persona. No la ve supervisión ni ventas.
  'adoption.read': ['admin', 'lt', 'market_lead'],
  'config.manage': ['admin'],
  // Automatizaciones (AUT-03): las crea, cambia y pausa administración. Quien lidera un mercado y leadership las leen, con su bitácora.
  'automation.manage': ['admin'],
  'automation.read': ['admin', 'lt', 'market_lead'],
  // Tareas programadas: "Correr ahora" es de administración. Las corridas las ve también quien responde por los controles (status.read).
  'job.run': ['admin'],
  'integration.operate': ['admin'],
  // Página de estado: ambiente, versión, frescura de los datos e integraciones. La ven quien administra y quien responde por los controles.
  'status.read': ['admin', 'lt'],
  // Reportes del equipo (0017): reportar un problema lo puede hacer cualquier persona con acceso, también quien solo lee,
  // porque el reporte es suyo y no cambia datos del negocio (domain/reports.ts). Verlos todos y responder es de administración.
  'report.manage': ['admin'],
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

/**
 * La pantalla donde aterriza cada quien al entrar: UNA sola función lo decide (la usan la raíz, el primer ingreso después
 * de la bienvenida, el logo de la barra y las pruebas). Quien vende o supervisa llega a Hoy, su lista de trabajo;
 * Operaciones, a su cola. Quien no lleva registros propios llega a su tablero: administración a Administración, leadership
 * al Panel del LT y quien lidera un mercado a Mi equipo. Hoy sigue en el menú para todos.
 */
export type Home = '/hoy' | '/admin' | '/panel-lt' | '/supervisor' | '/operaciones'
export function homePath(memberships: Membership[]): Home {
  const has = (role: Role) => memberships.some((m) => m.role === role)
  if (has('admin')) return '/admin'
  if (has('lt')) return '/panel-lt'
  if (has('market_lead')) return '/supervisor'
  // Quien es de Operaciones y no vende ni supervisa empieza en su cola (paquete operaciones).
  if (has('ops') && !has('supervisor') && !has('rep')) return '/operaciones'
  return '/hoy'
}
