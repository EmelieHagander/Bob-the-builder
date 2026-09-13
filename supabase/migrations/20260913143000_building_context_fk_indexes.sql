-- Follow-up after hosted advisor review: support Area target FK lookups without table scans.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index area_physical_targets_space_idx on bob.area_physical_targets(space_id)
where space_id is not null;
create index area_physical_targets_element_idx on bob.area_physical_targets(element_id)
where element_id is not null;

commit;
