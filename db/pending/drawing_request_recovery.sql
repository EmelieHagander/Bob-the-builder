-- P2a release candidate. NOT an installed migration. Generate its migration
-- filename with the pinned Supabase CLI before release; tests load this file
-- explicitly after the canonical schema while publication is blocked.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.drawing_requests
 add column saved_receipt jsonb,
 add column saved_input_hash text;

-- Preserve the service-only owner/project/claimed-turn boundary. A request can
-- be completed only by the CAD write transaction, never by a status-only update.
alter function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)
 rename to bob_drawing_request_before_recovery;
revoke all on function bob.bob_drawing_request_before_recovery(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
create function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; r bob_private.drawing_requests;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 if p_operation='save' then
  if p_status='saved' then raise exception 'drawing_completion_requires_receipt' using errcode='22023'; end if;
  if p_id is not null then
   select * into r from bob_private.drawing_requests where id=p_id and thread_id=p_thread for update;
   if found and r.status='saved' then raise exception 'drawing_request_complete' using errcode='40001'; end if;
  end if;
 end if;
 result:=bob.bob_drawing_request_before_recovery(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 if p_operation='load' and result is not null then
  select * into r from bob_private.drawing_requests where id=p_id and thread_id=p_thread;
  result:=result||jsonb_build_object('receipt',r.saved_receipt);
 end if;
 return result;
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;

-- Existing entry points still pass through v9. Legacy callers without a request
-- retain the existing CAD contract. New claimed-server writes bind an exact
-- reviewed private request to the canonical Artifact and receipt in ONE commit.
alter function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_request_recovery;
revoke all on function bob_private.bob_project_write_before_request_recovery(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; link jsonb:=d->'drawing_request'; r bob_private.drawing_requests;
 result jsonb; commitment jsonb; clean jsonb; msg text; input_hash text;
begin
 if p_payload->>'kind' is distinct from 'cad' or not (d ? 'drawing_request') then
  return bob_private.bob_project_write_before_request_recovery(p_project,p_thread,p_turn,p_generation,p_payload);
 end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if jsonb_typeof(link) is distinct from 'object' or link-array['id','revision']::text[]<>'{}'
  or coalesce(link->>'revision','')!~'^[1-9][0-9]{0,8}$' or link->>'id' is null then
  raise exception 'invalid_drawing_request_link' using errcode='22023';
 end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500
  or msg is null or position(p_payload->>'request_quote' in msg)=0 then
  raise exception 'request_quote_required' using errcode='22023';
 end if;
 select * into r from bob_private.drawing_requests where id=(link->>'id')::uuid and thread_id=p_thread for update;
 if not found then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 d:=d-'drawing_request';
 clean:=jsonb_set(p_payload,'{data}',d);
 input_hash:=encode(sha256(convert_to((clean-'request_quote')::text,'UTF8')),'hex');
 if r.status='saved' then
  if r.saved_receipt is null or r.saved_input_hash is distinct from input_hash then
   raise exception 'drawing_request_complete' using errcode='40001';
  end if;
  return r.saved_receipt;
 end if;
 if r.revision<>(link->>'revision')::integer or r.status<>'reviewed' then
  raise exception 'drawing_request_changed' using errcode='40001';
 end if;
 commitment:=jsonb_set(d,'{packet}',jsonb_build_object('recipe',d->'packet'->'recipe','manifest',d->'packet'->'manifest'));
 if r.payload->'reviewed_candidate' is distinct from commitment then
  raise exception 'drawing_candidate_changed' using errcode='40001';
 end if;
 -- The original writer validates source freshness, claimed-turn authority,
 -- geometry, current plan links, quota and its usual replay receipt.
 result:=bob_private.bob_project_write_before_request_recovery(p_project,p_thread,p_turn,p_generation,clean);
 update bob_private.drawing_requests set status='saved',revision=revision+1,
  saved_receipt=result,saved_input_hash=input_hash,updated_at=clock_timestamp() where id=r.id;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
