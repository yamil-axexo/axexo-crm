alter table crm.pipelines drop column ops_checklist;

update crm.loss_reasons set market_code = null
 where code in ('store_closed_down','store_no_interest','signup_blocked','other_provider','no_cash_handling','landline_only','product_not_offered','owner_unavailable')
   and market_code = 'MX';

drop index crm.accounts_merchant_ref_idx;

alter table crm.activities drop column no_sale_code;

create or replace function app.visitor_names(p_market text) returns table (name text)
language sql stable security definer set search_path = crm, app, pg_catalog as $$
  select x.visited_by
    from crm.activities x
   where p_market = any(app.my_markets()) and x.market_code = p_market and x.visited_by is not null
   group by x.visited_by
   order by max(x.created_at) desc
   limit 40
$$;

drop table crm.street_sellers;
drop function app.can_manage_street(text, uuid);
