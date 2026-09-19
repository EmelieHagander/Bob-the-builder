-- Chat ingestion reuses canonical physical and measurement history. No new
-- parallel Building/Space identity store or raw-write privilege is introduced.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.intake_ref(p_refs jsonb,p_value text,p_kind text)
returns uuid language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
  if p_value is null then return null; end if;
  if left(p_value,1)='@' then
    item:=p_refs->substring(p_value from 2);
    if item is null or item->>'kind' is distinct from p_kind then raise exception 'Invalid or forward intake reference' using errcode='22023'; end if;
    return (item->>'id')::uuid;
  end if;
  if p_value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid intake identity' using errcode='22023'; end if;
  return p_value::uuid;
end $$;
revoke all on function bob_private.intake_ref(jsonb,text,text) from public,anon,authenticated;

create function bob_private.valid_intake_operation(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare f jsonb; kind text; allowed text[]; k text; v jsonb; n numeric;
begin
  if p is null or jsonb_typeof(p)<>'object' or p-array['key','kind','record_id','expected_revision','mode','source_quote','source_seq','fields']::text[]<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(p))<>8 then return false; end if;
  kind:=p->>'kind';f:=p->'fields';
  if jsonb_typeof(p->'key') is distinct from 'string' or p->>'key'!~'^[a-z][a-z0-9_]{0,39}$'
    or kind is null or kind<>all(array['building','level','measurement','space','element','relationship'])
    or p->>'mode' is null or p->>'mode'<>all(array['existing','proposed'])
    or jsonb_typeof(p->'source_quote') is distinct from 'string' or length(btrim(p->>'source_quote')) not between 1 and 500
    or jsonb_typeof(p->'expected_revision') is distinct from 'number' or p->>'expected_revision'!~'^\d+$'
    or (p->>'expected_revision')::numeric>2147483647
    or jsonb_typeof(f) is distinct from 'object' or f='{}'::jsonb then return false; end if;
  if p->'source_seq'<>'null'::jsonb and (jsonb_typeof(p->'source_seq')<>'number' or p->>'source_seq'!~'^[1-9]\d*$' or (p->>'source_seq')::numeric>2147483647) then return false; end if;
  if p->'record_id'='null'::jsonb then
    if (p->>'expected_revision')::integer<>0 then return false; end if;
  elsif jsonb_typeof(p->'record_id') is distinct from 'string' or p->>'record_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (p->>'expected_revision')::integer<1 then return false; end if;
  allowed:=case kind when 'building' then array['notes_append'] when 'level' then array['name','position','notes'] when 'measurement' then array['subject','value','unit','truth','notes','required']
    when 'space' then array['name','kind','level_id','notes','truth','measurements'] when 'element' then array['name','kind','space_id','description','truth']
    else array['subject_space_id','object_space_id','relation','notes','truth'] end;
  if f-allowed<>'{}'::jsonb then return false; end if;
  for k,v in select * from jsonb_each(f) loop
    if k=any(array['name','kind','subject','notes','notes_append','description','unit','truth','relation']) then
      if jsonb_typeof(v)<>'string' or length(v#>>'{}')>(case k when 'notes_append' then 2000 when 'notes' then 4000 when 'description' then 6000 when 'kind' then 80 else 200 end)
        or (k<>all(array['notes','description']) and length(btrim(v#>>'{}'))=0) then return false; end if;
    elsif k=any(array['level_id','space_id','subject_space_id','object_space_id']) then
      if v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or length(v#>>'{}')>41) then return false; end if;
    elsif k='position' then
      if jsonb_typeof(v)<>'number' or (v#>>'{}')!~'^-?\d+$' or abs((v#>>'{}')::numeric)>100 then return false; end if;
    elsif k='required' then if jsonb_typeof(v)<>'boolean' then return false; end if;
    elsif k='value' then
      if v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or (v#>>'{}')!~'^\d+(\.\d{1,3})?$' or (v#>>'{}')::numeric>1000000) then return false; end if;
    elsif k='measurements' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then return false; end if;
      if exists(select 1 from jsonb_array_elements(v) m where jsonb_typeof(m)<>'object' or m-array['id','revision']::text[]<>'{}'::jsonb
        or jsonb_typeof(m->'id') is distinct from 'string' or jsonb_typeof(m->'revision') is distinct from 'number' or m->>'revision'!~'^[1-9]\d*$'
        or (m->>'revision')::numeric>2147483647) then return false; end if;
    end if;
  end loop;
  if f?'truth' and f->>'truth'<>all(array['measured','provided_spec','estimated','ai_assessment','unknown']) then return false; end if;
  if kind='measurement' and ((f?'truth' and f->>'truth'='ai_assessment') or (f?'unit' and f->>'unit'<>all(array['mm','cm','m']))) then return false; end if;
  if kind='relationship' and f?'relation' and f->>'relation'<>all(array['adjacent_to','shares_boundary_with','connects_to','above','below','attached_to']) then return false; end if;
  if p->>'mode'='proposed' and (kind=any(array['building','level','measurement']) or f->>'truth' is distinct from 'ai_assessment') then return false; end if;
  if kind='building' and (p->'record_id'='null'::jsonb or not f?'notes_append') then return false; end if;
  if p->'record_id'='null'::jsonb then
    if kind=any(array['level','space','element']) and not f?'name' then return false; end if;
    if kind='element' and not f?'kind' then return false; end if;
    if kind='measurement' and not f?&array['subject','value','unit','truth'] then return false; end if;
    if kind='relationship' and (not f?&array['subject_space_id','object_space_id','relation'] or f->>'subject_space_id' is null or f->>'object_space_id' is null) then return false; end if;
  elsif kind='relationship' and (f?'subject_space_id' or f?'object_space_id') then return false; end if;
  return true;
end $$;
revoke all on function bob_private.valid_intake_operation(jsonb) from public,anon,authenticated;

create function bob_private.bob_project_write_v4(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  d jsonb; bid uuid; bname text; brev integer; batchkey text; ledger bob_private.bob_write_receipts; result jsonb;
  msg text; current_seq bigint; source_text text; source_note text; q text; op jsonb; f jsonb; kind text; mode text; rid uuid; expected integer;
  refs jsonb:='{}'::jsonb; changes jsonb:='[]'::jsonb; before_rows jsonb:='[]'::jsonb; old jsonb; saved jsonb; seen text[]:=array[]::text[];
  parent uuid; a uuid; b uuid; m jsonb; measure_refs jsonb; previous_refs jsonb; creating boolean; direct boolean;
begin
  if p_payload->>'kind' is distinct from 'building_context' then return bob_private.bob_project_write_v3(p_project,p_thread,p_turn,p_generation,p_payload); end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  d:=p_payload->'data';
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>36000
    or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' or p_payload->>'expected_revision'!~'^\d+$'
    or (p_payload->>'expected_revision')::numeric>2147483647 or jsonb_typeof(d) is distinct from 'object'
    or d-array['new_building_name','new_building_notes','operations']::text[]<>'{}'::jsonb or not d?&array['new_building_name','new_building_notes','operations']
    or jsonb_typeof(d->'operations') is distinct from 'array' or jsonb_array_length(d->'operations') not between 1 and 40
    or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or length(btrim(p_payload->>'request_quote')) not between 1 and 500 then
    raise exception 'invalid_intake' using errcode='22023'; end if;
  select text,seq into msg,current_seq from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
  creating:=p_payload->'record_id'='null'::jsonb;
  if not creating and (jsonb_typeof(p_payload->'record_id') is distinct from 'string' or d->'new_building_name'<>'null'::jsonb or d->'new_building_notes'<>'null'::jsonb) then
    raise exception 'invalid_intake' using errcode='22023'; end if;
  if creating and ((p_payload->>'expected_revision')::integer<>0 or jsonb_typeof(d->'new_building_name') is distinct from 'string'
    or length(btrim(d->>'new_building_name')) not between 1 and 200 or jsonb_typeof(d->'new_building_notes') is distinct from 'string'
    or length(d->>'new_building_notes')>4000) then raise exception 'invalid_intake' using errcode='22023'; end if;
  batchkey:='building-context:'||coalesce(p_payload->>'record_id','new:'||lower(btrim(d->>'new_building_name')));
  select * into ledger from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=batchkey;
  if found then
    if ledger.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    -- The project may still exist while the Building's separate access is revoked.
    if not bob_private.has_building_access((ledger.receipt->>'recordId')::uuid) then raise exception 'building_denied' using errcode='42501'; end if;
    return ledger.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023'; end if;
  if creating then
    if exists(select 1 from bob.project_buildings where project_id=p_project and not archived and lower(btrim(name))=lower(btrim(d->>'new_building_name'))) then
      raise exception 'Building name already exists in project; read and reuse its identity' using errcode='40001'; end if;
    bid:=gen_random_uuid();
    perform bob_private.physical_building_command('create',bid,0,jsonb_build_object('name',d->'new_building_name','notes',d->'new_building_notes'));
    perform bob_private.physical_scope_command(p_project,'project','link',gen_random_uuid(),jsonb_build_object('target_kind','building','building_id',bid));
  else bid:=bob_private.intake_ref('{}'::jsonb,p_payload->>'record_id','building'); end if;
  -- A project that sees one room does not get an implicit whole-building write scope.
  if not bob_private.has_building_access(bid) or not exists(select 1 from bob.project_physical_scope s join bob.buildings b on b.id=bid
    where s.project_id=p_project and ((s.target_kind='building' and s.building_id=bid) or (s.target_kind='site' and s.site_id=b.site_id))) then
    raise exception 'building_scope_denied' using errcode='42501'; end if;
  select b.current_revision,r.name into brev,bname from bob.buildings b join bob.building_revisions r on r.building_id=b.id and r.revision=b.current_revision
    where b.id=bid and not r.archived for update of b;
  if not found or (not creating and brev is distinct from (p_payload->>'expected_revision')::integer) then raise exception 'Building changed. Reload before saving.' using errcode='40001'; end if;
  direct:=bob_private.can_edit_building(bid);
  for op in select * from jsonb_array_elements(d->'operations') loop
    if not bob_private.valid_intake_operation(op) or refs?(op->>'key') then raise exception 'invalid_intake_operation' using errcode='22023'; end if;
    kind:=op->>'kind';mode:=op->>'mode';expected:=(op->>'expected_revision')::integer;f:=op->'fields';old:=null;previous_refs:='[]'::jsonb;
    if (mode='existing' or kind in ('level','measurement')) and not direct then raise exception 'building_edit_denied' using errcode='42501'; end if;
    if op->'source_seq'='null'::jsonb then source_text:=msg;
    else select text into source_text from bob.bob_messages where thread_id=p_thread and seq=(op->>'source_seq')::bigint and seq<=current_seq and role='user'; end if;
    q:=op->>'source_quote';
    if source_text is null or position(q in source_text)=0 then raise exception 'source_quote_required' using errcode='22023'; end if;
    source_note:='User description: '||q;
    rid:=case when op->'record_id'='null'::jsonb then gen_random_uuid() else bob_private.intake_ref('{}',op->>'record_id',kind) end;
    if kind||':'||rid::text=any(seen) then raise exception 'Repeated intake identity' using errcode='22023'; end if;
    seen:=array_append(seen,kind||':'||rid::text);
    if expected>0 then
      if kind='building' then
        if rid<>bid then raise exception 'Building root mismatch' using errcode='42501'; end if;
        select to_jsonb(r) into old from bob.buildings h join bob.building_revisions r on r.building_id=h.id and r.revision=h.current_revision where h.id=bid;
      elsif kind='level' then
        select to_jsonb(r) into old from bob.building_levels h join bob.level_revisions r on r.level_id=h.id and r.revision=h.current_revision where h.id=rid and h.building_id=bid for update of h;
      elsif kind='space' then
        select to_jsonb(r) into old from bob.building_spaces h join bob.space_revisions r on r.space_id=h.id and r.revision=h.latest_revision where h.id=rid and h.building_id=bid for update of h;
        select coalesce(jsonb_agg(jsonb_build_object('id',measurement_id,'revision',measurement_revision)),'[]') into previous_refs from bob.space_measurements where space_id=rid and space_revision=expected;
      elsif kind='element' then
        select to_jsonb(r) into old from bob.building_elements h join bob.element_revisions r on r.element_id=h.id and r.revision=h.latest_revision where h.id=rid and h.building_id=bid for update of h;
      elsif kind='relationship' then
        select to_jsonb(r)||jsonb_build_object('subject_space_id',h.subject_space_id,'object_space_id',h.object_space_id) into old from bob.spatial_relationships h join bob.relationship_revisions r on r.relationship_id=h.id and r.revision=h.latest_revision where h.id=rid and h.building_id=bid for update of h;
      else
        select to_jsonb(r) into old from bob.measurements h join bob.measurement_revisions r on r.measurement_id=h.id and r.revision=h.current_revision where h.id=rid and h.project_id=p_project for update of h;
      end if;
      if old is null then raise exception 'Intake record unavailable' using errcode='42501'; end if;
      if (old->>'revision')::integer<>expected or (old->>'archived')::boolean or (old->>'state'='proposed' and (mode='existing' or old->>'project_id' is distinct from p_project)) then
        raise exception 'Intake record changed or has a pending proposal; read before editing' using errcode='40001'; end if;
      before_rows:=before_rows||jsonb_build_array(jsonb_build_object('kind',kind,'id',rid,'record',old));
      -- Only editable fields are forwarded. PATCH means unrelated facts survive.
      select coalesce(jsonb_object_agg(k,value),'{}') into old from jsonb_each(old) e(k,value)
        where k=any(case kind when 'building' then array['name','notes'] when 'level' then array['name','position','notes'] when 'measurement' then array['subject','value','unit','truth','notes','required','source_media_id']
          when 'space' then array['name','kind','level_id','notes','truth'] when 'element' then array['name','kind','space_id','description','truth']
          else array['subject_space_id','object_space_id','relation','notes','truth'] end);
      f:=old||f;
    end if;
    if kind='building' then
      f:=f||jsonb_build_object('notes',concat_ws(E'\n',nullif(f->>'notes',''),f->>'notes_append',source_note));
      f:=f-'notes_append';
      if length(f->>'notes')>4000 then raise exception 'Building notes full; no existing facts were removed' using errcode='22023'; end if;
    elsif kind='level' then
      if expected=0 and exists(select 1 from bob.current_levels where building_id=bid and not archived and lower(btrim(name))=lower(btrim(f->>'name'))) then raise exception 'Level already exists; reuse identity' using errcode='40001'; end if;
    elsif kind='measurement' then
      if expected=0 and exists(select 1 from bob.current_measurements where project_id=p_project and not archived and lower(btrim(subject))=lower(btrim(f->>'subject'))) then raise exception 'Measurement already exists; reuse identity' using errcode='40001'; end if;
      if f->'value'<>'null'::jsonb then f:=jsonb_set(f,'{value}',to_jsonb(f->>'value')); end if;
    elsif kind='space' then
      if f?'level_id' and f->'level_id'<>'null'::jsonb then
        parent:=bob_private.intake_ref(refs,f->>'level_id','level');
        if not exists(select 1 from bob.current_levels where id=parent and building_id=bid and not archived) then raise exception 'Parent level unavailable' using errcode='42501'; end if;
        f:=jsonb_set(f,'{level_id}',to_jsonb(parent));
      end if;
      if expected=0 and exists(select 1 from bob.building_spaces h join bob.space_revisions s on s.space_id=h.id and s.revision=h.latest_revision
        where h.building_id=bid and not s.archived and lower(btrim(s.name))=lower(btrim(f->>'name')) and s.level_id is not distinct from (f->>'level_id')::uuid) then
        raise exception 'Space already exists on this level; reuse identity' using errcode='40001'; end if;
      measure_refs:='[]';
      for m in select * from jsonb_array_elements(coalesce(f->'measurements','[]'::jsonb)) loop
        parent:=bob_private.intake_ref(refs,m->>'id','measurement');
        if left(m->>'id',1)='@' and (refs->substring(m->>'id' from 2)->>'revision')::integer is distinct from (m->>'revision')::integer then
          raise exception 'Local measurement must use the revision saved by this batch' using errcode='22023'; end if;
        if not exists(select 1 from bob.measurement_revisions where measurement_id=parent and revision=(m->>'revision')::integer and project_id=p_project) then raise exception 'Measurement outside project' using errcode='42501'; end if;
        if exists(select 1 from jsonb_array_elements(measure_refs) x where x->>'id'=parent::text) then raise exception 'Repeated measurement' using errcode='22023'; end if;
        measure_refs:=measure_refs||jsonb_build_array(jsonb_build_object('id',parent,'revision',(m->>'revision')::integer));
      end loop;
      if jsonb_array_length(measure_refs)+(select count(*) from jsonb_array_elements(previous_refs) x
        where not exists(select 1 from jsonb_array_elements(measure_refs) y where x->>'id'=y->>'id'))>20 then raise exception 'Too many linked measurements' using errcode='22023'; end if;
      f:=jsonb_set(f,'{measurements}',measure_refs);
    elsif kind='element' then
      if f?'space_id' and f->'space_id'<>'null'::jsonb then
        parent:=bob_private.intake_ref(refs,f->>'space_id','space');
        if not exists(select 1 from bob.building_spaces h join bob.space_revisions r on r.space_id=h.id and r.revision=h.latest_revision
          where h.id=parent and h.building_id=bid and not r.archived and (r.state='accepted' or (mode='proposed' and r.project_id=p_project))) then raise exception 'Parent space unavailable' using errcode='42501'; end if;
        f:=jsonb_set(f,'{space_id}',to_jsonb(parent));
      end if;
      if expected=0 and exists(select 1 from bob.building_elements h join bob.element_revisions e on e.element_id=h.id and e.revision=h.latest_revision
        where h.building_id=bid and not e.archived and lower(btrim(e.name))=lower(btrim(f->>'name')) and e.space_id is not distinct from (f->>'space_id')::uuid) then raise exception 'Element already exists; reuse identity' using errcode='40001'; end if;
    else
      a:=bob_private.intake_ref(refs,f->>'subject_space_id','space');b:=bob_private.intake_ref(refs,f->>'object_space_id','space');
      if a is null or b is null or a=b then raise exception 'Invalid relationship endpoints' using errcode='22023'; end if;
      if (select count(*) from bob.building_spaces h join bob.space_revisions r on r.space_id=h.id and r.revision=h.latest_revision
        where h.id in(a,b) and h.building_id=bid and not r.archived and (r.state='accepted' or (mode='proposed' and r.project_id=p_project)))<>2 then raise exception 'Relationship endpoint unavailable' using errcode='42501'; end if;
      f:=f||jsonb_build_object('subject_space_id',a,'object_space_id',b);
      if expected=0 and exists(select 1 from bob.spatial_relationships h join bob.relationship_revisions r on r.relationship_id=h.id and r.revision=h.latest_revision
        where h.building_id=bid and not r.archived and r.relation=f->>'relation' and ((h.subject_space_id=a and h.object_space_id=b)
          or (f->>'relation'=any(array['adjacent_to','shares_boundary_with','connects_to','attached_to']) and h.subject_space_id=b and h.object_space_id=a))) then
        raise exception 'Relationship already exists; reuse identity' using errcode='40001'; end if;
    end if;
    if kind<>all(array['building','level']) then f:=f||jsonb_build_object('source',source_note);
      if not f?'truth' then f:=f||jsonb_build_object('truth',case when mode='proposed' then 'ai_assessment' else 'provided_spec' end); end if;
    elsif kind='level' then
      -- Levels have no source column, so retain their quote in canonical notes.
      f:=f||jsonb_build_object('notes',concat_ws(E'\n',nullif(f->>'notes',''),source_note));
    end if;
    if expected>0 then f:=f||jsonb_build_object('change_note','Recorded via Bob: '||left(q,450)); end if;
    if kind='building' then
      saved:=bob_private.physical_building_command('revise',bid,expected,f);
      brev:=(saved->>'revision')::integer;
    elsif kind='measurement' then
      saved:=bob_private.evidence_command(p_project,'measurement',case when expected=0 then 'create' else 'revise' end,rid,expected,f);
    else
      if mode='proposed' then f:=f||jsonb_build_object('project_id',p_project); end if;
      saved:=bob_private.physical_node_command(bid,kind,case when mode='proposed' then 'propose' when expected=0 then 'create' else 'revise' end,rid,expected,f);
    end if;
    if kind='space' and expected>0 then
      -- Preserve already authorised physical snapshots, even if the originating
      -- Project was deleted or is no longer readable. Never re-query donor data.
      insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
      select rid,bid,(saved->>'revision')::integer,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
        from bob.space_measurements m where m.space_id=rid and m.space_revision=expected
        and not exists(select 1 from bob.space_measurements n where n.space_id=rid and n.space_revision=(saved->>'revision')::integer and n.measurement_id=m.measurement_id);
    end if;
    saved:=saved||jsonb_build_object('key',op->>'key','kind',kind);
    refs:=refs||jsonb_build_object(op->>'key',saved);changes:=changes||jsonb_build_array(saved);
  end loop;
  result:=jsonb_build_object('projectId',p_project,'dataset','building_context','recordId',bid,'label',bname,
    'operation',case when creating then 'created' else 'updated' end,'savedAt',clock_timestamp(),
    'record',jsonb_build_object('id',bid,'building_revision',brev,'changes',changes,'geometry_ready',false));
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,batchkey,p_payload,jsonb_build_object('records',before_rows),result);
  return result;
end $$;
create function bob.bob_project_write_v4(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v4(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v4(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v4(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v4(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v4(text,uuid,uuid,bigint,jsonb) to authenticated;
-- New static projections use the caller's RLS and explicit active-project scope.
-- Source quotes are evidence, not model instructions. No accounts or global
-- directory of every Building the caller could access is exposed.
create function bob.search_bob_project_data_v5(p_project_id text,p_dataset text,p_query text default null,p_status text default null,
  p_area_id text default null,p_record_id text default null,p_after_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare rows jsonb; n integer; result jsonb;
begin
  if p_dataset<>all(array['physical_buildings','physical_levels','physical_spaces','physical_elements','physical_relationships','physical_proposals','physical_space_measurements']) then
    return bob.search_bob_project_data_v4(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
  end if;
  if auth.uid() is null or not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_status is not null or p_area_id is not null or length(p_query)>200 or length(p_record_id)>200 or length(p_after_id)>200 then raise exception 'invalid_lookup' using errcode='22023'; end if;
  with items as (
    select b.id::text id,jsonb_build_object('id',b.id,'revision',b.revision,'name',b.name,'notes',b.notes,'archived',b.archived,
      'can_edit',bob_private.can_edit_building(b.id),'geometry_ready',false) item
      from bob.project_buildings b where p_dataset='physical_buildings' and b.project_id=p_project_id
    union all
    select l.id::text,jsonb_build_object('id',l.id,'building_id',l.building_id,'revision',l.revision,'name',l.name,'position',l.position,'notes',l.notes,'archived',l.archived)
      from bob.current_levels l where p_dataset='physical_levels' and exists(select 1 from bob.project_buildings b where b.id=l.building_id and b.project_id=p_project_id)
    union all
    select s.id::text,jsonb_build_object('id',s.id,'building_id',s.building_id,'revision',s.revision,'latest_revision',s.latest_revision,'name',s.name,'kind',s.kind,'level_id',s.level_id,
      'truth',s.truth,'source',s.source,'notes',s.notes,'archived',s.archived,'has_proposal',s.has_proposal)
      from bob.project_spaces s where p_dataset='physical_spaces' and s.project_id=p_project_id
    union all
    select e.id::text,jsonb_build_object('id',e.id,'building_id',e.building_id,'revision',e.revision,'latest_revision',e.latest_revision,'name',e.name,'kind',e.kind,'space_id',e.space_id,
      'truth',e.truth,'source',e.source,'description',e.description,'archived',e.archived,'has_proposal',e.has_proposal)
      from bob.project_elements e where p_dataset='physical_elements' and e.project_id=p_project_id
    union all
    select r.id::text,jsonb_build_object('id',r.id,'building_id',r.building_id,'revision',r.revision,'latest_revision',r.latest_revision,'subject_space_id',r.subject_space_id,
      'object_space_id',r.object_space_id,'relation',r.relation,'truth',r.truth,'source',r.source,'notes',r.notes,'archived',r.archived,'has_proposal',r.has_proposal)
      from bob.project_relationships r where p_dataset='physical_relationships' and r.project_id=p_project_id
      and exists(select 1 from bob.project_spaces s where s.project_id=p_project_id and s.id=r.subject_space_id)
      and exists(select 1 from bob.project_spaces s where s.project_id=p_project_id and s.id=r.object_space_id)
    union all
    select m.id::text,jsonb_build_object('id',m.id,'building_id',m.building_id,'space_id',m.space_id,'space_revision',m.space_revision,'measurement_id',m.measurement_id,
      'measurement_revision',m.measurement_revision,'subject',m.subject,'value',m.value::text,'unit',m.unit,'truth',m.truth,'source',m.source)
      from bob.space_measurement_details m join bob.project_spaces s on s.id=m.space_id and s.revision=m.space_revision and s.project_id=p_project_id
      where p_dataset='physical_space_measurements'
    union all
    select s.id::text,jsonb_build_object('id',s.id,'kind','space','state','proposed','building_id',s.building_id,'revision',s.revision,'accepted_revision',s.accepted_revision,
      'name',s.name,'space_kind',s.kind,'level_id',s.level_id,'notes',s.notes,'truth',s.truth,'source',s.source,'archived',s.archived)
      from bob.latest_space_proposals s where p_dataset='physical_proposals' and s.project_id=p_project_id
      and exists(select 1 from bob.project_buildings b where b.id=s.building_id and b.project_id=p_project_id)
    union all
    select e.id::text,jsonb_build_object('id',e.id,'kind','element','state','proposed','building_id',e.building_id,'revision',e.revision,'accepted_revision',e.accepted_revision,
      'name',e.name,'element_kind',e.kind,'space_id',e.space_id,'description',e.description,'truth',e.truth,'source',e.source,'archived',e.archived)
      from bob.latest_element_proposals e where p_dataset='physical_proposals' and e.project_id=p_project_id
      and exists(select 1 from bob.project_buildings b where b.id=e.building_id and b.project_id=p_project_id)
    union all
    select r.id::text,jsonb_build_object('id',r.id,'kind','relationship','state','proposed','building_id',r.building_id,'revision',r.revision,'accepted_revision',r.accepted_revision,
      'subject_space_id',r.subject_space_id,'object_space_id',r.object_space_id,'relation',r.relation,'truth',r.truth,'source',r.source,'notes',r.notes,'archived',r.archived)
      from bob.latest_relationship_proposals r where p_dataset='physical_proposals' and r.project_id=p_project_id
      and exists(select 1 from bob.project_buildings b where b.id=r.building_id and b.project_id=p_project_id)
  ), bounded as (
    select distinct id,item from items where (p_record_id is null or id=p_record_id) and (p_after_id is null or id>p_after_id)
      and (p_query is null or position(lower(p_query) in lower(item::text))>0) order by id limit 26
  ) select coalesce(jsonb_agg(item order by id),'[]') into rows from bounded;
  n:=jsonb_array_length(rows);if n>25 then rows:=rows-25;end if;
  result:=jsonb_build_object('records',rows,'related','[]'::jsonb,'truncated',n>25,'next_cursor',case when n>25 then rows->-1->>'id' else null end);
  while octet_length(result::text)>30000 loop
    n:=jsonb_array_length(result->'records');if n<=1 then raise exception 'Lookup too large; narrow the query' using errcode='22023'; end if;
    rows:=(result->'records')-(n-1);result:=result||jsonb_build_object('records',rows,'truncated',true,'next_cursor',rows->-1->>'id');
  end loop;
  return result;
end $$;
revoke all on function bob.search_bob_project_data_v5(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v5(text,text,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
