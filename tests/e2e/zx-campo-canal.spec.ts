import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

// Paquete campo-canal: el flujo principal de cada ítem, desde la pantalla Campo y canales y por el rol que corresponde.
const uniq = () => Math.random().toString(36).slice(2, 7).replace(/\d/g, 'q')
const sql = testDb()
test.afterAll(async () => {
  await sql.end()
})
const personaId = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
async function rawAccount(who: string, name: string) {
  const o = await personaId(who)
  return (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, account_type, name, segment, owner_id, country, created_by, lifecycle)
    values ('MX', 'store', 'store', ${name}, 'd2d', ${o}, 'MX', ${o}, 'active') returning id`)[0]!.id
}
async function clean(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target}`), what).toEqual([])
}
const ok = (page: Page) => page.getByTestId('form-ok').last()

test.describe('campo-canal', () => {
  test('CAMPO-06: el expediente se captura una vez, la mesa de control valida con plazo y aprueba; prepago se aprueba por regla', async ({ page }) => {
    const errors = pageErrors(page)
    const nameA = `Abarrotes Expediente ${uniq()}`
    const nameB = `Abarrotes Prepago ${uniq()}`
    const a = await rawAccount('marco.pena', nameA)
    await rawAccount('marco.pena', nameB)
    await loginAs(page, 'marco.pena')
    await page.goto('/campo?tab=expedientes&mercado=MX')
    await expect(page.getByTestId('vault-off')).toContainText('apagada')
    await page.getByTestId('file-account').selectOption({ label: nameA })
    await page.getByTestId('file-person').selectOption('company')
    await page.getByTestId('file-funding').selectOption('ach_credit')
    await page.getByTestId('file-open-btn').click()
    await expect(ok(page)).toContainText('Expediente abierto')
    const fileId = (await sql<{ id: string }[]>`select id from crm.onboarding_files where account_id = ${a}`)[0]!.id
    await page.goto(`/campo?tab=expedientes&mercado=MX&expediente=${fileId}`)
    const docs = page.getByTestId('doc-row')
    await expect(docs).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await docs.nth(i).getByTestId('doc-receive').locator('input[name=link]').fill('https://docs.ejemplo.test/exp')
      await docs.nth(i).getByRole('button', { name: 'Recibido' }).click()
      await expect(docs.nth(i)).toHaveAttribute('data-status', 'received')
    }
    await clean(page, 'expediente 1440')
    await page.getByTestId('file-submit-btn').click()
    await expect(page.getByTestId('file-detail')).toContainText('En la mesa')

    await loginAs(page, 'valeria.soto')
    await page.goto('/campo?tab=expedientes&mercado=MX')
    await expect(page.getByTestId('desk').getByText(nameA)).toBeVisible()
    await page.goto(`/campo?tab=expedientes&mercado=MX&expediente=${fileId}`)
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('doc-row').nth(i).getByTestId('doc-valid').click()
      await expect(page.getByTestId('doc-row').nth(i)).toHaveAttribute('data-status', 'valid')
    }
    await page.getByTestId('file-approve').click()
    await expect(page.getByTestId('file-detail')).toContainText('Aprobado')
    expect((await sql<{ status: string }[]>`select status from crm.onboarding_files where id = ${fileId}`)[0]!.status).toBe('approved')

    // Prepago: se aprueba por regla al enviarlo completo
    await loginAs(page, 'marco.pena')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/campo?tab=expedientes&mercado=MX')
    await page.getByTestId('file-account').selectOption({ label: nameB })
    await page.getByTestId('file-person').selectOption('individual')
    await page.getByTestId('file-open-btn').click()
    await expect(ok(page)).toBeVisible()
    const fileB = (await sql<{ id: string }[]>`select f.id from crm.onboarding_files f join crm.accounts x on x.id = f.account_id where x.name = ${nameB}`)[0]!.id
    await page.goto(`/campo?tab=expedientes&mercado=MX&expediente=${fileB}`)
    const rowsB = page.getByTestId('doc-row')
    for (let i = 0; i < (await rowsB.count()); i++) {
      await rowsB.nth(i).getByRole('button', { name: 'Recibido' }).click()
      await expect(rowsB.nth(i)).toHaveAttribute('data-status', 'received')
    }
    await clean(page, 'expediente 390')
    await page.getByTestId('file-submit-btn').click()
    await expect(page.getByTestId('file-detail')).toContainText('Aprobado por regla')
    expect(errors).toEqual([])
  })

  test('CANAL-02 y SEG-06: registros de canal y incidentes solo los ve quien corresponde', async ({ page }) => {
    const store = `Miscelánea Canal ${uniq()}`
    await loginAs(page, 'ana.robles')
    await page.goto('/campo?tab=registros&mercado=MX')
    const f = page.getByTestId('claim-form')
    await f.getByTestId('claim-store').fill(store)
    await f.getByTestId('claim-city').fill('Toluca')
    await f.getByTestId('claim-node').fill('Distribuidora Uno')
    await f.getByTestId('claim-ref').fill('dist-uno')
    await page.getByTestId('claim-save').click()
    await expect(ok(page)).toContainText('Registrada hasta')
    await f.getByTestId('claim-node').fill('Distribuidora Dos')
    await f.getByTestId('claim-ref').fill('dist-dos')
    await page.waitForTimeout(900)
    await page.getByTestId('claim-save').click()
    await expect(ok(page)).toContainText('ya tiene un registro vigente de otro canal')
    await expect(page.getByTestId('claim-row').filter({ hasText: store })).toHaveCount(2)
    await clean(page, 'registros')

    // Quien vende no tiene la pestaña de registros; sí reporta incidentes
    const desc = `Pidió dinero extra por la instalación ${uniq()}`
    await loginAs(page, 'marco.pena')
    await page.goto('/campo?tab=registros&mercado=MX')
    await expect(page.getByTestId('pill-registros')).toHaveCount(0)
    await page.goto('/campo?tab=incidentes&mercado=MX')
    await page.getByTestId('incident-party').fill('Vendedor de calle Norte')
    await page.getByTestId('incident-desc').fill(desc)
    await page.getByTestId('incident-send').click()
    await expect(ok(page)).toContainText('confidencial')
    await loginAs(page, 'lucia.vega')
    await page.goto('/campo?tab=incidentes&mercado=MX')
    await expect(page.getByText('Vendedor de calle Norte')).toHaveCount(0)
    await loginAs(page, 'ana.robles')
    await page.goto('/campo?tab=incidentes&mercado=MX')
    const row = page.getByTestId('incident-row').filter({ hasText: 'Vendedor de calle Norte' }).first()
    await row.getByRole('link').click()
    await expect(page.getByTestId('incident-detail')).toContainText(desc)
    const r2 = page.getByTestId('incident-row').filter({ hasText: 'Vendedor de calle Norte' }).first()
    await r2.locator('input[name=resolution]').fill('Se habló con la persona y se devolvió el cobro')
    await r2.getByTestId('incident-close').click()
    await expect(page.getByTestId('incident-row').filter({ hasText: 'Vendedor de calle Norte' }).first()).toHaveAttribute('data-status', 'closed')
    expect((await sql`select 1 from crm.audit_events where action = 'field_incident.viewed'`).length).toBeGreaterThan(0)
  })

  test('CANAL-03, CANAL-08 y CANAL-07: corrección como fila nueva, disputa con árbitro y límite aprobado por otra persona', async ({ page }) => {
    const name = `Abarrotes Atribución ${uniq()}`
    const id = await rawAccount('marco.pena', name)
    await loginAs(page, 'ana.robles')
    await page.goto(`/campo?tab=atribucion&mercado=MX&cuenta=${id}`)
    const f = page.getByTestId('attr-correct')
    await f.getByTestId('attr-label').fill('Red Tiendas del Bajío')
    await f.getByTestId('attr-kind').selectOption('network_conversion')
    await f.getByTestId('attr-reason').fill('Venía de una red adquirida')
    await page.getByTestId('attr-save').click()
    await expect(ok(page)).toContainText('fila nueva')
    await expect(page.getByTestId('attr-row').filter({ hasText: 'Red Tiendas del Bajío' })).toContainText('Red adquirida')
    await expect(page.getByTestId('attr-cycle')).toBeVisible()
    await clean(page, 'atribución')

    await loginAs(page, 'marco.pena')
    await page.goto('/campo?tab=disputas&mercado=MX')
    await expect(page.getByTestId('clawback-note')).toContainText('Sin montos')
    await page.getByTestId('dispute-account').selectOption({ label: name })
    await page.getByTestId('dispute-claimed').fill('Equipo D2D Centro')
    await page.getByTestId('dispute-reason').fill('Lo trajo el equipo de calle')
    await page.getByTestId('dispute-send').click()
    await expect(ok(page)).toContainText('Disputa enviada')
    await expect(page.getByTestId('dispute-resolve')).toHaveCount(0)
    // límite de crédito
    await page.goto(`/campo?tab=credito&mercado=MX&cuenta=${id}`)
    await expect(page.getByTestId('funding-off')).toContainText('apagada')
    await page.getByTestId('credit-amount').fill('5000')
    await page.getByTestId('credit-reason').fill('Vende mucho los fines de semana')
    await page.getByTestId('credit-send').click()
    await expect(ok(page)).toContainText('otra persona')
    await expect(page.getByTestId('credit-decide')).toHaveCount(0)

    await loginAs(page, 'ana.robles')
    await page.goto('/campo?tab=disputas&mercado=MX')
    const d = page.getByTestId('dispute-row').filter({ hasText: name })
    await d.locator('input[name=resolution]').fill('Confirmado con supervisión')
    await d.getByTestId('dispute-approve').click()
    await expect(page.getByTestId('dispute-row').filter({ hasText: name })).toHaveAttribute('data-status', 'approved')
    await page.goto(`/campo?tab=credito&mercado=MX&cuenta=${id}`)
    const c = page.getByTestId('credit-row').filter({ hasText: name })
    await c.locator('input[name=note]').fill('Historial bueno')
    await c.getByRole('button', { name: 'Aprobar' }).click()
    await expect(page.getByTestId('credit-row').filter({ hasText: name })).toHaveAttribute('data-status', 'approved')
  })

  test('CAMPO-03, CAMPO-07, CAMPO-04 y CAMPO-02: plan en borrador con visibilidad, competencia estructurada, umbral versionado y prioridad', async ({ page }) => {
    const name = `Abarrotes Competencia ${uniq()}`
    const id = await rawAccount('marco.pena', name)
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/campo?tab=cartera&mercado=MX')
    // ajustes3: las opciones dicen cuántos comercios lleva cada quien y el equipo de quien recibe (cambiado a propósito).
    const pick = async (testId: string, who: string) => {
      const sel = page.getByTestId(testId)
      await sel.selectOption((await sel.locator('option', { hasText: who }).first().getAttribute('value'))!)
    }
    await pick('plan-from', 'Lucía Vega')
    await pick('plan-to', 'Marco Peña')
    await page.getByTestId('plan-draft').click()
    await expect(ok(page)).toContainText('borrador')
    const plan = page.getByTestId('plan-row').filter({ hasText: 'Marco Peña' }).first()
    await expect(plan.getByTestId('plan-diff')).toContainText('Lucía Vega')
    await plan.getByRole('button', { name: 'Descartar' }).click()
    await expect(page.getByTestId('plan-row').first()).toHaveAttribute('data-status', 'discarded')
    await clean(page, 'cartera')

    await loginAs(page, 'marco.pena')
    await page.goto(`/campo?tab=competencia&mercado=MX&cuenta=${id}`)
    await page.getByTestId('competitor-select').selectOption({ index: 1 })
    await page.getByTestId('competitor-product').fill('Recargas')
    await page.getByTestId('competitor-price').fill('12.50')
    await page.getByTestId('competitor-save').click()
    await expect(page.getByTestId('competitor-obs').first()).toContainText('Recargas')
    await expect(page.getByTestId('competitor-report')).toBeVisible()
    await page.goto('/campo?tab=prioridad&mercado=MX')
    await expect(page.getByTestId('priority')).toBeVisible()

    await loginAs(page, 'ana.robles')
    await page.goto('/campo?tab=umbrales&mercado=MX')
    const th = page.locator('[data-testid=threshold-row][data-key=perfect_store_min]')
    await th.locator('input[name=value]').fill('55')
    await th.locator('input[name=reason]').fill('Calibración del trimestre')
    await th.getByRole('button', { name: 'Cambiar' }).click()
    await expect(page.locator('[data-testid=threshold-row][data-key=perfect_store_min]')).toContainText('versión 2')
    await clean(page, 'umbrales')
  })

  test('en inglés y a 390: quien lidera US ve la pantalla sin restos en español', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'robert.hale')
    await page.goto('/campo?tab=registros')
    await expect(page.getByRole('heading', { name: 'Field and channels' })).toBeVisible()
    await expect(page.getByTestId('claims-rules')).toContainText('Direct sales does not see')
    await clean(page, 'US 390')
    await page.goto('/campo?tab=umbrales')
    await expect(page.getByTestId('thresholds')).toContainText('version')
    await clean(page, 'US umbrales 390')
  })
})
