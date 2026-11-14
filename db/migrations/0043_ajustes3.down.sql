-- 0043_ajustes3 (down). La reparación de títulos de tareas no se deshace (el título anterior era una clave interna).
update crm.stages s set required_fields = array_append(s.required_fields, 'decision_maker')
  from crm.pipelines p
 where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'd2d' and s.code = 'interes' and s.edited_at is null
   and not ('decision_maker' = any(s.required_fields));
create or replace function crm.exception_route_owner() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare r record; v_account uuid;
begin
  if new.owner_id is not null then return new; end if;
  v_account := coalesce(new.account_id, (select d.account_id from crm.deals d where d.id = new.deal_id));
  select * into r from app.exception_fallback_owner(new.market_code, v_account);
  if r.user_id is not null then
    new.owner_id := r.user_id;
    new.detail := coalesce(new.detail, '{}'::jsonb) || jsonb_build_object('routed_to', r.via);
  end if;
  return new;
end $$;
drop function if exists app.exception_record_motor(uuid, uuid, uuid);
drop function if exists app.exception_fallback_owner_motor(text, uuid, text);
