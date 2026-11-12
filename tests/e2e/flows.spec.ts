import { test, expect, type Page } from '@playwright/test'
import { fichaId, fichaTab, loginAs, openMenu } from './helpers'

const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase()

async function newLead(page: Page, name: string, phone = '') {
  await page.goto('/leads')
  await page.getByTestId('new-lead').click()
  await page.locator('select[name=motor]').selectOption('d2d')
  await page.getByTestId('lead-source').selectOption('walk_in') // ola 2: el alta manual pide el origen
  await page.locator('input[name=business_name]').fill(name)
  await page.locator('input[name=contact_name]').fill('Carmen Prueba')
  if (phone) await page.locator('input[name=phone]').fill(phone)
  await page.getByTestId('save-lead').click()
}

test.describe('sesión y acceso', () => {
  test('sin sesión, cualquier pantalla manda al login', async ({ page }) => {
    await page.goto('/comercios')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('la respuesta trae CSP con nonce, HSTS y bloqueo de iframes', async ({ request }) => {
    const res = await request.get('/login')
    const h = res.headers()
    expect(h['content-security-policy']).toContain("script-src 'self' 'nonce-")
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(h['strict-transport-security']).toContain('max-age=63072000')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['x-powered-by']).toBeUndefined()
  })

  test('salir cierra la sesión y cambia de idioma con un clic', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await expect(page.getByTestId('me-roles')).toHaveText('Ventas · MX')
    await page.getByTestId('locale-toggle').click()
    await expect(page.getByTestId('nav-today')).toHaveText('Today')
    await expect(page.getByTestId('me-roles')).toHaveText('Sales · MX')
    await page.getByTestId('locale-toggle').click()
    await expect(page.getByTestId('nav-today')).toHaveText('Hoy')
    await openMenu(page)
    await page.getByTestId('logout').click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/hoy')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('un vendedor de MX no ve el menú de administración ni puede abrirlo por URL', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await expect(page.getByTestId('nav-admin')).toHaveCount(0)
    await expect(page.getByTestId('nav-supervisor')).toHaveCount(0)
    expect((await page.goto('/admin'))?.status()).toBe(404)
    expect((await page.goto('/supervisor'))?.status()).toBe(404)
    expect((await page.goto('/panel-lt'))?.status()).toBe(404)
  })

  test('un vendedor de MX no puede abrir un comercio de US aunque tenga el enlace', async ({ page }) => {
    await loginAs(page, 'sam.ortiz')
    await page.goto('/comercios?owner=me')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await expect(page.getByTestId('account-facts')).toBeVisible()
    const id = await fichaId(page)
    await loginAs(page, 'marco.pena')
    expect((await page.goto(`/comercios/${id}`))?.status()).toBe(404)
    // la ficha sobre la lista tampoco lo muestra: el enlace abre la lista sin panel
    await page.goto(`/comercios?ficha=${id}`)
    await expect(page.getByTestId('account-table')).toBeVisible()
    await expect(page.getByTestId('ficha')).toHaveCount(0)
    await page.goto('/comercios')
    await expect(page.getByTestId('account-table')).not.toContainText(' · US')
  })

  test('el LT ve todo pero no captura: no tiene botón de nuevo lead ni de nuevo comercio', async ({ page }) => {
    await loginAs(page, 'luis.tovar')
    await page.goto('/leads')
    await expect(page.getByTestId('lead-row').first()).toBeVisible()
    await expect(page.getByTestId('new-lead')).toHaveCount(0)
    await page.goto('/comercios')
    await expect(page.getByTestId('new-account')).toHaveCount(0)
    await openMenu(page)
    await page.getByTestId('nav-panel-lt').click()
    await expect(page.getByTestId('lt-market-MX')).toBeVisible()
    await expect(page.getByTestId('lt-market-US')).toBeVisible()
  })

  test('la líder de México ve su mercado en el panel, no el de US', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/panel-lt')
    await expect(page.getByTestId('lt-market-MX')).toBeVisible()
    await expect(page.getByTestId('lt-market-US')).toHaveCount(0)
  })
})

test.describe('leads', () => {
  test('un lead necesita teléfono o correo, y el teléfono tiene que ser válido', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await newLead(page, `Abarrotes Sin Datos ${uniq()}`)
    await expect(page.getByTestId('form-error')).toContainText('teléfono o un correo')
    await page.locator('input[name=phone]').fill('12')
    await page.getByTestId('save-lead').click()
    await expect(page.getByTestId('form-error')).toContainText('no parece válido')
  })

  test('de lead a comercio y deal: contactar, calificar y convertir', async ({ page }) => {
    const name = `Abarrotes La Prueba ${uniq()}`
    await loginAs(page, 'marco.pena')
    await newLead(page, name, '55 4000 ' + Math.floor(1000 + Math.random() * 8999))
    await expect(page.locator('h1')).toHaveText(name)
    await expect(page.getByTestId('lead-convert')).toHaveCount(0)
    // registrar el contacto pasa por la misma hoja que pide el próximo paso
    await page.getByTestId('lead-contacted').click()
    const sheet = page.locator('[data-testid="complete-sheet"][open]')
    await sheet.getByText('Enviar propuesta', { exact: true }).click()
    await sheet.getByTestId('sheet-save').click()
    await expect(page.getByTestId('toast')).toContainText('Próximo paso: Enviar propuesta a')
    await expect(page.getByTestId('lead-contacted')).toHaveCount(0)
    await expect(page.getByTestId('lead-qualify')).toBeVisible()
    await page.getByTestId('lead-qualify').click()
    await page.getByTestId('lead-convert').click()
    await expect(page).toHaveURL(/\/deals\//)
    await expect(page.locator('h1')).toHaveText(`Alta: ${name}`)
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Tienda visitada')
    await expect(page.getByTestId('next-step')).toHaveValue('Llamar para agendar la primera visita')
    await page.getByTestId('deal-account').click()
    await expect(page.locator('h1')).toHaveText(name)
    await fichaTab(page, 'datos')
    await expect(page.getByTestId('contact-row')).toContainText('Carmen Prueba')
    await expect(page.getByTestId('account-attribution')).toContainText('Marco Peña')
    await expect(page.getByTestId('account-aliases')).toContainText('Todavía no existe en la Sales App')
  })

  test('descartar un lead exige motivo', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await newLead(page, `Papelería Descartada ${uniq()}`, '55 4100 ' + Math.floor(1000 + Math.random() * 8999))
    await page.getByTestId('lead-disqualify').click()
    await page.locator('dialog[open] select[name=reason]').selectOption('not_qualified')
    await page.getByTestId('lead-disqualify-confirm').click()
    await expect(page.getByText('Descartado').first()).toBeVisible()
    await expect(page.getByTestId('lead-steps')).toHaveCount(0)
  })

  test('el formulario web crea el lead y lo reparte por turno entre el equipo', async ({ page }) => {
    const a = `Tienda Formulario A ${uniq()}`
    const b = `Tienda Formulario B ${uniq()}`
    for (const n of [a, b]) {
      await page.goto('/f/tiendas-mx')
      await page.locator('input[name=business_name]').fill(n)
      await page.locator('input[name=contact_name]').fill('Persona Web')
      await page.locator('input[name=phone]').fill('55 4200 ' + Math.floor(1000 + Math.random() * 8999))
      await page.getByTestId('public-submit').click()
      await expect(page.getByTestId('form-ok')).toContainText('Recibimos tus datos')
    }
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/leads?status=new')
    const owner = async (n: string) => (await page.getByTestId('lead-row').filter({ hasText: n }).getByTestId('lead-owner-cell').innerText()).trim()
    const [oa, ob] = [await owner(a), await owner(b)]
    expect(['Marco Peña', 'Lucía Vega']).toContain(oa)
    expect(['Marco Peña', 'Lucía Vega']).toContain(ob)
    expect(oa).not.toBe(ob)
  })

  test('una supervisora reasigna un lead dentro de su equipo', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/leads?status=new')
    await page.getByTestId('lead-row').first().locator('a').first().click()
    const before = (await page.getByTestId('lead-owner').locator('p').first().innerText()).trim()
    const target = before === 'Marco Peña' ? 'Lucía Vega' : 'Marco Peña'
    await page.getByTestId('lead-owner').locator('select[name=owner_id]').selectOption({ label: target })
    await page.getByTestId('lead-assign').click()
    await expect(page.getByTestId('lead-owner').locator('p').first()).toHaveText(target)
  })
})

test.describe('embudo', () => {
  test('una etapa no deja entrar sin lo que pide: monto, decisor y próximo paso', async ({ page }) => {
    const name = `Cadena de Prueba ${uniq()}`
    await loginAs(page, 'diana.cruz')
    await page.goto('/comercios')
    await page.getByTestId('new-account').click()
    await page.locator('dialog[open] select[name=kind]').selectOption('chain')
    await page.getByTestId('account-name').fill(name)
    await page.locator('dialog[open] select[name=segment]').selectOption('b2b')
    await page.getByTestId('save-account').click()
    await expect(page.locator('h1')).toHaveText(name)

    await page.getByTestId('new-deal').click()
    await page.locator('dialog[open] select[name=pipeline_id]').selectOption({ label: 'Cadenas y distribuidores' })
    await page.getByTestId('new-deal-step').fill('Enviar propuesta')
    await page.getByTestId('save-deal').click()
    await expect(page).toHaveURL(/\/deals\//)

    await expect(page.getByTestId('gate-missing')).toContainText('monto esperado')
    await page.getByTestId('deal-advance').click()
    await expect(page.getByTestId('deal-move').getByTestId('form-error')).toContainText('monto esperado')
    await page.getByTestId('amount').fill('250000')
    await page.getByTestId('deal-save').click()
    await expect(page.getByTestId('deal-edit').getByTestId('form-ok')).toBeVisible()
    await page.getByTestId('deal-advance').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Propuesta')

    // justo después de avanzar, el botón ignora otro envío por un momento (un doble clic no avanza dos etapas)
    await page.waitForTimeout(800)
    await page.getByTestId('deal-advance').click()
    await expect(page.getByTestId('deal-move').getByTestId('form-error')).toContainText('decisor')
    await page.getByTestId('deal-account').click()
    await fichaTab(page, 'datos')
    await page.getByTestId('add-contact').click()
    await page.getByTestId('contact-name').fill('Decisora De Prueba')
    await page.getByTestId('contact-role').selectOption('decision_maker')
    await page.getByTestId('save-contact').click()
    await expect(page.getByTestId('contact-row')).toContainText('Decisora De Prueba')
    await page.getByTestId('deal-link').click()
    await page.getByTestId('decision-maker').selectOption({ index: 1 })
    await page.getByTestId('decision-maker-met').check()
    await page.getByTestId('deal-save').click()
    await expect(page.getByTestId('deal-edit').getByTestId('form-ok')).toBeVisible()
    await page.getByTestId('deal-advance').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Negociación')

    // El embudo B2B de México trae las etapas del proceso corporativo después de negociar (paquete b2b, 12-nov-2026).
    for (const stage of ['Integración', 'Pruebas', 'Certificación', 'Alta y capacitación', 'Contrato firmado, esperando primera venta']) {
      await page.waitForTimeout(800)
      await page.getByTestId('deal-advance').click()
      await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText(stage)
    }
    await expect(page.getByTestId('deal-move')).toContainText('nadie lo marca a mano')
    await expect(page.getByTestId('deal-advance')).toHaveCount(0)
  })

  test('cerrar como perdido exige motivo y queda en el panel', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await page.goto('/pipelines?owner=me')
    await page.getByTestId('stage-visitada').getByTestId('deal-card').first().click()
    await page.getByTestId('deal-lose').click()
    await page.getByTestId('deal-lose-confirm').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText('motivo')
    await page.getByTestId('loss-reason').selectOption('competitor')
    await page.getByTestId('deal-lose-confirm').click()
    await expect(page.getByText('Perdido').first()).toBeVisible()
    await expect(page.getByTestId('deal-edit')).toHaveCount(0)
  })

  test('el tablero muestra la revisita al decisor y cuenta por etapa', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/pipelines')
    await expect(page.getByTestId('board-summary')).toContainText('con revisita al decisor')
    const count = Number(await page.getByTestId('stage-count-espera').innerText())
    expect(count).toBeGreaterThan(0)
    await expect(page.getByTestId('board').getByText('Revisita al decisor').first()).toBeVisible()
  })
})

test.describe('integraciones', () => {
  test('la primera transacción de S5 gana el deal, activa el comercio y abre el handoff', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=integraciones')
    const option = page.getByTestId('sim-metrics-ref').locator('option').first()
    const label = (await option.innerText()).trim()
    const name = label.split(' · ')[0]!
    await page.getByTestId('sim-metrics-send').click()
    await expect(page.getByTestId('sim-metrics').getByTestId('form-ok')).toContainText('1 deal ganado por primera transacción')
    await expect(page.getByTestId('batch-row').first()).toContainText('1 de 1 filas ligadas')

    await page.goto(`/comercios?q=${encodeURIComponent(name)}`)
    await page.getByTestId('account-row').filter({ hasText: name }).first().locator('a').first().click()
    await expect(page.getByTestId('ficha').getByTestId('health')).toHaveText('Activo')
    await expect(page.getByTestId('account-timeline')).toContainText('Primera transacción (S5)')
    await expect(page.getByTestId('account-tasks')).toContainText('Handoff: ')
    await fichaTab(page, 'datos')
    await expect(page.getByTestId('metrics-asof')).toContainText('Ventas según S5')
    await page.getByTestId('deal-link').click()
    await expect(page.getByText(/Ganado por primera transacción|Won by first transaction/)).toBeVisible()
  })

  test('una visita sin decisor que llega de la Sales App marca la revisita en el deal', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=integraciones')
    const name = (await page.getByTestId('sim-visit-ref').locator('option').first().innerText()).split(' · ')[0]!
    await page.getByTestId('sim-visit-outcome').selectOption('revisit')
    await page.getByTestId('sim-visit-send').click()
    await expect(page.getByTestId('sim-visit').getByTestId('form-ok')).toContainText('procesado')
    await page.goto(`/comercios?q=${encodeURIComponent(name)}`)
    await page.getByTestId('account-row').filter({ hasText: name }).first().locator('a').first().click()
    await expect(page.getByTestId('tl-visit').first()).toContainText('Visita sin venta')
    await expect(page.getByTestId('tl-visit').first()).toContainText('pide revisita')
    await page.getByTestId('deal-link').click()
    await expect(page.getByTestId('revisit-banner')).toBeVisible()
  })

  test('un evento con un ID que no existe no se pierde: va a la cola de excepciones', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=integraciones')
    await page.getByTestId('sim-visit-ref').selectOption('SC-XX-000000')
    await page.getByTestId('sim-visit-send').click()
    await expect(page.getByTestId('sim-visit').getByTestId('form-ok')).toContainText('cola de excepciones')
    await expect(page.getByTestId('inbound-row').first()).toContainText('sin comercio')
    await page.goto('/supervisor?kind=unmatched_event')
    await expect(page.getByTestId('exception-row').first()).toContainText('Evento sin comercio')
  })

  test('un PDV que nace en la Sales App recibe su ID y se encuentra por su alias', async ({ page }) => {
    const name = `Tienda Nace En App ${uniq()}`
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=integraciones')
    await page.getByTestId('sim-store-name').fill(name)
    await page.getByTestId('sim-store-send').click()
    const msg = await page.getByTestId('sim-store').getByTestId('form-ok').innerText()
    const alias = msg.match(/SC-MX-\d{6}/)![0]
    await expect(page.getByTestId('outbox-log')).toContainText('account.alias_issued')
    await page.getByTestId('global-search').fill(alias)
    await page.getByTestId('global-search').press('Enter')
    await expect(page.getByTestId('search-hit').first()).toContainText(name)
    await page.getByTestId('search-hit').first().click()
    await expect(page.getByTestId('health')).toHaveText('Sin transaccionar')
    await fichaTab(page, 'datos')
    await expect(page.getByTestId('alias-value').first()).toHaveText(alias)
    await expect(page.getByTestId('account-data')).toContainText('En alta')
  })

  test('la API exige llave y permiso, y procesar dos veces el mismo evento no duplica nada', async ({ page, request }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=integraciones')
    await page.getByTestId('api-name').fill(`Sales Core staging ${uniq()}`)
    await page.getByTestId('api-create').click()
    const key = (await page.getByTestId('reveal-once').locator('code').innerText()).trim()
    expect(key).toMatch(/^ctg_/)
    const alias = (await page.getByTestId('sim-visit-ref').locator('option').nth(1).getAttribute('value'))!

    const event = {
      event_id: `e2e-${Date.now()}`, type: 'visit.checked_out', version: 1, occurred_at: new Date().toISOString(),
      data: { visit_id: `e2e-visit-${Date.now()}`, customer_id: alias, salesperson_id: 'SC-U-1', business_date: new Date().toISOString().slice(0, 10),
        checked_in_at: new Date().toISOString(), checked_out_at: new Date().toISOString(), duration_seconds: 300, sale: true, revisit: false, decision_maker_present: true, auto_closed: false },
    }
    expect((await request.post('/api/v1/events/sales-app', { data: event })).status()).toBe(401)
    expect((await request.post('/api/v1/events/sales-app', { data: event, headers: { authorization: 'Bearer ctg_nope' } })).status()).toBe(401)
    expect((await request.post('/api/v1/metrics/daily', { data: {}, headers: { authorization: `Bearer ${key}` } })).status()).toBe(403)
    const first = await request.post('/api/v1/events/sales-app', { data: event, headers: { authorization: `Bearer ${key}` } })
    expect(first.status()).toBe(200)
    expect((await first.json()).status).toBe('processed')
    const second = await request.post('/api/v1/events/sales-app', { data: event, headers: { authorization: `Bearer ${key}` } })
    expect((await second.json()).status).toBe('duplicate')
    const bad = await request.post('/api/v1/events/sales-app', { data: { ...event, version: 2 }, headers: { authorization: `Bearer ${key}` } })
    expect(bad.status()).toBe(422)

    await page.reload()
    // Revocar pide confirmación: la llave deja de servir en ese instante y no se reactiva.
    await page.getByTestId('api-revoke').first().click()
    await page.locator('dialog[open]').getByTestId('api-revoke-confirm').click()
    await expect(page.getByTestId('api-row').first()).toContainText('revocada')
    expect((await request.post('/api/v1/events/sales-app', { data: event, headers: { authorization: `Bearer ${key}` } })).status()).toBe(401)
  })
})

test.describe('cuentas', () => {
  test('una cadena suma lo que cuelga de ella y la tienda muestra a su cadena', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/comercios?q=Grupo+Abarrotero')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await fichaTab(page, 'arbol')
    await expect(page.getByTestId('rollup-stores')).toContainText('14 puntos de venta en su red')
    await expect(page.getByTestId('child-row')).toHaveCount(14)
    await expect(page.getByTestId('child-row').first()).toContainText(/desde [a-z]{3} \d{4}/)
    await page.getByTestId('child-row').first().click()
    await expect(page.getByTestId('breadcrumb')).toContainText('Grupo Abarrotero del Valle')
  })

  test('mover una tienda de cadena cambia el árbol y los totales', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/comercios?q=Grupo+Abarrotero')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await fichaTab(page, 'arbol')
    await page.getByTestId('child-row').first().click()
    await expect(page.getByTestId('breadcrumb')).toContainText('Grupo Abarrotero del Valle')
    await fichaTab(page, 'datos')
    await page.getByTestId('parent-select').selectOption({ label: 'Distribuidora La Central' })
    await page.getByTestId('parent-save').click()
    await fichaTab(page, 'arbol')
    await expect(page.getByTestId('breadcrumb')).toContainText('Distribuidora La Central')
    await page.goto('/comercios?q=Grupo+Abarrotero')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await fichaTab(page, 'arbol')
    await expect(page.getByTestId('rollup-stores')).toContainText('13 puntos de venta en su red')
  })

  test('quien lleva la cadena ve sus tiendas aunque no sean suyas', async ({ page }) => {
    await loginAs(page, 'ivan.rios')
    await page.goto('/comercios?q=Distribuidora+La+Central')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await fichaTab(page, 'arbol')
    await expect(page.getByTestId('child-row').first()).toBeVisible()
    await page.getByTestId('child-row').first().click()
    await expect(page.getByTestId('account-facts')).toContainText('Por su cadena')
  })

  test('capturar un comercio con un teléfono que ya existe avisa del duplicado antes de crear', async ({ page }) => {
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios?owner=me')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await fichaTab(page, 'datos')
    const phone = await page.getByTestId('edit-phone').inputValue()
    await page.goto('/comercios')
    await page.getByTestId('new-account').click()
    await page.getByTestId('account-name').fill(`Negocio Repetido ${uniq()}`)
    await page.getByTestId('account-phone').fill(phone)
    await page.getByTestId('save-account').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText('Parece que ya existe')
    await page.getByTestId('account-force').check()
    await page.getByTestId('save-account').click()
    await expect(page.getByTestId('account-facts')).toBeVisible()
  })

  test('administración fusiona el duplicado: uno sobrevive y el otro queda archivado', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/supervisor')
    await page.getByTestId('run-rules').click()
    await expect(page.getByTestId('form-ok')).toContainText('Reglas evaluadas')
    await page.goto('/admin?tab=calidad')
    const row = page.getByTestId('dup-row').first()
    await expect(row).toBeVisible()
    const archivedHref = await row.locator('a').nth(1).getAttribute('href')
    const n = await page.getByTestId('dup-row').count()
    await row.getByTestId('merge').click()
    await expect(page.getByTestId('dup-row')).toHaveCount(n - 1)
    await page.goto(archivedHref!)
    await expect(page.getByText('Archivado (fusionado)')).toBeVisible()
  })

  test('reasignar una cuenta deja la atribución anterior con fecha de cierre', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/comercios')
    await page.getByTestId('account-row').filter({ hasText: 'Marco Peña' }).first().locator('a').first().click()
    await expect(page.getByTestId('account-facts')).toContainText('Marco Peña')
    const url = `/comercios/${await fichaId(page)}`
    await fichaTab(page, 'datos')
    await page.getByTestId('reassign-to').selectOption({ label: 'Lucía Vega' })
    await page.getByTestId('reassign-save').click()
    await page.getByTestId('reassign-save-confirm').click() // reasignar pide confirmación
    await expect(page.getByTestId('account-facts')).toContainText('Lucía Vega')
    const attribution = page.getByTestId('account-attribution')
    await expect(attribution).toContainText('Marco Peña')
    await expect(attribution).toContainText('hasta')
    await loginAs(page, 'marco.pena')
    expect((await page.goto(url))?.status()).toBe(404)
  })

  test('la búsqueda encuentra por teléfono y las vistas guardadas filtran', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/comercios?q=5255009000')
    await expect(page.getByTestId('account-row')).toHaveCount(6)
    await page.goto('/comercios')
    await page.getByTestId('pill-riesgo').click()
    const rows = page.getByTestId('account-row')
    await expect(rows.first()).toContainText('En riesgo')
    expect(await rows.filter({ hasText: 'En riesgo' }).count()).toBe(await rows.count())
  })

  test('la lista pagina por llave: "Ver más" trae los siguientes, sin repetir', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/comercios')
    const firstPage = await page.getByTestId('account-row').locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    await page.getByTestId('more').click()
    await expect(page).toHaveURL(/after=/)
    const second = await page.getByTestId('account-row').locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    expect(second.length).toBeGreaterThan(0)
    expect(second.filter((h) => firstPage.includes(h))).toEqual([])
  })
})

test.describe('operación', () => {
  test('una tarea con fecha aparece en Actividades y se marca hecha', async ({ page }) => {
    const subject = `Llevar material ${uniq()}`
    await loginAs(page, 'marco.pena')
    await page.goto('/comercios?owner=me')
    await page.getByTestId('account-row').first().locator('a').first().click()
    await page.getByTestId('action-activity').click()
    await page.getByTestId('activity-kind').selectOption('task')
    await page.getByTestId('activity-subject').fill(subject)
    await page.getByTestId('activity-add').click()
    await expect(page.getByTestId('activity-form').getByTestId('form-error')).toContainText('necesita fecha')
    await page.getByTestId('activity-due').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
    await page.getByTestId('activity-add').click()
    await expect(page.getByTestId('account-tasks')).toContainText(subject)
    await page.goto('/actividades')
    const row = page.getByTestId('task-row').filter({ hasText: subject })
    await row.getByTestId('row-complete').click()
    const sheet = page.locator('[data-testid="complete-sheet"][open]')
    await sheet.getByText('Nada más: cerrar', { exact: true }).click()
    await sheet.getByTestId('sheet-save').click()
    await expect(page.getByTestId('toast')).toHaveText('Hecho. Sin próximo paso.')
    await expect(page.getByTestId('task-row').filter({ hasText: subject })).toHaveCount(0)
    await page.getByTestId('pill-done').click()
    await expect(page.getByTestId('task-row').filter({ hasText: subject })).toHaveCount(1)
  })

  test('el supervisor ve solo a su equipo y puede descartar una excepción', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/supervisor')
    await expect(page.getByTestId('rep-row')).toHaveCount(2)
    await expect(page.getByTestId('rep-table')).toContainText('Marco Peña')
    await expect(page.getByTestId('rep-table')).toContainText('Lucía Vega')
    await expect(page.getByTestId('rep-table')).not.toContainText('Diana Cruz')
    const n = await page.getByTestId('exception-row').count()
    expect(n).toBeGreaterThan(0)
    const first = (await page.getByTestId('exception-row').first().locator('a span').first().innerText()).trim()
    await page.getByTestId('exception-row').first().getByTestId('exception-dismiss').click()
    await page.getByTestId('exception-dismiss-confirm').click() // descartar pide confirmación
    await expect(page.getByTestId('exception-row').first().locator('a span').first()).not.toHaveText(first)
  })

  test('arreglar el problema cierra la excepción sola: poner próximo paso la quita de la cola', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/supervisor?kind=no_next_step')
    const row = page.getByTestId('exception-row').first()
    const title = (await row.locator('a span').first().innerText()).trim()
    await row.locator('a').click()
    await page.getByTestId('next-step').fill('Llamar el lunes')
    await page.getByTestId('next-step-due').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10))
    await page.getByTestId('deal-save').click()
    await expect(page.getByTestId('deal-edit').getByTestId('form-ok')).toBeVisible()
    await page.goto('/supervisor?kind=no_next_step')
    await page.getByTestId('run-rules').click()
    await expect(page.getByTestId('form-ok')).toContainText('Reglas evaluadas')
    await expect(page.getByTestId('exception-queue')).not.toContainText(title)
  })

  test('administración da y quita acceso, y todo queda en la bitácora', async ({ page }) => {
    const email = `persona.${uniq().toLowerCase()}@contigo.test`
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=personas')
    await page.getByTestId('grant-open').click()
    await page.getByTestId('grant-email').fill('alguien@gmail.com')
    await page.getByTestId('grant-name').fill('Persona Externa')
    await page.getByTestId('grant-role').selectOption('rep')
    await page.getByTestId('grant-market').selectOption('MX')
    await page.getByTestId('grant-save').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText('Ese dominio no está admitido')
    await page.getByTestId('grant-email').fill(email)
    await page.getByTestId('grant-name').fill('Persona Nueva')
    await page.getByTestId('grant-save').click()
    const row = page.getByTestId('person-row').filter({ hasText: email })
    await expect(row).toContainText('Ventas · MX')
    // Quitar el acceso ya no es un clic: abre la confirmación, y la persona sale de la lista "Con acceso".
    await row.getByTestId('membership-open').click()
    await page.locator('dialog[open]').getByTestId('membership-end').click()
    await expect(page.getByTestId('admin-notice')).toContainText('Acceso cerrado')
    await expect(page.getByTestId('person-row').filter({ hasText: email })).toHaveCount(0)
    await page.goto('/admin?tab=auditoria')
    await expect(page.getByTestId('audit-table')).toContainText('Quitó un acceso')
    await expect(page.getByTestId('audit-table')).toContainText('Dio acceso')
    await expect(page.getByTestId('audit-table')).toContainText('Persona Nueva')
  })

  test('el turno de un formulario se cambia desde administración', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=entrada')
    await expect(page.getByTestId('form-row')).toHaveCount(3)
    const card = page.getByTestId('rule-card').filter({ hasText: 'Web US dealers' })
    await card.getByTestId('rule-member').first().uncheck()
    await card.getByTestId('rule-save').click()
    await expect(card.getByTestId('form-ok')).toContainText('Turno actualizado')
    await page.reload()
    expect(await page.getByTestId('rule-card').filter({ hasText: 'Web US dealers' }).getByTestId('rule-member').first().isChecked()).toBe(false)
  })
})
