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
  ('mx-d2d', 2, 'interes', 'Interés de quien decide', 'Decision-maker interested', 'open', 35, 10, '{decision_maker}', 'Quien decide confirmó interés', 'The decision-maker confirmed interest'),
  ('mx-d2d', 3, 'alta', 'Alta iniciada', 'Enrollment started', 'open', 60, 7, '{decision_maker,next_step}', 'Expediente completo en la Sales App', 'File complete in the Sales App'),
  ('mx-d2d', 4, 'espera', 'Esperando primera venta', 'Awaiting first sale', 'awaiting_txn', 85, 14, '{}', 'S5 reporta la primera transacción', 'S5 reports the first transaction'),
  ('mx-d2d', 5, 'ganada', 'Activa', 'Active', 'won', 100, 0, '{}', '', ''),
  ('mx-d2d', 6, 'perdida', 'Perdida', 'Lost', 'lost', 0, 0, '{}', '', ''),
  ('mx-b2b', 1, 'calificacion', 'Calificación', 'Qualification', 'open', 10, 14, '{}', 'Tamaño de red y quien decide, identificados', 'Network size and decision-maker identified'),
  ('mx-b2b', 2, 'propuesta', 'Propuesta', 'Proposal', 'open', 30, 14, '{amount}', 'Propuesta enviada con volumen esperado', 'Proposal sent with expected volume'),
  ('mx-b2b', 3, 'negociacion', 'Negociación', 'Negotiation', 'open', 55, 21, '{amount,decision_maker,next_step}', 'Términos acordados con quien decide', 'Terms agreed with the decision-maker'),
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

-- operaciones
-- Etapas de Operaciones en el alta de dealers de US: al entrar a carriers, el negocio pasa a la cola de Operaciones.
update crm.stages set is_ops = true where pipeline_id = pg_temp.uid('p-us-dealer') and code in ('carrier', 'awaiting');
-- Embudo de pedidos de US: varios negocios abiertos por comercio, con líneas de producto; se gana a mano.
insert into crm.pipelines (id, market_code, motor, name, position, close_by_transaction, multi_open, has_items) values
  (pg_temp.uid('p-us-orders'), 'US', 'orders', 'Sales orders', 2, false, true, true);
insert into crm.stages (id, pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en, is_ops)
select pg_temp.uid('s-us-orders-' || c), pg_temp.uid('p-us-orders'), pos, c, es, en, k, pr, rot, req::text[], xes, xen, ops from (values
  (1, 'captured', 'Pedido capturado', 'Order captured', 'open', 40, 7, '{}', 'Pedido con sus líneas', 'Order with its lines', false),
  (2, 'review', 'Revisión de Operaciones', 'Operations review', 'open', 70, 5, '{items}', 'Operaciones confirma y surte', 'Operations confirms and fulfills', true),
  (3, 'fulfilled', 'Surtido', 'Fulfilled', 'won', 100, 0, '{}', '', '', false),
  (4, 'lost', 'Cancelado', 'Cancelled', 'lost', 0, 0, '{}', '', '', false)
) v(pos, c, es, en, k, pr, rot, req, xes, xen, ops);
insert into crm.products (id, name, code, unit, market_code, unit_price_minor) values
  (pg_temp.uid('prod-us-sim'), 'SIM kit', 'OPS-SIM', 'unit', 'US', 250),
  (pg_temp.uid('prod-us-topup'), 'Top-up card pack', 'OPS-TOPUP', 'pack', 'US', 4500),
  (pg_temp.uid('prod-us-pos'), 'Counter terminal', 'OPS-POS', 'unit', 'US', 12900),
  (pg_temp.uid('prod-mx-chip'), 'Chip prepago', 'OPS-CHIP', 'pieza', 'MX', 3500),
  (pg_temp.uid('prod-mx-term'), 'Terminal de mostrador', 'OPS-TERM', 'pieza', 'MX', 189900);
insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position) values
  ('US', 'provider', 'carrier_north', 'Operador Norte', 'North carrier', 1),
  ('US', 'provider', 'carrier_coast', 'Operador Costa', 'Coast carrier', 2),
  ('MX', 'provider', 'red_centro', 'Red Centro', 'Central network', 1),
  ('US', 'document', 'application', 'Solicitud firmada', 'Signed application', 1),
  ('US', 'document', 'address_proof', 'Comprobante de domicilio', 'Proof of address', 2),
  ('US', 'document', 'reseller_permit', 'Permiso de revendedor', 'Reseller permit', 3),
  ('MX', 'document', 'solicitud', 'Solicitud firmada', 'Signed application', 1),
  ('MX', 'document', 'domicilio', 'Comprobante de domicilio', 'Proof of address', 2);
insert into crm.field_definitions (object, key, label_es, label_en, data_type, options, market_code, data_class) values
  -- "Tipo de cuenta" es el del comercio (catálogo crm.account_types, paquete b2b). Lo que Operaciones anota en el negocio es
  -- cómo opera la cuenta del dealer (ACH o prepago): lleva otro nombre para que no haya dos cosas llamadas igual.
  ('deal', 'account_funding', 'Cuenta ACH o prepago', 'ACH or prepaid account', 'select', '["ACH","Prepaid"]', 'US', 'internal');

-- liderazgo
-- Ventas de S5 de 30 días antes (corte de hace 31 días) para una parte de los comercios activos: así la ficha y Mi equipo
-- pueden comparar contra los 30 días anteriores. El resto no trae ese archivo, y la pantalla lo dice en vez de inventarlo.
insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d)
select mm.account_id, current_date - 31, mm.market_code, mm.first_txn_at, now() - interval '31 days',
       greatest(1, mm.txn_count_30d - 30 + x.r % 61),
       greatest(1, mm.txn_count_30d - 30 + x.r % 61) * (case mm.market_code when 'US' then 2200 else 6500 end)::bigint,
       mm.currency, least(30, greatest(1, mm.active_days_30d - 3 + x.r % 7))
  from crm.merchant_metrics_daily mm join crm.accounts a on a.id = mm.account_id
  cross join lateral (select pg_temp.h('prev' || mm.account_id::text) as r) x
 where a.lifecycle = 'active' and mm.first_txn_at < now() - interval '45 days' and x.r % 3 = 0;

-- vocabulario
-- El criterio de salida de la etapa que espera la primera venta habla de los datos de ventas, no del nombre interno del sistema.
update crm.stages set exit_es = 'Los datos de ventas traen la primera transacción', exit_en = 'The sales data shows the first transaction'
 where exit_es = 'S5 reporta la primera transacción';

-- ajustes-campo
-- La entrega a Operaciones pide lo mínimo: en el alta de dealers de US, la primera etapa de Operaciones pide monto y "Cuenta ACH o prepago".
update crm.stages set required_fields = '{next_step,amount,field:account_funding}'
 where pipeline_id = pg_temp.uid('p-us-dealer') and code = 'carrier';
-- La lista de alta (documentos, proveedores, capacitación) no aplica a los embudos de pedidos o recompra.
update crm.pipelines set ops_checklist = false where multi_open;
-- Una tienda de cada persona de tiendas en México con dirección, para que "Cómo llegar" se pueda ver (dirección inventada).
update crm.accounts a set address_line = 'Av. Principal 120, Centro', postal_code = '64000'
 where a.id in (select distinct on (x.owner_id) x.id from crm.accounts x
                 where x.market_code = 'MX' and x.kind = 'store' and x.archived_at is null
                   and x.owner_id in (pg_temp.uid('lucia.vega'), pg_temp.uid('marco.pena'))
                 order by x.owner_id, x.name, x.id);

-- reportes
-- Vistas compartidas de fábrica (UX-03). Reconstruyen, con los campos que existen en CONTIGO, los filtros que el equipo
-- hizo en Pipedrive: negocios sin persona ("US Dealer Enrollment - deals without rep", "Open (No Sales Contact)"), negocios
-- abiertos sin actividad próxima ("Open no activity", "Open (No Last Activity Date)") y organizaciones de US ("US - Organizations").
insert into crm.saved_views (user_id, object, name, filters, is_shared) values
  (pg_temp.uid('nora.salas'), 'deal', 'Negocios sin persona asignada', jsonb_build_object('pipeline', pg_temp.uid('p-us-dealer')::text, 'owner', 'none', 'vista', 'lista'), true),
  (pg_temp.uid('nora.salas'), 'deal', 'Negocios abiertos sin próximo paso', jsonb_build_object('pipeline', pg_temp.uid('p-us-dealer')::text, 'paso', 'sin', 'vista', 'lista'), true),
  (pg_temp.uid('nora.salas'), 'account', 'Organizaciones de US', '{"market":"US","kind":"organization"}', true),
  (pg_temp.uid('nora.salas'), 'lead', 'Leads sin persona asignada', '{"owner":"none","status":"open"}', true),
  (pg_temp.uid('nora.salas'), 'activity', 'Tareas del equipo', '{"view":"team"}', true);
-- En CONTIGO "dueño" es solo el del comercio: la vista de fábrica de comercios sin persona se llama como el resto del producto.
update crm.saved_views set name = 'Sin persona asignada' where name = 'Sin dueño' and is_shared;
-- Los filtros de negocios perdidos de Pipedrive ("Lost", "Lost no response") viven como reporte guardado y compartido.
insert into crm.saved_reports (user_id, report, name, params, is_shared, market_code) values
  (pg_temp.uid('nora.salas'), 'cerrados', 'Negocios perdidos del mes en US', '{"periodo":"mes","mercado":"US","resultado":"lost"}', true, 'US');
-- Foto diaria de los últimos 14 días (sintética, a partir de lo abierto hoy) para que el histórico tenga con qué dibujarse.
insert into crm.pipeline_snapshots (snapshot_date, market_code, pipeline_id, stage_id, deals, no_next_step, amount_minor, currency)
select (now() at time zone mk.timezone)::date - g.n, p.market_code, p.id, s.id,
       greatest(0, count(d.id)::int + (pg_temp.h('snap' || s.id::text || g.n::text) % 5) - 2),
       count(d.id) filter (where d.next_step is null or d.next_step_due is null)::int, coalesce(sum(d.amount_minor), 0), mk.currency
  from crm.pipelines p join crm.stages s on s.pipeline_id = p.id and s.kind in ('open', 'awaiting_txn')
  join crm.markets mk on mk.code = p.market_code and mk.status = 'live'
  cross join generate_series(1, 14) g(n)
  left join crm.deals d on d.stage_id = s.id and d.status = 'open'
 group by 1, 2, 3, 4, g.n, mk.currency;
insert into crm.portfolio_snapshots (snapshot_date, market_code, lifecycle, accounts)
select (now() at time zone mk.timezone)::date - g.n, a.market_code, a.lifecycle, count(*)::int
  from crm.accounts a join crm.markets mk on mk.code = a.market_code and mk.status = 'live' cross join generate_series(1, 14) g(n)
 where a.archived_at is null and a.kind = 'store' group by 1, 2, 3;
-- datos
-- Dos árboles de tres niveles reales, con nombres inventados: un ISO con su agente y sus puntos de venta (US) y una cadena con
-- su región y sus sucursales (MX). Así la jerarquía de N niveles se ve en pantalla, con sus totales por nodo.
insert into crm.accounts (id, market_code, legal_entity_id, parent_id, kind, account_type, name, segment, lifecycle, lifecycle_at, owner_id, phone, locality, region, country, created_at)
select pg_temp.uid(k), m, pg_temp.uid(case m when 'MX' then 'le-mx' else 'le-us' end), case when par is null then null else pg_temp.uid(par) end, kind, ty, nm, seg, lc,
       now() - interval '20 days', pg_temp.uid(o), ph, loc, reg, m, now() - make_interval(days => age)
from (values
  ('dat-us-iso',    'US', null,           'distributor', 'iso',       'Lone Star Payments ISO',        'dealer', 'active',     'sam.ortiz',  '+12105550140', 'San Antonio', 'TX', 200),
  ('dat-us-agent',  'US', 'dat-us-iso',   'distributor', 'iso_agent', 'Rio Grande Agents',             'dealer', 'active',     'sam.ortiz',  '+12105550141', 'Laredo',      'TX', 150),
  ('dat-us-pdv-1',  'US', 'dat-us-agent', 'store',       'branch',    'Frontera Wireless Laredo',      'dealer', 'active',     'sam.ortiz',  '+19565550142', 'Laredo',      'TX', 90),
  ('dat-us-pdv-2',  'US', 'dat-us-agent', 'store',       'branch',    'Frontera Wireless Eagle Pass',  'dealer', 'onboarding', 'sam.ortiz',  '+18305550143', 'Eagle Pass',  'TX', 30),
  ('dat-mx-chain',  'MX', null,           'chain',       'chain',     'Súper La Colmena',          'b2b',    'active',     'diana.cruz', '+524775550150', 'León',       'Guanajuato', 220),
  ('dat-mx-region', 'MX', 'dat-mx-chain', 'chain',       'region',    'Súper La Colmena Región Bajío',       'b2b',    'active',     'diana.cruz', '+524775550151', 'León',       'Guanajuato', 180),
  ('dat-mx-suc-1',  'MX', 'dat-mx-region','store',       'branch',    'Súper La Colmena Sucursal Centro',    'b2b',    'active',     'diana.cruz', '+524775550152', 'León',       'Guanajuato', 120),
  ('dat-mx-suc-2',  'MX', 'dat-mx-region','store',       'branch',    'Súper La Colmena Sucursal Irapuato',  'b2b',    'onboarding', 'diana.cruz', '+524625550153', 'Irapuato',   'Guanajuato', 25)
) v(k, m, par, kind, ty, nm, seg, lc, o, ph, loc, reg, age);
insert into crm.account_links (child_id, parent_id, valid_from)
select a.id, a.parent_id, a.created_at from crm.accounts a where a.id in (pg_temp.uid('dat-us-agent'), pg_temp.uid('dat-us-pdv-1'), pg_temp.uid('dat-us-pdv-2'), pg_temp.uid('dat-mx-region'), pg_temp.uid('dat-mx-suc-1'), pg_temp.uid('dat-mx-suc-2'));
insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, effective_from)
select a.id, a.market_code, l.layer, 'user', a.owner_id::text, u.full_name, a.created_at
  from crm.accounts a join crm.users u on u.id = a.owner_id cross join (values ('origin'), ('owner')) l(layer)
 where a.id in (pg_temp.uid('dat-us-iso'), pg_temp.uid('dat-us-agent'), pg_temp.uid('dat-us-pdv-1'), pg_temp.uid('dat-us-pdv-2'), pg_temp.uid('dat-mx-chain'), pg_temp.uid('dat-mx-region'), pg_temp.uid('dat-mx-suc-1'), pg_temp.uid('dat-mx-suc-2'));
-- Cada producto del catálogo de ejemplo con su proveedor, y el plazo de respuesta de los operadores de US (cuatro semanas).
update crm.products p set provider_id = k.id from crm.ops_catalog k
 where k.kind = 'provider' and ((p.id = pg_temp.uid('prod-us-sim') and k.code = 'carrier_north') or (p.id = pg_temp.uid('prod-us-topup') and k.code = 'carrier_coast')
    or (p.id = pg_temp.uid('prod-mx-chip') and k.code = 'red_centro'));
update crm.ops_catalog set sla_days = 28 where kind = 'provider' and market_code = 'US';
-- Productos de los dos puntos de venta del ISO: uno activo y uno enviado al proveedor hace más de cuatro semanas (fuera de plazo).
insert into crm.account_products (account_id, market_code, product_id, provider_id, status, requested_at, submitted_at, decided_at, activated_at, status_at)
select pg_temp.uid(acc), 'US', pg_temp.uid(prod), (select id from crm.ops_catalog where kind = 'provider' and code = prov), st,
       now() - make_interval(days => req), case when sub is null then null else now() - make_interval(days => sub) end,
       case when st = 'active' then now() - interval '50 days' end, case when st = 'active' then now() - interval '45 days' end,
       now() - make_interval(days => coalesce(sub, req))
from (values
  ('dat-us-pdv-1', 'prod-us-sim',   'carrier_north', 'active',    80, 70),
  ('dat-us-pdv-1', 'prod-us-topup', 'carrier_coast', 'submitted', 40, 35),
  ('dat-us-pdv-2', 'prod-us-sim',   'carrier_north', 'submitted', 12, 10)
) v(acc, prod, prov, st, req, sub);
-- Una lista de proceso de ejemplo en México: la capacitación del comercio, al lado del embudo.
insert into crm.process_lists (id, market_code, code, name_es, name_en, statuses, attributes) values
  (pg_temp.uid('dat-proc-mx-training'), 'MX', 'merchant_training', 'Capacitación del comercio', 'Merchant training',
   '[{"code":"to_schedule","es":"Por agendar","en":"To schedule"},{"code":"scheduled","es":"Agendada","en":"Scheduled"},{"code":"completed","es":"Completada","en":"Completed"}]'::jsonb,
   '[{"key":"session_date","es":"Fecha de la sesión","en":"Session date"}]'::jsonb);
insert into crm.process_memberships (list_id, account_id, market_code, status, attrs)
values (pg_temp.uid('dat-proc-mx-training'), pg_temp.uid('dat-mx-suc-2'), 'MX', 'to_schedule', '{}'::jsonb);
-- us-embudo
-- Alta de dealers de US con sus nueve etapas (E10.F1): Lead, Contacted, Presented, Sales Qualified, Docs & Contract,
-- Approvals, Provisioned & Settlement Ready, Onboarding & Training y Won (primera transacción). La aprobación por proveedor
-- se lleva aparte, no es etapa (E10.F2). Las etapas que ya existían conservan su código: solo cambian de nombre y de lugar.
update crm.stages set position = position + 100 where pipeline_id = pg_temp.uid('p-us-dealer');
update crm.stages s set position = v.pos, name_es = v.es, name_en = v.en, probability = v.pr, rot_days = v.rot, exit_es = v.xes, exit_en = v.xen
  from (values
    ('qualified', 4, 'Calificado para venta', 'Sales Qualified', 45, 14, 'Reúne documentos y contrato', 'Collect documents and contract'),
    ('application', 5, 'Documentos y contrato', 'Docs & Contract', 60, 10, 'Contrato firmado y enviado, con productos y tipo de cuenta', 'Contract signed and submitted, with products and account type'),
    ('carrier', 6, 'Aprobaciones', 'Approvals', 70, 28, 'Operaciones aprueba y provisiona', 'Operations approves and provisions'),
    ('awaiting', 8, 'Alta y capacitación', 'Onboarding & Training', 90, 21, 'Los datos de ventas traen la primera transacción', 'The sales data shows the first transaction'),
    ('won', 9, 'Ganado (primera transacción)', 'Won (first transaction)', 100, 0, '', ''),
    ('lost', 10, 'Perdido', 'Lost', 0, 0, '', '')
  ) v(code, pos, es, en, pr, rot, xes, xen)
 where s.pipeline_id = pg_temp.uid('p-us-dealer') and s.code = v.code;
insert into crm.stages (id, pipeline_id, position, code, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en, is_ops)
select pg_temp.uid('s-us-dealer-' || c), pg_temp.uid('p-us-dealer'), pos, c, es, en, 'open', pr, rot, '{}', xes, xen, ops from (values
  (1, 'lead', 'Lead', 'Lead', 5, 7, 'Primer contacto con la tienda', 'First contact with the store', false),
  (2, 'contacted', 'Contactado', 'Contacted', 15, 10, 'Presentación hecha a quien decide', 'Presentation made to the decision-maker', false),
  (3, 'presented', 'Presentado', 'Presented', 30, 14, 'La tienda confirma interés y se completa la investigación', 'The store confirms interest and the research is complete', false),
  (7, 'provisioned', 'Provisionado y listo para liquidar', 'Provisioned & Settlement Ready', 80, 14, 'Cuenta creada y lista para operar', 'Account created and ready to operate', true)
) v(pos, c, es, en, pr, rot, xes, xen, ops);
-- Un servicio nuevo que se le vende a la misma tienda es su propio negocio (E10.F3): el embudo admite varios abiertos por comercio.
update crm.pipelines set multi_open = true, ops_lead_id = pg_temp.uid('tom.reyes') where id = pg_temp.uid('p-us-dealer');

-- Campos del negocio de alta de dealers (solo este tipo de venta). Las listas traen "None/Unknown" para poder decir "no sé".
update crm.field_definitions set data_type = 'multiselect', motor = 'dealer',
       options = '["Cash on-ramp","Domestic top-up","International top-up","SIM activation","Gift cards","Bill pay","Handset financing"]'
 where object = 'deal' and key = 'products_requested' and market_code = 'US';
update crm.field_definitions set motor = 'dealer', options = '["ACH","Prepaid/Wallet"]' where object = 'deal' and key = 'account_funding' and market_code = 'US';
insert into crm.field_definitions (object, key, label_es, label_en, data_type, options, market_code, data_class, motor, position)
select 'deal', v.key, v.es, v.en, v.dt, v.opts::jsonb, 'US', 'internal', 'dealer', 100 + v.pos from (values
  (1, 'interest_level', 'Nivel de interés', 'Interest Level', 'select', '["High","Medium","Low","None/Unknown"]'),
  (2, 'services_offered_today', 'Servicios que ofrece hoy', 'Services Offered Today', 'multiselect', '["Top-ups","Bill pay","Money transfers","SIM activation","Gift cards","Check cashing","None/Unknown"]'),
  (3, 'competitor_portals_used', 'Portales de la competencia que usa', 'Competitor Portals Used', 'multiselect', '["North portal","Coast portal","Other","None/Unknown"]'),
  (4, 'remittance_brands_offered', 'Marcas de remesas que ofrece', 'Remittance Brands Offered', 'multiselect', '["Remesas Norte","Remesas Costa","Other","None/Unknown"]'),
  (5, 'primary_remittance_corridor', 'Corredor principal de remesas', 'Primary Remittance Corridor', 'select', '["Mexico","Guatemala","El Salvador","Honduras","Dominican Republic","Colombia","Other","None/Unknown"]'),
  (6, 'topup_destinations_served', 'Destinos de recarga que atiende', 'Top-Up Destinations Served', 'multiselect', '["Mexico","Guatemala","El Salvador","Honduras","Dominican Republic","Colombia","Other","None/Unknown"]'),
  (7, 'primary_remittance_provider', 'Proveedor principal de remesas', 'Primary Remittance Provider', 'select', '["Remesas Norte","Remesas Costa","Other","None/Unknown"]'),
  (8, 'remittance_frequency', 'Frecuencia de remesas', 'Remittance Frequency', 'select', '["Daily","Weekly","Monthly","Rarely","None/Unknown"]'),
  (9, 'business_bank_account', 'Tiene cuenta del negocio en un banco', 'Business Bank Account', 'select', '["Yes","No","Unknown"]'),
  (10, 'top_carriers_by_volume', 'Proveedores con más volumen', 'Top Carriers by Volume', 'multiselect', '["North carrier","Coast carrier","Other","None/Unknown"]'),
  (11, 'monthly_topup_volume', 'Volumen mensual de recargas', 'Monthly Top-Up Volume', 'select', '["Under $1,000","$1,000 to $5,000","$5,000 to $20,000","Over $20,000","None/Unknown"]'),
  (12, 'monthly_remittance_volume', 'Volumen mensual de remesas', 'Monthly Remittance Volume', 'select', '["Under $5,000","$5,000 to $25,000","$25,000 to $100,000","Over $100,000","None/Unknown"]'),
  (13, 'foot_traffic', 'Afluencia de clientes', 'Foot Traffic', 'select', '["High","Medium","Low","None/Unknown"]'),
  (14, 'customer_communities', 'Comunidades que atiende', 'Customer Communities Served', 'multiselect', '["Mexico","Guatemala","El Salvador","Honduras","Dominican Republic","Colombia","Other","None/Unknown"]'),
  (15, 'counter_equipment', 'Equipo en el mostrador', 'Counter Equipment', 'multiselect', '["Computer","Tablet","Phone only","Receipt printer","None/Unknown"]'),
  (16, 'store_hours', 'Horario de la tienda', 'Store Hours', 'text', '[]'),
  (17, 'clerks_at_counter', 'Personas en el mostrador', 'Clerks at the Counter', 'number', '[]'),
  (18, 'pain_points', 'Qué le duele hoy', 'Current Pain Points', 'long_text', '[]'),
  (19, 'contract_signed_on', 'Contrato firmado y enviado', 'Contract signed & submitted', 'date', '[]'),
  (20, 'ops_daily_limit', 'Límite diario (USD)', 'Daily limit (USD)', 'number', '[]'),
  (21, 'ops_requested_credit_line', 'Línea de crédito solicitada (USD)', 'Requested credit line (USD)', 'number', '[]')
) v(pos, key, es, en, dt, opts);

-- Candados (E10.F5, F6, F8, F9) y campos destacados sin exigirlos (E10.F7, F14).
update crm.stages s set required_fields = v.req::text[], highlight_fields = v.hi::text[]
  from (values
    ('lead', '{}', '{}'),
    ('contacted', '{}', '{decision_maker,field:interest_level,field:services_offered_today,field:competitor_portals_used,field:remittance_brands_offered}'),
    ('presented', '{field:interest_level,field:services_offered_today,field:competitor_portals_used,field:remittance_brands_offered}',
                  '{field:primary_remittance_corridor,field:topup_destinations_served,field:primary_remittance_provider,field:remittance_frequency,field:business_bank_account,field:top_carriers_by_volume,field:monthly_topup_volume,field:monthly_remittance_volume,field:foot_traffic,field:customer_communities,field:counter_equipment,field:store_hours,field:clerks_at_counter,field:pain_points}'),
    ('qualified', '{field:primary_remittance_corridor,field:topup_destinations_served,field:primary_remittance_provider,field:remittance_frequency,field:business_bank_account,field:top_carriers_by_volume}', '{decision_maker}'),
    ('application', '{decision_maker,next_step,field:products_requested,field:account_funding}', '{field:contract_signed_on,amount}'),
    ('carrier', '{next_step,amount,field:contract_signed_on,field:products_requested,field:account_funding}', '{field:ops_daily_limit,field:ops_requested_credit_line}'),
    ('provisioned', '{}', '{field:ops_daily_limit,field:ops_requested_credit_line}'),
    ('awaiting', '{}', '{}')
  ) v(code, req, hi)
 where s.pipeline_id = pg_temp.uid('p-us-dealer') and s.code = v.code;

-- Los negocios de ejemplo se reparten también en las etapas nuevas, y cada uno trae lo que su etapa ya pidió.
with early as (
  select d.id, row_number() over (order by d.id) as rn from crm.deals d
   where d.pipeline_id = pg_temp.uid('p-us-dealer') and d.status = 'open'
     and d.stage_id in (pg_temp.uid('s-us-dealer-qualified'), pg_temp.uid('s-us-dealer-application')))
update crm.deals d set stage_id = pg_temp.uid('s-us-dealer-' || (array['lead','contacted','presented','qualified','application','application'])[1 + (e.rn - 1) % 6])
  from early e where e.id = d.id;
update crm.deals d set stage_id = pg_temp.uid('s-us-dealer-provisioned')
 where d.pipeline_id = pg_temp.uid('p-us-dealer') and d.stage_id = pg_temp.uid('s-us-dealer-carrier') and pg_temp.h('prov' || d.id::text) % 3 = 0;
update crm.deal_stage_events e set to_stage_id = d.stage_id from crm.deals d
 where d.id = e.deal_id and d.pipeline_id = pg_temp.uid('p-us-dealer') and e.from_stage_id is null and e.to_stage_id <> d.stage_id;
update crm.deals d set custom = d.custom
    || case when s.position >= 3 then jsonb_build_object(
         'interest_level', pg_temp.pick(array['High','Medium','Low'], pg_temp.h('uf' || d.id::text)),
         'services_offered_today', jsonb_build_array(pg_temp.pick(array['Top-ups','Bill pay','Money transfers'], pg_temp.h('uf' || d.id::text)), 'SIM activation'),
         'competitor_portals_used', jsonb_build_array(pg_temp.pick(array['North portal','Coast portal','None/Unknown'], pg_temp.h('uf' || d.id::text))),
         'remittance_brands_offered', jsonb_build_array(pg_temp.pick(array['Remesas Norte','Remesas Costa','None/Unknown'], (pg_temp.h('uf' || d.id::text) + 1)))) else '{}'::jsonb end
    || case when s.position >= 4 then jsonb_build_object(
         'primary_remittance_corridor', pg_temp.pick(array['Mexico','Guatemala','El Salvador','Honduras'], pg_temp.h('uf' || d.id::text)),
         'topup_destinations_served', jsonb_build_array(pg_temp.pick(array['Mexico','Guatemala','El Salvador','Honduras'], pg_temp.h('uf' || d.id::text)), 'Dominican Republic'),
         'primary_remittance_provider', pg_temp.pick(array['Remesas Norte','Remesas Costa','None/Unknown'], pg_temp.h('uf' || d.id::text)),
         'remittance_frequency', pg_temp.pick(array['Daily','Weekly','Monthly'], pg_temp.h('uf' || d.id::text)),
         'business_bank_account', pg_temp.pick(array['Yes','Yes','Unknown'], pg_temp.h('uf' || d.id::text)),
         'top_carriers_by_volume', jsonb_build_array(pg_temp.pick(array['North carrier','Coast carrier'], pg_temp.h('uf' || d.id::text)))) else '{}'::jsonb end
    || case when s.position >= 5 then jsonb_build_object(
         'products_requested', jsonb_build_array('Domestic top-up', pg_temp.pick(array['SIM activation','Bill pay','International top-up'], pg_temp.h('uf' || d.id::text))),
         'account_funding', pg_temp.pick(array['ACH','Prepaid/Wallet'], pg_temp.h('uf' || d.id::text))) else '{}'::jsonb end
    || case when s.position >= 6 then jsonb_build_object('contract_signed_on', to_char(coalesce(d.stage_entered_at, now()) - interval '1 day', 'YYYY-MM-DD')) else '{}'::jsonb end
  from crm.stages s
 where s.id = d.stage_id and d.pipeline_id = pg_temp.uid('p-us-dealer') and s.kind <> 'lost' and s.position >= 3;
-- Lo que ya está con Operaciones tiene responsable de Operaciones (E10.F10): quien lidera Operaciones de este embudo.
update crm.deals d set ops_owner_id = pg_temp.uid('tom.reyes'), ops_entered_at = coalesce(d.ops_entered_at, d.stage_entered_at)
  from crm.stages s where s.id = d.stage_id and s.is_ops and d.pipeline_id = pg_temp.uid('p-us-dealer') and d.status = 'open' and d.ops_owner_id is null;

-- Catálogos de US que la migración 0024 carga cuando el mercado ya existe (aquí el mercado nace con el seed).
insert into crm.visit_reasons (market_code, code, label_es, label_en, is_campaign, position) values
  ('US', 'prospecting', 'Prospección o primera visita', 'Prospecting or first visit', false, 1),
  ('US', 'follow_up', 'Seguimiento', 'Follow-up', false, 2),
  ('US', 'documents', 'Documentos y contrato', 'Documents and contract', false, 3),
  ('US', 'training', 'Capacitación', 'Training', false, 4),
  ('US', 'delivery', 'Entrega de material o producto', 'Material or product drop-off', false, 5),
  ('US', 'support', 'Soporte o problema del comercio', 'Support or store issue', false, 6),
  ('US', 'campaign', 'Campaña o promoción', 'Campaign or promotion', true, 7),
  ('US', 'relationship', 'Visita de relación', 'Relationship visit', false, 8)
on conflict do nothing;
insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position, is_active) values
  ('US', 'return_reason', 'docs_missing', 'Faltan documentos', 'Documents missing', 1, true),
  ('US', 'return_reason', 'not_signed', 'Contrato sin firmar', 'Contract not signed', 2, true),
  ('US', 'return_reason', 'entity_mismatch', 'Los datos de la entidad no coinciden', 'Entity details mismatch', 3, true),
  ('US', 'return_reason', 'duplicate_merchant', 'Comercio duplicado', 'Duplicate merchant', 4, true),
  ('US', 'return_reason', 'merchant_withdrew', 'El comercio desistió', 'Merchant withdrew', 5, true),
  ('US', 'return_reason', 'docs_expired', 'Documentos vencidos', 'Documents expired', 6, true),
  ('US', 'return_reason', 'data_incomplete', 'Datos incompletos o incorrectos', 'Details are incomplete or wrong', 7, false),
  ('US', 'return_reason', 'other', 'Otro motivo', 'Another reason', 9, false),
  ('US', 'document', 'sellers_permit', 'Permiso de vendedor (seller''s permit)', 'Seller''s permit', 11, true),
  ('US', 'document', 'drivers_license', 'Licencia de conducir', 'Driver''s license', 12, true),
  ('US', 'document', 'voided_check', 'Cheque anulado', 'Voided check', 13, true),
  ('US', 'document', 'premises_photo', 'Foto del local', 'Premises photo', 14, true)
on conflict do nothing;
-- El permiso de revendedor del catálogo de ejemplo es el mismo documento que el permiso de vendedor: queda uno solo.
update crm.ops_catalog set is_active = false where market_code = 'US' and kind = 'document' and code = 'reseller_permit';

-- Pedidos históricos de ejemplo (E11.F5): dos pedidos ya surtidos por comercio activo de una parte de la cartera de US,
-- con sus líneas y sus datos de envío, para que la ficha diga cuándo fue el último pedido.
insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, status, stage_entered_at, won_at, closed_by, created_at)
select md5('order:' || a.id::text || g.n)::uuid, 'US', pg_temp.uid('p-us-orders'), pg_temp.uid('s-us-orders-fulfilled'), a.id, a.owner_id,
       'Order ' || to_char(now() - make_interval(days => 42 + g.n * 35 + x.r % 9), 'YYYY-MM-DD') || ': ' || a.name,
       (40 + x.r % 60) * 250, 'USD', 'won', now() - make_interval(days => 40 + g.n * 35 + x.r % 9), now() - make_interval(days => 40 + g.n * 35 + x.r % 9), 'manual',
       now() - make_interval(days => 42 + g.n * 35 + x.r % 9)
  from crm.accounts a cross join generate_series(0, 1) g(n) cross join lateral (select pg_temp.h('ord' || a.id::text || g.n) as r) x
 where a.market_code = 'US' and a.kind = 'store' and a.lifecycle = 'active' and a.owner_id is not null and pg_temp.h('hasord' || a.id::text) % 3 = 0;
insert into crm.deal_items (deal_id, market_code, product_id, name, quantity, unit_price_minor, sum_minor, currency, position)
select d.id, 'US', pg_temp.uid('prod-us-sim'), 'SIM kit', d.amount_minor / 250, 250, d.amount_minor, 'USD', 1
  from crm.deals d where d.pipeline_id = pg_temp.uid('p-us-orders') and d.status = 'won';
insert into crm.deal_orders (deal_id, market_code, carrier, customer_number, due_on, po_number, ship_to, terms, description)
select d.id, 'US', 'FedEx', 'C-' || lpad((pg_temp.h('cn' || d.account_id::text) % 100000)::text, 5, '0'), (d.won_at)::date, 'PO-' || lpad((pg_temp.h('po' || d.id::text) % 10000)::text, 4, '0'),
       '100 Main Street, ' || coalesce(a.locality, 'Las Vegas'), 'Net 15', 'Restock'
  from crm.deals d join crm.accounts a on a.id = d.account_id where d.pipeline_id = pg_temp.uid('p-us-orders') and d.status = 'won';
insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause, at)
select d.id, 'US', null, d.stage_id, d.owner_id, 'user', d.won_at from crm.deals d where d.pipeline_id = pg_temp.uid('p-us-orders') and d.status = 'won';
-- mx
-- México como lo describe el documento de requerimientos (épicas E14 a E18).
-- Etapas de los dos embudos: en una base nueva las etapas nacen en este archivo, así que la plantilla se aplica aquí
-- (en una base que ya las tenía, la aplicó la migración 0025).
select crm.apply_mx_stage_template();
-- Los dos formularios de México son los embudos de campaña: tiendas independientes (F1) y cadenas y distribuidores (F2).
-- Cada uno lleva su identificador de canal y deja el origen "Campaña web". El de cadenas y distribuidores pregunta el tipo de empresa.
update crm.web_forms set funnel = 'F1', channel_id = 'mx-web-tiendas', is_campaign = true where id = pg_temp.uid('f-mx-d2d');
update crm.web_forms set funnel = 'F2', channel_id = 'mx-web-cadenas', is_campaign = true, offer_types = '{distributor,chain}' where id = pg_temp.uid('f-mx-b2b');
alter table crm.leads disable trigger user;
update crm.leads l set source = 'web_campaign', funnel = f.funnel, channel_id = f.channel_id
  from crm.web_forms f where f.id = l.form_id and f.is_campaign;
-- Los leads de cadenas y distribuidores traen tipo de empresa y número de tiendas como campos (datos inventados).
update crm.leads l set account_type = case when pg_temp.h('ct' || l.id::text) % 2 = 0 then 'chain' else 'distributor' end,
       custom = l.custom || jsonb_build_object('b2b_points_of_sale', 3 + pg_temp.h('pv' || l.id::text) % 58)
 where l.form_id = pg_temp.uid('f-mx-b2b');
alter table crm.leads enable trigger user;
-- Meta de respuesta: una hora hábil para cadenas y distribuidores, un día hábil para tiendas (E15.F9).
update crm.routing_rules set sla_minutes = 60, sla_business_days = null where id = pg_temp.uid('rr-mx-b2b');
update crm.routing_rules set sla_business_days = 1 where id = pg_temp.uid('rr-mx-d2d');
-- Algunos leads descartados de México dejaron correo y aceptaron recibir correos: son la base de correo (correos inventados).
alter table crm.leads disable trigger user;
update crm.leads l set email = 'contacto' || (pg_temp.h('em' || l.id::text) % 9000 + 1000)::text || '@ejemplo.test',
       consent_at = l.created_at, consent_text = 'Acepto que axexo me escriba por correo sobre sus productos y novedades.'
 where l.market_code = 'MX' and l.status = 'disqualified' and pg_temp.h('cs' || l.id::text) % 2 = 0;
alter table crm.leads enable trigger user;
-- mercados
-- Las entidades sintéticas quedan como las de por defecto de su mercado; la provisional que crea la migración 0026 para
-- MX y US se retira (El Salvador conserva la suya, "por confirmar", para que se vea ese caso). Una tasa MXN antigua deja
-- convertir los negocios que cerraron antes de ayer, y los comercios con dirección reciben una ubicación sintética.
update crm.legal_entities set is_default = false where market_code in ('MX', 'US') and needs_review;
update crm.legal_entities set is_default = true, tax_country = market_code where id in (pg_temp.uid('le-mx'), pg_temp.uid('le-us'));
update crm.accounts a set legal_entity_id = case a.market_code when 'MX' then pg_temp.uid('le-mx') else pg_temp.uid('le-us') end
 where a.market_code in ('MX', 'US') and a.legal_entity_id in (select id from crm.legal_entities where needs_review);
update crm.deals d set legal_entity_id = a.legal_entity_id from crm.accounts a where a.id = d.account_id and d.legal_entity_id <> a.legal_entity_id;
delete from crm.legal_entities e where e.needs_review and e.market_code in ('MX', 'US')
   and not exists (select 1 from crm.accounts a where a.legal_entity_id = e.id) and not exists (select 1 from crm.deals d where d.legal_entity_id = e.id);
insert into crm.fx_rates (currency, as_of, usd_rate, source) values ('MXN', current_date - 400, 0.05, 'synthetic') on conflict do nothing;
select app.fx_restamp();
update crm.accounts a set latitude = 25.6714 + (pg_temp.h(a.id::text) % 40) / 100000.0, longitude = -100.3090 - (pg_temp.h(a.name) % 40) / 100000.0,
       geo_source = 'import', geo_at = now(), sublocality = 'Centro', locality = coalesce(a.locality, 'Monterrey'), region = coalesce(a.region, 'Nuevo León')
 where a.address_line = 'Av. Principal 120, Centro';
update crm.accounts set business_unit = 'mexico' where market_code = 'MX' and kind <> 'store';
update crm.accounts set business_unit = 'usa' where market_code = 'US' and kind <> 'store';

-- seguridad
-- El consentimiento que el seed puso en leads con los triggers apagados queda también como registro propio (canal correo, promociones).
insert into crm.consents (market_code, lead_id, channel, category, source, evidence, granted_at)
select l.market_code, l.id, 'email', 'marketing', 'web_form', left(l.consent_text, 500), l.consent_at
  from crm.leads l where l.consent_at is not null and not exists (select 1 from crm.consents c where c.lead_id = l.id);
-- Una agencia de ejemplo en México, sin personas todavía, confinada al embudo de tiendas (nombre inventado).
insert into crm.agencies (id, market_code, name, pipeline_id) values (pg_temp.uid('ag-mx-demo'), 'MX', 'Agencia Demo (sintética)', pg_temp.uid('p-mx-d2d'));
-- Un dato reservado de ejemplo en una cadena de México, para que el revelado con motivo se pueda probar (texto inventado).
insert into crm.account_sensitive (account_id, field_key, market_code, value)
select a.id, 'commercial_terms', a.market_code, 'Pago a 30 días. Descuento por volumen desde 50 puntos de venta. Revisión anual.'
  from crm.accounts a where a.market_code = 'MX' and a.segment = 'b2b' and a.owner_id = pg_temp.uid('diana.cruz') and a.archived_at is null
 order by a.name, a.id limit 1;
-- embudo
-- Hitos de venta de los comercios sintéticos (PIPE-06): la primera transacción que ya traía el archivo de ventas de ejemplo
-- queda como hito y como primer renglón de su historia; el primer fondeo, un día antes y con un método (datos inventados).
insert into crm.account_milestones (account_id, market_code, first_txn_at, first_funding_at, funding_method, as_of)
select m.account_id, a.market_code, min(m.first_txn_at), min(m.first_txn_at) - interval '1 day',
       case when a.market_code = 'US' then 'ach' when pg_temp.h('fm' || m.account_id::text) % 2 = 0 then 'spei' else 'cash' end, max(m.as_of)
  from crm.merchant_metrics_daily m join crm.accounts a on a.id = m.account_id
 where m.first_txn_at is not null group by m.account_id, a.market_code
on conflict (account_id) do nothing;
insert into crm.milestone_events (account_id, market_code, kind, action, occurred_at, method, source)
select account_id, market_code, 'first_funding', 'set', first_funding_at, funding_method, 's5' from crm.account_milestones where first_funding_at is not null
union all
select account_id, market_code, 'first_txn', 'set', first_txn_at, null, 's5' from crm.account_milestones where first_txn_at is not null;
-- El primer toque de los leads sintéticos que traen campaña o clic de anuncio (LEAD-02), para que la atribución se pueda filtrar y reportar.
insert into crm.source_touches (market_code, lead_id, touch, touched_at, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid)
select l.market_code, l.id, 'first', l.created_at, l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term, l.gclid, l.fbclid
  from crm.leads l where coalesce(l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term, l.gclid, l.fbclid) is not null
   and not exists (select 1 from crm.source_touches t where t.lead_id = l.id);

-- us-ficha
-- La ficha de dealer de US (épica E9): tipos de cuenta, tipos de negocio y zonas. Los carriers reales no se cargan en los datos
-- sintéticos (aquí los proveedores son inventados); una agencia y un socio inventados para "Reclutado por".
select crm.dealer_record_setup('US', false);
update crm.ops_catalog set ref_label = 'North dealer code' where market_code = 'US' and kind = 'provider' and code = 'carrier_north';
insert into crm.agencies (id, market_code, kind, name) values
  (pg_temp.uid('ag-us-1'), 'US', 'agency', 'Agencia Ejemplo Uno (sintética)'),
  (pg_temp.uid('ag-us-2'), 'US', 'partner', 'Socio Ejemplo (sintético)');

-- partners-contratos
-- Una persona de prueba con rol de partner sobre el ISO sintético de US (ve el ISO, su agente y sus puntos de venta), el ISO
-- registrado como partner y niveles con criterios publicados en US y México. Nombres y cifras inventados.
insert into crm.users (id, email, full_name, locale, is_synthetic)
values (pg_temp.uid('iso.partner'), 'iso.partner@contigo.test', 'Partner ISO de prueba', 'en', true);
insert into crm.memberships (user_id, market_code, role, scope_account_id, valid_from)
values (pg_temp.uid('iso.partner'), 'US', 'partner', pg_temp.uid('dat-us-iso'), now() - interval '30 days');
insert into crm.partner_profiles (account_id, market_code, since, created_by)
values (pg_temp.uid('dat-us-iso'), 'US', current_date - 120, pg_temp.uid('robert.hale'));
insert into crm.partner_tiers (market_code, code, name_es, name_en, rank, min_active, min_quality_pct, min_compliance_pct) values
  ('US', 'base', 'Base', 'Base', 1, 0, 0, 0), ('US', 'silver', 'Plata', 'Silver', 2, 1, 30, 50), ('US', 'gold', 'Oro', 'Gold', 3, 25, 60, 80),
  ('MX', 'base', 'Base', 'Base', 1, 0, 0, 0), ('MX', 'silver', 'Plata', 'Silver', 2, 10, 40, 60);
