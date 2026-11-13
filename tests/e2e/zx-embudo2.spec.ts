import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WIDTHS, loginAs, pageErrors, testDb } from './helpers'

// Paquete embudo2 (ola 6): valores propuestos del embudo, catálogo de motivos acotado, reglas de asignación editables y
// tienda saturada, hilo de solo agregar con correcciones y visibilidad, dueño de cada automatización, pasos de alta y crédito
// ACH propuestos, evidencia con huella y colas oficiales por rol con su contador en la barra.

const sql = testDb()
const started = new Date()
const tag = () => Math.random().toString(36).slice(2, 7)
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const setLocale = async (page: Page, locale: 'es' | 'en') => {
  await page.context().addCookies([{ name: 'contigo_locale', value: locale, url: page.url() }])
  await page.reload()
}
const vis = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true })
const at = async (page: Page, name: 'desktop' | 'tablet' | 'movil') => page.setViewportSize(WIDTHS.find((w) => w.name === name)!)

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function threeWidths(page: Page, label: string) {
  for (const w of ['desktop', 'tablet', 'movil'] as const) {
    await at(page, w)
    await clean(page, `${label}, ${w}`)
  }
  await at(page, 'desktop')
}

test.describe.configure({ mode: 'serial' })

test.describe('embudo2: residuos del embudo', () => {
  test.afterAll(async () => {
    await sql`update crm.stage_transitions set is_active = false, pending_owner = 'Operaciones' where pending_owner is null and is_active and updated_at >= ${started}`
    await sql`update crm.routing_suggestions set status = 'dismissed', decided_at = now() where status = 'open'`
    await sql`update crm.activities set done_at = now(), outcome = 'done' where done_at is null and created_at >= ${started} and source = 'rule'`
    await sql.end()
  })

  test('Administración: valores propuestos del embudo, tope de motivos y regla editable, en dos idiomas y tres anchos', async ({ page }) => {
    const errors = pageErrors(page)
    const ruleId = (await sql<{ id: string }[]>`
      insert into crm.assignment_rules (market_code, position, name, match, action, user_id)
      values ('MX', 90, ${`Zx regla ${tag()}`}, '{"sources":["web_form"]}', 'user', ${await uid('marco.pena')}) returning id`)[0]!.id
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/embudo')
    const settings = page.getByTestId('funnel-settings')
    await expect(settings.locator('[data-testid="funnel-setting"][data-key="next_step_max_days"]')).toContainText('Valor propuesto, [pendiente: Liderazgo comercial]')
    await expect(page.getByTestId('reason-caps').getByTestId('reason-cap-row').first()).toBeVisible()
    // Confirmar un valor propuesto: deja de ser propuesta y queda en la bitácora.
    const weeks = settings.locator('[data-testid="funnel-setting"][data-key="lead_sla_baseline_weeks"]')
    await weeks.getByTestId('funnel-setting-edit').click()
    await vis(page, 'funnel-setting-input').fill('6')
    await vis(page, 'funnel-setting-save').click()
    await expect(weeks.getByTestId('funnel-setting-value')).toHaveText('6')
    await expect(weeks.getByTestId('funnel-setting-proposed')).toHaveCount(0)
    // La condición de una regla se edita sin crear otra.
    const row = page.getByTestId('rule-row').filter({ hasText: 'Zx regla' })
    await row.getByTestId('rule-edit').click()
    await vis(page, 'rule-edit-name').fill('Zx regla editada')
    await vis(page, 'rule-edit-source-referral').check()
    await vis(page, 'rule-edit-save').click()
    await expect(page.getByTestId('rule-row').filter({ hasText: 'Zx regla editada' })).toBeVisible()
    expect((await sql<{ match: { sources: string[] } }[]>`select match from crm.assignment_rules where id = ${ruleId}`)[0]!.match.sources.sort()).toEqual(['referral', 'web_form'])
    await threeWidths(page, 'admin embudo')
    await setLocale(page, 'en')
    await expect(page.getByTestId('funnel-settings')).toContainText('Proposed value, [pending: Liderazgo comercial]')
    await expect(page.getByTestId('reason-caps')).toContainText('Reason catalog cap')
    await setLocale(page, 'es')
    await sql`update crm.assignment_rules set is_active = false where id = ${ruleId}`
    expect(errors).toEqual([])
  })

  test('Automatizaciones: dueño por confirmar y pasos de alta y crédito ACH propuestos, que administración activa', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones')
    const review = page.locator('[data-testid="auto-market"][data-market="MX"]').getByTestId('auto-owner-review').first()
    await expect(review).toContainText('Responsable por confirmar')
    const before = (await sql<{ n: number }[]>`select count(*)::int as n from crm.automations where owner_review`)[0]!.n
    await review.getByTestId('auto-owner-confirm-btn').click()
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int as n from crm.automations where owner_review`)[0]!.n).toBe(before - 1)
    expect((await sql<{ n: number }[]>`select count(*)::int as n from crm.automations where owner_id is null`)[0]!.n).toBe(0)

    await page.goto('/admin/automatizaciones?v=pasos')
    const proposed = page.getByTestId('step-row').filter({ has: page.getByTestId('step-proposed') })
    await expect(proposed).toHaveCount(2)
    await expect(proposed.first()).toContainText('Valor propuesto, [pendiente: Operaciones]')
    await threeWidths(page, 'pasos propuestos')
    await proposed.first().getByTestId('step-activate-btn').click()
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int as n from crm.stage_transitions where is_active and pending_owner is null`)[0]!.n).toBe(1)
  })

  test('Evidencia con huella para el paso de alta, desde la ficha del negocio', async ({ page }) => {
    const deal = (await sql<{ id: string; owner: string }[]>`
      select d.id, split_part(u.email, '@', 1) as owner from crm.deals d join crm.stages s on s.id = d.stage_id join crm.users u on u.id = d.owner_id
       where s.id = md5('contigo:s-mx-d2d-alta')::uuid and d.status = 'open' and d.paused_at is null and u.is_synthetic order by d.id limit 1`)[0]!
    await loginAs(page, deal.owner)
    await page.goto(`/deals/${deal.id}`)
    await page.getByTestId('evidence-add').click()
    await vis(page, 'evidence-hash').fill('ab'.repeat(32))
    await vis(page, 'evidence-note').fill('Expediente completo')
    await vis(page, 'evidence-save').click()
    await expect(page.getByTestId('evidence-list')).toContainText('huella abababababab')
  })

  test('Colas oficiales: el contador vive en la barra y abre la cola del rol', async ({ page }) => {
    const errors = pageErrors(page)
    const d = (await sql<{ id: string }[]>`select d.id from crm.deals d where d.owner_id = md5('contigo:marco.pena')::uuid and d.status = 'open' order by d.id limit 1`)[0]!
    await sql`update crm.deals set revisit_needed = true, revisit_due = (now() - interval '3 days')::date where id = ${d.id}`
    await loginAs(page, 'marco.pena')
    await expect(page.getByTestId('nav-official-count')).not.toHaveText('0')
    await page.getByTestId('nav-official-queues').click()
    await expect(page).toHaveURL(/\/colas$/)
    const q = page.getByTestId('official-queue').filter({ hasText: 'Revisitas vencidas' })
    await expect(q).toBeVisible()
    await threeWidths(page, 'colas oficiales')
    await setLocale(page, 'en')
    await expect(page.getByTestId('official-queue').filter({ hasText: 'Overdue revisits' })).toBeVisible()
    await setLocale(page, 'es')
    await page.getByTestId('official-queue').filter({ hasText: 'Revisitas vencidas' }).getByTestId('official-queue-link').click()
    await expect(page).toHaveURL(/paso=revisita-vencida/)
    await expect(page.getByTestId('filter-revisit-late')).toHaveAttribute('aria-current', 'page')
    await sql`update crm.deals set revisit_needed = false, revisit_due = null where id = ${d.id}`
    expect(errors).toEqual([])
  })

  test('Hilo: una nota para quien dirige y una corrección que no borra la original', async ({ page }) => {
    const deal = (await sql<{ id: string; account_id: string }[]>`select d.id, d.account_id from crm.deals d where d.owner_id = md5('contigo:lucia.vega')::uuid and d.status = 'open' order by d.id limit 1`)[0]!
    await loginAs(page, 'lucia.vega')
    await page.goto(`/deals/${deal.id}`)
    const subject = `Zx nota ${tag()}`
    await page.getByTestId('note-subject').fill(subject)
    await page.getByTestId('note-visibility').selectOption('managers')
    await page.getByTestId('note-add').click()
    await expect.poll(async () => (await sql<{ v: string }[]>`select visibility_class as v from crm.activities where subject = ${subject}`)[0]?.v).toBe('managers')
    await page.goto(`/comercios/${deal.account_id}/hilo`)
    const entry = page.getByTestId('thread-entry').filter({ hasText: subject })
    await expect(entry).toContainText('La ven quien dirige')
    await entry.getByTestId('thread-correct').click()
    await vis(page, 'thread-correct-subject').fill(`${subject} (corregida)`)
    await vis(page, 'thread-correct-reason').fill('Me equivoqué de persona')
    await vis(page, 'thread-correct-save').click()
    await expect(page.getByTestId('thread-entry').filter({ hasText: subject }).first()).toBeVisible()
    await expect(page.getByTestId('thread-corrected')).toHaveCount(1)
    await expect(page.getByTestId('thread-correction')).toHaveCount(1)
    await threeWidths(page, 'hilo con corrección')
    // Otra persona de ventas no ve la nota reservada a quien dirige.
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${deal.account_id}/hilo`)
    await expect(page.getByTestId('thread-entry').filter({ hasText: subject })).toHaveCount(0)
  })

  test('Supervisión: la sugerencia de tienda saturada se confirma y deja la tarea', async ({ page }) => {
    const lead = (await sql<{ id: string; business_name: string }[]>`select id, business_name from crm.leads where market_code = 'MX' and status = 'new' order by id limit 1`)[0]!
    await sql`insert into crm.routing_suggestions (market_code, lead_id, kind, detail) values ('MX', ${lead.id}, 'saturated', '{"rules":["Zx tope"]}') on conflict do nothing`
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/supervisor')
    const row = page.getByTestId('suggestion-row').filter({ hasText: lead.business_name })
    await expect(row).toContainText('tope lleno en: Zx tope')
    await threeWidths(page, 'sugerencias de tienda saturada')
    await row.getByTestId('suggestion-confirm').click()
    await expect(page.getByTestId('suggestion-row').filter({ hasText: lead.business_name })).toHaveCount(0)
    expect((await sql<{ n: number }[]>`select count(*)::int as n from crm.activities where lead_id = ${lead.id} and done_at is null and subject like 'Pasar este lead%'`)[0]!.n).toBe(1)
  })

  test('Estado de CONTIGO lista los valores propuestos y propósitos de visita de US como propuesta', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    await expect(page.getByTestId('status-proposed')).toContainText('pendiente: Yamil')
    await page.goto('/admin/operaciones')
    await expect(page.getByTestId('visit-purposes-proposed')).toContainText('[pendiente: Ventas US]')
    await threeWidths(page, 'operaciones con propósitos propuestos')
  })
})
