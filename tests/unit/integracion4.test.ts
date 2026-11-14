import { describe, expect, it } from 'vitest'
import { marketTime, ownTime, workday, zoneName, zoneNote } from '@/lib/format'
import { zoneLabel } from '@/lib/audit'
import { territoryFor } from '@/lib/territory'
import { ROLE_LABEL } from '@/domain/policy'

// Ola 4, integración: reglas puras que cerró el integrador (zona con nombre, territorio al convertir, día hábil por defecto).
const US = { timezone: 'America/New_York', name: 'United States' }
const MX = { timezone: 'America/Mexico_City', name: 'México' }
const at = new Date('2026-11-12T16:00:00Z') // 11:00 en el Este, 10:00 en Ciudad de México, 12:00 en Puerto Rico

describe('la zona horaria se dice con nombre', () => {
  it('US corre en hora del Este: "Eastern" y "hora del Este", nunca "United States time"', () => {
    expect(zoneName(US.timezone, 'en', US.name)).toBe('Eastern')
    expect(zoneName(US.timezone, 'es', US.name)).toBe('hora del Este')
    expect(marketTime(at, 'en', US)).toBe('Nov 12, 11:00 AM Eastern')
    expect(marketTime(at, 'es', US)).toMatch(/^12 nov, 11:00 a\. ?m\., hora del Este$/)
    expect(marketTime(at, 'en', US)).not.toContain('United States')
    expect(zoneNote(US, 'en')).toBe('Times are in Eastern time.')
    expect(zoneNote(US, 'es')).toBe('Las horas están en hora del Este.')
  })

  it('un mercado sin zona con nombre propio se dice por su nombre', () => {
    expect(marketTime(at, 'es', MX)).toMatch(/hora de México$/)
    expect(zoneNote(MX, 'en')).toBe('Times are in México time.')
  })

  it('con el navegador en otra zona, la hora local va entre paréntesis; en la misma hora, no', () => {
    expect(marketTime(at, 'en', US, 'America/Mexico_City')).toBe('Nov 12, 11:00 AM Eastern (10:00 AM your time)')
    expect(marketTime(at, 'es', US, 'America/Puerto_Rico')).toMatch(/hora del Este \(12:00 p\. ?m\. tu hora\)$/)
    expect(marketTime(at, 'en', US, 'America/New_York')).toBe('Nov 12, 11:00 AM Eastern')
    expect(ownTime(at, 'en', US.timezone, 'America/Toronto')).toBe('')
    // si en la zona de quien lee ya es otro día, la hora local lleva su fecha
    expect(ownTime(new Date('2026-11-13T03:30:00Z'), 'en', US.timezone, 'Europe/Madrid')).toBe('Nov 13, 4:30 AM your time')
  })

  it('la bitácora, Estado y Adopción dicen la zona que usan, con su nombre cuando lo tiene', () => {
    expect(zoneLabel('America/New_York', 'en', at)).toBe('Eastern time (GMT-5)')
    expect(zoneLabel('America/New_York', 'es', at)).toBe('hora del Este (GMT-5)')
    expect(zoneLabel('America/Puerto_Rico', 'es', at)).toBe('hora de Puerto Rico (GMT-4)')
  })
})

describe('territorio de un lead convertido', () => {
  const gdl = { id: 'g', code: 'GDL', name: 'Guadalajara' }
  const norte = { id: 'n', code: 'CDMX-N', name: 'CDMX Norte' }
  const sur = { id: 's', code: 'CDMX-S', name: 'CDMX Sur' }
  const mty = { id: 'm', code: 'MTY', name: 'Monterrey' }
  const all = [gdl, norte, sur, mty]

  it('con un solo territorio es ese, diga lo que diga la ciudad', () => {
    expect(territoryFor([mty], all, null)).toEqual({ id: 'm', ask: false })
    expect(territoryFor([mty], all, 'Guadalajara')).toEqual({ id: 'm', ask: false })
  })

  it('con dos, lo decide la ciudad del lead; si no alcanza, se pregunta', () => {
    expect(territoryFor([gdl, norte], all, 'Guadalajara, Jal.')).toEqual({ id: 'g', ask: false })
    expect(territoryFor([gdl, norte], all, 'cdmx')).toEqual({ id: 'n', ask: false })
    expect(territoryFor([gdl, norte], all, null)).toEqual({ id: null, ask: true })
    expect(territoryFor([gdl, norte], all, 'Puebla')).toEqual({ id: null, ask: true })
    expect(territoryFor([norte, sur], all, 'CDMX')).toEqual({ id: null, ask: true })
  })

  it('sin territorios propios se busca en los del mercado y nunca se pregunta', () => {
    expect(territoryFor([], all, 'Monterrey')).toEqual({ id: 'm', ask: false })
    expect(territoryFor([], all, 'Puebla')).toEqual({ id: null, ask: false })
  })
})

describe('próximo paso por defecto y nombres de rol', () => {
  it('el día por defecto no cae en sábado ni en domingo, según los días hábiles del mercado', () => {
    expect(workday('2026-11-13')).toBe('2026-11-13') // viernes
    expect(workday('2026-11-14')).toBe('2026-11-16') // sábado pasa a lunes
    expect(workday('2026-11-15')).toBe('2026-11-16') // domingo pasa a lunes
    expect(workday('2026-11-14', [1, 2, 3, 4, 5, 6])).toBe('2026-11-14') // un mercado que trabaja el sábado
  })

  it('el rol de administración se lee "Administration" en inglés', () => {
    expect(ROLE_LABEL.admin).toEqual({ es: 'Administración', en: 'Administration' })
  })
})
