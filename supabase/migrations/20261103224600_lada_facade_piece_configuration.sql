-- Explicit operator-authored workpiece sequence for the one legacy project.
-- The owner's approved plan specifies seven windows reviewed one workpiece at
-- a time, but DOES NOT specify how many windows go on each facade.
-- This config sets review envelopes, NOT measured dimensions or completion.
-- No Construction row, target, Solution, Plan or Task is changed here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $lada_piece_scope$
declare
 project constant text:='p_54859d59bbea463bb5dea65fc22ce587';
 artifact constant uuid:='ed7c0d27-78b4-4ca6-a829-9d5580b456e7';
 focus_step constant uuid:='2c311ab7-5ee0-4702-9efc-6e0f39f98f57';
 opening_step constant uuid:='538598a3-7028-435b-b09e-fb384f618fb0';
begin
 perform 1 from bob.projects where id=project for no key update;
 if not found then raise exception 'lada_piece_project_changed';end if;
 if not exists(select 1 from bob.project_plans p where p.project_id=project
   and p.current_revision=2 and p.focus_step_id=focus_step)
  or not exists(select 1 from bob.project_plan_steps s where s.project_id=project
   and s.plan_revision=2 and s.step_id=opening_step and s.position=2
   and s.title='Placera och granska fasadöppningarna')
  then raise exception 'lada_piece_plan_changed';end if;
 if not exists(select 1 from bob.artifacts a join bob.artifact_construction_revisions c
   on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.current_revision
   where a.project_id=project and a.id=artifact and a.current_revision=4
   and jsonb_array_length(c.recipe->'instances')=78)
  then raise exception 'lada_piece_construction_changed';end if;
 if not exists(select 1 from bob.current_target t where t.project_id=project
   and t.revision=32 and t.solution_revision=24 and t.solution_id='2b655baa-13a6-4410-ad4f-eacfdee82b71'::uuid)
  then raise exception 'lada_piece_target_changed';end if;
 if exists(select 1 from bob_private.construction_piece_policies p where p.project_id=project)
  then raise exception 'lada_piece_policy_already_exists';end if;
 insert into bob_private.construction_piece_policies(project_id,artifact_id,plan_revision,step_id,max_affected_instances,requested_total_openings)
  values(project,artifact,2,opening_step,24,7);
 insert into bob_private.construction_piece_scopes(artifact_id,project_id,position,view_id,label,expected_openings,
  x_min,x_max,y_min,y_max,z_min,z_max) values
  (artifact,project,1,'front','Främre långsidan',null,-250,6250,-250,650,-400,4000),
  (artifact,project,2,'back','Bakre långsidan',null,-250,6250,2350,3250,-400,4000),
  (artifact,project,3,'left','Första gaveln',null,-250,650,-250,3250,-400,4000),
  (artifact,project,4,'right','Andra gaveln',null,5350,6250,-250,3250,-400,4000);
end $lada_piece_scope$;
commit;
