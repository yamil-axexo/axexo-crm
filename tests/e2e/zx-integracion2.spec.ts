import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, openMenu, pageErrors, testDb } from './helpers'

// Integración de la ola 2 (leads, liderazgo, operaciones, b2b, contenido): lo que cruza paquetes, visto en la pantalla.
const sql = testDb()
test.afterAll(() => sql.end())
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const spanish = (page: Page) => page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])
const dayIn = (tz: string, offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + offset * 86400000))

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}

test('un lead B2B se convierte: el comercio nace con el tipo de cuenta del catálogo y conserva la historia y lo que contestó', async ({ page }) => {
  const errors = pageErrors(page)
  const name = `Zx Integradora ${tag()}`
  const diana = await uid('diana.cruz')
  const lead = (await sql<{ id: string }[]>`
    insert into crm.leads (market_code, source, form_id, motor, business_name, contact_name, phone, locality, status, owner_id, assigned_at, sla_due_at, first_touch_at, created_at, custom)
    values ('MX', 'web_form', ${await uid('f-mx-b2b')}, 'b2b', ${name}, 'Raúl Peña', ${'+5255' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'Monterrey', 'contacted',
            ${diana}, now() - interval '2 hours', now() - interval '1 hour', now() - interval '90 minutes', now() - interval '2 hours',
            ${sql.json({ b2b_points_of_sale: 25, b2b_integration: 'API' })}) returning id`)[0]!.id
  await sql`insert into crm.activities (market_code, lead_id, kind, subject, body, done_at, owner_id, created_by)
            values ('MX', ${lead}, 'note', 'Pide demo con su equipo técnico', 'Quieren ver la conexión por API', now() - interval '80 minutes', ${diana}, ${diana})`

  await loginAs(page, 'diana.cruz')
  await page.goto(`/leads/${lead}`)
  // lo que contestó en el formulario B2B se ve en el lead
  await expect(page.getByTestId('lead-answers')).toContainText('25')
  // el tipo de cuenta del lead sale del catálogo de tipos de cuenta (ISO no existía como opción del lead antes de integrar)
  await expect(page.getByTestId('lead-kind-text')).toHaveText('Cadena')
  await page.getByTestId('lead-edit-type').click()
  await expect(page.getByTestId('lead-edit-kind').locator('option[value=iso]')).toHaveCount(1)
  await page.getByTestId('lead-edit-kind').selectOption('iso')
  await page.getByTestId('lead-edit-role').selectOption('technology')
  await page.getByTestId('lead-edit-save').click()
  await expect(page.getByTestId('lead-kind-text')).toHaveText('ISO')

  await page.getByTestId('lead-qualify').click()
  await expect(page.getByTestId('lead-kind')).toHaveValue('iso')
  await expect(page.getByTestId('lead-pipeline').locator('option:checked')).toHaveText('Cadenas y distribuidores')
  await page.getByTestId('lead-convert').click()
  await expect(page).toHaveURL(/\/deals\//)
  // la historia del lead está en el hilo del negocio
  await expect(page.getByTestId('deal-timeline')).toContainText('Pide demo con su equipo técnico')

  await page.getByTestId('deal-account').click()
  await expect(page.locator('h1')).toHaveText(name)
  await expect(page.getByTestId('ficha-type')).toContainText('ISO')
  await expect(page.getByTestId('ficha-type')).not.toContainText('Tienda')
  await expect(page.getByText('Pide demo con su equipo técnico').first()).toBeVisible()
  await fichaTab(page, 'datos')
  await expect(page.getByTestId('field-section-qualify').locator('[data-key=b2b_points_of_sale]')).toContainText('25')
  await expect(page.getByTestId('contact-row')).toContainText('Tecnología e integración')
  const acc = await sql`select kind, account_type from crm.accounts where name = ${name}`
  expect(acc[0]).toEqual({ kind: 'distributor', account_type: 'iso' })
  expect(errors).toEqual([])
})

test.describe('pedido: cola de Operaciones, devolución a Hoy y ganado a mano en Negocios cerrados', () => {
  test.describe.configure({ mode: 'serial' })
  const name = `Zx Integra ${tag()}`
  const title = `Pedido integrado ${tag()}`
  let accountId = ''
  let dealId = ''

  test('la vendedora entrega el pedido: entra a la cola y ella ya no puede avanzarlo', async ({ page }) => {
    const jade = await uid('jade.kim')
    accountId = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by)
      values ('US', 'store', ${name}, 'orders', ${jade}, 'US', ${jade}) returning id`)[0]!.id
    await loginAs(page, 'jade.kim')
    await spanish(page)
    await page.goto(`/comercios/${accountId}`)
    await page.getByTestId('new-deal').click()
    await page.getByTestId('new-deal-pipeline').selectOption({ label: 'Sales orders' })
    await page.getByTestId('new-deal-title').fill(title)
    await page.getByTestId('new-deal-step').fill('Confirmar pedido con el comercio')
    await page.getByTestId('save-deal').click()
    await expect(page).toHaveURL(/\/deals\//)
    dealId = page.url().split('/').pop()!
    await page.getByTestId('item-product').selectOption(await uid('prod-us-sim'))
    await page.getByTestId('item-quantity').fill('20')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('item-row')).toHaveCount(1)
    await page.getByTestId('deal-advance').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Revisión de Operaciones')
    // ya no está en su cancha: ni avanzar ni ganar
    await expect(page.getByTestId('with-ops')).toBeVisible()
    await expect(page.getByTestId('deal-advance')).toHaveCount(0)
    await expect(page.getByTestId('deal-win')).toHaveCount(0)
    // y en el tablero su tarjeta no ofrece ganarlo
    await page.goto(`/pipelines/${await uid('p-us-orders')}`)
    await expect(page.locator(`[data-card="${dealId}"]`)).toBeVisible()
    await expect(page.locator(`[data-card="${dealId}"]`).getByTestId('deal-card-win')).toHaveCount(0)
  })

  test('Operaciones aterriza en su cola, lo ve, lo toma y lo devuelve con motivo', async ({ page }) => {
    await loginAs(page, 'tom.reyes', { stay: true })
    await expect(page).toHaveURL(/\/operaciones$/)
    await spanish(page)
    await page.reload()
    const row = page.getByTestId('ops-row').filter({ hasText: title })
    await expect(row).toContainText('Vendió: Jade Kim')
    await row.getByTestId('ops-row-take').click()
    await page.goto(`/deals/${dealId}`)
    await page.getByTestId('ops-return').click()
    await page.getByTestId('return-reason').selectOption('data_incomplete')
    await page.getByTestId('return-note').fill('Falta la dirección de entrega')
    await page.getByTestId('return-confirm').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Pedido capturado')
    await page.goto('/operaciones?ver=todos')
    await expect(page.getByTestId('ops-row').filter({ hasText: title })).toHaveCount(0)
  })

  test('a la vendedora le llega a Hoy con el motivo, y lo vuelve a entregar', async ({ page }) => {
    await loginAs(page, 'jade.kim')
    await spanish(page)
    await page.goto('/hoy')
    await expect(page.getByText(new RegExp(`(Operations sent back|Operaciones devolvió) ${title}: .*Falta la dirección de entrega`)).first()).toBeVisible()
    await page.goto(`/deals/${dealId}`)
    await page.getByTestId('deal-advance').click()
    await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Revisión de Operaciones')
  })

  test('Operaciones lo gana a mano con fecha de ayer; quien lidera lo ve en Negocios cerrados con esa fecha y en el CSV', async ({ page }) => {
    const tz = 'America/New_York'
    const today = dayIn(tz)
    const yesterday = dayIn(tz, -1)
    await loginAs(page, 'tom.reyes')
    await spanish(page)
    await page.goto(`/pipelines/${await uid('p-us-orders')}`)
    const card = page.locator(`[data-card="${dealId}"]`)
    await card.getByTestId('deal-card-win').click()
    await expect(page.getByTestId('win-date')).toHaveAttribute('max', today)
    await page.getByTestId('win-date').fill(yesterday)
    await page.getByTestId('win-confirm').click()
    await expect(page.locator(`[data-card="${dealId}"]`)).toHaveCount(0)
    const won = await sql<{ on: string }[]>`select (won_at at time zone ${tz})::date::text as on from crm.deals where id = ${dealId} and status = 'won'`
    expect(won[0]?.on).toBe(yesterday)

    // quien lidera el mercado: Negocios cerrados, con el periodo de solo ayer
    await loginAs(page, 'robert.hale')
    await spanish(page)
    const query = `periodo=rango&desde=${yesterday}&hasta=${yesterday}&resultado=won`
    await page.goto(`/reportes/cerrados?${query}`)
    const closed = page.getByTestId('closed-row').filter({ hasText: title })
    await expect(closed).toHaveCount(1)
    await expect(closed).toContainText(name)
    await expect(closed).toContainText('Jade Kim')
    await expect(page.getByTestId('closed-count')).toContainText('en total')
    // con el periodo de solo hoy no aparece: cuenta la fecha real de cierre, no el día en que se capturó
    await page.goto(`/reportes/cerrados?periodo=rango&desde=${today}&hasta=${today}&resultado=won`)
    await expect(page.getByTestId('closed-row').filter({ hasText: title })).toHaveCount(0)
    // el CSV de lo filtrado trae el negocio con la fecha de ayer
    const res = await page.request.get(`/reportes/cerrados/export?${query}`)
    expect(res.status()).toBe(200)
    const line = (await res.text()).split(/\r?\n/).find((l) => l.includes(title))
    expect(line, 'el negocio ganado a mano sale en el archivo').toBeTruthy()
    expect(line).toContain(yesterday)
    expect(line).toContain(name)
    // y la vendedora no puede bajar ese archivo
    await loginAs(page, 'jade.kim')
    expect((await page.request.get(`/reportes/cerrados/export?${query}`)).status()).toBe(404)
  })
})

test.describe('un negocio en pausa no aparece como frío', () => {
  const paused = `Zx En pausa ${tag()}`
  const quiet = `Zx Quieto ${tag()}`
  let pipe = ''
  test.beforeAll(async () => {
    const diana = await uid('diana.cruz')
    pipe = await uid('p-mx-b2b')
    const stage = await uid('s-mx-b2b-calificacion')
    for (const [title, isPaused] of [[paused, true], [quiet, false]] as const) {
      const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by)
        values ('MX', 'chain', ${`${title} SA`}, 'b2b', ${diana}, 'MX', ${diana}) returning id`)[0]!.id
      await sql`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, created_by, created_at, stage_entered_at, next_step, next_step_due,
                                       paused_at, paused_by, pause_reason, pause_review_on)
                values ('MX', ${pipe}, ${stage}, ${acc}, ${diana}, ${title}, 'MXN', ${diana}, now() - interval '70 days', now() - interval '70 days', 'Enviar propuesta', current_date - 40,
                        ${isPaused ? sql`now() - interval '5 days'` : null}, ${isPaused ? diana : null}, ${isPaused ? 'Cierra presupuesto en enero' : null}, ${isPaused ? sql`current_date + 20` : null})`
    }
  })

  for (const w of [{ name: 'escritorio', width: 1440, height: 900 }, { name: 'teléfono', width: 390, height: 844 }]) {
    test(`quien lidera lo ve en pausa en el tablero, no entre los negocios quietos (${w.name})`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height })
      const errors = pageErrors(page)
      await loginAs(page, 'ana.robles')
      // negocios sin movimiento en más de 30 días: el quieto sí, el que está en pausa no
      await page.goto(`/pipelines/${pipe}?quietos=30`)
      await expect(page.getByTestId('quiet-list')).toContainText(quiet)
      await expect(page.getByTestId('quiet-list')).not.toContainText(paused)
      // los motivos del cierre en bloque son los del embudo B2B, no los de tienda
      await expect(page.getByTestId('bulk-reason').locator('option[value=b2b_postponed]')).toHaveCount(1)
      await expect(page.getByTestId('bulk-reason').locator('option[value=store_closed_down]')).toHaveCount(0)
      await expect(page.getByTestId('bulk-reason')).not.toContainText('La tienda cerró')
      await clean(page, `negocios quietos ${w.name}`)
      // el tablero: filtros de equipo y persona (liderazgo), filtro "En pausa" (b2b) y negocios quietos (operaciones) caben juntos
      await page.goto(`/pipelines/${pipe}`)
      for (const id of ['pipeline-select', 'board-team', 'board-person', 'pill-all', 'filter-no-step', 'filter-paused', 'view-list', 'quiet-filter']) await expect(page.getByTestId(id), id).toBeVisible()
      await clean(page, `tablero con todos los filtros ${w.name}`)
      await page.getByTestId('filter-paused').click()
      await expect(page).toHaveURL(/paso=pausa/)
      await expect(page.getByText(/En pausa · se revisa/).first()).toBeVisible()
      await expect(page.locator('main')).toContainText(`${paused} SA`)
      await expect(page.locator('main')).not.toContainText(`${quiet} SA`)
      // el filtro de equipo convive con el de pausa
      await page.getByTestId('board-team').selectOption({ label: 'B2B México' })
      await expect(page).toHaveURL(/equipo=/)
      await expect(page).toHaveURL(/paso=pausa/)
      await expect(page.locator('main')).toContainText(`${paused} SA`)
      await clean(page, `tablero en pausa por equipo ${w.name}`)
      expect(errors).toEqual([])
    })
  }

  test('en Mi equipo el negocio en pausa no suma a "sin movimiento" de quien lo lleva', async ({ page }) => {
    const diana = await uid('diana.cruz')
    const cold = async () => (await sql<{ n: number }[]>`
      select count(*)::int as n from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.owner_id = ${diana} and d.status = 'open' and d.paused_at is null and s.kind = 'open' and d.created_at < now() - interval '14 days'
         and not exists (select 1 from crm.activities a where a.deal_id = d.id and coalesce(a.done_at, a.created_at) > now() - interval '14 days')`)[0]!.n
    const n = await cold()
    await loginAs(page, 'paula.mendez')
    await page.goto('/supervisor')
    await expect(page.locator('main')).toContainText('Diana Cruz')
    // retomarlo lo regresa a la cuenta de quietos: la pausa era lo único que lo sacaba
    await sql`update crm.deals set paused_at = null, paused_by = null, pause_reason = null, pause_review_on = null where title = ${paused}`
    try {
      expect(await cold()).toBe(n + 1)
    } finally {
      await sql`update crm.deals set paused_at = now(), pause_reason = 'Cierra presupuesto en enero', pause_review_on = current_date + 20 where title = ${paused}`
    }
  })
})

test.describe('pantalla de inicio por rol', () => {
  const homes: [string, string, string][] = [
    ['nora.salas', '/admin', 'administración'],
    ['luis.tovar', '/panel-lt', 'leadership'],
    ['ana.robles', '/supervisor', 'quien lidera el mercado'],
    ['fernando.ibarra', '/hoy', 'supervisión'],
    ['marco.pena', '/hoy', 'ventas'],
    ['tom.reyes', '/operaciones', 'operaciones'],
  ]
  for (const [persona, home, role] of homes) {
    test(`${role} entra a ${home}; el logo y la raíz llevan al mismo lugar, y Hoy sigue en el dock`, async ({ page }) => {
      await loginAs(page, persona, { stay: true })
      await expect(page).toHaveURL(new RegExp(`${home}$`))
      await expect(page.getByTestId('home-link')).toHaveAttribute('href', home)
      await page.goto('/')
      await expect(page).toHaveURL(new RegExp(`${home}$`))
      await expect(page.getByTestId('dock')).toContainText(/Hoy|Today/)
    })
  }

  test('el primer ingreso pasa antes por la bienvenida, también para Operaciones y para quien lidera', async ({ page }) => {
    for (const [persona, home] of [['tom.reyes', '/operaciones'], ['ana.robles', '/supervisor']] as const) {
      const id = await uid(persona)
      await sql`delete from crm.user_onboarding where user_id = ${id}`
      await page.context().clearCookies()
      await page.goto('/login')
      await page.getByTestId(`persona-${persona}`).click()
      await expect(page).toHaveURL(/\/bienvenida$/)
      await loginAs(page, persona, { stay: true })
      await expect(page).toHaveURL(new RegExp(`${home}$`))
    }
  })

  test('en teléfono el menú de la cuenta de administración cabe y no repite entradas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'nora.salas', { stay: true })
    await spanish(page)
    await page.reload()
    await openMenu(page)
    const items = page.locator('[role=menuitem]')
    const labels = (await items.allInnerTexts()).map((x) => x.replace(/\s*\(\d+\)$/, '').trim())
    expect(new Set(labels).size, labels.join(' | ')).toBe(labels.length)
    expect(labels).toEqual(expect.arrayContaining(['Negocios cerrados', 'Administración', 'Ayuda', 'Reportar un problema']))
    // la configuración de Operaciones vive dentro de Administración, no como otra entrada del menú
    expect(labels).not.toContain('Catálogos de Operaciones')
    const last = await page.getByTestId('logout').boundingBox()
    expect(last!.y + last!.height).toBeLessThanOrEqual(844)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await page.keyboard.press('Escape')
    await page.goto('/admin')
    const pills = await page.locator('nav[aria-label="Secciones"] a').allInnerTexts()
    expect(new Set(pills).size, pills.join(' | ')).toBe(pills.length)
    expect(pills).toEqual(expect.arrayContaining(['Operaciones', 'Reportes', 'Auditoría']))
    await clean(page, 'administración en teléfono')
    await page.getByTestId('pill-operaciones').click()
    await expect(page).toHaveURL(/\/admin\/operaciones$/)
    await page.getByTestId('ops-config-back').click()
    await expect(page).toHaveURL(/\/admin$/)
  })
})

test('el Panel del LT abre los leads del periodo, no todos los del mercado', async ({ page }) => {
  await loginAs(page, 'luis.tovar', { stay: true })
  await spanish(page)
  await page.goto('/panel-lt?periodo=semana&mercado=MX')
  const shown = Number((await page.getByTestId('lt-leads-link').locator('.num').innerText()).replace(/[^\d]/g, ''))
  await page.getByTestId('lt-leads-link').click()
  await expect(page).toHaveURL(/\/leads\?/)
  await expect(page).toHaveURL(/status=all/)
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/)
  await expect(page.getByTestId('lead-period')).toContainText('Leads que llegaron del')
  const total = (await sql<{ n: number }[]>`
    select count(*)::int as n from crm.leads l
     where l.market_code = 'MX' and (l.created_at at time zone 'America/Mexico_City')::date >= ${new URL(page.url()).searchParams.get('from')}::date
       and (l.created_at at time zone 'America/Mexico_City')::date <= ${new URL(page.url()).searchParams.get('to')}::date`)[0]!.n
  expect(shown).toBe(total)
})
