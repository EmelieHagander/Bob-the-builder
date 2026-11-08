-- A bounded, reusable construction-review seam. An approved Plan Step and
-- exact Construction source own operator-reviewed spatial workpiece envelopes.
-- The next facade is selected from what actually changed, not a guessed count.
-- All geometry writes are checked inside their transaction; a review is
-- evidence about the shown revision/view, not FORM or technical certification.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.construction_piece_policies(
 project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null,
 plan_revision integer not null check(plan_revision>0),
 step_id uuid not null,
 max_affected_instances integer not null default 24 check(max_affected_instances between 1 and 128),
 max_piece_run_mm numeric not null default 2200 check(max_piece_run_mm between 200 and 5000),
 requested_total_openings integer check(requested_total_openings between 1 and 64),
 primary key(artifact_id,project_id),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(project_id,plan_revision,step_id) references bob.project_plan_steps(project_id,plan_revision,step_id)
);
create table bob_private.construction_piece_scopes(
 artifact_id uuid not null,project_id text not null,position integer not null check(position>0),
 view_id text not null check(view_id in ('front','back','left','right','top')),
 label text not null check(char_length(btrim(label)) between 1 and 160),
 -- Unknown distribution is intentionally NULL until confirmed by the design.
 expected_openings integer check(expected_openings between 0 and 32),
 x_min numeric not null,x_max numeric not null,y_min numeric not null,y_max numeric not null,z_min numeric not null,z_max numeric not null,
 primary key(artifact_id,project_id,position),
 unique(artifact_id,project_id,view_id),
 foreign key(artifact_id,project_id) references bob_private.construction_piece_policies(artifact_id,project_id) on delete cascade,
 check(x_min<x_max and y_min<y_max and z_min<z_max)
);
create table bob_private.construction_piece_attempts(
 artifact_id uuid not null,project_id text not null,artifact_revision integer not null,
 position integer not null,view_id text not null,
 state text not null check(state in ('awaiting_review','correction_requested','accepted')),
 feedback_id uuid references bob.solution_model_feedback(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(artifact_id,artifact_revision),
 foreign key(artifact_id,project_id,position) references bob_private.construction_piece_scopes(artifact_id,project_id,position),
 foreign key(project_id,artifact_id,artifact_revision) references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision)
);
create index construction_piece_attempts_project on bob_private.construction_piece_attempts(project_id,artifact_id,artifact_revision desc);
alter table bob_private.construction_piece_policies enable row level security;
alter table bob_private.construction_piece_scopes enable row level security;
alter table bob_private.construction_piece_attempts enable row level security;
revoke all on bob_private.construction_piece_policies,bob_private.construction_piece_scopes,bob_private.construction_piece_attempts from public,anon,authenticated,service_role;

-- Existing box geometry determines a physical envelope; an AI-supplied part
-- name, workpad claim or comment is never treated as evidence of scope.
create function bob_private.construction_box_in_piece(i jsonb,d jsonb,s bob_private.construction_piece_scopes)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(d->>'primitive'='box'
  and (i#>>'{placement,rx}')::numeric=0 and (i#>>'{placement,ry}')::numeric=0 and (i#>>'{placement,rz}')::numeric=0
  and (i#>>'{placement,x}')::numeric>=s.x_min and (i#>>'{placement,x}')::numeric+(d->>'x_mm')::numeric<=s.x_max
  and (i#>>'{placement,y}')::numeric>=s.y_min and (i#>>'{placement,y}')::numeric+(d->>'y_mm')::numeric<=s.y_max
  and (i#>>'{placement,z}')::numeric>=s.z_min and (i#>>'{placement,z}')::numeric+(d->>'z_mm')::numeric<=s.z_max,false)
$$;
revoke all on function bob_private.construction_box_in_piece(jsonb,jsonb,bob_private.construction_piece_scopes) from public,anon,authenticated,service_role;

create function bob_private.enforce_construction_piece_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare policy bob_private.construction_piece_policies;
 previous bob.artifact_construction_revisions; previous_attempt bob_private.construction_piece_attempts;
 p bob.project_plans; item record; joint record; role record;
 old_inst jsonb;new_inst jsonb;old_def jsonb;new_def jsonb;old_mat jsonb;new_mat jsonb;
 old_roles jsonb;new_roles jsonb;affected text[]:='{}';n integer:=0;part_id text;
 matches integer;matched_position integer;chosen_position integer;chosen_view text;
 axis text;one_lo numeric;one_hi numeric;piece_lo numeric;piece_hi numeric;
begin
 select * into policy from bob_private.construction_piece_policies
  where project_id=new.project_id and artifact_id=new.artifact_id for update;
 if not found then return new;end if;
 select * into p from bob.project_plans where project_id=new.project_id;
 if p.current_revision is distinct from policy.plan_revision then raise exception 'construction_piece_plan_changed' using errcode='PT409';end if;
 select * into previous from bob.artifact_construction_revisions
  where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if not found then raise exception 'construction_piece_baseline_missing' using errcode='PT409';end if;
 select * into previous_attempt from bob_private.construction_piece_attempts
  where project_id=new.project_id and artifact_id=new.artifact_id order by artifact_revision desc limit 1;
 if found and previous_attempt.state='awaiting_review' then
  raise exception 'construction_piece_review_required' using errcode='PT409';
 end if;

 -- Include changed joint endpoints even if their boxes are otherwise identical.
 for joint in select o.value as before,n.value as after from jsonb_array_elements(previous.joints) o
  full join jsonb_array_elements(new.joints) n on n.value->>'id'=o.value->>'id' loop
  if joint.before is distinct from joint.after then
   affected:=affected||array[joint.before#>>'{first,instance_id}',joint.before#>>'{second,instance_id}',
    joint.after#>>'{first,instance_id}',joint.after#>>'{second,instance_id}'];
  end if;
 end loop;
 select r.policy into old_roles from bob.artifact_construction_instance_policies r
  where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=previous.artifact_revision;
 select r.policy into new_roles from bob.artifact_construction_instance_policies r
  where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision;
 if old_roles is distinct from new_roles then
  for role in select o.value as before,n.value as after from jsonb_array_elements(coalesce(old_roles->'instances','[]'::jsonb)) o
   full join jsonb_array_elements(coalesce(new_roles->'instances','[]'::jsonb)) n on n.value->>'instance_id'=o.value->>'instance_id' loop
   if role.before is distinct from role.after then affected:=affected||array[coalesce(role.before->>'instance_id',role.after->>'instance_id')];end if;
  end loop;
 end if;

 for item in select o.value as before,n.value as after from jsonb_array_elements(previous.recipe->'instances') o
  full join jsonb_array_elements(new.recipe->'instances') n on n.value->>'id'=o.value->>'id' loop
  old_inst:=item.before;new_inst:=item.after;part_id:=coalesce(old_inst->>'id',new_inst->>'id');
  select value into old_def from jsonb_array_elements(previous.recipe->'definitions') where value->>'id'=old_inst->>'definition_id';
  select value into new_def from jsonb_array_elements(new.recipe->'definitions') where value->>'id'=new_inst->>'definition_id';
  select value into old_mat from jsonb_array_elements(previous.materials) where value->>'definition_id'=old_inst->>'definition_id';
  select value into new_mat from jsonb_array_elements(new.materials) where value->>'definition_id'=new_inst->>'definition_id';
  if old_inst is not distinct from new_inst and old_def is not distinct from new_def
   and old_mat is not distinct from new_mat and not coalesce(part_id=any(affected),false) then continue;end if;
  n:=n+1;
  if n>policy.max_affected_instances then raise exception 'construction_piece_too_large' using errcode='PT409';end if;
  -- A changed part must be within exactly one facade, before AND after.
  select count(*)::integer,min(s.position) into matches,matched_position
   from bob_private.construction_piece_scopes s
   where s.project_id=new.project_id and s.artifact_id=new.artifact_id
    and (old_inst is null or bob_private.construction_box_in_piece(old_inst,old_def,s))
    and (new_inst is null or bob_private.construction_box_in_piece(new_inst,new_def,s));
  if matches<>1 then raise exception 'construction_piece_outside_or_ambiguous_facade' using errcode='PT409';end if;
  if chosen_position is null then chosen_position:=matched_position;
  elsif chosen_position<>matched_position then raise exception 'construction_piece_multiple_facades' using errcode='PT409';end if;
  select s.view_id into chosen_view from bob_private.construction_piece_scopes s
   where s.project_id=new.project_id and s.artifact_id=new.artifact_id and s.position=chosen_position;
  -- Distinct windows widely separated on the same wall are distinct workpieces.
  -- This is only a geometric bound, never proof that exactly one opening exists.
  axis:=case when chosen_view in ('left','right') then 'y' else 'x' end;
  if old_inst is not null then
   one_lo:=(old_inst->'placement'->>axis)::numeric;
   one_hi:=one_lo+(old_def->>(axis||'_mm'))::numeric;
   piece_lo:=least(coalesce(piece_lo,one_lo),one_lo);
   piece_hi:=greatest(coalesce(piece_hi,one_hi),one_hi);
  end if;
  if new_inst is not null then
   one_lo:=(new_inst->'placement'->>axis)::numeric;
   one_hi:=one_lo+(new_def->>(axis||'_mm'))::numeric;
   piece_lo:=least(coalesce(piece_lo,one_lo),one_lo);
   piece_hi:=greatest(coalesce(piece_hi,one_hi),one_hi);
  end if;
  if piece_hi-piece_lo>policy.max_piece_run_mm then raise exception 'construction_piece_too_spread_out' using errcode='PT409';end if;
 end loop;
 if n>0 then
  if p.focus_step_id is distinct from policy.step_id then raise exception 'construction_piece_step_not_focused' using errcode='PT409';end if;
  if previous_attempt.state='correction_requested' and previous_attempt.position is distinct from chosen_position
   then raise exception 'construction_piece_correction_must_match_facade' using errcode='PT409';end if;
  select s.view_id into chosen_view from bob_private.construction_piece_scopes s
   where s.project_id=new.project_id and s.artifact_id=new.artifact_id and s.position=chosen_position;
  insert into bob_private.construction_piece_attempts(artifact_id,project_id,artifact_revision,position,view_id,state)
   values(new.artifact_id,new.project_id,new.artifact_revision,chosen_position,chosen_view,'awaiting_review');
 elsif p.focus_step_id=policy.step_id and previous.parameters is distinct from new.parameters then
  raise exception 'construction_piece_parameter_effects_unbounded' using errcode='PT409';
 end if;
 return new;
end $$;
revoke all on function bob_private.enforce_construction_piece_revision() from public,anon,authenticated,service_role;
-- Runs after the normal inherited role and FORM tables are installed.
create constraint trigger z_enforce_construction_piece after insert on bob.artifact_construction_revisions
 deferrable initially deferred for each row execute function bob_private.enforce_construction_piece_revision();

-- The existing claimed-turn feedback writer already binds actor, source and
-- presentation. Only the exact latest shown facade/revision can release a hold.
create function bob_private.advance_construction_piece_from_feedback() returns trigger
language plpgsql security definer set search_path='' as $$
declare shown bob.solution_presentations; attempt bob_private.construction_piece_attempts;
begin
 select * into shown from bob.solution_presentations where project_id=new.project_id and id=new.presentation_id;
 if not found or shown.representation<>'construction_3d' then return new;end if;
 select * into attempt from bob_private.construction_piece_attempts where project_id=new.project_id and artifact_id=shown.artifact_id
  order by artifact_revision desc limit 1 for update;
 if not found or attempt.artifact_revision<>shown.artifact_revision or attempt.view_id<>shown.view_id
  or attempt.state not in ('awaiting_review','correction_requested')
  or not bob_private.solution_presentation_current(shown) then return new;end if;
 if new.outcome='accepted' and new.scope='whole_model' then
  update bob_private.construction_piece_attempts set state='accepted',feedback_id=new.id
   where artifact_id=attempt.artifact_id and artifact_revision=attempt.artifact_revision;
 elsif new.outcome='change_requested' then
  update bob_private.construction_piece_attempts set state='correction_requested',feedback_id=new.id
   where artifact_id=attempt.artifact_id and artifact_revision=attempt.artifact_revision;
 end if;
 return new;
end $$;
revoke all on function bob_private.advance_construction_piece_from_feedback() from public,anon,authenticated,service_role;
create trigger construction_piece_feedback after insert on bob.solution_model_feedback
 for each row execute function bob_private.advance_construction_piece_from_feedback();

create function bob.read_construction_piece_progress(p_project text,p_artifact uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare policy bob_private.construction_piece_policies;
 attempt bob_private.construction_piece_attempts;p bob.project_plans; facades jsonb;policy_count integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_artifact is null then
  select count(*)::integer into policy_count from bob_private.construction_piece_policies where project_id=p_project;
  if policy_count=0 then return jsonb_build_object('status','not_configured');end if;
  if policy_count<>1 then return jsonb_build_object('status','ambiguous');end if;
 end if;
 select * into policy from bob_private.construction_piece_policies where project_id=p_project
  and (p_artifact is null or artifact_id=p_artifact);
 if not found then return jsonb_build_object('status','not_configured');end if;
 select * into p from bob.project_plans where project_id=p_project;
 select coalesce(jsonb_agg(jsonb_build_object('view_id',s.view_id,'label',s.label,'expected_openings',s.expected_openings)
  order by s.position),'[]'::jsonb) into facades from bob_private.construction_piece_scopes s
   where s.project_id=p_project and s.artifact_id=policy.artifact_id;
 select * into attempt from bob_private.construction_piece_attempts where project_id=p_project and artifact_id=policy.artifact_id
  order by artifact_revision desc limit 1;
 return jsonb_build_object('status',case when p.current_revision is distinct from policy.plan_revision then 'plan_changed'
  when attempt.state='awaiting_review' then 'awaiting_review'
  when attempt.state='correction_requested' then 'correction_requested'
  when p.focus_step_id is distinct from policy.step_id then 'not_focused' else 'ready' end,
  'artifact_id',policy.artifact_id,'plan_revision',policy.plan_revision,'step_id',policy.step_id,
  'focus_step_id',p.focus_step_id,'requested_total_openings',policy.requested_total_openings,'facades',facades,
  'pending_view',case when attempt.state in ('awaiting_review','correction_requested') then attempt.view_id end,
  'saved_revision',case when attempt.state in ('awaiting_review','correction_requested') then attempt.artifact_revision end,
  'last_feedback_state',attempt.state,
  'reviewed_saves',(select count(*) from bob_private.construction_piece_attempts a
   where a.artifact_id=policy.artifact_id and a.state='accepted'),
  'verification','unverified','opening_count_not_inferred',true,'form_mapping_not_inferred',true);
end $$;
revoke all on function bob.read_construction_piece_progress(text,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_piece_progress(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
