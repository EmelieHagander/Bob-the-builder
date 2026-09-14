-- Project/Area phase foundation + scope-safe selected targets.
-- Product/UI contracts: Docs/project-phases.md + Docs/project-phase-ui.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create type bob.project_phase as enum ('concept','design','planning','build','complete');

alter table bob.projects add column phase bob.project_phase;
alter table bob.areas add column phase bob.project_phase;

create table bob.phase_history (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references bob.projects(id) on delete cascade,
  scope_kind text not null check(scope_kind in ('project','area')),
  area_id text references bob.areas(id) on delete cascade,
  from_phase bob.project_phase,
  to_phase bob.project_phase not null,
  reason text not null check(char_length(btrim(reason)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check((scope_kind='project' and area_id is null) or (scope_kind='area' and area_id is not null))
);
create index phase_history_project_idx on bob.phase_history(project_id, recorded_at desc);
create index phase_history_area_idx on bob.phase_history(area_id, recorded_at desc);
alter table bob.phase_history enable row level security;
revoke all on bob.phase_history from public,anon,authenticated;
grant select on bob.phase_history to authenticated;
create policy project_read on bob.phase_history for select to authenticated
  using(bob_private.has_project_access(project_id));

-- New projects start in Concept. Existing rows intentionally remain NULL until
-- a human classifies them; we never infer phase from dates/tasks/data volume.
create or replace function bob_private.create_project(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_project bob.projects;
  v_id text := 'p_' || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if coalesce(length(trim(p_input->>'name')), 0) not between 1 and 200 then
    raise exception 'invalid_project_name' using errcode = '22023';
  end if;
  insert into bob.projects(id,slug,name,description,location,type,theme,start_label,start_date,end_date,phase)
  values(v_id,v_id,trim(p_input->>'name'),coalesce(p_input->>'description',''),
    coalesce(p_input->>'location',''),coalesce(p_input->>'type',''),
    coalesce(p_input->>'theme','birch')::bob.theme_name,coalesce(p_input->>'start_label',''),
    (p_input->>'start_date')::date,(p_input->>'end_date')::date,'concept')
  returning * into v_project;
  insert into bob.people(id,project_id,name,initials,role,auth_user_id)
    values('m_' || replace(gen_random_uuid()::text, '-', ''),v_id,'Project creator','PC','Organiser',v_uid);
  insert into bob.phase_history(project_id,scope_kind,from_phase,to_phase,reason,recorded_by,actor_label)
    values(v_id,'project',null,'concept','Project created',v_uid,'Project creator');
  return to_jsonb(v_project);
end $$;

create or replace function bob_private.phase_command(
  p_project text,
  p_scope text,
  p_area text,
  p_phase text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  before bob.project_phase;
  after bob.project_phase;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_scope not in ('project','area')
    or p_phase not in ('concept','design','planning','build','complete')
    or coalesce(char_length(btrim(p_reason)),0) not between 1 and 1000 then
    raise exception 'Invalid phase command';
  end if;
  after := p_phase::bob.project_phase;
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  if p_scope='project' then
    if p_area is not null then raise exception 'Project phase does not accept an Area'; end if;
    select phase into before from bob.projects where id=p_project;
    if before is not distinct from after then raise exception 'Project is already in that phase'; end if;
    if after='complete' and exists(
      select 1 from bob.areas where project_id=p_project and phase is distinct from 'complete'::bob.project_phase
    ) then
      raise exception 'Complete or explicitly defer every Area before completing the Project.';
    end if;
    update bob.projects set phase=after where id=p_project;
    insert into bob.phase_history(project_id,scope_kind,area_id,from_phase,to_phase,reason,recorded_by,actor_label)
      values(p_project,'project',null,before,after,btrim(p_reason),uid,actor);
  else
    if p_area is null then raise exception 'Area phase requires an Area'; end if;
    select phase into before from bob.areas where id=p_area and project_id=p_project for update;
    if not found then raise exception 'project_denied' using errcode='42501'; end if;
    if before is not distinct from after then raise exception 'Area is already in that phase'; end if;
    update bob.areas set phase=after where id=p_area and project_id=p_project;
    insert into bob.phase_history(project_id,scope_kind,area_id,from_phase,to_phase,reason,recorded_by,actor_label)
      values(p_project,'area',p_area,before,after,btrim(p_reason),uid,actor);
  end if;
  return jsonb_build_object('scope',p_scope,'areaId',p_area,'phase',after::text);
end $$;
revoke all on function bob_private.phase_command(text,text,text,text,text) from public,anon,authenticated;
grant execute on function bob_private.phase_command(text,text,text,text,text) to authenticated;
create function bob.phase_command(
  p_project text,
  p_scope text,
  p_area text default null,
  p_phase text default null,
  p_reason text default null
) returns jsonb
language sql security invoker set search_path='' as $$
  select bob_private.phase_command(p_project,p_scope,p_area,p_phase,p_reason)
$$;
revoke all on function bob.phase_command(text,text,text,text,text) from public,anon;
grant execute on function bob.phase_command(text,text,text,text,text) to authenticated;

-- One Project can now have a Project-wide target plus independent Area targets.
-- Target revision numbers remain globally unique inside a Project so existing
-- Artifact/BOM foreign keys keep their exact historical lineage.
alter table bob.project_targets add column area_id text;
alter table bob.target_revisions add column area_id text;
alter table bob.project_targets add column scope_key text generated always as
  (case when area_id is null then 'project' else 'area:' || area_id end) stored;
alter table bob.target_revisions add column scope_key text generated always as
  (case when area_id is null then 'project' else 'area:' || area_id end) stored;

alter table bob.project_targets drop constraint if exists target_current_revision_fk;
alter table bob.project_targets drop constraint if exists project_targets_pkey;
alter table bob.project_targets add primary key(project_id,scope_key);
alter table bob.target_revisions add constraint target_revisions_scope_unique
  unique(project_id,scope_key,revision);
alter table bob.project_targets add constraint target_current_revision_fk
  foreign key(project_id,scope_key,current_revision)
  references bob.target_revisions(project_id,scope_key,revision)
  deferrable initially deferred;
create index project_targets_area_idx on bob.project_targets(project_id,area_id);
create index target_revisions_area_idx on bob.target_revisions(project_id,area_id,revision desc);

create or replace view bob.current_target with(security_invoker=true) as
select r.project_id,r.revision,r.solution_id,r.solution_revision,r.reason,
  r.recorded_by,r.actor_label,r.recorded_at,r.area_id,r.scope_key
from bob.project_targets h
join bob.target_revisions r
  on r.project_id=h.project_id and r.scope_key=h.scope_key and r.revision=h.current_revision;

-- Effective target: Area target wins when one has ever been set for that Area;
-- otherwise the Area inherits the Project target. A cleared Area target does not
-- silently fall back to the Project target.
create function bob_private.effective_target_revision(p_project text,p_area text)
returns integer language sql stable security invoker set search_path='' as $$
  select pt.current_revision
  from bob.project_targets pt
  where pt.project_id=p_project
    and (pt.area_id is not distinct from p_area or (p_area is not null and pt.area_id is null))
  order by case when pt.area_id is not distinct from p_area then 0 else 1 end
  limit 1
$$;
revoke all on function bob_private.effective_target_revision(text,text) from public,anon;
grant execute on function bob_private.effective_target_revision(text,text) to authenticated;

create or replace function bob_private.solution_command(
  p_project text,p_action text,p_solution uuid,p_expected integer,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid(); actor text; allowed text[];
  h bob.solutions; r bob.solution_revisions; t bob.target_revisions;
  n integer; target_version integer; area text; refs jsonb; ref jsonb; scope text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action is null or p_action not in ('create','revise','archive','restore','select','clear')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>24000 then raise exception 'Invalid solution command'; end if;
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
  allowed := case when p_action='create' then array['title','description','assumptions','tradeoffs','source_media_id','measurements','area_id']
    when p_action='revise' then array['title','description','assumptions','tradeoffs','source_media_id','measurements','change_note']
    when p_action='select' then array['reason','solution_revision','area_id']
    when p_action='clear' then array['reason','area_id'] else array[]::text[] end;
  if p_data-allowed<>'{}'::jsonb then raise exception 'Unsupported fields. Identity, parents and history cannot be rewritten.'; end if;

  if p_action in ('select','clear') then
    area := nullif(p_data->>'area_id','');
    scope := case when area is null then 'project' else 'area:'||area end;
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    select current_revision into target_version from bob.project_targets
      where project_id=p_project and scope_key=scope;
    target_version := coalesce(target_version,0);
    if p_expected is distinct from target_version then raise exception 'Target changed. Reload before deciding again.'; end if;
    if p_action='select' then
      select * into h from bob.solutions where id=p_solution and project_id=p_project;
      if not found then raise exception 'Solution unavailable'; end if;
      if (area is null and h.area_id is not null) or (area is not null and h.area_id is distinct from area) then
        raise exception 'Choose a solution from the same Project/Area scope.';
      end if;
      if h.current_revision is distinct from (p_data->>'solution_revision')::integer then raise exception 'Solution changed. Reload before selecting.'; end if;
      select * into r from bob.solution_revisions where solution_id=h.id and revision=h.current_revision;
      if r.archived then raise exception 'Restore this alternative before selecting it.'; end if;
    else
      if p_solution is not null then raise exception 'Clear does not accept a solution'; end if;
      select * into t from bob.target_revisions
        where project_id=p_project and scope_key=scope and revision=target_version;
      if not found or t.solution_id is null then raise exception 'There is no selected target to clear.'; end if;
    end if;
    select coalesce(max(revision),0)+1 into n from bob.target_revisions where project_id=p_project;
    insert into bob.target_revisions(project_id,revision,solution_id,solution_revision,reason,recorded_by,actor_label,area_id)
      values(p_project,n,h.id,h.current_revision,btrim(p_data->>'reason'),uid,actor,area);
    insert into bob.project_targets(project_id,current_revision,area_id)
      values(p_project,n,area)
      on conflict(project_id,scope_key) do update set current_revision=excluded.current_revision,area_id=excluded.area_id;
    return jsonb_build_object('revision',n,'areaId',area);
  end if;

  if p_solution is null then raise exception 'Solution identity required'; end if;
  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New alternatives start at revision zero'; end if;
    if exists(select 1 from bob.solutions where id=p_solution) then raise exception 'Alternative already exists. Reload before creating another.'; end if;
    area := nullif(p_data->>'area_id','');
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    insert into bob.solutions values(p_solution,p_project,area,1);
    n := 1;
  else
    select * into h from bob.solutions where id=p_solution and project_id=p_project;
    if not found then raise exception 'Solution unavailable'; end if;
    if p_expected is distinct from h.current_revision then raise exception 'Solution changed. Reload before saving again.'; end if;
    select * into r from bob.solution_revisions where solution_id=h.id and revision=h.current_revision;
    if (p_action in ('revise','archive') and r.archived) or (p_action='restore' and not r.archived) then raise exception 'Alternative state changed. Reload first.'; end if;
    if p_action='archive' and exists(select 1 from bob.current_target where project_id=p_project and solution_id=p_solution) then
      raise exception 'Choose another target or clear it before archiving this alternative.';
    end if;
    n := p_expected+1;
  end if;
  if p_action in ('create','revise') then
    r.title := btrim(p_data->>'title'); r.description := btrim(p_data->>'description');
    r.assumptions := btrim(coalesce(p_data->>'assumptions','')); r.tradeoffs := btrim(coalesce(p_data->>'tradeoffs',''));
    r.source_media_id := nullif(p_data->>'source_media_id','')::uuid; r.source_media_title := ''; r.archived := false;
    if r.source_media_id is not null then
      select title into r.source_media_title from bob.media_assets where id=r.source_media_id and project_id=p_project and state='ready' for share;
      if not found then raise exception 'Reference image unavailable in this project'; end if;
    end if;
    refs := coalesce(p_data->'measurements','[]'::jsonb);
    if jsonb_typeof(refs)<>'array' then raise exception 'Measurements must be a list'; end if;
    if jsonb_array_length(refs)>20 then raise exception 'Use up to 20 measurements per alternative version'; end if;
    for ref in select * from jsonb_array_elements(refs) loop
      if jsonb_typeof(ref)<>'object' or ref-array['id','revision']<>'{}'::jsonb then raise exception 'Invalid measurement reference'; end if;
      perform 1 from bob.measurement_revisions m where m.measurement_id=(ref->>'id')::uuid and m.revision=(ref->>'revision')::integer and m.project_id=p_project;
      if not found then raise exception 'Measurement version unavailable in this project'; end if;
    end loop;
  end if;
  r.solution_id := p_solution; r.project_id := p_project; r.revision := n;
  r.recorded_by := uid; r.actor_label := actor; r.recorded_at := clock_timestamp();
  r.change_note := case p_action when 'create' then 'Initial alternative' when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end;
  if p_action in ('archive','restore') then r.archived := (p_action='archive'); end if;
  insert into bob.solution_revisions select r.*;
  if p_action in ('archive','restore') then
    insert into bob.solution_measurements select project_id,solution_id,n,measurement_id,measurement_revision
      from bob.solution_measurements where solution_id=p_solution and solution_revision=p_expected;
  else
    insert into bob.solution_measurements select p_project,p_solution,n,(v->>'id')::uuid,(v->>'revision')::integer from jsonb_array_elements(refs) v;
  end if;
  update bob.solutions set current_revision=n where id=p_solution;
  return jsonb_build_object('id',p_solution,'revision',n);
end $$;
revoke all on function bob_private.solution_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.solution_command(text,text,uuid,integer,jsonb) to authenticated;

-- Guard downstream lineage against accidental cross-Area target use. Archive /
-- restore revisions preserve their historical target and intentionally bypass
-- the current-target check.
create or replace function bob_private.guard_artifact_target_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  area text;
  expected integer;
  target bob.target_revisions;
begin
  if new.change_note in ('Archived','Restored') then return new; end if;
  select a.area_id into area from bob.artifacts a
    where a.id=new.artifact_id and a.project_id=new.project_id;
  expected := bob_private.effective_target_revision(new.project_id,area);
  if expected is null or new.target_revision is distinct from expected then
    raise exception 'Selected target changed for this Project/Area. Reload before saving the drawing.';
  end if;
  select * into target from bob.target_revisions
    where project_id=new.project_id and revision=new.target_revision;
  if not found or target.solution_id is null
    or new.solution_id is distinct from target.solution_id
    or new.solution_revision is distinct from target.solution_revision then
    raise exception 'Drawing target lineage does not match the selected target for this scope.';
  end if;
  return new;
end $$;
drop trigger if exists artifact_target_scope_guard on bob.artifact_revisions;
create trigger artifact_target_scope_guard before insert on bob.artifact_revisions
  for each row execute function bob_private.guard_artifact_target_scope();

create or replace function bob_private.guard_material_target_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  expected integer;
  target bob.target_revisions;
begin
  if new.change_note in ('Archived','Restored') then return new; end if;
  expected := bob_private.effective_target_revision(new.project_id,new.area_id);
  if expected is null or new.target_revision is distinct from expected then
    raise exception 'Selected target changed for this Project/Area. Reload before saving the material requirement.';
  end if;
  select * into target from bob.target_revisions
    where project_id=new.project_id and revision=new.target_revision;
  if not found or target.solution_id is null
    or new.solution_id is distinct from target.solution_id
    or new.solution_revision is distinct from target.solution_revision then
    raise exception 'Material target lineage does not match the selected target for this scope.';
  end if;
  return new;
end $$;
drop trigger if exists material_target_scope_guard on bob.material_requirement_revisions;
create trigger material_target_scope_guard before insert on bob.material_requirement_revisions
  for each row execute function bob_private.guard_material_target_scope();

-- Staleness is now evaluated against the effective target for the requirement's
-- own Area, not against every target pointer in the Project.
create or replace view bob.current_material_requirements with(security_invoker=true) as
select h.id, r.*,
  (pt.current_revision is distinct from r.target_revision) as target_changed,
  (r.artifact_id is not null and (
    ah.current_revision is distinct from r.artifact_revision
    or ar.archived is distinct from false
  )) as artifact_changed,
  exists(
    select 1
    from bob.material_requirement_stock rs
    join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
    join bob.stock_revisions sr on sr.stock_id=sh.id and sr.revision=sh.current_revision
    where rs.requirement_id=h.id and rs.requirement_revision=h.current_revision
      and (sh.current_revision <> rs.stock_revision or sr.archived or sr.status <> 'available')
  ) as stock_changed,
  exists(
    select 1
    from bob.material_requirement_components rc
    join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
    join bob.component_revisions cr on cr.component_id=ch.id and cr.revision=ch.current_revision
    where rc.requirement_id=h.id and rc.requirement_revision=h.current_revision
      and (ch.current_revision <> rc.component_revision or cr.archived or cr.intent <> 'reuse' or cr.quantity is null)
  ) as component_changed
from bob.material_requirements h
join bob.material_requirement_revisions r
  on r.requirement_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
left join lateral (
  select p.current_revision
  from bob.project_targets p
  where p.project_id=h.project_id
    and (p.area_id is not distinct from r.area_id or (r.area_id is not null and p.area_id is null))
  order by case when p.area_id is not distinct from r.area_id then 0 else 1 end
  limit 1
) pt on true
left join bob.artifacts ah on ah.id=r.artifact_id and ah.project_id=h.project_id
left join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision;

notify pgrst,'reload schema';
commit;
