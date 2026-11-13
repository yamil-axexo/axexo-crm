// AUT-01: una sola definición de quién puede hacer qué. La usan la UI, las acciones de servidor y la API.
// La base repite el límite con RLS (AUTHZ-03): esta tabla decide la acción, RLS decide la fila.
export type Role = 'admin' | 'lt' | 'market_lead' | 'supervisor' | 'rep' | 'ops' | 'agency' | 'partner'

/**
 * SEG-01: Administración por partes. Una membresía de administración sin partes lo administra todo (como siempre);
 * con partes, solo lo que le toca: accesos, configuración, bitácora o integraciones. La base repite el límite (app.has_area).
 */
export const ADMIN_AREAS = ['access', 'config', 'audit', 'integrations'] as const
export type AdminArea = (typeof ADMIN_AREAS)[number]
export const AREA_LABEL: Record<AdminArea, { es: string; en: string }> = {
  access: { es: 'Accesos', en: 'Access' },
  config: { es: 'Embudos y campos', en: 'Pipelines and fields' },
  audit: { es: 'Bitácora y privacidad', en: 'Audit log and privacy' },
  integrations: { es: 'Integraciones', en: 'Integrations' },
}

export const ROLE_LABEL: Record<Role, { es: string; en: string }> = {
  admin: { es: 'Administración', en: 'Administration' },
  lt: { es: 'Leadership', en: 'Leadership' },
  market_lead: { es: 'Líder de mercado', en: 'Market lead' },
  supervisor: { es: 'Supervisión', en: 'Supervisor' },
  rep: { es: 'Ventas', en: 'Sales' },
  ops: { es: 'Operaciones', en: 'Operations' },
  agency: { es: 'Agencia', en: 'Agency' },
  partner: { es: 'Partner', en: 'Partner' },
}

const SELLERS: Role[] = ['admin', 'market_lead', 'supervisor', 'rep']
const MANAGERS: Role[] = ['admin', 'market_lead', 'supervisor']
// E4.F4: una agencia externa captura y trabaja lo que reclutó. No reasigna, no fusiona, no exporta, no toma lo de nadie,
// no arma árboles y no ve reportes. La base la confina a lo que lleva su marca (0031: recruited_agency_id).
const FIELD: Role[] = [...SELLERS, 'agency']

export const CAPABILITIES = {
  'lead.create': FIELD,
  'lead.work': FIELD,
  'lead.assign': MANAGERS,
  // Quien vende puede pasar un lead SUYO a otra persona que vende en su mercado, con nota (decisión de la ola 2, por defecto).
  'lead.pass': SELLERS,
  // Reparto: pasar negocios abiertos de una persona a otra sin mover el comercio, y poner territorio a comercios.
  // Supervisión reparte dentro de su equipo; el líder de mercado, en todo su mercado (ver domain/reparto.ts).
  'deal.reassign': MANAGERS,
  'account.territory': MANAGERS,
  // Catálogo de vendedores de calle (no son usuarios): alta, baja y a quién responden. Supervisión, en su equipo.
  'street.manage': MANAGERS,
  'deal.create': FIELD,
  // Operaciones recibe el negocio después del alta y lo lleva hasta el final: lo edita y lo mueve en su mercado.
  // No crea negocios. Cada cambio queda en la bitácora con su nombre, igual que el de quien vende.
  'deal.edit': [...FIELD, 'ops'],
  'deal.move': [...FIELD, 'ops'],
  // Operaciones trabaja su cola: toma negocios en etapas de Operaciones, los avanza, los devuelve a Ventas con motivo
  // y mantiene sus campos (Merchant ID, proveedores, documentos, capacitación). Quien vende no tiene esta capacidad.
  'deal.ops': ['admin', 'ops'],
  // Cerrar en bloque los negocios sin movimiento: Operaciones, supervisión y quien lidera.
  'deal.bulk_close': [...MANAGERS, 'ops'],
  'account.create': FIELD,
  'account.edit': [...FIELD, 'ops'],
  'account.reassign': MANAGERS,
  // Tomar un comercio sin asignar: quien dirige, cualquiera de su alcance; quien vende, solo los de sus territorios
  // (el mismo límite que ya pone la base en accounts_upd; ver domain/reparto.ts).
  'account.take': SELLERS,
  // Armar el árbol: quien dirige mueve cualquier cuenta de su alcance; quien vende, solo entre cuentas que son suyas (ver domain/accounts.ts).
  'account.tree': SELLERS,
  'account.merge': ['admin'],
  'activity.write': [...FIELD, 'ops'],
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
  'integration.operate': ['admin'],
  // Página de estado: ambiente, versión, frescura de los datos e integraciones. La ven quien administra y quien responde por los controles.
  'status.read': ['admin', 'lt'],
  // Reportes del equipo (0017): reportar un problema lo puede hacer cualquier persona con acceso, también quien solo lee,
  // porque el reporte es suyo y no cambia datos del negocio (domain/reports.ts). Verlos todos y responder es de administración.
  'report.manage': ['admin'],
  // 0031 seguridad. Dar y quitar accesos, equipos, agencias, asientos y "ver como" es la parte Accesos de Administración.
  'access.manage': ['admin'],
  'user.view_as': ['admin'],
  // Recertificación: quien lidera un mercado acusa los accesos de su mercado; Accesos, los que no tienen mercado.
  'access.review': ['admin', 'market_lead'],
  // Pantalla de Seguridad en solo lectura (alertas, lecturas, copias, inventario): la parte Bitácora y Leadership.
  'security.read': ['admin', 'lt'],
  // Alertas, umbrales, retención y solicitudes de titulares: la parte Bitácora y privacidad.
  'security.manage': ['admin'],
  // Equipo de cuenta: quien lleva la cuenta o quien dirige (el dominio y la base revisan cuál cuenta).
  'account.team': SELLERS,
  // Consentimiento y baja de un contacto: quien trabaja la cuenta. Levantar una baja es de quien lidera o de privacidad.
  'consent.write': [...FIELD, 'ops'],
  'consent.lift': ['admin', 'market_lead'],
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

export type Membership = { market: string | null; role: Role; teamId: string | null; /** Solo en administración: null o ausente = todas las partes. */ areas?: AdminArea[] | null }

/**
 * Qué parte de Administración da cada capacidad. Lo que no está aquí (vender, fusionar, repartir, operar negocios)
 * solo lo tiene la administración completa: quien administra una parte no trabaja registros.
 */
export const CAP_AREA: Partial<Record<Capability, AdminArea | 'any'>> = {
  'access.manage': 'access',
  'user.view_as': 'access',
  'access.review': 'access',
  'config.manage': 'config',
  'report.manage': 'config',
  'integration.operate': 'integrations',
  'audit.read': 'audit',
  'security.read': 'any',
  'security.manage': 'audit',
  'consent.lift': 'audit',
  'status.read': 'any',
  'adoption.read': 'audit',
}

const grants = (m: Membership, cap: Capability): boolean => {
  if (!(CAPABILITIES[cap] as readonly Role[]).includes(m.role)) return false
  if (m.role !== 'admin' || !m.areas) return true
  const area = CAP_AREA[cap]
  return area === 'any' || (!!area && m.areas.includes(area))
}

/** Un rol global (admin, lt) vale en todos los mercados; los demás solo en el suyo. */
export function can(memberships: Membership[], cap: Capability, market?: string | null): boolean {
  return memberships.some((m) => grants(m, cap) && (m.market === null || !market || m.market === market))
}

/** Capacidades que solo leen: son las únicas que quedan vivas mientras alguien "ve como" otra persona. */
export const READ_CAPS: readonly Capability[] = ['board.supervisor', 'exception.read', 'board.lt', 'audit.read', 'report.view', 'report.own', 'adoption.read', 'status.read', 'security.read']

/** Solo lectura: la persona ve, pero ninguno de sus roles vigentes le deja cambiar nada (Leadership, o un usuario de partner). */
export function isReadOnly(memberships: Membership[]): boolean {
  return memberships.length > 0 && memberships.every((m) => m.role === 'lt' || m.role === 'partner')
}

/** Administración completa: al menos una membresía de administración sin partes. */
export function isFullAdmin(memberships: Membership[]): boolean {
  return memberships.some((m) => m.role === 'admin' && !m.areas)
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
