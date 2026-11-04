-- P2.4: Avoid laundering a selected design decision into an old
-- Construction through a non-geometric edit. P1's physical affected-instance
-- count (n) is the authoritative piece detector; only n>0 may reconcile new
-- geometric decisions when the target pin changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $p24_facade_semantics$
declare body text; old text; replacement text;
begin
 body:=pg_get_functiondef('bob_private.enforce_construction_piece_revision()'::regprocedure);
 old:=$old$ axis text;one_lo numeric;one_hi numeric;piece_lo numeric;piece_hi numeric;$old$;
 replacement:=$new$ axis text;one_lo numeric;one_hi numeric;piece_lo numeric;piece_hi numeric;
 old_target integer; next_target integer; old_choice jsonb; next_choice jsonb;
 old_feature jsonb; next_feature jsonb; old_solution uuid; next_solution uuid;$new$;
 if position(old in body)=0 then raise exception 'p24_piece_semantic_variables_changed';end if;
 body:=replace(body,old,replacement);
 old:=$old$ if n>0 then
  if p.focus_step_id is distinct from policy.step_id then$old$;
 replacement:=$new$ -- An unchanged physical part graph cannot implement a changed design
 -- simply by advancing its Solution/target revision. P1 already determines n
 -- from exact changed instances, definitions, materials, roles and joint ends.
 if n=0 then
  select a.target_revision,b.target_revision,a.solution_id,b.solution_id,
         oa.design_intent->'choices',ob.design_intent->'choices',
         oa.design_intent->'features',ob.design_intent->'features'
    into old_target,next_target,old_solution,next_solution,
         old_choice,next_choice,old_feature,next_feature
  from bob.artifact_revisions a
  join bob.artifact_revisions b on b.artifact_id=a.artifact_id and b.project_id=a.project_id
     and b.revision=new.artifact_revision
  left join bob.solution_revisions oa on oa.project_id=a.project_id
     and oa.solution_id=a.solution_id and oa.revision=a.solution_revision
  left join bob.solution_revisions ob on ob.project_id=b.project_id
     and ob.solution_id=b.solution_id and ob.revision=b.solution_revision
  where a.project_id=new.project_id and a.artifact_id=new.artifact_id
    and a.revision=previous.artifact_revision;
  if not found then raise exception 'construction_piece_source_lineage_missing' using errcode='PT409';end if;
  if old_target is distinct from next_target and
    (old_solution is distinct from next_solution
     or jsonb_typeof(old_choice) is distinct from 'array'
     or jsonb_typeof(next_choice) is distinct from 'array'
     or jsonb_typeof(old_feature) is distinct from 'array'
     or jsonb_typeof(next_feature) is distinct from 'array'
     or old_choice is distinct from next_choice
     or old_feature is distinct from next_feature)
  then raise exception 'construction_piece_changed_design_without_geometry' using errcode='PT409';end if;
 end if;
 if n>0 then
  if p.focus_step_id is distinct from policy.step_id then$new$;
 if position(old in body)=0 then raise exception 'p24_piece_semantic_gate_changed';end if;
 execute replace(body,old,replacement);
end $p24_facade_semantics$;
commit;
