import 'server-only'
import { randomInt } from 'node:crypto'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * LEAD-05: referidos de comercio a comercio. Cada comercio puede tener un código y un enlace propios (/r/<código>), que
 * llevan al formulario web del mercado. El lead que entra por ahí queda atribuido al comercio que refirió, como una capa
 * más de atribución (no toca origen, canal ni responsable). El referido "cuenta" cuando llega a su primera transacción:
 * el reporte lo separa de las altas que todavía no venden. El premio y su monto no viven aquí: son reglas del programa.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const newReferralCode = (): string => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
export const REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{8}$/

/** El código que trae un envío de formulario (campo `ref`), si es de un comercio de ese mercado con enlace vigente. */
export async function referralFrom(tx: Tx, raw: unknown, market: string): Promise<{ accountId: string; code: string } | null> {
  const ref = (raw as Record<string, unknown> | null)?.ref
  const code = typeof ref === 'string' ? ref.trim().toUpperCase() : ''
  if (!REFERRAL_CODE.test(code)) return null
  const rows = await tx<{ account_id: string; market_code: string }[]>`select account_id, market_code from app.referral_public(${code})`
  if (!rows[0] || rows[0].market_code !== market) return null
  return { accountId: rows[0].account_id, code }
}

/** Crea el código y el enlace de referido de un comercio (uno por comercio). Si ya lo tiene, devuelve el mismo. */
export async function ensureReferralCode(ctx: Ctx, accountId: string): Promise<{ code: string; created: boolean }> {
  return withUser(ctx.user.id, async (tx) => {
    const accs = await tx<{ market_code: string; segment: string | null; lifecycle: string }[]>`select market_code, segment, lifecycle from crm.accounts where id = ${accountId} and archived_at is null`
    const acc = accs[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('account.edit', acc.market_code)
    const have = await tx<{ code: string }[]>`select code from crm.referral_codes where account_id = ${accountId}`
    if (have[0]) return { code: have[0].code, created: false }
    // El enlace lleva al formulario web del mercado: el del mismo tipo de venta del comercio si existe; si no, el primero activo.
    const forms = await tx<{ id: string }[]>`
      select id from crm.web_forms where market_code = ${acc.market_code} and is_active
       order by (motor = ${acc.segment ?? ''}) desc, is_campaign, created_at limit 1`
    if (!forms[0]) throw invalid('Este mercado no tiene un formulario web activo al que llevar el enlace. Pide a administración que active uno.', 'This market has no active web form for the link to open. Ask administration to turn one on.')
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newReferralCode()
      const ins = await tx`insert into crm.referral_codes (account_id, market_code, code, form_id, created_by)
                           values (${accountId}, ${acc.market_code}, ${code}, ${forms[0].id}, ${ctx.user.id}) on conflict (code) do nothing returning id`
      if (ins[0]) {
        await audit(tx, ctx, 'account.referral_code_created', 'account', accountId, acc.market_code, null, { code })
        return { code, created: true }
      }
    }
    throw invalid('No pudimos crear el código. Intenta otra vez.', 'We could not create the code. Try again.')
  })
}

export async function setReferralActive(ctx: Ctx, accountId: string, active: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; market_code: string; is_active: boolean }[]>`select id, market_code, is_active from crm.referral_codes where account_id = ${accountId} for update`
    const r = rows[0]
    if (!r) throw notFound('Este comercio todavía no tiene enlace de referido.', 'This merchant has no referral link yet.')
    ctx.assert('account.edit', r.market_code)
    if (r.is_active === active) return
    await tx`update crm.referral_codes set is_active = ${active} where id = ${r.id}`
    await audit(tx, ctx, 'account.referral_code_toggled', 'account', accountId, r.market_code, { is_active: r.is_active }, { is_active: active })
  })
}
