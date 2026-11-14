import { defineConfig } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', locale: 'es-MX', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: './scripts/start-standalone.sh',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      APP_ENV: 'test',
      DEMO_PERSONAS: '1',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://contigo_app@127.0.0.1:5433/contigo_test',
      PIPEDRIVE_API_BASE: `http://127.0.0.1:${process.env.E2E_PIPEDRIVE_PORT ?? 45992}`,
      PIPEDRIVE_API_TOKEN: 'test-token',
      // SEG-10: las pruebas llenan un formulario público en milisegundos; el tiempo mínimo de llenado se prueba en un formulario
      // con su propio valor (zx-eventos-api.spec.ts) y en tests/db. Fuera de las pruebas rige el valor de la app (3 s).
      PUBLIC_FORM_MIN_SECONDS: '0',
      // La suite manda más de diez formularios por minuto desde la misma dirección; el límite general se prueba en tests/db.
      PUBLIC_FORM_SUBMITS_PER_MINUTE: '120',
    },
  },
})
