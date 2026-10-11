-- D: persisted affected-output work, beneath existing domain commands/receipts.
-- Actual UTC filename fallback after the installed migration CLI aborted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.construction_change_sets (
 id uuid primary key default gen_random_uuid(),
 project_id text not null,
 artifact_id uuid not null,
 from_revision integer not null,
 to_revision integer not null check(to_revision>from_revision),
 cause jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(project_id,artifact_id,to_revision),unique(id,project_id),
 foreign key(project_id,artifact_id,from_revision) references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision) on delete cascade,
 foreign key(project_id,artifact_id,to_revision) references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision) on delete cascade
);
create index construction_changes_from_idx on bob.construction_change_sets(project_id,artifact_id,from_revision);
create table bob.construction_change_items (
 id uuid primary key default gen_random_uuid(),
 change_id uuid not null,
 project_id text not null,
 kind text not null check(kind in ('drawing','requirement','cut_plan','step')),
 drawing_id uuid, requirement_id uuid, cut_plan_id uuid, step_id uuid,
 output_id uuid generated always as(coalesce(drawing_id,requirement_id,cut_plan_id,step_id)) stored,
 original_revision integer not null check(original_revision>0),
 state text not null default 'pending' check(state in ('pending','updated','retired','reviewed')),
 completed_revision integer,
 completion_receipt jsonb,
 review_note text,
 completed_at timestamptz,
 unique(change_id,kind,output_id),
 foreign key(change_id,project_id) references bob.construction_change_sets(id,project_id) on delete cascade,
 foreign key(drawing_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(drawing_id,original_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
 foreign key(drawing_id,completed_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
 foreign key(requirement_id,project_id) references bob.material_requirements(id,project_id) on delete cascade,
 foreign key(requirement_id,original_revision) references bob.material_requirement_revisions(requirement_id,revision) on delete cascade,
 foreign key(requirement_id,completed_revision) references bob.material_requirement_revisions(requirement_id,revision) on delete cascade,
 foreign key(cut_plan_id,project_id) references bob.material_cut_plans(id,project_id) on delete cascade,
 foreign key(cut_plan_id,original_revision) references bob.material_cut_plan_revisions(plan_id,revision) on delete cascade,
 foreign key(cut_plan_id,completed_revision) references bob.material_cut_plan_revisions(plan_id,revision) on delete cascade,
 foreign key(project_id,step_id) references bob.project_plan_step_identities(project_id,step_id) on delete cascade,
 foreign key(project_id,original_revision,step_id) references bob.project_plan_steps(project_id,plan_revision,step_id) on delete cascade,
 foreign key(project_id,completed_revision,step_id) references bob.project_plan_steps(project_id,plan_revision,step_id) on delete cascade,
 check(num_nonnulls(drawing_id,requirement_id,cut_plan_id,step_id)=1),
 check((kind='drawing' and drawing_id is not null) or (kind='requirement' and requirement_id is not null)
  or (kind='cut_plan' and cut_plan_id is not null) or (kind='step' and step_id is not null))
);
create index construction_change_items_page_idx on bob.construction_change_items(change_id,id);
create index construction_change_items_drawing_idx on bob.construction_change_items(drawing_id,project_id,original_revision) where drawing_id is not null;
create index construction_change_items_requirement_idx on bob.construction_change_items(requirement_id,project_id,original_revision) where requirement_id is not null;
create index construction_change_items_cut_idx on bob.construction_change_items(cut_plan_id,project_id,original_revision) where cut_plan_id is not null;
create index construction_change_items_step_idx on bob.construction_change_items(project_id,step_id,original_revision) where step_id is not null;
alter table bob.construction_change_sets enable row level security;
alter table bob.construction_change_items enable row level security;
revoke all on bob.construction_change_sets,bob.construction_change_items from public,anon,authenticated,service_role;
grant select on bob.construction_change_sets,bob.construction_change_items to authenticated;
create policy project_read on bob.construction_change_sets for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.construction_change_items for select to authenticated using(bob_private.has_project_access(project_id));

create function bob_private.capture_construction_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous bob.artifact_construction_revisions; cid uuid; prior_policy jsonb; next_policy jsonb;
begin
 select * into previous from bob.artifact_construction_revisions where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if not found then return new; end if;
 select policy into prior_policy from bob.artifact_construction_instance_policies where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=previous.artifact_revision;
 select policy into next_policy from bob.artifact_construction_instance_policies where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision;
 insert into bob.construction_change_sets(project_id,artifact_id,from_revision,to_revision,cause)
  values(new.project_id,new.artifact_id,previous.artifact_revision,new.artifact_revision,jsonb_build_object(
   'source_revision_changed',true,'geometry_changed',new.recipe is distinct from previous.recipe,'parameters_changed',new.parameters is distinct from previous.parameters,
   'joints_changed',new.joints is distinct from previous.joints,'open_questions_changed',new.open_questions is distinct from previous.open_questions,
   'materials_changed',new.materials is distinct from previous.materials,'instance_policy_changed',next_policy is distinct from prior_policy)) returning id into cid;
 -- Every pinned output of this construction needs a new exact pin. Other
 -- constructions and unrelated work are not selected or rewritten.
 insert into bob.construction_change_items(change_id,project_id,kind,drawing_id,original_revision)
 select distinct cid,new.project_id,'drawing',a.id,a.current_revision from bob.artifact_construction_drawings d
  join bob.artifacts a on a.id=d.drawing_artifact_id and a.project_id=d.project_id and a.current_revision=d.drawing_revision
  join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and not r.archived
  where d.project_id=new.project_id and d.construction_artifact_id=new.artifact_id and d.construction_revision<=previous.artifact_revision
 on conflict do nothing;
 insert into bob.construction_change_items(change_id,project_id,kind,drawing_id,original_revision)
 select distinct cid,new.project_id,'drawing',a.id,a.current_revision from bob.artifact_construction_origins o
  join bob.artifacts a on a.id=o.drawing_artifact_id and a.project_id=o.project_id
  join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and not r.archived
  where o.project_id=new.project_id and o.construction_artifact_id=new.artifact_id and o.construction_revision<=previous.artifact_revision
   and not exists(select 1 from bob.artifact_construction_drawings d where d.project_id=a.project_id and d.drawing_artifact_id=a.id and d.drawing_revision=a.current_revision and d.construction_artifact_id<>new.artifact_id)
 on conflict do nothing;
 insert into bob.construction_change_items(change_id,project_id,kind,requirement_id,original_revision)
 select cid,new.project_id,'requirement',h.id,h.current_revision from bob.material_requirements h
  join bob.material_requirement_revisions r on r.requirement_id=h.id and r.revision=h.current_revision and not r.archived
  join bob.material_requirement_construction_sources s on s.project_id=h.project_id and s.requirement_id=h.id and s.requirement_revision=h.current_revision
  where h.project_id=new.project_id and s.artifact_id=new.artifact_id and s.artifact_revision<=previous.artifact_revision;
 -- Legacy/manual needs can be linked to the constructor or an affected
 -- drawing without a recorded calculation model. Capture them for explicit
 -- model review; never reconstruct their inputs from a free-text basis/name.
 insert into bob.construction_change_items(change_id,project_id,kind,requirement_id,original_revision)
 select cid,new.project_id,'requirement',h.id,h.current_revision from bob.material_requirements h
  join bob.material_requirement_revisions r on r.requirement_id=h.id and r.revision=h.current_revision and not r.archived
  where h.project_id=new.project_id and (r.artifact_id=new.artifact_id or exists(select 1 from bob.construction_change_items i where i.change_id=cid and i.drawing_id=r.artifact_id))
 on conflict do nothing;
 insert into bob.construction_change_items(change_id,project_id,kind,cut_plan_id,original_revision)
 select cid,new.project_id,'cut_plan',h.id,h.current_revision from bob.material_cut_plans h
  join bob.material_cut_plan_revisions r on r.plan_id=h.id and r.revision=h.current_revision
  where h.project_id=new.project_id and r.artifact_id=new.artifact_id and r.artifact_revision<=previous.artifact_revision;
 insert into bob.construction_change_items(change_id,project_id,kind,step_id,original_revision)
 select distinct cid,new.project_id,'step',s.step_id,p.current_revision from bob.artifact_step_links l
  join bob.project_plans p on p.project_id=l.project_id
  join bob.project_plan_steps s on s.project_id=p.project_id and s.plan_revision=p.current_revision and s.step_id=l.step_id
  where l.project_id=new.project_id and (l.artifact_id=new.artifact_id or exists(
   select 1 from bob.construction_change_items i where i.change_id=cid and i.drawing_id=l.artifact_id));
 return new;
end $$;
revoke all on function bob_private.capture_construction_change() from public,anon,authenticated,service_role;
create constraint trigger b_capture_construction_change after insert on bob.artifact_construction_revisions
 deferrable initially deferred for each row execute function bob_private.capture_construction_change();

create function bob_private.complete_construction_change_output() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb:=to_jsonb(new); output_kind text; output uuid; version integer; source uuid; source_version integer; receipt jsonb;
begin
 if tg_table_name='material_requirement_construction_sources' then
  output_kind:='requirement';output:=(r->>'requirement_id')::uuid;version:=(r->>'requirement_revision')::integer;source:=(r->>'artifact_id')::uuid;source_version:=(r->>'artifact_revision')::integer;
 elsif tg_table_name='material_cut_plan_revisions' then
  output_kind:='cut_plan';output:=(r->>'plan_id')::uuid;version:=(r->>'revision')::integer;source:=(r->>'artifact_id')::uuid;source_version:=(r->>'artifact_revision')::integer;
 else
  output_kind:='drawing';output:=(r->>'drawing_artifact_id')::uuid;version:=(r->>'drawing_revision')::integer;source:=(r->>'construction_artifact_id')::uuid;source_version:=(r->>'construction_revision')::integer;
 end if;
 select w.receipt into receipt from bob_private.bob_write_receipts w where w.project_id=r->>'project_id' and w.receipt->>'recordId'=output::text and w.receipt->>'revision'=version::text order by w.created_at desc limit 1;
 update bob.construction_change_items i set state='updated',completed_revision=version,completion_receipt=receipt,completed_at=clock_timestamp()
  from bob.construction_change_sets c where i.change_id=c.id and i.project_id=c.project_id and c.project_id=r->>'project_id'
   and c.artifact_id=source and c.to_revision=source_version and i.kind=output_kind and i.output_id=output and i.state='pending';
 return new;
end $$;
revoke all on function bob_private.complete_construction_change_output() from public,anon,authenticated,service_role;
create constraint trigger complete_construction_requirement after insert on bob.material_requirement_construction_sources deferrable initially deferred
 for each row execute function bob_private.complete_construction_change_output();
create constraint trigger complete_construction_cut_plan after insert on bob.material_cut_plan_revisions deferrable initially deferred
 for each row execute function bob_private.complete_construction_change_output();
create constraint trigger complete_construction_drawing after insert on bob.artifact_construction_drawings deferrable initially deferred
 for each row execute function bob_private.complete_construction_change_output();

create function bob.read_construction_changes(p_project text,p_artifact uuid,p_revision integer,p_after uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c bob.construction_change_sets; head bob.current_artifacts; page jsonb; more boolean; pending integer; total integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into head from bob.current_artifacts where project_id=p_project and id=p_artifact;
 if not found or p_revision<1 then raise exception 'project_denied' using errcode='42501'; end if;
 select * into c from bob.construction_change_sets where project_id=p_project and artifact_id=p_artifact and to_revision=p_revision;
 if not found then return jsonb_build_object('status','no_change_work','projectId',p_project,'artifact_id',p_artifact,'revision',p_revision,'items','[]'::jsonb,'truncated',false,'next_cursor',null); end if;
 select count(*),count(*) filter(where state='pending') into total,pending from bob.construction_change_items where change_id=c.id;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') into page from (
  select id,kind,output_id,original_revision,state,completed_revision,completion_receipt-'record' as completion_receipt,review_note,completed_at,
   case kind when 'requirement' then 'continue_construction_change' when 'cut_plan' then 'continue_construction_change'
    when 'drawing' then 'design_project_cad' else 'review_work' end as next_action
   from bob.construction_change_items where change_id=c.id and (p_after is null or id>p_after) order by id limit 25
 ) i;
 more:=jsonb_array_length(page)>24;if more then page:=page-24;end if;
 return jsonb_build_object('status',case when head.revision<>p_revision or head.archived then 'superseded' when pending=0 then 'complete' else 'pending' end,
  'projectId',p_project,'artifact_id',p_artifact,'revision',p_revision,'current_revision',head.revision,'change_id',c.id,'from_revision',c.from_revision,'cause',c.cause,
  'total',total,'pending',pending,'items',page,'truncated',more,'next_cursor',case when more then page->23->>'id' else null end);
end $$;
revoke all on function bob.read_construction_changes(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_changes(text,uuid,integer,uuid) to authenticated;

create function bob_private.construction_change_commitments(p_project text,p_requirement uuid default null,p_plan uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(b)),'[]') into result from (
  select 'stock_reservation'::text kind,h.plan_id id,h.current_revision revision from bob.material_cut_plan_reservations h
   join bob.material_cut_plan_reservation_revisions r on r.plan_id=h.plan_id and r.revision=h.current_revision and r.reserved
   where h.project_id=p_project and (h.plan_id=p_plan or exists(select 1 from bob.material_cut_plan_requirements n join bob.material_cut_plans ph
    on ph.id=n.plan_id and ph.current_revision=n.plan_revision where n.project_id=p_project and n.plan_id=h.plan_id and n.requirement_id=p_requirement))
  union all
  select 'cut_plan_shopping',h.plan_id,h.current_revision from bob.cut_plan_shopping h
   join bob.cut_plan_shopping_revisions r on r.plan_id=h.plan_id and r.revision=h.current_revision and r.published
   where h.project_id=p_project and (h.plan_id=p_plan or exists(select 1 from bob.material_cut_plan_requirements n join bob.material_cut_plans ph
    on ph.id=n.plan_id and ph.current_revision=n.plan_revision where n.project_id=p_project and n.plan_id=h.plan_id and n.requirement_id=p_requirement))
  union all
  select 'requirement_shopping',r.requirement_id,r.revision from bob.material_requirements h join bob.material_requirement_revisions r on r.requirement_id=h.id and r.revision=h.current_revision
   where h.project_id=p_project and h.id=p_requirement and exists(select 1 from bob.material_requirement_shopping s where s.project_id=p_project and s.requirement_id=h.id)
  union all
  select 'pack_purchase',h.article_id,h.current_revision from bob.pack_purchases h join bob.pack_purchase_revisions r on r.article_id=h.article_id and r.revision=h.current_revision and r.published
   where h.project_id=p_project and exists(select 1 from bob.pack_purchase_needs n where n.project_id=p_project and n.article_id=h.article_id and n.revision=h.current_revision and n.requirement_id=p_requirement)
 ) b;
 return result;
end $$;
revoke all on function bob_private.construction_change_commitments(text,uuid,uuid) from public,anon,authenticated,service_role;

create function bob.prepare_construction_consequence(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; saved bob_private.bob_write_receipts; msg text; c bob.construction_change_sets; i bob.construction_change_items;
 draft jsonb; q bob.material_requirement_revisions; proof bob.material_requirement_construction_sources; plan bob.material_cut_plan_revisions; drawing_head record;
 fields jsonb; domain jsonb; blockers jsonb; pins jsonb; manufactured jsonb; n integer; current_step bob.project_plan_steps;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>120000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->>'kind' is distinct from 'construction_consequence' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'record_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','item_id','change_note','computed','action','review_note','output_revision']<>'{}' or (select count(*) from jsonb_object_keys(d))<>7
  or coalesce(d->>'item_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$' or coalesce(d->>'action','') not in ('recalculate','record_work_review')
  or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or (d->>'action'='recalculate' and (d->'review_note' is distinct from 'null'::jsonb or d->'output_revision' is distinct from 'null'::jsonb))
  or (d->>'action'='record_work_review' and (jsonb_typeof(d->'review_note') is distinct from 'string' or char_length(btrim(d->>'review_note')) not between 1 and 2000 or coalesce(d->>'output_revision','')!~'^[1-9][0-9]{0,8}$' or d->'computed' is distinct from 'null'::jsonb))
  then raise exception 'invalid_construction_consequence' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction_consequence:'||(d->>'key');
 if found then
  if saved.payload is distinct from jsonb_set(p_payload,'{data,computed}','null'::jsonb) then raise exception 'operation_reused' using errcode='PT409'; end if;
  return jsonb_build_object('status','saved','receipt',saved.receipt);
 end if;
 select * into i from bob.construction_change_items where project_id=p_project and id=(d->>'item_id')::uuid;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 select * into c from bob.construction_change_sets where project_id=p_project and id=i.change_id;
 if c.artifact_id is distinct from (p_payload->>'record_id')::uuid or c.to_revision is distinct from (p_payload->>'expected_revision')::integer then raise exception 'construction_change_identity' using errcode='22023'; end if;
 draft:=bob.read_construction_draft(p_project,c.artifact_id,null,null);
 if draft->>'status' is distinct from 'ok' or draft->>'source_state' is distinct from 'current' or draft->'archived' is distinct from 'false'::jsonb or draft->>'revision'<>c.to_revision::text then raise exception 'construction_changed' using errcode='PT409'; end if;
 if i.state<>'pending' then return jsonb_build_object('status','already_completed','projectId',p_project,'item',(to_jsonb(i)-'completion_receipt')||jsonb_build_object('completion_receipt',i.completion_receipt-'record'),'receipt',i.completion_receipt-'record'); end if;
 if i.kind='drawing' then
  if d->>'action'<>'recalculate' then raise exception 'invalid_consequence_action' using errcode='22023'; end if;
  select a.current_revision,cr.step_id into drawing_head from bob.artifacts a join bob.artifact_cad_revisions cr on cr.artifact_id=a.id and cr.artifact_revision=a.current_revision where a.project_id=p_project and a.id=i.drawing_id;
  if not found or drawing_head.current_revision<>i.original_revision then raise exception 'consequence_output_changed' using errcode='PT409'; end if;
  return jsonb_build_object('status','needs_render','projectId',p_project,'item_id',i.id,'drawing_artifact_id',i.drawing_id,'expected_revision',drawing_head.current_revision,'step_id',drawing_head.step_id,'construction_artifact_id',c.artifact_id,'construction_revision',c.to_revision);
 elsif i.kind='step' then
  select s.* into current_step from bob.project_plan_steps s join bob.project_plans h on h.project_id=s.project_id and h.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=i.step_id;
  if not found then raise exception 'consequence_work_unavailable' using errcode='PT409'; end if;
  if d->>'action'='recalculate' then return jsonb_build_object('status','needs_work_review','projectId',p_project,'item_id',i.id,'step',to_jsonb(current_step),'completed_work_preserved',current_step.state='completed','message','Review the changed drawing/needs and use existing plan/work commands for any follow-up. Record the review at this exact current plan revision; this command never rewrites performed work.'); end if;
  if current_step.plan_revision is distinct from (d->>'output_revision')::integer then raise exception 'consequence_work_changed' using errcode='PT409'; end if;
  if exists(select 1 from bob.construction_change_items where change_id=c.id and kind<>'step' and state='pending') then return jsonb_build_object('status','needs_outputs','message','Complete or explicitly resolve the affected drawings/needs/cutting plans before recording the work review.'); end if;
  return jsonb_build_object('status','ready','kind','work_review','step',to_jsonb(current_step));
 end if;
 if d->>'action'<>'recalculate' then raise exception 'invalid_consequence_action' using errcode='22023'; end if;
 blockers:=bob_private.construction_change_commitments(p_project,i.requirement_id,i.cut_plan_id);
 if jsonb_array_length(blockers)>0 then return jsonb_build_object('status','needs_commitment_review','projectId',p_project,'item_id',i.id,'blockers',blockers,'message','Keep these commitments/history. Resolve through their existing release/withdraw or purchase/work commands before recalculating; no capacity or Shopping row was changed.'); end if;
 if i.kind='requirement' then
  select r.* into q from bob.material_requirements h join bob.material_requirement_revisions r on r.requirement_id=h.id and r.revision=h.current_revision where h.project_id=p_project and h.id=i.requirement_id;
  if not found or q.revision<>i.original_revision or q.archived then raise exception 'consequence_output_changed' using errcode='PT409'; end if;
  if q.stock_quantity<>0 or q.component_quantity<>0 then return jsonb_build_object('status','needs_allocation_review','item_id',i.id,'message','Retain the existing stock/component allocation and resolve it with the normal requirement commands before recalculation.'); end if;
  select * into proof from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=i.requirement_id and requirement_revision=q.revision;
  if not found then return jsonb_build_object('status','needs_requirement_model','projectId',p_project,'item_id',i.id,'requirement_id',i.requirement_id,'requirement_revision',q.revision,'source_artifact_id',q.artifact_id,'source_artifact_revision',q.artifact_revision,
   'construction_artifact_id',c.artifact_id,'construction_revision',c.to_revision,'message','This linked need has no recorded construction calculation model. Read its existing evidence and explicitly select a supported definition/quantity model with the normal derive tool using this same requirement identity, or retain the gap. Free-text names/basis do not prove its original inputs; no quantity or history was changed.'); end if;
  if proof.artifact_id is distinct from c.artifact_id then raise exception 'consequence_source_changed' using errcode='PT409'; end if;
  select bob_private.construction_build_instances(r) into manufactured from bob.artifact_construction_revisions r where r.project_id=p_project and r.artifact_id=c.artifact_id and r.artifact_revision=c.to_revision;
  select count(*) into n from jsonb_array_elements(manufactured) x where x->>'definition_id'=proof.definition_id;
  if n=0 then
   return jsonb_build_object('status','ready','kind','requirement_retire','domain',jsonb_build_object('kind','operational','record_id',i.requirement_id,'expected_revision',q.revision,'data',jsonb_build_object('resource','requirement','action','archive','fields','{}'::jsonb)));
  end if;
  fields:=jsonb_build_object('name',q.name,'category',q.category,'area_id',q.area_id,'task_id',q.task_id,'waste_percent',q.waste_percent::text,'purchase_increment',q.purchase_increment::text,'assumptions',q.assumptions,
   'artifact_id',c.artifact_id,'artifact_revision',c.to_revision,'target_revision',draft->'target_revision','definition_id',proof.definition_id,'quantity_mode',proof.quantity_mode,'stock_allocations','[]'::jsonb,'component_allocations','[]'::jsonb,'change_note',d->>'change_note');
  domain:=jsonb_build_object('kind','operational','record_id',i.requirement_id,'expected_revision',q.revision,'data',jsonb_build_object('resource','cad_requirement','action','revise','fields',fields));
  return jsonb_build_object('status','ready','kind','requirement','domain',domain);
 end if;
 select r.* into plan from bob.material_cut_plans h join bob.material_cut_plan_revisions r on r.plan_id=h.id and r.revision=h.current_revision where h.project_id=p_project and h.id=i.cut_plan_id;
 if not found or plan.revision<>i.original_revision then raise exception 'consequence_output_changed' using errcode='PT409'; end if;
 select bob_private.construction_build_instances(r) into manufactured from bob.artifact_construction_revisions r where r.project_id=p_project and r.artifact_id=c.artifact_id and r.artifact_revision=c.to_revision;
 if jsonb_array_length(manufactured)=0 then
  if exists(select 1 from bob.construction_change_items where change_id=c.id and kind='requirement' and state='pending') then return jsonb_build_object('status','needs_requirements','item_id',i.id); end if;
  return jsonb_build_object('status','ready','kind','cut_plan_not_applicable','plan_id',plan.plan_id,'plan_revision',plan.revision);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'revision',h.current_revision) order by h.id),'[]') into pins from bob.material_requirements h
  join bob.material_requirement_revisions r on r.requirement_id=h.id and r.revision=h.current_revision and not r.archived
  join bob.material_requirement_construction_sources s on s.project_id=h.project_id and s.requirement_id=h.id and s.requirement_revision=h.current_revision
  where h.project_id=p_project and s.artifact_id=c.artifact_id and s.artifact_revision=c.to_revision and s.quantity_mode='pieces';
 if jsonb_array_length(pins)=0 or exists(select 1 from bob.construction_change_items where change_id=c.id and kind='requirement' and state='pending')
  then return jsonb_build_object('status','needs_requirements','item_id',i.id,'message','Recalculate all affected current piece needs first. If new definitions need material, derive their new need with the existing tool. A source change cannot manufacture a missing need or a purchase quantity.'); end if;
 select coalesce(jsonb_agg(g order by g->>'definition_id'),'[]') into fields from jsonb_array_elements(plan.blank_grain) g where exists(select 1 from jsonb_array_elements(manufactured) x where x->>'definition_id'=g->>'definition_id');
 domain:=jsonb_build_object('kind','cut_plan','record_id',i.cut_plan_id,'expected_revision',plan.revision,'data',jsonb_build_object('key',d->>'key','artifact_id',c.artifact_id,'artifact_revision',c.to_revision,'requirements',pins,
  'candidates',plan.candidates,'blank_grain',fields,'candidate_sources',plan.candidate_sources,'layout',d->'computed','change_note',d->>'change_note'));
 return jsonb_build_object('status','ready','kind','cut_plan','draft',draft,'domain',domain);
end $$;
revoke all on function bob.prepare_construction_consequence(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.prepare_construction_consequence(text,uuid,uuid,bigint,jsonb) to authenticated;

alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_consequences;
revoke all on function bob_private.bob_project_write_before_consequences(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ready jsonb; domain jsonb; result jsonb; d jsonb:=p_payload->'data'; op text; before_row jsonb; item bob.construction_change_items;
begin
 if p_payload->>'kind' is distinct from 'construction_consequence' then return bob_private.bob_project_write_before_consequences(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 ready:=bob.prepare_construction_consequence(p_project,p_thread,p_turn,p_generation,p_payload);
 if ready->>'status'='saved' then return ready->'receipt'; end if;
 if ready->>'status'<>'ready' then raise exception 'construction_consequence_not_ready' using errcode='PT409'; end if;
 select * into item from bob.construction_change_items where project_id=p_project and id=(d->>'item_id')::uuid for update;
 op:='construction_consequence:'||(d->>'key');
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 if ready->>'kind'='cut_plan_not_applicable' then
  before_row:=to_jsonb(item);
  result:=jsonb_build_object('projectId',p_project,'dataset','cut_plans','recordId',item.cut_plan_id,'revision',item.original_revision,'areaId',null,'label','No manufacturing cuts for this construction revision','operation','reused','savedAt',clock_timestamp(),
   'record',bob_private.read_cut_plan(p_project,item.cut_plan_id,item.original_revision)||jsonb_build_object('change_item_id',item.id,'inapplicable_construction_revision',p_payload->'expected_revision','plan_changed',false));
  update bob.construction_change_items set state='retired',completed_revision=item.original_revision,review_note='No manufacturing instances at this construction revision. Historical cutting plan preserved; no new layout or capacity claim.',completion_receipt=result,completed_at=clock_timestamp() where id=item.id;
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,jsonb_set(p_payload,'{data,computed}','null'::jsonb),before_row,result);
  return result;
 end if;
 if ready->>'kind'='work_review' then
  before_row:=to_jsonb(item);
  result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',p_payload->>'record_id','revision',p_payload->'expected_revision','areaId',(select a.area_id from bob.current_artifacts a where a.project_id=p_project and a.id=(p_payload->>'record_id')::uuid),'label','Construction change work review','operation','reused','savedAt',clock_timestamp(),
   'record',(select to_jsonb(a) from bob.current_artifacts a where a.project_id=p_project and a.id=(p_payload->>'record_id')::uuid)||jsonb_build_object('item_id',item.id,'step_id',item.step_id,'plan_revision',d->'output_revision','review_note',d->>'review_note','performed_work_changed',false,'physical_verification',false));
  update bob.construction_change_items set state='reviewed',completed_revision=(d->>'output_revision')::integer,review_note=d->>'review_note',completion_receipt=result,completed_at=clock_timestamp() where id=item.id;
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,jsonb_set(p_payload,'{data,computed}','null'::jsonb),before_row,result);
  return result;
 end if;
 domain:=ready->'domain';
 domain:=p_payload||jsonb_build_object('kind',domain->>'kind','record_id',domain->'record_id','expected_revision',domain->'expected_revision','data',domain->'data');
 result:=bob_private.bob_project_write_before_consequences(p_project,p_thread,p_turn,p_generation,domain);
 if ready->>'kind'='requirement_retire' then
  update bob.construction_change_items set state='retired',completed_revision=(result->>'revision')::integer,completion_receipt=result,completed_at=clock_timestamp() where id=item.id;
 end if;
 update bob_private.bob_write_receipts set operation_key=op,payload=jsonb_set(p_payload,'{data,computed}','null'::jsonb)
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and payload=domain and receipt=result;
 if not found then raise exception 'construction_consequence_receipt_missing' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

commit;
