-- 0022_reportes: lo que los reportes necesitan guardar.
-- 1) Dueño de cada indicador (REP-01): quién responde por el número. Lo edita administración.
-- 2) Reportes guardados y programados (E8.F4), sus entregas dentro de CONTIGO y la cola de lo que saldría por un canal apagado.
-- 3) Foto diaria de negocios abiertos por etapa y de la cartera por estado (REP-02). La toma una función con identidad
--    propia (SECURITY DEFINER): la foto no depende de los permisos de quien corre la tarea.
-- 4) Conciliación con el archivo de ventas (REP-04) y el estado del comercio tal como lo manda el archivo.
-- 5) Señal de confianza de la visita (CAMPO-05): columnas listas para cuando la Sales App la mande.
-- 6) Vistas guardadas como colas (UX-03): también en Actividades, compartidas con un equipo y fijadas por persona.

-- ---------------------------------------------------------------- 1) dueño de cada indicador
create table crm.metric_owners (
  metric_key   text primary key check (metric_key ~ '^[a-zA-Z0-9_]{2,40}$'),
  owner_label  text not null check (char_length(btrim(owner_label)) between 2 and 80),
  updated_by   uuid not null references crm.users(id),
  updated_at   timestamptz not null default now()
);
alter table crm.metric_owners enable row level security;
alter table crm.metric_owners force row level security;
revoke all on crm.metric_owners from contigo_app;
grant select, insert, update on crm.metric_owners to contigo_app;
create policy metric_owners_read on crm.metric_owners for select to contigo_app using ((select app.current_user_id()) is not null);
create policy metric_owners_ins on crm.metric_owners for insert to contigo_app with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));
create policy metric_owners_upd on crm.metric_owners for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()) and updated_by = (select app.current_user_id()));

-- ---------------------------------------------------------------- 2) reportes guardados, entregas y cola de salida
create table crm.saved_reports (
  id           uuid primary key default app.uuid_v7(),
  user_id      uuid not null references crm.users(id),
  report       text not null check (report ~ '^[a-z0-9-]{2,40}$'),
  name         text not null check (char_length(btrim(name)) between 2 and 80),
  params       jsonb not null default '{}'::jsonb,
  is_shared    boolean not null default false,
  market_code  text references crm.markets(code),      -- con quién se comparte: las personas de ese mercado (null = de todos los suyos)
  schedule     text check (schedule in ('daily','weekly')),
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index saved_reports_user_idx on crm.saved_reports (user_id);
alter table crm.saved_reports enable row level security;
alter table crm.saved_reports force row level security;
revoke all on crm.saved_reports from contigo_app;
grant select, insert, delete on crm.saved_reports to contigo_app;
grant update (name, is_shared, schedule, last_run_at) on crm.saved_reports to contigo_app;
create policy saved_reports_read on crm.saved_reports for select to contigo_app
  using (user_id = (select app.current_user_id())
         or (is_shared and (market_code is null or market_code = any((select app.my_markets())::text[])))
         or (select app.current_user_id()) = (select app.system_user_id()));
create policy saved_reports_ins on crm.saved_reports for insert to contigo_app with check (user_id = (select app.current_user_id()));
create policy saved_reports_upd on crm.saved_reports for update to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.current_user_id()) = (select app.system_user_id()))
  with check (user_id = (select app.current_user_id()) or (select app.current_user_id()) = (select app.system_user_id()));
create policy saved_reports_del on crm.saved_reports for delete to contigo_app using (user_id = (select app.current_user_id()));

-- Lo que un reporte programado le deja a su dueño dentro de CONTIGO.
create table crm.report_deliveries (
  id               uuid primary key default app.uuid_v7(),
  saved_report_id  uuid not null references crm.saved_reports(id) on delete cascade,
  user_id          uuid not null references crm.users(id),
  title            text not null check (char_length(title) between 1 and 160),
  body             text not null check (char_length(body) between 1 and 1200),
  href             text not null check (href ~ '^/reportes'),
  seen_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index report_deliveries_user_idx on crm.report_deliveries (user_id, created_at desc);
alter table crm.report_deliveries enable row level security;
alter table crm.report_deliveries force row level security;
revoke all on crm.report_deliveries from contigo_app;
grant select, insert on crm.report_deliveries to contigo_app;
grant update (seen_at) on crm.report_deliveries to contigo_app;
create policy report_deliveries_read on crm.report_deliveries for select to contigo_app using (user_id = (select app.current_user_id()));
create policy report_deliveries_ins on crm.report_deliveries for insert to contigo_app with check ((select app.current_user_id()) = (select app.system_user_id()));
create policy report_deliveries_upd on crm.report_deliveries for update to contigo_app using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));

-- Lo que saldría de CONTIGO por un canal que hoy está apagado (correo de un reporte programado, archivo de la foto diaria).
-- Nada se envía: la fila queda a la vista con su estado.
create table crm.report_outbox (
  id          uuid primary key default app.uuid_v7(),
  channel     text not null check (channel in ('email','snapshot_file')),
  ref         text not null,
  title       text not null check (char_length(title) between 1 and 200),
  row_count   int not null default 0,
  status      text not null check (status in ('channel_off','simulated')),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (channel, ref)
);
alter table crm.report_outbox enable row level security;
alter table crm.report_outbox force row level security;
revoke all on crm.report_outbox from contigo_app;
grant select, insert on crm.report_outbox to contigo_app;
create policy report_outbox_read on crm.report_outbox for select to contigo_app using ((select app.is_global()) or (select app.current_user_id()) = (select app.system_user_id()));
create policy report_outbox_ins on crm.report_outbox for insert to contigo_app with check ((select app.current_user_id()) = (select app.system_user_id()));

-- ---------------------------------------------------------------- 3) foto diaria
create table crm.pipeline_snapshots (
  snapshot_date  date not null,
  market_code    text not null references crm.markets(code),
  pipeline_id    uuid not null references crm.pipelines(id),
  stage_id       uuid not null references crm.stages(id),
  deals          int not null,
  no_next_step   int not null,
  amount_minor   bigint not null default 0,
  currency       char(3) not null,
  taken_at       timestamptz not null default now(),
  primary key (snapshot_date, stage_id)
);
create table crm.portfolio_snapshots (
  snapshot_date  date not null,
  market_code    text not null references crm.markets(code),
  lifecycle      text not null,
  accounts       int not null,
  taken_at       timestamptz not null default now(),
  primary key (snapshot_date, market_code, lifecycle)
);
do $$ declare t text; begin
  foreach t in array array['pipeline_snapshots','portfolio_snapshots'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format('revoke all on crm.%I from contigo_app', t);
    execute format('grant select on crm.%I to contigo_app', t);
    execute format('create policy %I on crm.%I for select to contigo_app using (market_code = any((select app.full_markets())::text[]))', t || '_read', t);
  end loop;
end $$;

-- La foto la toma esta función, no la persona: cuenta TODOS los negocios abiertos y TODA la cartera de cada mercado vivo,
-- con el "hoy" de la zona horaria del mercado. Volver a correrla el mismo día reemplaza la foto de ese día.
create function app.take_report_snapshots() returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int := 0; k int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into crm.pipeline_snapshots (snapshot_date, market_code, pipeline_id, stage_id, deals, no_next_step, amount_minor, currency)
  select (now() at time zone mk.timezone)::date, s_mk.market_code, s_mk.pipeline_id, s_mk.stage_id,
         count(d.id)::int, count(d.id) filter (where d.next_step_due is null or d.next_step_due < (now() at time zone mk.timezone)::date)::int,
         coalesce(sum(d.amount_minor), 0), mk.currency
    from (select p.market_code, p.id as pipeline_id, s.id as stage_id from crm.pipelines p join crm.stages s on s.pipeline_id = p.id where s.kind in ('open','awaiting_txn')) s_mk
    join crm.markets mk on mk.code = s_mk.market_code and mk.status = 'live'
    left join crm.deals d on d.stage_id = s_mk.stage_id and d.status = 'open'
   group by 1, 2, 3, 4, mk.currency
  on conflict (snapshot_date, stage_id) do update set deals = excluded.deals, no_next_step = excluded.no_next_step, amount_minor = excluded.amount_minor, taken_at = now();
  get diagnostics k = row_count; n := n + k;
  insert into crm.portfolio_snapshots (snapshot_date, market_code, lifecycle, accounts)
  select (now() at time zone mk.timezone)::date, a.market_code, a.lifecycle, count(*)::int
    from crm.accounts a join crm.markets mk on mk.code = a.market_code and mk.status = 'live'
   where a.archived_at is null and a.kind = 'store'
   group by 1, 2, 3
  on conflict (snapshot_date, market_code, lifecycle) do update set accounts = excluded.accounts, taken_at = now();
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function app.take_report_snapshots() from public;
grant execute on function app.take_report_snapshots() to contigo_app;

-- ---------------------------------------------------------------- 4) conciliación con el archivo de ventas
alter table crm.merchant_metrics_daily add column status text check (status in ('active','at_risk','inactive'));

create table crm.reconciliation_runs (
  id                uuid primary key default app.uuid_v7(),
  market_code       text not null references crm.markets(code),
  as_of             date,
  won_by_txn        int not null,     -- ganados por primera venta en CONTIGO
  first_txn_in_file int not null,     -- comercios con primera venta en el archivo
  won_without_txn   int not null,     -- ganados por primera venta sin primera venta en el archivo
  txn_without_won   int not null,     -- con primera venta en el archivo y negocio todavía abierto
  date_mismatch     int not null,     -- ganados cuya fecha no es la de la primera venta
  status_mismatch   int not null,     -- comercios cuyo estado no es el que manda el archivo
  threshold_pct     numeric(5,2) not null,
  breached          boolean not null,
  ran_at            timestamptz not null default now()
);
create index reconciliation_runs_idx on crm.reconciliation_runs (market_code, ran_at desc);
alter table crm.reconciliation_runs enable row level security;
alter table crm.reconciliation_runs force row level security;
revoke all on crm.reconciliation_runs from contigo_app;
grant select on crm.reconciliation_runs to contigo_app;
create policy reconciliation_runs_read on crm.reconciliation_runs for select to contigo_app using (market_code = any((select app.full_markets())::text[]));

-- Las diferencias, una fila por comercio. La usan la pantalla (con RLS de quien mira: security invoker) y la corrida.
create view crm.reconciliation_diffs with (security_invoker = true) as
  with latest as (
    select distinct on (mm.account_id) mm.account_id, mm.market_code, mm.as_of, mm.first_txn_at, mm.status
      from crm.merchant_metrics_daily mm order by mm.account_id, mm.as_of desc
  )
  select a.id as account_id, a.market_code, a.owner_id, a.name, l.as_of, l.first_txn_at, d.id as deal_id, d.won_at,
         case
           when d.status = 'won' and d.closed_by = 'transaction' and l.first_txn_at is null then 'won_without_txn'
           when d.status = 'open' and l.first_txn_at is not null then 'txn_without_won'
           when d.status = 'won' and d.closed_by = 'transaction' and l.first_txn_at is not null
                and (d.won_at at time zone mk.timezone)::date <> (l.first_txn_at at time zone mk.timezone)::date then 'date_mismatch'
         end as kind
    from crm.deals d
    join crm.accounts a on a.id = d.account_id
    join crm.markets mk on mk.code = a.market_code
    join crm.pipelines p on p.id = d.pipeline_id and p.close_by_transaction
    left join latest l on l.account_id = a.id
   where (d.status = 'won' and d.closed_by = 'transaction') or (d.status = 'open' and l.first_txn_at is not null)
  union all
  select a.id, a.market_code, a.owner_id, a.name, l.as_of, l.first_txn_at, null::uuid, null::timestamptz, 'status_mismatch'
    from latest l join crm.accounts a on a.id = l.account_id
   where l.status is not null and a.archived_at is null and a.lifecycle in ('active','at_risk','inactive') and a.lifecycle <> l.status;
revoke all on crm.reconciliation_diffs from public;
grant select on crm.reconciliation_diffs to contigo_app;

create function app.run_reconciliation(p_threshold numeric) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into crm.reconciliation_runs (market_code, as_of, won_by_txn, first_txn_in_file, won_without_txn, txn_without_won, date_mismatch, status_mismatch, threshold_pct, breached)
  select mk.code,
         (select max(mm.as_of) from crm.merchant_metrics_daily mm where mm.market_code = mk.code),
         x.won_by_txn, x.first_txn, x.a, x.b, x.c, x.d, p_threshold,
         (x.a + x.b + x.c) * 100.0 > p_threshold * greatest(x.won_by_txn, x.first_txn, 1)
    from crm.markets mk
    cross join lateral (
      select (select count(*)::int from crm.deals d where d.market_code = mk.code and d.status = 'won' and d.closed_by = 'transaction') as won_by_txn,
             (select count(distinct mm.account_id)::int from crm.merchant_metrics_daily mm where mm.market_code = mk.code and mm.first_txn_at is not null) as first_txn,
             (select count(*)::int from crm.reconciliation_diffs r where r.market_code = mk.code and r.kind = 'won_without_txn') as a,
             (select count(*)::int from crm.reconciliation_diffs r where r.market_code = mk.code and r.kind = 'txn_without_won') as b,
             (select count(*)::int from crm.reconciliation_diffs r where r.market_code = mk.code and r.kind = 'date_mismatch') as c,
             (select count(*)::int from crm.reconciliation_diffs r where r.market_code = mk.code and r.kind = 'status_mismatch') as d
    ) x
   where mk.status = 'live';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.run_reconciliation(numeric) from public;
grant execute on function app.run_reconciliation(numeric) to contigo_app;

-- ---------------------------------------------------------------- 5) señal de confianza de la visita
-- La calcula la Sales App; CONTIGO solo la guarda cuando llegue. Sin ubicación ni fotos.
alter table crm.visits
  add column trust_score smallint check (trust_score is null or trust_score between 0 and 100),
  add column trust_flags text[] not null default '{}';

-- ---------------------------------------------------------------- 6) vistas guardadas como colas
alter table crm.saved_views drop constraint saved_views_object_check;
alter table crm.saved_views add constraint saved_views_object_check check (object in ('account','lead','deal','activity'));
alter table crm.saved_views add constraint saved_views_name_check check (char_length(btrim(name)) between 2 and 60);
alter table crm.saved_views add column team_id uuid references crm.teams(id);   -- compartida con un equipo; null y compartida = de todos
create index saved_views_user_idx on crm.saved_views (user_id, object);

create function app.my_team_ids() returns uuid[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(array(select distinct team_id from app.active_memberships() where team_id is not null), '{}')
$$;
revoke execute on function app.my_team_ids() from public;
grant execute on function app.my_team_ids() to contigo_app;

-- Uso real (GOB-03): cuántas veces abrió quien supervisa el tablero de su equipo. Solo conteos; el alcance lo decide la función.
create function app.team_board_views(p_since timestamptz) returns table (team_id uuid, views int)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select m.team_id, count(e.id)::int
    from crm.memberships m
    left join crm.usage_events e on e.user_id = m.user_id and e.event = 'view.supervisor' and e.at >= p_since
   where m.role = 'supervisor' and m.team_id is not null and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
     and (m.market_code = any(app.full_markets()) or m.team_id = any(app.my_team_ids()))
   group by m.team_id
$$;
revoke execute on function app.team_board_views(timestamptz) from public;
grant execute on function app.team_board_views(timestamptz) to contigo_app;

drop policy saved_views_read on crm.saved_views;
create policy saved_views_read on crm.saved_views for select to contigo_app
  using (user_id = (select app.current_user_id())
         or (is_shared and (team_id is null
                            or team_id = any((select app.my_team_ids())::uuid[])
                            or exists (select 1 from crm.teams t where t.id = saved_views.team_id and t.market_code = any((select app.full_markets())::text[])))));

create table crm.saved_view_pins (
  user_id    uuid not null references crm.users(id),
  view_id    uuid not null references crm.saved_views(id) on delete cascade,
  pinned_at  timestamptz not null default now(),
  primary key (user_id, view_id)
);
alter table crm.saved_view_pins enable row level security;
alter table crm.saved_view_pins force row level security;
revoke all on crm.saved_view_pins from contigo_app;
grant select, insert, delete on crm.saved_view_pins to contigo_app;
create policy saved_view_pins_all on crm.saved_view_pins for all to contigo_app
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
