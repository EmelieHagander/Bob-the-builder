-- CAD drawings carry the construction's fastener schedule (owner decisions
-- 2026-10-26, B2).
--
-- The CAD worker draws the schedule of the pinned construction revision on
-- its sheets and returns annotations version 2 carrying it verbatim. The
-- schedule is a rule-of-thumb proposal from fixed rules, not a strength
-- calculation (20261026170000_construction_fasteners.sql).
--
-- Publication accepts:
--  * version 1 without a schedule, exactly as before;
--  * version 2 only when annotations.fasteners equals
--    bob_private.construction_fastener_schedule_for the pinned construction
--    revision (with its instance policy), so a drawing cannot carry an edited or another revision's
--    schedule.
-- Saved drawings stay valid. Archive/restore copies keep their exemption: the
-- validator returns before this check for an exact lifecycle copy.
--
-- bob_private.validate_cad_construction_source is recreated from its installed
-- body with one guarded replace; a changed body fails loudly.
-- Runtime order: CAD worker (accepts the schedule), then this migration, then
-- the Edge functions that send the schedule.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
declare fn regprocedure:='bob_private.validate_cad_construction_source()'::regprocedure; def text;
 old_check constant text:=$q$new.manifest->'annotations'->'version' is distinct from '1'::jsonb or new.manifest->'annotations'->>'coverage' is distinct from 'complete'$q$;
 new_check constant text:=$q$(case new.manifest->'annotations'->'version'
   when '1'::jsonb then new.manifest->'annotations' ? 'fasteners'
   when '2'::jsonb then new.manifest->'annotations'->'fasteners' is distinct from bob_private.construction_fastener_schedule_for(source)
   else true end) or new.manifest->'annotations'->>'coverage' is distinct from 'complete'$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_check in def)=0 then raise exception 'cad_fastener_annotations_validator_changed'; end if;
 execute replace(def,old_check,new_check);
end $$;

commit;
