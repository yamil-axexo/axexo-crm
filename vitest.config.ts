import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

// Las pruebas de base comparten una sola base, sembrada una vez por corrida, y varios archivos dejan datos que otros ven
// (personas con acceso, embudos importados de Pipedrive). El orden por defecto de vitest cambia de una corrida a otra
// (primero lo que falló, luego lo más lento según su caché), así que el resultado dependía del azar. Orden fijo: por ruta.
class ByPath extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((x, y) => (x.moduleId < y.moduleId ? -1 : x.moduleId > y.moduleId ? 1 : 0))
  }
}

// El Pipedrive simulado de las pruebas escucha en un puerto local. Se puede mover con UNIT_PIPEDRIVE_PORT
// cuando dos árboles de trabajo corren las pruebas a la vez en la misma máquina.
const pipedrivePort = Number(process.env.UNIT_PIPEDRIVE_PORT ?? 45991)

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/global-setup.ts'],
    fileParallelism: false,
    sequence: { sequencer: ByPath },
    testTimeout: 20_000,
    env: {
      APP_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://contigo_app@127.0.0.1:5433/contigo_unit',
      // Pipedrive simulado (tests/support/pipedrive-mock.mjs): nunca sale a internet.
      PIPEDRIVE_API_BASE: `http://127.0.0.1:${pipedrivePort}`,
      UNIT_PIPEDRIVE_PORT: String(pipedrivePort),
      PIPEDRIVE_API_TOKEN: 'test-token',
    },
  },
})
