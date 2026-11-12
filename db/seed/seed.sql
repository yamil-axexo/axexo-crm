-- Datos sintéticos por mercado (GOB-08). Solo para desarrollo y staging: nombres, teléfonos y montos son ficticios.
-- Las fechas son relativas a now() para que el ambiente siempre se vea al día.
do $$ begin
  if exists (select 1 from crm.users where not is_system) then
    raise exception 'seed: the database already has users; run migrations reset first';
  end if;
end $$;

create function pg_temp.h(t text) returns int language sql immutable as $$ select abs(hashtext(t)) % 1000003 $$;
create function pg_temp.pick(a text[], k int) returns text language sql immutable as $$ select a[1 + (k % array_length(a, 1))] $$;
create function pg_temp.uid(k text) returns uuid language sql immutable as $$ select md5('contigo:' || k)::uuid $$;

update crm.settings set value = 'true'::jsonb where key = 'demo_personas';

insert into crm.markets (code, name, currency, default_locale, locales, timezone, phone_cc, status, flags) values
  ('MX', 'México', 'MXN', 'es', '{es}', 'America/Mexico_City', '+52', 'live', '{"close_by_transaction": true}'),
  ('US', 'United States', 'USD', 'en', '{en,es}', 'America/New_York', '+1', 'live', '{"close_by_transaction": true}'),
  ('SV', 'El Salvador', 'USD', 'es', '{es}', 'America/El_Salvador', '+503', 'planned', '{"close_by_transaction": true}')
on conflict (code) do update set flags = excluded.flags;
insert into crm.legal_entities (id, market_code, name) values
  (pg_temp.uid('le-mx'), 'MX', 'Entidad MX (sintética)'), (pg_temp.uid('le-us'), 'US', 'Entity US (synthetic)');
insert into crm.fx_rates (currency, as_of, usd_rate, source) values
  ('USD', current_date - 1, 1, 'synthetic'), ('MXN', current_date - 1, 0.05, 'synthetic');

insert into crm.teams (id, market_code, name, motor) values
  (pg_temp.uid('t-d2d'), 'MX', 'D2D Centro', 'd2d'), (pg_temp.uid('t-b2b'), 'MX', 'B2B México', 'b2b'),
  (pg_temp.uid('t-us'), 'US', 'Dealers East', 'dealer');
insert into crm.territories (id, market_code, code, name) values
  (pg_temp.uid('ter-cdmx-n'), 'MX', 'CDMX-N', 'CDMX Norte'), (pg_temp.uid('ter-cdmx-s'), 'MX', 'CDMX-S', 'CDMX Sur'),
  (pg_temp.uid('ter-gdl'), 'MX', 'GDL', 'Guadalajara'), (pg_temp.uid('ter-mty'), 'MX', 'MTY', 'Monterrey'),
  (pg_temp.uid('ter-nv'), 'US', 'NV', 'Nevada'), (pg_temp.uid('ter-md'), 'US', 'MD', 'Maryland'), (pg_temp.uid('ter-fl'), 'US', 'FL', 'Florida');

insert into crm.users (id, email, full_name, locale, is_synthetic)
select pg_temp.uid(k), k || '@contigo.test', n, l, true from (values
  ('nora.salas', 'Nora Salas', 'es'), ('luis.tovar', 'Luis Tovar', 'es'), ('ana.robles', 'Ana Robles', 'es'),
  ('fernando.ibarra', 'Fernando Ibarra', 'es'), ('paula.mendez', 'Paula Méndez', 'es'), ('marco.pena', 'Marco Peña', 'es'),
  ('lucia.vega', 'Lucía Vega', 'es'), ('diana.cruz', 'Diana Cruz', 'es'), ('ivan.rios', 'Iván Ríos', 'es'),
  ('valeria.soto', 'Valeria Soto', 'es'), ('robert.hale', 'Robert Hale', 'en'), ('kira.dunn', 'Kira Dunn', 'en'),
  ('sam.ortiz', 'Sam Ortiz', 'en'), ('jade.kim', 'Jade Kim', 'en'), ('tom.reyes', 'Tom Reyes', 'en')) v(k, n, l);

insert into crm.memberships (user_id, market_code, role, team_id, valid_from)
select pg_temp.uid(k), m, r, case when t is null then null else pg_temp.uid(t) end, now() - interval '200 days' from (values
  ('nora.salas', null, 'admin', null), ('luis.tovar', null, 'lt', null), ('ana.robles', 'MX', 'market_lead', null),
  ('fernando.ibarra', 'MX', 'supervisor', 't-d2d'), ('paula.mendez', 'MX', 'supervisor', 't-b2b'),
  ('marco.pena', 'MX', 'rep', 't-d2d'), ('lucia.vega', 'MX', 'rep', 't-d2d'), ('diana.cruz', 'MX', 'rep', 't-b2b'),
  ('ivan.rios', 'MX', 'rep', 't-b2b'), ('valeria.soto', 'MX', 'ops', null), ('robert.hale', 'US', 'market_lead', null),
  ('kira.dunn', 'US', 'supervisor', 't-us'), ('sam.ortiz', 'US', 'rep', 't-us'), ('jade.kim', 'US', 'rep', 't-us'),
  ('tom.reyes', 'US', 'ops', null)) v(k, m, r, t);

insert into crm.user_territories (user_id, territory_id)
select pg_temp.uid(k), pg_temp.uid(t) from (values
  ('marco.pena', 'ter-cdmx-n'), ('marco.pena', 'ter-gdl'), ('lucia.vega', 'ter-cdmx-s'), ('lucia.vega', 'ter-mty'),
  ('sam.ortiz', 'ter-nv'), ('jade.kim', 'ter-md'), ('jade.kim', 'ter-fl')) v(k, t);

-- Pipelines por motor, con criterio de salida y campos requeridos por etapa (PIPE-01).
insert into crm.pipelines (id, market_code, motor, name, position) values
  (pg_temp.uid('p-mx-d2d'), 'MX', 'd2d', 'Alta de tiendas (D2D)', 1), (pg_temp.uid('p-mx-b2b'), 'MX', 'b2b', 'Cadenas y distribuidores', 2),
  (pg_temp.uid('p-us-dealer'), 'US', 'dealer', 'Dealer onboarding', 1), (pg_temp.uid('p-sv-b2b'), 'SV', 'b2b', 'Cadenas y distribuidores', 1);
insert into crm.stages (id, pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en)
select pg_temp.uid('s-' || p || '-' || c), pg_temp.uid('p-' || p), pos, c, es, en, k, pr, rot, req::text[], xes, xen from (values
  ('mx-d2d', 1, 'visitada', 'Tienda visitada', 'Store visited', 'open', 10, 10, '{}', 'Se habló con alguien de la tienda', 'Someone at the store was reached'),
  ('mx-d2d', 2, 'interes', 'Interés del decisor', 'Decision-maker interested', 'open', 35, 10, '{decision_maker}', 'El decisor confirmó interés', 'The decision-maker confirmed interest'),
  ('mx-d2d', 3, 'alta', 'Alta iniciada', 'Enrollment started', 'open', 60, 7, '{decision_maker,next_step}', 'Expediente completo en la Sales App', 'File complete in the Sales App'),
  ('mx-d2d', 4, 'espera', 'Esperando primera venta', 'Awaiting first sale', 'awaiting_txn', 85, 14, '{}', 'S5 reporta la primera transacción', 'S5 reports the first transaction'),
  ('mx-d2d', 5, 'ganada', 'Activa', 'Active', 'won', 100, 0, '{}', '', ''),
  ('mx-d2d', 6, 'perdida', 'Perdida', 'Lost', 'lost', 0, 0, '{}', '', ''),
  ('mx-b2b', 1, 'calificacion', 'Calificación', 'Qualification', 'open', 10, 14, '{}', 'Tamaño de red y decisor identificados', 'Network size and decision-maker identified'),
  ('mx-b2b', 2, 'propuesta', 'Propuesta', 'Proposal', 'open', 30, 14, '{amount}', 'Propuesta enviada con volumen esperado', 'Proposal sent with expected volume'),
  ('mx-b2b', 3, 'negociacion', 'Negociación', 'Negotiation', 'open', 55, 21, '{amount,decision_maker,next_step}', 'Términos acordados con el decisor', 'Terms agreed with the decision-maker'),
  ('mx-b2b', 4, 'espera', 'Contrato firmado, esperando primera venta', 'Signed, awaiting first sale', 'awaiting_txn', 85, 21, '{}', 'S5 reporta la primera transacción', 'S5 reports the first transaction'),
  ('mx-b2b', 5, 'ganada', 'Ganada', 'Won', 'won', 100, 0, '{}', '', ''),
  ('mx-b2b', 6, 'perdida', 'Perdida', 'Lost', 'lost', 0, 0, '{}', '', ''),
  ('us-dealer', 1, 'qualified', 'Calificado', 'Qualified', 'open', 15, 14, '{}', 'Dealer confirma interés y productos', 'Dealer confirms interest and products'),
  ('us-dealer', 2, 'application', 'Solicitud', 'Application', 'open', 40, 10, '{decision_maker,next_step}', 'Solicitud completa', 'Application complete'),
  ('us-dealer', 3, 'carrier', 'Envío a carriers', 'Carrier submission', 'open', 65, 28, '{next_step}', 'Carriers aprueban al dealer', 'Carriers approve the dealer'),
  ('us-dealer', 4, 'awaiting', 'Aprobado, esperando primera venta', 'Approved, awaiting first sale', 'awaiting_txn', 85, 21, '{}', 'S5 reporta la primera transacción', 'S5 reports the first transaction'),
  ('us-dealer', 5, 'won', 'Activo', 'Active', 'won', 100, 0, '{}', '', ''),
  ('us-dealer', 6, 'lost', 'Perdido', 'Lost', 'lost', 0, 0, '{}', '', ''),
  ('sv-b2b', 1, 'calificacion', 'Calificación', 'Qualification', 'open', 10, 14, '{}', '', ''),
  ('sv-b2b', 2, 'propuesta', 'Propuesta', 'Proposal', 'open', 30, 14, '{amount}', '', ''),
  ('sv-b2b', 3, 'espera', 'Esperando primera venta', 'Awaiting first sale', 'awaiting_txn', 85, 21, '{}', '', ''),
  ('sv-b2b', 4, 'ganada', 'Ganada', 'Won', 'won', 100, 0, '{}', '', ''),
  ('sv-b2b', 5, 'perdida', 'Perdida', 'Lost', 'lost', 0, 0, '{}', '', '')
) v(p, pos, c, es, en, k, pr, rot, req, xes, xen);

insert into crm.loss_reasons (code, kind, label_es, label_en) values
  ('price', 'lost', 'Precio o comisión', 'Price or commission'), ('competitor', 'lost', 'Se fue con un competidor', 'Chose a competitor'),
  ('no_decision', 'lost', 'Sin decisión', 'No decision'), ('not_qualified', 'lost', 'No califica', 'Not qualified'),
  ('duplicate', 'lost', 'Duplicado', 'Duplicate'), ('no_response', 'lost', 'No responde', 'No response'),
  ('owner_absent', 'no_sale', 'No estaba el decisor', 'Decision-maker absent'), ('no_cash', 'no_sale', 'Sin efectivo hoy', 'No cash today'),
  ('has_stock', 'no_sale', 'Tiene inventario', 'Has stock'), ('not_interested', 'no_sale', 'No le interesa', 'Not interested'),
  ('closed', 'no_sale', 'Tienda cerrada', 'Store closed')
on conflict (code) do nothing;

insert into crm.field_definitions (object, key, label_es, label_en, data_type, options, market_code, data_class) values
  ('account', 'giro', 'Giro', 'Business type', 'select', '["Abarrotes","Papelería","Farmacia","Ferretería","Otro"]', 'MX', 'internal'),
  ('account', 'store_count', 'Número de tiendas', 'Number of stores', 'number', '[]', null, 'internal'),
  ('account', 'carriers', 'Carriers', 'Carriers', 'text', '[]', 'US', 'internal'),
  ('deal', 'products_requested', 'Productos solicitados', 'Products requested', 'text', '[]', 'US', 'internal'),
  ('deal', 'expected_stores', 'Tiendas esperadas', 'Expected stores', 'number', '[]', 'MX', 'internal');

insert into crm.routing_rules (id, market_code, name, strategy, member_ids, fallback_id, sla_minutes) values
  (pg_temp.uid('rr-mx-b2b'), 'MX', 'Web MX B2B', 'round_robin', array[pg_temp.uid('diana.cruz'), pg_temp.uid('ivan.rios')], pg_temp.uid('ana.robles'), 60),
  (pg_temp.uid('rr-mx-d2d'), 'MX', 'Tiendas independientes MX', 'round_robin', array[pg_temp.uid('marco.pena'), pg_temp.uid('lucia.vega')], pg_temp.uid('fernando.ibarra'), 120),
  (pg_temp.uid('rr-us'), 'US', 'Web US dealers', 'round_robin', array[pg_temp.uid('sam.ortiz'), pg_temp.uid('jade.kim')], pg_temp.uid('robert.hale'), 120);
insert into crm.web_forms (id, market_code, slug, name, motor, locale, routing_rule_id) values
  (pg_temp.uid('f-mx-b2b'), 'MX', 'contacto-mx', 'Contacto comercial México', 'b2b', 'es', pg_temp.uid('rr-mx-b2b')),
  (pg_temp.uid('f-mx-d2d'), 'MX', 'tiendas-mx', 'Quiero vender recargas', 'd2d', 'es', pg_temp.uid('rr-mx-d2d')),
  (pg_temp.uid('f-us'), 'US', 'dealers-us', 'Become a dealer', 'dealer', 'en', pg_temp.uid('rr-us'));

-- ---------------------------------------------------------------- cuentas
create temp table seed_acc (k text primary key, market text, motor text, n int, lifecycle text, owner uuid, parent text) on commit drop;

-- Cadenas y distribuidores (padres).
insert into crm.accounts (id, market_code, legal_entity_id, kind, name, segment, lifecycle, lifecycle_at, owner_id, territory_id, phone, locality, region, country, custom, created_at)
select pg_temp.uid(k), m, pg_temp.uid(case m when 'MX' then 'le-mx' else 'le-us' end), kind, nm, case m when 'US' then 'dealer' else 'b2b' end, lc,
       now() - make_interval(days => case lc when 'active' then age - 24 when 'onboarding' then 6 else 3 end),
       pg_temp.uid(o), pg_temp.uid(ter), ph, loc, reg, m,
       jsonb_build_object('store_count', sc), now() - make_interval(days => age)
from (values
  ('mx-ch-1', 'MX', 'chain', 'Grupo Abarrotero del Valle', 'active', 'diana.cruz', 'ter-cdmx-n', '+525500900001', 'Ciudad de México', 'CDMX', 14, 310),
  ('mx-ch-2', 'MX', 'distributor', 'Distribuidora La Central', 'active', 'ivan.rios', 'ter-gdl', '+525500900002', 'Guadalajara', 'Jalisco', 22, 260),
  ('mx-ch-3', 'MX', 'chain', 'Farmacias Santa Clara', 'onboarding', 'diana.cruz', 'ter-mty', '+525500900003', 'Monterrey', 'Nuevo León', 9, 48),
  ('mx-ch-4', 'MX', 'chain', 'Papelerías El Estudiante', 'prospect', 'ivan.rios', 'ter-cdmx-s', '+525500900004', 'Ciudad de México', 'CDMX', 12, 30),
  ('mx-ch-5', 'MX', 'distributor', 'Mayoreo San Marcos', 'prospect', 'diana.cruz', 'ter-gdl', '+525500900005', 'Zapopan', 'Jalisco', 30, 21),
  ('mx-ch-6', 'MX', 'chain', 'Súper Ahorro del Norte', 'prospect', 'ivan.rios', 'ter-mty', '+525500900006', 'Apodaca', 'Nuevo León', 7, 12),
  ('us-ch-1', 'US', 'chain', 'Desert Sky Wireless Group', 'active', 'sam.ortiz', 'ter-nv', '+17025550101', 'Las Vegas', 'NV', 8, 280),
  ('us-ch-2', 'US', 'chain', 'Chesapeake Mobile Partners', 'onboarding', 'jade.kim', 'ter-md', '+14105550102', 'Baltimore', 'MD', 6, 40),
  ('us-ch-3', 'US', 'chain', 'Sunrise Cellular Holdings', 'prospect', 'jade.kim', 'ter-fl', '+13055550103', 'Miami', 'FL', 11, 18)
) v(k, m, kind, nm, lc, o, ter, ph, loc, reg, sc, age);

insert into seed_acc (k, market, motor, n, lifecycle, owner, parent)
select 'mx-s-' || n, 'MX', case when n <= 60 then 'b2b' else 'd2d' end, n,
       case when n <= 36 then 'active' when n <= 45 then 'onboarding' when n <= 60 then 'prospect'
            else (array['prospect','prospect','prospect','onboarding','active','active','active','active','at_risk','inactive'])[1 + pg_temp.h('lc' || n) % 10] end,
       case when n <= 60 then null
            when pg_temp.h('un' || n) % 12 = 0 then null
            when n % 4 in (0, 2) then pg_temp.uid('marco.pena') else pg_temp.uid('lucia.vega') end,
       case when n <= 14 then 'mx-ch-1' when n <= 36 then 'mx-ch-2' when n <= 45 then 'mx-ch-3' when n <= 60 then 'mx-ch-4' else null end
from generate_series(1, 320) n
union all
select 'us-s-' || n, 'US', 'dealer', n,
       case when n <= 8 then 'active' when n <= 14 then 'onboarding'
            else (array['prospect','prospect','onboarding','active','active','active','active','at_risk','inactive','prospect'])[1 + pg_temp.h('ulc' || n) % 10] end,
       case when n <= 14 then null when pg_temp.h('uun' || n) % 14 = 0 then null
            when n % 2 = 0 then pg_temp.uid('sam.ortiz') else pg_temp.uid('jade.kim') end,
       case when n <= 8 then 'us-ch-1' when n <= 14 then 'us-ch-2' else null end
from generate_series(1, 110) n;

insert into crm.accounts (id, market_code, legal_entity_id, parent_id, kind, name, segment, lifecycle, lifecycle_at, owner_id, territory_id, phone, locality, region, country, custom, created_at)
select pg_temp.uid(s.k), s.market, pg_temp.uid(case s.market when 'MX' then 'le-mx' else 'le-us' end),
       case when s.parent is null then null else pg_temp.uid(s.parent) end, 'store',
       case s.market
         when 'MX' then pg_temp.pick(array['Abarrotes','Miscelánea','Tienda','Súper','Recargas y Más','Papelería'], pg_temp.h('p' || s.n)) || ' '
              || pg_temp.pick(array['La Esperanza','El Sol','Doña Lupita','San Judas','Los Ángeles','El Milagro','La Bendición','Don Beto','La Estrella','El Paisa','Mi Ranchito','La Güera','El Porvenir','Santa Fe','La Esquina','Los Compadres','El Triunfo','La Providencia','Tres Hermanos','La Guadalupana','El Buen Precio','La Reforma','Del Carmen','El Mirador'], pg_temp.h('q' || s.n) + s.n)
              || case when s.n > 24 then ' ' || (2 + s.n / 24)::text else '' end
         else pg_temp.pick(array['Desert','Sunrise','Flamingo Rd','Liberty','Harbor','Capitol','Bayside','Canyon','Chesapeake','Palm','Silver State','Tropicana','Charleston','Eastern Ave','Coral Way','Calle Ocho'], pg_temp.h('q' || s.n) + s.n) || ' '
              || pg_temp.pick(array['Wireless','Cellular','Mobile','Phones & More','Prepaid'], pg_temp.h('p' || s.n))
              || case when s.n > 16 then ' #' || (1 + s.n / 16)::text else '' end
       end,
       s.motor, s.lifecycle,
       now() - make_interval(days => case s.lifecycle when 'onboarding' then 1 + pg_temp.h('la' || s.k) % 11
                                                       when 'prospect' then 1 + pg_temp.h('la' || s.k) % 20
                                                       else 4 + pg_temp.h('la' || s.k) % 240 end),
       s.owner,
       pg_temp.uid(case when s.market = 'MX' then (array['ter-cdmx-n','ter-cdmx-s','ter-gdl','ter-mty'])[1 + s.n % 4]
                        when s.parent = 'us-ch-1' then 'ter-nv' when s.parent = 'us-ch-2' then 'ter-md'
                        else (array['ter-nv','ter-md','ter-fl'])[1 + s.n % 3] end),
       case s.market when 'MX' then '+525500' || lpad(s.n::text, 6, '0') else '+1702555' || lpad((1000 + s.n)::text, 4, '0') end,
       case when s.market = 'MX' then (array['Gustavo A. Madero','Coyoacán','Guadalajara','Monterrey'])[1 + s.n % 4]
            when s.parent = 'us-ch-1' then 'Las Vegas' when s.parent = 'us-ch-2' then 'Baltimore'
            else (array['Las Vegas','Baltimore','Miami'])[1 + s.n % 3] end,
       case when s.market = 'MX' then (array['CDMX','CDMX','Jalisco','Nuevo León'])[1 + s.n % 4]
            when s.parent = 'us-ch-1' then 'NV' when s.parent = 'us-ch-2' then 'MD'
            else (array['NV','MD','FL'])[1 + s.n % 3] end,
       s.market,
       case s.market when 'MX' then jsonb_build_object('giro', pg_temp.pick(array['Abarrotes','Papelería','Farmacia','Ferretería','Otro'], pg_temp.h('g' || s.n)))
                     else jsonb_build_object('carriers', pg_temp.pick(array['Carrier A','Carrier A, Carrier B','Carrier B, Carrier C'], pg_temp.h('g' || s.n))) end,
       now() - make_interval(days => case s.lifecycle when 'onboarding' then 12 + pg_temp.h('la' || s.k) % 11 + pg_temp.h('age' || s.k) % 20
                                                       when 'prospect' then 21 + pg_temp.h('age' || s.k) % 30
                                                       else 4 + pg_temp.h('la' || s.k) % 240 + 6 + pg_temp.h('age' || s.k) % 24 end)
from seed_acc s;

insert into crm.account_links (child_id, parent_id, valid_from)
select id, parent_id, created_at from crm.accounts where parent_id is not null;

insert into crm.account_aliases (account_id, market_code, system, external_id, valid_from)
select a.id, a.market_code, 'sales_core', 'SC-' || a.market_code || '-' || lpad((pg_temp.h('sc' || a.id::text) % 900000 + 100000)::text, 6, '0'), a.created_at
  from crm.accounts a where a.kind = 'store' and a.lifecycle <> 'prospect'
union all
select a.id, a.market_code, 's5', 'MID-' || lpad((pg_temp.h('mid' || a.id::text) % 9000000 + 1000000)::text, 7, '0'), a.created_at
  from crm.accounts a where a.lifecycle in ('active','at_risk','inactive','onboarding');

insert into crm.contacts (id, market_code, full_name, phone, created_at)
select md5('contact:' || a.id::text)::uuid, a.market_code,
       case a.market_code when 'MX'
         then pg_temp.pick(array['Guadalupe','José Luis','María Elena','Juan Carlos','Rosa','Miguel Ángel','Patricia','Raúl','Leticia','Héctor','Silvia','Ernesto'], pg_temp.h('fn' || a.id::text)) || ' '
           || pg_temp.pick(array['Hernández','García','Martínez','López','Ramírez','Flores','Torres','Mendoza','Aguilar','Castillo'], pg_temp.h('ln' || a.id::text))
         else pg_temp.pick(array['Maria','Andre','Priya','Carlos','Denise','Omar','Grace','Victor','Lena','Marcus'], pg_temp.h('fn' || a.id::text)) || ' '
           || pg_temp.pick(array['Alvarado','Bennett','Patel','Nguyen','Foster','Haddad','Okafor','Santos','Brooks','Rivera'], pg_temp.h('ln' || a.id::text)) end,
       a.phone, a.created_at
  from crm.accounts a;
insert into crm.account_contacts (account_id, contact_id, market_code, role, valid_from)
select a.id, md5('contact:' || a.id::text)::uuid, a.market_code, case when a.kind = 'store' then 'owner' else 'decision_maker' end, a.created_at
  from crm.accounts a;

insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, effective_from)
select a.id, a.market_code, 'origin', case when pg_temp.h('or' || a.id::text) % 3 = 0 then 'form' else 'user' end,
       case when pg_temp.h('or' || a.id::text) % 3 = 0 then 'web' else coalesce(a.owner_id::text, 'import') end,
       case when pg_temp.h('or' || a.id::text) % 3 = 0 then 'Formulario web' else coalesce((select full_name from crm.users u where u.id = a.owner_id), 'Carga inicial') end,
       a.created_at from crm.accounts a
union all
select a.id, a.market_code, 'channel', 'team', a.segment, case when a.market_code = 'US' then 'Dealers East' when a.segment = 'd2d' then 'D2D Centro' else 'B2B México' end, a.created_at
  from crm.accounts a
union all
select a.id, a.market_code, 'owner', 'user', a.owner_id::text, (select full_name from crm.users u where u.id = a.owner_id), a.created_at
  from crm.accounts a where a.owner_id is not null;

-- ---------------------------------------------------------------- embudo
create temp table seed_deal on commit drop as
select a.id as account_id, a.market_code, a.lifecycle, a.kind, a.name, a.created_at, a.lifecycle_at,
       coalesce(a.owner_id, (select p.owner_id from crm.accounts p where p.id = a.parent_id)) as owner_id,
       case when a.market_code = 'US' then 'us-dealer' when a.segment = 'd2d' then 'mx-d2d' else 'mx-b2b' end as pl,
       pg_temp.h('d' || a.id::text) as r
  from crm.accounts a
 where (a.parent_id is null or a.kind <> 'store') and (a.lifecycle <> 'prospect' or pg_temp.h('hasdeal' || a.id::text) % 10 < 7);

insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, status,
                       loss_reason_code, next_step, next_step_due, decision_maker_id, decision_maker_met, revisit_needed, revisit_reason, revisit_due,
                       stage_entered_at, won_at, lost_at, closed_by, created_at)
select md5('deal:' || d.account_id::text)::uuid, d.market_code, pg_temp.uid('p-' || d.pl), st.id, d.account_id, d.owner_id,
       case d.market_code when 'US' then 'Onboarding: ' else 'Alta: ' end || d.name,
       case when d.pl = 'mx-d2d' then null when d.market_code = 'US' then (2000 + d.r % 28000) * 100 else (50000 + d.r % 750000) * 100 end,
       case d.market_code when 'US' then 'USD' else 'MXN' end,
       case st.kind when 'won' then 'won' when 'lost' then 'lost' else 'open' end,
       case when st.kind = 'lost' then pg_temp.pick(array['price','competitor','no_decision','not_qualified','no_response'], d.r) end,
       case when st.kind in ('open','awaiting_txn') and d.r % 9 <> 0 then
            pg_temp.pick(case d.market_code when 'US' then array['Call to confirm carrier documents','Send application link','Review approval status with ops']
                                            else array['Volver cuando esté el dueño','Llamar para confirmar la alta','Enviar propuesta actualizada','Revisar expediente con operaciones'] end, d.r) end,
       case when st.kind in ('open','awaiting_txn') and d.r % 9 <> 0 then current_date + (d.r % 7) - case when d.r % 6 = 0 then 4 else 0 end end,
       case when st.position >= 2 then md5('contact:' || d.account_id::text)::uuid end,
       st.position >= 2,
       st.kind = 'open' and st.position <= 2 and d.r % 5 = 0,
       case when st.kind = 'open' and st.position <= 2 and d.r % 5 = 0 then 'owner_absent' end,
       case when st.kind = 'open' and st.position <= 2 and d.r % 5 = 0 then current_date + (d.r % 5 - 1) end,
       case when st.kind in ('won','lost') then d.lifecycle_at
            when st.kind = 'awaiting_txn' then now() - make_interval(days => 1 + d.r % 5 + case when d.r % 5 = 0 then 7 else 0 end)
            else now() - make_interval(days => 1 + d.r % 6 + case when d.r % 6 = 0 then 16 else 0 end) end,
       case when st.kind = 'won' then d.lifecycle_at end, case when st.kind = 'lost' then d.lifecycle_at end,
       case when st.kind = 'won' then 'transaction' when st.kind = 'lost' then 'manual' end,
       d.created_at
  from seed_deal d
  join lateral (
    select s.* from crm.stages s
     where s.pipeline_id = pg_temp.uid('p-' || d.pl)
       and s.position = case when d.lifecycle in ('active','at_risk','inactive') then 5
                             when d.lifecycle = 'onboarding' then case when d.r % 3 = 0 then 3 else 4 end
                             when d.r % 9 = 0 then 6
                             else 1 + d.r % 3 end
  ) st on true;

insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause, at)
select d.id, d.market_code, null, d.stage_id, d.owner_id, case when d.closed_by = 'transaction' then 'transaction' else 'user' end, d.stage_entered_at
  from crm.deals d;

-- Leads de los últimos 20 días, con SLA y asignación por round robin.
insert into crm.leads (id, market_code, source, form_id, motor, business_name, contact_name, phone, locality, message, status, disqualify_code,
                       owner_id, assigned_at, sla_due_at, first_touch_at, created_at)
select pg_temp.uid('lead-' || n), x.m, case when n % 6 = 0 then 'manual' else 'web_form' end,
       case when n % 6 = 0 then null else pg_temp.uid(x.f) end, x.motor,
       case x.m when 'MX' then pg_temp.pick(array['Abarrotes','Miscelánea','Farmacia','Papelería','Ferretería'], n) || ' ' || pg_temp.pick(array['El Roble','La Paloma','San Miguel','Los Pinos','La Victoria','El Refugio','Las Flores','El Dorado','La Amistad','Santa Rosa'], pg_temp.h('lb' || n))
                else pg_temp.pick(array['Metro','Lakeside','Union','Parkway','Midtown','Eastside','Gateway'], pg_temp.h('lb' || n)) || ' ' || pg_temp.pick(array['Wireless','Mobile','Cellular'], n) end,
       case x.m when 'MX' then pg_temp.pick(array['Carmen Ortiz','Jorge Salinas','Teresa Luna','Pablo Nava','Elena Rojas','Óscar Vidal'], pg_temp.h('lc' || n))
                else pg_temp.pick(array['Alicia Ford','Ben Carter','Nadia Aziz','Luis Mora','Tasha Greene'], pg_temp.h('lc' || n)) end,
       case x.m when 'MX' then '+525511' || lpad(n::text, 6, '0') else '+1702556' || lpad(n::text, 4, '0') end,
       case x.m when 'MX' then pg_temp.pick(array['Ciudad de México','Guadalajara','Monterrey','Puebla'], n) else pg_temp.pick(array['Las Vegas','Baltimore','Miami'], n) end,
       case x.m when 'MX' then 'Quiero información para vender recargas en mi negocio.' else 'Interested in becoming a dealer.' end,
       x.st, case when x.st = 'disqualified' then pg_temp.pick(array['not_qualified','no_response','duplicate'], n) end,
       x.owner, x.created + interval '2 minutes',
       x.created + make_interval(mins => case x.m when 'MX' then 60 else 120 end),
       case when x.st <> 'new' then x.created + make_interval(mins => case x.m when 'MX' then 6 + pg_temp.h('ft' || n) % 74 else 10 + pg_temp.h('ft' || n) % 150 end) end,
       x.created
from generate_series(1, 84) n
cross join lateral (
  select case when n % 3 = 0 then 'US' else 'MX' end as m,
         case when n % 3 = 0 then 'f-us' when n % 2 = 0 then 'f-mx-b2b' else 'f-mx-d2d' end as f,
         case when n % 3 = 0 then 'dealer' when n % 2 = 0 then 'b2b' else 'd2d' end as motor,
         (array['new','new','new','contacted','contacted','qualified','qualified','disqualified','converted','contacted'])[1 + pg_temp.h('ls' || n) % 10] as st,
         case when n % 3 = 0 then (array[pg_temp.uid('sam.ortiz'), pg_temp.uid('jade.kim')])[1 + n % 2]
              when n % 2 = 0 then (array[pg_temp.uid('diana.cruz'), pg_temp.uid('ivan.rios')])[1 + (n / 2) % 2]
              else (array[pg_temp.uid('marco.pena'), pg_temp.uid('lucia.vega')])[1 + (n / 2) % 2] end as owner,
         case when pg_temp.h('ls' || n) % 10 < 3 then now() - make_interval(mins => 4 + pg_temp.h('lm' || n) % 50 + case when n % 4 = 0 then 150 else 0 end)
              else now() - make_interval(days => 1 + pg_temp.h('ld' || n) % 19, hours => n % 9) end as created
) x;

-- Actividades: tareas abiertas de cada vendedor y notas recientes.
insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, done_at, owner_id, created_by, source, created_at)
select d.market_code, d.account_id, d.id, 'task', d.next_step, (d.next_step_due + time '10:00')::timestamptz, null, d.owner_id, d.owner_id, 'user', now() - interval '3 days'
  from crm.deals d where d.status = 'open' and d.next_step is not null and d.owner_id is not null;
insert into crm.activities (market_code, account_id, kind, subject, body, done_at, owner_id, created_by, source, created_at)
select a.market_code, a.id, (array['note','call','meeting'])[1 + pg_temp.h('ak' || a.id::text) % 3],
       case a.market_code when 'US' then pg_temp.pick(array['Follow-up call','Store walkthrough','Pricing questions'], pg_temp.h('as' || a.id::text))
                          else pg_temp.pick(array['Llamada de seguimiento','Visita de presentación','Dudas sobre comisiones','Revisión de inventario'], pg_temp.h('as' || a.id::text)) end,
       case a.market_code when 'US' then 'Spoke with the manager; they asked for the product sheet.' else 'Se habló con el encargado; pidió la hoja de productos.' end,
       now() - make_interval(days => 1 + pg_temp.h('ad' || a.id::text) % 30), a.owner_id, a.owner_id, 'user',
       now() - make_interval(days => 1 + pg_temp.h('ad' || a.id::text) % 30)
  from crm.accounts a where a.owner_id is not null and pg_temp.h('act' || a.id::text) % 5 < 2;

-- Visitas de los últimos 14 días que "llegaron" de la Sales App (solo D2D México y dealers US).
insert into crm.visits (market_code, account_id, external_visit_id, salesperson_ref, user_id, business_date, checked_in_at, checked_out_at,
                        duration_seconds, outcome, rejection_code, revisit, revisit_reason, decision_maker_seen)
select a.market_code, a.id, 'SCV-' || substr(md5(a.id::text || g.d::text), 1, 12), 'SC-U-' || substr(a.owner_id::text, 1, 8), a.owner_id,
       current_date - g.d,
       ((current_date - g.d) + make_interval(hours => 9 + v.r % 8, mins => v.r % 55)) at time zone m.timezone,
       ((current_date - g.d) + make_interval(hours => 9 + v.r % 8, mins => v.r % 55 + 6 + v.r % 20)) at time zone m.timezone,
       (6 + v.r % 20) * 60,
       case when v.r % 20 < 11 then 'sale' else 'no_sale' end,
       case when v.r % 20 >= 11 then (array['owner_absent','no_cash','has_stock','not_interested','closed','owner_absent'])[1 + v.r % 6] end,
       v.r % 20 >= 11 and v.r % 6 in (0, 5),
       case when v.r % 20 >= 11 and v.r % 6 in (0, 5) then 'owner_absent' end,
       not (v.r % 20 >= 11 and v.r % 6 in (0, 5))
  from crm.accounts a
  join crm.markets m on m.code = a.market_code
  cross join generate_series(0, 13) g(d)
  cross join lateral (select pg_temp.h('v' || a.id::text || g.d::text) as r) v
 where a.kind = 'store' and a.owner_id is not null and a.parent_id is null
   and extract(isodow from current_date - g.d) < 7 and v.r % 7 = 0;

-- Agregados diarios de S5 (corte de ayer) para lo que ya transacciona.
insert into crm.ingest_batches (id, source, as_of, file_name, checksum, row_count, matched)
select pg_temp.uid('batch-seed'), 's5', current_date - 1, 'merchant_metrics_daily_' || to_char(current_date - 1, 'YYYYMMDD') || '.csv',
       md5('seed' || current_date::text), count(*), count(*) from crm.accounts where lifecycle in ('active','at_risk','inactive');
insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d, batch_id)
select a.id, current_date - 1, a.market_code, a.lifecycle_at,
       case a.lifecycle when 'active' then now() - make_interval(days => x.r % 3) when 'at_risk' then now() - make_interval(days => 12 + x.r % 10) else now() - make_interval(days => 35 + x.r % 40) end,
       case a.lifecycle when 'active' then 40 + x.r % 260 when 'at_risk' then 2 + x.r % 9 else 0 end,
       case a.lifecycle when 'active' then (40 + x.r % 260) * (case a.market_code when 'US' then 2200 else 6500 end)::bigint
                        when 'at_risk' then (2 + x.r % 9) * (case a.market_code when 'US' then 2200 else 6500 end)::bigint else 0 end,
       case a.market_code when 'US' then 'USD' else 'MXN' end,
       case a.lifecycle when 'active' then 14 + x.r % 16 when 'at_risk' then 1 + x.r % 4 else 0 end,
       pg_temp.uid('batch-seed')
  from crm.accounts a cross join lateral (select pg_temp.h('mm' || a.id::text) as r) x
 where a.lifecycle in ('active','at_risk','inactive');

insert into crm.saved_views (user_id, object, name, filters, is_shared) values
  (pg_temp.uid('nora.salas'), 'account', 'En riesgo', '{"lifecycle":"at_risk"}', true),
  (pg_temp.uid('nora.salas'), 'account', 'Sin dueño', '{"owner":"none"}', true),
  (pg_temp.uid('nora.salas'), 'account', 'Esperando primera venta', '{"lifecycle":"onboarding"}', true);

-- Las personas de prueba ya pasaron por la bienvenida: entran directo a Hoy. La prueba del primer ingreso borra su fila antes de entrar.
insert into crm.user_onboarding (user_id) select id from crm.users where is_synthetic on conflict do nothing;

-- b2b
-- El embudo B2B/ISO de México trae las etapas del proceso corporativo que pidió el comité: después de negociar vienen
-- integración, pruebas, certificación y alta y capacitación. En producción las agrega administración desde la pantalla.
update crm.stages set position = position + 4 where pipeline_id = pg_temp.uid('p-mx-b2b') and position >= 4;
insert into crm.stages (id, pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en) values
  (pg_temp.uid('s-mx-b2b-integracion'), pg_temp.uid('p-mx-b2b'), 4, 'integracion', 'Integración', 'Integration', 'open', 65, 30, '{amount,decision_maker}', 'Credenciales entregadas y conexión hecha', 'Credentials delivered and connection made'),
  (pg_temp.uid('s-mx-b2b-pruebas'), pg_temp.uid('p-mx-b2b'), 5, 'pruebas', 'Pruebas', 'Testing', 'open', 70, 21, '{}', 'Pruebas completas sin errores', 'Tests complete with no errors'),
  (pg_temp.uid('s-mx-b2b-certificacion'), pg_temp.uid('p-mx-b2b'), 6, 'certificacion', 'Certificación', 'Certification', 'open', 75, 21, '{}', 'Certificación aprobada', 'Certification approved'),
  (pg_temp.uid('s-mx-b2b-alta'), pg_temp.uid('p-mx-b2b'), 7, 'alta', 'Alta y capacitación', 'Go-live and training', 'open', 80, 14, '{}', 'Cuenta dada de alta y equipo capacitado', 'Account live and team trained');
-- El formulario web B2B pide lo mínimo para calificar.
update crm.web_forms set ask_fields = '{b2b_points_of_sale,b2b_monthly_volume,b2b_integration}' where id = pg_temp.uid('f-mx-b2b');
