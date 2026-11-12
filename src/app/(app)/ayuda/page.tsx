import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { HELP, HELP_TOPICS, TRACK_LABEL, TRAINING, trackOf, type L, type Track } from '@/content/guide'
import { HelpList, Training, type HelpRow } from '@/ui/help'

const TRACKS = Object.keys(TRACK_LABEL) as Track[]

/** Ayuda: las preguntas del equipo, con lo de tu rol primero; la capacitación por rol; y cómo reportar un problema. */
export default async function HelpPage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const lang = locale === 'en' ? 'en' : 'es'
  const l = (x: L) => x[lang]
  const o = (x: L) => x[lang === 'en' ? 'es' : 'en']
  const track = trackOf(ctx.memberships)
  const all: HelpRow[] = HELP.map((h) => ({
    id: h.id, topic: h.topic, topicLabel: l(HELP_TOPICS[h.topic]), q: l(h.q), a: l(h.a), other: `${o(h.q)} ${o(h.a)}`, tracks: h.tracks === 'all' ? TRACKS : h.tracks,
  }))
  // Cada quien ve primero lo de su rol; el orden de los temas no cambia.
  const rows = [...all.filter((r) => r.tracks.includes(track)), ...all.filter((r) => !r.tracks.includes(track))]
  return (
    <div className="sc mx-auto max-w-[920px] pb-10" data-testid="help">
      <HelpList
        rows={rows}
        mine={track}
        roles={TRACKS.map((k) => ({ key: k, label: k === track ? t(`Para ${l(TRACK_LABEL[k])}`, `For ${l(TRACK_LABEL[k])}`) : l(TRACK_LABEL[k]) }))}
        labels={{
          title: t('¿Qué necesitas saber?', 'What do you need to know?'),
          desc: t('Las preguntas que más hace el equipo. Escribe una palabra, en español o en inglés, o elige un tema.', 'The questions the team asks most. Type a word, in English or Spanish, or pick a topic.'),
          topics: t('Ayuda', 'Help'),
          search: t('Buscar en la ayuda', 'Search help'),
          all: t('Todo', 'Everything'),
          roles: t('Ver por rol', 'View by role'),
          emptyTitle: t('Nada con esas palabras', 'Nothing with those words'),
          empty: t('Prueba con otra palabra. Si lo que buscas no está, cuéntanoslo en "Reportar un problema".', 'Try another word. If what you need is not here, tell us under "Report a problem".'),
          clear: t('Borrar la búsqueda', 'Clear the search'),
          count: t('{n} preguntas', '{n} questions'),
        }}
      />

      <Training
        mine={track}
        plans={TRACKS.map((k) => ({ key: k, label: l(TRACK_LABEL[k]), day1: TRAINING[k].day1.map(l), week1: TRAINING[k].week1.map(l) }))}
        labels={{
          title: t('Capacitación', 'Training'),
          desc: t('Lo que cada rol tiene que saber hacer, en orden. Cada tema se practica en la pantalla donde se hace.', 'What each role needs to know how to do, in order. Each topic is practiced on the screen where it happens.'),
          roles: t('Capacitación por rol', 'Training by role'),
          day1: t('El día uno', 'Day one'),
          week1: t('La primera semana', 'The first week'),
        }}
      />

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-[20px] bg-green-50 px-6 py-5" data-testid="help-report-card">
          <p className="text-[15px] leading-6 text-strong">{t('¿Algo falla o te hace falta?', 'Is something broken or missing?')}</p>
          <Link href="/reportar?desde=/ayuda" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-blue-text underline" data-testid="help-report">
            {t('Reportar un problema o pedir algo', 'Report a problem or ask for something')}
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        </div>
        <div className="flex flex-col gap-1 rounded-[20px] bg-green-50 px-6 py-5">
          <p className="text-[15px] leading-6 text-strong">{t('¿Quieres repasar lo básico?', 'Want to go over the basics?')}</p>
          <Link href="/bienvenida" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-blue-text underline" data-testid="help-welcome">
            {t('Abre tus primeros pasos', 'Open your first steps')}
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  )
}
