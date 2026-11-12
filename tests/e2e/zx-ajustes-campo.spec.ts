import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WIDTHS, loginAs, pageErrors, testDb } from './helpers'

// Ola 4, paquete ajustes-campo: lo que la ronda de aceptación dejó abierto en campo y Operaciones, visto en pantalla.
const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7).replace(/\d/g, 'x')
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

test.describe.configure({ mode: 'serial' })

test('supervisión mantiene el catálogo de vendedores de calle en Mi equipo, en los tres anchos', async ({ page }) => {
  const errors = pageErrors(page)
  await loginAs(page, 'fernando.ibarra')
  await page.goto('/supervisor')
  const block = page.getByTestId('street-block')
  await expect(block).toContainText('Vendedores de calle')
  // el texto bajo el título ya no dice que nadie captura nada extra
  await expect(page.locator('main')).not.toContainText('Nadie captura nada extra')
  await expect(page.getByTestId('exception-total')).toContainText(/pendientes? abiertos?/)
  const name = `Vendedora Pantalla ${tag()}`
  await block.getByTestId('street-add').click()
  await page.getByTestId('street-name').fill(name)
  await page.getByTestId('street-reports').selectOption({ label: 'Marco Peña' })
  await page.getByTestId('street-save').click()
  await expect(block.getByTestId('street-row').filter({ hasText: name })).toHaveCount(1)
  await expect(block.getByTestId('street-owner').filter({ hasText: name })).toContainText('Marco Peña')
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await block.scrollIntoViewIfNeeded()
    await clean(page, `Mi equipo con vendedores de calle, ${w.name}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  // el nombre lleva a Comercios con el filtro "Visitado por" puesto
  await block.getByTestId('street-row').filter({ hasText: name }).getByTestId('street-link').click()
  await expect(page).toHaveURL(/\/comercios\?.*visito=/)
  // el Reporte de campo trae las visitas por quien visitó
  await page.goto('/reportes/campo')
  await expect(page.getByTestId('field-visitors')).toContainText('Visitas por quien visitó')
  const res = await page.request.get((await page.getByTestId('export-visits').getAttribute('href'))!)
  expect((await res.text()).replace(/^﻿/, '').split('\r\n')[0]).toContain('Quién visitó')
  expect(errors).toEqual([])
})

test('ganar a mano desde la tarjeta: la hoja dice qué falta en lenguaje llano, deja completarlo ahí y avisa con la fecha de cierre', async ({ page }) => {
  const pipe = await uid('p-mx-d2d')
  const marco = await uid('marco.pena')
  await sql`update crm.pipelines set close_by_transaction = false where id = ${pipe}`
  const first = (await sql<{ id: string; code: string }[]>`select id, code from crm.stages where pipeline_id = ${pipe} and kind = 'open' order by position limit 1`)[0]!
  const name = `Abarrotes Ajuste ${tag()}`
  const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by) values ('MX', 'store', ${name}, 'd2d', ${marco}, 'MX', ${marco}) returning id`)[0]!
  const contact = (await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('MX', 'Dueña De Ajuste') returning id`)[0]!
  await sql`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id}, ${contact.id}, 'MX', 'owner')`
  const deal = (await sql<{ id: string }[]>`
    insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
    values ('MX', ${pipe}, ${first.id}, ${acc.id}, ${marco}, ${name}, 'MXN', 'Volver cuando esté el dueño', (now() at time zone 'America/Mexico_City')::date + 2, ${marco}) returning id`)[0]!
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'marco.pena')
    await page.goto(`/pipelines/${pipe}?owner=me`)
    await page.getByTestId(`stage-tab-${first.code}`).click()
    const card = page.locator(`[data-card="${deal.id}"]`)
    await card.getByTestId('deal-card-win').click()
    const sheet = page.getByTestId('win-dialog')
    await expect(sheet.getByTestId('win-needs')).toHaveText('Para ganarlo falta decir quién decide y marcar que ya hablaste con esa persona.')
    await expect(sheet).not.toContainText('Activa')
    await clean(page, 'hoja de ganar con lo que falta, teléfono')
    await sheet.getByTestId('gate-decision-maker').selectOption({ label: 'Dueña De Ajuste' })
    await sheet.getByTestId('gate-met').check()
    await sheet.getByTestId('win-confirm').click()
    await expect(page.getByTestId('toast')).toContainText('Negocio ganado, con cierre el')
    await expect(page.getByTestId('toast')).not.toContainText('pasó a')
    const d = (await sql<{ status: string; next_step: string | null }[]>`select status, next_step from crm.deals where id = ${deal.id}`)[0]!
    expect(d).toEqual({ status: 'won', next_step: null })
    // el hilo del negocio dice la fecha de cierre
    await page.goto(`/deals/${deal.id}`)
    await expect(page.getByTestId('timeline-won')).toContainText('Negocio ganado, con cierre el')
  } finally {
    await sql`update crm.pipelines set close_by_transaction = true where id = ${pipe}`
  }
})

test('Operaciones no ve "Marcar como ganado" en un negocio que Ventas no ha entregado, y la entrega pide monto y cuenta ACH o prepago', async ({ page }) => {
  const pipe = await uid('p-us-dealer')
  const jade = await uid('jade.kim')
  await sql`update crm.pipelines set close_by_transaction = false where id = ${pipe}`
  const name = `Ajuste Wireless ${tag()}`
  const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by) values ('US', 'store', ${name}, 'dealer', ${jade}, 'US', ${jade}) returning id`)[0]!
  const contact = (await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Adjust Test Owner') returning id`)[0]!
  await sql`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id}, ${contact.id}, 'US', 'owner')`
  const deal = (await sql<{ id: string }[]>`
    insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, decision_maker_id, decision_maker_met, created_by)
    values ('US', ${pipe}, ${await uid('s-us-dealer-application')}, ${acc.id}, ${jade}, ${name}, 'USD', 'Collect the application', (now() at time zone 'America/New_York')::date + 1, ${contact.id}, true, ${jade}) returning id`)[0]!
  try {
    await loginAs(page, 'tom.reyes')
    await page.goto(`/deals/${deal.id}`)
    await expect(page.locator('h1')).toContainText(name)
    await expect(page.getByTestId('deal-win')).toHaveCount(0)
    // quien vende lo entrega: la hoja pide el monto y "ACH or prepaid account"
    await loginAs(page, 'jade.kim')
    await page.goto(`/deals/${deal.id}`)
    await expect(page.getByTestId('gate-missing')).toContainText('ACH or prepaid account')
    await page.getByTestId('gate-open').click()
    await page.getByTestId('gate-amount').fill('900')
    await page.getByTestId('gate-field-account_funding').selectOption('Prepaid')
    await page.getByTestId('gate-save').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Carrier submission')
    // ya entregado, Operaciones sí lo puede ganar
    await loginAs(page, 'tom.reyes')
    await page.goto(`/deals/${deal.id}`)
    await expect(page.getByTestId('deal-win')).toHaveCount(1)
  } finally {
    await sql`update crm.pipelines set close_by_transaction = true where id = ${pipe}`
  }
})

test('quien vende en US: sus cerrados abren, "New merchant" propone Dealers y los filtros se leen en inglés', async ({ page }) => {
  await loginAs(page, 'jade.kim')
  const res = await page.goto('/reportes/cerrados')
  expect(res!.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('My closed deals')
  // el reporte de campo sigue siendo de supervisión y de quien lidera
  expect((await page.goto('/reportes/campo'))!.status()).toBe(404)
  await page.goto('/comercios')
  await expect(page.locator('main')).not.toContainText('Esperando primera venta')
  await page.getByTestId('new-account').click()
  await expect(page.getByTestId('account-segment')).toHaveValue('dealer')
})
