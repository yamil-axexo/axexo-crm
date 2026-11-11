import { afterAll, describe, expect, it } from 'vitest'
import { owner } from './helpers'
import { withoutUser } from '@/server/db'
import { createHash } from 'node:crypto'

// El login con Google termina en estas funciones SECURITY DEFINER. Se prueban con el rol de la aplicación y sin identidad,
// igual que las llama /auth/callback: así un tipo o una tabla fuera de su search_path falla aquí y no en staging.
const admin = owner()
afterAll(() => admin.end())
const sso = async (email: string, bootstrap: boolean) =>
  (await withoutUser((tx) => tx<{ id: string | null }[]>`select app.sso_user(${email}, ${'sub-' + email}, ${'Persona Prueba'}, ${bootstrap}) as id`))[0]!.id
const tag = Math.random().toString(36).slice(2, 8)

describe('login con SSO (AUTHZ-01, AUTHZ-02)', () => {
  it('quien no existe y no es admin inicial no entra, y no se crea nada', async () => {
    const email = `nadie.${tag}@contigo.test`
    expect(await sso(email, false)).toBeNull()
    expect((await admin`select 1 from crm.users where email = ${email}`).length).toBe(0)
  })

  it('el admin inicial se crea con rol admin y queda en la bitácora; entrar otra vez no duplica', async () => {
    const email = `Admin.${tag}@contigo.test`
    const id = await sso(email, true)
    expect(id).toBeTruthy()
    expect(await sso(email.toLowerCase(), true)).toBe(id)
    const roles = await admin`select role, market_code from crm.memberships where user_id = ${id}`
    expect(roles.map((r) => [r.role, r.market_code])).toEqual([['admin', null]])
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'user.bootstrap_admin'`).length).toBe(1)
    expect((await admin`select email::text, auth_subject from crm.users where id = ${id}`)[0]).toMatchObject({ email: email.toLowerCase() })
  })

  it('una persona que ya existe entra con su correo en cualquier combinación de mayúsculas; si es admin inicial, sube a admin', async () => {
    const existing = (await admin`select id, email::text from crm.users where email = 'marco.pena@contigo.test'`)[0]!
    expect(await sso('Marco.Pena@CONTIGO.test', false)).toBe(existing.id)
    expect((await admin`select 1 from crm.memberships where user_id = ${existing.id} and role = 'admin'`).length).toBe(0)
    const imported = (await admin`insert into crm.users (email, full_name) values (${`importada.${tag}@contigo.test`}, 'Importada Antes') returning id`)[0]!
    expect(await sso(`importada.${tag}@contigo.test`, true)).toBe(imported.id)
    expect((await admin`select 1 from crm.memberships where user_id = ${imported.id} and role = 'admin' and valid_to is null`).length).toBe(1)
  })

  it('la sesión SSO se crea, se resuelve y se cierra con el rol de la aplicación', async () => {
    const id = await sso(`sesion.${tag}@contigo.test`, true)
    const hash = createHash('sha256').update(`token-${tag}`).digest('hex')
    await withoutUser((tx) => tx`select app.session_create(${id}, ${hash}, 'sso', ${12})`)
    expect((await withoutUser((tx) => tx<{ id: string }[]>`select app.session_user(${hash}) as id`))[0]!.id).toBe(id)
    await withoutUser((tx) => tx`select app.session_delete(${hash})`)
    expect((await withoutUser((tx) => tx<{ id: string | null }[]>`select app.session_user(${hash}) as id`))[0]!.id).toBeNull()
  })

  it('las funciones públicas de entrada responden con el rol de la aplicación', async () => {
    expect((await withoutUser((tx) => tx`select * from app.form_public('contacto-mx')`)).length).toBe(1)
    expect((await withoutUser((tx) => tx`select * from app.api_client('no-existe')`)).length).toBe(0)
    expect((await withoutUser((tx) => tx<{ ok: boolean }[]>`select app.demo_personas_enabled() as ok`))[0]!.ok).toBe(true)
    expect((await withoutUser((tx) => tx`select * from app.persona_list()`)).length).toBeGreaterThan(5)
  })
})
