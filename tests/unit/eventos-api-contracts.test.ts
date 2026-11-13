import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { apiDoc, domainEventsDoc, openApiDoc, salesAppMatrixDoc, salesAppSchemas } from '@/domain/contracts-doc'
import { decide, eventCatalog, eventSchema, silentActions } from '@/domain/events/catalog'
import { AUDIT_ACTION } from '@/lib/audit'
import { API_RESOURCES, READ_SCOPES, openApi } from '@/domain/api-spec'
import { JOBS } from '@/server/jobs/registry'

const dir = new URL('../../docs/contracts/', import.meta.url)
const update = process.env.UPDATE_CONTRACTS === '1'
const same = (name: string, content: string) => {
  const file = new URL(name, dir)
  if (update || !existsSync(file)) writeFileSync(file, content)
  expect(readFileSync(file, 'utf8'), `${name} is stale: run UPDATE_CONTRACTS=1 pnpm vitest run tests/unit/eventos-api-contracts.test.ts`).toBe(content)
}

describe('contratos generados (AUT-02, AUT-04, CAMPO-01)', () => {
  it('docs/contracts está al día con el código', () => {
    same('domain-events-v1.md', domainEventsDoc())
    same('api-v1.md', apiDoc())
    same('api-v1.openapi.json', openApiDoc())
    same('sales-app-events-v1.schema.json', salesAppSchemas())
    const file = new URL('sales-app-events-v1.md', dir)
    const md = readFileSync(file, 'utf8')
    const block = salesAppMatrixDoc()
    const a = md.indexOf('<!-- generated:matrix:start -->')
    const b = md.indexOf('<!-- generated:matrix:end -->')
    const next = a >= 0 && b > a ? md.slice(0, a) + block + md.slice(b + '<!-- generated:matrix:end -->'.length) : md.trimEnd() + '\n\n' + block + '\n'
    if (update || a < 0) writeFileSync(file, next)
    expect(readFileSync(file, 'utf8')).toBe(next)
  })

  it('cada acción de la bitácora está en la lista: emite un evento o dice por qué no', () => {
    const actions = Object.keys(AUDIT_ACTION)
    const unclassified = actions.filter((a) => {
      const d = decide(a)
      return d.emit === false && d.unclassified
    })
    expect(unclassified, 'clasifica estas acciones en src/domain/events/catalog.ts (DOMAIN o SILENT)').toEqual([])
    // Lo que el comité echó en falta ahora emite: actividades, edición de comercio y contactos, campos del negocio,
    // cola de Operaciones, territorios, accesos y configuración.
    for (const a of ['activity.added', 'activity.completed', 'account.updated', 'contact.added', 'deal.updated', 'deal.custom_updated', 'deal.handed_to_ops', 'deal.ops_taken',
      'deal.returned_to_sales', 'territory.created', 'account.territory_set', 'membership.granted', 'membership.ended', 'pipeline.configured', 'stage.updated', 'routing.members_changed']) {
      expect(decide(a).emit, a).toBe('auto')
    }
    for (const a of ['session.started', 'report.exported', 'integration.visit_received', 'api_client.created', 'import.started']) expect(decide(a).emit, a).toBe(false)
    expect(silentActions().every((s) => s.why[0].length > 20 && s.why[1].length > 20)).toBe(true)
  })

  it('el catálogo no repite eventos, todos llevan versión, ejemplo y esquema, y los nombres no usan guiones largos', () => {
    const cat = eventCatalog()
    expect(new Set(cat.map((e) => e.type)).size).toBe(cat.length)
    expect(cat.length).toBeGreaterThan(60)
    for (const e of cat) {
      expect(e.version, e.type).toBeGreaterThanOrEqual(1)
      const required = (eventSchema(e).properties as { data: { required: string[] } }).data.required
      for (const k of required) expect(e.example, `${e.type}.${k}`).toHaveProperty(k)
      expect(`${e.about[0]}${e.about[1]}`).not.toMatch(/[—–]/)
    }
  })

  it('la API documenta lo que sirve: un permiso por recurso y OpenAPI con todas las rutas', () => {
    const doc = openApi() as { paths: Record<string, unknown> }
    expect(Object.keys(doc.paths).sort()).toEqual(['/api/v1/accounts', '/api/v1/activities', '/api/v1/catalogs', '/api/v1/deals', '/api/v1/leads'])
    expect(API_RESOURCES.map((r) => r.scope).every((s) => (READ_SCOPES as readonly string[]).includes(s))).toBe(true)
    // Ningún recurso expone datos de contacto ni texto libre de notas.
    const fields = API_RESOURCES.flatMap((r) => r.fields.map((f) => f.name))
    for (const banned of ['phone', 'email', 'contact_name', 'message', 'subject', 'body', 'note']) expect(fields).not.toContain(banned)
  })

  it('los jobs del paquete tienen llave, frecuencia y descripción en los dos idiomas', () => {
    for (const j of JOBS.filter((x) => x.key.startsWith('eventos-api.'))) {
      expect(j.everyMinutes).toBeGreaterThan(0)
      expect(j.description.es.length).toBeGreaterThan(10)
      expect(j.description.en.length).toBeGreaterThan(10)
    }
  })
})
