-- 0013_leads: paquete leads de la ola 2 (12-nov-2026). Hallazgos del comité: us-campo, mx-b2b-liderazgo, mx-d2d.

-- ------------------------------------------------------------ 1) el lead guarda con qué tipo de cuenta y qué rol nace
-- El tipo de cuenta y el rol del contacto se eligen en el lead y se confirman al convertir. Una segunda solicitud web de
-- la misma empresa no crea otro lead: la persona queda en extra_contacts del lead existente.
alter table crm.leads
  add column account_kind   text check (account_kind is null or account_kind in ('organization','distributor','chain','store')),
  add column contact_role   text check (contact_role is null or contact_role in ('owner','decision_maker','manager','staff','billing','purchasing','finance','technology')),
  add column extra_contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(extra_contacts) = 'array');
alter table crm.web_forms
  add column account_kind text check (account_kind is null or account_kind in ('organization','distributor','chain','store'));

-- Orígenes del alta manual: visita en tienda, llamada entrante y evento, además de los que ya existían.
alter table crm.leads drop constraint if exists leads_source_check;
alter table crm.leads add constraint leads_source_check
  check (source in ('web_form','manual','import','referral','sales_app','walk_in','phone_in','event'));

-- Rol del contacto: se suman compras, finanzas y tecnología al catálogo (dueño, quien decide, encargado, personal, facturación).
-- Son los mismos códigos que usa el paquete b2b (0016), que amplía esta lista.
alter table crm.account_contacts drop constraint if exists account_contacts_role_check;
alter table crm.account_contacts add constraint account_contacts_role_check
  check (role in ('owner','decision_maker','manager','staff','billing','purchasing','finance','technology'));

-- Búsqueda dentro de la lista de leads por teléfono y por orden de llegada.
create index leads_phone_idx on crm.leads (phone) where phone is not null;
create index leads_market_created_idx on crm.leads (market_code, created_at desc, id desc);

-- ------------------------------------------------------------ 2) horario hábil del mercado para el reloj de primer contacto
-- Un lead que entra a las 22:00 no vence a las 23:00: el reloj cuenta solo dentro del horario del mercado, en su zona.
-- Sin fila para un mercado vale el horario por defecto: lunes a viernes de 9:00 a 18:00.
create table crm.market_hours (
  market_code  text primary key references crm.markets(code),
  days         int[] not null default '{1,2,3,4,5}' check (cardinality(days) >= 1 and days <@ array[1,2,3,4,5,6,7]),   -- 1 = lunes
  opens        time not null default '09:00',
  closes       time not null default '18:00',
  updated_by   uuid references crm.users(id),
  updated_at   timestamptz not null default now(),
  check (opens < closes)
);
alter table crm.market_hours enable row level security;
alter table crm.market_hours force row level security;   -- AUTHZ-03
grant select, insert, update on crm.market_hours to contigo_app;
create policy market_hours_read on crm.market_hours for select to contigo_app using ((select app.current_user_id()) is not null);
create policy market_hours_admin_ins on crm.market_hours for insert to contigo_app with check ((select app.is_admin()));
create policy market_hours_admin_upd on crm.market_hours for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
insert into crm.market_hours (market_code) select code from crm.markets on conflict do nothing;

-- Cuándo vence una meta de p_minutes minutos hábiles contados desde p_from, en el horario y la zona del mercado.
create or replace function app.business_due(p_market text, p_from timestamptz, p_minutes int) returns timestamptz
language plpgsql stable security definer set search_path = crm, app, pg_catalog as $$
declare
  tz text; d int[]; o time; c time;
  loc timestamp; day date; s timestamp; e timestamp;
  remaining numeric := greatest(coalesce(p_minutes, 60), 0);
  avail numeric; i int := 0;
begin
  select m.timezone into tz from crm.markets m where m.code = p_market;
  tz := coalesce(tz, 'UTC');
  select h.days, h.opens, h.closes into d, o, c from crm.market_hours h where h.market_code = p_market;
  d := coalesce(d, '{1,2,3,4,5}'::int[]); o := coalesce(o, time '09:00'); c := coalesce(c, time '18:00');
  loc := p_from at time zone tz;
  day := loc::date;
  while i < 370 loop
    if extract(isodow from day)::int = any(d) then
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
revoke execute on function app.business_due(text, timestamptz, int) from public;
grant execute on function app.business_due(text, timestamptz, int) to contigo_app;

-- ------------------------------------------------------------ 3) pasar un lead propio a un compañero, o soltarlo
-- La política de leads no deja a quien vende escribir un lead que deja de ser suyo. Esta función es el único camino:
-- solo mueve un lead abierto cuyo dueño es quien llama, y solo a alguien que vende en el mismo mercado (o a nadie).
-- El reloj de primer contacto vuelve a empezar para quien lo recibe solo si nadie lo había intentado todavía.
create or replace function app.hand_lead(p_lead uuid, p_to uuid) returns void
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare l crm.leads; me uuid := app.current_user_id(); mins int;
begin
  select * into l from crm.leads where id = p_lead for update;
  if not found or me is null or l.owner_id is distinct from me then
    raise exception 'not your lead' using errcode = '42501';
  end if;
  if l.status not in ('new','contacted','qualified') then
    raise exception 'lead is closed' using errcode = '42501';
  end if;
  if not (l.market_code = any(app.write_markets())) then
    raise exception 'read only in this market' using errcode = '42501';
  end if;
  if p_to is not null and (p_to = me or not app.can_sell_in(p_to, l.market_code)) then
    raise exception 'that person does not sell in this market' using errcode = '42501';
  end if;
  mins := coalesce((select r.sla_minutes from crm.web_forms f join crm.routing_rules r on r.id = f.routing_rule_id where f.id = l.form_id), 60);
  update crm.leads
     set owner_id = p_to,
         assigned_at = case when p_to is null then null else now() end,
         sla_due_at = case when p_to is not null and status = 'new' and first_touch_at is null and sla_due_at is not null
                           then app.business_due(market_code, now(), mins) else sla_due_at end
   where id = p_lead;
end $$;
revoke execute on function app.hand_lead(uuid, uuid) from public;
grant execute on function app.hand_lead(uuid, uuid) to contigo_app;

-- ------------------------------------------------------------ 4) búsqueda: "existe y lo lleva X"
-- Quien vende no ve los comercios ni los leads de otra persona, y la búsqueda le respondía "Sin resultados" aunque
-- existieran. Esta función dice que existe y quién lo lleva: nombre, ciudad y dueño, nada más. Solo dentro de los
-- mercados donde la persona vende; nunca cruza mercados. Pide al menos tres letras o siete dígitos del teléfono.
create or replace function app.search_others(p_term text)
returns table (kind text, id uuid, name text, locality text, owner_name text, market_code text)
language sql stable security definer set search_path = crm, app, public, extensions, pg_catalog as $$
  with t as (
    select btrim(translate(app.norm(coalesce(p_term, '')), '%_\', '')) as n,
           regexp_replace(coalesce(p_term, ''), '[^0-9]', '', 'g') as digits,
           app.current_user_id() as me,
           coalesce((select array_agg(distinct am.market_code) from app.active_memberships() am
                      where am.role in ('rep','supervisor','market_lead')), '{}') as mk
  ), acc as (
    select 'account'::text as kind, a.id, a.name, a.locality, u.full_name as owner_name, a.market_code
      from crm.accounts a join crm.users u on u.id = a.owner_id cross join t
     where t.me is not null and a.market_code = any(t.mk) and a.archived_at is null and a.merged_into is null
       and a.owner_id <> t.me
       and ((length(t.n) >= 3 and a.name_norm like '%' || t.n || '%')
            or (length(t.digits) >= 7 and a.phone like '%' || t.digits))
     order by a.name limit 5
  ), ld as (
    select 'lead'::text as kind, l.id, l.business_name as name, l.locality, u.full_name as owner_name, l.market_code
      from crm.leads l join crm.users u on u.id = l.owner_id cross join t
     where t.me is not null and l.market_code = any(t.mk) and l.status in ('new','contacted','qualified')
       and l.owner_id <> t.me
       and ((length(t.n) >= 3 and app.norm(l.business_name) like '%' || t.n || '%')
            or (length(t.digits) >= 7 and l.phone like '%' || t.digits))
     order by l.business_name limit 5
  )
  select * from acc union all select * from ld
$$;
revoke execute on function app.search_others(text) from public;
grant execute on function app.search_others(text) to contigo_app;
