-- Owner decision 2026-10-30: fix the remaining small material-table findings
-- (archive/material-tables-review-2026-10-29.md M2, M3, M6, M8, M9).
-- - Sizes get a diameter: a fastener's shank or a tube's outside diameter.
--   depth_mm is the material thickness everywhere (sheet, profile, tube wall),
--   so tubes can now be shared sizes. Sizes keep six decimals like properties.
-- - Nails are labelled diameter first like screws; "Utomhusskruv, C4/rostfri"
--   becomes "Utomhusskruv C4" plus a separate "Rostfri skruv" with the same sizes.
-- - Household stock can say "6 pieces × 3.0 m".
-- - A store's articles are indexed; the unused supplier link goes; the lookup
--   reads the current price from the one current-price view. The seed helper
--   stays, because the start-list seed must stay re-appliable.
-- Changing shared definitions bumps every project's artifact source epoch,
-- as any shared catalog change does.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- 1. Sizes: six decimals, a diameter column, fasteners moved to it, nails diameter first.
drop index bob.material_sizes_spec_idx;
alter table bob.material_sizes
 alter column length_mm type numeric(16,6),
 alter column width_mm type numeric(16,6),
 alter column depth_mm type numeric(16,6),
 add column diameter_mm numeric(16,6) check(diameter_mm is null or (diameter_mm>0 and diameter_mm<=1000000));
update bob.material_sizes set diameter_mm=width_mm,width_mm=null where form_code='fastener' and width_mm is not null;
update bob.material_sizes set label='3,4 × 100' where seed_key='n100x34' and label='100 × 3,4';
update bob.material_sizes set label='2,8 × 75' where seed_key='n75x28' and label='75 × 2,8';
create unique index material_sizes_spec_idx on bob.material_sizes(coalesce(form_code,''),coalesce(length_mm,-1),coalesce(width_mm,-1),
 coalesce(depth_mm,-1),coalesce(diameter_mm,-1),lower(coalesce(btrim(label),'')));
comment on table bob.material_sizes is 'Sizes in mm by form. depth_mm is the material thickness (sheet, profile, tube wall); diameter_mm is a fastener''s shank or a tube''s outside diameter; labels put diameter first.';

-- A length in mm with up to six decimals, like definition properties.
create function bob_private.material_mm(p jsonb,k text) returns numeric
 language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if p->k is null or p->k='null'::jsonb then return null; end if;
 if jsonb_typeof(p->k) not in ('number','string') or (p->>k)!~'^[0-9]{1,7}([.,][0-9]{1,6})?$' then raise exception 'material_invalid_field:%',k using errcode='22023'; end if;
 n:=replace(p->>k,',','.')::numeric;
 if n<=0 or n>1000000 then raise exception 'material_invalid_field:%',k using errcode='22023'; end if;
 return n;
end $$;
revoke all on function bob_private.material_mm(jsonb,text) from public,anon,authenticated;

-- Which revision property a size column carries, per profile.
create or replace function bob_private.material_size_conflict(p_properties jsonb,p_profile text,s bob.material_sizes) returns boolean
 language sql immutable set search_path='' as $$
 select coalesce(bool_or(prop.v is not null and col.v is not null and prop.v<>col.v),false) from (
  select (p_properties->'thickness'->>'value')::numeric v,'depth' k where p_profile in ('sheet_stock','rectangular_profile')
  union all select (p_properties->'width'->>'value')::numeric,'width' where p_profile='rectangular_profile'
  union all select (p_properties->'diameter'->>'value')::numeric,'diameter' where p_profile='fastener'
  union all select (p_properties->'length'->>'value')::numeric,'length' where p_profile='fastener'
  union all select (p_properties->'outside_diameter'->>'value')::numeric,'diameter' where p_profile='tube_stock'
  union all select (p_properties->'wall_thickness'->>'value')::numeric,'depth' where p_profile='tube_stock'
 ) prop join (select s.depth_mm v,'depth' k union all select s.width_mm,'width' union all select s.length_mm,'length'
  union all select s.diameter_mm,'diameter') col on col.k=prop.k
$$;

create or replace function bob.add_material_size(p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_label text; v_form text; l numeric; w numeric; d numeric; dia numeric; rec bob.material_sizes;
begin
 if not bob_private.is_bob_participant() then raise exception 'material_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['label','form_code','length_mm','width_mm','depth_mm','diameter_mm']);
 v_label:=bob_private.material_text(p_data,'label',120); v_form:=bob_private.material_text(p_data,'form_code',64);
 l:=bob_private.material_mm(p_data,'length_mm'); w:=bob_private.material_mm(p_data,'width_mm');
 d:=bob_private.material_mm(p_data,'depth_mm'); dia:=bob_private.material_mm(p_data,'diameter_mm');
 if v_label is null then raise exception 'material_invalid_field:label' using errcode='22023'; end if;
 select * into rec from bob.material_sizes s where coalesce(s.form_code,'')=coalesce(v_form,'') and coalesce(s.length_mm,-1)=coalesce(l,-1)
  and coalesce(s.width_mm,-1)=coalesce(w,-1) and coalesce(s.depth_mm,-1)=coalesce(d,-1) and coalesce(s.diameter_mm,-1)=coalesce(dia,-1)
  and lower(coalesce(btrim(s.label),''))=lower(v_label);
 if found then return jsonb_build_object('operation','reused','record',to_jsonb(rec)-'seed_key'); end if;
 insert into bob.material_sizes(label,form_code,length_mm,width_mm,depth_mm,diameter_mm,review_status,created_by)
  values(v_label,v_form,l,w,d,dia,'unreviewed',auth.uid()) returning * into rec;
 return jsonb_build_object('operation','created','record',to_jsonb(rec)-'seed_key');
end $$;

-- 2. Bob's shared specifications: fasteners use the diameter column, and tubes get a size.
create or replace function bob_private.share_material_spec(p_item uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare h bob.catalog_items; r bob.catalog_item_revisions; v_material text; v_form text; v_label text;
 d numeric; w numeric; l numeric; dia numeric; size_label text; type_id uuid; size_id uuid; shared uuid; s bob.material_sizes;
 props jsonb; normalized jsonb; cats text[]; identity_doc jsonb; fingerprint text; v_name text;
 v_notes constant text:='Delat standardmaterial från en projektdefinition: endast specifikationen. Produkt, kvalitet och vikt är inte verifierade.';
begin
 perform pg_advisory_xact_lock(hashtextextended('bob:catalog:',0));
 select * into h from bob.catalog_items where id=p_item for update;
 if not found or h.project_id is null or h.kind<>'material' then return; end if;
 select * into r from bob.catalog_item_revisions where item_id=h.id and revision=h.current_revision;
 -- A revision that no longer fits its linked size is unlinked first.
 if h.material_size_id is not null then
  select * into s from bob.material_sizes where id=h.material_size_id;
  if bob_private.material_size_conflict(r.properties,r.profile_code,s) then
   update bob.catalog_items set material_type_id=null,material_size_id=null where id=h.id;
   h.material_type_id:=null; h.material_size_id:=null;
  end if;
 end if;
 if h.material_type_id is not null or h.material_size_id is not null then return; end if;
 if h.identity_hash is null or r.has_unknown or cardinality(r.parameter_keys)>0 or r.material_id is not null
   or r.profile_code not in ('sheet_stock','rectangular_profile','fastener','tube_stock','roll_stock','piece','bulk','liquid') then return; end if;
 select c.category_code,k.label into v_material,v_label from bob.catalog_item_categories c join bob.catalog_categories k on k.code=c.category_code and k.axis='material'
  where c.item_id=h.id and c.item_revision=r.revision order by c.category_code limit 1;
 select c.category_code into v_form from bob.catalog_item_categories c join bob.catalog_categories k on k.code=c.category_code and k.axis='form'
  where c.item_id=h.id and c.item_revision=r.revision order by c.category_code limit 1;
 if v_material is null or v_form is null then return; end if;
 -- Dimensions, never Bob's words. depth is the thickness (a tube's wall); diameter a fastener's shank or a tube's outside.
 d:=case when r.profile_code in ('sheet_stock','rectangular_profile') then (r.properties->'thickness'->>'value')::numeric
  when r.profile_code='tube_stock' then (r.properties->'wall_thickness'->>'value')::numeric end;
 w:=case when r.profile_code='rectangular_profile' then (r.properties->'width'->>'value')::numeric end;
 dia:=case r.profile_code when 'fastener' then (r.properties->'diameter'->>'value')::numeric when 'tube_stock' then (r.properties->'outside_diameter'->>'value')::numeric end;
 l:=case when r.profile_code='fastener' then (r.properties->'length'->>'value')::numeric end;
 size_label:=case r.profile_code
  when 'sheet_stock' then bob_private.material_number_label(d)||' mm'
  when 'rectangular_profile' then bob_private.material_number_label(d)||' × '||bob_private.material_number_label(w)
  when 'fastener' then bob_private.material_number_label(dia)||' × '||bob_private.material_number_label(l)
  when 'tube_stock' then 'Ø '||bob_private.material_number_label(dia)||' × '||bob_private.material_number_label(d) end;
 select coalesce(jsonb_object_agg(key,value),'{}') into props from jsonb_each(r.properties) where value->>'unit' is not null;
 if size_label is null and props<>'{}'::jsonb then return; end if;
 -- The material: the category's own generic entry.
 select t.id into type_id from bob.material_types t where lower(btrim(t.name))=lower(v_label);
 if found then
  if (select category_code from bob.material_types where id=type_id) is distinct from v_material then return; end if;
 else
  insert into bob.material_types(name,category_code,review_status,created_by) values(v_label,v_material,'unreviewed',auth.uid()) returning id into type_id;
 end if;
 -- The size: an existing one with these dimensions in this form (a reviewed one first), else a new unreviewed one.
 if size_label is not null then
  select z.id into size_id from bob.material_sizes z where z.form_code=v_form and z.depth_mm is not distinct from d and z.width_mm is not distinct from w
   and z.length_mm is not distinct from l and z.diameter_mm is not distinct from dia order by z.review_status='reviewed' desc,z.created_at limit 1;
  if not found then
   insert into bob.material_sizes(label,form_code,length_mm,width_mm,depth_mm,diameter_mm,review_status,created_by)
    values(size_label,v_form,l,w,d,dia,'unreviewed',auth.uid()) returning id into size_id;
  end if;
 end if;
 -- The combination: reuse the shared definition for this material and size, else create it from the dimensions only.
 select i.id into shared from bob.catalog_items i where i.project_id is null and i.material_type_id=type_id and i.material_size_id is not distinct from size_id;
 if not found then
  normalized:=bob_private.catalog_normalize(r.profile_code,r.profile_revision,props,'material');
  select array_agg(x order by x) into cats from unnest(array[v_material,v_form]) x;
  v_name:=(select name from bob.material_types where id=type_id)||coalesce(' '||(select label from bob.material_sizes where id=size_id),'');
  identity_doc:=jsonb_build_object('version',1,'kind','material','profile_code',r.profile_code,'profile_revision',r.profile_revision,
   'categories',cats,'properties',normalized->'properties','material_id',null,'material_revision',null,'notes',v_notes);
  fingerprint:=case when (normalized->>'has_unknown')::boolean then null else md5(identity_doc::text) end;
  -- An equal shared definition already exists (for example a seeded one): link to it as it is.
  select i.id into shared from bob.catalog_items i where i.project_id is null and i.kind='material' and i.identity_hash=fingerprint;
  if not found then
   shared:=gen_random_uuid();
   insert into bob.catalog_items(id,project_id,kind,current_revision,identity_hash,material_type_id,material_size_id,review_status)
    values(shared,null,'material',1,fingerprint,type_id,size_id,'unreviewed');
   insert into bob.catalog_item_revisions(item_id,revision,name,aliases,profile_code,profile_revision,properties,material_id,material_revision,notes,has_unknown,parameter_keys,identity_document,source_kind)
    values(shared,1,v_name,'{}',r.profile_code,r.profile_revision,normalized->'properties',null,null,v_notes,(normalized->>'has_unknown')::boolean,
     array(select jsonb_array_elements_text(normalized->'parameter_keys')),identity_doc,r.source_kind);
   insert into bob.catalog_item_categories select shared,1,x from unnest(cats) x;
  end if;
 end if;
 update bob.catalog_items set material_type_id=type_id,material_size_id=size_id where id=h.id;
end $$;
revoke all on function bob_private.share_material_spec(uuid) from public,anon,authenticated;

-- 3. Outdoor screws: C4 and stainless are separate materials; the stainless alias follows.
update bob.material_types set name='Utomhusskruv C4' where seed_key='outdoor_screw' and name='Utomhusskruv, C4/rostfri';
insert into bob.material_types(name,category_code,review_status,seed_key)
 select 'Rostfri skruv','metal','reviewed','stainless_screw' where exists(select 1 from bob.material_types where seed_key='outdoor_screw')
 on conflict do nothing;
update bob.material_aliases set material_type_id=(select id from bob.material_types where seed_key='stainless_screw')
 where lower(btrim(alias))='rostfri skruv' and material_type_id=(select id from bob.material_types where seed_key='outdoor_screw');

-- A renamed seeded material or size gets a new revision of its shared definitions;
-- name and notes follow the start list's pattern, everything else is kept.
do $seed_revisions$
declare i record; r bob.catalog_item_revisions; v_name text; v_notes text; doc jsonb; n integer; new_id uuid;
begin
 for i in select h.id,h.current_revision,h.unit_code,h.material_size_id,t.name type_name,t.seed_key,s.label size_label
   from bob.catalog_items h join bob.material_types t on t.id=h.material_type_id left join bob.material_sizes s on s.id=h.material_size_id
   where h.project_id is null and t.seed_key in ('outdoor_screw','wire_nail_zinc') order by t.seed_key,s.label loop
  select * into r from bob.catalog_item_revisions where item_id=i.id and revision=i.current_revision;
  if r.source_kind<>'seed' then continue; end if;
  v_name:=i.type_name||coalesce(' '||i.size_label,'');
  v_notes:='Standardmaterial från startlistan: '||i.type_name||'. Generisk specifikation; produkt, kvalitet och vikt är inte verifierade.';
  if r.name is distinct from v_name or r.notes is distinct from v_notes then
   doc:=jsonb_set(r.identity_document,'{notes}',to_jsonb(v_notes)); n:=i.current_revision+1;
   insert into bob.catalog_item_revisions(item_id,revision,name,aliases,profile_code,profile_revision,properties,material_id,material_revision,notes,has_unknown,parameter_keys,identity_document,source_kind)
    values(i.id,n,v_name,r.aliases,r.profile_code,r.profile_revision,r.properties,r.material_id,r.material_revision,v_notes,r.has_unknown,r.parameter_keys,doc,r.source_kind);
   insert into bob.catalog_item_categories(item_id,item_revision,category_code)
    select item_id,n,category_code from bob.catalog_item_categories where item_id=i.id and item_revision=r.revision;
   update bob.catalog_items set current_revision=n,identity_hash=case when r.has_unknown then null else md5(doc::text) end where id=i.id;
  end if;
  -- The same outdoor sizes in stainless steel.
  if i.seed_key='outdoor_screw' and not exists(select 1 from bob.catalog_items x join bob.material_types t on t.id=x.material_type_id
    where x.project_id is null and t.seed_key='stainless_screw' and x.material_size_id is not distinct from i.material_size_id) then
   v_name:='Rostfri skruv'||coalesce(' '||i.size_label,'');
   v_notes:='Standardmaterial från startlistan: Rostfri skruv. Generisk specifikation; produkt, kvalitet och vikt är inte verifierade.';
   doc:=jsonb_set(r.identity_document,'{notes}',to_jsonb(v_notes)); new_id:=gen_random_uuid();
   insert into bob.catalog_items(id,project_id,kind,current_revision,identity_hash,material_type_id,material_size_id,unit_code,review_status)
    values(new_id,null,'material',1,case when r.has_unknown then null else md5(doc::text) end,
     (select id from bob.material_types where seed_key='stainless_screw'),i.material_size_id,i.unit_code,'reviewed');
   insert into bob.catalog_item_revisions(item_id,revision,name,aliases,profile_code,profile_revision,properties,material_id,material_revision,notes,has_unknown,parameter_keys,identity_document,source_kind)
    values(new_id,1,v_name,r.aliases,r.profile_code,r.profile_revision,r.properties,r.material_id,r.material_revision,v_notes,r.has_unknown,r.parameter_keys,doc,r.source_kind);
   insert into bob.catalog_item_categories(item_id,item_revision,category_code)
    select new_id,1,category_code from bob.catalog_item_categories where item_id=i.id and item_revision=r.revision;
  end if;
 end loop;
end $seed_revisions$;

-- 4. Household stock: a length per piece ("6 pieces × 3.0 m"), kept in history.
alter table bob.household_stock add column piece_length_mm numeric(16,6)
 check(piece_length_mm is null or (piece_length_mm>0 and piece_length_mm<=1000000)),
 add constraint household_stock_piece_length_pieces check(piece_length_mm is null or unit_code='pcs');
alter table bob.household_stock_revisions add column piece_length_mm numeric(16,6);

create or replace function bob_private.household_stock_history() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  insert into bob.household_stock_revisions(household_stock_id,household_id,revision,catalog_item_id,name,quantity,unit_code,piece_length_mm,location,notes,removed,recorded_by)
   values(old.id,old.household_id,old.revision,old.catalog_item_id,old.name,old.quantity,old.unit_code,old.piece_length_mm,old.location,old.notes,true,auth.uid());
  return old;
 end if;
 insert into bob.household_stock_revisions(household_stock_id,household_id,revision,catalog_item_id,name,quantity,unit_code,piece_length_mm,location,notes,recorded_by)
  values(new.id,new.household_id,new.revision,new.catalog_item_id,new.name,new.quantity,new.unit_code,new.piece_length_mm,new.location,new.notes,coalesce(new.updated_by,new.created_by));
 return new;
end $$;

create or replace function bob.save_household_stock(p_household uuid,p_id uuid,p_expected integer,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bob.household_stock; item uuid; u text; v_name text; q numeric; piece numeric; item_unit text; promised numeric;
begin
 if p_household is null or not bob_private.has_household_access(p_household) then raise exception 'household_denied' using errcode='42501'; end if;
 perform bob_private.material_payload(p_data,array['catalog_item_id','name','quantity','unit_code','piece_length_mm','location','notes']);
 begin item:=nullif(p_data->>'catalog_item_id','')::uuid;
 exception when invalid_text_representation then raise exception 'material_invalid_field:catalog_item_id' using errcode='22023'; end;
 u:=bob_private.material_text(p_data,'unit_code',16); v_name:=bob_private.material_text(p_data,'name',200);
 q:=bob_private.material_number(p_data,'quantity',0,1000000000);
 piece:=bob_private.material_mm(p_data,'piece_length_mm');
 if (item is not null and not bob_private.catalog_item_shared(item)) or (u is not null and not exists(select 1 from bob.catalog_units where code=u)) then
  raise exception 'material_invalid_field:reference' using errcode='22023'; end if;
 if q is not null and u is null then raise exception 'household_stock_unit_required' using errcode='22023'; end if;
 if piece is not null and u is distinct from 'pcs' then raise exception 'household_stock_piece_length_needs_pieces' using errcode='22023'; end if;
 if item is not null then
  select i.unit_code into item_unit from bob.catalog_items i where i.id=item;
  -- Pieces of a stated length also fit a definition counted in length.
  if u is not null and item_unit is not null and (select dimension from bob.catalog_units where code=u) is distinct from (select dimension from bob.catalog_units where code=item_unit)
    and not (piece is not null and (select dimension from bob.catalog_units where code=item_unit)='length') then
   raise exception 'household_stock_unit_mismatch' using errcode='22023'; end if;
  -- The definition's current name is kept, so the row stays readable if the link goes.
  if v_name is null then select r.name into v_name from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision where i.id=item; end if;
 end if;
 if v_name is null then raise exception 'household_stock_unnamed' using errcode='22023'; end if;
 if p_id is null then
  if p_expected is distinct from 0 then raise exception 'household_stock_revision' using errcode='22023'; end if;
  insert into bob.household_stock(household_id,catalog_item_id,name,quantity,unit_code,piece_length_mm,location,notes,created_by,updated_by)
   values(p_household,item,v_name,q,u,piece,bob_private.material_text(p_data,'location',200),bob_private.material_text(p_data,'notes',2000),auth.uid(),auth.uid()) returning * into h;
  return jsonb_build_object('operation','created','record',to_jsonb(h));
 end if;
 select * into h from bob.household_stock where id=p_id and household_id=p_household for update;
 if not found then raise exception 'household_denied' using errcode='42501'; end if;
 if h.revision is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
 promised:=bob_private.household_stock_promised(p_id);
 if promised>0 and (q is null or q<promised or u is distinct from h.unit_code or piece is distinct from h.piece_length_mm) then
  raise exception 'household_stock_promised' using errcode='22023'; end if;
 update bob.household_stock set catalog_item_id=item,name=v_name,quantity=q,unit_code=u,piece_length_mm=piece,
  location=bob_private.material_text(p_data,'location',200),notes=bob_private.material_text(p_data,'notes',2000),
  revision=h.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into h;
 return jsonb_build_object('operation','updated','record',to_jsonb(h));
end $$;

-- 5. The lookup row: diameter, piece length, and the current price from the one current-price view.
create or replace function bob_private.material_lookup_row(p_item uuid,p_article uuid,p_households uuid[]) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('id',h.id,'revision',h.current_revision,'name',r.name,
  'scope',case when h.project_id is null then 'shared' else 'project' end,'profile_code',r.profile_code,
  'form',(select ic.category_code from bob.catalog_item_categories ic join bob.catalog_categories c on c.code=ic.category_code and c.axis='form'
    where ic.item_id=h.id and ic.item_revision=h.current_revision order by ic.category_code limit 1),
  'material',case when t.id is null then null else jsonb_build_object('name',t.name,'category',t.category_code,'review_status',t.review_status) end,
  'size',case when s.id is null then null else jsonb_build_object('label',s.label,'length_mm',s.length_mm,'width_mm',s.width_mm,'depth_mm',s.depth_mm,
    'diameter_mm',s.diameter_mm,'review_status',s.review_status) end,
  'unit',h.unit_code,'weight_kg',h.weight_kg,'review_status',h.review_status,
  'unreviewed',coalesce(h.review_status='unreviewed',false) or coalesce(t.review_status='unreviewed',false) or coalesce(s.review_status='unreviewed',false),
  'aliases',coalesce((select jsonb_agg(x.alias order by x.alias) from (select distinct a.alias from bob.material_aliases a
    where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) and a.review_status is distinct from 'unreviewed') x),'[]'::jsonb),
  'unreviewed_aliases',coalesce((select jsonb_agg(x.alias order by x.alias) from (select distinct a.alias from bob.material_aliases a
    where (a.catalog_item_id=h.id or a.material_type_id=h.material_type_id or a.material_size_id=h.material_size_id) and a.review_status='unreviewed') x),'[]'::jsonb),
  'stock_at_home',((select jsonb_agg(jsonb_build_object('household',hh.name,'quantity',st.quantity,'unit',st.unit_code,'piece_length_mm',st.piece_length_mm,
     'location',st.location,'last_changed_at',st.updated_at) order by st.updated_at desc)
    from (select * from bob.household_stock x where x.catalog_item_id=h.id and x.household_id=any(p_households) order by x.updated_at desc limit 10) st
    left join shared.households hh on hh.id=st.household_id)),
  'store_article_id',a.id,'store',so.name,'city',so.city,'article_number',a.article_number,'price',p.price,'currency',p.currency,
  'price_unit',p.price_unit_code,'price_basis',p.price_basis,'vat_included',p.vat_included,'pack_quantity',a.pack_quantity,'pack_unit',a.pack_unit_code,
  'price_source',p.source_kind,'price_source_url',p.source_url,'price_last_changed_at',p.last_changed_at,
  'price_unreviewed',case when p.price_id is null then null else p.review_status='unreviewed' end,
  'store_unreviewed',case when a.id is null then null else coalesce(so.review_status='unreviewed',false) or coalesce(a.review_status='unreviewed',false) end)
 from bob.catalog_items h join bob.catalog_item_revisions r on r.item_id=h.id and r.revision=h.current_revision
  left join bob.material_types t on t.id=h.material_type_id left join bob.material_sizes s on s.id=h.material_size_id
  left join bob.store_articles a on a.id=p_article and a.catalog_item_id=h.id
  left join bob.stores so on so.id=a.store_id
  left join bob.current_store_prices p on p.store_article_id=a.id
 where h.id=p_item
$$;

-- The definition's spec shows the diameter too.
do $spec_diameter$
declare definition text;
 anchor constant text:=$a$'depth_mm',s.depth_mm,'review_status',s.review_status)$a$;
begin
 definition:=pg_get_functiondef('bob_private.catalog_item_spec(uuid)'::regprocedure);
 if (char_length(definition)-char_length(replace(definition,anchor,'')))/char_length(anchor)<>1 then raise exception 'material_spec_diameter_anchor'; end if;
 execute replace(definition,anchor,$a$'depth_mm',s.depth_mm,'diameter_mm',s.diameter_mm,'review_status',s.review_status)$a$);
end $spec_diameter$;

-- 6. Indexes and unused parts.
create index store_articles_store_idx on bob.store_articles(store_id);
alter table bob.supplier_articles drop column store_article_id;
commit;
