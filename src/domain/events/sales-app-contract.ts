// CAMPO-01: matriz del contrato entre la Sales App (con Sales Core) y CONTIGO: qué sistema manda en cada dato, cómo viaja y
// qué pasa si los dos lo tienen. De aquí salen la pantalla de Administración y docs/contracts/sales-app-events-v1.md.
type Pair = [es: string, en: string]
export type Owner = 'contigo' | 'sales_app' | 'sales_core' | 's5'
export const OWNER_LABEL: Record<Owner, Pair> = {
  contigo: ['CONTIGO', 'CONTIGO'], sales_app: ['Sales App', 'Sales App'], sales_core: ['Sales Core (alta)', 'Sales Core (onboarding)'], s5: ['Datos de ventas', 'Sales data'],
}
export type MatrixRow = { field: Pair; owner: Owner; travels: string; rule: Pair }

export const FIELD_MATRIX: MatrixRow[] = [
  { field: ['ID del punto de venta (customer_id)', 'Store ID (customer_id)'], owner: 'sales_core', travels: 'store.created · onboarding.submitted',
    rule: ['Nace allá. CONTIGO lo guarda como alias de su propio ID y avisa con account.alias_issued.', 'It is born there. CONTIGO stores it as an alias of its own ID and announces it with account.alias_issued.'] },
  { field: ['ID del comercio en CONTIGO', 'Merchant ID in CONTIGO'], owner: 'contigo', travels: 'account.alias_issued',
    rule: ['Un solo creador: si el comercio ya existe (mismo ID o mismo teléfono en el mercado), el evento se liga; nunca duplica.', 'One creator: if the merchant already exists (same ID or same phone in the market), the event links to it; it never duplicates.'] },
  { field: ['Nombre comercial, ciudad y estado', 'Trade name, city and state'], owner: 'contigo', travels: 'store.created · onboarding.submitted',
    rule: ['El evento los trae solo para crear el comercio la primera vez. Si ya existe, manda lo que dice CONTIGO.', 'The event carries them only to create the merchant the first time. If it exists, CONTIGO’s values win.'] },
  { field: ['Teléfono del comercio', 'Merchant phone'], owner: 'contigo', travels: 'store.created · onboarding.submitted',
    rule: ['Sirve para ligar al prospecto. No pisa el que ya está.', 'Used to link to the prospect. It does not overwrite the existing one.'] },
  { field: ['Quién lleva la cuenta, territorio, jerarquía y cartera', 'Account owner, territory, hierarchy and portfolio'], owner: 'contigo', travels: 'account.reassigned · account.territory_set',
    rule: ['Solo CONTIGO los cambia. El correo de quien vendió en el evento solo propone quién lo lleva cuando el comercio nace sin asignar.', 'Only CONTIGO changes them. The seller email in the event only suggests an owner when the merchant is born without one.'] },
  { field: ['Visita: fecha, duración, venta o no, motivo, decisor, revisita', 'Visit: date, duration, sale or not, reason, decision-maker, revisit'], owner: 'sales_app', travels: 'visit.checked_out',
    rule: ['La visita se registra una sola vez, allá. CONTIGO la lee y marca la revisita en el negocio; no la edita.', 'The visit is recorded once, there. CONTIGO reads it and flags the revisit on the deal; it does not edit it.'] },
  { field: ['Alta enviada y documentos completos', 'Onboarding submitted and documents complete'], owner: 'sales_app', travels: 'onboarding.submitted',
    rule: ['Pasa el comercio a "En alta" y deja la entrada en su hilo.', 'Moves the merchant to "Onboarding" and leaves the entry in its thread.'] },
  { field: ['Merchant ID', 'Merchant ID'], owner: 'sales_core', travels: 'merchant.approved',
    rule: ['Lo pone quien aprueba. Si otro comercio del mercado ya lo lleva, el mensaje queda detenido para revisarlo a mano.', 'Set by whoever approves. If another merchant in the market already has it, the message is held for manual review.'] },
  { field: ['Etapa del negocio y embudo', 'Deal stage and pipeline'], owner: 'contigo', travels: 'deal.stage_changed',
    rule: ['Ningún evento de la Sales App mueve la etapa. La aprobación no gana el negocio.', 'No Sales App event moves the stage. Approval does not win the deal.'] },
  { field: ['Primera transacción y actividad de ventas', 'First transaction and sales activity'], owner: 's5', travels: 'merchant_metrics_daily (archivo diario / daily file)',
    rule: ['Gana el negocio y activa el comercio. Llega por el archivo diario, no por evento.', 'Wins the deal and activates the merchant. It arrives in the daily file, not as an event.'] },
]

export const INBOUND_EVENTS: { type: string; version: number; about: Pair; required: string[] }[] = [
  { type: 'visit.checked_out', version: 1, about: ['Terminó una visita.', 'A visit ended.'], required: ['visit_id', 'customer_id', 'salesperson_id', 'business_date', 'checked_in_at', 'sale'] },
  { type: 'store.created', version: 1, about: ['Nació un punto de venta.', 'A store was created.'], required: ['customer_id', 'market', 'name'] },
  { type: 'onboarding.submitted', version: 1, about: ['Se envió el alta del comercio.', 'The merchant’s onboarding was submitted.'], required: ['customer_id', 'submitted_at'] },
  { type: 'merchant.approved', version: 1, about: ['El comercio fue aprobado y tiene Merchant ID.', 'The merchant was approved and has a Merchant ID.'], required: ['customer_id', 'merchant_ref', 'approved_at'] },
]

/** Por qué un mensaje está detenido, en palabras. */
export function stuckReason(error: string | null): Pair {
  if (!error) return ['Sin motivo anotado', 'No reason recorded']
  if (error === 'unknown customer_id') return ['No conocemos ese punto de venta todavía. Se reprocesa cuando llegue su tienda.', 'We do not know that store yet. Reprocess it once its store arrives.']
  if (error === 'unknown market') return ['El mercado del mensaje no existe en CONTIGO.', 'The market in the message does not exist in CONTIGO.']
  if (error === 'merchant_ref in use') return ['Ese Merchant ID ya lo lleva otro comercio del mercado.', 'Another merchant in the market already has that Merchant ID.']
  if (error === 'unknown_type') return ['El tipo de evento no está en el contrato.', 'The event type is not in the contract.']
  if (error === 'unsupported_version') return ['La versión del evento no es la del contrato (v1).', 'The event version is not the contract’s (v1).']
  if (error === 'not_an_object') return ['El mensaje no es un objeto JSON.', 'The message is not a JSON object.']
  if (error.startsWith('invalid_field:')) return [`Falta o no es válido el campo ${error.slice(14)}.`, `The field ${error.slice(14)} is missing or not valid.`]
  return ['No cumple el contrato.', 'It does not match the contract.']
}
