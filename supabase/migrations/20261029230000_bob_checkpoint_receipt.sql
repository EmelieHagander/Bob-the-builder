-- Owner decision 2026-10-29: a checkpoint save answers with a short receipt.
-- bob_save_turn_checkpoint returned the whole stored packet (state and journal
-- state) on every save, only for the worker to compare it with what it had just
-- sent; it was the largest total in pg_stat_statements (2,514 calls, mean 186 ms,
-- 467 s). The receipt variant performs the identical checks and writes and
-- returns {receipt_version, job_id, revision, unchanged}. The old function stays
-- for older runtimes; the stored checkpoint format does not change, so a job can
-- move between runtimes mid-turn.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $checkpoint_receipt$
declare definition text; edit text[];
begin
 definition:=pg_get_functiondef('bob_private.bob_save_turn_checkpoint(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 -- Each anchor must exist exactly once in the current definition or the migration stops.
 foreach edit slice 1 in array array[
  array['FUNCTION bob_private.bob_save_turn_checkpoint(','FUNCTION bob_private.bob_save_turn_checkpoint_receipt('],
  array['and head.journal_state=p_journal_state then return bob_private.bob_checkpoint_packet(p_job); end if;
 if coalesce(head.revision,0)',
        'and head.journal_state=p_journal_state then return jsonb_build_object(''receipt_version'',1,''job_id'',p_job,''revision'',head.revision,''unchanged'',false); end if;
 if coalesce(head.revision,0)'],
  array['
 if head.state=p_state and head.journal_state=p_journal_state then return bob_private.bob_checkpoint_packet(p_job); end if;',
        '
 if head.state=p_state and head.journal_state=p_journal_state then return jsonb_build_object(''receipt_version'',1,''job_id'',p_job,''revision'',head.revision,''unchanged'',true); end if;'],
  array['checkpoint_progress+1 where id=p_job; end if;
 return bob_private.bob_checkpoint_packet(p_job);',
        'checkpoint_progress+1 where id=p_job; end if;
 return jsonb_build_object(''receipt_version'',1,''job_id'',p_job,''revision'',p_expected_revision+1,''unchanged'',false);']
 ] loop
  if (char_length(definition)-char_length(replace(definition,edit[1],'')))/char_length(edit[1])<>1 then
   raise exception 'checkpoint_receipt_anchor: %',left(edit[1],50); end if;
  definition:=replace(definition,edit[1],edit[2]);
 end loop;
 if position('bob_checkpoint_packet' in definition)>0 then raise exception 'checkpoint_receipt_packet_left'; end if;
 execute definition;
end $checkpoint_receipt$;

create function bob.bob_save_turn_checkpoint_receipt(p_job uuid,p_claim uuid,p_expected_revision bigint,p_state jsonb,p_journal_state jsonb)
returns jsonb language sql set search_path='' as
$$ select bob_private.bob_save_turn_checkpoint_receipt(p_job,p_claim,p_expected_revision,p_state,p_journal_state) $$;

revoke all on function bob_private.bob_save_turn_checkpoint_receipt(uuid,uuid,bigint,jsonb,jsonb),
 bob.bob_save_turn_checkpoint_receipt(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function bob_private.bob_save_turn_checkpoint_receipt(uuid,uuid,bigint,jsonb,jsonb),
 bob.bob_save_turn_checkpoint_receipt(uuid,uuid,bigint,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
