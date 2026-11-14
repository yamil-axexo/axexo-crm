import type postgres from 'postgres'

/** Lo que piden los candados del alta de dealers de US (E10.F5, F6, F8, F9), listo para un negocio de prueba. */
export const PRESENTED = { interest_level: 'High', services_offered_today: ['Top-ups'], competitor_portals_used: ['None/Unknown'], remittance_brands_offered: ['None/Unknown'] }
export const SALES_QUALIFIED = { primary_remittance_corridor: 'Mexico', topup_destinations_served: ['Mexico'], primary_remittance_provider: 'None/Unknown', remittance_frequency: 'Weekly', business_bank_account: 'Yes', top_carriers_by_volume: ['North carrier'] }
export const DOCS = { products_requested: ['Domestic top-up'], account_funding: 'ACH' }
export const APPROVALS = { contract_signed_on: '2026-11-01' }
export const ENROLLMENT_READY = { ...PRESENTED, ...SALES_QUALIFIED, ...DOCS, ...APPROVALS }

/**
 * Deja un negocio de alta de dealers con los campos que piden sus etapas, directo en la base: para las pruebas que no
 * tratan de los candados y solo necesitan un negocio que pueda avanzar. `skip` deja fuera las claves que la prueba quiere exigir.
 */
export async function fillEnrollment(sql: postgres.Sql, dealId: string, skip: string[] = []): Promise<void> {
  const values = Object.fromEntries(Object.entries(ENROLLMENT_READY).filter(([k]) => !skip.includes(k)))
  await sql`update crm.deals set custom = custom || ${sql.json(values)} where id = ${dealId}`
}
