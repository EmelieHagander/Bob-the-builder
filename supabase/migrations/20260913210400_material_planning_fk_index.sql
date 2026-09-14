-- Slice 4B2a: cover the composite parent FK used by material requirement history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists material_requirement_revisions_parent_idx
  on bob.material_requirement_revisions(requirement_id, project_id);

commit;
