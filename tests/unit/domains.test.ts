import { describe, expect, it } from 'vitest'
import { domainList, emailInDomains, parseDomains, validDomain } from '@/lib/domains'

const ORG = parseDomains('axexo.com, EMIDA.com ,emida.net,,axexo.com')

describe('dominios que pueden entrar (AUTHZ-01)', () => {
  it('la lista se limpia: sin espacios, en minúsculas y sin repetidos', () => {
    expect(ORG).toEqual(['axexo.com', 'emida.com', 'emida.net'])
    expect(ORG.every(validDomain)).toBe(true)
    expect(validDomain('axexo')).toBe(false)
    expect(validDomain('*.com')).toBe(false)
  })

  it('entra quien tiene correo de un dominio de la lista, sin importar mayúsculas', () => {
    for (const email of ['persona@axexo.com', 'persona@emida.com', 'Persona@EMIDA.NET']) expect(emailInDomains(email, ORG), email).toBe(true)
  })

  it('no entra un dominio parecido, un subdominio, ni un dominio fuera de la lista', () => {
    for (const email of ['persona@noaxexo.com', 'persona@axexo.com.otro.com', 'persona@mail.axexo.com', 'persona@gmail.com', 'persona@empowerretailers.com', 'axexo.com', '@axexo.com', 'a@b@otro.com']) {
      expect(emailInDomains(email, ORG), email).toBe(false)
    }
  })

  it('la lista se lee como frase', () => {
    expect(domainList(ORG, 'o')).toBe('axexo.com, emida.com o emida.net')
    expect(domainList(['axexo.com'], 'o')).toBe('axexo.com')
  })
})
