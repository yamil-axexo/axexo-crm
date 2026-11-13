/**
 * IA-04 / IA-07: el marco de agentes. Un agente es una lista cerrada de herramientas estrechas y tipadas, un nivel máximo de
 * autonomía y lo que lee. Hoy hay uno solo y no usa modelo: el de reglas que propone la siguiente acción (IA-02).
 *
 * Regla dura (la "tríada"): ningún agente combina texto no confiable con una herramienta que escribe o manda algo hacia afuera.
 * Quien lee texto de fuera solo puede proponer; quien actúa solo lee datos de CONTIGO. `assertSafeAgent` lo revisa y una prueba
 * recorre todos los agentes.
 */
type Pair = [es: string, en: string]

export const LEVELS = ['off', 'suggest', 'draft', 'execute'] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_LABEL: Record<Level, { name: Pair; what: Pair }> = {
  off: { name: ['Apagado', 'Off'], what: ['No propone nada en este mercado.', 'Proposes nothing in this market.'] },
  suggest: { name: ['Sugiere', 'Suggests'], what: ['Muestra sugerencias con su porqué; la persona decide qué hacer.', 'Shows suggestions with their reason; the person decides what to do.'] },
  draft: { name: ['Redacta borradores', 'Drafts'], what: ['Además deja un borrador de tarea que la persona revisa, completa y aprueba.', 'Also leaves a task draft that the person reviews, completes and approves.'] },
  execute: { name: ['Ejecuta con aprobación', 'Executes with approval'], what: ['Propone la tarea completa, con fecha; se crea solo cuando alguien la aprueba.', 'Proposes the complete task, with a date; it is created only when someone approves it.'] },
}

export type ToolName = 'create_task'
export type Tool = { name: ToolName; writes: boolean; outbound: boolean }
export const TOOLS: Record<ToolName, Tool> = {
  // Crea una tarea dentro de CONTIGO para el dueño de la cuenta. Escribe, pero no manda nada hacia afuera.
  create_task: { name: 'create_task', writes: true, outbound: false },
}

export type Agent = {
  key: 'rules_next_action'
  name: Pair
  usesModel: boolean
  /** Lee texto escrito fuera de CONTIGO (formularios, WhatsApp, notas de partners). */
  readsUntrusted: boolean
  tools: ToolName[]
  maxLevel: Level
}

export const AGENTS: Agent[] = [
  {
    key: 'rules_next_action',
    name: ['Siguiente acción por reglas', 'Next action by rules'],
    usesModel: false,
    // Lee días sin contacto, etapa del comercio y el archivo de ventas: datos de CONTIGO, no texto libre.
    readsUntrusted: false,
    tools: ['create_task'],
    maxLevel: 'execute',
  },
]

export class UnsafeAgent extends Error {}

export function assertSafeAgent(a: Agent): void {
  const acts = a.tools.some((t) => TOOLS[t].writes || TOOLS[t].outbound)
  if (a.readsUntrusted && acts) throw new UnsafeAgent(`${a.key}: reads untrusted text and has a tool that writes or sends`)
  if (a.tools.some((t) => TOOLS[t].outbound)) throw new UnsafeAgent(`${a.key}: no agent sends anything outside CONTIGO`)
  if (a.usesModel && a.maxLevel === 'execute') throw new UnsafeAgent(`${a.key}: a model-backed agent cannot propose complete actions before it passes its evaluation`)
}

/** El nivel que de verdad aplica: el del mercado, sin pasar del máximo del agente. */
export function effectiveLevel(market: Level, agent: Agent): Level {
  return LEVELS.indexOf(market) <= LEVELS.indexOf(agent.maxLevel) ? market : agent.maxLevel
}
