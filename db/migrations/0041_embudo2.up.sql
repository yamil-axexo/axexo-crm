-- 0041_embudo2: residuos del embudo (ola 6).
-- ACT-02 próximo paso: aviso para leads y comercios en alta sin tarea siguiente; tope configurable a la fecha del próximo paso.
-- PIPE-03 estancamiento: espera al cliente y al carrier con umbral propio; considera el próximo paso; alta sin primera venta
--   con el umbral de su etapa.
-- PIPE-04 motivos: catálogo base y extensiones por mercado con tope configurable; custodia como permiso; nunca se borran.
-- PIPE-02 evidencia: documento con hash (del expediente o con su huella), transiciones de alta y crédito ACH propuestas.
-- LEAD-04 reloj genérico (crm.sla_timers), contacto efectivo, zona horaria del punto de venta y feriados del mercado.
-- LEAD-03 sugerencia de tienda saturada, ruteo de comercios que nacen sin dueño, condición editable.
-- ACT-01 actividades: correcciones como fila nueva, visibilidad por actividad, retención configurable.
-- AUT-03 dueño obligatorio en cada automatización. UX-03 colas oficiales por rol. E12.F4 propósitos de visita propuestos.
-- Valores de negocio que no decide quien construye: crm.funnel_settings (propuestos, con dueño pendiente).

-- ------------------------------------------------------------ valores configurables del embudo
create table crm.funnel_settings (
  id             uuid primary key default app.uuid_v7(),
  market_code    text references crm.markets(code),          -- null = todos los mercados
  key            text not null check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  value          jsonb not null,
  proposed       boolean not null default true,              -- valor propuesto por quien construyó, sin confirmar
  pending_owner  text check (pending_owner is null or char_length(pending_owner) between 2 and 80),
  updated_by     uuid references crm.users(id),
  updated_at     timestamptz not null default now()
);
create unique index funnel_settings_uq on crm.funnel_settings (coalesce(market_code, '*'), key);
alter table crm.funnel_settings enable row level security;
alter table crm.funnel_settings force row level security;
grant select, insert, update on crm.funnel_settings to contigo_app;
create policy funnel_settings_read on crm.funnel_settings for select to contigo_app using ((select app.current_user_id()) is not null);
create policy funnel_settings_ins on crm.funnel_settings for insert to contigo_app with check ((select app.has_area('config')));
create policy funnel_settings_upd on crm.funnel_settings for update to contigo_app using ((select app.has_area('config'))) with check ((select app.has_area('config')));

insert into crm.funnel_settings (market_code, key, value, proposed, pending_owner) values
  (null, 'next_step_max_days', '90', true, 'Liderazgo comercial'),
  (null, 'reason_core_max', '10', true, 'Yamil (C1) con ventas'),
  (null, 'reason_max_extensions', '2', true, 'Yamil (C1) con ventas'),
  (null, 'lead_sla_clock', '"contact"', true, 'Liderazgo de ventas'),
  (null, 'lead_sla_baseline_weeks', '4', true, 'Liderazgo de ventas US'),
  (null, 'activity_retention_months', 'null', true, 'Yamil'),
  (null, 'rot_respects_next_step', 'true', true, 'Liderazgo comercial'),
  ('US', 'visit_purposes_confirmed', 'false', true, 'Ventas US');

create or replace function app.funnel_setting(p_market text, p_key text) returns jsonb
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select value from crm.funnel_settings where key = p_key and (market_code = p_market or market_code is null)
   order by market_code nulls last limit 1
$$;
revoke execute on function app.funnel_setting(text, text) from public;
grant execute on function app.funnel_setting(text, text) to contigo_app;

-- ------------------------------------------------------------ ACT-02
alter table crm.exceptions drop constraint if exists exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low','lead_no_next_step','onboarding_no_next_step'));

-- La fecha del próximo paso no puede ir más lejos que el tope del mercado (no se calla la alerta con fechas a meses).
-- Solo al ponerla o cambiarla: lo que ya estaba guardado no se toca y se sigue viendo en el reporte de fechas lejanas.
create or replace function app.deals_next_step_cap() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare cap int; today date;
begin
  -- Las cargas de otro sistema (Pipedrive) traen la fecha que tenía allá: se respeta y se ve en el reporte de fechas lejanas.
  if new.next_step_due is null or new.status <> 'open' or session_user <> 'contigo_app' or coalesce(current_setting('app.bulk_load', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.next_step_due is not distinct from old.next_step_due then return new; end if;
  cap := (app.funnel_setting(new.market_code, 'next_step_max_days') #>> '{}')::int;
  if cap is null then return new; end if;
  select (now() at time zone m.timezone)::date into today from crm.markets m where m.code = new.market_code;
  if new.next_step_due > today + cap then
    raise exception 'next step too far: % days max', cap using errcode = '22023', hint = 'next_step_cap';
  end if;
  return new;
end $$;
create trigger deals_next_step_cap before insert or update of next_step_due on crm.deals
  for each row execute function app.deals_next_step_cap();

-- ------------------------------------------------------------ PIPE-03
alter table crm.deals drop constraint if exists deals_waiting_on_check;
alter table crm.deals add constraint deals_waiting_on_check check (waiting_on is null or waiting_on in ('us','customer','third_party','carrier'));
alter table crm.stages add column rot_days_customer int check (rot_days_customer is null or rot_days_customer between 1 and 365),
                       add column rot_days_carrier  int check (rot_days_carrier is null or rot_days_carrier between 1 and 365);

-- Alta sin primera venta: con el umbral de su etapa (stages.rot_days), no con 7 días fijos. Solo si la regla sigue como nació.
update crm.automations set conditions = '[{"op":"eq","field":"stage_kind","value":"awaiting_txn"},{"op":"is_true","field":"over_stage_limit"}]'::jsonb, version = version + 1
 where key = 'activation_risk' and conditions = '[{"op":"eq","field":"stage_kind","value":"awaiting_txn"},{"op":"gt","field":"stage_age_days","value":7}]'::jsonb;
-- Estancado: pasó el umbral de la etapa y no tiene un próximo paso con fecha por venir (rotting, no una nota cualquiera).
update crm.automations set conditions = conditions - (select (i - 1)::int from jsonb_array_elements(conditions) with ordinality e(x, i) where x->>'field' = 'over_stage_limit' limit 1)
                                       || '[{"op":"is_true","field":"rotting"}]'::jsonb, version = version + 1
 where key in ('stalled_deal', 'stalled_ops') and conditions @> '[{"field":"over_stage_limit"}]'::jsonb and pipedrive_ref is null;

-- ------------------------------------------------------------ PIPE-04
alter table crm.loss_reasons add column retired_at timestamptz, add column retired_by uuid references crm.users(id);
-- Un motivo usado nunca se borra: se marca inactivo.
revoke delete on crm.loss_reasons from contigo_app;
-- El tope de motivos (base y propios de cada mercado) lo aplica la custodia en el dominio (createLossReason / updateLossReason):
-- la importación de Pipedrive sigue pudiendo reflejar los motivos que traía, que quedan contados contra el tope en Administración.

-- ------------------------------------------------------------ PIPE-02
alter table crm.deal_evidence alter column url drop not null,
  add column document_id uuid references crm.onboarding_documents(id),
  add column content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  add column storage_ref text check (storage_ref is null or char_length(storage_ref) <= 200),
  add constraint deal_evidence_what check (url is not null or document_id is not null or content_hash is not null);
alter table crm.stage_transitions add column pending_owner text check (pending_owner is null or char_length(pending_owner) between 2 and 80);

-- ------------------------------------------------------------ LEAD-04
alter table crm.leads add column first_contact_at timestamptz,
                      add column timezone text check (timezone is null or char_length(timezone) between 3 and 60);
-- Contacto efectivo: el lead pasó a contactado o calificado (no un intento sin respuesta).
update crm.leads set first_contact_at = coalesce(first_touch_at, updated_at) where status in ('contacted', 'qualified', 'converted') and first_contact_at is null;

-- Horario hábil con zona horaria (la del punto de venta si se conoce) y feriados del mercado.
create or replace function app.business_due_tz(p_market text, p_from timestamptz, p_minutes int, p_tz text) returns timestamptz
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  loc timestamp; day date; s timestamp; e timestamp;
  remaining numeric := greatest(coalesce(p_minutes, 60), 0);
  avail numeric; i int := 0; hday date;
begin
  select m.timezone into tz from crm.markets m where m.code = p_market;
  tz := coalesce(nullif(p_tz, ''), tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  loc := p_from at time zone tz;
  day := loc::date;
  while i < 370 loop
    hday := day;
    if extract(isodow from day)::int = any(d) and not exists (select 1 from crm.market_holidays x where x.market_code = p_market and x.day = hday) then
      s := greatest(loc, day + o);
      e := day + c;
      if s < e then
        avail := extract(epoch from (e - s)) / 60.0;
        if remaining <= avail then
          return (s + make_interval(secs => (remaining * 60)::double precision)) at time zone tz;
        end if;
        remaining := remaining - avail;
      end if;
    end if;
    day := day + 1;
    i := i + 1;
  end loop;
  return p_from + make_interval(mins => coalesce(p_minutes, 60));
end $$;
create or replace function app.business_minutes_tz(p_market text, p_from timestamptz, p_to timestamptz, p_tz text) returns numeric
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  a timestamp; b timestamp; day date; s timestamp; e timestamp;
  total numeric := 0; i int := 0; hday date;
begin
  if p_from is null or p_to is null or p_to <= p_from then return 0; end if;
  select m.timezone into tz from crm.markets m where m.code = p_market;
  tz := coalesce(nullif(p_tz, ''), tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  a := p_from at time zone tz; b := p_to at time zone tz;
  day := a::date;
  while day <= b::date and i < 370 loop
    hday := day;
    if extract(isodow from day)::int = any(d) and not exists (select 1 from crm.market_holidays x where x.market_code = p_market and x.day = hday) then
      s := greatest(a, day + o);
      e := least(b, day + c);
      if s < e then total := total + extract(epoch from (e - s)) / 60.0; end if;
    end if;
    day := day + 1; i := i + 1;
  end loop;
  return total;
end $$;
create or replace function app.business_due(p_market text, p_from timestamptz, p_minutes int) returns timestamptz
language sql stable security definer set search_path = crm, app, pg_catalog as $$ select app.business_due_tz(p_market, p_from, p_minutes, null) $$;
create or replace function app.business_minutes(p_market text, p_from timestamptz, p_to timestamptz) returns numeric
language sql stable security definer set search_path = crm, app, pg_catalog as $$ select app.business_minutes_tz(p_market, p_from, p_to, null) $$;
revoke execute on function app.business_due_tz(text, timestamptz, int, text) from public;
revoke execute on function app.business_minutes_tz(text, timestamptz, timestamptz, text) from public;
grant execute on function app.business_due_tz(text, timestamptz, int, text) to contigo_app;
grant execute on function app.business_minutes_tz(text, timestamptz, timestamptz, text) to contigo_app;

-- Reloj genérico: una fila por registro y tipo de meta. Lo lleva la base, no la pantalla.
create table crm.sla_timers (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  record_type   text not null check (record_type in ('lead','deal','account')),
  record_id     uuid not null,
  sla_type      text not null check (sla_type in ('first_contact','stage_goal')),
  timezone      text,
  started_at    timestamptz not null,
  due_at        timestamptz,
  attempt_at    timestamptz,
  met_at        timestamptz,
  updated_at    timestamptz not null default now(),
  unique (record_type, record_id, sla_type)
);
create index sla_timers_open_idx on crm.sla_timers (market_code, due_at) where met_at is null;
alter table crm.sla_timers enable row level security;
alter table crm.sla_timers force row level security;
grant select on crm.sla_timers to contigo_app;
create policy sla_timers_read on crm.sla_timers for select to contigo_app using (
  (record_type = 'lead' and exists (select 1 from crm.leads l where l.id = sla_timers.record_id))
  or (record_type = 'deal' and exists (select 1 from crm.deals d where d.id = sla_timers.record_id))
  or (record_type = 'account' and exists (select 1 from crm.accounts a where a.id = sla_timers.record_id)));

create or replace function app.leads_sla_timer() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare clock text;
begin
  -- Contacto efectivo: el lead quedó contactado o calificado.
  if new.status in ('contacted','qualified','converted') and new.first_contact_at is null then new.first_contact_at := now(); end if;
  if new.sla_due_at is null and (tg_op = 'INSERT' or old.sla_due_at is null) then return new; end if;
  clock := coalesce(app.funnel_setting(new.market_code, 'lead_sla_clock') #>> '{}', 'contact');
  insert into crm.sla_timers (market_code, record_type, record_id, sla_type, timezone, started_at, due_at, attempt_at, met_at)
  values (new.market_code, 'lead', new.id, 'first_contact', new.timezone, coalesce(new.created_at, now()), new.sla_due_at, new.first_touch_at,
          case when clock = 'attempt' then new.first_touch_at else new.first_contact_at end)
  on conflict (record_type, record_id, sla_type) do update set due_at = excluded.due_at, attempt_at = excluded.attempt_at,
     met_at = coalesce(crm.sla_timers.met_at, excluded.met_at), timezone = excluded.timezone, updated_at = now();
  return new;
end $$;
create trigger leads_sla_timer before insert or update of status, sla_due_at, first_touch_at, first_contact_at, timezone on crm.leads
  for each row execute function app.leads_sla_timer();
-- El reloj de los leads que ya existen.
insert into crm.sla_timers (market_code, record_type, record_id, sla_type, timezone, started_at, due_at, attempt_at, met_at)
select l.market_code, 'lead', l.id, 'first_contact', l.timezone, l.created_at, l.sla_due_at, l.first_touch_at, l.first_contact_at
  from crm.leads l where l.sla_due_at is not null
on conflict do nothing;

-- ------------------------------------------------------------ LEAD-03
alter table crm.assignment_log add column account_id uuid references crm.accounts(id) on delete cascade;
create index assignment_log_account_idx on crm.assignment_log (account_id) where account_id is not null;
alter table crm.assignment_rules add column updated_by uuid references crm.users(id);

-- Tienda saturada: quien vende ya tiene el tope y el sistema sugiere pasar el lead al canal indirecto. Supervisión confirma o descarta.
create table crm.routing_suggestions (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  lead_id       uuid references crm.leads(id) on delete cascade,
  account_id    uuid references crm.accounts(id),
  kind          text not null default 'saturated' check (kind in ('saturated')),
  capped_ids    uuid[] not null default '{}',
  detail        jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (status in ('open','confirmed','dismissed')),
  decided_by    uuid references crm.users(id),
  decided_at    timestamptz,
  note          text check (note is null or char_length(note) <= 300),
  created_at    timestamptz not null default now(),
  check ((status = 'open') = (decided_at is null))
);
create unique index routing_suggestions_open_uq on crm.routing_suggestions (lead_id, kind) where status = 'open';
alter table crm.routing_suggestions enable row level security;
alter table crm.routing_suggestions force row level security;
grant select, insert, update (status, decided_by, decided_at, note) on crm.routing_suggestions to contigo_app;
create policy routing_suggestions_read on crm.routing_suggestions for select to contigo_app using (
  market_code = any((select app.my_markets())::text[]) and ((select app.is_admin()) or exists (select 1 from app.active_memberships() m where m.role in ('market_lead','supervisor','lt'))));
create policy routing_suggestions_ins on crm.routing_suggestions for insert to contigo_app with check (market_code = any((select app.my_markets())::text[]));
create policy routing_suggestions_upd on crm.routing_suggestions for update to contigo_app using (
  market_code = any((select app.write_markets())::text[]) and ((select app.is_admin()) or exists (select 1 from app.active_memberships() m where m.role in ('market_lead','supervisor'))));

-- ------------------------------------------------------------ ACT-01
alter table crm.activities add column visibility_class text not null default 'team' check (visibility_class in ('team','managers','restricted')),
                           add column corrects_id uuid references crm.activities(id),
                           add column corrected_at timestamptz;
create index activities_corrects_idx on crm.activities (corrects_id) where corrects_id is not null;
-- Append-only: lo que ya ocurrió (actividad hecha) no se reescribe. Se corrige con una fila nueva que apunta a la original.
-- Mover entre registros (fusión, conversión de lead) sí se permite: la actividad sigue siendo la misma.
create or replace function app.activities_append_only() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if old.done_at is null or old.source = 'import' or session_user <> 'contigo_app' then return new; end if;
  if new.subject is distinct from old.subject or new.body is distinct from old.body or new.done_at is distinct from old.done_at
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.outcome is distinct from old.outcome
     or new.corrects_id is distinct from old.corrects_id then
    raise exception 'activity is append-only once done' using errcode = '42501', hint = 'append_only';
  end if;
  return new;
end $$;
create trigger activities_append_only before update on crm.activities for each row execute function app.activities_append_only();
create or replace function app.activities_no_delete() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if old.done_at is not null and current_user = 'contigo_app' then
    raise exception 'activity is append-only once done' using errcode = '42501', hint = 'append_only';
  end if;
  return old;
end $$;
create trigger activities_no_delete before delete on crm.activities for each row execute function app.activities_no_delete();
-- Retención (crm.funnel_settings 'activity_retention_months', vacía = se guarda todo): la única vía para quitar actividades
-- terminadas. Primero las correcciones, luego las originales; nunca lo pendiente ni lo ligado a una aprobación.
create or replace function app.activity_retention_apply() returns int
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare r record; n int := 0; k int;
begin
  for r in select m.code, (app.funnel_setting(m.code, 'activity_retention_months') #>> '{}')::int as months from crm.markets m loop
    continue when r.months is null;
    delete from crm.activities a where a.market_code = r.code and a.done_at < now() - make_interval(months => r.months) and a.approval_id is null and a.corrects_id is not null;
    get diagnostics k = row_count; n := n + k;
    delete from crm.activities a where a.market_code = r.code and a.done_at < now() - make_interval(months => r.months) and a.approval_id is null
       and not exists (select 1 from crm.activities c where c.corrects_id = a.id);
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function app.activity_retention_apply() from public;
grant execute on function app.activity_retention_apply() to contigo_app;
-- Marca de "corregida" en la original: la pone la base al insertar la corrección (la original no se edita desde la app).
create or replace function app.activities_mark_corrected() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.corrects_id is not null then
    update crm.activities set corrected_at = now() where id = new.corrects_id and corrected_at is null;
  end if;
  return new;
end $$;
create trigger activities_mark_corrected after insert on crm.activities for each row execute function app.activities_mark_corrected();
-- Visibilidad por actividad: 'team' (quien ve el registro), 'managers' (autor, responsable y quien dirige), 'restricted' (autor, responsable y administración).
create policy activities_visibility on crm.activities as restrictive for select to contigo_app using (
  visibility_class = 'team'
  or created_by = (select app.current_user_id()) or owner_id = (select app.current_user_id())
  or (select app.is_admin())
  or (visibility_class = 'managers' and exists (select 1 from app.active_memberships() m where m.role in ('market_lead','supervisor','lt'))));

-- ------------------------------------------------------------ AUT-03
alter table crm.automations add column owner_review boolean not null default false;
-- Administración: la primera persona con administración completa (nunca el usuario del sistema si hay alguien).
create or replace function app.default_automation_owner() returns uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select coalesce(
    (select m.user_id from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
      where m.role = 'admin' and m.admin_areas is null and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) and m.user_id <> app.system_user_id()
      order by m.valid_from, m.user_id limit 1),
    app.system_user_id())
$$;
-- Ninguna automatización nace sin dueño: si quien la crea no lo dice, queda con administración y en la lista para revisar.
create or replace function app.automations_owner() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.owner_id is null then new.owner_id := app.default_automation_owner(); new.owner_review := true; end if;
  return new;
end $$;
create trigger automations_owner before insert or update of owner_id on crm.automations for each row execute function app.automations_owner();
-- Las que no tenían dueño quedan con administración y en la lista para revisar.
update crm.automations set owner_id = app.default_automation_owner(), owner_review = true where owner_id is null;
alter table crm.automations alter column owner_id set not null;

-- ------------------------------------------------------------ UX-03
alter table crm.saved_views add column official_role text check (official_role is null or official_role in ('rep','supervisor','market_lead','ops'));
create index saved_views_official_idx on crm.saved_views (official_role) where official_role is not null;
-- Una cola oficial la publica administración: es compartida y la ve todo el mercado.
create or replace function app.saved_views_official() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.official_role is not null and (not new.is_shared or not app.is_admin()) and session_user = 'contigo_app' then
    raise exception 'official queues are published by administration' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger saved_views_official before insert or update of official_role on crm.saved_views for each row execute function app.saved_views_official();
