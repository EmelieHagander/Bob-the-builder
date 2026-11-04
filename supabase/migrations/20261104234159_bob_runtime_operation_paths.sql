begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Routing reads must not serialize CAD recipes, annotations, files or exports.
create function bob.read_drawing_identity(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select jsonb_build_object('projectId',h.project_id,'artifact_id',h.id,'revision',r.revision,'current_revision',h.current_revision,
  'title',r.title,'archived',r.archived,'area_id',h.area_id,'component_id',c.component_id,'step_id',c.step_id,
  'source_kind',case when s.artifact_id is not null then 'shell' else 'cad' end,
  'construction_source',case when d.construction_artifact_id is not null then jsonb_build_object('project_id',d.project_id,'artifact_id',d.construction_artifact_id,'revision',d.construction_revision) end,
  'current_step_ids',coalesce((select jsonb_agg(x.step_id order by x.step_id) from bob.current_drawing_steps x where x.project_id=p_project and x.artifact_id=h.id),'[]'::jsonb))
 into result from bob.artifacts h join bob.artifact_revisions r on r.artifact_id=h.id and r.project_id=h.project_id and r.revision=coalesce(p_revision,h.current_revision)
 left join bob.artifact_cad_revisions c on c.project_id=h.project_id and c.artifact_id=h.id and c.artifact_revision=r.revision
 left join bob.artifact_cad_shell_revisions s on s.project_id=h.project_id and s.artifact_id=h.id and s.artifact_revision=r.revision
 left join bob.artifact_construction_drawings d on d.project_id=h.project_id and d.drawing_artifact_id=h.id and d.drawing_revision=r.revision
 where h.project_id=p_project and h.id=p_artifact and (c.artifact_id is not null or s.artifact_id is not null);
 return result;
end $$;

-- Select and bound the section before it crosses the Data API/Edge boundary.
create function bob.read_cad_section(p_project text,p_artifact uuid,p_revision integer,p_path text[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare value jsonb; part text; base jsonb; bytes integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_revision is null or p_revision<1 or p_path is null or cardinality(p_path)>8 or exists(select 1 from unnest(p_path) x where x is null or length(x)>100 or x in ('__proto__','prototype','constructor')) then raise exception 'invalid_section' using errcode='22023'; end if;
 base:=jsonb_build_object('projectId',p_project,'record_id',p_artifact,'revision',p_revision,'path',to_jsonb(p_path));
 value:=bob.read_cad_artifact(p_project,p_artifact,p_revision);
 foreach part in array p_path loop
  if jsonb_typeof(value)='array' then
   if part!~'^(0|[1-9][0-9]{0,8})$' then value:=null;exit;end if;
   value:=value->part::integer;
  elsif jsonb_typeof(value)='object' then value:=value->part;
  else value:=null;exit;end if;
 end loop;
 if value is null or value='null'::jsonb then return base||jsonb_build_object('status','not_found');end if;
 bytes:=octet_length(value::text);
 if bytes>24000 then
  return base||jsonb_build_object('status','too_large')||case jsonb_typeof(value)
   when 'array' then jsonb_build_object('array_length',jsonb_array_length(value))
   when 'object' then jsonb_build_object('keys',(select jsonb_agg(k order by k) from jsonb_object_keys(value) k))
   else jsonb_build_object('string_length',length(value#>>'{}')) end;
 end if;
 return base||jsonb_build_object('status','ok','data',value);
end $$;

-- A read-only preflight of the same project/target relation checked by link_media.
-- Attachment can still change after this read; generated media remains reusable.
create function bob.read_image_target(p_project text,p_kind text,p_target text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare target_project text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_kind='project' and p_target=p_project then target_project:=p_project;
 elsif p_kind='area' then select project_id into target_project from bob.areas where id=p_target;
 elsif p_kind='task' then select a.project_id into target_project from bob.tasks t join bob.areas a on a.id=t.area_id where t.id=p_target;
 elsif p_kind in ('step','plan_step') and p_target~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then
  if p_kind='step' then select project_id into target_project from bob.task_steps where id=p_target::uuid;
  else select s.project_id into target_project from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=p_target::uuid;end if;
 end if;
 if target_project is distinct from p_project then return jsonb_build_object('status','not_found','projectId',p_project);end if;
 return jsonb_build_object('status','ready','projectId',p_project,'target_kind',p_kind,'target_id',p_target);
end $$;

-- Opaque selection references are minted in the runtime from this small,
-- caller-authorized inventory. It contains no geometry or private request text.
create function bob.read_worker_operation_scope(p_project text,p_source uuid default null,p_revision integer default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare entries jsonb; source jsonb; source_area text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_source is not null then
  select jsonb_build_object('artifact_id',a.id,'revision',a.revision),a.area_id into source,source_area
   from bob.current_artifacts a join bob.artifact_construction_revisions c on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision
   where a.project_id=p_project and a.id=p_source and not a.archived and a.revision=p_revision;
  if source is null then return jsonb_build_object('status','conflict','projectId',p_project,'reason','operation_source_changed');end if;
 end if;
 select coalesce(jsonb_agg(value order by value->>'kind',value->>'id'),'[]') into entries from (
  select jsonb_build_object('kind','construction','id',a.id,'revision',a.revision,'label',a.title,'area_id',a.area_id,'target_revision',a.target_revision,'component_id',null) value
   from bob.current_artifacts a join bob.artifact_construction_revisions c on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision
   where a.project_id=p_project and not a.archived and (p_source is null or a.id=p_source)
  union all
  select jsonb_build_object('kind',case when s.artifact_id is not null then 'shell' else 'drawing' end,'id',a.id,'revision',a.revision,'label',a.title,'area_id',a.area_id,'parent',d.construction_artifact_id)
   from bob.current_artifacts a left join bob.artifact_cad_revisions c on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision
   left join bob.artifact_cad_shell_revisions s on s.project_id=a.project_id and s.artifact_id=a.id and s.artifact_revision=a.revision
   left join bob.artifact_construction_drawings d on d.project_id=a.project_id and d.drawing_artifact_id=a.id and d.drawing_revision=a.revision
   where a.project_id=p_project and not a.archived and (c.artifact_id is not null or s.artifact_id is not null)
  union all
  select jsonb_build_object('kind','step','id',s.step_id,'revision',s.plan_revision,'label',s.title) from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project
  union all
  select jsonb_build_object('kind','plan_requirement','id',r.requirement_id,'revision',r.plan_revision,'label',r.title,'parent',r.step_id) from bob.project_plan_requirements r join bob.project_plans p on p.project_id=r.project_id and p.current_revision=r.plan_revision where r.project_id=p_project
  union all
  select jsonb_build_object('kind','task','id',t.id,'revision',0,'label',t.name) from bob.tasks t join bob.areas a on a.id=t.area_id where a.project_id=p_project
  union all
  select jsonb_build_object('kind','requirement','id',r.id,'revision',r.revision,'label',r.name,'parent',cs.artifact_id,'definition_id',cs.definition_id,'quantity_mode',cs.quantity_mode) from bob.current_material_requirements r left join bob.material_requirement_construction_sources cs on cs.project_id=r.project_id and cs.requirement_id=r.id and cs.requirement_revision=r.revision where r.project_id=p_project and not r.archived
  union all
  select jsonb_build_object('kind','cut_plan','id',p.id,'revision',p.current_revision,'label','Cut plan','parent',p.artifact_id) from bob.material_cut_plans p where p.project_id=p_project and (p_source is null or p.artifact_id=p_source)
  union all
  select jsonb_build_object('kind','stock','id',s.id,'revision',s.revision,'label',s.name) from bob.current_stock_items s where s.project_id=p_project
  union all
  select jsonb_build_object('kind','product','id',s.id,'revision',s.current_revision,'label',r.title) from bob.supplier_articles s join bob.supplier_article_revisions r on r.project_id=s.project_id and r.article_id=s.id and r.revision=s.current_revision where s.project_id=p_project
 ) q;
 if octet_length(entries::text)>180000 then return jsonb_build_object('status','needs_data','projectId',p_project,'reason','operation_scope_requires_focus');end if;
 return jsonb_build_object('status','ready','projectId',p_project,'source',source,'area_id',source_area,'entries',entries);
end $$;
create function bob.check_worker_operation_refs(p_project text,p_refs jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare r jsonb; matched boolean; identity uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_refs is null or jsonb_typeof(p_refs)<>'array' or jsonb_array_length(p_refs)>1000 then return false;end if;
 for r in select value from jsonb_array_elements(p_refs) loop
  matched:=false;
  if r->>'kind'='task' then select exists(select 1 from bob.tasks t join bob.areas a on a.id=t.area_id where a.project_id=p_project and t.id=r->>'id') into matched;
  elsif r->>'kind'='gap' then
   if coalesce(r->>'parent','')!~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then return false;end if;
   select exists(select 1 from jsonb_array_elements(bob.drawing_request_work(p_project,(r->>'parent')::uuid)->'gaps') g where g->>'id'=r->>'id') into matched;
  else
   if coalesce(r->>'id','')!~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' or coalesce(r->>'revision','')!~'^[0-9]{1,9}$' then return false;end if;
   identity:=(r->>'id')::uuid;
   if r->>'kind' in ('construction','drawing','shell') then
    select exists(select 1 from bob.current_artifacts a where a.project_id=p_project and a.id=identity and a.revision=(r->>'revision')::integer and not a.archived and case r->>'kind'
     when 'construction' then exists(select 1 from bob.artifact_construction_revisions c where c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision)
     when 'drawing' then exists(select 1 from bob.artifact_cad_revisions c where c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision)
     when 'shell' then exists(select 1 from bob.artifact_cad_shell_revisions c where c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision) end) into matched;
   elsif r->>'kind'='step' then select exists(select 1 from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=identity and s.plan_revision=(r->>'revision')::integer) into matched;
   elsif r->>'kind'='plan_requirement' then select exists(select 1 from bob.project_plan_requirements s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.requirement_id=identity and s.plan_revision=(r->>'revision')::integer) into matched;
   elsif r->>'kind'='requirement' then select exists(select 1 from bob.current_material_requirements s where s.project_id=p_project and s.id=identity and s.revision=(r->>'revision')::integer and not s.archived) into matched;
   elsif r->>'kind'='cut_plan' then select exists(select 1 from bob.material_cut_plans s where s.project_id=p_project and s.id=identity and s.current_revision=(r->>'revision')::integer) into matched;
   elsif r->>'kind'='stock' then select exists(select 1 from bob.current_stock_items s where s.project_id=p_project and s.id=identity and s.revision=(r->>'revision')::integer) into matched;
   elsif r->>'kind'='product' then select exists(select 1 from bob.supplier_articles s where s.project_id=p_project and s.id=identity and s.current_revision=(r->>'revision')::integer) into matched;
   elsif r->>'kind'='request' then select exists(select 1 from jsonb_array_elements(bob.project_drawing_requests(p_project,identity,null)->'requests') s where s->>'id'=identity::text and (s->>'revision')::integer=(r->>'revision')::integer) into matched;
   end if;
  end if;
  if not matched then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function bob.check_worker_operation_refs(text,jsonb) from public,anon,service_role;
grant execute on function bob.check_worker_operation_refs(text,jsonb) to authenticated;

revoke all on function bob.read_worker_operation_scope(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_worker_operation_scope(text,uuid,integer) to authenticated;

revoke all on function bob.read_drawing_identity(text,uuid,integer),bob.read_cad_section(text,uuid,integer,text[]),bob.read_image_target(text,text,text) from public,anon,service_role;
grant execute on function bob.read_drawing_identity(text,uuid,integer),bob.read_cad_section(text,uuid,integer,text[]),bob.read_image_target(text,text,text) to authenticated;

-- The material owner must be able to reopen outputs and stock through the
-- existing authorized reader. No prompt/model settings or old manifests change.
do $runtime_operation_reads$
declare prior shared.ai_prompt_versions; def jsonb; key text; version_id uuid; next_version integer; activation jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtext('ai_catalog:bob'));
 foreach key in array array['bob.tools','role.materials-worker'] loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=key and p.retired_at is null for update of p;
  if not found then raise exception 'operation_catalog_missing: %',key;end if;
  def:=prior.definition;
  if key='bob.tools' then
   if not (def#>'{workers,materials,reads}') ? 'read_project_work' then
    def:=jsonb_set(def,'{workers,materials,reads}',(def#>'{workers,materials,reads}')||'"read_project_work"'::jsonb);
   end if;
  else
   if not (def->'tool_keys') ? 'tools.read_project_work' then
    def:=jsonb_set(def,'{tool_keys}',(def->'tool_keys')||'"tools.read_project_work"'::jsonb);
   end if;
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-runtime-operation-reads-v1'),
    prior.content,def,prior.flow,prior.available_variables) returning id into version_id;
  activation:=activation||jsonb_build_object(key,version_id);
 end loop;
 perform shared.activate_ai_catalog('bob',activation);
end $runtime_operation_reads$;

notify pgrst,'reload schema';
commit;
