import { NextResponse, type NextRequest } from 'next/server'

// SEC-05: Content-Security-Policy con nonce por solicitud. El navegador no habla con nadie más que con esta app (PORT-02).
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const dev = process.env.NODE_ENV !== 'production'
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', csp)
  // GOB-07: un identificador por petición, de punta a punta. Uno que llega de afuera solo vale si tiene forma de identificador.
  const incoming = request.headers.get('x-request-id')
  const requestId = incoming && /^[A-Za-z0-9._-]{8,80}$/.test(incoming) ? incoming : crypto.randomUUID()
  headers.set('x-request-id', requestId)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
}
