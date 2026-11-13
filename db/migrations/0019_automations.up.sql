-- 0019_automations: paquete automatizaciones del programa "los 95" (12-nov-2026).
-- Corredor de tareas programadas, automatizaciones como datos (AUT-03), pasos de etapa con evidencia y aprobación (PIPE-02),
-- estancamiento por horario con espera de terceros (PIPE-03), escalamiento del primer contacto (LEAD-04) y un invariante
-- de negocios que vale para toda vía de entrada (AUT-01).

-- ------------------------------------------------------------ 1) corridas de las tareas programadas
create table crm.job_runs (
  id           uuid primary key default app.uuid_v7(),
  job_key      text not null check (length(job_key) between 3 and 80),
  trigger      text not null check (trigger in ('cron','visit','manual')),
  actor_id     uuid references crm.users(id),
  status       text not null check (status in ('ok','failed')),
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  duration_ms  int not null default 0 check (duration_ms >= 0),
  done         int not null default 0,
  note         text check (note is null or length(note) <= 500),
  error        text check (error is null or length(error) <= 500)
);
create index job_runs_key_idx on crm.job_runs (job_key, started_at desc);
insert into crm.settings (key, value) values ('jobs_last_tick', to_jsonb(now() - interval '1 day')) on conflict do nothing;

-- ------------------------------------------------------------ 2) automatizaciones como datos
-- Una automatización es de UN mercado (y, si se quiere, de un tipo de venta): nunca cruza mercados.
create table crm.automations (
  id             uuid primary key default app.uuid_v7(),
  market_code    text not null references crm.markets(code),
  motor          text check (motor is null or length(motor) between 2 and 20),
  key            text not null check (key ~ '^[a-z0-9_]{3,60}$'),
  name_es        text not null check (length(btrim(name_es)) between 3 and 120),
  name_en        text not null check (length(btrim(name_en)) between 3 and 120),
  source         text not null check (source in ('deal','lead','account','account_pair')),
  trigger_kind   text not null check (trigger_kind in ('schedule','event')),
  trigger_event  text,
  conditions     jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  actions        jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) >= 1),
  is_active      boolean not null default true,
  version        int not null default 1,
  owner_id       uuid references crm.users(id),
  created_by     uuid references crm.users(id),
  updated_by     uuid references crm.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((trigger_kind = 'event') = (trigger_event is not null)),
  unique (market_code, key)
);

-- Bitácora por regla: cada vez que una automatización actuó sobre un registro, o por qué no aplicó.
create table crm.automation_log (
  id             uuid primary key default app.uuid_v7(),
  automation_id  uuid not null references crm.automations(id),
  version        int not null,
  market_code    text not null references crm.markets(code),
  object         text not null,
  record_id      uuid,
  record_label   text,
  outcome        text not null check (outcome in ('done','skipped','failed','closed')),
  detail         jsonb not null default '{}'::jsonb,
  at             timestamptz not null default now()
);
create index automation_log_rule_idx on crm.automation_log (automation_id, at desc);

-- Sobre qué registros ya actuó una automatización por horario, para no repetir la acción mientras la condición siga igual.
create table crm.automation_state (
  automation_id  uuid not null references crm.automations(id),
  record_id      uuid not null,
  since          timestamptz not null default now(),
  primary key (automation_id, record_id)
);

alter table crm.exceptions add column automation_id uuid references crm.automations(id);

-- ------------------------------------------------------------ 3) estancamiento: a quién se espera, y umbral propio
alter table crm.deals add column waiting_on text check (waiting_on is null or waiting_on in ('us','customer','third_party'));
alter table crm.stages
  add column rot_days_waiting int check (rot_days_waiting is null or rot_days_waiting between 0 and 365),
  add column sla_hours        int check (sla_hours is null or sla_hours between 1 and 2000);

-- ------------------------------------------------------------ 4) pasos de etapa con dueño, evidencia y aprobación
create table crm.stage_transitions (
  id                 uuid primary key default app.uuid_v7(),
  pipeline_id        uuid not null references crm.pipelines(id),
  from_stage_id      uuid references crm.stages(id),            -- null = desde cualquier etapa
  to_stage_id        uuid not null references crm.stages(id),
  allowed_roles      text[] not null default '{}' check (allowed_roles <@ array['admin','market_lead','supervisor','rep','ops']),
  requires_evidence  boolean not null default false,
  evidence_es        text check (evidence_es is null or length(evidence_es) <= 160),
  evidence_en        text check (evidence_en is null or length(evidence_en) <= 160),
  needs_approval     boolean not null default false,
  approver_role      text check (approver_role is null or approver_role in ('admin','market_lead','supervisor','ops')),
  approver_id        uuid references crm.users(id),
  backup_id          uuid references crm.users(id),
  approval_hours     int not null default 8 check (approval_hours between 1 and 240),
  is_active          boolean not null default true,
  updated_by         uuid references crm.users(id),
  updated_at         timestamptz not null default now(),
  check (from_stage_id is distinct from to_stage_id),
  check (not needs_approval or (approver_role is not null) <> (approver_id is not null)),
  check (backup_id is null or backup_id is distinct from approver_id)
);
create unique index stage_transitions_uq on crm.stage_transitions (pipeline_id, coalesce(from_stage_id, '00000000-0000-0000-0000-000000000000'::uuid), to_stage_id);

-- La evidencia es un enlace con nota (dónde está el documento), nunca el archivo: CONTIGO no guarda documentos.
create table crm.deal_evidence (
  id            uuid primary key default app.uuid_v7(),
  deal_id       uuid not null references crm.deals(id),
  market_code   text not null references crm.markets(code),
  to_stage_id   uuid not null references crm.stages(id),
  url           text not null check (url ~ '^https://[^[:space:]]{4,480}$'),
  note          text not null check (length(btrim(note)) between 2 and 300),
  added_by      uuid not null references crm.users(id),
  added_at      timestamptz not null default now()
);
create index deal_evidence_deal_idx on crm.deal_evidence (deal_id, added_at desc);

create table crm.approvals (
  id             uuid primary key default app.uuid_v7(),
  market_code    text not null references crm.markets(code),
  deal_id        uuid not null references crm.deals(id),
  transition_id  uuid not null references crm.stage_transitions(id),
  from_stage_id  uuid not null references crm.stages(id),
  to_stage_id    uuid not null references crm.stages(id),
  requested_by   uuid not null references crm.users(id),
  requested_at   timestamptz not null default now(),
  approver_role  text,
  approver_id    uuid references crm.users(id),
  backup_id      uuid references crm.users(id),
  due_at         timestamptz not null,
  escalated_at   timestamptz,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by     uuid references crm.users(id),
  decided_at     timestamptz,
  note           text check (note is null or length(note) <= 300),
  params         jsonb not null default '{}'::jsonb,           -- lo que acompañaba al movimiento (fecha de cierre, motivo de devolución)
  check ((status = 'pending') = (decided_at is null)),
  check (decided_by is null or decided_by <> requested_by or status = 'cancelled')
);
create unique index approvals_pending_uq on crm.approvals (deal_id) where status = 'pending';
create index approvals_due_idx on crm.approvals (due_at) where status = 'pending';

alter table crm.activities add column approval_id uuid references crm.approvals(id);
create index activities_approval_idx on crm.activities (approval_id) where approval_id is not null;

-- ------------------------------------------------------------ 5) escalamiento del primer contacto, por mercado
-- Apagado hasta que cada mercado lo encienda: la meta se fija con su propia línea base, no con una cifra prestada.
create table crm.lead_escalation (
  market_code   text primary key references crm.markets(code),
  is_active     boolean not null default false,
  level2_hours  int not null default 4 check (level2_hours between 1 and 72),
  updated_by    uuid references crm.users(id),
  updated_at    timestamptz not null default now()
);
insert into crm.lead_escalation (market_code) select code from crm.markets on conflict do nothing;
alter table crm.leads
  add column escalation_level smallint not null default 0 check (escalation_level between 0 and 2),
  add column escalated_at     timestamptz;

-- ------------------------------------------------------------ 6) permisos: RLS forzado en toda tabla nueva
do $$
declare t text;
begin
  foreach t in array array['job_runs','automations','automation_log','automation_state','stage_transitions','deal_evidence','approvals','lead_escalation'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
  end loop;
end $$;
grant select, insert on crm.job_runs, crm.automation_log, crm.deal_evidence to contigo_app;
grant select, insert, update on crm.automations, crm.stage_transitions, crm.approvals, crm.lead_escalation to contigo_app;
grant select, insert, delete on crm.automation_state to contigo_app;   -- estado de trabajo del motor de reglas, no un registro de negocio

-- Corridas: las lee quien administra o responde por los controles; solo las escribe el sistema.
create policy job_runs_read on crm.job_runs for select to contigo_app using ((select app.is_global()));
create policy job_runs_ins on crm.job_runs for insert to contigo_app with check ((select app.is_admin()));

create policy automations_read on crm.automations for select to contigo_app
  using ((select app.is_admin()) or market_code = any((select app.full_markets())::text[]));
create policy automations_ins on crm.automations for insert to contigo_app with check ((select app.is_admin()));
create policy automations_upd on crm.automations for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy automation_log_read on crm.automation_log for select to contigo_app
  using ((select app.is_admin()) or market_code = any((select app.full_markets())::text[]));
create policy automation_log_ins on crm.automation_log for insert to contigo_app with check ((select app.is_admin()));

create policy automation_state_all on crm.automation_state for all to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy stage_transitions_read on crm.stage_transitions for select to contigo_app using ((select app.current_user_id()) is not null);
create policy stage_transitions_ins on crm.stage_transitions for insert to contigo_app with check ((select app.is_admin()));
create policy stage_transitions_upd on crm.stage_transitions for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- Evidencia y aprobaciones: las ve quien ve el negocio; las escribe quien trabaja en ese mercado.
create policy deal_evidence_read on crm.deal_evidence for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_evidence.deal_id));
create policy deal_evidence_ins on crm.deal_evidence for insert to contigo_app
  with check (added_by = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.deals d where d.id = deal_evidence.deal_id and d.market_code = deal_evidence.market_code));

create policy approvals_read on crm.approvals for select to contigo_app
  using (requested_by = (select app.current_user_id()) or approver_id = (select app.current_user_id()) or backup_id = (select app.current_user_id())
         or exists (select 1 from crm.deals d where d.id = approvals.deal_id));
create policy approvals_ins on crm.approvals for insert to contigo_app
  with check (requested_by = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.deals d where d.id = approvals.deal_id and d.market_code = approvals.market_code));
-- Quién puede decidir lo valida el dominio (aprobador, suplente o su rol); la base exige mercado propio y que nadie decida lo suyo.
create policy approvals_upd on crm.approvals for update to contigo_app
  using (market_code = any((select app.write_markets())::text[]))
  with check (market_code = any((select app.write_markets())::text[])
              and (decided_by is null or decided_by = (select app.current_user_id()) or (select app.is_admin())));

create policy lead_escalation_read on crm.lead_escalation for select to contigo_app using ((select app.current_user_id()) is not null);
create policy lead_escalation_ins on crm.lead_escalation for insert to contigo_app with check ((select app.is_admin()));
create policy lead_escalation_upd on crm.lead_escalation for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- ------------------------------------------------------------ 7) AUT-01: un invariante que vale para toda vía de entrada
-- Un negocio vive en una etapa de SU embudo, y el embudo es de SU mercado. La pantalla, la API, la importación y las
-- automatizaciones escriben por caminos distintos; la base repite la regla para todos.
create or replace function crm.deal_integrity() returns trigger
language plpgsql as $$
declare v_pipe uuid; v_market text;
begin
  select s.pipeline_id into v_pipe from crm.stages s where s.id = new.stage_id;
  if v_pipe is distinct from new.pipeline_id then
    raise exception 'the stage does not belong to the pipeline of the deal' using errcode = '23514';
  end if;
  select p.market_code into v_market from crm.pipelines p where p.id = new.pipeline_id;
  if v_market is distinct from new.market_code then
    raise exception 'the pipeline does not belong to the market of the deal' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger deals_integrity before insert or update of stage_id, pipeline_id, market_code on crm.deals
  for each row execute function crm.deal_integrity();

-- Minutos hábiles del mercado entre dos momentos (el inverso de app.business_due): cuánto lleva vencida una meta.
create or replace function app.business_minutes(p_market text, p_from timestamptz, p_to timestamptz) returns numeric
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  a timestamp; b timestamp; day date; s timestamp; e timestamp;
  total numeric := 0; i int := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then return 0; end if;
  select m.timezone into tz from crm.markets m where m.code = p_market;
  tz := coalesce(tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  a := p_from at time zone tz; b := p_to at time zone tz;
  day := a::date;
  while day <= b::date and i < 370 loop
    if extract(isodow from day)::int = any(d) then
      s := greatest(a, day + o);
      e := least(b, day + c);
      if s < e then total := total + extract(epoch from (e - s)) / 60.0; end if;
    end if;
    day := day + 1; i := i + 1;
  end loop;
  return total;
end $$;
revoke execute on function app.business_minutes(text, timestamptz, timestamptz) from public;
grant execute on function app.business_minutes(text, timestamptz, timestamptz) to contigo_app;

-- Quiénes tienen un rol en un mercado (para resolver "avisar a supervisión" o "aprueba quien lidera"). Con rol de
-- supervisión y una persona de referencia, primero quienes supervisan su equipo. Solo devuelve identificadores.
create or replace function app.people_with_role(p_market text, p_role text, p_for uuid) returns setof uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with valid as (
    select m.user_id, m.role, m.market_code, m.team_id
      from crm.memberships m join crm.users u on u.id = m.user_id
     where u.is_active and not u.is_system and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       and (m.market_code = p_market or (m.market_code is null and m.role = 'admin'))
  ),
  team as (
    select distinct v.user_id from valid v
     where p_role = 'supervisor' and v.role = 'supervisor' and p_for is not null
       and v.team_id in (select x.team_id from valid x where x.user_id = p_for and x.team_id is not null)
  )
  select user_id from team
  union
  select distinct v.user_id from valid v where v.role = p_role and not exists (select 1 from team)
$$;
revoke execute on function app.people_with_role(text, text, uuid) from public;
grant execute on function app.people_with_role(text, text, uuid) to contigo_app;

-- Cuando el reloj de primer contacto vuelve a empezar (el lead pasó a otra persona), el escalamiento también.
create or replace function crm.lead_escalation_reset() returns trigger
language plpgsql as $$
begin
  if new.sla_due_at is distinct from old.sla_due_at then
    new.escalation_level := 0; new.escalated_at := null;
  end if;
  return new;
end $$;
create trigger leads_escalation_reset before update of sla_due_at on crm.leads
  for each row execute function crm.lead_escalation_reset();
