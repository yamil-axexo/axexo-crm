import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getCtx, publicLocale } from '@/server/context'
import './globals.css'

export const metadata: Metadata = {
  title: 'axexo CONTIGO',
  description: 'CRM de axexo',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: ReactNode }) {
  // El idioma del documento es el de la persona con sesión (el que usa toda la app); sin sesión, el de la entrada.
  const ctx = await getCtx()
  const locale = ctx?.locale ?? (await publicLocale())
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
