-- Owner decisions 2026-10-29 (follow-up 1): when Bob saves a new material, it is
-- also created or reused as a shared, unreviewed standard material with a size,
-- and only the specification is shared. Bob's project definition keeps its own
-- name, aliases and notes; the shared entry is named from the material category
-- and the size, carries only dimensions, and is linked from the project
-- definition so the combined lookup shows it. Incomplete, parameterised or
-- part-pinned definitions are not shared, nor are dimensioned forms the size
-- table cannot hold (tubes, rolls with stated dimensions): one size-less entry
-- would otherwise carry the first definition's dimensions for every other. A later revision whose dimensions no
-- longer fit the linked size is relinked to a fitting shared entry.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.material_number_label(p numeric) returns text
 language sql immutable set search_path='' as $$ select replace(trim_scale(p)::text,'.',',') $$;
revoke all on function bob_private.material_number_label(numeric) from public,anon,authenticated;

create function bob_private.share_material_spec(p_item uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare h bob.catalog_items; r bob.catalog_item_revisions; v_material text; v_form text; v_label text;
 d numeric; w numeric; l numeric; size_label text; type_id uuid; size_id uuid; shared uuid; s bob.material_sizes;
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
 -- Dimensions, never Bob's words.
 d:=case when r.profile_code in ('sheet_stock','rectangular_profile') then (r.properties->'thickness'->>'value')::numeric end;
 w:=case r.profile_code when 'rectangular_profile' then (r.properties->'width'->>'value')::numeric when 'fastener' then (r.properties->'diameter'->>'value')::numeric end;
 l:=case when r.profile_code='fastener' then (r.properties->'length'->>'value')::numeric end;
 size_label:=case r.profile_code
  when 'sheet_stock' then bob_private.material_number_label(d)||' mm'
  when 'rectangular_profile' then bob_private.material_number_label(d)||' × '||bob_private.material_number_label(w)
  when 'fastener' then bob_private.material_number_label(w)||' × '||bob_private.material_number_label(l) end;
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
   and z.length_mm is not distinct from l order by z.review_status='reviewed' desc,z.created_at limit 1;
  if not found then
   insert into bob.material_sizes(label,form_code,length_mm,width_mm,depth_mm,review_status,created_by)
    values(size_label,v_form,l,w,d,'unreviewed',auth.uid()) returning id into size_id;
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

-- Every saved project material is offered for sharing before its result is read.
do $share_on_save$
declare definition text;
 anchor constant text:=$a$ result:=bob_private.catalog_record(p_project,chosen,next_revision);$a$;
begin
 definition:=pg_get_functiondef('bob_private.catalog_save(text,uuid,integer,jsonb,jsonb)'::regprocedure);
 if (char_length(definition)-char_length(replace(definition,anchor,'')))/char_length(anchor)<>1 then raise exception 'material_share_anchor'; end if;
 execute replace(definition,anchor,$a$ if d->>'kind'='material' then perform bob_private.share_material_spec(chosen); end if;
$a$||anchor);
end $share_on_save$;
commit;
