import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

// Paquete seguridad (0027): la pantalla de Seguridad, "ver como", la hoja "Equipo y datos reservados" del comercio,
// solicitudes de titulares, la búsqueda que no deja enumerar y la paleta de comandos.

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
/** El comercio de Diana que el seed dejó con un dato reservado, y un contacto con teléfono para el consentimiento. */
async function reservedAccount() {
  const sql = testDb()
  try {
    const acc = (await sql<{ id: string; name: string }[]>`
      select a.id, a.name from crm.account_sensitive s join crm.accounts a on a.id = s.account_id where s.field_key = 'commercial_terms' limit 1`)[0]!
    const phone = `+52557${Math.floor(1_000_000 + Math.random() * 8_999_999)}`
    const contactName = `Contacto Reservado ${tag()}`
    const contact = (await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone) values ('MX', ${contactName}, ${phone}) returning id`)[0]!
    await sql`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id}, ${contact.id}, 'MX', 'manager')`
    return { ...acc, phone, contactName }
  } finally {
    await sql.end()
  }
}

test.describe('Seguridad en Administración', () => {
  test('administración recorre las cinco secciones, revisa ahora, arma el lote de la bitácora y ve la bitácora de la base', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin')
    // Seguridad vive en Administración, en la sección Control.
    await expect(page.locator('a[href="/admin/seguridad"]').first()).toBeAttached()
    await page.goto('/admin/seguridad')
    await expect(page.getByTestId('security-monitoring')).toBeVisible()
    await page.getByTestId('scan-now').click()
    await expect(page.getByTestId('alerts-card')).toContainText(/sin revisar/)
    // La copia fuera de la base está apagada: el lote queda en la cola y la pantalla dice qué falta.
    await expect(page.getByTestId('adapter-AUDIT_ARCHIVE_ADAPTER')).toContainText('Canal apagado')
    await page.getByTestId('archive-now').click()
    await expect(page.getByTestId('batch-list')).toContainText('Canal apagado')
    await expect(page.getByTestId('log-counts')).toContainText(/filas de datos/)
    await axeClean(page, 'alertas')

    for (const [s, testid] of [['accesos', 'security-access'], ['privacidad', 'security-privacy'], ['llaves', 'security-keys'], ['bitacora', 'security-dblog']] as const) {
      await page.goto(`/admin/seguridad?s=${s}`)
      await expect(page.getByTestId(testid)).toBeVisible()
      await noOverflow(page, `${s} 1440`)
      await axeClean(page, s)
    }
    // La bitácora de la base trae filas con su vía; la carga de datos de prueba entró como importación.
    await expect(page.getByTestId('dblog-row').first()).toBeVisible()
    await expect(page.getByTestId('security-dblog')).toContainText(/Importación|Pantalla|Tarea programada/)
    // Llaves y conexiones: inventario sin valores.
    await page.goto('/admin/seguridad?s=llaves')
    await expect(page.getByTestId('secret-list')).toContainText('PIPEDRIVE_API_TOKEN')
    await expect(page.getByTestId('security-keys')).not.toContainText('test-token')

    // Móvil, y en inglés.
    await page.setViewportSize({ width: 390, height: 844 })
    for (const s of ['alertas', 'accesos', 'privacidad', 'llaves', 'bitacora']) {
      await page.goto(`/admin/seguridad?s=${s}`)
      await expect(page.getByRole('heading', { name: 'Seguridad', exact: true })).toBeVisible()
      await noOverflow(page, `${s} 390`)
    }
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.goto('/admin/seguridad?s=privacidad')
    await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible()
    await expect(page.getByTestId('security-privacy')).toContainText('Restricted')
    await expect(page.getByTestId('security-privacy')).not.toContainText(/Términos comerciales|Retención|Solicitudes/)
    await noOverflow(page, 'privacidad 390 en')
    expect(errors).toEqual([])
  })

  test('Estado de CONTIGO lista los tres adaptadores de seguridad apagados y qué falta para encenderlos', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    for (const env of ['AUDIT_ARCHIVE_ADAPTER', 'DIRECTORY_ADAPTER', 'FIELD_CRYPTO_ADAPTER']) await expect(page.getByText(env).first()).toBeVisible()
  })

  test('quien vende no entra a Seguridad; quien lidera el mercado ve solo la revisión de accesos', async ({ page }) => {
    await loginAs(page, 'diana.cruz')
    const res = await page.goto('/admin/seguridad')
    expect(res?.status()).toBe(404)
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/admin/seguridad')
    await expect(page.getByTestId('security-access')).toBeVisible()
    await expect(page.getByTestId('reviews-card')).toBeVisible()
    await expect(page.getByTestId('view-as-card')).toHaveCount(0)
    await expect(page.getByTestId('admin-areas-card')).toHaveCount(0)
  })

  test('ver como: pide motivo, deja la barra en toda pantalla, no deja cambiar nada y se termina', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/seguridad?s=accesos')
    await page.getByTestId('view-as-target').selectOption({ label: 'Diana Cruz' })
    await page.getByTestId('view-as-reason').fill('Diana no encuentra un comercio en su lista')
    await page.getByTestId('view-as-start').click()
    await expect(page).toHaveURL(/\/hoy$/)
    const banner = page.getByTestId('view-as-banner')
    await expect(banner).toContainText('Nora Salas: estás viendo CONTIGO como Diana Cruz')
    await expect(banner).toContainText('Solo lectura')
    // Ve lo que ve Diana (sus leads), sin los botones de crear ni Administración.
    await page.goto('/leads')
    await expect(banner).toBeVisible()
    await expect(page.getByTestId('nav-admin')).toHaveCount(0)
    const res = await page.goto('/admin/seguridad')
    expect(res?.status()).toBe(404)
    await page.goto('/hoy')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow(page, 'barra de ver como 390')
    await page.getByTestId('view-as-stop').click()
    await expect(page).toHaveURL(/\/admin\/seguridad/)
    await expect(page.getByTestId('view-as-banner')).toHaveCount(0)
    await expect(page.getByTestId('view-as-recent')).toContainText('Diana no encuentra un comercio en su lista')
  })

  test('solicitud de una persona sobre sus datos: se registra con su tipo y queda en la lista', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/seguridad?s=privacidad')
    const name = `Persona Titular ${tag()}`
    await page.getByTestId('request-open').click()
    await page.getByTestId('request-kind').selectOption('access')
    await page.getByTestId('request-name').fill(name)
    await page.getByTestId('request-save').click()
    const row = page.getByTestId('request-row').filter({ hasText: name })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Ver sus datos')
    await expect(row).toContainText('Recibida')
  })
})

test.describe('Equipo y datos reservados en la ficha del comercio', () => {
  test('quien lleva la cuenta suma a alguien al equipo, ve un dato reservado con motivo y registra consentimiento y baja', async ({ page }) => {
    const errors = pageErrors(page)
    const acc = await reservedAccount()
    await loginAs(page, 'diana.cruz')
    await page.goto(`/comercios/${acc.id}?tab=datos`)
    await page.getByTestId('account-security-open').click()
    await expect(page).toHaveURL(new RegExp(`/comercios/${acc.id}/equipo$`))
    await expect(page.getByRole('heading', { name: 'Equipo y datos reservados' })).toBeVisible()

    // Equipo de la cuenta.
    await page.getByTestId('account-team-user').selectOption({ label: 'Iván Ríos' })
    await page.getByTestId('account-team-function').selectOption('specialist')
    await page.getByTestId('account-team-add').click()
    await expect(page.getByTestId('account-team-row')).toContainText('Iván Ríos')
    await expect(page.getByTestId('account-team-row')).toContainText('Especialista')

    // Dato reservado: tapado; verlo pide motivo.
    const field = page.getByTestId('sensitive-commercial_terms')
    await expect(field.getByTestId('sensitive-state')).toContainText('••••')
    await expect(page.getByTestId('sensitive-card')).not.toContainText('Pago a 30 días')
    await field.getByTestId('sensitive-reveal-open').click()
    await page.getByTestId('sensitive-reason').fill('Preparar la renovación con el cliente')
    await page.getByTestId('sensitive-reveal').click()
    await expect(page.getByTestId('reveal-once')).toContainText('Pago a 30 días')
    await page.keyboard.press('Escape')

    // Consentimiento y baja del contacto.
    const contact = page.getByTestId('consent-contact').filter({ hasText: acc.contactName })
    await contact.getByTestId('consent-add-open').click()
    await page.getByTestId('consent-evidence').fill('Aceptó por teléfono recibir avisos de su cuenta')
    await page.getByTestId('consent-save').click()
    await expect(contact.getByTestId('consent-row')).toContainText('WhatsApp')
    await contact.getByTestId('optout-open').click()
    await page.getByTestId('optout-save').click()
    await expect(contact).toContainText('Baja: Todos los canales')
    await axeClean(page, 'equipo y datos reservados')
    await noOverflow(page, 'equipo 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await noOverflow(page, 'equipo 390')

    // El revelado quedó en la bitácora con el motivo, y la baja aparece en Seguridad.
    const sql = testDb()
    try {
      const ev = await sql<{ reason: string }[]>`select after ->> 'reason' as reason from crm.audit_events where action = 'sensitive.revealed' and object_id = ${acc.id}`
      expect(ev.map((e) => e.reason)).toContain('Preparar la renovación con el cliente')
    } finally {
      await sql.end()
    }
    expect(errors).toEqual([])

    // En inglés, la misma hoja.
    await loginAs(page, 'ana.robles', { stay: true })
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.goto(`/comercios/${acc.id}/equipo`)
    await expect(page.getByRole('heading', { name: 'Team and restricted data' })).toBeVisible()
    await expect(page.getByTestId('consent-card')).toContainText('Opted out: All channels')
    await expect(page.getByTestId('account-team-card')).not.toContainText(/Solo ve|Sacar del equipo/)
  })
})

test.describe('Buscar sin enumerar, y la paleta de comandos', () => {
  test('un pedazo de teléfono no encuentra nada; el número completo sí', async ({ page }) => {
    const acc = await reservedAccount()
    const sql = testDb()
    try {
      await sql`update crm.accounts set phone = ${acc.phone} where id = ${acc.id}`
    } finally {
      await sql.end()
    }
    await loginAs(page, 'ana.robles', { stay: true })
    const digits = acc.phone.replace('+', '')
    await page.goto(`/buscar?q=${digits.slice(-5)}`)
    await expect(page.getByTestId('search-hit')).toHaveCount(0)
    await page.goto(`/buscar?q=${digits}`)
    await expect(page.getByTestId('search-hit').filter({ hasText: acc.name })).toBeVisible()
  })

  test('Ctrl+K abre la paleta, filtra los destinos de la persona y Enter lleva ahí o busca lo escrito', async ({ page }) => {
    await loginAs(page, 'diana.cruz')
    await page.keyboard.press('Control+k')
    const palette = page.getByTestId('palette')
    await expect(palette).toBeVisible()
    await expect(page.getByTestId('palette-input')).toBeFocused()
    // Quien vende no ve Administración ni Seguridad entre sus destinos.
    await expect(palette).not.toContainText('Administración')
    await page.getByTestId('palette-input').fill('comer')
    await expect(page.getByTestId('palette-option').first()).toContainText('Comercios')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/comercios/)
    await page.keyboard.press('Control+k')
    await page.getByTestId('palette-input').fill('abarrotes')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('palette-option').last()).toContainText('Buscar "abarrotes"')
    await page.getByTestId('palette-option').last().click()
    await expect(page).toHaveURL(/\/buscar\?q=abarrotes/)
    await page.keyboard.press('Control+k')
    await axeClean(page, 'paleta')
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  })
})
