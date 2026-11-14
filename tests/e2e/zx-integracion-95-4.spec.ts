import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, openMenu, pageErrors, testDb } from './helpers'

// Integración 95-4 en pantalla (ciclo-cs, campo-canal, partners-contratos, ia): quien administra encuentra Cuidado de comercios,
// Campo y canales, Partners e IA en Administración y no en su menú; las agencias se agregan en un solo lugar (Datos > Catálogos,
// con su embudo y su región) y Seguridad solo da acceso a su gente; Mi equipo y la ficha dicen cómo se calcula cada cifra con
// las mismas definiciones del Panel; y el umbral de saldo bajo es uno solo, el de Cuidado de comercios.
const sql = testDb()
const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase()

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

test.describe.configure({ mode: 'serial' })
test.use({ reducedMotion: 'reduce' })
test.afterAll(async () => { await sql.end() })

test.describe('integración 95-4', () => {
  test('administración a 390: lo nuevo vive en Administración; una sola pantalla de agencias', async ({ page }) => {
    const errors = pageErrors(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'nora.salas')
    await openMenu(page)
    for (const id of ['nav-care', 'nav-field', 'nav-assist', 'nav-partners']) await expect(page.getByTestId(id), id).toHaveCount(0)

    await page.goto('/admin')
    for (const href of ['/admin/cuidado', '/campo', '/partners', '/admin/ia']) await expect(page.locator(`main a[href="${href}"]`).first(), href).toBeAttached()
    await clean(page, 'admin 390')

    await page.goto('/admin/seguridad?s=accesos')
    await expect(page.getByTestId('agency-where')).toBeVisible()
    await expect(page.getByTestId('agency-add')).toHaveCount(0)

    const name = `Agencia Integra ${tag()}`
    await page.goto('/datos?tab=catalogos')
    const card = page.getByTestId('agencies-card')
    await card.getByTestId('agency-new').click()
    const dialog = page.locator('dialog[open]')
    await dialog.getByTestId('agency-market').selectOption('MX')
    await dialog.getByTestId('agency-name').fill(name)
    const pipeline = (await sql<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' order by name limit 1`)[0]!.id
    await dialog.getByTestId('agency-pipeline').selectOption(pipeline)
    await dialog.getByTestId('agency-save').click()
    await expect(card.getByTestId('agency-row').filter({ hasText: name })).toBeVisible()
    expect((await sql<{ pipeline_id: string }[]>`select pipeline_id from crm.agencies where name = ${name}`)[0]).toEqual({ pipeline_id: pipeline })
    await page.goto('/admin/seguridad?s=accesos')
    await expect(page.getByTestId('agency-row').filter({ hasText: name })).toBeVisible()
    await clean(page, 'seguridad 390')

    // un solo umbral de saldo bajo: Campo y canales ya no lo ofrece; Cuidado de comercios sí
    await page.goto('/campo?tab=umbrales&mercado=MX')
    await expect(page.locator('[data-testid=threshold-row][data-key=low_balance_minor]')).toHaveCount(0)
    await page.goto('/admin/cuidado?mercado=MX')
    await expect(page.getByTestId('s-balance')).toBeVisible()
    await sql`delete from crm.agencies where name = ${name}`
    expect(errors).toEqual([])
  })

  test('Mi equipo y la ficha dicen cómo se calcula cada cifra, con las definiciones del Panel', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'ana.robles')
    await page.goto('/supervisor')
    const defs = page.getByTestId('team-defs')
    await expect(defs).toBeVisible()
    await defs.getByTestId('team-def-attempt').locator('summary').click()
    await expect(defs.getByTestId('team-def-attempt')).toContainText('Qué cuenta')
    await expect(defs.getByTestId('team-def-noNextStep')).toContainText('Sin próximo paso')

    const store = (await sql<{ id: string }[]>`
      select a.id from crm.accounts a join crm.merchant_metrics_daily m on m.account_id = a.id
       where a.owner_id = md5('contigo:marco.pena')::uuid and a.archived_at is null order by a.id limit 1`)[0]!.id
    await page.goto(`/comercios/${store}`)
    await fichaTab(page, 'datos')
    await expect(page.getByTestId('ficha-defs')).toContainText('Comercios activos')
    await page.setViewportSize({ width: 390, height: 844 })
    await clean(page, 'ficha 390')
    expect(errors).toEqual([])
  })
})
