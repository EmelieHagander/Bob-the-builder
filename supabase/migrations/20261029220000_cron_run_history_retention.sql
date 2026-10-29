-- Owner decision 2026-10-29: keep pg_cron run history for 7 days.
-- cron.job_run_details held 274,975 rows (76 MB) from 2026-07-10, growing by
-- about 7,200 rows a day from the per-minute and 30-second jobs of every app in
-- this shared project. pg_cron never prunes it. The delete covers every app's
-- history, not only Bob's; 7 days is enough to diagnose a recent failure.
-- Runs once now and then daily at 03:23 UTC. No data outside cron's own run log
-- is touched. Databases without pg_cron's run log (local tests) skip it.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $retention$
begin
 if to_regclass('cron.job_run_details') is null then return; end if;
 delete from cron.job_run_details where coalesce(end_time,start_time) < now()-interval '7 days';
 perform cron.schedule('cron-run-history-retention','23 3 * * *',
  $job$delete from cron.job_run_details where coalesce(end_time,start_time) < now()-interval '7 days'$job$);
end $retention$;
commit;
