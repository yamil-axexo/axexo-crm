import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Paquete ciclo-cs: cuidado del comercio después de la venta (catálogo CS-01 a CS-08), desde la pantalla y por el rol que
// corresponde, en español y en inglés, a 1440, 1024 y 390 px.
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase()

async function check(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`), `${what}: accesibilidad`).toEqual([])
}
async function widths(page: Page, what: string) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await check(page, `${what} (${w.name})`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
const english = async (page: Page) => {
  await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
  await page.reload()
}
const spanish = async (page: Page) => {
  await page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])
  await page.reload()
}

/** Un comercio de los datos de ejemplo que lleva la persona, en la etapa pedida. Cada prueba usa uno distinto. */
async function accountOf(persona: string, lifecycle: string, kind = 'store', skip = 0): Promise<{ id: string; name: string }> {
  const db = testDb()
  try {
    const rows = await db<{ id: string; name: string }[]>`
      select a.id, a.name from crm.accounts a
       where a.owner_id = md5(${'contigo:' + persona})::uuid and a.lifecycle = ${lifecycle} and a.kind = ${kind} and a.archived_at is null
         and not exists (select 1 from crm.handoffs h where h.account_id = a.id) and not exists (select 1 from crm.cs_alerts x where x.account_id = a.id)
         -- un comercio activo de otra prueba (campo y canales) puede no estar en el archivo de ventas: aquí se usa uno que sí está
         and (a.lifecycle <> 'active' or exists (select 1 from crm.merchant_metrics_daily m where m.account_id = a.id))
       order by a.id offset ${skip} limit 1`
    if (!rows[0]) throw new Error(`no hay comercio ${lifecycle} de ${persona}`)
    return rows[0]
  } finally {
    await db.end()
  }
}

test.afterAll(async () => {
  // Las alertas de México vuelven a quedar apagadas y el puntaje sin publicar, como al empezar.
  const db = testDb()
  await db`update crm.cs_settings set alerts_on = false, health_published = false`
  await db.end()
})

test.describe('CS-01 · ciclo de vida y entregas con acuse', () => {
  test('la ficha lleva a Cuidado del comercio: etapa, de dónde salió, su ventana y la entrega a Operaciones con lista y acuse', async ({ page }) => {
    const errors = pageErrors(page)
    const acc = await accountOf('marco.pena', 'active')
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${acc.id}?tab=datos`)
    await page.getByTestId('ficha-care').click()
    await expect(page).toHaveURL(new RegExp(`/comercios/${acc.id}/cuidado$`))
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Cuidado de ${acc.name}`)
    await expect(page.getByTestId('stage-now')).toHaveText(/Activo|Con hábito/)
    await expect(page.getByTestId('stage-source')).toContainText('De dónde salió')
    await expect(page.getByTestId('stage-metrics')).toContainText('días con venta')
    await expect(page.getByTestId('stage-window')).toContainText('entra a riesgo con menos de 5 días con venta en 30 y sale con 8 o más')
    await expect(page.getByTestId('care-owner')).toContainText('Todavía nadie lo cuida después de la venta')
    await widths(page, 'cuidado del comercio')
    // entrega a Operaciones: quién recibe, para cuándo y nota
    const form = page.getByTestId('handoff-form')
    await form.getByTestId('handoff-role').selectOption('ops')
    await form.getByTestId('handoff-person').selectOption({ label: 'Valeria Soto' })
    await form.getByTestId('handoff-new-note').fill('Le prometimos visita de arranque')
    await form.getByTestId('handoff-save').click()
    const h = page.getByTestId('handoff').first()
    await expect(h).toHaveAttribute('data-status', 'pending')
    await expect(h).toContainText('Ventas → Operaciones')
    await expect(h).toContainText('Recibe Valeria Soto')
    await expect(h.getByTestId('handoff-item')).toHaveCount(3)
    // quien entrega marca lo que sí entrega; el acuse no es suyo
    await h.getByTestId('handoff-check').first().click()
    await expect(h.getByTestId('handoff-item').first()).toHaveAttribute('data-done', '1')
    await expect(h.getByTestId('handoff-accept')).toHaveCount(0)

    // Valeria la ve en su mesa de trabajo, y da el acuse diciendo qué falta
    await loginAs(page, 'valeria.soto', { stay: true })
    await page.goto('/cuidado')
    const row = page.getByTestId('board-handoff').filter({ hasText: acc.name })
    await expect(row).toContainText('1 de 3 puntos listos')
    await widths(page, 'mesa de trabajo, entregas')
    await row.getByTestId('care-link').click()
    const mine = page.getByTestId('handoff').first()
    await mine.getByTestId('handoff-accept').click()
    await expect(mine.getByTestId('form-error')).toContainText('Faltan 2 puntos de la lista')
    await mine.getByTestId('handoff-note').fill('Faltan los documentos; los pido yo')
    await mine.getByTestId('handoff-accept').click()
    await expect(page.getByTestId('handoff').first()).toHaveAttribute('data-status', 'acknowledged')
    await expect(page.getByTestId('handoff-ack').first()).toContainText('Acuse de Valeria Soto')
    await expect(page.getByTestId('care-owner')).toContainText('Lo cuida Valeria Soto, como Operaciones. Ventas: Marco Peña.')
    // en inglés
    await english(page)
    await expect(page.getByTestId('care-owner')).toContainText('Valeria Soto looks after it, as Operations. Sales: Marco Peña.')
    await expect(page.getByTestId('handoff').first()).toContainText('Sales → Operations')
    await check(page, 'care page in English')
    await spanish(page)
    expect(errors).toEqual([])
  })

  test('quien lidera el mercado cambia la ventana, las reglas la validan, y recalcular deja el cambio en el historial del comercio', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/cuidado')
    await page.getByTestId('care-admin-link').click()
    await expect(page).toHaveURL(/\/admin\/cuidado/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cuidado de comercios: México')
    await widths(page, 'administración de cuidado')
    const general = page.getByTestId('window-general')
    // salir de riesgo tiene que pedir más días que entrar
    await general.getByTestId('w-recover').fill('5')
    await general.getByTestId('w-save').click()
    await expect(general.getByTestId('form-error')).toContainText('Para salir de riesgo se piden más días con venta que para entrar')
    await general.getByTestId('w-recover').fill('9')
    await general.getByTestId('w-habit').fill('18')
    await general.getByTestId('w-save').click()
    await expect(general.getByTestId('form-ok')).toContainText('Ventana guardada')
    await expect(page.getByTestId('window-general').getByTestId('window-origin')).toHaveText('Definida a mano')
    // calibrar pide datos propios suficientes; con los de ejemplo dice qué falta en vez de inventar un umbral
    const bill = page.getByTestId('window-bill_pay')
    await bill.getByTestId('w-backtest').click()
    await expect(bill.getByTestId('form-ok')).toContainText('Todavía no hay datos propios suficientes')
    await page.getByTestId('run-lifecycle').click()
    await expect(page.getByTestId('admin-windows').getByTestId('form-ok').last()).toContainText(/cambi(ó|aron) de etapa/)
    // un comercio que quedó con hábito: su pantalla dice de dónde salió y el historial tiene el cambio
    const db = testDb()
    const moved = await db<{ id: string }[]>`select c.account_id as id from crm.account_care c join crm.accounts a on a.id = c.account_id where a.market_code = 'MX' and c.stage = 'habit' limit 1`
    await db.end()
    expect(moved[0]).toBeTruthy()
    await page.goto(`/comercios/${moved[0]!.id}/cuidado`)
    await expect(page.getByTestId('stage-now')).toHaveText('Con hábito')
    await expect(page.getByTestId('stage-source')).toContainText('Archivo de ventas')
    await expect(page.getByTestId('stage-window')).toContainText('sale con 9 o más. Tiene hábito desde 18 días')
    await expect(page.getByTestId('stage-event').first()).toContainText('Activo → Con hábito')
    // la mesa de trabajo cuenta las ocho etapas
    await page.goto('/cuidado')
    for (const s of ['prospect', 'onboarding', 'active', 'habit', 'at_risk', 'inactive', 'reactivated', 'churned']) await expect(page.getByTestId(`stage-count-${s}`)).toBeVisible()
    expect(Number(await page.getByTestId('stage-count-habit').locator('p').nth(1).innerText())).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
})

test.describe('CS-03 y CS-06 · alertas con tarea y guía de acción; capacitación y cambio de encargado', () => {
  test('con las alertas encendidas, el cambio de encargado abre la alerta con su tarea y su guía; la constancia de capacitación la cierra', async ({ page }) => {
    const errors = pageErrors(page)
    // quien lidera el mercado enciende las alertas y ajusta la guía de acción
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/admin/cuidado?mercado=MX')
    await expect(page.getByTestId('alerts-state')).toHaveText('Apagadas')
    await expect(page.getByTestId('whatsapp-state')).toContainText('WhatsApp está apagado')
    const settings = page.getByTestId('settings-form')
    await settings.getByTestId('alerts-on').check()
    await settings.getByTestId('s-holdout').fill('0')
    await settings.getByTestId('settings-save').click()
    await expect(settings.getByTestId('form-ok')).toContainText('Alertas guardadas')
    await expect(page.getByTestId('alerts-state')).toHaveText('Encendidas')
    const pb = page.getByTestId('playbook-manager_change')
    const title = `Encargado nuevo: capacitarlo ${uniq()}`
    await pb.getByTestId('pb-title-es').fill(title)
    await pb.getByTestId('pb-steps-es').fill('Preséntate con el encargado nuevo.\nAgenda su capacitación en Kore Academy.')
    await pb.getByTestId('pb-save').click()
    await expect(pb.getByTestId('form-ok')).toContainText('Guía de acción guardada')

    // quien vende registra el cambio de encargado que vio en la visita
    const acc = await accountOf('marco.pena', 'active', 'store', 1)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${acc.id}/cuidado`)
    await expect(page.getByTestId('care-alerts')).toContainText('Alertas encendidas')
    await expect(page.getByTestId('care-consent')).toContainText('Ningún contacto de este comercio ha dado permiso')
    const mf = page.getByTestId('manager-form')
    await mf.getByTestId('manager-name').fill('Rosa Encargada')
    await mf.getByTestId('manager-note').fill('La dueña le dejó la tienda a su sobrina')
    await mf.getByTestId('manager-save').click()
    await expect(page.getByTestId('manager-change').first()).toContainText('Rosa Encargada')
    await expect(page.getByTestId('manager-change').first()).toContainText('Sin capacitar')
    const alert = page.getByTestId('alert').first()
    await expect(alert).toHaveAttribute('data-kind', 'manager_change')
    await expect(alert).toHaveAttribute('data-status', 'open')
    await expect(alert.getByTestId('alert-owner')).toContainText('Tarea para Marco Peña')
    await expect(alert.getByTestId('alert-playbook')).toContainText(title)
    await expect(alert.getByTestId('alert-playbook').locator('li')).toHaveText(['Preséntate con el encargado nuevo.', 'Agenda su capacitación en Kore Academy.'])
    await widths(page, 'cuidado del comercio con alerta')
    // la tarea está en su lista de actividades, con los pasos
    await page.goto('/actividades')
    await expect(page.getByText(`${title}: ${acc.name}`).first()).toBeVisible()
    // y en la mesa de trabajo, con su dueño
    await page.goto('/cuidado?vista=alertas')
    await expect(page.getByTestId('board-alert').filter({ hasText: acc.name })).toContainText('Cambió el encargado')
    await widths(page, 'mesa de trabajo, alertas')
    // la constancia de capacitación (a mano mientras Kore Academy está apagada) cierra la alerta
    await page.goto(`/comercios/${acc.id}/cuidado`)
    await expect(page.getByTestId('care-training')).toContainText('Kore Academy: conexión apagada')
    const cf = page.getByTestId('completion-form')
    await cf.getByTestId('completion-person').fill('Rosa Encargada')
    await cf.getByTestId('completion-title').fill('Primeros pasos para vender')
    await cf.getByTestId('completion-key').fill('intro-ventas')
    await cf.getByTestId('completion-save').click()
    await expect(page.getByTestId('completion').first()).toContainText('Primeros pasos para vender')
    await expect(page.getByTestId('manager-change').first()).toContainText('Capacitado')
    await expect(page.getByTestId('alert').first()).toHaveAttribute('data-status', 'closed')
    await expect(page.getByTestId('alert').first()).toContainText('Se resolvió sola')
    expect(errors).toEqual([])
  })
})

test.describe('CS-02 y CS-04 · salud explicada y modelo de atención', () => {
  test('administración calcula el puntaje, no puede publicarlo sin validar, y cada comercio muestra de qué se compone; ventas no lo ve hasta que se publique', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.getByTestId('pill-cuidado').click()
    await expect(page).toHaveURL(/\/admin\/cuidado/)
    await page.goto('/admin/cuidado?mercado=MX')
    await expect(page.getByTestId('health-state')).toHaveText('En validación')
    const health = page.getByTestId('admin-health')
    await page.getByTestId('run-health').click()
    await expect(health.getByTestId('form-ok').first()).toContainText('Puntaje de hoy calculado para')
    await page.getByTestId('run-tiers').click()
    await expect(page.getByTestId('admin-tiers').getByTestId('form-ok').last()).toContainText(/modelo de atención/)
    // publicar pide una validación con muestra suficiente
    await page.getByTestId('health-publish').click()
    await expect(health.getByTestId('form-error')).toContainText('Antes de publicarlo hay que validarlo contra lo que pasó')
    // los pesos son datos que se cambian aquí
    const weights = page.getByTestId('weights-form')
    await weights.getByTestId('w-tickets').fill('10')
    await weights.getByTestId('weights-save').click()
    await expect(weights.getByTestId('form-ok')).toContainText('Pesos guardados')
    // las conexiones apagadas dicen qué falta
    // tres conexiones propias; el borrador con IA usa el adaptador único de AI (integración 95-4)
    await expect(page.getByTestId('care-adapter')).toHaveCount(3)
    await expect(page.getByTestId('admin-care-adapters')).toContainText('Conteo de solicitudes de soporte (Zendesk)')
    await expect(page.getByTestId('admin-care-adapters')).toContainText('Conexión apagada')
    await page.goto('/estado')
    await expect(page.getByText('Conteo de solicitudes de soporte (Zendesk)')).toBeVisible()
    await expect(page.getByText('Borrador de revisión de cuenta con IA')).toBeVisible()

    // la mesa de trabajo: modelo de atención y los comercios que más atención piden
    await page.goto('/cuidado?mercado=MX&vista=salud')
    await expect(page.getByTestId('board-health')).toContainText('En validación')
    await expect(page.getByTestId('health-row').first()).toBeVisible()
    expect(Number(await page.getByTestId('tier-count-high').locator('p').nth(1).innerText())).toBeGreaterThan(0)
    await widths(page, 'mesa de trabajo, salud')
    await page.getByTestId('health-row').first().getByTestId('care-link').click()
    await expect(page.getByTestId('health-score')).toHaveText(/^\d{1,3}$/)
    await expect(page.getByTestId('health-unvalidated')).toHaveText('Sin publicar: en validación')
    await expect(page.getByTestId('health-group')).toHaveCount(4)
    await expect(page.locator('[data-testid=health-group][data-grp=transactions]')).toContainText(/de 50 puntos/)
    await expect(page.locator('[data-testid=health-group][data-grp=tickets]')).toContainText('no cuenta')
    await expect(page.locator('[data-testid=health-group][data-grp=tickets]')).toContainText('Sin dato: conexión con Zendesk apagada')
    await expect(page.getByTestId('tier-now')).toBeVisible()
    await widths(page, 'cuidado del comercio con salud')
    const url = page.url()
    await english(page)
    await expect(page.locator('[data-testid=health-group][data-grp=tickets]')).toContainText('No data: Zendesk connection off')
    await expect(page.getByTestId('health-unvalidated')).toHaveText('Not published: being validated')
    await spanish(page)

    // quien vende todavía no ve el número: está en validación
    const acc = await accountOf('marco.pena', 'active', 'store', 2)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${acc.id}/cuidado`)
    await expect(page.getByTestId('health-pending')).toContainText('está en validación')
    await expect(page.getByTestId('health-score')).toHaveCount(0)
    await page.goto('/cuidado?vista=salud')
    await expect(page.getByTestId('board-health-pending')).toBeVisible()
    await expect(page.getByTestId('health-row')).toHaveCount(0)
    expect(url).toContain('/cuidado')
    expect(errors).toEqual([])
  })
})

test.describe('CS-07 y CS-08 · expansión y comentarios de producto', () => {
  test('una regla de expansión abre oportunidades solo en comercios activos; quien vende la toma y la cierra, y registra un comentario con tema que Producto responde', async ({ page }) => {
    const errors = pageErrors(page)
    const product = `Remesas ${uniq()}`
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/admin/cuidado?mercado=MX')
    const rf = page.getByTestId('rule-form')
    await rf.getByTestId('rule-product').fill(product)
    await rf.getByTestId('rule-days').fill('14')
    await rf.getByTestId('rule-txn').fill('40')
    await rf.getByTestId('rule-tenure').fill('0')
    await rf.getByTestId('rule-save').click()
    await expect(rf.getByTestId('form-ok')).toContainText('Regla guardada')
    await expect(page.getByTestId('expansion-rule').filter({ hasText: product })).toContainText('14 días con venta o más')
    await page.getByTestId('run-expansion').click()
    await expect(page.getByTestId('admin-expansion').getByTestId('form-ok').last()).toContainText(/oportunidad(es)? nueva/)
    // ninguna oportunidad en un comercio que no vende
    const db = testDb()
    const bad = await db<{ n: number }[]>`select count(*)::int as n from crm.expansion_opportunities o join crm.accounts a on a.id = o.account_id where o.product_label = ${product} and a.lifecycle <> 'active'`
    const mine = await db<{ id: string; name: string }[]>`select a.id, a.name from crm.expansion_opportunities o join crm.accounts a on a.id = o.account_id
      where o.product_label = ${product} and o.status = 'open' and a.owner_id = md5('contigo:marco.pena')::uuid order by a.id limit 1`
    await db.end()
    expect(bad[0]!.n).toBe(0)
    expect(mine[0]).toBeTruthy()
    await page.goto('/cuidado?vista=expansion')
    await expect(page.getByTestId('expansion-col-open')).toContainText(product)
    await widths(page, 'mesa de trabajo, expansión')

    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${mine[0]!.id}/cuidado`)
    const opp = page.getByTestId('opportunity').filter({ hasText: product })
    await expect(opp).toContainText('Por tomar')
    await expect(opp).toContainText('días con venta y')
    await opp.getByTestId('opp-take').click()
    await expect(page.getByTestId('opportunity').filter({ hasText: product })).toHaveAttribute('data-status', 'working')
    await expect(page.getByTestId('opportunity').filter({ hasText: product })).toContainText('La lleva Marco Peña')
    await page.waitForTimeout(800) // el formulario ignora un segundo envío justo después de guardar
    await page.getByTestId('opportunity').filter({ hasText: product }).getByTestId('opp-won').click()
    await expect(page.getByTestId('opportunity').filter({ hasText: product })).toHaveAttribute('data-status', 'won')

    // comentario de producto: siempre con tema
    const note = `La app se cierra al cobrar un servicio ${uniq()}`
    const ff = page.getByTestId('feedback-form')
    await ff.getByTestId('feedback-topic').selectOption({ label: 'App o plataforma' })
    await ff.getByTestId('feedback-note').fill(note)
    await ff.getByTestId('feedback-save').click()
    await expect(page.getByTestId('feedback-item').filter({ hasText: note })).toContainText('App o plataforma')
    await expect(page.getByTestId('feedback-item').filter({ hasText: note })).toContainText('Nuevo')
    await widths(page, 'cuidado del comercio con comentarios')

    // quien lidera el mercado lo ve contado por tema y responde
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/cuidado?vista=comentarios')
    await expect(page.getByTestId('topic-row').filter({ hasText: 'App o plataforma' })).toBeVisible()
    const item = page.getByTestId('board-feedback-item').filter({ hasText: note })
    await item.getByTestId('feedback-status').selectOption('planned')
    await item.getByTestId('feedback-response').fill('Entra en la versión de diciembre')
    await item.getByTestId('feedback-answer').click()
    await expect(page.getByTestId('board-feedback-item').filter({ hasText: note })).toContainText('En plan')
    await widths(page, 'mesa de trabajo, comentarios')
    await english(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merchant care')
    await expect(page.getByTestId('board-feedback-item').filter({ hasText: note })).toContainText('Planned')
    await expect(page.getByTestId('topic-row').filter({ hasText: 'App or platform' })).toBeVisible()
    await spanish(page)
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${mine[0]!.id}/cuidado`)
    await expect(page.getByTestId('feedback-item').filter({ hasText: note })).toContainText('Respuesta de Producto: Entra en la versión de diciembre')
    expect(errors).toEqual([])
  })
})

test.describe('CS-05 · cuentas corporativas', () => {
  test('una cadena lleva plan de cuenta, relación por producto y revisión con minuta a partir del borrador con datos; una tienda no', async ({ page }) => {
    const errors = pageErrors(page)
    const chain = await accountOf('diana.cruz', 'active', 'chain').catch(() => accountOf('diana.cruz', 'onboarding', 'chain')).catch(() => accountOf('diana.cruz', 'prospect', 'chain'))
    await loginAs(page, 'diana.cruz')
    await page.goto(`/comercios/${chain.id}/cuidado`)
    const plan = page.getByTestId('care-plan')
    await expect(plan).toContainText('Plan de cuenta')
    await plan.getByTestId('plan-goals').fill('Llevar recargas a todas sus tiendas')
    await plan.getByTestId('plan-save').click()
    await expect(plan.getByTestId('plan-form').getByTestId('form-ok')).toContainText('Plan guardado')
    const rel = page.getByTestId('rel-form')
    await rel.getByTestId('rel-product').fill('Recargas')
    await rel.getByTestId('rel-health').selectOption('risk')
    await rel.getByTestId('rel-save').click()
    await expect(page.getByTestId('relationship').filter({ hasText: 'Recargas' })).toContainText('En riesgo')
    await expect(page.getByTestId('rel-rollup')).toContainText('En riesgo')
    // la minuta empieza con el borrador de datos; el borrador con IA está apagado y lo dice
    await page.reload()
    await expect(page.getByTestId('review-minutes')).toHaveValue(/Alertas abiertas: \d+\./)
    await expect(page.getByTestId('review-minutes')).toHaveValue(/Relación por producto: Recargas \(en riesgo\)\./)
    await expect(page.getByTestId('review-ai')).toContainText('Borrador con IA: apagado')
    await page.getByTestId('review-agreements').fill('Piloto en cinco tiendas')
    await page.getByTestId('review-save').click()
    await expect(page.getByTestId('review').first()).toContainText('a partir del borrador con datos')
    await expect(page.getByTestId('review').first()).toContainText('Acuerdos: Piloto en cinco tiendas')
    await page.reload()
    await expect(page.getByTestId('plan-next')).not.toHaveValue('')
    await widths(page, 'plan de cuenta')
    await english(page)
    await expect(page.getByTestId('care-plan')).toContainText('Account plan')
    await expect(page.getByTestId('review-ai')).toContainText('AI draft: off')
    await spanish(page)
    // una tienda no lleva plan de cuenta
    const store = await accountOf('marco.pena', 'at_risk')
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}/cuidado`)
    await expect(page.getByTestId('care-stage')).toBeVisible()
    await expect(page.getByTestId('care-plan')).toHaveCount(0)
    // el menú lleva a la mesa de trabajo
    await page.goto('/hoy')
    await page.getByTestId('me-menu').click()
    await page.getByTestId('nav-care').click()
    await expect(page).toHaveURL(/\/cuidado$/)
    expect(errors).toEqual([])
  })
})
