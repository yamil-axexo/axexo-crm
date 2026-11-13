import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, openMenu, testDb } from './helpers'

// Comité del 11-nov-2026 (administración y leadership): lo que se corrigió, visto desde la pantalla, en escritorio y en teléfono.
// Este archivo corre antes que los demás: todo lo que arma lo deja como estaba al terminar.
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase()
const TZ = 'America/Puerto_Rico'
const RULE = 'Web US dealers'
const sql = testDb()

async function clean(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${label}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`), label).toEqual([])
}
const english = (page: Page) => page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
const spanish = (page: Page) => page.context().addCookies([{ name: 'contigo_locale', value: 'es', url: page.url() }])

async function grant(page: Page, o: { email: string; name: string; role: string; market?: string; expires?: string; confirmAdmin?: boolean }) {
  await page.goto('/admin?tab=personas')
  await page.getByTestId('grant-open').click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByTestId('grant-email').fill(o.email)
  await dialog.getByTestId('grant-name').fill(o.name)
  await dialog.getByTestId('grant-role').selectOption(o.role)
  if (o.market) await dialog.getByTestId('grant-market').selectOption(o.market)
  if (o.expires) await dialog.getByTestId('grant-expires').fill(o.expires)
  if (o.confirmAdmin) await dialog.getByTestId('grant-admin-check').check()
  return dialog
}

async function sendForm(page: Page, path: string, business: string, consent: boolean) {
  await page.goto(path)
  await page.locator('input[name=business_name]').fill(business)
  await page.locator('input[name=contact_name]').fill('Persona De Prueba')
  await page.locator('input[name=phone]').fill(`305 5${Math.floor(100000 + Math.random() * 899999)}`)
  if (consent) await page.getByTestId('public-consent').check()
  await page.getByTestId('public-submit').click()
}

let original: { member_ids: string[]; cursor: number; fallback_id: string | null }
test.beforeAll(async () => {
  original = (await sql<{ member_ids: string[]; cursor: number; fallback_id: string | null }[]>`select member_ids, cursor, fallback_id from crm.routing_rules where name = ${RULE}`)[0]!
})
test.afterAll(async () => {
  // Los leads de prueba salen de las colas, el turno vuelve a sus dos personas y las personas de prueba quedan sin acceso.
  await sql`update crm.leads set status = 'disqualified', disqualify_code = 'duplicate', owner_id = null where business_name like 'C2E %' and status in ('new','contacted','qualified')`
  await sql`update crm.routing_rules set member_ids = ${original.member_ids}::uuid[], cursor = ${original.cursor}, fallback_id = ${original.fallback_id} where name = ${RULE}`
  await sql`update crm.memberships set valid_to = now() where (valid_to is null or valid_to > now()) and user_id in (select id from crm.users where email like 'c2e.%@contigo.test')`
  await sql.end()
})

for (const w of [{ name: 'escritorio', width: 1440, height: 900 }, { name: 'teléfono', width: 390, height: 844 }] as const) {
  test.describe(`administración y leadership en ${w.name} (${w.width} px)`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, timezoneId: TZ })

    test('quitar el acceso: confirma con lo que la persona tiene a su nombre, la saca del turno y el siguiente lead web no le llega', async ({ page }) => {
      const k = uniq()
      const email = `c2e.rep.${k.toLowerCase()}@contigo.test`
      const name = `C2E Vendedora ${k}`
      await loginAs(page, 'nora.salas')
      const dialog = await grant(page, { email, name, role: 'rep', market: 'US' })
      await dialog.getByTestId('grant-save').click()
      await expect(page.getByTestId('admin-notice')).toContainText('Acceso otorgado')
      const [person] = await sql<{ id: string }[]>`select id from crm.users where email = ${email}`

      // Entra al turno de US y le llega un lead web: el caso que reprodujo el comité empieza así.
      await page.goto('/admin?tab=entrada')
      const card = page.getByTestId('rule-card').filter({ hasText: RULE })
      await card.locator('label').filter({ hasText: name }).getByTestId('rule-member').check()
      await card.getByTestId('rule-save').click()
      await expect(card.getByTestId('form-ok')).toContainText('Turno actualizado')
      await sql`update crm.routing_rules set cursor = array_position(member_ids, ${person!.id}::uuid) - 1 where name = ${RULE}`
      const first = `C2E Primero ${k}`
      await sendForm(page, '/f/dealers-us', first, false)
      await expect(page.getByTestId('form-ok')).toBeVisible()
      expect((await sql`select owner_id from crm.leads where business_name = ${first}`)[0]!.owner_id).toBe(person!.id)

      // Quitar el acceso: la confirmación dice qué tiene a su nombre y qué va a pasar.
      await page.goto('/admin?tab=personas')
      const row = page.getByTestId('person-row').filter({ hasText: email })
      await row.getByTestId('membership-open').click()
      const confirm = page.locator('dialog[open]')
      await expect(confirm.getByTestId('membership-role')).toHaveText('Ventas · US')
      await expect(confirm.getByTestId('end-owned')).toContainText(`${name} tiene a su nombre 1 lead abierto en US`)
      await expect(confirm.getByTestId('end-rules')).toContainText(`Sale de los turnos de leads: ${RULE}`)
      await expect(confirm.getByTestId('end-impact')).toContainText('ya no va a poder entrar a CONTIGO')
      await expect(confirm.getByTestId('end-vacates')).toContainText('queda por repartir')
      await clean(page, `${w.name} confirmar quitar acceso`)
      // Cancelar no cambia nada.
      await confirm.getByTestId('dialog-cancel').click()
      await expect(row).toContainText('Ventas · US')
      await row.getByTestId('membership-open').click()
      await page.locator('dialog[open]').getByTestId('membership-end').click()

      // Mensaje claro al terminar, que se queda aunque la fila desaparezca.
      const notice = page.getByTestId('admin-notice')
      await expect(notice).toContainText(`Acceso cerrado: ${name} ya no tiene ese rol.`)
      await expect(notice).toContainText(`Salió del turno: ${RULE}.`)
      // Lo suyo quedó sin dueño vigente: el aviso lo dice con la misma cuenta y lleva a repartirlo.
      await expect(notice).toContainText('Lo que tiene a su nombre (1 lead abierto) quedó por repartir en US: nadie lo atiende hasta que lo repartas.')
      await expect(notice.getByTestId('admin-notice-link')).toHaveAttribute('href', '/supervisor?market=US')
      await expect(page.getByTestId('person-row').filter({ hasText: email })).toHaveCount(0)
      await page.getByTestId('pill-sin').click()
      await expect(page.getByTestId('person-row').filter({ hasText: email }).getByTestId('no-access')).toContainText('Sin acceso desde el')

      // Ya no está en el turno, y los siguientes leads web no le llegan.
      await page.goto('/admin?tab=entrada')
      await expect(page.getByTestId('rule-card').filter({ hasText: RULE })).not.toContainText(name)
      for (const n of [1, 2, 3]) {
        const business = `C2E Después ${n} ${k}`
        await sendForm(page, '/f/dealers-us', business, false)
        await expect(page.getByTestId('form-ok')).toBeVisible()
        const [lead] = await sql<{ owner_id: string | null }[]>`select owner_id from crm.leads where business_name = ${business}`
        expect(lead!.owner_id).not.toBe(person!.id)
        expect(lead!.owner_id).not.toBeNull()
      }

      // El lead que se quedó a su nombre lo avisa, y Calidad de datos lo cuenta.
      const [stuck] = await sql<{ id: string }[]>`select id from crm.leads where business_name = ${first}`
      await page.goto(`/leads/${stuck!.id}`)
      await expect(page.getByTestId('lead-owner-gone')).toContainText('ya no tiene acceso en este mercado')
      await page.goto('/admin?tab=calidad')
      await expect(page.getByTestId('orphan-row').filter({ hasText: name })).toContainText('US')
      await clean(page, `${w.name} calidad de datos`)
    })

    test('un turno sin nadie con acceso deja el lead sin dueño, a la vista de quien vende en ese mercado', async ({ page }) => {
      const k = uniq()
      const business = `C2E Libre ${k}`
      await sql`update crm.routing_rules set member_ids = '{}', fallback_id = null where name = ${RULE}`
      try {
        await sendForm(page, '/f/dealers-us', business, false)
        await expect(page.getByTestId('form-ok')).toBeVisible()
        expect((await sql`select owner_id from crm.leads where business_name = ${business}`)[0]!.owner_id).toBeNull()
        await loginAs(page, 'sam.ortiz')
        await page.goto(`/leads?q=${encodeURIComponent(business)}`)
        await expect(page.getByTestId('lead-row').filter({ hasText: business })).toHaveCount(1)
        await loginAs(page, 'nora.salas')
        await page.goto('/admin?tab=entrada')
        const card = page.getByTestId('rule-card').filter({ hasText: RULE })
        await expect(card.getByTestId('rule-empty')).toBeVisible()
        await expect(card).toContainText('sin respaldo: si en el turno no queda nadie, el lead queda sin asignar')
        await clean(page, `${w.name} formularios y turnos`)
      } finally {
        await sql`update crm.routing_rules set member_ids = ${original.member_ids}::uuid[], cursor = ${original.cursor}, fallback_id = ${original.fallback_id} where name = ${RULE}`
      }
    })

    test('dar acceso: vencimiento opcional, confirmación aparte para Administración y aviso de supervisión sin equipo', async ({ page }) => {
      const k = uniq()
      await loginAs(page, 'nora.salas')

      // Administración: sin marcar la casilla no pasa.
      const adminEmail = `c2e.adm.${k.toLowerCase()}@contigo.test`
      const day = (await sql<{ day: string }[]>`select to_char((now() at time zone 'UTC')::date + 20, 'YYYY-MM-DD') as day`)[0]!.day
      let dialog = await grant(page, { email: adminEmail, name: `C2E Admin ${k}`, role: 'admin', expires: day })
      await expect(dialog.getByTestId('grant-market')).toHaveCount(0) // un rol global no pide mercado ni equipo
      await expect(dialog.getByTestId('grant-admin-confirm')).toContainText('crear llaves de API')
      await clean(page, `${w.name} dar administración`)
      await dialog.getByTestId('grant-save').click()
      await expect(dialog.getByTestId('form-error')).toContainText('Marca la casilla para confirmar')
      await dialog.getByTestId('grant-admin-check').check()
      await dialog.getByTestId('grant-save').click()
      await expect(page.getByTestId('admin-notice')).toContainText('Acceso otorgado. Vence el')
      const adminRow = page.getByTestId('person-row').filter({ hasText: adminEmail })
      await expect(adminRow).toContainText('Administración')
      await expect(adminRow).toContainText('vence el')

      // El vencimiento se cambia después y se puede quitar.
      await adminRow.getByTestId('membership-open').click()
      const access = page.locator('dialog[open]')
      await expect(access.getByTestId('expiry-date')).toHaveValue(day)
      await access.getByTestId('expiry-date').fill('')
      await access.getByTestId('expiry-save').click()
      await expect(page.getByTestId('admin-notice')).toContainText('ya no tiene fecha de vencimiento')
      await expect(page.getByTestId('person-row').filter({ hasText: adminEmail })).not.toContainText('vence el')

      // Supervisión sin equipo: avisa antes de guardar, al guardar y en la fila.
      const supEmail = `c2e.sup.${k.toLowerCase()}@contigo.test`
      dialog = await grant(page, { email: supEmail, name: `C2E Supervisora ${k}`, role: 'supervisor', market: 'US' })
      await expect(dialog.getByTestId('grant-supervisor-warn')).toContainText('no va a ver los registros de nadie más')
      await dialog.getByTestId('grant-team').selectOption({ label: 'Dealers East' })
      await expect(dialog.getByTestId('grant-supervisor-warn')).toHaveCount(0)
      await dialog.getByTestId('grant-team').selectOption('')
      await dialog.getByTestId('grant-save').click()
      await expect(page.getByTestId('admin-notice')).toContainText('Esta supervisión quedó sin equipo')
      await expect(page.getByTestId('person-row').filter({ hasText: supEmail })).toContainText('sin equipo')

      // Una fecha pasada no entra.
      dialog = await grant(page, { email: `c2e.old.${k.toLowerCase()}@contigo.test`, name: `C2E Vencida ${k}`, role: 'rep', market: 'MX' })
      await dialog.getByTestId('grant-expires').evaluate((el) => el.removeAttribute('min'))
      await dialog.getByTestId('grant-expires').fill('2026-01-15')
      await dialog.getByTestId('grant-save').click()
      await expect(dialog.getByTestId('form-error')).toContainText('de hoy en adelante')

      // Un rol que vence deja de valer solo: pasada la fecha, la persona ya no entra y sale de "Con acceso".
      await sql`update crm.memberships set valid_to = now() - interval '1 minute' where user_id = (select id from crm.users where email = ${supEmail})`
      await page.goto('/admin?tab=personas')
      await expect(page.getByTestId('person-row').filter({ hasText: supEmail })).toHaveCount(0)
      await clean(page, `${w.name} personas y acceso`)
    })

    test('bitácora: hora de quien lee con la zona escrita, acciones y registros por su nombre, antes y después, filtros y páginas', async ({ page }) => {
      const k = uniq()
      const email = `c2e.aud.${k.toLowerCase()}@contigo.test`
      const name = `C2E Auditada ${k}`
      await loginAs(page, 'nora.salas')
      const dialog = await grant(page, { email, name, role: 'rep', market: 'US' })
      await dialog.getByTestId('grant-save').click()
      await expect(page.getByTestId('admin-notice')).toBeVisible()
      await page.getByTestId('person-row').filter({ hasText: email }).getByTestId('membership-open').click()
      await page.locator('dialog[open]').getByTestId('membership-end').click()
      await expect(page.getByTestId('admin-notice')).toContainText('Acceso cerrado')
      const [ended] = await sql<{ at: Date; object_id: string }[]>`
        select e.at, e.object_id from crm.audit_events e join crm.users u on u.id = e.object_id where u.email = ${email} and e.action = 'membership.ended'`

      await page.goto('/admin?tab=auditoria')
      await expect(page.getByTestId('audit-zone')).toContainText('Las horas están en hora de Puerto Rico (GMT-4).')
      const row = page.getByTestId('audit-row').filter({ hasText: name }).first()
      await expect(row.getByTestId('audit-what')).toHaveText('Quitó un acceso')
      await expect(row.getByTestId('audit-summary')).toHaveText('Ventas · US')
      await expect(row.getByTestId('audit-target')).toHaveText(name)
      await expect(row).toContainText('Nora Salas')
      // La hora es la de Puerto Rico, no la UTC del servidor.
      const hm = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: TZ }).format(new Date(ended!.at)).replace(/\s/g, ' ')
      expect((await row.getByTestId('audit-when').innerText()).replace(/\s/g, ' ')).toContain(hm)
      // Ni códigos en inglés ni identificadores cortados.
      const table = await page.getByTestId('audit-table').innerText()
      expect(table).not.toMatch(/membership\.(ended|granted)|session\.started|user · [0-9a-f]{8}/)
      // De entrada no hay inicios de sesión.
      await expect(page.getByTestId('audit-table')).not.toContainText('Inició sesión')

      // El antes y el después, en palabras.
      await row.getByTestId('audit-detail').locator('summary').click()
      await expect(row.getByTestId('audit-detail')).toContainText('Rol')
      await expect(row.getByTestId('audit-detail')).toContainText('Antes: Ventas')
      await clean(page, `${w.name} bitácora`)

      // Filtros: por tipo, por persona, por registro y por fechas.
      await page.getByTestId('audit-kind').selectOption('access')
      await expect(page).toHaveURL(/tipo=access/)
      for (const what of await page.getByTestId('audit-what').allInnerTexts()) expect(['Dio acceso', 'Quitó un acceso', 'Cambió el vencimiento de un acceso', 'Creó un equipo']).toContain(what)
      await page.getByTestId('audit-kind').selectOption('sessions')
      await expect(page.getByTestId('audit-what').first()).toHaveText(/Inició sesión|Cerró sesión/)
      await page.getByTestId('audit-kind').selectOption('')
      await page.getByTestId('audit-actor').selectOption({ label: 'Nora Salas' })
      await expect(page).toHaveURL(/quien=/)
      await expect(page.getByTestId('audit-row').first()).toContainText('Nora Salas')
      await page.getByTestId('audit-object').selectOption('user')
      await expect(page).toHaveURL(/registro=user/)
      await expect(page.getByTestId('audit-row').filter({ hasText: name }).first()).toBeVisible()
      await page.getByTestId('audit-from').fill('2031-01-01')
      await page.getByTestId('audit-apply').click()
      await expect(page.getByTestId('admin-audit')).toContainText('Ningún evento con esos filtros')
      await page.getByTestId('audit-clear').click()
      await expect(page.getByTestId('audit-table')).toBeVisible()

      // El historial de un solo registro.
      await page.getByTestId('audit-row').filter({ hasText: name }).first().getByTestId('audit-history').click()
      await expect(page.getByTestId('audit-record')).toContainText(name)
      await expect(page.getByTestId('audit-what')).toHaveText(['Quitó un acceso', 'Dio acceso'])

      // En inglés, lo mismo con sus palabras.
      await english(page)
      await page.reload()
      await expect(page.getByTestId('audit-what')).toHaveText(['Removed access', 'Granted access'])
      await expect(page.getByTestId('audit-zone')).toContainText('Times are in Puerto Rico time (GMT-4).')
      await spanish(page)

      // Un registro que quien lee puede abrir lleva enlace: el lead web abre su detalle.
      const business = `C2E Bitácora ${k}`
      await sendForm(page, '/f/dealers-us', business, false)
      await expect(page.getByTestId('form-ok')).toBeVisible()
      const [lead] = await sql<{ id: string }[]>`select id from crm.leads where business_name = ${business}`
      await page.goto(`/admin?tab=auditoria&id=${lead!.id}`)
      await expect(page.getByTestId('audit-what').first()).toHaveText('Creó un lead')
      await page.getByTestId('audit-target').first().click()
      await expect(page).toHaveURL(new RegExp(`/leads/${lead!.id}$`))

      // Páginas: 60 eventos de un mismo registro son una página de 50 y otra de 10.
      const probe = (await sql<{ id: string }[]>`select app.uuid_v7() as id`)[0]!.id
      await sql`insert into crm.audit_events (at, actor_id, action, object, object_id) select now() - make_interval(secs => g), ${ended!.object_id}, 'activity.added', 'activity', ${probe} from generate_series(1, 60) g`
      await page.goto(`/admin?tab=auditoria&id=${probe}`)
      await expect(page.getByTestId('audit-zone')).toContainText('60 eventos')
      await expect(page.getByTestId('audit-row')).toHaveCount(50)
      await expect(page.getByTestId('audit-newer')).toHaveCount(0)
      await page.getByTestId('audit-older').click()
      await expect(page.getByTestId('audit-row')).toHaveCount(10)
      await expect(page.getByTestId('audit-older')).toHaveCount(0)
      await page.getByTestId('audit-newer').click()
      await expect(page.getByTestId('audit-row')).toHaveCount(50)
    })

    test('página de estado: la abren administración y leadership desde el menú de la cuenta; ventas no', async ({ page }) => {
      for (const persona of ['nora.salas', 'luis.tovar']) {
        await loginAs(page, persona)
        await openMenu(page)
        await page.getByTestId('nav-status').click()
        await expect(page).toHaveURL(/\/estado$/)
        await expect(page.locator('h1')).toHaveText('Estado de CONTIGO')
        await expect(page.getByTestId('status-env')).toContainText('Pruebas automáticas')
        await expect(page.getByTestId('status-version')).toContainText('Entorno local, sin versión')
        // La última migración cambia con cada paquete: se comprueba que la nombra, no cuál es.
        await expect(page.getByTestId('status-db')).toContainText(/Última: \d{4}_[a-z0-9_]+/)
        await expect(page.getByTestId('status-zone')).toContainText('hora de Puerto Rico (GMT-4)')
        // Frescura e integraciones, con "sin conectar" donde nada está conectado.
        await expect(page.getByTestId('status-row-pipedrive').getByTestId('status-last')).toHaveText('Importación sin correr: todavía no se ha copiado nada de Pipedrive')
        await expect(page.getByTestId('status-row-s5').getByTestId('status-last')).toContainText('Último archivo: corte del')
        await expect(page.getByTestId('status-row-s5').getByTestId('status-state')).toHaveText('Sin conectar')
        await expect(page.getByTestId('status-row-sales_app').getByTestId('status-state')).toHaveText('Sin conectar')
        await expect(page.getByTestId('status-row-outbox').getByTestId('status-state')).toHaveText('Canal apagado')
        await expect(page.getByTestId('status-row-google').getByTestId('status-last')).toContainText('personas de prueba')
        await expect(page.getByTestId('status-row-web_forms')).toContainText('3 formularios activos')
        // Lo que nadie ha definido no trae un valor inventado.
        await expect(page.getByTestId('status-undefined-row')).toHaveCount(7)
        for (const item of ['Responsable técnico', 'Respaldo de la base de datos', 'Plan de restauración', 'Costo mensual de operación']) {
          await expect(page.getByTestId('status-undefined-row').filter({ hasText: item })).toContainText('Por definir')
        }
        await expect(page.getByTestId('status-admins')).toContainText('Nora Salas')
        await expect(page.getByTestId('status-admins')).toContainText('sin vencimiento')
        await expect(page.getByTestId('status-not-yet')).toContainText('Correo, calendario, telefonía y secuencias')
        await page.getByTestId('status-migrations').locator('summary').click()
        await expect(page.getByTestId('status-migration').first()).toContainText('0001_core')
        await clean(page, `${w.name} estado (${persona})`)
      }
      await english(page)
      await page.reload()
      await expect(page.locator('h1')).toHaveText('CONTIGO status')
      await expect(page.getByTestId('status-undefined-row').first()).toContainText('To be defined')
      await expect(page.getByTestId('status-row-outbox').getByTestId('status-state')).toHaveText('Channel off')
      await spanish(page)

      await loginAs(page, 'sam.ortiz')
      await openMenu(page)
      await expect(page.getByTestId('nav-status')).toHaveCount(0)
      expect((await page.goto('/estado'))?.status()).toBe(404)
    })

    test('etapas: administración cambia nombre en español y en inglés, días y requisitos, y queda en la bitácora', async ({ page }) => {
      const k = uniq()
      const es = `Propuesta enviada ${k}`
      const en = `Proposal sent ${k}`
      const [was] = await sql<{ id: string; name_es: string; name_en: string; rot_days: number; required_fields: string[] }[]>`
        select s.id, s.name_es, s.name_en, s.rot_days, s.required_fields from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where p.market_code = 'SV' and s.code = 'propuesta'`
      try {
        await loginAs(page, 'nora.salas')
        await page.goto('/admin?tab=embudos')
        const card = page.getByTestId('pipeline-card').filter({ hasText: 'SV · ' })
        const row = card.getByTestId('stage-row').filter({ hasText: was!.name_es })
        await row.getByTestId('stage-edit').click()
        const dialog = page.locator('dialog[open]')
        await clean(page, `${w.name} editar etapa`)
        await dialog.getByTestId('stage-name-es').fill(es)
        await dialog.getByTestId('stage-name-en').fill(en)
        await dialog.getByTestId('stage-rot-days').fill('9')
        await dialog.getByTestId('stage-req-amount').uncheck()
        await dialog.getByTestId('stage-req-decision_maker').check()
        await expect(dialog.getByTestId('stage-req-next_step')).toBeDisabled() // el próximo paso se pide siempre
        await dialog.getByTestId('stage-save').click()
        await expect(page.getByTestId('admin-notice')).toContainText('Etapa actualizada')
        const edited = card.getByTestId('stage-row').filter({ hasText: es })
        await expect(edited.getByTestId('stage-rot')).toHaveText('9 días')
        await expect(edited.getByTestId('stage-needs')).toHaveText('próximo paso con fecha, quien decide, identificado y contactado')
        await english(page)
        await page.reload()
        await expect(page.getByTestId('stage-row').filter({ hasText: en }).getByTestId('stage-rot')).toHaveText('9 days')
        await spanish(page)

        await page.goto(`/admin?tab=auditoria&id=${was!.id}`)
        const event = page.getByTestId('audit-row').first()
        await expect(event.getByTestId('audit-what')).toHaveText('Cambió una etapa')
        await expect(event.getByTestId('audit-target')).toHaveText(es)
        await event.getByTestId('audit-detail').locator('summary').click()
        await expect(event.getByTestId('audit-detail')).toContainText(`Antes: ${was!.name_es}`)
        await expect(event.getByTestId('audit-detail')).toContainText(`Después: ${es}`)
        await expect(event.getByTestId('audit-detail')).toContainText('Antes: 14 días')
        await expect(event.getByTestId('audit-detail')).toContainText('Después: 9 días')

        // Leadership ve los embudos y no tiene botón para editarlos.
        await loginAs(page, 'luis.tovar')
        await page.goto('/admin?tab=embudos')
        await expect(page.getByTestId('stage-row').filter({ hasText: es })).toBeVisible()
        await expect(page.getByTestId('stage-edit')).toHaveCount(0)
        await expect(page.getByTestId('pipeline-config')).toHaveCount(0)
      } finally {
        await sql`update crm.stages set name_es = ${was!.name_es}, name_en = ${was!.name_en}, rot_days = ${was!.rot_days}, required_fields = ${was!.required_fields}::text[], edited_at = null, edited_by = null where id = ${was!.id}`
      }
    })

    test('lead web: guarda de dónde vino y el consentimiento con fecha, y se ven en el detalle', async ({ page }) => {
      const k = uniq()
      const business = `C2E Con Origen ${k}`
      await sendForm(page, '/f/dealers-us?utm_source=google&utm_medium=cpc&utm_campaign=dealers-otono&utm_content=anuncio-b&utm_term=vender+recargas&gclid=G-123abc&fbclid=F-456def&otra=cosa', business, true)
      // El formulario de US responde en inglés aunque el navegador esté en español.
      await expect(page.getByTestId('form-ok')).toHaveText('We got your details. Someone from the team will reach out.')
      await clean(page, `${w.name} formulario público`)
      const [lead] = await sql<{ id: string; gclid: string; consent_at: Date }[]>`select id, gclid, consent_at from crm.leads where business_name = ${business}`
      expect(lead).toMatchObject({ gclid: 'G-123abc' })
      expect(lead!.consent_at).not.toBeNull()

      await loginAs(page, 'nora.salas')
      await page.goto(`/leads/${lead!.id}`)
      const origin = page.getByTestId('lead-origin')
      for (const [key, value] of [['utm_source', 'google'], ['utm_medium', 'cpc'], ['utm_campaign', 'dealers-otono'], ['utm_content', 'anuncio-b'], ['utm_term', 'vender recargas'], ['gclid', 'G-123abc'], ['fbclid', 'F-456def']] as const) {
        await expect(origin.getByTestId(`origin-${key}`)).toHaveText(value)
      }
      await expect(origin.getByTestId('lead-consent')).toContainText('Sí, el')
      // ola 4: la zona de US se dice con nombre y, con el navegador en otra zona (Puerto Rico), va también la hora local
      await expect(origin.getByTestId('lead-consent')).toContainText('hora del Este')
      await expect(origin.getByTestId('lead-consent').getByTestId('own-time')).toContainText('tu hora')
      await expect(origin.getByTestId('lead-consent')).toContainText('I agree to receive emails from axexo about its products and news.')
      await clean(page, `${w.name} detalle del lead con origen`)

      // Sin parámetros y sin casilla: el lead entra igual y el detalle lo dice.
      const plain = `C2E Sin Origen ${k}`
      await sendForm(page, '/f/tiendas-mx', plain, false)
      await expect(page.getByTestId('form-ok')).toHaveText('Recibimos tus datos. Alguien del equipo te va a contactar.')
      const [second] = await sql<{ id: string }[]>`select id from crm.leads where business_name = ${plain}`
      await page.goto(`/leads/${second!.id}`)
      await expect(page.getByTestId('lead-origin-empty')).toContainText('Llegó sin datos de campaña')
      await expect(page.getByTestId('lead-consent')).toContainText('No lo dio')
    })

    test('solo lectura: Leadership lo ve en la barra, no tiene "Evaluar reglas ahora", y quien sí la corre queda en la bitácora', async ({ page }) => {
      await loginAs(page, 'luis.tovar')
      for (const path of ['/hoy', '/supervisor', '/panel-lt', '/comercios', '/admin', '/estado']) {
        await page.goto(path)
        await expect(page.getByTestId('topbar').getByTestId('read-only'), path).toHaveText('Solo lectura')
        await expect(page.getByTestId('topbar').getByTestId('read-only'), path).toBeVisible()
      }
      await openMenu(page)
      await expect(page.getByTestId('me-read-only')).toContainText('ves todo y no cambias nada')
      await page.goto('/supervisor')
      await expect(page.getByTestId('team-board')).toBeVisible()
      await expect(page.getByTestId('run-rules')).toHaveCount(0)
      await clean(page, `${w.name} mi equipo en solo lectura`)
      // Una sección de administración que su rol no ve se lo dice, en vez de abrir otra en silencio.
      await page.goto('/admin?tab=personas')
      await expect(page.getByTestId('tab-hidden')).toContainText('Tu rol no ve la sección "Personas y acceso"')
      await expect(page.getByTestId('admin-people')).toHaveCount(0)
      await english(page)
      await page.reload()
      await expect(page.getByTestId('read-only')).toHaveText('Read-only')
      await spanish(page)

      // Quien dirige un equipo sí la corre, y queda a su nombre.
      await loginAs(page, 'kira.dunn')
      await expect(page.getByTestId('read-only')).toHaveCount(0)
      await page.goto('/supervisor')
      await page.getByTestId('run-rules').click()
      await expect(page.getByTestId('form-ok')).toContainText(/Avisos actualizados|Alerts refreshed/) // Kira trabaja en inglés
      await loginAs(page, 'nora.salas')
      await expect(page.getByTestId('read-only')).toHaveCount(0)
      await page.goto('/admin?tab=auditoria&tipo=integrations')
      const event = page.getByTestId('audit-row').filter({ hasText: 'Evaluó las reglas a mano' }).first()
      await expect(event).toContainText('Kira Dunn')
      await expect(event.getByTestId('audit-summary')).toContainText('avisos nuevos')
    })

    test('integraciones: revocar una llave pide confirmación y las pruebas quedan a nombre de quien las corre', async ({ page }) => {
      const k = uniq()
      await loginAs(page, 'nora.salas')
      // Las llaves se crean y se revocan en un solo lugar (Eventos, API y datos); la pestaña de la Sales App conserva las pruebas.
      await page.goto('/admin/integraciones?tab=api')
      await page.getByTestId('key-name').fill(`C2E sitio ${k}`)
      await page.getByTestId('key-scope-forms:write').check()
      await page.getByTestId('key-create').click()
      await expect(page.getByTestId('reveal-once').getByRole('button')).toHaveText('Copiar')
      const row = page.getByTestId('key-row').filter({ hasText: `C2E sitio ${k}` })
      await expect(row).toContainText('por Nora Salas')
      await row.getByTestId('key-revoke').click()
      const confirm = page.locator('dialog[open]')
      await expect(confirm).toContainText('deja de servir en ese instante')
      await clean(page, `${w.name} revocar llave`)
      await confirm.getByTestId('key-revoke-confirm').click()
      await expect(row).toContainText('revocada')
      await page.goto('/admin?tab=integraciones')
      await expect(page.getByTestId('sim-warning')).toContainText('cambian registros de este ambiente')
      await expect(page.getByTestId('api-clients')).toHaveCount(0)

      await page.getByTestId('sim-visit-ref').selectOption('SC-XX-000000')
      await page.getByTestId('sim-visit-send').click()
      await expect(page.getByTestId('sim-visit').getByTestId('form-ok')).toContainText('Pendientes del equipo')
      await page.goto('/admin?tab=auditoria&tipo=integrations')
      const event = page.getByTestId('audit-row').filter({ hasText: 'Probó una integración desde Administración' }).first()
      await expect(event).toContainText('Nora Salas')
      await expect(event.getByTestId('audit-summary')).toHaveText('Visita de la Sales App')
      // El evento sin comercio que dejó esta prueba se cierra, para no cambiar la cola de quien supervisa.
      await sql`update crm.exceptions set resolved_at = now(), resolution = 'dismissed' where kind = 'unmatched_event' and resolved_at is null`
    })
  })
}

test.describe('tableta (1024 px)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, timezoneId: TZ })
  test('las pantallas nuevas caben y pasan accesibilidad también en tableta', async ({ page }) => {
    await loginAs(page, 'luis.tovar')
    await page.goto('/estado')
    await expect(page.getByTestId('read-only')).toBeVisible()
    await clean(page, 'tableta estado')
    await page.goto('/admin?tab=auditoria&tipo=all')
    await expect(page.getByTestId('audit-zone')).toContainText('hora de Puerto Rico')
    await clean(page, 'tableta bitácora')
    await loginAs(page, 'nora.salas')
    await page.goto('/admin?tab=personas')
    await page.getByTestId('membership-open').first().click()
    await expect(page.locator('dialog[open]').getByTestId('end-impact')).toBeVisible()
    await clean(page, 'tableta personas y acceso')
    await page.goto('/admin?tab=embudos')
    await page.getByTestId('stage-edit').first().click()
    await clean(page, 'tableta editar etapa')
  })
})
