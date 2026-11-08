-- Owner decision 2026-11-07 (decision 1): the owner's chat answer is the
-- review (decision 2026-10-27: "Ingen särskild godkännandeknapp … Ett tydligt
-- svar på den visade modellen räcker"). The facade piece hold configured for
-- "Bygga liten lada" by 20261104072339 refused every construction write until
-- a review was recorded for the exact shown view; on 2026-11-05 the owner had
-- already answered in chat and Konrad was still held. It is the only project
-- with a piece policy. Removing its policy makes the existing trigger return
-- early ("if not found then return new") and the progress read answer
-- not_configured, exactly as for every other project.
--
-- Rows removed (recreatable from 20261104072339 and this record):
--   policy  artifact ed7c0d27-78b4-4ca6-a829-9d5580b456e7, plan revision 2,
--           step 538598a3-7028-435b-b09e-fb384f618fb0, max 24 instances,
--           7 requested openings;
--   scopes  front/back/left/right envelopes, positions 1–4;
--   attempt artifact revision 5, position 1, view front, awaiting_review,
--           no feedback, created 2026-11-04 19:52 UTC.
-- No construction, solution, plan, task or feedback row is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $retire_lada_piece$
declare
 project constant text:='p_54859d59bbea463bb5dea65fc22ce587';
 artifact constant uuid:='ed7c0d27-78b4-4ca6-a829-9d5580b456e7';
begin
 if (select count(*) from bob_private.construction_piece_policies) <> 1
  or not exists(select 1 from bob_private.construction_piece_policies where project_id=project and artifact_id=artifact) then
  raise exception 'lada_piece_policy_unexpected';
 end if;
 if (select count(*) from bob_private.construction_piece_scopes where project_id=project and artifact_id=artifact) <> 4
  or exists(select 1 from bob_private.construction_piece_attempts where project_id=project and artifact_id=artifact
   and not (artifact_revision=5 and position=1 and view_id='front' and state='awaiting_review' and feedback_id is null)) then
  raise exception 'lada_piece_rows_unexpected';
 end if;
 delete from bob_private.construction_piece_attempts where project_id=project and artifact_id=artifact;
 delete from bob_private.construction_piece_scopes where project_id=project and artifact_id=artifact;
 delete from bob_private.construction_piece_policies where project_id=project and artifact_id=artifact;
end $retire_lada_piece$;
commit;
