import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb, WIDTHS } from './helpers'

/** Recorre la página entera para que todo entre en pantalla y cargue, y vuelve arriba. */
async function scrollThrough(page: Page) {
  const step = Math.round((page.viewportSize()?.height ?? 800) * 0.7)
  const total = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y <= total; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1300) // las entradas terminan
}

/** Deja la lista de primeros pasos de una persona como recién sembrada. */
async function freshOnboarding(persona: string) {
  const sql = testDb()
  await sql`update crm.user_onboarding set done = '{}', hidden_at = null where user_id = (select id from crm.users where email::text like ${persona + '@%'})`
  await sql.end()
}

test.describe('la demo de la entrada', () => {
  test.use({ reducedMotion: 'reduce' })

  test('se completa un pendiente: cómo te fue, qué sigue y el aviso', async ({ page }) => {
    const errors = pageErrors(page)
    await page.goto('/login')
    const demo = page.getByTestId('landing-demo')
    await expect(demo).toHaveAttribute('data-mode', 'paused') // sin movimiento no se anima sola
    await expect(demo.getByTestId('demo-count')).toHaveText('4 pendientes')
    await demo.getByTestId('demo-complete').click()
    await expect(demo.getByTestId('demo-sheet')).toBeVisible()
    await expect(demo.getByTestId('demo-save')).toBeDisabled() // no se guarda sin próximo paso
    await demo.getByTestId('demo-result').nth(1).click()
    await demo.getByTestId('demo-next').nth(1).click()
    await demo.getByTestId('demo-save').click()
    await expect(demo.getByTestId('demo-toast')).toHaveText('Hecho. Próximo paso: Enviar propuesta, mañana.')
    await expect(demo.getByTestId('demo-count')).toHaveText('3 pendientes')

    // desde una fila de la lista, y hasta terminar la cola
    await demo.getByTestId('demo-row-complete').last().click()
    await demo.getByTestId('demo-next').first().click()
    await demo.getByTestId('demo-save').click()
    await expect(demo.getByTestId('demo-count')).toHaveText('2 pendientes')
    for (const left of ['1 pendiente', 'Todo al día']) {
      await demo.getByTestId('demo-complete').click()
      await demo.getByTestId('demo-next').first().click()
      await demo.getByTestId('demo-save').click()
      await expect(demo.getByTestId('demo-count')).toHaveText(left)
    }
    await expect(demo.getByTestId('demo-empty')).toBeVisible()
    await demo.getByTestId('demo-again').click()
    await expect(demo.getByTestId('demo-count')).toHaveText('4 pendientes')
    expect(errors).toEqual([])
  })

  test('se opera con el teclado y el foco va a donde toca', async ({ page }) => {
    await page.goto('/login')
    const demo = page.getByTestId('landing-demo')
    await demo.getByTestId('demo-complete').focus()
    await page.keyboard.press('Enter')
    await expect(demo.getByTestId('demo-result').first()).toBeFocused() // al abrir, a la primera opción
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(demo.getByTestId('demo-next').first()).toBeFocused()
    await page.keyboard.press('Space')
    await expect(demo.getByTestId('demo-next').first()).toHaveAttribute('aria-pressed', 'true')
    await demo.getByTestId('demo-save').focus()
    await page.keyboard.press('Enter')
    await expect(demo.getByTestId('demo-count')).toHaveText('3 pendientes')
    await expect(demo.getByTestId('demo-complete')).toBeFocused() // al guardar, al siguiente pendiente
    // cancelar devuelve el foco
    await page.keyboard.press('Enter')
    await demo.getByTestId('demo-cancel').click()
    await expect(demo.getByTestId('demo-sheet')).toHaveCount(0)
    await expect(demo.getByTestId('demo-complete')).toBeFocused()
  })

  test('sin movimiento el contenido queda completo y quieto', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).not.toHaveClass(/sc-motion/)
    const hidden = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => getComputedStyle(el).opacity !== '1').length)
    expect(hidden).toBe(0)
    await expect(page.getByTestId('ribbon-toggle')).toBeHidden() // la cinta queda fija: no hay nada que pausar
    const ribbon = await page.getByTestId('landing-ribbon').locator('ul').evaluate((el) => getComputedStyle(el).animationName)
    expect(ribbon).toBe('none')
    await expect(page.getByTestId('landing-facts').locator('[data-count]').first()).toHaveText('5')
  })
})

test('la demo se anima sola, se puede pausar y cede el control al primer toque', async ({ page }) => {
  await page.goto('/login')
  const demo = page.getByTestId('landing-demo')
  await expect(demo).toHaveAttribute('data-mode', 'auto')
  await expect(demo.getByTestId('demo-sheet')).toBeVisible({ timeout: 8000 }) // abre la hoja sin que nadie la toque
  await expect(demo.getByTestId('demo-toast')).toBeVisible({ timeout: 8000 })
  await demo.getByTestId('demo-toggle').click()
  await expect(demo).toHaveAttribute('data-mode', 'paused')
  await expect(demo.getByTestId('demo-toggle')).toHaveAccessibleName('Reproducir la demo')
  await demo.getByTestId('demo-toggle').click()
  await expect(demo).toHaveAttribute('data-mode', 'auto')
  await demo.getByTestId('demo-count').click() // cualquier toque dentro de la demo
  await expect(demo).toHaveAttribute('data-mode', 'user')
})

test('el recorrido del producto cambia de pantalla con pestañas, con teclado y en los dos idiomas', async ({ page }) => {
  await page.goto('/login')
  const tour = page.getByTestId('landing-tour')
  await tour.scrollIntoViewIfNeeded()
  await expect(tour.getByRole('tab')).toHaveCount(6)
  await expect(tour.getByTestId('tour-tab-hoy')).toHaveAttribute('aria-selected', 'true')
  await tour.getByTestId('tour-tab-negocios').click()
  await expect(tour.getByTestId('tour-tab-negocios')).toHaveAttribute('aria-selected', 'true')
  const panel = tour.getByRole('tabpanel')
  await expect(panel).toHaveCount(1) // las demás quedan ocultas para todos
  await expect(panel).toContainText('Una columna por etapa')
  await expect(panel.getByRole('img', { name: /Tablero de Negocios/ })).toBeVisible()
  await expect(panel.locator('img').first()).toHaveAttribute('src', /negocios-d-es/)

  // flechas, Inicio y Fin
  await tour.getByTestId('tour-tab-negocios').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tour.getByTestId('tour-tab-comercio')).toBeFocused()
  await expect(tour.getByTestId('tour-tab-comercio')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(tour.getByTestId('tour-tab-panel')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(tour.getByTestId('tour-tab-hoy')).toBeFocused()
  await expect(tour.getByTestId('tour-toggle')).toHaveAccessibleName('Reproducir el recorrido') // al usarlo deja de avanzar solo

  // en inglés, las capturas son las de la interfaz en inglés
  await page.getByTestId('locale-toggle').click()
  await expect(page.locator('h1')).toHaveText('Every merchant, with its next step.')
  const en = page.getByTestId('landing-tour')
  await en.scrollIntoViewIfNeeded()
  await en.getByTestId('tour-tab-leads').click()
  await expect(en.getByRole('tabpanel').locator('img').first()).toHaveAttribute('src', /leads-d-en/)
  await expect(en.getByRole('tabpanel')).toContainText('first-contact clock')
  await page.getByTestId('locale-toggle').click()
  await expect(page.locator('h1')).toHaveText('Cada comercio, con su próximo paso.')
})

for (const w of WIDTHS) {
  test.describe(`entrada completa en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('recorrida de arriba a abajo: sin desbordes, imágenes cargadas y descritas, gráficas de ejemplo y axe limpio', async ({ page }) => {
      const errors = pageErrors(page)
      await page.goto('/login')
      await page.getByTestId('demo-toggle').click() // en pausa para medir
      await scrollThrough(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'se sale del ancho').toBeLessThanOrEqual(0)

      // todo lo que entra al hacer scroll terminó visible
      const pending = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => getComputedStyle(el).opacity !== '1').length)
      expect(pending).toBe(0)

      // imágenes: cargan y llevan alt (vacío solo si son decorativas)
      const images = await page.evaluate(() =>
        [...document.querySelectorAll('img')].filter((img) => img.offsetParent !== null).map((img) => ({ src: img.currentSrc || img.src, ok: img.complete && img.naturalWidth > 0, alt: img.getAttribute('alt') })),
      )
      expect(images.length).toBeGreaterThanOrEqual(8)
      expect(images.filter((x) => !x.ok).map((x) => x.src)).toEqual([])
      expect(images.filter((x) => x.alt === null).map((x) => x.src)).toEqual([])
      for (const name of ['seguimiento', 'llamada', 'retrato', 'mostrador', 'equipo']) expect(images.some((x) => x.src.includes(`foto-${name}`)), name).toBe(true)

      // las ilustraciones son decorativas
      const art = page.locator('svg.sc-art')
      expect(await art.count()).toBeGreaterThanOrEqual(10)
      expect(await page.locator('svg.sc-art:not([aria-hidden="true"])').count()).toBe(0)

      // las gráficas dicen que son un ejemplo y los contadores llegaron a su valor
      const numbers = page.getByTestId('landing-numbers')
      await expect(numbers.getByTestId('numbers-example')).toHaveText('Ejemplo')
      await expect(numbers.getByText('Primer intento a tiempo').first()).toBeVisible()
      await expect(numbers.getByText('Contacto logrado').first()).toBeVisible()
      await expect(numbers.locator('[data-count="48"]')).toHaveText('48')
      await expect(page.getByTestId('landing-people')).toContainText('Fotos de archivo')

      // objetivos táctiles de 44 px en los controles de la entrada
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.landing button, .landing a, .landing summary')]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ r: el.getBoundingClientRect(), name: el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 30) }))
          .filter((x) => x.r.height < 43.5 || x.r.width < 43.5)
          .map((x) => `${x.name} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
      )
      expect(small).toEqual([])

      await page.getByTestId('ribbon-toggle').click()
      await page.getByTestId('tour-toggle').click()
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
      const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`)).toEqual([])
      expect(errors).toEqual([])
    })
  })
}

test.describe('bienvenida y ayuda', () => {
  test.afterAll(() => freshOnboarding('paula.mendez'))

  test('la bienvenida lleva foto, ilustración del rol y una captura o ilustración por paso; completar la lista se celebra', async ({ page }) => {
    await freshOnboarding('paula.mendez')
    const errors = pageErrors(page)
    await loginAs(page, 'paula.mendez')
    // el recordatorio de Hoy lleva su anillo de avance
    const nudge = page.getByTestId('hoy-onboarding')
    await expect(nudge).toContainText('0 de 7 hechos')
    await expect(nudge.locator('svg circle').first()).toBeAttached()
    await nudge.getByTestId('hoy-onboarding-open').click()
    await expect(page).toHaveURL(/\/bienvenida$/)

    const welcome = page.getByTestId('welcome')
    await expect(welcome.getByTestId('welcome-track')).toHaveText('Supervisión')
    await expect(welcome.locator('section').first().locator('svg.sc-art')).toHaveCount(1)
    await expect(welcome.locator('section').first().getByRole('img')).toHaveAttribute('alt', /laptop/)
    const how = welcome.getByTestId('how-step')
    await expect(how).toHaveCount(4)
    for (let n = 0; n < 4; n++) await expect(how.nth(n).locator('img[alt]:not([alt=""]), svg.sc-art')).toHaveCount(1)

    // marcar todos: el anillo llega al final y aparece la celebración
    const bar = welcome.getByRole('progressbar')
    await expect(bar).toHaveAttribute('aria-valuenow', '0')
    const toggles = welcome.getByTestId('step-toggle')
    for (let n = 0; n < 7; n++) {
      await toggles.nth(n).click()
      await expect(page.getByTestId('onboarding-progress')).toHaveText(`${n + 1} de 7`)
    }
    await expect(bar).toHaveAttribute('aria-valuenow', '7')
    await expect(page.getByTestId('onboarding-complete')).toContainText('Listo, Paula. Ya diste tus primeros pasos.')

    // con todo hecho, Hoy deja de recordarlo
    await page.getByTestId('welcome-go').click()
    await expect(page).toHaveURL(/\/hoy$/)
    await expect(page.getByTestId('queue')).toBeVisible()
    await expect(page.getByTestId('hoy-onboarding')).toHaveCount(0)

    // desmarcar uno quita la celebración y el recordatorio vuelve con su avance
    await page.goto('/bienvenida')
    await expect(page.getByTestId('onboarding-complete')).toBeVisible()
    await page.getByTestId('step-help').getByTestId('step-toggle').click()
    await expect(page.getByTestId('onboarding-complete')).toHaveCount(0)
    await expect(page.getByTestId('onboarding-progress')).toHaveText('6 de 7')
    await expect(page.getByTestId('step-help')).toHaveAttribute('data-done', 'false')
    await page.goto('/hoy')
    await expect(page.getByTestId('hoy-onboarding')).toContainText('6 de 7 hechos')
    expect(errors).toEqual([])
  })

  test('la bienvenida de administración va con su ilustración y la de leadership con apoyo ilustrado', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/bienvenida')
    const hero = page.getByTestId('welcome').locator('section').first()
    await expect(hero.locator('svg.sc-art')).toHaveCount(1)
    await expect(hero.locator('img')).toHaveCount(0)
    await loginAs(page, 'luis.tovar')
    await page.goto('/bienvenida')
    const how = page.getByTestId('how-step')
    await expect(how).toHaveCount(4)
    await expect(how.first().locator('svg.sc-art')).toHaveCount(1) // "ves todo y no cambias nada" no lleva una captura con botones de crear
  })

  test('la ayuda resalta lo buscado, filtra por tema y su estado vacío ofrece salir', async ({ page }) => {
    await loginAs(page, 'paula.mendez')
    await page.goto('/ayuda')
    const help = page.getByTestId('help')
    await expect(help.locator('header svg.sc-art')).toHaveCount(1)
    const items = help.getByTestId('help-item')
    const all = await items.count()

    await help.getByTestId('help-search').fill('reloj')
    await expect(help.locator('mark').first()).toHaveText(/reloj/i)
    await expect(help.getByTestId('help-excerpt').first()).toBeVisible()
    expect(await items.count()).toBeLessThan(all)
    // busca sin importar acentos
    await help.getByTestId('help-search').fill('telefono')
    await expect(help.locator('mark').first()).toHaveText('teléfono')
    await help.getByTestId('help-clear').click()
    await expect(help.getByTestId('help-search')).toHaveValue('')
    await expect(items).toHaveCount(all)

    // un tema
    await help.getByTestId('help-chip-leads').click()
    await expect(help.getByTestId('help-chip-leads')).toHaveAttribute('aria-pressed', 'true')
    await expect(help.locator('section[data-testid^="help-topic-"]')).toHaveCount(1)
    await expect(items).toHaveCount(3)
    await help.getByTestId('help-chip-leads').click()
    await expect(items).toHaveCount(all)

    // vacío: ilustración y un botón para volver
    await help.getByTestId('help-search').fill('zzzz')
    const empty = help.getByTestId('help-empty')
    await expect(empty.locator('svg.sc-art')).toHaveCount(1)
    await empty.getByTestId('help-reset').click()
    await expect(items).toHaveCount(all)
  })
})
