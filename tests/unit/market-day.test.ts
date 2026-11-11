import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// "Hoy" es el día de calendario del mercado (DATA-04), no el del servidor, que corre en UTC y cambia de día
// a las 18:00 de Ciudad de México. Esta prueba cierra la clase completa: ninguna regla ni pantalla vuelve a
// calcular el día con `current_date` o cortando una fecha ISO.
const ALLOWED: Record<string, string> = {
  'src/server/db.ts': 'define marketToday y explica por qué',
  'src/lib/format.ts': 'addDays suma días sobre un mediodía UTC fijo: no depende de la hora',
  'src/app/(app)/admin/actions.ts': 'simulador de staging: ocupa el lugar de un sistema externo que manda su propia fecha',
}
const PATTERNS = [/\bcurrent_date\b/i, /toISOString\(\)\s*\.slice\(0,\s*10\)/, /toISOString\(\)\s*\.substring\(0,\s*10\)/, /toISOString\(\)\s*\.split\('T'\)/]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('el día de hoy se calcula en la zona del mercado', () => {
  it('ningún archivo de src usa el día del servidor', () => {
    const found = files('src')
      .filter((path) => !(path in ALLOWED))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, i) => (PATTERNS.some((p) => p.test(line)) ? [`${path}:${i + 1}`] : [])),
      )
    expect(found).toEqual([])
  })
})
