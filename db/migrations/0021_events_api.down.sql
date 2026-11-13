-- Baja de 0021_events_api. Los mensajes muertos vuelven a "rejected" para que la restricción anterior valga.
drop function app.csv_import_undo(uuid);
drop table crm.untrusted_marks;
drop trigger field_definitions_text_untrusted on crm.field_definitions;
drop function crm.field_text_untrusted();
alter table crm.field_definitions drop column untrusted;
drop table crm.export_log;
drop table crm.csv_import_rows;
drop table crm.csv_imports;
drop function app.can_import(text);

drop index crm.inbound_events_dead_idx;
alter table crm.inbound_events drop column attempts, drop column replayed_at, drop column replayed_by;
update crm.inbound_events set status = 'rejected' where status = 'dead';
alter table crm.inbound_events drop constraint inbound_events_status_check;
alter table crm.inbound_events add constraint inbound_events_status_check check (status in ('received','processed','rejected'));

drop function app.intake_rejected(text, text);
drop table crm.intake_rejections;
drop function app.form_limits(text);
drop function app.form_render_age(text, uuid);
drop function app.form_render(text, uuid);
drop function app.rate_cleanup();
drop table crm.form_renders;
alter table crm.web_forms drop column min_fill_seconds, drop column rate_per_minute;

drop function app.rate_hit(text, int, int);
drop table crm.rate_counters;
drop function app.api_key(text);
create or replace function app.api_client(p_hash text)
returns table (id uuid, name text, scopes text[])
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select c.id, c.name, c.scopes from crm.api_clients c where c.key_hash = p_hash and c.revoked_at is null
$$;
alter table crm.api_clients drop column rotated_from, drop column retire_at, drop column last_used_at, drop column rate_per_minute,
  drop column mode, drop column market_code;

drop table crm.event_deliveries;
drop table crm.event_subscribers;
grant update on crm.outbox_events to contigo_app;
create policy outbox_admin_upd on crm.outbox_events for update to contigo_app
  using ((select app.is_admin())) with check ((select app.is_admin()));
alter table crm.outbox_events drop column version;
