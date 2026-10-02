-- PostgREST 14 retries SQLSTATE 40001 internally. A deterministic drawing
-- conflict must return once, not spin until the worker/turn expires.
-- Keep the existing authority, lifecycle, write ledger and event transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)
 rename to bob_drawing_request_before_conflict_response;
revoke all on function bob.bob_drawing_request_before_conflict_response(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)
 from public,anon,authenticated,service_role;

create function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return bob.bob_drawing_request_before_conflict_response(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
exception when serialization_failure then
 -- Only known application conflicts. Real transaction serialization failures
 -- keep their original SQLSTATE and the database's concurrency semantics.
 if sqlerrm = any(array['drawing_scope_changed','revision_conflict',
  'drawing_request_changed','drawing_request_cancelled','drawing_context_cleared',
  'drawing_request_complete','drawing_requirements_changed']) then
  raise sqlstate 'PT409' using message=sqlerrm;
 end if;
 raise;
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)
 from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;
commit;
