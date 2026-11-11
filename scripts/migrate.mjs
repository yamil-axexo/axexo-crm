// Migraciones SQL versionadas (PORT-03). Uso: node scripts/migrate.mjs up|down|reset|status
// Se conecta con MIGRATION_DATABASE_URL (dueño del esquema), nunca con el rol de la aplicación.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
const url = process.env.MIGRATION_DATABASE_URL
if (!url) {
  console.error('MIGRATION_DATABASE_URL is required')
  process.exit(1)
}
const cmd = process.argv[2] ?? 'up'
const sql = postgres(url, { max: 1, onnotice: () => {} })

const names = () =>
  [...new Set(readdirSync(dir).filter((f) => f.endsWith('.up.sql')).map((f) => f.replace('.up.sql', '')))].sort()

async function ensure() {
  await sql`create schema if not exists app`
  await sql`create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now())`
}
async function applied() {
  return (await sql`select name from app.schema_migrations order by name`).map((r) => r.name)
}
async function up() {
  const done = new Set(await applied())
  for (const name of names()) {
    if (done.has(name)) continue
    const body = readFileSync(join(dir, `${name}.up.sql`), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into app.schema_migrations (name) values (${name})`
    })
    console.log(`up   ${name}`)
  }
}
async function down(all = false) {
  const done = (await applied()).reverse()
  for (const name of all ? done : done.slice(0, 1)) {
    const body = readFileSync(join(dir, `${name}.down.sql`), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`delete from app.schema_migrations where name = ${name}`
    })
    console.log(`down ${name}`)
  }
}

try {
  await ensure()
  if (cmd === 'up') await up()
  else if (cmd === 'down') await down()
  else if (cmd === 'reset') {
    // Solo desarrollo y pruebas: tira los dos esquemas y vuelve a aplicar todo.
    if (process.env.APP_ENV === 'production') throw new Error('reset is not allowed in production')
    await sql.unsafe('drop schema if exists crm cascade; drop schema if exists app cascade')
    await ensure()
    await up()
  } else if (cmd === 'status') console.log((await applied()).join('\n') || '(none)')
  else throw new Error(`unknown command ${cmd}`)
} finally {
  await sql.end()
}
