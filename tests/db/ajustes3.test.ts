import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import es from '@/messages/es.json'
import en from '@/messages/en.json'
import { ctxFor, marketDay, owner, personaId } from './helpers'
import { MESSAGE_FAMILIES, QUEUE_KINDS } from '@/lib/message-families'
import { EXCEPTION } from '@/lib/labels'
import { EXCEPTION_KINDS } from '@/domain/rules'
import { NOTICE_KINDS as AUTOMATION_KINDS } from '@/domain/automation/catalog'
import { NOTICE_KINDS } from '@/lib/notice-kinds'
import { getQueue } from '@/dal/queue'
import { completeItem } from '@/domain/queue'
import { messages } from '@/lib/messages'

// ajustes3 (tercera vuelta del comité). P1: Hoy mostraba "suggest.lead_no_next_step" porque la clave no existía en
// los catálogos. Se cierra la clase entera: toda clave armada en el código con una parte variable tiene que existir
// en es.json y en.json, y todo tipo de aviso que la base acepta tiene texto.
const admin = owner()
const ES = es as Record<string, string>
const EN = en as Record<string, string>
const MARK = 'ajustes3 prueba'

afterAll(async () => {
  await admin.end()
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

describe('claves de mensajes (P1: Hoy con claves internas)', () => {
  it('cada familia de claves armadas en el código existe completa en es.json y en.json', () => {
    const missing: string[] = []
    for (const [prefix, values] of Object.entries(MESSAGE_FAMILIES)) {
      for (const v of values) {
        const key = prefix + v
        if (!ES[key]) missing.push(`es:${key}`)
        if (!EN[key]) missing.push(`en:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('no aparece en el código una clave armada con una familia sin declarar', () => {
    // `prefijo.${...}` seguido de "as MessageKey" o dentro de m(`...`) / ctx.m(`...`)
    const found = new Set<string>()
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8')
      for (const re of [/`([a-zA-Z][\w.]*\.)\$\{[^`]*`\s*as\s+MessageKey/g, /\bm\(\s*`([a-zA-Z][\w.]*\.)\$\{/g]) {
        for (const x of src.matchAll(re)) found.add(`${x[1]}|${f}`)
      }
    }
    expect(found.size).toBeGreaterThan(0)
    const undeclared = [...found].filter((x) => !(x.split('|')[0]! in MESSAGE_FAMILIES))
    expect(undeclared).toEqual([])
  })

  it('los tipos de aviso que acepta la base son los del registro, y todos tienen nombre y acción', async () => {
    const [{ def }] = await admin<{ def: string }[]>`
      select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_class t on t.oid = c.conrelid
       where t.relname = 'exceptions' and c.conname = 'exceptions_kind_check'`
    const inDb = [...def.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    expect(inDb).toEqual([...QUEUE_KINDS].sort())
    for (const k of [...EXCEPTION_KINDS, ...AUTOMATION_KINDS]) expect(QUEUE_KINDS, k).toContain(k)
    for (const k of QUEUE_KINDS) {
      expect(EXCEPTION[k]?.label?.every(Boolean), k).toBe(true)
      expect(EXCEPTION[k]?.action?.every(Boolean), k).toBe(true)
    }
    for (const [k, d] of Object.entries(NOTICE_KINDS)) expect(d.label.every(Boolean) && d.hint.every(Boolean), k).toBe(true)
  })

  it('las sugerencias de Hoy nunca muestran una clave, en español ni en inglés', async () => {
    for (const p of ['diana.cruz', 'ivan.rios', 'paula.mendez', 'kira.dunn', 'jade.kim', 'sam.ortiz']) {
      const ctx = await ctxFor(p)
      const q = await getQueue(ctx)
      for (const r of q.rows.filter((x) => x.type === 'suggestion')) {
        for (const loc of ['es', 'en'] as const) {
          const m = messages(loc)
          const title = m(`suggest.${r.kind}` as never, { name: r.name ?? '' })
          const context = m(`ctx.${r.kind}` as never, { days: 1 })
          expect(title, `${p} ${r.kind}`).not.toMatch(/^(suggest|ctx)\./)
          expect(context, `${p} ${r.kind}`).not.toMatch(/^(suggest|ctx)\./)
        }
      }
    }
  })

  it('atender una sugerencia deja una tarea con título legible', async () => {
    const kira = await ctxFor('jade.kim')
    const me = await personaId('jade.kim')
    const [acc] = await admin<{ id: string; market_code: string }[]>`
      select id, market_code from crm.accounts where owner_id = ${me} order by created_at limit 1`
    const [ex] = await admin<{ id: string }[]>`
      insert into crm.exceptions (market_code, kind, severity, account_id, owner_id, detail, dedupe_key)
      values (${acc!.market_code}, 'onboarding_no_next_step', 'medium', ${acc!.id}, ${me}, ${admin.json({ name: MARK })}, ${'ajustes3:' + acc!.id}) returning id`
    await completeItem(kira, { type: 'suggestion', id: ex!.id, result: 'done', next: 'call', when: marketDay(1, 'America/New_York') } as never)
    const rows = await admin<{ subject: string }[]>`select subject from crm.activities where account_id = ${acc!.id} and source = 'rule' order by created_at desc limit 1`
    expect(rows[0]!.subject).not.toMatch(/suggest\./)
    expect(rows[0]!.subject.length).toBeGreaterThan(10)
  })

  it('la migración repara las tareas que ya se guardaron con la clave como título', async () => {
    const [acc] = await admin<{ id: string; name: string }[]>`select id, name from crm.accounts where market_code = 'MX' order by created_at limit 1`
    const me = await personaId('ivan.rios')
    const [a] = await admin<{ id: string }[]>`
      insert into crm.activities (market_code, account_id, kind, subject, done_at, outcome, owner_id, created_by, source)
      values ('MX', ${acc!.id}, 'task', 'suggest.lead_no_next_step', now(), 'done', ${me}, ${me}, 'rule') returning id`
    await admin.unsafe(readFileSync('db/migrations/0043_ajustes3.up.sql', 'utf8'))
    const [r] = await admin<{ subject: string }[]>`select subject from crm.activities where id = ${a!.id}`
    expect(r!.subject).toBe(`Agendar la siguiente tarea con ${acc!.name}`)
  })

  it('un aviso sin dueño cae a la supervisión del mismo tipo de venta, no a la primera del mercado', async () => {
    const [d] = await admin<{ id: string; account_id: string }[]>`
      select d.id, d.account_id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.accounts a on a.id = d.account_id
       where p.market_code = 'MX' and p.motor = 'd2d' and d.status = 'open'
         and not exists (select 1 from crm.territory_owners o where o.territory_id = a.territory_id and o.valid_to is null)
       order by d.id limit 1`
    const [ex] = await admin<{ owner_id: string }[]>`
      insert into crm.exceptions (market_code, kind, severity, account_id, deal_id, owner_id, detail, dedupe_key)
      values ('MX', 'no_next_step', 'medium', ${d!.account_id}, ${d!.id}, null, '{}'::jsonb, ${'ajustes3-route:' + d!.id}) returning owner_id`
    const [team] = await admin<{ motor: string }[]>`
      select t.motor from crm.memberships m join crm.teams t on t.id = m.team_id where m.user_id = ${ex!.owner_id} and m.market_code = 'MX' and m.valid_to is null limit 1`
    expect(team?.motor).toBe('d2d')
    expect(ex!.owner_id).not.toBe(await personaId('paula.mendez'))
  })
})
