-- A renderer/constructor failure is already final for this chat turn. Task
-- status/description writes after its checkpoint must not immediately restart
-- the same failed design with the turn's remaining short-lived authority.
-- Later events still wake it; fresh drawing pieces and physical gaps retain
-- their existing event semantics. No allocation or source packet changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter function bob_private.bob_finish_job(uuid,uuid,text) rename to bob_finish_job_before_cad_failure_events;
revoke all on function bob_private.bob_finish_job_before_cad_failure_events(uuid,uuid,text)
 from public,anon,authenticated,service_role;

create function bob_private.bob_finish_job(p_job uuid,p_claim uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 -- The existing command enforces the lease/claim and finishes atomically.
 result:=bob_private.bob_finish_job_before_cad_failure_events(p_job,p_claim,p_error);
 if j.drawing_request_id is null and result->>'status' in ('completed','failed') then
  update bob_private.project_drawing_requests r set observed_event=greatest(r.observed_event,e.revision)
  from bob_private.drawing_project_events e,bob_private.drawing_requests d
  where r.project_id=j.project_id and r.owner_user_id=j.actor_id and r.thread_id=j.thread_id
    and r.origin_turn_id=j.turn_id and r.status='retrieval_failed'
    and e.project_id=r.project_id and d.id=r.id
    and d.payload#>>'{retry,outcome,stage}'='cad_engine';
 end if;
 return result;
end $$;
revoke all on function bob_private.bob_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob_private.bob_finish_job(uuid,uuid,text) to service_role;
commit;
