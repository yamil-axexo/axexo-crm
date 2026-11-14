// GOB-08: generador de datos de prueba por mercado. Reproducible: el mismo mercado, la misma semilla y el mismo volumen
// dan siempre los mismos comercios, con los mismos identificadores, la misma cadena y los mismos casos límite.
// No lee ni copia nada de producción. Nunca guarda una identificación fiscal completa: genera una con formato válido
// para probar la regla y guarda solo los últimos cuatro caracteres, igual que CONTIGO con un dato real.
import { createHash } from 'node:crypto'

/** PRNG determinista (mulberry32). */
export function rng(seedText) {
  let a = createHash('sha256').update(seedText).digest().readUInt32LE(0)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const digits = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('')
export const syntheticId = (market, seed, i) => {
  const h = createHash('md5').update(`synthetic:${market}:${seed}:${i}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ---------------------------------------------------------------- identificación fiscal sintética, con formato válido

const RFC_CHARS = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ'
/** Dígito verificador del RFC (módulo 11 sobre 12 posiciones; una persona moral se rellena con un espacio al inicio). */
export function rfcCheckDigit(base12) {
  const padded = base12.padStart(12, ' ')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += RFC_CHARS.indexOf(padded[i]) * (13 - i)
  const rest = sum % 11
  return rest === 0 ? '0' : rest === 1 ? 'A' : String(11 - rest)
}
/** RFC de persona moral: 3 letras, fecha AAMMDD, 2 de homoclave y dígito verificador. */
export function syntheticRfc(r) {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ'
  const name = Array.from({ length: 3 }, () => pick(r, [...letters])).join('')
  const date = `${String(70 + Math.floor(r() * 50) % 100).padStart(2, '0').slice(-2)}${String(1 + Math.floor(r() * 12)).padStart(2, '0')}${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
  const homo = Array.from({ length: 2 }, () => pick(r, [...'123456789ABCDEFGHIJKLMNPQRSTUVWXYZ'])).join('')
  const base = `${name}${date}${homo}`
  return `${base}${rfcCheckDigit(base)}`
}
/** EIN de Estados Unidos: 9 dígitos con un prefijo de los que sí se asignan. */
export function syntheticEin(r) {
  const prefixes = ['10', '12', '20', '27', '30', '32', '35', '36', '37', '38', '45', '46', '47', '61', '81', '82', '83', '84', '85', '86', '87', '88', '92', '93', '98', '99']
  return `${pick(r, prefixes)}${digits(r, 7)}`
}
/** NIT de El Salvador: 14 dígitos; el último es verificador (módulo 11 con pesos descendentes). */
export function syntheticNit(r) {
  const base = `0614${String(1 + Math.floor(r() * 28)).padStart(2, '0')}${String(1 + Math.floor(r() * 12)).padStart(2, '0')}${String(70 + Math.floor(r() * 29))}${String(101 + Math.floor(r() * 800))}`
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(base[i]) * (14 - i)
  const check = (11 - (sum % 11)) % 11
  return `${base}${check === 10 ? 0 : check}`
}
export const taxIdFor = (market, r) => (market === 'MX' ? syntheticRfc(r) : market === 'US' ? syntheticEin(r) : syntheticNit(r))

// ---------------------------------------------------------------- perfiles por mercado

export const MARKETS = {
  MX: {
    currency: 'MXN', phone: (r) => `+5255${digits(r, 8)}`,
    places: [['Ciudad de México', 'CDMX', 19.43, -99.13], ['Guadalajara', 'Jalisco', 20.67, -103.35], ['Monterrey', 'Nuevo León', 25.68, -100.31], ['Puebla', 'Puebla', 19.04, -98.2], ['Mérida', 'Yucatán', 20.97, -89.62]],
    store: ['Abarrotes', 'Miscelánea', 'Tienda', 'Súper', 'Papelería', 'Farmacia'], word: ['La Esperanza', 'El Sol', 'San Judas', 'Los Ángeles', 'El Milagro', 'La Estrella', 'El Porvenir', 'Santa Fe', 'La Esquina', 'El Triunfo', 'Tres Hermanos', 'El Mirador', 'La Peña', 'Doña Toña'],
    group: ['Grupo', 'Distribuidora', 'Comercializadora', 'Mayoreo'],
  },
  US: {
    currency: 'USD', phone: (r) => `+1702555${digits(r, 4)}`,
    places: [['Las Vegas', 'NV', 36.17, -115.14], ['Baltimore', 'MD', 39.29, -76.61], ['Miami', 'FL', 25.76, -80.19], ['Houston', 'TX', 29.76, -95.37]],
    store: ['Wireless', 'Cellular', 'Mobile', 'Prepaid', 'Phones & More'], word: ['Desert', 'Sunrise', 'Liberty', 'Harbor', 'Capitol', 'Bayside', 'Canyon', 'Palm', 'Silver State', 'Coral Way', 'Calle Ocho', 'Eastern Ave'],
    group: ['Group', 'Partners', 'Holdings', 'Distribution'],
  },
  SV: {
    currency: 'USD', phone: (r) => `+5037${digits(r, 7)}`,
    places: [['San Salvador', 'San Salvador', 13.69, -89.22], ['Santa Ana', 'Santa Ana', 13.99, -89.56], ['San Miguel', 'San Miguel', 13.48, -88.18]],
    store: ['Tienda', 'Pulpería', 'Súper', 'Farmacia', 'Librería'], word: ['La Bendición', 'El Salvador del Mundo', 'San José', 'La Ceiba', 'El Carmen', 'Los Planes', 'La Unión', 'El Ángel', 'Doña Mary'],
    group: ['Grupo', 'Distribuidora', 'Comercial'],
  },
}

const LIFECYCLES = ['prospect', 'prospect', 'onboarding', 'active', 'active', 'active', 'active', 'at_risk', 'inactive', 'churned']

/**
 * Arma el plan de comercios (sin tocar la base): niveles, cadena, dueño, lugar, teléfono, identificación y casos límite.
 * `owners` son las personas que venden en el mercado (pueden ser cero: entonces todo queda sin asignar).
 */
export function plan({ market, seed = 1, accounts = 200, depth = 4, edgeCases = true, owners = [] }) {
  const profile = MARKETS[market]
  if (!profile) throw new Error(`synthetic: market ${market} has no profile (MX, US, SV)`)
  if (!Number.isInteger(accounts) || accounts < 1 || accounts > 200000) throw new Error('synthetic: accounts must be between 1 and 200000')
  if (!Number.isInteger(depth) || depth < 1 || depth > 8) throw new Error('synthetic: depth must be between 1 and 8')
  const r = rng(`${market}:${seed}`)
  const rows = []
  // Los niveles de arriba son pocos; el último nivel se lleva casi todo. Una de cada tres tiendas no tiene cadena.
  const upper = depth <= 1 ? [] : Array.from({ length: depth - 1 }, (_, l) => Math.max(1, Math.round(accounts * 0.012 * (l + 1))))
  while (upper.reduce((a, b) => a + b, 0) > accounts * 0.4 && upper.some((n) => n > 1)) for (let i = 0; i < upper.length; i++) upper[i] = Math.max(1, Math.floor(upper[i] / 2))
  const byLevel = []
  let i = 0
  const make = (level, parent, kind) => {
    const [locality, region, lat, lng] = pick(r, profile.places)
    const n = i++
    const taxId = taxIdFor(market, r)
    const row = {
      i: n, id: syntheticId(market, seed, n), level, parent_id: parent?.id ?? null, kind,
      name: kind === 'store' ? `${pick(r, profile.store)} ${pick(r, profile.word)} ${n + 1}` : `${pick(r, profile.group)} ${pick(r, profile.word)} ${n + 1}`,
      lifecycle: kind === 'store' ? pick(r, LIFECYCLES) : pick(r, ['prospect', 'onboarding', 'active', 'active']),
      owner_id: owners.length && r() > 0.08 ? owners[n % owners.length] : null,
      phone: profile.phone(r), locality, region,
      latitude: Number((lat + (r() - 0.5) * 0.3).toFixed(6)), longitude: Number((lng + (r() - 0.5) * 0.3).toFixed(6)),
      tax_id_last4: taxId.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, '0'), age_days: 1 + Math.floor(r() * 400), edge: null,
    }
    rows.push(row)
    ;(byLevel[level] ??= []).push(row)
    return row
  }
  const kindAt = (level) => (level === depth ? 'store' : level === 1 ? 'organization' : level === 2 && depth > 3 ? 'distributor' : 'chain')
  for (let level = 1; level < depth; level++) {
    for (let k = 0; k < upper[level - 1] && i < accounts - 1; k++) make(level, level === 1 ? null : pick(r, byLevel[level - 1]), kindAt(level))
  }
  while (i < accounts) {
    const chained = depth > 1 && byLevel[depth - 1]?.length && r() > 0.33
    make(chained ? depth : 1, chained ? pick(r, byLevel[depth - 1]) : null, 'store')
  }
  if (edgeCases) {
    // Casos límite, sobre las últimas tiendas del plan: cada uno prueba una regla o una pantalla que suele romperse.
    const stores = rows.filter((x) => x.kind === 'store')
    const cases = [
      ['long_name', (x) => { x.name = `${x.name} ${'Sucursal Centro Histórico y Anexas '.repeat(3)}`.slice(0, 118).trim() }],
      ['accents', (x) => { x.name = `Ñandú & Hijos “El Güero” ${x.i + 1}` }],
      ['no_phone', (x) => { x.phone = null }],
      ['no_owner', (x) => { x.owner_id = null }],
      ['no_place', (x) => { x.locality = null; x.region = null; x.latitude = null; x.longitude = null }],
      ['churned_old', (x) => { x.lifecycle = 'churned'; x.age_days = 900 }],
      ['created_today', (x) => { x.age_days = 0; x.lifecycle = 'prospect' }],
      ['same_name_a', (x) => { x.name = 'Tienda Gemela (caso límite)' }],
      ['same_name_b', (x) => { x.name = 'Tienda Gemela (caso límite)' }],
      ['no_tax_id', (x) => { x.tax_id_last4 = null }],
    ]
    cases.slice(0, stores.length).forEach(([edge, apply], k) => {
      const x = stores[stores.length - 1 - k]
      apply(x)
      x.edge = edge
    })
  }
  return rows
}

/**
 * Corre el generador contra una base (conexión del dueño del esquema, nunca la de la app). Idempotente: volver a correr
 * la misma semilla no duplica nada. Deja la corrida en crm.synthetic_runs y marca cada comercio en crm.synthetic_accounts.
 */
export async function generate(sql, { market, seed = 1, accounts = 200, depth = 4, edgeCases = true, runBy = 'scripts/synthetic.mjs', appEnv = process.env.APP_ENV }) {
  if (appEnv === 'production') throw new Error('synthetic: the generator never runs in production')
  return sql.begin(async (tx) => {
    const mk = (await tx`select code, currency from crm.markets where code = ${market}`)[0]
    if (!mk) throw new Error(`synthetic: market ${market} does not exist in this database`)
    const owners = (await tx`
      select distinct m.user_id from crm.memberships m join crm.users u on u.id = m.user_id
       where m.market_code = ${market} and m.role in ('rep', 'supervisor') and u.is_active and u.is_synthetic
         and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) order by 1`).map((x) => x.user_id)
    const rows = plan({ market, seed, accounts, depth, edgeCases, owners })
    const run = (await tx`insert into crm.synthetic_runs (market_code, seed, accounts, depth, edge_cases, run_by) values (${market}, ${seed}, ${accounts}, ${depth}, ${edgeCases}, ${runBy}) returning id`)[0]
    let created = 0
    const levels = [...new Set(rows.map((x) => x.level))].sort((a, b) => a - b)
    // Por nivel, de arriba hacia abajo: el disparador de la cadena necesita que el padre ya exista.
    for (const level of levels) {
      const batch = rows.filter((x) => x.level === level)
      for (let k = 0; k < batch.length; k += 500) {
        const chunk = batch.slice(k, k + 500).map((x) => ({
          id: x.id, market_code: market, parent_id: x.parent_id, kind: x.kind, name: x.name, lifecycle: x.lifecycle, owner_id: x.owner_id, phone: x.phone,
          locality: x.locality, region: x.region, country: market, latitude: x.latitude, longitude: x.longitude, tax_id_last4: x.tax_id_last4,
          created_at: new Date(Date.now() - x.age_days * 86400000), lifecycle_at: new Date(Date.now() - Math.floor(x.age_days / 2) * 86400000),
        }))
        const done = await tx`insert into crm.accounts ${tx(chunk)} on conflict (id) do nothing returning id`
        created += done.length
        if (done.length) await tx`insert into crm.synthetic_accounts ${tx(done.map((d) => ({ account_id: d.id, run_id: run.id })))} on conflict do nothing`
      }
    }
    // Eventos: ventas de los últimos 7 días para las tiendas activas (el mismo formato que el archivo diario de ventas).
    const r = rng(`${market}:${seed}:metrics`)
    const active = rows.filter((x) => x.kind === 'store' && x.lifecycle === 'active')
    let metrics = 0
    for (let k = 0; k < active.length; k += 500) {
      const chunk = active.slice(k, k + 500).flatMap((x) => {
        const base = 5 + Math.floor(r() * 120)
        return Array.from({ length: 7 }, (_, d) => ({
          account_id: x.id, as_of: new Date(Date.now() - (d + 1) * 86400000), market_code: market, txn_count_30d: base + d, volume_minor_30d: (base + d) * (2000 + Math.floor(r() * 9000)),
          currency: mk.currency, active_days_30d: Math.min(30, 3 + Math.floor(r() * 27)), first_txn_at: new Date(Date.now() - x.age_days * 43200000), last_txn_at: new Date(Date.now() - (d + 1) * 86400000),
        }))
      })
      if (chunk.length) metrics += (await tx`insert into crm.merchant_metrics_daily ${tx(chunk)} on conflict (account_id, as_of) do nothing returning account_id`).length
    }
    const summary = { accounts: created, metrics, max_depth: Math.max(...rows.map((x) => x.level)), edge_cases: rows.filter((x) => x.edge).length, unowned: rows.filter((x) => !x.owner_id).length }
    // Una corrida repetida que no creó nada no deja registro: el registro dice qué se agregó, no cuántas veces se intentó.
    if (created === 0 && metrics === 0) {
      await tx`delete from crm.synthetic_runs where id = ${run.id}`
      return { runId: null, ...summary }
    }
    await tx`update crm.synthetic_runs set created = ${tx.json(summary)} where id = ${run.id}`
    return { runId: run.id, ...summary }
  })
}
