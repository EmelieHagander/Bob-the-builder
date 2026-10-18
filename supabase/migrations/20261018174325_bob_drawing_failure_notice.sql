-- Coalesce only consecutive notices for the same drawing mandate and failure.
-- Original history, attempt records and source geometry are preserved.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $notice_preflight$ begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('bob_private.record_failed_drawing_job(uuid)'))
  is distinct from 'eec4b29e7788dd18b0d7dc24515e88b1' then
  raise exception 'drawing_failure_notice_source_changed';
 end if;
end $notice_preflight$;
create or replace function bob_private.record_failed_drawing_job(p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; r bob_private.project_drawing_requests; d bob_private.drawing_requests;
 code text; seq bigint; uncertain boolean; detail jsonb; notice text;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.drawing_request_id is null or j.status<>'failed' or j.error_code is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if not found or j.status<>'failed' then return false; end if;
 select * into r from bob_private.project_drawing_requests where id=j.drawing_request_id for update;
 -- Older failures cannot override a newer mandate, attempt, reset or delivery.
 if not found or r.project_id<>j.project_id or r.owner_user_id<>j.actor_id or r.thread_id is distinct from j.thread_id
  or r.origin_turn_id is distinct from j.turn_id or r.observed_event<>j.drawing_event_revision
  or r.status in ('saved','paused','cancelled')
  or exists(select 1 from bob_private.bob_jobs newer where newer.drawing_request_id=r.id and newer.id<>j.id
   and (newer.status in ('queued','running') or newer.created_at>j.created_at)) then return false; end if;
 select * into d from bob_private.drawing_requests where id=r.id and thread_id=j.thread_id for update;
 if not found or d.revision<>r.revision or d.status='saved' or d.payload#>>'{execution_failure,job_id}'=j.id::text then return false; end if;
 code:=case when j.error_code='background_expired' then 'background_expired' else 'background_failed' end;
 uncertain:=exists(select 1 from shared_private.ai_jobs a where a.id=j.waiting_ai_job and a.response_id is null and a.status in ('submitting','expired') and a.submission_state is distinct from 'prepared');
 detail:=jsonb_build_object('job_id',j.id,'ai_job_id',j.waiting_ai_job,'code',code,'receipt_missing',uncertain,'observed_at',j.updated_at);
 update bob_private.drawing_requests set status='retrieval_failed',revision=revision+1,updated_at=clock_timestamp(),
  payload=jsonb_set(payload,'{execution_failure}',detail) where id=r.id returning * into d;
 update bob_private.project_drawing_requests set status='retrieval_failed',reason=code,revision=d.revision,updated_at=d.updated_at where id=r.id;
 insert into bob.execution_events(run_id,turn_id,event_key,kind,role,status,duration_ms,counts)
 values(j.id,j.turn_id,'background_failure','delivery','bob','failed',
  least(86400000,greatest(0,floor(extract(epoch from (j.updated_at-j.created_at))*1000)))::bigint,
  jsonb_build_object('end_reason',code,'job_id',j.id,'drawing_request_id',r.id,'ai_job_id',j.waiting_ai_job,'receipt_missing',uncertain))
 on conflict(run_id,event_key) do nothing;
 -- The private answer is added once under the event-job ID. The original
 -- owner message and earlier answer remain intact. No explanatory AI call.
 if exists(select 1 from bob.people where project_id=j.project_id and auth_user_id=j.actor_id)
  and exists(select 1 from bob.bob_threads where id=j.thread_id and project_id=j.project_id and owner_user_id=j.actor_id and status='active')
  and not exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.id and role='assistant')
  -- Distinct failed attempts remain in the ledger. Do not append the same
  -- terminal notice when it is already the last message in this private thread.
  -- A new owner message, another reply, changed error or uncertain receipt is
  -- a new delivery boundary; never deduplicate arbitrary equal chat text.
  and not exists(
   select 1 from bob.bob_messages m
   join bob_private.bob_jobs previous on previous.id=m.turn_id
   join bob.execution_events e on e.run_id=previous.id and e.event_key='background_failure'
   where m.thread_id=j.thread_id and m.role='assistant'
    and previous.drawing_request_id=j.drawing_request_id and previous.turn_id=j.turn_id
    and previous.status='failed' and previous.error_code=j.error_code
    and e.counts->'receipt_missing'=to_jsonb(uncertain)
    and not exists(select 1 from bob.bob_messages later where later.thread_id=m.thread_id and later.seq>m.seq)
  ) then
  notice:=case when uncertain then
   'AI-anropet fick inget kvitto innan väntetiden tog slut. Ritningsarbetet är stoppat och det sparade underlaget är bevarat. Ingen ny ritning har bekräftats som sparad. Anropets utfall behöver kontrolleras innan samma arbete skickas igen.'
   else 'Ritningsarbetet stoppades av ett tekniskt fel. Det sparade underlaget och tidigare ritningsversioner är bevarade. Ingen ny ritning har bekräftats som sparad.' end;
  update bob.bob_threads set next_seq=next_seq+1,updated_at=clock_timestamp() where id=j.thread_id returning next_seq-1 into seq;
  insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence)
  values(j.thread_id,seq,j.id,'assistant',notice,jsonb_build_object('kind','ai_assessment','references','[]'::jsonb,'sources','[]'::jsonb,'partial',true,'writes','[]'::jsonb));
 end if;
 return true;
end $$;
revoke all on function bob_private.record_failed_drawing_job(uuid) from public,anon,authenticated,service_role;
commit;
