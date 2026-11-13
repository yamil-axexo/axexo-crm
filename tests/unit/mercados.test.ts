import { describe, expect, it } from 'vitest'
import { checkTaxId, maskedTaxId, normalizeTaxId, taxIdLast4, taxIdTypeFor } from '@/lib/tax-id'
import { AUDIT_ACTION, AUDIT_GROUPS, AUDIT_OBJECT } from '@/lib/audit'
import { CAPABILITIES, can, type Membership } from '@/domain/policy'
import { FICHA_FACTS, FICHA_FACT_LABEL, US_STATE_ZONE, distanceText, fichaRole } from '@/lib/markets'

// Paquete de mercados: lo que se puede probar sin base. Los identificadores de ejemplo son los de la documentación pública
// de cada formato (no son de ningún comercio).

describe('identificador fiscal: formato y dígito verificador por país', () => {
  it('RFC de México: 12 (empresa) o 13 (persona), fecha real y dígito verificador', () => {
    expect(checkTaxId('mx_rfc', 'GODE561231GR8')).toMatchObject({ formatOk: true, checksumOk: true, person: 'natural', normalized: 'GODE561231GR8' })
    expect(checkTaxId('mx_rfc', 'gode 561231-gr8')).toMatchObject({ formatOk: true, checksumOk: true })
    expect(checkTaxId('mx_rfc', 'ABC680524P73')).toMatchObject({ formatOk: true, checksumOk: true, person: 'legal' })
    // El dígito verificador que no cuadra NO rechaza: hay RFC antiguos válidos que no lo cumplen. Pasa a revisión humana.
    expect(checkTaxId('mx_rfc', 'ABC680524P76')).toMatchObject({ formatOk: true, checksumOk: false })
    expect(checkTaxId('mx_rfc', 'ABC681324P76')).toMatchObject({ formatOk: false, problem: 'date' })
    expect(checkTaxId('mx_rfc', 'XAXX010101000')).toMatchObject({ formatOk: false, problem: 'generic' })
    expect(checkTaxId('mx_rfc', '12345')).toMatchObject({ formatOk: false, problem: 'format' })
  })
  it('EIN de Estados Unidos: 9 números con prefijo asignado; un SSN nunca se acepta', () => {
    expect(checkTaxId('us_ein', '12-3456789')).toMatchObject({ formatOk: true, checksumOk: null, normalized: '123456789' })
    expect(checkTaxId('us_ein', '07-3456789')).toMatchObject({ formatOk: false, problem: 'prefix' })
    expect(checkTaxId('us_ein', '123-45-6789')).toMatchObject({ formatOk: false, problem: 'ssn', normalized: '' })
    expect(checkTaxId('other', '123-45-6789')).toMatchObject({ formatOk: false, problem: 'ssn' })
    expect(checkTaxId('us_ein', '12-34567')).toMatchObject({ formatOk: false, problem: 'format' })
  })
  it('NIT de Colombia y de El Salvador: dígito de verificación', () => {
    expect(checkTaxId('co_nit', '213.123.432-1')).toMatchObject({ formatOk: true, checksumOk: true })
    expect(checkTaxId('co_nit', '800088702-2')).toMatchObject({ formatOk: true, checksumOk: true })
    expect(checkTaxId('co_nit', '800088702-3')).toMatchObject({ formatOk: true, checksumOk: false })
    expect(checkTaxId('sv_nit', '0614-050707-104-8')).toMatchObject({ formatOk: true, checksumOk: true })
    expect(checkTaxId('sv_nit', '0614-050707-104-9')).toMatchObject({ formatOk: true, checksumOk: false })
    expect(checkTaxId('sv_nit', '2614-050707-104-8')).toMatchObject({ formatOk: false })
  })
  it('CNPJ de Brasil: acepta letras (formato alfanumérico de julio de 2026) y sigue aceptando el numérico', () => {
    expect(checkTaxId('br_cnpj', '12.ABC.345/01DE-35')).toMatchObject({ formatOk: true, checksumOk: true, normalized: '12ABC34501DE35' })
    expect(checkTaxId('br_cnpj', '11.222.333/0001-81')).toMatchObject({ formatOk: true, checksumOk: true })
    expect(checkTaxId('br_cnpj', '12.ABC.345/01DE-36')).toMatchObject({ formatOk: true, checksumOk: false })
    expect(checkTaxId('br_cnpj', '00000000000000')).toMatchObject({ formatOk: false })
    // El identificador es texto: nunca se convierte a número.
    expect(typeof checkTaxId('br_cnpj', '12ABC34501DE35').normalized).toBe('string')
  })
  it('país sin validador: letras y números, y siempre pide revisión de una persona', () => {
    expect(checkTaxId('other', 'TRN 100-200-300')).toMatchObject({ formatOk: true, checksumOk: null, normalized: 'TRN100200300' })
    expect(checkTaxId('other', 'ab')).toMatchObject({ formatOk: false })
    expect(taxIdTypeFor('JM')).toBe('other')
    expect(taxIdTypeFor('PR')).toBe('us_ein')
    expect(taxIdTypeFor('mx')).toBe('mx_rfc')
  })
  it('lo que se guarda y se muestra son solo los últimos 4', () => {
    expect(taxIdLast4(normalizeTaxId('gode 561231-gr8'))).toBe('1GR8')
    expect(maskedTaxId('1GR8')).not.toContain('GODE')
    expect(maskedTaxId('1GR8').endsWith('1GR8')).toBe(true)
  })
})

describe('mercados: permisos, bitácora y metadata de la ficha', () => {
  const m = (role: Membership['role'], market: string | null = 'MX'): Membership[] => [{ market, role, teamId: null }]
  it('capturar el identificador fiscal es de quien lleva la cuenta u Operaciones; revisarlo, de quien lidera, Operaciones o administración', () => {
    expect(can(m('rep'), 'taxid.capture', 'MX')).toBe(true)
    expect(can(m('ops'), 'taxid.capture', 'MX')).toBe(true)
    expect(can(m('lt', null), 'taxid.capture', 'MX')).toBe(false)
    expect(can(m('rep'), 'taxid.review', 'MX')).toBe(false)
    expect(can(m('supervisor'), 'taxid.review', 'MX')).toBe(false)
    expect(can(m('ops'), 'taxid.review', 'MX')).toBe(true)
    expect(can(m('market_lead'), 'taxid.review', 'US')).toBe(false)
    expect(can(m('rep'), 'account.entity', 'MX')).toBe(false)
    expect(can(m('market_lead'), 'account.entity', 'MX')).toBe(true)
    expect(CAPABILITIES['account.entity']).not.toContain('lt')
  })
  it('cada acción nueva tiene nombre en español y en inglés, sin guiones largos, y cae en un grupo de la bitácora', () => {
    const like = (action: string, pattern: string) => new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/%/g, '.*')}$`).test(action)
    const actions: Record<'config' | 'records' | 'access', string[]> = {
      config: ['market.created', 'market.status_changed', 'market.holiday_added', 'market.holiday_removed', 'entity.created', 'entity.updated', 'whatsapp.account_saved', 'whatsapp.template_saved',
        'whatsapp.template_status', 'whatsapp.rate_saved', 'ficha.layout_set', 'field_section.created', 'field.section_set'],
      records: ['contact.updated', 'contact.ended', 'account.profile_set', 'account.address_set', 'account.located', 'account.location_cleared', 'account.whatsapp_window', 'taxid.captured', 'taxid.reviewed'],
      access: ['user.entity_set'],
    }
    for (const [group, list] of Object.entries(actions)) {
      for (const a of list) {
        const pair = AUDIT_ACTION[a]
        expect(pair, a).toBeDefined()
        expect(pair![0], a).not.toBe(pair![1])
        expect(`${pair![0]}${pair![1]}`, a).not.toMatch(/[—–]/)
        expect((AUDIT_GROUPS[group as 'config'].like ?? []).some((p) => like(a, p)), `${a} en ${group}`).toBe(true)
      }
    }
    for (const o of ['legal_entity', 'whatsapp_account', 'whatsapp_template', 'whatsapp_rate', 'ficha_layout', 'field_section']) expect(AUDIT_OBJECT[o], o).toBeDefined()
  })
  it('los datos de arriba de la ficha tienen nombre en los dos idiomas y el rol que manda es el de más alcance', () => {
    for (const f of FICHA_FACTS) {
      expect(FICHA_FACT_LABEL[f].es.length).toBeGreaterThan(2)
      expect(FICHA_FACT_LABEL[f].en.length).toBeGreaterThan(2)
    }
    expect(fichaRole(['rep', 'supervisor'])).toBe('supervisor')
    expect(fichaRole(['ops', 'rep'])).toBe('ops')
    expect(fichaRole([])).toBe('rep')
  })
  it('zona por estado de Estados Unidos y distancia legible', () => {
    expect(US_STATE_ZONE.CA).toBe('America/Los_Angeles')
    expect(US_STATE_ZONE.TX).toBe('America/Chicago')
    expect(US_STATE_ZONE.AZ).toBe('America/Phoenix')
    expect(Object.keys(US_STATE_ZONE)).toHaveLength(51)
    expect(distanceText(85, 'es')).toBe('85 m')
    expect(distanceText(1500, 'es')).toBe('1.5 km')
    expect(distanceText(12000, 'en')).toBe('12 km')
  })
})
