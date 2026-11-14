import { test, expect } from '@playwright/test'
import { loginAs, openMenu, pageErrors } from './helpers'

const PAGES = ['/hoy', '/leads', '/pipelines', '/comercios', '/actividades', '/buscar?q=esperanza']

for (const persona of ['nora.salas', 'luis.tovar', 'ana.robles', 'fernando.ibarra', 'marco.pena', 'valeria.soto', 'robert.hale', 'sam.ortiz']) {
  test(`cada pantalla abre sin errores para ${persona}`, async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, persona)
    for (const path of PAGES) {
      const res = await page.goto(path)
      expect(res?.status(), path).toBeLessThan(400)
      await expect(page.locator('h1').first()).toBeVisible()
    }
    for (const nav of ['nav-supervisor', 'nav-panel-lt', 'nav-admin']) {
      const link = page.getByTestId(nav)
      if (await link.count()) {
        await openMenu(page)
        await link.click()
        await expect(page.locator('h1').first()).toBeVisible()
      }
    }
    await page.goto('/leads')
    await page.getByTestId('lead-row').first().locator('a').first().click()
    await expect(page.locator('h1')).toBeVisible()
    await page.goto('/comercios')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await expect(page.getByTestId('account-facts')).toBeVisible()
    await page.goto('/pipelines')
    const card = page.getByTestId('deal-card').first()
    if (await card.count()) {
      await card.click()
      await expect(page.getByTestId('stage-path')).toBeVisible()
    }
    expect(errors, errors.join('\n')).toEqual([])
  })
}
