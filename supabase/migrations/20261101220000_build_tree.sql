-- Owner decisions 2026-11-01 ("Bob för stora byggen"): the project is a tree
-- that follows the house (building -> level -> room) down to sub-builds and
-- their parts. A shell drawing becomes the sub-build: it holds constructions and
-- drawings, nests at most two levels and belongs to a room. A build with no room
-- shows in "Snickeriet", a view and not a row. Areas stay a filter.
--
-- Additive: shell revisions, constructions and drawings are unchanged. One
-- placement row per artifact says where it sits (inside a sub-build, or in a
-- room). No row means Snickeriet. Placements move through one command.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.build_placements (
 artifact_id uuid primary key,
 project_id text not null,
 parent_id uuid,
 space_id uuid references bob.building_spaces(id) on delete set null,
 placed_by uuid not null,
 placed_at timestamptz not null default clock_timestamp(),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 -- A removed sub-build sends what it held back to Snickeriet.
 foreign key(parent_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 check(parent_id is distinct from artifact_id),
 -- Inside a sub-build, the room comes from the sub-build.
 check(parent_id is null or space_id is null),
 check(parent_id is not null or space_id is not null)
);
create index build_placements_project_idx on bob.build_placements(project_id);
create index build_placements_parent_idx on bob.build_placements(parent_id);
alter table bob.build_placements enable row level security;
revoke all on bob.build_placements from public,anon,authenticated;
grant select on bob.build_placements to authenticated;
grant all on bob.build_placements to service_role;
create policy project_read on bob.build_placements for select to authenticated using(bob_private.has_project_access(project_id));

-- What a saved artifact is in the tree, by its current revision; null for other artifacts.
create function bob_private.build_kind(p_project text,p_artifact uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when exists(select 1 from bob.artifact_cad_shell_revisions s where s.artifact_id=a.id and s.artifact_revision=a.current_revision) then 'sub_build'
  when exists(select 1 from bob.artifact_construction_revisions c where c.artifact_id=a.id and c.artifact_revision=a.current_revision) then 'construction'
  when exists(select 1 from bob.artifact_cad_revisions d where d.artifact_id=a.id and d.artifact_revision=a.current_revision) then 'drawing'
 end
 from bob.artifacts a where a.id=p_artifact and a.project_id=p_project
$$;
revoke all on function bob_private.build_kind(text,uuid) from public,anon,authenticated,service_role;

-- Rooms of the buildings this project links, with their level and building names.
create function bob_private.build_tree_spaces(p_project text) returns table(space_id uuid,space_name text,level_id uuid,level_name text,level_position integer,building_id uuid,building_name text)
language sql stable security definer set search_path='' as $$
 select s.id,sr.name,sr.level_id,lr.name,lr.position,b.id,br.name
 from (select distinct building_id from bob.project_physical_scope where project_id=p_project and building_id is not null) linked
 join bob.buildings b on b.id=linked.building_id
 join bob.building_revisions br on br.building_id=b.id and br.revision=b.current_revision and not br.archived
 join bob.building_spaces s on s.building_id=b.id
 join bob.space_revisions sr on sr.space_id=s.id and sr.revision=coalesce(s.accepted_revision,s.latest_revision) and not sr.archived
 left join bob.building_levels l on l.id=sr.level_id
 left join bob.level_revisions lr on lr.level_id=l.id and lr.revision=l.current_revision and not lr.archived
$$;
revoke all on function bob_private.build_tree_spaces(text) from public,anon,authenticated,service_role;

-- The flat tree: rooms, and every current sub-build, construction and drawing
-- with where it sits. Code builds the levels from these rows.
create function bob.read_build_tree(p_project text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare spaces jsonb; builds jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('space_id',t.space_id,'name',t.space_name,'level_id',t.level_id,'level_name',t.level_name,'level_position',t.level_position,
  'building_id',t.building_id,'building_name',t.building_name) order by t.building_name,t.level_position nulls last,t.level_name nulls last,t.space_name,t.space_id),'[]'::jsonb)
  into spaces from bob_private.build_tree_spaces(p_project) t;
 select coalesce(jsonb_agg(row order by row->>'title',row->>'id'),'[]'::jsonb) into builds from (
  select jsonb_build_object('id',a.id,'kind',k.kind,'title',r.title,'revision',a.current_revision,'area_id',a.area_id,
   'parent_id',p.parent_id,'space_id',p.space_id,
   'parts',case when k.kind='construction' then (select case when jsonb_typeof(c.recipe->'instances')='array' then jsonb_array_length(c.recipe->'instances') end
     from bob.artifact_construction_revisions c where c.artifact_id=a.id and c.artifact_revision=a.current_revision) end,
   -- Drawings a sub-build pins as pieces (its current revision).
   'in_sub_builds',coalesce((select jsonb_agg(distinct sh.id) from bob.artifact_cad_shell_components sc
     join bob.artifacts sh on sh.id=sc.shell_artifact_id and sh.current_revision=sc.shell_revision and sh.project_id=p_project
     join bob.artifact_revisions shr on shr.artifact_id=sh.id and shr.revision=sh.current_revision and not shr.archived
     where sc.child_artifact_id=a.id),'[]'::jsonb)) row
  from bob.artifacts a
  join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and not r.archived
  cross join lateral (select bob_private.build_kind(p_project,a.id) kind) k
  left join bob.build_placements p on p.artifact_id=a.id
  where a.project_id=p_project and k.kind is not null
 ) items;
 return jsonb_build_object('version',1,'spaces',spaces,'builds',builds);
end $$;
revoke all on function bob.read_build_tree(text) from public,anon;
grant execute on function bob.read_build_tree(text) to authenticated,service_role;

-- The one write path for Bob and the app. p_parent: a sub-build, or null.
-- p_space: a room of a linked building, or null. Both null: back to Snickeriet.
create function bob.place_build(p_project text,p_artifact uuid,p_parent uuid,p_space uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare kind text; parent_kind text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_artifact is null then raise exception 'build_invalid' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 kind:=bob_private.build_kind(p_project,p_artifact);
 if kind is null then raise exception 'build_unavailable' using errcode='22023'; end if;
 if exists(select 1 from bob.artifacts a join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision where a.id=p_artifact and r.archived) then
  raise exception 'build_archived' using errcode='22023'; end if;
 if p_parent is not null then
  if p_space is not null then raise exception 'build_space_from_parent' using errcode='22023'; end if;
  if p_parent=p_artifact then raise exception 'build_invalid' using errcode='22023'; end if;
  parent_kind:=bob_private.build_kind(p_project,p_parent);
  if parent_kind is distinct from 'sub_build' then raise exception 'build_parent_not_sub_build' using errcode='22023'; end if;
  if exists(select 1 from bob.artifacts a join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision where a.id=p_parent and r.archived) then
   raise exception 'build_archived' using errcode='22023'; end if;
  -- Sub-builds nest two levels: one inside another, never deeper. This also rules out cycles.
  if kind='sub_build' and (exists(select 1 from bob.build_placements where artifact_id=p_parent and parent_id is not null)
   or exists(select 1 from bob.build_placements c where c.parent_id=p_artifact and bob_private.build_kind(p_project,c.artifact_id)='sub_build')) then
   raise exception 'build_nesting_limit' using errcode='22023'; end if;
 end if;
 if p_space is not null and not exists(select 1 from bob_private.build_tree_spaces(p_project) t where t.space_id=p_space) then
  raise exception 'build_space_unavailable' using errcode='22023'; end if;
 if p_parent is null and p_space is null then
  delete from bob.build_placements where artifact_id=p_artifact;
 else
  insert into bob.build_placements(artifact_id,project_id,parent_id,space_id,placed_by)
   values(p_artifact,p_project,p_parent,p_space,auth.uid())
   on conflict(artifact_id) do update set parent_id=excluded.parent_id,space_id=excluded.space_id,placed_by=excluded.placed_by,placed_at=clock_timestamp();
 end if;
 return jsonb_build_object('status','saved','id',p_artifact,'kind',kind,'parent_id',p_parent,'space_id',p_space,
  'place',case when p_parent is not null then 'sub_build' when p_space is not null then 'room' else 'workshop' end);
end $$;
revoke all on function bob.place_build(text,uuid,uuid,uuid) from public,anon;
grant execute on function bob.place_build(text,uuid,uuid,uuid) to authenticated;
commit;
