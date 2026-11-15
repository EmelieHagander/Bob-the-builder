-- Owner decision 2026-11-09 (entré floor): two solid concept components may
-- not take the same space. Touching is fine; overlapping volume is refused.
-- Live: Bob added "supports" (z 0-300) over the "floor" (z 130-300); every
-- joist then lay in both, code may not guess (owner rule 2026-11-07), and the
-- floor could never be mapped. The overlap is a concept issue on every read
-- (so existing Solutions show it) and a refusal on every Solution save, named
-- by its component ids. Openings, spaces and references may overlap solids.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter function bob_private.solution_concept_result(jsonb) rename to solution_concept_result_v2;
revoke all on function bob_private.solution_concept_result_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function bob_private.solution_concept_result_v2(jsonb) to authenticated;

create function bob_private.concept_solid_overlaps(boxes jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_array(a.value->>'id',b.value->>'id') order by a.ord,b.ord),'[]'::jsonb)
 from jsonb_array_elements(coalesce(boxes,'[]'::jsonb)) with ordinality a(value,ord)
 join jsonb_array_elements(coalesce(boxes,'[]'::jsonb)) with ordinality b(value,ord) on b.ord>a.ord
 where a.value->>'kind'='solid' and b.value->>'kind'='solid'
  and not exists(select 1 from generate_series(0,2) axis where
   least((a.value->'min'->>axis)::numeric+(a.value->'size_mm'->>axis)::numeric,(b.value->'min'->>axis)::numeric+(b.value->'size_mm'->>axis)::numeric)
   -greatest((a.value->'min'->>axis)::numeric,(b.value->'min'->>axis)::numeric)<=0.000001)
$$;
revoke all on function bob_private.concept_solid_overlaps(jsonb) from public,anon,service_role;
grant execute on function bob_private.concept_solid_overlaps(jsonb) to authenticated;

create function bob_private.solution_concept_result(intent jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb; pair jsonb;
begin
 result:=bob_private.solution_concept_result_v2(intent);
 for pair in select value from jsonb_array_elements(bob_private.concept_solid_overlaps(result->'boxes')) loop
  result:=jsonb_set(result,'{issues}',(result->'issues')||jsonb_build_array(jsonb_build_object('code','component_overlap','ids',pair,
   'message','Two solid concept components take the same space; move or resize one so they only touch.')));
 end loop;
 return result;
end $$;
revoke all on function bob_private.solution_concept_result(jsonb) from public,anon,service_role;
grant execute on function bob_private.solution_concept_result(jsonb) to authenticated;

alter function bob_private.check_solution_design_intent(text,jsonb) rename to check_solution_design_intent_v2;
revoke all on function bob_private.check_solution_design_intent_v2(text,jsonb) from public,anon,authenticated,service_role;
create function bob_private.check_solution_design_intent(p_project text,p_intent jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare found_pairs jsonb;
begin
 perform bob_private.check_solution_design_intent_v2(p_project,p_intent);
 if p_intent is null or p_intent='null'::jsonb or p_intent->'model' is null or p_intent->'model'='null'::jsonb then return; end if;
 found_pairs:=bob_private.concept_solid_overlaps(bob_private.solution_concept_result(p_intent)->'boxes');
 -- Ids match ^[A-Za-z][A-Za-z0-9_-]{0,31}$ (concept validator), so the
 -- message names them without echoing free text.
 if jsonb_array_length(found_pairs)>0 then
  raise exception '%','concept_components_overlap:'||(select string_agg(p->>0||'+'||(p->>1),',') from (select value p from jsonb_array_elements(found_pairs) limit 8) x)
   using errcode='22023';
 end if;
end $$;
revoke all on function bob_private.check_solution_design_intent(text,jsonb) from public,anon,authenticated,service_role;

commit;
