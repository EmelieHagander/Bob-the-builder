-- Additive, caller-RLS research pages. The original lookup remains unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function bob.search_bob_project_data_v2(
  p_project_id text, p_dataset text, p_query text default null,
  p_status text default null, p_area_id text default null, p_record_id text default null, p_after_id text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_rows jsonb := '[]'; v_links jsonb := '[]'; v_truncated boolean := false; v_result jsonb; v_more boolean:=false;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset <> all(array['project','areas','tasks','materials','crew','events','announcements','measurements','components','solutions','target','artifacts','requirements'])
    or length(coalesce(p_query,'')) > 200 or length(coalesce(p_record_id,'')) > 200
    or length(coalesce(p_area_id,'')) > 200 or length(coalesce(p_after_id,'')) > 200
    or (p_area_id is not null and p_dataset <> all(array['tasks','measurements','components','solutions','target','artifacts','requirements']))
    or (p_status is not null and not (
      (p_dataset = 'tasks' and p_status = any(array['todo','doing','done','blocked'])) or
      (p_dataset = 'materials' and p_status = any(array['needed','ordered','delivered','backorder'])) or
      (p_dataset = 'events' and p_status = any(array['going','open'])))) then
    raise exception 'invalid_lookup' using errcode = '22023';
  end if;
  case p_dataset
    when 'project' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'location', r.location, 'type', r.type, 'start_label', r.start_label, 'start_date', r.start_date, 'end_date', r.end_date, 'updated_at', r.updated_at) as item
        from bob.projects r
        where r.id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'areas' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'lead_id', r.lead_id, 'updated_at', r.updated_at) as item
        from bob.areas r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'tasks' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'area_id', r.area_id, 'name', r.name, 'skill', r.skill, 'hours', r.hours, 'status', r.status, 'materials', r.materials, 'instructions', r.instructions, 'updated_at', r.updated_at, 'area_name', a.name) as item
        from bob.tasks r join bob.areas a on a.id = r.area_id
        where a.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.materials, r.instructions, a.name))) > 0)
          and (p_status is null or r.status::text = p_status)
          and (p_area_id is null or r.area_id = p_area_id)
        order by r.id limit 26
      ) bounded;
    when 'materials' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'qty', r.qty, 'area_label', r.area_label, 'supplier', r.supplier, 'status', r.status, 'cost', r.cost, 'category', r.category, 'updated_at', r.updated_at) as item
        from bob.materials r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.area_label, r.supplier))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'crew' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'updated_at', r.updated_at) as item
        from bob.people r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.role))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'events' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'title', r.title, 'day', r.day, 'time', r.time, 'place', r.place, 'spots', r.spots, 'status', r.status, 'updated_at', r.updated_at) as item
        from bob.events r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.title, r.place))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'announcements' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'text', r.text, 'pinned', r.pinned, 'time_label', r.time_label, 'author_id', r.author_id, 'updated_at', r.updated_at) as item
        from bob.announcements r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.text))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'measurements' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'subject', r.subject,'area_id', r.area_id,'component_id', r.component_id,'value', r.value,'unit', r.unit,'millimetres', r.millimetres,'truth', r.truth,'source', r.source,'notes', r.notes,'required', r.required,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_measurements r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.subject,r.source,r.notes)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'components' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'name', r.name,'area_id', r.area_id,'kind', r.kind,'quantity', r.quantity,'condition', r.condition,'specification', r.specification,'intent', r.intent,'notes', r.notes,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_components r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.name,r.kind,r.specification,r.notes)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'solutions' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'title', r.title,'area_id', r.area_id,'description', r.description,'assumptions', r.assumptions,'tradeoffs', r.tradeoffs,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_solutions r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.title,r.description,r.assumptions,r.tradeoffs)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'target' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.scope_key id,jsonb_build_object('id',r.scope_key,'area_id',r.area_id,'scope_key',r.scope_key,'revision',r.revision,'reason',r.reason,'updated_at',r.recorded_at,
          'solution_id',r.solution_id,'solution_revision',r.solution_revision,'title',chosen.title,
          'description',chosen.description,'assumptions',chosen.assumptions,'tradeoffs',chosen.tradeoffs,'archived',chosen.archived) item
        from bob.current_target r left join bob.solution_revisions chosen on chosen.solution_id=r.solution_id and chosen.revision=r.solution_revision and chosen.project_id=r.project_id
        where r.project_id=p_project_id and (p_record_id is null or r.scope_key=p_record_id)
          and (p_after_id is null or r.scope_key>p_after_id) and (p_area_id is null or r.area_id=p_area_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.reason,chosen.title,chosen.description)))>0)
        order by r.scope_key limit 26
      ) bounded;
    when 'artifacts' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'title', r.title,'area_id', r.area_id,'kind', r.kind,'description', r.description,'status', r.status,'assumptions', r.assumptions,'revision', r.revision,'archived', r.archived,'target_revision', r.target_revision,'solution_id', r.solution_id,'solution_revision', r.solution_revision,'solution_title', r.solution_title,'updated_at', r.recorded_at) item
        from bob.current_artifacts r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.title,r.description,r.assumptions)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'requirements' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'name', r.name,'area_id', r.area_id,'task_id', r.task_id,'unit', r.unit,'required_quantity', r.required_quantity,'waste_percent', r.waste_percent,'required_with_waste', r.required_with_waste,'stock_quantity', r.stock_quantity,'component_quantity', r.component_quantity,'purchase_quantity', r.purchase_quantity,'source_kind', r.source_kind,'method_key', r.method_key,'basis', r.basis,'assumptions', r.assumptions,'revision', r.revision,'archived', r.archived,'target_revision', r.target_revision,'solution_id', r.solution_id,'solution_revision', r.solution_revision,'artifact_id', r.artifact_id,'artifact_revision', r.artifact_revision,'target_changed', r.target_changed,'artifact_changed', r.artifact_changed,'stock_changed', r.stock_changed,'component_changed', r.component_changed,'updated_at', r.recorded_at) item
        from bob.current_material_requirements r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.name,r.basis,r.assumptions)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
  end case;
  if jsonb_array_length(v_rows) > 25 then
    v_truncated := true;
    v_rows := v_rows - 25;
    v_more:=true;
  end if;

  -- Each query checks both relation ends even though RLS already does so.
  if p_dataset = 'tasks' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select t.id parent_id, p.id, jsonb_build_object('kind','assignee','parent_id',t.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.task_assignees ta join bob.tasks t on t.id = ta.task_id
      join bob.areas a on a.id = t.area_id
      join bob.people p on p.id = ta.person_id and p.project_id = a.project_id
      where a.project_id = p_project_id and t.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'target' then
    select coalesce(jsonb_agg(item order by parent_id,id),'[]'::jsonb) into v_links from (
      select t.scope_key parent_id,d.measurement_id::text id,jsonb_build_object('kind','selected_measurement','parent_id',t.scope_key,'area_id',t.area_id,'id',d.measurement_id::text,'subject',d.subject,'value',d.value,'unit',d.unit,'truth',d.truth,'source',d.source,
        'revision',d.measurement_revision,'latest_revision',d.latest_revision,'currently_archived',d.currently_archived) item
      from bob.solution_measurement_details d join bob.current_target t on t.project_id=d.project_id and t.solution_id=d.solution_id and t.solution_revision=d.solution_revision
      where d.project_id=p_project_id and t.scope_key in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.scope_key,d.measurement_id::text limit 26
    ) bounded;
  elsif p_dataset = 'artifacts' then
    select coalesce(jsonb_agg(item order by parent_id,id),'[]'::jsonb) into v_links from (
      select a.id::text parent_id,d.measurement_id::text id,jsonb_build_object('kind','drawing_measurement','parent_id',a.id::text,'id',d.measurement_id::text,'subject',d.subject,'value',d.value,'unit',d.unit,'truth',d.truth,'source',d.source,
        'revision',d.measurement_revision,'latest_revision',d.latest_revision,'currently_archived',d.currently_archived) item
      from bob.artifact_measurement_details d join bob.current_artifacts a on a.id=d.artifact_id and a.revision=d.artifact_revision and a.project_id=d.project_id
      where d.project_id=p_project_id and a.id::text in (select value->>'id' from jsonb_array_elements(v_rows)) order by a.id::text,d.measurement_id::text limit 26
    ) bounded;
  elsif p_dataset = 'crew' then
    select coalesce(jsonb_agg(item order by parent_id, name), '[]') into v_links from (
      select p.id parent_id, s.name, jsonb_build_object('kind','skill','parent_id',p.id,
        'id',jsonb_build_array(p.id,s.name)::text,'name',s.name,'level',s.level,'updated_at',null) item
      from bob.person_skills s join bob.people p on p.id = s.person_id
      where p.project_id = p_project_id and p.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by p.id, s.name limit 26
    ) bounded;
  elsif p_dataset = 'events' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select e.id parent_id, p.id, jsonb_build_object('kind','attendee','parent_id',e.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.event_attendees ea join bob.events e on e.id = ea.event_id
      join bob.people p on p.id = ea.person_id and p.project_id = e.project_id
      where e.project_id = p_project_id and e.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by e.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'announcements' then
    select coalesce(jsonb_agg(item order by parent_id), '[]') into v_links from (
      select a.id parent_id, jsonb_build_object('kind','author','parent_id',a.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.announcements a join bob.people p on p.id = a.author_id and p.project_id = a.project_id
      where a.project_id = p_project_id and a.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by a.id limit 26
    ) bounded;
  end if;
  if jsonb_array_length(v_links) > 25 then
    v_truncated := true;
    v_links := v_links - 25;
  end if;

  loop
    v_result := jsonb_build_object('records',v_rows,'related',v_links,'truncated',v_truncated,'next_cursor',case when v_more then v_rows->-1->>'id' else null end);
    -- Reserve room for the edge's provenance envelope within the 32 KiB cap.
    exit when octet_length(v_result::text) <= 30000;
    v_truncated := true;
    if jsonb_array_length(v_links) > 0 then
      v_links := v_links - (jsonb_array_length(v_links)-1);
    else
      if jsonb_array_length(v_rows)<=1 then raise exception 'lookup_record_too_large' using errcode='54000'; end if;
      v_rows := v_rows - (jsonb_array_length(v_rows)-1);
      v_more:=true;
    end if;
  end loop;
  return v_result;
end $$;
revoke all on function bob.search_bob_project_data_v2(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v2(text,text,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
