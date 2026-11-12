import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo de soporte sin tipos
import { sourcePairs, catalogs, pairsIn } from '../support/vocab-extract.mjs'
// @ts-expect-error módulo de soporte sin tipos
import { checkEs, checkEn, prose, LONG_DASH } from '../support/vocab-rules.mjs'
import { noData, noDataLabel } from '@/lib/no-data'

/**
 * Cuida la redacción de lo que la persona lee: los catálogos de mensajes y los pares español/inglés del código
 * (t('…', '…'), ['…', '…'], { es, en }, invalid('…', '…')), incluida la guía (ayuda, primeros pasos, capacitación y entrada).
 * El glosario con el porqué está en docs/glosario.md. Un solo vocabulario: lo que dice la ayuda es lo que dice la pantalla.
 */
type Pair = { file: string; line: number; es: string; en: string }
const pairs: Pair[] = sourcePairs()
const GUIDE = ['src/content/guide', 'src/ui/help', 'src/app/login/page', 'src/app/(app)/ayuda', 'src/app/(app)/bienvenida']
const inGuide = (p: Pair) => GUIDE.some((g) => p.file.startsWith(g))
const guide = pairs.filter(inGuide)
const product = pairs.filter((p) => !inGuide(p))
const { es, en } = catalogs() as { es: Record<string, string>; en: Record<string, string> }
const root = new URL('../..', import.meta.url).pathname

// Nombres propios que sí llevan acento en un texto en inglés: personas y lugares de ejemplo, y el nombre de un idioma.
const EN_ALLOW = ['Español', 'México', 'Peña', 'Lucía', 'Iván', 'Ríos', 'Méndez', 'Torreón', 'Yucatán', 'Querétaro', 'León', 'Mérida']

/** Archivos de una carpeta, recursivo. */
function files(dir: string, match = /\.(ts|tsx)$/, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) files(p, match, out)
    else if (match.test(e.name)) out.push(p)
  }
  return out
}

describe('vocabulario: el extractor encuentra los textos', () => {
  it('lee pares de t(), de listas, de { es, en } y de errores', () => {
    const found = pairsIn(`
      t('Negocio', 'Deal'); ctx.t(\`Hola \${name}\`, \`Hi \${name}\`)
      const x = { es: 'Etapa', en: 'Stage' }
      return { message: ['Guardado en el hilo.', 'Saved to the thread.'] }
      throw invalid('Falta la fecha.', 'The date is missing.')
      const roles = ['rep', 'ops']
    `) as { es: string; en: string }[]
    expect(found.map((p) => p.es).sort()).toEqual(['Etapa', 'Falta la fecha.', 'Guardado en el hilo.', 'Hola ${name}', 'Negocio'])
    expect(prose('Pasa a ${stage.name_es} hoy')).not.toContain('stage')
    expect(prose('{count, plural, one {# lead} other {# leads}} en {stage}')).not.toMatch(/count|stage|plural/)
  })

  it('la app tiene textos en el código y en los catálogos', () => {
    expect(product.length).toBeGreaterThan(1500)
    expect(guide.length).toBeGreaterThan(600)
    expect(Object.keys(es).length).toBeGreaterThan(200)
  })
})

describe('vocabulario: las reglas detectan lo que no va', () => {
  it('español: jerga, códigos, guiones largos y AI', () => {
    for (const bad of ['Tu deal avanzó', 'El pipeline de MX', 'Mira el timeline', 'Cambia el stage', 'Sin owner', 'Ventas según S5', 'Elige el motor', 'El rep lo toma', 'Handoff a Operaciones', 'Abre el dashboard', 'Fuera del SLA', 'Llegó por web_form', 'Guardado — listo', 'Resumen con AI', 'Guardado exitosamente'])
      expect(checkEs(bad), bad).not.toEqual([])
    for (const ok of ['Repártelo por región', 'Lead sin atender a tiempo', 'Se gana con la primera transacción', 'Resumen con IA', 'El negocio pasó de etapa'])
      expect(checkEs(ok), ok).toEqual([])
  })

  it('inglés: acentos, signos y palabras del español', () => {
    for (const bad of ['Próximo step', 'Save the negocio', '¿Ready?', 'No owner – yet', 'Summary by IA', 'Open the comercio']) expect(checkEn(bad), bad).not.toEqual([])
    for (const ok of ['Next step', 'Save the deal', 'Reassign to Lucía Vega', 'AI summary']) expect(checkEn(ok, EN_ALLOW), ok).toEqual([])
  })
})

describe('vocabulario: textos en español', () => {
  it('los catálogos no usan palabras prohibidas ni guiones largos', () => {
    const hits = Object.entries(es).flatMap(([key, text]) => checkEs(text).map((h: string) => `${key}: ${h} → ${text}`))
    expect(hits).toEqual([])
  })

  it('los textos del código no usan palabras prohibidas ni guiones largos', () => {
    const hits = pairs.flatMap((p) => checkEs(p.es).map((h: string) => `${p.file}:${p.line}: ${h} → ${p.es}`))
    expect(hits).toEqual([])
  })

  it('"dueño" es solo el del comercio: quien lleva la cuenta en axexo es "quién lo lleva"', () => {
    const own = (text: string) => /dueñ[oa]s?/i.test(prose(text)) && !/dueñ[oa]s? del comercio|el dueño nunca está|esté el dueño/i.test(prose(text))
    const hits = [...pairs.filter((p) => own(p.es)).map((p) => `${p.file}:${p.line}: ${p.es}`), ...Object.entries(es).filter(([, text]) => own(text)).map(([k, text]) => `${k}: ${text}`)]
    expect(hits).toEqual([])
  })
})

describe('vocabulario: textos en inglés', () => {
  it('los catálogos no traen acentos, signos ni palabras del español', () => {
    const hits = Object.entries(en).flatMap(([key, text]) => checkEn(text, EN_ALLOW).map((h: string) => `${key}: ${h} → ${text}`))
    expect(hits).toEqual([])
  })

  it('los textos del código no traen acentos, signos ni palabras del español', () => {
    const hits = pairs.flatMap((p) => checkEn(p.en, EN_ALLOW).map((h: string) => `${p.file}:${p.line}: ${h} → ${p.en}`))
    expect(hits).toEqual([])
  })

  it('un mismo nombre para lo mismo: Thread, Sale type, Leadership panel, My team', () => {
    const all = [...pairs.map((p) => ({ where: `${p.file}:${p.line}`, text: prose(p.en) })), ...Object.entries(en).map(([k, text]) => ({ where: k, text: prose(text) }))]
    const hits = all.filter((x) => /\btimeline\b|\bsales motion\b|\bLT panel\b|\bSupervision\b|\bfunnel\b|\bpoints? of sale\b|\bAdmin (panel|screen|tab)\b/i.test(x.text)).map((x) => `${x.where}: ${x.text}`)
    expect(hits).toEqual([])
  })
})

describe('vocabulario: la guía habla como la pantalla', () => {
  // Nombres de botones y pantallas que ya no existen (docs/glosario.md, columna "No usar"): ni la ayuda ni un mensaje pueden citarlos.
  const GONE_ES = /reasignar dueño|sin dueño|dueño sin acceso|cola de excepciones|evaluar reglas|sin rol de ventas/i
  const GONE_EN = /reassign owner|exception queue|evaluate rules|owner without access|no sales role/i

  it('nadie cita un botón o una pantalla con un nombre que ya no existe', () => {
    const hits = [
      ...pairs.filter((p) => GONE_ES.test(prose(p.es)) || GONE_EN.test(prose(p.en))).map((p) => `${p.file}:${p.line}: ${p.es} / ${p.en}`),
      ...Object.keys(es).filter((k) => GONE_ES.test(es[k]!) || GONE_EN.test(en[k]!)).map((k) => `${k}: ${es[k]} / ${en[k]}`),
    ]
    expect(hits).toEqual([])
  })

  it('"Supervisión" es un rol, no una pantalla: la pantalla se llama Mi equipo', () => {
    const asScreen = /(abre|abrir|entra a|ve a|ir a|en|pantalla de|menú de) "Supervisión"|"Supervisión" (abre|muestra|lista)/i
    expect(guide.filter((p) => asScreen.test(p.es)).map((p) => `${p.file}:${p.line}: ${p.es}`)).toEqual([])
    expect(guide.filter((p) => /"Supervision"|"Supervisor" (screen|page|tab)/.test(p.en)).map((p) => `${p.file}:${p.line}: ${p.en}`)).toEqual([])
  })

  it('cada nombre que la guía pone entre comillas existe tal cual en el producto, en su idioma', () => {
    // El producto: los textos del código fuera de la guía, los catálogos, y los catálogos sembrados (etapas, embudos, motivos).
    const sql = [...readdirSync(join(root, 'db/migrations')).map((f) => join(root, 'db/migrations', f)), join(root, 'db/seed/seed.sql')].map((f) => readFileSync(f, 'utf8')).join('\n')
    const jsx = files(join(root, 'src')).filter((f) => !GUIDE.some((g) => relative(root, f).startsWith(g))).map((f) => readFileSync(f, 'utf8')).join('\n')
    const corpus = { es: [...product.map((p) => p.es), ...Object.values(es), sql, jsx].join('\n'), en: [...product.map((p) => p.en), ...Object.values(en), sql, jsx].join('\n') }
    const missing: string[] = []
    let checked = 0
    for (const p of guide.filter((x) => x.file.startsWith('src/content/guide')))
      for (const l of ['es', 'en'] as const)
        for (const m of p[l].matchAll(/"([^"]+)"/g)) {
          const name = m[1]!.replace(/[.,:;]$/, '')
          checked++
          if (!corpus[l].includes(name)) missing.push(`${p.file}:${p.line} (${l}): "${name}"`)
        }
    expect(checked).toBeGreaterThan(300)
    expect(missing).toEqual([])
  })
})

describe('vocabulario: sin guiones largos, tampoco como marca de "sin dato"', () => {
  // Un valor vacío se pinta "s/d" (español) o "n/a" (inglés), con su explicación "Sin dato" / "No data".
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

  it('el código de src no trae — ni – fuera de los comentarios', () => {
    const hits: string[] = []
    for (const f of files(join(root, 'src'), /\.(ts|tsx|css|json)$/)) {
      code(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        if (LONG_DASH.test(line)) hits.push(`${relative(root, f)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('los catálogos sembrados que se ven en pantalla tampoco', () => {
    const hits: string[] = []
    for (const f of [...readdirSync(join(root, 'db/migrations')).map((x) => join(root, 'db/migrations', x)), join(root, 'db/seed/seed.sql')])
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (LONG_DASH.test(line.replace(/--.*$/, ''))) hits.push(`${relative(root, f)}:${i + 1}`)
      })
    expect(hits).toEqual([])
  })

  it('la marca de sin dato es "s/d" y "n/a", y el componente la explica', () => {
    expect([noData('es'), noData('en'), noDataLabel('es'), noDataLabel('en')]).toEqual(['s/d', 'n/a', 'Sin dato', 'No data'])
    const kit = readFileSync(join(root, 'src/ui/kit.tsx'), 'utf8')
    expect(kit).toMatch(/title=\{noDataLabel\(locale\)\} aria-label=\{noDataLabel\(locale\)\}/)
    expect(checkEs(`Volumen: ${noData('es')}`)).toEqual([])
    expect(checkEn(`Volume: ${noData('en')}`)).toEqual([])
  })
})

describe('vocabulario: el idioma del documento sigue a la persona', () => {
  it('el layout raíz toma el idioma del contexto con sesión', () => {
    const layout = readFileSync(new URL('../../src/app/layout.tsx', import.meta.url), 'utf8')
    expect(layout).toMatch(/getCtx\(\)/)
    expect(layout).toMatch(/ctx\?\.locale \?\? \(await publicLocale\(\)\)/)
  })
})
