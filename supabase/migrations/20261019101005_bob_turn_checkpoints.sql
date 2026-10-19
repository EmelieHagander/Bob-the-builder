-- Durable main-turn cursors. The installed CLI aborted in its Bun runtime for
-- both --help and migration new; this filename is the observed UTC fallback.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.bob_jobs
 add column checkpoint_version smallint not null default 0 check(checkpoint_version in (0,1)),
 add column checkpoint_progress bigint not null default 0 check(checkpoint_progress>=0),
 add column last_claim_checkpoint_progress bigint not null default 0 check(last_claim_checkpoint_progress>=0),
 add constraint bob_jobs_checkpoint_main_only check(checkpoint_version=0 or (drawing_request_id is null and work_allowance_version=1 and ai_catalog_manifest_id is not null));

create table bob_private.bob_turn_checkpoints (
 job_id uuid primary key references bob_private.bob_jobs(id) on delete cascade,
 revision bigint not null check(revision>0),
 state jsonb not null check(jsonb_typeof(state)='object'),
 journal_state jsonb not null check(jsonb_typeof(journal_state)='object'),
 updated_at timestamptz not null default clock_timestamp()
);
alter table bob_private.bob_turn_checkpoints enable row level security;
revoke all on bob_private.bob_turn_checkpoints from public,anon,authenticated,service_role;
alter table bob_private.bob_job_steps
 add column checkpoint_epoch bigint not null default 0,
 add column checkpoint_bootstrap boolean not null default false;
create index bob_job_steps_checkpoint_tail_idx on bob_private.bob_job_steps(job_id,checkpoint_epoch,key) where not checkpoint_bootstrap;
create index bob_job_steps_checkpoint_bootstrap_idx on bob_private.bob_job_steps(job_id,key) where checkpoint_bootstrap;

-- The existing operation journal remains immutable. Its epochs only select
-- which operation results can be needed after the committed main-turn cursor.
create function bob_private.bob_track_checkpoint_operation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from bob_private.bob_jobs where id=new.job_id and checkpoint_version=1) then
  new.checkpoint_epoch:=coalesce((select revision from bob_private.bob_turn_checkpoints where job_id=new.job_id),0);
  update bob_private.bob_jobs set checkpoint_progress=checkpoint_progress+1 where id=new.job_id;
 end if;
 return new;
end $$;
revoke all on function bob_private.bob_track_checkpoint_operation() from public,anon,authenticated,service_role;
create trigger bob_track_checkpoint_operation before insert on bob_private.bob_job_steps for each row execute function bob_private.bob_track_checkpoint_operation();

-- Retain the existing terminal privacy policy: no working context survives
-- completion, failure or cancellation, even though the job status is retained.
create function bob_private.bob_clear_turn_checkpoint() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('completed','failed','cancelled') then delete from bob_private.bob_turn_checkpoints where job_id=new.id; end if;
 return new;
end $$;
revoke all on function bob_private.bob_clear_turn_checkpoint() from public,anon,authenticated,service_role;
create trigger bob_clear_turn_checkpoint after update of status on bob_private.bob_jobs for each row execute function bob_private.bob_clear_turn_checkpoint();

create function bob_private.bob_enqueue_checkpoint_job(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text,p_screen jsonb,p_images uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_id uuid; result jsonb; j bob_private.bob_jobs;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 select id into previous_id from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and turn_id=p_turn and drawing_request_id is null;
 -- Preserve every existing image/screen/turn/credential check in its original
 -- order. The actor lock keeps pinning and fresh enqueue in one transaction.
 result:=bob.bob_enqueue_job_v3(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url,p_screen,p_images);
 if result->>'status'='accepted' then
  select * into j from bob_private.bob_jobs where id=(result->>'jobId')::uuid for update;
  if j.id is distinct from previous_id and j.drawing_request_id is null and j.work_allowance_version=1 then
   update bob_private.bob_jobs set checkpoint_version=1 where id=j.id;
  end if;
 end if;
 return result;
end $$;
create function bob.bob_enqueue_job_v4(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text,p_screen jsonb,p_images uuid[])
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.bob_enqueue_checkpoint_job(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url,p_screen,p_images)
$$;
revoke all on function bob_private.bob_enqueue_checkpoint_job(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]),bob.bob_enqueue_job_v4(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function bob_private.bob_enqueue_checkpoint_job(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]),bob.bob_enqueue_job_v4(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]) to service_role;

create function bob_private.bob_checkpoint_packet(p_job uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',1,'revision',c.revision,'jobId',j.id,'turnId',j.turn_id,'catalogManifestId',j.ai_catalog_manifest_id,'state',c.state,'journalState',c.journal_state)
 from bob_private.bob_turn_checkpoints c join bob_private.bob_jobs j on j.id=c.job_id where c.job_id=p_job
$$;
revoke all on function bob_private.bob_checkpoint_packet(uuid) from public,anon,authenticated,service_role;

create function bob_private.bob_save_turn_checkpoint(p_job uuid,p_claim uuid,p_expected_revision bigint,p_state jsonb,p_journal_state jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; head bob_private.bob_turn_checkpoints; cursor record;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found then raise exception 'job_not_claimed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if j.checkpoint_version<>1 or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp()
   or not exists(select 1 from bob_private.bob_thread_provider_state where thread_id=j.thread_id and in_flight_turn_id=j.turn_id and generation=j.generation)
 then raise exception 'job_not_claimed' using errcode='40001'; end if;
 if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_state) is distinct from 'object'
   or octet_length(p_state::text)>24000000 or jsonb_typeof(p_journal_state) is distinct from 'object'
   or p_journal_state->'version' is distinct from '1'::jsonb or jsonb_typeof(p_journal_state->'positions') is distinct from 'object'
   or jsonb_typeof(p_journal_state->'reusedModelCalls') is distinct from 'number' or jsonb_typeof(p_journal_state->'uncertainResends') is distinct from 'number'
   or coalesce(p_journal_state->>'reusedModelCalls','') !~ '^[0-9]+$' or coalesce(p_journal_state->>'uncertainResends','') !~ '^[0-9]+$'
   or octet_length(p_journal_state::text)>100000 then raise exception 'invalid_turn_checkpoint'; end if;
 if (p_journal_state->>'reusedModelCalls')::numeric>9007199254740991 or (p_journal_state->>'uncertainResends')::numeric>9007199254740991 then raise exception 'invalid_journal_state'; end if;
 for cursor in select key,value from jsonb_each(p_journal_state->'positions') loop
  if cursor.key='' or length(cursor.key)>150 or jsonb_typeof(cursor.value) is distinct from 'number' or cursor.value::text !~ '^[0-9]+$'
    or cursor.value::numeric>9007199254740991 then raise exception 'invalid_journal_state'; end if;
 end loop;
 select * into head from bob_private.bob_turn_checkpoints where job_id=p_job;
 -- Retrying a lost commit response under the same claim is idempotent.
 if head.revision=p_expected_revision+1 and head.state=p_state and head.journal_state=p_journal_state then return bob_private.bob_checkpoint_packet(p_job); end if;
 if coalesce(head.revision,0)<>p_expected_revision then raise exception 'checkpoint_conflict' using errcode='40001'; end if;
 if head.state=p_state and head.journal_state=p_journal_state then return bob_private.bob_checkpoint_packet(p_job); end if;
 -- A committed cursor cannot move backward or forget an established stream.
 if head.job_id is not null and exists(select 1 from jsonb_each_text(head.journal_state->'positions') old
   where coalesce((p_journal_state->'positions'->>old.key)::numeric,-1)<old.value::numeric) then raise exception 'checkpoint_cursor_regression'; end if;
 if head.job_id is not null and ((p_journal_state->>'reusedModelCalls')::numeric<(head.journal_state->>'reusedModelCalls')::numeric
   or (p_journal_state->>'uncertainResends')::numeric<(head.journal_state->>'uncertainResends')::numeric) then raise exception 'checkpoint_cursor_regression'; end if;
 if head.job_id is null then update bob_private.bob_job_steps set checkpoint_bootstrap=true where job_id=p_job; end if;
 -- A checkpoint may precede an interrupted operation. Preserve every tail
 -- entry at/after its saved stream cursor; merely changing the main state
 -- must not lose an accepted provider call or a committed write receipt.
 with active as (
  select key,regexp_match(regexp_replace(key,':(waiting|started|retry:[0-9]+)$',''),'^(.*):([0-9]+)$') parts
  from bob_private.bob_job_steps where job_id=p_job and not checkpoint_bootstrap and checkpoint_epoch>=coalesce(head.revision,0)
 )
 update bob_private.bob_job_steps s set checkpoint_epoch=p_expected_revision+1 from active a
 where s.job_id=p_job and s.key=a.key and (a.parts is null or
  coalesce((p_journal_state->'positions'->>a.parts[1])::numeric,0)<=a.parts[2]::numeric);
 insert into bob_private.bob_turn_checkpoints(job_id,revision,state,journal_state)
 values(p_job,p_expected_revision+1,p_state,p_journal_state)
 on conflict(job_id) do update set revision=excluded.revision,state=excluded.state,journal_state=excluded.journal_state,updated_at=clock_timestamp();
 -- Operation inserts drive progress after startup. Metadata-only snapshots
 -- cannot keep a repeatedly crashing operation alive indefinitely.
 if head.job_id is null then update bob_private.bob_jobs set checkpoint_progress=checkpoint_progress+1 where id=p_job; end if;
 return bob_private.bob_checkpoint_packet(p_job);
end $$;
create function bob.bob_save_turn_checkpoint(p_job uuid,p_claim uuid,p_expected_revision bigint,p_state jsonb,p_journal_state jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_save_turn_checkpoint(p_job,p_claim,p_expected_revision,p_state,p_journal_state) $$;
revoke all on function bob_private.bob_save_turn_checkpoint(uuid,uuid,bigint,jsonb,jsonb),bob.bob_save_turn_checkpoint(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function bob_private.bob_save_turn_checkpoint(uuid,uuid,bigint,jsonb,jsonb),bob.bob_save_turn_checkpoint(uuid,uuid,bigint,jsonb,jsonb) to service_role;

-- A rolled-back worker cannot accidentally replay a checkpoint-native job.
-- Legacy and CAD claims preserve their prior screen adapter unchanged.
create or replace function bob_private.bob_claim_job(p_job uuid,p_capability uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from bob_private.bob_jobs where id=p_job and capability=p_capability and checkpoint_version=1) then
  raise exception 'checkpoint_worker_required' using errcode='40001';
 end if;
 result:=bob_private.bob_claim_job_before_screen(p_job,p_capability);
 if result->>'status'='claimed' then
  insert into bob_private.bob_turn_screens values((result->>'threadId')::uuid,(result->>'clientTurnId')::uuid,null) on conflict do nothing;
  result:=result||jsonb_build_object('screen',(select screen from bob_private.bob_turn_screens where thread_id=(result->>'threadId')::uuid and turn_id=(result->>'clientTurnId')::uuid));
 end if;
 return result;
end $$;

-- Bound transport without reloading historical epochs. One oversized operation
-- is still readable by itself, matching the existing 24 MB journal-entry cap.
create function bob.bob_checkpoint_steps_page(p_job uuid,p_claim uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb:='[]'::jsonb; entry record; bytes bigint:=0; cursor_key text; epoch bigint;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.checkpoint_version<>1 or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
  raise exception 'job_not_claimed' using errcode='40001'; end if;
 select revision into epoch from bob_private.bob_turn_checkpoints where job_id=p_job;
 for entry in select * from (
  select key,fingerprint,value,value_bytes from bob_private.bob_job_steps where job_id=p_job and checkpoint_bootstrap and (p_after is null or key>p_after)
  union all
  select key,fingerprint,value,value_bytes from bob_private.bob_job_steps where job_id=p_job and not checkpoint_bootstrap and checkpoint_epoch>=coalesce(epoch,0) and (p_after is null or key>p_after)
 ) active order by key limit 100 loop
  if bytes>0 and bytes+entry.value_bytes>2000000 then exit; end if;
  result:=result||jsonb_build_array(jsonb_build_object('key',entry.key,'fingerprint',entry.fingerprint,'value',entry.value));
  bytes:=bytes+entry.value_bytes;cursor_key:=entry.key;
 end loop;
 return jsonb_build_object('entries',result,'next',case when
  exists(select 1 from bob_private.bob_job_steps where job_id=p_job and checkpoint_bootstrap and key>cursor_key)
  or exists(select 1 from bob_private.bob_job_steps where job_id=p_job and not checkpoint_bootstrap and checkpoint_epoch>=coalesce(epoch,0) and key>cursor_key)
  then cursor_key else null end);
end $$;
revoke all on function bob.bob_checkpoint_steps_page(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob.bob_checkpoint_steps_page(uuid,uuid,text) to service_role;

create function bob_private.bob_claim_checkpoint_job(p_job uuid,p_capability uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; token uuid:=gen_random_uuid(); g bigint; message text;
begin
 select * into j from bob_private.bob_jobs where id=p_job and capability=p_capability;
 if not found then raise exception 'job_denied' using errcode='42501'; end if;
 if j.checkpoint_version=0 then return bob_private.bob_claim_job(p_job,p_capability); end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if j.waiting_ai_job is not null or j.status not in ('queued','running') or (j.status='running' and j.lease_until>clock_timestamp()) then return jsonb_build_object('status','inactive'); end if;
 if j.expires_at<=clock_timestamp() then return bob_private.bob_pause_job(j.id,j.claim_token); end if;
 if j.attempts>=5 and j.checkpoint_progress<=j.last_claim_checkpoint_progress then return bob_private.bob_finish_job(j.id,j.claim_token,'background_stalled'); end if;
 if exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed') then return bob_private.bob_finish_job(j.id,j.claim_token,null); end if;
 update bob_private.bob_thread_provider_state set generation=generation+1,lock_started_at=clock_timestamp(),updated_at=clock_timestamp()
 where thread_id=j.thread_id and in_flight_turn_id=j.turn_id returning generation into g;
 if not found then return bob_private.bob_finish_job(j.id,j.claim_token,'turn_not_claimed'); end if;
 update bob_private.bob_jobs set status='running',claim_token=token,lease_until=clock_timestamp()+interval '150 seconds',generation=g,
  attempts=case when checkpoint_progress>last_claim_checkpoint_progress then 1 else attempts+1 end,last_claim_checkpoint_progress=checkpoint_progress,
  total_claims=total_claims+1,updated_at=clock_timestamp() where id=j.id returning * into j;
 select text into message from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='user';
 insert into bob_private.bob_turn_screens values(j.thread_id,j.turn_id,null) on conflict do nothing;
 return jsonb_build_object('status','claimed','id',j.id,'claimToken',token,'projectId',j.project_id,'userId',j.actor_id,
  'threadId',j.thread_id,'clientTurnId',j.turn_id,'generation',g,'credential',j.credential,'message',message,'expiresAt',j.expires_at,
  'entries','[]'::jsonb,'asyncModels',j.async_models,'drawingRequestId',j.drawing_request_id,'workAllowanceVersion',1,'catalogManifestId',j.ai_catalog_manifest_id,
  'checkpointVersion',1,'checkpointJournalPaged',true,'checkpoint',bob_private.bob_checkpoint_packet(j.id),
  'screen',(select screen from bob_private.bob_turn_screens where thread_id=j.thread_id and turn_id=j.turn_id));
end $$;
create function bob.bob_claim_job_v2(p_job uuid,p_capability uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_claim_checkpoint_job(p_job,p_capability) $$;
revoke all on function bob_private.bob_claim_checkpoint_job(uuid,uuid),bob.bob_claim_job_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function bob_private.bob_claim_checkpoint_job(uuid,uuid),bob.bob_claim_job_v2(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
