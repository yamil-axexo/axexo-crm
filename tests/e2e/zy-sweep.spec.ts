import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, testDb, WIDTHS } from './helpers'

const SHOTS = process.env.E2E_SHOTS

/**
 * Barrido de todas las pantallas en los tres anchos (handoff, secciones 8 y 12):
 * abren, nada se sale del ancho y axe no encuentra hallazgos serios ni críticos.
 */
async function check(page: Page, path: string, label: string) {
  const res = await page.goto(path)
  expect(res?.status(), path).toBeLessThan(400)
  await expect(page.locator('h1').first(), path).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`), label).toEqual([])
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/[^a-z0-9]+/gi, '-')}.png` })
}

let ids: { lead: string; deal: string; account: string }
test.beforeAll(async () => {
  const sql = testDb()
  const [x] = await sql<{ lead: string; deal: string; account: string }[]>`
    select (select l.id from crm.leads l join crm.users u on u.id = l.owner_id where u.full_name = 'Marco Peña' and l.status = 'new' order by l.id limit 1) as lead,
           (select d.id from crm.deals d join crm.users u on u.id = d.owner_id where u.full_name = 'Marco Peña' and d.status = 'open' order by d.id limit 1) as deal,
           (select a.id from crm.accounts a join crm.users u on u.id = a.owner_id where u.full_name = 'Marco Peña' and a.archived_at is null order by a.id limit 1) as account`
  await sql.end()
  ids = x!
})

for (const w of WIDTHS) {
  test.describe(`barrido en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('lo público: entrada y formulario web', async ({ page }) => {
      await check(page, '/login', `${w.name} login`)
      await check(page, '/f/tiendas-mx', `${w.name} formulario`)
    })

    test('lo de quien vende: lead, negocio, comercio, campos y actividades', async ({ page }) => {
      await loginAs(page, 'marco.pena')
      for (const [path, name] of [
        [`/leads/${ids.lead}`, 'lead'],
        [`/deals/${ids.deal}`, 'negocio'],
        [`/comercios/${ids.account}`, 'comercio'],
        [`/comercios/${ids.account}?tab=datos`, 'comercio datos'],
        [`/comercios/${ids.account}/campos`, 'campos'],
        ['/actividades', 'actividades'],
        ['/buscar', 'buscar'],
      ] as const) await check(page, path, `${w.name} ${name}`)
    })

    test('supervisión, panel del LT y administración', async ({ page }) => {
      await loginAs(page, 'nora.salas')
      for (const [path, name] of [
        ['/supervisor', 'supervisor'],
        ['/panel-lt', 'panel lt'],
        ['/admin?tab=personas', 'admin personas'],
        ['/admin?tab=embudos', 'admin embudos'],
        ['/admin?tab=entrada', 'admin entrada'],
        ['/admin?tab=integraciones', 'admin integraciones'],
        ['/admin?tab=pipedrive', 'admin pipedrive'],
        ['/admin?tab=calidad', 'admin calidad'],
        ['/admin?tab=auditoria', 'admin auditoria'],
      ] as const) await check(page, path, `${w.name} ${name}`)
    })
  })
}
