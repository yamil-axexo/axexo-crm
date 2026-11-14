import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Paquete "campo": trabajo en la calle. Registrar una visita, empezar por la actividad, la hoja de completar pensada
// para la calle, llamar y volver, la ficha con dirección y mensaje de texto, y confirmaciones antes de mover trabajo ajeno.
const SHOTS = process.env.E2E_SHOTS
const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
const uniq = () => Math.random().toString(36).slice(2, 8)
const letters = () => uniq().replace(/\d/g, 'x')

type Store = { id: string; name: string; phone: string | null; deal_id: string | null }
const used: string[] = []
/**
 * Un comercio de una persona, con teléfono, de nombre único, sin visitas recientes, y con o sin un único negocio abierto.
 * Cada prueba toma uno distinto.
 */
async function storeOf(person: string, withDeal = false): Promise<Store> {
  const sql = testDb()
  const rows = await sql<Store[]>`
    select a.id, a.name, a.phone, (select d.id from crm.deals d where d.account_id = a.id and d.status = 'open' limit 1) as deal_id
      from crm.accounts a join crm.users u on u.id = a.owner_id
     where u.full_name = ${person} and a.archived_at is null and a.kind = 'store' and a.phone is not null
       and (select count(*) from crm.deals d join crm.stages s on s.id = d.stage_id where d.account_id = a.id and d.status = 'open' and s.kind = 'open') = ${withDeal ? 1 : 0}
       and (select count(*) from crm.deals d where d.account_id = a.id and d.status = 'open') = ${withDeal ? 1 : 0}
       and not exists (select 1 from crm.visits v where v.account_id = a.id and v.business_date > now()::date - 12)
       and not exists (select 1 from crm.activities x where x.account_id = a.id and x.kind = 'visit')
       and (select count(*) from crm.accounts o where o.name = a.name) = 1
       and not (a.id = any(${used}::uuid[]))
     order by a.id limit 1`
  await sql.end()
  if (!rows[0]) throw new Error(`no hay comercio de prueba para ${person}`)
  used.push(rows[0].id)
  return rows[0]
}
const visitsOf = async (page: Page, rep: string) => {
  const cell = (await page.getByTestId('rep-row').filter({ hasText: rep }).getByTestId('rep-visits').innerText()).trim()
  const [, visits, sales] = /^(\d+) \/ (\d+)/.exec(cell)!
  return { visits: Number(visits), sales: Number(sales) }
}
/** Lo que hace el teléfono al llamar: la app pasa a segundo plano y vuelve. El enlace tel: no navega en la prueba. */
async function callAndComeBack(page: Page, trigger: string) {
  const dialed = page.evaluate(() => new Promise<string>((resolve) => document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[href^="tel:"]') as HTMLAnchorElement | null
    if (a) { e.preventDefault(); resolve(a.href) }
  }, true)))
  await page.getByTestId(trigger).click()
  const href = await dialed
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  return href
}
const openLog = async (page: Page) => {
  await page.getByTestId('dock-create').click()
  await page.getByTestId('dock-create-menu').getByRole('menuitem', { name: 'Registrar actividad' }).click()
  const sheet = page.locator('[data-testid="log-sheet"][open]')
  await expect(sheet).toBeVisible()
  return sheet
}

for (const w of WIDTHS) {
  test.describe(`Trabajo de campo en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('registrar una visita desde el dock, verla en el hilo del comercio y en Mi equipo', async ({ page }) => {
      const errors = pageErrors(page)
      const store = await storeOf('Marco Peña', true)
      const visitor = `Vendedora ${letters()}`
      await loginAs(page, 'fernando.ibarra')
      await page.goto('/supervisor')
      const before = await visitsOf(page, 'Marco Peña')

      await loginAs(page, 'marco.pena')
      const sheet = await openLog(page)
      await expect(sheet.getByTestId('log-title')).toHaveText('Registrar actividad')
      // sin elegir comercio no guarda, y lo dice
      await sheet.getByTestId('log-save').click()
      await expect(sheet.getByTestId('log-error')).toHaveText('Elige el comercio para poder guardar.')
      // el comercio se busca ahí mismo, por nombre
      await sheet.getByTestId('log-search').fill(store.name.slice(0, -1))
      await sheet.getByTestId('log-result').filter({ hasText: store.name }).first().click()
      await expect(sheet.getByTestId('log-merchant')).toContainText(store.name)
      await sheet.getByTestId('log-save').click()
      await expect(sheet.getByTestId('log-error')).toHaveText('Elige cómo te fue para poder guardar.')
      // hay que volver con quien decide: "Visitar" queda elegido como lo que sigue
      await sheet.getByText('Volver con quien decide', { exact: true }).click()
      await expect(sheet.getByTestId('choices-next').getByRole('radio', { name: 'Visitar' })).toBeChecked()
      await sheet.getByTestId('sheet-visitor').fill(visitor)
      await sheet.getByTestId('log-note').fill('No estaba la dueña')
      await axe(page, `registrar visita ${w.name}`)
      await noSideScroll(page)
      // Guardar está a la vista sin desplazar la hoja, y lo que se toca mide al menos 44 px
      const save = await sheet.getByTestId('log-save').boundingBox()
      expect(save!.y + save!.height).toBeLessThanOrEqual(w.height)
      for (const box of await sheet.locator('label.choice, [data-testid="log-save"], [data-testid="log-change"], input.input').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(w.name === 'movil' ? 44 : 40)
      }
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-registrar-visita.png` })
      await sheet.getByTestId('log-save').click()
      await expect(page.getByTestId('toast')).toContainText(`Visita guardada en ${store.name}. Próximo paso: Visitar a ${store.name}`)
      await expect(sheet).toBeHidden()

      // en el hilo: la visita con su resultado, su origen y quién visitó; arriba, la visita por hacer
      await page.goto(`/comercios/${store.id}`)
      const visit = page.getByTestId('tl-visit').first()
      await expect(visit).toHaveAttribute('data-origin', 'manual')
      await expect(visit).toContainText(/^Hoy, .+ · Registrada en CONTIGO · Marco Peña/)
      await expect(visit).toContainText('Visita · Volver con quien decide')
      await expect(visit).toContainText(`Visitó: ${visitor}`)
      await expect(visit).toContainText('No estaba la dueña')
      await expect(page.getByTestId('thread-next').filter({ hasText: `Visitar a ${store.name}` })).toBeVisible()
      await noSideScroll(page)
      await axe(page, `hilo con visita ${w.name}`)
      // el negocio del comercio quedó con la revisita y con ese próximo paso
      await page.getByTestId('deal-link').click()
      await expect(page.getByTestId('revisit-banner')).toContainText('La última visita no encontró a quien decide.')
      await expect(page.getByTestId('deal-timeline')).toContainText('Volver con quien decide')

      // y cuenta en Mi equipo, para quien lleva el comercio
      await loginAs(page, 'fernando.ibarra')
      await page.goto('/supervisor')
      expect(await visitsOf(page, 'Marco Peña')).toEqual({ visits: before.visits + 1, sales: before.sales })
      await expect(page.getByTestId('team-board')).toContainText('las registradas en CONTIGO y las que lleguen de la Sales App')
      expect(errors).toEqual([])
    })

    test('la ficha: visita en dos toques, mensaje de texto, dirección con "Cómo llegar" y la llamada que pregunta cómo te fue', async ({ page }) => {
      const store = await storeOf('Marco Peña')
      const sql = testDb()
      await sql`update crm.accounts set address_line = 'Av. de Prueba 120, Col. Centro', postal_code = '06000' where id = ${store.id}`
      await sql.end()
      await loginAs(page, 'marco.pena')
      await page.goto(`/comercios/${store.id}`)
      const ficha = page.getByTestId('ficha')

      // dirección visible y cómo llegar: un enlace a mapas con la dirección, sin llaves ni API
      await expect(ficha.getByTestId('ficha-address')).toContainText('Av. de Prueba 120, Col. Centro')
      const directions = ficha.getByTestId('ficha-directions')
      await expect(directions).toHaveText('Cómo llegar')
      const href = new URL((await directions.getAttribute('href'))!)
      expect(href.origin + href.pathname).toBe('https://www.google.com/maps/dir/')
      expect(href.searchParams.get('destination')).toContain('Av. de Prueba 120, Col. Centro')
      expect([...href.searchParams.keys()].sort()).toEqual(['api', 'destination'])
      // llamar, WhatsApp y mensaje de texto al mismo teléfono
      await expect(ficha.getByTestId('action-call')).toHaveAttribute('href', `tel:${store.phone}`)
      await expect(ficha.getByTestId('action-sms')).toHaveAttribute('href', `sms:${store.phone}`)
      await expect(ficha.getByTestId('action-sms')).toHaveAccessibleName('Mensaje de texto')
      for (const h of await ficha.getByTestId('ficha-actions').locator(':scope > a, :scope > button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44)

      // visita desde la ficha: el comercio ya está elegido
      await ficha.getByTestId('action-visit').click()
      const sheet = page.locator('[data-testid="log-sheet"][open]')
      await expect(sheet.getByTestId('log-title')).toHaveText(store.name)
      await expect(sheet.getByTestId('log-search')).toHaveCount(0)
      await sheet.getByText('Hubo venta o alta', { exact: true }).click()
      await sheet.getByText('Ayer', { exact: true }).click()
      await sheet.getByText('Nada más: cerrar', { exact: true }).click()
      await sheet.getByTestId('log-save').click()
      await expect(page.getByTestId('toast')).toHaveText(`Visita guardada en ${store.name}.`)
      const visit = ficha.getByTestId('tl-visit').first()
      await expect(visit).toContainText('Visita · Hubo venta o alta')
      await expect(visit).not.toContainText(/^Hoy/) // fue ayer: el hilo la fecha con el día de la visita

      // llamar desde la ficha: al volver pregunta cómo te fue, y la llamada queda en el hilo con su resultado
      expect(await callAndComeBack(page, 'action-call')).toBe(`tel:${store.phone}`)
      await expect(sheet.getByTestId('log-title')).toHaveText(`¿Cómo te fue con ${store.name}?`)
      await expect(sheet.getByTestId('choices-kind_choice')).toHaveCount(0)
      await sheet.getByText('No contestó', { exact: true }).click()
      await sheet.getByText('Llamar', { exact: true }).click()
      await sheet.getByTestId('log-save').click()
      await expect(page.getByTestId('toast')).toContainText(`Llamada guardada en ${store.name}. Próximo paso: Llamar a ${store.name}`)
      const call = ficha.getByTestId('tl-call').first()
      await expect(call).toContainText(/^Hoy, .+ · Marco Peña · Llamada · No contestó/)
      await expect(ficha.getByTestId('thread-next').filter({ hasText: `Llamar a ${store.name}` })).toBeVisible()
      await noSideScroll(page)
      await axe(page, `ficha de campo ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-ficha-campo.png` })
    })
  })
}

test.describe('Trabajo de campo en teléfono: reglas de la hoja y del hilo', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('una visita por hacer se completa con el resultado de la visita; sugiere quién visitó; "Otra tarea" deja escribir y la nota queda en el hilo', async ({ page }) => {
    const store = await storeOf('Lucía Vega')
    const visitor = `Tomasa ${letters()}`
    const todo = `Capacitar al encargado ${uniq()}`
    // un nombre ya usado en el mercado por otra persona del equipo
    const other = await storeOf('Marco Peña')
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${other.id}`)
    await page.getByTestId('action-visit').click()
    let sheet = page.locator('[data-testid="log-sheet"][open]')
    await sheet.getByText('No hubo venta', { exact: true }).click()
    // ola 4: una visita sin venta pide el motivo, con los motivos de calle del mercado
    await expect(sheet.getByTestId('sheet-no-sale-reason').locator('option')).not.toHaveCount(1)
    await sheet.getByTestId('sheet-no-sale-reason').selectOption({ index: 1 })
    await sheet.getByTestId('sheet-visitor').fill(visitor)
    await sheet.getByText('Nada más: cerrar', { exact: true }).click()
    await sheet.getByTestId('log-save').click()
    await expect(page.getByTestId('toast')).toContainText('Visita guardada')

    await loginAs(page, 'lucia.vega')
    await page.goto(`/comercios/${store.id}`)
    const ficha = page.getByTestId('ficha')
    // la visita por hacer se agenda desde Actividad
    await ficha.getByTestId('action-activity').click()
    const purpose = `Visitar para entregar material ${uniq()}`
    await page.getByTestId('activity-kind').selectOption('visit')
    await page.getByTestId('activity-subject').fill(purpose)
    await page.getByTestId('activity-add').click()
    await expect(page.getByTestId('form-error')).toContainText('Una visita por hacer necesita fecha')
    await page.getByTestId('activity-due').fill(new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }))
    await page.getByTestId('activity-add').click()
    const next = ficha.getByTestId('thread-next').filter({ hasText: purpose })
    await expect(next).toContainText(/Próximo · para el/)

    await next.getByTestId('row-complete').click()
    sheet = page.locator('[data-testid="complete-sheet"][open]')
    await expect(sheet.getByTestId('choices-result').locator('label')).toHaveText(['Hubo venta o alta', 'No hubo venta', 'Volver con quien decide'])
    // sin elegir cómo terminó, no guarda
    await sheet.getByText('Nada más: cerrar', { exact: true }).click()
    await sheet.getByTestId('sheet-save').click()
    await expect(sheet.getByTestId('sheet-error')).toHaveText('Elige cómo te fue.')
    await sheet.getByText('Hubo venta o alta', { exact: true }).click()
    // quién visitó: sugiere el nombre que ya usó otra persona del mercado
    await expect(sheet.locator('[data-testid="visitor-names"] option[value="' + visitor + '"]')).toHaveCount(1)
    await sheet.getByTestId('sheet-visitor').fill(visitor)
    await sheet.getByTestId('sheet-note').fill('Activó dos servicios')
    // "Otra tarea" deja escribir cuál
    await expect(sheet.getByTestId('sheet-next-text')).toHaveCount(0)
    await sheet.getByText('Otra tarea', { exact: true }).click()
    await sheet.getByTestId('sheet-next-text').fill(todo)
    await axe(page, 'completar una visita en teléfono')
    await noSideScroll(page)
    await sheet.getByTestId('sheet-save').click()
    await expect(page.getByTestId('toast')).toContainText(`Hecho. Próximo paso: ${todo}`)

    const visit = ficha.getByTestId('tl-visit').first()
    await expect(visit).toHaveAttribute('data-origin', 'manual')
    await expect(visit).toContainText('Visita · Hubo venta o alta')
    await expect(visit).toContainText(`Visitó: ${visitor}`)
    await expect(visit).toContainText('Activó dos servicios')
    await expect(ficha.getByTestId('thread-next').filter({ hasText: todo })).toBeVisible()
    await expect(ficha.getByTestId('thread-next').filter({ hasText: purpose })).toHaveCount(0)
  })

  test('una tarea completada aparece en el hilo con el día en que se completó, no con el día en que se creó', async ({ page }) => {
    const store = await storeOf('Marco Peña')
    const subject = `Llamar para confirmar documentos ${uniq()}`
    const sql = testDb()
    await sql`insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by, created_at)
              select a.market_code, a.id, 'task', ${subject}, now() - interval '1 day', a.owner_id, a.owner_id, now() - interval '4 days' from crm.accounts a where a.id = ${store.id}`
    await sql.end()
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${store.id}`)
    const ficha = page.getByTestId('ficha')
    await ficha.getByTestId('thread-next').filter({ hasText: subject }).getByTestId('row-complete').click()
    const sheet = page.locator('[data-testid="complete-sheet"][open]')
    await sheet.getByText('Contactado', { exact: true }).click()
    await sheet.getByText('Nada más: cerrar', { exact: true }).click()
    await sheet.getByTestId('sheet-save').click()
    await expect(page.getByTestId('toast')).toHaveText('Hecho. Sin próximo paso.')
    const done = ficha.getByTestId('tl-task').filter({ hasText: subject })
    await expect(done).toContainText(/^Hoy, .+ · Marco Peña · Tarea · Contactado/)
    // y es lo primero del hilo: lo más reciente es lo que se acaba de hacer
    await expect(ficha.getByTestId('account-timeline').locator('ol.thread').last().locator('> li').first()).toContainText(subject)
  })

  test('desde el dock también se registra una llamada o una nota, y el comercio se encuentra por teléfono', async ({ page }) => {
    const store = await storeOf('Marco Peña')
    const note = `Pidió material nuevo ${uniq()}`
    await loginAs(page, 'marco.pena')
    await page.goto('/pipelines')
    let sheet = await openLog(page)
    // los últimos cuatro dígitos bastan
    await sheet.getByTestId('log-search').fill(store.phone!.slice(-4))
    await sheet.getByTestId('log-result').filter({ hasText: store.name }).first().click()
    // cambiar de comercio vuelve a la búsqueda
    await sheet.getByTestId('log-change').click()
    await expect(sheet.getByTestId('log-search')).toBeFocused()
    await sheet.getByTestId('log-search').fill('zzzz no existe')
    await expect(sheet.getByTestId('log-empty')).toHaveText('No aparece entre tus comercios. Prueba con menos letras o con el teléfono.')
    await sheet.getByTestId('log-search').fill(store.name)
    await sheet.getByTestId('log-result').filter({ hasText: store.name }).first().click()
    // nota: una sola pregunta, sin próximo paso
    await sheet.getByText('Nota', { exact: true }).click()
    await expect(sheet.getByTestId('choices-next')).toHaveCount(0)
    await sheet.getByTestId('log-subject').fill(note)
    await sheet.getByTestId('log-save').click()
    await expect(page.getByTestId('toast')).toHaveText(`Nota guardada en ${store.name}.`)
    await expect(page).toHaveURL(/\/pipelines/) // la persona sigue donde estaba

    // la siguiente vez, sin escribir, la hoja ofrece ese comercio entre los últimos
    sheet = await openLog(page)
    await expect(sheet.getByText('Tus últimos comercios')).toBeVisible()
    await sheet.getByTestId('log-result').filter({ hasText: store.name }).first().click()
    await sheet.getByText('Llamada', { exact: true }).click()
    await sheet.getByText('Contactado', { exact: true }).click()
    await sheet.getByTestId('log-save').click()
    await expect(sheet.getByTestId('log-error')).toHaveText('Elige qué sigue para poder guardar.')
    await sheet.getByText('Nada más: cerrar', { exact: true }).click()
    await sheet.getByTestId('log-save').click()
    await expect(page.getByTestId('toast')).toHaveText(`Llamada guardada en ${store.name}.`)
    await page.goto(`/comercios/${store.id}`)
    await expect(page.getByTestId('tl-call').first()).toContainText('Llamada · Contactado')
    await expect(page.getByTestId('tl-note').first()).toContainText(note)
    await expect(page.getByTestId('tl-note').first()).toContainText('· Marco Peña · Nota')
  })

  test('llamar desde el detalle del negocio pregunta cómo te fue y la llamada queda en el negocio', async ({ page }) => {
    const store = await storeOf('Marco Peña', true)
    await loginAs(page, 'marco.pena')
    await page.goto(`/deals/${store.deal_id}`)
    expect(await callAndComeBack(page, 'deal-call')).toBe(`tel:${store.phone}`)
    const sheet = page.locator('[data-testid="log-sheet"][open]')
    await expect(sheet.getByTestId('log-title')).toHaveText(`¿Cómo te fue con ${store.name}?`)
    await sheet.getByText('Contactado', { exact: true }).click()
    await sheet.getByTestId('log-note').fill('Confirma los documentos el viernes')
    await sheet.getByText('Visitar', { exact: true }).click()
    await sheet.getByTestId('log-save').click()
    await expect(page.getByTestId('toast')).toContainText(`Llamada guardada en ${store.name}. Próximo paso: Visitar a ${store.name}`)
    const timeline = page.getByTestId('deal-timeline')
    await expect(timeline.locator('li').filter({ hasText: `Llamada a ${store.name}` })).toContainText('Llamada · Contactado')
    await expect(timeline.locator('li').filter({ hasText: `Visitar a ${store.name}` })).toContainText('por hacer el')
    // el negocio quedó con ese próximo paso
    await expect(page.getByTestId('next-step')).toHaveValue(`Visitar a ${store.name}`)
  })

  test('quien no registra actividades no ve "Registrar actividad" ni los botones de la ficha', async ({ page }) => {
    await loginAs(page, 'luis.tovar')
    await expect(page.getByTestId('dock-create')).toHaveCount(0)
    await expect(page.getByTestId('log-sheet')).toHaveCount(0)
    const store = await storeOf('Marco Peña')
    await page.goto(`/comercios/${store.id}`)
    await expect(page.getByTestId('action-call')).toHaveAttribute('href', `tel:${store.phone}`)
    await expect(page.getByTestId('action-visit')).toHaveCount(0)
  })
})

test.describe('Trabajo de campo: confirmar antes de mover el trabajo de otra persona', () => {
  test('reasignar un comercio pide confirmación, dice qué se va con él y avisa lo que pasó', async ({ page }) => {
    const store = await storeOf('Marco Peña', true)
    await loginAs(page, 'fernando.ibarra')
    await page.goto(`/comercios/${store.id}?tab=datos`)
    await expect(page.getByTestId('account-facts')).toContainText('Marco Peña')
    await page.getByTestId('reassign-to').selectOption({ label: 'Lucía Vega' })
    await page.getByTestId('reassign-save').click()
    const dialog = page.getByTestId('reassign-save-dialog')
    await expect(dialog).toContainText('¿Reasignar este comercio?')
    await expect(dialog).toContainText(`${store.name} pasa a Lucía Vega, con 1 negocio abierto`)
    await axe(page, 'confirmar reasignación')
    // cancelar no mueve nada
    await page.getByTestId('reassign-save-cancel').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('account-facts')).toContainText('Marco Peña')
    // confirmar sí, y avisa con nombre y apellido
    await page.getByTestId('reassign-save').click()
    await page.getByTestId('reassign-save-confirm').click()
    await expect(page.getByTestId('toast')).toContainText(`${store.name} ahora es de Lucía Vega, con 1 negocio abierto`)
    await expect(page.getByTestId('account-facts')).toContainText('Lucía Vega')
    // reasignar a quien ya lo tiene no hace nada y lo dice
    await page.getByTestId('reassign-save').click()
    await page.getByTestId('reassign-save-confirm').click()
    await expect(page.getByTestId('reassign-save-error')).toHaveText('Ese comercio ya es de esa persona.')
    await page.getByTestId('reassign-save-cancel').click()
    await page.getByTestId('reassign-to').selectOption({ label: 'Marco Peña' })
    await page.getByTestId('reassign-save').click()
    await page.getByTestId('reassign-save-confirm').click()
    await expect(page.getByTestId('account-facts')).toContainText('Marco Peña')
  })

  test('descartar un pendiente del equipo pide confirmación, guarda el motivo y avisa lo que pasó', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.goto('/supervisor')
    const row = page.getByTestId('exception-row').first()
    const title = (await row.locator('a span').first().innerText()).trim()
    const total = await page.getByTestId('exception-row').count()
    await row.getByTestId('exception-dismiss').click()
    const dialog = row.getByTestId('exception-dismiss-dialog')
    await expect(dialog).toContainText('¿Descartar este pendiente?')
    await expect(dialog).toContainText(`"${title}" sale de la lista del equipo y no vuelve en 7 días`)
    await axe(page, 'confirmar descartar')
    await row.getByTestId('exception-dismiss-cancel').click()
    await expect(page.getByTestId('exception-row')).toHaveCount(total)
    await expect(row.locator('a span').first()).toHaveText(title)

    const reason = `Ya lo vimos en la llamada ${uniq()}`
    await row.getByTestId('exception-dismiss').click()
    await row.getByTestId('exception-dismiss-note').fill(reason)
    await row.getByTestId('exception-dismiss-confirm').click()
    await expect(page.getByTestId('toast')).toHaveText('Pendiente descartado. Si sigue sin corregirse, vuelve a aparecer en 7 días.')
    await expect(page.getByTestId('exception-row').first().locator('a span').first()).not.toHaveText(title)
    const sql = testDb()
    const saved = await sql<{ resolution: string; who: string }[]>`
      select e.resolution, u.full_name as who from crm.exceptions e join crm.users u on u.id = e.resolved_by where e.detail->>'note' = ${reason}`
    await sql.end()
    expect(saved).toEqual([{ resolution: 'dismissed', who: 'Fernando Ibarra' }])
  })
})

test.describe('Trabajo de campo en inglés y en teléfono (equipo US)', () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: 'en-US' })

  test('log a visit from the dock in English; the store thread and the sheet read like the field team talks', async ({ page }) => {
    const store = await storeOf('Jade Kim')
    await loginAs(page, 'jade.kim')
    await page.getByTestId('dock-create').click()
    await page.getByTestId('dock-create-menu').getByRole('menuitem', { name: 'Log activity' }).click()
    const sheet = page.locator('[data-testid="log-sheet"][open]')
    await expect(sheet.getByTestId('choices-kind_choice').locator('label')).toHaveText(['Visit', 'Call', 'Note'])
    await sheet.getByTestId('log-search').fill(store.phone!.slice(-4))
    await sheet.getByTestId('log-result').filter({ hasText: store.name }).first().click()
    await expect(sheet.getByTestId('choices-result').locator('label')).toHaveText(['Sale or sign-up', 'No sale', 'Go back for the decision-maker'])
    await expect(sheet.getByTestId('choices-next').locator('label')).toHaveText(['Call', 'Visit', 'Send proposal', 'Meeting', 'Other task', 'Nothing else: close'])
    await sheet.getByText('No sale', { exact: true }).click()
    // wave 4: a visit with no sale asks why
    await expect(sheet.getByTestId('sheet-no-sale-reason').locator('option')).not.toHaveCount(1)
    await sheet.getByTestId('sheet-no-sale-reason').selectOption({ index: 1 })
    // US tiene su lista de propósitos de visita (us-embudo, E12.F1): toda visita hecha la pide
    await sheet.getByTestId('sheet-visit-reason').selectOption({ index: 1 })
    await sheet.getByText('Visit', { exact: true }).last().click()
    await sheet.getByTestId('log-save').click()
    await expect(page.getByTestId('toast')).toContainText(`Visit saved on ${store.name}. Next step: Visit ${store.name}`)
    await page.goto(`/comercios/${store.id}`)
    const visit = page.getByTestId('tl-visit').first()
    await expect(visit).toContainText(/^Today, .+ · Logged in CONTIGO · Jade Kim/)
    await expect(visit).toContainText('Visit · Prospecting or first visit · No sale') // US pide el propósito de la visita (us-embudo)
    await expect(page.getByTestId('action-sms')).toHaveText('Text')
    await expect(page.getByTestId('thread-next').first()).toContainText(/^Next · due [A-Z][a-z]{2}, [A-Z][a-z]{2} \d/) // el día y el mes conservan su mayúscula
    await noSideScroll(page)
    await axe(page, 'store thread in English')
  })
})
