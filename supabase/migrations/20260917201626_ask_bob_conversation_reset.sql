-- Explicit, caller-owned reset. No project data or other users' threads change.
-- The provider cursor is disconnected, not a claim of provider-side erasure.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function bob_private.bob_reset_conversation(
  p_project text, p_expected_thread uuid, p_expected_next_seq bigint
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  thread bob.bob_threads;
  provider bob_private.bob_thread_provider_state;
begin
  if actor is null or p_project is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  -- The shared demo guest has no private server transcript to reset.
  if exists(select 1 from auth.users where id=actor and lower(email)='guest@bob.local') then
    return jsonb_build_object('status','cleared','mode','local','projectId',p_project);
  end if;

  -- Same lock and lock order as bob_claim_turn; a new claim cannot race deletion.
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || actor::text,0));
  select * into thread from bob.bob_threads
    where project_id=p_project and owner_user_id=actor and status='active' for update;
  if not found then
    return jsonb_build_object('status','cleared','mode','server','projectId',p_project);
  end if;
  -- Compare-and-swap: a retry/stale client must not clear a newer conversation
  -- or a turn completed after the client read the thread's revision.
  if thread.id is distinct from p_expected_thread
    or thread.next_seq is distinct from p_expected_next_seq then
    raise exception 'conversation_changed' using errcode='40001';
  end if;
  select * into provider from bob_private.bob_thread_provider_state
    where thread_id=thread.id for update;
  if provider.in_flight_turn_id is not null
    and provider.lock_started_at >= clock_timestamp()-interval '5 minutes' then
    raise exception 'turn_in_flight' using errcode='55000';
  end if;
  -- Recheck current authority at the write boundary, after acquiring locks.
  if not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  -- Existing FKs atomically remove messages and private continuation state.
  -- A late commit for an expired turn cannot target the next (new-id) thread.
  delete from bob.bob_threads where id=thread.id and owner_user_id=actor;
  return jsonb_build_object('status','cleared','mode','server','projectId',p_project);
end $$;
revoke all on function bob_private.bob_reset_conversation(text,uuid,bigint) from public,anon,authenticated;
grant execute on function bob_private.bob_reset_conversation(text,uuid,bigint) to authenticated;

-- Privileged implementation stays in the non-exposed schema. No raw table
-- write grants, user-id argument or provider identifiers are exposed.
create function bob.bob_reset_conversation(
  p_project text, p_expected_thread uuid, p_expected_next_seq bigint
) returns jsonb
language sql security invoker set search_path='' as $$
  select bob_private.bob_reset_conversation(p_project,p_expected_thread,p_expected_next_seq)
$$;
revoke all on function bob.bob_reset_conversation(text,uuid,bigint) from public,anon,authenticated;
grant execute on function bob.bob_reset_conversation(text,uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
