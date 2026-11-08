-- Read a private hint only while no later Bob write has changed its project.
-- Keep the original note and CAS revision; stale hints are not project facts.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function bob.bob_agent_workpad_current(
 p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_agent text,
 p_expected_revision integer default null,p_note jsonb default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; noted_at timestamptz;
begin
 -- Reuse the existing current-claim, project, actor and role fences.
 result:=bob.bob_agent_workpad(p_project,p_user,p_thread,p_turn,p_generation,p_agent,p_expected_revision,p_note);
 if p_note is not null then
  -- Deliberately reaffirming the same note after reading current sources is a
  -- new CAS revision. A retried old revision still returns unchanged.
  if result->>'status'='noted' and result->>'unchanged'='true'
   and (result->>'revision')::integer=p_expected_revision then
   update bob_private.bob_agent_workpads w set revision=revision+1,updated_by_turn=p_turn,updated_at=clock_timestamp()
    where w.thread_id=p_thread and w.agent=p_agent and exists(select 1 from bob_private.bob_write_receipts r
     where r.project_id=p_project and r.created_at>w.updated_at);
   if found then result:=(result-'unchanged')||jsonb_build_object('revision',p_expected_revision+1); end if;
  end if;
  return result;
 end if;
 select w.updated_at into noted_at from bob_private.bob_agent_workpads w
  where w.thread_id=p_thread and w.agent=p_agent;
 if noted_at is not null and exists(select 1 from bob_private.bob_write_receipts r
  where r.project_id=p_project and r.created_at>noted_at) then
  return result||jsonb_build_object('note',null,'freshness','project_changed','noted_at',noted_at);
 end if;
 return result||jsonb_build_object('freshness','no_later_bob_write','noted_at',noted_at);
end $$;
revoke all on function bob.bob_agent_workpad_current(text,uuid,uuid,uuid,bigint,text,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_agent_workpad_current(text,uuid,uuid,uuid,bigint,text,integer,jsonb) to service_role;
commit;
