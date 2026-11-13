import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { exportSubject } from '@/domain/security'
import { DomainError } from '@/lib/errors'

/** SEG-09: descarga lo que CONTIGO guarda de la persona de una solicitud. La base deja el registro de la descarga. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  if (!ctx) return NextResponse.redirect(new URL('/login', _.url))
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id) || !ctx.can('security.manage')) return new NextResponse('Not found', { status: 404 })
  try {
    const data = await exportSubject(ctx, id)
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="contigo-titular-${id.slice(0, 8)}.json"`, 'cache-control': 'no-store' },
    })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse('Not found', { status: 404 })
    return new NextResponse('Not found', { status: 404 })
  }
}
