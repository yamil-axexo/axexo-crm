do $$ begin
  execute format('alter role contigo_app in database %I reset jit', current_database());
end $$;

drop trigger accounts_territory on crm.accounts;
drop function crm.account_territory();
alter table crm.territories drop column archived_at;

drop index crm.leads_open_owner_idx;
drop index crm.deals_open_owner_idx;
drop index crm.accounts_market_region_idx;
drop index crm.accounts_place_trgm;
drop trigger accounts_place on crm.accounts;
drop function crm.account_place();
alter table crm.accounts drop column place_norm;

-- Las políticas vuelven a como las dejó 0008 (leads) y 0002 (comercios).
drop policy leads_upd on crm.leads;
create policy leads_upd on crm.leads for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
    or (owner_id is null and market_code = any((select app.sell_markets())::text[]))
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
  or (owner_id is null and market_code = any((select app.sell_markets())::text[]))
);

drop policy accounts_upd on crm.accounts;
create policy accounts_upd on crm.accounts for update to contigo_app
  using (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
    or (owner_id is null and territory_id = any((select app.my_territory_ids())::uuid[]))
    or ancestor_ids && (select app.scope_parent_ids())::uuid[]
  )
  with check (
    market_code = any((select app.full_markets())::text[])
    or (market_code = any((select app.team_markets())::text[])
        and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
    or owner_id = (select app.current_user_id())
    or ancestor_ids && (select app.scope_parent_ids())::uuid[]
  );

drop policy accounts_read on crm.accounts;
create policy accounts_read on crm.accounts for select to contigo_app using (
  market_code = any((select app.full_markets())::text[])
  or (market_code = any((select app.team_markets())::text[])
      and (owner_id is null or owner_id = any((select app.supervised_user_ids())::uuid[])))
  or owner_id = (select app.current_user_id())
  or (owner_id is null and territory_id = any((select app.my_territory_ids())::uuid[]))
  or ancestor_ids && (select app.scope_parent_ids())::uuid[]
);

drop function app.team_seller_keys();
drop function app.seller_keys(text[]);
