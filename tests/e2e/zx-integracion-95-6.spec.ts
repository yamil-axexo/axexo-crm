import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb } from './helpers'

// Integración 95-6 en pantalla (datos2, embudo2, campo2, reportes2): Finanzas es un solo rol (solo lectura salvo cuando la
// decisión por mercado le abre cambiar dueños, fusionar y editar en bloque); Estado de CONTIGO muestra UNA lista de valores
// propuestos con las cuatro fuentes y su dueño; el tablero de Negocios tiene una sola entrada de vistas guardadas.
const sql = testDb()

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function freshLogin(page: Page, persona: string) {
  for (let i = 0; i < 2; i++) {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByTestId(`persona-${persona}`).click()
    await page.waitForURL(/\/(bienvenida|hoy|partners|reportes\/finanzas)$/)
    if (!/bienvenida$/.test(page.url())) break
  }
}
const setOperatorRights = async (value: 'on' | 'off') => {
  await sql`delete from crm.decision_settings where key = 'ops.operator_rights' and market_code = 'MX'`
  await sql`insert into crm.decision_settings (key, market_code, value, proposed, owner_label) values ('ops.operator_rights', 'MX', to_jsonb(${value}::text), ${value === 'off'}, 'Martech')`
}

test.describe.configure({ mode: 'serial' })
test.use({ reducedMotion: 'reduce' })
test.afterAll(async () => { await setOperatorRights('off'); await sql.end() })

test.describe('integración 95-6', () => {
  test('Finanzas: solo lectura con la decisión apagada; con la decisión encendida en México ya no dice "solo lectura"', async ({ page }) => {
    const errors = pageErrors(page)
    await setOperatorRights('off')
    await freshLogin(page, 'marta.ibanez')
    await expect(page).toHaveURL(/\/reportes\/finanzas$/)
    await openMenu(page)
    await expect(page.getByTestId('me-read-only')).toBeVisible()
    await setOperatorRights('on')
    await page.reload()
    await openMenu(page)
    await expect(page.getByTestId('me-read-only')).toHaveCount(0)
    await setOperatorRights('off')
    expect(errors).toEqual([])
  })

  test('Estado de CONTIGO: una sola lista de valores propuestos, con las cuatro fuentes y su dueño, a 1440 y 390', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas')
    for (const w of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(w)
      await page.goto('/estado')
      await expect(page.getByTestId('status-proposed')).toHaveCount(1)
      for (const s of ['decision', 'funnel', 'field', 'board']) await expect(page.locator(`[data-testid="status-proposed-row"][data-source="${s}"]`).first(), s).toBeVisible()
      const rows = page.getByTestId('status-proposed-row')
      for (const r of await rows.all()) await expect(r).toContainText('pendiente:')
      await clean(page, `estado ${w.width}`)
    }
    // "Dónde se cambia" lleva a la pantalla de su fuente.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('[data-testid="status-proposed-row"][data-source="decision"]').first().getByTestId('status-proposed-open').click()
    await expect(page).toHaveURL(/\/admin\/decisiones$/)
    expect(errors).toEqual([])
  })

  test('tablero de Negocios: una sola entrada de vistas guardadas, plegada, que no empuja las columnas', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    const p = (await sql<{ id: string }[]>`select md5('contigo:p-mx-d2d')::uuid as id`)[0]!
    await page.goto(`/pipelines/${p.id}`)
    await expect(page.getByTestId('board-views')).toHaveCount(1)
    await page.getByTestId('board-views-toggle').click()
    await expect(page.getByTestId('board-views')).toHaveAttribute('open', '')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByTestId('board-views')).toHaveCount(1)
    await clean(page, 'tablero 390')
  })
})
