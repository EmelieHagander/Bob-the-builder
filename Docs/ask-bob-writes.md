# Ask Bob — bounded project writes

Status: implementation branch; not a claim of hosted deployment. Apply `20260917205126_ask_bob_project_writes.sql` before deploying its `ask-bob` Edge Function. No existing project content is changed by the migration.

## First scope

The exact approved persona remains unchanged. Its separate server authority layer now allows action on a clear request or approval of an already specified option, without another permission loop. The actual per-call tool list remains the capability authority.

| Tool | Persistent effect | Exclusions |
| --- | --- | --- |
| `save_project_description` | Replace the current description/plan with a timestamp precondition; preserve unrelated content | Not SolutionVersion selection, Building facts, or design approval |
| `save_project_task` | Create a todo task or revise its name/instructions in one existing Area | No assignment, status changes, completion or readiness |
| `save_project_measurement` | Create/revise the existing canonical measurement record and append revision history | No invented measured evidence, parent moves, source-image removal, archive or deletion |
| `save_project_drawing` | Create/revise the supported parametric 2D storage-box Artifact and read it back with an exact revision receipt | No arbitrary CAD/SVG/code, target selection, measured-site assertion, approval, purchases or parent move |

`search_project_data` gains a caller-RLS measurement projection and task instructions through a new `search_bob_project_data` RPC. The older lookup RPC stays compatible. Results remain literal, bounded and project-scoped; a chosen design dimension is a provided specification, not a physical measurement.

The shared guest identity remains read-only: it has no private claimed server thread. Unrelated apps, household/Building authority, people, purchases, selected targets, checks and structural approval are not exposed by these tools.

## Parametric drawing extension (implementation branch)

The 2026-09-18 2D extension requires
`20260918204949_parametric_storage_box_drawings.sql` before its frontend/Edge
rollout; it is not yet a hosted-release claim. `bob_project_write_v2` handles the
new drawing kind and delegates existing kinds to the established writer. It uses
the **same** claimed turn, eight-write budget, semantic retry keys, private audit
receipts and generation-fenced settlement. No service-role domain write is added.

Read the exact current target and drawing before an edit. Full explicit design
parameters produce one Concept revision; linked measurement references and
unrelated description/assumptions must be retained unless the request changes them.
`search_bob_project_data_v3` enriches artifact rows with their exact saved recipe;
Edge adds finished-part sizes using the same deterministic generator as the UI.
The generator and its limits live in [Plans and drawings](artifacts.md), not here.

Drawing receipts add `revision` and `areaId`; parser and browser validate these
before showing an exact-version **Open drawing** link. Receipt-only retry recovery
keeps that link. The full saved recipe is returned to the tool, not duplicated into
the compact transcript receipt. Arbitrary user/provider text never creates a saved
badge. Opening the link closes the drawer and uses the normal Artifact view.

## Authority and atomicity

The model cannot supply project, user, thread or generation authority. The Edge Function binds these from authenticated request and claimed server state. Domain calls use the **caller JWT**, not the service-role client. SQL independently checks current membership, thread ownership, active turn, generation, exact current-message request quote, allowed fields and same-project parents. A quote is an audit/reference constraint, not a semantic proof of consent; the model must distinguish requests from quotations, hypotheticals and suggestions.

Updates require the current timestamp or canonical revision. Project/task changes and their audit receipt commit in one transaction. Measurement writes reuse `evidence_command` and preserve an existing source image. Drawing writes reuse `artifact_box_command` and the canonical Artifact command; new geometry never silently reuses an old illustration. Receipts contain the actual post-write record; browser/transcript evidence receives only compact metadata. The private ledger retains before-state and write provenance and is never a public raw-table API.

There is no generic SQL, table-name, status, actor, readiness, purchase or delete argument. The migration changes only Bob schemas and grants no new raw domain-table privilege.

## Retry, failure and reset

There are at most eight writes per turn. Exact retries return the original receipt; a differently worded second create for the same named target in that turn conflicts instead of producing a duplicate. A claimed retry with existing receipts skips the model and reports what was saved.

Before finishing, settlement obtains the same advisory/thread/provider locks as writes, advances the generation and reads committed receipts. A delayed tool request carrying the earlier generation cannot commit afterward. The new commit/failure commands also fence generations, including retries of the same turn UUID.

A model exception after a save produces a receipt-only recovery answer, not a false failure or another execution. A receipt-only answer clears the provider cursor but retains the visible transcript. Failed transcript synchronization explicitly says project changes are saved. Unverifiable settlement stops further writes and labels the outcome uncertain; it is not a promise of rollback.

The frontend offers **Retry request** with the original turn UUID. A latest failed/pending server request can be recovered after reload. A deliberate new message is a new request, not a global semantic-deduplication guarantee.

The existing **New conversation → Clear chat and context** flow from #80 clears the caller's transcript/cursor and retry UI. It does **not** undo saved domain edits or their private audit history. Active turns block reset; generation/ownership checks reject later writes against a removed claimed thread. Multiple named/archived chat selection and provider-side object erasure remain out of scope.

## UI and refresh

The drawer shows **Saved to project** only from validated, same-project server receipts. Saving does not certify measurements, safety or readiness. Project screens refresh when the drawer closes, avoiding the existing project-version event remounting the shell halfway through a reply. Error responses never create a receipt badge.

## Verification and release

- `tests/bob-project-writes.test.ts`: actual migrated PGlite database, authenticated roles, read-back, atomic rollback, history, image preservation, stale edits/generations, dual-project boundaries, guest/revocation, reset survival and idempotency.
- `tests/bob-write-runtime.test.ts`: production tool parser/orchestration with injected provider/transport fixtures; approved-option execution, retry without another model call, lost HTTP results, model failure and receipt validation.
- Existing independent literal persona fixture remains unchanged.
- Existing project browser gate adds phone/desktop receipt display, wrong-project rejection, lost-answer retry with the same turn id, close/reopen and reload. Existing reset gate is retained.

These deterministic tests do not claim a live model personality evaluation. Hosted Auth/PostgREST write proof, migration verification, Edge rollout and Pages are separate release gates. Roll back the Edge Function first if necessary; the additive migration and optional frontend receipt fields remain backward compatible. Do not replay the whole shared-database migration history.
