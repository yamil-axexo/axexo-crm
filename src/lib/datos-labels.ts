// Etiquetas del paquete datos (duplicados, fusión, productos por comercio, campos), en español y en inglés.
type Pair = [es: string, en: string]

export const MATCH_KIND: Record<string, Pair> = {
  phone: ['Mismo teléfono', 'Same phone'],
  email: ['Mismo correo', 'Same email'],
  external_id: ['Mismo ID de otro sistema', 'Same ID from another system'],
  name_address: ['Mismo nombre y dirección', 'Same name and address'],
  name: ['Nombre parecido', 'Similar name'],
}

export const SURVIVOR_LABEL: Record<string, Pair> = {
  name: ['Nombre', 'Name'],
  phone: ['Teléfono', 'Phone'],
  email: ['Correo', 'Email'],
  address_line: ['Dirección', 'Address'],
  locality: ['Ciudad', 'City'],
  region: ['Estado o región', 'State or region'],
  postal_code: ['Código postal', 'Postal code'],
  territory_id: ['Territorio', 'Territory'],
  owner_id: ['Quién lo lleva', 'Owner'],
  segment: ['Tipo de venta', 'Sale type'],
  merchant_ref: ['Merchant ID', 'Merchant ID'],
}

export const SURVIVOR_REASON: Record<string, Pair> = {
  kept: ['ya lo tenía el que se queda', 'the surviving record already had it'],
  filled: ['el que se queda no lo tenía', 'the surviving record did not have it'],
  chosen: ['lo eligió quien fusionó', 'chosen by whoever merged'],
}

export const PRODUCT_STATUS: Record<string, Pair> = {
  requested: ['Solicitado', 'Requested'],
  submitted: ['Enviado al proveedor', 'Sent to the provider'],
  approved: ['Aprobado', 'Approved'],
  active: ['Activo', 'Active'],
  rejected: ['Rechazado', 'Rejected'],
  suspended: ['Suspendido', 'Suspended'],
}
export const PRODUCT_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  requested: 'neutral', submitted: 'info', approved: 'good', active: 'good', rejected: 'bad', suspended: 'warn',
}

export const PII_CLASS: Record<string, Pair> = {
  none: ['No es dato personal', 'Not personal data'],
  personal: ['Dato personal', 'Personal data'],
  sensitive: ['Dato personal sensible', 'Sensitive personal data'],
}

export const FIELD_OBJECT: Record<string, Pair> = {
  account: ['Comercio', 'Merchant'],
  deal: ['Negocio', 'Deal'],
  lead: ['Lead', 'Lead'],
  contact: ['Contacto', 'Contact'],
  activity: ['Actividad', 'Activity'],
  product: ['Producto', 'Product'],
}

export const FIELD_TYPE: Record<string, Pair> = {
  text: ['Texto', 'Text'], long_text: ['Texto largo', 'Long text'], number: ['Número', 'Number'], date: ['Fecha', 'Date'], boolean: ['Sí o no', 'Yes or no'],
  select: ['Lista', 'List'], multiselect: ['Lista de varias', 'Multi-select list'], money: ['Monto', 'Amount'],
}

export const QUALITY_ROLE: Record<string, Pair> = {
  admin: ['Administración', 'Administration'],
  market_lead: ['Quien lidera el mercado', 'Market lead'],
  supervisor: ['Supervisión', 'Supervisors'],
  ops: ['Operaciones', 'Operations'],
}

export const ALIAS_KIND: Record<string, Pair> = {
  internal: ['Sistema de axexo', 'axexo system'],
  network: ['Red o empresa adquirida', 'Network or acquired company'],
  carrier: ['Proveedor o carrier', 'Provider or carrier'],
  crm: ['Otro CRM', 'Another CRM'],
  other: ['Otro', 'Other'],
}

export const ROUTING_STRATEGY: Record<string, Pair> = {
  round_robin: ['Por turnos, uno a uno', 'Round robin, one by one'],
  territory: ['Por territorio', 'By territory'],
  fixed: ['Todo a una persona', 'Everything to one person'],
}

/** Roles de contacto que se ofrecen según el tipo de venta de la cuenta: una tienda no pide "Legal" ni "Tecnología". */
const STORE_ROLES = ['owner', 'decision_maker', 'manager', 'staff', 'billing']
export const contactRolesFor = (segment: string | null | undefined, all: string[]): string[] =>
  segment === 'd2d' || segment === 'event' || segment === 'orders' ? all.filter((r) => STORE_ROLES.includes(r)) : all
