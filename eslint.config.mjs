import next from 'eslint-config-next'

// PORT-02 / SEC-03: la frontera servidor/cliente la hace cumplir el paquete "server-only" en el build:
// importar src/server, src/dal o src/domain desde un componente de cliente rompe la compilación.
const config = [...next, { ignores: ['.next/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts'] }]

export default config
