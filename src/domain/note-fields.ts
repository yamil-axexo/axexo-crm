/**
 * E12.F3: lo que en el teléfono no tiene campo se escribe en la nota de la visita, un dato por renglón como
 * "Nombre del campo: valor", y CONTIGO lo pasa al campo que corresponde. Función pura: no toca la base.
 * Un renglón que no coincide con un campo, o cuyo valor no es válido para ese campo, se queda en la nota tal cual.
 */
export type NoteFieldDef = { key: string; label_es: string; label_en: string; data_type: string; options: string[] }
export type NoteExtraction = { values: Record<string, string | string[]>; moved: { key: string; label_es: string; label_en: string }[]; rest: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const YES = ['yes', 'y', 'si', 'true']
const NO = ['no', 'n', 'false']

function coerce(def: NoteFieldDef, raw: string): string | string[] | null {
  const value = raw.trim()
  if (!value) return null
  const option = (v: string) => def.options.find((o) => norm(o) === norm(v)) ?? null
  switch (def.data_type) {
    case 'select':
      return option(value)
    case 'multiselect': {
      const whole = option(value)
      if (whole) return [whole]
      const parts = value.split(/[,;]|\s+(?:y|and)\s+/i).map((p) => p.trim()).filter(Boolean)
      const picked = parts.map(option)
      return parts.length > 0 && picked.every(Boolean) ? [...new Set(picked as string[])] : null
    }
    case 'number': {
      const n = value.replace(/[$,\s]/g, '')
      return /^-?\d+(\.\d+)?$/.test(n) ? n : null
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
    case 'boolean':
      return YES.includes(norm(value)) ? 'true' : NO.includes(norm(value)) ? 'false' : null
    case 'text':
    case 'long_text':
      return value
    default:
      return null
  }
}

export function extractNoteFields(note: string | null | undefined, defs: NoteFieldDef[]): NoteExtraction {
  const out: NoteExtraction = { values: {}, moved: [], rest: '' }
  if (!note) return out
  const byLabel = new Map<string, NoteFieldDef>()
  for (const d of defs) for (const l of [d.label_es, d.label_en]) if (!byLabel.has(norm(l))) byLabel.set(norm(l), d)
  const keep: string[] = []
  for (const line of note.split(/\r?\n/)) {
    const m = /^\s*([^:]{2,80}):\s*(.+)$/.exec(line)
    const def = m ? byLabel.get(norm(m[1]!)) : undefined
    const value = def && !(def.key in out.values) ? coerce(def, m![2]!) : null
    if (def && value !== null) {
      out.values[def.key] = value
      out.moved.push({ key: def.key, label_es: def.label_es, label_en: def.label_en })
    } else keep.push(line)
  }
  out.rest = keep.join('\n').trim()
  return out
}

/** El propósito escrito en la nota ("Purpose: Training", "Motivo de la visita: Capacitación") cuando no se eligió de la lista. */
export function purposeFromNote(note: string | null | undefined, reasons: { code: string; label_es: string; label_en: string }[]): { code: string; rest: string } | null {
  if (!note) return null
  const lines = note.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(reason for visit|visit reason|purpose|proposito|proposito de la visita|motivo|motivo de la visita)\s*:\s*(.+)$/i.exec(lines[i]!.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    if (!m) continue
    const hit = reasons.find((r) => norm(r.label_es) === norm(m[2]!) || norm(r.label_en) === norm(m[2]!) || r.code === norm(m[2]!).replace(/ /g, '_'))
    if (hit) return { code: hit.code, rest: lines.filter((_, j) => j !== i).join('\n').trim() }
  }
  return null
}
