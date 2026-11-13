import type { NextConfig } from 'next'

// PORT-06: salida "standalone" para poder correr el mismo build en un contenedor (ECS Fargate).
// SEC-05: los encabezados fijos van aquí; la CSP con nonce se arma por solicitud en src/proxy.ts.
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // La ubicación solo la puede pedir CONTIGO mismo (guardar dónde está un comercio y "Cerca de mí"), nunca un tercero incrustado.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
}

export default config
