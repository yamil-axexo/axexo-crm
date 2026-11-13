import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Paquete b2b: tipo de cuenta, jerarquía, campos B2B, pausa, motivos por embudo, contactos corporativos,
// próximos pasos por tipo de venta y lo que administración crea desde la pantalla.
// Número de tarjeta de prueba, armado por partes para que el escáner de datos prohibidos no lo confunda con uno real.
const CARD = ['4111', '1111', '1111', '1111'].join(' ')
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase()

async function check(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`), `${what}: accesibilidad`).toEqual([])
}

/** Crea una cuenta B2B desde el alta manual y deja abierta su ficha a pantalla completa. */
async function newB2bAccount(page: Page, name: string, type: string, pointsOfSale?: string) {
  await page.goto('/comercios')
  await page.getByTestId('new-account').click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByTestId('account-type').selectOption(type)
  await dialog.getByTestId('account-name').fill(name)
  // lo mínimo para calificar solo se pide cuando el canal es B2B
  await expect(dialog.getByTestId('intake-field')).toHaveCount(0)
  await dialog.locator('select[name=segment]').selectOption('b2b')
  await expect(dialog.getByTestId('intake-field')).toHaveCount(4)
  if (pointsOfSale) await dialog.locator('input[name=f_b2b_points_of_sale]').fill(pointsOfSale)
  await dialog.getByTestId('save-account').click()
  await expect(page.locator('h1')).toHaveText(name)
  return page.url().split('/').pop()!.split('?')[0]!
}

test.describe('cuenta B2B', () => {
  test('tipo de cuenta, lo mínimo para calificar, expediente y contactos corporativos', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `ISO de Prueba ${uniq()}`
    await loginAs(page, 'diana.cruz')
    const id = await newB2bAccount(page, name, 'iso', '18')
    await expect(page.getByTestId('ficha-type')).toContainText('ISO')
    await expect(page.getByTestId('ficha-type')).not.toContainText('Tienda')

    await fichaTab(page, 'datos')
    const qualify = page.getByTestId('field-section-qualify')
    await expect(qualify.locator('[data-key=b2b_points_of_sale]')).toContainText('18')
    await expect(qualify.locator('[data-key=b2b_integration]')).toContainText('Falta')
    await expect(page.getByTestId('field-section-terms')).toContainText('Comisión acordada')
    // el expediente aparece cuando se sabe el tipo de persona
    await expect(page.getByTestId('field-section-file').getByTestId('section-field')).toHaveCount(1)

    // cambia el tipo: el nombre visible cambia con él
    await page.getByTestId('type-select').selectOption('corporate')
    await page.getByTestId('type-save').click()
    await expect(page.getByTestId('type-form').getByTestId('form-ok')).toBeVisible()
    await expect(page.getByTestId('ficha-type')).toContainText('Corporativo')

    // expediente por tipo de persona: lista de documentos con estado, nunca el documento
    await page.getByTestId('custom-edit').click()
    await expect(page).toHaveURL(new RegExp(`/comercios/${id}/campos`))
    const form = page.getByTestId('custom-form')
    await expect(form.locator('select[name=f_b2b_doc_acta]')).toBeHidden()
    await form.locator('select[name=f_b2b_entity_type]').selectOption('Persona moral')
    await expect(form.locator('select[name=f_b2b_doc_acta]')).toBeVisible()
    await expect(form.locator('select[name=f_b2b_doc_id]')).toBeHidden()
    await form.locator('select[name=f_b2b_doc_acta]').selectOption('Validado')
    await form.locator('select[name=f_b2b_doc_poder]').selectOption('Recibido')
    await form.locator('input[name=f_b2b_commission]').fill(`Depositar a la tarjeta ${CARD}`)
    await page.getByTestId('custom-save').click()
    await expect(form.getByTestId('form-error')).toContainText('no se guarda')
    await form.locator('input[name=f_b2b_commission]').fill('3% sobre recargas')
    await page.getByTestId('custom-save').click()
    await expect(form.getByTestId('form-ok')).toBeVisible()
    await page.getByTestId('custom-back').click()
    const file = page.getByTestId('field-section-file')
    await expect(file.getByTestId('file-progress')).toHaveText('1 de 3 documentos validados')
    await expect(file.locator('[data-key=b2b_doc_csf_moral]')).toContainText('Pendiente')
    await expect(file.locator('[data-key=b2b_doc_id]')).toHaveCount(0)
    await check(page, 'ficha B2B, datos')

    // contactos de una cuenta corporativa
    await page.getByTestId('add-contact').click()
    await page.getByTestId('contact-name').fill('Compras De Prueba')
    await page.getByTestId('contact-role').selectOption('purchasing')
    await page.getByTestId('save-contact').click()
    await expect(page.getByTestId('contact-row')).toHaveCount(1)
    await page.getByTestId('add-contact').click()
    await page.getByTestId('contact-name').fill('Integración De Prueba')
    await page.getByTestId('contact-role').selectOption('technology')
    await page.getByTestId('contact-phone').fill('5512340000')
    await page.getByTestId('contact-locale').selectOption('en')
    await page.getByTestId('contact-sms').check()
    // justo después de guardar, el formulario ignora otro envío por un momento (un doble clic no agrega dos contactos)
    await page.waitForTimeout(800)
    await page.getByTestId('save-contact').click()
    await expect(page.getByTestId('contact-row')).toHaveCount(2)
    const first = page.getByTestId('contact-row').first()
    await expect(first).toContainText('Compras De Prueba')
    await expect(first).toContainText('Principal')
    const tech = page.getByTestId('contact-row').nth(1)
    await expect(tech).toContainText('Tecnología e integración')
    await expect(tech).toContainText('Recibe SMS')
    await expect(tech).toContainText('Prefiere inglés')
    await tech.getByTestId('contact-make-primary').click()
    await expect(page.getByTestId('contact-row').first()).toContainText('Integración De Prueba')
    await expect(page.getByTestId('contact-row').first()).toContainText('Principal')
    expect(errors).toEqual([])
  })

  test('quien vende arma el árbol de sus cuentas: "Pertenece a" y "Sus cuentas"', async ({ page }) => {
    const iso = `Distribuidor Matriz ${uniq()}`
    const sub = `Sub-cuenta ${uniq()}`
    await loginAs(page, 'diana.cruz')
    const isoId = await newB2bAccount(page, iso, 'distributor')
    await newB2bAccount(page, sub, 'chain')
    await fichaTab(page, 'datos')
    await page.getByTestId('parent-select').selectOption({ label: iso })
    await page.getByTestId('parent-save').click()
    await expect(page.getByTestId('ficha-parent')).toHaveText(iso)
    await page.getByTestId('ficha-parent').click()
    await expect(page).toHaveURL(new RegExp(isoId))
    await expect(page.getByTestId('ficha-children')).toHaveText('Sus cuentas (1)')
    await expect(page.getByTestId('child-row')).toContainText(sub)
    // la matriz no puede colgar de su propia sub-cuenta
    await fichaTab(page, 'datos')
    await page.getByTestId('parent-select').selectOption({ label: sub })
    await page.getByTestId('parent-save').click()
    await expect(page.getByTestId('account-data').getByTestId('form-error')).toContainText('no puede ser su matriz')
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height })
      await check(page, `árbol B2B en ${w.name}`)
    }
  })
})

test.describe('negocio B2B', () => {
  test('pausa con motivo y fecha, filtro en el tablero, motivos de pérdida del embudo y próximos pasos de B2B', async ({ page }) => {
    const errors = pageErrors(page)
    const name = `Cadena En Pausa ${uniq()}`
    await loginAs(page, 'diana.cruz')
    await newB2bAccount(page, name, 'chain')

    // una tarea de la cuenta B2B: la hoja ofrece los próximos pasos de B2B y "Otra tarea" pide decir cuál
    await page.getByTestId('action-activity').click()
    await page.getByTestId('activity-subject').fill('Presentar la propuesta')
    await page.getByTestId('activity-due').fill(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }))
    await page.getByTestId('activity-add').click()
    await page.getByTestId('thread-next').getByTestId('row-complete').click()
    const sheet = page.locator('[data-testid="complete-sheet"][open]')
    await expect(sheet.getByTestId('choices-next').locator('label')).toHaveText(['Llamar', 'Enviar propuesta', 'Reunión', 'Enviar contrato', 'Arranque de integración', 'Pruebas', 'Certificación', 'Otra tarea', 'Nada más: cerrar'])
    await sheet.getByText('Otra tarea', { exact: true }).click()
    await sheet.getByTestId('sheet-save').click()
    // sin texto no guarda: el campo es obligatorio
    await expect(sheet).toBeVisible()
    expect(await sheet.getByTestId('sheet-next-text').evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true)
    await sheet.getByTestId('sheet-next-text').fill('Mandar el NDA firmado')
    await sheet.getByTestId('sheet-save').click()
    await expect(page.getByTestId('toast')).toContainText('Próximo paso: Mandar el NDA firmado')

    await page.getByTestId('new-deal').click()
    await page.locator('dialog[open] select[name=pipeline_id]').selectOption({ label: 'Cadenas y distribuidores' })
    await page.getByTestId('new-deal-step').fill('Reunión con dirección')
    await page.getByTestId('save-deal').click()
    await expect(page).toHaveURL(/\/deals\//)
    const dealUrl = page.url()

    // motivos de pérdida: los del embudo B2B, no los de tienda
    await page.getByTestId('deal-lose').click()
    const reasons = page.locator('dialog[open]').getByTestId('loss-reason').locator('option')
    await expect(reasons.filter({ hasText: 'Integración técnica no viable' })).toHaveCount(1)
    await expect(reasons.filter({ hasText: 'No pasó certificación' })).toHaveCount(1)
    await expect(reasons.filter({ hasText: 'La tienda cerró' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // pausa
    const review = new Date(Date.now() + 21 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
    await page.getByTestId('deal-pause').click()
    await page.getByTestId('pause-reason').fill('El cliente cierra presupuesto en enero')
    await page.getByTestId('pause-review').fill(review)
    await page.getByTestId('pause-save').click()
    await expect(page.getByTestId('pause-banner')).toContainText('En pausa')
    await expect(page.getByTestId('pause-banner')).toContainText('El cliente cierra presupuesto en enero')
    await expect(page.getByTestId('deal-pause')).toHaveCount(0)
    await check(page, 'negocio en pausa')

    // en el tablero: filtro "En pausa"
    const pipelineId = await (async () => {
      const sql = testDb()
      const rows = await sql<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b' and is_active order by position limit 1`
      await sql.end()
      return rows[0]!.id
    })()
    await page.goto(`/pipelines/${pipelineId}?paso=pausa`)
    await expect(page.getByTestId('filter-paused')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('filter-paused')).toContainText('En pausa (1)')
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByText(/En pausa · se revisa/).first()).toBeVisible()
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height })
      await check(page, `tablero con filtro de pausa en ${w.name}`)
    }
    await page.setViewportSize({ width: 1440, height: 900 })

    // hoy no está en la lista de Hoy; se retoma desde el negocio
    await page.goto('/hoy')
    await expect(page.getByTestId('queue').getByText(`Revisar negocio en pausa`)).toHaveCount(0)
    await page.goto(dealUrl)
    await page.getByTestId('deal-resume').click()
    await expect(page.getByTestId('pause-banner')).toHaveCount(0)
    await expect(page.getByTestId('deal-pause')).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('administración configura desde la pantalla', () => {
  test('crea un embudo, agrega, reordena y archiva etapas; crea un campo, un tipo de cuenta y un motivo', async ({ page }) => {
    const errors = pageErrors(page)
    const pipe = `Eventos de Prueba ${uniq()}`
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=embudos')
    await expect(page.getByTestId('config-scope')).toContainText('creas embudos, campos, tipos de cuenta y motivos de pérdida')

    await page.getByTestId('pipeline-new').click()
    await page.locator('dialog[open]').getByTestId('pipeline-new-name').fill(pipe)
    await page.locator('dialog[open]').getByTestId('pipeline-new-market').selectOption('MX')
    await page.locator('dialog[open]').getByTestId('pipeline-new-motor').selectOption('event')
    await page.locator('dialog[open]').getByTestId('pipeline-new-stages').fill('Contacto | Contact\nPropuesta | Proposal')
    await page.locator('dialog[open]').getByTestId('pipeline-new-save').click()
    const section = page.locator(`[data-testid=stage-admin-pipeline][data-pipeline="${pipe}"]`)
    await expect(section.getByTestId('stage-admin-name')).toHaveText(['Contacto', 'Propuesta'])

    await section.getByTestId('stage-add').click()
    await page.locator('dialog[open]').getByTestId('stage-add-es').fill('Integración')
    await page.locator('dialog[open]').getByTestId('stage-add-en').fill('Integration')
    await page.locator('dialog[open]').getByTestId('stage-add-save').click()
    await expect(section.getByTestId('stage-admin-name')).toHaveText(['Contacto', 'Propuesta', 'Integración'])
    await section.getByTestId('stage-admin-row').nth(2).getByTestId('stage-up').click()
    await expect(section.getByTestId('stage-admin-name')).toHaveText(['Contacto', 'Integración', 'Propuesta'])
    await section.getByTestId('stage-admin-row').first().getByTestId('stage-archive').click()
    await page.locator('dialog[open]').getByTestId('stage-archive-save').click()
    await expect(section.getByTestId('stage-admin-name')).toHaveText(['Integración', 'Propuesta'])
    await expect(section.getByTestId('stage-archived')).toContainText('Contacto')
    // el embudo nuevo ya tiene su tarjeta, con cierre a mano
    await expect(page.getByTestId('pipeline-card').filter({ hasText: pipe })).toContainText('cierre manual')

    // un campo nuevo para cuentas B2B de México
    const field = `Canal de origen ${uniq()}`
    await page.getByTestId('field-new').click()
    const dialog = page.locator('dialog[open]')
    await dialog.getByTestId('b2b-label-es').fill(field)
    await dialog.getByTestId('b2b-label-en').fill(`${field} en`)
    await dialog.getByTestId('field-new-object').selectOption('account')
    await dialog.getByTestId('field-new-type').selectOption('select')
    await dialog.getByTestId('field-new-market').selectOption('MX')
    await dialog.getByTestId('field-new-motor').selectOption('b2b')
    await dialog.getByTestId('field-new-options').fill('Referido\nEvento')
    // paquete datos (GOB-01): sin decisión documentada no hay campo
    await dialog.getByTestId('field-new-decision').fill('Decide por qué canal se le da seguimiento a la cuenta')
    await dialog.getByTestId('field-new-save').click()
    await expect(page.getByTestId('field-row').filter({ hasText: field })).toHaveCount(1)
    // un campo que pediría un dato que no se guarda no se crea
    await page.getByTestId('field-new').click()
    await page.locator('dialog[open]').getByTestId('b2b-label-es').fill('CLABE del comercio')
    await page.locator('dialog[open]').getByTestId('b2b-label-en').fill('Merchant CLABE')
    await page.locator('dialog[open]').getByTestId('field-new-decision').fill('Decide a qué cuenta se le deposita')
    await page.waitForTimeout(800)
    await page.locator('dialog[open]').getByTestId('field-new-save').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText('no guarda')
    await page.keyboard.press('Escape')

    // tipo de cuenta y motivo de pérdida
    const type = `Mayorista ${uniq()}`
    await page.getByTestId('type-new').click()
    await page.locator('dialog[open]').getByTestId('b2b-label-es').fill(type)
    await page.locator('dialog[open]').getByTestId('b2b-label-en').fill(`${type} en`)
    await page.locator('dialog[open]').getByTestId('type-new-save').click()
    await expect(page.getByTestId('type-row').filter({ hasText: type })).toHaveCount(1)
    const reason = `Sin presupuesto ${uniq()}`
    await page.getByTestId('reason-new').click()
    await page.locator('dialog[open]').getByTestId('b2b-label-es').fill(reason)
    await page.locator('dialog[open]').getByTestId('b2b-label-en').fill(`${reason} en`)
    await page.locator('dialog[open]').getByTestId('reason-new-b2b').check()
    await page.locator('dialog[open]').getByTestId('reason-new-save').click()
    await expect(page.getByTestId('reason-row').filter({ hasText: reason }).getByTestId('reason-scope')).toHaveText('Cadenas y distribuidores')
    await check(page, 'administración, embudos y campos')
    for (const w of WIDTHS.slice(1)) {
      await page.setViewportSize({ width: w.width, height: w.height })
      await check(page, `administración, embudos y campos en ${w.name}`)
    }
    await page.setViewportSize({ width: 1440, height: 900 })

    // el campo nuevo aparece en una cuenta B2B y el tipo nuevo se puede elegir
    const sql = testDb()
    const acc = await sql<{ id: string }[]>`select id from crm.accounts where market_code = 'MX' and segment = 'b2b' and archived_at is null and kind <> 'store' order by created_at desc limit 1`
    await sql.end()
    await page.goto(`/comercios/${acc[0]!.id}/campos`)
    await expect(page.getByTestId('custom-form').getByText(field, { exact: true })).toBeVisible()
    await page.goto(`/comercios/${acc[0]!.id}?tab=datos`)
    await expect(page.getByTestId('type-select').locator('option').filter({ hasText: type })).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('cambiar cómo se gana un embudo dice a cuántos negocios afecta, pide confirmación y se ve en Estado', async ({ page }) => {
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=embudos')
    const card = page.getByTestId('pipeline-card').filter({ hasText: 'MX · Cadenas y distribuidores' })
    await expect(card.getByTestId('pipeline-confirm-label')).toContainText('negocios abiertos')
    await card.getByTestId('pipeline-cbt').uncheck()
    await card.getByTestId('pipeline-config-save').click()
    await expect(card.getByTestId('form-error')).toContainText('Marca la casilla de confirmación')
    await page.reload()
    await expect(page.getByTestId('pipeline-card').filter({ hasText: 'MX · Cadenas y distribuidores' }).getByTestId('pipeline-cbt')).toBeChecked()

    await page.goto('/estado')
    const rules = page.getByTestId('status-close-rules')
    await expect(rules.getByTestId('status-close-rule').filter({ hasText: 'MX · Cadenas y distribuidores' })).toContainText('Con la primera transacción')
    await check(page, 'estado, reglas de cierre')
  })

  test('formulario web: administración decide qué pide, la página lo pide y la respuesta llega al lead', async ({ page }) => {
    const business = `Cadena Web ${uniq()}`
    await page.goto('/f/contacto-mx')
    await expect(page.getByTestId('public-extra')).toHaveCount(3)
    await page.locator('input[name=business_name]').fill(business)
    await page.locator('input[name=contact_name]').fill('Contacto De Prueba')
    await page.locator('input[name=phone]').fill('5598760000')
    await page.locator('input[name=x_b2b_points_of_sale]').fill('35')
    await page.locator('select[name=x_b2b_integration]').selectOption('API')
    await check(page, 'formulario web B2B')
    await page.getByTestId('public-submit').click()
    await expect(page.getByTestId('public-form').getByTestId('form-ok')).toBeVisible()

    const sql = testDb()
    const lead = await sql<{ id: string }[]>`select id from crm.leads where business_name = ${business}`
    await sql.end()
    await loginAs(page, 'nora.salas')
    await page.goto(`/leads/${lead[0]!.id}`)
    await expect(page.getByTestId('lead-answers')).toContainText('Puntos de venta')
    await expect(page.getByTestId('lead-answers')).toContainText('35')
    await expect(page.getByTestId('lead-answers')).toContainText('API')

    await page.goto('/admin?tab=embudos')
    const row = page.getByTestId('form-admin-row').filter({ hasText: '/f/contacto-mx' })
    await expect(row.getByTestId('form-asks')).toContainText('Puntos de venta')
    await row.getByTestId('form-edit').click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByTestId('form-edit-ask')).toHaveCount(3)
    await dialog.getByTestId('form-edit-ask').nth(1).uncheck()
    await dialog.getByTestId('form-edit-save').click()
    await expect(row.getByTestId('form-asks')).not.toContainText('Volumen mensual')
    await page.goto('/f/contacto-mx')
    await expect(page.getByTestId('public-extra')).toHaveCount(2)
  })

  test('un equipo sin supervisión lo dice en Personas y acceso', async ({ page }) => {
    const team = `Equipo ISO ${uniq()}`
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=personas')
    await page.getByTestId('team-open').click()
    await page.locator('dialog[open] input[name=name]').fill(team)
    await page.getByTestId('team-market').selectOption('MX')
    await page.getByTestId('team-motor').selectOption('b2b')
    await page.getByTestId('team-save').click()
    const notice = page.getByTestId('team-unsupervised').filter({ hasText: team })
    await expect(notice).toContainText('Sin supervisión: lo cubre quien lidera el mercado')
    await expect(notice).toContainText('Ana Robles')
    await check(page, 'personas y acceso con aviso de equipo sin supervisión')
  })
})
