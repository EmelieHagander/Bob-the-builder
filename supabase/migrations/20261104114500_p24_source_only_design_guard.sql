-- P2.4: Source-only revision transfer is not geometrical reconciliation.
-- The existing bounded change tool can change an old Construction and pin the
-- newer selected Solution together. Do not let its empty-change form silently
-- mark new design choices/features as built when no geometry was changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $p24_guard$
declare definition text; old text; changed text;
begin
 definition:=pg_get_functiondef('bob.prepare_construction_parameter_change(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 old:=$old$ draft jsonb; change jsonb; node jsonb; readiness jsonb; ids text[]:='{}'; msg text;$old$;
 changed:=$new$ draft jsonb; change jsonb; node jsonb; readiness jsonb; ids text[]:='{}'; msg text;
 old_choice jsonb; new_choice jsonb; old_feature jsonb; new_feature jsonb;
 old_solution uuid; new_solution uuid;$new$;
 if position(old in definition)=0 then raise exception 'p24_source_guard_declarations_changed'; end if;
 definition:=replace(definition,old,changed);
 old:=$old$  end if;
 end if;
 for change in select value from jsonb_array_elements(d->'changes') loop$old$;
 changed:=$new$  end if;
  -- An explicit target adoption with no parameter/geometry changes is safe
  -- only when the selected governing choices and features are unchanged.
  -- This does NOT certify fabrication; the old geometry and open questions stay.
  if jsonb_array_length(d->'changes')=0
   and d->'target_revision' is distinct from draft->'target_revision' then
    select o.design_intent->'choices',n.design_intent->'choices',
           o.design_intent->'features',n.design_intent->'features',
           o.solution_id,n.solution_id
      into old_choice,new_choice,old_feature,new_feature,old_solution,new_solution
    from bob.solution_revisions o
    join bob.target_revisions t on t.project_id=p_project
       and t.revision=(d->>'target_revision')::integer
    join bob.solution_revisions n on n.project_id=t.project_id
       and n.solution_id=t.solution_id and n.revision=t.solution_revision
    where o.project_id=p_project
      and o.solution_id=(draft->>'solution_id')::uuid
      and o.revision=(draft->>'solution_revision')::integer;
    if not found or old_solution is distinct from new_solution
      or jsonb_typeof(old_choice)<>'array' or jsonb_typeof(new_choice)<>'array'
      or jsonb_typeof(old_feature)<>'array' or jsonb_typeof(new_feature)<>'array'
      or old_choice is distinct from new_choice
      or old_feature is distinct from new_feature then
      return jsonb_build_object('status','needs_data',
        'reason','source_only_design_decisions_changed',
        'artifact_id',draft->'artifact_id','revision',draft->'revision',
        'saved_target_revision',draft->'target_revision',
        'selected_target_revision',d->'target_revision',
        'next_action','Use a bounded part or parameter edit with the exact selected target_revision to reconcile the changed design and the construction together. No source-only adoption was saved. Never infer legacy FORM mapping.');
    end if;
  end if;
 end if;
 for change in select value from jsonb_array_elements(d->'changes') loop$new$;
 if position(old in definition)=0 then raise exception 'p24_source_guard_branch_changed'; end if;
 execute replace(definition,old,changed);
end $p24_guard$;
notify pgrst,'reload schema';
commit;
