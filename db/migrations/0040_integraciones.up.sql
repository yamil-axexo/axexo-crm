-- 0040_integraciones: migración y convivencia con Pipedrive (E6, GOB-05) y lo que el equipo armó en Pipedrive, reconstruido en CONTIGO.
-- 1) E6.F2: lo editado en CONTIGO manda. La recarga recuerda qué trajo la última vez (crm.import_baselines) y, si alguien
--    cambió el campo en CONTIGO y Pipedrive también cambió, no pisa: deja el choque en crm.import_conflicts para que una persona decida.
-- 2) GOB-05 / E6.F3: convivencia por mercado (crm.pipedrive_cutover): fecha de corte, congelamiento, última sincronización y
--    apagado. Después del apagado, la recarga ya no toca registros de ese mercado.
-- 3) Lo que el equipo armó en Pipedrive (inventario del 13-nov): automatizaciones, regla de asignación, reportes, tableros,
--    meta y filtros. Todo se siembra aquí con crm.pipedrive_rebuild_apply(), que es idempotente y vuelve a correr al final del
--    seed y de cada carga de Pipedrive (lo que no existía en la base al migrar nace apagado con su motivo y se enciende cuando aparece).

-- ------------------------------------------------------------------ 1) lo editado en CONTIGO manda
create table crm.import_baselines (
  object       text not null check (object in ('account','contact','deal')),
  record_id    uuid not null,
  market_code  text not null references crm.markets(code),
  fields       jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  updated_at   timestamptz not null default now(),
  primary key (object, record_id)
);
alter table crm.import_baselines enable row level security;
alter table crm.import_baselines force row level security;   -- AUTHZ-03
revoke all on crm.import_baselines from contigo_app;
grant select, insert, update on crm.import_baselines to contigo_app;
create policy import_baselines_admin on crm.import_baselines for all to contigo_app
  using ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()))
  with check ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()));

create table crm.import_conflicts (
  id               uuid primary key default app.uuid_v7(),
  object           text not null check (object in ('account','contact','deal')),
  record_id        uuid not null,
  market_code      text not null references crm.markets(code),
  record_label     text check (record_label is null or length(record_label) <= 240),
  field            text not null check (field ~ '^[a-z_]{2,40}$'),
  contigo_value    jsonb,
  pipedrive_value  jsonb,
  status           text not null default 'open' check (status in ('open','kept','taken')),
  run_id           uuid,
  detected_at      timestamptz not null default now(),
  decided_by       uuid references crm.users(id),
  decided_at       timestamptz,
  check ((status = 'open') = (decided_at is null))
);
create unique index import_conflicts_open_uq on crm.import_conflicts (object, record_id, field) where status = 'open';
create index import_conflicts_market_idx on crm.import_conflicts (market_code, status, detected_at desc);
alter table crm.import_conflicts enable row level security;
alter table crm.import_conflicts force row level security;   -- AUTHZ-03
revoke all on crm.import_conflicts from contigo_app;
grant select, insert, update on crm.import_conflicts to contigo_app;
create policy import_conflicts_admin on crm.import_conflicts for all to contigo_app
  using ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()))
  with check ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()));

-- ------------------------------------------------------------------ 2) convivencia y corte por mercado
create table crm.pipedrive_cutover (
  market_code       text primary key references crm.markets(code),
  cutoff_on         date,                 -- fecha de corte planeada
  frozen_at         timestamptz,          -- desde aquí el equipo ya no edita en Pipedrive
  last_sync_at      timestamptz,          -- la última sincronización después del congelamiento
  pipedrive_off_at  timestamptz,          -- Pipedrive apagado para el mercado: la recarga ya no toca sus registros
  updated_by        uuid references crm.users(id),
  updated_at        timestamptz not null default now(),
  check (pipedrive_off_at is null or (frozen_at is not null and last_sync_at is not null))
);
alter table crm.pipedrive_cutover enable row level security;
alter table crm.pipedrive_cutover force row level security;   -- AUTHZ-03
revoke all on crm.pipedrive_cutover from contigo_app;
grant select, insert, update on crm.pipedrive_cutover to contigo_app;
create policy pipedrive_cutover_read on crm.pipedrive_cutover for select to contigo_app using ((select app.current_user_id()) is not null);
create policy pipedrive_cutover_ins on crm.pipedrive_cutover for insert to contigo_app with check ((select app.is_admin()));
create policy pipedrive_cutover_upd on crm.pipedrive_cutover for update to contigo_app
  using ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()))
  with check ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()));

-- ------------------------------------------------------------------ 3) lo reconstruido desde Pipedrive
alter table crm.automations
  add column pipedrive_ref   text check (pipedrive_ref is null or length(pipedrive_ref) between 2 and 120),
  add column description_es  text check (description_es is null or length(description_es) <= 600),
  add column description_en  text check (description_en is null or length(description_en) <= 600),
  add column off_reason_es   text check (off_reason_es is null or length(off_reason_es) <= 300),
  add column off_reason_en   text check (off_reason_en is null or length(off_reason_en) <= 300),
  add column touched_by_person boolean not null default false;   -- si alguien la encendió o apagó a mano, la reconstrucción no la vuelve a tocar

alter table crm.routing_rules
  add column pipeline_id    uuid references crm.pipelines(id),
  add column pipedrive_ref  text check (pipedrive_ref is null or length(pipedrive_ref) between 2 and 120);

-- Tableros de fábrica: un nombre y la lista de reportes guardados que junta.
create table crm.report_boards (
  id             uuid primary key default app.uuid_v7(),
  key            text not null unique check (key ~ '^[a-z0-9_]{3,60}$'),
  market_code    text references crm.markets(code),
  name_es        text not null check (length(btrim(name_es)) between 3 and 120),
  name_en        text not null check (length(btrim(name_en)) between 3 and 120),
  report_ids     uuid[] not null default '{}',
  pipedrive_ref  text check (pipedrive_ref is null or length(pipedrive_ref) between 2 and 120),
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
alter table crm.report_boards enable row level security;
alter table crm.report_boards force row level security;   -- AUTHZ-03
revoke all on crm.report_boards from contigo_app;
grant select on crm.report_boards to contigo_app;
create policy report_boards_read on crm.report_boards for select to contigo_app
  using ((select app.current_user_id()) is not null and (market_code is null or market_code = any((select app.my_markets())::text[]) or (select app.is_global())));

-- Metas: cuánto se quiere lograr (negocios ganados) por mercado, equipo o persona en un periodo. Sin número, la meta muestra el avance y dice que falta la cifra.
create table crm.goals (
  id             uuid primary key default app.uuid_v7(),
  key            text unique check (key is null or key ~ '^[a-z0-9_]{3,60}$'),
  market_code    text not null references crm.markets(code),
  scope          text not null check (scope in ('market','team','person')),
  team_id        uuid references crm.teams(id),
  user_id        uuid references crm.users(id),
  metric         text not null default 'deals_won' check (metric in ('deals_won')),
  period         text not null default 'month' check (period in ('month','quarter')),
  target         int check (target is null or target between 1 and 100000),
  name_es        text not null check (length(btrim(name_es)) between 3 and 120),
  name_en        text not null check (length(btrim(name_en)) between 3 and 120),
  pipedrive_ref  text check (pipedrive_ref is null or length(pipedrive_ref) between 2 and 120),
  is_active      boolean not null default true,
  updated_by     uuid references crm.users(id),
  updated_at     timestamptz not null default now(),
  check ((scope = 'team') = (team_id is not null)),
  check ((scope = 'person') = (user_id is not null))
);
alter table crm.goals enable row level security;
alter table crm.goals force row level security;   -- AUTHZ-03
revoke all on crm.goals from contigo_app;
grant select, insert on crm.goals to contigo_app;
grant update (target, name_es, name_en, period, is_active, updated_by, updated_at) on crm.goals to contigo_app;
create policy goals_read on crm.goals for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]) or (select app.is_global()));
create policy goals_ins on crm.goals for insert to contigo_app with check ((select app.is_admin()) or (select app.current_user_id()) = (select app.system_user_id()));
create policy goals_upd on crm.goals for update to contigo_app
  using ((select app.is_admin()) or market_code = any((select app.full_markets())::text[]))
  with check ((select app.is_admin()) or market_code = any((select app.full_markets())::text[]));

-- La tabla de equivalencias: cada cosa que el equipo armó en Pipedrive y dónde quedó en CONTIGO.
create table crm.pipedrive_rebuild (
  kind           text not null check (kind in ('automation','assignment','report','dashboard','goal','filter')),
  pd_name        text not null check (length(pd_name) between 2 and 160),
  position       int not null default 0,
  market_code    text references crm.markets(code),
  status         text not null check (status in ('built','off','pending')),
  contigo_kind   text not null check (contigo_kind in ('automation','routing_rule','saved_report','report_board','goal','saved_view','none')),
  contigo_id     uuid,
  contigo_path   text check (contigo_path is null or length(contigo_path) <= 200),
  note_es        text check (note_es is null or length(note_es) <= 400),
  note_en        text check (note_en is null or length(note_en) <= 400),
  updated_at     timestamptz not null default now(),
  primary key (kind, pd_name)
);
alter table crm.pipedrive_rebuild enable row level security;
alter table crm.pipedrive_rebuild force row level security;   -- AUTHZ-03
revoke all on crm.pipedrive_rebuild from contigo_app;
grant select on crm.pipedrive_rebuild to contigo_app;
create policy pipedrive_rebuild_read on crm.pipedrive_rebuild for select to contigo_app using ((select app.is_admin()));

-- Las dos plantillas de correo de la conferencia de Las Vegas (automatizaciones 8 y 9). El canal de correo sigue apagado.
insert into crm.message_templates (key, market_code, version, recipient, trigger_event, needs_consent, subject_es, body_es, subject_en, body_en)
select v.key, 'US', 1, 'lead', 'automation', false, v.ses, v.bes, v.sen, v.ben from (values
  ('vegas_2026_welcome',
   'Gracias por visitarnos en Las Vegas, {{contacto}}',
   'Hola {{contacto}}: gracias por pasar por nuestro stand. {{quien}} va a ser tu contacto para dar de alta a {{comercio}}. Te escribimos pronto con los siguientes pasos.',
   'Thanks for visiting us in Las Vegas, {{contacto}}',
   'Hi {{contacto}}: thanks for stopping by our booth. {{quien}} will be your contact to sign up {{comercio}}. We will write soon with the next steps.'),
  ('vegas_2026_followup',
   'Seguimos en contacto, {{contacto}}',
   'Hola {{contacto}}: quería darte las gracias en persona por tu interés en axexo. Si {{comercio}} quiere avanzar, {{quien}} te acompaña. Saludos, [pendiente: nombre del GM de US]',
   'Keeping in touch, {{contacto}}',
   'Hi {{contacto}}: I wanted to thank you personally for your interest in axexo. If {{comercio}} wants to move forward, {{quien}} will help you. Best, [pending: name of the US GM]')
) v(key, ses, bes, sen, ben)
where exists (select 1 from crm.markets where code = 'US')
  and not exists (select 1 from crm.message_templates t where t.key = v.key and t.market_code = 'US');

-- ------------------------------------------------------------------ la reconstrucción (idempotente)
create or replace function crm.pipedrive_rebuild_apply() returns int
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare
  sys uuid := app.system_user_id();
  dealer uuid;
  vegas uuid;
  approvals text;
  lead_captured text;
  missing_es text;
  missing_en text;
  r record;
  mx record;
  mx_ids uuid[];
  aid uuid;
  rid uuid;
  ok boolean;
  n int := 0;
begin
  if not exists (select 1 from crm.markets where code = 'US') then return 0; end if;
  -- El embudo de alta de dealers de US y el de la conferencia de Las Vegas, si ya existen en esta base.
  select p.id into dealer from crm.pipelines p where p.market_code = 'US' and p.is_active
     and (p.name ilike '%dealer enrollment%' or p.name ilike '%dealer onboarding%' or p.motor = 'dealer') order by p.position, p.id limit 1;
  select p.id into vegas from crm.pipelines p where p.market_code = 'US' and p.is_active and p.name ilike '%vegas%' order by p.position, p.id limit 1;
  select s.code into approvals from crm.stages s where s.pipeline_id = dealer and s.archived_at is null and (s.name_en ilike 'approval%' or s.code ilike 'approval%') order by s.position limit 1;
  select s.code into lead_captured from crm.stages s where s.pipeline_id = vegas and s.archived_at is null and s.name_en ilike 'lead captured%' order by s.position limit 1;

  -- ------------------------------------------------ automatizaciones (9)
  for r in select * from (values
    (1, 'pd_owner_at_approvals', 'Owner - Valentina at Approvals (US)', 'Al entrar a Aprobaciones, el negocio pasa a la cola de Operaciones', 'On reaching Approvals, the deal goes to the Operations queue',
     'deal', 'deal.stage_changed', true, 'dealer', null::text,
     'En Pipedrive cambiaba quien lleva el negocio a una persona fija. En CONTIGO el negocio entra a la cola de Operaciones (la entrega) y conserva a quien lo vendió; si se quiere una persona fija, se elige en la acción.',
     'In Pipedrive it changed the deal owner to a fixed person. In CONTIGO the deal enters the Operations queue (the handoff) and keeps who sold it; to use a fixed person, choose it in the action.'),
    (2, 'pd_sales_rep_new_deal', 'Sales Rep - new US deal (added)', 'Negocio nuevo de alta de dealers: quien vende es quien lo lleva', 'New dealer sign-up deal: the sales rep is the owner',
     'deal', 'deal.created', true, 'dealer', 'sales_rep',
     'Copia a quien lleva el negocio en el campo "Sales Rep" si está vacío. CONTIGO además fija a quien vendió cuando el negocio llega a Operaciones.',
     'Copies the deal owner into the "Sales Rep" field when it is empty. CONTIGO also fixes the sales rep when the deal reaches Operations.'),
    (3, 'pd_sales_rep_follows_owner', 'Sales Rep - follows owner (updated)', 'Cambia quien lleva el negocio: quien vende lo sigue hasta Operaciones', 'The deal owner changes: the sales rep follows until Operations',
     'deal', 'deal.owner_changed', true, 'dealer', 'sales_rep',
     'Mientras el negocio no llega a Aprobaciones ni a las etapas de Operaciones, el campo "Sales Rep" sigue a quien lleva el negocio.',
     'While the deal has not reached Approvals or the Operations stages, the "Sales Rep" field follows the deal owner.'),
    (4, 'pd_recruited_by_ace', 'Recruited by - ACE deal (added)', 'Negocio nuevo de ciertas personas: reclutado por ACE', 'New deal from certain people: recruited by ACE',
     'deal', 'deal.created', true, 'dealer', 'recruited_by',
     'Lista de personas vacía: los tres nombres no salen en la vista de Pipedrive. [pendiente: LuisRo Sanabria]',
     'Empty list of people: the three names do not show in the Pipedrive view. [pending: LuisRo Sanabria]'),
    (5, 'pd_merchant_origin_updated', 'Merchant Origin - US organization (updated)', 'Comercio de US sin origen: nueva adquisición', 'US merchant with no origin: new acquisition',
     'account', 'account.updated', true, null, 'merchant_origin',
     'Pone "New acquisition" en el origen del comercio solo si está vacío. Nunca sobrescribe.', 'Sets "New acquisition" as the merchant origin only if it is empty. It never overwrites.'),
    (6, 'pd_merchant_origin_created', 'Merchant Origin - new US organization (created)', 'Comercio nuevo de US: nueva adquisición', 'New US merchant: new acquisition',
     'account', 'account.created', true, null, 'merchant_origin',
     'Pone "New acquisition" en el origen del comercio nuevo si viene vacío.', 'Sets "New acquisition" as the origin of a new merchant when it comes empty.'),
    (7, 'pd_portal_migration_date', 'Stamp Portal Migration Date', 'Migración al portal completada: anota la fecha', 'Portal migration completed: record the date',
     'account', 'account.custom_updated', true, null, 'portal_migration_date',
     'Cuando el estado de migración al portal queda en "Completed", anota la fecha de ese día.', 'When the portal migration status becomes "Completed", records that day''s date.'),
    (8, 'pd_welcome_vegas_2026', 'Welcome Email - Vegas 2026', 'Las Vegas 2026: correo de bienvenida', 'Las Vegas 2026: welcome email',
     'deal', 'deal.created', false, 'vegas', null,
     'Deja listo el correo de bienvenida al contacto del negocio con la plantilla "vegas_2026_welcome". El canal de correo está apagado: el mensaje queda en la cola sin salir.',
     'Prepares the welcome email to the deal contact with the "vegas_2026_welcome" template. The email channel is off: the message stays in the queue without going out.'),
    (9, 'pd_followup_vegas_2026', 'Welcome Email - Vegas 2026 (Manual Run)', 'Las Vegas 2026: correo de seguimiento del GM de US', 'Las Vegas 2026: follow-up email from the US GM',
     'deal', 'deal.stage_changed', false, 'vegas', null,
     'Plantilla "vegas_2026_followup", firmada por el GM de US. [pendiente: nombre del GM de US] El canal de correo está apagado.',
     'Template "vegas_2026_followup", signed by the US GM. [pending: name of the US GM] The email channel is off.')
  ) v(pos, key, pd, nes, nen, source, ev, active, pipe, field, des, den) loop
    missing_es := null; missing_en := null;
    if r.pipe = 'dealer' and dealer is null then
      missing_es := 'No existe el embudo de alta de dealers de US en esta base.'; missing_en := 'The US dealer sign-up pipeline does not exist in this database.';
    elsif r.pipe = 'vegas' and vegas is null then
      missing_es := 'No existe el embudo de la conferencia de Las Vegas en esta base.'; missing_en := 'The Las Vegas conference pipeline does not exist in this database.';
    elsif r.key = 'pd_owner_at_approvals' and approvals is null then
      missing_es := 'El embudo de alta de dealers no tiene la etapa Aprobaciones.'; missing_en := 'The dealer sign-up pipeline has no Approvals stage.';
    elsif r.key in ('pd_welcome_vegas_2026', 'pd_followup_vegas_2026') and lead_captured is null then
      missing_es := 'El embudo de Las Vegas no tiene la etapa "Lead captured".'; missing_en := 'The Las Vegas pipeline has no "Lead captured" stage.';
    elsif r.field is not null and not exists (select 1 from crm.field_definitions f where f.object = r.source and f.key = r.field and f.is_active and (f.market_code is null or f.market_code = 'US')) then
      missing_es := format('No existe el campo "%s" en esta base: llega con la carga de Pipedrive.', r.field); missing_en := format('The "%s" field does not exist in this database: it arrives with the Pipedrive load.', r.field);
    elsif r.key = 'pd_portal_migration_date' and not exists (select 1 from crm.field_definitions f where f.object = 'account' and f.key = 'portal_migration_status' and f.is_active) then
      missing_es := 'No existe el campo "portal_migration_status" en esta base: llega con la carga de Pipedrive.'; missing_en := 'The "portal_migration_status" field does not exist in this database: it arrives with the Pipedrive load.';
    end if;
    insert into crm.automations (market_code, key, name_es, name_en, source, trigger_kind, trigger_event, conditions, actions, is_active, pipedrive_ref,
                                 description_es, description_en, off_reason_es, off_reason_en, created_by, updated_by)
    values ('US', r.key, r.nes, r.nen, r.source, 'event', r.ev,
            case r.key
              when 'pd_owner_at_approvals' then jsonb_build_array(jsonb_build_object('field', 'pipeline_id', 'op', 'eq', 'value', dealer::text), jsonb_build_object('field', 'stage_code', 'op', 'eq', 'value', approvals))
              when 'pd_sales_rep_new_deal' then jsonb_build_array(jsonb_build_object('field', 'pipeline_id', 'op', 'eq', 'value', dealer::text), jsonb_build_object('field', 'custom:sales_rep', 'op', 'is_empty'))
              when 'pd_sales_rep_follows_owner' then jsonb_build_array(jsonb_build_object('field', 'pipeline_id', 'op', 'eq', 'value', dealer::text), jsonb_build_object('field', 'is_ops_stage', 'op', 'is_false'))
              when 'pd_recruited_by_ace' then jsonb_build_array(jsonb_build_object('field', 'pipeline_id', 'op', 'eq', 'value', dealer::text), jsonb_build_object('field', 'owner_id', 'op', 'in', 'value', ''))
              when 'pd_merchant_origin_updated' then jsonb_build_array(jsonb_build_object('field', 'custom:merchant_origin', 'op', 'is_empty'))
              when 'pd_merchant_origin_created' then jsonb_build_array(jsonb_build_object('field', 'custom:merchant_origin', 'op', 'is_empty'))
              when 'pd_portal_migration_date' then jsonb_build_array(jsonb_build_object('field', 'custom:portal_migration_status', 'op', 'eq', 'value', 'Completed'), jsonb_build_object('field', 'custom:portal_migration_date', 'op', 'is_empty'))
              else jsonb_build_array(jsonb_build_object('field', 'pipeline_id', 'op', 'eq', 'value', vegas::text), jsonb_build_object('field', 'stage_code', 'op', 'eq', 'value', lead_captured))
            end,
            case r.key
              when 'pd_owner_at_approvals' then jsonb_build_array(jsonb_build_object('type', 'ops_handoff', 'to', 'queue'))
              when 'pd_sales_rep_new_deal' then jsonb_build_array(jsonb_build_object('type', 'set_custom', 'field', 'sales_rep', 'from', 'owner', 'keep', true))
              when 'pd_sales_rep_follows_owner' then jsonb_build_array(jsonb_build_object('type', 'set_custom', 'field', 'sales_rep', 'from', 'owner', 'keep', false))
              when 'pd_recruited_by_ace' then jsonb_build_array(jsonb_build_object('type', 'set_custom', 'field', 'recruited_by', 'from', 'value', 'value', 'ACE', 'keep', false))
              when 'pd_merchant_origin_updated' then jsonb_build_array(jsonb_build_object('type', 'set_custom', 'field', 'merchant_origin', 'from', 'value', 'value', 'New acquisition', 'keep', true))
              when 'pd_merchant_origin_created' then jsonb_build_array(jsonb_build_object('type', 'set_custom', 'field', 'merchant_origin', 'from', 'value', 'value', 'New acquisition', 'keep', true))
              when 'pd_portal_migration_date' then jsonb_build_array(jsonb_build_object('type', 'set_custom', 'field', 'portal_migration_date', 'from', 'today', 'keep', true))
              when 'pd_welcome_vegas_2026' then jsonb_build_array(jsonb_build_object('type', 'send_email', 'template', 'vegas_2026_welcome'))
              else jsonb_build_array(jsonb_build_object('type', 'send_email', 'template', 'vegas_2026_followup'))
            end,
            r.active and missing_es is null, r.pd, r.des, r.den, missing_es, missing_en, sys, sys)
    on conflict (market_code, key) do update set
      conditions = case when crm.automations.touched_by_person then crm.automations.conditions else excluded.conditions end,
      actions = case when crm.automations.touched_by_person then crm.automations.actions else excluded.actions end,
      is_active = case when crm.automations.touched_by_person then crm.automations.is_active else excluded.is_active end,
      off_reason_es = excluded.off_reason_es, off_reason_en = excluded.off_reason_en,
      description_es = excluded.description_es, description_en = excluded.description_en, pipedrive_ref = excluded.pipedrive_ref
    returning id into aid;
    insert into crm.pipedrive_rebuild (kind, pd_name, position, market_code, status, contigo_kind, contigo_id, contigo_path, note_es, note_en)
    values ('automation', r.pd, r.pos, 'US', case when missing_es is not null then 'off' when r.active then 'built' else 'off' end, 'automation', aid, '/admin/automatizaciones/' || aid,
            coalesce(missing_es, case when r.active then r.des else 'Apagada como en Pipedrive. ' || r.des end), coalesce(missing_en, case when r.active then r.den else 'Off, as in Pipedrive. ' || r.den end))
    on conflict (kind, pd_name) do update set status = excluded.status, contigo_id = excluded.contigo_id, contigo_path = excluded.contigo_path,
      note_es = excluded.note_es, note_en = excluded.note_en, updated_at = now();
    n := n + 1;
  end loop;

  -- ------------------------------------------------ regla de asignación: turno rotativo de Las Vegas
  select id into rid from crm.routing_rules where pipedrive_ref = 'Las Vegas Round Robin' limit 1;
  if rid is null then
    insert into crm.routing_rules (market_code, name, strategy, member_ids, pipeline_id, pipedrive_ref, is_active)
    values ('US', 'Las Vegas Round Robin', 'round_robin',
            coalesce(array(select distinct m.user_id from crm.memberships m join crm.users u on u.id = m.user_id
                            where m.market_code = 'US' and m.role = 'rep' and u.is_active and not u.is_system and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
                            order by m.user_id), '{}'),
            vegas, 'Las Vegas Round Robin', vegas is not null)
    returning id into rid;
  else
    update crm.routing_rules set pipeline_id = coalesce(pipeline_id, vegas), is_active = case when pipeline_id is null and vegas is not null then true else is_active end where id = rid;
  end if;
  insert into crm.automations (market_code, key, name_es, name_en, source, trigger_kind, trigger_event, conditions, actions, is_active, pipedrive_ref,
                               description_es, description_en, off_reason_es, off_reason_en, created_by, updated_by)
  values ('US', 'pd_vegas_round_robin', 'Las Vegas: reparto por turno de los negocios nuevos', 'Las Vegas: round robin for new deals', 'deal', 'event', 'deal.created',
          jsonb_build_array(jsonb_build_object('field', 'pipeline_id', 'op', 'eq', 'value', vegas::text)),
          jsonb_build_array(jsonb_build_object('type', 'assign_turn', 'rule_id', rid::text)),
          vegas is not null, 'Las Vegas Round Robin',
          'Cada negocio nuevo del embudo de Las Vegas pasa por turno a la siguiente persona del equipo de ventas de US. Quién entra al turno se cambia en Administración > Formularios y turnos.',
          'Each new deal in the Las Vegas pipeline goes in turn to the next person on the US sales team. Who is in the turn is changed in Administration > Forms and turns.',
          case when vegas is null then 'No existe el embudo de la conferencia de Las Vegas en esta base.' end,
          case when vegas is null then 'The Las Vegas conference pipeline does not exist in this database.' end, sys, sys)
  on conflict (market_code, key) do update set
    conditions = case when crm.automations.touched_by_person then crm.automations.conditions else excluded.conditions end,
    actions = case when crm.automations.touched_by_person then crm.automations.actions else excluded.actions end,
    is_active = case when crm.automations.touched_by_person then crm.automations.is_active else excluded.is_active end,
    off_reason_es = excluded.off_reason_es, off_reason_en = excluded.off_reason_en
  returning id into aid;
  insert into crm.pipedrive_rebuild (kind, pd_name, position, market_code, status, contigo_kind, contigo_id, contigo_path, note_es, note_en)
  values ('assignment', 'Las Vegas Round Robin', 1, 'US', case when vegas is null then 'off' else 'built' end, 'automation', aid, '/admin/automatizaciones/' || aid,
          case when vegas is null then 'Turno creado; se enciende cuando exista el embudo de Las Vegas.' else 'Turno rotativo del embudo de Las Vegas, con el equipo de ventas de US.' end,
          case when vegas is null then 'Turn created; it switches on once the Las Vegas pipeline exists.' else 'Round robin of the Las Vegas pipeline, with the US sales team.' end)
  on conflict (kind, pd_name) do update set status = excluded.status, contigo_id = excluded.contigo_id, contigo_path = excluded.contigo_path, note_es = excluded.note_es, note_en = excluded.note_en, updated_at = now();

  if sys is null then return n; end if;

  -- ------------------------------------------------ reportes (12): reportes guardados y compartidos de la galería, con el mismo corte
  for r in select * from (values
    (1, 'US - Deals waiting in Approvals (by owner)', 'etapas', 'US · Negocios esperando en Aprobaciones, por persona', jsonb_build_object('mercado', 'US', 'embudo', dealer::text, 'por', 'persona'), 'dealer'),
    (2, 'US - Deals with no next step (stall risk, by stage)', 'etapas', 'US · Negocios sin próximo paso, por etapa', jsonb_build_object('mercado', 'US', 'embudo', dealer::text, 'ver', 'sin_paso'), 'dealer'),
    (3, 'US - Intake over time (new deals)', 'mercado', 'US · Negocios nuevos por mes', jsonb_build_object('mercado', 'US'), null),
    (4, 'US - Sales funnel (conversion by stage)', 'historico', 'US · Conversión por etapa', jsonb_build_object('mercado', 'US', 'embudo', dealer::text), 'dealer'),
    (5, 'US - Time in stage', 'historico', 'US · Tiempo en cada etapa', jsonb_build_object('mercado', 'US', 'embudo', dealer::text, 'ver', 'velocidad'), 'dealer'),
    (6, 'US - Vegas open deals by rep (by stage)', 'etapas', 'US · Vegas, negocios abiertos por persona', jsonb_build_object('mercado', 'US', 'embudo', vegas::text, 'por', 'persona'), 'vegas'),
    (7, 'US - Vegas Leads Activities by rep (by type)', 'campo', 'US · Vegas, actividades por persona', jsonb_build_object('mercado', 'US', 'embudo', vegas::text), 'vegas'),
    (8, 'US - Vegas Open deals by stage', 'etapas', 'US · Vegas, negocios abiertos por etapa', jsonb_build_object('mercado', 'US', 'embudo', vegas::text), 'vegas'),
    (9, 'US - Activities by rep (by type)', 'campo', 'US · Actividades por persona', jsonb_build_object('mercado', 'US'), null),
    (10, 'US — Deals por loss reason', 'cerrados', 'US · Negocios perdidos por motivo', jsonb_build_object('mercado', 'US', 'resultado', 'lost', 'por', 'motivo'), null),
    (11, 'US — Deals entrando por stage (mensual)', 'mercado', 'US · Negocios que entran a cada etapa por mes', jsonb_build_object('mercado', 'US', 'embudo', dealer::text), 'dealer'),
    (12, 'US — Vegas Funnel conversion (Lead→Won)', 'historico', 'US · Vegas, conversión de lead a ganado', jsonb_build_object('mercado', 'US', 'embudo', vegas::text), 'vegas')
  ) v(pos, pd, report, name, params, pipe) loop
    ok := not (r.pipe = 'dealer' and dealer is null) and not (r.pipe = 'vegas' and vegas is null);
    select id into rid from crm.saved_reports where user_id = sys and name = r.name limit 1;
    if rid is null then
      insert into crm.saved_reports (user_id, report, name, params, is_shared, market_code)
      values (sys, r.report, r.name, jsonb_strip_nulls(r.params), true, 'US') returning id into rid;
    else
      update crm.saved_reports set params = jsonb_strip_nulls(r.params) where id = rid;
    end if;
    insert into crm.pipedrive_rebuild (kind, pd_name, position, market_code, status, contigo_kind, contigo_id, contigo_path, note_es, note_en)
    values ('report', r.pd, r.pos, 'US', case when ok then 'built' else 'pending' end, 'saved_report', rid, '/reportes#guardados',
            case when ok then 'Reporte guardado y compartido con US: "' || r.name || '".' else 'Reporte guardado; el embudo que filtra no existe en esta base y muestra todo US hasta que llegue.' end,
            case when ok then 'Saved report shared with US.' else 'Saved report; the pipeline it filters does not exist in this database, so it shows all of US until it arrives.' end)
    on conflict (kind, pd_name) do update set status = excluded.status, contigo_id = excluded.contigo_id, contigo_path = excluded.contigo_path, note_es = excluded.note_es, note_en = excluded.note_en, updated_at = now();
  end loop;

  -- ------------------------------------------------ tableros (6)
  for r in select * from (values
    (1, 'US - Dealer Enrollment Ops', 'us_dealer_ops', 'US · Alta de dealers, Operaciones', 'US · Dealer sign-up, Operations', 'US', array[1, 2, 3, 4, 5, 9, 10, 11]),
    (2, 'US - Vegas Sales Overview', 'us_vegas_sales', 'US · Vegas, ventas', 'US · Vegas, sales', 'US', array[6, 7, 8, 12]),
    (3, 'MX Transacciones — Preview', 'mx_transacciones', 'MX · Transacciones', 'MX · Transactions', 'MX', array[]::int[]),
    (4, 'MX Cobertura', 'mx_cobertura', 'MX · Cobertura', 'MX · Coverage', 'MX', array[]::int[]),
    (5, 'MX Enrollment — Funnel', 'mx_enrollment', 'MX · Embudo de altas', 'MX · Sign-up funnel', 'MX', array[]::int[]),
    (6, 'MX Ops — Tiendas', 'mx_ops_tiendas', 'MX · Operaciones, tiendas', 'MX · Operations, stores', 'MX', array[]::int[])
  ) v(pos, pd, key, nes, nen, market, reports) loop
    continue when not exists (select 1 from crm.markets where code = r.market);
    mx_ids := '{}';
    if r.market = 'MX' then
      -- Los tableros de México no tenían reportes propios en Pipedrive: juntan los reportes de México que ya existen en la galería.
      for mx in select * from (values
        ('mx_transacciones', 'conciliacion', 'MX · Conciliación con el archivo de ventas'), ('mx_transacciones', 'finanzas', 'MX · Ganados por periodo'),
        ('mx_cobertura', 'indicadores-campo', 'MX · Indicadores de campo'), ('mx_cobertura', 'campo', 'MX · Reporte de campo'),
        ('mx_enrollment', 'etapas', 'MX · Negocios por etapa'), ('mx_enrollment', 'leads', 'MX · Leads captados y convertidos'), ('mx_enrollment', 'mercado', 'MX · Reporte del mercado'),
        ('mx_ops_tiendas', 'cuentas', 'MX · Cadenas y cuentas clave'), ('mx_ops_tiendas', 'historico', 'MX · Histórico')
      ) w(board, report, name) where w.board = r.key loop
        select id into rid from crm.saved_reports where user_id = sys and name = mx.name limit 1;
        if rid is null then
          insert into crm.saved_reports (user_id, report, name, params, is_shared, market_code) values (sys, mx.report, mx.name, jsonb_build_object('mercado', 'MX'), true, 'MX') returning id into rid;
        end if;
        mx_ids := mx_ids || rid;
      end loop;
    end if;
    insert into crm.report_boards (key, market_code, name_es, name_en, report_ids, pipedrive_ref, position)
    values (r.key, r.market, r.nes, r.nen,
            case when r.market = 'MX' then mx_ids else coalesce(array(select pr.contigo_id from crm.pipedrive_rebuild pr where pr.kind = 'report' and pr.position = any(r.reports) order by pr.position), '{}') end,
            r.pd, r.pos)
    on conflict (key) do update set report_ids = case when cardinality(excluded.report_ids) > 0 then excluded.report_ids else crm.report_boards.report_ids end
    returning id into rid;
    insert into crm.pipedrive_rebuild (kind, pd_name, position, market_code, status, contigo_kind, contigo_id, contigo_path, note_es, note_en)
    values ('dashboard', r.pd, r.pos, r.market, 'built', 'report_board', rid, '/reportes#tablero-' || r.key,
            case when r.market = 'US' then 'Tablero de fábrica con los reportes de US que juntaba.' else 'Tablero de México: en Pipedrive no tenía reportes propios; junta los reportes de México de la galería.' end,
            case when r.market = 'US' then 'Factory board with the US reports it gathered.' else 'Mexico board: it had no reports of its own in Pipedrive; it gathers the Mexico reports in the gallery.' end)
    on conflict (kind, pd_name) do update set contigo_id = excluded.contigo_id, contigo_path = excluded.contigo_path, updated_at = now();
  end loop;

  -- ------------------------------------------------ meta "Deals won"
  insert into crm.goals (key, market_code, scope, metric, period, target, name_es, name_en, pipedrive_ref, updated_by)
  values ('pd_deals_won_us', 'US', 'market', 'deals_won', 'month', null, 'Negocios ganados del mes', 'Deals won this month', 'Deals won', sys)
  on conflict (key) do nothing;
  select id into rid from crm.goals where key = 'pd_deals_won_us';
  insert into crm.pipedrive_rebuild (kind, pd_name, position, market_code, status, contigo_kind, contigo_id, contigo_path, note_es, note_en)
  values ('goal', 'Deals won', 1, 'US', 'built', 'goal', rid, '/panel-lt',
          'Meta de negocios ganados por mes en US, a la vista en el Panel y en Mi equipo. La cifra la pone quien lidera el mercado: [pendiente: cifra de la meta].',
          'Monthly deals won goal for the US, shown on the Panel and in My team. The market lead sets the number: [pending: goal figure].')
  on conflict (kind, pd_name) do update set contigo_id = excluded.contigo_id, updated_at = now();

  -- ------------------------------------------------ filtros del equipo (10)
  for r in select * from (values
    (1, 'US Dealer Enrollment - deals without rep', 'deal', 'US · Alta de dealers sin persona asignada', jsonb_build_object('pipeline', dealer::text, 'owner', 'none', 'vista', 'lista'), 'dealer', null::text),
    (2, 'Vegas AWPE - Audit', 'deal', 'Vegas · Revisión', jsonb_build_object('pipeline', vegas::text, 'vista', 'lista'), 'vegas', null),
    (3, 'Vegas AWPE - Lost', 'report', 'Vegas · Perdidos', jsonb_build_object('mercado', 'US', 'embudo', vegas::text, 'resultado', 'lost', 'periodo', 'trimestre'), 'vegas', null),
    (4, 'Vegas AWPE - Lost no response', 'report', 'Vegas · Perdidos sin respuesta', jsonb_build_object('mercado', 'US', 'embudo', vegas::text, 'resultado', 'lost', 'por', 'motivo', 'periodo', 'trimestre'), 'vegas', null),
    (5, 'Vegas AWPE - Open (No Last Activity Date)', 'deal', 'Vegas · Abiertos sin actividad registrada', jsonb_build_object('pipeline', vegas::text, 'quietos', '30', 'vista', 'lista'), 'vegas', null),
    (6, 'Vegas AWPE - Open (No Sales Contact)', 'deal', 'Vegas · Abiertos sin persona de ventas', jsonb_build_object('pipeline', vegas::text, 'owner', 'none', 'vista', 'lista'), 'vegas', null),
    (7, 'Vegas AWPE - Open no activity', 'deal', 'Vegas · Abiertos sin próximo paso', jsonb_build_object('pipeline', vegas::text, 'paso', 'sin', 'vista', 'lista'), 'vegas', null),
    (8, 'US - Organizations', 'account', 'US · Organizaciones', jsonb_build_object('market', 'US', 'kind', 'organization'), null, null),
    (9, 'US · axexo Business Portal', 'account', 'US · Portal axexo Business', jsonb_build_object('market', 'US'), null,
        'La condición exacta del filtro no sale en el inventario: queda como todos los comercios de US. [pendiente: condición del filtro, LuisRo Sanabria]'),
    (10, 'US - People', 'none', 'US · Personas', '{}'::jsonb, null,
        'CONTIGO no tiene una lista de personas aparte: los contactos viven en la ficha de cada comercio y se buscan desde Buscar.')
  ) v(pos, pd, obj, name, filters, pipe, note) loop
    ok := not (r.pipe = 'dealer' and dealer is null) and not (r.pipe = 'vegas' and vegas is null);
    rid := null;
    if r.obj = 'none' then
      null;
    elsif not ok then
      null;
    elsif r.obj = 'report' then
      select id into rid from crm.saved_reports where user_id = sys and name = r.name limit 1;
      if rid is null then
        insert into crm.saved_reports (user_id, report, name, params, is_shared, market_code) values (sys, 'cerrados', r.name, jsonb_strip_nulls(r.filters), true, 'US') returning id into rid;
      end if;
    else
      select id into rid from crm.saved_views where user_id = sys and name = r.name limit 1;
      if rid is null then
        insert into crm.saved_views (user_id, object, name, filters, is_shared) values (sys, r.obj, r.name, jsonb_strip_nulls(r.filters), true) returning id into rid;
      else
        update crm.saved_views set filters = jsonb_strip_nulls(r.filters) where id = rid;
      end if;
    end if;
    insert into crm.pipedrive_rebuild (kind, pd_name, position, market_code, status, contigo_kind, contigo_id, contigo_path, note_es, note_en)
    values ('filter', r.pd, r.pos, 'US',
            case when r.obj = 'none' then 'pending' when not ok then 'off' when r.note is not null then 'pending' else 'built' end,
            case when r.obj = 'none' or rid is null then 'none' when r.obj = 'report' then 'saved_report' else 'saved_view' end, rid,
            case when rid is null then null when r.obj = 'report' then '/reportes#guardados' when r.obj = 'account' then '/comercios?cola=' || rid else '/pipelines?cola=' || rid end,
            coalesce(r.note, case when not ok and r.pipe = 'dealer' then 'Se crea cuando exista el embudo de alta de dealers de US en esta base.'
                                  when not ok then 'Se crea cuando exista el embudo de Las Vegas en esta base.'
                                  when r.obj = 'report' then 'Los negocios cerrados no viven en una lista: queda como reporte guardado y compartido "' || r.name || '".'
                                  else 'Vista guardada de fábrica "' || r.name || '".' end),
            case when r.obj = 'none' then 'CONTIGO has no separate people list: contacts live on each merchant page and are found from Search.'
                 when r.note is not null then 'The exact filter condition is not in the inventory: it stays as all US merchants. [pending: filter condition, LuisRo Sanabria]'
                 when not ok and r.pipe = 'dealer' then 'Created once the US dealer sign-up pipeline exists in this database.'
                 when not ok then 'Created once the Las Vegas pipeline exists in this database.'
                 when r.obj = 'report' then 'Closed deals do not live in a list: it is a saved, shared report.'
                 else 'Factory saved view.' end)
    on conflict (kind, pd_name) do update set status = excluded.status, contigo_kind = excluded.contigo_kind, contigo_id = excluded.contigo_id, contigo_path = excluded.contigo_path,
      note_es = excluded.note_es, note_en = excluded.note_en, updated_at = now();
  end loop;
  return n;
end $$;
revoke all on function crm.pipedrive_rebuild_apply() from public;
grant execute on function crm.pipedrive_rebuild_apply() to contigo_app;

select crm.pipedrive_rebuild_apply();
