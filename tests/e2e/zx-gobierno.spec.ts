import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, pageErrors, testDb } from './helpers'

// Paquete gobierno: GOB-07 (servicio, incidentes, restauración), GOB-04 (responsables, versiones, despliegues),
// GOB-09 (costo unitario), GOB-08 (datos de prueba) y E7 (pedir un cambio, quién hace qué, motivo de cada cambio).
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase()

async function check(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`), `${what}: accesibilidad`).toEqual([])
}
const dialog = (page: Page) => page.locator('dialog[open]')
const localNow = (minutes = 0) => {
  const d = new Date(Date.now() + minutes * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

test.describe('Gobierno: servicio y recuperación (GOB-07)', () => {
  test('administración entra desde Administración, fija un objetivo, anota una prueba de restauración y lleva un incidente', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin')
    await page.getByRole('link', { name: 'Gobierno', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/gobierno/)
    await expect(page.getByTestId('gov-service')).toBeVisible()

    // sin objetivo no hay cifra inventada: dice quién la decide
    const availability = page.getByTestId('slo-availability')
    await expect(availability.getByTestId('slo-target')).not.toContainText(/\d/)
    await availability.getByTestId('slo-set-availability').click()
    await dialog(page).getByTestId('slo-target-input').fill('99.5')
    await dialog(page).getByTestId('slo-save').click()
    await expect(availability.getByTestId('slo-target')).toContainText('99.5')

    // la recuperación no acepta un valor sin quién lo acordó y cuándo: nace pendiente
    await expect(page.getByTestId('recovery-rpo_minutes').getByTestId('recovery-target')).not.toContainText(/\d/)
    await expect(page.getByTestId('recovery')).toContainText('Dan Mulligan')

    // el registro de pruebas de restauración nace vacío y dice quién lo llena
    await expect(page.getByTestId('restore-row')).toHaveCount(0)
    await expect(page.getByTestId('restore-tests')).toContainText('Todavía no se ha probado restaurar')
    await page.getByTestId('restore-new').click()
    const today = localNow().slice(0, 10)
    await dialog(page).getByTestId('restore-date').fill(today)
    await dialog(page).getByTestId('restore-by').fill('Persona de Prueba')
    await dialog(page).getByTestId('restore-minutes').fill('42')
    await dialog(page).getByTestId('restore-evidence').fill('Corrida de prueba del paquete gobierno')
    await dialog(page).getByTestId('restore-save').click()
    await expect(page.getByTestId('restore-row')).toHaveCount(1)
    await expect(page.getByTestId('restore-last')).toContainText('Última restauración que salió bien')

    // incidente: no se cierra sin causa ni acciones
    const title = `Prueba de incidente ${uniq()}`
    await page.getByTestId('incident-new').click()
    await dialog(page).getByTestId('incident-title').fill(title)
    await dialog(page).getByTestId('incident-started').fill(localNow(-90))
    await dialog(page).getByTestId('incident-impact').fill('Nadie pudo guardar visitas durante la prueba')
    await dialog(page).getByTestId('incident-save').click()
    const row = page.getByTestId('incident-row').filter({ hasText: title })
    await expect(row).toHaveAttribute('data-status', 'open')
    await row.getByTestId('incident-update').click()
    await dialog(page).getByTestId('incident-status').selectOption('closed')
    await dialog(page).getByTestId('incident-update-save').click()
    await expect(dialog(page).getByTestId('form-error')).toBeVisible()
    await dialog(page).getByTestId('incident-resolved').fill(localNow(-30))
    await dialog(page).getByTestId('incident-cause').fill('Una migración bloqueó la tabla de visitas')
    await dialog(page).getByTestId('incident-actions').fill('Se revirtió y la lista de salida ahora pide probar con datos')
    await dialog(page).getByTestId('incident-update-save').click()
    await expect(row).toHaveAttribute('data-status', 'closed')

    // las conexiones de afuera están apagadas y dicen qué falta
    await expect(page.getByTestId('adapter-traces')).toContainText('Apagado')

    await check(page, 'gobierno servicio 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'gobierno servicio 390')
    expect(errors).toEqual([])
  })

  test('Estado de CONTIGO muestra los objetivos medidos y las conexiones apagadas; la API devuelve el identificador de la petición', async ({ page, request }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/estado')
    await expect(page.getByTestId('status-slo')).toBeVisible()
    await expect(page.getByTestId('status-slo-availability')).toBeVisible()
    await expect(page.getByTestId('status-adapter-traces')).toContainText('Apagado')
    await check(page, 'estado 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'estado 390')

    // GOB-07: el identificador viaja de punta a punta; quien llama a la API lo recibe de vuelta, también cuando se le niega la entrada
    const sent = `e2e-gob-${uniq().toLowerCase()}-0001`
    const res = await request.get('/api/v1/accounts', { headers: { 'x-request-id': sent, authorization: 'Bearer nada' } })
    expect(res.status()).toBe(401)
    expect(res.headers()['x-request-id']).toBe(sent)
    const other = await request.get('/api/v1/accounts', { headers: { 'x-request-id': 'no vale', authorization: 'Bearer nada' } })
    expect(other.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

test.describe('Gobierno: versiones, responsables y despliegues (GOB-04)', () => {
  test('responsable y suplente son dos personas; una versión se anuncia antes de salir y no sale sin la lista completa', async ({ page }) => {
    const errors = pageErrors(page)
    const version = `9.${Math.floor(Math.random() * 900) + 100}.0`
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/gobierno?tab=versiones')
    await expect(page.getByTestId('two-people-warning')).toBeVisible()
    const deploy = page.getByTestId('component-deploy')
    await expect(deploy.getByTestId('component-owner')).not.toContainText(/[A-Z][a-z]+ [A-Z][a-z]+$/)
    await deploy.getByTestId('component-edit').click()
    await dialog(page).getByTestId('component-owner-input').fill('Persona Uno')
    await dialog(page).getByTestId('component-backup-input').fill('Persona Uno')
    await dialog(page).getByTestId('component-save').click()
    await expect(dialog(page).getByTestId('form-error')).toContainText('otra persona')
    await dialog(page).getByTestId('component-backup-input').fill('Persona Dos')
    await dialog(page).getByTestId('component-save').click()
    await expect(deploy.getByTestId('component-backup')).toHaveText('Persona Dos')
    await expect(page.getByTestId('two-people-warning')).toHaveCount(0)

    // versión nueva
    await page.getByTestId('release-new').click()
    await dialog(page).getByTestId('release-version').fill(version)
    await dialog(page).getByTestId('release-title-es').fill('Prueba de versión del paquete gobierno')
    await dialog(page).getByTestId('release-title-en').fill('Governance package test release')
    await dialog(page).getByTestId('release-notes-es').fill('La pantalla de Hoy ordena las tareas por hora.')
    await dialog(page).getByTestId('release-notes-en').fill('The Today screen sorts tasks by time.')
    await dialog(page).getByTestId('release-save').click()
    const row = page.getByTestId('release-row').filter({ hasText: version })
    await expect(row).toHaveAttribute('data-status', 'draft')

    // no sale sin anunciarse ni con la lista incompleta
    await row.getByTestId('release-mark').click()
    await expect(row.getByTestId('form-error')).toContainText('anuncia')
    await row.getByTestId('release-announce').click()
    await expect(row).toHaveAttribute('data-status', 'announced')
    await row.getByTestId('release-mark').click()
    await expect(row.getByTestId('form-error')).toContainText('lista de salida')
    await row.getByTestId('release-checklist-summary').click()
    await expect(row.getByTestId('check-tech_review')).toHaveAttribute('data-done', 'no')
    await expect(row.getByTestId('check-standard')).toBeVisible()
    await row.getByTestId('check-tech_review').getByTestId('check-evidence').fill('Visto bueno de prueba, sin validez fuera de la suite')
    await row.getByTestId('check-tech_review').getByTestId('check-save').click()
    await expect(row.getByTestId('check-tech_review')).toHaveAttribute('data-done', 'yes')

    // despliegue anotado a mano
    await page.getByTestId('deploy-new').click()
    await dialog(page).getByTestId('deploy-commit').fill('abc1234')
    await dialog(page).getByTestId('deploy-at').fill(localNow(-10))
    await dialog(page).getByTestId('deploy-by').fill('Persona Dos')
    await dialog(page).getByTestId('deploy-save').click()
    await expect(page.getByTestId('deploy-row').filter({ hasText: 'abc1234' })).toBeVisible()

    // mantenimiento
    const window = `Mantenimiento de prueba ${uniq()}`
    await page.getByTestId('maintenance-new').click()
    await dialog(page).getByTestId('maintenance-title').fill(window)
    await dialog(page).getByTestId('maintenance-start').fill(localNow(60 * 24))
    await dialog(page).getByTestId('maintenance-end').fill(localNow(60 * 25))
    await dialog(page).getByTestId('maintenance-impact').fill('CONTIGO puede estar lento una hora')
    await dialog(page).getByTestId('maintenance-save').click()
    await expect(page.getByTestId('maintenance-row').filter({ hasText: window })).toBeVisible()

    await check(page, 'gobierno versiones 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'gobierno versiones 390')
    await page.setViewportSize({ width: 1440, height: 900 })

    // quien vende ve las notas y el mantenimiento desde "Pedir un cambio", y el anuncio le llegó por Anuncios
    await loginAs(page, 'lucia.vega')
    await openMenu(page)
    await page.getByTestId('nav-requests').click()
    await expect(page).toHaveURL(/\/solicitudes/)
    await expect(page.getByTestId('release-note').filter({ hasText: version })).toContainText('La pantalla de Hoy ordena las tareas por hora.')
    await expect(page.getByTestId('my-maintenance-row').filter({ hasText: window })).toBeVisible()
    await page.goto('/anuncios')
    await expect(page.locator('main')).toContainText(version)

    // y en inglés, quien lee en inglés
    await loginAs(page, 'jade.kim')
    await page.goto('/solicitudes')
    await expect(page.getByTestId('release-note').filter({ hasText: version })).toContainText('The Today screen sorts tasks by time.')
    await expect(page.getByTestId('who-does-what')).toContainText('Administration')
    expect(errors).toEqual([])
  })
})

test.describe('Gobierno: costo unitario y datos de prueba (GOB-09, GOB-08)', () => {
  test('sin cargas no hay cifras; con una carga sale el costo por persona activa y por comercio; un costo se anula, no se edita', async ({ page }) => {
    const errors = pageErrors(page)
    const label = `Plataforma de prueba ${uniq()}`
    // la prueba parte de un mes sin cargas, corra en el orden que corra
    const sql = testDb()
    await sql`delete from crm.cost_entries`
    await sql.end()
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/gobierno?tab=costos')
    await expect(page.getByTestId('cost-month')).toHaveCount(0)
    await expect(page.getByTestId('cost-row')).toHaveCount(0)
    await page.getByTestId('cost-new').click()
    await dialog(page).getByTestId('cost-amount').fill('cien')
    await dialog(page).getByTestId('cost-label').fill(label)
    await dialog(page).getByTestId('cost-save').click()
    await expect(dialog(page).getByTestId('form-error')).toBeVisible()
    await dialog(page).getByTestId('cost-amount').fill('1200')
    await dialog(page).getByTestId('cost-save').click()
    const row = page.getByTestId('cost-row').filter({ hasText: label })
    await expect(row).toHaveAttribute('data-voided', 'no')
    await expect(page.getByTestId('cost-month').first().getByTestId('cost-total')).toContainText('1,200')
    await expect(page.getByTestId('cost-month').first().getByTestId('cost-per-person')).toContainText(/\d/)
    await expect(page.getByTestId('cost-month').first().getByTestId('cost-per-account')).toContainText(/\d/)
    await expect(page.getByTestId('adapter-billing')).toContainText('Apagado')
    await check(page, 'gobierno costos 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'gobierno costos 390')
    await page.setViewportSize({ width: 1440, height: 900 })
    await row.getByTestId('cost-void').click()
    await expect(row).toHaveAttribute('data-voided', 'yes')
    expect(errors).toEqual([])
  })

  test('datos de prueba: el ambiente dice de dónde salieron sus datos y cómo se corre el generador', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/gobierno?tab=datos')
    await expect(page.getByTestId('data-rule')).toContainText('un ambiente de prueba no lleva datos reales')
    await expect(page.getByTestId('data-imported')).toContainText('0')
    await expect(page.getByTestId('data-clean')).toBeVisible()
    await expect(page.getByTestId('data-command')).toContainText('node scripts/synthetic.mjs --market MX')
    await check(page, 'gobierno datos 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'gobierno datos 390')
  })
})

test.describe('Pedir un cambio y motivo de cada cambio (E7)', () => {
  test('quien vende pide un cambio con su para qué; administración lo aprueba con una nota y la respuesta vuelve a quien pidió', async ({ page }) => {
    const errors = pageErrors(page)
    const title = `Horario de apertura ${uniq()}`
    await loginAs(page, 'lucia.vega')
    await page.goto('/solicitudes')
    await expect(page.getByTestId('who-does-what')).toContainText('Administración')
    await expect(page.getByTestId('request-must')).toContainText('Para qué sirve')
    await page.getByTestId('request-kind').selectOption('field')
    await page.getByTestId('request-title').fill(title)
    await page.getByTestId('request-purpose').fill('corto')
    await page.getByTestId('request-send').click()
    await expect(page.getByTestId('request-row').filter({ hasText: title })).toHaveCount(0)
    await page.getByTestId('request-purpose').fill('Para planear a qué hora se visita cada comercio en la ruta de la mañana')
    await page.getByTestId('request-send').click()
    await expect(page.getByTestId('request-row').filter({ hasText: title })).toHaveAttribute('data-status', 'open')
    await check(page, 'solicitudes 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'solicitudes 390')
    await page.setViewportSize({ width: 1440, height: 900 })

    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/gobierno?tab=cambios')
    const row = page.getByTestId('request-admin-row').filter({ hasText: title })
    await expect(row).toContainText('Lucía Vega')
    await row.getByTestId('request-note').fill('Va compartido para todos los mercados')
    await row.getByTestId('request-approve').click()
    await expect(row).toHaveAttribute('data-status', 'approved')
    // los cambios de configuración salen de la bitácora, con su porqué o con el aviso de que falta
    await expect(page.getByTestId('config-changes')).toBeVisible()
    await expect(page.getByTestId('champions')).toBeVisible()
    await expect(page.getByTestId('materials-admin')).toBeVisible()
    await check(page, 'gobierno cambios 1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await check(page, 'gobierno cambios 390')
    await page.setViewportSize({ width: 1440, height: 900 })

    await loginAs(page, 'lucia.vega')
    await page.goto('/solicitudes')
    const mine = page.getByTestId('request-row').filter({ hasText: title })
    await expect(mine).toHaveAttribute('data-status', 'approved')
    await expect(mine.getByTestId('request-answer')).toContainText('Va compartido para todos los mercados')
    // otra persona no ve la solicitud de Lucía
    await loginAs(page, 'marco.pena')
    await page.goto('/solicitudes')
    await expect(page.getByTestId('request-row').filter({ hasText: title })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('leadership lee Gobierno y no cambia nada; quien vende no entra', async ({ page }) => {
    await loginAs(page, 'luis.tovar', { stay: true })
    await page.goto('/admin/gobierno?tab=costos')
    await expect(page.getByTestId('gov-read-only')).toBeVisible()
    await expect(page.getByTestId('cost-new')).toHaveCount(0)
    await page.goto('/admin/gobierno?tab=versiones')
    await expect(page.getByTestId('release-new')).toHaveCount(0)
    await expect(page.getByTestId('component-edit')).toHaveCount(0)

    await loginAs(page, 'lucia.vega')
    await page.goto('/admin/gobierno')
    await expect(page.getByTestId('gov-service')).toHaveCount(0)
  })
})
