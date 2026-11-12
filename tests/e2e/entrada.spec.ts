import { test, expect } from '@playwright/test'
import { loginAs, openMenu, testDb, WIDTHS } from './helpers'

/** Deja a una persona de prueba como si nunca hubiera entrado. */
async function neverSeen(persona: string) {
  const sql = testDb()
  await sql`delete from crm.user_onboarding where user_id = (select id from crm.users where email::text like ${persona + '@%'})`
  await sql.end()
}

for (const w of WIDTHS) {
  test.describe(`entrada en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('la entrada cuenta qué es CONTIGO, por rol, qué ya funciona y responde las dudas', async ({ page }) => {
      await page.goto('/login')
      await expect(page.locator('h1')).toHaveText('Cada comercio, con su próximo paso.')
      await expect(page.getByTestId('landing-roles').locator('h3')).toHaveText(['Ventas', 'Supervisión', 'Líder de mercado', 'Operaciones', 'Leadership', 'Administración'])
      await expect(page.getByTestId('landing-status').getByText('Todavía no', { exact: true })).toHaveCount(3)
      const faq = page.getByTestId('landing-faq').locator('details')
      await expect(faq).toHaveCount(6)
      await faq.first().locator('summary').click()
      await expect(faq.first().locator('p')).toBeVisible()
      // en este ambiente no hay Google: se dice y se ofrece la entrada de prueba
      await expect(page.getByTestId('sso-off')).toBeVisible()
      await expect(page.getByTestId('persona-marco.pena')).toBeVisible()
    })
  })
}

test('la entrada cambia a inglés completa', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('locale-toggle').click()
  await expect(page.locator('h1')).toHaveText('Every merchant, with its next step.')
  await expect(page.getByTestId('landing-roles').locator('h3')).toHaveText(['Sales', 'Supervisor', 'Market lead', 'Operations', 'Leadership', 'Admin'])
  await expect(page.getByTestId('landing-status').getByText('Not yet', { exact: true })).toHaveCount(3)
  await page.getByTestId('locale-toggle').click()
  await expect(page.locator('h1')).toHaveText('Cada comercio, con su próximo paso.')
})

test('primer ingreso: bienvenida con el paso a paso de su rol y una lista que se marca y se esconde', async ({ page }) => {
  await neverSeen('lucia.vega')
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId('persona-lucia.vega').click()
  await expect(page).toHaveURL(/\/bienvenida$/)
  await expect(page.getByTestId('welcome-track')).toHaveText('Ventas')
  await expect(page.getByTestId('welcome-title')).toHaveText('Te damos la bienvenida a CONTIGO, Lucía.')
  await expect(page.getByTestId('how-step')).toHaveCount(4)
  await expect(page.getByTestId('onboarding-progress')).toHaveText('0 de 8')

  // marcar y desmarcar
  const first = page.getByTestId('step-today')
  await first.getByTestId('step-toggle').click()
  await expect(first).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('onboarding-progress')).toHaveText('1 de 8')
  await page.getByTestId('step-complete').getByTestId('step-toggle').click()
  await expect(page.getByTestId('onboarding-progress')).toHaveText('2 de 8')
  await first.getByTestId('step-toggle').click()
  await expect(first).toHaveAttribute('data-done', 'false')
  await expect(page.getByTestId('onboarding-progress')).toHaveText('1 de 8')

  // en Hoy queda el recordatorio con el avance, y se puede esconder
  await page.getByTestId('welcome-go').click()
  await expect(page).toHaveURL(/\/hoy$/)
  await expect(page.getByTestId('hoy-onboarding')).toContainText('1 de 8 hechos')
  await page.getByTestId('hoy-onboarding-hide').click()
  await expect(page.getByTestId('hoy-onboarding')).toHaveCount(0)

  // la página sigue en el menú, con lo marcado, y la lista se puede volver a mostrar
  await openMenu(page)
  await page.getByTestId('nav-welcome').click()
  await expect(page).toHaveURL(/\/bienvenida$/)
  await expect(page.getByTestId('onboarding-progress')).toHaveText('1 de 8')
  await page.getByTestId('onboarding-show').click()
  await expect(page.getByTestId('onboarding-hide')).toBeVisible()

  // la segunda vez entra directo a Hoy
  await loginAs(page, 'lucia.vega')
  await expect(page.getByTestId('hoy-onboarding')).toBeVisible()
})

test('cada rol recibe su propio recorrido', async ({ page }) => {
  for (const [persona, label, steps] of [['fernando.ibarra', 'Supervisión', 8], ['ana.robles', 'Líder de mercado', 7], ['valeria.soto', 'Operaciones', 6], ['luis.tovar', 'Leadership', 5], ['nora.salas', 'Administración', 8]] as const) {
    await loginAs(page, persona)
    await page.goto('/bienvenida')
    await expect(page.getByTestId('welcome-track'), persona).toHaveText(label)
    await expect(page.getByTestId('onboarding').locator('li[data-testid^="step-"]'), persona).toHaveCount(steps)
  }
})

test('ayuda: se filtra al escribir y por rol, y está en el menú', async ({ page }) => {
  await loginAs(page, 'marco.pena')
  await openMenu(page)
  await page.getByTestId('nav-help').click()
  await expect(page).toHaveURL(/\/ayuda$/)
  const items = page.getByTestId('help-item')
  const all = await items.count()
  expect(all).toBeGreaterThan(25)
  await page.getByTestId('help-mine').click()
  expect(await items.count()).toBeLessThan(all) // lo de administración no es de quien vende
  await page.getByTestId('help-all').click()
  await page.getByTestId('help-search').fill('pantalla de inicio')
  await expect(items).toHaveCount(1)
  await items.first().locator('summary').click()
  await expect(items.first().locator('p')).toContainText('navegador')
  await page.getByTestId('help-search').fill('zzzz')
  await expect(page.getByTestId('help-empty')).toBeVisible()
})
