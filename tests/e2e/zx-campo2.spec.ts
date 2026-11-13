import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

// Paquete campo2 (ola 6, residuos): el flujo principal de cada punto cerrado, por el rol que corresponde, a 1440 y 390 px.
const uniq = () => Math.random().toString(36).slice(2, 7).replace(/\d/g, 'q')
const sql = testDb()
test.afterAll(async () => {
  await sql.end()
})
async function clean(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target}`), what).toEqual([])
}
const ok = (page: Page) => page.getByTestId('form-ok').last()
async function both(page: Page, what: string) {
  await clean(page, `${what} 1440`)
  await page.setViewportSize({ width: 390, height: 844 })
  await clean(page, `${what} 390`)
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.describe('campo2', () => {
  test('CAMPO-04 y CANAL-08: umbrales propuestos con calibración, política de reversos y corrida de atribución (quien lidera)', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'ana.robles')
    await page.goto('/campo?tab=umbrales&mercado=MX')
    await expect(page.locator('[data-testid="threshold-row"][data-key="trust_min_score"]').getByTestId('threshold-proposed')).toContainText('pendiente: Ventas')
    await expect(page.getByTestId('threshold-review').first()).toBeVisible()
    await both(page, 'umbrales')
    await page.goto('/campo?tab=disputas&mercado=MX')
    await expect(page.getByTestId('channel-policy')).toBeVisible()
    await expect(page.getByTestId('policy-pending')).toContainText('Finanzas y Ventas')
    await expect(page.getByTestId('clawback-note')).toContainText('Sin montos')
    await both(page, 'disputas')
    await page.goto('/campo?tab=atribucion&mercado=MX')
    await page.getByTestId('attr-reclassify-run').click()
    await expect(ok(page)).toContainText('orígenes clasificados')
    await page.reload()
    const unclassified = await sql<{ n: number }[]>`select count(*)::int as n from crm.account_attributions where market_code = 'MX' and layer = 'origin' and effective_to is null and origin_kind is null`
    expect(unclassified[0]!.n).toBe(0)
    expect(errors).toEqual([])
  })

  test('CANAL-02, CANAL-05 y CANAL-06: el aliado registra su tienda, ve las reglas, su estado de comisión y su material (en inglés)', async ({ page }) => {
    const errors = pageErrors(page)
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByTestId('persona-iso.partner').click()
    await expect(page).toHaveURL(/\/(partners|bienvenida)$/)
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.goto('/partners')
    await expect(page.getByTestId('portal-rules')).toContainText('protected for')
    const store = `Corner Store ${uniq()}`
    await page.getByTestId('portal-claim-store').fill(store)
    await page.getByTestId('portal-claim-city').fill('Laredo')
    await page.getByTestId('portal-claim-save').click()
    await expect(ok(page)).toContainText('Registered to you')
    await page.reload()
    await expect(page.getByTestId('portal-claim-row').filter({ hasText: store })).toContainText('Protected until')
    await expect(page.getByTestId('portal-statements')).toBeVisible()
    await both(page, 'portal')
    const row = await sql<{ registered_via: string }[]>`select registered_via from crm.channel_claims where store_name = ${store}`
    expect(row[0]!.registered_via).toBe('partner')
    expect(errors).toEqual([])
  })

  test('CANAL-05: quien vende ve su estado de comisión estimado, sin montos y sin ranking', async ({ page }) => {
    await loginAs(page, 'robert.hale')
    await page.goto('/partners')
    await page.getByTestId('statements-estimate').click()
    await expect(ok(page)).toContainText('statements calculated')
    await expect(page.getByTestId('statements-admin-list')).toBeVisible()
    await loginAs(page, 'marco.pena')
    await sql`insert into crm.commission_statements (market_code, party_kind, party_ref, party_label, month, counts)
              values ('MX', 'user', md5('contigo:marco.pena')::uuid::text, 'Marco Peña', date_trunc('month', now())::date, '{"enrolled":3,"first_sales":1,"active_30":1,"active_60":0,"active_90":0,"threshold":10,"threshold_pending":"Ventas y Finanzas","team_active_90":2}')
              on conflict (market_code, party_kind, party_ref, month) do nothing`
    await page.goto('/reportes/lo-que-llevo')
    await expect(page.getByTestId('my-statements')).toContainText('Estimado')
    await expect(page.getByTestId('statement-goal').first()).toContainText('pendiente')
    await both(page, 'lo que llevo')
  })

  test('CAMPO-05: indicadores de campo con ruta, distribución y la señal mínima propuesta', async ({ page }) => {
    await loginAs(page, 'ana.robles')
    await page.goto('/reportes/indicadores-campo')
    await expect(page.getByTestId('kpi-route')).toBeVisible()
    await expect(page.getByTestId('kpi-distribution')).toBeVisible()
    await expect(page.getByTestId('trust-proposed')).toContainText('pendiente: Ventas')
    await both(page, 'indicadores de campo')
  })

  test('CAMPO-06: enlace de captura del expediente, sin sesión, solo para ese expediente', async ({ page, browser }) => {
    const name = `Abarrotes Enlace ${uniq()}`
    const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, account_type, name, segment, owner_id, country, created_by, lifecycle)
      values ('MX', 'store', 'store', ${name}, 'd2d', md5('contigo:marco.pena')::uuid, 'MX', md5('contigo:marco.pena')::uuid, 'onboarding') returning id`)[0]!.id
    await loginAs(page, 'marco.pena')
    await page.goto('/campo?tab=expedientes&mercado=MX')
    await page.getByTestId('file-account').selectOption({ label: name })
    await page.getByTestId('file-person').selectOption('individual')
    await page.getByTestId('file-funding').selectOption('prepaid')
    await page.getByTestId('file-open-btn').click()
    await expect(ok(page)).toContainText('Expediente abierto')
    const fileId = (await sql<{ id: string }[]>`select id from crm.onboarding_files where account_id = ${acc}`)[0]!.id
    await page.goto(`/campo?tab=expedientes&mercado=MX&expediente=${fileId}`)
    await expect(page.getByTestId('file-extras')).toContainText('Identificador fiscal')
    await expect(page.getByTestId('file-credit')).toContainText('Prepago')
    await page.getByTestId('file-link').click()
    const link = (await page.getByTestId('reveal-once').locator('code').textContent())!.trim()
    expect(link).toMatch(/\/e\/[A-Za-z0-9_-]{20,}$/)
    await both(page, 'expediente')
    const outside = await browser.newContext({ locale: 'es-MX' })
    const p2 = await outside.newPage()
    await p2.goto(new URL(link).pathname)
    await expect(p2.getByTestId('link-page')).toContainText(name)
    const forms = p2.getByTestId('link-doc-form')
    const n = await forms.count()
    for (let i = 0; i < n; i++) {
      await forms.nth(i).locator('input[name="link"]').fill(`https://docs.ejemplo.test/${i}`)
      await forms.nth(i).getByRole('button').click()
      await expect(p2.getByTestId('form-ok').last()).toContainText('Guardado')
    }
    await p2.getByTestId('link-submit-btn').click()
    await expect(p2.getByTestId('form-ok').last()).toContainText('Enviado')
    await p2.reload()
    await expect(p2.getByTestId('link-gone')).toBeVisible()
    await clean(p2, 'enlace usado')
    await outside.close()
    const f = (await sql<{ status: string }[]>`select status from crm.onboarding_files where id = ${fileId}`)[0]!
    expect(['submitted', 'auto_approved']).toContain(f.status)
  })

  test('Estado de CONTIGO lista los valores propuestos con su dueño y las conexiones apagadas de campo2', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/estado')
    await expect(page.locator('[data-testid="status-proposed-row"][data-key="trust_min_score"]')).toContainText('pendiente: Ventas')
    await expect(page.locator('[data-testid="status-proposed-row"][data-key="clawback_policy"]')).toBeVisible()
    await expect(page.getByText('Resumen semanal de comentarios hacia P&T')).toBeVisible()
    await both(page, 'estado')
  })
})
