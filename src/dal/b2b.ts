import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type AccountType = { id: string; code: string; label_es: string; label_en: string; kind: string; market_code: string | null; is_active: boolean; in_use: number }

/** Tipos de cuenta que se ofrecen en un mercado: los de todos los mercados y los propios. */
export async function accountTypes(ctx: Ctx, market: string): Promise<{ code: string; label_es: string; label_en: string; kind: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; label_es: string; label_en: string; kind: string }[]>`
      select distinct on (t.code) t.code, t.label_es, t.label_en, t.kind, t.position from crm.account_types t
       where t.is_active and (t.market_code is null or t.market_code = ${market}) order by t.code, t.market_code nulls last`
    return [...rows].sort((a, b) => (a as unknown as { position: number }).position - (b as unknown as { position: number }).position)
  })
}

/** Motivos de pérdida de un embudo: los de su tipo de venta y su mercado, más los que valen para todos. */
export async function lossReasonsFor(ctx: Ctx, market: string, motor: string | null): Promise<{ code: string; label_es: string; label_en: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select code, label_es, label_en from crm.loss_reasons
       where kind = 'lost' and is_active and (market_code is null or market_code = ${market}) and (motors is null or ${motor}::text = any(motors))
       order by (motors is null), position, label_es`
    return [...rows]
  })
}

/** Cuentas que pueden ser matriz de otra: las que no son tienda. Quien vende solo ve las suyas; quien dirige, las de su alcance. */
export async function parentChoices(ctx: Ctx, market: string, onlyMine: boolean): Promise<{ id: string; name: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; name: string }[]>`
      select id, name from crm.accounts where market_code = ${market} and kind <> 'store' and archived_at is null
        ${onlyMine ? tx`and owner_id = ${ctx.user.id}` : tx``} order by name limit 200`
    return [...rows]
  })
}

/** Lo que administración configura desde la pantalla para la venta B2B: tipos de cuenta, etapas archivadas, campos, motivos y formularios. */
export async function getB2bConfig(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const types = await tx<AccountType[]>`
      select t.id, t.code, t.label_es, t.label_en, t.kind, t.market_code, t.is_active,
             (select count(*)::int from crm.accounts a where a.account_type = t.code and a.archived_at is null and (t.market_code is null or a.market_code = t.market_code)) as in_use
        from crm.account_types t order by t.position, t.label_es`
    const archived = await tx<{ id: string; pipeline_id: string; name_es: string; name_en: string; archived_at: Date }[]>`
      select id, pipeline_id, name_es, name_en, archived_at from crm.stages where archived_at is not null order by archived_at desc`
    const stageDeals = await tx<{ stage_id: string; n: number }[]>`
      select stage_id, count(*)::int as n from crm.deals where status = 'open' group by stage_id`
    const fields = await tx<{ id: string; object: string; key: string; label_es: string; label_en: string; data_type: string; market_code: string | null; motor: string | null; is_active: boolean; in_intake: boolean; source: string; only_when: string | null }[]>`
      select id, object, key, label_es, label_en, data_type, market_code, motor, is_active, in_intake, source, applies_when ->> 'equals' as only_when from crm.field_definitions
       where source = 'manual' and object in ('account', 'deal', 'lead') order by object, position, label_es`
    const reasons = await tx<{ code: string; label_es: string; label_en: string; market_code: string | null; motors: string[] | null; is_active: boolean }[]>`
      select code, label_es, label_en, market_code, motors, is_active from crm.loss_reasons where kind = 'lost' order by (motors is null) desc, position, label_es`
    const forms = await tx<{ id: string; name: string; slug: string; market_code: string; motor: string; ask_fields: string[]; account_type: string | null }[]>`
      select id, name, slug, market_code, motor, ask_fields, account_type from crm.web_forms where is_active order by market_code, name`
    const markets = await tx<{ code: string; name: string }[]>`select code, name from crm.markets order by code`
    return { types: [...types], archived: [...archived], stageDeals: Object.fromEntries(stageDeals.map((r) => [r.stage_id, r.n])), fields: [...fields], reasons: [...reasons], forms: [...forms], markets: [...markets] }
  })
}

/** Campos que un formulario web puede pedir además de los básicos: los de lead de su mercado y su tipo de venta. */
export async function formFields(market: string, motor: string, keys: string[] | null, userId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx<{ key: string; label_es: string; label_en: string; data_type: string; options: string[] }[]>`
      select key, label_es, label_en, data_type, options from crm.field_definitions
       where object = 'lead' and is_active and mapped_to is null and data_class <> 'confidential' and data_type in ('text', 'number', 'select', 'date', 'boolean')
         and (market_code is null or market_code = ${market}) and (motor is null or motor = ${motor})
         ${keys ? tx`and key = any(${keys}::text[])` : tx``}
       order by position, key`
    return [...rows]
  })
}

/** Equipos vigentes que hoy no tienen a nadie con rol de supervisión: los cubre quien lidera el mercado. */
export async function teamsWithoutSupervisor(ctx: Ctx): Promise<{ id: string; name: string; market_code: string; members: number; lead: string | null }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; name: string; market_code: string; members: number; lead: string | null }[]>`
      select t.id, t.name, t.market_code,
             (select count(*)::int from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
               where m.team_id = t.id and m.role = 'rep' and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())) as members,
             (select string_agg(u.full_name, ', ' order by u.full_name) from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
               where m.market_code = t.market_code and m.role = 'market_lead' and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())) as lead
        from crm.teams t
       where not exists (select 1 from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
                          where m.team_id = t.id and m.role = 'supervisor' and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
       order by t.market_code, t.name`
    return [...rows]
  })
}

/** Cambios recientes a cómo se gana un embudo, para "Estado de CONTIGO". */
export async function closeRuleChanges(ctx: Ctx): Promise<{ at: Date; actor: string | null; pipeline: string | null; market_code: string | null; by_transaction: boolean; open_deals: number | null }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ at: Date; actor: string | null; pipeline: string | null; market_code: string | null; by_transaction: boolean; open_deals: number | null }[]>`
      select e.at, u.full_name as actor, p.name as pipeline, e.market_code, (e.after ->> 'close_by_transaction')::boolean as by_transaction, (e.after ->> 'open_deals')::int as open_deals
        from crm.audit_events e left join crm.users u on u.id = e.actor_id left join crm.pipelines p on p.id = e.object_id
       where e.action = 'pipeline.configured' and (e.before ->> 'close_by_transaction') is distinct from (e.after ->> 'close_by_transaction')
       order by e.at desc limit 5`
    return [...rows]
  })
}

export type IntakeField = { key: string; label_es: string; label_en: string; data_type: string; options: string[]; market_code: string | null; motor: string | null }

/** Campos que se piden al dar de alta un comercio a mano (lo mínimo para calificar), con su mercado y tipo de venta. */
export async function intakeFields(ctx: Ctx): Promise<IntakeField[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<IntakeField[]>`
      select key, label_es, label_en, data_type, options, market_code, motor from crm.field_definitions
       where object = 'account' and is_active and in_intake and mapped_to is null and data_class <> 'confidential'
         and data_type in ('text', 'number', 'select', 'date', 'boolean')
       order by position, key`
    return [...rows]
  })
}

/** Catálogo de tipos de cuenta para el alta: los de todos los mercados y los de los mercados de la persona. */
export async function accountTypeOptions(ctx: Ctx): Promise<{ code: string; label_es: string; label_en: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; label_es: string; label_en: string; position: number }[]>`
      select distinct on (t.code) t.code, t.label_es, t.label_en, t.position from crm.account_types t
       where t.is_active and (t.market_code is null or t.market_code = any(app.my_markets())) order by t.code, t.market_code nulls last`
    return [...rows].sort((a, b) => a.position - b.position)
  })
}
