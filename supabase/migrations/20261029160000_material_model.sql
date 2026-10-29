-- Owner decision 2026-10-29: normalized material model.
-- (1) standard materials, (2) sizes, (3) combination = the existing catalog
-- material definition (bob.catalog_items) linked to a material and a size, with
-- household stock "har hemma", (4) shared stores and article prices with history.
-- Descriptive data columns are nullable: unknown stays unknown. Lengths are mm,
-- weight is kg. Shared rows created by people or Bob are 'unreviewed'; only the
-- service role marks rows 'reviewed'. Contract: db/README.md#material-model.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Categories and two all-optional profiles for products that are neither
-- sheet, profile, tube nor fastener geometry (rolls, single pieces).
insert into bob.catalog_categories(code,axis,parent_code,label,aliases) values
 ('mineral','material',null,'Mineral',array['mineral']),
 ('bitumen','material',null,'Bitumen',array['bitumen','asfalt','papp']),
 ('roll','form',null,'Rulle',array['rulle','roll']),
 ('piece','form',null,'Styckvara',array['styck','styckvara','piece'])
 on conflict(code) do nothing;
insert into bob.catalog_categories(code,axis,parent_code,label,aliases) values
 ('mineral.gypsum','material','mineral','Gips',array['gips','gypsum']),
 ('mineral.concrete','material','mineral','Betong',array['betong','concrete'])
 on conflict(code) do nothing;
do $profiles$ begin
 if not exists(select 1 from bob.catalog_profiles where code='roll_stock') then
  insert into bob.catalog_profiles values('roll_stock','Rullmaterial');
  insert into bob.catalog_profile_revisions(profile_code,revision,form_code,description)
   values('roll_stock',1,'roll','Material sold on rolls; every field is optional.');
  insert into bob.catalog_profile_fields(profile_code,profile_revision,property_key,required,min_value,max_value,position) values
   ('roll_stock',1,'thickness',false,0.000001,1000000,0),('roll_stock',1,'width',false,0.000001,1000000,1),
   ('roll_stock',1,'length',false,0.000001,1000000,2),('roll_stock',1,'grade',false,null,null,20),
   ('roll_stock',1,'finish',false,null,null,21),('roll_stock',1,'nominal_size',false,null,null,30);
  update bob.catalog_profile_revisions set published=true where profile_code='roll_stock' and revision=1;
 end if;
 if not exists(select 1 from bob.catalog_profiles where code='piece') then
  insert into bob.catalog_profiles values('piece','Styckvara');
  insert into bob.catalog_profile_revisions(profile_code,revision,form_code,description)
   values('piece',1,'piece','Single manufactured pieces; every field is optional.');
  insert into bob.catalog_profile_fields(profile_code,profile_revision,property_key,required,min_value,max_value,position) values
   ('piece',1,'grade',false,null,null,20),('piece',1,'finish',false,null,null,21),
   ('piece',1,'colour',false,null,null,22),('piece',1,'nominal_size',false,null,null,30);
  update bob.catalog_profile_revisions set published=true where profile_code='piece' and revision=1;
 end if;
end $profiles$;

-- (1) Standard materials: what something is made of, independent of size.
create table bob.material_types (
 id uuid primary key default gen_random_uuid(),
 name text check(name is null or char_length(btrim(name)) between 1 and 200),
 category_code text references bob.catalog_categories(code),
 description text check(description is null or char_length(description)<=2000),
 review_status text check(review_status is null or review_status in ('reviewed','unreviewed')),
 seed_key text unique check(seed_key is null or seed_key ~ '^[a-z][a-z0-9_]{0,63}$'),
 created_by uuid, created_at timestamptz default clock_timestamp(), updated_at timestamptz default clock_timestamp()
);
create unique index material_types_name_idx on bob.material_types(lower(btrim(name))) where name is not null;

-- (2) Sizes: dimensions in mm by form. For fasteners width_mm is the nominal
-- shank diameter, length_mm the length and depth_mm null.
create table bob.material_sizes (
 id uuid primary key default gen_random_uuid(),
 label text check(label is null or char_length(btrim(label)) between 1 and 120),
 form_code text references bob.catalog_categories(code),
 length_mm numeric(14,4) check(length_mm is null or (length_mm>0 and length_mm<=1000000)),
 width_mm numeric(14,4) check(width_mm is null or (width_mm>0 and width_mm<=1000000)),
 depth_mm numeric(14,4) check(depth_mm is null or (depth_mm>0 and depth_mm<=1000000)),
 review_status text check(review_status is null or review_status in ('reviewed','unreviewed')),
 seed_key text unique check(seed_key is null or seed_key ~ '^[a-z][a-z0-9_]{0,63}$'),
 created_by uuid, created_at timestamptz default clock_timestamp(), updated_at timestamptz default clock_timestamp()
);
create index material_sizes_form_idx on bob.material_sizes(form_code);

create function bob_private.material_axis_guard() returns trigger language plpgsql set search_path='' as $$
declare v_axis text:=case tg_table_name when 'material_types' then 'material' else 'form' end;
 v_code text:=to_jsonb(new)->>case tg_table_name when 'material_types' then 'category_code' else 'form_code' end;
begin
 if v_code is not null and not exists(select 1 from bob.catalog_categories c where c.code=v_code and c.axis=v_axis) then
  raise exception 'material_category_axis' using errcode='22023'; end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
create trigger material_types_axis before insert or update on bob.material_types for each row execute function bob_private.material_axis_guard();
create trigger material_sizes_axis before insert or update on bob.material_sizes for each row execute function bob_private.material_axis_guard();

-- (3) The combination IS the existing catalog material definition. These
-- identity-level links describe its current revision; revisions stay immutable.
alter table bob.catalog_items
 add column material_type_id uuid references bob.material_types(id) on delete set null,
 add column material_size_id uuid references bob.material_sizes(id) on delete set null,
 add column unit_code text references bob.catalog_units(code),
 add column weight_kg numeric(14,4) check(weight_kg is null or (weight_kg>0 and weight_kg<=1000000)),
 add column review_status text check(review_status is null or review_status in ('reviewed','unreviewed')),
 add constraint catalog_items_spec_material_only check((material_type_id is null and material_size_id is null) or kind='material');
-- One shared combination per material and size (size may be unknown).
create unique index catalog_items_shared_combination_idx on bob.catalog_items(material_type_id,coalesce(material_size_id,'00000000-0000-0000-0000-000000000000'::uuid))
 where project_id is null and material_type_id is not null;
create index catalog_items_material_type_idx on bob.catalog_items(material_type_id);
create index catalog_items_material_size_idx on bob.catalog_items(material_size_id);

-- Aliases are search words for exactly one material, size or combination.
-- They never convert units; "2tum4" finds the 45 × 95 size, and Bob reports mm.
create table bob.material_aliases (
 id uuid primary key default gen_random_uuid(),
 alias text not null check(char_length(btrim(alias)) between 1 and 120),
 material_type_id uuid references bob.material_types(id) on delete cascade,
 material_size_id uuid references bob.material_sizes(id) on delete cascade,
 catalog_item_id uuid references bob.catalog_items(id) on delete cascade,
 review_status text check(review_status is null or review_status in ('reviewed','unreviewed')),
 created_by uuid, created_at timestamptz default clock_timestamp(),
 check(num_nonnulls(material_type_id,material_size_id,catalog_item_id)=1)
);
create unique index material_aliases_target_idx on bob.material_aliases(lower(btrim(alias)),coalesce(material_type_id,material_size_id,catalog_item_id));
create index material_aliases_alias_idx on bob.material_aliases(lower(btrim(alias)));
create index material_aliases_type_idx on bob.material_aliases(material_type_id);
create index material_aliases_size_idx on bob.material_aliases(material_size_id);
create index material_aliases_item_idx on bob.material_aliases(catalog_item_id);

-- Household stock "har hemma". Project stock (bob.stock_items) remains the
-- project's allocation ledger used by requirements and cut-plan reservations.
create table bob.household_stock (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references shared.households(id) on delete cascade,
 catalog_item_id uuid references bob.catalog_items(id) on delete set null,
 name text check(name is null or char_length(btrim(name)) between 1 and 200),
 quantity numeric(18,4) check(quantity is null or (quantity>=0 and quantity<=1000000000)),
 unit_code text references bob.catalog_units(code),
 location text check(location is null or char_length(location)<=200),
 notes text check(notes is null or char_length(notes)<=2000),
 revision integer not null default 1 check(revision>0),
 created_by uuid, created_at timestamptz default clock_timestamp(),
 updated_by uuid, updated_at timestamptz default clock_timestamp(),
 check(catalog_item_id is not null or name is not null)
);
create index household_stock_household_idx on bob.household_stock(household_id);
create index household_stock_item_idx on bob.household_stock(catalog_item_id);

-- (4) Shared stores, their articles and an append-only price history.
create table bob.stores (
 id uuid primary key default gen_random_uuid(),
 name text check(name is null or char_length(btrim(name)) between 1 and 200),
 chain text check(chain is null or char_length(chain)<=200),
 city text check(city is null or char_length(city)<=120),
 address text check(address is null or char_length(address)<=300),
 url text check(url is null or (char_length(url)<=2000 and url ~ '^https?://[^[:space:]]+$')),
 review_status text check(review_status is null or review_status in ('reviewed','unreviewed')),
 created_by uuid, created_at timestamptz default clock_timestamp(), updated_at timestamptz default clock_timestamp()
);
create unique index stores_name_city_idx on bob.stores(lower(btrim(name)),lower(coalesce(btrim(city),''))) where name is not null;
create table bob.store_articles (
 id uuid primary key default gen_random_uuid(),
 store_id uuid references bob.stores(id) on delete cascade,
 catalog_item_id uuid references bob.catalog_items(id) on delete set null,
 title text check(title is null or char_length(btrim(title)) between 1 and 200),
 article_number text check(article_number is null or char_length(btrim(article_number)) between 1 and 120),
 url text check(url is null or (char_length(url)<=2000 and url ~ '^https?://[^[:space:]]+$')),
 pack_quantity numeric(18,4) check(pack_quantity is null or (pack_quantity>0 and pack_quantity<=1000000000)),
 pack_unit_code text references bob.catalog_units(code),
 review_status text check(review_status is null or review_status in ('reviewed','unreviewed')),
 created_by uuid, created_at timestamptz default clock_timestamp(), updated_at timestamptz default clock_timestamp()
);
create unique index store_articles_number_idx on bob.store_articles(store_id,lower(btrim(article_number))) where store_id is not null and article_number is not null;
create index store_articles_item_idx on bob.store_articles(catalog_item_id);
create table bob.store_article_prices (
 id bigint generated always as identity primary key,
 store_article_id uuid not null references bob.store_articles(id) on delete cascade,
 price numeric(14,4) check(price is null or (price>=0 and price<=1000000000)),
 currency text check(currency is null or currency ~ '^[A-Z]{3}$'),
 price_unit_code text references bob.catalog_units(code),
 vat_included boolean,
 source_kind text check(source_kind is null or source_kind in ('manual','receipt','website','bob')),
 source_url text check(source_url is null or (char_length(source_url)<=2000 and source_url ~ '^https?://[^[:space:]]+$')),
 note text check(note is null or char_length(note)<=1000),
 observed_on date,
 recorded_by uuid,
 recorded_at timestamptz not null default clock_timestamp()
);
create index store_article_prices_article_idx on bob.store_article_prices(store_article_id,recorded_at desc,id desc);
-- Latest price per article; last_changed_at is when that price was recorded.
create view bob.current_store_prices with(security_invoker=true) as
 select distinct on (p.store_article_id) p.store_article_id,a.store_id,s.name as store_name,a.catalog_item_id,a.title,a.article_number,
  p.id as price_id,p.price,p.currency,p.price_unit_code,p.vat_included,p.source_kind,p.source_url,p.observed_on,
  p.recorded_at as last_changed_at,p.recorded_by
 from bob.store_article_prices p join bob.store_articles a on a.id=p.store_article_id left join bob.stores s on s.id=a.store_id
 order by p.store_article_id,p.recorded_at desc,p.id desc;

-- Project-private supplier evidence may name the shared store article it came from.
alter table bob.supplier_articles add column store_article_id uuid references bob.store_articles(id) on delete set null;

-- Shared rows: readable by signed-in callers, written only through the commands below.
do $rls$ declare name text; begin
 foreach name in array array['material_types','material_sizes','material_aliases','stores','store_articles','store_article_prices'] loop
  execute format('alter table bob.%I enable row level security',name);
  execute format('revoke all on bob.%I from public,anon,authenticated',name);
  execute format('grant select on bob.%I to authenticated',name);
  execute format('grant all on bob.%I to service_role',name);
  execute format('create policy shared_read on bob.%I for select to authenticated using ((select auth.uid()) is not null)',name);
 end loop;
end $rls$;
revoke all on bob.current_store_prices from public,anon,authenticated;
grant select on bob.current_store_prices to authenticated;
grant select on bob.current_store_prices to service_role;

create function bob_private.has_household_access(p_household uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from shared.household_access a
  where a.household_id=p_household and a.user_id=auth.uid() and a.status='active')
$$;
revoke all on function bob_private.has_household_access(uuid) from public,anon;
grant execute on function bob_private.has_household_access(uuid) to authenticated;
alter table bob.household_stock enable row level security;
revoke all on bob.household_stock from public,anon,authenticated;
grant select on bob.household_stock to authenticated;
grant all on bob.household_stock to service_role;
create policy household_read on bob.household_stock for select to authenticated using (bob_private.has_household_access(household_id));

-- Contributors to the shared catalog: a Bob project participant or an active
-- household member. Other apps' signed-in users cannot write Bob data.
create function bob_private.is_bob_participant() returns boolean
 language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
  exists(select 1 from bob.projects p where bob_private.project_access_for_user(p.id,auth.uid()))
  or exists(select 1 from shared.household_access a where a.user_id=auth.uid() and a.status='active'))
$$;
revoke all on function bob_private.is_bob_participant() from public,anon,authenticated;

-- Field readers for command payloads: absent or null means unknown.
create function bob_private.material_text(p jsonb,k text,max_length integer) returns text
 language plpgsql immutable set search_path='' as $$
begin
 if p->k is null or p->k='null'::jsonb then return null; end if;
 if jsonb_typeof(p->k)<>'string' or char_length(btrim(p->>k)) not between 1 and max_length then raise exception 'material_invalid_field:%',k using errcode='22023'; end if;
 return btrim(p->>k);
end $$;
create function bob_private.material_number(p jsonb,k text,min_value numeric,max_value numeric) returns numeric
 language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if p->k is null or p->k='null'::jsonb then return null; end if;
 if jsonb_typeof(p->k) not in ('number','string') or (p->>k)!~'^[0-9]{1,10}([.,][0-9]{1,4})?$' then raise exception 'material_invalid_field:%',k using errcode='22023'; end if;
 n:=replace(p->>k,',','.')::numeric;
 if n<min_value or n>max_value then raise exception 'material_invalid_field:%',k using errcode='22023'; end if;
 return n;
end $$;
create function bob_private.material_payload(p jsonb,allowed text[]) returns void
 language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>8000 or p-allowed<>'{}' then raise exception 'material_invalid_payload' using errcode='22023'; end if;
end $$;
-- A catalog item may be referenced when it is shared or in a project the caller can open.
create function bob_private.catalog_item_visible(p_item uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from bob.catalog_items i where i.id=p_item and (i.project_id is null or bob_private.has_project_access(i.project_id)))
$$;
revoke all on function bob_private.material_text(jsonb,text,integer),bob_private.material_number(jsonb,text,numeric,numeric),
 bob_private.material_payload(jsonb,text[]),bob_private.catalog_item_visible(uuid) from public,anon,authenticated;

-- Commands. Each creates unreviewed shared rows, or returns the existing equal row.
create function bob.add_material_type(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_name text; v_category text; v_description text; rec bob.material_types;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['name','category_code','description']);
 v_name:=bob_private.material_text(p_data,'name',200); v_category:=bob_private.material_text(p_data,'category_code',64);
 v_description:=bob_private.material_text(p_data,'description',2000);
 if v_name is not null then
  select * into rec from bob.material_types where lower(btrim(name))=lower(v_name);
  if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)-'seed_key'); end if;
 end if;
 insert into bob.material_types(name,category_code,description,review_status,created_by)
  values(v_name,v_category,v_description,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec)-'seed_key');
end $$;

create function bob.add_material_size(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_label text; v_form text; l numeric; w numeric; d numeric; rec bob.material_sizes;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['label','form_code','length_mm','width_mm','depth_mm']);
 v_label:=bob_private.material_text(p_data,'label',120); v_form:=bob_private.material_text(p_data,'form_code',64);
 l:=bob_private.material_number(p_data,'length_mm',0.0001,1000000); w:=bob_private.material_number(p_data,'width_mm',0.0001,1000000);
 d:=bob_private.material_number(p_data,'depth_mm',0.0001,1000000);
 if v_label is null and l is null and w is null and d is null then raise exception 'material_size_empty' using errcode='22023'; end if;
 select * into rec from bob.material_sizes s where s.form_code is not distinct from v_form and s.length_mm is not distinct from l
  and s.width_mm is not distinct from w and s.depth_mm is not distinct from d order by s.review_status nulls last,s.created_at limit 1;
 if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)-'seed_key'); end if;
 insert into bob.material_sizes(label,form_code,length_mm,width_mm,depth_mm,review_status,created_by)
  values(v_label,v_form,l,w,d,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec)-'seed_key');
end $$;

create function bob.add_material_alias(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_alias text; t uuid; s uuid; i uuid; rec bob.material_aliases;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['alias','material_type_id','material_size_id','catalog_item_id']);
 v_alias:=bob_private.material_text(p_data,'alias',120);
 begin
  t:=nullif(p_data->>'material_type_id','')::uuid; s:=nullif(p_data->>'material_size_id','')::uuid; i:=nullif(p_data->>'catalog_item_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:target' using errcode='22023'; end;
 if v_alias is null or num_nonnulls(t,s,i)<>1 then raise exception 'material_alias_target' using errcode='22023'; end if;
 if (t is not null and not exists(select 1 from bob.material_types where id=t)) or (s is not null and not exists(select 1 from bob.material_sizes where id=s))
  or (i is not null and not bob_private.catalog_item_visible(i)) then raise exception 'material_alias_target' using errcode='22023'; end if;
 select * into rec from bob.material_aliases a where lower(btrim(a.alias))=lower(v_alias) and coalesce(a.material_type_id,a.material_size_id,a.catalog_item_id)=coalesce(t,s,i);
 if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)); end if;
 insert into bob.material_aliases(alias,material_type_id,material_size_id,catalog_item_id,review_status,created_by)
  values(v_alias,t,s,i,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

-- Links a project material definition to its material, size, unit and weight.
-- Shared definitions are changed only by the service role.
create function bob.set_catalog_item_spec(p_item uuid,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.catalog_items; t uuid; s uuid; u text; w numeric;
begin
 perform bob_private.material_payload(p_data,array['material_type_id','material_size_id','unit_code','weight_kg']);
 select * into h from bob.catalog_items where id=p_item for update;
 if not found or h.project_id is null or not bob_private.has_project_access(h.project_id) then raise exception 'material_denied' using errcode='42501'; end if;
 if h.kind<>'material' then raise exception 'material_spec_material_only' using errcode='22023'; end if;
 begin
  t:=nullif(p_data->>'material_type_id','')::uuid; s:=nullif(p_data->>'material_size_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:target' using errcode='22023'; end;
 u:=bob_private.material_text(p_data,'unit_code',16); w:=bob_private.material_number(p_data,'weight_kg',0.0001,1000000);
 if (t is not null and not exists(select 1 from bob.material_types where id=t)) or (s is not null and not exists(select 1 from bob.material_sizes where id=s))
  or (u is not null and not exists(select 1 from bob.catalog_units where code=u)) then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 update bob.catalog_items set material_type_id=t,material_size_id=s,unit_code=u,weight_kg=w where id=p_item;
 return jsonb_build_object('operation','updated','record',bob_private.catalog_record(h.project_id,p_item));
end $$;

create function bob.add_store(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_name text; v_city text; rec bob.stores;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['name','chain','city','address','url']);
 v_name:=bob_private.material_text(p_data,'name',200); v_city:=bob_private.material_text(p_data,'city',120);
 if v_name is null then raise exception 'material_invalid_field:name' using errcode='22023'; end if;
 select * into rec from bob.stores where lower(btrim(name))=lower(v_name) and lower(coalesce(btrim(city),''))=lower(coalesce(v_city,''));
 if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)); end if;
 insert into bob.stores(name,chain,city,address,url,review_status,created_by)
  values(v_name,bob_private.material_text(p_data,'chain',200),v_city,bob_private.material_text(p_data,'address',300),
   bob_private.material_text(p_data,'url',2000),'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

create function bob.add_store_article(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare st uuid; item uuid; v_number text; u text; rec bob.store_articles;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['store_id','catalog_item_id','title','article_number','url','pack_quantity','pack_unit_code']);
 begin
  st:=nullif(p_data->>'store_id','')::uuid; item:=nullif(p_data->>'catalog_item_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:reference' using errcode='22023'; end;
 v_number:=bob_private.material_text(p_data,'article_number',120); u:=bob_private.material_text(p_data,'pack_unit_code',16);
 if (st is not null and not exists(select 1 from bob.stores where id=st)) or (item is not null and not bob_private.catalog_item_visible(item))
  or (u is not null and not exists(select 1 from bob.catalog_units where code=u)) then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 if st is not null and v_number is not null then
  select * into rec from bob.store_articles a where a.store_id=st and lower(btrim(a.article_number))=lower(v_number);
  if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)); end if;
 end if;
 insert into bob.store_articles(store_id,catalog_item_id,title,article_number,url,pack_quantity,pack_unit_code,review_status,created_by)
  values(st,item,bob_private.material_text(p_data,'title',200),v_number,bob_private.material_text(p_data,'url',2000),
   bob_private.material_number(p_data,'pack_quantity',0.0001,1000000000),u,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

-- Prices are appended, never edited: the latest row is the current price.
create function bob.record_store_price(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a uuid; u text; c text; k text; obs date; rec bob.store_article_prices;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['store_article_id','price','currency','price_unit_code','vat_included','source_kind','source_url','note','observed_on']);
 begin
  a:=nullif(p_data->>'store_article_id','')::uuid;
  obs:=case when p_data->'observed_on' is null or p_data->'observed_on'='null'::jsonb then null else (p_data->>'observed_on')::date end;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'material_invalid_field:reference' using errcode='22023'; end;
 u:=bob_private.material_text(p_data,'price_unit_code',16); c:=upper(bob_private.material_text(p_data,'currency',3)); k:=bob_private.material_text(p_data,'source_kind',16);
 if a is null or not exists(select 1 from bob.store_articles where id=a) or (u is not null and not exists(select 1 from bob.catalog_units where code=u))
  or (p_data ? 'vat_included' and p_data->'vat_included'<>'null'::jsonb and jsonb_typeof(p_data->'vat_included')<>'boolean') then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 insert into bob.store_article_prices(store_article_id,price,currency,price_unit_code,vat_included,source_kind,source_url,note,observed_on,recorded_by)
  values(a,bob_private.material_number(p_data,'price',0,1000000000),c,u,case when jsonb_typeof(p_data->'vat_included')='boolean' then (p_data->>'vat_included')::boolean end,
   k,bob_private.material_text(p_data,'source_url',2000),bob_private.material_text(p_data,'note',1000),obs,auth.uid()) returning * into rec;
 update bob.store_articles set updated_at=rec.recorded_at where id=a;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

-- Household stock: create (p_id null, expected 0), revise or remove with the
-- expected revision. Only active household members.
create function bob.save_household_stock(p_household uuid,p_id uuid,p_expected integer,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.household_stock; item uuid; u text; v_name text;
begin
 if p_household is null or not bob_private.has_household_access(p_household) then raise exception 'household_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['catalog_item_id','name','quantity','unit_code','location','notes']);
 begin item:=nullif(p_data->>'catalog_item_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:catalog_item_id' using errcode='22023'; end;
 u:=bob_private.material_text(p_data,'unit_code',16); v_name:=bob_private.material_text(p_data,'name',200);
 if (item is not null and not bob_private.catalog_item_visible(item)) or (u is not null and not exists(select 1 from bob.catalog_units where code=u)) then
  raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 if item is null and v_name is null then raise exception 'household_stock_unnamed' using errcode='22023'; end if;
 if p_id is null then
  if p_expected is distinct from 0 then raise exception 'household_stock_revision' using errcode='22023'; end if;
  insert into bob.household_stock(household_id,catalog_item_id,name,quantity,unit_code,location,notes,created_by,updated_by)
   values(p_household,item,v_name,bob_private.material_number(p_data,'quantity',0,1000000000),u,
    bob_private.material_text(p_data,'location',200),bob_private.material_text(p_data,'notes',2000),auth.uid(),auth.uid()) returning * into h;
  return jsonb_build_object('operation','created','record',to_jsonb(h));
 end if;
 select * into h from bob.household_stock where id=p_id and household_id=p_household for update;
 if not found then raise exception 'household_denied' using errcode='42501'; end if;
 if h.revision is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
 update bob.household_stock set catalog_item_id=item,name=v_name,quantity=bob_private.material_number(p_data,'quantity',0,1000000000),unit_code=u,
  location=bob_private.material_text(p_data,'location',200),notes=bob_private.material_text(p_data,'notes',2000),
  revision=h.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into h;
 return jsonb_build_object('operation','updated','record',to_jsonb(h));
end $$;
create function bob.remove_household_stock(p_household uuid,p_id uuid,p_expected integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.household_stock;
begin
 if p_household is null or not bob_private.has_household_access(p_household) then raise exception 'household_denied' using errcode='42501'; end if;
 select * into h from bob.household_stock where id=p_id and household_id=p_household for update;
 if not found then raise exception 'household_denied' using errcode='42501'; end if;
 if h.revision is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
 delete from bob.household_stock where id=p_id;
 return jsonb_build_object('operation','deleted','id',p_id);
end $$;

revoke all on function bob.add_material_type(jsonb),bob.add_material_size(jsonb),bob.add_material_alias(jsonb),bob.set_catalog_item_spec(uuid,jsonb),
 bob.add_store(jsonb),bob.add_store_article(jsonb),bob.record_store_price(jsonb),bob.save_household_stock(uuid,uuid,integer,jsonb),
 bob.remove_household_stock(uuid,uuid,integer),bob_private.material_axis_guard() from public,anon;
grant execute on function bob.add_material_type(jsonb),bob.add_material_size(jsonb),bob.add_material_alias(jsonb),bob.set_catalog_item_spec(uuid,jsonb),
 bob.add_store(jsonb),bob.add_store_article(jsonb),bob.record_store_price(jsonb),bob.save_household_stock(uuid,uuid,integer,jsonb),
 bob.remove_household_stock(uuid,uuid,integer) to authenticated;

-- Bob's catalog reads expose the combination's material, size, unit, weight,
-- aliases and review status. Definitions without these links read unchanged.
create function bob_private.catalog_item_spec(p_item uuid) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select case when h.material_type_id is null and h.material_size_id is null and h.unit_code is null and h.weight_kg is null and h.review_status is null then null
  else jsonb_build_object('review_status',h.review_status,'unit',h.unit_code,'weight_kg',h.weight_kg,
   'material',case when t.id is null then null else jsonb_build_object('id',t.id,'name',t.name,'category',t.category_code,'review_status',t.review_status) end,
   'size',case when s.id is null then null else jsonb_build_object('id',s.id,'label',s.label,'form',s.form_code,'length_mm',s.length_mm,
     'width_mm',s.width_mm,'depth_mm',s.depth_mm,'review_status',s.review_status) end,
   'aliases',coalesce((select jsonb_agg(x.alias order by x.alias) from (select distinct a.alias from bob.material_aliases a
     where a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) x),'[]'::jsonb)) end
 from bob.catalog_items h left join bob.material_types t on t.id=h.material_type_id left join bob.material_sizes s on s.id=h.material_size_id
 where h.id=p_item
$$;
revoke all on function bob_private.catalog_item_spec(uuid) from public,anon;
grant execute on function bob_private.catalog_item_spec(uuid) to authenticated;

create or replace function bob_private.catalog_record(p_project text,p_id uuid,p_revision integer default null)
 returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',h.id,'revision',r.revision,'current_revision',h.current_revision,
  'scope',case when h.project_id is null then 'shared' else 'project' end,'kind',h.kind,'name',r.name,'aliases',r.aliases,
  'profile_code',r.profile_code,'profile_revision',r.profile_revision,'properties',r.properties,'notes',r.notes,
  'material_id',r.material_id,'material_revision',r.material_revision,
  'material_changed',r.material_id is not null and (select m.current_revision is distinct from r.material_revision from bob.catalog_items m where m.id=r.material_id),
  'has_unknown',r.has_unknown,'parameter_keys',r.parameter_keys,
  'categories',coalesce((select jsonb_agg(c.category_code order by c.category_code) from bob.catalog_item_categories c where c.item_id=h.id and c.item_revision=r.revision),'[]'),
  'source_kind',r.source_kind,'recorded_at',r.recorded_at,'geometry_status','definition_only')
  ||coalesce((select jsonb_build_object('spec',x.spec) from (select bob_private.catalog_item_spec(h.id) as spec) x where x.spec is not null),'{}'::jsonb)
 from bob.catalog_items h join bob.catalog_item_revisions r on r.item_id=h.id and r.revision=coalesce(p_revision,h.current_revision)
 where h.id=p_id and (h.project_id is null or h.project_id=p_project)
$$;

-- Search also matches the linked material and size names and every alias of
-- the definition, its material or its size. Rows keep their id order and cursor.
create or replace function bob.catalog_read(p_project text,p_input jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare action text:=p_input->>'action'; requested_kind text:=p_input->>'kind'; q text:=p_input->>'query'; cursor text:=p_input->>'after';
 requested_id text:=p_input->>'id'; rev integer:=(p_input->>'revision')::integer; profile text:=p_input->>'profile_code';
 filter_values jsonb; normalized jsonb; required_categories text[]; rows jsonb; result jsonb; has_next boolean; lq text;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>20000 or p_input-array['action','kind','query','after','id','revision','profile_code','categories','properties']::text[]<>'{}'
   or (select count(*) from jsonb_object_keys(p_input))<>9 or coalesce(action,'')<>all(array['categories','profiles','profile','search','read']) then raise exception 'catalog_invalid_read' using errcode='22023'; end if;
 if action in ('profile','read') then
   if requested_id is null or length(requested_id)>200 or (rev is not null and rev<1) then raise exception 'catalog_invalid_ref' using errcode='22023'; end if;
   if action='read' then result:=bob_private.catalog_record(p_project,requested_id::uuid,rev);
   else
    select jsonb_build_object('id',p.profile_code,'revision',p.revision,'name',h.name,'form',p.form_code,
      'fields',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('label',d.label,'value_type',d.value_type,'canonical_unit',d.canonical_unit) order by f.position,f.property_key)
        from bob.catalog_profile_fields f join bob.catalog_property_definitions d on d.key=f.property_key where f.profile_code=p.profile_code and f.profile_revision=p.revision),'[]'),
      'rules',coalesce((select jsonb_agg(to_jsonb(r) order by rule_key) from bob.catalog_profile_rules r where r.profile_code=p.profile_code and r.profile_revision=p.revision),'[]'),
      'units',(select jsonb_agg(to_jsonb(u) order by code) from bob.catalog_units u)) into result
      from bob.catalog_profile_revisions p join bob.catalog_profiles h on h.code=p.profile_code where p.published and p.profile_code=requested_id and (rev is null or p.revision=rev) order by p.revision desc limit 1;
   end if;
   return jsonb_build_object('status',case when result is null then 'not_found' else 'ok' end,'projectId',p_project,'record',result);
 end if;
 if (q is not null and length(q)>200) or (cursor is not null and length(cursor)>200) then raise exception 'catalog_invalid_search' using errcode='22023'; end if;
 lq:=lower(btrim(q));
 if action='categories' then
   select coalesce(jsonb_agg(to_jsonb(c) order by c.code),'[]') into rows from (
     select * from bob.catalog_categories where (cursor is null or code>cursor) and (q is null or strpos(lower(label||' '||code||' '||array_to_string(aliases,' ')),lower(q))>0) order by code limit 13) c;
 elsif action='profiles' then
   select coalesce(jsonb_agg(to_jsonb(p) order by p.code),'[]') into rows from (
     select h.code,h.name,max(r.revision) as revision from bob.catalog_profiles h join bob.catalog_profile_revisions r on r.profile_code=h.code
     where r.published and (cursor is null or h.code>cursor) and (q is null or strpos(lower(h.name||' '||h.code),lower(q))>0) group by h.code,h.name order by h.code limit 13) p;
 else
   if requested_kind is not null and requested_kind<>all(array['material','part']) then raise exception 'catalog_invalid_kind' using errcode='22023'; end if;
   if jsonb_typeof(p_input->'categories') is distinct from 'array' or jsonb_array_length(p_input->'categories')>12 or jsonb_typeof(p_input->'properties') is distinct from 'object' then raise exception 'catalog_invalid_filters' using errcode='22023'; end if;
   select coalesce(array_agg(c),'{}') into required_categories from jsonb_array_elements_text(p_input->'categories') c;
   if exists(select 1 from unnest(required_categories) c where not exists(select 1 from bob.catalog_categories where code=c)) then raise exception 'catalog_unknown_category' using errcode='22023'; end if;
   filter_values:='{}';
   if p_input->'properties'<>'{}' then
     normalized:=bob_private.catalog_normalize(profile,rev,p_input->'properties','material',true);
     if (normalized->>'has_unknown')::boolean then raise exception 'catalog_unknown_is_not_wildcard' using errcode='22023'; end if;
     select coalesce(jsonb_object_agg(key,jsonb_build_object('value',value->'value','unit',value->'unit')),'{}') into filter_values from jsonb_each(normalized->'properties');
   end if;
   with recursive descendants as (
      select code as root,code from bob.catalog_categories where code=any(required_categories)
      union select d.root,c.code from bob.catalog_categories c join descendants d on c.parent_code=d.code
   ), page as (
    select h.id,h.kind,r.name,r.profile_code,r.profile_revision,r.revision,r.has_unknown,r.parameter_keys,
      case when h.project_id is null then 'shared' else 'project' end as scope,
      coalesce((select jsonb_agg(c.category_code order by c.category_code) from bob.catalog_item_categories c where c.item_id=h.id and c.item_revision=r.revision),'[]') as categories,
      bob_private.catalog_item_spec(h.id) as spec
    from bob.catalog_items h join bob.catalog_item_revisions r on r.item_id=h.id and r.revision=h.current_revision
    where (h.project_id is null or h.project_id=p_project) and (requested_kind is null or h.kind=requested_kind)
      and (cursor is null or h.id>cursor::uuid) and (profile is null or (r.profile_code=profile and (rev is null or r.profile_revision=rev)))
      and (q is null or strpos(lower(r.name||' '||array_to_string(r.aliases,' ')),lower(q))>0
        or exists(select 1 from bob.material_types t where t.id=h.material_type_id and strpos(lower(coalesce(t.name,'')),lower(q))>0)
        or exists(select 1 from bob.material_sizes s where s.id=h.material_size_id and strpos(lower(coalesce(s.label,'')),lower(q))>0)
        or exists(select 1 from bob.material_aliases a where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id)
          and (lower(btrim(a.alias))=lq or strpos(lower(a.alias),lq)>0 or (char_length(btrim(a.alias))>=3 and strpos(lq,lower(btrim(a.alias)))>0))))
      and r.properties @> filter_values
      and not exists(select 1 from unnest(required_categories) c where not exists(select 1 from bob.catalog_item_categories ic join descendants d on d.code=ic.category_code where d.root=c and ic.item_id=h.id and ic.item_revision=r.revision))
    order by h.id limit 13
   ) select coalesce(jsonb_agg((to_jsonb(page)-'spec')||case when page.spec is null then '{}'::jsonb else jsonb_build_object('spec',page.spec) end order by page.id),'[]') into rows from page;
 end if;
 has_next:=jsonb_array_length(rows)>12;
 return jsonb_build_object('status',case when jsonb_array_length(rows)=0 then 'empty' else 'ok' end,'projectId',p_project,
   'items',case when has_next then rows-12 else rows end,'next_cursor',case when has_next then coalesce(rows->11->>'id',rows->11->>'code') else null end,'truncated',has_next);
end $$;

-- Combined material lookup ("kombo-vy", owner decisions 2026-10-29). Row grain:
-- one row per combination (catalog material definition) and purchase place
-- (store article). A combination without a store article returns exactly one
-- row whose store and price fields are null. Material, size, aliases and the
-- caller's household stock are the same on every row of one combination.
-- A single security-definer function over base tables, never views on views:
-- the page of at most 13 (combination, article) keys is chosen first through
-- indexes, then each row reads only its own data.
create function bob_private.material_lookup_row(p_item uuid,p_article uuid,p_households uuid[]) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('id',h.id,'revision',h.current_revision,'name',r.name,
  'scope',case when h.project_id is null then 'shared' else 'project' end,'profile_code',r.profile_code,
  'form',(select ic.category_code from bob.catalog_item_categories ic join bob.catalog_categories c on c.code=ic.category_code and c.axis='form'
    where ic.item_id=h.id and ic.item_revision=h.current_revision order by ic.category_code limit 1),
  'material',case when t.id is null then null else jsonb_build_object('name',t.name,'category',t.category_code,'review_status',t.review_status) end,
  'size',case when s.id is null then null else jsonb_build_object('label',s.label,'length_mm',s.length_mm,'width_mm',s.width_mm,'depth_mm',s.depth_mm,'review_status',s.review_status) end,
  'unit',h.unit_code,'weight_kg',h.weight_kg,'review_status',h.review_status,
  'unreviewed',coalesce(h.review_status='unreviewed',false) or coalesce(t.review_status='unreviewed',false) or coalesce(s.review_status='unreviewed',false),
  'aliases',coalesce((select jsonb_agg(x.alias order by x.alias) from (select distinct a.alias from bob.material_aliases a
    where a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) x),'[]'::jsonb),
  'stock_at_home',coalesce((select jsonb_agg(jsonb_build_object('household',hh.name,'quantity',st.quantity,'unit',st.unit_code,
     'location',st.location,'last_changed_at',st.updated_at) order by st.updated_at desc)
    from (select * from bob.household_stock x where x.catalog_item_id=h.id and x.household_id=any(p_households) order by x.updated_at desc limit 10) st
    left join shared.households hh on hh.id=st.household_id),'[]'::jsonb),
  'store_article_id',a.id,'store',so.name,'city',so.city,'article_number',a.article_number,'price',p.price,'currency',p.currency,
  'price_unit',p.price_unit_code,'vat_included',p.vat_included,'pack_quantity',a.pack_quantity,'pack_unit',a.pack_unit_code,
  'price_source',p.source_kind,'price_source_url',p.source_url,'price_last_changed_at',p.recorded_at,
  'store_unreviewed',case when a.id is null then null else coalesce(so.review_status='unreviewed',false) or coalesce(a.review_status='unreviewed',false) end)
 from bob.catalog_items h join bob.catalog_item_revisions r on r.item_id=h.id and r.revision=h.current_revision
  left join bob.material_types t on t.id=h.material_type_id left join bob.material_sizes s on s.id=h.material_size_id
  left join bob.store_articles a on a.id=p_article and a.catalog_item_id=h.id
  left join bob.stores so on so.id=a.store_id
  left join lateral (select * from bob.store_article_prices z where z.store_article_id=a.id order by z.recorded_at desc,z.id desc limit 1) p on true
 where h.id=p_item
$$;
-- Cursor: '<combination id>:<store article id>' or '<combination id>:-' for the
-- single row of a combination without a store article.
create function bob.material_lookup(p_project text,p_input jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); lq text; v_id uuid; c_item uuid; c_article uuid; required_categories text[]; households uuid[]; rows jsonb; n integer; result jsonb;
 none constant uuid:='00000000-0000-0000-0000-000000000000';
begin
 if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>4000 or p_input-array['query','categories','after','id']<>'{}'
   or (select count(*) from jsonb_object_keys(p_input))<>4 or jsonb_typeof(p_input->'categories') is distinct from 'array' or jsonb_array_length(p_input->'categories')>12
   or exists(select 1 from jsonb_array_elements(p_input->'categories') c where jsonb_typeof(c)<>'string')
   or (p_input->'query'<>'null'::jsonb and (jsonb_typeof(p_input->'query')<>'string' or char_length(btrim(p_input->>'query')) not between 1 and 200))
   or (p_input->'after'<>'null'::jsonb and (jsonb_typeof(p_input->'after')<>'string'
     or p_input->>'after'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-))?$')) then
   raise exception 'material_lookup_invalid' using errcode='22023'; end if;
 begin
  v_id:=case when p_input->'id'='null'::jsonb then null else (p_input->>'id')::uuid end;
 exception when invalid_text_representation then raise exception 'material_lookup_invalid' using errcode='22023'; end;
 if p_input->'after'<>'null'::jsonb then
  c_item:=split_part(p_input->>'after',':',1)::uuid;
  -- A bare combination id continues after all of that combination's rows.
  c_article:=case split_part(p_input->>'after',':',2) when '' then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid when '-' then none else split_part(p_input->>'after',':',2)::uuid end;
 end if;
 select coalesce(array_agg(c),'{}') into required_categories from jsonb_array_elements_text(p_input->'categories') c;
 if exists(select 1 from unnest(required_categories) c where not exists(select 1 from bob.catalog_categories where code=c)) then raise exception 'catalog_unknown_category' using errcode='22023'; end if;
 lq:=lower(btrim(p_input->>'query'));
 -- Stock is shown only for households the caller actively belongs to.
 select coalesce(array_agg(a.household_id),'{}') into households from shared.household_access a where a.user_id=uid and a.status='active';
 with recursive descendants as (
   select code as root,code from bob.catalog_categories where code=any(required_categories)
   union select d.root,c.code from bob.catalog_categories c join descendants d on c.parent_code=d.code
 ), matched as (
  select h.id from bob.catalog_items h
  where h.kind='material' and (h.project_id is null or h.project_id=p_project) and (v_id is null or h.id=v_id) and (c_item is null or h.id>=c_item)
   and (lq is null
    or exists(select 1 from bob.catalog_item_revisions r where r.item_id=h.id and r.revision=h.current_revision and strpos(lower(r.name||' '||array_to_string(r.aliases,' ')),lq)>0)
    or exists(select 1 from bob.material_types t where t.id=h.material_type_id and strpos(lower(coalesce(t.name,'')),lq)>0)
    or exists(select 1 from bob.material_sizes s where s.id=h.material_size_id and strpos(lower(coalesce(s.label,'')),lq)>0)
    or exists(select 1 from bob.material_aliases a where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id)
      and (lower(btrim(a.alias))=lq or strpos(lower(a.alias),lq)>0 or (char_length(btrim(a.alias))>=3 and strpos(lq,lower(btrim(a.alias)))>0))))
   and not exists(select 1 from unnest(required_categories) c where not exists(select 1 from bob.catalog_item_categories ic join descendants d on d.code=ic.category_code
     where d.root=c and ic.item_id=h.id and ic.item_revision=h.current_revision))
 ), page as (
  select m.id as item_id,a.id as article_id from matched m left join bob.store_articles a on a.catalog_item_id=m.id
  where c_item is null or (m.id,coalesce(a.id,none))>(c_item,c_article)
  order by m.id,coalesce(a.id,none) limit 13
 ) select coalesce(jsonb_agg(bob_private.material_lookup_row(page.item_id,page.article_id,households) order by page.item_id,coalesce(page.article_id,none)),'[]'::jsonb)
   into rows from page;
 n:=jsonb_array_length(rows);
 if n>12 then rows:=rows-12; end if;
 result:=jsonb_build_object('status',case when n=0 then 'empty' else 'ok' end,'projectId',p_project,'grain','combination_store_article',
  'items',rows,'truncated',n>12,'next_cursor',case when n>12 then (rows->-1->>'id')||':'||coalesce(rows->-1->>'store_article_id','-') else null end);
 -- Same envelope cap as other Bob reads: drop trailing rows and page on.
 while octet_length(result::text)>30000 loop
  n:=jsonb_array_length(result->'items');
  if n<=1 then raise exception 'material_lookup_too_large' using errcode='22023'; end if;
  rows:=(result->'items')-(n-1);
  result:=result||jsonb_build_object('items',rows,'truncated',true,'next_cursor',(rows->-1->>'id')||':'||coalesce(rows->-1->>'store_article_id','-'));
 end loop;
 return result;
end $$;
revoke all on function bob_private.material_lookup_row(uuid,uuid,uuid[]) from public,anon,authenticated;
revoke all on function bob.material_lookup(text,jsonb) from public,anon;
grant execute on function bob.material_lookup(text,jsonb) to authenticated;

-- Seed helper: a known length is a declared specification; an unknown required
-- length stays unknown with a note.
create function bob_private.seed_length(p_mm numeric,p_note text) returns jsonb language sql immutable set search_path='' as $$
 select case when p_mm is null then jsonb_build_object('value',null,'unit','mm','truth','unknown','parameter',null,'note',p_note)
  else jsonb_build_object('value',trim_scale(p_mm)::text,'unit','mm','truth','provided_spec','parameter',null,'note','Standardmått i startlistan.') end
$$;
revoke all on function bob_private.seed_length(numeric,text) from public,anon,authenticated;

comment on table bob.material_types is 'Standard materials (owner decision 2026-10-29). Shared; unreviewed unless an operator reviewed it.';
comment on table bob.material_sizes is 'Sizes in mm by form. Fasteners: width_mm = nominal shank diameter, length_mm = length, depth_mm null.';
comment on table bob.material_aliases is 'Search words for exactly one material, size or combination. Never a unit conversion; Bob reports actual mm.';
comment on table bob.household_stock is 'Household stock "har hemma", linked to a catalog material definition. Not project allocation.';
comment on table bob.store_article_prices is 'Append-only shared price history; the latest row per article is current (bob.current_store_prices).';
commit;
