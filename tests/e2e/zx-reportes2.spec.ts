import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, testDb } from './helpers'

/**
 * Paquete `reportes2` (ola 6): rol de Finanzas, rol KAM con su tablero y el pronóstico por categoría, tableros de Operaciones y del
 * partner, Panel del LT por tipo de venta, histórico por equipo y por corte, valores propuestos con su dueño, personas de los
 * comercios con vistas, 1:1 con el tablero y el PDF del pedido. Cada prueba recorre el flujo principal con el rol que corresponde.
 */
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function both(page: Page, label: string, check: () => Promise<void>) {
  for (const w of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(w)
    await page.reload()
    await check()
    await noOverflow(page, `${label} ${w.width}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.describe('Finanzas', () => {
  test('entra a su reporte, ve el costo de CONTIGO y baja el detalle de visitas; no ve los reportes de ventas', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByTestId('persona-marta.ibanez').click()
    await expect(page).toHaveURL(/\/reportes\/finanzas$/)
    await expect(page.locator('h1')).toContainText('Finanzas')
    await expect(page.getByTestId('finance-costs')).toBeVisible()
    await expect(page.getByTestId('finance-board-proposed')).toContainText('Valor propuesto')
    await expect(page.getByTestId('rb-financeCostPerAi')).toContainText('Cómo se calcula')
    await expect(page.getByTestId('finance-visit-detail')).toBeVisible()
    const res = await page.request.get('/reportes/visitas/export?mercado=MX&motivo=Cruce%20con%20reembolsos%20de%20millas')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    await both(page, 'finanzas', async () => { await expect(page.getByTestId('finance-costs')).toBeVisible() })
    await axeClean(page, 'finanzas')
    await page.goto('/reportes')
    await expect(page.getByTestId('report-finanzas')).toBeVisible()
    await expect(page.getByTestId('report-leads')).toHaveCount(0)
    await expect(page.getByTestId('report-kam')).toHaveCount(0)
  })
})

test.describe('cuentas clave (KAM) y pronóstico', () => {
  test('la persona KAM ve su tablero, pone la categoría y envía el pronóstico; quien dirige ajusta al lado con nota', async ({ page }) => {
    await loginAs(page, 'elena.duarte')
    await page.goto('/reportes')
    await page.getByTestId('report-kam').click()
    await expect(page).toHaveURL(/\/reportes\/kam/)
    await expect(page.getByTestId('kam-board')).toBeVisible()
    await expect(page.getByTestId('kam-board-proposed')).toContainText('pendiente')
    await expect(page.getByTestId('rb-kamAccounts')).toContainText('1')
    await expect(page.getByTestId('kam-account')).toHaveCount(1)
    await page.getByTestId('forecast-category').first().selectOption('commit')
    await page.getByTestId('forecast-save').first().click()
    await expect(page.getByTestId('kam-deal-category').first()).toContainText('Comprometido')
    await page.getByTestId('forecast-submit-btn').click()
    await expect(page.getByTestId('forecast-submission')).toHaveCount(1)
    await expect(page.getByTestId('forecast-submission').first()).toContainText('Versión 1')
    await both(page, 'kam', async () => { await expect(page.getByTestId('kam-board')).toBeVisible() })
    await axeClean(page, 'kam')

    await loginAs(page, 'paula.mendez')
    await page.goto('/reportes/kam')
    await page.getByTestId('forecast-adjust-category').first().selectOption('best_case')
    await page.getByTestId('forecast-adjust-note').first().fill('Compras pidió otra semana')
    await page.getByTestId('forecast-adjust-save').first().click()
    await expect(page.getByTestId('kam-deal-category').first()).toContainText('Mejor caso')
    await expect(page.getByTestId('kam-deal-category').first()).toContainText('Comprometido')

    await loginAs(page, 'marco.pena')
    expect((await page.goto('/reportes/kam'))?.status()).toBe(404)
  })
})

test.describe('tableros de Operaciones y del partner, y Panel del LT por tipo de venta', () => {
  test('Operaciones ve su tablero con definición y dueño', async ({ page }) => {
    await loginAs(page, 'valeria.soto')
    await page.goto('/reportes/operaciones')
    await expect(page.getByTestId('ops-board')).toBeVisible()
    await expect(page.getByTestId('rb-opsPullThrough')).toContainText('Aprobados en mesa de control')
    await both(page, 'operaciones', async () => { await expect(page.getByTestId('ops-board')).toBeVisible() })
    await axeClean(page, 'operaciones')
  })
  test('el partner ve en su portal de 5 a 7 cifras, cada una con su definición', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByTestId('persona-iso.partner').click()
    await expect(page).toHaveURL(/\/partners$/)
    await expect(page.getByTestId('partner-board')).toBeVisible()
    const n = await page.getByTestId('partner-board').locator('[data-testid^="rb-partner"]').count()
    expect(n).toBeGreaterThanOrEqual(5)
    expect(n).toBeLessThanOrEqual(7)
    await expect(page.getByTestId('rb-partnerPoints')).toContainText('How it is calculated')
    await both(page, 'partner', async () => { await expect(page.getByTestId('partner-board')).toBeVisible() })
  })
  test('el Panel del LT corta por tipo de venta', async ({ page }) => {
    await loginAs(page, 'luis.tovar')
    await page.goto('/panel-lt')
    await expect(page.getByTestId('lt-by-motor')).toBeVisible()
    expect(await page.getByTestId('lt-motor-row').count()).toBeGreaterThanOrEqual(3)
    await expect(page.getByTestId('lt-by-motor')).toContainText('Tiendas, puerta a puerta')
  })
})

test.describe('histórico, adopción y personas de los comercios', () => {
  test('supervisión ve la foto de su equipo y corta las cohortes por canal y persona', async ({ page }) => {
    const db = testDb()
    // La foto la toma la tarea diaria (probada en tests/db); aquí se prueba la pantalla con una foto de hoy.
    await db`insert into crm.team_snapshots (snapshot_date, market_code, team_id, open_deals, no_next_step, active_accounts, at_risk_accounts)
             select (now() at time zone 'America/Mexico_City')::date, t.market_code, t.id, 3, 1, 2, 0 from crm.teams t where t.market_code = 'MX' on conflict do nothing`
    await db.end()
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/historico')
    await expect(page.getByTestId('team-snapshot-row')).toHaveCount(1)
    await page.getByTestId('cohort-cut-select').selectOption({ label: 'Canal' })
    await expect(page).toHaveURL(/por=canal/)
    await expect(page.getByTestId('cohort-cut-row').first()).toBeVisible()
    await both(page, 'historico', async () => { await expect(page.getByTestId('cohort-cut')).toBeVisible() })
  })
  test('quien supervisa anota una 1:1 con el tablero y cuenta en adopción', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/adopcion')
    await expect(page.getByTestId('usage-rollout-rule')).toContainText('Valor propuesto')
    await page.getByTestId('one-on-one-person').selectOption({ label: 'Marco Peña' })
    await page.getByTestId('one-on-one-save').click()
    await expect(page.getByText('1:1 anotada.')).toBeVisible()
    await page.reload()
    const row = page.getByTestId('adoption-row').filter({ hasText: 'Marco Peña' })
    await expect(row.getByTestId('adoption-1on1')).toHaveText('1')
  })
  test('la lista de personas de los comercios se guarda como vista del equipo', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/personas?role=owner')
    await expect(page.locator('h1')).toHaveText('Personas de los comercios')
    await expect(page.getByTestId('contacts-table').or(page.getByText('Nadie con estos filtros'))).toBeVisible()
    await both(page, 'personas', async () => { await expect(page.getByTestId('contacts-filters')).toBeVisible() })
    await axeClean(page, 'personas')
  })
})

test.describe('Administración: tableros y valores propuestos; PDF del pedido', () => {
  test('administración confirma un tablero y Estado de CONTIGO lista lo que sigue pendiente con su dueño', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/estado')
    await expect(page.getByTestId('status-proposed')).toBeVisible()
    const before = await page.getByTestId('status-proposed-row').count()
    expect(before).toBeGreaterThan(0)
    await page.getByTestId('status-proposed-link').click()
    await expect(page).toHaveURL(/\/admin\/tableros$/)
    await page.getByTestId('rb-confirm-ops').check()
    await page.getByTestId('rb-save-ops').click()
    await expect(page.getByText('Tablero guardado.')).toBeVisible()
    await page.goto('/estado')
    await expect(page.getByTestId('status-proposed-row')).toHaveCount(before - 1)
    await page.goto('/admin/tableros')
    await both(page, 'tableros', async () => { await expect(page.getByTestId('role-boards-admin')).toBeVisible() })
    await axeClean(page, 'tableros')
  })
  test('el pedido se descarga como PDF armado por CONTIGO con la plantilla de marca', async ({ page }) => {
    const db = testDb()
    const [deal] = await db<{ id: string }[]>`select d.id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id and p.has_items
      where d.market_code = 'US' and exists (select 1 from crm.deal_items i where i.deal_id = d.id) order by d.id limit 1`
    await db.end()
    await loginAs(page, 'robert.hale')
    await page.goto(`/deals/${deal!.id}/pedido`)
    await expect(page.getByTestId('order-header')).toHaveText('Empower Retailer Solutions')
    await expect(page.getByTestId('order-brand-proposed')).toContainText('pending')
    const res = await page.request.get(`/deals/${deal!.id}/pedido/pdf`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('application/pdf')
    expect((await res.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
