import { describe, expect, it } from 'vitest'
import * as M from '@/domain/pipedrive/mapping'

const f = (name: string, type: string, options: [string, string][] = [], custom = true, code?: string): M.PdField => ({
  code: code ?? name.toLowerCase().replace(/\W+/g, '').padEnd(40, '0').slice(0, 40), name, type, custom, options: options.map(([id, label]) => ({ id, label })),
})
const card = ['4111', '1111', '1111', '1111'].join(' ')
const ssn = ['078', '05', '1120'].join('-')

describe('mapeo Pipedrive → CONTIGO', () => {
  it('decide el destino de cada campo: columna del modelo, campo adicional o restringido (DATA-06)', () => {
    const plans = M.planFields('organization', [
      f('Market', 'enum', [['1', 'US'], ['2', 'MX']]), f('Lifecycle stage', 'enum'), f('Tax ID', 'varchar'), f('Merchant ID EMIDA', 'varchar'),
      f('Monthly Volume', 'double'), f('Business Bank Account', 'enum', [['1', 'Yes']]), f('Bank Account Number', 'varchar'), f('Labels', 'set', [], false, 'label_ids'), f('ID', 'int', [], false, 'id'),
    ], new Map(), new Set())
    const by = Object.fromEntries(plans.map((p) => [p.label, p]))
    expect(by.Market!.mappedTo).toBe('core:market')
    expect(by['Lifecycle stage']!.mappedTo).toBe('core:lifecycle')
    expect(by['Tax ID']).toMatchObject({ mappedTo: 'policy:last4', dataClass: 'confidential' })
    expect(by['Bank Account Number']!.mappedTo).toBe('policy:omit')
    expect(by['Business Bank Account']!.mappedTo).toBeNull() // es un sí/no, no un número de cuenta
    expect(by['Merchant ID EMIDA']!.mappedTo).toBe('alias:emida')
    expect(by['Monthly Volume']).toMatchObject({ key: 'monthly_volume', dataType: 'number', mappedTo: null })
    expect(by.Labels).toMatchObject({ custom: false, dataType: 'multiselect' })
    expect(by.ID).toBeUndefined()
  })
  it('las llaves son estables, únicas y válidas aunque el nombre empiece con número o se repita', () => {
    const taken = new Set<string>()
    expect(M.slugKey('H2O Status', taken)).toBe('h2o_status')
    expect(M.slugKey('H2O status', taken)).toBe('h2o_status_2')
    expect(M.slugKey('30-day Activations', taken)).toBe('f_30_day_activations')
    expect(M.slugKey('Teléfono (AT&T)', taken)).toBe('telefono_at_t')
    const again = M.planFields('deal', [f('Lead Source renamed', 'enum')], new Map([[f('Lead Source renamed', 'enum').code, 'lead_source']]), new Set())
    expect(again[0]!.key).toBe('lead_source')
  })
  it('convierte valores por tipo', () => {
    const users = new Map([['12', 'Omar Vidal']])
    const sel = { dataType: 'select' as const, pdType: 'enum', pdOptions: [{ id: '901', label: 'Referral' }] }
    expect(M.convertValue(sel, 901, users)).toBe('Referral')
    expect(M.convertValue(sel, { id: 901, label: 'Referral' }, users)).toBe('Referral')
    expect(M.convertValue({ ...sel, dataType: 'multiselect' }, [901, 999], users)).toEqual(['Referral', '999'])
    expect(M.convertValue({ dataType: 'money', pdType: 'monetary', pdOptions: [] }, { value: 2500, currency: 'USD' }, users)).toEqual({ amount: 2500, currency: 'USD' })
    expect(M.convertValue({ dataType: 'user', pdType: 'user', pdOptions: [] }, 12, users)).toBe('Omar Vidal')
    expect(M.convertValue({ dataType: 'date', pdType: 'date', pdOptions: [] }, '2026-08-14T00:00:00Z', users)).toBe('2026-08-14')
    expect(M.convertValue({ dataType: 'text', pdType: 'daterange', pdOptions: [] }, { value: '2026-01-01', until: '2026-02-01' }, users)).toBe('2026-01-01 → 2026-02-01')
    expect(M.convertValue({ dataType: 'number', pdType: 'double', pdOptions: [] }, null, users)).toBeUndefined()
    expect(M.convertValue({ dataType: 'text', pdType: 'varchar', pdOptions: [] }, [{ value: 'a@x.test' }, { value: 'b@x.test' }], users)).toBe('a@x.test, b@x.test')
  })
  it('un texto libre con tarjeta o SSN entra sin ese fragmento (SEC-08)', () => {
    expect(M.scrub(`pago con ${card} ayer`)).toBe(`pago con ${M.OMITTED} ayer`)
    expect(M.scrub(`ssn ${ssn}`)).toBe(`ssn ${M.OMITTED}`)
    expect(M.scrub('tel +525512345678 folio 1234567890123')).toBe('tel +525512345678 folio 1234567890123')
    expect(M.htmlToText(`<p>Hola&nbsp;mundo</p><p>${card}</p><script>x</script>`)).toBe(`Hola mundo\n${M.OMITTED}\nx`)
    expect(M.last4('XAXX-010101-000')).toBe('1000')
  })
  it('resuelve mercado, motor y cierre por transacción desde la configuración real', () => {
    expect(M.marketFromPipelineName('MX - D2D Store Enrollment')).toBe('MX')
    expect(M.marketFromPipelineName('Pipeline')).toBeNull()
    expect(['MX - D2D Store Enrollment', 'MX - B2B / ISO', 'US - Dealer Enrollment', 'US - Vegas Conference 2026', 'US - Sales Orders'].map(M.motorFromPipelineName)).toEqual(['d2d', 'b2b', 'dealer', 'event', 'orders'])
    expect(['d2d', 'b2b', 'dealer', 'event', 'orders'].map(M.closesByTransaction)).toEqual([true, true, true, false, false])
    expect([M.countryCode('México'), M.countryCode('United States'), M.countryCode('US'), M.countryCode('Francia')]).toEqual(['MX', 'US', 'US', null])
    expect([M.marketFromPhone('+52 55 1234 5678'), M.marketFromPhone('+13055550142'), M.marketFromPhone('5512345678')]).toEqual(['MX', 'US', null])
    expect(['Prospect', 'Onboarding', 'Active', 'Inactive', 'Churned', 'Otro'].map(M.lifecycleFromLabel)).toEqual(['prospect', 'onboarding', 'active', 'inactive', 'churned', null])
    expect([M.contactRole('Owner', 'No'), M.contactRole('Employee', 'Yes'), M.contactRole('Manager', null), M.contactRole(null, null)]).toEqual(['owner', 'decision_maker', 'manager', 'staff'])
    expect([M.activityKind('call', 'Call'), M.activityKind('visit', 'Visit'), M.activityKind('deadline', 'Deadline'), M.activityKind('portal_migration', 'Portal Migration')]).toEqual(['call', 'meeting', 'task', 'task'])
    expect(M.lossCode('Went with competitor')).toBe('pd_went_with_competitor')
    expect([M.toMinor(1500.5), M.toMinor(-1), M.toMinor('x')]).toEqual([150050, null, null])
    expect(M.isoTime('2026-10-12 14:00:00')).toBe('2026-10-12T14:00:00.000Z')
  })
})
