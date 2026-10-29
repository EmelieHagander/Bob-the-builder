-- Owner decision 2026-10-29: every catalog profile field is optional. Different
-- materials state different things (gravel has a material and a weight but no
-- width or length; a plank has length and width but no weight), and a forced
-- required field made the starting list store "unknown" placeholders instead.
--
-- Fields are relaxed in place, not in a new profile revision, because search
-- filters and identity fingerprints pin the profile revision: a revision 2 would
-- hide every saved and seeded definition from filtered searches and stop equal
-- definitions from being reused. Relaxing a requirement never invalidates a saved
-- definition. Every other change to a published profile still needs a new
-- revision.
--
-- Where a dimension really is needed, the consumer still checks it: the box
-- construction check reports a missing material thickness or part dimension,
-- and cut plans reject a panel part or stock sheet whose format is incomplete.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob_private.catalog_profile_immutable() returns trigger
language plpgsql set search_path='' as $$
declare code text; rev integer;
begin
 if tg_table_name='catalog_profile_revisions' then
   if old.published then raise exception 'catalog_profile_requires_new_revision' using errcode='22023'; end if;
 else
   -- The one permitted in-place change: a required field becomes optional.
   if tg_table_name='catalog_profile_fields' and tg_op='UPDATE' and old.required and not new.required
     and (to_jsonb(new)-'required')=(to_jsonb(old)-'required') then return new; end if;
   if tg_op='INSERT' then code:=new.profile_code; rev:=new.profile_revision;
   else code:=old.profile_code; rev:=old.profile_revision; end if;
   if exists(select 1 from bob.catalog_profile_revisions where profile_code=code and revision=rev and published) then
     raise exception 'catalog_profile_requires_new_revision' using errcode='22023'; end if;
   if tg_op='UPDATE' and exists(select 1 from bob.catalog_profile_revisions where profile_code=new.profile_code and revision=new.profile_revision and published) then
     raise exception 'catalog_profile_requires_new_revision' using errcode='22023'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;

update bob.catalog_profile_fields set required=false where required;

-- Loose goods sold by weight or volume (gravel, sand, crushed stone).
insert into bob.catalog_categories(code,axis,parent_code,label,aliases) values
 ('bulk','form',null,'Lösvikt',array['lösvikt','lös vikt','bulk'])
 on conflict(code) do nothing;
insert into bob.catalog_categories(code,axis,parent_code,label,aliases) values
 ('mineral.aggregate','material','mineral','Ballast',array['ballast','grus','sand','makadam','singel','stenmjöl'])
 on conflict(code) do nothing;
do $bulk$ begin
 if not exists(select 1 from bob.catalog_profiles where code='bulk') then
  insert into bob.catalog_profiles values('bulk','Lösvikt');
  insert into bob.catalog_profile_revisions(profile_code,revision,form_code,description)
   values('bulk',1,'bulk','Loose goods sold by weight or volume; every field is optional.');
  insert into bob.catalog_profile_fields(profile_code,profile_revision,property_key,required,min_value,max_value,position) values
   ('bulk',1,'grade',false,null,null,20),('bulk',1,'colour',false,null,null,21),('bulk',1,'nominal_size',false,null,null,30);
  update bob.catalog_profile_revisions set published=true where profile_code='bulk' and revision=1;
 end if;
end $bulk$;

-- Seeded definitions stored an "unknown" placeholder only because the field was
-- required. Give each such shared seed definition one new revision without the
-- placeholder, so it gets an identity like every other complete definition.
-- Project definitions are left alone: an unknown there may be a deliberate record.
do $seed_unknowns$
declare it record; props jsonb; identity_doc jsonb; cats text[]; next_rev integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('bob:catalog:',0));
 for it in select i.id,i.current_revision,r.* from bob.catalog_items i
   join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision
   where i.project_id is null and r.source_kind='seed' and r.has_unknown and cardinality(r.parameter_keys)=0
   order by i.id for update of i loop
  select coalesce(jsonb_object_agg(key,value),'{}') into props from jsonb_each(it.properties)
   where not (value->>'truth'='unknown' and value->'parameter'='null'::jsonb);
  select coalesce(array_agg(category_code order by category_code),'{}') into cats
   from bob.catalog_item_categories where item_id=it.id and item_revision=it.revision;
  identity_doc:=jsonb_build_object('version',1,'kind','material','profile_code',it.profile_code,'profile_revision',it.profile_revision,
   'categories',cats,'properties',props,'material_id',null,'material_revision',null,'notes',it.notes);
  next_rev:=it.revision+1;
  insert into bob.catalog_item_revisions(item_id,revision,name,aliases,profile_code,profile_revision,properties,material_id,material_revision,notes,has_unknown,parameter_keys,identity_document,source_kind)
   values(it.id,next_rev,it.name,it.aliases,it.profile_code,it.profile_revision,props,null,null,it.notes,false,'{}',identity_doc,'seed');
  insert into bob.catalog_item_categories select it.id,next_rev,x from unnest(cats) x;
  update bob.catalog_items set current_revision=next_rev,identity_hash=md5(identity_doc::text) where id=it.id;
 end loop;
end $seed_unknowns$;
commit;
