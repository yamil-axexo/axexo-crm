import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { zohoList } from './live/providers'

/**
 * GOB-05: Zoho (Zoho Desk y Zoho CRM). CONTIGO no tiene acceso a Zoho hoy: no hay importador ni conexión.
 * `off` (por defecto): no llama a nada; "Estado de CONTIGO" lo muestra apagado con lo que falta.
 * `simulated` (solo con APP_ENV=test y ZOHO_ADAPTER=simulated): entrega las filas que la prueba dejó preparadas.
 * No hay implementación real: conectar Zoho pasa por la revisión de tecnología (Dan Mulligan o Michael Essiet).
 */
export type ZohoRow = Record<string, unknown>
export type ZohoAdapter = {
  mode: ConnectorMode
  envVar: 'ZOHO_ADAPTER'
  /** Las filas de un módulo de Zoho, o una lista vacía si está apagado. */
  list: (module: ZohoModule) => Promise<ZohoRow[]>
}
export type ZohoModule = 'Accounts' | 'Contacts' | 'Deals'

/**
 * El mapa de campos documentado: qué campo estándar de Zoho iría a qué campo de CONTIGO cuando exista el acceso.
 * Los campos propios de cada cuenta de Zoho se registran en el registro de campos, igual que los de Pipedrive.
 * Lo que el estándar prohíbe (identificaciones completas, cuentas, tarjetas) no entra aunque Zoho lo tenga.
 */
export const ZOHO_FIELD_MAP: { module: ZohoModule; zoho: string; contigo: string; note: [string, string] }[] = [
  { module: 'Accounts', zoho: 'Account_Name', contigo: 'accounts.name', note: ['Nombre del comercio.', 'Merchant name.'] },
  { module: 'Accounts', zoho: 'Phone', contigo: 'accounts.phone', note: ['Normalizado a E.164 con el prefijo del mercado.', 'Normalized to E.164 with the market prefix.'] },
  { module: 'Accounts', zoho: 'Owner', contigo: 'accounts.owner_id', note: ['Por correo de la persona; sin coincidencia queda sin persona asignada.', 'By the person’s email; with no match it stays with no owner.'] },
  { module: 'Accounts', zoho: 'Billing_Street, Billing_City, Billing_State, Billing_Code, Billing_Country', contigo: 'accounts.address_line, locality, region, postal_code, country', note: ['Dirección.', 'Address.'] },
  { module: 'Accounts', zoho: 'Parent_Account', contigo: 'accounts.parent_id', note: ['Relación padre e hijo de organizaciones.', 'Parent and child organization relationship.'] },
  { module: 'Accounts', zoho: 'id', contigo: "account_aliases (system 'zoho')", note: ['Alias para reconocer el comercio al repetir la carga.', 'Alias to recognize the merchant when the load is repeated.'] },
  { module: 'Contacts', zoho: 'First_Name, Last_Name', contigo: 'contacts.full_name', note: ['Nombre completo.', 'Full name.'] },
  { module: 'Contacts', zoho: 'Email, Phone, Mobile', contigo: 'contacts.email, phone', note: ['El primero válido de cada uno.', 'The first valid one of each.'] },
  { module: 'Contacts', zoho: 'Account_Name', contigo: 'account_contacts', note: ['Liga el contacto a su comercio.', 'Links the contact to its merchant.'] },
  { module: 'Deals', zoho: 'Deal_Name, Amount, Stage, Closing_Date', contigo: 'deals.title, amount_minor, stage_id, won_at o lost_at', note: ['La etapa se mapea a mano por embudo antes de cargar.', 'Stages are mapped by hand per pipeline before loading.'] },
]

const g = globalThis as unknown as { __contigoSimulatedZoho?: Partial<Record<ZohoModule, ZohoRow[]>> }
export const simulatedZoho = () => (g.__contigoSimulatedZoho ??= {})

/** `live`: ZOHO_ADAPTER=live, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN (alcance de solo lectura) y la aprobación. */
export const ZOHO_GATE = { envVar: 'ZOHO_ADAPTER', credentials: ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'] } as const
export function zohoAdapter(): ZohoAdapter {
  const mode = gate(ZOHO_GATE).mode
  const simulated = mode === 'simulated'
  return {
    envVar: 'ZOHO_ADAPTER',
    mode,
    list: async (module) => mode === 'live' ? zohoList(module) : (simulated ? [...(simulatedZoho()[module] ?? [])] : []),
  }
}
