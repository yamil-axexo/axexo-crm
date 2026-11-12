-- 0016_b2b: lo que pidió el comité del 11-nov-2026 para la venta a cadenas, distribuidores e ISO (paquete b2b).
--
-- 1) Tipo de cuenta: catálogo por mercado (crm.account_types) y accounts.account_type. El nivel en el árbol (kind) sale del tipo.
-- 2) Campos por tipo de venta: field_definitions.motor, .section, .applies_when y .in_intake; campos B2B de México (E16.F5 a F9).
-- 3) Etapas administrables: stages.archived_at; un cambio de etapa hecho por administración lleva cause = 'admin'.
-- 4) "En pausa": deals.paused_at con motivo y fecha de revisión. Un negocio cerrado nunca queda en pausa.
-- 5) Motivos de pérdida por tipo de venta: loss_reasons.motors (null = todos) y los motivos de B2B y de campo.
-- 6) Contactos de una cuenta corporativa: más roles, uno principal por cuenta, idioma preferido y "móvil que recibe SMS".
-- 7) Formularios web: qué campos adicionales pide cada uno (web_forms.ask_fields).

-- ---------------------------------------------------------------- 1) tipo de cuenta
create table crm.account_types (
  id           uuid primary key default app.uuid_v7(),
  market_code  text references crm.markets(code),            -- null = todos los mercados
  code         text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_es     text not null check (char_length(btrim(label_es)) between 2 and 60),
  label_en     text not null check (char_length(btrim(label_en)) between 2 and 60),
  kind         text not null check (kind in ('organization','distributor','chain','store')),   -- nivel en el árbol
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index account_types_uq on crm.account_types (code, coalesce(market_code, '*'));
alter table crm.account_types enable row level security;
alter table crm.account_types force row level security;   -- AUTHZ-03
grant select, insert, update on crm.account_types to contigo_app;
create policy account_types_read on crm.account_types for select to contigo_app using ((select app.current_user_id()) is not null);
create policy account_types_admin_ins on crm.account_types for insert to contigo_app with check ((select app.is_admin()));
create policy account_types_admin_upd on crm.account_types for update to contigo_app using ((select app.is_admin())) with check ((select app.is_admin()));

insert into crm.account_types (code, label_es, label_en, kind, position) values
  ('store',       'Tienda independiente', 'Independent store', 'store',        10),
  ('branch',      'Sucursal',             'Branch',            'store',        20),
  ('chain',       'Cadena',               'Chain',             'chain',        30),
  ('corporate',   'Corporativo',          'Corporate account', 'organization', 40),
  ('distributor', 'Distribuidor',         'Distributor',       'distributor',  50),
  ('iso',         'ISO',                  'ISO',               'distributor',  60),
  ('iso_agent',   'Agente de ISO',        'ISO agent',         'distributor',  70),
  ('aggregator',  'Agregador',            'Aggregator',        'distributor',  80);

alter table crm.accounts add column account_type text;
update crm.accounts set account_type = case kind when 'store' then case when parent_id is null then 'store' else 'branch' end
                                                 when 'chain' then 'chain' when 'distributor' then 'distributor' else 'corporate' end;

-- El tipo manda sobre el nivel: al cambiar el tipo, kind toma el nivel del catálogo. Si otro camino (importación, código
-- anterior) solo trae kind, el tipo toma el que corresponde a ese nivel. Un tipo que no existe para el mercado no entra.
create or replace function crm.account_type_sync() returns trigger
language plpgsql security definer set search_path = crm, app, pg_catalog as $$
declare k text;
begin
  if tg_op = 'INSERT' and new.account_type is null
     or tg_op = 'UPDATE' and new.account_type is not distinct from old.account_type and new.kind is distinct from old.kind then
    new.account_type := case new.kind when 'store' then case when new.parent_id is null then 'store' else 'branch' end
                                      when 'chain' then 'chain' when 'distributor' then 'distributor' else 'corporate' end;
    return new;
  end if;
  if tg_op = 'INSERT' or new.account_type is distinct from old.account_type then
    select t.kind into k from crm.account_types t
     where t.code = new.account_type and (t.market_code is null or t.market_code = new.market_code)
     order by t.market_code nulls last limit 1;
    if not found then
      raise exception 'unknown account type' using errcode = '23514';
    end if;
    new.kind := k;
  end if;
  return new;
end $$;
create trigger accounts_type_sync before insert or update of account_type, kind on crm.accounts
  for each row execute function crm.account_type_sync();
alter table crm.accounts alter column account_type set not null;

-- ---------------------------------------------------------------- 2) campos por tipo de venta
alter table crm.field_definitions
  add column motor        text,                                  -- null = todos los tipos de venta
  add column section      text check (section is null or section in ('qualify','terms','file')),
  add column applies_when jsonb,                                 -- {"key": "...", "equals": "..."}: solo se muestra con ese valor
  add column in_intake    boolean not null default false;        -- se pide en el alta manual

-- Campos B2B de México (requerimientos E16.F5 a F9). El expediente guarda el estado de cada documento, nunca el documento.
insert into crm.field_definitions (object, key, label_es, label_en, data_type, options, market_code, data_class, motor, section, applies_when, in_intake, position)
select v.object, v.key, v.label_es, v.label_en, v.data_type, v.options::jsonb, 'MX', 'internal', 'b2b', v.section, v.applies_when::jsonb, v.in_intake, v.position
  from (values
    ('account', 'b2b_points_of_sale',   'Puntos de venta',                 'Points of sale',                'number', '[]', 'qualify', null, true, 100),
    ('account', 'b2b_size',             'Tamaño de la cuenta',             'Account size',                  'select', '["Hasta 10 puntos de venta","De 11 a 50","De 51 a 200","Más de 200"]', 'qualify', null, false, 101),
    ('account', 'b2b_monthly_volume',   'Volumen mensual estimado (MXN)',  'Estimated monthly volume (MXN)', 'number', '[]', 'qualify', null, true, 102),
    ('account', 'b2b_integration',      'Modelo de integración',           'Integration model',             'select', '["API","Portal","Por definir"]', 'qualify', null, true, 103),
    ('account', 'b2b_chain_category',   'Subcategoría de cadena',          'Chain subcategory',             'select', '["Autoservicio","Tiendas de Conveniencia","Departamentales","Especializadas"]', 'qualify', null, false, 104),
    ('account', 'b2b_product_interest', 'Productos de interés',            'Product interest',              'multiselect', '["Recargas","Pago de servicios","Códigos digitales","Efectivo a digital"]', 'qualify', null, false, 105),
    ('account', 'b2b_competitors',      'Plataformas que usa hoy',         'Platforms used today',          'text', '[]', 'qualify', null, false, 106),
    ('account', 'b2b_commission',       'Comisión acordada',               'Agreed commission',             'text', '[]', 'terms', null, false, 110),
    ('account', 'b2b_settlement',       'Plazo de liquidación',            'Settlement terms',              'text', '[]', 'terms', null, false, 111),
    ('account', 'b2b_entity_type',      'Tipo de persona',                 'Legal entity type',             'select', '["Persona moral","Persona física"]', 'file', null, true, 120),
    ('account', 'b2b_doc_acta',         'Acta constitutiva',               'Articles of incorporation',     'select', '["Pendiente","Recibido","Validado"]', 'file', '{"key":"b2b_entity_type","equals":"Persona moral"}', false, 121),
    ('account', 'b2b_doc_poder',        'Poder notarial',                  'Power of attorney',             'select', '["Pendiente","Recibido","Validado"]', 'file', '{"key":"b2b_entity_type","equals":"Persona moral"}', false, 122),
    ('account', 'b2b_doc_csf_moral',    'Constancia de situación fiscal',  'Tax status certificate',        'select', '["Pendiente","Recibido","Validado"]', 'file', '{"key":"b2b_entity_type","equals":"Persona moral"}', false, 123),
    ('account', 'b2b_doc_csf_fisica',   'Constancia de situación fiscal',  'Tax status certificate',        'select', '["Pendiente","Recibido","Validado"]', 'file', '{"key":"b2b_entity_type","equals":"Persona física"}', false, 124),
    ('account', 'b2b_doc_id',           'Identificación oficial',          'Official ID',                   'select', '["Pendiente","Recibido","Validado"]', 'file', '{"key":"b2b_entity_type","equals":"Persona física"}', false, 125),
    ('account', 'b2b_doc_domicilio',    'Comprobante de domicilio',        'Proof of address',              'select', '["Pendiente","Recibido","Validado"]', 'file', '{"key":"b2b_entity_type","equals":"Persona física"}', false, 126),
    ('lead',    'b2b_points_of_sale',   'Puntos de venta',                 'Points of sale',                'number', '[]', 'qualify', null, false, 100),
    ('lead',    'b2b_monthly_volume',   'Volumen mensual estimado (MXN)',  'Estimated monthly volume (MXN)', 'number', '[]', 'qualify', null, false, 102),
    ('lead',    'b2b_integration',      'Modelo de integración',           'Integration model',             'select', '["API","Portal","Por definir"]', 'qualify', null, false, 103)
  ) v(object, key, label_es, label_en, data_type, options, section, applies_when, in_intake, position)
 where exists (select 1 from crm.markets m where m.code = 'MX')
on conflict do nothing;

-- ---------------------------------------------------------------- 3) etapas administrables
alter table crm.stages add column archived_at timestamptz;
alter table crm.deal_stage_events drop constraint deal_stage_events_cause_check;
alter table crm.deal_stage_events add constraint deal_stage_events_cause_check
  check (cause in ('user','transaction','rule','import','admin'));

-- ---------------------------------------------------------------- 4) en pausa
alter table crm.deals
  add column paused_at        timestamptz,
  add column paused_by        uuid references crm.users(id),
  add column pause_reason     text check (pause_reason is null or char_length(btrim(pause_reason)) between 2 and 300),
  add column pause_review_on  date,
  add constraint deals_pause_complete check (paused_at is null or (pause_reason is not null and pause_review_on is not null));
create index deals_paused_idx on crm.deals (pause_review_on) where paused_at is not null;

-- Un negocio que se cierra (por la persona, por la primera transacción o por una importación) sale de la pausa.
create or replace function crm.deal_pause_guard() returns trigger
language plpgsql as $$
begin
  if new.status <> 'open' then
    new.paused_at := null; new.paused_by := null; new.pause_reason := null; new.pause_review_on := null;
  end if;
  return new;
end $$;
create trigger deals_pause_guard before insert or update on crm.deals
  for each row execute function crm.deal_pause_guard();

-- ---------------------------------------------------------------- 5) motivos de pérdida por tipo de venta
alter table crm.loss_reasons
  add column motors   text[],                    -- null = todos los tipos de venta
  add column position int not null default 0;
insert into crm.loss_reasons (code, kind, label_es, label_en, market_code, motors, position) values
  ('b2b_integration',     'lost', 'Integración técnica no viable',             'Technical integration not viable',        null, '{b2b}', 10),
  ('b2b_certification',   'lost', 'No pasó certificación',                     'Did not pass certification',              null, '{b2b}', 11),
  ('b2b_volume',          'lost', 'Volumen insuficiente',                      'Not enough volume',                       null, '{b2b}', 12),
  ('b2b_integrator',      'lost', 'Ya trabaja con un integrador',              'Already works with an integrator',        null, '{b2b}', 13),
  ('b2b_postponed',       'lost', 'Proyecto pospuesto por el cliente',         'Project postponed by the customer',       null, '{b2b}', 14),
  ('store_closed_down',   'lost', 'La tienda cerró',                           'The store closed down',                   null, '{d2d}', 20),
  ('store_no_interest',   'lost', 'No le interesa',                            'Not interested',                          null, '{d2d}', 21),
  ('signup_blocked',      'lost', 'No pudo terminar el alta (código o correo)', 'Could not finish sign-up (code or email)', null, '{d2d}', 22),
  ('other_provider',      'lost', 'Ya trabaja con otro proveedor',             'Already works with another provider',     null, '{d2d}', 23),
  ('no_cash_handling',    'lost', 'No quiere manejar efectivo',                'Does not want to handle cash',            null, '{d2d,dealer}', 30),
  ('landline_only',       'lost', 'Solo tiene teléfono fijo (no recibe SMS)',  'Landline only (cannot get SMS)',          null, '{d2d,dealer}', 31),
  ('product_not_offered', 'lost', 'Quiere un producto que no ofrecemos',       'Wants a product we do not carry',         null, '{d2d,dealer}', 32),
  ('owner_unavailable',   'lost', 'El dueño nunca está',                       'Owner never available',                   null, '{d2d,dealer}', 33)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- 6) contactos de una cuenta corporativa
alter table crm.account_contacts drop constraint account_contacts_role_check;
alter table crm.account_contacts add constraint account_contacts_role_check
  check (role in ('owner','decision_maker','manager','staff','billing','executive','purchasing','finance','technology','legal','operations'));
alter table crm.account_contacts add column is_primary boolean not null default false;
create unique index account_contacts_primary_uq on crm.account_contacts (account_id) where is_primary and valid_to is null;
alter table crm.contacts
  add column preferred_locale text check (preferred_locale is null or preferred_locale in ('es','en')),
  add column sms_capable      boolean;                 -- null = no se sabe; true = es un móvil que recibe SMS

-- ---------------------------------------------------------------- 7) formularios web
alter table crm.web_forms add column ask_fields text[] not null default '{}';   -- llaves de campos de lead que pide el formulario
