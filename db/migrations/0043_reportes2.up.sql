-- 0043 reportes2 (ola 6, residuos): rol de Finanzas, rol KAM, tableros por rol con indicadores configurables, pronóstico por
-- categoría con envíos versionados, foto diaria por equipo con ventana corta, guarda de fecha de corte del archivo de ventas,
-- avisos de calidad del dato, eventos de uso en el outbox, costo por acción de IA, identidad de la persona en otros sistemas
-- y vistas guardadas de personas (contactos).

-- ============================================================ 1) roles: Finanzas (solo lectura) y KAM (vende cuentas clave)
alter table crm.memberships drop constraint memberships_role_check;
alter table crm.memberships add constraint memberships_role_check
  check (role in ('admin','lt','market_lead','supervisor','rep','ops','agency','partner','finance','kam'));

create or replace function app.is_finance() returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships() where role = 'finance')
$$;
revoke execute on function app.is_finance() from public;
grant execute on function app.is_finance() to contigo_app;

-- Finanzas lee todo su mercado (como quien lidera), pero no escribe: no entra en write_markets.
create or replace function app.full_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_global()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','ops','finance')), '{}')
         end
$$;

-- KAM: vende y lleva cuentas clave. Para la base es quien vende (lleva registros, escribe en su mercado).
create or replace function app.owner_roles() returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array['rep','supervisor','market_lead','ops','agency','kam']::text[]
$$;
create or replace function app.write_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships()
                              where role in ('market_lead','supervisor','rep','ops','agency','kam')), '{}')
         end
$$;
create or replace function app.sell_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce((select array_agg(distinct market_code) from app.active_memberships() where role in ('rep','kam')), '{}')
$$;
create or replace function app.can_sell_in(p_user uuid, p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (
    select 1 from crm.users u
      join crm.memberships m on m.user_id = u.id
     where u.id = p_user and u.is_active and not u.is_system
       and m.market_code = p_market and m.role in ('rep','supervisor','market_lead','kam')
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$$;
create or replace function app.works_in(p_user uuid, p_market text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (
    select 1 from crm.users u
      join crm.memberships m on m.user_id = u.id
     where u.id = p_user and u.is_active and not u.is_system
       and (m.role = 'admin' or (m.market_code = p_market and m.role in ('rep','supervisor','market_lead','ops','kam')))
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
$$;

-- Finanzas lee los costos de CONTIGO (GOB-09) para su reporte mensual.
create policy cost_entries_finance_read on crm.cost_entries for select to contigo_app using ((select app.is_finance()));

-- GOB-09 / IA-08: costo por acción de IA por mes. Acciones = llamadas de IA de personas y tareas (sin las de evaluación);
-- costo = lo que registró cada llamada más lo cargado a mano en el componente IA. Sin nombres.
create or replace function app.ai_action_costs(p_from date, p_to date)
returns table (month date, actions integer, call_cost_usd numeric, entry_cost_usd numeric)
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  with months as (select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date as month)
  select m.month,
         (select count(*)::int from crm.ia_calls c where c.via <> 'eval' and c.created_at >= m.month::timestamptz and c.created_at < (m.month + interval '1 month')::timestamptz),
         (select coalesce(sum(c.cost_usd), 0) from crm.ia_calls c where c.via <> 'eval' and c.created_at >= m.month::timestamptz and c.created_at < (m.month + interval '1 month')::timestamptz),
         (select coalesce(sum(e.amount_usd), 0) from crm.cost_entries e where e.kind = 'cost' and e.component = 'ai' and e.voided_at is null and e.month = m.month)
    from months m
   where (select app.is_global()) or (select app.is_finance())
   order by m.month desc
$$;
revoke all on function app.ai_action_costs(date, date) from public;
grant execute on function app.ai_action_costs(date, date) to contigo_app;

-- Denominadores del costo unitario: los mismos de 0028, también para Finanzas.
create or replace function app.cost_denominators(p_month date)
returns table (active_people integer, managed_accounts integer)
language sql stable security definer set search_path = pg_catalog, crm, app as $$
  select
    case when (select app.is_global()) or (select app.is_finance()) then (
      select count(distinct e.actor_id)::int from crm.audit_events e join crm.users u on u.id = e.actor_id
       where e.action = 'session.started' and not u.is_system
         and e.at >= p_month::timestamptz and e.at < (p_month + interval '1 month')::timestamptz) end,
    case when (select app.is_global()) or (select app.is_finance()) then (
      select count(*)::int from crm.accounts a
       where a.owner_id is not null and a.merged_into is null
         and a.created_at < (p_month + interval '1 month')::timestamptz
         and (a.archived_at is null or a.archived_at >= (p_month + interval '1 month')::timestamptz)) end
$$;

-- ============================================================ 2) REP-01: tablero por rol con 5 a 7 indicadores, cada uno con dueño
-- La lista la propone el producto y la confirma C1: mientras `confirmed` sea falso, la pantalla lo dice ("Valor propuesto").
create table crm.role_boards (
  id            uuid primary key default app.uuid_v7(),
  role          text not null check (role in ('kam','partner','ops','finance','rep','supervisor','market_lead','lt')),
  position      int not null check (position between 1 and 7),
  metric_key    text not null check (char_length(metric_key) between 3 and 60),
  owner_label   text check (owner_label is null or char_length(btrim(owner_label)) between 2 and 80),
  pending_owner text not null default 'C1 (Yamil Alvarez)' check (char_length(pending_owner) between 2 and 80),
  confirmed     boolean not null default false,
  updated_by    uuid references crm.users(id),
  updated_at    timestamptz not null default now(),
  unique (role, metric_key),
  unique (role, position)
);
alter table crm.role_boards enable row level security;
alter table crm.role_boards force row level security;
revoke all on crm.role_boards from contigo_app;
grant select, insert, update, delete on crm.role_boards to contigo_app;
create policy role_boards_read on crm.role_boards for select to contigo_app using ((select app.current_user_id()) is not null);
create policy role_boards_ins on crm.role_boards for insert to contigo_app with check ((select app.has_area('config')));
create policy role_boards_upd on crm.role_boards for update to contigo_app using ((select app.has_area('config'))) with check ((select app.has_area('config')));
create policy role_boards_del on crm.role_boards for delete to contigo_app using ((select app.has_area('config')));
create trigger zz_audit_capture after insert or update or delete on crm.role_boards for each row execute function audit.capture('config');

insert into crm.role_boards (role, position, metric_key) values
  ('kam', 1, 'kamAccounts'), ('kam', 2, 'kamStoresActive'), ('kam', 3, 'kamOpen'), ('kam', 4, 'kamCommit'), ('kam', 5, 'kamNoNextStep'), ('kam', 6, 'kamWon90'),
  ('partner', 1, 'partnerPoints'), ('partner', 2, 'partnerActive'), ('partner', 3, 'partnerActiveRate'), ('partner', 4, 'partnerFirstSale30'), ('partner', 5, 'partnerAtRisk'), ('partner', 6, 'partnerTier'),
  ('ops', 1, 'opsQueue'), ('ops', 2, 'opsOverdue'), ('ops', 3, 'opsReturned'), ('ops', 4, 'opsPullThrough'), ('ops', 5, 'opsAwaitingFirstSale'), ('ops', 6, 'opsHandoffsOpen'),
  ('finance', 1, 'financeWon'), ('finance', 2, 'financeUsd'), ('finance', 3, 'financeCostMonth'), ('finance', 4, 'financeCostPerPerson'), ('finance', 5, 'financeCostPerAi');

-- ============================================================ 3) REP-03: categoría de pronóstico en la oportunidad y envíos versionados
create table crm.deal_forecast (
  deal_id            uuid primary key references crm.deals(id),
  market_code        text not null references crm.markets(code),
  category           text not null check (category in ('commit','best_case','pipeline','omitted')),
  set_by             uuid not null references crm.users(id),
  set_at             timestamptz not null default now(),
  -- El ajuste de quien dirige no borra lo que dijo quien lleva la cuenta: queda al lado, con su nota.
  manager_category   text check (manager_category in ('commit','best_case','pipeline','omitted')),
  manager_note       text check (manager_note is null or char_length(btrim(manager_note)) between 3 and 300),
  adjusted_by        uuid references crm.users(id),
  adjusted_at        timestamptz,
  constraint deal_forecast_adjust check ((manager_category is null) = (adjusted_by is null))
);
alter table crm.deal_forecast enable row level security;
alter table crm.deal_forecast force row level security;
revoke all on crm.deal_forecast from contigo_app;
grant select, insert, update on crm.deal_forecast to contigo_app;
-- Se ve si se ve el negocio (la subconsulta corre con la RLS de quien pregunta). Se escribe en los mercados donde se escribe.
create policy deal_forecast_read on crm.deal_forecast for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_forecast.deal_id));
create policy deal_forecast_ins on crm.deal_forecast for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.deals d where d.id = deal_forecast.deal_id));
create policy deal_forecast_upd on crm.deal_forecast for update to contigo_app
  using (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.deals d where d.id = deal_forecast.deal_id))
  with check (market_code = any((select app.write_markets())::text[]));
create trigger zz_audit_capture after insert or update or delete on crm.deal_forecast for each row execute function audit.capture('data');

-- Un envío guarda la foto completa (negocio, monto, categoría, quién lo lleva y su territorio) por valor, no por referencia:
-- reorganizar territorios o pasar cuentas no cambia lo que se envió. Cada envío del mismo periodo sube la versión.
create table crm.forecast_submissions (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  submitted_by  uuid not null references crm.users(id),
  submitter_name text not null,
  team_id       uuid references crm.teams(id),
  team_name     text,
  period_from   date not null,
  period_to     date not null check (period_to >= period_from),
  version       int not null check (version >= 1),
  totals        jsonb not null,
  rows          jsonb not null,
  note          text check (note is null or char_length(btrim(note)) between 3 and 500),
  submitted_at  timestamptz not null default now(),
  unique (submitted_by, market_code, period_from, version)
);
alter table crm.forecast_submissions enable row level security;
alter table crm.forecast_submissions force row level security;
revoke all on crm.forecast_submissions from contigo_app;
grant select, insert on crm.forecast_submissions to contigo_app;
create policy forecast_submissions_read on crm.forecast_submissions for select to contigo_app using (
  submitted_by = (select app.current_user_id()) or market_code = any((select app.full_markets())::text[])
  or submitted_by = any((select app.supervised_user_ids())::uuid[]));
create policy forecast_submissions_ins on crm.forecast_submissions for insert to contigo_app
  with check (submitted_by = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[]));
create trigger zz_audit_capture after insert on crm.forecast_submissions for each row execute function audit.capture('data');

-- ============================================================ 4) AUT-06 / REP-04: archivo de ventas
-- Manifiesto obligatorio: dato configurable. Valor propuesto apagado hasta que Data y Reportería entregue el manifiesto en cada archivo.
insert into crm.settings (key, value) values
  ('ingest.require_manifest', '{"value": false, "proposed": true, "pending": "Roxanna Quintero (S5)"}'::jsonb)
on conflict (key) do nothing;
-- REP-04: TPV por producto y comisión, si el archivo los trae (opcionales en el contrato). CONTIGO no los calcula.
alter table crm.merchant_metrics_daily
  add column tpv_by_product jsonb check (tpv_by_product is null or jsonb_typeof(tpv_by_product) = 'array'),
  add column commission_minor_30d bigint check (commission_minor_30d is null or commission_minor_30d >= 0);

-- ============================================================ 5) REP-02: foto por equipo (supervisión ve la de su equipo) y ventana corta
create table crm.team_snapshots (
  snapshot_date  date not null,
  market_code    text not null references crm.markets(code),
  team_id        uuid not null references crm.teams(id),
  open_deals     int not null,
  no_next_step   int not null,
  active_accounts int not null,
  at_risk_accounts int not null,
  taken_at       timestamptz not null default now(),
  exported_at    timestamptz,
  primary key (snapshot_date, team_id)
);
alter table crm.team_snapshots enable row level security;
alter table crm.team_snapshots force row level security;
revoke all on crm.team_snapshots from contigo_app;
grant select on crm.team_snapshots to contigo_app;
create policy team_snapshots_read on crm.team_snapshots for select to contigo_app
  using (market_code = any((select app.full_markets())::text[]) or team_id = any((select app.my_team_ids())::uuid[]));
alter table crm.pipeline_snapshots add column exported_at timestamptz;
alter table crm.portfolio_snapshots add column exported_at timestamptz;
create index pipeline_snapshots_date_idx on crm.pipeline_snapshots (snapshot_date);
create index portfolio_snapshots_date_idx on crm.portfolio_snapshots (snapshot_date);

-- Ventana corta en CONTIGO (el histórico largo vive en el lakehouse). Solo se borra lo que ya se entregó en archivo:
-- con el canal apagado nada se marca como entregado y nada se borra.
insert into crm.settings (key, value) values
  ('snapshots.window_days', '{"value": 90, "proposed": true, "pending": "Roxanna Quintero (S5)"}'::jsonb)
on conflict (key) do nothing;

create or replace function app.take_team_snapshots() returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into crm.team_snapshots (snapshot_date, market_code, team_id, open_deals, no_next_step, active_accounts, at_risk_accounts)
  select (now() at time zone mk.timezone)::date, t.market_code, t.id,
         (select count(*)::int from crm.deals d join crm.memberships m on m.user_id = d.owner_id and m.team_id = t.id and (m.valid_to is null or m.valid_to > now())
           where d.status = 'open' and d.market_code = t.market_code),
         (select count(*)::int from crm.deals d join crm.memberships m on m.user_id = d.owner_id and m.team_id = t.id and (m.valid_to is null or m.valid_to > now())
           where d.status = 'open' and d.market_code = t.market_code and (d.next_step is null or d.next_step_due is null)),
         (select count(*)::int from crm.accounts a join crm.memberships m on m.user_id = a.owner_id and m.team_id = t.id and (m.valid_to is null or m.valid_to > now())
           where a.archived_at is null and a.kind = 'store' and a.lifecycle = 'active' and a.market_code = t.market_code),
         (select count(*)::int from crm.accounts a join crm.memberships m on m.user_id = a.owner_id and m.team_id = t.id and (m.valid_to is null or m.valid_to > now())
           where a.archived_at is null and a.kind = 'store' and a.lifecycle = 'at_risk' and a.market_code = t.market_code)
    from crm.teams t join crm.markets mk on mk.code = t.market_code and mk.status = 'live'
  on conflict (snapshot_date, team_id) do update set open_deals = excluded.open_deals, no_next_step = excluded.no_next_step,
    active_accounts = excluded.active_accounts, at_risk_accounts = excluded.at_risk_accounts, taken_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.take_team_snapshots() from public;
grant execute on function app.take_team_snapshots() to contigo_app;

-- Poda de la ventana corta: solo filas ya entregadas al lakehouse y más viejas que la ventana. Devuelve cuántas borró.
create or replace function app.prune_report_snapshots(p_days int) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int := 0; k int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days < 30 then raise exception 'window too short' using errcode = '22023'; end if;
  delete from crm.pipeline_snapshots where exported_at is not null and snapshot_date < current_date - p_days; get diagnostics k = row_count; n := n + k;
  delete from crm.portfolio_snapshots where exported_at is not null and snapshot_date < current_date - p_days; get diagnostics k = row_count; n := n + k;
  delete from crm.team_snapshots where exported_at is not null and snapshot_date < current_date - p_days; get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function app.prune_report_snapshots(int) from public;
grant execute on function app.prune_report_snapshots(int) to contigo_app;

-- ============================================================ 6) GOB-02: una regla de calidad abre un aviso en la cola de Mi equipo
alter table crm.exceptions drop constraint exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind = any (array['lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low','data_quality']));
-- Qué reglas abren aviso y desde cuántos registros por persona. Valor propuesto: ninguna regla abre avisos hasta que alguien lo decida.
insert into crm.settings (key, value) values
  ('quality.exception_rules', '{"value": [], "min_failing": 5, "proposed": true, "pending": "C1 (Yamil Alvarez)"}'::jsonb)
on conflict (key) do nothing;

-- ============================================================ 7) GOB-03: uso en 1:1 y paso a despliegue configurables
create table crm.one_on_ones (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  supervisor_id uuid not null references crm.users(id),
  person_id     uuid not null references crm.users(id),
  held_on       date not null,
  used_board    boolean not null default true,
  note          text check (note is null or char_length(btrim(note)) between 3 and 300),
  created_at    timestamptz not null default now(),
  unique (supervisor_id, person_id, held_on)
);
alter table crm.one_on_ones enable row level security;
alter table crm.one_on_ones force row level security;
revoke all on crm.one_on_ones from contigo_app;
grant select, insert on crm.one_on_ones to contigo_app;
create policy one_on_ones_read on crm.one_on_ones for select to contigo_app using (
  supervisor_id = (select app.current_user_id()) or person_id = (select app.current_user_id())
  or market_code = any((select app.full_markets())::text[]) or supervisor_id = any((select app.supervised_user_ids())::uuid[]));
create policy one_on_ones_ins on crm.one_on_ones for insert to contigo_app with check (
  supervisor_id = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[])
  and person_id = any((select app.supervised_user_ids())::uuid[]) and person_id <> supervisor_id);
create trigger zz_audit_capture after insert on crm.one_on_ones for each row execute function audit.capture('data');

insert into crm.settings (key, value) values
  ('adoption.rollout_rule', '{"supervisor_weeks": 3, "one_on_ones_min": 1, "result": "active_30d", "proposed": true, "pending": "Yamil Alvarez y quienes lideran los mercados"}'::jsonb)
on conflict (key) do nothing;

-- ============================================================ 8) E8.F7: identidad de la persona en otros sistemas (S5)
create table crm.user_aliases (
  id          uuid primary key default app.uuid_v7(),
  user_id     uuid not null references crm.users(id),
  system      text not null check (system in ('s5','sales_app')),
  external_id text not null check (char_length(btrim(external_id)) between 1 and 80),
  created_by  uuid references crm.users(id),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz
);
create unique index user_aliases_one_active on crm.user_aliases (system, user_id) where valid_to is null;
create unique index user_aliases_ext_active on crm.user_aliases (system, external_id) where valid_to is null;
alter table crm.user_aliases enable row level security;
alter table crm.user_aliases force row level security;
revoke all on crm.user_aliases from contigo_app;
grant select, insert, update (valid_to) on crm.user_aliases to contigo_app;
create policy user_aliases_read on crm.user_aliases for select to contigo_app using ((select app.current_user_id()) is not null);
create policy user_aliases_ins on crm.user_aliases for insert to contigo_app with check ((select app.has_area('integrations')));
create policy user_aliases_upd on crm.user_aliases for update to contigo_app using ((select app.has_area('integrations'))) with check ((select app.has_area('integrations')));
create trigger zz_audit_capture after insert or update on crm.user_aliases for each row execute function audit.capture('config');

-- ============================================================ 9) E8.F4: vistas guardadas de personas (contactos)
alter table crm.saved_views drop constraint saved_views_object_check;
alter table crm.saved_views add constraint saved_views_object_check check (object = any (array['account','lead','deal','activity','contact']));

-- ============================================================ 10) E11.F3: plantilla de marca del pedido, por mercado (dato, no código)
insert into crm.settings (key, value) values
  ('orders.brand', '{"US": {"company": "Empower Retailer Solutions", "tagline": null, "logo_svg": null}, "proposed": true, "pending": "Marketing"}'::jsonb)
on conflict (key) do nothing;

-- ============================================================ 11) GOB-02: las diferencias con el archivo de ventas como regla de calidad con dueño
insert into crm.quality_rules (code, label_es, label_en, fix_es, fix_en, owner_role, position)
values ('s5_diff', 'Diferencias con el archivo de ventas', 'Differences with the sales file',
        'Revisa la conciliación: ganado sin primera venta, primera venta sin ganado, fecha o estado distintos.', 'Check the reconciliation: won with no first sale, first sale with no win, different date or status.',
        'market_lead', 99)
on conflict (code) do nothing;
CREATE OR REPLACE FUNCTION app.quality_measure()
 RETURNS TABLE(market_code text, team_id uuid, rule_code text, total integer, failing integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'crm', 'app', 'public', 'pg_catalog'
AS $function$
  with acct as (
    select a.id, a.market_code, a.kind, a.owner_id, a.parent_id, a.phone, a.address_line, a.locality, a.latitude, a.lifecycle, a.merchant_ref, a.updated_at,
           app.user_team(a.owner_id, a.market_code) as team_id
      from crm.accounts a where a.archived_at is null
  ), cfg as (
    select coalesce((select threshold from crm.quality_rules where code = 'stale'), 180) as stale_days
  )
  select x.market_code, x.team_id, 'no_owner', count(*)::int, (count(*) filter (where x.owner_id is null and x.parent_id is null))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_phone', count(*)::int, (count(*) filter (where x.phone is null))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_contact', count(*)::int,
         (count(*) filter (where not exists (select 1 from crm.account_contacts ac where ac.account_id = x.id and ac.valid_to is null)))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_address', count(*)::int, (count(*) filter (where x.address_line is null or x.locality is null))::int from acct x group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_coords', count(*)::int, (count(*) filter (where x.latitude is null))::int from acct x where x.kind = 'store' group by 1, 2
  union all
  select x.market_code, x.team_id, 'no_alias', count(*)::int,
         (count(*) filter (where x.merchant_ref is null and not exists (select 1 from crm.account_aliases al where al.account_id = x.id and al.valid_to is null)))::int
    from acct x where x.lifecycle <> 'prospect' group by 1, 2
  union all
  select x.market_code, x.team_id, 'stale', count(*)::int,
         (count(*) filter (where x.updated_at < now() - make_interval(days => cfg.stale_days)
            and not exists (select 1 from crm.activities ac where ac.account_id = x.id and ac.created_at > now() - make_interval(days => cfg.stale_days))
            and not exists (select 1 from crm.visits v where v.account_id = x.id and v.checked_in_at > now() - make_interval(days => cfg.stale_days))))::int
    from acct x cross join cfg group by 1, 2
  union all
  select mk.code, null::uuid, 'duplicate', (select count(*)::int from acct x where x.market_code = mk.code),
         (select count(*)::int from crm.duplicate_pairs p where p.market_code = mk.code and p.status = 'open')
    from crm.markets mk where mk.status = 'live' and mk.code = any(app.my_markets())
  union all
  select b.market_code, app.user_team(b.actor_id, b.market_code), 'bypass', count(*)::int, (count(*) filter (where b.reviewed_at is null))::int
    from crm.duplicate_bypasses b group by 1, 2
  union all
  select d.market_code, app.user_team(d.owner_id, d.market_code), 'deal_no_step', count(*)::int, (count(*) filter (where d.next_step is null or d.next_step_due is null))::int
    from crm.deals d where d.status = 'open' group by 1, 2
  union all
  select p.market_code, null::uuid, 'provider_late', count(*)::int,
         (count(*) filter (where k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days)))::int
    from crm.account_products p left join crm.ops_catalog k on k.id = p.provider_id where p.status = 'submitted' group by 1
  union all
  select d.market_code, app.user_team(d.owner_id, d.market_code), 'stage_fields', count(*)::int,
         (count(*) filter (where exists (select 1 from crm.stages st, unnest(st.required_fields) tk where st.id = d.stage_id and tk like 'field:%' and not (d.custom ? substr(tk, 7)))))::int
    from crm.deals d where d.status = 'open' group by 1, 2
  union all
  select x.market_code, x.team_id, 'attribution_gap', count(*)::int,
         (count(*) filter (where not exists (select 1 from crm.account_attributions t where t.account_id = x.id and t.layer = 'owner' and t.effective_to is null and t.party_ref = x.owner_id::text)))::int
    from acct x where x.owner_id is not null group by 1, 2
  union all
  select mk.code, null::uuid, 'sales_unmatched', (select count(*)::int from crm.exceptions e where e.market_code = mk.code and e.kind = 'unmatched_event'),
         (select count(*)::int from crm.exceptions e where e.market_code = mk.code and e.kind = 'unmatched_event' and e.resolved_at is null)
    from crm.markets mk where mk.status = 'live' and mk.code = any(app.my_markets())
  union all
  select mk.code, null::uuid, 'field_review', count(f.id)::int,
         (count(f.id) filter (where f.decision is null or f.owner_id is null or f.review_on is null or f.review_on < (now() at time zone mk.timezone)::date))::int
    from crm.markets mk join crm.field_definitions f on f.is_active and (f.market_code is null or f.market_code = mk.code)
   where mk.status = 'live' and mk.code = any(app.my_markets()) group by mk.code
  union all
  -- reportes2 (GOB-02): diferencias con el archivo de ventas (S5) como regla, por equipo de quien lleva el comercio.
  select r.market_code, app.user_team(r.owner_id, r.market_code), 's5_diff',
         (select count(*)::int from crm.accounts a2 where a2.market_code = r.market_code and a2.archived_at is null and a2.kind = 'store' and a2.lifecycle <> 'prospect'),
         count(*)::int
    from crm.reconciliation_diffs r where r.kind is not null group by r.market_code, app.user_team(r.owner_id, r.market_code)
$function$;

-- ============================================================ 12) REP-01: el reporte programado también se deja en la cola del canal de Slack (apagado)
alter table crm.report_outbox drop constraint report_outbox_channel_check;
alter table crm.report_outbox add constraint report_outbox_channel_check check (channel in ('email','snapshot_file','scheduled_slack'));

-- GOB-02: el aviso de calidad es de la persona (no de un comercio): quien la supervisa lo ve en la cola de su equipo.
create policy exceptions_quality_team_read on crm.exceptions for select to contigo_app
  using (kind = 'data_quality' and owner_id = any((select app.supervised_user_ids())::uuid[]));
