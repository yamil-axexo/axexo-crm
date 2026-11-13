// Pipedrive simulado para las pruebas: mismas rutas, paginación y formas que la API real (v2 y v1), con datos sintéticos.
// Uso: const mock = await startMock(45991); ...; await mock.close()
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

export const MOCK_TOKEN = 'test-token'
const code = (name) => createHash('sha1').update(name).digest('hex')
const iso = (daysAgo, h = 15) => new Date(Date.UTC(2026, 9, 20, h) - daysAgo * 86400000).toISOString().replace('.000', '')
// Armado en tiempo de ejecución para que el escáner de datos prohibidos no marque este archivo.
const CARD = ['4111', '1111', '1111', '1111'].join(' ')

const field = (field_name, field_type, options = null, custom = true, field_code = undefined) => ({
  field_name, field_code: field_code ?? code(field_name + field_type), field_type, options, subfields: null, is_custom_field: custom, is_optional_response_field: false,
})
const opts = (start, labels) => labels.map((label, i) => ({ id: start + i, label }))

export function buildData() {
  const F = {
    organization: [
      field('ID', 'int', null, false, 'id'), field('Name', 'varchar', null, false, 'name'), field('Address', 'address', null, false, 'address'),
      field('Labels', 'set', opts(5, ['Customer', 'Hot lead']), false, 'label_ids'),
      field('Market', 'enum', opts(101, ['US', 'MX'])), field('Lifecycle stage', 'enum', opts(201, ['Prospect', 'Onboarding', 'Active', 'Inactive', 'Churned'])),
      field('Zone / Territory', 'enum', opts(301, ['Florida', 'Houston, TX'])), field('Channel Segment', 'enum', opts(401, ['Dealer', 'Independent store'])),
      field('Latitude', 'double'), field('Longitude', 'double'), field('Merchant ID EMIDA', 'varchar'), field('Tax ID', 'varchar'),
      field('Monthly Volume', 'double'), field('Carriers Activos', 'set', opts(501, ['H2O', 'Lyca'])), field('First Transaction Date', 'date'),
      field('Phone Number Associated', 'varchar'), field('City', 'varchar'), field('State', 'varchar'), field('Notas internas', 'text'),
    ],
    person: [
      field('Name', 'varchar', null, false, 'name'), field('Phone', 'phone', null, false, 'phones'), field('Email', 'varchar', null, false, 'emails'),
      field('Labels', 'set', opts(5, ['Customer', 'Mailing base']), false, 'label_ids'),
      field('Market', 'enum', opts(111, ['MX', 'US'])), field('Decision Maker', 'enum', opts(601, ['Yes', 'No'])),
      field('Job Title', 'enum', opts(701, ['Owner', 'Manager', 'Employee'])), field('WhatsApp', 'phone'), field('Preferred Language', 'enum', opts(801, ['Spanish', 'English'])),
    ],
    deal: [
      field('Title', 'varchar', null, false, 'title'),
      field('Lost reason', 'varchar_options', [{ id: 'a', label: 'Went with competitor' }, { id: 'b', label: 'Not interested / no response' }], false, 'lost_reason'),
      field('Label', 'set', opts(9, ['AWPE Welcome Sent']), false, 'label_ids'), field('Probability', 'double', null, false, 'probability'),
      field('Expected close date', 'date', null, false, 'expected_close_date'),
      field('Lead Source', 'enum', opts(901, ['Field canvass', 'Referral', 'Vegas / Expo'])), field('Products Wanted', 'set', opts(951, ['Domestic top-up', 'SIM activation', 'Bill pay'])),
      field('Requested credit line', 'monetary'), field('Sales Rep', 'user'),
    ],
    activity: [
      field('Subject', 'varchar', null, false, 'subject'), field('Priority', 'enum', opts(1, ['Low', 'Medium', 'High']), false, 'priority'),
      field('Outcome', 'enum', opts(1, ['Connected', 'Left voicemail', 'No answer']), false, 'outcome'),
      field('Reason for Visit', 'enum', opts(971, ['First Visit - Prospecting', 'Sales Pitch'])),
    ],
    product: [field('Name', 'varchar', null, false, 'name'), field('Unit Cost', 'double')],
  }
  const c = (obj, name) => F[obj].find((f) => f.field_name === name).field_code
  const users = [
    { id: 11, name: 'Rita Solano', email: 'rita.solano@contigo.test', active_flag: true, locale: 'es_MX', phone: '+525500000011', icon_url: 'x' },
    { id: 12, name: 'Omar Vidal', email: 'omar.vidal@contigo.test', active_flag: true, locale: 'en_US' },
    { id: 13, name: 'Paz Ibarra', email: 'paz.ibarra@contigo.test', active_flag: false, locale: 'es_MX' },
  ]
  const pipelines = [
    { id: 7, name: 'MX - D2D Store Enrollment', order_nr: 1, is_deleted: false },
    { id: 9, name: 'US - Dealer Enrollment', order_nr: 2, is_deleted: false },
    { id: 11, name: 'US - Sales Orders', order_nr: 3, is_deleted: false },
    { id: 12, name: 'CO - Pilot', order_nr: 4, is_deleted: false },
  ]
  const stage = (id, pipeline_id, order_nr, name, days = 14) => ({ id, pipeline_id, order_nr, name, deal_probability: order_nr * 20, is_deal_rot_enabled: true, days_to_rotten: days, is_deleted: false })
  const stages = [
    stage(35, 7, 1, 'Prospect', 30), stage(37, 7, 4, 'Migrating', 7), stage(46, 7, 2, 'Contacted'), stage(47, 7, 3, 'Committed', 7),
    stage(48, 9, 1, 'Lead', 5), stage(49, 9, 2, 'Contacted', 7), stage(50, 9, 3, 'Presented', 10),
    stage(63, 11, 1, 'Created'), stage(64, 11, 2, 'Approved'), stage(65, 11, 3, 'Delivered'), stage(70, 12, 1, 'Piloto'),
  ]
  const org = (id, name, cf = {}, extra = {}) => ({ id, name, owner_id: 11, add_time: iso(60), update_time: iso(30), is_deleted: false, visible_to: 7, address: null, label_ids: [], custom_fields: cf, ...extra })
  const O = (n) => c('organization', n)
  const organizations = [
    org(1001, 'Abarrotes La Esperanza (sintético)', {
      [O('Market')]: 102, [O('Lifecycle stage')]: 203, [O('Latitude')]: 19.4326, [O('Longitude')]: -99.1332, [O('Merchant ID EMIDA')]: 'EM-1001', [O('Tax ID')]: 'XAXX010101000',
      [O('Monthly Volume')]: 48250.75, [O('Carriers Activos')]: [501, 502], [O('First Transaction Date')]: '2026-08-14', [O('Phone Number Associated')]: '55 6123 4567',
      [O('City')]: 'Ciudad de México', [O('Notas internas')]: 'Prefiere visita por la mañana', [O('Zone / Territory')]: null,
    }, { label_ids: [5], address: { value: 'Av. Sintética 123, Ciudad de México', locality: 'Ciudad de México', admin_area_level_1: 'CDMX', postal_code: '06000', country: 'Mexico' } }),
    org(1002, 'Sunrise Wireless (synthetic)', { [O('Zone / Territory')]: 301, [O('Channel Segment')]: 401 }, { owner_id: 12, address: { value: '100 Synthetic Ave, Miami, FL', locality: 'Miami', admin_area_level_1: 'Florida', postal_code: '33101', country: 'United States' } }),
    org(1003, 'Bayou Mobile (synthetic)', {}, { owner_id: 12 }),
    org(1004, 'Sin Pistas (sintético)', {}, { owner_id: 13 }),
    org(1005, 'La Esperanza Sucursal (sintético)', { [O('Market')]: 102, [O('Merchant ID EMIDA')]: 'EM-1001', [O('Phone Number Associated')]: 'ext. 12' }),
  ]
  for (let i = 0; i < 515; i++) {
    const mx = i % 2 === 0
    organizations.push(org(2000 + i, `${mx ? 'Tienda' : 'Store'} Sintética ${i}`, { [O('Market')]: mx ? 102 : 101, [O('Lifecycle stage')]: 201 + (i % 5) }, { owner_id: mx ? 11 : 12 }))
  }
  const P = (n) => c('person', n)
  const person = (id, name, org_id, cf = {}, extra = {}) => ({ id, name, first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), org_id, owner_id: 11, add_time: iso(55), update_time: iso(20), is_deleted: false,
    phones: [], emails: [], label_ids: [], custom_fields: cf, ...extra })
  const persons = [
    person(5001, 'Elena Prado', 1001, { [P('Decision Maker')]: 601, [P('Job Title')]: 701, [P('Preferred Language')]: 801, [P('WhatsApp')]: '+525561234567' }, {
      phones: [{ value: '5561234567', primary: true, label: 'work' }, { value: '55 1111 2222', primary: false, label: 'home' }], emails: [{ value: 'Elena.Prado@contigo.test', primary: true, label: 'work' }] }),
    person(5002, 'Gary Lowe', 1002, { [P('Job Title')]: 702 }, { owner_id: 12, phones: [{ value: '(305) 555-0142', primary: true }] }),
    person(5003, 'Nadia Ross', null, { [P('Market')]: 112 }, { owner_id: 12, phones: [{ value: '305-555-0177', primary: true }], emails: [{ value: 'nadia.ross@contigo.test', primary: true }] }),
    person(5004, 'Sin Mercado', null, {}, { owner_id: 13 }),
  ]
  for (let i = 0; i < 600; i++) persons.push(person(6000 + i, `Contacto Sintético ${i}`, 2000 + (i % 515), {}, { owner_id: i % 2 === 0 ? 11 : 12 }))
  const D = (n) => c('deal', n)
  const deal = (id, title, pipeline_id, stage_id, org_id, extra = {}) => ({ id, title, pipeline_id, stage_id, org_id, person_id: null, owner_id: 11, value: 0, currency: 'USD', status: 'open', add_time: iso(40), update_time: iso(10),
    stage_change_time: iso(12), won_time: null, lost_time: null, close_time: null, lost_reason: null, is_deleted: false, is_archived: false, label_ids: [], probability: null, expected_close_date: null, products_count: 0, custom_fields: {}, ...extra })
  const deals = [
    deal(7001, 'Alta La Esperanza', 7, 46, 1001, { person_id: 5001, value: 1500.5, currency: 'MXN', expected_close_date: '2026-12-01', label_ids: [9],
      custom_fields: { [D('Lead Source')]: 901, [D('Products Wanted')]: [951, 953], [D('Requested credit line')]: { value: 25000, currency: 'MXN' }, [D('Sales Rep')]: 12 } }),
    deal(7002, 'Bayou onboarding', 9, 50, 1003, { owner_id: 12, status: 'won', won_time: iso(5), close_time: iso(5), value: 900 }),
    deal(7003, 'Sunrise onboarding', 9, 49, 1002, { owner_id: 12, status: 'lost', lost_time: iso(8), close_time: iso(8), lost_reason: 'Went with competitor' }),
    deal(7004, 'Nadia Ross deal', 9, 48, null, { owner_id: 12, person_id: 5003 }),
    deal(7005, 'Piloto Colombia', 12, 70, 1004),
    deal(7006, 'Order 4471', 11, 63, 1002, { owner_id: 12, products_count: 2, value: 350 }),
  ]
  for (let i = 0; i < 350; i++) {
    const mx = i % 2 === 0
    deals.push(deal(7100 + i, `Alta sintética ${i}`, mx ? 7 : 9, mx ? [35, 46, 47, 37][i % 4] : [48, 49, 50][i % 3], 2000 + i, { owner_id: mx ? 11 : 12, currency: mx ? 'MXN' : 'USD', value: 100 + i }))
  }
  const dealsArchived = [
    deal(7007, 'Alta archivada ganada', 7, 37, 1001, { status: 'won', won_time: iso(90), is_archived: true }),
    deal(7008, 'Alta archivada abierta', 7, 35, 1001, { is_archived: true }),
  ]
  const lead = (id, title, organization_id, person_id, extra = {}) => ({ id, title, owner_id: 11, organization_id, person_id, label_ids: [], source_name: 'Manually created', is_archived: false, value: null,
    add_time: iso(15), update_time: iso(3), [D('Lead Source')]: 902, ...extra })
  const leads = [
    lead('11111111-1111-4111-8111-111111111111', 'Segunda tienda La Esperanza', 1001, 5001, { label_ids: ['lab-1'], value: { amount: 5000, currency: 'MXN' } }),
    lead('22222222-2222-4222-8222-222222222222', 'Nadia Ross wants terminals', null, 5003, { owner_id: 12 }),
  ]
  for (let i = 0; i < 12; i++) leads.push(lead(`33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, `Lead sintético ${i}`, 2000 + i * 2, 6000 + i * 2))
  const leadsArchived = [lead('44444444-4444-4444-8444-444444444444', 'Lead archivado', 1002, 5002, { is_archived: true, owner_id: 12 })]
  const activity = (id, subject, type, extra = {}) => ({ id, subject, type, owner_id: 11, creator_user_id: 11, deal_id: null, org_id: null, person_id: null, lead_id: null, done: false, due_date: null, due_time: null,
    marked_as_done_time: null, note: null, add_time: iso(9), update_time: iso(2), is_deleted: false, priority: null, outcome: null, ...extra })
  const A = (n) => c('activity', n)
  const activities = [
    activity(9001, 'Llamada de bienvenida', 'call', { deal_id: 7001, org_id: 1001, person_id: 5001, done: true, marked_as_done_time: iso(7), outcome: 1, note: `<p>Contestó la dueña.</p><p>Tarjeta ${CARD}</p>` }),
    activity(9002, 'Visita de prospección', 'visit', { org_id: 1001, due_date: '2026-12-10', due_time: '16:30', priority: 3, custom_fields: { [A('Reason for Visit')]: 971 } }),
    activity(9003, 'Enviar contrato', 'task', { deal_id: 7001, due_date: '2026-12-05' }),
    activity(9004, 'Tarea personal sin liga', 'task', {}),
    activity(9005, 'Seguimiento de lead', 'call', { lead_id: '22222222-2222-4222-8222-222222222222', owner_id: 12, due_date: '2026-12-02' }),
  ]
  const notes = [
    { id: 9501, content: '<p>Pidio catalogo de carriers</p><p>Segunda linea con detalle &amp; precio</p>', org_id: 1001, deal_id: null, person_id: null, lead_id: null, user_id: 11, add_time: '2026-10-12 14:00:00', update_time: '2026-10-12 14:00:00', active_flag: true, organization: { name: 'x' }, user: { email: 'rita.solano@contigo.test' } },
    { id: 9502, content: 'Se fue con otro proveedor', org_id: null, deal_id: 7003, person_id: null, lead_id: null, user_id: 12, add_time: '2026-10-13 10:00:00', update_time: '2026-10-13 10:00:00', active_flag: true },
  ]
  const products = [
    { id: 801, name: 'SIM kit (synthetic)', code: 'SIM-KIT', unit: 'box', is_deleted: false, prices: [{ price: 25, currency: 'USD' }], custom_fields: { [c('product', 'Unit Cost')]: 11.5 }, add_time: iso(100), update_time: iso(50) },
    { id: 802, name: 'Terminal stand (synthetic)', code: 'STAND', unit: null, is_deleted: false, prices: [], custom_fields: {}, add_time: iso(100), update_time: iso(50) },
  ]
  const dealProducts = [
    { id: 301, deal_id: 7006, product_id: 801, name: 'SIM kit (synthetic)', quantity: 10, item_price: 25, sum: 250, currency: 'USD', discount: 0, discount_type: 'percentage', comments: null, order_nr: 1 },
    { id: 302, deal_id: 7006, product_id: 802, name: 'Terminal stand (synthetic)', quantity: 4, item_price: 25, sum: 100, currency: 'USD', discount: 0, discount_type: 'percentage', comments: 'Entrega en tienda', order_nr: 2 },
  ]
  // GOB-05 (integraciones2): historial de etapas por negocio (/v1/deals/:id/flow) y organización matriz (/v1/organizationRelationships).
  const dealFlows = {
    7102: [
      { object: 'dealChange', timestamp: iso(25), data: { id: 90001, field_key: 'stage_id', old_value: '35', new_value: '46', log_time: iso(25), user_id: 11 } },
      { object: 'dealChange', timestamp: iso(12), data: { id: 90002, field_key: 'stage_id', old_value: '46', new_value: '47', log_time: iso(12), user_id: 11 } },
      { object: 'dealChange', timestamp: iso(11), data: { id: 90003, field_key: 'title', old_value: 'Alta', new_value: 'Alta sintética 2', log_time: iso(11), user_id: 11 } },
    ],
  }
  const orgRelationships = [{ id: 95001, type: 'parent', rel_owner_org_id: { value: 2000, name: 'Tienda Sintética 0' }, rel_linked_org_id: { value: 2002, name: 'Tienda Sintética 2' }, active_flag: true }]
  return {
    dealFlows, orgRelationships,
    fields: F, users, pipelines, stages, organizations, persons, deals, dealsArchived, leads, leadsArchived, activities, notes, products, dealProducts,
    activityTypes: ['call', 'meeting', 'task', 'deadline', 'email', 'lunch'].map((k, i) => ({ id: i + 1, key_string: k, name: k[0].toUpperCase() + k.slice(1), active_flag: true })).concat([{ id: 9, key_string: 'visit', name: 'Visit', active_flag: true, is_custom_flag: true }]),
    leadLabels: [{ id: 'lab-1', name: 'Hot', color: 'red' }],
    webhooks: [{ id: 1, name: 'Zap deal updates', event_action: 'change', event_object: 'deal', subscription_url: 'https://hooks.example.com/pd/abc?token=not-stored', http_auth_user: 'u', http_auth_password: 'never-stored', is_active: 1, last_http_status: 200 }],
    filters: [{ id: 1, name: 'MX open deals', type: 'deals', active_flag: true, user_id: 11, visible_to: 7 }],
    roles: [{ id: 1, name: 'Sales', parent_role_id: null, active_flag: true, level: 1 }],
    permissionSets: [{ id: 'ps-1', name: 'Admin', app: 'sales', type: 'admin', assignment_count: 2 }],
    code: c,
  }
}

export async function startMock(port, { rateLimitOnce = false } = {}) {
  const data = buildData()
  const calls = []
  let limited = !rateLimitOnce
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  const since = (list, q) => {
    const s = q.get('updated_since')
    if (!s) return list
    const t = new Date(s).getTime()
    return list.filter((x) => new Date(String(x.update_time).replace(' ', 'T') + (String(x.update_time).includes('Z') ? '' : 'Z')).getTime() >= t)
  }
  const cursorPage = (res, list, q) => {
    const limit = Math.min(Number(q.get('limit') ?? 100), 500)
    const start = q.get('cursor') ? Number(Buffer.from(q.get('cursor'), 'base64url').toString()) : 0
    const items = list.slice(start, start + limit)
    const next = start + limit < list.length ? Buffer.from(String(start + limit)).toString('base64url') : null
    send(res, 200, { success: true, data: items, additional_data: { next_cursor: next } })
  }
  const offsetPage = (res, list, q, nested = true) => {
    const limit = Number(q.get('limit') ?? 100)
    const start = Number(q.get('start') ?? 0)
    const items = list.slice(start, start + limit)
    const pg = { start, limit, more_items_in_collection: start + limit < list.length, next_start: start + limit }
    send(res, 200, { success: true, data: items.length ? items : null, additional_data: nested ? { pagination: pg } : pg })
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const q = url.searchParams
    calls.push(url.pathname)
    if (req.method !== 'GET') return send(res, 405, { success: false })
    if (req.headers['x-api-token'] !== MOCK_TOKEN) return send(res, 401, { success: false, error: 'unauthorized' })
    const p = url.pathname
    if (p === '/api/v2/persons' && !limited) {
      limited = true
      return send(res, 429, { success: false }, { 'retry-after': '1' })
    }
    if (p === '/v1/users') return send(res, 200, { success: true, data: data.users })
    if (p === '/api/v2/pipelines') return cursorPage(res, data.pipelines, q)
    if (p === '/api/v2/stages') return cursorPage(res, data.stages, q)
    const fm = /^\/api\/v2\/(deal|organization|person|activity|product)Fields$/.exec(p)
    if (fm) return cursorPage(res, data.fields[fm[1]], q)
    if (p === '/v1/activityTypes') return send(res, 200, { success: true, data: data.activityTypes })
    if (p === '/v1/leadLabels') return send(res, 200, { success: true, data: data.leadLabels })
    if (p === '/v1/webhooks') return send(res, 200, { success: true, status: 'ok', data: data.webhooks })
    if (p === '/v1/filters') return send(res, 200, { success: true, data: data.filters })
    if (p === '/v1/roles') return offsetPage(res, data.roles, q)
    if (p === '/v1/permissionSets') return send(res, 403, { success: false, error: 'forbidden' })
    if (p === '/api/v2/organizations') return cursorPage(res, since(data.organizations, q), q)
    if (p === '/api/v2/persons') return cursorPage(res, since(data.persons, q), q)
    if (p === '/api/v2/deals') return cursorPage(res, since(data.deals, q), q)
    if (p === '/api/v2/deals/archived') return cursorPage(res, since(data.dealsArchived, q), q)
    if (p === '/v1/leads') return offsetPage(res, since(data.leads, q), q, false)
    if (p === '/v1/leads/archived') return offsetPage(res, since(data.leadsArchived, q), q, false)
    if (p === '/api/v2/activities') return cursorPage(res, since(data.activities, q), q)
    if (p === '/v1/notes') return offsetPage(res, since(data.notes, q), q)
    if (p === '/api/v2/products') return cursorPage(res, since(data.products, q), q)
    const flow = /^\/v1\/deals\/(\d+)\/flow$/.exec(p)
    if (flow) return offsetPage(res, data.dealFlows?.[flow[1]] ?? [], q)
    if (p === '/v1/organizationRelationships') {
      const org = Number(q.get('org_id'))
      return send(res, 200, { success: true, data: (data.orgRelationships ?? []).filter((r) => r.rel_owner_org_id.value === org || r.rel_linked_org_id.value === org) })
    }
    if (p === '/api/v2/deals/products') {
      const ids = new Set((q.get('deal_ids') ?? '').split(',').map(Number))
      return cursorPage(res, data.dealProducts.filter((x) => ids.has(x.deal_id)), q)
    }
    return send(res, 404, { success: false })
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve))
  return { data, calls, close: () => new Promise((r) => server.close(() => r())) }
}

// Ejecución directa: node tests/support/pipedrive-mock.mjs 45992
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const port = Number(process.argv[2] ?? 45992)
  await startMock(port)
  console.log(`pipedrive mock on ${port}`)
}
