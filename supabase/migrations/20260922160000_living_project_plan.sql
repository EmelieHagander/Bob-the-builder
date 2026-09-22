-- Living project plan foundation.
-- Generic plan -> Step -> Completion Requirement -> Evidence model.
-- No hard-coded construction phase sequence. Existing Tasks/readiness remain intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.project_plans (
  project_id text primary key references bob.projects(id) on delete cascade,
  current_revision integer,
  next_revision integer not null default 1 check(next_revision>0),
  updated_at timestamptz not null default clock_timestamp()
);

create table bob.project_plan_revisions (
  project_id text not null references bob.project_plans(project_id) on delete cascade,
  revision integer not null check(revision>0),
  status text not null check(status in ('proposed','approved','rejected','superseded')),
  based_on_revision integer,
  summary text not null check(char_length(summary) between 1 and 4000),
  reason text not null check(char_length(reason) between 1 and 4000),
  proposed_by uuid not null,
  approved_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  primary key(project_id,revision),
  check((status='proposed' and decided_at is null and approved_by is null)
     or (status in ('approved','superseded') and decided_at is not null and approved_by is not null)
     or (status='rejected' and decided_at is not null))
);
alter table bob.project_plans
  add constraint project_plans_current_fk foreign key(project_id,current_revision)
  references bob.project_plan_revisions(project_id,revision)
  deferrable initially deferred;

create table bob.project_plan_steps (
  project_id text not null,
  plan_revision integer not null,
  step_id uuid not null,
  position integer not null check(position between 1 and 1000),
  title text not null check(char_length(title) between 1 and 240),
  goal text not null check(char_length(goal) between 1 and 4000),
  state text not null check(state in ('planned','active','blocked','completed')),
  area_id text references bob.areas(id),
  responsible_kind text not null check(responsible_kind in ('bob','person','unassigned')),
  responsible_person_id text references bob.people(id),
  notes text not null default '' check(char_length(notes)<=4000),
  primary key(project_id,plan_revision,step_id),
  unique(project_id,plan_revision,position),
  foreign key(project_id,plan_revision) references bob.project_plan_revisions(project_id,revision) on delete cascade,
  check((responsible_kind='person' and responsible_person_id is not null)
     or (responsible_kind<>'person' and responsible_person_id is null))
);
create unique index project_plan_one_active_idx on bob.project_plan_steps(project_id,plan_revision)
  where state='active';

create table bob.project_plan_requirements (
  project_id text not null,
  plan_revision integer not null,
  requirement_id uuid not null,
  step_id uuid not null,
  position integer not null check(position between 1 and 1000),
  requirement_type text not null check(requirement_type in
    ('measurement','photo','decision','drawing','material_requirement','material_delivery','task','approval','check','other')),
  title text not null check(char_length(title) between 1 and 240),
  description text not null default '' check(char_length(description)<=2000),
  resolution text not null default 'open' check(resolution in ('open','waived','not_applicable')),
  responsible_kind text not null check(responsible_kind in ('bob','person','unassigned')),
  responsible_person_id text references bob.people(id),
  evidence_selector jsonb not null default '{"kind":"none","id":null,"subject":null,"area_id":null}'::jsonb,
  primary key(project_id,plan_revision,requirement_id),
  unique(project_id,plan_revision,step_id,position),
  foreign key(project_id,plan_revision,step_id)
    references bob.project_plan_steps(project_id,plan_revision,step_id) on delete cascade,
  check((responsible_kind='person' and responsible_person_id is not null)
     or (responsible_kind<>'person' and responsible_person_id is null)),
  check(jsonb_typeof(evidence_selector)='object' and octet_length(evidence_selector::text)<=2000)
);

create table bob.project_plan_evidence (
  project_id text not null,
  plan_revision integer not null,
  requirement_id uuid not null,
  evidence_kind text not null check(evidence_kind in ('measurement','media','artifact','material_requirement','solution','task')),
  evidence_id text not null check(char_length(evidence_id) between 1 and 200),
  evidence_revision integer,
  relation text not null check(relation in ('resolves','conflicts','refines','supersedes')),
  linked_by uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  primary key(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,relation),
  foreign key(project_id,plan_revision,requirement_id)
    references bob.project_plan_requirements(project_id,plan_revision,requirement_id) on delete cascade,
  check((evidence_kind in ('measurement','artifact','material_requirement','solution') and evidence_revision is not null and evidence_revision>0)
     or (evidence_kind in ('media','task') and evidence_revision is null))
);

create index project_plan_revision_status_idx on bob.project_plan_revisions(project_id,status,revision desc);
create index project_plan_steps_state_idx on bob.project_plan_steps(project_id,plan_revision,state,position);
create index project_plan_requirements_step_idx on bob.project_plan_requirements(project_id,plan_revision,step_id,position);
create index project_plan_evidence_requirement_idx on bob.project_plan_evidence(project_id,plan_revision,requirement_id);

alter table bob.project_plans enable row level security;
alter table bob.project_plan_revisions enable row level security;
alter table bob.project_plan_steps enable row level security;
alter table bob.project_plan_requirements enable row level security;
alter table bob.project_plan_evidence enable row level security;

revoke all on bob.project_plans,bob.project_plan_revisions,bob.project_plan_steps,bob.project_plan_requirements,bob.project_plan_evidence
  from public,anon,authenticated;
grant select on bob.project_plans,bob.project_plan_revisions,bob.project_plan_steps,bob.project_plan_requirements,bob.project_plan_evidence
  to authenticated;
grant all on bob.project_plans,bob.project_plan_revisions,bob.project_plan_steps,bob.project_plan_requirements,bob.project_plan_evidence
  to service_role;

create policy project_read on bob.project_plans for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_plan_revisions for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_plan_steps for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_plan_requirements for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_plan_evidence for select to authenticated
  using(bob_private.has_project_access(project_id));

create function bob_private.plan_selector_valid(p_selector jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
  select jsonb_typeof(p_selector)='object'
    and p_selector-array['kind','id','subject','area_id']::text[]='{}'
    and (select count(*) from jsonb_object_keys(p_selector))=4
    and p_selector->>'kind'=any(array['none','measurement','media','artifact','material_requirement','solution','task'])
    and (p_selector->'id'='null'::jsonb or (jsonb_typeof(p_selector->'id')='string' and char_length(p_selector->>'id') between 1 and 200))
    and (p_selector->'subject'='null'::jsonb or (jsonb_typeof(p_selector->'subject')='string' and char_length(p_selector->>'subject') between 1 and 200))
    and (p_selector->'area_id'='null'::jsonb or (jsonb_typeof(p_selector->'area_id')='string' and char_length(p_selector->>'area_id') between 1 and 200))
    and case p_selector->>'kind'
      when 'none' then p_selector->'id'='null'::jsonb and p_selector->'subject'='null'::jsonb and p_selector->'area_id'='null'::jsonb
      when 'measurement' then
        ((p_selector->'id'<>'null'::jsonb and (p_selector->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and p_selector->'subject'='null'::jsonb)
         or (p_selector->'id'='null'::jsonb and p_selector->'subject'<>'null'::jsonb))
      else p_selector->'id'<>'null'::jsonb and p_selector->'subject'='null'::jsonb and p_selector->'area_id'='null'::jsonb
    end
$$;

create function bob_private.plan_evidence_current(p_project text,p_kind text,p_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  case p_kind
    when 'measurement' then
      select jsonb_build_object('exists',true,'revision',m.revision,'label',m.subject,'updated_at',m.recorded_at,
        'value',m.value,'unit',m.unit,'truth',m.truth,'actor',m.actor_label)
      into r from bob.current_measurements m
      where m.project_id=p_project and m.id::text=p_id and not m.archived;
    when 'artifact' then
      select jsonb_build_object('exists',true,'revision',a.revision,'label',a.title,'updated_at',a.recorded_at)
      into r from bob.current_artifacts a
      where a.project_id=p_project and a.id::text=p_id and not a.archived;
    when 'material_requirement' then
      select jsonb_build_object('exists',true,'revision',m.revision,'label',m.name,'updated_at',m.recorded_at)
      into r from bob.current_material_requirements m
      where m.project_id=p_project and m.id::text=p_id and not m.archived;
    when 'solution' then
      select jsonb_build_object('exists',true,'revision',s.revision,'label',s.title,'updated_at',s.recorded_at)
      into r from bob.current_solutions s
      where s.project_id=p_project and s.id::text=p_id and not s.archived;
    when 'media' then
      select jsonb_build_object('exists',true,'revision',null,'label',m.title,'updated_at',m.updated_at)
      into r from bob.media_assets m where m.project_id=p_project and m.id::text=p_id and m.state='ready';
    when 'task' then
      select jsonb_build_object('exists',true,'revision',null,'label',t.name,'updated_at',t.updated_at)
      into r from bob.tasks t join bob.areas a on a.id=t.area_id
      where a.project_id=p_project and t.id=p_id;
    else
      raise exception 'plan_invalid_evidence_kind' using errcode='22023';
  end case;
  return coalesce(r,jsonb_build_object('exists',false,'revision',null,'label',null,'updated_at',null));
end $$;

create function bob_private.plan_requirement_state(p_project text,p_revision integer,p_requirement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare req bob.project_plan_requirements; selector jsonb; row record; cur jsonb;
  linked jsonb:='[]'::jsonb; selector_evidence jsonb:='[]'::jsonb;
  has_conflict boolean:=false; has_fresh boolean:=false; has_stale boolean:=false;
  matches integer:=0; state text:='missing';
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  select * into req from bob.project_plan_requirements
    where project_id=p_project and plan_revision=p_revision and requirement_id=p_requirement;
  if not found then raise exception 'plan_requirement_not_found' using errcode='22023'; end if;
  if req.resolution<>'open' then
    return jsonb_build_object('state',req.resolution,'evidence','[]'::jsonb,'source','override');
  end if;

  for row in select * from bob.project_plan_evidence
    where project_id=p_project and plan_revision=p_revision and requirement_id=p_requirement
    order by linked_at,evidence_kind,evidence_id loop
    cur:=bob_private.plan_evidence_current(p_project,row.evidence_kind,row.evidence_id);
    linked:=linked||jsonb_build_array(jsonb_build_object(
      'kind',row.evidence_kind,'id',row.evidence_id,'pinned_revision',row.evidence_revision,
      'relation',row.relation,'current',cur));
    if row.relation='conflicts' then has_conflict:=true;
    elsif row.relation in ('resolves','refines','supersedes') then
      if not (cur->>'exists')::boolean then has_stale:=true;
      elsif row.evidence_revision is not null and (cur->>'revision')::integer is distinct from row.evidence_revision then has_stale:=true;
      else has_fresh:=true;
      end if;
    end if;
  end loop;

  selector:=req.evidence_selector;
  if selector->>'kind'='measurement' then
    if selector->'id'<>'null'::jsonb then
      select count(*) into matches from bob.current_measurements m
        where m.project_id=p_project and m.id::text=selector->>'id' and not m.archived;
      if matches=1 then
        select jsonb_build_array(jsonb_build_object('kind','measurement','id',m.id::text,'revision',m.revision,'label',m.subject,
          'value',m.value,'unit',m.unit,'truth',m.truth,'actor',m.actor_label,'updated_at',m.recorded_at))
        into selector_evidence from bob.current_measurements m
        where m.project_id=p_project and m.id::text=selector->>'id' and not m.archived;
        select (m.truth<>'unknown' and m.value is not null) into has_fresh
          from bob.current_measurements m where m.project_id=p_project and m.id::text=selector->>'id' and not m.archived;
      end if;
    else
      select count(*) into matches from bob.current_measurements m
        where m.project_id=p_project and not m.archived and m.subject=selector->>'subject'
          and (selector->'area_id'='null'::jsonb or m.area_id=selector->>'area_id');
      if matches>1 then has_conflict:=true;
      elsif matches=1 then
        select jsonb_build_array(jsonb_build_object('kind','measurement','id',m.id::text,'revision',m.revision,'label',m.subject,
          'value',m.value,'unit',m.unit,'truth',m.truth,'actor',m.actor_label,'updated_at',m.recorded_at)),
          (m.truth<>'unknown' and m.value is not null)
        into selector_evidence,has_fresh
        from bob.current_measurements m
        where m.project_id=p_project and not m.archived and m.subject=selector->>'subject'
          and (selector->'area_id'='null'::jsonb or m.area_id=selector->>'area_id');
      end if;
    end if;
  elsif selector->>'kind'<>'none' then
    cur:=bob_private.plan_evidence_current(p_project,selector->>'kind',selector->>'id');
    selector_evidence:=jsonb_build_array(jsonb_build_object('kind',selector->>'kind','id',selector->>'id','current',cur));
    if (cur->>'exists')::boolean then has_fresh:=true; end if;
  end if;

  if has_conflict then state:='conflicted';
  elsif has_fresh then state:='satisfied';
  elsif has_stale then state:='stale';
  else state:='missing';
  end if;
  return jsonb_build_object('state',state,'evidence',selector_evidence||linked,
    'source',case when jsonb_array_length(selector_evidence)>0 then 'selector' when jsonb_array_length(linked)>0 then 'linked' else 'none' end);
end $$;

create function bob.project_plan_read(p_project text,p_revision integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rev integer; meta bob.project_plan_revisions; steps jsonb; result jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_revision is null then select current_revision into rev from bob.project_plans where project_id=p_project;
  else rev:=p_revision; end if;
  if rev is null then return jsonb_build_object('status','not_initialized','projectId',p_project,'record',null); end if;
  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  if not found then return jsonb_build_object('status','not_found','projectId',p_project,'record',null); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.step_id,'position',s.position,'title',s.title,'goal',s.goal,'state',s.state,'area_id',s.area_id,
    'responsible_kind',s.responsible_kind,'responsible_person_id',s.responsible_person_id,'notes',s.notes,
    'requirements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.requirement_id,'position',q.position,'type',q.requirement_type,'title',q.title,'description',q.description,
        'resolution',q.resolution,'responsible_kind',q.responsible_kind,'responsible_person_id',q.responsible_person_id,
        'evidence_selector',q.evidence_selector,'status',bob_private.plan_requirement_state(p_project,rev,q.requirement_id)
      ) order by q.position,q.requirement_id)
      from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=s.step_id
    ),'[]'::jsonb)
  ) order by s.position,s.step_id),'[]'::jsonb) into steps
  from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=rev;

  result:=jsonb_build_object('id',p_project,'name','Living project plan v'||rev,'project_id',p_project,
    'revision',rev,'status',meta.status,'based_on_revision',meta.based_on_revision,'summary',meta.summary,'reason',meta.reason,
    'proposed_by',meta.proposed_by,'approved_by',meta.approved_by,'created_at',meta.created_at,'updated_at',coalesce(meta.decided_at,meta.created_at),
    'steps',steps);
  return jsonb_build_object('status','ok','projectId',p_project,'record',result);
end $$;

create function bob.project_plan_briefing(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rev integer; meta bob.project_plan_revisions; active bob.project_plan_steps; reqs jsonb:='[]'::jsonb;
  counts jsonb; next_steps jsonb; recent jsonb; new_count integer:=0;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select current_revision into rev from bob.project_plans where project_id=p_project;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,'truth',m.truth,
    'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at) order by m.recorded_at desc,m.id),'[]'::jsonb)
    into recent from (select * from bob.current_measurements where project_id=p_project and not archived order by recorded_at desc limit 8) m;
  if rev is null then
    return jsonb_build_object('status','not_initialized','plan_needed',true,'current_revision',null,
      'current_step',null,'completion',null,'recent_shared_facts',recent,
      'note','No approved living plan exists yet. Recent shared facts are current project data, regardless of which collaborator recorded them.');
  end if;
  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  select * into active from bob.project_plan_steps where project_id=p_project and plan_revision=rev and state='active' order by position limit 1;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('id',q.requirement_id,'type',q.requirement_type,'title',q.title,
      'responsible_kind',q.responsible_kind,'responsible_person_id',q.responsible_person_id,
      'status',bob_private.plan_requirement_state(p_project,rev,q.requirement_id)) order by q.position),'[]'::jsonb)
      into reqs from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=active.step_id;
    select jsonb_build_object(
      'total',count(*),
      'satisfied',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='satisfied'),
      'missing',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='missing'),
      'conflicted',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='conflicted'),
      'stale',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='stale'),
      'waived',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state') in ('waived','not_applicable'))
    ) into counts from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=active.step_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.step_id,'position',s.position,'title',s.title,'goal',s.goal,'state',s.state)
    order by s.position),'[]'::jsonb) into next_steps
    from (select * from bob.project_plan_steps where project_id=p_project and plan_revision=rev
      and state in ('planned','blocked') and (active.step_id is null or position>active.position) order by position limit 3) s;
  select count(*) into new_count from bob.current_measurements m
    where m.project_id=p_project and not m.archived and m.recorded_at>meta.created_at;
  return jsonb_build_object('status','ok','plan_needed',false,'current_revision',rev,'summary',meta.summary,'reason',meta.reason,
    'current_step',case when active.step_id is null then null else jsonb_build_object('id',active.step_id,'position',active.position,'title',active.title,
      'goal',active.goal,'state',active.state,'area_id',active.area_id,'responsible_kind',active.responsible_kind,
      'responsible_person_id',active.responsible_person_id,'requirements',reqs) end,
    'completion',counts,'next_steps',next_steps,'recent_shared_facts',recent,
    'new_shared_facts_since_plan',new_count,'plan_review_hint',new_count>0,
    'note','Requirement status is shared project state. Use exact tools when details are needed; do not assume every recent fact affects this Step.');
end $$;

create function bob_private.project_plan_propose(p_project text,p_expected integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h bob.project_plans; new_rev integer; current_rev integer; step jsonb; req jsonb; sid uuid; qid uuid;
  step_pos integer:=0; req_pos integer; completed_count integer:=0; active_count integer:=0; selector jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data)<>'object' or p_data-array['summary','reason','steps']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_data))<>3
    or jsonb_typeof(p_data->'summary')<>'string' or char_length(btrim(p_data->>'summary')) not between 1 and 4000
    or jsonb_typeof(p_data->'reason')<>'string' or char_length(btrim(p_data->>'reason')) not between 1 and 4000
    or jsonb_typeof(p_data->'steps')<>'array' or jsonb_array_length(p_data->'steps') not between 1 and 30
    or octet_length(p_data::text)>80000 then raise exception 'plan_invalid_proposal' using errcode='22023'; end if;

  insert into bob.project_plans(project_id) values(p_project) on conflict do nothing;
  select * into h from bob.project_plans where project_id=p_project for update;
  current_rev:=h.current_revision;
  if coalesce(current_rev,0) is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  if exists(select 1 from bob.project_plan_revisions where project_id=p_project and status='proposed') then
    raise exception 'plan_proposal_pending' using errcode='40001'; end if;
  new_rev:=h.next_revision;
  update bob.project_plans set next_revision=next_revision+1,updated_at=clock_timestamp() where project_id=p_project;
  insert into bob.project_plan_revisions(project_id,revision,status,based_on_revision,summary,reason,proposed_by)
    values(p_project,new_rev,'proposed',current_rev,btrim(p_data->>'summary'),btrim(p_data->>'reason'),auth.uid());

  if current_rev is not null then
    insert into bob.project_plan_steps(project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes)
      select project_id,new_rev,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes
      from bob.project_plan_steps where project_id=p_project and plan_revision=current_rev and state='completed' order by position;
    get diagnostics completed_count=row_count;
    insert into bob.project_plan_requirements(project_id,plan_revision,requirement_id,step_id,position,requirement_type,title,description,resolution,responsible_kind,responsible_person_id,evidence_selector)
      select project_id,new_rev,requirement_id,step_id,position,requirement_type,title,description,resolution,responsible_kind,responsible_person_id,evidence_selector
      from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=current_rev
        and exists(select 1 from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=current_rev and s.step_id=q.step_id and s.state='completed');
    insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at)
      select project_id,new_rev,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at
      from bob.project_plan_evidence e where e.project_id=p_project and e.plan_revision=current_rev
        and exists(select 1 from bob.project_plan_requirements q join bob.project_plan_steps s
          on s.project_id=q.project_id and s.plan_revision=q.plan_revision and s.step_id=q.step_id
          where q.project_id=p_project and q.plan_revision=current_rev and q.requirement_id=e.requirement_id and s.state='completed');
  end if;
  step_pos:=completed_count;

  for step in select value from jsonb_array_elements(p_data->'steps') loop
    if jsonb_typeof(step)<>'object' or step-array['step_id','title','goal','state','area_id','responsible_kind','responsible_person_id','notes','requirements']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(step))<>9
      or jsonb_typeof(step->'title')<>'string' or char_length(btrim(step->>'title')) not between 1 and 240
      or jsonb_typeof(step->'goal')<>'string' or char_length(btrim(step->>'goal')) not between 1 and 4000
      or coalesce(step->>'state','')<>all(array['planned','active','blocked','completed'])
      or not(step->'area_id'='null'::jsonb or (jsonb_typeof(step->'area_id')='string' and char_length(step->>'area_id') between 1 and 200))
      or coalesce(step->>'responsible_kind','')<>all(array['bob','person','unassigned'])
      or not(step->'responsible_person_id'='null'::jsonb or jsonb_typeof(step->'responsible_person_id')='string')
      or jsonb_typeof(step->'notes')<>'string' or char_length(step->>'notes')>4000
      or jsonb_typeof(step->'requirements')<>'array' or jsonb_array_length(step->'requirements')>20 then
      raise exception 'plan_invalid_step' using errcode='22023'; end if;
    if (step->>'responsible_kind'='person') is distinct from (step->'responsible_person_id'<>'null'::jsonb) then
      raise exception 'plan_invalid_responsibility' using errcode='22023'; end if;
    if step->'area_id'<>'null'::jsonb and not exists(select 1 from bob.areas where id=step->>'area_id' and project_id=p_project) then
      raise exception 'project_denied' using errcode='42501'; end if;
    if step->>'responsible_kind'='person' and not exists(select 1 from bob.people where id=step->>'responsible_person_id' and project_id=p_project) then
      raise exception 'project_denied' using errcode='42501'; end if;

    if step->'step_id'='null'::jsonb then sid:=gen_random_uuid();
    else
      sid:=(step->>'step_id')::uuid;
      if current_rev is null or not exists(select 1 from bob.project_plan_steps
        where project_id=p_project and plan_revision=current_rev and step_id=sid and state<>'completed') then
        raise exception 'plan_unknown_step_id' using errcode='22023'; end if;
    end if;
    if exists(select 1 from bob.project_plan_steps where project_id=p_project and plan_revision=new_rev and step_id=sid) then
      raise exception 'plan_duplicate_step' using errcode='22023'; end if;
    step_pos:=step_pos+1;
    if step->>'state'='active' then active_count:=active_count+1; if active_count>1 then raise exception 'plan_multiple_active_steps' using errcode='22023'; end if; end if;
    insert into bob.project_plan_steps values(p_project,new_rev,sid,step_pos,btrim(step->>'title'),btrim(step->>'goal'),step->>'state',
      nullif(step->>'area_id',''),step->>'responsible_kind',nullif(step->>'responsible_person_id',''),step->>'notes');

    req_pos:=0;
    for req in select value from jsonb_array_elements(step->'requirements') loop
      if jsonb_typeof(req)<>'object'
        or req-array['requirement_id','type','title','description','resolution','responsible_kind','responsible_person_id','evidence_selector']::text[]<>'{}'
        or (select count(*) from jsonb_object_keys(req))<>8
        or coalesce(req->>'type','')<>all(array['measurement','photo','decision','drawing','material_requirement','material_delivery','task','approval','check','other'])
        or jsonb_typeof(req->'title')<>'string' or char_length(btrim(req->>'title')) not between 1 and 240
        or jsonb_typeof(req->'description')<>'string' or char_length(req->>'description')>2000
        or coalesce(req->>'resolution','')<>all(array['open','waived','not_applicable'])
        or coalesce(req->>'responsible_kind','')<>all(array['bob','person','unassigned'])
        or not bob_private.plan_selector_valid(req->'evidence_selector') then
        raise exception 'plan_invalid_requirement' using errcode='22023'; end if;
      if (req->>'responsible_kind'='person') is distinct from (req->'responsible_person_id'<>'null'::jsonb) then
        raise exception 'plan_invalid_responsibility' using errcode='22023'; end if;
      if req->>'responsible_kind'='person' and not exists(select 1 from bob.people where id=req->>'responsible_person_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501'; end if;
      selector:=req->'evidence_selector';
      if selector->>'kind'='measurement' and selector->'area_id'<>'null'::jsonb
        and not exists(select 1 from bob.areas where id=selector->>'area_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501'; end if;

      if req->'requirement_id'='null'::jsonb then qid:=gen_random_uuid();
      else
        qid:=(req->>'requirement_id')::uuid;
        if current_rev is null or step->'step_id'='null'::jsonb or not exists(select 1 from bob.project_plan_requirements
          where project_id=p_project and plan_revision=current_rev and requirement_id=qid and step_id=sid) then
          raise exception 'plan_unknown_requirement_id' using errcode='22023'; end if;
      end if;
      if exists(select 1 from bob.project_plan_requirements where project_id=p_project and plan_revision=new_rev and requirement_id=qid) then
        raise exception 'plan_duplicate_requirement' using errcode='22023'; end if;
      req_pos:=req_pos+1;
      insert into bob.project_plan_requirements values(p_project,new_rev,qid,sid,req_pos,req->>'type',btrim(req->>'title'),req->>'description',
        req->>'resolution',req->>'responsible_kind',nullif(req->>'responsible_person_id',''),selector);
    end loop;
  end loop;
  return bob.project_plan_read(p_project,new_rev);
end $$;

create function bob_private.project_plan_decide(p_project text,p_expected integer,p_proposal integer,p_action text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h bob.project_plans; r bob.project_plan_revisions;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action<>all(array['approve','reject']) or p_proposal<1 or char_length(coalesce(p_note,''))>2000 then
    raise exception 'plan_invalid_decision' using errcode='22023'; end if;
  select * into h from bob.project_plans where project_id=p_project for update;
  if not found or coalesce(h.current_revision,0) is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  select * into r from bob.project_plan_revisions where project_id=p_project and revision=p_proposal for update;
  if not found or r.status<>'proposed' or coalesce(r.based_on_revision,0) is distinct from p_expected then
    raise exception 'record_changed' using errcode='40001'; end if;
  if p_action='reject' then
    update bob.project_plan_revisions set status='rejected',decided_at=clock_timestamp() where project_id=p_project and revision=p_proposal;
    return bob.project_plan_read(p_project,p_proposal);
  end if;
  set constraints project_plans_current_fk deferred;
  if h.current_revision is not null then
    update bob.project_plan_revisions set status='superseded',decided_at=coalesce(decided_at,clock_timestamp()),
      approved_by=coalesce(approved_by,auth.uid())
    where project_id=p_project and revision=h.current_revision and status='approved';
  end if;
  update bob.project_plan_revisions set status='approved',approved_by=auth.uid(),decided_at=clock_timestamp()
    where project_id=p_project and revision=p_proposal;
  update bob.project_plans set current_revision=p_proposal,updated_at=clock_timestamp() where project_id=p_project;
  return bob.project_plan_read(p_project,p_proposal);
end $$;

create function bob_private.project_plan_link_evidence(p_project text,p_expected integer,p_requirement uuid,p_kind text,p_id text,p_revision integer,p_relation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cur jsonb; title text;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if (select current_revision from bob.project_plans where project_id=p_project) is distinct from p_expected then
    raise exception 'record_changed' using errcode='40001'; end if;
  if not exists(select 1 from bob.project_plan_requirements where project_id=p_project and plan_revision=p_expected and requirement_id=p_requirement) then
    raise exception 'plan_requirement_not_found' using errcode='22023'; end if;
  if p_relation<>all(array['resolves','conflicts','refines','supersedes'])
    or p_kind<>all(array['measurement','media','artifact','material_requirement','solution','task']) then
    raise exception 'plan_invalid_evidence' using errcode='22023'; end if;
  if (p_kind in ('measurement','artifact','material_requirement','solution')) is distinct from (p_revision is not null and p_revision>0) then
    raise exception 'plan_invalid_evidence_revision' using errcode='22023'; end if;
  cur:=bob_private.plan_evidence_current(p_project,p_kind,p_id);
  if not (cur->>'exists')::boolean then raise exception 'plan_evidence_not_found' using errcode='22023'; end if;
  if p_revision is not null and (cur->>'revision')::integer < p_revision then raise exception 'plan_evidence_not_found' using errcode='22023'; end if;
  insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by)
    values(p_project,p_expected,p_requirement,p_kind,p_id,p_revision,p_relation,auth.uid())
    on conflict do nothing;
  select title into title from bob.project_plan_requirements where project_id=p_project and plan_revision=p_expected and requirement_id=p_requirement;
  return jsonb_build_object('id',p_project,'revision',p_expected,'name','Living project plan v'||p_expected,
    'requirement_id',p_requirement,'requirement_title',title,'requirement_status',bob_private.plan_requirement_state(p_project,p_expected,p_requirement),
    'updated_at',clock_timestamp());
end $$;

create function bob.search_bob_project_data_v8(
  p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,p_record_id text default null,p_after_id text default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; plan jsonb; item jsonb; requested_rev integer;
begin
  if p_dataset='plan' then
    if p_query is not null or p_status is not null or p_area_id is not null or p_after_id is not null then
      raise exception 'invalid_lookup' using errcode='22023'; end if;
    if p_record_id is not null then
      if p_record_id!~'^[1-9][0-9]{0,8}$' then raise exception 'invalid_lookup' using errcode='22023'; end if;
      requested_rev:=p_record_id::integer;
    end if;
    plan:=bob.project_plan_read(p_project_id,requested_rev);
    return jsonb_build_object('records',case when plan->>'status'='ok' then jsonb_build_array(plan->'record') else '[]'::jsonb end,
      'related','[]'::jsonb,'truncated',false,'next_cursor',null);
  end if;
  result:=bob.search_bob_project_data_v7(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
  if p_dataset='project' and jsonb_array_length(result->'records')>0 then
    item:=(result->'records')->0;
    item:=item||jsonb_build_object('working_plan',bob.project_plan_briefing(p_project_id));
    result:=jsonb_set(result,'{records,0}',item,false);
  end if;
  return result;
end $$;

revoke all on function bob_private.plan_selector_valid(jsonb),bob_private.plan_evidence_current(text,text,text),
  bob_private.plan_requirement_state(text,integer,uuid),bob_private.project_plan_propose(text,integer,jsonb),
  bob_private.project_plan_decide(text,integer,integer,text,text),bob_private.project_plan_link_evidence(text,integer,uuid,text,text,integer,text),
  bob.project_plan_read(text,integer),bob.project_plan_briefing(text),
  bob.search_bob_project_data_v8(text,text,text,text,text,text,text)
from public,anon,authenticated;

grant execute on function bob.project_plan_read(text,integer),bob.project_plan_briefing(text),
  bob.search_bob_project_data_v8(text,text,text,text,text,text,text) to authenticated;
grant execute on function bob_private.plan_selector_valid(jsonb),bob_private.plan_evidence_current(text,text,text),
  bob_private.plan_requirement_state(text,integer,uuid) to authenticated;

create function bob_private.bob_project_write_v8(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text:=p_payload->>'kind'; d jsonb; quote text; message text; saved jsonb; record jsonb; result jsonb;
  key text; existing bob_private.bob_write_receipts; expected integer; proposal integer; action text;
begin
  if kind<>all(array['plan_proposal','plan_decision','plan_evidence']) then
    return bob_private.bob_project_write_v7(p_project,p_thread,p_turn,p_generation,p_payload);
  end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_payload-array['kind','record_id','expected_updated_at','expected_revision','data','request_quote']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or p_payload->'record_id' is distinct from 'null'::jsonb
    or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision')<>'number' or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
    or jsonb_typeof(p_payload->'data')<>'object'
    or jsonb_typeof(p_payload->'request_quote')<>'string' or char_length(p_payload->>'request_quote') not between 1 and 500 then
    raise exception 'invalid_write' using errcode='22023'; end if;
  d:=p_payload->'data'; quote:=p_payload->>'request_quote'; expected:=(p_payload->>'expected_revision')::integer;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if message is null or position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;

  if kind='plan_proposal' then key:='plan:proposal';
  elsif kind='plan_decision' then key:='plan:decision:'||coalesce(d->>'proposal_revision','');
  else key:='plan:evidence:'||coalesce(d->>'requirement_id','')||':'||coalesce(d->>'evidence_kind','')||':'||coalesce(d->>'evidence_id','')||':'||coalesce(d->>'relation',''); end if;
  select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023'; end if;

  if kind='plan_proposal' then
    saved:=bob_private.project_plan_propose(p_project,expected,d);
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Plan proposal v'||(record->>'revision'),'operation','created','savedAt',clock_timestamp(),'record',record);
  elsif kind='plan_decision' then
    if d-array['action','proposal_revision','decision_note']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>3 then
      raise exception 'invalid_write' using errcode='22023'; end if;
    proposal:=(d->>'proposal_revision')::integer; action:=d->>'action';
    saved:=bob_private.project_plan_decide(p_project,expected,proposal,action,d->>'decision_note');
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Project plan v'||(record->>'revision')||' '||action,'operation','updated','savedAt',clock_timestamp(),'record',record);
  else
    if d-array['requirement_id','relation','evidence_kind','evidence_id','evidence_revision']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(d))<>5 then raise exception 'invalid_write' using errcode='22023'; end if;
    saved:=bob_private.project_plan_link_evidence(p_project,expected,(d->>'requirement_id')::uuid,d->>'evidence_kind',d->>'evidence_id',
      (d->>'evidence_revision')::integer,d->>'relation');
    record:=bob.project_plan_read(p_project,expected)->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',expected,
      'label',saved->>'requirement_title','operation','updated','savedAt',clock_timestamp(),'record',record);
  end if;

  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,null,result);
  return result;
end $$;

create function bob.bob_project_write_v8(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write_v8(p_project,p_thread,p_turn,p_generation,p_payload)
$$;
revoke all on function bob_private.bob_project_write_v8(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v8(text,uuid,uuid,bigint,jsonb)
  from public,anon,authenticated;
grant execute on function bob_private.bob_project_write_v8(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v8(text,uuid,uuid,bigint,jsonb)
  to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('propose_project_plan',
  'Create a reviewable living Project Plan proposal with dynamic Steps, Completion Requirements, responsibility and evidence selectors. It is not current until explicitly approved.',
  'Read the current plan through search_project_data dataset=plan before replanning. Keep completed history: the server carries completed Steps unchanged. Reuse exact Step/Requirement IDs only when they come from the current plan; use null for genuinely new ones. Near-term requirements should be concrete; distant Steps may remain coarse. A measurement requirement should prefer an exact existing Measurement ID when one exists, otherwise an exact subject/Area selector. Responsibility is Bob, a project person, or unassigned; assignment never grants authority. Explain why the plan changes. This write creates only a proposal and still needs an exact quote from the current request.',
  1,false,array['concept','design','planning','build'],true),
 ('decide_project_plan',
  'Approve or reject one exact living Project Plan proposal. Approval changes the current plan; rejection leaves the current approved plan unchanged.',
  'Use only after the current user clearly approves or rejects a specific proposal. Read the proposal and current approved revision first. Never approve your own proposal without explicit user authority. A stale proposal conflicts instead of overwriting collaborator changes.',
  1,false,array['concept','design','planning','build'],true),
 ('link_project_plan_evidence',
  'Link exact current project evidence to one Completion Requirement in the current approved living plan.',
  'Use exact current project IDs/revisions. A resolves/refines/supersedes link may satisfy the requirement while conflicts marks it conflicted. Revisioned evidence pins the exact revision; if the source later changes the link becomes stale until reviewed. Do not manufacture evidence or use private conversation text as project evidence.',
  1,false,array['concept','design','planning','build'],true)
on conflict(name) do update set description=excluded.description,how_to=excluded.how_to,schema_version=excluded.schema_version,
  always_load=excluded.always_load,preload_phases=excluded.preload_phases,active=excluded.active;

notify pgrst,'reload schema';
commit;
