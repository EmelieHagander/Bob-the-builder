-- 2026-10-08: a shell drawing feeds the living plan. Each piece shows the plan
-- Steps it is linked to (the existing artifact_step_links that link_project_drawing
-- writes), and the shell sums the pieces' existing material requirements. The shell
-- owns no links and no materials: it only reads what its pieces already have.
-- Bob links many pieces in one claimed-turn write (link_cad_shell_steps).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter function bob.read_cad_shell(text,uuid,integer) rename to read_cad_shell_pieces;
alter function bob.read_cad_shell_pieces(text,uuid,integer) set schema bob_private;
revoke all on function bob_private.read_cad_shell_pieces(text,uuid,integer) from public,anon;
grant execute on function bob_private.read_cad_shell_pieces(text,uuid,integer) to authenticated,service_role;

-- Same read model plus, per piece, its current plan Steps (build order = Step
-- position) and its current material requirements, and one shell-level summary.
-- A piece placed twice is counted once, and the repeat is named, never silently
-- multiplied or dropped. A piece without requirements is "not counted", never zero.
create function bob.read_cad_shell(p_project text,p_shell uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare base jsonb; comps jsonb; summary jsonb;
begin
 base:=bob_private.read_cad_shell_pieces(p_project,p_shell,p_revision);
 if base is null then return null; end if;
 with c as (
  select e.v,e.o,(e.v->>'child_artifact_id')::uuid aid,(e.v->>'child_revision')::integer pinned,
   first_value(e.v->>'component_key') over(partition by e.v->>'child_artifact_id' order by e.o) first_key
  from jsonb_array_elements(base->'components') with ordinality e(v,o)
 ), st as (
  select c.o,coalesce(jsonb_agg(jsonb_build_object('id',s.step_id,'title',s.title,'position',s.position,'state',s.state) order by s.position)
   filter(where s.step_id is not null),'[]'::jsonb) steps
  from c
  left join bob.artifact_step_links l on l.project_id=p_project and l.artifact_id=c.aid
  left join bob.project_plans p on p.project_id=l.project_id
  left join bob.project_plan_steps s on s.project_id=p.project_id and s.plan_revision=p.current_revision and s.step_id=l.step_id
  group by c.o
 ), mr as (
  select c.o,coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'name',r.name,'category',r.category,'unit',r.unit,
    'required_quantity',r.required_quantity::text,'artifact_revision',r.artifact_revision,
    'from_pinned_version',r.artifact_revision=c.pinned,'needs_review',coalesce(r.artifact_changed or r.target_changed,false))
   order by r.name,r.id) filter(where r.id is not null),'[]'::jsonb) lines
  from c left join bob.current_material_requirements r on r.project_id=p_project and r.artifact_id=c.aid and not r.archived
  group by c.o
 )
 select jsonb_agg(c.v||jsonb_build_object('steps',st.steps,'materials',mr.lines,
   'counted_with',case when c.first_key<>c.v->>'component_key' then c.first_key end) order by c.o)
 into comps from c join st on st.o=c.o join mr on mr.o=c.o;
 comps:=coalesce(comps,'[]'::jsonb);
 -- Totals add each distinct piece's requirements once, grouped by name and unit.
 with lines as (
  select x->>'component_key' piece,l
  from jsonb_array_elements(comps) x, jsonb_array_elements(x->'materials') l
  where x->'counted_with' is null or x->'counted_with'='null'::jsonb
 )
 select jsonb_build_object(
  'totals',coalesce((select jsonb_agg(t order by t->>'name',t->>'unit') from (
    select jsonb_build_object('name',min(l->>'name'),'unit',l->>'unit','required_quantity',sum((l->>'required_quantity')::numeric)::text,
     'lines',count(*),'pieces',jsonb_agg(distinct piece),'needs_review',count(*) filter(where (l->>'needs_review')::boolean or not (l->>'from_pinned_version')::boolean)) t
    from lines group by lower(btrim(l->>'name')),l->>'unit') g),'[]'::jsonb),
  'counted_pieces',(select count(distinct piece) from lines),
  'not_counted',coalesce((select jsonb_agg(x->>'component_key' order by x->>'component_key') from jsonb_array_elements(comps) x
    where jsonb_array_length(x->'materials')=0),'[]'::jsonb),
  'counted_once',coalesce((select jsonb_agg(jsonb_build_object('component_key',x->>'component_key','counted_with',x->>'counted_with') order by x->>'component_key')
    from jsonb_array_elements(comps) x where jsonb_typeof(x->'counted_with')='string'),'[]'::jsonb),
  'not_in_plan',coalesce((select jsonb_agg(x->>'component_key' order by x->>'component_key') from jsonb_array_elements(comps) x
    where jsonb_array_length(x->'steps')=0),'[]'::jsonb)
 ) into summary;
 return base||jsonb_build_object('components',comps,'plan_summary',summary);
end $$;
revoke all on function bob.read_cad_shell(text,uuid,integer) from public,anon;
grant execute on function bob.read_cad_shell(text,uuid,integer) to authenticated,service_role;

-- Bob links (or unlinks) several shell pieces to current plan Steps in one write.
-- Links are the same artifact_step_links rows link_project_drawing writes, held by
-- the pieces; the shell revision is only the read the call was based on.
alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_shell_steps;
revoke all on function bob_private.bob_project_write_before_shell_steps(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; existing bob_private.bob_write_receipts; msg text; op text; before_row jsonb; rec jsonb; result jsonb;
 aid uuid; expected integer; r bob.artifact_revisions; link jsonb; child uuid; sid uuid;
begin
 if p_payload->>'kind' is distinct from 'cad_shell_steps' then return bob_private.bob_project_write_before_shell_steps(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>16000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$' or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or coalesce(p_payload->>'record_id','')!~'^[0-9a-fA-F-]{36}$'
  or jsonb_typeof(d) is distinct from 'object' or d-'links'<>'{}' or jsonb_typeof(d->'links') is distinct from 'array' or jsonb_array_length(d->'links') not between 1 and 64
  or exists(select 1 from jsonb_array_elements(d->'links') x where jsonb_typeof(x) is distinct from 'object' or x-array['component_key','step_id','action']<>'{}'
   or (select count(*) from jsonb_object_keys(x))<>3 or coalesce(x->>'action','') not in ('link','unlink') or coalesce(x->>'step_id','')!~'^[0-9a-fA-F-]{36}$'
   or jsonb_typeof(x->'component_key') is distinct from 'string')
  or (select count(*) from jsonb_array_elements(d->'links') x)<>(select count(distinct (x->>'component_key',lower(x->>'step_id'))) from jsonb_array_elements(d->'links') x)
 then raise exception 'cad_shell_invalid' using errcode='22023'; end if;
 aid:=(p_payload->>'record_id')::uuid; expected:=(p_payload->>'expected_revision')::integer;
 op:='cad_shell_steps:'||aid::text||':'||expected||':'||md5((d->'links')::text);
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 perform 1 from bob.project_plans where project_id=p_project for share;
 select ar.* into r from bob.artifacts a join bob.artifact_revisions ar on ar.artifact_id=a.id and ar.revision=a.current_revision
  join bob.artifact_cad_shell_revisions s on s.artifact_id=a.id and s.artifact_revision=a.current_revision where a.id=aid and a.project_id=p_project;
 if not found then raise exception 'cad_shell_unavailable' using errcode='22023'; end if;
 if r.archived then raise exception 'cad_shell_archived' using errcode='22023'; end if;
 if r.revision<>expected then raise exception 'cad_shell_changed' using errcode='40001'; end if;
 select coalesce(jsonb_object_agg(k.child_artifact_id::text,(select coalesce(jsonb_agg(l.step_id order by l.step_id),'[]'::jsonb) from bob.artifact_step_links l
   where l.project_id=p_project and l.artifact_id=k.child_artifact_id)),'{}'::jsonb) into before_row
  from (select distinct child_artifact_id from bob.artifact_cad_shell_components where shell_artifact_id=aid and shell_revision=r.revision) k;
 for link in select * from jsonb_array_elements(d->'links') loop
  select child_artifact_id into child from bob.artifact_cad_shell_components where shell_artifact_id=aid and shell_revision=r.revision and component_key=link->>'component_key';
  if not found then raise exception 'cad_shell_unknown_component' using errcode='22023'; end if;
  sid:=(link->>'step_id')::uuid;
  if link->>'action'='link' then
   if not exists(select 1 from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision
    where s.project_id=p_project and s.step_id=sid) then raise exception 'cad_shell_step_unavailable' using errcode='22023'; end if;
   if exists(select 1 from bob.current_artifacts where id=child and project_id=p_project and archived) then raise exception 'cad_shell_piece_archived' using errcode='22023'; end if;
   insert into bob.artifact_step_links values(p_project,child,sid) on conflict do nothing;
  else
   delete from bob.artifact_step_links where project_id=p_project and artifact_id=child and step_id=sid;
  end if;
 end loop;
 rec:=bob.read_cad_shell(p_project,aid,null);
 result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',aid,'revision',r.revision,'areaId',rec->'area_id',
  'label','Shell drawing '||(rec->>'title'),'operation','updated','savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,jsonb_build_object('step_ids_by_piece',before_row),result);
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('link_cad_shell_steps',
 'Link the pieces of a shell drawing to current plan Steps in one go, or unlink them.',
 'Read the shell with read_cad_shell and the current plan first. Each link names a component_key from the shell and an exact current Step id; the link is held by the piece, as link_project_drawing would. Use the shell revision as expected_revision. Link each piece to the Step that builds it, in build order (for example walls before the bed that stands against them). When a piece has no fitting Step, add the Step with edit_project_plan first, then link. One piece can serve several Steps.',
 1,false,array['design','planning'],true);
update bob.tool_catalog set how_to=how_to||' Each piece also lists its linked plan Steps and its material requirements; plan_summary sums the pieces'' requirements by name and unit, lists pieces not counted yet (no requirement) and pieces not in the plan yet. A piece placed twice is counted once and named in counted_once. Link pieces to Steps with link_cad_shell_steps.' where name='read_cad_shell';
notify pgrst,'reload schema';
commit;
