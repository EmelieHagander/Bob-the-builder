-- Manual milestone 3A. Contract: Docs/solutions.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.solutions (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  area_id text references bob.areas(id) on delete set null,
  current_revision integer not null check(current_revision > 0),
  unique(id,project_id)
);
create index solutions_project_idx on bob.solutions(project_id);
create index solutions_area_idx on bob.solutions(area_id);
create table bob.solution_revisions (
  solution_id uuid not null,
  project_id text not null,
  revision integer not null check(revision > 0),
  title text not null check(char_length(btrim(title)) between 1 and 200),
  description text not null check(char_length(btrim(description)) between 1 and 6000),
  assumptions text not null default '' check(char_length(assumptions)<=4000),
  tradeoffs text not null default '' check(char_length(tradeoffs)<=4000),
  source_media_id uuid references bob.media_assets(id) on delete set null,
  source_media_title text not null default '',
  archived boolean not null default false,
  change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(solution_id,revision),
  foreign key(solution_id,project_id) references bob.solutions(id,project_id) on delete cascade
);
create index solution_revisions_project_idx on bob.solution_revisions(project_id);
create index solution_revisions_parent_idx on bob.solution_revisions(solution_id,project_id);
create index solution_revisions_image_idx on bob.solution_revisions(source_media_id);
alter table bob.solutions add constraint solution_current_revision_fk
  foreign key(id,current_revision) references bob.solution_revisions(solution_id,revision) deferrable initially deferred;
create index solutions_current_idx on bob.solutions(id,current_revision);

create table bob.solution_measurements (
  project_id text not null references bob.projects(id) on delete cascade,
  solution_id uuid not null,
  solution_revision integer not null,
  measurement_id uuid not null,
  measurement_revision integer not null,
  primary key(solution_id,solution_revision,measurement_id),
  foreign key(solution_id,solution_revision) references bob.solution_revisions(solution_id,revision) on delete cascade,
  foreign key(measurement_id,measurement_revision) references bob.measurement_revisions(measurement_id,revision) on delete cascade
);
create index solution_measurements_project_idx on bob.solution_measurements(project_id);
create index solution_measurements_measure_idx on bob.solution_measurements(measurement_id,measurement_revision);

create table bob.project_targets (
  project_id text primary key references bob.projects(id) on delete cascade,
  current_revision integer not null check(current_revision>0)
);
create table bob.target_revisions (
  project_id text not null references bob.projects(id) on delete cascade,
  revision integer not null check(revision>0),
  solution_id uuid,
  solution_revision integer,
  reason text not null check(char_length(btrim(reason)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(project_id,revision),
  check((solution_id is null)=(solution_revision is null)),
  foreign key(solution_id,solution_revision) references bob.solution_revisions(solution_id,revision) deferrable initially deferred
);
create index target_revisions_solution_idx on bob.target_revisions(solution_id,solution_revision);
alter table bob.project_targets add constraint target_current_revision_fk
  foreign key(project_id,current_revision) references bob.target_revisions(project_id,revision) deferrable initially deferred;
create index project_targets_current_idx on bob.project_targets(project_id,current_revision);

alter table bob.solutions enable row level security;
alter table bob.solution_revisions enable row level security;
alter table bob.solution_measurements enable row level security;
alter table bob.project_targets enable row level security;
alter table bob.target_revisions enable row level security;
revoke all on bob.solutions,bob.solution_revisions,bob.solution_measurements,bob.project_targets,bob.target_revisions from public,anon,authenticated;
grant select on bob.solutions,bob.solution_revisions,bob.solution_measurements,bob.project_targets,bob.target_revisions to authenticated;
create policy project_read on bob.solutions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.solution_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.solution_measurements for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_targets for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.target_revisions for select to authenticated using(bob_private.has_project_access(project_id));

create view bob.current_solutions with(security_invoker=true) as
select h.id,h.area_id,r.* from bob.solutions h join bob.solution_revisions r
  on r.solution_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id;
create view bob.current_target with(security_invoker=true) as
select r.* from bob.project_targets h join bob.target_revisions r
  on r.project_id=h.project_id and r.revision=h.current_revision;
create view bob.solution_measurement_details with(security_invoker=true) as
select l.*, r.subject,r.value::text as value,r.unit,r.truth,r.source,
  h.current_revision as latest_revision,c.archived as currently_archived
from bob.solution_measurements l
join bob.measurement_revisions r on r.measurement_id=l.measurement_id and r.revision=l.measurement_revision and r.project_id=l.project_id
join bob.measurements h on h.id=l.measurement_id and h.project_id=l.project_id
join bob.measurement_revisions c on c.measurement_id=h.id and c.revision=h.current_revision;
revoke all on bob.current_solutions,bob.current_target,bob.solution_measurement_details from public,anon,authenticated;
grant select on bob.current_solutions,bob.current_target,bob.solution_measurement_details to authenticated;

create function bob_private.solution_command(p_project text,p_action text,p_solution uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid(); actor text; allowed text[];
  h bob.solutions; r bob.solution_revisions; t bob.target_revisions;
  n integer; target_version integer; area text; refs jsonb; ref jsonb;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action is null or p_action not in ('create','revise','archive','restore','select','clear')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>24000 then raise exception 'Invalid solution command'; end if;
  -- Serialize target decisions and alternative edits within this project.
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
  allowed := case when p_action='create' then array['title','description','assumptions','tradeoffs','source_media_id','measurements','area_id']
    when p_action='revise' then array['title','description','assumptions','tradeoffs','source_media_id','measurements','change_note']
    when p_action='select' then array['reason','solution_revision']
    when p_action='clear' then array['reason'] else array[]::text[] end;
  if p_data-allowed<>'{}'::jsonb then raise exception 'Unsupported fields. Identity, parents and history cannot be rewritten.'; end if;
  select current_revision into target_version from bob.project_targets where project_id=p_project;
  target_version := coalesce(target_version,0);
  if p_action in ('select','clear') then
    if p_expected is distinct from target_version then raise exception 'Target changed. Reload before deciding again.'; end if;
    if p_action='select' then
      select * into h from bob.solutions where id=p_solution and project_id=p_project;
      if not found then raise exception 'Solution unavailable'; end if;
      if h.current_revision is distinct from (p_data->>'solution_revision')::integer then raise exception 'Solution changed. Reload before selecting.'; end if;
      select * into r from bob.solution_revisions where solution_id=h.id and revision=h.current_revision;
      if r.archived then raise exception 'Restore this alternative before selecting it.'; end if;
    else
      if p_solution is not null then raise exception 'Clear does not accept a solution'; end if;
      select * into t from bob.target_revisions where project_id=p_project and revision=target_version;
      if not found or t.solution_id is null then raise exception 'There is no selected target to clear.'; end if;
    end if;
    n := target_version+1;
    insert into bob.target_revisions(project_id,revision,solution_id,solution_revision,reason,recorded_by,actor_label)
      values(p_project,n,h.id,h.current_revision,btrim(p_data->>'reason'),uid,actor);
    insert into bob.project_targets values(p_project,n) on conflict(project_id) do update set current_revision=excluded.current_revision;
    return jsonb_build_object('revision',n);
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
create function bob.solution_command(p_project text,p_action text,p_solution uuid,p_expected integer,p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.solution_command(p_project,p_action,p_solution,p_expected,p_data)
$$;
revoke all on function bob.solution_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.solution_command(text,text,uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
