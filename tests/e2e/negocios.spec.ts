import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, testDb, WIDTHS } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

/** Deja un negocio de Marco en "Contactada" sin próximo paso y devuelve su comercio. */
async function dealWithoutNextStep(): Promise<{ id: string; name: string }> {
  const sql = testDb()
  const [d] = await sql<{ id: string; name: string }[]>`
    with pick as (
      select d.id from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id join crm.users u on u.id = d.owner_id
       where p.name = 'Alta de tiendas (D2D)' and s.code = 'interes' and d.status = 'open' and u.full_name = 'Marco Peña' and d.next_step is not null
       order by d.id limit 1)
    update crm.deals d set next_step = null, next_step_due = null from pick, crm.accounts a
     where d.id = pick.id and a.id = d.account_id returning d.id, a.name`
  await sql.end()
  if (!d) throw new Error('el seed no dejó un negocio de Marco en "Contactada"')
  return d
}

/** Un negocio de Marco en "Prospecto", con próximo paso pero sin haber hablado con quien decide. */
/** Arrastra una tarjeta a otra etapa. La tarjeta se centra primero: abajo, el dock flotante queda encima de la lista. */
async function drag(page: Page, card: ReturnType<Page['locator']>, stage: string) {
  await expect(card).toHaveAttribute('draggable', 'true')
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  // Se suelta a la altura de la tarjeta: con columnas largas (suite completa) la parte de arriba de la columna queda fuera de la
  // pantalla y soltar ahí obligaba a desplazar en medio del arrastre, que el navegador no termina.
  const target = page.getByTestId(`stage-${stage}`)
  const [c, t] = [await card.boundingBox(), await target.boundingBox()]
  const y = c && t ? Math.min(Math.max(c.y + c.height / 2 - t.y, 30), t.height - 30) : 30
  await card.dragTo(target, { targetPosition: { x: 40, y } })
}

async function dealWithoutDecisionMaker(): Promise<string> {
  const sql = testDb()
  const [d] = await sql<{ id: string }[]>`
    with pick as (
      select d.id from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id join crm.users u on u.id = d.owner_id
       where p.name = 'Alta de tiendas (D2D)' and s.code = 'visitada' and d.status = 'open' and u.full_name = 'Marco Peña' order by d.id limit 1)
    update crm.deals d set decision_maker_met = false, next_step = coalesce(d.next_step, 'Volver a visitar'), next_step_due = coalesce(d.next_step_due, current_date + 1)
      from pick where d.id = pick.id returning d.id`
  await sql.end()
  if (!d) throw new Error('el seed no dejó un negocio de Marco en "Prospecto"')
  return d.id
}

for (const w of WIDTHS) {
  test.describe(`Negocios en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('resumen con abiertos, monto y sin próximo paso; toda tarjeta sin próximo paso se ve en aviso', async ({ page }) => {
      const deal = await dealWithoutNextStep()
      await loginAs(page, 'marco.pena')
      await page.goto('/pipelines?owner=me')
      await expect(page.locator('h1')).toHaveText('Negocios')
      await expect(page.getByTestId('board-summary')).toContainText(/^\d+ abiertos? · /)
      const noStep = Number((await page.getByTestId('summary-no-step').innerText()).match(/\d+/)![0])
      expect(noStep).toBeGreaterThan(0)
      await expect(page.getByTestId('pipeline-select')).toContainText('Alta de tiendas (D2D)')
      if (w.name === 'movil') await page.getByTestId('stage-tab-interes').click()
      const card = page.locator(`[data-card="${deal.id}"]`)
      await expect(card).toHaveAttribute('data-warn', '')
      await expect(card.getByTestId('deal-chip')).toHaveText('Sin próximo paso')
      // nunca solo color: cada tarjeta en aviso lo dice con texto
      for (const c of await page.locator('[data-card][data-warn]:visible').all()) await expect(c.getByTestId('deal-chip')).toHaveText('Sin próximo paso')
      await noSideScroll(page)
      await axe(page, `tablero ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-negocios.png` })

      await page.getByTestId('view-list').click()
      await expect(page).toHaveURL(/vista=lista/)
      await expect(page.getByTestId('deal-list-row').filter({ hasText: deal.name }).first()).toContainText('Sin próximo paso')
      await noSideScroll(page)
      await axe(page, `lista de negocios ${w.name}`)
    })

    test('cambiar de etapa pide el próximo paso si no hay uno, y una etapa que exige algo más lo dice', async ({ page }) => {
      const deal = await dealWithoutNextStep()
      await loginAs(page, 'marco.pena')
      await page.goto('/pipelines?owner=me')
      const card = page.locator(`[data-card="${deal.id}"]`)
      if (w.name === 'desktop') {
        await expect(card.getByTestId('deal-stage-select')).toBeHidden()
        await drag(page, card, 'visitada')
      } else {
        if (w.name === 'movil') await page.getByTestId('stage-tab-interes').click()
        await expect(card).toHaveAttribute('draggable', 'false')
        await card.getByTestId('deal-stage-select').selectOption({ label: 'Prospecto' })
      }
      const dialog = page.getByTestId('next-dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(`¿Qué sigue con ${deal.name}?`)
      await axe(page, `diálogo próximo paso ${w.name}`)
      // sin escribir el paso no se mueve
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(page.getByTestId('stage-interes').locator(`[data-card="${deal.id}"]`)).toHaveCount(1)

      if (w.name === 'desktop') await drag(page, card, 'visitada')
      else await card.getByTestId('deal-stage-select').selectOption({ label: 'Prospecto' })
      await page.getByTestId('next-dialog-step').fill('Volver con la dueña')
      await page.getByTestId('next-dialog-save').click()
      await expect(page.getByTestId('toast')).toHaveText(`${deal.name} pasó a Prospecto.`)
      if (w.name === 'movil') await page.getByTestId('stage-tab-visitada').click()
      const moved = page.getByTestId('stage-visitada').locator(`[data-card="${deal.id}"]`)
      await expect(moved.getByTestId('deal-chip')).toContainText('Volver con la dueña')
      await expect(moved).not.toHaveAttribute('data-warn', '')

      // "Comprometida" exige haber hablado con quien decide: el tablero no lo deja pasar y explica qué falta
      // (ajustes3, cambiado a propósito: "Contactada" ya no lo pide, es "se habló con alguien de la tienda").
      const gated = await dealWithoutDecisionMaker()
      await page.reload()
      if (w.name === 'movil') await page.getByTestId('stage-tab-visitada').click()
      const other = page.locator(`[data-card="${gated}"]`)
      // El candado de etapa se resuelve en una hoja ahí mismo (antes era un aviso): dice qué falta y la tarjeta no se mueve sola.
      // Integración ola 7: con la suite completa la columna es larga y el arrastre a veces no cae en la columna; se reintenta.
      if (w.name === 'desktop') {
        await expect(async () => {
          await drag(page, other, 'alta')
          await expect(page.getByTestId('gate-dialog')).toBeVisible({ timeout: 2000 })
        }).toPass({ timeout: 20_000 })
      } else await other.getByTestId('deal-stage-select').selectOption({ label: 'Comprometida' })
      await expect(page.getByTestId('gate-dialog')).toBeVisible()
      await expect(page.getByTestId('gate-dialog')).toContainText('Comprometida')
      await expect(page.getByTestId('gate-fields')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('gate-dialog')).toBeHidden()
      await expect(page.getByTestId('stage-visitada').locator(`[data-card="${gated}"]`)).toHaveCount(1)
    })
  })
}

test('quien no vende ve el tablero sin controles para mover', async ({ page }) => {
  await loginAs(page, 'luis.tovar')
  await page.goto('/pipelines')
  await expect(page.getByTestId('deal-card').first()).toBeVisible()
  await expect(page.getByTestId('deal-stage-select')).toHaveCount(0)
  await expect(page.locator('[data-card][draggable="true"]')).toHaveCount(0)
})
