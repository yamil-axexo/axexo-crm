import type { T } from '@/lib/format'

/** E9.F5: origen del comercio. */
export const ORIGIN: Record<string, [es: string, en: string]> = {
  new_acquisition: ['Alta nueva', 'New acquisition'],
  emida_conversion: ['Conversión de EMIDA', 'EMIDA conversion'],
}

/** E9.F12: quién reclutó la tienda, en palabras. */
export const recruiterText = (t: T, kind: string | null, agency: string | null): string | null =>
  kind === 'field_team' ? t('Equipo de campo de axexo', 'axexo field team')
    : kind === 'agency' ? t(`Agencia: ${agency ?? 's/d'}`, `Agency: ${agency ?? 'n/a'}`)
      : kind === 'partner' ? t(`Socio: ${agency ?? 's/d'}`, `Partner: ${agency ?? 'n/a'}`) : null

type Def = { key: string; label_en: string }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * E9.F11: los demás campos de la tienda que el equipo de US conserva, agrupados como los lee. Cada uno se resuelve contra el
 * registro de campos: el que creó la configuración (`us_...`) o, si la importación ya lo trajo, el importado con ese nombre.
 */
export const KEPT_GROUPS: { id: string; title: [es: string, en: string]; slots: { key: string; /** Nombres en inglés con los que puede venir de la importación, separados por |. */ names: string }[] }[] = [
  { id: 'account', title: ['Cuenta', 'Account'], slots: [
    { key: 'us_account_manager', names: 'Account manager' }, { key: 'us_dba', names: 'DBA|Doing business as' }, { key: 'us_store_owner_name', names: 'Store Owner name|Store Owner' },
    { key: 'us_lead_type', names: 'Lead Type' }, { key: 'us_merchant_classification', names: 'Merchant Classification' }, { key: 'us_training', names: 'Training' }] },
  { id: 'churn', title: ['Bajas', 'Churn'], slots: [
    { key: 'us_churn_status_instapay', names: 'Churn status InstaPay|InstaPay churn status' }, { key: 'us_churn_status_tmobile', names: 'Churn status T-Mobile|T-Mobile churn status' }] },
  { id: 'empower', title: ['Portal Empower', 'Empower portal'], slots: [
    { key: 'us_empower_mids', names: 'Empower MIDs|Empower MID' }, { key: 'us_empower_tier', names: 'Empower tier|Empower tiers' }, { key: 'us_empower_signup_date', names: 'Empower sign-up date|Empower signup date' }] },
  { id: 'hdn', title: ['HDN', 'HDN'], slots: [
    { key: 'us_hdn_account', names: 'HDN account|HDN Account ID' }, { key: 'us_hdn_user', names: 'HDN user' }, { key: 'us_hdn_email', names: 'HDN email' }, { key: 'us_hdn_phone', names: 'HDN phone' }] },
]

export function resolveKept<D extends Def>(defs: D[]): { id: string; title: [string, string]; fields: D[] }[] {
  return KEPT_GROUPS.map((g) => ({
    id: g.id, title: g.title,
    fields: g.slots.map((slot) => defs.find((d) => d.key === slot.key) ?? defs.find((d) => slot.names.split('|').some((n) => norm(n) === norm(d.label_en)))).filter((d): d is D => Boolean(d)),
  })).filter((g) => g.fields.length > 0)
}
