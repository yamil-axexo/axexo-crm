import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors } from './helpers'

// Integración 95-7 en pantalla (conectores y plataforma sobre la ola 6): Estado de CONTIGO lista con la misma regla de
// encendido los conectores que trajo la ola 6 y las pantallas en vivo, cada uno con lo que le falta (solo nombres de
// variables); los pendientes de plataforma están en la lista única de valores propuestos y no se repiten en otra tarjeta.
async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

test.use({ reducedMotion: 'reduce' })

test('Estado de CONTIGO: conectores de la ola 6 y Broadcast con la regla única; pendientes de plataforma en la lista única', async ({ page }) => {
  const errors = pageErrors(page)
  await loginAs(page, 'nora.salas')
  for (const w of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(w)
    await page.goto('/estado')
    const card = page.getByTestId('status-connectors')
    for (const k of ['report_slack', 'feedback_to_pt', 'academy_progress', 'lakehouse_crossmatch', 'realtime']) {
      const row = card.getByTestId(`connector-${k}`)
      await expect(row, k).toBeVisible()
      await expect(row.getByTestId('connector-missing'), k).toContainText('_APPROVAL')
    }
    await expect(page.getByTestId('status-platform').getByTestId('status-pending-value')).toHaveCount(0)
    await expect(page.locator('[data-testid="status-proposed-row"][data-source="platform"]').first()).toBeVisible()
    await clean(page, `estado ${w.width}`)
  }
  expect(errors).toEqual([])
})
