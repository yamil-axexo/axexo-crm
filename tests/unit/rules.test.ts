import { describe, expect, it } from 'vitest'
import { missingForStage, type GateDeal } from '@/domain/deals'
import { can, CAPABILITIES, type Membership, type Role } from '@/domain/policy'
import { money, pct, toE164 } from '@/lib/format'

const deal = (p: Partial<GateDeal> = {}): GateDeal => ({ amount_minor: null, next_step: null, next_step_due: null, decision_maker_id: null, decision_maker_met: false, ...p })

describe('criterios de etapa (PIPE-01, ACT-02)', () => {
  it('toda etapa abierta exige próximo paso con fecha, aunque la etapa no lo declare', () => {
    expect(missingForStage(deal(), { kind: 'open', required_fields: [] })).toEqual(['next_step'])
    expect(missingForStage(deal({ next_step: 'Llamar' }), { kind: 'open', required_fields: [] })).toEqual(['next_step'])
    expect(missingForStage(deal({ next_step: '   ', next_step_due: '2026-12-01' }), { kind: 'open', required_fields: [] })).toEqual(['next_step'])
    expect(missingForStage(deal({ next_step: 'Llamar', next_step_due: '2026-12-01' }), { kind: 'open', required_fields: [] })).toEqual([])
  })
  it('el monto tiene que ser mayor a cero', () => {
    const stage = { kind: 'open' as const, required_fields: ['amount'] }
    const ok = { next_step: 'x', next_step_due: '2026-12-01' }
    expect(missingForStage(deal({ ...ok, amount_minor: 0 }), stage)).toEqual(['amount'])
    expect(missingForStage(deal({ ...ok, amount_minor: '2500000' }), stage)).toEqual([])
  })
  it('el decisor cuenta solo si está identificado y ya se habló con él', () => {
    const stage = { kind: 'awaiting_txn' as const, required_fields: ['decision_maker'] }
    expect(missingForStage(deal({ decision_maker_id: 'c1' }), stage)).toEqual(['decision_maker'])
    expect(missingForStage(deal({ decision_maker_met: true }), stage)).toEqual(['decision_maker'])
    expect(missingForStage(deal({ decision_maker_id: 'c1', decision_maker_met: true }), stage)).toEqual([])
  })
  it('esperar la primera transacción no exige próximo paso', () => {
    expect(missingForStage(deal(), { kind: 'awaiting_txn', required_fields: [] })).toEqual([])
  })
})

describe('matriz de capacidades (AUT-01)', () => {
  const m = (role: Role, market: string | null = 'MX'): Membership[] => [{ role, market, teamId: null }]
  it('el LT lee tableros y auditoría pero no escribe nada', () => {
    const writes = (Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]).filter((c) => !['board.supervisor', 'board.lt', 'audit.read'].includes(c))
    for (const cap of writes) expect(can(m('lt', null), cap, 'MX'), cap).toBe(false)
    expect(can(m('lt', null), 'board.lt')).toBe(true)
  })
  it('un rol de mercado no aplica en otro mercado', () => {
    expect(can(m('rep', 'MX'), 'lead.create', 'MX')).toBe(true)
    expect(can(m('rep', 'MX'), 'lead.create', 'US')).toBe(false)
    expect(can(m('market_lead', 'US'), 'account.reassign', 'MX')).toBe(false)
  })
  it('solo administración configura, opera integraciones y fusiona', () => {
    for (const role of ['lt', 'market_lead', 'supervisor', 'rep', 'ops'] as Role[]) {
      expect(can(m(role, role === 'lt' ? null : 'MX'), 'config.manage', 'MX'), role).toBe(false)
      expect(can(m(role, role === 'lt' ? null : 'MX'), 'integration.operate', 'MX'), role).toBe(false)
      expect(can(m(role, role === 'lt' ? null : 'MX'), 'account.merge', 'MX'), role).toBe(false)
    }
    expect(can(m('admin', null), 'account.merge', 'US')).toBe(true)
  })
  it('un vendedor no reasigna cartera ni leads; un supervisor sí', () => {
    expect(can(m('rep'), 'account.reassign', 'MX')).toBe(false)
    expect(can(m('rep'), 'lead.assign', 'MX')).toBe(false)
    expect(can(m('supervisor'), 'account.reassign', 'MX')).toBe(true)
  })
  it('operaciones edita comercios, trabaja handoffs y lleva los negocios de su mercado; no crea negocios ni trabaja leads', () => {
    expect(can(m('ops'), 'account.edit', 'MX')).toBe(true)
    expect(can(m('ops'), 'activity.write', 'MX')).toBe(true)
    expect(can(m('ops'), 'deal.move', 'MX')).toBe(true)
    expect(can(m('ops'), 'deal.edit', 'MX')).toBe(true)
    expect(can(m('ops'), 'deal.move', 'US')).toBe(false)
    expect(can(m('ops'), 'deal.create', 'MX')).toBe(false)
    expect(can(m('ops'), 'lead.work', 'MX')).toBe(false)
  })
})

describe('formato (DATA-03, DATA-05)', () => {
  it('normaliza teléfonos a E.164 con el prefijo del mercado', () => {
    expect(toE164('55 1234 5678', '+52')).toBe('+525512345678')
    expect(toE164('(702) 555-0101', '+1')).toBe('+17025550101')
    expect(toE164('+52 55 1234 5678', '+1')).toBe('+525512345678')
    expect(toE164('525512345678', '+52')).toBe('+525512345678')
    expect(toE164('12', '+52')).toBeNull()
    expect(toE164('', '+52')).toBeNull()
    expect(toE164('abc', '+52')).toBeNull()
  })
  it('el dinero se guarda en unidades menores y se muestra con el código de su moneda', () => {
    expect(money(2500000, 'MXN', 'es')).toContain('25,000')
    expect(money(2500000, 'MXN', 'es')).toContain('MXN')
    expect(money(null, 'USD', 'en')).toBe('—')
    expect(pct(1, 4)).toBe('25%')
    expect(pct(0, 0)).toBe('—')
  })
})
