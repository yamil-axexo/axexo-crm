// Lector de CSV (RFC 4180): comillas, comillas dobles escapadas, saltos de línea dentro de una celda, BOM y separador
// coma o punto y coma (Excel en español exporta con punto y coma). Todo en memoria: el archivo nunca se guarda.
export type CsvTable = { headers: string[]; rows: string[][]; delimiter: ',' | ';' }

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => {
    let n = 0
    let quoted = false
    for (const c of firstLine) {
      if (c === '"') quoted = !quoted
      else if (c === ch && !quoted) n++
    }
    return n
  }
  const delimiter: ',' | ';' = count(';') > count(',') ? ';' : ','
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    out.push(row)
  }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ''))
  const headers = (nonEmpty[0] ?? []).map((h) => h.trim())
  return { headers, rows: nonEmpty.slice(1).map((r) => r.map((c) => c.trim())), delimiter }
}
