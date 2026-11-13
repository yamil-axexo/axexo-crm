import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid } from '@/lib/errors'

type Pair = [es: string, en: string]

/**
 * Decisiones de negocio que no toma quien construye (ola 6, paquete datos2). Cada una tiene un valor propuesto conservador y
 * reversible, guardado como dato (crm.decision_settings), y un dueño. Mientras el dueño no la confirma, la pantalla dice
 * "Valor propuesto, pendiente de <dueño>" y Estado de CONTIGO la lista. Una decisión `locked` no se cambia desde la pantalla.
 */
export type DecisionDef = {
  key: string
  label: Pair
  help: Pair
  owner: string
  /** Opciones válidas (valor guardado y su texto). */
  options: { value: string; label: Pair }[]
  /** Valor propuesto por mercado (o '*' para todos). */
  proposal: Record<string, string>
  perMarket: boolean
  locked?: boolean
  item: string
}

export const DECISIONS: DecisionDef[] = [
  {
    key: 'lead.no_owner',
    item: 'E3.F10',
    label: ['Lead que nadie puede tomar', 'Lead nobody can take'],
    help: ['Si las reglas de reparto no le dan el lead a nadie: pasa a quien lidera el mercado, o se rechaza. En los dos casos, si tampoco hay líder, el formulario no crea el lead y la solicitud queda guardada en Asignación y embudo, Envíos de formulario retenidos.', 'If the routing rules give the lead to nobody: it goes to the market lead, or it is refused. Either way, if there is no market lead either, the form does not create the lead and the request is kept in Assignment and pipeline, Held form submissions.'],
    owner: 'Martech',
    options: [
      { value: 'market_lead', label: ['Pasa a quien lidera el mercado', 'Goes to the market lead'] },
      { value: 'refuse', label: ['Se rechaza y queda retenido', 'Refused and held'] },
    ],
    proposal: { '*': 'market_lead' },
    perMarket: true,
  },
  {
    key: 'tree.reparent_owner',
    item: 'DAT-01',
    label: ['Quién lleva la cuenta al moverla en el árbol', 'Owner when a record moves in the tree'],
    help: ['Al colgar una cuenta de otra: sigue con quien la lleva, o pasa a quien lleva la cuenta de arriba. El cambio queda en la bitácora.', 'When a record is placed under another: it keeps its owner, or it takes the owner of the record above. The owner change is logged.'],
    owner: 'Yamil Alvarez y Comercial',
    options: [
      { value: 'keep', label: ['Sigue con quien la lleva', 'Keeps its owner'] },
      { value: 'parent', label: ['Pasa a quien lleva la cuenta de arriba', 'Takes the owner of the record above'] },
    ],
    proposal: { '*': 'keep' },
    perMarket: true,
  },
  {
    key: 'ops.operator_rights',
    item: 'E4.F2',
    label: ['Lo que pueden hacer Ventas y Operaciones', 'What Sales and Operations can do'],
    help: ['Cambiar quién lleva un registro, fusionar duplicados y editar en bloque, sin ser administración. Exportar, importar, borrar y cambiar la configuración siguen siendo de administración.', 'Change owners, merge duplicates and bulk edit, without being an administrator. Exporting, importing, deleting and changing settings stay with administration.'],
    owner: 'Martech',
    options: [
      { value: 'on', label: ['Pueden', 'Allowed'] },
      { value: 'off', label: ['No pueden', 'Not allowed'] },
    ],
    // Conservador: cerrado en todos los mercados hasta que Martech lo encienda (en Estados Unidos el requerimiento ya está confirmado).
    proposal: { '*': 'off' },
    perMarket: true,
  },
  {
    key: 'market.reset_production',
    item: 'E6.F8',
    label: ['Borrar y recargar un mercado en producción', 'Wipe and reload a market in production'],
    help: ['Fuera de producción ya se puede, con confirmación escrita. En producción queda bloqueado hasta que se decida; no se cambia desde esta pantalla.', 'Outside production it already works, with a written confirmation. In production it stays blocked until decided; it cannot be changed from this screen.'],
    owner: 'Dan Mulligan',
    options: [
      { value: 'blocked', label: ['Bloqueado en producción', 'Blocked in production'] },
      { value: 'allowed', label: ['Permitido en producción', 'Allowed in production'] },
    ],
    proposal: { '*': 'blocked' },
    perMarket: false,
    locked: true,
  },
  {
    key: 'field.approval_sla_days',
    item: 'DAT-05',
    label: ['Plazo para decidir un campo propuesto', 'Deadline to decide a proposed field'],
    help: ['Días hábiles que tiene administración para aprobar o rechazar un campo que propone un mercado. Las propuestas vencidas se marcan en Datos, Campos.', 'Days administration has to approve or reject a field a market proposes. Overdue proposals are flagged in Data, Fields.'],
    owner: 'Dan Mulligan o Michael Essiet',
    options: [
      { value: '2', label: ['2 días', '2 days'] },
      { value: '3', label: ['3 días', '3 days'] },
      { value: '5', label: ['5 días', '5 days'] },
    ],
    proposal: { '*': '3' },
    perMarket: false,
  },
  {
    key: 'product.catalog_source',
    item: 'DAT-07',
    label: ['Catálogo real de productos, proveedores y plazos', 'Real catalog of products, providers and deadlines'],
    help: ['Lo cargado son datos de ejemplo. Cuando Operaciones entregue el catálogo real, se carga en Datos, Productos por comercio.', 'What is loaded is sample data. When Operations hands over the real catalog, it is loaded in Data, Products by merchant.'],
    owner: 'Operaciones US y MX',
    options: [
      { value: 'sample', label: ['Datos de ejemplo', 'Sample data'] },
      { value: 'real', label: ['Catálogo real cargado', 'Real catalog loaded'] },
    ],
    proposal: { '*': 'sample' },
    perMarket: false,
  },
  {
    key: 'legal.entity_list',
    item: 'MULTI-02',
    label: ['Lista real de entidades legales', 'Real list of legal entities'],
    help: ['Las entidades cargadas son las del arranque. Legal y Finanzas confirman la lista; cada contrato y cada lead ya llevan entidad.', 'The entities loaded are the starting ones. Legal and Finance confirm the list; every contract and every lead already carries an entity.'],
    owner: 'Legal y Finanzas',
    options: [
      { value: 'initial', label: ['Lista de arranque', 'Starting list'] },
      { value: 'confirmed', label: ['Lista confirmada', 'List confirmed'] },
    ],
    proposal: { '*': 'initial' },
    perMarket: false,
  },
  {
    key: 'us.store_field_lists',
    item: 'E9.F11',
    label: ['Opciones de los campos de la tienda en Estados Unidos', 'Options for US store fields'],
    help: ['Lead Type, Merchant Classification y el estado de baja en InstaPay y T-Mobile se capturan como texto hasta que se definan sus listas y de dónde sale la baja.', 'Lead Type, Merchant Classification and churn status for InstaPay and T-Mobile are captured as text until their lists and the churn source are defined.'],
    owner: 'Operaciones y ventas US',
    options: [
      { value: 'text', label: ['Texto libre', 'Free text'] },
      { value: 'lists', label: ['Listas definidas', 'Lists defined'] },
    ],
    proposal: { '*': 'text' },
    perMarket: false,
  },
]

export const decisionDef = (key: string): DecisionDef => {
  const d = DECISIONS.find((x) => x.key === key)
  if (!d) throw invalid('Esa decisión no existe.', 'That decision does not exist.')
  return d
}

const proposalFor = (d: DecisionDef, market: string | null) => (market && d.proposal[market]) ?? d.proposal['*']!

/** Valor vigente: el guardado para el mercado, el guardado para todos, o el propuesto. */
export async function decisionValue(tx: Tx, key: string, market: string | null): Promise<{ value: string; proposed: boolean }> {
  const d = decisionDef(key)
  const rows = await tx<{ value: string; proposed: boolean; market_code: string | null }[]>`
    select value #>> '{}' as value, proposed, market_code from crm.decision_settings
     where key = ${key} and (market_code is null or market_code = ${market}) order by market_code nulls last limit 1`
  const r = rows[0]
  if (r && d.options.some((o) => o.value === r.value)) return { value: r.value, proposed: r.proposed }
  return { value: proposalFor(d, market), proposed: true }
}

export type DecisionRow = { key: string; market: string | null; value: string; proposed: boolean; updatedAt: string | null; updatedBy: string | null; note: string | null }

/** Todas las decisiones con su valor vigente, por mercado cuando aplica. */
export async function decisionRows(tx: Tx, markets: string[]): Promise<DecisionRow[]> {
  const saved = await tx<{ key: string; market_code: string | null; value: string; proposed: boolean; updated_at: Date; who: string | null; note: string | null }[]>`
    select s.key, s.market_code, s.value #>> '{}' as value, s.proposed, s.updated_at, u.full_name as who, s.note
      from crm.decision_settings s left join crm.users u on u.id = s.updated_by`
  const out: DecisionRow[] = []
  for (const d of DECISIONS) {
    for (const m of d.perMarket ? markets : [null]) {
      const s = saved.find((x) => x.key === d.key && x.market_code === m) ?? (m ? saved.find((x) => x.key === d.key && x.market_code === null) : undefined)
      out.push(s && d.options.some((o) => o.value === s.value)
        ? { key: d.key, market: m, value: s.value, proposed: s.proposed, updatedAt: s.updated_at.toISOString(), updatedBy: s.who, note: s.note }
        : { key: d.key, market: m, value: proposalFor(d, m), proposed: true, updatedAt: null, updatedBy: null, note: null })
    }
  }
  return out
}

/**
 * Cambia una decisión. `confirmed` dice que la persona dueña ya decidió: el valor deja de ser propuesto. Lo hace administración
 * (parte Embudos y campos); queda en la bitácora con el valor de antes.
 */
export async function setDecision(ctx: Ctx, input: { key: string; market: string | null; value: string; confirmed: boolean; note?: string | null }): Promise<void> {
  const d = decisionDef(input.key)
  ctx.assert('config.manage')
  if (d.locked) throw invalid(`Esta decisión es de ${d.owner} y no se cambia desde la pantalla.`, `This decision belongs to ${d.owner} and cannot be changed from the screen.`)
  if (!d.options.some((o) => o.value === input.value)) throw invalid('Elige una de las opciones.', 'Pick one of the options.')
  const market = d.perMarket ? input.market : null
  if (d.perMarket && market && !ctx.markets.some((m) => m.code === market)) throw invalid('Ese mercado no existe.', 'That market does not exist.')
  const note = input.note?.trim() || null
  if (note) assertNoProhibited(note)
  if (input.confirmed && (!note || note.length < 5)) throw invalid(`Anota cuándo y cómo lo decidió ${d.owner} (de 5 a 300 letras).`, `Note when and how ${d.owner} decided it (5 to 300 characters).`)
  await withUser(ctx.user.id, async (tx) => {
    const before = await decisionValue(tx, d.key, market)
    await tx`insert into crm.decision_settings (key, market_code, value, proposed, owner_label, note, updated_by)
             values (${d.key}, ${market}, ${tx.json(input.value)}, ${!input.confirmed}, ${d.owner}, ${note}, ${ctx.user.id})
             on conflict (key, coalesce(market_code, '*')) do update set value = excluded.value, proposed = excluded.proposed, note = excluded.note,
               updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'decision.set', 'decision', null, market, { key: d.key, value: before.value, proposed: before.proposed }, { key: d.key, value: input.value, proposed: !input.confirmed })
  })
}
