import type { ReactNode } from 'react'
import type { Track } from '@/content/guide'

/**
 * Ilustraciones propias de CONTIGO (SVG, sin texto, decorativas: aria-hidden).
 * Vocabulario: el hilo y el anillo de la ficha y de la cola de Hoy. Línea de 2 px con puntas redondas y
 * volumen suave en varios verdes de la familia. Los colores salen de variables para vivir sobre negro o sobre claro:
 *   --art-line, --art-accent, --art-vol, --art-deep, --art-ink, --art-warm
 * Clases de movimiento (showcase.css): draw (el trazo se dibuja), pop (aparece), sweep, shuffle-*, slide-card, bob.
 */
const LINE = 'var(--art-line, #a8f0d1)'
const ACCENT = 'var(--art-accent, #3ddc97)'
const VOL = 'var(--art-vol, rgba(61, 220, 151, 0.2))'
const DEEP = 'var(--art-deep, #0e6b5c)'
const INK = 'var(--art-ink, #0b100e)'
const SOFT = 'var(--art-soft, rgba(168, 240, 209, 0.45))'
const WARM = 'var(--art-warm, #f5cf7a)'

const stroke = { fill: 'none', stroke: LINE, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const b = (n: number) => ({ '--b': n }) as React.CSSProperties

function Svg({ w, h, children, className }: { w: number; h: number; children: ReactNode; className?: string }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`sc-art ${className ?? ''}`} aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

/** Anillo de la cola: abierto (pendiente) o lleno con su marca (hecho). */
function Ring({ x, y, r = 7, done, n = 0 }: { x: number; y: number; r?: number; done?: boolean; n?: number }) {
  return done ? (
    <g className="pop" style={b(n)}>
      <circle cx={x} cy={y} r={r} fill={ACCENT} />
      <path d={`M${x - r * 0.42} ${y} l${r * 0.32} ${r * 0.34} l${r * 0.56} -${r * 0.62}`} fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ) : (
    <circle cx={x} cy={y} r={r} fill="none" stroke={LINE} strokeWidth={2} />
  )
}
const Bar = ({ x, y, w, o = 1, h = 5 }: { x: number; y: number; w: number; o?: number; h?: number }) => <rect x={x} y={y - h / 2} width={w} height={h} rx={h / 2} fill={LINE} opacity={o} />
/** Persona abstracta: cabeza y hombros dentro de un círculo. */
function Person({ x, y, r = 14, tone = VOL }: { x: number; y: number; r?: number; tone?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={tone} stroke={LINE} strokeWidth={2} />
      <circle cx={x} cy={y - r * 0.22} r={r * 0.3} fill={LINE} />
      <path d={`M${x - r * 0.55} ${y + r * 0.62} a${r * 0.55} ${r * 0.5} 0 0 1 ${r * 1.1} 0`} fill={LINE} />
    </g>
  )
}
/** Tienda: toldo ondulado y puerta. */
function Store({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={4} y={16} width={40} height={30} rx={6} fill={VOL} stroke={LINE} strokeWidth={2} />
      <path d="M0 16 q0 -12 8 -12 h32 q8 0 8 12 a6 6 0 0 1 -12 0 a6 6 0 0 1 -12 0 a6 6 0 0 1 -12 0 a6 6 0 0 1 -12 0 z" fill={DEEP} stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
      <rect x={19} y={28} width={10} height={18} rx={3} fill={LINE} />
    </g>
  )
}

// ------------------------------------------------------------------ roles
function RepArt() {
  return (
    <Svg w={240} h={160}>
      <circle cx={120} cy={80} r={70} fill={VOL} opacity={0.5} />
      <Store x={14} y={72} />
      <path d="M62 104 C 74 104, 70 86, 84 86" pathLength={1} className="draw" {...stroke} stroke={ACCENT} strokeDasharray="1" />
      <rect x={84} y={12} width={78} height={136} rx={18} fill={INK} stroke={LINE} strokeWidth={2} />
      <rect x={110} y={19} width={26} height={6} rx={3} fill={LINE} opacity={0.5} />
      <rect x={93} y={34} width={60} height={36} rx={10} fill={DEEP} />
      <Bar x={101} y={45} w={30} />
      <Bar x={101} y={56} w={42} o={0.5} />
      <g className="pop" style={b(1)}>
        <rect x={93} y={78} width={60} height={18} rx={9} fill={ACCENT} />
        <path d="M108 83 c-2 0 -3 1 -3 3 c0 4 4 7 8 7 c2 0 3 -1 3 -3 l-3 -1.5 l-1.5 1.5 c-1.5 -0.5 -3 -2 -3.5 -3.5 l1.5 -1.5 z" fill={INK} />
        <rect x={121} y={85} width={24} height={4} rx={2} fill={INK} opacity={0.75} />
      </g>
      <Ring x={102} y={110} r={6} done n={2} />
      <Bar x={114} y={110} w={34} o={0.6} />
      <Ring x={102} y={130} r={6} />
      <Bar x={114} y={130} w={26} o={0.6} />
      <path d="M176 60 q14 20 0 40" pathLength={1} className="draw" style={b(2)} {...stroke} stroke={ACCENT} />
      <path d="M190 46 q24 34 0 68" pathLength={1} className="draw" style={b(3)} {...stroke} stroke={LINE} opacity={0.6} />
      <path d="M204 34 q32 46 0 92" pathLength={1} className="draw" style={b(4)} {...stroke} stroke={LINE} opacity={0.3} />
    </Svg>
  )
}

function SupervisorArt() {
  const rows = [
    { y: 34, a: 92, c: 58, done: true },
    { y: 80, a: 70, c: 44, done: true },
    { y: 126, a: 46, c: 24, done: false },
  ]
  return (
    <Svg w={240} h={160}>
      <rect x={14} y={10} width={212} height={140} rx={20} fill={VOL} opacity={0.45} />
      {rows.map((r, i) => (
        <g key={r.y}>
          <Person x={42} y={r.y} r={15} tone={i === 0 ? DEEP : VOL} />
          <rect x={68} y={r.y - 9} width={104} height={6} rx={3} fill={LINE} opacity={0.16} />
          <rect x={68} y={r.y - 9} width={r.a} height={6} rx={3} fill={ACCENT} className="sc-bar" style={b(i)} />
          <rect x={68} y={r.y + 4} width={104} height={6} rx={3} fill={LINE} opacity={0.16} />
          <rect x={68} y={r.y + 4} width={r.c} height={6} rx={3} fill={LINE} className="sc-bar" style={b(i + 1)} />
          {r.done ? <Ring x={200} y={r.y} r={9} done n={i} /> : <circle cx={200} cy={r.y} r={9} fill="none" stroke={WARM} strokeWidth={2} strokeDasharray="4 4" />}
        </g>
      ))}
      <path d="M214 96 q14 15 0 30 m0 0 l-1 -7 m1 7 l7 -2" pathLength={1} className="draw" style={b(3)} {...stroke} stroke={WARM} />
    </Svg>
  )
}

function LeadArt() {
  const pins: [number, number, number][] = [[58, 104, 6], [96, 62, 6], [132, 98, 9], [170, 56, 6], [196, 108, 6]]
  return (
    <Svg w={240} h={160}>
      <path d="M40 92 C 30 44, 84 14, 128 22 C 180 14, 228 48, 214 98 C 208 140, 150 152, 112 142 C 70 150, 44 128, 40 92 Z" fill={VOL} stroke={LINE} strokeWidth={2} strokeDasharray="2 7" strokeLinecap="round" />
      <path d="M58 104 C 70 80, 84 70, 96 62 S 120 86, 132 98 S 158 66, 170 56 S 190 92, 196 108" pathLength={1} className="draw" {...stroke} stroke={ACCENT} />
      {pins.map(([x, y, r], i) => (
        <g key={x} className="pop" style={b(i)}>
          {r > 6 && <circle cx={x} cy={y} r={20} fill={ACCENT} opacity={0.22} />}
          <circle cx={x} cy={y} r={r} fill={r > 6 ? ACCENT : INK} stroke={r > 6 ? INK : LINE} strokeWidth={2} />
        </g>
      ))}
      <g className="bob">
        <path d="M132 86 v-34" {...stroke} />
        <path d="M132 52 h24 l-6 8 l6 8 h-24 z" fill={DEEP} stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
      </g>
    </Svg>
  )
}

function OpsArt() {
  const nodes = [36, 92, 148, 204]
  return (
    <Svg w={240} h={160}>
      <path d="M36 42 H204" {...stroke} opacity={0.25} />
      <path d="M36 42 H148" pathLength={1} className="draw" {...stroke} stroke={ACCENT} />
      {nodes.map((x, i) =>
        i < 2 ? (
          <Ring key={x} x={x} y={42} r={9} done n={i} />
        ) : i === 2 ? (
          <g key={x} className="pop" style={b(2)}>
            <circle cx={x} cy={42} r={18} fill={ACCENT} opacity={0.2} />
            <circle cx={x} cy={42} r={10} fill={INK} stroke={ACCENT} strokeWidth={3} />
            <circle cx={x} cy={42} r={3.5} fill={ACCENT} />
          </g>
        ) : (
          <circle key={x} cx={x} cy={42} r={9} fill={INK} stroke={LINE} strokeWidth={2} opacity={0.6} />
        ),
      )}
      <path d="M148 60 v14" {...stroke} stroke={ACCENT} strokeDasharray="2 5" />
      <g className="bob">
        <rect x={64} y={76} width={168} height={72} rx={16} fill={VOL} stroke={LINE} strokeWidth={2} />
        <Store x={76} y={88} s={0.9} />
        <Ring x={138} y={96} r={6} done n={3} />
        <Bar x={150} y={96} w={66} o={0.7} />
        <Ring x={138} y={114} r={6} done n={4} />
        <Bar x={150} y={114} w={50} o={0.7} />
        <Ring x={138} y={132} r={6} />
        <Bar x={150} y={132} w={58} o={0.35} />
      </g>
    </Svg>
  )
}

function LtArt() {
  return (
    <Svg w={240} h={160}>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={20 + i * 14} y={132 - (14 + i * 9)} width={8} height={14 + i * 9} rx={4} fill={LINE} opacity={0.22 + i * 0.07} />
      ))}
      <circle cx={206} cy={36} r={15} fill="none" stroke={LINE} strokeWidth={5} opacity={0.2} />
      <circle cx={206} cy={36} r={15} fill="none" stroke={ACCENT} strokeWidth={5} strokeLinecap="round" pathLength={100} strokeDasharray="72 100" transform="rotate(-90 206 36)" />
      <path d="M36 80 Q120 4 204 80 Q120 156 36 80 Z" fill={VOL} stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={120} cy={80} r={36} fill={INK} stroke={LINE} strokeWidth={2} />
      <circle cx={120} cy={80} r={26} fill="none" stroke={DEEP} strokeWidth={7} />
      <circle cx={120} cy={80} r={26} fill="none" stroke={ACCENT} strokeWidth={7} strokeLinecap="round" pathLength={100} strokeDasharray="100" className="sc-ring-arc" style={{ '--v': 68 } as React.CSSProperties} transform="rotate(-90 120 80)" />
      <circle cx={120} cy={80} r={11} fill={ACCENT} />
      <circle cx={125} cy={75} r={3.5} fill={INK} />
    </Svg>
  )
}

function AdminArt() {
  return (
    <Svg w={240} h={160}>
      <rect x={16} y={14} width={128} height={132} rx={20} fill={VOL} opacity={0.5} />
      {[
        { y: 40, on: true },
        { y: 80, on: true },
        { y: 120, on: false },
      ].map((t, i) => (
        <g key={t.y}>
          <Bar x={30} y={t.y} w={i === 1 ? 34 : 46} o={0.7} />
          <rect x={92} y={t.y - 11} width={40} height={22} rx={11} fill={t.on ? ACCENT : INK} stroke={t.on ? ACCENT : LINE} strokeWidth={2} />
          <circle cx={t.on ? 121 : 103} cy={t.y} r={7} fill={t.on ? INK : LINE} className="pop" style={b(i)} />
        </g>
      ))}
      <g className="bob">
        <circle cx={186} cy={60} r={26} fill={DEEP} stroke={LINE} strokeWidth={2} />
        <circle cx={186} cy={60} r={10} fill={INK} stroke={LINE} strokeWidth={2} />
        <path d="M186 86 v50 m0 -8 h14 m-14 -16 h10" {...stroke} strokeWidth={5} />
      </g>
      <circle cx={186} cy={60} r={38} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="3 8" strokeLinecap="round" opacity={0.7} />
    </Svg>
  )
}

const ROLE_ART: Record<Track, () => ReactNode> = { rep: RepArt, supervisor: SupervisorArt, lead: LeadArt, ops: OpsArt, kam: LeadArt, lt: LtArt, finance: LtArt, admin: AdminArt }
export function RoleArt({ track }: { track: Track }) {
  const Art = ROLE_ART[track]
  return <Art />
}

// ------------------------------------------------------------------ momentos
/** La cola que se ordena: la fila con el reloj sube al primer lugar. */
function QueueArt() {
  const row = (y: number, w: number, chip: string, cls?: string, done?: boolean) => (
    <g className={cls}>
      <rect x={60} y={y} width={240} height={40} rx={14} fill={VOL} stroke={LINE} strokeWidth={1.5} strokeOpacity={0.5} />
      <Ring x={84} y={y + 20} r={8} done={done} />
      <Bar x={102} y={y + 14} w={w} />
      <Bar x={102} y={y + 27} w={w * 0.6} o={0.4} />
      <rect x={246} y={y + 11} width={40} height={18} rx={9} fill={chip} />
    </g>
  )
  return (
    <Svg w={360} h={220}>
      <circle cx={180} cy={110} r={104} fill={VOL} opacity={0.3} />
      <g className="shuffle-2">
        <rect x={48} y={18} width={264} height={56} rx={18} fill={INK} stroke={ACCENT} strokeWidth={2} />
        <rect x={48} y={18} width={264} height={56} rx={18} fill={ACCENT} opacity={0.14} />
        <circle cx={76} cy={46} r={12} fill="none" stroke={LINE} strokeWidth={3} opacity={0.3} />
        <path d="M76 34 a12 12 0 0 1 10.4 18" {...stroke} stroke={WARM} strokeWidth={3} />
        <Bar x={100} y={38} w={110} h={6} />
        <Bar x={100} y={54} w={70} o={0.5} />
        <rect x={236} y={34} width={62} height={24} rx={12} fill={ACCENT} />
        <rect x={250} y={44} width={34} height={4} rx={2} fill={INK} />
      </g>
      {row(84, 96, 'var(--art-risk, #ff9d8f)', 'shuffle-1')}
      {row(132, 120, WARM)}
      {row(180, 84, ACCENT)}
      <path d="M30 150 v-84 m0 0 l-8 10 m8 -10 l8 10" pathLength={1} className="draw" {...stroke} stroke={ACCENT} />
    </Svg>
  )
}

/** El reloj del lead: el anillo se consume y la llamada lo detiene. */
function ClockArt() {
  return (
    <Svg w={360} h={220}>
      <circle cx={126} cy={110} r={96} fill={VOL} opacity={0.35} />
      <circle cx={126} cy={110} r={70} fill={INK} stroke={LINE} strokeWidth={2} />
      <circle cx={126} cy={110} r={56} fill="none" stroke={DEEP} strokeWidth={10} />
      <circle cx={126} cy={110} r={56} fill="none" stroke={ACCENT} strokeWidth={10} strokeLinecap="round" pathLength={100} strokeDasharray="100" className="sc-ring-arc" style={{ '--v': 66 } as React.CSSProperties} transform="rotate(-90 126 110)" />
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d="M126 68 v6" {...stroke} opacity={0.6} transform={`rotate(${a} 126 110)`} />
      ))}
      <g className="sweep">
        <path d="M126 110 V76" {...stroke} strokeWidth={4} />
      </g>
      <path d="M126 110 l20 12" {...stroke} strokeWidth={4} stroke={ACCENT} />
      <circle cx={126} cy={110} r={6} fill={LINE} />
      <path d="M196 110 C 214 110, 212 84, 232 84" pathLength={1} className="draw" {...stroke} stroke={ACCENT} strokeDasharray="1" />
      <g className="bob">
        <rect x={232} y={52} width={112} height={116} rx={18} fill={VOL} stroke={LINE} strokeWidth={2} />
        <Person x={258} y={80} r={13} tone={DEEP} />
        <Bar x={280} y={75} w={50} />
        <Bar x={280} y={88} w={32} o={0.45} />
        <g className="pop" style={b(2)}>
          <rect x={246} y={110} width={84} height={26} rx={13} fill={ACCENT} />
          <path d="M262 117 c-2 0 -3 1 -3 3 c0 5 5 9 10 9 c2 0 3 -1 3 -3 l-4 -2 l-2 2 c-2 -1 -4 -3 -4.5 -4.5 l2 -2 z" fill={INK} />
          <rect x={280} y={121} width={38} height={4} rx={2} fill={INK} opacity={0.75} />
        </g>
        <rect x={246} y={144} width={46} height={12} rx={6} fill={WARM} opacity={0.9} />
      </g>
    </Svg>
  )
}

/** El árbol de la cadena: la cadena arriba, sus tiendas abajo. */
function TreeArt() {
  const kids = [44, 112, 180, 248, 316]
  return (
    <Svg w={360} h={220}>
      <circle cx={180} cy={110} r={100} fill={VOL} opacity={0.3} />
      {kids.map((x, i) => (
        <path key={x} d={`M180 78 C 180 118, ${x} 100, ${x} 140`} pathLength={1} className="draw" style={b(i)} {...stroke} stroke={i % 2 ? LINE : ACCENT} />
      ))}
      <rect x={124} y={14} width={112} height={64} rx={18} fill={INK} stroke={ACCENT} strokeWidth={2} />
      <Store x={140} y={22} s={0.95} />
      <Bar x={194} y={38} w={30} />
      <Bar x={194} y={52} w={20} o={0.5} />
      {kids.map((x, i) => (
        <g key={x} className="pop" style={b(i + 2)}>
          <rect x={x - 28} y={140} width={56} height={60} rx={14} fill={i === 2 ? DEEP : VOL} stroke={LINE} strokeWidth={1.5} />
          <Store x={x - 15} y={146} s={0.62} />
          <Bar x={x - 16} y={188} w={[30, 22, 32, 18, 26][i] ?? 24} o={0.7} h={4} />
        </g>
      ))}
    </Svg>
  )
}

/** El negocio que avanza: la tarjeta cruza de etapa con su próximo paso pegado. */
function StageArt() {
  const cols = [20, 104, 188, 272]
  const tone = ['#a8f0d1', '#7fe0b5', '#3ddc97', '#33b888']
  return (
    <Svg w={360} h={220}>
      {cols.map((x, i) => (
        <g key={x}>
          <rect x={x} y={20} width={72} height={184} rx={16} fill={VOL} opacity={0.5} />
          <rect x={x} y={20} width={72} height={6} rx={3} fill={tone[i]} />
          <Bar x={x + 10} y={42} w={34} o={0.7} h={4} />
        </g>
      ))}
      {[
        [28, 58], [28, 104], [112, 58], [196, 112], [280, 58], [280, 104], [280, 150],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`} opacity={0.5}>
          <rect x={x} y={y} width={56} height={38} rx={10} fill={INK} stroke={LINE} strokeWidth={1.2} strokeOpacity={0.5} />
          <Bar x={x! + 8} y={y! + 12} w={30} o={0.6} h={4} />
          <rect x={x! + 8} y={y! + 22} width={38} height={8} rx={4} fill={LINE} opacity={0.25} />
        </g>
      ))}
      <path d="M150 150 C 170 176, 190 176, 208 152" pathLength={1} className="draw" {...stroke} stroke={ACCENT} strokeDasharray="1" />
      <path d="M208 152 l-9 1 m9 -1 l-2 9" {...stroke} stroke={ACCENT} />
      <g className="slide-card">
        <rect x={190} y={52} width={68} height={52} rx={12} fill={INK} stroke={ACCENT} strokeWidth={2} />
        <rect x={190} y={52} width={68} height={52} rx={12} fill={ACCENT} opacity={0.12} />
        <Bar x={200} y={66} w={40} h={5} />
        <rect x={200} y={78} width={48} height={16} rx={8} fill={ACCENT} />
        <circle cx={209} cy={86} r={3.5} fill="none" stroke={INK} strokeWidth={1.6} />
        <rect x={216} y={84} width={26} height={4} rx={2} fill={INK} opacity={0.8} />
      </g>
    </Svg>
  )
}

export type MomentArt = 'queue' | 'clock' | 'tree' | 'stage'
const MOMENT_ART: Record<MomentArt, () => ReactNode> = { queue: QueueArt, clock: ClockArt, tree: TreeArt, stage: StageArt }
export function Moment({ art }: { art: MomentArt }) {
  const Art = MOMENT_ART[art]
  return <Art />
}

// ------------------------------------------------------------------ bienvenida y ayuda
/** La bitácora: cada cambio, un punto en el hilo. */
export function LogArt() {
  const rows = [26, 62, 98, 134]
  return (
    <Svg w={200} h={160}>
      <path d="M36 20 V146" pathLength={1} className="draw" {...stroke} stroke={ACCENT} />
      {rows.map((y, i) => (
        <g key={y}>
          <g className="pop" style={b(i)}>
            {i === 0 ? <circle cx={36} cy={y} r={7} fill={INK} stroke={ACCENT} strokeWidth={2.5} /> : <circle cx={36} cy={y} r={6} fill={ACCENT} stroke={INK} strokeWidth={2} />}
          </g>
          <rect x={56} y={y - 13} width={128} height={26} rx={10} fill={VOL} />
          <Person x={70} y={y} r={8} tone={DEEP} />
          <Bar x={86} y={y - 4} w={[70, 54, 82, 46][i] ?? 60} h={4} />
          <Bar x={86} y={y + 6} w={[40, 30, 36, 28][i] ?? 30} o={0.45} h={4} />
        </g>
      ))}
    </Svg>
  )
}

/** Solo lectura: ves todo, no cambias nada. */
export function ReadonlyArt() {
  return (
    <Svg w={200} h={160}>
      <rect x={22} y={16} width={156} height={128} rx={18} fill={VOL} opacity={0.5} />
      {[0, 1, 2].map((i) => (
        <g key={i} opacity={0.55}>
          <Ring x={42} y={42 + i * 38} r={6} />
          <Bar x={56} y={42 + i * 38} w={[90, 70, 100][i] ?? 80} h={5} />
        </g>
      ))}
      <g className="bob">
        <path d="M44 86 Q100 30 156 86 Q100 142 44 86 Z" fill={INK} stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={100} cy={86} r={22} fill={DEEP} stroke={LINE} strokeWidth={2} />
        <circle cx={100} cy={86} r={10} fill={ACCENT} />
        <circle cx={104} cy={82} r={3} fill={INK} />
      </g>
    </Svg>
  )
}

/** Ayuda: una lupa hecha de anillos, con preguntas alrededor. */
export function HelpArt() {
  return (
    <Svg w={280} h={200}>
      <circle cx={132} cy={92} r={86} fill={VOL} opacity={0.4} />
      <g className="bob">
        <rect x={16} y={30} width={92} height={40} rx={14} fill={VOL} stroke={LINE} strokeWidth={1.5} />
        <Bar x={30} y={44} w={56} />
        <Bar x={30} y={56} w={36} o={0.45} />
      </g>
      <rect x={196} y={118} width={72} height={36} rx={14} fill={DEEP} stroke={LINE} strokeWidth={1.5} />
      <Bar x={208} y={130} w={44} />
      <Bar x={208} y={142} w={28} o={0.5} />
      <circle cx={132} cy={92} r={52} fill={INK} stroke={LINE} strokeWidth={2} />
      <circle cx={132} cy={92} r={40} fill="none" stroke={DEEP} strokeWidth={8} />
      <circle cx={132} cy={92} r={40} fill="none" stroke={ACCENT} strokeWidth={8} strokeLinecap="round" pathLength={100} strokeDasharray="100" className="sc-ring-arc" style={{ '--v': 74 } as React.CSSProperties} transform="rotate(-90 132 92)" />
      <path d="M120 82 a12 12 0 1 1 18 10 q-6 3 -6 10" {...stroke} strokeWidth={5} />
      <circle cx={132} cy={114} r={3.5} fill={LINE} />
      <path d="M170 130 l34 34" {...stroke} strokeWidth={10} stroke={ACCENT} />
      <path d="M170 130 l34 34" {...stroke} strokeWidth={3} stroke={INK} opacity={0.35} />
      <circle cx={232} cy={42} r={10} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="3 6" strokeLinecap="round" />
    </Svg>
  )
}

/** Sin resultados: la lupa no encontró nada, quedan anillos abiertos. */
export function EmptyArt() {
  return (
    <Svg w={200} h={150}>
      <circle cx={92} cy={70} r={56} fill={VOL} opacity={0.6} />
      {[
        [34, 34], [158, 40], [150, 118],
      ].map(([x, y]) => (
        <circle key={`${x}`} cx={x} cy={y} r={7} fill="none" stroke={LINE} strokeWidth={2} strokeDasharray="3 5" strokeLinecap="round" />
      ))}
      <circle cx={92} cy={70} r={38} fill={INK} stroke={LINE} strokeWidth={2.5} />
      <path d="M76 70 h32" {...stroke} strokeWidth={5} stroke={SOFT} strokeDasharray="1 11" />
      <path d="M120 98 l30 30" {...stroke} strokeWidth={9} stroke={ACCENT} />
    </Svg>
  )
}

/** Hilo decorativo de fondo: una línea que une anillos, de lado a lado. */
export function ThreadLine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className={`sc-threadline ${className ?? ''}`} aria-hidden="true" focusable="false">
      <path d="M0 80 C 180 80, 220 30, 400 30 S 620 96, 800 70 S 1040 20, 1200 46" fill="none" stroke="url(#sc-thread-g)" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <defs>
        <linearGradient id="sc-thread-g" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#0e6b5c" />
          <stop offset="0.5" stopColor="#3ddc97" />
          <stop offset="1" stopColor="#a8f0d1" />
        </linearGradient>
      </defs>
    </svg>
  )
}
