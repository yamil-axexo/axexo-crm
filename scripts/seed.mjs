// Carga los datos sintéticos (GOB-08). Solo desarrollo y staging.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

if (process.env.APP_ENV === 'production') {
  console.error('seed is not allowed in production')
  process.exit(1)
}
const url = process.env.MIGRATION_DATABASE_URL
if (!url) {
  console.error('MIGRATION_DATABASE_URL is required')
  process.exit(1)
}
const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seed', 'seed.sql'), 'utf8')
const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
  await sql.begin(async (tx) => {
    // SEG-03: la carga de datos sintéticos queda en la bitácora de la base como una importación, no como SQL directo.
    await tx`select set_config('app.via', 'import', true)`
    await tx.unsafe(body)
  })
  const [c] = await sql`select (select count(*) from crm.accounts)::int as accounts, (select count(*) from crm.deals)::int as deals,
    (select count(*) from crm.leads)::int as leads, (select count(*) from crm.visits)::int as visits, (select count(*) from crm.activities)::int as activities`
  console.log('seeded', c)
} finally {
  await sql.end()
}
