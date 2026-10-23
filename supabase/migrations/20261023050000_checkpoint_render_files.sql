-- A reviewed CAD candidate's files (~0.7 MB) were rewritten in every turn
-- checkpoint until the drawing was saved (1.2 MB snapshots, 2026-10-22). Version 2
-- checkpoints name the immutable cad:render journal step instead; a resumed save
-- reads its files once through this claim-fenced read and verifies their hashes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Same fences as bob_checkpoint_steps_page. Only the files of successful render
-- results with this exact input fingerprint; never previews or other operations.
create function bob.bob_checkpoint_render_files(p_job uuid,p_claim uuid,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.checkpoint_version<>1 or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
  raise exception 'job_not_claimed' using errcode='PT409'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_render_fingerprint' using errcode='22023'; end if;
 select coalesce(jsonb_agg(s.value->'result'->'files' order by s.key),'[]'::jsonb) into result
 from bob_private.bob_job_steps s
 where s.job_id=p_job and s.key ~ '^cad:render:[0-9]+$' and s.fingerprint=p_fingerprint
  and s.value->'ok'='true'::jsonb and jsonb_typeof(s.value->'result'->'files')='object';
 return result;
end $$;
revoke all on function bob.bob_checkpoint_render_files(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob.bob_checkpoint_render_files(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
