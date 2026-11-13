-- Paquete campo2 (programa "los 95", ola 6, residuos). Cierra lo que la re-auditoría dejó abierto en campo y canal:
-- avisos sin dueño que caen a quien supervisa (CAMPO-04), visitas con confianza baja fuera de los indicadores (CAMPO-05),
-- competencia que alimenta avisos y ruteo (CAMPO-07), punto de venta perfecto en la salud (CAMPO-08), expediente desde la
-- Sales App y por enlace (CAMPO-06), instalación y retiro de equipo ligados a incidentes (SEG-06), registros de canal del
-- propio aliado (CANAL-02), estados de comisión estimado contra publicado (CANAL-05), avance de capacitación de aliados
-- (CANAL-06), política de reversos versionada (CANAL-08) y envío del resumen de comentarios a P&T (CS-08).
-- Los valores que no decidimos aquí quedan como dato con "pendiente: <dueño>" (field_thresholds.pending_owner).

-- ------------------------------------------------------------ 0) umbrales propuestos: dato, con dueño pendiente
alter table crm.field_thresholds add column pending_owner text check (pending_owner is null or char_length(pending_owner) between 2 and 80);
comment on column crm.field_thresholds.pending_owner is 'Valor propuesto: quién tiene que confirmarlo. Al fijarlo alguien con motivo, la fila nueva va sin dueño pendiente.';
insert into crm.field_thresholds (market_code, key, value, version, reason, pending_owner)
select m.code, k.key, k.value, 1, 'Valor propuesto por CONTIGO, sin acuerdo todavía', k.owner
  from crm.markets m
  cross join (values ('trust_min_score', 50, 'Ventas'), ('competitor_alert_visits', 2, 'Ventas'), ('competitor_window_days', 60, 'Ventas'),
                     ('indirect_route_visits', 3, 'Ventas y canales'), ('perfect_store_health_days', 60, 'Customer Success'),
                     ('threshold_review_days', 90, 'Ventas')) k(key, value, owner)
 where not exists (select 1 from crm.field_thresholds f where f.market_code = m.code and f.key = k.key and f.valid_to is null);

-- ------------------------------------------------------------ 1) CAMPO-04 ningún aviso sin dueño
-- Si la regla no sabe de quién es (comercio sin responsable, por ejemplo), el aviso cae a quien es dueño del territorio del
-- comercio; si no hay, a quien supervisa el mercado; si no, a quien lo lidera. Queda anotado a quién y por qué.
create or replace function app.exception_fallback_owner(p_market text, p_account uuid, out user_id uuid, out via text)
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
begin
  if p_account is not null then
    select o.user_id, 'territory_owner' into user_id, via
      from crm.accounts a join crm.territory_owners o on o.territory_id = a.territory_id and o.valid_to is null
      join crm.users u on u.id = o.user_id and u.is_active
     where a.id = p_account limit 1;
    if user_id is not null then return; end if;
  end if;
  select m.user_id, m.role into user_id, via
    from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
   where m.market_code = p_market and m.role in ('supervisor', 'market_lead') and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
   order by case m.role when 'supervisor' then 0 else 1 end, m.created_at, m.id limit 1;
end $$;
revoke execute on function app.exception_fallback_owner(text, uuid) from public;

create or replace function crm.exception_route_owner() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r record; v_account uuid;
begin
  if new.owner_id is not null then return new; end if;
  v_account := coalesce(new.account_id, (select d.account_id from crm.deals d where d.id = new.deal_id));
  select * into r from app.exception_fallback_owner(new.market_code, v_account);
  if r.user_id is not null then
    new.owner_id := r.user_id;
    new.detail := coalesce(new.detail, '{}'::jsonb) || jsonb_build_object('routed_to', r.via);
  end if;
  return new;
end $$;
create trigger exceptions_route_owner before insert on crm.exceptions for each row execute function crm.exception_route_owner();

-- Los abiertos que ya estaban sin dueño se reparten igual.
update crm.exceptions e set owner_id = f.user_id, detail = e.detail || jsonb_build_object('routed_to', f.via)
  from (select x.id, (app.exception_fallback_owner(x.market_code, coalesce(x.account_id, (select d.account_id from crm.deals d where d.id = x.deal_id)))).*
          from crm.exceptions x where x.owner_id is null and x.resolved_at is null) f
 where f.id = e.id and f.user_id is not null;

-- CAMPO-07: avisos de la competencia en el punto de venta.
alter table crm.exceptions drop constraint if exists exceptions_kind_check;
alter table crm.exceptions add constraint exceptions_kind_check check (kind in ('lead_sla','no_next_step','stalled_deal','revisit_due','activation_risk',
  'reactivation','unowned_account','duplicate_suspect','unmatched_event','under_plan','perfect_store_low','competitor_share_loss','indirect_route'));

-- ------------------------------------------------------------ 2) CAMPO-08 el punto de venta perfecto entra a la salud
alter table crm.health_config drop constraint if exists health_config_grp_check;
alter table crm.health_config add constraint health_config_grp_check check (grp in ('transactions','mix','tickets','balance','perfect_store'));
insert into crm.health_config (grp, weight) select 'perfect_store', 10 where not exists (select 1 from crm.health_config where market_code is null and grp = 'perfect_store');

create or replace function app.health_snapshot_run(p_market text default null) returns int
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
           w.risk_below, w.habit_at, ps.score as ps_score, ps.ps_day
      from crm.accounts a
      join crm.markets mk on mk.code = a.market_code
      join crm.cs_settings st on st.market_code = a.market_code
      left join crm.account_care c on c.account_id = a.id
      cross join lateral app.lifecycle_window(a.market_code, c.product_line) w
      join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
      left join lateral (select x.* from crm.care_signals x where x.account_id = a.id order by x.as_of desc limit 1) s on true
      -- CAMPO-08: el último puntaje de punto de venta perfecto que trajo la Sales App, mientras siga vigente.
      left join lateral (select x.score, (x.observed_at at time zone mk.timezone)::date as ps_day from crm.perfect_store_scores x
                          where x.account_id = a.id order by x.observed_at desc limit 1) ps
             on ps.ps_day >= (now() at time zone mk.timezone)::date - coalesce((select f.value::int from crm.field_thresholds f
                     where f.market_code = a.market_code and f.key = 'perfect_store_health_days' and f.valid_to is null), 60)
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
           case when b.balance_minor is null or b.low_balance_minor is null then null else least(1, b.balance_minor::numeric / greatest(1, b.low_balance_minor * 2)) end as v_balance,
           case when b.ps_score is null then null else b.ps_score / 100.0 end as v_ps
      from base b
  ), parts as (
    select g.id, g.market_code, g.today, g.service_tier, cfg.grp, cfg.weight,
           case cfg.grp when 'transactions' then g.v_txn * g.m_fresh when 'mix' then g.v_mix * g.s_fresh when 'tickets' then g.v_tickets * g.s_fresh when 'perfect_store' then g.v_ps else g.v_balance * g.s_fresh end as v,
           case cfg.grp when 'transactions' then case when g.baseline is not null and g.baseline > 0 then 'vs_baseline' else 'vs_habit' end else 'signal' end as basis,
           case cfg.grp when 'transactions' then g.m_as_of when 'perfect_store' then g.ps_day else g.s_as_of end as data_as_of,
           case cfg.grp when 'transactions' then g.txn::numeric when 'mix' then g.product_count_30d::numeric when 'tickets' then g.open_tickets::numeric when 'perfect_store' then g.ps_score::numeric else g.balance_minor::numeric end as raw,
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
-- ------------------------------------------------------------ 3) CAMPO-06 expediente desde la Sales App, por enlace y con datos reservados
-- Enlace de captura: lo genera quien captura; quien lo abre (el comercio o quien lo visita) solo puede dejar enlaces https
-- de los documentos de ESE expediente mientras el enlace viva. Se guarda la huella del código, nunca el código.
create table crm.onboarding_links (
  id           uuid primary key default app.uuid_v7(),
  file_id      uuid not null references crm.onboarding_files(id),
  account_id   uuid not null references crm.accounts(id),
  market_code  text not null references crm.markets(code),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  created_by   uuid not null references crm.users(id),
  created_at   timestamptz not null default now(),
  used_at      timestamptz,
  revoked_at   timestamptz
);
create index onboarding_links_file_idx on crm.onboarding_links (file_id);
insert into crm.field_thresholds (market_code, key, value, version, reason, pending_owner)
select m.code, 'onboarding_link_days', 7, 1, 'Valor propuesto por CONTIGO, sin acuerdo todavía', 'Mesa de control' from crm.markets m
 where not exists (select 1 from crm.field_thresholds f where f.market_code = m.code and f.key = 'onboarding_link_days' and f.valid_to is null);
-- Tax ID del comercio: dato reservado (tapado, cada revelado queda en la bitácora). Los datos de crédito viven en la solicitud de límite.
insert into crm.sensitive_fields (key, label_es, label_en, view_roles, edit_roles, owner_can_view, owner_can_edit)
values ('tax_id', 'Identificador fiscal del comercio', 'Merchant tax ID', '{admin,market_lead,ops}', '{admin,market_lead,ops}', false, true)
on conflict (key) do nothing;

-- ------------------------------------------------------------ 4) SEG-06 instalación y retiro de equipo, ligados al incidente
create table crm.equipment_events (
  id               uuid primary key default app.uuid_v7(),
  market_code      text not null references crm.markets(code),
  account_id       uuid not null references crm.accounts(id),
  kind             text not null check (kind in ('installed','retired')),
  equipment_type   text not null check (equipment_type ~ '^[a-z0-9_]{2,30}$'),
  equipment_ref    text check (equipment_ref is null or char_length(equipment_ref) between 1 and 60),
  reason           text check (reason is null or char_length(reason) <= 200),
  occurred_at      timestamptz not null,
  visit_ref        text check (visit_ref is null or char_length(visit_ref) <= 80),
  salesperson_ref  text check (salesperson_ref is null or char_length(salesperson_ref) <= 80),
  user_id          uuid references crm.users(id),
  trust_score      smallint check (trust_score is null or trust_score between 0 and 100),
  inbound_event_id uuid references crm.inbound_events(id),
  received_at      timestamptz not null default now()
);
create index equipment_events_account_idx on crm.equipment_events (account_id, occurred_at desc);
alter table crm.field_incidents
  add column visit_id           uuid references crm.visits(id),
  add column equipment_event_id uuid references crm.equipment_events(id),
  add column trust_score        smallint check (trust_score is null or trust_score between 0 and 100),
  add column attribution        jsonb not null default '{}'::jsonb;
comment on column crm.field_incidents.attribution is 'SEG-06: a quién estaba atribuido el comercio (origen, canal, quien lo lleva) el día del incidente.';

-- ------------------------------------------------------------ 5) CANAL-02 el aliado registra y ve sus registros
alter table crm.channel_claims add column registered_via text not null default 'market_lead' check (registered_via in ('market_lead','partner'));
-- El aliado ve los registros de su nodo (nunca los de otro canal ni la venta directa) y registra a nombre de su nodo.
create policy channel_claims_partner_read on crm.channel_claims for select to contigo_app
  using (node_ref = any((select app.partner_root_ids())::text[]));
create policy channel_claims_partner_ins on crm.channel_claims for insert to contigo_app
  with check (node_ref = any((select app.partner_root_ids())::text[]) and registered_by = (select app.current_user_id()) and registered_via = 'partner');
-- Respuesta mínima para el aliado: si la tienda ya es cliente o ya tiene registro vigente de otro canal, sin decir de quién.
create or replace function app.claim_check(m text, k text, store text, node text)
returns table (customer boolean, held_by_other boolean, until timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from crm.accounts a where a.market_code = m and a.name_norm = app.norm(store) and a.lifecycle in ('active','at_risk','onboarding') and a.archived_at is null),
         exists (select 1 from crm.channel_claims c where c.market_code = m and c.store_key = k and c.status = 'active' and c.node_ref <> node),
         (select c.expires_at from crm.channel_claims c where c.market_code = m and c.store_key = k and c.status = 'active' and c.node_ref <> node)
   where app.cc_manages(m) or node = any(app.partner_root_ids()::text[])
$$;
revoke execute on function app.claim_check(text, text, text, text) from public;
grant execute on function app.claim_check(text, text, text, text) to contigo_app;

-- ------------------------------------------------------------ 6) CANAL-05 estado de comisión: estimado o publicado, sin montos en vivo
create table crm.commission_statements (
  id            uuid primary key default app.uuid_v7(),
  market_code   text not null references crm.markets(code),
  party_kind    text not null check (party_kind in ('user','partner')),
  party_ref     text not null check (char_length(party_ref) between 1 and 80),
  party_label   text not null check (char_length(party_label) between 2 and 120),
  month         date not null check (extract(day from month) = 1),
  status        text not null default 'estimate' check (status in ('estimate','published')),
  counts        jsonb not null default '{}'::jsonb,
  rules_ref     text check (rules_ref is null or char_length(rules_ref) between 3 and 200),
  published_by  uuid references crm.users(id),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Publicar exige reglas escritas y quién publica.
  check ((status = 'published') = (rules_ref is not null and published_by is not null and published_at is not null)),
  unique (market_code, party_kind, party_ref, month)
);
alter table crm.commission_statements enable row level security;
alter table crm.commission_statements force row level security;
create policy commission_statements_read on crm.commission_statements for select to contigo_app
  using ((select app.cc_manages(market_code))
         or (party_kind = 'user' and party_ref = (select app.current_user_id())::text)
         or (party_kind = 'partner' and party_ref = any((select app.partner_root_ids())::text[])));
create policy commission_statements_ins on crm.commission_statements for insert to contigo_app with check ((select app.cc_manages(market_code)));
create policy commission_statements_upd on crm.commission_statements for update to contigo_app
  using ((select app.cc_manages(market_code)) and status = 'estimate') with check ((select app.cc_manages(market_code)));

-- ------------------------------------------------------------ 7) CANAL-06 avance de capacitación de los aliados
create table crm.enablement_progress (
  id                 uuid primary key default app.uuid_v7(),
  market_code        text not null references crm.markets(code),
  partner_account_id uuid not null references crm.accounts(id),
  material_id        uuid not null references crm.partner_enablement(id),
  learner_ref        text not null check (char_length(learner_ref) between 2 and 80),
  progress_pct       int not null check (progress_pct between 0 and 100),
  completed_on       date,
  source             text not null check (source in ('kore_academy','manual')),
  external_id        text unique check (external_id is null or char_length(external_id) between 4 and 80),
  recorded_by        uuid references crm.users(id),
  received_at        timestamptz not null default now(),
  check ((progress_pct = 100) = (completed_on is not null))
);
create index enablement_progress_partner_idx on crm.enablement_progress (partner_account_id, material_id);
alter table crm.enablement_progress enable row level security;
alter table crm.enablement_progress force row level security;
create policy enablement_progress_read on crm.enablement_progress for select to contigo_app
  using ((select app.cc_manages(market_code)) or partner_account_id = any((select app.partner_root_ids())::uuid[]));
create policy enablement_progress_ins on crm.enablement_progress for insert to contigo_app with check ((select app.cc_manages(market_code)));

-- ------------------------------------------------------------ 8) CANAL-08 política de reversos y árbitro, escrita y versionada
create table crm.channel_policies (
  id                  uuid primary key default app.uuid_v7(),
  market_code         text not null references crm.markets(code),
  version             int not null check (version >= 1),
  clawback_days       int not null check (clawback_days between 0 and 365),
  policy_es           text not null check (char_length(policy_es) between 20 and 2000),
  policy_en           text not null check (char_length(policy_en) between 20 and 2000),
  arbiter_id          uuid references crm.users(id),
  status              text not null default 'proposed' check (status in ('proposed','approved')),
  pending_owner       text check (pending_owner is null or char_length(pending_owner) between 2 and 80),
  approved_finance_by text check (approved_finance_by is null or char_length(approved_finance_by) between 2 and 120),
  approved_sales_by   text check (approved_sales_by is null or char_length(approved_sales_by) between 2 and 120),
  reason              text check (reason is null or char_length(reason) between 3 and 300),
  set_by              uuid references crm.users(id),
  valid_from          timestamptz not null default now(),
  valid_to            timestamptz,
  check ((status = 'approved') = (approved_finance_by is not null and approved_sales_by is not null)),
  unique (market_code, version)
);
create unique index channel_policies_live_uq on crm.channel_policies (market_code) where valid_to is null;
alter table crm.channel_policies enable row level security;
alter table crm.channel_policies force row level security;
create policy channel_policies_read on crm.channel_policies for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]) or market_code = any(array(select a.market_code from crm.accounts a where a.id = any((select app.partner_root_ids())::uuid[]))));
create policy channel_policies_ins on crm.channel_policies for insert to contigo_app with check ((select app.cc_manages(market_code)));
create policy channel_policies_upd on crm.channel_policies for update to contigo_app using ((select app.cc_manages(market_code))) with check ((select app.cc_manages(market_code)));
insert into crm.channel_policies (market_code, version, clawback_days, policy_es, policy_en, status, pending_owner, reason)
select m.code, 1, 90,
  'Propuesta: si dentro de los 90 días siguientes a la atribución se aprueba una disputa, un ajuste o un reverso, la atribución se corrige con una fila nueva y lo que se haya reconocido por ella se revisa. Nada se borra. Arbitra quien lidera el mercado, distinto de quien levantó la disputa.',
  'Proposal: if a dispute, adjustment or reversal is approved within 90 days of the attribution, the attribution is corrected with a new row and whatever was recognized for it is reviewed. Nothing is deleted. The market lead arbitrates, someone other than whoever raised the dispute.',
  'proposed', 'Finanzas y Ventas', 'Valor propuesto por CONTIGO, sin acuerdo todavía'
  from crm.markets m where not exists (select 1 from crm.channel_policies p where p.market_code = m.code);

-- ------------------------------------------------------------ 9) CS-08 el resumen de comentarios sale hacia P&T
alter table crm.feedback_digests
  add column delivery_status text check (delivery_status is null or delivery_status in ('queued_off','simulated')),
  add column delivered_at    timestamptz;

-- ------------------------------------------------------------ RLS de lo que cuelga del comercio
do $$
declare t text;
begin
  foreach t in array array['onboarding_links','equipment_events'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
    execute format($f$create policy %I on crm.%I for select to contigo_app using (exists (select 1 from crm.accounts a where a.id = %I.account_id))$f$, t || '_read', t, t);
    execute format($f$create policy %I on crm.%I for insert to contigo_app with check (
      market_code = any((select app.write_markets())::text[]) and exists (select 1 from crm.accounts a where a.id = %I.account_id and a.market_code = %I.market_code))$f$, t || '_ins', t, t, t);
  end loop;
end $$;
create policy onboarding_links_upd on crm.onboarding_links for update to contigo_app
  using (exists (select 1 from crm.accounts a where a.id = onboarding_links.account_id)) with check (market_code = any((select app.write_markets())::text[]));

grant select, insert on crm.onboarding_links, crm.equipment_events, crm.commission_statements, crm.enablement_progress, crm.channel_policies to contigo_app;
grant update (used_at, revoked_at) on crm.onboarding_links to contigo_app;
grant update (status, counts, rules_ref, published_by, published_at, updated_at) on crm.commission_statements to contigo_app;
grant update (valid_to) on crm.channel_policies to contigo_app;
grant update (delivery_status, delivered_at) on crm.feedback_digests to contigo_app;
