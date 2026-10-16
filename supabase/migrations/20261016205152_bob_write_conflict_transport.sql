-- PostgREST 14 retries SQLSTATE 40001 inside a single HTTP request. Bob must
-- receive an aborted write once, reread current data and reconsider its delta.
-- Translate at every active public writer boundary, leaving private domain
-- implementations, caller identity, RLS and the receipt transaction unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.bob_project_write_v16(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 -- The exception block rolls back the entire delegated write before returning.
 -- Even a genuine serialization/deadlock needs a fresh read, not an API retry
 -- with the same stale pins. Claim failures retain their terminal message.
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;

create or replace function bob.bob_project_write_v17(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.bob_project_write_v17(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 -- The exception block rolls back the entire delegated write before returning.
 -- Even a genuine serialization/deadlock needs a fresh read, not an API retry
 -- with the same stale pins. Claim failures retain their terminal message.
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;

create or replace function bob.bob_project_write_v18(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.bob_project_write_v18(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 -- The exception block rolls back the entire delegated write before returning.
 -- Even a genuine serialization/deadlock needs a fresh read, not an API retry
 -- with the same stale pins. Claim failures retain their terminal message.
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;

create or replace function bob.bob_project_write_v19(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.bob_project_write_v19(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 -- The exception block rolls back the entire delegated write before returning.
 -- Even a genuine serialization/deadlock needs a fresh read, not an API retry
 -- with the same stale pins. Claim failures retain their terminal message.
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;

create or replace function bob.bob_project_write_v20(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.bob_project_write_v20(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 -- The exception block rolls back the entire delegated write before returning.
 -- Even a genuine serialization/deadlock needs a fresh read, not an API retry
 -- with the same stale pins. Claim failures retain their terminal message.
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;

commit;
