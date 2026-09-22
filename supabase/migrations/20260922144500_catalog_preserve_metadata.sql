-- Catalog revisions may explicitly preserve metadata instead of replacing it.
-- aliases:null / notes:null means preserve on revise; ensure still requires concrete values.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob_private.catalog_save(p_project text,p_id uuid,p_expected integer,p_data jsonb,p_source jsonb)
 returns jsonb language plpgsql set search_path='' as $$
declare d jsonb:=p_data; normalized jsonb; cats text[]; identity_doc jsonb; fingerprint text;
 h bob.catalog_items; mat bob.catalog_item_revisions; current_rev bob.catalog_item_revisions;
 mid uuid; mrev integer; chosen uuid; next_revision integer; prop record; result jsonb; action text:=d->>'action';
 effective_properties jsonb:=d->'properties'; inherited_properties jsonb:='{}'::jsonb; aliases_input text[]; aliases_effective text[]; notes_effective text;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if d-array['action','key','kind','name','aliases','profile_code','profile_revision','categories','properties','material_id','material_revision','notes','source_kind','source_quote','source_seq']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(d))<>15 or coalesce(action,'')<>all(array['ensure','revise']) or coalesce(d->>'kind','')<>all(array['material','part'])
    or jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 200
    or (action='ensure' and (jsonb_typeof(d->'notes') is distinct from 'string' or length(d->>'notes')>2000))
    or (action='revise' and not (d->'notes'='null'::jsonb or (jsonb_typeof(d->'notes')='string' and length(d->>'notes')<=2000)))
    or (action='ensure' and (jsonb_typeof(d->'aliases') is distinct from 'array' or jsonb_array_length(d->'aliases')>12))
    or (action='revise' and not (d->'aliases'='null'::jsonb or (jsonb_typeof(d->'aliases')='array' and jsonb_array_length(d->'aliases')<=12)))
    or jsonb_typeof(d->'categories') is distinct from 'array' or jsonb_array_length(d->'categories') not between 2 and 12
    or jsonb_typeof(d->'profile_revision') is distinct from 'number' or coalesce(d->>'profile_revision','')!~'^[1-9][0-9]{0,8}$' then raise exception 'catalog_invalid_definition' using errcode='22023'; end if;
 if (d->'aliases'<>'null'::jsonb and exists(select 1 from jsonb_array_elements(d->'aliases') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 200))
   or exists(select 1 from jsonb_array_elements(d->'categories') x where jsonb_typeof(x)<>'string') then raise exception 'catalog_invalid_labels' using errcode='22023'; end if;
 select array_agg(x order by x) into cats from jsonb_array_elements_text(d->'categories') x;
 if d->'aliases'<>'null'::jsonb then
   select array_agg(x) into aliases_input from jsonb_array_elements_text(d->'aliases') x;
   aliases_input:=coalesce(aliases_input,'{}'::text[]);
 end if;
 if cardinality(cats)<>(select count(distinct x) from unnest(cats) x) or exists(select 1 from unnest(cats) x where not exists(select 1 from bob.catalog_categories c where c.code=x))
    or (select count(*) from bob.catalog_categories where code=any(cats) and axis='material')<>1
    or (select count(*) from bob.catalog_categories where code=any(cats) and axis='form')<>1
    or not exists(select 1 from bob.catalog_profile_revisions pr where pr.profile_code=d->>'profile_code' and pr.revision=(d->>'profile_revision')::integer and pr.form_code=any(cats)) then
    raise exception 'catalog_invalid_categories' using errcode='22023'; end if;
 mid:=(d->>'material_id')::uuid; mrev:=(d->>'material_revision')::integer;
 if d->>'kind'='material' then
   if d->'material_id' is distinct from 'null'::jsonb or d->'material_revision' is distinct from 'null'::jsonb then raise exception 'catalog_material_cannot_reference_part' using errcode='22023'; end if;
 else
   if mid is null or mrev is null then raise exception 'catalog_material_required' using errcode='22023'; end if;
   select r.* into mat from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id where i.id=mid and i.kind='material' and r.revision=mrev and (i.project_id is null or i.project_id=p_project);
   if not found then raise exception 'project_denied' using errcode='42501'; end if;
   if (select c.category_code from bob.catalog_item_categories c join bob.catalog_categories t on t.code=c.category_code and t.axis='material' where c.item_id=mid and c.item_revision=mrev)
       is distinct from (select code from bob.catalog_categories where code=any(cats) and axis='material') then raise exception 'catalog_material_category_mismatch' using errcode='22023'; end if;

   -- Only properties that the selected PART profile actually understands are
   -- inherited. Part-specific user values override this merge temporarily and
   -- are then checked below for exact equality with material truth.
   select coalesce(jsonb_object_agg(mp.key,mp.value),'{}'::jsonb) into inherited_properties
   from jsonb_each(mat.properties) as mp(key,value)
   where exists(
     select 1 from bob.catalog_profile_fields f
     where f.profile_code=d->>'profile_code'
       and f.profile_revision=(d->>'profile_revision')::integer
       and f.property_key=mp.key
   );
   effective_properties:=coalesce(inherited_properties,'{}'::jsonb) || coalesce(d->'properties','{}'::jsonb);
 end if;

 normalized:=bob_private.catalog_normalize(d->>'profile_code',(d->>'profile_revision')::integer,effective_properties,d->>'kind');
 if mid is not null then
   for prop in select * from jsonb_each(mat.properties) loop
     if normalized->'properties' ? prop.key and normalized->'properties'->prop.key is distinct from prop.value then
       raise exception 'catalog_material_property_mismatch:%',prop.key using errcode='22023'; end if;
   end loop;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('bob:catalog:'||p_project,0));
 if action='ensure' then
   if p_id is not null or p_expected<>0 then raise exception 'catalog_invalid_revision' using errcode='22023'; end if;
   aliases_effective:=coalesce(aliases_input,'{}'::text[]);
   notes_effective:=d->>'notes';
 else
   select * into h from bob.catalog_items where id=p_id and project_id=p_project for update;
   if not found then raise exception 'project_denied' using errcode='42501'; end if;
   if h.current_revision is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
   if h.kind is distinct from d->>'kind' then raise exception 'catalog_kind_immutable' using errcode='22023'; end if;
   select * into current_rev from bob.catalog_item_revisions where item_id=h.id and revision=h.current_revision;
   aliases_effective:=case when d->'aliases'='null'::jsonb then current_rev.aliases else coalesce(aliases_input,'{}'::text[]) end;
   notes_effective:=case when d->'notes'='null'::jsonb then current_rev.notes else d->>'notes' end;
 end if;
 identity_doc:=jsonb_build_object('version',1,'kind',d->>'kind','profile_code',d->>'profile_code','profile_revision',(d->>'profile_revision')::integer,
    'categories',cats,'properties',normalized->'properties','material_id',mid,'material_revision',mrev,'notes',notes_effective);
 fingerprint:=case when (normalized->>'has_unknown')::boolean or (mid is not null and mat.has_unknown) then null else md5(identity_doc::text) end;
 if action='ensure' then
   if fingerprint is not null then
     select i.id into chosen from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision
       where (i.project_id is null or i.project_id=p_project) and i.kind=d->>'kind' and i.identity_hash=fingerprint and r.identity_document=identity_doc
       order by i.project_id nulls first,i.id limit 1;
     if found then return jsonb_build_object('operation','reused','record',bob_private.catalog_record(p_project,chosen)); end if;
   end if;
   chosen:=gen_random_uuid(); next_revision:=1;
   insert into bob.catalog_items(id,project_id,kind,current_revision,identity_hash) values(chosen,p_project,d->>'kind',1,fingerprint);
 else
   if current_rev.identity_document=identity_doc
      and current_rev.name=btrim(d->>'name')
      and current_rev.aliases=aliases_effective then
     return jsonb_build_object('operation','reused','record',bob_private.catalog_record(p_project,h.id,h.current_revision));
   end if;
   if fingerprint is not null and exists(select 1 from bob.catalog_items i where (i.project_id is null or i.project_id=p_project) and i.kind=h.kind and i.identity_hash=fingerprint and i.id<>h.id) then raise exception 'catalog_equivalent_exists' using errcode='40001'; end if;
   chosen:=h.id; next_revision:=h.current_revision+1;
   update bob.catalog_items set current_revision=next_revision,identity_hash=fingerprint where id=chosen;
 end if;
 insert into bob.catalog_item_revisions(item_id,revision,name,aliases,profile_code,profile_revision,properties,material_id,material_revision,notes,has_unknown,parameter_keys,identity_document,source_kind)
 values(chosen,next_revision,btrim(d->>'name'),aliases_effective,d->>'profile_code',(d->>'profile_revision')::integer,
   normalized->'properties',mid,mrev,notes_effective,(normalized->>'has_unknown')::boolean or coalesce(mat.has_unknown,false),array(select jsonb_array_elements_text(normalized->'parameter_keys')),identity_doc,p_source->>'kind');
 insert into bob_private.catalog_item_provenance values(chosen,next_revision,auth.uid(),p_source->>'quote',(p_source->>'seq')::bigint,(p_source->>'thread')::uuid);
 insert into bob.catalog_item_categories select chosen,next_revision,x from unnest(cats) x;
 result:=bob_private.catalog_record(p_project,chosen,next_revision);
 return jsonb_build_object('operation',case action when 'ensure' then 'created' else 'updated' end,'record',result);
end $$;

update bob.tool_catalog
set how_to = how_to ||
  ' On revise, use aliases=null and notes=null when the user did not ask to change that metadata; this preserves the current values exactly. Use [] only when the user explicitly wants aliases cleared, and a concrete notes string only when notes are intentionally changed. Preserve unrelated metadata on every edit.'
where name='save_catalog_definition' and schema_version=1 and active=true;

commit;
