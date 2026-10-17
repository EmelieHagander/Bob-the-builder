-- New pinned unlimited-work jobs have no application receipt-count quota.
-- Older jobs and synchronous legacy calls keep their original quota. The
-- private writers still enforce the same claim, project, domain and CAS rules.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.bob_turn_unlimited_work(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from bob_private.bob_jobs j
  where j.project_id=p_project and j.actor_id=auth.uid()
   and j.thread_id=p_thread and j.turn_id=p_turn and j.generation=p_generation
   and j.work_allowance_version=1 and j.status='running'
   and j.lease_until>clock_timestamp() and j.expires_at>clock_timestamp()
 );
$$;
revoke all on function bob_private.bob_turn_unlimited_work(text,uuid,uuid,bigint) from public,anon,authenticated,service_role;

-- Several domain writers are retained under names such as *_before_* after
-- later adapters delegate to them. Patch their exact quota predicate as well,
-- rather than only the newest public v16-v20 wrappers. CREATE OR REPLACE keeps
-- the signature, ACL, security mode, search path and every other statement.
do $unlimited_write_receipts$
declare fn regprocedure; body text; replacement text; changed integer:=0;
 quota text:='if[[:space:]]*(\(select count\(\*\) from bob_private\.bob_write_receipts where project_id=p_project and actor_id=auth\.uid\(\) and turn_id=p_turn\)>=(8|32)) then';
begin
 for fn in
  select p.oid::regprocedure from pg_proc p
  where p.pronamespace='bob_private'::regnamespace
   and p.proname like 'bob_project_write%'
   and position('write_budget_exhausted' in p.prosrc)>0
  order by p.proname
 loop
  body:=pg_get_functiondef(fn);
  replacement:=regexp_replace(body,quota,
   'if not bob_private.bob_turn_unlimited_work(p_project,p_thread,p_turn,p_generation) and \1 then','g');
  if replacement=body then raise exception 'Unexpected Bob receipt quota contract in %',fn;end if;
  execute replacement;
  changed:=changed+1;
 end loop;
 if changed=0 then raise exception 'No Bob receipt quota predicates found';end if;
end $unlimited_write_receipts$;
commit;
