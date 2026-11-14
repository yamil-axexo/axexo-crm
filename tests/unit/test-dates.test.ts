import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Ola 6: varias pruebas usaban la fecha de UTC como "hoy" y fallaban de noche (desde las 20:00 en México ya es mañana en UTC).
// Las fechas relativas a hoy en tests/db salen de marketDay() (tests/db/helpers.ts), en la zona del mercado.
describe('pruebas de base: "hoy" en la zona del mercado', () => {
  it('ningún archivo de tests/db arma la fecha de hoy con toISOString', () => {
    const dir = 'tests/db'
    const hits = readdirSync(dir).filter((f) => f.endsWith('.ts')).flatMap((f) =>
      readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => ({ f, i: i + 1, l }))
        .filter(({ l }) => /(new Date\(\)|Date\.now\(\))[^;]*\.toISOString\(\)\.slice\(0, 10\)/.test(l)).map(({ f, i, l }) => `${f}:${i}: ${l.trim()}`))
    expect(hits).toEqual([])
  })
})
