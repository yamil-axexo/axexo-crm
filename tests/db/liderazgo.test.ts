import { describe, it, expect } from 'vitest'
import { asPersona, ctxFor, owner, personaId } from './helpers'
import { getAdoption, getClosedDeals, getFieldReport, getFxRates, getLeadershipPanel, getReportOptions, getWeeklyResults, marketPeriods, reportScope } from '@/dal/reports'
import { exportClosedDeals, exportFieldReport, setFxRate } from '@/domain/reports'
import { resolvePeriod, csvCell, weekStart } from '@/lib/periods'
import { METRICS } from '@/lib/metric-defs'
import { can, type Membership, type Role } from '@/domain/policy'
import { withUser } from '@/server/db'
import { reassignAccounts } from '@/domain/reparto'
import { getAccount } from '@/dal/accounts'
import { getSupervisorBoard } from '@/dal/boards'
import { getBoard } from '@/dal/pipelines'
import { listAccounts } from '@/dal/accounts'
import { homePath } from '@/domain/policy'

const year = (ctx: Awaited<ReturnType<typeof ctxFor>>) => marketPeriods(ctx, 'rango', '2026-01-01', '2026-12-31')
const lastExport = async () => {
  const db = owner()
  try {
    return (await db`select e.actor_id, e.market_code, e.after from crm.audit_events e where e.action = 'report.exported' order by e.at desc, e.id desc limit 1`)[0]
  } finally {
    await db.end()
  }
}

describe('periodos de los reportes', () => {
  it('semana, mes, mes pasado, trimestre y 30 días salen del hoy del mercado', () => {
    expect(resolvePeriod('semana', '2026-11-12')).toEqual({ key: 'semana', from: '2026-11-09', to: '2026-11-12' })
    expect(resolvePeriod('mes', '2026-11-12')).toEqual({ key: 'mes', from: '2026-11-01', to: '2026-11-12' })
    expect(resolvePeriod('mes-pasado', '2026-01-05')).toEqual({ key: 'mes-pasado', from: '2025-12-01', to: '2025-12-31' })
    expect(resolvePeriod('mes-pasado', '2026-03-31')).toEqual({ key: 'mes-pasado', from: '2026-02-01', to: '2026-02-28' })
    expect(resolvePeriod('trimestre', '2026-11-12')).toEqual({ key: 'trimestre', from: '2026-10-01', to: '2026-11-12' })
    expect(resolvePeriod('30d', '2026-11-12')).toEqual({ key: '30d', from: '2026-10-14', to: '2026-11-12' })
    expect(weekStart('2026-11-15')).toBe('2026-11-09') // el domingo pertenece a la semana que empezó el lunes
  })
  it('un rango invertido se voltea, uno inválido cae en el mes y ninguno pasa de un año', () => {
    expect(resolvePeriod('rango', '2026-11-12', '2026-11-10', '2026-11-01')).toEqual({ key: 'rango', from: '2026-11-01', to: '2026-11-10' })
    expect(resolvePeriod('rango', '2026-11-12', 'ayer', '2026-11-01').key).toBe('mes')
    expect(resolvePeriod('cualquiera', '2026-11-12').key).toBe('mes')
    expect(resolvePeriod('rango', '2026-11-12', '2020-01-01', '2026-11-01')).toEqual({ key: 'rango', from: '2020-01-01', to: '2020-12-31' })
  })
  it('una celda que empieza como fórmula sale como texto, y las comillas se doblan', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+52 55')).toBe("'+52 55")
    expect(csvCell('Tienda, la "buena"')).toBe('"Tienda, la ""buena"""')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(null)).toBe('')
  })
})

describe('permisos de reportes (report.view, report.export, adoption.read)', () => {
  const m = (role: Role, market: string | null = 'MX'): Membership[] => [{ role, market, teamId: null }]
  it('exportan leadership, quien lidera, supervisión y administración; ventas y operaciones no', () => {
    for (const role of ['admin', 'lt'] as Role[]) expect(can(m(role, null), 'report.export'), role).toBe(true)
    for (const role of ['market_lead', 'supervisor'] as Role[]) expect(can(m(role), 'report.export', 'MX'), role).toBe(true)
    for (const role of ['rep', 'ops'] as Role[]) expect(can(m(role), 'report.export', 'MX'), role).toBe(false)
    expect(can(m('market_lead', 'US'), 'report.export', 'MX')).toBe(false)
  })
  it('adopción la ven leadership, quien lidera y administración; supervisión no', () => {
    for (const role of ['admin', 'lt'] as Role[]) expect(can(m(role, null), 'adoption.read'), role).toBe(true)
    expect(can(m('market_lead'), 'adoption.read', 'MX')).toBe(true)
    for (const role of ['supervisor', 'rep', 'ops'] as Role[]) expect(can(m(role), 'adoption.read', 'MX'), role).toBe(false)
  })
  it('operaciones lee la bitácora y ve la cola de avisos de sus mercados', () => {
    expect(can(m('ops'), 'audit.read', 'MX')).toBe(true)
    expect(can(m('ops'), 'exception.read', 'MX')).toBe(true)
    expect(can(m('ops'), 'board.supervisor', 'MX')).toBe(false) // el tablero del equipo de ventas no es suyo
    expect(can(m('lt', null), 'exception.read')).toBe(true)
    expect(can(m('lt', null), 'exception.resolve')).toBe(false) // leadership los ve, no los descarta
    expect(can(m('rep'), 'exception.read', 'MX')).toBe(false)
    expect(can(m('ops', 'MX'), 'audit.read', 'US')).toBe(false)
    expect(can(m('ops'), 'rules.run', 'MX')).toBe(false)
  })
})

describe('negocios cerrados', () => {
  it('leadership ve los dos mercados; quien lidera México, solo México', async () => {
    const luis = await ctxFor('luis.tovar')
    const ana = await ctxFor('ana.robles')
    const all = await getClosedDeals(luis, year(luis), {})
    const mx = await getClosedDeals(ana, year(ana), {})
    expect(all.total).toBeGreaterThan(mx.total)
    expect(mx.total).toBeGreaterThan(0)
    expect(new Set(mx.rows.map((r) => r.market_code))).toEqual(new Set(['MX']))
    expect(new Set(mx.people.map((p) => p.market_code))).toEqual(new Set(['MX']))
    expect(all.won + all.lost).toBe(all.total)
    // un filtro de mercado fuera del alcance no abre nada
    expect((await getClosedDeals(ana, year(ana), { market: 'US' })).total).toBe(0)
  })
  it('supervisión ve solo lo de su equipo, y un vendedor no tiene alcance de reporte', async () => {
    const fer = await ctxFor('fernando.ibarra') // D2D Centro
    const team = new Set([await personaId('fernando.ibarra'), await personaId('marco.pena'), await personaId('lucia.vega')])
    const mine = await getClosedDeals(fer, year(fer), {}, 5000)
    expect(mine.total).toBeGreaterThan(0)
    expect(mine.people.every((p) => p.owner_id !== null && team.has(p.owner_id))).toBe(true)
    const ana = await ctxFor('ana.robles')
    expect((await getClosedDeals(ana, year(ana), {})).total).toBeGreaterThan(mine.total)
    const marco = await ctxFor('marco.pena')
    expect(reportScope(marco)).toEqual({ full: [], team: [] })
    expect((await getClosedDeals(marco, year(marco), {})).total).toBe(0)
  })
  it('filtra por resultado, persona, equipo y embudo, y los totales cuadran con las filas', async () => {
    const ana = await ctxFor('ana.robles')
    const p = year(ana)
    const all = await getClosedDeals(ana, p, {}, 5000)
    const won = await getClosedDeals(ana, p, { result: 'won' }, 5000)
    const lost = await getClosedDeals(ana, p, { result: 'lost' }, 5000)
    expect(won.total).toBe(all.won)
    expect(lost.total).toBe(all.lost)
    expect(won.rows.every((r) => r.status === 'won' && r.reason_es === null)).toBe(true)
    expect(lost.rows.every((r) => r.status === 'lost' && !!r.reason_es)).toBe(true)
    const marco = await personaId('marco.pena')
    const byMarco = await getClosedDeals(ana, p, { owner: marco }, 5000)
    expect(byMarco.total).toBeGreaterThan(0)
    expect(byMarco.people).toHaveLength(1)
    expect(byMarco.people[0]!.team_name).toBe('D2D Centro')
    const o = await getReportOptions(ana)
    const d2d = o.teams.find((t) => t.name === 'D2D Centro')!
    const b2b = o.teams.find((t) => t.name === 'B2B México')!
    const byD2d = await getClosedDeals(ana, p, { team: d2d.id }, 5000)
    const byB2b = await getClosedDeals(ana, p, { team: b2b.id }, 5000)
    const noTeam = await getClosedDeals(ana, p, { team: 'none' }, 5000)
    expect(byD2d.total + byB2b.total + noTeam.total).toBe(all.total)
    expect(byD2d.rows.every((r) => r.team_name === 'D2D Centro')).toBe(true)
    const pipes = o.pipelines.map((x) => x.id)
    let sum = 0
    for (const id of pipes) sum += (await getClosedDeals(ana, p, { pipeline: id }, 5000)).total
    expect(sum).toBe(all.total)
  })
  it('el periodo corta por fecha de cierre en la zona del mercado', async () => {
    const ana = await ctxFor('ana.robles')
    const month = await getClosedDeals(ana, marketPeriods(ana, 'rango', '2026-10-01', '2026-10-31'), {}, 5000)
    expect(month.rows.every((r) => r.closed_on >= '2026-10-01' && r.closed_on <= '2026-10-31')).toBe(true)
    const none = await getClosedDeals(ana, marketPeriods(ana, 'rango', '2019-01-01', '2019-01-31'), {})
    expect(none.total).toBe(0)
    // 23:30 del 31 de octubre en Ciudad de México ya es 1 de noviembre en UTC: cuenta en octubre.
    const marco = await personaId('marco.pena')
    const moved = await asPersona('nora.salas', async (tx) => {
      const [d] = await tx<{ id: string }[]>`select id from crm.deals where market_code = 'MX' and status = 'won' and owner_id = ${marco} limit 1`
      await tx`update crm.deals set won_at = '2026-11-01T05:30:00Z' where id = ${d!.id}`
      const rows = await tx<{ closed_on: string }[]>`select ((d.won_at at time zone mk.timezone)::date)::text as closed_on from crm.deals d join crm.markets mk on mk.code = d.market_code where d.id = ${d!.id}`
      return rows[0]!.closed_on
    })
    expect(moved).toBe('2026-10-31')
  })
})

describe('exportar negocios cerrados', () => {
  it('trae solo las columnas de la tabla y deja el evento con filtros y filas', async () => {
    const ana = await ctxFor('ana.robles')
    const p = marketPeriods(ana, 'rango', '2026-10-01', '2026-11-30')
    const out = await exportClosedDeals(ana, p, { result: 'lost' })
    const lines = out.csv.replace(/^﻿/, '').trimEnd().split('\r\n')
    expect(lines[0]).toBe('Comercio,Negocio,Mercado,Embudo,Equipo,Quién,Resultado,Fecha de cierre,Monto,Moneda,Motivo de pérdida,Cómo se ganó,Quién lo marcó')
    expect(lines.length - 1).toBe(out.rows)
    expect(out.rows).toBeGreaterThan(0)
    expect(out.csv).not.toMatch(/@|\+52|\+1\d{10}/) // ni correos ni teléfonos
    expect(lines.slice(1).every((l) => l.includes(',Perdido,'))).toBe(true)
    expect(out.fileName).toBe('contigo-negocios-cerrados-2026-10-01-a-2026-11-30.csv')
    const ev = await lastExport()
    expect(ev!.actor_id).toBe(await personaId('ana.robles'))
    expect(ev!.market_code).toBe('MX')
    expect(ev!.after).toMatchObject({ report: 'closed_deals', rows: out.rows, truncated: false, filters: { period: 'rango', from: '2026-10-01', to: '2026-11-30', result: 'lost', owner: null } })
  })
  it('leadership exporta aunque sea solo lectura; ventas y operaciones no, ni quien lidera otro mercado', async () => {
    const luis = await ctxFor('luis.tovar')
    const out = await exportClosedDeals(luis, year(luis), { market: 'US' })
    expect(out.rows).toBeGreaterThan(0)
    expect((await lastExport())!.after).toMatchObject({ rows: out.rows, filters: { market: 'US' } })
    for (const k of ['marco.pena', 'valeria.soto']) {
      const c = await ctxFor(k)
      await expect(exportClosedDeals(c, year(c), {})).rejects.toMatchObject({ code: 'forbidden' })
    }
    const ana = await ctxFor('ana.robles')
    await expect(exportClosedDeals(ana, year(ana), { market: 'US' })).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('supervisión exporta solo lo de su equipo', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const seen = await getClosedDeals(fer, year(fer), {}, 5000)
    const out = await exportClosedDeals(fer, year(fer), {})
    expect(out.rows).toBe(seen.total)
    expect(out.csv).not.toContain('B2B México')
    expect(out.csv).not.toContain('Dealer onboarding')
  })
  it('un texto con número de tarjeta no sale en el archivo', async () => {
    const db = owner()
    const nora = await ctxFor('nora.salas')
    const [d] = await db<{ id: string; title: string }[]>`select id, title from crm.deals where market_code = 'US' and status = 'won' order by won_at desc limit 1`
    try {
      const card = ['4111', '1111', '1111', '1111'].join(' ')
      await db`update crm.deals set title = ${`Pago ${card}`} where id = ${d!.id}`
      const out = await exportClosedDeals(nora, year(nora), { market: 'US' })
      expect(out.csv).not.toContain(card)
      expect(out.csv).toContain('Pago ')
    } finally {
      await db`update crm.deals set title = ${d!.title} where id = ${d!.id}`
      await db.end()
    }
  })
})

describe('tasa de cambio', () => {
  it('solo administración la carga; queda en la bitácora y con quién la cargó', async () => {
    const nora = await ctxFor('nora.salas')
    for (const k of ['luis.tovar', 'ana.robles', 'marco.pena']) {
      await expect(setFxRate(await ctxFor(k), { currency: 'MXN', asOf: '2026-11-10', rate: '0.054', source: 'Prueba' })).rejects.toMatchObject({ code: 'forbidden' })
    }
    await expect(setFxRate(nora, { currency: 'USD', asOf: '2026-11-10', rate: '1', source: 'Prueba' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setFxRate(nora, { currency: 'MXN', asOf: '2026-11-10', rate: '0', source: 'Prueba' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setFxRate(nora, { currency: 'MXN', asOf: '2026-11-10', rate: '0.05', source: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setFxRate(nora, { currency: 'MXN', asOf: '2999-01-01', rate: '0.05', source: 'Prueba' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setFxRate(nora, { currency: 'EUR', asOf: '2026-11-10', rate: '1.1', source: 'Prueba' })).rejects.toMatchObject({ code: 'invalid' })
    const db = owner()
    try {
      const before = (await getFxRates(nora)).find((r) => r.currency === 'MXN')!
      expect(before.source).toBe('synthetic') // el valor del seed es de ejemplo y lo dice
      await db`delete from crm.fx_rates where currency = 'MXN' and as_of = '2000-01-01'`
      await setFxRate(nora, { currency: 'mxn', asOf: '2000-01-01', rate: '0.1', source: 'Prueba de carga' })
      await setFxRate(nora, { currency: 'MXN', asOf: '2000-01-01', rate: '0.11', source: 'Prueba de carga, corregida' })
      const [row] = await db`select usd_rate::float8 as rate, source, loaded_by from crm.fx_rates where currency = 'MXN' and as_of = '2000-01-01'`
      expect(row).toMatchObject({ rate: 0.11, source: 'Prueba de carga, corregida', loaded_by: await personaId('nora.salas') })
      const [ev] = await db`select before, after from crm.audit_events where action = 'fx.rate_set' order by at desc, id desc limit 1`
      expect(ev!.before).toMatchObject({ usd_rate: 0.1 })
      expect(ev!.after).toMatchObject({ currency: 'MXN', as_of: '2000-01-01', usd_rate: 0.11 })
      // la vigente sigue siendo la de fecha más reciente, no la última que se cargó
      expect((await getFxRates(nora)).find((r) => r.currency === 'MXN')!.as_of).toBe(before.as_of)
    } finally {
      await db`delete from crm.fx_rates where currency = 'MXN' and as_of = '2000-01-01'`
      await db.end()
    }
  })
})

describe('panel del LT', () => {
  it('desglosa por mercado, por embudo y por equipo, y las partes suman el total', async () => {
    const luis = await ctxFor('luis.tovar')
    const p = marketPeriods(luis, 'rango', '2026-01-01', '2026-12-31')
    const d = await getLeadershipPanel(luis, p)
    expect(d.markets.map((m) => m.code)).toEqual(['MX', 'US'])
    for (const mk of d.markets) {
      const pipes = d.pipelines.filter((x) => x.market_code === mk.code)
      const teams = d.teams.filter((x) => x.market_code === mk.code)
      for (const k of ['won', 'lost', 'deals_open', 'awaiting_txn'] as const) {
        expect(pipes.reduce((n, x) => n + x[k], 0), `${mk.code} embudos ${k}`).toBe(mk[k])
        expect(teams.reduce((n, x) => n + x[k], 0), `${mk.code} equipos ${k}`).toBe(mk[k])
      }
      expect(teams.reduce((n, x) => n + x.leads, 0)).toBe(mk.leads)
    }
    // D2D y B2B van en líneas separadas
    // (otras pruebas de la corrida pueden dejar más embudos en México, por ejemplo los importados de Pipedrive: se miran los del seed)
    const mx = d.pipelines.filter((x) => x.market_code === 'MX' && ['Alta de tiendas (D2D)', 'Cadenas y distribuidores'].includes(x.name)).map((x) => x.motor)
    expect(mx).toEqual(['d2d', 'b2b'])
    expect(d.teams.filter((x) => x.market_code === 'MX').map((x) => x.name)).toEqual(expect.arrayContaining(['D2D Centro', 'B2B México']))
    const closed = await getClosedDeals(luis, p, {}, 1)
    expect(d.markets.reduce((n, x) => n + x.won, 0)).toBe(closed.won) // el clic al detalle abre la misma cuenta
    expect(d.markets.reduce((n, x) => n + x.lost, 0)).toBe(closed.lost)
  })
  it('quien lidera México no recibe US, y el periodo cambia las cifras del periodo pero no la foto de hoy', async () => {
    const ana = await ctxFor('ana.robles')
    const wide = await getLeadershipPanel(ana, marketPeriods(ana, 'rango', '2026-01-01', '2026-12-31'))
    const narrow = await getLeadershipPanel(ana, marketPeriods(ana, 'rango', '2019-01-01', '2019-01-31'))
    expect(wide.markets.map((m) => m.code)).toEqual(['MX'])
    expect(narrow.markets[0]!.won).toBe(0)
    expect(narrow.markets[0]!.leads).toBe(0)
    expect(wide.markets[0]!.won).toBeGreaterThan(0)
    expect(narrow.markets[0]!.deals_open).toBe(wide.markets[0]!.deals_open)
    expect(narrow.markets[0]!.accounts_active).toBe(wide.markets[0]!.accounts_active)
    expect(narrow.markets[0]!.volume_30d).toBe(wide.markets[0]!.volume_30d)
  })
  it('cada cifra tiene su definición en los dos idiomas, y los porcentajes dicen numerador y denominador', () => {
    for (const [k, d] of Object.entries(METRICS) as [string, { label: string[]; what: string[]; window: string[]; source: string[]; num?: string[]; den?: string[] }][]) {
      for (const pair of [d.label, d.what, d.window, d.source]) expect(pair.every((s) => s.length > 2), k).toBe(true)
      expect(JSON.stringify(d), k).not.toMatch(/[—–]/)
    }
    expect(METRICS.attempt.num && METRICS.attempt.den && METRICS.reached.num && METRICS.reached.den).toBeTruthy()
  })
})

describe('adopción', () => {
  it('cuenta ingresos y actividades por persona, y solo dentro del alcance de quien mira', async () => {
    const db = owner()
    const marco = await personaId('marco.pena')
    const sam = await personaId('sam.ortiz')
    const p = { key: 'rango' as const, from: '2031-03-01', to: '2031-03-31' }
    try {
      await db`insert into crm.audit_events (at, actor_id, action, object, object_id, after) values
        ('2031-03-10T15:00:00Z', ${marco}, 'session.started', 'session', ${marco}, '{"kind":"persona"}'),
        ('2031-03-12T15:00:00Z', ${marco}, 'session.started', 'session', ${marco}, '{"kind":"persona"}'),
        ('2031-04-02T15:00:00Z', ${marco}, 'session.started', 'session', ${marco}, '{"kind":"persona"}'),
        ('2031-03-11T15:00:00Z', ${sam}, 'session.started', 'session', ${sam}, '{"kind":"persona"}')`
      const luis = await getAdoption(await ctxFor('luis.tovar'), p, 'America/Mexico_City')
      const m = luis.find((r) => r.user_id === marco)!
      expect(m).toMatchObject({ logins: 2, markets: ['MX'], teams: ['D2D Centro'], roles: ['rep'] })
      expect(m.last_login?.toISOString()).toBe('2031-04-02T15:00:00.000Z') // el último ingreso no depende del periodo
      expect(luis.find((r) => r.user_id === sam)!.logins).toBe(1)
      expect(luis.some((r) => r.full_name.includes('sistema') || r.full_name.includes('system'))).toBe(false)
      const ana = await getAdoption(await ctxFor('ana.robles'), p, 'America/Mexico_City')
      expect(ana.find((r) => r.user_id === marco)!.logins).toBe(2)
      expect(ana.some((r) => r.user_id === sam)).toBe(false) // otro mercado
      expect(ana.every((r) => r.markets.includes('MX'))).toBe(true)
      for (const k of ['fernando.ibarra', 'marco.pena', 'valeria.soto']) expect(await getAdoption(await ctxFor(k), p, 'UTC'), k).toEqual([])
    } finally {
      await db.end()
    }
  })
  it('la función de la base no sirve sin identidad ni entrega más columnas que conteos', async () => {
    const cols = await asPersona('luis.tovar', (tx) => tx`select * from app.adoption(now() - interval '30 days', now()) limit 1`)
    expect(Object.keys(cols[0]!).sort()).toEqual(['activities', 'full_name', 'last_login', 'logins', 'markets', 'roles', 'teams', 'user_id'])
    const none = await withUser('00000000-0000-0000-0000-000000000000', (tx) => tx`select * from app.adoption(now() - interval '30 days', now())`)
    expect(none).toHaveLength(0)
  })
})

describe('resultados por semana y reporte de campo', () => {
  it('entrega 8 semanas seguidas, de lunes en lunes, para supervisión y solo de su equipo', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const weeks = await getWeeklyResults(fer, {})
    expect(weeks).toHaveLength(8)
    for (let i = 0; i < 8; i++) expect(new Date(`${weeks[i]!.week}T12:00:00Z`).getUTCDay(), weeks[i]!.week).toBe(1)
    for (let i = 1; i < 8; i++) expect(Date.parse(weeks[i - 1]!.week) - Date.parse(weeks[i]!.week)).toBe(7 * 86400000)
    const ana = await ctxFor('ana.robles')
    const all = await getWeeklyResults(ana, {})
    const sum = (rows: typeof weeks, k: 'won' | 'visits') => rows.reduce((n, r) => n + r[k], 0)
    expect(sum(all, 'won')).toBeGreaterThanOrEqual(sum(weeks, 'won'))
    expect(sum(all, 'visits')).toBeGreaterThanOrEqual(sum(weeks, 'visits'))
    expect(sum(weeks, 'visits')).toBeGreaterThan(0)
    expect((await getWeeklyResults(await ctxFor('marco.pena'), {})).every((w) => w.won + w.lost + w.visits + w.stores === 0)).toBe(true)
  })
  it('el reporte de campo cuenta altas y ganados por semana y territorio, y visitas por persona', async () => {
    const ana = await ctxFor('ana.robles')
    const r = await getFieldReport(ana, {})
    expect(r.weeks).toHaveLength(8)
    expect(r.places.length).toBeGreaterThan(0)
    expect(r.places.every((x) => x.market_code === 'MX' && r.weeks.includes(x.week))).toBe(true)
    expect(r.visits.length).toBeGreaterThan(0)
    expect(r.visits.every((x) => x.sales <= x.visits)).toBe(true)
    const weekly = await getWeeklyResults(ana, {})
    for (const w of r.weeks) {
      expect(r.places.filter((x) => x.week === w).reduce((n, x) => n + x.won, 0), w).toBe(weekly.find((x) => x.week === w)!.won)
      expect(r.places.filter((x) => x.week === w).reduce((n, x) => n + x.stores, 0), w).toBe(weekly.find((x) => x.week === w)!.stores)
      expect(r.visits.filter((x) => x.week === w).reduce((n, x) => n + x.visits, 0), w).toBe(weekly.find((x) => x.week === w)!.visits)
    }
    const byCity = await getFieldReport(ana, { by: 'plaza' })
    expect(byCity.places.reduce((n, x) => n + x.won, 0)).toBe(r.places.reduce((n, x) => n + x.won, 0))
  })
  it('exportar el reporte de campo deja evento y respeta el permiso', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const out = await exportFieldReport(fer, {}, 'visitas')
    expect(out.csv.replace(/^﻿/, '').split('\r\n')[0]).toBe('Semana (lunes),Mercado,Equipo,Persona,Quién visitó,Visitas,Visitas con venta')
    expect((await lastExport())!.after).toMatchObject({ report: 'field_visits', rows: out.rows, filters: { weeks: 8 } })
    const stores = await exportFieldReport(fer, { by: 'plaza' }, 'comercios')
    expect(stores.csv).toContain('Plaza')
    expect((await lastExport())!.after).toMatchObject({ report: 'field_stores', filters: { by: 'plaza' } })
    await expect(exportFieldReport(await ctxFor('marco.pena'), {}, 'visitas')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('el hilo del comercio y Mi equipo', () => {
  it('un cambio de dueño dice a quién pasó, de quién venía y quién lo reasignó', async () => {
    const db = owner()
    const ana = await ctxFor('ana.robles')
    const marco = await personaId('marco.pena')
    const lucia = await personaId('lucia.vega')
    try {
      const [a] = await db<{ id: string }[]>`
        select a.id from crm.accounts a where a.owner_id = ${marco} and a.kind = 'store' and a.archived_at is null
           and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open') order by a.id limit 1`
      await reassignAccounts(ana, [a!.id], lucia)
      const acc = await getAccount(ana, a!.id)
      const change = acc!.timeline.find((x) => x.kind === 'attribution')!
      expect(change.title).toBe('Lucía Vega')
      expect(change.actor).toBe('Ana Robles')
      expect((change.meta as { from?: string }).from).toBe('Marco Peña')
      await reassignAccounts(ana, [a!.id], marco) // queda como estaba
      const back = (await getAccount(ana, a!.id))!.timeline.filter((x) => x.kind === 'attribution')
      expect(back[0]!.title).toBe('Marco Peña')
      expect((back[0]!.meta as { from?: string }).from).toBe('Lucía Vega')
    } finally {
      await db.end()
    }
  })
  it('Mi equipo trae a todos los que venden, con equipo, y a quien no tiene equipo en su propio grupo', async () => {
    const ana = await ctxFor('ana.robles')
    const board = await getSupervisorBoard(ana, {})
    // Las cuatro personas de ventas del seed, cada una con su equipo. Otra prueba de la corrida (la importación de Pipedrive)
    // puede haber dado acceso a más gente: no cambia lo que se comprueba aquí.
    const seed = ['Diana Cruz', 'Iván Ríos', 'Lucía Vega', 'Marco Peña']
    expect(board.reps.map((r) => r.full_name).filter((n) => seed.includes(n)).sort()).toEqual(seed)
    expect(new Set(board.reps.filter((r) => seed.includes(r.full_name)).map((r) => r.team))).toEqual(new Set(['D2D Centro', 'B2B México']))
    expect(board.metricsAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const marco = board.reps.find((r) => r.full_name === 'Marco Peña')!
    expect(marco.txn_30d).toBeGreaterThan(0)
    expect(marco.txn_prev_30d).toBeGreaterThan(0) // el seed trae el archivo de 30 días antes para una parte de su cartera
    expect(marco.txn_cmp_30d).toBeLessThanOrEqual(marco.txn_30d!)
    const d2d = (await getReportOptions(ana)).teams.find((t) => t.name === 'D2D Centro')!
    expect((await getSupervisorBoard(ana, { team: d2d.id })).reps.map((r) => r.full_name).sort()).toEqual(['Lucía Vega', 'Marco Peña'])
    expect((await getSupervisorBoard(ana, { team: 'none' })).reps.filter((r) => seed.includes(r.full_name))).toEqual([])
    // Una supervisora que lleva comercios propios y una persona de ventas sin equipo también aparecen.
    const db = owner()
    const paula = await personaId('paula.mendez')
    const ivan = await personaId('ivan.rios')
    const [acc] = await db<{ id: string }[]>`select id from crm.accounts where owner_id = ${ivan} order by id limit 1`
    try {
      await db`update crm.accounts set owner_id = ${paula} where id = ${acc!.id}`
      await db`update crm.memberships set team_id = null where user_id = ${ivan}`
      const b = await getSupervisorBoard(ana, {})
      expect(b.reps.find((r) => r.full_name === 'Paula Méndez')).toMatchObject({ role: 'supervisor', team: 'B2B México', accounts: 1 })
      expect(b.reps.find((r) => r.full_name === 'Iván Ríos')).toMatchObject({ team: null, team_id: null })
      expect((await getSupervisorBoard(ana, { team: 'none' })).reps.map((r) => r.full_name).filter((n) => seed.includes(n))).toEqual(['Iván Ríos'])
    } finally {
      await db`update crm.accounts set owner_id = ${ivan} where id = ${acc!.id}`
      await db`update crm.memberships set team_id = (select id from crm.teams where name = 'B2B México') where user_id = ${ivan}`
      await db.end()
    }
  })
  it('el tablero y Comercios filtran por equipo y por embudo', async () => {
    const ana = await ctxFor('ana.robles')
    const o = await getReportOptions(ana)
    const d2dPipe = o.pipelines.find((p) => p.motor === 'd2d')!
    const d2d = o.teams.find((t) => t.name === 'D2D Centro')!
    const b2b = o.teams.find((t) => t.name === 'B2B México')!
    const open = (b: NonNullable<Awaited<ReturnType<typeof getBoard>>>) => b.totals.reduce((n, x) => n + x.n, 0)
    const all = open((await getBoard(ana, d2dPipe.id, {}))!)
    const byD2d = open((await getBoard(ana, d2dPipe.id, { team: d2d.id }))!)
    const byB2b = open((await getBoard(ana, d2dPipe.id, { team: b2b.id }))!)
    const none = open((await getBoard(ana, d2dPipe.id, { team: 'none' }))!)
    expect(byD2d).toBeGreaterThan(0)
    expect(byD2d + byB2b + none).toBe(all)
    const noOwner = open((await getBoard(ana, d2dPipe.id, { owner: 'none' }))!)
    expect(noOwner).toBeLessThanOrEqual(none)
    const accounts = await listAccounts(ana, { team: b2b.id })
    // Los comercios cuyo dueño está hoy en el equipo B2B México: se cuenta en la base, porque otras pruebas de la misma corrida crean comercios para ese equipo.
    const expected = await withUser(ana.user.id, (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from crm.accounts a where a.archived_at is null and a.market_code = 'MX' and exists (
        select 1 from crm.memberships m where m.user_id = a.owner_id and m.market_code = a.market_code and m.team_id = ${b2b.id} and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))`)
    expect(expected[0]!.n).toBeGreaterThanOrEqual(6)
    expect(accounts.total).toBe(expected[0]!.n)
    const b2bPipe = o.pipelines.find((p) => p.motor === 'b2b')!
    const inPipe = await listAccounts(ana, { pipeline: b2bPipe.id })
    expect(inPipe.total).toBeGreaterThan(0)
    expect(inPipe.total).toBeLessThanOrEqual(accounts.total)
  })
  it('cada rol tiene su pantalla de entrada', () => {
    const m = (role: Role, market: string | null = 'MX'): Membership[] => [{ role, market, teamId: null }]
    expect(homePath(m('admin', null))).toBe('/admin')
    expect(homePath(m('lt', null))).toBe('/panel-lt')
    expect(homePath(m('market_lead'))).toBe('/supervisor')
    for (const role of ['supervisor', 'rep'] as Role[]) expect(homePath(m(role)), role).toBe('/hoy')
    // Operaciones entra a su cola (paquete operaciones); si además vende o supervisa, a Hoy.
    expect(homePath(m('ops'))).toBe('/operaciones')
    expect(homePath([...m('ops'), ...m('rep')])).toBe('/hoy')
    expect(homePath([...m('lt', null), ...m('admin', null)])).toBe('/admin')
  })
})
