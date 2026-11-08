-- Owner run Våningssäng 2, 2026-11-08: after Konrad's last construction
-- revision Mattias revised his material rows a second time in the same turn,
-- and 11 came back operation_reused. An operational write to an existing
-- record was keyed on the record alone, so it could be made once per turn; a
-- second revise with new numbers looked like a reused operation.
--
-- The key of a write to an existing record now names the revision it starts
-- from. An exact retry still reuses its receipt; a later revise of the same
-- record is its own operation. A different payload from the same revision is
-- still refused. Creates keep their key.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $operational_revise_key$
declare def text; anchor text; replacement text;
begin
  def:=pg_get_functiondef('bob_private.bob_project_write_v12(text,uuid,uuid,bigint,jsonb)'::regprocedure);
  anchor:=$a$coalesce(rid,lower(btrim(coalesce(f->>'name',f->>'label',f->>'title',f->>'prerequisite_task_id','review'))));$a$;
  replacement:=$r$coalesce(rid,lower(btrim(coalesce(f->>'name',f->>'label',f->>'title',f->>'prerequisite_task_id','review'))))||case when rid is null then '' else '@'||expected end;$r$;
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'operational_key_changed'; end if;
  -- The key must be built after the expected revision is read.
  if position('expected:=(p_payload->>''expected_revision'')::integer;' in def)=0
   or position('expected:=(p_payload->>''expected_revision'')::integer;' in def)>position(anchor in def) then raise exception 'operational_expected_moved'; end if;
  execute replace(def,anchor,replacement);
end $operational_revise_key$;

commit;
