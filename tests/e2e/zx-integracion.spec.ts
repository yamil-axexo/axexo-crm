import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

// Lo que cruza paquetes, visto desde la pantalla: administración quita un acceso, el aviso lleva a repartir, Mi equipo
// cuenta lo mismo que la confirmación, y la visita por hacer se va con el comercio. El caso es de Operaciones, que
// cuenta como dueño vigente hasta que pierde el rol. Corre después de hoy.spec (prefijo zx-) y quita lo que arma.
const clean = async (page: Page, label: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

async function wipe() {
  const sql = testDb()
  await sql.begin(async (tx) => {
    await tx`create temp table _x_acc on commit drop as select id from crm.accounts where name like 'Cruce %'`
    await tx`create temp table _x_lead on commit drop as select id from crm.leads where business_name like 'Cruce %'`
    await tx`create temp table _x_user on commit drop as select id from crm.users where email like 'cruce.%@contigo.test'`
    await tx`delete from crm.exceptions where account_id in (select id from _x_acc) or lead_id in (select id from _x_lead)`
    await tx`delete from crm.activities where account_id in (select id from _x_acc) or lead_id in (select id from _x_lead)`
    await tx`delete from crm.leads where id in (select id from _x_lead)`
    await tx`delete from crm.account_attributions where account_id in (select id from _x_acc)`
    await tx`delete from crm.accounts where id in (select id from _x_acc)`
    await tx`delete from crm.memberships where user_id in (select id from _x_user)`
    await tx`delete from crm.user_onboarding where user_id in (select id from _x_user)`
    await tx`delete from crm.users where id in (select id from _x_user)`
  })
  await sql.end()
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(wipe)
test.afterAll(wipe)

for (const w of [{ name: 'escritorio', width: 1440, height: 900, tag: 'E' }, { name: 'teléfono', width: 390, height: 844, tag: 'T' }] as const) {
  test.describe(`quitar un acceso y repartir lo que deja, en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('la confirmación, el aviso y Mi equipo cuentan lo mismo; la visita por hacer se va con el comercio', async ({ page }) => {
      const errors = pageErrors(page)
      const name = `Operaciones Cruce ${w.tag} (sintética)`
      const sql = testDb()
      const [person] = await sql<{ id: string }[]>`
        insert into crm.users (email, full_name, locale, is_active, is_synthetic) values (${`cruce.${w.tag.toLowerCase()}@contigo.test`}, ${name}, 'es', true, true) returning id`
      await sql`insert into crm.memberships (user_id, market_code, role, valid_from) values (${person!.id}, 'US', 'ops', now() - interval '30 days')`
      await sql`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country)
                select 'US', 'store', ${`Cruce ${w.tag} Tienda 0`} || n, 'dealer', 'onboarding', ${person!.id}, 'Orlando', 'FL', 'US' from generate_series(1, 2) n`
      await sql`insert into crm.leads (market_code, source, motor, business_name, contact_name, email, locality, status, owner_id, assigned_at)
                values ('US', 'import', 'dealer', ${`Cruce ${w.tag} Lead`}, 'Test contact', ${`cruce.lead.${w.tag.toLowerCase()}@contigo.test`}, 'Orlando', 'new', ${person!.id}, now() - interval '2 days')`
      const [visit] = await sql<{ id: string }[]>`
        insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by)
        select 'US', a.id, 'visit', 'Visit ' || a.name, now() + interval '2 days', ${person!.id}, ${person!.id} from crm.accounts a where a.name = ${`Cruce ${w.tag} Tienda 01`} returning id`

      // Supervisión de US no lo ve mientras Operaciones lo lleva: tiene dueño vigente.
      await loginAs(page, 'kira.dunn')
      await page.goto('/supervisor')
      await expect(page.getByTestId('exception-queue')).toBeVisible()
      await expect(page.getByTestId('vacant-row').filter({ hasText: name })).toHaveCount(0)

      // Administración: la confirmación dice cuánto tiene y que va a quedar sin dueño vigente.
      await loginAs(page, 'nora.salas')
      await page.goto('/admin?tab=personas')
      await expect(page.getByTestId('admin-vacant-row').filter({ hasText: name })).toHaveCount(0)
      const row = page.getByTestId('person-row').filter({ hasText: name })
      await row.getByTestId('membership-open').click()
      const confirm = page.locator('dialog[open]')
      await expect(confirm.getByTestId('membership-role')).toHaveText('Operaciones · US')
      await expect(confirm.getByTestId('end-owned')).toHaveText(`${name} tiene a su nombre 2 comercios y 1 lead abierto en US.`)
      await expect(confirm.getByTestId('end-vacates')).toContainText('queda por repartir')
      await expect(confirm.getByTestId('end-rules')).toHaveCount(0) // Operaciones no está en turnos de leads
      await clean(page, `${w.name} confirmar`)
      await confirm.getByTestId('membership-end').click()

      // El aviso cuenta lo mismo y lleva a repartir; el bloque de cartera sin dueño vigente, también.
      const notice = page.getByTestId('admin-notice')
      await expect(notice).toContainText(`Acceso cerrado: ${name} ya no tiene ese rol.`)
      await expect(notice).toContainText('Lo que tiene a su nombre (2 comercios y 1 lead abierto) quedó por repartir en US: nadie lo atiende hasta que lo repartas.')
      const go = notice.getByTestId('admin-notice-link')
      await expect(go).toHaveText('Repartir')
      await expect(go).toHaveAttribute('href', `/comercios?owner=${person!.id}&market=US&repartir=1`)
      expect(await go.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44)
      await expect(page.getByTestId('admin-vacant-row').filter({ hasText: name })).toContainText('Tiene 2 comercios y 1 lead abierto por repartir.')
      await clean(page, `${w.name} aviso`)

      // El enlace abre la herramienta de reparto con lo suyo ya filtrado.
      await go.click()
      await expect(page).toHaveURL(new RegExp(`/comercios\\?owner=${person!.id}&market=US&repartir=1`))
      await expect(page.getByTestId('account-total')).toHaveText('2 comercios en esta vista')
      await expect(page.getByTestId('reparto-bar')).toBeVisible()

      // Supervisión de US ahora sí lo ve, con la misma cuenta, y lo reparte a su equipo.
      await loginAs(page, 'kira.dunn')
      await page.goto('/supervisor')
      const vacant = page.getByTestId('vacant-row').filter({ hasText: name })
      await expect(vacant.getByTestId('vacant-holds')).toHaveText('Holds 2 merchants and 1 open lead with no current owner.')
      await vacant.getByTestId('vacant-go').click()
      await expect(page.getByTestId('account-total')).toHaveText('2 merchants in this view')
      await page.getByTestId('reparto-scope-all').check()
      await page.getByTestId('reparto-to').selectOption({ label: 'Jade Kim' })
      await page.getByTestId('reparto-assign').click()
      // La visita por hacer cuenta entre lo que se va con los comercios.
      await expect(page.getByTestId('reparto-confirm')).toContainText('You are about to move 2 merchants to Jade Kim, with 0 open deals and 1 to-do.')
      await page.getByTestId('reparto-go').click()
      await expect(page.getByTestId('reparto-done')).toContainText('2 merchants moved to Jade Kim')
      const [moved] = await sql<{ owner: string }[]>`select u.full_name as owner from crm.activities x join crm.users u on u.id = x.owner_id where x.id = ${visit!.id}`
      expect(moved!.owner).toBe('Jade Kim')

      // Lo que queda sin repartir (el lead) sigue contado igual en Mi equipo.
      await page.goto('/supervisor')
      await expect(page.getByTestId('vacant-row').filter({ hasText: name }).getByTestId('vacant-holds')).toHaveText('Holds 1 open lead with no current owner.')
      await sql.end()
      expect(errors).toEqual([])
    })
  })
}
