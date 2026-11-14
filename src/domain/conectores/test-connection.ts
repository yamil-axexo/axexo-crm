import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { notFound } from '@/lib/errors'
import { connector } from '@/server/adapters/registry'
import { gate } from '@/server/adapters/live/gate'
import { errorCode } from '@/server/adapters/live/http'

export type TestOutcome = { ok: boolean; mode: 'off' | 'simulated' | 'live'; detail: string; missing: string[] }

/**
 * "Probar conexión" (solo administración, queda en la bitácora). Apagado: no sale nada y explica por qué (qué variables
 * faltan, solo sus nombres). Encendido: corre la prueba de conexión del conector y anota el resultado y cuánto tardó.
 */
export async function testConnection(ctx: Ctx, key: string): Promise<TestOutcome> {
  ctx.assert('connector.test')
  const def = connector(key)
  if (!def) throw notFound()
  const g = gate(def.gate)
  let out: TestOutcome
  let ms: number | null = null
  if (g.mode !== 'live') {
    out = { ok: false, mode: g.mode, missing: g.missing, detail: g.mode === 'simulated' ? 'Simulado (solo pruebas): no sale nada.' : `Apagado, no se probó. Falta: ${g.missing.join(', ')}` }
  } else {
    const t0 = Date.now()
    try {
      const d = await def.probe({ email: ctx.user.email })
      out = { ok: true, mode: 'live', missing: [], detail: (d || 'Respondió').slice(0, 280) }
    } catch (e) {
      out = { ok: false, mode: 'live', missing: [], detail: `Falló: ${errorCode(e)}` }
    }
    ms = Date.now() - t0
  }
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.connector_tests (connector, mode, ok, detail, ms, tested_by) values (${def.key}, ${out.mode}, ${out.ok}, ${out.detail.slice(0, 300)}, ${ms}, ${ctx.user.id})`
    await audit(tx, ctx, 'connector.tested', 'connector', null, null, null, { connector: def.key, mode: out.mode, ok: out.ok, missing: out.missing })
  })
  return out
}
