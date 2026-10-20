-- Stop PostgREST's infinite transaction retries on Bob's custom conflicts.
--
-- PostgREST 14 (the version serving this project) retries a request's
-- transaction without limit when a function raises SQLSTATE 40001, which Bob
-- used for every custom conflict (`job_not_claimed`, `record_changed`, ...).
-- Observed 2026-10-20: one stale bob-worker claim made `bob_save_job_step` and
-- `bob_yield_job` fail about 1,500 times per second for the rest of the day
-- (4.1 million `job_not_claimed` log lines, 59 million rolled-back
-- transactions), which pushed `read_construction_draft` past the 8 s
-- authenticated statement timeout and made CAD renders report
-- `construction_read_unavailable`. The 2026-10-16 write-conflict transport
-- translated 40001 at the public write boundaries only; the job lifecycle
-- commands were still raising it.
-- Reference: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
--
-- Every bob-owned function (schemas bob, bob_private, bob_volunteer_private)
-- that raises with errcode='40001' is recreated from its installed definition
-- with errcode='PT409' instead. Messages, bodies, grants and ownership are
-- unchanged. PT409 is already what the public transports produce, and the
-- edge code treats 'PT409' as a conflict wherever it treated '40001'. Existing
-- `when serialization_failure` handlers keep catching genuine serialization
-- failures and simply no longer see the custom ones.
--
-- At installation on 2026-10-20 this touches 68 functions (151 raises):
-- bob.bob_checkpoint_steps_page, bob.bob_context_index_save,
-- bob.bob_describe_image, bob.bob_drawing_budget, bob.bob_drawing_request,
-- bob.bob_job_steps_page, bob.bob_record_image_provider_file,
-- bob.bob_refresh_context_summary, bob.bob_save_context_summary,
-- bob.ensure_drawing_gap_task, bob.link_drawing_gap,
-- bob_private.area_lifecycle_command, bob_private.artifact_*_command,
-- bob_private.assert_drawing_recovery_current, bob_private.bob_assert_*_claim,
-- bob_private.bob_claim_job, bob_private.bob_finish_*_job*,
-- bob_private.bob_job_reusable_models, bob_private.bob_pause_job,
-- bob_private.bob_project_write* (all installed versions),
-- bob_private.bob_reset_conversation, bob_private.bob_save_job_step,
-- bob_private.bob_save_turn_checkpoint, bob_private.bob_yield_job,
-- bob_private.cad_shell_command, bob_private.cancel_drawing_request,
-- bob_private.catalog_save, bob_private.check_cad_parameter_graph,
-- bob_private.create_drawing_request, bob_private.project_plan_*,
-- bob_private.respond_project_invitation, bob_private.restore_drawing_request,
-- bob_private.set_building_household, bob_private.set_project_household,
-- bob_private.task_steps_command, bob_private.validate_cad_parameter_lineage,
-- bob_volunteer_private.create_volunteer_link, bob_volunteer_private.volunteer_profile,
-- bob_volunteer_private.volunteer_task_action.
-- The loop discovers the installed set so that a database with a different
-- migration history is corrected completely too. Re-running is a no-op.
--
-- Requests already looping inside PostgREST re-execute the same call on their
-- next retry, hit the replaced function, receive PT409 and stop.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $bob_conflict_sqlstate$
declare target record; def text; touched integer:=0; remaining text;
begin
 for target in
  select p.oid, p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('bob','bob_private','bob_volunteer_private')
   and p.prosrc like '%errcode=''40001''%'
  order by n.nspname, p.proname
 loop
  def:=pg_get_functiondef(target.oid);
  execute replace(def,'errcode=''40001''','errcode=''PT409''');
  touched:=touched+1;
 end loop;
 raise notice 'bob conflict sqlstate: % functions now raise PT409 instead of 40001', touched;
 select string_agg(p.oid::regprocedure::text, ', ' order by 1) into remaining
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('bob','bob_private','bob_volunteer_private') and p.prosrc like '%40001%';
 if remaining is not null then
  raise exception 'bob_conflict_sqlstate_incomplete: %', remaining;
 end if;
end $bob_conflict_sqlstate$;
commit;
