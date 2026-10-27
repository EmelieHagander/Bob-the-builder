-- FORM delivery discovery. CLI migration new was attempted but its bundled
-- Bun runtime aborts before command execution in this environment.
-- Read-only index over existing domain owners; no delivery/quantity register.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function bob.read_construction_delivery(p_project text,p_artifact uuid,p_revision integer,p_resource text,p_after uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare h bob.artifacts; r bob.artifact_revisions; freshness text; reasons text[]; records jsonb; more boolean;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_artifact is null or p_revision is null or p_revision<1 or p_revision>999999999
  or p_resource is null or p_resource not in ('drawings','requirements','cut_plans') then raise exception 'invalid_delivery_query' using errcode='22023';end if;
 select * into h from bob.artifacts where project_id=p_project and id=p_artifact;
 if not found then raise exception 'construction_unavailable' using errcode='PT404';end if;
 select a.* into r from bob.artifact_revisions a join bob.artifact_construction_revisions c
  on c.project_id=a.project_id and c.artifact_id=a.artifact_id and c.artifact_revision=a.revision
  where a.project_id=p_project and a.artifact_id=p_artifact and a.revision=p_revision;
 if not found then raise exception 'construction_unavailable' using errcode='PT404';end if;
 select s.source_state,s.source_reasons into freshness,reasons from bob_private.artifact_source_assessment(p_project,p_artifact,p_revision) s;
 if h.current_revision<>p_revision or r.archived then
  freshness:=case when freshness in ('current','changed') then 'changed' else 'unavailable' end;
  reasons:=array_append(coalesce(reasons,array[]::text[]),'construction_not_current');
 end if;
 if p_resource='drawings' then
  with pins as materialized (
   select d.drawing_artifact_id id,max(d.drawing_revision) revision from bob.artifact_construction_drawings d
   where d.project_id=p_project and d.construction_artifact_id=p_artifact and d.construction_revision=p_revision
    and (p_after is null or d.drawing_artifact_id>p_after)
   group by d.drawing_artifact_id order by d.drawing_artifact_id limit 13
  ) select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision,'title',v.title,
   'current_revision',a.current_revision,'archived',head.archived,'source_state','not_checked',
   'step_links',(select coalesce(jsonb_agg(jsonb_build_object('step_id',l.step_id,'in_current_plan',exists(
     select 1 from bob.project_plan_steps s join bob.project_plans plan on plan.project_id=s.project_id and plan.current_revision=s.plan_revision
     where s.project_id=p_project and s.step_id=l.step_id)) order by l.step_id),'[]'::jsonb)
    from bob.artifact_step_links l where l.project_id=p_project and l.artifact_id=p.id),
   'read',jsonb_build_object('tool','read_project_record_section','arguments',jsonb_build_object('dataset','cad','record_id',p.id,'revision',p.revision,'path','[]'::jsonb))) order by p.id),'[]'::jsonb)
   into records from pins p join bob.artifacts a on a.project_id=p_project and a.id=p.id
   join bob.artifact_revisions v on v.project_id=p_project and v.artifact_id=p.id and v.revision=p.revision
   join bob.artifact_revisions head on head.project_id=p_project and head.artifact_id=p.id and head.revision=a.current_revision;
 elsif p_resource='requirements' then
  with sources as (
   select requirement_id,requirement_revision from bob.material_requirement_construction_sources
    where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision and (p_after is null or requirement_id>p_after)
   union all
   select requirement_id,requirement_revision from bob.material_requirement_fastener_sources
    where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision and (p_after is null or requirement_id>p_after)
  ), pins as materialized (
   select requirement_id id,max(requirement_revision) revision from sources group by requirement_id order by requirement_id limit 13
  ) select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision,'name',v.name,
   'current_revision',a.current_revision,'archived',head.archived,'method_key',v.method_key,'method_version',v.method_version,
   'source_state','not_checked','read',jsonb_build_object('tool','read_project_work','arguments',jsonb_build_object('resource','requirement','record_id',p.id,'after_id',null),
    'expected_revision',p.revision)) order by p.id),'[]'::jsonb) into records
   from pins p join bob.material_requirements a on a.project_id=p_project and a.id=p.id
   join bob.material_requirement_revisions v on v.project_id=p_project and v.requirement_id=p.id and v.revision=p.revision
   join bob.material_requirement_revisions head on head.project_id=p_project and head.requirement_id=p.id and head.revision=a.current_revision;
 else
  with pins as materialized (
   select plan_id id,max(revision) revision from bob.material_cut_plan_revisions
    where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision and (p_after is null or plan_id>p_after)
    group by plan_id order by plan_id limit 13
  ) select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision,'current_revision',a.current_revision,
   'source_state','not_checked','read',jsonb_build_object('tool','read_project_work','arguments',jsonb_build_object('resource','cut_plan','record_id',p.id,'after_id',null),
    'expected_revision',p.revision)) order by p.id),'[]'::jsonb) into records
   from pins p join bob.material_cut_plans a on a.project_id=p_project and a.id=p.id;
 end if;
 more:=jsonb_array_length(records)>12;
 if more then records:=records-12;end if;
 select coalesce(jsonb_agg(value||jsonb_build_object('source',jsonb_build_object('artifact_id',p_artifact,'revision',p_revision)) order by ord),'[]'::jsonb)
  into records from jsonb_array_elements(records) with ordinality x(value,ord);
 return jsonb_build_object('status','ok','projectId',p_project,'artifact_id',p_artifact,'revision',p_revision,
  'current_revision',h.current_revision,'source_state',coalesce(freshness,'unavailable'),'source_reasons',coalesce(reasons,array[]::text[]),
  'description',r.description,'resource',p_resource,'records',records,'truncated',more,'next_after',case when more then records->11->>'id' else null end,
  'index_only',true,'fabrication_ready',false,
  'message','Saved output references, not complete delivery. Reopen every promised output and check its exact revision, current sources and required work links. Blank needs and hypothetical cut layouts do not authorize manufacture or purchases.');
end $$;
revoke all on function bob.read_construction_delivery(text,uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_delivery(text,uuid,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
