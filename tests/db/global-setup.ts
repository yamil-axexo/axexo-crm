import { execSync } from 'node:child_process'
import postgres from 'postgres'

// Las pruebas de permisos y de dominio corren contra un Postgres real, con migraciones y datos sintéticos recién cargados.
// La base se migra y se siembra una vez por corrida; queda una copia intacta (`<base>_tpl`) de la que cada archivo de
// tests/db vuelve a crear su base antes de empezar (tests/db/fresh-db.ts). Ningún archivo ve lo que dejó otro.
export default async function setup() {
  const url = process.env.UNIT_MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_unit'
  const env = { ...process.env, MIGRATION_DATABASE_URL: url, APP_ENV: 'test' }
  execSync('node scripts/migrate.mjs reset', { env, stdio: 'pipe' })
  execSync('node scripts/seed.mjs', { env, stdio: 'pipe' })

  const target = new URL(url)
  const db = target.pathname.slice(1)
  const tpl = `${db}_tpl`
  target.pathname = '/postgres'
  const sql = postgres(target.href, { max: 1, onnotice: () => {} })
  try {
    // Una copia solo se puede sacar de una base sin conexiones: se cierran las que haya dejado una corrida anterior.
    await sql`select pg_terminate_backend(pid) from pg_stat_activity where datname in (${db}, ${tpl}) and pid <> pg_backend_pid()`
    await sql.unsafe(`drop database if exists "${tpl}"`)
    await sql.unsafe(`create database "${tpl}" template "${db}"`)
    // Los ajustes por rol y base no viajan con la copia: se guardan también en la copia para reponerlos en cada archivo.
    const settings = await sql<{ role: string; config: string[] }[]>`
      select r.rolname as role, s.setconfig as config from pg_db_role_setting s
        join pg_roles r on r.oid = s.setrole join pg_database d on d.oid = s.setdatabase where d.datname = ${db}`
    for (const s of settings)
      for (const c of s.config) {
        const [key, ...value] = c.split('=')
        await sql.unsafe(`alter role "${s.role}" in database "${tpl}" set ${key} = '${value.join('=').replace(/'/g, "''")}'`)
      }
  } finally {
    await sql.end()
  }
}
