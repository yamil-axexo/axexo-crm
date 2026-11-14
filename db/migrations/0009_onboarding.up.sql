-- Primer ingreso: cada persona tiene su lista de primeros pasos, que marca y puede esconder.
-- Es una preferencia propia: nadie más la ve ni la cambia.
create table crm.user_onboarding (
  user_id    uuid primary key references crm.users(id),
  done       text[] not null default '{}',     -- claves de los pasos marcados
  hidden_at  timestamptz,                      -- cuándo escondió la lista
  seen_at    timestamptz not null default now()
);
alter table crm.user_onboarding enable row level security;
alter table crm.user_onboarding force row level security;   -- AUTHZ-03
grant select, insert, update on crm.user_onboarding to contigo_app;
create policy user_onboarding_own on crm.user_onboarding for all to contigo_app
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));
