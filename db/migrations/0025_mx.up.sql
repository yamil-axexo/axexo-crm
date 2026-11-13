-- 0025_mx: México (épicas E14 a E18 del documento de requerimientos), paquete mx del 12-nov-2026.
--
-- 1) Formularios de campaña: embudo de campaña (F1, F2), identificador de canal y marca "es de campaña"; el lead los hereda y
--    su origen es "Campaña web" (E15.F1, E15.F2). El formulario puede ofrecer tipos de empresa (E15.F3).
-- 2) Número de tiendas como dato que se filtra y se reporta (E15.F5): app.store_count.
-- 3) Meta de respuesta en días hábiles (E15.F9): routing_rules.sla_business_days; sla_minutes se calcula con el horario del mercado.
-- 4) Gerente de territorio y dueño automático de las tiendas D2D (E16.F2).
-- 5) Regla única para ganar: "contrato firmado o primera transacción" (E14.F8): pipelines.txn_also_wins y fechas de NDA y contrato.
-- 6) Etapas de los embudos de México como las describe el documento (E14.F2, E14.F5): crm.apply_mx_stage_template().
-- 7) Carga desde hojas mientras se retiran: visitas (E17.F4) y tiendas migradas (E14.F3).
-- 8) Arranque del mercado: primero quienes lideran, y los pasos del método de capacitación (E18.F2, E18.F5, E18.F6).

-- ---------------------------------------------------------------- 1) formularios de campaña
alter table crm.web_forms
  add column funnel       text check (funnel is null or funnel ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$'),
  add column channel_id   text check (channel_id is null or channel_id ~ '^[a-z0-9][a-z0-9_.-]{1,59}$'),
  add column is_campaign  boolean not null default false,
  add column offer_types  text[] not null default '{}';      -- tipos de cuenta (crm.account_types.code) que el formulario ofrece
alter table crm.leads
  add column funnel      text,
  add column channel_id  text;
create index leads_funnel_idx on crm.leads (market_code, funnel) where funnel is not null;
create index leads_type_idx on crm.leads (market_code, account_type) where account_type is not null;

-- Origen "Campaña web". La lista de orígenes se amplía sin perder lo que otra migración haya agregado.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conrelid = 'crm.leads'::regclass and conname = 'leads_source_check';
  if def is not null and position('web_campaign' in def) = 0 then
    def := regexp_replace(def, '\]\)', ', ''web_campaign''::text])');
    execute 'alter table crm.leads drop constraint leads_source_check';
    execute 'alter table crm.leads add constraint leads_source_check ' || def;
  end if;
end $$;

-- La página pública no tiene sesión: lee solo el código y la etiqueta de los tipos de empresa que el formulario ofrece.
create function app.form_offer_types(p_slug text)
returns table (code text, label_es text, label_en text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select t.code, t.label_es, t.label_en
    from crm.web_forms f
    cross join lateral unnest(f.offer_types) with ordinality as o(code, ord)
    join lateral (select x.code, x.label_es, x.label_en from crm.account_types x
                   where x.code = o.code and x.is_active and (x.market_code is null or x.market_code = f.market_code)
                   order by x.market_code nulls last limit 1) t on true
   where f.slug = p_slug and f.is_active
   order by o.ord
$$;
revoke execute on function app.form_offer_types(text) from public;
grant execute on function app.form_offer_types(text) to contigo_app;

-- ---------------------------------------------------------------- 2) número de tiendas
-- El número de tiendas de un lead o de un comercio vive en sus campos (Puntos de venta, o Número de tiendas). Esta función
-- lo lee como número para filtrar y reportar; un valor que no es número no cuenta.
create function app.store_count(p_custom jsonb) returns numeric
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case when jsonb_typeof(p_custom -> 'b2b_points_of_sale') = 'number' then (p_custom ->> 'b2b_points_of_sale')::numeric
              when jsonb_typeof(p_custom -> 'store_count') = 'number' then (p_custom ->> 'store_count')::numeric end
$$;
grant execute on function app.store_count(jsonb) to contigo_app;

-- ---------------------------------------------------------------- 3) meta de respuesta en días hábiles
alter table crm.routing_rules
  add column sla_business_days int check (sla_business_days is null or sla_business_days between 1 and 10);

-- Minutos hábiles de un día del mercado (por defecto, de 9:00 a 18:00).
create function app.business_day_minutes(p_market text) returns int
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select greatest(1, (extract(epoch from (coalesce((select h.closes from crm.market_hours h where h.market_code = p_market), time '18:00')
                                         - coalesce((select h.opens from crm.market_hours h where h.market_code = p_market), time '09:00'))) / 60)::int)
$$;
grant execute on function app.business_day_minutes(text) to contigo_app;

-- Una meta en días hábiles se guarda también en minutos hábiles: todo lo que ya lee sla_minutes sigue funcionando.
create function crm.routing_sla_sync() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.sla_business_days is not null then
    new.sla_minutes := new.sla_business_days * app.business_day_minutes(new.market_code);
  end if;
  return new;
end $$;
create trigger routing_rules_sla_sync before insert or update of sla_business_days, sla_minutes, market_code on crm.routing_rules
  for each row execute function crm.routing_sla_sync();

-- Si cambia el horario del mercado, las metas en días hábiles se recalculan.
create function crm.market_hours_sla_sync() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  update crm.routing_rules set sla_business_days = sla_business_days
   where market_code = new.market_code and sla_business_days is not null;
  return new;
end $$;
create trigger market_hours_sla_sync after insert or update on crm.market_hours
  for each row execute function crm.market_hours_sla_sync();

-- ---------------------------------------------------------------- 4) gerente de territorio
alter table crm.territories add column manager_id uuid references crm.users(id);
create index territories_manager_idx on crm.territories (manager_id) where manager_id is not null;

-- Las tiendas de venta puerta a puerta son del gerente de su territorio (E16.F2). Esta función aplica la regla a un comercio:
-- si es una tienda D2D, su territorio tiene gerente y el gerente todavía vende en el mercado, la tienda pasa a él con sus
-- negocios abiertos, sus tareas y visitas por hacer y sus pendientes, y la atribución de dueño queda con fecha efectiva.
-- Un territorio sin gerente no cambia nada (regiones sin cobertura: la tienda queda como estaba y se avisa como hasta ahora).
-- Devuelve el nuevo dueño, o null si no hubo cambio. Deja el evento en la bitácora a nombre de quien hizo el cambio.
create function app.apply_territory_owner(p_account uuid) returns uuid
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare a crm.accounts; mgr uuid; mname text; me uuid := app.current_user_id();
begin
  select * into a from crm.accounts where id = p_account for update;
  if not found or a.kind <> 'store' or a.segment is distinct from 'd2d' or a.territory_id is null
     or a.archived_at is not null or a.merged_into is not null then
    return null;
  end if;
  if me is not null and not (a.market_code = any(app.write_markets())) then
    return null;
  end if;
  select t.manager_id into mgr from crm.territories t
   where t.id = a.territory_id and t.market_code = a.market_code and t.archived_at is null;
  if mgr is null or mgr is not distinct from a.owner_id or not app.can_sell_in(mgr, a.market_code) then
    return null;
  end if;
  select u.full_name into mname from crm.users u where u.id = mgr;
  update crm.account_attributions set effective_to = now() where account_id = a.id and layer = 'owner' and effective_to is null;
  insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by)
  values (a.id, a.market_code, 'owner', 'user', mgr::text, mname, me);
  update crm.deals set owner_id = mgr where account_id = a.id and status = 'open';
  update crm.activities set owner_id = mgr where account_id = a.id and kind in ('task', 'visit') and done_at is null;
  update crm.accounts set owner_id = mgr where id = a.id;
  update crm.exceptions set owner_id = mgr
   where resolved_at is null and account_id = a.id and kind not in ('unowned_account', 'duplicate_suspect');
  insert into crm.audit_events (actor_id, action, object, object_id, market_code, before, after)
  values (me, 'account.owner_by_territory', 'account', a.id, a.market_code,
          jsonb_build_object('owner_id', a.owner_id), jsonb_build_object('owner_id', mgr, 'territory_id', a.territory_id));
  return mgr;
end $$;
revoke execute on function app.apply_territory_owner(uuid) from public;
grant execute on function app.apply_territory_owner(uuid) to contigo_app;

-- Una tienda D2D que queda sin dueño en un territorio con gerente (una carga, una importación, alguien que la suelta) pasa
-- al gerente por la misma regla, por cualquier camino que entre.
create function crm.account_territory_owner() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  perform app.apply_territory_owner(new.id);
  return null;
end $$;
create trigger accounts_territory_owner after insert or update of territory_id, owner_id, segment on crm.accounts
  for each row when (new.owner_id is null and new.territory_id is not null and new.kind = 'store' and new.segment = 'd2d')
  execute function crm.account_territory_owner();

-- ---------------------------------------------------------------- 5) regla para ganar
-- Con close_by_transaction = false el negocio se gana a mano. Con txn_also_wins = true, además, la primera transacción lo
-- gana sola: "contrato firmado, o prepago y transaccionando". La fecha del contrato la pide una etapa del embudo.
alter table crm.pipelines add column txn_also_wins boolean not null default false;

insert into crm.field_definitions (object, key, label_es, label_en, data_type, options, market_code, data_class, motor, position)
select 'deal', v.key, v.label_es, v.label_en, 'date', '[]'::jsonb, 'MX', 'internal', 'b2b', v.position
  from (values
    ('b2b_nda_signed_on',      'NDA firmado el',      'NDA signed on',      200),
    ('b2b_contract_signed_on', 'Contrato firmado el', 'Contract signed on', 201)
  ) v(key, label_es, label_en, position)
 where exists (select 1 from crm.markets m where m.code = 'MX')
on conflict do nothing;

-- ---------------------------------------------------------------- 6) etapas de México como las describe el documento
-- D2D: Prospecto, Contactada, Comprometida, En migración, con aviso de inactividad a los 30, 14, 7 y 7 días (E14.F2).
-- B2B/ISO: del lead a la propuesta, NDA, integración técnica, contrato, certificación y operación (E14.F5).
-- Solo toca las etapas que nadie ha editado (edited_at vacío) y no cambia de etapa ningún negocio. Se puede llamar más de una vez.
create function crm.apply_mx_stage_template() returns void
language plpgsql set search_path = crm, app, pg_catalog as $$
declare d2d uuid; b2b uuid; p int;
begin
  select id into d2d from crm.pipelines where market_code = 'MX' and motor = 'd2d' order by position limit 1;
  if d2d is not null then
    update crm.stages s set name_es = v.es, name_en = v.en, rot_days = v.rot, exit_es = v.xes, exit_en = v.xen
      from (values
        ('visitada', 'Prospecto',     'Prospect',  30, 'Se habló con alguien de la tienda',                'Someone at the store was reached'),
        ('interes',  'Contactada',    'Contacted', 14, 'Quien decide aceptó migrar',                       'The decision-maker agreed to migrate'),
        ('alta',     'Comprometida',  'Committed',  7, 'La migración empezó en la Sales App',              'The migration started in the Sales App'),
        ('espera',   'En migración',  'Migrating',  7, 'Los datos de ventas traen la primera transacción', 'The sales data shows the first transaction')
      ) v(code, es, en, rot, xes, xen)
     where s.pipeline_id = d2d and s.code = v.code and s.edited_at is null and s.archived_at is null;
  end if;

  select id into b2b from crm.pipelines where market_code = 'MX' and motor = 'b2b' order by position limit 1;
  if b2b is not null and exists (select 1 from crm.stages where pipeline_id = b2b and code = 'propuesta')
     and exists (select 1 from crm.stages where pipeline_id = b2b and code = 'certificacion') then
    if not exists (select 1 from crm.stages where pipeline_id = b2b and code = 'nda') then
      select position into p from crm.stages where pipeline_id = b2b and code = 'propuesta';
      update crm.stages set position = position + 1000 where pipeline_id = b2b and position > p;
      update crm.stages set position = position - 999 where pipeline_id = b2b and position > 1000;
      insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en)
      values (b2b, p + 1, 'nda', 'Acuerdo de confidencialidad (NDA)', 'Non-disclosure agreement (NDA)', 'open', 40, 14, '{amount,decision_maker}',
              'NDA firmado por las dos partes', 'NDA signed by both parties');
    end if;
    if not exists (select 1 from crm.stages where pipeline_id = b2b and code = 'contrato') then
      select position into p from crm.stages where pipeline_id = b2b and code = 'certificacion';
      update crm.stages set position = position + 1000 where pipeline_id = b2b and position >= p;
      update crm.stages set position = position - 999 where pipeline_id = b2b and position >= 1000;
      insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en)
      values (b2b, p, 'contrato', 'Contrato', 'Contract', 'open', 72, 21, '{amount,decision_maker}',
              'Contrato firmado', 'Contract signed');
    end if;
    -- Lo que pide cada etapa para entrar: integración técnica, con el NDA firmado; certificación, con el contrato firmado.
    update crm.stages set required_fields = array(select distinct unnest(required_fields || '{field:b2b_nda_signed_on}'::text[]))
     where pipeline_id = b2b and code = 'integracion' and edited_at is null and not ('field:b2b_nda_signed_on' = any(required_fields));
    update crm.stages set required_fields = array(select distinct unnest(required_fields || '{field:b2b_contract_signed_on}'::text[]))
     where pipeline_id = b2b and code = 'certificacion' and edited_at is null and not ('field:b2b_contract_signed_on' = any(required_fields));
  end if;
end $$;
revoke execute on function crm.apply_mx_stage_template() from public;
select crm.apply_mx_stage_template();

-- ---------------------------------------------------------------- 7) carga desde hojas
create table crm.sheet_loads (
  id           uuid primary key default app.uuid_v7(),
  market_code  text not null references crm.markets(code),
  kind         text not null check (kind in ('visits','migrated_stores')),
  label        text check (label is null or char_length(btrim(label)) between 1 and 120),
  rows_total   int not null default 0 check (rows_total >= 0),
  rows_loaded  int not null default 0 check (rows_loaded >= 0),
  rows_known   int not null default 0 check (rows_known >= 0),      -- ya estaban cargadas: no se duplican
  rows_failed  int not null default 0 check (rows_failed >= 0),
  problems     jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  created_by   uuid not null references crm.users(id),
  created_at   timestamptz not null default now()
);
create index sheet_loads_market_idx on crm.sheet_loads (market_code, created_at desc);

-- Una fila de la hoja se carga una sola vez: la llave es el comercio, el día y quién visitó (visitas) o el comercio (migradas).
create table crm.sheet_rows (
  market_code  text not null references crm.markets(code),
  kind         text not null check (kind in ('visits','migrated_stores')),
  row_key      text not null check (char_length(row_key) between 8 and 200),
  load_id      uuid not null references crm.sheet_loads(id),
  ref_id       uuid,                                                  -- la actividad o el negocio que dejó
  created_at   timestamptz not null default now(),
  primary key (market_code, kind, row_key)
);

-- Mercados donde la persona dirige un equipo o el mercado (o administra): quienes cargan y ven las cargas.
create function app.manage_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships() where role in ('market_lead','supervisor')), '{}')
         end
$$;
grant execute on function app.manage_markets() to contigo_app;

-- ---------------------------------------------------------------- 8) arranque del mercado
create table crm.market_rollout (
  market_code      text primary key references crm.markets(code),
  leaders_first    boolean not null default false,       -- mientras esté activo, solo entra quien lidera y las personas clave
  team_opened_at   timestamptz,
  updated_by       uuid references crm.users(id),
  updated_at       timestamptz not null default now()
);
create table crm.rollout_key_people (
  market_code  text not null references crm.markets(code),
  email        citext not null check (char_length(email::text) between 5 and 160),
  added_by     uuid references crm.users(id),
  added_at     timestamptz not null default now(),
  primary key (market_code, email)
);
create table crm.rollout_steps (
  market_code  text not null references crm.markets(code),
  step         text not null check (step ~ '^[a-z][a-z0-9_]{1,40}$'),
  done_at      timestamptz,
  done_by      uuid references crm.users(id),
  note         text check (note is null or char_length(note) <= 300),
  link         text check (link is null or (char_length(link) <= 300 and link ~ '^https://')),
  updated_at   timestamptz not null default now(),
  primary key (market_code, step)
);

-- "Primero quienes lideran": con la regla activa en un mercado, un acceso de Ventas solo entra si la persona es clave.
-- Dirección, líder de mercado, supervisión y Operaciones entran siempre. Al abrir al equipo, la regla deja de aplicar.
create function crm.membership_rollout_guard() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
begin
  if new.role = 'rep' and new.market_code is not null
     and exists (select 1 from crm.market_rollout r where r.market_code = new.market_code and r.leaders_first and r.team_opened_at is null)
     and not exists (select 1 from crm.rollout_key_people k join crm.users u on u.email = k.email
                      where k.market_code = new.market_code and u.id = new.user_id) then
    raise exception 'leaders first: the market is not open to the field team yet' using errcode = '23514', constraint = 'rollout_leaders_first';
  end if;
  return new;
end $$;
create trigger memberships_rollout_guard before insert on crm.memberships
  for each row execute function crm.membership_rollout_guard();

do $$
declare t text;
begin
  foreach t in array array['sheet_loads','sheet_rows','market_rollout','rollout_key_people','rollout_steps'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);   -- AUTHZ-03
  end loop;
end $$;
grant select, insert, update on crm.sheet_loads to contigo_app;
grant select, insert on crm.sheet_rows to contigo_app;
grant select, insert, update on crm.market_rollout, crm.rollout_steps to contigo_app;
grant select, insert, delete on crm.rollout_key_people to contigo_app;

create policy sheet_loads_read on crm.sheet_loads for select to contigo_app
  using (market_code = any((select app.manage_markets())::text[]));
create policy sheet_loads_ins on crm.sheet_loads for insert to contigo_app
  with check (created_by = (select app.current_user_id()) and market_code = any((select app.manage_markets())::text[]));
create policy sheet_loads_upd on crm.sheet_loads for update to contigo_app
  using (created_by = (select app.current_user_id()) and market_code = any((select app.manage_markets())::text[]))
  with check (created_by = (select app.current_user_id()) and market_code = any((select app.manage_markets())::text[]));
create policy sheet_rows_read on crm.sheet_rows for select to contigo_app
  using (market_code = any((select app.manage_markets())::text[]));
create policy sheet_rows_ins on crm.sheet_rows for insert to contigo_app
  with check (market_code = any((select app.manage_markets())::text[])
              and exists (select 1 from crm.sheet_loads l where l.id = sheet_rows.load_id and l.market_code = sheet_rows.market_code));

-- El arranque lo ve quien lidera o supervisa el mercado y leadership; lo cambia administración y quien lidera el mercado.
create function app.lead_markets() returns text[]
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when app.is_admin()
              then coalesce((select array_agg(code) from crm.markets), '{}')
              else coalesce((select array_agg(distinct market_code) from app.active_memberships() where role = 'market_lead'), '{}')
         end
$$;
grant execute on function app.lead_markets() to contigo_app;

-- Las personas con acceso vigente al mercado, con su rol de mayor alcance, desde cuándo, cuándo entraron por última vez y
-- si son personas clave. La ve quien dirige en ese mercado y leadership; nadie más recibe filas.
create function app.rollout_people(p_market text)
returns table (user_id uuid, full_name text, role text, team text, since timestamptz, last_login timestamptz, is_key boolean)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select distinct on (u.id) u.id, u.full_name, m.role, t.name, m.valid_from,
         (select max(e.at) from crm.audit_events e where e.actor_id = u.id and e.action = 'session.started'),
         exists (select 1 from crm.rollout_key_people k where k.market_code = p_market and k.email = u.email)
    from crm.memberships m join crm.users u on u.id = m.user_id left join crm.teams t on t.id = m.team_id
   where m.market_code = p_market and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
     and u.is_active and not u.is_system
     and (app.is_global() or p_market = any(app.manage_markets()))
   order by u.id, array_position(array['market_lead','supervisor','ops','rep'], m.role)
$$;
revoke execute on function app.rollout_people(text) from public;
grant execute on function app.rollout_people(text) to contigo_app;

create policy market_rollout_read on crm.market_rollout for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]));
create policy market_rollout_ins on crm.market_rollout for insert to contigo_app
  with check (market_code = any((select app.lead_markets())::text[]));
create policy market_rollout_upd on crm.market_rollout for update to contigo_app
  using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]));
create policy rollout_steps_read on crm.rollout_steps for select to contigo_app
  using (market_code = any((select app.my_markets())::text[]));
create policy rollout_steps_ins on crm.rollout_steps for insert to contigo_app
  with check (market_code = any((select app.lead_markets())::text[]));
create policy rollout_steps_upd on crm.rollout_steps for update to contigo_app
  using (market_code = any((select app.lead_markets())::text[])) with check (market_code = any((select app.lead_markets())::text[]));
create policy rollout_key_people_read on crm.rollout_key_people for select to contigo_app
  using (market_code = any((select app.manage_markets())::text[]) or (select app.is_global()));
create policy rollout_key_people_ins on crm.rollout_key_people for insert to contigo_app
  with check (market_code = any((select app.lead_markets())::text[]));
create policy rollout_key_people_del on crm.rollout_key_people for delete to contigo_app
  using (market_code = any((select app.lead_markets())::text[]));
