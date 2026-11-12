import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WIDTHS, loginAs, pageErrors, testDb } from './helpers'

const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const spanish = (page: Page) => page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

/** Un comercio de Jade (ventas US) creado directo en la base: la prueba ejercita pedidos y entrega, no el alta del comercio. */
async function jadeMerchant(name: string): Promise<string> {
  const jade = await uid('jade.kim')
  const rows = await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by)
    values ('US', 'store', ${name}, 'orders', ${jade}, 'US', ${jade}) returning id`
  return rows[0]!.id
}

async function newOrder(page: Page, accountId: string, title: string) {
  await page.goto(`/comercios/${accountId}`)
  await page.getByTestId('new-deal').click()
  await page.getByTestId('new-deal-pipeline').selectOption({ label: 'Sales orders' })
  await page.getByTestId('new-deal-title').fill(title)
  await page.getByTestId('new-deal-step').fill('Confirmar pedido con el comercio')
  await page.getByTestId('save-deal').click()
  await expect(page).toHaveURL(/\/deals\//)
  return page.url().split('/').pop()!
}

test.describe.configure({ mode: 'serial' })

test.describe('pedido, entrega a Operaciones, cola, devolución y ganar a mano', () => {
  // La lista de alta (documentos, proveedores, capacitación) aplica por embudo y de fábrica los pedidos no la llevan (0018, ola 4).
  // Este recorrido ejercita esa lista sobre un pedido, así que se la enciende a los embudos de pedidos mientras corre y la apaga al final.
  test.beforeAll(async () => { await sql`update crm.pipelines set ops_checklist = true where market_code = 'US' and multi_open` })
  test.afterAll(async () => { await sql`update crm.pipelines set ops_checklist = false where market_code = 'US' and multi_open` })
  const name = `Zx Mayorista ${tag()}`
  const first = `Pedido SIM ${tag()}`
  const second = `Pedido recargas ${tag()}`
  let accountId = ''
  let dealId = ''

  test('ventas captura un pedido con líneas, abre un segundo negocio y lo entrega a Operaciones', async ({ page }) => {
    const errors = pageErrors(page)
    accountId = await jadeMerchant(name)
    await loginAs(page, 'jade.kim')
    await spanish(page)
    dealId = await newOrder(page, accountId, first)
    await expect(page.getByTestId('items-empty')).toBeVisible()
    // sin líneas no entra a revisión de Operaciones, y lo dice
    await expect(page.getByTestId('gate-missing')).toContainText('línea de producto')
    await page.getByTestId('item-product').selectOption(await uid('prod-us-sim'))
    await page.getByTestId('item-quantity').fill('300')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('item-row')).toHaveCount(1)
    await expect(page.getByTestId('items-total')).toContainText('750')
    await page.waitForTimeout(800) // justo después de guardar, el formulario ignora otro envío por un momento (doble clic)
    await page.getByTestId('item-product').selectOption(await uid('prod-us-topup'))
    await page.getByTestId('item-quantity').fill('2')
    await page.getByTestId('item-price').fill('40')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('item-row')).toHaveCount(2)
    await expect(page.getByTestId('items-total')).toContainText('830')
    await page.waitForTimeout(800)
    // un error dice qué campo y por qué
    await page.getByTestId('item-product').selectOption(await uid('prod-us-sim'))
    await page.getByTestId('item-quantity').fill('0')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('deal-items').getByTestId('form-error')).toContainText('cantidad')

    // segundo negocio abierto del mismo comercio en el embudo de pedidos
    await newOrder(page, accountId, second)
    const open = await sql`select 1 from crm.deals where account_id = ${accountId} and status = 'open'`
    expect(open.length).toBe(2)

    // el próximo paso del negocio llegó a Hoy
    await page.goto('/hoy')
    await expect(page.getByText('Confirmar pedido con el comercio').first()).toBeVisible()

    // entrega: al pasar a la etapa de Operaciones deja de estar en su cancha
    await page.goto(`/deals/${dealId}`)
    await page.getByTestId('deal-advance').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Revisión de Operaciones')
    await expect(page.getByTestId('with-ops')).toBeVisible()
    await expect(page.getByTestId('deal-advance')).toHaveCount(0)
    await expect(page.getByTestId('deal-win')).toHaveCount(0)
    await expect(page.getByTestId('ops-take')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('Operaciones entra a su cola, toma el negocio, mantiene sus campos y lo devuelve con motivo', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'tom.reyes', { stay: true })
    await expect(page).toHaveURL(/\/operaciones$/)
    await spanish(page)
    await page.reload()
    await expect(page.getByTestId('dock')).toContainText('Cola')
    const row = page.getByTestId('ops-row').filter({ hasText: first })
    await expect(row).toContainText(name)
    await expect(row).toContainText('Vendió: Jade Kim')
    await expect(row.getByTestId('ops-missing')).toContainText('documentos por recibir')
    await row.getByTestId('ops-row-take').click()
    await expect(page.getByTestId('ops-row').filter({ hasText: first })).toHaveCount(0) // ya no está "sin tomar"
    await page.getByTestId('pill-mine').click()
    await expect(page.getByTestId('ops-row').filter({ hasText: first })).toHaveCount(1)
    // números de la cola con enlace a su lista
    await page.getByTestId('ops-n-training').click()
    await expect(page).toHaveURL(/foco=capacitacion/)
    await expect(page.getByTestId('ops-row').filter({ hasText: first })).toHaveCount(1)

    await page.getByTestId('ops-row').filter({ hasText: first }).getByTestId('ops-row-link').click()
    const ops = page.getByTestId('deal-ops')
    await expect(ops).toContainText('Lo lleva Tom Reyes')
    await ops.getByTestId('merchant-ref-input').fill('M-204518')
    await ops.getByTestId('merchant-ref-save').click()
    await expect(ops.getByTestId('merchant-ref-copy')).toContainText('M-204518')
    const provider = ops.getByTestId('ops-providers').getByTestId('ops-check').first()
    await provider.getByTestId('ops-check-status').selectOption('sent')
    await provider.getByTestId('ops-check-save').click()
    await expect(provider).toContainText('Enviada')
    const doc = ops.getByTestId('ops-documents').getByTestId('ops-check').first()
    await doc.getByTestId('ops-check-status').selectOption('received')
    await doc.getByTestId('ops-check-link').fill('https://drive.example.test/carpeta/solicitud')
    await doc.getByTestId('ops-check-save').click()
    await expect(doc).toContainText('Recibido')
    await expect(doc).toContainText('Abrir enlace')
    await ops.getByTestId('training-status').selectOption('done')
    await ops.getByTestId('training-save').click()
    await expect(ops.getByTestId('ops-training')).toContainText('Hecha')
    // próximo paso de Operaciones: llega a su Hoy y no pisa el de la vendedora
    await ops.getByTestId('ops-step').fill('Revisar inventario del pedido')
    await ops.getByTestId('ops-step-save').click()
    await expect(ops.getByText('Próximo paso de Operaciones guardado.')).toBeVisible()
    await page.goto('/hoy')
    await expect(page.getByText('Revisar inventario del pedido').first()).toBeVisible()
    const steps = await sql<{ next_step: string; ops_next_step: string }[]>`select next_step, ops_next_step from crm.deals where id = ${dealId}`
    expect(steps[0]).toEqual({ next_step: 'Confirmar pedido con el comercio', ops_next_step: 'Revisar inventario del pedido' })

    // devolver a Ventas: sin motivo no sale
    await page.goto(`/deals/${dealId}`)
    await page.getByTestId('ops-return').click()
    await page.getByTestId('return-reason').selectOption('docs_missing')
    await page.getByTestId('return-note').fill('Falta el permiso de revendedor')
    await page.getByTestId('return-confirm').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Pedido capturado')
    const audit = await sql`select 1 from crm.audit_events where object_id = ${dealId} and action = 'deal.returned_to_sales'`
    expect(audit.length).toBe(1)
    expect(errors).toEqual([])
  })

  test('a la vendedora le aparece la devolución en Hoy; avisa a Operaciones desde una nota y reenvía', async ({ page }) => {
    await loginAs(page, 'jade.kim')
    await spanish(page)
    await page.goto('/hoy')
    await expect(page.getByText(new RegExp(`(Operations sent back|Operaciones devolvió) ${first}`)).first()).toBeVisible()
    await page.goto(`/deals/${dealId}`)
    await page.getByTestId('note-subject').fill('Ya subí el permiso a la carpeta')
    await page.getByTestId('note-notify').selectOption({ label: 'Avisar a Tom Reyes' })
    await page.getByTestId('note-add').click()
    await expect(page.getByTestId('deal-timeline')).toContainText('Ya subí el permiso a la carpeta')
    await page.getByTestId('deal-advance').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Revisión de Operaciones')
  })

  test('Operaciones ve el aviso en Hoy, lo marca visto y gana el negocio a mano desde el tablero con la fecha real', async ({ page }) => {
    await loginAs(page, 'tom.reyes')
    await spanish(page)
    await page.goto('/hoy')
    const notice = page.getByTestId('hoy-notice').filter({ hasText: 'Ya subí el permiso a la carpeta' })
    await expect(notice).toContainText('Jade Kim')
    await notice.getByTestId('hoy-notice-seen').click()
    await expect(page.getByTestId('hoy-notice').filter({ hasText: 'Ya subí el permiso a la carpeta' })).toHaveCount(0)

    await page.goto(`/pipelines/${await uid('p-us-orders')}`)
    const card = page.locator(`[data-card="${dealId}"]`)
    await expect(card.getByTestId('deal-card-title')).toHaveText(first) // la tarjeta muestra el título del negocio, además del comercio
    await card.getByTestId('deal-card-win').click()
    await expect(page.getByTestId('win-rule')).toContainText('En el piloto se gana a mano')
    const max = await page.getByTestId('win-date').getAttribute('max')
    expect(await page.getByTestId('win-date').inputValue()).toBe(max) // hoy, en la zona del mercado; no admite futuro
    await page.getByTestId('win-confirm').click()
    await expect(page.locator(`[data-card="${dealId}"]`)).toHaveCount(0)
    const d = await sql<{ status: string; closed_by: string }[]>`select status, closed_by from crm.deals where id = ${dealId}`
    expect(d[0]).toEqual({ status: 'won', closed_by: 'manual' })
  })

  test('supervisión cierra en bloque los negocios sin movimiento, con motivo', async ({ page }) => {
    const orders = await uid('p-us-orders')
    await sql`update crm.deals set stage_entered_at = now() - interval '45 days', created_at = now() - interval '45 days' where account_id = ${accountId} and status = 'open'`
    await sql`update crm.activities set created_at = now() - interval '45 days' where account_id = ${accountId}`
    await loginAs(page, 'kira.dunn')
    await spanish(page)
    await page.goto(`/pipelines/${orders}`)
    await page.getByTestId('quiet-days').fill('30')
    await page.getByTestId('quiet-apply').click()
    const row = page.getByTestId('bulk-row').filter({ hasText: second })
    await expect(row).toHaveCount(1)
    await row.locator('input[type=checkbox]').check()
    await expect(page.getByTestId('bulk-count')).toContainText('1')
    await page.getByTestId('bulk-reason').selectOption('no_response')
    await page.getByTestId('bulk-close').click()
    await expect(page.getByTestId('bulk-row').filter({ hasText: second })).toHaveCount(0)
    const lost = await sql`select 1 from crm.deals where account_id = ${accountId} and status = 'lost' and loss_reason_code = 'no_response'`
    expect(lost.length).toBe(1)
    // ventas no tiene el cierre en bloque
    await loginAs(page, 'jade.kim')
    await page.goto(`/pipelines/${orders}`)
    await expect(page.getByTestId('quiet-filter')).toHaveCount(0)
  })
})

test('en teléfono el candado de etapa se resuelve en una hoja, sin salir del tablero', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const name = `Zx Candado ${tag()}`
  const accountId = await jadeMerchant(name)
  const jade = await uid('jade.kim')
  const c = await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Dueña De Prueba') returning id`
  await sql`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${accountId}, ${c[0]!.id}, 'US', 'decision_maker')`
  const d = await sql<{ id: string }[]>`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, created_by)
    values ('US', ${await uid('p-us-dealer')}, ${await uid('s-us-dealer-qualified')}, ${accountId}, ${jade}, ${`Alta ${name}`}, 'USD', ${jade}) returning id`
  await loginAs(page, 'jade.kim')
  await spanish(page)
  await page.goto(`/pipelines/${await uid('p-us-dealer')}?owner=me`)
  await page.getByTestId('stage-tab-qualified').click()
  const card = page.locator(`[data-card="${d[0]!.id}"]`)
  await card.getByTestId('deal-stage-select').selectOption({ label: 'Solicitud' })
  await expect(page.getByTestId('gate-dialog')).toBeVisible()
  await page.getByTestId('gate-step').fill('Reunir la solicitud firmada')
  await page.getByTestId('gate-decision-maker').selectOption({ label: 'Dueña De Prueba' })
  await page.getByTestId('gate-met').check()
  await clean(page, 'hoja del candado en teléfono')
  await page.getByTestId('gate-save').click()
  await expect(page.getByTestId('gate-dialog')).toBeHidden()
  await page.getByTestId('stage-tab-application').click()
  await expect(page.getByTestId('stage-application').locator(`[data-card="${d[0]!.id}"]`)).toHaveCount(1)
  // y en la página del negocio: lo que falta para la siguiente etapa también se llena en una hoja
  await sql`update crm.stages set required_fields = '{next_step,amount}' where id = ${await uid('s-us-dealer-carrier')}`
  await page.goto(`/deals/${d[0]!.id}`)
  await page.getByTestId('gate-open').click()
  await page.getByTestId('gate-amount').fill('1200')
  await page.getByTestId('gate-save').click()
  await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Envío a carriers')
  await sql`update crm.stages set required_fields = '{next_step,amount,field:account_funding}' where id = ${await uid('s-us-dealer-carrier')}`
})

test('la hoja de completar le habla a Operaciones de documentos y proveedores, no de llamadas y propuestas', async ({ page }) => {
  const tom = await uid('tom.reyes')
  const acc = await jadeMerchant(`Zx Hoja ${tag()}`)
  await sql`insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by) values ('US', ${acc}, 'task', 'Validar documentos del dealer', now(), ${tom}, ${tom})`
  await loginAs(page, 'tom.reyes')
  await spanish(page)
  await page.goto('/hoy')
  await expect(page.getByText('Validar documentos del dealer').first()).toBeVisible()
  const row = page.getByTestId('queue-row').filter({ hasText: 'Validar documentos del dealer' })
  if (await row.count()) await row.getByTestId('row-complete').click()
  else await page.getByTestId('now-done').click()
  const sheet = page.getByTestId('complete-sheet')
  await expect(sheet).toContainText('Documentos recibidos')
  await expect(sheet).toContainText('Enviado al proveedor')
  await expect(sheet).toContainText('Capacitación')
  await expect(sheet).not.toContainText('Enviar propuesta')
  await expect(sheet).not.toContainText('No contestó')
})

for (const w of WIDTHS) {
  test(`${w.name}: cola de Operaciones, negocio con sus secciones y catálogos sin desbordes ni fallas de accesibilidad`, async ({ page }) => {
    await page.setViewportSize({ width: w.width, height: w.height })
    const acc = await jadeMerchant(`Zx Ancho ${w.name} ${tag()}`)
    const jade = await uid('jade.kim')
    const d = await sql<{ id: string }[]>`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, created_by, ops_entered_at, next_step, next_step_due)
      values ('US', ${await uid('p-us-dealer')}, ${await uid('s-us-dealer-carrier')}, ${acc}, ${jade}, ${`Alta con nombre largo para probar el ancho ${w.name}`}, 'USD', ${jade}, now(), 'Esperar a Operaciones', current_date) returning id`
    await loginAs(page, 'tom.reyes')
    await spanish(page)
    await page.goto('/operaciones?ver=todos')
    await expect(page.getByTestId('ops-queue')).toBeVisible()
    await clean(page, `${w.name} cola`)
    await page.goto(`/deals/${d[0]!.id}`)
    await expect(page.getByTestId('deal-ops')).toBeVisible()
    await clean(page, `${w.name} negocio`)
    await loginAs(page, 'nora.salas')
    await spanish(page)
    await page.goto('/admin/operaciones')
    await expect(page.getByTestId('ops-pipelines')).toBeVisible()
    await clean(page, `${w.name} catálogos`)
    await page.goto(`/pipelines/${await uid('p-us-dealer')}`)
    await clean(page, `${w.name} tablero`)
  })
}
