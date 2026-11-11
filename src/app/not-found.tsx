import Link from 'next/link'
import { publicLocale } from '@/server/context'
import { translator } from '@/lib/format'
import { buttonClass } from '@/ui/kit'

export default async function NotFound() {
  const t = translator(await publicLocale())
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="num text-[15px] font-medium text-muted">404</p>
      <h1 className="mt-2 text-[24px] leading-8 font-semibold">{t('Esa página no existe o no la puedes ver', 'That page does not exist or you cannot see it')}</h1>
      <p className="mt-3 text-[14.5px] text-muted-2">{t('Si alguien te compartió el enlace, puede que tu rol o tu mercado no tengan acceso.', 'If someone shared the link, your role or market may not have access.')}</p>
      <Link href="/hoy" className={`${buttonClass('primary')} mt-7`}>{t('Ir a Hoy', 'Go to Today')}</Link>
    </main>
  )
}
