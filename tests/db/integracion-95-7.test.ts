import { afterEach, describe, expect, it } from 'vitest'
import { CONNECTORS } from '@/server/adapters/registry'
import { gate } from '@/server/adapters/live/gate'
import { egressCheck, allowedHosts } from '@/server/net/egress'
import { channelMode } from '@/server/adapters/report-channels'
import { campo2Mode, deliverFeedbackDigest } from '@/server/adapters/campo2'
import { realtimeMode, realtimeMissing } from '@/server/adapters/realtime'
import { allProposed } from '@/dal/proposed'
import { ctxFor } from './helpers'

// Ola 7 de los 95, integración (conectores + plataforma, sobre la ola 6): una sola regla de encendido para TODO adaptador
// (también los de la ola 6 y Broadcast), un solo cliente de salida (egressFetch) para los conectores live, y los valores
// propuestos de plataforma en la lista única.
const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

describe('una sola regla de encendido', () => {
  it('los adaptadores de la ola 6 y Broadcast están en el registro con live, y sin aprobación quedan apagados', () => {
    const keys = CONNECTORS.map((c) => c.key)
    for (const k of ['report_slack', 'feedback_to_pt', 'academy_progress', 'lakehouse_crossmatch', 'realtime']) expect(keys, k).toContain(k)
    for (const c of CONNECTORS.filter((x) => ['report_slack', 'feedback_to_pt', 'academy_progress', 'lakehouse_crossmatch', 'realtime'].includes(x.key))) {
      process.env[c.gate.envVar] = 'live'
      for (const v of c.gate.credentials) process.env[v] = 'https://ejemplo.test/x'
      delete process.env[`${c.gate.envVar}_APPROVAL`]
      expect(gate(c.gate).mode, c.key).toBe('off')
      expect(gate(c.gate).missing, c.key).toEqual([`${c.gate.envVar}_APPROVAL`])
    }
    expect(channelMode('scheduled_slack')).toBe('off')
    expect(campo2Mode('feedback_to_pt')).toBe('off')
    expect(realtimeMode()).toBe('off')
  })
  it('con las tres condiciones, el modo es live (sin llamar a nada al leer el modo)', () => {
    process.env.REPORT_SLACK_ADAPTER = 'live'
    process.env.SLACK_BOT_TOKEN = 'xoxb-prueba'
    process.env.REPORT_SLACK_CHANNEL = 'C0PRUEBA'
    process.env.REPORT_SLACK_ADAPTER_APPROVAL = 'TIR-2026-11-13 (prueba)'
    expect(channelMode('scheduled_slack')).toBe('live')
    process.env.REALTIME_ADAPTER = 'live'
    process.env.SUPABASE_URL = 'https://proyecto.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave'
    expect(realtimeMissing()).toEqual(['REALTIME_ADAPTER_APPROVAL'])
  })
  it('apagado, el resumen hacia P&T queda en cola y no sale', async () => {
    expect(await deliverFeedbackDigest({ id: 'x', total: 3 })).toBe('queued_off')
  })
})

describe('un solo cliente de salida', () => {
  it('los proveedores de los conectores live están en la allowlist; un host de contrato entra solo por su variable de URL', () => {
    for (const h of ['slack.com', 'graph.facebook.com', 'www.zohoapis.com', 'api.linkedin.com', 'business-api.tiktok.com', 'challenges.cloudflare.com', 'proyecto.supabase.co']) {
      expect(egressCheck(`https://${h}/x`, 'prueba').ok, h).toBe(true)
    }
    expect(egressCheck('https://academy.ejemplo.test/v1/progress', 'academy_progress').ok).toBe(false)
    process.env.KORE_ACADEMY_URL = 'https://academy.ejemplo.test'
    expect(allowedHosts()).toContain('academy.ejemplo.test')
    expect(egressCheck('https://academy.ejemplo.test/v1/progress', 'academy_progress').ok).toBe(true)
    expect(egressCheck('http://academy.ejemplo.test/v1/progress', 'academy_progress').ok).toBe(false)
  })
})

describe('valores propuestos de plataforma en la lista única', () => {
  it('los pendientes de plataforma salen con su dueño junto a los de la ola 6', async () => {
    const rows = await allProposed(await ctxFor('nora.salas'))
    const platform = rows.filter((r) => r.source === 'platform')
    expect(platform.length).toBeGreaterThan(0)
    for (const r of platform) expect(r.owner.length).toBeGreaterThan(1)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
})
