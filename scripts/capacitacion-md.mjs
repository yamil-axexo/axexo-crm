// Genera el plan de capacitación por rol (Markdown, en español) desde el contenido que vive en el producto.
// Lo que dice el documento es lo que la persona lee en Ayuda, sección Capacitación, y en Primeros pasos: una sola fuente.
// Uso: node --experimental-strip-types scripts/capacitacion-md.mjs > capacitacion-por-rol.md
import { readFileSync } from 'node:fs'
import { HABITS, HELP, HELP_TOPICS, STEPS, TRACK_LABEL, TRAINING } from '../src/content/guide.ts'

// Fecha del comité 2: 11-nov-2026.
const COMMITTEE = '11-nov-2026'
const TRACKS = ['rep', 'supervisor', 'lead', 'ops', 'kam', 'lt', 'finance', 'admin']

/** Quién es cada rol y el formato que sugirió el comité 2. No lleva fechas ni instructores: no existen todavía. */
const WHO = {
  rep: ['Quien vende en campo y en cuentas (US Field Sales, MX D2D, MX B2B/ISO).', 'Paso a paso con un comercio o cliente real de la persona, en su idioma, y una guía de una página que pueda seguir sola.'],
  supervisor: ['Quien lleva un equipo y conserva cartera propia.', 'Conversación uno a uno, con ejemplos de su propio equipo. Conviene que valide la guía del proceso de su equipo.'],
  lead: ['Quien lidera un mercado.', 'Sesión corta en vivo con sus datos, no un recorrido de la herramienta. Lo demás, por escrito: qué se necesita y cómo afecta al campo.'],
  ops: ['Operaciones de US y de México.', 'Sobre un negocio real en sus etapas. El comité anotó que Operaciones ofreció preparar el material de ventas y operaciones: conviene darle este contenido como base.'],
  kam: ['Quien lleva cuentas clave (rol Cuentas clave, KAM).', 'El comité no definió formato para este rol [pendiente: Yamil]. Sugerencia: sobre una cuenta real de la persona, con su tablero de cuentas clave abierto.'],
  finance: ['Finanzas, en solo lectura comercial.', 'El comité no definió formato para este rol [pendiente: Yamil]. Sugerencia: recorrido corto de su reporte y de la conciliación, con un mes real.'],
  lt: ['Leadership, en solo lectura.', 'Recorrido corto dentro de la herramienta, sin deck: dónde está el panel y qué responde cada cifra.'],
  admin: ['Quien administra CONTIGO.', 'Recorrido pestaña por pestaña, con una cuenta de prueba para dar y quitar acceso.'],
}

/** Decisiones que el contenido necesita y nadie ha tomado. Cada una con quién la tiene, según el comité y los constructores. */
const PENDING = [
  ['¿Hasta cuándo se pueden consultar Pipedrive y Zoho?', 'Yamil con Piers Boucher'],
  ['En el piloto, ¿quién marca ganado a mano y con qué evidencia?', 'Steven Ascher y Piers Boucher en US; Mayra López define el criterio B2B en México'],
  ['¿Cuándo se encienden la entrada de la Sales App y el archivo diario de ventas? (construidos y apagados)', 'Dan Mulligan; Roxanna Quintero y Mauricio Fernandez para el contrato y el archivo'],
  ['¿Una sola bóveda de documentos con Sales Core, y con qué retención? (la bóveda está construida y apagada)', 'Comité; Dan Mulligan o Michael Essiet para el sign-off'],
  ['¿Cuándo deja Operaciones su Excel de onboarding y Zoho?', 'Piers Boucher'],
  ['¿Quién aprueba un campo, una etapa o un motivo nuevo, y con qué formato se pide?', 'Yamil con Nicole Tirado'],
  ['¿Cuándo entra El Salvador?', 'Yamil y Nicole Tirado'],
  ['¿Con qué tasa y de qué fuente se consolida a dólares? (la pantalla para cargarla ya existe)', 'Finanzas define la fuente'],
  ['¿Qué se hace con la base de negocios cerrados para mailing? (la pausa ya existe como "En pausa")', 'Mayra López y Yamil'],
  ['El texto de consentimiento del formulario web, ¿ya lo validó Legal?', 'Legal'],
  ['¿Quién atiende lo que llega a la pestaña Problemas reportados y en cuánto tiempo? (el plazo se carga en Avisos y plantillas, Por mercado)', 'Yamil con Nicole Tirado'],
  ['Quien vende puede pasar sus leads a un compañero (quedó activo por defecto). ¿Se queda así?', 'Yamil con Steven Ascher'],
  ['Horario hábil real de cada mercado y feriados (quedó lunes a viernes de 9:00 a 18:00, sin feriados)', 'quien lidera cada mercado'],
  ['Nombres reales de proveedores y documentos requeridos por mercado (hoy hay genéricos)', 'Piers Boucher'],
  ['Lista final de motivos de pérdida y etapas definitivas del embudo de cadenas y distribuidores', 'Mayra López'],
  ['Motivos de pérdida de campo', 'Carlos Alvarado en México; Sal Zavaleta con Piers Boucher en US'],
]

const cell = (x) => x.replace(/\|/g, '/').replace(/\n/g, ' ')
const out = []
const p = (...lines) => out.push(...lines)

p('# CONTIGO · Plan de capacitación por rol', '')
p(`Fuente: comité 2 (${COMMITTEE}) y el contenido que ya vive en el producto (\`src/content/guide.ts\`). Este documento se genera desde ese archivo con \`scripts/capacitacion-md.mjs\`: lo que dice aquí es lo que la persona lee en Ayuda, sección Capacitación, y en Primeros pasos.`, '')
p('Cómo leerlo: por rol, los temas del día uno y de la primera semana, en orden; los primeros pasos y a qué pantalla llevan; los hábitos que se le piden; y las preguntas que va a hacer cada perfil con su respuesta corta. Cada respuesta se revisó contra la pantalla del producto con las siete olas del programa "los 95" integradas (14-nov-2026), y cada nombre entre comillas existe tal cual en el producto (lo vigila `tests/unit/vocabulario.test.ts`).', '')
p('Lo que este plan no trae: fechas, duración ni nombres de quien imparte. No existen todavía [pendiente: Yamil define calendario y responsables].', '')
p('Regla del piloto, igual para todos y con las palabras del producto: en el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola. Aplica a los tres embudos de primera transacción. Se marca con la fecha real de cierre, y lo que pasó por Operaciones lo marca Operaciones.', '')
p('Dónde empieza cada rol al entrar: Ventas, Supervisión y Cuentas clave en Hoy; Operaciones en su cola; quien lidera el mercado en Mi equipo; Leadership en el Panel del LT; Finanzas en su reporte de Finanzas; Administración en Administración.', '')
p('Hábitos mínimos que se le piden a quien vende:', '1. Próximo paso siempre.', '2. Registrar la visita el mismo día.', '3. Primer intento a tiempo con cada lead nuevo.', '')

for (const tr of TRACKS) {
  const own = HELP.filter((h) => h.tracks !== 'all' && h.tracks.includes(tr))
  p('', `## ${TRACK_LABEL[tr].es}`, '', WHO[tr][0], '', `Formato sugerido por el comité: ${WHO[tr][1]}`, '')
  p('### El día uno', ...TRAINING[tr].day1.map((x, n) => `${n + 1}. ${x.es}`), '')
  p('### La primera semana', ...TRAINING[tr].week1.map((x, n) => `${n + 1}. ${x.es}`), '')
  p(`### Primeros pasos en el producto (${STEPS[tr].length})`, ...STEPS[tr].map((s, n) => `${n + 1}. ${s.title.es} (\`${s.href}\`)`), '')
  p('### Lo que cambia frente a Pipedrive', ...HABITS[tr].changes.map((x) => `- ${x.es}`), '')
  p('### Lo que se le pide', ...HABITS[tr].asks.map((x, n) => `${n + 1}. ${x.es}`), '')
  p(`### Preguntas que va a hacer y su respuesta corta (${own.length})`, '', '| Tema | Pregunta | Respuesta corta |', '|---|---|---|')
  p(...own.map((h) => `| ${HELP_TOPICS[h.topic].es} | ${cell(h.q.es)} | ${cell(h.a.es)} |`), '')
}

const all = HELP.filter((h) => h.tracks === 'all')
p('', `## Preguntas de todos los roles (${all.length})`, '', '| Tema | Pregunta | Respuesta corta |', '|---|---|---|')
p(...all.map((h) => `| ${HELP_TOPICS[h.topic].es} | ${cell(h.q.es)} | ${cell(h.a.es)} |`), '')

p('', '## Decisiones que el contenido necesita y nadie ha tomado', '')
p('No se escribieron como respuesta en la Ayuda porque dependen de una decisión. Cada una con quién la tiene, según el comité y quienes construyeron cada función.', '')
p('| Pregunta o decisión | Quién la tiene |', '|---|---|', ...PENDING.map(([q, who]) => `| ${q} | [pendiente: ${who}] |`), '')
// Construido y apagado: sale de docs/adapters.md (el anexo del sign-off), la misma tabla que lee Estado de CONTIGO.
const adapters = readFileSync(new URL('../docs/adapters.md', import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Conector') && !l.startsWith('|---'))
p('', '## Construido y apagado', '')
p('Cada conexión hacia afuera está construida completa y no manda nada mientras esté apagada. Se enciende con tres cosas a la vez: su variable en "live", las credenciales del proveedor (en la plataforma, nunca en el repositorio) y la referencia del sign-off escrito de Dan Mulligan o Michael Essiet. Fuente: `docs/adapters.md` y Estado de CONTIGO, Conectores. Los valores propuestos, con quién decide cada uno y dónde se cambia, están en Estado de CONTIGO, "Valores propuestos", y en Ayuda, "Construido y apagado".', '')
p('| Conector | Qué falta y quién lo enciende |', '|---|---|', ...adapters.map((l) => { const c = l.split(' | '); return `| ${c[0].replace(/^\| /, '').replace(/ \(`[^`]+`\)$/, '')} | ${c[c.length - 1].replace(/ \|$/, '')} |` }), '')
p('Lo que entró en la pasada final: pedidos y cola de Operaciones, negocios cerrados y exportar, reporte semanal de campo, adopción, tasa de cambio, tipo de cuenta, jerarquía y etapas de cadenas y distribuidores, conversión de leads, horario hábil y "En pausa". Programa "los 95" (olas 1 a 7): automatizaciones, avisos y preferencias, anuncios, eventos y API, importar y exportar, reportes guardados y programados, vistas guardadas y colas, metas, datos (duplicados, fusión, árbol, contactos compartidos), embudo (requisitos, cierre por venta real, revisita, motivos, ruteo, atribución), alta y ficha de US, México, campo y canales, ciclo de vida y cuidado del comercio, seguridad, mercados, gobierno, partners y contratos, Asistencia (la IA está apagada) y los roles Finanzas y Cuentas clave.', '')

process.stdout.write(out.join('\n'))
