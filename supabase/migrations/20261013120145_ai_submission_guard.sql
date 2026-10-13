-- Claim submission after preparation; legacy unacknowledged operations remain uncertain.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table shared_private.ai_jobs add column submission_state text check(submission_state in ('prepared','started'));
alter table shared_private.ai_jobs add column submit_started_at timestamptz;
alter table shared_private.ai_jobs add constraint ai_submission_state_time
 check(case submission_state when 'started' then submit_started_at is not null when 'prepared' then submit_started_at is null else submission_state is null and submit_started_at is null end);

create function shared.ai_job_prepare(p_app text,p_key text,p_fingerprint text,p_receiver text,p_context jsonb,p_expires timestamptz,p_accounting jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=shared.ai_job_reserve(p_app,p_key,p_fingerprint,p_receiver,p_context,p_expires,p_accounting);
 if result->>'submit'='true' then
  update shared_private.ai_jobs set submission_state='prepared' where id=(result->>'id')::uuid;
 end if;
 return result;
end $$;
revoke all on function shared.ai_job_prepare(text,text,text,text,jsonb,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function shared.ai_job_prepare(text,text,text,text,jsonb,timestamptz,jsonb) to service_role;

create function shared.ai_job_start_submission(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs;
begin
 select * into j from shared_private.ai_jobs where id=p_job for update;
 if not found then return jsonb_build_object('submit',false,'status','expired'); end if;
 if j.status<>'submitting' or j.response_id is not null or j.submission_state is distinct from 'prepared' then
  return jsonb_build_object('submit',false,'status',j.status); end if;
 if j.expires_at<=clock_timestamp() or j.created_at<=clock_timestamp()-interval '2 minutes' then
  update shared_private.ai_jobs set status='expired',finished_at=clock_timestamp(),next_check_at=clock_timestamp() where id=j.id;
  return jsonb_build_object('submit',false,'status','expired'); end if;
 if not exists(select 1 from shared_private.ai_receivers where app=j.app and name=j.receiver and enabled)
  or not exists(select 1 from shared_private.ai_runtime where worker_url is not null) then
  update shared_private.ai_jobs set status='failed',finished_at=clock_timestamp(),next_check_at=clock_timestamp() where id=j.id;
  return jsonb_build_object('submit',false,'status','failed'); end if;
 update shared_private.ai_jobs set submission_state='started',submit_started_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('submit',true,'status','submitting');
end $$;
revoke all on function shared.ai_job_start_submission(uuid) from public,anon,authenticated;
grant execute on function shared.ai_job_start_submission(uuid) to service_role;

alter table shared_private.ai_background_failures drop constraint ai_background_failures_error_code_check;
alter table shared_private.ai_background_failures add constraint ai_background_failures_error_code_check check(error_code in ('ai_response_mismatch','ai_operation_changed','ai_background_not_configured','invalid_job_deadline','ai_work_denied','project_denied','context_changed','unsupported_image','payload_too_large','invalid_ai_failure_diagnostic','not_submitted','receipt_missing','deadline_elapsed','model_output_limit','provider_failed'));
create or replace function shared_private.ai_record_terminal_failure()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='expired' and old.status is distinct from new.status then
  insert into shared_private.ai_background_failures(job_id,phase,category,response_id,error_code,elapsed_ms)
  values(new.id,'expire','expired',new.response_id,case when new.response_id is null and new.submission_state='prepared' then 'not_submitted' when new.response_id is null then 'receipt_missing' else 'deadline_elapsed' end,
   least(86400000,greatest(0,floor(extract(epoch from (clock_timestamp()-new.created_at))*1000)))::integer);
 elsif new.status='failed' and old.status is distinct from new.status and new.response is not null then
  insert into shared_private.ai_background_failures(job_id,phase,category,response_id,error_code)
  values(new.id,'provider','protocol',new.response_id,
   case when new.response#>>'{incomplete_details,reason}'='max_output_tokens' then 'model_output_limit' else 'provider_failed' end);
 end if;
 return new;
end $$;

create or replace function shared.ai_work_claim(p_kind text,p_id uuid,p_capability uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs; e shared_private.ai_events;
begin
 if p_kind='job' then
   select * into j from shared_private.ai_jobs where id=p_id and capability=p_capability for update;
   if not found then raise exception 'ai_work_denied' using errcode='42501'; end if;
   if (j.status not in ('submitting','pending') and not j.cancel_pending) or j.lease_until>clock_timestamp() then return null; end if;
   -- An acceptance POST times out after 20 seconds, so an operation that still has no
 -- provider response ID two minutes after submission started was not acknowledged (network failure,
 -- worker death before accept). Expire it now instead of at the turn deadline so the
 -- owner hears about it within minutes; a late signed completion still settles usage.
 if j.expires_at<=clock_timestamp() or j.cancel_pending
   or (j.status='submitting' and j.response_id is null and coalesce(j.submit_started_at,j.created_at)<=clock_timestamp()-interval '2 minutes') then
     update shared_private.ai_jobs set status=case when status='cancelled' then status else 'expired' end,
       finished_at=coalesce(finished_at,clock_timestamp()),cancel_pending=response_id is not null and expires_at>clock_timestamp()-interval '1 hour',
       lease_until=clock_timestamp()+interval '40 seconds',next_check_at=clock_timestamp()+interval '1 minute' where id=j.id;
     return jsonb_build_object('response_id',case when j.expires_at>clock_timestamp()-interval '1 hour' then j.response_id else null end,'cancel',true);
   end if;
   update shared_private.ai_jobs set lease_until=clock_timestamp()+interval '40 seconds',next_check_at=clock_timestamp()+interval '1 minute' where id=j.id;
   return jsonb_build_object('response_id',j.response_id);
 elsif p_kind='event' then
   select * into e from shared_private.ai_events where id=p_id and capability=p_capability for update;
   if not found then raise exception 'ai_work_denied' using errcode='42501'; end if;
   if e.finished_at is not null or e.lease_until>clock_timestamp() then return null; end if;
   update shared_private.ai_events set lease_until=clock_timestamp()+interval '40 seconds',next_check_at=clock_timestamp()+interval '1 minute' where id=e.id;
   return jsonb_build_object('response_id',e.response_id);
 end if;
 raise exception 'invalid_work_kind';
end $$;
notify pgrst,'reload schema';
commit;
