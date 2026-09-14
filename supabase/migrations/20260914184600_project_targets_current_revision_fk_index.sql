-- Cover the scoped target -> exact target revision foreign key introduced by
-- 20260914164000_project_area_phases_and_scoped_targets.sql.
-- Additive follow-up only; never rewrite the already-applied phase migration.
begin;

create index if not exists project_targets_current_revision_fk_idx
  on bob.project_targets(project_id, scope_key, current_revision);

commit;
