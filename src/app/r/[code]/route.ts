import { NextResponse, type NextRequest } from 'next/server'
import { withoutUser } from '@/server/db'
import { REFERRAL_CODE } from '@/domain/embudo/referrals'

// LEAD-05: el enlace de referido de un comercio. No tiene sesión: solo lleva al formulario web del mercado con el código
// puesto, para que el lead que entre quede atribuido a ese comercio. Un código que no existe o está en pausa lleva al inicio.
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const clean = code.trim().toUpperCase()
  const rows = REFERRAL_CODE.test(clean) ? await withoutUser((tx) => tx<{ slug: string }[]>`select slug from app.referral_public(${clean})`) : []
  const target = rows[0] ? `/f/${rows[0].slug}?ref=${clean}&utm_source=referido&utm_medium=enlace` : '/'
  return NextResponse.redirect(new URL(target, request.url), { status: 307, headers: { 'cache-control': 'no-store' } })
}
