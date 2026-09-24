-- One reusable work relationship for every drawing kind. Geometry stays versioned.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_step_links (
 project_id text not null,
 artifact_id uuid not null,
 step_id uuid not null,
 primary key(project_id,artifact_id,step_id),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(project_id,step_id) references bob.project_plan_step_identities(project_id,step_id) on delete cascade
);
create index artifact_step_links_step_idx on bob.artifact_step_links(project_id,step_id);
create index artifact_step_links_artifact_idx on bob.artifact_step_links(artifact_id,project_id);
alter table bob.artifact_step_links enable row level security;
revoke all on bob.artifact_step_links from public,anon,authenticated;
grant select on bob.artifact_step_links to authenticated;
create policy project_read on bob.artifact_step_links for select to authenticated
 using(bob_private.has_project_access(project_id));

insert into bob.artifact_step_links
select c.project_id,c.artifact_id,c.step_id from bob.artifact_cad_revisions c
join bob.artifacts a on a.id=c.artifact_id and a.current_revision=c.artifact_revision
join bob.project_plan_step_identities s on s.project_id=c.project_id and s.step_id=c.step_id
on conflict do nothing;

-- CAD's revision scope is provenance; live work links can also be edited without
-- re-rendering. Archive/restore copies must not resurrect a removed work link.
create function bob_private.link_new_cad_work() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.step_id is not null and not exists(
  select 1 from bob.artifact_cad_revisions c where c.artifact_id=new.artifact_id
   and c.artifact_revision<new.artifact_revision and c.step_id=new.step_id
 ) then
  insert into bob.artifact_step_links values(new.project_id,new.artifact_id,new.step_id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function bob_private.link_new_cad_work() from public,anon,authenticated;
create trigger link_new_cad_work after insert on bob.artifact_cad_revisions
 for each row execute function bob_private.link_new_cad_work();

create view bob.current_drawing_steps with(security_invoker=true) as
select l.project_id,l.artifact_id,a.revision artifact_revision,a.title,a.status,l.step_id,s.title step_title
from bob.artifact_step_links l
join bob.current_artifacts a on a.id=l.artifact_id and a.project_id=l.project_id and not a.archived
join bob.project_plans p on p.project_id=l.project_id
join bob.project_plan_steps s on s.project_id=p.project_id and s.plan_revision=p.current_revision and s.step_id=l.step_id;

-- Preview bytes are explicitly selected only for visible cards. No STEP export,
-- full construction recipe, or historical CAD packet travels with the overview.
create view bob.current_drawing_overview with(security_invoker=true) as
select a.id,a.project_id,a.area_id,a.revision,a.title,a.status,a.recorded_at,
 a.source_media_id,
 coalesce(c.files->>'isometric',c.files->>'front',c.files->>'top',c.files->>'right') preview_svg,
 r.recipe parametric_recipe,
 coalesce((select jsonb_agg(jsonb_build_object('id',d.step_id,'title',d.step_title) order by d.step_title,d.step_id)
  from bob.current_drawing_steps d where d.project_id=a.project_id and d.artifact_id=a.id),'[]'::jsonb) steps
from bob.current_artifacts a
left join bob.artifact_cad_revisions c on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.revision
left join bob.artifact_parametric_recipes r on r.project_id=a.project_id and r.artifact_id=a.id and r.artifact_revision=a.revision
where not a.archived;
revoke all on bob.current_drawing_steps,bob.current_drawing_overview from public,anon,authenticated;
grant select on bob.current_drawing_steps,bob.current_drawing_overview to authenticated;

-- Keep writes inside Bob's existing caller/claimed-turn/receipt boundary.
create function bob_private.bob_project_write_v11(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; quote text:=p_payload->>'request_quote'; msg text;
 aid uuid; sid uuid; expected integer; op text; existing bob_private.bob_write_receipts;
 a bob.artifacts; rec jsonb; result jsonb; before_links jsonb;
begin
 if p_payload->>'kind' is distinct from 'drawing_link' then
  return bob_private.bob_project_write_v10(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or octet_length(p_payload::text)>4000
  or jsonb_typeof(d) is distinct from 'object' or d-array['step_id','action']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>2
  or coalesce(d->>'action','') not in ('link','unlink')
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or coalesce(char_length(quote),0) not between 1 and 500
  or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$' then
  raise exception 'invalid_write' using errcode='22023'; end if;
 aid:=(p_payload->>'record_id')::uuid; sid:=(d->>'step_id')::uuid;
 if aid is null or sid is null then raise exception 'invalid_write' using errcode='22023'; end if;
 expected:=(p_payload->>'expected_revision')::integer;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:='drawing_link:'||aid::text||':'||sid::text||':'||(d->>'action');
 select * into existing from bob_private.bob_write_receipts
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
  raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 perform 1 from bob.project_plans where project_id=p_project for share;
 select * into a from bob.artifacts where id=aid and project_id=p_project for update;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 if a.current_revision<>expected then raise exception 'record_changed' using errcode='40001'; end if;
 if not exists(select 1 from bob.project_plan_step_identities where project_id=p_project and step_id=sid) then
  raise exception 'project_denied' using errcode='42501'; end if;
 if d->>'action'='link' and (not exists(select 1 from bob.project_plan_steps s join bob.project_plans p
   on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=sid)
   or exists(select 1 from bob.current_artifacts where id=aid and archived)) then
  raise exception 'step_or_drawing_changed' using errcode='40001'; end if;
 select coalesce(jsonb_agg(step_id order by step_id),'[]'::jsonb) into before_links
  from bob.artifact_step_links where project_id=p_project and artifact_id=aid;
 if d->>'action'='link' then
  insert into bob.artifact_step_links values(p_project,aid,sid) on conflict do nothing;
 else delete from bob.artifact_step_links where project_id=p_project and artifact_id=aid and step_id=sid;
 end if;
 select to_jsonb(v)||jsonb_build_object('step_ids',(select coalesce(jsonb_agg(step_id order by step_id),'[]'::jsonb)
  from bob.artifact_step_links where project_id=p_project and artifact_id=aid)) into rec from bob.current_artifacts v where id=aid;
 result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',aid,'revision',expected,'areaId',a.area_id,
  'label',rec->>'title','operation','updated','savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
  values(p_project,auth.uid(),p_turn,op,p_payload,jsonb_build_object('step_ids',before_links),result);
 return result;
end $$;
create function bob.bob_project_write_v11(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.bob_project_write_v11(p_project,p_thread,p_turn,p_generation,p_payload)
$$;
revoke all on function bob_private.bob_project_write_v11(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v11(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v11(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v11(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
values('link_project_drawing','Link or unlink a saved drawing and a project Step without redrawing.',
 'Read the current drawing revision and plan Step IDs. Reuse the same drawing across relevant Steps. The project home shows saved drawings automatically. Planning is a phase; attach to the work the drawing describes.',1,false,array[]::text[],true);
update bob.tool_catalog set how_to=how_to||' Dataset drawing returns current metadata and linked work Steps by Artifact ID and exact revision, without geometry.' where name='read_project_record_section';
update bob.tool_catalog set how_to=how_to||' Read existing links using read_project_record_section with dataset drawing.' where name='link_project_drawing';
commit;
