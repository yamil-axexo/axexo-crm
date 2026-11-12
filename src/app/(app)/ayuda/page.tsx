import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { HELP, HELP_TOPICS, TRACK_LABEL, trackOf, type L } from '@/content/guide'
import { PageHeader } from '@/ui/kit'
import { HelpList, type HelpRow } from '@/ui/help'

/** Ayuda: las preguntas del equipo, con lo de tu rol a un toque. */
export default async function HelpPage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const l = (x: L) => x[locale === 'en' ? 'en' : 'es']
  const track = trackOf(ctx.memberships)
  const rows: HelpRow[] = HELP.map((h) => ({
    id: h.id, topic: h.topic, topicLabel: l(HELP_TOPICS[h.topic]), q: l(h.q), a: l(h.a), mine: h.tracks === 'all' || h.tracks.includes(track),
  }))
  return (
    <div className="mx-auto max-w-[860px] pb-10" data-testid="help">
      <PageHeader
        eyebrow={t('Ayuda', 'Help')}
        title={t('¿Qué necesitas saber?', 'What do you need to know?')}
        desc={t('Las preguntas que más hace el equipo. Escribe una palabra para filtrar.', 'The questions the team asks most. Type a word to filter.')}
      />
      <HelpList
        rows={rows}
        labels={{
          search: t('Buscar en la ayuda', 'Search help'),
          all: t('Todo', 'Everything'),
          mine: t(`Para ${l(TRACK_LABEL[track])}`, `For ${l(TRACK_LABEL[track])}`),
          empty: t('No encontramos nada con esas palabras. Prueba con otra o pregúntale a quien administra CONTIGO.', 'Nothing matches those words. Try another one or ask a CONTIGO admin.'),
          count: t('{n} preguntas', '{n} questions'),
        }}
      />
      <p className="mt-10 text-[14.5px] text-muted-2">
        {t('¿Quieres repasar lo básico? ', 'Want to go over the basics? ')}
        <Link href="/bienvenida" className="font-semibold text-blue-text underline" data-testid="help-welcome">{t('Abre tus primeros pasos', 'Open your first steps')}</Link>.
      </p>
    </div>
  )
}
