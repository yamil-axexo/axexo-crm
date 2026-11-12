import type { ReactNode } from 'react'

/** Gráficas de la entrada y anillos de avance. SVG y CSS: el estado final es el de por defecto; al entrar en pantalla se animan (showcase.css). */

/** Anillo de avance. `live` anima cada cambio de valor (lista de primeros pasos). */
export function Ring({ value, size = 96, stroke = 9, track = 'rgba(255,255,255,0.14)', from = '#a8f0d1', to = '#33b888', live, id, children }: { value: number; size?: number; stroke?: number; track?: string; from?: string; to?: string; live?: boolean; id: string; children?: ReactNode }) {
  const r = 50 - stroke / 2
  const v = Math.max(0, Math.min(100, value))
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={50} cy={50} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {v > 0 && <circle cx={50} cy={50} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round" pathLength={100} strokeDasharray="100" className={live ? 'sc-ring-live' : 'sc-ring-arc'} style={live ? { strokeDashoffset: 100 - v } : ({ '--v': v } as React.CSSProperties)} />}
      </svg>
      <span className="relative">{children}</span>
    </span>
  )
}

const STAGE = ['#a8f0d1', '#7fe0b5', '#3ddc97', '#33b888', '#24815f']

/** Embudo: una barra por etapa, que se llena de izquierda a derecha. */
export function Funnel({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(...stages.map((s) => s.value))
  return (
    <ul className="space-y-3.5">
      {stages.map((s, i) => (
        <li key={s.label}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="text-[#c5d2cc]">{s.label}</span>
            <span className="num text-[16px] font-semibold text-white" data-count={s.value}>{s.value}</span>
          </div>
          <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/10">
            <div className="sc-bar h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, background: `linear-gradient(90deg, ${STAGE[i % STAGE.length]}, ${STAGE[(i + 1) % STAGE.length]})`, '--b': i } as React.CSSProperties} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Dos barras por equipo: primer intento a tiempo y contacto logrado, sobre los mismos leads. */
export function ResponseBars({ teams, first, reached }: { teams: { label: string; first: number; reached: number }[]; first: string; reached: string }) {
  return (
    <div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#c5d2cc]">
        <li className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#3ddc97]" />{first}</li>
        <li className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#a8f0d1]" />{reached}</li>
      </ul>
      <ul className="mt-4 space-y-4">
        {teams.map((t, i) => (
          <li key={t.label}>
            <p className="text-[14px] text-white">{t.label}</p>
            {[
              { v: t.first, c: 'linear-gradient(90deg, #24815f, #3ddc97)', name: first },
              { v: t.reached, c: 'linear-gradient(90deg, #7fe0b5, #a8f0d1)', name: reached },
            ].map((bar, k) => (
              <div key={bar.name} className="mt-1.5 flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="sc-bar h-full rounded-full" style={{ width: `${bar.v}%`, background: bar.c, '--b': i * 2 + k } as React.CSSProperties} />
                </div>
                <span className="num w-11 text-right text-[13.5px] font-medium text-white">
                  <span className="sr-only">{bar.name}: </span>
                  <span data-count={bar.v}>{bar.v}</span>%
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
