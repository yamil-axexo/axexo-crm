import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, WIDTHS } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const DESTINATIONS = [
  { id: 'nav-today', url: /\/hoy$/ },
  { id: 'nav-leads', url: /\/leads$/ },
  { id: 'nav-deals', url: /\/pipelines/ },
  { id: 'nav-merchants', url: /\/comercios$/ },
] as const

/** Nada se sale del ancho: ni tablas ni filas provocan scroll horizontal de la página. */
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

/** Accesibilidad WCAG 2.2 AA: ningún hallazgo serio ni crítico. */
async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

for (const w of WIDTHS) {
  test.describe(`navegación en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('el dock lleva a los cuatro destinos y marca dónde estás', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      await expect(page.getByTestId('dock').getByRole('link')).toHaveCount(4)
      for (const d of DESTINATIONS) {
        await page.getByTestId(d.id).click()
        await expect(page).toHaveURL(d.url)
        await expect(page.getByTestId(d.id)).toHaveAttribute('aria-current', 'page')
        await expect(page.getByTestId('dock').locator('[aria-current="page"]')).toHaveCount(1)
        await expect(page.locator('h1').first()).toBeVisible()
        await noSideScroll(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-${d.id.slice(4)}.png` })
      }
    })

    test('el botón crear abre el formulario de lead y el de comercio', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      await page.getByTestId('dock-create').click()
      await page.getByTestId('dock-create-menu').getByRole('menuitem', { name: 'Lead' }).click()
      await expect(page).toHaveURL(/\/leads$/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByTestId('dock-create').click()
      await page.getByTestId('dock-create-menu').getByRole('menuitem', { name: 'Comercio' }).click()
      await expect(page).toHaveURL(/\/comercios$/)
      await expect(page.getByRole('dialog')).toBeVisible()
    })

    test('el menú de la cuenta muestra quién eres y solo lo que tu rol permite', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      await openMenu(page)
      await expect(page.getByTestId('me-name')).toBeVisible()
      await expect(page.getByTestId('me-roles')).toHaveText('Ventas · MX')
      await expect(page.getByTestId('nav-admin')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('me-panel')).toBeHidden()
      await loginAs(page, 'nora.salas')
      await openMenu(page)
      await page.getByTestId('nav-admin').click()
      await expect(page).toHaveURL(/\/admin/)
      await expect(page.getByTestId('me-panel')).toBeHidden()
    })

    test('las pantallas principales pasan accesibilidad AA', async ({ page }) => {
      await loginAs(page, 'nora.salas')
      for (const path of ['/hoy', '/leads', '/pipelines', '/comercios', '/buscar?q=tienda']) {
        await page.goto(path)
        await expect(page.locator('h1').first()).toBeVisible()
        await axe(page, `${w.name} ${path}`)
      }
      await openMenu(page)
      await axe(page, `${w.name} menú de cuenta`)
    })
  })
}

test('en desktop la tecla "/" lleva a buscar y Enter abre los resultados', async ({ page }) => {
  await loginAs(page, 'marco.pena')
  await page.locator('h1').first().click()
  await page.keyboard.press('/')
  await expect(page.getByTestId('global-search')).toBeFocused()
  await page.keyboard.type('tienda')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/buscar\?q=tienda/)
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('buscar es un botón arriba y el idioma se cambia desde el menú', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await expect(page.getByTestId('global-search')).toBeHidden()
    await page.getByTestId('search-link').click()
    await expect(page).toHaveURL(/\/buscar/)
    await openMenu(page)
    await page.getByTestId('me-panel').getByRole('menuitem', { name: 'Cambiar idioma a inglés' }).click()
    await expect(page.getByTestId('nav-today')).toHaveText('Today')
    await openMenu(page)
    await page.getByTestId('me-panel').getByRole('menuitem', { name: /Spanish/ }).click()
    await expect(page.getByTestId('nav-today')).toHaveText('Hoy')
  })
})

test('la pantalla de entrada pasa accesibilidad AA en los tres anchos', async ({ page }) => {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await page.context().clearCookies()
    await page.goto('/login')
    await axe(page, `login ${w.name}`)
    await noSideScroll(page)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-login.png` })
  }
})

test('sin señal: aparece el aviso y guardar queda deshabilitado con su etiqueta; al volver la señal todo regresa', async ({ page, context }) => {
  await loginAs(page, 'marco.pena')
  await page.goto('/leads')
  await page.getByTestId('new-lead').click()
  const save = page.getByTestId('save-lead')
  await expect(save).toBeEnabled()
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)
  await context.setOffline(true)
  await expect(page.getByTestId('offline-banner')).toContainText('Sin señal')
  await expect(save).toHaveCSS('pointer-events', 'none')
  await expect(save).toHaveCSS('border-top-style', 'dashed')
  expect(await save.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('sin señal')
  // sin señal, un enlace no lleva a la pantalla de error del navegador: se queda donde está y avisa
  await page.keyboard.press('Escape')
  await page.getByTestId('nav-deals').click()
  await expect(page.getByTestId('toast')).toContainText('Sin señal: no se puede abrir otra pantalla')
  await expect(page).toHaveURL(/\/leads$/)
  await expect(page.locator('h1').first()).toHaveText('Leads')
  await context.setOffline(false)
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)
  await page.getByTestId('nav-deals').click()
  await expect(page).toHaveURL(/\/pipelines/)
})

test('un enlace manipulado no tira la página: parámetros repetidos, ids con mala forma y cursores inválidos', async ({ page }) => {
  await loginAs(page, 'nora.salas')
  for (const path of [
    '/leads?owner=zzz', '/comercios?owner=zzz', '/pipelines?owner=zzz', '/supervisor?owner=zzz',
    '/comercios?q=a&q=b', '/leads?q=a&q=b&status=new&status=open', '/buscar?q=a&q=b', '/hoy?ver=equipo&ver=x',
    '/comercios?after=x%7Cy', '/leads?before=x%7Cy', '/admin?tab=auditoria&before=x%7Cy', '/comercios?ficha=no-es-un-id&tab=zzz', '/comercios?vista=arbol&owner=me&q=%25',
  ]) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBeLessThan(500)
    await expect(page.locator('h1').first(), path).toBeVisible()
  }
})

test.describe('tablet vertical (768 px)', () => {
  test.use({ viewport: { width: 768, height: 1024 } })
  test('la ficha ocupa la pantalla completa y el menú de cuenta queda por encima', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/comercios')
    await page.getByTestId('account-row').first().locator('a').click()
    const panel = page.getByTestId('ficha-panel')
    await expect(panel).toBeVisible()
    await expect.poll(async () => panel.evaluate((el) => el.getAnimations().filter((x) => x.playState === 'running').length)).toBe(0)
    const box = (await panel.boundingBox())!
    expect(Math.round(box.x)).toBe(0)
    expect(Math.round(box.width)).toBe(768)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await openMenu(page)
    await page.getByTestId('nav-supervisor').click()
    await expect(page).toHaveURL(/\/supervisor/)
  })
})

test('en desktop el menú de cuenta se puede usar con la ficha abierta y los destinos del dock miden 128 px', async ({ page }) => {
  await loginAs(page, 'fernando.ibarra')
  expect(Math.round((await page.getByTestId('nav-today').boundingBox())!.width)).toBe(128)
  await page.goto('/comercios')
  await page.getByTestId('account-row').first().locator('a').click()
  await expect(page.getByTestId('ficha-panel')).toBeVisible()
  await openMenu(page)
  await page.getByTestId('nav-supervisor').click()
  await expect(page).toHaveURL(/\/supervisor/)
})
