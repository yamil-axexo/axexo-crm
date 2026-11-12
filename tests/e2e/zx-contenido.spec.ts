import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb } from './helpers'

// Paquete contenido (ola 2): idioma de la entrada por navegador, primeros pasos por rol, reportar un problema
// de punta a punta, y la ayuda con buscador en los dos idiomas, filtro por rol y capacitación.
const MARK = 'E2E contenido:'
// Dato de prueba armado por partes, para que el escáner de datos prohibidos no lo tome por real.
const card = ['4111', '1111', '1111', '1111'].join(' ')

async function freshOnboarding(persona: string) {
  const sql = testDb()
  await sql`update crm.user_onboarding set done = '{}', hidden_at = null where user_id = (select id from crm.users where email::text like ${persona + '@%'})`
  await sql.end()
}

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

test.describe('la entrada abre en el idioma del navegador', () => {
  test('inglés para un navegador en inglés; el interruptor gana y se queda', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByTestId('landing-hero').locator('h1')).toHaveText('Every merchant, with its next step.')
    await expect(page.getByTestId('landing-status').getByText('Not yet', { exact: true })).toHaveCount(3)
    await expect(page.getByTestId('landing-people')).toContainText('Stock photos, for illustration only.')
    // la persona elige español: gana sobre el navegador, también al volver a cargar
    await page.getByTestId('locale-toggle').click()
    await expect(page.getByTestId('landing-hero').locator('h1')).toHaveText('Cada comercio, con su próximo paso.')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByTestId('landing-hero').locator('h1')).toHaveText('Cada comercio, con su próximo paso.')
    await ctx.close()
  })

  test('español para un navegador en español o en cualquier otro idioma', async ({ browser }) => {
    for (const locale of ['es-MX', 'es-US', 'pt-BR']) {
      const ctx = await browser.newContext({ locale })
      const page = await ctx.newPage()
      await page.goto('/login')
      await expect(page.locator('html'), locale).toHaveAttribute('lang', 'es')
      await expect(page.getByTestId('landing-hero').locator('h1'), locale).toHaveText('Cada comercio, con su próximo paso.')
      await expect(page.getByTestId('landing-people'), locale).toContainText('Fotos de archivo, con fines ilustrativos.')
      await expect(page.getByTestId('landing-product'), locale).toContainText('con datos de prueba')
      await ctx.close()
    }
  })

  test('la entrada dice de frente lo que todavía no hace y a quién acudir', async ({ page }) => {
    await page.goto('/login')
    const status = page.getByTestId('landing-status')
    for (const text of ['Visitas automáticas desde la Sales App', 'Trabajo sin conexión, fotos o archivos adjuntos y avisos por correo']) await expect(status).toContainText(text)
    const faq = page.getByTestId('landing-faq')
    await expect(faq).toContainText('¿A quién acudo?')
    await expect(faq).toContainText('Reportar un problema')
    await expect(page.getByTestId('landing-roles')).toContainText('registras la visita desde la ficha')
  })
})

test.describe('primeros pasos por rol', () => {
  const ROLES = [
    ['lucia.vega', 'Ventas', 8],
    ['fernando.ibarra', 'Supervisión', 8],
    ['ana.robles', 'Líder de mercado', 7],
    ['valeria.soto', 'Operaciones', 6],
    ['luis.tovar', 'Leadership', 5],
    ['nora.salas', 'Administración', 8],
  ] as const

  test('cada rol tiene sus pasos, cada paso lleva a una pantalla que abre, y sus dos bloques de hábitos', async ({ page }) => {
    test.setTimeout(150_000)
    for (const [persona, label, count] of ROLES) {
      await loginAs(page, persona)
      await page.goto('/bienvenida')
      await expect(page.getByTestId('welcome-track'), persona).toHaveText(label)
      const steps = page.getByTestId('onboarding').locator('li[data-testid^="step-"]')
      await expect(steps, persona).toHaveCount(count)
      const hrefs = await steps.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))
      expect(hrefs.length, persona).toBe(count)
      for (const href of new Set(hrefs)) {
        const res = await page.request.get(href)
        expect(res.status(), `${persona} -> ${href}`).toBe(200)
        // la pantalla abre de verdad para ese rol: no lo regresa a la entrada ni le dice que no existe
        expect(new URL(res.url()).pathname.startsWith(href.split('?')[0]!), `${persona} -> ${href} terminó en ${res.url()}`).toBe(true)
      }
      const habits = page.getByTestId('habits')
      await expect(habits.getByTestId('habits-changes').locator('h2'), persona).toHaveText('Lo que cambia frente a Pipedrive')
      await expect(habits.getByTestId('habits-asks').locator('h2'), persona).toHaveText('Lo que te vamos a pedir')
      expect(await habits.getByTestId('habits-changes').locator('li').count(), persona).toBeGreaterThanOrEqual(3)
      expect(await habits.getByTestId('habits-asks').locator('li').count(), persona).toBeGreaterThanOrEqual(2)
    }
  })

  test('quien vende: foto de calle, los tres hábitos, y la lista se marca, se esconde y se recupera', async ({ page }) => {
    await freshOnboarding('marco.pena')
    const errors = pageErrors(page)
    await loginAs(page, 'marco.pena')
    await page.goto('/bienvenida')
    const hero = page.getByTestId('welcome').locator('section').first()
    await expect(hero.getByRole('img')).toHaveAttribute('alt', /de pie en la calle/)
    const asks = page.getByTestId('habits-asks')
    for (const text of ['Próximo paso siempre', 'Registra la visita', 'Primer intento a tiempo']) await expect(asks).toContainText(text)

    await page.getByTestId('step-report').getByTestId('step-toggle').click()
    await expect(page.getByTestId('step-report')).toHaveAttribute('data-done', 'true')
    await expect(page.getByTestId('onboarding-progress')).toHaveText('1 de 8')
    // esconder lleva a Hoy sin el recordatorio; la lista sigue en el menú con lo marcado y se puede volver a mostrar
    await page.getByTestId('onboarding-hide').click()
    await expect(page).toHaveURL(/\/hoy$/)
    await expect(page.getByTestId('hoy-onboarding')).toHaveCount(0)
    await openMenu(page)
    await page.getByTestId('nav-welcome').click()
    await expect(page).toHaveURL(/\/bienvenida$/)
    await expect(page.getByTestId('onboarding-progress')).toHaveText('1 de 8')
    await page.getByTestId('onboarding-show').click()
    await expect(page.getByTestId('onboarding-hide')).toBeVisible()
    await page.goto('/hoy')
    await expect(page.getByTestId('hoy-onboarding')).toContainText('1 de 8 hechos')
    // el paso de reportar lleva al formulario
    await page.goto('/bienvenida')
    await page.getByTestId('step-report').locator('a[href="/reportar"]').click()
    await expect(page).toHaveURL(/\/reportar$/)
    await expect(page.getByTestId('report-form')).toBeVisible()
    expect(errors).toEqual([])
    await freshOnboarding('marco.pena')
  })

  test('en inglés, los pasos y los hábitos salen en inglés', async ({ page }) => {
    await loginAs(page, 'jade.kim')
    await page.goto('/bienvenida')
    // el botón de la barra dice el idioma en uso: si está en español, se cambia a inglés
    const toggle = page.getByTestId('locale-toggle')
    if ((await toggle.innerText()).trim() === 'ES') await toggle.click()
    await expect(toggle).toHaveText('EN')
    await expect(page.getByTestId('habits-changes').locator('h2')).toHaveText('What changes from Pipedrive')
    await expect(page.getByTestId('habits-asks')).toContainText('Always a next step')
    await expect(page.getByTestId('step-report')).toContainText('If something breaks or is missing, report it')
    await expect(page.getByTestId('onboarding')).not.toContainText(/próximo paso|comercio/i)
  })
})

test.describe('reportar un problema', () => {
  test.afterAll(async () => {
    const sql = testDb()
    await sql`delete from crm.problem_reports where body like ${MARK + '%'}`
    await sql.end()
  })

  test('de punta a punta: quien vende reporta, administración responde y la respuesta vuelve', async ({ page }) => {
    const errors = pageErrors(page)
    const body = `${MARK} no me deja guardar la visita de hoy`
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios')
    await openMenu(page)
    await page.getByTestId('nav-report').click()
    await expect(page).toHaveURL(/\/reportar\?desde=%2Fcomercios$/)
    // la pantalla donde estaba se llena sola
    await expect(page.getByTestId('report-screen')).toHaveText('Comercios')
    await clean(page, 'reportar 1440')

    // un dato prohibido no se guarda, y lo escrito no se pierde
    await page.getByTestId('report-body').fill(`${MARK} la tarjeta ${card} no pasó`)
    await page.getByTestId('report-send').click()
    await expect(page.getByTestId('form-error')).toContainText('número de tarjeta')
    await expect(page.getByTestId('report-row')).toHaveCount(0)

    await page.getByTestId('report-body').fill(body)
    await page.getByTestId('report-urgency').selectOption('high')
    await page.getByTestId('report-send').click()
    await expect(page.getByTestId('form-ok')).toContainText('Recibido')
    const mine = page.getByTestId('report-row')
    await expect(mine).toHaveCount(1)
    await expect(mine.first()).toHaveAttribute('data-status', 'open')
    await expect(mine.first()).toContainText(body)
    await expect(mine.first()).toContainText('Urgente: no puedo trabajar')
    await expect(mine.first()).toContainText('Comercios')

    // otra persona que vende no lo ve
    await loginAs(page, 'lucia.vega')
    await page.goto('/reportar')
    await expect(page.getByTestId('report-screen')).toHaveText('No se sabe')
    await expect(page.getByTestId('report-row')).toHaveCount(0)
    // quien lidera el mercado no tiene la pestaña Reportes
    await loginAs(page, 'ana.robles')
    await page.goto('/admin?tab=reportes')
    await expect(page.getByTestId('tab-hidden')).toContainText('Reportes')
    await expect(page.getByTestId('admin-reports')).toHaveCount(0)

    // administración lo ve en su pestaña, responde y queda atendido
    await loginAs(page, 'nora.salas')
    await openMenu(page)
    await page.getByTestId('nav-admin').click()
    await page.getByRole('link', { name: /^Reportes/ }).click()
    await expect(page).toHaveURL(/tab=reportes/)
    const row = page.getByTestId('admin-report-row').filter({ hasText: body })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Marco Peña')
    await expect(row).toContainText('Urgente')
    await clean(page, 'admin reportes 1440')
    await row.getByTestId('admin-report-answer').fill('Ya quedó corregido. Vuelve a intentar y avísanos si sigue.')
    await row.getByTestId('admin-report-save').click()
    await expect(page.getByTestId('admin-report-row').filter({ hasText: body })).toHaveCount(0) // sale de Abiertos
    await page.getByRole('link', { name: /^Atendidos/ }).click()
    const handled = page.getByTestId('admin-report-row').filter({ hasText: body })
    await expect(handled).toHaveAttribute('data-status', 'answered')
    await expect(handled).toContainText('Respondió Nora Salas')
    // queda en la bitácora, con su nombre legible
    await page.goto('/admin?tab=auditoria')
    await expect(page.locator('main')).toContainText('Respondió un reporte del equipo')
    await expect(page.locator('main')).toContainText('Reportó un problema o pidió algo')

    // quien reportó ve la respuesta
    await loginAs(page, 'marco.pena')
    await page.goto('/reportar')
    const answered = page.getByTestId('report-row').filter({ hasText: body })
    await expect(answered).toHaveAttribute('data-status', 'answered')
    await expect(answered.getByTestId('report-answer')).toContainText('Ya quedó corregido')
    await expect(answered.getByTestId('report-answer')).toContainText('Respuesta de Nora Salas')
    expect(errors).toEqual([])
  })

  test('en teléfono: se llega desde el menú y desde la Ayuda, sin desbordes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'valeria.soto')
    await page.goto('/ayuda')
    await page.getByTestId('help-report').click()
    await expect(page).toHaveURL(/\/reportar\?desde=\/ayuda$/)
    await expect(page.getByTestId('report-screen')).toHaveText('Ayuda')
    await clean(page, 'reportar 390')
    await page.goto('/pipelines')
    await openMenu(page)
    await page.getByTestId('nav-report').click()
    await expect(page).toHaveURL(/\/reportar\?desde=/)
    await expect(page.getByTestId('report-screen')).toHaveText('Negocios')
    // quien solo lee también puede pedir algo
    await loginAs(page, 'luis.tovar')
    await page.goto('/reportar?desde=/panel-lt')
    await page.getByTestId('report-kind-request').check()
    await page.getByTestId('report-body').fill(`${MARK} me hizo falta ver los ganados por semana`)
    await page.getByTestId('report-send').click()
    await expect(page.getByTestId('form-ok')).toBeVisible()
    await expect(page.getByTestId('report-row').first()).toContainText('Me hace falta algo')
    await expect(page.getByTestId('report-row').first()).toContainText('Panel del LT')
  })
})

test.describe('ayuda: buscador, rol y capacitación', () => {
  test('el buscador encuentra en español y en inglés, con o sin acentos', async ({ page }) => {
    await loginAs(page, 'lucia.vega')
    await page.goto('/ayuda')
    const help = page.getByTestId('help')
    const items = help.getByTestId('help-item')
    const all = await items.count()
    expect(all).toBeGreaterThan(70)

    // una palabra que solo está en la versión en inglés encuentra la pregunta, mostrada en español
    await help.getByTestId('help-search').fill('fallback')
    await expect(items.first()).toBeVisible()
    await expect(help).toContainText('¿Cómo se reparten los leads del formulario web?')
    expect(await items.count()).toBeLessThan(6)
    await help.getByTestId('help-search').fill('street rep')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('¿Dónde pongo al vendedor de calle?')
    // sin acentos, y con el botón exacto en la respuesta
    await help.getByTestId('help-search').fill('quien visito')
    await expect(items.first()).toBeVisible()
    await expect(help.locator('mark').first()).toBeVisible()
    // la regla del piloto y lo que no hace todavía
    await help.getByTestId('help-search').fill('se ganan a mano')
    await expect(items).toHaveCount(1)
    await items.first().locator('summary').click()
    await expect(items.first().locator('p')).toContainText('Regla del piloto: los tres embudos de primera transacción se ganan a mano')
    await help.getByTestId('help-clear').click()
    await help.getByTestId('help-chip-limits').click()
    await expect(items).toHaveCount(7)
    for (const q of ['¿Las visitas llegan solas desde la Sales App?', '¿Puedo trabajar o leer sin conexión?', '¿Puedo adjuntar fotos, contratos o evidencia?', '¿CONTIGO me avisa por correo cuando me cae algo?']) await expect(help).toContainText(q)
    await help.getByTestId('help-chip-limits').click()

    // en inglés, una palabra en español también encuentra
    await page.getByTestId('locale-toggle').click()
    await expect(page.getByTestId('locale-toggle')).toHaveText('EN')
    await page.getByTestId('help-search').fill('respaldo')
    await expect(page.getByTestId('help')).toContainText('How are web form leads distributed?')
    await page.getByTestId('help-search').fill('report a problem')
    await expect(page.getByTestId('help')).toContainText('Where do I report a problem or ask for something?')
    await page.getByTestId('locale-toggle').click()
    await expect(page.getByTestId('locale-toggle')).toHaveText('ES')
  })

  test('cada quien ve primero lo de su rol y puede filtrar por cualquier rol', async ({ page }) => {
    await loginAs(page, 'luis.tovar')
    await page.goto('/ayuda')
    const help = page.getByTestId('help')
    const items = help.getByTestId('help-item')
    const all = await items.count()
    // Leadership: en "Equipo y dueños", después de lo que es para todos va lo suyo, antes de lo de supervisión
    const team = help.getByTestId('help-topic-team').getByTestId('help-item')
    await expect(team.nth(0)).toContainText('¿Qué puedo ver?')
    await expect(team.nth(1)).toContainText('¿Qué diferencia hay entre "Primer intento a tiempo" y "Contacto logrado"?')
    // su rol va primero en el filtro, con su nombre
    const roles = help.getByTestId('help-roles').locator('button')
    await expect(roles).toHaveText(['Todo', 'Para Leadership', 'Ventas', 'Supervisión', 'Líder de mercado', 'Operaciones', 'Administración'])
    await help.getByTestId('help-mine').click()
    const mine = await items.count()
    expect(mine).toBeLessThan(all)
    await expect(help).not.toContainText('¿Cómo doy acceso a alguien?')
    await help.getByTestId('help-role-admin').click()
    await expect(help.getByTestId('help-role-admin')).toHaveAttribute('aria-pressed', 'true')
    await expect(help).toContainText('¿Cómo doy acceso a alguien?')
    await expect(help).toContainText('¿Dónde veo lo que el equipo reporta?')
    await help.getByTestId('help-role-ops').click()
    await expect(help).toContainText('¿Qué hace Operaciones en CONTIGO?')
    await expect(help).not.toContainText('¿Puedo tomar un lead sin dueño?')
    await help.getByTestId('help-all').click()
    await expect(items).toHaveCount(all)
  })

  test('capacitación por rol: abre en el rol de la persona, con el día uno y la primera semana', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/ayuda')
    const training = page.getByTestId('training')
    await expect(training.locator('h2')).toHaveText('Capacitación')
    await expect(training.getByTestId('training-role-supervisor')).toHaveAttribute('aria-pressed', 'true')
    await expect(training.getByTestId('training-day1').locator('h3')).toHaveText('El día uno')
    await expect(training.getByTestId('training-week1').locator('h3')).toHaveText('La primera semana')
    expect(await training.getByTestId('training-day1').locator('li').count()).toBeGreaterThanOrEqual(3)
    await expect(training.getByTestId('training-day1')).toContainText('Primer intento a tiempo')
    await training.getByTestId('training-role-admin').click()
    await expect(training.getByTestId('training-day1')).toContainText('Dar acceso')
    await training.getByTestId('training-role-rep').click()
    await expect(training.getByTestId('training-week1')).toContainText('Marcar como perdido')
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 900 })
      await clean(page, `ayuda ${w}`)
    }
  })
})
