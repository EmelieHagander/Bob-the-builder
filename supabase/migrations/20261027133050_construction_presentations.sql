-- FORM 4a: the saved Construction is the 3D source. No new geometry or approval owner.
-- CLI timestamp fallback (local CLI aborts); observed UTC 2026-10-27 13:30:50.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob.solution_presentations add column component_snapshot jsonb;
alter table bob.solution_presentations add constraint construction_presentation_components check(
 representation<>'construction_3d' or (component_snapshot is not null
  and jsonb_typeof(component_snapshot)='array' and jsonb_array_length(component_snapshot) between 1 and 48));
alter table bob.solution_presentations add constraint construction_presentation_source foreign key(project_id,artifact_id,artifact_revision)
 references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision) on delete cascade;
create index solution_presentations_construction on bob.solution_presentations(project_id,artifact_id,artifact_revision)
 where representation='construction_3d';

-- Called against one exact source. It reuses the bounded source-assessment owner;
-- neither presentation history nor camera changes run geometry/checker evaluation.
create function bob_private.construction_presentation_source(p_project text,p_artifact uuid,p_revision integer)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('artifact',r.artifact_id,'revision',r.revision,'head',h.current_revision,'archived',current.archived,
  'state',s.source_state,'target',r.target_revision,'solution',bob_private.solution_presentation_source(p_project,r.solution_id,r.solution_revision,h.area_id))
 from bob.artifact_revisions r join bob.artifacts h on h.id=r.artifact_id and h.project_id=r.project_id
 join bob.artifact_revisions current on current.project_id=h.project_id and current.artifact_id=h.id and current.revision=h.current_revision
 cross join lateral bob_private.artifact_source_assessment(p_project,p_artifact,p_revision) s
 where r.project_id=p_project and r.artifact_id=p_artifact and r.revision=p_revision
$$;
revoke all on function bob_private.construction_presentation_source(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.construction_presentation_source(text,uuid,integer) to authenticated;

create function bob_private.presentation_components(p bob.solution_presentations)
returns jsonb language sql stable security invoker set search_path='' as $$
 select case when p.representation='construction_3d' then p.component_snapshot else
 (select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','label',c->>'label') order by c->>'id'),'[]')
  from bob.solution_revisions r, jsonb_array_elements(r.design_intent#>'{model,components}') c
  where r.project_id=p.project_id and r.solution_id=p.solution_id and r.revision=p.solution_revision and c->'active'='true'::jsonb) end
$$;
revoke all on function bob_private.presentation_components(bob.solution_presentations) from public,anon,service_role;
grant execute on function bob_private.presentation_components(bob.solution_presentations) to authenticated;

alter function bob_private.solution_presentation_current(bob.solution_presentations) rename to concept_presentation_current;
create function bob_private.solution_presentation_current(p bob.solution_presentations)
returns boolean language sql stable security invoker set search_path='' as $$
 select case when p.representation='concept_2d' then bob_private.concept_presentation_current(p)
 else p.renderer_version='construction-boxes-v1'
  and (p.scope_area_id is null or exists(select 1 from bob.areas where id=p.scope_area_id and project_id=p.project_id and archived_at is null))
  and p.source_stamp->>'head'=p.artifact_revision::text and p.source_stamp->'archived'='false'::jsonb
  and p.source_stamp->>'state'='current'
  and p.source_stamp#>>'{solution,head}'=p.solution_revision::text and p.source_stamp#>'{solution,archived}'='false'::jsonb
  and not exists(select 1 from jsonb_array_elements(p.source_stamp#>'{solution,measurements}') m where m->1 is distinct from m->2 or m->3 is distinct from 'false'::jsonb)
  and not exists(select 1 from jsonb_array_elements(p.source_stamp#>'{solution,images}') m where m->>1 is distinct from 'ready')
  and p.source_stamp is not distinct from bob_private.construction_presentation_source(p.project_id,p.artifact_id,p.artifact_revision) end
$$;
revoke all on function bob_private.solution_presentation_current(bob.solution_presentations) from public,anon,service_role;
grant execute on function bob_private.solution_presentation_current(bob.solution_presentations) to authenticated;

-- The ordinary browser reports an actual rendered view, not acceptance. Exact
-- lineage, component scope, material pins and supported solids are server-owned.
create function bob.record_construction_presentation(p_project text,p_artifact uuid,p_revision integer,p_view text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a bob.artifacts; r bob.artifact_revisions; c bob.artifact_construction_revisions;
 intent jsonb; refinement jsonb; components jsonb; stamp jsonb; actor text; shown uuid; scope_name text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_view is null or p_view not in ('overview','front','back','left','right','top') then raise exception 'presentation_unavailable' using errcode='22023';end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501';end if;
 select * into a from bob.artifacts where project_id=p_project and id=p_artifact;
 select * into r from bob.artifact_revisions where project_id=p_project and artifact_id=p_artifact and revision=p_revision;
 if not found then raise exception 'presentation_unavailable' using errcode='42501';end if;
 select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision;
 if not found or exists(select 1 from jsonb_array_elements(c.recipe->'definitions') d where d->>'primitive'<>'box' or jsonb_array_length(coalesce(d->'cuts','[]'))>0)
  or exists(select 1 from jsonb_array_elements(c.materials) m where not exists(select 1 from bob.catalog_item_revisions material
    where material.item_id=(m->>'material_id')::uuid and material.revision=(m->>'material_revision')::integer))
  then raise exception 'presentation_unsupported' using errcode='22023';end if;
 select design_intent into intent from bob.solution_revisions where project_id=p_project and solution_id=r.solution_id and revision=r.solution_revision;
 select f.refinement into refinement from bob.artifact_construction_refinements f where f.project_id=p_project and f.artifact_id=p_artifact and f.artifact_revision=p_revision;
 if (refinement is null or refinement='null'::jsonb) and exists(select 1 from jsonb_array_elements(c.recipe->'instances') i
  where not exists(select 1 from jsonb_array_elements(intent#>'{model,components}') part where part->'active'='true'::jsonb and part->>'id'=i->>'id'))
  then raise exception 'presentation_scope_unavailable' using errcode='22023';end if;
 -- For the older one-to-one contract, only components with an exact saved
 -- instance identity are shown. Unmapped historical solids cannot grant consent.
 select coalesce(jsonb_agg(jsonb_build_object('id',part->>'id','label',part->>'label') order by part->>'id'),'[]') into components
 from jsonb_array_elements(intent#>'{model,components}') part where part->'active'='true'::jsonb and
 case when refinement is not null and refinement<>'null'::jsonb
  then exists(select 1 from jsonb_array_elements(refinement->'mappings') m where m->>'component_id'=part->>'id')
  else exists(select 1 from jsonb_array_elements(c.recipe->'instances') i where i->>'id'=part->>'id') end;
 if jsonb_array_length(components)=0 then raise exception 'presentation_scope_unavailable' using errcode='22023';end if;
 if a.area_id is not null and not exists(select 1 from bob.areas where id=a.area_id and project_id=p_project and archived_at is null) then raise exception 'project_denied' using errcode='42501';end if;
 scope_name:=case when a.area_id is null then 'Project' else (select name from bob.areas where project_id=p_project and id=a.area_id) end;
 stamp:=bob_private.construction_presentation_source(p_project,p_artifact,p_revision);
 insert into bob.solution_presentations(project_id,solution_id,solution_revision,scope_area_id,scope_label,artifact_id,artifact_revision,
  representation,view_id,renderer_version,actor_id,actor_label,source_stamp,source_key,component_snapshot)
 values(p_project,r.solution_id,r.solution_revision,a.area_id,scope_name,p_artifact,p_revision,'construction_3d',p_view,'construction-boxes-v1',
  auth.uid(),actor,stamp,md5(stamp::text),components) on conflict do nothing returning id into shown;
 if shown is null then select id into shown from bob.solution_presentations where project_id=p_project and actor_id=auth.uid()
  and solution_id=r.solution_id and solution_revision=r.solution_revision and view_id=p_view and renderer_version='construction-boxes-v1'
  and artifact_id=p_artifact and artifact_revision=p_revision and source_key=md5(stamp::text);end if;
 return bob.read_solution_presentation(p_project,shown);
end $$;
revoke all on function bob.record_construction_presentation(text,uuid,integer,text) from public,anon,service_role;
grant execute on function bob.record_construction_presentation(text,uuid,integer,text) to authenticated;

create or replace function bob_private.turn_solution_presentation(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare screen jsonb; p bob.solution_presentations;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select s.screen into screen from bob_private.bob_turn_screens s where thread_id=p_thread and turn_id=p_turn;
 if screen->>'presentationId' is null then return null;end if;
 select * into p from bob.solution_presentations where project_id=p_project and id=(screen->>'presentationId')::uuid and actor_id=auth.uid();
 if not found or (case when p.representation='construction_3d' then
   screen->>'surface'='drawings' and screen->>'artifactId'=p.artifact_id::text and screen->>'artifactRevision'=p.artifact_revision::text
  else screen->>'surface'='solutions' and screen->>'solutionId'=p.solution_id::text and screen->>'solutionRevision'=p.solution_revision::text end) is not true
  then raise exception 'presentation_unavailable' using errcode='42501';end if;
 return p.id;
end $$;

-- Shared read/write and readiness definitions follow. The reader scopes 3D
-- history to the exact Construction; full-model feedback expands only its
-- shown components. Positive 3D feedback does not replace concept readiness.

create or replace function bob.read_solution_presentation(p_project text,p_presentation uuid,p_before uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p bob.solution_presentations; feedback jsonb; cursor_row bob.solution_model_feedback; next_id uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select * into p from bob.solution_presentations where project_id=p_project and id=p_presentation;
 if not found then raise exception 'presentation_unavailable' using errcode='42501';end if;
 if p_before is not null then
  select f.* into cursor_row from bob.solution_model_feedback f join bob.solution_presentations shown on shown.project_id=f.project_id and shown.id=f.presentation_id
   where f.project_id=p_project and f.id=p_before and shown.solution_id=p.solution_id and shown.solution_revision=p.solution_revision and shown.representation=p.representation and shown.artifact_id is not distinct from p.artifact_id and shown.artifact_revision is not distinct from p.artifact_revision;
  if not found then raise exception 'invalid_feedback_cursor' using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(f)-'turn_id'-'actor_id' order by f.recorded_at desc,f.id desc),'[]') into feedback from (
  select f.*, bob_private.solution_presentation_current(shown) as source_current, shown.view_id, shown.scope_area_id as area_id, shown.scope_label from bob.solution_model_feedback f join bob.solution_presentations shown on shown.project_id=f.project_id and shown.id=f.presentation_id
  where f.project_id=p_project and shown.solution_id=p.solution_id and shown.solution_revision=p.solution_revision
   and shown.representation=p.representation and shown.artifact_id is not distinct from p.artifact_id and shown.artifact_revision is not distinct from p.artifact_revision and (p_before is null or (f.recorded_at,f.id)<(cursor_row.recorded_at,cursor_row.id))
   order by f.recorded_at desc,f.id desc limit 11
 ) f;
 if jsonb_array_length(feedback)>10 then next_id:=(feedback->9->>'id')::uuid;feedback:=feedback-10;end if;
 return jsonb_build_object('project_id',p.project_id,'id',p.id,'solution_id',p.solution_id,'solution_revision',p.solution_revision,
  'area_id',p.scope_area_id,'scope_label',p.scope_label,'artifact_id',p.artifact_id,'artifact_revision',p.artifact_revision,'representation',p.representation,
  'view_id',p.view_id,'renderer_version',p.renderer_version,'shown_by',p.actor_label,'shown_at',p.recorded_at,
  'components',bob_private.presentation_components(p),
  'source_current',coalesce(bob_private.solution_presentation_current(p),false),'can_respond',p.actor_id=auth.uid(),
  'feedback',feedback,'next_feedback_id',next_id);
end $$;

create or replace function bob.record_model_feedback(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
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
 select jsonb_agg(c->>'id' order by c->>'id') into components from jsonb_array_elements(bob_private.presentation_components(p)) c;
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
 result:=jsonb_build_object('projectId',p_project,'dataset',case when p.representation='construction_3d' then 'artifacts' else 'solutions' end,
  'recordId',coalesce(p.artifact_id,p.solution_id),'revision',coalesce(p.artifact_revision,p.solution_revision),
  'label',(select title from bob.solution_revisions where project_id=p_project and solution_id=p.solution_id and revision=p.solution_revision),
  'operation','updated','savedAt',f.recorded_at,'record',jsonb_build_object('id',coalesce(p.artifact_id,p.solution_id),'revision',coalesce(p.artifact_revision,p.solution_revision),
   'feedback',to_jsonb(f)-'turn_id'-'actor_id','presentation_id',shown));
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
  values(p_project,auth.uid(),p_turn,op,p_payload,jsonb_build_object('presentation_id',shown),result);
 return result;
exception when serialization_failure or deadlock_detected then raise sqlstate 'PT409' using message=sqlerrm;
end $$;

create or replace function bob.read_design_readiness(p_project text,p_area text,p_target_revision integer,p_purpose text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r jsonb; accepted bob.solution_model_feedback; has_feedback boolean; issues jsonb; target bob.target_revisions;
begin
 r:=bob.read_design_readiness_before_model_feedback(p_project,p_area,p_target_revision,p_purpose);
 if r->>'solution_id' is null or r->'design_intent'->'model' is null then return r;end if;
 select exists(select 1 from bob.solution_model_feedback f join bob.solution_presentations s on s.project_id=f.project_id and s.id=f.presentation_id
  where f.project_id=p_project and s.solution_id=(r->>'solution_id')::uuid and s.representation='concept_2d') into has_feedback;
 if has_feedback then
 select f.* into accepted from bob.solution_model_feedback f join bob.solution_presentations s on s.project_id=f.project_id and s.id=f.presentation_id
  where f.project_id=p_project and s.solution_id=(r->>'solution_id')::uuid and s.solution_revision=(r->>'solution_revision')::integer
   and (s.scope_area_id is null or s.scope_area_id=p_area) and s.source_stamp->>'target'=r->>'target_revision'
   and s.representation='concept_2d' and f.outcome='accepted' and f.scope='whole_model' and bob_private.solution_presentation_current(s)
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
 end if; -- concept feedback augments the concept readiness owner
 if exists(select 1 from bob.solution_model_feedback f join bob.solution_presentations s on s.project_id=f.project_id and s.id=f.presentation_id
  where f.project_id=p_project and s.solution_id=(r->>'solution_id')::uuid and s.solution_revision=(r->>'solution_revision')::integer
   and s.representation='construction_3d' and f.outcome in ('change_requested','unclear') and bob_private.solution_presentation_current(s)
   and not exists(select 1 from bob.solution_model_feedback later join bob.solution_presentations ls on ls.project_id=later.project_id and ls.id=later.presentation_id
    where later.project_id=p_project and ls.source_stamp=s.source_stamp and ls.representation=s.representation and later.recorded_at>f.recorded_at
     and later.outcome='accepted' and later.component_ids@>f.component_ids)) then
  r:=r||jsonb_build_object('pin',null,'status',case when r->>'status' in ('unavailable','conflict') then r->>'status' else 'needs_data' end,
   'issues',(r->'issues')||jsonb_build_array(jsonb_build_object('code','construction_feedback_unsettled','choice_id',null,
    'message','The shown construction has unresolved changes or uncertainty. Reconcile that exact version before delivery.')));
 end if;
 return r;
end $$;
notify pgrst,'reload schema';
commit;
