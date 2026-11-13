import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, ctxFor, owner } from './helpers'
import { allProposed } from '@/dal/proposed'
import { CAPABILITIES, OPERATOR_CAPS } from '@/domain/policy'
import { EXCEPTION_KINDS } from '@/domain/rules'
import { JOBS } from '@/server/jobs/registry'

// Ola 6 de los 95, integración (datos2, embudo2, campo2, reportes2): lo que cruza paquetes. Un solo rol de Finanzas, un solo
// reloj hábil con zona horaria, una sola lista de valores propuestos con dueño, una sola lista de tipos de aviso y los jobs
// de los cuatro en el registro.
const admin = owner()
afterAll(async () => {
  await admin`delete from crm.decision_settings where key = 'ops.operator_rights' and market_code = 'MX' and note = 'integracion-95-6'`
  await admin`insert into crm.decision_settings (key, market_code, value, proposed, owner_label) values ('ops.operator_rights', 'MX', to_jsonb('off'::text), true, 'Martech') on conflict do nothing`
  await admin.end()
})
const one = async <T>(q: Promise<T[]>) => (await q)[0]!

describe('Finanzas: un solo rol (datos2 + reportes2)', () => {
  it('lee sus reportes y no hace trabajo comercial; la decisión por mercado le abre cambiar dueños, fusionar y editar en bloque', async () => {
    for (const cap of ['report.finance', 'report.reconcile', 'cost.read', 'visit.reimbursement', 'report.gallery'] as const) {
      expect(CAPABILITIES[cap] as readonly string[]).toContain('finance')
    }
    for (const cap of ['account.edit', 'activity.write', 'deal.edit'] as const) {
      if (cap in CAPABILITIES) expect(CAPABILITIES[cap as keyof typeof CAPABILITIES] as readonly string[]).not.toContain('finance')
    }
    for (const cap of OPERATOR_CAPS) expect(CAPABILITIES[cap] as readonly string[]).toContain('finance')

    // Apagado (valor propuesto conservador): ni la aplicación ni la base le dejan escribir.
    await admin`update crm.decision_settings set value = to_jsonb('off'::text) where key = 'ops.operator_rights' and market_code = 'MX'`
    let fin = await ctxFor('marta.ibanez')
    expect(fin.can('cost.read', 'MX')).toBe(true)
    for (const cap of OPERATOR_CAPS) expect(fin.can(cap, 'MX')).toBe(false)
    expect(await asPersona('marta.ibanez', (tx) => tx<{ w: string[] }[]>`select app.write_markets() as w`.then((r) => r[0]!.w))).not.toContain('MX')

    // Encendido en México: las tres acciones y la escritura en la base, solo en ese mercado.
    await admin`delete from crm.decision_settings where key = 'ops.operator_rights' and market_code = 'MX'`
    await admin`insert into crm.decision_settings (key, market_code, value, proposed, owner_label, note) values ('ops.operator_rights', 'MX', to_jsonb('on'::text), false, 'Martech', 'integracion-95-6')`
    fin = await ctxFor('marta.ibanez')
    for (const cap of OPERATOR_CAPS) expect(fin.can(cap, 'MX')).toBe(true)
    expect(fin.can('account.edit', 'MX')).toBe(false)
    expect(await asPersona('marta.ibanez', (tx) => tx<{ w: string[] }[]>`select app.write_markets() as w`.then((r) => r[0]!.w))).toEqual(['MX'])
    await admin`delete from crm.decision_settings where key = 'ops.operator_rights' and market_code = 'MX'`
  })
})

describe('un solo reloj hábil con zona horaria (datos2 MULTI-02 + embudo2 LEAD-04)', () => {
  it('app.business_due con zona usa la del lead o la del comercio, respeta feriados y una zona inválida cae a la del mercado', async () => {
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'app' and p.proname = 'business_due_tz'`)).n).toBe(0)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from information_schema.columns where table_schema = 'crm' and table_name = 'leads' and column_name = 'timezone'`)).n).toBe(1)
    const from = '2026-11-24 15:00:00+00' // martes 09:00 en Ciudad de México
    const r = await one(admin<{ mx: Date; tj: Date; bad: Date; three: Date }[]>`
      select app.business_due('MX', ${from}::timestamptz, 60, null::text) as mx, app.business_due('MX', ${from}::timestamptz, 60, 'America/Tijuana') as tj,
             app.business_due('MX', ${from}::timestamptz, 60, 'No/Existe') as bad, app.business_due('MX', ${from}::timestamptz, 60) as three`)
    expect(r.bad.getTime()).toBe(r.mx.getTime())
    expect(r.three.getTime()).toBe(r.mx.getTime())
    expect(r.tj.getTime()).not.toBe(r.mx.getTime())
    // Un feriado del mercado empuja el vencimiento al siguiente día hábil, también con zona.
    await admin`insert into crm.market_holidays (market_code, day, name) values ('MX', '2026-11-24', 'Feriado de prueba (integración)') on conflict do nothing`
    try {
      const h = await one(admin<{ tj: Date }[]>`select app.business_due('MX', ${from}::timestamptz, 60, 'America/Tijuana') as tj`)
      expect(h.tj.getTime()).toBeGreaterThan(r.tj.getTime() + 20 * 3600_000)
    } finally {
      await admin`delete from crm.market_holidays where market_code = 'MX' and day = '2026-11-24' and name = 'Feriado de prueba (integración)'`
    }
  })
})

describe('valores propuestos: una sola lista con dueño (datos2, embudo2, campo2, reportes2)', () => {
  it('Estado de CONTIGO junta las cuatro fuentes y cada fila tiene dueño y dónde se cambia', async () => {
    const rows = await allProposed(await ctxFor('nora.salas'))
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['decision', 'funnel', 'field', 'board']))
    for (const r of rows) {
      expect(r.owner.trim().length).toBeGreaterThan(1)
      expect(r.href).toMatch(/^\//)
    }
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
})

describe('tipos de aviso y jobs de la ola', () => {
  it('la base acepta todos los tipos de aviso de la aplicación (embudo2, campo2 y reportes2 cambiaron la misma restricción)', async () => {
    const def = (await one(admin<{ d: string }[]>`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'exceptions_kind_check'`)).d
    for (const k of [...EXCEPTION_KINDS, 'data_quality']) expect(def).toContain(`'${k}'`)
  })
  it('los jobs de embudo2, campo2 y reportes2 están en el registro, una vez cada uno', () => {
    const keys = JOBS.map((j) => j.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of ['embudo2.weekly_sales_summary', 'embudo2.activity_retention', 'campo2.statements', 'reportes2.team_snapshot', 'reportes2.quality_notices']) expect(keys).toContain(k)
  })
})
