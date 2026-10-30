-- Build guides (IKEA-style) saved with the drawing revision, 2026-10-30.
-- Owner decisions: a guide is made together with the final drawing; build pages
-- show fasteners per step; one global switch, off by default. Nothing here turns
-- a guide on or starts work: the Edge reads the switch, and a missing row is off.

-- 1. The switch. Copies the CAD reviewer's model row only so the settings table's
-- shape is complete; this function makes no model call of its own.
insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,
  temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
select 'bob','bob','cad-build-guide','cad',model,model_type,max_output_tokens,null,null,null,false,false,
  '{"role":"build_guide_switch","authority":"owner_switch","default":"off","model_call":false}'::jsonb
from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='cad-reviewer' and module_id='cad'
on conflict(app,coworker_id,function_name,module_id) do nothing;

-- 2. Guide pages live in the drawing revision's files as guide-0..guide-N (SVG,
-- base64) with notes in manifest.build_guide. A guide belongs to exactly the
-- construction the drawing pins, every page file matches its noted hash, and no
-- guide file exists without notes. Drawings without a guide are unaffected.
create or replace function bob_private.validate_cad_build_guide() returns trigger
language plpgsql set search_path='' as $$
declare
 guide jsonb:=new.manifest->'build_guide';
 pin jsonb:=new.manifest->'bob_construction';
 page jsonb; noted text[]:='{}'; stray text[];
begin
 select coalesce(array_agg(k order by k),'{}') into stray from jsonb_object_keys(new.files) k where k ~ '^guide-';
 if guide is null then
  if cardinality(stray)>0 then raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_files_without_notes'; end if;
  return new;
 end if;
 if jsonb_typeof(guide)<>'object' or guide->>'version' is distinct from '1'
   or guide->>'status' not in ('generated','not_generated','failed')
   or jsonb_typeof(guide->'construction')<>'object' or pin is null
   or guide->'construction'->>'artifact_id' is distinct from pin->>'artifact_id'
   or guide->'construction'->>'revision' is distinct from pin->>'revision' then
  raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_notes_or_pin';
 end if;
 if guide->>'status'<>'generated' then
  if cardinality(stray)>0 or coalesce(jsonb_array_length(guide->'pages'),0)>0 then
   raise exception 'cad_build_guide_invalid' using errcode='22023',detail='pages_without_guide';
  end if;
  return new;
 end if;
 if jsonb_typeof(guide->'pages')<>'array' or jsonb_array_length(guide->'pages') not between 1 and 60 then
  raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_pages';
 end if;
 for page in select value from jsonb_array_elements(guide->'pages') loop
  if jsonb_typeof(page)<>'object' or coalesce(page->>'key','') !~ '^guide-[0-9]{1,2}$' or page->>'key'=any(noted)
    or coalesce(page->>'sha256','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(new.files->(page->>'key'))<>'string'
    or encode(sha256(decode(new.files->>(page->>'key'),'base64')),'hex')<>page->>'sha256' then
   raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_page_file';
  end if;
  noted:=noted||(page->>'key');
 end loop;
 if stray is distinct from (select array_agg(k order by k) from unnest(noted) k) then
  raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_files_without_notes';
 end if;
 return new;
end $$;
revoke all on function bob_private.validate_cad_build_guide() from public,anon,authenticated;
drop trigger if exists validate_cad_build_guide on bob.artifact_cad_revisions;
create trigger validate_cad_build_guide before insert or update on bob.artifact_cad_revisions
 for each row execute function bob_private.validate_cad_build_guide();

-- 3. Volunteers see a guide only where they already see its drawing: the reader
-- keeps its task scope and unavailable-source rule, and now also passes the
-- guide pages and their notes. Rewritten from the installed body; re-running is a no-op.
do $guide_reader$
declare fn oid; def text; updated int:=0;
 views text:=$q$key in('front','back','left','right','top','bottom','isometric','isometric_front_left','isometric_back_left','isometric_back_right')$q$;
begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='bob_volunteer_private' and p.proname='volunteer_drawing' loop
  def:=pg_get_functiondef(fn);
  if position('build_guide' in def)>0 then continue; end if;
  if position(views in def)=0 then raise exception 'cad_build_guide_reader_not_found'; end if;
  def:=replace(def,views,'('||views||$q$ or key ~ '^guide-[0-9]{1,2}$')$q$);
  def:=replace(def,$q$'source_changed',d.source_state='changed')$q$,$q$'source_changed',d.source_state='changed','build_guide',cad.manifest->'build_guide')$q$);
  if position('build_guide' in def)=0 then raise exception 'cad_build_guide_reader_not_found'; end if;
  execute def; updated:=updated+1;
 end loop;
 raise notice 'cad build guide: % volunteer readers updated',updated;
end $guide_reader$;
