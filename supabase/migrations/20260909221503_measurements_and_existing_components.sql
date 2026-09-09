-- Manual foundations 2A/2B. Contract: Docs/project-facts.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.existing_components (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  area_id text references bob.areas(id) on delete set null,
  current_revision integer not null default 1 check (current_revision > 0),
  unique(id, project_id)
);
create index existing_components_project_idx on bob.existing_components(project_id);
create index existing_components_area_idx on bob.existing_components(area_id);

create table bob.component_revisions (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null,
  project_id text not null,
  revision integer not null check (revision > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind text not null default '' check (char_length(kind) <= 80),
  quantity integer check (quantity between 1 and 100000),
  condition text not null default '' check (char_length(condition) <= 2000),
  specification text not null default '' check (char_length(specification) <= 4000),
  intent text not null default 'inspect' check (intent in ('inspect','reuse','remove','replace')),
  notes text not null default '' check (char_length(notes) <= 4000),
  source_media_id uuid references bob.media_assets(id) on delete set null,
  source_media_title text not null default '',
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(component_id, project_id) references bob.existing_components(id, project_id) on delete cascade,
  unique(component_id, revision)
);
create index component_revisions_parent_idx on bob.component_revisions(component_id, project_id);
create index component_revisions_project_idx on bob.component_revisions(project_id);
create index component_revisions_source_idx on bob.component_revisions(source_media_id);
alter table bob.existing_components add constraint component_current_revision_fk
  foreign key(id, current_revision) references bob.component_revisions(component_id, revision)
  deferrable initially deferred;
create index existing_components_current_idx on bob.existing_components(id, current_revision);

create table bob.measurements (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  area_id text references bob.areas(id) on delete set null,
  component_id uuid,
  current_revision integer not null default 1 check (current_revision > 0),
  foreign key(component_id, project_id) references bob.existing_components(id, project_id)
    deferrable initially deferred,
  unique(id, project_id)
);
create index measurements_project_idx on bob.measurements(project_id);
create index measurements_area_idx on bob.measurements(area_id);
create index measurements_component_idx on bob.measurements(component_id, project_id);

create table bob.measurement_revisions (
  id uuid primary key default gen_random_uuid(),
  measurement_id uuid not null,
  project_id text not null,
  revision integer not null check (revision > 0),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  value numeric check (value >= 0 and value <= 1000000 and value = trunc(value, 3)),
  unit text not null check (unit in ('mm','cm','m')),
  truth text not null check (truth in ('measured','provided_spec','estimated','unknown')),
  source text not null default '' check (char_length(source) <= 2000),
  notes text not null default '' check (char_length(notes) <= 4000),
  required boolean not null default false,
  source_media_id uuid references bob.media_assets(id) on delete set null,
  source_media_title text not null default '',
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check ((truth = 'unknown' and value is null) or
    (truth <> 'unknown' and value is not null and char_length(btrim(source)) > 0)),
  foreign key(measurement_id, project_id) references bob.measurements(id, project_id) on delete cascade,
  unique(measurement_id, revision)
);
create index measurement_revisions_parent_idx on bob.measurement_revisions(measurement_id, project_id);
create index measurement_revisions_project_idx on bob.measurement_revisions(project_id);
create index measurement_revisions_source_idx on bob.measurement_revisions(source_media_id);
alter table bob.measurements add constraint measurement_current_revision_fk
  foreign key(id, current_revision) references bob.measurement_revisions(measurement_id, revision)
  deferrable initially deferred;
create index measurements_current_idx on bob.measurements(id, current_revision);

alter table bob.existing_components enable row level security;
alter table bob.component_revisions enable row level security;
alter table bob.measurements enable row level security;
alter table bob.measurement_revisions enable row level security;
revoke all on bob.existing_components, bob.component_revisions, bob.measurements, bob.measurement_revisions
  from public, anon, authenticated;
grant select on bob.existing_components, bob.component_revisions, bob.measurements, bob.measurement_revisions to authenticated;
create policy project_read on bob.existing_components for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.component_revisions for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.measurements for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.measurement_revisions for select to authenticated
  using (bob_private.has_project_access(project_id));

create view bob.current_components with (security_invoker = true) as
select h.id, h.project_id, h.area_id, r.revision, r.name, r.kind, r.quantity,
  r.condition, r.specification, r.intent, r.notes, r.source_media_id, r.source_media_title,
  r.archived, r.change_note, r.recorded_by, r.actor_label, r.recorded_at
from bob.existing_components h join bob.component_revisions r
  on r.component_id=h.id and r.project_id=h.project_id and r.revision=h.current_revision;

create view bob.current_measurements with (security_invoker = true) as
select h.id, h.project_id, h.area_id, h.component_id, r.revision, r.subject,
  r.value::text as value, r.unit,
  (r.value * case r.unit when 'm' then 1000 when 'cm' then 10 else 1 end)::text as millimetres,
  r.truth, r.source, r.notes, r.required, r.source_media_id, r.source_media_title,
  r.archived, r.change_note, r.recorded_by, r.actor_label, r.recorded_at
from bob.measurements h join bob.measurement_revisions r
  on r.measurement_id=h.id and r.project_id=h.project_id and r.revision=h.current_revision;
revoke all on bob.current_components, bob.current_measurements from public, anon, authenticated;
grant select on bob.current_components, bob.current_measurements to authenticated;

create function bob_private.evidence_command(
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
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_record is null or p_kind is null or p_kind not in ('measurement','component')
    or p_action is null or p_action not in ('create','revise','archive','restore')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000 then
    raise exception 'Invalid project fact command';
  end if;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  allowed := case when p_kind='measurement'
    then array['subject','value','unit','truth','source','notes','required','source_media_id','change_note']
    else array['name','kind','quantity','condition','specification','intent','notes','source_media_id','change_note'] end;
  if p_action='create' then allowed := allowed || array['area_id','component_id']; end if;
  if p_action in ('archive','restore') then allowed := array[]::text[]; end if;
  if p_data - allowed <> '{}'::jsonb or (p_kind='component' and p_data ? 'component_id') then
    raise exception 'Unsupported fields. Identity, parents and recorded history cannot be rewritten.';
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
      insert into bob.measurements(id,project_id,area_id,component_id) values(p_record,p_project,area,component);
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
      if p_action='revise' and mr.archived then raise exception 'Restore this record before editing.'; end if;
      if (p_action='archive' and mr.archived) or (p_action='restore' and not mr.archived) then
        raise exception 'Record changed. Reload before saving again.';
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
revoke all on function bob_private.evidence_command(text,text,text,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function bob_private.evidence_command(text,text,text,uuid,integer,jsonb) to authenticated;

create function bob.evidence_command(
  p_project text, p_kind text, p_action text, p_record uuid, p_expected integer, p_data jsonb default '{}'::jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select bob_private.evidence_command(p_project,p_kind,p_action,p_record,p_expected,p_data)
$$;
revoke all on function bob.evidence_command(text,text,text,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function bob.evidence_command(text,text,text,uuid,integer,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
