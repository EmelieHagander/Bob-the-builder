-- Read-only recovery of the drawing scope delegated by one private owner turn.
-- The original chat job/message remain historical: a completed drawing does not
-- assert that every other deliverable mentioned by that owner turn is complete.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob_private.bob_job_status(p_project text,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb; request_ids jsonb; complete boolean; active jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then
  raise exception 'project_denied' using errcode='42501';
 end if;
 select job.* into j from bob_private.bob_jobs job
 join bob.bob_threads t on t.id=job.thread_id and t.project_id=job.project_id
  and t.owner_user_id=auth.uid() and t.status='active'
 where job.project_id=p_project and job.actor_id=auth.uid() and job.turn_id=p_turn
  and job.drawing_request_id is null;
 if not found then return null; end if;
 result:=jsonb_build_object(
  'status',case when j.status in ('queued','running') and j.expires_at<=clock_timestamp() then 'failed' else j.status end,
  'expiresAt',j.expires_at,'error',j.error_code,
  'progress',case when j.status in ('queued','running') then j.progress else null end,
  'screen',(select s.screen from bob_private.bob_turn_screens s where s.thread_id=j.thread_id and s.turn_id=j.turn_id));

 -- All requests linked to this exact owner instruction must be proven saved.
 -- Use each request's latest event, rather than any later private reply or an
 -- older successful event whose current recovery has subsequently failed.
 select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb),
  coalesce(bool_and(coalesce(
   r.status='saved' and r.saved_receipt->>'dataset'='artifacts'
   and r.saved_receipt->>'projectId'=p_project
   and event.status='completed'
   and exists(select 1 from bob.artifact_revisions a where a.project_id=p_project
    and a.artifact_id::text=r.saved_receipt->>'recordId'
    and a.revision::text=r.saved_receipt->>'revision')
   and exists(select 1 from bob.bob_messages m where m.thread_id=j.thread_id
    and m.turn_id=event.id and m.role='assistant' and m.delivery_state='completed'
    and m.evidence->'partial'='false'::jsonb
    and m.evidence->'writes' @> jsonb_build_array(r.saved_receipt)),false)),false),
  (jsonb_agg(jsonb_build_object('status',event.status,'expiresAt',event.expires_at,'progress',event.progress)
   order by event.created_at desc,event.id desc)
   filter(where event.status in ('queued','running') and event.expires_at>clock_timestamp()
    and r.status not in ('paused','cancelled')))->0
 into request_ids,complete,active
 from bob_private.project_drawing_requests r
 left join lateral (
  select work.id,work.status,work.expires_at,work.progress,work.created_at
  from bob_private.bob_jobs work where work.drawing_request_id=r.id
   and work.project_id=p_project and work.actor_id=auth.uid()
   and work.thread_id=j.thread_id and work.turn_id=p_turn
  order by work.created_at desc,work.id desc limit 1
 ) event on true
 where r.project_id=p_project and r.owner_user_id=auth.uid()
  and r.thread_id=j.thread_id and r.origin_turn_id=p_turn;

 if jsonb_array_length(request_ids)>0 and (complete or active is not null) then
  result:=result||jsonb_build_object('drawingRecovery',
   jsonb_build_object('scope','drawing','requestIds',request_ids)||
   case when complete then jsonb_build_object('status','completed','expiresAt',null,'progress',null) else active end);
 end if;
 return result;
end $$;
-- Preserve the existing caller-only API and its explicit invoker wrapper.
revoke all on function bob_private.bob_job_status(text,uuid) from public,anon,service_role;
grant execute on function bob_private.bob_job_status(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
