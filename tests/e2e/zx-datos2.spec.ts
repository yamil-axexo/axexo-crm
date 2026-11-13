import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, testDb } from './helpers'

// Paquete datos2 (0037, ola 6): DAT-02, DAT-04, DAT-01, DAT-05, DAT-07, MULTI-02, E9.F11, E3.F10, E4.F2, E4.F9, E6.F8, desde la pantalla.
const uniq = () => Math.random().toString(36).slice(2, 7)
const sql = testDb()
test.afterAll(async () => {
  await sql.end()
})
const personaId = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
async function clean(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target}`), what).toEqual([])
}
const notice = (page: Page) => page.getByTestId('admin-notice')

test.describe('datos2', () => {
  test('DAT-02: dos contactos con el mismo teléfono se deciden en la cola, se fusionan y se deshace', async ({ page }) => {
    const lucia = await personaId('lucia.vega')
    const tel = `+52557${Math.floor(1000000 + Math.random() * 8999999)}`
    const a = `Ana Teléfono ${uniq()}`
    const b = `Beto Teléfono ${uniq()}`
    const [ca] = await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone, created_by, created_at) values ('MX', ${a}, ${tel}, ${lucia}, now() - interval '1 day') returning id`
    const [cb] = await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name, held_phone, created_by) values ('MX', ${b}, ${tel}, ${lucia}) returning id`
    await sql`select app.contact_pair_queue('MX', ${ca!.id}, ${cb!.id}, 'cleanup')`
    await loginAs(page, 'nora.salas')
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/datos?tab=duplicados&mercado=MX')
      await expect(page.getByTestId('contact-pairs')).toBeVisible()
      await clean(page, `cola de contactos ${w}`)
    }
    const row = page.getByTestId('contact-pair-row').filter({ hasText: b })
    await expect(row).toContainText('en espera')
    await row.getByTestId('contact-merge').click()
    await expect(notice(page)).toContainText('Contactos fusionados')
    const merge = page.getByTestId('contact-merge-row').filter({ hasText: b }).first()
    await merge.getByTestId('contact-undo').click()
    await page.locator('dialog[open]').getByTestId('contact-undo-reason').fill('Eran dos personas distintas')
    await page.locator('dialog[open]').getByTestId('contact-undo-confirm').click()
    await expect(notice(page)).toContainText('Fusión deshecha')
  })

  test('decisiones de negocio: valor propuesto con dueño, se cambia, y la de producción no se toca; Estado lo lista', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/admin/decisiones')
      await expect(page.getByTestId('decision-card').first()).toBeVisible()
      await clean(page, `decisiones ${w}`)
    }
    const prod = page.locator('[data-testid="decision-card"][data-key="market.reset_production"]')
    await expect(prod).toContainText('pendiente: Dan Mulligan')
    await expect(prod.getByTestId('decision-locked')).toBeVisible()
    await expect(prod.getByTestId('decision-form')).toHaveCount(0)
    const tree = page.locator('[data-testid="decision-card"][data-key="tree.reparent_owner"] [data-testid="decision-row"][data-market="MX"]')
    await tree.getByTestId('decision-select').selectOption('parent')
    await tree.getByTestId('decision-save').click()
    await expect(notice(page)).toContainText('valor propuesto')
    await sql`delete from crm.decision_settings where key = 'tree.reparent_owner'`
    await page.goto('/estado')
    await expect(page.locator('[data-testid="status-decision-row"][data-key="market.reset_production"]')).toBeVisible()
  })

  test('DAT-05: pedir que un campo pase a columna deja el cambio preparado', async ({ page }) => {
    const owner = await personaId('nora.salas')
    const label = `Nivel prueba ${uniq()}`
    await sql`insert into crm.field_definitions (object, key, label_es, label_en, data_type, market_code, status, is_active, owner_id, decision, purpose, review_on)
              values ('account', ${`nivel_${uniq()}`}, ${label}, ${`${label} en`}, 'number', 'MX', 'approved', true, ${owner}, 'Decide a quién se visita primero', 'Filtrar por nivel', current_date + 90)`
    await loginAs(page, 'nora.salas')
    await page.goto('/datos?tab=campos')
    const row = page.getByTestId('registry-row').filter({ hasText: label })
    await row.getByTestId('registry-promote').click()
    await page.locator('dialog[open]').getByTestId('promote-reason').fill('Se filtra en la cola de visitas del mercado')
    await page.locator('dialog[open]').getByTestId('promote-save').click()
    await expect(notice(page)).toContainText('migración')
    await page.goto('/datos?tab=campos')
    await expect(page.getByTestId('field-promotions')).toContainText(label)
    await expect(page.getByTestId('field-sla-stats')).toContainText('Plazo para decidir')
  })

  test('DAT-01: el árbol se puede ver a una fecha pasada', async ({ page }) => {
    const [chain] = await sql<{ id: string; name: string }[]>`select a.id, a.name from crm.accounts a where a.market_code = 'MX' and a.kind <> 'store' and a.archived_at is null
       and exists (select 1 from crm.accounts c where c.parent_id = a.id) order by a.name limit 1`
    await loginAs(page, 'ana.robles')
    const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    await page.goto(`/comercios/${chain!.id}?tab=arbol&al=${day}`)
    await expect(page.getByTestId('tree-totals-note')).toContainText('Así estaba')
    await expect(page.getByTestId('node-commission')).toBeVisible()
    await clean(page, 'árbol a una fecha')
  })

  test('DAT-07: Operaciones abre negocios de expansión desde la base', async ({ page }) => {
    const [prod] = await sql<{ id: string }[]>`select id from crm.products where market_code = 'MX' and is_active order by name limit 1`
    await loginAs(page, 'valeria.soto')
    await page.goto(`/datos?tab=productos&sin=${prod!.id}#expansion`)
    const card = page.getByTestId('expansion-card')
    await expect(card).toBeVisible()
    await card.getByTestId('expansion-pick').first().check()
    await card.getByTestId('expansion-open').click()
    await expect(notice(page)).toContainText('expansión')
  })
})
