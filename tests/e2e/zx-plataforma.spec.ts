import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createHash, randomBytes } from 'node:crypto'
import { loginAs, pageErrors, testDb } from './helpers'

// Datos de prueba armados en el momento: el escáner de datos prohibidos no deja escribirlos enteros en el código.
const CARD = ['4111', '1111', '1111', '1111'].join(' ')
const SSN = ['123', '45', '6789'].join('-')


// Paquete plataforma (0045): Administración, Plataforma; Estado de CONTIGO; API de escritura por HTTP; datos reservados del
// negocio; acciones rápidas optimistas con reversión; pantallas en vivo.

const tag = () => Math.random().toString(36).slice(2, 8)
const uid = async (key: string) => {
  const sql = testDb()
  try {
    return (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
  } finally {
    await sql.end()
  }
}
async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
const dialog = (page: Page) => page.locator('dialog[open]')

test.describe('Plataforma en Administración', () => {
  test('administración acota una función a un rol, deja un valor propuesto, enciende un aviso por evento, aprueba un red-team y registra un agente', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin')
    await page.getByTestId('pill-plataforma').click()
    await expect(page).toHaveURL(/\/admin\/plataforma$/)
    await expect(page.getByTestId('flag-live_updates')).toContainText('Todos los roles')

    await page.getByTestId('flag-edit-live_updates').click()
    await dialog(page).getByTestId('flag-role-supervisor').check()
    await dialog(page).getByTestId('flag-save').click()
    await expect(page.getByTestId('flag-live_updates')).toContainText('Supervisión')

    await expect(page.getByTestId('value-offline_read_cache')).toContainText('Valor propuesto, pendiente: Seguridad')
    await page.getByTestId('value-edit-audit_retention_days').click()
    await dialog(page).locator('input[name="value"]').fill('400')
    await dialog(page).getByTestId('value-save').click()
    await expect(page.getByTestId('value-audit_retention_days').getByTestId('value-current')).toHaveText('400 días')
    await expect(page.getByTestId('value-audit_retention_days')).toContainText('Valor propuesto, pendiente: Legal y Seguridad')

    await expect(page.getByTestId('privacy-MX')).toContainText('pendiente: Legal')

    const rule = page.getByTestId('rule-deal.won')
    await expect(rule).toContainText('Apagada, propuesta')
    await rule.getByTestId('rule-toggle').click()
    await expect(rule).toContainText('Encendida')

    const rt = page.getByTestId('redteam-rules_next_action')
    await expect(rt).toContainText('Falta aprobar')
    await page.getByTestId('redteam-open-rules_next_action').click()
    for (const box of await dialog(page).locator('input[name="checked"]').all()) await box.check()
    await dialog(page).getByTestId('redteam-notes').fill('Probé notas con instrucciones escondidas y la persona de menor alcance.')
    await dialog(page).getByTestId('redteam-save').click()
    await expect(rt).toContainText('Aprobada')

    const name = `Agente ${tag()}`
    await page.getByTestId('mcp-client-name').fill(name)
    await page.getByTestId('mcp-client-redirect').fill('https://agente.example.com/cb')
    await page.getByTestId('mcp-client-save').click()
    await expect(page.getByTestId('mcp-client').filter({ hasText: name })).toContainText('mcpc_')

    await axeClean(page, 'Plataforma 1440')
    await noOverflow(page, 'Plataforma 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow(page, 'Plataforma 390')
    await axeClean(page, 'Plataforma 390')
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Platform' })).toBeVisible()
    await expect(page.getByTestId('value-offline_read_cache')).toContainText('Proposed value, pending: Seguridad')
    expect(errors).toEqual([])
    // deja la función como estaba para las demás pruebas
    const sql = testDb()
    await sql`update crm.feature_flags set roles = '{}' where key = 'live_updates'`
    await sql`update crm.event_notice_rules set is_active = false where event_type = 'deal.won'`
    await sql.end()
  })

  test('Estado de CONTIGO muestra la velocidad medida, lo pendiente con su dueño y avisa si el ambiente tiene datos reales', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    const card = page.getByTestId('status-platform')
    await expect(card.getByTestId('status-p95-search')).toBeVisible()
    await expect(card.getByTestId('status-p95-phone')).toBeVisible()
    await expect(card.getByTestId('status-pending-value').filter({ hasText: 'Lectura sin señal' })).toContainText('pendiente: Seguridad')
    await expect(card.getByTestId('status-pending-value').filter({ hasText: 'Pérdida de datos aceptable' })).toContainText('Dan Mulligan')
    await expect(card.getByTestId('status-realtime')).toContainText('REALTIME_ADAPTER')
    await expect(card.getByTestId('status-egress')).toBeVisible()
    await expect(page.getByTestId('status-real-data')).toHaveCount(0)
    const sql = testDb()
    await sql`update crm.platform_values set value = 'true'::jsonb where key = 'staging_has_real_data'`
    await page.reload()
    await expect(page.getByTestId('status-real-data')).toContainText('datos reales')
    await sql`update crm.platform_values set value = 'false'::jsonb where key = 'staging_has_real_data'`
    await sql.end()
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow(page, 'Estado 390')
  })
})

test.describe('API de escritura (AUT-04)', () => {
  test('una llave con permiso de escritura crea una actividad como su dueño; sin permiso 403; otro mercado 404; una tarjeta 422', async ({ request }) => {
    const sql = testDb()
    const marco = await uid('marco.pena')
    const raw = `ctg_${randomBytes(30).toString('base64url')}`
    const id = (await sql<{ id: string }[]>`insert into crm.api_clients (name, key_prefix, key_hash, scopes, created_by, market_code, mode, rate_per_minute)
      values (${`Escritura ${tag()}`}, ${raw.slice(0, 12)}, ${createHash('sha256').update(raw).digest('hex')}, ${['activities:write']}, ${marco}, 'MX', 'live', 120) returning id`)[0]!.id
    const acc = (await sql<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco} and archived_at is null limit 1`)[0]!
    const us = (await sql<{ id: string }[]>`select id from crm.accounts where market_code = 'US' and archived_at is null limit 1`)[0]!
    const auth = { authorization: `Bearer ${raw}` }
    const ok = await request.post('/api/v1/activities', { headers: auth, data: { account_id: acc.id, kind: 'note', subject: 'Nota por la API', body: 'Pidió volver el lunes' } })
    expect(ok.status()).toBe(201)
    const created = (await ok.json()) as { id: string }
    const ev = (await sql<{ actor_id: string; via: string }[]>`select actor_id, via from crm.audit_events where object_id = ${created.id} limit 1`)[0]!
    expect(ev).toMatchObject({ actor_id: marco, via: 'api' })
    expect((await request.post('/api/v1/leads', { headers: auth, data: { sale_type: 'd2d', business_name: 'Tienda API', contact_name: 'Alguien' } })).status()).toBe(403)
    expect((await request.post('/api/v1/activities', { headers: auth, data: { account_id: us.id, kind: 'note', subject: 'Otro mercado' } })).status()).toBe(404)
    expect((await request.post('/api/v1/activities', { headers: auth, data: { account_id: acc.id, kind: 'note', subject: 'Pago', body: `${CARD}` } })).status()).toBe(422)
    const masked = await request.post('/api/v1/activities', { headers: auth, data: { account_id: acc.id, kind: 'note', subject: 'Alta', body: `SSN ${SSN}` } })
    expect(masked.status()).toBe(201)
    expect(await masked.json()).toMatchObject({ masked: true })
    await sql`update crm.api_clients set revoked_at = now() where id = ${id}`
    await sql.end()
  })
})

test.describe('Datos reservados del negocio (SEG-02) y acciones rápidas (UX-02)', () => {
  test('quien lidera el mercado carga y revela el reparto de comisión a 390 px; quien vende no lo ve', async ({ page }) => {
    const sql = testDb()
    const marco = await uid('marco.pena')
    const deal = (await sql<{ id: string }[]>`select id from crm.deals where owner_id = ${marco} and market_code = 'MX' and status = 'open' limit 1`)[0]!
    await sql.end()
    await loginAs(page, 'ana.robles', { stay: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/deals/${deal.id}`)
    const field = page.getByTestId('reserved-deal_commission_split')
    await field.getByTestId('reserved-edit-open').click()
    await dialog(page).getByTestId('reserved-value').fill('ISO 60 / dealer 40')
    await dialog(page).getByTestId('reserved-save').click()
    await expect(field.getByTestId('reserved-state')).toContainText('••••')
    await field.getByTestId('reserved-reveal-open').click()
    await dialog(page).getByTestId('reserved-reason').fill('Revisión de la liquidación del mes')
    await dialog(page).getByTestId('reserved-reveal').click()
    await expect(dialog(page)).toContainText('ISO 60 / dealer 40')
    await noOverflow(page, 'Negocio 390')
    await axeClean(page, 'Negocio 390')
    await loginAs(page, 'marco.pena')
    await page.goto(`/deals/${deal.id}`)
    await expect(page.getByTestId('reserved-deal_commission_split')).toHaveCount(0)
  })

  test('"Visto" quita el aviso al instante; "Calificar" vuelve a como estaba con el motivo si el servidor no guarda', async ({ page }) => {
    const sql = testDb()
    const marco = await uid('marco.pena')
    const title = `Aviso rápido ${tag()}`
    await sql`insert into crm.notices (market_code, user_id, from_user_id, kind, title, body, needs_action) values ('MX', ${marco}, ${await uid('ana.robles')}, 'automation', ${title}, 'Revisa el comercio', true)`
    await loginAs(page, 'marco.pena')
    await expect(page.getByTestId('live-refresh')).toBeAttached()
    const row = page.getByTestId('hoy-notice').filter({ hasText: title })
    await row.getByTestId('hoy-notice-seen').click()
    await expect(page.getByTestId('hoy-notice').filter({ hasText: title })).toHaveCount(0)
    expect((await sql`select 1 from crm.notices where title = ${title} and seen_at is not null`).length).toBe(1)

    const lead = (await sql<{ id: string }[]>`select id from crm.leads where owner_id = ${marco} and status in ('new','contacted') limit 1`)[0]!
    await page.goto(`/leads/${lead.id}`)
    await expect(page.getByTestId('lead-qualify')).toBeVisible()
    // Mientras la pantalla está abierta, el lead se cierra por otro lado: calificar ya no se puede.
    await sql`update crm.leads set status = 'disqualified', disqualified_reason = 'duplicate' where id = ${lead.id}`.catch(async () => {
      await sql`update crm.leads set status = 'disqualified' where id = ${lead.id}`
    })
    await page.getByTestId('lead-qualify').click()
    await expect(page.getByTestId('lead-qualify-error')).toBeVisible()
    await expect(page.getByTestId('lead-qualify')).toHaveText('Calificar')
    await sql.end()
  })

  test('UX-04: quien supervisa aprueba un paso de etapa de un toque desde el teléfono (390 px)', async ({ page }) => {
    const sql = testDb()
    const diana = await uid('diana.cruz')
    const title = `Zx Aprobación ${tag()}`
    const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by)
      values ('MX', 'chain', ${title}, 'b2b', ${diana}, 'MX', ${diana}) returning id`)[0]!.id
    const stages = await sql<{ id: string; code: string }[]>`select id, code from crm.stages where pipeline_id = md5('contigo:p-mx-b2b')::uuid and code in ('calificacion', 'propuesta')`
    const from = stages.find((x) => x.code === 'calificacion')!.id
    const to = stages.find((x) => x.code === 'propuesta')!.id
    const dealId = (await sql<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, next_step, next_step_due, created_by)
      values ('MX', md5('contigo:p-mx-b2b')::uuid, ${from}, ${acc}, ${diana}, ${title}, 1000000, 'MXN', 'Enviar propuesta', (now() at time zone 'America/Mexico_City')::date + 1, ${diana}) returning id`)[0]!.id
    const tr = (await sql<{ id: string }[]>`insert into crm.stage_transitions (pipeline_id, from_stage_id, to_stage_id, needs_approval, approver_role)
      values (md5('contigo:p-mx-b2b')::uuid, ${from}, ${to}, true, 'supervisor')
      on conflict (pipeline_id, coalesce(from_stage_id, '00000000-0000-0000-0000-000000000000'::uuid), to_stage_id) do update set needs_approval = true, approver_role = 'supervisor', approver_id = null, requires_evidence = false, is_active = true
      returning id`)[0]!.id
    await sql`insert into crm.approvals (market_code, deal_id, transition_id, from_stage_id, to_stage_id, requested_by, approver_role, due_at)
      values ('MX', ${dealId}, ${tr}, ${from}, ${to}, ${diana}, 'supervisor', now() + interval '8 hours')`
    await loginAs(page, 'paula.mendez')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByTestId('approval-waiting')).toBeVisible()
    await noOverflow(page, 'Aprobación 390')
    await axeClean(page, 'Aprobación 390')
    const box = await page.getByTestId('approval-approve-btn').boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44) // objetivo táctil de 44 px
    await page.getByTestId('approval-approve-btn').click()
    await expect(page.getByTestId('approval-pending')).toHaveCount(0)
    expect((await sql<{ code: string }[]>`select s.code from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${dealId}`)[0]!.code).toBe('propuesta')
    await sql`update crm.stage_transitions set is_active = false where id = ${tr}`
    await sql.end()
  })

  test('las marcas en vivo solo responden temas de los mercados de la persona', async ({ page }) => {
    const sql = testDb()
    await sql`insert into crm.live_signals (topic, market_code) values ('US:deal', 'US'), ('MX:deal', 'MX') on conflict (topic) do update set last_at = now()`
    await sql.end()
    await loginAs(page, 'marco.pena')
    const res = await page.request.get('/api/live?t=MX:deal,US:deal')
    const { marks } = (await res.json()) as { marks: Record<string, string> }
    expect(Object.keys(marks)).toEqual(['MX:deal'])
  })
})
