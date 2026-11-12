import { beforeAll, expect } from 'vitest'
import postgres from 'postgres'

/**
 * Cada archivo de tests/db parte de la misma base recién sembrada, sin importar qué corrió antes ni en qué orden.
 * global-setup.ts migra y siembra una vez y deja una copia intacta (`<base>_tpl`); aquí, antes de cada archivo, la base
 * de pruebas se vuelve a crear a partir de esa copia (un `create database ... template`, que tarda una fracción de segundo).
 * Así un archivo no ve las personas, los embudos importados ni los negocios que dejó otro, y no hace falta fijar el orden.
 * Las pruebas de tests/unit no tocan la base y no pasan por aquí.
 */
const url = new URL(process.env.UNIT_MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_unit')
const db = url.pathname.slice(1)
export const templateOf = (name: string) => `${name}_tpl`

beforeAll(async () => {
  const file = expect.getState().testPath ?? ''
  if (!file.includes('/tests/db/')) return
  const maintenance = new URL(url.href)
  maintenance.pathname = '/postgres'
  const sql = postgres(maintenance.href, { max: 1, onnotice: () => {} })
  try {
    // Los ajustes por rol y base (por ejemplo, jit apagado para contigo_app, migración 0011) no viajan con la copia: se vuelven a poner.
    const settings = await sql<{ role: string; config: string[] }[]>`
      select r.rolname as role, s.setconfig as config from pg_db_role_setting s
        join pg_roles r on r.oid = s.setrole join pg_database d on d.oid = s.setdatabase where d.datname = ${templateOf(db)}`
    await sql.unsafe(`drop database if exists "${db}" with (force)`)
    await sql.unsafe(`create database "${db}" template "${templateOf(db)}"`)
    for (const s of settings)
      for (const c of s.config) {
        const [key, ...value] = c.split('=')
        await sql.unsafe(`alter role "${s.role}" in database "${db}" set ${key} = '${value.join('=').replace(/'/g, "''")}'`)
      }
  } finally {
    await sql.end()
  }
}, 60_000)
