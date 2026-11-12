import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, testDb, WIDTHS } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
const count = async (page: Page, pill: string) => Number((await page.getByTestId(pill).innerText()).match(/· (\d+)/)?.[1])

for (const w of WIDTHS) {
  test.describe(`Comercios en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('filtros con conteo, salud con palabra y vistas Lista, Árbol y Mapa (después)', async ({ page }) => {
      await loginAs(page, 'nora.salas')
      await page.goto('/comercios')
      for (const pill of ['pill-all', 'pill-riesgo', 'pill-sin-transaccionar', 'pill-sin-paso']) expect(await count(page, pill), pill).toBeGreaterThanOrEqual(0)
      const risk = await count(page, 'pill-riesgo')
      expect(risk).toBeGreaterThan(0)
      await page.getByTestId('pill-riesgo').click()
      await expect(page.getByTestId('pill-riesgo')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('account-total')).toContainText(String(risk))
      const rows = page.getByTestId('account-row')
      expect(await rows.filter({ hasText: 'En riesgo' }).count()).toBe(await rows.count())
      await page.getByTestId('pill-sin-transaccionar').click()
      await expect(rows.first()).toContainText('Sin transaccionar')
      await page.getByTestId('pill-sin-paso').click()
      await expect(page.getByTestId('pill-sin-paso')).toHaveAttribute('aria-current', 'page')
      await noSideScroll(page)

      await expect(page.getByTestId('view-map')).toHaveAttribute('aria-disabled', 'true')
      await expect(page.getByTestId('view-map')).toHaveAttribute('title', 'El mapa llega después')
      await page.getByTestId('pill-all').click()
      await page.getByTestId('view-tree').click()
      await expect(page).toHaveURL(/vista=arbol/)
      const depths = await page.getByTestId('tree-row').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-depth'))))
      expect(depths[0]).toBe(0)
      expect(Math.max(...depths)).toBeGreaterThan(0)
      await noSideScroll(page)
      await axe(page, `comercios árbol ${w.name}`)
      await page.getByTestId('view-list').click()
      await axe(page, `comercios lista ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-comercios.png` })
    })

    test('la ficha no saca de la lista: panel en desktop, al lado en tablet, pantalla completa en móvil', async ({ page }) => {
      await loginAs(page, 'nora.salas')
      await page.goto('/comercios?q=Grupo+Abarrotero')
      await page.getByTestId('account-row').first().locator('a').click()
      await expect(page).toHaveURL(/ficha=[0-9a-f-]{36}/)
      const panel = page.getByTestId('ficha-panel')
      await expect(panel).toBeVisible()
      await expect(page.getByTestId('account-table')).toBeAttached()
      await expect(page.getByTestId('account-row').first().locator('a')).toHaveAttribute('aria-current', 'true')
      // la ficha entra con una animación corta: se mide cuando ya terminó
      await expect.poll(async () => panel.evaluate((el) => el.getAnimations().filter((x) => x.playState === 'running').length)).toBe(0)
      const box = (await panel.boundingBox())!
      const list = (await page.getByTestId('account-table').boundingBox())!
      if (w.name === 'desktop') {
        expect(Math.round(box.width)).toBe(480)
        expect(Math.round(box.x + box.width)).toBe(w.width)
        await expect(page.getByTestId('ficha-veil')).toBeVisible()
      } else if (w.name === 'tablet') {
        expect(list.width).toBeLessThanOrEqual(420)
        expect(box.x).toBeGreaterThanOrEqual(list.x + list.width)
        await expect(page.getByTestId('ficha-veil')).toBeHidden()
      } else {
        expect(Math.round(box.width)).toBe(w.width)
        expect(Math.round(box.x)).toBe(0)
      }
      await noSideScroll(page)

      // encabezado, lo siguiente, seis acciones (contactar: llamar, WhatsApp, mensaje; registrar: visita, nota, actividad) y pestañas con Hilo por defecto
      const ficha = page.getByTestId('ficha')
      await expect(ficha.locator('#ficha-title')).toHaveText('Grupo Abarrotero del Valle')
      await expect(ficha.getByTestId('account-facts')).toContainText(/Cadena · \d+ puntos de venta/)
      await expect(ficha.getByTestId('health')).toHaveText(/Activo|Sin transaccionar|En riesgo|Lead nuevo/)
      await expect(ficha.getByTestId('ficha-next')).toContainText('Lo siguiente')
      await expect(ficha.getByTestId('ficha-actions').locator(':scope > a, :scope > button, :scope > span')).toHaveCount(6)
      await expect(page.getByTestId('tab-hilo')).toHaveAttribute('aria-current', 'page')
      await axe(page, `ficha hilo ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-ficha.png` })

      await fichaTab(page, 'arbol')
      await expect(page).toHaveURL(/tab=arbol/)
      await expect(page.getByTestId('child-row').first()).toBeVisible()
      await axe(page, `ficha árbol ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-ficha-arbol.png` })
      await fichaTab(page, 'datos')
      await expect(page.getByTestId('account-attribution')).toBeVisible()
      await axe(page, `ficha datos ${w.name}`)
      await noSideScroll(page)

      // cerrar regresa a la misma lista, con su búsqueda
      if (w.name === 'movil') await page.goBack(), await page.goBack(), await page.goBack()
      else if (w.name === 'desktop') await page.keyboard.press('Escape')
      else await page.getByTestId('ficha-close').click()
      await expect(panel).toHaveCount(0)
      await expect(page).toHaveURL(/\/comercios\?q=Grupo\+Abarrotero$/)
      await expect(page.getByTestId('account-row').first()).toBeVisible()
    })

    test('en la ficha lo próximo va arriba como punto abierto; completarlo pide el siguiente paso y una nota entra al hilo', async ({ page }) => {
      const note = `Dejé folleto ${Math.random().toString(36).slice(2, 8)}`
      await loginAs(page, 'marco.pena')
      await page.goto('/comercios?owner=me&ver=riesgo')
      await page.getByTestId('pill-all').click()
      await page.getByTestId('account-row').first().locator('a').click()
      const ficha = page.getByTestId('ficha')
      await ficha.getByTestId('action-note').click()
      await page.getByTestId('note-subject').fill(note)
      await page.getByTestId('note-add').click()
      await expect(ficha.getByTestId('tl-note').first()).toContainText(note)
      await expect(ficha.getByTestId('tl-note').first()).toContainText(/^Hoy, /)

      await ficha.getByTestId('action-activity').click()
      await page.getByTestId('activity-subject').fill(`Volver con contrato ${note}`)
      await page.getByTestId('activity-due').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
      await page.getByTestId('activity-add').click()
      const next = ficha.getByTestId('thread-next').filter({ hasText: note })
      await expect(next).toContainText(/Próximo · para el/)
      await next.getByTestId('row-complete').click()
      const sheet = page.locator('[data-testid="complete-sheet"][open]')
      await sheet.getByTestId('sheet-save').click()
      await expect(sheet.getByTestId('sheet-error')).toHaveText('Elige qué sigue para poder guardar.')
      await sheet.getByText('Reunión', { exact: true }).click()
      await sheet.getByTestId('sheet-save').click()
      await expect(page.getByTestId('toast')).toContainText('Próximo paso: Reunión con')
      await expect(ficha.getByTestId('thread-next').filter({ hasText: note })).toHaveCount(0)
      await expect(ficha.getByTestId('thread-next').filter({ hasText: 'Reunión con' }).first()).toBeVisible()
      await expect(ficha.getByTestId('tl-task').filter({ hasText: note }).first()).toBeVisible()
      await noSideScroll(page)
    })
  })
}

test('buscar encuentra por nombre, persona, teléfono con o sin lada y por el ID de otro sistema', async ({ page }) => {
  const sql = testDb()
  const [x] = await sql<{ name: string; phone: string; person: string; alias: string }[]>`
    select a.name, a.phone, c.full_name as person, al.external_id as alias
      from crm.accounts a
      join crm.account_contacts ac on ac.account_id = a.id and ac.valid_to is null join crm.contacts c on c.id = ac.contact_id
      join crm.account_aliases al on al.account_id = a.id and al.valid_to is null
     where a.market_code = 'MX' and a.phone is not null and a.archived_at is null order by a.id limit 1`
  await sql.end()
  expect(x, 'el seed trae un comercio con contacto, teléfono y alias').toBeTruthy()
  await loginAs(page, 'nora.salas')
  const local = x!.phone.replace(/^\+52/, '')
  for (const q of [x!.name, x!.person, local, `+52 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`, x!.alias]) {
    await page.goto(`/buscar?q=${encodeURIComponent(q)}`)
    await expect(page.getByTestId('search-hit').filter({ hasText: x!.name }).first(), q).toBeVisible()
  }
  await page.goto('/buscar?q=zzzqqq-no-existe')
  await expect(page.getByText('Sin resultados')).toBeVisible()
  await axe(page, 'buscar vacío')
  await page.goto(`/buscar?q=${encodeURIComponent(x!.name)}`)
  await axe(page, 'buscar con resultados')
  await page.getByTestId('search-hit').first().click()
  await expect(page.getByTestId('ficha')).toHaveAttribute('data-mode', 'page')
  await expect(page.locator('h1')).toHaveText(x!.name)
})
