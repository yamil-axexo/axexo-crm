import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb, WIDTHS } from './helpers'

// Paquete mx: México como lo describe el documento de requerimientos (épicas E14 a E18), desde la pantalla y por el rol
// que corresponde, en español y en inglés, a 1440, 1024 y 390 px.
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase()
const phone = () => `55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000))

async function check(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  // El encabezado y el dock fijos tapan lo que quedó a medio desplazar: se mide con la página arriba.
  await page.evaluate(() => window.scrollTo(0, 0))
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`), `${what}: accesibilidad`).toEqual([])
}

async function widths(page: Page, what: string) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await check(page, `${what} (${w.name})`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

const english = async (page: Page) => {
  await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
  await page.reload()
}
const spanish = async (page: Page) => {
  await page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])
  await page.reload()
}

test.describe('E15 · leads de campaña de México', () => {
  test('el formulario de cadenas y distribuidores pregunta el tipo de empresa; el lead llega con embudo, canal, origen, tipo y número de tiendas, y se filtra por ellos', async ({ page }) => {
    const errors = pageErrors(page)
    const business = `Distribuidora Campaña ${uniq()}`
    await page.goto('/f/contacto-mx?utm_source=meta&utm_campaign=cadenas-nov')
    await expect(page.getByTestId('public-company-type').locator('option')).toHaveText(['Elige una opción', 'Distribuidor', 'Cadena'])
    await widths(page, 'formulario de cadenas y distribuidores')
    await page.locator('input[name=business_name]').fill(business)
    await page.getByTestId('public-company-type').selectOption({ label: 'Distribuidor' })
    await page.locator('input[name=contact_name]').fill('Contacto De Campaña')
    await page.locator('input[name=phone]').fill(phone())
    await page.locator('input[name=x_b2b_points_of_sale]').fill('44')
    await page.getByTestId('public-submit').click()
    await expect(page.getByTestId('public-form').getByTestId('form-ok')).toBeVisible()
    // el formulario de tiendas independientes no pregunta tipo de empresa
    await page.goto('/f/tiendas-mx')
    await expect(page.getByTestId('public-company-type')).toHaveCount(0)

    await loginAs(page, 'ana.robles')
    await page.goto('/leads?status=all')
    await page.getByTestId('lead-f-type').selectOption({ label: 'Distribuidor' })
    await page.getByTestId('lead-f-funnel').selectOption('F2')
    await page.getByTestId('lead-f-stores-min').fill('44')
    await page.getByTestId('lead-f-stores-max').fill('44')
    await page.getByTestId('lead-apply').click()
    await expect(page).toHaveURL(/tipo=distributor/)
    const row = page.getByTestId('lead-row').filter({ hasText: business })
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('lead-fields')).toHaveText('Distribuidor · 44 tiendas · Embudo F2')
    await expect(row).toContainText('Campaña web')
    await widths(page, 'leads filtrados por tipo de empresa y tiendas')
    // con un máximo menor ya no aparece
    await page.getByTestId('lead-f-stores-max').fill('43')
    await page.getByTestId('lead-f-stores-min').fill('')
    await page.getByTestId('lead-apply').click()
    await expect(page.getByTestId('lead-row').filter({ hasText: business })).toHaveCount(0)

    await page.goto('/leads?status=all&tipo=distributor&tiendas_min=44&tiendas_max=44')
    await page.getByTestId('lead-row').filter({ hasText: business }).getByRole('link', { name: business }).click()
    await expect(page.getByTestId('lead-source-text')).toContainText('Campaña web')
    await expect(page.getByTestId('lead-funnel')).toHaveText('F2')
    await expect(page.getByTestId('lead-channel')).toHaveText('mx-web-cadenas')
    await expect(page.getByTestId('lead-stores')).toHaveText('44')
    await expect(page.getByTestId('lead-kind-text')).toHaveText('Distribuidor')
    await expect(page.getByTestId('origin-utm_campaign')).toHaveText('cadenas-nov')
    await english(page)
    await expect(page.getByTestId('lead-source-text')).toContainText('Web campaign')
    await expect(page.getByTestId('lead-kind-text')).toHaveText('Distributor')
    await spanish(page)
    expect(errors).toEqual([])
  })

  test('administración ve y cambia la meta de respuesta de cada turno y el embudo de campaña de cada formulario', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=entrada')
    const targets = page.getByTestId('mx-targets')
    const b2b = targets.getByTestId('target-row').filter({ hasText: 'Web MX B2B' })
    const d2d = targets.getByTestId('target-row').filter({ hasText: 'Tiendas independientes MX' })
    await expect(b2b.getByTestId('target-text')).toContainText('1 hora hábil')
    await expect(d2d.getByTestId('target-text')).toContainText('1 día hábil')
    // el turno dice su meta con las mismas palabras
    await expect(page.getByTestId('rule-card').filter({ hasText: 'Tiendas independientes MX' })).toContainText('respuesta en 1 día hábil')
    // (al guardar, el formulario vuelve a sus valores: se reintenta hasta que el campo ya tomó lo escrito)
    const setTarget = async (amount: string, text: string) => expect(async () => {
      await b2b.getByTestId('target-amount').fill(amount)
      await b2b.getByTestId('target-save').click()
      await expect(b2b.getByTestId('target-text')).toContainText(text, { timeout: 3000 })
    }).toPass({ timeout: 20_000 })
    await setTarget('2', '2 horas hábiles')
    await setTarget('1', '1 hora hábil')
    // una meta fuera de rango se explica
    await d2d.getByTestId('target-amount').fill('40')
    await d2d.getByTestId('target-save').click()
    await expect(d2d.getByTestId('form-error')).toContainText('días hábiles')

    const forms = page.getByTestId('mx-campaigns')
    const f2 = forms.getByTestId('campaign-row').filter({ hasText: '/f/contacto-mx' })
    await expect(f2.getByTestId('campaign-funnel')).toHaveValue('F2')
    await expect(f2.getByTestId('campaign-channel')).toHaveValue('mx-web-cadenas')
    await expect(f2.getByTestId('campaign-on')).toBeChecked()
    await expect(f2.getByTestId('campaign-type-distributor')).toBeChecked()
    await expect(f2.getByTestId('campaign-type-chain')).toBeChecked()
    await expect(f2.getByTestId('campaign-type-store')).not.toBeChecked()
    const us = forms.getByTestId('campaign-row').filter({ hasText: '/f/dealers-us' })
    await us.getByTestId('campaign-channel').fill('Con Espacios')
    await us.getByTestId('campaign-save').click()
    await expect(us.getByTestId('form-error')).toBeVisible()
    await widths(page, 'administración, formularios y turnos')
    await english(page)
    await expect(page.getByTestId('mx-targets')).toContainText('Response target per rotation')
    await expect(page.getByTestId('mx-targets').getByTestId('target-row').filter({ hasText: 'Tiendas independientes MX' }).getByTestId('target-text')).toContainText('1 business day')
    await spanish(page)
  })
})

test.describe('E14 · embudos de México', () => {
  test('las etapas son las del documento, y la regla para ganar se elige por embudo y aplica al ganar a mano', async ({ page }) => {
    const sql = testDb()
    const [deal] = await sql<{ id: string }[]>`
      select d.id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.stages s on s.id = d.stage_id join crm.users u on u.id = d.owner_id
       where p.market_code = 'MX' and p.motor = 'b2b' and d.status = 'open' and s.code in ('calificacion', 'propuesta', 'negociacion') and u.full_name = 'Diana Cruz' order by d.id limit 1`
    await sql.end()
    expect(deal, 'el seed deja un negocio B2B abierto de Diana antes de integración').toBeTruthy()

    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=embudos')
    for (const name of ['Prospecto', 'Contactada', 'Comprometida', 'En migración', 'Acuerdo de confidencialidad (NDA)', 'Contrato', 'Certificación']) {
      await expect(page.getByTestId('stage-name').filter({ hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }).first()).toBeVisible()
    }
    const rules = page.getByTestId('mx-win-rules')
    const row = rules.getByTestId('win-rule-row').filter({ hasText: 'Cadenas y distribuidores · MX' })
    await expect(row.getByTestId('win-rule-select')).toHaveValue('transaction')
    // cambiar la regla aplica a los negocios abiertos: pide confirmarlo
    await row.getByTestId('win-rule-select').selectOption('contract_or_transaction')
    await row.getByTestId('win-rule-save').click()
    await expect(row.getByTestId('form-error')).toContainText('negocios abiertos')
    await row.getByTestId('win-rule-confirm').check()
    await row.getByTestId('win-rule-save').click()
    await expect(row.getByTestId('win-rule-text')).toContainText('fecha del contrato firmado')
    await widths(page, 'administración, embudos y regla para ganar')
    try {
      // con esa regla, quien vende puede ganar a mano, y la pantalla le dice que falta la fecha del contrato
      await loginAs(page, 'diana.cruz')
      await page.goto(`/deals/${deal!.id}`)
      await page.getByTestId('deal-win').click()
      await expect(page.locator('dialog[open]').getByTestId('win-needs')).toContainText('Contrato firmado el')
    } finally {
      await loginAs(page, 'nora.salas', { stay: true })
      await page.goto('/admin?tab=embudos')
      const back = page.getByTestId('mx-win-rules').getByTestId('win-rule-row').filter({ hasText: 'Cadenas y distribuidores · MX' })
      await back.getByTestId('win-rule-select').selectOption('transaction')
      await back.getByTestId('win-rule-confirm').check()
      await back.getByTestId('win-rule-save').click()
      await expect(back.getByTestId('win-rule-text')).toContainText('se gana solo')
    }
    // con la regla de siempre, nadie lo marca a mano
    await loginAs(page, 'diana.cruz')
    await page.goto(`/deals/${deal!.id}`)
    await expect(page.getByTestId('deal-win')).toHaveCount(0)
  })
})

test.describe('E16.F2 · la tienda es del gerente de su territorio', () => {
  test('administración elige al gerente de un territorio y una tienda nueva de ese territorio nace con él como dueño', async ({ page }) => {
    const territory = `Puebla ${uniq()}`
    const store = `Abarrotes Puebla ${uniq()}`
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=territorios')
    const mx = page.getByTestId('territories-MX')
    await mx.getByTestId('territory-name').fill(territory)
    await mx.getByTestId('territory-add').click()
    const managers = page.getByTestId('mx-managers')
    const row = managers.getByTestId('manager-row').filter({ hasText: territory })
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('manager-select')).toHaveValue('')
    await row.getByTestId('manager-select').selectOption({ label: 'Lucía Vega' })
    await row.getByTestId('manager-save').click()
    await expect(row.getByTestId('form-ok')).toContainText('Gerente guardado')
    await widths(page, 'administración, gerentes de territorio')

    // supervisión da de alta una tienda en ese territorio: nace con la gerente como dueña
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/comercios')
    await page.getByTestId('new-account').click()
    const dialog = page.locator('dialog[open]')
    await dialog.getByTestId('account-name').fill(store)
    await dialog.getByTestId('account-phone').fill(phone())
    await dialog.getByTestId('account-territory').selectOption({ label: territory })
    await dialog.getByTestId('save-account').click()
    await expect(page.locator('h1')).toHaveText(store)
    const sql = testDb()
    const [acc] = await sql<{ owner: string; action: string | null }[]>`
      select u.full_name as owner, (select e.action from crm.audit_events e where e.object_id = a.id and e.action = 'account.owner_by_territory' limit 1) as action
        from crm.accounts a join crm.users u on u.id = a.owner_id where a.name = ${store}`
    await sql.end()
    expect(acc).toEqual({ owner: 'Lucía Vega', action: 'account.owner_by_territory' })
    await expect(page.getByTestId('ficha')).toContainText('Lucía Vega')

    // se deja el territorio sin gerente: lo que sigue en la corrida no depende de esta regla
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=territorios')
    const again = page.getByTestId('mx-managers').getByTestId('manager-row').filter({ hasText: territory })
    await again.getByTestId('manager-select').selectOption('')
    await again.getByTestId('manager-save').click()
    await expect(again.getByTestId('form-ok')).toBeVisible()
  })
})

test.describe('E17.F4 y E14.F3 · carga desde las hojas', () => {
  test('supervisión pega las visitas de la hoja; quien lidera carga las tiendas migradas con su fecha real', async ({ page }) => {
    const errors = pageErrors(page)
    const sql = testDb()
    const [store] = await sql<{ id: string; name: string; ref: string }[]>`
      select a.id, a.name, al.external_id as ref from crm.accounts a join crm.account_aliases al on al.account_id = a.id and al.system = 's5' and al.valid_to is null
        join crm.users u on u.id = a.owner_id
       where a.market_code = 'MX' and a.segment = 'd2d' and a.kind = 'store' and a.lifecycle = 'onboarding' and u.full_name = 'Marco Peña' order by a.id limit 1`
    expect(store, 'el seed deja una tienda de Marco en alta con Merchant ID').toBeTruthy()
    const visitDay = daysAgo(45)

    await loginAs(page, 'fernando.ibarra')
    await openMenu(page)
    await page.getByTestId('nav-rollout').click()
    await expect(page.locator('h1')).toHaveText('Arranque de México')
    // supervisión carga visitas; las tiendas migradas las carga quien lidera el mercado
    await expect(page.getByTestId('sheet-visits')).toBeVisible()
    await expect(page.getByTestId('sheet-migrated')).toHaveCount(0)
    await page.getByTestId('sheet-visits-label').fill('Hoja de campo, zona centro')
    await page.getByTestId('sheet-visits-rows').fill(`Comercio\tFecha\tQuién visitó\tEstado\tComentarios\n${store!.ref}\t${visitDay}\tJuan Pérez López\tVenta\tQuedó activa\nMID-NO-EXISTE\t${visitDay}\tJuan Pérez López\tVenta\t`)
    await page.getByTestId('sheet-visits-save').click()
    await expect(page.getByTestId('sheet-visits').getByTestId('form-ok')).toContainText('1 visita cargada')
    const load = page.getByTestId('sheet-load').first()
    await expect(load).toContainText('Hoja de campo, zona centro')
    await expect(load.getByTestId('sheet-load-counts')).toContainText('1 cargadas · 0 ya estaban · 1 con problema')
    await expect(load.getByTestId('sheet-problems')).toContainText('Fila 3: No encontramos el comercio "MID-NO-EXISTE"')
    await widths(page, 'arranque, carga desde las hojas')
    // la visita está en el hilo del comercio, con su fecha y quién visitó
    await page.goto(`/comercios/${store!.id}`)
    await expect(page.getByTestId('account-timeline')).toContainText('Cargada de la hoja · Fernando Ibarra')
    await expect(page.getByTestId('account-timeline')).toContainText('Visita · Hubo venta o alta')
    await expect(page.getByTestId('account-timeline')).toContainText('Juan Pérez López')

    // quien lidera el mercado carga la tienda migrada: queda ganada en su fecha real
    await loginAs(page, 'ana.robles')
    await page.goto('/arranque')
    await page.getByTestId('sheet-migrated-rows').fill(`Comercio,Fecha de migración\n${store!.ref},${daysAgo(200)}`)
    await page.getByTestId('sheet-migrated-save').click()
    await expect(page.getByTestId('sheet-migrated').getByTestId('form-ok')).toContainText('1 tienda migrada cargada')
    const deals = await sql<{ status: string; day: string }[]>`
      select status, to_char(won_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') as day from crm.deals where account_id = ${store!.id} and status = 'won'`
    await sql.end()
    expect(deals).toEqual([{ status: 'won', day: daysAgo(200) }])
    // volver a pegar lo mismo no duplica (al guardar, el formulario se limpia: se reintenta hasta que toma lo pegado)
    await expect(async () => {
      await page.getByTestId('sheet-migrated-rows').fill(`Comercio,Fecha de migración\n${store!.ref},${daysAgo(200)}`)
      await page.getByTestId('sheet-migrated-save').click()
      await expect(page.getByTestId('sheet-migrated').getByTestId('form-ok')).toContainText('1 ya estaban', { timeout: 3000 })
    }).toPass({ timeout: 20_000 })
    expect(errors).toEqual([])
    // quien vende no tiene esta pantalla
    await loginAs(page, 'marco.pena')
    expect((await page.goto('/arranque'))!.status()).toBe(404)
  })
})

test.describe('E18 · arranque y reporte de México', () => {
  test('primero quienes lideran: la regla se activa, Ventas no entra salvo las personas clave, y los pasos van en orden', async ({ page }) => {
    const key = `clave.${uniq().toLowerCase()}@contigo.test`
    const other = `campo.${uniq().toLowerCase()}@contigo.test`
    await loginAs(page, 'ana.robles')
    await page.goto('/arranque')
    const access = page.getByTestId('rollout-access')
    await expect(access.getByTestId('rollout-leaders')).toContainText('Fernando Ibarra')
    await expect(access.getByTestId('rollout-team')).toContainText('Marco Peña')
    await access.getByTestId('leaders-first-toggle').click()
    await expect(access.getByTestId('rollout-state')).toContainText('pasos de quienes lideran para abrir al equipo')
    try {
      await access.getByTestId('key-email').fill(key)
      await access.getByTestId('key-add').click()
      await expect(access.getByTestId('key-person')).toHaveText(new RegExp(key.replace(/\./g, '\\.')))
      // un paso del equipo no se marca antes que los de quienes lideran, ni se abre el mercado
      const sessions = page.getByTestId('step-sessions')
      await sessions.getByTestId('step-check').check()
      await sessions.getByTestId('step-save').click()
      await expect(sessions.getByTestId('form-error')).toContainText('Primero quienes lideran')
      await access.getByTestId('open-team').click()
      await expect(access.getByTestId('form-error').first()).toContainText('Primero quienes lideran')
      // un paso de quienes lideran, con el enlace a su material
      const guide = page.getByTestId('step-lead_guide')
      await guide.getByTestId('step-link-input').fill('https://ejemplo.test/guia-de-leads')
      await guide.getByTestId('step-check').check()
      await guide.getByTestId('step-save').click()
      await expect(page.getByTestId('step-lead_guide')).toHaveAttribute('data-done', '1')
      await expect(page.getByTestId('step-lead_guide').getByTestId('step-done-by')).toContainText('Ana Robles')
      await expect(page.getByTestId('step-lead_guide').getByTestId('step-link')).toHaveAttribute('href', 'https://ejemplo.test/guia-de-leads')
      await widths(page, 'arranque del mercado')
      await english(page)
      await expect(page.locator('h1')).toHaveText('México rollout')
      await expect(page.getByTestId('rollout-steps')).toContainText('Lead guide in Spanish')
      await spanish(page)

      // administración: Ventas todavía no entra a México; la persona clave sí
      await loginAs(page, 'nora.salas', { stay: true })
      await page.goto('/admin?tab=personas')
      const grant = async (email: string, name: string) => {
        await page.getByTestId('grant-open').click()
        const dialog = page.locator('dialog[open]')
        await dialog.getByTestId('grant-email').fill(email)
        await dialog.getByTestId('grant-name').fill(name)
        await dialog.getByTestId('grant-role').selectOption('rep')
        await dialog.getByTestId('grant-market').selectOption('MX')
        await dialog.getByTestId('grant-save').click()
        return dialog
      }
      const refused = await grant(other, 'Campo Todavía No')
      await expect(refused.getByTestId('form-error')).toContainText('primero quienes lideran')
      await page.reload()
      await grant(key, 'Persona Clave')
      await expect(page.getByTestId('person-row').filter({ hasText: 'Persona Clave' })).toHaveCount(1)
    } finally {
      await loginAs(page, 'ana.robles')
      await page.goto('/arranque')
      await page.getByTestId('rollout-access').getByTestId('leaders-first-toggle').click()
      await expect(page.getByTestId('rollout-access').getByTestId('rollout-state')).toContainText('Hoy cualquier acceso de Ventas entra')
    }
    // supervisión ve el arranque sin poder cambiarlo
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/arranque')
    await expect(page.getByTestId('rollout-steps')).toBeVisible()
    await expect(page.getByTestId('leaders-first-toggle')).toHaveCount(0)
    await expect(page.getByTestId('step-save')).toHaveCount(0)
  })

  test('el reporte de México: leads capturados y convertidos, negocios por etapa, conteos por mes, tipos de empresa y base de correo', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'ana.robles')
    await openMenu(page)
    await page.getByTestId('nav-market-report').click()
    await expect(page.locator('h1')).toHaveText('Reporte de México')
    await expect(page.getByTestId('monthly-row')).toHaveCount(6)
    const sql = testDb()
    const [n] = await sql<{ leads: number; open: number; consent: number }[]>`
      select (select count(*)::int from crm.leads where market_code = 'MX' and created_at >= date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City') as leads,
             (select count(*)::int from crm.deals where market_code = 'MX' and status = 'open') as open,
             (select count(*)::int from crm.leads where market_code = 'MX' and status = 'disqualified' and email is not null and consent_at is not null) as consent`
    await sql.end()
    // el mes en curso cuenta los leads que llegaron este mes, y las etapas suman los negocios abiertos de hoy
    await expect(page.getByTestId('monthly-row').last().getByTestId('month-leads')).toHaveText(String(n!.leads))
    const stages = page.getByTestId('market-stages')
    expect(await stages.getByTestId('stage-group').count()).toBeGreaterThanOrEqual(2)
    await expect(stages.getByTestId('stage-group').first().getByTestId('stage-row').locator('td:first-child')).toHaveText(['Prospecto', 'Contactada', 'Comprometida', 'En migración'])
    await expect(page.getByTestId('types-table')).toContainText('Distribuidor')
    await expect(page.getByTestId('types-table')).toContainText('Cadena')
    await expect(page.getByTestId('market-sources')).toContainText('Campaña web · F1')
    await expect(page.getByTestId('market-sources')).toContainText('mx-web-cadenas')
    await expect(page.getByTestId('dead-consent')).toHaveText(String(n!.consent))
    await page.getByRole('link', { name: 'Últimos 12 meses' }).click()
    await expect(page.getByTestId('monthly-row')).toHaveCount(12)
    await widths(page, 'reporte de México')

    // las descargas: conteos por mes y base de correo (solo quien aceptó recibir correos)
    // sin motivo no hay archivo: la descarga se pide desde el formulario "¿Para qué necesitas el archivo?"
    expect((await page.request.get('/reportes/mercado/export?mercado=MX&meses=6&que=mensual')).status()).toBe(422)
    await page.getByTestId('export-monthly').click()
    await expect(page.getByTestId('export-monthly-reason')).toBeVisible()
    const monthly = await page.request.get('/reportes/mercado/export?mercado=MX&meses=6&que=mensual&motivo=Revisi%C3%B3n+de+prueba+del+reporte')
    expect(monthly.status()).toBe(200)
    expect(monthly.headers()['x-contigo-rows']).toBe('6')
    expect(await monthly.text()).toContain('Leads capturados')
    const dead = await page.request.get('/reportes/mercado/export?mercado=MX&que=descartados&motivo=Campa%C3%B1a+de+correo+de+prueba')
    expect(dead.status()).toBe(200)
    expect(dead.headers()['x-contigo-rows']).toBe(String(n!.consent))
    if (n!.consent > 0) expect(await dead.text()).toContain('@ejemplo.test')

    await english(page)
    await expect(page.locator('h1')).toHaveText('México report')
    await expect(page.getByTestId('market-monthly')).toContainText('Leads captured')
    await expect(page.getByTestId('market-stages').getByTestId('stage-row').first()).toContainText('Prospect')
    await spanish(page)
    expect(errors).toEqual([])

    // supervisión ve el reporte de su equipo y no descarga la base de correo; quien vende no tiene el reporte
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/mercado')
    await expect(page.getByTestId('dead-no-export')).toBeVisible()
    expect((await page.request.get('/reportes/mercado/export?mercado=MX&que=descartados&motivo=Campa%C3%B1a+de+correo+de+prueba')).status()).toBe(404)
    await loginAs(page, 'marco.pena')
    expect((await page.goto('/reportes/mercado'))!.status()).toBe(404)
    // quien lidera US ve su mercado, no México
    await loginAs(page, 'robert.hale')
    await page.goto('/reportes/mercado?mercado=MX')
    await expect(page.locator('h1')).toHaveText('United States report')
  })
})
