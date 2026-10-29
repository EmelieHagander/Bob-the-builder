-- Owner decision 2026-10-29: every catalog property may be left out. Different
-- materials state different things (gravel has a material and a weight but no
-- width or length; a plank has length and width but no weight).
--
-- A profile field marked required no longer stops a save. Leaving it out marks
-- the definition incomplete, exactly like an explicit "unknown": it gets no
-- identity fingerprint, so two separately requested incomplete definitions are
-- never merged or silently reused, and consumers that need the dimension (box
-- construction check, cut plans) still refuse it. Profiles, their published
-- revisions and the immutability rule are unchanged, so saved and seeded
-- definitions keep their identities and filtered searches.
--
-- Also adds loose goods sold by weight or volume (gravel, sand, crushed stone).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $optional_fields$
declare definition text;
 anchor constant text:=$a$if field.required and not p_partial then raise exception 'catalog_missing_property:%',field.property_key using errcode='22023'; end if;$a$;
 replacement constant text:=$a$if field.required and not p_partial then unknown_value:=true; end if;$a$;
begin
 definition:=pg_get_functiondef('bob_private.catalog_normalize(text,integer,jsonb,text,boolean)'::regprocedure);
 if (char_length(definition)-char_length(replace(definition,anchor,'')))/char_length(anchor)<>1 then
  raise exception 'optional_fields_anchor'; end if;
 execute replace(definition,anchor,replacement);
end $optional_fields$;

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
commit;
