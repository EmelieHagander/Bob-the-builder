-- P2c: explicit caller-authorized reconstruction from the current canonical Step.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table bob_private.project_drawing_requests
 add column recovery_plan_revision integer,
 add column recovery_step_id uuid,
 add constraint drawing_recovery_pair check ((recovery_plan_revision is null)=(recovery_step_id is null) and (recovery_plan_revision is null or recovery_plan_revision>0));

-- The current plan pointer is locked against revision changes until checkpoint /
-- completion commits. Historical receipts need no current-plan endorsement.
create function bob_private.assert_drawing_recovery_current(r bob_private.project_drawing_requests)
returns void language plpgsql security definer set search_path='' as $$
declare current_plan integer;
begin
 if r.recovery_plan_revision is null or r.status in ('saved','cancelled') then return; end if;
 select current_revision into current_plan from bob.project_plans where project_id=r.project_id for share;
 if current_plan is distinct from r.recovery_plan_revision then raise exception 'drawing_requirements_changed' using errcode='40001'; end if;
end $$;
revoke all on function bob_private.assert_drawing_recovery_current(bob_private.project_drawing_requests) from public,anon,authenticated,service_role;

create function bob_private.check_drawing_request(p_project text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||auth.uid()::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found then return null; end if; -- legacy thread-only request
 if r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if r.status<>'paused' then perform bob_private.assert_drawing_recovery_current(r); end if;
 return jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reason',r.reason);
end $$;
revoke all on function bob_private.check_drawing_request(text,uuid) from public,anon,service_role;
grant execute on function bob_private.check_drawing_request(text,uuid) to authenticated;
create function bob.check_drawing_request(p_project text,p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.check_drawing_request(p_project,p_id) $$;
revoke all on function bob.check_drawing_request(text,uuid) from public,anon,service_role;
grant execute on function bob.check_drawing_request(text,uuid) to authenticated;

create function bob_private.restore_drawing_request(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_expected integer,p_plan_revision integer,p_step uuid,p_request_quote text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; step bob.project_plan_steps; current_plan integer;
 msg text; requirements jsonb; working jsonb; result jsonb; old_input jsonb; input jsonb; key text;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status='cancelled' then raise exception 'drawing_request_cancelled' using errcode='40001'; end if;
 if r.status='saved' then raise exception 'drawing_request_complete' using errcode='40001'; end if;
 select current_revision into current_plan from bob.project_plans where project_id=p_project for share;
 if p_plan_revision is null or current_plan is distinct from p_plan_revision then raise exception 'drawing_requirements_changed' using errcode='40001'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if coalesce(length(btrim(p_request_quote)),0) not between 1 and 500 or msg is null or position(p_request_quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 key:='restore:'||p_turn::text||':'||p_id::text||':'||coalesce(p_expected::text,'null');
 input:=jsonb_build_object('id',p_id,'expected',p_expected,'plan_revision',p_plan_revision,'step_id',p_step,'request_quote',p_request_quote);
 select w.result,w.input into result,old_input from bob_private.drawing_request_writes w where w.thread_id=p_thread and w.write_key=key;
 if found then
  if old_input is distinct from input then raise exception 'drawing_restore_conflict' using errcode='40001'; end if;
  return result;
 end if;
 if p_expected is null or r.revision<>p_expected then raise exception 'drawing_request_changed' using errcode='40001'; end if;
 if r.status<>'paused' and (r.recovery_plan_revision is null or r.recovery_plan_revision=current_plan) then raise exception 'drawing_request_not_paused' using errcode='40001'; end if;
 select * into step from bob.project_plan_steps where project_id=p_project and plan_revision=current_plan and step_id=p_step for share;
 if not found or (r.scope->>'step_id' is not null and r.scope->>'step_id'<>p_step::text)
  or (r.scope->>'area_id' is not null and r.scope->>'area_id' is distinct from step.area_id) then raise exception 'drawing_scope_changed' using errcode='40001'; end if;
 -- Revalidate every immutable destination against this project; no silent scope change.
 if r.scope->>'area_id' is not null then
  perform 1 from bob.areas where id=r.scope->>'area_id' and project_id=p_project for key share;
  if not found then raise exception 'drawing_scope_changed' using errcode='40001'; end if;
 end if;
 if r.scope->>'component_id' is not null then
  perform 1 from bob.existing_components where id=(r.scope->>'component_id')::uuid and project_id=p_project for key share;
  if not found then raise exception 'drawing_scope_changed' using errcode='40001'; end if;
 end if;
 if r.scope->>'artifact_id' is not null then
  perform 1 from bob.artifacts where id=(r.scope->>'artifact_id')::uuid and project_id=p_project for key share;
  if not found then raise exception 'drawing_scope_changed' using errcode='40001'; end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.requirement_id,'requirement',concat_ws(E'\n',q.title,nullif(q.description,''),'Resolution: '||q.resolution),'basis','project_record','source_ref',q.requirement_id::text) order by q.position,q.requirement_id),'[]') into requirements
 from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=current_plan and q.step_id=p_step;
 -- Never truncate or cherry-pick away canonical requirements to fit the handoff.
 if jsonb_array_length(requirements) not between 1 and 23 or length(step.goal)>2000
  or exists(select 1 from jsonb_array_elements(requirements) q where length(q->>'requirement')>2000) then raise exception 'drawing_requirements_unavailable' using errcode='22023'; end if;
 requirements:=requirements||jsonb_build_array(jsonb_build_object('id','restored_owner_request','requirement',p_request_quote,'basis','user_request','source_ref',null));
 working:=jsonb_build_object('brief',r.scope||jsonb_build_object('request_id',r.id,'brief',step.title||E'\n'||step.goal,
  'handoff',jsonb_build_object('deliverable',step.goal,'requirements',requirements,
   'coordinates',jsonb_build_object('origin',null,'positive_x',null,'positive_y',null,'positive_z',null),
   'views',jsonb_build_array('front','right','top','isometric'),
   'unresolved',jsonb_build_array('Private requirements were cleared. Assess current canonical requirements and this owner instruction; unknown directions and physical constraints remain unknown.'))),
  'owner_request',msg,'reference_refs','[]'::jsonb,'restoration',jsonb_build_object('plan_revision',current_plan,'step_id',p_step));
 if working::text ~ '(data:image/|base64,|[?&](token|signature|X-Amz-Signature)=|"image_url"\s*:|"previews"\s*:|"files"\s*:)' then raise exception 'drawing_request_pixels_forbidden' using errcode='22023'; end if;
 -- One atomic handoff: no interval with an active header and absent private packet.
 insert into bob_private.drawing_requests(id,thread_id,revision,status,payload)
 values(r.id,p_thread,r.revision+1,'collecting',working)
 on conflict(id) do update set thread_id=excluded.thread_id,revision=excluded.revision,status=excluded.status,payload=excluded.payload,saved_receipt=null,saved_input_hash=null,updated_at=clock_timestamp();
 update bob_private.project_drawing_requests set thread_id=p_thread,revision=revision+1,status='collecting',reason=null,
 recovery_plan_revision=current_plan,recovery_step_id=p_step,updated_at=clock_timestamp() where id=r.id returning * into r;
 result:=jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'payload',working);
 insert into bob_private.drawing_request_writes values(p_thread,key,input,result);
 return result;
end $$;
revoke all on function bob_private.restore_drawing_request(text,uuid,uuid,bigint,uuid,integer,integer,uuid,text) from public,anon,service_role;
grant execute on function bob_private.restore_drawing_request(text,uuid,uuid,bigint,uuid,integer,integer,uuid,text) to authenticated;
create function bob.restore_drawing_request(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_expected integer,p_plan_revision integer,p_step uuid,p_request_quote text) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.restore_drawing_request(p_project,p_thread,p_turn,p_generation,p_id,p_expected,p_plan_revision,p_step,p_request_quote) $$;
revoke all on function bob.restore_drawing_request(text,uuid,uuid,bigint,uuid,integer,integer,uuid,text) from public,anon,service_role;
grant execute on function bob.restore_drawing_request(text,uuid,uuid,bigint,uuid,integer,integer,uuid,text) to authenticated;

-- Keep the canonical save and private packet gates; new wrappers add only the
-- restored requirement revision fence. No service-role domain writes.
alter function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) rename to bob_drawing_request_before_restoration;
revoke all on function bob.bob_drawing_request_before_restoration(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
create function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 if p_operation='save' then
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  select * into r from bob_private.project_drawing_requests where id=p_id for update;
  if found and r.project_id=p_project and r.owner_user_id=p_user then
   perform bob_private.assert_drawing_recovery_current(r);
   if r.recovery_plan_revision is not null then p_payload:=p_payload||jsonb_build_object('restoration',jsonb_build_object('plan_revision',r.recovery_plan_revision,'step_id',r.recovery_step_id)); end if;
  end if;
 end if;
 return bob.bob_drawing_request_before_restoration(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;
alter function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_restoration;
revoke all on function bob_private.bob_project_write_before_restoration(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 if p_payload->>'kind'='cad' and p_payload->'data' ? 'drawing_request' then
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  select * into r from bob_private.project_drawing_requests where id=(p_payload#>>'{data,drawing_request,id}')::uuid for update;
  if found and r.project_id=p_project and r.owner_user_id=auth.uid() then
   -- Match the existing CAD writer: project head before current plan pointer.
   if r.recovery_plan_revision is not null and r.status not in ('saved','cancelled') then perform 1 from bob.projects where id=p_project for no key update; end if;
   perform bob_private.assert_drawing_recovery_current(r);
  end if;
 end if;
 return bob_private.bob_project_write_before_restoration(p_project,p_thread,p_turn,p_generation,p_payload);
end $$;
revoke all on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) to authenticated;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('restore_drawing_request','Restore the initiating member''s paused drawing from an explicit current plan Step.','Read request status and the current approved plan first. Supply exact request and plan revisions, a Step with complete canonical requirements, and a quote from the current owner instruction. All Step requirements are restored without private chat. Returns collecting, never readiness. Continue design_project_cad with the same request_id; current sources and the full intake must pass before design. Changed plan requirements require explicit restoration again. Cancellation and completion remain terminal; no new budget or authority is granted.',1,false,'{}',true);
notify pgrst,'reload schema';
commit;
