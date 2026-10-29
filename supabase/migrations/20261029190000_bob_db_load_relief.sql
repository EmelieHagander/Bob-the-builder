-- Database load relief for Bob (2026-10-29). Prepared; not applied.
--
-- The paid box run hit the 8 s statement timeout in construction reads and
-- writes while the small shared instance stalled (even a one-line cron job took
-- 4-7 s at those moments). Bob's own statements caused that load. Measured as
-- the test owner, read-only:
--
-- * Journal pages (bob_checkpoint_steps_page, bob_job_steps_page) appended each
--   entry to a growing jsonb array: a quadratic copy of up to 2 MB per page, on
--   every claim. A real 1.8 MB journal took 460-645 ms to load; the set-based
--   page below returns the same pages and bytes in about 50 ms.
-- * Construction freshness (artifact_source_assessment_before_physical) joined
--   the generation, room-layout, multifloor and stair detail views for every
--   artifact. A construction has none of them, yet each call planned a
--   1,015-line plan (100-165 ms planning on a fresh connection, 16-40 ms
--   execution). The slim form below, used only when the revision has no such
--   detail, plans in about 14 ms and runs in about 7 ms with the same result.
--
-- Every function keeps its name, arguments, grants and result; the full
-- assessments stay as fallbacks under a _full name. Results are identical by
-- construction (tests compare them with the full originals), so running and
-- older jobs replay unchanged and no runtime pin is needed.
begin;
set local lock_timeout='5s';

-- Journal pages: the same entries, order, 2,000,000-byte cut and next cursor.
-- The loop took an entry while nothing was taken yet or the running total
-- stayed within the limit, and stopped at the first entry that did not. A
-- running sum in key order selects exactly that prefix.
create or replace function bob.bob_checkpoint_steps_page(p_job uuid,p_claim uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb; cursor_key text; epoch bigint;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.checkpoint_version<>1 or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
  raise exception 'job_not_claimed' using errcode='PT409'; end if;
 select revision into epoch from bob_private.bob_turn_checkpoints where job_id=p_job;
 select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'fingerprint',s.fingerprint,'value',s.value) order by s.key),'[]'::jsonb),max(s.key)
  into result,cursor_key from (
  select a.key,a.fingerprint,a.value,sum(a.value_bytes) over w taken,sum(a.value_bytes) over w-a.value_bytes earlier
  from (select * from (
   select key,fingerprint,value,value_bytes from bob_private.bob_job_steps where job_id=p_job and checkpoint_bootstrap and (p_after is null or key>p_after)
   union all
   select key,fingerprint,value,value_bytes from bob_private.bob_job_steps where job_id=p_job and not checkpoint_bootstrap and checkpoint_epoch>=coalesce(epoch,0) and (p_after is null or key>p_after)
  ) active order by key limit 100) a
  window w as (order by a.key rows between unbounded preceding and current row)
 ) s where s.earlier=0 or s.taken<=2000000;
 return jsonb_build_object('entries',result,'next',case when
  exists(select 1 from bob_private.bob_job_steps where job_id=p_job and checkpoint_bootstrap and key>cursor_key)
  or exists(select 1 from bob_private.bob_job_steps where job_id=p_job and not checkpoint_bootstrap and checkpoint_epoch>=coalesce(epoch,0) and key>cursor_key)
  then cursor_key else null end);
end $$;

create or replace function bob.bob_job_steps_page(p_job uuid,p_claim uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb; cursor_key text;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then raise exception 'job_not_claimed' using errcode='PT409'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'fingerprint',s.fingerprint,'value',s.value) order by s.key),'[]'::jsonb),max(s.key)
  into result,cursor_key from (
  select a.key,a.fingerprint,a.value,sum(a.value_bytes) over w taken,sum(a.value_bytes) over w-a.value_bytes earlier
  from (select key,fingerprint,value,value_bytes from bob_private.bob_job_steps where job_id=p_job and (p_after is null or key>p_after) order by key limit 100) a
  window w as (order by a.key rows between unbounded preceding and current row)
 ) s where s.earlier=0 or s.taken<=2000000;
 return jsonb_build_object('entries',result,'next',case when exists(select 1 from bob_private.bob_job_steps where job_id=p_job and key>cursor_key) then cursor_key else null end);
end $$;

-- Construction freshness. The full assessment stays as the fallback under a
-- new name; the original name decides whether the slim form is exact.
alter function bob_private.artifact_source_assessment_before_physical(text,uuid,integer) rename to artifact_source_assessment_before_physical_full;
create function bob_private.artifact_source_assessment_before_physical(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[]) language plpgsql stable set search_path=''
 set join_collapse_limit='1' set from_collapse_limit='1' set plan_cache_mode='force_generic_plan' as $$#variable_conflict use_column
begin
 -- Each detail view produces rows only from its own base row, keyed by
 -- artifact and revision. Without any of them every term those views add is
 -- false, so the slim statement returns exactly the full statement's rows.
 if not exists(select 1 from bob.artifact_revisions r join bob.artifacts h on h.id=r.artifact_id and h.project_id=r.project_id
     where r.project_id=p_project and r.artifact_id=p_artifact and r.revision=p_revision
      and h.has_multifloor_plan is false and h.has_stair_study is false)
   or exists(select 1 from bob.artifact_generations x where x.artifact_id=p_artifact and x.artifact_revision=p_revision)
   or exists(select 1 from bob.artifact_room_layouts x where x.artifact_id=p_artifact and x.artifact_revision=p_revision)
   or exists(select 1 from bob.artifact_multifloor_plans x where x.artifact_id=p_artifact and x.artifact_revision=p_revision)
   or exists(select 1 from bob.artifact_stair_studies x where x.artifact_id=p_artifact and x.artifact_revision=p_revision) then
  return query select * from bob_private.artifact_source_assessment_before_physical_full(p_project,p_artifact,p_revision);
  return;
 end if;
 return query
select
 case when checks.unavailable then 'unavailable'
      when cardinality(reasons.items)>0 then 'changed' else 'current' end source_state,
 reasons.items source_reasons
from bob.artifact_revision_details a
join bob.artifacts h on h.id=a.artifact_id and h.project_id=a.project_id
left join lateral(select t.* from bob.current_target t where t.project_id=a.project_id
 and (t.area_id is not distinct from h.area_id or (h.area_id is not null and t.area_id is null))
 order by case when t.area_id is not distinct from h.area_id then 0 else 1 end limit 1) target on true
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
 false physical_changed,
 coalesce(cad_sources.changed,false) drawing_changed
) checks
cross join lateral(select array_remove(array[
 case when checks.unavailable then 'source_unavailable' end,
 case when checks.target_changed then 'target_changed' end,
 case when checks.measurements_changed then 'measurements_changed' end,
 case when checks.physical_changed then 'physical_source_changed' end,
 case when checks.drawing_changed then 'drawing_source_changed' end
],null)::text[] items) reasons
where a.project_id=p_project and a.artifact_id=p_artifact and a.revision=p_revision;
end$$;
revoke all on function bob_private.artifact_source_assessment_before_physical(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment_before_physical(text,uuid,integer) to authenticated;

-- Without a space-measurement lineage pin the physical aggregate is
-- (false,false), so the full statement returns the inner rows unchanged.
alter function bob_private.artifact_source_assessment_before_parameters(text,uuid,integer) rename to artifact_source_assessment_before_parameters_full;
create function bob_private.artifact_source_assessment_before_parameters(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[]) language plpgsql stable set search_path=''
 set join_collapse_limit='1' set from_collapse_limit='1' set plan_cache_mode='force_generic_plan' as $$#variable_conflict use_column
begin
 if exists(with recursive chain as (
   select c.artifact_id,c.artifact_revision,c.source_artifact_id,c.source_revision,c.manifest,1 depth from bob.artifact_cad_revisions c
    where c.project_id=p_project and c.artifact_id=p_artifact and c.artifact_revision=p_revision
   union all
   select c.artifact_id,c.artifact_revision,c.source_artifact_id,c.source_revision,c.manifest,x.depth+1 from chain x
    join bob.artifact_cad_revisions c on c.project_id=p_project and c.artifact_id=x.source_artifact_id and c.artifact_revision=x.source_revision where x.depth<64
  ) select 1 from chain x cross join lateral jsonb_array_elements(coalesce(x.manifest->'bob_lineage'->'bindings','[]'::jsonb)) b
   where b->'source'->>'kind'='space_measurement') then
  return query select * from bob_private.artifact_source_assessment_before_parameters_full(p_project,p_artifact,p_revision);
  return;
 end if;
 return query select case when old.source_state='unavailable' then 'unavailable' when old.source_state='changed' then 'changed' else 'current' end,
  old.source_reasons||'{}'::text[]
 from bob_private.artifact_source_assessment_before_physical(p_project,p_artifact,p_revision) old;
end$$;
revoke all on function bob_private.artifact_source_assessment_before_parameters(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment_before_parameters(text,uuid,integer) to authenticated;

-- The space-measurement check reads physical views only when a construction
-- actually has a space-measurement source node; otherwise it was false.
create or replace function bob_private.artifact_source_assessment_before_construction_drawings(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[]) language plpgsql stable set search_path=''
 set join_collapse_limit='1' set from_collapse_limit='1' as $$
declare
 c bob.artifact_construction_revisions;
 base_state text; reasons text[];
 changed boolean := false; unavailable boolean := false;
begin
 select s.source_state,s.source_reasons into base_state,reasons
 from bob_private.artifact_source_assessment_before_construction(p_project,p_artifact,p_revision) s;
 if not found then return; end if;
 select * into c from bob.artifact_construction_revisions
 where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision;
 if not found then return query select base_state,reasons;return; end if;

 select coalesce(bool_or(material.id is null or
   (m->>'part_id' is not null and part.id is null)),false),
   coalesce(bool_or(material.id is not null and
   (material.current_revision is distinct from (m->>'material_revision')::integer
    or (m->>'part_id' is not null and part.current_revision is distinct from (m->>'part_revision')::integer))),false)
 into unavailable,changed
 from jsonb_array_elements(c.materials) m
 left join bob.catalog_items material on material.id=(m->>'material_id')::uuid
 left join bob.catalog_items part on part.id=(m->>'part_id')::uuid;
 if changed then reasons:=array_append(reasons,'construction_catalog_changed'); end if;

 if exists(select 1 from jsonb_array_elements(c.parameters->'nodes') n
   where n->>'role'='source' and n->'source'->>'kind'='space_measurement') then
  if exists(select 1 from jsonb_array_elements(c.parameters->'nodes') n
    where n->>'role'='source' and n->'source'->>'kind'='space_measurement'
    and not exists(select 1 from bob.space_measurements m
      join bob.project_spaces s on s.id=m.space_id and s.project_id=p_project
      join bob.project_buildings b on b.id=m.building_id and b.project_id=p_project
      where m.id=(n->'source'->>'id')::uuid
        and m.space_revision=(n->'source'->>'space_revision')::integer
        and s.revision=m.space_revision and not s.archived and not b.archived)) then
   unavailable:=true;
   reasons:=array_append(reasons,'construction_physical_source_changed_or_unavailable');
  end if;
 end if;
 if exists(select 1 from jsonb_array_elements(c.parameters->'frames') f
   where f->>'kind'='image' and not bob_private.cad_image_version_matches(
     p_project,substring(f->>'source_ref' from 7)::uuid,f->>'source_version')) then
  changed:=true;reasons:=array_append(reasons,'construction_image_changed');
 end if;
 return query select case when unavailable or base_state='unavailable' then 'unavailable'
   when changed or base_state='changed' then 'changed' else base_state end,reasons;
end $$;

notify pgrst, 'reload schema';
commit;
