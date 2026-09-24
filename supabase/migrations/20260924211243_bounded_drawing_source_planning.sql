-- Keep exact-revision source checks behind an invoker function boundary.
-- Expanding all physical/CAD/evidence views into each overview/Step query caused
-- production planner timeouts even for a Project with no saved drawings.
-- Function-local planner settings avoid changing other apps or caller sessions.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.artifact_source_assessment(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[])
language sql stable security invoker
set search_path=''
set join_collapse_limit=1
set from_collapse_limit=1
as $$
select
 case when checks.unavailable then 'unavailable'
      when cardinality(reasons.items)>0 then 'changed' else 'current' end source_state,
 reasons.items source_reasons
from bob.artifact_revision_details a
join bob.artifacts h on h.id=a.artifact_id and h.project_id=a.project_id
left join lateral(select t.* from bob.current_target t where t.project_id=a.project_id
 and (t.area_id is not distinct from h.area_id or (h.area_id is not null and t.area_id is null))
 order by case when t.area_id is not distinct from h.area_id then 0 else 1 end limit 1) target on true
left join bob.artifact_generation_details g on g.project_id=a.project_id and g.artifact_id=a.artifact_id and g.artifact_revision=a.revision
left join bob.project_spaces space on space.project_id=a.project_id and space.id=g.space_id
left join bob.artifact_room_layout_details room on room.project_id=a.project_id and room.artifact_id=a.artifact_id and room.artifact_revision=a.revision
left join bob.artifact_multifloor_details floors on floors.project_id=a.project_id and floors.artifact_id=a.artifact_id and floors.artifact_revision=a.revision
left join bob.artifact_stair_details stair on stair.project_id=a.project_id and stair.artifact_id=a.artifact_id and stair.artifact_revision=a.revision
left join bob.artifact_cad_revisions cad on cad.project_id=a.project_id and cad.artifact_id=a.artifact_id and cad.artifact_revision=a.revision
-- A detail may depend on another detail. Compare every pinned CAD ancestor's
-- own inputs as well as its revision; unchanged geometry can have stale sources.
left join lateral(
 with recursive sources(id,revision,depth) as (
  select cad.source_artifact_id,cad.source_revision,1 where cad.source_artifact_id is not null
  union all
  select c.source_artifact_id,c.source_revision,s.depth+1 from sources s
  join bob.artifact_cad_revisions c on c.project_id=a.project_id and c.artifact_id=s.id and c.artifact_revision=s.revision
  where c.source_artifact_id is not null and s.depth<64
 )
 select coalesce(bool_or(parent.id is null or pinned.artifact_id is null or c.artifact_id is null or t.revision is null
   or (s.depth=64 and c.source_artifact_id is not null)
   or exists(select 1 from bob.artifact_measurements m where m.project_id=a.project_id
     and m.artifact_id=s.id and m.artifact_revision=s.revision
     and not exists(select 1 from bob.current_measurements cm where cm.project_id=m.project_id and cm.id=m.measurement_id))),false) unavailable,
  coalesce(bool_or(parent.revision<>s.revision or parent.archived
   or t.revision is distinct from pinned.target_revision or t.solution_id is distinct from pinned.solution_id
   or t.solution_revision is distinct from pinned.solution_revision
   or exists(select 1 from bob.artifact_measurements m join bob.current_measurements cm
     on cm.project_id=m.project_id and cm.id=m.measurement_id
     where m.project_id=a.project_id and m.artifact_id=s.id and m.artifact_revision=s.revision
      and (cm.revision<>m.measurement_revision or cm.archived))),false) changed
 from sources s
 left join bob.current_artifacts parent on parent.project_id=a.project_id and parent.id=s.id
 left join bob.artifact_revisions pinned on pinned.project_id=a.project_id and pinned.artifact_id=s.id and pinned.revision=s.revision
 left join bob.artifact_cad_revisions c on c.project_id=a.project_id and c.artifact_id=s.id and c.artifact_revision=s.revision
 left join lateral(select ct.* from bob.current_target ct where ct.project_id=a.project_id
  and (ct.area_id is not distinct from parent.area_id or (parent.area_id is not null and ct.area_id is null))
  order by case when ct.area_id is not distinct from parent.area_id then 0 else 1 end limit 1) t on true
) cad_sources on true
cross join lateral(select
 (target.revision is null
  or (a.generator is not null and (g.artifact_id is null or space.id is null))
  or (a.has_room_layout and (room.artifact_id is null or not room.context_available))
  or (a.has_multifloor_plan and floors.artifact_id is null)
  or (a.has_stair_study and stair.artifact_id is null)
  or cad_sources.unavailable
  or exists(select 1 from bob.artifact_measurements m where m.project_id=a.project_id
    and m.artifact_id=a.artifact_id and m.artifact_revision=a.revision
    and not exists(select 1 from bob.current_measurements c where c.project_id=m.project_id and c.id=m.measurement_id))
  or (a.source_media_id is not null and not exists(select 1 from bob.media_assets m
    where m.project_id=a.project_id and m.id=a.source_media_id and m.state='ready'))) unavailable,
 (target.revision is distinct from a.target_revision or target.solution_id is distinct from a.solution_id
  or target.solution_revision is distinct from a.solution_revision) target_changed,
 exists(select 1 from bob.artifact_measurements m join bob.current_measurements c
   on c.project_id=m.project_id and c.id=m.measurement_id
   where m.project_id=a.project_id and m.artifact_id=a.artifact_id and m.artifact_revision=a.revision
    and (c.revision<>m.measurement_revision or c.archived)) measurements_changed,
 coalesce((a.generator is not null and (g.space_revision<>g.current_space_revision or g.space_has_proposal or space.archived))
  or (a.has_room_layout and (room.current_left_revision<>room.left_space_revision
    or room.current_right_revision<>room.right_space_revision or room.current_wall_revision<>room.wall_element_revision
    or room.physical_archived or room.physical_pending))
  or (a.has_multifloor_plan and (floors.sources_changed or floors.physical_pending))
  or (a.has_stair_study and (stair.sources_changed or (stair.plan->>'physical_pending')::boolean)),false) physical_changed,
 coalesce(cad_sources.changed
  or (a.has_room_layout and (room.current_furniture_revision<>room.furniture_revision or room.furniture_archived)),false) drawing_changed
) checks
cross join lateral(select array_remove(array[
 case when checks.unavailable then 'source_unavailable' end,
 case when checks.target_changed then 'target_changed' end,
 case when checks.measurements_changed then 'measurements_changed' end,
 case when checks.physical_changed then 'physical_source_changed' end,
 case when checks.drawing_changed then 'drawing_source_changed' end
],null)::text[] items) reasons
where a.project_id=p_project and a.artifact_id=p_artifact and a.revision=p_revision;
$$;
revoke all on function bob_private.artifact_source_assessment(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment(text,uuid,integer) to authenticated;

-- Both the revision row and all assessment inputs retain the caller's RLS.
-- The function returns only the exact requested revision. Guest access still
-- enters through the existing capability-checked security-definer boundary.
create or replace view bob.artifact_source_status with(security_invoker=true) as
select r.project_id,r.artifact_id,r.revision,s.source_state,s.source_reasons
from bob.artifact_revisions r
cross join lateral bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) s;

commit;
