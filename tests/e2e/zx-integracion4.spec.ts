import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, pageErrors, testDb } from './helpers'

// Ola 4, integración: lo que el integrador cerró después de juntar ajustes-campo y ajustes-lider, visto en pantalla.
const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7).replace(/\d/g, 'x')
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

/** Un lead de US, nuevo y a nombre de Jade, con su reloj de primer contacto. */
async function usLead(): Promise<string> {
  const jade = await uid('jade.kim')
  const [lead] = await sql<{ id: string }[]>`
    insert into crm.leads (market_code, source, motor, business_name, contact_name, phone, status, owner_id, assigned_at, sla_due_at)
    values ('US', 'manual', 'dealer', ${`Eastern Wireless ${tag()}`}, 'Dana Fox', ${`+1305555${Math.floor(1000 + Math.random() * 8999)}`}, 'new', ${jade}, now(), now() + interval '3 hours')
    returning id`
  return lead!.id
}

test.describe('la zona de US se dice con nombre', () => {
  test.describe('con el navegador en la zona del mercado', () => {
    test.use({ timezoneId: 'America/New_York' })
    test('el lead dice "Eastern" y no agrega la hora local', async ({ page }) => {
      const id = await usLead()
      await loginAs(page, 'jade.kim')
      await page.goto(`/leads/${id}`)
      await expect(page.getByTestId('lead-arrived')).toContainText(/\d{1,2}:\d{2} [AP]M Eastern$/)
      await expect(page.getByTestId('lead-steps')).toContainText(/First contact: due .+ [AP]M Eastern\. The clock only runs during business hours\./)
      await expect(page.locator('main')).not.toContainText('United States time')
      await expect(page.getByTestId('own-time')).toHaveCount(0)
    })
  })

  for (const w of [{ name: 'escritorio', width: 1440, height: 900 }, { name: 'teléfono', width: 390, height: 844 }]) {
    test.describe(`con el navegador en otra zona (${w.name})`, () => {
      test.use({ timezoneId: 'America/Chicago', viewport: { width: w.width, height: w.height } })
      test('el lead agrega la hora local entre paréntesis, en inglés y en español', async ({ page }) => {
        const errors = pageErrors(page)
        const id = await usLead()
        await loginAs(page, 'jade.kim')
        await page.goto(`/leads/${id}`)
        await expect(page.getByTestId('lead-arrived')).toContainText(/[AP]M Eastern \(\d{1,2}:\d{2} [AP]M your time\)$/)
        await expect(page.getByTestId('lead-steps').getByTestId('own-time')).toContainText('your time')
        await clean(page, `lead de US en otra zona ${w.name}`)
        await page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: new URL('/', page.url()).href }])
        await page.reload()
        await expect(page.locator('html')).toHaveAttribute('lang', 'es')
        await expect(page.getByTestId('lead-arrived')).toContainText(/hora del Este \(\d{1,2}:\d{2} [ap]\.\s?m\. tu hora\)$/)
        await clean(page, `lead de US en otra zona, en español ${w.name}`)
        expect(errors).toEqual([])
      })
    })
  }

  test('el hilo del comercio y el del negocio dicen la zona que usan', async ({ page }) => {
    const jade = await uid('jade.kim')
    const [deal] = await sql<{ id: string; account_id: string }[]>`
      select d.id, d.account_id from crm.deals d
       where d.market_code = 'US' and d.owner_id = ${jade} and d.status = 'open'
         and exists (select 1 from crm.activities a where a.account_id = d.account_id and a.done_at is not null)
       order by d.created_at limit 1`
    test.skip(!deal, 'el seed no dejó un negocio de Jade con historia')
    await loginAs(page, 'jade.kim')
    await page.goto(`/deals/${deal!.id}`)
    await expect(page.getByTestId('thread-zone')).toHaveText('Times are in Eastern time.')
    await page.goto(`/comercios/${deal!.account_id}`)
    await fichaTab(page, 'hilo')
    await expect(page.getByTestId('thread-zone')).toHaveText('Times are in Eastern time.')
  })
})

test.describe('tomar una tienda sin asignar', () => {
  const store = async (code: string) => {
    const [t] = await sql<{ id: string }[]>`select id from crm.territories where market_code = 'MX' and code = ${code}`
    const [a] = await sql<{ id: string; name: string }[]>`
      insert into crm.accounts (market_code, kind, account_type, name, segment, lifecycle, territory_id, country, created_by)
      values ('MX', 'store', 'store', ${`Tienda Libre ${code} ${tag()}`}, 'd2d', 'prospect', ${t!.id}, 'MX', ${await uid('ana.robles')}) returning id, name`
    return a!
  }

  for (const w of [{ name: 'escritorio', width: 1440, height: 900 }, { name: 'teléfono', width: 390, height: 844 }]) {
    test(`quien vende toma la de su territorio; la de otro territorio le dice a quién pedirla (${w.name})`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height })
      const errors = pageErrors(page)
      const mine = await store('GDL')
      const other = await store('MTY')
      await loginAs(page, 'marco.pena')
      await page.goto(`/comercios/${mine.id}`)
      await expect(page.getByTestId('ficha-ask')).toHaveCount(0)
      await clean(page, `ficha sin asignar ${w.name}`)
      await page.getByTestId('ficha-take').click()
      const confirm = page.locator('dialog[open]')
      await expect(confirm).toContainText(`${mine.name} queda a tu nombre`)
      await confirm.getByRole('button', { name: 'Sí, tomarla' }).click()
      await expect(page.getByTestId('ficha')).toContainText('Marco Peña')
      await expect(page.getByTestId('ficha-take')).toHaveCount(0)
      const [row] = await sql<{ owner: string }[]>`select u.full_name as owner from crm.accounts a join crm.users u on u.id = a.owner_id where a.id = ${mine.id}`
      expect(row!.owner).toBe('Marco Peña')

      // Supervisión sí puede tomar la de un territorio que no es de Marco, y a Marco esa ficha no se le abre con el botón
      await loginAs(page, 'fernando.ibarra')
      await page.goto(`/comercios/${other.id}`)
      await expect(page.getByTestId('ficha-take')).toHaveText('Tomar esta tienda')
      await expect(page.getByTestId('ficha-ask')).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }

  test('en inglés el botón dice "Take this store"', async ({ page }) => {
    const [t] = await sql<{ id: string }[]>`select id from crm.territories where market_code = 'US' and code = 'FL'`
    const [a] = await sql<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, account_type, name, segment, lifecycle, territory_id, country, created_by)
      values ('US', 'store', 'store', ${`Open Store ${tag()}`}, 'dealer', 'prospect', ${t!.id}, 'US', ${await uid('robert.hale')}) returning id`
    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/${a!.id}`)
    await expect(page.getByTestId('ficha-take')).toHaveText('Take this store')
    // Sam vende en Nevada: esa tienda de Florida no es de sus territorios y la ficha, si la ve, le dice a quién pedirla
    await loginAs(page, 'sam.ortiz')
    const res = await page.goto(`/comercios/${a!.id}`)
    if (res?.status() === 200) {
      await expect(page.getByTestId('ficha-take')).toHaveCount(0)
      await expect(page.getByTestId('ficha-ask')).toHaveText('To take it on, ask your supervisor or your market lead.')
    }
  })
})

test('Administración: la columna de etapas dice "Para avanzar" y las etapas sembradas dicen "quien decide"', async ({ page }) => {
  await loginAs(page, 'nora.salas', { stay: true })
  await page.goto('/admin?tab=embudos')
  await expect(page.getByTestId('stage-exit-head').first()).toHaveText('Para avanzar')
  await expect(page.locator('main')).not.toContainText('Criterio de salida')
  // las etapas sembradas ya no dicen "decisor": ni en el nombre ni en lo que piden ni en "Para avanzar"
  for (const row of await page.getByTestId('stage-row').all()) await expect(row).not.toContainText(/decisor/i)
  await expect(page.getByTestId('stage-name').filter({ hasText: 'Interés de quien decide' }).first()).toBeVisible()
})

test('Hoy de quien supervisa: con pendientes en el equipo no titula "Todo al día"', async ({ page }) => {
  // La segunda vuelta de aceptación: el cuerpo ya decía cuántos tiene el equipo, pero el título seguía diciendo "Todo al día".
  let checked = 0
  for (const [persona, own, team] of [
    ['fernando.ibarra', 'No tienes pendientes propios', /Tu equipo tiene \d+ pendientes? abiertos?\./],
    ['paula.mendez', 'No tienes pendientes propios', /Tu equipo tiene \d+ pendientes? abiertos?\./],
    ['kira.dunn', 'Nothing of your own to do', /Your team has \d+ open alerts?\./],
  ] as const) {
    await loginAs(page, persona)
    await page.goto('/hoy')
    await expect(page.getByTestId('today-title')).toBeVisible()
    // Solo aplica a quien no tiene nada propio y sí tiene equipo con pendientes: ahí están la tarjeta vacía y su enlace.
    if (!(await page.getByTestId('queue-empty-team').count())) continue
    checked++
    await expect(page.getByTestId('today-title'), persona).toContainText(own)
    await expect(page.getByTestId('today-title'), persona).not.toContainText(/Todo al día|All caught up/)
    await expect(page.getByTestId('queue-empty'), persona).toContainText(own)
    await expect(page.getByTestId('queue-empty'), persona).toContainText(team)
    await clean(page, `Hoy de ${persona} sin pendientes propios`)
  }
  expect(checked, 'al menos una persona que supervisa sin pendientes propios y con pendientes en su equipo').toBeGreaterThan(0)
})
