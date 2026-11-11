-- 0003_bootstrap: lo mínimo que existe en cualquier ambiente (no son datos sintéticos).
insert into crm.users (email, full_name, locale, is_system)
values ('system@contigo.internal', 'CONTIGO (sistema)', 'es', true)
on conflict (email) do nothing;

insert into crm.memberships (user_id, market_code, role)
select u.id, null, 'admin' from crm.users u
 where u.is_system and not exists (select 1 from crm.memberships m where m.user_id = u.id);

insert into crm.settings (key, value) values
  ('demo_personas', 'false'::jsonb),
  ('rules_last_run', 'null'::jsonb)
on conflict (key) do nothing;
