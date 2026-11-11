import { describe, expect, it } from 'vitest'
import { messageKeys, messages } from '@/lib/messages'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

describe('mensajes ES y EN', () => {
  it('tienen exactamente las mismas claves', () => {
    const k = messageKeys()
    expect([...k.es].sort()).toEqual([...k.en].sort())
  })

  it('ningún texto queda vacío ni usa guiones largos', () => {
    for (const [locale, file] of [['es', es], ['en', en]] as const) {
      for (const [key, text] of Object.entries(file)) {
        expect(text.trim().length, `${locale}:${key}`).toBeGreaterThan(0)
        expect(/[–—]/.test(text), `${locale}:${key}`).toBe(false)
      }
    }
  })

  it('aplica plurales en los dos idiomas', () => {
    expect(messages('es')('nav.leadsWaiting', { count: 1 })).not.toEqual(messages('es')('nav.leadsWaiting', { count: 3 }))
    expect(messages('en')('nav.leadsWaiting', { count: 1 })).not.toEqual(messages('en')('nav.leadsWaiting', { count: 3 }))
  })

  // Variables de un mensaje: lo que va entre llaves al primer nivel ({count, plural, ...} o {name}).
  const vars = (text: string) => {
    const out = new Set<string>()
    let depth = 0
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) out.add(/^\s*(\w+)/.exec(text.slice(i + 1))?.[1] ?? '')
        depth++
      } else if (text[i] === '}') depth--
    }
    return [...out].sort()
  }

  it('cada clave usa las mismas variables en los dos idiomas', () => {
    for (const key of Object.keys(es) as (keyof typeof es)[]) expect(vars(en[key]), key).toEqual(vars(es[key]))
  })

  it('cada mensaje compila con el formato ICU', () => {
    for (const [locale, file] of [['es', es], ['en', en]] as const) {
      const m = messages(locale)
      for (const [key, text] of Object.entries(file)) {
        const values = Object.fromEntries(vars(text).map((v) => [v, 2]))
        expect(() => m(key as keyof typeof es, values), `${locale}:${key}`).not.toThrow()
      }
    }
  })
})
