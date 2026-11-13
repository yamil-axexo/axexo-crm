// AUT-01: una sola definición de quién puede hacer qué. La usan la UI, las acciones de servidor y la API.
// La base repite el límite con RLS (AUTHZ-03): esta tabla decide la acción, RLS decide la fila.
export type Role = 'admin' | 'lt' | 'market_lead' | 'supervisor' | 'rep' | 'ops' | 'agency' | 'partner' | 'finance'

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
  // E4.F2 (datos2): Finanzas trabaja los registros de su mercado y lee sus reportes; no administra ni exporta.
  finance: { es: 'Finanzas', en: 'Finance' },
}

const SELLERS: Role[] = ['admin', 'market_lead', 'supervisor', 'rep']
const MANAGERS: Role[] = ['admin', 'market_lead', 'supervisor']
// E4.F4: una agencia externa captura y trabaja lo que reclutó. No reasigna, no fusiona, no exporta, no toma lo de nadie,
// no arma árboles y no ve reportes. La base la confina a lo que lleva su marca (0027: recruited_agency_id).
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
  'account.edit': [...FIELD, 'ops', 'finance'],
  'account.reassign': MANAGERS,
  // Tomar un comercio sin asignar: quien dirige, cualquiera de su alcance; quien vende, solo los de sus territorios
  // (el mismo límite que ya pone la base en accounts_upd; ver domain/reparto.ts).
  'account.take': SELLERS,
  // Armar el árbol: quien dirige mueve cualquier cuenta de su alcance; quien vende, solo entre cuentas que son suyas (ver domain/accounts.ts).
  'account.tree': SELLERS,
  'account.merge': ['admin'],
  'activity.write': [...FIELD, 'ops', 'finance'],
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
  // integraciones2 (E5.F3/F4): responsable, hora esperada y ventana sin cargas de cada carga de datos.
  'load.configure': ['admin'],
  // E6.F4: bajar el respaldo completo de lo importado de Pipedrive (queda en la bitácora).
  'pipedrive.backup': ['admin'],
  // E6.F8: borrar y recargar un mercado, solo fuera de producción y con confirmación escrita.
  'market.reset_test': ['admin'],
  // E5.F9: generar un documento de plantilla (pedido, propuesta, carta) de un comercio que se puede trabajar, y mandarlo por correo.
  'document.generate': [...FIELD, 'ops'],
  // E6.F2 y GOB-05: decidir los choques entre CONTIGO y Pipedrive y llevar la convivencia y el corte de cada mercado.
  'migration.decide': ['admin'],
  // Metas (la "Deals won" de Pipedrive): la cifra la pone quien lidera el mercado o administración. Todos los que ven el Panel o Mi equipo ven el avance.
  'goal.manage': ['admin', 'market_lead'],
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
  'report.gallery': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance'],
  // Guardar un reporte con sus filtros es de la persona (como reportar un problema): también quien solo lee. Compartirlo con el equipo es de quien dirige.
  'report.save': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance'],
  'report.share': MANAGERS,
  // Reportes de Finanzas y conciliación con el archivo de ventas. No existe un rol de Finanzas: hoy entran leadership, quien lidera y administración.
  'report.finance': ['admin', 'lt', 'market_lead', 'finance'],
  'report.reconcile': ['admin', 'lt', 'market_lead', 'finance'],
  // "Lo que llevo": los números que alimentan el incentivo de quien vende (sin montos de comisión).
  'report.carry': SELLERS,
  // Uso real de CONTIGO por persona y equipo. Supervisión ve a su equipo; ventas y operaciones no.
  'adoption.team': ['admin', 'lt', 'market_lead', 'supervisor'],
  // Dueño de cada indicador: lo cambia administración.
  'metric.owner': ['admin'],
  // Vistas guardadas como colas: cada persona guarda y fija las suyas; compartir con el equipo es de quien dirige.
  'view.save': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance'],
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
  // Paquete embudo (0029). Corregir un hito del comercio que resultó no ser cierto (primer fondeo, primera transacción, hábito):
  // quien lidera el mercado o administra, siempre con motivo. La corrección reabre el negocio que ese hito había ganado.
  'deal.correct_win': ['admin', 'market_lead'],
  // Ficha de dealer (paquete us-ficha, 0030). El origen del comercio y quién lo reclutó se fijan UNA vez: nacen con el alta y,
  // en los comercios que ya existían sin ese dato, los fija quien dirige (el origen, también Operaciones). Después no cambian.
  'account.origin': [...MANAGERS, 'ops'],
  'account.recruiter': MANAGERS,
  // Agencias y otros socios que reclutan tiendas: los da de alta y de baja administración o quien lidera el mercado.
  'agency.manage': ['admin', 'market_lead'],
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
  // Paquete campo-canal (0032). Expediente de alta: lo captura quien vende u Operaciones; la mesa de control (validar,
  // aprobar, devolver, repartir) es de Operaciones y administración.
  'onboarding.capture': [...SELLERS, 'ops'],
  'onboarding.review': ['admin', 'ops'],
  // Umbrales con versión (metas, ventanas, plazos; el saldo bajo es de Cuidado de comercios): los cambia quien lidera el mercado o administra.
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
  'priority.read': SELLERS,
  // Incidentes de campo: cualquiera que trabaja en el mercado reporta; solo quien lidera o administra los ve todos y los atiende.
  'incident.report': ['admin', 'market_lead', 'supervisor', 'rep', 'ops'],
  'incident.manage': ['admin', 'market_lead'],
  // Paquete de mercados. Capturar el identificador fiscal lo hace quien lleva la cuenta u Operaciones; revisarlo contra el
  // documento (la capa humana) es de quien lidera el mercado, Operaciones o administración. Cambiar la entidad legal de un
  // comercio es de quien lidera el mercado o de administración. El consolidado en USD lo lee quien ya lee el panel.
  'taxid.capture': [...SELLERS, 'ops'],
  'taxid.review': ['admin', 'market_lead', 'ops'],
  'account.entity': ['admin', 'market_lead'],
  // 0027 seguridad. Dar y quitar accesos, equipos, agencias, asientos y "ver como" es la parte Accesos de Administración.
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
  // Gobierno (paquete gobierno): objetivos de servicio, incidentes, pruebas de restauración, dueños por componente, versiones,
  // despliegues, costos y datos de prueba. Lo lee quien responde por los controles; lo escribe administración.
  'gov.read': ['admin', 'lt'],
  'gov.manage': ['admin'],
  // Pedir un cambio de configuración (un campo, una opción, un embudo): cualquier persona con acceso. Decidir es de administración.
  'config.request': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance'],
  // Cuidado del comercio (paquete ciclo-cs). Entregas entre equipos con acuse: las crea y las recibe quien trabaja el mercado.
  'handoff.create': [...SELLERS, 'ops'],
  // Atender o descartar una alerta del comercio, y trabajar oportunidades de expansión.
  'alert.work': [...SELLERS, 'ops'],
  'expansion.work': [...SELLERS, 'ops'],
  // Ventanas del ciclo de vida, números de las alertas, guías de acción, pesos del puntaje, modelo de atención y reglas de expansión.
  'care.manage': ['admin', 'market_lead'],
  // Marcar un comercio como perdido (o regresarlo a inactivo), con motivo: quien dirige y Operaciones.
  'care.stage': [...MANAGERS, 'ops'],
  // Publicar el puntaje de salud al equipo, después de validarlo.
  'health.publish': ['admin'],
  // Constancia de capacitación y cambio de encargado visto en la visita.
  'training.record': [...SELLERS, 'ops'],
  'manager.change': [...SELLERS, 'ops'],
  // Plan de cuenta, relaciones por producto y revisiones de cuentas corporativas.
  'account.plan': [...SELLERS, 'ops'],
  // Comentarios de producto desde campo: los registra quien atiende al comercio; los responde quien lidera el mercado o administración.
  'feedback.create': [...SELLERS, 'ops'],
  'feedback.manage': ['admin', 'market_lead'],
  // Paquete partners-contratos (0033). Términos comerciales: dato reservado; los versiona quien lidera el mercado (la base repite
  // el límite con el campo reservado 'commercial_terms'). El contrato lo lleva quien vende la cuenta.
  'terms.manage': ['admin', 'market_lead'],
  'contract.manage': SELLERS,
  // Partners: registrar cuentas como partner, niveles, material y tokens de lectura. El cruce de bases tiene acceso restringido.
  'partner.manage': ['admin', 'market_lead'],
  'partner.crossmatch': ['admin', 'market_lead'],
  // Portal de partners: el usuario de partner ve su subárbol (RLS) y nada más.
  'partner.portal': ['partner'],
  // Plan compartido de integración con el cliente: quien vende la cuenta y Operaciones.
  'plan.manage': [...SELLERS, 'ops'],
  // Red adquirida: la carga y la promoción, quien lidera el mercado o administración. Liberan legal (administración) y negocio.
  'network.load': ['admin', 'market_lead'],
  'network.release_legal': ['admin'],
  'network.release_business': ['admin', 'market_lead'],
  // Paquete ia (0034): asistencia por reglas y el marco de AI. Ver sugerencias y borradores: quien vende o dirige, y leadership en
  // solo lectura. Aceptarlas, descartarlas o aprobar un borrador: quien vende o dirige. Preguntar por las cifras definidas: quien
  // dirige y leadership. Nivel de autonomía, pesos, control y evaluación: administración (parte Embudos y campos).
  'ia.read': [...SELLERS, 'lt'],
  'ia.act': SELLERS,
  'ia.ask': ['admin', 'lt', 'market_lead', 'supervisor'],
  'ia.oversee': ['admin', 'lt'],
  'ia.manage': ['admin'],
  // Paquete conectores (0044): "Probar conexión" de un conector en Estado de CONTIGO, solo administración (queda en la bitácora).
  'connector.test': ['admin'],
  // AUT-05: activar los avisos del navegador en el propio navegador. Cada persona lo hace para sí misma.
  'push.subscribe': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance', 'agency', 'partner'],
  // ACT-03: encender la captura de su propio correo y calendario (solo metadatos, solo contactos conocidos).
  'capture.optin': ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance'],
  // E4.F2 (datos2): Ventas, Operaciones y Finanzas cambian dueños, fusionan duplicados y editan en bloque SOLO en los mercados
  // donde la decisión "Lo que pueden hacer Ventas y Operaciones" está encendida (Administración, Decisiones de negocio). El
  // contexto revisa el mercado (server/context.ts); quien dirige o administra ya lo hace con sus capacidades de siempre.
  'operator.reassign': ['rep', 'ops', 'finance'],
  'operator.merge': ['rep', 'ops', 'finance'],
  'operator.bulk_edit': ['rep', 'ops', 'finance'],
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

/** E4.F2 (datos2): capacidades que además dependen de una decisión por mercado. */
export const OPERATOR_CAPS: readonly Capability[] = ['operator.reassign', 'operator.merge', 'operator.bulk_edit']

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
  // Ola 1: automatizaciones y responsables de indicadores son configuración; correr una tarea a mano es operar integraciones.
  'automation.manage': 'config',
  'automation.read': 'config',
  'metric.owner': 'config',
  'job.run': 'integrations',
  'ia.manage': 'config',
  'ia.oversee': 'any',
  'ia.ask': 'any',
  'ia.read': 'any',
  'load.configure': 'integrations',
  'pipedrive.backup': 'integrations',
  'market.reset_test': 'integrations',
  'connector.test': 'integrations',
  'push.subscribe': 'any',
  'capture.optin': 'any',
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
export const READ_CAPS: readonly Capability[] = ['board.supervisor', 'exception.read', 'board.lt', 'audit.read', 'report.view', 'report.own', 'adoption.read', 'status.read', 'security.read',
  // Ola 1: pantallas de lectura que la persona ya ve. Guardar, exportar o correr algo desde ellas sigue cortado (son acciones).
  'report.gallery', 'report.finance', 'report.reconcile', 'report.carry', 'adoption.team', 'automation.read', 'rollout.read', 'data.quality',
  // Paquete partners-contratos: el portal de partners solo lee.
  'partner.portal',
  // Paquete ia: ver sugerencias, preguntar por cifras y la pantalla de evaluación son lecturas.
  'ia.read', 'ia.ask', 'ia.oversee']

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
export type Home = '/hoy' | '/admin' | '/panel-lt' | '/supervisor' | '/operaciones' | '/partners'
export function homePath(memberships: Membership[]): Home {
  const has = (role: Role) => memberships.some((m) => m.role === role)
  if (has('admin')) return '/admin'
  if (has('lt')) return '/panel-lt'
  if (has('market_lead')) return '/supervisor'
  // Quien es de Operaciones y no vende ni supervisa empieza en su cola (paquete operaciones).
  if (has('ops') && !has('supervisor') && !has('rep')) return '/operaciones'
  // Un usuario de partner solo tiene su portal (paquete partners-contratos).
  if (memberships.every((m) => m.role === 'partner')) return '/partners'
  return '/hoy'
}
