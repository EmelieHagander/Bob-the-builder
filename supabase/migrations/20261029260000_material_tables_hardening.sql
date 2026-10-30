-- Owner decisions 2026-10-29, after the independent review of the material
-- tables (Docs/archive/material-tables-review-2026-10-29.md), before any write
-- path is opened. Every shared and household table holds 0 written rows today.
--  1. Only Bob project participants contribute to the shared catalog (household
--     membership from another app is not enough).
--  2. Shared aliases, store articles and household stock may name only shared
--     definitions, never a project's private one.
--  3. Unreviewed aliases and prices stay visible as unreviewed: they rank after
--     reviewed matches, and a reviewed price wins over a newer unreviewed one.
--  4. A definition's material, size, unit and weight links change only against
--     its current revision, must agree with its category, form, unit kind and
--     stated dimensions, and are omitted from reads of older revisions.
--  5. Household stock keeps its history, records a name, needs a unit with a
--     quantity, and project stock may point at it without promising more than
--     the household has.
--  6. Prices state whether they are per unit or per pack; an empty price is
--     never the current one.
--  7. Empty or mislabelled shared rows are refused; linked materials and sizes
--     cannot be deleted from under their definitions.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- 1. Contributors: a participant in at least one Bob project.
create or replace function bob_private.is_bob_participant() returns boolean
 language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from bob.projects p where bob_private.project_access_for_user(p.id,auth.uid()))
$$;
revoke all on function bob_private.is_bob_participant() from public,anon,authenticated;

-- 2. Shared rows may reference shared definitions only.
create function bob_private.catalog_item_shared(p_item uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from bob.catalog_items i where i.id=p_item and i.project_id is null)
$$;
revoke all on function bob_private.catalog_item_shared(uuid) from public,anon,authenticated;

-- 3, 6. Price review and basis.
alter table bob.store_article_prices
 add column review_status text not null default 'unreviewed' check(review_status in ('reviewed','unreviewed')),
 add column price_basis text check(price_basis is null or price_basis in ('unit','pack'));

-- 5. Household stock history and the project link.
create table bob.household_stock_revisions (
 household_stock_id uuid not null,
 household_id uuid not null references shared.households(id) on delete cascade,
 revision integer not null,
 catalog_item_id uuid,
 name text,
 quantity numeric(18,4),
 unit_code text,
 location text,
 notes text,
 removed boolean not null default false,
 recorded_by uuid,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(household_stock_id,revision,removed)
);
alter table bob.household_stock_revisions enable row level security;
revoke all on bob.household_stock_revisions from public,anon,authenticated;
grant select on bob.household_stock_revisions to authenticated;
grant all on bob.household_stock_revisions to service_role;
create policy household_read on bob.household_stock_revisions for select to authenticated using (bob_private.has_household_access(household_id));
create function bob_private.household_stock_history() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  insert into bob.household_stock_revisions(household_stock_id,household_id,revision,catalog_item_id,name,quantity,unit_code,location,notes,removed,recorded_by)
   values(old.id,old.household_id,old.revision,old.catalog_item_id,old.name,old.quantity,old.unit_code,old.location,old.notes,true,auth.uid());
  return old;
 end if;
 insert into bob.household_stock_revisions(household_stock_id,household_id,revision,catalog_item_id,name,quantity,unit_code,location,notes,recorded_by)
  values(new.id,new.household_id,new.revision,new.catalog_item_id,new.name,new.quantity,new.unit_code,new.location,new.notes,coalesce(new.updated_by,new.created_by));
 return new;
end $$;
revoke all on function bob_private.household_stock_history() from public,anon,authenticated;
create trigger household_stock_history after insert or update or delete on bob.household_stock
 for each row execute function bob_private.household_stock_history();

alter table bob.stock_revisions add column household_stock_id uuid references bob.household_stock(id) on delete restrict;
create index stock_revisions_household_stock_idx on bob.stock_revisions(household_stock_id) where household_stock_id is not null;

-- Quantity currently promised by project stock from one household row.
create function bob_private.household_stock_promised(p_row uuid) returns numeric
 language sql stable security definer set search_path='' as $$
 select coalesce(sum(r.quantity),0) from bob.stock_items i
  join bob.stock_revisions r on r.stock_id=i.id and r.revision=i.current_revision
 where r.household_stock_id=p_row and not r.archived
$$;
revoke all on function bob_private.household_stock_promised(uuid) from public,anon,authenticated;

-- 7. Linked materials and sizes cannot disappear under their definitions.
alter table bob.catalog_items drop constraint catalog_items_material_type_id_fkey,
 add constraint catalog_items_material_type_id_fkey foreign key(material_type_id) references bob.material_types(id) on delete restrict;
alter table bob.catalog_items drop constraint catalog_items_material_size_id_fkey,
 add constraint catalog_items_material_size_id_fkey foreign key(material_size_id) references bob.material_sizes(id) on delete restrict;
create unique index material_sizes_spec_idx on bob.material_sizes(coalesce(form_code,''),coalesce(length_mm,-1),coalesce(width_mm,-1),coalesce(depth_mm,-1),lower(coalesce(btrim(label),'')));

-- Which units fit a profile, and which dimension a size column carries.
create function bob_private.material_profile_units(p_profile text) returns text[]
 language sql immutable set search_path='' as $$
 select case p_profile when 'sheet_stock' then array['pcs','m2'] when 'rectangular_profile' then array['m','pcs']
  when 'tube_stock' then array['m','pcs'] when 'fastener' then array['pcs','kg'] when 'roll_stock' then array['m','m2','pcs']
  when 'piece' then array['pcs'] when 'bulk' then array['kg','m3','l','pcs'] when 'liquid' then array['l','ml','pcs'] else null end
$$;
create function bob_private.material_size_conflict(p_properties jsonb,p_profile text,s bob.material_sizes) returns boolean
 language sql immutable set search_path='' as $$
 select coalesce(bool_or(prop.v is not null and col.v is not null and prop.v<>col.v),false) from (
  select (p_properties->'thickness'->>'value')::numeric v,'depth' k where p_profile in ('sheet_stock','rectangular_profile')
  union all select (p_properties->'width'->>'value')::numeric,'width' where p_profile='rectangular_profile'
  union all select (p_properties->'diameter'->>'value')::numeric,'width' where p_profile='fastener'
  union all select (p_properties->'length'->>'value')::numeric,'length' where p_profile='fastener'
 ) prop join (select s.depth_mm v,'depth' k union all select s.width_mm,'width' union all select s.length_mm,'length') col on col.k=prop.k
$$;
revoke all on function bob_private.material_profile_units(text),bob_private.material_size_conflict(jsonb,text,bob.material_sizes) from public,anon,authenticated;

-- 7. A material needs a name; a name belongs to one material category.
create or replace function bob.add_material_type(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_name text; v_category text; v_description text; rec bob.material_types;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['name','category_code','description']);
 v_name:=bob_private.material_text(p_data,'name',200); v_category:=bob_private.material_text(p_data,'category_code',64);
 v_description:=bob_private.material_text(p_data,'description',2000);
 if v_name is null then raise exception 'material_invalid_field:name' using errcode='22023'; end if;
 select * into rec from bob.material_types where lower(btrim(name))=lower(v_name);
 if found then
  if v_category is not null and rec.category_code is distinct from v_category then raise exception 'material_type_category_conflict' using errcode='22023'; end if;
  return jsonb_build_object('operation','reused','record',to_jsonb(rec)-'seed_key');
 end if;
 insert into bob.material_types(name,category_code,description,review_status,created_by)
  values(v_name,v_category,v_description,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec)-'seed_key');
end $$;

-- 7. Sizes are equal only with the same label, form and dimensions.
create or replace function bob.add_material_size(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_label text; v_form text; l numeric; w numeric; d numeric; rec bob.material_sizes;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['label','form_code','length_mm','width_mm','depth_mm']);
 v_label:=bob_private.material_text(p_data,'label',120); v_form:=bob_private.material_text(p_data,'form_code',64);
 l:=bob_private.material_number(p_data,'length_mm',0.0001,1000000); w:=bob_private.material_number(p_data,'width_mm',0.0001,1000000);
 d:=bob_private.material_number(p_data,'depth_mm',0.0001,1000000);
 if v_label is null then raise exception 'material_invalid_field:label' using errcode='22023'; end if;
 select * into rec from bob.material_sizes s where coalesce(s.form_code,'')=coalesce(v_form,'') and coalesce(s.length_mm,-1)=coalesce(l,-1)
  and coalesce(s.width_mm,-1)=coalesce(w,-1) and coalesce(s.depth_mm,-1)=coalesce(d,-1) and lower(coalesce(btrim(s.label),''))=lower(v_label);
 if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)-'seed_key'); end if;
 insert into bob.material_sizes(label,form_code,length_mm,width_mm,depth_mm,review_status,created_by)
  values(v_label,v_form,l,w,d,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec)-'seed_key');
end $$;

-- 2. Aliases name a shared material, size or definition only.
create or replace function bob.add_material_alias(p_data jsonb) returns jsonb
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
  or (i is not null and not bob_private.catalog_item_shared(i)) then raise exception 'material_alias_target' using errcode='22023'; end if;
 select * into rec from bob.material_aliases a where lower(btrim(a.alias))=lower(v_alias) and coalesce(a.material_type_id,a.material_size_id,a.catalog_item_id)=coalesce(t,s,i);
 if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)); end if;
 insert into bob.material_aliases(alias,material_type_id,material_size_id,catalog_item_id,review_status,created_by)
  values(v_alias,t,s,i,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

-- 4. Spec links: against the current revision, consistent, and partial.
-- Keys left out keep their value; null clears it.
create or replace function bob.set_catalog_item_spec(p_item uuid,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.catalog_items; r bob.catalog_item_revisions; t bob.material_types; s bob.material_sizes; u text; w numeric;
 tid uuid; sid uuid; v_form text; v_material text[];
begin
 perform bob_private.material_payload(p_data,array['revision','material_type_id','material_size_id','unit_code','weight_kg']);
 select * into h from bob.catalog_items where id=p_item for update;
 if not found or h.project_id is null or not bob_private.has_project_access(h.project_id) then raise exception 'material_denied' using errcode='42501'; end if;
 if h.kind<>'material' then raise exception 'material_spec_material_only' using errcode='22023'; end if;
 if jsonb_typeof(p_data->'revision') is distinct from 'number' or (p_data->>'revision')::numeric<>h.current_revision then raise exception 'record_changed' using errcode='40001'; end if;
 select * into r from bob.catalog_item_revisions where item_id=h.id and revision=h.current_revision;
 begin
  tid:=case when p_data?'material_type_id' then nullif(p_data->>'material_type_id','')::uuid else h.material_type_id end;
  sid:=case when p_data?'material_size_id' then nullif(p_data->>'material_size_id','')::uuid else h.material_size_id end;
 exception when invalid_text_representation then raise exception 'material_invalid_field:target' using errcode='22023'; end;
 u:=case when p_data?'unit_code' then bob_private.material_text(p_data,'unit_code',16) else h.unit_code end;
 w:=case when p_data?'weight_kg' then bob_private.material_number(p_data,'weight_kg',0.0001,1000000) else h.weight_kg end;
 select coalesce(array_agg(c.category_code),'{}') into v_material from bob.catalog_item_categories c join bob.catalog_categories k on k.code=c.category_code and k.axis='material'
  where c.item_id=h.id and c.item_revision=r.revision;
 select c.category_code into v_form from bob.catalog_item_categories c join bob.catalog_categories k on k.code=c.category_code and k.axis='form'
  where c.item_id=h.id and c.item_revision=r.revision limit 1;
 if tid is not null then
  select * into t from bob.material_types where id=tid;
  if not found then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
  -- The material's category must be the definition's material category or an ancestor of it.
  if t.category_code is not null and not exists(with recursive up as (select code,parent_code from bob.catalog_categories where code=any(v_material)
    union select c.code,c.parent_code from bob.catalog_categories c join up on c.code=up.parent_code) select 1 from up where code=t.category_code) then
   raise exception 'material_spec_category_mismatch' using errcode='22023'; end if;
 end if;
 if sid is not null then
  select * into s from bob.material_sizes where id=sid;
  if not found then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
  if s.form_code is not null and s.form_code is distinct from v_form then raise exception 'material_spec_form_mismatch' using errcode='22023'; end if;
  if bob_private.material_size_conflict(r.properties,r.profile_code,s) then raise exception 'material_spec_size_mismatch' using errcode='22023'; end if;
 end if;
 if u is not null and (not exists(select 1 from bob.catalog_units where code=u)
   or (bob_private.material_profile_units(r.profile_code) is not null and not u=any(bob_private.material_profile_units(r.profile_code)))) then
  raise exception 'material_spec_unit_mismatch' using errcode='22023'; end if;
 -- Weight is the mass of one unit_code; it needs that unit, and kg has no separate weight.
 if w is not null and (u is null or u='kg') then raise exception 'material_spec_weight_needs_unit' using errcode='22023'; end if;
 update bob.catalog_items set material_type_id=tid,material_size_id=sid,unit_code=u,weight_kg=w where id=p_item;
 return jsonb_build_object('operation','updated','record',bob_private.catalog_record(h.project_id,p_item));
end $$;

-- 7. A store article needs a store and number, or a title.
create or replace function bob.add_store_article(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare st uuid; item uuid; v_number text; v_title text; u text; rec bob.store_articles;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['store_id','catalog_item_id','title','article_number','url','pack_quantity','pack_unit_code']);
 begin
  st:=nullif(p_data->>'store_id','')::uuid; item:=nullif(p_data->>'catalog_item_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:reference' using errcode='22023'; end;
 v_number:=bob_private.material_text(p_data,'article_number',120); v_title:=bob_private.material_text(p_data,'title',200);
 u:=bob_private.material_text(p_data,'pack_unit_code',16);
 if (st is not null and not exists(select 1 from bob.stores where id=st)) or (item is not null and not bob_private.catalog_item_shared(item))
  or (u is not null and not exists(select 1 from bob.catalog_units where code=u)) then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 if (st is null or v_number is null) and v_title is null then raise exception 'material_invalid_field:article' using errcode='22023'; end if;
 if st is not null and v_number is not null then
  select * into rec from bob.store_articles a where a.store_id=st and lower(btrim(a.article_number))=lower(v_number);
  if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)); end if;
 end if;
 insert into bob.store_articles(store_id,catalog_item_id,title,article_number,url,pack_quantity,pack_unit_code,review_status,created_by)
  values(st,item,v_title,v_number,bob_private.material_text(p_data,'url',2000),
   bob_private.material_number(p_data,'pack_quantity',0.0001,1000000000),u,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

-- 3, 6. Prices are appended unreviewed, with their basis; a pack price needs pack content.
create or replace function bob.record_store_price(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a bob.store_articles; aid uuid; u text; c text; k text; b text; obs date; rec bob.store_article_prices;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['store_article_id','price','currency','price_unit_code','price_basis','vat_included','source_kind','source_url','note','observed_on']);
 begin
  aid:=nullif(p_data->>'store_article_id','')::uuid;
  obs:=case when p_data->'observed_on' is null or p_data->'observed_on'='null'::jsonb then null else (p_data->>'observed_on')::date end;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'material_invalid_field:reference' using errcode='22023'; end;
 u:=bob_private.material_text(p_data,'price_unit_code',16); c:=upper(bob_private.material_text(p_data,'currency',3));
 k:=bob_private.material_text(p_data,'source_kind',16); b:=bob_private.material_text(p_data,'price_basis',8);
 select * into a from bob.store_articles where id=aid;
 if aid is null or not found or (u is not null and not exists(select 1 from bob.catalog_units where code=u))
  or (p_data ? 'vat_included' and p_data->'vat_included'<>'null'::jsonb and jsonb_typeof(p_data->'vat_included')<>'boolean') then raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 if b is not null and b not in ('unit','pack') then raise exception 'material_invalid_field:price_basis' using errcode='22023'; end if;
 if b='pack' and a.pack_quantity is null then raise exception 'material_price_pack_unknown' using errcode='22023'; end if;
 insert into bob.store_article_prices(store_article_id,price,currency,price_unit_code,price_basis,vat_included,source_kind,source_url,note,observed_on,recorded_by)
  values(aid,bob_private.material_number(p_data,'price',0,1000000000),c,u,b,case when jsonb_typeof(p_data->'vat_included')='boolean' then (p_data->>'vat_included')::boolean end,
   k,bob_private.material_text(p_data,'source_url',2000),bob_private.material_text(p_data,'note',1000),obs,auth.uid()) returning * into rec;
 update bob.store_articles set updated_at=rec.recorded_at where id=aid;
 return jsonb_build_object('operation','created','record',to_jsonb(rec));
end $$;

-- The current price: the latest stated price, a reviewed one before a newer unreviewed one.
create or replace view bob.current_store_prices with(security_invoker=true) as
 select distinct on (p.store_article_id) p.store_article_id,a.store_id,s.name as store_name,a.catalog_item_id,a.title,a.article_number,
  p.id as price_id,p.price,p.currency,p.price_unit_code,p.vat_included,p.source_kind,p.source_url,p.observed_on,
  p.recorded_at as last_changed_at,p.recorded_by,p.review_status,p.price_basis
 from bob.store_article_prices p join bob.store_articles a on a.id=p.store_article_id left join bob.stores s on s.id=a.store_id
 where p.price is not null
 order by p.store_article_id,(p.review_status='reviewed') desc,p.recorded_at desc,p.id desc;

-- 5. Household stock: shared definitions only, a name kept, a unit with a quantity,
-- and never less than project stock already promises.
create or replace function bob.save_household_stock(p_household uuid,p_id uuid,p_expected integer,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.household_stock; item uuid; u text; v_name text; q numeric; item_unit text; promised numeric;
begin
 if p_household is null or not bob_private.has_household_access(p_household) then raise exception 'household_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['catalog_item_id','name','quantity','unit_code','location','notes']);
 begin item:=nullif(p_data->>'catalog_item_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:catalog_item_id' using errcode='22023'; end;
 u:=bob_private.material_text(p_data,'unit_code',16); v_name:=bob_private.material_text(p_data,'name',200);
 q:=bob_private.material_number(p_data,'quantity',0,1000000000);
 if (item is not null and not bob_private.catalog_item_shared(item)) or (u is not null and not exists(select 1 from bob.catalog_units where code=u)) then
  raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 if q is not null and u is null then raise exception 'household_stock_unit_required' using errcode='22023'; end if;
 if item is not null then
  select i.unit_code into item_unit from bob.catalog_items i where i.id=item;
  if u is not null and item_unit is not null and (select dimension from bob.catalog_units where code=u) is distinct from (select dimension from bob.catalog_units where code=item_unit) then
   raise exception 'household_stock_unit_mismatch' using errcode='22023'; end if;
  -- The definition's current name is kept, so the row stays readable if the link goes.
  if v_name is null then select r.name into v_name from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision where i.id=item; end if;
 end if;
 if v_name is null then raise exception 'household_stock_unnamed' using errcode='22023'; end if;
 if p_id is null then
  if p_expected is distinct from 0 then raise exception 'household_stock_revision' using errcode='22023'; end if;
  insert into bob.household_stock(household_id,catalog_item_id,name,quantity,unit_code,location,notes,created_by,updated_by)
   values(p_household,item,v_name,q,u,bob_private.material_text(p_data,'location',200),bob_private.material_text(p_data,'notes',2000),auth.uid(),auth.uid()) returning * into h;
  return jsonb_build_object('operation','created','record',to_jsonb(h));
 end if;
 select * into h from bob.household_stock where id=p_id and household_id=p_household for update;
 if not found then raise exception 'household_denied' using errcode='42501'; end if;
 if h.revision is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
 promised:=bob_private.household_stock_promised(p_id);
 if promised>0 and (q is null or q<promised or u is distinct from h.unit_code) then raise exception 'household_stock_promised' using errcode='22023'; end if;
 update bob.household_stock set catalog_item_id=item,name=v_name,quantity=q,unit_code=u,
  location=bob_private.material_text(p_data,'location',200),notes=bob_private.material_text(p_data,'notes',2000),
  revision=h.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into h;
 return jsonb_build_object('operation','updated','record',to_jsonb(h));
end $$;
create or replace function bob.remove_household_stock(p_household uuid,p_id uuid,p_expected integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.household_stock;
begin
 if p_household is null or not bob_private.has_household_access(p_household) then raise exception 'household_denied' using errcode='42501'; end if;
 select * into h from bob.household_stock where id=p_id and household_id=p_household for update;
 if not found then raise exception 'household_denied' using errcode='42501'; end if;
 if h.revision is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
 if exists(select 1 from bob.stock_revisions where household_stock_id=p_id) then raise exception 'household_stock_in_use' using errcode='22023'; end if;
 delete from bob.household_stock where id=p_id;
 return jsonb_build_object('operation','deleted','id',p_id);
end $$;

-- 5. Project stock may point at a household row ("har hemma"). The link is kept
-- across revisions unless replaced; the household must have room for every
-- active project promise, in the same unit.
alter function bob_private.stock_command(text,text,uuid,integer,jsonb) rename to stock_command_before_household_stock;
create function bob_private.stock_command(p_project text,p_action text,p_stock uuid,p_expected integer,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare saved jsonb; link uuid; hs bob.household_stock; r bob.stock_revisions;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid stock command' using errcode='22023'; end if;
 if p_data?'household_stock_id' and p_action not in ('create','revise') then raise exception 'Unsupported stock lifecycle fields' using errcode='22023'; end if;
 begin
  if p_data?'household_stock_id' then link:=nullif(p_data->>'household_stock_id','')::uuid;
  elsif p_action='revise' then select household_stock_id into link from bob.stock_revisions where project_id=p_project and stock_id=p_stock and revision=p_expected; end if;
 exception when invalid_text_representation then raise exception 'material_invalid_field:household_stock_id' using errcode='22023'; end;
 if link is not null then
  select * into hs from bob.household_stock where id=link for update;
  if not found or not bob_private.has_household_access(hs.household_id) then raise exception 'household_denied' using errcode='42501'; end if;
 end if;
 saved:=bob_private.stock_command_before_household_stock(p_project,p_action,p_stock,p_expected,p_data-'household_stock_id');
 if p_action in ('create','revise') then
  update bob.stock_revisions set household_stock_id=link where stock_id=p_stock and revision=(saved->>'revision')::integer;
 end if;
 select * into r from bob.stock_revisions where stock_id=p_stock and revision=(saved->>'revision')::integer;
 if r.household_stock_id is not null then
  if hs.id is null then select * into hs from bob.household_stock where id=r.household_stock_id for update; end if;
  if hs.unit_code is distinct from r.unit then raise exception 'household_stock_unit_mismatch' using errcode='22023'; end if;
  if not r.archived and (hs.quantity is null or bob_private.household_stock_promised(hs.id)>hs.quantity) then
   raise exception 'household_stock_overpromised' using errcode='22023'; end if;
 end if;
 return saved;
end $$;
revoke all on function bob_private.stock_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.stock_command(text,text,uuid,integer,jsonb) to authenticated;
revoke all on function bob_private.stock_command_before_household_stock(text,text,uuid,integer,jsonb) from public,anon,authenticated;

-- 3. The lookup row: reviewed and unreviewed aliases apart, the current price by
-- the rule above, and stock at home null when nothing is recorded.
create or replace function bob_private.material_lookup_row(p_item uuid,p_article uuid,p_households uuid[]) returns jsonb
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
    where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) and a.review_status is distinct from 'unreviewed') x),'[]'::jsonb),
  'unreviewed_aliases',coalesce((select jsonb_agg(x.alias order by x.alias) from (select distinct a.alias from bob.material_aliases a
    where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) and a.review_status='unreviewed') x),'[]'::jsonb),
  'stock_at_home',((select jsonb_agg(jsonb_build_object('household',hh.name,'quantity',st.quantity,'unit',st.unit_code,
     'location',st.location,'last_changed_at',st.updated_at) order by st.updated_at desc)
    from (select * from bob.household_stock x where x.catalog_item_id=h.id and x.household_id=any(p_households) order by x.updated_at desc limit 10) st
    left join shared.households hh on hh.id=st.household_id)),
  'store_article_id',a.id,'store',so.name,'city',so.city,'article_number',a.article_number,'price',p.price,'currency',p.currency,
  'price_unit',p.price_unit_code,'price_basis',p.price_basis,'vat_included',p.vat_included,'pack_quantity',a.pack_quantity,'pack_unit',a.pack_unit_code,
  'price_source',p.source_kind,'price_source_url',p.source_url,'price_last_changed_at',p.recorded_at,
  'price_unreviewed',case when p.id is null then null else p.review_status='unreviewed' end,
  'store_unreviewed',case when a.id is null then null else coalesce(so.review_status='unreviewed',false) or coalesce(a.review_status='unreviewed',false) end)
 from bob.catalog_items h join bob.catalog_item_revisions r on r.item_id=h.id and r.revision=h.current_revision
  left join bob.material_types t on t.id=h.material_type_id left join bob.material_sizes s on s.id=h.material_size_id
  left join bob.store_articles a on a.id=p_article and a.catalog_item_id=h.id
  left join bob.stores so on so.id=a.store_id
  left join lateral (select * from bob.store_article_prices z where z.store_article_id=a.id and z.price is not null
   order by (z.review_status='reviewed') desc,z.recorded_at desc,z.id desc limit 1) p on true
 where h.id=p_item
$$;
revoke all on function bob_private.material_lookup_row(uuid,uuid,uuid[]) from public,anon,authenticated;

-- 3. Matching: unreviewed aliases still find a definition, but such a match and
-- unreviewed definitions come after reviewed ones.
do $lookup_rank$
declare definition text; edits text[]; edit text[];
begin
 definition:=pg_get_functiondef('bob.material_lookup(text,jsonb)'::regprocedure);
 edits:=array[
  array[$a$  select h.id,case when words is null then '{}'::text[] else bob_private.material_tokens(concat_ws(' ',r.name,array_to_string(r.aliases,' '),t.name,s.label,
    (select string_agg(a.alias,' ') from bob.material_aliases a
      where a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id))) end as tokens$a$,
        $a$  select h.id,case when words is null then '{}'::text[] else bob_private.material_tokens(concat_ws(' ',r.name,array_to_string(r.aliases,' '),t.name,s.label,
    (select string_agg(a.alias,' ') from bob.material_aliases a
      where a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id))) end as tokens,
   case when words is null then '{}'::text[] else bob_private.material_tokens(concat_ws(' ',r.name,array_to_string(r.aliases,' '),t.name,s.label,
    (select string_agg(a.alias,' ') from bob.material_aliases a
      where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) and a.review_status is distinct from 'unreviewed'))) end as reviewed_tokens,
   coalesce(h.review_status='unreviewed',false) or coalesce(t.review_status='unreviewed',false) or coalesce(s.review_status='unreviewed',false) as unreviewed$a$],
  array[$a$  select c.id,case when words is null or words<@c.tokens then 0 else 1 end as rank from candidates c$a$,
        $a$  select c.id,(case when words is null or words<@c.tokens then 0 else 2 end)
    +(case when c.unreviewed or (words is not null and exists(select 1 from unnest(words) q where not exists(select 1 from unnest(c.reviewed_tokens) w
      where w=q or (char_length(q)>=4 and char_length(w)>char_length(q) and right(w,char_length(q))=q)))) then 1 else 0 end) as rank from candidates c$a$]];
 foreach edit slice 1 in array edits loop
  if (char_length(definition)-char_length(replace(definition,edit[1],'')))/char_length(edit[1])<>1 then raise exception 'material_lookup_rank_anchor'; end if;
  definition:=replace(definition,edit[1],edit[2]);
 end loop;
 execute definition;
end $lookup_rank$;

-- 4. Reads of an older revision carry no current spec links.
do $spec_current$
declare definition text;
 anchor constant text:=$a$(select bob_private.catalog_item_spec(h.id) as spec) x where x.spec is not null)$a$;
begin
 definition:=pg_get_functiondef('bob_private.catalog_record(text,uuid,integer)'::regprocedure);
 if (char_length(definition)-char_length(replace(definition,anchor,'')))/char_length(anchor)<>1 then raise exception 'catalog_record_spec_anchor'; end if;
 execute replace(definition,anchor,$a$(select bob_private.catalog_item_spec(h.id) as spec) x where x.spec is not null and r.revision=h.current_revision)$a$);
end $spec_current$;
notify pgrst,'reload schema';
commit;
