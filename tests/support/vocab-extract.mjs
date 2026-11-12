// Saca del código los textos que la persona lee: los pares t('español', 'english'), los pares { es: '…', en: '…' }
// y los catálogos de mensajes. Lo usan la prueba de vocabulario y quien quiera revisar la redacción de corrido.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../..', import.meta.url).pathname

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** Lee un literal de texto ('…', "…" o `…`) que empieza en i; devuelve su contenido y dónde termina, o null si ahí no hay un literal. */
function literal(src, i) {
  const q = src[i]
  if (q !== "'" && q !== '"' && q !== '`') return null
  let out = ''
  let depth = 0
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') {
      out += src[j + 1] === 'n' ? '\n' : src[j + 1]
      j++
    } else if (q === '`' && c === '$' && src[j + 1] === '{') {
      depth++
      out += '${'
      j++
    } else if (depth > 0) {
      if (c === '{') depth++
      if (c === '}') depth--
      out += c
    } else if (c === q) return { text: out, end: j + 1 }
    else out += c
  }
  return null
}

const skipSpace = (src, i) => {
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

/** Pares (es, en) de un archivo fuente, con su línea. */
export function pairsIn(src) {
  const out = []
  const push = (index, es, en) => out.push({ line: src.slice(0, index).split('\n').length, es, en })
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$])(?:t|invalid|notFound)\(/g)) {
    let i = skipSpace(src, m.index + m[0].length)
    const a = literal(src, i)
    if (!a) continue
    i = skipSpace(src, a.end)
    if (src[i] !== ',') continue
    const b = literal(src, skipSpace(src, i + 1))
    if (!b) continue
    push(m.index, a.text, b.text)
  }
  for (const m of src.matchAll(/\bes:\s*(?=['"`])/g)) {
    const a = literal(src, m.index + m[0].length)
    if (!a) continue
    let i = skipSpace(src, a.end)
    if (src[i] !== ',') continue
    i = skipSpace(src, i + 1)
    if (!src.startsWith('en:', i)) continue
    const b = literal(src, skipSpace(src, i + 3))
    if (b) push(m.index, a.text, b.text)
  }
  // Errores con código: new DomainError(código, 'español', 'english'). El código puede ser una expresión.
  for (const m of src.matchAll(/DomainError\(/g)) {
    let i = m.index + m[0].length
    for (let depth = 0; i < src.length; i++) {
      const lit = literal(src, i)
      if (lit) { i = lit.end - 1; continue }
      if (src[i] === '(') depth++
      else if (src[i] === ')') { if (depth-- === 0) break }
      else if (src[i] === ',' && depth === 0) break
    }
    if (src[i] !== ',') continue
    const a = literal(src, skipSpace(src, i + 1))
    if (!a) continue
    i = skipSpace(src, a.end)
    if (src[i] !== ',') continue
    const b = literal(src, skipSpace(src, i + 1))
    if (b) push(m.index, a.text, b.text)
  }
  // Pares sueltos ['español', 'english']: así viajan los mensajes de las acciones y las etiquetas de la bitácora.
  for (const m of src.matchAll(/\[\s*(?=['"`])/g)) {
    const a = literal(src, m.index + m[0].length)
    if (!a) continue
    let i = skipSpace(src, a.end)
    if (src[i] !== ',') continue
    const b = literal(src, skipSpace(src, i + 1))
    if (!b || src[skipSpace(src, b.end)] !== ']') continue
    // Solo frases: una lista de dos claves (['rep', 'ops']) no es un texto para la persona.
    if (!/^[A-ZÁÉÍÓÚÑ¿¡]/.test(a.text) && !/\s/.test(a.text)) continue
    if (/^[a-z_.:-]+$/.test(a.text) || /^[a-z_.:-]+$/.test(b.text)) continue
    push(m.index, a.text, b.text)
  }
  return out
}

/** Todos los pares del código de la app (src), con archivo y línea. `skip` deja fuera rutas que lleva otro paquete. */
export function sourcePairs(skip = []) {
  const out = []
  for (const file of walk(join(root, 'src'))) {
    const rel = relative(root, file)
    if (skip.some((s) => rel.startsWith(s))) continue
    for (const p of pairsIn(readFileSync(file, 'utf8'))) out.push({ file: rel, ...p })
  }
  return out
}

export function catalogs() {
  const read = (l) => JSON.parse(readFileSync(join(root, `src/messages/${l}.json`), 'utf8'))
  return { es: read('es'), en: read('en') }
}

// Uso directo: node tests/support/vocab-extract.mjs > textos.tsv
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of sourcePairs()) console.log([`${p.file}:${p.line}`, p.es.replace(/\n/g, ' '), p.en.replace(/\n/g, ' ')].join('\t'))
  const c = catalogs()
  for (const k of Object.keys(c.es)) console.log([`messages:${k}`, c.es[k], c.en[k]].join('\t'))
}
