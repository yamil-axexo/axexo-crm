import type { T } from '@/lib/format'

type Pair = [es: string, en: string]
type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'

export const LIFECYCLE: Record<string, { label: Pair; tone: Tone }> = {
  prospect: { label: ['Prospecto', 'Prospect'], tone: 'neutral' },
  onboarding: { label: ['En alta', 'Onboarding'], tone: 'info' },
  active: { label: ['Activo', 'Active'], tone: 'good' },
  at_risk: { label: ['En riesgo', 'At risk'], tone: 'warn' },
  inactive: { label: ['Inactivo', 'Inactive'], tone: 'bad' },
  churned: { label: ['Baja', 'Churned'], tone: 'bad' },
}

export const LEAD_STATUS: Record<string, { label: Pair; tone: Tone }> = {
  new: { label: ['Nuevo', 'New'], tone: 'accent' },
  contacted: { label: ['Contactado', 'Contacted'], tone: 'info' },
  qualified: { label: ['Calificado', 'Qualified'], tone: 'good' },
  disqualified: { label: ['Descartado', 'Disqualified'], tone: 'neutral' },
  converted: { label: ['Convertido', 'Converted'], tone: 'good' },
}

export const MOTOR: Record<string, Pair> = {
  d2d: ['Tiendas, puerta a puerta', 'Stores, door to door'],
  b2b: ['Cadenas y distribuidores', 'Chains and distributors'],
  dealer: ['Dealers', 'Dealers'],
  event: ['Eventos', 'Events'],
  orders: ['Pedidos', 'Orders'],
  other: ['Otro', 'Other'],
}

export const KIND: Record<string, Pair> = {
  store: ['Tienda', 'Store'],
  chain: ['Cadena', 'Chain'],
  distributor: ['Distribuidor', 'Distributor'],
  organization: ['Organización', 'Organization'],
}

export const SOURCE: Record<string, Pair> = {
  web_form: ['Formulario web', 'Web form'],
  web_campaign: ['Campaña web', 'Web campaign'],
  manual: ['Captura manual', 'Manual entry'],
  import: ['Importación', 'Import'],
  referral: ['Referido', 'Referral'],
  sales_app: ['Sales App', 'Sales App'],
  walk_in: ['Visita en tienda', 'In-store visit'],
  phone_in: ['Llamada entrante', 'Inbound call'],
  event: ['Evento', 'Event'],
}

export const EXCEPTION: Record<string, { label: Pair; action: Pair }> = {
  lead_sla: { label: ['Lead sin atender a tiempo', 'Lead past its response time'], action: ['Contactar hoy', 'Reach out today'] },
  revisit_due: { label: ['Revisita pendiente a quien decide', 'Decision-maker revisit due'], action: ['Volver con quien decide', 'Go back to the decision-maker'] },
  activation_risk: { label: ['Alta sin primera venta', 'Enrolled, no first sale yet'], action: ['Ayudar a hacer la primera venta', 'Help them make the first sale'] },
  no_next_step: { label: ['Negocio sin próximo paso', 'Deal with no next step'], action: ['Definir próximo paso', 'Set the next step'] },
  stalled_deal: { label: ['Negocio estancado', 'Stalled deal'], action: ['Mover o cerrar', 'Move it or close it'] },
  reactivation: { label: ['Comercio en riesgo', 'Merchant at risk'], action: ['Llamar para reactivar', 'Call to reactivate'] },
  unowned_account: { label: ['Comercio sin asignar', 'Merchant with no owner'], action: ['Asignar a alguien', 'Assign an owner'] },
  duplicate_suspect: { label: ['Posible duplicado', 'Possible duplicate'], action: ['Revisar y fusionar', 'Review and merge'] },
  unmatched_event: { label: ['Evento sin comercio', 'Event with no merchant'], action: ['Revisar integración', 'Review the integration'] },
  under_plan: { label: ['Va por debajo de su meta del mes', 'Behind on this month’s target'], action: ['Revisarlo en el uno a uno', 'Go over it in the one-on-one'] },
  perfect_store_low: { label: ['Punto de venta por debajo del mínimo', 'Store below the minimum score'], action: ['Visitar y completar lo que falta', 'Visit and complete what is missing'] },
  lead_no_next_step: { label: ['Lead contactado sin tarea siguiente', 'Contacted lead with no next task'], action: ['Agendar la siguiente tarea', 'Schedule the next task'] },
  onboarding_no_next_step: { label: ['Comercio en alta sin tarea siguiente', 'Onboarding merchant with no next task'], action: ['Agendar la siguiente tarea', 'Schedule the next task'] },
}

export const ACTIVITY: Record<string, Pair> = {
  note: ['Nota', 'Note'],
  call: ['Llamada', 'Call'],
  meeting: ['Reunión', 'Meeting'],
  task: ['Tarea', 'Task'],
  email: ['Correo', 'Email'],
  handoff: ['Entrega a Operaciones', 'Handoff'],
  system: ['Sistema', 'System'],
  visit: ['Visita', 'Visit'],
  stage: ['Cambio de etapa', 'Stage change'],
  attribution: ['Cambio de quién lo lleva', 'Owner change'],
}

export const CONTACT_ROLE: Record<string, Pair> = {
  owner: ['Dueño del comercio', 'Store owner'],
  decision_maker: ['Quien decide', 'Decision-maker'],
  manager: ['Encargado', 'Manager'],
  staff: ['Personal', 'Staff'],
  billing: ['Facturación', 'Billing'],
  executive: ['Dirección', 'Executive'],
  purchasing: ['Compras', 'Purchasing'],
  finance: ['Finanzas', 'Finance'],
  technology: ['Tecnología e integración', 'Technology and integration'],
  legal: ['Legal', 'Legal'],
  operations: ['Operación', 'Operations'],
}

export const ATTRIBUTION_LAYER: Record<string, Pair> = {
  origin: ['Origen', 'Origin'],
  channel: ['Canal', 'Channel'],
  owner: ['Quién lo lleva', 'Owner'],
}

export const ALIAS_SYSTEM: Record<string, string> = {
  sales_core: 'Sales App',
  s5: 'Merchant ID',
  pipedrive: 'Pipedrive',
  zoho: 'Zoho',
  emida: 'EMIDA',
  sky: 'Sky',
  movilway: 'Movilway',
  other: 'Otro',
}

export const lab = (t: T, pair: Pair | undefined, fallback = '') => (pair ? t(pair[0], pair[1]) : fallback)

export const qs = (base: string, params: Record<string, string | undefined | null>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
  const s = sp.toString()
  return s ? `${base}?${s}` : base
}
