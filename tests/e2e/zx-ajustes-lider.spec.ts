import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb } from './helpers'

// Ola 4, paquete ajustes-lider: lo que la ronda de aceptación dejó abierto para liderazgo de México B2B y para administración y LT.

const tag = () => Math.random().toString(36).slice(2, 8)
async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
/** Un lead nuevo de B2B, asignado a la persona, con la meta de primer contacto corriendo. */
async function newLead(persona: string, name: string, minutes = 45) {
  const sql = testDb()
  try {
    const rows = await sql<{ id: string }[]>`
      insert into crm.leads (market_code, source, motor, business_name, contact_name, phone, status, owner_id, assigned_at, sla_due_at)
      values ('MX', 'manual', 'b2b', ${name}, 'Persona de Prueba', ${`+52558${Math.floor(1_000_000 + Math.random() * 8_999_999)}`}, 'new',
              md5(${'contigo:' + persona})::uuid, now(), now() + make_interval(mins => ${minutes})) returning id`
    return rows[0]!.id
  } finally {
    await sql.end()
  }
}

test.describe('el lead nuevo avisa dentro de CONTIGO', () => {
  test('el contador y el título de la pestaña se actualizan solos, y el aviso del navegador se activa desde el menú', async ({ page }) => {
    // Notification API simulada: registra lo que la página pide, sin depender del sistema operativo de la prueba.
    await page.addInitScript(() => {
      const calls: { title: string; body?: string }[] = []
      ;(window as unknown as { __notes: typeof calls }).__notes = calls
      class Fake {
        static permission = 'default'
        static requestPermission = async () => { Fake.permission = 'granted'; return 'granted' }
        onclick: (() => void) | null = null
        constructor(title: string, opts?: { body?: string }) { calls.push({ title, body: opts?.body }) }
        close() {}
      }
      ;(window as unknown as { Notification: unknown }).Notification = Fake
    })
    const errors = pageErrors(page)
    await loginAs(page, 'diana.cruz')
    await expect(page.getByTestId('lead-watch')).toHaveAttribute('data-every', '60000')
    const badge = page.getByTestId('nav-leads-badge')
    const before = (await badge.count()) ? Number(await badge.textContent()) : 0

    await openMenu(page)
    const toggle = page.getByTestId('lead-alert-toggle')
    await expect(toggle).toContainText('Avisarme cuando llegue un lead')
    await expect(toggle).toContainText('No llega por correo ni por Slack')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')

    const name = `Cadena Aviso ${tag()}`
    await newLead('diana.cruz', name)
    // La vuelta de cada minuto, adelantada: la app pregunta y se entera sin que nadie recargue.
    await page.evaluate(() => window.dispatchEvent(new Event('contigo:poll')))
    await expect(page).toHaveTitle(/^\(1\) Lead nuevo · /)
    await expect(badge).toHaveText(String(before + 1))
    await expect(page.getByText(name).first()).toBeVisible()
    const notes = await page.evaluate(() => (window as unknown as { __notes: { title: string; body?: string }[] }).__notes)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.title).toBe('Lead nuevo en axexo CONTIGO')
    expect(notes[0]!.body).toContain(name)

    // Al cambiar de pantalla el título vuelve a ser el de siempre; apagar el aviso deja de lanzarlo.
    await page.getByTestId('nav-leads').click()
    await expect(page).toHaveURL(/\/leads/)
    await expect(page).not.toHaveTitle(/Lead nuevo/)
    await openMenu(page)
    await page.getByTestId('lead-alert-toggle').click()
    await expect(page.getByTestId('lead-alert-toggle')).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await newLead('diana.cruz', `Cadena Aviso ${tag()}`)
    await page.evaluate(() => window.dispatchEvent(new Event('contigo:poll')))
    await expect(page).toHaveTitle(/^\(1\) Lead nuevo · /)
    expect(await page.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes.length)).toBe(1)
    expect(errors).toEqual([])
  })

  test('quien lidera ve en Mi equipo la guardia de leads con minutos hábiles, y el aviso del equipo sin supervisión', async ({ page }) => {
    const name = `Guardia ${tag()}`
    const sql = testDb()
    const paula = (await sql<{ id: string; valid_to: Date | null }[]>`
      select id, valid_to from crm.memberships where user_id = md5('contigo:paula.mendez')::uuid and role = 'supervisor' and (valid_to is null or valid_to > now())`)[0]!
    try {
      await sql`update crm.market_hours set days = '{1,2,3,4,5,6,7}', opens = '00:00', closes = '23:59' where market_code = 'MX'`
      await newLead('diana.cruz', name, 45)
      await sql`update crm.memberships set valid_to = now() - interval '1 minute' where id = ${paula.id}`
      await loginAs(page, 'ana.robles', { stay: true })
      await expect(page).toHaveURL(/\/supervisor$/)
      const card = page.getByTestId('lead-watch-card')
      await expect(card).toContainText('Guardia de leads')
      const row = card.getByTestId('watch-row').filter({ hasText: name })
      await expect(row).toContainText('Diana Cruz')
      await expect(row.getByTestId('watch-left')).toHaveText(/^Quedan 4[3-5] min hábiles$/)

      const notice = page.getByTestId('team-uncovered')
      await expect(notice).toContainText('Sin supervisión: lo cubre quien lidera el mercado')
      await expect(notice).toContainText('B2B')
      await noOverflow(page, 'Mi equipo 1440')
      await axeClean(page, 'Mi equipo con guardia')

      // El equipo elegido filtra la guardia, los pendientes y lo por repartir.
      const openAll = Number(((await page.getByTestId('exception-open').textContent()) ?? '0').replace(/[^\d]/g, ''))
      await notice.getByTestId('team-uncovered-link').first().click()
      await expect(page).toHaveURL(/equipo=/)
      await expect(page.getByTestId('lead-watch-card').getByTestId('watch-row').filter({ hasText: name })).toBeVisible()
      const openTeam = Number(((await page.getByTestId('exception-open').textContent()) ?? '0').replace(/[^\d]/g, ''))
      expect(openTeam).toBeLessThan(openAll)
      await page.setViewportSize({ width: 390, height: 844 })
      await noOverflow(page, 'Mi equipo 390')
    } finally {
      await sql`update crm.memberships set valid_to = ${paula.valid_to} where id = ${paula.id}`
      await sql`update crm.market_hours set days = '{1,2,3,4,5}', opens = '09:00', closes = '18:00' where market_code = 'MX'`
      await sql.end()
    }
  })
})

test.describe('filtros y tablero', () => {
  test('Leads filtra por tipo de venta y por equipo; la fila dice el tipo de venta', async ({ page }) => {
    const name = `Filtro B2B ${tag()}`
    await newLead('diana.cruz', name)
    await loginAs(page, 'ana.robles')
    await page.goto('/leads')
    await page.getByTestId('lead-f-motor').selectOption('b2b')
    await page.getByTestId('lead-apply').click()
    await expect(page).toHaveURL(/motor=b2b/)
    await expect(page.getByTestId('lead-row').filter({ hasText: name })).toContainText('Cadenas')
    const rows = await page.getByTestId('lead-row').allTextContents()
    expect(rows.length).toBeGreaterThan(0)
    await page.getByTestId('lead-f-team').selectOption({ label: 'D2D Centro' })
    await page.getByTestId('lead-apply').click()
    await expect(page).toHaveURL(/equipo=/)
    await expect(page.getByTestId('lead-row').filter({ hasText: name })).toHaveCount(0)
    await page.getByTestId('lead-clear').click()
    await expect(page).not.toHaveURL(/motor=/)
  })

  test('el tablero B2B de 8 etapas cabe a 1440 px y la lista se ordena por monto y por días en la etapa', async ({ page }) => {
    const sql = testDb()
    const pipe = (await sql<{ id: string; stages: number }[]>`
      select p.id, (select count(*)::int from crm.stages s where s.pipeline_id = p.id and s.archived_at is null and s.kind in ('open', 'awaiting_txn')) as stages
        from crm.pipelines p where p.market_code = 'MX' and p.motor = 'b2b'`)[0]!
    await sql.end()
    expect(pipe.stages).toBeGreaterThan(5)
    await loginAs(page, 'ana.robles')
    await page.goto(`/pipelines/${pipe.id}`)
    const board = page.getByTestId('board')
    await expect(board).toHaveAttribute('data-wide', '1')
    // Todas las columnas a la vista, sin desplazamiento lateral dentro del tablero ni en la página.
    const fit = await board.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, width: el.getBoundingClientRect().width }))
    expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1)
    expect(fit.width).toBeGreaterThan(1300)
    await noOverflow(page, 'tablero B2B 1440')

    await page.getByTestId('view-list').click()
    await page.getByTestId('order-amount').click()
    await expect(page).toHaveURL(/orden=monto/)
    await expect(page.getByTestId('order-amount')).toHaveAttribute('aria-current', 'page')
    const amounts = (await page.getByTestId('deal-list-row').locator('span.num').allTextContents()).map((s) => Number(s.replace(/[^\d.]/g, '')) || 0)
    expect(amounts.length).toBeGreaterThan(1)
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a))
    await page.getByTestId('order-days').click()
    await expect(page).toHaveURL(/orden=dias/)
    const days = (await page.getByTestId('deal-list-row').allTextContents()).map((s) => Number(/(\d+)\s*(?:día|d\b)/.exec(s)?.[1] ?? '0'))
    expect(days).toEqual([...days].sort((a, b) => b - a))
  })
})

test.describe('leadership y administración', () => {
  test('dar Administración nombra el alcance, a quién y hasta cuándo; un dominio no admitido dice a quién pedirlo', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=personas')
    await page.getByTestId('grant-open').click()
    const dialog = page.locator('dialog[open]')
    await dialog.getByTestId('grant-role').selectOption('admin')
    await expect(dialog.getByTestId('grant-admin-scope')).toHaveText('Administración ve y cambia todo, en todos los mercados.')
    await expect(dialog.getByTestId('grant-admin-for')).toHaveText('Falta escribir el correo de la persona.')
    await expect(dialog.getByTestId('grant-admin-until')).toContainText('Sin fecha de fin')
    await dialog.getByTestId('grant-email').fill(`externa.${tag()}@emida.net`)
    await dialog.getByTestId('grant-name').fill('Persona Externa')
    await expect(dialog.getByTestId('grant-admin-for')).toContainText('@emida.net')
    await expect(dialog.getByTestId('grant-admin-external')).toContainText('emida.net, un dominio distinto al tuyo')
    const until = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
    await dialog.getByTestId('grant-expires').fill(until)
    await expect(dialog.getByTestId('grant-admin-until')).toContainText('Fin del acceso: vence el')
    // Sin marcar la casilla no se otorga, y el mensaje repite el alcance.
    await dialog.getByTestId('grant-save').click()
    await expect(dialog.getByTestId('form-error')).toContainText('ve y cambia todo, en todos los mercados')
    await dialog.getByTestId('grant-admin-check').check()
    await dialog.getByTestId('grant-save').click()
    await expect(page.getByTestId('admin-notice')).toContainText('Acceso otorgado. Vence el')
    const sql = testDb()
    const audit = (await sql<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'membership.granted' order by at desc, id desc limit 1`)[0]!
    await sql.end()
    expect(audit.after).toMatchObject({ role: 'admin', scope: 'all_markets', confirmed: true, external: true, expires: until })

    await page.getByTestId('grant-open').click()
    const again = page.locator('dialog[open]')
    await again.getByTestId('grant-email').fill(`alguien.${tag()}@empowerretailers.com`)
    await again.getByTestId('grant-name').fill('Otra Persona')
    await again.getByTestId('grant-save').click()
    await expect(again.getByTestId('form-error')).toContainText('necesita una cuenta de axexo.com, emida.com o emida.net')
    await expect(again.getByTestId('form-error')).toContainText('quien administra las cuentas de Google de la empresa')
  })

  test('Embudos y campos, Estado y Panel del LT dicen lo que es', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=embudos')
    const types = await page.getByTestId('field-type').allTextContents()
    expect(types.join(' ')).not.toContain('multiselect')
    expect(types).toContain('Lista de varias opciones')
    const same = await page.getByTestId('field-name').filter({ hasText: 'Constancia de situación fiscal' }).allTextContents()
    expect(same.sort()).toEqual(['Constancia de situación fiscal (solo si es Persona física)', 'Constancia de situación fiscal (solo si es Persona moral)'])

    await page.goto('/estado')
    await expect(page.getByTestId('status-version')).toContainText('Entorno local, sin versión')
    const pipedrive = page.getByTestId('status-integrations').locator('li').filter({ hasText: 'Pipedrive' }).first()
    await expect(pipedrive.getByTestId('status-state')).toContainText('Conexión configurada')
    await expect(pipedrive).not.toContainText('Conectado')

    await page.goto('/panel-lt')
    const rule = page.getByTestId('lt-won-rule')
    await expect(rule).toBeVisible()
    await expect(rule).not.toContainText('transacciona')
    // En inglés, lo mismo: nada de "won when it transacts" con embudos que se ganan a mano.
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.reload()
    await expect(page.getByTestId('lt-won-rule')).not.toContainText('when it transacts')
  })

  test.describe('con el navegador en hora de Puerto Rico', () => {
    test.use({ timezoneId: 'America/Puerto_Rico' })
    test('Adopción muestra las horas en la zona de quien mira y lo dice una sola vez', async ({ page }) => {
      await loginAs(page, 'luis.tovar', { stay: true })
      await page.goto('/reportes/adopcion')
      await expect(page.getByTestId('period-text')).toContainText('hora de Puerto Rico (GMT-4)')
      const list = page.getByTestId('adoption-list')
      await expect(list).toContainText('Las horas están en hora de Puerto Rico (GMT-4)')
      await expect(list).not.toContainText('Hora en hora')
      await expect(page.getByTestId('adoption-totals')).not.toContainText('UTC')
    })
  })
})

test.describe('entrada', () => {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`las cifras de ejemplo nunca se ven en 0 (prefers-reduced-motion: ${motion})`, async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: motion, viewport: { width: 1440, height: 900 }, locale: 'es-MX' })
      const page = await context.newPage()
      await page.goto('/login')
      await page.waitForLoadState('networkidle')
      // Sin recorrer la página (como una captura completa): cada cifra muestra su valor, no un cero a la espera de animarse.
      const figures = await page.locator('[data-count]').evaluateAll((els) => els.map((el) => ({ want: (el as HTMLElement).dataset.count ?? '', shown: (el.textContent ?? '').trim() })))
      expect(figures.length).toBeGreaterThan(3)
      for (const f of figures.filter((x) => x.want !== '0')) expect(f.shown, `cifra ${f.want}`).toBe(f.want)
      // Y después de recorrerla, terminan en su valor.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) }
      })
      await page.waitForTimeout(1300)
      const after = await page.locator('[data-count]').evaluateAll((els) => els.map((el) => ({ want: (el as HTMLElement).dataset.count ?? '', shown: (el.textContent ?? '').trim() })))
      for (const f of after) expect(f.shown, `cifra ${f.want} al final`).toBe(f.want)
      await context.close()
    })
  }
})
