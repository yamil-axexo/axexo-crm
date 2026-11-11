// SEC-08: busca datos prohibidos (tarjetas, SSN, CLABE, llaves y secretos) en el repo y, con --db, en los textos libres de la base.
// Uso: node scripts/scan-prohibited.mjs [--db]. Sale con código 1 si encuentra algo.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const SKIP = new Set(['node_modules', '.next', '.git', 'test-results', 'playwright-report', 'pnpm-lock.yaml'])
const TEXT = /\.(ts|tsx|mjs|js|json|sql|md|yml|yaml|css|env|example|txt|sh)$/

const luhn = (digits) => {
  let sum = 0
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = Number(digits[i])
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

export const RULES = [
  { id: 'card_number', re: /\b(?:\d[ -]?){13,19}\b/g, test: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && /^[3-6]/.test(d) && luhn(d) } },
  { id: 'us_ssn', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { id: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'service_role_jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  { id: 'connection_string_with_password', re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@[^\s/]+/g },
  { id: 'secret_assignment', re: /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi },
]

export function scanText(text) {
  const hits = []
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      if (!rule.test || rule.test(m[0])) hits.push({ rule: rule.id, index: m.index })
    }
  }
  return hits
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (TEXT.test(name) && st.size < 2_000_000) out.push(p)
  }
  return out
}

async function scanDb() {
  const { default: postgres } = await import('postgres')
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required for --db')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  const sources = [
    ['activities.body', sql`select id::text, coalesce(subject, '') || ' ' || coalesce(body, '') as t from crm.activities`],
    ['leads.message', sql`select id::text, coalesce(message, '') as t from crm.leads`],
    ['accounts.custom', sql`select id::text, custom::text as t from crm.accounts where custom <> '{}'::jsonb`],
    ['deals.loss_note', sql`select id::text, coalesce(loss_note, '') || ' ' || coalesce(next_step, '') as t from crm.deals`],
    ['visits.note', sql`select id::text, coalesce(note, '') as t from crm.visits where note is not null`],
  ]
  const findings = []
  for (const [name, q] of sources) {
    for (const row of await q) for (const h of scanText(row.t)) findings.push(`${name} id=${row.id} rule=${h.rule}`)
  }
  await sql.end()
  return findings
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = []
  for (const file of walk(root)) {
    const rel = relative(root, file)
    if (rel === 'scripts/scan-prohibited.mjs' || rel.startsWith('tests/unit/scanner')) continue
    const text = readFileSync(file, 'utf8')
    for (const h of scanText(text)) {
      const line = text.slice(0, h.index).split('\n').length
      findings.push(`${rel}:${line} rule=${h.rule}`)
    }
  }
  if (process.argv.includes('--db')) findings.push(...(await scanDb()))
  if (findings.length) {
    console.error(`prohibited data found (${findings.length}):\n` + findings.join('\n'))
    process.exit(1)
  }
  console.log('scan ok: no prohibited data found')
}
