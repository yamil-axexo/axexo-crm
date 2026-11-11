import { execSync } from 'node:child_process'

// Las pruebas de permisos y de dominio corren contra un Postgres real, con migraciones y datos sintéticos recién cargados.
export default function setup() {
  const url = process.env.UNIT_MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_unit'
  const env = { ...process.env, MIGRATION_DATABASE_URL: url, APP_ENV: 'test' }
  execSync('node scripts/migrate.mjs reset', { env, stdio: 'pipe' })
  execSync('node scripts/seed.mjs', { env, stdio: 'pipe' })
}
