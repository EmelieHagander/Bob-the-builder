-- Failure is an operational result, even when no worker reached its reply code.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.project_drawing_requests drop constraint project_drawing_requests_reason_check;
alter table bob_private.project_drawing_requests add constraint project_drawing_requests_reason_check
 check(reason in ('context_missing','context_cleared','owner_cancelled','background_failed','background_expired'));

create function bob_private.record_failed_drawing_job(p_job uuid)
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
 uncertain:=exists(select 1 from shared_private.ai_jobs a where a.id=j.waiting_ai_job and a.response_id is null and a.status in ('submitting','expired'));
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
  and not exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.id and role='assistant') then
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

-- Retain existing claimed-turn completion, paid-result reuse and CAD event
-- fences. Only a failed drawing child receives this extra atomic result.
create or replace function bob_private.bob_finish_job(p_job uuid,p_claim uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 result:=bob_private.bob_finish_job_before_cad_failure_events(p_job,p_claim,p_error);
 if j.drawing_request_id is null and result->>'status' in ('completed','failed') then
  update bob_private.project_drawing_requests r set observed_event=greatest(r.observed_event,e.revision)
  from bob_private.drawing_project_events e,bob_private.drawing_requests d
  where r.project_id=j.project_id and r.owner_user_id=j.actor_id and r.thread_id=j.thread_id
   and r.origin_turn_id=j.turn_id and r.status='retrieval_failed'
   and e.project_id=r.project_id and d.id=r.id
   and d.payload#>>'{retry,outcome,stage}'='cad_engine';
 elsif result->>'status'='failed' then
  perform bob_private.record_failed_drawing_job(p_job);
 end if;
 return result;
end $$;
revoke all on function bob_private.bob_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob_private.bob_finish_job(uuid,uuid,text) to service_role;

-- Repair only still-current failures. No UUIDs, owner instructions, new jobs,
-- grants or model calls are manufactured by this installation.
do $$ declare item record; begin
 for item in select id from bob_private.bob_jobs where status='failed' and drawing_request_id is not null order by created_at desc loop
  perform bob_private.record_failed_drawing_job(item.id);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
