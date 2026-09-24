-- Durable Bob turns. Private payloads and credentials are never exposed to clients.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
grant usage on schema bob_private to service_role;
create table bob_private.bob_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references bob.projects(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  turn_id uuid not null,
  status text not null default 'queued' check(status in ('queued','running','completed','failed')),
  credential jsonb,
  capability uuid not null default gen_random_uuid(),
  worker_url text not null,
  claim_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  generation bigint not null,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  dispatched_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique(project_id,actor_id,turn_id)
);
create index bob_jobs_active on bob_private.bob_jobs(status,lease_until) where status in ('queued','running');
create index bob_jobs_thread on bob_private.bob_jobs(thread_id);
create index bob_jobs_actor on bob_private.bob_jobs(actor_id);
create table bob_private.bob_job_steps (
  job_id uuid not null references bob_private.bob_jobs(id) on delete cascade,
  key text not null,
  fingerprint text not null,
  value jsonb not null,
  primary key(job_id,key)
);
alter table bob_private.bob_jobs enable row level security;
alter table bob_private.bob_job_steps enable row level security;
revoke all on bob_private.bob_jobs,bob_private.bob_job_steps from public,anon,authenticated;

create function bob_private.bob_enqueue_job(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; j bob_private.bob_jobs;
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || p_user::text,0));
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and turn_id=p_turn for update;
  if found then
    if not exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=p_turn and role='user' and text=p_message) then
      raise exception 'turn_reused' using errcode='22023';
    end if;
    if j.status in ('queued','running') then
      return jsonb_build_object('status','accepted','jobId',j.id,'expiresAt',j.expires_at);
    end if;
    -- An explicit retry uses the same turn and the ordinary write-recovery path.
    if j.status='failed' then delete from bob_private.bob_jobs where id=j.id; end if;
  end if;
  c:=bob.bob_claim_turn(p_project,p_user,p_turn,p_message);
  if c->>'mode'='local_only' or c->>'status'<>'claimed' then return c; end if;
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then raise exception 'background_not_configured'; end if;
  if p_expires<=clock_timestamp()+interval '30 seconds' or p_worker_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/bob-worker$'
    or jsonb_typeof(p_credential)<>'object' then raise exception 'invalid_job' using errcode='22023'; end if;
  insert into bob_private.bob_jobs(project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at)
    values(p_project,p_user,(c->>'thread_id')::uuid,p_turn,(c->>'generation')::bigint,p_credential,p_worker_url,
      least(p_expires,clock_timestamp()+interval '20 minutes')) returning * into j;
  return jsonb_build_object('status','accepted','jobId',j.id,'expiresAt',j.expires_at);
end $$;

create function bob_private.bob_finish_job(p_job uuid,p_claim uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; finished boolean;
begin
  select * into j from bob_private.bob_jobs where id=p_job;
  if not found then return jsonb_build_object('status','missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended(j.project_id || ':' || j.actor_id::text,0));
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if j.claim_token is distinct from p_claim or j.status not in ('queued','running') then
    raise exception 'job_not_claimed' using errcode='40001'; end if;
  finished:=exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed');
  if not finished then
    update bob.bob_messages set delivery_state='failed',updated_at=clock_timestamp()
      where thread_id=j.thread_id and turn_id=j.turn_id and role='user' and delivery_state='pending';
    update bob_private.bob_thread_provider_state set generation=generation+1,in_flight_turn_id=null,lock_started_at=null,updated_at=clock_timestamp()
      where thread_id=j.thread_id and in_flight_turn_id=j.turn_id;
  end if;
  update bob_private.bob_jobs set status=case when finished then 'completed' else 'failed' end,
    error_code=case when finished then null else coalesce(p_error,'background_failed') end,
    credential=null,claim_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
  delete from bob_private.bob_job_steps where job_id=j.id;
  return jsonb_build_object('status',case when finished then 'completed' else 'failed' end);
end $$;

create function bob_private.bob_claim_job(p_job uuid,p_capability uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; token uuid:=gen_random_uuid(); g bigint; steps jsonb; message text;
begin
  select * into j from bob_private.bob_jobs where id=p_job and capability=p_capability;
  if not found then raise exception 'job_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.project_id || ':' || j.actor_id::text,0));
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if j.status not in ('queued','running') or (j.status='running' and j.lease_until>clock_timestamp()) then
    return jsonb_build_object('status','inactive'); end if;
  if j.expires_at<=clock_timestamp() or j.attempts>=12 then
    return bob_private.bob_finish_job(j.id,j.claim_token,'background_expired'); end if;
  if exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed') then
    return bob_private.bob_finish_job(j.id,j.claim_token,null); end if;
  update bob_private.bob_thread_provider_state set generation=generation+1,lock_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where thread_id=j.thread_id and in_flight_turn_id=j.turn_id returning generation into g;
  if not found then return bob_private.bob_finish_job(j.id,j.claim_token,'turn_not_claimed'); end if;
  update bob_private.bob_jobs set status='running',claim_token=token,lease_until=clock_timestamp()+interval '150 seconds',
    generation=g,attempts=attempts+1,updated_at=clock_timestamp() where id=j.id returning * into j;
  select text into message from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='user';
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'fingerprint',fingerprint,'value',value) order by key),'[]'::jsonb)
    into steps from bob_private.bob_job_steps where job_id=j.id;
  return jsonb_build_object('status','claimed','id',j.id,'claimToken',token,'projectId',j.project_id,'userId',j.actor_id,
    'threadId',j.thread_id,'clientTurnId',j.turn_id,'generation',g,'credential',j.credential,'message',message,
    'expiresAt',j.expires_at,'entries',steps);
end $$;

create function bob_private.bob_save_job_step(p_job uuid,p_claim uuid,p_key text,p_fingerprint text,p_value jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; old bob_private.bob_job_steps;
begin
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if not found or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
    raise exception 'job_not_claimed' using errcode='40001'; end if;
  if length(p_key)>160 or length(p_fingerprint)<>64 or octet_length(p_value::text)>24000000
    or (select count(*) from bob_private.bob_job_steps where job_id=p_job)>=512
    or coalesce((select sum(octet_length(value::text)) from bob_private.bob_job_steps where job_id=p_job),0)+octet_length(p_value::text)>64000000 then raise exception 'journal_limit'; end if;
  select * into old from bob_private.bob_job_steps where job_id=p_job and key=p_key;
  if found then
    if old.fingerprint<>p_fingerprint or old.value is distinct from p_value then raise exception 'checkpoint_conflict'; end if;
    return true;
  end if;
  insert into bob_private.bob_job_steps values(p_job,p_key,p_fingerprint,p_value);
  return true;
end $$;
create function bob_private.bob_yield_job(p_job uuid,p_claim uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update bob_private.bob_jobs set status='queued',lease_until=null,claim_token=null,dispatched_at=null,updated_at=clock_timestamp()
    where id=p_job and status='running' and claim_token=p_claim;
  if not found then raise exception 'job_not_claimed' using errcode='40001'; end if;
  return true;
end $$;

-- The browser receives status only, after the same caller/project checks as chat.
create function bob_private.bob_job_status(p_project text,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
  if not found then return null; end if;
  return jsonb_build_object('status',case when j.status in ('queued','running') and j.expires_at<=clock_timestamp() then 'failed' else j.status end,
    'expiresAt',j.expires_at,'error',j.error_code);
end $$;

-- Private service commands with explicit exposed invoker wrappers.
create function bob.bob_enqueue_job(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_enqueue_job(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url) $$;
create function bob.bob_claim_job(p_job uuid,p_capability uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_claim_job(p_job,p_capability) $$;
create function bob.bob_save_job_step(p_job uuid,p_claim uuid,p_key text,p_fingerprint text,p_value jsonb) returns boolean language sql security invoker set search_path='' as $$ select bob_private.bob_save_job_step(p_job,p_claim,p_key,p_fingerprint,p_value) $$;
create function bob.bob_yield_job(p_job uuid,p_claim uuid) returns boolean language sql security invoker set search_path='' as $$ select bob_private.bob_yield_job(p_job,p_claim) $$;
create function bob.bob_finish_job(p_job uuid,p_claim uuid,p_error text default null) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_finish_job(p_job,p_claim,p_error) $$;
create function bob.bob_job_status(p_project text,p_turn uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_job_status(p_project,p_turn) $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bob','bob_private') and p.proname in ('bob_enqueue_job','bob_claim_job','bob_save_job_step','bob_yield_job','bob_finish_job','bob_job_status') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to %I',f.signature,case when f.proname='bob_job_status' then 'authenticated' else 'service_role' end);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
