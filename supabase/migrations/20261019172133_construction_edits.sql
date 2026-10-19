-- Bounded canonical edits. CLI `migration new construction_edits` aborted in
-- Bun before file creation; filename uses the observed UTC clock as fallback.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.merge_construction_edit(original jsonb, change jsonb, identity_key text, collection text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:='[]'; item jsonb; replacement jsonb; k text; seen text[]:='{}'; removals text[]:='{}';
begin
 if change is null then return original; end if;
 if jsonb_typeof(change) is distinct from 'object' or change-array['upsert','remove']<>'{}'
  or (select count(*) from jsonb_object_keys(change))<>2
  or jsonb_typeof(change->'upsert') is distinct from 'array' or jsonb_typeof(change->'remove') is distinct from 'array'
  or jsonb_array_length(change->'upsert')>8192 or jsonb_array_length(change->'remove')>8192
  then raise exception 'construction_edit_shape' using errcode='22023',detail=jsonb_build_object('code','edit_shape','path',collection)::text; end if;
 for item in select value from jsonb_array_elements(change->'remove') loop
  k:=item#>>'{}';
  if jsonb_typeof(item)<>'string' or char_length(k) not between 1 and 240 or k=any(removals)
   or not exists(select 1 from jsonb_array_elements(original) r where r->>identity_key=k)
   then raise exception 'construction_edit_remove' using errcode='22023',detail=jsonb_build_object('code','unknown_or_duplicate_removal','path',collection)::text; end if;
  removals:=array_append(removals,k);
 end loop;
 for item in select value from jsonb_array_elements(change->'upsert') loop
  k:=item->>identity_key;
  if jsonb_typeof(item) is distinct from 'object' or k is null or char_length(k) not between 1 and 240 or k=any(seen) or k=any(removals)
   then raise exception 'construction_edit_identity' using errcode='22023',detail=jsonb_build_object('code','duplicate_or_conflicting_identity','path',collection)::text; end if;
  seen:=array_append(seen,k);
 end loop;
 -- Keep original ordering and unmodified objects. Append only genuinely new IDs.
 for item in select value from jsonb_array_elements(original) loop
  if item->>identity_key=any(removals) then continue; end if;
  select r into replacement from jsonb_array_elements(change->'upsert') r where r->>identity_key=item->>identity_key;
  result:=result||jsonb_build_array(coalesce(replacement,item));
 end loop;
 for item in select value from jsonb_array_elements(change->'upsert') loop
  if not exists(select 1 from jsonb_array_elements(original) r where r->>identity_key=item->>identity_key) then result:=result||jsonb_build_array(item); end if;
 end loop;
 return result;
end $$;
revoke all on function bob_private.merge_construction_edit(jsonb,jsonb,text,text) from public,anon,authenticated,service_role;

-- Same claimed-user boundary as existing parameter edits. Definer is required
-- only to inspect the private receipt ledger and serialize the canonical head.
create function bob.prepare_construction_edit(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; c jsonb:=d->'changes'; command jsonb; existing bob_private.bob_write_receipts;
 draft jsonb; next_data jsonb; original_data jsonb; plan jsonb; roles jsonb; msg text; name text; original jsonb; merged jsonb; count_changes integer:=0; diagnostic text; err text;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1000000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->>'kind' is distinct from 'construction_edit' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'record_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(btrim(p_payload->>'request_quote')) not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','change_note','changes','computed']<>'{}' or (select count(*) from jsonb_object_keys(d))<>4
  or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$' or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or jsonb_typeof(c) is distinct from 'object' or c-array['definitions','instances','nodes','bindings','materials','joints','roles']<>'{}'
  or c='{}'::jsonb then raise exception 'invalid_construction_edit' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 command:=jsonb_set(p_payload,'{data,computed}','null'::jsonb);
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction_edit:'||(d->>'key');
 if found then
  if existing.payload is distinct from command then raise exception 'operation_reused' using errcode='PT409'; end if;
  return jsonb_build_object('status','saved','receipt',existing.receipt);
 end if;
 draft:=bob.read_construction_draft(p_project,(p_payload->>'record_id')::uuid,null,null);
 if draft->>'status' is distinct from 'ok' then raise exception 'not_a_construction_draft' using errcode='22023'; end if;
 if draft->'revision' is distinct from p_payload->'expected_revision' or draft->'archived' is distinct from 'false'::jsonb
  or draft->>'source_state' is distinct from 'current' then raise exception 'construction_changed' using errcode='PT409'; end if;
 plan:=jsonb_build_object('version',1,'frames',coalesce((select jsonb_agg(f-array['source_version','translation_mm','rotation_degrees','axes'] order by n) from jsonb_array_elements(draft->'parameters'->'frames') with ordinality x(f,n)),'[]'),
  'nodes',(select jsonb_agg(v-array['normalized','sources'] order by n) from jsonb_array_elements(draft->'parameters'->'nodes') with ordinality x(v,n)),
  'bindings',draft->'parameters'->'bindings');
 roles:=case when jsonb_typeof(draft->'instance_policy')='object' then draft->'instance_policy'->'instances' else
  (select jsonb_agg(jsonb_build_object('instance_id',i->>'id','role','unknown','quantity_policy','unknown','reason','Historical instance role is not recorded. Classify this exact saved instance.') order by n)
   from jsonb_array_elements(draft->'recipe'->'instances') with ordinality x(i,n)) end;
 next_data:=jsonb_build_object('recipe',draft->'recipe','parameter_plan',plan,'materials',draft->'materials','joints',draft->'joints','instance_policy',jsonb_build_object('version',1,'instances',roles));
 original_data:=next_data;
 for name in select jsonb_object_keys(c) loop
  original:=case when name in ('definitions','instances') then next_data->'recipe'->name
    when name in ('nodes','bindings') then next_data->'parameter_plan'->name
    when name='roles' then next_data->'instance_policy'->'instances' else next_data->name end;
  merged:=bob_private.merge_construction_edit(original,c->name,case name when 'bindings' then 'path' when 'materials' then 'definition_id' when 'roles' then 'instance_id' else 'id' end,name);
  count_changes:=count_changes+jsonb_array_length(c->name->'upsert')+jsonb_array_length(c->name->'remove');
  next_data:=jsonb_set(next_data,case when name in ('definitions','instances') then array['recipe',name]
    when name in ('nodes','bindings') then array['parameter_plan',name]
    when name='roles' then array['instance_policy','instances'] else array[name] end,merged);
 end loop;
 if count_changes=0 or next_data=original_data then return jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','empty_edit','path','changes'))); end if;
 return jsonb_build_object('status','ready','draft',draft,'next',next_data);
exception when sqlstate '22023' then
 get stacked diagnostics err=message_text,diagnostic=pg_exception_detail;
 if err in ('construction_edit_shape','construction_edit_remove','construction_edit_identity') then
  return jsonb_build_object('status','invalid','issues',jsonb_build_array(diagnostic::jsonb));
 end if;
 raise;
end $$;
revoke all on function bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb) to authenticated;

alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_construction_edits;
revoke all on function bob_private.bob_project_write_before_construction_edits(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb; draft jsonb; expected jsonb; d jsonb:=p_payload->'data'; computed jsonb:=d->'computed'; g jsonb:=computed->'parameters'; raw_graph jsonb;
 domain jsonb; result jsonb; inner_key text:='edit_'||md5(d->>'key');
begin
 if p_payload->>'kind' is distinct from 'construction_edit' then return bob_private.bob_project_write_before_construction_edits(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 prepared:=bob.prepare_construction_edit(p_project,p_thread,p_turn,p_generation,p_payload);
 if prepared->>'status'='saved' then return prepared->'receipt'; end if;
 if prepared->>'status'<>'ready' then raise exception 'invalid_construction_edit' using errcode='22023'; end if;
 draft:=prepared->'draft';expected:=prepared->'next';
 if jsonb_typeof(computed) is distinct from 'object' or computed-array['recipe','parameters']<>'{}' or (select count(*) from jsonb_object_keys(computed))<>2
  or jsonb_typeof(g) is distinct from 'object' or jsonb_typeof(g->'nodes') is distinct from 'array'
  or jsonb_typeof(g->'frames') is distinct from 'array' then raise exception 'construction_edit_compilation_required' using errcode='22023'; end if;
 raw_graph:=jsonb_build_object('version',1,'frames',coalesce((select jsonb_agg(f-array['source_version','translation_mm','rotation_degrees','axes'] order by n) from jsonb_array_elements(g->'frames') with ordinality x(f,n)),'[]'),
  'nodes',(select jsonb_agg(v-array['normalized','sources'] order by v->>'id') from jsonb_array_elements(g->'nodes') v),'bindings',g->'bindings');
 -- Node evaluation order may be topological. All named inputs/formulas must
 -- still be exactly the server-merged plan, with no extra computed payload edits.
 expected:=jsonb_set(expected,'{parameter_plan,nodes}',(select jsonb_agg(v order by v->>'id') from jsonb_array_elements(expected->'parameter_plan'->'nodes') v));
 if raw_graph is distinct from expected->'parameter_plan' then raise exception 'construction_edit_compilation_mismatch' using errcode='22023'; end if;
 perform bob_private.check_parameter_change_recipe(expected->'recipe',computed->'recipe');
 domain:=p_payload||jsonb_build_object('kind','construction','data',jsonb_build_object('key',inner_key,'change_note',d->'change_note',
  'title',draft->'title','description',draft->'description','area_id',draft->'area_id','target_revision',draft->'target_revision',
  'recipe',computed->'recipe','parameters',g,'materials',expected->'materials','joints',expected->'joints',
  'open_questions',draft->'open_questions','instance_policy',expected->'instance_policy'));
 -- Delegate through the complete current writer chain: intent/readiness,
 -- immutable identities, source locks, numeric validation and consequences.
 result:=bob_private.bob_project_write_before_construction_edits(p_project,p_thread,p_turn,p_generation,domain);
 update bob_private.bob_write_receipts set operation_key='construction_edit:'||(d->>'key'),payload=jsonb_set(p_payload,'{data,computed}','null'::jsonb)
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||inner_key and payload=domain and receipt=result;
 if not found then raise exception 'construction_edit_receipt_missing' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
