import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WIDTHS, loginAs, pageErrors, testDb } from './helpers'

// Paquete integraciones-migracion (programa "los 95"): E6.F2 (lo editado en CONTIGO manda), GOB-05 y E6.F3 (convivencia
// y corte por mercado), y lo que el equipo armó en Pipedrive reconstruido en CONTIGO (automatizaciones, turno, reportes,
// tableros, meta y filtros). Administración decide un choque, pone fecha de corte y congela; ve qué falta por reconstruir;
// la meta se ve y se ajusta en el Panel; los tableros salen en Reportes.

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

test.describe('convivencia con Pipedrive y lo reconstruido', () => {
  let accountId = ''
  let originalName = ''
  test.beforeAll(async () => {
    const a = (await sql<{ id: string; name: string }[]>`select id, name from crm.accounts where market_code = 'US' and archived_at is null order by id limit 1`)[0]!
    accountId = a.id
    originalName = a.name
    await sql`delete from crm.import_conflicts`
    await sql`insert into crm.import_conflicts (object, record_id, market_code, record_label, field, contigo_value, pipedrive_value)
              values ('account', ${a.id}, 'US', ${a.name}, 'name', to_jsonb(${a.name}::text), to_jsonb('Nombre que trae Pipedrive'::text))`
  })
  test.afterAll(async () => {
    await sql`update crm.accounts set name = ${originalName} where id = ${accountId}`
    await sql`delete from crm.import_conflicts`
    await sql`delete from crm.pipedrive_cutover`
    await sql`update crm.goals set target = null where key = 'pd_deals_won_us'`
    await sql.end()
  })

  test('administración decide un choque y lleva el corte de un mercado', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=pipedrive')
    const cut = page.getByTestId('cutover')
    await expect(cut.getByTestId('cutover-US')).toBeVisible()
    await expect(cut.getByTestId('cutover-MX')).toBeVisible()
    await expect(cut.getByTestId('cutover-MX').getByTestId('criterion-date')).toHaveAttribute('data-ok', 'no')
    await expect(cut.getByTestId('cutover-MX').getByTestId('cutover-missing')).toContainText('Falta para apagar Pipedrive')

    // El choque: CONTIGO y Pipedrive dicen cosas distintas; se ve lo de cada lado y una persona decide.
    const row = page.getByTestId('conflicts').getByTestId('conflict-row').first()
    await expect(row.getByTestId('conflict-contigo')).toHaveText(originalName)
    await expect(row.getByTestId('conflict-pipedrive')).toHaveText('Nombre que trae Pipedrive')
    await row.getByTestId('conflict-take').click()
    await expect(page.getByTestId('conflicts')).toContainText('No hay choques por decidir')
    expect((await sql<{ name: string }[]>`select name from crm.accounts where id = ${accountId}`)[0]!.name).toBe('Nombre que trae Pipedrive')

    // Corte de México: fecha, congelar, y el estado lo dice. Apagar todavía no aparece: falta la última sincronización.
    await page.getByTestId('cutoff-MX').fill('2026-12-15')
    await page.getByTestId('cutoff-save-MX').click()
    await expect(cut.getByTestId('cutover-MX').getByTestId('criterion-date')).toHaveAttribute('data-ok', 'yes')
    await page.getByTestId('freeze-MX').click()
    await expect(cut.getByTestId('cutover-MX')).toContainText('Pipedrive congelado')
    await expect(page.getByTestId('off-MX')).toHaveCount(0)
    await expect(cut.getByTestId('cutover-MX').getByTestId('criterion-freeze')).toContainText('falta correr la última sincronización')
    await page.getByTestId('freeze-MX').click() // descongelar
    await expect(cut.getByTestId('cutover-MX')).toContainText('Conviven los dos')

    // Qué falta por reconstruir: todo el inventario de Pipedrive, cada pieza con su estado y su lugar.
    const rebuild = page.getByTestId('rebuild')
    await expect(rebuild.getByTestId('rebuild-row')).toHaveCount(39)
    await expect(rebuild).toContainText('Owner - Valentina at Approvals (US)')
    await expect(rebuild).toContainText('Las Vegas Round Robin')
    await at(page, 'desktop')
    await clean(page, 'pipedrive 1440')
    await at(page, 'movil')
    await clean(page, 'pipedrive 390')
    await setLocale(page, 'en')
    await expect(page.getByTestId('rebuild')).toContainText('What is left to rebuild')
    await expect(page.getByTestId('cutover')).toContainText('Coexistence with Pipedrive by market')
    await setLocale(page, 'es')
    expect(errors).toEqual([])
  })

  test('las automatizaciones de Pipedrive tienen su sección; la #1 se configura sin nombres fijos', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin/automatizaciones')
    const pd = page.getByTestId('auto-pipedrive')
    await expect(pd.getByTestId('auto-pd-row')).toHaveCount(10)
    await expect(page.locator('[data-testid="auto-market"][data-market="US"]').getByTestId('auto-row')).toHaveCount(9)
    await pd.locator('[data-testid="auto-pd-row"][data-key="pd_owner_at_approvals"]').getByTestId('auto-open').click()
    await expect(page.getByTestId('auto-pd-note')).toContainText('Owner - Valentina at Approvals (US)')
    await expect(page.getByTestId('auto-edit')).toHaveCount(0)
    await page.getByTestId('auto-handoff-to').selectOption('queue')
    await page.getByTestId('auto-handoff-save').click()
    await expect(page.getByTestId('auto-handoff-form')).toContainText('Guardado')
    await at(page, 'movil')
    await clean(page, 'automatización de Pipedrive 390')
  })

  test('la meta "Deals won" se ve y se ajusta en el Panel; los tableros salen en Reportes', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/panel-lt?mercado=US')
    const goal = page.getByTestId('goals').getByTestId('goal').first()
    await expect(goal).toContainText('Negocios ganados del mes')
    await expect(goal.getByTestId('goal-no-target')).toBeVisible()
    await goal.getByTestId('goal-target').fill('20')
    await goal.getByTestId('goal-save').click()
    await expect(goal.getByTestId('goal-progress')).toContainText('de 20')
    await setLocale(page, 'en')
    await expect(page.getByTestId('goals')).toContainText('Deals won this month')
    await setLocale(page, 'es')

    await page.goto('/reportes')
    const boards = page.getByTestId('report-boards')
    await expect(boards.locator('[data-testid="report-board"][data-key="us_dealer_ops"]')).toContainText('US · Alta de dealers, Operaciones')
    await expect(boards.locator('[data-testid="report-board"][data-key="us_dealer_ops"]').getByTestId('board-report')).toHaveCount(8)
    await boards.locator('[data-testid="report-board"][data-key="us_dealer_ops"]').getByTestId('board-report').first().click()
    await expect(page).toHaveURL(/\/reportes\/etapas\?/)
    await page.goto('/reportes')
    await at(page, 'desktop')
    await clean(page, 'reportes 1440')
    await at(page, 'movil')
    await clean(page, 'reportes 390')

    await page.goto('/estado')
    await expect(page.getByText('Adaptador apagado').first()).toBeVisible()
    await expect(page.locator('body')).toContainText('CONTIGO no tiene acceso a Zoho')
  })
})
