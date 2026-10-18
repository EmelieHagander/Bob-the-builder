-- Owner decision 2026-10-18: drawing work has no application budget.
-- Every Bob job, including automatic drawing continuations of an older owner
-- message, now runs without spending or call allotments. The per-request
-- ledger stays only as a cost log and to reuse already paid results; pending
-- (uncertain) provider calls still block a duplicate paid attempt.
-- The owner-facing "Add request budget" grant is removed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob_private.bob_job_unlimited_work(p_job uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select p_job is not null
$$;
revoke all on function bob_private.bob_job_unlimited_work(uuid) from public,anon,authenticated,service_role;

create or replace function bob_private.bob_task_unlimited_work(p_project text,p_actor uuid,p_thread uuid,p_turn uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select true
$$;
revoke all on function bob_private.bob_task_unlimited_work(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Automatic drawing jobs inherit an unlimited owner job's pinned catalog. An
-- older owner message without one uses the active catalog, as before, and
-- now also runs without allotments.
create or replace function bob_private.bob_inherit_work_allowance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.drawing_request_id is not null then
  select j.ai_catalog_manifest_id into new.ai_catalog_manifest_id
  from bob_private.bob_jobs j where j.project_id=new.project_id and j.actor_id=new.actor_id and j.thread_id=new.thread_id
   and j.turn_id=new.turn_id and j.drawing_request_id is null and j.work_allowance_version=1 order by j.created_at desc limit 1;
  if new.ai_catalog_manifest_id is null then
   perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
   new.ai_catalog_manifest_id:=(shared.resolve_ai_catalog('bob')->>'manifest_id')::uuid;
  end if;
  new.work_allowance_version:=1;
 end if;
 return new;
end $$;
revoke all on function bob_private.bob_inherit_work_allowance() from public,anon,authenticated,service_role;

drop function bob.grant_drawing_budget(text,uuid,integer,uuid);
commit;
