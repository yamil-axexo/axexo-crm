-- 0031_ciclo_cs: cuidado del comercio después de la venta (catálogo CS-01 a CS-08), paquete ciclo-cs del 13-nov-2026.
--
-- 1) CS-01: ciclo de vida completo (prospecto, alta, activo, hábito, en riesgo, inactivo, reactivado, perdido) con histéresis,
--    ventanas por línea de producto, historial de cambios y de dónde salió cada cambio. Entregas con dueño, fecha, lista y acuse.
-- 2) CS-03: alertas tempranas que crean tarea con guía de acción editable, grupo de control y medición a 14 y 30 días.
-- 3) CS-02: puntaje de salud por grupos de señales con peso editable, explicación guardada y validación contra lo que pasó.
-- 4) CS-04: modelo de atención derivado por reglas con histéresis.
-- 5) CS-06: constancias de capacitación (fuente Kore Academy) y cambio de encargado.
-- 6) CS-07: oportunidades de expansión sobre comercio activo.  7) CS-05: plan de cuenta, relaciones y revisiones.
-- 8) CS-08: comentarios de producto desde campo con temas fijos.
--
-- crm.accounts.lifecycle conserva sus seis valores (los leen reportes, filtros e importaciones). La etapa completa vive en
-- crm.account_care.stage y siempre es un detalle de la anterior: hábito y reactivado cuentan como "activo".

-- ================================================================ 1) ciclo de vida
create table crm.account_care (
  account_id          uuid primary key references crm.accounts(id) on delete cascade,
  market_code         text not null references crm.markets(code),
  stage               text not null check (stage in ('prospect','onboarding','active','habit','at_risk','inactive','reactivated','churned')),
  stage_at            timestamptz not null default now(),
  stage_source        text not null default 'rules' check (stage_source in ('sales_file','rules','manual','import')),
  stage_reason        text check (stage_reason is null or char_length(stage_reason) <= 200),
  product_line        text not null default 'general' check (product_line in ('general','topups','remittances','bill_pay')),
  care_owner_id       uuid references crm.users(id) on delete set null,
  care_role           text check (care_role in ('ops','cs','am')),
  service_tier        text check (service_tier in ('high','pooled','low','tech')),
  service_tier_at     timestamptz,
  service_tier_basis  text check (service_tier_basis in ('commission','volume','account_type')),
  updated_at          timestamptz not null default now()
);
create index account_care_stage_idx on crm.account_care (market_code, stage);
create index account_care_owner_idx on crm.account_care (care_owner_id) where care_owner_id is not null;

create table crm.lifecycle_events (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  from_stage   text,
  to_stage     text not null,
  source       text not null check (source in ('sales_file','rules','manual','import')),
  reason       text check (reason is null or char_length(reason) <= 200),
  actor_id     uuid references crm.users(id) on delete set null,
  at           timestamptz not null default now()
);
create index lifecycle_events_account_idx on crm.lifecycle_events (account_id, at desc);

-- Ventanas por mercado y línea de producto. Entrar a riesgo y salir de riesgo usan umbrales distintos (histéresis).
create table crm.lifecycle_windows (
  market_code        text not null references crm.markets(code),
  product_line       text not null check (product_line in ('general','topups','remittances','bill_pay')),
  risk_below         int not null default 5 check (risk_below between 1 and 20),
  recover_at         int not null default 8 check (recover_at between 2 and 25),
  habit_at           int not null default 20 check (habit_at between 5 and 31),
  habit_below        int not null default 15 check (habit_below between 3 and 30),
  churn_after_days   int not null default 90 check (churn_after_days between 31 and 365),
  min_days_in_stage  int not null default 3 check (min_days_in_stage between 0 and 30),
  calibrated_from    text not null default 'default' check (calibrated_from in ('default','manual','backtest')),
  sample             int,
  updated_by         uuid references crm.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (market_code, product_line),
  check (recover_at > risk_below and habit_below >= recover_at and habit_at > habit_below)
);

-- La ventana que le toca a un comercio: la de su línea en su mercado, si no la general del mercado, si no la de fábrica.
create function app.lifecycle_window(p_market text, p_line text)
returns table (risk_below int, recover_at int, habit_at int, habit_below int, churn_after_days int, min_days_in_stage int)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select w.risk_below, w.recover_at, w.habit_at, w.habit_below, w.churn_after_days, w.min_days_in_stage
    from (select 1) one
    left join lateral (select x.* from crm.lifecycle_windows x where x.market_code = p_market and x.product_line in (coalesce(p_line, 'general'), 'general')
                        order by (x.product_line = 'general') limit 1) f on true
    cross join lateral (select coalesce(f.risk_below, 5) as risk_below, coalesce(f.recover_at, 8) as recover_at, coalesce(f.habit_at, 20) as habit_at,
                               coalesce(f.habit_below, 15) as habit_below, coalesce(f.churn_after_days, 90) as churn_after_days,
                               coalesce(f.min_days_in_stage, 3) as min_days_in_stage) w
$$;
-- Los dos umbrales que usa la carga del archivo de ventas para su regla de respaldo.
create function app.lifecycle_risk_below(p_account uuid) returns int
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select w.risk_below from crm.accounts a left join crm.account_care c on c.account_id = a.id
    cross join lateral app.lifecycle_window(a.market_code, c.product_line) w where a.id = p_account
$$;
create function app.lifecycle_recover_at(p_account uuid) returns int
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select w.recover_at from crm.accounts a left join crm.account_care c on c.account_id = a.id
    cross join lateral app.lifecycle_window(a.market_code, c.product_line) w where a.id = p_account
$$;
revoke execute on function app.lifecycle_window(text, text), app.lifecycle_risk_below(uuid), app.lifecycle_recover_at(uuid) from public;
grant execute on function app.lifecycle_window(text, text), app.lifecycle_risk_below(uuid), app.lifecycle_recover_at(uuid) to contigo_app;

-- Cada comercio tiene su fila de cuidado desde que nace. Cuando cambia la etapa resumida (por el archivo de ventas, una
-- importación o una persona), la etapa completa la sigue y el cambio queda en el historial con su origen.
create function crm.account_care_sync() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare
  prev text;
  fine text := nullif(current_setting('app.lifecycle_stage', true), '');
  src text := nullif(current_setting('app.lifecycle_source', true), '');
  why text := nullif(current_setting('app.lifecycle_reason', true), '');
  me uuid := app.current_user_id();
begin
  if tg_op = 'INSERT' then
    insert into crm.account_care (account_id, market_code, stage, stage_at, stage_source)
    values (new.id, new.market_code, new.lifecycle, new.lifecycle_at, coalesce(src, 'import')) on conflict (account_id) do nothing;
    return null;
  end if;
  if new.market_code is distinct from old.market_code then
    update crm.account_care set market_code = new.market_code where account_id = new.id;
  end if;
  if new.lifecycle is not distinct from old.lifecycle then return null; end if;
  select c.stage into prev from crm.account_care c where c.account_id = new.id;
  if src is null then
    src := case when me is null or me = app.system_user_id() then 'rules' else 'manual' end;
  end if;
  if fine is null or (case fine when 'habit' then 'active' when 'reactivated' then 'active' else fine end) <> new.lifecycle then
    -- Volver a vender después de estar inactivo o perdido es "reactivado", no un activo cualquiera.
    fine := case when new.lifecycle = 'active' and coalesce(prev, old.lifecycle) in ('inactive','churned') then 'reactivated' else new.lifecycle end;
  end if;
  insert into crm.account_care (account_id, market_code, stage, stage_at, stage_source, stage_reason)
  values (new.id, new.market_code, fine, now(), src, why)
  on conflict (account_id) do update set stage = excluded.stage, stage_at = now(), stage_source = excluded.stage_source,
    stage_reason = excluded.stage_reason, updated_at = now();
  insert into crm.lifecycle_events (account_id, market_code, from_stage, to_stage, source, reason, actor_id)
  values (new.id, new.market_code, coalesce(prev, old.lifecycle), fine, src, why, me);
  return null;
end $$;
create trigger accounts_care_ins after insert on crm.accounts for each row execute function crm.account_care_sync();
create trigger accounts_care_upd after update of lifecycle, market_code on crm.accounts for each row execute function crm.account_care_sync();

insert into crm.account_care (account_id, market_code, stage, stage_at, stage_source)
select a.id, a.market_code, a.lifecycle, a.lifecycle_at, 'import' from crm.accounts a on conflict do nothing;

-- Señales que el archivo de ventas v1 no trae (saldo, comisión, cuántos productos usa). Llegan por su propia conexión,
-- que nace apagada. Sin ellas, las reglas que las usan lo dicen y no inventan el dato.
create table crm.care_signals (
  account_id            uuid not null references crm.accounts(id) on delete cascade,
  as_of                 date not null,
  market_code           text not null references crm.markets(code),
  balance_minor         bigint check (balance_minor is null or balance_minor >= 0),
  commission_minor_30d  bigint check (commission_minor_30d is null or commission_minor_30d >= 0),
  product_count_30d     int check (product_count_30d is null or product_count_30d between 0 and 50),
  open_tickets          int check (open_tickets is null or open_tickets >= 0),
  urgent_tickets        int check (urgent_tickets is null or urgent_tickets >= 0),
  source                text not null default 'simulated' check (source in ('sales_file','zendesk','simulated','manual')),
  loaded_at             timestamptz not null default now(),
  primary key (account_id, as_of)
);

-- Recalcula la etapa de cada comercio. Con archivo de ventas, manda el archivo; sin ninguno, cuentan las ventas que CONTIGO
-- conoce (visitas con venta y negocios ganados). Un cambio necesita cumplir su umbral Y llevar los días mínimos en la etapa:
-- un día bueno o malo no mueve a nadie. Devuelve cuántos comercios cambiaron.
create function app.lifecycle_recalc(p_market text default null, p_account uuid default null) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare
  r record; nxt text; coarse text; why text; src text; n int := 0; dwell boolean;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for r in
    select a.id, a.market_code, a.lifecycle, coalesce(c.stage, a.lifecycle) as stage, coalesce(c.stage_at, a.lifecycle_at) as stage_at,
           w.risk_below, w.recover_at, w.habit_at, w.habit_below, w.churn_after_days, w.min_days_in_stage,
           m.as_of, m.status as file_status,
           coalesce(m.active_days_30d, o.own_days, 0) as d, coalesce(m.txn_count_30d, o.own_days, 0) as txn,
           coalesce(m.first_txn_at, o.first_sale) as first_at, coalesce(m.last_txn_at, o.last_sale) as last_at,
           (m.account_id is not null) as has_file
      from crm.accounts a
      left join crm.cs_settings st on st.market_code = a.market_code
      left join crm.account_care c on c.account_id = a.id
      cross join lateral app.lifecycle_window(a.market_code, c.product_line) w
      left join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
      left join lateral (
        select count(distinct s.day) filter (where s.day > (now() at time zone mk.timezone)::date - 30)::int as own_days, min(s.at) as first_sale, max(s.at) as last_sale
          from crm.markets mk
          left join lateral (
            select v.business_date as day, v.checked_in_at as at from crm.visits v where v.account_id = a.id and v.outcome = 'sale'
            union all
            select (d.won_at at time zone mk.timezone)::date, d.won_at from crm.deals d where d.account_id = a.id and d.status = 'won' and d.won_at is not null
          ) s on true
         where mk.code = a.market_code
      ) o on true
     where a.archived_at is null and a.merged_into is null
       and (p_market is null or a.market_code = p_market) and (p_account is null or a.id = p_account)
       and (m.account_id is not null or (coalesce(st.own_rules_on, false) and o.first_sale is not null))
     order by a.id
  loop
    nxt := r.stage; why := null;
    src := case when r.has_file then 'sales_file' else 'rules' end;
    dwell := r.stage_at <= now() - make_interval(days => r.min_days_in_stage);
    if r.stage in ('prospect','onboarding') then
      -- El archivo de ventas ya activa al comercio con su primera transacción (y gana el negocio). Sin archivo, lo hace la primera venta propia.
      if r.first_at is not null and not r.has_file then nxt := 'active'; why := 'first_sale'; end if;
    elsif r.has_file and r.file_status is not null and r.lifecycle <> r.file_status and r.stage <> 'churned' then
      null;  -- el archivo trae el estado y la carga lo aplica: aquí no se le lleva la contraria
    elsif r.stage = 'active' then
      if r.d >= r.habit_at and dwell then nxt := 'habit'; why := 'habit_at';
      elsif r.d < r.risk_below and dwell and r.first_at < now() - interval '14 days' and r.file_status is null then
        nxt := case when r.txn = 0 then 'inactive' else 'at_risk' end; why := 'risk_below';
      end if;
    elsif r.stage = 'habit' then
      if r.d < r.risk_below and dwell and r.file_status is null then nxt := case when r.txn = 0 then 'inactive' else 'at_risk' end; why := 'risk_below';
      elsif r.d < r.habit_below and dwell then nxt := 'active'; why := 'habit_below';
      end if;
    elsif r.stage = 'at_risk' then
      if r.file_status is null and r.d >= r.recover_at and dwell then nxt := 'active'; why := 'recover_at';
      elsif r.file_status is null and r.txn = 0 and dwell then nxt := 'inactive'; why := 'no_sales';
      end if;
    elsif r.stage = 'inactive' then
      if r.file_status is null and r.d >= r.recover_at and dwell then nxt := 'reactivated'; why := 'recover_at';
      elsif r.last_at is not null and r.last_at < now() - make_interval(days => r.churn_after_days) and r.txn = 0 then nxt := 'churned'; why := 'churn_after_days';
      end if;
    elsif r.stage = 'churned' then
      if r.d >= r.recover_at and dwell then nxt := 'reactivated'; why := 'recover_at'; end if;
    elsif r.stage = 'reactivated' then
      if r.d < r.risk_below and dwell and r.file_status is null then nxt := case when r.txn = 0 then 'inactive' else 'at_risk' end; why := 'risk_below';
      elsif r.stage_at <= now() - interval '30 days' then
        nxt := case when r.d >= r.habit_at then 'habit' else 'active' end; why := 'settled';
      end if;
    end if;
    if nxt <> r.stage then
      coarse := case nxt when 'habit' then 'active' when 'reactivated' then 'active' else nxt end;
      if coarse <> r.lifecycle then
        perform set_config('app.lifecycle_stage', nxt, true), set_config('app.lifecycle_source', src, true), set_config('app.lifecycle_reason', coalesce(why, ''), true);
        update crm.accounts set lifecycle = coarse where id = r.id;
        perform set_config('app.lifecycle_stage', '', true), set_config('app.lifecycle_source', '', true), set_config('app.lifecycle_reason', '', true);
      else
        insert into crm.account_care (account_id, market_code, stage, stage_at, stage_source, stage_reason)
        values (r.id, r.market_code, nxt, now(), src, why)
        on conflict (account_id) do update set stage = excluded.stage, stage_at = now(), stage_source = excluded.stage_source, stage_reason = excluded.stage_reason, updated_at = now();
        insert into crm.lifecycle_events (account_id, market_code, from_stage, to_stage, source, reason, actor_id)
        values (r.id, r.market_code, r.stage, nxt, src, why, app.current_user_id());
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function app.lifecycle_recalc(text, uuid) from public;
grant execute on function app.lifecycle_recalc(text, uuid) to contigo_app;

-- Calibración con datos propios: para cada umbral posible, qué tan bien "menos de K días con venta" anticipó que el comercio
-- dejara de vender en el siguiente corte (25 días después o más). Sin muestra suficiente no sugiere nada.
create function app.lifecycle_backtest(p_market text, p_line text default 'general')
returns table (threshold int, sample int, positives int, hit_precision numeric, hit_recall numeric)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with pairs as (
    select e.account_id, e.active_days_30d as d0, (l.txn_count_30d = 0) as went_dark
      from crm.merchant_metrics_daily e
      join lateral (select x.txn_count_30d from crm.merchant_metrics_daily x
                     where x.account_id = e.account_id and x.as_of >= e.as_of + 25 order by x.as_of limit 1) l on true
      left join crm.account_care c on c.account_id = e.account_id
     where e.market_code = p_market and e.txn_count_30d > 0 and (p_line = 'general' or coalesce(c.product_line, 'general') = p_line)
       and p_market = any(app.my_markets())
  ), k as (select generate_series(2, 15) as k),
  s as (
    select k.k, count(*)::int as n, count(*) filter (where p.went_dark)::int as pos,
           count(*) filter (where p.d0 < k.k and p.went_dark)::numeric as tp,
           count(*) filter (where p.d0 < k.k)::numeric as flagged
      from k cross join pairs p group by k.k
  )
  select s.k, s.n, s.pos, case when s.flagged > 0 then round(s.tp / s.flagged, 3) end, case when s.pos > 0 then round(s.tp / s.pos, 3) end
    from s where s.n >= 30 and s.pos >= 5 order by s.k
$$;
revoke execute on function app.lifecycle_backtest(text, text) from public;
grant execute on function app.lifecycle_backtest(text, text) to contigo_app;

-- ---------------------------------------------------------------- entregas con dueño, fecha, lista y acuse
create table crm.handoffs (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id) on delete cascade,
  market_code   text not null references crm.markets(code),
  deal_id       uuid references crm.deals(id) on delete set null,
  from_role     text not null check (from_role in ('sales','ops','cs','am')),
  to_role       text not null check (to_role in ('sales','ops','cs','am')),
  from_user_id  uuid references crm.users(id) on delete set null,
  to_user_id    uuid not null references crm.users(id) on delete cascade,
  due_on        date not null,
  checklist     jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  note          text check (note is null or char_length(note) <= 500),
  status        text not null default 'pending' check (status in ('pending','acknowledged','returned')),
  ack_at        timestamptz,
  ack_by        uuid references crm.users(id) on delete set null,
  ack_note      text check (ack_note is null or char_length(ack_note) <= 500),
  activity_id   uuid references crm.activities(id) on delete set null,
  source        text not null default 'user' check (source in ('user','rule')),
  created_by    uuid references crm.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (from_role <> to_role),
  check ((status = 'pending') = (ack_at is null))
);
create index handoffs_account_idx on crm.handoffs (account_id, created_at desc);
create index handoffs_to_idx on crm.handoffs (to_user_id) where status = 'pending';
create unique index handoffs_open_uq on crm.handoffs (account_id, from_role, to_role) where status = 'pending';

-- ================================================================ 2) alertas tempranas y guías de acción
create table crm.cs_settings (
  market_code               text primary key references crm.markets(code),
  alerts_on                 boolean not null default false,
  own_rules_on              boolean not null default false,   -- mover etapas con las ventas que CONTIGO conoce cuando el comercio no tiene archivo de ventas
  no_first_sale_days        int not null default 7 check (no_first_sale_days between 1 and 60),
  drop_pct                  int not null default 40 check (drop_pct between 10 and 90),
  low_balance_minor         bigint check (low_balance_minor is null or low_balance_minor >= 0),
  holdout_pct               int not null default 10 check (holdout_pct between 0 and 50),
  escalate_days             int not null default 7 check (escalate_days between 1 and 30),
  whatsapp_cap_per_owner    int not null default 20 check (whatsapp_cap_per_owner between 0 and 500),
  health_published          boolean not null default false,
  health_published_at       timestamptz,
  health_threshold          int not null default 50 check (health_threshold between 10 and 90),
  health_decay_days         int not null default 14 check (health_decay_days between 3 and 90),
  tier_high_commission      bigint not null default 50000 check (tier_high_commission > 0),
  tier_pooled_commission    bigint not null default 10000 check (tier_pooled_commission > 0),
  tier_low_commission       bigint not null default 2000 check (tier_low_commission > 0),
  tier_commission_rate_bp   int not null default 100 check (tier_commission_rate_bp between 1 and 1000),
  tier_hysteresis_pct       int not null default 20 check (tier_hysteresis_pct between 0 and 50),
  updated_by                uuid references crm.users(id) on delete set null,
  updated_at                timestamptz not null default now(),
  check (tier_high_commission > tier_pooled_commission and tier_pooled_commission > tier_low_commission)
);
insert into crm.cs_settings (market_code) select code from crm.markets on conflict do nothing;

create table crm.playbooks (
  id           uuid primary key default app.uuid_v7(),
  market_code  text references crm.markets(code),           -- nulo: vale en todos los mercados
  alert_kind   text not null check (alert_kind in ('no_first_sale','drop_vs_baseline','low_balance','inactive','manager_change')),
  tier         text not null default 'any' check (tier in ('any','high','pooled','low','tech')),
  title_es     text not null check (char_length(title_es) between 3 and 120),
  title_en     text not null check (char_length(title_en) between 3 and 120),
  steps_es     text[] not null check (cardinality(steps_es) between 1 and 8),
  steps_en     text[] not null check (cardinality(steps_en) between 1 and 8),
  message_es   text check (message_es is null or char_length(message_es) <= 600),
  message_en   text check (message_en is null or char_length(message_en) <= 600),
  due_days     int not null default 2 check (due_days between 0 and 14),
  is_active    boolean not null default true,
  updated_by   uuid references crm.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create unique index playbooks_uq on crm.playbooks (coalesce(market_code, ''), alert_kind, tier);

insert into crm.playbooks (alert_kind, title_es, title_en, steps_es, steps_en, message_es, message_en, due_days) values
 ('no_first_sale', 'Ayudar a hacer la primera venta', 'Help with the first sale',
  array['Llama o visita al encargado y confirma que ya tiene su usuario y sabe entrar.', 'Hagan juntos una venta de prueba pequeña.', 'Si falta saldo o equipo, anótalo y avisa a Operaciones.', 'Deja fecha para volver a revisar.'],
  array['Call or visit the manager and confirm they have their login and can sign in.', 'Do a small test sale together.', 'If balance or equipment is missing, note it and tell Operations.', 'Set a date to check again.'],
  'Hola, {comercio}. Ya puedes vender con axexo. Si necesitas ayuda con tu primera venta, responde este mensaje.', 'Hi, {comercio}. You can now sell with axexo. If you need help with your first sale, reply to this message.', 2),
 ('drop_vs_baseline', 'Entender por qué vende menos', 'Find out why sales dropped',
  array['Revisa en la ficha cuánto vendía y cuánto vende ahora.', 'Pregunta al encargado qué cambió: saldo, equipo, personal o competencia.', 'Resuelve lo que esté en tus manos y registra un comentario de producto si aplica.', 'Deja fecha para revisar si se recuperó.'],
  array['Check on the merchant page how much it used to sell and how much it sells now.', 'Ask the manager what changed: balance, equipment, staff or a competitor.', 'Fix what you can and log product feedback if it applies.', 'Set a date to check whether it recovered.'],
  null, null, 2),
 ('low_balance', 'Saldo bajo: ayudar a recargar', 'Low balance: help them top up',
  array['Avisa al encargado que su saldo está por terminarse.', 'Explica cómo recargar y confirma que pudo hacerlo.'],
  array['Tell the manager the balance is about to run out.', 'Explain how to top up and confirm they managed to do it.'],
  'Hola, {comercio}. Tu saldo para vender está bajo. Recarga para no dejar de vender.', 'Hi, {comercio}. Your selling balance is low. Top up so you can keep selling.', 1),
 ('inactive', 'Recuperar a un comercio que dejó de vender', 'Win back a merchant that stopped selling',
  array['Confirma que el comercio sigue abierto y quién lo atiende.', 'Pregunta por qué dejó de vender y anota el motivo.', 'Ofrece una venta acompañada para retomar.', 'Si no va a volver, ciérralo con el motivo.'],
  array['Confirm the merchant is still open and who runs it.', 'Ask why it stopped selling and note the reason.', 'Offer a guided sale to restart.', 'If it will not come back, close it with the reason.'],
  null, null, 3),
 ('manager_change', 'Encargado nuevo: capacitarlo', 'New manager: train them',
  array['Preséntate con el encargado nuevo y actualiza el contacto en la ficha.', 'Agenda su capacitación en Kore Academy.', 'Haz una venta acompañada.'],
  array['Introduce yourself to the new manager and update the contact on the merchant page.', 'Schedule their training in Kore Academy.', 'Do a guided sale.'],
  null, null, 3);

create table crm.cs_alerts (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id) on delete cascade,
  market_code   text not null references crm.markets(code),
  kind          text not null check (kind in ('no_first_sale','drop_vs_baseline','low_balance','inactive','manager_change')),
  status        text not null default 'open' check (status in ('open','closed')),
  owner_id      uuid references crm.users(id) on delete set null,
  activity_id   uuid references crm.activities(id) on delete set null,
  playbook_id   uuid references crm.playbooks(id),
  in_holdout    boolean not null default false,
  digital_only  boolean not null default false,
  detail        jsonb not null default '{}'::jsonb,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  close_reason  text check (close_reason in ('recovered','done','dismissed')),
  closed_by     uuid references crm.users(id) on delete set null,
  close_note    text check (close_note is null or char_length(close_note) <= 300),
  returned_14d  boolean,
  returned_30d  boolean,
  check ((status = 'closed') = (closed_at is not null))
);
create unique index cs_alerts_open_uq on crm.cs_alerts (account_id, kind) where status = 'open';
create index cs_alerts_market_idx on crm.cs_alerts (market_code, status, kind);
create index cs_alerts_owner_idx on crm.cs_alerts (owner_id) where status = 'open';

create table crm.cs_messages (
  id           uuid primary key default app.uuid_v7(),
  alert_id     uuid references crm.cs_alerts(id) on delete cascade,
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  channel      text not null default 'whatsapp' check (channel in ('whatsapp')),
  body         text not null check (char_length(body) <= 600),
  status       text not null check (status in ('queued_off','simulated','skipped_consent','held_limit')),
  created_at   timestamptz not null default now()
);
create index cs_messages_market_idx on crm.cs_messages (market_code, created_at desc);

-- Grupo de control: el mismo comercio cae siempre del mismo lado. Sirve para medir si la guía de acción cambia algo.
create function app.in_holdout(p_account uuid, p_pct int) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select p_pct > 0 and (('x' || substr(md5('holdout:' || p_account::text), 1, 6))::bit(24)::int % 100) < p_pct
$$;
grant execute on function app.in_holdout(uuid, int) to contigo_app;

-- ================================================================ 3) puntaje de salud
create table crm.health_config (
  id           uuid primary key default app.uuid_v7(),
  market_code  text references crm.markets(code),           -- nulo: vale en todos los mercados
  grp          text not null check (grp in ('transactions','mix','tickets','balance')),
  weight       int not null check (weight between 0 and 100),
  is_active    boolean not null default true,
  updated_by   uuid references crm.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create unique index health_config_uq on crm.health_config (coalesce(market_code, ''), grp);
insert into crm.health_config (grp, weight) values ('transactions', 50), ('mix', 15), ('tickets', 15), ('balance', 20);

create table crm.health_snapshots (
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  as_of        date not null,
  market_code  text not null references crm.markets(code),
  score        int not null check (score between 0 and 100),
  band         text not null check (band in ('good','watch','risk')),
  groups       jsonb not null,
  lowest       text,
  tier         text,
  created_at   timestamptz not null default now(),
  primary key (account_id, as_of)
);
create index health_snapshots_market_idx on crm.health_snapshots (market_code, as_of desc, score);

create table crm.health_validations (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  tier          text not null default 'all',
  horizon_days  int not null,
  threshold     int not null,
  sample        int not null,
  positives     int not null,
  hit_precision numeric(5,3),
  hit_recall    numeric(5,3),
  run_by        uuid references crm.users(id) on delete set null,
  run_at        timestamptz not null default now()
);
create index health_validations_market_idx on crm.health_validations (market_code, run_at desc);

-- El puntaje del día para cada comercio que ya vende. Cada grupo aporta como mucho su peso (tope por grupo); un grupo sin
-- dato no suma ni resta y lo dice; un dato viejo pierde fuerza con los días (decay). Guarda la explicación junto al número.
create function app.health_snapshot_run(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with base as (
    select a.id, a.market_code, (now() at time zone mk.timezone)::date as today, c.service_tier, st.health_decay_days as decay,
           m.as_of as m_as_of, m.txn_count_30d as txn, m.active_days_30d as d,
           (select avg(h.txn_count_30d)::numeric from crm.merchant_metrics_daily h where h.account_id = a.id and h.as_of between m.as_of - 120 and m.as_of - 28) as baseline,
           s.as_of as s_as_of, s.balance_minor, s.product_count_30d, s.open_tickets, s.urgent_tickets, st.low_balance_minor,
           w.risk_below, w.habit_at
      from crm.accounts a
      join crm.markets mk on mk.code = a.market_code
      join crm.cs_settings st on st.market_code = a.market_code
      left join crm.account_care c on c.account_id = a.id
      cross join lateral app.lifecycle_window(a.market_code, c.product_line) w
      join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
      left join lateral (select x.* from crm.care_signals x where x.account_id = a.id order by x.as_of desc limit 1) s on true
     where a.archived_at is null and a.merged_into is null and a.lifecycle in ('active','at_risk','inactive')
       and (p_market is null or a.market_code = p_market)
  ), sig as (
    select b.*,
           greatest(0, 1 - greatest(0, b.today - b.m_as_of - 2)::numeric / b.decay) as m_fresh,
           case when b.s_as_of is null then null else greatest(0, 1 - greatest(0, b.today - b.s_as_of - 2)::numeric / b.decay) end as s_fresh,
           -- transacciones: contra su propia línea base si la hay; si no, contra el umbral de hábito del mercado
           least(1, case when b.baseline is not null and b.baseline > 0 then b.txn / b.baseline else b.d::numeric / b.habit_at end) as v_txn,
           case when b.product_count_30d is null then null else least(1, b.product_count_30d / 3.0) end as v_mix,
           case when b.open_tickets is null then null else greatest(0, 1 - (b.open_tickets + 2 * coalesce(b.urgent_tickets, 0)) / 5.0) end as v_tickets,
           case when b.balance_minor is null or b.low_balance_minor is null then null else least(1, b.balance_minor::numeric / greatest(1, b.low_balance_minor * 2)) end as v_balance
      from base b
  ), parts as (
    select g.id, g.market_code, g.today, g.service_tier, cfg.grp, cfg.weight,
           case cfg.grp when 'transactions' then g.v_txn * g.m_fresh when 'mix' then g.v_mix * g.s_fresh when 'tickets' then g.v_tickets * g.s_fresh else g.v_balance * g.s_fresh end as v,
           case cfg.grp when 'transactions' then case when g.baseline is not null and g.baseline > 0 then 'vs_baseline' else 'vs_habit' end else 'signal' end as basis,
           case cfg.grp when 'transactions' then g.m_as_of else g.s_as_of end as data_as_of,
           case cfg.grp when 'transactions' then g.txn::numeric when 'mix' then g.product_count_30d::numeric when 'tickets' then g.open_tickets::numeric else g.balance_minor::numeric end as raw,
           case when cfg.grp = 'transactions' then round(g.baseline, 1) end as baseline
      from sig g
      join lateral (select distinct on (h.grp) h.grp, h.weight from crm.health_config h
                     where h.is_active and h.weight > 0 and (h.market_code is null or h.market_code = g.market_code)
                     order by h.grp, h.market_code nulls last) cfg on true
  ), agg as (
    select p.id, p.market_code, p.today, p.service_tier,
           sum(p.weight) filter (where p.v is not null) as max_pts,
           sum(p.weight * p.v) filter (where p.v is not null) as pts,
           jsonb_agg(jsonb_build_object('grp', p.grp, 'weight', p.weight, 'points', case when p.v is null then null else round(p.weight * p.v, 1) end,
                                        'basis', p.basis, 'as_of', p.data_as_of, 'raw', p.raw, 'baseline', p.baseline) order by p.grp) as groups,
           (array_agg(p.grp order by p.v nulls last, p.weight desc))[1] as lowest
      from parts p group by p.id, p.market_code, p.today, p.service_tier
  ), ins as (
    insert into crm.health_snapshots (account_id, as_of, market_code, score, band, groups, lowest, tier)
    select a.id, a.today, a.market_code, round(100 * a.pts / a.max_pts)::int,
           case when 100 * a.pts / a.max_pts >= 70 then 'good' when 100 * a.pts / a.max_pts >= (select health_threshold from crm.cs_settings s where s.market_code = a.market_code) then 'watch' else 'risk' end,
           a.groups, a.lowest, a.service_tier
      from agg a where a.max_pts > 0
    on conflict (account_id, as_of) do update set score = excluded.score, band = excluded.band, groups = excluded.groups, lowest = excluded.lowest, tier = excluded.tier, created_at = now()
    returning 1
  )
  select count(*)::int into n from ins;
  return n;
end $$;
revoke execute on function app.health_snapshot_run(text) from public;
grant execute on function app.health_snapshot_run(text) to contigo_app;

-- Validación contra lo que pasó: de los comercios que el puntaje marcó en riesgo hace `p_horizon` días o más, cuántos dejaron
-- de vender después (precisión), y de los que dejaron de vender, a cuántos había marcado (recall). Por modelo de atención.
create function app.health_backtest(p_market text, p_horizon int default 30)
returns table (tier text, threshold int, sample int, positives int, hit_precision numeric, hit_recall numeric)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with st as (select health_threshold as t from crm.cs_settings where market_code = p_market),
  firsts as (
    select distinct on (h.account_id) h.account_id, h.as_of, h.score, coalesce(h.tier, 'none') as tier
      from crm.health_snapshots h, crm.markets mk
     where h.market_code = p_market and mk.code = p_market and h.as_of <= (now() at time zone mk.timezone)::date - p_horizon
       and p_market = any(app.my_markets())
     order by h.account_id, h.as_of
  ), outcome as (
    select f.*, coalesce((select bool_or(x.txn_count_30d = 0) from crm.merchant_metrics_daily x where x.account_id = f.account_id and x.as_of >= f.as_of + p_horizon),
                         (select a.lifecycle in ('inactive','churned') from crm.accounts a where a.id = f.account_id)) as went_dark
      from firsts f
  ), cut as (
    select o.tier, o.score, o.went_dark from outcome o
    union all select 'all', o.score, o.went_dark from outcome o
  )
  select c.tier, (select t from st), count(*)::int, count(*) filter (where c.went_dark)::int,
         case when count(*) filter (where c.score < (select t from st)) > 0
              then round(count(*) filter (where c.score < (select t from st) and c.went_dark)::numeric / count(*) filter (where c.score < (select t from st)), 3) end,
         case when count(*) filter (where c.went_dark) > 0
              then round(count(*) filter (where c.score < (select t from st) and c.went_dark)::numeric / count(*) filter (where c.went_dark), 3) end
    from cut c group by c.tier order by (c.tier = 'all') desc, c.tier
$$;
revoke execute on function app.health_backtest(text, int) from public;
grant execute on function app.health_backtest(text, int) to contigo_app;

-- ================================================================ 4) modelo de atención
create table crm.service_tier_events (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  from_tier    text,
  to_tier      text not null,
  basis        text not null,
  amount_minor bigint,
  at           timestamptz not null default now()
);
create index service_tier_events_account_idx on crm.service_tier_events (account_id, at desc);

-- Modelo de atención por comercio. Variable principal: la comisión que genera en 30 días; si no hay ese dato, se estima con
-- el volumen y la tasa del mercado (y se dice). Cadenas, distribuidores y organizaciones son de atención dedicada.
-- Histéresis: para bajar de nivel hay que caer por debajo del umbral menos el margen; para subir, basta alcanzarlo.
create function app.service_tier_recalc(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r record; nxt text; rank_now int; rank_raw int; rank_soft int; n int := 0;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for r in
    select a.id, a.market_code, a.kind, c.service_tier as cur, st.tier_high_commission as hi, st.tier_pooled_commission as mid, st.tier_low_commission as lo,
           st.tier_hysteresis_pct as hys,
           coalesce(s.commission_minor_30d, m.volume_minor_30d * st.tier_commission_rate_bp / 10000) as amount,
           case when s.commission_minor_30d is not null then 'commission' when m.volume_minor_30d is not null then 'volume' end as basis
      from crm.accounts a
      join crm.cs_settings st on st.market_code = a.market_code
      left join crm.account_care c on c.account_id = a.id
      left join lateral (select x.volume_minor_30d from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
      left join lateral (select x.commission_minor_30d from crm.care_signals x where x.account_id = a.id and x.commission_minor_30d is not null order by x.as_of desc limit 1) s on true
     where a.archived_at is null and a.merged_into is null and a.lifecycle not in ('prospect','churned')
       and (p_market is null or a.market_code = p_market)
  loop
    if r.kind in ('organization','chain','distributor') then
      nxt := 'high';
      if r.cur is distinct from nxt then
        insert into crm.account_care (account_id, market_code, stage, service_tier, service_tier_at, service_tier_basis)
        select r.id, r.market_code, a.lifecycle, nxt, now(), 'account_type' from crm.accounts a where a.id = r.id
        on conflict (account_id) do update set service_tier = excluded.service_tier, service_tier_at = now(), service_tier_basis = 'account_type', updated_at = now();
        insert into crm.service_tier_events (account_id, market_code, from_tier, to_tier, basis, amount_minor) values (r.id, r.market_code, r.cur, nxt, 'account_type', r.amount);
        n := n + 1;
      end if;
      continue;
    end if;
    if r.basis is null then continue; end if;
    rank_raw := case when r.amount >= r.hi then 3 when r.amount >= r.mid then 2 when r.amount >= r.lo then 1 else 0 end;
    rank_soft := case when r.amount >= r.hi * (100 - r.hys) / 100.0 then 3 when r.amount >= r.mid * (100 - r.hys) / 100.0 then 2 when r.amount >= r.lo * (100 - r.hys) / 100.0 then 1 else 0 end;
    rank_now := case r.cur when 'high' then 3 when 'pooled' then 2 when 'low' then 1 when 'tech' then 0 end;
    -- sube si alcanza el umbral; baja solo si ni con el margen se sostiene
    if rank_now is null then rank_now := rank_raw;
    elsif rank_raw > rank_now then rank_now := rank_raw;
    elsif rank_soft < rank_now then rank_now := rank_soft;
    end if;
    nxt := case rank_now when 3 then 'high' when 2 then 'pooled' when 1 then 'low' else 'tech' end;
    if r.cur is distinct from nxt then
      insert into crm.account_care (account_id, market_code, stage, service_tier, service_tier_at, service_tier_basis)
      select r.id, r.market_code, a.lifecycle, nxt, now(), r.basis from crm.accounts a where a.id = r.id
      on conflict (account_id) do update set service_tier = excluded.service_tier, service_tier_at = now(), service_tier_basis = excluded.service_tier_basis, updated_at = now();
      insert into crm.service_tier_events (account_id, market_code, from_tier, to_tier, basis, amount_minor) values (r.id, r.market_code, r.cur, nxt, r.basis, r.amount);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function app.service_tier_recalc(text) from public;
grant execute on function app.service_tier_recalc(text) to contigo_app;

-- ================================================================ 5) capacitación del comercio y cambio de encargado
create table crm.training_completions (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id) on delete cascade,
  market_code   text not null references crm.markets(code),
  person_name   text not null check (char_length(person_name) between 2 and 120),
  course_key    text not null check (course_key ~ '^[a-z0-9][a-z0-9_.-]{1,59}$'),
  course_title  text not null check (char_length(course_title) between 2 and 160),
  completed_on  date not null,
  source        text not null check (source in ('kore_academy','manual')),
  external_id   text unique check (external_id is null or char_length(external_id) between 4 and 80),
  recorded_by   uuid references crm.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index training_completions_account_idx on crm.training_completions (account_id, completed_on desc);

create table crm.manager_changes (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  changed_on   date not null,
  new_name     text not null check (char_length(new_name) between 2 and 120),
  note         text check (note is null or char_length(note) <= 300),
  source       text not null default 'visit' check (source in ('visit','call','other')),
  trained_at   timestamptz,
  recorded_by  uuid references crm.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index manager_changes_account_idx on crm.manager_changes (account_id, changed_on desc);

-- ================================================================ 6) expansión
create table crm.expansion_rules (
  id                    uuid primary key default app.uuid_v7(),
  market_code           text not null references crm.markets(code),
  product_id            uuid references crm.products(id),
  product_label         text not null check (char_length(product_label) between 2 and 80),
  min_active_days       int not null default 10 check (min_active_days between 1 and 31),
  min_days_since_first  int not null default 60 check (min_days_since_first between 0 and 720),
  min_txn_30d           int not null default 20 check (min_txn_30d >= 0),
  is_active             boolean not null default true,
  updated_by            uuid references crm.users(id) on delete set null,
  updated_at            timestamptz not null default now()
);
create unique index expansion_rules_uq on crm.expansion_rules (market_code, lower(product_label));

create table crm.expansion_opportunities (
  id             uuid primary key default app.uuid_v7(),
  account_id     uuid not null references crm.accounts(id) on delete cascade,
  market_code    text not null references crm.markets(code),
  rule_id        uuid not null references crm.expansion_rules(id),
  product_label  text not null,
  status         text not null default 'open' check (status in ('open','working','won','lost','dismissed')),
  owner_id       uuid references crm.users(id) on delete set null,
  activity_id    uuid references crm.activities(id) on delete set null,
  evidence       jsonb not null default '{}'::jsonb,
  close_note     text check (close_note is null or char_length(close_note) <= 300),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references crm.users(id) on delete set null
);
create unique index expansion_open_uq on crm.expansion_opportunities (account_id, rule_id) where status in ('open','working');
create index expansion_market_idx on crm.expansion_opportunities (market_code, status);

-- Abre la oportunidad para cada comercio que cumple la regla con su actividad real y todavía no tiene ese producto.
-- Un comercio que no vende nunca entra. Una oportunidad descartada o perdida no se vuelve a abrir en 90 días.
create function app.expansion_run(p_market text default null) returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare n int;
begin
  if app.current_user_id() is distinct from app.system_user_id() and not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with ins as (
    insert into crm.expansion_opportunities (account_id, market_code, rule_id, product_label, owner_id, evidence)
    select a.id, a.market_code, r.id, r.product_label, coalesce(c.care_owner_id, a.owner_id),
           jsonb_build_object('as_of', m.as_of, 'active_days_30d', m.active_days_30d, 'txn_count_30d', m.txn_count_30d, 'first_txn_at', m.first_txn_at)
      from crm.expansion_rules r
      join crm.accounts a on a.market_code = r.market_code and a.archived_at is null and a.merged_into is null and a.lifecycle = 'active'
      left join crm.account_care c on c.account_id = a.id
      join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
     where r.is_active and (p_market is null or r.market_code = p_market)
       and m.active_days_30d >= r.min_active_days and m.txn_count_30d >= r.min_txn_30d and m.txn_count_30d > 0
       and m.first_txn_at is not null and m.first_txn_at <= now() - make_interval(days => r.min_days_since_first)
       and not exists (select 1 from crm.account_products p where p.account_id = a.id and r.product_id is not null and p.product_id = r.product_id and p.status not in ('rejected'))
       and not exists (select 1 from crm.expansion_opportunities o where o.account_id = a.id and o.rule_id = r.id
                        and (o.status in ('open','working','won') or o.closed_at > now() - interval '90 days'))
    on conflict do nothing returning 1
  )
  select count(*)::int into n from ins;
  return n;
end $$;
revoke execute on function app.expansion_run(text) from public;
grant execute on function app.expansion_run(text) to contigo_app;

-- ================================================================ 7) cuentas corporativas y de integración
create table crm.account_plans (
  account_id         uuid primary key references crm.accounts(id) on delete cascade,
  market_code        text not null references crm.markets(code),
  goals              text check (goals is null or char_length(goals) <= 2000),
  risks              text check (risks is null or char_length(risks) <= 2000),
  next_steps         text check (next_steps is null or char_length(next_steps) <= 2000),
  review_every_days  int not null default 90 check (review_every_days between 7 and 365),
  next_review_on     date,
  updated_by         uuid references crm.users(id) on delete set null,
  updated_at         timestamptz not null default now()
);
create table crm.account_relationships (
  id             uuid primary key default app.uuid_v7(),
  account_id     uuid not null references crm.accounts(id) on delete cascade,
  market_code    text not null references crm.markets(code),
  product_label  text not null check (char_length(product_label) between 2 and 80),
  health         text not null check (health in ('good','watch','risk')),
  note           text check (note is null or char_length(note) <= 300),
  updated_by     uuid references crm.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);
create unique index account_relationships_uq on crm.account_relationships (account_id, lower(product_label));
create table crm.account_reviews (
  id            uuid primary key default app.uuid_v7(),
  account_id    uuid not null references crm.accounts(id) on delete cascade,
  market_code   text not null references crm.markets(code),
  held_on       date not null,
  attendees     text check (attendees is null or char_length(attendees) <= 300),
  minutes       text not null check (char_length(minutes) between 3 and 4000),
  agreements    text check (agreements is null or char_length(agreements) <= 2000),
  draft_source  text not null default 'manual' check (draft_source in ('manual','data','ai')),
  created_by    uuid references crm.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index account_reviews_account_idx on crm.account_reviews (account_id, held_on desc);

-- ================================================================ 8) comentarios de producto desde campo
create table crm.feedback_topics (
  code      text primary key check (code ~ '^[a-z_]{3,30}$'),
  label_es  text not null,
  label_en  text not null,
  sort      int not null default 0,
  is_active boolean not null default true
);
insert into crm.feedback_topics (code, label_es, label_en, sort) values
  ('price', 'Precio o comisión', 'Price or commission', 1),
  ('missing_product', 'Producto que falta', 'Missing product', 2),
  ('app', 'App o plataforma', 'App or platform', 3),
  ('equipment', 'Equipo o terminal', 'Equipment or terminal', 4),
  ('balance', 'Saldo y recargas', 'Balance and top-ups', 5),
  ('support', 'Atención y soporte', 'Service and support', 6),
  ('training', 'Capacitación', 'Training', 7),
  ('competitor', 'Lo que ofrece la competencia', 'What competitors offer', 8);

create table crm.product_feedback (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  topic        text not null references crm.feedback_topics(code),
  kind         text not null check (kind in ('friction','request')),
  note         text check (note is null or char_length(note) <= 500),
  status       text not null default 'new' check (status in ('new','seen','planned','done','declined')),
  response     text check (response is null or char_length(response) <= 500),
  created_by   uuid references crm.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references crm.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index product_feedback_market_idx on crm.product_feedback (market_code, created_at desc);
create index product_feedback_account_idx on crm.product_feedback (account_id, created_at desc);

create table crm.feedback_digests (
  id            uuid primary key default app.uuid_v7(),
  period_start  date not null,
  period_end    date not null,
  total         int not null,
  counts        jsonb not null,
  created_at    timestamptz not null default now(),
  unique (period_start, period_end)
);

-- ================================================================ RLS forzado y privilegios
do $$
declare t text;
begin
  foreach t in array array['account_care','lifecycle_events','lifecycle_windows','care_signals','handoffs','cs_settings','playbooks','cs_alerts','cs_messages',
                           'health_config','health_snapshots','health_validations','service_tier_events','training_completions','manager_changes',
                           'expansion_rules','expansion_opportunities','account_plans','account_relationships','account_reviews','feedback_topics',
                           'product_feedback','feedback_digests'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
  end loop;
  -- Lo que cuelga de un comercio se ve con el comercio y se escribe en los mercados donde la persona trabaja.
  foreach t in array array['account_care','handoffs','cs_alerts','cs_messages','training_completions','manager_changes','expansion_opportunities',
                           'account_plans','account_relationships','account_reviews','product_feedback','care_signals','health_snapshots'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using (exists (select 1 from crm.accounts a where a.id = %I.account_id))', t || '_read', t, t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id and a.market_code = %I.market_code))', t || '_ins', t, t, t);
    execute format('create policy %I on crm.%I for update to contigo_app using (exists (select 1 from crm.accounts a where a.id = %I.account_id)) with check (market_code = any((select app.write_markets())::text[]))', t || '_upd', t, t);
  end loop;
  -- Historiales: se leen con el comercio; solo los escriben las funciones de la base.
  foreach t in array array['lifecycle_events','service_tier_events'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using (exists (select 1 from crm.accounts a where a.id = %I.account_id))', t || '_read', t, t);
  end loop;
  -- Configuración por mercado: la lee quien trabaja en el mercado; la cambia quien lo lidera o administración.
  foreach t in array array['lifecycle_windows','cs_settings','expansion_rules'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using (market_code = any((select app.my_markets())::text[]))', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check (market_code = any((select app.lead_markets())::text[]))', t || '_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]))', t || '_upd', t);
  end loop;
  -- Configuración que puede ser general (sin mercado): la general la cambia administración.
  foreach t in array array['playbooks','health_config'] loop
    execute format('create policy %I on crm.%I for select to contigo_app using (market_code is null or market_code = any((select app.my_markets())::text[]))', t || '_read', t);
    execute format('create policy %I on crm.%I for insert to contigo_app with check ((market_code is null and (select app.is_admin())) or market_code = any((select app.lead_markets())::text[]))', t || '_ins', t);
    execute format('create policy %I on crm.%I for update to contigo_app using ((market_code is null and (select app.is_admin())) or market_code = any((select app.lead_markets())::text[])) with check ((market_code is null and (select app.is_admin())) or market_code = any((select app.lead_markets())::text[]))', t || '_upd', t);
  end loop;
end $$;
create policy health_validations_read on crm.health_validations for select to contigo_app using (market_code = any((select app.my_markets())::text[]));
create policy health_validations_ins on crm.health_validations for insert to contigo_app with check (market_code = any((select app.lead_markets())::text[]));
create policy feedback_topics_read on crm.feedback_topics for select to contigo_app using ((select app.current_user_id()) is not null);
create policy feedback_digests_read on crm.feedback_digests for select to contigo_app using ((select app.is_global()) or exists (select 1 from app.active_memberships() where role = 'market_lead'));
create policy feedback_digests_ins on crm.feedback_digests for insert to contigo_app with check ((select app.is_admin()));
create policy feedback_digests_upd on crm.feedback_digests for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

grant select, insert, update on crm.account_care, crm.handoffs, crm.cs_alerts, crm.cs_messages, crm.training_completions, crm.manager_changes,
  crm.expansion_opportunities, crm.account_plans, crm.account_relationships, crm.account_reviews, crm.product_feedback, crm.care_signals,
  crm.health_snapshots, crm.lifecycle_windows, crm.cs_settings, crm.expansion_rules, crm.playbooks, crm.health_config, crm.feedback_digests to contigo_app;
grant select on crm.lifecycle_events, crm.service_tier_events, crm.feedback_topics to contigo_app;
grant select, insert on crm.health_validations to contigo_app;
