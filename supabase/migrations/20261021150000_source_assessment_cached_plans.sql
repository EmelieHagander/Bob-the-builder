-- Cache the plans of the two heaviest source-assessment layers.
--
-- artifact_source_assessment_before_physical and _before_parameters are
-- LANGUAGE sql functions with SET clauses, so PostgreSQL 17 cannot inline them
-- and plans their large view joins again on every call. Measured on the
-- hosted database 2026-10-21 for the bunk-bed construction revision 14 as its
-- owner: 150 ms planning against 58 ms execution; the whole
-- read_construction_draft took ~180 ms, almost all of it here. Planning is
-- pure CPU on the shared instance, which is why the same read reached the 8 s
-- authenticated statement timeout under load and stopped CAD renders.
-- (20261021133800 optimised the outer _drawings layer, ~14 ms of the total.)
--
-- Each function is recreated from its installed body as plpgsql RETURN QUERY
-- with plan_cache_mode=force_generic_plan, so a pooled backend plans it once.
-- Rollback-only measurement: 88-89 ms per call before, 19 ms after the first
-- call. A rollback-only comparison over every artifact revision on the hosted
-- database returned identical results for both functions.
-- Name, arguments, result type, security (invoker), search_path, collapse
-- limits, owner and grants are unchanged. Re-running is a no-op.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $source_assessment_cached_plans$
declare f text; fn regprocedure; src text; lang text; converted integer:=0;
begin
 foreach f in array array['artifact_source_assessment_before_physical','artifact_source_assessment_before_parameters'] loop
  fn:=('bob_private.'||f||'(text,uuid,integer)')::regprocedure;
  select l.lanname, regexp_replace(p.prosrc, ';\s*$', '') into lang, src
   from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=fn;
  if lang='plpgsql' then continue; end if;
  if lang is distinct from 'sql' then raise exception 'source_assessment_unexpected_language: % %', f, lang; end if;
  execute format($fn$create or replace function bob_private.%I(p_project text, p_artifact uuid, p_revision integer)
   returns table(source_state text, source_reasons text[]) language plpgsql stable
   set search_path to '' set join_collapse_limit to '1' set from_collapse_limit to '1'
   set plan_cache_mode to 'force_generic_plan'
   as %L$fn$, f, E'#variable_conflict use_column\nbegin\n return query '||src||E';\nend');
  converted:=converted+1;
 end loop;
 raise notice 'source assessment cached plans: % functions converted', converted;
end $source_assessment_cached_plans$;
commit;
