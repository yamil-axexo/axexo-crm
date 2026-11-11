import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo de scripts sin tipos
import { scanText } from '../../scripts/scan-prohibited.mjs'

const rules = (t: string): string[] => (scanText(t) as { rule: string }[]).map((h) => h.rule)
// Valores armados en tiempo de ejecución para que este archivo no dispare el propio escáner.
const card = ['4111', '1111', '1111', '1111'].join(' ')
const ssn = ['078', '05', '1120'].join('-')

describe('escáner de datos prohibidos (SEC-08)', () => {
  it('detecta tarjetas válidas por Luhn y deja pasar teléfonos y folios', () => {
    expect(rules(`tarjeta ${card}`)).toContain('card_number')
    expect(rules('tel +525512345678 folio 1234567890123')).not.toContain('card_number')
    expect(rules('0000 0000 0000 0000')).not.toContain('card_number')
  })
  it('detecta SSN, llaves privadas, llaves de AWS y cadenas de conexión con contraseña', () => {
    expect(rules(`ssn ${ssn}`)).toContain('us_ssn')
    expect(rules('-----BEGIN ' + 'PRIVATE KEY-----')).toContain('private_key')
    expect(rules('AKIA' + 'IOSFODNN7EXAMPLE')).toContain('aws_access_key')
    expect(rules('postgres://app:' + 'S3cretPassw0rd' + '@db.example.com:5432/x')).toContain('connection_string_with_password')
    expect(rules('postgres://contigo_app@127.0.0.1:5433/contigo_dev')).toEqual([])
  })
  it('un texto normal de CRM no dispara nada', () => {
    expect(rules('Se habló con el encargado; pidió la hoja de productos. Volver el 12 de noviembre.')).toEqual([])
  })
})
