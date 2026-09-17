-- A late/failed Bob turn must release its private lock even if project access was
-- revoked while the provider was working. The service-role-only function checks
-- exact thread ownership/project identity but does not require current membership.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob.bob_fail_turn(
  p_project text,
  p_user uuid,
  p_thread uuid,
  p_turn uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_project is null or p_user is null or p_thread is null or p_turn is null then
    raise exception 'invalid_turn_failure';
  end if;
  if not exists(
    select 1 from bob.bob_threads
    where id=p_thread and project_id=p_project and owner_user_id=p_user and status='active'
  ) then
    raise exception 'turn_not_found';
  end if;

  update bob.bob_messages set delivery_state='failed',updated_at=clock_timestamp()
    where thread_id=p_thread and turn_id=p_turn and role='user' and delivery_state='pending';
  update bob_private.bob_thread_provider_state
    set in_flight_turn_id=null,lock_started_at=null,updated_at=clock_timestamp()
    where thread_id=p_thread and in_flight_turn_id=p_turn;
  return jsonb_build_object('status','failed','thread_id',p_thread);
end $$;
revoke all on function bob.bob_fail_turn(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function bob.bob_fail_turn(text,uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;