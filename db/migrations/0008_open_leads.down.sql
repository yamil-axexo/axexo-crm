drop policy leads_upd on crm.leads;
create policy leads_upd on crm.leads for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
  );

drop policy leads_read on crm.leads;
create policy leads_read on crm.leads for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
  or owner_id = (select app.current_user_id())
);

drop function app.sell_markets();
