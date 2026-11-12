import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo de soporte sin tipos
import { sourcePairs, catalogs, pairsIn } from '../support/vocab-extract.mjs'
// @ts-expect-error módulo de soporte sin tipos
import { checkEs, checkEn, prose } from '../support/vocab-rules.mjs'

/**
 * Cuida la redacción de lo que la persona lee: los catálogos de mensajes y los pares español/inglés del código
 * (t('…', '…'), ['…', '…'], { es, en }, invalid('…', '…')). El glosario con el porqué está en docs/glosario.md.
 * La guía, la ayuda, la bienvenida y la entrada tienen su propia prueba (guide.test.ts) y las lleva otro paquete.
 */
const OTHER_PACKAGE = ['src/content/guide', 'src/ui/help', 'src/app/login/page', 'src/app/(app)/ayuda', 'src/app/(app)/bienvenida']

type Pair = { file: string; line: number; es: string; en: string }
const pairs: Pair[] = sourcePairs(OTHER_PACKAGE)
const { es, en } = catalogs() as { es: Record<string, string>; en: Record<string, string> }

// Nombres propios que sí llevan acento en un texto en inglés: personas y lugares de ejemplo, y el nombre de un idioma.
const EN_ALLOW = ['Español', 'México', 'Peña', 'Lucía', 'Iván', 'Ríos', 'Méndez', 'Torreón', 'Yucatán', 'Querétaro', 'León', 'Mérida']

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
    expect(pairs.length).toBeGreaterThan(1500)
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
    const hits = all.filter((x) => /\btimeline\b|\bsales motion\b|\bLT panel\b|\bSupervision\b|\bfunnel\b/i.test(x.text)).map((x) => `${x.where}: ${x.text}`)
    expect(hits).toEqual([])
  })
})

describe('vocabulario: el idioma del documento sigue a la persona', () => {
  it('el layout raíz toma el idioma del contexto con sesión', () => {
    const layout = readFileSync(new URL('../../src/app/layout.tsx', import.meta.url), 'utf8')
    expect(layout).toMatch(/getCtx\(\)/)
    expect(layout).toMatch(/ctx\?\.locale \?\? \(await publicLocale\(\)\)/)
  })
})
