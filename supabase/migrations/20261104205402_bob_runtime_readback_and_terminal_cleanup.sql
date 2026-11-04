-- Thin exact-revision readback and consistent terminal journal cleanup.
-- Domain revisions, receipts, messages and model cost records are preserved.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table bob_private.bob_jobs in share row exclusive mode;
do $$ begin
 if exists(select 1 from bob_private.bob_jobs where status in ('queued','running')) then
  raise exception 'bob_jobs_active';
 end if;
end $$;

create function bob.read_construction_summary(p_project text,p_artifact uuid,p_revision integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare head record; saved record; freshness text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then
  raise exception 'project_denied' using errcode='42501';
 end if;
 if p_artifact is null or p_revision is null or p_revision<1 then
  raise exception 'invalid_construction_read' using errcode='22023';
 end if;
 select a.current_revision,a.area_id,h.archived into head
 from bob.artifacts a join bob.artifact_revisions h on h.artifact_id=a.id and h.project_id=a.project_id and h.revision=a.current_revision
 where a.project_id=p_project and a.id=p_artifact;
 if not found then return jsonb_build_object('status','not_found','projectId',p_project); end if;
 select r.title,r.target_revision,jsonb_build_object(
  'definitions',jsonb_array_length(c.recipe->'definitions'),
  'instances',jsonb_array_length(c.recipe->'instances'),
  'nodes',jsonb_array_length(c.parameters->'nodes'),
  'bindings',jsonb_array_length(c.parameters->'bindings'),
  'joints',jsonb_array_length(c.joints),'materials',jsonb_array_length(c.materials),
  'open_questions',jsonb_array_length(c.open_questions),
  'roles_recorded',p.policy is not null,
  'unknown_roles',case when p.policy is null then jsonb_array_length(c.recipe->'instances')
    else (select count(*) from jsonb_array_elements(p.policy->'instances') i where i->>'role'='unknown') end
 ) as counts,p.policy is not null as roles_recorded into saved
 from bob.artifact_construction_revisions c
 join bob.artifact_revisions r on r.artifact_id=c.artifact_id and r.project_id=c.project_id and r.revision=c.artifact_revision
 left join bob.artifact_construction_instance_policies p on p.project_id=c.project_id and p.artifact_id=c.artifact_id and p.artifact_revision=c.artifact_revision
 where c.project_id=p_project and c.artifact_id=p_artifact and c.artifact_revision=p_revision;
 if not found then return jsonb_build_object('status','not_found','projectId',p_project); end if;
 -- Same current source assessment as the full reader. A historical body never
 -- supplies current revision/archive/source metadata from a cache.
 select s.source_state into freshness from bob.artifact_source_status s
 where s.project_id=p_project and s.artifact_id=p_artifact and s.revision=p_revision;
 return jsonb_build_object('status','ok','projectId',p_project,'artifact_id',p_artifact,
  'revision',p_revision,'current_revision',head.current_revision,'archived',head.archived,
  'title',saved.title,'area_id',head.area_id,'target_revision',saved.target_revision,
  'view','overview','source_state',coalesce(freshness,'unavailable'),'counts',saved.counts,
  'roles_recorded',saved.roles_recorded,'construction_status','draft','rendered',false,'reviewed',false,
  'fabrication_ready',false,'details_omitted',true,
  'saved_results_read',jsonb_build_object('artifact_id',p_artifact,'revision',p_revision,'view','results',
   'ids','[]'::jsonb,'after',null,'result_id',null,'section',null),
  'message','Exact saved revision summary. Open details or saved checks when needed; persistence is not design or manufacturing approval.');
end $$;
revoke all on function bob.read_construction_summary(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_construction_summary(text,uuid,integer) to authenticated;

-- Cancellation writes the same terminal status as other finish paths, but used
-- to skip their manual journal delete. Run at the locked job boundary for all
-- terminal paths, including repeated terminal updates. No paused work is lost.
create function bob_private.bob_clear_job_steps() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('completed','failed','cancelled') then
  delete from bob_private.bob_job_steps where job_id=new.id;
 end if;
 return new;
end $$;
revoke all on function bob_private.bob_clear_job_steps() from public,anon,authenticated,service_role;
create trigger bob_clear_job_steps after update of status on bob_private.bob_jobs
 for each row execute function bob_private.bob_clear_job_steps();

-- One-time cleanup of proven terminal working journals only. Saved project
-- results, write receipts and cost/recovery ledgers have separate owners.
delete from bob_private.bob_job_steps s using bob_private.bob_jobs j
 where s.job_id=j.id and j.status in ('completed','failed','cancelled');
notify pgrst,'reload schema';
commit;
