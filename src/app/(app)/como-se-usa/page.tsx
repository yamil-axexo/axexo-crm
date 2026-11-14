import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { HELP } from '@/content/guide'
import { SCREEN_HELP, screenHelpFor } from '@/content/screen-help'
import { helpLessons } from '@/dal/notices'
import { Card, PageHeader } from '@/ui/kit'
import { flat } from '@/server/params'

/** "¿Cómo se usa esto?": las preguntas de la Ayuda que responden por la pantalla desde la que la persona llegó. */
export default async function HowToPage({ searchParams }: { searchParams: Promise<{ pantalla?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const from = flat(await searchParams).pantalla ?? ''
  const screen = screenHelpFor(from)
  const lessons = await helpLessons(ctx)
  const lang = locale === 'en' ? 'en' : 'es'
  const items = screen ? screen.ids.map((id) => HELP.find((h) => h.id === id)).filter((h) => h !== undefined) : []
  const back = screen && /^\/[A-Za-z0-9/_-]*$/.test(from) ? from : null
  return (
    <div className="mx-auto max-w-[820px]" data-testid="how-to">
      {back && <p className="mb-3"><Link href={back} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="how-to-back">{t('Volver a la pantalla', 'Back to the screen')}</Link></p>}
      <PageHeader
        title={screen ? t(`¿Cómo se usa ${screen.name[0]}?`, `How do I use ${screen.name[1]}?`) : t('¿Cómo se usa CONTIGO?', 'How do I use CONTIGO?')}
        desc={screen ? t('Lo que más pregunta el equipo sobre esta pantalla.', 'What the team asks most about this screen.') : t('Elige la pantalla sobre la que tienes la duda.', 'Pick the screen you have a question about.')}
      />
      {screen ? (
        <div className="space-y-4">
          {items.map((h, i) => (
            <Card key={h.id} data-testid="how-to-item">
              <details open={i === 0}>
                <summary className="flex min-h-11 cursor-pointer items-center text-[16px] font-semibold text-strong">{h.q[lang]}</summary>
                <p className="mt-2 text-[14.5px] leading-6 whitespace-pre-line text-strong">{h.a[lang]}</p>
              </details>
            </Card>
          ))}
          {lessons[screen.prefix] && (
            <p><a href={lessons[screen.prefix]} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="how-to-lesson">{t('Ver la lección de Kore Academy de esta pantalla', 'Open this screen’s Kore Academy lesson')}</a></p>
          )}
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {SCREEN_HELP.map((s) => (
            <li key={s.prefix}><Link href={`/como-se-usa?pantalla=${encodeURIComponent(s.prefix)}`} className="flex min-h-12 items-center px-5 text-[15px] font-medium text-strong hover:bg-green-50">{t(s.name[0], s.name[1])}</Link></li>
          ))}
        </ul>
      )}
      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
        <Link href="/ayuda" className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="how-to-all">{t('Ver toda la Ayuda', 'See all of Help')}</Link>
        <Link href={back ? `/reportar?desde=${encodeURIComponent(back)}` : '/reportar'} className="inline-flex min-h-11 items-center font-medium text-blue-text underline">{t('No encontré mi respuesta: reportar un problema', 'I did not find my answer: report a problem')}</Link>
      </p>
    </div>
  )
}
