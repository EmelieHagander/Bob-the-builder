-- Proposal read views expose their explicit physical state for honest current/proposed UI and verification.
begin;

create or replace view bob.latest_space_proposals with (security_invoker=true) as
select s.id,s.building_id,r.revision,r.project_id,r.level_id,r.name,r.kind,r.notes,r.truth,r.source,r.archived,
  s.accepted_revision,r.change_note,r.recorded_by,r.actor_label,r.recorded_at,r.state
from bob.building_spaces s
join bob.space_revisions r on r.space_id=s.id and r.revision=s.latest_revision
where r.state='proposed' and s.latest_revision is distinct from s.accepted_revision;

create or replace view bob.latest_element_proposals with (security_invoker=true) as
select e.id,e.building_id,r.revision,r.project_id,r.space_id,r.kind,r.name,r.description,r.truth,r.source,r.archived,
  e.accepted_revision,r.change_note,r.recorded_by,r.actor_label,r.recorded_at,r.state
from bob.building_elements e
join bob.element_revisions r on r.element_id=e.id and r.revision=e.latest_revision
where r.state='proposed' and e.latest_revision is distinct from e.accepted_revision;

create or replace view bob.latest_relationship_proposals with (security_invoker=true) as
select x.id,x.building_id,x.subject_space_id,x.object_space_id,r.revision,r.project_id,r.relation,r.truth,r.source,r.notes,r.archived,
  x.accepted_revision,r.change_note,r.recorded_by,r.actor_label,r.recorded_at,r.state
from bob.spatial_relationships x
join bob.relationship_revisions r on r.relationship_id=x.id and r.revision=x.latest_revision
where r.state='proposed' and x.latest_revision is distinct from x.accepted_revision;

notify pgrst, 'reload schema';
commit;
