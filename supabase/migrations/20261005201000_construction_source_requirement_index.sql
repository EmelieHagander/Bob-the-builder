-- Cover the requirement/project FK added by K4; preserve all data and authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index requirement_construction_requirement_project
 on bob.material_requirement_construction_sources(requirement_id,project_id);
commit;
