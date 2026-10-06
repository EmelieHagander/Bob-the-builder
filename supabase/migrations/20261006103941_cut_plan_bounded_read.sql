-- Bound saved-plan freshness reads; preserve access, source and target checks.
-- Actual UTC filename fallback after the installed migration CLI aborted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob_private.read_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h bob.material_cut_plans; r bob.material_cut_plan_revisions; state text; pins jsonb; capacity jsonb; reason text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into h from bob.material_cut_plans where project_id=p_project and id=p_plan;
 if not found then return null; end if;
 select * into r from bob.material_cut_plan_revisions where project_id=p_project and plan_id=p_plan and revision=coalesce(p_revision,h.current_revision);
 if not found then return null; end if;
 select source_state into state from bob_private.artifact_source_assessment(p_project,r.artifact_id,r.artifact_revision);
 state:=case when state='current' and r.revision=h.current_revision and exists(select 1 from bob.artifacts a join bob.artifact_revisions ar on ar.artifact_id=a.id and ar.revision=a.current_revision
  where a.project_id=p_project and a.id=r.artifact_id and a.current_revision=r.artifact_revision and not ar.archived) then 'current' else 'changed' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',requirement_id,'revision',requirement_revision) order by requirement_id),'[]') into pins
  from bob.material_cut_plan_requirements where project_id=p_project and plan_id=p_plan and plan_revision=r.revision;
 -- The plan's construction/source graph was assessed once above. Read each
 -- pinned need's indexed head/revision and reuse the canonical Area target
 -- selector; the current-needs view would reassess that same expensive graph
 -- for every pin and can exceed the ordinary PostgREST statement budget.
 if exists(select 1 from bob.material_cut_plan_requirements p
  left join bob.material_requirements nh on nh.project_id=p.project_id and nh.id=p.requirement_id
  left join bob.material_requirement_revisions q on q.project_id=nh.project_id and q.requirement_id=nh.id and q.revision=nh.current_revision
  where p.project_id=p_project and p.plan_id=p_plan and p.plan_revision=r.revision and
   (q.requirement_id is null or nh.current_revision<>p.requirement_revision or q.archived
    or q.artifact_id is distinct from r.artifact_id or q.artifact_revision is distinct from r.artifact_revision
    or bob_private.effective_target_revision(q.project_id,q.area_id) is distinct from q.target_revision))
  then state:='changed'; end if;
 if exists(select 1 from jsonb_array_elements(r.candidates) f left join bob.catalog_items m on m.id=(f->>'material_id')::uuid
  where m.id is null or (m.project_id is not null and m.project_id<>p_project) or m.current_revision is distinct from (f->>'material_revision')::integer)
  then state:='changed'; end if;
 begin capacity:=bob_private.cut_plan_sources(p_project,r.candidates,r.candidate_sources,false);
 exception when sqlstate 'PT409' or sqlstate '22023' then state:='changed'; reason:='format_or_capacity_changed'; capacity:='[]'; end;
 return to_jsonb(r)||jsonb_build_object('id',h.id,'name','Construction cut plan','current_revision',h.current_revision,'requirements',pins,'source_state',state,
  'capacity',capacity,'gap',reason,'saved',true,'stock_reserved',false,'shopping_ready',false,'fabrication_ready',false,'input_evidence_verified',false);
end $$;
notify pgrst,'reload schema';
commit;
