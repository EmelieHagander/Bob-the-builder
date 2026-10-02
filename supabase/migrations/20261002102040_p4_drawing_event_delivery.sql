-- Deliver the private domain-event reply atomically with completion. The old
-- finish command remains the error/cron compatibility path. Neither browser
-- users nor the language model choose the job's owner, thread or saved receipt.
create function bob_private.bob_finish_drawing_job(p_job uuid,p_claim uuid,p_answer text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; r bob_private.project_drawing_requests; result jsonb; seq bigint; proof jsonb;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.drawing_request_id is null then raise exception 'drawing_job_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp()
   or j.expires_at<=clock_timestamp() then raise exception 'job_not_claimed' using errcode='40001'; end if;
 select * into r from bob_private.project_drawing_requests where id=j.drawing_request_id for update;
 if r.status in ('paused','cancelled') or r.owner_user_id<>j.actor_id or r.thread_id<>j.thread_id
   or not exists(select 1 from bob.people where project_id=j.project_id and auth_user_id=j.actor_id)
   then raise exception 'project_denied' using errcode='42501'; end if;
 if p_answer is null or length(trim(p_answer))=0 or length(p_answer)>6000 then raise exception 'invalid_delivery_answer'; end if;
 proof:=jsonb_build_object('kind','ai_assessment','references','[]'::jsonb,'sources','[]'::jsonb,
  'partial',r.status<>'saved','writes',case when r.saved_receipt is null then '[]'::jsonb else jsonb_build_array(r.saved_receipt) end);
 result:=bob_private.bob_finish_job(p_job,p_claim,null);
 -- The compatibility command may have emitted its standard notice. Replace
 -- that exact event message, never an earlier assistant or original user turn.
 update bob.bob_messages set text=p_answer,evidence=proof where thread_id=j.thread_id and turn_id=j.id and role='assistant';
 if not found then
  update bob.bob_threads set next_seq=next_seq+1 where id=j.thread_id returning next_seq-1 into seq;
  insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence) values(j.thread_id,seq,j.id,'assistant',p_answer,proof);
 end if;
 return result;
end $$;
revoke all on function bob_private.bob_finish_drawing_job(uuid,uuid,text) from public,anon,authenticated,service_role;
create function bob.bob_finish_drawing_job(p_job uuid,p_claim uuid,p_answer text)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_finish_drawing_job(p_job,p_claim,p_answer) $$;
revoke all on function bob.bob_finish_drawing_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob_private.bob_finish_drawing_job(uuid,uuid,text),bob.bob_finish_drawing_job(uuid,uuid,text) to service_role;
