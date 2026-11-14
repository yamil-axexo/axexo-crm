import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_ACTION, AUDIT_GROUPS, AUDIT_OBJECT, actionLabel, diffRows, idsIn, stamp, summary, validTimeZone, zoneLabel } from '@/lib/audit'
import { translator } from '@/lib/format'

// La bitácora muestra cada acción con su nombre en español y en inglés. Esta prueba cierra la clase completa:
// si alguien registra una acción nueva y no le pone nombre, falla aquí y no en la pantalla de quien audita.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx|sql)$/.test(name) ? [path] : []
  })
}

function actionsInCode(): { action: string; where: string }[] {
  const found: { action: string; where: string }[] = []
  for (const path of [...files('src'), ...files('db/migrations').filter((p) => p.endsWith('.up.sql'))]) {
    const text = readFileSync(path, 'utf8')
    // audit(tx, ctx, 'x.y', ...) y audit(tx, ctx, cond ? 'x.y' : 'x.z', ...)
    for (const call of text.matchAll(/\baudit\(\s*tx,\s*\w+,([^\n]*)/g)) {
      const head = call[1]!.split(/,\s*'(?:account|deal|lead|user|team|pipeline|stage|routing_rule|api_client|activity|exception|import_run|ingest_batch|integration|rules|session)'/)[0]!
      for (const lit of head.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.push({ action: lit[1]!, where: path })
      // Plantillas: `${object}.custom_updated` y `exception.${resolution}` se listan a mano abajo.
    }
    // Eventos escritos con SQL directo (sesiones en las migraciones, fin de la importación).
    for (const m of text.matchAll(/insert into crm\.audit_events[\s\S]{0,260}?'([a-z_]+\.[a-z_]+)'/g)) found.push({ action: m[1]!, where: path })
  }
  for (const action of ['account.custom_updated', 'deal.custom_updated', 'exception.scheduled', 'exception.dismissed']) found.push({ action, where: 'plantilla' })
  return found
}

describe('bitácora: nombres de las acciones', () => {
  it('toda acción que el código registra tiene nombre en español y en inglés', () => {
    const found = actionsInCode()
    expect(found.length).toBeGreaterThan(40)
    const missing = found.filter((f) => !AUDIT_ACTION[f.action]).map((f) => `${f.action} (${f.where})`)
    expect([...new Set(missing)]).toEqual([])
  })

  it('las plantillas de acción siguen siendo las dos que la prueba conoce', () => {
    const templates = files('src').flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/\baudit\(\s*tx,\s*\w+,\s*`([^`]+)`/g)].map((m) => m[1]!))
    expect(templates.sort()).toEqual(['${object}.custom_updated', 'exception.${resolution}'])
  })

  it('los dos idiomas existen, son distintos de un código y no llevan guiones largos', () => {
    for (const [action, [es, en]] of Object.entries(AUDIT_ACTION)) {
      expect(es.length, action).toBeGreaterThan(3)
      expect(en.length, action).toBeGreaterThan(3)
      expect(es, action).not.toMatch(/[—–]|^[a-z_]+\.[a-z_]+$/)
      expect(en, action).not.toMatch(/[—–]|^[a-z_]+\.[a-z_]+$/)
    }
    for (const pair of [...Object.values(AUDIT_OBJECT), ...Object.values(AUDIT_GROUPS).map((g) => g.label)]) expect(pair.join('')).not.toMatch(/[—–]/)
  })

  it('cada acción cae en algún tipo del filtro', () => {
    const like = (pattern: string, action: string) => (pattern.endsWith('%') ? action.startsWith(pattern.slice(0, -1)) : action === pattern)
    const groups = Object.entries(AUDIT_GROUPS).filter(([k]) => k !== '' && k !== 'all')
    for (const action of Object.keys(AUDIT_ACTION)) {
      expect(groups.filter(([, g]) => g.like!.some((p) => like(p, action))).map(([k]) => k), action).toHaveLength(1)
    }
  })

  it('una acción que no conoce se muestra con su código, no vacía', () => {
    expect(actionLabel(translator('es'), 'algo.nuevo')).toBe('algo.nuevo')
    expect(actionLabel(translator('es'), 'membership.ended')).toBe('Quitó un acceso')
    expect(actionLabel(translator('en'), 'membership.ended')).toBe('Removed access')
  })
})

describe('bitácora: el antes y el después en palabras', () => {
  const es = translator('es')
  const en = translator('en')
  const U = '01a1cd48-0000-7000-8000-000000000001'
  const S1 = '01a1cd48-0000-7000-8000-000000000002'
  const S2 = '01a1cd48-0000-7000-8000-000000000003'
  const names = { [U]: 'Marco Peña', [S1]: 'Propuesta', [S2]: 'Negociación' }

  it('cambia identificadores por nombres y códigos por palabras', () => {
    const rows = diffRows(es, 'es', { owner_id: null, status: 'new', role: 'rep' }, { owner_id: U, status: 'contacted', role: 'rep' }, names)
    expect(rows).toEqual([
      { key: 'owner_id', label: 'Quién lo lleva', before: 'nada', after: 'Marco Peña' },
      { key: 'status', label: 'Estado', before: 'Nuevo', after: 'Contactado' },
    ]) // lo que no cambió (el rol) no se repite
    expect(diffRows(en, 'en', { stage_id: S1 }, { stage_id: S2 }, names)).toEqual([{ key: 'stage_id', label: 'Stage', before: 'Propuesta', after: 'Negociación' }])
  })

  it('una etapa editada se lee completa', () => {
    const rows = diffRows(es, 'es', { name_es: 'Proposal', rot_days: 14, required_fields: ['amount'] }, { name_es: 'Propuesta', rot_days: 0, required_fields: ['amount', 'decision_maker'] }, {})
    expect(rows.map((r) => `${r.label}: ${r.before} → ${r.after}`)).toEqual([
      'Nombre en español: Proposal → Propuesta',
      'Se estanca a los: 14 días → nunca',
      'Pide para entrar: monto esperado → monto esperado, quien decide, identificado y contactado',
    ])
  })

  it('un identificador que quien lee no puede resolver no se muestra crudo', () => {
    const row = diffRows(es, 'es', null, { owner_id: '01a1cd48-0000-7000-8000-00000000ffff' }, {})[0]!
    expect(row.after).toBe('un registro que ya no puedes ver')
    expect(row.before).toBeNull()
  })

  it('resume un acceso en una línea', () => {
    expect(summary(es, 'es', 'membership.granted', null, { role: 'admin', market: null, team_id: null, expires: '2026-11-30' }, {})).toBe('Administración · vence el 30 nov 2026')
    expect(summary(es, 'es', 'membership.ended', { role: 'rep', market: 'US', team_id: null }, { removed_from_rules: ['Web US dealers'] }, {})).toBe('Ventas · US · salió de: Web US dealers')
    expect(summary(en, 'en', 'membership.expiry_changed', { role: 'rep', expires: '2026-11-30' }, { role: 'rep', expires: null }, {})).toBe('Sales · no longer expires')
    expect(summary(es, 'es', 'deal.stage_changed', { stage_id: S1 }, { stage_id: S2 }, names)).toBe('de Propuesta a Negociación')
    expect(summary(es, 'es', 'rules.evaluated', null, { opened: 1, closed: 2 }, {})).toBe('1 avisos nuevos, 2 resueltos solos')
  })

  it('junta todos los identificadores de un evento para buscarlos de una vez', () => {
    expect([...idsIn({ a: U, b: [S1, 'texto'], c: { d: S2 }, e: 5, f: null })].sort()).toEqual([U, S1, S2].sort())
  })
})

describe('bitácora: la hora de quien lee', () => {
  const at = new Date('2026-11-12T01:02:15Z') // el caso del comité: 9:02 p.m. del 11-nov en Puerto Rico

  it('muestra la hora en la zona de quien lee, no en UTC', () => {
    expect(stamp(at, 'es', 'America/Puerto_Rico')).toMatch(/^11 nov 2026, 9:02:15\sp\.\s?m\.$/)
    expect(stamp(at, 'en', 'America/Puerto_Rico')).toMatch(/^Nov 11, 2026, 9:02:15\sPM$/)
    expect(stamp(at, 'es', 'America/Mexico_City')).toMatch(/^11 nov 2026, 7:02:15\sp\.\s?m\.$/)
    expect(stamp(at, 'es', 'UTC')).toMatch(/^12 nov 2026, 1:02:15\sa\.\s?m\.$/)
  })

  it('escribe la zona con su nombre y su diferencia', () => {
    expect(zoneLabel('America/Puerto_Rico', 'es', at)).toBe('hora de Puerto Rico (GMT-4)')
    expect(zoneLabel('America/Mexico_City', 'en', at)).toBe('Mexico City time (GMT-6)')
    expect(zoneLabel('UTC', 'es', at)).toBe('hora UTC')
  })

  it('solo acepta zonas horarias reales: lo que manda el navegador se valida', () => {
    expect(validTimeZone('America/Puerto_Rico')).toBe(true)
    expect(validTimeZone('UTC')).toBe(true)
    for (const bad of ['', null, undefined, 'Marte/Olympus', "x'; drop table crm.users;--", 'America/Puerto_Rico\nSet-Cookie: a=b', 'a'.repeat(80)]) expect(validTimeZone(bad), String(bad)).toBe(false)
  })
})
