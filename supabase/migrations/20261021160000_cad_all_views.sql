-- Every side of an assembly can be drawn.
--
-- The CAD engine, Bob's schemas and the database allowed only front, right,
-- top and isometric (from front-right). A requirement on a hidden side could
-- never be verified: on 2026-10-21 the bunk bed's left gable (bookshelf,
-- ladder, back panel, guard opening) sat fully behind the solid right gable
-- in the right view, and the CAD reviewer rejected correct geometry again and
-- again. Views now cover all six sides plus an isometric view from each upper
-- corner; a drawing may request up to six.
--
-- 1. bob_private.check_construction accepts the new names and up to 6 views.
-- 2. bob_volunteer_private.volunteer_drawing exposes the new view files.
-- 3. The seven catalog definitions that carry the view enum get the new enum,
--    maxItems 6 and a description telling Bob to pick the views that show
--    every requirement's side (publication cad-all-views-v1).
-- The stored coordinate_system (checked against saved artifacts) is unchanged.
-- Runtime order: deploy the CAD worker and Edge functions that accept the new
-- views before or together with this migration. Re-running is a no-op.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Recursive: every array schema whose items enumerate exactly the old views
-- gets the new enum, maxItems and description; prose "front,right,top,isometric"
-- lists name the new views.
create or replace function pg_temp.cad_all_views_walk(node jsonb, spec jsonb) returns jsonb language plpgsql immutable as $walk$
declare result jsonb; k text; v jsonb;
begin
 if jsonb_typeof(node)='object' then
  result:='{}';
  for k,v in select * from jsonb_each(node) loop result:=result||jsonb_build_object(k,pg_temp.cad_all_views_walk(v,spec)); end loop;
  if jsonb_typeof(result->'items')='object' and result->'items'->'enum'=spec->'old' then
   result:=jsonb_set(result,'{items,enum}',spec->'views');
   if result ? 'maxItems' then result:=jsonb_set(result,'{maxItems}',spec->'max'); end if;
   if not result ? 'description' then result:=result||jsonb_build_object('description',spec->'description'); end if;
  end if;
  return result;
 elsif jsonb_typeof(node)='array' then
  return coalesce((select jsonb_agg(pg_temp.cad_all_views_walk(e,spec) order by i) from jsonb_array_elements(node) with ordinality x(e,i)),'[]'::jsonb);
 elsif jsonb_typeof(node)='string' then
  return to_jsonb(replace(node#>>'{}','front,right,top,isometric',(select string_agg(x,',') from jsonb_array_elements_text(spec->'views') x)));
 end if;
 return node;
end $walk$;
do $cad_all_views$
declare spec jsonb:=$cad_all_views_spec${"old": ["front", "right", "top", "isometric"], "views": ["front", "back", "left", "right", "top", "bottom", "isometric", "isometric_front_left", "isometric_back_left", "isometric_back_right"], "max": 6, "description": "Pick views that show every requirement where it is: a feature on one side (for example a left gable, a back panel or an underside) needs that side's view. front from -Y, back +Y, left -X, right +X, top +Z, bottom -Z; isometric from front-right-top, isometric_front_left, isometric_back_left, isometric_back_right from those upper corners.", "keys": ["tools.save_construction_draft", "tools.design_project_cad", "tools.render_cad_candidate", "tools.plan_cad_pieces", "schema.cad_recipe", "schema.design_handoff", "tools.revise_cad_candidate"]}$cad_all_views_spec$::jsonb;
 def text; fn oid; updated integer:=0; key text; prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
 definition jsonb; activation jsonb:='{}';
begin
 -- 1 + 2: installed SQL validators (every overload carrying the old list),
 -- rewritten from their current definitions.
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='bob_private' and p.proname='check_construction' and p.prosrc like $q$%v not in ('front','right','top','isometric')%$q$ loop
  def:=pg_get_functiondef(fn);
  if position($q$jsonb_array_length(p_recipe->'views') not between 1 and 4$q$ in def)=0 then raise exception 'cad_all_views_check_construction_changed'; end if;
  def:=replace(def,$q$jsonb_array_length(p_recipe->'views') not between 1 and 4$q$,$q$jsonb_array_length(p_recipe->'views') not between 1 and 6$q$);
  def:=replace(def,$q$v not in ('front','right','top','isometric')$q$,$q$v not in ('front','back','left','right','top','bottom','isometric','isometric_front_left','isometric_back_left','isometric_back_right')$q$);
  execute def; updated:=updated+1;
 end loop;
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='bob_volunteer_private' and p.proname='volunteer_drawing' and p.prosrc like $q$%key in('front','right','top','isometric')%$q$ loop
  def:=replace(pg_get_functiondef(fn),$q$key in('front','right','top','isometric')$q$,$q$key in('front','back','left','right','top','bottom','isometric','isometric_front_left','isometric_back_left','isometric_back_right')$q$);
  execute def; updated:=updated+1;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('bob_private','bob_volunteer_private')
   and p.proname in ('check_construction','volunteer_drawing') and p.prosrc like $q$%'front','right','top','isometric'%$q$) then
  raise exception 'cad_all_views_validator_left_behind'; end if;
 raise notice 'cad all views: % validators updated',updated;

 -- 3: catalog definitions.
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for key in select jsonb_array_elements_text(spec->'keys') loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=key and p.retired_at is null for update of p;
  -- A definition retired or never installed in this history has nothing to widen.
  if not found then continue; end if;
  if prior.definition::text like '%isometric_back_right%' then continue; end if;
  definition:=pg_temp.cad_all_views_walk(prior.definition,spec);
  if definition=prior.definition then raise exception 'cad_all_views_enum_not_found: %',key; end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','cad-all-views-v1'),
    prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(key,version_uuid);
 end loop;
 if activation<>'{}'::jsonb then perform shared.activate_ai_catalog('bob',activation); end if;
end $cad_all_views$;
commit;
