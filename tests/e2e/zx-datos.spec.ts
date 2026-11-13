import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fichaTab, loginAs, pageErrors, testDb, WIDTHS } from './helpers'

// Paquete datos (0023): DAT-04, DAT-01, DAT-02, DAT-03, DAT-05, GOB-01, GOB-02 y DAT-07, desde la pantalla y por el rol que corresponde.
const uniq = () => Math.random().toString(36).slice(2, 7)
const sql = testDb()
test.afterAll(async () => {
  await sql.end()
})

const idOf = async (name: string) => (await sql<{ id: string }[]>`select id from crm.accounts where name = ${name} and archived_at is null`)[0]!.id
const personaId = async (key: string) => (await sql<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)[0]!.id
async function rawAccount(market: string, who: string, name: string, extra: { phone?: string; locality?: string } = {}) {
  const o = await personaId(who)
  return (await sql<{ id: string }[]>`insert into crm.accounts (market_code, kind, account_type, name, segment, owner_id, phone, locality, country, created_by)
    values (${market}, 'store', 'store', ${name}, ${market === 'US' ? 'dealer' : 'd2d'}, ${o}, ${extra.phone ?? null}, ${extra.locality ?? null}, ${market}, ${o}) returning id`)[0]!.id
}
async function clean(page: Page, what: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what}: se sale del ancho`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target}`), what).toEqual([])
}
const notice = (page: Page) => page.getByTestId('admin-notice')

test.describe('datos: duplicados y registro único (DAT-04)', () => {
  test('un comercio parecido no se crea con un clic: pide motivo, y el aviso saltado llega a quien lidera el mercado', async ({ page }) => {
    const base = `Tlapalería Girasoles ${uniq()}`
    await rawAccount('MX', 'marco.pena', base)
    await loginAs(page, 'lucia.vega')
    await page.goto('/comercios')
    await page.getByTestId('new-account').click()
    await page.getByTestId('account-name').fill(`${base} 2`)
    await page.getByTestId('save-account').click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByTestId('form-error')).toContainText('escribe por qué')
    // marcar "crear de todos modos" sin motivo no alcanza
    await dialog.getByTestId('account-force').check()
    await page.waitForTimeout(800)
    await page.getByTestId('save-account').click()
    await expect(dialog.getByTestId('form-error')).toContainText('Sin motivo no se crea')
    await dialog.getByTestId('account-reason').fill('Es la sucursal nueva de la misma dueña')
    await page.waitForTimeout(800)
    await page.getByTestId('save-account').click()
    await expect(page.getByTestId('account-facts')).toContainText(`${base} 2`)

    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/datos?tab=duplicados')
    const row = page.getByTestId('bypass-row').filter({ hasText: `${base} 2` })
    await expect(row.getByTestId('bypass-reason')).toHaveText('Es la sucursal nueva de la misma dueña')
    await expect(row).toContainText('Lucía Vega')
    await row.getByTestId('bypass-review').click()
    await expect(notice(page)).toContainText('Aviso revisado')
    await expect(page.getByTestId('bypass-row').filter({ hasText: `${base} 2` })).toHaveCount(0)
  })

  test('con el mismo teléfono quien vende no puede crear otro comercio', async ({ page }) => {
    const tel = `55${Math.floor(10000000 + Math.random() * 89999999)}`
    const name = `Papelería Nogales ${uniq()}`
    await rawAccount('MX', 'marco.pena', name, { phone: `+52${tel}` })
    await loginAs(page, 'lucia.vega')
    await page.goto('/comercios')
    await page.getByTestId('new-account').click()
    await page.getByTestId('account-name').fill(`Otro negocio ${uniq()}`)
    await page.getByTestId('account-phone').fill(tel)
    await page.getByTestId('account-force').check()
    await page.getByTestId('account-reason').fill('Creo que es otro comercio distinto')
    await page.getByTestId('save-account').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText('No se crea otro')
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText(name)
  })

  test('administración busca duplicados, compara lado a lado, fusiona eligiendo valores y deshace la fusión', async ({ page }) => {
    const errors = pageErrors(page)
    const tel = `+5255${Math.floor(10000000 + Math.random() * 89999999)}`
    const stays = `Carnicería El Roble ${uniq()}`
    const goes = `Carnicería El Roble Suc ${uniq()}`
    const a = await rawAccount('MX', 'marco.pena', stays, { phone: tel, locality: 'Puebla' })
    const b = await rawAccount('MX', 'lucia.vega', goes, { phone: tel, locality: 'Cholula' })
    await sql`insert into crm.activities (market_code, account_id, kind, subject) values ('MX', ${b}, 'note', 'Nota del registro repetido')`
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/datos?tab=duplicados&mercado=MX')
    await page.getByTestId('scan-run').click()
    await expect(notice(page)).toContainText('Búsqueda terminada')
    // el par con el mismo teléfono es de llave fuerte y va arriba
    const pair = page.getByTestId('pair-row').filter({ hasText: stays })
    await expect(pair).toHaveAttribute('data-strong', 'yes')
    await expect(pair).toContainText('Mismo teléfono')
    await pair.getByTestId('pair-open').click()
    const compare = page.getByTestId('pair-compare')
    await expect(compare).toContainText(stays)
    await expect(compare).toContainText(goes)
    await expect(compare.locator('[data-field="locality"]')).toHaveAttribute('data-differ', 'yes')
    await clean(page, 'comparación de duplicados')
    // se queda el primero (a < b no está garantizado: se elige por nombre) y la ciudad se toma del otro
    const [first] = [a, b].sort()
    await compare.getByTestId(first === a ? 'keep-a' : 'keep-b').check()
    await compare.getByTestId(first === a ? 'pick-locality-b' : 'pick-locality-a').check()
    await compare.getByTestId('merge-confirm').click()
    await expect(notice(page)).toContainText('Fusionados')
    const merged = page.getByTestId('merge-row').filter({ hasText: stays })
    await expect(merged).toContainText(goes)
    await expect(merged.getByTestId('merge-survivors')).toContainText('Ciudad (lo eligió quien fusionó)')
    // todo lo que colgaba del archivado sigue al que queda
    await page.goto(`/comercios/${a}`)
    await expect(page.getByTestId('account-timeline')).toContainText('Nota del registro repetido')
    await fichaTab(page, 'datos')
    await expect(page.getByTestId('account-merges')).toContainText(goes)
    await expect(page.getByTestId('ficha-address')).toContainText('Cholula')
    // deshacer: los dos vuelven a existir
    await page.goto('/datos?tab=duplicados&mercado=MX')
    await page.getByTestId('merge-row').filter({ hasText: stays }).getByTestId('merge-undo').click()
    await page.locator('dialog[open]').getByTestId('undo-reason').fill('Eran dos locales distintos')
    await page.locator('dialog[open]').getByTestId('undo-confirm').click()
    await expect(notice(page)).toContainText('Fusión deshecha')
    await expect(page.getByTestId('merge-row').filter({ hasText: stays }).getByTestId('merge-undone')).toContainText('Eran dos locales distintos')
    await page.goto(`/comercios/${b}`)
    await expect(page.getByTestId('account-timeline')).toContainText('Nota del registro repetido')
    await expect(page.getByTestId('ficha-address')).toContainText('Cholula')
    await page.goto(`/comercios/${a}`)
    await expect(page.getByTestId('ficha-address')).toContainText('Puebla')
    expect(errors).toEqual([])
  })
})

test.describe('datos: jerarquía con agregados (DAT-01)', () => {
  test('un ISO con su agente y sus puntos de venta: tres niveles a la vista y lo que suma cada nodo, en inglés', async ({ page }) => {
    await loginAs(page, 'sam.ortiz')
    await page.goto(`/comercios/${await idOf('Lone Star Payments ISO')}?tab=arbol`)
    const totals = page.getByTestId('tree-totals')
    await expect(totals).toContainText('Active merchants')
    await expect(totals.getByTestId('node-active')).toHaveText('3')
    await expect(totals).toContainText('of 4 accounts')
    await expect(page.getByTestId('child-row')).toContainText(['Rio Grande Agents'])
    await page.getByTestId('child-row').first().click()
    await expect(page.getByTestId('child-row')).toHaveCount(2)
    await page.getByTestId('child-row').filter({ hasText: 'Frontera Wireless Laredo' }).click()
    // tercer nivel: el punto de venta ve a sus dos ancestros
    await expect(page.getByTestId('breadcrumb')).toContainText('Lone Star Payments ISO')
    await expect(page.getByTestId('breadcrumb')).toContainText('Rio Grande Agents')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/comercios/${await idOf('Lone Star Payments ISO')}?tab=arbol`)
    await clean(page, 'árbol con totales a 390')
  })

  test('mover una cuenta pide motivo y fecha; queda en la historia del árbol y la cuenta conserva a quien la lleva', async ({ page }) => {
    const child = await idOf('Súper La Colmena Sucursal Irapuato')
    await loginAs(page, 'paula.mendez')
    await page.goto(`/comercios/${child}?tab=datos`)
    const form = page.getByTestId('parent-form')
    await form.getByTestId('parent-select').selectOption({ label: 'Súper La Colmena' })
    await form.getByTestId('parent-reason').fill('La sucursal ya no reporta a la región')
    await form.getByTestId('parent-save').click()
    await expect(form.getByTestId('form-ok')).toContainText('Jerarquía actualizada')
    await fichaTab(page, 'arbol')
    await page.getByTestId('tree-moves').locator('summary').click()
    const moves = page.getByTestId('tree-move')
    await expect(moves).toHaveCount(2)
    await expect(moves.first()).toContainText('Súper La Colmena')
    await expect(moves.first().getByTestId('tree-move-reason')).toContainText('La sucursal ya no reporta a la región')
    await expect(page.getByTestId('account-facts')).toContainText('Diana Cruz')
    // de vuelta a su región, para no cambiar lo que ven las demás pruebas
    await fichaTab(page, 'datos')
    await page.getByTestId('parent-select').selectOption({ label: 'Súper La Colmena Región Bajío' })
    await page.getByTestId('parent-reason').fill('Vuelve a su región')
    await page.waitForTimeout(800)
    await page.getByTestId('parent-save').click()
    await expect(page.getByTestId('parent-form').getByTestId('form-ok')).toContainText('Jerarquía actualizada')
  })
})

test.describe('datos: contactos y alias (DAT-02, DAT-03)', () => {
  test('la misma persona en dos cuentas es un solo contacto; se edita, se cambia al principal y se da de baja desde la ficha', async ({ page }) => {
    const one = await rawAccount('MX', 'diana.cruz', `Farmacia Los Olivos ${uniq()}`)
    const two = await rawAccount('MX', 'diana.cruz', `Farmacia Los Olivos Norte ${uniq()}`)
    const tel = `55${Math.floor(10000000 + Math.random() * 89999999)}`
    await loginAs(page, 'diana.cruz')
    for (const [id, who] of [[one, 'Elena Ríos'], [two, 'Elena R.']] as const) {
      await page.goto(`/comercios/${id}?tab=datos`)
      await page.getByTestId('add-contact').click()
      await page.getByTestId('contact-name').fill(who)
      await page.getByTestId('contact-phone').fill(tel)
      await page.getByTestId('save-contact').click()
      await expect(page.getByTestId('contact-row')).toHaveCount(1)
    }
    // en la segunda cuenta no se duplicó: es la misma persona, con su nombre de siempre
    await expect(page.getByTestId('contact-row')).toContainText('Elena Ríos')
    await expect(page.getByTestId('contact-also')).toContainText('Farmacia Los Olivos')
    // un segundo contacto, y se le hace principal: queda la historia de quién lo fue
    await page.getByTestId('add-contact').click()
    await page.getByTestId('contact-name').fill('Raúl Montes')
    await page.waitForTimeout(800)
    await page.getByTestId('save-contact').click()
    await expect(page.getByTestId('contact-row')).toHaveCount(2)
    const raul = page.getByTestId('contact-row').filter({ hasText: 'Raúl Montes' })
    await raul.getByTestId('contact-edit').click()
    await page.locator('dialog[open]').getByTestId('contact-edit-name').fill('Raúl Montes Vera')
    await page.locator('dialog[open]').getByTestId('contact-edit-role').selectOption('decision_maker')
    await page.locator('dialog[open]').getByTestId('contact-edit-save').click()
    await expect(page.getByTestId('contact-row').filter({ hasText: 'Raúl Montes Vera' })).toContainText('Quien decide')
    await page.getByTestId('contact-row').filter({ hasText: 'Raúl Montes Vera' }).getByTestId('contact-make-primary').click()
    await expect(page.getByTestId('contact-row').filter({ hasText: 'Raúl Montes Vera' })).toContainText('Principal')
    await page.getByTestId('contact-history').locator('summary').click()
    await expect(page.getByTestId('primary-turn')).toHaveCount(2)
    await expect(page.getByTestId('primary-turn').first()).toContainText('Raúl Montes Vera')
    // baja de la que ya no es principal: sale de la lista y queda en la historia
    const elena = page.getByTestId('contact-row').filter({ hasText: 'Elena Ríos' })
    await elena.getByTestId('contact-end').click()
    await page.locator('dialog[open]').getByTestId('contact-end-reason').fill('Vendió su parte del negocio')
    await page.locator('dialog[open]').getByTestId('contact-end-save').click()
    await expect(page.getByTestId('contact-row')).toHaveCount(1)
    await page.getByTestId('contact-history').locator('summary').click()
    await expect(page.getByTestId('past-contact')).toContainText('Vendió su parte del negocio')
    // en la primera cuenta sigue siendo contacto
    await page.goto(`/comercios/${one}?tab=datos`)
    await expect(page.getByTestId('contact-row')).toContainText('Elena Ríos')
  })

  test('Operaciones agrega un ID de otro sistema, el comercio se encuentra por él, un choque se explica y el ID se cierra con historia', async ({ page }) => {
    const first = `Mueblería Encinos ${uniq()}`
    const one = await rawAccount('MX', 'marco.pena', first)
    const two = await rawAccount('MX', 'lucia.vega', `Mueblería Sauces ${uniq()}`)
    const ext = `ZH${uniq()}${uniq()}`.toUpperCase()
    await loginAs(page, 'valeria.soto', { stay: true })
    await page.goto(`/comercios/${one}?tab=datos`)
    await page.getByTestId('alias-add').click()
    await page.locator('dialog[open]').getByTestId('alias-system').selectOption('zoho')
    await page.locator('dialog[open]').getByTestId('alias-id').fill(ext)
    await page.locator('dialog[open]').getByTestId('alias-save').click()
    await expect(page.getByTestId('alias-value')).toHaveText(ext)
    await page.goto(`/buscar?q=${ext}`)
    await expect(page.locator('main')).toContainText(first)
    // el mismo ID en otro comercio: no entra y dice de quién es
    await page.goto(`/comercios/${two}?tab=datos`)
    await page.getByTestId('alias-add').click()
    await page.locator('dialog[open]').getByTestId('alias-system').selectOption('zoho')
    await page.locator('dialog[open]').getByTestId('alias-id').fill(ext)
    await page.locator('dialog[open]').getByTestId('alias-save').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText(`ya es de "${first}"`)
    // cerrar el ID: sale de los vigentes y queda en la historia
    await page.goto(`/comercios/${one}?tab=datos`)
    await page.getByTestId('alias-close').click()
    await page.locator('dialog[open]').getByTestId('alias-close-reason').fill('El comercio cambió de cuenta en Zoho')
    await page.locator('dialog[open]').getByTestId('alias-close-save').click()
    await expect(page.getByTestId('alias-value')).toHaveCount(0)
    await page.getByTestId('alias-history').locator('summary').click()
    await expect(page.getByTestId('alias-closed')).toContainText(ext)
    await expect(page.getByTestId('alias-closed')).toContainText('El comercio cambió de cuenta en Zoho')
    // quien vende ve los ID y no los cambia
    await loginAs(page, 'marco.pena')
    await page.goto(`/comercios/${one}?tab=datos`)
    await expect(page.getByTestId('account-aliases')).toBeVisible()
    await expect(page.getByTestId('alias-add')).toHaveCount(0)
  })
})

test.describe('datos: personas en un negocio (DAT-02)', () => {
  test('un contacto de la cuenta entra al negocio con su rol ahí y se puede quitar', async ({ page }) => {
    const acc = await rawAccount('MX', 'marco.pena', `Vidriería Fresnos ${uniq()}`)
    const marco = await personaId('marco.pena')
    const contact = (await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone, created_by) values ('MX', 'Nadia Peralta', ${`+5255${Math.floor(10000000 + Math.random() * 89999999)}`}, ${marco}) returning id`)[0]!.id
    await sql`insert into crm.account_contacts (account_id, contact_id, market_code, role, is_primary) values (${acc}, ${contact}, 'MX', 'owner', true)`
    const deal = (await sql<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due)
      select 'MX', p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'open' order by position limit 1), ${acc}, ${marco}, 'Alta Vidriería Fresnos', 'MXN', 'Llamar', now()::date + 3
        from crm.pipelines p where p.market_code = 'MX' and p.motor = 'd2d' returning id`)[0]!.id
    await loginAs(page, 'marco.pena')
    await page.goto(`/deals/${deal}`)
    const people = page.getByTestId('deal-people')
    await people.getByTestId('deal-person-contact').selectOption({ label: 'Nadia Peralta' })
    await people.getByTestId('deal-person-role').selectOption('billing')
    await people.getByTestId('deal-person-add').click()
    await expect(people.getByTestId('deal-person')).toContainText('Nadia Peralta')
    await expect(people.getByTestId('deal-person')).toContainText('Facturación')
    // en la cuenta sigue una sola vez, con su rol de cuenta
    await page.goto(`/comercios/${acc}?tab=datos`)
    await expect(page.getByTestId('contact-row')).toHaveCount(1)
    await expect(page.getByTestId('contact-row')).toContainText('Dueño del comercio')
    await page.goto(`/deals/${deal}`)
    await page.getByTestId('deal-person-remove').click()
    await expect(page.getByTestId('deal-person')).toHaveCount(0)
  })
})

test.describe('datos: campos, mercados y catálogos desde la pantalla (DAT-05, GOB-01)', () => {
  test('quien lidera el mercado propone un campo con su decisión; administración lo aprueba y lo edita en el registro', async ({ page }) => {
    const field = `Horario de surtido ${uniq()}`
    await loginAs(page, 'ana.robles', { stay: true })
    await page.goto('/datos?tab=campos')
    await page.getByTestId('field-propose').click()
    const dialog = page.locator('dialog[open]')
    await dialog.getByTestId('propose-label-es').fill(field)
    await dialog.getByTestId('propose-label-en').fill(`${field} en`)
    await dialog.getByTestId('field-decision').fill('Decide a qué hora se programa la entrega al comercio')
    await dialog.getByTestId('field-purpose').fill('Saber cuándo recibe mercancía')
    await dialog.getByTestId('propose-save').click()
    await expect(notice(page)).toContainText('Propuesta enviada')
    await page.goto('/datos?tab=campos&vista=propuestos')
    const mine = page.getByTestId('registry-row').filter({ hasText: field })
    await expect(mine).toContainText('Por decidir')
    await expect(mine.getByTestId('registry-approve')).toHaveCount(0)

    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/datos?tab=campos&vista=propuestos')
    await page.getByTestId('registry-row').filter({ hasText: field }).getByTestId('registry-approve').click()
    await expect(notice(page)).toContainText('Campo aprobado')
    await page.goto('/datos?tab=campos')
    const row = page.getByTestId('registry-row').filter({ hasText: field })
    await expect(row.getByTestId('registry-owner')).toHaveText('Ana Robles')
    await expect(row.getByTestId('registry-decision')).toContainText('Decide a qué hora se programa la entrega')
    await row.getByTestId('registry-edit').click()
    await page.locator('dialog[open]').getByTestId('field-label-es').fill(`${field} v2`)
    await page.locator('dialog[open]').getByTestId('field-pii').selectOption('personal')
    await page.locator('dialog[open]').getByTestId('registry-save').click()
    await expect(notice(page)).toContainText('Campo actualizado')
    await expect(page.getByTestId('registry-row').filter({ hasText: `${field} v2` })).toContainText('Dato personal')
    // los campos sin decisión documentada tienen su propia vista
    await page.getByTestId('pill-sin-decision').click()
    await expect(page.getByTestId('registry-row').first()).toContainText('Sin decisión documentada')
    await clean(page, 'registro de campos')
    // archivar: sale de las fichas y queda en Archivados
    await page.goto('/datos?tab=campos')
    await page.getByTestId('registry-row').filter({ hasText: `${field} v2` }).getByTestId('registry-archive').click()
    await expect(notice(page)).toContainText('Campo retirado')
    await page.goto('/datos?tab=campos&vista=archivados')
    await expect(page.getByTestId('registry-row').filter({ hasText: `${field} v2` })).toHaveCount(1)
  })

  test('administración agrega un mercado, un turno, un formulario, un sistema de ID y una lista de proceso sin migración', async ({ page }) => {
    const errors = pageErrors(page)
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/datos?tab=catalogos')
    // mercado nuevo: nace en preparación y no se abre sin embudo
    if ((await page.getByTestId('market-row').filter({ hasText: 'Colombia' }).count()) === 0) {
      await page.getByTestId('market-new').click()
      const m = page.locator('dialog[open]')
      await m.getByTestId('market-code').fill('co')
      await m.getByTestId('market-name').fill('Colombia')
      await m.getByTestId('market-currency').fill('cop')
      await m.getByTestId('market-timezone').fill('America/Bogota')
      await m.getByTestId('market-phone').fill('+57')
      await m.getByTestId('market-save').click()
      await expect(notice(page)).toContainText('Mercado agregado')
    }
    const co = page.getByTestId('market-row').filter({ hasText: 'Colombia' })
    await expect(co).toContainText('En preparación')
    await co.getByTestId('market-edit').click()
    await page.locator('dialog[open]').getByTestId('market-status').selectOption('live')
    await page.locator('dialog[open]').getByTestId('market-update').click()
    await expect(page.locator('dialog[open]').getByTestId('form-error')).toContainText('créale un embudo')
    await page.keyboard.press('Escape')

    // turno y formulario
    const rule = `Turno Bajío ${uniq()}`
    await page.getByTestId('rule-new').click()
    const r = page.locator('dialog[open]')
    await r.getByTestId('rule-name').fill(rule)
    await r.getByTestId('cat-market').selectOption('MX')
    await r.locator('[data-testid="rule-member"][data-market="MX"]').first().check()
    await r.getByTestId('rule-save').click()
    await expect(notice(page)).toContainText('Turno creado')
    await expect(page.getByTestId('rule-row').filter({ hasText: rule })).toHaveCount(1)
    const slug = `bajio-${uniq()}`
    await page.getByTestId('form-new').click()
    const f = page.locator('dialog[open]')
    await f.getByTestId('form-name').fill(`Formulario Bajío ${slug}`)
    await f.getByTestId('form-slug').fill(slug)
    await f.getByTestId('cat-market').selectOption('MX')
    await f.locator('select[name="routing_rule_id"]').selectOption({ label: `MX · ${rule}` })
    await f.getByTestId('form-save').click()
    await expect(notice(page)).toContainText('Formulario creado')
    await expect(page.getByTestId('form-row').filter({ hasText: slug })).toContainText(rule)
    // el formulario nuevo ya responde en su dirección pública
    const res = await page.request.get(`/f/${slug}`)
    expect(res.status()).toBe(200)

    // sistema de ID y niveles del árbol
    const system = `Operador Sierra ${uniq()}`
    await page.getByTestId('system-new').click()
    await page.locator('dialog[open]').getByTestId('system-label-es').fill(system)
    await page.locator('dialog[open]').getByTestId('system-label-en').fill(`${system} en`)
    await page.locator('dialog[open]').getByTestId('system-save').click()
    await expect(notice(page)).toContainText('Sistema agregado')
    await expect(page.getByTestId('system-row').filter({ hasText: system })).toHaveCount(1)
    await expect(page.locator('[data-testid="depth-row"][data-code="iso"]').getByTestId('depth-input')).toHaveValue('4')

    // lista de proceso: se crea y ya aparece en la ficha de un comercio de ese mercado
    const list = `Campaña de verano ${uniq()}`
    await page.getByTestId('process-new').click()
    const p = page.locator('dialog[open]')
    await p.getByTestId('process-name-es').fill(list)
    await p.getByTestId('process-name-en').fill(`${list} en`)
    await p.getByTestId('process-market').selectOption('MX')
    await p.getByTestId('process-statuses').fill('Invitado | Invited\nInscrito | Enrolled\nTerminó | Finished')
    await p.getByTestId('process-attributes').fill('Material entregado | Material delivered')
    await p.getByTestId('process-save').click()
    await expect(notice(page)).toContainText('Lista creada')
    await clean(page, 'mercados y catálogos')
    await page.goto(`/comercios/${await idOf('Súper La Colmena Sucursal Centro')}?tab=datos`)
    const item = page.getByTestId('process-item').filter({ hasText: list })
    await item.getByTestId('process-status').selectOption('enrolled')
    await item.getByTestId('process-attr').fill('Cartel y volantes')
    await item.getByTestId('process-status-save').click()
    await expect(page.getByTestId('process-item').filter({ hasText: list }).getByTestId('process-state')).toHaveText('Inscrito')
    await expect(page.getByTestId('process-item').filter({ hasText: list })).toContainText('Material entregado: Cartel y volantes')
    // la lista sembrada (capacitación) también está, con su estado
    await page.goto(`/comercios/${await idOf('Súper La Colmena Sucursal Irapuato')}?tab=datos`)
    await expect(page.getByTestId('process-item').filter({ hasText: 'Capacitación del comercio' }).getByTestId('process-state')).toHaveText('Por agendar')
    expect(errors).toEqual([])
  })
})

test.describe('datos: tablero de calidad (GOB-02)', () => {
  test('supervisión ve la calidad de su equipo, con responsable por regla, y del número llega a la cola que lo corrige', async ({ page }) => {
    await loginAs(page, 'fernando.ibarra')
    await page.getByTestId('me-menu').click()
    await page.getByTestId('nav-data').click()
    await expect(page).toHaveURL(/\/datos/)
    const board = page.getByTestId('quality-board')
    await expect(board).toBeVisible()
    const row = page.locator('[data-testid="quality-row"][data-rule="no_address"]')
    await expect(row).toContainText('Comercios sin dirección')
    await expect(row.getByTestId('quality-owner')).toHaveText('Supervisión')
    // supervisión no edita reglas ni ve las demás secciones
    await expect(page.getByTestId('quality-edit')).toHaveCount(0)
    await expect(page.getByTestId('pill-catalogos')).toHaveCount(0)
    await expect(page.getByTestId('pill-duplicados')).toHaveCount(0)
    await row.getByTestId('quality-open').click()
    const queue = page.getByTestId('quality-queue')
    await expect(queue).toContainText('Captura calle y ciudad en la ficha')
    await expect(queue.getByTestId('quality-queue-row').first()).toBeVisible()
    await queue.getByTestId('quality-queue-row').first().locator('a').click()
    await expect(page.getByTestId('account-data')).toBeVisible()
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height })
      await page.goto('/datos?tab=calidad&regla=no_address#cola')
      await expect(page.getByTestId('quality-board')).toBeVisible()
      await clean(page, `calidad a ${w.width}`)
    }
  })

  test('administración ve todos los mercados, la tendencia contra el corte anterior y cambia al responsable de una regla; en inglés para US', async ({ page }) => {
    // un corte de hace diez días con otro número: la tendencia lo compara con hoy
    await sql`insert into crm.quality_snapshots (as_of, market_code, team_id, rule_code, total, failing) values (now()::date - 10, 'MX', null, 'deal_no_step', 90, 999)
              on conflict do nothing`
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/datos?tab=calidad&mercado=MX')
    await expect(page.getByTestId('pill-MX')).toBeVisible()
    await expect(page.getByTestId('pill-US')).toBeVisible()
    await expect(page.locator('[data-testid="quality-row"][data-rule="deal_no_step"]').getByTestId('quality-trend')).toContainText('Bajó')
    await expect(page.locator('[data-testid="quality-row"][data-rule="no_phone"]').getByTestId('quality-trend')).toContainText('Sin corte anterior')
    const rule = page.locator('[data-testid="quality-row"][data-rule="no_coords"]')
    await rule.getByTestId('quality-edit').click()
    await page.locator('dialog[open]').getByTestId('quality-owner-person').selectOption({ label: 'Valeria Soto' })
    await page.locator('dialog[open]').getByTestId('quality-save').click()
    await expect(notice(page)).toContainText('Regla actualizada')
    await expect(page.locator('[data-testid="quality-row"][data-rule="no_coords"]').getByTestId('quality-owner')).toHaveText('Valeria Soto')
    // el corte de hoy se puede guardar a mano
    await page.getByTestId('quality-snapshot').click()
    await expect(notice(page)).toContainText('Corte de hoy guardado')
    // duplicados lleva a su cola
    await sql`select app.scan_duplicates('MX')`
    await page.reload()
    await page.locator('[data-testid="quality-row"][data-rule="duplicate"]').getByTestId('quality-open').click()
    await expect(page.getByTestId('pair-queue')).toBeVisible()

    await loginAs(page, 'kira.dunn')
    await page.goto('/datos')
    await expect(page.locator('main')).toContainText('Data quality')
    await expect(page.locator('[data-testid="quality-row"][data-rule="no_address"]')).toContainText('Merchants with no address')
    await expect(page.locator('[data-testid="quality-row"][data-rule="no_address"]').getByTestId('quality-owner')).toHaveText('Supervisors')
  })
})

test.describe('datos: productos por comercio (DAT-07)', () => {
  test('Operaciones ve en la ficha qué productos tiene el comercio y cuál lleva al proveedor fuera de plazo, y cambia el estado', async ({ page }) => {
    const pdv = await idOf('Frontera Wireless Laredo')
    await loginAs(page, 'tom.reyes', { stay: true })
    await page.goto(`/comercios/${pdv}?tab=datos`)
    const products = page.getByTestId('account-products')
    await expect(products.getByTestId('product-item')).toHaveCount(2)
    const late = products.getByTestId('product-item').filter({ hasText: 'Top-up card pack' })
    await expect(late.getByTestId('product-state')).toHaveText('Sent to the provider')
    await expect(late.getByTestId('product-late')).toContainText('Past the 28-day deadline')
    await expect(products.getByTestId('product-item').filter({ hasText: 'SIM kit' }).getByTestId('product-state')).toHaveText('Active')
    // la matriz, filtrada por fuera de plazo
    await page.goto('/datos?tab=productos')
    await page.getByTestId('provider-late').first().click()
    await expect(page).toHaveURL(/plazo=vencido/)
    await expect(page.getByTestId('matrix-row')).toHaveCount(1)
    await expect(page.getByTestId('matrix-row').filter({ hasText: 'Frontera Wireless Laredo' })).toContainText('Past deadline')
    await page.getByTestId('matrix-status').selectOption('active')
    await page.getByTestId('matrix-filter').locator('select[name="plazo"]').selectOption('')
    await page.getByTestId('matrix-filter').locator('select[name="proveedor"]').selectOption('')
    await page.getByTestId('matrix-apply').click()
    await expect(page).toHaveURL(/estado=active/)
    await expect(page.getByTestId('matrix-row').filter({ hasText: 'SIM kit' })).toContainText('Active')
    await clean(page, 'productos por comercio')
    // el proveedor responde: Operaciones lo marca aprobado y deja de estar fuera de plazo
    await page.goto(`/comercios/${pdv}?tab=datos`)
    const item = page.getByTestId('product-item').filter({ hasText: 'Top-up card pack' })
    await item.getByTestId('product-status').selectOption('approved')
    await item.getByTestId('product-status-save').click()
    await expect(page.getByTestId('product-item').filter({ hasText: 'Top-up card pack' }).getByTestId('product-state')).toHaveText('Approved')
    await expect(page.getByTestId('product-item').filter({ hasText: 'Top-up card pack' }).getByTestId('product-late')).toHaveCount(0)
    // base de expansión: a quién ofrecerle un producto que todavía no tiene
    await page.goto('/datos?tab=productos')
    await page.getByTestId('product-row').filter({ hasText: 'SIM kit' }).getByTestId('product-without').click()
    await expect(page.getByTestId('expansion-card')).toContainText('Who to offer SIM kit to')
    await expect(page.getByTestId('expansion-row').first()).toBeVisible()
    await expect(page.getByTestId('expansion-row').filter({ hasText: 'Frontera Wireless Laredo' })).toHaveCount(0)
    await page.goto(`/comercios/${pdv}?tab=datos`)
    // un producto nuevo para el comercio
    await page.getByTestId('product-add').click()
    await page.locator('dialog[open]').getByTestId('product-pick').selectOption({ label: 'Counter terminal' })
    await page.locator('dialog[open]').getByTestId('product-provider-pick').selectOption({ index: 1 })
    await page.locator('dialog[open]').getByTestId('product-save').click()
    await expect(page.getByTestId('product-item')).toHaveCount(3)
    // quien vende lo ve y no lo cambia
    await loginAs(page, 'sam.ortiz')
    await page.goto(`/comercios/${pdv}?tab=datos`)
    await expect(page.getByTestId('account-products').getByTestId('product-item')).toHaveCount(3)
    await expect(page.getByTestId('product-add')).toHaveCount(0)
    await expect(page.getByTestId('product-status-save')).toHaveCount(0)
  })

  test('administración pone el plazo de un proveedor y el proveedor de un producto', async ({ page }) => {
    await loginAs(page, 'nora.salas', { stay: true })
    await page.goto('/datos?tab=productos')
    const red = page.getByTestId('provider-row').filter({ hasText: 'Red Centro' })
    await red.getByTestId('provider-sla').fill('10')
    await red.getByTestId('provider-sla-save').click()
    await expect(notice(page)).toContainText('Plazo del proveedor actualizado')
    await page.reload()
    await expect(page.getByTestId('provider-row').filter({ hasText: 'Red Centro' }).getByTestId('provider-sla')).toHaveValue('10')
    const term = page.getByTestId('product-row').filter({ hasText: 'Terminal de mostrador' })
    await term.getByTestId('product-provider').selectOption({ label: 'Red Centro' })
    await term.getByTestId('product-provider-save').click()
    await expect(notice(page)).toContainText('Proveedor del producto actualizado')
  })
})

test.describe('datos: tres anchos y dos idiomas', () => {
  test('las secciones de Datos y lo nuevo de la ficha caben a 1440, 1024 y 390, sin hallazgos serios de accesibilidad, también en inglés', async ({ page }) => {
    // Nueve pantallas por tres anchos, cada una con su revisión de accesibilidad: no caben en el tiempo de una prueba normal.
    test.setTimeout(240_000)
    const errors = pageErrors(page)
    const pdv = await idOf('Frontera Wireless Laredo')
    const suc = await idOf('Súper La Colmena Sucursal Irapuato')
    await sql`select app.scan_duplicates('MX')`
    const pair = (await sql<{ id: string }[]>`select id from crm.duplicate_pairs where status = 'open' and market_code = 'MX' order by strong desc, score desc limit 1`)[0]!.id
    await loginAs(page, 'nora.salas', { stay: true })
    const pages: [string, string][] = [
      ['/datos?tab=calidad', 'quality-board'],
      [`/datos?tab=duplicados&mercado=MX&par=${pair}`, 'pair-compare'],
      ['/datos?tab=campos', 'fields-tab'],
      ['/datos?tab=campos&vista=sin-decision', 'registry-table'],
      ['/datos?tab=productos', 'products-tab'],
      ['/datos?tab=catalogos', 'catalogs-tab'],
      [`/comercios/${pdv}?tab=datos`, 'account-products'],
      [`/comercios/${suc}?tab=datos`, 'account-processes'],
      [`/comercios/${suc}?tab=arbol`, 'tree-totals'],
    ]
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height })
      for (const [url, testId] of pages) {
        await page.goto(url)
        await expect(page.getByTestId(testId).first()).toBeVisible()
        await clean(page, `${url} a ${w.width}`)
        // Capturas para revisar el diseño a ojo (solo si se pide con DATOS_SHOTS; no forman parte de la prueba).
        if (process.env.DATOS_SHOTS && w.width !== 1024) await page.screenshot({ path: `${process.env.DATOS_SHOTS}/${testId}-${w.width}.png`, fullPage: true })
      }
    }
    // en inglés, las mismas pantallas hablan inglés
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/datos?tab=catalogos')
    for (const text of ['Markets and catalogs', 'Web forms', 'Lead rotations', 'ID source systems', 'Tree levels by account type', 'Process lists by market']) await expect(page.locator('main')).toContainText(text)
    await page.goto(`/datos?tab=duplicados&mercado=MX&par=${pair}`)
    for (const text of ['Compare the two records', 'Pairs to decide', 'Skipped duplicate warnings', 'Recent merges']) await expect(page.locator('main')).toContainText(text)
    await page.goto('/datos?tab=campos')
    for (const text of ['Field registry', 'Decision it enables', 'Propose a field']) await expect(page.locator('main')).toContainText(text)
    await page.goto(`/comercios/${suc}?tab=datos`)
    for (const text of ['IDs in other systems', 'Processes', 'Merchant training', 'To schedule', 'Why is it moving?', 'Effective date']) await expect(page.getByTestId('account-data')).toContainText(text)
    await clean(page, 'ficha en inglés a 390')
    expect(errors).toEqual([])
  })
})
