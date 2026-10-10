begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- A rebuildable display cache, never an Artifact revision or design approval.
-- migration new crashed in the installed native CLI; filename uses observed UTC.
create table bob.cad_viewer_exports (
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  profile text not null default 'kernel-edges-v1' check(profile='kernel-edges-v1'),
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('generating','ready','failed')),
  attempts integer not null check(attempts between 1 and 3),
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  payload jsonb check(payload is null or (jsonb_typeof(payload)='object' and octet_length(payload::text)<=4194304)),
  primary key(artifact_id,artifact_revision,profile,source_hash),
  foreign key(artifact_id,artifact_revision) references bob.artifact_cad_revisions(artifact_id,artifact_revision) on delete cascade,
  check((status='ready')=(payload is not null))
);
alter table bob.cad_viewer_exports enable row level security;
revoke all on bob.cad_viewer_exports from public,anon,authenticated;
grant select on bob.cad_viewer_exports to authenticated;
grant select,insert,update,delete on bob.cad_viewer_exports to service_role;
create policy project_read on bob.cad_viewer_exports for select to authenticated
  using(bob_private.has_project_access(project_id) and exists(select 1 from bob.artifact_cad_revisions c
    where c.artifact_id=cad_viewer_exports.artifact_id and c.artifact_revision=cad_viewer_exports.artifact_revision and c.project_id=cad_viewer_exports.project_id));
create index cad_viewer_project_idx on bob.cad_viewer_exports(project_id);

create function bob.claim_cad_viewer_export(p_project text,p_artifact uuid,p_revision integer,p_hash text,p_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare row bob.cad_viewer_exports; token uuid:=gen_random_uuid(); inserted uuid;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or not exists(select 1 from bob.artifact_cad_revisions
    where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision) then
    raise exception 'viewer_source_unavailable' using errcode='22023';
  end if;
  insert into bob.cad_viewer_exports(project_id,artifact_id,artifact_revision,source_hash,status,attempts,lease_token,lease_expires_at)
    values(p_project,p_artifact,p_revision,p_hash,'generating',1,token,now()+interval '75 seconds')
    on conflict do nothing returning lease_token into inserted;
  select * into row from bob.cad_viewer_exports where artifact_id=p_artifact and artifact_revision=p_revision
    and profile='kernel-edges-v1' and source_hash=p_hash and project_id=p_project for update;
  if not found then raise exception 'viewer_source_unavailable' using errcode='22023'; end if;
  if inserted=token then return jsonb_build_object('status','claimed','lease_token',token,'attempt',1); end if;
  if row.status='ready' then return jsonb_build_object('status','ready','payload',row.payload); end if;
  if row.status='generating' and row.lease_expires_at>now() then return jsonb_build_object('status','pending'); end if;
  if p_retry is true and row.attempts<3 then
    update bob.cad_viewer_exports set status='generating',attempts=attempts+1,lease_token=token,lease_expires_at=now()+interval '75 seconds',payload=null
      where artifact_id=p_artifact and artifact_revision=p_revision and profile='kernel-edges-v1' and source_hash=p_hash;
    return jsonb_build_object('status','claimed','lease_token',token,'attempt',row.attempts+1);
  end if;
  return jsonb_build_object('status','failed','retry_allowed',row.attempts<3);
end $$;

create function bob.finish_cad_viewer_export(p_project text,p_artifact uuid,p_revision integer,p_hash text,p_lease uuid,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_payload is not null and (p_payload->>'profile' is distinct from 'kernel-edges-v1' or p_payload->>'source_hash' is distinct from p_hash
    or p_payload->>'version' is distinct from '1' or p_payload->>'units' is distinct from 'mm'
    or p_payload->>'engine' is distinct from 'build123d-0.13.0' or octet_length(p_payload::text)>4194304) then
    raise exception 'viewer_payload_invalid' using errcode='22023';
  end if;
  update bob.cad_viewer_exports set status=case when p_payload is null then 'failed' else 'ready' end,payload=p_payload
    where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision and profile='kernel-edges-v1'
      and source_hash=p_hash and status='generating' and lease_token=p_lease and lease_expires_at>now();
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function bob.claim_cad_viewer_export(text,uuid,integer,text,boolean),bob.finish_cad_viewer_export(text,uuid,integer,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function bob.claim_cad_viewer_export(text,uuid,integer,text,boolean),bob.finish_cad_viewer_export(text,uuid,integer,text,uuid,jsonb) to service_role;
commit;
