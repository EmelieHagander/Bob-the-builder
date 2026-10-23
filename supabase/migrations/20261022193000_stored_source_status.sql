-- Store drawing source freshness instead of recomputing it on every read.
--
-- bob.artifact_source_status ran bob_private.artifact_source_assessment for
-- every revision it returned, on every read. Display reads (project home
-- cards, drawing steps, drawing work list, artifact lists) hit the 8 s
-- authenticated statement timeout on 2026-10-21/22 while the shared instance
-- was under load. The answer only changes when an input changes.
--
-- Design (owner decision, 2026-10-22):
--  * Every write to an assessment input bumps a per-project change counter
--    (bob.artifact_source_epochs). The trigger is O(1); nothing is computed in
--    the writer's transaction.
--  * A pg_cron drain recomputes all revisions of changed projects with the
--    unchanged live assessment and stores them with the counter value it read
--    before computing (bob.artifact_source_states).
--  * The view returns a stored row only while its counter still matches;
--    otherwise it runs the live assessment for that row, exactly as before.
--    A stale or missing row therefore never changes an answer, only its cost.
--  * The stored value is computed by the owner, not by the reading member.
--    It equals what members see only when no input depends on a member's own
--    access. Projects with physical-model references (buildings, spaces,
--    multifloor/stair/room/generation details, space-measurement pins) or
--    pins to another project's private catalog items are never stored and
--    stay live (bob_private.artifact_source_states_storable).
--  * Write guards keep calling bob_private.artifact_source_assessment
--    directly; they are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_source_epochs(
  project_id text primary key references bob.projects(id) on delete cascade,
  seq bigint not null default 1 check(seq>0),
  changed_at timestamptz not null default now()
);

create table bob.artifact_source_states(
  project_id text not null,
  artifact_id uuid not null,
  revision integer not null,
  -- Null when the live assessment returns no row for this revision.
  source_state text,
  source_reasons text[],
  computed_seq bigint not null,
  computed_at timestamptz not null default now(),
  primary key(artifact_id,revision),
  foreign key(artifact_id,revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
  check((source_state is null)=(source_reasons is null))
);
create index artifact_source_states_project_idx on bob.artifact_source_states(project_id);

-- Drain bookkeeping only; never read by members.
create table bob_private.artifact_source_refreshes(
  project_id text primary key references bob.projects(id) on delete cascade,
  seq bigint not null,
  storable boolean not null,
  refreshed_at timestamptz not null default now()
);

alter table bob.artifact_source_epochs enable row level security;
alter table bob.artifact_source_states enable row level security;
alter table bob_private.artifact_source_refreshes enable row level security;
revoke all on bob.artifact_source_epochs,bob.artifact_source_states from public,anon,authenticated,service_role;
revoke all on bob_private.artifact_source_refreshes from public,anon,authenticated,service_role;
grant select on bob.artifact_source_epochs,bob.artifact_source_states to authenticated;
create policy project_read on bob.artifact_source_epochs for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.artifact_source_states for select to authenticated using(bob_private.has_project_access(project_id));

create function bob_private.bump_artifact_source_epoch(p_project text) returns void
language sql security definer set search_path='' as $$
  insert into bob.artifact_source_epochs(project_id)
  select p_project where exists(select 1 from bob.projects where id=p_project)
  on conflict(project_id) do update set seq=bob.artifact_source_epochs.seq+1,changed_at=now();
$$;

-- One counter bump per affected project. Projects are visited in a fixed
-- order so concurrent writers cannot deadlock on the counter rows.
create function bob_private.mark_artifact_source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare item jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  prior jsonb:=case when tg_op='UPDATE' then to_jsonb(old) end;
  project text;
begin
  if tg_table_name='catalog_items' and item->>'project_id' is null and prior->>'project_id' is null then
    -- A shared catalog item can be pinned by any project's construction.
    for project in select distinct c.project_id from bob.artifact_construction_revisions c order by 1 loop
      perform bob_private.bump_artifact_source_epoch(project);
    end loop;
  else
    for project in select distinct p from unnest(array[item->>'project_id',prior->>'project_id']) p where p is not null order by 1 loop
      perform bob_private.bump_artifact_source_epoch(project);
    end loop;
  end if;
  return null;
end $$;

-- Inputs whose rows carry the project. Physical-model tables are shared
-- across projects; projects that reference them are never stored (below).
do $$ declare t text; begin
  foreach t in array array['artifact_cad_revisions','artifact_construction_revisions','artifact_generations',
    'artifact_measurements','artifact_multifloor_plans','artifact_parametric_recipes','artifact_revisions',
    'artifact_room_layouts','artifact_stair_studies','artifacts','catalog_items','measurement_revisions',
    'measurements','media_assets','media_links','project_physical_scope','project_targets','target_revisions'] loop
    execute format('create trigger mark_artifact_source_changed after insert or update or delete on bob.%I
      for each row execute function bob_private.mark_artifact_source_changed()',t);
  end loop;
end $$;

-- True when the owner-computed assessment equals what every project member
-- sees: no input that depends on a member's own building or catalog access.
create function bob_private.artifact_source_states_storable(p_project text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from bob.artifacts a where a.project_id=p_project and (a.has_multifloor_plan or a.has_stair_study))
   and not exists(select 1 from bob.artifact_generations g where g.project_id=p_project)
   and not exists(select 1 from bob.artifact_room_layouts l where l.project_id=p_project)
   and not exists(select 1 from bob.artifact_multifloor_plans m where m.project_id=p_project)
   and not exists(select 1 from bob.artifact_stair_studies s where s.project_id=p_project)
   -- Any physical pin in construction parameters or CAD manifests, in any shape.
   and not exists(select 1 from bob.artifact_construction_revisions c where c.project_id=p_project
     and c.parameters::text ~ '(space_measurement|"space_id"|"building_id"|"element_id")')
   and not exists(select 1 from bob.artifact_cad_revisions c where c.project_id=p_project
     and c.manifest::text ~ '(space_measurement|"space_id"|"building_id"|"element_id")')
   and not exists(select 1 from bob.artifact_construction_revisions c
     cross join lateral jsonb_array_elements(case when jsonb_typeof(c.materials)='array' then c.materials else '[]'::jsonb end) m
     join bob.catalog_items i on i.id::text in (m->>'material_id',m->>'part_id')
     where c.project_id=p_project and i.project_id is not null and i.project_id<>p_project);
$$;

-- Recompute every revision of one project with the live assessment. The
-- counter is read before computing: a write that commits later leaves the
-- stored rows stale (and therefore unused) until the next refresh.
create function bob_private.refresh_artifact_source_states(p_project text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_seq bigint; v_storable boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('bob.artifact_source_states:'||p_project,0)) then return false; end if;
  select e.seq into v_seq from bob.artifact_source_epochs e where e.project_id=p_project;
  if v_seq is null then return false; end if;
  v_storable:=bob_private.artifact_source_states_storable(p_project);
  delete from bob.artifact_source_states where project_id=p_project;
  if v_storable then
    insert into bob.artifact_source_states(project_id,artifact_id,revision,source_state,source_reasons,computed_seq)
    select r.project_id,r.artifact_id,r.revision,a.source_state,a.source_reasons,v_seq
    from bob.artifact_revisions r
    left join lateral bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) a on true
    where r.project_id=p_project;
  end if;
  insert into bob_private.artifact_source_refreshes(project_id,seq,storable) values(p_project,v_seq,v_storable)
  on conflict(project_id) do update set seq=excluded.seq,storable=excluded.storable,refreshed_at=now();
  return true;
end $$;

-- Bounded drain for pg_cron. One failing project does not block the others.
create function bob_private.drain_artifact_source_states(p_limit integer default 20,p_budget interval default '20 seconds') returns integer
language plpgsql security definer set search_path='' as $$
declare v_project text; v_started timestamptz:=clock_timestamp(); v_done integer:=0;
begin
  for v_project in select e.project_id from bob.artifact_source_epochs e
    left join bob_private.artifact_source_refreshes f on f.project_id=e.project_id
    where f.seq is null or f.seq<e.seq order by e.changed_at,e.project_id limit p_limit loop
    exit when clock_timestamp()-v_started>p_budget;
    begin
      if bob_private.refresh_artifact_source_states(v_project) then v_done:=v_done+1; end if;
    exception when others then
      raise warning 'artifact source state refresh failed for project %: %',v_project,sqlstate;
    end;
  end loop;
  return v_done;
end $$;

revoke all on function bob_private.bump_artifact_source_epoch(text) from public,anon,authenticated,service_role;
revoke all on function bob_private.mark_artifact_source_changed() from public,anon,authenticated,service_role;
revoke all on function bob_private.artifact_source_states_storable(text) from public,anon,authenticated,service_role;
revoke all on function bob_private.refresh_artifact_source_states(text) from public,anon,authenticated,service_role;
revoke all on function bob_private.drain_artifact_source_states(integer,interval) from public,anon,authenticated,service_role;

-- Same columns as before. A fresh stored row is returned as is; otherwise the
-- live assessment runs for that row only. OFFSET 0 keeps the live subquery
-- from being flattened into the join, so its condition is checked before the
-- function runs (a one-time filter) instead of filtering its result after.
create or replace view bob.artifact_source_status with(security_invoker=true) as
 select r.project_id,r.artifact_id,r.revision,
  case when stored.fresh then stored.source_state else live.source_state end source_state,
  case when stored.fresh then stored.source_reasons else live.source_reasons end source_reasons
 from bob.artifact_revisions r
 left join lateral (
   select s.source_state,s.source_reasons,true fresh from bob.artifact_source_states s
   join bob.artifact_source_epochs e on e.project_id=s.project_id and e.seq=s.computed_seq
   where s.artifact_id=r.artifact_id and s.revision=r.revision and s.project_id=r.project_id
 ) stored on true
 left join lateral (
   select a.source_state,a.source_reasons
   from bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) a
   where stored.fresh is null
   offset 0
 ) live on true
 where case when stored.fresh then stored.source_state is not null else live.source_state is not null end;
revoke all on bob.artifact_source_status from public,anon,authenticated;
grant select on bob.artifact_source_status to authenticated;

-- Existing projects start at counter 1; the drain fills their rows. Until
-- then reads stay live, exactly as before this migration.
insert into bob.artifact_source_epochs(project_id)
select distinct r.project_id from bob.artifact_revisions r on conflict do nothing;

do $$ begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('bob-source-states','30 seconds','select bob_private.drain_artifact_source_states()');
  end if;
end $$;

notify pgrst,'reload schema';
commit;
