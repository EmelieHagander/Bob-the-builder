-- P2b: caller-created operational identity; private working packets still reset.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.project_drawing_requests (
 id uuid primary key,
 project_id text not null references bob.projects(id) on delete cascade,
 owner_user_id uuid references auth.users(id) on delete set null,
 thread_id uuid references bob.bob_threads(id) on delete set null,
 revision integer not null default 0 check(revision>=0),
 status text not null default 'paused' check(status in ('collecting','needs_data','retrieval_failed','ready_to_design','draft','reviewed','saved','paused','cancelled')),
 reason text default 'context_missing' check(reason in ('context_missing','context_cleared','owner_cancelled')),
 scope jsonb not null,
 saved_receipt jsonb,
 saved_input_hash text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index project_drawing_requests_project on bob_private.project_drawing_requests(project_id,id);
create index project_drawing_requests_thread on bob_private.project_drawing_requests(thread_id);
alter table bob_private.project_drawing_requests enable row level security;
revoke all on bob_private.project_drawing_requests from public,anon,authenticated,service_role;

-- Only this allowlist crosses the project-member boundary. Never expose the
-- private Auth/thread IDs, original brief, assessment or complete audit receipt.
create function bob_private.drawing_request_projection(r bob_private.project_drawing_requests)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'project_id',r.project_id,'revision',r.revision,'kind','cad',
 'status',r.status,'reason',r.reason,'scope',r.scope,
 'responsible_person_id',(select p.id from bob.people p where p.project_id=r.project_id and p.auth_user_id=r.owner_user_id),
 'artifact_id',r.saved_receipt->>'recordId','artifact_revision',r.saved_receipt->'revision',
 'created_at',r.created_at,'updated_at',r.updated_at)
$$;
revoke all on function bob_private.drawing_request_projection(bob_private.project_drawing_requests) from public,anon,authenticated,service_role;

create function bob_private.project_drawing_requests(p_project text,p_id uuid default null,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; cursor_id uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(bob_private.drawing_request_projection(r) order by r.id),'[]') into rows
 from (select * from bob_private.project_drawing_requests where project_id=p_project
  and (p_id is null or id=p_id) and (p_after is null or id>p_after) order by id limit 20) r;
 if jsonb_array_length(rows)=20 and p_id is null then cursor_id:=(rows->19->>'id')::uuid; end if;
 return jsonb_build_object('requests',rows,'next_cursor',cursor_id);
end $$;
revoke all on function bob_private.project_drawing_requests(text,uuid,uuid) from public,anon,service_role;
grant execute on function bob_private.project_drawing_requests(text,uuid,uuid) to authenticated;
create function bob.project_drawing_requests(p_project text,p_id uuid default null,p_after uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.project_drawing_requests(p_project,p_id,p_after) $$;
revoke all on function bob.project_drawing_requests(text,uuid,uuid) from public,anon,service_role;
grant execute on function bob.project_drawing_requests(text,uuid,uuid) to authenticated;

create function bob_private.create_drawing_request(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_id is null or jsonb_typeof(p_scope) is distinct from 'object'
  or not p_scope ?& array['area_id','component_id','step_id','artifact_id']
  or p_scope-array['area_id','component_id','step_id','artifact_id']::text[]<>'{}'
  or exists(select 1 from jsonb_each(p_scope) v where jsonb_typeof(v.value) not in ('null','string') or length(v.value::text)>202) then
  raise exception 'invalid_drawing_scope' using errcode='22023'; end if;
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if found then
  if r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
  if r.scope is distinct from p_scope then raise exception 'drawing_scope_changed' using errcode='40001'; end if;
  -- Stable create receipt, not a claim about the current lifecycle state.
  return jsonb_build_object('id',r.id,'revision',0,'status','created');
 end if;
 if exists(select 1 from bob_private.drawing_requests where id=p_id) then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if p_scope->>'area_id' is not null then
  perform 1 from bob.areas where id=p_scope->>'area_id' and project_id=p_project for key share;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 if p_scope->>'component_id' is not null then
  perform 1 from bob.existing_components where id=(p_scope->>'component_id')::uuid and project_id=p_project for key share;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 if p_scope->>'step_id' is not null then
  perform 1 from bob.project_plan_step_identities where step_id=(p_scope->>'step_id')::uuid and project_id=p_project for key share;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 if p_scope->>'artifact_id' is not null then
  perform 1 from bob.artifacts where id=(p_scope->>'artifact_id')::uuid and project_id=p_project for key share;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,thread_id,scope)
 values(p_id,p_project,auth.uid(),p_thread,p_scope);
 return jsonb_build_object('id',p_id,'revision',0,'status','created');
end $$;
revoke all on function bob_private.create_drawing_request(text,uuid,uuid,bigint,uuid,jsonb) from public,anon,service_role;
grant execute on function bob_private.create_drawing_request(text,uuid,uuid,bigint,uuid,jsonb) to authenticated;
create function bob.create_drawing_request(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_scope jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.create_drawing_request(p_project,p_thread,p_turn,p_generation,p_id,p_scope) $$;
revoke all on function bob.create_drawing_request(text,uuid,uuid,bigint,uuid,jsonb) from public,anon,service_role;
grant execute on function bob.create_drawing_request(text,uuid,uuid,bigint,uuid,jsonb) to authenticated;

create function bob_private.cancel_drawing_request(p_project text,p_id uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 -- Same actor lock as claim/reset/write, then the stable request row.
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||auth.uid()::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id and project_id=p_project for update;
 if not found or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if r.status='saved' then raise exception 'drawing_request_complete' using errcode='40001'; end if;
 if r.status='cancelled' and r.revision=p_expected+1 then return jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status); end if;
 if p_expected is null or r.revision<>p_expected or r.status='cancelled' then raise exception 'drawing_request_changed' using errcode='40001'; end if;
 update bob_private.project_drawing_requests set revision=revision+1,status='cancelled',reason='owner_cancelled',updated_at=clock_timestamp() where id=p_id returning * into r;
 return jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status);
end $$;
revoke all on function bob_private.cancel_drawing_request(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.cancel_drawing_request(text,uuid,integer) to authenticated;
create function bob.cancel_drawing_request(p_project text,p_id uuid,p_expected integer)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.cancel_drawing_request(p_project,p_id,p_expected) $$;
revoke all on function bob.cancel_drawing_request(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.cancel_drawing_request(text,uuid,integer) to authenticated;

-- Reset already owns actor/thread/provider locks and rejects active turns. Keep
-- its exact API/CAS behavior. Erase the packet, fence attempts, preserve receipts.
create function bob_private.detach_drawing_requests_on_reset() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update bob_private.project_drawing_requests set thread_id=null,
  revision=revision+case when status in ('saved','cancelled') then 0 else 1 end,
  reason=case when status in ('saved','cancelled') then reason else 'context_cleared' end,
  status=case when status in ('saved','cancelled') then status else 'paused' end,
  updated_at=clock_timestamp() where thread_id=old.id;
 return old;
end $$;
revoke all on function bob_private.detach_drawing_requests_on_reset() from public,anon,authenticated,service_role;
create trigger detach_project_drawing_requests before delete on bob.bob_threads for each row execute function bob_private.detach_drawing_requests_on_reset();

alter function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) rename to bob_drawing_request_before_project_lifecycle;
revoke all on function bob.bob_drawing_request_before_project_lifecycle(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
create function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; packet bob_private.drawing_requests; result jsonb; input jsonb; old_input jsonb; own jsonb;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 if p_operation='list' then
  select coalesce(jsonb_agg(item order by stamp desc),'[]') into own from (
   select updated_at stamp,bob_private.drawing_request_projection(q) item from bob_private.project_drawing_requests q
   where project_id=p_project and owner_user_id=p_user and status not in ('saved','cancelled') order by updated_at desc limit 12) s;
  result:=bob.bob_drawing_request_before_project_lifecycle(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
  return own||coalesce((select jsonb_agg(v) from jsonb_array_elements(result) v where not exists(select 1 from bob_private.project_drawing_requests where id=(v->>'id')::uuid)),'[]');
 end if;
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found then
  return bob.bob_drawing_request_before_project_lifecycle(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 end if;
 if r.project_id<>p_project or r.owner_user_id is distinct from p_user then
  if p_operation='load' then return null; end if;
  raise exception 'drawing_request_denied' using errcode='42501';
 end if;
 if p_operation='load' then
  if r.status in ('saved','cancelled','paused') then
   return jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reason',r.reason,'receipt',r.saved_receipt,
    'payload',jsonb_build_object('brief','{}'::jsonb,'owner_request',null,'reference_refs','[]'::jsonb));
  end if;
  if r.thread_id is distinct from p_thread then return null; end if;
  return bob.bob_drawing_request_before_project_lifecycle(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 end if;
 if p_operation<>'save' then raise exception 'invalid_operation'; end if;
 if r.status='cancelled' then raise exception 'drawing_request_cancelled' using errcode='40001'; end if;
 if r.status='saved' then raise exception 'drawing_request_complete' using errcode='40001'; end if;
 if r.thread_id is distinct from p_thread or (r.status='paused' and r.revision<>0) then raise exception 'drawing_context_cleared' using errcode='40001'; end if;
 if p_status='saved' then raise exception 'drawing_completion_requires_receipt' using errcode='22023'; end if;
 if p_write_key is null or length(p_write_key)>200 then raise exception 'invalid_write_key'; end if;
 input:=jsonb_build_object('id',p_id,'expected',p_expected,'status',p_status,'payload',p_payload);
 select w.result,w.input into result,old_input from bob_private.drawing_request_writes w where w.thread_id=p_thread and w.write_key=p_write_key;
 if found then
  if old_input is distinct from input then raise exception 'write_key_conflict'; end if;
  return result;
 end if;
 if r.revision is distinct from p_expected then raise exception 'revision_conflict' using errcode='40001'; end if;
 if p_payload is null or jsonb_typeof(p_payload->'brief') is distinct from 'object' or jsonb_typeof(p_payload->'reference_refs') is distinct from 'array' then raise exception 'invalid_drawing_request'; end if;
 if jsonb_build_object('area_id',p_payload->'brief'->'area_id','component_id',p_payload->'brief'->'component_id','step_id',p_payload->'brief'->'step_id','artifact_id',p_payload->'brief'->'artifact_id') is distinct from r.scope then raise exception 'drawing_scope_changed' using errcode='40001'; end if;
 if p_payload::text ~ '(data:image/|base64,|[?&](token|signature|X-Amz-Signature)=|"image_url"\s*:|"previews"\s*:|"files"\s*:)' then raise exception 'drawing_request_pixels_forbidden'; end if;
 if r.revision=0 then
  insert into bob_private.drawing_requests(id,thread_id,status,payload) values(p_id,p_thread,p_status,p_payload) returning * into packet;
  result:=jsonb_build_object('id',packet.id,'revision',packet.revision,'status',packet.status,'payload',packet.payload);
  insert into bob_private.drawing_request_writes values(p_thread,p_write_key,input,result);
 else
  result:=bob.bob_drawing_request_before_project_lifecycle(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 end if;
 update bob_private.project_drawing_requests set revision=(result->>'revision')::integer,status=result->>'status',reason=null,updated_at=clock_timestamp() where id=p_id;
 return result;
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;

alter function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_project_lifecycle;
revoke all on function bob_private.bob_project_write_before_project_lifecycle(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; result jsonb; input_hash text; msg text;
begin
 if p_payload->>'kind' is distinct from 'cad' or not (p_payload->'data' ? 'drawing_request') then
  return bob_private.bob_project_write_before_project_lifecycle(p_project,p_thread,p_turn,p_generation,p_payload);
 end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if jsonb_typeof(p_payload#>'{data,drawing_request}') is distinct from 'object'
  or (p_payload#>'{data,drawing_request}')-array['id','revision']::text[]<>'{}'
  or coalesce(p_payload#>>'{data,drawing_request,revision}','')!~'^[1-9][0-9]{0,8}$'
  or p_payload#>>'{data,drawing_request,id}' is null then raise exception 'invalid_drawing_request_link' using errcode='22023'; end if;
 select * into r from bob_private.project_drawing_requests where id=(p_payload#>>'{data,drawing_request,id}')::uuid for update;
 if not found then return bob_private.bob_project_write_before_project_lifecycle(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 if r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status='cancelled' then raise exception 'drawing_request_cancelled' using errcode='40001'; end if;
 if r.status='saved' then
  select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500 or msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
  input_hash:=encode(sha256(convert_to(((p_payload#-'{data,drawing_request}')-'request_quote')::text,'UTF8')),'hex');
  if r.saved_receipt is null or r.saved_input_hash is distinct from input_hash then raise exception 'drawing_request_complete' using errcode='40001'; end if;
  return r.saved_receipt;
 end if;
 if r.thread_id is distinct from p_thread or r.status='paused' then raise exception 'drawing_context_cleared' using errcode='40001'; end if;
 if r.revision is distinct from (p_payload#>>'{data,drawing_request,revision}')::integer then raise exception 'drawing_request_changed' using errcode='40001'; end if;
 result:=bob_private.bob_project_write_before_project_lifecycle(p_project,p_thread,p_turn,p_generation,p_payload);
 update bob_private.project_drawing_requests root set revision=packet.revision,status=packet.status,
  saved_receipt=packet.saved_receipt,saved_input_hash=packet.saved_input_hash,updated_at=clock_timestamp()
 from bob_private.drawing_requests packet where root.id=r.id and packet.id=root.id;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) to authenticated;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('read_drawing_requests','Read shared minimal drawing request status without private chat.','Use request_id=null and after_id=null to list; follow next_cursor for later pages. Read status/revision before cancellation. A paused context_cleared request retains identity but not private requirements; never invent the lost brief or silently replace it.',1,false,'{}',true),
 ('cancel_drawing_request','Cancel the initiating member''s drawing request and fence late saves.','Only on the owner''s instruction to stop that request. Read its exact id/revision first. The database checks current member and original initiator. Completed Artifacts are not deleted or relabelled cancelled.',1,false,'{}',true);
notify pgrst,'reload schema';
commit;
