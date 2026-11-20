-- One open change item per output (audit 2026-11-16, point 3; owner approved).
--
-- Every saved construction revision captured a new change set and a new
-- pending item for each material row, drawing, cutting plan and Step that
-- pinned an older revision. Completion only settles the item of the exact
-- revision the output was recalculated against, so items of earlier change
-- sets stayed pending forever: live, 368 pending material items for 38 rows
-- (Våningssäng2: 25 change sets). Bought rows looped: each pass returned
-- needs_commitment_review and left the item pending for the next pass.
--
-- Now an item describes "this output now", not "this output at revision N":
-- - A newer change of the same output supersedes its older open item
--   (state superseded, superseded_by = the newer item). At most one open item
--   per output, enforced by a partial unique index.
-- - An output with a purchase, Shopping publication or reservation is parked
--   for the owner (state owner_review) instead of pending. AI does not run it;
--   history and commitments are untouched. When the commitment is released,
--   the next continue of that item returns it to pending and recalculates.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table bob.construction_change_items drop constraint construction_change_items_state_check;
alter table bob.construction_change_items add constraint construction_change_items_state_check
 check(state in ('pending','owner_review','updated','retired','reviewed','superseded'));
alter table bob.construction_change_items add column superseded_by uuid;
alter table bob.construction_change_items add constraint construction_change_items_superseded_by_check
 check((state='superseded')=(superseded_by is not null));

-- Commitments without the caller check, for triggers and the backfill. The
-- public helper keeps its access check and returns the same list.
create function bob_private.construction_change_commitment_list(p_project text,p_requirement uuid,p_plan uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b)),'[]') from (
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
 ) b
$$;
revoke all on function bob_private.construction_change_commitment_list(text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function bob_private.construction_change_commitments(p_project text,p_requirement uuid default null,p_plan uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 return bob_private.construction_change_commitment_list(p_project,p_requirement,p_plan);
end $$;

-- Backfill: keep the newest open item per output, supersede the rest.
with ranked as (
 select i.id,first_value(i.id) over w newest,row_number() over w n
 from bob.construction_change_items i join bob.construction_change_sets c on c.id=i.change_id
 where i.state='pending'
 window w as (partition by i.project_id,i.output_id order by c.recorded_at desc,c.to_revision desc,i.id desc)
)
update bob.construction_change_items i set state='superseded',superseded_by=r.newest,completed_at=clock_timestamp(),
 review_note='Replaced by a newer construction change of the same output.'
from ranked r where r.id=i.id and r.n>1;
update bob.construction_change_items set state='owner_review',
 review_note='The construction changed after this was bought, published to Shopping or reserved. Not recalculated; the owner decides.'
where state='pending' and kind in ('requirement','cut_plan')
 and jsonb_array_length(bob_private.construction_change_commitment_list(project_id,requirement_id,cut_plan_id))>0;

create unique index construction_change_items_one_open on bob.construction_change_items(project_id,output_id)
 where state in ('pending','owner_review');

-- New items: supersede the older open item of the same output, and park
-- committed outputs for the owner. Same-change duplicates are left to the
-- capture's own conflict handling.
create function bob_private.open_construction_change_item() returns trigger
language plpgsql security definer set search_path='' as $$
declare output uuid:=coalesce(new.drawing_id,new.requirement_id,new.cut_plan_id,new.step_id);
begin
 if new.state<>'pending' then return new; end if;
 update bob.construction_change_items set state='superseded',superseded_by=new.id,completed_at=clock_timestamp(),
  review_note='Replaced by a newer construction change of the same output.'
 where project_id=new.project_id and output_id=output and state in ('pending','owner_review') and change_id<>new.change_id;
 if new.kind in ('requirement','cut_plan')
  and jsonb_array_length(bob_private.construction_change_commitment_list(new.project_id,new.requirement_id,new.cut_plan_id))>0 then
  new.state:='owner_review';
  new.review_note:='The construction changed after this was bought, published to Shopping or reserved. Not recalculated; the owner decides.';
 end if;
 return new;
end $$;
revoke all on function bob_private.open_construction_change_item() from public,anon,authenticated,service_role;
create trigger a_open_construction_change_item before insert on bob.construction_change_items
 for each row execute function bob_private.open_construction_change_item();

create or replace function bob.read_construction_changes(p_project text,p_artifact uuid,p_revision integer,p_after uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c bob.construction_change_sets; head bob.current_artifacts; page jsonb; more boolean; pending integer; owner_review integer; total integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into head from bob.current_artifacts where project_id=p_project and id=p_artifact;
 if not found or p_revision<1 then raise exception 'project_denied' using errcode='42501'; end if;
 select * into c from bob.construction_change_sets where project_id=p_project and artifact_id=p_artifact and to_revision=p_revision;
 if not found then return jsonb_build_object('status','no_change_work','projectId',p_project,'artifact_id',p_artifact,'revision',p_revision,'items','[]'::jsonb,'truncated',false,'next_cursor',null); end if;
 select count(*),count(*) filter(where state='pending'),count(*) filter(where state='owner_review') into total,pending,owner_review from bob.construction_change_items where change_id=c.id;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') into page from (
  select id,kind,output_id,original_revision,state,completed_revision,completion_receipt-'record' as completion_receipt,review_note,completed_at,superseded_by,
   case when state='owner_review' then 'owner_review' when state='superseded' then 'none'
    when kind in ('requirement','cut_plan') then 'continue_construction_change'
    when kind='drawing' then 'design_project_cad' else 'review_work' end as next_action
   from bob.construction_change_items where change_id=c.id and (p_after is null or id>p_after) order by id limit 25
 ) i;
 more:=jsonb_array_length(page)>24;if more then page:=page-24;end if;
 return jsonb_build_object('status',case when head.revision<>p_revision or head.archived then 'superseded' when pending=0 then 'complete' else 'pending' end,
  'projectId',p_project,'artifact_id',p_artifact,'revision',p_revision,'current_revision',head.revision,'change_id',c.id,'from_revision',c.from_revision,'cause',c.cause,
  'total',total,'pending',pending,'owner_review',owner_review,'items',page,'truncated',more,'next_cursor',case when more then page->23->>'id' else null end);
end $$;

-- Continue: an owner_review item stays parked while its commitment exists and
-- returns to pending once it is released. A pending item that meets a new
-- commitment is parked instead of being left for the next pass. A cutting
-- plan still waits for parked needs, as it waited for pending ones.
do $$
declare fn regprocedure:='bob.prepare_construction_consequence(text,uuid,uuid,bigint,jsonb)'::regprocedure; def text;
 old_state constant text:=$q$ if i.state<>'pending' then return jsonb_build_object('status','already_completed'$q$;
 new_state constant text:=$q$ if i.state='superseded' then return jsonb_build_object('status','superseded','projectId',p_project,'item_id',i.id,'superseded_by',i.superseded_by,'message','A newer construction change replaced this item. Read that change and continue its item.'); end if;
 if i.state='owner_review' then
  blockers:=bob_private.construction_change_commitments(p_project,i.requirement_id,i.cut_plan_id);
  if jsonb_array_length(blockers)>0 then return jsonb_build_object('status','needs_commitment_review','projectId',p_project,'item_id',i.id,'owner_review',true,'blockers',blockers,'message','Waiting for the owner: this output is bought, published to Shopping or reserved. Keep these commitments and their history; do not retry until the owner releases them.'); end if;
  update bob.construction_change_items set state='pending',review_note=null where id=i.id and state='owner_review';
  i.state:='pending';i.review_note:=null;
 end if;
 if i.state<>'pending' then return jsonb_build_object('status','already_completed'$q$;
 old_block constant text:=$q$ if jsonb_array_length(blockers)>0 then return jsonb_build_object('status','needs_commitment_review',$q$;
 new_block constant text:=$q$ if jsonb_array_length(blockers)>0 then
  update bob.construction_change_items set state='owner_review',review_note='The construction changed after this was bought, published to Shopping or reserved. Not recalculated; the owner decides.' where id=i.id and state='pending';
  return jsonb_build_object('status','needs_commitment_review','owner_review',true,$q$;
 old_wait constant text:=$q$kind='requirement' and state='pending')$q$;
 new_wait constant text:=$q$kind='requirement' and state in ('pending','owner_review'))$q$;
begin
 def:=pg_get_functiondef(fn);
 if (length(def)-length(replace(def,old_state,'')))/length(old_state)<>1
  or (length(def)-length(replace(def,old_block,'')))/length(old_block)<>1
  or (length(def)-length(replace(def,old_wait,'')))/length(old_wait)<>2
  then raise exception 'change_items_one_open_consequence_changed'; end if;
 execute replace(replace(replace(def,old_state,new_state),old_block,new_block),old_wait,new_wait);
end $$;

commit;
