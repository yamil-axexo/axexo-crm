do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'crm' loop
    execute format('drop policy %I on crm.%I', p.policyname, p.tablename);
  end loop;
end $$;
revoke all on all tables in schema crm from contigo_app;
revoke usage on schema crm, app from contigo_app;
drop function if exists app.duplicate_candidates(text, text, text, uuid), app.rr_next(uuid), app.form_public(text), app.api_client(text),
  app.sso_user(text, text, text, boolean), app.session_delete(text), app.session_user(text),
  app.session_create(uuid, text, text, int), app.persona_list(), app.demo_personas_enabled(),
  app.system_user_id(), app.scope_parent_ids(), app.my_territory_ids(), app.supervised_user_ids(),
  app.team_markets(), app.full_markets(), app.write_markets(), app.my_markets(), app.is_global(), app.is_admin(),
  app.active_memberships(), app.current_user_id();
