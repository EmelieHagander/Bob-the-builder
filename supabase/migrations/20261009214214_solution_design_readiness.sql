-- Expert advice and purpose-specific readiness on the existing SolutionVersion.
-- UTC filename fallback: pinned CLI 2.117.0 aborted during migration --help.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob.solution_revisions add column design_intent jsonb;
alter table bob.solution_revisions add constraint solution_design_intent_shape
 check(design_intent is null or (jsonb_typeof(design_intent)='object' and octet_length(design_intent::text)<=48000));
comment on column bob.solution_revisions.design_intent is 'Versioned shared design intent and expert choices. Alignment expresses a supported direction for one purpose, never engineering/fabrication approval. Legacy null remains unknown.';

-- ECMAScript trim whitespace, shared with the TypeScript string checks. This
-- pure helper reads no tables and cannot establish authority or readiness.
create function bob_private.design_text_present(p_text text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(char_length(btrim(p_text,E'\t\n\r\f '||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)))>0,false)
$$;
revoke all on function bob_private.design_text_present(text) from public,anon,service_role;
grant execute on function bob_private.design_text_present(text) to authenticated;

create function bob_private.check_solution_design_intent(p_project text,p_intent jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb; f jsonb; c jsonb; d jsonb; key text; ids text[]:='{}'; image_ids uuid[]:='{}'; image_id uuid;
begin
 if p_intent is null or p_intent='null'::jsonb then return; end if;
 if jsonb_typeof(p_intent) is distinct from 'object' or p_intent-array['version','purpose','summary','references','features','choices','alignment']<>'{}'
  or (select count(*) from jsonb_object_keys(p_intent))<>7 or octet_length(p_intent::text)>48000
  or p_intent->'version' is distinct from '1'::jsonb or coalesce(p_intent->>'purpose','') not in ('illustration','concept','construction')
  or jsonb_typeof(p_intent->'summary') is distinct from 'string' or (char_length(p_intent->>'summary')>2000 or not bob_private.design_text_present(p_intent->>'summary'))
  or jsonb_typeof(p_intent->'references') is distinct from 'array' or jsonb_array_length(p_intent->'references')>8
  or jsonb_typeof(p_intent->'features') is distinct from 'array' or jsonb_array_length(p_intent->'features')>24
  or jsonb_typeof(p_intent->'choices') is distinct from 'array' or jsonb_array_length(p_intent->'choices')>16
  or jsonb_typeof(p_intent->'alignment') is distinct from 'object' or (p_intent->'alignment')-array['status','basis']<>'{}'
  or (select count(*) from jsonb_object_keys(p_intent->'alignment'))<>2
  or coalesce(p_intent->'alignment'->>'status','') not in ('draft','aligned')
  or jsonb_typeof(p_intent->'alignment'->'basis') is distinct from 'string' or char_length(p_intent->'alignment'->>'basis')>2000
  or p_intent->'alignment'->>'status'='aligned' and not bob_private.design_text_present(p_intent->'alignment'->>'basis')
  then raise exception 'invalid_design_intent' using errcode='22023'; end if;
 -- Stable order follows the existing project/media lock ordering.
 for r in select value from jsonb_array_elements(p_intent->'references') loop
  if jsonb_typeof(r) is distinct from 'object' or r-array['image_id','role','note']<>'{}' or (select count(*) from jsonb_object_keys(r))<>3
   or coalesce(r->>'image_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or coalesce(r->>'role','') not in ('appearance','layout','context')
   or jsonb_typeof(r->'note') is distinct from 'string' or char_length(r->>'note')>1000
   then raise exception 'invalid_design_reference' using errcode='22023'; end if;
  image_id:=(r->>'image_id')::uuid;
  if image_id=any(image_ids) then raise exception 'duplicate_design_reference' using errcode='22023'; end if;
  image_ids:=array_append(image_ids,image_id);
 end loop;
 perform 1 from bob.media_assets where project_id=p_project and id=any(image_ids) order by id for share;
 if exists(select 1 from unnest(image_ids) ref_image(id) where not exists(select 1 from bob.media_assets m where m.project_id=p_project and m.id=ref_image.id and m.state='ready'))
  then raise exception 'design_reference_unavailable' using errcode='42501'; end if;
 for f in select value from jsonb_array_elements(p_intent->'features') loop
  if jsonb_typeof(f) is distinct from 'object' or f-array['id','description','basis','source_ref']<>'{}' or (select count(*) from jsonb_object_keys(f))<>4
   or coalesce(f->>'id','')!~'^[a-zA-Z0-9_-]{1,32}$' or f->>'id'=any(ids)
   or jsonb_typeof(f->'description') is distinct from 'string' or (char_length(f->>'description')>1000 or not bob_private.design_text_present(f->>'description'))
   or coalesce(f->>'basis','') not in ('user_request','project_record','working_assumption')
   or (f->'source_ref' is distinct from 'null'::jsonb and (jsonb_typeof(f->'source_ref') is distinct from 'string' or char_length(f->>'source_ref')>200 or not bob_private.design_text_present(f->>'source_ref')))
   then raise exception 'invalid_design_feature' using errcode='22023'; end if;
  ids:=array_append(ids,f->>'id');
  if left(f->>'source_ref',6)='image:' and not substring(f->>'source_ref' from 7)=any(array(select x::text from unnest(image_ids) x))
   then raise exception 'design_feature_reference_missing' using errcode='22023'; end if;
 end loop;
 ids:='{}';
 for c in select value from jsonb_array_elements(p_intent->'choices') loop
  if jsonb_typeof(c) is distinct from 'object' or c-array['id','question','alternatives','recommendation','basis','consequences','geometry_dependency','status','selected_direction','decision_authority','decision_basis','deferral']<>'{}'
   or (select count(*) from jsonb_object_keys(c))<>12 or coalesce(c->>'id','')!~'^[a-zA-Z0-9_-]{1,40}$' or c->>'id'=any(ids)
   or jsonb_typeof(c->'question') is distinct from 'string' or (char_length(c->>'question')>1000 or not bob_private.design_text_present(c->>'question'))
   or jsonb_typeof(c->'alternatives') is distinct from 'array' or jsonb_array_length(c->'alternatives')>4
   or exists(select 1 from jsonb_array_elements(c->'alternatives') x where jsonb_typeof(x) is distinct from 'string' or char_length(x#>>'{}')>1000 or not bob_private.design_text_present(x#>>'{}'))
   or jsonb_typeof(c->'geometry_dependency') is distinct from 'boolean'
   or coalesce(c->>'status','') not in ('open','resolved','deferred') or coalesce(c->>'decision_authority','') not in ('owner','bob')
   or (c->'selected_direction' is distinct from 'null'::jsonb and (jsonb_typeof(c->'selected_direction') is distinct from 'string' or char_length(c->>'selected_direction')>2000 or not bob_private.design_text_present(c->>'selected_direction')))
   then raise exception 'invalid_design_choice' using errcode='22023'; end if;
  ids:=array_append(ids,c->>'id');
  foreach key in array array['recommendation','basis','consequences','decision_basis'] loop
   if jsonb_typeof(c->key) is distinct from 'string' or char_length(c->>key)>2000
    then raise exception 'invalid_design_choice' using errcode='22023'; end if;
  end loop;
  if c->>'status'='resolved' then
   if jsonb_array_length(c->'alternatives')=0 or c->'selected_direction'='null'::jsonb or c->'deferral' is distinct from 'null'::jsonb
    or exists(select 1 from unnest(array['recommendation','basis','consequences','decision_basis']) k where not bob_private.design_text_present(c->>k))
    then raise exception 'design_choice_direction_required' using errcode='22023'; end if;
  elsif c->>'status'='open' then
   if c->'selected_direction' is distinct from 'null'::jsonb or c->'deferral' is distinct from 'null'::jsonb
    then raise exception 'invalid_open_design_choice' using errcode='22023'; end if;
  else
   d:=c->'deferral';
   if c->'selected_direction' is distinct from 'null'::jsonb or jsonb_typeof(d) is distinct from 'object'
    or d-array['scope','reason']<>'{}' or (select count(*) from jsonb_object_keys(d))<>2
    or coalesce(d->>'scope','') not in ('illustration','concept') or jsonb_typeof(d->'reason') is distinct from 'string'
    or (char_length(d->>'reason')>2000 or not bob_private.design_text_present(d->>'reason'))
    then raise exception 'invalid_design_deferral' using errcode='22023'; end if;
  end if;
 end loop;
end $$;
revoke all on function bob_private.check_solution_design_intent(text,jsonb) from public,anon,authenticated,service_role;

create or replace view bob.current_solutions with(security_invoker=true) as
select h.id,h.area_id,r.* from bob.solutions h join bob.solution_revisions r
 on r.solution_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id;

create or replace function bob_private.solution_command(
  p_project text,p_action text,p_solution uuid,p_expected integer,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid(); actor text; allowed text[];
  h bob.solutions; r bob.solution_revisions; t bob.target_revisions;
  n integer; target_version integer; area text; refs jsonb; ref jsonb; scope text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action is null or p_action not in ('create','revise','archive','restore','select','clear')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>72000 then raise exception 'Invalid solution command'; end if;
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
  allowed := case when p_action='create' then array['title','description','assumptions','tradeoffs','source_media_id','measurements','area_id','design_intent']
    when p_action='revise' then array['title','description','assumptions','tradeoffs','source_media_id','measurements','change_note','design_intent']
    when p_action='select' then array['reason','solution_revision','area_id']
    when p_action='clear' then array['reason','area_id'] else array[]::text[] end;
  if p_data-allowed<>'{}'::jsonb then raise exception 'Unsupported fields. Identity, parents and history cannot be rewritten.'; end if;

  if p_action in ('select','clear') then
    area := nullif(p_data->>'area_id','');
    scope := case when area is null then 'project' else 'area:'||area end;
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    select current_revision into target_version from bob.project_targets
      where project_id=p_project and scope_key=scope;
    target_version := coalesce(target_version,0);
    if p_expected is distinct from target_version then raise exception 'Target changed. Reload before deciding again.'; end if;
    if p_action='select' then
      select * into h from bob.solutions where id=p_solution and project_id=p_project;
      if not found then raise exception 'Solution unavailable'; end if;
      -- Preserve the shipped Project-wide behavior: a Project target may select
      -- an Area-authored alternative. The stricter same-Area rule applies only
      -- when creating/replacing an Area-specific target pointer.
      if area is not null and h.area_id is distinct from area then
        raise exception 'Choose a solution from the same Project/Area scope.';
      end if;
      if h.current_revision is distinct from (p_data->>'solution_revision')::integer then raise exception 'Solution changed. Reload before selecting.'; end if;
      select * into r from bob.solution_revisions where solution_id=h.id and revision=h.current_revision;
      if r.archived then raise exception 'Restore this alternative before selecting it.'; end if;
    else
      if p_solution is not null then raise exception 'Clear does not accept a solution'; end if;
      select * into t from bob.target_revisions
        where project_id=p_project and scope_key=scope and revision=target_version;
      if not found or t.solution_id is null then raise exception 'There is no selected target to clear.'; end if;
    end if;
    select coalesce(max(revision),0)+1 into n from bob.target_revisions where project_id=p_project;
    insert into bob.target_revisions(project_id,revision,solution_id,solution_revision,reason,recorded_by,actor_label,area_id)
      values(p_project,n,h.id,h.current_revision,btrim(p_data->>'reason'),uid,actor,area);
    insert into bob.project_targets(project_id,current_revision,area_id)
      values(p_project,n,area)
      on conflict(project_id,scope_key) do update set current_revision=excluded.current_revision,area_id=excluded.area_id;
    if p_action='select' and r.design_intent is not null then
      begin
        perform bob.search_bob_project_data_v2(p_project,'target',null,null,null,scope,null);
      exception when sqlstate '54000' then
        raise exception 'compact_design_intent_required' using errcode='22023',detail='The selected solution and decision must fit their canonical bounded readback. Keep the shared description concise and reopen its sources separately.';
      end;
    end if;
    return jsonb_build_object('revision',n,'areaId',area);
  end if;

  if p_solution is null then raise exception 'Solution identity required'; end if;
  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New alternatives start at revision zero'; end if;
    if exists(select 1 from bob.solutions where id=p_solution) then raise exception 'Alternative already exists. Reload before creating another.'; end if;
    area := nullif(p_data->>'area_id','');
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    insert into bob.solutions values(p_solution,p_project,area,1);
    n := 1;
  else
    select * into h from bob.solutions where id=p_solution and project_id=p_project;
    if not found then raise exception 'Solution unavailable'; end if;
    if p_expected is distinct from h.current_revision then raise exception 'Solution changed. Reload before saving again.'; end if;
    select * into r from bob.solution_revisions where solution_id=h.id and revision=h.current_revision;
    if (p_action in ('revise','archive') and r.archived) or (p_action='restore' and not r.archived) then raise exception 'Alternative state changed. Reload first.'; end if;
    if p_action='archive' and exists(select 1 from bob.current_target where project_id=p_project and solution_id=p_solution) then
      raise exception 'Choose another target or clear it before archiving this alternative.';
    end if;
    n := p_expected+1;
  end if;
  if p_action in ('create','revise') then
    r.title := btrim(p_data->>'title'); r.description := btrim(p_data->>'description');
    r.assumptions := btrim(coalesce(p_data->>'assumptions','')); r.tradeoffs := btrim(coalesce(p_data->>'tradeoffs',''));
    r.source_media_id := nullif(p_data->>'source_media_id','')::uuid; r.source_media_title := ''; r.archived := false;
    if r.source_media_id is not null then
      select title into r.source_media_title from bob.media_assets where id=r.source_media_id and project_id=p_project and state='ready' for share;
      if not found then raise exception 'Reference image unavailable in this project'; end if;
    end if;
    if p_data?'design_intent' then
      r.design_intent:=nullif(p_data->'design_intent','null'::jsonb);
    elsif p_action='revise' and r.design_intent is not null and (
      r.title is distinct from (select title from bob.solution_revisions where solution_id=p_solution and revision=p_expected)
      or r.description is distinct from (select description from bob.solution_revisions where solution_id=p_solution and revision=p_expected)
      or r.assumptions is distinct from (select assumptions from bob.solution_revisions where solution_id=p_solution and revision=p_expected)
      or r.tradeoffs is distinct from (select tradeoffs from bob.solution_revisions where solution_id=p_solution and revision=p_expected)
      or r.source_media_id is distinct from (select source_media_id from bob.solution_revisions where solution_id=p_solution and revision=p_expected)
      or coalesce((select jsonb_agg(measurement_pin.value order by measurement_pin.value->>'id') from jsonb_array_elements(coalesce(p_data->'measurements','[]'::jsonb)) measurement_pin(value)),'[]'::jsonb) is distinct from coalesce((select jsonb_agg(jsonb_build_object('id',measurement_id,'revision',measurement_revision) order by measurement_id) from bob.solution_measurements where solution_id=p_solution and solution_revision=p_expected),'[]'::jsonb)
    ) then
      r.design_intent:=jsonb_set(r.design_intent,'{alignment}',jsonb_build_object('status','draft','basis','Solution context changed; reuse the saved choices and reconcile this revision before developing geometry.'));
    end if;
    perform bob_private.check_solution_design_intent(p_project,r.design_intent);
    refs := coalesce(p_data->'measurements','[]'::jsonb);
    if jsonb_typeof(refs)<>'array' then raise exception 'Measurements must be a list'; end if;
    if jsonb_array_length(refs)>20 then raise exception 'Use up to 20 measurements per alternative version'; end if;
    for ref in select * from jsonb_array_elements(refs) loop
      if jsonb_typeof(ref)<>'object' or ref-array['id','revision']<>'{}'::jsonb then raise exception 'Invalid measurement reference'; end if;
      perform 1 from bob.measurement_revisions m where m.measurement_id=(ref->>'id')::uuid and m.revision=(ref->>'revision')::integer and m.project_id=p_project;
      if not found then raise exception 'Measurement version unavailable in this project'; end if;
    end loop;
  end if;
  r.solution_id := p_solution; r.project_id := p_project; r.revision := n;
  r.recorded_by := uid; r.actor_label := actor; r.recorded_at := clock_timestamp();
  r.change_note := case p_action when 'create' then 'Initial alternative' when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end;
  if p_action in ('archive','restore') then r.archived := (p_action='archive'); end if;
  insert into bob.solution_revisions select r.*;
  if p_action in ('archive','restore') then
    insert into bob.solution_measurements select project_id,solution_id,n,measurement_id,measurement_revision
      from bob.solution_measurements where solution_id=p_solution and solution_revision=p_expected;
  else
    insert into bob.solution_measurements select p_project,p_solution,n,(v->>'id')::uuid,(v->>'revision')::integer from jsonb_array_elements(refs) v;
  end if;
  update bob.solutions set current_revision=n where id=p_solution;
  if p_action in ('create','revise') and r.design_intent is not null then
    begin
      perform bob.search_bob_project_data_v2(p_project,'solutions',null,null,null,p_solution::text,null);
    exception when sqlstate '54000' then
      raise exception 'compact_design_intent_required' using errcode='22023',detail='The solution and design intent must fit their canonical bounded readback. Keep the shared description concise and reopen its sources separately.';
    end;
  end if;
  return jsonb_build_object('id',p_solution,'revision',n);
end $$;
revoke all on function bob_private.solution_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.solution_command(text,text,uuid,integer,jsonb) to authenticated;

create function bob.read_design_readiness(p_project text,p_area text,p_target_revision integer,p_purpose text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare expected integer; target bob.target_revisions; chosen bob.solution_revisions; intent jsonb; purpose text;
 issues jsonb:='[]'; deferred jsonb:='[]'; c jsonb; r jsonb; result jsonb; state text:='ready'; pin jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_area is not null and not exists(select 1 from bob.areas where project_id=p_project and id=p_area and archived_at is null)
  then raise exception 'project_denied' using errcode='42501'; end if;
 if p_target_revision is not null and p_target_revision<1 or p_purpose is not null and p_purpose not in ('illustration','concept','construction')
  then raise exception 'invalid_design_readiness' using errcode='22023'; end if;
 expected:=bob_private.effective_target_revision(p_project,p_area);
 result:=jsonb_build_object('project_id',p_project,'area_id',p_area,'target_revision',expected,
  'solution_id',null,'solution_revision',null,'purpose',p_purpose,'design_intent',null,'issues','[]'::jsonb,'deferred_choice_ids','[]'::jsonb,'pin',null);
 if p_target_revision is not null and p_target_revision is distinct from expected then
  return result||jsonb_build_object('status','conflict','issues',jsonb_build_array(jsonb_build_object('code','design_target_changed','choice_id',null,'message','The selected target changed. Read the current Project/Area target before continuing.')));
 end if;
 select * into target from bob.target_revisions where project_id=p_project and revision=expected;
 if not found or target.solution_id is null then
  return result||jsonb_build_object('status','needs_data','issues',jsonb_build_array(jsonb_build_object('code','design_target_required','choice_id',null,'message','Read or settle the shared solution and select its exact version for this Project/Area.')));
 end if;
 select * into chosen from bob.solution_revisions where project_id=p_project and solution_id=target.solution_id and revision=target.solution_revision;
 result:=result||jsonb_build_object('solution_id',target.solution_id,'solution_revision',target.solution_revision,'design_intent',chosen.design_intent);
 if not found or chosen.archived then
  return result||jsonb_build_object('status','unavailable','issues',jsonb_build_array(jsonb_build_object('code','design_solution_unavailable','choice_id',null,'message','The exact selected solution is unavailable. Recover the source before proceeding.')));
 end if;
 intent:=chosen.design_intent;
 purpose:=coalesce(p_purpose,intent->>'purpose');
 result:=result||jsonb_build_object('purpose',purpose);
 if intent is null then
  return result||jsonb_build_object('status','needs_data','issues',jsonb_build_array(jsonb_build_object('code','design_intent_required','choice_id',null,'message','Reconcile the existing solution, references and decisions into a shared design intent; legacy text does not imply readiness.')));
 end if;
 if intent->>'purpose' is distinct from purpose then
  state:='needs_data';issues:=issues||jsonb_build_array(jsonb_build_object('code','design_purpose_mismatch','choice_id',null,'message','The saved intent has a different output purpose. Reconcile the selected version for this deliverable.'));
 end if;
 if intent->'alignment'->>'status' is distinct from 'aligned' or not bob_private.design_text_present(intent->'alignment'->>'basis') then
  state:='needs_data';issues:=issues||jsonb_build_array(jsonb_build_object('code','design_alignment_required','choice_id',null,'message','Settle the shared direction using prior decisions or the existing mandate, and explain its basis.'));
 end if;
 if chosen.source_media_id is not null and not exists(select 1 from jsonb_array_elements(intent->'references') ref where ref->>'image_id'=chosen.source_media_id::text) then
  state:='needs_data';issues:=issues||jsonb_build_array(jsonb_build_object('code','design_primary_reference_role_required','choice_id',null,'message','Describe how the selected solution image guides this deliverable in the shared reference list.'));
 end if;
 if jsonb_array_length(intent->'features')=0 and exists(select 1 from jsonb_array_elements(intent->'references') ref where ref->>'role' in ('appearance','layout')) then
  state:='needs_data';issues:=issues||jsonb_build_array(jsonb_build_object('code','missing_design_features','choice_id',null,'message','Describe the recognizable form and functions that the appearance or layout references should preserve.'));
 end if;
 for r in select value from jsonb_array_elements(intent->'references') loop
  if not exists(select 1 from bob.media_assets m where m.project_id=p_project and m.id=(r->>'image_id')::uuid and m.state='ready') then
   state:='unavailable';issues:=issues||jsonb_build_array(jsonb_build_object('code','design_reference_unavailable','choice_id',null,'message','A saved design reference is unavailable. Recover its original source rather than replace it with a guess.'));
  end if;
 end loop;
 for c in select value from jsonb_array_elements(intent->'choices') loop
  if c->>'status'='open' then
   if state<>'unavailable' then state:='needs_data';end if;
   issues:=issues||jsonb_build_array(jsonb_build_object('code',case when c->'geometry_dependency'='true'::jsonb then 'design_geometry_choice_open' else 'design_choice_open' end,'choice_id',c->>'id','message','Investigate this choice, advise on the alternatives and record the actual supported direction within the owner or Bob mandate.'));
  elsif c->>'status'='deferred' then
   if purpose='construction' or c->'deferral'->>'scope' is distinct from purpose then
    if state<>'unavailable' then state:='needs_data';end if;
    issues:=issues||jsonb_build_array(jsonb_build_object('code','design_deferral_out_of_scope','choice_id',c->>'id','message','This choice is deferred only for a different limited output. Resolve it before developing construction geometry.'));
   else deferred:=deferred||jsonb_build_array(c->>'id'); end if;
  elsif c->>'status' is distinct from 'resolved' or c->'selected_direction'='null'::jsonb or jsonb_array_length(c->'alternatives')=0
   or exists(select 1 from unnest(array['recommendation','basis','consequences','decision_basis']) key where not bob_private.design_text_present(c->>key)) then
   if state<>'unavailable' then state:='needs_data';end if;
   issues:=issues||jsonb_build_array(jsonb_build_object('code','design_choice_direction_required','choice_id',c->>'id','message','A mandate is not a chosen design. Record the actual direction, expert recommendation, evidence and practical consequences.'));
  end if;
 end loop;
 if state='ready' then
  pin:=jsonb_build_object('version',1,'project_id',p_project,'area_id',target.area_id,'target_revision',target.revision,'solution_id',target.solution_id,'solution_revision',target.solution_revision,'purpose',purpose);
 end if;
 return result||jsonb_build_object('status',state,'issues',issues,'deferred_choice_ids',deferred,'pin',pin);
end $$;
revoke all on function bob.read_design_readiness(text,text,integer,text) from public,anon,service_role;
grant execute on function bob.read_design_readiness(text,text,integer,text) to authenticated;

-- Intercept the solution write only; retain private-turn fences, canonical
-- revision checks and exact original-payload receipt replay.
alter function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_design_intent;
revoke all on function bob_private.bob_project_write_before_design_intent(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; rid text:=p_payload->>'record_id'; quote text:=p_payload->>'request_quote'; msg text; op text;
 existing bob_private.bob_write_receipts; aid uuid; expected integer; before_row jsonb; saved jsonb; rec jsonb; result jsonb;
begin
 if p_payload->>'kind' is distinct from 'solution' then return bob_private.bob_project_write_before_design_intent(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>76000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(quote) not between 1 and 500
  then raise exception 'invalid_write' using errcode='22023';end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023';end if;
 op:='solution:'||coalesce(rid,concat_ws(':','new',d->>'area_id',lower(btrim(d->>'title'))));
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001';end if;return existing.receipt;end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then raise exception 'write_budget_exhausted' using errcode='22023';end if;
 perform 1 from bob.projects where id=p_project for no key update;
 expected:=(p_payload->>'expected_revision')::integer;aid:=coalesce(rid::uuid,gen_random_uuid());
 if rid is not null then
  select to_jsonb(s) into before_row from bob.current_solutions s where id=aid and project_id=p_project;
  if before_row is null then raise exception 'project_denied' using errcode='42501';end if;
  if not d?'source_media_id' then d:=d||jsonb_build_object('source_media_id',before_row->'source_media_id');end if;
 end if;
 saved:=bob_private.solution_command(p_project,case when rid is null then 'create' else 'revise' end,aid,expected,d);
 select to_jsonb(s) into rec from bob.current_solutions s where id=aid and project_id=p_project;
 if rec is null then raise exception 'readback_unavailable';end if;
 result:=jsonb_build_object('projectId',p_project,'dataset','solutions','recordId',aid,'revision',saved->'revision','areaId',rec->'area_id','label',rec->>'title',
  'operation',case when rid is null then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) to authenticated;

alter function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_design_readiness;
revoke all on function bob_private.bob_project_write_before_design_readiness(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v14(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare readiness jsonb; existing bob_private.bob_write_receipts; op text;
begin
 if p_payload->>'kind' is distinct from 'construction' then return bob_private.bob_project_write_before_design_readiness(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 op:='construction:'||(p_payload->'data'->>'key');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 -- An accepted old receipt remains an accepted old receipt; it grants no new
 -- geometry and preserves the old writer's exact replay/conflict checks.
 if found then return bob_private.bob_project_write_before_design_readiness(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 readiness:=bob.read_design_readiness(p_project,p_payload->'data'->>'area_id',(p_payload->'data'->>'target_revision')::integer,'construction');
 if readiness->>'status' is distinct from 'ready' then
  raise exception 'design_readiness_required' using errcode='22023',detail=(readiness->'issues')::text;
 end if;
 perform 1 from bob.media_assets where project_id=p_project and id in (select (ref->>'image_id')::uuid from jsonb_array_elements(readiness->'design_intent'->'references') ref) order by id for update;
 -- Recheck after waiting for source locks; a concurrent deletion cannot turn
 -- an earlier read into permission to develop construction without its source.
 readiness:=bob.read_design_readiness(p_project,p_payload->'data'->>'area_id',(p_payload->'data'->>'target_revision')::integer,'construction');
 if readiness->>'status' is distinct from 'ready' then raise exception 'design_readiness_required' using errcode='22023',detail=(readiness->'issues')::text;end if;
 return bob_private.bob_project_write_before_design_readiness(p_project,p_thread,p_turn,p_generation,p_payload);
end $$;
revoke all on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Every new CAD save carries the same purpose-specific SolutionVersion and the
-- actual original-image versions read for it. Lifecycle copies remain history.
create function bob_private.validate_cad_design_intent() returns trigger
language plpgsql security invoker set search_path='' as $$
declare prior bob.artifact_cad_revisions; historical boolean; artifact bob.artifact_revisions; area text;
 readiness jsonb; images jsonb:=new.manifest->'bob_design_images'; ref jsonb;
begin
 select * into prior from bob.artifact_cad_revisions where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if found and to_jsonb(prior)-'artifact_revision'=to_jsonb(new)-'artifact_revision' then
  select historical_revision.archived<>current_revision.archived into historical from bob.artifact_revisions historical_revision join bob.artifact_revisions current_revision
   on current_revision.artifact_id=historical_revision.artifact_id and current_revision.revision=historical_revision.revision+1 where current_revision.artifact_id=new.artifact_id and current_revision.revision=new.artifact_revision;
  if coalesce(historical,false) then return new;end if;
 end if;
 select * into artifact from bob.artifact_revisions where project_id=new.project_id and artifact_id=new.artifact_id and revision=new.artifact_revision;
 select a.area_id into area from bob.artifacts a where a.project_id=new.project_id and a.id=new.artifact_id;
 readiness:=bob.read_design_readiness(new.project_id,area,artifact.target_revision,new.manifest->'bob_design_intent'->>'purpose');
 if readiness->>'status' is distinct from 'ready' then raise exception 'design_readiness_required' using errcode='22023',detail=(readiness->'issues')::text;end if;
 if new.manifest->'bob_design_intent' is distinct from readiness->'pin' then raise exception 'design_intent_pin_required' using errcode='22023';end if;
 if jsonb_typeof(images) is distinct from 'array' or jsonb_array_length(images)<>jsonb_array_length(readiness->'design_intent'->'references')
  or (select count(distinct x->>'image_id') from jsonb_array_elements(images) x)<>jsonb_array_length(images)
  or exists(select 1 from jsonb_array_elements(images) x where jsonb_typeof(x) is distinct from 'object' or x-array['image_id','source_version']<>'{}'
   or (select count(*) from jsonb_object_keys(x))<>2 or jsonb_typeof(x->'source_version') is distinct from 'string'
   or not exists(select 1 from jsonb_array_elements(readiness->'design_intent'->'references') r where r->>'image_id'=x->>'image_id'))
  then raise exception 'design_image_versions_required' using errcode='22023';end if;
 perform 1 from bob.media_assets where project_id=new.project_id and id in (select (x->>'image_id')::uuid from jsonb_array_elements(images) x) order by id for update;
 for ref in select value from jsonb_array_elements(images) loop
  if not bob_private.cad_image_version_matches(new.project_id,(ref->>'image_id')::uuid,ref->>'source_version') then
   raise exception 'design_image_changed' using errcode='PT409';
  end if;
 end loop;
 return new;
end $$;
revoke all on function bob_private.validate_cad_design_intent() from public,anon,authenticated,service_role;
create trigger validate_cad_design_intent before insert on bob.artifact_cad_revisions for each row execute function bob_private.validate_cad_design_intent();

-- Existing paged lookup keeps its authority, pagination and byte ceiling. The
-- selected target reads its selected historical revision, never the newer head.
alter function bob.search_bob_project_data_v2(text,text,text,text,text,text,text) rename to search_bob_project_data_before_design_intent;
alter function bob.search_bob_project_data_before_design_intent(text,text,text,text,text,text,text) set schema bob_private;
revoke all on function bob_private.search_bob_project_data_before_design_intent(text,text,text,text,text,text,text) from public,anon,service_role;
grant execute on function bob_private.search_bob_project_data_before_design_intent(text,text,text,text,text,text,text) to authenticated;
create function bob.search_bob_project_data_v2(p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,p_record_id text default null,p_after_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; records jsonb; item jsonb; chosen bob.solution_revisions;
begin
 answer:=bob_private.search_bob_project_data_before_design_intent(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
 if p_dataset not in ('solutions','target') then return answer;end if;
 records:='[]';
 for item in select value from jsonb_array_elements(answer->'records') loop
  if p_dataset='solutions' then
   select r.* into chosen from bob.solution_revisions r where r.project_id=p_project_id and r.solution_id=(item->>'id')::uuid and r.revision=(item->>'revision')::integer;
  else
   select r.* into chosen from bob.solution_revisions r where r.project_id=p_project_id and r.solution_id=(item->>'solution_id')::uuid and r.revision=(item->>'solution_revision')::integer;
  end if;
  records:=records||jsonb_build_array(item||jsonb_build_object('source_media_id',chosen.source_media_id,'source_media_title',coalesce(chosen.source_media_title,''),'design_intent',chosen.design_intent));
 end loop;
 answer:=answer||jsonb_build_object('records',records);
 while octet_length(answer::text)>30000 loop
  if jsonb_array_length(records)<=1 then raise exception 'lookup_record_too_large' using errcode='54000';end if;
  records:=records-(jsonb_array_length(records)-1);
  answer:=answer||jsonb_build_object('records',records,'related',coalesce((select jsonb_agg(r) from jsonb_array_elements(answer->'related') r where r->>'parent_id' in (select x->>'id' from jsonb_array_elements(records) x)),'[]'::jsonb),
   'truncated',true,'next_cursor',records->-1->>'id');
 end loop;
 return answer;
end $$;
revoke all on function bob.search_bob_project_data_v2(text,text,text,text,text,text,text) from public,anon,service_role;
grant execute on function bob.search_bob_project_data_v2(text,text,text,text,text,text,text) to authenticated;

alter function bob.read_construction_draft(text,uuid,integer,uuid) rename to read_construction_draft_before_design_intent;
alter function bob.read_construction_draft_before_design_intent(text,uuid,integer,uuid) set schema bob_private;
revoke all on function bob_private.read_construction_draft_before_design_intent(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob_private.read_construction_draft_before_design_intent(text,uuid,integer,uuid) to authenticated;
create function bob.read_construction_draft(p_project text,p_artifact uuid default null,p_revision integer default null,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; artifact bob.artifact_revisions; target bob.target_revisions; chosen bob.solution_revisions; pin jsonb;
begin
 answer:=bob_private.read_construction_draft_before_design_intent(p_project,p_artifact,p_revision,p_after);
 if p_artifact is null or answer->>'status' is distinct from 'ok' then return answer;end if;
 select * into artifact from bob.artifact_revisions where project_id=p_project and artifact_id=p_artifact and revision=(answer->>'revision')::integer;
 select * into chosen from bob.solution_revisions where project_id=p_project and solution_id=artifact.solution_id and revision=artifact.solution_revision;
 select * into target from bob.target_revisions where project_id=p_project and revision=artifact.target_revision;
 if chosen.design_intent is not null then
  pin:=jsonb_build_object('version',1,'project_id',p_project,'area_id',target.area_id,'target_revision',artifact.target_revision,'solution_id',artifact.solution_id,'solution_revision',artifact.solution_revision,'purpose',chosen.design_intent->>'purpose');
 end if;
 return answer||jsonb_build_object('solution_id',artifact.solution_id,'solution_revision',artifact.solution_revision,'design_intent',chosen.design_intent,'design_intent_pin',pin);
end $$;
revoke all on function bob.read_construction_draft(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_draft(text,uuid,integer,uuid) to authenticated;

alter function bob.read_cad_artifact(text,uuid,integer) rename to read_cad_artifact_before_design_intent;
alter function bob.read_cad_artifact_before_design_intent(text,uuid,integer) set schema bob_private;
revoke all on function bob_private.read_cad_artifact_before_design_intent(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cad_artifact_before_design_intent(text,uuid,integer) to authenticated;
create function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; metadata jsonb; artifact bob.artifact_revisions; intent jsonb;
begin
 answer:=bob_private.read_cad_artifact_before_design_intent(p_project,p_artifact,p_revision);
 if answer is null then return null;end if;
 select jsonb_build_object('bob_design_intent',manifest->'bob_design_intent','bob_design_images',manifest->'bob_design_images') into metadata
  from bob.artifact_cad_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=(answer->>'revision')::integer;
 select * into artifact from bob.artifact_revisions where project_id=p_project and artifact_id=p_artifact and revision=(answer->>'revision')::integer;
 select design_intent into intent from bob.solution_revisions where project_id=p_project and solution_id=artifact.solution_id and revision=artifact.solution_revision;
 return answer||jsonb_build_object('manifest',coalesce(answer->'manifest','{}'::jsonb)||jsonb_strip_nulls(metadata),'design_intent',intent);
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
