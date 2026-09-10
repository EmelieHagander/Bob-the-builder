# Plans and drawings — manual project artifact foundation

**Status:** manual milestone 4A implementation in progress. This contract owns the persisted manual drawing/artifact foundation; `Docs/v1-plan.md` owns release order and later deterministic generation/calculation gates.

## User goal

After choosing an exact project target, keep the drawing or plan the crew is using as durable project truth rather than as a loose image. A drawing version must say which target decision, solution version and measurement versions it was based on, and later changes must not rewrite that history.

This milestone is intentionally manual. It does not generate drawings, calculate materials or ask Bob to reason about them.

## Records and lineage

`bob.artifacts` owns drawing identity, project, optional area and current revision. `bob.artifact_revisions` keeps append-only kind, title, description, status, assumptions, optional drawing image, exact target decision, exact solution revision, archive state and server actor/time/reason.

Supported manual kinds are:

- plan;
- elevation;
- section;
- detail.

A drawing version has one explicit truth/readiness label:

- **Concept** — useful for intent/layout, not a measured construction record.
- **Measured** — the author is recording that the drawing is based on measured/provided project dimensions where applicable. It is not engineering certification.
- **Build ready** — the project team has deliberately marked this version as the drawing they consider ready to execute. It is still not structural, permit or professional approval.

The status is a human project decision; Bob does not promote it automatically. Assumptions remain visible at every status.

Each saved version pins the exact current `target_revisions.revision` it was created against. The server derives and stores that decision's exact solution id/revision and a snapshot of its title. The browser may not supply or rewrite solution identity. If the selected project target changes after the editor was opened, the save fails and the user must reload before deciding what the drawing belongs to.

Each version may reference up to 20 exact measurement revisions through `bob.artifact_measurements`. The UI displays their saved values, units, truth states and sources. Later measurement revisions are flagged without replacing the values used by the older drawing.

## Images, areas and history

The optional drawing image reuses the existing authorised `MediaAsset` storage rather than creating another file system. Only a completed image from the same project may be attached. Deleting that image later clears the file reference but keeps its recorded title and the drawing history.

An artifact may optionally belong to an Area. Area deletion keeps the artifact as project-level history. Project deletion cascades the records after the existing media lifecycle has been handled.

Create, revise, archive and restore append revisions. Archive/restore preserve the exact target, solution, measurements and image snapshot from the preceding version. There is no destructive rewrite of earlier high-value versions.

## Authority and concurrency

Use the existing project membership boundary and `database.ts` project/auth generation guard. Clients SELECT under RLS and `security_invoker` views. Only the guarded `artifact_command` may write.

The private definer checks the authenticated user's project membership and project person identity, validates same-project area/media/measurement relations, derives target/solution lineage server-side and rejects unsupported identity/history fields. Expected artifact revisions prevent lost updates. A project-row lock serializes target changes with artifact saves.

A delayed response after project/auth switching is rejected by the same frontend data boundary used by media, facts and solutions.

## Reachable manual workflow

Dashboard and Area link to **Plans & drawings**. A connected user can:

1. choose a project target in **Solutions & target**;
2. open **Plans & drawings**;
3. create a plan/elevation/section/detail for the project or current area;
4. record title, explanation, assumptions and concept/measured/build-ready status;
5. choose/upload an authorised project image;
6. link exact measurement versions;
7. save and reload the same drawing;
8. revise it later without erasing the old version;
9. see when its target or linked measurements have since changed;
10. archive/restore while keeping history.

If there is no selected target, creation is blocked with a route back to **Solutions & target**. Demo mode may render the surface but does not pretend to persist it.

## Not in 4A

This foundation does not yet provide:

- generated plan/elevation/section geometry;
- deterministic drawing construction from dimensions;
- calculations or bill of materials;
- stock deduction or Shopping updates;
- task-material relations, dependencies, tools or readiness;
- Bob/vision consumption;
- engineering/permit certification.

Those remain later Slice 4/5 gates. Future generated artifacts and BOM/work-plan records must reference the exact selected target and artifact/calculation revisions rather than infer lineage from whichever target is current later.

## Verification contract

Before marking 4A deployed, prove:

- anonymous/outsider reads and all raw writes are denied;
- project members can read and use the guarded command only in their project;
- foreign areas, images, measurements and target lineage cannot be attached;
- stale artifact revisions and stale target decisions fail atomically;
- exact measurement and target lineage remain pinned after later edits;
- image deletion and area deletion retain honest history;
- project deletion cascades the new records;
- production UI works at 320/390/1280 px with create/revise/history/archive/restore/reload and project-switch isolation;
- deployed Auth/PostgREST/Storage behavior is checked separately from browser HTTP fixtures.
