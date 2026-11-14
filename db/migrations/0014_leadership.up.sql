-- 0014_leadership: lo que leadership, quien lidera un mercado y supervisión necesitan para leer el negocio.
-- 1) La tasa de cambio dice quién la cargó y cuándo (MULTI-01: tasa fechada y con origen).
-- 2) Adopción: conteos de uso por persona (último ingreso, ingresos y actividades del periodo), sin contenido.
-- 3) Índices para los reportes de negocios cerrados.

alter table crm.fx_rates
  add column loaded_by uuid references crm.users(id),
  add column loaded_at timestamptz not null default now();

create index deals_won_idx on crm.deals (market_code, won_at) where status = 'won';
create index deals_lost_idx on crm.deals (market_code, lost_at) where status = 'lost';

-- Adopción. SECURITY DEFINER porque cruza inicios de sesión (bitácora sin mercado) con membresías: la función
-- decide el alcance. Administración y leadership ven a todas las personas con acceso; quien lidera un mercado, a las
-- de su mercado. Cualquier otro rol recibe cero filas. Solo devuelve conteos y fechas: nada de lo que la persona escribió.
create function app.adoption(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, full_name text, roles text[], markets text[], teams text[], last_login timestamptz, logins int, activities int)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  with scope as (
    select app.is_global() as everything,
           coalesce((select array_agg(distinct market_code) from app.active_memberships() where role = 'market_lead'), '{}') as markets
  ), people as (
    select u.id, u.full_name,
           array_agg(distinct m.role order by m.role) as roles,
           array_remove(array_agg(distinct m.market_code order by m.market_code), null) as markets,
           array_remove(array_agg(distinct t.name order by t.name), null) as teams
      from crm.users u
      join crm.memberships m on m.user_id = u.id and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
      left join crm.teams t on t.id = m.team_id
      cross join scope s
     where u.is_active and not u.is_system
       and (s.everything or m.market_code = any(s.markets))
     group by u.id, u.full_name
  )
  select p.id, p.full_name, p.roles, p.markets, p.teams,
         (select max(e.at) from crm.audit_events e where e.actor_id = p.id and e.action = 'session.started'),
         (select count(*)::int from crm.audit_events e where e.actor_id = p.id and e.action = 'session.started' and e.at >= p_from and e.at < p_to),
         (select count(*)::int from crm.activities a where a.created_by = p.id and a.source = 'user' and a.created_at >= p_from and a.created_at < p_to)
    from people p
   order by p.full_name
$$;
revoke execute on function app.adoption(timestamptz, timestamptz) from public;
grant execute on function app.adoption(timestamptz, timestamptz) to contigo_app;
