import 'server-only'
import { createHash } from 'node:crypto'
import type { ApiResource } from '@/domain/api-spec'

/**
 * AUT-04, "entornos de prueba": una llave de prueba (ctg_test_...) nunca toca las tablas del negocio. Lee este juego de
 * datos sintéticos, generado en memoria y siempre igual para un mercado: nombres genéricos e inventados, sin personas.
 * Sirve para que otro sistema pruebe paginación, filtros, permisos y límites en cualquier ambiente, también en producción,
 * sin ver un solo dato real.
 */
const uid = (seed: string) => {
  const h = createHash('sha256').update(`contigo-sandbox:${seed}`).digest('hex')
  return `00000000-${h.slice(0, 4)}-7${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`
}
const at = (n: number) => new Date(Date.UTC(2026, 0, 5 + n, 15, 0, 0)).toISOString()
const NAMES = ['Abarrotes Ejemplo', 'Miscelánea Muestra', 'Tienda Prueba', 'Farmacia Demo', 'Papelería Modelo', 'Ferretería Ensayo']
const LIFECYCLES = ['prospect', 'onboarding', 'active', 'active', 'at_risk', 'inactive']

export function sandboxRows(resource: ApiResource['name'], market: string): Record<string, unknown>[] {
  const currency = market === 'MX' ? 'MXN' : 'USD'
  const accounts = Array.from({ length: 12 }, (_, i) => ({
    id: uid(`${market}:account:${i}`), market, kind: i % 6 === 0 ? 'chain' : 'store', account_type: null, name: `${NAMES[i % NAMES.length]} ${String(i + 1).padStart(2, '0')}`,
    segment: 'd2d', lifecycle: LIFECYCLES[i % LIFECYCLES.length], parent_id: null, owner_id: uid(`${market}:user:${i % 3}`), territory_id: null,
    locality: 'Ciudad Ejemplo', region: 'Estado Ejemplo', merchant_ref: i % 2 === 0 ? `TEST-${market}-${1000 + i}` : null, created_at: at(i), updated_at: at(i + 20),
  }))
  if (resource === 'accounts') return accounts
  if (resource === 'deals') {
    return Array.from({ length: 9 }, (_, i) => ({
      id: uid(`${market}:deal:${i}`), market, account_id: accounts[i]!.id, pipeline_id: uid(`${market}:pipeline`), stage_id: uid(`${market}:stage:${i % 4}`), owner_id: accounts[i]!.owner_id,
      status: i % 3 === 0 ? 'won' : i % 3 === 1 ? 'open' : 'lost', amount_minor: (i + 1) * 150000, currency, loss_reason_code: i % 3 === 2 ? 'no_interest' : null,
      next_step_due: i % 3 === 1 ? at(i + 40).slice(0, 10) : null, won_at: i % 3 === 0 ? at(i + 30) : null, lost_at: i % 3 === 2 ? at(i + 30) : null,
      closed_by: i % 3 === 0 ? 'transaction' : i % 3 === 2 ? 'manual' : null, created_at: at(i + 5), updated_at: at(i + 30),
    }))
  }
  if (resource === 'leads') {
    return Array.from({ length: 8 }, (_, i) => ({
      id: uid(`${market}:lead:${i}`), market, source: i % 2 === 0 ? 'web_form' : 'manual', motor: 'd2d', status: ['new', 'contacted', 'qualified', 'converted'][i % 4],
      business_name: `${NAMES[(i + 2) % NAMES.length]} ${String(i + 21).padStart(2, '0')}`, locality: 'Ciudad Ejemplo', owner_id: uid(`${market}:user:${i % 3}`),
      sla_due_at: at(i + 10), first_touch_at: i % 4 === 0 ? null : at(i + 10), untrusted: i % 2 === 0, created_at: at(i + 9), updated_at: at(i + 12),
    }))
  }
  return Array.from({ length: 10 }, (_, i) => ({
    id: uid(`${market}:activity:${i}`), market, account_id: accounts[i % 12]!.id, deal_id: null, lead_id: null, kind: ['call', 'meeting', 'task', 'note', 'visit'][i % 5],
    due_at: i % 5 === 2 ? at(i + 50) : null, done_at: i % 5 === 2 ? null : at(i + 15), owner_id: accounts[i % 12]!.owner_id, source: 'user', created_at: at(i + 15),
  }))
}

export function sandboxCatalogs(market: string): Record<string, unknown> {
  return {
    market,
    pipelines: [{ id: uid(`${market}:pipeline`), name: 'Embudo de ejemplo', motor: 'd2d', stages: ['Contactado', 'Propuesta', 'Alta', 'Ganado'].map((name, i) => ({ id: uid(`${market}:stage:${i}`), position: i + 1, name_es: name, name_en: ['Contacted', 'Proposal', 'Onboarding', 'Won'][i], kind: i === 3 ? 'won' : 'open' })) }],
    loss_reasons: [{ code: 'no_interest', kind: 'lost', label_es: 'Sin interés', label_en: 'No interest' }],
    account_types: [{ code: 'store', kind: 'store', label_es: 'Tienda', label_en: 'Store' }],
    territories: [{ id: uid(`${market}:territory`), name: 'Zona Ejemplo' }],
  }
}
