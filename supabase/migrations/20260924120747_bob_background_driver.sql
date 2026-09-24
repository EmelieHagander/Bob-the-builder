-- Existing pg_net + pg_cron on this project. No cross-app scheduler changes.
begin;
set local lock_timeout='5s';
create function bob_private.bob_dispatch_jobs()
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; j bob_private.bob_jobs; dispatched integer:=0;
begin
  for candidate in select id,project_id,actor_id from bob_private.bob_jobs
    where status in ('queued','running') order by created_at limit 20 loop
    -- Same actor lock as claim/reset/write; never hold a job lock first.
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.project_id || ':' || candidate.actor_id::text,0)) then continue; end if;
    select * into j from bob_private.bob_jobs where id=candidate.id for update;
    if not found or j.status not in ('queued','running') then continue; end if;
    if j.expires_at<=clock_timestamp() or j.attempts>=12 and (j.lease_until is null or j.lease_until<=clock_timestamp()) then
      perform bob_private.bob_finish_job(j.id,j.claim_token,'background_expired'); continue;
    end if;
    -- Keep old clients and reset fencing aligned with the actual live job.
    update bob_private.bob_thread_provider_state set lock_started_at=clock_timestamp()
      where thread_id=j.thread_id and in_flight_turn_id=j.turn_id;
    if (j.status='queued' or j.lease_until<=clock_timestamp()) and
      (j.dispatched_at is null or j.dispatched_at<clock_timestamp()-interval '30 seconds') then
      perform net.http_post(url:=j.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || j.capability::text),
        body:=jsonb_build_object('jobId',j.id),timeout_milliseconds:=5000);
      update bob_private.bob_jobs set dispatched_at=clock_timestamp() where id=j.id;
      dispatched:=dispatched+1;
    end if;
  end loop;
  -- Terminal credential and step cleanup happens immediately in finish_job.
  delete from bob_private.bob_jobs where status in ('completed','failed') and updated_at<clock_timestamp()-interval '7 days';
  return dispatched;
end $$;
revoke all on function bob_private.bob_dispatch_jobs() from public,anon,authenticated;
grant execute on function bob_private.bob_dispatch_jobs() to service_role;
create function bob.bob_dispatch_jobs() returns integer language sql security invoker set search_path='' as $$ select bob_private.bob_dispatch_jobs() $$;
revoke all on function bob.bob_dispatch_jobs() from public,anon,authenticated;
grant execute on function bob.bob_dispatch_jobs() to service_role;
do $$ begin
  if to_regnamespace('cron') is not null then perform cron.schedule('bob-background-turns','* * * * *','select bob_private.bob_dispatch_jobs()'); end if;
end $$;
notify pgrst,'reload schema';
commit;
