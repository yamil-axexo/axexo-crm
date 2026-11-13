import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, testDb, WIDTHS } from './helpers'

/**
 * Paquete `reportes`: la página Reportes y sus reportes (E8, REP-01 a REP-04, CANAL-05, CAMPO-05, GOB-03) y las vistas
 * guardadas como colas (UX-03). Cada prueba recorre el flujo principal desde la pantalla, con el rol que corresponde.
 */
const int = (s: string) => Number(s.replace(/[^\d-]/g, ''))
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const YEAR = 'periodo=rango&desde=2026-01-01&hasta=2026-12-31'

test.describe('página Reportes', () => {
  test('está en el menú de todos y cada rol ve los reportes de su alcance', async ({ page }) => {
    const see: Record<string, { yes: string[]; no: string[] }> = {
      'luis.tovar': { yes: ['panel-lt', 'leads', 'etapas', 'finanzas', 'conciliacion', 'historico', 'pronostico', 'adopcion', 'indicadores'], no: ['lo-que-llevo'] },
      'fernando.ibarra': { yes: ['mi-equipo', 'leads', 'etapas', 'cerrados', 'agencias', 'indicadores-campo', 'adopcion', 'lo-que-llevo'], no: ['finanzas', 'conciliacion', 'panel-lt'] },
      'marco.pena': { yes: ['leads', 'etapas', 'cerrados', 'cuentas', 'lo-que-llevo', 'indicadores'], no: ['finanzas', 'conciliacion', 'adopcion', 'agencias', 'pronostico', 'historico'] },
      'valeria.soto': { yes: ['leads', 'etapas', 'cuentas', 'indicadores'], no: ['cerrados', 'finanzas', 'lo-que-llevo', 'adopcion'] },
    }
    for (const [persona, v] of Object.entries(see)) {
      await loginAs(page, persona)
      await openMenu(page)
      await page.getByTestId('nav-reports').click()
      await expect(page.locator('h1')).toHaveText('Reportes')
      for (const k of v.yes) await expect(page.getByTestId(`report-${k}`), `${persona} ${k}`).toBeVisible()
      for (const k of v.no) await expect(page.getByTestId(`report-${k}`), `${persona} ${k}`).toHaveCount(0)
      // lo que no está en su lista tampoco abre por dirección directa
      for (const k of v.no.filter((x) => !['panel-lt', 'cerrados'].includes(x))) expect((await page.goto(`/reportes/${k}`))?.status(), `${persona} ${k}`).toBe(404)
    }
  })

  test('E8.F1: leads captados y convertidos por mes, fuente y mercado, con clic al detalle y exportación en la bitácora', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto(`/reportes/leads?${YEAR}`)
    const leads = int(await page.getByTestId('m-leads').locator('.num').first().innerText())
    expect(leads).toBeGreaterThan(0)
    const rows = page.getByTestId('leads-row')
    let sum = 0
    for (const r of await rows.all()) sum += int(await r.getByTestId('leads-row-link').innerText())
    expect(sum).toBe(leads)
    await expect(page.getByTestId('m-conversion')).toContainText('%')
    // la definición y quién responde por el número, a un toque
    await page.getByTestId('m-conversion').locator('summary').click()
    await expect(page.getByTestId('m-conversion')).toContainText('Quién responde por este número')
    // filtro por fuente
    await page.getByTestId('filter-fuente').selectOption({ label: 'Formulario web' })
    await expect(page).toHaveURL(/fuente=web_form/)
    for (const r of await page.getByTestId('leads-row').all()) await expect(r).toContainText('Formulario web')
    // clic al detalle: la lista de leads de ese mes y esa fuente
    const first = page.getByTestId('leads-row').first()
    const n = int(await first.getByTestId('leads-row-link').innerText())
    await first.getByTestId('leads-row-link').click()
    await expect(page).toHaveURL(/\/leads\?.*source=web_form/)
    if (n <= 25) await expect(page.getByTestId('lead-row')).toHaveCount(n)
    // exportación gobernada
    await page.goto(`/reportes/leads?${YEAR}`)
    // Integración (AUT-07): el reporte pide motivo como toda exportación.
    await page.getByTestId('export-csv').click()
    await page.getByTestId('export-csv-reason').fill('Revisión de prueba del reporte')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv-go').click()])
    expect(download.suggestedFilename()).toMatch(/^contigo-leads-/)
    const db = testDb()
    try {
      const ev = (await db`select u.full_name, e.after from crm.audit_events e join crm.users u on u.id = e.actor_id where e.action = 'report.exported' order by e.at desc, e.id desc limit 1`)[0]!
      expect(ev.full_name).toBe('Ana Robles')
      expect(ev.after).toMatchObject({ report: 'leads', reason: 'Revisión de prueba del reporte' })
    } finally { await db.end() }
    // quien vende ve el reporte con lo suyo y sin exportar
    await loginAs(page, 'marco.pena')
    await page.goto(`/reportes/leads?${YEAR}`)
    await expect(page.getByTestId('export-csv')).toHaveCount(0)
    expect((await page.request.get('/reportes/exportar?reporte=leads')).status()).toBe(404)
  })

  test('E8.F2: negocios por etapa con días en la etapa y sin próximo paso; abre el tablero', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/etapas')
    const card = page.getByTestId('stage-pipeline').first()
    await expect(card.getByTestId('stage-summary')).toContainText('negocios abiertos')
    expect(await card.getByTestId('stage-row').count()).toBeGreaterThan(1)
    await expect(card.getByTestId('stage-table')).toContainText('Mediana de días en la etapa')
    await expect(card.getByTestId('stage-table')).toContainText('Sin próximo paso')
    await card.getByTestId('stage-board-link').click()
    await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/)
  })

  test('E8.F3 y E8.F5: agencia contra equipo interno, y Finanzas con monto por moneda y consolidado con la tasa a la vista', async ({ page }) => {
    const db = testDb()
    try {
      const d = (await db`select d.account_id from crm.deals d where d.market_code = 'MX' and d.created_at >= '2026-01-01' order by d.id limit 1`)[0]!
      await db`delete from crm.account_attributions where account_id = ${d.account_id} and layer = 'origin'`
      await db`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label) values (${d.account_id}, 'MX', 'origin', 'partner', 'e2e-ag', 'Agencia de ejemplo')`
    } finally { await db.end() }
    await loginAs(page, 'nora.salas')
    await page.goto(`/reportes/agencias?${YEAR}`)
    expect(int(await page.getByTestId('agency-side').locator('.num').first().innerText())).toBeGreaterThanOrEqual(1)
    expect(int(await page.getByTestId('inhouse-side').locator('.num').first().innerText())).toBeGreaterThan(0)
    await expect(page.getByTestId('agency-table')).toContainText('Agencia: Agencia de ejemplo')
    await expect(page.getByTestId('agency-config')).toBeVisible()

    await page.goto(`/reportes/finanzas?${YEAR}`)
    await expect(page.getByTestId('m-finance-won')).toContainText(/MXN|\$/)
    await expect(page.getByTestId('finance-rates')).toContainText('1 MXN =')
    await expect(page.getByTestId('finance-rates')).toContainText('valor de ejemplo')
    expect(await page.getByTestId('finance-row').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('finance-table')).toContainText('Entidad MX')
    await page.getByTestId('finance-row-link').first().click()
    await expect(page).toHaveURL(/\/reportes\/cerrados\?.*resultado=won/)
    // supervisión no entra a Finanzas
    await loginAs(page, 'fernando.ibarra')
    expect((await page.goto('/reportes/finanzas'))?.status()).toBe(404)
  })
})

test.describe('indicadores, tableros por rol y árbol de cuentas (REP-01)', () => {
  test('cada indicador tiene definición y quién responde; administración lo cambia y se ve en el reporte', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/reportes/indicadores')
    const item = page.locator('[data-metric="conversion"]')
    await expect(item.getByTestId('metric-owner')).toContainText('Quien lidera el mercado')
    await item.getByTestId('metric-owner-input').fill('Dirección comercial México')
    await item.getByTestId('metric-owner-save').click()
    await expect(item.getByTestId('metric-owner')).toContainText('Dirección comercial México')
    await page.goto('/reportes/leads')
    await page.getByTestId('m-conversion').locator('summary').click()
    await expect(page.getByTestId('m-conversion')).toContainText('Dirección comercial México')
    // quien vende lee las definiciones y no las cambia
    await loginAs(page, 'marco.pena')
    await page.goto('/reportes/indicadores')
    await expect(page.locator('[data-metric="conversion"]').getByTestId('metric-owner')).toContainText('Dirección comercial México')
    await expect(page.getByTestId('metric-owner-input')).toHaveCount(0)
  })

  test('cadenas y distribuidores con el agregado de sus tiendas, etapas largas y próximos hitos; "Mis cuentas" para quien las lleva', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/cuentas')
    expect(await page.getByTestId('node-row').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('nodes-table')).toContainText('Tiendas')
    await expect(page.getByTestId('kam-long')).toBeVisible()
    await expect(page.getByTestId('kam-milestones')).toBeVisible()
    await page.getByTestId('node-link').first().click()
    await expect(page).toHaveURL(/\/comercios\/[0-9a-f-]{36}\?tab=arbol/)
    // quien lleva cuentas clave entra directo a las suyas
    await loginAs(page, 'diana.cruz')
    await page.goto('/reportes/cuentas')
    for (const row of await page.getByTestId('node-row').all()) await expect(row).toContainText('Diana Cruz')
  })

  test('un reporte se guarda con sus filtros, privado o compartido, y uno programado llega dentro de CONTIGO', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/etapas')
    await page.getByTestId('save-report').click()
    await page.getByTestId('save-report-name').fill('Etapas de mi equipo')
    await page.getByTestId('save-report-shared').check()
    await page.getByTestId('save-report-schedule').selectOption('daily')
    await page.getByTestId('save-report-submit').click()
    await page.goto('/reportes')
    const saved = page.locator('[data-testid="saved-report"][data-name="Etapas de mi equipo"]')
    await expect(saved).toContainText('compartido con tu equipo')
    await expect(saved).toContainText('Cada día')
    await saved.getByTestId('saved-report-link').click()
    await expect(page).toHaveURL(/\/reportes\/etapas/)
    // su equipo lo ve; el otro mercado no
    await loginAs(page, 'marco.pena')
    await page.goto('/reportes')
    await expect(page.locator('[data-name="Etapas de mi equipo"]')).toContainText('lo compartió Fernando Ibarra')
    await expect(page.getByTestId('save-report-shared')).toHaveCount(0)
    await loginAs(page, 'sam.ortiz')
    await page.goto('/reportes')
    await expect(page.locator('[data-name="Etapas de mi equipo"]')).toHaveCount(0)
    // la entrega del reporte programado (la tarea la corre el sistema; aquí se deja lo que la tarea deja)
    const db = testDb()
    try {
      await db`insert into crm.report_deliveries (saved_report_id, user_id, title, body, href)
               select r.id, r.user_id, r.name, '12 negocios abiertos, 3 sin próximo paso.', '/reportes/etapas' from crm.saved_reports r where r.name = 'Etapas de mi equipo'`
    } finally { await db.end() }
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes')
    await expect(page.getByTestId('delivery').first()).toContainText('Etapas de mi equipo')
    await expect(page.getByTestId('delivery').first()).toContainText('Nuevo')
    await page.getByTestId('deliveries-seen').click()
    await expect(page.getByTestId('delivery').first()).not.toContainText('Nuevo')
    await page.locator('[data-name="Etapas de mi equipo"]').getByTestId('saved-report-delete').click()
    await expect(page.locator('[data-name="Etapas de mi equipo"]')).toHaveCount(0)
  })
})

test.describe('histórico, conciliación y pronóstico (REP-02, REP-04, REP-03)', () => {
  test('la foto diaria se toma, el histórico muestra cohortes y velocidad, y el archivo de salida queda con el canal apagado', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/reportes/historico')
    await expect(page.getByTestId('snapshot-chart')).toBeVisible()
    await page.getByTestId('snapshot-now').click()
    await expect(page.getByTestId('snapshot-last')).toContainText('negocios abiertos')
    await expect(page.getByTestId('cohort-leads')).toContainText('A 30 días')
    await expect(page.getByTestId('cohort-stores')).toContainText('Con primera venta')
    await expect(page.getByTestId('velocity')).toBeVisible()
    await expect(page.getByTestId('snapshot-file')).toContainText('Canal apagado')
    await expect(page.getByTestId('outbox-row').first()).toContainText('no salió')
    // Estado de CONTIGO lista los dos canales, apagados, con lo que falta para encenderlos. Los reportes programados salen por
    // el correo único de avisos (notify.ts): no hay un correo propio de reportes.
    await page.goto('/estado')
    await expect(page.locator('main')).toContainText('Avisos por Correo')
    await expect(page.locator('main')).toContainText('Archivo de la foto diaria')
    await expect(page.locator('main')).toContainText('Tech Implementation Review')
    // supervisión: sin foto del mercado, con cohortes de su equipo
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/historico')
    await expect(page.getByTestId('snapshot-card')).toContainText('La foto diaria cuenta el mercado completo')
    await expect(page.getByTestId('cohort-leads')).toBeVisible()
  })

  test('la conciliación compara ganados contra primeras ventas del archivo y lista las diferencias', async ({ page }) => {
    const db = testDb()
    let name = ''
    try {
      const won = (await db`select d.account_id, a.name from crm.deals d join crm.accounts a on a.id = d.account_id join crm.pipelines p on p.id = d.pipeline_id and p.close_by_transaction
         where d.market_code = 'MX' and d.status = 'won' and d.closed_by = 'transaction' order by d.id limit 1`)[0]!
      name = won.name
      await db`update crm.merchant_metrics_daily set first_txn_at = null where account_id = ${won.account_id}`
    } finally { await db.end() }
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/conciliacion')
    const market = page.getByTestId('recon-market').first()
    expect(int(await market.getByTestId('recon-diffs').innerText())).toBeGreaterThanOrEqual(1)
    await expect(market).toContainText('Archivo de ventas con corte al')
    await expect(page.getByTestId('recon-list')).toContainText(name)
    await expect(page.getByTestId('recon-list')).toContainText('Ganado en CONTIGO sin primera venta en el archivo')
    await expect(page.getByTestId('reconcile-now')).toHaveCount(0)
    // administración la corre y queda guardada
    await loginAs(page, 'nora.salas')
    await page.goto('/reportes/conciliacion?mercado=MX')
    await page.getByTestId('reconcile-now').click()
    await expect(page.getByTestId('recon-market').first()).toContainText('Última conciliación guardada')
    // Comercios dice la fecha de corte de los datos de ventas
    await page.goto('/comercios')
    await expect(page.getByTestId('list-asof')).toContainText('con corte al')
  })

  test('el pronóstico da un rango por embudo con su supuesto a la vista', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/pronostico')
    const card = page.getByTestId('forecast-pipeline').first()
    await expect(card.getByTestId('forecast-expected')).toBeVisible()
    await expect(card.getByTestId('forecast-range')).toContainText(/entre .+ y .+/)
    await expect(card.getByTestId('forecast-table')).toContainText('De dónde sale la tasa')
    await expect(card).toContainText('Tipo de venta')
    await page.getByTestId('def-forecast').locator('summary').click()
    await expect(page.getByTestId('def-forecast')).toContainText('Es un rango, no una promesa')
  })
})

test.describe('lo que llevo, indicadores de campo y adopción (CANAL-05, CAMPO-05, GOB-03)', () => {
  test('quien vende ve sus altas, primeras ventas y activos a 30, 60 y 90 días, sin montos de comisión', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await page.goto(`/reportes/lo-que-llevo?${YEAR}`)
    await expect(page.locator('h1')).toHaveText('Lo que llevo')
    await expect(page.getByTestId('carry-stores')).toBeVisible()
    await expect(page.getByTestId('carry-first')).toBeVisible()
    for (const d of [30, 60, 90]) await expect(page.getByTestId(`carry-${d}`)).toContainText(`A ${d} días`)
    await expect(page.getByTestId('carry-note')).toContainText('CONTIGO no calcula el pago ni muestra montos')
    await expect(page.locator('main')).not.toContainText(/\$\s?\d/)
    await expect(page.locator('main')).not.toContainText(/ranking|posición/i)
    // quien supervisa puede ver lo que lleva una persona de su equipo
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/lo-que-llevo')
    await page.getByTestId('filter-persona').selectOption({ label: 'Marco Peña' })
    await expect(page.locator('header').last()).toContainText('Lo que lleva Marco Peña')
  })

  test('indicadores de campo con la señal de confianza: a mano o confirmada por la Sales App', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/indicadores-campo')
    for (const k of ['kpi-per-day', 'kpi-coverage', 'kpi-effect', 'kpi-per-store']) await expect(page.getByTestId(k)).toBeVisible()
    const confirmed = int(await page.getByTestId('trust-confirmed').locator('.num').innerText())
    const manual = int(await page.getByTestId('trust-manual').locator('.num').innerText())
    expect(confirmed + manual).toBeGreaterThan(0)
    await expect(page.getByTestId('trust-note')).toContainText('no para pagar')
    expect(await page.getByTestId('field-kpi-row').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('field-kpi-table')).not.toContainText('Diana Cruz')
  })

  test('supervisión ve el uso real de su equipo con tendencia semanal, sin ingresos; ventas no entra', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/supervisor')
    await page.goto('/reportes/adopcion')
    await expect(page.getByTestId('usage-trend-chart')).toBeVisible()
    for (const k of ['usage-activities', 'usage-next-step', 'usage-leads']) await expect(page.getByTestId(k)).toBeVisible()
    const team = page.getByTestId('usage-team-row').filter({ hasText: 'D2D Centro' })
    await expect(team).toContainText('Sí, ')
    await expect(page.getByTestId('adoption-row').filter({ hasText: 'Marco Peña' })).toHaveCount(1)
    await expect(page.locator('main')).not.toContainText(/ingresos del periodo|Último ingreso/)
    await loginAs(page, 'marco.pena')
    expect((await page.goto('/reportes/adopcion'))?.status()).toBe(404)
  })
})

test.describe('vistas guardadas como colas (UX-03)', () => {
  test('quien vende guarda su filtro de Comercios como vista, la fija como cola con contador en su menú y la borra', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios?owner=me&lifecycle=active')
    const total = await page.getByTestId('account-row').count()
    await page.getByTestId('view-save').click()
    await expect(page.getByTestId('view-shared')).toHaveCount(0)
    await page.getByTestId('view-name').fill('Mis tiendas activas')
    await page.getByTestId('view-save-submit').click()
    const chip = page.locator('[data-testid="view-chip"][data-view="Mis tiendas activas"]')
    await expect(chip).toBeVisible()
    await expect(chip.getByTestId('view-pin')).toHaveText('Fijada')
    // la cola en el menú, con su contador, abre la lista filtrada
    await page.goto('/hoy')
    await openMenu(page)
    const queue = page.getByTestId('nav-queue').filter({ hasText: 'Mis tiendas activas' })
    await expect(queue).toBeVisible()
    const count = int(await queue.getByTestId('nav-queue-count').innerText())
    if (total < 25) expect(count).toBe(total)
    await queue.click()
    await expect(page).toHaveURL(/\/comercios\?.*lifecycle=active.*cola=/)
    await expect(page.locator('[data-view="Mis tiendas activas"]').getByTestId('view-link')).toHaveAttribute('aria-current', 'page')
    // otra persona no la ve
    await loginAs(page, 'lucia.vega')
    await page.goto('/comercios')
    await expect(page.locator('[data-view="Mis tiendas activas"]')).toHaveCount(0)
    // se borra
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios')
    await page.locator('[data-view="Mis tiendas activas"]').getByTestId('view-delete').click()
    await expect(page.locator('[data-view="Mis tiendas activas"]')).toHaveCount(0)
    await openMenu(page)
    await expect(page.getByTestId('nav-queue')).toHaveCount(0)
  })

  test('supervisión comparte una vista de Leads con su equipo; hay vistas en Negocios y en Actividades', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/leads?status=overdue')
    await page.getByTestId('view-save').click()
    await page.getByTestId('view-name').fill('Leads vencidos del equipo')
    await page.getByTestId('view-shared').check()
    await page.getByTestId('view-save-submit').click()
    await expect(page.locator('[data-view="Leads vencidos del equipo"]')).toContainText('del equipo')
    await loginAs(page, 'marco.pena')
    await page.goto('/leads')
    const shared = page.locator('[data-view="Leads vencidos del equipo"]')
    await expect(shared).toBeVisible()
    await expect(shared.getByTestId('view-delete')).toHaveCount(0)
    await shared.getByTestId('view-link').click()
    await expect(page).toHaveURL(/\/leads\?.*status=overdue/)
    // el otro equipo no la ve
    await loginAs(page, 'diana.cruz')
    await page.goto('/leads')
    await expect(page.locator('[data-view="Leads vencidos del equipo"]')).toHaveCount(0)
    // Negocios (vista Lista): las vistas de fábrica que reconstruyen los filtros de Pipedrive
    await loginAs(page, 'sam.ortiz')
    await page.goto('/pipelines?vista=lista')
    await expect(page.locator('[data-view="Negocios sin persona asignada"]')).toBeVisible()
    await page.locator('[data-view="Negocios abiertos sin próximo paso"]').getByTestId('view-link').click()
    await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}\?paso=sin&vista=lista/)
    await expect(page.getByTestId('deal-list')).toBeVisible()
    // Actividades
    await page.goto('/actividades')
    await expect(page.getByTestId('views-bar')).toBeVisible()
    await page.getByTestId('view-save').click()
    await expect(page.getByTestId('view-save-what')).toContainText('no filter on right now')
  })
})

for (const w of WIDTHS.filter((x) => x.width !== 1024)) {
  test.describe(`reportes en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })
    for (const locale of ['es', 'en'] as const) {
      test(`abren en ${locale}, nada se sale del ancho, axe sin hallazgos serios y sin restos del otro idioma`, async ({ page }) => {
        test.setTimeout(150_000)
        await loginAs(page, 'nora.salas')
        await page.context().addCookies([{ name: 'contigo_locale', value: locale, url: page.url() }])
        for (const path of ['/reportes', `/reportes/leads?${YEAR}`, '/reportes/etapas', `/reportes/agencias?${YEAR}`, `/reportes/finanzas?${YEAR}`, '/reportes/cuentas', '/reportes/historico', '/reportes/conciliacion',
          '/reportes/lo-que-llevo', '/reportes/indicadores-campo', '/reportes/pronostico', '/reportes/adopcion', '/reportes/indicadores', '/comercios', '/leads', '/actividades']) {
          const res = await page.goto(path)
          expect(res?.status(), path).toBeLessThan(400)
          await expect(page.locator('html'), path).toHaveAttribute('lang', locale)
          await expect(page.locator('h1').first(), path).toBeVisible()
          await noOverflow(page, `${w.name} ${locale} ${path}`)
          await axeClean(page, `${w.name} ${locale} ${path}`)
          // Los próximos pasos de los negocios son datos escritos por quien los lleva, en su idioma: no cuentan como texto de la pantalla.
          const text = await page.locator('main').evaluate((m) => {
            const c = m.cloneNode(true) as HTMLElement
            for (const el of c.querySelectorAll('[data-testid="kam-milestone-row"]')) el.remove()
            document.body.appendChild(c)
            const s = c.innerText
            c.remove()
            return s
          })
          expect(text, `${path}: guion largo`).not.toMatch(/[—–]/)
          if (path.startsWith('/reportes')) {
            if (locale === 'es') expect(text, `${path}: jerga`).not.toMatch(/\bdeals?\b|\bpipelines?\b|\btimeline\b|\bS5\b|\bmotor\b/i)
            else expect(text, `${path}: restos de español`).not.toMatch(/\bnegocios?\b|\bembudos?\b|\bcomercios?\b|\bsin dato\b|\bpróximo\b/i)
          }
        }
      })
    }
  })
}
