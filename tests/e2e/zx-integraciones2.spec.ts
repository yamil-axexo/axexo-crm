import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { WIDTHS, loginAs, pageErrors, testDb } from './helpers'

// Paquete integraciones2 (programa "los 95"): cifras de ventas por tienda en la ficha y en Mi equipo (E5.F1/F2), cargas
// visibles con ventana de mantenimiento (E5.F3/F4/F5), firma sin Pipedrive (E5.F7), documentos generados con PDF en el
// navegador y correo con el canal apagado (E5.F9), respaldo de Pipedrive (E6.F4) y la hoja de leads de México (E18.F7).

const sql = testDb()
const setLocale = async (page: Page, locale: 'es' | 'en') => {
  await page.context().addCookies([{ name: 'contigo_locale', value: locale, url: page.url() }])
  await page.reload()
}
async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const at = async (page: Page, name: 'desktop' | 'movil') => page.setViewportSize(WIDTHS.find((w) => w.name === name)!)

test.describe.configure({ mode: 'serial' })

test.describe('integraciones2', () => {
  let storeId = ''
  test.beforeAll(async () => {
    const s = (await sql<{ id: string }[]>`
      select a.id from crm.accounts a join crm.users u on u.id = a.owner_id
       where u.email = 'lucia.vega@contigo.test' and a.kind = 'store' and a.archived_at is null and a.market_code = 'MX' order by a.id limit 1`)[0]!
    storeId = s.id
    await sql`delete from crm.store_sales_lines where account_id = ${storeId}`
    await sql`insert into crm.store_sales_lines (account_id, as_of, market_code, line_kind, line_key, mtd, prev_month, d90, currency) values
      (${storeId}, '2026-11-12', 'MX', 'activations', 'Telcel', 12, 30, 80, null),
      (${storeId}, '2026-11-12', 'MX', 'activations', 'AT&T', null, null, 4, null),
      (${storeId}, '2026-11-12', 'MX', 'payments', 'Recargas', 150000, null, 900000, 'MXN')`
  })
  test.afterAll(async () => {
    await sql`delete from crm.store_sales_lines where account_id = ${storeId}`
    await sql`delete from crm.generated_documents where account_id = ${storeId}`
    await sql`delete from crm.load_windows`
    await sql.end()
  })

  test('la ficha muestra las ventas por tienda (vacío sin actividad) y genera un documento con PDF y correo', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'lucia.vega')
    await page.goto(`/comercios/${storeId}?tab=datos`)
    const box = page.getByTestId('store-sales')
    await expect(box.getByTestId('store-sales-activations-row')).toHaveCount(2)
    const att = box.getByTestId('store-sales-activations-row').filter({ hasText: 'AT&T' })
    await expect(att.locator('td').first()).toHaveText('Sin actividad')
    await expect(box.getByTestId('store-sales-asof')).toContainText('Vacío: sin actividad')
    for (const w of ['desktop', 'movil'] as const) {
      await at(page, w)
      await clean(page, `ficha ${w}`)
    }
    await at(page, 'desktop')

    await page.getByTestId('account-documents-link').click()
    await expect(page.getByTestId('documents-page')).toBeVisible()
    await page.getByTestId('pill-letter').click()
    await expect(page.getByTestId('doc-title')).toHaveValue(/^Carta a /)
    await page.getByTestId('doc-body').fill('Gracias por recibirnos.\nNos vemos el lunes.')
    await page.getByTestId('doc-generate').click()
    await expect(page.getByTestId('document-row')).toHaveCount(1)
    for (const w of ['desktop', 'movil'] as const) {
      await at(page, w)
      await clean(page, `documentos ${w}`)
    }
    await at(page, 'desktop')
    await page.getByTestId('document-link').click()
    await expect(page.getByTestId('document-body')).toContainText('Nos vemos el lunes.')
    await expect(page.getByTestId('document-vault')).toContainText('bóveda de documentos está apagada')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('doc-pdf').click()])
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)
    const pdf = readFileSync((await download.path())!, 'latin1')
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    await page.getByTestId('document-email-to').fill('tienda@ejemplo.test')
    await page.getByTestId('document-email').click()
    await expect(page.getByText('Quedó listo para enviar. El canal de correo está apagado')).toBeVisible()
    for (const w of ['desktop', 'movil'] as const) {
      await at(page, w)
      await clean(page, `documento ${w}`)
    }
    await setLocale(page, 'en')
    await expect(page.getByTestId('document-vault')).toContainText('The document vault is off')
    expect(errors).toEqual([])
  })

  test('Mi equipo suma las ventas por tienda de cada persona', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/supervisor')
    const card = page.getByTestId('team-store-sales')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('team-store-sales-row').filter({ hasText: 'Lucía Vega' })).toContainText('12')
    for (const w of ['desktop', 'movil'] as const) {
      await at(page, w)
      await clean(page, `mi equipo ${w}`)
    }
  })

  test('Estado de CONTIGO: cargas visibles, ventana sin cargas y firma sin Pipedrive', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas')
    await page.goto('/estado')
    const loads = page.getByTestId('status-loads')
    await expect(loads.getByTestId('load-pipedrive')).toBeVisible()
    await expect(loads.getByTestId('load-store_sales')).toContainText('Cifras de ventas por tienda')
    await expect(loads.getByTestId('load-sales_file').getByTestId('load-owner')).toContainText('Debe terminar a las 07:00')
    const win = loads.getByTestId('load-window-MX')
    await win.getByTestId('window-starts').fill('02:00')
    await win.getByTestId('window-ends').fill('03:00')
    await win.getByTestId('window-active').check()
    await win.getByTestId('window-save-MX').click()
    await expect(page.getByText('Ventana guardada.')).toBeVisible()
    await expect(page.getByTestId('status-esign')).toContainText('Pipedrive no interviene')
    await expect(page.getByTestId('status-row-store_sales')).toBeVisible()
    for (const w of ['desktop', 'movil'] as const) {
      await at(page, w)
      await clean(page, `estado ${w}`)
    }
    await setLocale(page, 'en')
    await expect(page.getByTestId('status-loads')).toContainText('Data loads')
    expect(errors).toEqual([])
  })

  test('Administración: respaldo de Pipedrive y la hoja de leads de México', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=pipedrive')
    const tools = page.getByTestId('migration-tools')
    await expect(tools.getByTestId('test-reset-form')).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), tools.getByTestId('pipedrive-backup-link').click()])
    const json = JSON.parse(readFileSync((await download.path())!, 'utf8')) as { format: string }
    expect(json.format).toBe('contigo-pipedrive-backup/v1')
    for (const w of ['desktop', 'movil'] as const) {
      await at(page, w)
      await clean(page, `admin pipedrive ${w}`)
    }
    await at(page, 'desktop')
    await tools.getByTestId('mx-sheet-link').click()
    await expect(page).toHaveURL(/\/importar\?tipo=mx_leads/)
    await expect(page.getByText('Hoja de leads de México (corte)').first()).toBeVisible()
    // Quien no administra no baja el respaldo.
    await loginAs(page, 'ana.robles')
    const res = await page.request.get('/admin/respaldo-pipedrive')
    expect(res.status()).toBe(404)
  })
})
