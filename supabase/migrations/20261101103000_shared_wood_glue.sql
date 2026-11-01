-- Wood glue in the shared catalog (owner decision 2026-11-01).
--
-- Joints now name the catalog items that hold them
-- (20261101100000_joint_fasteners_from_catalog.sql). The shared catalog had
-- screws and nails but no glue, so the structural designer could never choose
-- it. Two generic glues, the way the starting list describes materials: no
-- product, supplier, price or package volume.
--  * Trälim, inomhus: durability class D2 (EN 204), dry rooms.
--  * Trälim, utomhus (D3): damp rooms and outdoors under a roof; free weather
--    needs D4, which is not in the list.
-- A material category 'adhesive' (Lim) sits next to 'coating'. Both material
-- types are tagged fastener_kind 'glue'. One item each, counted in packages.
-- Re-applying changes nothing.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $shared_wood_glue$
declare glue jsonb; mt bob.material_types; v_alias text; props jsonb; normalized jsonb; identity_doc jsonb; fingerprint text; item uuid;
 cats constant text[]:=array['adhesive','liquid'];
begin
 perform pg_advisory_xact_lock(hashtextextended('bob:catalog:',0));
 insert into bob.catalog_categories(code,axis,parent_code,label,aliases) values('adhesive','material',null,'Lim',array['glue','lim']) on conflict do nothing;
 for glue in select value from jsonb_array_elements($glues$[
  {"key":"wood_glue_indoor","name":"Trälim, inomhus","grade":"D2","aliases":["trälim","snickarlim","lim"],
   "note":"Hållfasthetsklass D2 enligt EN 204: torra utrymmen inomhus.",
   "notes":"Standardmaterial: trälim för inomhusbruk. Generisk specifikation; produkt, förpackningsstorlek och härdningstid är inte verifierade."},
  {"key":"wood_glue_outdoor","name":"Trälim, utomhus (D3)","grade":"D3","aliases":["vattenfast trälim","fuktbeständigt trälim","utomhuslim"],
   "note":"Hållfasthetsklass D3 enligt EN 204: fuktiga utrymmen och utomhus under tak. Fritt väder kräver D4.",
   "notes":"Standardmaterial: fuktbeständigt trälim. Generisk specifikation; produkt, förpackningsstorlek och härdningstid är inte verifierade."}
 ]$glues$::jsonb) loop
  insert into bob.material_types(name,category_code,review_status,seed_key,fastener_kind) values(glue->>'name','adhesive','reviewed',glue->>'key','glue') on conflict do nothing;
  select * into mt from bob.material_types t where t.seed_key=glue->>'key';
  if mt.id is null or mt.fastener_kind is distinct from 'glue' then raise exception 'shared_wood_glue_type:%',glue->>'key'; end if;
  for v_alias in select jsonb_array_elements_text(glue->'aliases') loop
   insert into bob.material_aliases(alias,material_type_id,review_status) values(v_alias,mt.id,'reviewed') on conflict do nothing;
  end loop;
  continue when exists(select 1 from bob.catalog_items i where i.project_id is null and i.material_type_id=mt.id);
  props:=jsonb_build_object('grade',jsonb_build_object('value',glue->>'grade','unit',null,'truth','provided_spec','parameter',null,'note',glue->>'note'));
  normalized:=bob_private.catalog_normalize('liquid',1,props,'material');
  identity_doc:=jsonb_build_object('version',1,'kind','material','profile_code','liquid','profile_revision',1,
   'categories',cats,'properties',normalized->'properties','material_id',null,'material_revision',null,'notes',glue->>'notes');
  fingerprint:=case when (normalized->>'has_unknown')::boolean then null else md5(identity_doc::text) end;
  item:=gen_random_uuid();
  insert into bob.catalog_items(id,project_id,kind,current_revision,identity_hash,material_type_id,material_size_id,unit_code,review_status)
   values(item,null,'material',1,fingerprint,mt.id,null,'pcs','reviewed');
  insert into bob.catalog_item_revisions(item_id,revision,name,aliases,profile_code,profile_revision,properties,material_id,material_revision,notes,has_unknown,parameter_keys,identity_document,source_kind)
   values(item,1,mt.name,'{}',
    'liquid',1,normalized->'properties',null,null,glue->>'notes',(normalized->>'has_unknown')::boolean,
    array(select jsonb_array_elements_text(normalized->'parameter_keys')),identity_doc,'seed');
  insert into bob.catalog_item_categories select item,1,x from unnest(cats) x;
 end loop;
end $shared_wood_glue$;
commit;
