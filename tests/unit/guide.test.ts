import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HABITS, HELP, HELP_TOPICS, INTRO, LANDING, PHOTOS, SHOT_ALT, STEPS, TRACK_LABEL, TRAINING, trackOf, type HelpTopic, type L, type Track } from '@/content/guide'
import { homePath, type Role } from '@/domain/policy'
import { screenLabel } from '@/lib/screens'
import { browserLocale } from '@/server/context'

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
for (const tr of TRACKS) {
  for (const x of [...HABITS[tr].changes, ...HABITS[tr].asks]) add(`habits:${tr}`, x)
  for (const x of [...TRAINING[tr].day1, ...TRAINING[tr].week1]) add(`training:${tr}`, x)
}
for (const k of Object.keys(SHOT_ALT) as (keyof typeof SHOT_ALT)[]) add(`shot:${k}`, SHOT_ALT[k])
for (const k of Object.keys(PHOTOS) as (keyof typeof PHOTOS)[]) add(`photo:${k}`, PHOTOS[k].alt)
for (const k of Object.keys(HELP_TOPICS) as (keyof typeof HELP_TOPICS)[]) add(`topic:${k}`, HELP_TOPICS[k])
JSON.stringify(LANDING, (_k, v) => { if (v && typeof v === 'object' && typeof v.es === 'string' && typeof v.en === 'string') add('landing', v as L); return v })

/** Las pantallas de la app con ruta fija (sin segmentos dinámicos), también las anidadas: /reportes/cerrados, /admin/operaciones. */
function staticRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('[')) continue
    const route = `${prefix}/${d.name}`
    if (existsSync(join(dir, d.name, 'page.tsx'))) out.push(route)
    out.push(...staticRoutes(join(dir, d.name), route))
  }
  return out
}

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
    expect(trackOf([{ role: 'kam' }])).toBe('kam')
    expect(trackOf([{ role: 'finance' }])).toBe('finance')
    expect(trackOf([{ role: 'finance' }, { role: 'lt' }])).toBe('lt')
  })

  it('la ayuda no repite preguntas, cada una tiene tema, y las de la entrada existen', () => {
    const ids = HELP.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const h of HELP) expect(HELP_TOPICS[h.topic], h.id).toBeTruthy()
    for (const id of LANDING.faq.ids) expect(ids, id).toContain(id)
    for (const tr of TRACKS) expect(HELP.filter((h) => h.tracks === 'all' || h.tracks.includes(tr)).length, tr).toBeGreaterThanOrEqual(15)
    for (const h of HELP) expect(h.id, h.id).toMatch(/^[a-z][a-z0-9-]+$/)
  })

  it('hay la misma cantidad de textos en español y en inglés', () => {
    const count = (lang: 'es' | 'en') => texts.filter(([, x]) => typeof x[lang] === 'string' && x[lang].trim().length > 0).length
    expect(count('es')).toBe(texts.length)
    expect(count('en')).toBe(texts.length)
    expect(texts.length).toBeGreaterThan(400)
    // una pregunta nunca queda igual en los dos idiomas (sería un texto sin traducir)
    for (const h of HELP) {
      expect(h.q.es, h.id).not.toBe(h.q.en)
      expect(h.a.es, h.id).not.toBe(h.a.en)
    }
  })

  it('el español no usa jerga interna ni anglicismos, y el inglés no trae restos en español', () => {
    for (const [where, x] of texts) {
      expect(x.es, where).not.toMatch(/\b(deals?|pipelines?|timeline|lead time|S5|motor|handoff|dashboard|feedback)\b/i)
      expect(x.en, where).not.toMatch(/[¿¡]/)
      expect(x.en, where).not.toMatch(/\b(comercios?|negocios?|embudos?|bitácora|ficha|próximo paso)\b/i)
    }
  })

  it('cada paso apunta a una pantalla que existe, y cada pestaña de Administración citada existe', () => {
    const app = join(process.cwd(), 'src/app/(app)')
    const routes = staticRoutes(app)
    const tabs = /const TABS = \[([^\]]+)\]/.exec(readFileSync(join(app, 'admin/page.tsx'), 'utf8'))![1]!.split(',').map((x) => x.trim().replace(/'/g, ''))
    expect(routes).toContain('/reportar')
    for (const tr of TRACKS) {
      for (const s of STEPS[tr]) {
        const [path, query = ''] = s.href.split('?')
        expect(routes, `${tr}:${s.key} -> ${s.href}`).toContain(path)
        const tab = new URLSearchParams(query).get('tab')
        if (path === '/admin' && tab) expect(tabs, `${tr}:${s.key}`).toContain(tab)
      }
    }
    // quien no es de administración solo recibe pasos hacia las pestañas que su rol ve
    for (const tr of ['lead', 'lt'] as Track[]) {
      for (const s of STEPS[tr]) if (s.href.startsWith('/admin')) expect(s.href, `${tr}:${s.key}`).toMatch(/tab=(embudos|auditoria)$/)
    }
    for (const tr of ['rep', 'supervisor', 'ops'] as Track[]) for (const s of STEPS[tr]) expect(s.href, `${tr}:${s.key}`).not.toMatch(/^\/(admin|panel-lt|estado)/)
    for (const s of STEPS.ops) expect(s.href, s.key).not.toMatch(/^\/(supervisor|leads)/)
  })

  it('cada rol empieza donde aterriza al entrar y recibe los pasos de lo que ya hace', () => {
    const HOME: [Track, Role][] = [['rep', 'rep'], ['supervisor', 'supervisor'], ['lead', 'market_lead'], ['ops', 'ops'], ['kam', 'kam'], ['lt', 'lt'], ['finance', 'finance'], ['admin', 'admin']]
    for (const [track, role] of HOME) {
      const home = homePath([{ role, market: role === 'admin' || role === 'lt' ? null : 'MX', teamId: null }])
      expect(STEPS[track][0]!.href.split('?')[0], track).toBe(home)
    }
    const keys = (tr: Track) => STEPS[tr].map((s) => s.key)
    for (const k of ['convert', 'visit']) expect(keys('rep'), k).toContain(k)
    for (const k of ['distribute', 'closed']) expect(keys('supervisor'), k).toContain(k)
    for (const k of ['queue', 'take', 'return', 'ops-fields']) expect(keys('ops'), k).toContain(k)
    for (const k of ['distribute', 'weekly']) expect(keys('lead'), k).toContain(k)
    for (const k of ['rotation', 'territories', 'fx', 'reports']) expect(keys('admin'), k).toContain(k)
    expect(STEPS.admin.find((s) => s.key === 'rotation')!.why.es).toMatch(/Horario hábil por mercado/)
    expect(STEPS.ops.find((s) => s.key === 'ops-fields')!.why.es).toMatch(/Merchant ID/)
  })

  it('la regla del piloto se dice con las palabras del producto, en la entrada y en los primeros pasos', () => {
    const deal = readFileSync(join(process.cwd(), 'src/app/(app)/deals/[id]/page.tsx'), 'utf8')
    expect(deal).toContain(LANDING.status.rule.es)
    expect(deal).toContain(LANDING.status.rule.en)
    expect(STEPS.admin.find((s) => s.key === 'win-rule')!.why.es).toContain(LANDING.status.rule.es)
    expect(HELP.find((h) => h.id === 'deal-won')!.a.es).toMatch(/fecha real de cierre/)
  })

  it('Administración, pestaña por pestaña: nombra todas las que existen', () => {
    const admin = readFileSync(join(process.cwd(), 'src/app/(app)/admin/page.tsx'), 'utf8')
    const block = /const labels: Record<Tab, string> = \{([\s\S]*?)\n  \}/.exec(admin)![1]!
    const names = [...block.matchAll(/t\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1]!, m[2]!] as const)
    expect(names.length).toBeGreaterThanOrEqual(8)
    const config = INTRO.admin.how.find((h) => h.visual && 'shot' in h.visual && h.visual.shot === 'admin')!
    for (const [es, en] of names) {
      expect(config.text.es, es).toContain(es)
      expect(config.text.en, en).toContain(en)
    }
    expect(config.text.es).toContain('Pipedrive')
    // la sección de Operaciones vive dentro de Administración, como una más
    expect(admin).toContain("label: t('Operaciones', 'Operations')")
    expect(config.text.es).toMatch(/Auditoría y Operaciones\.$/)
    expect(config.text.en).toMatch(/Audit and Operations\.$/)
  })

  it('cada pantalla con ruta fija tiene nombre para "Reportar un problema"', () => {
    const t = (es: string) => es
    for (const route of staticRoutes(join(process.cwd(), 'src/app/(app)'))) expect(screenLabel(t, route), route).not.toBe(route)
    expect(screenLabel(t, '/admin/operaciones')).toBe('Administración, Operaciones')
    expect(screenLabel(t, '/admin')).toBe('Administración')
    expect(screenLabel(t, '/operaciones')).toBe('Cola de Operaciones')
    expect(screenLabel(t, '/reportes/cerrados')).toBe('Negocios cerrados')
  })

  it('la ayuda cubre todos los temas, dice la regla del piloto y lo que está construido y apagado', () => {
    for (const topic of Object.keys(HELP_TOPICS) as HelpTopic[]) expect(HELP.filter((h) => h.topic === topic).length, topic).toBeGreaterThanOrEqual(3)
    const won = HELP.find((h) => h.id === 'deal-won')!
    expect(won.a.es).toMatch(/los tres embudos de primera transacción se ganan a mano/)
    expect(won.a.en).toMatch(/three first-transaction pipelines are won by hand/)
    // "Construido y apagado": cada respuesta dice qué está apagado o propuesto, qué falta y quién lo destraba
    const limits = HELP.filter((h) => h.topic === 'limits')
    expect(limits.length).toBeGreaterThanOrEqual(12)
    for (const h of limits) expect(`${h.q.es} ${h.a.es}`, h.id).toMatch(/apagad|propuest|No\b|Todavía no/)
    const said = limits.map((h) => `${h.q.es} ${h.a.es}`).join(' ')
    for (const word of [/Sales App/, /archivo (diario )?de ventas/, /sin conexión/, /fotos/, /correo/, /Slack/, /WhatsApp/, /mapa/, /app para instalar/, /sign-off escrito de Dan Mulligan o Michael Essiet/, /[Vv]alores propuestos/]) expect(said).toMatch(word)
    const saidEn = limits.map((h) => `${h.q.en} ${h.a.en}`).join(' ')
    expect(saidEn).toMatch(/written sign-off from Dan Mulligan or Michael Essiet/)
    // lo que ya hace no figura como pendiente: exportar, registrar visitas, repartir en bloque y pedidos
    for (const h of limits) expect(`${h.q.es} ${h.a.es}`, h.id).not.toMatch(/exporta|pedido|repart/i)
    // y lo que entró en la ola 2 tiene su pregunta
    const ids = HELP.map((h) => h.id)
    // y lo del programa "los 95": cada tema nuevo tiene sus preguntas
    for (const topic of ['notices', 'pipeline', 'care', 'channel', 'reports', 'files', 'us', 'mx', 'markets', 'partners', 'ai', 'automations', 'integrations', 'security', 'governance'] as HelpTopic[]) expect(HELP.filter((h) => h.topic === topic).length, topic).toBeGreaterThanOrEqual(4)
    for (const tr of ['finance', 'kam'] as Track[]) expect(HELP.filter((h) => h.tracks !== 'all' && h.tracks.includes(tr)).length, tr).toBeGreaterThanOrEqual(5)
    // la IA se dice como es: apagada, y lo que funciona es por reglas
    expect(HELP.filter((h) => h.topic === 'ai').map((h) => h.a.es).join(' ')).toMatch(/IA está apagada|está apagado/)
    for (const id of ['lead-convert', 'lead-hours', 'lead-pass', 'lead-bulk', 'deal-pause', 'deal-bulk', 'account-type', 'account-parent', 'merchant-order', 'ops-queue', 'ops-handoff', 'ops-return', 'ops-fields', 'notice-note', 'closed-deals', 'panel-how', 'fx-rate', 'adoption', 'field-report', 'role-home', 'admin-fx', 'admin-hours']) expect(ids, id).toContain(id)
    // respuestas cortas: caben en un párrafo
    for (const h of HELP) {
      expect(h.a.es.length, h.id).toBeLessThanOrEqual(700)
      expect(h.a.en.length, h.id).toBeLessThanOrEqual(700)
    }
    // reportar un problema está en la ayuda de todos
    expect(HELP.find((h) => h.id === 'report-problem')!.tracks).toBe('all')
  })

  it('cada rol tiene su capacitación en orden y sus hábitos, sin fechas ni nombres', () => {
    for (const tr of TRACKS) {
      expect(TRAINING[tr].day1.length, tr).toBeGreaterThanOrEqual(3)
      expect(TRAINING[tr].week1.length, tr).toBeGreaterThanOrEqual(3)
      expect(HABITS[tr].changes.length, tr).toBeGreaterThanOrEqual(2)
      expect(HABITS[tr].asks.length, tr).toBeGreaterThanOrEqual(2)
      for (const x of [...TRAINING[tr].day1, ...TRAINING[tr].week1, ...HABITS[tr].changes, ...HABITS[tr].asks]) {
        // ni fechas ni horas: no hay calendario de capacitación todavía
        expect(x.es, tr).not.toMatch(/\b(20\d\d|lunes|martes|miércoles|jueves|viernes|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i)
        expect(x.es, tr).not.toMatch(/\d{1,2}:\d{2}/)
      }
    }
    // los tres hábitos mínimos de quien vende
    const asks = HABITS.rep.asks.map((x) => x.es).join(' ')
    expect(asks).toMatch(/Próximo paso siempre/)
    expect(asks).toMatch(/visita/)
    expect(asks).toMatch(/Primer intento a tiempo/)
  })

  it('la entrada abre en el idioma del navegador: inglés si es el primero que pide, español en lo demás', () => {
    expect(browserLocale('en-US,en;q=0.9,es;q=0.8')).toBe('en')
    expect(browserLocale('en')).toBe('en')
    expect(browserLocale('es-MX,es;q=0.9,en;q=0.8')).toBe('es')
    expect(browserLocale('es-US,es;q=0.9,en-US;q=0.8')).toBe('es')
    expect(browserLocale('pt-BR,pt;q=0.9,en;q=0.8')).toBe('es')
    expect(browserLocale('es;q=0.5, en-US;q=0.9')).toBe('en')
    expect(browserLocale('*')).toBe('es')
    expect(browserLocale('')).toBe('es')
    expect(browserLocale(null)).toBe('es')
    expect(browserLocale(undefined)).toBe('es')
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
