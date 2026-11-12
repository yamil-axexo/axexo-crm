import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { HELP, HELP_TOPICS, TRACK_LABEL, trackOf, type L } from '@/content/guide'
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
    <div className="sc mx-auto max-w-[920px] pb-10" data-testid="help">
      <HelpList
        rows={rows}
        labels={{
          title: t('¿Qué necesitas saber?', 'What do you need to know?'),
          desc: t('Las preguntas que más hace el equipo. Escribe una palabra o elige un tema.', 'The questions the team asks most. Type a word or pick a topic.'),
          topics: t('Ayuda', 'Help'),
          search: t('Buscar en la ayuda', 'Search help'),
          all: t('Todo', 'Everything'),
          mine: t(`Para ${l(TRACK_LABEL[track])}`, `For ${l(TRACK_LABEL[track])}`),
          emptyTitle: t('Nada con esas palabras', 'Nothing with those words'),
          empty: t('Prueba con otra palabra o pregúntale a quien administra CONTIGO.', 'Try another word or ask a CONTIGO admin.'),
          clear: t('Borrar la búsqueda', 'Clear the search'),
          count: t('{n} preguntas', '{n} questions'),
        }}
      />
      <div className="mt-10 flex flex-col gap-x-5 gap-y-1 rounded-[20px] bg-green-50 px-6 py-5 md:flex-row md:items-center">
        <p className="text-[15px] leading-6 text-strong md:flex-1">{t('¿Quieres repasar lo básico?', 'Want to go over the basics?')}</p>
        <Link href="/bienvenida" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-blue-text underline" data-testid="help-welcome">
          {t('Abre tus primeros pasos', 'Open your first steps')}
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </div>
  )
}
