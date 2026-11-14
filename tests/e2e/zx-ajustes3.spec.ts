import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, pageErrors, testDb } from './helpers'

// ajustes3: lo que la tercera vuelta del comité pidió corregir. P1 (claves internas en Hoy), enlaces internos rotos (clase
// completa), Estado para Leadership, calidad de datos, prioridad en el teléfono, ganar con pendientes de Operaciones, enlaces de
// campo desde la ficha y el error de hidratación de IA y asistencia.

async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
}
const KEY = /\b(suggest|ctx|complete|health|today|leads|record|merchants)\.[a-zA-Z_]+(\.[a-zA-Z_]+)?\b/

test.describe('P1: Hoy no muestra claves internas', () => {
  for (const persona of ['diana.cruz', 'ivan.rios', 'paula.mendez', 'kira.dunn', 'jade.kim', 'sam.ortiz']) {
    test(`Hoy de ${persona} sin claves de mensajes`, async ({ page }) => {
      await loginAs(page, persona)
      await expect(page.getByTestId('today-title')).toBeVisible()
      const text = await page.locator('main').innerText()
      expect(text.match(KEY)?.[0] ?? null, persona).toBeNull()
    })
  }

  test('una sugerencia de "lead sin tarea siguiente" se lee como acción con nombre, también en el teléfono', async ({ page }) => {
    const sql = testDb()
    let name = ''
    try {
      const [row] = await sql<{ id: string; business_name: string }[]>`
        select id, business_name from crm.leads where owner_id = md5('contigo:jade.kim')::uuid and status = 'contacted' order by id limit 1`
      if (!row) test.skip(true, 'sin lead contactado de Jade en la siembra')
      name = row!.business_name
      await sql`insert into crm.exceptions (market_code, kind, severity, lead_id, owner_id, detail, dedupe_key)
                values ('US', 'lead_no_next_step', 'high', ${row!.id}, md5('contigo:jade.kim')::uuid, ${sql.json({ name })}, ${'ajustes3-e2e:' + row!.id})
                on conflict do nothing`
    } finally {
      await sql.end()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'jade.kim')
    // Puede no caber entre las cinco sugeridas del día: lo que importa es que ninguna se lea como clave y que esta tenga texto.
    await expect(page.locator('main')).toContainText(/Schedule the next task with \S/)
    await expect(page.locator('main')).not.toContainText('suggest.')
    await noOverflow(page, 'Hoy 390')
  })
})

test.describe('enlaces internos: ninguno lleva a "Esa página no existe" (clase completa)', () => {
  const START = ['/hoy', '/estado', '/admin', '/panel-lt', '/reportes', '/comercios', '/supervisor', '/campo', '/operaciones', '/admin/avisos?ver=cola', '/admin?tab=calidad']
  const SKIP = /^\/(api|logout|salir|f\/|auth)|\/export|\/descargar|\.(csv|pdf|json)(\?|$)|[?&](ficha|vista|cola|after)=/
  for (const persona of ['luis.tovar', 'nora.salas', 'robert.hale', 'ana.robles', 'fernando.ibarra', 'jade.kim', 'tom.reyes']) {
    test(`los enlaces que ve ${persona} abren`, async ({ page }) => {
      test.setTimeout(240_000)
      await loginAs(page, persona, { stay: true })
      const seen = new Set<string>()
      for (const start of START) {
        const res = await page.goto(start)
        if (!res || res.status() === 404 || (await page.getByText(/Esa página no existe|That page does not exist/).count())) continue
        const hrefs = await page.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
        for (const h of hrefs) {
          const clean = h.split('#')[0]!
          if (!clean || SKIP.test(clean)) continue
          seen.add(clean)
        }
      }
      // Un registro por plantilla de ruta: con uno basta para saber que la pantalla existe y se puede abrir.
      const byTemplate = new Map<string, string>()
      for (const h of seen) {
        const key = h.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '[id]')
        if (!byTemplate.has(key)) byTemplate.set(key, h)
      }
      const broken: string[] = []
      for (const href of [...byTemplate.values()].slice(0, 160)) {
        const r = await page.request.get(href, { maxRedirects: 5 })
        const body = r.status() === 200 ? await r.text() : ''
        // La página 404 viaja como dato en cada respuesta; lo que cuenta es que se pinte como encabezado.
        if (r.status() === 404 || /<h1[^>]*>(Esa página no existe|That page does not exist)/.test(body)) broken.push(`${href} (${r.status()})`)
      }
      expect(broken, `${persona}: enlaces que no abren`).toEqual([])
      expect(byTemplate.size, 'se revisaron enlaces').toBeGreaterThan(5)
    })
  }
})

test.describe('Estado de CONTIGO para Leadership', () => {
  test('sin enlaces a pantallas que no puede abrir; dice quién cambia el valor; dueños en inglés', async ({ page }) => {
    await loginAs(page, 'luis.tovar', { stay: true })
    await page.goto('/estado')
    const proposed = page.getByTestId('status-proposed')
    await expect(proposed).toBeVisible()
    for (const href of await proposed.getByTestId('status-proposed-open').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
      expect(href, 'enlace a una pantalla de Administración que Leadership no abre').not.toMatch(/^\/admin\/(embudo|tableros)/)
    }
    await expect(proposed.getByTestId('status-proposed-admin').first()).toBeVisible()
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.reload()
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/Legal y Seguridad|Yamil \(C1\) con ventas|Michael Essiet o Dan Mulligan|solo arma el enlace|bucket de Datos/)
  })
})

test.describe('Administración', () => {
  test('Calidad de datos: los números sin asignar abren su lista y no contradicen "Por repartir"', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin?tab=calidad')
    await expect(page.getByTestId('admin-quality')).toBeVisible()
    await expect(page.getByTestId('orphans')).not.toContainText('Nada por repartir')
    const link = page.getByTestId('gap-accounts').first()
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/comercios\?.*owner=none/)
  })

  test('Cola de salida dice en qué zona están las horas', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/avisos?ver=cola')
    await expect(page.getByTestId('queue-zone')).toContainText(/Las horas están en/)
  })

  test('IA y asistencia abre sin errores de hidratación', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/admin/ia')
    await expect(page.getByTestId('ia-adapter')).toBeVisible()
    await page.waitForTimeout(800)
    expect(errors.filter((e) => /418|hydrat/i.test(e))).toEqual([])
  })
})

test.describe('campo y negocios', () => {
  test('la ficha abre Competencia, Fondeo y Expediente con el comercio elegido; la prioridad dice el porqué en el teléfono', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'lucia.vega')
    await page.goto('/campo?tab=prioridad')
    const item = page.getByTestId('priority-item').first()
    if (await item.count()) {
      await expect(item.getByTestId('priority-why')).toBeVisible()
      await noOverflow(page, 'prioridad 390')
    }
    const sql = testDb()
    let id = ''
    try {
      id = (await sql<{ id: string }[]>`select id from crm.accounts where owner_id = md5('contigo:lucia.vega')::uuid and kind = 'store' and archived_at is null order by id limit 1`)[0]!.id
    } finally {
      await sql.end()
    }
    await page.goto(`/comercios/${id}`)
    const comp = page.getByTestId('ficha-field-competencia')
    await expect(comp).toBeVisible()
    await comp.click()
    await expect(page).toHaveURL(new RegExp(`tab=competencia.*cuenta=${id}`))
    await expect(page.getByTestId('campo-account')).toHaveValue(id)
    await axeClean(page, 'competencia desde la ficha 390')
  })

  test('"Marcar como ganado" lista lo pendiente de Operaciones y pide confirmarlo', async ({ page }) => {
    const sql = testDb()
    let id = ''
    try {
      const rows = await sql<{ id: string }[]>`
        select d.id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.stages s on s.id = d.stage_id
         where p.market_code = 'US' and p.ops_checklist and d.status = 'open' and s.is_ops and d.training_status <> 'done' order by d.id limit 1`
      if (!rows[0]) test.skip(true, 'sin negocio de US en Operaciones en la siembra')
      id = rows[0]!.id
    } finally {
      await sql.end()
    }
    await loginAs(page, 'tom.reyes', { stay: true })
    await page.goto(`/deals/${id}`)
    const win = page.getByTestId('deal-win')
    if (!(await win.count())) test.skip(true, 'Operaciones no gana este negocio desde aquí')
    await win.click()
    await expect(page.getByTestId('win-ops-pending')).toBeVisible()
    await expect(page.getByTestId('win-ops-pending')).toContainText(/Training: not done|Capacitación: sin hacer/)
    await expect(page.getByTestId('win-ops-ack')).toHaveAttribute('required', '')
    await page.keyboard.press('Escape')
  })

  test('una cuenta de distribuidor con un negocio abierto todavía deja abrir otro', async ({ page }) => {
    const sql = testDb()
    let id = ''
    let who = ''
    try {
      const rows = await sql<{ id: string; who: string }[]>`
        select a.id, case a.owner_id when md5('contigo:ivan.rios')::uuid then 'ivan.rios' else 'diana.cruz' end as who
          from crm.accounts a where a.market_code = 'MX' and a.account_type = 'distributor' and a.archived_at is null
           and a.owner_id in (md5('contigo:ivan.rios')::uuid, md5('contigo:diana.cruz')::uuid)
           and exists (select 1 from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.account_id = a.id and d.status = 'open' and p.motor = 'b2b')
         order by a.id limit 1`
      if (!rows[0]) test.skip(true, 'sin distribuidor con negocio B2B abierto')
      id = rows[0]!.id
      who = rows[0]!.who
    } finally {
      await sql.end()
    }
    await loginAs(page, who)
    await page.goto(`/comercios/${id}`)
    await expect(page.getByTestId('new-deal')).toBeVisible()
  })
})
