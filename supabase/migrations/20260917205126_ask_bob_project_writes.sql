-- Bob's first project-write tools. No cross-app changes and no raw model SQL.
-- Domain state and this ledger commit together; resetting chat never undoes a build edit.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob_private.bob_write_receipts (
  project_id text not null references bob.projects(id) on delete cascade,
  actor_id uuid not null,
  turn_id uuid not null,
  operation_key text not null,
  payload jsonb not null,
  before_record jsonb,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,actor_id,turn_id,operation_key)
);
alter table bob_private.bob_write_receipts enable row level security;
revoke all on bob_private.bob_write_receipts from public,anon,authenticated;

-- Same lock order as claim/reset: actor advisory lock, thread, provider state.
-- Generation fences late workers, including a retry of the SAME turn UUID.
create function bob_private.bob_assert_write_claim(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns void language plpgsql security definer set search_path='' as $$
declare t bob.bob_threads; s bob_private.bob_thread_provider_state;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || auth.uid()::text,0));
  select * into t from bob.bob_threads where id=p_thread and project_id=p_project
    and owner_user_id=auth.uid() and status='active' for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  select * into s from bob_private.bob_thread_provider_state where thread_id=t.id for update;
  if not found or s.in_flight_turn_id is distinct from p_turn
    or s.generation is distinct from p_generation
    or s.lock_started_at < clock_timestamp()-interval '5 minutes'
    or not exists(select 1 from bob.bob_messages where thread_id=t.id and turn_id=p_turn
      and role='user' and delivery_state='pending') then
    raise exception 'turn_not_claimed' using errcode='40001';
  end if;
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
end $$;
revoke all on function bob_private.bob_assert_write_claim(text,uuid,uuid,bigint) from public,anon,authenticated;

-- Recovery runs BEFORE another model call on a retried turn. A turn with durable
-- writes is reported, never regenerated (even if the previous answer was lost).
create function bob_private.bob_read_write_receipts(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  select coalesce(jsonb_agg(receipt order by created_at,operation_key),'[]'::jsonb) into result
    from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
  return result;
end $$;
create function bob.bob_read_write_receipts(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_read_write_receipts(p_project,p_thread,p_turn,p_generation);
$$;
revoke all on function bob_private.bob_read_write_receipts(text,uuid,uuid,bigint),bob.bob_read_write_receipts(text,uuid,uuid,bigint) from public,anon;
grant execute on function bob_private.bob_read_write_receipts(text,uuid,uuid,bigint),bob.bob_read_write_receipts(text,uuid,uuid,bigint) to authenticated;

-- Atomically close a generation before reconciling uncertain HTTP outcomes.
-- A delayed old worker must pass the same lock and is rejected after settlement.
create function bob_private.bob_settle_project_writes(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare next_generation bigint; result jsonb;
begin
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  update bob_private.bob_thread_provider_state set generation=generation+1 where thread_id=p_thread returning generation into next_generation;
  select coalesce(jsonb_agg(receipt order by created_at,operation_key),'[]'::jsonb) into result
    from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
  return jsonb_build_object('generation',next_generation,'receipts',result);
end $$;
create function bob.bob_settle_project_writes(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_settle_project_writes(p_project,p_thread,p_turn,p_generation);
$$;
revoke all on function bob_private.bob_settle_project_writes(text,uuid,uuid,bigint),bob.bob_settle_project_writes(text,uuid,uuid,bigint) from public,anon;
grant execute on function bob_private.bob_settle_project_writes(text,uuid,uuid,bigint),bob.bob_settle_project_writes(text,uuid,uuid,bigint) to authenticated;

-- One fixed command, three allowlisted record types. No delete, status, role,
-- assignment, readiness, payment, sharing or Building authority is exposed.
create function bob_private.bob_project_write(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  kind text := p_payload->>'kind'; rid text := p_payload->>'record_id';
  d jsonb := p_payload->'data'; before_row jsonb; after_row jsonb; result jsonb;
  op_key text; existing bob_private.bob_write_receipts; expected_time timestamptz;
  expected_revision int; fact_id uuid; message text; quote text := p_payload->>'request_quote';
  allowed text[]; project_row bob.projects; task_row bob.tasks;
begin
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>24000
    or kind is null or kind<>all(array['project','task','measurement'])
    or d is null or jsonb_typeof(d)<>'object'
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or jsonb_typeof(p_payload->'request_quote') is distinct from 'string'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['kind','record_id','expected_updated_at','expected_revision','data','request_quote']))
    or coalesce(char_length(quote),0) not between 1 and 500
    or (p_payload->'record_id'<>'null'::jsonb and jsonb_typeof(p_payload->'record_id')<>'string') then
    raise exception 'invalid_write' using errcode='22023';
  end if;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
  if kind='project' then allowed:=array['description'];
  elsif kind='task' then allowed:=array['area_id','name','instructions'];
  else allowed:=array['area_id','component_id','subject','value','unit','truth','source','notes','required','change_note']; end if;
  if exists(select 1 from jsonb_object_keys(d) k where k<>all(allowed)) then
    raise exception 'unsupported_write_fields' using errcode='22023';
  end if;
  -- Stable semantic create key: reworded attempts cannot create two copies of
  -- the same named task/measurement in one turn. Changed payloads conflict.
  op_key:=kind || ':' || coalesce(rid,concat_ws(':','new',d->>'area_id',d->>'component_id',lower(btrim(coalesce(d->>'name',d->>'subject')))));
  select * into existing from bob_private.bob_write_receipts
    where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op_key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023';
  end if;
  if kind='project' then
    if rid is distinct from p_project or jsonb_typeof(d->'description') is distinct from 'string'
      or char_length(d->>'description')>12000 then raise exception 'invalid_write' using errcode='22023'; end if;
    select * into project_row from bob.projects where id=p_project for update;
    expected_time:=(p_payload->>'expected_updated_at')::timestamptz;
    if expected_time is null or expected_time is distinct from project_row.updated_at then raise exception 'record_changed' using errcode='40001'; end if;
    before_row:=jsonb_build_object('id',project_row.id,'name',project_row.name,'description',project_row.description,'updated_at',project_row.updated_at);
    update bob.projects set description=d->>'description' where id=p_project;
    select jsonb_build_object('id',id,'name',name,'description',description,'updated_at',updated_at) into after_row from bob.projects where id=p_project;
  elsif kind='task' then
    if jsonb_typeof(d->'name') is distinct from 'string' or char_length(btrim(d->>'name')) not between 1 and 300
      or jsonb_typeof(d->'instructions') is distinct from 'string' or char_length(d->>'instructions')>12000 then
      raise exception 'invalid_write' using errcode='22023'; end if;
    if rid is null then
      if p_payload->>'expected_updated_at' is not null then raise exception 'invalid_write' using errcode='22023'; end if;
      if not exists(select 1 from bob.areas where id=d->>'area_id' and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
      rid:='t_' || replace(gen_random_uuid()::text,'-','');
      insert into bob.tasks(id,area_id,name,instructions,status) values(rid,d->>'area_id',btrim(d->>'name'),d->>'instructions','todo');
    else
      select t.* into task_row from bob.tasks t join bob.areas a on a.id=t.area_id
        where t.id=rid and a.project_id=p_project for update of t;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if d->>'area_id' is distinct from task_row.area_id then raise exception 'project_denied' using errcode='42501'; end if;
      expected_time:=(p_payload->>'expected_updated_at')::timestamptz;
      if expected_time is null or expected_time is distinct from task_row.updated_at then raise exception 'record_changed' using errcode='40001'; end if;
      before_row:=jsonb_build_object('id',task_row.id,'name',task_row.name,'instructions',task_row.instructions,'updated_at',task_row.updated_at);
      update bob.tasks set name=btrim(d->>'name'),instructions=d->>'instructions' where id=rid;
    end if;
    select jsonb_build_object('id',id,'area_id',area_id,'name',name,'instructions',instructions,'status',status,'updated_at',updated_at)
      into after_row from bob.tasks where id=rid;
  else
    expected_revision:=(p_payload->>'expected_revision')::int;
    if rid is null then
      if expected_revision is distinct from 0 then raise exception 'invalid_write' using errcode='22023'; end if;
      fact_id:=gen_random_uuid();
    else
      fact_id:=rid::uuid;
      select jsonb_build_object('id',id,'subject',subject,'value',value,'unit',unit,'truth',truth,'source',source,'revision',revision,'source_media_id',source_media_id) into before_row
        from bob.current_measurements where id=fact_id and project_id=p_project;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if d ? 'area_id' or d ? 'component_id' then raise exception 'unsupported_write_fields' using errcode='22023'; end if;
      -- Revising a measurement must not silently discard an attached source image.
      d:=d || jsonb_build_object('source_media_id',before_row->'source_media_id');
    end if;
    perform bob.evidence_command(p_project,'measurement',case when rid is null then 'create' else 'revise' end,fact_id,expected_revision,d);
    rid:=fact_id::text;
    select jsonb_build_object('id',id,'subject',subject,'area_id',area_id,'component_id',component_id,'value',value,'unit',unit,'truth',truth,
      'source',source,'notes',notes,'required',required,'revision',revision,'archived',archived,'updated_at',recorded_at)
      into after_row from bob.current_measurements where id=fact_id and project_id=p_project;
  end if;
  if after_row is null then raise exception 'write_readback_failed'; end if;
  result:=jsonb_build_object('projectId',p_project,'dataset',case kind when 'task' then 'tasks' when 'measurement' then 'measurements' else 'project' end,
    'recordId',rid,'label',coalesce(after_row->>'name',after_row->>'subject',rid),
    'operation',case when before_row is null then 'created' else 'updated' end,
    'savedAt',clock_timestamp(),'record',after_row);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,op_key,p_payload,before_row,result);
  return result;
end $$;
create function bob.bob_project_write(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write(p_project,p_thread,p_turn,p_generation,p_payload);
$$;
revoke all on function bob_private.bob_project_write(text,uuid,uuid,bigint,jsonb),bob.bob_project_write(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write(text,uuid,uuid,bigint,jsonb),bob.bob_project_write(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Caller-RLS read extension. Keep original public lookup backwards compatible.
create function bob.search_bob_project_data(p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,p_record_id text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rows jsonb; truncated boolean;
begin
  if not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_dataset='measurements' then
    if p_status is not null or length(coalesce(p_query,''))>200 or length(coalesce(p_record_id,''))>200 or length(coalesce(p_area_id,''))>200 then
      raise exception 'invalid_lookup' using errcode='22023'; end if;
    select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into rows from (
      select id,jsonb_build_object('id',id,'subject',subject,'area_id',area_id,'component_id',component_id,'value',value,'unit',unit,'truth',truth,
        'source',source,'notes',notes,'required',required,'revision',revision,'archived',archived,'updated_at',recorded_at) item
      from bob.current_measurements where project_id=p_project_id and not archived
        and (p_record_id is null or id::text=p_record_id) and (p_area_id is null or area_id=p_area_id)
        and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',subject,notes,source)))>0)
      order by id limit 26
    ) bounded;
    truncated:=jsonb_array_length(rows)>25;
    if truncated then rows:=rows-25; end if;
    result:=jsonb_build_object('records',rows,'related','[]'::jsonb,'truncated',truncated);
  else
    result:=bob.search_project_data(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id);
    if p_dataset='tasks' then
      select coalesce(jsonb_agg(r.value || jsonb_build_object('instructions',t.instructions) order by r.ordinality),'[]'::jsonb) into rows
        from jsonb_array_elements(result->'records') with ordinality r(value,ordinality)
        join bob.tasks t on t.id=r.value->>'id' join bob.areas a on a.id=t.area_id and a.project_id=p_project_id;
      result:=jsonb_set(result,'{records}',rows);
    end if;
  end if;
  while octet_length(result::text)>14000 loop
    result:=jsonb_set(result,'{truncated}','true');
    if jsonb_array_length(result->'related')>0 then result:=jsonb_set(result,'{related}',(result->'related')-(jsonb_array_length(result->'related')-1));
    else result:=jsonb_set(result,'{records}',(result->'records')-(jsonb_array_length(result->'records')-1)); end if;
  end loop;
  return result;
end $$;
revoke all on function bob.search_bob_project_data(text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data(text,text,text,text,text,text) to authenticated;

-- Nullable provider state is used only for a receipt-only recovery answer. The
-- durable transcript remains; the next turn starts a fresh provider chain.
create function bob.bob_commit_turn_v2(
  p_project text,
  p_user uuid,
  p_thread uuid,
  p_turn uuid,
  p_generation bigint,
  p_answer text,
  p_evidence jsonb,
  p_provider_response_id text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  thread bob.bob_threads;
  provider bob_private.bob_thread_provider_state;
  seq bigint;
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  if p_thread is null or p_turn is null or p_answer is null
    or char_length(btrim(p_answer)) not between 1 and 100000
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or (p_provider_response_id is not null and char_length(p_provider_response_id) not between 1 and 300) then
    raise exception 'invalid_turn_commit';
  end if;

  select * into thread from bob.bob_threads
    where id=p_thread and project_id=p_project and owner_user_id=p_user and status='active'
    for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;

  select * into provider from bob_private.bob_thread_provider_state
    where thread_id=thread.id for update;
  if not found or provider.in_flight_turn_id is distinct from p_turn or provider.generation is distinct from p_generation then
    raise exception 'turn_not_claimed';
  end if;
  if not exists(select 1 from bob.bob_messages where thread_id=thread.id and turn_id=p_turn and role='user' and delivery_state='pending') then
    raise exception 'turn_not_pending';
  end if;

  seq := thread.next_seq;
  update bob.bob_threads set next_seq=next_seq+1,updated_at=clock_timestamp()
    where id=thread.id;
  insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence,delivery_state)
    values(thread.id,seq,p_turn,'assistant',btrim(p_answer),p_evidence,'completed');
  update bob.bob_messages set delivery_state='completed',updated_at=clock_timestamp()
    where thread_id=thread.id and turn_id=p_turn and role='user';
  update bob_private.bob_thread_provider_state
    set previous_response_id=p_provider_response_id,in_flight_turn_id=null,
        lock_started_at=null,updated_at=clock_timestamp()
    where thread_id=thread.id;

  return jsonb_build_object('status','completed','thread_id',thread.id);
end $$;
revoke all on function bob.bob_commit_turn_v2(text,uuid,uuid,uuid,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_commit_turn_v2(text,uuid,uuid,uuid,bigint,text,jsonb,text) to service_role;


create function bob.bob_fail_turn_v2(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s bob_private.bob_thread_provider_state;
begin
  perform 1 from bob.bob_threads where id=p_thread and project_id=p_project and owner_user_id=p_user for update;
  if not found then return jsonb_build_object('stale',true); end if;
  select * into s from bob_private.bob_thread_provider_state where thread_id=p_thread for update;
  if not found or s.in_flight_turn_id is distinct from p_turn or s.generation is distinct from p_generation then
    return jsonb_build_object('stale',true);
  end if;
  return bob.bob_fail_turn(p_project,p_user,p_thread,p_turn);
end $$;
revoke all on function bob.bob_fail_turn_v2(text,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function bob.bob_fail_turn_v2(text,uuid,uuid,uuid,bigint) to service_role;
commit;
notify pgrst,'reload schema';
