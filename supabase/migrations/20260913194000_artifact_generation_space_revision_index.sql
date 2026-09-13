-- Slice 4B1 hosted-advisor follow-up.
-- `artifact_generations_physical_idx` starts with building_id and therefore does
-- not cover the (space_id, space_revision) foreign-key prefix used by Postgres.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists artifact_generations_space_revision_idx
  on bob.artifact_generations(space_id, space_revision);

commit;
