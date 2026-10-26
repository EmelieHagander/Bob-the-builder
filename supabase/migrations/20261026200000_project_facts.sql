-- Project facts at turn start (owner decision 2026-10-26; contract in
-- Docs/ask-bob-context.md). One bounded read gives Bob the project's pure
-- facts so a turn does not have to search its way in:
--  * rooms of the project's linked Buildings with their length, width and
--    ceiling height from bob.project_room_dimensions (24 rooms);
--  * the current head revision of every current construction with part,
--    joint, role and open-question counts and the fastener totals from
--    bob_private.construction_fastener_schedule_for (8 constructions);
--  * current CAD drawings with their construction pin and stored source
--    status (8 drawings);
--  * open drawing requests with their blocking gap count (5 requests);
--  * material need counts: Shopping state, changed, fastener and glue needs.
-- Every list carries total, included and omitted.
--
-- Never a live source assessment. bob.artifact_source_status,
-- bob.current_drawing_overview, bob.material_requirement_shopping_state and
-- bob.current_material_requirements.artifact_changed run
-- bob_private.artifact_source_assessment for rows without a fresh stored state
-- (always so for projects with physical pins), which caused about 40 statement
-- timeouts a day. This reader reads bob.artifact_source_states while its
-- project counter is current and otherwise says not_stored / changed_unknown.
-- current_material_requirements is read for target, stock and component
-- changes only; its artifact_changed column is never referenced.
--
-- Facts only: no model or chat text, no money, no email, diet, Auth or person
-- fields. Record IDs are included so Bob can open details.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $project_facts_guard$ begin
 if to_regclass('bob.artifact_source_states') is null or to_regclass('bob.project_room_dimensions') is null
  or to_regprocedure('bob_private.construction_fastener_schedule_for(bob.artifact_construction_revisions)') is null
  or to_regclass('bob.material_requirement_fastener_sources') is null then
  raise exception 'Apply 20261022193000, 20261026130000, 20261026170000 and 20261026172000 before the project facts reader';
 end if;
end $project_facts_guard$;

-- Open drawing requests live in bob_private. Same access check as
-- bob_private.project_drawing_requests; only the request ID, status, update
-- time and the number of blocking gaps cross the boundary. The public request
-- readers are not used because bob.drawing_request_work reads
-- bob.artifact_source_status.
create function bob_private.project_facts_drawing_requests(p_project text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare total integer; items jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select count(*) into total from bob_private.project_drawing_requests q
  where q.project_id=p_project and q.status not in ('saved','cancelled');
 select coalesce(jsonb_agg(jsonb_build_object('request_id',r.id,'status',r.status,
   'gaps',(select count(*) from bob_private.drawing_gaps g where g.request_id=r.id and g.blocking),
   'updated_at',r.updated_at) order by r.updated_at desc,r.id),'[]') into items
 from (select q.id,q.status,q.updated_at from bob_private.project_drawing_requests q
  where q.project_id=p_project and q.status not in ('saved','cancelled') order by q.updated_at desc,q.id limit 5) r;
 return jsonb_build_object('total',total,'included',jsonb_array_length(items),'omitted',total-jsonb_array_length(items),'items',items);
end $$;
revoke all on function bob_private.project_facts_drawing_requests(text) from public,anon,service_role;
grant execute on function bob_private.project_facts_drawing_requests(text) to authenticated;

create function bob.read_project_facts(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
 linked integer; rooms jsonb; constructions jsonb; drawings jsonb; materials jsonb;
 n_constructions integer; n_drawings integer; n_other integer;
 unknown_dimension constant jsonb:='{"status":"unknown","truth":null,"millimetres":null,"conflict_millimetres":null}';
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;

 -- Rooms. Linked means a whole-Building link or a Site link covering a
 -- Building (as project_targets_whole_building). Rooms are project_spaces, the
 -- scope bob.project_room_dimensions uses; marked rooms come first.
 select count(distinct b.id) into linked
 from bob.project_physical_scope s
 join bob.current_buildings b on (s.target_kind='building' and b.id=s.building_id) or (s.target_kind='site' and b.site_id=s.site_id)
 where s.project_id=p_project and not b.archived;
 with spaces as (
  select s.id,s.revision,s.name,s.building_id,
   exists(select 1 from bob.project_physical_scope m where m.project_id=p_project and m.target_kind='space' and m.space_id=s.id) marked
  from bob.project_spaces s where s.project_id=p_project and not s.archived
 ), picked as (
  select s.*,b.name building from spaces s left join bob.current_buildings b on b.id=s.building_id
  order by s.marked desc,b.name,s.name,s.id limit 24
 ), dims as (
  select d.space_id,
   jsonb_object_agg(d.property,jsonb_build_object('status',d.status,'truth',d.truth,'millimetres',d.millimetres::numeric,
    'conflict_millimetres',case when d.status='conflict' then (select jsonb_agg(distinct (m->>'millimetres')::numeric order by (m->>'millimetres')::numeric)
     from jsonb_array_elements(d.measurements) m where m->>'millimetres' is not null) end))
    filter (where d.property in ('room_length','room_width','ceiling_height') and d.side is null and d.reference is null) size,
   count(*) filter (where not (d.property in ('room_length','room_width','ceiling_height') and d.side is null and d.reference is null)) other
  from bob.project_room_dimensions d join picked p on p.id=d.space_id and p.revision=d.space_revision
  where d.project_id=p_project
  group by d.space_id
 )
 -- 'rooms_only': the project scopes single rooms without a whole Building or Site.
 select jsonb_build_object('status',case when linked>0 then 'ok' when exists(select 1 from spaces) then 'rooms_only' else 'not_linked' end,'linked_buildings',linked,
  'total',(select count(*) from spaces),'included',count(p.id),'omitted',(select count(*) from spaces)-count(p.id),
  'items',coalesce(jsonb_agg(jsonb_build_object('room_id',p.id,'name',p.name,'building_id',p.building_id,'building',p.building,'marked',p.marked,
    'length_mm',case when d.size#>>'{room_length,status}'='known' then d.size#>'{room_length,millimetres}' end,
    'width_mm',case when d.size#>>'{room_width,status}'='known' then d.size#>'{room_width,millimetres}' end,
    'height_mm',case when d.size#>>'{ceiling_height,status}'='known' then d.size#>'{ceiling_height,millimetres}' end,
    'dimensions',jsonb_build_object('room_length',coalesce(d.size->'room_length',unknown_dimension),
     'room_width',coalesce(d.size->'room_width',unknown_dimension),'ceiling_height',coalesce(d.size->'ceiling_height',unknown_dimension)),
    'other_dimensions',coalesce(d.other,0))
   order by p.marked desc,p.building,p.name,p.id) filter (where p.id is not null),'[]'))
 into rooms from picked p left join dims d on d.space_id=p.id;

 -- Current artifacts by the kind of their head revision.
 select count(*) filter (where k.construction),count(*) filter (where k.cad),count(*) filter (where not k.construction and not k.cad)
 into n_constructions,n_drawings,n_other
 from bob.artifacts a
 join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and r.project_id=a.project_id
 cross join lateral (select
  exists(select 1 from bob.artifact_construction_revisions c where c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.current_revision) construction,
  exists(select 1 from bob.artifact_cad_revisions c where c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.current_revision) cad) k
 where a.project_id=p_project and not r.archived;

 -- Constructions, newest first. The fastener schedule runs for included rows only.
 select coalesce(jsonb_agg(jsonb_build_object('artifact_id',x.id,'title',x.title,'revision',x.revision,
   'definitions',x.definitions,'parts',x.parts,'joints',x.joints,
   'roles',jsonb_build_object('recorded',x.policy is not null,'known',x.known,'unknown',greatest(0,x.parts-x.known)),
   'open_questions',x.open_questions,
   'fasteners',(select jsonb_build_object('complete',f.s->'complete',
     'totals',coalesce((select jsonb_agg(jsonb_build_object('kind',t.v->'kind','diameter_mm',t.v->'diameter_mm','length_mm',t.v->'length_mm','count',t.v->'count') order by t.o)
      from jsonb_array_elements(f.s->'totals') with ordinality t(v,o)),'[]'),
     'glue_packages',f.s->'glue_packages') from (select bob_private.construction_fastener_schedule_for(x.c) s) f))
  order by x.recorded_at desc,x.id),'[]') into constructions
 from (select a.id,r.title,r.recorded_at,a.current_revision revision,c,p.policy,
   case when jsonb_typeof(c.recipe->'definitions')='array' then jsonb_array_length(c.recipe->'definitions') else 0 end definitions,
   case when jsonb_typeof(c.recipe->'instances')='array' then jsonb_array_length(c.recipe->'instances') else 0 end parts,
   case when jsonb_typeof(c.joints)='array' then jsonb_array_length(c.joints) else 0 end joints,
   case when jsonb_typeof(c.open_questions)='array' then jsonb_array_length(c.open_questions) else 0 end open_questions,
   (select count(*) from jsonb_array_elements(case when jsonb_typeof(p.policy->'instances')='array' then p.policy->'instances' else '[]' end) i
    where i->>'role' is distinct from 'unknown')::integer known
  from bob.artifacts a
  join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and r.project_id=a.project_id
  join bob.artifact_construction_revisions c on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.current_revision
  left join bob.artifact_construction_instance_policies p on p.project_id=c.project_id and p.artifact_id=c.artifact_id and p.artifact_revision=c.artifact_revision
  where a.project_id=p_project and not r.archived
  order by r.recorded_at desc,a.id limit 8) x;

 -- CAD drawings, newest first. Source status is the stored state while the
 -- project's change counter still equals the one it was computed at.
 select coalesce(jsonb_agg(jsonb_build_object('artifact_id',x.id,'title',x.title,'revision',x.revision,
   'construction',(select jsonb_build_object('artifact_id',d.construction_artifact_id,'revision',d.construction_revision)
    from bob.artifact_construction_drawings d where d.project_id=p_project and d.drawing_artifact_id=x.id and d.drawing_revision=x.revision),
   'source_status',coalesce((select coalesce(s.source_state,'not_assessed') from bob.artifact_source_states s
    join bob.artifact_source_epochs e on e.project_id=s.project_id and e.seq=s.computed_seq
    where s.project_id=p_project and s.artifact_id=x.id and s.revision=x.revision),'not_stored'))
  order by x.recorded_at desc,x.id),'[]') into drawings
 from (select a.id,r.title,r.recorded_at,a.current_revision revision
  from bob.artifacts a
  join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and r.project_id=a.project_id
  join bob.artifact_cad_revisions c on c.project_id=a.project_id and c.artifact_id=a.id and c.artifact_revision=a.current_revision
  where a.project_id=p_project and not r.archived
  order by r.recorded_at desc,a.id limit 8) x;

 -- Material needs. Shopping routes as the publish guards define them: a
 -- requirement link to an existing Shopping row, a published pack purchase
 -- holding the need, or a published cut plan whose layout includes it.
 with req as (
  select cm.id,cm.revision,cm.purchase_quantity,cm.artifact_id,cm.artifact_revision,
   cm.target_changed or cm.stock_changed or cm.component_changed inputs_changed
  from bob.current_material_requirements cm where cm.project_id=p_project and not cm.archived
 ), facts as (
  select q.*,
   q.artifact_id is not null and (h.current_revision is distinct from q.artifact_revision or hr.archived is distinct from false) artifact_moved,
   q.artifact_id is not null and exists(select 1 from bob.artifact_construction_revisions c
    where c.project_id=p_project and c.artifact_id=q.artifact_id and c.artifact_revision=q.artifact_revision) construction,
   (select coalesce(s.source_state,'none') from bob.artifact_source_states s
    join bob.artifact_source_epochs e on e.project_id=s.project_id and e.seq=s.computed_seq
    where s.project_id=p_project and s.artifact_id=q.artifact_id and s.revision=q.artifact_revision) stored,
   coalesce(
    (select m.status::text from bob.material_requirement_shopping l join bob.materials m on m.id=l.material_id and m.project_id=l.project_id
     where l.project_id=p_project and l.requirement_id=q.id),
    (select coalesce(m.status::text,'shopping_row_missing') from bob.pack_purchase_needs n
     join bob.pack_purchases h on h.article_id=n.article_id and h.current_revision=n.revision
     join bob.pack_purchase_revisions pr on pr.article_id=h.article_id and pr.revision=h.current_revision
     left join bob.materials m on m.id=h.material_id and m.project_id=h.project_id
     where n.project_id=p_project and n.requirement_id=q.id and pr.published limit 1),
    (select 'cut_plan_shopping' from bob.material_cut_plan_requirements cr
     join bob.cut_plan_shopping sh on sh.plan_id=cr.plan_id and sh.project_id=cr.project_id
     join bob.cut_plan_shopping_revisions sr on sr.plan_id=sh.plan_id and sr.revision=sh.current_revision and sr.plan_revision=cr.plan_revision
     where cr.project_id=p_project and cr.requirement_id=q.id and sr.published limit 1)) route,
   (select f.kind from bob.material_requirement_fastener_sources f where f.requirement_id=q.id and f.requirement_revision=q.revision) fastener_kind
  from req q
  left join bob.artifacts h on h.id=q.artifact_id and h.project_id=p_project
  left join bob.artifact_revisions hr on hr.artifact_id=h.id and hr.revision=h.current_revision
 ), states as (
  select f.*,
   f.inputs_changed or f.artifact_moved or (f.construction and f.stored is not null and f.stored<>'current') changed,
   coalesce(f.route,case when f.purchase_quantity<=0 then 'covered' else 'not_in_shopping' end) state
  from facts f
 )
 select jsonb_build_object('total',count(*),
  'by_state',jsonb_build_object('not_in_shopping',count(*) filter (where state='not_in_shopping'),'covered',count(*) filter (where state='covered'),
   'needed',count(*) filter (where state='needed'),'ordered',count(*) filter (where state='ordered'),
   'delivered',count(*) filter (where state='delivered'),'backorder',count(*) filter (where state='backorder'),
   'cut_plan_shopping',count(*) filter (where state='cut_plan_shopping'),'shopping_row_missing',count(*) filter (where state='shopping_row_missing')),
  'changed',count(*) filter (where changed),
  'changed_unknown',count(*) filter (where not changed and construction and stored is null),
  'fastener_needs',count(*) filter (where fastener_kind in ('screw','nail','bolt')),
  'glue_needs',count(*) filter (where fastener_kind='glue'),
  'shopping_published',count(*) filter (where state in ('needed','ordered','delivered','backorder','cut_plan_shopping')))
 into materials from states;

 return jsonb_build_object('status','ok','version',1,'project_id',p_project,'as_of',now(),
  'rooms',rooms,
  'constructions',jsonb_build_object('total',n_constructions,'included',jsonb_array_length(constructions),
   'omitted',n_constructions-jsonb_array_length(constructions),'items',constructions),
  'drawings',jsonb_build_object('total',n_drawings,'included',jsonb_array_length(drawings),
   'omitted',n_drawings-jsonb_array_length(drawings),'other_artifacts',n_other,'items',drawings),
  'drawing_requests',bob_private.project_facts_drawing_requests(p_project),
  'materials',materials);
end $$;
revoke all on function bob.read_project_facts(text) from public,anon,service_role;
grant execute on function bob.read_project_facts(text) to authenticated;

notify pgrst,'reload schema';
commit;
