import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

// Paquete ia: IA-02 (siguiente acción explicable), IA-03 (calificación de leads), IA-05 (preguntas sobre cifras), IA-04 (nivel por
// mercado y borradores), IA-08 (evaluación) e IA-06 (servidor MCP apagado). Ningún modelo de IA está conectado.

async function check(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`), `${what}: accesibilidad`).toEqual([])
}
const dialog = (page: Page) => page.locator('dialog[open]')

test.afterAll(async () => {
  const db = testDb()
  await db`update crm.ia_settings set level = 'suggest' where market_code = 'MX'`
  await db.end()
})

test.describe.serial('Asistencia por reglas', () => {
  test('administración corre la tarea de sugerencias y quien vende acepta una con fecha y descarta otra con motivo', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones?v=tareas')
    const row = page.locator('[data-testid="job-row"][data-key="ia.next_actions"]')
    await expect(row).toBeVisible()
    await row.getByTestId('job-run-btn').click()
    // Al abrir la app el corredor puede haberla empezado ya: cualquiera de los dos avisos sirve.
    await expect(page.getByTestId('admin-notice')).toContainText(/Tarea corrida|ya está corriendo/)

    await loginAs(page, 'marco.pena', { stay: true })
    await page.goto('/asistencia')
    const list = page.getByTestId('rec-list')
    await expect(async () => {
      await page.reload()
      await expect(list.getByTestId('rec-item').first()).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 30_000 })
    await expect(list.getByTestId('rec-reason').first()).toContainText(/^Porque /)
    await expect(list).toContainText('Sugerido por una regla de CONTIGO, no por IA.')
    const count = await list.getByTestId('rec-item').count()
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 })
      await check(page, `Asistencia ${w}`)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await list.getByTestId('rec-item').first().getByTestId('rec-accept').click()
    await dialog(page).getByTestId('rec-due').fill('2030-02-01')
    await dialog(page).getByTestId('rec-accept-save').click()
    await expect(list.getByTestId('rec-item')).toHaveCount(count - 1)

    await list.getByTestId('rec-item').first().getByTestId('rec-dismiss').click()
    await dialog(page).getByTestId('rec-dismiss-other').check()
    await dialog(page).getByTestId('rec-dismiss-save').click()
    await expect(dialog(page).getByTestId('form-error')).toBeVisible()
    await dialog(page).getByTestId('rec-note').fill('La tienda cerró por remodelación')
    await dialog(page).getByTestId('rec-dismiss-save').click()
    await expect(list.getByTestId('rec-item')).toHaveCount(count - 2)
    expect(errors).toEqual([])
  })

  test('la ficha del comercio trae el resumen por reglas y sus sugerencias; la nota se puede dictar donde el navegador lo permite', async ({ page }) => {
    await loginAs(page, 'marco.pena', { stay: true })
    const db = testDb()
    const acc = (await db<{ account_id: string }[]>`select r.account_id from crm.recommendations r join crm.users u on u.id = r.owner_id
      where r.status = 'open' and not r.holdout and u.email = 'marco.pena@contigo.test' limit 1`)[0]!
    await db.end()
    await page.goto(`/comercios/${acc.account_id}`)
    const next = page.getByTestId('account-next')
    await expect(next.getByTestId('account-brief')).toContainText(/días sin contacto/)
    await expect(next.getByTestId('rec-item').first()).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'Ficha con siguiente acción 390')
  })

  test('el lead muestra su calificación con cada punto y quien lo trabaja confirma la clasificación', async ({ page }) => {
    await loginAs(page, 'marco.pena', { stay: true })
    const db = testDb()
    const lead = (await db<{ id: string }[]>`select l.id from crm.leads l join crm.users u on u.id = l.owner_id where u.email = 'marco.pena@contigo.test' and l.status in ('new','contacted') order by l.created_at desc limit 1`)[0]!
    await db.end()
    await page.goto(`/leads/${lead.id}`)
    const card = page.getByTestId('lead-score')
    await expect(card.getByTestId('lead-score-value')).toHaveText(/^\d+$/)
    await expect(card).toContainText('No la calcula una IA.')
    await card.getByTestId('lead-class-select').selectOption('store')
    await card.getByTestId('lead-class-confirm').click()
    await expect(card.getByTestId('lead-class-confirmed')).toContainText('Punto de venta')
  })

  test('quien lidera pregunta por una cifra definida y recibe el número con su definición y su corte; lo demás no se adivina', async ({ page }) => {
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/asistencia?tab=preguntas')
    await page.getByTestId('ask-q').fill('¿Cuántos negocios hay abiertos?')
    await page.getByTestId('ask-go').click()
    await expect(page.getByTestId('ask-value')).toHaveText(/\d/)
    await expect(page.getByTestId('ask-def')).toContainText('Cómo se calcula')
    await expect(page.getByTestId('ask-cut')).toContainText('Corte')
    await page.getByTestId('ask-q').fill('¿cuál es el sueldo de cada vendedor?')
    await page.getByTestId('ask-go').click()
    await expect(page.getByTestId('ask-out')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'Preguntas 390')
  })

  test('administración sube el mercado a "ejecuta con aprobación" con quien revisa; quien vende aprueba un borrador', async ({ page }) => {
    // IA-07 (plataforma): un nivel que actúa pide la revisión de red-team aprobada de cada agente. Aquí se deja por la base;
    // el recorrido por pantalla está en zx-plataforma.spec.ts.
    const rt = testDb()
    await rt`insert into crm.agent_redteam_reviews (agent_key, checklist, passed, notes, reviewed_by)
             values ('rules_next_action', '{}'::jsonb, true, 'Revisión de prueba del recorrido de IA.', md5('contigo:nora.salas')::uuid)`
    await rt.end()
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin')
    await page.getByTestId('pill-ia').click()
    await expect(page).toHaveURL(/\/admin\/ia/)
    await expect(page.getByTestId('ia-adapter')).toContainText('IA apagada')
    await page.getByTestId('ia-level-MX').click()
    await dialog(page).getByTestId('ia-level-select').selectOption('execute')
    await dialog(page).getByTestId('ia-level-save').click()
    await expect(dialog(page).getByTestId('form-error')).toContainText('nombra a la persona')
    await dialog(page).getByTestId('ia-supervisor-select').selectOption({ label: 'Ana Robles' })
    await dialog(page).getByTestId('ia-level-save').click()
    await expect(page.getByTestId('ia-market-MX')).toContainText('Ejecuta con aprobación')
    await check(page, 'IA y asistencia 1440')

    const db = testDb()
    await db`update crm.recommendations set status = 'expired' where status = 'open' and market_code = 'MX'`
    await db.end()
    await page.goto('/admin/automatizaciones?v=tareas')
    const row = page.locator('[data-testid="job-row"][data-key="ia.next_actions"]')
    await row.getByTestId('job-run-btn').click()
    // Al abrir la app el corredor puede haberla empezado ya: cualquiera de los dos avisos sirve.
    await expect(page.getByTestId('admin-notice')).toContainText(/Tarea corrida|ya está corriendo/)

    await loginAs(page, 'marco.pena', { stay: true })
    await page.goto('/asistencia?tab=borradores')
    const drafts = page.getByTestId('draft-list').getByTestId('draft-item')
    await expect(async () => {
      await page.reload()
      await expect(drafts.first()).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 30_000 })
    const n = await drafts.count()
    await drafts.first().getByTestId('draft-approve').click()
    await expect(dialog(page).getByTestId('draft-due')).not.toHaveValue('')
    await dialog(page).getByTestId('draft-approve-save').click()
    await expect(drafts).toHaveCount(n - 1)
  })

  test('evaluación: las reglas pasan su banco de casos y con la IA apagada ninguna función puede encenderse; el servidor MCP no existe', async ({ page, request }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/ia?tab=evaluacion')
    const row = page.getByTestId('ia-eval-lead_class')
    await row.getByTestId('ia-eval-run-lead_class').click()
    await expect(row.getByTestId('ia-eval-rules')).toContainText('7/7')
    await expect(row.getByTestId('ia-eval-gate')).toContainText('No')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'Evaluación 390')
    await page.goto('/admin/ia?tab=mcp')
    await expect(page.getByTestId('ia-mcp-tool')).toHaveCount(4)
    expect((await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status()).toBe(404)
    await page.goto('/estado')
    await expect(page.getByText('Servidor MCP de solo lectura')).toBeVisible()
  })

  test('en inglés: Assistance dice AI y no deja texto en español', async ({ page }) => {
    await loginAs(page, 'kira.dunn', { stay: true })
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.goto('/asistencia?tab=preguntas')
    await expect(page.getByRole('heading', { name: 'Assistance' })).toBeVisible()
    await expect(page.locator('main')).toContainText('AI is off')
    await expect(page.locator('main')).not.toContainText(/Sugerencias|Preguntas sobre|IA apagada/)
  })
})
