-- Room dimensions. Owner decisions 2026-10-25/26; contracts:
-- Docs/building-model.md#room-dimensions--owner-decisions-2026-10-26 and
-- db/README.md#room-dimensions--2026-10-26.
--
-- 1. A measurement says what it measures: nullable `property`, `side` and
--    `reference` on the measurement identity (not on a revision), set once.
--    Classifying never appends a revision, so pinned drawings stay current.
--    Room snapshots (`space_measurements`) mirror the three columns.
-- 2. `evidence_command` gains a guarded fill-once `classify` action; create and
--    revise accept the same fields while the measurement is unclassified.
-- 3. A Space revise/propose that omits `measurements` keeps the snapshots of
--    the revision it replaces. An explicit array (also []) still replaces them.
-- 4. `bob.project_room_dimensions`: per project room and property/side/
--    reference, the room's accepted snapshots, strongest truth first, with
--    status known | conflict | unknown. Nothing is derived.
-- 5. `bob.search_bob_project_data_v9` adds Bob's `room_dimensions` dataset;
--    every other dataset is v8 unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Typed classification on the identity, mirrored on room snapshots.
alter table bob.measurements
  add column property text,
  add column side text,
  add column reference text,
  add column classified_by uuid,
  add column classified_actor text,
  add column classified_at timestamptz,
  add constraint measurement_property_known check (property is null or property in
    ('room_length','room_width','ceiling_height','wall_length','opening_width','opening_height','sill_height','opening_offset','other')),
  add constraint measurement_side_known check (side is null or side in ('N','E','S','W')),
  add constraint measurement_reference_size check (reference is null or char_length(btrim(reference)) between 1 and 120),
  add constraint measurement_property_first check (property is not null or (side is null and reference is null)),
  -- classified_by stays null only for an owner-approved operator script.
  add constraint measurement_classification_audit check (
    (property is null and classified_by is null and classified_actor is null and classified_at is null) or
    (property is not null and classified_at is not null and char_length(btrim(classified_actor)) between 1 and 200));

alter table bob.space_measurements
  add column property text,
  add column side text,
  add column reference text,
  add constraint space_measurement_property_known check (property is null or property in
    ('room_length','room_width','ceiling_height','wall_length','opening_width','opening_height','sill_height','opening_offset','other')),
  add constraint space_measurement_side_known check (side is null or side in ('N','E','S','W')),
  add constraint space_measurement_reference_size check (reference is null or char_length(btrim(reference)) between 1 and 120);

-- Fill-once on every path (commands, Bob writers, operator scripts). To change
-- what a measurement measures, archive it and record a new one.
create function bob_private.guard_measurement_classification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.property is not null and (new.property,new.side,new.reference) is distinct from (old.property,old.side,old.reference) then
    raise exception 'measurement_already_classified' using errcode='55000';
  end if;
  return new;
end $$;
create trigger guard_measurement_classification before update of property,side,reference on bob.measurements
  for each row execute function bob_private.guard_measurement_classification();

-- Every snapshot insert (manual link, Bob intake carry-forward, acceptance,
-- archive/restore copy) takes the identity's classification.
create function bob_private.fill_space_measurement_property() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select m.property,m.side,m.reference into new.property,new.side,new.reference
    from bob.measurements m where m.id=new.measurement_id;
  return new;
end $$;
create trigger fill_space_measurement_property before insert on bob.space_measurements
  for each row execute function bob_private.fill_space_measurement_property();

-- Classification is identity metadata: all snapshots of the measurement follow.
create function bob_private.sync_space_measurement_property() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update bob.space_measurements set property=new.property,side=new.side,reference=new.reference
    where measurement_id=new.id and (property,side,reference) is distinct from (new.property,new.side,new.reference);
  return null;
end $$;
create trigger sync_space_measurement_property after update of property,side,reference on bob.measurements
  for each row when ((old.property,old.side,old.reference) is distinct from (new.property,new.side,new.reference))
  execute function bob_private.sync_space_measurement_property();

revoke all on function bob_private.guard_measurement_classification(),bob_private.fill_space_measurement_property(),
  bob_private.sync_space_measurement_property() from public,anon,authenticated,service_role;

-- Existing columns keep their order; the classification is appended.
create or replace view bob.current_measurements with (security_invoker = true) as
select h.id, h.project_id, h.area_id, h.component_id, r.revision, r.subject,
  r.value::text as value, r.unit,
  (r.value * case r.unit when 'm' then 1000 when 'cm' then 10 else 1 end)::text as millimetres,
  r.truth, r.source, r.notes, r.required, r.source_media_id, r.source_media_title,
  r.archived, r.change_note, r.recorded_by, r.actor_label, r.recorded_at,
  h.property, h.side, h.reference, h.classified_actor, h.classified_at
from bob.measurements h join bob.measurement_revisions r
  on r.measurement_id=h.id and r.project_id=h.project_id and r.revision=h.current_revision;
create or replace view bob.space_measurement_details with (security_invoker=true) as
select m.* from bob.space_measurements m;

-- 2. The measurement command path, with a fill-once classify action. Body as
-- in 20260909221503 apart from the marked classification lines.
create or replace function bob_private.evidence_command(
  p_project text, p_kind text, p_action text, p_record uuid, p_expected integer, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  actor text;
  area text;
  component uuid;
  image_id uuid;
  image_title text := '';
  next_revision integer;
  c bob.existing_components;
  m bob.measurements;
  cr bob.component_revisions;
  mr bob.measurement_revisions;
  allowed text[];
  -- classification
  wants_class boolean := false;
  class_property text;
  class_side text;
  class_reference text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_record is null or p_kind is null or p_kind not in ('measurement','component')
    or p_action is null or p_action not in ('create','revise','archive','restore','classify')
    or (p_action='classify' and p_kind<>'measurement')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000 then
    raise exception 'Invalid project fact command';
  end if;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  allowed := case when p_kind='measurement'
    then array['subject','value','unit','truth','source','notes','required','source_media_id','change_note','property','side','reference']
    else array['name','kind','quantity','condition','specification','intent','notes','source_media_id','change_note'] end;
  if p_action='create' then allowed := allowed || array['area_id','component_id']; end if;
  if p_action in ('archive','restore') then allowed := array[]::text[]; end if;
  if p_action='classify' then allowed := array['property','side','reference']; end if;
  if p_data - allowed <> '{}'::jsonb or (p_kind='component' and p_data ? 'component_id') then
    raise exception 'Unsupported fields. Identity, parents and recorded history cannot be rewritten.';
  end if;

  -- classification: validated once; null property means "not saying".
  if p_kind='measurement' then
    if (p_data ? 'property' and jsonb_typeof(p_data->'property') not in ('string','null'))
      or (p_data ? 'side' and jsonb_typeof(p_data->'side') not in ('string','null'))
      or (p_data ? 'reference' and jsonb_typeof(p_data->'reference') not in ('string','null')) then
      raise exception 'invalid_measurement_property' using errcode='22023';
    end if;
    class_property := nullif(btrim(p_data->>'property'),'');
    class_side := nullif(btrim(p_data->>'side'),'');
    class_reference := nullif(btrim(p_data->>'reference'),'');
    if class_property is null and (class_side is not null or class_reference is not null) then
      raise exception 'measurement_property_required' using errcode='22023';
    end if;
    if class_property is not null and class_property not in
      ('room_length','room_width','ceiling_height','wall_length','opening_width','opening_height','sill_height','opening_offset','other') then
      raise exception 'invalid_measurement_property' using errcode='22023';
    end if;
    if class_side is not null and class_side not in ('N','E','S','W') then
      raise exception 'invalid_measurement_side' using errcode='22023';
    end if;
    if char_length(class_reference) > 120 then
      raise exception 'invalid_measurement_reference' using errcode='22023';
    end if;
    wants_class := class_property is not null;
    if p_action='classify' and not wants_class then
      raise exception 'measurement_property_required' using errcode='22023';
    end if;
  end if;

  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New records start at revision zero'; end if;
    if exists(select 1 from bob.measurements where id=p_record) or
       exists(select 1 from bob.existing_components where id=p_record) then
      raise exception 'Record already exists. Reload the list before creating another.';
    end if;
    area := nullif(p_data->>'area_id','');
    component := nullif(p_data->>'component_id','')::uuid;
    if component is not null then
      select * into c from bob.existing_components where id=component and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if (select archived from bob.component_revisions where component_id=c.id and revision=c.current_revision) then
        raise exception 'Restore the component before adding a measurement.';
      end if;
      if p_data ? 'area_id' and area is distinct from c.area_id then
        raise exception 'The measurement must use its component area.';
      end if;
      area := c.area_id;
    end if;
    if area is not null then
      perform 1 from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    if p_kind='measurement' then
      insert into bob.measurements(id,project_id,area_id,component_id,
        property,side,reference,classified_by,classified_actor,classified_at)
      values(p_record,p_project,area,component,
        class_property,class_side,class_reference,
        case when wants_class then uid end,
        case when wants_class then coalesce(actor,'Project member') end,
        case when wants_class then clock_timestamp() end);
    else
      insert into bob.existing_components(id,project_id,area_id) values(p_record,p_project,area);
    end if;
    next_revision := 1;
  else
    if p_kind='measurement' then
      select * into m from bob.measurements where id=p_record and project_id=p_project for update;
      if not found then raise exception 'Record unavailable'; end if;
      if p_expected is distinct from m.current_revision then raise exception 'Record changed. Reload before saving again.'; end if;
      select * into mr from bob.measurement_revisions where measurement_id=m.id and revision=m.current_revision;
      if p_action in ('revise','classify') and mr.archived then raise exception 'Restore this record before editing.'; end if;
      if (p_action='archive' and mr.archived) or (p_action='restore' and not mr.archived) then
        raise exception 'Record changed. Reload before saving again.';
      end if;
      -- classification: fill-once. Repeating the saved classification is a no-op.
      if wants_class then
        if m.property is null then
          update bob.measurements set property=class_property,side=class_side,reference=class_reference,
            classified_by=uid,classified_actor=coalesce(actor,'Project member'),classified_at=clock_timestamp()
          where id=p_record;
        elsif (m.property,m.side,m.reference) is distinct from (class_property,class_side,class_reference) then
          raise exception 'measurement_already_classified' using errcode='55000';
        end if;
      end if;
      if p_action='classify' then
        return jsonb_build_object('id',p_record,'revision',m.current_revision,
          'property',class_property,'side',class_side,'reference',class_reference);
      end if;
    else
      select * into c from bob.existing_components where id=p_record and project_id=p_project for update;
      if not found then raise exception 'Record unavailable'; end if;
      if p_expected is distinct from c.current_revision then raise exception 'Record changed. Reload before saving again.'; end if;
      select * into cr from bob.component_revisions where component_id=c.id and revision=c.current_revision;
      if p_action='revise' and cr.archived then raise exception 'Restore this record before editing.'; end if;
      if (p_action='archive' and cr.archived) or (p_action='restore' and not cr.archived) then
        raise exception 'Record changed. Reload before saving again.';
      end if;
    end if;
    next_revision := p_expected + 1;
  end if;

  if p_action in ('create','revise') then
    image_id := nullif(p_data->>'source_media_id','')::uuid;
    if image_id is not null then
      select title into image_title from bob.media_assets
        where id=image_id and project_id=p_project and state='ready' for share;
      if not found then raise exception 'Source image unavailable in this project'; end if;
    end if;
    if p_kind='measurement' then
      mr.subject := btrim(p_data->>'subject');
      mr.value := nullif(p_data->>'value','')::numeric;
      mr.unit := p_data->>'unit';
      mr.truth := p_data->>'truth';
      mr.source := btrim(coalesce(p_data->>'source',''));
      mr.notes := btrim(coalesce(p_data->>'notes',''));
      mr.required := coalesce((p_data->>'required')::boolean,false);
      mr.source_media_id := image_id;
      mr.source_media_title := image_title;
      mr.archived := false;
    else
      cr.name := btrim(p_data->>'name');
      cr.kind := btrim(coalesce(p_data->>'kind',''));
      cr.quantity := nullif(p_data->>'quantity','')::integer;
      cr.condition := btrim(coalesce(p_data->>'condition',''));
      cr.specification := btrim(coalesce(p_data->>'specification',''));
      cr.intent := coalesce(p_data->>'intent','inspect');
      cr.notes := btrim(coalesce(p_data->>'notes',''));
      cr.source_media_id := image_id;
      cr.source_media_title := image_title;
      cr.archived := false;
    end if;
  end if;
  if p_kind='measurement' then
    mr.id := gen_random_uuid(); mr.measurement_id := p_record; mr.project_id := p_project;
    mr.revision := next_revision; mr.recorded_by := uid; mr.actor_label := actor; mr.recorded_at := clock_timestamp();
    mr.change_note := case p_action when 'create' then 'Initial record' when 'archive' then 'Archived'
      when 'restore' then 'Restored' else btrim(p_data->>'change_note') end;
    if p_action in ('archive','restore') then mr.archived := (p_action='archive'); end if;
    insert into bob.measurement_revisions select mr.*;
    update bob.measurements set current_revision=next_revision where id=p_record;
  else
    cr.id := gen_random_uuid(); cr.component_id := p_record; cr.project_id := p_project;
    cr.revision := next_revision; cr.recorded_by := uid; cr.actor_label := actor; cr.recorded_at := clock_timestamp();
    cr.change_note := case p_action when 'create' then 'Initial record' when 'archive' then 'Archived'
      when 'restore' then 'Restored' else btrim(p_data->>'change_note') end;
    if p_action in ('archive','restore') then cr.archived := (p_action='archive'); end if;
    insert into bob.component_revisions select cr.*;
    update bob.existing_components set current_revision=next_revision where id=p_record;
  end if;
  return jsonb_build_object('id',p_record,'revision',next_revision);
end $$;

-- 3. Space measurements carry forward when a revise/propose omits them.
-- Body as in 20260913213712 apart from the marked space measurement block.
create or replace function bob_private.physical_node_command(
  p_building uuid,p_kind text,p_action text,p_record uuid,p_expected integer,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); actor text; next_rev integer; project text; direct boolean;
  level_head bob.building_levels; level_old bob.level_revisions;
  space_head bob.building_spaces; space_old bob.space_revisions; space_new bob.space_revisions;
  element_head bob.building_elements; element_old bob.element_revisions; element_new bob.element_revisions;
  rel_head bob.spatial_relationships; rel_old bob.relationship_revisions; rel_new bob.relationship_revisions;
  measure jsonb; mr bob.measurement_revisions; carry_rev integer;
begin
  if uid is null or p_building is null or p_record is null or p_kind not in ('level','space','element','relationship')
    or p_action not in ('create','revise','archive','restore','propose','accept')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid physical context command'; end if;
  direct:=bob_private.can_edit_building(p_building);
  if not bob_private.has_building_access(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
  actor:=bob_private.physical_actor();

  if p_kind='level' then
    if p_action not in ('create','revise','archive','restore') or not direct then raise exception 'building_denied' using errcode='42501'; end if;
    if p_action='create' then
      if p_expected is distinct from 0 or exists(select 1 from bob.building_levels where id=p_record) then raise exception 'Level changed. Reload before saving.'; end if;
      if p_data - array['name','position','notes']::text[] <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      insert into bob.building_levels(id,building_id) values(p_record,p_building); next_rev:=1;
      insert into bob.level_revisions(level_id,building_id,revision,name,position,notes,archived,change_note,recorded_by,actor_label)
        values(p_record,p_building,1,btrim(p_data->>'name'),coalesce((p_data->>'position')::integer,0),btrim(coalesce(p_data->>'notes','')),false,'Initial level',uid,actor);
    else
      select * into level_head from bob.building_levels where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from level_head.current_revision then raise exception 'Level changed. Reload before saving.'; end if;
      select * into level_old from bob.level_revisions where level_id=p_record and revision=level_head.current_revision;
      if p_action='revise' and p_data - array['name','position','notes','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      if p_action in ('archive','restore') and p_data <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      next_rev:=level_head.current_revision+1;
      insert into bob.level_revisions(level_id,building_id,revision,name,position,notes,archived,change_note,recorded_by,actor_label)
        values(p_record,p_building,next_rev,
          case when p_action='revise' then btrim(p_data->>'name') else level_old.name end,
          case when p_action='revise' then coalesce((p_data->>'position')::integer,0) else level_old.position end,
          case when p_action='revise' then btrim(coalesce(p_data->>'notes','')) else level_old.notes end,
          case when p_action='archive' then true when p_action='restore' then false else level_old.archived end,
          case p_action when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end,uid,actor);
      update bob.building_levels set current_revision=next_rev where id=p_record;
    end if;
    return jsonb_build_object('id',p_record,'revision',next_rev);
  end if;

  project:=nullif(p_data->>'project_id','');
  if p_action='propose' then
    if project is null or not bob_private.project_scopes_building(project,p_building) then raise exception 'project_denied' using errcode='42501'; end if;
  elsif p_action='accept' or p_action in ('create','revise','archive','restore') then
    if not direct then raise exception 'building_denied' using errcode='42501'; end if;
  end if;

  if p_kind='space' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.building_spaces where id=p_record) then
      insert into bob.building_spaces(id,building_id,latest_revision,accepted_revision)
        values(p_record,p_building,1,case when p_action='create' then 1 else null end);
      next_rev:=1;
      space_new.space_id:=p_record; space_new.building_id:=p_building; space_new.revision:=1;
    else
      select * into space_head from bob.building_spaces where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from space_head.latest_revision then raise exception 'Space changed. Reload before saving.'; end if;
      select * into space_old from bob.space_revisions where space_id=p_record and revision=coalesce(space_head.latest_revision,space_head.accepted_revision);
      if p_action='accept' then
        if space_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=space_head.latest_revision+1;
        space_new:=space_old; space_new.id:=gen_random_uuid(); space_new.revision:=next_rev; space_new.state:='accepted';
        space_new.recorded_by:=uid; space_new.actor_label:=actor; space_new.recorded_at:=clock_timestamp(); space_new.change_note:='Accepted proposal';
      else
        next_rev:=space_head.latest_revision+1;
        space_new.space_id:=p_record; space_new.building_id:=p_building; space_new.revision:=next_rev;
      end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported space fields'; end if;
        space_new.project_id:=space_old.project_id; space_new.level_id:=space_old.level_id; space_new.state:='accepted';
        space_new.name:=space_old.name; space_new.kind:=space_old.kind; space_new.notes:=space_old.notes; space_new.truth:=space_old.truth; space_new.source:=space_old.source;
        space_new.archived:=(p_action='archive'); space_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','level_id','name','kind','notes','truth','source','measurements','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported space fields'; end if;
        space_new.project_id:=case when p_action='propose' then project else null end;
        space_new.level_id:=nullif(p_data->>'level_id','')::uuid;
        if space_new.level_id is not null and not exists(select 1 from bob.building_levels where id=space_new.level_id and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
        space_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;
        space_new.name:=btrim(p_data->>'name'); space_new.kind:=btrim(coalesce(p_data->>'kind','')); space_new.notes:=btrim(coalesce(p_data->>'notes',''));
        space_new.truth:=coalesce(p_data->>'truth','unknown'); space_new.source:=btrim(coalesce(p_data->>'source','')); space_new.archived:=coalesce((p_data->>'archived')::boolean,false);
        space_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial space' end else btrim(p_data->>'change_note') end;
      end if;
      space_new.recorded_by:=uid; space_new.actor_label:=actor; space_new.recorded_at:=clock_timestamp(); space_new.id:=gen_random_uuid();
    end if;
    insert into bob.space_revisions select space_new.*;
    update bob.building_spaces set latest_revision=next_rev,
      accepted_revision=case when space_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    -- space measurements: an explicit array (also []) replaces the snapshots; an
    -- omitted key keeps those of the revision this one replaces: the accepted
    -- revision for an accepted change, the latest for a proposal.
    if p_action in ('accept','archive','restore') then
      insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
      select p_record,p_building,next_rev,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
      from bob.space_measurements m where m.space_id=p_record and m.space_revision=space_old.revision;
    elsif p_data ? 'measurements' then
      if jsonb_typeof(p_data->'measurements')<>'array' then raise exception 'invalid_space_measurements' using errcode='22023'; end if;
      for measure in select * from jsonb_array_elements(p_data->'measurements') loop
        select * into mr from bob.measurement_revisions where measurement_id=(measure->>'id')::uuid and revision=(measure->>'revision')::integer;
        if not found or not bob_private.has_project_access(mr.project_id) then raise exception 'Measurement unavailable for this building context' using errcode='42501'; end if;
        insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
          values(p_record,p_building,next_rev,mr.project_id,mr.measurement_id,mr.revision,mr.subject,mr.value,mr.unit,mr.truth,mr.source);
      end loop;
    else
      carry_rev:=case when p_action='propose' then space_head.latest_revision else space_head.accepted_revision end;
      if carry_rev is not null then
        insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
        select p_record,p_building,next_rev,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
        from bob.space_measurements m where m.space_id=p_record and m.space_revision=carry_rev;
      end if;
    end if;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',space_new.state);
  end if;

  if p_kind='element' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.building_elements where id=p_record) then
      insert into bob.building_elements(id,building_id,latest_revision,accepted_revision) values(p_record,p_building,1,case when p_action='create' then 1 else null end);
      next_rev:=1; element_new.element_id:=p_record; element_new.building_id:=p_building; element_new.revision:=1;
    else
      select * into element_head from bob.building_elements where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from element_head.latest_revision then raise exception 'Element changed. Reload before saving.'; end if;
      select * into element_old from bob.element_revisions where element_id=p_record and revision=element_head.latest_revision;
      if p_action='accept' then
        if element_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=element_head.latest_revision+1; element_new:=element_old; element_new.id:=gen_random_uuid(); element_new.revision:=next_rev; element_new.state:='accepted';
        element_new.recorded_by:=uid;element_new.actor_label:=actor;element_new.recorded_at:=clock_timestamp();element_new.change_note:='Accepted proposal';
      else next_rev:=element_head.latest_revision+1;element_new.element_id:=p_record;element_new.building_id:=p_building;element_new.revision:=next_rev; end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported element fields'; end if;
        element_new.project_id:=element_old.project_id;element_new.space_id:=element_old.space_id;element_new.state:='accepted';element_new.kind:=element_old.kind;element_new.name:=element_old.name;
        element_new.description:=element_old.description;element_new.truth:=element_old.truth;element_new.source:=element_old.source;element_new.archived:=(p_action='archive');
        element_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','space_id','kind','name','description','truth','source','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported element fields'; end if;
        element_new.project_id:=case when p_action='propose' then project else null end;element_new.space_id:=nullif(p_data->>'space_id','')::uuid;
        if element_new.space_id is not null and not exists(select 1 from bob.building_spaces where id=element_new.space_id and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
        element_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;element_new.kind:=btrim(p_data->>'kind');element_new.name:=btrim(p_data->>'name');
        element_new.description:=btrim(coalesce(p_data->>'description',''));element_new.truth:=coalesce(p_data->>'truth','unknown');element_new.source:=btrim(coalesce(p_data->>'source',''));
        element_new.archived:=coalesce((p_data->>'archived')::boolean,false);element_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial element' end else btrim(p_data->>'change_note') end;
      end if;
      element_new.recorded_by:=uid;element_new.actor_label:=actor;element_new.recorded_at:=clock_timestamp();element_new.id:=gen_random_uuid();
    end if;
    insert into bob.element_revisions select element_new.*;
    update bob.building_elements set latest_revision=next_rev,accepted_revision=case when element_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',element_new.state);
  end if;

  if p_kind='relationship' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.spatial_relationships where id=p_record) then
      if not exists(select 1 from bob.building_spaces where id=(p_data->>'subject_space_id')::uuid and building_id=p_building)
        or not exists(select 1 from bob.building_spaces where id=(p_data->>'object_space_id')::uuid and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
      insert into bob.spatial_relationships(id,building_id,subject_space_id,object_space_id,latest_revision,accepted_revision)
        values(p_record,p_building,(p_data->>'subject_space_id')::uuid,(p_data->>'object_space_id')::uuid,1,case when p_action='create' then 1 else null end);
      next_rev:=1;rel_new.relationship_id:=p_record;rel_new.building_id:=p_building;rel_new.revision:=1;
    else
      select * into rel_head from bob.spatial_relationships where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from rel_head.latest_revision then raise exception 'Relationship changed. Reload before saving.'; end if;
      select * into rel_old from bob.relationship_revisions where relationship_id=p_record and revision=rel_head.latest_revision;
      if p_action='accept' then
        if rel_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=rel_head.latest_revision+1;rel_new:=rel_old;rel_new.id:=gen_random_uuid();rel_new.revision:=next_rev;rel_new.state:='accepted';
        rel_new.recorded_by:=uid;rel_new.actor_label:=actor;rel_new.recorded_at:=clock_timestamp();rel_new.change_note:='Accepted proposal';
      else next_rev:=rel_head.latest_revision+1;rel_new.relationship_id:=p_record;rel_new.building_id:=p_building;rel_new.revision:=next_rev; end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported relationship fields'; end if;
        rel_new.project_id:=rel_old.project_id;rel_new.state:='accepted';rel_new.relation:=rel_old.relation;rel_new.truth:=rel_old.truth;rel_new.source:=rel_old.source;rel_new.notes:=rel_old.notes;
        rel_new.archived:=(p_action='archive');rel_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','subject_space_id','object_space_id','relation','truth','source','notes','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported relationship fields'; end if;
        rel_new.project_id:=case when p_action='propose' then project else null end;rel_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;
        rel_new.relation:=p_data->>'relation';rel_new.truth:=coalesce(p_data->>'truth','unknown');rel_new.source:=btrim(coalesce(p_data->>'source',''));rel_new.notes:=btrim(coalesce(p_data->>'notes',''));
        rel_new.archived:=coalesce((p_data->>'archived')::boolean,false);rel_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial relationship' end else btrim(p_data->>'change_note') end;
      end if;
      rel_new.recorded_by:=uid;rel_new.actor_label:=actor;rel_new.recorded_at:=clock_timestamp();rel_new.id:=gen_random_uuid();
    end if;
    insert into bob.relationship_revisions select rel_new.*;
    update bob.spatial_relationships set latest_revision=next_rev,accepted_revision=case when rel_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',rel_new.state);
  end if;
  raise exception 'Unsupported physical context command';
end $$;

-- 4. Room dimensions per project room. Scoped like project_spaces: another
-- project sees only snapshots on rooms it covers, never bob.measurements.
-- Inlined CTEs let a caller's project/room filter reach project_spaces.
create view bob.project_room_dimensions with (security_invoker=true) as
with rooms as not materialized (
  select s.project_id,s.building_id,s.id as space_id,s.revision as space_revision,s.name as space_name,
    s.level_id,s.archived as room_archived
  from bob.project_spaces s
), snapshots as not materialized (
  select r.project_id,r.space_id,m.id as snapshot_id,m.measurement_id,m.measurement_revision,m.source_project_id,
    m.property,m.side,m.reference,m.subject,m.value,m.unit,m.truth,m.source,
    trim_scale(m.value*case m.unit when 'm' then 1000 when 'cm' then 10 else 1 end) as millimetres,
    case m.truth when 'measured' then 3 when 'provided_spec' then 2 when 'estimated' then 1 else 0 end as strength
  from rooms r join bob.space_measurements m on m.space_id=r.space_id and m.space_revision=r.space_revision
  where m.property is not null
), keys as (
  select distinct project_id,space_id,property,side,reference from snapshots
  union
  select r.project_id,r.space_id,p.property,null::text,null::text
  from rooms r cross join (values ('room_length'),('room_width'),('ceiling_height')) p(property)
), ranked as (
  select k.project_id,k.space_id,k.property,k.side,k.reference,max(s.strength) filter (where s.value is not null) as best
  from keys k left join snapshots s on s.project_id=k.project_id and s.space_id=k.space_id and s.property=k.property
    and s.side is not distinct from k.side and s.reference is not distinct from k.reference
  group by k.project_id,k.space_id,k.property,k.side,k.reference
)
select r.project_id,r.building_id,r.space_id,r.space_revision,r.space_name,r.level_id,r.room_archived,
  g.property,g.side,g.reference,
  case when g.best is null then 'unknown' when count(distinct w.millimetres)>1 then 'conflict' else 'known' end as status,
  (array['estimated','provided_spec','measured'])[g.best] as truth,
  case when g.best is not null and count(distinct w.millimetres)=1 then min(w.millimetres)::text end as millimetres,
  coalesce(jsonb_agg(jsonb_build_object('snapshot_id',w.snapshot_id,'measurement_id',w.measurement_id,
      'measurement_revision',w.measurement_revision,'source_project_id',w.source_project_id,'subject',w.subject,
      'value',w.value::text,'unit',w.unit,'millimetres',w.millimetres::text,'truth',w.truth,'source',w.source)
    order by w.millimetres,w.measurement_id) filter (where w.snapshot_id is not null),'[]'::jsonb) as measurements
from ranked g
join rooms r on r.project_id=g.project_id and r.space_id=g.space_id
left join snapshots w on w.project_id=g.project_id and w.space_id=g.space_id and w.property=g.property
  and w.side is not distinct from g.side and w.reference is not distinct from g.reference
  and ((g.best is null and w.value is null) or (w.value is not null and w.strength=g.best))
group by r.project_id,r.building_id,r.space_id,r.space_revision,r.space_name,r.level_id,r.room_archived,
  g.property,g.side,g.reference,g.best;
revoke all on bob.project_room_dimensions from public,anon,authenticated;
grant select on bob.project_room_dimensions to authenticated;

-- 5. Bob's room_dimensions dataset: one record per project room.
create function bob.search_bob_project_data_v9(
  p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,p_record_id text default null,p_after_id text default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb; n integer; result jsonb;
begin
  if p_dataset is distinct from 'room_dimensions' then
    return bob.search_bob_project_data_v8(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
  end if;
  if auth.uid() is null or not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_status is not null or p_area_id is not null or length(p_query)>200 or length(p_record_id)>200 or length(p_after_id)>200 then
    raise exception 'invalid_lookup' using errcode='22023'; end if;
  with rooms as (
    select d.space_id,d.building_id,d.space_name,d.space_revision,d.room_archived,
      jsonb_agg(jsonb_build_object('property',d.property,'side',d.side,'reference',d.reference,'status',d.status,
          'truth',d.truth,'millimetres',d.millimetres,
          'measurements',(select coalesce(jsonb_agg((x-'source')||jsonb_build_object('source',
              case when char_length(x->>'source')>300 then left(x->>'source',300)||'…' else x->>'source' end) order by i),'[]'::jsonb)
            from jsonb_array_elements(d.measurements) with ordinality e(x,i)))
        order by array_position(array['room_length','room_width','ceiling_height','wall_length','opening_width',
          'opening_height','sill_height','opening_offset','other'],d.property),
          array_position(array['N','E','S','W'],d.side) nulls first,d.reference nulls first) dimensions
    from bob.project_room_dimensions d where d.project_id=p_project_id
    group by d.space_id,d.building_id,d.space_name,d.space_revision,d.room_archived
  ), items as (
    select r.space_id::text id,jsonb_build_object('id',r.space_id,'name',r.space_name,'building_id',r.building_id,
      'building_name',b.name,'revision',r.space_revision,'archived',r.room_archived,'unit','mm','dimensions',r.dimensions) item
    from rooms r left join bob.project_buildings b on b.id=r.building_id and b.project_id=p_project_id
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
revoke all on function bob.search_bob_project_data_v9(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v9(text,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
