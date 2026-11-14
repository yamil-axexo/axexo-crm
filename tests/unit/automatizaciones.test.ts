import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULTS, EVENTS, FIELDS, OPS_FOR, TEMPLATES, describe as say, problemIn, type Definition } from '@/domain/automation/catalog'
import { moveMessage } from '@/lib/steps'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('AUT-01: los registros de negocio solo se escriben desde la capa de dominio', () => {
  // Fuera de src/domain solo se escriben tablas técnicas: uso, primer ingreso, corridas de tareas y su turno.
  const TECHNICAL = new Set(['usage_events', 'user_onboarding', 'job_runs', 'settings'])
  it('ninguna pantalla, lectura ni ruta escribe una tabla de negocio con SQL propio', () => {
    const found: string[] = []
    for (const path of files('src')) {
      if (path.startsWith('src/domain/')) continue
      const text = readFileSync(path, 'utf8')
      for (const m of text.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+crm\.([a-z_]+)/gi)) if (!TECHNICAL.has(m[1]!)) found.push(`${path}: ${m[0]}`)
    }
    expect(found).toEqual([])
  })
  it('el motor de automatizaciones no mueve etapas, no asigna leads ni marca campos con SQL propio: llama a la función de dominio', () => {
    const engine = readFileSync('src/domain/automation/engine.ts', 'utf8')
    expect(engine).not.toMatch(/update\s+crm\.(deals|leads|accounts)\b/i)
    for (const fn of ['moveDealTx(', 'assignLeadTx(', 'setWaitingOnTx(', 'assertNoProhibited(']) expect(engine, fn).toContain(fn)
  })
})

describe('AUT-03: el vocabulario de las automatizaciones', () => {
  const all: Definition[] = [...DEFAULTS, ...TEMPLATES]
  it('las reglas de base y las plantillas son definiciones válidas, con nombre en los dos idiomas y claves únicas', () => {
    expect(new Set(all.map((d) => d.key)).size).toBe(all.length)
    for (const d of all) {
      expect(problemIn(d), d.key).toBeNull()
      expect(d.name.es.length, d.key).toBeGreaterThan(5)
      expect(d.name.en.length, d.key).toBeGreaterThan(5)
      expect(d.name.es, d.key).not.toBe(d.name.en)
      expect(`${d.name.es}${d.name.en}`, d.key).not.toMatch(/[—–]/)
    }
    expect(DEFAULTS.map((d) => d.key)).toEqual(['lead_sla', 'revisit_due', 'activation_risk', 'no_next_step', 'stalled_deal', 'stalled_ops', 'reactivation', 'unowned_account', 'duplicate_suspect',
      // embudo2 (ACT-02): leads contactados y comercios en alta sin tarea siguiente.
      'lead_no_next_step', 'onboarding_no_next_step'])
  })
  it('cada definición se lee como "cuando, si, entonces" en español y en inglés, sin códigos a la vista', () => {
    for (const d of all) {
      const text = say(d)
      const parts = [text.when, ...text.ifs, ...text.then]
      for (const p of parts) {
        expect(p.es.length, d.key).toBeGreaterThan(3)
        expect(p.en.length, d.key).toBeGreaterThan(3)
        expect(`${p.es} ${p.en}`, d.key).not.toMatch(/[—–]|\b(is_true|is_false|open_exception|create_task|stage_kind|awaiting_txn)\b/)
      }
      expect(text.ifs).toHaveLength(d.conditions.length)
      expect(text.then).toHaveLength(d.actions.length)
    }
  })
  it('rechaza lo que el motor no sabe hacer', () => {
    const base = DEFAULTS.find((d) => d.key === 'stalled_deal')!
    expect(problemIn({ ...base, conditions: [{ field: 'salario', op: 'gt', value: 1 }] })).not.toBeNull()
    expect(problemIn({ ...base, conditions: [{ field: 'paused', op: 'gt', value: 1 }] })).not.toBeNull()
    expect(problemIn({ ...base, conditions: [{ field: 'stage_code', op: 'eq', value: 'no_existe' }] }, ['alta'])).not.toBeNull()
    expect(problemIn({ ...base, conditions: [{ field: 'stage_code', op: 'eq', value: 'alta' }] }, ['alta'])).toBeNull()
    expect(problemIn({ ...base, actions: [] })).not.toBeNull()
    expect(problemIn({ ...base, actions: [{ type: 'move_stage', stage_code: 'alta' }] }, ['visitada'])).not.toBeNull()
    expect(problemIn({ ...base, source: 'lead', conditions: [], actions: [{ type: 'move_stage', stage_code: 'alta' }] })).not.toBeNull()
    expect(problemIn({ ...base, trigger: { kind: 'event', event: 'lead.created' } })).not.toBeNull() // evento de otro tipo de registro
    expect(problemIn({ ...base, trigger: { kind: 'event', event: 'deal.created' } })).not.toBeNull() // un aviso de la cola no va con evento
    expect(problemIn({ ...base, actions: [{ type: 'notify', to: 'todo el mundo' as 'owner', text_es: 'Revisar', text_en: 'Review' }] })).not.toBeNull()
    for (const [source, list] of Object.entries(FIELDS)) for (const f of list) expect(OPS_FOR[f.type].length, `${source}.${f.key}`).toBeGreaterThan(0)
    for (const e of Object.values(EVENTS)) expect(FIELDS[e.source]).toBeDefined()
  })
  it('el mensaje de un movimiento dice si quedó esperando aprobación', () => {
    expect(moveMessage({ status: 'moved' }, ['Etapa actualizada.', 'Stage updated.'])).toEqual(['Etapa actualizada.', 'Stage updated.'])
    const [es, en] = moveMessage({ status: 'pending', approver: 'Supervisión' }, ['Etapa actualizada.', 'Stage updated.'])
    expect(es).toContain('Queda esperando la aprobación de Supervisión')
    expect(en).toContain('Waiting for approval from Supervisión')
  })
})
