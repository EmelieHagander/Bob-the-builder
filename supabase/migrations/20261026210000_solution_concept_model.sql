-- FORM: an optional model on the existing immutable Solution design intent.
-- CLI 2.117.0 aborted on both migration new --help and migration new; this
-- additive identity is allocated after the repository's 20261026200000 head.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.concept_keys(v jsonb, keys text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select case when jsonb_typeof(v)='object' then v-keys='{}' and (select count(*) from jsonb_object_keys(v))=cardinality(keys) else false end
$$;
revoke all on function bob_private.concept_keys(jsonb,text[]) from public,anon,service_role;
grant execute on function bob_private.concept_keys(jsonb,text[]) to authenticated;

-- The same decimal_6/add_v1/subtract_v1/multiply_v1/divide_v1 contract used by
-- CAD, with unresolved values retained instead of forcing a complete recipe.
create function bob_private.solution_concept_result(intent jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare m jsonb:=intent->'model'; n jsonb; c jsonb; v jsonb; a jsonb; b jsonb; f jsonb;
 vals jsonb:='{}'; boxes jsonb:='[]'; issues jsonb:='[]'; ids text[]; k text; u text;
 x numeric; raw numeric; j integer; pass integer; changed boolean; xyz jsonb; dims jsonb;
begin
 if m is null then return jsonb_build_object('values',vals,'boxes',boxes,'issues',issues); end if;
 if not bob_private.concept_keys(m,array['version','frame','nodes','components','views','constraints','unsupported']) or m->'version'<>'1'
  or not bob_private.concept_keys(m->'frame',array['origin','x','y','z']) then raise exception 'invalid_concept_model' using errcode='22023'; end if;
 for v in select value from jsonb_each(m->'frame') loop
  if jsonb_typeof(v)<>'string' or not bob_private.design_text_present(v#>>'{}') or char_length(v#>>'{}')>200 then raise exception 'invalid_concept_frame' using errcode='22023'; end if;
 end loop;
 foreach k in array array['nodes','components','views','constraints','unsupported'] loop
  if jsonb_typeof(m->k) is distinct from 'array' or jsonb_array_length(m->k)>(case k when 'nodes' then 64 when 'components' then 48 when 'views' then 6 when 'constraints' then 24 else 12 end) then raise exception 'invalid_concept_collection' using errcode='22023'; end if;
  if k<>'unsupported' and (select count(distinct q->>'id') from jsonb_array_elements(m->k) q)<>jsonb_array_length(m->k) then raise exception 'invalid_concept_identity' using errcode='22023'; end if;
  if k<>'unsupported' and exists(select 1 from jsonb_array_elements(m->k) q where coalesce(q->>'id','')!~'^[A-Za-z][A-Za-z0-9_-]{0,31}$') then raise exception 'invalid_concept_identity' using errcode='22023'; end if;
 end loop;
 if jsonb_array_length(m->'nodes')<1 or jsonb_array_length(m->'components')<1 or jsonb_array_length(m->'views')<2 then raise exception 'invalid_concept_collection' using errcode='22023'; end if;
 select array_agg(q->>'id') into ids from jsonb_array_elements(m->'nodes') q;
 for n in select value from jsonb_array_elements(m->'nodes') loop
  if n->>'role' in ('decision','estimate','unknown') then
   if not bob_private.concept_keys(n,case when n->>'role'='unknown' then array['id','role','unit','reason'] else array['id','role','value','unit','reason'] end)
    or coalesce(n->>'unit','') not in ('mm','scalar') or jsonb_typeof(n->'reason') is distinct from 'string' or not bob_private.design_text_present(n->>'reason') or char_length(n->>'reason')>2000 then raise exception 'invalid_concept_parameter' using errcode='22023'; end if;
   if n->>'role'<>'unknown' then
    if jsonb_typeof(n->'value') is distinct from 'number' then raise exception 'invalid_concept_parameter' using errcode='22023'; end if;
    x:=(n->>'value')::numeric;
    if abs(x)>1e9 or round(x,6)<>x then raise exception 'invalid_concept_parameter' using errcode='22023'; end if;
    vals:=vals||jsonb_build_object(n->>'id',jsonb_build_object('value',x,'unit',n->>'unit'));
   end if;
  elsif n->>'role'='derived' then
   if not bob_private.concept_keys(n,array['id','role','operation','operands','rounding']) or coalesce(n->>'operation','') not in ('add_v1','subtract_v1','multiply_v1','divide_v1') or coalesce(n->>'rounding','') not in ('exact','half_away_6')
    or jsonb_typeof(n->'operands') is distinct from 'array' or jsonb_array_length(n->'operands')<>2 or exists(select 1 from jsonb_array_elements(n->'operands') q where jsonb_typeof(q)<>'string' or not (q#>>'{}')=any(ids)) then raise exception 'invalid_concept_parameter' using errcode='22023'; end if;
  else raise exception 'invalid_concept_parameter' using errcode='22023'; end if;
 end loop;
 for pass in 1..64 loop
  changed:=false;
  for n in select value from jsonb_array_elements(m->'nodes') where value->>'role'='derived' loop
   if vals?(n->>'id') then continue; end if;
   a:=vals->(n->'operands'->>0); b:=vals->(n->'operands'->>1);
   if a is null or b is null then continue; end if;
   u:=a->>'unit'; raw:=null;
   if n->>'operation' in ('add_v1','subtract_v1') and u=b->>'unit' then
    raw:=(a->>'value')::numeric + (case n->>'operation' when 'add_v1' then 1 else -1 end)*(b->>'value')::numeric;
   elsif n->>'operation'='multiply_v1' and (u='scalar' or b->>'unit'='scalar') then
    raw:=(a->>'value')::numeric*(b->>'value')::numeric; if u='scalar' then u:=b->>'unit'; end if;
   elsif n->>'operation'='divide_v1' and (b->>'unit'='scalar' or u=b->>'unit') and (b->>'value')::numeric<>0 then
    raw:=(a->>'value')::numeric/(b->>'value')::numeric; if u=b->>'unit' then u:='scalar'; end if;
   end if;
   if raw is null or abs(raw)>1e9 or (n->>'rounding'='exact' and round(raw,6)<>raw) then continue; end if;
   vals:=vals||jsonb_build_object(n->>'id',jsonb_build_object('value',round(raw,6),'unit',u)); changed:=true;
  end loop;
  exit when not changed;
 end loop;
 for n in select value from jsonb_array_elements(m->'nodes') loop
  if not vals?(n->>'id') then issues:=issues||jsonb_build_array(jsonb_build_object('code','parameter_unresolved','id',n->>'id')); end if;
 end loop;
 for c in select value from jsonb_array_elements(m->'components') loop
  if not bob_private.concept_keys(c,array['id','label','kind','active','position','size','features','choices']) or coalesce(c->>'kind','') not in ('solid','space','opening') or jsonb_typeof(c->'active') is distinct from 'boolean' then raise exception 'invalid_concept_component' using errcode='22023'; end if;
  foreach k in array array['position','size'] loop
   if jsonb_typeof(c->k) is distinct from 'array' or jsonb_array_length(c->k)<>3 or exists(select 1 from jsonb_array_elements(c->k) q where jsonb_typeof(q)<>'string' or not (q#>>'{}')=any(ids)) then raise exception 'invalid_concept_component' using errcode='22023'; end if;
  end loop;
  foreach k in array array['features','choices'] loop
   if jsonb_typeof(c->k) is distinct from 'array' or jsonb_array_length(c->k)>(case k when 'features' then 24 else 16 end) or exists(select 1 from jsonb_array_elements(c->k) q where jsonb_typeof(q)<>'string' or (q#>>'{}')!~'^[A-Za-z0-9_-]{1,40}$' or (k='features' and char_length(q#>>'{}')>32)) or (select count(distinct q) from jsonb_array_elements(c->k) q)<>jsonb_array_length(c->k) then raise exception 'invalid_concept_link' using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements_text(c->k) link where not exists(select 1 from jsonb_array_elements(intent->k) feature_row where feature_row->>'id'=link)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','design_link_missing','id',c->>'id')); end if;
  end loop;
  if c->'active'='true' then
   xyz:='[]'; dims:='[]';
   for j in 0..2 loop
    a:=vals->(c->'position'->>j); b:=vals->(c->'size'->>j);
    if a->>'unit' is distinct from 'mm' or b->>'unit' is distinct from 'mm' or abs((a->>'value')::numeric)>1e6 or (b->>'value')::numeric not between 0.000001 and 1e6 then exit; end if;
    xyz:=xyz||jsonb_build_array(a->'value'); dims:=dims||jsonb_build_array(b->'value');
   end loop;
   if jsonb_array_length(dims)=3 then boxes:=boxes||jsonb_build_array(c||jsonb_build_object('min',xyz,'size_mm',dims));
   else issues:=issues||jsonb_build_array(jsonb_build_object('code','component_unresolved','id',c->>'id')); end if;
  end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(m->'components') component_row where component_row->'active'='true') then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','empty_model'));
 end if;
 for v in select value from jsonb_array_elements(m->'views') loop
  if not bob_private.concept_keys(v,array['id','label','plane','kind','at']) or coalesce(v->>'plane','') not in ('XY','XZ','YZ') or coalesce(v->>'kind','') not in ('projection','section')
   or (v->>'kind'='projection' and v->'at' is distinct from 'null'::jsonb) or (v->>'kind'='section' and (jsonb_typeof(v->'at') is distinct from 'string' or not (v->>'at')=any(ids))) then raise exception 'invalid_concept_view' using errcode='22023'; end if;
  if v->>'kind'='section' and (vals->(v->>'at')->>'unit' is distinct from 'mm' or abs((vals->(v->>'at')->>'value')::numeric)>1e6) then issues:=issues||jsonb_build_array(jsonb_build_object('code','section_unresolved','id',v->>'id')); end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(m->'views') view_row where view_row->>'plane'='XY' and view_row->>'kind'='projection') or not exists(select 1 from jsonb_array_elements(m->'views') view_row where view_row->>'plane'<>'XY') then raise exception 'concept_plan_and_profile_required' using errcode='22023'; end if;
 for c in select value from jsonb_array_elements(m->'constraints') loop
  if c->>'relation'='view_plane' then
   if not bob_private.concept_keys(c,array['id','label','relation','view','plane','feature']) or coalesce(c->>'plane','') not in ('XY','XZ','YZ') or not exists(select 1 from jsonb_array_elements(m->'views') view_row where view_row->>'id'=c->>'view')
    or (c->'feature' is distinct from 'null'::jsonb and (jsonb_typeof(c->'feature') is distinct from 'string' or (c->>'feature')!~'^[A-Za-z0-9_-]{1,32}$')) then raise exception 'invalid_concept_constraint' using errcode='22023'; end if;
   if not exists(select 1 from jsonb_array_elements(m->'views') view_row where view_row->>'id'=c->>'view' and view_row->>'plane'=c->>'plane') then issues:=issues||jsonb_build_array(jsonb_build_object('code','view_plane_conflict','id',c->>'id')); end if;
   if c->'feature'<>'null' and not exists(select 1 from jsonb_array_elements(intent->'features') feature_row where feature_row->>'id'=c->>'feature') then issues:=issues||jsonb_build_array(jsonb_build_object('code','design_link_missing','id',c->>'id')); end if;
   continue;
  end if;
  if not bob_private.concept_keys(c,array['id','label','relation','left','right','feature']) or coalesce(c->>'relation','') not in ('equal','at_most') or jsonb_typeof(c->'left') is distinct from 'string' or jsonb_typeof(c->'right') is distinct from 'string' or not (c->>'left')=any(ids) or not (c->>'right')=any(ids)
   or (c->'feature' is distinct from 'null'::jsonb and (jsonb_typeof(c->'feature') is distinct from 'string' or (c->>'feature')!~'^[A-Za-z0-9_-]{1,32}$')) then raise exception 'invalid_concept_constraint' using errcode='22023'; end if;
  a:=vals->(c->>'left'); b:=vals->(c->>'right');
  if a is null or b is null or a->>'unit'<>b->>'unit' then issues:=issues||jsonb_build_array(jsonb_build_object('code','constraint_unresolved','id',c->>'id'));
  elsif (c->>'relation'='equal' and a->'value'<>b->'value') or (c->>'relation'='at_most' and (a->>'value')::numeric>(b->>'value')::numeric) then issues:=issues||jsonb_build_array(jsonb_build_object('code','constraint_conflict','id',c->>'id')); end if;
  if c->'feature'<>'null' and not exists(select 1 from jsonb_array_elements(intent->'features') feature_row where feature_row->>'id'=c->>'feature') then issues:=issues||jsonb_build_array(jsonb_build_object('code','design_link_missing','id',c->>'id')); end if;
 end loop;
 foreach k in array array['components','views','constraints'] loop
  if exists(select 1 from jsonb_array_elements(m->k) q where jsonb_typeof(q->'label') is distinct from 'string' or not bob_private.design_text_present(q->>'label') or char_length(q->>'label')>200) then raise exception 'invalid_concept_label' using errcode='22023'; end if;
 end loop;
 foreach k in array array['features','choices'] loop
  for f in select value from jsonb_array_elements(intent->k) loop
   if (k='features' or f->'geometry_dependency'='true') and not exists(select 1 from jsonb_array_elements(m->'components') component_row where component_row->'active'='true' and component_row->k?(f->>'id')) then issues:=issues||jsonb_build_array(jsonb_build_object('code',case k when 'features' then 'feature_missing' else 'choice_missing' end,'id',f->>'id')); end if;
  end loop;
 end loop;
 for v in select value from jsonb_array_elements(m->'unsupported') loop
  if jsonb_typeof(v)<>'string' or not bob_private.design_text_present(v#>>'{}') or char_length(v#>>'{}')>500 then raise exception 'invalid_concept_limitation' using errcode='22023'; end if;
  issues:=issues||jsonb_build_array(jsonb_build_object('code','unsupported','message',v));
 end loop;
 return jsonb_build_object('values',vals,'boxes',boxes,'issues',issues);
end $$;
revoke all on function bob_private.solution_concept_result(jsonb) from public,anon,service_role;
grant execute on function bob_private.solution_concept_result(jsonb) to authenticated;

-- Preserve component identities even when a caller uses the manual RPC instead
-- of Bob's bounded editor. Inactivation leaves the old identity inspectable.
create function bob_private.validate_solution_concept_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare old_model jsonb; k text;
begin
 select design_intent->'model' into old_model from bob.solution_revisions where solution_id=new.solution_id and revision=new.revision-1;
 if old_model is not null then
  if new.design_intent->'model' is null then raise exception 'concept_identity_required' using errcode='22023'; end if;
  foreach k in array array['nodes','components','views','constraints'] loop
   if exists(select 1 from jsonb_array_elements(old_model->k) old_item where not exists(select 1 from jsonb_array_elements(new.design_intent->'model'->k) item where item->>'id'=old_item->>'id')) then raise exception 'concept_identity_required' using errcode='22023'; end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function bob_private.validate_solution_concept_revision() from public,anon,authenticated,service_role;
create trigger validate_solution_concept_revision before insert on bob.solution_revisions for each row execute function bob_private.validate_solution_concept_revision();

-- Exact concept-to-construction mapping is checked on every write path, including
-- bounded part edits. Deferred: the existing role policy is inserted afterwards.
create function bob_private.validate_construction_concept() returns trigger
language plpgsql security invoker set search_path='' as $$
declare intent jsonb; result jsonb; box jsonb; i jsonb; d jsonb; policy jsonb; k integer;
begin
 select s.design_intent into intent from bob.artifact_revisions a join bob.solution_revisions s on s.project_id=a.project_id and s.solution_id=a.solution_id and s.revision=a.solution_revision
  where a.project_id=new.project_id and a.artifact_id=new.artifact_id and a.revision=new.artifact_revision;
 if intent->'model' is null then return new; end if;
 result:=bob_private.solution_concept_result(intent);
 if jsonb_array_length(result->'issues')>0 then raise exception 'concept_reconciliation_required' using errcode='22023'; end if;
 select p.policy into policy from bob.artifact_construction_instance_policies p where p.project_id=new.project_id and p.artifact_id=new.artifact_id and p.artifact_revision=new.artifact_revision;
 for box in select value from jsonb_array_elements(result->'boxes') loop
  select value into i from jsonb_array_elements(new.recipe->'instances') where value->>'id'=box->>'id';
  if i is null then raise exception 'concept_part_missing' using errcode='22023'; end if;
  select value into d from jsonb_array_elements(new.recipe->'definitions') where value->>'id'=i->>'definition_id';
  if d->>'primitive' is distinct from 'box' or jsonb_array_length(coalesce(d->'cuts','[]'))>0 or exists(select 1 from unnest(array['rx','ry','rz']) a where (i->'placement'->>a)::numeric<>0) then raise exception 'concept_mapping_unsupported' using errcode='22023'; end if;
  for k in 0..2 loop
   if (d->>(array['x_mm','y_mm','z_mm'])[k+1])::numeric is distinct from (box->'size_mm'->>k)::numeric or (i->'placement'->>(array['x','y','z'])[k+1])::numeric is distinct from (box->'min'->>k)::numeric then raise exception 'concept_geometry_changed' using errcode='22023'; end if;
  end loop;
  if (box->>'kind'<>'solid') is distinct from exists(select 1 from jsonb_array_elements(policy->'instances') p where p->>'instance_id'=box->>'id' and p->>'role'='reference') then raise exception 'concept_geometry_changed' using errcode='22023'; end if;
 end loop;
 return new;
end $$;
revoke all on function bob_private.validate_construction_concept() from public,anon,authenticated,service_role;
create constraint trigger validate_construction_concept after insert on bob.artifact_construction_revisions deferrable initially deferred for each row execute function bob_private.validate_construction_concept();

-- Replace existing validators/readiness in place; no alternate authority path.
create or replace function bob_private.check_solution_design_intent(p_project text,p_intent jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb; f jsonb; c jsonb; d jsonb; key text; ids text[]:='{}'; image_ids uuid[]:='{}'; image_id uuid;
begin
 if p_intent is null or p_intent='null'::jsonb then return; end if;
 if jsonb_typeof(p_intent) is distinct from 'object' or p_intent-array['version','purpose','summary','references','features','choices','alignment','model']<>'{}'
  or (select count(*) from jsonb_object_keys(p_intent))<>(7+case when p_intent?'model' then 1 else 0 end) or octet_length(p_intent::text)>48000
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
 perform bob_private.solution_concept_result(p_intent);
end $$;

create or replace function bob.read_design_readiness(p_project text,p_area text,p_target_revision integer,p_purpose text)
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
 if purpose='construction' and intent?'model' and jsonb_array_length(bob_private.solution_concept_result(intent)->'issues')>0 then
  if state<>'unavailable' then state:='needs_data'; end if;
  issues:=issues||jsonb_build_array(jsonb_build_object('code','concept_reconciliation_required','choice_id',null,'message','The selected concept has unknown dimensions, missing features, unsupported geometry or conflicting constraints. Read and correct the same Solution before construction.'));
 end if;
 if purpose='construction' and intent?'model' and exists(
  select 1 from bob.solution_measurements pin left join bob.current_measurements measurement on measurement.project_id=pin.project_id and measurement.id=pin.measurement_id
  where pin.project_id=p_project and pin.solution_id=chosen.solution_id and pin.solution_revision=chosen.revision
    and (measurement.id is null or measurement.revision<>pin.measurement_revision or measurement.archived)) then
  if state<>'unavailable' then state:='conflict'; end if;
  issues:=issues||jsonb_build_array(jsonb_build_object('code','concept_source_changed','choice_id',null,'message','A measurement linked to the selected concept has changed or is unavailable. Reconcile its exact source revision before construction.'));
 end if;
 if state='ready' then
  pin:=jsonb_build_object('version',1,'project_id',p_project,'area_id',target.area_id,'target_revision',target.revision,'solution_id',target.solution_id,'solution_revision',target.solution_revision,'purpose',purpose);
 end if;
 return result||jsonb_build_object('status',state,'issues',issues,'deferred_choice_ids',deferred,'pin',pin);
end $$;

commit;
