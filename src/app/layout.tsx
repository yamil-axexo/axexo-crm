import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { publicLocale } from '@/server/context'
import './globals.css'

export const metadata: Metadata = {
  title: 'axexo CONTIGO',
  description: 'CRM de axexo',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await publicLocale()
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
