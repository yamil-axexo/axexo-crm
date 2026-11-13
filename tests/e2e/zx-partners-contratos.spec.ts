import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createHash } from 'node:crypto'
import { loginAs, pageErrors } from './helpers'

// Paquete partners-contratos (0043): términos y contrato (PIPE-07), portal de partners (CANAL-01), plan de integración
// (PIPE-08), niveles y cruce (CANAL-06), red adquirida (DAT-06) y captura de comunicaciones (ACT-03).

const uid = (k: string) => {
  const h = createHash('md5').update(`contigo:${k}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const ISO = uid('dat-us-iso')
const AGENT = uid('dat-us-agent')
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function at(page: Page, width: number, label: string) {
  await page.setViewportSize({ width, height: 900 })
  await noOverflow(page, `${label} a ${width}`)
}

test.describe('Paquete partners-contratos', () => {
  test('PIPE-07: quien lidera captura términos, sale la propuesta y el contrato se firma a mano (inglés)', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'robert.hale')
    await page.goto(`/comercios/${AGENT}`)
    await page.getByTestId('account-contracts-open').click()
    await expect(page).toHaveURL(new RegExp(`/comercios/${AGENT}/contratos$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms and contracts')
    await page.getByTestId('terms-lines').fill('Top-ups: 4.5\nBill pay: 2')
    await page.getByTestId('terms-from').fill(day(-3))
    await page.getByTestId('terms-save').click()
    await expect(page.getByTestId('form-ok')).toContainText('version 1')
    await expect(page.getByTestId('terms-row').first()).toContainText('Top-ups: 4.5%')
    await page.getByTestId('contract-create').click()
    await expect(page.getByTestId('contract-row').first()).toContainText('Draft')
    await page.getByTestId('contract-send').click()
    await expect(page.getByTestId('contract-row').first()).toContainText('Electronic signature: channel off')
    await page.getByTestId('contract-sign-open').click()
    await page.getByTestId('sign-date').fill(day(-1))
    await page.getByTestId('sign-by').fill('Client Example')
    await page.getByTestId('sign-url').fill('https://docs.example.test/signed')
    await page.getByTestId('sign-save').click()
    await expect(page.getByTestId('contract-row').first()).toContainText('Active')
    await expect(page.getByTestId('contract-signed').first()).toContainText('Client Example')
    await axeClean(page, 'contratos')
    for (const w of [1440, 390]) await at(page, w, 'contratos')
    await page.getByTestId('proposal-open').first().click()
    await expect(page.getByTestId('proposal-sheet')).toContainText('Commercial proposal')
    await expect(page.getByTestId('proposal-lines')).toContainText('Bill pay')
    await at(page, 390, 'propuesta')
    expect(errors).toEqual([])
  })

  test('PIPE-07: la pantalla de términos en español, para supervisión', async ({ page }) => {
    await loginAs(page, 'kira.dunn', { browserLocale: true })
    await page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])
    await page.goto(`/comercios/${AGENT}/contratos`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Términos y contratos')
    await expect(page.getByTestId('terms-card')).toContainText('Términos comerciales')
    await at(page, 390, 'contratos en español')
  })

  test('CANAL-01: el partner entra a su portal y ve solo su red', async ({ page }) => {
    const errors = pageErrors(page)
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByTestId('persona-iso.partner').click()
    await expect(page).toHaveURL(/\/(partners|bienvenida)$/)
    await page.goto('/partners')
    await expect(page.getByTestId('portal-table')).toBeVisible()
    await expect(page.getByTestId('portal-row')).toHaveCount(4)
    await expect(page.getByTestId('portal-table')).toContainText('Frontera Wireless Laredo')
    await axeClean(page, 'portal')
    for (const w of [1440, 390]) await at(page, w, 'portal')
    const api = await page.request.get('/api/partners/v1/accounts', { headers: { authorization: 'Bearer cpt_no_existe' } })
    expect(api.status()).toBe(401)
    expect(errors).toEqual([])
  })

  test('CANAL-01 y CANAL-06: quien lidera crea el token, lo usa la API y recalcula niveles', async ({ page }) => {
    await loginAs(page, 'robert.hale')
    await page.goto('/partners')
    await expect(page.getByTestId('partner-row').first()).toContainText('Lone Star Payments ISO')
    await page.getByTestId('token-user').selectOption({ index: 1 })
    await page.getByTestId('token-label').fill('ISO system')
    await page.getByTestId('token-create').click()
    const token = (await page.getByTestId('reveal-once').locator('code').textContent())!.trim()
    expect(token.startsWith('cpt_')).toBe(true)
    const res = await page.request.get('/api/partners/v1/accounts', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { data: { id: string }[]; scope: string }
    expect(body.scope).toBe(ISO)
    expect(body.data.length).toBe(4)
    await page.getByTestId('tiers-recalc').click()
    await expect(page.getByTestId('form-ok').first()).toContainText('Tiers recalculated')
    await page.getByTestId('crossmatch-run').click()
    await expect(page.getByTestId('overlaps-card')).toBeVisible()
    await axeClean(page, 'partners')
    for (const w of [1440, 390]) await at(page, w, 'partners')
  })

  test('PIPE-08: plan de integración con hitos de cada lado', async ({ page }) => {
    await loginAs(page, 'sam.ortiz')
    await page.goto(`/comercios/${ISO}/plan`)
    await page.getByTestId('plan-owner').selectOption({ index: 1 })
    await page.getByTestId('plan-client').fill('Client Contact')
    await page.getByTestId('plan-create').click()
    await expect(page.getByTestId('milestone-row')).toHaveCount(6)
    await page.getByTestId('milestone-status').nth(4).selectOption('done')
    await page.getByTestId('milestone-save').nth(4).click()
    await expect(page.getByTestId('plan-card').first()).toContainText('Certified in')
    await page.getByTestId('plan-share').click()
    await expect(page.getByTestId('plan-card').first()).toContainText('channel off')
    await axeClean(page, 'plan')
    for (const w of [1440, 390]) await at(page, w, 'plan')
  })

  test('ACT-03: un WhatsApp del cliente abre la ventana de 24 horas', async ({ page }) => {
    await loginAs(page, 'sam.ortiz')
    await page.goto(`/comercios/${ISO}/comunicaciones`)
    await expect(page.getByTestId('wa-window')).toContainText('Closed')
    await page.getByTestId('comm-channel').selectOption('whatsapp')
    await page.getByTestId('comm-direction').selectOption('inbound')
    await page.getByTestId('comm-subject').fill('Question about the contract')
    await page.getByTestId('comm-summary').fill('They asked when the contract starts.')
    await page.getByTestId('comm-save').click()
    await expect(page.getByTestId('wa-window')).toContainText('Open until')
    await expect(page.getByTestId('comm-row').first()).toContainText('Question about the contract')
    await axeClean(page, 'comunicaciones')
    for (const w of [1440, 390]) await at(page, w, 'comunicaciones')
  })

  test('DAT-06: la red entra aparte y pasa a la cartera solo después de las dos liberaciones', async ({ page }) => {
    await loginAs(page, 'robert.hale')
    await page.goto('/partners/redes')
    await page.getByTestId('load-name').fill('Network test')
    const stamp = Date.now().toString(36)
    const csv = ['id,parent_id,nombre,telefono,ciudad,estado,tipo', `R${stamp},,Red Prueba ${stamp},,Austin,TX,distribuidor`, `P${stamp},R${stamp},Punto Prueba ${stamp},,Austin,TX,tienda`].join('\n')
    await page.getByTestId('load-file').setInputFiles({ name: 'red.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await page.getByTestId('load-save').click()
    await expect(page.getByTestId('form-ok')).toContainText('separate space')
    await page.getByTestId('load-row').first().getByRole('link').click()
    await expect(page.getByTestId('net-count-ready')).toContainText('2')
    await page.getByTestId('release-business-btn').click()
    await expect(page.getByTestId('release-business')).toContainText('released by')
    await expect(page.getByTestId('promote-form')).toHaveCount(0)
    await axeClean(page, 'red')
    for (const w of [1440, 390]) await at(page, w, 'red')
    // Legal la da administración (otra persona).
    await loginAs(page, 'nora.salas')
    await page.goto('/partners/redes')
    await page.getByTestId('load-row').first().getByRole('link').click()
    await page.getByTestId('release-legal-btn').click()
    await page.getByTestId('promote-btn').click()
    await expect(page.getByTestId('batch-row')).toHaveCount(1)
    await expect(page.getByTestId('net-count-promoted')).toContainText('2')
  })

  test('Estado de CONTIGO muestra los adaptadores del paquete apagados', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/estado')
    await expect(page.getByText('Firma electrónica de contratos')).toBeVisible()
    await expect(page.getByText(/CONTIGO_ESIGN_ADAPTER/)).toBeVisible()
  })
})
