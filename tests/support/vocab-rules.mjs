// Reglas de redacción de CONTIGO que una prueba puede cuidar sola. La lista completa (y el porqué) está en docs/glosario.md.

/** Palabras que no van en un texto en español a la vista. "Lead" se queda: es el término del equipo. */
// Palabra completa, contando las letras con acento como letras ("Repártelo" no es "rep").
const word = (source, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, flags)

export const ES_FORBIDDEN = [
  ['deal', word('deals?')],
  ['pipeline', word('pipelines?')],
  ['timeline', word('timeline')],
  ['lead time', word('lead time')],
  ['stage', word('stages?')],
  ['owner', word('owners?')],
  ['S5', word('S5', 'u')],
  ['motor', word('motor(es)?')],
  ['rep', word('reps?')],
  ['handoff', word('hand-?offs?')],
  ['dashboard', word('dashboards?')],
  ['SLA', word('SLAs?', 'u')],
  ['desktop', word('desktop')],
  ['outbox', word('outbox')],
  ['PDV', word('PDV', 'u')],
  ['exitosamente', word('exitosamente')],
  ['por favor ten en cuenta', /por favor,? ten en cuenta/i],
  ['código interno', word('web_form|first_tx|sales_app|market_lead|territory_manager|field_rep|crm\\.[a-z_]+', 'u')],
  ['voseo', word('tenés|querés|podés|hacé|mirá|elegí|completá|agregá|revisá|tocá')],
]

/** Palabras del español que delatan un resto sin traducir en un texto en inglés. */
export const EN_SPANISH_WORDS = word('el|los|las|del|una|para|por|con|sin|que|más|hoy|negocio|negocios|comercio|comercios|tienda|tiendas|dueño|etapa|embudo|hilo|tarea|tareas|próximo|paso|guardar|cerrar|abrir|nuevo|nueva|equipo|ventas|mercado|motivo|fecha|todos|todas')

export const LONG_DASH = /[–—]/
export const SPANISH_CHARS = /[áéíóúñü¿¡ÁÉÍÓÚÑÜ]/

/** Quita lo que no es texto para la persona: las expresiones ${…} de una plantilla y las variables {…} de un mensaje ICU. */
export function prose(text) {
  // Variables de un mensaje ICU: {name} y el encabezado de un plural ({count, plural, …). Lo que va dentro de cada caso sí es texto.
  text = text.replace(/\{\s*\w+\s*\}/g, ' ').replace(/\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/g, '{ ').replace(/(=\d+|zero|one|two|few|many|other)\s*\{/g, ' {')
  let out = ''
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '$' && text[i + 1] === '{') {
      depth++
      i++
      out += ' '
    } else if (depth > 0) {
      if (c === '{') depth++
      if (c === '}') depth--
    } else out += c
  }
  return out
}

/** Hallazgos de un texto en español. */
export function checkEs(text) {
  const p = prose(text)
  const hits = ES_FORBIDDEN.filter(([, re]) => re.test(p)).map(([name]) => name)
  if (LONG_DASH.test(p)) hits.push('guion largo')
  if (/\bAI\b/.test(p)) hits.push('AI (en español es IA)')
  if (/\bAxexo\b|\bAXEXO\b/.test(p)) hits.push('axexo va en minúscula')
  if (/\bcontigo\b/i.test(p) && /\bContigo\b/.test(p)) hits.push('CONTIGO va en mayúsculas')
  return hits
}

/** Hallazgos de un texto en inglés. `allow` son nombres propios que sí llevan acento (personas, lugares, etapas citadas). */
export function checkEn(text, allow = []) {
  let p = prose(text)
  for (const a of allow) p = p.split(a).join(' ')
  const hits = []
  if (SPANISH_CHARS.test(p)) hits.push('acentos o signos del español')
  if (LONG_DASH.test(p)) hits.push('guion largo')
  const w = EN_SPANISH_WORDS.exec(p)
  if (w) hits.push(`palabra en español: ${w[0]}`)
  if (/\bIA\b/.test(p)) hits.push('IA (en inglés es AI)')
  if (/\bAxexo\b|\bAXEXO\b/.test(p)) hits.push('axexo is lowercase')
  return hits
}
