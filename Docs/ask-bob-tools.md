# Ask Bob: tool discovery, loading and authority

**Owner decision / implementation in PR #91 (2026-09-21).** This document owns
Bob's tool surface and loading contract. The PR records the exact tested commit,
managed migration, merge, deployed Edge version, Pages and live-check evidence;
source presence alone is not a deployment claim.

This supersedes the fixed tool-array loading described in older backend/context
plans. It does not supersede domain write rules, Artifact lineage, private media,
conversation compaction or the selected-image grounding repair. See
[bounded writes](ask-bob-writes.md), [images](media-and-steps.md),
[conversation state](ask-bob-conversations.md) and [drawings](artifacts.md).
The wider Current View/router/Librarian design remains in
[the context plan](ask-bob-context.md), not implicitly implemented here.

## Product rule

The starting toolbox is not the complete toolbox. Bob must be able to find an
implemented permitted capability, load its exact contract, and continue the same
user task without another approval loop. The user never has to write JSON, choose
API names or approve a read of a tool guide.

Two availability tiers, separate from depth of description:

- **Core:** eligible tools supplied on every normal tool-enabled model call.
- **On demand:** eligible tools preloaded for useful project phases or loaded by
  exact name during the turn.

Phase is a preload hint, not authority. A design tool may be loaded during Build
without changing project phase. A phase change cannot grant rights to another
project, a Building, a write, a purchase or a completion. The bounded final-answer
call remains tool-free; directory availability does not promise an unbounded loop.

## One catalog and one handler-registration seam

`bob.tool_catalog` is operator-owned **surface metadata**: stable name, short
trigger description, long `how_to`, schema version, core flag, preload phases and
active flag. Authenticated identities can read it; ordinary users cannot modify
it. It contains no private project data, tool credentials, executable code or
per-user grants. Catalog visibility by itself is not execution authority.

`project-tools/bob-tools.ts` is the sole registration seam connecting a catalog
name to its real validated schema, handler and server-derived eligibility gate.
The runtime intersects BOTH sources. A catalog row with no registered handler,
a disabled row or a mismatched schema version never becomes callable. Exact
schemas are sourced from the executable contract, not a separately editable JSON
copy in a database. Adding a new handler does not require editing the model loop.

`catalog-seed.json` is the version-controlled installation seed and an explicit
fallback ONLY for injected/offline test callers. Production always supplies
`createToolPolicyReader(client, projectId)`. A live policy failure never uses the
seed, stale cross-user cache or an invented empty catalog. The SQL installation
and seed are tested for equality; later operator edits live in the database.
Already committed migrations are never edited to change a live loadout.

There is no new grant editor in this slice. Eligibility reuses the actual
capabilities of the authorised turn: for example, a shared guest has no claimed
writer and therefore cannot discover/load/invoke writes. Private history needs
its private conversation context. Domain RPCs remain the final authority for
exact records, physical edits, selected targets and permitted fields. A loaded
write tool does not imply that every Building or record is writable.

## Prepare, discover, load, execute

The per-turn `project-tools/session.ts` resolves a fresh caller-JWT policy for
prepare and again for execution. The initial load combines eligible core rows
with eligible rows whose preload phase matches the current Project phase. This
version reads the actual `bob.projects.phase`; it does NOT infer an Area or
screen selection from chat, add a browser authority field, or implement the
planned Current View. Future Area-aware hints must use a server-verified pointer.

`list_tools({query, after_name})` returns up to 12 permitted registered names and
short descriptions, their loading/availability state, and a continuation cursor.
A literal word filter is optional: `query:null` browses the full effective set.
An empty filtered page never proves no suitable capability exists. The exact-name
path does not depend on a ranker, embedding, or additional selection-model call.

`load_tool({name})` returns exactly one tool's full parameter schema, description,
version, detailed catalog guide and implementation notes. It also records the
activation in turn-local state. On the **next model call**, that exact native
function schema is in `tools[]`; the result is not merely JSON prose which the
model cannot call. Loading does not execute the handler or authorize its effects.
An already loaded tool can be reloaded to reread its guide.

Only tools offered for the model call that emitted a request can execute. A model
cannot load and invoke a previously absent tool in the same returned tool batch:
the invocation gets `not_loaded`, with an instruction to use the next call. This
fence prevents guessed/stale schemas becoming a back door. The dispatcher also
rechecks live policy and handler eligibility before invocation. Disabled/revoked
or version-mismatched tools do not retain authority through an old packet.

Loaded tools remain in the same turn until disabled, ineligible, version-changed
or the normal finalization boundary. A fresh turn derives its own starting set;
load state is not an enduring grant. The same schema can be loaded again then.

## Failure, cost and evidence

Keep separate results for `not_loaded`, `not_allowed`, `missing_context`,
`budget_exhausted`, `not_found`, `unavailable` and `contract_changed`. A catalog
transport failure is `tool_catalog_unavailable`, not a successful empty list.
Arguments required for a particular drawing, such as an exact source or selected
target, are still checked by that tool; this slice does not promise a complete
preflight of every possible argument before the model supplies it.

The directory/loading budget is independent of project lookup, image and write
budgets; loading never resets one. Bounds are 128 registered policy rows, 12 rows
per directory page, 16 management operations and 24 distinct loaded names per
turn. The normal eight-model-call/time bounds remain. No extra AI router is
called just to choose tools. This is reduced initial schema/guide payload, NOT a
measured end-to-end latency improvement claim.

Tool guides are server-owned interface documentation, not user permission or
project facts. They never become measurement/image/project sources. Actual reads
still produce their normal provenance; mutations still need a current-request
quote and a verified canonical receipt. A catalog failure after a committed
write must settle the write and retain receipt-only recovery rather than retry
it or falsely report it undone. Image-context revocation behavior is unchanged.
The operational trace records tool name/status, not arguments or project content.

## Drawing scope: this is not the geometry engine

This release makes existing tools discoverable and accurately described. It does
not turn `storage_box_v1`, `room_pair_v1` or the bounded stair generator into
arbitrary-object drawing capabilities. Legacy specializations are on-demand
entries, not a general `create_drawing` alias. No `bunk_bed_v1` is added.

The next independent drawing capability must operate on reusable geometry,
parts, parameters, relationships and anchored instances while reusing existing
Artifact identities, versions and source links. A bed, shelf and previously unseen
assembly must be different CONTENT, not different server code. Derived dimensions
must come from the same model as the visible geometry. Drawing flexibility is not
structural certification or permission to run arbitrary model-authored code.

Its acceptance gate must include an initially non-preloaded tool discovered and
loaded by a real model, creation and revision of different/unseen objects without
code changes, same-artifact readback, linked-dimension recalculation and accurate
in-app display. Catalog tests alone cannot satisfy that product gate.

The [building-knowledge plan](building-knowledge.md) remains complementary:
rights-checked construction/VVS/electrical seeding and source-grounded retrieval
teach methods; the generic drawing capability expresses/calculates them. No
reference corpus or embeddings are seeded by the tool-catalog release. AR remains
paused/discovery, not an implemented feature or prerequisite.

## Verification and release

`tool-session.test.ts` covers loading policy, paged browsing, exact contracts,
activation fences, independent budgets, revocation and malformed catalogs.
`tool-catalog-runtime.test.ts` uses the production loop, real writer parsing and
settlement with injected I/O: list -> load -> invoke -> persisted receipt, guest
denial and catalogue failure recovery. `tool-catalog-db.test.ts` applies the exact
DDL to PGlite and checks seed equality, RLS/grants and live policy changes.

Existing domain/SQL scenarios use explicit fixture loadouts through
`tests/support/tool-loadout.ts`; their real handlers/schema/RLS/receipts are not
bypassed. Default discovery has separate tests. The unchanged ordinary CI remains
the full regression gate, including the mobile/desktop browser journeys.

**Evidence limit:** injected model responses do not prove autonomous real-model
selection or a named-member drawing conversation. The existing unchanged hosted
guest smoke proves real-model text retrieval and access boundaries, not the new
list/load behavior. No real user's house/photos are used as test fixtures. No
workflow privilege, local browser restriction or blocked test publication is
bypassed to make a test appear complete.

Only the new additive Bob catalog DDL is required. Existing deployed handlers
already exist; the new dispatcher must validate registration before exposing
rows. For future handler additions: ship dormant handler/schema first, then
activate its matching catalog version. Never advertise an unimplemented handler.
Record exact managed migration history and deploy the verified immutable merged
source with JWT enforcement unchanged. Confirm Edge readback, matching release
marker, Pages and hosted checks before calling the release live. Rollback to the
previous Edge version leaves the unused additive catalog harmless; do not replay
or drop shared migration history.

## Expert tools and prompt delivery — 2026-09-24 integration

Every offered tool now carries its implementation description and usage guide, including preloads. The permanent system text lists names only; the image-grounding wrapper adds fresh evidence but no second behavioural prompt. Context instrumentation records character/byte counts, tool surface and remaining time, never message text or images.

New generic tools cover measurement archive/restore, solution create/revise, scoped target selection and task status/people assignment. Existing canonical commands, caller JWT, revisions and claimed-turn receipts remain authoritative. The plan compiler remains a representation assistant; Bob performs project mutations. CAD has its own research/render tools and standard/high model, documented in [CAD adapter](cad-adapter.md).

`read_project_record_section` navigates exact large plan/CAD records with JSON paths and bounded responses. A size limit cannot masquerade as an empty successful record. It does not increase project access or make partial evidence complete.

Image generation, attachment and finalization use [the media contract](media-and-steps.md). These tools are catalog-discovered, not a new permanent list of incident-specific prompt instructions.
