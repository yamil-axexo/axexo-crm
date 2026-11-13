drop policy problem_reports_answer on crm.problem_reports;
create policy problem_reports_answer on crm.problem_reports for update to contigo_app
  using ((select app.is_admin()))
  with check ((select app.is_admin()) and answered_by = (select app.current_user_id()));

drop table crm.help_lessons;
revoke update (taken_by, taken_at) on crm.problem_reports from contigo_app;
alter table crm.problem_reports drop constraint problem_reports_taken, drop column taken_by, drop column taken_at;
drop table crm.training_sessions;
drop table crm.order_dispatches;
drop table crm.announcement_receipts;
alter table crm.notices drop constraint notices_announcement_fk;
drop table crm.announcements;
drop table crm.notifications;
drop table crm.message_templates;
drop table crm.market_comms;
drop table crm.notification_prefs;

drop function app.market_open(text, timestamptz);
drop function app.announcement_audience(uuid);
drop function app.in_audience(text, uuid, text);
drop function app.people_with_role(text, text[]);
drop function app.notify_target(uuid);

-- Los avisos que nacieron con el servicio (tipos nuevos o sin mercado) no caben en la forma anterior.
delete from crm.notices where kind not in ('mention','returned') or market_code is null;
drop policy notices_ins on crm.notices;
create policy notices_ins on crm.notices for insert to contigo_app
  with check (from_user_id = (select app.current_user_id()) and market_code = any((select app.write_markets())::text[]));
alter table crm.notices
  drop constraint notices_user_id_fkey, drop constraint notices_from_user_id_fkey, drop constraint notices_account_id_fkey,
  drop constraint notices_deal_id_fkey, drop constraint notices_activity_id_fkey,
  add constraint notices_user_id_fkey foreign key (user_id) references crm.users(id),
  add constraint notices_from_user_id_fkey foreign key (from_user_id) references crm.users(id),
  add constraint notices_account_id_fkey foreign key (account_id) references crm.accounts(id),
  add constraint notices_deal_id_fkey foreign key (deal_id) references crm.deals(id),
  add constraint notices_activity_id_fkey foreign key (activity_id) references crm.activities(id);
drop index crm.notices_lead_idx;
drop index crm.notices_user_all_idx;
alter table crm.notices
  drop constraint notices_kind_check,
  drop column announcement_id, drop column lead_id, drop column needs_action, drop column link, drop column title,
  alter column market_code set not null,
  add constraint notices_kind_check check (kind in ('mention','returned'));
