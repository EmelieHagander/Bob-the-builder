begin;
alter table bob.media_links add column plan_step_id uuid;
alter table bob.media_links drop constraint media_links_check;
alter table bob.media_links add constraint media_links_one_target check(num_nonnulls(area_id,task_id,step_id,plan_step_id)=1);
create unique index media_links_plan_step_unique on bob.media_links(media_id,plan_step_id);
create index media_links_plan_step_idx on bob.media_links(project_id,plan_step_id);
alter table bob.media_assets drop constraint media_assets_source_kind_check;
alter table bob.media_assets add constraint media_assets_source_kind_check check(source_kind in ('user_upload','ai_generated'));

create or replace function bob_private.link_media(p_project text,p_media uuid,p_kind text,p_target text)
returns void language plpgsql security definer set search_path='' as $$
declare target_project text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.media_assets where id=p_media and project_id=p_project and state<>'deleting' for update;
 if not found then raise exception 'Image unavailable'; end if;
 if p_kind='project' and p_target=p_project then return;
 elsif p_kind='area' then select project_id into target_project from bob.areas where id=p_target for share;
 elsif p_kind='task' then select a.project_id into target_project from bob.tasks t join bob.areas a on a.id=t.area_id where t.id=p_target for share of t;
 elsif p_kind='step' then select project_id into target_project from bob.task_steps where id=p_target::uuid for share;
 elsif p_kind='plan_step' then select s.project_id into target_project from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=p_target::uuid;
 else raise exception 'Invalid image attachment'; end if;
 if target_project is distinct from p_project then raise exception 'project_denied' using errcode='42501'; end if;
 insert into bob.media_links(project_id,media_id,area_id,task_id,step_id,plan_step_id) values(p_project,p_media,
 case when p_kind='area' then p_target end,case when p_kind='task' then p_target end,case when p_kind='step' then p_target::uuid end,case when p_kind='plan_step' then p_target::uuid end) on conflict do nothing;
end $$;

create function bob_private.bob_project_write_v10(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text:=p_payload->>'kind'; d jsonb:=p_payload->'data'; quote text:=p_payload->>'request_quote';
 rid uuid; msg text; op text; existing bob_private.bob_write_receipts; rec jsonb; result jsonb;
begin
 if kind<>all(array['image_reserve','image_finalize','image_link']) then return bob_private.bob_project_write_v9(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'
 or (select count(*) from jsonb_object_keys(p_payload))<>6 or octet_length(p_payload::text)>16000 or jsonb_typeof(d)<>'object'
 or coalesce(char_length(quote),0) not between 1 and 500 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or p_payload->'expected_revision' is distinct from 'null'::jsonb then raise exception 'invalid_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 rid:=(p_payload->>'record_id')::uuid;if rid is null then raise exception 'invalid_write' using errcode='22023'; end if;
 op:=kind||':'||rid::text||case when kind='image_link' then ':'||coalesce(d->>'target_kind','')||':'||coalesce(d->>'target_id','') else '' end;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if; return existing.receipt; end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 if kind='image_reserve' then
  if d-array['title','byte_size','width','height','purpose','target_kind','target_id']::text[]<>'{}' or d->>'purpose' is null or d->>'purpose'<>all(array['proposal','instruction']) then raise exception 'invalid_write' using errcode='22023'; end if;
  rec:=bob_private.media_command(p_project,'reserve',rid,d||jsonb_build_object('original_name','generated.png','content_type','image/png'));
  update bob.media_assets set source_kind='ai_generated' where id=rid;
  rec:=rec||jsonb_build_object('source_kind','ai_generated');
 elsif kind='image_finalize' then
  if d<>'{}' then raise exception 'invalid_write' using errcode='22023'; end if;
  rec:=bob_private.media_command(p_project,'finalize',rid,d);
 else
  if d-array['target_kind','target_id']::text[]<>'{}' then raise exception 'invalid_write' using errcode='22023'; end if;
  rec:=bob_private.media_command(p_project,'link',rid,d);
 end if;
 result:=jsonb_build_object('projectId',p_project,'dataset','media','recordId',rid,'label',case when kind='image_reserve' then 'Pending image upload: '|| (rec->>'title') else rec->>'title' end,'operation',case when kind='image_reserve' then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,null,result);
 return result;
end $$;
create function bob.bob_project_write_v10(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v10(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v10(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v10(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v10(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v10(text,uuid,uuid,bigint,jsonb) to authenticated;
insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,is_enabled,metadata)
select 'bob','bob','project-image','global',model_name,'image',1000,true,'{"role":"project_illustration"}'::jsonb from shared.ai_models where supports_image_output and is_active order by model_name limit 1
on conflict(app,coworker_id,function_name,module_id) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('generate_project_image','Generate, save and attach a project mockup or instruction image.','Read existing image metadata before generating. Supply relevant project facts in prompt, purpose proposal/instruction and an exact target. plan_step means a living-plan Step, step means a Task instruction step. A partial upload is not a ready image; preserve its media_id for recovery.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('attach_project_image','Attach an existing image to the relevant project work.','Use an exact ready image ID. Reuse its bytes rather than uploading again. Link to the correct target identity; plan_step and step are distinct.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('finalize_project_image','Recover a previously uploaded pending image.','Use the pending media_id after upload succeeded but finalization failed. This never regenerates or uploads bytes. Storage metadata must match before the image becomes ready.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('read_project_record_section','Read sections of an oversized plan or CAD artifact.','Use after record_too_large or for an exact CAD recipe. Start with path=[] and follow returned keys or array indices to narrow the section. Plan record_id is the exact revision; CAD uses an Artifact ID plus revision. An inaccessible section is not proof the full record is absent.',1,false,array[]::text[],true) on conflict(name) do nothing;
notify pgrst,'reload schema';
commit;
