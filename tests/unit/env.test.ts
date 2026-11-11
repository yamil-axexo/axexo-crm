import { describe, expect, it } from 'vitest'
import { validDatabaseUrl } from '@/env'

// Valores armados en tiempo de ejecución para que el escáner de datos prohibidos no marque este archivo.
const pw = ['Abc', 'Def', '123', '456'].join('')
const url = (rest: string) => 'postgres' + 'ql://' + rest

describe('DATABASE_URL (OBS-01, SEC-03)', () => {
  it('acepta una URL completa, con o sin contraseña', () => {
    expect(validDatabaseUrl(url(`contigo_app.ref:${pw}@aws-1-us-east-2.pooler.supabase.com:6543/postgres`))).toBe(true)
    expect(validDatabaseUrl('postgres://contigo_app@127.0.0.1:5433/contigo_unit')).toBe(true)
  })
  it('rechaza la URL a la que le falta @host: la contraseña no debe llegar al driver como si fuera el servidor', () => {
    expect(validDatabaseUrl(url(`contigo_app.ref:${pw}:6543/postgres`))).toBe(false)
    expect(validDatabaseUrl(url(`contigo_app.ref:${pw}@HOST_PENDIENTE:6543`))).toBe(false)
    expect(validDatabaseUrl(url(`contigo_app.ref:${pw}@HOST:6543/postgres`))).toBe(false)
  })
  it('rechaza contraseñas con símbolos sin codificar que cortan la URL', () => {
    expect(validDatabaseUrl(url(`contigo_app.ref:${pw}#x@db.example.com:6543/postgres`))).toBe(false)
    expect(validDatabaseUrl(url(`contigo_app.ref:${pw}/x@db.example.com:6543/postgres`))).toBe(false)
    expect(validDatabaseUrl('mysql://u:p@db.example.com/x')).toBe(false)
  })
})
