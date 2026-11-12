import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, testDb, WIDTHS } from './helpers'

// Ola 2, paquete leads: los puntos del encargo vistos desde la pantalla, en inglés (US) y en español (MX).
const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
const uniq = () => Math.random().toString(36).slice(2, 8)
const usPhone = () => `+1702557${Math.floor(1000 + Math.random() * 8999)}`

/** Un lead de US puesto directo en la base: con dueño, con reloj corriendo o sin reloj (como los importados). */
async function usLead(opts: { owner: string | null; name?: string; clock?: boolean; source?: string; status?: string }): Promise<{ id: string; name: string; phone: string }> {
  const name = opts.name ?? `Zx Wireless ${uniq()}`
  const phone = usPhone()
  const sql = testDb()
  const rows = await sql<{ id: string }[]>`
    insert into crm.leads (market_code, source, motor, business_name, contact_name, phone, locality, status, owner_id, assigned_at, sla_due_at, created_at)
    select 'US', ${opts.source ?? 'manual'}, 'dealer', ${name}, 'Dana Fox', ${phone}, 'Las Vegas', ${opts.status ?? 'new'},
           (select id from crm.users where full_name = ${opts.owner}), now(),
           ${opts.clock === false ? null : sql`now() + interval '3 hours'`}, now() - interval '5 minutes'
    returning id`
  await sql.end()
  return { id: rows[0]!.id, name, phone }
}

test('US: un lead creado dentro de la tienda nace contactado, se convierte y su historia llega al comercio', async ({ page }) => {
  const name = `Corner Wireless ${uniq()}`
  await loginAs(page, 'jade.kim')
  await page.goto('/leads')
  await page.getByTestId('new-lead').click()
  // solo se ofrece el tipo de venta que tiene embudo en US: ya no abre en "Stores (D2D)"
  await expect(page.locator('select[name=motor] option').first()).toHaveText('Dealers')
  await expect(page.locator('select[name=motor] option').filter({ hasText: 'D2D' })).toHaveCount(0)
  await page.locator('input[name=business_name]').fill(name)
  await page.locator('input[name=contact_name]').fill('Alicia Ford')
  await page.locator('input[name=phone]').fill('(702) 555-0142')
  // sin origen no guarda: el alta manual lo pide
  await page.getByTestId('save-lead').click()
  await expect(page).toHaveURL(/\/leads$/)
  await page.getByTestId('lead-source').selectOption('walk_in')
  await page.getByTestId('lead-role').selectOption('manager')
  await page.getByTestId('lead-spoke').check()
  await page.getByTestId('save-lead').click()
  await expect(page.locator('h1')).toHaveText(name)
  // nace contactado: no hay reloj de una hora ni botón de registrar contacto, y el teléfono con Llamar está arriba
  await expect(page.getByTestId('lead-contacted')).toHaveCount(0)
  await expect(page.getByTestId('lead-steps')).not.toContainText('First contact: due')
  await expect(page.getByTestId('lead-callbar')).toContainText('702')
  await expect(page.getByText('First contact: in person, when the lead was added')).toBeVisible()
  await page.locator('input[name=subject]').fill('Asked for the price sheet')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Asked for the price sheet')).toBeVisible()

  await page.getByTestId('lead-qualify').click()
  // la hoja de conversión confirma el tipo de cuenta y el rol; con un solo embudo en el mercado no hay que elegirlo
  await expect(page.getByTestId('lead-kind')).toHaveValue('store')
  await expect(page.getByTestId('lead-contact-role')).toHaveValue('manager')
  const db = testDb()
  const usPipes = (await db<{ n: number }[]>`select count(*)::int as n from crm.pipelines p where p.market_code = 'US' and p.is_active and exists (select 1 from crm.stages s where s.pipeline_id = p.id)`)[0]!.n
  await db.end()
  await expect(page.getByTestId('lead-pipeline')).toHaveCount(usPipes === 1 ? 0 : 1)
  await page.getByTestId('lead-convert').click()
  await expect(page).toHaveURL(/\/deals\//)
  await expect(page.locator('h1')).toHaveText(`Onboarding: ${name}`)
  await page.getByTestId('deal-account').click()
  await expect(page.locator('h1')).toHaveText(name)
  await fichaTab(page, 'hilo')
  await expect(page.getByTestId('ficha')).toContainText('Asked for the price sheet')
  await expect(page.getByTestId('ficha')).toContainText('First contact: in person')
  await fichaTab(page, 'datos')
  await expect(page.getByTestId('contact-row')).toContainText('Manager')
})

test('MX: el tipo se corrige en el lead y al convertir se elige el embudo; un lead B2B no nace como tienda', async ({ page }) => {
  const name = `Distribuidora Zx ${uniq()}`
  await loginAs(page, 'diana.cruz')
  await page.goto('/leads')
  await page.getByTestId('new-lead').click()
  await page.locator('select[name=motor]').selectOption('d2d')
  await page.locator('input[name=business_name]').fill(name)
  await page.locator('input[name=contact_name]').fill('Raúl Peña')
  await page.locator('input[name=phone]').fill('55 4321 ' + Math.floor(1000 + Math.random() * 8999))
  await page.getByTestId('lead-source').selectOption('referral')
  await page.getByTestId('save-lead').click()
  await expect(page.locator('h1')).toHaveText(name)
  // el reloj dice a qué hora vence, en hora del mercado
  await expect(page.getByTestId('lead-steps')).toContainText(/Primer contacto: vence el .+, hora de México/)
  await page.getByTestId('lead-edit-type').click()
  await page.getByTestId('lead-edit-motor').selectOption('b2b')
  await page.getByTestId('lead-edit-kind').selectOption('distributor')
  await page.getByTestId('lead-edit-role').selectOption('purchasing')
  await page.getByTestId('lead-edit-save').click()
  await expect(page.getByTestId('lead-motor')).toHaveText('Cadenas y distribuidores')
  await expect(page.getByTestId('lead-kind-text')).toHaveText('Distribuidor')
  await page.getByTestId('lead-qualify').click()
  expect(await page.getByTestId('lead-pipeline').locator('option').count()).toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('lead-pipeline').locator('option:checked')).toHaveText('Cadenas y distribuidores')
  await expect(page.getByTestId('lead-kind')).toHaveValue('distributor')
  await expect(page.getByTestId('lead-contact-role')).toHaveValue('purchasing')
  await page.getByTestId('lead-convert').click()
  await expect(page).toHaveURL(/\/deals\//)
  await expect(page.locator('[data-testid=stage-path] [aria-current=step]')).toHaveText('Calificación')
  await page.getByTestId('deal-account').click()
  await fichaTab(page, 'datos')
  await expect(page.getByTestId('contact-row')).toContainText('Compras')
  const sql = testDb()
  const acc = await sql`select kind from crm.accounts where name = ${name}`
  await sql.end()
  expect(acc[0]!.kind).toBe('distributor')
})

for (const w of WIDTHS) {
  test.describe(`Lead en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('el teléfono y Llamar quedan arriba y siguen ahí después de un intento sin respuesta', async ({ page }) => {
      const lead = await usLead({ owner: 'Jade Kim' })
      await loginAs(page, 'jade.kim')
      await page.goto(`/leads/${lead.id}`)
      const bar = page.getByTestId('lead-callbar')
      await expect(bar.getByTestId('lead-call')).toHaveAttribute('data-tel', `tel:${lead.phone}`)
      const top = async () => (await bar.boundingBox())!.y
      const steps = async () => (await page.getByTestId('lead-steps').boundingBox())!.y
      expect(await top()).toBeLessThan(await steps())
      if (w.width < 768) expect(await top()).toBeLessThan(w.height / 2)
      await noSideScroll(page)
      await axe(page, `lead ${w.name}`)
      // un intento sin respuesta: el lead sigue sin contactar y el botón no se pierde
      await page.getByTestId('lead-contacted').click()
      const sheet = page.locator('[data-testid="complete-sheet"][open]')
      await sheet.getByText('No answer', { exact: true }).click()
      await sheet.getByText('Call', { exact: true }).click()
      await sheet.getByTestId('sheet-save').click()
      await expect(page.getByTestId('toast')).toBeVisible()
      await expect(page.getByTestId('lead-steps')).toContainText('There was a contact attempt, with no answer.')
      await expect(bar.getByTestId('lead-call')).toBeVisible()
      await page.goto(`/leads?owner=me&q=${encodeURIComponent(lead.name)}`)
      const row = page.getByTestId('lead-row').filter({ hasText: lead.name })
      await expect(row.getByTestId('lead-call')).toBeVisible()
      await expect(row.getByTestId('lead-clock-text')).toHaveText('First attempt on time')
      if (w.width < 768) await expect(row.getByTestId('lead-owner-small')).toHaveText('Jade Kim')
      // filtros y cierre en bloque caben en el ancho y pasan accesibilidad
      await row.getByTestId('lead-check').check()
      await expect(page.getByTestId('lead-bulk-close')).toBeVisible()
      await noSideScroll(page)
      await axe(page, `leads con filtros ${w.name}`)
      const box = await row.getByTestId('lead-check').locator('xpath=..').boundingBox()
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44)
    })
  })
}

test('lista de Leads: buscar, filtrar por reloj y origen, ordenar y cerrar varios como no calificados', async ({ page }) => {
  const tag = uniq()
  const old = await Promise.all([1, 2, 3].map((n) => usLead({ owner: 'Jade Kim', name: `Imported ${tag} ${n}`, clock: false, source: 'import' })))
  const live = await usLead({ owner: 'Jade Kim', name: `Imported ${tag} live` })
  const others = await usLead({ owner: 'Sam Ortiz', name: `Imported ${tag} sam`, clock: false, source: 'import' })
  await loginAs(page, 'jade.kim')
  await page.goto('/leads')
  await page.getByTestId('lead-q').fill(tag)
  await page.getByTestId('lead-apply').click()
  await expect(page.getByTestId('lead-row')).toHaveCount(4) // los suyos; el de Sam no es suyo y no lo ve
  // por teléfono, con el formato que sea
  await page.getByTestId('lead-q').fill(`(702) 557-${live.phone.slice(-4)}`)
  await page.getByTestId('lead-apply').click()
  await expect(page.getByTestId('lead-row')).toHaveCount(1)
  await expect(page.getByTestId('lead-row')).toContainText(live.name)
  // sin reloj + origen importación + más antiguos
  await page.getByTestId('lead-q').fill(tag)
  await page.getByTestId('lead-f-clock').selectOption('without')
  await page.getByTestId('lead-f-source').selectOption('import')
  await page.getByTestId('lead-f-sort').selectOption('oldest')
  await page.getByTestId('lead-apply').click()
  await expect(page).toHaveURL(/clock=without/)
  await expect(page.getByTestId('lead-row')).toHaveCount(3)
  await page.getByTestId('lead-f-sort').selectOption('due')
  await page.getByTestId('lead-f-clock').selectOption('')
  await page.getByTestId('lead-f-source').selectOption('')
  await page.getByTestId('lead-apply').click()
  await expect(page.getByTestId('lead-row')).toHaveCount(1) // vence primero: solo el que tiene reloj
  await page.getByTestId('lead-clear').click()
  await expect(page).toHaveURL(/\/leads\?status=open$/)
  await expect(page.getByTestId('lead-f-sort')).toHaveValue('')
  await page.getByTestId('lead-q').fill(tag)
  await page.getByTestId('lead-f-clock').selectOption('without')
  await page.getByTestId('lead-apply').click()
  await expect(page).toHaveURL(/clock=without/)
  await expect(page.getByTestId('lead-row')).toHaveCount(3)
  // seleccionar todos los de la página y cerrarlos con un motivo
  await page.getByTestId('lead-select-all').check()
  await expect(page.getByTestId('lead-bulk')).toContainText('3 leads selected')
  await page.getByTestId('lead-bulk-reason').selectOption('no_response')
  await page.getByTestId('lead-bulk-close').click()
  await expect(page.getByTestId('lead-bulk-ok')).toContainText('3 leads closed')
  await expect(page.getByTestId('lead-row')).toHaveCount(0)
  const sql = testDb()
  const rows = await sql`select l.status, l.disqualify_code, (select count(*)::int from crm.audit_events e where e.object_id = l.id and e.action = 'lead.disqualified' and (e.after->>'bulk')::boolean) as logged
                           from crm.leads l where l.id = any(${old.map((o) => o.id)}::uuid[])`
  const untouched = await sql`select status from crm.leads where id = any(${[live.id, others.id]}::uuid[])`
  await sql.end()
  expect(rows.map((r) => [r.status, r.disqualify_code, r.logged])).toEqual([['disqualified', 'no_response', 1], ['disqualified', 'no_response', 1], ['disqualified', 'no_response', 1]])
  expect(untouched.map((r) => r.status)).toEqual(['new', 'new'])

  // supervisión filtra por persona y por "sin dueño"
  await loginAs(page, 'kira.dunn')
  await page.goto(`/leads?q=${tag}`)
  await page.getByTestId('lead-f-owner').selectOption({ label: 'Sam Ortiz' })
  await page.getByTestId('lead-apply').click()
  await expect(page.getByTestId('lead-row')).toHaveCount(1)
  await expect(page.getByTestId('lead-row')).toContainText(others.name)
})

test('búsqueda: lo que es de otra persona aparece como "existe y lo lleva X", sin enlace ni teléfono', async ({ page }) => {
  const sql = testDb()
  const acc = (await sql<{ name: string; phone: string }[]>`
    select a.name, a.phone from crm.accounts a join crm.users u on u.id = a.owner_id
     where u.full_name = 'Sam Ortiz' and a.market_code = 'US' and a.archived_at is null and a.phone is not null order by a.id limit 1`)[0]!
  await sql.end()
  const lead = await usLead({ owner: 'Sam Ortiz' })
  await loginAs(page, 'jade.kim')
  await page.goto(`/buscar?q=${encodeURIComponent(lead.name)}`)
  const others = page.getByTestId('search-others')
  await expect(others.getByTestId('search-other')).toHaveCount(1)
  await expect(others).toContainText(lead.name)
  await expect(others.getByTestId('search-other-owner')).toHaveText('Sam Ortiz has it')
  await expect(others).toContainText('ask your supervisor')
  await expect(others.locator('a')).toHaveCount(0)
  await expect(others).not.toContainText(lead.phone.slice(-4))
  await expect(page.getByTestId('search-leads')).toHaveCount(0)
  await page.goto(`/buscar?q=${encodeURIComponent(acc.name)}`)
  await expect(page.getByTestId('search-others')).toContainText(acc.name)
  await expect(page.getByTestId('search-others')).toContainText('Sam Ortiz has it')
  await noSideScroll(page)
  await axe(page, 'buscar con resultados de otra persona')
  // quien vende en México no se entera de lo que existe en US
  await loginAs(page, 'marco.pena')
  await page.goto(`/buscar?q=${encodeURIComponent(lead.name)}`)
  await expect(page.getByTestId('search-others')).toHaveCount(0)
})

test('pasar un lead a un compañero con nota, y soltar un lead para que otra persona lo tome', async ({ page }) => {
  const passed = await usLead({ owner: 'Sam Ortiz' })
  const released = await usLead({ owner: 'Sam Ortiz' })
  await loginAs(page, 'sam.ortiz')
  await page.goto(`/leads/${passed.id}`)
  await page.getByTestId('lead-pass').click()
  // sin nota no pasa
  await page.getByTestId('lead-pass-to').selectOption({ label: 'Jade Kim' })
  await page.getByTestId('lead-pass-confirm').click()
  await expect(page).toHaveURL(new RegExp(`/leads/${passed.id}$`))
  await page.getByTestId('lead-pass-note').fill('She is in Baltimore, your area. Call before noon.')
  await page.getByTestId('lead-pass-confirm').click()
  await expect(page).toHaveURL(/\/leads$/)
  await page.goto(`/leads?q=${encodeURIComponent(passed.name)}`)
  await expect(page.getByTestId('lead-row')).toHaveCount(0) // ya no es suyo

  await page.goto(`/leads/${released.id}`)
  await page.getByTestId('lead-release').click()
  await page.getByTestId('lead-release-reason').fill('Out of my territory')
  await page.getByTestId('lead-release-confirm').click()
  await expect(page.getByTestId('lead-owner')).toContainText('No owner')
  await expect(page.getByTestId('lead-free')).toBeVisible()

  await loginAs(page, 'jade.kim')
  // el lead que le pasaron ya es suyo, con su reloj, y la nota está en el hilo (que entra a Hoy lo prueba tests/db/leads.test.ts)
  await page.goto(`/leads?owner=me&q=${encodeURIComponent(passed.name)}`)
  await expect(page.getByTestId('lead-row').getByTestId('lead-state')).toHaveText('Not contacted')
  await page.goto(`/leads/${passed.id}`)
  await expect(page.getByTestId('lead-owner')).toContainText('Jade Kim')
  await expect(page.getByText('Sam Ortiz passed this lead to Jade Kim')).toBeVisible()
  await expect(page.getByText('She is in Baltimore, your area. Call before noon.')).toBeVisible()
  // el lead suelto aparece con el filtro "No owner" y se puede tomar
  await page.goto(`/leads?owner=none&q=${encodeURIComponent(released.name)}`)
  await expect(page.getByTestId('pill-unowned')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('lead-row')).toHaveCount(1)
  await expect(page.getByTestId('lead-row').getByTestId('lead-take-call')).toBeVisible()
  const sql = testDb()
  const log = await sql`select action from crm.audit_events where object_id = any(${[passed.id, released.id]}::uuid[]) and action in ('lead.passed', 'lead.released') order by action`
  await sql.end()
  expect(log.map((r) => r.action)).toEqual(['lead.passed', 'lead.released'])
})

test('administración cambia el horario hábil del mercado en Formularios y turnos', async ({ page }) => {
  await loginAs(page, 'nora.salas')
  await page.goto('/admin?tab=entrada')
  const form = page.getByTestId('hours-MX')
  await expect(form.getByTestId('hours-opens')).toHaveValue('09:00')
  await expect(form.getByTestId('hours-closes')).toHaveValue('18:00')
  await expect(form.getByTestId('hours-day-6')).not.toBeChecked()
  await form.getByTestId('hours-day-6').check()
  await form.getByTestId('hours-closes').fill('19:00')
  await form.getByTestId('hours-save').click()
  await expect(form.getByTestId('form-ok')).toContainText('Horario guardado')
  const sql = testDb()
  const h = await sql`select days, to_char(closes, 'HH24:MI') as closes from crm.market_hours where market_code = 'MX'`
  expect(h[0]).toMatchObject({ days: [1, 2, 3, 4, 5, 6], closes: '19:00' })
  // se deja como estaba para las demás pruebas
  await sql`update crm.market_hours set days = '{1,2,3,4,5}', closes = '18:00' where market_code = 'MX'`
  await sql.end()
  await noSideScroll(page)
  await axe(page, 'admin horario')
})
