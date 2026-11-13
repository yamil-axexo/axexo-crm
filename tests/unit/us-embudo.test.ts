import { describe, expect, it } from 'vitest'
import { extractNoteFields, purposeFromNote, type NoteFieldDef } from '@/domain/note-fields'
import { routesAdapter, simulatedRouteSyncs } from '@/server/adapters/routes'

const defs: NoteFieldDef[] = [
  { key: 'interest_level', label_es: 'Nivel de interés', label_en: 'Interest Level', data_type: 'select', options: ['High', 'Medium', 'Low', 'None/Unknown'] },
  { key: 'services_offered_today', label_es: 'Servicios que ofrece hoy', label_en: 'Services Offered Today', data_type: 'multiselect', options: ['Top-ups', 'Bill pay', 'Money transfers', 'None/Unknown'] },
  { key: 'clerks_at_counter', label_es: 'Personas en el mostrador', label_en: 'Clerks at the Counter', data_type: 'number', options: [] },
  { key: 'store_hours', label_es: 'Horario de la tienda', label_en: 'Store Hours', data_type: 'text', options: [] },
  { key: 'contract_signed_on', label_es: 'Contrato firmado y enviado', label_en: 'Contract signed & submitted', data_type: 'date', options: [] },
]

describe('E12.F3: lo escrito en la nota de la visita pasa a sus campos', () => {
  it('un renglón "Campo: valor" va a su campo, en español o en inglés, y lo demás se queda en la nota', () => {
    const out = extractNoteFields('Talked to the owner, wants a demo.\nInterest level: high\nServicios que ofrece hoy: Top-ups, bill pay\nClerks at the counter: 3\nStore hours: 9 to 9\nCall back on Friday', defs)
    expect(out.values).toEqual({ interest_level: 'High', services_offered_today: ['Top-ups', 'Bill pay'], clerks_at_counter: '3', store_hours: '9 to 9' })
    expect(out.moved.map((m) => m.key)).toEqual(['interest_level', 'services_offered_today', 'clerks_at_counter', 'store_hours'])
    expect(out.rest).toBe('Talked to the owner, wants a demo.\nCall back on Friday')
  })

  it('un valor que no es válido para el campo, o un nombre que no es un campo, no se mueve', () => {
    const note = 'Interest level: enormous\nClerks at the counter: many\nContract signed & submitted: last week\nOwner: Dana\nServices offered today: Top-ups and Lottery'
    const out = extractNoteFields(note, defs)
    expect(out.values).toEqual({})
    expect(out.moved).toEqual([])
    expect(out.rest).toBe(note)
    expect(extractNoteFields('', defs)).toEqual({ values: {}, moved: [], rest: '' })
    expect(extractNoteFields(null, defs).rest).toBe('')
    // el mismo campo dos veces: vale el primero y el segundo renglón se queda en la nota
    const twice = extractNoteFields('Interest level: Low\nInterest level: High', defs)
    expect(twice.values).toEqual({ interest_level: 'Low' })
    expect(twice.rest).toBe('Interest level: High')
    expect(extractNoteFields('Contract signed & submitted: 2026-11-02\nNivel de interés: None/Unknown', defs).values).toEqual({ contract_signed_on: '2026-11-02', interest_level: 'None/Unknown' })
  })

  it('el propósito escrito en la nota se reconoce contra la lista', () => {
    const reasons = [{ code: 'training', label_es: 'Capacitación', label_en: 'Training' }, { code: 'follow_up', label_es: 'Seguimiento', label_en: 'Follow-up' }]
    expect(purposeFromNote('Purpose: training\nShowed the portal', reasons)).toEqual({ code: 'training', rest: 'Showed the portal' })
    expect(purposeFromNote('Motivo de la visita: Seguimiento', reasons)).toEqual({ code: 'follow_up', rest: '' })
    expect(purposeFromNote('Reason for visit: follow up', reasons)).toEqual({ code: 'follow_up', rest: '' })
    expect(purposeFromNote('Purpose: lunch', reasons)).toBeNull()
    expect(purposeFromNote('Just a note', reasons)).toBeNull()
  })
})

describe('adaptador de la herramienta de rutas', () => {
  it('apagado por defecto: no sale nada; simulado solo en pruebas y con su variable', async () => {
    const store = { account_id: 'a', name: 'Store', address: null, locality: null, region: null, postal_code: null, phone: null, contact: null, merchant_ref: null, approved_products: [], txn_count_30d: null, last_visit_on: null }
    const before = process.env.ROUTE_TOOL
    delete process.env.ROUTE_TOOL
    const off = routesAdapter()
    expect(off.mode).toBe('off')
    expect(await off.pushStores({ owner_id: 'u', market: 'US', stores: [store] })).toEqual({ status: 'off', stores: 0 })
    expect(simulatedRouteSyncs()).toHaveLength(0)
    process.env.ROUTE_TOOL = 'simulated'
    const sim = routesAdapter()
    expect(sim.mode).toBe('simulated')
    expect(await sim.pushStores({ owner_id: 'u', market: 'US', stores: [store] })).toEqual({ status: 'simulated', stores: 1 })
    expect(simulatedRouteSyncs()).toHaveLength(1)
    // fuera de pruebas la variable sola no enciende nada: no hay implementación real
    const env = process.env as Record<string, string | undefined>
    const app = env.APP_ENV
    env.APP_ENV = 'production'
    expect(routesAdapter().mode).toBe('off')
    env.APP_ENV = app
    if (before === undefined) delete process.env.ROUTE_TOOL
    else process.env.ROUTE_TOOL = before
  })
})
