-- Derived FORM observations, subordinate to an immutable construction revision.
-- CLI migration-new is unavailable in this workspace (Bun crash); UTC timestamp.
-- Apply core, deploy both Bob runtimes, then activate the separate publication.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.construction_observations (
 project_id text not null,
 artifact_id uuid not null,
 artifact_revision integer not null,
 result_id text not null check(result_id ~ '^cs_[0-9a-f]{64}$'),
 observation jsonb not null check(jsonb_typeof(observation)='object'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(project_id,artifact_id,artifact_revision,result_id),
 foreign key(artifact_id,artifact_revision)
  references bob.artifact_construction_revisions(artifact_id,artifact_revision) on delete cascade,
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade
);
create index construction_observations_history on bob_private.construction_observations
 (project_id,artifact_id,artifact_revision,created_at desc,result_id desc);
alter table bob_private.construction_observations enable row level security;
revoke all on bob_private.construction_observations from public,anon,authenticated,service_role;

-- Only trusted runtime code can record an observation. The AI tool cannot supply
-- a result body, and a member cannot call this service-only cache writer directly.
-- This grants no geometry/decision/export authority. A current claim and ordinary
-- project membership remain required; no transcript is retained in the cache.
create function bob.bob_record_construction_observation(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_observation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o jsonb:=p_observation; e jsonb:=o#>'{output,form_evidence}'; aid uuid; rev integer;
 a bob.artifacts; r bob.artifact_revisions; prior jsonb; freshness text; head_archived boolean;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 if jsonb_typeof(o) is distinct from 'object' or octet_length(o::text)>4000000
  or o-array['id','projectId','artifact_id','revision','kind','observed_at','output']<>'{}'
  or (select count(*) from jsonb_object_keys(o))<>7
  or coalesce(o->>'id','')!~'^cs_[0-9a-f]{64}$' or o->>'projectId' is distinct from p_project
  or coalesce(o->>'artifact_id','')!~'^[0-9a-f-]{36}$' or coalesce(o->>'revision','')!~'^[1-9][0-9]{0,8}$'
  or o->>'kind' is distinct from 'check' or jsonb_typeof(o->'output') is distinct from 'object'
  or jsonb_typeof(o->'observed_at') is distinct from 'string'
  or o#>>'{output,projectId}' is distinct from p_project
  or o#>'{output,artifact_id}' is distinct from o->'artifact_id' or o#>'{output,revision}' is distinct from o->'revision'
  or o#>>'{output,status}' is distinct from 'checked' or o#>'{output,concept_ready}' is distinct from 'false'::jsonb
  or o#>'{output,fabrication_ready}' is distinct from 'false'::jsonb
  or e->'version' is distinct from '1'::jsonb or e->>'purpose' is distinct from 'construction_development'
  or e#>>'{contract,version}' is distinct from 'form-properties-v1'
  or e->'whole_delivery_ready' is distinct from 'false'::jsonb or e->'fabrication_ready' is distinct from 'false'::jsonb
  then raise exception 'invalid_construction_observation' using errcode='22023'; end if;
 aid:=(o->>'artifact_id')::uuid; rev:=(o->>'revision')::integer;
 if (o->>'observed_at')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'invalid_construction_observation' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into a from bob.artifacts where project_id=p_project and id=aid for share;
 if not found then raise exception 'construction_unavailable' using errcode='42501'; end if;
 select archived into head_archived from bob.artifact_revisions where artifact_id=aid and revision=a.current_revision;
 select * into r from bob.artifact_revisions where project_id=p_project and artifact_id=aid and revision=rev;
 if not found or e->'source_binding' is distinct from jsonb_build_object('project_id',p_project,'artifact_id',aid,'revision',rev,
  'target_revision',r.target_revision,'solution_id',r.solution_id,'solution_revision',r.solution_revision)
  then raise exception 'construction_source_mismatch' using errcode='22023'; end if;
 select observation into prior from bob_private.construction_observations
  where project_id=p_project and artifact_id=aid and artifact_revision=rev and result_id=o->>'id';
 if found then
  if prior-'observed_at' is distinct from o-'observed_at' then raise exception 'construction_observation_reused' using errcode='PT409'; end if;
  return prior; -- exact replay retains its original timestamp, never renews approval
 end if;
 select source_state into freshness from bob_private.artifact_source_assessment(p_project,aid,rev);
 if a.current_revision<>rev or head_archived or freshness is distinct from 'current' then raise exception 'construction_source_changed' using errcode='40001'; end if;
 insert into bob_private.construction_observations(project_id,artifact_id,artifact_revision,result_id,observation)
  values(p_project,aid,rev,o->>'id',o);
 return o;
end $$;
revoke all on function bob.bob_record_construction_observation(text,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_record_construction_observation(text,uuid,uuid,uuid,bigint,jsonb) to service_role;

-- A new read checks current membership and sources, but preserves old evidence.
-- Keyset pages are bound to the exact project/artifact/revision; an exact result
-- is returned to the runtime's existing token-bounded result-section reader.
create function bob.read_construction_results(p_project text,p_artifact uuid,p_revision integer,p_result text default null,p_after text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a bob.artifacts; r bob.artifact_revisions; freshness text; result jsonb; items jsonb; total bigint; head_archived boolean;
 cursor_row bob_private.construction_observations; cursor_id text; more boolean;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_artifact is null or p_revision is null or p_revision<1 or p_revision>999999999
  or p_result is not null and (p_result!~'^cs_[0-9a-f]{64}$' or p_after is not null)
  then raise exception 'invalid_construction_read' using errcode='22023'; end if;
 select * into a from bob.artifacts where project_id=p_project and id=p_artifact;
 select * into r from bob.artifact_revisions where project_id=p_project and artifact_id=p_artifact and revision=p_revision;
 if not found or not exists(select 1 from bob.artifact_construction_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision)
  then return jsonb_build_object('status','not_found','projectId',p_project); end if;
 select source_state into freshness from bob_private.artifact_source_assessment(p_project,p_artifact,p_revision);
 select archived into head_archived from bob.artifact_revisions where artifact_id=p_artifact and revision=a.current_revision;
 result:=jsonb_build_object('status','ok','projectId',p_project,'artifact_id',p_artifact,'revision',p_revision,
  'current_revision',a.current_revision,'archived',head_archived,'source_state',coalesce(freshness,'unavailable'));
 if p_result is not null then
  return result||jsonb_build_object('observation',(select observation from bob_private.construction_observations
   where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision and result_id=p_result));
 end if;
 if p_after is not null then
  if p_after!~'^co1:[0-9a-f-]{36}:[1-9][0-9]{0,8}:cs_[0-9a-f]{64}$'
   or split_part(p_after,':',2)<>p_artifact::text or split_part(p_after,':',3)<>p_revision::text
   then raise exception 'cursor_invalid' using errcode='22023'; end if;
  cursor_id:=split_part(p_after,':',4);
  select * into cursor_row from bob_private.construction_observations
   where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision and result_id=cursor_id;
  if not found then raise exception 'cursor_invalid' using errcode='22023'; end if;
 end if;
 select count(*) into total from bob_private.construction_observations where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.result_id desc),'[]') into items from (
  select o.created_at,o.result_id,jsonb_build_object('result_id',o.result_id,'kind','check','observed_at',o.observation->>'observed_at',
   'requested_component_count',jsonb_array_length(o.observation#>'{output,form_evidence,scope,requested_component_ids}'),
   'property_check_count',jsonb_array_length(o.observation#>'{output,form_evidence,property_checks}'),
   'local_status',o.observation#>>'{output,form_evidence,local_geometry,status}') item
  from bob_private.construction_observations o where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision
   and (p_after is null or (o.created_at,o.result_id)<(cursor_row.created_at,cursor_row.result_id))
  order by o.created_at desc,o.result_id desc limit 5
 ) x;
 more:=jsonb_array_length(items)>4;
 if more then items:=items-4; end if;
 return result||jsonb_build_object('results',items,'coverage',jsonb_build_object('total_items',total,'returned_items',jsonb_array_length(items),
  'complete',p_after is null and not more,'end_of_selection',not more),
  'next_after',case when more then 'co1:'||p_artifact||':'||p_revision||':'||(items->3->>'result_id') else null end);
end $$;
revoke all on function bob.read_construction_results(text,uuid,integer,text,text) from public,anon,service_role;
grant execute on function bob.read_construction_results(text,uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
