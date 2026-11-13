import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, pageErrors, testDb } from './helpers'

const sql = testDb()
test.afterAll(async () => {
  // Las reglas de esta prueba no deben decidir los leads de las pruebas que corren después.
  await sql`update crm.assignment_rules set is_active = false`
  await sql`update crm.stages set conditions = '{}' where conditions <> '{}'`
  await sql.end()
})
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const phone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

async function sendForm(page: Page, url: string, name: string) {
  await page.context().clearCookies()
  await page.goto(url)
  await page.locator('input[name="business_name"]').fill(name)
  await page.locator('input[name="contact_name"]').fill('Persona de Prueba')
  await page.locator('input[name="phone"]').fill(phone())
  await page.getByTestId('public-submit').click()
  await expect(page.getByTestId('form-ok')).toBeVisible()
  const lead = await sql<{ id: string; owner_id: string | null }[]>`select id, owner_id from crm.leads where business_name = ${name}`
  expect(lead.length).toBe(1)
  return lead[0]!
}

test.describe.configure({ mode: 'serial' })

test.describe('paquete embudo', () => {
  test('administración crea una regla de asignación, la simula, y el lead web cae a quien dice la regla con su atribución completa', async ({ page }) => {
    const errors = pageErrors(page)
    const lucia = await uid('lucia.vega')
    const form = await uid('f-mx-d2d')
    const ruleName = `Tiendas web a Lucía ${tag()}`
    await loginAs(page, 'nora.salas', { stay: true })
    // La pantalla está en Administración, en la sección de Ventas y Operaciones.
    await page.goto('/admin')
    await expect(page.locator('a[href="/admin/embudo"]')).toHaveCount(1)
    await page.goto('/admin/embudo')
    await expect(page.getByTestId('rules-empty')).toBeVisible()
    await page.getByTestId('rule-market').selectOption('MX')
    await page.getByTestId('rule-name').fill(ruleName)
    await page.getByTestId('rule-action').selectOption('user')
    await page.getByTestId('rule-user').selectOption(lucia)
    await page.getByTestId('rule-form-id').selectOption(form)
    await page.getByTestId('rule-save').click()
    await expect(page.getByTestId('rule-row').filter({ hasText: ruleName })).toBeVisible()

    // Simulador: no asigna nada ni gasta el turno.
    await page.getByTestId('sim-market').selectOption('MX')
    await page.getByTestId('sim-form-id').selectOption(form)
    await page.getByTestId('sim-run').click()
    await expect(page.getByTestId('sim-owner')).toContainText('Lucía Vega')
    await expect(page.getByTestId('sim-why')).toContainText(ruleName)
    expect((await sql`select 1 from crm.assignment_log`).length).toBe(0)

    // Un requisito de etapa con condición: se guarda y se lee en la misma pantalla; luego vuelve a "siempre".
    const cond = page.getByTestId('cond-form').first()
    await cond.getByTestId('cond-min').fill('5000')
    await cond.getByTestId('cond-save').click()
    await expect(page.getByTestId('cond-text').first()).toContainText('desde un monto de')
    await page.getByTestId('cond-form').first().getByTestId('cond-min').fill('')
    await page.getByTestId('cond-form').first().getByTestId('cond-save').click()
    await expect(page.getByTestId('cond-text').first()).toHaveText('siempre')
    await clean(page, 'admin embudo 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await clean(page, 'admin embudo 390')
    await page.setViewportSize({ width: 1440, height: 900 })

    // El formulario público, con campaña y clic de TikTok en la dirección.
    const name = `Tienda Regla ${tag()}`
    const lead = await sendForm(page, '/f/tiendas-mx?utm_source=tiktok&utm_campaign=e2e-embudo&ttclid=TT-E2E-1', name)
    expect(lead.owner_id).toBe(lucia)
    const saved = (await sql`select ttclid, landing_page, utm_source from crm.leads where id = ${lead.id}`)[0]!
    expect(saved).toMatchObject({ ttclid: 'TT-E2E-1', landing_page: '/f/tiendas-mx', utm_source: 'tiktok' })

    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto(`/leads/${lead.id}`)
    await expect(page.getByTestId('lead-touches')).toContainText('TikTok')
    await expect(page.getByTestId('lead-touches')).toContainText('e2e-embudo')
    await expect(page.getByTestId('lead-routed')).toContainText(ruleName)
    // La bandeja filtra por la plataforma del clic y por la fuente.
    await page.goto('/leads?status=all&clic=tiktok&utm=tiktok')
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByTestId('lead-f-click')).toHaveValue('tiktok')
    await expect(page.getByTestId('lead-f-market')).toBeVisible()
    await page.goto('/admin/embudo')
    await expect(page.getByTestId('log-table')).toContainText(name)
    // La regla se pausa: vuelve a decidir el turno del formulario.
    await page.getByTestId('rule-row').filter({ hasText: ruleName }).getByTestId('rule-off').click()
    await expect(page.getByTestId('rule-row').filter({ hasText: ruleName })).toContainText('En pausa')
    expect(errors).toEqual([])
  })

  test('el enlace de referido de un comercio (con su código QR) atribuye el lead al comercio y sale en el reporte', async ({ page }) => {
    const marco = await uid('marco.pena')
    const acc = (await sql<{ id: string; name: string }[]>`select id, name from crm.accounts where owner_id = ${marco} and market_code = 'MX' and archived_at is null order by created_at limit 1`)[0]!
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${acc.id}?tab=datos`)
    await expect(page.getByTestId('account-milestones')).toBeVisible()
    await page.getByTestId('referral-create').click()
    await expect(page.getByTestId('referral-code')).toBeVisible()
    const code = (await page.getByTestId('referral-code').innerText()).trim()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    await expect(page.getByTestId('referral-qr').locator('svg')).toBeVisible()
    await expect(page.getByTestId('referral-link')).toContainText(`/r/${code}`)

    const name = `Tienda Referida ${tag()}`
    await page.context().clearCookies()
    await page.goto(`/r/${code}`)
    await expect(page).toHaveURL(new RegExp(`/f/tiendas-mx\\?ref=${code}`))
    const lead = await sendForm(page, page.url(), name)
    expect((await sql`select referred_by_account_id from crm.leads where id = ${lead.id}`)[0]!.referred_by_account_id).toBe(acc.id)
    // Un código que no existe no rompe nada: lleva al inicio.
    await page.goto('/r/ZZZZZZZZ')
    await expect(page).not.toHaveURL(/\/f\//)

    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto(`/leads/${lead.id}`)
    await expect(page.getByTestId('lead-referred-by')).toContainText(acc.name)
    await page.goto('/reportes')
    await page.getByRole('link', { name: /Embudo: motivos, revisitas/ }).first().click()
    await expect(page).toHaveURL(/\/reportes\/embudo/)
    await expect(page.getByTestId('referral-row').filter({ hasText: acc.name })).toContainText(code)
    await expect(page.getByTestId('attribution-table')).toContainText('referido')
    await expect(page.getByTestId('lost-table').or(page.getByTestId('report-reasons'))).toBeVisible()
  })

  test('un lead se liga a un comercio existente, lleva etiquetas que filtran la bandeja y el comercio muestra sus leads', async ({ page }) => {
    const marco = await uid('marco.pena')
    const acc = (await sql<{ id: string; name: string }[]>`select id, name from crm.accounts where owner_id = ${marco} and market_code = 'MX' and archived_at is null order by created_at limit 1`)[0]!
    const name = `Lead Ligado ${tag()}`
    const lead = (await sql<{ id: string }[]>`insert into crm.leads (market_code, source, motor, business_name, contact_name, phone, owner_id, assigned_at, sla_due_at)
      values ('MX', 'manual', 'd2d', ${name}, 'Rosa Luna', ${'+5255' + String(Math.floor(10000000 + Math.random() * 89999999))}, ${marco}, now(), now() + interval '1 day') returning id`)[0]!
    await loginAs(page, 'marco.pena')
    await page.goto(`/leads/${lead.id}`)
    await page.getByTestId('lead-link-q').fill(acc.name.slice(0, 12))
    await page.getByTestId('lead-link-find').click()
    await page.getByTestId('lead-link-choices').getByRole('listitem').filter({ hasText: acc.name }).first().getByTestId('lead-link-pick').click()
    await expect(page.getByTestId('lead-linked-account')).toHaveText(acc.name)
    await page.getByTestId('label-prioridad').check()
    await page.getByTestId('lead-labels-save').click()
    await expect(page.getByTestId('lead-labels-form').getByTestId('form-ok')).toBeVisible()
    await page.goto('/leads?etiqueta=prioridad')
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByTestId('lead-f-label')).toHaveValue('prioridad')
    await page.goto(`/comercios/${acc.id}?tab=datos`)
    await expect(page.getByTestId('account-lead').filter({ hasText: name })).toBeVisible()
  })

  test('un ticket de soporte entra al hilo como referencia, y el hilo completo junta lo de las sucursales', async ({ page }) => {
    const marco = await uid('marco.pena')
    const acc = (await sql<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco} and market_code = 'MX' and archived_at is null order by created_at limit 1`)[0]!
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${acc.id}`)
    await fichaTab(page, 'hilo')
    const ref = `#${Math.floor(10000 + Math.random() * 89999)}`
    await page.getByTestId('ticket-ref').fill(ref)
    await page.getByTestId('ticket-subject').fill('No le llegan los comprobantes')
    await page.getByTestId('ticket-save').click()
    await expect(page.getByTestId('ticket').filter({ hasText: ref })).toContainText('Abierto')
    await page.getByTestId('full-thread-link').click()
    await expect(page).toHaveURL(new RegExp(`/comercios/${acc.id}/hilo`))
    await expect(page.locator('[data-testid="thread-entry"][data-kind="ticket"]').filter({ hasText: ref })).toBeVisible()
    await clean(page, 'hilo completo 1440')

    // Una cadena con sucursales: el hilo completo trae lo de sus tiendas, cada entrada con el nombre de la sucursal.
    const parent = (await sql<{ id: string }[]>`
      select p.id from crm.accounts p where p.archived_at is null and p.market_code = 'MX'
         and exists (select 1 from crm.accounts c join crm.visits v on v.account_id = c.id where p.id = any(c.ancestor_ids) and c.archived_at is null) limit 1`)[0]
    expect(parent, 'el seed trae una cadena con sucursales visitadas').toBeTruthy()
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto(`/comercios/${parent!.id}/hilo?sucursales=1`)
    await expect(page.getByTestId('thread-branch').first()).toBeVisible()
    await page.getByRole('link', { name: 'Solo este comercio' }).click()
    await expect(page.getByTestId('thread-branch')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/comercios/${parent!.id}/hilo?sucursales=1`)
    await clean(page, 'hilo completo 390')
  })

  test('la revisita a quien decide se filtra en el tablero, y quien lidera corrige un ganado que no lo era', async ({ page }) => {
    await loginAs(page, 'ana.robles', { stay: true })
    const pipe = await uid('p-mx-d2d')
    await page.goto(`/pipelines/${pipe}?paso=revisita`)
    await expect(page.getByTestId('filter-revisit')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('filter-revisit')).toContainText(/\(\d+\)/)

    const deal = (await sql<{ id: string; account_id: string }[]>`
      select d.id, d.account_id from crm.deals d join crm.account_milestones m on m.account_id = d.account_id and m.first_txn_at is not null
       where d.market_code = 'MX' and d.status = 'won' and d.closed_by = 'transaction' order by d.won_at desc limit 1`)[0]!
    await page.goto(`/deals/${deal.id}`)
    await expect(page.getByTestId('deal-closing')).toBeVisible()
    await expect(page.getByTestId('ms-first-txn')).not.toHaveText('Todavía no')
    await expect(page.getByTestId('ms-cut')).toBeVisible()
    await page.getByTestId('milestone-correct').click()
    await page.getByTestId('correct-reason').fill('La transacción era de prueba, no una venta real')
    await page.getByTestId('correct-save').click()
    await expect(page.getByTestId('correction').first()).toContainText('anulado')
    await expect(page.getByTestId('ms-first-txn')).toHaveText('Todavía no')
    const after = (await sql`select status, won_at, closed_by from crm.deals where id = ${deal.id}`)[0]!
    expect(after).toMatchObject({ status: 'open', won_at: null, closed_by: null })
    expect((await sql`select 1 from crm.deal_stage_events where deal_id = ${deal.id} and cause = 'correction'`).length).toBe(1)
    // Quien vende ve los hitos, pero no puede corregirlos.
    await loginAs(page, 'diana.cruz')
    await page.goto(`/deals/${deal.id}`)
    if (await page.getByTestId('deal-closing').count()) await expect(page.getByTestId('milestone-correct')).toHaveCount(0)
  })

  test('los tres adaptadores salen apagados en Estado, y el reporte se lee en inglés y a 390 px', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    for (const text of ['Archivo de ventas: ir a buscarlo', 'Conversiones a plataformas de anuncios', 'Mesa de soporte (tickets)']) await expect(page.getByText(text).first()).toBeVisible()
    await expect(page.getByText('SALES_FILE').first()).toBeVisible()
    await expect(page.getByText('AD_CONVERSIONS').first()).toBeVisible()
    await page.goto('/admin/embudo')
    await expect(page.getByTestId('retries-empty').or(page.getByTestId('retries-table'))).toBeVisible()
    await expect(page.getByTestId('reason-version')).toContainText('Versión')

    await loginAs(page, 'robert.hale', { stay: true })
    await page.goto('/reportes/embudo')
    await expect(page.getByRole('heading', { name: 'Pipeline: reasons, revisits, next steps and origin' })).toBeVisible()
    await expect(page.getByTestId('report-next-steps')).toContainText('No next step')
    await expect(page.locator('body')).not.toContainText('Próximos pasos')
    await clean(page, 'reporte embudo EN 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await clean(page, 'reporte embudo EN 390')
  })
})
