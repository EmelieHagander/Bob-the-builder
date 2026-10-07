-- K5: an explicit retry of a failed chat turn reuses that turn's completed,
-- successful model calls with byte-identical input instead of paying again.
-- Private to the owner, the thread and the turn; deleted with the thread, on
-- successful completion and after seven days. Not a project fact or receipt.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.bob_turn_model_results (
  project_id text not null references bob.projects(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  turn_id uuid not null,
  fingerprint text not null check(length(fingerprint)=64),
  value jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,actor_id,turn_id,fingerprint)
);
create index bob_turn_model_results_thread on bob_private.bob_turn_model_results(thread_id);
create index bob_turn_model_results_created on bob_private.bob_turn_model_results(created_at);
alter table bob_private.bob_turn_model_results enable row level security;
revoke all on bob_private.bob_turn_model_results from public,anon,authenticated,service_role;

alter function bob_private.bob_finish_job(uuid,uuid,text) rename to bob_finish_job_before_model_reuse;
revoke all on function bob_private.bob_finish_job_before_model_reuse(uuid,uuid,text) from public,anon,authenticated,service_role;
create function bob_private.bob_finish_job(p_job uuid,p_claim uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb; chat boolean;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 -- Drawing requests keep their own fingerprinted model-result ledger.
 chat:=found and j.drawing_request_id is null;
 if chat and j.claim_token is not distinct from p_claim and j.status in ('queued','running') then
  insert into bob_private.bob_turn_model_results(project_id,actor_id,thread_id,turn_id,fingerprint,value)
   select j.project_id,j.actor_id,j.thread_id,j.turn_id,s.fingerprint,s.value from bob_private.bob_job_steps s
   where s.job_id=j.id and s.key ~ '^model:[^:]+:[0-9]+$'
    and s.value->'ok'='true'::jsonb and s.value->'result'->'success'='true'::jsonb
   on conflict do nothing;
 end if;
 result:=bob_private.bob_finish_job_before_model_reuse(p_job,p_claim,p_error);
 if chat and result->>'status'='completed' then
  delete from bob_private.bob_turn_model_results where project_id=j.project_id and actor_id=j.actor_id and turn_id=j.turn_id;
 end if;
 delete from bob_private.bob_turn_model_results where created_at<clock_timestamp()-interval '7 days';
 return result;
end $$;
revoke all on function bob_private.bob_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob_private.bob_finish_job(uuid,uuid,text) to service_role;

-- The claimed worker reads only its own turn's reusable results.
create function bob_private.bob_job_reusable_models(p_job uuid,p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j bob_private.bob_jobs;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
  raise exception 'job_not_claimed' using errcode='40001'; end if;
 if j.drawing_request_id is not null then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('fingerprint',r.fingerprint,'value',r.value) order by r.created_at,r.fingerprint)
  from bob_private.bob_turn_model_results r
  where r.project_id=j.project_id and r.actor_id=j.actor_id and r.thread_id=j.thread_id and r.turn_id=j.turn_id),'[]'::jsonb);
end $$;
revoke all on function bob_private.bob_job_reusable_models(uuid,uuid) from public,anon,authenticated;
grant execute on function bob_private.bob_job_reusable_models(uuid,uuid) to service_role;
create function bob.bob_job_reusable_models(p_job uuid,p_claim uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select bob_private.bob_job_reusable_models(p_job,p_claim) $$;
revoke all on function bob.bob_job_reusable_models(uuid,uuid) from public,anon,authenticated;
grant execute on function bob.bob_job_reusable_models(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
