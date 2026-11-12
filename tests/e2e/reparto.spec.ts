import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb, WIDTHS } from './helpers'
import { REPARTO, cleanReparto, seedReparto } from '../support/reparto-fixture'

// Reparto de cartera de punta a punta: supervisión y líder de mercado ven lo que no tiene dueño vigente y lo reparten
// por plaza, por lotes; administración mantiene los territorios; quien vende no ve nada de eso.
// El caso (cuenta de servicio, persona inactiva, alguien que ya no vende en el mercado) no viene en los datos sintéticos:
// se carga aquí y se quita al terminar, para no cambiarle los números a las demás pruebas.

const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const noSideScroll = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
/** Los controles del reparto se tocan con el dedo: 44 px de alto como mínimo. */
const tall = async (page: Page, testIds: string[]) => {
  // Alto de maquetación (offsetHeight): la animación de entrada de un diálogo no cambia el tamaño real del control.
  for (const id of testIds) expect(await page.getByTestId(id).first().evaluate((el) => (el as HTMLElement).offsetHeight), id).toBeGreaterThanOrEqual(44)
}

let casa = ''
let salio = ''
let exmx = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const sql = testDb()
  ;({ casa, salio, exmx } = await seedReparto(sql))
  // Dos comercios de US a nombre de alguien que hoy sí vende en US: quedan sin dueño vigente cuando se le quita el acceso.
  await sql`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country)
            select 'US', 'store', 'Reparto Dealer 0' || n, 'dealer', 'active', ${exmx}, 'Orlando', 'FL', 'US' from generate_series(1, 2) n`
  await sql.end()
})
test.afterAll(async () => {
  const sql = testDb()
  await cleanReparto(sql)
  await sql.end()
})

test.describe('supervisión reparte lo que no tiene dueño vigente (1440 px)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Mi equipo dice quién tiene qué sin dueño vigente y lleva a repartirlo por ciudad, todo el filtro de una vez', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'fernando.ibarra')
    await openMenu(page)
    await page.getByTestId('nav-supervisor').click()
    await expect(page).toHaveURL(/\/supervisor/)
    const row = page.getByTestId('vacant-row').filter({ hasText: 'Cuenta de servicio (sintética) (sin rol de ventas)' })
    await expect(row.getByTestId('vacant-holds')).toHaveText(`Tiene ${REPARTO.casaMx} comercios, ${REPARTO.casaDeals} negocios abiertos y ${REPARTO.casaLeads} leads abiertos sin dueño vigente.`)
    await expect(page.getByTestId('vacant-row').filter({ hasText: 'Exvendedora MX (sintética)' }).getByTestId('vacant-holds')).toHaveText(`Tiene ${REPARTO.exMx} comercios sin dueño vigente.`)
    await expect(page.getByTestId('vacant-block')).not.toContainText('Persona inactiva') // esa es de US
    await axe(page, 'mi equipo con sin dueño vigente')
    await noSideScroll(page, 'mi equipo')

    await row.getByTestId('vacant-go').click()
    await expect(page).toHaveURL(/\/comercios\?.*repartir=1/)
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaMx} comercios en esta vista`)
    await expect(page.getByTestId('owner-vacant').first()).toHaveText('Sin dueño vigente')
    await expect(page.getByTestId('filter-owner')).toHaveValue(casa)
    // Solo su equipo como destino: no puede mandar una tienda de calle a una ejecutiva de cadenas.
    expect(await page.getByTestId('reparto-to').locator('option').allInnerTexts()).toEqual(['Elige a una persona', 'Fernando Ibarra', 'Lucía Vega', 'Marco Peña'])
    await axe(page, 'comercios repartiendo')

    await page.getByTestId('filter-city').fill('torreon')
    await page.getByTestId('place-apply').click()
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaTorreon} comercios en esta vista`)
    await page.getByTestId('reparto-scope-all').check()
    await expect(page.getByTestId('reparto-assign')).toBeDisabled() // falta decir a quién
    await page.getByTestId('reparto-to').selectOption({ label: 'Lucía Vega' })
    await page.getByTestId('reparto-assign').click()
    await expect(page.getByTestId('reparto-confirm')).toContainText(`Vas a pasar ${REPARTO.casaTorreon} comercios a Lucía Vega, con 0 negocios abiertos y 0 tareas abiertas.`)
    await expect(page.getByTestId('reparto-confirm')).toContainText('CONTIGO no le avisa a nadie')
    await axe(page, 'comercios confirmación')
    await page.getByTestId('reparto-go').click()
    await expect(page.getByTestId('reparto-done')).toContainText(`Listo. ${REPARTO.casaTorreon} comercios pasaron a Lucía Vega, con sus negocios y tareas abiertas.`)
    await expect(page.getByTestId('account-total')).toHaveText('0 comercios en esta vista')
    expect(errors).toEqual([])
  })

  test('marcar varios en la lista y reasignarlos: se van con sus negocios y tareas, y queda en la bitácora', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto(`/comercios?owner=${casa}&market=MX&repartir=1`)
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaMonterrey} comercios en esta vista`)
    const rows = page.getByTestId('reparto-row')
    await rows.nth(0).check()
    await rows.nth(1).check()
    await expect(page.getByTestId('reparto-selected')).toHaveText('Los que marque (2)')
    await page.getByTestId('reparto-to').selectOption({ label: 'Marco Peña' })
    await page.getByTestId('reparto-assign').click()
    await expect(page.getByTestId('reparto-confirm')).toContainText('Vas a pasar 2 comercios a Marco Peña, con sus negocios y tareas abiertas.')
    await page.getByTestId('reparto-cancel').click() // cancelar no mueve nada
    await expect(page.getByTestId('reparto-selected')).toHaveText('Los que marque (2)')
    await page.getByTestId('reparto-assign').click()
    await page.getByTestId('reparto-go').click()
    await expect(page.getByTestId('reparto-done')).toContainText('Listo. 2 comercios pasaron a Marco Peña')
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaMonterrey - 2} comercios en esta vista`)
    await page.getByTestId('reparto-again').click()
    await expect(page.getByTestId('reparto-selected')).toHaveText('Los que marque (0)')

    // "Marcar los de esta página" y, sin un filtro que acote, no se ofrece mover todo el mercado.
    await page.getByTestId('reparto-page').check()
    await expect(page.getByTestId('reparto-selected')).toHaveText(`Los que marque (${REPARTO.casaMonterrey - 2})`)
    await page.goto('/comercios?repartir=1')
    await expect(page.getByTestId('reparto-scope-all')).toBeDisabled()
    await expect(page.getByTestId('reparto-narrow')).toContainText('filtra primero por dueño, región, ciudad o territorio')

    const sql = testDb()
    const [r] = await sql<{ deals: number; tasks: number; audit: number }[]>`
      select (select count(*)::int from crm.deals d join crm.users u on u.id = d.owner_id where d.title in ('Alta: Reparto Abarrotes 01', 'Alta: Reparto Abarrotes 02') and u.full_name = 'Marco Peña') as deals,
             (select count(*)::int from crm.activities x join crm.deals d on d.id = x.deal_id join crm.users u on u.id = x.owner_id where d.title in ('Alta: Reparto Abarrotes 01', 'Alta: Reparto Abarrotes 02') and u.full_name = 'Marco Peña') as tasks,
             (select count(*)::int from crm.audit_events e join crm.users u on u.id = e.actor_id where e.action = 'account.reassigned' and u.full_name = 'Fernando Ibarra' and e.before -> 'from_user_ids' ? ${casa}) as audit`
    await sql.end()
    expect(r).toEqual({ deals: 2, tasks: 2, audit: 2 })

    // Quien las recibió ya las ve; la búsqueda encuentra por ciudad.
    await loginAs(page, 'lucia.vega')
    await page.goto('/comercios')
    await page.getByTestId('account-search').fill('Torreón')
    await page.getByTestId('account-search').press('Enter')
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaTorreon} comercios en esta vista`)
    await page.getByTestId('account-search').fill('Monterrey')
    await page.getByTestId('account-search').press('Enter')
    await expect(page.getByTestId('account-row').first()).toBeVisible()
  })

  test('quien vende no ve nada de esto ni tiene con qué repartir; supervisión de otro mercado tampoco', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios?owner=${casa}&repartir=1`)
    await expect(page.getByTestId('account-total')).toHaveText('0 comercios en esta vista')
    await expect(page.getByTestId('reparto-toggle')).toHaveCount(0)
    await expect(page.getByTestId('reparto-bar')).toHaveCount(0)
    await expect(page.getByTestId('filter-owner')).toHaveCount(0)
    await page.goto('/comercios?q=Reparto')
    await expect(page.getByTestId('account-total')).toHaveText('2 comercios en esta vista') // los dos que le pasaron
    await page.getByTestId('place-filters-toggle').click()
    await expect(page.getByTestId('filter-city')).toBeVisible() // filtrar por plaza sí es para todos
    expect((await page.goto('/supervisor'))?.status()).toBe(404)
    expect((await page.goto('/admin?tab=territorios'))?.status()).toBe(404)

    await loginAs(page, 'kira.dunn')
    await page.goto(`/comercios?owner=${casa}&market=MX&repartir=1`)
    await expect(page.getByTestId('account-total')).toHaveText('0 merchants in this view')
    await page.goto('/supervisor')
    await expect(page.getByTestId('vacant-block')).toContainText('Persona inactiva (sintética) (inactive)')
    await expect(page.getByTestId('vacant-block')).not.toContainText('Cuenta de servicio')
  })
})

test.describe('quien lidera el mercado reparte desde el teléfono (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Reasignar cartera: negocios abiertos, leads abiertos y comercios de una persona inactiva', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'robert.hale')
    await page.goto('/supervisor')
    const row = page.getByTestId('vacant-row').filter({ hasText: 'Persona inactiva (sintética) (inactive)' })
    await expect(row.getByTestId('vacant-holds')).toHaveText(`Holds ${REPARTO.salioUs} merchants, ${REPARTO.salioUs} open deals and ${REPARTO.salioLeads} open leads with no current owner.`)
    await noSideScroll(page, 'my team 390')
    await axe(page, 'my team 390')
    await tall(page, ['vacant-go', 'reassign-book'])

    // 1) Solo los negocios abiertos: el comercio se queda con su dueño.
    await page.getByTestId('reassign-book').click()
    const form = page.getByTestId('reparto-form')
    await expect(form).toBeVisible()
    await tall(page, ['reparto-from', 'reparto-form-to', 'reparto-review'])
    await page.getByTestId('reparto-what-deals').check()
    await page.getByTestId('reparto-from').selectOption(salio)
    await page.getByTestId('reparto-form-to').selectOption({ label: 'Jade Kim' })
    await axe(page, 'reassign book 390')
    await noSideScroll(page, 'reassign book 390')
    await page.getByTestId('reparto-review').click()
    await expect(page.getByTestId('reparto-confirm')).toContainText(`You are about to move ${REPARTO.salioUs} open deals to Jade Kim.`)
    await page.getByTestId('reparto-go').click()
    await expect(page.getByTestId('reparto-done')).toContainText(`Done. ${REPARTO.salioUs} open deals moved to Jade Kim.`)

    // 2) Sus leads abiertos, a otra persona.
    await page.getByTestId('reparto-again').click()
    await page.getByTestId('reparto-what-leads').check()
    await page.getByTestId('reparto-from').selectOption(salio)
    await page.getByTestId('reparto-form-to').selectOption({ label: 'Sam Ortiz' })
    await page.getByTestId('reparto-review').click()
    await expect(page.getByTestId('reparto-confirm')).toContainText(`You are about to move ${REPARTO.salioLeads} open leads to Sam Ortiz.`)
    await page.getByTestId('reparto-go').click()
    await expect(page.getByTestId('reparto-done')).toContainText(`Done. ${REPARTO.salioLeads} open leads moved to Sam Ortiz.`)

    // 3) Sus comercios de Florida, con lo abierto que todavía cuelgue de ellos.
    await page.getByTestId('reparto-again').click()
    await page.getByTestId('reparto-what-accounts').check()
    await page.getByTestId('reparto-from').selectOption(salio)
    await page.getByTestId('reparto-region').selectOption('FL')
    await page.getByTestId('reparto-city').fill('tampa')
    await page.getByTestId('reparto-form-to').selectOption({ label: 'Sam Ortiz' })
    await page.getByTestId('reparto-review').click()
    await expect(page.getByTestId('reparto-confirm')).toContainText(`You are about to move ${REPARTO.salioUs} merchants to Sam Ortiz, with ${REPARTO.salioUs} open deals and ${REPARTO.salioUs} open tasks.`)
    await expect(page.getByTestId('reparto-list')).toHaveAttribute('href', new RegExp(`/comercios\\?market=US&owner=${salio}&region=FL&city=tampa&repartir=1`))
    await page.getByTestId('reparto-go').click()
    await expect(page.getByTestId('reparto-done')).toContainText(`Done. ${REPARTO.salioUs} merchants moved to Sam Ortiz, with their open deals and tasks.`)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('vacant-row').filter({ hasText: 'Persona inactiva' })).toHaveCount(0)
    expect(errors).toEqual([])

    const sql = testDb()
    const [r] = await sql<{ accounts: number; deals: number; leads: number }[]>`
      select (select count(*)::int from crm.accounts a join crm.users u on u.id = a.owner_id where a.name like 'Reparto Wireless %' and u.full_name = 'Sam Ortiz') as accounts,
             (select count(*)::int from crm.deals d join crm.users u on u.id = d.owner_id where d.title like 'Onboarding: Reparto %' and u.full_name = 'Sam Ortiz') as deals,
             (select count(*)::int from crm.leads l join crm.users u on u.id = l.owner_id where l.business_name like 'Reparto Lead Store %' and u.full_name = 'Sam Ortiz') as leads`
    await sql.end()
    expect(r).toEqual({ accounts: REPARTO.salioUs, deals: REPARTO.salioUs, leads: REPARTO.salioLeads })
  })

  test('la lista en el teléfono: dueño a la vista, filtros por plaza y repartir sin desbordes', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto(`/comercios?owner=${casa}&market=MX&repartir=1`)
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaMonterrey - 2} comercios en esta vista`)
    await expect(page.getByTestId('row-owner').first()).toContainText('Cuenta de servicio (sintética) · sin dueño vigente')
    await noSideScroll(page, 'comercios repartiendo 390')
    await axe(page, 'comercios repartiendo 390')
    await tall(page, ['reparto-toggle', 'reparto-to', 'reparto-assign', 'reparto-territory', 'filter-owner', 'filter-region', 'filter-city', 'filter-territory', 'place-apply'])
    expect((await page.getByTestId('reparto-row').first().locator('xpath=..').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44)
    // Quien lidera el mercado sí puede pasar a cualquier equipo, y los ve agrupados.
    expect(await page.getByTestId('reparto-to').locator('optgroup').evaluateAll((els) => els.map((e) => e.getAttribute('label')))).toEqual(expect.arrayContaining(['B2B México', 'D2D Centro']))
    await page.getByTestId('filter-region').selectOption('Nuevo León')
    await page.getByTestId('place-apply').click()
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaMonterrey - 2} comercios en esta vista`)
    await page.getByTestId('reparto-toggle').click()
    await expect(page.getByTestId('reparto-bar')).toHaveCount(0)
    await expect(page.getByTestId('reparto-row')).toHaveCount(0)
  })
})

test.describe('territorios', () => {
  test('administración los crea, les cambia el nombre, los asigna y los archiva; supervisión los pone en bloque y filtra por ellos', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=territorios')
    const mx = page.getByTestId('territories-MX')
    await mx.getByTestId('territory-name').fill('Reparto Laguna')
    await mx.getByTestId('territory-add').click()
    const row = mx.getByTestId('territory-row').filter({ has: page.locator('input[value^="Reparto Laguna"]') })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('0 comercios · 0 personas')
    await expect(mx.getByTestId('territory-create').getByTestId('form-ok')).toHaveText('Territorio agregado.')
    await page.waitForTimeout(800) // el formulario ignora un segundo envío inmediato (protección contra doble clic)
    await mx.getByTestId('territory-name').fill('reparto laguna')
    await mx.getByTestId('territory-add').click()
    await expect(mx.getByTestId('territory-create').getByTestId('form-error')).toHaveText('Ya hay un territorio con ese nombre en ese mercado.')
    await row.getByTestId('territory-rename').fill('Reparto Laguna y Norte')
    await row.getByTestId('territory-rename-save').click()
    await expect(row.getByTestId('form-ok')).toHaveText('Nombre guardado.')
    const person = mx.getByTestId('territory-person').filter({ hasText: 'Lucía Vega' })
    await person.getByLabel('Reparto Laguna y Norte').check()
    await person.getByTestId('territory-person-save').click()
    await expect(person.getByTestId('form-ok')).toHaveText('Territorios guardados.')
    await expect(mx.getByTestId('territory-row').filter({ has: page.locator('input[value="Reparto Laguna y Norte"]') })).toContainText('0 comercios · 1 persona')
    await axe(page, 'admin territorios')
    await noSideScroll(page, 'admin territorios')

    // Supervisión pone el territorio a todo un filtro y después filtra por él.
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/comercios?q=Reparto&city=Torre%C3%B3n&repartir=1')
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaTorreon} comercios en esta vista`)
    await page.getByTestId('reparto-scope-all').check()
    await page.getByTestId('reparto-territory').selectOption({ label: 'Reparto Laguna y Norte' })
    await page.getByTestId('reparto-set-territory').click()
    await expect(page.getByTestId('reparto-confirm')).toContainText(`Vas a poner el territorio Reparto Laguna y Norte a ${REPARTO.casaTorreon} comercios.`)
    await page.getByTestId('reparto-go').click()
    await expect(page.getByTestId('reparto-done')).toContainText(`Listo. ${REPARTO.casaTorreon} comercios quedaron en el territorio Reparto Laguna y Norte.`)
    await page.goto('/comercios')
    await page.getByTestId('place-filters-toggle').click()
    await page.getByTestId('filter-territory').selectOption({ label: 'Reparto Laguna y Norte' })
    await page.getByTestId('place-apply').click()
    await expect(page.getByTestId('account-total')).toHaveText(`${REPARTO.casaTorreon} comercios en esta vista`)
    await expect(page.getByTestId('account-row').first()).toContainText('Reparto Laguna y Norte')

    // Archivar: deja de ofrecerse, los comercios lo conservan.
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=territorios')
    const used = page.getByTestId('territories-MX').getByTestId('territory-row').filter({ has: page.locator('input[value="Reparto Laguna y Norte"]') })
    await expect(used).toContainText(`${REPARTO.casaTorreon} comercios · 1 persona`)
    await used.getByTestId('territory-archive').click()
    await expect(used).toContainText('archivado')
    await page.goto('/comercios?market=MX&repartir=1')
    expect(await page.getByTestId('reparto-territory').locator('option').allInnerTexts()).not.toContain('Reparto Laguna y Norte')
    expect(errors).toEqual([])
  })

  for (const w of WIDTHS) {
    test(`la pantalla de territorios y la lista repartiendo caben en ${w.name} (${w.width} px)`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height })
      await loginAs(page, 'nora.salas')
      for (const [path, label] of [['/admin?tab=territorios', 'territorios'], ['/comercios?market=MX&owner=vacant&repartir=1', 'comercios repartiendo'], ['/supervisor', 'mi equipo']] as const) {
        expect((await page.goto(path))?.status(), path).toBeLessThan(400)
        await expect(page.locator('h1').first()).toBeVisible()
        await noSideScroll(page, `${w.name} ${label}`)
        await axe(page, `${w.name} ${label}`)
      }
    })
  }
})

test.describe('al quitarle el acceso a alguien', () => {
  test('administración ve lo que deja sin dueño vigente, y supervisión del mercado lo encuentra en Mi equipo', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=personas')
    const person = page.getByTestId('person-row').filter({ hasText: 'Exvendedora MX (sintética)' })
    await expect(page.getByTestId('admin-vacant-row').filter({ hasText: 'Exvendedora MX (sintética) (sin rol de ventas) · US' })).toHaveCount(0) // todavía vende en US
    await person.getByTestId('membership-end').click()
    // El aviso queda en la pantalla: no depende de un mensaje que se va al repintar.
    const notice = page.getByTestId('admin-vacant-row').filter({ hasText: 'Exvendedora MX (sintética) (sin rol de ventas) · US' })
    await expect(notice).toContainText('Tiene 2 comercios sin dueño vigente.')
    await expect(notice.getByTestId('admin-vacant-go')).toHaveAttribute('href', new RegExp(`/comercios\\?owner=${exmx}&market=US&repartir=1`))

    await loginAs(page, 'kira.dunn')
    await page.goto('/supervisor')
    const row = page.getByTestId('vacant-row').filter({ hasText: 'Exvendedora MX (sintética)' })
    await expect(row.getByTestId('vacant-holds')).toHaveText('Holds 2 merchants with no current owner.')
    await row.getByTestId('vacant-go').click()
    await expect(page.getByTestId('account-total')).toHaveText('2 merchants in this view')
    await expect(page.getByTestId('reparto-bar')).toBeVisible()
  })
})
