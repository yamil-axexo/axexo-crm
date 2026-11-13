import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
// La cookie de idioma se pone sobre la misma ruta que usa loginAs (/hoy), para reemplazarla y no convivir con ella.
const spanish = async (page: Page) => { await page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: new URL('/hoy', page.url()).href }]); await page.reload() }

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

const PRESENTED = { interest_level: 'High', services_offered_today: ['Top-ups'], competitor_portals_used: ['None/Unknown'], remittance_brands_offered: ['None/Unknown'] }
const QUALIFIED = { primary_remittance_corridor: 'Mexico', topup_destinations_served: ['Mexico'], primary_remittance_provider: 'None/Unknown', remittance_frequency: 'Weekly', business_bank_account: 'Yes', top_carriers_by_volume: ['North carrier'] }

/** Una tienda de Jade (ventas US) con un contacto que decide y un negocio de alta en la etapa pedida, directo en la base. */
async function enrollment(name: string, stage: string, custom: Record<string, unknown> = {}, extra: { amount?: number } = {}) {
  const jade = await uid('jade.kim')
  const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, phone, address_line, locality, region, postal_code, created_by)
    values ('US', 'store', ${name}, 'dealer', ${jade}, 'US', ${'+1410555' + String(Math.floor(1000 + Math.random() * 8999))}, '300 Test Street', 'Baltimore', 'MD', '21201', ${jade}) returning id`)[0]!
  const contact = (await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Dana Fox Embudo') returning id`)[0]!
  await sql`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id}, ${contact.id}, 'US', 'decision_maker')`
  const deal = (await sql<{ id: string }[]>`
    insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, amount_minor, next_step, next_step_due, decision_maker_id, decision_maker_met, custom, created_by)
    values ('US', ${await uid('p-us-dealer')}, ${await uid(`s-us-dealer-${stage}`)}, ${acc.id}, ${jade}, ${`Onboarding: ${name}`}, 'USD', ${extra.amount ?? null}, 'Call the owner',
            (now() at time zone 'America/New_York')::date + 1, ${contact.id}, true, ${sql.json(custom as never)}, ${jade}) returning id`)[0]!
  return { accountId: acc.id, dealId: deal.id }
}

test.describe.configure({ mode: 'serial' })

test.describe('alta de dealers de US: nueve etapas, candados y campos destacados', () => {
  test('administración ve las nueve etapas y hace requisito o destacado cualquier campo del embudo (ES, 1440 y 390)', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=embudos')
    const card = page.getByTestId('pipeline-card').filter({ hasText: 'US · Dealer onboarding' })
    await expect(card).toBeVisible()
    const names = await card.getByTestId('stage-name').allTextContents()
    expect(names).toEqual(['Lead', 'Contactado', 'Presentado', 'Calificado para venta', 'Documentos y contrato', 'Aprobaciones', 'Provisionado y listo para liquidar', 'Alta y capacitación', 'Ganado (primera transacción)', 'Perdido'])
    const presented = card.getByTestId('stage-row').nth(2)
    await expect(presented.getByTestId('stage-needs')).toContainText('Nivel de interés')
    await expect(presented.getByTestId('stage-needs')).toContainText('Marcas de remesas que ofrece')
    await expect(presented.getByTestId('stage-highlights')).toContainText('Corredor principal de remesas')
    // Contactado: destaca cinco y no pide ninguno; se le agrega "Horario de la tienda" como requisito y se quita
    const contacted = card.getByTestId('stage-row').nth(1)
    await expect(contacted.getByTestId('stage-highlights')).toContainText('Nivel de interés')
    await contacted.getByTestId('stage-edit').click()
    const form = page.locator('dialog[open]')
    await expect(form.getByTestId('stage-fields')).toContainText('Campos del negocio')
    await expect(form.getByTestId('stage-fields-count')).toHaveText('0 de requisito, 4 destacados')
    await form.getByTestId('stage-fields-filter').fill('horario')
    await expect(form.getByTestId('stage-field-row').filter({ visible: true })).toHaveCount(1)
    await form.getByTestId('stage-field-req-store_hours').check()
    await expect(form.getByTestId('stage-fields-count')).toHaveText('1 de requisito, 4 destacados')
    await clean(page, 'editar etapa 1440')
    await form.getByTestId('stage-save').click()
    await expect(contacted.getByTestId('stage-needs')).toContainText('Horario de la tienda')
    // se regresa a como estaba, ahora en teléfono
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.getByTestId('pipeline-card').filter({ hasText: 'US · Dealer onboarding' }).getByTestId('stage-row').nth(1).getByTestId('stage-edit').click()
    const form2 = page.locator('dialog[open]')
    await form2.getByTestId('stage-field-req-store_hours').uncheck()
    await clean(page, 'editar etapa 390')
    await form2.getByTestId('stage-save').click()
    await expect(page.getByTestId('pipeline-card').filter({ hasText: 'US · Dealer onboarding' }).getByTestId('stage-row').nth(1).getByTestId('stage-needs')).not.toContainText('Horario de la tienda')
    const row = await sql<{ required_fields: string[]; n: number }[]>`select required_fields, cardinality(highlight_fields) as n from crm.stages where id = ${await uid('s-us-dealer-contacted')}`
    expect(row[0]).toEqual({ required_fields: [], n: 5 })
    expect(errors).toEqual([])
  })

  test('quien vende ve lo destacado de su etapa, lo llena, y el candado de Presented pide sus cuatro campos ahí mismo (EN, 390 y 1440)', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Zx Embudo ${tag()}`
    const { dealId } = await enrollment(name, 'contacted')
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'jade.kim')
    await page.goto(`/deals/${dealId}`)
    const path = page.getByTestId('stage-path')
    await expect(path.locator('li')).toHaveText(['Lead', 'Contacted', 'Presented', 'Sales Qualified', 'Docs & Contract', 'Approvals', 'Provisioned & Settlement Ready', 'Onboarding & Training', 'Won (first transaction)'])
    await expect(path.locator('[aria-current=step]')).toHaveText('Contacted')
    const hi = page.getByTestId('deal-highlights')
    await expect(hi).toContainText('Highlighted in this stage')
    await expect(hi.getByTestId('highlight-item')).toHaveCount(5)
    await expect(hi.getByTestId('highlights-count')).toHaveText('1 of 5 filled in') // quien decide ya está contactado
    await clean(page, 'negocio con destacados 390')
    await hi.getByTestId('highlights-fill').click()
    await expect(page).toHaveURL(/campos\?ver=destacados/)
    await expect(page.getByTestId('custom-scope')).toContainText('4 fields')
    await expect(page.getByTestId('custom-input')).toHaveCount(4)
    await expect(page.getByTestId('custom-mark').first()).toContainText('Presented')
    await page.locator('select[name=f_interest_level]').selectOption('Medium')
    await page.locator('input[type=checkbox][name=f_services_offered_today][value="Bill pay"]').check()
    await clean(page, 'campos destacados 390')
    await page.getByTestId('custom-save').click()
    await page.getByTestId('custom-back').click()
    await expect(page.getByTestId('deal-highlights').getByTestId('highlights-count')).toHaveText('3 of 5 filled in')
    // el candado: faltan dos de los cuatro y la hoja los pide, con "None/Unknown" como respuesta válida
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await expect(page.getByTestId('gate-missing')).toContainText('Competitor Portals Used')
    await expect(page.getByTestId('gate-missing')).toContainText('Remittance Brands Offered')
    await expect(page.getByTestId('gate-missing')).not.toContainText('Interest Level')
    await page.getByTestId('gate-open').click()
    const sheet = page.locator('dialog[open]')
    await sheet.getByTestId('gate-field-competitor_portals_used').getByLabel('None/Unknown').check()
    await sheet.getByTestId('gate-field-remittance_brands_offered').getByLabel('None/Unknown').check()
    await clean(page, 'hoja del candado 1440')
    await sheet.getByTestId('gate-save').click()
    await expect(page.getByTestId('stage-path').locator('[aria-current=step]')).toHaveText('Presented')
    // en Presented se destacan catorce campos de investigación, sin exigirlos
    await expect(page.getByTestId('deal-highlights').getByTestId('highlight-item')).toHaveCount(14)
    const saved = await sql<{ custom: Record<string, unknown> }[]>`select custom from crm.deals where id = ${dealId}`
    expect(saved[0]!.custom).toMatchObject({ interest_level: 'Medium', services_offered_today: ['Bill pay'], competitor_portals_used: ['None/Unknown'], remittance_brands_offered: ['None/Unknown'] })
    expect(errors).toEqual([])
  })

  test('la entrega a Operaciones pide la fecha de contrato; el negocio queda con quien lidera Operaciones, quien lo vendió queda fijo y Operaciones devuelve con los seis motivos', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Zx Entrega ${tag()}`
    const { dealId, accountId } = await enrollment(name, 'application', { ...PRESENTED, ...QUALIFIED, products_requested: ['Domestic top-up', 'Bill pay'], account_funding: 'ACH' }, { amount: 120000 })
    await loginAs(page, 'jade.kim')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByTestId('gate-missing')).toContainText('Contract signed & submitted')
    await expect(page.getByTestId('deal-sales-rep')).toHaveText('Jade Kim')
    await page.getByTestId('gate-open').click()
    const sheet = page.locator('dialog[open]')
    const today = (await sql<{ d: string }[]>`select (now() at time zone 'America/New_York')::date::text as d`)[0]!.d
    await sheet.getByTestId('gate-field-contract_signed_on').fill(today)
    await sheet.getByTestId('gate-save').click()
    await expect(page.getByTestId('stage-path').locator('[aria-current=step]')).toHaveText('Approvals')
    await expect(page.getByTestId('with-ops')).toBeVisible()
    await expect(page.getByTestId('deal-sales-rep')).toHaveText('Jade Kim (fixed)')
    await expect(page.getByText('In Operations').locator('..')).toContainText('Tom Reyes')
    // Operaciones: lo ve en su cola a su nombre, anota un proveedor y lo devuelve con uno de los seis motivos
    await loginAs(page, 'tom.reyes', { stay: true })
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByTestId('deal-highlights')).toContainText('Daily limit (USD)')
    await page.getByTestId('ops-return').click()
    const ret = page.locator('dialog[open]')
    await expect(ret.getByTestId('return-reason').locator('option')).toHaveText(['Pick a reason', 'Documents missing', 'Contract not signed', 'Entity details mismatch', 'Duplicate merchant', 'Merchant withdrew', 'Documents expired'])
    await ret.getByTestId('return-reason').selectOption('docs_expired')
    await ret.getByTestId('return-confirm').click()
    await expect(page.getByTestId('stage-path').locator('[aria-current=step]')).toHaveText('Docs & Contract')
    const d = await sql<{ next_step: string; frozen: boolean; ops: string | null }[]>`select next_step, sales_rep_frozen_at is not null as frozen, (select full_name from crm.users u where u.id = ops_owner_id) as ops from crm.deals where id = ${dealId}`
    expect(d[0]!.next_step).toContain('Documents expired')
    expect(d[0]).toMatchObject({ frozen: true, ops: 'Tom Reyes' })
    // la tienda: la aprobación por proveedor no aparece sin movimiento y el negocio sí
    await page.goto(`/comercios/${accountId}?tab=datos`)
    await expect(page.getByTestId('account-deals')).toContainText(name)
    await expect(page.getByTestId('store-providers')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test.describe('pedido de US con sus datos de envío e historial', () => {
  test('el pedido captura línea con descuento, paquetería FedEx por defecto y los datos de envío desde el teléfono; la tienda dice cuándo fue el último pedido', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Zx Pedidos ${tag()}`
    const jade = await uid('jade.kim')
    const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, address_line, locality, postal_code, created_by)
      values ('US', 'store', ${name}, 'orders', ${jade}, 'US', '410 Harbor Road', 'Baltimore', '21202', ${jade}) returning id`)[0]!
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/${acc.id}?tab=datos`)
    await expect(page.getByTestId('last-order')).toHaveText('This store has no orders yet.')
    await expect(page.getByTestId('last-order-line')).toHaveCount(0)
    await page.getByTestId('new-deal').click()
    await page.getByTestId('new-deal-pipeline').selectOption({ label: 'Sales orders' })
    await page.getByTestId('new-deal-title').fill(`Order ${name}`)
    await page.getByTestId('new-deal-step').fill('Confirm the order with the store')
    await page.getByTestId('save-deal').click()
    await expect(page).toHaveURL(/\/deals\//)
    const dealId = page.url().split('/').pop()!
    await page.getByTestId('item-product').selectOption({ index: 1 })
    await page.getByTestId('item-quantity').fill('100')
    await page.getByTestId('item-discount-input').fill('10')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('item-discount')).toContainText('less 10% discount')
    const order = page.getByTestId('order-details')
    await expect(order.getByTestId('order-carrier')).toHaveValue('FedEx')
    await expect(order.getByTestId('order-ship-to')).toHaveValue('410 Harbor Road, Baltimore, 21202')
    await expect(order.getByTestId('order-state')).toHaveText('Not saved yet')
    await order.getByTestId('order-customer').fill('C-55102')
    await order.getByTestId('order-po').fill('PO-9001')
    const due = (await sql<{ d: string }[]>`select ((now() at time zone 'America/New_York')::date + 4)::text as d`)[0]!.d
    await order.getByTestId('order-due').fill(due)
    await order.getByTestId('order-terms').fill('Net 15')
    await order.getByTestId('order-description').fill('Weekend restock')
    await clean(page, 'pedido 390')
    await order.getByTestId('order-save').click()
    await expect(order.getByTestId('order-state')).toHaveText('Saved')
    await page.reload()
    await expect(page.getByTestId('order-details').getByTestId('order-po')).toHaveValue('PO-9001')
    const saved = await sql`select carrier, customer_number, due_on::text, po_number, ship_to, terms, description from crm.deal_orders where deal_id = ${dealId}`
    expect(saved[0]).toEqual({ carrier: 'FedEx', customer_number: 'C-55102', due_on: due, po_number: 'PO-9001', ship_to: '410 Harbor Road, Baltimore, 21202', terms: 'Net 15', description: 'Weekend restock' })
    // la tienda: último pedido e historial
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/comercios/${acc.id}`)
    // a la vista en la cabecera, sin cambiar de pestaña
    await expect(page.getByTestId('last-order-line')).toContainText('(today). 1 order in total.')
    await page.goto(`/comercios/${acc.id}?tab=datos`)
    await expect(page.getByTestId('last-order')).toContainText('Last order:')
    await expect(page.getByTestId('last-order')).toContainText('(today). 1 order in total.')
    await expect(page.getByTestId('order-row')).toHaveCount(1)
    await expect(page.getByTestId('order-row')).toContainText('1 line · FedEx · PO PO-9001')
    await clean(page, 'tienda con pedidos 1440')
    // y en español
    await spanish(page)
    await expect(page.getByTestId('last-order')).toContainText('Último pedido:')
    await expect(page.getByTestId('account-orders')).toContainText('Pedidos')
    expect(errors).toEqual([])
  })
})

test.describe('visitas de US con propósito', () => {
  test('la visita desde la tienda pide el propósito de la lista, en el teléfono, y queda en el hilo; lo escrito con nombre de campo pasa al negocio', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Zx Visitas ${tag()}`
    const { accountId, dealId } = await enrollment(name, 'contacted')
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/${accountId}`)
    await page.getByTestId('ficha').getByTestId('action-visit').click()
    const sheet = page.locator('[data-testid="log-sheet"][open]')
    const purpose = sheet.getByTestId('sheet-visit-reason')
    await expect(purpose.locator('option')).toHaveText(['Pick the purpose', 'Prospecting or first visit', 'Follow-up', 'Documents and contract', 'Training', 'Material or product drop-off', 'Support or store issue', 'Campaign or promotion', 'Relationship visit'])
    expect((await purpose.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await purpose.selectOption({ label: 'Campaign or promotion' })
    await sheet.getByText('Go back for the decision-maker', { exact: true }).click()
    await sheet.getByTestId('log-note').fill('Interest Level: High')
    await sheet.getByText('Nothing else: close', { exact: true }).click()
    await clean(page, 'hoja de visita 390')
    await sheet.getByTestId('log-save').click()
    await expect(page.getByTestId('toast')).toContainText(`Visit saved on ${name}. What you wrote in the note is now in its fields: Interest Level.`)
    await expect(page.getByTestId('ficha').getByTestId('tl-visit').first()).toContainText('Visit · Campaign or promotion')
    const a = await sql<{ visit_reason: string; deal_id: string; body: string | null }[]>`select visit_reason, deal_id, body from crm.activities where account_id = ${accountId} and kind = 'visit' and done_at is not null`
    expect(a[0]).toEqual({ visit_reason: 'campaign', deal_id: dealId, body: null })
    expect((await sql<{ v: string }[]>`select custom ->> 'interest_level' as v from crm.deals where id = ${dealId}`)[0]!.v).toBe('High')
    expect(errors).toEqual([])
  })

  test('administración mantiene los propósitos de visita y quién lidera Operaciones del embudo; Estado de CONTIGO muestra el adaptador de rutas apagado', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/operaciones')
    const reasons = page.getByTestId('ops-visit-reasons')
    await expect(reasons).toContainText('Propósitos de visita')
    await expect(reasons.getByTestId('visit-reason-row')).toHaveCount(8)
    const label = `Promo ${tag()}`
    await reasons.getByTestId('visit-reason-market').selectOption('US')
    await reasons.getByTestId('visit-reason-es').fill(`${label} de otoño`)
    await reasons.getByTestId('visit-reason-en').fill(`${label} fall`)
    await reasons.getByTestId('visit-reason-campaign').check()
    await reasons.getByTestId('visit-reason-add').click()
    await expect(reasons.getByTestId('visit-reason-row')).toHaveCount(9)
    const dealer = page.getByTestId('ops-pipeline').filter({ hasText: 'US · Dealer onboarding' })
    await expect(dealer.getByTestId('ops-lead').locator('option:checked')).toHaveText('Tom Reyes')
    await clean(page, 'administración de Operaciones 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await clean(page, 'administración de Operaciones 390')
    await page.goto('/estado')
    const row = page.getByTestId('status-row-routes')
    await expect(row).toContainText('Herramienta de rutas')
    await expect(row.getByTestId('status-state')).toHaveText('Adaptador apagado')
    await expect(row.getByTestId('status-last')).toContainText('ROUTE_TOOL')
    await clean(page, 'estado 390')
    // se retira el propósito de prueba para no dejarlo en la lista
    await sql`update crm.visit_reasons set is_active = false where label_en = ${`${label} fall`}`
    expect(errors).toEqual([])
  })
})
