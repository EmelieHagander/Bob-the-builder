-- Owner decision 2026-11-07 (lean_construction_version 1), after the entry
-- turn: a part edit carries the FORM mapping code keeps in step with the
-- parts. Entry, 13:48 and 13:59: every stud added by an edit was refused with
-- form_instance_unmapped, because an edit could only inherit the saved
-- mapping and only a complete save could change it.
--
-- prepare_construction_edit accepts data.form_refinement; the edit writer
-- passes it to the construction write, whose existing readiness seam
-- validates the scope, stores the refinement for the new revision and lets
-- check_construction_form verify every part against it at commit.
--
-- The usage ledger also says when a cost is an estimate: a Claude answer cut
-- by our own deadline has no provider usage for its output, so its cost is
-- estimated from the streamed output (cost_basis = streamed_output_estimate)
-- instead of left unknown. A null cost_basis is the provider's own count.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $edit_form_mapping$
declare def text; anchor text; replacement text;
begin
  def:=pg_get_functiondef('bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb)'::regprocedure);
  anchor:=$a$d-array['key','change_note','changes','computed','target_revision','text']<>'{}'$a$;
  replacement:=$r$d-array['key','change_note','changes','computed','target_revision','text','form_refinement']<>'{}'$r$;
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'prepare_construction_edit_keys_changed'; end if;
  def:=replace(def,anchor,replacement);
  anchor:=$a$4+(case when d?'target_revision' then 1 else 0 end)+(case when d?'text' then 1 else 0 end)$a$;
  replacement:=$r$4+(case when d?'target_revision' then 1 else 0 end)+(case when d?'text' then 1 else 0 end)+(case when d?'form_refinement' then 1 else 0 end)
  or (d?'form_refinement' and jsonb_typeof(d->'form_refinement') is distinct from 'object')$r$;
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'prepare_construction_edit_count_changed'; end if;
  execute replace(def,anchor,replacement);

  def:=pg_get_functiondef('bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb)'::regprocedure);
  anchor:=$a$'instance_policy',expected->'instance_policy'))$a$;
  replacement:=$r$'instance_policy',expected->'instance_policy')||case when d?'form_refinement' then jsonb_build_object('form_refinement',d->'form_refinement') else '{}'::jsonb end)$r$;
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'construction_edit_writer_changed'; end if;
  execute replace(def,anchor,replacement);
end $edit_form_mapping$;

alter table shared.ai_usage_events add column cost_basis text
  check (cost_basis is null or cost_basis='streamed_output_estimate');
comment on column shared.ai_usage_events.cost_basis is
  'null: the provider reported the usage. streamed_output_estimate: an answer cut by our own deadline; output tokens and cost estimated from the streamed text, a lower bound.';

commit;
