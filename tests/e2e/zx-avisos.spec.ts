import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WIDTHS, loginAs, openMenu, pageErrors, testDb } from './helpers'

const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const spanish = (page: Page) => page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
/** La pantalla a los anchos de escritorio y de teléfono, sin desbordes ni hallazgos serios de accesibilidad. */
async function bothWidths(page: Page, label: string) {
  for (const w of [WIDTHS[0], WIDTHS[2]]) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await clean(page, `${label} ${w.name}`)
  }
  await page.setViewportSize({ width: WIDTHS[0].width, height: WIDTHS[0].height })
}

async function jadeMerchant(name: string, segment = 'orders'): Promise<string> {
  const jade = await uid('jade.kim')
  const rows = await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by)
    values ('US', 'store', ${name}, ${segment}, ${jade}, 'US', ${jade}) returning id`
  return rows[0]!.id
}

test.describe.configure({ mode: 'serial' })

test.describe('avisos: anuncio con acuse, campana, centro y preferencias', () => {
  const title = `Mantenimiento del portal ${tag()}`

  test('administración publica un anuncio con acuse para US; queda dicho a cuántas personas avisó', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await openMenu(page)
    await page.getByTestId('nav-notices').click()
    await expect(page).toHaveURL(/\/avisos$/)
    await page.getByTestId('notices-announcements-link').click()
    await expect(page).toHaveURL(/\/anuncios$/)
    await expect(page.getByTestId('announcements')).toContainText('No hay anuncios vigentes para ti')
    await page.getByTestId('pill-published').click()
    const form = page.getByTestId('announcement-form')
    await form.getByTestId('ann-topic').selectOption('outage')
    await form.getByTestId('ann-title').fill(title)
    await form.getByTestId('ann-body').fill('El sábado el portal no va a estar disponible de 8 a 10 de la mañana.')
    await form.getByTestId('ann-market').selectOption('US')
    await form.getByTestId('ann-ack').check()
    await form.getByTestId('ann-publish').click()
    await expect(form.getByTestId('form-ok')).toContainText(/Publicado: \d+ personas avisadas\./)
    const row = page.getByTestId('published').filter({ hasText: title })
    await expect(row.getByTestId('published-counts')).toContainText(/0 de \d+ dieron acuse/)
    await bothWidths(page, 'anuncios publicados')
    expect(errors).toEqual([])
  })

  test('quien vende lo ve al entrar, en su campana y en Hoy; da acuse desde el aviso y deja de salir', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'jade.kim')
    const banner = page.getByTestId('announce-banner')
    await expect(banner.getByTestId('announce-banner-title')).toHaveText(title)
    await expect(banner.getByTestId('announce-banner-ack')).toHaveText('Got it') // Jade lee en inglés
    await expect(page.getByTestId('bell')).toHaveAttribute('aria-label', /Notices: \d+ unread/)
    await expect(page.getByTestId('hoy-notice').filter({ hasText: title })).toBeVisible() // pide acción: está en Hoy
    const before = Number(await page.getByTestId('bell-count').innerText())
    await page.setViewportSize({ width: 390, height: 844 })
    await clean(page, 'hoy con anuncio, móvil')
    await page.setViewportSize({ width: 1440, height: 900 })
    await banner.getByTestId('announce-banner-ack').click()
    await expect(page.getByTestId('announce-banner')).toHaveCount(0)
    await expect(page.getByTestId('hoy-notice').filter({ hasText: title })).toHaveCount(0)
    if (before > 1) await expect(page.getByTestId('bell-count')).toHaveText(String(before - 1))
    else await expect(page.getByTestId('bell-count')).toHaveCount(0)

    // En Anuncios queda como enterado, con la hora.
    await page.goto('/anuncios')
    const item = page.getByTestId('announcement').filter({ hasText: title })
    await expect(item).toHaveAttribute('data-state', 'read')
    await expect(item.getByTestId('announcement-done')).toContainText('You acknowledged it on')

    // Centro de avisos: sin leer y todos, con enlace al registro.
    await page.getByTestId('bell').click()
    await expect(page).toHaveURL(/\/avisos$/)
    await page.getByTestId('pill-all').click()
    await expect(page.getByTestId('notice-row').filter({ hasText: title })).toBeVisible()
    await bothWidths(page, 'centro de avisos')
    expect(errors).toEqual([])
  })

  test('preferencias: apagar un canal y pedir resumen se guarda; lo obligatorio no se puede apagar; los canales de afuera dicen que están apagados', async ({ page }) => {
    await loginAs(page, 'jade.kim')
    await spanish(page)
    await page.goto('/avisos')
    await page.getByTestId('notices-prefs-link').click()
    await expect(page).toHaveURL(/\/avisos\/preferencias$/)
    await expect(page.getByTestId('prefs-off-note')).toContainText('Correo, Slack y WhatsApp están apagados por ahora')
    await expect(page.getByTestId('pref-announcement-in_app')).toBeDisabled()
    await expect(page.getByTestId('pref-lead_arrived-email')).toBeChecked()
    await page.getByTestId('pref-lead_arrived-email').uncheck()
    await page.getByTestId('pref-digest').check()
    await page.getByTestId('prefs-save').click()
    await expect(page.getByTestId('form-ok')).toHaveText('Preferencias guardadas.')
    await page.reload()
    await expect(page.getByTestId('pref-lead_arrived-email')).not.toBeChecked()
    await expect(page.getByTestId('pref-digest')).toBeChecked()
    await expect(page.getByTestId('pref-mention-in_app')).toBeChecked()
    await bothWidths(page, 'preferencias de avisos')
  })

  test('quien publicó ve quién dio acuse y quién falta', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/anuncios?ver=publicados')
    const row = page.getByTestId('published').filter({ hasText: title })
    await expect(row.getByTestId('published-counts')).toContainText(/1 de \d+ dieron acuse/)
    await row.getByTestId('published-who').click()
    const who = page.getByTestId('published-audience')
    await expect(who.getByTestId('audience-row').filter({ hasText: 'Jade Kim' })).toContainText('Acuse:')
    await expect(who.getByTestId('audience-row').filter({ hasText: 'Sam Ortiz' })).toContainText('Falta')
    await page.getByTestId('published').filter({ hasText: title }).getByTestId('published-withdraw').click()
    await expect(page.getByTestId('published').filter({ hasText: title })).toContainText('Retirado')
  })
})

test.describe('pedido: hoja para imprimir y envío a Operaciones', () => {
  const merchant = `Tienda Avisos ${tag()}`
  const order = `Pedido avisos ${tag()}`
  let dealId = ''

  // El correo espera al horario hábil del mercado. Para que la prueba no dependa de la hora en que corre, US abre todo el día
  // mientras dura este bloque y al final vuelve a su horario.
  let hours: { days: number[]; opens: string; closes: string } | undefined
  test.beforeAll(async () => {
    hours = (await sql<{ days: number[]; opens: string; closes: string }[]>`select days, opens::text, closes::text from crm.market_hours where market_code = 'US'`)[0]
    await sql`update crm.market_hours set days = '{1,2,3,4,5,6,7}', opens = '00:00', closes = '23:59:59' where market_code = 'US'`
  })
  test.afterAll(async () => {
    if (hours) await sql`update crm.market_hours set days = ${hours.days}, opens = ${hours.opens}::time, closes = ${hours.closes}::time where market_code = 'US'`
  })

  test('administración configura el buzón de pedidos y el encabezado; los canales de afuera aparecen apagados en Estado', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.getByTestId('pill-avisos').click()
    await expect(page).toHaveURL(/\/admin\/avisos$/)
    await expect(page.getByTestId('channel-in_app')).toContainText('Encendido')
    for (const c of ['email', 'slack', 'whatsapp']) await expect(page.getByTestId(`channel-${c}`)).toContainText('Canal apagado')
    await bothWidths(page, 'admin avisos, canales')
    await page.getByTestId('pill-mercados').click()
    const us = page.getByTestId('comms-US')
    await us.getByTestId('comms-header').fill('Marca de prueba')
    await us.getByTestId('comms-mailbox').fill('pedidos@ejemplo.test')
    await us.getByTestId('comms-video').fill('https://ejemplo.test/recorrido')
    await us.getByTestId('comms-save').click()
    await expect(us.getByTestId('form-ok')).toHaveText('Configuración guardada.')
    await page.goto('/estado')
    for (const c of ['email', 'slack', 'whatsapp']) await expect(page.getByTestId(`status-row-channel_${c}`).getByTestId('status-state')).toHaveText('Apagado')
  })

  test('quien vende arma el pedido, abre la hoja, la hoja se imprime sin la barra, y lo envía a Operaciones', async ({ page }) => {
    const errors = pageErrors(page)
    const accountId = await jadeMerchant(merchant)
    await loginAs(page, 'jade.kim')
    await spanish(page)
    await page.goto(`/comercios/${accountId}`)
    await page.getByTestId('new-deal').click()
    await page.getByTestId('new-deal-pipeline').selectOption({ label: 'Sales orders' })
    await page.getByTestId('new-deal-title').fill(order)
    await page.getByTestId('new-deal-step').fill('Confirmar pedido con el comercio')
    await page.getByTestId('save-deal').click()
    await expect(page).toHaveURL(/\/deals\//)
    dealId = page.url().split('/').pop()!
    await expect(page.getByTestId('order-print-link')).toHaveCount(0) // sin líneas todavía no hay hoja que enviar
    await page.getByTestId('item-product').selectOption(await uid('prod-us-sim'))
    await page.getByTestId('item-quantity').fill('20')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('item-row')).toHaveCount(1)
    await page.getByTestId('order-print-link').click()
    await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/pedido$`))
    const sheet = page.getByTestId('order-sheet')
    await expect(sheet.getByTestId('order-header')).toHaveText('Marca de prueba')
    await expect(sheet.getByTestId('order-merchant')).toHaveText(merchant)
    await expect(sheet.getByTestId('order-by')).toHaveText('Lo levantó: Jade Kim')
    await expect(sheet.getByTestId('order-line')).toHaveCount(1)
    await expect(sheet.getByTestId('order-total')).toContainText('USD')
    await expect(sheet.getByTestId('order-trail')).toContainText('Todavía no se ha enviado a Operaciones.')
    await bothWidths(page, 'pedido imprimible')

    // En papel solo sale la hoja.
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('topbar')).toBeHidden()
    await expect(page.getByTestId('dock')).toBeHidden()
    await expect(page.getByTestId('order-send')).toBeHidden()
    await expect(sheet).toBeVisible()
    await page.emulateMedia({ media: 'screen' })

    await page.getByTestId('order-send').click()
    await expect(page.getByTestId('form-ok').or(page.getByTestId('order-waiting')).first()).toBeVisible()
    await expect(page.getByTestId('order-waiting')).toContainText('El correo al buzón de pedidos está listo para enviar, con el canal de correo apagado')
    await expect(page.getByTestId('order-send')).toHaveCount(0)
    await expect(sheet.getByTestId('order-dispatch')).toContainText('Enviado a Operaciones por Jade Kim')
    expect(errors).toEqual([])
  })

  test('Operaciones lo ve en su cola y en Hoy, lo abre y lo marca como recibido; queda quién y cuándo', async ({ page }) => {
    await loginAs(page, 'tom.reyes', { stay: true })
    await spanish(page)
    await page.goto('/operaciones')
    const row = page.getByTestId('ops-order').filter({ hasText: merchant })
    await expect(row).toContainText('Lo envió Jade Kim')
    await expect(row).toContainText('1 línea')
    await page.goto('/hoy')
    await expect(page.getByTestId('hoy-notice').filter({ hasText: merchant })).toBeVisible()
    await page.getByTestId('hoy-notice').filter({ hasText: merchant }).getByTestId('hoy-notice-open').click()
    await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/pedido$`))
    await page.getByTestId('order-receive').click()
    await expect(page.getByTestId('order-dispatch')).toContainText('Recibido por Tom Reyes')
    await expect(page.getByTestId('order-waiting')).toHaveCount(0)
    await page.goto('/operaciones')
    await expect(page.getByTestId('ops-order').filter({ hasText: merchant })).toHaveCount(0)
  })

  test('el correo del pedido está en la cola "listo para enviar" con el canal apagado, con su plantilla y su texto', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/avisos?ver=cola&canal=email')
    const row = page.getByTestId('queue-row').filter({ hasText: merchant }).filter({ hasText: 'pedidos@ejemplo.test' })
    await expect(row).toHaveAttribute('data-status', 'queued_off')
    await expect(row).toContainText('Listo para enviar. Canal apagado')
    await expect(row).toContainText('Pedido a Operaciones, versión 1')
    await bothWidths(page, 'cola de salida')
  })
})

test.describe('plantillas, capacitación, reporte con tiempos y ayuda de la pantalla', () => {
  test('plantillas: la bienvenida de México dice que falta el texto; guardar crea una versión nueva; una variable desconocida se rechaza', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/avisos?ver=plantillas')
    await expect(page.getByTestId('template-lead_welcome')).toContainText('Falta el texto')
    await expect(page.getByTestId('template-lead_welcome')).toContainText('no entra a la cola de salida')
    const ack = page.getByTestId('template-lead_web_ack')
    await expect(ack).toContainText('Va: al lead, a su correo.')
    await ack.getByTestId('tpl-body-es').fill('Hola, {{contacto}}. Recibimos la solicitud de {{comercio}} y {{no_existe}}.')
    await ack.getByTestId('tpl-save').click()
    await expect(ack.getByTestId('form-error')).toContainText('no_existe')
    await ack.getByTestId('tpl-body-es').fill('Hola, {{contacto}}. Recibimos la solicitud de {{comercio}}.')
    await ack.getByTestId('tpl-save').click()
    await expect(ack.getByTestId('form-ok')).toContainText('Guardada como versión 2')
    await page.reload()
    await page.getByTestId('template-lead_web_ack').getByTestId('tpl-preview').locator('summary').click()
    await expect(page.getByTestId('template-lead_web_ack').getByTestId('tpl-preview')).toContainText('Recibimos la solicitud de Tienda Ejemplo.')
    await bothWidths(page, 'plantillas')
  })

  test('capacitación: Operaciones agenda con fecha y quién la da, anota que no se presentó y reagenda, y la marca hecha', async ({ page }) => {
    const accountId = await jadeMerchant(`Dealer Avisos ${tag()}`, 'dealer')
    const jade = await uid('jade.kim')
    const deal = (await sql<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by, ops_entered_at)
      values ('US', ${await uid('p-us-dealer')}, ${await uid('s-us-dealer-carrier')}, ${accountId}, ${jade}, ${`Alta avisos ${tag()}`}, 'USD', 'Esperar aprobación', ${plusDays(3)}, ${jade}, now()) returning id`)[0]!.id
    await loginAs(page, 'tom.reyes', { stay: true })
    await spanish(page)
    await page.goto(`/deals/${deal}`)
    const agenda = page.getByTestId('training-agenda')
    await expect(agenda.getByTestId('training-empty')).toBeVisible()
    await expect(agenda.getByTestId('training-video')).toHaveAttribute('href', 'https://ejemplo.test/recorrido')
    await agenda.getByTestId('training-date').fill(plusDays(3))
    await agenda.getByTestId('training-time').fill('10:30')
    await agenda.getByTestId('training-trainer').selectOption({ label: 'Tom Reyes' })
    await agenda.getByTestId('training-schedule').click()
    await expect(agenda.getByTestId('training-session')).toHaveCount(1)
    await expect(agenda.getByTestId('training-session').first()).toContainText('la da Tom Reyes')
    await expect(agenda.getByTestId('training-session').first()).toHaveAttribute('data-status', 'scheduled')
    await bothWidths(page, 'negocio con agenda de capacitación')
    await agenda.getByTestId('training-noshow').click()
    await page.getByTestId('training-next-on').fill(plusDays(8))
    await page.getByTestId('training-noshow-confirm').click()
    await expect(agenda.getByTestId('training-session')).toHaveCount(2)
    await expect(agenda.locator('[data-testid=training-session][data-status=no_show]')).toHaveCount(1)
    await expect(agenda.locator('[data-testid=training-session][data-status=scheduled]')).toContainText('reagendada')
    await agenda.getByTestId('training-done').click()
    await expect(agenda.locator('[data-testid=training-session][data-status=done]')).toHaveCount(1)
    await expect(agenda.getByTestId('training-resolve')).toHaveCount(0)
    // A quien vendió le quedó el seguimiento en Hoy y el aviso en su campana.
    await loginAs(page, 'jade.kim')
    await expect(page.getByText(/Confirm the new training date with Dealer Avisos/).first()).toBeVisible()
  })

  test('ayuda de la pantalla y reporte con tiempos: recibido, en revisión y respondido, con aviso a quien reportó', async ({ page }) => {
    const errors = pageErrors(page)
    const body = `No encuentro el pedido de ayer ${tag()}`
    await loginAs(page, 'marco.pena')
    await page.getByTestId('screen-help-link').click()
    await expect(page).toHaveURL(/\/como-se-usa\?pantalla=%2Fhoy$/)
    await expect(page.getByTestId('how-to')).toContainText('¿Cómo se usa Hoy?')
    expect(await page.getByTestId('how-to-item').count()).toBeGreaterThanOrEqual(2)
    await bothWidths(page, 'ayuda de la pantalla')
    await page.getByTestId('how-to-back').click()
    await expect(page).toHaveURL(/\/hoy$/)

    await page.goto('/reportar?desde=/hoy')
    await expect(page.getByTestId('report-whatsapp')).toContainText('Soporte por WhatsApp: canal apagado.')
    await page.getByTestId('report-body').fill(body)
    await page.getByTestId('report-send').click()
    const mine = page.getByTestId('report-row').filter({ hasText: body })
    await expect(mine).toContainText('Recibido')
    await expect(mine.getByTestId('report-time-taken')).toHaveText('Todavía nadie lo revisa')
    await expect(mine.getByTestId('report-time-target')).toHaveText('Plazo de respuesta: sin definir')

    await loginAs(page, 'nora.salas', { stay: true })
    await expect(page.getByTestId('bell-count')).toBeVisible() // el reporte nuevo llegó a su campana
    await page.goto('/admin?tab=reportes')
    const row = page.getByTestId('admin-report-row').filter({ hasText: body })
    await row.getByTestId('admin-report-take').click()
    await expect(row.getByTestId('report-time-taken')).toContainText('En revisión:')
    await expect(row.getByTestId('report-time-taken')).toContainText('Nora Salas')
    await row.getByTestId('admin-report-answer').fill('Está en Negocios, filtro Pedidos. Ya te lo dejé abierto.')
    await row.getByTestId('admin-report-save').click()

    await loginAs(page, 'marco.pena')
    await expect(page.getByTestId('hoy-notice').filter({ hasText: 'Respondieron tu reporte' })).toBeVisible()
    await page.getByTestId('hoy-notice').filter({ hasText: 'Respondieron tu reporte' }).getByTestId('hoy-notice-open').click()
    await expect(page).toHaveURL(/\/reportar$/)
    const done = page.getByTestId('report-row').filter({ hasText: body })
    await expect(done).toContainText('Atendido')
    await expect(done.getByTestId('report-time-answered')).toContainText('Respondido:')
    await expect(done.getByTestId('report-time-taken')).toContainText('En revisión:')
    await bothWidths(page, 'reportar con tiempos')
    expect(errors).toEqual([])
  })
})
