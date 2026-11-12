import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb, WIDTHS } from './helpers'

// Paquete "liderazgo": lo que leadership, quien lidera un mercado y supervisión necesitan para leer el negocio.

const int = (s: string) => Number(s.replace(/[^\d-]/g, ''))
const lastExport = async () => {
  const sql = testDb()
  try {
    return (await sql<{ actor: string; market_code: string | null; after: { report: string; rows: number; filters: Record<string, string | null> } }[]>`
      select u.full_name as actor, e.market_code, e.after from crm.audit_events e join crm.users u on u.id = e.actor_id
       where e.action = 'report.exported' order by e.at desc, e.id desc limit 1`)[0]
  } finally {
    await sql.end()
  }
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

test.describe('cada rol aterriza en su pantalla', () => {
  for (const [persona, url, mark] of [
    ['luis.tovar', /\/panel-lt$/, 'lt-kpis'],
    ['ana.robles', /\/supervisor$/, 'team-board'],
    ['nora.salas', /\/admin$/, 'people-table'],
    ['marco.pena', /\/hoy$/, 'today-title'],
    ['fernando.ibarra', /\/hoy$/, 'today-title'],
    ['valeria.soto', /\/operaciones$/, 'ops-n-unassigned'], // Operaciones entra a su cola (paquete operaciones): una sola función decide el inicio
  ] as const) {
    test(`${persona} entra a ${url.source}`, async ({ page }) => {
      await loginAs(page, persona, { stay: true })
      await expect(page).toHaveURL(url)
      if (mark !== 'people-table') await expect(page.getByTestId(mark)).toBeVisible()
      await expect(page.locator('h1').first()).toBeVisible()
      // Hoy sigue a un toque, en el menú de abajo
      await page.getByRole('link', { name: 'Hoy', exact: true }).first().click()
      await expect(page).toHaveURL(/\/hoy$/)
      // y el logo regresa a la pantalla de su rol
      await page.getByTestId('home-link').click()
      await expect(page).toHaveURL(url)
    })
  }
})

test.describe('negocios cerrados', () => {
  test('quien lidera México filtra, ve totales que cuadran y exporta lo filtrado; queda en la bitácora', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'ana.robles', { stay: true })
    await page.getByTestId('team-closed-link').click()
    await expect(page).toHaveURL(/\/reportes\/cerrados/)
    await expect(page.locator('h1')).toHaveText('Negocios cerrados')
    // un periodo fijo, para que la prueba no dependa del día en que corre
    await page.goto('/reportes/cerrados?periodo=rango&desde=2026-01-01&hasta=2026-12-31')
    await expect(page.getByTestId('period-text')).toContainText('del 1 ene 2026 al 31 dic 2026')
    const won = int(await page.getByTestId('closed-won').innerText())
    const lost = int(await page.getByTestId('closed-lost').innerText())
    expect(won).toBeGreaterThan(0)
    expect(lost).toBeGreaterThan(0)
    await expect(page.getByTestId('filter-mercado')).toHaveCount(0) // un solo mercado: no hay nada que elegir
    await expect(page.getByTestId('closed-list')).not.toContainText('Dealer onboarding')

    await page.getByTestId('filter-resultado').selectOption({ label: 'Perdidos' })
    await expect(page).toHaveURL(/resultado=lost/)
    await expect(page.getByTestId('closed-won')).toHaveText('0')
    await expect(page.getByTestId('closed-lost')).toHaveText(String(lost))
    await expect(page.getByTestId('closed-row')).toHaveCount(lost)
    for (const row of await page.getByTestId('closed-row').all()) await expect(row).toHaveAttribute('data-status', 'lost')
    await expect(page.getByTestId('closed-row').first()).toContainText(/Precio o comisión|Se fue con un competidor|Sin decisión|No califica|Duplicado|No responde/)

    // por persona: el enlace filtra a esa persona
    await page.getByTestId('filter-resultado').selectOption({ label: 'Ganados y perdidos' })
    await page.getByTestId('filter-equipo').selectOption({ label: 'D2D Centro' })
    await expect(page).toHaveURL(/equipo=/)
    const people = page.getByTestId('closed-person')
    await expect(people.filter({ hasText: 'Marco Peña' })).toHaveCount(1)
    await expect(people.filter({ hasText: 'Diana Cruz' })).toHaveCount(0)
    await people.filter({ hasText: 'Marco Peña' }).getByRole('link').click()
    await expect(page).toHaveURL(/persona=/)
    await expect(page.getByTestId('closed-person')).toHaveCount(1)
    const marcoTotal = int(await page.getByTestId('closed-won').innerText()) + int(await page.getByTestId('closed-lost').innerText())

    // exportar lo filtrado
    const href = await page.getByTestId('export-csv').getAttribute('href')
    expect(href).toMatch(/^\/reportes\/cerrados\/export\?/)
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()])
    expect(download.suggestedFilename()).toBe('contigo-negocios-cerrados-2026-01-01-a-2026-12-31.csv')
    const res = await page.request.get(href!)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    const lines = (await res.text()).replace(/^﻿/, '').trimEnd().split('\r\n')
    expect(lines[0]).toBe('Comercio,Negocio,Mercado,Embudo,Equipo,Quién,Resultado,Fecha de cierre,Monto,Moneda,Motivo de pérdida')
    expect(lines.length - 1).toBe(marcoTotal)
    expect(lines.slice(1).every((l) => l.includes('Marco Peña') && l.includes('D2D Centro'))).toBe(true)
    expect(lines.join('\n')).not.toMatch(/@|\+52/)
    const ev = await lastExport()
    expect(ev).toMatchObject({ actor: 'Ana Robles', market_code: 'MX', after: { report: 'closed_deals', rows: marcoTotal, filters: { period: 'rango', from: '2026-01-01', to: '2026-12-31' } } })
    expect(ev!.after.filters.owner).toBeTruthy()
    expect(ev!.after.filters.team).toBeTruthy()

    // la bitácora lo dice en palabras
    await page.goto('/admin?tab=auditoria&tipo=exports') // "report." también lo usan los reportes del equipo: las exportaciones tienen su propio filtro
    await expect(page.getByTestId('admin-audit')).toContainText('Exportó un reporte')
    await expect(page.getByTestId('admin-audit')).toContainText(`Negocios cerrados · ${marcoTotal} filas`)
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('supervisión ve y exporta solo lo de su equipo; ventas y operaciones no entran', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/reportes/cerrados?periodo=rango&desde=2026-01-01&hasta=2026-12-31')
    await expect(page.getByTestId('closed-person').first()).toBeVisible()
    for (const row of await page.getByTestId('closed-person').all()) await expect(row).toContainText('D2D Centro')
    await expect(page.getByTestId('closed-list')).not.toContainText('Cadenas y distribuidores')
    const total = int(await page.getByTestId('closed-won').innerText()) + int(await page.getByTestId('closed-lost').innerText())
    const res = await page.request.get('/reportes/cerrados/export?periodo=rango&desde=2026-01-01&hasta=2026-12-31')
    expect(res.status()).toBe(200)
    expect((await res.text()).trimEnd().split('\r\n').length - 1).toBe(total)
    expect((await lastExport())!.actor).toBe('Fernando Ibarra')
    // un mercado ajeno en la URL no abre nada de más
    await page.goto('/reportes/cerrados?periodo=rango&desde=2026-01-01&hasta=2026-12-31&mercado=US')
    await expect(page.getByTestId('closed-list')).not.toContainText('Dealer onboarding')

    for (const persona of ['marco.pena', 'valeria.soto']) {
      await loginAs(page, persona)
      await expect(page.getByTestId('nav-closed')).toHaveCount(0)
      expect((await page.goto('/reportes/cerrados'))?.status(), persona).toBe(404)
      expect((await page.goto('/reportes/campo'))?.status(), persona).toBe(404)
      expect((await page.goto('/reportes/adopcion'))?.status(), persona).toBe(404)
      expect((await page.request.get('/reportes/cerrados/export')).status(), persona).toBe(404)
      expect((await page.request.get('/reportes/campo/export')).status(), persona).toBe(404)
    }
    await page.context().clearCookies()
    expect((await page.request.get('/reportes/cerrados/export', { maxRedirects: 0 })).status()).toBe(401)
  })
})

test.describe('panel del LT', () => {
  test('periodo, desglose por embudo y por equipo, definiciones y clic al detalle', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'luis.tovar', { stay: true })
    await expect(page.getByTestId('read-only')).toBeVisible()
    await expect(page.getByTestId('lt-windows')).toContainText('tres ventanas')
    await page.getByTestId('filter-periodo').selectOption({ label: 'Este trimestre' })
    await expect(page).toHaveURL(/periodo=trimestre/)
    await expect(page.getByTestId('period-text')).toContainText('Periodo: del 1 oct 2026')

    // D2D y B2B no van en una sola línea
    const pipes = page.getByTestId('lt-embudo-row')
    await expect(pipes.filter({ hasText: 'Alta de tiendas (D2D)' })).toHaveCount(1)
    await expect(pipes.filter({ hasText: 'Cadenas y distribuidores' })).toHaveCount(1)
    await expect(pipes.filter({ hasText: 'Dealer onboarding' })).toHaveCount(1)
    const teams = page.getByTestId('lt-equipo-row')
    await expect(teams.filter({ hasText: 'D2D Centro' })).toHaveCount(1)
    await expect(teams.filter({ hasText: 'B2B México' })).toHaveCount(1)

    // la definición está a un toque, con numerador y denominador
    const def = page.getByTestId('lt-attempt-all').getByTestId('def-attempt')
    await expect(def.getByText('Numerador')).toBeHidden()
    await def.locator('summary').click()
    await expect(def).toContainText('Numerador')
    await expect(def).toContainText('Denominador')
    await expect(def).toContainText('Ventana')
    await expect(def).toContainText('Fuente')

    // la tasa a la vista: valor, fecha y de dónde sale
    await expect(page.getByTestId('lt-fx')).toContainText('1 MXN = 0.05 USD')
    await expect(page.getByTestId('lt-fx')).toContainText('con fecha del')
    await expect(page.getByTestId('lt-fx')).toContainText('valor de ejemplo del ambiente de prueba')
    await expect(page.getByTestId('lt-volume-usd')).toContainText('USD')

    // el clic abre la lista que respalda la cifra, con el mismo periodo
    const won = int(await page.getByTestId('lt-won-link').innerText())
    await page.getByTestId('lt-won-link').click()
    await expect(page).toHaveURL(/\/reportes\/cerrados\?.*periodo=trimestre.*resultado=won/)
    await expect(page.getByTestId('closed-won')).toHaveText(new Intl.NumberFormat('es-MX').format(won))
    await expect(page.getByTestId('closed-lost')).toHaveText('0')

    await page.goto('/panel-lt?periodo=trimestre')
    const d2d = pipes.filter({ hasText: 'Alta de tiendas (D2D)' })
    const d2dWon = int(await d2d.getByTestId('lt-embudo-won').innerText())
    await d2d.getByTestId('lt-embudo-won').click()
    await expect(page).toHaveURL(/embudo=.*resultado=won|resultado=won.*embudo=/)
    await expect(page.getByTestId('closed-won')).toHaveText(new Intl.NumberFormat('es-MX').format(d2dWon))

    // por mercado: un filtro de mercado deja solo ese
    await page.goto('/panel-lt?mercado=US')
    await expect(page.getByTestId('lt-market-US')).toBeVisible()
    await expect(page.getByTestId('lt-market-MX')).toHaveCount(0)
    await expect(page.getByTestId('lt-fx')).toContainText('no se usa ninguna tasa')
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('sin tasa cargada no consolida y lo dice; administración la carga con fecha y fuente', async ({ page }) => {
    const sql = testDb()
    const saved = await sql`select currency, as_of, usd_rate, source, loaded_by, loaded_at from crm.fx_rates where currency = 'MXN'`
    try {
      await sql`delete from crm.fx_rates where currency = 'MXN'`
      await loginAs(page, 'luis.tovar', { stay: true })
      await expect(page.getByTestId('lt-fx-missing')).toContainText('No se consolida: falta la tasa de MXN a USD')
      await expect(page.getByTestId('lt-volume-usd')).toHaveText('s/d')
      await expect(page.getByTestId('lt-volume-usd').getByTestId('no-data')).toHaveAttribute('title', 'Sin dato')
      await expect(page.getByTestId('lt-market-MX')).toContainText('MXN') // el mercado sigue en su moneda
      // leadership ve la tasa en Administración, pero no la carga
      await page.goto('/admin?tab=embudos')
      await expect(page.getByTestId('fx-none')).toContainText('MXN: sin tasa cargada')
      await expect(page.getByTestId('fx-form')).toHaveCount(0)

      await loginAs(page, 'nora.salas', { stay: true })
      await page.goto('/admin?tab=embudos')
      const form = page.getByTestId('fx-form')
      await form.getByTestId('fx-date').fill('2026-11-02')
      await form.getByTestId('fx-rate').fill('0.0541')
      await form.getByTestId('fx-source').fill('Tasa de prueba del paquete liderazgo')
      await form.getByTestId('fx-save').click()
      await expect(page.getByTestId('fx-value')).toHaveText('1 MXN = 0.0541 USD')
      await expect(page.getByTestId('fx-meta')).toContainText('Tasa del 2 nov 2026. Fuente: Tasa de prueba del paquete liderazgo. La cargó Nora Salas.')
      // una tasa sin fuente o en cero no entra
      await page.waitForTimeout(800) // el formulario ignora un segundo envío inmediato después de guardar
      await form.getByTestId('fx-date').fill('2026-11-02')
      await form.getByTestId('fx-rate').fill('0')
      await form.getByTestId('fx-source').fill('Otra fuente')
      await form.getByTestId('fx-save').click()
      await expect(form.getByTestId('form-error')).toContainText('Revisa la tasa')

      await page.goto('/panel-lt')
      await expect(page.getByTestId('lt-fx')).toContainText('Tasa usada: 1 MXN = 0.0541 USD, con fecha del 2 nov 2026. Fuente: Tasa de prueba del paquete liderazgo.')
      await expect(page.getByTestId('lt-fx-missing')).toHaveCount(0)
      await page.goto('/admin?tab=auditoria&tipo=config')
      await expect(page.getByTestId('admin-audit')).toContainText('Cargó una tasa de cambio')
      await expect(page.getByTestId('admin-audit')).toContainText('1 MXN = 0.0541 USD, tasa del 2026-11-02')
    } finally {
      await sql`delete from crm.fx_rates where currency = 'MXN'`
      for (const r of saved) await sql`insert into crm.fx_rates ${sql(r)}`
      await sql.end()
    }
  })
})

test.describe('adopción', () => {
  test('leadership ve quién entró, cuándo fue la última vez y cuántas actividades registró; supervisión no', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await loginAs(page, 'luis.tovar', { stay: true })
    await page.getByTestId('lt-adoption-link').click()
    await expect(page.locator('h1')).toHaveText('Adopción')
    const people = int(await page.getByTestId('adoption-people').innerText())
    await expect(page.getByTestId('adoption-row')).toHaveCount(people)
    const marco = page.getByTestId('adoption-row').filter({ hasText: 'Marco Peña' })
    await expect(marco).toContainText('Ventas · MX · D2D Centro')
    expect(int(await marco.getByTestId('adoption-logins').innerText())).toBeGreaterThan(0)
    await expect(marco.getByTestId('adoption-last')).not.toContainText('Nunca')
    await expect(page.getByTestId('adoption-list')).not.toContainText('CONTIGO (sistema)')
    const never = int(await page.getByTestId('adoption-never').innerText())
    await page.getByTestId('pill-nunca').click()
    await expect(page).toHaveURL(/ver=nunca/)
    await expect(page.getByTestId('adoption-row')).toHaveCount(never)
    for (const row of await page.getByTestId('adoption-row').all()) await expect(row.getByTestId('adoption-last')).toContainText('Nunca ha entrado')

    // quien lidera México ve solo a la gente de México
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/adopcion')
    await expect(page.getByTestId('adoption-row').filter({ hasText: 'Marco Peña' })).toHaveCount(1)
    await expect(page.getByTestId('adoption-row').filter({ hasText: 'Sam Ortiz' })).toHaveCount(0)
    await expect(page.getByTestId('adoption-row').filter({ hasText: 'Nora Salas' })).toHaveCount(0)

    await loginAs(page, 'fernando.ibarra')
    expect((await page.goto('/reportes/adopcion'))?.status()).toBe(404)
  })
})

test.describe('Mi equipo', () => {
  test('quien lidera ve todos los equipos con subtotal y 8 semanas de resultados; la tabla cabe en 1440', async ({ page }) => {
    await loginAs(page, 'ana.robles', { stay: true })
    const groups = page.getByTestId('team-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.nth(0).getByTestId('team-name')).toHaveText('B2B México')
    await expect(groups.nth(1).getByTestId('team-name')).toHaveText('D2D Centro')
    // Marco y Lucía siempre; quien supervisa el equipo aparece además si otra prueba de la corrida le dejó registros propios.
    for (const name of ['Marco Peña', 'Lucía Vega']) await expect(groups.nth(1).getByTestId('rep-row').filter({ hasText: name })).toHaveCount(1)
    expect(await groups.nth(1).getByTestId('rep-row').count()).toBeLessThanOrEqual(3)
    // el subtotal suma la cartera de las personas del equipo
    const books = await groups.nth(1).getByTestId('rep-row').locator('a[href^="/comercios?"]').allInnerTexts()
    await expect(groups.nth(1).getByTestId('subtotal-accounts')).toHaveText(String(books.reduce((n, x) => n + int(x), 0)))
    // cabe sin desplazamiento horizontal
    await expect(page.getByTestId('rep-head')).toBeVisible()
    const fits = await page.getByTestId('rep-table').evaluate((el) => el.scrollWidth <= el.clientWidth && [...el.querySelectorAll('[data-testid="rep-row"] > span')].every((c) => c.scrollWidth <= c.clientWidth + 1))
    expect(fits).toBe(true)
    await noOverflow(page, 'mi equipo 1440')
    // las ventas de la cartera dicen su ventana
    await expect(page.getByTestId('team-board')).toContainText('transacciones de su cartera en los últimos 30 días al')
    await expect(page.getByTestId('rep-sales-delta').first()).toContainText('%')

    // 8 semanas, la primera en curso
    await expect(page.getByTestId('week-row')).toHaveCount(8)
    await expect(page.getByTestId('week-row').first()).toContainText('en curso')
    const visits = (await page.getByTestId('week-visits').allInnerTexts()).reduce((n, x) => n + int(x), 0)
    expect(visits).toBeGreaterThan(0)

    // filtrar por equipo deja un solo grupo
    await page.getByTestId('team-select').selectOption({ label: 'B2B México' })
    await expect(page).toHaveURL(/equipo=/)
    await expect(page.getByTestId('team-group')).toHaveCount(1)
    await expect(page.getByTestId('rep-table')).not.toContainText('Marco Peña')
  })

  test('en 390 px cada persona se lee como tarjeta, con su nombre y cada cifra con etiqueta', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/supervisor')
    await expect(page.getByTestId('team-group')).toHaveCount(1)
    for (const name of ['Marco Peña', 'Lucía Vega']) await expect(page.getByTestId('rep-row').filter({ hasText: name })).toHaveCount(1)
    expect(await page.getByTestId('rep-row').count()).toBeLessThanOrEqual(3) // la tercera es quien supervisa, si lleva registros propios
    await expect(page.getByTestId('rep-head')).toBeHidden()
    for (const row of await page.getByTestId('rep-row').all()) {
      await expect(row.getByTestId('rep-name')).toBeVisible()
      await expect(row).toContainText('Leads abiertos')
      await expect(row).toContainText('Visitas / con venta')
      await expect(row).toContainText('Cartera')
      const box = await row.boundingBox()
      expect(box!.width).toBeLessThanOrEqual(390)
    }
    await expect(page.getByTestId('week-row')).toHaveCount(8)
    await noOverflow(page, 'mi equipo 390')
  })

  test('operaciones ve los avisos y la bitácora de su mercado, sin el tablero de ventas', async ({ page }) => {
    await loginAs(page, 'valeria.soto')
    await openMenu(page)
    await expect(page.getByTestId('nav-supervisor')).toHaveCount(0)
    await page.getByTestId('nav-alerts').click()
    await expect(page.locator('h1')).toHaveText('Avisos del mercado')
    await expect(page.getByTestId('exception-queue')).toBeVisible()
    await expect(page.getByTestId('team-board')).toHaveCount(0)
    await expect(page.getByTestId('team-weeks')).toHaveCount(0)
    await expect(page.getByTestId('run-rules')).toHaveCount(0)
    await page.goto('/admin?tab=auditoria&tipo=all')
    await expect(page.getByTestId('admin-audit')).toBeVisible()
    await expect(page.getByTestId('admin-audit')).not.toContainText(' · US')
    // sigue sin configurar nada
    await page.goto('/admin?tab=personas')
    await expect(page.getByTestId('tab-hidden')).toBeVisible()
    // leadership ve la cola completa, sin poder descartar
    await loginAs(page, 'luis.tovar')
    await page.goto('/supervisor')
    await expect(page.getByTestId('exception-row').first()).toBeVisible()
    await expect(page.getByTestId('exception-dismiss')).toHaveCount(0)
  })
})

test.describe('filtros por persona, equipo y embudo', () => {
  test('el tablero de negocios se filtra por persona y por equipo', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/pipelines')
    await expect(page.getByTestId('board-summary')).toBeVisible()
    const all = int((await page.getByTestId('board-summary').innerText()).split('·')[0]!)
    await page.getByTestId('board-person').selectOption({ label: 'Marco Peña' })
    await expect(page).toHaveURL(/owner=[0-9a-f-]{36}/)
    const marco = int((await page.getByTestId('board-summary').innerText()).split('·')[0]!)
    expect(marco).toBeGreaterThan(0)
    expect(marco).toBeLessThan(all)
    await page.getByTestId('view-list').click()
    for (const row of (await page.getByTestId('deal-list-row').all()).slice(0, 10)) await expect(row).toContainText('Marco Peña')
    await page.getByTestId('board-person').selectOption({ label: 'Todas las personas' })
    await page.getByTestId('board-team').selectOption({ label: 'D2D Centro' })
    await expect(page).toHaveURL(/equipo=[0-9a-f-]{36}/)
    const team = int((await page.getByTestId('board-summary').innerText()).split('·')[0]!)
    expect(team).toBeGreaterThanOrEqual(marco)
    expect(team).toBeLessThanOrEqual(all)
    // el embudo se cambia sin perder el filtro
    // el conteo entre paréntesis cambia con lo que otras pruebas crean: se elige por nombre
    const b2bOption = await page.getByTestId('pipeline-select').locator('option', { hasText: /^Cadenas y distribuidores \(\d+\)$/ }).first().getAttribute('value')
    await page.getByTestId('pipeline-select').selectOption(b2bOption!)
    await expect(page).toHaveURL(/equipo=/)
    // quien vende no ve estos filtros
    await loginAs(page, 'marco.pena')
    await page.goto('/pipelines')
    await expect(page.getByTestId('board-summary')).toBeVisible()
    await expect(page.getByTestId('board-person')).toHaveCount(0)
    await expect(page.getByTestId('board-team')).toHaveCount(0)
  })

  test('Comercios se filtra por equipo y por embudo', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/comercios')
    await page.getByTestId('place-filters-toggle').click()
    await page.getByTestId('filter-team').selectOption({ label: 'B2B México' })
    await page.getByTestId('place-apply').click()
    await expect(page).toHaveURL(/team=[0-9a-f-]{36}/)
    const rows = page.getByTestId('account-row')
    await expect(rows.first()).toBeVisible()
    // Diana e Iván llevan 3 comercios cada uno en el seed; otras pruebas de la corrida les crean más, así que se cuenta en la base.
    const db = testDb()
    const mine = await db<{ n: number }[]>`
      select count(*)::int as n from crm.accounts a where a.archived_at is null and a.market_code = 'MX' and exists (
        select 1 from crm.memberships m join crm.teams t on t.id = m.team_id where m.user_id = a.owner_id and t.name = 'B2B México' and (m.valid_to is null or m.valid_to > now()))`
    await db.end()
    expect(mine[0]!.n).toBeGreaterThanOrEqual(6)
    expect(await rows.count()).toBeLessThanOrEqual(mine[0]!.n)
    await expect(page.getByTestId('account-table')).not.toContainText('Marco Peña')
    await page.getByTestId('filter-team').selectOption({ label: 'Todos' })
    await page.getByTestId('filter-pipeline').selectOption({ label: 'Cadenas y distribuidores' })
    await page.getByTestId('place-apply').click()
    await expect(page).toHaveURL(/pipeline=[0-9a-f-]{36}/)
    await expect(rows.first()).toBeVisible()
    // comercios con algún negocio en ese embudo: también se cuenta en la base, por la misma razón
    const db2 = testDb()
    const inPipe = await db2<{ n: number }[]>`
      select count(distinct d.account_id)::int as n from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.accounts a on a.id = d.account_id
       where p.market_code = 'MX' and p.name = 'Cadenas y distribuidores' and a.archived_at is null`
    await db2.end()
    expect(await rows.count()).toBeLessThanOrEqual(inPipe[0]!.n)
    await page.getByTestId('place-clear').click()
    await expect(page).not.toHaveURL(/pipeline=/)
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios')
    await page.getByTestId('place-filters-toggle').click()
    await expect(page.getByTestId('filter-team')).toHaveCount(0)
  })
})

test.describe('reporte semanal de campo', () => {
  test('altas y ganados por territorio o plaza, visitas por persona, y el mismo exportar auditado', async ({ page }) => {
    await loginAs(page, 'ana.robles', { stay: true })
    await page.getByTestId('team-field-link').click()
    await expect(page.locator('h1')).toHaveText('Reporte semanal de campo')
    await expect(page.getByTestId('field-totals')).toBeVisible()
    // una semana completa: la anterior
    await page.locator('[data-testid^="pill-20"]').nth(1).click()
    await expect(page).toHaveURL(/semana=\d{4}-\d{2}-\d{2}/)
    const visits = int(await page.getByTestId('field-visits').innerText())
    expect(visits).toBeGreaterThan(0)
    const byPerson = (await page.getByTestId('field-person-row').allInnerTexts()).length
    expect(byPerson).toBeGreaterThan(0)
    await expect(page.getByTestId('field-people')).toContainText('D2D Centro')
    await page.getByTestId('pill-plaza').click()
    await expect(page).toHaveURL(/por=plaza/)
    await expect(page.getByTestId('field-places')).toContainText('Por plaza')

    const href = await page.getByTestId('export-visits').getAttribute('href')
    const res = await page.request.get(href!)
    expect(res.status()).toBe(200)
    const lines = (await res.text()).replace(/^﻿/, '').trimEnd().split('\r\n')
    expect(lines[0]).toBe('Semana (lunes),Mercado,Equipo,Persona,Visitas,Visitas con venta')
    expect(lines.length).toBeGreaterThan(1)
    expect(await lastExport()).toMatchObject({ actor: 'Ana Robles', market_code: 'MX', after: { report: 'field_visits', rows: lines.length - 1, filters: { weeks: 8, by: 'plaza' } } })
    const stores = await page.request.get((await page.getByTestId('export-stores').getAttribute('href'))!)
    expect((await stores.text()).replace(/^﻿/, '').split('\r\n')[0]).toBe('Semana (lunes),Mercado,Plaza,Puntos de venta dados de alta,Negocios ganados')
    expect((await lastExport())!.after.report).toBe('field_stores')
  })
})

test.describe('ventas por tienda', () => {
  test('la ficha dice la ventana y compara con los 30 días anteriores solo si ese dato existe', async ({ page }) => {
    const sql = testDb()
    const [withPrev] = await sql<{ id: string }[]>`
      select a.id from crm.accounts a join crm.users u on u.id = a.owner_id where u.full_name = 'Marco Peña' and a.kind = 'store'
         and (select count(*) from crm.merchant_metrics_daily m where m.account_id = a.id) = 2 order by a.id limit 1`
    const [noPrev] = await sql<{ id: string }[]>`
      select a.id from crm.accounts a join crm.users u on u.id = a.owner_id where u.full_name = 'Marco Peña' and a.kind = 'store'
         and (select count(*) from crm.merchant_metrics_daily m where m.account_id = a.id) = 1 order by a.id limit 1`
    await sql.end()
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${withPrev!.id}?tab=datos`)
    await expect(page.locator('main')).toContainText(/Ventas, últimos 30 días al \d+ \w+ 2026/)
    await expect(page.getByTestId('fact-sales')).toContainText(/\d+ transacci(ón|ones) · MXN/)
    await expect(page.getByTestId('fact-sales')).toContainText('días con venta')
    await expect(page.getByTestId('fact-sales-prev')).toContainText(/\d+ transacci(ón|ones) · MXN.* · ahora [+-]?\d+% · al \d+ \w+ 2026/)
    await page.goto(`/comercios/${noPrev!.id}?tab=datos`)
    await expect(page.getByTestId('fact-sales-prev')).toHaveText('No hay dato de ese periodo')
  })
})

for (const w of WIDTHS) {
  test.describe(`pantallas de liderazgo en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })
    test('abren, nada se sale del ancho y axe no encuentra hallazgos serios', async ({ page }) => {
      await loginAs(page, 'luis.tovar')
      for (const [path, name] of [
        ['/panel-lt', 'panel'],
        ['/panel-lt?periodo=rango&desde=2026-10-01&hasta=2026-10-31', 'panel rango'],
        ['/reportes/cerrados?periodo=rango&desde=2026-01-01&hasta=2026-12-31', 'cerrados'],
        ['/reportes/campo', 'campo'],
        ['/reportes/adopcion', 'adopcion'],
        ['/supervisor', 'mi equipo'],
        ['/admin?tab=embudos', 'tasa'],
      ] as const) {
        const res = await page.goto(path)
        expect(res?.status(), path).toBeLessThan(400)
        await expect(page.locator('h1').first(), path).toBeVisible()
        await noOverflow(page, `${w.name} ${name}`)
        await axeClean(page, `${w.name} ${name}`)
      }
      // con una definición abierta tampoco se sale
      await page.goto('/panel-lt')
      await page.getByTestId('lt-won').locator('summary').click()
      await noOverflow(page, `${w.name} definición abierta`)
      // los objetivos táctiles de los filtros y de "Cómo se calcula" miden al menos 44 px
      for (const el of [page.getByTestId('filter-periodo'), page.getByTestId('lt-won').locator('summary'), page.getByTestId('lt-closed-link')]) {
        const box = await el.boundingBox()
        expect(box!.height, `${w.name} objetivo táctil`).toBeGreaterThanOrEqual(44)
      }
    })
  })
}
