-- Fail fast on background model requests that were never acknowledged by the provider.
-- Previously such a reservation waited for the whole turn deadline (up to 20 minutes)
-- before Bob reported anything. Same expiry semantics as before: late results are
-- billed, cancelled at the provider when a response ID appears, and never revive the
-- app operation. Owner-facing behaviour, grants and other functions are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function shared.ai_work_claim(p_kind text,p_id uuid,p_capability uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs; e shared_private.ai_events;
begin
 if p_kind='job' then
   select * into j from shared_private.ai_jobs where id=p_id and capability=p_capability for update;
   if not found then raise exception 'ai_work_denied' using errcode='42501'; end if;
   if (j.status not in ('submitting','pending') and not j.cancel_pending) or j.lease_until>clock_timestamp() then return null; end if;
   -- An acceptance POST times out after 20 seconds, so a reservation that still has no
 -- provider response ID after two minutes was never acknowledged (network failure,
 -- worker death before accept). Expire it now instead of at the turn deadline so the
 -- owner hears about it within minutes; a late signed completion still settles usage.
 if j.expires_at<=clock_timestamp() or j.cancel_pending
   or (j.status='submitting' and j.response_id is null and j.created_at<=clock_timestamp()-interval '2 minutes') then
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
commit;
