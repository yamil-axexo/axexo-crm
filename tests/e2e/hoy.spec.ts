import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, testDb, WIDTHS } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const pending = async (page: Page) => Number((await page.getByTestId('today-title').locator('.sr-only').innerText()).match(/\d+/)?.[0] ?? 0)
const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

for (const w of WIDTHS) {
  test.describe(`Hoy en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    // Cada prueba parte con vencidos en la cola de Marco, aunque otra prueba ya haya completado los del seed.
    test.beforeEach(async () => {
      const sql = testDb()
      await sql`update crm.activities set due_at = now() - interval '3 days'
                 where id in (select a.id from crm.activities a join crm.users u on u.id = a.owner_id
                               where u.full_name = 'Marco Peña' and a.done_at is null and a.kind = 'task' and a.due_at > now() - interval '1 day'
                               order by a.id limit 2)`
      await sql.end()
    })

    test('encabezado con fecha en letras, pendientes y desglose; "Ahora" muestra lo más urgente', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      await expect(page.locator('main header p').first()).toHaveText(/^Hoy, (lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} de [a-z]+$/)
      await expect(page.getByTestId('today-title')).toContainText(/\d+ pendientes?/)
      await expect(page.getByTestId('today-breakdown')).toContainText(/vencidos?|para hoy|sugeridos?/)
      // Marco tiene leads sin contactar: el reloj de primer contacto va antes que todo lo demás
      await expect(page.getByTestId('now-title')).toHaveText(/^Llamar a /)
      await expect(page.getByTestId('now-card').getByTestId('lead-clock')).toContainText(/Primer contacto/)
      await expect(page.getByTestId('now-call')).toHaveAttribute('href', /^tel:\+52\d{10}$/)
      await expect(page.getByTestId('now-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/52\d{10}$/)
      // grupos con su conteo; lo que está en "Ahora" no se repite abajo
      const nowKey = await page.getByTestId('now-card').getAttribute('data-key')
      await expect(page.locator(`[data-testid="queue-row"][data-key="${nowKey}"]`)).toHaveCount(0)
      await expect(page.getByTestId('group-late').locator('h2')).toContainText(/Vencido\s*\d+/)
      await expect(page.getByTestId('scope')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await axe(page, `hoy ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-hoy.png` })
    })

    test('completar pide el próximo paso: sin "¿Qué sigue?" no guarda; con él la fila sale y avisa', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      const before = await pending(page)
      const row = page.getByTestId('group-late').getByTestId('queue-row').first()
      const key = await row.getAttribute('data-key')
      await row.getByTestId('row-complete').click()
      const sheet = page.getByTestId('complete-sheet')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByTestId('choices-when_choice')).toBeVisible()
      await axe(page, `hoja completar ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-completar.png` })
      await sheet.getByTestId('sheet-save').click()
      await expect(sheet.getByTestId('sheet-error')).toHaveText('Elige qué sigue para poder guardar.')
      await sheet.getByText('Enviar propuesta', { exact: true }).click()
      await expect(sheet.getByTestId('sheet-save')).toHaveText('Guardar y programar')
      await sheet.getByTestId('sheet-save').click()
      await expect(page.getByTestId('toast')).toContainText(/^Hecho\. Próximo paso: Enviar propuesta a .+, [a-zé]{3} \d{1,2} [a-z]{3}\.$/)
      await expect(sheet).toBeHidden()
      await expect(page.locator(`[data-testid="queue-row"][data-key="${key}"]`)).toHaveCount(0)
      await expect.poll(() => pending(page)).toBe(before - 1)
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 5000 })
    })

    test('cerrar guarda sin próximo paso; Escape cierra la hoja sin guardar', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      const before = await pending(page)
      const row = page.locator('[data-testid="queue-row"][data-key^="task:"]').first()
      await row.getByTestId('row-complete').click()
      const sheet = page.getByTestId('complete-sheet')
      await expect(sheet).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      expect(await pending(page)).toBe(before)
      await row.getByTestId('row-complete').click()
      await sheet.getByText('Nada más: cerrar', { exact: true }).click()
      await expect(sheet.getByTestId('choices-when_choice')).toHaveCount(0)
      await expect(sheet.getByTestId('sheet-save')).toHaveText('Guardar')
      await sheet.getByTestId('sheet-save').click()
      await expect(page.getByTestId('toast')).toHaveText('Hecho. Sin próximo paso.')
      await expect.poll(() => pending(page)).toBe(before - 1)
    })

    test('supervisión ve "Yo | Mi equipo": una fila por persona y más de 2 vencidos en rojo con texto', async ({ page }) => {
      const sql = testDb()
      await sql`update crm.activities set due_at = now() - interval '2 days'
                 where id in (select a.id from crm.activities a join crm.users u on u.id = a.owner_id
                               where u.full_name = 'Lucía Vega' and a.done_at is null and a.kind = 'task' order by a.id limit 4)`
      await sql.end()
      await loginAs(page, 'fernando.ibarra')
      await expect(page.getByTestId('scope-me')).toHaveAttribute('aria-current', 'page')
      await page.getByTestId('scope-team').click()
      await expect(page).toHaveURL(/\/hoy\?ver=equipo$/)
      await expect(page.getByTestId('scope-team')).toHaveAttribute('aria-current', 'page')
      const rows = page.getByTestId('team-row')
      await expect(rows).toHaveCount(2)
      await expect(page.getByTestId('team-table')).toContainText('Marco Peña')
      await expect(page.getByTestId('team-table')).toContainText('Lucía Vega')
      // la regla vale para cada fila: más de 2 vencidos se marca en riesgo, y la sugerencia lo dice con palabras
      for (const row of await rows.all()) {
        const late = Number(await row.getByTestId('team-late').innerText())
        expect((await row.getByTestId('team-late').getAttribute('data-risk')) !== null, await row.innerText()).toBe(late > 2)
      }
      const lucia = rows.filter({ hasText: 'Lucía Vega' })
      expect(Number(await lucia.getByTestId('team-late').innerText())).toBeGreaterThan(2)
      await expect(lucia).toContainText('Revisar sus vencidos con Lucía')
      await expect(page.getByTestId('today-title')).toContainText(/necesitan? apoyo/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await axe(page, `mi equipo ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-equipo.png` })
      await lucia.locator('a').click()
      await expect(page).toHaveURL(/\/supervisor\?owner=/)
    })
  })
}

test('cola vacía: "Todo al día"', async ({ page }) => {
  await loginAs(page, 'valeria.soto')
  await expect(page.getByTestId('today-title')).toContainText('Todo al día')
  await expect(page.getByTestId('queue-empty')).toContainText('Todo al día')
  await expect(page.getByTestId('now-card')).toHaveCount(0)
})

test('en inglés la cola y la hoja cambian de idioma', async ({ page }) => {
  await loginAs(page, 'marco.pena')
  await page.getByTestId('locale-toggle').click()
  await expect(page.getByTestId('today-title')).toContainText(/\d+ to do/)
  await expect(page.getByTestId('now-title')).toHaveText(/^Call /)
  await page.getByTestId('queue-row').first().getByTestId('row-complete').click()
  await expect(page.getByTestId('complete-sheet')).toContainText('What is next?')
  await expect(page.getByTestId('complete-sheet')).toContainText('Save and schedule')
  await page.keyboard.press('Escape')
  await page.getByTestId('locale-toggle').click()
  await expect(page.getByTestId('today-title')).toContainText(/pendientes?/)
})

test.describe('móvil: llamar y volver', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('al volver de una llamada la hoja pregunta cómo te fue; contactar al lead detiene el reloj y lo saca de "Ahora"', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    const title = await page.getByTestId('now-title').innerText()
    const name = title.replace(/^Llamar a /, '')
    // en la prueba no hay teléfono al que llamar: se evita la navegación y se simula salir y volver a la app
    await page.evaluate(() => document.addEventListener('click', (e) => (e.target as HTMLElement).closest('a[href^="tel:"]') && e.preventDefault(), true))
    await page.getByTestId('now-call').click()
    await page.evaluate(() => {
      for (const state of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
        document.dispatchEvent(new Event('visibilitychange'))
      }
    })
    const sheet = page.getByTestId('complete-sheet')
    await expect(sheet.getByTestId('sheet-title')).toHaveText(`¿Cómo te fue con ${name}?`)
    await sheet.getByText('Contactado', { exact: true }).click()
    await sheet.getByText('Llamar de nuevo', { exact: true }).click()
    await sheet.getByText('Hoy', { exact: true }).click()
    await sheet.getByTestId('sheet-save').click()
    await expect(page.getByTestId('toast')).toContainText(`Próximo paso: Llamar a ${name}`)
    await expect(page.getByTestId('now-title')).not.toHaveText(title)
    await page.goto('/leads?status=contacted')
    await expect(page.getByTestId('lead-row').filter({ hasText: name }).first()).toBeVisible()
  })
})
