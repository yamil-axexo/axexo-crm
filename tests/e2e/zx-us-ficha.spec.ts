import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const phone = () => '+1410555' + String(Math.floor(1000 + Math.random() * 8999))
// La cookie de idioma se pone sobre la misma ruta que usa loginAs (/hoy), para reemplazarla y no convivir con ella.
const spanish = async (page: Page) => { await page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: new URL('/hoy', page.url()).href }]); await page.reload() }

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function widths(page: Page, label: string) {
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 })
    await clean(page, `${label} a ${w}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** Una tienda de US de Jade, directo en la base. `by: 'system'` la deja como llegó de una carga: sin origen ni reclutador. */
async function store(name: string, by: 'jade' | 'system' = 'jade') {
  const jade = await uid('jade.kim')
  const creator = by === 'jade' ? jade : (await sql<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
  const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, territory_id, country, phone, address_line, locality, region, postal_code, created_by)
    values ('US', 'store', ${name}, 'dealer', ${jade}, ${await uid('ter-md')}, 'US', ${phone()}, '300 Test Street', 'Baltimore', 'MD', '21201', ${creator}) returning id`)[0]!
  return acc.id
}

test.describe.configure({ mode: 'serial' })

test.describe('ficha de la tienda de US (E9)', () => {
  test('la ficha abre con ventas e identificadores, y Operaciones mantiene el sitio y el portafolio de operadores (EN, 1440 y 390)', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Harbor Wireless ${tag()}`
    const id = await store(name)
    await sql`update crm.accounts set merchant_ref = ${'MID-' + tag().toUpperCase()} where id = ${id}`
    await sql`insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d)
              values (${id}, (now() at time zone 'America/New_York')::date - 1, 'US', now() - interval '90 days', now() - interval '2 days', 42, 1234500, 'USD', 19)`
    await loginAs(page, 'tom.reyes', { stay: true })
    await page.goto(`/comercios/${id}`)
    // E9.F1: antes que el hilo, las cifras de venta y los identificadores
    const first = page.getByTestId('sales-first')
    await expect(first).toBeVisible()
    await expect(first.getByTestId('sf-sales')).toContainText('42')
    await expect(first.getByTestId('sf-merchant')).toContainText('MID-')
    await expect(first.getByTestId('sf-site')).toHaveText('n/a')
    await expect(first.getByTestId('sf-carriers')).toHaveText('None yet')
    await expect(page.getByTestId('ficha-type')).toContainText('Dealer')
    const above = await page.evaluate(() => document.querySelector('[data-testid=sales-first]')!.getBoundingClientRect().top < document.querySelector('[data-testid=ficha-tabs]')!.getBoundingClientRect().top)
    expect(above).toBe(true)

    await page.goto(`/comercios/${id}?tab=datos`)
    const profile = page.getByTestId('store-profile')
    await expect(profile.getByTestId('sp-segment')).toHaveText('Dealer')
    await expect(profile.getByTestId('sp-origin')).toContainText('New acquisition')
    await expect(profile.getByTestId('sp-zone')).toHaveText('Maryland')
    await expect(profile.getByTestId('sp-recruiter')).toHaveText('Not set')
    // E9.F2: el número de sitio lo anota Operaciones, junto al Merchant ID
    await profile.getByTestId('store-profile-edit').click()
    await page.locator('dialog[open]').getByTestId('site-ref-input').fill('SITE-00417')
    await page.locator('dialog[open]').getByTestId('store-profile-save').click()
    await expect(profile.getByTestId('sp-site')).toHaveText('SITE-00417')
    await expect(page.getByTestId('sf-site')).toHaveText('SITE-00417')

    // E9.F9: sin movimiento, ningún operador ocupa espacio
    const portfolio = page.getByTestId('carrier-portfolio')
    await expect(portfolio.getByTestId('carrier-item')).toHaveCount(0)
    await expect(portfolio.getByTestId('carrier-empty')).toBeVisible()
    await expect(page.getByTestId('store-providers')).toHaveCount(0)
    // E9.F8 y F10: Operaciones agrega el operador con su detalle
    await portfolio.getByTestId('carrier-add').click()
    let form = page.locator('dialog[open]')
    await form.getByTestId('carrier-pick').selectOption({ label: 'North carrier' })
    await form.getByTestId('carrier-status').selectOption('submitted')
    await form.getByTestId('carrier-ref').fill('NORTH-7781')
    await form.getByTestId('carrier-kit').fill('2026-11-02')
    await form.getByTestId('carrier-sims').fill('40')
    await form.getByTestId('carrier-save').click()
    const item = portfolio.getByTestId('carrier-item')
    await expect(item).toHaveCount(1)
    await expect(item.getByTestId('carrier-state')).toHaveText('Sent to the provider')
    await expect(item.getByTestId('carrier-facts')).toContainText('North dealer code: NORTH-7781')
    await expect(item.getByTestId('carrier-facts')).toContainText('SIMs ordered: 40')
    await expect(item.getByTestId('carrier-dates')).toContainText('submitted')
    await widths(page, 'ficha de tienda de US, Operaciones')
    // lo aprueba y anota la capacitación: la ficha lo dice arriba
    await item.getByTestId('carrier-edit').click()
    form = page.locator('dialog[open]')
    await form.getByTestId('carrier-status').selectOption('approved')
    await form.getByTestId('carrier-training').fill('2026-11-10')
    await form.getByTestId('carrier-save').click()
    await expect(item.getByTestId('carrier-state')).toHaveText('Approved')
    await expect(item.getByTestId('carrier-dates')).toContainText('approved')
    await expect(item.getByTestId('carrier-facts')).toContainText('Training')
    await expect(page.getByTestId('sf-carriers')).toHaveText('North carrier')
    // operadores que ya no están vigentes, como texto
    await portfolio.getByTestId('carrier-retired-edit').click()
    await page.locator('dialog[open]').getByTestId('carrier-retired-input').fill('Legacy carrier (until 2024)')
    await page.locator('dialog[open]').getByTestId('carrier-retired-save').click()
    await expect(portfolio.getByTestId('carrier-retired')).toContainText('Legacy carrier (until 2024)')
    const row = (await sql<{ status: string; carrier_ref: string; sims_ordered: number; training_on: string; site_ref: string }[]>`
      select p.status, p.carrier_ref, p.sims_ordered, p.training_on::text, a.site_ref from crm.account_products p join crm.accounts a on a.id = p.account_id where p.account_id = ${id}`)[0]!
    expect(row).toEqual({ status: 'approved', carrier_ref: 'NORTH-7781', sims_ordered: 40, training_on: '2026-11-10', site_ref: 'SITE-00417' })
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(`/comercios/${id}`)
    await expect(page.getByTestId('sales-first')).toBeVisible()
    await clean(page, 'ficha de tienda de US, encabezado a 390')
    await page.setViewportSize({ width: 1440, height: 900 })
    expect(errors).toEqual([])
  })

  test('quien vende crea la tienda con quién la reclutó, le pone tipo de negocio y Tax ID, y no cambia operadores (ES, 1440 y 390)', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Tienda Ficha ${tag()}`
    await loginAs(page, 'jade.kim')
    await spanish(page)
    await page.goto('/comercios')
    await page.getByTestId('new-account').click()
    const dialog = page.locator('dialog[open]')
    await dialog.getByTestId('account-name').fill(name)
    await dialog.getByTestId('account-phone').fill(phone())
    await expect(dialog.getByTestId('account-recruiter')).toHaveValue('field_team')
    await dialog.getByTestId('account-recruiter').selectOption({ label: 'Agencia: Agencia Ejemplo Uno (sintética)' })
    await dialog.getByTestId('save-account').click()
    await expect(page.locator('h1')).toHaveText(name)
    const id = (await sql<{ id: string }[]>`select id from crm.accounts where name = ${name}`)[0]!.id
    await page.goto(`/comercios/${id}?tab=datos`)
    const profile = page.getByTestId('store-profile')
    await expect(profile.getByTestId('sp-recruiter')).toContainText('Agencia: Agencia Ejemplo Uno (sintética)')
    await expect(profile.getByTestId('sp-origin')).toContainText('Alta nueva')
    await expect(profile.getByTestId('sp-segment')).toHaveText('Dealer')
    // fijo desde el alta: no hay cómo cambiarlo
    await expect(page.getByTestId('recruiter-form')).toHaveCount(0)
    await expect(page.getByTestId('origin-form')).toHaveCount(0)
    // E9.F4: tipo de negocio
    await profile.getByTestId('store-profile-edit').click()
    await expect(page.locator('dialog[open]').getByTestId('site-ref-input')).toHaveCount(0)
    await expect(page.locator('dialog[open]').getByTestId('business-type-select').locator('option')).toHaveCount(12)
    await page.locator('dialog[open]').getByTestId('business-type-select').selectOption({ label: 'Tienda de celulares' })
    await page.locator('dialog[open]').getByTestId('store-profile-save').click()
    await expect(profile.getByTestId('sp-business')).toHaveText('Tienda de celulares')
    // E9.F13: escribe el Tax ID completo; se le dice que solo quedan los últimos 4
    await profile.getByTestId('tax-id-edit').click()
    const tax = page.locator('dialog[open]')
    await tax.getByTestId('tax-id-input').fill('12-3456789')
    await tax.getByTestId('tax-id-save').click()
    await expect(tax.getByTestId('form-ok')).toContainText('solo los últimos 4 (6789)')
    await page.keyboard.press('Escape')
    await expect(profile.getByTestId('sp-tax')).toHaveText('Termina en 6789')
    expect((await sql<{ tax_id_last4: string }[]>`select tax_id_last4 from crm.accounts where id = ${id}`)[0]!.tax_id_last4).toBe('6789')
    // E9.F10: quien vende ve el portafolio y no lo mantiene
    await expect(page.getByTestId('carrier-portfolio').getByTestId('carrier-empty')).toContainText('Operaciones los agrega')
    await expect(page.getByTestId('carrier-add')).toHaveCount(0)
    // E9.F11: los demás campos de la tienda, agrupados, también los vacíos
    await sql`update crm.accounts set custom = custom || '{"us_dba": "Ficha Mobile", "us_hdn_account": "HDN-2291"}'::jsonb where id = ${id}`
    await page.reload()
    const kept = page.getByTestId('store-kept-fields')
    await expect(kept.getByTestId('kept-group-account')).toContainText('Ficha Mobile')
    await expect(kept.getByTestId('kept-group-hdn')).toContainText('HDN-2291')
    await expect(kept.getByTestId('kept-group-empower').getByTestId('kept-field')).toHaveCount(3)
    await expect(kept.getByTestId('kept-group-churn')).toContainText('Estado de baja en InstaPay')
    await expect(kept.getByTestId('kept-field')).toHaveCount(15)
    await widths(page, 'ficha de tienda de US, ventas, en español')
    expect(errors).toEqual([])
  })

  test('quien lidera el mercado da de alta una agencia y fija una vez el origen y el reclutador de una tienda que venía sin dato; el negocio lo hereda', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Loaded Store ${tag()}`
    const agency = `Recruit Partners ${tag()}`
    const id = await store(name, 'system')
    const deal = (await sql<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
      values ('US', ${await uid('p-us-dealer')}, ${await uid('s-us-dealer-lead')}, ${id}, ${await uid('jade.kim')}, ${`Onboarding: ${name}`}, 'USD', 'Call the owner', (now() at time zone 'America/New_York')::date + 1, ${await uid('jade.kim')}) returning id`)[0]!.id
    await loginAs(page, 'robert.hale', { stay: true })
    await page.goto('/datos?tab=catalogos')
    const card = page.getByTestId('agencies-card')
    await expect(card.getByTestId('agency-row')).toHaveCount(2)
    await card.getByTestId('agency-new').click()
    await page.locator('dialog[open]').getByTestId('agency-name').fill(agency)
    await page.locator('dialog[open]').getByTestId('agency-save').click()
    await expect(card.getByTestId('agency-row').filter({ hasText: agency })).toContainText('0 stores recruited')
    await widths(page, 'catálogos, agencias')

    await page.goto(`/comercios/${id}?tab=datos`)
    const profile = page.getByTestId('store-profile')
    await expect(profile.getByTestId('sp-origin')).toHaveText('Not set')
    await profile.getByTestId('origin-select').selectOption('emida_conversion')
    await profile.getByTestId('origin-save').click()
    await expect(profile.getByTestId('sp-origin')).toContainText('EMIDA conversion')
    await expect(page.getByTestId('origin-form')).toHaveCount(0)
    await profile.getByTestId('recruiter-select').selectOption({ label: `Agency: ${agency}` })
    await profile.getByTestId('recruiter-save').click()
    await expect(profile.getByTestId('sp-recruiter')).toContainText(`Agency: ${agency}`)
    await expect(page.getByTestId('recruiter-form')).toHaveCount(0)
    await page.goto(`/deals/${deal}`)
    await expect(page.getByTestId('deal-recruiter')).toHaveText(`Agency: ${agency}`)
    await page.goto('/datos?tab=catalogos')
    await expect(page.getByTestId('agencies-card').getByTestId('agency-row').filter({ hasText: agency })).toContainText('1 store recruited')
    // administración: el resguardo de datos protegidos aparece apagado en Estado de CONTIGO
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    await expect(page.locator('main')).toContainText('Resguardo de datos protegidos')
    await expect(page.locator('main')).toContainText('PROTECTED_DATA_VAULT')
    expect(errors).toEqual([])
  })
})
