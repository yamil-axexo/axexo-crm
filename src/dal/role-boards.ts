import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isMetricKey, type MetricKey } from '@/lib/metric-defs'

/**
 * REP-01 (paquete reportes2): tablero por rol. QUÉ cifras lleva cada rol lo dice crm.role_boards (lo cambia Administración y lo
 * confirma C1); CÓMO se calcula cada cifra lo dice src/lib/metric-defs.ts. Aquí solo se calculan los valores, con la RLS de quien mira.
 */
export type BoardRole = 'kam' | 'partner' | 'ops' | 'finance'
export type BoardItem = { key: MetricKey; position: number; confirmed: boolean; ownerLabel: string | null; pendingOwner: string }
export type BoardValue = { value: number | string | null; hint?: [string, string]; pct?: boolean }

export async function boardConfig(ctx: Ctx, role: BoardRole): Promise<BoardItem[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ metric_key: string; position: number; confirmed: boolean; owner_label: string | null; pending_owner: string }[]>`
      select metric_key, position, confirmed, owner_label, pending_owner from crm.role_boards where role = ${role} order by position`
    return rows.filter((r) => isMetricKey(r.metric_key)).map((r) => ({ key: r.metric_key as MetricKey, position: r.position, confirmed: r.confirmed, ownerLabel: r.owner_label, pendingOwner: r.pending_owner }))
  })
}

export type RoleBoardRow = { role: BoardRole; metric_key: string; position: number; confirmed: boolean; owner_label: string | null; pending_owner: string; updated_at: string }
export async function allBoards(ctx: Ctx): Promise<RoleBoardRow[]> {
  return withUser(ctx.user.id, (tx) => tx<RoleBoardRow[]>`
    select role, metric_key, position, confirmed, owner_label, pending_owner, updated_at::text from crm.role_boards order by role, position`)
}

// ------------------------------------------------------------------ KAM
/** Las personas KAM que quien mira puede elegir (la RLS de memberships decide). La persona KAM solo se ve a sí misma. */
export async function kamPeople(ctx: Ctx): Promise<{ id: string; full_name: string; market_code: string }[]> {
  return withUser(ctx.user.id, (tx) => tx<{ id: string; full_name: string; market_code: string }[]>`
    select distinct u.id, u.full_name, m.market_code from crm.memberships m join crm.users u on u.id = m.user_id
     where m.role = 'kam' and (m.valid_to is null or m.valid_to > now()) and u.is_active
       and (u.id = app.current_user_id() or m.market_code = any(app.full_markets()) or u.id = any(app.supervised_user_ids()))
     order by u.full_name`)
}

const keyAccounts = (tx: Tx, who: string) => tx`
  select a.id from crm.accounts a where a.owner_id = ${who} and a.kind <> 'store' and a.archived_at is null and a.merged_into is null`

export type KamDeal = { id: string; title: string; account: string; stage: string; stage_en: string; amount_minor: number | null; currency: string; next_step: string | null; next_step_due: string | null;
  category: string | null; manager_category: string | null; manager_note: string | null; market_code: string; owner_id: string | null }

export async function kamBoard(ctx: Ctx, who: string): Promise<{ values: Partial<Record<MetricKey, BoardValue>>; deals: KamDeal[]; accounts: { id: string; name: string; kind: string; stores: number; active: number }[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const ids = (await keyAccounts(tx, who)).map((r) => r.id as string)
    const accounts = await tx<{ id: string; name: string; kind: string; stores: number; active: number }[]>`
      select a.id, a.name, a.kind,
             (select count(*)::int from crm.accounts s where s.kind = 'store' and s.archived_at is null and (s.parent_id = a.id or s.ancestor_ids @> array[a.id])) as stores,
             (select count(*)::int from crm.accounts s where s.kind = 'store' and s.archived_at is null and s.lifecycle = 'active' and (s.parent_id = a.id or s.ancestor_ids @> array[a.id])) as active
        from crm.accounts a where a.id = any(${ids}::uuid[]) order by a.name`
    const deals = await tx<KamDeal[]>`
      select d.id, d.title, a.name as account, s.name_es as stage, s.name_en as stage_en, d.amount_minor::float8 as amount_minor, trim(d.currency) as currency,
             d.next_step, d.next_step_due::text as next_step_due, f.category, f.manager_category, f.manager_note, d.market_code, d.owner_id
        from crm.deals d join crm.accounts a on a.id = d.account_id join crm.stages s on s.id = d.stage_id
        left join crm.deal_forecast f on f.deal_id = d.id
       where d.owner_id = ${who} and d.status = 'open' and (a.id = any(${ids}::uuid[]) or a.ancestor_ids && ${ids}::uuid[])
       order by d.next_step_due nulls first, d.title`
    const today = await tx<{ d: string }[]>`select (now() at time zone coalesce((select mk.timezone from crm.memberships m join crm.markets mk on mk.code = m.market_code where m.user_id = ${who} and m.role = 'kam' limit 1), 'UTC'))::date::text as d`
    const won = await tx<{ n: number }[]>`select count(*)::int as n from crm.deals d where d.owner_id = ${who} and d.status = 'won' and d.won_at > now() - interval '90 days'`
    const stores = accounts.reduce((s, a) => s + a.stores, 0)
    const cat = (d: KamDeal) => d.manager_category ?? d.category
    return {
      accounts, deals,
      values: {
        kamAccounts: { value: accounts.length },
        kamStoresActive: { value: accounts.reduce((s, a) => s + a.active, 0), hint: [`De ${stores} tiendas en sus cuentas.`, `Out of ${stores} stores in the accounts.`] },
        kamOpen: { value: deals.length },
        kamCommit: { value: deals.filter((d) => cat(d) === 'commit').length },
        kamNoNextStep: { value: deals.filter((d) => !d.next_step || !d.next_step_due || d.next_step_due < today[0]!.d).length },
        kamWon90: { value: won[0]!.n },
      },
    }
  })
}

// ------------------------------------------------------------------ Operaciones
export async function opsBoard(ctx: Ctx, market: string | null): Promise<Partial<Record<MetricKey, BoardValue>>> {
  return withUser(ctx.user.id, async (tx) => {
    const m = market ? tx`and x.market_code = ${market}` : tx``
    const [r] = await tx<{ ops_deals: number; files_open: number; overdue: number; returned: number; approved: number; decided_returned: number; awaiting: number; handoffs: number }[]>`
      select (select count(*)::int from crm.deals x join crm.stages s on s.id = x.stage_id and s.is_ops where x.status = 'open' ${m}) as ops_deals,
             (select count(*)::int from crm.onboarding_files x where x.status in ('submitted','in_review') ${m}) as files_open,
             (select count(*)::int from crm.onboarding_files x where x.status in ('submitted','in_review') and x.due_at < now() ${m}) as overdue,
             (select count(*)::int from crm.onboarding_files x where x.status = 'returned' ${m}) as returned,
             (select count(*)::int from crm.onboarding_files x where x.status in ('approved','auto_approved') and x.decided_at > now() - interval '30 days' ${m}) as approved,
             (select count(*)::int from crm.onboarding_files x where x.status = 'returned' and x.decided_at > now() - interval '30 days' ${m}) as decided_returned,
             (select count(*)::int from crm.deals x join crm.stages s on s.id = x.stage_id and s.kind = 'awaiting_txn' where x.status = 'open' ${m}) as awaiting,
             (select count(*)::int from crm.handoffs x where x.status = 'pending' and x.to_role = 'ops' ${m}) as handoffs`
    const decided = r!.approved + r!.decided_returned
    return {
      opsQueue: { value: r!.ops_deals + r!.files_open, hint: [`${r!.ops_deals} negocios y ${r!.files_open} expedientes.`, `${r!.ops_deals} deals and ${r!.files_open} files.`] },
      opsOverdue: { value: r!.overdue },
      opsReturned: { value: r!.returned },
      opsPullThrough: decided ? { value: Math.round((r!.approved / decided) * 100), pct: true, hint: [`${r!.approved} de ${decided} decididos.`, `${r!.approved} of ${decided} decided.`] } : { value: null },
      opsAwaitingFirstSale: { value: r!.awaiting },
      opsHandoffsOpen: { value: r!.handoffs },
    }
  })
}

// ------------------------------------------------------------------ Partner
/** Las cifras del partner sobre su red. La RLS deja al usuario de partner ver solo su subárbol; quien dirige pasa la raíz. */
export async function partnerBoard(ctx: Ctx, rootIds: string[]): Promise<Partial<Record<MetricKey, BoardValue>>> {
  if (!rootIds.length) return {}
  return withUser(ctx.user.id, async (tx) => {
    const [r] = await tx<{ points: number; active: number; risk: number; first30: number }[]>`
      with net as (
        select a.id, a.lifecycle from crm.accounts a
         where a.kind = 'store' and a.archived_at is null and a.merged_into is null and (a.id = any(${rootIds}::uuid[]) or a.ancestor_ids && ${rootIds}::uuid[]))
      select count(*)::int as points, count(*) filter (where lifecycle = 'active')::int as active,
             count(*) filter (where lifecycle in ('at_risk','inactive'))::int as risk,
             (select count(*)::int from crm.account_milestones mm where mm.account_id in (select id from net) and mm.first_txn_at > now() - interval '30 days') as first30
        from net`
    const tier = await tx<{ es: string | null; en: string | null }[]>`
      select string_agg(t.name_es, ', ') as es, string_agg(t.name_en, ', ') as en from crm.partner_profiles p
        join crm.partner_tiers t on t.market_code = p.market_code and t.code = p.tier_code
       where p.account_id = any(${rootIds}::uuid[]) and p.ended_at is null`
    return {
      partnerPoints: { value: r!.points },
      partnerActive: { value: r!.active },
      partnerActiveRate: r!.points ? { value: Math.round((r!.active / r!.points) * 100), pct: true } : { value: null },
      partnerFirstSale30: { value: r!.first30 },
      partnerAtRisk: { value: r!.risk },
      partnerTier: { value: ctx.locale === 'en' ? tier[0]?.en ?? null : tier[0]?.es ?? null },
    }
  })
}

// ------------------------------------------------------------------ Finanzas: costo de CONTIGO (GOB-09)
export type CostMonth = { month: string; cost: number; reference: number; people: number | null; accounts: number | null; aiActions: number; aiCost: number }
export async function costByMonth(ctx: Ctx, months = 6): Promise<CostMonth[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ month: string; cost: string; reference: string }[]>`
      select month::text, coalesce(sum(amount_usd) filter (where kind = 'cost'), 0)::text as cost, coalesce(sum(amount_usd) filter (where kind = 'reference'), 0)::text as reference
        from crm.cost_entries where voided_at is null group by month order by month desc limit ${months}`
    const ai = await tx<{ month: string; actions: number; call_cost_usd: string; entry_cost_usd: string }[]>`
      select month::text, actions, call_cost_usd::text, entry_cost_usd::text
        from app.ai_action_costs((date_trunc('month', now()) - make_interval(months => ${months - 1}))::date, date_trunc('month', now())::date)`
    const byMonth = new Map(ai.map((a) => [a.month, a]))
    const allMonths = [...new Set([...rows.map((r) => r.month), ...ai.filter((a) => a.actions > 0 || Number(a.entry_cost_usd) > 0).map((a) => a.month)])].sort().reverse().slice(0, months)
    const out: CostMonth[] = []
    for (const month of allMonths) {
      const r = rows.find((x) => x.month === month)
      const den = await tx<{ active_people: number | null; managed_accounts: number | null }[]>`select * from app.cost_denominators(${month}::date)`
      const a = byMonth.get(month)
      out.push({ month, cost: Number(r?.cost ?? 0), reference: Number(r?.reference ?? 0), people: den[0]?.active_people ?? null, accounts: den[0]?.managed_accounts ?? null,
        aiActions: a?.actions ?? 0, aiCost: Number(a?.call_cost_usd ?? 0) + Number(a?.entry_cost_usd ?? 0) })
    }
    return out
  })
}

/** Cifras de costo para el tablero de Finanzas, del mes más reciente con datos. Sin costos cargados no hay cifra: se dice. */
export function financeValues(costs: CostMonth[]): Partial<Record<MetricKey, BoardValue>> {
  const m = costs.find((c) => c.cost > 0)
  const ai = costs[0]
  return {
    financeCostMonth: m ? { value: m.cost, hint: [`Mes ${m.month.slice(0, 7)}.`, `Month ${m.month.slice(0, 7)}.`] } : { value: null },
    financeCostPerPerson: m && m.people ? { value: Math.round((m.cost / m.people) * 100) / 100 } : { value: null },
    financeCostPerAi: ai && ai.aiActions > 0 && ai.aiCost > 0 ? { value: Math.round((ai.aiCost / ai.aiActions) * 10000) / 10000, hint: [`${ai.aiActions} acciones de IA.`, `${ai.aiActions} AI actions.`] } : { value: null },
  }
}
