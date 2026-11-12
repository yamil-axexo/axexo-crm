import { describe, expect, it } from 'vitest'
import { HELP, HELP_TOPICS, INTRO, LANDING, STEPS, TRACK_LABEL, trackOf, type L, type Track } from '@/content/guide'

const TRACKS = Object.keys(TRACK_LABEL) as Track[]
const texts: [string, L][] = []
const add = (where: string, x: L) => texts.push([where, x])
for (const tr of TRACKS) {
  add(`label:${tr}`, TRACK_LABEL[tr])
  add(`intro:${tr}`, INTRO[tr].lead)
  for (const h of INTRO[tr].how) { add(`how:${tr}`, h.title); add(`how:${tr}`, h.text) }
  for (const s of STEPS[tr]) { add(`step:${s.key}`, s.title); add(`step:${s.key}`, s.why); add(`step:${s.key}`, s.cta) }
}
for (const h of HELP) { add(`help:${h.id}`, h.q); add(`help:${h.id}`, h.a) }
for (const k of Object.keys(HELP_TOPICS) as (keyof typeof HELP_TOPICS)[]) add(`topic:${k}`, HELP_TOPICS[k])
JSON.stringify(LANDING, (_k, v) => { if (v && typeof v === 'object' && typeof v.es === 'string' && typeof v.en === 'string') add('landing', v as L); return v })

describe('guía: entrada, primer ingreso y ayuda', () => {
  it('cada rol tiene su recorrido, con pasos de clave única y enlace dentro de la app', () => {
    for (const tr of TRACKS) {
      const keys = STEPS[tr].map((s) => s.key)
      expect(keys.length, tr).toBeGreaterThanOrEqual(4)
      expect(new Set(keys).size, tr).toBe(keys.length)
      for (const s of STEPS[tr]) expect(s.href, s.key).toMatch(/^\/[a-z]/)
      expect(INTRO[tr].how.length, tr).toBeGreaterThanOrEqual(3)
    }
  })

  it('el recorrido es el del rol con más alcance', () => {
    expect(trackOf([{ role: 'rep' }])).toBe('rep')
    expect(trackOf([{ role: 'rep' }, { role: 'supervisor' }])).toBe('supervisor')
    expect(trackOf([{ role: 'ops' }, { role: 'ops' }])).toBe('ops')
    expect(trackOf([{ role: 'lt' }])).toBe('lt')
    expect(trackOf([{ role: 'lt' }, { role: 'admin' }])).toBe('admin')
    expect(trackOf([])).toBe('rep')
  })

  it('la ayuda no repite preguntas, cada una tiene tema, y las de la entrada existen', () => {
    const ids = HELP.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const h of HELP) expect(HELP_TOPICS[h.topic], h.id).toBeTruthy()
    for (const id of LANDING.faq.ids) expect(ids, id).toContain(id)
    for (const tr of TRACKS) expect(HELP.filter((h) => h.tracks === 'all' || h.tracks.includes(tr)).length, tr).toBeGreaterThanOrEqual(15)
  })

  it('todo texto está en español y en inglés, sin guiones largos y con la marca bien escrita', () => {
    for (const [where, x] of texts) {
      for (const text of [x.es, x.en]) {
        expect(text.trim().length, where).toBeGreaterThan(0)
        expect(text, where).not.toMatch(/[\u2013\u2014]/)
        expect(text, where).not.toMatch(/Axexo|AXEXO|Contigo\b/)
      }
      expect(x.es, where).not.toMatch(/\b(vos|tenés|podés|querés|hacé)\b/i)
    }
  })
})
