-- 0045_integraciones2 (down)
create or replace function app.csv_import_undo(p_import uuid)
returns table (undone int, kept int)
language plpgsql volatile security definer set search_path = crm, app, pg_catalog as $$
declare
  v_imp   crm.csv_imports%rowtype;
  r       record;
  v_undo  int := 0;
  v_keep  int := 0;
  v_ok    boolean;
begin
  select * into v_imp from crm.csv_imports where id = p_import for update;
  if v_imp.id is null or not app.can_import(v_imp.market_code) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_imp.status <> 'done' then
    raise exception 'import is not finished or was already undone' using errcode = '22023';
  end if;
  for r in select * from crm.csv_import_rows where import_id = p_import and outcome = 'created' order by row_no loop
    v_ok := false;
    begin
      if r.object = 'lead' then
        if exists (select 1 from crm.leads l where l.id = r.object_id and l.status = 'new')
           and not exists (select 1 from crm.activities a where a.lead_id = r.object_id)
           and not exists (select 1 from crm.deals d where d.lead_id = r.object_id) then
          delete from crm.untrusted_marks where object = 'lead' and object_id = r.object_id;
          delete from crm.leads where id = r.object_id;
          v_ok := true;
        end if;
      elsif r.object = 'account' then
        if exists (select 1 from crm.accounts a where a.id = r.object_id and a.archived_at is null and a.lifecycle = 'prospect')
           and not exists (select 1 from crm.deals d where d.account_id = r.object_id)
           and not exists (select 1 from crm.activities a where a.account_id = r.object_id)
           and not exists (select 1 from crm.accounts c where c.parent_id = r.object_id and c.archived_at is null) then
          update crm.accounts set archived_at = now(), phone = null where id = r.object_id;
          v_ok := true;
        end if;
      elsif r.object = 'contact' then
        update crm.account_contacts set valid_to = now(), is_primary = false where contact_id = r.object_id and valid_to is null;
        v_ok := found;
      end if;
    exception when foreign_key_violation then
      v_ok := false;
    end;
    if v_ok then
      v_undo := v_undo + 1;
      update crm.csv_import_rows set outcome = 'undone' where import_id = p_import and row_no = r.row_no;
    else
      v_keep := v_keep + 1;
      update crm.csv_import_rows set outcome = 'kept', detail = 'worked_after_import' where import_id = p_import and row_no = r.row_no;
    end if;
  end loop;
  update crm.csv_imports set status = 'undone', undone_at = now(), undone_by = app.current_user_id() where id = p_import;
  return query select v_undo, v_keep;
end $$;

alter table crm.csv_imports drop constraint if exists csv_imports_kind_check;
delete from crm.csv_import_rows where import_id in (select id from crm.csv_imports where kind = 'mx_leads');
delete from crm.csv_imports where kind = 'mx_leads';
alter table crm.csv_imports add constraint csv_imports_kind_check check (kind in ('accounts','contacts','leads'));

drop table if exists crm.pipedrive_backups;
drop table if exists crm.generated_documents;

delete from crm.untrusted_marks where origin = 'route_tool';
alter table crm.untrusted_marks drop constraint if exists untrusted_marks_origin_check;
alter table crm.untrusted_marks add constraint untrusted_marks_origin_check check (origin in ('web_form','api_form','sales_app','csv_import'));
delete from crm.visits where external_visit_id like 'route:%';
delete from crm.inbound_events where source = 'route_tool';
alter table crm.inbound_events drop constraint if exists inbound_events_source_check;
alter table crm.inbound_events add constraint inbound_events_source_check check (source in ('sales_app','s5','web_form'));

drop function if exists app.can_import_any();
drop function if exists app.in_maintenance(text, timestamptz);
drop table if exists crm.maintenance_windows;
drop table if exists crm.load_runs;
drop table if exists crm.data_loads;

drop table if exists crm.store_sales_lines;
delete from crm.ingest_batches where source = 's5_store_sales';
