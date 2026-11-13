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
  // Anuncios a la red con acuse (0020): publica administración o quien lidera (su mercado; supervisión, su equipo). Leerlos y dar
  // acuse lo hace cualquier persona de la audiencia, también quien solo lee: el acuse es suyo (domain/announcements.ts).
  'announcement.publish': MANAGERS,
  // Importar comercios, contactos y leads por archivo: administración y quien lidera el mercado (en el suyo). Cada fila pasa
  // por las mismas reglas que el alta a mano; la base repite el límite (app.can_import).
  'data.import': ['admin', 'market_lead'],
  // Página Reportes (paquete reportes): la ve todo el mundo, cada quien con lo de su alcance (RLS y el alcance del reporte deciden las filas).
  'report.gallery': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops'],
  // Guardar un reporte con sus filtros es de la persona (como reportar un problema): también quien solo lee. Compartirlo con el equipo es de quien dirige.
  'report.save': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops'],
  'report.share': MANAGERS,
  // Reportes de Finanzas y conciliación con el archivo de ventas. No existe un rol de Finanzas: hoy entran leadership, quien lidera y administración.
  'report.finance': ['admin', 'lt', 'market_lead'],
  'report.reconcile': ['admin', 'lt', 'market_lead'],
  // "Lo que llevo": los números que alimentan el incentivo de quien vende (sin montos de comisión).
  'report.carry': SELLERS,
  // Uso real de CONTIGO por persona y equipo. Supervisión ve a su equipo; ventas y operaciones no.
  'adoption.team': ['admin', 'lt', 'market_lead', 'supervisor'],
  // Dueño de cada indicador: lo cambia administración.
  'metric.owner': ['admin'],
  // Vistas guardadas como colas: cada persona guarda y fija las suyas; compartir con el equipo es de quien dirige.
  'view.save': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops'],
  'view.share': MANAGERS,
  // Paquete datos (0023). Cola de duplicados: buscar en lote, descartar un par y revisar avisos saltados es de quien lidera el
  // mercado o administra; fusionar y deshacer sigue siendo solo de administración ('account.merge').
  'duplicate.review': ['admin', 'market_lead'],
  // Identificadores de otros sistemas: los agrega y los cierra quien cuida los datos del mercado.
  'alias.manage': ['admin', 'market_lead', 'ops'],
  // Campos: quien lidera un mercado propone; administración aprueba ('config.manage'). Listas de proceso del mercado.
  'field.propose': ['admin', 'market_lead'],
  'process.define': ['admin', 'market_lead'],
  // Tablero de calidad de datos: cada quien sobre lo que ve (supervisión, su equipo). Leadership también lo lee, por su
  // alcance global (la pantalla lo deja entrar con `ctx.isGlobal`; aquí no se le da una capacidad que no sea de lectura declarada).
  'data.quality': [...MANAGERS, 'ops'],
  // Matriz de productos por comercio y su estado con cada proveedor: la mantiene Operaciones.
  'account.products': ['admin', 'ops'],
  // México (paquete mx). Mientras las hojas se retiran, quien dirige un equipo carga las visitas que el campo sigue anotando
  // ahí; las tiendas ya migradas (un negocio ganado en su fecha real) las carga quien lidera el mercado o administración.
  'visit.sheet_load': MANAGERS,
  'deal.migrated_load': ['admin', 'market_lead'],
  // Arranque del mercado (primero quienes lideran, pasos de capacitación): lo ve quien dirige y leadership; lo cambia
  // administración y quien lidera el mercado.
  'rollout.read': ['admin', 'lt', 'market_lead', 'supervisor'],
  'rollout.manage': ['admin', 'market_lead'],
  // Los leads descartados como base de correo: la descarga lleva correos, así que es de quien lidera el mercado y de
  // administración, y solo trae a quien dio su consentimiento (domain/mx-reports.ts).
  'lead.mailing_export': ['admin', 'market_lead'],
  // Paquete campo-canal (0041). Expediente de alta: lo captura quien vende u Operaciones; la mesa de control (validar,
  // aprobar, devolver, repartir) es de Operaciones y administración.
  'onboarding.capture': [...SELLERS, 'ops'],
  'onboarding.review': ['admin', 'ops'],
  // Umbrales con versión (saldo bajo, metas, ventanas, plazos): los cambia quien lidera el mercado o administra.
  'threshold.manage': ['admin', 'market_lead'],
  // Cartera: canal como eje y plan de reparto en borrador (supervisión, su equipo); polos con dueño y perfiles, quien lidera.
  'portfolio.plan': MANAGERS,
  'territory.own': ['admin', 'market_lead'],
  'plan.set': ['admin', 'market_lead'],
  // Atribución: corregir origen y canal (fila nueva con motivo) y arbitrar disputas. No existe rol de Finanzas: por defecto
  // arbitra quien lidera el mercado o administración, nunca quien levantó la disputa.
  'attribution.correct': ['admin', 'market_lead'],
  'dispute.raise': SELLERS,
  'dispute.arbitrate': ['admin', 'market_lead'],
  // Registros de canal: la venta directa no los ve. Los registra y decide quien lidera el mercado, a nombre del aliado.
  'claim.manage': ['admin', 'market_lead'],
  // Fondeo: el saldo no se captura; el simulador (fuera de producción) es de administración. El límite lo pide quien vende y lo aprueba otra persona.
  'funding.simulate': ['admin'],
  'credit.request': [...SELLERS, 'ops'],
  'credit.approve': ['admin', 'market_lead'],
  'competitor.record': [...SELLERS, 'ops'],
  'priority.read': [...SELLERS, 'lt'],
  // Incidentes de campo: cualquiera que trabaja en el mercado reporta; solo quien lidera o administra los ve todos y los atiende.
  'incident.report': ['admin', 'market_lead', 'supervisor', 'rep', 'ops'],
  'incident.manage': ['admin', 'market_lead'],
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
