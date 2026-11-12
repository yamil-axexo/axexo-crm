import { test, expect, type Page } from '@playwright/test'
// @ts-expect-error módulo de soporte sin tipos
import { sourcePairs, catalogs } from '../support/vocab-extract.mjs'
// @ts-expect-error módulo de soporte sin tipos
import { checkEs, prose, LONG_DASH } from '../support/vocab-rules.mjs'

/**
 * Lo que la persona lee, por rol y en los dos idiomas: sin jerga interna en español, sin restos de español en inglés,
 * sin guiones largos, y con el idioma del documento (html lang) igual al de la persona.
 * Entra sin el helper de las demás pruebas para poder probar también el idioma heredado del navegador.
 */
type Locale = 'es' | 'en'

async function enter(page: Page, persona: string, locale?: Locale) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId(`persona-${persona}`).click()
  await expect(page).toHaveURL(/\/(hoy|operaciones|supervisor|panel-lt|admin)$/)
  if (locale) await page.context().addCookies([{ name: 'contigo_locale', value: locale, url: page.url() }])
}

/** Texto a la vista y el que leen los lectores de pantalla: contenido, opciones de listas, etiquetas, placeholders y títulos. */
const visible = (page: Page) =>
  page.evaluate(() => {
    const out = new Set<string>()
    const add = (s: string | null | undefined) => {
      for (const l of String(s ?? '').split('\n')) {
        const t = l.replace(/\s+/g, ' ').trim()
        if (t) out.add(t)
      }
    }
    add(document.title)
    // Los datos (nombres de comercios, notas, títulos de negocios) no son texto de la interfaz: van marcados o son enlaces a un registro.
    add(document.body.innerText)
    for (const el of document.querySelectorAll('option, dialog')) add(el.textContent)
    for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) for (const a of ['aria-label', 'placeholder', 'title', 'alt']) add(el.getAttribute(a))
    return [...out]
  })

// Textos de la interfaz en español que tienen otra redacción en inglés: si uno aparece tal cual en una pantalla en inglés, quedó sin traducir.
const OTHER_PACKAGE = ['src/content/guide', 'src/ui/help', 'src/app/login/page', 'src/app/(app)/ayuda', 'src/app/(app)/bienvenida']
const fixed = (text: string) => !text.includes('${') && !text.includes('{')
const spanishOnly = new Set<string>()
const englishTexts = new Set<string>()
{
  const cat = catalogs() as { es: Record<string, string>; en: Record<string, string> }
  const all = [...(sourcePairs(OTHER_PACKAGE) as { es: string; en: string }[]), ...Object.keys(cat.es).map((k) => ({ es: cat.es[k]!, en: cat.en[k]! }))]
  for (const p of all) if (fixed(p.en)) englishTexts.add(p.en.trim())
  for (const p of all) if (fixed(p.es) && p.es.trim() !== p.en.trim() && p.es.trim().length >= 5 && !englishTexts.has(p.es.trim())) spanishOnly.add(p.es.trim())
}

// Datos sembrados que coinciden con un texto de la interfaz: nombres de embudos y de etapas, y el origen guardado de un comercio.
for (const data of ['Cadenas y distribuidores', 'Formulario web', 'Esperando primera venta', 'Pedidos', 'Dealers', 'Eventos']) spanishOnly.delete(data)

// El "—" solo, como marca de "sin dato" en una celda, se queda: un guion corto en una columna de montos se lee como signo de menos.
const dashes = (line: string) => LONG_DASH.test(line.replace(/(^|[\s·:(])—(?=$|[\s·,.)])/g, '$1'))

function findings(lines: string[], locale: Locale): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (dashes(line)) out.push(`guion largo: ${line}`)
    if (locale === 'es') for (const h of checkEs(line) as string[]) if (h !== 'guion largo') out.push(`${h}: ${line}`)
    if (locale === 'en' && spanishOnly.has(line)) out.push(`sin traducir: ${line}`)
    if (/\bAxexo\b|\bContigo\b/.test(prose(line))) out.push(`marca: ${line}`)
  }
  return out
}

const COMMON = ['/hoy', '/leads', '/pipelines', '/comercios', '/actividades', '/buscar?q=tienda']
const ROLES: { persona: string; role: string; paths: string[] }[] = [
  { persona: 'marco.pena', role: 'ventas MX', paths: [...COMMON, '/pipelines?vista=lista'] },
  { persona: 'fernando.ibarra', role: 'supervisión MX', paths: [...COMMON, '/supervisor', '/hoy?vista=equipo', '/reportes/campo'] },
  { persona: 'ana.robles', role: 'líder de mercado MX', paths: [...COMMON, '/supervisor', '/reportes/cerrados', '/reportes/adopcion'] },
  { persona: 'valeria.soto', role: 'operaciones MX', paths: ['/operaciones', '/comercios', '/pipelines', '/actividades'] },
  { persona: 'luis.tovar', role: 'leadership', paths: ['/panel-lt', '/pipelines', '/comercios', '/estado'] },
  { persona: 'nora.salas', role: 'administración', paths: ['/admin?tab=personas', '/admin?tab=territorios', '/admin?tab=embudos', '/admin?tab=entrada', '/admin?tab=integraciones', '/admin?tab=calidad', '/admin?tab=reportes', '/admin?tab=auditoria', '/admin/operaciones', '/estado', '/supervisor'] },
  { persona: 'jade.kim', role: 'ventas US', paths: COMMON },
  { persona: 'tom.reyes', role: 'operaciones US', paths: ['/operaciones', '/pipelines'] },
]

/** Recorre las pantallas de un rol en un idioma y devuelve lo que no cumple. También revisa html[lang] en cada una. */
async function sweep(page: Page, r: (typeof ROLES)[number], locale: Locale): Promise<string[]> {
  await enter(page, r.persona, locale)
  const bad: string[] = []
  const look = async (path: string) => {
    const res = await page.goto(path)
    if ((res?.status() ?? 200) >= 400) return
    await expect(page.locator('html'), path).toHaveAttribute('lang', locale)
    for (const f of findings(await visible(page), locale)) bad.push(`${path} → ${f}`)
  }
  for (const path of r.paths) await look(path)
  // La ficha de un comercio (con sus datos) y el detalle de un negocio, los que esta persona alcanza a ver.
  await page.goto('/comercios')
  const ficha = await page.locator('a[href*="ficha="]').first().getAttribute('href', { timeout: 3000 }).catch(() => null)
  if (ficha) {
    await look(ficha)
    await look(`${ficha}&tab=datos`)
  }
  await page.goto('/pipelines?vista=lista')
  const deal = await page.locator('a[href^="/deals/"]').first().getAttribute('href', { timeout: 3000 }).catch(() => null)
  if (deal) await look(deal)
  return [...new Set(bad)]
}

for (const locale of ['es', 'en'] as const) {
  test.describe(`vocabulario en ${locale === 'es' ? 'español' : 'inglés'} (1440 px)`, () => {
    for (const r of ROLES) {
      test(`${r.role} (${r.persona}): pantallas principales, ficha y negocio`, async ({ page }) => {
        test.setTimeout(120_000)
        expect(await sweep(page, r, locale)).toEqual([])
      })
    }
  })

  test.describe(`vocabulario en ${locale === 'es' ? 'español' : 'inglés'} (390 px)`, () => {
    test.use({ viewport: { width: 390, height: 844 } })
    for (const r of ROLES.filter((x) => ['marco.pena', 'fernando.ibarra', 'jade.kim'].includes(x.persona))) {
      test(`${r.role} (${r.persona}) en el teléfono`, async ({ page }) => {
        test.setTimeout(120_000)
        expect(await sweep(page, r, locale)).toEqual([])
      })
    }
  })
}

test.describe('el idioma sigue a la persona', () => {
  test('primer ingreso: hereda el del navegador; el interruptor manda desde que se toca', async ({ browser }) => {
    // Lucía tiene español guardado en su usuario; su navegador está en inglés y todavía no ha elegido.
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await enter(page, 'lucia.vega')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByTestId('nav-today')).toHaveText(/Today/)
    await expect(page.getByTestId('nav-merchants')).toHaveText(/Merchants/)
    // Elige español: gana sobre el navegador y se queda al recargar y al cambiar de pantalla.
    await page.getByTestId('locale-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByTestId('nav-today')).toHaveText(/Hoy/)
    await page.goto('/comercios')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByTestId('nav-merchants')).toHaveText(/Comercios/)
    await ctx.close()
  })

  test('Jade tiene inglés guardado, pero su navegador en español manda mientras no elija', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'es-MX' })
    const page = await ctx.newPage()
    await enter(page, 'jade.kim')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByTestId('nav-today')).toHaveText(/Hoy/)
    await page.getByTestId('locale-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByTestId('nav-today')).toHaveText(/Today/)
    await ctx.close()
  })
})

test.describe('una palabra, un significado', () => {
  test('en la ficha, quien lleva la tienda no se llama "dueño"; ese es el del comercio', async ({ page }) => {
    await enter(page, 'lucia.vega', 'es')
    await page.goto('/comercios?owner=me')
    const href = await page.locator('a[href*="ficha="]').first().getAttribute('href')
    await page.goto(href!)
    const ficha = page.getByTestId('ficha')
    await expect(ficha).toContainText('Lo lleva: Lucía Vega')
    await expect(ficha).not.toContainText(/Dueño: /)
    await page.goto(`${href}&tab=datos`)
    const lines = await visible(page)
    expect(lines.filter((l) => /dueñ[oa]/i.test(l) && !/dueñ[oa]s? del comercio|esté el dueño|dueño nunca está/i.test(l))).toEqual([])
  })

  test('una tienda activa sin tarea no se pinta como advertencia', async ({ page }) => {
    await enter(page, 'lucia.vega', 'es')
    await page.goto('/comercios?owner=me')
    const hrefs = await page.locator('a[href*="ficha="]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))
    let calm = 0
    for (const href of hrefs.slice(0, 25)) {
      await page.goto(href)
      const next = page.getByTestId('ficha-next')
      const state = await next.getAttribute('data-state')
      const health = await page.getByTestId('health').getAttribute('data-health')
      if (state === 'calm') {
        calm++
        expect(health).toBe('active')
        await expect(next).toContainText('Al día')
        await expect(next).not.toContainText('Sin próximo paso')
        break
      }
    }
    expect(calm, 'ninguna tienda activa sin pendientes entre las primeras 25').toBe(1)
  })

  test('en Mi equipo, "Asignar a alguien" es un botón que lleva a asignar; lo demás es una sugerencia en texto', async ({ page }) => {
    await enter(page, 'fernando.ibarra', 'es')
    await page.goto('/supervisor?kind=unowned_account')
    const rows = page.getByTestId('exception-row')
    if ((await rows.count()) > 0) {
      const assign = rows.first().getByTestId('exception-assign')
      await expect(assign).toHaveText('Asignar a alguien')
      await assign.click()
      await expect(page).toHaveURL(/\/comercios\/.+tab=datos/)
      await expect(page.getByTestId('ficha')).toBeVisible()
    }
    await page.goto('/supervisor')
    await expect(page.getByTestId('exception-queue')).toContainText('Pendientes del equipo')
    const hints = page.getByTestId('exception-hint')
    if ((await hints.count()) > 0) await expect(hints.first()).toContainText('Qué hacer: ')
  })
})
