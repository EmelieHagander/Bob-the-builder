begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Exact linked measurement revisions, including their classified endpoints.
create function bob_private.edit_measurement_evidence(p_project text,p_solution uuid,p_revision integer) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.measurement_id,'revision',r.revision,'subject',r.subject,'value',r.value,'unit',r.unit,'truth',r.truth,'source',r.source,'notes',r.notes,'property',h.property,'side',h.side,'reference',h.reference) order by r.measurement_id),'[]'::jsonb)
 from bob.solution_measurements m join bob.measurement_revisions r on r.project_id=m.project_id and r.measurement_id=m.measurement_id and r.revision=m.measurement_revision
 join bob.measurements h on h.project_id=r.project_id and h.id=r.measurement_id
 where m.project_id=p_project and m.solution_id=p_solution and m.solution_revision=p_revision
$$;
revoke all on function bob_private.edit_measurement_evidence(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.edit_measurement_evidence(text,uuid,integer) to authenticated;
alter function bob.read_bob_edit_context(text,text,text,text) rename to read_bob_edit_context_v1;
alter function bob.read_bob_selected_edit_context(text,text) rename to read_bob_selected_edit_context_v1;
create function bob.read_bob_edit_context(p_project text,p_resource text,p_query text default null,p_after text default null) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(case when row->>'resource'='project_description' then row else jsonb_set(row,'{measurement_evidence}',bob_private.edit_measurement_evidence(p_project,(row#>>'{record,id}')::uuid,(row#>>'{record,revision}')::integer)) end),'[]'::jsonb)
 from jsonb_array_elements(bob.read_bob_edit_context_v1(p_project,p_resource,p_query,p_after)) row
$$;
create function bob.read_bob_selected_edit_context(p_project text,p_area text) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_set(row,'{measurement_evidence}',bob_private.edit_measurement_evidence(p_project,(row#>>'{record,id}')::uuid,(row#>>'{record,revision}')::integer))),'[]'::jsonb)
 from jsonb_array_elements(bob.read_bob_selected_edit_context_v1(p_project,p_area)) row
$$;
revoke all on function bob.read_bob_edit_context(text,text,text,text),bob.read_bob_selected_edit_context(text,text) from public,anon,service_role;
grant execute on function bob.read_bob_edit_context(text,text,text,text),bob.read_bob_selected_edit_context(text,text) to authenticated;

-- v1 remains readable; v2 adds server-checked source pins without promoting
-- design geometry or guessing whether trim, frame or opening was measured.
alter function bob_private.solution_concept_result(jsonb) rename to solution_concept_result_v1;
create function bob_private.solution_concept_result(intent jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare m jsonb:=intent->'model'; b jsonb; n jsonb; normalized jsonb; result jsonb; scale numeric;
begin
 if m->>'version' is distinct from '2' then return bob_private.solution_concept_result_v1(intent);end if;
 if not bob_private.concept_keys(m,array['version','frame','nodes','components','views','constraints','unsupported','source_bindings']) or jsonb_typeof(m->'source_bindings') is distinct from 'array' or jsonb_array_length(m->'source_bindings')>64 then raise exception 'invalid_concept_sources' using errcode='22023';end if;
 if (select count(distinct q->>'node') from jsonb_array_elements(m->'source_bindings') q)<>jsonb_array_length(m->'source_bindings') then raise exception 'duplicate_concept_source' using errcode='22023';end if;
 normalized:=jsonb_set(intent,'{model}',jsonb_set(m-'source_bindings','{version}','1'));
 result:=bob_private.solution_concept_result_v1(normalized);
 for b in select value from jsonb_array_elements(m->'source_bindings') loop
  if not bob_private.concept_keys(b,array['node','measurement_id','measurement_revision','value','unit','reference','requested_reference','reference_status'])
   or coalesce(b->>'measurement_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or jsonb_typeof(b->'measurement_revision') is distinct from 'number' or coalesce(b->>'measurement_revision','')!~'^[1-9][0-9]{0,8}$'
   or jsonb_typeof(b->'value') is distinct from 'number' or (b->>'value')::numeric not between 0 and 1000000
   or coalesce(b->>'unit','') not in ('mm','cm','m') or jsonb_typeof(b->'requested_reference') is distinct from 'string' or char_length(b->>'requested_reference') not between 1 and 120 or not bob_private.design_text_present(b->>'requested_reference')
   or not (b->'reference'='null' or jsonb_typeof(b->'reference')='string' and char_length(b->>'reference') between 1 and 120 and bob_private.design_text_present(b->>'reference'))
   or b->>'reference_status' is distinct from (case when b->>'reference' is not null and b->>'reference'=b->>'requested_reference' then 'confirmed' else 'unresolved' end) then raise exception 'invalid_concept_source' using errcode='22023';end if;
  select value into n from jsonb_array_elements(m->'nodes') where value->>'id'=b->>'node';
  scale:=case b->>'unit' when 'm' then 1000 when 'cm' then 10 else 1 end;
  if n is null or n->>'role'<>'estimate' or n->>'unit'<>'mm' or (n->>'value')::numeric is distinct from (b->>'value')::numeric*scale then raise exception 'concept_source_value_mismatch' using errcode='22023';end if;
  if b->>'reference_status'='unresolved' then result:=jsonb_set(result,'{issues}',(result->'issues')||jsonb_build_array(jsonb_build_object('code','measurement_reference_unresolved','ids',jsonb_build_array(b->>'node'),'message','Confirm measurement endpoints before construction.')));end if;
 end loop;
 return result;
end $$;
revoke all on function bob_private.solution_concept_result(jsonb) from public,anon,service_role;
grant execute on function bob_private.solution_concept_result(jsonb) to authenticated;
alter function bob_private.check_solution_design_intent(text,jsonb) rename to check_solution_design_intent_v1;
create function bob_private.check_solution_design_intent(p_project text,p_intent jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare b jsonb; normalized jsonb:=p_intent;
begin
 if p_intent#>>'{model,version}'='2' then
  if octet_length(p_intent::text)>48000 then raise exception 'invalid_design_intent' using errcode='22023';end if;
  perform bob_private.solution_concept_result(p_intent);
  normalized:=jsonb_set(p_intent,'{model}',jsonb_set((p_intent->'model')-'source_bindings','{version}','1'));
  for b in select value from jsonb_array_elements(p_intent#>'{model,source_bindings}') loop
   if not exists(select 1 from bob.measurement_revisions r join bob.measurements h on h.project_id=r.project_id and h.id=r.measurement_id
    where r.project_id=p_project and r.measurement_id=(b->>'measurement_id')::uuid and r.revision=(b->>'measurement_revision')::integer and not r.archived and r.truth<>'unknown'
     and r.value=(b->>'value')::numeric and r.unit=b->>'unit' and h.reference is not distinct from b->>'reference') then raise exception 'concept_measurement_source_mismatch' using errcode='22023';end if;
  end loop;
 end if;
 perform bob_private.check_solution_design_intent_v1(p_project,normalized);
end $$;
revoke all on function bob_private.check_solution_design_intent(text,jsonb) from public,anon,authenticated,service_role;
create function bob_private.check_concept_measurement_links() returns trigger
language plpgsql security invoker set search_path='' as $$
declare b jsonb;
begin
 for b in select value from jsonb_array_elements(coalesce(new.design_intent#>'{model,source_bindings}','[]')) loop
  if not exists(select 1 from bob.solution_measurements m where m.project_id=new.project_id and m.solution_id=new.solution_id and m.solution_revision=new.revision and m.measurement_id=(b->>'measurement_id')::uuid and m.measurement_revision=(b->>'measurement_revision')::integer) then raise exception 'concept_measurement_link_missing' using errcode='22023';end if;
 end loop;
 return new;
end $$;
revoke all on function bob_private.check_concept_measurement_links() from public,anon,authenticated,service_role;
create constraint trigger solution_concept_measurement_links after insert or update on bob.solution_revisions deferrable initially deferred for each row execute function bob_private.check_concept_measurement_links();

create function bob.read_saved_solution_view(p_project text,p_solution uuid,p_revision integer,p_view text,p_model boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r record; result jsonb; state text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_revision is null or p_revision<1 or p_view is null or p_view!~'^[A-Za-z][A-Za-z0-9_-]{0,31}$' then raise exception 'invalid_saved_view' using errcode='22023';end if;
 select s.area_id,s.current_revision,h.archived,rev.title,rev.recorded_at,rev.design_intent into r
 from bob.solutions s join bob.solution_revisions rev on rev.project_id=s.project_id and rev.solution_id=s.id and rev.revision=p_revision
 join bob.solution_revisions h on h.project_id=s.project_id and h.solution_id=s.id and h.revision=s.current_revision where s.project_id=p_project and s.id=p_solution;
 if not found or not exists(select 1 from jsonb_array_elements(coalesce(r.design_intent#>'{model,views}','[]')) v where v->>'id'=p_view) then return jsonb_build_object('status','not_found','projectId',p_project);end if;
 if exists(select 1 from jsonb_array_elements(coalesce(r.design_intent->'references','[]')) ref where not exists(select 1 from bob.media_assets media where media.project_id=p_project and media.id=(ref->>'image_id')::uuid and media.state='ready')) then return jsonb_build_object('status','unavailable','projectId',p_project);end if;
 state:='current';
 if exists(select 1 from bob.solution_measurements m left join bob.measurements h on h.project_id=m.project_id and h.id=m.measurement_id left join bob.measurement_revisions mr on mr.project_id=h.project_id and mr.measurement_id=h.id and mr.revision=h.current_revision where m.project_id=p_project and m.solution_id=p_solution and m.solution_revision=p_revision and (h.id is null or mr.archived or h.current_revision<>m.measurement_revision)) then state:='changed';end if;
 result:=jsonb_build_object('status','ready','projectId',p_project,'solution_id',p_solution,'revision',p_revision,'current_revision',r.current_revision,'title',r.title,'archived',r.archived,'recorded_at',r.recorded_at,'area_id',r.area_id,'view',p_view,'source_view',p_view,'source_sha256',encode(sha256(convert_to(r.design_intent::text,'UTF8')),'hex'),'source_state',state,'source_reasons',case when state='current' then '[]'::jsonb else '["measurement_revision_changed"]'::jsonb end);
 if p_model then result:=result||jsonb_build_object('model_json',r.design_intent::text);end if;
 return result;
end $$;
create function bob.list_saved_solution_views(p_project text,p_after uuid default null,p_area text default null,p_query text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; total integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if length(coalesce(p_query,''))>200 or length(coalesce(p_area,''))>200 then raise exception 'invalid_saved_view_query' using errcode='22023';end if;
 select count(*) into total from bob.current_solutions s where s.project_id=p_project and not s.archived and s.design_intent?'model' and (p_area is null or s.area_id=p_area) and (p_query is null or position(lower(p_query) in lower(s.title))>0);
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into result from (
  select s.id,s.revision,s.title,s.area_id,(select jsonb_agg(v->>'id') from jsonb_array_elements(s.design_intent#>'{model,views}') v) views,bob.read_saved_solution_view(p_project,s.id,s.revision,s.design_intent#>>'{model,views,0,id}',false)->>'source_state' source_state,bob.read_saved_solution_view(p_project,s.id,s.revision,s.design_intent#>>'{model,views,0,id}',false)->'source_reasons' source_reasons
  from bob.current_solutions s where s.project_id=p_project and not s.archived and s.design_intent?'model' and (p_after is null or s.id>p_after) and (p_area is null or s.area_id=p_area) and (p_query is null or position(lower(p_query) in lower(s.title))>0) order by s.id limit 13
 )q;
 return jsonb_build_object('projectId',p_project,'records',result,'total',total);
end $$;
revoke all on function bob.read_saved_solution_view(text,uuid,integer,text,boolean),bob.list_saved_solution_views(text,uuid,text,text) from public,anon,service_role;
grant execute on function bob.read_saved_solution_view(text,uuid,integer,text,boolean),bob.list_saved_solution_views(text,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
