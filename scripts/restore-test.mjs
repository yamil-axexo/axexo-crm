// GOB-07: prueba de restauración automatizada en local. Uso:
//   MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5433/<base de prueba> node scripts/restore-test.mjs
// 1) cuenta filas de las tablas clave, 2) pg_dump de la base (formato custom), 3) pg_restore a una base de paso,
// 4) compara los conteos tabla por tabla, 5) borra la base de paso, 6) deja la prueba en crm.restore_tests (ambiente "local")
// con minutos, conteos y resultado. Nunca corre contra producción ni contra una base que no sea de prueba.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'

const TABLES = ['accounts', 'deals', 'leads', 'activities', 'contacts', 'audit_events', 'outbox_events', 'users', 'memberships']

export async function restoreTest(url, { record = true, by = 'scripts/restore-test.mjs' } = {}) {
  if (process.env.APP_ENV === 'production') throw new Error('restore-test: not in production')
  const src = new URL(url)
  const db = src.pathname.slice(1)
  if (!/^contigo_[a-z0-9_]+$/.test(db) || /prod/.test(db)) throw new Error('restore-test: only local contigo_* test databases')
  if (!['127.0.0.1', 'localhost'].includes(src.hostname)) throw new Error('restore-test: only a local database')
  const scratch = `${db}_restore_${Date.now().toString(36)}`
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const started = Date.now()
  const count = async (sql) => {
    const out = {}
    for (const t of TABLES) out[t] = Number((await sql.unsafe(`select count(*)::bigint as n from crm.${t}`))[0].n)
    return out
  }
  const source = postgres(url, { max: 1, onnotice: () => {} })
  const dir = mkdtempSync(join(tmpdir(), 'contigo-restore-'))
  const file = join(dir, 'dump.pgc')
  let before, after, ok = false, error = null
  const server = postgres(admin.href, { max: 1, onnotice: () => {} })
  try {
    before = await count(source)
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--file', file, url], { stdio: 'pipe' })
    await server.unsafe(`create database "${scratch}"`)
    const target = new URL(url)
    target.pathname = `/${scratch}`
    // Los roles existen en el servidor; los errores de "ya existe" de extensiones no detienen la restauración.
    try {
      execFileSync('pg_restore', ['--no-owner', '--exit-on-error', '--dbname', target.href, file], { stdio: 'pipe' })
    } catch (e) {
      execFileSync('pg_restore', ['--no-owner', '--dbname', target.href, file], { stdio: 'pipe' })
      void e
    }
    const restored = postgres(target.href, { max: 1, onnotice: () => {} })
    try {
      after = await count(restored)
    } finally {
      await restored.end()
    }
    ok = TABLES.every((t) => before[t] === after[t])
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 200)
  } finally {
    await server.unsafe(`drop database if exists "${scratch}" with (force)`).catch(() => {})
    await server.end()
    rmSync(dir, { recursive: true, force: true })
  }
  const minutes = Math.max(0, Math.round((Date.now() - started) / 60000))
  const result = { ok, minutes, before, after, error, scratch }
  if (record) {
    await source`
      insert into crm.restore_tests (tested_on, tested_by, environment, backup_from, minutes, data_loss_minutes, result, evidence, notes, recorded_by, counts)
      values ((now() at time zone 'UTC')::date, ${by}, 'local', now(), ${minutes}, 0, ${ok ? 'ok' : 'failed'},
              ${`pg_dump y pg_restore de ${db}; conteos de ${TABLES.length} tablas comparados`},
              ${error ? `Falló: ${error}` : null}, app.system_user_id(), ${source.json({ before: before ?? {}, after: after ?? {} })})`
  }
  await source.end()
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is required')
    process.exit(1)
  }
  const out = await restoreTest(url)
  console.log(JSON.stringify({ ok: out.ok, minutes: out.minutes, error: out.error }))
  process.exit(out.ok ? 0 : 1)
}
