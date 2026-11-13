import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, WIDTHS } from './helpers'

// Paquete conectores (0044): Estado de CONTIGO muestra cada conector apagado, qué le falta (solo nombres de variables) y
// "Probar conexión" para administración, que en apagado explica por qué no corre y queda en la bitácora.
async function clean(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).include('[data-testid="status-connectors"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target}`), what).toEqual([])
}

test('administración ve los conectores apagados con lo que falta y prueba uno', async ({ page }) => {
  await loginAs(page, 'nora.salas')
  await page.goto('/estado')
  const card = page.getByTestId('status-connectors')
  await expect(card).toBeVisible()
  await expect(card.getByText('Conectores', { exact: true })).toBeVisible()
  const email = card.getByTestId('connector-email')
  await expect(email.getByTestId('connector-mode')).toHaveText('Apagado')
  await expect(email.getByTestId('connector-missing')).toContainText('EMAIL_ADAPTER_APPROVAL')
  await expect(email.getByTestId('connector-missing')).toContainText('GOOGLE_SERVICE_ACCOUNT_KEY')
  await expect(email.getByTestId('connector-approval')).toContainText('Sin referencia de aprobación')
  await expect(card.getByTestId('connector-web_push')).toBeVisible()
  await email.getByTestId('connector-test-btn-email').click()
  await expect(email.getByTestId('form-ok')).toContainText('No se probó porque está apagado')
  await expect(email.getByTestId('connector-last-test')).toContainText('Sin conexión')
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await clean(page, `estado conectores ${w.name}`)
  }
})

test('en inglés, y quien lidera Leadership lo ve sin el botón', async ({ page }) => {
  await loginAs(page, 'luis.tovar')
  await page.goto('/estado')
  const card = page.getByTestId('status-connectors')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('connector-test-btn-email')).toHaveCount(0)
  await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
  await page.reload()
  await expect(page.getByTestId('status-connectors').getByText('Connectors', { exact: true })).toBeVisible()
  await expect(page.getByTestId('connector-email').getByTestId('connector-mode')).toHaveText('Off')
})
