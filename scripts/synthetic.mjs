// GOB-08: generador de datos de prueba por mercado.
// Uso: MIGRATION_DATABASE_URL=... node scripts/synthetic.mjs --market MX --accounts 500 --seed 42 --depth 4 [--no-edge-cases]
// Solo desarrollo, pruebas y staging. Nunca corre con APP_ENV=production. La misma semilla da siempre los mismos datos.
import postgres from 'postgres'
import { generate } from './synthetic-lib.mjs'

if (process.env.APP_ENV === 'production') {
  console.error('synthetic data is not allowed in production')
  process.exit(1)
}
const url = process.env.MIGRATION_DATABASE_URL
if (!url) {
  console.error('MIGRATION_DATABASE_URL is required')
  process.exit(1)
}
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const market = String(opt('market', '')).toUpperCase()
if (!/^[A-Z]{2}$/.test(market)) {
  console.error('usage: node scripts/synthetic.mjs --market MX|US|SV [--accounts 200] [--seed 1] [--depth 4] [--no-edge-cases]')
  process.exit(1)
}
const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
  const out = await generate(sql, {
    market, seed: Number(opt('seed', 1)), accounts: Number(opt('accounts', 200)), depth: Number(opt('depth', 4)), edgeCases: !args.includes('--no-edge-cases'),
    runBy: String(opt('by', process.env.USER ?? 'scripts/synthetic.mjs')).slice(0, 120),
  })
  console.log('synthetic', market, out)
} catch (e) {
  console.error(e instanceof Error ? e.message : 'synthetic: failed')
  process.exitCode = 1
} finally {
  await sql.end()
}
