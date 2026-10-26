-- Owner-approved classification of the Barnrum measurements (2026-10-26).
--
-- Says once what each listed measurement of project p_barnrum_vaningssang
-- measures. Run by the main session, once, after
-- supabase/migrations/20261026130000_room_dimensions.sql is applied; it is not
-- a migration. It writes only bob.measurements.property/side/reference plus the
-- classification audit (classified_by stays null: an operator script, not a
-- signed-in person) and the mirrored bob.space_measurements columns. No value,
-- revision or room revision changes, so pinned drawings stay current.
--
-- Safety: one transaction. Every subject must match exactly one active
-- measurement, and the three room values must still be 3970, 2700 and
-- 1920 mm; otherwise it aborts and changes nothing. Idempotent: an identical
-- existing classification is kept; a different one aborts (fill-once). The
-- summary at the end lists every classified measurement and its snapshots.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $barnrum$
declare
  project constant text := 'p_barnrum_vaningssang';
  actor constant text := 'Owner-approved classification 2026-10-26';
  plan constant jsonb := $plan$[
    {"subject": "Rummets exakta längd", "millimetres": "3970", "property": "room_length", "side": null, "reference": null},
    {"subject": "Rummets exakta bredd", "millimetres": "2700", "property": "room_width", "side": null, "reference": null},
    {"subject": "Takhöjd vid sängens placering", "millimetres": "1920", "property": "ceiling_height", "side": null, "reference": null},
    {"subject": "N-sida: fönster karm-till-karm", "millimetres": null, "property": "opening_width", "side": "N", "reference": null},
    {"subject": "Ö-sida: fönster karm-till-karm", "millimetres": null, "property": "opening_width", "side": "E", "reference": null},
    {"subject": "S-sida: dörrfoder-till-dörrfoder", "millimetres": null, "property": "opening_width", "side": "S", "reference": "foder till foder"},
    {"subject": "V-sida: dörrfoder-till-dörrfoder", "millimetres": null, "property": "opening_width", "side": "W", "reference": "foder till foder"},
    {"subject": "N-sida: N/Ö-hörn till fönsterkarm", "millimetres": null, "property": "opening_offset", "side": "N", "reference": "N/Ö-hörn"},
    {"subject": "Ö-sida: N/Ö-hörn till fönsterkarm", "millimetres": null, "property": "opening_offset", "side": "E", "reference": "N/Ö-hörn"},
    {"subject": "S-sida: S/V-murstockshörn till dörrfoder", "millimetres": null, "property": "opening_offset", "side": "S", "reference": "S/V-murstockshörn"},
    {"subject": "V-sida: N/V-hörn till dörrfoder", "millimetres": null, "property": "opening_offset", "side": "W", "reference": "N/V-hörn"},
    {"subject": "V-sida: dörrfoder till murstockshörn", "millimetres": null, "property": "opening_offset", "side": "W", "reference": "murstockshörn"}
  ]$plan$::jsonb;
  item jsonb; matches integer; target uuid; prior record; mm numeric;
  classified integer := 0; kept integer := 0; mirrored integer := 0; changed integer;
begin
  if not exists(select 1 from information_schema.columns where table_schema='bob' and table_name='measurements' and column_name='property') then
    raise exception 'room_dimensions_migration_missing: apply 20261026130000_room_dimensions.sql first';
  end if;
  if not exists(select 1 from bob.projects where id=project) then raise exception 'barnrum_project_missing: %', project; end if;
  -- Check every subject and value before writing anything.
  for item in select value from jsonb_array_elements(plan) loop
    select count(*) into matches from bob.measurements h
      join bob.measurement_revisions r on r.measurement_id=h.id and r.project_id=h.project_id and r.revision=h.current_revision
      where h.project_id=project and not r.archived and r.subject=item->>'subject';
    if matches<>1 then raise exception 'barnrum_subject_mismatch: "%" has % active matches', item->>'subject', matches; end if;
  end loop;
  for item in select value from jsonb_array_elements(plan) loop
    select h.id,h.property,h.side,h.reference,r.value,r.unit into prior from bob.measurements h
      join bob.measurement_revisions r on r.measurement_id=h.id and r.project_id=h.project_id and r.revision=h.current_revision
      where h.project_id=project and not r.archived and r.subject=item->>'subject' for update of h;
    target := prior.id;
    mm := prior.value*case prior.unit when 'm' then 1000 when 'cm' then 10 else 1 end;
    if item->>'millimetres' is not null and mm is distinct from (item->>'millimetres')::numeric then
      raise exception 'barnrum_value_mismatch: "%" is % mm, expected % mm', item->>'subject', trim_scale(mm), item->>'millimetres';
    end if;
    if prior.property is null then
      update bob.measurements set property=item->>'property', side=item->>'side', reference=item->>'reference',
        classified_by=null, classified_actor=actor, classified_at=clock_timestamp()
      where id=target;
      classified := classified+1;
    elsif (prior.property,prior.side,prior.reference) is not distinct from (item->>'property',item->>'side',item->>'reference') then
      kept := kept+1;
    else
      raise exception 'barnrum_classified_differently: "%" already measures % % %', item->>'subject', prior.property, prior.side, prior.reference;
    end if;
    -- The sync trigger mirrors the identity onto its room snapshots; repeat it
    -- explicitly so the script holds on its own and reports the count.
    update bob.space_measurements set property=item->>'property', side=item->>'side', reference=item->>'reference'
      where measurement_id=target and (property,side,reference) is distinct from (item->>'property',item->>'side',item->>'reference');
    get diagnostics changed = row_count;
    mirrored := mirrored+changed;
  end loop;
  select count(*) into matches from bob.space_measurements s join bob.measurements h on h.id=s.measurement_id
    where h.project_id=project and h.property is not null and (s.property,s.side,s.reference) is distinct from (h.property,h.side,h.reference);
  if matches>0 then raise exception 'barnrum_mirror_mismatch: % snapshots differ from their measurement', matches; end if;
  raise notice 'Barnrum classification: % classified now, % already classified, % room snapshots updated by this script (the trigger may already have updated the rest).',
    classified, kept, mirrored;
end $barnrum$;
commit;

-- Summary (read-only).
select r.subject, h.property, h.side, h.reference, r.value::text as value, r.unit, r.truth, r.revision,
  h.classified_actor, h.classified_at,
  (select count(*) from bob.space_measurements s where s.measurement_id=h.id) as snapshots,
  (select count(*) from bob.space_measurements s where s.measurement_id=h.id
    and (s.property,s.side,s.reference) is not distinct from (h.property,h.side,h.reference)) as mirrored_snapshots
from bob.measurements h
join bob.measurement_revisions r on r.measurement_id=h.id and r.project_id=h.project_id and r.revision=h.current_revision
where h.project_id='p_barnrum_vaningssang' and h.property is not null
order by array_position(array['room_length','room_width','ceiling_height','wall_length','opening_width','opening_height','sill_height','opening_offset','other'],h.property),
  array_position(array['N','E','S','W'],h.side) nulls first, h.reference nulls first;
