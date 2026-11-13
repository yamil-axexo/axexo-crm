-- 0030_embudo (paquete embudo, programa "los 95"): PIPE-01, PIPE-06, PIPE-05, PIPE-04, ACT-02, ACT-01, LEAD-03, LEAD-02, LEAD-01, LEAD-05,
-- E3.F3, E3.F6, E3.F8, E3.F10. Todo es interno: nada de lo que hay aquí llama a un sistema de fuera.

-- ================================================================ PIPE-01 requisitos de etapa también en la base
-- Un requisito puede aplicar solo en ciertos mercados, tipos de cuenta o desde cierto monto (variantes por mercado como metadata):
-- { "<requisito>": { "markets": ["MX"], "account_types": ["chain"], "min_amount": 1000 } }. Sin condición aplica siempre.
alter table crm.stages add column conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object');

-- Un negocio que entró a una etapa sin lo que la etapa pide (importación o movimiento de administración) no pasa en silencio: queda anotado.
create table crm.deal_stage_gaps (
  deal_id      uuid primary key references crm.deals(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  stage_id     uuid not null references crm.stages(id),
  missing      text[] not null,
  source       text not null check (source in ('import', 'admin')),
  recorded_at  timestamptz not null default now()
);
alter table crm.deal_stage_gaps enable row level security;
alter table crm.deal_stage_gaps force row level security;
revoke all on crm.deal_stage_gaps from contigo_app;
grant select on crm.deal_stage_gaps to contigo_app;
create policy deal_stage_gaps_read on crm.deal_stage_gaps for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = deal_stage_gaps.deal_id));

-- Qué le falta a un negocio para estar en una etapa. Es la misma lectura que src/domain/deals.ts:missingForStage.
create function crm.stage_missing(p_deal crm.deals, p_stage uuid, p_builtin_only boolean) returns text[]
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  s crm.stages; tok text; cond jsonb; v_type text; out_missing text[] := '{}'; v_key text; v_val jsonb;
begin
  select * into s from crm.stages where id = p_stage;
  if not found or s.kind = 'lost' then return out_missing; end if;
  select account_type into v_type from crm.accounts where id = p_deal.account_id;
  for tok in select distinct t from unnest(s.required_fields || case when s.kind = 'open' then array['next_step'] else '{}'::text[] end) t loop
    cond := s.conditions -> tok;
    if cond is not null and jsonb_typeof(cond) = 'object' and not (s.kind = 'open' and tok = 'next_step') then
      if cond ? 'markets' and not (cond -> 'markets' ? p_deal.market_code) then continue; end if;
      if cond ? 'account_types' and not (cond -> 'account_types' ? coalesce(v_type, '')) then continue; end if;
      if cond ? 'min_amount' and coalesce(p_deal.amount_minor, 0) < ((cond ->> 'min_amount')::numeric * 100) then continue; end if;
    end if;
    if tok = 'amount' then
      if p_deal.amount_minor is null or p_deal.amount_minor <= 0 then out_missing := out_missing || tok; end if;
    elsif tok = 'next_step' then
      if p_deal.next_step is null or btrim(p_deal.next_step) = '' or p_deal.next_step_due is null then out_missing := out_missing || tok; end if;
    elsif tok = 'decision_maker' then
      if p_deal.decision_maker_id is null or not p_deal.decision_maker_met then out_missing := out_missing || tok; end if;
    elsif tok = 'items' then
      if not p_builtin_only and not exists (select 1 from crm.deal_items i where i.deal_id = p_deal.id) then out_missing := out_missing || tok; end if;
    elsif tok like 'field:%' then
      if not p_builtin_only then
        v_key := substr(tok, 7);
        v_val := p_deal.custom -> v_key;
        if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb then out_missing := out_missing || tok; end if;
      end if;
    end if;
  end loop;
  return out_missing;
end $$;
revoke all on function crm.stage_missing(crm.deals, uuid, boolean) from public;
grant execute on function crm.stage_missing(crm.deals, uuid, boolean) to contigo_app;

-- El candado: ninguna vía de escritura deja a un negocio en una etapa sin lo que esa etapa pide. Vale para toda la aplicación
-- (pantalla, API, automatizaciones, administración). Lo que el dominio ya valida llega aquí cumplido; lo que se lo salte, no pasa.
-- Excepciones, las mismas del dominio: perder (pide motivo, check de la tabla), y ganar por la primera transacción (la transacción es la prueba).
-- Al nacer se revisan los requisitos fijos (monto, próximo paso, quien decide): los campos de investigación se llenan después.
-- Una carga histórica (importación) o un movimiento forzado de administración no se rechaza: `app.stage_gate = 'record'` dentro de
-- esa transacción hace que lo que falta quede anotado en crm.deal_stage_gaps, a la vista, en vez de entrar en silencio.
create function crm.deal_stage_gate() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare v_kind text; v_missing text[];
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return null; end if;
  if app.current_user_id() is null then return null; end if;   -- migraciones y datos sintéticos
  select kind into v_kind from crm.stages where id = new.stage_id;
  if v_kind = 'lost' or (v_kind = 'won' and new.closed_by = 'transaction') then
    delete from crm.deal_stage_gaps where deal_id = new.id;
    return null;
  end if;
  v_missing := crm.stage_missing(new, new.stage_id, tg_op = 'INSERT');
  if coalesce(array_length(v_missing, 1), 0) = 0 then
    delete from crm.deal_stage_gaps where deal_id = new.id;
    return null;
  end if;
  if coalesce(current_setting('app.stage_gate', true), '') = 'record' then
    insert into crm.deal_stage_gaps (deal_id, market_code, stage_id, missing, source)
    values (new.id, new.market_code, new.stage_id, v_missing,
            case when current_setting('app.stage_gate_source', true) in ('import', 'admin') then current_setting('app.stage_gate_source', true)
                 when tg_op = 'INSERT' then 'import' else 'admin' end)
    on conflict (deal_id) do update set stage_id = excluded.stage_id, missing = excluded.missing, source = excluded.source, recorded_at = now();
    return null;
  end if;
  raise exception 'stage requirements not met: %', array_to_string(v_missing, ', ') using errcode = '23514', constraint = 'deal_stage_gate';
end $$;
create trigger deals_stage_gate after insert or update of stage_id on crm.deals
  for each row execute function crm.deal_stage_gate();

-- ================================================================ PIPE-06 cierre por evento transaccional
alter table crm.ingest_batches add column manifest jsonb;
alter table crm.deal_stage_events drop constraint deal_stage_events_cause_check;
alter table crm.deal_stage_events add constraint deal_stage_events_cause_check
  check (cause in ('user', 'transaction', 'rule', 'import', 'admin', 'correction'));

-- Los hitos del comercio, cada uno por separado: primer fondeo (con su método), primera transacción y hábito.
create table crm.account_milestones (
  account_id        uuid primary key references crm.accounts(id) on delete cascade,
  market_code       text not null references crm.markets(code),
  first_funding_at  timestamptz,
  funding_method    text check (funding_method is null or funding_method in ('cash', 'spei', 'ach', 'pix', 'other')),
  first_txn_at      timestamptz,
  habit_at          timestamptz,
  as_of             date,
  updated_at        timestamptz not null default now()
);
alter table crm.account_milestones enable row level security;
alter table crm.account_milestones force row level security;
revoke all on crm.account_milestones from contigo_app;
grant select, insert, update on crm.account_milestones to contigo_app;
create policy account_milestones_read on crm.account_milestones for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = account_milestones.account_id));
create policy account_milestones_ins on crm.account_milestones for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));
create policy account_milestones_upd on crm.account_milestones for update to contigo_app
  using (market_code = any((select app.write_markets())::text[])) with check (market_code = any((select app.write_markets())::text[]));

-- La historia de cada hito: se agrega, nunca se edita. Una corrección es otro renglón que anula o reexpresa el anterior.
create table crm.milestone_events (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  kind         text not null check (kind in ('first_funding', 'first_txn', 'habit')),
  action       text not null check (action in ('set', 'void', 'restate')),
  occurred_at  timestamptz,
  previous_at  timestamptz,
  method       text check (method is null or method in ('cash', 'spei', 'ach', 'pix', 'other')),
  reason       text check (reason is null or char_length(reason) <= 300),
  source       text not null check (source in ('s5', 'user')),
  batch_id     uuid references crm.ingest_batches(id),
  deal_id      uuid references crm.deals(id) on delete set null,
  actor_id     uuid references crm.users(id),
  created_at   timestamptz not null default now(),
  check (action = 'void' or occurred_at is not null),
  check (action = 'set' or reason is not null)
);
create index milestone_events_account_idx on crm.milestone_events (account_id, created_at);
alter table crm.milestone_events enable row level security;
alter table crm.milestone_events force row level security;
revoke all on crm.milestone_events from contigo_app;
grant select, insert on crm.milestone_events to contigo_app;
create policy milestone_events_read on crm.milestone_events for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = milestone_events.account_id));
create policy milestone_events_ins on crm.milestone_events for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));

-- Un archivo que vuelve a traer un corte ya cargado con otras cifras no sobrescribe en silencio: el antes y el después quedan aquí.
create table crm.metric_restatements (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  as_of        date not null,
  batch_id     uuid references crm.ingest_batches(id),
  before       jsonb not null,
  after        jsonb not null,
  created_at   timestamptz not null default now()
);
create index metric_restatements_account_idx on crm.metric_restatements (account_id, as_of);
alter table crm.metric_restatements enable row level security;
alter table crm.metric_restatements force row level security;
revoke all on crm.metric_restatements from contigo_app;
grant select, insert on crm.metric_restatements to contigo_app;
create policy metric_restatements_read on crm.metric_restatements for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = metric_restatements.account_id));
create policy metric_restatements_ins on crm.metric_restatements for insert to contigo_app
  with check ((select app.is_admin()));

-- Lo que ya se sabía antes de este paquete: la primera transacción de cada comercio, tomada del archivo de ventas.
insert into crm.account_milestones (account_id, market_code, first_txn_at, as_of)
select m.account_id, a.market_code, min(m.first_txn_at), max(m.as_of)
  from crm.merchant_metrics_daily m join crm.accounts a on a.id = m.account_id
 where m.first_txn_at is not null group by m.account_id, a.market_code;
insert into crm.milestone_events (account_id, market_code, kind, action, occurred_at, source)
select account_id, market_code, 'first_txn', 'set', first_txn_at, 's5' from crm.account_milestones where first_txn_at is not null;

-- ================================================================ PIPE-05 revisita a quien decide
alter table crm.contacts add column best_time text check (best_time is null or char_length(best_time) <= 120);

-- ================================================================ PIPE-04 motivos codificados, con versión
alter table crm.loss_reasons add column updated_at timestamptz not null default now();
create table crm.catalog_versions (
  catalog     text primary key,
  version     integer not null default 1,
  changed_at  timestamptz not null default now()
);
insert into crm.catalog_versions (catalog) values ('reason_codes');
alter table crm.catalog_versions enable row level security;
alter table crm.catalog_versions force row level security;
revoke all on crm.catalog_versions from contigo_app;
grant select on crm.catalog_versions to contigo_app;
create policy catalog_versions_read on crm.catalog_versions for select to contigo_app using ((select app.current_user_id()) is not null);
-- Cada cambio al catálogo de motivos sube la versión: quien lo consume (la Sales App) sabe si tiene la lista vigente.
create function crm.reason_catalog_bump() returns trigger
language plpgsql security definer set search_path = crm, pg_catalog as $$
begin
  update crm.catalog_versions set version = version + 1, changed_at = now() where catalog = 'reason_codes';
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger loss_reasons_version before insert or update on crm.loss_reasons
  for each row execute function crm.reason_catalog_bump();

-- Un código de motivo que llega de otro sistema y CONTIGO no conoce deja de perderse: queda contado y a la vista.
create table crm.unknown_reason_codes (
  source      text not null,
  code        text not null check (char_length(code) <= 80),
  market_code text references crm.markets(code),
  hits        integer not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (source, code)
);
alter table crm.unknown_reason_codes enable row level security;
alter table crm.unknown_reason_codes force row level security;
revoke all on crm.unknown_reason_codes from contigo_app;
grant select, insert, update on crm.unknown_reason_codes to contigo_app;
create policy unknown_reason_codes_read on crm.unknown_reason_codes for select to contigo_app using ((select app.current_user_id()) is not null);
create policy unknown_reason_codes_ins on crm.unknown_reason_codes for insert to contigo_app with check ((select app.is_admin()));
create policy unknown_reason_codes_upd on crm.unknown_reason_codes for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- El motivo es obligatorio también en la base: una visita sin venta y un lead descartado llevan su código.
-- (not valid: vale para todo lo que se escriba desde hoy; lo histórico importado no se toca.)
alter table crm.activities add constraint activities_no_sale_reason
  check (not (kind = 'visit' and outcome = 'no_sale') or no_sale_code is not null) not valid;
alter table crm.leads add constraint leads_disqualify_reason
  check (status <> 'disqualified' or disqualify_code is not null) not valid;

-- ================================================================ ACT-01 referencias a tickets de soporte en el hilo
create table crm.ticket_refs (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  account_id    uuid not null references crm.accounts(id) on delete cascade,
  system        text not null default 'zendesk' check (system in ('zendesk', 'zoho', 'other')),
  external_ref  text not null check (external_ref ~ '^[A-Za-z0-9#_-]{1,40}$'),
  subject       text not null check (char_length(btrim(subject)) between 2 and 200),
  status        text not null default 'unknown' check (status in ('open', 'pending', 'solved', 'unknown')),
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now(),
  unique (account_id, system, external_ref)
);
create index ticket_refs_account_idx on crm.ticket_refs (account_id, created_at desc);
alter table crm.ticket_refs enable row level security;
alter table crm.ticket_refs force row level security;
revoke all on crm.ticket_refs from contigo_app;
grant select, insert, update on crm.ticket_refs to contigo_app;
create policy ticket_refs_read on crm.ticket_refs for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = ticket_refs.account_id));
create policy ticket_refs_ins on crm.ticket_refs for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.accounts a where a.id = ticket_refs.account_id and a.market_code = ticket_refs.market_code));
create policy ticket_refs_upd on crm.ticket_refs for update to contigo_app
  using (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = ticket_refs.account_id))
  with check (market_code = any((select app.write_markets())::text[]));

-- ================================================================ LEAD-02 / E3.F6 atribución completa
alter table crm.leads
  add column ttclid        text check (ttclid is null or length(ttclid) <= 200),
  add column li_fat_id     text check (li_fat_id is null or length(li_fat_id) <= 200),
  add column twclid        text check (twclid is null or length(twclid) <= 200),
  -- Click to WhatsApp (anuncio de Meta que abre una conversación): el identificador llega con el primer mensaje.
  add column ctwa_clid     text check (ctwa_clid is null or length(ctwa_clid) <= 200),
  add column landing_page  text check (landing_page is null or length(landing_page) <= 500),
  add column referrer      text check (referrer is null or length(referrer) <= 500),
  -- LEAD-05: el comercio que lo refirió.
  add column referred_by_account_id uuid references crm.accounts(id),
  -- E3.F3: etiquetas del lead, filtrables.
  add column labels        text[] not null default '{}',
  add constraint leads_labels_check check (coalesce(array_length(labels, 1), 0) <= 12);
create index leads_labels_gin on crm.leads using gin (labels);
create index leads_referred_idx on crm.leads (referred_by_account_id) where referred_by_account_id is not null;
create index leads_account_idx on crm.leads (account_id) where account_id is not null;

-- Catálogo de etiquetas de lead (las ocho de Pipedrive entran aquí cuando se importen; administración agrega las suyas).
create table crm.lead_labels (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label_es    text not null check (char_length(btrim(label_es)) between 2 and 40),
  label_en    text not null check (char_length(btrim(label_en)) between 2 and 40),
  is_active   boolean not null default true,
  position    integer not null default 0
);
alter table crm.lead_labels enable row level security;
alter table crm.lead_labels force row level security;
revoke all on crm.lead_labels from contigo_app;
grant select, insert, update on crm.lead_labels to contigo_app;
create policy lead_labels_read on crm.lead_labels for select to contigo_app using ((select app.current_user_id()) is not null);
create policy lead_labels_ins on crm.lead_labels for insert to contigo_app with check ((select app.is_admin()));
create policy lead_labels_upd on crm.lead_labels for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
insert into crm.lead_labels (code, label_es, label_en, position) values
  ('prioridad', 'Prioridad', 'Priority', 1),
  ('volver_a_llamar', 'Volver a llamar', 'Call back', 2),
  ('pidio_informacion', 'Pidió información', 'Asked for information', 3),
  ('referido', 'Referido', 'Referred', 4);

-- Cada toque de origen se agrega y no se edita: el primero nunca se pisa con el último. Al convertir, los toques del lead
-- se copian al comercio y al negocio para que la atribución se pueda filtrar y reportar ahí también.
create table crm.source_touches (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  lead_id       uuid references crm.leads(id) on delete cascade,
  account_id    uuid references crm.accounts(id) on delete cascade,
  deal_id       uuid references crm.deals(id) on delete cascade,
  touch         text not null check (touch in ('first', 'last')),
  touched_at    timestamptz not null default now(),
  source        text,
  utm_source    text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  gclid         text, fbclid text, ttclid text, li_fat_id text, twclid text, ctwa_clid text,
  landing_page  text, referrer text,
  referral_account_id uuid references crm.accounts(id),
  -- De qué plataforma de anuncios vino el clic, calculado: es lo que se filtra y se reporta.
  platform      text generated always as (case when gclid is not null then 'google' when fbclid is not null or ctwa_clid is not null then 'meta' when ttclid is not null then 'tiktok'
                                                when li_fat_id is not null then 'linkedin' when twclid is not null then 'x' end) stored,
  created_at    timestamptz not null default now(),
  check (lead_id is not null or account_id is not null or deal_id is not null)
);
create index source_touches_lead_idx on crm.source_touches (lead_id) where lead_id is not null;
create index source_touches_deal_idx on crm.source_touches (deal_id) where deal_id is not null;
create index source_touches_account_idx on crm.source_touches (account_id) where account_id is not null;
create index source_touches_campaign_idx on crm.source_touches (market_code, utm_source, utm_campaign);
alter table crm.source_touches enable row level security;
alter table crm.source_touches force row level security;
revoke all on crm.source_touches from contigo_app;
grant select, insert on crm.source_touches to contigo_app;
create policy source_touches_read on crm.source_touches for select to contigo_app
  using ((lead_id is not null and exists (select 1 from crm.leads l where l.id = source_touches.lead_id))
      or (deal_id is not null and exists (select 1 from crm.deals d where d.id = source_touches.deal_id))
      or (account_id is not null and exists (select 1 from crm.accounts a where a.id = source_touches.account_id)));
create policy source_touches_ins on crm.source_touches for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));
-- Lo que ya existía: el primer toque de cada lead que trae origen técnico.
insert into crm.source_touches (market_code, lead_id, touch, touched_at, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid)
select market_code, id, 'first', created_at, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid
  from crm.leads where coalesce(utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid) is not null;

-- Conversiones para las plataformas de anuncios: la cola existe y se llena; el envío está apagado (adaptador ad-conversions).
create table crm.conversion_events (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  platform      text not null check (platform in ('google', 'meta', 'tiktok', 'linkedin', 'x')),
  event_name    text not null check (event_name in ('qualified_lead', 'purchase')),
  lead_id       uuid references crm.leads(id) on delete cascade,
  deal_id       uuid references crm.deals(id) on delete cascade,
  account_id    uuid references crm.accounts(id) on delete cascade,
  click_id      text not null check (length(click_id) <= 200),
  dedupe_key    text not null unique,
  status        text not null default 'queued' check (status in ('queued', 'channel_off', 'simulated', 'sent', 'failed')),
  attempts      integer not null default 0,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index conversion_events_status_idx on crm.conversion_events (status, created_at);
alter table crm.conversion_events enable row level security;
alter table crm.conversion_events force row level security;
revoke all on crm.conversion_events from contigo_app;
grant select, insert, update on crm.conversion_events to contigo_app;
create policy conversion_events_read on crm.conversion_events for select to contigo_app
  using (market_code = any((select app.write_markets())::text[]) or market_code = any((select app.full_markets())::text[]));
create policy conversion_events_ins on crm.conversion_events for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));
create policy conversion_events_upd on crm.conversion_events for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ================================================================ LEAD-03 ruteo y asignación
-- Reglas ordenadas: la primera que coincide y encuentra a alguien disponible decide. El turno rotativo es una acción más.
create table crm.assignment_rules (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  position         integer not null,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  is_active        boolean not null default true,
  -- Condición: { "sources": [], "motors": [], "form_ids": [], "territory_ids": [], "size_min": n, "size_max": n }. Vacío coincide con todo.
  match            jsonb not null default '{}'::jsonb check (jsonb_typeof(match) = 'object'),
  action           text not null check (action in ('inherit_account', 'user', 'rotation', 'territory')),
  user_id          uuid references crm.users(id),
  routing_rule_id  uuid references crm.routing_rules(id),
  -- Tope por persona: con este número de leads abiertos o más, la regla no le entrega otro y pasa a la siguiente persona o regla.
  cap_open         integer check (cap_open is null or (cap_open >= 1 and cap_open <= 500)),
  sla_minutes      integer check (sla_minutes is null or (sla_minutes >= 5 and sla_minutes <= 10080)),
  created_by       uuid references crm.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (action <> 'user' or user_id is not null),
  check (action <> 'rotation' or routing_rule_id is not null)
);
create index assignment_rules_market_idx on crm.assignment_rules (market_code, position);
alter table crm.assignment_rules enable row level security;
alter table crm.assignment_rules force row level security;
revoke all on crm.assignment_rules from contigo_app;
grant select, insert, update on crm.assignment_rules to contigo_app;
create policy assignment_rules_read on crm.assignment_rules for select to contigo_app using ((select app.current_user_id()) is not null);
create policy assignment_rules_ins on crm.assignment_rules for insert to contigo_app with check ((select app.is_admin()));
create policy assignment_rules_upd on crm.assignment_rules for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- Bitácora de cada asignación: qué regla decidió, a quién le tocó y a quién se saltó y por qué.
create table crm.assignment_log (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  lead_id      uuid references crm.leads(id) on delete cascade,
  rule_id      uuid references crm.assignment_rules(id) on delete set null,
  rule_name    text,
  action       text not null,
  owner_id     uuid references crm.users(id),
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index assignment_log_market_idx on crm.assignment_log (market_code, created_at desc);
create index assignment_log_lead_idx on crm.assignment_log (lead_id);
alter table crm.assignment_log enable row level security;
alter table crm.assignment_log force row level security;
revoke all on crm.assignment_log from contigo_app;
grant select, insert on crm.assignment_log to contigo_app;
create policy assignment_log_read on crm.assignment_log for select to contigo_app
  using (market_code = any((select app.full_markets())::text[]) or market_code = any((select app.team_markets())::text[]) or (select app.is_admin()));
create policy assignment_log_ins on crm.assignment_log for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[]));

-- Leads abiertos por persona en un mercado: el número contra el que se mide el tope.
create function app.open_leads_of(p_user uuid, p_market text) returns integer
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select count(*)::int from crm.leads where owner_id = p_user and market_code = p_market and status in ('new', 'contacted', 'qualified')
$$;
revoke all on function app.open_leads_of(uuid, text) from public;
grant execute on function app.open_leads_of(uuid, text) to contigo_app;

-- El turno de siempre (app.rr_next) con dos cosas más: respeta el tope por persona y se puede consultar sin gastar el turno
-- (p_advance = false: es lo que usa el simulador "a quién le caería").
create function app.rr_pick(p_rule uuid, p_cap integer, p_advance boolean) returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r crm.routing_rules; n int; i int; pick uuid;
begin
  if p_advance then
    select * into r from crm.routing_rules where id = p_rule and is_active for update;
  else
    select * into r from crm.routing_rules where id = p_rule and is_active;
  end if;
  if not found then return null; end if;
  if not (r.market_code = any(app.my_markets())) then
    raise exception 'routing rule out of scope' using errcode = '42501';
  end if;
  n := coalesce(array_length(r.member_ids, 1), 0);
  if r.strategy <> 'fixed' then
    for i in 0 .. n - 1 loop
      pick := r.member_ids[((r.cursor + i) % n) + 1];
      if app.can_sell_in(pick, r.market_code) and (p_cap is null or app.open_leads_of(pick, r.market_code) < p_cap) then
        if p_advance then update crm.routing_rules set cursor = (r.cursor + i + 1) % n where id = r.id; end if;
        return pick;
      end if;
    end loop;
  end if;
  if r.fallback_id is not null and app.can_sell_in(r.fallback_id, r.market_code)
     and (p_cap is null or app.open_leads_of(r.fallback_id, r.market_code) < p_cap) then
    return r.fallback_id;
  end if;
  return null;
end $$;
revoke all on function app.rr_pick(uuid, integer, boolean) from public;
grant execute on function app.rr_pick(uuid, integer, boolean) to contigo_app;

-- E3.F10: quien lidera el mercado es la última red para que ningún lead entre sin dueño.
create function app.market_lead_of(p_market text) returns uuid
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select m.user_id from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
   where m.market_code = p_market and m.role = 'market_lead' and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
     and app.can_sell_in(m.user_id, p_market)
   order by m.valid_from, m.user_id limit 1
$$;
revoke all on function app.market_lead_of(text) from public;
grant execute on function app.market_lead_of(text) to contigo_app;

-- ================================================================ LEAD-05 referidos de comercio a comercio
create table crm.referral_codes (
  id           uuid primary key default app.uuid_v7(),
  account_id   uuid not null unique references crm.accounts(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  code         text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  form_id      uuid not null references crm.web_forms(id),
  is_active    boolean not null default true,
  created_by   uuid references crm.users(id),
  created_at   timestamptz not null default now()
);
alter table crm.referral_codes enable row level security;
alter table crm.referral_codes force row level security;
revoke all on crm.referral_codes from contigo_app;
grant select, insert, update on crm.referral_codes to contigo_app;
create policy referral_codes_read on crm.referral_codes for select to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = referral_codes.account_id));
create policy referral_codes_ins on crm.referral_codes for insert to contigo_app
  with check (market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.accounts a where a.id = referral_codes.account_id and a.market_code = referral_codes.market_code));
create policy referral_codes_upd on crm.referral_codes for update to contigo_app
  using (market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = referral_codes.account_id))
  with check (market_code = any((select app.write_markets())::text[]));

-- La página pública del enlace de referido no tiene sesión: solo puede preguntar a qué formulario lleva un código vigente.
create function app.referral_public(p_code text) returns table (slug text, account_id uuid, market_code text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select f.slug, r.account_id, r.market_code from crm.referral_codes r
    join crm.web_forms f on f.id = r.form_id and f.is_active
    join crm.accounts a on a.id = r.account_id and a.archived_at is null
   where r.code = upper(p_code) and r.is_active
$$;
revoke all on function app.referral_public(text) from public;
grant execute on function app.referral_public(text) to contigo_app;

-- ================================================================ E3.F8 ningún envío de formulario se pierde
-- Un envío que no se pudo guardar (falla al escribir) queda retenido y se reintenta solo; si se agota, queda a la vista.
create table crm.intake_retries (
  id               uuid primary key default app.uuid_v7(),
  slug             text not null check (char_length(slug) <= 80),
  idempotency_key  text not null unique check (char_length(idempotency_key) <= 200),
  payload          jsonb not null,
  error            text check (error is null or char_length(error) <= 300),
  attempts         integer not null default 0,
  status           text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  lead_id          uuid references crm.leads(id) on delete set null,
  next_attempt_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index intake_retries_pending_idx on crm.intake_retries (next_attempt_at) where status = 'pending';
alter table crm.intake_retries enable row level security;
alter table crm.intake_retries force row level security;
revoke all on crm.intake_retries from contigo_app;
grant select, insert, update on crm.intake_retries to contigo_app;
create policy intake_retries_read on crm.intake_retries for select to contigo_app using ((select app.is_admin()));
create policy intake_retries_ins on crm.intake_retries for insert to contigo_app with check ((select app.is_admin()));
create policy intake_retries_upd on crm.intake_retries for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
