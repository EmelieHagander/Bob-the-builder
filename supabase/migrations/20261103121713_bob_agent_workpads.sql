-- Owner-approved private workpads for Bob, Konrad, Rita and Mattias.
-- The Supabase CLI migration generator crashes in this workspace (Bun 1.4.1);
-- this additive migration is authored directly. Apply only after reviewing the
-- exact target project and before publishing the separate catalog migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.bob_agent_workpads (
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  agent text not null check (agent in ('bob','structure','drawing','materials')),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  note jsonb not null check (jsonb_typeof(note)='object' and octet_length(note::text)<=8192),
  updated_by_turn uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(thread_id,agent)
);
alter table bob_private.bob_agent_workpads enable row level security;
revoke all on bob_private.bob_agent_workpads from public,anon,authenticated,service_role;

-- The actor and agent are bound by the trusted runtime. A current claimed turn
-- and project membership are required on *reads* as well as writes. A workpad
-- is replaceable, not append-only, and has no authority to approve project work.
create function bob.bob_agent_workpad(
  p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,
  p_agent text,p_expected_revision integer default null,p_note jsonb default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior bob_private.bob_agent_workpads;
  field text;
  item jsonb;
  limit_count integer;
  next_revision integer;
  exists_prior boolean;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_agent is null or p_agent not in ('bob','structure','drawing','materials') then
    raise exception 'invalid_workpad_agent' using errcode='22023';
  end if;
  select * into prior from bob_private.bob_agent_workpads
   where thread_id=p_thread and agent=p_agent for update;
  exists_prior:=found;
  if p_note is null then
    if p_expected_revision is not null then raise exception 'invalid_workpad_read' using errcode='22023'; end if;
    return jsonb_build_object('status','ok','agent',p_agent,
      'revision',case when exists_prior then prior.revision else 0 end,
      'note',case when exists_prior then prior.note else null end);
  end if;
  if jsonb_typeof(p_note) is distinct from 'object' then
    raise exception 'invalid_workpad_note' using errcode='22023';
  end if;
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>2147483645
    or octet_length(p_note::text)>8192
    or p_note-array['status','goal','next_step','steps','blockers','references'] <> '{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_note)) <> 6
    or jsonb_typeof(p_note->'status') is distinct from 'string'
    or p_note->>'status' not in ('working','waiting','done')
    or jsonb_typeof(p_note->'goal') is distinct from 'string' or char_length(p_note->>'goal')>500
    or jsonb_typeof(p_note->'next_step') is distinct from 'string' or char_length(p_note->>'next_step')>250
  then raise exception 'invalid_workpad_note' using errcode='22023'; end if;
  foreach field in array array['steps','blockers','references'] loop
    limit_count:=case when field='references' then 12 else 6 end;
    if jsonb_typeof(p_note->field) is distinct from 'array' then
      raise exception 'invalid_workpad_note' using errcode='22023';
    end if;
    if jsonb_array_length(p_note->field)>limit_count then
      raise exception 'invalid_workpad_note' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(p_note->field) loop
      if jsonb_typeof(item) is distinct from 'string' or char_length(item#>>'{}')>180 then
        raise exception 'invalid_workpad_note' using errcode='22023';
      end if;
    end loop;
  end loop;
  -- A lost response can be retried without changing the note or its revision.
  if prior.note is not distinct from p_note then
    return jsonb_build_object('status','noted','agent',p_agent,'revision',prior.revision,'unchanged',true);
  end if;
  if coalesce(prior.revision,0) <> p_expected_revision then
    return jsonb_build_object('status','conflict','agent',p_agent,'revision',coalesce(prior.revision,0),
      'current_note',prior.note,
      'message','The working note changed. Use the current revision and replace it deliberately.');
  end if;
  next_revision:=p_expected_revision+1;
  if exists_prior then
    update bob_private.bob_agent_workpads
      set note=p_note,revision=next_revision,updated_by_turn=p_turn,updated_at=clock_timestamp()
      where thread_id=p_thread and agent=p_agent;
  else
    insert into bob_private.bob_agent_workpads(thread_id,agent,revision,note,updated_by_turn)
      values(p_thread,p_agent,next_revision,p_note,p_turn);
  end if;
  return jsonb_build_object('status','noted','agent',p_agent,'revision',next_revision);
end $$;
revoke all on function bob.bob_agent_workpad(text,uuid,uuid,uuid,bigint,text,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_agent_workpad(text,uuid,uuid,uuid,bigint,text,integer,jsonb) to service_role;

commit;
