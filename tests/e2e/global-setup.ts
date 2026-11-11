import { execSync } from 'node:child_process'
// @ts-expect-error módulo de soporte sin tipos
import { startMock } from '../support/pipedrive-mock.mjs'

// Cada corrida parte de la misma base: migraciones desde cero y datos sintéticos.
export default async function globalSetup() {
  const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_test'
  const env = { ...process.env, MIGRATION_DATABASE_URL: url, APP_ENV: 'test' }
  execSync('node scripts/migrate.mjs reset', { env, stdio: 'pipe' })
  execSync('node scripts/seed.mjs', { env, stdio: 'pipe' })
  // Pipedrive simulado para la prueba de migración: vive mientras corre la suite.
  const mock = await startMock(Number(process.env.E2E_PIPEDRIVE_PORT ?? 45992))
  return async () => {
    await mock.close()
  }
}
