-- A device capability can read current drawings linked to its Task's current
-- primary Step. This does not grant raw Artifact, physical-model or Storage access.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_volunteer_private.task_drawing_scope(p_project text,p_task text)
returns table(project_id text,task_id text,step_id uuid,step_title text,artifact_id uuid,revision integer,title text,status text,source_state text,source_reasons text[])
language sql stable security definer set search_path='' as $$
 select d.project_id,t.id,d.step_id,d.step_title,d.artifact_id,d.artifact_revision,d.title,d.status,
  case when physical.unavailable then 'unavailable' else d.source_state end,
  case when physical.unavailable then array['source_unavailable']::text[] else d.source_reasons end
 from bob.tasks t
 join bob.current_drawing_steps d on d.project_id=t.project_id and d.step_id=t.primary_step_id
 -- Invoker views execute as this definer. Check the Project's explicit physical
 -- scope here too; never impersonate an Auth user or inherit a household graph.
 cross join lateral(select exists(
   select 1 from (
    select m.building_id from bob.artifact_multifloor_plans m where m.project_id=d.project_id and m.artifact_id=d.artifact_id and m.artifact_revision=d.artifact_revision
    union select s.building_id from bob.artifact_stair_studies s where s.project_id=d.project_id and s.artifact_id=d.artifact_id and s.artifact_revision=d.artifact_revision
   ) required where not exists(
    select 1 from bob.project_physical_scope scope join bob.buildings b on b.id=required.building_id
    where scope.project_id=d.project_id and ((scope.target_kind='building' and scope.building_id=b.id)
      or (scope.target_kind='site' and scope.site_id=b.site_id)))
  ) unavailable) physical
 where t.project_id=p_project and t.id=p_task
$$;
revoke all on function bob_volunteer_private.task_drawing_scope(text,text) from public,anon,authenticated,service_role;

create function bob_volunteer_private.volunteer_drawings(p_secret text,p_task text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb;
begin
 if not exists(select 1 from bob.tasks where id=p_task and project_id=s.project_id) then raise exception 'Task unavailable.' using errcode='42501';end if;
 with candidates as (
  select * from bob_volunteer_private.task_drawing_scope(s.project_id,p_task)
  where p_after is null or artifact_id>p_after order by artifact_id limit 21
 ), page as (select * from candidates order by artifact_id limit 20)
 select jsonb_build_object('projectId',s.project_id,'taskId',p_task,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',artifact_id,'revision',revision,'title',title,'status',status,
    'stepId',step_id,'stepTitle',step_title,'sourceState',source_state,'sourceReasons',source_reasons) order by artifact_id) from page),'[]'::jsonb),
  'nextCursor',case when (select count(*) from candidates)>20 then (select artifact_id from page order by artifact_id desc limit 1) end) into result;
 return result;
end $$;

create function bob_volunteer_private.volunteer_drawing(p_secret text,p_task text,p_drawing uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb;
begin
 select jsonb_build_object('projectId',d.project_id,'taskId',d.task_id,'id',d.artifact_id,'revision',d.revision,
  'title',d.title,'status',d.status,'stepId',d.step_id,'stepTitle',d.step_title,'sourceState',d.source_state,'sourceReasons',d.source_reasons,
  'kind',a.kind,'description',a.description,'assumptions',a.assumptions,
  'content',case when d.source_state='unavailable' then null else jsonb_build_object(
   'imageId',a.source_media_id,
   'cad',case when cad.artifact_id is not null then jsonb_build_object(
     'recipe',jsonb_build_object('definitions',cad.recipe->'definitions'),
     'files',(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(cad.files) where key in('front','right','top','isometric')),
     'source_changed',d.source_state='changed') end,
   'parametricRecipe',box.recipe,
   'generation',case when g.artifact_id is not null then jsonb_build_object(
     'generator',g.generator,'generatorVersion',g.generator_version,'buildingId',g.building_id,'buildingName',g.building_name,
     'spaceId',g.space_id,'spaceName',g.space_name,'spaceRevision',g.space_revision,'currentSpaceRevision',g.current_space_revision,
     'spaceHasProposal',g.space_has_proposal,'studSpacingMm',g.parameters->'stud_spacing_mm',
     'inputs',(select jsonb_agg(jsonb_build_object('role',i.role,'id',i.measurement_id,'revision',i.measurement_revision,
       'subject',i.subject,'value',i.value,'unit',i.unit,'truth',i.truth,'source',i.source,'latestRevision',i.latest_revision,'archived',i.currently_archived) order by i.role)
       from bob.artifact_geometry_input_details i where i.project_id=d.project_id and i.artifact_id=d.artifact_id and i.artifact_revision=d.revision)) end,
   'roomLayout',case when room.artifact_id is not null then jsonb_build_object(
     'project_id',room.project_id,'artifact_id',room.artifact_id,'artifact_revision',room.artifact_revision,'building_id',room.building_id,
     'left_space_id',room.left_space_id,'left_space_revision',room.left_space_revision,'right_space_id',room.right_space_id,'right_space_revision',room.right_space_revision,
     'wall_element_id',room.wall_element_id,'wall_element_revision',room.wall_element_revision,'furniture_artifact_id',room.furniture_artifact_id,'furniture_revision',room.furniture_revision,
     'instance_id',room.instance_id,'parameters',room.parameters,'furniture_recipe',room.furniture_recipe,'left_name',room.left_name,'right_name',room.right_name,
     'wall_name',room.wall_name,'furniture_title',room.furniture_title,'furniture_area_id',null,
     'current_left_revision',room.current_left_revision,'current_right_revision',room.current_right_revision,'current_wall_revision',room.current_wall_revision,
     'current_furniture_revision',room.current_furniture_revision,'furniture_archived',room.furniture_archived,'physical_archived',room.physical_archived,
     'physical_pending',room.physical_pending,'context_available',room.context_available) end,
   'multifloorPlan',case when floors.artifact_id is not null then jsonb_build_object(
     'project_id',floors.project_id,'artifact_id',floors.artifact_id,'artifact_revision',floors.artifact_revision,'building_id',floors.building_id,
     'recipe',floors.recipe,'names',floors.names,'sources_changed',floors.sources_changed,'physical_pending',floors.physical_pending) end,
   'stairStudy',case when stair.artifact_id is not null then jsonb_build_object(
     'project_id',stair.project_id,'artifact_id',stair.artifact_id,'artifact_revision',stair.artifact_revision,'building_id',stair.building_id,
     'plan_id',stair.plan_id,'plan_revision',stair.plan_revision,'recipe',stair.recipe,'sources_changed',stair.sources_changed,
     'plan',jsonb_build_object('project_id',stair.plan->'project_id','artifact_id',stair.plan->'artifact_id','artifact_revision',stair.plan->'artifact_revision',
       'building_id',stair.plan->'building_id','recipe',stair.plan->'recipe','names',stair.plan->'names',
       'sources_changed',stair.plan->'sources_changed','physical_pending',stair.plan->'physical_pending')) end
  ) end) into result
 from bob_volunteer_private.task_drawing_scope(s.project_id,p_task) d
 join bob.artifact_revisions a on a.project_id=d.project_id and a.artifact_id=d.artifact_id and a.revision=d.revision
 left join bob.artifact_cad_revisions cad on cad.project_id=d.project_id and cad.artifact_id=d.artifact_id and cad.artifact_revision=d.revision
 left join bob.artifact_parametric_recipes box on box.project_id=d.project_id and box.artifact_id=d.artifact_id and box.artifact_revision=d.revision
 left join bob.artifact_generation_details g on g.project_id=d.project_id and g.artifact_id=d.artifact_id and g.artifact_revision=d.revision
 left join bob.artifact_room_layout_details room on room.project_id=d.project_id and room.artifact_id=d.artifact_id and room.artifact_revision=d.revision
 left join bob.artifact_multifloor_details floors on floors.project_id=d.project_id and floors.artifact_id=d.artifact_id and floors.artifact_revision=d.revision
 left join bob.artifact_stair_details stair on stair.project_id=d.project_id and stair.artifact_id=d.artifact_id and stair.artifact_revision=d.revision
 where d.artifact_id=p_drawing and d.revision=p_revision;
 if result is null then raise exception 'Drawing unavailable or changed. Refresh the task to see its current drawings.' using errcode='42501';end if;
 return result;
end $$;

-- Only the byte proxy may obtain a storage path, and it supplies the exact drawing
-- revision both before and after download. Never widen the ordinary image RPC.
create function bob_volunteer_private.volunteer_drawing_media(p_secret text,p_task text,p_drawing uuid,p_revision integer,p_media uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb;
begin
 select jsonb_build_object('bucket',m.bucket_id,'path',m.object_path,'contentType',m.content_type,'byteSize',m.byte_size) into result
 from bob_volunteer_private.task_drawing_scope(s.project_id,p_task) d
 join bob.artifact_revisions a on a.project_id=d.project_id and a.artifact_id=d.artifact_id and a.revision=d.revision
 join bob.media_assets m on m.project_id=d.project_id and m.id=a.source_media_id and m.state='ready'
 where d.artifact_id=p_drawing and d.revision=p_revision and d.source_state<>'unavailable' and m.id=p_media;
 if result is null then raise exception 'Image unavailable.' using errcode='42501';end if;
 return result;
end $$;
create function bob.volunteer_drawings(p_secret text,p_task text,p_after uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_drawings(p_secret,p_task,p_after) $$;
create function bob.volunteer_drawing(p_secret text,p_task text,p_drawing uuid,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_drawing(p_secret,p_task,p_drawing,p_revision) $$;
create function bob.volunteer_drawing_media(p_secret text,p_task text,p_drawing uuid,p_revision integer,p_media uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_drawing_media(p_secret,p_task,p_drawing,p_revision,p_media) $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('bob','bob_volunteer_private') and p.proname in('volunteer_drawings','volunteer_drawing','volunteer_drawing_media') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
  if f.proname<>'volunteer_drawing_media' then execute format('grant execute on function %s to anon,authenticated',f.signature);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
