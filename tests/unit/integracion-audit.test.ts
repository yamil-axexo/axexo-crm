import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION, AUDIT_GROUPS, AUDIT_OBJECT, diffRows, summary } from '@/lib/audit'
import { translator } from '@/lib/format'

// La bitácora legible (administración) frente a lo que registran reparto y campo: cada evento se lee en palabras.
const es = translator('es')
const en = translator('en')
const U = '01a1cd48-0000-7000-8000-000000000001'
const T = '01a1cd48-0000-7000-8000-000000000002'
const names = { [U]: 'Marco Peña', [T]: 'MX · Puebla Centro' }
const row = (rows: ReturnType<typeof diffRows>, key: string) => rows.find((r) => r.key === key)

describe('bitácora: lo que registran reparto y campo se lee en palabras', () => {
  it('un reparto dice cuántos, de quién y a quién', () => {
    expect(summary(es, 'es', 'account.reassigned', { count: 26, from_user_ids: ['none'] }, { to_user_id: U, deals: 6, tasks: 6 }, names)).toBe('26 comercios a Marco Peña')
    expect(summary(es, 'es', 'lead.reassigned', { count: 5, from: 'vacant' }, { to_user_id: U }, names)).toBe('5 leads a Marco Peña')
    expect(summary(en, 'en', 'deal.reassigned', { count: 9, from: U }, { to_user_id: U }, names)).toBe('9 deals to Marco Peña')
    const rows = diffRows(es, 'es', { count: 5, from: 'vacant' }, { to_user_id: U, to_name: 'Marco Peña', lead_ids: [U, T] }, names, 'lead.reassigned')
    expect(row(rows, 'from')).toMatchObject({ label: 'Eran de', before: 'Sin dueño vigente' })
    expect(row(rows, 'lead_ids')).toMatchObject({ label: 'Leads movidos', after: '2 leads' })
    expect(row(diffRows(es, 'es', { count: 2, from_user_ids: ['none', U] }, null, names, 'account.reassigned'), 'from_user_ids')!.before).toBe('nadie (no tenían dueño), Marco Peña')
  })

  it('los territorios aparecen con su nombre y caen en Configuración', () => {
    expect(summary(es, 'es', 'account.territory_set', { count: 10 }, { territory_id: T, territory: 'Puebla Centro' }, names)).toBe('10 comercios: Puebla Centro')
    expect(summary(en, 'en', 'account.territory_set', { count: 10 }, { territory_id: null, territory: null }, names)).toBe('10 merchants: no territory')
    expect(summary(es, 'es', 'territory.created', null, { name: 'Puebla Centro', code: 'puebla-centro' }, names)).toBe('Puebla Centro')
    expect(row(diffRows(es, 'es', { territory_ids: [] }, { territory_ids: [T] }, names, 'user.territories_changed'), 'territory_ids')).toMatchObject({ label: 'Territorios', after: 'MX · Puebla Centro' })
    expect(AUDIT_GROUPS.config.like).toContain('territory.%')
    expect(AUDIT_OBJECT.territory).toEqual(['Territorio', 'Territory'])
    for (const a of ['territory.created', 'territory.renamed', 'territory.archived', 'territory.restored', 'user.territories_changed', 'account.territory_set', 'lead.reassigned', 'deal.reassigned']) expect(AUDIT_ACTION[a], a).toBeDefined()
  })

  it('una visita registrada en CONTIGO no se lee como una visita de la Sales App', () => {
    const after = { kind: 'visit', account_id: U, outcome: 'no_sale', origin: 'manual', on: '2026-11-10', visited_by: 'Julia Prueba' }
    const rows = diffRows(es, 'es', null, after, names, 'activity.added')
    expect(row(rows, 'kind')!.after).toBe('Visita')
    expect(row(rows, 'outcome')).toMatchObject({ label: 'Resultado', after: 'No hubo venta' })
    expect(row(rows, 'origin')).toMatchObject({ label: 'Dónde se registró', after: 'En CONTIGO, a mano' })
    expect(row(rows, 'on')).toMatchObject({ label: 'Día de la visita', after: '10 nov 2026' })
    expect(row(rows, 'visited_by')).toMatchObject({ label: 'Quién visitó', after: 'Julia Prueba' })
    expect(summary(es, 'es', 'activity.added', null, after, names)).toBe('Visita · No hubo venta')
    expect(summary(en, 'en', 'activity.completed', null, { kind: 'visit', outcome: 'revisit', next: 'visit' }, names)).toBe('Visit · Go back for the decision-maker')
    expect(row(diffRows(en, 'en', null, { kind: 'visit', outcome: 'sale', next: 'visit' }, names, 'activity.completed'), 'next')!.after).toBe('Visit')
    // La prueba de integración desde Administración sigue diciendo de dónde viene.
    expect(summary(es, 'es', 'integration.simulated', null, { kind: 'visit' }, names)).toBe('Visita de la Sales App')
  })

  it('quitar un acceso deja escrito si lo suyo quedó sin dueño vigente', () => {
    const rows = diffRows(es, 'es', { role: 'ops', market: 'MX', team_id: null }, { removed_from_rules: [], fallback_cleared: [], accounts: 3, deals: 1, leads: 1, no_current_owner: true }, names, 'membership.ended')
    expect(row(rows, 'no_current_owner')).toMatchObject({ label: 'Lo suyo quedó sin dueño vigente', after: 'Sí' })
    expect(row(rows, 'accounts')!.after).toBe('3')
  })

  // Ola 2: cada acción nueva de los cinco paquetes se lee en los dos idiomas y cae en un tipo del filtro.
  it('las acciones de la ola 2 tienen nombre en ES y EN y entran en algún filtro', () => {
    const wave2: Record<string, string[]> = {
      records: [
        // leads
        'lead.updated', 'lead.passed', 'lead.released', 'lead.repeat_request',
        // operaciones
        'deal.item_added', 'deal.item_removed', 'deal.handed_to_ops', 'deal.returned_to_sales', 'deal.ops_taken', 'deal.ops_check', 'deal.training',
        'account.merchant_ref', 'activity.notice_sent', 'activity.notice_seen',
        // b2b
        'account.type_changed', 'contact.primary_set', 'deal.paused', 'deal.resumed',
      ],
      config: [
        'routing.hours_updated', // leads
        'pipeline.ops_configured', 'pipeline.catalog_created', 'pipeline.catalog_updated', 'pipeline.product_created', 'pipeline.product_updated', // operaciones
        'stage.created', 'stage.reordered', 'stage.archived', 'pipeline.created', 'field.created', 'field.retired', 'field.restored',
        'account_type.created', 'account_type.retired', 'account_type.restored', 'loss_reason.created', 'loss_reason.updated', 'form.updated', // b2b
        'fx.rate_set', // liderazgo
      ],
      exports: ['report.exported'], // liderazgo
      reports: ['report.created', 'report.answered'], // contenido
    }
    const like = (action: string, pattern: string) => new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/%/g, '.*')}$`).test(action)
    for (const [group, actions] of Object.entries(wave2)) {
      for (const a of actions) {
        const pair = AUDIT_ACTION[a]
        expect(pair, a).toBeDefined()
        expect(pair![0], a).not.toBe(pair![1])
        expect(`${pair![0]}${pair![1]}`, a).not.toMatch(/[—–]/)
        expect((AUDIT_GROUPS[group as keyof typeof AUDIT_GROUPS].like ?? []).some((p) => like(a, p)), `${a} en ${group}`).toBe(true)
      }
    }
    // "report." lo usan dos paquetes para cosas distintas: una exportación no aparece entre los reportes del equipo, ni al revés.
    expect(AUDIT_GROUPS.reports.like.some((p) => like('report.exported', p))).toBe(false)
    expect(AUDIT_GROUPS.exports.like.some((p) => like('report.created', p))).toBe(false)
    for (const o of ['report', 'fx_rate', 'notice', 'ops_catalog', 'product', 'market', 'problem_report', 'account_type', 'field', 'form', 'loss_reason']) expect(AUDIT_OBJECT[o], o).toBeDefined()
  })
})
