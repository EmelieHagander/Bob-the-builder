-- FORM 2c. CLI timestamp fallback: local Supabase CLI aborts before migration-new.
-- Observed UTC 2026-10-27 11:58:11. Core before both runtimes and catalog publication.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- These are evidence/decisions subordinate to immutable Solution revisions, not
-- another geometry store. The Artifact slot is reserved for the 4a 3D producer.
create table bob.solution_presentations (
 id uuid primary key default gen_random_uuid(), project_id text not null,
 solution_id uuid not null, solution_revision integer not null,
 -- Preserve the historical scope identity when an Area is removed.
 scope_area_id text, scope_label text not null,
 artifact_id uuid, artifact_revision integer,
 representation text not null check(representation in ('concept_2d','construction_3d')),
 view_id text not null, renderer_version text not null,
 actor_id uuid not null, actor_label text not null,
 source_stamp jsonb not null, source_key text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(solution_id,solution_revision) references bob.solution_revisions(solution_id,revision) on delete cascade,
 foreign key(solution_id,project_id) references bob.solutions(id,project_id) on delete cascade,
 check((representation='concept_2d' and artifact_id is null and artifact_revision is null)
   or (representation='construction_3d' and artifact_id is not null and artifact_revision is not null and artifact_revision>0)),
 unique(project_id,id),
 unique(project_id,actor_id,solution_id,solution_revision,view_id,renderer_version,source_key)
);
create index solution_presentations_source on bob.solution_presentations(project_id,solution_id,solution_revision);
create table bob.solution_model_feedback (
 id uuid primary key default gen_random_uuid(), project_id text not null,
 presentation_id uuid not null, actor_id uuid not null, actor_label text not null,
 -- No chat text, quote or freeform paraphrase is published to the shared project.
 turn_id uuid not null, outcome text not null check(outcome in ('accepted','change_requested','unclear','delegated')),
 authority text not null check(authority in ('user','bob')), mandate_id uuid,
 scope text not null check(scope in ('whole_model','components')), component_ids jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(project_id,presentation_id) references bob.solution_presentations(project_id,id) on delete cascade,
 unique(project_id,id), foreign key(project_id,mandate_id) references bob.solution_model_feedback(project_id,id),
 unique(project_id,actor_id,turn_id,presentation_id,authority),
 check(jsonb_typeof(component_ids)='array' and jsonb_array_length(component_ids)>0),
 check((authority='user' and mandate_id is null) or (authority='bob' and mandate_id is not null and outcome='accepted'))
);
create index solution_model_feedback_source on bob.solution_model_feedback(project_id,presentation_id,recorded_at desc,id desc);
alter table bob.solution_presentations enable row level security;
alter table bob.solution_model_feedback enable row level security;
create policy project_read on bob.solution_presentations for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.solution_model_feedback for select to authenticated using(bob_private.has_project_access(project_id));
revoke all on bob.solution_presentations,bob.solution_model_feedback from public,anon,authenticated,service_role;
grant select on bob.solution_presentations,bob.solution_model_feedback to authenticated;

-- Bounded source identities only: no construction geometry/checker evaluation.
create function bob_private.solution_presentation_source(p_project text,p_solution uuid,p_revision integer,p_area text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('area',p_area,'head',h.current_revision,'archived',current.archived,
  'target',bob_private.effective_target_revision(p_project,p_area),
  'measurements',coalesce((select jsonb_agg(jsonb_build_array(pin.measurement_id,pin.measurement_revision,m.revision,m.archived) order by pin.measurement_id)
   from bob.solution_measurements pin left join bob.current_measurements m on m.project_id=pin.project_id and m.id=pin.measurement_id
   where pin.project_id=p_project and pin.solution_id=p_solution and pin.solution_revision=p_revision),'[]'::jsonb),
  'images',coalesce((select jsonb_agg(jsonb_build_array(ref->>'image_id',m.state,m.updated_at) order by ref->>'image_id')
   from jsonb_array_elements(r.design_intent->'references') ref left join bob.media_assets m on m.project_id=p_project and m.id=(ref->>'image_id')::uuid),'[]'::jsonb))
 from bob.solutions h join bob.solution_revisions r on r.project_id=h.project_id and r.solution_id=h.id and r.revision=p_revision
 join bob.solution_revisions current on current.project_id=h.project_id and current.solution_id=h.id and current.revision=h.current_revision
 where h.project_id=p_project and h.id=p_solution
$$;
revoke all on function bob_private.solution_presentation_source(text,uuid,integer,text) from public,anon,service_role;
grant execute on function bob_private.solution_presentation_source(text,uuid,integer,text) to authenticated;
create function bob_private.solution_presentation_current(p bob.solution_presentations)
returns boolean language sql stable security invoker set search_path='' as $$
 select p.representation='concept_2d' and p.renderer_version='solution-concept-v1'
  and (p.scope_area_id is null or exists(select 1 from bob.areas where id=p.scope_area_id and project_id=p.project_id and archived_at is null))
  and p.source_stamp->>'head'=p.solution_revision::text and p.source_stamp->'archived'='false'::jsonb
  and not exists(select 1 from jsonb_array_elements(p.source_stamp->'measurements') m where m->1 is distinct from m->2 or m->3 is distinct from 'false'::jsonb)
  and not exists(select 1 from jsonb_array_elements(p.source_stamp->'images') m where m->>1 is distinct from 'ready')
  and p.source_stamp is not distinct from bob_private.solution_presentation_source(p.project_id,p.solution_id,p.solution_revision,p.scope_area_id)
$$;
revoke all on function bob_private.solution_presentation_current(bob.solution_presentations) from public,anon,service_role;
grant execute on function bob_private.solution_presentation_current(bob.solution_presentations) to authenticated;

create function bob.read_solution_presentation(p_project text,p_presentation uuid,p_before uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p bob.solution_presentations; feedback jsonb; cursor_row bob.solution_model_feedback; next_id uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select * into p from bob.solution_presentations where project_id=p_project and id=p_presentation;
 if not found then raise exception 'presentation_unavailable' using errcode='42501';end if;
 if p_before is not null then
  select f.* into cursor_row from bob.solution_model_feedback f join bob.solution_presentations shown on shown.project_id=f.project_id and shown.id=f.presentation_id
   where f.project_id=p_project and f.id=p_before and shown.solution_id=p.solution_id and shown.solution_revision=p.solution_revision and shown.representation=p.representation;
  if not found then raise exception 'invalid_feedback_cursor' using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(f)-'turn_id'-'actor_id' order by f.recorded_at desc,f.id desc),'[]') into feedback from (
  select f.*, bob_private.solution_presentation_current(shown) as source_current, shown.view_id, shown.scope_area_id as area_id, shown.scope_label from bob.solution_model_feedback f join bob.solution_presentations shown on shown.project_id=f.project_id and shown.id=f.presentation_id
  where f.project_id=p_project and shown.solution_id=p.solution_id and shown.solution_revision=p.solution_revision
   and shown.representation=p.representation and (p_before is null or (f.recorded_at,f.id)<(cursor_row.recorded_at,cursor_row.id))
   order by f.recorded_at desc,f.id desc limit 11
 ) f;
 if jsonb_array_length(feedback)>10 then next_id:=(feedback->9->>'id')::uuid;feedback:=feedback-10;end if;
 return jsonb_build_object('project_id',p.project_id,'id',p.id,'solution_id',p.solution_id,'solution_revision',p.solution_revision,
  'area_id',p.scope_area_id,'scope_label',p.scope_label,'artifact_id',p.artifact_id,'artifact_revision',p.artifact_revision,'representation',p.representation,
  'view_id',p.view_id,'renderer_version',p.renderer_version,'shown_by',p.actor_label,'shown_at',p.recorded_at,
  'components',(select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','label',c->>'label') order by c->>'id'),'[]') from bob.solution_revisions r, jsonb_array_elements(r.design_intent#>'{model,components}') c where r.project_id=p_project and r.solution_id=p.solution_id and r.revision=p.solution_revision and c->'active'='true'::jsonb),
  'source_current',coalesce(bob_private.solution_presentation_current(p),false),'can_respond',p.actor_id=auth.uid(),
  'feedback',feedback,'next_feedback_id',next_id);
end $$;
revoke all on function bob.read_solution_presentation(text,uuid,uuid) from public,anon,service_role;
grant execute on function bob.read_solution_presentation(text,uuid,uuid) to authenticated;

-- Called after a visible rendered view, never by selecting a target or opening text.
-- This records a browser presentation, not gaze, comprehension or acceptance.
create function bob.record_solution_presentation(p_project text,p_solution uuid,p_revision integer,p_view text,p_area text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob.solution_revisions; stamp jsonb; actor text; shown uuid; scope_name text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501';end if;
 if p_area is not null and not exists(select 1 from bob.areas where id=p_area and project_id=p_project and archived_at is null) then raise exception 'project_denied' using errcode='42501';end if;
 select * into r from bob.solution_revisions where project_id=p_project and solution_id=p_solution and revision=p_revision;
 if not found or not exists(select 1 from jsonb_array_elements(r.design_intent#>'{model,views}') v where v->>'id'=p_view)
  then raise exception 'presentation_unavailable' using errcode='22023';end if;
 scope_name:=case when p_area is null then 'Project' else (select name from bob.areas where project_id=p_project and id=p_area) end;
 stamp:=bob_private.solution_presentation_source(p_project,p_solution,p_revision,p_area);
 insert into bob.solution_presentations(project_id,solution_id,solution_revision,scope_area_id,scope_label,representation,view_id,renderer_version,actor_id,actor_label,source_stamp,source_key)
  values(p_project,p_solution,p_revision,p_area,scope_name,'concept_2d',p_view,'solution-concept-v1',auth.uid(),actor,stamp,md5(stamp::text)) on conflict do nothing returning id into shown;
 if shown is null then select id into shown from bob.solution_presentations where project_id=p_project and actor_id=auth.uid()
  and solution_id=p_solution and solution_revision=p_revision and view_id=p_view and renderer_version='solution-concept-v1' and source_key=md5(stamp::text);end if;
 return bob.read_solution_presentation(p_project,shown);
end $$;
revoke all on function bob.record_solution_presentation(text,uuid,integer,text,text) from public,anon,service_role;
grant execute on function bob.record_solution_presentation(text,uuid,integer,text,text) to authenticated;

-- The logical turn owns its presentation. Neither the model nor a retry chooses
-- a different source, actor, version or convenient substring of the response.
create function bob_private.turn_solution_presentation(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare screen jsonb; p bob.solution_presentations;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select s.screen into screen from bob_private.bob_turn_screens s where thread_id=p_thread and turn_id=p_turn;
 if screen->>'presentationId' is null then return null;end if;
 select * into p from bob.solution_presentations where project_id=p_project and id=(screen->>'presentationId')::uuid and actor_id=auth.uid();
 if not found or screen->>'surface'<>'solutions' or screen->>'solutionId' is distinct from p.solution_id::text
  or screen->>'solutionRevision' is distinct from p.solution_revision::text then raise exception 'presentation_unavailable' using errcode='42501';end if;
 return p.id;
end $$;
revoke all on function bob_private.turn_solution_presentation(text,uuid,uuid,bigint) from public,anon,service_role;
grant execute on function bob_private.turn_solution_presentation(text,uuid,uuid,bigint) to authenticated;
create function bob.read_model_feedback(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_before uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare shown uuid;
begin
 shown:=bob_private.turn_solution_presentation(p_project,p_thread,p_turn,p_generation);
 if shown is null then return jsonb_build_object('status','not_shown');end if;
 return jsonb_build_object('status','ok','presentation',bob.read_solution_presentation(p_project,shown,p_before));
end $$;
revoke all on function bob.read_model_feedback(text,uuid,uuid,bigint,uuid) from public,anon,service_role;
grant execute on function bob.read_model_feedback(text,uuid,uuid,bigint,uuid) to authenticated;

create function bob.record_model_feedback(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; shown uuid; p bob.solution_presentations; mandate bob.solution_model_feedback;
 intent jsonb; components jsonb; msg text; op text; actor text; saved bob_private.bob_write_receipts; f bob.solution_model_feedback; result jsonb;
begin
 shown:=bob_private.turn_solution_presentation(p_project,p_thread,p_turn,p_generation);
 if shown is null then raise exception 'model_not_shown' using errcode='22023';end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->>'kind' is distinct from 'form_feedback'
  or p_payload->'record_id' is distinct from 'null'::jsonb or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or p_payload->'expected_revision' is distinct from 'null'::jsonb
  or msg is null or length(btrim(msg))=0 or p_payload->>'request_quote' is distinct from left(msg,500)
  or jsonb_typeof(d) is distinct from 'object' or d-array['outcome','authority','mandate_id','scope','component_ids','has_corrections','has_uncertainty']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>7 or octet_length(d::text)>6000 then raise exception 'invalid_model_feedback' using errcode='22023';end if;
 if coalesce(d->>'outcome','') not in ('accepted','change_requested','unclear','delegated') or coalesce(d->>'authority','') not in ('user','bob')
  or coalesce(d->>'scope','') not in ('whole_model','components') or jsonb_typeof(d->'component_ids') is distinct from 'array'
  or jsonb_typeof(d->'has_corrections') is distinct from 'boolean' or jsonb_typeof(d->'has_uncertainty') is distinct from 'boolean'
  or (d->'has_corrections'='true'::jsonb and d->>'outcome'<>'change_requested')
  or (d->'has_uncertainty'='true'::jsonb and d->>'outcome' not in ('unclear','change_requested'))
  or (d->>'outcome'='change_requested' and d->'has_corrections'<>'true'::jsonb)
  or (d->>'outcome'='unclear' and d->'has_uncertainty'<>'true'::jsonb)
  or (d->>'authority'='user' and d->'mandate_id' is distinct from 'null'::jsonb)
  or (d->>'authority'='bob' and (d->>'outcome'<>'accepted' or coalesce(d->>'mandate_id','')!~'^[0-9a-f-]{36}$'))
  then raise exception 'invalid_model_feedback' using errcode='22023';end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into p from bob.solution_presentations where project_id=p_project and id=shown;
 op:='form_feedback:'||shown::text||':'||(d->>'authority');
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if saved.payload is distinct from p_payload then raise exception 'record_changed' using errcode='PT409';end if;return saved.receipt;end if;
 if not bob_private.solution_presentation_current(p) and d->>'outcome' in ('accepted','delegated') then raise exception 'presentation_changed' using errcode='PT409';end if;
 if not bob_private.bob_turn_unlimited_work(p_project,p_thread,p_turn,p_generation) and (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32
  then raise exception 'write_budget_exhausted' using errcode='22023';end if;
 select design_intent into intent from bob.solution_revisions where project_id=p_project and solution_id=p.solution_id and revision=p.solution_revision;
 select jsonb_agg(c->>'id' order by c->>'id') into components from jsonb_array_elements(intent#>'{model,components}') c where c->'active'='true'::jsonb;
 if components is null then raise exception 'invalid_model_feedback' using errcode='22023';end if;
 if d->>'scope'='whole_model' then
  if d->'component_ids'<>'[]' then raise exception 'invalid_model_feedback' using errcode='22023';end if;
 else
  if jsonb_array_length(d->'component_ids')=0 or exists(select 1 from jsonb_array_elements(d->'component_ids') c where jsonb_typeof(c)<>'string' or not components@>jsonb_build_array(c))
   or (select count(distinct c) from jsonb_array_elements(d->'component_ids') c)<>jsonb_array_length(d->'component_ids') then raise exception 'invalid_model_feedback' using errcode='22023';end if;
  select jsonb_agg(c order by c) into components from jsonb_array_elements(d->'component_ids') c;
 end if;
 if d->>'authority'='bob' then
  select m.* into mandate from bob.solution_model_feedback m join bob.solution_presentations s on s.project_id=m.project_id and s.id=m.presentation_id
   where m.project_id=p_project and m.id=(d->>'mandate_id')::uuid and m.actor_id=auth.uid() and m.outcome='delegated' and m.authority='user'
    and s.solution_id=p.solution_id and s.solution_revision=p.solution_revision and s.representation=p.representation and s.source_stamp=p.source_stamp;
  if not found or not mandate.component_ids@>components or (d->>'scope'='whole_model' and mandate.scope<>'whole_model')
   or exists(select 1 from bob.solution_model_feedback later join bob.solution_presentations s on s.project_id=later.project_id and s.id=later.presentation_id
    where later.project_id=p_project and s.solution_id=p.solution_id and s.solution_revision=p.solution_revision
     and s.source_stamp=p.source_stamp and s.representation=p.representation and later.recorded_at>mandate.recorded_at and later.outcome in ('change_requested','unclear'))
   then raise exception 'mandate_unavailable' using errcode='PT409';end if;
 end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501';end if;
 insert into bob.solution_model_feedback(project_id,presentation_id,actor_id,actor_label,turn_id,outcome,authority,mandate_id,scope,component_ids)
  values(p_project,shown,auth.uid(),actor,p_turn,d->>'outcome',d->>'authority',(d->>'mandate_id')::uuid,d->>'scope',components) returning * into f;
 result:=jsonb_build_object('projectId',p_project,'dataset','solutions','recordId',p.solution_id,'revision',p.solution_revision,
  'label',(select title from bob.solution_revisions where project_id=p_project and solution_id=p.solution_id and revision=p.solution_revision),
  'operation','updated','savedAt',f.recorded_at,'record',jsonb_build_object('id',p.solution_id,'revision',p.solution_revision,
   'feedback',to_jsonb(f)-'turn_id'-'actor_id','presentation_id',shown));
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
  values(p_project,auth.uid(),p_turn,op,p_payload,jsonb_build_object('presentation_id',shown),result);
 return result;
exception when serialization_failure or deadlock_detected then raise sqlstate 'PT409' using message=sqlerrm;
end $$;
revoke all on function bob.record_model_feedback(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.record_model_feedback(text,uuid,uuid,bigint,jsonb) to authenticated;

create or replace function bob_private.validate_turn_screen(p_screen jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare surface text; allowed text[]; k text; v jsonb;
begin
 if p_screen is null or p_screen='null'::jsonb then return; end if;
 if jsonb_typeof(p_screen) is distinct from 'object' then raise exception 'invalid_screen' using errcode='22023'; end if;
 surface:=p_screen->>'surface';
 allowed:=case surface
 when 'project' then array['planStepId'] when 'areas' then '{}'::text[]
 when 'area' then array['areaId','planStepId'] when 'task' then array['areaId','taskId','planStepId','instructionId']
 when 'facts' then array['areaId'] when 'solutions' then array['areaId','solutionId','solutionRevision','presentationId']
 when 'drawings' then array['areaId','artifactId','artifactRevision','presentationId'] when 'people' then '{}'::text[]
 when 'events' then '{}'::text[] when 'event' then array['eventId'] when 'shopping' then '{}'::text[]
 when 'today' then '{}'::text[] when 'announcements' then '{}'::text[] when 'building' then '{}'::text[]
 when 'material-plan' then array['areaId'] end;
 if allowed is null or jsonb_typeof(p_screen->'surface') is distinct from 'string' or p_screen-(allowed||array['surface'])<>'{}'::jsonb then raise exception 'invalid_screen' using errcode='22023'; end if;
 for k,v in select key,value from jsonb_each(p_screen-'surface') loop
  if right(k,8)='Revision' then
   if jsonb_typeof(v) is distinct from 'number' or (v::text)::numeric<>trunc((v::text)::numeric) or (v::text)::numeric not between 1 and 2147483647 then raise exception 'invalid_screen' using errcode='22023'; end if;
  elsif jsonb_typeof(v) is distinct from 'string' or (p_screen->>k)!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$' then raise exception 'invalid_screen' using errcode='22023'; end if;
 end loop;
 if p_screen?'presentationId' and ((p_screen->>'presentationId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not (p_screen?'solutionId' or p_screen?'artifactId')) then raise exception 'invalid_screen' using errcode='22023';end if;
 if surface='area' and not p_screen?'areaId' or surface='task' and not p_screen?'taskId' or surface='event' and not p_screen?'eventId'
  or (p_screen?'artifactId')<>(p_screen?'artifactRevision') or (p_screen?'solutionId')<>(p_screen?'solutionRevision') then raise exception 'invalid_screen' using errcode='22023'; end if;
end $$;
revoke all on function bob_private.validate_turn_screen(jsonb) from public,anon,authenticated,service_role;

-- Feedback augments the existing design decision, never technical approval.
-- Untouched legacy decisions retain their old behavior; once visual feedback is
-- recorded it cannot be bypassed by model-written alignment prose or a new head.
alter function bob.read_design_readiness(text,text,integer,text) rename to read_design_readiness_before_model_feedback;
revoke all on function bob.read_design_readiness_before_model_feedback(text,text,integer,text) from public,anon,authenticated,service_role;
-- Invoker callers need the old reader (which retains its own project checks).
grant execute on function bob.read_design_readiness_before_model_feedback(text,text,integer,text) to authenticated;
create function bob.read_design_readiness(p_project text,p_area text,p_target_revision integer,p_purpose text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r jsonb; accepted bob.solution_model_feedback; has_feedback boolean; issues jsonb; target bob.target_revisions;
begin
 r:=bob.read_design_readiness_before_model_feedback(p_project,p_area,p_target_revision,p_purpose);
 if r->>'solution_id' is null or r->'design_intent'->'model' is null then return r;end if;
 select exists(select 1 from bob.solution_model_feedback f join bob.solution_presentations s on s.project_id=f.project_id and s.id=f.presentation_id
  where f.project_id=p_project and s.solution_id=(r->>'solution_id')::uuid) into has_feedback;
 if not has_feedback then return r;end if;
 select f.* into accepted from bob.solution_model_feedback f join bob.solution_presentations s on s.project_id=f.project_id and s.id=f.presentation_id
  where f.project_id=p_project and s.solution_id=(r->>'solution_id')::uuid and s.solution_revision=(r->>'solution_revision')::integer
   and (s.scope_area_id is null or s.scope_area_id=p_area) and s.source_stamp->>'target'=r->>'target_revision'
   and f.outcome='accepted' and f.scope='whole_model' and bob_private.solution_presentation_current(s)
   and not exists(select 1 from bob.solution_model_feedback later join bob.solution_presentations ls on ls.project_id=later.project_id and ls.id=later.presentation_id
    where later.project_id=p_project and ls.solution_id=s.solution_id and ls.solution_revision=s.solution_revision and ls.source_stamp=s.source_stamp and ls.representation=s.representation and later.recorded_at>f.recorded_at and later.outcome in ('change_requested','unclear'))
  order by f.recorded_at desc,f.id desc limit 1;
 if found then
  r:=r||jsonb_build_object('model_feedback',jsonb_build_object('id',accepted.id,'presentation_id',accepted.presentation_id,'outcome','accepted','authority',accepted.authority,'scope','whole_model','source_current',true));
  select coalesce(jsonb_agg(i),'[]') into issues from jsonb_array_elements(r->'issues') i where i->>'code'<>'design_alignment_required';
  r:=r||jsonb_build_object('issues',issues);
  if jsonb_array_length(issues)=0 and r->>'status' in ('ready','needs_data') then
   select * into target from bob.target_revisions where project_id=p_project and revision=(r->>'target_revision')::integer;
   r:=r||jsonb_build_object('status','ready','pin',jsonb_build_object('version',1,'project_id',p_project,'area_id',target.area_id,
    'target_revision',target.revision,'solution_id',target.solution_id,'solution_revision',target.solution_revision,'purpose',r->>'purpose'));
  end if;
 else
  r:=r||jsonb_build_object('model_feedback',null,'pin',null,'status',case when r->>'status' in ('unavailable','conflict') then r->>'status' else 'needs_data' end,
   'issues',(r->'issues')||jsonb_build_array(jsonb_build_object('code','model_feedback_unsettled','choice_id',null,
    'message','Saved visual feedback is limited, requests changes, is unclear or belongs to changed sources. Read the feedback and reconcile the shown model within the user response or explicit mandate.')));
 end if;
 return r;
end $$;
revoke all on function bob.read_design_readiness(text,text,integer,text) from public,anon,service_role;
grant execute on function bob.read_design_readiness(text,text,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
