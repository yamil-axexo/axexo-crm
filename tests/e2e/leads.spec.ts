import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, testDb, WIDTHS } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const axe = async (page: Page, label: string) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const uniq = () => Math.random().toString(36).slice(2, 8)

/** Un lead de MX recién llegado, con dueño o sin él, y con la meta de primer contacto por vencer o vencida. */
async function lead(opts: { owner: string | null; late?: boolean }): Promise<string> {
  const name = `Lead Reloj ${uniq()}`
  const sql = testDb()
  await sql`insert into crm.leads (market_code, source, motor, business_name, contact_name, phone, status, owner_id, assigned_at, sla_due_at, created_at)
            select 'MX', 'manual', 'd2d', ${name}, 'Persona Reloj', ${'+52555' + Math.floor(1000000 + Math.random() * 8999999)}, 'new',
                   (select id from crm.users where full_name = ${opts.owner}), now(),
                   ${opts.late ? sql`now() - interval '20 minutes'` : sql`now() + interval '20 minutes'`}, now() - interval '10 minutes'`
  await sql.end()
  return name
}

for (const w of WIDTHS) {
  test.describe(`Leads en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height } })

    test('cada lead lleva su reloj de primer contacto y su estado con palabras', async ({ page }) => {
      const waiting = await lead({ owner: 'Marco Peña' })
      const late = await lead({ owner: 'Marco Peña', late: true })
      await loginAs(page, 'marco.pena')
      await page.goto('/leads?owner=me&status=open')
      const row = (name: string) => page.getByTestId('lead-row').filter({ hasText: name })
      await expect(row(waiting).getByTestId('lead-state')).toHaveText('Sin contactar')
      await expect(row(waiting).getByTestId('lead-ring')).toHaveAttribute('data-tone', 'warn')
      await expect(row(waiting).getByTestId('lead-clock-text')).toHaveText(/Meta de primer contacto: quedan (19|20) min/)
      await expect(row(late).getByTestId('lead-state')).toHaveText('Pasó la meta')
      await expect(row(late).getByTestId('lead-ring')).toHaveAttribute('data-tone', 'risk')
      await expect(row(late).getByTestId('lead-clock-text')).toHaveText(/venció hace (20|21) min/)
      await expect(row(waiting).getByTestId('lead-call')).toHaveAttribute('data-tel', /^tel:\+52555\d{7}$/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await axe(page, `leads ${w.name}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w.name}-leads.png` })

      // "Pasó la meta" es también un filtro, con su conteo
      await page.getByTestId('pill-overdue').click()
      await expect(row(late)).toHaveCount(1)
      await expect(row(waiting)).toHaveCount(0)
    })

    test('"Tomar y llamar" asigna el lead y abre la llamada; al volver se registra el contacto', async ({ page }) => {
      const name = await lead({ owner: null })
      await loginAs(page, 'fernando.ibarra')
      await page.goto('/leads?status=new')
      const row = page.getByTestId('lead-row').filter({ hasText: name })
      await expect(row.getByTestId('lead-state')).toHaveText('Sin contactar')
      await expect(row.getByTestId('lead-take-call')).toHaveText('Tomar y llamar')
      // en la prueba no hay teléfono al que llamar: se evita abrir tel: y se simula salir de la app y volver
      const dialed = page.evaluate(() => new Promise<string>((resolve) => document.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('a[href^="tel:"]') as HTMLAnchorElement | null
        if (a) { e.preventDefault(); resolve(a.href) }
      }, true)))
      await row.getByTestId('lead-take-call').click()
      expect(await dialed).toMatch(/^tel:\+52555\d{7}$/)
      await page.evaluate(() => {
        for (const state of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
          document.dispatchEvent(new Event('visibilitychange'))
        }
      })
      const sheet = page.locator('[data-testid="complete-sheet"][open]')
      await expect(sheet.getByTestId('sheet-title')).toHaveText(`¿Cómo te fue con ${name}?`)
      await sheet.getByText('Contactado', { exact: true }).click()
      await sheet.getByText('Enviar propuesta', { exact: true }).click()
      await sheet.getByTestId('sheet-save').click()
      await expect(page.getByTestId('toast')).toContainText(`Próximo paso: Enviar propuesta a ${name}`)
      await page.goto('/leads?status=contacted')
      const done = page.getByTestId('lead-row').filter({ hasText: name })
      await expect(done.getByTestId('lead-state')).toHaveText('Contactado por Fernando Ibarra')
      await expect(done.getByTestId('lead-clock-text')).toHaveText('Primer contacto a tiempo')
      await expect(done.getByTestId('lead-ring')).toHaveAttribute('data-tone', 'ok')
      await expect(done.getByTestId('lead-call')).toHaveCount(0)
    })
  })
}

test('un lead que ya es de otra persona no se puede tomar', async ({ page }) => {
  const name = await lead({ owner: 'Lucía Vega' })
  await loginAs(page, 'fernando.ibarra')
  await page.goto('/leads?status=new')
  const row = page.getByTestId('lead-row').filter({ hasText: name })
  await expect(row.getByTestId('lead-owner-cell')).toHaveText('Lucía Vega')
  await expect(row.getByTestId('lead-take-call')).toHaveCount(0)
  await expect(row.getByTestId('lead-call')).toHaveCount(0)
})

test('quien vende ve un lead sin dueño de su mercado, lo toma desde el detalle y recién entonces lo trabaja', async ({ page }) => {
  const name = await lead({ owner: null })
  await loginAs(page, 'marco.pena')
  await page.goto('/leads?status=new')
  const row = page.getByTestId('lead-row').filter({ hasText: name })
  await expect(row.getByTestId('lead-take-call')).toHaveText('Tomar y llamar')
  await row.getByRole('link', { name }).first().click()
  await expect(page.getByTestId('lead-free')).toBeVisible()
  await expect(page.getByTestId('lead-steps')).toHaveCount(0)
  await page.getByTestId('lead-take').click()
  await expect(page.getByTestId('lead-steps')).toBeVisible()
  await expect(page.getByTestId('lead-free')).toHaveCount(0)
  await expect(page.getByTestId('lead-owner')).toContainText('Marco Peña')
})

test('quien vende en otro mercado no ve ese lead sin dueño', async ({ page }) => {
  const name = await lead({ owner: null })
  await loginAs(page, 'sam.ortiz')
  await page.goto('/leads?status=new')
  await expect(page.getByTestId('lead-row').filter({ hasText: name })).toHaveCount(0)
})
