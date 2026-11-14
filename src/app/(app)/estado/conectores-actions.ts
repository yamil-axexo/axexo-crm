'use server'

import { runAction, str } from '@/server/action'
import { testConnection } from '@/domain/conectores/test-connection'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

/** "Probar conexión" de un conector: solo administración; queda en la bitácora. Apagado, explica por qué no corre. */
export async function testConnectorAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await testConnection(ctx, str(fd, 'key'))
    const missing = r.missing.join(', ')
    const message: [string, string] = r.mode === 'live'
      ? r.ok ? [`Conexión correcta. ${r.detail}`, `Connection works. ${r.detail}`] : [`La conexión falló: ${r.detail}`, `The connection failed: ${r.detail}`]
      : r.mode === 'simulated' ? ['Simulado: en pruebas no sale nada.', 'Simulated: nothing leaves in tests.']
      : [`No se probó porque está apagado. Falta: ${missing}.`, `Not tested because it is off. Missing: ${missing}.`]
    return { message, revalidate: ['/estado'] }
  })
}
