-- Manual milestone 4A. Contract: Docs/artifacts.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.artifacts (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  area_id text references bob.areas(id) on delete set null,
  current_revision integer not null check(current_revision > 0),
  unique(id, project_id)
);
create index artifacts_project_idx on bob.artifacts(project_id);
create index artifacts_area_idx on bob.artifacts(area_id);

create table bob.artifact_revisions (
  artifact_id uuid not null,
  project_id text not null,
  revision integer not null check(revision > 0),
  kind text not null check(kind in ('plan','elevation','section','detail')),
  title text not null check(char_length(btrim(title)) between 1 and 200),
  description text not null check(char_length(btrim(description)) between 1 and 6000),
  status text not null check(status in ('concept','measured','build_ready')),
  assumptions text not null default '' check(char_length(assumptions) <= 4000),
  source_media_id uuid references bob.media_assets(id) on delete set null,
  source_media_title text not null default '',
  target_revision integer not null check(target_revision > 0),
  solution_id uuid not null,
  solution_revision integer not null check(solution_revision > 0),
  solution_title text not null,
  archived boolean not null default false,
  change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(artifact_id, revision),
  foreign key(artifact_id, project_id) references bob.artifacts(id, project_id) on delete cascade,
  foreign key(project_id, target_revision) references bob.target_revisions(project_id, revision) on delete cascade,
  foreign key(solution_id, solution_revision) references bob.solution_revisions(solution_id, revision) on delete cascade
);
create index artifact_revisions_project_idx on bob.artifact_revisions(project_id);
create index artifact_revisions_parent_idx on bob.artifact_revisions(artifact_id, project_id);
create index artifact_revisions_image_idx on bob.artifact_revisions(source_media_id);
create index artifact_revisions_target_idx on bob.artifact_revisions(project_id, target_revision);
create index artifact_revisions_solution_idx on bob.artifact_revisions(solution_id, solution_revision);
alter table bob.artifacts add constraint artifact_current_revision_fk
  foreign key(id, current_revision) references bob.artifact_revisions(artifact_id, revision)
  deferrable initially deferred;
create index artifacts_current_idx on bob.artifacts(id, current_revision);

create table bob.artifact_measurements (
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  measurement_id uuid not null,
  measurement_revision integer not null,
  primary key(artifact_id, artifact_revision, measurement_id),
  foreign key(artifact_id, artifact_revision) references bob.artifact_revisions(artifact_id, revision) on delete cascade,
  foreign key(measurement_id, measurement_revision) references bob.measurement_revisions(measurement_id, revision) on delete cascade
);
create index artifact_measurements_project_idx on bob.artifact_measurements(project_id);
create index artifact_measurements_measure_idx on bob.artifact_measurements(measurement_id, measurement_revision);

alter table bob.artifacts enable row level security;
alter table bob.artifact_revisions enable row level security;
alter table bob.artifact_measurements enable row level security;
revoke all on bob.artifacts, bob.artifact_revisions, bob.artifact_measurements from public, anon, authenticated;
grant select on bob.artifacts, bob.artifact_revisions, bob.artifact_measurements to authenticated;
create policy project_read on bob.artifacts for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.artifact_revisions for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.artifact_measurements for select to authenticated
  using (bob_private.has_project_access(project_id));

create view bob.current_artifacts with(security_invoker=true) as
select h.id, h.area_id, r.*
from bob.artifacts h
join bob.artifact_revisions r
  on r.artifact_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id;

create view bob.artifact_measurement_details with(security_invoker=true) as
select l.*, r.subject, r.value::text as value, r.unit, r.truth, r.source,
  h.current_revision as latest_revision, c.archived as currently_archived
from bob.artifact_measurements l
join bob.measurement_revisions r
  on r.measurement_id=l.measurement_id and r.revision=l.measurement_revision and r.project_id=l.project_id
join bob.measurements h
  on h.id=l.measurement_id and h.project_id=l.project_id
join bob.measurement_revisions c
  on c.measurement_id=h.id and c.revision=h.current_revision;

revoke all on bob.current_artifacts, bob.artifact_measurement_details from public, anon, authenticated;
grant select on bob.current_artifacts, bob.artifact_measurement_details to authenticated;

create function bob_private.artifact_command(
  p_project text,
  p_action text,
  p_artifact uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  allowed text[];
  h bob.artifacts;
  r bob.artifact_revisions;
  target bob.target_revisions;
  n integer;
  area text;
  refs jsonb;
  ref jsonb;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('create','revise','archive','restore')
    or p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 24000 then
    raise exception 'Invalid artifact command';
  end if;

  -- Serialize target changes and artifact edits inside one project so a save
  -- cannot silently bind to a target selected after the editor was opened.
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  allowed := case
    when p_action='create' then array['title','description','kind','status','assumptions','source_media_id','measurements','area_id','target_revision']
    when p_action='revise' then array['title','description','kind','status','assumptions','source_media_id','measurements','change_note','target_revision']
    else array[]::text[]
  end;
  if p_data - allowed <> '{}'::jsonb then
    raise exception 'Unsupported fields. Identity, parents and history cannot be rewritten.';
  end if;

  if p_artifact is null then raise exception 'Artifact identity required'; end if;

  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New artifacts start at revision zero'; end if;
    if exists(select 1 from bob.artifacts where id=p_artifact) then
      raise exception 'Drawing already exists. Reload before creating another.';
    end if;
    area := nullif(p_data->>'area_id','');
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    insert into bob.artifacts values(p_artifact, p_project, area, 1);
    n := 1;
  else
    select * into h from bob.artifacts where id=p_artifact and project_id=p_project;
    if not found then raise exception 'Drawing unavailable'; end if;
    if p_expected is distinct from h.current_revision then
      raise exception 'Drawing changed. Reload before saving again.';
    end if;
    select * into r from bob.artifact_revisions where artifact_id=h.id and revision=h.current_revision;
    if (p_action in ('revise','archive') and r.archived)
      or (p_action='restore' and not r.archived) then
      raise exception 'Drawing state changed. Reload first.';
    end if;
    n := p_expected + 1;
  end if;

  if p_action in ('create','revise') then
    -- The client supplies only the target-decision revision it actually read.
    -- The server derives the exact solution revision from that decision and
    -- requires it still to be the project's current target.
    select tr.* into target
    from bob.project_targets pt
    join bob.target_revisions tr
      on tr.project_id=pt.project_id and tr.revision=pt.current_revision
    where pt.project_id=p_project
      and tr.revision=(p_data->>'target_revision')::integer;
    if not found then raise exception 'Project target changed. Reload before saving the drawing.'; end if;
    if target.solution_id is null then raise exception 'Choose a project target before saving a drawing.'; end if;

    r.title := btrim(p_data->>'title');
    r.description := btrim(p_data->>'description');
    r.kind := p_data->>'kind';
    r.status := p_data->>'status';
    r.assumptions := btrim(coalesce(p_data->>'assumptions',''));
    r.source_media_id := nullif(p_data->>'source_media_id','')::uuid;
    r.source_media_title := '';
    if r.source_media_id is not null then
      select title into r.source_media_title
      from bob.media_assets
      where id=r.source_media_id and project_id=p_project and state='ready'
      for share;
      if not found then raise exception 'Drawing image unavailable in this project'; end if;
    end if;

    r.target_revision := target.revision;
    r.solution_id := target.solution_id;
    r.solution_revision := target.solution_revision;
    select title into r.solution_title
    from bob.solution_revisions
    where solution_id=r.solution_id and revision=r.solution_revision and project_id=p_project;
    if not found then raise exception 'Selected solution version unavailable in this project'; end if;

    refs := coalesce(p_data->'measurements','[]'::jsonb);
    if jsonb_typeof(refs) <> 'array' then raise exception 'Measurements must be a list'; end if;
    if jsonb_array_length(refs) > 20 then raise exception 'Use up to 20 measurements per drawing version'; end if;
    for ref in select * from jsonb_array_elements(refs) loop
      if jsonb_typeof(ref) <> 'object' or ref-array['id','revision'] <> '{}'::jsonb then
        raise exception 'Invalid measurement reference';
      end if;
      perform 1 from bob.measurement_revisions m
      where m.measurement_id=(ref->>'id')::uuid
        and m.revision=(ref->>'revision')::integer
        and m.project_id=p_project;
      if not found then raise exception 'Measurement version unavailable in this project'; end if;
    end loop;
    r.archived := false;
  end if;

  r.artifact_id := p_artifact;
  r.project_id := p_project;
  r.revision := n;
  r.recorded_by := uid;
  r.actor_label := actor;
  r.recorded_at := clock_timestamp();
  r.change_note := case p_action
    when 'create' then 'Initial drawing'
    when 'archive' then 'Archived'
    when 'restore' then 'Restored'
    else btrim(p_data->>'change_note')
  end;
  if p_action in ('archive','restore') then r.archived := (p_action='archive'); end if;

  insert into bob.artifact_revisions select r.*;
  if p_action in ('archive','restore') then
    insert into bob.artifact_measurements
    select project_id, artifact_id, n, measurement_id, measurement_revision
    from bob.artifact_measurements
    where artifact_id=p_artifact and artifact_revision=p_expected;
  else
    insert into bob.artifact_measurements
    select p_project, p_artifact, n, (v->>'id')::uuid, (v->>'revision')::integer
    from jsonb_array_elements(refs) v;
  end if;
  update bob.artifacts set current_revision=n where id=p_artifact;
  return jsonb_build_object('id',p_artifact,'revision',n);
end $$;

revoke all on function bob_private.artifact_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.artifact_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.artifact_command(
  p_project text,
  p_action text,
  p_artifact uuid,
  p_expected integer,
  p_data jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.artifact_command(p_project,p_action,p_artifact,p_expected,p_data)
$$;
revoke all on function bob.artifact_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.artifact_command(text,text,uuid,integer,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
