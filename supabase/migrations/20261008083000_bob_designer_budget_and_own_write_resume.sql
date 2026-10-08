-- 2026-10-08: a first-layout designer call spent 26k reasoning tokens against a
-- 16k cap and returned nothing usable. Give the designer room to finish.
-- The same turn's own measurement writes then looked like new project data,
-- so the failed request re-ran right away and posted the same failure twice.
-- A chat turn's request now observes every event up to its save, so only data
-- that changes after the turn can resume it.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

update shared.ai_settings set max_output_tokens=32000
 where app='bob' and function_name='cad-designer' and max_output_tokens<32000;

create or replace function bob.bob_drawing_request_before_conflict_response(p_project text, p_user uuid, p_thread uuid, p_turn uuid, p_generation bigint, p_operation text, p_id uuid DEFAULT NULL::uuid, p_expected integer DEFAULT 0, p_status text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb, p_write_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
as $$
declare result jsonb; j bob_private.bob_jobs;
begin
 result:=bob.bob_drawing_request_before_events(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 if p_operation='save' and exists(select 1 from bob_private.project_drawing_requests where id=p_id) then
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and thread_id=p_thread and turn_id=p_turn and status in ('queued','running') order by drawing_request_id nulls first limit 1;
  delete from bob_private.drawing_authorities a using bob_private.project_drawing_requests r where a.request_id=r.id and r.id=p_id and r.origin_turn_id is distinct from p_turn;
  update bob_private.project_drawing_requests set origin_turn_id=p_turn,
   observed_event=greatest(observed_event,case when j.drawing_request_id is not null then j.drawing_event_revision else coalesce((select revision from bob_private.drawing_project_events where project_id=p_project),0) end) where id=p_id;
  if j.credential is not null and j.drawing_request_id is null then
   insert into bob_private.drawing_authorities values(p_id,p_thread,j.credential,j.expires_at,j.worker_url)
   on conflict(request_id) do update set thread_id=excluded.thread_id,credential=excluded.credential,expires_at=excluded.expires_at,worker_url=excluded.worker_url;
  end if;
 end if;
 return result;
end $$;

revoke all on function bob.bob_drawing_request_before_conflict_response(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)
 from public,anon,authenticated,service_role;
commit;
