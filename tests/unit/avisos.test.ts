import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { HELP } from '@/content/guide'
import { SCREEN_HELP, screenHelpFor } from '@/content/screen-help'
import { CHANNEL_LABEL, DELIVERY_STATUS, KIND_KEYS, NOTICE_KINDS, TEMPLATE_INFO, TEMPLATE_VARS, isPendingText, renderTemplate, wants } from '@/lib/notice-kinds'
import { TOPIC_LABEL } from '@/domain/announcements'

describe('ayuda contextual: cada pantalla apunta a preguntas que existen', () => {
  it('todas las preguntas enlazadas están en la Ayuda y ninguna pantalla queda sin pregunta', () => {
    const ids = new Set(HELP.map((h) => h.id))
    for (const s of SCREEN_HELP) {
      expect(s.ids.length).toBeGreaterThan(0)
      for (const id of s.ids) expect(ids.has(id), `${s.prefix}: ${id}`).toBe(true)
    }
    expect(screenHelpFor('/deals/0190-abc')?.prefix).toBe('/deals')
    expect(screenHelpFor('/hoy')?.prefix).toBe('/hoy')
    expect(screenHelpFor('/login')).toBeNull()
  })
})

describe('avisos: textos y reglas', () => {
  it('cada tipo, canal, estado, tema y plantilla tiene nombre en los dos idiomas, sin guiones largos', () => {
    const pairs: [string, string][] = [
      ...KIND_KEYS.flatMap((k) => [NOTICE_KINDS[k].label, NOTICE_KINDS[k].hint] as [string, string][]),
      ...Object.values(CHANNEL_LABEL), ...Object.values(DELIVERY_STATUS), ...Object.values(TOPIC_LABEL),
      ...Object.values(TEMPLATE_INFO).flatMap((x) => [x.name, x.to, x.when]),
    ]
    for (const [es, en] of pairs) {
      expect(es.length).toBeGreaterThan(1)
      expect(en.length).toBeGreaterThan(1)
      expect(es + en).not.toMatch(/[—–]/)
    }
  })

  it('las plantillas iniciales de la migración solo usan variables conocidas y la bienvenida de México queda pendiente', () => {
    const sql = readFileSync('db/migrations/0020_avisos.up.sql', 'utf8')
    const used = [...sql.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]!)
    expect(used.length).toBeGreaterThan(10)
    for (const v of used) expect(TEMPLATE_VARS as readonly string[]).toContain(v)
    expect(sql).toContain("('lead_welcome', 'MX', 1, 'lead', 'lead.created', true,\n   '[pendiente: quien administra CONTIGO]'")
    for (const key of [...sql.matchAll(/^\s*\('([a-z_]+)', (?:null|'MX'), 1,/gm)].map((m) => m[1]!)) expect(TEMPLATE_INFO[key], key).toBeTruthy()
    expect(isPendingText('[pendiente: quien administra CONTIGO]')).toBe(true)
    expect(isPendingText('Hola, gracias por escribir.')).toBe(false)
    expect(renderTemplate('{{titulo}} {{no_existe}}', { titulo: 'Hola' })).toBe('Hola ')
  })

  it('lo obligatorio no se apaga dentro de CONTIGO y los canales de afuera respetan la elección', () => {
    for (const k of KIND_KEYS) if (NOTICE_KINDS[k].locked) expect(wants({ [k]: { in_app: false } }, k, 'in_app')).toBe(true)
    expect(wants({ deal_won: { in_app: false } }, 'deal_won', 'in_app')).toBe(false)
    expect(wants({}, 'mention', 'email')).toBe(false)
    expect(wants({ mention: { email: true } }, 'mention', 'email')).toBe(true)
  })
})
