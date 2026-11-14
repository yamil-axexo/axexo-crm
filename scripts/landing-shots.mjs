// Capturas reales del producto para la entrada, la bienvenida y la ayuda (public/landing/*.webp).
// Solo datos sintéticos: corre contra una app local con DEMO_PERSONAS=1 y una base recién cargada con scripts/seed.mjs.
// Uso: SHOTS_BASE_URL=http://127.0.0.1:3410 MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5433/<base> node scripts/landing-shots.mjs
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
// sharp viaja con next (optimización de imágenes); se resuelve desde ahí para no sumar una dependencia.
const sharp = require(require.resolve('sharp', { paths: [dirname(require.resolve('next/package.json'))] }))

const base = process.env.SHOTS_BASE_URL
const dbUrl = process.env.MIGRATION_DATABASE_URL
if (!base || !dbUrl) {
  console.error('SHOTS_BASE_URL and MIGRATION_DATABASE_URL are required')
  process.exit(1)
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)) {
  console.error('landing shots only run against a local app with synthetic data')
  process.exit(1)
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'landing')
mkdirSync(out, { recursive: true })

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} })
// El comercio de la ficha: el de Marco con más movimiento en su hilo.
const [{ id: account }] = await sql`
  select a.id from crm.accounts a join crm.users u on u.id = a.owner_id
  left join crm.activities x on x.account_id = a.id
  where u.full_name = 'Marco Peña' and a.archived_at is null
  group by a.id order by count(x.id) desc, a.id limit 1`
// La entrada dice que la Sales App todavía no está conectada: en las capturas no puede haber visitas "Sales App".
// Las visitas sembradas como si hubieran llegado de la Sales App pasan a ser visitas registradas en CONTIGO (mismo comercio,
// mismo día, mismo resultado), así las cuentas de Mi equipo no cambian. Solo en esta base de capturas, nunca en el seed.
const moved = await sql.begin(async (tx) => {
  const rows = await tx`
    insert into crm.activities (market_code, account_id, kind, subject, done_at, outcome, no_sale_code, owner_id, created_by, source, created_at)
    select v.market_code, v.account_id, 'visit', case v.market_code when 'US' then 'Visit to ' else 'Visita a ' end || a.name, v.checked_in_at,
           case when v.outcome = 'sale' then 'sale' when v.revisit then 'revisit' else 'no_sale' end,
           -- una visita sin venta lleva su motivo (regla del paquete embudo): el de la visita si existe en el catálogo
           case when v.outcome <> 'sale' and not v.revisit then coalesce((select r.code from crm.loss_reasons r where r.code = v.rejection_code), 'not_interested') end,
           coalesce(v.user_id, a.owner_id), coalesce(v.user_id, a.owner_id), 'user', v.checked_in_at
      from crm.visits v join crm.accounts a on a.id = v.account_id
     where coalesce(v.user_id, a.owner_id) is not null
    returning id`
  await tx`delete from crm.visits`
  return rows.length
})
// La lista de primeros pasos no sale en las capturas de Hoy.
await sql`insert into crm.user_onboarding (user_id, hidden_at) select id, now() from crm.users on conflict (user_id) do update set hidden_at = now()`
await sql.end()

const SIZES = [
  { name: 'm', width: 390, height: 844, scale: 2 },
  { name: 'd', width: 1440, height: 900, scale: 1.25 },
]
/** [archivo, persona, ruta, solo en estos tamaños, preparación] */
const SCREENS = [
  ['hoy', 'marco.pena', '/hoy'],
  ['leads', 'marco.pena', '/leads'],
  ['negocios', 'marco.pena', '/pipelines'],
  ['comercio', 'marco.pena', (size) => (size === 'd' ? `/comercios?ficha=${account}` : `/comercios/${account}`)],
  // En el teléfono, Mi equipo se captura a la altura de la primera persona: arriba solo hay botones y la explicación de las columnas.
  ['equipo', 'fernando.ibarra', '/supervisor', null, async (page) => {
    await page.evaluate(() => {
      const first = document.querySelector('[data-testid="rep-attempt"]')
      if (first && window.innerWidth < 600) window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY - 330)
    })
  }],
  // El panel se captura a la altura de los mercados: leads, etapas, primer intento y contacto logrado.
  ['panel', 'luis.tovar', '/panel-lt', null, async (page) => {
    await page.evaluate(() => {
      const market = [...document.querySelectorAll('h2')].find((h) => /México|Mexico/.test(h.textContent ?? ''))
      if (market) window.scrollTo(0, market.getBoundingClientRect().top + window.scrollY - 150)
    })
  }],
  ['completar', 'marco.pena', '/hoy', ['m'], async (page) => {
    await page.getByTestId('row-complete').first().click()
    await page.getByTestId('complete-sheet').waitFor()
  }],
  ['admin', 'nora.salas', '/admin?tab=personas', ['m']],
]

const browser = await chromium.launch()
let count = 0
for (const locale of ['es', 'en']) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, locale: locale === 'es' ? 'es-MX' : 'en-US', reducedMotion: 'reduce' })
    await ctx.addCookies([{ name: 'contigo_locale', value: locale, url: base }])
    const page = await ctx.newPage()
    let who = ''
    for (const [file, persona, path, only, prepare] of SCREENS) {
      if (only && !only.includes(size.name)) continue
      if (who !== persona) {
        await ctx.clearCookies({ name: 'contigo_session' })
        await page.goto(`${base}/login`)
        await page.getByTestId(`persona-${persona}`).click()
        // Cada rol aterriza en su pantalla de inicio (Hoy, Mi equipo, la cola, el Panel del LT o Administración).
        await page.waitForURL(/\/(hoy|bienvenida|supervisor|operaciones|panel-lt|admin)$/)
        who = persona
      }
      const res = await page.goto(base + (typeof path === 'function' ? path(size.name) : path))
      await page.waitForLoadState('networkidle')
      // Una pantalla de error no es una captura: se corta aquí.
      if (!res || res.status() >= 400 || !(await page.getByTestId('dock').isVisible())) throw new Error(`${file}: the screen did not load (${res?.status()})`)
      if (prepare) await prepare(page)
      await page.waitForTimeout(500)
      const png = await page.screenshot({ type: 'png' })
      await sharp(png).webp({ quality: 74, effort: 6 }).toFile(join(out, `${file}-${size.name}-${locale}.webp`))
      count++
    }
    await ctx.close()
  }
}
await browser.close()
console.log(`landing shots: ${count} files in public/landing (${moved} seeded Sales App visits shown as visits logged in CONTIGO)`)
