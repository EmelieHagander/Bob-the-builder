-- Bob felt slow (2026-11-09): with no OpenAI webhook arriving, a finished
-- background response was only noticed at the next one-minute check, so each
-- model step cost about a minute of waiting. Young jobs are now checked every
-- few seconds; the webhook still wakes them at once when it arrives. A check is
-- a free response lookup, never a new model call.

create or replace function shared_private.ai_poll_delay(p_created timestamptz) returns interval
language sql stable set search_path='' as $$
  select case when p_created>clock_timestamp()-interval '15 minutes' then interval '5 seconds' else interval '1 minute' end
$$;
revoke all on function shared_private.ai_poll_delay(timestamptz) from public;

CREATE OR REPLACE FUNCTION shared.ai_job_accept(p_job uuid, p_response jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j shared_private.ai_jobs; rid text:=p_response->>'id'; state text:=p_response->>'status'; a jsonb; u jsonb;
 input_n integer; output_n integer; cached_n integer; cost numeric;
begin
 if p_job is null then return false; end if;
 select * into j from shared_private.ai_jobs where id=p_job for update;
 if not found then return false; end if;
 if p_response#>>'{metadata,ai_job_id}' is distinct from p_job::text
   or coalesce(rid,'')!~'^resp_[a-zA-Z0-9_-]{1,200}$'
   or state is null or state not in ('queued','in_progress','completed','failed','cancelled','incomplete')
   or (j.response_id is not null and j.response_id<>rid) then raise exception 'ai_response_mismatch'; end if;
 if j.response_id is null then update shared_private.ai_jobs set response_id=rid,cancel_pending=status in ('cancelled','expired') where id=j.id; end if;
 if j.finished_at is not null and (j.status not in ('expired','cancelled') or exists(select 1 from shared.ai_usage_events where background_job_id=j.id)) then return true; end if;
 if state in ('queued','in_progress') then
   update shared_private.ai_jobs set status=case when status='submitting' then 'pending' else status end,
    next_check_at=clock_timestamp()+shared_private.ai_poll_delay(j.created_at) where id=j.id;
   return true;
 end if;
 a:=j.accounting;u:=coalesce(p_response->'usage','{}');
 input_n:=greatest(0,coalesce((u->>'input_tokens')::integer,0));output_n:=greatest(0,coalesce((u->>'output_tokens')::integer,0));
 cached_n:=least(input_n,greatest(0,coalesce((u#>>'{input_tokens_details,cached_tokens}')::integer,0)));
 cost:=round(((input_n-cached_n)*(a->>'input_price_per_1m')::numeric+cached_n*(a->>'cached_price_per_1m')::numeric+output_n*(a->>'output_price_per_1m')::numeric)/1000000,6);
 insert into shared.ai_usage_events(app,user_id,module,ai_function,model,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,input_price_per_1m,output_price_per_1m,cost_usd,success,background_job_id)
 values(j.app,(a->>'user_id')::uuid,a->>'module',a->>'ai_function',a->>'model',input_n,cached_n,output_n,
 greatest(0,coalesce((u#>>'{output_tokens_details,reasoning_tokens}')::integer,0)),input_n+output_n,
 (a->>'input_price_per_1m')::numeric,(a->>'output_price_per_1m')::numeric,cost,state='completed',j.id)
 on conflict(background_job_id) do nothing;
 -- Late output is accounted for, but cannot revive a cancelled/expired app operation.
 if j.status in ('expired','cancelled') or j.expires_at<=clock_timestamp() then
   update shared_private.ai_jobs set status=case when status='cancelled' then status else 'expired' end,response=null,cancel_pending=false,finished_at=clock_timestamp() where id=j.id;
 else
   update shared_private.ai_jobs set status=case when state='completed' then 'completed' else 'failed' end,response=p_response,finished_at=clock_timestamp() where id=j.id;
 end if;
 update shared_private.ai_jobs set next_check_at=clock_timestamp() where id=j.id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION shared.ai_work_finish(p_kind text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_kind='event' then update shared_private.ai_events set finished_at=clock_timestamp(),lease_until=null where id=p_id;
 elsif p_kind='job' then update shared_private.ai_jobs set lease_until=null,
   next_check_at=clock_timestamp()+case when status in ('submitting','pending') then shared_private.ai_poll_delay(created_at) else interval '1 minute' end where id=p_id; end if;
end $function$;

do $$ begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('shared-ai-background','5 seconds','select shared_private.ai_dispatch()');
  end if;
end $$;
