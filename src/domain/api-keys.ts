import 'server-only'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { API_SCOPES, hashKey } from '@/domain/admin'
import { invalid, notFound } from '@/lib/errors'
import { READ_SCOPES } from '@/domain/api-spec'

// AUT-04: llaves de la API. Una llave de lectura se emite para UN mercado y con los alcances mínimos; lee con la identidad
// de quien la creó (las mismas políticas de la base que su pantalla), nunca más. Rotar deja dos llaves vigentes hasta la
// fecha de retiro de la anterior. Una llave de prueba solo lee el juego de datos sintéticos de la API.
export const ALL_SCOPES = [...API_SCOPES, ...READ_SCOPES] as const
export const ROTATION_DAYS = { min: 1, max: 30, default: 7 } as const

const keyInput = z.object({
  name: z.string().trim().min(3).max(80),
  scopes: z.array(z.enum(ALL_SCOPES)).min(1),
  market: z.string().length(2).or(z.literal('')).optional().default(''),
  mode: z.enum(['live', 'test']).optional().default('live'),
  ratePerMinute: z.coerce.number().int().min(1).max(6000).optional().default(120),
})

const newKey = (mode: 'live' | 'test') => `${mode === 'test' ? 'ctg_test_' : 'ctg_'}${randomBytes(30).toString('base64url')}`
const isRead = (s: string) => (READ_SCOPES as readonly string[]).includes(s)

export async function createApiKey(ctx: Ctx, input: z.input<typeof keyInput>): Promise<{ id: string; key: string }> {
  ctx.assert('integration.operate')
  const v = keyInput.safeParse(input)
  if (!v.success) throw invalid('Ponle nombre (3 a 80 letras), al menos un permiso y un límite entre 1 y 6000 por minuto.', 'Give it a name (3 to 80 characters), at least one scope and a limit between 1 and 6000 per minute.')
  const d = v.data
  const reads = d.scopes.some(isRead)
  if (reads && !d.market) throw invalid('Una llave de lectura es de un solo mercado: elige cuál.', 'A read key belongs to one market: pick which.')
  if (d.mode === 'test' && !d.scopes.every(isRead)) throw invalid('Una llave de prueba solo lee: quita los permisos de escritura.', 'A test key only reads: remove the write scopes.')
  // Nunca más de lo que ve quien la crea: el mercado tiene que estar en su alcance.
  if (d.market) ctx.market(d.market)
  const key = newKey(d.mode)
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.api_clients (id, name, key_prefix, key_hash, scopes, created_by, market_code, mode, rate_per_minute)
             values (${id}, ${d.name}, ${key.slice(0, 12)}, ${hashKey(key)}, ${d.scopes}, ${ctx.user.id}, ${d.market || null}, ${d.mode}, ${d.ratePerMinute})`
    await audit(tx, ctx, 'api_client.created', 'api_client', id, d.market || null, null, { name: d.name, scopes: d.scopes, mode: d.mode, rate_per_minute: d.ratePerMinute })
    return { id, key }
  })
}

/**
 * Rotación: nace una llave nueva con el mismo nombre, mercado, permisos y límite; la anterior sigue valiendo hasta su fecha
 * de retiro (entre 1 y 30 días) para que el otro sistema cambie sin corte. Después de esa fecha deja de valer sola.
 */
export async function rotateApiKey(ctx: Ctx, id: string, days: number = ROTATION_DAYS.default): Promise<{ id: string; key: string; retireAt: Date }> {
  ctx.assert('integration.operate')
  if (!Number.isInteger(days) || days < ROTATION_DAYS.min || days > ROTATION_DAYS.max) throw invalid('La llave anterior puede seguir vigente entre 1 y 30 días.', 'The previous key can stay valid between 1 and 30 days.')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ name: string; scopes: string[]; market_code: string | null; mode: 'live' | 'test'; rate_per_minute: number; retire_at: Date | null }[]>`
      select name, scopes, market_code, mode, rate_per_minute, retire_at from crm.api_clients where id = ${id} and revoked_at is null for update`
    const old = rows[0]
    if (!old) throw notFound()
    if (old.retire_at) throw invalid('Esa llave ya tiene fecha de retiro: rota la nueva.', 'That key already has a retirement date: rotate the new one.')
    if (old.market_code) ctx.market(old.market_code)
    const key = newKey(old.mode)
    const newId_ = await newId(tx)
    const retired = await tx<{ retire_at: Date }[]>`update crm.api_clients set retire_at = now() + make_interval(days => ${days}) where id = ${id} returning retire_at`
    await tx`insert into crm.api_clients (id, name, key_prefix, key_hash, scopes, created_by, market_code, mode, rate_per_minute, rotated_from)
             values (${newId_}, ${old.name}, ${key.slice(0, 12)}, ${hashKey(key)}, ${old.scopes}, ${ctx.user.id}, ${old.market_code}, ${old.mode}, ${old.rate_per_minute}, ${id})`
    await audit(tx, ctx, 'api_client.rotated', 'api_client', newId_, old.market_code, null, { name: old.name, previous: id, previous_valid_days: days })
    return { id: newId_, key, retireAt: retired[0]!.retire_at }
  })
}
