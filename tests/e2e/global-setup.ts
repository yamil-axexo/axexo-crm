import { execSync } from 'node:child_process'

// Cada corrida parte de la misma base: migraciones desde cero y datos sintéticos.
export default function globalSetup() {
  const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_test'
  const env = { ...process.env, MIGRATION_DATABASE_URL: url, APP_ENV: 'test' }
  execSync('node scripts/migrate.mjs reset', { env, stdio: 'pipe' })
  execSync('node scripts/seed.mjs', { env, stdio: 'pipe' })
}
