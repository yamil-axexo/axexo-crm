import 'server-only'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { addContact, createAccount, CONTACT_ROLES } from '@/domain/accounts'
import { createImportedLead, MOTORS } from '@/domain/leads'
import { markUntrusted, plainText } from '@/domain/untrusted'
import { assertNoProhibited } from '@/domain/guard'
import { parseCsv } from '@/lib/csv'
import { toCsv } from '@/lib/periods'
import { toE164 } from '@/lib/format'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { loadBlocked, withLoad } from '@/server/loads'

// AUT-07: importación por archivo CSV de comercios, contactos y leads. El archivo se lee en memoria y NO se guarda.
// 1) Vista previa: se valida TODO antes de escribir, fila por fila (requeridos, formatos, datos prohibidos, duplicados).
// 2) Corrida: solo las filas buenas, en lotes, cada una por el mismo comando de dominio que el alta a mano.
// 3) Bitácora por fila y deshacer: lo que nadie trabajó después se retira; lo demás se queda y se dice.
type Pair = [es: string, en: string]
export const IMPORT_KINDS = ['accounts', 'contacts', 'leads'] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]
export const IMPORT_MAX_ROWS = 2000
export const IMPORT_MAX_BYTES = 900_000
const BATCH = 50

type Column = { key: string; names: string[]; required?: boolean; label: Pair; example: string | Pair; max: number }
const col = (key: string, names: string[], es: string, en: string, example: string | Pair, max: number, required = false): Column => ({ key, names, label: [es, en], example, max, required })

/** El archivo se puede llenar en español o en inglés: estas palabras valen lo mismo que el valor interno. */
const ROLE_WORDS: Record<string, (typeof CONTACT_ROLES)[number]> = {
  dueno: 'owner', 'dueno del comercio': 'owner', propietario: 'owner', decisor: 'decision_maker', 'quien decide': 'decision_maker', gerente: 'manager', encargado: 'manager', personal: 'staff', empleado: 'staff',
  cobranza: 'billing', facturacion: 'billing', directivo: 'executive', compras: 'purchasing', finanzas: 'finance', tecnologia: 'technology', legal: 'legal', operaciones: 'operations',
}
const KIND_WORDS: Record<string, string> = { tienda: 'store', sucursal: 'store', cadena: 'chain', distribuidor: 'distributor', organizacion: 'organization', corporativo: 'organization' }
const roleOf = (raw: string): string => ROLE_WORDS[norm(raw)] ?? norm(raw).replace(/ /g, '_')
const kindOf = (raw: string): string => KIND_WORDS[norm(raw)] ?? norm(raw)

export const IMPORT_COLUMNS: Record<ImportKind, Column[]> = {
  accounts: [
    col('name', ['nombre', 'name', 'comercio', 'merchant'], 'Nombre del comercio', 'Merchant name', 'Abarrotes Ejemplo', 160, true),
    col('phone', ['telefono', 'phone', 'teléfono'], 'Teléfono', 'Phone', '5512345678', 30),
    col('locality', ['ciudad', 'city', 'locality'], 'Ciudad', 'City', 'Ciudad Ejemplo', 120),
    col('region', ['estado', 'state', 'region'], 'Estado', 'State', 'Estado Ejemplo', 120),
    col('segment', ['canal', 'channel', 'segment'], 'Canal (d2d, b2b, dealer, event, orders u other; vacío: d2d)', 'Channel (d2d, b2b, dealer, event, orders or other; empty: d2d)', 'd2d', 10),
    col('kind', ['tipo', 'type', 'kind'], 'Tipo: tienda, cadena, distribuidor u organización (vacío: tienda)', 'Type: store, chain, distributor or organization (empty: store)', ['tienda', 'store'], 20),
  ],
  contacts: [
    col('account', ['comercio', 'merchant', 'account'], 'Nombre exacto del comercio que ya existe', 'Exact name of the existing merchant', 'Abarrotes Ejemplo', 160, true),
    col('full_name', ['nombre', 'name', 'contacto', 'contact'], 'Nombre del contacto', 'Contact name', 'Persona Ejemplo', 120, true),
    col('phone', ['telefono', 'phone', 'teléfono'], 'Teléfono', 'Phone', '5512345678', 30),
    col('email', ['correo', 'email'], 'Correo', 'Email', 'persona@ejemplo.test', 160),
    col('role', ['rol', 'role'], 'Rol: dueño del comercio, decisor, gerente, personal, cobranza, directivo, compras, finanzas, tecnología, legal u operaciones (vacío: dueño del comercio)', `Role: ${CONTACT_ROLES.join(', ')} (empty: owner)`, ['dueño del comercio', 'owner'], 30),
  ],
  leads: [
    col('business_name', ['negocio', 'business', 'business_name', 'nombre_negocio'], 'Nombre del negocio', 'Business name', 'Miscelánea Muestra', 120, true),
    col('contact_name', ['contacto', 'contact', 'contact_name', 'nombre'], 'Nombre de la persona', 'Person’s name', 'Persona Ejemplo', 120, true),
    col('phone', ['telefono', 'phone', 'teléfono'], 'Teléfono (o correo: hace falta uno)', 'Phone (or email: one is required)', '5512345678', 30),
    col('email', ['correo', 'email'], 'Correo', 'Email', 'persona@ejemplo.test', 160),
    col('locality', ['ciudad', 'city', 'locality'], 'Ciudad', 'City', 'Ciudad Ejemplo', 120),
    col('motor', ['tipo_venta', 'sale_type', 'tipo de venta', 'motor'], 'Tipo de venta (d2d, b2b o dealer; vacío: d2d)', 'Sale type (d2d, b2b or dealer; empty: d2d)', 'd2d', 40),
    col('message', ['mensaje', 'message', 'nota', 'note'], 'Nota', 'Note', 'Pide que le llamen por la tarde', 1000),
  ],
}

export const KIND_LABEL: Record<ImportKind, Pair> = { accounts: ['Comercios', 'Merchants'], contacts: ['Contactos', 'Contacts'], leads: ['Leads', 'Leads'] }

/** Plantilla descargable: encabezados en el idioma de quien la baja y una fila de ejemplo. */
export function importTemplate(kind: ImportKind, locale: 'es' | 'en'): { csv: string; fileName: string } {
  const cols = IMPORT_COLUMNS[kind]
  return { csv: toCsv(cols.map((c) => (locale === 'en' ? c.names[1]! : c.names[0]!)), [cols.map((c) => (typeof c.example === 'string' ? c.example : c.example[locale === 'en' ? 1 : 0]))]), fileName: `contigo-plantilla-${kind}.csv` }
}

export type PreviewRow = { rowNo: number; status: 'ok' | 'duplicate' | 'error'; label: string; problems: Pair[]; values: Record<string, string> }
export type Preview = { kind: ImportKind; market: string; fileName: string; checksum: string; total: number; ok: number; duplicates: number; errors: number; rows: PreviewRow[]; fileProblem: Pair | null }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const input = z.object({ kind: z.enum(IMPORT_KINDS), market: z.string().length(2), fileName: z.string().trim().min(1).max(160), text: z.string().min(1) })
const SEGMENTS = ['d2d', 'b2b', 'dealer', 'event', 'orders', 'other']
const KINDS = ['store', 'chain', 'distributor', 'organization']

/** Valida el archivo completo sin escribir nada. Es la misma función que corre antes de importar. */
export async function previewImport(ctx: Ctx, raw: z.input<typeof input>): Promise<Preview> {
  const v = input.safeParse(raw)
  if (!v.success) throw invalid('Elige qué vas a importar, el mercado y un archivo CSV.', 'Pick what to import, the market and a CSV file.')
  const { kind, market, fileName, text } = v.data
  ctx.assert('data.import', market)
  const mk = ctx.market(market)
  const base = { kind, market, fileName, checksum: createHash('sha256').update(`${kind}|${market}|${text}`).digest('hex'), total: 0, ok: 0, duplicates: 0, errors: 0, rows: [] as PreviewRow[] }
  if (Buffer.byteLength(text, 'utf8') > IMPORT_MAX_BYTES) return { ...base, fileProblem: ['El archivo pesa más de 900 KB. Divídelo en partes.', 'The file is larger than 900 KB. Split it into parts.'] }
  const table = parseCsv(text)
  const cols = IMPORT_COLUMNS[kind]
  const index = new Map<string, number>()
  for (const c of cols) {
    const i = table.headers.findIndex((h) => c.names.includes(norm(h)) || norm(h) === c.key)
    if (i >= 0) index.set(c.key, i)
  }
  const missing = cols.filter((c) => c.required && !index.has(c.key))
  if (missing.length) return { ...base, fileProblem: [`Faltan columnas: ${missing.map((c) => c.names[0]).join(', ')}. Baja la plantilla y úsala como guía.`, `Missing columns: ${missing.map((c) => c.names[1] ?? c.key).join(', ')}. Download the template and use it as a guide.`] }
  if (table.rows.length === 0) return { ...base, fileProblem: ['El archivo no trae filas.', 'The file has no rows.'] }
  if (table.rows.length > IMPORT_MAX_ROWS) return { ...base, fileProblem: [`El archivo trae ${table.rows.length} filas y el tope es ${IMPORT_MAX_ROWS}. Divídelo en partes.`, `The file has ${table.rows.length} rows and the limit is ${IMPORT_MAX_ROWS}. Split it into parts.`] }

  const rows: PreviewRow[] = table.rows.map((r, i) => {
    const values = Object.fromEntries(cols.map((c) => [c.key, plainText(index.has(c.key) ? (r[index.get(c.key)!] ?? '') : '').trim()]))
    const problems: Pair[] = []
    for (const c of cols) {
      const val = values[c.key]!
      if (c.required && !val) problems.push([`Falta ${c.names[0]}.`, `${c.names[1] ?? c.key} is missing.`])
      if (val.length > c.max) problems.push([`${c.names[0]}: máximo ${c.max} caracteres.`, `${c.names[1] ?? c.key}: at most ${c.max} characters.`])
    }
    const main = kind === 'accounts' ? values.name! : kind === 'leads' ? values.business_name! : values.full_name!
    if (main && main.length < 2) problems.push(['El nombre es demasiado corto.', 'The name is too short.'])
    if (values.phone && !toE164(values.phone, mk.phoneCc)) problems.push(['El teléfono no parece válido.', 'The phone number does not look valid.'])
    if (values.email && !z.string().email().safeParse(values.email).success) problems.push(['El correo no parece válido.', 'The email does not look valid.'])
    if (kind === 'leads' && !values.phone && !values.email) problems.push(['Hace falta un teléfono o un correo.', 'A phone or an email is required.'])
    if (kind === 'leads' && values.motor && !(MOTORS as readonly string[]).includes(values.motor.toLowerCase())) problems.push(['Tipo de venta: usa d2d, b2b o dealer.', 'Sale type: use d2d, b2b or dealer.'])
    if (kind === 'accounts' && values.segment && !SEGMENTS.includes(values.segment.toLowerCase())) problems.push(['Canal: usa d2d, b2b, dealer, event, orders u other.', 'Channel: use d2d, b2b, dealer, event, orders or other.'])
    if (kind === 'accounts' && values.kind && !KINDS.includes(kindOf(values.kind))) problems.push(['Tipo: usa tienda, cadena, distribuidor u organización.', 'Type: use store, chain, distributor or organization.'])
    if (kind === 'contacts' && values.role && !(CONTACT_ROLES as readonly string[]).includes(roleOf(values.role))) problems.push(['Rol: usa uno de los que dice la plantilla (dueño del comercio, decisor, gerente, personal...).', 'Role: use one of those listed in the template (owner, decision_maker, manager, staff...).'])
    try {
      assertNoProhibited(...Object.values(values))
    } catch {
      problems.push(['Trae un número de tarjeta, de cuenta bancaria o un SSN. Ese dato no entra a CONTIGO: quítalo.', 'It has a card number, a bank account number or an SSN. CONTIGO does not take that: remove it.'])
    }
    return { rowNo: i + 1, status: problems.length ? 'error' : 'ok', label: main || '', problems, values }
  })

  // Duplicados dentro del archivo: mismo teléfono, o mismo nombre sin teléfono.
  const seen = new Map<string, number>()
  for (const r of rows) {
    if (r.status !== 'ok') continue
    const phone = r.values.phone ? toE164(r.values.phone, mk.phoneCc) : null
    const key = kind === 'contacts' ? `${norm(r.values.account!)}|${phone ?? norm(r.values.email ?? '') ?? ''}|${norm(r.label)}` : (phone ?? r.values.email?.toLowerCase() ?? `n:${norm(r.label)}`)
    const first = seen.get(key)
    if (first) {
      r.status = 'duplicate'
      r.problems.push([`Repite la fila ${first} de este archivo.`, `It repeats row ${first} of this file.`])
    } else seen.set(key, r.rowNo)
  }

  // Duplicados contra lo que ya existe, con las reglas de DAT-04 (teléfono o nombre parecido en el mercado).
  await withUser(ctx.user.id, async (tx) => {
    for (const r of rows) {
      if (r.status !== 'ok') continue
      const phone = r.values.phone ? toE164(r.values.phone, mk.phoneCc) : null
      if (kind === 'accounts' || kind === 'leads') {
        const dup = await tx<{ name: string; match: string }[]>`select name, match from app.duplicate_candidates(${market}, ${r.label}, ${phone}) limit 1`
        if (dup[0]) {
          r.status = 'duplicate'
          r.problems.push([`Ya existe el comercio "${dup[0].name}" (${dup[0].match === 'phone' ? 'mismo teléfono' : 'nombre parecido'}).`, `The merchant "${dup[0].name}" already exists (${dup[0].match === 'phone' ? 'same phone' : 'similar name'}).`])
          continue
        }
      }
      if (kind === 'leads') {
        const email = r.values.email?.toLowerCase() || null
        const open = await tx<{ business_name: string }[]>`
          select business_name from crm.leads where market_code = ${market} and status in ('new','contacted','qualified')
             and ((${phone}::text is not null and phone = ${phone}) or (${email}::text is not null and email = ${email}::citext)) limit 1`
        if (open[0]) {
          r.status = 'duplicate'
          r.problems.push([`Ya hay un lead abierto con ese teléfono o correo ("${open[0].business_name}").`, `There is already an open lead with that phone or email ("${open[0].business_name}").`])
        }
      }
      if (kind === 'contacts') {
        const accs = await tx<{ id: string }[]>`select id from crm.accounts where market_code = ${market} and archived_at is null and lower(btrim(name)) = lower(${r.values.account!}) limit 2`
        if (accs.length === 0) {
          r.status = 'error'
          r.problems.push([`No hay un comercio llamado "${r.values.account}" en ${market}.`, `There is no merchant named "${r.values.account}" in ${market}.`])
        } else if (accs.length > 1) {
          r.status = 'error'
          r.problems.push([`Hay más de un comercio llamado "${r.values.account}": agrega el contacto desde su ficha.`, `More than one merchant is named "${r.values.account}": add the contact from its page.`])
        } else {
          const email = r.values.email?.toLowerCase() || null
          const has = await tx`select 1 from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
            where ac.account_id = ${accs[0]!.id} and ac.valid_to is null
              and ((${phone}::text is not null and c.phone = ${phone}) or (${email}::text is not null and c.email = ${email}::citext) or lower(btrim(c.full_name)) = lower(${r.label})) limit 1`
          if (has[0]) {
            r.status = 'duplicate'
            r.problems.push(['Ese comercio ya tiene ese contacto.', 'That merchant already has that contact.'])
          } else r.values.account_id = accs[0]!.id
        }
      }
    }
  })
  return { ...base, total: rows.length, ok: rows.filter((r) => r.status === 'ok').length, duplicates: rows.filter((r) => r.status === 'duplicate').length, errors: rows.filter((r) => r.status === 'error').length, rows, fileProblem: null }
}

export type ImportResult = { id: string; total: number; created: number; duplicates: number; rejected: number }

/** Importa las filas buenas del archivo. `checksum` es el de la vista previa: si el archivo cambió, hay que volver a revisarlo. */
export async function runImport(ctx: Ctx, raw: z.input<typeof input> & { checksum: string }): Promise<ImportResult> {
  // E5.F3/F4: una importación también es una carga: queda con inicio y fin y no corre junto con otra ni en la ventana de mantenimiento.
  const out = await withLoad('imports', 'manual', ctx.user.id, async () => {
    const r = await runImportNow(ctx, raw)
    return { ...r, done: r.created, note: `${raw.kind} ${raw.market}` }
  })
  const blocked = 'status' in out ? loadBlocked(out) : null
  if (blocked) throw new DomainError('busy', blocked[0], blocked[1], 409)
  return out as ImportResult
}

async function runImportNow(ctx: Ctx, raw: z.input<typeof input> & { checksum: string }): Promise<ImportResult> {
  const p = await previewImport(ctx, raw)
  if (p.fileProblem) throw new DomainError('invalid', p.fileProblem[0], p.fileProblem[1])
  if (p.checksum !== raw.checksum) throw invalid('El archivo cambió desde la vista previa. Revísalo otra vez.', 'The file changed since the preview. Check it again.')
  if (p.ok === 0) throw invalid('Ninguna fila se puede importar. Corrige el archivo y vuelve a revisarlo.', 'No row can be imported. Fix the file and check it again.')
  const importId = await withUser(ctx.user.id, async (tx) => {
    const again = await tx`select 1 from crm.csv_imports where checksum = ${p.checksum} and status <> 'undone'`
    if (again[0]) throw invalid('Ese mismo archivo ya se importó. Si hay que repetirlo, deshaz primero la importación anterior.', 'That same file was already imported. To repeat it, undo the earlier import first.')
    const id = await newId(tx)
    await tx`insert into crm.csv_imports (id, market_code, kind, file_name, checksum, rows_total, created_by) values (${id}, ${p.market}, ${p.kind}, ${p.fileName}, ${p.checksum}, ${p.total}, ${ctx.user.id})`
    return id
  })
  let created = 0
  let duplicates = 0
  let rejected = 0
  for (let start = 0; start < p.rows.length; start += BATCH) {
    const outcomes: { row_no: number; outcome: string; object: string | null; object_id: string | null; detail: string | null }[] = []
    for (const r of p.rows.slice(start, start + BATCH)) {
      const detail = (r.problems[0]?.[1] ?? '').slice(0, 300) || null
      if (r.status === 'duplicate') {
        duplicates++
        outcomes.push({ row_no: r.rowNo, outcome: 'duplicate', object: null, object_id: null, detail })
        continue
      }
      if (r.status === 'error') {
        rejected++
        outcomes.push({ row_no: r.rowNo, outcome: 'rejected', object: null, object_id: null, detail })
        continue
      }
      try {
        const x = r.values
        if (p.kind === 'accounts') {
          const out = await createAccount(ctx, { market: p.market, name: x.name!, phone: x.phone, locality: x.locality, region: x.region, segment: ((x.segment || 'd2d').toLowerCase()) as 'd2d', kind: kindOf(x.kind || 'store') as 'store' })
          if (!out.id) {
            duplicates++
            outcomes.push({ row_no: r.rowNo, outcome: 'duplicate', object: null, object_id: null, detail: 'duplicate found while importing' })
            continue
          }
          await withUser(ctx.user.id, (tx) => markUntrusted(tx, 'account', out.id!, p.market, 'csv_import', ['name', ...(x.locality ? ['locality'] : []), ...(x.region ? ['region'] : [])]))
          outcomes.push({ row_no: r.rowNo, outcome: 'created', object: 'account', object_id: out.id, detail: null })
        } else if (p.kind === 'leads') {
          const id = await createImportedLead(ctx, { market: p.market, motor: (x.motor || 'd2d').toLowerCase(), businessName: x.business_name!, contactName: x.contact_name!, phone: x.phone, email: x.email, locality: x.locality, message: x.message })
          outcomes.push({ row_no: r.rowNo, outcome: 'created', object: 'lead', object_id: id, detail: null })
        } else {
          const id = await addContact(ctx, x.account_id!, { fullName: x.full_name!, phone: x.phone, email: x.email, role: roleOf(x.role || 'owner') as 'owner' })
          await withUser(ctx.user.id, (tx) => markUntrusted(tx, 'contact', id, p.market, 'csv_import', ['full_name']))
          outcomes.push({ row_no: r.rowNo, outcome: 'created', object: 'contact', object_id: id, detail: null })
        }
        created++
      } catch (e) {
        rejected++
        outcomes.push({ row_no: r.rowNo, outcome: 'rejected', object: null, object_id: null, detail: (e instanceof DomainError ? e.en : 'could not be saved').slice(0, 300) })
      }
    }
    // Un lote: sus filas quedan anotadas juntas, con el avance de la corrida.
    await withUser(ctx.user.id, async (tx) => {
      for (const o of outcomes) await tx`insert into crm.csv_import_rows (import_id, row_no, outcome, object, object_id, detail) values (${importId}, ${o.row_no}, ${o.outcome}, ${o.object}, ${o.object_id}, ${o.detail})`
      await tx`update crm.csv_imports set rows_created = ${created}, rows_duplicate = ${duplicates}, rows_rejected = ${rejected} where id = ${importId}`
    })
  }
  await withUser(ctx.user.id, async (tx) => {
    await tx`update crm.csv_imports set status = 'done', finished_at = now() where id = ${importId}`
    await audit(tx, ctx, 'csv_import.completed', 'csv_import', importId, p.market, null, { kind: p.kind, file_name: p.fileName, rows: p.total, created, duplicates, rejected })
  })
  return { id: importId, total: p.total, created, duplicates, rejected }
}

/** Deshace una importación terminada. Devuelve cuántas filas se retiraron y cuántas se quedaron porque ya se trabajaron. */
export async function undoImport(ctx: Ctx, id: string): Promise<{ undone: number; kept: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; status: string; kind: string }[]>`select market_code, status, kind from crm.csv_imports where id = ${id}`
    const imp = rows[0]
    if (!imp) throw notFound()
    ctx.assert('data.import', imp.market_code)
    if (imp.status !== 'done') throw invalid('Esa importación ya se deshizo o no ha terminado.', 'That import was already undone or has not finished.')
    const out = await tx<{ undone: number; kept: number }[]>`select undone, kept from app.csv_import_undo(${id})`
    const res = { undone: out[0]?.undone ?? 0, kept: out[0]?.kept ?? 0 }
    await audit(tx, ctx, 'csv_import.undone', 'csv_import', id, imp.market_code, { status: 'done' }, { status: 'undone', kind: imp.kind, undone: res.undone, kept: res.kept })
    return res
  })
}

/** Reporte de rechazos de una importación, para corregir el archivo: fila, resultado y motivo. Sin los datos de la fila. */
export async function importReport(ctx: Ctx, id: string): Promise<{ csv: string; fileName: string }> {
  return withUser(ctx.user.id, async (tx) => {
    const imp = await tx<{ market_code: string }[]>`select market_code from crm.csv_imports where id = ${id}`
    if (!imp[0]) throw notFound()
    ctx.assert('data.import', imp[0].market_code)
    const rows = await tx<{ row_no: number; outcome: string; detail: string | null }[]>`select row_no, outcome, detail from crm.csv_import_rows where import_id = ${id} order by row_no`
    return { csv: toCsv([ctx.t('Fila', 'Row'), ctx.t('Resultado', 'Result'), ctx.t('Detalle', 'Detail')], rows.map((r) => [r.row_no, r.outcome, r.detail ?? ''])), fileName: `contigo-importacion-${id.slice(0, 8)}.csv` }
  })
}
