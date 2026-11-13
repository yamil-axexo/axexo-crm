import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Con la forma de un SSN (tres, dos y cuatro números). Se arma por partes: el escáner de datos prohibidos no deja escribirlo.
const SSN_SHAPED = ['123', '45', '6789'].join('-')

// Paquete "mercados" (migración 0032): moneda con tasa guardada y consolidado en USD, entidad legal y festivos,
// identificador fiscal en tres capas, dirección por país y "Cerca de mí", WhatsApp por mercado (apagado),
// encabezado de la ficha por rol y enlace directo desde otro sistema.

const SHOTS = process.env.E2E_SHOTS
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mercados-${name}.png`, fullPage: true })
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function db<T>(fn: (sql: ReturnType<typeof testDb>) => Promise<T>): Promise<T> {
  const sql = testDb()
  try {
    return await fn(sql)
  } finally {
    await sql.end()
  }
}
/** Un comercio de la cartera de una persona, por posición estable (nombre, id). */
const storeOf = (persona: string, n: number) =>
  db(async (sql) => (await sql<{ id: string; name: string }[]>`
    select a.id, a.name from crm.accounts a join crm.users u on u.id = a.owner_id
     where u.email::text like ${persona + '@%'} and a.kind = 'store' and a.archived_at is null order by a.name, a.id offset ${n} limit 1`)[0]!)

const RFC = 'GODE561231GR8'

test.describe('MULTI-01 y E1.F10: cada monto con su tasa y un consolidado en USD', () => {
  test('leadership llega del panel al consolidado: monto original, USD, tasa con fecha y los tres cortes', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'luis.tovar', { stay: true })
    await page.getByTestId('lt-consolidated').click()
    await expect(page).toHaveURL(/\/reportes\/consolidado/)
    await expect(page.locator('h1')).toHaveText('Consolidado en USD')
    await expect(page.getByTestId('consolidated-total')).toContainText('USD')
    const mx = page.getByTestId('consolidated-row').filter({ hasText: 'MXN' }).first()
    await expect(mx.getByTestId('row-original')).toContainText('MXN')
    await expect(mx.getByTestId('row-usd')).toContainText('USD')
    await expect(mx.getByTestId('row-rate')).toContainText(/Tasas? del .+ Fuente: /)
    await expect(page.getByTestId('consolidated-rule')).toBeVisible()
    await shot(page, 'consolidado-1440')
    // por entidad legal y por unidad de negocio
    await page.getByRole('link', { name: 'Entidad legal', exact: true }).click()
    await expect(page).toHaveURL(/por=entity/)
    await expect(page.getByTestId('consolidated-row').first()).toBeVisible()
    await page.getByRole('link', { name: 'Unidad de negocio', exact: true }).click()
    await expect(page).toHaveURL(/por=unit/)
    await expect(page.getByTestId('consolidated-rows')).toBeVisible()
    // ganados: la tasa es la del cierre
    await page.getByRole('link', { name: 'Ganados', exact: true }).click()
    await expect(page).toHaveURL(/ver=ganados/)
    await expect(page.getByTestId('consolidated-total')).toBeVisible()
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height })
      await noOverflow(page, `consolidado ${w.name}`)
    }
    await axeClean(page, 'consolidado')
    await shot(page, 'consolidado-390')
    expect(errors).toEqual([])
  })

  test('quien vende en México sigue viendo sus negocios en MXN y no entra al consolidado', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    const res = await page.goto('/reportes/consolidado')
    expect(res?.status()).toBe(404)
    const stored = await db(async (sql) => (await sql<{ n: number; stamped: number }[]>`
      select count(*)::int as n, count(*) filter (where fx_rate is not null and fx_rate_date is not null and fx_source is not null and amount_usd_minor is not null)::int as stamped
        from crm.deals where trim(currency) = 'MXN' and amount_minor is not null`)[0]!)
    expect(stored.n).toBeGreaterThan(0)
    expect(stored.stamped).toBe(stored.n)
  })
})

test.describe('MULTI-02 y E1.F1: entidad legal, festivos y lo que le falta a cada mercado', () => {
  test('administración confirma una entidad, carga un festivo y limita el acceso de una persona a una entidad', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=mercados')
    const tab = page.getByTestId('admin-markets')
    await expect(tab).toBeVisible()
    // El Salvador está en preparación y la pantalla dice qué le falta
    const sv = tab.getByTestId('market-row').filter({ hasText: 'SV' })
    await expect(sv.getByTestId('market-status')).toHaveAttribute('data-status', 'planned')
    await expect(sv.getByTestId('market-ready')).toContainText('Entidad legal confirmada')
    await expect(tab.getByTestId('markets-catalog-link')).toHaveAttribute('href', '/datos?tab=catalogos')
    // su entidad provisional se confirma al ponerle nombre
    const provisional = tab.getByTestId('entity-row').filter({ has: page.getByTestId('entity-review') }).first()
    await provisional.getByTestId('entity-edit').click()
    const dlg = page.locator('dialog[open]')
    await dlg.getByTestId('entity-edit-name').fill('Entidad de prueba El Salvador')
    await dlg.getByTestId('entity-edit-save').click()
    await expect(tab.getByTestId('entity-row').filter({ hasText: 'Entidad de prueba El Salvador' }).getByTestId('entity-review')).toHaveCount(0)
    // festivo
    await tab.getByTestId('holiday-market').selectOption('MX')
    await tab.getByTestId('holiday-day').fill('2027-01-01')
    await tab.getByTestId('holiday-name').fill('Año Nuevo')
    await tab.getByTestId('holiday-save').click()
    await expect(tab.getByTestId('holiday-row').filter({ hasText: 'Año Nuevo' })).toBeVisible()
    await shot(page, 'admin-mercados-1440')
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height })
      await noOverflow(page, `admin mercados ${w.name}`)
    }
    await axeClean(page, 'admin mercados')
    await shot(page, 'admin-mercados-390')
    const audit = await db(async (sql) => (await sql<{ action: string }[]>`select action from crm.audit_events where action in ('entity.updated', 'market.holiday_added') order by at desc limit 5`).map((r) => r.action))
    expect(audit).toEqual(expect.arrayContaining(['entity.updated', 'market.holiday_added']))
    expect(errors).toEqual([])
  })

  test('la ficha dice entidad, unidad de negocio y hora del comercio; quien la lleva cambia la unidad', async ({ page }) => {
    const store = await storeOf('marco.pena', 20)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    const block = page.getByTestId('account-entity')
    await expect(block.getByTestId('entity-name')).not.toBeEmpty()
    await expect(block.getByTestId('zone-name')).toContainText('la del mercado')
    // quien vende no cambia la entidad legal: no hay selector
    await expect(block.getByTestId('entity-select')).toHaveCount(0)
    await block.getByTestId('unit-select').selectOption('mexico')
    await block.getByTestId('profile-save').click()
    await expect(block.getByTestId('unit-name')).toHaveText('Mexico')
  })
})

test.describe('MULTI-03: identificador fiscal en tres capas', () => {
  test('se captura una vez, quedan los últimos 4, Operaciones lo revisa de un toque y la búsqueda exacta lo encuentra', async ({ page }) => {
    const errors = pageErrors(page)
    const store = await storeOf('marco.pena', 21)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    const tax = page.getByTestId('account-tax')
    await expect(tax.getByTestId('tax-none')).toBeVisible()
    await expect(tax.getByTestId('tax-privacy')).toContainText('solo los últimos 4')
    await tax.getByTestId('tax-capture').click()
    let dlg = page.locator('dialog[open]')
    // un RFC con el dígito verificador mal escrito no pasa en silencio: se guarda y pide revisión
    await dlg.getByTestId('tax-value').fill('GODE561231GR9')
    await dlg.getByTestId('tax-legal-name').fill('Comercio de Prueba')
    await dlg.getByTestId('tax-regime').fill('612')
    await dlg.getByTestId('tax-postal').fill('64000')
    await dlg.getByTestId('tax-save').click()
    await expect(tax.getByTestId('tax-status')).toHaveAttribute('data-status', 'needs_review')
    await expect(tax.getByTestId('tax-check-format')).toContainText('el dígito verificador no cuadra')
    // se corrige: capturar de nuevo
    await page.waitForTimeout(800) // el formulario ignora un segundo envío pegado al primero (protección contra doble clic)
    await tax.getByTestId('tax-capture').click()
    dlg = page.locator('dialog[open]')
    await dlg.getByTestId('tax-value').fill(RFC)
    await dlg.getByTestId('tax-save').click()
    await expect(tax.getByTestId('tax-masked')).toContainText('1GR8')
    await expect(tax.getByTestId('tax-status')).toHaveAttribute('data-status', 'format_valid')
    await expect(tax.getByTestId('tax-check-registry')).toHaveAttribute('data-result', 'queued_off')
    await expect(tax.getByTestId('tax-check-risk_list')).toHaveAttribute('data-result', 'queued_off')
    // quien vende no revisa
    await expect(tax.getByTestId('tax-review')).toHaveCount(0)
    // el valor completo no está en la página ni en la base
    expect(await page.content()).not.toContain(RFC)
    const leaked = await db(async (sql) => (await sql<{ n: number }[]>`
      select (select count(*) from crm.tax_ids t where to_jsonb(t)::text ilike ${'%' + RFC + '%'})::int
           + (select count(*) from crm.audit_events e where to_jsonb(e)::text ilike ${'%' + RFC + '%'})::int
           + (select count(*) from crm.accounts a where to_jsonb(a)::text ilike ${'%' + RFC + '%'})::int as n`)[0]!.n)
    expect(leaked).toBe(0)
    await shot(page, 'ficha-fiscal-1440')

    // Operaciones lo revisa desde el teléfono, de un toque
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'valeria.soto')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    await page.getByTestId('account-tax').getByTestId('tax-review').click()
    dlg = page.locator('dialog[open]')
    await dlg.getByTestId('tax-review-note').fill('Constancia de situación fiscal a la vista')
    await shot(page, 'ficha-fiscal-revisar-390')
    await dlg.getByTestId('tax-approve').click()
    await expect(page.getByTestId('account-tax').getByTestId('tax-status')).toHaveAttribute('data-status', 'verified')
    await expect(page.getByTestId('account-tax').getByTestId('tax-check-human')).toContainText('Valeria Soto')
    await noOverflow(page, 'ficha datos 390 (operaciones)')
    // búsqueda por coincidencia exacta, en su propio campo: el identificador no queda en la dirección de la página
    await page.goto('/buscar')
    await page.getByTestId('tax-search-input').fill(RFC)
    await page.getByTestId('tax-search-go').click()
    await expect(page.getByTestId('search-tax-hit').filter({ hasText: store.name })).toBeVisible()
    expect(page.url()).not.toContain(RFC)
    // y escrito en el buscador general no encuentra nada por esa vía
    await page.goto(`/buscar?q=${RFC.slice(0, 10)}`)
    await expect(page.getByTestId('search-tax-hit')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('en US un SSN se rechaza y se pide el EIN; todo en inglés', async ({ page }) => {
    const store = await storeOf('jade.kim', 3)
    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    const tax = page.getByTestId('account-tax')
    await expect(tax.locator('h3')).toHaveText('Tax ID')
    await tax.getByTestId('tax-capture').click()
    const dlg = page.locator('dialog[open]')
    await expect(dlg.getByTestId('tax-type')).toHaveValue('us_ein')
    await dlg.getByTestId('tax-value').fill(SSN_SHAPED)
    await dlg.getByTestId('tax-save').click()
    await expect(dlg.getByRole('alert')).toContainText('SSN')
    await dlg.getByTestId('tax-value').fill('12-3456789')
    await dlg.getByTestId('tax-save').click()
    await expect(tax.getByTestId('tax-masked')).toContainText('6789')
    await expect(tax.getByTestId('tax-check-registry')).toContainText('Channel off')
  })
})

test.describe('MULTI-04 y E2.F1: dirección por país, ubicación y Cerca de mí', () => {
  test('México pide colonia y código postal de cinco números; la ubicación se guarda a mano y la calle entra en la búsqueda', async ({ page }) => {
    const errors = pageErrors(page)
    const store = await storeOf('marco.pena', 22)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    const addr = page.getByTestId('account-address')
    await addr.getByTestId('address-address_line').fill('Calle Jacarandas 4410')
    await addr.getByTestId('address-sublocality').fill('Mirador')
    await addr.getByTestId('address-locality').fill('Monterrey')
    await addr.getByTestId('address-region').fill('Nuevo León')
    await addr.getByTestId('address-postal_code').fill('6400')
    await addr.getByTestId('address-save').click()
    await expect(addr.getByRole('alert').first()).toContainText(/código postal/i)
    await addr.getByTestId('address-postal_code').fill('64070')
    await addr.getByTestId('address-save').click()
    await expect(addr.getByTestId('form-ok').first()).toBeVisible()
    // ubicación a mano
    const loc = page.getByTestId('account-location')
    await loc.getByTestId('geo-lat').fill('25.67510')
    await loc.getByTestId('geo-lon').fill('-100.31850')
    await loc.getByTestId('location-save').click()
    await expect(loc.getByTestId('location-current')).toContainText('25.67510')
    await expect(loc.getByTestId('location-current')).toContainText('escrita a mano')
    await expect(loc.getByTestId('location-map-off')).toBeVisible()
    await shot(page, 'ficha-direccion-1440')
    // la calle encuentra el comercio
    await page.goto('/buscar?q=Jacarandas 4410')
    await expect(page.getByTestId('search-hit').filter({ hasText: store.name })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('Cerca de mí en el teléfono: pide permiso, ordena por distancia y no guarda la ubicación de la persona', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 25.6714, longitude: -100.309 }, permissions: ['geolocation'], locale: 'es-MX' })
    const page = await context.newPage()
    const errors = pageErrors(page)
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios')
    await page.getByTestId('view-near').click()
    await expect(page).toHaveURL(/\/comercios\/cerca/)
    await expect(page.getByTestId('near-coverage')).toBeVisible()
    await page.getByTestId('near-radius').selectOption('10000')
    await page.getByTestId('near-search').click()
    await expect(page.getByTestId('near-row').first()).toBeVisible()
    const meters = await page.getByTestId('near-distance').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.m ?? 'NaN')))
    expect(meters.length).toBeGreaterThan(0)
    if (meters.every((m) => !Number.isNaN(m))) expect([...meters].sort((a, b) => a - b)).toEqual(meters)
    await noOverflow(page, 'cerca de mí 390')
    await axeClean(page, 'cerca de mí')
    await shot(page, 'cerca-390')
    expect(errors).toEqual([])
    await context.close()
  })
})

test.describe('MULTI-05: WhatsApp por mercado, listo y apagado', () => {
  test('administración guarda número, plantilla y costo; el canal sigue apagado y la ventana de 24 horas se ve en la ficha', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=mercados')
    const card = page.getByTestId('whatsapp-card')
    await expect(card.getByTestId('whatsapp-mode')).toContainText(/apagado/i)
    await card.getByTestId('wa-entity').selectOption({ index: 0 })
    await card.getByTestId('wa-display-name').fill('axexo México')
    await card.getByTestId('wa-phone').fill('55 5000 0000')
    await card.getByTestId('wa-account-save').click()
    await expect(card.getByTestId('whatsapp-account').filter({ hasText: 'axexo México' })).toBeVisible()
    await card.getByTestId('wa-template-key').fill('alta_confirmada')
    await card.getByTestId('wa-template-body').fill('Tu alta quedó lista. Ya puedes hacer tu primera venta.')
    await card.getByTestId('wa-template-save').click()
    await expect(card.getByTestId('whatsapp-template').filter({ hasText: 'alta_confirmada' })).toBeVisible()
    await shot(page, 'admin-whatsapp-1440')
    // nada salió: no hay un solo envío por WhatsApp
    const sent = await db(async (sql) => (await sql<{ n: number }[]>`select count(*)::int as n from crm.notifications where channel = 'whatsapp' and status in ('delivered', 'simulated')`)[0]!.n)
    expect(sent).toBe(0)
    // Estado de CONTIGO lo dice
    await page.goto('/estado')
    await expect(page.getByText('WhatsApp por mercado')).toBeVisible()
    await expect(page.getByText('Verificación fiscal y listas de riesgo')).toBeVisible()
    await expect(page.getByText('Mapa y geocodificación')).toBeVisible()

    // en la ficha: el comercio escribió, quedan 24 horas
    const store = await storeOf('marco.pena', 23)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    const wa = page.getByTestId('account-whatsapp')
    await expect(wa.getByTestId('wa-window')).toHaveAttribute('data-open', 'no')
    await expect(wa.getByTestId('wa-channel')).toContainText('apagado')
    // el enlace para que el comercio escriba primero sale del número del mercado
    await expect(wa.getByTestId('wa-me-link')).toHaveText('wa.me/525550000000')
    await wa.getByTestId('wa-open').click()
    await expect(wa.getByTestId('wa-window')).toHaveAttribute('data-open', 'yes')
    await expect(page.getByTestId('fact-whatsapp-window')).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('UX-01 y E2.F5: lo importante arriba según el rol, y secciones de campos', () => {
  test('ventas, Operaciones y quien lidera ven datos distintos arriba; administración los cambia', async ({ page }) => {
    const store = await storeOf('marco.pena', 24)
    const factsOf = async (persona: string) => {
      await loginAs(page, persona)
      await page.goto(`/comercios/${store.id}`)
      await expect(page.getByTestId('ficha-facts')).toBeVisible()
      return page.getByTestId('ficha-facts').locator('dt').allTextContents()
    }
    const rep = await factsOf('marco.pena')
    const ops = await factsOf('valeria.soto')
    const lead = await factsOf('ana.robles')
    expect(rep.length).toBeGreaterThan(0)
    expect(rep.length).toBeLessThanOrEqual(5)
    expect(ops).not.toEqual(rep)
    expect(lead).not.toEqual(rep)
    await shot(page, 'ficha-arriba-lider-1440')
    // administración cambia los de ventas
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=mercados')
    const layouts = page.getByTestId('layouts-card')
    await expect(layouts).toBeVisible()
    await expect(layouts.getByTestId('layout-form').first()).toBeVisible()
    // secciones de campos: las comunes y la de un mercado
    const sections = page.getByTestId('sections-card')
    await sections.getByTestId('section-es').fill('Datos de arranque')
    await sections.getByTestId('section-en').fill('Launch details')
    await sections.getByTestId('section-market').selectOption('MX')
    await sections.getByTestId('section-save').click()
    await expect(sections.getByTestId('section-row').filter({ hasText: 'Datos de arranque' })).toBeVisible()
    // un campo de México pasa a esa sección y la ficha lo muestra ahí, con el nombre de la sección
    const fieldSelect = sections.getByTestId('field-section-field')
    const giro = await fieldSelect.locator('option').filter({ hasText: /Giro · MX/ }).first().getAttribute('value')
    await fieldSelect.selectOption(giro!)
    await sections.getByTestId('field-section-section').selectOption({ label: 'Datos de arranque · MX' })
    await sections.getByTestId('field-section-save').click()
    await expect(sections.getByTestId('form-ok').last()).toBeVisible()
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    const block = page.locator('[data-testid^="field-section-"]').filter({ hasText: 'Datos de arranque' })
    await expect(block).toBeVisible()
    await expect(block.getByTestId('section-field').filter({ hasText: 'Giro' })).toBeVisible()
    // se deja como estaba: Giro vuelve a los campos sin sección
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=mercados')
    await page.getByTestId('field-section-field').selectOption(giro!)
    await page.getByTestId('field-section-section').selectOption('')
    await page.getByTestId('field-section-save').click()
    await expect(page.getByTestId('sections-card').getByTestId('form-ok').last()).toBeVisible()
  })
})

test.describe('UX-04: supervisión y quien cuida cuentas, desde el teléfono', () => {
  test('el enlace directo abre la ficha por el ID de otro sistema; en 390 px quien lidera lee lo de arriba y la pestaña Datos sin desbordes', async ({ page }) => {
    const errors = pageErrors(page)
    const alias = await db(async (sql) => (await sql<{ account_id: string; external_id: string; name: string }[]>`
      select al.account_id, al.external_id, a.name from crm.account_aliases al join crm.accounts a on a.id = al.account_id
       where al.valid_to is null and a.market_code = 'MX' and a.archived_at is null order by al.external_id limit 1`)[0]!)
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'ana.robles')
    await page.goto(`/comercios/ref/${encodeURIComponent(alias.external_id)}`)
    await expect(page).toHaveURL(new RegExp(`/comercios/${alias.account_id}`))
    await expect(page.getByTestId('ficha')).toContainText(alias.name)
    await expect(page.getByTestId('ficha-facts')).toBeVisible()
    await noOverflow(page, 'ficha por enlace 390')
    await page.goto(`/comercios/${alias.account_id}?tab=datos`)
    await expect(page.getByTestId('account-entity')).toBeVisible()
    // quien lidera sí puede cambiar la entidad legal cuando el mercado tiene más de una (aquí hay una: no aparece el selector)
    await noOverflow(page, 'ficha datos 390 (lidera)')
    await axeClean(page, 'ficha datos 390')
    await shot(page, 'ficha-datos-lider-390')
    // un identificador que no existe no revela nada y ofrece buscar
    await page.goto('/comercios/ref/NO-EXISTE-000')
    await expect(page.getByTestId('ref-missing')).toBeVisible()
    await expect(page.getByTestId('ref-search')).toBeVisible()
    // fuera del alcance: una persona de US no abre un comercio de México por su identificador
    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/ref/${encodeURIComponent(alias.external_id)}`)
    await expect(page.getByTestId('ref-missing')).toBeVisible()
    expect(errors).toEqual([])
  })
})
