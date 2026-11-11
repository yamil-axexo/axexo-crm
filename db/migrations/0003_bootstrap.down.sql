delete from crm.settings where key in ('demo_personas', 'rules_last_run');
-- El usuario de sistema solo se elimina si ningún registro de negocio lo referencia.
do $$
begin
  delete from crm.memberships where user_id in (select id from crm.users where is_system);
  delete from crm.users where is_system;
exception when foreign_key_violation then
  raise notice 'system user is referenced by business rows; kept';
end $$;
