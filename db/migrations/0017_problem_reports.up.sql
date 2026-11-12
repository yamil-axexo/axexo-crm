-- Reportar un problema o pedir algo desde la app (ola 2, paquete contenido).
-- Cada persona ve los suyos; administración ve todos, responde y marca atendido; quien reportó ve la respuesta.
-- Nada se borra: un reporte queda abierto o atendido.
create table crm.problem_reports (
  id           uuid primary key default app.uuid_v7(),
  user_id      uuid not null references crm.users(id),
  kind         text not null default 'problem' check (kind in ('problem', 'request')),
  body         text not null check (char_length(body) between 5 and 2000),
  screen       text check (screen is null or char_length(screen) <= 200),   -- la pantalla donde estaba (ruta dentro de la app)
  urgency      text not null default 'normal' check (urgency in ('low', 'normal', 'high')),
  status       text not null default 'open' check (status in ('open', 'answered')),
  answer       text check (answer is null or char_length(answer) between 2 and 2000),
  answered_by  uuid references crm.users(id),
  answered_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint problem_reports_answered check ((status = 'answered') = (answer is not null and answered_by is not null and answered_at is not null))
);
create index problem_reports_user_idx on crm.problem_reports (user_id, created_at desc);
create index problem_reports_status_idx on crm.problem_reports (status, created_at desc);

alter table crm.problem_reports enable row level security;
alter table crm.problem_reports force row level security;   -- AUTHZ-03
grant select, insert on crm.problem_reports to contigo_app;
-- Responder solo toca la respuesta y el estado: lo que la persona escribió no se edita.
grant update (status, answer, answered_by, answered_at) on crm.problem_reports to contigo_app;

create policy problem_reports_read on crm.problem_reports for select to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.is_admin()));
create policy problem_reports_ins on crm.problem_reports for insert to contigo_app
  with check (user_id = (select app.current_user_id()) and status = 'open' and answer is null);
create policy problem_reports_answer on crm.problem_reports for update to contigo_app
  using ((select app.is_admin()))
  with check ((select app.is_admin()) and answered_by = (select app.current_user_id()));
