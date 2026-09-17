-- Ask Bob conversation continuity: private per-user/project transcript plus
-- server-private provider cursor. Project truth still uses caller-JWT reads.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.bob_threads (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references bob.projects(id) on delete cascade,
  owner_user_id uuid not null,
  status text not null default 'active' check(status in ('active','archived')),
  next_seq bigint not null default 1 check(next_seq > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index bob_threads_one_active_idx
  on bob.bob_threads(project_id,owner_user_id) where status='active';
create index bob_threads_owner_idx on bob.bob_threads(owner_user_id,project_id);

create table bob.bob_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  seq bigint not null check(seq > 0),
  turn_id uuid not null,
  role text not null check(role in ('user','assistant')),
  text text not null check(char_length(text) between 1 and 100000),
  evidence jsonb,
  delivery_state text not null default 'completed' check(delivery_state in ('pending','completed','failed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(thread_id,seq),
  unique(thread_id,turn_id,role),
  check(evidence is null or jsonb_typeof(evidence)='object'),
  check((role='assistant' and delivery_state='completed') or role='user')
);
create index bob_messages_thread_created_idx on bob.bob_messages(thread_id,created_at);

-- Provider identifiers are never browser-readable. They live behind service-role
-- command functions and are not exposed as Bob API tables.
create table bob_private.bob_thread_provider_state (
  thread_id uuid primary key references bob.bob_threads(id) on delete cascade,
  previous_response_id text,
  generation bigint not null default 0 check(generation >= 0),
  in_flight_turn_id uuid,
  lock_started_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check(previous_response_id is null or char_length(previous_response_id) between 1 and 300),
  check((in_flight_turn_id is null) = (lock_started_at is null))
);
revoke all on bob_private.bob_thread_provider_state from public,anon,authenticated;

alter table bob.bob_threads enable row level security;
alter table bob.bob_messages enable row level security;
revoke all on bob.bob_threads,bob.bob_messages from public,anon,authenticated;
grant select on bob.bob_threads,bob.bob_messages to authenticated;

create policy own_project_thread on bob.bob_threads for select to authenticated
  using(owner_user_id=(select auth.uid()) and bob_private.has_project_access(project_id));
create policy own_project_messages on bob.bob_messages for select to authenticated
  using(exists(
    select 1 from bob.bob_threads t
    where t.id=thread_id
      and t.owner_user_id=(select auth.uid())
      and bob_private.has_project_access(t.project_id)
  ));

create function bob_private.bob_assert_server_actor(p_project text,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_project is null or p_user is null or not exists(
    select 1 from bob.people p where p.project_id=p_project and p.auth_user_id=p_user
  ) then
    raise exception 'project_denied' using errcode='42501';
  end if;
end $$;
revoke all on function bob_private.bob_assert_server_actor(text,uuid) from public,anon,authenticated;

-- Claim exactly one turn. A shared guest Auth identity is deliberately local-only:
-- persisting a private transcript under that identity would leak it across users.
create function bob.bob_claim_turn(
  p_project text,
  p_user uuid,
  p_turn uuid,
  p_message text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  thread bob.bob_threads;
  provider bob_private.bob_thread_provider_state;
  user_message bob.bob_messages;
  assistant_message bob.bob_messages;
  seq bigint;
  guest_email text;
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  if p_turn is null or p_message is null or char_length(btrim(p_message)) not between 1 and 4096 then
    raise exception 'invalid_turn';
  end if;

  select lower(email) into guest_email from auth.users where id=p_user;
  if guest_email='guest@bob.local' then
    return jsonb_build_object('mode','local_only','status','claimed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || p_user::text,0));
  select * into thread from bob.bob_threads
    where project_id=p_project and owner_user_id=p_user and status='active'
    for update;
  if not found then
    insert into bob.bob_threads(project_id,owner_user_id)
      values(p_project,p_user) returning * into thread;
  end if;

  insert into bob_private.bob_thread_provider_state(thread_id)
    values(thread.id) on conflict(thread_id) do nothing;
  select * into provider from bob_private.bob_thread_provider_state
    where thread_id=thread.id for update;

  -- A dead isolate must not lock a conversation forever. Five minutes is above
  -- the current worst-case three x 60s provider/tool loop.
  if provider.in_flight_turn_id is not null
    and provider.lock_started_at < clock_timestamp()-interval '5 minutes' then
    update bob.bob_messages set delivery_state='failed',updated_at=clock_timestamp()
      where thread_id=thread.id and turn_id=provider.in_flight_turn_id
        and role='user' and delivery_state='pending';
    update bob_private.bob_thread_provider_state
      set in_flight_turn_id=null,lock_started_at=null,updated_at=clock_timestamp()
      where thread_id=thread.id;
    provider.in_flight_turn_id := null;
    provider.lock_started_at := null;
  end if;

  select * into user_message from bob.bob_messages
    where thread_id=thread.id and turn_id=p_turn and role='user';
  if found then
    if user_message.text is distinct from btrim(p_message) then
      raise exception 'turn_id_reused';
    end if;
    if user_message.delivery_state='completed' then
      select * into assistant_message from bob.bob_messages
        where thread_id=thread.id and turn_id=p_turn and role='assistant';
      if not found then raise exception 'turn_incomplete'; end if;
      return jsonb_build_object(
        'mode','server','status','completed','thread_id',thread.id,
        'answer',assistant_message.text,'evidence',assistant_message.evidence
      );
    end if;
    if provider.in_flight_turn_id=p_turn then
      return jsonb_build_object('mode','server','status','in_flight','thread_id',thread.id);
    end if;
  end if;

  if provider.in_flight_turn_id is not null and provider.in_flight_turn_id<>p_turn then
    return jsonb_build_object('mode','server','status','thread_busy','thread_id',thread.id);
  end if;

  if not found then
    seq := thread.next_seq;
    update bob.bob_threads set next_seq=next_seq+1,updated_at=clock_timestamp()
      where id=thread.id;
    insert into bob.bob_messages(thread_id,seq,turn_id,role,text,delivery_state)
      values(thread.id,seq,p_turn,'user',btrim(p_message),'pending');
  else
    update bob.bob_messages set delivery_state='pending',updated_at=clock_timestamp()
      where id=user_message.id;
  end if;

  update bob_private.bob_thread_provider_state
    set in_flight_turn_id=p_turn,lock_started_at=clock_timestamp(),
        generation=generation+1,updated_at=clock_timestamp()
    where thread_id=thread.id
    returning * into provider;

  return jsonb_build_object(
    'mode','server','status','claimed','thread_id',thread.id,
    'previous_response_id',provider.previous_response_id,
    'generation',provider.generation
  );
end $$;
revoke all on function bob.bob_claim_turn(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob.bob_claim_turn(text,uuid,uuid,text) to service_role;

create function bob.bob_commit_turn(
  p_project text,
  p_user uuid,
  p_thread uuid,
  p_turn uuid,
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
    or p_provider_response_id is null or char_length(p_provider_response_id) not between 1 and 300 then
    raise exception 'invalid_turn_commit';
  end if;

  select * into thread from bob.bob_threads
    where id=p_thread and project_id=p_project and owner_user_id=p_user and status='active'
    for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;

  select * into provider from bob_private.bob_thread_provider_state
    where thread_id=thread.id for update;
  if not found or provider.in_flight_turn_id is distinct from p_turn then
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
revoke all on function bob.bob_commit_turn(text,uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_commit_turn(text,uuid,uuid,uuid,text,jsonb,text) to service_role;

create function bob.bob_fail_turn(
  p_project text,
  p_user uuid,
  p_thread uuid,
  p_turn uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  if p_thread is null or p_turn is null then raise exception 'invalid_turn_failure'; end if;
  if not exists(select 1 from bob.bob_threads where id=p_thread and project_id=p_project and owner_user_id=p_user and status='active') then
    raise exception 'project_denied' using errcode='42501';
  end if;

  update bob.bob_messages set delivery_state='failed',updated_at=clock_timestamp()
    where thread_id=p_thread and turn_id=p_turn and role='user' and delivery_state='pending';
  update bob_private.bob_thread_provider_state
    set in_flight_turn_id=null,lock_started_at=null,updated_at=clock_timestamp()
    where thread_id=p_thread and in_flight_turn_id=p_turn;
  return jsonb_build_object('status','failed','thread_id',p_thread);
end $$;
revoke all on function bob.bob_fail_turn(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function bob.bob_fail_turn(text,uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;