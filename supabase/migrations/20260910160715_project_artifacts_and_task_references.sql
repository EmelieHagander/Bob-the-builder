-- Manual milestone 4A. Contract: Docs/project-artifacts.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.artifacts (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  area_id text references bob.areas(id) on delete set null,
  current_revision integer not null check(current_revision>0),
  unique(id,project_id)
);
create index artifacts_project_idx on bob.artifacts(project_id);
create index artifacts_area_idx on bob.artifacts(area_id);
create table bob.artifact_revisions (
  artifact_id uuid not null,
  project_id text not null,
  revision integer not null check(revision>0),
  title text not null check(char_length(btrim(title)) between 1 and 200),
  kind text not null check(kind in ('plan','elevation','section','detail','reference')),
  notes text not null default '' check(char_length(notes)<=6000),
  source text not null check(char_length(btrim(source)) between 1 and 4000),
  unresolved text not null default '' check(char_length(unresolved)<=4000),
  source_media_id uuid references bob.media_assets(id) on delete set null,
  source_media_title text not null,
  target_revision integer not null,
  archived boolean not null default false,
  change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(artifact_id,revision),
  foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
  foreign key(project_id,target_revision) references bob.target_revisions(project_id,revision) deferrable initially deferred
);
create index artifact_revisions_parent_idx on bob.artifact_revisions(artifact_id,project_id);
create index artifact_revisions_target_idx on bob.artifact_revisions(project_id,target_revision);
create index artifact_revisions_image_idx on bob.artifact_revisions(source_media_id);
alter table bob.artifacts add constraint artifact_current_revision_fk
  foreign key(id,current_revision) references bob.artifact_revisions(artifact_id,revision) deferrable initially deferred;
create index artifacts_current_idx on bob.artifacts(id,current_revision);

create table bob.artifact_task_links (
  project_id text not null references bob.projects(id) on delete cascade,
  task_id text not null references bob.tasks(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(task_id,artifact_id),
  foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade
);
create index artifact_task_links_project_idx on bob.artifact_task_links(project_id);
create index artifact_task_links_revision_idx on bob.artifact_task_links(artifact_id,artifact_revision);

alter table bob.artifacts enable row level security;
alter table bob.artifact_revisions enable row level security;
alter table bob.artifact_task_links enable row level security;
revoke all on bob.artifacts,bob.artifact_revisions,bob.artifact_task_links from public,anon,authenticated;
grant select on bob.artifacts,bob.artifact_revisions,bob.artifact_task_links to authenticated;
create policy project_read on bob.artifacts for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.artifact_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.artifact_task_links for select to authenticated using(bob_private.has_project_access(project_id));

create view bob.artifact_versions with(security_invoker=true) as
select h.id,h.area_id,h.current_revision as latest_revision,c.archived as currently_archived,r.*,
  t.solution_id,t.solution_revision,s.title as solution_title,
  (ct.solution_id is distinct from t.solution_id or ct.solution_revision is distinct from t.solution_revision) as target_changed,
  exists(select 1 from bob.solution_measurements m join bob.measurements mh on mh.id=m.measurement_id and mh.project_id=m.project_id
    where m.project_id=r.project_id and m.solution_id=t.solution_id and m.solution_revision=t.solution_revision
      and mh.current_revision<>m.measurement_revision) as evidence_changed,
  coalesce(f.state='ready',false) as image_ready
from bob.artifacts h join bob.artifact_revisions r on r.artifact_id=h.id and r.project_id=h.project_id
join bob.artifact_revisions c on c.artifact_id=h.id and c.revision=h.current_revision
join bob.target_revisions t on t.project_id=r.project_id and t.revision=r.target_revision
join bob.solution_revisions s on s.solution_id=t.solution_id and s.revision=t.solution_revision and s.project_id=r.project_id
left join bob.current_target ct on ct.project_id=r.project_id
left join bob.media_assets f on f.id=r.source_media_id and f.project_id=r.project_id;
create view bob.current_artifacts with(security_invoker=true) as
  select * from bob.artifact_versions where revision=latest_revision;
create view bob.task_artifacts with(security_invoker=true) as
  select l.task_id,l.recorded_at as linked_at,l.actor_label as linked_by,v.*
  from bob.artifact_task_links l join bob.artifact_versions v
    on v.artifact_id=l.artifact_id and v.revision=l.artifact_revision and v.project_id=l.project_id;
revoke all on bob.artifact_versions,bob.current_artifacts,bob.task_artifacts from public,anon,authenticated;
grant select on bob.artifact_versions,bob.current_artifacts,bob.task_artifacts to authenticated;

create function bob_private.artifact_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid(); actor text; allowed text[]; h bob.artifacts; r bob.artifact_revisions;
  n integer; area text; t bob.target_revisions; linked integer; task text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action is null or p_action not in ('create','revise','archive','restore','attach','detach')
    or p_artifact is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>24000 then raise exception 'Invalid artifact command'; end if;
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
  allowed := case when p_action='create' then array['title','kind','notes','source','unresolved','source_media_id','expected_target_revision','reviewed','area_id']
    when p_action='revise' then array['title','kind','notes','source','unresolved','source_media_id','expected_target_revision','reviewed','change_note']
    when p_action in ('attach','detach') then array['task_id','expected_link_revision'] else array[]::text[] end;
  if p_data-allowed<>'{}'::jsonb then raise exception 'Unsupported fields. Identity, parents and history cannot be rewritten.'; end if;
  select * into h from bob.artifacts where id=p_artifact and project_id=p_project;
  if p_action<>'create' then
    if not found then raise exception 'Drawing/reference unavailable'; end if;
    select * into r from bob.artifact_revisions where artifact_id=h.id and revision=h.current_revision;
  end if;
  if p_action in ('attach','detach') then
    task := p_data->>'task_id';
    perform 1 from bob.tasks tk join bob.areas a on a.id=tk.area_id where tk.id=task and a.project_id=p_project for share of tk,a;
    if not found then raise exception 'Task unavailable in this project'; end if;
    select artifact_revision into linked from bob.artifact_task_links where task_id=task and artifact_id=p_artifact and project_id=p_project;
    if coalesce(linked,0) is distinct from (p_data->>'expected_link_revision')::integer then raise exception 'Task reference changed. Reload before saving again.'; end if;
    if p_action='detach' then
      if linked is null then raise exception 'Task reference already removed. Reload first.'; end if;
      delete from bob.artifact_task_links where task_id=task and artifact_id=p_artifact and project_id=p_project;
    else
      if p_expected is distinct from h.current_revision then raise exception 'Drawing/reference changed. Reload before attaching.'; end if;
      if r.archived then raise exception 'Restore this drawing/reference before attaching.'; end if;
      perform 1 from bob.media_assets where id=r.source_media_id and project_id=p_project and state='ready' for share;
      if not found then raise exception 'Image unavailable. Save a new version with a ready project image.'; end if;
      insert into bob.artifact_task_links values(p_project,task,p_artifact,h.current_revision,uid,actor,clock_timestamp())
        on conflict(task_id,artifact_id) do update set artifact_revision=excluded.artifact_revision,recorded_by=excluded.recorded_by,actor_label=excluded.actor_label,recorded_at=excluded.recorded_at;
    end if;
    return jsonb_build_object('id',p_artifact,'revision',h.current_revision);
  end if;
  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New drawings/references start at revision zero'; end if;
    if exists(select 1 from bob.artifacts where id=p_artifact) then raise exception 'Drawing/reference already exists. Reload first.'; end if;
    area := nullif(p_data->>'area_id','');
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'Area unavailable in this project'; end if;
    end if;
    insert into bob.artifacts values(p_artifact,p_project,area,1); n := 1;
  else
    if p_expected is distinct from h.current_revision then raise exception 'Drawing/reference changed. Reload before saving again.'; end if;
    if (p_action in ('revise','archive') and r.archived) or (p_action='restore' and not r.archived) then raise exception 'Drawing/reference state changed. Reload first.'; end if;
    n := p_expected+1;
  end if;
  if p_action in ('create','revise') then
    select * into t from bob.current_target where project_id=p_project;
    if not found or t.solution_id is null then raise exception 'Select a project target before saving a drawing/reference.'; end if;
    if t.revision is distinct from (p_data->>'expected_target_revision')::integer then raise exception 'Target changed. Reload before reviewing this drawing/reference again.'; end if;
    if p_data->'reviewed' is distinct from 'true'::jsonb then raise exception 'Review this file against the selected solution and its measurements first.'; end if;
    r.title := btrim(p_data->>'title'); r.kind := p_data->>'kind';
    r.notes := btrim(coalesce(p_data->>'notes','')); r.source := btrim(p_data->>'source');
    r.unresolved := btrim(coalesce(p_data->>'unresolved','')); r.target_revision := t.revision; r.archived := false;
    r.source_media_id := nullif(p_data->>'source_media_id','')::uuid;
    select title into r.source_media_title from bob.media_assets where id=r.source_media_id and project_id=p_project and state='ready' for share;
    if not found then raise exception 'A ready image from this project is required.'; end if;
  end if;
  r.artifact_id := p_artifact; r.project_id := p_project; r.revision := n;
  r.recorded_by := uid; r.actor_label := actor; r.recorded_at := clock_timestamp();
  r.change_note := case p_action when 'create' then 'Initial reference reviewed against selected target' when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end;
  if p_action in ('archive','restore') then r.archived := (p_action='archive'); end if;
  insert into bob.artifact_revisions select r.*;
  update bob.artifacts set current_revision=n where id=p_artifact;
  return jsonb_build_object('id',p_artifact,'revision',n);
end $$;
revoke all on function bob_private.artifact_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.artifact_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.artifact_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.artifact_command(p_project,p_action,p_artifact,p_expected,p_data)
$$;
revoke all on function bob.artifact_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.artifact_command(text,text,uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
