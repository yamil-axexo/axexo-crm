import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INTRO, LANDING, PHOTOS, SHOT_ALT, type L, type Photo, type Shot, type Track } from '@/content/guide'

const dir = join(process.cwd(), 'public', 'landing')
const SHOTS = Object.keys(SHOT_ALT) as Shot[]
const MOBILE_ONLY: Shot[] = ['completar', 'admin']

describe('diseño: capturas, fotos y contenido de la entrada', () => {
  it('cada captura existe en español y en inglés, en teléfono y en escritorio, y pesa poco', () => {
    for (const shot of SHOTS) {
      for (const lang of ['es', 'en']) {
        for (const size of MOBILE_ONLY.includes(shot) ? ['m'] : ['m', 'd']) {
          const file = join(dir, `${shot}-${size}-${lang}.webp`)
          expect(existsSync(file), file).toBe(true)
          expect(statSync(file).size, file).toBeLessThan(160_000)
        }
      }
    }
  })

  it('cada foto existe, pesa poco y su descripción es neutra, en los dos idiomas', () => {
    for (const name of Object.keys(PHOTOS) as Photo[]) {
      const file = join(dir, `foto-${name}.webp`)
      expect(existsSync(file), file).toBe(true)
      expect(statSync(file).size, file).toBeLessThan(160_000)
      for (const text of [PHOTOS[name].alt.es, PHOTOS[name].alt.en]) {
        expect(text.length, name).toBeGreaterThan(20)
        // Sin nombre, cargo ni relación con axexo: son fotos de archivo.
        expect(text, name).not.toMatch(/axexo|CONTIGO|cliente|customer|employee|vendedor de|dueñ[oa] de/i)
      }
    }
  })

  it('las descripciones de las capturas y de las fotos no llevan guiones largos', () => {
    const all: L[] = [...SHOTS.map((s) => SHOT_ALT[s]), ...(Object.keys(PHOTOS) as Photo[]).map((p) => PHOTOS[p].alt)]
    for (const x of all) for (const text of [x.es, x.en]) expect(text).not.toMatch(/[–—]/)
  })

  it('el recorrido del producto usa capturas que existen, sin repetir', () => {
    const shots = LANDING.tour.screens.map((s) => s.shot)
    expect(new Set(shots).size).toBe(shots.length)
    for (const s of shots) expect(SHOTS).toContain(s)
    expect(shots.length).toBeGreaterThanOrEqual(6)
  })

  it('cada paso del "así se usa" tiene su apoyo visual', () => {
    for (const tr of Object.keys(INTRO) as Track[]) {
      for (const h of INTRO[tr].how) {
        if ('shot' in h.visual) expect(SHOTS, tr).toContain(h.visual.shot)
        else expect(['log', 'readonly'], tr).toContain(h.visual.art)
      }
    }
  })

  it('las gráficas de la entrada se presentan como ejemplo y sus cifras son porcentajes o conteos pequeños', () => {
    const n = LANDING.numbers
    expect(n.badge.es).toBe('Ejemplo')
    expect(n.badge.en).toBe('Example')
    expect(n.note.es).toMatch(/ejemplo/i)
    for (const t of n.response.teams) {
      expect(t.first).toBeLessThanOrEqual(100)
      expect(t.reached).toBeLessThanOrEqual(t.first) // contacto logrado nunca supera al primer intento: son los mismos leads
    }
    for (const r of n.rings) expect(r.value).toBeLessThanOrEqual(100)
    const values = n.funnel.stages.map((s) => s.value)
    expect([...values].sort((a, b) => b - a)).toEqual(values) // un embudo baja de etapa en etapa
  })

  it('la demo usa comercios inventados y las mismas palabras que el producto', () => {
    const es = JSON.parse(readFileSync(join(process.cwd(), 'src', 'messages', 'es.json'), 'utf8')) as Record<string, string>
    const d = LANDING.demo
    expect(d.items.length).toBe(4)
    expect(d.results.map((r) => r.es)).toEqual([es['complete.result.reached'], es['complete.result.no_answer'], es['complete.result.later']])
    expect(d.nexts.map((r) => r.es)).toEqual([es['complete.next.call'], es['complete.next.proposal'], es['complete.next.meeting']])
    expect(d.result.es).toBe(es['complete.result'])
    expect(d.next.es).toBe(es['complete.next'])
    expect(d.save.es).toBe(es['complete.save'])
  })

  it('la entrada no promete lo que todavía no existe', () => {
    // Programa "los 95": lo externo está construido y apagado, y se dice así; lo que no existe todavía, aparte.
    const soon = LANDING.status.rows.filter((r) => r.state === 'soon').map((r) => r.label.es).join(' ')
    expect(soon).toMatch(/Sales App/)
    expect(soon).toMatch(/archivo diario de ventas/)
    expect(soon).toMatch(/correo/)
    expect(soon).toMatch(/WhatsApp/)
    expect(soon).toMatch(/IA/)
    expect(LANDING.status.soon.es).toBe('Construido y apagado')
    const later = LANDING.status.rows.filter((r) => r.state === 'later').map((r) => r.label.es).join(' ')
    expect(later).toMatch(/sin conexión/)
    expect(LANDING.status.later.es).toBe('Todavía no')
    expect(LANDING.status.text.es).toMatch(/sign-off escrito de Dan Mulligan o Michael Essiet/)
    const ribbon = LANDING.ribbon.items.map((x) => x.es).join(' ')
    expect(ribbon).not.toMatch(/Sales App|S5|export|sin conexión/i)
  })
})
