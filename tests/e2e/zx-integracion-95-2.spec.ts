import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Integración 95-2 en pantalla (mercados, seguridad, gobierno, embudo, us-ficha): una tienda de US con su Tax ID por el modelo
// único de identificador fiscal y su socio en el catálogo único de agencias, que supervisión ve; y Administración con Seguridad,
// Gobierno, Mercados y Embudo en sus secciones, un solo resguardo en Estado de CONTIGO y WhatsApp configurado en un solo lugar.
const sql = testDb()
const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase()
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const at = async (page: Page, name: 'desktop' | 'movil') => page.setViewportSize(WIDTHS.find((w) => w.name === name)!)

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

test.describe('integración 95-2', () => {
  test('una tienda de US: Tax ID por el modelo de mercados, socio del catálogo único y supervisión que la ve', async ({ page }) => {
    const errors = pageErrors(page)
    const jade = await uid('jade.kim')
    const sys = (await sql<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
    const name = `Integra Dealer ${tag()}`
    const id = (await sql<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, lifecycle, country, owner_id, created_by)
      values ('US', 'store', ${name}, 'dealer', 'active', 'US', ${jade}, ${sys}) returning id`)[0]!.id

    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/${id}?tab=datos`)
    const profile = page.getByTestId('store-profile')
    await profile.getByTestId('tax-id-edit').click()
    const tax = page.locator('dialog[open]')
    await tax.getByTestId('tax-id-input').fill('12-3456789')
    await tax.getByTestId('tax-id-save').click()
    await expect(tax.getByTestId('form-ok')).toContainText('6789')
    await page.keyboard.press('Escape')
    await expect(profile.getByTestId('sp-tax')).toContainText('6789')
    // un solo modelo: la fila de identificador fiscal de mercados, con huella; el número completo no queda
    const saved = await sql<{ last4: string; id_type: string; blind: boolean }[]>`select last4, id_type, blind_ix is not null as blind from crm.tax_ids where account_id = ${id} and valid_to is null`
    expect(saved).toEqual([{ last4: '6789', id_type: 'us_ein', blind: true }])
    expect((await sql<{ n: number }[]>`select count(*)::int as n from crm.accounts where id = ${id} and to_jsonb(accounts)::text like '%123456789%'`)[0]!.n).toBe(0)

    // supervisión fija el socio que la reclutó (una vez) y la sigue viendo aunque la haya reclutado alguien de fuera
    await loginAs(page, 'kira.dunn')
    await page.goto(`/comercios/${id}?tab=datos`)
    await expect(page.getByTestId('recruiter-form')).toBeVisible()
    await page.getByTestId('recruiter-select').selectOption(await uid('ag-us-2'))
    await page.getByTestId('recruiter-save').click()
    await expect(page.getByTestId('sp-recruiter')).toContainText('Socio Ejemplo')
    await expect(page.getByTestId('recruiter-form')).toHaveCount(0)
    expect((await sql<{ recruited_by: string; kind: string }[]>`
      select a.recruited_by, g.kind from crm.accounts a join crm.agencies g on g.id = a.recruited_agency_id where a.id = ${id}`)[0]).toEqual({ recruited_by: 'partner', kind: 'partner' })
    await page.reload()
    await expect(page.locator('main')).toContainText(name)
    await at(page, 'movil')
    await clean(page, 'ficha de dealer con socio, teléfono')
    await at(page, 'desktop')
    expect(errors).toEqual([])
  })

  test('Administración: Seguridad, Gobierno, Mercados y Embudo a la mano; un solo resguardo; WhatsApp en un solo lugar', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    const main = page.locator('main')
    await expect(main).toContainText('Resguardo del identificador completo')
    expect(await main.getByText('Resguardo del identificador completo').count()).toBe(1)
    await expect(main).not.toContainText('PROTECTED_DATA_VAULT')
    await page.goto('/admin/avisos')
    await page.getByTestId('pill-mercados').click()
    await expect(page.getByTestId('comms-whatsapp-moved').first()).toContainText('Administración, Mercados')
    await expect(page.locator('input[name="whatsapp_unit_cost"]')).toHaveCount(0)
    for (const path of ['/admin/seguridad', '/admin/gobierno', '/admin?tab=mercados', '/admin/embudo']) {
      const res = await page.goto(path)
      expect(res?.status() ?? 200, path).toBeLessThan(400)
      await at(page, 'movil')
      await clean(page, `${path}, teléfono`)
      await at(page, 'desktop')
    }
    expect(errors).toEqual([])
  })
})
