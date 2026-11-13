import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WIDTHS, loginAs, pageErrors, testDb } from './helpers'

// Paquete automatizaciones (programa "los 95"): AUT-03, AUT-01, PIPE-03, PIPE-02, LEAD-04 y el corredor de tareas.
// Recorre lo que una persona hace en pantalla: administración ve y cambia las automatizaciones, corre una tarea,
// configura un paso con evidencia y aprobación; quien vende lo pide, quien supervisa lo aprueba desde Hoy; y el
// escalamiento de un lead sin primer contacto llega a supervisión y se ve en la guardia.

const sql = testDb()
const started = new Date()
const tag = () => Math.random().toString(36).slice(2, 7)
const CARD = ['4111', '1111', '1111', '1111'].join(' ')
const uid = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
const setLocale = async (page: Page, locale: 'es' | 'en') => {
  await page.context().addCookies([{ name: 'contigo_locale', value: locale, url: page.url() }])
  await page.reload()
}

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const at = async (page: Page, name: 'desktop' | 'movil') => page.setViewportSize(WIDTHS.find((w) => w.name === name)!)

async function runJob(page: Page, key: string) {
  await page.goto('/admin/automatizaciones?v=tareas')
  await page.locator(`[data-testid="job-row"][data-key="${key}"]`).getByTestId('job-run-btn').click()
  await expect(page.getByTestId('admin-notice')).toContainText('Tarea corrida')
}

test.describe.configure({ mode: 'serial' })

test.describe('automatizaciones, pasos con aprobación, tareas programadas y escalamiento', () => {
  // Lo que este recorrido enciende se apaga al final, para que las pruebas que siguen encuentren la base como la esperan.
  test.afterAll(async () => {
    await sql`update crm.automations set is_active = false where created_by is not null`
    await sql`update crm.stage_transitions set is_active = false`
    await sql`update crm.lead_escalation set is_active = false`
    await sql`update crm.activities set done_at = now(), outcome = 'done' where done_at is null and (source = 'rule' or approval_id is not null) and created_at >= ${started}`
    await sql`update crm.leads set status = 'contacted', first_touch_at = now() where business_name like 'Zx escalado %'`
    await sql`update crm.leads set escalation_level = 0, escalated_at = null where escalation_level > 0`
    // Los avisos de escalamiento y de automatizaciones salen por el servicio de avisos: se dan por vistos para no cambiar el Hoy de las pruebas que siguen.
    await sql`update crm.notices set seen_at = now() where seen_at is null and kind in ('lead_escalated', 'automation') and created_at >= ${started}`
    await sql.end()
  })

  let autoUrl = ''

  test('Administración > Automatizaciones: las reglas de cada mercado, legibles, en dos idiomas y en dos anchos', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.getByTestId('pill-automatizaciones').click()
    await expect(page).toHaveURL(/\/admin\/automatizaciones$/)
    const mx = page.locator('[data-testid="auto-market"][data-market="MX"]')
    await expect(mx.getByTestId('auto-row')).toHaveCount(11) // embudo2: dos reglas de base más (ACT-02)
    await expect(page.locator('[data-testid="auto-market"][data-market="US"]').getByTestId('auto-row')).toHaveCount(11)
    const stalled = mx.locator('[data-testid="auto-row"][data-key="stalled_deal"]')
    await expect(stalled).toContainText('Negocio estancado')
    await expect(stalled).toContainText('Activa')
    await expect(mx.locator('[data-testid="auto-row"][data-key="stalled_ops"]')).toContainText('Negocio estancado en Operaciones')
    await clean(page, 'lista de automatizaciones, desktop')
    await at(page, 'movil')
    await clean(page, 'lista de automatizaciones, móvil')
    await at(page, 'desktop')

    await stalled.getByTestId('auto-open').click()
    await expect(page).toHaveURL(/\/admin\/automatizaciones\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('auto-when')).toContainText('revisión por horario')
    await expect(page.getByTestId('auto-if')).toContainText('Está estancado (pasó el umbral y no tiene próximo paso por venir)')
    await expect(page.getByTestId('auto-then')).toContainText('Abre un aviso en la cola de quien supervisa')
    await expect(page.getByTestId('auto-conditions').getByTestId('auto-condition')).toHaveCount(4)
    await clean(page, 'detalle de automatización, desktop')
    await at(page, 'movil')
    await clean(page, 'detalle de automatización, móvil')
    await at(page, 'desktop')

    await setLocale(page, 'en')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stalled deal')
    await expect(page.getByTestId('auto-then')).toContainText('Opens a notice in the supervisor queue')
    await expect(page.getByTestId('auto-if')).toContainText('It is stalled (past the limit and no upcoming next step)')
    await expect(page.getByTestId('auto-readable')).not.toContainText(/Cuando|Entonces|estancad|Activa/)
    await setLocale(page, 'es')
    expect(errors).toEqual([])
  })

  test('tareas programadas: correr ahora deja la corrida a la vista, y el disparo externo está apagado sin secreto', async ({ page, request }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones?v=tareas')
    await expect(page.getByTestId('jobs-cron')).toHaveAttribute('data-on', '0')
    await expect(page.getByTestId('jobs-cron')).toContainText('Apagado')
    for (const key of ['automatizaciones.reglas', 'automatizaciones.eventos', 'automatizaciones.escalamiento']) await expect(page.locator(`[data-testid="job-row"][data-key="${key}"]`)).toBeVisible()
    await runJob(page, 'automatizaciones.reglas')
    await expect(page.locator('[data-testid="job-row"][data-key="automatizaciones.reglas"]').getByTestId('job-last')).toContainText('Bien')
    await expect(page.getByTestId('job-run-row').filter({ hasText: 'a mano · Nora Salas' }).first()).toBeVisible()
    const res = await request.post('/api/cron/run')
    expect(res.status()).toBe(503)
    await clean(page, 'tareas programadas, desktop')
    await at(page, 'movil')
    await clean(page, 'tareas programadas, móvil')
    await at(page, 'desktop')
    // Estado de CONTIGO dice lo mismo: apagado, y qué falta para encenderlo.
    await page.goto('/estado')
    await expect(page.getByTestId('status-row-jobs')).toContainText('Apagado: falta el secreto')
    await expect(page.getByTestId('status-row-jobs')).toContainText('CRON_SECRET')
    // Quien lidera un mercado ve las automatizaciones de su mercado, sin botones para cambiarlas ni correr tareas.
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/admin/automatizaciones')
    await expect(page.locator('[data-testid="auto-market"][data-market="MX"]')).toBeVisible()
    await expect(page.locator('[data-testid="auto-market"][data-market="US"]')).toHaveCount(0)
    await expect(page.getByTestId('auto-new')).toHaveCount(0)
    await expect(page.getByTestId('auto-toggle-btn')).toHaveCount(0)
    await expect(page.getByTestId('pill-tareas')).toHaveCount(0)
    // Quien vende no entra.
    await loginAs(page, 'lucia.vega')
    const denied = await page.goto('/admin/automatizaciones')
    expect(denied?.status()).toBe(404)
  })

  test('crear desde una plantilla, editar con formularios, probar contra un registro, activar y ver su bitácora', async ({ page }) => {
    const errors = pageErrors(page)
    const deal = (await sql<{ id: string; title: string; owner_id: string }[]>`
      select d.id, d.title, d.owner_id from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id
       where d.market_code = 'MX' and p.motor = 'd2d' and d.status = 'open' and d.paused_at is null and s.kind = 'open' and s.rot_days > 0
         and d.stage_entered_at < now() - make_interval(days => s.rot_days) order by d.id limit 1`)[0]!
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones')
    await page.getByTestId('auto-new-market').selectOption('MX')
    await page.getByTestId('auto-new-template').selectOption('stalled_task')
    await page.getByTestId('auto-new-create').click()
    await expect(page).toHaveURL(/\/admin\/automatizaciones\/[0-9a-f-]{36}\?nueva=1$/)
    autoUrl = page.url().replace('?nueva=1', '')
    await expect(page.getByTestId('auto-created')).toContainText('en pausa')
    await expect(page.getByTestId('auto-readable')).toContainText('En pausa')
    await expect(page.getByTestId('auto-log-empty')).toBeVisible()

    // Editar: nombre, dueño, una condición más y el plazo de la tarea. Sin dibujar flujos: listas y campos.
    await page.getByTestId('auto-name-es').fill('Estancado: tarea para quien lo lleva')
    await page.getByTestId('auto-name-en').fill('Stalled: task for the owner')
    await page.getByTestId('auto-owner').selectOption({ label: 'Nora Salas' })
    await page.getByTestId('cond-add').click()
    const added = page.getByTestId('auto-condition').last()
    await added.getByTestId('cond-field').selectOption('is_ops_stage')
    await added.getByTestId('cond-op').selectOption('is_false')
    await page.getByTestId('act-days').fill('0')
    await page.getByTestId('act-es').fill('Mover o cerrar hoy: lleva demasiado en la misma etapa')
    await page.getByTestId('act-en').fill('Move or close today: too long in the same stage')
    await page.getByTestId('auto-save').click()
    await expect(page.getByTestId('auto-form').getByTestId('form-ok')).toContainText('Automatización guardada')
    await page.goto(autoUrl)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estancado: tarea para quien lo lleva')
    await expect(page.locator('main')).toContainText('versión 2')
    await expect(page.getByTestId('auto-meta')).toContainText('Responde por ella: Nora Salas')
    await expect(page.getByTestId('auto-if')).toContainText('No: está en una etapa de operaciones')
    await expect(page.getByTestId('auto-then')).toContainText('con fecha de hoy')

    // Un texto con un número de tarjeta no se guarda: la misma regla que en cualquier nota.
    await page.getByTestId('act-es').fill(`Cobrar a la tarjeta ${CARD}`)
    await page.getByTestId('auto-save').click()
    await expect(page.getByTestId('auto-form').getByTestId('form-error')).toContainText('número de tarjeta')
    await page.goto(autoUrl)

    // Probar contra un registro: qué haría, condición por condición, sin cambiar nada.
    await page.getByTestId('auto-test-record').fill(`https://contigo.example/deals/${deal.id}`)
    await page.getByTestId('auto-test-run').click()
    const result = page.getByTestId('auto-test-result')
    await expect(result).toHaveAttribute('data-would', '1')
    await expect(result).toContainText(deal.title)
    await expect(result).toContainText('Con este registro, sí actuaría.')
    await expect(result.locator('li[data-met="1"]')).toHaveCount(3)
    const before = (await sql<{ n: number }[]>`select count(*)::int as n from crm.activities where source = 'rule' and deal_id = ${deal.id}`)[0]!.n
    expect(before).toBe(0)

    await page.getByTestId('auto-readable').getByTestId('auto-toggle-btn').click()
    await expect(page.getByTestId('auto-readable').getByTestId('form-ok')).toContainText('Automatización activa')
    await runJob(page, 'automatizaciones.reglas')
    await page.goto(autoUrl)
    const row = page.getByTestId('auto-log-row').filter({ hasText: deal.title }).first()
    await expect(row).toContainText('Creó 1 tarea')
    await expect(row).toHaveAttribute('data-outcome', 'done')
    const task = (await sql<{ owner_id: string; subject: string }[]>`select owner_id, subject from crm.activities where source = 'rule' and deal_id = ${deal.id} and done_at is null`)[0]!
    expect(task.owner_id).toBe(deal.owner_id)
    expect(task.subject).toContain('Mover o cerrar hoy')
    await clean(page, 'detalle con bitácora, desktop')
    await at(page, 'movil')
    await clean(page, 'detalle con bitácora, móvil')
    await at(page, 'desktop')

    // Pausar desde la lista: deja de correr y lo dice.
    await page.goto('/admin/automatizaciones')
    const mine = page.getByTestId('auto-row').filter({ hasText: 'Estancado: tarea para quien lo lleva' })
    await mine.getByTestId('auto-toggle-btn').click()
    await expect(page.getByTestId('admin-notice')).toContainText('en pausa')
    await expect(mine).toHaveAttribute('data-active', '0')
    expect(errors).toEqual([])
  })

  test('un paso con evidencia y aprobación: quien lo pide ve a quién espera, quien aprueba lo recibe en Hoy y al aprobar se mueve', async ({ page }) => {
    const errors = pageErrors(page)
    // Administración configura el paso de Calificación a Propuesta en el embudo de cadenas de México.
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones?v=pasos')
    const pipe = page.locator('[data-testid="steps-pipeline"][data-pipeline="Cadenas y distribuidores"]').first()
    await expect(pipe.getByTestId('steps-empty')).toBeVisible()
    await pipe.getByTestId('step-add').click()
    const form = pipe.getByTestId('step-form').first()
    await form.getByTestId('step-from').selectOption({ label: 'Calificación' })
    await form.getByTestId('step-to').selectOption({ label: 'Propuesta' })
    await form.getByTestId('step-evidence').check()
    await form.getByTestId('step-evidence-es').fill('Propuesta firmada')
    await form.getByTestId('step-evidence-en').fill('Signed proposal')
    await form.getByTestId('step-approval').check()
    await form.getByTestId('step-approver').selectOption('role:supervisor')
    await form.getByTestId('step-hours').fill('8')
    await form.getByTestId('step-save').click()
    await expect(page.getByTestId('admin-notice')).toContainText('Paso guardado')
    const step = pipe.getByTestId('step-row')
    await expect(step).toHaveCount(1)
    await expect(step).toContainText('Calificación → Propuesta')
    await expect(step.getByTestId('step-needs')).toContainText('Evidencia: Propuesta firmada')
    await expect(step.getByTestId('step-needs')).toContainText('Aprueba Supervisión en 8 h hábiles')
    // La meta de tiempo de la etapa, con su reloj en la ficha.
    const times = pipe.getByTestId('stage-times-row').filter({ hasText: 'Calificación' })
    await times.getByTestId('stage-sla').fill('16')
    await times.getByTestId('stage-times-save').click()
    await expect(page.getByTestId('admin-notice')).toContainText('Tiempos de la etapa guardados')
    await clean(page, 'pasos de etapa, desktop')
    await at(page, 'movil')
    await clean(page, 'pasos de etapa, móvil')
    await at(page, 'desktop')

    // Un negocio de Diana (ventas, cadenas) en Calificación, con monto y próximo paso.
    const diana = await uid('diana.cruz')
    const title = `Zx Cadena ${tag()}`
    const acc = (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, owner_id, country, created_by)
      values ('MX', 'chain', ${title}, 'b2b', ${diana}, 'MX', ${diana}) returning id`)[0]!.id
    const dealId = (await sql<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, next_step, next_step_due, created_by)
      select 'MX', p.id, s.id, ${acc}, ${diana}, ${title}, 50000000, 'MXN', 'Enviar propuesta', (now() at time zone 'America/Mexico_City')::date + 1, ${diana}
        from crm.pipelines p join crm.stages s on s.pipeline_id = p.id where p.id = md5('contigo:p-mx-b2b')::uuid and s.code = 'calificacion' returning id`)[0]!.id

    await loginAs(page, 'diana.cruz')
    await page.goto(`/deals/${dealId}`)
    const card = page.getByTestId('deal-steps')
    await expect(card.getByTestId('step-need')).toContainText('falta la evidencia (Propuesta firmada)')
    await expect(card.getByTestId('step-need')).toContainText('pide aprobación al moverlo')
    await expect(card.getByTestId('stage-goal')).toContainText('16 horas hábiles en la etapa')
    await page.getByTestId('deal-advance').click()
    await expect(page.getByTestId('deal-move').getByTestId('form-error')).toContainText('falta la evidencia: Propuesta firmada')
    await card.getByTestId('evidence-add').click()
    await page.getByTestId('evidence-url').fill('https://docs.example.com/propuesta-firmada')
    await page.getByTestId('evidence-note').fill('Propuesta firmada por el cliente')
    await page.getByTestId('evidence-save').click()
    await expect(card.getByTestId('evidence-row')).toContainText('Propuesta firmada por el cliente')
    await expect(card.getByTestId('step-need')).toContainText('evidencia ya agregada')
    await page.getByTestId('deal-advance').click()
    await expect(page.getByTestId('deal-move').getByTestId('form-ok')).toContainText('Queda esperando la aprobación de Supervisión')
    await expect(card.getByTestId('approval-waiting')).toHaveText('Esperando aprobación de Supervisión')
    await expect(card.getByTestId('approval-pending')).toHaveAttribute('data-mine', '1')
    await expect(card.getByTestId('approval-approve-btn')).toHaveCount(0) // quien lo pide no lo aprueba
    await clean(page, 'ficha con aprobación pendiente, desktop')
    await at(page, 'movil')
    await clean(page, 'ficha con aprobación pendiente, móvil')
    await at(page, 'desktop')

    // A quien supervisa su equipo le llega a Hoy; desde el negocio lo aprueba de un toque.
    await loginAs(page, 'paula.mendez')
    // La tarea llega a Hoy: arriba, como lo siguiente por hacer, o en la lista de hoy.
    await expect(page.getByTestId('queue')).toContainText(`Aprobar: ${title} pasa a "Propuesta"`)
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByTestId('approval-waiting')).toContainText('Esperando aprobación de Supervisión')
    await page.getByTestId('approval-approve-btn').click()
    await expect(page.getByTestId('approval-last')).toContainText('aprobó el paso a "Propuesta"')
    await expect(page.getByTestId('approval-pending')).toHaveCount(0)
    const moved = (await sql<{ code: string; actor: string }[]>`
      select s.code, (select e.actor_id from crm.deal_stage_events e where e.deal_id = d.id order by e.at desc, e.id desc limit 1) as actor
        from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${dealId}`)[0]!
    expect(moved).toEqual({ code: 'propuesta', actor: diana })
    await page.goto('/hoy')
    await expect(page.getByTestId('queue')).not.toContainText(`Aprobar: ${title}`)

    // Quien lo pidió se entera en Hoy. En inglés, la ficha dice lo mismo.
    await loginAs(page, 'diana.cruz')
    await expect(page.getByTestId('hoy-notices')).toContainText(`lo aprobó: ${title} pasó a "Propuesta".`)
    await page.goto(`/deals/${dealId}`)
    await setLocale(page, 'en')
    await expect(page.getByTestId('deal-steps')).toContainText('Evidence and approvals')
    await expect(page.getByTestId('approval-last')).toContainText('approved the step to "Proposal"')
    await expect(page.getByTestId('waiting-on')).toContainText('Who it is waiting on')
    await setLocale(page, 'es')
    // A quién se espera: separa lo que espera a un tercero de lo que está detenido por el equipo.
    await page.getByTestId('waiting-select').selectOption('third_party')
    await page.getByTestId('waiting-save').click()
    await expect(page.getByTestId('waiting-form').getByTestId('form-ok')).toBeVisible()
    expect((await sql<{ waiting_on: string }[]>`select waiting_on from crm.deals where id = ${dealId}`)[0]!.waiting_on).toBe('third_party')
    expect(errors).toEqual([])
  })

  test('escalamiento del primer contacto: se enciende por mercado, avisa a supervisión y se ve en la guardia de leads', async ({ page }) => {
    const errors = pageErrors(page)
    const lucia = await uid('lucia.vega')
    const name = `Zx escalado ${tag()}`
    await sql`insert into crm.leads (market_code, source, motor, business_name, contact_name, status, owner_id, assigned_at, sla_due_at)
              values ('MX', 'manual', 'd2d', ${name}, 'Rita Luna', 'new', ${lucia}, now() - interval '6 days', now() - interval '6 days')`
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones?v=leads')
    const mx = page.locator('[data-testid="escalation-row"][data-market="MX"]')
    await expect(mx.getByTestId('escalation-active')).not.toBeChecked() // nace apagado
    await mx.getByTestId('escalation-active').check()
    await mx.getByTestId('escalation-hours').fill('4')
    await mx.getByTestId('escalation-save').click()
    await expect(page.getByTestId('admin-notice')).toContainText('Escalamiento encendido')
    await clean(page, 'escalamiento de leads, desktop')
    await at(page, 'movil')
    await clean(page, 'escalamiento de leads, móvil')
    await at(page, 'desktop')
    await runJob(page, 'automatizaciones.escalamiento')

    // Fernando supervisa el equipo de Lucía: el aviso le llega a Hoy (por el servicio de avisos) y la guardia dice que ya se le avisó.
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/hoy')
    const notice = page.getByTestId('hoy-notice').filter({ hasText: `Lead sin primer contacto: ${name}` })
    await expect(notice).toContainText('Lo lleva Lucía Vega.')
    await expect(notice.getByTestId('hoy-notice-open')).toHaveAttribute('href', /^\/leads\//)
    await page.goto('/supervisor')
    const row = page.getByTestId('watch-row').filter({ hasText: name })
    await expect(row.getByTestId('watch-escalated')).toHaveText('Avisado a supervisión')
    await expect(row.getByTestId('watch-escalated')).toHaveAttribute('data-level', '1')
    await clean(page, 'guardia de leads con escalamiento, desktop')
    await setLocale(page, 'en')
    await expect(page.getByTestId('watch-row').filter({ hasText: name }).getByTestId('watch-escalated')).toHaveText('Supervisor notified')
    await setLocale(page, 'es')

    // Apagarlo también queda a un clic, y en la bitácora.
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/automatizaciones?v=leads')
    await page.locator('[data-testid="escalation-row"][data-market="MX"]').getByTestId('escalation-active').uncheck()
    await page.locator('[data-testid="escalation-row"][data-market="MX"]').getByTestId('escalation-save').click()
    await expect(page.getByTestId('admin-notice')).toContainText('Escalamiento apagado')
    await page.goto('/admin?tab=auditoria')
    await expect(page.locator('main')).toContainText('Cambió el escalamiento del primer contacto de un mercado')
    expect(errors).toEqual([])
  })
})
