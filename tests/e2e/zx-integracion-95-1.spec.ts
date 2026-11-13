import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Ola 1 de los 95, integración vista en pantalla: un lead de campaña de México que cruza cinco paquetes, exportaciones
// con motivo que quedan en una sola bitácora, Administración en secciones con las llaves en un solo lugar, y la tienda
// con un solo portafolio de proveedores y el pedido impreso con sus datos de envío.
const sql = testDb()
const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase()
const phone = () => `55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const at = async (page: Page, name: 'desktop' | 'movil') => page.setViewportSize(WIDTHS.find((w) => w.name === name)!)
const setLocale = async (page: Page, locale: 'es' | 'en') => {
  await page.context().addCookies([{ name: 'contigo_locale', value: locale, url: new URL('/', page.url()).href }])
  await page.reload()
}

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function bothWidths(page: Page, label: string) {
  await clean(page, `${label}, desktop`)
  await at(page, 'movil')
  await clean(page, `${label}, móvil`)
  await at(page, 'desktop')
}

test.describe.configure({ mode: 'serial' })

test.describe('integración de la ola 1 de los 95', () => {
  const business = `Cadena Noventa y Cinco ${tag()}`
  const started = new Date()

  // Lo que este recorrido enciende se apaga al final, para que las pruebas que siguen encuentren la base como la esperan.
  test.afterAll(async () => {
    await sql`update crm.lead_escalation set is_active = false`
    await sql`update crm.leads set status = 'contacted', first_touch_at = now() where business_name = ${business}`
    await sql`update crm.leads set escalation_level = 0, escalated_at = null where escalation_level > 0`
    await sql`update crm.notices set seen_at = now() where seen_at is null and created_at >= ${started}`
    await sql.end()
  })

  test('un lead de campaña de México: entra por el formulario, rota, avisa por el servicio único y escala a supervisión', async ({ page }) => {
    const errors = pageErrors(page)
    // mx: el formulario de cadenas y distribuidores (campaña F2), protegido por eventos y API
    await page.goto('/f/contacto-mx?utm_source=meta&utm_campaign=noventa-y-cinco')
    await page.locator('input[name=business_name]').fill(business)
    await page.getByTestId('public-company-type').selectOption({ label: 'Cadena' })
    await page.locator('input[name=contact_name]').fill('Contacto De Integración')
    await page.locator('input[name=phone]').fill(phone())
    await page.getByTestId('public-submit').click()
    await expect(page.getByTestId('public-form').getByTestId('form-ok')).toBeVisible()

    const lead = (await sql<{ id: string; owner_id: string; source: string }[]>`select id, owner_id, source from crm.leads where business_name = ${business}`)[0]!
    expect(lead.source).toBe('web_campaign')
    const diana = await uid('diana.cruz')
    expect([diana, await uid('ivan.rios')]).toContain(lead.owner_id)
    const ownerKey = lead.owner_id === diana ? 'diana.cruz' : 'ivan.rios'
    const ownerName = lead.owner_id === diana ? 'Diana Cruz' : 'Iván Ríos'

    // avisos: a quien le tocó en el turno le llega a la campana y al centro de avisos, sin que nadie más se lo diga
    await loginAs(page, ownerKey)
    await page.goto('/avisos')
    const arrived = page.getByTestId('notice-row').filter({ hasText: business })
    await expect(arrived).toContainText(`Te llegó un lead: ${business}`)
    await bothWidths(page, 'centro de avisos con el lead de campaña')
    await arrived.getByTestId('notice-open').click()
    await expect(page).toHaveURL(new RegExp(`/leads/${lead.id}`))
    // mx y eventos y API: origen de campaña y texto marcado como llegado de fuera
    await expect(page.getByTestId('lead-source-text')).toContainText('Campaña web')
    await expect(page.getByTestId('lead-funnel')).toContainText('F2')
    await expect(page.getByTestId('untrusted-tag')).toContainText('formulario web')
    await bothWidths(page, 'lead de campaña')

    // automatizaciones: vence la meta sin intento y el escalamiento está encendido en México; la tarea programada corre desde Administración
    await sql`update crm.leads set sla_due_at = now() - interval '10 minutes' where id = ${lead.id}`
    await sql`update crm.lead_escalation set is_active = true, level2_hours = 4 where market_code = 'MX'`
    await loginAs(page, 'nora.salas', { stay: true })
    for (const key of ['avisos.lead_goal', 'automatizaciones.escalamiento']) {
      await page.goto('/admin/automatizaciones?v=tareas')
      await page.locator(`[data-testid="job-row"][data-key="${key}"]`).getByTestId('job-run-btn').click()
      await expect(page.getByTestId('admin-notice')).toContainText('Tarea corrida')
    }

    // Paula supervisa el equipo B2B: el aviso le llega a Hoy por el servicio de avisos, con enlace al lead. No es una tarea.
    await loginAs(page, 'paula.mendez')
    await page.goto('/hoy')
    const escalated = page.getByTestId('hoy-notice').filter({ hasText: business })
    await expect(escalated).toContainText(`Lead sin primer contacto: ${business}`)
    await expect(escalated).toContainText(`Lo lleva ${ownerName}.`)
    await expect(escalated.getByTestId('hoy-notice-open')).toHaveAttribute('href', `/leads/${lead.id}`)
    expect((await sql`select 1 from crm.activities where lead_id = ${lead.id} and source = 'rule'`).length).toBe(0)
    await clean(page, 'Hoy con el aviso de escalamiento')
    await setLocale(page, 'en')
    await expect(page.getByTestId('hoy-notices')).toContainText('You were notified')
    await setLocale(page, 'es')

    // y quien lo lleva tiene los dos avisos: le llegó y se le venció la meta
    const kinds = await sql<{ kind: string }[]>`select kind from crm.notices where lead_id = ${lead.id} and user_id = ${lead.owner_id} order by kind`
    expect(kinds.map((k) => k.kind)).toEqual(['lead_arrived', 'lead_goal_missed'])
    expect(errors).toEqual([])
  })

  test('el reporte del mercado se descarga con motivo y queda en la bitácora de exportaciones con nombre legible', async ({ page }) => {
    const errors = pageErrors(page)
    const reason = `Cierre mensual de prueba ${tag()}`
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/mercado')
    await page.getByTestId('export-monthly').click()
    // sin motivo el navegador no deja enviar; con motivo, baja el archivo
    await expect(page.getByTestId('export-monthly-reason')).toHaveAttribute('required', '')
    await page.getByTestId('export-monthly-reason').fill(reason)
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-monthly-go').click()])
    expect(download.suggestedFilename()).toMatch(/^contigo-mx-mensual-desde-\d{4}-\d{2}-\d{2}\.csv$/)
    await at(page, 'movil')
    await page.getByTestId('export-stages').click()
    await expect(page.getByTestId('export-stages-reason')).toBeVisible()
    await clean(page, 'reporte del mercado con el motivo abierto, móvil')
    await at(page, 'desktop')

    // administración lo ve junto a las demás exportaciones: quién, qué y para qué
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/integraciones?tab=datos')
    const row = page.getByTestId('export-row').filter({ hasText: reason })
    await expect(row).toContainText('Ana Robles')
    await expect(row).toContainText('Reporte del mercado: meses · MX')
    await expect(page.getByTestId('export-rules')).toContainText('reporte del mercado con su base de correo')
    await bothWidths(page, 'bitácora de exportaciones')
    await setLocale(page, 'en')
    await expect(page.getByTestId('export-row').filter({ hasText: reason })).toContainText('Market report: months')
    await setLocale(page, 'es')
    expect(errors).toEqual([])
  })

  test('Administración en secciones, en dos anchos y dos idiomas; las llaves de API viven en un solo lugar', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await expect(page).toHaveURL(/\/admin$/)
    const nav = page.getByTestId('admin-sections')
    for (const g of ['personas', 'ventas', 'avisos', 'integraciones', 'mercados', 'control']) await expect(nav.getByTestId(`admin-group-${g}`)).toBeVisible()
    const pills = await page.locator('nav[aria-label="Secciones"] a').allInnerTexts()
    expect(new Set(pills).size, pills.join(' | ')).toBe(pills.length)
    expect(pills).toHaveLength(16)
    await expect(nav.getByTestId('admin-group-integraciones')).toContainText('Sales App y ventas')
    await expect(nav.getByTestId('admin-group-integraciones').getByRole('link')).toHaveText(['Sales App y ventas', 'Eventos, API y datos', 'Pipedrive', 'Calidad de datos'])
    await expect(page.getByTestId('pill-personas')).toHaveAttribute('aria-current', 'page')
    await bothWidths(page, 'administración en secciones')
    // en teléfono cada entrada se puede tocar: 44 px de alto
    await at(page, 'movil')
    for (const key of ['personas', 'eventos-api', 'estado']) expect((await page.getByTestId(`pill-${key}`).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await at(page, 'desktop')
    await setLocale(page, 'en')
    await expect(page.getByTestId('admin-group-integraciones')).toContainText('Integrations and data')
    await expect(page.getByTestId('pill-integraciones')).toHaveText('Sales App and sales data')
    await setLocale(page, 'es')

    // Quien lidera un mercado solo ve los grupos donde tiene algo
    await loginAs(page, 'ana.robles')
    await page.goto('/admin')
    await expect(page.getByTestId('admin-group-ventas')).toBeVisible()
    await expect(page.getByTestId('admin-group-control')).toBeVisible()
    for (const g of ['personas', 'integraciones', 'mercados']) await expect(page.getByTestId(`admin-group-${g}`)).toHaveCount(0)
    await clean(page, 'administración de quien lidera un mercado')

    // La pestaña de la Sales App ya no tiene tarjeta de llaves: manda a la única pantalla de llaves
    await loginAs(page, 'nora.salas', { stay: true })
    await page.getByTestId('pill-integraciones').click()
    await expect(page.getByTestId('admin-integrations')).toBeVisible()
    await expect(page.getByTestId('api-clients')).toHaveCount(0)
    await page.getByTestId('integrations-more-link').click()
    await expect(page).toHaveURL(/\/admin\/integraciones$/)
    await page.goto('/admin/integraciones?tab=api')
    await expect(page.getByTestId('api-keys')).toBeVisible()
    await expect(page.getByTestId('key-scope-forms:write')).toBeVisible()
    await expect(page.getByTestId('key-scope-accounts:read')).toBeVisible()
    // Estado de CONTIGO: cada adaptador externo, apagado, con lo que falta para encenderlo
    await page.getByTestId('integrations-back').click()
    await page.getByTestId('pill-estado').click()
    await expect(page).toHaveURL(/\/estado$/)
    const main = page.locator('main')
    for (const name of ['Avisos por Correo', 'Avisos por Slack', 'Avisos por WhatsApp', 'Eventos para otros sistemas', 'Verificación anti-bot de formularios', 'Herramienta de rutas', 'Archivo de la foto diaria para Data y Reportería', 'Tareas programadas'])
      await expect(main).toContainText(name)
    await bothWidths(page, 'estado de CONTIGO con los adaptadores')
    expect(errors).toEqual([])
  })

  test('la tienda tiene un solo portafolio de proveedores y el pedido impreso lleva envío y descuento', async ({ page }) => {
    const errors = pageErrors(page)
    const jade = await uid('jade.kim')
    // datos y us-embudo: Operaciones marca "enviado" al proveedor en un negocio; la tienda lo muestra en Productos y proveedores
    const deal = (await sql<{ id: string; account_id: string }[]>`
      select d.id, d.account_id from crm.deals d where d.pipeline_id = ${await uid('p-us-dealer')} and d.owner_id = ${jade} and d.status = 'open'
         and not exists (select 1 from crm.account_products p where p.account_id = d.account_id) order by d.created_at limit 1`)[0]!
    const north = (await sql<{ id: string }[]>`select id from crm.ops_catalog where market_code = 'US' and kind = 'provider' and code = 'carrier_north'`)[0]!.id
    await sql`insert into crm.deal_ops_checks (deal_id, market_code, catalog_id, status, updated_by) values (${deal.id}, 'US', ${north}, 'sent', ${await uid('tom.reyes')})
              on conflict (deal_id, catalog_id) do update set status = 'sent'`
    await loginAs(page, 'jade.kim')
    await page.goto(`/comercios/${deal.account_id}?tab=datos`)
    const item = page.getByTestId('account-products').getByTestId('product-item')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('North carrier')
    await expect(item.getByTestId('product-state')).toHaveText('Sent to the provider')
    await expect(item.getByRole('link', { name: 'see the deal' })).toHaveAttribute('href', `/deals/${deal.id}`)
    await expect(page.getByTestId('store-providers')).toHaveCount(0)
    await bothWidths(page, 'tienda con su portafolio de proveedores')

    // avisos y us-embudo: el pedido listo para imprimir trae los datos de envío y el descuento de la línea
    const order = (await sql<{ id: string }[]>`
      select d.id from crm.deals d join crm.deal_orders o on o.deal_id = d.id where d.owner_id = ${jade} and exists (select 1 from crm.deal_items i where i.deal_id = d.id) order by d.created_at limit 1`)[0]!
    await sql`update crm.deal_orders set po_number = 'PO-9501', ship_to = '100 Main Street, Baltimore' where deal_id = ${order.id}`
    await sql`update crm.deal_items set discount_pct = 10 where id = (select id from crm.deal_items where deal_id = ${order.id} order by position limit 1)`
    await page.goto(`/deals/${order.id}/pedido`)
    const shipping = page.getByTestId('order-shipping')
    for (const part of ['Shipping details', 'Carrier', 'FedEx', 'PO number', 'PO-9501', 'Shipping address', '100 Main Street, Baltimore']) await expect(shipping).toContainText(part)
    await expect(page.getByTestId('order-line-discount').first()).toHaveText('Less 10% discount')
    await bothWidths(page, 'pedido impreso con envío')
    await setLocale(page, 'es')
    for (const part of ['Datos de envío', 'Paquetería', 'FedEx', 'Orden de compra (PO)']) await expect(page.getByTestId('order-shipping')).toContainText(part)
    await expect(page.getByTestId('order-line-discount').first()).toHaveText('Menos 10% de descuento')
    expect(errors).toEqual([])
  })
})
