-- Private drawing intake survives complements in the same conversation. It is
-- working evidence, never a project measurement or a saved drawing Artifact.
begin;
set local lock_timeout='5s';
create table bob_private.drawing_requests (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references bob.bob_threads(id) on delete cascade,
 revision integer not null default 1 check(revision>0),
 status text not null check(status in ('collecting','needs_data','retrieval_failed','ready_to_design','draft','reviewed','saved')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=300000),
 updated_at timestamptz not null default clock_timestamp()
);
create index drawing_requests_thread on bob_private.drawing_requests(thread_id,updated_at desc);
alter table bob_private.drawing_requests enable row level security;
revoke all on bob_private.drawing_requests from public,anon,authenticated;
create table bob_private.drawing_request_writes (
 thread_id uuid not null references bob.bob_threads(id) on delete cascade,
 write_key text not null check(length(write_key)<=200),
 input jsonb not null,
 result jsonb not null,
 primary key(thread_id,write_key)
);
alter table bob_private.drawing_request_writes enable row level security;
revoke all on bob_private.drawing_request_writes from public,anon,authenticated;
create function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.drawing_requests; result jsonb; saved_input jsonb; input jsonb;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 if p_operation='list' then
  select coalesce(jsonb_agg(item order by stamp desc),'[]'::jsonb) into result from (
   select updated_at stamp,jsonb_build_object('id',id,'revision',revision,'status',status,'brief',left(payload->'brief'->>'brief',240),'incomplete',payload->'incomplete') item
   from bob_private.drawing_requests where thread_id=p_thread and status<>'saved' order by updated_at desc limit 12
  ) q;
  return result;
 end if;
 if p_operation='load' then
  select * into r from bob_private.drawing_requests where id=p_id and thread_id=p_thread;
  if not found then return null; end if;
 elsif p_operation='save' then
  if p_write_key is null or length(p_write_key)>200 then raise exception 'invalid_write_key'; end if;
  input:=jsonb_build_object('id',p_id,'expected',p_expected,'status',p_status,'payload',p_payload);
  select w.result,w.input into result,saved_input from bob_private.drawing_request_writes w where w.thread_id=p_thread and w.write_key=p_write_key;
  if found then
   if saved_input is distinct from input then raise exception 'write_key_conflict'; end if;
   return result;
  end if;
  if p_payload is null or jsonb_typeof(p_payload->'brief') is distinct from 'object' or jsonb_typeof(p_payload->'reference_refs') is distinct from 'array' then raise exception 'invalid_drawing_request'; end if;
  -- Private pixels, signed URLs and renderer files must not enter this packet.
  if p_payload::text ~ '(data:image/|base64,|[?&](token|signature|X-Amz-Signature)=|"image_url"\s*:|"previews"\s*:|"files"\s*:)' then raise exception 'drawing_request_pixels_forbidden'; end if;
  if p_id is null then
   if p_expected<>0 then raise exception 'revision_conflict' using errcode='40001'; end if;
   insert into bob_private.drawing_requests(thread_id,status,payload) values(p_thread,p_status,p_payload) returning * into r;
  else
   update bob_private.drawing_requests set revision=revision+1,status=p_status,payload=p_payload,updated_at=clock_timestamp()
   where id=p_id and thread_id=p_thread and revision=p_expected returning * into r;
   if not found then raise exception 'revision_conflict' using errcode='40001'; end if;
  end if;
 else raise exception 'invalid_operation';
 end if;
 result:=jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'payload',r.payload);
 if p_operation='save' then insert into bob_private.drawing_request_writes values(p_thread,p_write_key,input,result); end if;
 return result;
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;
update bob.tool_catalog set schema_version=3,
 description='Collect and assess all drawing requirements, then construct and independently review CAD.',
 how_to='Delegate early with the full requirement checklist; the collector reads project facts and relevant images. Use request_id=null for a new drawing, or resume an outstanding request ID after complements. Known measurements keep exact values, units and provenance. needs_data returns ALL blocking gaps: resolve reversible choices yourself; reuse existing Tasks/Steps or collect necessary measurements together in chat. Never treat retrieval failure as missing user data. Preserve earlier requirements and owner corrections. Resume the same request after saving complements; sources refresh. Only ready exposes save_cad_design; save the exact reviewed candidate.'
 where name='design_project_cad';
commit;
