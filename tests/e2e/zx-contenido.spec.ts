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
    for (const text of ['Visitas automáticas desde la Sales App', 'Primera venta y ventas de cada comercio desde los datos de ventas', 'Trabajo sin conexión, fotos o archivos adjuntos, mapa, app instalable y avisos por correo o Slack']) await expect(status).toContainText(text)
    // lo que entró en la ola 2 ya figura como funcionando, y la regla del piloto va con las palabras del producto
    for (const text of ['Cola de Operaciones y pedidos con líneas de producto', 'Negocios cerrados y reporte semanal de campo, con exportación']) await expect(status).toContainText(text)
    await expect(status.getByText('Todavía no', { exact: true })).toHaveCount(3)
    await expect(page.getByTestId('landing-rule')).toHaveText('En el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola.')
    await expect(page.getByTestId('landing-roles')).toContainText('Tu cola: lo que Ventas entregó')
    const faq = page.getByTestId('landing-faq')
    await expect(faq).toContainText('¿A quién acudo?')
    await expect(faq).toContainText('Reportar un problema')
    await expect(page.getByTestId('landing-roles')).toContainText('registras la visita desde la ficha')
  })
})

test.describe('primeros pasos por rol', () => {
  const ROLES = [
    ['lucia.vega', 'Ventas', 8],
    ['fernando.ibarra', 'Supervisión', 9], // ola 4: supervisión suma su número semanal
    ['ana.robles', 'Líder de mercado', 7],
    ['valeria.soto', 'Operaciones', 6],
    ['luis.tovar', 'Leadership', 5],
    ['nora.salas', 'Administración', 9], // ola 4: administración suma la pestaña de Pipedrive
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

test.describe('pasada final (ola 3): cada rol empieza en su pantalla y la ayuda cubre lo integrado', () => {
  const HOMES = [
    ['lucia.vega', '/hoy', 'Ir a Hoy'],
    ['fernando.ibarra', '/hoy', 'Ir a Hoy'],
    ['ana.robles', '/supervisor', 'Ir a Mi equipo'],
    ['valeria.soto', '/operaciones', 'Ir a mi cola'],
    ['luis.tovar', '/panel-lt', 'Ir al Panel del LT'],
    ['nora.salas', '/admin', 'Ir a Administración'],
  ] as const

  test('el primer paso de cada rol lleva a la pantalla donde aterriza, y el botón del final también', async ({ page }) => {
    test.setTimeout(120_000)
    for (const [persona, home, go] of HOMES) {
      await loginAs(page, persona, { stay: true })
      expect(new URL(page.url()).pathname, persona).toBe(home)
      await page.goto('/bienvenida')
      const first = page.getByTestId('onboarding').locator('li[data-testid^="step-"]').first().locator('a[href^="/"]').first()
      expect((await first.getAttribute('href'))!.split('?')[0], persona).toBe(home)
      await expect(page.getByTestId('welcome-go'), persona).toHaveText(go)
      await expect(page.getByTestId('welcome-go'), persona).toHaveAttribute('href', home)
    }
  })

  test('los pasos nuevos nombran botones que existen en la pantalla a la que llevan', async ({ page }) => {
    // Operaciones: la cola, con sus pestañas y el nombre con el que la ayuda la cita
    await loginAs(page, 'valeria.soto', { stay: true })
    await expect(page.locator('main')).toContainText('Cola de Operaciones')
    for (const text of ['Sin tomar', 'Míos', 'Pendientes de aprobación', 'Pendientes de capacitación']) await expect(page.locator('main')).toContainText(text)
    await openMenu(page)
    await expect(page.getByTestId('nav-ops-queue')).toContainText('Cola de Operaciones')
    await expect(page.getByTestId('nav-alerts')).toHaveText('Avisos del mercado')
    // supervisión: negocios cerrados con exportación, en su menú
    await loginAs(page, 'fernando.ibarra')
    await openMenu(page)
    await page.getByTestId('nav-closed').click()
    await expect(page).toHaveURL(/\/reportes\/cerrados/)
    for (const text of ['Negocios cerrados', 'Exportar CSV', 'Por persona']) await expect(page.locator('main')).toContainText(text)
    // quien lidera: Mi equipo con reparto pendiente, resultados por semana y el reporte de campo
    await loginAs(page, 'ana.robles', { stay: true })
    for (const text of ['Reporte de campo', 'Negocios cerrados', 'Resultados por semana', 'Reasignar cartera']) await expect(page.locator('main')).toContainText(text)
    await page.goto('/reportes/campo')
    for (const text of ['Reporte semanal de campo', 'Exportar altas y ganados', 'Exportar visitas']) await expect(page.locator('main')).toContainText(text)
    await page.goto('/panel-lt')
    await expect(page.locator('main')).toContainText('Cómo se calcula')
    await expect(page.locator('main')).toContainText('Adopción')
    // administración: horario hábil y turnos en la misma pestaña, territorios y tasa
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=entrada')
    await expect(page.locator('main')).toContainText('Horario hábil por mercado')
    await page.goto('/admin?tab=embudos')
    for (const text of ['Tasa de cambio a USD', 'Orden de las etapas', 'Qué pide cada formulario web', 'Crear embudo', 'Crear campo']) await expect(page.locator('main')).toContainText(text)
    // lo de Operaciones se configura dentro de Administración
    await page.getByRole('link', { name: 'Operaciones', exact: true }).first().click()
    await expect(page).toHaveURL(/\/admin\/operaciones$/)
    for (const text of ['Embudos y etapas', 'Etapas de Operaciones', 'Productos', 'Motivos de devolución a Ventas']) await expect(page.locator('main')).toContainText(text)
    // ventas: convertir, pasar y soltar, con el nombre que usa la ayuda
    await loginAs(page, 'diana.cruz')
    await page.goto('/leads')
    for (const text of ['Nuevo lead', 'Buscar en la lista', 'Sin reloj (importados)', 'Seleccionar los de esta página']) await expect(page.locator('main')).toContainText(text)
  })

  test('la ayuda responde lo que entró con leads, liderazgo, operaciones y b2b; reportar nombra las pantallas nuevas', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/ayuda')
    const help = page.getByTestId('help')
    const items = help.getByTestId('help-item')
    for (const [word, q] of [
      ['Merchant ID', '¿Dónde pongo el Merchant ID, la aprobación por proveedor y la capacitación?'],
      ['convertir en comercio', '¿Qué pasa cuando convierto un lead?'],
      ['poner en pausa', 'El cliente me pidió esperar. ¿Cómo pauso un negocio sin perderlo?'],
      ['exportar csv', '¿Dónde veo los negocios ganados y perdidos por persona y por mes? ¿Puedo exportar?'],
      ['pertenece a', '¿Cómo cuelgo una sucursal de su cadena, o un agente de su ISO?'],
      ['horario habil', '¿El reloj corre de noche o en fin de semana?'],
      ['devolver a ventas', '¿Cómo devuelvo una solicitud incompleta y cómo se entera quien vende?'],
      ['tasa de cambio', '¿Cómo cargo la tasa de cambio?'],
    ] as const) {
      await help.getByTestId('help-search').fill(word)
      await expect(items.first(), word).toBeVisible()
      await expect(help, word).toContainText(q)
    }
    await help.getByTestId('help-clear').click()
    for (const topic of ['ops', 'numbers']) await expect(help.getByTestId(`help-topic-${topic}`).getByTestId('help-item').first()).toBeVisible()
    // "Reportar un problema" llama a las pantallas nuevas por su nombre
    for (const [from, name] of [['/operaciones', 'Cola de Operaciones'], ['/reportes/cerrados', 'Negocios cerrados'], ['/reportes/campo', 'Reporte de campo'], ['/admin/operaciones', 'Administración, Operaciones'], ['/admin', 'Administración']] as const) {
      await page.goto(`/reportar?desde=${from}`)
      await expect(page.getByTestId('report-screen'), from).toHaveText(name)
    }
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
    // quien lidera el mercado no tiene la pestaña Problemas reportados
    await loginAs(page, 'ana.robles')
    await page.goto('/admin?tab=reportes')
    await expect(page.getByTestId('tab-hidden')).toContainText('Problemas reportados')
    await expect(page.getByTestId('admin-reports')).toHaveCount(0)

    // administración lo ve en su pestaña, responde y queda atendido
    await loginAs(page, 'nora.salas')
    await openMenu(page)
    await page.getByTestId('nav-admin').click()
    await page.getByRole('link', { name: /^Problemas reportados/ }).click()
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
    // ola 4: además de dónde se anota, la ayuda dice cómo se agrega al catálogo
    await expect(items).toHaveCount(2)
    await expect(help).toContainText('¿Dónde pongo al vendedor de calle?')
    await expect(help).toContainText('¿Cómo agrego un vendedor de calle?')
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
    await expect(items).toHaveCount(10)
    for (const q of ['¿Las visitas llegan solas desde la Sales App?', '¿Puedo trabajar o leer sin conexión?', '¿Puedo adjuntar fotos, contratos o evidencia?', '¿CONTIGO me avisa por correo o por Slack cuando me cae algo?', '¿La primera venta y las ventas de cada comercio llegan solas?', '¿Dónde está el mapa de comercios?', '¿Hay una app para instalar desde la tienda de aplicaciones?']) await expect(help).toContainText(q)
    // lo que ya hace no sale como pendiente
    expect((await items.allTextContents()).join(' ')).not.toMatch(/exportar|pedido/i)
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
    // Leadership: en "Equipo y quién lleva qué", después de lo que es para todos va lo suyo, antes de lo de supervisión
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
    await expect(help).not.toContainText('¿Puedo tomar un lead sin asignar?')
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
