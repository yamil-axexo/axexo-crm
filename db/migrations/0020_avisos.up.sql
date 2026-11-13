-- 0020_avisos: servicio único de avisos (AUT-05), plantillas, anuncios con acuse (GOB-06), pedido a Operaciones,
-- agenda de capacitación y tiempos de un reporte (GOB-10).
-- Dentro de CONTIGO el aviso sale siempre. Correo, Slack y WhatsApp son canales apagados: lo que saldría queda en una cola.

-- 1) El aviso dentro de CONTIGO sigue viviendo en crm.notices; ahora lleva tipo, título, enlace y si pide acción.
alter table crm.notices drop constraint notices_kind_check;
alter table crm.notices
  alter column market_code drop not null,
  add column title           text check (title is null or length(title) between 1 and 160),
  add column link            text check (link is null or (link ~ '^/[A-Za-z0-9/_?=&#.-]*$' and length(link) <= 300)),
  add column needs_action    boolean not null default true,
  add column lead_id         uuid references crm.leads(id) on delete cascade,
  add column announcement_id uuid,
  add constraint notices_kind_check check (kind ~ '^[a-z_]{3,40}$');
-- Un aviso no sobrevive al registro del que habla. CONTIGO no borra personas, comercios ni negocios (el rol de la app no puede);
-- esto solo cuenta para las limpiezas de datos de prueba, que antes no encontraban avisos y ahora sí.
alter table crm.notices
  drop constraint notices_user_id_fkey, drop constraint notices_from_user_id_fkey, drop constraint notices_account_id_fkey,
  drop constraint notices_deal_id_fkey, drop constraint notices_activity_id_fkey,
  add constraint notices_user_id_fkey foreign key (user_id) references crm.users(id) on delete cascade,
  add constraint notices_from_user_id_fkey foreign key (from_user_id) references crm.users(id) on delete cascade,
  add constraint notices_account_id_fkey foreign key (account_id) references crm.accounts(id) on delete cascade,
  add constraint notices_deal_id_fkey foreign key (deal_id) references crm.deals(id) on delete cascade,
  add constraint notices_activity_id_fkey foreign key (activity_id) references crm.activities(id) on delete set null;
create index notices_user_all_idx on crm.notices (user_id, created_at desc);
create index notices_lead_idx on crm.notices (lead_id) where lead_id is not null;

drop policy notices_ins on crm.notices;
create policy notices_ins on crm.notices for insert to contigo_app
  with check (from_user_id = (select app.current_user_id()) and (market_code is null or market_code = any((select app.write_markets())::text[]) or (select app.is_global())));

-- 2) Preferencias de cada persona: qué tipos recibe, por qué canal, y si quiere un resumen diario.
create table crm.notification_prefs (
  user_id       uuid primary key references crm.users(id) on delete cascade,
  prefs         jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  daily_digest  boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- 3) Configuración de avisos por mercado. Nada trae valor por defecto: lo que no se ha definido queda vacío.
create table crm.market_comms (
  market_code          text primary key references crm.markets(code),
  orders_mailbox       text check (orders_mailbox is null or (orders_mailbox ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(orders_mailbox) <= 160)),
  sender_address       text check (sender_address is null or (sender_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(sender_address) <= 160)),
  walkthrough_url      text check (walkthrough_url is null or (walkthrough_url ~ '^https://' and length(walkthrough_url) <= 500)),
  support_whatsapp     text check (support_whatsapp is null or support_whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_daily_limit int check (whatsapp_daily_limit is null or whatsapp_daily_limit between 0 and 1000000),
  email_unit_cost      numeric(12,4) check (email_unit_cost is null or email_unit_cost >= 0),
  whatsapp_unit_cost   numeric(12,4) check (whatsapp_unit_cost is null or whatsapp_unit_cost >= 0),
  support_hours_high   int check (support_hours_high is null or support_hours_high between 1 and 720),
  support_hours_normal int check (support_hours_normal is null or support_hours_normal between 1 and 720),
  support_hours_low    int check (support_hours_low is null or support_hours_low between 1 and 720),
  updated_by           uuid references crm.users(id),
  updated_at           timestamptz not null default now()
);
insert into crm.market_comms (market_code) select code from crm.markets on conflict do nothing;

-- 4) Plantillas versionadas, en español y en inglés. Guardar una plantilla crea una versión nueva; la anterior se conserva.
create table crm.message_templates (
  id            uuid primary key default app.uuid_v7(),
  key           text not null check (key ~ '^[a-z0-9_]{3,40}$'),
  market_code   text references crm.markets(code),           -- nulo: vale en todos los mercados
  version       int not null check (version >= 1),
  is_current    boolean not null default true,
  is_active     boolean not null default true,
  recipient     text not null check (recipient in ('lead','person','ops','mailbox')),
  trigger_event text not null check (length(trigger_event) between 3 and 60),
  needs_consent boolean not null default false,
  subject_es    text not null check (length(subject_es) between 2 and 200),
  body_es       text not null check (length(body_es) between 2 and 4000),
  subject_en    text not null check (length(subject_en) between 2 and 200),
  body_en       text not null check (length(body_en) between 2 and 4000),
  created_by    uuid references crm.users(id),
  created_at    timestamptz not null default now()
);
create unique index message_templates_version_uq on crm.message_templates (key, coalesce(market_code, ''), version);
create unique index message_templates_current_uq on crm.message_templates (key, coalesce(market_code, '')) where is_current;

-- 5) El registro central: una fila por aviso y por canal, con plantilla, destinatario, costo y estado.
--    CONTIGO no borra leads, negocios ni comercios; si una limpieza de datos de prueba lo hace, el registro del envío se conserva sin el enlace.
create table crm.notifications (
  id                uuid primary key default app.uuid_v7(),
  market_code       text references crm.markets(code),
  notice_id         uuid references crm.notices(id) on delete set null,
  kind              text not null check (kind ~ '^[a-z_]{3,40}$'),
  channel           text not null check (channel in ('in_app','email','slack','whatsapp')),
  template_key      text,
  template_version  int,
  recipient_kind    text not null check (recipient_kind in ('person','lead','mailbox')),
  recipient_user_id uuid references crm.users(id) on delete cascade,
  recipient_address text check (recipient_address is null or length(recipient_address) <= 200),
  lead_id           uuid references crm.leads(id) on delete set null,
  account_id        uuid references crm.accounts(id) on delete set null,
  deal_id           uuid references crm.deals(id) on delete set null,
  subject           text not null check (length(subject) between 1 and 300),
  body              text not null check (length(body) between 1 and 6000),
  status            text not null check (status in ('delivered','queued_off','simulated','held_hours','held_digest','held_limit','digested','skipped_consent','skipped_no_address','blocked_template')),
  cost              numeric(12,4) check (cost is null or cost >= 0),
  cost_currency     text check (cost_currency is null or length(cost_currency) = 3),
  release_at        timestamptz,
  sent_at           timestamptz,
  created_by        uuid not null references crm.users(id) on delete cascade,
  created_at        timestamptz not null default now()
);
create index notifications_queue_idx on crm.notifications (channel, status, created_at desc);
create index notifications_recipient_idx on crm.notifications (recipient_user_id, created_at desc);
create index notifications_held_idx on crm.notifications (release_at) where status = 'held_hours';

-- 6) Anuncios a la red con acuse. Cambiar un anuncio publicado crea una versión nueva y el acuse vuelve a empezar.
create table crm.announcements (
  id            uuid primary key default app.uuid_v7(),
  series_id     uuid not null,
  version       int not null default 1 check (version >= 1),
  topic         text not null default 'general' check (topic in ('general','commission','onboarding','outage','release')),
  locale        text not null default 'es' check (locale in ('es','en')),
  title         text not null check (length(title) between 3 and 140),
  body          text not null check (length(body) between 5 and 3000),
  title_other   text check (title_other is null or length(title_other) between 3 and 140),
  body_other    text check (body_other is null or length(body_other) between 5 and 3000),
  market_code   text references crm.markets(code),
  team_id       uuid references crm.teams(id),
  role          text check (role is null or role in ('admin','lt','market_lead','supervisor','rep','ops')),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  effective_on  date,
  requires_ack  boolean not null default false,
  status        text not null default 'published' check (status in ('published','superseded','withdrawn')),
  created_by    uuid not null references crm.users(id),
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((title_other is null) = (body_other is null)),
  -- Un cambio de comisiones o de alta siempre exige acuse y dice desde cuándo vale.
  check (topic not in ('commission','onboarding') or (requires_ack and effective_on is not null)),
  unique (series_id, version)
);
create index announcements_live_idx on crm.announcements (status, ends_at);
alter table crm.notices add constraint notices_announcement_fk foreign key (announcement_id) references crm.announcements(id);

create table crm.announcement_receipts (
  announcement_id uuid not null references crm.announcements(id),
  user_id         uuid not null references crm.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  ack_at          timestamptz,
  primary key (announcement_id, user_id)
);

-- 7) Pedido enviado a Operaciones: quién, cuándo, a qué buzón, y quién lo recibió en Operaciones.
create table crm.order_dispatches (
  id           uuid primary key default app.uuid_v7(),
  deal_id      uuid not null references crm.deals(id) on delete cascade,
  market_code  text not null references crm.markets(code),
  sent_by      uuid not null references crm.users(id),
  sent_at      timestamptz not null default now(),
  mailbox      text,
  total_minor  bigint not null default 0,
  lines        int not null default 0,
  received_by  uuid references crm.users(id),
  received_at  timestamptz,
  check ((received_by is null) = (received_at is null))
);
create index order_dispatches_deal_idx on crm.order_dispatches (deal_id, sent_at desc);
create index order_dispatches_open_idx on crm.order_dispatches (market_code, sent_at) where received_at is null;

-- 8) Agenda de capacitación del dealer nuevo: fecha, quién la da y cómo terminó.
create table crm.training_sessions (
  id            uuid primary key default app.uuid_v7(),
  deal_id       uuid not null references crm.deals(id) on delete cascade,
  market_code   text not null references crm.markets(code),
  on_date       date not null,
  at_time       time,
  trainer_id    uuid not null references crm.users(id),
  status        text not null default 'scheduled' check (status in ('scheduled','done','no_show','cancelled')),
  note          text check (note is null or length(note) <= 500),
  rescheduled_from uuid references crm.training_sessions(id),
  created_by    uuid not null references crm.users(id),
  created_at    timestamptz not null default now(),
  resolved_by   uuid references crm.users(id),
  resolved_at   timestamptz
);
create index training_sessions_deal_idx on crm.training_sessions (deal_id, on_date desc);
create unique index training_sessions_open_uq on crm.training_sessions (deal_id) where status = 'scheduled';

-- 9) Reporte de un problema: cuándo lo empezó a revisar administración (los tiempos salen de las tres marcas).
alter table crm.problem_reports
  add column taken_by uuid references crm.users(id),
  add column taken_at timestamptz,
  add constraint problem_reports_taken check ((taken_by is null) = (taken_at is null));
grant update (taken_by, taken_at) on crm.problem_reports to contigo_app;

-- 10) Lección de Kore Academy por pantalla (la dirección la pone administración; sin dirección, no se muestra nada).
create table crm.help_lessons (
  screen      text primary key check (screen ~ '^/[a-z0-9/_-]{1,60}$'),
  url         text not null check (url ~ '^https://' and length(url) <= 500),
  updated_by  uuid references crm.users(id),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- funciones

-- Lo que el servicio necesita saber de quien recibe: idioma, correo, preferencias. Solo eso, de cualquier persona activa.
create or replace function app.notify_target(p_user uuid)
returns table (id uuid, full_name text, email text, locale text, prefs jsonb, daily_digest boolean)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select u.id, u.full_name, u.email::text, u.locale, coalesce(p.prefs, '{}'::jsonb), coalesce(p.daily_digest, false)
    from crm.users u left join crm.notification_prefs p on p.user_id = u.id
   where u.id = p_user and u.is_active and not u.is_system and (select app.current_user_id()) is not null
$$;
grant execute on function app.notify_target(uuid) to contigo_app;

-- Personas con un rol vigente en un mercado (para avisar a Operaciones o a quien reparte leads).
create or replace function app.people_with_role(p_market text, p_roles text[]) returns table (user_id uuid)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select distinct u.id from crm.users u join crm.memberships m on m.user_id = u.id
   where u.is_active and not u.is_system and (select app.current_user_id()) is not null
     and m.role = any(p_roles) and (m.market_code = p_market or (m.market_code is null and p_market is null))
     and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
$$;
grant execute on function app.people_with_role(text, text[]) to contigo_app;

-- ¿Está la persona en la audiencia (mercado, equipo, rol)? Un rol global entra en la audiencia de cualquier mercado.
create or replace function app.in_audience(p_market text, p_team uuid, p_role text) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select exists (select 1 from app.active_memberships() m
                  where (p_market is null or m.market_code is null or m.market_code = p_market)
                    and (p_team is null or m.team_id = p_team)
                    and (p_role is null or m.role = p_role))
$$;
grant execute on function app.in_audience(text, uuid, text) to contigo_app;

-- La audiencia de un anuncio con su acuse: la ve quien lo publicó y administración.
create or replace function app.announcement_audience(p_id uuid)
returns table (user_id uuid, full_name text, read_at timestamptz, ack_at timestamptz)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select u.id, u.full_name, r.read_at, r.ack_at
    from crm.announcements a
    join crm.users u on u.is_active and not u.is_system and u.id <> a.created_by
    left join crm.announcement_receipts r on r.announcement_id = a.id and r.user_id = u.id
   where a.id = p_id and (a.created_by = app.current_user_id() or app.is_admin())
     and exists (select 1 from crm.memberships m
                  where m.user_id = u.id and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
                    and (a.market_code is null or m.market_code is null or m.market_code = a.market_code)
                    and (a.team_id is null or m.team_id = a.team_id)
                    and (a.role is null or m.role = a.role))
   order by u.full_name
$$;
grant execute on function app.announcement_audience(uuid) to contigo_app;

-- ¿Está abierto el mercado a esta hora? Sirve para no mandar mensajes fuera del horario hábil.
create or replace function app.market_open(p_market text, p_at timestamptz) returns boolean
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select case when p_market is null then true else (
    select extract(isodow from loc)::int = any(coalesce(h.days, '{1,2,3,4,5}'::int[]))
           and loc::time >= coalesce(h.opens, time '09:00') and loc::time < coalesce(h.closes, time '18:00')
      from (select p_at at time zone coalesce((select mk.timezone from crm.markets mk where mk.code = p_market), 'UTC') as loc) x
      left join crm.market_hours h on h.market_code = p_market) end
$$;
grant execute on function app.market_open(text, timestamptz) to contigo_app;

-- ---------------------------------------------------------------- RLS (AUTHZ-03)
do $$
declare t text;
begin
  foreach t in array array['notification_prefs','market_comms','message_templates','notifications','announcements','announcement_receipts','order_dispatches','training_sessions','help_lessons'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('alter table crm.%I force row level security', t);
  end loop;
end $$;

grant select, insert, update on crm.notification_prefs, crm.market_comms, crm.message_templates, crm.notifications,
  crm.announcements, crm.announcement_receipts, crm.order_dispatches, crm.training_sessions, crm.help_lessons to contigo_app;
grant delete on crm.help_lessons to contigo_app;

create policy notification_prefs_own on crm.notification_prefs for select to contigo_app using (user_id = (select app.current_user_id()));
create policy notification_prefs_ins on crm.notification_prefs for insert to contigo_app with check (user_id = (select app.current_user_id()));
create policy notification_prefs_upd on crm.notification_prefs for update to contigo_app
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));

create policy market_comms_read on crm.market_comms for select to contigo_app using ((select app.current_user_id()) is not null);
create policy market_comms_ins on crm.market_comms for insert to contigo_app with check ((select app.is_admin()));
create policy market_comms_upd on crm.market_comms for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy message_templates_read on crm.message_templates for select to contigo_app using ((select app.current_user_id()) is not null);
create policy message_templates_ins on crm.message_templates for insert to contigo_app with check ((select app.is_admin()));
create policy message_templates_upd on crm.message_templates for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

-- La cola la ve administración; cada persona ve lo que salió para ella y lo que ella originó.
create policy notifications_read on crm.notifications for select to contigo_app
  using ((select app.is_admin()) or recipient_user_id = (select app.current_user_id()) or created_by = (select app.current_user_id()));
create policy notifications_ins on crm.notifications for insert to contigo_app with check (created_by = (select app.current_user_id()));
create policy notifications_upd on crm.notifications for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

create policy announcements_read on crm.announcements for select to contigo_app
  using ((select app.is_admin()) or created_by = (select app.current_user_id())
         or (status = 'published' and (select app.in_audience(market_code, team_id, role))));
create policy announcements_ins on crm.announcements for insert to contigo_app
  with check (created_by = (select app.current_user_id())
              and ((select app.is_admin()) or (market_code is not null and market_code = any((select app.write_markets())::text[]))));
create policy announcements_upd on crm.announcements for update to contigo_app
  using ((select app.is_admin()) or created_by = (select app.current_user_id()))
  with check ((select app.is_admin()) or created_by = (select app.current_user_id()));

create policy announcement_receipts_read on crm.announcement_receipts for select to contigo_app
  using (user_id = (select app.current_user_id()) or (select app.is_admin())
         or exists (select 1 from crm.announcements a where a.id = announcement_receipts.announcement_id and a.created_by = (select app.current_user_id())));
create policy announcement_receipts_ins on crm.announcement_receipts for insert to contigo_app
  with check (user_id = (select app.current_user_id()) and exists (select 1 from crm.announcements a where a.id = announcement_receipts.announcement_id));
create policy announcement_receipts_upd on crm.announcement_receipts for update to contigo_app
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));

create policy order_dispatches_read on crm.order_dispatches for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = order_dispatches.deal_id));
create policy order_dispatches_ins on crm.order_dispatches for insert to contigo_app
  with check (sent_by = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.deals d where d.id = order_dispatches.deal_id and d.market_code = order_dispatches.market_code));
create policy order_dispatches_upd on crm.order_dispatches for update to contigo_app
  using (market_code = any((select app.ops_markets())::text[])) with check (market_code = any((select app.ops_markets())::text[]));

create policy training_sessions_read on crm.training_sessions for select to contigo_app
  using (exists (select 1 from crm.deals d where d.id = training_sessions.deal_id));
create policy training_sessions_ins on crm.training_sessions for insert to contigo_app
  with check (created_by = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[])
              and exists (select 1 from crm.deals d where d.id = training_sessions.deal_id and d.market_code = training_sessions.market_code));
create policy training_sessions_upd on crm.training_sessions for update to contigo_app
  using (market_code = any((select app.write_markets())::text[])) with check (market_code = any((select app.write_markets())::text[]));

create policy help_lessons_read on crm.help_lessons for select to contigo_app using ((select app.current_user_id()) is not null);
create policy help_lessons_ins on crm.help_lessons for insert to contigo_app with check ((select app.is_admin()));
create policy help_lessons_upd on crm.help_lessons for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));
create policy help_lessons_del on crm.help_lessons for delete to contigo_app using ((select app.is_admin()));

-- Administración marca un reporte como "en revisión" (antes solo podía responder).
drop policy problem_reports_answer on crm.problem_reports;
create policy problem_reports_answer on crm.problem_reports for update to contigo_app
  using ((select app.is_admin()))
  with check ((select app.is_admin()) and (answered_by is null or answered_by = (select app.current_user_id())));

-- ---------------------------------------------------------------- plantillas iniciales (versión 1)
-- Variables: {{comercio}} {{contacto}} {{negocio}} {{quien}} {{mercado}} {{fecha}} {{detalle}} {{enlace}} {{titulo}} {{texto}}
-- El texto de la bienvenida a un lead de México lo confirma el equipo comercial: aquí queda pendiente, no inventado.
insert into crm.message_templates (key, market_code, version, recipient, trigger_event, needs_consent, subject_es, body_es, subject_en, body_en) values
  ('lead_welcome', 'MX', 1, 'lead', 'lead.created', true,
   '[pendiente: quien administra CONTIGO]', '[pendiente: quien administra CONTIGO]',
   '[pending: whoever administers CONTIGO]', '[pending: whoever administers CONTIGO]'),
  ('lead_web_ack', null, 1, 'lead', 'lead.created', true,
   'Recibimos tu solicitud', E'Hola, {{contacto}}:\n\nRecibimos la solicitud de {{comercio}}. Una persona del equipo de axexo te va a contactar.\n\nGracias por escribirnos.',
   'We received your request', E'Hello {{contacto}},\n\nWe received the request from {{comercio}}. Someone from the axexo team will contact you.\n\nThank you for reaching out.'),
  ('ops_handoff', null, 1, 'ops', 'deal.handed_to_ops', false,
   'Negocio entregado a Operaciones: {{negocio}}', E'{{quien}} entregó {{negocio}} ({{comercio}}) a Operaciones.\n\nÁbrelo en CONTIGO: {{enlace}}',
   'Deal handed over to Operations: {{negocio}}', E'{{quien}} handed {{negocio}} ({{comercio}}) over to Operations.\n\nOpen it in CONTIGO: {{enlace}}'),
  ('order_to_ops', null, 1, 'mailbox', 'order.sent', false,
   'Pedido de {{comercio}}', E'{{quien}} envió un pedido de {{comercio}} el {{fecha}}.\n\n{{detalle}}\n\nPedido completo en CONTIGO: {{enlace}}',
   'Order from {{comercio}}', E'{{quien}} sent an order from {{comercio}} on {{fecha}}.\n\n{{detalle}}\n\nFull order in CONTIGO: {{enlace}}'),
  ('account_new', null, 1, 'ops', 'account.created', false,
   'Cuenta nueva: {{comercio}}', E'{{quien}} creó la cuenta {{comercio}} en {{mercado}}.\n\nÁbrela en CONTIGO: {{enlace}}',
   'New account: {{comercio}}', E'{{quien}} created the account {{comercio}} in {{mercado}}.\n\nOpen it in CONTIGO: {{enlace}}'),
  ('dealer_active', null, 1, 'person', 'deal.won', false,
   'Dealer activo: {{comercio}}', E'{{comercio}} ya está activo: {{negocio}} se ganó el {{fecha}}.\n\nÁbrelo en CONTIGO: {{enlace}}',
   'Dealer active: {{comercio}}', E'{{comercio}} is now active: {{negocio}} was won on {{fecha}}.\n\nOpen it in CONTIGO: {{enlace}}'),
  ('owner_changed', null, 1, 'person', 'account.reassigned', false,
   'Ahora llevas {{comercio}}', E'{{quien}} te asignó {{comercio}}.\n\nÁbrelo en CONTIGO: {{enlace}}',
   'You now own {{comercio}}', E'{{quien}} assigned {{comercio}} to you.\n\nOpen it in CONTIGO: {{enlace}}'),
  ('approval_visit', null, 1, 'person', 'deal.ops_check.approved', false,
   'Aprobación de {{detalle}}: visita a {{comercio}}', E'{{detalle}} aprobó a {{comercio}}. Te quedó una tarea de visita en Hoy.\n\nÁbrelo en CONTIGO: {{enlace}}',
   '{{detalle}} approval: visit {{comercio}}', E'{{detalle}} approved {{comercio}}. A visit task is waiting for you in Today.\n\nOpen it in CONTIGO: {{enlace}}'),
  ('dealer_closed', null, 1, 'person', 'deal.lost', false,
   'Negocio cerrado sin alta: {{comercio}}', E'{{negocio}} ({{comercio}}) se cerró como perdido el {{fecha}}. Motivo: {{detalle}}.\n\nÁbrelo en CONTIGO: {{enlace}}',
   'Deal closed without sign-up: {{comercio}}', E'{{negocio}} ({{comercio}}) was closed as lost on {{fecha}}. Reason: {{detalle}}.\n\nOpen it in CONTIGO: {{enlace}}'),
  ('dealer_churned', null, 1, 'person', 'exception.opened.churn', false,
   'Comercio sin ventas: {{comercio}}', E'{{comercio}} dejó de vender. {{detalle}}\n\nÁbrelo en CONTIGO: {{enlace}}',
   'Merchant with no sales: {{comercio}}', E'{{comercio}} stopped selling. {{detalle}}\n\nOpen it in CONTIGO: {{enlace}}'),
  ('notice', null, 1, 'person', 'notice', false,
   '{{titulo}}', E'{{texto}}\n\nÁbrelo en CONTIGO: {{enlace}}',
   '{{titulo}}', E'{{texto}}\n\nOpen it in CONTIGO: {{enlace}}'),
  ('digest', null, 1, 'person', 'digest.daily', false,
   'Tu resumen de CONTIGO: {{titulo}}', E'{{texto}}\n\nTodos tus avisos: {{enlace}}',
   'Your CONTIGO summary: {{titulo}}', E'{{texto}}\n\nAll your notices: {{enlace}}');
