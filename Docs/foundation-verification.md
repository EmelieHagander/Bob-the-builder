# Foundation verification and rollout

## Construction view pages and cache routing — 2026-10-22

**Prepared on `ccr-1d0233bb-b84nk5` (PR #317); not merged, deployed or measured
live.** Owner decision A, owned by [conversations](ask-bob-conversations.md#pr3--bound-result-payloads-without-an-ai-history-summary)
and [Artifacts](artifacts.md#construction-views-and-observed-results--prepared-2026-10-19).

- **Baseline (read-only production metrics, 2026-10-19 to 2026-10-22):** 539 main
  `ask-bob` calls, 14.56M input tokens of which 9.17M cached, USD 25.71. A third of
  steps were construction draft reads; 12 of 168 read steps over ten days ran 5–7
  reads in parallel. Peak main input since 2026-10-18 was about 57k (ceiling 96k).
- **Local evidence:** 166 tests pass across 20 focused files (construction views,
  edits, checks, result references, context continuation, release capacity and
  delivery, replay/background/lookup continuation, open-work loop, wire and
  grounding source checks). New tests cover the shared step budget, identical
  records in at most half as many pages, a 2,000-token cursor continuing exactly
  at 6,000 (inside a fragment), unchanged pages without the pin, the literal
  allowance for one tool only (measured on model-visible text, including
  quote-dense pages and JSON fragments; that test fails on the first draft, which
  counted one extra escape level), and `prompt_cache_key` on synchronous and
  background wires but never in hashed call options.
- **Independent review:** four read-only reviewers (replay, paging, provider
  request, docs) with adversarial verification. Two confirmed findings were fixed
  (escape-level measurement; docs dated by calendar instead of the pin). Deploy
  boundary caveats are recorded in the [conversation owner](ask-bob-conversations.md#pr3--bound-result-payloads-without-an-ai-history-summary).
- **Capacity:** the 40-step release probe still peaks at 50k/54k (its reads are
  project searches, unchanged). Estimate, not measured: one full 6,000-token page
  in each of the two latest exchanges instead of a 1,850-token read gives about
  62k; two full pages in both gives about 74k, above the 64k test target and under
  the 96k ceiling. A step holds at most max(12,000, 2,000 × reads) tokens of pages.
- **Not verified here:** `npm run check:edge` could not resolve
  `https://esm.sh/...` in this environment (proxy 403); TypeScript over the changed
  edge files with local shims shows the same 13 pre-existing shim errors before
  and after. No full suite, CI, deploy or paid model call was run. Deploy needs zero
  queued/running/paused Bob jobs or relies on the per-job pin; cache effect and
  read-step reduction must be measured from ordinary use after deployment.

## Bob final integration — 2026-10-19

**Merged source, followed by a separately verified hosted technical release.**
[PR #291](https://github.com/EmelieHagander/Bob-the-builder/pull/291)
integrates the complete-request/result-reference drafts and three construction
deliveries in main merge `f0647bda5a6dd3aa5bb2afd4b43cbd237550458c` on
2026-10-19. Earlier sections retain the preparation state at the time.
The [hosted release below](#hosted-bob-release--2026-10-19) installs the compatible
source and construction/tool/prompt catalogs; real paid model/CAD acceptance remains open.

The construction workflow now introduces the builder role, scope and exact tool
routes in **227 tokens instead of 558**. History-recall guidance has one owner in
the native tool manual, carried after catalog rebinding. The publication changes
four immutable prompt definitions and preserves policy grants, SQL/source fences
and agent execution metadata. Its generator and migrated SQL fixture agree.
Manual review used the prompt-craft subtraction/exclusivity tests and Archie
placement rules; this is not an independent agent review.

`bob-release-capacity.test.ts` runs the production estimator and reconstructed
checkpoint loop with two images, 2,000-token read pages and opaque native-item
transport placeholders. The 500-reasoning-token-per-step profile completes
**43 main calls, two writes, zero summaries**, with peak input estimate **52,388**
and maximum checkpoint **723,780 bytes**. The 2,500-token profile reaches the
existing capacity rejection after **27 calls**, with the last dispatched estimate
**94,578**; original native items are preserved. These are scripted stress profiles,
not actual provider token/cache prices or hosted CPU measurements. Database/policy
work stays bounded in the late claim; serialized native history and local CPU do
not become constant-size.

`bob-release-delivery.test.ts` combines real SQL/RLS and production tool/session,
construction, checker, writer, CAD review orchestration and context continuation.
Only model/CAD network responses and the original image transport are fixtures.
Every persisted boundary destroys and reconstructs all runtime components from
JSON: **73 leases, 16 scripted main responses, one renderer, one reviewer and two
writes** (construction delta and drawing). The drawing recipe equals revision 2,
the pre-existing part is unchanged, the contextual reference remains excluded,
and exact drawing/Step readback succeeds. The original image is opened once;
loaded manuals and the historical check survive restoration. Peak assembled
input estimate is **28,088 tokens**. The separate 43-call profile above exercises
long turns; this construction fixture does not pretend its 73 leases are 73
model decisions or that fixtures establish real model judgement.

Final source verification: [CI 39315572961](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39315572961)
passed **1,661/1,661 tests** with all Edge/type, production build, PWA and browser
steps green. [CAD adapter 39315572992](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39315572992),
[PostgreSQL concurrency 39315573016](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39315573016)
and [dependency security 39315572886](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39315572886)
also passed. The tested head was `6c1d24671c51aa2fdd34cfb65846fc8ad850affd`;
the final PR head only changed manual-only Actions workflows and verification
instructions. The merge preserves #290's prompt-craft documents and exact
integration source. Review was direct code/contract inspection, not an
independent agent run.

Read-only Supabase readback on 2026-10-19: `ask-bob` is ACTIVE v145 (JWT
required), `bob-worker` ACTIVE v113 (private worker authentication), and
the latest listed migration is `20261019120000 / bob_image_provider_files`.
None of the five delivery-1–4 migrations is installed. The active workflow,
construction reader and `agent-contract.ask-bob` catalog metadata lack the new
selective-tool, construction-view and complete-request opt-in flags. A source
merge and offline CI therefore do **not** make the new behavior live.

Consequently new complete-request/reference execution requires explicit paired
immutable catalog flags; this release does not set them. No hard dollar cap or
new task quota is introduced. The heavier profile is an **open activation gate**,
not a successful long-work outcome. The ordinary real-model image outcome, cache
share and approximately USD 1 goal remain unproven.


<a id="hosted-bob-release--2026-10-19"></a>
### Hosted Bob construction and tools release — 2026-10-19

**Installed and read back; no paid model/CAD probe.** Owner-approved release
of main source `329b522096ea108e9b61e88e52bccbcb382a2364` to Supabase
`yuobtgoidmmmwfqenkau`, after read-only confirmation of **zero** active Bob
jobs and the prior migration/runtime baselines. Source/test acceptance belongs
to [PR #291](https://github.com/EmelieHagander/Bob-the-builder/pull/291)
and the CI evidence above.

Managed migration identities differ from their reviewed source filenames:

| Installed managed version / name | Exact source migration |
| --- | --- |
| `20261019214334 / construction_edits` | `20261019172133_construction_edits.sql` |
| `20261019214826 / ai_construction_edits` | `20261019172346_ai_construction_edits.sql` |
| `20261019214854 / ai_construction_views` | `20261019175234_ai_construction_views.sql` |
| `20261019214918 / ai_selective_tools` | `20261019180806_ai_selective_tools.sql` |
| `20261019214955 / ai_bob_complete_context` | `20261019184338_ai_bob_complete_context.sql` |

Applied in order: canonical SQL core; shared async background worker and
webhook; compatible `bob-worker` then `ask-bob`; immutable edit, view,
selective-tool and prompt publications. Each installation was followed by
managed-ledger or function-source readback. The source package includes the
required CAD repetition module and exact legacy dependencies; type-only files
may be erased by the deployed bundler.

| Edge function | Prior → active | Authentication retained |
| --- | --- | --- |
| `ai-background-worker` | 9 → **10** | Existing private worker auth, `verify_jwt=false` |
| `ai-background-webhook` | 9 → **10** | Existing webhook signature auth, `verify_jwt=false` |
| `bob-worker` | 113 → **114** | Private capability auth, `verify_jwt=false` |
| `ask-bob` | 145 → **146** | `verify_jwt=true` |

The installed code was read back at the executable closure. Essential Bob,
construction-edit and complete-request source files match the submitted package.
The current resolved Bob manifest is
`f7da3bda-21db-4681-b9bf-d386aa3824a9` with **292** definitions. Active
`tools.edit_construction_parts` is v1; `tools.read_construction_draft` is
v4 with `construction_view_version=1`; `tools.save_construction_draft` is
v7 with `construction_repeat_version=1`; `bob.workflows` is v5 with
`selective_tools_version=1` and `prompt_craft_version=1`.
Provider-model and settings hashes are unchanged from pre-installation
(`84c9f33dbf9ca170ff998a21a1a75fb5` /
`c20f60563479e0d09ecb4f531d1f8b4b`). No Bob jobs were active after
installation.

**Authority readback:** `bob.prepare_construction_edit` is present and
executable by authenticated users but not anonymous users. It validates the
current claimed turn and original project scope; its historical private writer
delegate is not directly executable by `anon` or `authenticated`.
Supabase security advisors still report cross-app lints, including the
[intentional authenticated SECURITY DEFINER entrypoint](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable);
these notices are not being labelled as a universally clean project audit.
The installed function's server-side claim, grants and legacy delegation remain
the bounded domain authority, rather than an advisory suppression.

**Activation gate remains open:** `agent-contract.ask-bob` v5 still has
neither `complete_request_version` nor `result_reference_version`.
Complete native historical replay and the related long-reasoning workload must
not be enabled just because source and tool catalogs are installed. CAD's own
context strategy is unchanged. No ordinary image/multi-part/model/CAD success,
hosted CPU or comparable USD-per-delivery improvement is claimed. A separately
authorized natural member task and exact output/readback are next; preserve
original project data, paid receipts and previous failed job evidence.

## Selective tools and construction work — 2026-10-19

**Delivery 3 prepared on `codex/bob-selective-tools`, stacked on #288 (`c54b537`)
and #287; not merged, activated or deployed.** Contracts live in the
[tool owner](ask-bob-tools.md#selective-methods-and-tools--prepared-2026-10-19) and
[Artifact owner](artifacts.md#compact-repetition-and-natural-pieces--prepared-2026-10-19).

**109 distinct targeted tests pass across 13 files**, counting parent/subtests.
Focused groups: `tool-session`, `bob-context-toolbox`, `bob-tool-state-checkpoints`,
`cad-arrays`, `cad-pieces`, `bob-selective-tools`, `construction-repeats`,
`construction-draft`, `construction-edits`, `construction-views`,
`bob-context-strategy-main`, `bob-memory-toolbox-integration`, and
`bob-checkpoint-resume`. Commands use `node --no-wasm-code-gc --import tsx --test`
(SQL-heavy final groups use `--test-concurrency=1`). Initial failures identified
a missing test-model binding in the historical fixture and a legacy K1 test turn
whose existing write allowance was already consumed. The fixture now binds its
test model and uses a fresh claimed turn for the independent repetition scenario;
no production allowance was raised. Source lineage is asserted on source nodes
and the exact derived graph, consistent with the canonical parameter contract.

Evidence includes old/new pinned catalog parity, unchanged policy grants, no
group schema expansion, next-step offer fences, withdrawn authority, waiting
prerequisites, incompatible checkpoint rejection, full manual placement after
catalog rebinding, and actual main-loop checkpoint interruptions after each step.
The four scripted main calls restore the workflow and selected tool without
replaying completed reads. Existing 40-step checkpoint tests remain green.

The deterministic construction comparison offers 21 native schemas after the
old workflow selection (20 members plus `describe_tool`), versus one after new
workflow selection and two after explicitly loading its reader. Serialized tool
bytes fall from **59,295 to 3,167** for that specific comparison. This is not a
whole-prompt, cache-rate or dollar measurement. Loaded full manuals do now live
in each relevant native tool definition; a turn that deliberately loads many
tools will still have a larger schema surface.

Repeated-part tests compare an independently authored expanded graph, geometry,
bindings and exact source revision with compact input. Isolated migrated SQL
saves both natural pieces, rejects tampered geometry, and returns one receipt/
revision on retry after state restoration. Invalid counts, missing bindings and
joint targets cannot reach the writer. Part-queue tests retain common coordinates
and each piece's own requirements/source without copying sibling raw geometry;
the existing SQL queue still releases one renderer at a time. These scripted
tests do not prove that the real model chooses good sub-constructions or meets $1.

Both affected Edge entry points (`ask-bob`, `bob-worker`) pass Deno type checks.
The generated immutable catalog publication matches its runtime schema.
`20261019180806_ai_selective_tools.sql` publishes method/tool changes only, after
compatible runtime and delivery 2 catalog installation. Its UTC filename was
created through the generator because the installed migration CLI crashes before
creating files (same environment limitation as delivery 2). No hosted migration,
paid model/CAD run, workflow edit, full suite or full CI was performed. Commits
retain `[skip ci]`. Review this stack, then adapt #285/#286 and run delivery 4's
combined offline acceptance before the final full-CI gate.

## Construction views — 2026-10-19

**Delivery 2 prepared on `codex/bob-construction-views`, above #287's `d43f823`;
not merged, activated or deployed.** The [Artifact owner](artifacts.md#construction-views-and-observed-results--prepared-2026-10-19)
defines selection, coverage, exact observation references and remaining limits.

**72 targeted tests pass across six files**, including parent/subtest counts:
`construction-views` (10), `construction-checks` (12), `construction-edits` (14),
`construction-lists` (15), `bob-tool-state-checkpoints` (9) and
`bob-turn-checkpoint-db` (12). Run with
`node --no-wasm-code-gc --import tsx --test tests/<name>.test.ts` in focused groups.
The six-file run passed 71 tests; the final views-only run adds the explicit
cut-assessment case and verifies the final presentation corrections.

Evidence covers a synthetic canonical packet over 600,000 characters with a
small overview and exact late-selected measured value/source revision; transitive
formula/source/unknown dependencies; complete bindings pages; oversized Unicode
notes restored exactly; invalid cross-view/revision cursors; all check findings
beyond 200; exact check/list/cut sections and quantity/stock limitations; old
catalog parity; withdrawn access and changed sources; unchanged independent CAD
checks; stable observation time across active-operation replay; and JSONB key
reordering without cursor drift. A real local SQL checkpoint save/yield/new claim
restores 280 original findings without rerunning their assessment. Existing
40-step checkpoint, authority, write-receipt and source tests remain green.

`ask-bob` and `bob-worker` pass Deno checking with the existing local dependency
map. The generated catalog matches its executable tool (`build-construction-view-catalog.ts ... --check`),
and `git diff --check` passes. Review was manual, including owning documentation
guidance. No independent-agent review, hosted deployment, paid model/CAD call,
full suite or full CI is claimed. `[skip ci]` is retained; workflows are unchanged.

Release follows delivery 1's schema/runtime/catalog order, then installs both
view-compatible Bob runtimes before applying
`20261019175234_ai_construction_views.sql`. This migration changes only immutable
AI catalog versions and their atomic activation; no domain table or source rule
is changed. CLI migration creation was unavailable after its previously observed
Bun crash; this filename uses the observed UTC clock and the SQL is generated.
Read back `construction_view_version=1` in the pinned reader manifest. Older jobs
retain their original reader and version-1 component state; new jobs use the
version-2 construction-tools state. Rollback deactivates the new catalog for new
jobs while retaining compatible handlers for every still-running pinned job.

This demonstrates smaller model-facing construction data and complete selected
coverage, not fewer autonomous model decisions or measured dollar savings. The
workflow still loads 20 schemas. The generic result history in #286, long-turn
storage/native-reasoning capacity, production CPU and final end-to-end acceptance
remain in [the plan](bob-green-release-plan-2026-10-19.md) and
[State](bob-delivery-flow.md#state). No new hard cost/step/time cap was introduced.

## Bounded construction edits — 2026-10-19

**Prepared on `codex/bob-construction-edits`, based on main `5806e85`; not merged,
migrated or deployed.** This implements only delivery 1 of the
[remediation plan](bob-green-release-plan-2026-10-19.md). The
[Artifact owner](artifacts.md#bounded-part-changes--prepared-2026-10-19) owns behavior.

Targeted local verification passed **33 tests across five files** (Node counts
parent tests as well as subtests), run in focused groups with
`node --no-wasm-code-gc --import tsx --test`:

| Test file | Passing tests | Evidence |
| --- | ---: | --- |
| `tests/construction-edits.test.ts` | 14 | Migrated local SQL, three new volumes with every prior post/metadata retained; exact receipt retry and changed-key conflict; stale heads, no-ops and bad IDs; precise missing-note/self-joint/dependency errors; unknown input; forged computed values/source snapshots; identity reuse; explicit dependency removal; real SQL commit followed by continuation before acknowledgement; access/claim loss; source drift after preparation; old pinned catalogs exclude the new handler; new full-save diagnostics. |
| `tests/construction-draft.test.ts` | 7 | Existing full-save/read/revise, source and material pins, raw-table/RPC authority, archive/history and generic joint topology. |
| `tests/construction-parameters.test.ts` | 8 | Existing bounded parameter changes, compilation/source truth, claims, concurrency and accepted receipt replay after drift. |
| `tests/bob-workflows-judgement.test.ts` | 3 | Historical immutable workflow publication, fixture and runtime behavior. |
| `tests/tool-catalog-parity.test.ts` | 1 | Historical policy boundary plus exact new seed/publication parity. Initially failed because the new seed entry was incorrectly included in the older boundary; explicit publication-boundary correction passed on rerun. |

Both `ask-bob/index.ts` and `bob-worker/index.ts` pass Deno checking with the
existing local dependency map and manual node_modules. The generated catalog
passes `scripts/build-construction-edit-catalog.ts ... --check`; `git diff --check`
passes. Review used the existing documentation-steward guidance manually; no
independent agent review is claimed. No paid model or renderer was called; no
hosted data was changed. These fixtures do not establish actual model choices,
end-to-end drawing delivery, production CPU behavior, or dollar savings.

Release order after the final acceptance/CI gate:

1. Apply `20261019172133_construction_edits.sql` without activating the new tool.
   It adds preparation/merge and a delegated writer; existing commands retain
   their current route. Existing table data is not rewritten.
2. Install compatible `ask-bob` and `bob-worker` runtimes. Old pinned catalogs keep
   their earlier handler set and full-save diagnostic behavior.
3. Apply `20261019172346_ai_construction_edits.sql` to atomically publish/activate
   the new command, policy and workflow/manual versions. Read back the catalog
   and runtime versions before allowing new jobs to use the command.
4. Rollback first restores the prior active catalog for new jobs. Retain the new
   SQL/runtime compatibility while any job pins the new catalog; do not remove
   its handler or reinterpret accepted receipts during rollback.

The Supabase CLI aborted in Bun before `migration new` could create a file.
The new filenames use the observed UTC timestamp fallback; no historical
migration was renamed or rewritten. The catalog SQL is reproducible from the
executable tool and seed, checked against actual migrated publication.

This slice increases the selected construction workflow from 19 to 20 schemas.
It reduces required write arguments by allowing changed posts only, but leaves
full construction reads and workflow-wide loading for deliveries 2 and 3.
Full CI and the complete suite remain deferred until the final-stage local
behavior is confirmed, as requested. Commits use `[skip ci]`; workflows are
unchanged. [State](bob-delivery-flow.md#state) owns remaining review and acceptance.

## Bob context coverage corrections — 2026-10-18

**All five [coverage-audit findings](bob-context-coverage-audit-2026-10-18.md)
are corrected and activated through [PR #271](https://github.com/EmelieHagander/Bob-the-builder/pull/271).**
Tested head `508a13dffeb4193cfffadddf8192996326b0ba0d` and merge
`6c2167b950e872f9d3728f4c1e25576fc30a107d` have the identical tree
`aecdc3c1fe71597a37430b5c0dcf843de16557eb`. The merge retains the concurrent
UI/performance and atomic CAD continuation releases #269/#270. Audit-only #268
is superseded; its dated evidence remains in the repository.

The domain owners describe the resulting behavior:
[conversations](ask-bob-conversations.md#context-strategy--2026-10-18),
[tools](ask-bob-tools.md#tool-and-colleague-cards--2026-10-18), and
[CAD](cad-adapter.md). The missing shell-to-plan extension is restored at its
original position in today's write chain. Daisy/Kjell's unused runtime, role
settings and active catalog entries are removed; immutable historical manifests,
versions and accepted-job evidence remain. Plantus, Vera and Rita load calculator
instructions on demand and reload after renewal. Retention v2 counts complete
native tool exchanges, including parallel outputs, without consuming a slot for
commentary. Initial orientation is bounded to **12,000 tokens**, with exact
records in pages bounded to **6,000 tokens**, explicit completeness and stable
lossless source identity.

[Final CI 39141009502](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39141009502),
job `117715259312`, passes **1,525/1,525 tests**, canonical Edge checks, vocabulary,
production build and all browser gates.
[CAD adapter 39141009484](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39141009484)
and [CAD concurrency 39141009483](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39141009483)
pass, including 85 real PostgreSQL race checks. Independent reviews covered all
five fixes and the final calculator denial boundary. The first CI pass exposed
stale eager-tool fixtures and a real lazy-tool denial regression; the corrected
runtime stops after a requested calculation loses authority/policy/allowance,
while invalid input remains correctable and a no-arithmetic verdict stays valid.
The current allowance policy introduces no new application call quota.

Nine browser screenshots were inspected at 320, 390 and 1280 px: source disclosure,
image replies, reset dialogs, drawing recovery and working status. Artifact
`12141148150` from the first run has SHA-256
`a757cdfa3d3cc73b159f71f59789bf9048d23b788bdc36092a16c6691e850b60`.
The final correction changes only backend calculator handling and tests; the
inspected UI source is unchanged, and final-head browser gates also pass.
These browser fixtures mock model/HTTP responses and do not establish owner/CAD
acceptance. The prior floating Latest-control polish remains in State.

Both migrations were installed on `yuobtgoidmmmwfqenkau` through fox and mouse.
Complete hosted statements exactly match the reviewed source, independent of
the hosted timestamp assigned by the migration tool.

| Source migration | Hosted version / name | Statement SHA-256 |
| --- | --- | --- |
| `20261018144828_restore_cad_shell_plan_link.sql` | `20261018160029 restore_cad_shell_plan_link` | `226877973bc93c487e1f3d770586dc7ffece2a1cba2503752fa2e00a699d72f6` |
| `20261018144957_ai_context_coverage_catalog.sql` | `20261018160310 ai_context_coverage_catalog` | `7b0da688971e7196c65cdb17eab1dbb7a6728ebf2220c4885e68601ba1f9850e` |

Core readback passed **129/129 checks**, preserving all 20 protected data-table
fingerprints, their RLS/grants and every prior migration. The four restored/renamed
shell functions match reviewed source, ACLs and search paths; the later consequence
wrappers and atomic drawing continuation are preserved. Final readback passes
128/129 exact-equality checks: one private drawing-request event acknowledgement
changed during normal runtime activity. On existing request
`c49d7325-52fb-4341-92cc-52db28f7ceb6` in `p_test`, only `observed_event` changed
**23 → 25**. Replacing that field with 23 in a read-only JSON calculation reproduces
the complete original table digest `e2f2f70919c3f270e554163c31453ea0`; all other
fields, including status, revision and update timestamp, are identical.
The unchanged #270 `queue_drawing_events()` routine queued events 24/25 at
16:02:22Z/16:03:18Z and acknowledged them through that field. The jobs completed at
16:02:43Z/16:03:32Z. This explains the observed delta; the failed equality check is
retained, not relabelled as an unchanged table. The other 19 protected tables are
identical. Neither migration performs drawing/project-data DML.

Catalog readback passes **28/28 checks**: exactly **285 active definitions** and
**93 policies**, 27 retired heads, exactly two removed CAD role settings (42 → 40),
and all 12 model records unchanged. All 544 old version rows and all 24 old manifests
are preserved byte-for-byte, with exactly 10 new versions and one new manifest
`914c2b05-1f0d-454c-ad4e-9dd552ed65b5`. Unrelated definitions, other-app snapshots,
function OIDs/ACLs and service-only retirement guards match. Main Bob remains
GPT-5.4/high, completion 2 and allowance 1; specialist instructions 1, retention 2
and orientation directory 1 are active. Security and performance advisor results
are identical after excluding observation timestamps: seven/four existing finding
categories, no new findings.

The complete Edge closures were installed before catalog activation. Every
executable source byte matches the tested revision; entrypoints, Deno import maps
and authentication modes are preserved.

| Function | Version / JWT verification | Source readback | Bundle SHA-256 |
| --- | --- | --- | --- |
| `ask-bob` | 133 / true | 103 uploaded; 101 verbatim files plus one erased type-only stub | `d9fe156397b78b1d1cdcbe0b6f0da9a143c0ff5ff2be98480cb0261eb265a830` |
| `bob-worker` | 101 / false, own authentication | 102 uploaded; 99 verbatim files plus one erased type-only stub | `753e6b11c339d6d7089aca38ecdefdee98c72967311e782ccf673c37fe1dad66` |

The empty returned `cad-intake.ts` stub corresponds to an import-type declaration
and five type aliases, with no executable statements. Both bundles omit type-only
`src/data/provenance.ts`; the worker also omits type-only `bob-request.ts`.
These erasures were inspected explicitly. Both endpoints reject unauthenticated
POSTs with 401.

[Pages 39143668502](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39143668502)
and the postmerge CAD adapter passed. The deployed page and actual
`assets/index-C5540KBI.js` returned 200.
[Live Bob 39143668489](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39143668489),
job `117723033506`, passed actual Auth/RLS/model checks after catalog activation:
nonmember 403, retired endpoint 410, material/source disclosure, actual image
pixels, versioned knowledge and natural-language advice. The advice probe's
observed project snapshot stayed unchanged, and the shared guest created no
private server history. Execution-event metadata pins all 13 of this probe's model
calls to the new manifest `914c2b05-1f0d-454c-ad4e-9dd552ed65b5`, including
instruction discovery before native project reads. Its three logical requests
used disposable project
`p_608f8e8411914b89b23f1b4f1cfe8ca3`, created at 16:09:11Z; this workflow was not
read-only overall. Ordinary caller commands removed the image bytes/metadata
at 16:11:30Z. Guarded operator cleanup then removed only that exact fixture after
checking its nonce/name/time, complete project/member/material/Task hashes,
expected phase/event rows, all project-scoped tables, indirect references and
absent media/Storage. Final readback reports zero project, member, Task, material,
media, private-thread and Storage rows for that ID. Shared Auth, execution/cost
records and the unrelated older cleanup item in State are preserved.

Ordinary owner acceptance remains in [State](bob-delivery-flow.md#state): a new
message in the same private thread, long-memory semantic fidelity and the existing
bed/CAD request. No owner message or manual owner-job restart was submitted for
this release. Technical fixtures and the general guest integration probe do not
close those acceptance gates.

## Bob context strategy release — 2026-10-18

**Published and activated through [PR #267](https://github.com/EmelieHagander/Bob-the-builder/pull/267).**
Tested head `ef68df41e8baa9ded662d2ea41436cf6741f54fe`, tree
`61c1d2b76803a15c4d8ec1abc79d6a194b08c072`; merge
`daf15caeb70e254e3c259d938745348f70956a3f` has the identical tree.
The [conversation owner](ask-bob-conversations.md#context-strategy--2026-10-18)
defines bounded editable memory, exact five-message context, private hybrid recall,
role-specific orientation, lazy instructions and same-job context renewal.

[CI 39112711221](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39112711221),
job `117632034115`, passed all **1,489 tests** and all required gates, including
canonical Edge checks, vocabulary, build and browser verification.
[Security 39112711153](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39112711153)
and [CAD concurrency 39112711285](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39112711285)
also passed. Six browser screenshots at 320, 390 and 1280 px were inspected
(artifact `12132080264`, SHA-256
`9fd4f1d661e1b969bd7109befebd0fd546961cae288adb42d1c73ed62d6f1f9a`).
The existing floating **Latest** control overlaps long terminal error text after
older-history paging; that nonblocking polish remains in [State](bob-delivery-flow.md#state).

The following migrations were applied to `yuobtgoidmmmwfqenkau` through fox and mouse.
Hosted versions differ from source filenames; identity and complete statement
content were compared, not timestamp equality.

| Migration name | Hosted version | Statement SHA-256 |
| --- | --- | --- |
| `bob_source_linked_memory_retrieval` | `20261018090740` | `6fd4194e1cc159da6b2d9d2e405df52263dd33dbc3a7e0e2ad38eb7028d5a6ce` |
| `ai_embedding_adapter` | `20261018090744` | `302f1a6ed39c24097d56c65bd5c3b0f7f450dba2d96c272104d3b62f873e380c` |
| `ai_context_strategy_catalog` | `20261018091120` | `ad1ebaf270cef8a8a0874acbf682473be90b3baf3ce4b6d6e7c1ea41cdded6cb` |

Foundation readback matched all six function bodies: private index pending/save,
exact-message read, summary refresh, hybrid search and shared catalog validation.
Owners, fixed search paths, security-definer properties and service-only grants
matched. The private embedding table has RLS, no anon/authenticated access, checked
source keys and `vector(256)` in the `extensions` schema; source and full-text indexes
were present. Advisor delta contained only the expected informational finding that
this service-only private table has RLS without caller policies.

Both complete Edge dependency closures were installed and read back before catalog
activation. Every returned source file matched the tested revision; there were no
mismatches or extra files. Omitted files are type-only dependencies. Both function
Deno configurations/import maps were present.

| Function | Version / JWT verification | Uploaded / matching returned files | Bundle SHA-256 |
| --- | --- | --- | --- |
| `ask-bob` | 131 / true | 103 / 102; type-only `src/data/provenance.ts` omitted | `6ab77130e85acfe95974bb2565fc4f6b13d9875a18f23f63f0434bdbc951a6be` |
| `bob-worker` | 99 / false, own authentication | 102 / 100; type-only `src/data/provenance.ts` and `bob-request.ts` omitted | `3d6848b9d3219198dd0757ab9811f2ed7f6bc671e519e304d4fd5a935dbef3ea` |

Both endpoints returned 401 for unauthenticated POSTs.
[Pages 39114240793](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39114240793)
passed; the deployed page and actual `assets/index-D8qCodAA.js` returned 200 with the
correct project and new context-error UI.

Activation readback proves exactly **97 changed definitions, 20 additions and 193
unchanged definitions**, with none removed or unexpectedly published. New definitions
start at version 1. All 41 existing settings were preserved, with one new
`memory-embedding/global` setting. The 12 existing model records were preserved except
the intended embedding capability fields and update timestamp. Main Bob remains
**GPT-5.4/high**, `work_completion_version=2`, `work_allowance_version=1`;
`context_strategy_version=1` and memory V2 are active. The embedding binding is
`text-embedding-3-small` at 256 dimensions. Technical context policy is 64,000 tokens
for renewal, a 1,600-token handoff, two retained tool exchanges and a 96,000-token
input ceiling. The exact-message tool is active and loaded on demand.

[Live Bob 39114240795](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39114240795),
job `117636642220`, passed Auth/RLS and real-model integration checks: nonmember 403,
retired endpoint 410, material read, actual image pixels, knowledge retrieval and
natural-language advice. Its three logical Bob requests used a disposable guest
project, so the workflow was **not read-only overall**. The fixture was created at
09:10:07Z; the workflow finished at 09:11:32Z, overlapping catalog activation at
09:11:20Z. Its recorded idea
turn `769d448a-c147-49fb-b299-a0307c90e487` began around 09:11:10Z and retained
pre-strategy manifest `9c169b50-54c4-4605-be35-e90a8a3a9332`: ask-bob contract version 3,
completion 2/allowance 1, with no `context_strategy_version`. The check therefore
verifies the new Edge runtime's compatibility with the older pinned catalog,
**not actual use of the new memory strategy**. Image cleanup passed at 09:11:28Z.
Guarded project cleanup deleted only `p_7f1636b2d42e48ed90cbd4b0a5a7f5a9`; exact
readback found zero remaining project, membership, Task, material, media, thread,
job, drawing-request, Artifact and Storage rows. Earlier fixtures were untouched.

Ordinary owner/private-thread and long-memory model quality remain open: faithful
constraints and corrections after repeated folds, relevant exact retrieval,
role-specific handoffs and successful delivery after context renewal. No owner
message was sent and no owner job was manually restarted for this release.

## Managed conversation memory — 2026-10-17

The owner turn `3982c23a-3dd9-4202-9fef-3ed52c515b0f` failed at
21:36:31Z before main Bob or CAD started. The stored brief covered sequences
1–39; the next older batch was 40–41 and T1 was 42–46. Both completed summary
calls returned pointers 1–40, omitting 41. Coverage validation preserved the old
watermark and returned `context_unavailable`; it did not lose the transcript.

The local reproduction uses the same 39+2 boundary. New executions let code
reserve all new references and fit optional older hints within the existing
40-entry/12,000-character brief; the model still maintains the semantic gist.
[The conversation contract](ask-bob-conversations.md#managed-memory-navigation--2026-10-17)
owns exact five-message input, searchable original history and legacy replay.
Independent subagent review found no blocking defect. Focused regressions cover
repeated rollover, exact original-history SQL search and private-thread isolation,
invalid references, serialized-size pressure and replay without another paid call.
**Published 2026-10-18 through [PR #266](https://github.com/EmelieHagander/Bob-the-builder/pull/266).**
Tested head `26d0dd2d00333bdcde1458320a8c1d402bcaa18b`, tree
`bb4b19ac361ce3b4ed467569071123ba0cfe508d`; merge
`adbbdccbc2f901d5134252aec95e4fb997c7c355` has that same tree.
[CI 39074031207](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39074031207)
passed all 1,411 tests, vocabulary, Edge checks, production build and browser gates.
The 17 new memory regressions and eight existing brief/recovery tests also passed
locally. Local build passed; local Edge dependency download was refused by the
environment, so the successful CI Edge check is the verification evidence.

Both complete dependency closures were published from the tested head to
`yuobtgoidmmmwfqenkau` via fox and mouse, before merge. Exact source readback passed
for all returned files. Type-only omissions match the preceding installed bundles.

| Function | Version / JWT verification | Uploaded / exact returned files | Bundle SHA-256 |
| --- | --- | --- | --- |
| `ask-bob` | 130 / true | 97 / 96; type-only `src/data/provenance.ts` omitted | `5ac4177116cda0aafef0621e0f594bf39c803d401c2c4185788fcdb2970cb3f2` |
| `bob-worker` | 98 / false, own authentication | 96 / 94; type-only `src/data/provenance.ts` and `bob-request.ts` omitted | `05fc9585746228604e33e8cabce60b9ccfb0fb7cdcd8a32ddf2b3edfaecfc10e` |

Both endpoints rejected unauthenticated POSTs with 401. No migration or catalog
activation was performed. All 290 active definitions, settings and bound model
snapshots match the pre-release snapshot; GPT-5.4/high, completion version 2 and
allowance version 1 remain active.
[Pages 39094855524](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39094855524)
published the merge successfully. The live page and script returned 200 with the
correct project configured. [Live Bob 39094855589](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39094855589)
passed its release check. These checks do not prove semantic summary
fidelity, arbitrarily long same-turn provider context or real owner/CAD acceptance.
The next ordinary owner message in the same private thread remains the acceptance
gate; no owner message was sent and no failed owner job was manually restarted.

A separate full-schema SQL reproduction found an automatic drawing failure:
loading a request from a later owner turn opens a new budget period, but a failure
before save leaves the original turn/credential binding. The dispatcher then
continues the old turn and `load` throws `drawing_budget_period_closed`, masked as
`drawing_request_unavailable` and then `background_failed`. Live metadata for
request `4d7de67b-ed9b-4249-9873-a5c776207824` confirms origin
`a880362c-43cc-4561-86fc-7e7f108d348d`, current period 2 on
`d94d90b6-6675-40b4-b754-e2fc8e043608`, and the origin period archived.
The historical job's exact exception was not retained; matching live state plus
the local reproduction explains the failure path without claiming a saved trace.
The memory change does not modify this SQL transition or repair owner data.

## K0 construction boundaries — 2026-10-02

**K0 correction deployed through [PR #183](https://github.com/EmelieHagander/Bob-the-builder/pull/183).** Baseline `50116033c744f7695830657c56538ac447b1527b`;
reviewed head `74a63bfd9e772d10e924cb49484aa47e0e9fc833`. This closes the initial code/drift
investigation and delivers the first bounded correction. K1–K5 and the real shelf
acceptance remain open in [State](bob-delivery-flow.md#state).

Read-only production inspection of request `c49d7325-52fb-4341-92cc-52db28f7ceb6`
found 12/24 reserved calls, $1.119091 spent against $1, no unpriced usage and no
pending calls. Its latest owner job `6acaace7-269c-4753-82a7-4194e076cf8f`
contributed five request-budget calls costing $0.818154; earlier executions
contributed $0.300937. All ten provider calls in that owner job, including Bob
and memory work outside CAD, total $1.035644 at their pinned recorded prices.
Both the request-wide spending condition and the separate $1 turn condition
were therefore reached; neither the 24-call ceiling nor unresolved accounting
explains this snapshot. The completed job's step journal is no longer retained,
so the exact ordering of the two stop checks is not reconstructed from this
aggregate. No budget grant, manual replay or user-data repair was performed.

| Finding / owner | Reproduction and first correction | Remaining proof |
|---|---|---|
| Budget boundaries: `bob-model-budget.ts`, `drawing-budget.ts`, `bob_drawing_budget` | Different stop conditions previously collapsed into `turn_budget_exhausted`. The additive SQL response and Bob-only diagnostic now retain scope, all applicable causes and counters; CAD retains the failed phase and recovery guidance. Old-server ambiguity remains unknown. Thresholds, locks, reservation/replay and grants are unchanged. | Hosted rollback-only SQL and definition/grant readback passed. A real model stop with the new diagnostic remains part of end-to-end acceptance. |
| Candidate vs delivery: `cad-review.ts`, `cad-research.ts`, `cad-assistant.ts` | The live reviewer demanded save/link receipts before it could approve the candidate. A fixed server candidate-stage context and role contract defer those receipts; such requirements remain `unresolved / pending_delivery`, not met. Quality/source errors still reject the candidate and `ready` still means `saved:false`. Contract versions change the runtime fingerprint. | Controlled model evaluation must establish that actual model behavior follows this boundary. Injected responses prove the wire/parser/save boundary, not model judgment. |
| Dimension output: `cad-schema.ts`, `cad-worker/bob_cad/worker.py` | The current schema/worker exports contours, geometry and previews; it has no dimension/part-label input or rendering layer. An additional designer attempt cannot supply that missing feature. | The bounded annotation contract is specified in the [CAD owner](cad-adapter.md#construction-chain-boundaries); implementation and rendered acceptance belong to K3. |
| Assembly/material bridge: catalog, CAD/Artifact and material owners | Definitions, placements and limited CAD quantities exist, but there is no complete typed joint-to-fastener-to-purchase chain. | K1's first diff must preserve existing identities/revisions and add the structured construction draft before broadening list generation. |

Local focused regression tests cover turn cost/count/unpriced stops, request
pending/cost/count/context stops, unchanged allocation and replay, caller denial,
late provider recovery, candidate-stage delivery deferral, geometry rejection and
review-stage budget propagation. Adjacent intake, lifecycle, restoration and
background wire suites pass; all 126 local test files and Edge type checking pass. [CI 37054279650](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37054279650) passed 856/856 tests, build, PWA and all browser groups, including 320/390/1280 px foundation and building views. [PostgreSQL concurrency 37054279629](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37054279629) passed 28 races; [CAD adapter 37054279693](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37054279693) passed. Manual Archie contract review;
no independent agent review or live-model success is claimed.

Supabase changelog and current function guidance were checked. Migration
`20261002191430_drawing_budget_diagnostics.sql` was generated by CLI 2.117.0;
it replaces only the existing service-only function with the same signature,
empty search path, claim/access checks and grants. The shared OpenAI service,
model settings, CAD engine and user UI were not changed.

Release at 19:40 UTC: merge `503e97f2ac3691d8bde94a2281e1c3cce04a7e61` has the exact
tested tree `2edece15d6a7df7dc5ecd821326ccdba901d6eb1`. The migration source SHA-256 is
`e83e8866720e47496468170f656a4d7499aee3f5f38505006d8354eb4223a746`; hosted ledger
`20261002194012 / drawing_budget_diagnostics` in `yuobtgoidmmmwfqenkau`.
Hosted rollback-only smoke passed pending/cost reasons, exact counters, service-only
execution, cached receipt replay and no extra allocation. No synthetic users or
projects remained. Definition readback confirms diagnostics, empty search path,
service-role execution and no authenticated/anon grant. Security-advisor findings
are unchanged after excluding observation timestamps.

`ask-bob` v73 (JWT enabled) and `bob-worker` v41 (existing capability authentication)
read back ACTIVE and pinned to that merge. Bundle hashes: ask
`5068d7c2d085db2758ddf3a45cd8e64bb98892912447e29f145e08e059dd3f27`, worker
`0c59cc5d295ad33cc64ac02fc5842e2910a6dedbda6fde478ff14e382e01457c`. Both unauthenticated
HTTP probes returned 401. Reviewer ceiling remains 50,000; owner request spending
remains $1.119091. No paid model replay was started. These technical readbacks do
not prove real model compliance with the revised candidate-stage instruction.

## Reviewer output ceiling — 2026-10-02

The owner explicitly authorised raising the CAD review ceiling to 50,000 tokens.
At 18:05:06 UTC, a guarded update changed exactly the enabled Bob/CAD reviewer
setting from 12,000 to 50,000 in project `yuobtgoidmmmwfqenkau`. Independent
readback confirms `gpt-5.4-mini`, high reasoning and 50,000; the local model
catalog ceiling is 65,536. The shared adapter reads this setting for each new
model call. Model, reasoning effort, other roles and request spending/attempt/
deadline guards were not changed. No Edge redeployment was needed.

This later owner decision supersedes the pre-change experiment ordering recorded
below. Successful review, rejection of known defects, actual token/cost usage,
and the complete save/link/reopen path still require evidence; raising a ceiling
does not prove quality or delivery.

The owner's new same-thread job `6acaace7-269c-4753-82a7-4194e076cf8f` progressed
to the independent reviewer at 18:09:44 UTC, after the setting change. Reviewer
job `b24a759a-6006-4879-aef6-9ee959613ef9` completed at 18:11:00 UTC with
provider `max_output_tokens=50000`, 19,962 input tokens and 24,851 output tokens
(recorded rates imply $0.126801). It returned a usable structured `revise` verdict:
missing visible dimension chains/text and missing save/Step link. The latter
requires follow-up on review sequencing because candidate review precedes canonical
save/link; a completed review is not a delivered drawing or proven review quality.
The provider reported all output as reasoning despite returning verdict text, so
that usage sub-breakdown must not be interpreted as no visible answer.
A queued Bob job with zero attempts is not evidence of no execution: `bob_wait_for_ai` resets the
per-hop counter and dispatch timestamp. This job had eight total claims and a
live reviewer wait. No dispatcher repair or manual job replay was performed.
The owner job subsequently failed with `turn_budget_exhausted` after 11 total
claims. This is separate from the resolved reviewer output truncation: the shared
turn guard checks cumulative cost, logical call count and unpriced usage. Which
condition fired remains to be established. No overall budget was raised and no
extra owner turn was started. Remaining acceptance is owned by
[State](bob-delivery-flow.md#state).

## Shelf scope conflict — 2026-10-02

**Later automatic attempt:** after the expired foreground job, an event-driven
job ran at 16:59–17:02 UTC using the same request identity. It reached the
independent reviewer. The provider returned `incomplete / max_output_tokens`:
`gpt-5.4-mini`, high reasoning, 12,000 output tokens, all 12,000 reasoning and no
usable verdict (18,921 input tokens; recorded reviewer cost $0.068191). The
request is now `retrieval_failed`, revision 17, with no saved receipt. Its private
reply correctly reports the review failure. This is a separate blocker from the
scope conflict below; releasing that fix alone does not close shelf acceptance.
A controlled reviewer experiment must measure both completion and rejection of
known defects before changing the governed setting. The earlier designer fix
used medium reasoning at the same ceiling; reviewer equivalence is not proven.
No model setting or spending threshold was changed during this investigation.

**Scope correction deployed; real delivery and reviewer-budget acceptance remain open.** The
owner's 16:31 UTC complement was saved. Bob recorded depth 300 mm as provided
specification, created the shelf solution and approved Plan with a design Step.
The 20-minute job subsequently expired without a saved drawing. The original
request remained `needs_data` at revision 13 with null Area/Step/Artifact scope.
Journaled CAD calls tried the same request with the newly created Area and Step.
PostgreSQL logs from 16:35 UTC show repeated `drawing_scope_changed` / `40001` in
the request lifecycle wrapper, and the hosted API reports PostgREST 14.5.
[Supabase's documented PostgREST 14 retry defect](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)
explains why this deterministic rejection did not return promptly. No matching
active database process remained at inspection; no termination or user-data repair
was performed.

The focused fix returns original scope and same-ID recovery before additional
CAD work, bounds private request RPC transport, and translates only known drawing
application conflicts to `PT409`. Local regression checks cover changed scope,
corrected-scope continuation with new evidence, unchanged stored packet/revision,
stale-revision conflict, replayed write receipt, authority/reset/cancellation and
atomic CAD completion. Edge type checks pass. Full-suite/CI evidence is recorded
in the fix PR. These controlled tests do not prove actual HTTP retry behavior or
real model save/link delivery. The original expired turn must not be blindly
replayed after changing its execution path. The user authorised release and chose
a new same-thread test before the reviewer-budget discussion.

Release verification: [PR #182](https://github.com/EmelieHagander/Bob-the-builder/pull/182)
merged as `0aa458cfc00dde62e271da1c91c8bf2e2dc88b26`; final reviewed head
`733f9189bca96b749877bb4d06530e70b3cc37ea`, tree
`6bbb069b0859be6864e0d66a4fd36d4c560a9083`. [CI 37041235274](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37041235274)
passed 851/851 tests, Edge/vocabulary/build/PWA and all browser groups;
[PostgreSQL concurrency 37041235249](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37041235249)
and [CAD adapter 37041235233](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37041235233) passed.
The sharing browser gate was repaired to await finite entrance animations before
measuring the unchanged 44px requirement; final 320/390/1280 px checks pass.
Manual Vera/Archie prompt review; no independent subagent review is claimed.

Migration `20261002170009_drawing_request_conflict_response.sql` (SHA-256
`8498bf595a2bbfa4f75302cddb6b702ff4ae59f0ce389e2fdec124f993bdceca`)
was applied to `yuobtgoidmmmwfqenkau` as hosted ledger
`20261002175325 / drawing_request_conflict_response`. Hosted rollback-only
`check-cad-lineage-release.sql` passed exact `PT409`/message, unchanged packet and
revision, write replay, canonical save/read/detail/restoration and authority fences.
No synthetic users/projects remained. Definition readback confirms empty search
paths, the new service-only entrypoint and no service/browser execution grant on
the delegated helper. Security-advisor findings are unchanged from the preflight.

`bob-worker` v40 (existing capability authentication) and `ask-bob` v72 (JWT) are
ACTIVE and read back pinned to the merge above. Bundle hashes:
worker `c66b3a675eef67dfdd3e2c24eb1c03b3f20b8baa9745b18c05be12be23c91146`,
ask `835de088e5c35aee0307ee50d771baebc89c84f94ef4476eade573c39540b186`.
Both reject unauthorised HTTP requests with 401. This proves deployment and SQL
role behavior, not a real member's HTTP conflict or successful model delivery.
The user's request still had revision 17, original null scope and no saved receipt
after release; no user records were altered. At that release checkpoint the reviewer
remained mini/high/12,000; the later authorised configuration change is recorded above.


## P4 product acceptance — 2026-09-30

**First P4 pass released; whole P4 and UC-001–005 remain open.**
[PR #178](https://github.com/EmelieHagander/Bob-the-builder/pull/178) merged as
`5696728d9a21f9eae954a482de0a6a6c4a119399`. Final reviewed source
`7262e05c65c4ff648f48351cca75ef8a462f11b0` passed
[CI 36759787908](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36759787908):
**841/841**, vocabulary, Edge types, build/PWA and every browser group.
[CAD lineage concurrency 36759787986](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36759787986)
also passed. Review followed Vera's and Archie's prompts manually; no independent
steward subagent review is claimed. Chrome was unavailable locally, so browser
verification ran in CI. Artifact `11118631866` was downloaded and all three new
instruction screenshots inspected at 320/390/1280 px. Captions, purposes and
independent image placement fit; browser assertions separately prove decoded
fixture pixels, refresh, reload and revoked access. These tiny image fixtures
are not proof that a real construction photograph is usable on a phone.

`scripts/check-live-p4.mjs` runs bounded real read-only model scenarios and a
manual media/name-only participant HTTP scenario in new disposable projects.
Use `BOB_P4_LIVE_CONFIRM=disposable-fixtures-only`, the existing public Bob
configuration and `BOB_P4_GROUP=model|media|all`. `BOB_P4_CASES` selects named
model cases without repeating already accepted calls. No Auth users, privileges
or private named-member sessions are created. Inspect the report and remove only
its exact fixture projects after ordinary caller Storage cleanup.

The first six model replies cover a shelf (60 cm → corrected 71 cm), a bunk bed
with two unknown inputs (one later complemented to 650 mm), a porch with missing
foundation/load/attachment evidence, and a multi-room renovation with finished
work. All six mechanically pass real OpenAI, caller/project scope, exact source
IDs, Task focus, expected values and absence of writes. Manual review accepts
five replies and finds a porch defect: discussion of concept inputs becomes a
claim that a sketch already exists, despite zero saved Artifacts or images.
[The initial report](archive/p4-model-initial-2026-09-30.json) retains full
synthetic answers, sources and manual verdicts. The first generic clarification
still failed the [deployed retry](archive/p4-porch-first-retry-2026-09-30.json);
its mechanical pass did not close the finding. The final common rule requires
reading an output's saved record before calling it existing, and distinguishes
inputs from deliverables, within the **1000-word** permanent prompt ceiling.
The unchanged original porch scenario was rerun against final deployed source.
[Its reviewed answer](archive/p4-porch-final-2026-09-30.json) preserves estimated
concept dimensions and unknown foundation/load/attachment conditions without
claiming a saved sketch or completed work. This closes the reproduced existence
claim in this scenario; it does not establish a saved concept/manufacturing
delivery or the whole A17.

The media scenario reproduces a second defect through actual Auth, PostgREST and
Storage: the participant API flattens two instructions' images and loses their
individual placement. A full-schema regression fails before the correction and
passes after it. The additive migration preserves the legacy union, adds exact
instruction image lists and general context images, and retains capability/byte
authorization. The participant UI renders each list beside its instruction.
The hosted after-proof passes ordinary caller reserve/upload/finalise, absent
bytes rejection, idempotent retry, one original shared between two instructions,
replacement of only the first link, fresh caller readback, name-only participant
instruction placement, exact HTTP bytes with `no-store`, and RPC/HTTP denial
after individual-session revocation. Browser fixtures separately cover refresh
and reload at 320/390/1280 px. No Auth users or privileges were created.

The additive source migration
`20260930174127_volunteer_instruction_images.sql` was applied as
`20260930183122_bob_p4_volunteer_instruction_images`; source SHA-256 is
`fd6ccbbf2bf58ee4a71b76b080e1f3c9d9279f4fadd3e7598d4161267f7b2fc5`.
The private function retains its exact ACL, `SECURITY DEFINER` and empty
`search_path`. Bob-scoped security advisor findings are unchanged: 24 INFO
RPC/service-only tables and eight pre-existing WARN notices for intentionally
authenticated definer RPCs. There are no new Bob warnings or errors. The
[release evidence](archive/p4-live-release-2026-09-30.json) records exact names,
before/after findings and metadata; this is not a claim about other apps in the
shared database.

`ask-bob` **v70** and `bob-worker` **v38** bundle the immutable final reviewed
source above, retaining their respective JWT modes. Earlier v69/v37 supplied
the successful media proof and unsuccessful first porch retry; the image SQL/UI
is identical in final source. Readback verified both final wrapper files and
bundle hashes. [Pages 36761512308](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36761512308)
published the matching frontend. HTTP 200 and served asset
`/Bob-the-builder/assets/index-bPyr19Oz.js` confirm the new participant contract
at https://emeliehagander.github.io/Bob-the-builder/.
[Live Bob 36761512263](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36761512263)
also passes actual Auth/PostgREST/OpenAI source use, non-member 403, retired
endpoint 410, exact Task focus, real image pixels, versioned knowledge and absent
guest server history. It remains a guest release smoke, not private-member acceptance.

Cost comes from exact `bob.execution_events` turn IDs, not an invoice. The six
initial replies used 13 model calls, 109875 input / 6328 output tokens and
estimated **$0.184135**. Including both porch retries gives eight replies,
17 calls, 143503 input / 8105 output tokens and **$0.264908**. One extra early
setup reply brings the total P4 probe spend to 19 calls / **$0.301520**;
the automatic main release smoke is separate. No cost per accepted CAD delivery
is claimed. Before deleting any project, reports and accounting were captured,
ordinary caller commands removed its Storage bytes/metadata, and an operator
checked exact ID/name/type, sole guest Auth membership and absence of media,
objects, Artifacts and private threads. Only the ten printed P4 fixtures and
the newly printed release-smoke fixture were removed. Follow-up counts are zero
for their projects, people, Tasks/instructions, measurements, media, invitations,
sessions, private threads and objects; the smoke's material is also absent.

These are **partial** A02/A04/A05/A16/A17/A19 observations and UC-003/004
mechanics. They do not prove Bob-driven generation/save/link, complete A15/A20,
real mobile participant acceptance, field safety or a whole UC. P0/P3 acceptance
remains in the [shared todo](bob-delivery-flow.md#acceptans-todo). The remaining
model-driven save/link/complement, controlled failure/budget, private reset,
real mobile participant and multi-day replanning cases stay in
[active State](bob-delivery-flow.md#state). An existing verified ordinary member
session in a secure runner is still needed for the full writing/private-history
flows; the public guest cannot substitute for that acceptance role.

## September 24 work and drawing release

**Deployed 2026-09-24:** [PR 137](https://github.com/EmelieHagander/Bob-the-builder/pull/137)
and [PR 138](https://github.com/EmelieHagander/Bob-the-builder/pull/138) are merged.
The matching frontend is published by [Pages run 36059264359](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36059264359)
at merge `49ef0c7`. The served JavaScript contains the archive and volunteer drawing
readers. Backend release preceded frontend publication: `ask-bob` v37,
`bob-worker` v5 and `volunteer-media` v4 are active with their previous JWT modes.

| Source migration | Hosted migration |
|---|---|
| `20260924183706_review_workflow_integrity.sql` | `20260924210338_review_workflow_integrity` |
| `20260924183913_drawing_source_status.sql` | `20260924210348_drawing_source_status` |
| `20260924194300_area_archiving.sql` | `20260924210349_area_archiving` |
| `20260924195744_volunteer_task_drawings.sql` | `20260924210353_volunteer_task_drawings` |
| `20260924211243_bounded_drawing_source_planning.sql` | `20260924211354_bounded_drawing_source_planning` |
| `20260924211440_bounded_volunteer_drawing_planning.sql` | `20260924211512_bounded_volunteer_drawing_planning` |

The release check found PostgreSQL planner expansion that fixture correctness tests
had not exposed: even an empty Project drawing overview exceeded ten seconds.
The follow-up keeps exact-revision assessment behind a caller-RLS invoker function
and bounds join planning inside that function and the volunteer detail reader.
The same full empty overview then planned in 17.9 ms and executed in 1.9 ms.
No shared-database, role-wide or API timeout settings were changed.

Hosted checks used the member/anonymous database roles and a disposable participant
inside a transaction that was rolled back. Archive/restore, stale-write denial,
lifecycle audit, current saved parametric geometry, anonymous raw-table denial,
removed Step-link denial and capability revocation all passed. Final measured reads
were 365 ms for a member drawing, 141 ms for the volunteer list and 264 ms for its
detail. These are individual release observations, not a load benchmark. No Auth
account was created and a separate read confirmed zero leftover fixture Projects.
HTTP checks also confirmed `volunteer-media` denies an invalid capability (403),
and `ask-bob`/`bob-worker` deny unauthenticated calls (401).

The original final [CI run 36054103129](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36054103129)
passed 496 tests, Edge/build/PWA gates and every browser flow. Phone/desktop archive
and drawing screenshots were reviewed. The planning follow-up reran all 13 affected
database groups and adds direct-helper cross-project/anonymous denial checks.
Post-DDL security review found only the existing INFO notices for intentionally
RPC/service-only Bob tables, with no new Bob warning or error.

Both existing Projects still contain all 56 organised Tasks and zero unorganised
Tasks. Neither Project currently has a saved Artifact or CAD revision; deployment
does not itself create the owner's drawing. Real model-driven drawing creation,
real participant acceptance, authenticated browser/PostgREST acceptance and live
image Storage round trips are not established by the rollback SQL fixture.

## Household and project sharing — deployed foundation

**Read-only status check, 2026-09-24:** the sharing, account boundary and volunteer
migrations are present in the hosted ledger. They are also in `main`. This
supersedes the September 13–14 “prepared source, not deployed” status; it does not
claim a newly performed real household/friend/volunteer acceptance journey.
The [building model](building-model.md#111a-household-sharing-extension) and
[database contract](../db/README.md) own behavior.

| Source migration | Confirmed hosted migration |
|---|---|
| `20260913213712_household_project_sharing.sql` | `20260914172539_bob_household_project_sharing` |
| `20260913214355_household_account_sharing.sql` | `20260914172603_bob_household_account_sharing` |
| `20260914052752_volunteer_project_links.sql` | `20260914172820_bob_volunteer_project_links` |

The existing [CI run 36032936034](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36032936034)
passed the sharing and volunteer browser flows for the code merged into the
reviewed `main` (`6ee5405`). The new review corrections are tracked in
[PR 137](https://github.com/EmelieHagander/Bob-the-builder/pull/137); their source
migrations are now applied as recorded above. Real participant acceptance remains separate.

### Original implementation evidence — September 13–14

- All 98 tests passed at that implementation checkpoint after integrating the current material-planning main.
  Eleven new sharing/account groups
  replay the actual migrations in PGlite/Postgres with the shared household and
  Hearth friendship schema represented by fixtures. They cover opt-in building
  and project access, family editing, independent direct membership, exact-scope
  inheritance, revocation, pending/accepted/declined invitations, raw-write and
  internal-helper denial, stale choices, email/derived-crew transitions, last
  direct-member protection and guarded account binding.
- Four request-boundary tests cover auth/project changes before an RPC, delayed
  replies after switching away and back, mismatched resource read-back, missing
  authentication and an unavailable backend without false success.
- Seven volunteer database groups prove name-only joining creates no Auth or
  shared-family record, idempotent retry/resume, distinct same-name participants,
  optional allergy collection only with food, private self-only allergy responses,
  paged project-only reads, own task/attendance changes, required checks and
  separate volunteer completion provenance, stale-write rejection, exact media
  linkage, expiry, revocation and denied raw/management/internal-helper access.
  Two volunteer adapter groups prove no Auth/registration call and reject wrong
  project replies; two media HTTP groups prove denied bytes, bounded inputs,
  revocation during download, exact original bytes and no-cache responses.
  A browser-storage contract test proves that persistence contains only the
  separate access credential and confirmation flag, never names or allergies.
- The production TypeScript/Vite build and PWA checks pass. The browser verifier
  scripts pass syntax checks. The new `volunteer-media` function also passes Deno
  typechecking using installed dependencies (`--no-config --cached-only
  --node-modules-dir=manual`). The full Edge check passes in
  [CI 34823288170](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34823288170).
  Its local equivalent is blocked by a pre-existing `esm.sh` import in
  `openai-service.ts`.
- Local manual browser preview is blocked by this environment. The new
  `scripts/check-sharing-browser.mjs` and `scripts/check-volunteer-browser.mjs` are included in CI for production React and
  Supabase-client flows at 320, 390 and 1280px against HTTP fixtures.
  [PR 52](https://github.com/EmelieHagander/Bob-the-builder/pull/52) records the
  original CI/browser evidence. The current baseline is linked above. Household/friend browser checks pass in the run linked above; the
  volunteer check also waits for the refreshed server profile before asserting
  that removed food hides allergies. Screenshots accompany the workflow runs.

### Rollout and remaining live acceptance

For a new database, the original source sequence is:
`20260913213712_household_project_sharing.sql`, then
`20260913214355_household_account_sharing.sql`, then
`20260914052752_volunteer_project_links.sql`. These are already applied to the
hosted database under the identities above; do not replay or rewrite them. Read-only preflight found a pristine legacy account with no notes;
the migration rechecks this under a lock and never guesses its household. If
content appears before rollout, the account migration stops until an explicit
reviewed mapping is supplied. Normal Settings setup can bind only a pristine,
unbound account to a household the caller already actively belongs to.

A new environment needs the separate `volunteer-media` Edge function after its
migration and before the frontend. Its intentional `verify_jwt = false` route requires a valid,
unexpired volunteer capability for each request; no anonymous-Auth enablement or
new user registration is required. A hosted disposable volunteer check must show
unchanged Auth user counts, correct person/optional allergy persistence, original
image read-back, task/attendance/check behavior and denied access after revocation.
The initial September 24 read-only review did not perform those live fixture mutations,
create household grants or send real project invitations. The later work/drawing
release and its rollback-only SQL checks are recorded above. Fixture proof does not establish live cross-app Auth,
PostgREST, Storage or realtime behavior. After migration and frontend deployment,
verify with separately authorized household and friend identities that one
accepted project is visible, unrelated projects/account notes stay hidden, family
building edits persist and revoked access is denied on the next server request.

## Delivered deterministic material quantity (4B2b)

**Status:** first narrow 4B2b calculator implemented, merged, migrated, deployed and live-verified on 2026-09-14. [PR 54](https://github.com/EmelieHagander/Bob-the-builder/pull/54) merged as `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. [Material planning](material-planning.md) owns behavior and limits.

The shipped method is `stud_wall_net_area` / `4B2b-v1`. It reads one exact current `stud_wall_opening_v1` Artifact revision, derives `(wall width × wall height − opening width × opening height)` in square metres, normalizes upward only to the existing four-decimal requirement precision, and saves a normal `source_kind = deterministic` material-requirement revision with exact target/Artifact lineage and a server-authored formula/basis. Clients cannot supply the deterministic quantity, unit, basis, source or method identity. The calculation then reuses 4B2a allowance, matching-unit stock reservation, purchase rounding, staleness and explicit Shopping publish/update; it creates no parallel BOM store and invokes no AI.

### Automated, migration and advisor evidence

- [PR CI 34825559375](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34825559375) is fully green: all 73 PGlite/regression tests, TypeScript/Vite production build, PWA/install checks, Ask bob isolation, combined foundations browser proof and Building-context browser proof pass. The browser flow covers **Calculate from drawing**, deterministic source/basis read-back, revise/reload and the normal Shopping path at 320/390/1280px.
- Source migration `supabase/migrations/20260914084207_deterministic_material_quantities.sql` was applied to hosted Supabase as `20260914090502_bob_deterministic_material_quantities_4b2b`. Post-DDL security and performance advisors reported no new 4B2b-specific finding; unrelated pre-existing shared-database findings remain outside this release.

### Live Auth/PostgREST proof and deploy

[Pages 34826249816](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34826249816) and [live foundation check 34826249907](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34826249907) both pass on merged `main` commit `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. The ordinary authenticated foundation client consumes the already-persisted 4B1 geometry fixture and proves:

- current generated Artifact revision 4 uses the saved 4200 × 2400 mm wall and 1210 × 1200 mm opening, producing an exact/net persisted base of `8.628 m²`;
- 10% allowance becomes `9.4908 m²`; `2 m²` confirmed stock plus a `1 m²` purchase increment yields `8 m²` to buy;
- the saved revision persists `source_kind = deterministic`, `method_key = stud_wall_net_area`, `method_version = 4B2b-v1` and transparent formula text;
- a forged client `required_quantity` is rejected, an unsigned client is denied, and the disposable member cannot calculate against the real porch project;
- after the generated drawing advances, the requirement reports stale Artifact lineage and Shopping publish is rejected until recalculation;
- recalculation against current Artifact revision 6 creates requirement revision 2; with 0% allowance and the same `2 m²` stock, purchase need becomes `7 m²`;
- explicit Shopping update changes the linked row from `8 m²` to `7 m²` while preserving `delivered` status, supplier `Disposable sheet supplier` and cost `456 kr`.

The same run passes the existing media, steps, facts, solutions, drawings, manual material-planning and Building-context checks. No AI is invoked.

## Delivered manual material planning (4B2a)

**Status:** manual 4B2a implemented, merged, migrated, deployed and live-verified on 2026-09-14. [PR 39](https://github.com/EmelieHagander/Bob-the-builder/pull/39) merged as `1093fafbdbc5fc4ef0e477f0f6741c03bc3860b7`; verification-only [PR 50](https://github.com/EmelieHagander/Bob-the-builder/pull/50) merged as `fd737d45f1804245c31420037f8f12471302a7c5`. [Material planning](material-planning.md) owns behavior and limits.

### Automated, browser and hosted migration evidence

- Pre-merge [CI 34810364646](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34810364646) passes the full schema/domain, TypeScript/Vite, edge, PWA/install, Ask bob, foundation browser and Building-context suite. The Material plan proof runs inside the existing foundation harness at 320/390/1280px and covers stock/reuse, transparent arithmetic, explicit Shopping handoff, persisted delivered status, Update Shopping, reload and project isolation.
- Follow-up #50 [CI 34811122576](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34811122576) is fully green and regression-locks browser/live `method_key = manual` to the server SQL; it changes no schema, arithmetic, Shopping or UI behavior.
- Five additive source migrations were applied in order:

| Source migration | Hosted registry |
|---|---|
| `20260913210000_material_planning.sql` | `20260914053521_bob_material_planning_4b2a` |
| `20260913210100_material_planning_hardening.sql` | `20260914053538_bob_material_planning_4b2a_hardening` |
| `20260913210200_material_planning_publish.sql` | `20260914053605_bob_material_planning_4b2a_publish` |
| `20260913210300_material_planning_reservation_serialization.sql` | `20260914053620_bob_material_planning_4b2a_reservation_serialization` |
| `20260913210400_material_planning_fk_index.sql` | `20260914054215_bob_material_planning_4b2a_fk_index` |

Post-DDL security review reports no new 4B2a-specific security finding. Performance review found one new composite-parent FK covering-index opportunity; the fifth migration adds `material_requirement_revisions_parent_idx(requirement_id, project_id)` and the finding disappears on re-check. Expected fresh-unused-index notices and unrelated shared-database findings remain informational. See the [unindexed-FK remediation guide](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

### Live Auth/PostgREST proof, deploy and cleanup

The first post-merge live run [34810721689](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34810721689) reached the hosted material path and exposed verification drift only: runtime persisted `method_key = manual` while the proof expected `manual_base`. PR #50 aligned the fixtures with the already-deployed server truth and added a regression guard; no production schema/data behavior changed.

Final [Pages 34811372007](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34811372007) and [live foundation check 34811372088](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34811372088) pass on `main` commit `fd737d45f1804245c31420037f8f12471302a7c5`. Through the ordinary authenticated Bob client, the live material proof verifies exact target/drawing/stock/reuse lineage, `4 pcs → 1 stock → 2 reusable → 1 to buy`, a revised `2 to buy`, explicit Shopping publish/update with delivered status/supplier/cost preserved, independent Shopping-edit disclosure, stale-source publish rejection, raw-write denial and project isolation. No AI is invoked.

The shared foundation run also passes facts, solutions, deterministic geometry, drawings and Building context, removes image bytes/metadata/attachments through normal APIs and removes the temporary physical fixture through guarded physical-authority commands. Operator cleanup then deleted the two exact disposable verification projects from the initial proof-drift run and the final green run after checking exact nonce names/descriptions and zero media. A final query reports zero projects, material requirements, stock items, artifacts and media for those two fixture ids.

## Delivered deterministic artifact geometry (4B1)

**Status:** narrow 4B1 implemented, merged, migrated, deployed and live-verified on 2026-09-13. [PR 47](https://github.com/EmelieHagander/Bob-the-builder/pull/47) delivered the generator and persistence; [PR 49](https://github.com/EmelieHagander/Bob-the-builder/pull/49) closed the hosted release proof. [Plans and drawings](artifacts.md) owns geometry behavior and limits.

The release stores deterministic `stud_wall_opening_v1` recipes in `artifact_generations` plus six exact role-mapped `artifact_geometry_inputs`. It pins Building, accepted Space revision, exact Measurement revisions and explicit stud spacing; unknown dimensions fail, estimated inputs remain concept-only, and regeneration creates a new Artifact revision rather than rewriting history. SVG/vector output is recomputed from the versioned recipe; raster output is not truth. It does not itself claim general CAD/BIM or structural header/load-path sizing. The downstream first 4B2b net-wall-area material quantity is delivered separately through the material-planning foundation above.

Source migrations map to hosted history as follows:

| Source migration | Hosted registry |
|---|---|
| `20260913193000_artifact_deterministic_geometry.sql` | `20260913212211_bob_artifact_deterministic_geometry` |
| `20260913193100_artifact_geometry_command_grant.sql` | `20260913212218_bob_artifact_geometry_command_grant` |
| `20260913193200_artifact_geometry_invariants.sql` | `20260913212229_bob_artifact_geometry_invariants` |
| `20260913194000_artifact_generation_space_revision_index.sql` | `20260913213315_bob_artifact_generation_space_revision_index` |

The implementation branch's full CI/browser gate [34775629980](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34775629980) is green. Final [Pages 34784328229](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34784328229) and [live foundation check 34784328249](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34784328249) pass on the 4B1 live-proof `main`. The ordinary Auth/PostgREST run verifies persistent Space target, six exact measurements, recipe read-back, raw-write/RLS denial, unknown/out-of-bounds rejection, regeneration history and archive/restore carry-forward, then detaches its stable physical verification fixture. No AI is invoked.

## Delivered persistent building context (2C)

**Status:** manual 2C implemented, merged, migrated, deployed and live-verified on
2026-09-13. Backend/domain [PR 42](https://github.com/EmelieHagander/Bob-the-builder/pull/42)
merged as `d5dce52e531c271a54d0dbb28a55765d271c1e9b`; app/UI
[PR 43](https://github.com/EmelieHagander/Bob-the-builder/pull/43) merged as
`126a322f9ac59bc110525e2bb7ecd0575d24c3fa`. Hosted cleanup-order follow-up
[PR 45](https://github.com/EmelieHagander/Bob-the-builder/pull/45) merged as
`2562d15b4ffa99b53d15682c24010b87b81f2dbf`. The
[building-model contract](building-model.md) owns Site/Building/Level/Space,
BuildingElement/topology, physical authority, Project/Area scope, accepted/proposed
history and exact measurement-snapshot semantics.

### Automated and browser evidence

- Backend [CI 34762221631](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34762221631)
  passes on the final #42 head. The repository has 42 passing database/data-boundary
  tests, including all four building-model fixtures plus stale/raw/forged authority,
  Area mapping/lifecycle and physical deletion-boundary checks. TypeScript/Vite,
  edge, PWA/install and existing foundation/browser checks also pass.
- UI [CI 34769797360](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34769797360)
  passes on #43 head `74a270d92f8827ebe5b69ac696601ef2f4ae42a7`. The dedicated Building-context
  browser proof passes at 320, 390 and 1280px: create Building; start with one Space;
  project-link; reload/read-back; add a second Space + relationship; switch Buildings
  without stale detail; switch Project; and render explicit denied state instead of
  misrepresenting unread physical context as an empty building.

### Deployment and hosted migration history

Five additive source migrations make up the released 2C database change. Hosted
history records the same changes under deployment timestamps; do not replay the
source timestamps or edit already-applied migrations:

| Source migration | Hosted registry |
|---|---|
| `20260913124500_persistent_building_context.sql` | `20260913141333_bob_persistent_building_context` |
| `20260913135500_expose_physical_proposal_state.sql` | `20260913141342_bob_expose_physical_proposal_state` |
| `20260913140500_physical_identity_delete_boundary.sql` | `20260913141357_bob_physical_identity_delete_boundary` |
| `20260913143000_building_context_fk_indexes.sql` | `20260913142013_bob_building_context_fk_indexes` |
| `20260913144500_building_delete_child_order.sql` | `20260913143018_bob_building_delete_child_order` |

The core migration is additive: existing Areas, measurements, components, solutions
and artifacts are not rewritten. Normal clients read RLS-protected tables through
security-invoker views and mutate physical truth only through guarded `bob.physical_*`
commands. Private authority helpers stay in `bob_private` with explicit execute ACLs.

Post-DDL advisor review introduced the dedicated FK-index follow-up above. The final
security advisor reports no new 2C-specific security finding. The performance advisor
still reports INFO-level covering-index opportunities on several accepted-revision /
composite physical foreign keys plus expected fresh-unused-index notices; these are
performance follow-ups, not release-authority failures. See the
[unindexed-FK remediation guide](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

### Live Auth/PostgREST proof and cleanup

[Live foundation check 34762945539](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34762945539)
passes on `main` after the cleanup-order fix. Through the ordinary authenticated Bob
client it proves persistent Site/Building/Level/Spaces, project and Area scope,
topology, an exact Measurement snapshot, accepted current vs proposal state, explicit
acceptance/history, RLS and raw-write denial. No AI is invoked.

The same run then unlinks project context and removes the disposable physical fixture
through the normal guarded authority commands. The log explicitly confirms
`Live building context fixture removed through guarded physical-authority commands.`
No test Building/Site is left behind by the verifier.

The current merged UI is also deployed: [Pages 34773319558](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34773319558)
passes for current `main` commit `b1c11f194d286775c6125eac46ad894b429bfdc8`.
Area-side physical-target editing remains a later narrow UI follow-up; backend Area
mapping is already covered by database and hosted live checks. Whole-plan import,
generated geometry and AI/vision consumption remain later gates and are not implied
by this 2C release.

## Delivered manual plans and drawings (4A)

**Status:** manual 4A implemented, merged, migrated and live-verified on
2026-09-13. [PR 31](https://github.com/EmelieHagander/Bob-the-builder/pull/31)
merged as `18994f688bccf12c6cb9a63dee66ff46ddccb21b`. The
[artifacts contract](artifacts.md) owns manual plans/drawings, exact target and
measurement lineage, revision history and status semantics. Deterministic drawing
generation, BOM/stock/shopping and task-readiness work remain later Slice 4/5 gates;
this does not close full Slice 4 or V1.

### Automated evidence

- All 35 database/data-boundary tests pass in
  [CI 34504663236](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34504663236)
  on feature head `04b2207e1d930ebe2dbc16bf74a80b93a9c2d138`. Five 4A tests execute the
  actual artifact migration/RLS and cover exact target/measurement revisions,
  stale-target and stale-artifact rejection, cross-project relation denial,
  append-only lineage/actor protection, archive/restore, area/project deletion and
  delayed project-switch results.
- TypeScript/Vite, edge, PWA/install and existing Ask bob isolation checks pass.
- `scripts/artifacts-browser.mjs` extends the existing production-frontend
  foundation harness at 320, 390 and 1280px. It proves manual create, exact
  measurement/image selection, selected-target lineage, visibly stale old drawings,
  conflict input recovery, new revisions, old-version history, archive/restore,
  reload, paging, 44px actions and project switching. Earlier images/steps/facts/
  solutions remain green in the same harness.
- Verification-only follow-ups
  [PR 35](https://github.com/EmelieHagander/Bob-the-builder/pull/35) and
  [PR 37](https://github.com/EmelieHagander/Bob-the-builder/pull/37) make the
  composed browser/live cleanup proofs tolerate legitimate downstream revisions;
  they change no product schema, UI or AI behavior. Their full CI runs
  [34752091765](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752091765)
  and [34752480811](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752480811)
  pass the complete foundation/browser suite.

### Deployment and live proof

Source migration: `supabase/migrations/20260910180000_project_artifacts.sql`.
It was applied to the Bob deployment on 2026-09-13; hosted history records the
same applied change as `20260913101509_bob_project_artifacts`. Do not replay the
authoring timestamp or edit the applied migration.

The migration adds `artifacts`, `artifact_revisions` and `artifact_measurements`,
plus invoker views `current_artifacts` and `artifact_measurement_details` and the
guarded `artifact_command` seam. Post-migration inspection found no new artifact
security findings and no missing artifact foreign-key indexes; fresh unused-index
notices are informational before real workload. The new artifact tables were empty
before disposable live verification. Existing Bob project/fact/solution/media rows
remained present; this release did not claim a new full-row checksum baseline.

[Pages 34752619338](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752619338)
and [live foundation check 34752619293](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752619293)
pass on final `main` commit `6a927fb60d446c1bf409a5a91ebda4442a2d6bdd`.
The live check uses the ordinary guest Auth client and one disposable project. It
proves the existing image/step/fact/solution chain plus 4A drawings with exact
selected-target/solution/measurement lineage, later-measurement disclosure,
stale target/revision denial, server attribution, archive/restore and denied access
to the real porch project. No AI is invoked.

After normal Storage API removal, measurement, solution and all four drawing
revisions retain their recorded image titles while file references are null. The
solution decision trail and later drawing target decisions remain readable. The log
confirms complete API cleanup of image bytes, metadata and attachments. The operator
then removed only disposable project `p_3a5cdd967ffe4781852410d6c36826dd`, guarded
by nonce `6cd37239-e7aa-4baf-bc87-6ed95ad60162`, exact generated project name and
zero remaining media rows. Storage object metadata was not deleted with SQL.

## Delivered solution alternatives and selected target (3A)

**Status:** manual 3A implemented, merged and deployed on 2026-09-10.
[PR 30](https://github.com/EmelieHagander/Bob-the-builder/pull/30) merged as
`e0562f74d45ed68705948de6f034c73ccbfbe6a5`. The
[solutions contract](solutions.md) owns alternatives, exact measurement evidence,
reference images and project target decisions. Generated proposals/mockups remain
the later 3B gate; this does not close full Slice 3 or V1.

### Automated evidence

- All 30 tests pass locally and in
  [CI 34497470612](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34497470612)
  on feature head `621679ce325fa137590da916e24aa82b0042c316`.
  Eight new checks execute the actual SQL/RLS or data boundary: coexisting
  alternatives, pinned target/evidence, stale edits/decisions, retained selection
  history, anonymous/outsider/dual-project authority, immutable parents/actors,
  atomic invalid-input rejection, archive/restore, file/area/project cleanup and
  delayed decision responses after a project switch.
- TypeScript/Vite, edge, PWA/install and existing Ask bob isolation checks pass.
- `scripts/solutions-browser.mjs` extends the production-frontend foundation
  harness at 320, 390 and 1280px using HTTP fixtures. All widths pass alternative
  creation, reference original viewing, exact measurement links, selected-version
  retention after revision, changed-measurement disclosure, old-version viewing,
  failed-decision input recovery, target replacement/clearing, archive/restore,
  decision history, reload, paging, 44px actions and project switching.
  The picker test waits for the first page to load before deciding to paginate.
  Earlier images/steps/measurements/parts also pass at all three widths.
  Screenshots remain automated CI artifacts, not a manual authenticated phone trial.

### Deployment and live proof

Source migration:
`supabase/migrations/20260910152455_solutions_and_selected_target.sql`.
Applied before its frontend; hosted history records it as
`20260910154029_bob_solutions_and_selected_target`. Do not replay the authoring
timestamp or modify the applied migration. Five new tables have RLS and three
views use invoker authority. No new security or missing-FK-index findings were
reported; unused fresh indexes are informational.

[Pages 34497811576](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34497811576)
and [live foundation check 34497811595](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34497811595)
pass on the merge. `scripts/check-live-solutions.mjs` uses the existing foundation
check's ordinary guest Auth client and single disposable project. It proves two
alternatives, a pinned selected solution version, an earlier estimated measurement
with its newer measured revision visible, stale/forged/raw-write denial, selected
archive denial, archive/restore, three target decisions and denied real-project
access. The existing live images/steps/facts checks also pass. No AI is invoked.

After normal Storage API removal, all four revisions of the first alternative
retain the image title and content with null file references. Its decision trail
remains readable. The log confirms complete API cleanup of image bytes, metadata
and attachments. The operator then removed only disposable project
`p_b848cd705477450f8b9c7ee81d44af9a`, guarded by nonce
`bbecf9fa-bd23-4868-8d20-83f02cc9807b`, exact name/description, sole guest membership
and absence of remaining media/objects. Cascades removed its solution, target and
evidence history. Storage object metadata was not deleted with SQL.

Final checks find two real projects, 36 tasks, two membership rows, 21 measurements
and their 21 revisions, five existing parts and their five revisions. All six
full-row checksums below match preflight and the check immediately after migration.
The 74 task steps now present belong to the retained real projects; no claim about
a preflight step checksum is made. No verification project, solution, target,
solution-evidence link or verification history remains. Project media metadata,
links and private-bucket object counts are zero.

| Preserved table | Rows | Full-row checksum |
|---|---:|---|
| `tasks` | 36 | `704d5cd43312a57ef70d010fb6e34b41` |
| `people` | 2 | `dd2453a80a1391f3b9b2286d4c262454` |
| `measurements` | 21 | `4af93fb4db14cc82cdd95b695a2ca0b7` |
| `measurement_revisions` | 21 | `9c86061c39f79216ac1984ada3e4b6a2` |
| `existing_components` | 5 | `888f10817d41bf2b3ed93226380d1b9b` |
| `component_revisions` | 5 | `80f9fd8115b3bb426e2ff8f72cac8f88` |

Checksum convention: `md5(string_agg(to_jsonb(row)::text, '' order by id))`.
The following dated sections preserve the earlier release evidence.

## Delivered measurements and existing components (2A/2B)

**Status:** manual milestones 2A and 2B implemented, merged and deployed on
2026-09-09. The [project facts contract](project-facts.md) owns behavior.
[PR 29](https://github.com/EmelieHagander/Bob-the-builder/pull/29) merged as
`6b3b3667050d82608abb982f9c8292204593bcbb`. Manual records are available from
Dashboard/Area; Bob/vision consumers and full Slice 2 remain later gates.

### Automated evidence

- All 22 tests pass locally and in
  [CI 34414133902](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34414133902)
  on feature head `5abc1f8b8c8a90e0af0d389b3c62cd95a283bfd5`.
  Eight new tests cover decimal input, exact length conversion, unknown vs known
  values, retained provenance/history, same-project parents and source images,
  actor/raw-write denial, stale edits, archive/restore, deletion/revocation and
  rejection of delayed writes after project switching. SQL/RLS checks execute the
  actual new migration in PGlite/Postgres.
- TypeScript/Vite, edge, PWA/install and existing Ask bob isolation checks pass.
- `scripts/project-facts-browser.mjs` extends the existing foundation harness.
  The production frontend and Supabase client pass at 320, 390 and 1280px against
  HTTP fixtures: unknown → estimate → measured, exact units/source image, To measure
  filtering, history, original viewing, reload, stale-save input recovery, existing
  part creation/archive/restore, linked dimensions, paging and project switching.
  Earlier upload/step flows also pass at all three widths. Screenshots are retained
  as CI artifacts; this is automated browser evidence, not a manual device trial.
- Browser findings fixed shared native-control labels, modals trapped below mobile
  navigation by a transformed page, and unfinished-upload recovery in the source
  picker. Geometry checks wait for page animations; pagination checks await the
  changed rows. The 44px action-target requirement remains intact.

### Deployed database and frontend

Source migration:
`supabase/migrations/20260909221503_measurements_and_existing_components.sql`.
Applied before the frontend; hosted history records the same change as
`20260909224644_bob_measurements_and_existing_components`. Do not replay the
authoring timestamp or edit an already applied migration.

All four new tables have RLS; both current-revision views use invoker authority.
New relations have no security-advisor findings and no missing foreign-key indexes.
Fresh unused-index notices are informational. Original task and membership row
checksums match before deployment and after disposable-fixture cleanup.
[Pages 34414587303](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34414587303)
successfully deploys the merge.

### Live Auth, PostgREST and Storage

[Live foundation release check 34414587288](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34414587288)
passes on the merge. `scripts/check-live-project-facts.mjs` runs inside the existing
image/step check's single disposable project, using the ordinary guest Auth client.
It proves three measurement revisions (unknown, 1.25 m estimate, 1254 mm measured),
exact conversion, linked component dimensions, server attribution, stale/invalid
write denial, component count/intent/archive/restore and denied real-project access.
The full original-byte Storage and illustrated-step checks also pass. No AI is invoked.

After Storage API removal, current records and all three measurement revisions
have null file references while keeping the recorded image title and values/history.
The log confirms complete API cleanup of image bytes, metadata and attachments.
The operator then removed only the printed disposable project
`p_cc2ce9f8ca25476e827bc19e8231a249`, matching nonce
`0039ddaf-a938-4500-85f3-c1e1ce8f6e42`, its exact name/description, sole guest
membership and absence of remaining images/objects. Related facts and revisions
cascaded with that fixture. Storage metadata was not deleted with SQL.

Final read-only checks find the original two projects, 36 tasks, two members,
seven areas, 71 materials and five reference labels. No verification projects,
image bytes/metadata/links, steps, measurements/components or revisions remain
from the fixture. Full-row task checksum `704d5cd43312a57ef70d010fb6e34b41` and
membership checksum `dd2453a80a1391f3b9b2286d4c262454` match preflight.
Both use `md5(string_agg(to_jsonb(row)::text, '' order by id))`; this release's task
checksum includes the instructions column already delivered by 1A/1B.

## Delivered image and step foundation (1A/1B)

**Status:** 1A and 1B implemented, merged and deployed on 2026-09-09.
The [media/step contract](media-and-steps.md) owns behavior. This file owns the
implementation and deployment evidence. Vision remains the later 1C gate;
completing the manual foundation does not close full Slice 1 or the V1 release.

- [PR 27](https://github.com/EmelieHagander/Bob-the-builder/pull/27) records the
  owner's foundations-first delivery order.
- [PR 28](https://github.com/EmelieHagander/Bob-the-builder/pull/28) delivers private
  project images and manual illustrated task steps; merge `c14a4a282a351db3d1e6158f8aed109fe6f12353`.
- Follow-up `fa363071709bbd03b6aeda766eccc32f31991d6c` repairs the PNG verification
  fixture's chunk CRC. It changes test data only, not application or database behavior.

### 1A/1B automated evidence

- All 14 tests pass locally and in
  [CI 34408699848](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34408699848)
  on feature head `b76e9c16e8d3012aed4a2c8fdc6e28c7fc4dd81e`.
  Five tests execute the actual new migration and policies
  in PGlite/Postgres, including deliberately broad pre-existing Storage policies.
- Covered: project/actor boundaries, two-project relation checks, immutable fields,
  reserved uploads, metadata readiness, retries/deletion, membership revocation,
  private-bucket configuration, manual instructions, step ordering/stale edits,
  required checks and keeping original images after detaching/removing steps.
- TypeScript and Vite production build pass.
- `scripts/check-foundations-browser.mjs` drives the production UI and Supabase
  client at 320, 390 and 1280px against HTTP fixtures. All three widths pass:
  upload and original viewing, existing-image attachment, task instructions,
  step editing/order/required completion, persistence after reload, pending-upload
  recovery and project switching while an old image download is in flight.
  Screenshot files are retained as CI artifacts; this is automated browser proof.
- Existing project-switch/Ask bob isolation, install/PWA and edge-function checks
  also pass in that CI run. The new flows make no AI request.
- Browser verification exposed a shared-auth observer bug on reload. The data layer
  now fans out one SDK subscription: mounting another view does not create a new
  initial-session event that incorrectly cancels a current project read.

### 1A/1B deployed database and frontend

Source migration: `supabase/migrations/20260909210642_media_and_task_steps.sql`.
It was applied before the frontend. Hosted history records the same change as
`20260909214606_bob_media_and_task_steps`. Do not replay it under the CLI authoring
timestamp or edit an already applied migration.

- The private `bob-project-media` bucket is deployed with a 6 MiB limit and
  JPEG/PNG/WebP MIME allowlist. All three new domain tables have RLS enabled.
- The original two projects and 36 tasks are preserved. Checksums of the original
  task columns (excluding the added empty instructions column) and existing
  membership rows are identical before and after the additive migration.
- Security review reports no findings on the new Bob tables; all their foreign
  keys have covering indexes. Existing shared-database objects and the public
  app-asset bucket retain their roles.
- Production Pages deployment passes for the merge
  ([34409006000](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34409006000))
  and fixture follow-up
  ([34409586992](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34409586992)).

### 1A/1B live Auth, PostgREST and Storage

[Live foundation release check 34409586950](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34409586950)
passes on `fa363071709bbd03b6aeda766eccc32f31991d6c`. A valid PNG was uploaded,
read back byte for byte and removed through the deployed Storage API. The log
records successful domain/access checks and complete image cleanup. An earlier
run also passed the API checks; the final run uses the corrected PNG fixture.

`scripts/check-live-foundations.mjs` verifies real Auth, PostgREST and Storage with
the existing public guest account in a newly created disposable project. It checks
original-byte read-back, denied public/anonymous access, immutable uploads, actual
embedded links, persisted instructions/steps, required checks and deletion recovery.
It does not invoke AI or grant the guest access to real projects.

The script removes its image bytes via Storage and then metadata/links via the
domain command, including after failure. Client project deletion remains
unavailable, so the operator removes only the exact printed disposable project
after verifying its name, description, sole guest membership and absence of
remaining image metadata or objects. Storage objects are never deleted with SQL.

Both disposable verification projects have been removed after successful API file
cleanup. Final checks find only the two original projects, 36 tasks, two members,
seven areas, 71 materials and five legacy reference labels. No verification
projects, image objects, media metadata/links or steps remain. Original task and
membership checksums still match the preflight after this cleanup.

Checksum convention: `md5(string_agg(row_json::text, '' order by id))`, with
`row_json = to_jsonb(task) - 'instructions'` for original task fields and
`row_json = to_jsonb(person)` for membership rows.

## Evidence limits

PGlite checks actual SQL/RLS but emulates Storage metadata rows; it is not an object
storage server. Browser checks use HTTP fixtures and cannot prove deployed Storage.
The live API script provides that separate deployed-service proof. Do not describe
fixture screenshots as a manual authenticated walkthrough on the owner's phone.
No owner Bob/vision trial was required. Vision, AI consumption of the manual
foundations, generated proposals/guidance, deterministic drawing generation,
calculations, BOM/stock/shopping and full progress/as-built history remain later
scope. Manual 1A/1B, 2A/2B, 3A and 4A completion does not close full Slices 1–4
or the V1 release.

## P3 local release preparation — 2026-09-30

This earlier checkpoint is superseded by the [hosted technical release](#p3-hosted-technical-release--2026-09-30) below.

Source commit `84f9ded` on `feat/p3-grounded-context-20260930` is a prepared release, not hosted runtime evidence. Separate Archie, Vera and backend subagents reviewed the changes. Their findings were fixed: freshness checks now run before each executed tool call within a model batch; drawing destination labels use the matching canonical Step; context errors describe page/project changes and explicit retry.

`npm test` passed **837/837**, including a reproduced negative regression for a concurrent focus mutation between two tool calls and positive receipt-based continuation. Production build, vocabulary check, PWA checks, changed-script syntax and diff whitespace checks passed. The focused current-view run passed 35 tests. Local `check:edge` was blocked by unavailable network access to `esm.sh`; Chrome is absent. Deno and rendered desktop/mobile/reload verification must run in CI. No hosted migration, Edge function or frontend release was made in this preparation pass.

`scripts/check-live-bob.mjs` now includes a disposable ordinary Auth/HTTP/model acceptance probe: caller-hydrated Task focus, actual pixels from a neutrally titled color fixture, the deployed versioned timber knowledge package, and private answer readback. It removes the image through ordinary caller commands. This probe is prepared but has not run. Fixture projects printed by the workflow still require operator cleanup.

The user subsequently directly authorized the exact GitHub destination, merge and Supabase release. [PR #177](https://github.com/EmelieHagander/Bob-the-builder/pull/177) is published. [CI 36731702358](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36731702358) on head `4d1ebf9` passed **838/838** tests, Edge types, build, PWA, every browser group except foundations, and conversation reset/recovery at all three widths. CAD adapter and lineage concurrency also passed. The remaining foundations failure was a historical-version fixture changing its server head while navigating to the already-open URL; the explicit reload correction still requires a green run and complete rendered source-map/version review. At that checkpoint, no hosted migration or deployment had been made. [State](bob-delivery-flow.md#state) contains the remaining release gates.

## P3 hosted technical release — 2026-09-30

[CI 36733424417](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36733424417) on `58ee8c6185858f33018a9400393ebe08d770b536` passed **838/838**, Edge types, build, vocabulary/PWA and all browser groups. CAD adapter and lineage concurrency also passed. Vera downloaded artifact `11107245713` and inspected 21 P3 screenshots across 320/390/1280 px: request complements, current view, frozen retry, parameter sources, historical versions, changed sources and withheld sources. Browser assertions verify v1 against newer v2 after reload, nested-dialog keyboard behavior and revoked identities. Historical-version PNGs partly caught the entrance animation; the assertions and static source screenshots provide separate evidence. These are intercepted HTTP/provider fixtures, not a named-member live walkthrough.

Migration `20260930112431_bob_p3_context_and_source_changes.sql` (SHA-256 `bc4c736b7e4e1e2686c82b4dddb1ba293d92727891c12a80c21f618918eaf71e`) was applied only to project `yuobtgoidmmmwfqenkau`, recorded as `20260930151621` / `bob_p3_context_and_source_changes`. Its exact existing prerequisites were checked before application. A hosted `BEGIN … ROLLBACK` fixture using an existing verified non-guest actor passed authenticated empty/missing and denied RPCs, service-only private capture, preserved omission, rejection of a changed pointer and anonymous permission checks. No fixture rows or Auth users persist. This uses SQL roles; it does not prove actual named-member Auth or HTTP recovery. Readback confirms private-screen RLS and invoker source-delta/request-list definitions. The advisor's no-policy INFO for private screens is expected because direct row access is intentionally revoked.

`ask-bob` **v68**, JWT verification enabled, and `bob-worker` **v36**, its existing capability-authenticated JWT setting retained, are ACTIVE. Both immutable wrappers and bundled hashes were read back against reviewed `58ee8c6`. The correction on `49e26b8` only fixes the guest live-test expectation; runtime code is unchanged.

The public guest is deliberately local-only. The ordinary guest probe must prove focused model/image/knowledge use and absence of private server history, not private-member persistence. A separate `scripts/check-live-p3-member.mjs` is prepared for an existing verified named session: durable Task focus, caller-private transcript and an idempotent completed-turn re-read. It requires secure runner configuration, never credentials in chat, Auth-user creation or privileged token generation. Syntax and reused named-session preflight checks pass; the actual named-session run remains unavailable. P3 therefore retains that acceptance gate even after technical deployment. P0 and P4 remain open.

[PR #177](https://github.com/EmelieHagander/Bob-the-builder/pull/177) merged as `e10b7c5edcfdad07ddada739dec304ca471d965c` after [CI 36735424164](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36735424164) passed on final head `49e26b8`. [Pages 36736996739](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36736996739) deployed successfully to https://emeliehagander.github.io/Bob-the-builder/. [Live Bob 36736996841](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36736996841) passed actual Auth/member-scoped PostgREST/OpenAI source disclosure, non-member 403, retired endpoint 410, exact P3 Task focus, real image pixels, `timber.moisture` version `2026-09-30.1` and absent guest server history. The image was removed through ordinary caller Storage/domain commands. Operator cleanup verified the exact printed project `p_82ce0d2c0f1049d9b81e8ed45cda5bc9`, its nonce/name/description, sole guest membership and absent media/objects/threads before deleting only that fixture. Subsequent counts for project, members, Tasks, materials, media and image objects are all zero.

To run the remaining named-member gate, provide `VITE_SUPABASE_URL`, publishable `VITE_SUPABASE_ANON_KEY`, `BOB_TEST_MEMBER_ID` and `BOB_TEST_MEMBER_ACCESS_TOKEN` only through a secure runner environment, then run `BOB_P3_LIVE_CONFIRM=disposable-fixtures-only node scripts/check-live-p3-member.mjs`. The existing verified session must have at least ten minutes remaining. The probe creates/logs one disposable project, bounds HTTP/polling, neither refreshes nor revokes the session, and does not create users or change permissions. Its exact printed project requires operator cleanup afterward. No ordinary named-member acceptance result is claimed.


## Mobile project overview and observed P4 run — 2026-10-01

The requested UI corrections use existing account, project-edit and physical
record boundaries: explicit Close project persists across reload; account routes
work without an active Project; shared name-only creation leaves details/dates for
later; account navigation hides the project composer while preserving its draft;
the project creation modal renders above the drawer. Space notes are expandable and retained
verbatim, with uncertainty/proposal labels still visible.

Local **841/841** Node tests, production build, vocabulary and PWA checks pass.
Chrome is absent locally and Edge fetching is blocked by `esm.sh` connection
refusal. [CI 36903372558](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36903372558)
on final source `ba7ba91df3a8ad61f71e44ebe080ab07729930c8` passes all 841 tests,
Edge types, build, vocabulary/PWA and every browser group. Fifteen screenshots
from artifact `11183281581` were manually inspected at 320/390/1280 px: creation
with/without an active Project, projectless Account, collapsed/expanded room notes.
Assertions separately prove reload, unobscured controls, draft/notes preservation
and the existing drawing → Bob flow. These are HTTP/provider fixtures, not an
owner's phone or live model trial. Review follows Vera/Archie instructions
manually, not independent subagents.

[PR #179](https://github.com/EmelieHagander/Bob-the-builder/pull/179) merged as
`98e05d075e8f66031eb6455a440524e1945e573c`.
[Pages 36905083409](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36905083409)
deployed successfully to https://emeliehagander.github.io/Bob-the-builder/.
This is a frontend release; no hosted migration or Edge deployment was performed.

A read-only inspection of the user's running incomplete-depth shelf test observed
one worker fail with `continuation_changed` after 21 claims, followed by a completed
recovery response. The canonical request is `needs_data`, revision 13, without a
saved Artifact receipt. The assessment retains supplied 600 mm width and 800 mm
height and identifies owner-chosen depth as the remaining blocker. The recovery
answer points at the request instead of asking that concrete question. This is
an open A02/A03/A10 finding, not accepted end-to-end delivery. No retry, cancellation,
reset, credential generation or alteration of user records was performed.
Private transcript, Auth identities and record IDs are deliberately not copied
into repository evidence. Content-free metrics total 20 model calls, 441,790 input
tokens, 22,887 output tokens and estimated $0.587227.
Full complement → saved drawing → Step link → reload
and participant access remain unverified. Next action belongs in
[State](bob-delivery-flow.md#state).


## P4 replay and event delivery — 2026-10-02

A fresh read of the observed owner's request finds the same `needs_data` revision,
no saved receipt and no newer complement. The required depth decision is still
missing. No user job was restarted, modified or cancelled during investigation.

A directed regression reproduces `continuation_changed` when a lifecycle work
read changes its revision/budget between worker segments. Checkpointing these
caller reads and commands makes replay reuse the recorded model result; fresh
cancellation still rejects subsequent work. This proves that code defect and its
repair, not the exact historical divergence: the failed original job's journal
was already cleaned up. Mismatch logs now include only the operation key to make
a later occurrence diagnosable without exposing private input.

The SQL event completion previously discarded the runtime answer for a generic
notice. The new service-only completion command delivers its exact private answer
and derives evidence from the canonical receipt. Full-schema tests cover unchanged
intake, replacement of the compatibility notice, one assistant message, original
user state, stale/duplicate claims, browser denial, cancellation and revocation.
Language tests preserve all gaps, technical failures, worker yields and access
loss. Separate existing tests own saved Artifact/Step identity, version readback,
source rejection, duplicate write recovery and participant isolation.

[PR #180](https://github.com/EmelieHagander/Bob-the-builder/pull/180) final head
`3c3c6d9070d0098709d753fc94a20d902756b10b` passes
[CI 36996298558](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36996298558):
845/845 tests, vocabulary, Edge types, build, PWA and all browser groups.
[PostgreSQL concurrency 36996298574](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36996298574)
passes. Merge is `fcb95d35ed9359602821ca3d8816fafc83c59167`.
Artifact `11222605514` contains the final screenshots; manual inspection covers
`drawing-requests` and `bob-frozen-page-retry` at 320/390/1280 px (six images).
These are intercepted UI fixtures, not the owner's live CAD result.

The additive source migration `20261002102040_p4_drawing_event_delivery.sql`
(SHA-256 `c8fabba0e6e2c7008b315edaa1323f1c8c4430df1ea78a57a5a8e2e77b5825bc`)
is applied to `yuobtgoidmmmwfqenkau` as ledger `20261002104656`, name
`p4_drawing_event_delivery`. A fresh preflight found zero active Bob jobs.
Hosted readback confirms both invoker/definer commands have an empty search path,
service-only execute and no anonymous/member execute. Bob-scoped security
advisors remain unchanged: 24 INFO and eight existing WARN; no new warning/error.

`bob-worker` v39 and `ask-bob` v71 are ACTIVE, pinned to the merge above with their
existing JWT modes. Wrapper readback confirms the exact source; bundle hashes
are respectively `53b07cfa40ece6ad70e44ac0d3a5e25ada846c3e30ad6dbe76565effc9518c83`
and `9b7d6a181059ecf538c651c24f38f9e17b2fd17557773c195d4f50cac7863916`.
Both unauthenticated POST probes return 401. No other Edge function or shared AI
configuration was changed.
[Pages 36997321966](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36997321966)
passes; the served frontend bundle remains `assets/index-DEc2mNy-.js`, because
this release changes backend behavior. [Live Bob 36997321668, attempt 2](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36997321668/attempts/2)
passes after Edge deployment. This checks actual guest Auth/RLS/model consumption
and guarded disposable fixtures; it does not prove named-member event/CAD delivery.
The original owner request still has the same `needs_data` revision and no receipt
after deployment; no test or release step restarted or changed it.

The request remains project-scoped with no Step destination, and a fresh read
finds no saved Plan revision. The real test must establish/reuse the correct
current work Step and verify its link; a saved project drawing alone cannot
close that gate. No owner depth choice or physical truth is supplied by this
release. The full P4 matrix and actual owner's
complement → same request → reviewed saved drawing → Step link → reopened result
remain open in [State](bob-delivery-flow.md#state). Local/schema/HTTP fixtures and
real model/member acceptance must remain separately labelled. Manual review uses
Archie's prompt; no independent subagent review is claimed.


## Chat message recovery — 2026-10-02

[PR #181](https://github.com/EmelieHagander/Bob-the-builder/pull/181) merged as
`77989cb472606a6c08adf61b9eb188be9272b43b`. [CI 37030145118](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37030145118)
passes on final head `33aaeed3ecaf521f70d0abe41f64d005289b1cfd`: 850 tests, vocabulary,
Edge checks, production build, PWA and every browser group. The HTTP fixture
regressions prove failed/pending owner visibility, rejected-complement retention,
unrelated event isolation, reload without automatic resend, explicit same-ID retry,
account/project isolation, composer preservation, explicit local dismissal and reset.
Final collision screenshots were manually reviewed at 320/390/1280 px, including
the corrected status-label contrast. Local Chrome was unavailable; the browser
evidence is CI output, not a local browser or real model run. Vera and Archie
guidance was followed manually, without an independent subagent review.

[Pages 37031952615](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37031952615)
completed successfully. Public HTTP readback confirms
`assets/index-l59xDD5w.js`, SHA-256
`0053eb4f382c19dd518a503824a1775af65fbb7d4d8f80874e1233b769a99a88`,
contains the new interrupted-message and retained-send UI and points to
`https://yuobtgoidmmmwfqenkau.supabase.co`. This frontend-only release does not
change schema, Edge functions, AI configuration or the owner's data.

A scoped read-only preflight found the original shelf request still at
`needs_data`, revision 13, without a saved receipt; its private thread had one
saved owner message and zero queued/running jobs. The rejected depth complement
was never saved. The owner must send it through the updated ordinary member UI.
The same-request reviewed drawing, current Step link and reopen/readback outcome
remain open in [State](bob-delivery-flow.md#state), together with the parked P0/P3
acceptance gates. A green fixture or deployed chat fix does not close P4.


## K1 construction checkpoints — 2026-10-02

**Merged, migrated, deployed and technically verified.** Release time is October 2 UTC / October 3 Europe/Stockholm. Implements the scoped K1
checkpoint contract in [Artifacts](artifacts.md#k1-construction-checkpoints),
not the K2–K5 construction-to-purchasing chain.

Deterministic tests exercise the registered Bob tool/claimed-turn SQL boundary,
600 × 800 × 300 mm synthetic construction, formula-derived 564 mm width,
width/thickness changes with stable IDs, exact readback by another authorised
member, revision history, replay, stale revisions, broken joints, invalid units,
forged normalized values, catalog freshness, cross-project denial, direct-write
rejection, archive/restore and a second generic construction with a cyclic
physical joint graph and a project measurement converted from cm. A negative
source-change test exposed a missing checkpoint source-head check; the write now
locks and validates those heads before canonical Artifact creation.

The shared CAD validator extraction matches the hosted prior function body
(MD5 `2b0f34190073a5e8ad7e61e0a2c7bbc8`); existing CAD parameter SQL tests pass.
All 127 local test files pass. Edge type checks and the production build pass locally.
The PostgreSQL concurrency runner includes K1 duplicate, competing-revision,
measurement-first and save-first cases and verifies actual lock waits; its CI
result passed all 32 races. Browser/PostgreSQL verification ran in CI, not locally.

Manual review follows Archie's prompt (not an independent subagent review).
Supabase changelog checked October 2; the September 25 Postgres extension/operator
breaking changes do not apply to this additive JSON/relational migration.
No paid model call, owner shelf retry, budget grant, model change or userdata
repair was used as proof. K1 tools preserve unresolved joint fit, hardware and
strength; actual autonomous design quality belongs to subsequent acceptance.


Release evidence:

- [PR #184](https://github.com/EmelieHagander/Bob-the-builder/pull/184); tested head `4f248fe5f74265fe53fb00d21ecb30ec950f73da`, merge `1d124677419ea5709c4bc496089b94f2527cc202`. Tested/merged tree matches exactly: `a95a2ddf51610257e57680bcc93544aab51d627f`.
- CI `37069731135`, job `111046050827`: **862/862 tests**, Edge/build and all browser gates passed, including 320/390/1280 px. These are regression fixtures, not a real model or participant trial.
- PostgreSQL concurrency `37069731034`, job `111046050482`: **32 races passed**, including duplicate K1 save, competing revisions, source-first and save-first. CAD adapter `37069730852` also passed.
- Hosted migration `20261002220943 / construction_drafts`; source file `20261002203012_construction_drafts.sql`, SHA-256 `38dbed5d3f94caf00726ae82e8cfaf676a6474678ea6ba667be38b1ac41b2992`.
- `ask-bob` **v74**, JWT required, ACTIVE; immutable bundle SHA-256 `33a8c9ef590e0b6c89f2d1f3575b982abb014b16bfc1e46c8c4541f8d7eff620`.
- `bob-worker` **v42**, existing custom worker authentication, ACTIVE; immutable bundle SHA-256 `65bf15c3388ba5bfba0adc650575b2c7247a5a028b6ea7f7c074632ef33cf107`.
- Both deployed sources read back pinned to the verified merge. Unauthenticated HTTP POSTs returned 401 for both endpoints.
- Hosted transaction with synthetic sources/catalog/checkpoint passed create → exact read → revise, same Artifact identity, replay, immutable history, stale-write rejection and outsider denial; no CAD export was created. The transaction rolled back, with zero smoke Artifact/material records remaining.
- Readback confirmed both catalog tools active at schema version 1, RLS enabled, no authenticated direct inserts, no anonymous read RPC, authenticated claimed writes and no service-role write RPC grant. Security advisor findings are unchanged from the pre-release baseline.

No owner shelf retry or paid model call was run. K1 is the persistent technical
foundation; autonomous construction, checked joints, annotated drawing delivery,
cut/purchasing outputs and recovery/model evaluation remain K2–K5 in [State](bob-delivery-flow.md#state).

## K2 construction checks

This is the dated technical release. The subsequent [three-turn live acceptance](#k2-live-construction-acceptance--2026-10-04) supersedes the unrun/member-configuration status below for one concept case; product/manufacturer and broader model acceptance remain open.

**2026-10-03: merged, migrated and deployed; real-model acceptance remains open.** Deterministic tests cover a five-part 600 × 800 × 300 mm concept with six joints, missing/reversed joints, bad spans, collisions, unsupported geometry/methods, material dimensions/applicability, stale pins, expired knowledge, and another rotated bracket using the same generic checker. Caller-scoped SQL/tool integration reads a saved K1 checkpoint and exact catalog through caller authority: the complete construction passes, including catalog unit conversion from 1.8 cm to 18 mm, while missing joints are rejected. No fixture is proof of autonomous construction.

The first local full suite passed 127/128 files; the prompt-size gate caught an overlong permanent instruction. Construction workflow guidance was moved into the existing tool-owned guide, preserving the permanent prompt. Final [CI 37107057471](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37107057471) and [CAD lineage concurrency 37107057476](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37107057476) passed on `195a179a0377ddc89b644093c912da92ede427e0`. [PR #185](https://github.com/EmelieHagander/Bob-the-builder/pull/185) merged as `11e2125dc176f63b83e469db80010b30646f5d8b`; both commits have identical Git tree `ff77fae92e3eb11309d7c98eddce6884cfc43d1f`.

The earlier read-only reconciliation observed K1 Edge versions v74/v42 with the K2 migration already present. The completed deployment and repeated live source readback below supersede that partial-rollout snapshot.

Hosted release readback on 2026-10-03:

- Migration `20261003103107 / construction_checks` was already committed despite the earlier connection error. Its recorded SQL matches source `20261002231320_construction_checks.sql`; it was not replayed. The active checker registration and updated save guide were read back separately.
- `ask-bob` **v75** and `bob-worker` **v43** both read back immutable imports pinned to merge `11e2125dc176f63b83e469db80010b30646f5d8b`. Existing authentication settings are preserved (`verify_jwt=true` for Ask; custom worker authentication with `verify_jwt=false`). Unauthenticated HTTP POSTs returned **401** for both.
- Security advisors were inspected after release. Their reported objects are outside this catalog-only change; this release adds no table, function or privilege. Existing shared-database notices remain, including [guarded definer-function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [RLS without direct policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy); this is not a claim that the shared database has no findings.
- This verifies registration, deployed source and unauthenticated rejection. It does not prove an authenticated model/tool execution in production. Both required named-member runner variables remain absent; no live model request, budget/model change or user-project mutation was made during this release continuation.

The revised orchestration plan already exists in open [#186](https://github.com/EmelieHagander/Bob-the-builder/pull/186), head `09a3ecc0353d79a87f8e2d5b169bfe335fd55f61`; its [build check](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37114117177/job/111177473097) passed. It is documentation only and has not landed in main. Preserve the newer [State](bob-delivery-flow.md#state) when reconciling that PR; do not recreate the plan.

`scripts/check-live-construction.ts` is a prepared, **unrun** real-model acceptance: existing verified named member, disposable project, ordinary Swedish request with no injected parts/tool calls, then independent canonical readback/checks, width 600→700 and thickness 18→21 changes, stable instance IDs and historical geometry/joints. Requires existing secure-runner member configuration plus `BOB_K2_LIVE_CONFIRM=disposable-fixtures-only`; it neither creates Auth users nor mints tokens, substitutes a guest, changes budgets or retries paid failures. The current runner has no member credentials. Actual calls, cost, autonomous outcome and named-participant acceptance remain unverified. General method references do not close the missing manufacturer/product-evidence acceptance.


## K2 runtime payload baseline — 2026-10-03

**Implemented offline audit; no runtime, prompt, model or deployment change.**
`scripts/audit-bob-runtime.ts` now defaults to the current repository catalog seed
and registers the K1/K2 construction and drawing-lifecycle handlers. An explicit
older catalog is measured as supplied: missing K2 tools are reported as an unrun
scenario, never silently replaced by the seed. The seed is not a live policy read.

The former audit stopped with zero renders because its CAD fixture lacked the
current intake/parameter contracts. The repaired fixture reaches collection,
rejects invalid geometry before the renderer, renders once, delivers synthetic
preview carriers to the designer and independent reviewer, and reaches a reviewed
candidate. A separate scripted Bob loop lists, saves, checks, corrects and re-reads
the same K1 checkpoint: a missing contact joint is rejected; revision 2 passes
concept checks while fabrication readiness stays false. Revision 1's geometry and
five-joint history remain intact. Storage, rendering and model replies are injected
fixtures; these are not SQL, actual image-quality or autonomous model acceptance.

The [archived report](archive/k2-runtime-baseline-2026-10-03.json) includes source
hashes, catalog hash, six phase surfaces and individual call measurements for Bob,
CAD collection, designer and reviewer. A successful small Task flow includes
nonempty conversation history. Plan specialist, memory-fold and delivery-language
calls are not exercised; the text-only premature Task/plan/material probes remain
separate observations, not successful deliveries.

Initial Bob call, current synthetic named-member toolbox:

| Component | UTF-8 bytes |
|---|---:|
| Persona | 1,186 |
| Shared system rules | 3,854 |
| Domain vocabulary | 1,233 |
| Toolbox orientation and system separators | 2,044 |
| Tool descriptions, including catalog guides | 44,896 |
| Tool parameter schemas | 76,311 |

The 59 unique offered tools occupy **127,092 bytes** including JSON tool metadata;
`save_construction_draft` is the largest. The system message is **8,317 bytes**.
These observations support testing tool-guide/schema delivery first; they do not
establish that less context improves model quality. No production instructions
were shortened and no tools were removed.

Each call separates system, frame, source data, history, tool descriptions,
parameter/response schemas, arguments/results and image carriers. Raw UTF-8 content
and serialised local input are different measures. Continuation calls explicitly
report unknown retained provider context behind `previousResponseId`. Synthetic
usage/cost/provider latency are **null**, not zero-price or token estimates;
fixture timing measures local code only. The existing execution-metrics writer is
reused in memory. It currently classifies `cad-research` as `other`; the audit
preserves the actual function role separately, exposing that instrumentation gap
without changing production diagnostics. Real input/output/cached tokens and
cost still need provider usage in the member acceptance run.

`tests/runtime-audit.test.ts` verifies UTF-8 accounting and text exclusion, the
complete scripted repair/render/review paths, and honest old-catalog handling.
All three tests and vocabulary verification pass locally. Network calls are
blocked during the audit. CI includes this test file through the existing suite.
[State](bob-delivery-flow.md#state) owns the next work; this baseline does not close
K2's product-evidence or real-member acceptance.


## K2 tool manual comparison — 2026-10-03

**Opt-in code candidate, offline paired evidence; no deployment or real-model acceptance.**
Continues the existing #188 audit and #186 plan. The [tool owner](ask-bob-tools.md#opt-in-manual-experiment--2026-10-03)
defines the candidate and its authority boundary. The baseline's default behavior
and archived report remain intact. Reproduce with:

```bash
node --import tsx scripts/audit-bob-runtime.ts --compare
```

The [archived comparison](archive/k2-tool-manual-comparison-2026-10-03.json)
records the inline baseline and three scripted retrieval strategies, source/catalog
hashes, individual call components and scenario totals. Across all six synthetic
phase surfaces, the same 59 domain names and exact parameter schemas are present
(matching schema hashes). Each candidate adds the same read-only manual operation.
Catalog `how_to` is deferred; code descriptions, schema field descriptions, truth
rules, domain handlers, models and execution budgets are preserved.

| Measurement | Inline | Separate manuals | Batch all needed | Selective batch |
|---|---:|---:|---:|---:|
| Initial serialized tools, bytes | 127,092 | 106,451 | 106,451 | 106,451 |
| Construction model calls | 7 | 10 | 8 | 8 |
| Construction manual calls / steps | 0 / 0 | 3 / 3 | 3 / 1 | 2 / 1 |
| Construction summed local input JSON, bytes | 1,003,532 | 1,210,574 | 980,360 | 979,483 |
| Task model calls | 3 | 5 | 4 | 3 |
| Task manual calls / steps | 0 / 0 | 2 / 2 | 2 / 1 | 0 / 0 |
| Task summed local input JSON, bytes | 409,702 | 580,551 | 465,445 | 348,475 |

All candidates reduce the initial tool surface **16.2%**. Separate retrieval
before each distinct tool increases summed local input **20.6%** for construction
and **41.7%** for the Task. Grouping those same reads in one native model response
reduces construction input **2.3%** versus inline, but still increases Task input
**13.6%**. The selective fixture fetches only construction save/check manuals in
one step and no Task manuals: **2.4%** and **14.9%** less input respectively.

These are scripted hypotheses, not a tool-selection router or observed model
judgment. Independent manual requests share the existing native tool-call batch;
the runtime still executes each separately with fresh policy/authority checks.
No combined-manual API, extra budget or parallel domain writes were introduced.
The next model step receives all manual results before any dependent action.
Selecting fewer manuals barely changes construction payload here; avoiding extra
model round-trips has the larger effect. A simple Task may need no manual, but
this fixture cannot establish whether a real model recognizes that correctly.

Returned manuals and execution-budget envelopes count in tool-result bytes.
Totals are local serialization measurements, not provider billed tokens, cache
savings, retained continuation context, latency or cost. All four variants
list/save/check/repair/read revision 2 of the same construction, preserve revision
1 and leave fabrication readiness false. All save one Task. CAD specialist
behavior and payload are unchanged. Premature text replies still save nothing;
manual retrieval does not solve the separate completion gap. All models, storage
and render inputs are synthetic.

Focused tests cover current manual readback, direct calls without a manual,
unchanged domain schemas, no writes from manual reads, waiting/exhausted gates,
revocation, disabled targets, schema changes, invalid inputs, visibility changes,
policy-read failure and the closed bench. The positive loop verifies that manual
calls consume the existing model-step/tool-call budget, batched calls are not
deferred, and all strategies preserve construction, Task and CAD outcomes.
The focused tests, vocabulary verification and production build pass locally.
All 129 local test files pass in this continuation. The Edge type-check
attempt is blocked by the runner's refused connection to `esm.sh`; the prior
session's pass is not claimed as a new check. CI must verify this candidate.
The default per-call payloads match the archived #188 baseline exactly;
candidate source hashes match the measured files.
Manual review follows Archie's placement rules; no independent subagent review
is claimed. [State](bob-delivery-flow.md#state) owns remaining validation and the
next experiment. Do not enable this candidate based on first-call byte reduction.

## CAD research execution attribution — 2026-10-03

**Merged, migrated and deployed; authenticated model acceptance remains open.** New source-collection
model calls previously fell into `other` because `execution-metrics.ts` omitted
`cad-research`; the database constraint also rejected that role. The bounded fix
adds it to both allowlists through CLI-generated
`20261003210307_cad_research_execution_role.sql`. All existing roles remain valid.
Historical `other` rows cannot safely be attributed and are preserved. Model
selection, prompts, manuals, budgets, user data and authority do not change.

`tests/execution-metrics.test.ts` reproduces the pre-migration constraint rejection,
installs the complete migrated schema with historical rows, admits research
events as service role, rejects unknown roles and ordinary-user reads/writes,
and checks the constraint is validated. The journal test verifies one research
event across replay with preserved usage/cost and no private content.
`tests/runtime-audit.test.ts` verifies actual CAD collection reports its own
execution role. The original dated payload/manual reports retain their hashes
and their historical `other` observation; rerunning the harness on this source
does not rewrite those archives. Final local/CI validation belongs in the PR.

Read-only hosted preflight at 2026-10-03 21:05 UTC, target
`yuobtgoidmmmwfqenkau`: the validated constraint has the exact prior 12 roles,
research is absent and the new migration is absent. RLS is enabled; anon/member
SELECT and member INSERT are false, service INSERT is true. Security advisors
were read as the pre-release baseline; no changes to their reported objects were
made. The service-only table intentionally has no normal-user RLS policy.

### Hosted technical release — 2026-10-03

The #187 → #188 → #189 → #191 dependency chain was merged after every current-head CI check passed. #191's two build checks and two PostgreSQL checks passed on `4e309deda3e3cfbe54364a0b441f8e111927581d`; source SHA `72be4a2a4bb6a2232fe02585f5fdc20620e12ea5` has identical Edge and migration files. [PR #191](https://github.com/EmelieHagander/Bob-the-builder/pull/191) owns the implementation and CI evidence.

- Target `yuobtgoidmmmwfqenkau` was ACTIVE_HEALTHY. The exact prior constraint, migration absence, RLS and service-only grants were checked again before applying the reviewed SQL.
- Hosted migration `20261003214005`, name `cad_research_execution_role`, applies repository migration `20261003210307_cad_research_execution_role.sql`. The validated constraint now admits the original 12 roles plus `cad-research`; history and grants were read back.
- `ask-bob` **v76**, ACTIVE, `verify_jwt=true`, bundle SHA-256 `7365af56d8c75634afe2998c8b021a9550e19af262e21df4b3c66be0d2b1198b`; `bob-worker` **v44**, ACTIVE, existing custom authentication with `verify_jwt=false`, bundle SHA-256 `1f57b97c472b1ae2ccbdfdd4555523a8e773f7724e27cf6b9dd6682d328c49d9`. Both source wrappers were read back exactly pinned to the same immutable source SHA above.
- Unauthenticated HTTP POSTs returned **401** for both functions. The rollback-only hosted smoke inserted and read a content-free service-role research event with exact token/cost values, rejected an unknown role, and denied both SELECT and INSERT for anon and authenticated roles. The transaction rolled back; zero smoke rows remained.
- Security advisors matched the pre-release baseline: 153 findings before and after, with no new or removed finding. The service-only telemetry table's no-policy notice is intentional and does not authorize member access.
- [Pages 37155427529](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37155427529) published the source commit successfully. Later documentation-only merges do not change the deployed runtime.

Review used the existing Archie prompt manually, current-head CI evidence, source-diff comparison and live readback; no independent subagent review is claimed. `BOB_TEST_MEMBER_ID` and `BOB_TEST_MEMBER_ACCESS_TOKEN` remain absent in the checked runner environment. No authenticated construction/model comparison was submitted. Hosted callers still use full inline manuals; the optional candidate is not activated by this telemetry release. [State](bob-delivery-flow.md#state) owns the remaining member/model acceptance and next experiment.


## K2 manual runner — 2026-10-04

**Prepared operator workflow; real-model acceptance remains unrun.** `.github/workflows/live-construction.yml` wraps the existing named-member K2 probe with a manual-only main guard, immutable checkout, read-only repository permission and `github-pages` environment secrets. It verifies local session configuration and at least 40 minutes of remaining token lifetime before the existing probe verifies the actual Auth identity and creates any disposable data. It preserves the probe's requests, runtime model/manual configuration and no-automatic-retry behavior.

The workflow uploads only the existing synthetic construction report for seven days, including failed-run evidence when present. It retains the printed fixture for inspection and scoped cleanup. No private session/configuration files are uploaded; member secrets are provided only to the probe step after dependency installation. [AI owner](../supabase/README.md#live-k2-acceptance-runner) owns setup and operation; [State](bob-delivery-flow.md#state) owns next action.

Local validation covers YAML/manual-only/main/checkout controls, the actual inline preflight with positive and missing/mismatched/expired/privileged synthetic credential cases, and existing named-member config/Auth-denial tests. These are offline guards, not successful Auth/model calls. The local runner still lacks `BOB_TEST_MEMBER_ID` and `BOB_TEST_MEMBER_ACCESS_TOKEN`; GitHub environment secret values were neither read nor changed. No live construction workflow was dispatched, no model turn submitted and no test project created in this preparation. The manual candidate still needs a real comparison runner and evidence before activation.

## K2 live binding recovery — 2026-10-04

**First authenticated model run failed; correction released in #193, repeated acceptance failed separately.** The existing `scripts/check-live-construction.ts` ran against `yuobtgoidmmmwfqenkau` with a normal confirmed test member session acquired through password sign-in. The session stayed in process memory and was signed out afterward. No GitHub secrets/workflow or guest/service write authority was used. The disposable fixture is `p_e8ceaf7e569844ab94227ff0b18b144d`; first turn `09f593a2-a295-4388-95c8-92405df79287`, durable job `926a5676-770d-49ef-92f1-929a20f8a11f`.

The job completed, but canonical construction readback returned zero drafts. Bob saved a material, selected concept solution and other work, then reported that the construction checkpoint could not be verified. The runner stopped at its first independent assertion, so width/thickness changes, stable instance IDs and historical readback were **not exercised**. Content-free execution telemetry for that turn records 22 model events, 790,739 input tokens, 40,217 output tokens and USD 0.993798 estimated cost; token counts include the full call chain and do not themselves prove provider billing or cache behavior.

Two captured save attempts reproduce the actual failure locally after the server-owned request quote is supplied: their dot-separated paths leave all 36 canonical recipe paths unbound. `compileCadParameters` correctly rejects this incomplete plan, but `createConstructionTools` previously converted the structured `parameter_gaps` error into a generic read outage. The model could not see which paths to correct. The correction preserves the compiler gate, returns typed canonical `unbound` paths as `invalid`, and advertises slash-separated stable-ID paths in the existing parameter schema. No aliases, inferred bindings, unknown-to-zero conversion or authorisation changes are introduced.

The regression fails before the correction (`unavailable` instead of `invalid`) and passes afterward, including no write on an incomplete plan, successful correction in the same request, and a genuine lookup outage remaining private and `unavailable`. All 21 construction/parameter tests, build, vocabulary and whitespace pass locally. Local Edge checking was blocked by a refused `esm.sh` dependency fetch; CI 37185364205 verified all 38 steps, including Edge types, before merge `a6ade34aa889dff86e7521fd02371763ba85638a`. Pages 37186033861 succeeded. `ask-bob` v77 / `bob-worker` v45 were read back ACTIVE with unchanged JWT settings and both wrappers pinned exactly to that merge. Replaying the captured model arguments now returns all 36 correct missing paths. This is recovery feedback evidence, **not a successful new model run**; the first hosted correction is released; the second attempt below did not complete three-turn acceptance. [State](bob-delivery-flow.md#state) owns that next action.


## K2 live completed drawing replay — 2026-10-04

**Second ordinary-member model run failed; replay/source-quote corrections released in #194, full acceptance failed separately on rerun.** Disposable project `p_a6860fafb8714e31ade54ab0707a692a`, turn `69b6cac8-c73c-49ef-bdbe-7e4d8b071eb1`, job `a99f15e4-8ec2-4f73-a0ee-685ff060a615` used #193's deployed v77/v45 with full inline manuals and a fresh password-acquired ordinary session. The job failed at 2026-10-04 07:40:30Z with `continuation_changed`; scoped Edge logs identify operation `model:ask-bob:11`. No width/thickness/history turn was submitted. Only the original user message exists in its thread; zero current construction drafts were independently counted. The session was signed out locally afterward.

The model added a period to `Välj plywood 18 mm som arbetsmaterial`, although the original continues with a comma. Three catalog saves were correctly rejected by `catalog_source_quote_required`; the writer's generic profile/dimension hint hid the actual repair. It subsequently chose CAD despite the requested non-rendered construction. SQL receipts confirm a solution, target and CAD Artifact `bad69cbc-f283-4125-b8c6-6bb9179e20c4`; drawing request `b80ed5f1-d6f5-4fb8-a84d-9c5f92566799` is saved at revision 6. Saved CAD is not a construction draft or K2 pass. On the next worker, fresh completion checks replaced the original reviewed CAD tool result with `stopped`, so the unchanged-input journal correctly stopped the changed next model call.

The regression reproduces the completed-save/worker-pause failure before the correction (`stopped` replaces `ready`). A scoped journal reconstruction now permits only exact previously recorded steps once a fresh drawing check finds `saved`: a missing checkpoint stops with `continuation_incomplete` before dispatch, and changed input still stops with `continuation_changed`. Fresh cancellation, reset, access and canonical-requirement checks remain in force; completed work outside reconstruction still stops. The scope ends before Bob's next step. No model/render/write repeats and no fingerprint, SQL completion, authorization or budget guard is weakened. A second regression exposes the incorrect source-quote hint; its correction explains exact unmodified substrings and current/older source sequence without changing quote validation or disclosing database details.

All 84 focused construction, parameter, CAD intake/review, drawing-store, background and writer tests pass, as do build, vocabulary and whitespace. The regression and dispatch-denial controls use synthetic fixtures, not model acceptance. Exact-head CI, merge and immutable Edge release/readback succeeded as recorded below. The next existing live probe completed its first job but failed the construction gate. [State](bob-delivery-flow.md#state) owns the next action.


## K2 live post-replay outcome — 2026-10-04

**Historical failed attempt.** The later [construction acceptance](#k2-live-construction-acceptance--2026-10-04) supersedes this attempt for the three-turn concept gate; the failure and recovery evidence below remain dated.

**Ordinary login and completed-CAD continuation verified; full K2 acceptance failed.** #194 head `1952f6e1506de747187e1274ae5d7167f81e9766` passed all 38 steps in [CI 37187407024](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37187407024), including full tests, Edge types, build and browser checks. Fresh head/base/main/check-run checks preceded merge `736b173b4ddc460daffd57a94cfa88e71bfec6e0`; its tree exactly matches reviewed `743c1deab505cc994f770eaacf305fdf274a2bb7`. [Pages 37188115204](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37188115204) succeeded on that merge. Review used the existing Archie prompt manually and source/caller/journal/SQL boundary checks; no independent subagent review is claimed.

Before deployment the prior v77/v45 hashes, exact wrappers and JWT settings matched their recorded baseline. Readback after deployment confirms `ask-bob` **v78**, ACTIVE, `verify_jwt=true`, bundle SHA-256 `bbdf06cf80c9d5853d9fba332fdf4b7f99a5b8dbc7aab0910292847f67c26a7a`; `bob-worker` **v46**, ACTIVE, existing custom authentication with `verify_jwt=false`, bundle SHA-256 `7a3c434aad4564c27e969029bc2dcfe9e612d472df076c63eb367e2f32e78efc`. Both immutable wrappers import exactly the same merge SHA above. No migration, authorization change or manual candidate activation was applied.

The unchanged `scripts/check-live-construction.ts` ran with a fresh password-acquired confirmed ordinary test-member session, independently checked by Auth before fixture creation. Disposable project `p_2d5e164b5a65423e946deb54e480372e`; turn `1f0f885e-7399-4d28-bb47-7c5c63e48c7d`; job `68574499-ef37-47f6-a5f2-025ee5b87c8e`. It started at 08:12:45Z and completed at approximately 08:20:38Z with 15 model steps, three saved records, 20 worker claims and no job error. The caller session was signed out locally; no token/configuration was saved or uploaded. No duplicate paid retry was submitted.

SQL receipts verify solution, target and CAD Artifact `172a91d6-110c-4d6d-8596-ebe94b2a2a7c`; drawing request `e684897a-0a41-4882-b39c-9e8086429165` is saved at revision 6. Bob continued after that save and committed an assistant reply. This exercises the previous completed-CAD replay failure in production successfully. The runner's independent ordinary-caller `read_construction_draft` still returned **zero**, failing `Bob must save one construction without injected parts/tool calls`. Its report is `passed:false`; no width/thickness/history turn was submitted. A saved CAD concept and geometric review do not establish the typed part/material/joint K2 acceptance.

Captured calls show missing `profile_code`, illegal dictionary category filters and an empty query repeatedly receiving generic catalog feedback until reads were exhausted. The material save then used guessed profile `sheet_material_v1` and parent material category `wood`; SQL correctly rejected `catalog_invalid_categories`, but the writer returned the unrelated generic profile/dimension hint. Bob delegated CAD instead of correcting and saving the non-rendered construction. The source-quote correction was not exercised by this attempt; its synthetic regression remains the evidence for that specific feedback branch. No contract gate should be weakened to declare this pass. Content-free telemetry totals **19 model events, 486,814 input tokens, 38,022 output tokens and USD 0.788246 estimated cost**, including the CAD chain; counts alone do not prove billing or cache behavior. Delivery remains `partial`.

The requested test has a concrete failed result, and both identified technical recovery fixes are released. Further unchanged paid probes are stopped. At this checkpoint the remaining action was usable schema/category correction feedback and the appropriate construction deliverable, followed by the same three-turn acceptance. Its later result is recorded below; [State](bob-delivery-flow.md#state) owns only remaining work.

## K2 live construction acceptance — 2026-10-04

**The existing three-turn named-member concept test passed.** [#196](https://github.com/EmelieHagander/Bob-the-builder/pull/196) head `84225bdfcaf61b2c59f9acfba7c5d6ab22842481` passed all 38 steps in [CI 37195408609](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37195408609). Fresh exact head/base/main/check-run review preceded merge `b7562d2ba7a76dc9da1d5d345d2056a2277782ff`; the merged tree equals reviewed `65ede300edc4d7703dffd88791c37b2e4712de6b`. [Pages 37196043987](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37196043987) succeeded on that merge. Manual review used Archie's existing prompt and actual domain/code/SQL boundaries; no independent agent review is claimed.

Before deployment, the recorded v78/v46 source hashes and JWT settings matched. Exact immutable merge imports were then read back: `ask-bob` **v79**, ACTIVE, `verify_jwt=true`, bundle SHA-256 `956a784a108ea74ccd9848237ff43fdca28c5181d3d0ad5394d9bd4ff40e14d9`; `bob-worker` **v47**, ACTIVE, existing `verify_jwt=false` custom authentication, SHA-256 `ac1a377630d70c38444e69648c15a2ce25fb6e1c6e6477ffefb0cbdd3d37e70b`. Both import exactly the merge above. No migration, auth/model/budget change or manual candidate activation was applied.

Captured catalog read/write failures have red-before/green-after regressions. Migrated SQL rejects the guessed profile, then exact vocabulary/profile reads repair the same intended definition and return reused without a duplicate. All **97 focused tests**, build, vocabulary and whitespace checks passed locally; CI includes the full tests, Edge types and existing browser gates. The existing runtime audit retains all tool names and exact schema hashes across six phase surfaces. The initial tool surface grows from 127,339 to 128,198 bytes; descriptions change, the permanent system prompt and schemas do not.

The unchanged `scripts/check-live-construction.ts` ran with a fresh ordinary password-acquired confirmed test-member session, verified by Auth before fixture creation. It supplied only the original natural-language requests, never parts/tool calls. Disposable project `p_43702f4cbdfb40f0907f5cd0c12a5143`; shared construction Artifact `01349f1c-100b-4ac2-a5b9-de4c839b51a4`. The [synthetic runner report](archive/k2-live-acceptance-2026-10-04.json) is `passed:true`, SHA-256 `e20aba34d0bbeb420db15f0d9926f57a5159b75624191432a516a3f689082ab2`. It contains no credentials or private provenance fields. The ephemeral caller session was signed out locally; no duplicate paid retry was submitted.

| Turn / job | Result read by the ordinary caller | Actual job elapsed | Model calls / estimated USD |
|---|---|---|---|
| `2ad1b389-c20b-47fc-873b-6f0d1776d170` / `4d43a2ee-ceff-43ea-b976-a31099c10d5f` | Revision 1, 18 mm material, bounds `[600,300,800]` mm | 203.974 s | 10 / 0.356433 |
| `5cc8d23e-88ec-4d89-adce-dc6d7f5feee8` / `8963979e-c7dd-40f6-9535-0da8b28aff18` | Revision 2, 18 mm material, bounds `[700,300,800]` mm | 115.578 s | 6 / 0.213985 |
| `9ca37bde-2132-4f23-bc75-bd30e3f3e7c8` / `816254c9-318f-43d0-9f3e-aef2c4b423f2` | Revision 3, 21 mm material, bounds `[700,300,800]` mm | 128.675 s | 8 / 0.224447 |

All three jobs completed with committed replies and no job error. Each exact draft has five parts and six typed joints, `concept_ready=true`, `fabrication_ready=false`, current sources and zero concept issues. The runner independently reads exact catalog revisions and rechecks geometry; it confirms the same Artifact/part IDs and that historical revision 1 recipe/joints remain unchanged. Additional report inspection verifies assembly, definition and joint IDs across all three revisions. Bob called the construction check and saved each revision through ordinary caller authority; there were no CAD consultations/renders/reviews, rejected tool calls or server nudges in these turns. The first turn correctly read `sheet_stock` and saved the plywood material rather than guessing a profile.

Content-free telemetry totals **24 actual model calls, 755,944 input tokens, 27,378 output tokens and USD 0.794865 estimated cost** across all three requested turns; each delivery is `saved`. These sums are not cache or billing evidence, and one successful changed case is not a controlled performance comparison. The test ran from 10:39:55Z, with the last job completed at 10:47:43Z; independent readback/signout finished by 10:48:09Z.

This closes the previously failed three-turn shelf concept gate only. Another construction, live correction of erroneous geometry, product instructions/fastener applicability, fabrication, strength/stability, annotated drawings, purchasing and another named participant/mobile acceptance remain open. Actual browser UI login was not exercised. Full inline manuals remain the deployed baseline; #189's optional manual retrieval comparison is separate. [State](bob-delivery-flow.md#state) owns the next remaining action.

## K3 checked construction drawings — 2026-10-04

The scoped shelf concept delivery passed on 2026-10-05 after the releases and repairs below. Wider acceptance remains open. The source path consumes the existing checked construction rather than commissioning another geometry design. Focused tests exercise a different generic two-part bracket, stale/unchecked/colliding/jointless checkpoints, changed source during render/review, revoked authority, review rejection, publication recipe/parameter pins, ordinary caller/outsider reads and immutable history. Real pinned build123d/CairoSVG tests verify annotated SVG/PNG hashes and dimensions; local rendered shelf views were inspected. These deterministic fixtures are not a real-model repair or participant acceptance.

The first full local suite passed 889/890 cases; its sole failure identified the required migrated/offline tool-policy parity update, which was corrected in the same branch. Build and vocabulary checks passed. Direct local Edge checking is blocked by the unavailable existing esm.sh dependency; exact production imports must pass the normal CI gate before merge. The installed Supabase CLI aborted while reading `migration new --help`; the additive migration uses a UTC filename and is verified by the full-schema SQL harness. No applied migration was rewritten.

The reviewed #198 release passed its CI/CAD and hosted Modal smoke, applied the additive migration and deployed both immutable Edge imports with unchanged authentication. Its first ordinary-member probe stopped before rendering with a false construction comparison and `continuation_changed`; no drawing was saved. [Repair #200](https://github.com/EmelieHagander/Bob-the-builder/pull/200) passed all 897 tests, Edge/build and browser CI plus CAD, was merged and deployed to both functions with source readback. Pages and the hosted release check passed. Its first CI exposed an image-decoding race in the browser assertion, corrected by awaiting decode while retaining the pixel assertion; a subsequent Node/V8 WebAssembly runtime crash passed on the same-head rerun and the affected six SQL checks passed separately.

The next ordinary-member probe reused the retained construction and existing work plan. It rendered and independently reviewed two candidates without the earlier replay failure. Both reviews rejected the visible heading because the stable assembly ID retained the former width while current dimensions were correct. The job completed with no saved CAD revision and no change to the construction; this is an underkänd delivery test, not K3 acceptance. The renderer correction uses a neutral visible heading while preserving the exact recipe/manifest identity. Its retained-ID regression fails before the correction and all 12 real kernel tests pass after it. [Renderer correction #202](https://github.com/EmelieHagander/Bob-the-builder/pull/202) is now released; the ordinary-member proof below exercised the corrected hosted renderer.

### Ordinary-member save/link/reopen — 2026-10-05

[PR #206](https://github.com/EmelieHagander/Bob-the-builder/pull/206) adds a bounded GitHub runner around the unchanged `scripts/check-live-construction-drawing.ts`. Its [exact-head CI](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37335963215) passed all 910 tests, Edge/build and browser gates; 26 focused local cases also passed. The reviewed tree was read back after merge at `3f3a91a9a10f01aa054bf3e8c29c08a03b71e793`. Pages passed on that commit. This runner release changes no database schema, model roles or deployed Edge code.

The runner used `BOB_USER_EMAIL` and `BOB_USER_PASSWORD` from the existing GitHub `github-pages` environment to acquire an ordinary member session. It verified the original member, the caller-accessible synthetic K2 project, the retained private conversation and terminal prior job before making one natural-language request. Credentials stayed in the runner; the original probe received only its ordinary authenticated session. Signout was scoped to that new session. No new database, test environment or construction was created.

[Live run 37337917238](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37337917238) passed. Project `p_43702f4cbdfb40f0907f5cd0c12a5143` and construction `01349f1c-100b-4ac2-a5b9-de4c839b51a4` revision 4 were reused. Turn `bb5c6de6-59a4-496c-819e-4d70ef07f700` / job `5d42b740-718c-49f3-950c-760a5dc9390d` completed without an error at 16:08:14Z; independent caller assertions and cleanup finished by 16:08:22Z. Saved drawing `150f78be-dd33-42e8-8d4f-5af62926a15c` revision 1 has complete front/right/top/isometric annotations, five parts and the exact source-revision pin. SVG/STEP hashes, the engine/annotation contract, a current work-step link to revision 1, caller `read_cad_artifact` and a `saved` drawing-request receipt all passed. Construction revision 4, its recipe and six joints were unchanged. Independent database readback confirmed the completed job, saved drawing/source pin and current link.

This closes only the same shelf's concept save/link/reopen gate. `fabrication_ready` remains false. K2's live erroneous-geometry repair, wider model/generalization, drawings after further construction changes, product/strength/fabrication, purchasing and another named participant/mobile acceptance remain open. Browser UI login was not exercised by this run; #189's manual/model comparison is separate and full inline manuals remain the baseline.

The probe never supplies construction parts or retries a failed/uncertain paid turn without inspecting it and correcting the cause. The runner permits only its first attempt and pins the previous user turn; after this successful request, the unchanged runner will stop before submitting another model turn. Any new probe requires a reviewed checkpoint update after inspecting the same project. Operational reports and credentials remain excluded from repository evidence; the sanitized report and rendered SVGs are retained in the seven-day Actions artifact `live-k3-construction-drawing-37337917238-1`. [State](bob-delivery-flow.md#state) owns remaining work.

## K4 construction blank lists — 2026-10-05

The first bounded K4 implementation is released; actual-member concept acceptance is established by the completed recovery below. The first bounded outcome is a checked concept BOM, per-instance local blank cut dimensions and a separately validated proposed assembly DAG, plus exact saved blank needs in the existing material plan. Missing raw-stock fit/kerf/grain, hardware quantities/products and assembly access remain explicit. Stock/reuse reservation and Shopping are blocked for construction-bound needs. This does not close all K4.

The current-source gate bypasses earlier journalled reads when a turn resumes; a changed head cannot inherit a previous current claim. Focused tests cover this resumed-read boundary, changed shelf dimensions and retained IDs, actual-instance counts, cyclic physical contacts versus acyclic assembly order, invalid/missing dependencies, stale/colliding/unsupported sources, revoked access and private-error redaction. Full-schema SQL tests exercise canonical receipts/readback, archive/restore provenance and duplicate/stale restore fences, rejection of manual edits that strip deterministic proof, unchanged history after recalculation, changed catalog without a new construction revision, duplicate-active needs, forged quantities, forbidden allocation/publication and outsider/raw-write boundaries. Legacy CAD/wall/material regression gates are retained. Initial full-suite testing exposed assertions against SQL receipt shape/numeric representation in the new test, then corrected; that run is not counted as a green suite. A subsequent local full run reached 922 passing cases but the drawing-completion process stopped with a Node mutex/runtime diagnostic; all six cases passed in an isolated unchanged-file rerun. Exact-head CI remains the required whole-suite gate. The installed Supabase CLI again aborted before `migration new`; the UTC additive file is exercised by the full-schema harness.

The actual-model runner continues the same original member/project after K3 and submits no seeded parts/tool calls. It uses the existing secure password/session boundary, signs out only its own session and forbids reruns or another model turn after a changed checkpoint. Archive/restore review identified a missing metadata-copy and restored-duplicate boundary before merge; the repaired final head passed the required gates. Full K4 remains open for raw-stock fit, reservations and compatible Shopping, sourced hardware and linked/access-verified assembly. [State](bob-delivery-flow.md#state) owns subsequent work.

### Hosted technical release and scoped acceptance

[PR #207](https://github.com/EmelieHagander/Bob-the-builder/pull/207) merged as `bee2ac3e564a037c73274870b6533f291bdd2e39`; its tree was independently matched to the reviewed final head `31af0ed7bf595f37f2119713e40ec8ee08b60179`. [CI 37355935727](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37355935727) passed **926/926**, Edge types, build, PWA and all browser groups. [PostgreSQL CAD concurrency 37355935692](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37355935692) and [Pages 37357488724](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37357488724) passed.

A release-tool call stalled before applying the migration; subsequent live readback confirmed no migration, unchanged v81/v49 and zero K4 needs/jobs. The release was resumed after that check, rather than blindly repeating an uncertain mutation. The same existing Supabase project received `construction_blank_requirements` (hosted version `20261005200710`). A covering requirement/project FK index was added separately in commit `ea877d51ec2821be99af45456c89e45592b47401` and `construction_source_requirement_index` (hosted version `20261005200909`); all seven full-schema construction requirement checks passed with the addition. The missing-FK-index advisory is resolved. RLS, project-only SELECT, denied member inserts/anonymous SELECT, the invoker view and active schema-v1 tool registration were independently read back. Security advisory category counts remain unchanged from the pre-release baseline, with no finding on the new provenance table.

`ask-bob` **v82** / `bob-worker` **v50** were read back ACTIVE, pinned exactly to #207's merge with unchanged JWT settings (true/custom worker authentication false). Their deployed hashes are `29cf9d63557a1b65bc38e2e20a43c802ad4dfb0c49256a990fa58f79cda7fd30` and `fd67c9bf19afbc3d82d61e00f7988bb848159afd25a3d23471bd588fd51c0a72`. The earlier merge-triggered Live Bob release check passed before this resumed Edge deployment and is not counted as K4 model evidence.

After migration/deployment readback, reviewed workflow activation `b95eb3ead62778c7cbf108bc7063595e540e630f` started [K4 acceptance 37367996706](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37367996706). The run ended with conclusion `failure` at 20:24:44Z; its only job `111957769554` is `cancelled`, has runner ID 0, an empty runner name and zero executed steps. No runner log exists. Independent database readback at 20:51Z confirms zero K4 material needs, unchanged construction revision 4 and the same completed K3 job as the latest job: **no K4 model turn was submitted**. This is an infrastructure failure before model execution, not a failed model-quality result.

The [GitHub Actions incident](https://www.githubstatus.com/), opened at 19:11Z and updated at 20:39Z, reports job failures and delays in runner assignment across configurations, consistent with this observed failure. No pending deployment approval was found. The detailed check-run annotation is unavailable through the connector, so no more specific cancellation cause is claimed. After GitHub recovers, recheck the unchanged project/checkpoint and activate one new first-attempt run; a normal Actions rerun is intentionally blocked by the workflow's run_attempt guard. Do not rerun or reseed a paid model job without inspecting its outcome. This technical release does not claim a successful model delivery. Credentials and operational reports remain outside repository evidence.

### Actual-member K4 outcome — 2026-10-05 22:34Z

After GitHub reported Actions operational at 21:54Z, the user requested another test. Readback confirmed the same v82/v50 imports, source revision 4, zero needs and the successful K3 job as the latest checkpoint. Reviewed comment-only activation `b531d1cc2a4b4d58e73bf362a9965150ca2df22f` started [run 37382946452](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37382946452), which obtained a runner and submitted one ordinary-member turn. Turn `c85346d0-e8c4-408d-8523-9a3f7e5d3d24` / job `6f281a77-a2c0-4975-ad94-873a8379cca9` completed at 22:34:48Z with no job error, but **the delivery acceptance failed: one of two required needs is missing**. The runner signed out its own session; no second model turn was submitted.

Captured in-flight tool names and inputs show Bob read/checked the saved construction, called `derive_construction_lists` on revision 4 with all six joint dependencies in an acyclic proposed order, then attempted both definition needs in `pieces` with zero waste, increment 1 and empty stock/reuse allocations. The delivered answer correctly identifies P1/P2 as 21×300×800 mm and P3/P4/P5 as 658×300×21 mm, distinguishes the concept assembly proposal from tool-access proof, and retains raw-stock/kerf/grain/hardware/access gaps. These are correct concept outputs, not complete delivery or fabrication evidence.

Requirement `2b5ffd76-5ece-4f32-b2e4-7e4112391003` revision 1 is saved and independently reopened/read back as 2 pcs for `side_panel`, exact instances `left_side`/`right_side`, source revision 4 and local dimensions 21×300×800 mm. The `shelf_panel` requirement for three instances is absent. Bob's saved answer/evidence explicitly reports partial delivery and one verified receipt, rather than claiming both needs were saved. Independent database readback also confirms current construction revision 4, drawing revision 1, no Shopping rows and no stock/reuse allocations.

Scoped unified-log diagnosis (22:32:30–22:33:30Z) shows the first `bob_project_write_v14` request returned 200; the next returned 500 with PostgREST code **57014**. The matching PostgreSQL error at 22:32:55.649Z is `canceling statement due to statement timeout`. This establishes the second database request was cancelled and its transaction did not persist a need. The precise slow statement or lock cause is not yet isolated. A read-only EXPLAIN of the new duplicate guard was fast (44.582 ms planning, 0.889 ms execution), so that observation does not justify changing it or raising timeouts. Completion removes the private job journal; no complete post-completion call/token/cost accounting is claimed from it.

At this failed checkpoint, the next gate was diagnosis plus a recovery probe that pins the existing first need and requests only missing work. The completed recovery is recorded below; this original partial result remains a failed acceptance. Full raw-stock fit, reservation/Shopping, hardware and linked/access-verified assembly remain open. [State](bob-delivery-flow.md#state) owns continuation. Operational reports and credentials remain excluded from git.

### K4 timeout investigation and recovery gate — 2026-10-06

Targeted inspection found no matching lock-wait event; JIT is off and the member API timeout is 8 seconds. Current full requirement readback took 322.34 ms as `authenticated`; source assessment took 136.039 ms. Two complete canonical-write diagnoses against the retained source and existing first need succeeded, including the missing shelf need and normal receipt/readback, inside transactions that were **rolled back**: 578.456 ms, then 314.828 ms using `authenticated`, forced generic planning and the unchanged 8-second timeout. Independent readback confirms no diagnostic turn or need remains, the same partial K4 turn is latest, and the original need/history is unchanged. These are diagnostic SQL checks with a transaction-local claim, not real-model or password-session acceptance. The prior timeout is established, but its particular slow statement/cause could not be reproduced. No database function, index, role timeout or Edge deployment is changed speculatively.

The recovery runner uses the original password-session boundary and pins the completed partial K4 turn, exact retained side-panel identity/revision/quantity/material/dimensions/instances and one original history row. A changed or already-completed checkpoint stops before a paid call. The natural-language request asks Bob to save only the missing three shelf blanks; no tool calls or geometry are seeded. Final caller checks require both exact needs, a receipt for the new need, no new receipt or revision for the first need, deeply equal retained records/history/provenance, unchanged construction/drawing and no allocations/Shopping. The general answer `partial` flag is recorded separately: it can also report truncated context reads and is not equivalent to an absent material need. The original zero-needs authentication preflight is retained as a separate historical boundary. Full-schema regression coverage now also saves two distinct used definitions in one claimed turn and checks both receipts and the unchanged first history. Release and live evidence follow; the diagnostic SQL checks do not themselves establish recovered model acceptance.

### Actual-member K4 recovery — 2026-10-06 07:47Z

[PR #208](https://github.com/EmelieHagander/Bob-the-builder/pull/208) final head `098d55c9c58e1bcee7ac44f874555a2d41c1310c` passed **929/929 tests**, Edge types, builds/PWA and every required browser gate in [CI 37430100558](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37430100558). The first CI attempt crashed natively in V8/WebAssembly in an unchanged CAD SQL test; that file passed all six checks separately, and final-head CI is green. Manual review followed the repo verification and Archie prompts; no independent agent review is claimed. Merge `d2a0eb4f33629ab2f983a13bdcdec07b958a805d` was independently checked against reviewed tree `759753ce377041c6a3014dd59f0ddb077ad44e8a`. No database migration, timeout or Edge deployment was changed; v82/v50 hashes/imports and JWT modes were reverified.

After fresh readback confirmed source revision 4, the same completed partial turn, one retained need and no active scoped job, comment-only activation `3478c5a0b24e69fdfd3c2d84cfeba549f268583d` started [live recovery 37431678319](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37431678319), attempt 1. The same original named member passed password login, identity, membership and the exact partial-result checkpoint. Turn `93751f7c-8ac1-4eef-af08-188e556bb291` / job `e18d42fc-a92a-4509-8c68-8f30decbb09c` completed without a job error at 07:47:33.244Z, **90.14 seconds** after acceptance. The probe and workflow passed, and its runner-session sign-out completed. No duplicate request or second recovery turn was submitted.

| Definition | Saved requirement / revision | Quantity | Exact local blank / instances |
|---|---|---|---|
| `side_panel` (retained) | `2b5ffd76-5ece-4f32-b2e4-7e4112391003` / 1 | 2 pcs | 21×300×800 mm; `left_side`, `right_side` |
| `shelf_panel` (new) | `48a56c7f-82fd-4daf-8b41-e04e39717be2` / 1 | 3 pcs | 658×300×21 mm; `bottom_panel`, `middle_shelf`, `top_panel` |

Both caller-visible requirements were independently reopened with current source revision 4, zero waste, increment 1 and exact material/instance/dimension provenance. The new need has one saved write receipt; no receipt or new revision rewrites the first need. Independent database readback confirms both current needs, unchanged construction head 4/drawing head 1 and zero allocations/Shopping. Before/after digests also match exactly: retained head/history/provenance `e16e8f368a38230bf3beeaf8b5ea803c`, construction revision `fe020b93ca7d607227cf150e2b227913`.

An in-flight journal snapshot captured ordinary reads, `derive_construction_lists`, one `derive_cad_material_requirement` and reopening both needs. Manual review of the delivered answer confirms P1–P5 quantities/dimensions, the proposed six-joint acyclic order, preservation of the first need, and explicit raw-stock/kerf/grain/hardware/tool-access gaps. Saved answer evidence has `partial=false` and exactly the new requirement receipt. Completion removes the private journal, so no complete call/token/cache/cost ledger is claimed. **The scoped concept-list and same-member recovery acceptance is green; complete K4 remains open** for actual cutting fit, reservation/Shopping, sourced hardware and linked/access-verified assembly. The old timeout's precise cause remains unproven; successful recovery does not relabel it as fixed. [State](bob-delivery-flow.md#state) owns the next work.

### K4 candidate-sheet fit — 2026-10-06 08:26Z

[PR #209](https://github.com/EmelieHagander/Bob-the-builder/pull/209), head `a999cc3fdf84aa5a59a317975e521f03177c6ef8`, passed **937/937 tests**, Edge types, production/live-config builds, PWA and every required browser gate in [CI 37434563939](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37434563939), job `112173094963`. [CAD lineage concurrency 37434563967](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37434563967) also passed. Merge `81856174361e9de6a8e3d19d2a07461bdc604ffe` was independently checked against reviewed tree `22aea5d06746211c17c9e4af6534589df8e0012a`. Manual review followed the repository verification/Archie instructions; no independent subagent review is claimed.

The new governed `check_construction_cut_fit` read handler derives every instance blank from a checked current checkpoint and exact material pins. Positive tests independently execute the reported guillotine cuts and match all placements/offcuts. Negative tests cover adequate area with impossible width, material/thickness mismatch, kerf, grain rotation, edge trim, unknowns, forged quantities/placements, stale replay heads, denied/withdrawn access, foreign data, precision and search exhaustion. Full-schema authenticated SQL reads feed a positive handler result; toolbox dispatch and migrated/offline catalog parity pass. Local 937-test, vocabulary/build/PWA checks passed. The local Edge check could not fetch an external esm.sh dependency because the executor refused that connection; final-head CI completed the required Edge check. No UI changes were made.

The additive toolbox-row migration is local `20261006080834_construction_cut_fit_tool.sql`, hosted **`20261006082636` / `construction_cut_fit_tool`** on the unchanged project `yuobtgoidmmmwfqenkau`. Catalog readback matches the reviewed schema/manual, active version 1 and planning/build preloads. Existing catalog RLS remains enabled; anonymous SELECT and authenticated INSERT remain denied. No requirement/allocation function, timeout, permission, model/manual setting or Auth account was changed. The installed Supabase CLI's previously recorded native crash prevents migration creation in this executor; hosted migration application/readback used the existing managed connector.

| Endpoint | Active version / JWT mode | Verified bundle SHA-256 |
|---|---|---|
| `ask-bob` | 83 / true | `15012ef053d45b55eea09392a0745e58149d3a09fddff69ed134d85013d8e214` |
| `bob-worker` | 51 / false, existing custom authentication | `2df6f23efd8f6695c4425fcf6dbb4f94b5c871e8170aa7404ea50fac2d2d9187` |

Both deployed wrappers were separately reopened and pin merge `81856174361e9de6a8e3d19d2a07461bdc604ffe`. Security-advisor comparison retains the existing **153 findings in the same seven categories**; no baseline security cleanup or global safety claim is made.

A rollback-only hosted `authenticated`-role read of the original member/project supplied the current construction `01349f1c-100b-4ac2-a5b9-de4c839b51a4` revision 4 and material `766d4e1a-db42-4a0e-af25-da2739783fc4` revision 1 to the reviewed local handler. For an explicitly hypothetical **2440×1220×21 mm** sheet, **3 mm kerf**, **5 mm trim per edge** and length grain aligned with the side blanks' local z and shelf blanks' local x, all five blanks receive placements and ten executable extraction cuts on one candidate sheet. **10000×299×21 mm** with zero trim fails every blank despite sufficient total area. This combines hosted SQL-role source evidence with local deterministic execution; it is **not** password login, a hosted HTTP/model tool invocation, an optimal purchase count or evidence that that sheet/product physically exists.

Production before/after readback preserves both need IDs/revisions and quantities (2 and 3 pcs), current source/target flags and zero stock allocations/Shopping. The complete project requirement-history digest `d17d86d8914c2d379a635ff28915c69e`, construction-source-row digest `f8668367bf5851b9728fe9df2af4a6bd` and complete construction-history digest `6fdc8107865b7cfede58e24372b134e8` match exactly. These digest scopes differ from the earlier partial-recovery checks.

**At this release checkpoint, technical candidate-sheet assessment was deployed and ordinary-member/model acceptance remained open.** No additional paid model turn was submitted and the completed recovery workflow was not replayed. The subsequent reviewed runner and actual-model result are recorded below. Persisted cut plans, current real stock/product formats, whole-piece capacity/reservation, compatible Shopping contributions, product-bound hardware and linked/access-checked assembly remain subsequent K4 gates. A feasible read assessment cannot unlock existing SQL allocation/Shopping guards. [Material planning](material-planning.md#k4-candidate-sheet-fit--2026-10-06) owns the current contract; [State](bob-delivery-flow.md#state) owns the next action.

### K4 cut-fit member/model acceptance — 2026-10-06 09:06Z

[PR #210](https://github.com/EmelieHagander/Bob-the-builder/pull/210), exact head `ddb658edd467af75f647a391d43c0abbe4677aff`, passed **940/940 tests**, Edge types, builds, PWA and all required browser gates in [CI 37438269944](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37438269944), job `112185362996`. The 13 focused session/checkpoint tests include both exact saved needs, missing/changed/extra data, pending/failed jobs and forbidden reruns. Merge `a21d8b1ee7df4accec1ea0de77fd641c92af282f` matches reviewed tree `d0f3944db52408b446fd99652d8968c398eff731`. Manual review followed repository verification and Archie guidance; no independent subagent or actual browser-login acceptance is claimed.

Fresh readback confirmed the unchanged deployed endpoints (ask-bob 83 / worker 51 and the bundle hashes above), the completed recovery turn, no active job and both current needs. Workflow-only activation `6a16d4d9e12eff8a0587041c7d987b4485d7978a` triggered [Live K4 cut fit acceptance 37440320580](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37440320580), job `112192201582`, first attempt, **success**. Ordinary password login used the existing `github-pages` environment's `BOB_USER_EMAIL` / `BOB_USER_PASSWORD` and verified the original member before one natural-language request. No new account/environment, migration, Edge release or model/manual change was made. Only the runner's own session was signed out.

The new turn is `58d32191-8ac0-4847-8df7-8083f96c75e3`, durable job `3e7b1434-0f89-4537-add6-d0da9ff42a48`, created **09:03:57.404Z**, completed **09:06:32.915Z** (155.5 seconds). It continued the original project, construction revision 4, pinned plywood material revision 1 and needs `2b5ffd76-5ece-4f32-b2e4-7e4112391003` / `48a56c7f-82fd-4daf-8b41-e04e39717be2`. No parts or tool calls were injected into the user request, and no completed job was replayed.

An in-flight scoped journal snapshot captured the model's actual arguments: both candidate formats had `provided_spec` basis, explicit kerf/trim/length grain, exact material pin and side-panel local z / shelf-panel local x grain. The first check offered both candidates; the model then isolated the narrow candidate in a second check. Durable `bob.execution_events` independently records executed `check_construction_cut_fit` statuses **feasible** (step 3) and **infeasible** (step 4), following construction and both need reads. Delivery records **answered**, five steps, six tool calls, zero nudges, zero deferred calls and zero saved records. There were five ask-bob model calls plus two context-summary calls. Recorded totals are 196,852 input tokens, 10,533 output tokens and estimated USD 0.289567; this is execution telemetry, not an invoice or a complete provider cache/billing breakdown.

Manual review of the complete saved answer confirms all five placements on one **2440×1220×21 mm** hypothetical sheet, **3 mm kerf**, **5 mm trim per edge**, and the requested grain:

| Instance | Placement x,y (mm) | Blank length×width×thickness (mm) |
|---|---|---|
| P1 / left_side | 5,5 | 800×300×21 |
| P2 / right_side | 808,5 | 800×300×21 |
| P3 / bottom_panel | 5,308 | 658×300×21 |
| P4 / top_panel | 808,308 | 658×300×21 |
| P5 / middle_shelf | 1611,5 | 658×300×21 |

The answer gives the ten extraction cuts in order: x805, y305, x1608, y305, x663, y608, x2269, y305, x1466, y608, with each cut's segment limits and the appropriate released part. These match the executable deterministic result; edge trim is the input preparation, not an additional claimed extraction cut. The **10000×299×21 mm** zero-trim candidate is correctly rejected because every blank needs 300 mm width despite sufficient total area. The answer preserves physical stock/product verification, actual production kerf/grain, screw products/dimensioning and assembly/tool access as gaps, and explicitly does not claim fabrication readiness. Saved answer delivery is completed, `partial=false`, `writes=[]`.

Independent before/after full-row readback matches exactly: current-need digest `5f0688a002e1e8300c792192acba811c`, need history `d17d86d8914c2d379a635ff28915c69e`, source provenance `f8668367bf5851b9728fe9df2af4a6bd`, construction history `f0c60c487da6553c90675c4bbce5965d`. These use ordered complete JSON rows; the construction digest's serialization differs from the earlier release query. Both needs remain revision 1 with quantities 2 and 3, construction head 4 and drawing head 1. Caller readback also preserves the full recipe/joints/materials/parameters/open questions, drawing, stock revisions and zero stock/component allocations or Shopping relations. The synthetic report is retained for seven days in `live-k4-cut-fit-37440320580-1`; credentials and operational reports remain outside git.

**This scoped ordinary-member/model cut-fit acceptance is green.** Workflow delivery/preservation alone was not treated as semantic acceptance: actual executed tool statuses, arguments, answer and independent unchanged-record checks were reviewed. Persisted cut plans, physical stock/product formats, whole-piece capacity/reservation, compatible Shopping, hardware and linked/access-checked assembly remain open. The unchanged runner will stop before another paid turn because the conversation checkpoint has advanced. [State](bob-delivery-flow.md#state) owns the next work.

## K4 saved cutting plans technical release — 2026-10-06 10:31Z

[PR #211](https://github.com/EmelieHagander/Bob-the-builder/pull/211) adds versioned cutting plans under the existing exact construction blank needs, optional formats on existing stock revisions and current whole-sheet capacity preview. Reviewed head `3c4aee333182b9332f73fd3a59476a3fe60c4053`, tree `23bc91535216c0a9d5c49d2c13c99968b4f7d687`, merge `cce8619752a93b42f174e4d6531bd442a481f972`; the merged tree was independently read back and matched the reviewed local/remote tree. Review used owning contracts, Archie and verify instructions plus direct code/SQL review by the primary agent; no independent subagent review is claimed.

Local validation passed 954 tests, build, PWA, vocabulary and frontend typing. Exact-head [CI 37448273639](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37448273639), job `112218274134`, passed all 47 steps, including Edge checking, both builds and ordinary intercepted browser suites at phone/desktop sizes. Browser evidence came from CI, not a local browser or production Auth. [CAD lineage concurrency 37448273628](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37448273628), job `112218274204`, installed the complete schema in PostgreSQL 17 and passed 32 established source/request/construction races; this is not a claim of implemented cut-plan stock reservation. New isolated SQL/tool tests cover canonical saves/reopening, unchanged need history, idempotency, layout forgery, stale construction/need/material/format pins, duplicate stock aliases/capacity changes, stock lifecycle preservation and denied authority.

Only reviewed `20261006094400_construction_cut_plans.sql` was applied to existing project `yuobtgoidmmmwfqenkau`, ledger `20261006103025` / `construction_cut_plans`. The installed CLI aborted during migration creation; actual UTC fallback naming is documented. Hosted definition/grant readback confirms invoker public APIs/views, RLS on all three new plan tables, authenticated project-scoped read only, no direct client writes and no anon/service-role plan API or raw-table grants. The renamed stock implementation is not directly executable by authenticated clients. Rollback-only diagnostic on the retained five-blank construction passed actual claimed-caller v15 save, exact replay, saved-plan/project-work readback, forged-layout rejection, direct-write denial and anon denial. This was SQL-role verification, not ordinary Auth/model acceptance; no diagnostic plan, turn, receipt or revision remained.

Before/after full-row digests match: needs `5f0688a002e1e8300c792192acba811c` (2), need history `d17d86d8914c2d379a635ff28915c69e` (2), source links `f8668367bf5851b9728fe9df2af4a6bd` (2), construction history `6fdc8107865b7cfede58e24372b134e8` (4, ordered by artifact/revision). Both allocation and Shopping links remain empty. Security advisor findings match the prior baseline exactly; unindexed-FK, RLS-initplan and permissive-policy counts are unchanged. Four newly created FK/query indexes have expected unused-index notices before live use; they were retained for the declared access paths ([advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)). Existing unrelated advisories were not rewritten within K4.

Both Edge endpoints were independently deployed/read back ACTIVE from immutable merge `cce8619752a93b42f174e4d6531bd442a481f972`: `ask-bob` v84, JWT enabled, SHA-256 `34629de95c0ec49ece002af4e5ba9b620c0b359c06b8ce6ff86b2329d81b4388`; `bob-worker` v52, existing custom-auth/JWT-disabled boundary, SHA-256 `78a97f46118863dc5d5cf6f7c347851832ef92bc332f1593c045bf78ce7e5353`. Existing account/environment secrets and model/manual baseline remain in use.

The new saved-plan runner was installed manual-only in the reviewed change, then its own workflow path was activated at `b5acd0c03d55429ffa105e7452c38b6f1d8c50fc`, tree `e958532d1c6299e324cc1b4bf9148fcb630333c1`, after fresh readback of both endpoints, zero plans, completed cut-fit turn `58d32191-8ac0-4847-8df7-8083f96c75e3` and no active jobs. It uses ordinary password Auth with the original member/project and polls only one new durable turn. Actual-model delivery, complete answer, tool use and unchanged records must be reviewed separately; workflow success alone is insufficient. [Material planning](material-planning.md#k4-saved-cutting-plans--2026-10-06) owns the contract and [State](bob-delivery-flow.md#state) owns remaining work.

## K4 saved-plan model outcome and readback repair — 2026-10-06

The original ordinary-password [run 37450356423](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37450356423), job `112225150159`, submitted exactly one new turn `cdcbb834-91a9-4aee-9dff-98c847ee4d86`, durable job `1babf718-a586-4bf0-973a-9af75d08084f`. The model job completed from 10:32:01.143183Z to 10:33:32.998596Z and saved plan `7c9d8791-001e-4b6b-a85b-a3971ebd5842`, revision 1, under construction 4 and both unchanged need revisions. Captured actual arguments name one hypothetical 2440×1220×21 format, 3 mm kerf, 5 mm trim, `provided_spec` basis, exact material revision and side z / shelf x grain. No layout or tool call was injected into the request. Durable events confirm `save_construction_cut_plan` **saved** at step 2 and saved-plan/both-need reopening **ok** at step 3: four steps, eight tools, one saved record, zero nudges/deferred calls. Complete delivered answer is `partial=false`, with one normal `cut_plans` revision-1 receipt, all five exact placements/ten cut segments and explicit physical stock/product, fastener and access/fabrication gaps. Independent deterministic comparison matches placements, cuts, offcuts and used sheets; all original need/history/source/construction digests still match.

**The workflow is red, despite completed model saving/reopening.** Its post-delivery ordinary `read_material_cut_plan` request returned HTTP 500 / SQLSTATE 57014. Scoped log context identifies repeated source assessment through the joined `current_material_requirements` view, including the physical/parameter/construction assessment chain. All preceding protected-table/need/history reads returned HTTP 200 and passed; no second paid turn was submitted. A diagnostic authenticated-role EXPLAIN after warmup took 492.361 ms; it does not erase the observed ordinary HTTP timeout or establish cold HTTP acceptance. Original failure reports remain retained for seven days as `live-k4-cut-plan-37450356423-1`.

The proposed `20261006103941_cut_plan_bounded_read.sql` changes only saved-plan read freshness: assess the existing shared source graph once, check current Artifact and need heads/revisions/archive state directly, and reuse `effective_target_revision` for exact Area/Project target selection. It keeps the auth/project guard, material/format/capacity checks and immutable historical layouts. A controlled regression observes one graph assessment for a two-need read while retaining stale-need rejection. Neither a role timeout nor HTTP/model budget is increased. The same existing password helper has an explicitly read-only mode pinned to this completed turn and exact plan; its transport branch cannot enqueue a model job. CI/review, hosted migration and ordinary repeated readback are the remaining repair gates. [State](bob-delivery-flow.md#state) owns the next action.

## K4 saved-plan readback acceptance — 2026-10-06 11:03Z

[PR #212](https://github.com/EmelieHagander/Bob-the-builder/pull/212) closes the bounded-read repair gates above. Reviewed head `7820b7f03133e42315a429acc4f68cc6d4ca0144`, local/remote tree `c7289c052bfb3034be6aa96464da452c767ffdb7`, merge `be8fad6646464326bf59b0217f53c120c0a79d76`; independent merge-tree readback matched. Primary-agent code/SQL/owner review followed Archie and verify instructions; no independent subagent review is claimed. Local 956 tests, focused 13 SQL/tool and 16 password-boundary tests passed. Exact-head [CI 37451965767](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37451965767), job `112230398329`, passed all 47 steps including 956 tests, Edge checks, build/PWA and ordinary intercepted browser suites. [Concurrency 37451965811](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37451965811), job `112230398521`, passed the 32 established PostgreSQL races; new whole-sheet reservation remains unimplemented.

Only reviewed `20261006103941_cut_plan_bounded_read.sql` was applied to the same existing project, ledger `20261006110059` / `cut_plan_bounded_read`. Hosted function body exactly matches the reviewed migration; ACL, security-definer/search-path properties, project guards and all plan-table RLS/grants match the pre-repair baseline. Authenticated `statement_timeout=8s` is unchanged. Security and performance advisor finding identities/details match exactly, excluding observation timestamps. Diagnostic role-based EXPLAIN completed in 536.006 ms with 7,662 shared hits and no reads/writes; this is separate from ordinary HTTP evidence. The SQL-only repair requires no Edge deployment: independent readback confirms unchanged ACTIVE `ask-bob` v84 and `bob-worker` v52, both pinned to the immutable #211 merge above with their existing JWT boundaries.

After fresh completed-turn/no-active-job and exact data readback, the same existing workflow was activated strictly read-only at `d2341dd3f429a2e17f639e5f93e6aa3383010d88`, tree `3ed0f83949b37af2c29c8b679bcaa111224ae7a1`. [Ordinary-password readback run 37453735856](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37453735856), job `112236170027`, passed on its first attempt using the original `github-pages` secrets/member/project. Report says `readOnly=true`, `modelSubmitted=false`, original turn/job/plan unchanged, `recordPreservationPassed=true`, `answerPartial=false`. Three ordinary `read_material_cut_plan` HTTP requests returned equal current revision-1 plans in **361, 316 and 294 ms**. Report retained for seven days as `live-k4-cut-plan-37453735856-1`, artifact `11407877017`, SHA-256 `4e957410ab96a8dee74a18dbc35f478a92fba94df932cc2040df316937386d8a`; synthetic artifacts remain outside Git.

Manual review of the complete original model answer and captured actual tool calls confirms natural-language save/reopen delivery, one normal matching `cut_plans` receipt, both exact original need pins, five correctly placed blanks, ten correctly spanned cuts and explicit hypothetical-format/physical-stock/product/fastener/access/fabrication gaps. Independently recomputed placements, cuts, offcuts and used sheets match. This combines the original completed model delivery with repaired ordinary read acceptance; **the original run 37450356423 remains failed** and was neither rerun nor relabelled green. No replacement paid turn was submitted. Original telemetry totals five model calls (including context summary), 158,038 input / 5,377 output tokens and estimated USD 0.195491; this estimate is not an invoice or complete cache accounting.

Final full-row digests of both needs, history, source links and construction history still match the pre-save baseline above; allocation/Shopping links remain zero. Saved plan head (1) `81173ad578ebbb91176e569b616e29a2`, revision (1) `341613b9ef747eaa06574d6addd1c20e` and requirement links (2) `4f1d7738bbb4033e855fe687e56d25ac` match before/after repair and ordinary readback. The same turn/job remains completed and no active jobs exist. The scoped saved-plan member/model acceptance is green; physical stock/products, shared whole-sheet reservation, compatible Shopping, hardware and accessible assembly remain open. [State](bob-delivery-flow.md#state) owns the next action, [material planning](material-planning.md#k4-saved-cutting-plans--2026-10-06) the contract.

### K4 shared-sheet reservation code verification and release block — 2026-10-06

**Historical blocked checkpoint, resolved by the [hosted release below](#k4-shared-sheet-reservation-hosted-release--2026-10-06).** The failed calls and unchanged-runtime observations in this section remain historical evidence.

[PR #213](https://github.com/EmelieHagander/Bob-the-builder/pull/213), exact final head `9a21a573967a25f8c4bfdff86e871b1513495191`, passed **967/967 tests**, Edge types, builds/PWA and every required browser gate in [CI 37459694548](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37459694548), job `112255882329`. [PostgreSQL concurrency 37459694543](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37459694543), job `112255882067`, passed **41 observed-lock races**, including nine new plan/manual/source/stock/replay/release cases. The competing-plan case uses independent public commands. Two earlier race runs failed in fixture setup/assertions: duplicate operational names in one turn and an expected hold after a rejected source-first reservation. Those failures remain recorded. Final review also reproduced a false stale read when other needs reserve unused offered sheets; the repair checks actual held quantities for committed plans, while unreserved saves/reserves retain offered-capacity checks. Its expanded regression and all 33 focused SQL/tool/manual tests pass. Direct review followed repository verify/Archie guidance; no independent subagent review is claimed.

Merge `d596a1db90d02014467e39575672848b5a503687` matches reviewed tree `7eb4f063551dab8517cf7cc0a50cbb85df2deba1`. Final CI artifact `11412452634` contains the intercepted browser proof; catalog/receipt screenshots were inspected at 320/390/1280 px. This is fixture/browser and isolated PostgreSQL evidence, not ordinary physical-stock/member/model reservation acceptance. Existing needs/layouts are preserved; only actual used whole sheets are committed, aliases aggregate, stale commitments hold capacity until release and current manual allocations share capacity. Individual construction-blank allocation and Shopping guards remain. The hosted rollback-only five-blank reserve/replay/stale/release/authority probe was prepared and checked locally; it has **not run on the hosted database**.

**Hosted release is blocked, not complete.** Three calls to `apply_migration` for the reviewed `20261006111116_cut_plan_stock_reservations.sql` failed in the connector with `Invalid or expired requestState`, including a longer uninterrupted attempt. Independent readback after the failures confirms no reservation table, no v16 writer and no migration ledger entry. The ledger still ends at `20261006110059` / `cut_plan_bounded_read`; the legacy function retains OID `59012`, its existing ACL and definition digest `3bd316a5c5020e643d9e2ad36b1d944a`, including the exact one old sum. Authenticated role budget remains 8 seconds. Plugin settings already allow Supabase writes; no permission change was made. This is a connector error, not a reported automatic-approval rejection or SQL failure. No unsupported raw-DDL workaround, new project/branch, invented stock or paid model retry was used.

Both endpoints were separately reopened after the failed installation: **ask-bob 84 / JWT true** and **bob-worker 52 / JWT false with existing custom authentication**, still pinning reviewed #211 merge `cce8619752a93b42f174e4d6531bd442a481f972`. They were not deployed to the v16 source because its SQL prerequisite is absent. Fresh pre-release readback preserved all six original need/history/source/construction/allocation/Shopping digests and all three saved-plan/head/link digests. The original latest turn `cdcbb834-91a9-4aee-9dff-98c847ee4d86` remains completed with no active Bob job/claim. No new hosted reservation, stock or Shopping was created. The read-only workflow was not reactivated; no new ordinary-Auth readback or reservation model result is claimed.

**Resume:** restore a functioning migration connector, or obtain approval for the browser fallback required by the browser tool's connection-fallback rule. Recheck exact main/source, ledger, jobs/claims and original digests; apply only the reviewed pending migration to existing `yuobtgoidmmmwfqenkau`. Compare the 14 reviewed function source hashes and grants/RLS/advisors, retain the 8-second budget, deploy both endpoints from the same immutable reviewed merge with their current auth modes, run the rollback-only probe and prove original preservation. Then activate the existing fixed-turn read-only password helper and review three reads with reservation_revision=0/null for the original hypothetical plan. Compatible Shopping, physical stock/product/member/model reservation, hardware and assembly/access acceptance remain subsequent gates. [Material planning](material-planning.md#k4-shared-whole-sheet-reservation--2026-10-06) owns the contract; [State](bob-delivery-flow.md#state) retains this release blocker.

### K4 shared-sheet reservation hosted release — 2026-10-06

**The scoped #213 hosted release is complete.** This supersedes the connector blocker above, not the remaining physical-stock/member/model, Shopping, hardware or assembly acceptance. No implementation change or paid model turn was made. The operator followed the existing verify/Archie guidance directly; no independent agent review is claimed.

Fresh preflight found main `938c53e1cc9a2aabb1300d765925d3dbbe3ac06b`, the pending migration, unchanged ask-bob 84 / worker 52, zero active jobs/live claims and the exact original nine full-row digests. The reviewed merge `d596a1db90d02014467e39575672848b5a503687` has tree `7eb4f063551dab8517cf7cc0a50cbb85df2deba1`. This session's first `apply_migration` succeeded: existing project `yuobtgoidmmmwfqenkau`, hosted ledger **20261006163926 / cut_plan_stock_reservations**. Applied content is exactly `supabase/migrations/20261006111116_cut_plan_stock_reservations.sql` from that merge, source SHA-256 **0825c862ebfcfc7b1699f2b6c242866cef79b94b641754a868add9fde7de9dde**.

All 13 explicit function bodies match the reviewed source byte-for-byte; reversing the single reviewed substitution in the 14th, legacy arithmetic function restores its prior definition digest `3bd316a5c5020e643d9e2ad36b1d944a`. Its OID 59012 and authenticated-only ACL are preserved. Public APIs remain invoker functions, private helpers retain their reviewed definer/empty-search-path properties, and anon/service-role execution is denied. All three reservation tables have RLS and project-scoped authenticated SELECT only, with no direct client writes. Authenticated **statement_timeout=8s** is unchanged. Security advisor findings are identical; performance findings differ only by eight expected INFO notices for the new, not-yet-used reservation indexes. No index was removed.

Both endpoints were deployed only after installation/authority readback, then independently reopened:

| Endpoint | Version/status | Authentication | Bundle SHA-256 |
|---|---|---|---|
| ask-bob | 85 / ACTIVE | JWT true | `9fef60cdb62aac1607b649690ef86997016d172039fc19f8f476faabf6788987` |
| bob-worker | 53 / ACTIVE | JWT false; existing capability authentication | `80c097cc06e47048df8c876647e1a309678f6b2ebe279fc75b8f85bde0d13349` |

Both read-back entrypoints import the immutable #213 merge above. The worker's first bundling attempt failed on a GitHub raw-source broken pipe; the unchanged retry succeeded. Unauthenticated ask-bob GET and worker POST returned 401 (worker GET correctly returned 405). Existing secrets and model/manual settings were reused, not printed or changed.

The hosted rollback-only diagnostic passed against the retained five-blank construction and both original needs, with an **8-second local statement timeout**. Within one rolled-back transaction it created a temporary stock row, claimed an operator diagnostic turn, temporarily revised the existing plan to bind that sheet, and exercised the normal v16 save/reserve/replay/release receipts. It verified one shared sheet, exact layout/need preservation, stale reservation CAS rejection, changed-replay rejection, held capacity after a stock revision, explicit release/replay, two immutable reservation-history rows, hypothetical-plan rejection, raw-write denial, outsider RLS/command denial and anon denial. Initial probe attempts stopped on fixture checks (one-plan-per-construction rejection, numeric text comparison and an ambiguous diagnostic variable); all rolled back. Only the corrected final probe is counted as passed. No temporary stock, reservation, plan revision, diagnostic message, receipt or claim remained. This is SQL-role verification, not ordinary positive physical-stock/model reservation acceptance.

Independent readback after rollback and again after ordinary Auth verification matches every original need/history/source/construction/allocation/Shopping digest and all three saved-plan/head/link digests recorded above. Stock revisions remain empty. Additional before/after digests for thread `e0c38f5d7a0e0d3cca8bbd508513981e`, messages `9bee1977367fcf9230ce148acd4e2f39`, provider state `50e3bc34a35f71ecf590303aa1ad0b79` and receipts `6c08ceecf8914f9106586274b86b5cbe` also match across rollback. All three new reservation tables remain empty. The original latest turn `cdcbb834-91a9-4aee-9dff-98c847ee4d86` and job `1babf718-a586-4bf0-973a-9af75d08084f` remain completed; no active job/live claim exists.

The existing read-only password workflow was reactivated by a comment-only change at `5a838827ac437ec534aca7c8ec07104e0c173379`, tree `e9303cffb66dd68725c1e20e88345a44f92ccd3b`. [Run 37498120561](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37498120561), job `112387812176`, passed on attempt 1 using the existing github-pages secrets/member/project. The downloaded report independently confirms `readOnly=true`, `modelSubmitted=false`, `recordPreservationPassed=true`, `answerPartial=false`, the original plan/turn/job and three equal ordinary HTTP reads in **449, 396 and 438 ms**. Plan `7c9d8791-001e-4b6b-a85b-a3971ebd5842` remains current revision 1, hypothetical, `reservation_revision=0`, `reservation=null`, with all stock/Shopping/fabrication/evidence flags false. The unchanged helper recomputed the five placements, ten cuts, offcuts and used sheets; the original complete answer was reviewed again. This is new readback evidence, not a new model trial. Artifact `11427674302`, `live-k4-cut-plan-37498120561-1`, SHA-256 `e2d7cd376bbe293d38398f8fbb04eba53185c82905b00fc8d39c6550671f054f`, is retained until 2026-10-13; its operational report and credentials stay outside Git.

[State](bob-delivery-flow.md#state) owns subsequent work. Preserve the original hypothetical plan; compatible Shopping, actual physical-stock/product/member/model reservation, hardware and linked/access-checked assembly remain open.


## K4 catalog-sheet Shopping release — 2026-10-06

**Technical release complete, including frontend publication.** The original Pages blocker described below was resolved by the [publication follow-up](#k4-shopping-frontend-publication--2026-10-06). [PR #214](https://github.com/EmelieHagander/Bob-the-builder/pull/214) adds catalog-bound whole-sheet contributions to existing Shopping. Reviewed head `38590b9f930489b2de222a78f104acd10fc4ed43`, tree `cc1d87056121183932738ecdfd3d695f3c29ea91`, merge `2f9e395d3d8ca397f94a516b2b1b2a111ac1f4eb`; independent merge-tree readback matched. Direct code/SQL/owner/UI review followed Archie, Vera and verify guidance; no independent subagent review is claimed. [Material planning](material-planning.md#k4-catalog-sheet-shopping-contributions--2026-10-06) owns the contract, and [State](bob-delivery-flow.md#state) owns the next K4 gate.

[Exact-head CI 37515839422](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37515839422), job `112448392253`, passed **973/973 tests**, vocabulary, Edge types, normal/live-config builds/PWA and all browser gates. [PostgreSQL concurrency 37515839541](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37515839541), job `112448389709`, passed **48 observed-lock races**, including seven new Shopping races. Six new SQL/tool tests exercise aggregation, grain separation, replacement/withdrawal, replay/CAS, stale sources, ordered/manual/deleted-row fences and authority. The initial local full run was 972/973 because its grain fixture contradicted the selected format; the corrected fixture and final CI pass. Local focused Shopping/saved-plan tests passed 19/19. Local Edge checking could not fetch an external dependency; the required CI Edge check passed.

Intercepted browser fixtures verify contribution provenance, exact construction links, reload, retryable read errors and opening disclosure without toggling the purchased checkbox. Screenshots were inspected at 320, 390 and 1280 px. CI artifact `11438115946`, `installation-screenshots`, SHA-256 `b0dede3574c30591dcc6c09f2fffc53524aa2f8593ac069909f817026c26226a`, contains this evidence. These are browser fixtures, not proof that the production frontend has been published or that Bob has performed a real Shopping model delivery.

### Hosted installation and endpoints

Fresh preflight checked main, the exact reviewed merge tree, migration ledger, current Edge endpoints, zero active project jobs and original full-row fingerprints. The first `apply_migration` for this change succeeded on existing `yuobtgoidmmmwfqenkau`: **20261006192055 / cut_plan_shopping**, from reviewed `supabase/migrations/20261006184919_cut_plan_shopping.sql`, source SHA-256 **e97838195929fe1247958e46f156b5bbcd45a143228845e1b70b308e44d1cf83**. The seven new function bodies match reviewed source exactly; three wrapped prior bodies are preserved. Public commands remain invoker functions, private helpers retain their reviewed definer/empty-search-path settings, and the renamed prior private writers/readers no longer expose direct authenticated execution. The four new tables have RLS and project-scoped authenticated SELECT only; direct member writes and anon/service-role execution remain denied. Authenticated **statement_timeout=8s** is unchanged. Offline and deployed manual contracts match.

Security advisor findings match the immediate pre-release baseline exactly: 147 findings across seven categories. Existing findings were not repaired or represented as a clean security report. Performance findings change only by one new INFO unused-index notice for `cut_plan_shopping_contributions_revision_idx` and disappearance of the pre-existing `catalog_profile_rules_right_idx` unused notice after probe usage; all other finding identities/details match. No index was removed.

Both endpoints were deployed after installation/authority verification and independently read back ACTIVE, importing immutable merge `2f9e395d3d8ca397f94a516b2b1b2a111ac1f4eb`:

| Endpoint | Version | Authentication | Bundle SHA-256 |
|---|---|---|---|
| ask-bob | 86 | JWT true | `dce3662dfa5e81c7a2d24a2ca8cb2fe1b9f2b5f5b77a3f3f0be48426b6b76f54` |
| bob-worker | 54 | JWT false; existing job capability authentication | `a5b5f3f61bc547f46657a378f42f58cbc4cf07117c70a0ab0e1a0bebf242958c` |

Unauthenticated ask-bob GET and worker POST returned 401; worker GET returned 405. Existing secrets were reused without printing or changing them. No model/provider configuration changed.

### Rollback probe and preservation

The locally validated hosted probe passed once within a single transaction, with local statement timeout 8 seconds and lock timeout 5 seconds. It first rejects hypothetical publication, creates a temporary exact catalog format, and temporarily revises the original saved plan to bind that format while retaining the five placements, ten cuts and both need pins. Normal claimed-turn v16 commands publish one actually used sheet, preserve exact receipt replay, reject changed replay/stale Shopping revision, expose Shopping provenance, block direct quantity edits and ordered withdrawal, then withdraw after restoring temporary status to needed. The existing Shopping row reaches `0 pcs`. Raw new-table writes, outsider reads/commands and anon access are denied. The entire transaction rolls back. An ambiguous diagnostic variable was corrected during local probe validation; no failed hosted probe is counted as passed.

Independent full-row readback after rollback and again after ordinary Auth verification matches all **17 protected project-scoped row sets**. Digests use `md5(coalesce(jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text),'[]')::text)`; different historical ordering/scopes must not be compared as if identical.

| Row set | Count | Before/after digest |
|---|---:|---|
| current_material_requirements | 2 | `5f0688a002e1e8300c792192acba811c` |
| material_requirement_revisions | 2 | `d17d86d8914c2d379a635ff28915c69e` |
| material_requirement_construction_sources | 2 | `f8668367bf5851b9728fe9df2af4a6bd` |
| artifact_construction_revisions | 4 | `f0c60c487da6553c90675c4bbce5965d` |
| material_requirement_stock | 0 | `d751713988987e9331980363e24189ce` |
| material_requirement_shopping | 0 | `d751713988987e9331980363e24189ce` |
| material_cut_plans | 1 | `81173ad578ebbb91176e569b616e29a2` |
| material_cut_plan_revisions | 1 | `341613b9ef747eaa06574d6addd1c20e` |
| material_cut_plan_requirements | 2 | `4f1d7738bbb4033e855fe687e56d25ac` |
| stock_revisions | 0 | `d751713988987e9331980363e24189ce` |
| materials | 0 | `d751713988987e9331980363e24189ce` |
| catalog_items | 2 | `02eefe7f4609c9e91ecff235abf7f351` |
| catalog_item_revisions | 2 | `4d4cfa149f61a663e76a1276f6aa1d05` |
| bob_threads | 1 | `39ffdbd6bfc16b89d9f0e098b071e64c` |
| bob_messages | 19 | `e5ac08905b76e648c3fdcb6f4a5e1fd2` |
| bob_write_receipts | 22 | `4e529e9b1d47ce881c6f14105d5a45d1` |
| provider_state | 1 | `b93e290cfd1ab2835189de448e772bdb` |

All four new Shopping tables and all three reservation tables remain empty; no active project job remains. Original project `p_43702f4cbdfb40f0907f5cd0c12a5143`, construction `01349f1c-100b-4ac2-a5b9-de4c839b51a4`, plan `7c9d8791-001e-4b6b-a85b-a3971ebd5842` revision 1, completed turn `cdcbb834-91a9-4aee-9dff-98c847ee4d86` and job `1babf718-a586-4bf0-973a-9af75d08084f` are preserved. No temporary catalog/Shopping/stock, plan revision, diagnostic message, receipt or claim persisted. This is positive SQL-role Shopping verification, not physical-stock/product or ordinary member/model Shopping acceptance.

### Ordinary read-only acceptance and frontend blocker

The existing fixed-turn password helper was activated by comment-only workflow commit `e860bfad41777dd59d33ac8a177990044ec79bb4`, keeping `BOB_K4_VERIFY_ONLY=saved-plan`, existing secrets and all guards. [Readback run 37518521714](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37518521714), job `112457575332`, passed attempt 1. The downloaded report confirms `readOnly=true`, `modelSubmitted=false`, `recordPreservationPassed=true`, `answerPartial=false` and the same completed turn/job. Three equal ordinary HTTP plan reads took **673, 609 and 331 ms**. The original plan remains current, hypothetical, revision 1 with `shopping_revision=0`, `shopping=null`, `reservation_revision=0`, `reservation=null`; all readiness/evidence flags remain false. Five placements, ten cuts, offcuts and used sheets still match independent recomputation. The helper used the same existing member and closed its own session; no new paid model turn ran.

Artifact `11437942858`, `live-k4-cut-plan-37518521714-1`, SHA-256 `d5f0e296886d169f13e53f0e5604a877793cd155fb9c96cd57b319ded485dfac`, is retained until 2026-10-13T19:23:22Z. Operational reports and credentials remain outside Git.

**Historical frontend blocker, resolved below.** The existing `pages` concurrency group has `cancel-in-progress: false`. Older [Pages run 37372469242](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37372469242), head `f1f9a3db18ed888d463229f78ccd8a0d039882a0`, was created 2026-10-05T20:52:59Z: build job `111972755371` succeeded, but deploy job `111976511274` remains queued. Newer main releases wait pending; activation run `37518521697` has no jobs, while superseded pending merge run `37517636345` was cancelled. Current workflow/job state and the concurrency configuration indicate that the older run blocks the queue; no outage cause is asserted. The GitHub connector has no cancellation operation. Browser fallback requires user approval under the browser tool's connection-fallback rule, so no browser cancellation, alternate concurrency group or replacement deploy workflow was used.

**Historical resume instruction, completed below:** recheck current Pages runs, obtain approval for the browser fallback, cancel only the obsolete blocking run if still queued, and observe the latest main Pages deployment and published Shopping UI. Do not rerun migrations, Edge deploys or the completed model save/readback. After frontend publication, mixed stock/purchase fulfillment, actual physical-stock/product/pack/member/model acceptance, hardware and linked/access-checked assembly remain separate K4 gates. Broader K2/K3 acceptance and K5 remain open.


### K4 Shopping frontend publication — 2026-10-06

The user explicitly approved browser fallback to cancel the obsolete Pages run and finish publication. Fresh connector and browser readback still showed run `37372469242` queued and latest-main run `37519560609` pending. The normal GitHub **Cancel workflow** action was used only on the obsolete run; independent API readback confirmed `completed/cancelled` at **20:45:02Z**. No permissions, environment protections, secrets or concurrency configuration were changed, and no model workflow was rerun.

[Pages run 37519560609](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37519560609) then progressed automatically and completed successfully for main `18d3d11b9b70befb8ef644a9a0e59e953dcdd675`, containing reviewed #214 unchanged. Build job `112492541121` and deploy job `112492784992` both passed; the deployment evaluated the existing URL `https://emeliehagander.github.io/Bob-the-builder/` at **20:45:48Z**. Published artifact `11443467054`, `github-pages`, SHA-256 `c5d7aa43292da38407f87390bf0a9dc20c549ae001f080d072d3fdfcbf13f0a6` was independently downloaded and inspected.

The live public `index.html` and its referenced `assets/index-LBq0AAg0.js` both returned HTTP 200 and match the published artifact byte-for-byte. HTML SHA-256 is `89906c18e8d085d4e6bde61779e534437b7503552a5ed43b20dc9dc41556f62a`; JavaScript SHA-256 is `7bfac5e3ad3ee59200d84b965e491b57e605c74613a12990cfa5ca0f5ec5b7cc`. The live bundle contains the new cut-plan contribution disclosure, whole-sheet wording and supplier-product/pack-size warning. A fresh browser opens the production application and renders its normal sign-in screen. It has no Bob member session, so this is public application/asset publication evidence, not a new authenticated Shopping interaction. The previously passed 320/390/1280 browser fixtures own that UI behavior evidence; the original ordinary-password readback owns retained-plan acceptance.

The #214 technical release is now complete. No migration, Edge deployment, paid model turn or persistent test data was repeated during this follow-up. State proceeds to mixed stock/purchase fulfillment and the separately open physical-stock/product/pack/member/model, hardware and assembly gates; this does not declare the whole K series complete.

### K4 mixed sheet supply — reviewed code, hosted release blocked — 2026-10-07

**Historical blocker, resolved by the [hosted release below](#k4-mixed-sheet-supply-hosted-release--2026-10-07).**

[PR #215](https://github.com/EmelieHagander/Bob-the-builder/pull/215) is merged. Reviewed head `f08be8078cc64f78f30735903cbb8c6d0c2781c7` and independently reopened merge `38d52577fe22e97f3b331adc088dabf4094f8fab` have the same tree `2befeef04a409681144e86c660ffbc6e3cfd2c6b`. The existing stock reservation and Shopping commands now support their respective portions of the same mixed layout, with independent CAS/receipts and explicit partial coverage. [Material planning](material-planning.md#k4-mixed-stockcatalog-supply--deployed) owns the contract. Direct review followed the existing Archie/verify guidance; no independent subagent review is claimed.

[Final-head CI 37533892825](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37533892825), job `112509827127`, passed **977/977 tests**, Edge types, vocabulary, production/live-config builds, PWA and every required browser gate. [PostgreSQL concurrency 37533892877](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37533892877), job `112509827309`, passed **55 observed-lock races**, including seven mixed-supply races. Focused local tests passed 21/21. The initial local full run had a process-level catalog-parity test failure; its isolated rerun passed, but only final CI is claimed as a full-suite pass. The first concurrency run failed because the new fixture variable leaked into an earlier loop; the final head fixes that test-script error and passes. No new UI behavior was introduced; existing browser gates passed in CI.

**Hosted release is blocked at the migration connector.** The reviewed file is `supabase/migrations/20261006211841_cut_plan_mixed_supply.sql`, SHA-256 `afc132a38cd561c3df9e8c4ecd6dd404e2d605be1f2c6653ea24a0aa98cf2ba7`; apply it as `cut_plan_mixed_supply` to existing `yuobtgoidmmmwfqenkau`. The first `apply_migration` returned `Invalid or expired requestState`. Two subsequent attempts were interrupted without a confirmed tool result. Fresh readback after the final interruption confirms no mixed-supply ledger entry and unchanged prior function bodies:

| Private function | Still-deployed body MD5 | Required reviewed body MD5 |
|---|---|---|
| cut_plan_stock_command | `490587dcc2183cded5aaa2110039947c` | `ea808ab4eb35eb65986cd89d1cbe2320` |
| cut_plan_shopping_command | `5ee1d7d5dbcc783dd5b78f4bb4851a30` | `9d3d2023cc57005bcda337d4d0e9baa6` |
| read_cut_plan | `6c3193eeb96e04be38cc72168cc9a4cb` | `f23c0aec93c6c7cde33d56654189ee6c` |

The ledger also contains another session's unrelated `20261006214258 / akr_missing_slots_seed_trays_and_icons`; it was not modified. Resume readback found ask-bob **86 / ACTIVE / JWT true** and bob-worker **54 / ACTIVE / JWT false**, both still importing reviewed #214 merge `2f9e395d3d8ca397f94a516b2b1b2a111ac1f4eb`. This session performed no #215 Edge deployment. Authenticated `statement_timeout=8s`, the eight inspected function ACLs/search paths/definer modes and the original completed job remain unchanged; zero active project jobs were found. Before the interrupted attempts, all 25 protected project row-set digests matched the preflight baseline, including the original hypothetical plan, source/need histories, conversation/receipts and empty reservation/Shopping commitments. No hosted rollback probe or new ordinary-password acceptance is claimed for #215.

The mixed-supply rollback probe was prepared and passed locally: temporary one-stock/four-catalog supply for the retained five blanks, normal claimed-turn save/reserve/publish and exact replay, stale CAS/altered replay denial, Shopping provenance, ordered withdrawal rejection with independent stock release, explicit withdrawal, raw-write/RLS/outsider/anon denial, then unconditional rollback. Hosted execution and post-probe original-data comparison remain pending. No persistent test stock/catalog, new environment, changed secret or paid model request was created.

**Resume:** restore a functioning migration connection, then recheck main/source, ledger, current endpoints, jobs/claims and all original digests. Apply only the reviewed missing migration above; verify its three bodies, unchanged authority/RLS/manual parity/advisors and 8-second budget before deploying both endpoints from immutable merge `38d52577fe22e97f3b331adc088dabf4094f8fab` with existing authentication. Run the rollback-only mixed probe, prove full preservation, then reactivate only the existing fixed-turn `BOB_K4_VERIFY_ONLY=saved-plan` password readback via its workflow comment. Review three equal original-plan reads and the new `supply` fields; do not replay the paid model save. Record hosted evidence and update State only after these gates pass. Physical stock/product/pack/member/model, hardware and assembly acceptance remain separate; the whole K series is not complete.

#### Migration retry — 2026-10-07 morning


The user authorized continuation. Fresh GitHub readback confirms #215 merged at the immutable source above and both final-head CI runs successful. Main was `3f7a42455d96e16ab6f2f732ce238543b980b603`; migration SHA-256 and merge tree still match the reviewed values. Fresh hosted preflight found no mixed-supply ledger entry, the three prior function body hashes above, ask-bob 86 / JWT true and bob-worker 54 / JWT false, authenticated `statement_timeout=8s`, zero active project jobs and zero in-flight provider claims. Unrelated migrations from other projects were left untouched.

Two new `apply_migration` calls both returned `Invalid or expired requestState` (`INVALID_ARGUMENT`, JSON-RPC -32602, reason `invalid_request_state`). The MCP endpoint is reachable (unauthenticated HTTP 401) and SQL reads work; this does not establish the cause of the write-request failure. No Supabase CLI or database connection environment was configured for a direct fallback. No alternate SQL write path was used.

Independent final ledger readback still finds **zero** `cut_plan_mixed_supply` entries. All **25 protected project row-set fingerprints** match this turn's preflight, including the prior release's 17 sets, seven empty reservation/Shopping sets and 12 original job rows (job digest `751fc9ed25a9eb7b69993da13550e6ec`). No Edge deployment, hosted probe, password workflow or model request ran. Release remains blocked. Browser fallback requires separate approval under the browser tool's connector-fallback rule; the earlier approval concerned GitHub Pages, not Supabase. Resume with the same reviewed migration and verification order once that path is authorized or the connector is restored.

### K4 mixed sheet supply hosted release — 2026-10-07

**The scoped #215 technical release is complete.** This supersedes the migration connector blocker above. [Material planning](material-planning.md#k4-mixed-stockcatalog-supply--deployed) owns the mixed-supply contract; [State](bob-delivery-flow.md#state) retains physical stock/product/pack/member/model, hardware and assembly acceptance. The existing 977-test / 55-concurrency-case final-head CI evidence above remains valid; it was not rerun or represented as a new model trial. Direct operator review followed Supabase, Archie and verify guidance; no independent subagent review is claimed.

After the user explicitly authorized a retry, browser fallback and documentation publication, fresh preflight again found the reviewed source/hash unchanged, no mixed-supply ledger entry, the prior three function bodies, zero active project jobs/provider claims, and the same 25 protected row-set fingerprints. The first new `apply_migration` succeeded on existing `yuobtgoidmmmwfqenkau`: **20261007090620 / cut_plan_mixed_supply**, exact reviewed file `20261006211841_cut_plan_mixed_supply.sql`, SHA-256 `afc132a38cd561c3df9e8c4ecd6dd404e2d605be1f2c6653ea24a0aa98cf2ba7`. No browser fallback was needed. Unrelated project migrations were not changed.

All three private bodies match the required MD5 values in the table above. Eight inspected APIs/helpers retain their reviewed execution grants, invoker/definer modes and empty search paths; the prior private reader remains inaccessible to authenticated clients. All seven reservation/Shopping tables retain RLS with project-scoped authenticated SELECT only. Anon and service-role execution of the member APIs is denied. Authenticated **statement_timeout=8s** remains unchanged. Both hosted manuals match the migration and offline catalog exactly.

Security and performance advisors were inspected. No security finding names the three changed helpers or seven commitment tables. The project-wide security result contains 147 findings across seven categories, including unrelated schemas and pre-existing Bob private-table/privileged-command notices; this is not a clean security report or an exact finding-by-finding baseline comparison. Performance results contain 197 unindexed-FK, 160 auth-initplan, 414 unused-index and 239 multiple-policy findings project-wide; no index or policy was changed in this release. Existing advisory scope remains separate from this narrow release.

Both endpoints were deployed after installation/authority verification and independently reopened, importing immutable reviewed merge `38d52577fe22e97f3b331adc088dabf4094f8fab`:

| Endpoint | Version/status | Authentication | Bundle SHA-256 |
|---|---|---|---|
| ask-bob | 87 / ACTIVE | JWT true | `535cb62bc8cc6d485e12cbbcdf9566d2fe8be43f0151bd9901326dbca573670b` |
| bob-worker | 55 / ACTIVE | JWT false; existing job capability authentication | `8c6bf27eeb026e9cba07acf826f4db917f31c3b41cfaa55cbbd8aaa6a811a59f` |

Existing secrets/provider/model settings were reused without printing or changing them. An additional unauthenticated HTTP check containing a worker POST was rejected by automatic approval review for possible side effects and was not retried through another route; no live 401/405 result is claimed for this release. The reviewed worker source rejects a missing/non-UUID capability before reading a job or performing any RPC; deployment metadata and immutable source establish retained authentication configuration.

The prepared **hosted rollback-only probe passed on its first execution**, with local statement timeout 8 seconds and lock timeout 5 seconds. It temporarily bound the retained five blanks to one stock sheet and four catalog sheets, then exercised normal claimed-turn v16 save/reserve/publish, exact receipt replay, partial and complete coverage, stale CAS and changed-replay rejection, Shopping provenance, ordered-withdrawal protection, independent stock release, explicit withdrawal, raw-write denial, outsider RLS/command denial and anon denial. The entire transaction rolled back. Independent full-row digest readback immediately afterward and again after ordinary Auth matched all **25 protected project row sets**, including the original plan/history/needs, conversation/provider/receipts and 12 original jobs. All seven commitment tables and the stock/Shopping test rows remain empty. No temporary catalog, stock, plan revision, receipt or claim persisted.

The existing fixed-turn read-only password helper was activated by a **comment-only** workflow update at `02ab22388eac6fdb15d3b872fd3637ac1170c776`, tree `a563b6db82218a0f7210efa5f1f285ffa2d10d55`, preserving `BOB_K4_VERIFY_ONLY=saved-plan` and all guards. [Run 37598661244](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37598661244), job `112717355736`, passed attempt 1. The downloaded report confirms `readOnly=true`, `modelSubmitted=false`, `recordPreservationPassed=true`, `answerPartial=false`, the same original completed turn/job and three identical ordinary member reads in **3261, 1661 and 937 ms**. These are HTTP elapsed times, all below the retained database budget; no tighter latency guarantee is inferred.

Plan `7c9d8791-001e-4b6b-a85b-a3971ebd5842` remains current revision 1, hypothetical, with reservation/Shopping revision 0 and null commitments. The new `supply` object reports used=1, stock=0, catalog=0, hypothetical=1, and all three commitment flags false. Stock/Shopping/fabrication/input-evidence flags remain false. Independent recomputation still matches all five placements, ten cuts, offcuts and used sheets; the original complete answer was reviewed. Artifact `11471463239`, `live-k4-cut-plan-37598661244-1`, SHA-256 `8c50c9f7df65e39754524ce4c2554a54c6477725f6bdaa2c6fb6e9121b76627b`, expires 2026-10-14T09:10:08Z. Operational reports and credentials stay outside Git.

[Pages run 37598661138](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37598661138) also completed successfully for that same commit. #215 introduced no new rendered UI behavior. This closes technical mixed-supply release and retained-plan readback, not real physical-stock/product/model acceptance or the whole K series. No paid model request, new environment or persistent test stock was created.

### K4 product/physical acceptance preflight — 2026-10-07

Read-only preflight on main `ccdc0cb11cfab832c9b779be14c76af82fbb09fd` found zero stock revisions and zero Shopping rows in the retained verification project, and two catalog identities, both material definitions at revision 1. There is no saved panel-part/supplier article in that project. Scoped schema inspection and the current catalog/material contracts confirm that versioned supplier products, product evidence and purchase-unit/pack bindings remain specified rather than implemented. The general knowledge seed also explicitly excludes current manufacturer-evidence ingestion. No other project's inventory was inspected or selected as a substitute.

The [material owner's prepared acceptance gate](material-planning.md#k4-product-and-physical-input-acceptance--preparation) now separates physical observation, catalog format, supplier/source identity, pack evidence and commitment behavior. Its AC-14 expectation is one 100-pcs pack for 90 pcs remaining after stock, with 10 pcs surplus; this is a required test, not a newly run test. State corrects the stale mixed-supply row and puts the product/pack implementation prerequisite before positive product acceptance. Actual project/stock/product inputs remain needed for the physical trial. No new code, migration, deployment, Auth/model run or persistent fixture was created in this preparation. The original hypothetical plan and completed job were not mutated. Broader K2/K3 acceptance, hardware/assembly and K5 remain open.

### K4 supplier articles and pack purchases — code, 2026-10-07

**Reviewed code only; no hosted migration, Edge release, Auth or model run.** Contract: [material planning](material-planning.md#k4-supplier-articles-and-pack-purchases). Migration `supabase/migrations/20261007140000_supplier_article_packs.sql`.

- `tests/supplier-article-packs.test.ts` 6/6 on PGlite: AC-14 (90 pcs → 1 pack, 10 surplus, stock subtracted once, both need links), receipt replay and `operation_reused`, unknown pack size unresolved and unpublishable, source-unsupported pack size rejected, unit mismatch, competing article and ordinary Shopping double-route rejection, changed article/need staleness, stale CAS, edited/ordered/deleted Shopping rows, withdrawn article, outsider/anonymous/direct-table denial, Bob tool parser.
- Full local suite 983/983; `npm run typecheck`; `npm run verify:foundations` with Playwright Chromium passed at 320/390/1280 px including the new Shopping pack-source fixture (`test-results/pack-purchase-shopping-*.png`). Browser fixtures are HTTP-intercepted, not live data.
- `scripts/check-cad-lineage-concurrency.ts` adds seven pack races with an observed lock wait each: competing articles on one need, writer replay, same-article stale CAS, ordinary Shopping before/after a pack claim, need revision first and an ordered row before a changed-evidence republish. Locally on disposable PostgreSQL 16 all 62 races passed; CI runs PostgreSQL 17.
- Not covered: hosted installation and an actual member/model trial with real stock/product inputs.
- Prepared, not run: `.github/workflows/live-pack-purchase.yml` (dispatch-only, main) runs `scripts/run-live-pack-purchase.mjs` → `scripts/check-live-pack-purchase.ts`. One paid turn in the retained K2/K3 verification project: Bob estimates the shelf's 5,0×80 screw need from the saved screwed joints, records the Byggmax 15 st variant (ART.NR 249687, read from the product page on 2026-10-07; 200/700 st show no article number) and publishes whole packs. Code re-derives the pack count and surplus and checks that blanks, construction, cut plan and stock are unchanged. Requires the migration and ask-bob/bob-worker deploy first.

### Drawing request loop budget release — 2026-10-09

[PR #234](https://github.com/EmelieHagander/Bob-the-builder/pull/234) is merged and deployed. Merge `9705a8b671695ac7a86b142989b0a8771ac051d5` matches reviewed head `c0d71a74c9d896029fd7e725f02464cd5e538c5d`, tree `98d7097d52cdfd43b939fda625de3d88545f417c`. Independent code reviews found no release blocker. [CAD budget and review](cad-adapter.md#drawing-request-budget-and-review--2026-10-09) owns the runtime contract.

The real bed job `d1ccfb0e-9ed2-42ed-b716-e16d2c5dfeed` stopped at the ordinary turn's $0.85 boundary after six successful provider calls costing $1.159521; its request ledger was separately $2.203370 against $2 after an owner grant. Two renders existed, with no review or canonical save. This was a conflicting accounting boundary rather than the 20-minute job expiry. The deployed runtime gives server-bound CAD calls one persistent request ledger, reviews a valid render immediately, stops an identical rejected candidate before another renderer/reviewer call and invalidates recovery only for relevant CAD dependencies. Ordinary Bob and unbound calls keep their existing guard.

Final local suite passed **1080/1080**. Exact-head [CI 37980764170](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37980764170) passed tests, Edge checks with the original network dependency, vocabulary, builds and all required browser gates. [CAD adapter 37980764021](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37980764021) passed the real Python worker and adapter checks. Focused verification covers request-scope accounting, review/repair and no-progress behavior, runtime fingerprints, isolated SQL upgrade preservation, idempotent owner grants, pending/unpriced boundaries and journal replay. No new SQL function or schema was introduced.

Fresh main/tree and quiescence checks found zero live queued/running Bob jobs. **bob-worker was deployed first**, then ask-bob, before the allocation migration could awaken recovery. Hosted source readback matches every included immutable bundle file (81 worker, 83 ask-bob); the pre-existing bundler omissions are type-only provenance and the worker's unused HTTP-handler dependency. Authentication settings are unchanged.

| Endpoint | Version/status | Authentication | Deployment JSON SHA-256 | Hosted bundle SHA-256 |
|---|---|---|---|---|
| bob-worker | 61 / ACTIVE | JWT false; existing job capability | `dd91448af2286c8d2ff8d131f68d470e3447ef7bc909ca04d6160830362ee3dd` | `85b6c05ca283016372659c7f5a307d510eaa2b4950a6654e23c997e8f18db6ec` |
| ask-bob | 93 / ACTIVE | JWT true | `9746901a65d2c4c45e352ed1e074f46163a3332b950f4e9858d80c5b38f3a4a4` | `58a3d84e3df236b75205308402a7760f5b680cc34e92abf5d368d9cc49fed6c0` |

Existing source `supabase/migrations/20261008160000_drawing_budget_3usd.sql`, SHA-256 `a9f4de4f471c64a46ec292eda485b7043e5fa41eeca221827e51db32be835b90`, was applied to unchanged project `yuobtgoidmmmwfqenkau` as **20261009194934 / drawing_budget_3usd**. Its prior absence explained the hosted $1 default. Readback now confirms default $3 and exactly two eligible upgrades:

| Request | USD limit before → after | Spent USD retained | Calls/cap retained | Budget revision before → after | Draft MD5 retained | Working payload excluding retry MD5 retained |
|---|---|---|---|---|---|---|
| `3bc79294-7c78-4ca0-a97a-0e5dea4f672b` / bed | 2 → 3 | 2.203370 | 9/48 | 2 → 3 | `9ac55210c25c616893fc9dcfd4a2c195` | `41dadf22189992444bc847eacd2acfcf` |
| `c49d7325-52fb-4341-92cc-52db28f7ceb6` / existing test | 1 → 3 | 1.119091 | 12/24 | 1 → 2 | `cae5e41bbf2d8ddcd2e3b8a5e8f3017a` | `e9e91765c8e423fa91144f151f4d1c02` |

Both retain zero pending charges, `unpriced=false`, their request identities and historical retry outcomes; cost-stop fingerprints are cleared. Security advisor category/count baseline matches exactly. Performance categories/counts match except unused-index notices decreased from 382 to 380; no indexes or policies were changed. This is a baseline comparison, not a clean global advisor report.

The merge also triggered [Live Bob release check 37982456317](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37982456317), which passed actual guest Auth/RLS, OpenAI tools, image pixels and knowledge checks, plus [Pages 37982456363](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37982456363) and [CAD adapter 37982456375](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37982456375), both successful. The live check finished at 19:47Z, before the new Edge deployment at 19:48Z, and did not exercise CAD; it is continuity smoke evidence, not acceptance of the new CAD budget runtime. Its fourth disposable guest project is `p_b09d5b5514ce4bec92a2199fcd4cb102`; the script removed its image bytes/metadata through ordinary caller commands but does not delete the project. Guarded project cleanup remains in State alongside the three previously recorded fixtures. This task did not rerun the paid workflow.

At release readback no new bed job had started. The historical failed job stays failed; a fresh authorized continuation can reuse the same request and draft. No user message was impersonated and no new paid acceptance turn was submitted. Actual authenticated model recovery through independent review, canonical save and member readback remains the acceptance gate. The $3 dispatch threshold is finite and a final in-flight call can exceed it; completion is not guaranteed. A later owner message after a request USD/call stop can grant the existing idempotent +$1/+24 calls on that request; automatic recovery does not refill the ledger. [State](bob-delivery-flow.md#state) owns the next action.

### Drawing recovery status investigation — 2026-10-09

The owner's new interruption report after #234 exposed a separate status-projection problem. Read-only hosted inspection found the drawing recovery actually completed at **20:17:57Z / 22:17 Swedish time**. Event job `75d8631f-44f1-4fda-b1d0-188b2cec2d1c` uses original owner turn `6aa673cd-5d1f-4f6f-94b5-611d404969cb`; the original ordinary job `d1ccfb0e-9ed2-42ed-b716-e16d2c5dfeed` remains historically failed at 17:58Z.

| Evidence | Hosted readback |
|---|---|
| Same request | `3bc79294-7c78-4ca0-a97a-0e5dea4f672b`, saved revision 28 |
| Canonical artifact | `2ba8576b-c4c3-4136-9b7f-f31ecb6caa7d`, revision 1, concept, saved at 20:17:43Z; header/working receipts and input hash match |
| New assistant delivery | Sequence 13, event-job turn ID, completed, “Ritningen är sparad.”; partial=false and exact artifact write receipt |
| Older owner delivery | Sequence 12, original turn ID, still failed; its instruction remains visible |
| Added model work | One successful mini CAD reviewer call, $0.166613, then delivery-language call $0.009033; no repeat designer call |
| Persistent drawing budget | $2.369983 / $3, 10 calls / 48, budget revision 3, unpriced=false |

This establishes the new request-ledger review/save path on the named owner's existing work. It does not establish physical safety, full mixed-goal owner-turn completion or ordinary browser reread. The saved artifact remains explicitly a concept.

The frontend reproduced an additional current-sounding budget-stop notice after the completed saved reply: transcript recovery retained the old unfinished user turn, `bob_job_status` read only its failed ordinary job, and the event reply deliberately used a different turn ID. An already-open idle drawer also did not reload when a new delegated reply arrived. The correction adds owner/thread/origin-scoped drawing recovery status without rewriting historical failed messages, and refreshes the existing drawer from inbox changes. Unrelated replies, incomplete requests and mixed non-CAD goals do not become ordinary-turn completion receipts.

**Technical correction released; named-owner browser acceptance remains separate.** [Conversation owner](ask-bob-conversations.md) owns recovery semantics; [State](bob-delivery-flow.md#state) owns the remaining design and acceptance work. No paid test turn was submitted by this investigation.

#### Recovery-status release and reset boundary

[PR #235](https://github.com/EmelieHagander/Bob-the-builder/pull/235) was independently reviewed and merged as `a77de7431f3c4ef0a7b866c142e6c050550ac216`. Reviewed head `0d0beb1659f2d621fe926797cf0f8f76830849e4` has tree `4f9e4cad4d6ba1e12d20945351ed0f3d766eb73a`. [Exact-head CI 37989030600](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37989030600) passed **1093/1093** tests, original Edge checks, builds, PWA and all browser gates, including reset/recovery at **320, 390 and 1280 px**. CAD adapter run 37989030418 and lineage-concurrency run 37989030505 passed. The browser fixture exercises late saved replies, idle refresh, draft retention, reload and unrelated-failure isolation without another ask-bob POST. Screenshots were uploaded as artifact 11644618105; local retrieval returned HTTP 403, so this session does not claim additional human visual review of those screenshots.

Hosted migration **20261009210458 / bob_drawing_recovery_status** applies reviewed source `supabase/migrations/20261009203935_bob_drawing_recovery_status.sql`, SHA-256 **27e397dcebaa6b6b0c98d50596ebe4257a228907fff2cd9ce5cae3042d93f146**. Private helper OID 70452 has expected body MD5 `85f8884c91953cd4a66edd6b4ce8407a`; public invoker OID 64911/body MD5 `779702cce313e8487f7373bbafe3541f` is unchanged. Both keep empty search paths and postgres/authenticated-only EXECUTE; anonymous and service-role EXECUTE remain denied. [Pages run 37991195981](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37991195981) published the exact merge successfully at **21:06:08Z**; post-merge CAD adapter run 37991195982 passed. No Edge source changed or was redeployed; ask-bob 93 / worker 61 remain the runtime endpoints.

The owner reset the private conversation at **20:40:02Z**, after the successful-save observation above and before this migration. Reset retained request `3bc79294-7c78-4ca0-a97a-0e5dea4f672b` as saved with a detached thread and its Artifact receipt, and removed old private jobs/messages/working packet. The old completed-recovery live probe was therefore replaced, without recreating history. A rolled-back operator SQL-role simulation reads the old turn as null, current correction turn `bb6f8d6e-d4f3-47db-a98a-d076d75566ae` as queued with fresh expiry/progress, and comparison turn `e98c7060-fa21-41d6-b90c-a38b476b755f` as completed; outsider and anonymous calls are denied. Its record digests stayed unchanged. This is database-role readback, not signed-in member HTTP/browser acceptance. Exact completed recovery is proved by isolated SQL and CI fixtures.

Immediate pre/post-migration digests also match for the retained saved request (`b760b2029a24a7ad6a9d3032f4042bab`), request budget (`13a3b42e9cee1edf88e2786b008fd12e`) and historical CAD revision (`89939ad69bf22e612cc41feeeea9fbf4`). This preservation claim starts after the owner's reset. Security advisor categories/counts are unchanged; performance counts are unchanged except unused-index notices 378→377, without an index/schema change.

#### Mockup fidelity and shared design intent

The owner subsequently reported that the concept differs from the mockup: ladder orientation, missing display bookshelf, missing drawers and insufficient gable infill. Readback and rendering of saved CAD revision 1 confirm a ladder at the left of its front view, no bookshelf/drawer definitions or instances, and open lower gables; **two full mattress-support decks are present**. Bob's saved comparison additionally reports a mirrored guard opening and missing storage modules. The original private handoff was removed by the owner's reset, so this investigation cannot prove exactly where each original image feature was lost.

The existing selected Solution revision 1 still describes a simple compact bed with storage undecided and no source-media link. The deployed first-layout prompt already requires the whole construction and required functions; it defers optional joinery, fasteners and decorative details. Designer and reviewer already receive technical text and reference images. The narrower observed gap is that the mockup's defining features were not established in the visible selected design intent. During the initial connector inspection, private mockup metadata and the owner's/Bob's descriptions were readable but the original pixels could not be fetched. The later owner-supplied screenshots below provide direct visual evidence.

**Proposed, not implemented:** Bob reconciles the visible selected Solution with the chosen references and explicit prior owner choices before another design handoff. A concise, versioned object brief records reference roles, viewing orientation, defining form, required functions, dimensions, free choices and unresolved differences. Designer and reviewer use that same brief and original references; only consequential unresolved choices need the owner's decision. The owner's new correction job was observed read-only and was neither interrupted nor duplicated.

### Mockup screenshot comparison — 2026-10-09

At **23:18 Swedish time**, the owner supplied screenshots `14287.png` and `14286.png` showing the project's references `13424.png` (room mockup) and `13713.png` (bunk-bed concept). They were inspected directly alongside renderings of the exact saved CAD revision 1. Independent visual review agrees with the comparison below. This resolves the earlier screenshot-visibility limitation; it does not claim retrieval of the native private-storage files.

| Design feature | Visible reference evidence | Saved CAD revision 1 |
|---|---|---|
| Ladder and entry | Ladder at the right when facing the shown foot gable; upper entry aligned with it. Concept captions identify ladder on the gable and opening at the foot end. | Ladder and entry on the left in the CAD front view. |
| Book display | Integrated front-facing book display left of the ladder, with shelves and panel backing. | No bookshelf/display definition or instance. |
| Drawers | Three drawer fronts under the open long side; concept text explicitly describes three pull-out drawers and grip cut-outs. | No drawer/storage definitions or instances. |
| Panelled form | Horizontal timber panels on the upper long side and filled parts of the visible foot gable; the ladder entry remains open. | Simplified flat upper guards and open lower gable, without the display/panel module. |
| Mattress support | Hidden construction is not established by these renderings. | Two full 18 mm support decks exist. |

Three drawers are now a source-backed design feature, rather than an unverified count. The shown foot gable is partly panelled, not fully sealed. The hidden head gable, exact dimensions, joins, drawer hardware and rib-versus-sheet mattress support cannot be inferred reliably from these images. Keep measured/specification sources separate from visual design intent. Both images agree on the central arrangement; any material detail difference still needs a designated controlling reference or a recorded design choice.

The owner confirms Bob could read these project images and already identify several errors. The gap is therefore preserving and checking design intent before accepting the CAD candidate, rather than lack of image access in Bob. Proposed acceptance should cover the agreed feature list, orientation and reference fidelity alongside numeric and functional checks. No prompt, schema or runtime change was made for this new proposal.

### Expert advice and design readiness — 2026-10-09

The owner clarified that the bed was not ready for designer handoff: the mattress-support construction should first have been discussed with Bob acting as an expert adviser. Matching the mockup alone would not resolve that missing construction decision. This is the owner's reported missing advisory step; the deleted original private handoff cannot establish every earlier discussion.

Before #236, read-only code review and an independent audit found these seams:

- `cad-intake.ts` distinguishes `owner_decision`, `bob_decision` and measurements, but accepts missing/assumed owner decisions marked nonblocking. There is no recorded significance, advisory recommendation or decision-authority check.
- `cad-assistant.ts` admits the ordinary design path when retrieval is complete, a target exists and no assessment checks are marked blocking. Target existence is not evidence of an informed chosen construction.
- Its checked-construction path renders the saved checkpoint without researcher/designer intake. Readiness only at `design_project_cad` would therefore miss important choices already fixed by `save_construction_draft`.
- `DesignHandoff` has free-text deliverable and unresolved checks; review can pass with unresolved requirements. This accommodates honest concepts but does not encode whether a pending decision blocks the particular output.

The specified responsibility is broader than a visual brief: Bob identifies material choices, researches applicable evidence, explains relevant alternatives and practical consequences, recommends a supported direction, and records the resulting decision or genuine open issue in the evolving selected Solution. Existing owner decisions and delegated authority count; a technical detail does not automatically require permission. Engineering correctness belongs to investigation/verification, not an uninformed owner vote.

The [Solution owner](solutions.md#shared-expert-advice-and-design-intent--2026-10-09) owns shared intent and advice; [CAD](cad-adapter.md#expert-advice-and-design-readiness--2026-10-09) owns readiness consumption. The subsequent release below implements this boundary. Readiness depends on the next deliverable's purpose. An exploratory appearance sketch can explicitly leave a support question open; developing construction cannot silently settle it by embedding an unexplained default into geometry. Unrelated reversible work can continue.

Named-member acceptance still covers advice and supported resolution before a significant geometry-dependent choice; supported autonomous choices within mandate; reuse of earlier decisions after chat reset; purpose-appropriate concept deferrals; and retrieval failures remaining unavailable rather than guessed. At this clarification checkpoint only documentation changed; the subsequent implementation and technical release are recorded below.

### Expert advice and design readiness release — 2026-10-09

[PR #236](https://github.com/EmelieHagander/Bob-the-builder/pull/236) merged as
`9300aa90ab0bfd3c923802e88405975cb52a0809`, exact reviewed tree
`fe3d1c76e90638c2cebc40824523f40e4535ea70`. The domain owners are
[Solutions](solutions.md#shared-expert-advice-and-design-intent--2026-10-09) and
[CAD](cad-adapter.md#expert-advice-and-design-readiness--2026-10-09).

[CI 37996963538](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37996963538)
passed **1139/1139** tests, real Edge checks and every browser gate, including
advice/choices, historical reload and original references at **320/390/1280 px**.
[CAD 37996963521](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37996963521)
passed 12 real Python worker tests;
[PostgreSQL 37996963520](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37996963520)
passed 62 concurrency cases. Screenshot artifact **11648121696** was created,
but pixel materialization returned HTTP 403; this record claims automated browser
proof, without additional manual visual inspection.

| Reviewed migration source | SHA-256 | Hosted ledger |
| --- | --- | --- |
| `20261009214214_solution_design_readiness.sql` | `8a4c24ad48d1e4a8d37015a667be9f8640a13e55f62d29ff430b899af1fa9c60` | `20261009221621 / solution_design_readiness` |
| `20261009214611_ai_design_readiness_catalog.sql` | `5a2d25d0e92c8177501afa6e1dfe31317066b5eb811364487432d603bec71554` | `20261009221638 / ai_design_readiness_catalog` |

Ten hosted SQL function-body hashes match the isolated expected definitions.
All ten immutable catalog definitions are active; resolved catalog hash is
`08dc61413375b08461cc0a5cd5fe502db8f15b7c28be83b73c626ed8998ad1cc`.

| Endpoint | Hosted status | Authentication retained | Exact packaged-source readback |
| --- | --- | --- | --- |
| `bob-worker` | 62 / ACTIVE | `verify_jwt=false`, existing job capability | All 82 included files match |
| `ask-bob` | 94 / ACTIVE | `verify_jwt=true` | All 84 included files match |

The read-only SQL-role probe of the actual bed Area `a_br_sang`, target decision
1 and selected Solution revision 1 returns legacy `needs_data /
design_intent_required`, without a fabricated ready pin. The original CAD remains
readable. Outsider, anonymous and service-role access are denied. Deployment
before/after hashes match for Solutions, targets, the original CAD, private
requests and budgets. Jobs/messages were compared within the post-deployment
read-only role probe under repeatable read. Security and performance advisor
category/count groups are unchanged. This is SQL-role simulation, not signed-in
HTTP or semantic owner acceptance.

[Pages 37998296214](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37998296214)
published the exact merge at **22:17:16Z** to
https://emeliehagander.github.io/Bob-the-builder/.
[Live Bob 37998296738](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37998296738)
passed after runtime/catalog deployment: ordinary guest Auth/RLS, actual OpenAI
lookup, neutral red image pixels and versioned knowledge, with no private server
history. Idea turn `a3207805-ebcb-430e-8765-884c966af0e4` advises on place and
measurements first. Its 190 words and seven input items remain a brevity-quality
observation, not a style-acceptance pass. Fixture
`p_908f30c8ba26451182ba48d416722a6c` completed normal-API image cleanup and guarded
project deletion; exact fixture Project/people/Task/material/media readback is
zero. Actual bed project data stayed unchanged through the guest probe. Technical
installation is complete. Ordinary named-member
expert-choice/design acceptance, reference fidelity and broader P0/P4 outcomes
remain open in [State](bob-delivery-flow.md#state).

## CAD handoff ID regression — 2026-10-10

The real resumed bunk-bed request had 15 persisted requirements. Bob returned
10 paraphrased requirements with unrelated IDs; merging by those IDs produced
25 and failed the strict 24-item validator before CAD dispatch. Repeated paid Bob
steps could not repair that schema failure.

The regression now tests the complete intake/design/review path: the 10 invented
IDs retain the original 15 canonical requirements, reach one designer/render,
and cannot repeat completed work. New IDs are server-generated for direct and
split-piece requests. Separate tests cover exact replay, genuine additions,
existing-ID updates, unknown references, preserved restoration, unchanged limits,
and atomic catalog publication with fault-injected rollback. Provider-wire, K3,
budget-grant and runtime-audit fixtures now reference server-owned identities.

The new migration preserves all unrelated active definitions, model bindings,
policy envelopes and immutable pinned history. Release validation, exact hosted
source/schema readback and deployment status are recorded in the release PR.
This change does not itself regenerate the owner's drawing or establish visual
acceptance of the bed.

## Data authority gap review — 2026-10-10

Read-only review of main `9c3d363e8ebf78fb1258b3a68b4f395ed40d0267` traced source selection, parameter compilation, construction/CAD handoff, quantities, product evidence and resumed delivery. [Delivery flow](bob-delivery-flow.md#kvarstående-datagränser--kodgranskning-2026-10-10) owns the remaining cross-domain boundaries; existing specialist contracts remain authoritative.

Three controlled counterexamples used the actual TypeScript functions and synthetic values, with **zero paid model calls and zero production writes**:

- `drawingResumeReply`: a stub language response saying the drawing was saved was accepted with `saved=false` and a `cad_engine` failure. This establishes a missing output-authority boundary, not a finding that an actual member received that exact text in this pass.
- `constructionLists`: a valid single box named as reference context was counted as one blank. `cad-schema.ts` has no typed build/reference role. A suggestive name does not supply the missing classification; no owner's material need was changed or alleged incorrect here.
- `supplierArticleFields`: a synthetic article with a never-fetched example URL and declared pack fields passed shape validation. Source citation is declared evidence, not a captured-source receipt. SQL requires source fields and supported-field declarations but does not ingest the supplier page.

Focused existing checks passed **45/45**, no failures: `cad-parameters`, `construction-lists`, `project-design-intent`, `drawing-runtime`, `plan-edits` and `drawing-resume-reply`. These verify current mechanical guards, canonical feature handoff and retry selection; passing them does not close the counterexamples. The construction-requirement source/command inspection also confirms that changed checkpoints flag old needs and require an explicit revision of the same need rather than automatically updating the whole downstream chain. Hosted measurement columns confirm free-text `subject` with optional component ownership, without a typed property/reference-point contract.

Hosted readback found migration `20261007140000_supplier_article_packs` in the migration ledger, and its supplier-article revisions, pack-purchase tables and command functions present. This supersedes the older “not applied” wording only for database installation. This pass did not establish matching current endpoint/UI product execution or physical member/model acceptance; those remaining evidence checks stay in State. Do not reapply the installed migration based on the old code-only checkpoint.

Direct operator review followed the repository's source/owner and verification guidance. No independent subagent review, new runtime change, migration, deployment or visual acceptance is claimed by this audit.

## Database relationship review — 2026-10-10

Read-only hosted schema review against main `b511583a990166fcaaf3e471e3fceb2f6dee8390` inspected 21 construction, Artifact, measurement, requirement, cut-plan and purchase tables. All inspected primary/unique/foreign-key constraints were validated and all inspected tables had RLS enabled. This is a scoped structural readback, not a complete policy, performance or application-acceptance audit.

Installed/enabled CAD triggers include construction-source, design-intent, parameter-lineage and full parameter-graph validation; construction updates have the immutable-revision trigger. Actual function bodies confirm exact source-head/recipe/parameter checks, numeric recomputation and reused identity guards. The authenticated role has SELECT and no direct INSERT/UPDATE/DELETE on construction revisions, CAD revisions or construction requirement provenance. Cut-plan and requirement provenance have composite foreign keys to exact construction revisions. The construction pin on a drawing is guarded JSON metadata, while the CAD source foreign key targets another CAD revision; these are distinct. Legacy CAD without a construction pin is still permitted.

Hosted column/index readback confirms the remaining free-text measurement semantics, JSON construction graph, declared supplier source fields and lack of an indexed typed construction-source reference on the CAD table. [The database owner](../db/README.md#construction-data-authority-and-remaining-extensions) records the reused foundation and planned targeted extensions. The earlier controlled counterexamples remain open; schema support does not close workflow acceptance. This pass used no paid model calls and made no production data/schema changes. No new runtime test, migration, Edge release or independent subagent review is claimed.

## Receipt-owned drawing event replies — 2026-10-10

The controlled free-answer finding from the earlier review is corrected in source: drawing status now requires a valid explicit current-project Artifact receipt from the CAD writer/request store; provisional saved flags and free user-message fields cannot establish delivery. Other receipts are retained as partial work. Original gap/cause text and exact receipt revisions remain visible; localisation only prepares the pre-existing phrasebook. Known CAD failures, budget stops and already-saved acknowledgement paths dispatch no language model. The journal preserves old work-router slots and reuses an exact recorded phrasebook without dispatch.

Focused regression checks pass **13/13**, covering the contradictory saved answer, missing/wrong-project/invalid/deleted receipts, actual versioned save, partial work, prepared phrases, budget and CAD stops, continuation/access loss, legacy phrasebook reuse and changed-language/free-answer isolation. The full local suite passes **1,203/1,203**, with no failures. Vocabulary validation, production build and diff whitespace checks pass. The local full Edge check could not fetch its existing esm.sh dependency because the workspace connection was refused; the completed [CI run 38086341965](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38086341965) provides successful Edge/type, test, build and browser-fixture gates. All 51 recorded CI steps succeeded.

[PR #243](https://github.com/EmelieHagander/Bob-the-builder/pull/243) merged as `aa894b323711e6009a804d0f8ca156f1a75900f5`. Its source tree `ce917ae01d8ea4f9095874d6958a87f4dcfcc8ee` matches the reviewed release candidate exactly. Deployment changes only the four shared modules for reply composition, localisation and journal reuse; no database migration or production project-record write is included.

| Runtime | Installed version / state | Bundle hash / exact file readback |
|---|---|---|
| `ask-bob` | 101, ACTIVE; existing JWT verification enabled | `c32f78e53c61d4177eafb72a92e1b07d4cea9bec7cb758dd0ed50e7448e17158`; all 87 files equal the reviewed payload |
| `bob-worker` | 69, ACTIVE; existing capability authentication retained | `ccbdcea84843033665959c2a8e70d0bed1729f21907148f67812ba5699fee6e6`; all 85 files equal the reviewed payload |

These checks use synthetic values and no paid models. Direct review followed the owning contracts and the repository's Archie/verify guidance; no independent subagent review or actual member visual acceptance is claimed. The deployed-file readback establishes installation, not the real drawing/mockup outcome or a measured whole-chain cost saving. [State](bob-delivery-flow.md#six-outcomes-in-five-releases) retains legacy conversion C next after B's technical release and the remaining member/cost acceptance in E.

## Bounded construction changes — release B

**Merged, migrated and deployed through [PR #244](https://github.com/EmelieHagander/Bob-the-builder/pull/244), 2026-10-10.** The [Artifact owner](artifacts.md#parameter-changes-before-drawing--specified-2026-10-10) defines the numeric delta and independent revisions; [database owner](../db/README.md#construction-data-authority-and-remaining-extensions) defines the command, exact relation and installation order. This is steps 2–3 of [State](bob-delivery-flow.md#six-outcomes-in-five-releases), with legacy conversion C and real member/mockup/cost acceptance E separate. Reviewed head `cafb72538414c318b497b2a0787da505c69d53d3` and merge `36624e789f432a42482d5c30cafb4958d7b84406` share exact tree `e777c63df5444697ca816b121967b719117d227e`.

Focused tests pass **22/22** through full-schema SQL and actual tool registration. A 600 → 700 mm frame recomputes its inner board 564 → 664 mm and right placement 582 → 682 mm, retaining parts, materials, joints and immutable revision 1. Source-bound changes use canonical measurement values; fabricated values, role/unit/identity/formula/binding/topology changes, unknowns, stale revisions and revoked authority cannot save. Two prepared writes from the same head allow only one commit. Exact receipt replay makes no new source read/recompilation, including after later head/source changes.

The SQL chain changes a construction input, saves drawing revision 2 with exact `construction_source` revision 2 and keeps drawing revision 1 intact. A later source change/archive retains the historical typed pin. Caller RLS isolates projects and rejects relation mutation. CAD tests stop missing, malformed, changed or substituted versions before rendering/review; failed rendering retains the checkpoint for retry. All checked render/retry cases prohibit geometry-designer calls. All missing controlling inputs return together before further source reads. Catalog tests preserve existing model settings, unrelated definitions and immutable old manifests; generated contracts match executable tools. A real tool-bench fixture also preserves older pinned manifests when live policy includes the new tool: their existing handlers remain offered and the absent new contract cannot dispatch.

Before installation, hosted readback confirms the current writer/reader bodies match main and all 87 `ask-bob` v101 / 85 `bob-worker` v69 files match the base commit `f867ad9f50e7154777a8b9f681f55cced0f2659b`. There are four construction and five CAD revision records, one valid existing construction pin, no invalid pins and no typed relation yet. Aggregate record digests are retained for migration comparison; no owner project identifiers or transcript data are required. The Supabase CLI crashed on `--version`; new filenames use actual UTC timestamps rather than fabricated CLI output.

The full local suite passes **1,215/1,215** with four workers; final focused contracts pass **22/22** and publication regressions **11/11**. Production build, vocabulary and whitespace validation pass. The local Edge check could not fetch its existing esm.sh dependency; the final source instead passed CI Edge/type checks. [CI 38093908153](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38093908153) passes **1,215/1,215**, zero failures/skips, and all **51** steps including build, PWA and browser fixtures. [CAD adapter 38093908063](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38093908063) and [CAD lineage concurrency 38093908167](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38093908167) pass for the same reviewed head.

Only the two reviewed migrations were installed, in the required order: core → both runtimes → catalog activation. Managed ledger identities differ from source filenames and are retained explicitly:

| Source migration | Installed managed identity |
|---|---|
| `20261010222601_construction_parameter_changes.sql` | `20261010232323 construction_parameter_changes` |
| `20261010222920_ai_construction_parameter_catalog.sql` | `20261010232357 ai_construction_parameter_catalog` |

Hosted readback matches all five new function bodies exactly and both retained writer/reader bodies to the pre-release source. All four construction and five CAD records retain their complete-row digests (`ad98a2dd473938130e95291e3ab24a9b` / `9b925c9bdb13c3e6ac2c45d4acff3092`), checked immediately before and after installation. The one existing valid pin has one exact typed relation; no mismatch or fabricated legacy checkpoint is introduced. RLS is enabled, the three required indexes and same-project foreign keys are present, authenticated has only project-filtered SELECT, and anon/service have no relation grants. All reviewed functions have an empty fixed search path and no anon/service execution grants.

| Runtime | Installed state | Bundle hash / exact file readback |
|---|---|---|
| `ask-bob` | 102, ACTIVE; existing JWT verification enabled | `d4552ecd400fdffa1736a47c0876b554e7c42b7a9cc9dad48f819255849c973a`; all 88 files equal the reviewed payload |
| `bob-worker` | 70, ACTIVE; existing capability authentication retained | `e209c86181fc7181363fe174e7eb1b55b1458c18fdbfa51e7d948da25bae9d33`; all 86 files equal the reviewed payload |

Active catalog manifest `894387f2-331d-43ae-ae63-6038448be7ce` has 266 definitions: `change_construction_parameters` v1, `design_project_cad` v4 and `bob.tools` v3 match the published executable contracts. All four models/settings and unrelated definitions remain unchanged. Resolving prior manifest `4b0545fe-264b-4e6a-8611-f3c1d3508965` reproduces its complete original content.

Fresh security/performance advisors add one expected authenticated SECURITY DEFINER warning for `prepare_construction_parameter_change` and two INFO unused-index notices for the new relation. The helper's deliberate authenticated grant is fenced by the existing claimed-turn/generation/authority check before reads or locks; no anonymous grant is present. The indexes cover required foreign keys and source lookup and have just been installed. No other advisor additions were found against the pre-release snapshot; no unrelated shared-project cleanup was performed.

These checks run without paid models or owner project writes; no actual bed correction, real member/phone visual acceptance or measured cost saving is claimed. Direct review follows Archie/verify guidance and the owning contracts; no independent subagent review is claimed. [State](bob-delivery-flow.md#six-outcomes-in-five-releases) retains C's guarded legacy conversion next, including the bed drawing without a construction checkpoint, and A/B's real member/mockup/cost acceptance in E.


## Construction instance roles and consequences — release D

**2026-10-11: implementation merged; hosted installation is partial and blocked by the Supabase connector's request-state error.** Scope: exact constructor-revision instance policy, bounded classification, role-aware manufacturing selection, persisted linked output work and canonical same-identity continuation. No owner geometry/roles/history are backfilled, no model/price settings change, and no purchases/reservations/performed work are automatically rewritten. The common calculator remains specified for review after D; real bed/mockup/member and cost acceptance remain E.

Reviewed seams: saved construction/role validation → K2 concept checks → full K3 geometry/policy pin → requirement source proof and independent cut replay → affected-output capture/completion → current-plan work review. Tests cover mixed roles sharing a definition, legacy uncertainty, inherited roles, exact numeric recompilation, same-output retries, stale heads/claims, cross-project/RLS/raw-write denial, reserved capacity, committed Shopping, retirement with preserved history, exact drawn roles and completed-work preservation. Compact paged queue receipts keep whole output packets out of routine progress reads. Four additional real PostgreSQL lock races are part of `check-cad-lineage-concurrency.ts`.

Local vocabulary and production build pass. Local Edge checking is blocked by the existing restricted `esm.sh` dependency fetch; PR CI must provide the actual Deno pass. Local Node 24/PGlite exhibited the known native V8 crash in a combined run; isolated affected suites pass, and the required CI suite remains authoritative. No local browser is installed; inspect the PR's intercepted browser gates rather than claim a local browser pass. Review followed Archie's existing prompt manually; no independent agent review is claimed.

Preflight: remote main `d729d2de426c921622ea0c8cc8009a8e042984da`; hosted ask-bob 103 / worker 71; active C manifest `5f863393-a903-4ccf-a7b7-7e891709fbe3`, 267 definitions. All seven replaced/read-wrapped source bodies match the full migration baseline. Hosted v16 is the earlier CAD-shell wrapper rather than the repository's later Step-link wrapper; D renames/preserves that actual body and delegates unrelated operations, without installing unrelated pending work. Baseline 4 constructor rows hash `ad98a2dd473938130e95291e3ab24a9b`; 5 CAD rows hash `f3e48d971f27b9f739c77ebb19f67327` under the same ordered full-row digest query. D tables are absent. Model/settings hashes are `eaded0d9bf3b84b6d52d9b1196bba0e4` / `d71fb90595904ce11791b01aa559d8b8`.

The final isolated role/change-work suite passes **27/27**, D/C catalog compatibility **4/4** and stock reservation regressions **11/11**. The late boundary review covers historical unclassified cut plans: new reserve/publish calls stop, current coverage becomes false and existing held capacity can be released normally without rewriting history. Linked manual needs without recorded models are captured with an explicit model-review gap; a canonical code-derived model under the same identity closes the item and preserves the original quantity. The read/stock/Shopping wrappers retain actual prior bodies and remove authenticated access to bypass aliases.

`scripts/check-construction-consequences-release.sql` passes against the isolated full schema and is included in the disposable PostgreSQL CI harness. It uses ordinary claimed authenticated writers to save/read exact roles, preserve geometry/history, resume both needs under their original identities, retire the retained member's need, replay original receipts and deny raw/outsider access, then unconditionally rolls back. Hosted execution belongs to the installation gate below; it makes no model or HTTP request. The final recovery review adds explicit canonical archive settlement for a no-longer-required legacy/manual need; a current archive retires only its saved item, while original quantities and other work stay intact. The first PR CI attempt passed 1,247 assertions but stopped in an unchanged Shopping suite with Node 24.21/V8 `jit_page_->allocations_.erase(addr)` failure; this is not an assertion pass for the omitted cases. A second head passed 1,252 assertions but hit the same native failure in another cut-plan suite. This matches the reported [Node 24 Wasm code-GC failure](https://github.com/nodejs/node/issues/66366); the observed stack and upstream report support that diagnosis, not a Bob assertion failure. `npm test` now adds `--no-wasm-code-gc` only to the test process, retaining all tests and production runtime settings. Remove the workaround after a validated Node backport/runtime update. The final-head CI gate remains required.

### Resumed release readback — 2026-10-11

**Historical partial checkpoint, superseded by the [completed hosted release](#completed-hosted-release--2026-10-11) below.** The connector failure and pending installation statements in this subsection describe the earlier pass.

[PR #246](https://github.com/EmelieHagander/Bob-the-builder/pull/246) is merged as `e04fb99798500f1fd113272293710d1013c44385`. Reviewed head `196bca34ad4339d18659f720f51df7222541a678` and the merge have the exact same tree `9afe77a85138851c944a18bf5f70bc23d2dcdd59`. Final [CI 38133104071](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38133104071) passes **1,253/1,253 tests**, all **51 job steps**, original Edge checks, build, PWA and intercepted browser gates. [CAD adapter 38133104051](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38133104051), [PostgreSQL concurrency 38133104052](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38133104052) and dependency checks also pass. The PostgreSQL harness includes the rollback-only D smoke and four D lock races. The local consequence-catalog builder reproduces the reviewed migration exactly.

The merge's [Pages deployment 38134313330](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38134313330) and existing [Live Bob check 38134313414](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38134313414) pass. That automatic generic live check ran before D backend installation; it is not evidence that D roles/continuation or the actual bed/mockup journey work through a model.

| Reviewed source | Hosted readback | Remaining action |
|---|---|---|
| `20261011090115_construction_instance_roles.sql` | Installed as `20261011110635 construction_instance_roles`; all **16** directly defined/replaced function bodies match the reviewed source byte-for-byte | Preserve this migration; do not reapply or backfill historical roles |
| `20261011091128_construction_change_work.sql` | No ledger entry; both change-work tables and the six additional helpers/readers are absent; v16 retains its previous body | Apply this exact complete migration once through the supported migration path |
| `20261011093016_ai_construction_consequences_catalog.sql` | No ledger entry; the three new tool definitions are absent | Activate only after both compatible runtimes and core readback pass |

Two bounded attempts to apply only `construction_change_work` returned `McpServerError: Invalid or expired requestState` (`-32602`, `invalid_request_state`). Fresh ledger/table/catalog reads after the attempts confirm that no second-core or catalog migration was installed. This is a connector failure, not a SQL test failure or a reported automatic approval-review rejection. The only installed D core remains the first migration above. There are **zero** active queued/running unexpired Bob jobs at the readback. No owner request was submitted or rerun.

Both hosted functions still carry C: **ask-bob 103 / ACTIVE / JWT true**, **bob-worker 71 / ACTIVE / JWT false with its existing job authentication**. All 88/86 existing package files were read before preparing the reviewed D closures; no old file is dropped. The prepared D source closure contains **91/90 files**, including role/continuation modules and required type dependencies. It has not been deployed. Keep the current runtimes until the second core is installed, preserve their existing authorization and deploy the exact reviewed source rather than current unreviewed main.

Readback preserves active C manifest `5f863393-a903-4ccf-a7b7-7e891709fbe3` with **267 definitions**, payload hash `aef172c7991f2bbebb425d0e380afa456019e84b22711dab515c0f10de8ae128` and exact stored-payload MD5 `def33ecaa974aeb44e429c033ba15021`. All 267 active prompt/version identities and hashes were captured before any attempted write. No D role policy has been created for an existing construction. Original-data fingerprints below are the resumed pass's baseline, not a claim that the hosted D smoke ran:

| Rows | Count | Complete-row MD5 |
|---|---:|---|
| Construction revisions | 4 | `6fdc8107865b7cfede58e24372b134e8` |
| CAD revisions | 5 | `988a3a99c79fca3d877e7582594d3a23` |
| Material requirement revisions | 3 | `bafb60fdf6da48146de925fa90ca5df9` |
| Cutting plan revisions | 1 | `341613b9ef747eaa06574d6addd1c20e` |
| Pack purchase revisions | 1 | `2266b66b403f974c80b2f753a1fa89a2` |
| Project plan steps | 20 | `f77ead39b9898b5fd6428be0bf65bedd` |
| All shared model rows | 12 | `54039f71c0a99ac650140704e021da03` |
| All shared setting rows | 38 | `76133bec5a3feea1ee1a1cd3858e4978` |

The fingerprint expression is `md5(coalesce(jsonb_agg(to_jsonb(t) order by ...)::text,'[]'))`: construction/CAD sort by `(project_id, artifact_id, artifact_revision)`; other rows sort by `to_jsonb(t)::text`. Instance policies, reservation revisions and cut-plan Shopping revisions each have zero rows and MD5 `d751713988987e9331980363e24189ce`. Final readback after both failed attempts reproduces every resumed-pass row count/digest above, the complete C manifest and all 267 active prompt/version identities/hashes. The earlier pass's exact aggregation expression was not recovered, so its different hashes are not a cross-pass preservation comparison. Fresh security/performance advisors were captured before the attempted second migration; no post-D advisory result is claimed.

Resume with fresh target/head/ledger/quiescence checks, install the exact second core, deploy both compatible closures preserving authentication, and run `scripts/check-construction-consequences-release.sql` as one rollback-only transaction. Read back all **23** D function bodies, table constraints/RLS/grants, preserved pre-D v16 delegation and the original-data fingerprints. Then publish the exact D catalog and verify three new contracts, all changed contracts/manuals, preserved C manifest, unrelated definitions and all model/settings. Complete hosted smoke/source/hash/manifest evidence here before closing D in State. Hosted SQL smoke, runtime deployment and D catalog activation remain unperformed; calculator review follows D and real-member/bed/mockup/cost acceptance remains E.

### Completed hosted release — 2026-10-11

The owner explicitly approved the browser fallback after the connector's expired-request errors. The signed-in dashboard was verified against project `yuobtgoidmmmwfqenkau`. The second core and D catalog were applied from the exact reviewed files, with migration-history registration in the same transaction and bounded guards against duplicate installation, changed prerequisites and active jobs. The first core was preserved. The editor contents were copied back and SHA-256 checked against each prepared package before Run. Browser installation success and independent connector ledger readback agree.

| Reviewed file | Installed version | Exact source SHA-256 |
|---|---|---|
| `20261011091128_construction_change_work.sql` | `20261011161202 construction_change_work` | `7f1d3d646fc8808c0b7c9905e367195b789002832ab057685c2dc8391832d2b2` |
| `20261011093016_ai_construction_consequences_catalog.sql` | `20261011161711 ai_construction_consequences_catalog` | `534368e6cae7ca15e9cb2715fc1324844b03df65cd21f4f2113430b65288b1d5` |

All **23** directly defined/replaced D function bodies match the reviewed source byte-for-byte. The preserved pre-consequence v16 delegate retains MD5 `d47f5e218fdd73349e57e77da111665b`. All three D tables have RLS, authenticated SELECT only, and no anonymous read or raw authenticated writes; the two change-work tables retain their **6/20 constraints**. The ordinary-writer `scripts/check-construction-consequences-release.sql` passed on hosted PostgreSQL as one **BEGIN … ROLLBACK** transaction: saved/read exact roles, preserved geometry and old needs, continued the same two need identities, retired the retained member's need, replayed original receipts, and denied raw/outsider access. Synthetic users and all test rows were rolled back. No HTTP/model/CAD acceptance call was submitted.

Both functions now run the reviewed `196bca34ad4339d18659f720f51df7222541a678` runtime (tree `9afe77a85138851c944a18bf5f70bc23d2dcdd59`):

| Runtime | Status / authentication | Source readback |
|---|---|---|
| `ask-bob 104` | ACTIVE, existing JWT verification true | All **90** bundled files match the reviewed closure; bundle `22d4cd507c1cca1c5f2ae4b36d4072224c38a4abdcb444c8dfb083ce7e49172d` |
| `bob-worker 72` | ACTIVE, existing JWT false and capability/job authentication retained | All **88** bundled files match; bundle `c62099dd08e1be2600a00a73777a395fe0ed61081ecbe8662a6c16b6c2b4b6b2` |

Submitted closures contained **91/90 files**. The compiler omitted the newly supplied `src/data/provenance.ts` from both bundles and the worker's `bob-request.ts`, which the worker imports only for `BobTurnInput`. No prior 88/86 package file was dropped and no executable source differs. Runtime deployment used the connector successfully; only the two pending migrations required the approved dashboard fallback.

The catalog builder reproduces the committed SQL exactly. Independent readback reconstructs and matches all **14** changed/new tool contracts, their manuals and metadata, the toolbox publication and three tool-policy rows. Exactly the expected **12** existing definition identities changed and **3** were added; all **267** unrelated cross-app register identities/version hashes remain intact. Canonical `shared.resolve_ai_catalog('bob')` returns manifest `1014e17d-3fa2-46b9-a30c-e3829d5a67d6`, **270 definitions**, payload hash `df5313319d34fb3148cb92a3239692a48f297617605d7aa83640b2016126f003`, and the three new contracts `change_construction_roles`, `read_construction_changes`, `continue_construction_change`. Earlier C manifest `5f863393-a903-4ccf-a7b7-7e891709fbe3` retains all 267 definitions and its exact MD5/hash; old pinned sessions remain available.

Before/after fingerprints reproduce **every count and complete-row digest in the historical checkpoint above**, including all 4 construction, 5 CAD, 3 need, 1 cut-plan, 1 pack-purchase and 20 work-step rows, the zero pre-existing policy/reservation/Shopping rows, and all **12 shared model / 38 shared setting rows**. There were zero active unexpired queued/running jobs at both release guards. Owner project content was not edited.

Post-install security advisors flag the two deliberately authenticated SECURITY DEFINER preparation RPCs; both retain the reviewed claimed-turn/project authorization and empty search_path, and the hosted/CI access tests pass. [Security advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) describes that deliberate exposure and the required review. Performance advisors report **9** uncovered composite foreign-key index suggestions on the new item table plus newly unused indexes; this is a non-blocking index follow-up, not a failed behavior or authorization test. [Foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) owns that recommendation. No claim of a globally clean shared database is made.

This closes D's technical installation gate. Final-head CI evidence remains the 1,253-test/51-step/68-PostgreSQL checks recorded above; it is not a new model acceptance result. Formula/calculator review is the next owner-prioritized action in [State](bob-delivery-flow.md#state). Real-member reload, bed/mockup correction and measured model-chain cost remain E.

## Legacy drawing transition — release C

**Merged, migrated and deployed through [PR #245](https://github.com/EmelieHagander/Bob-the-builder/pull/245), 2026-10-11.** The [Artifact owner](artifacts.md#legacy-drawing-transition--release-c) defines exact geometry/provenance capture, grouped gaps, retry receipts and first-pin/history semantics; the [database owner](../db/README.md#construction-data-authority-and-remaining-extensions) defines storage and rollout. Reviewed head `78a2f0cce498b9819d3e115eb149a30dbcbc8622` and merge `2350eb270feaf2fc6377c3991888865a6b810f5a` share exact tree `77f47526fff6fc4d99599820c57c8ea23cdc4d1f`.

Final [CI 38121946833](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38121946833) passes **1,222/1,222 tests** and all **51 steps**, including Edge/type/build and browser fixtures. [CAD adapter 38121946835](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38121946835) and [PostgreSQL lineage concurrency 38121946870](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38121946870) also complete successfully on that exact head. Focused final PostgreSQL/CAD/catalog/policy checks pass **8/8**: exact copied IDs/graph, numeric correction, same-drawing new revision, lost-response replay after head changes, duplicate preparation, stale heads, matching/mismatched reuse, missing historical graph, first-pin bypass, RLS/claim fences, fresh dispatch, render recovery and project deletion. Vocabulary, production build, all three append-only catalog builders and whitespace checks pass.

The frontend also completed [GitHub Pages deployment 38123423594](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38123423594) from release-docs main `fcdf05c30bd0c637eee961d05b96b4d27ebeb9cb`; both build and deploy jobs pass. Its product code is identical to the reviewed merge. This publishes the client’s reused-Artifact receipt support as well as the server runtime changes. Closing and reopening Bob loads the updated installed/web app, as described in the README.

Local full runs encountered native V8/PGlite crashes in unchanged cut-plan suites; isolated retries pass **13/13** and **11/11**. Final CI supplies the complete suite result. The local full Edge check could not fetch the pre-existing esm.sh dependency; CI supplies successful Edge checking. No local browser is installed; the browser evidence is CI with intercepted fixtures, not a real member/phone acceptance or paid CAD generation.

| Reviewed repository migration | Hosted managed ledger | Installation order |
|---|---|---|
| `20261011070724_legacy_construction_transition.sql` | `20261011075652 legacy_construction_transition` | Core first: exact legacy origin, claimed preparation/writer, reader and first-pin guard |
| `20261011071316_ai_legacy_transition_catalog.sql` | `20261011075806 ai_legacy_transition_catalog` | Activation after both matching runtimes and exact runtime/core readback |

The pinned Supabase CLI aborted on `--version`; the UTC filename fallback is recorded in the core source. Only these two reviewed migrations were applied. The managed ledger timestamps are recorded separately rather than rewriting source history. Hosted readback matches **five** new function bodies and **three** retained writer/reader/K3 bodies exactly. All **four construction** and **five CAD** records retain their complete-row digests (`ad98a2dd473938130e95291e3ab24a9b` / `9b925c9bdb13c3e6ac2c45d4acff3092`). There are **zero origins** after installation, so no owner drawing was backfilled; the existing one rendered relation remains unchanged. RLS, authenticated SELECT-only/project policy, no anon/service grants, three indexes and four exact-key constraints are verified. Drawing/project deletion cascades origin metadata; construction provenance retains its exact revision foreign key. All reviewed functions have a fixed empty search path and no anon/service execution grants.

| Runtime | Installed state | Bundle hash / exact readback |
|---|---|---|
| `ask-bob` | 103, ACTIVE; existing JWT verification enabled | `0a630981878b1f72e3729a3ba7453b3f1167a66d20fac88cb6e8628dcb8c2993`; all 88 files equal the reviewed payload |
| `bob-worker` | 71, ACTIVE; existing capability authentication retained | `b19a4960662ea8d8b4176084fed82de3210587c70983ec88b5f46a55d95c763d`; all 86 files equal the reviewed payload |

The 89-file union of pre-release runtime dependencies matches pre-release main exactly. Deployment replaces only seven reviewed shared runtime/data/policy files; unrelated files and authentication settings are preserved. Active manifest `5f863393-a903-4ccf-a7b7-7e891709fbe3` has **267 definitions**, with transition v1, CAD reader v2, CAD design v5 and toolbox v4. The transition wire schema matches the actual registered tool. All four models/settings and unrelated definitions remain unchanged, and resolving prior manifest `894387f2-331d-43ae-ae63-6038448be7ce` reproduces its complete original content. Historical builders and pinned benches remain compatible.

Fresh advisors add only the expected [authenticated SECURITY DEFINER notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) for the new claimed-turn preparation RPC and two [INFO unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) for the newly installed origin indexes. The authenticated grant is intentional, fenced by authority/claim/generation before reads or locks; anonymous execution is revoked. The indexes cover the exact foreign keys and source lookup. No other advisor additions/removals or unrelated shared-project cleanup were found.

Direct review follows the owning contracts and Archie/verify guidance; no independent subagent review is claimed. The focused legacy fixtures use no paid models, and installation performs no owner project edits. The existing merge-triggered [Live Bob release check 38123067569](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38123067569) also passes actual Auth/RLS/OpenAI checks with disposable project data. That automatic live health check is separate from legacy CAD/bed acceptance and does not measure whole-chain cost savings. The actual bed/mockup correction, named member readback, phone acceptance and measured whole-chain cost saving remain E. [State](bob-delivery-flow.md#six-outcomes-in-five-releases) now retains D’s typed part roles/quantity policy and persisted consequence continuation as the next implementation.

## Calculation and formula review — 2026-10-11

**Repository review completed; the common calculator remains specified.** Reviewed
code base `0416f73a76b851387220d78f4d0f4b89f847dfba`, after D's implementation
merge and the recorded release readback. Scope is the next prioritised
calculation boundary. These calculation sources are unchanged on
`7a87c9f60a3034f5464633990d1cc73714e5a4b8`; D's completed installation is recorded
in its [release evidence](#completed-hosted-release--2026-10-11).
This pass installs nothing and does not supersede D's hosted release evidence.

The [tool owner](ask-bob-tools.md#existing-evaluators-and-first-common-tool-boundary)
now maps executable methods, precision and canonical model/result storage. The
review followed stair inspection/save/reload, CAD/construction compilation and
SQL graph validation, material/wall/layer/blank quantities, allowance and purchase
rounding, supplier pack aggregation, bounded cutting and earlier Artifact
geometry. It also checked source-unit conversion, Bob's governed registration,
CAD research/designer arrays, strict CAD/Plan model responses, and authored
time/price display helpers.

| Probe | Evidence and limit |
|---|---|
| Dependent dimension | Graph unit fixture derives 960 mm from measured `1.001 m` minus two 18 mm decisions and 5 mm clearance, retaining original units/revision. Separately, the SQL graph fixture saves/reads `1001 − 41 = 960 mm` and its exact dependencies. Wrong units, cycles, omitted/unknown inputs, stale pins, arbitrary operations and implicit rounding are rejected. |
| Rounding/replay | Graph fixtures cover signed half ties and exact-result rejection; SQL rejects normalized-value tampering and preserves historical detail/source pins. Stair source adoption changes the same saved recipe's derived results while old parent revisions stay reproducible. This is domain evidence, not common-tool acceptance. |
| Stair numerical policy | Direct fixture with 2800 mm total rise, 17 rises and 280 mm going returns `rise_mm=164.7058823529412`, `step_formula_mm=609.4117647058824`, `pitch_degrees=30.465544919459884`. Existing code retains full-precision division/trigonometry; the common response still needs explicit output/display precision metadata. No site or suitability claim follows. |
| Purchase arithmetic | Existing AC-14 SQL fixture: needs 60+60 pcs, 30 held, pack size 100 → net 90, one pack, surplus 10. Unknown pack size, unit mismatch, changed sources, competing claims and denied callers fail appropriately; replay does not duplicate publication. |
| Shopping text counterexample | Source inspection and direct reproduction of the unchanged `parseCost` logic: `199,50 kr` → 19950; `100–200 kr` → 100200; empty text → 0. The editor accepts text and schema stores text. This is a reproduced display defect, not a failing quantity method or a browser/model probe. [Material owner](material-planning.md#authored-prices-and-display-total) records the open correction. |
| Specialist integration | Bob, CAD research and designer have different tool surfaces. CAD reviewer and Plan compiler/reviewer use strict schema responses without tools; the current adapter suppresses `text.format` when tools are supplied. The first common implementation must test a bounded calculation phase and final-schema validation at these actual calls. |

Local existing tests: **175/175** across 20 parameter, stair, material, sheet,
pack, construction, cutting and Artifact geometry test files; **97/97** across eight
unit normalization, tool session/catalog, CAD/Plan assistant and project-overview
test files. Total **272/272**, zero failures/skips. `npm run check:vocabulary` and
`git diff --check` pass. Dependencies reuse the identical lockfile installation
from this workspace. No new implementation-shaped tests were added for these
documentation changes; full build/Edge/browser gates belong to PR CI.

The initial [PR #247 CI run](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38155415986)
passes **1253/1253** tests, Edge, builds, PWA and the other browser gates, but
fails the material-planning journey at its Shopping quantity lookup. The strict
locator matched three `2 pcs` occurrences in the outgoing Material Plan while
hash navigation was still replacing that view. The product files are unchanged
from the reviewed base. The existing browser harness now waits for the destination
`Shopping list` heading and matches the quantity prefix in the named Shopping row
for both initial publication (1 pcs) and update (2 pcs). Source/delivered-state and
reload assertions remain. This repairs the race without weakening the arithmetic
check; it does not fix the authored-price defect. No local browser is installed;
the corrected journey must pass in fresh PR CI.

The missing common handler/result envelope, standalone saved graph contract and
price correction are explicit implementation gaps. Stored requirement history
does not prove replay dispatch for every old method, particularly D v1/v2
manufacturing counts. No new runtime, schema, AI definition, model settings,
project records, paid model calls or hosted probes were introduced by this review.
Direct review follows the owning contracts and Archie/verify guidance; no
independent subagent review or real-model calculator acceptance is claimed.
[State](bob-delivery-flow.md#state) retains the next implementation and its gates.


## Common calculator — 2026-10-12

**Implemented, migrated, deployed and verified with an actual Bob tool call.**
`calculate_project` shares the existing graph/stair evaluators and SQL purchase
owner. Its [contract](ask-bob-tools.md#common-calculator-v1--implementation-2026-10-12)
records exact method coverage and remaining gaps. Source/current readiness,
manual provenance, units/rounding, invocation budget, catalog versions and
specialists' structured response boundary have focused automated coverage.
The full local suite passes **1,276/1,276 tests**. The focused 62/62 pass includes canonical stair save/refresh
and old-revision readback, construction blank v1 saved before D then replayed
under D without rewriting count semantics, scoped invoker SQL, and provider
phase/final-schema observations with scripted models. Additional policy/pack
cases pass in the full suite. [PR #248](https://github.com/EmelieHagander/Bob-the-builder/pull/248)
publishes the exact tested tree `18be1cbfb922173689f132afd302431f39e21468`
at reviewed source head `d0a8a1d915fbccc3dae3ca8a62e7f6629d589068`.
[CI 38216748529](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38216748529)
passes all **1,276 tests and 51 steps**, including canonical Edge checks and
the intercepted browser flows. [CAD adapter 38216748542](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38216748542)
and [PostgreSQL 38216748510](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38216748510)
pass; the latter installs the full schema and passes **68 concurrent races**.

The vocabulary check, frontend build, PWA and generated catalog checks pass. Canonical local Edge checking is
blocked by this environment's refused `esm.sh` connection; no local browser is
installed. The linked exact-source CI supplies Edge/browser evidence; no local
browser pass is claimed.
The migration CLI aborts in its installed Bun runtime even for `migration new
--help`; observed UTC fallback filenames are explicitly recorded. Manual code
and owning-contract review follow Archie/verify; no independent subagent review
is claimed.

### Hosted calculator release

The target `yuobtgoidmmmwfqenkau` was read before installation. Both new functions
were absent, the retained purchase writer contained exactly the reviewed
arithmetic block, manifest `1014e17d-3fa2-46b9-a30c-e3829d5a67d6` was active,
and there were zero active unexpired Bob jobs/models. Only the two reviewed
migrations were applied, in SQL → both runtimes → catalog order:

| Reviewed file | Installed ledger version/name |
|---|---|
| `20261012060203_project_calculator.sql` | `20261012073221 project_calculator` |
| `20261012060715_ai_calculator_catalog.sql` | `20261012073416 ai_calculator_catalog` |

Both new function bodies match their reviewed source exactly. Their empty
search paths, invoker mode and authenticated-only EXECUTE grants were read
back; anon/service/PUBLIC cannot execute them. The retained purchase writer
matches its complete pre-release definition with only the asserted arithmetic
block replaced. A hosted **BEGIN … ROLLBACK** smoke replays all three existing
saved purchase revisions to their unchanged allowance/purchase quantities,
checks decimal/increment rounding and denies outsider/anon/service reads.
It creates no fixture rows, calls no models and commits no owner changes.

| Runtime | Authentication and exact source readback |
|---|---|
| `ask-bob 105` | ACTIVE, existing JWT true; all **92** bundled files match; bundle `1689fa9b72819dca5106c7c5c5a85ee9b8dbfb9546d647a6105372e5a2990e71` |
| `bob-worker 73` | ACTIVE, existing JWT false with unchanged job/capability authentication; all **90** bundled files match; bundle `653c99a2c873e5e57fc6511e30d4c5848972a0979a6a6ebebc5fbf9aa536e71e` |

Submitted closures have **93/92 files**. The compiler omits only
`src/data/provenance.ts` and the worker's type-only `bob-request.ts`, as in the
previous release. Every previously bundled file remains present. The new
calculator and schema-phase modules are in both bundles; no unrelated runtime
or authentication setting changed.

Canonical catalog readback returns manifest
`6482763a-214b-4022-9e32-92b42e9dac71`, **272 definitions**. The calculator's
contract/policy, toolbox and all six role tool-key additions match the exact
generated publication. The six appended instructions and new schema-phase
fragment match exactly. Exactly **13** existing identities change and **2**
are added; all unrelated cross-app versions/hashes and all models/settings
remain unchanged. Resolving the previous manifest reproduces its entire
original payload, so older pinned sessions keep their original contract.

`scripts/check-live-calculator.ts` ran against actual Auth and `ask-bob` using
the existing public guest and one disposable project. It supplied a synthetic
**1.001 m provided specification at revision 1**, two explicit 18 mm side
choices and a 5 mm clearance choice. Bob returned **960 mm**. Content-free
execution evidence for turn `1620f8ad-cc35-4cbd-8056-6fe02f402b4e` records
`calculate_project` both offered and selected by `ask-bob`, followed by one
tool event with status **calculated**. The source value/unit/truth/revision
remained unchanged and no Artifact or requirement was created. This is an
explicitly requested graph preview with a public advice-only account; it does
not prove natural-language specialist choice, named-member writing or bed fit.

The exact disposable project `p_caf7c27b4b5046ba9b0f5b299237c74a` was removed
after verifying its name, guest ownership and absence of generated outputs.
The first cleanup call returned the connector's expired-request error; the
narrower guarded single-project delete succeeded and independent readback
confirms cleanup. All **129 original tables / 1,392 rows** retain their exact
pre-release counts and complete-row digests, including saved construction/CAD,
material history and all **12 shared models / 38 shared settings**. Security
and performance advisors add **zero** findings against the pre-release
snapshot. Existing shared-project findings were not changed.

[State](bob-delivery-flow.md#state) retains PR review/merge and the remaining
graph/unit/history/price boundaries plus E's real member/mockup/cost acceptance.


### Owner task budget and cost attribution — 2026-10-12

**Implemented, required CI passed and hosted release verified.**
[CAD](cad-adapter.md#one-budget-per-owner-task--2026-10-12) owns the new owner
mandate, and [database periods](../db/README.md#owner-task-budget-periods--2026-10-12)
own accounting. PR #248 is already merged; this is its subsequent loop-guard correction.

The failed hosted drawing stopped on **USD spend**, not call count: its historical
request ledger had 16/48 calls and $4.039417/$4, all calls completed. Those costs
spanned three executions. The latest execution alone logged approximately
**$1.0804 of AI usage**, including $0.9666 in CAD. Independent review was blocked
before provider dispatch; it did not cause a paid review loop in that execution.
This is logged AI cost at recorded prices, excluding CAD infrastructure and any
other project work; it is not a provider invoice total.

| Latest CAD phase | Input tokens | Output tokens | Logged cost, USD |
| --- | ---: | ---: | ---: |
| Research | 32,762 | 1,723 | 0.0323 |
| Designer: source read | 44,091 | 887 | 0.1235 |
| Designer: calculation | 59,050 | 11,182 | 0.3154 |
| Designer: render | 61,088 | 23,385 | 0.4954 |
| Review | 0 | 0 | 0; stopped before dispatch |

The three designer calls used 164,229 input and 35,454 output tokens, with only
3,584 cached input tokens (2.18%). At their recorded $2.50/$0.25/$15 per million
uncached/cached/output rates, input cost was about $0.4025 and output cost about
$0.5318. The provider reported 34,984 reasoning tokens within output; Bob's
calculator charges output once, not reasoning a second time. Bob's first general
call also offered 72 tools with 196,263 bytes of tool schemas. No duplicate
provider dispatch was found in the latest execution.

This supports large context, repeated billable input and expensive output as
actual cost drivers. OpenAI's [conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state)
confirms that `previous_response_id` does not remove prior input from billing;
[reasoning](https://developers.openai.com/api/docs/guides/reasoning) is billed in
output, and [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
requires matching prefixes. Prefix/cache optimization remains a measured follow-up;
this change does not claim a cheaper accepted drawing or change model quality.

Focused full-schema/runtime tests prove: deployment keeps old ledger totals;
next real message resets $4/48 historical allocation to default $3/24 with zero
spend/calls; same-task retries, new request IDs and worker/event continuations do
not refill; task totals are shared in the work reader; deliberate owner grants
remain idempotent; exact drafts and quality gates persist; paid results recover
without charging again; direct and periodically reconciled late receipts charge
old periods once; private history is denied to anon/authenticated/service roles.
Production orchestration commits the verified cost cause and fresh-next-message
hint without a language/model call, preserving earlier partial writes. A separate
CAD pipeline test resumes the same cost-stopped draft with only independent
review, without new research/design. Historical upgrade tests deliberately stop
at their original migration boundary; current behavior uses the full schema.

The installed Supabase CLI aborts before `migration new` can create a file.
The two new filenames use observed UTC time; no historical migration is edited.
The full local suite (**1,280 tests**), vocabulary check and production build pass.
Canonical local Edge checking is blocked by the sandbox connection to esm.sh;
no browser is installed locally. Required CI supplies those checks and passed on
the deployed source: [51-step CI](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38231107809),
[native PostgreSQL concurrency](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38231104841)
and [CAD adapter](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38231104759).
Real owner browser/model acceptance remains in [State](bob-delivery-flow.md#state).

#### Completed owner-task budget release — 2026-10-12

[PR #249](https://github.com/EmelieHagander/Bob-the-builder/pull/249) contains the
deployed source `2276937cf26d594cd342dc364e91d3204190df13`, tree
`5a259dc7225a6aad2e8a3674321eb95bf291e752`; subsequent release-documentation
changes do not change that executable source. Migration attempts through
the connector failed with `Invalid or expired requestState` before execution.
The owner approved the Dashboard fallback. Its SQL Editor executed each exact
source with a quiescence guard and migration-ledger insert in the same transaction.
Only these two migrations were installed, in this order around the compatible
runtime deployment:

| Source and hosted ledger version | Migration |
| --- | --- |
| `20261012090214` | `drawing_task_budget` |
| `20261012090928` | `ai_task_budget_catalog` |

All **six** defined/replaced SQL bodies match the reviewed migration exactly,
with fixed empty search paths and their intended execution grants. Existing
budgets retain period 1, their original counters and the explicit legacy
request-scope marker, with zero origin-mapping errors. No real owner task was
fabricated to reset them; the next claimed owner message opens its new period.

| Runtime | Verified hosted result |
| --- | --- |
| `ask-bob 106` | ACTIVE; JWT true; all **92** bundled files match; bundle `62485d6b4d1483808fc4f8e2cd4984b6d68a239a7b47ec20813dd6f35758d457` |
| `bob-worker 74` | ACTIVE; JWT false with existing private job/capability authentication; all **90** bundled files match; bundle `3f6f9cb7809e6ea05ae2340967ce0fff83fe76e354213ae9645e2fc052852d82` |

The connector successfully deployed the exact **93/92-file** closures after the
core SQL was installed. Only the compiler's existing type-only omissions remain:
`src/data/provenance.ts` in both bundles and `bob-request.ts` in the worker. Every
executable file matches the verified source; authentication modes are unchanged.

The activated catalog resolves to manifest
`08d9f59d-4eae-4f87-826d-403222192e33`, **272 definitions**, payload hash
`64eeaa29edcf866d5bfbbb3b6f72bb8e2774bffd47bc8a147c4159b707f2ca17`.
Exactly four existing identities advance: `bob.frame.outstanding`, both
`feedback.bob-budget-stop.resume` fragments and `tools.design_project_cad`.
Their entire content/definition/metadata/flow/variable payloads match the source
publication. All other 268 identities/hashes, all shared models/settings and the
entire previous pinned manifest `6482763a-214b-4022-9e32-92b42e9dac71` remain unchanged.

A hosted **BEGIN … ROLLBACK** probe passed task sharing, fresh-message reset,
retained draft/history, paid-result replay, unresolved-call fencing, exactly-once
direct late charges and ordinary/service-role authority checks. It made **zero
model dispatches**. Synthetic users and every probe write were rolled back.
All **153 original tables** (129 Bob domain tables, 22 private tables and the two
shared model/settings tables) retain their complete-row digests and counts,
including the real bed's saved drawing, pending draft and historical charges.

The new private history table has RLS and only the database-owner ACL. The advisor's
informational [RLS-without-policy finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is intentional for this denied-by-default private table; raw anon/authenticated/
service reads are denied in the hosted probe. No new Bob security warning/error
appeared. Performance advisors report the new `drawing_budgets_turn` index as
[unused](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
before any real new task; the previously unused call index remains. Unrelated
shared-project findings are not altered by this release.

Deployment is complete; PR review/merge remains. The next acceptance step is the
owner's real Bob message, checking the retained bed draft and measuring the
resulting context/cache, calls and cost. Technical probes do not establish bed
fit, model/mockup acceptance or a reduction in cost per accepted drawing.

### Calculator review output correction — 2026-10-12

The next real owner retry finished at **13:56 CEST** with the existing draft
retained and no newly saved drawing. It reached independent review, called the
programmatic calculator, and then stopped with `model_output_limit`: all **6,000
output tokens** in the failing reviewer response were reported as reasoning,
without a usable verdict. The task reset worked: current CAD period 2 had
**2/24 calls and $0.121099/$3**; the entire attempt logged **$0.230562** of AI
usage across four calls. The failed review was not a task spending stop, and
no completed review or accepted bed result is claimed.

`calculator-model-call.ts` had inserted an explicit 6,000-token ceiling over
the pinned reviewer profile's approved **50,000-token** ceiling. Its calculation
phase is model orchestration; `project-calculator.ts` performs the actual
deterministic computation without calling an AI service. [The calculator owner](ask-bob-tools.md#common-calculator-v1--implementation-2026-10-12)
keeps those boundaries separate. The fix preserves the role/profile and an
explicit caller ceiling rather than hardcoding 50,000. The existing round,
calculation, task-budget, deadline, authority and strict-schema guards remain.

Regression cases reproduce the pre-fix cap for the approved reviewer, a different
pinned profile and a larger explicit caller limit; a deliberately smaller caller
limit remains unchanged. They verify the role ceiling before and after an actual
code calculation and in the final tool-free schema call. A production CAD intake
fixture proves unchanged failed-runtime retries do no paid work; the repaired
runtime then renders the same exact draft and charges only independent review,
with no additional research/designer pass. The runtime policy revision changes
to `owner-task-period-review-limit-v4` so the real stored technical stop can be
released by this repair without editing the owner packet or granting budget.

The exact verified source, current full-suite/CI results and matching hosted
function versions are recorded in [PR #249's release record](https://github.com/EmelieHagander/Bob-the-builder/pull/249).
This correction requires only compatible runtime deployment; no database or
catalog configuration migration is needed. Real owner/model acceptance after
the repair and optimization of the separate orchestration overhead remain open
in [State](bob-delivery-flow.md#state).

### Calculator in normal structured calls — 2026-10-12

The user authorized removal of the separate calculation-selection phase. The
implementation now retains the specialist's pinned response schema while
offering `calculate_project` in the normal call. A direct verdict needs one
model call; one code-calculation round followed by a verdict needs two. Up to
two tool rounds remain bounded, followed only if necessary by a third call
with tools closed. Continuations send paired exact code results through the
same provider response ID instead of repeating the original context in a new
conversation. These are fixture-proven call counts, not measured real-bed savings.

The shared adapter requires a trusted `structuredToolOutput` opt-in; other apps'
legacy tool/text contract is unchanged. Tests exercise the actual production
request builder and response parser with only database/provider I/O replaced:
strict schema and tools coexist on the wire, code results retain units/method
version, completed durable results do not resubmit or duplicate charges, and
malformed or schema-invalid verdicts fail without a repair call. Wrapper tests
cover direct responses, preserved role/caller ceilings, round closure, invalid
tool protocols and live authority/policy revocation. Existing CAD retry tests
retain the exact draft and avoid another research/designer pass after a concrete
runtime repair. The revision is `owner-task-period-structured-tools-v5`.

The pinned role contracts already contain calculator guidance. The old
`calculator.schema-phase` fragment remains unchanged for history and is no
longer injected; no database/catalog publication is required. The exact source,
full-suite/CI results and hosted source readback belong to
[PR #249's release record](https://github.com/EmelieHagander/Bob-the-builder/pull/249).
Real owner/model/mockup acceptance and cost per accepted result remain in
[State](bob-delivery-flow.md#state).


## Background failure diagnostics — 2026-10-12

**Deployed 2026-10-13.** A retained drawing child expired without a registered provider response ID; its job/attempt failed while the operational request remained `collecting` and no private failure answer was delivered. The original transport/storage cause was not logged and cannot be reconstructed. The installed source fixes [shared diagnostics](shared-ai-background.md#content-free-failure-diagnostics--2026-10-12) and [Bob failure delivery](ask-bob-conversations.md#failed-drawing-background-jobs--2026-10-12), preserving the original paid-operation fencing, draft, Artifact revision and accounting.

All **1,312 local tests** pass on the final implementation, including real shared-service wire behavior, HTTP/transport/acceptance failure, lost diagnostic storage, same-ID retrieval, outbox failure, provider output ceilings, private RPC/RLS boundaries, cron expiry, one unread failure answer, stale/reset/cancelled/saved/revoked authority and exact draft recovery. Vocabulary and production build pass. The four affected Edge entrypoints type-check with an explicitly temporary import mapping to the installed Supabase client; the canonical local check is blocked by esm.sh connectivity and remains a CI gate. No ordinary owner message, provider call or cost grant is manufactured for release verification.

The earlier two combined hosted rollback-probe attempts did not return usable acceptance evidence: an operator cast in the probe was corrected, then the connector returned `Invalid or expired requestState`. Readback at that checkpoint confirmed that no diagnostic table or repair had persisted. The authorized retry on October 13 succeeded through the connector; no browser sign-in was needed.

### Hosted installation and readback — 2026-10-13

The exact deployed implementation is `805078b32ee8928b2f01302bac23b9309bbd220d`, tree `61ea6ffdc91bd14cf9cec4905deef07825e679bf`. Required [CI 38284109440](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38284109440), [native PostgreSQL/concurrency 38284109436](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38284109436) and [CAD adapter 38284109437](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38284109437) all passed on that source. Canonical Edge checking, production/PWA builds and the required intercepted browser flows passed in CI; the temporary local import map is not the release evidence for those checks. Subsequent release-documentation edits do not change this implementation source.

The first new application of each reviewed migration succeeded in the existing project `yuobtgoidmmmwfqenkau`. Independent ledger readback confirms:

| Reviewed source migration | Hosted ledger version/name | Source SHA-256 |
|---|---|---|
| `20261012164921_bob_drawing_failure_delivery.sql` | `20261013053429 / bob_drawing_failure_delivery` | `d0e60af1fac5a4093334cfcd7c4b02dfa812291f604d555d2205c9b8b35e86f4` |
| `20261012164941_shared_ai_failure_diagnostics.sql` | `20261013053641 / shared_ai_failure_diagnostics` | `33b6fefb3f0c24cb1b60c77f8c0c0443f28c63437934844f742f0b35fc46545a` |

All five changed SQL bodies match the reviewed source exactly. Their empty search paths, definer modes and role grants were independently read back: anon/authenticated cannot execute these private/service commands; only the intended service entrypoints are exposed. The diagnostic table has RLS, no anon/member read or write access, and service SELECT for inspection. All seven existing security-advisor findings are unchanged; no new finding appeared. Existing task-budget/calculator migrations, model settings and the active catalog were retained.

Fresh preflight found zero active Bob jobs and zero shared submitting/pending provider jobs. The four deployments preserve their existing JWT/custom-authentication settings. Independent GET readback compared every emitted file byte-for-byte with the implementation source:

| Runtime | Before → installed version | Existing JWT setting | Emitted files | Installed bundle SHA-256 |
|---|---|---|---|---|
| `ask-bob` | 108 → 109 | true | 93 | `996cc6e2bf036df1f604f1b6abd4b25dc67446e4f37d3984cb1309e126e439bf` |
| `bob-worker` | 76 → 77 | false; private capability authentication | 91 | `e8de3b59d6ef57b488925f9961881507b220766daa91f9a19665d1bb2693da85` |
| `ai-background-worker` | 3 → 4 | false; private capability authentication | 5 | `80ebe05891be41895a01a5a0e658827bd1940bc06951c8dd1ff7551b275f3c78` |
| `ai-background-webhook` | 3 → 4 | false; verified provider signature | 5 | `dea520af8dc155bf2d7fdbe47821a1582f3d9681cec91d4fb1a58a40e83d31a1` |

Submitted closures contained 94/93/5/5 files. Only the expected type-only imports were omitted: `src/data/provenance.ts` in both Bob bundles and `_shared/bob-request.ts` in the worker. Both old shared-background bundles used a `functions/` root and the older helper without the optional local-preparation callback. That exact difference was reviewed before replacing them with the tested shared source; authentication/routing files otherwise matched the prior source.

The repair found the still-current retained request `be654826-d1ac-4373-aa9a-1ac7a5e428a8` / child `d9ac3dbc-f605-4158-b935-218f8fa855f4`. Header and private packet now agree on revision **20**, `retrieval_failed` / `background_expired`. Packet MD5 excluding the new `execution_failure` remains **`d44aa16ef3409745f0e9badee7101394`**. One private assistant answer was appended at sequence **11** under the child-job ID; the original owner turn and earlier answer remain intact. The existing saved Artifact revision 2, paid-result history, budgets and usage are unchanged. No new drawing is claimed.

Across SQL installation, **152 of 159** pre-existing Bob/shared row-set counts and complete-row digests matched. The packet/header, existing gap projection, thread/message and execution-event row sets changed with the guarded repair. Shared AI-job bookkeeping also changed between reads; that digest alone is not evidence of the original failure's cause. A fresh post-SQL baseline then matched **all 159** complete-row digests across the runtime deployment and rollback probe, including all retained work, model settings, accounting and AI jobs.

A bounded hosted transaction, subsequently rolled back, verified service diagnostic storage and exact bounded fields, rejection of an extra private-text field, denied member write/read access, and idempotent repair with exactly one failure answer. Independent post-rollback readback found zero persisted diagnostic fixture rows, the same revision-20 packet hash and unchanged original AI operation `513aa8dc-8d7b-4e1a-8ab0-06829a123446`: still expired, provider response ID still absent. The unresolved original CAD reservation is retained. No owner message, provider retry, accounting completion or spending grant was manufactured.

The SQL/CI/source/preservation gates are complete for this change. The original uncertain POST is not settled or blindly resent; newly observed failures can now identify their phase/code without private content. [State](bob-delivery-flow.md#state) owns ordinary member readback, real owner/model/mockup acceptance and cost per accepted result. [PR #249](https://github.com/EmelieHagander/Bob-the-builder/pull/249) remains open for review/merge.

### Runtime regression and readiness — 2026-10-13

The owner's readiness check found a subsequent deployment at **ask-bob 110 / bob-worker 78**. Compared with the tested implementation, both bundles had reverted the integrated calculator to the preliminary AI phase and hidden 6,000-token ceiling, removed submission/acceptance diagnostics and reverted task-budget parsing/recovery to the old request/top-up behavior. All nine differing ask-bob files were reviewed; its shared files matched the worker's copies. The shared background worker/webhook remained at the correct version 4, and both installed SQL migrations remained present. This establishes a runtime regression, not who initiated that deployment.

Fresh preflight again found no active Bob or submitting/pending shared AI jobs. The tested implementation `805078b32ee8928b2f01302bac23b9309bbd220d` was restored without reapplying SQL: **ask-bob 111 / bob-worker 79**, retaining their existing authentication. Their bundle SHA-256 values are exactly those of the original 109/77 installation above. Independent GET readback matches every emitted source file; only the same reviewed type-only imports are omitted. All **159** protected row-set counts and complete-row digests match before/after this restoration. [Final documentation-head CI 38353775253](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38353775253), [native PostgreSQL/concurrency 38353775250](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38353775250) and [CAD adapter 38353775254](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38353775254) also passed at `1b7a9f2db3e747d0b0df31c20e9dd3fc110ba54c`; the restored implementation is unchanged.

**Pre-integration readiness snapshot.** The same bed request was not yet ready for another drawing-model call; the integrated release below supersedes this continuation boundary. The retained request/packet still agree at revision 20, with unchanged draft hash and one failure answer. Its period-2 reservation remains incomplete and the original expired provider job still has no response ID. Live `bob.bob_drawing_budget` source MD5 is `6027ea6bba55e29826c9ee958c3c2ea2`: pending calls are selected when `m.request_id=p_id` **or** their period belongs to the current owner turn, and any pending call blocks a new reservation. Consequently, the old uncertainty still blocks this request after a new owner budget period; a budget reset alone does not resolve it. No new owner turn/model call was manufactured to demonstrate that boundary, and no unknown outcome was marked free/completed. [State](bob-delivery-flow.md#state) owns resolving this continuation boundary before real bed/model/mockup acceptance. Future deployments must retain the tested task-budget/calculator/diagnostics source.

### Integrated task recovery — 2026-10-13

The integrated #249 implementation retains main's #232 model-facing redaction
and #250 acknowledgement expiry, together with the owner-task budget,
calculator and private failure-delivery fixes. A fresh genuine owner task can
authorize one distinct terminal CAD attempt; current-task replays and active
older work remain fenced. Old unknown accounting is preserved, available paid
output is reused, and late usage settles exactly once in its original period.
The shared transport now rechecks one submission intent after local preparation;
cancelled or expired preparation sends no provider POST. Legacy unacknowledged
operations remain uncertain.

Native full-schema fixtures cover old uncertainty, task fencing, paid recovery,
late original-period billing, legacy caller completion and provider fingerprint
compatibility, never-submitted zero settlement and service/member RPC authority.
Runtime fixtures cover preparation-time cancellation/expiry with zero POSTs,
safe diagnostics, replayed owner notices and ledger-free tool replies. Catalog
fixtures verify two new immutable versions, reproducible older publications,
unchanged models/settings and retained pinned manifests. Exact-head CI and
hosted installation/readback are recorded below when completed; real member,
model/mockup acceptance and measured drawing savings remain open.


#### Completed hosted integration — 2026-10-13

[PR #249](https://github.com/EmelieHagander/Bob-the-builder/pull/249) is merged as
`b356d0491e5f27c53cb3f6549de5ba5f295cd5d2`, with the exact tested tree
`85152395b7ecefa8f9151d67e3ff5a9e89a291c8`. Final source
`98ae0e6c4604b344468a613358b2cfe5c14c9e8a` passes **1,324/1,324 tests**,
[CI 38407481552](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38407481552),
[native PostgreSQL/concurrency 38407481991](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38407481991)
and [CAD adapter 38407481554](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38407481554).
Canonical Edge, production build, vocabulary, PWA and phone/desktop browser
checks pass. Main incorporates #232/#250 and the task-budget/calculator/diagnostic
fixes; its tree is independently read back rather than inferred from merge status.

With no active Bob or shared submitting/pending jobs, only these new migrations
were installed in the existing project. Earlier task, failure, redaction and
acknowledgement migrations were retained.

| Source migration | Hosted ledger version / name |
| --- | --- |
| `20261013120145_ai_submission_guard.sql` | `20261013140647 / ai_submission_guard` |
| `20261013120146_drawing_task_attempt_recovery.sql` | `20261013140648 / drawing_task_attempt_recovery` |
| `20261013131820_ai_task_resume_catalog.sql` | `20261013140827 / ai_task_resume_catalog` |

All **seven** SQL bodies match source, with fixed empty search paths and the
expected service-only RPC/private-helper grants. Existing private RLS and
anonymous/member denial remain. Matching runtime closures were deployed before
catalog activation and merge; existing JWT/capability/signature modes remain.
Independent GET readback matches every emitted source file, omitting only the
same known type-only files as the preceding release.

| Runtime | Version / emitted files | Bundle SHA-256 |
| --- | --- | --- |
| `ask-bob` | 112 / 93 | `006c8860ef9c1f1fac1a5980a7aa02ca5332ffaadd074a2573776f62a4824b73` |
| `bob-worker` | 80 / 91 | `4405936b4da98046e491aea0170ef06ad49201412e9d6e38aca0e5a3a2f98994` |
| `ai-background-worker` | 5 / 5 | `2a628c1c1b6c3bbc5cc073bef5a106e893195e7f265ebdaae159fab1c66fbd25` |
| `ai-background-webhook` | 5 / 5 | `f9a4ae9be0d57a614ea7d80450f1b7265b7123aef3b438201fc537d42eb82d69` |

Catalog activation publishes exactly **two** versions: 351 → 353. All 351 older
version rows retain digest `177d30597c0d77f17b7fa456ce766972`. The new manifest is
`df4c7e8c-68c9-4ec1-b778-716363b85e87`, hash
`7331dc73a41ff1439174058c6def3e8d3a48695987dc5a2b7a98b3969a55e758`;
it is persisted as the fourteenth Bob manifest. The previous pinned manifest
still resolves to digest `24b98656046a73cd235e8718369037d1`. Model/settings rows
are unchanged and the old budget paragraph is absent from the active tool guide.

The hosted **BEGIN … ROLLBACK** probe passed expired-preparation and cancellation
gates, `not_submitted` diagnostics, service/member authority and zero fabricated
usage. Fixture receiver/jobs/diagnostics were rolled back. Across installation,
runtime deployment, catalog activation and the probe, all **160** protected row-set
counts and digests of existing fields match; only the four newly added nullable
fields are excluded from the comparison. Security advisors remain seven
categories with no added or removed findings.

The original bed packet/header stay at revision **20**, with retained packet hash
`d44aa16ef3409745f0e9badee7101394`. Its saved Artifact and original owner turn are
unchanged. Period 2 still has **3 calls / $0.121099** known spend; the old incomplete
reservation remains cost-unknown with no fabricated receipt, free settlement or
new owner instruction. Installation opens no new budget period. The verified
new-task boundary permits a distinct attempt only on a genuine next owner message
after terminal older work; it preserves that old uncertainty and reuses paid
usable results. Native fixtures and exact hosted body/source readback prove the
boundary without spending on another real bed attempt.

The original missing receipt's transport/storage cause remains unreconstructable.
Ordinary member readback, the real bed/model/mockup outcome and measured cost per
accepted drawing remain in [State](bob-delivery-flow.md#state).


## Server-bound project edits — 2026-10-14

[PR #254](https://github.com/EmelieHagander/Bob-the-builder/pull/254) merged as
`ff2ede06b28440d514aecbf4d2ca9f8760c3cda3`, tree
`748a9f707f7ea12ded2c5018faa6441d7095ef08`. Final PR CI
[38554880035](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38554880035)
and lineage concurrency
[38554880117](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38554880117)
passed, including full tests, normal-import Edge checks, build and browser gates.

| Installed item | Readback |
| --- | --- |
| Core | Hosted `20261014114147`, `server_bound_project_edits`; exact source `20261014104842_server_bound_project_edits.sql`. |
| ask-bob | ACTIVE v119, JWT true; bundle `f4efdd0fdc641694936d5c6cea6f9d5f9949c7c96532d4cdc79bef98f92179b9`. |
| bob-worker | ACTIVE v87, JWT false with unchanged custom authentication; bundle `31d11a97a331a8bc0e8e1091e720bf254af6a85311358fae7707ae578d93e453`. |
| Catalog | Hosted `20261014114222`, `ai_server_bound_edits_catalog`; exact source `20261014105502_ai_server_bound_edits_catalog.sql`. |
| Resolved manifest | `347b69d0-3c08-4563-adfc-76c4ca5a540f`; both new tool contracts v1 and both live policies active. |

Before upload, every deployed file matched the merge parent. After upload, all
93 returned ask-bob files and 91 worker files matched the merged source exactly.
Only type-only `provenance.ts` and, for the worker, `bob-request.ts` were omitted
by the bundler. Core preceded both runtimes; catalog activation followed both
source readbacks. The public reader/writer are invokers with empty search paths;
the private writer retains its explicit claim/access guards. Authenticated has
execute, anon and service_role do not. Security advisors returned seven finding
categories across the shared project, none naming the new functions; existing
unrelated findings were not changed by this release.

Isolated tests cover caller/RLS/claimed-turn read–edit–readback, preservation,
concurrent target rejection, downstream rollback, exact retry, successive edits,
restart and model-loop completion after correction. This is a technical release:
no ordinary-member Auth/HTTP acceptance or actual-model run of the new tools was
performed during deployment. No live latency/cost improvement is asserted.
[The write owner](ask-bob-writes.md#server-bound-edits-and-canonical-data-reuse--owner-decision-2026-10-14)
tracks the next work-record slice and the remaining tool families.


## Server-bound solution actions — 2026-10-14

[PR #255](https://github.com/EmelieHagander/Bob-the-builder/pull/255) merged as
`4bff7fe5260dbaf8d473a92a05896bb40e1f9022`, tree
`e64c81c2b97b97764c5031686b3b61aefc607019`. Final-head CI
[38560940693](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38560940693)
and concurrency
[38560940898](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38560940898)
passed, including full tests, normal Edge imports, build and all browser gates.

| Installed item | Readback |
| --- | --- |
| Core | Hosted `20261014122025`, `server_bound_solution_actions`; source `20261014114416_server_bound_solution_actions.sql`. |
| ask-bob | ACTIVE v120, JWT true; bundle `e91fdcf7c9a911cd0c88472495f510e291377b0a93fbd50b535082c3c3614d3e`. |
| bob-worker | ACTIVE v88, existing JWT false/custom auth; bundle `990dff38b858642fbb32c59580478a4b706a93f6a33e296baecd8db12d0e24ee`. |
| Catalog | Hosted `20261014122103`, `ai_solution_actions_catalog`; source `20261014114816_ai_solution_actions_catalog.sql`. |
| Resolved manifest | `46fe1288-6f81-4766-ab41-f15b582004a8`; four new contracts with server-filled write provenance. |

The previous deployed source matched the merge parent before upload. All 94
emitted ask-bob files and 92 worker files then matched the merged tree exactly;
the bundler omitted only type-only files. Core preceded both runtimes and catalog
activation followed both source readbacks. Public reader/writer remain invokers,
the private writer remains a guarded definer, all have empty search_path and
only authenticated execute. No security-advisor findings name the new functions.
The new work-record implementation is not part of this deployment.

Isolated tests cover alternative creation/copy, no create-on-failed-edit fallback,
exact selection/source CAS, image/measurement preservation, atomic selected-target
updates, rollback, distinct retry receipts and journal restart. This is technical
deployment evidence, not ordinary-member Auth/HTTP or actual-model acceptance.
No measured live latency/cost improvement is asserted.

## Server-bound work records — 2026-10-15 readback

[PR #256](https://github.com/EmelieHagander/Bob-the-builder/pull/256) merged as
`906ef1653b82aeb9350fc0e29d40bc09d19b8903`. Its head
`3cee5d767e9299b95f55c21ca7731d7abc7c1877` passed CI
[38565491057](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38565491057)
and PostgreSQL concurrency
[38565491110](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38565491110).
The continuation inspected installed state before attempting publication.

| Installed item | Readback |
| --- | --- |
| Core | Hosted `20261014132349`, `server_bound_work_records`; exact statement equals source `20261014121359_server_bound_work_records.sql`. All five function bodies match source, empty search paths and intended invoker/guarded-definer ACLs. |
| ask-bob | ACTIVE v121, JWT true; bundle `426c2e3481782978bcfd0ce8e69ab92e826df7c944418ab726424915d6951690`; all 95 emitted files match merged source. |
| bob-worker | ACTIVE v89, existing JWT false/custom auth; bundle `08dfd8b318629cd8cc4f5c4acda2e1690f0cdf03c5ad6ba982dcae3123205859`; all 93 emitted files match merged source. |
| Catalog | **Not installed.** No ledger entry for `ai_work_records_catalog`; all six new tool policies/contracts absent. Prior project/solution tools remain active. |

Two attempts to apply only the reviewed `20261014121841_ai_work_records_catalog.sql`
failed at the Supabase connector with `Invalid or expired requestState`
(`INVALID_ARGUMENT`, `invalid_request_state`). Readback after each still showed
no publication. No alternative SQL write path was used to bypass the failure.
No new runtime upload or actual-model request was made. No Bob/provider work was
active at the pre-publication check.

Before/after aggregate hashes matched for 155 of 156 inspected table rowsets,
including project data, AI settings, models and catalogs. The one difference was
`bob_private.drawing_authorities`, whose count fell from one to zero; existing
expiry cleanup can delete these rows, but this check does not establish the
cause. It does not justify a blanket claim that every runtime table was unchanged.
Focused work/solution/runtime tests passed 40/40 locally. This is an installation
and blocker report, not ordinary-member or actual-model acceptance.

## Server-bound plan focus and Task links — source verification 2026-10-15

[PR #257](https://github.com/EmelieHagander/Bob-the-builder/pull/257) covers only
current-plan focus and existing Task associations.
Local PGlite tests exercise full migrations, caller RLS and claimed writes:
set/clear focus without changing parallel Step states; link/move/unlink while
preserving Task instructions/status/assignees; stale focus, Task and relation-only
changes; wrong project, forged targets, missing claims and raw ID rejection;
paged reads; old-manifest preservation; server-filled provenance; and restart
replay with live access revocation. Seven new tests and the affected readiness
catalog/runtime suites passed (27/27). The initial full suite passed 1271/1273;
two stale publication/wiring assertions were corrected, leaving historical
migrations unchanged. The new catalog has its own reproducibility check.

Local production build and vocabulary checks passed. Local `check:edge` could
not fetch the existing esm.sh Supabase dependency (connection refused); normal
Edge imports and browser gates therefore require CI. Seven additional real
PostgreSQL races cover mutation-first/save-first focus/Step/link changes and duplicate
link replay, with observed lock waits; CI owns their execution evidence.

Direct manual review checked caller authority, complete read binding, canonical
command delegation, receipt ownership and old-manifest compatibility. It found
and closed a direct service Step-edit race by locking the selected Step/revision
before snapshot comparison; the seven plan tests passed again. Archie's document
workflow was applied manually to keep contracts, forward-looking State and
release evidence with their existing owners; no independent steward run is
claimed. The PR records final-head CI/concurrency results before merge.

Supabase CLI help and migration creation both aborted in the installed native
Bun runtime. Additive filenames use observed UTC as the documented fallback;
no successful CLI generation is claimed. Core, runtime and catalog for this
slice have not been deployed. No live user project was edited, and no real-model,
bunk-bed/mockup, reload or cost acceptance is claimed.

## Own-write continuation — hosted release 2026-10-16

[PR #258](https://github.com/EmelieHagander/Bob-the-builder/pull/258) fixes the two
reproduced Task continuation stops: a verified own write crossing the 1,200-character
preview boundary, and an older idempotent receipt replacing the latest recovered
record projection. The [context contract](ask-bob-context.md#own-write-continuation-corrections--2026-10-16)
owns the behavior; unrelated warnings, scope/access changes and external edits
still stop the turn.

All 1,275 local tests, production build and vocabulary checks passed.
[CI run 38952838339](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38952838339)
also passed, including Edge type-check and all browser gates. Merge
`8248653a7a8e0b8781daac83d4e13704ebea9d0c` has the exact tested tree
`2381a81caa9e68028443f76017e3d8d0273b3752`.

Both functions were deployed from that immutable source, preserving authentication:

| Runtime | Installed state | Bundle SHA-256 |
| --- | --- | --- |
| ask-bob | Version 123, ACTIVE, JWT verification enabled | `6264d8f83b05c7cf854565a85d78fac7c89510c13aac008987ebb0d608e1b6f1` |
| bob-worker | Version 91, ACTIVE, existing custom capability authentication / JWT verification disabled | `c73ae880e60e41379d6f12eb1fed8b9e924d927613cde90b46819adde9c6c993` |

Every returned runtime file matched the uploaded source: 96 for ask-bob and 94
for bob-worker. No previous runtime file was missing. The prior closures matched
the candidate except for the two fixed modules. Live HTTP checks returned 204
for ask-bob OPTIONS and 401 for unauthenticated POST to both endpoints.
[Pages run 38955493276](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38955493276)
successfully published the merge.

No database migrations, prompt/model configuration changes or user project writes
were part of this release. Existing saved changes and historical recovery messages
were retained. A fresh ordinary-member/model continuation after this deployment
has not been exercised; source/readback, deterministic regressions and transport
checks do not substitute for that acceptance.


## Write conflicts and sequential work — hosted release 2026-10-17

[PR #259](https://github.com/EmelieHagander/Bob-the-builder/pull/259) corrects the
October 16 run that saved Task text, then repeatedly retried a stale status write.
Expected SQLSTATE `40001` application conflicts were retried inside PostgREST,
turning a recoverable conflict into an unknown outcome. The [write contract](ask-bob-writes.md#sequential-work-changes-and-conflict-recovery--2026-10-16)
owns transport mapping, fresh immutable read refs and honest write-paused feedback.

All 1,280 local tests, build and vocabulary checks passed; the final focused
work-record suite passed all 20 cases. [CI 704](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38965908103)
and [PostgreSQL concurrency](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38965908262)
passed, including Edge type checking and every required browser gate.
Merge `9e1ce03683abeff2a8ede7fbf9c804e29536487b` has the exact tested tree
`6977a80d0143234b812763c5a5d4a99583b45002`.
[Pages publication](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/38968438456)
completed successfully. The initial function upload returned no outcome and was
interrupted; live version/hash inspection confirmed it had not installed before
the successful retry. Neither migration nor project writes were repeated.

`20261016205152_bob_write_conflict_transport.sql` was applied as hosted ledger
`20261016211843 / bob_write_conflict_transport`, source SHA-256
`2023038c6d4a3ce066886c53e35aebe91a4403cda29ba21e008213914fe3712f`.
Live catalog inspection confirms all five public writer adapters are PL/pgSQL,
map aborted conflicts to PT409, retain invoker security and empty search paths,
and remain executable by authenticated callers, not anon or service_role.
Private domain commands and their authority were not replaced.

A hosted SQL fixture exercised normal authenticated project authority, a
service-only turn claim, then authenticated writes. It verified three saved
actions (content, status, a second Task), exact retry, and eleven conflict
responses across the public routes, including stale bound content and expired
claims. All fixture Project, Task, turn and receipt changes were deliberately
rolled back and their absence asserted. This is real database/role proof, not
an HTTP timing measurement or an ordinary-member OpenAI conversation.

| Runtime | Installed state | Bundle SHA-256 |
| --- | --- | --- |
| ask-bob | Version 124, ACTIVE, JWT verification enabled | `9a82ae691b1a531d5a07bc955b26d858c080201b6f8e97e06c1846e709a67adf` |
| bob-worker | Version 92, ACTIVE, existing custom capability authentication / JWT verification disabled | `da767245bb1469adc6683e89674cb26f1895f99a6570e977a5c0c002d02353fa` |

All returned runtime source files matched the uploaded tested source exactly:
96 for ask-bob and 94 for bob-worker. Bundling omitted type-only/unreferenced
files as in the previous release. Live OPTIONS returned 204; unauthenticated
POST returned 401 for both functions. No Bob jobs were active before deployment.

Current catalog `627f30a8-de42-4706-8dd0-861166510503` exposes work content,
create, relation, readiness and state tools plus plan focus/Task links at schema
version 1. The work-record catalog and plan-link core/catalog migrations are
present in the hosted ledger; this supersedes the older installation blockers.
This release did not change the catalog or model settings. No real user project
content or historical chat was edited. Fresh ordinary-member/model continuation
with these new runtime versions remains an acceptance check; deterministic,
SQL-role and source-readback proof do not substitute for it.


<a id="bob-task-investigation-2026-10-17"></a>
## Task edits, status and early completion — investigation 2026-10-17

**Status: investigation and targeted verification complete; proposed improvements
are not implemented.** The [implementation plan](bob-delivery-flow.md#bob-task-pr-plan)
owns the next PR. Baseline is main `8f5a373def3ba0414290b354d777519907270da8`,
with the runtime installation recorded above. This investigation changed no real
project Tasks, historical conversation messages, active catalog or model choice.

### Observed attempts

Read-only queries examined the requested project's conversation, write receipts,
content-free execution events and scoped retained provider function-call output.
Times below use Europe/Stockholm (UTC+02:00).

| Observation | Evidence | Interpretation |
|---|---|---|
| October 16, 22:46: an instruction edit saved, then status failed. | Turn `f31bd331-10f1-4054-915e-378cfbf7da0d`, events `tool:9:0` = `edit_work_record/saved`, `tool:9:1` = `change_work_state/unknown`, next edit = `budget_exhausted`; delivery = uncertain. | This is a real status-write failure before PR #259, not evidence that the current status path is still broken. |
| Conflict-loop indicators in that old incident window. | Postgres log window 2026-10-16 20:40–20:48 UTC: 1,771 `record_changed`, 5,153 `turn_not_claimed` and one `deadlock detected`. All five live public writer adapters now translate aborted conflicts to PT409. | The shared-project log window is corroboration, not a per-turn attribution of every log row. Prior release evidence establishes the transport defect and correction. |
| Four later user runs completed with 5 + 2 + 4 + 3 = 14 content receipts. | Turns `721dd10f-c818-46c4-b85e-06afb7f7d24e`, `b7697339-bc17-4a1e-8c50-d0369e62e167`, `c709cb0d-bacd-4ae1-89cc-66613fb59722`, `b8c859bf-a13b-4452-a68f-30bf91cc99ca`. Every receipt's nested domain kind is `task`; no requested status; resulting status `todo`. | Real multi-task text saves and successive edits work. The retained tool-event lists contain no `change_work_state` attempt in these four runs. They do not establish real-model status acceptance. |
| October 17, approximately 04:20: two newer text-edit attempts were invalid, then corrected. | In turn `c709cb0d-bacd-4ae1-89cc-66613fb59722`, retained `model:ask-bob:2` has two `append_text` calls whose `value_json` contains literal newline control characters inside the encoded JSON string. Local `JSON.parse` fails at position 1. `model:ask-bob:3` correctly escapes those newlines and both edits save; a further pair also saves. | Confirmed tool-input ergonomics defect: JSON-in-JSON causes avoidable repair calls. This is separate from the older status conflict and was recovered in the run. |
| The newest visible run finished at 04:26:04 after three saves. | Latest turn above: five model-loop steps, six tool calls, zero completion checks, `end_reason=answered`, three saved targets. Its final text introduces another planning step. | No automatic continuation is scheduled after that answer. The code accepts ordinary terminal prose; successful partial work does not trigger the current narrow completion review. This explains the risk of needing another user nudge. |

The two newly invalid edit calls are reproduced by an encoded value that starts
with a quote followed by a literal LF; the corrected value contains the JSON
escape for LF. Normal outer tool JSON remains valid. No production mutation or
model call was performed to reproduce this parser behavior. Instruction text
also grew through overlapping dated append blocks, so successful saves alone do
not establish concise or complete planning.

Completed Bob journals have been cleaned up. The retained execution events and
shared background function-call outputs above provide the attempt evidence;
there is no claim to have reconstructed every private runtime intermediate.
A job marked `completed` describes job settlement, not fulfilled user scope.

### Current status path: local and hosted proofs

The existing `tests/project-work-records.test.ts` passed **20/20** locally using
the full-schema isolated database and normal authenticated write role. A separate
TypeScript probe exercised `change_work_state` through the bound v19 write path,
with fresh reads between operations:

`todo → doing → done → todo → blocked → todo`.

Every transition saved and read back correctly; exact retries recovered the
existing receipt; instructions and assigned person were preserved. An incomplete
required checkpoint correctly rejected `done` and left the Task at `todo`.

The same deployed public writer was then tested in a disposable hosted project.
The database operator supplied the authorized actor, the normal service-only
command claimed the turn, and every domain write ran as `authenticated`.
This is an SQL-role fixture, **not an HTTP/provider run or a real user's Task
status change**. All changes were deliberately rolled back inside a subtransaction.
The probe asserted that its Project, Tasks, person, thread, messages and receipts
were absent afterwards.

| Hosted assertion | Result |
|---|---|
| Content + five status transitions + second Task | Seven saved actions, all read back |
| Identical retries | Six recovered receipts |
| Stale snapshot / stale claim across v16–v20 | Eleven PT409 rejections |
| Assigned person and instructions | Preserved |
| Required checkpoint blocks `done` | P0001; status remains `todo`; snapshot unchanged |
| Fixture cleanup | All changes rolled back; absence asserted |

The executed probe source SHA-256 was
`4867e66ebe765a7e36c8b4a39ff21bf285973651316794ac3341761c0df2ac44`.
A reusable [rollback-only fixture](../scripts/fixtures/bob-task-state-rollback.sql)
contains the same assertions, with actor input parameterized rather than looking
up the investigation's thread. It is not a production migration. Because a SQL
DO block shares one `now()` timestamp, an optional checkpoint is added after
reopening and a required one before the final rejection, producing distinct
snapshots without altering triggers or timestamps. The separate TypeScript
probe tested the uninterrupted round-trip across separate transactions.

**Remaining confirmed diagnostic defect:** SQL returns a specific missing-required-
checkpoint reason, but `project-write.ts` maps nested `bound_work → task_work`
P0001 to the generic database-rejected message. Bob cannot see the actionable
reason. The PR must improve that mapping without removing the completion guard,
auto-checking physical work, or turning general readiness into a new status rule.

### Model/runtime findings and open acceptance

Active catalog readback gives `profile.ask-bob` version 1: standard tier, high
reasoning, 16,000 output ceiling and 120,000 ms profile timeout. The actual turn
adapter may apply a stricter timeout. `tier.standard` version 1 maps to GPT-5.4;
mini/nano remain GPT-5.4 mini/nano. Neither GPT-6.1 Sol nor GPT-6 Astra was present
in the inspected model rows, so API availability was not established.

The shared adapter already uses Responses and provider response chaining.
Inspection identified first-message text extraction without assistant phase and
missing cache-write accounting. These are compatibility gates for the proposed
upgrade, not proof that phase caused the observed GPT-5.4 answers. The planned
model comparison has not been run, and no paid candidate call or activation took
place during this investigation.

Still required for release: native typed-value regressions, v1/v2 replay,
meaningful status blocker feedback, broader one-time completion review, text
consolidation, phase/cost compatibility, four-role model evaluation and real
member readback in the UI. Hosted status proof closes the database-function
question; it does not close these model and product acceptance gates.


<a id="bob-task-workflow-release-2026-10-17"></a>
## Bob task workflow parts 1–3 — hosted release 2026-10-17

The owner limited this release to native work values, status diagnostics and
completion/text-workflow improvements. GPT-5.4/high, all model profiles, spending
and call budgets remain unchanged; model evaluation and UI work are deferred.
The owner will perform the ordinary real-model acceptance after installation.

Source publication is `20261017050720_ai_task_workflow_catalog.sql`, generated
from `scripts/build-bob-task-workflow-catalog.ts`. The previously observed native
Supabase CLI crash requires the documented actual-UTC filename fallback. It
creates immutable versions of only three work-value tools, their toolbox and
focused Bob instructions/behavior flag; no domain table, canonical writer,
permission or user Task content changes. Both compatible runtime closures were
deployed and read back before activating the publication. The hosted migration
ledger records `20261017063533 / ai_task_workflow_catalog`.

[PR #260](https://github.com/EmelieHagander/Bob-the-builder/pull/260) merged as
`b2f31dc2ca093178a971a0d52771915a60d1a9ce`. Its source tree
`cb7e22cfe88e5ca524154abfaec43bccf6f39a02` exactly matches tested head
`f930f5da7eb076f2d042dda83f3e8f382e4e2017` and the deployment packages.
[CI 39006469549](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39006469549)
passed **1,309/1,309 tests**, vocabulary, Edge types, production/live-config
builds, PWA and every required browser gate. All 51 recorded steps succeeded.
[PostgreSQL concurrency 39006469557](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39006469557)
also passed. Local Edge dependency retrieval was unavailable; the successful CI
Edge check supplies that gate, not a claimed local pass.

The regressions cover exact native multiline values, status roundtrips and
required-check blockers, phase-aware final selection, bounded progress-message
continuation, one completion review without a duplicate save, safe telemetry,
and byte-identical replay of an actual pre-publication manifest. Historical
schemas/manuals and rejected-result bytes remain unchanged across live-policy
activation, with no repeated transports or extra snapshot reads. Complete
historical seed parity and exactly three current policy upgrades are checked.

| Installed function | Version / authentication | Read-back bundle SHA-256 |
|---|---|---|
| `ask-bob` | 125, ACTIVE, gateway JWT unchanged (`true`) | `c10968f278467f10c0d37ae3ec0a4c8823a47d46fb230621e1ae8d1c6c563a2e` |
| `bob-worker` | 93, ACTIVE, existing internal authentication (`verify_jwt=false`) | `054d8590f07750f86f40297bd38e1ca680ad2786545283e65674615a75b21e69` |

Every shipped file matches the merged source. The bundler omits the type-only
`src/data/provenance.ts` from both closures and the worker's type-only import of
`bob-request.ts`; all executable imports are present. Unauthenticated POSTs to
both deployed endpoints returned 401 after installation.

Read-only catalog snapshot hash is
`fe775ee730f748382db27572a9ddbef84ffd7c8904df3135f47c2f70707a5a89`.
All **290 definitions** match the expected publication content (excluding
generated identities/version hashes). Exactly eight existing definitions
changed and three commentary/review fragments were added; none were removed.
The three work-value contracts and live/pinned policies are active v2 with
native `value`; `bob.tools` is v11 and the agent contract is v2 with
`work_completion_version=1`. Every model, setting, profile and tier remains
unchanged, including GPT-5.4/high and its 16,000-output-token/120-second profile.
Old manifest `627f30a8-de42-4706-8dd0-861166510503` remains present with a valid
payload hash. Rollback reactivates the previous catalog while retaining the
compatible runtime and live policy v2 until pinned v2 jobs drain.

[Pages 39007776911](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39007776911)
published the merge successfully. The merge-triggered
[Live Bob check 39007776964](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39007776964)
passed guest Auth/RLS, actual OpenAI lookup, pixels and knowledge before this
runtime/catalog activation; it is continuity smoke evidence, not acceptance of
the new task-writing behavior. Its disposable project
`p_bb04072398074c70bbdd0e1f46b10928` was removed after exact name/type, guest
ownership and absence-of-output checks. Independent Project/people/Task/material/
media readback is zero; image cleanup had already passed through caller APIs.
No additional paid owner-conversation probe was launched. The next acceptance
is the owner's ordinary new task-edit turn, including saved text/status readback
and whether Bob finishes without an extra prompt; see [State](bob-delivery-flow.md#state).

<a id="bob-continuation-release-2026-10-17"></a>
## Continued delegated work without application quotas — hosted release 2026-10-17

[PR #261](https://github.com/EmelieHagander/Bob-the-builder/pull/261) is merged
as `8935191f74fe49428d098e1ffc67bf0a266776d6`. Its source tree
`16dbc1187dea983f3aab8c7c84a0950d9f16fe29` exactly matches tested head
`b753a827c1163642231a18f713c868a7d4191a72`. The
[conversation owner](ask-bob-conversations.md#active-memory-and-continued-work--2026-10-17)
defines continued work, genuine blockers, pinned policy, session renewal and Stop.
This supersedes the preceding release's preserved application budgets for newly
enqueued durable policy-1 jobs; historical jobs retain their original policy.

The three additive migrations were already installed and were **not rerun**.
Read-back ledger statements are byte-identical to the tested source files,
despite different filename and hosted timestamps:

| Migration name | Source filename timestamp | Hosted ledger version |
|---|---|---|
| `bob_unlimited_work_lifecycle` | `20261017100000` | `20261017100558` |
| `bob_unlimited_write_receipts` | `20261017100500` | `20261017100614` |
| `bob_unlimited_model_work` | `20261017101000` | `20261017101532` |

Both matching closures were published and read back before merge/web publication
and the final catalog activation:

| Installed function | Authentication | Published/read-back files | Bundle SHA-256 |
|---|---|---|---|
| `ask-bob 126`, ACTIVE | `verify_jwt=true` | 96 | `3c5f990ee885ab73a041cb69db64781b83283b28aa36c6110bfee772e3640225` |
| `bob-worker 94`, ACTIVE | Existing internal authentication, `verify_jwt=false` | 94 | `1fc16f5a9474fc6bdcf0d2bd31aa7d3c6a41d4938f8a0cd26bc124812cc22073` |

Every returned file matches the immutable tested source byte for byte. Packages
include all transitive local dependencies, including source modules outside the
function directory. Only type-only `src/data/provenance.ts` is omitted from both
returned bundles; the worker also omits its type-only `bob-request.ts` import.
Unauthenticated POSTs to both updated endpoints returned 401.

[CI 39020870979](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39020870979)
passed every recorded step, including tests, vocabulary, Edge checks,
production/live-config builds, PWA and required browser fixtures. The mobile and
desktop Stop, lost-response, reconnect and unlimited drawing-usage fixtures passed.
[CAD adapter 39020871014](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39020871014)
and [PostgreSQL concurrency 39020871013](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39020871013)
also passed on that exact head. These are CI results, not a new local browser run.

[Pages 39024797530](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39024797530)
successfully published the merge before activation. The public
[Bob app](https://emeliehagander.github.io/Bob-the-builder/) serves
`assets/index-BAgCVTIM.js`, SHA-256
`7151f9d114b43492aa905a73f01ce25877a839b827abef5126c6fdf7123e9872`.
The downloaded asset contains the Stop/cancellation and Reconnect flows and the
correct Supabase project URL. This is asset/publication readback; ordinary member
use of the controls remains part of owner acceptance.

Only then was `20261017102000_bob_continuation_catalog.sql` applied, registered as
**`20261017102621 / bob_continuation_catalog`**. Its read-back ledger SQL exactly
matches the source. Exactly five active definitions changed:

| Definition | New version |
|---|---|
| `agent-contract.ask-bob` | 3 |
| `bob.contract` | 4 |
| `bob.method` | 3 |
| `bob.note.commentary` | 2 |
| `bob.note.review-work` | 2 |

Each text/variable/metadata patch matches the publication exactly. No catalog head
was added or removed: 291 Bob definitions and 11 other-app definitions remain.
Every unrelated active version, all model rows and all AI settings are unchanged.
Resolved live manifest `63efc114-9458-4a29-8776-abd41aeec423` confirms
`work_completion_version=2`, `work_allowance_version=1` and unchanged
**GPT-5.4/high**. Its profile/tier are unchanged. All 29 existing durable jobs
remain completed under policy 0; activation did not restart or convert them.

The merge-triggered
[Live Bob release check 39024797531](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39024797531)
passed guest Auth/RLS, actual OpenAI lookup, pixels and versioned knowledge.
Its disposable project `p_92b579eab693466599f27fcbe7aabf04` was removed after
exact identity/type/description, guest ownership, expected fixture contents and
absence-of-output checks; independent project/people/Task/material/media/job
readback is zero. Image bytes/metadata had already been removed by caller APIs.
This guest compatibility smoke does not prove policy-1 owner completion.

**Next acceptance:** reload Bob and use the owner's ordinary new Task/todo-edit
request. Check saved text/status, continued authorized successor work without
another “continue”, and honest final completion/blocker reporting. A technical
release does not establish real-model quality. No additional paid owner probe was
launched. Roll back catalog activation first if needed, retaining compatible
workers until pinned policy-1 jobs drain; never put workers that cannot understand
paused/paged jobs back in service while such jobs exist. [State](bob-delivery-flow.md#state)
owns the remaining action.

<a id="bob-history-replay-release-2026-10-17"></a>
## Recent chat history and construction replay — hosted release 2026-10-17

[PR #262](https://github.com/EmelieHagander/Bob-the-builder/pull/262)
corrects slow drawer loading and the owner's later construction-run failure.
The [conversation owner](ask-bob-conversations.md#recent-transcript-window-and-construction-check-replay--2026-10-17)
owns the browser cache, cursor and replay contracts.

The observed failed policy-1 run stopped at `model:ask-bob:22` with
`continuation_changed` after revising one of its own material sources.
Eight changes had already been saved, including the construction; those records
remain. A historical construction check had combined journalled records with
an unrecorded current-source observation. New execution identities checkpoint
that observation per logical check, while existing identities preserve their
original journal sequence. Fresh caller authorization and independent CAD
render/review source checks remain live. The mismatch guard is retained.

The browser requests the newest five transcript rows, with one look-ahead row
and explicit older-page loading. Its account/project memory preview renders
during fresh revalidation; only the fresh response enables actions. Durable
work polls content-free status rather than the whole transcript every two
seconds. Reset/account boundaries, exact-turn recovery, delivery acknowledgement,
draft and reader position remain part of the browser contract. This is browser
loading; Bob's existing working context and recall are unchanged.

The PR merged as `69f58dbf57c95c496c80784aee0970aaed88360c`. Merge tree `e9634fa89756ff919fc08d8ee05776ac804763e8` is
identical to tested head `7d3f56ef5b453d6aae97b882deeb574c662c20b6`.
Both closures were published and read back before merge:

| Function | Authentication | Exact returned files | Bundle SHA-256 |
|---|---|---|---|
| ask-bob 127, ACTIVE | verify_jwt=true | 96 | `9fc1a419846e0cb0c5cf0894d46d7032bfd64993406a94e6d40f61f8f5980914` |
| bob-worker 95, ACTIVE | Existing internal authentication; verify_jwt=false | 94 | `72a10895373b0ebe727eb133441888126cac304e752be7b6979bba0055ad6c73` |

Every returned file matches the immutable tested source. Uploaded closures have
97 and 96 files respectively. The bundler omits only type-only
`src/data/provenance.ts` in both and `bob-request.ts` in the worker.
Unauthenticated POSTs return 401 for both endpoints.

[Pages 39033864487](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39033864487)
published the merge successfully. The public
[Bob app](https://emeliehagander.github.io/Bob-the-builder/) serves `assets/index-BdRL6RnU.js`,
SHA-256 `d047122fc15e1c030fb843bb7f27dd631eccb7a5bff7e87edc247e51655ec675`.
Downloaded code contains the new paging, loading and retry labels and the
correct Supabase project URL. This is publication/asset readback, not a new
signed-in live browser run.

No database migration or catalog publication was applied in this correction.
The activated completion/allowance policy and GPT-5.4/high remain in place.
No actual owner model/CAD retry was submitted by this release session.

[CI 39032132533](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39032132533)
passed every recorded step on that exact source: full tests, vocabulary, Edge
type checks, production/live-config builds, PWA and connected browser fixtures.
The 320/390/1280 px chat flow passed bounded initial loading, older pages,
preserved drafts/reader position, cached preview with disabled actions during
revalidation, status-only durable polling, settlement and reset. The matching
paging screenshots were directly inspected; their artifact SHA-256 is
`270ddf8fbbaa4e522c0a913698382984411df0063eeac8d650cb45719a6a2381`.
There was no local browser installation or local browser pass.

Focused tests reproduce the historical source-change failure and cover legacy
journal identities, fresh revoked access and fresh CAD rejection. The extended
background/CAD fixture set also passed locally. CI supplies the successful Edge
check; local dependency retrieval was blocked by the environment.

[Live Bob release check 39033864522](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39033864522)
passed actual guest Auth/RLS, OpenAI lookup, image pixels and versioned knowledge.
The ordinary caller removed its fixture image bytes and metadata. The disposable
project `p_132c138531954bec955cfb31b2ddfd9d` remains: its guarded administrative cleanup failed in
the connector approval flow with `Invalid or expired requestState`. Subsequent
readback confirms the same one guest creator, one expected Task and one expected
material; media, jobs, private threads and output records are absent. Identity,
description, type, nonce and expected contents were verified before the cleanup
request. No ordinary caller DELETE grant exists for projects, so no alternate
client deletion was attempted. This cleanup remains open; it does not require
another model probe or another runtime/catalog publication.

Keep version-aware replay code available until flagged in-flight executions
drain; reverting to the older sequence during one of those executions changes
its journal positions. This release does not require a catalog rollback.

Direct code and documentation review followed Vera's rendered-state and
Archie's owner/State guidance; this was a manual review, not an independent
agent review.

**Next acceptance:** reload the app, reopen the existing bed conversation,
and continue from the saved construction with the ordinary owner account.
Check initial load, older-message access and continued authorized work through
the next construction/CAD boundary. The earlier unnecessary prerequisite stop
remains a semantic acceptance concern: this technical fix does not establish
that Bob will finish without another “continue”. Task/todo text/status quality,
the drawing against the original mockup and full-chain cost also remain in
[State](bob-delivery-flow.md#state).

## Bob visible status and loading — 2026-10-17

[PR #263](https://github.com/EmelieHagander/Bob-the-builder/pull/263) keeps
automatic work status above the composer while older messages scroll. Activity,
confirmed save count and the server's last activity time remain visible beside
Stop/Reconnect. A failed status read reports the connection problem. Initial
conversation loading, including member lookup, has a 20-second deadline; retry
preserves the draft and fences late completion. Older-page reads are bounded too.
The [conversation owner](ask-bob-conversations.md#visible-work-status-and-bounded-loading)
owns these semantics.

Tested source `6b857b308796bb174b42151207bb92d658791e58`, tree
`40cda3899489b4fba8c3a53b753fbb5abcaf2e71`, merged as
`5a7d74691e82e94da1ee34b834ac2c43d2a715c6` with that exact tree.
[CI 39039043664](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39039043664)
passed every recorded step: full tests, vocabulary, Edge checks, production/live
builds, PWA and all connected browser flows. The chat flow passes slow member
lookup, timeout/late completion/retry, actual older-history scrolling, status-only
polling, connection recovery, preserved reading position/draft, completion, Stop
and reset at 320/390/1280 px. All three status screenshots and the 320 px timeout
image were directly inspected; artifact SHA-256
`f5459ac81977c67715ef0f85fb818a0b8333bbf1359f98af7d08c574a43c47c3`.
The older-reading fixture opens enough history to exceed the follow-at-end
threshold and waits for pagination anchoring before testing updates. There was
no local browser pass. The production build, vocabulary/PWA checks and 18 focused
history/transcript/deadline tests also pass locally.

[Pages 39040416910](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39040416910)
published the merge. Public HTML/JavaScript/CSS were read back from the
[Bob app](https://emeliehagander.github.io/Bob-the-builder/):
`assets/index-BJeglht3.js`, SHA-256
`0a66004d286c94e34bf91138bfa4a5d960a1adf2ec3cdb28aa71eeb32bce4082`;
CSS `assets/index-DTtMn9DB.css`, SHA-256
`be057f8490ac58fd6f2fdd85f785754bb3e0b89e52122d507635c1ba96023f50`.
The bundle contains the new status/loading labels, older-message action and
correct Supabase project URL; CSS contains the persistent status layout. This
is public asset verification, not the owner's actual phone acceptance.

This correction publishes no Edge function, database migration, AI definition or
model setting and submits no owner/model request. The preceding continuation
policy and GPT-5.4/high selection are retained. Read-only inspection found both
ordinary owner tests technically completed, with saved replies. The construction
test still delivered no new CAD: its reply reports 25 instances against the
24-instance annotation boundary, followed by a separate exact-request
`construction_not_ready` notice. The request remains `needs_data`. That later
notice also exposes internal recovery instructions; language and receipt-bound
status quality remain acceptance concerns. Creating a future Task does not by
itself complete the delegated CAD work. Keep those open actions in
[State](bob-delivery-flow.md#state); this UI release does not close them.


## Paged CAD annotations — 2026-10-17

**Hosted release.** [PR #264](https://github.com/EmelieHagander/Bob-the-builder/pull/264), tested head `46ad2013379bff9ad7f64cfada26126311e63aa3`, merged as `f686cd22c08d9892ff7fcb18dd83b8f2778315d9` with the identical tested tree `121d57e80663ef9bb80a15fa1fd16e1496e0d82f`. The separate 24-instance annotation stop is removed. The unchanged recipe envelope supports up to 512 placed instances; geometry, parameter-node, collision, time, byte, source and receipt checks still apply.

Each requested view remains one SVG of the complete exact construction/revision, presented as numbered sheets of at most 32 callouts. Shared kernel paths avoid duplicating geometry per sheet. Instance IDs, stable global P-numbers, blank dimensions and overall bounds are retained. Each sheet is separately rasterized at the existing 1024-pixel preview resolution. Transport requires every deterministic sheet key and its hash binding to the complete SVG; independent review and its save commitment receive every sheet. The saved construction is never divided or redesigned merely to fit annotation layout.

**Verification.** Full CI [39045621607](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39045621607) passed 1,386 tests, Edge checks, production builds and all browser flows. CAD adapter [39045621596](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39045621596) passed 21 Python tests against the real kernel/annotation path and 44 TypeScript tests. CAD lineage concurrency [39045621565](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39045621565) passed. Local checks also covered the production build, 24/25, 32/33, 128 and 512 annotations, coincident projection labels, no duplicated SVG geometry, missing final parts, missing/extra review sheets and incorrect source hashes. The checked-construction regression carries 128 instances unchanged into CAD and all eight requested-view sheets into independent review. Local Edge checking hit an existing esm.sh connection refusal; the CI Edge gate passed.

Synthetic kernel renderings at 25 and 128 parts were inspected visually, including all four 128-part sheets. They retain the full geometry, readable P1–P128 labels, exact dimensions and source revision on each sheet. Artifact `12106050381` from the tested head, `cad-annotation-pages`, SHA-256 `81cc30a2324ce60eb1a11f0c85444bd588aa7bec2077fc0c8fe87b51759b3fc0`, was downloaded and verified before inspection.

**Deployment/readback.** Modal deployment [39047326148](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39047326148), job `117438580133`, passed real geometry, source-bound SVG/PNG hashes, wireframe and bearer authorization checks. Its live 128-part construction returned four full-resolution numbered sheets in 7.49 seconds; the initial cold authenticated fixture took 14.83 seconds. Matching web publication [39047326191](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39047326191) passed. No frontend source changed in this release.

Supabase `yuobtgoidmmmwfqenkau` / fox and mouse: `ask-bob` **128 ACTIVE**, `verify_jwt=true`, bundle `fbf8cf8dd5b0f98e8db73067a2efd9deeb340b5cd956e6e968d6ccb3302fbfa2`; `bob-worker` **96 ACTIVE**, `verify_jwt=false` with its existing own authentication, bundle `f31e94fb23adac5c0beb206e5e6257927d52255bbe2419be05b71a27d9aa0450`. All returned source files matched the tested head byte for byte: 96 and 94 files respectively. Only the same pre-existing type-only modules were omitted by the bundler (`src/data/provenance.ts`; additionally `bob-request.ts` in the worker). Both endpoints returned **401** to unauthenticated POSTs. The old deployments differed from the new source in exactly the three intended CAD modules.

Only after both Edge readbacks, source `20261017152959_cad_annotation_pages_catalog.sql` was applied as `cad_annotation_pages_catalog`, registered version **20261017170002**. Registered SQL matched the source byte for byte, SHA-256 `602421bb14e0f30a0579fb9af28e7a656c1ff7487a7bd505360bc41b68271037`. Filename and installed version differ; compare name/content, never rerun by timestamp. Exactly four of 290 active definitions advanced once:

| Definition | Version |
|---|---:|
| `bob.tools` | 12 |
| `tools.design_project_cad` | 12 |
| `tools.plan_cad_pieces` | 4 |
| `feedback.cad-assistant.next-action.c0e108a49e51` | 2 |

The two matching CAD manuals in `bob.tool_catalog` changed; executable schemas stayed unchanged. Models, settings, reasoning, execution profiles and every other definition retained their prior identity/hash. The agent contract remains the same version/identity, with `work_completion_version=2` and `work_allowance_version=1`; GPT-5.4/high is retained. Prior manifest `63efc114-9458-4a29-8776-abd41aeec423` returned all 290 original version identities/hashes unchanged. New manifest: `1eb0889f-6eb3-4983-8a13-a1e13d1e56ba`. No earlier migration was reapplied.

**Open acceptance.** These technical/synthetic checks do not prove the owner's actual drawing delivery. Request `4d7de67b-ed9b-4249-9873-a5c776207824` remains `needs_data`, pinned to construction revision **3**, while the current checkpoint is **4**. A safe source-amendment/recovery path for the existing request still needs investigation/correction before that request can continue: the adapter rejects substituting a different explicit revision, and same-scope pending-request reuse can return the older pin. Increasing annotation capacity does not waive that boundary. No owner model turn was submitted and no project construction was edited for this release. The ordinary owner Bob test must verify current-source use, actual saved receipt/readback, original requirements/reference comparison and understandable delivery status. [State](bob-delivery-flow.md#state) owns the next action.


<a id="cad-source-renewal--2026-10-17"></a>
## CAD source renewal — 2026-10-17

**Status: deployed and activated; ordinary owner/model/CAD acceptance pending.**
The exact owner turn `d94d90b6-6675-40b4-b754-e2fc8e043608` attempted the existing
request `4d7de67b-ed9b-4249-9873-a5c776207824` with construction revision 4,
while the saved request pinned revision 3. Its later role write saved revision 5.
The uncheckpointed `read_construction_changes` for revision 4 then returned
`superseded` during replay, changing the input of `model:ask-bob:4` and stopping
job `e844d4e0-a017-4480-9689-474f8f1be160` with `continuation_changed` at
17:21:08 UTC. No CAD render or review was dispatched. The following automatic
attempt failed as `background_failed`; its generic log does not establish the
underlying exception. No owner construction/request was edited during diagnosis.

The [CAD owner](cad-adapter.md#explicit-source-renewal--2026-10-17) describes the
versioned repair and activation order. Focused tests cover explicit same-request
renewal, preserved requirements, discarded old candidates/retries, stale/missing
source and authority rejection, historical replay, actual SQL role revision and
idempotent reconstruction. Catalog publication advances exactly two definitions;
models, reasoning, work policy and historical manifests stay unchanged.
Release evidence:

- Tested head `f462ad37dbdd6bb1656056775a53fb943c7d27c3`, tree
  `8d131bf0a7458c7e41938094f2124b3856642341`.
  [PR #265](https://github.com/EmelieHagander/Bob-the-builder/pull/265) merged as
  `08366db79a603218553c547ab770679906cd7048` with that exact tree.
  [CI 39057511898](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39057511898)
  passed all 1,394 tests, Edge checks, production build and browser checks.
  CAD adapter `39057511951` and lineage concurrency `39057511912` also passed.
- Both Edge functions were published before activation. All 98 transitive source
  files matched the tested head before upload; installed `ask-bob` **129**
  (`verify_jwt=true`) returned 96 exact source files, and `bob-worker` **97**
  (`verify_jwt=false`, own authentication) returned 94. Only type-only imports
  were absent from bundle readback. Their bundle SHA-256 values are
  `93dff79d197ed8a75e9041a6071032f58938fea54f1ff06765c3a9194d987fba`
  and `ba13bfb1758c5ab5bd0bdd13f10399353e6e0de1d6696b32b872dd7a7a412c55`.
  Unauthenticated POSTs returned 401 at both endpoints.
- [Pages 39066130466](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39066130466)
  published the exact merge successfully. The application and both JS/CSS assets
  returned HTTP 200; frontend bytes retain the prior status/loading release.
  Post-merge CAD adapter `39066130332` and
  [Live Bob release check 39066130496](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39066130496)
  passed. The latter exercised actual Auth, member-scoped PostgREST, OpenAI tool
  use/source disclosure, non-member 403, retired endpoint 410, and the separate
  guest image/knowledge fixture; it did not generate the owner's bed drawing.
- Only `cad_source_renewal_catalog` was applied, registered as
  **`20261017201919`**. Its single stored statement exactly matches source
  `20261017180143_cad_source_renewal_catalog.sql`, SHA-256
  `8b4ad2fbeba280fe773d966d6c650c728b5984b2b7d0cce1ae81a33aea14b4f2`.
  Do not reapply by comparing filename timestamps.
- Readback changed exactly **two of 290** active definition IDs/payload hashes:
  `bob.tools` 12→13 and `tools.design_project_cad` 12→13, both publication
  `cad-source-renewal-v1`. All other active definitions remained identical.
  Resolved manifest `9c169b50-54c4-4605-be35-e90a8a3a9332` contains 290 definitions.
  Both prior manifests (`1eb0889f-6eb3-4983-8a13-a1e13d1e56ba`,
  `63efc114-9458-4a29-8776-abd41aeec423`) retained their payload/content hashes.
- Model/settings hashes stayed `3017d0f9b423562788cc987d6ceb1bac` /
  `d71fb90595904ce11791b01aa559d8b8`; the resolved Bob profile remains
  **GPT-5.4/high**. Contract version 3 remains `work_completion_version=2`,
  `work_allowance_version=1`, with its existing definition ID unchanged.

The real-schema fixture proves current-source validation → reviewed candidate →
atomic CAD save → exact readback on the same request with preserved requirements.
Its renderer/reviewer are synthetic. The ordinary owner/model/CAD drawing test
remains required: use the pending bed request and explicitly check/adopt its
current construction revision (last observed 5), then verify independent review,
saved drawing and reload. No owner construction/request was manually changed or
new owner model turn submitted by this release. At this checkpoint the older
automatic failure's underlying exception was unretained; the later continuation
investigation and SQL evidence are recorded in the release below.

## Atomic drawing continuation — 2026-10-18

**Status: installed and read back; ordinary owner/model/CAD acceptance pending.**

[PR #270](https://github.com/EmelieHagander/Bob-the-builder/pull/270), tested source
`9746d602e48ada32666bbb4c01efeb7890fbadc8`, merged as
`410bee2912aa14b4166e98cfda1393ba808b332b`.
The reproduced fault is a new message loading the request and changing its
accounting period, then failing before the origin/authority save. An automatic
job keeps the older origin and receives `drawing_budget_period_closed` before
rendering. Hosted PostgreSQL errors correlated with the drawing jobs on October
17 at 17:21:09.962Z and 21:36:34.965Z and October 18 at 11:49:51.333Z. The
rollback-only pre-install probe failed with `probe_read_mutated_state`, directly
reproducing the read-side mutation without retaining fixture data.

The fix and exact retirement boundary live in the
[database contract](../db/README.md#atomic-drawing-continuation--2026-10-18).
Regression coverage exercises interruption on both sides of save, failed-save
rollback, exact replay, old paid receipts, inconsistent-state quarantine and
explicit legacy rejection. Distinct catalog pins and exact sealed authorities
are checked for each owner message; ambiguous and wrong-request jobs fail.
The real unchanged cost-stop fingerprint now continues only after a successful
checkpoint save, while unchanged quality evidence suppresses another paid
attempt. Temporarily removing that checkpoint made its new regression fail.

**Source verification.** [CI 39128288013](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39128288013)
passed **1,499 / 1,499 tests**, Edge checks, production builds, PWA and every
browser check on the tested source. [PostgreSQL concurrency 39128288048](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39128288048)
passed **85** races, including save/replay/cancel ordering, and
[CAD adapter 39128287976](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39128287976)
passed. UI/performance PR #269 landed during CI as
`641193b6b28ba94f1192bc177fcb6586d307e131`, after its separate
[CI 39127570522](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39127570522)
passed. Its 25 changed paths overlap neither this correction nor either Edge
dependency closure. The conflict-free merged tree is
`49f48e1f061c620689e2e40639eebb0f7400f081`; its SQL and runtime closures retain
the tested drawing source exactly.

The merged source also passed [CAD adapter 39135320455](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39135320455)
and [web publication 39135320490](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39135320490).
[Live Bob 39135320507](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39135320507)
passed actual Auth/RLS/provider checks with the shared guest fixture, including
image pixels and versioned knowledge. Fixture image bytes and metadata were
removed through ordinary caller commands. This generic guest regression does
not establish private owner conversation or bunk-bed drawing acceptance.

**Hosted installation.** Supabase `yuobtgoidmmmwfqenkau` / fox and mouse records
`20261018141538 / drawing_atomic_continuation` for source migration
`20261018121638_drawing_atomic_continuation.sql` (SHA-256
`bedc3ecb4d1cc3fc58c87a336267ca0db6f0d62568c22f231678c169c602575a`).
The first connector attempt returned `invalid_request_state`; ledger and body
readback proved it had not run before the successful retry. Fresh checks before
installation confirmed the expected installed SQL, Edge versions and no active
Bob jobs. The installed Supabase 2.117.0 CLI aborted with exit 134 before
`migration new`; the source filename uses actual observed UTC.

| Installed function | Exact body MD5 |
| --- | --- |
| `bob.bob_drawing_request` | `e8656ba61eff4801ecc78bde5741da70` |
| `bob.bob_drawing_budget` | `27bf5c7ae2352909be24c9a20d411a8d` |
| `bob_private.queue_drawing_events` | `dc420cab123bc2fc5df250308ec8c430` |

Readback confirms fixed empty search paths, security-definer status and the
existing service-only/private grants. All five legacy request delegates and the
old read-side period helper are absent. The same rollback-only hosted probe now
passes read purity, rejected premature reservation, rejected wrong scope,
atomic save, exact replay and a late original-period receipt settled once.
All fixture writes rolled back; no probe project remains.

The protected request rows excluding `reason`, packets, current accounting and
Artifacts retain their complete pre-install row-set digests. The existing bed
request remains revision 9 / `retrieval_failed` with its original instruction,
period, packet and source pin. Its proven contradiction is explicitly marked
`drawing_continuation_mismatch`; installation chose no replacement instruction,
credentials or construction version. No Bob jobs were active after verification.

| Edge function | Installed state | Bundle SHA-256 |
| --- | --- | --- |
| `ask-bob` | 132 ACTIVE, JWT verification enabled | `ac20893b8e5df63ed384693d1d0e6ce8eb2a4b99d7d89c3fdd38d121ddb63d92` |
| `bob-worker` | 100 ACTIVE, existing capability authentication / JWT verification disabled | `43f9cbd87ffb6c59d12284fbd00f12a2bcecd2470e82f8a3f15365c31a46f74c` |

All **103 / 101** returned source files match the verified upload packages byte
for byte. The bundler omits only the pre-existing type-only modules
`src/data/provenance.ts` and, in the worker, `bob-request.ts`. Both endpoints
returned **401** to unauthenticated POSTs. No AI catalog, prompt or model
configuration was published by this correction.

Documentation placement was reviewed manually using Archie's instructions.
The hosted probe is privileged SQL evidence, not an ordinary-member drawing
delivery. Ordinary owner/model/CAD acceptance remains in
[State](bob-delivery-flow.md#state): continue the same bed request, check and
explicitly adopt its current construction revision (last observed 5), then
verify independent review, a saved drawing receipt and reload. Its retained
source revision 3 was not silently replaced during installation.
## Memory pointer and repeated notice correction — 2026-10-18

**Corrected and activated through [PR #273](https://github.com/EmelieHagander/Bob-the-builder/pull/273). Ordinary owner CAD delivery remains unverified.**
The 17:37 UTC owner attempt failed before project/CAD work with
`context_unavailable`. Its two successful `context-summary` provider responses
both included sequence 49 (the current request) in the older-history pointer
index. Both failed the `pointers` validator. This was not a drawing renderer
failure or an AI spending cap.

The repeated Swedish drawing-error cards in the reported screenshot were distinct
persisted automatic failures, delivered at 2026-10-17 21:36 UTC and 2026-10-18
11:49 UTC. The latest owner attempt added no assistant answer. The drawing request
remained quarantined with `drawing_continuation_mismatch`; its packet revision 9
and source geometry were unchanged. That prior quarantine prevented another
automatic child from being queued after the new memory failure.

The correction binds memory pointers to exact supplied older sources through the
pinned catalog schema and separates the pending request's relevance text. It keeps
strict validation, original messages, prior manifests and paid replay. A separate
database correction suppresses only consecutive identical terminal drawing
notices for the same mandate, retaining each operational failure. It does not
delete old chat or relax construction/source validation. Behavior belongs to
[conversations](ask-bob-conversations.md#small-context-exact-sources).


Source `74fac958828b2b0a8ce4fd7aec0f7bad3efe7fe4` passed
[CI 39151343872](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39151343872):
**1,532/1,532 tests**, Edge types, production build, vocabulary, PWA and all
browser flows. The [concurrency run 39151343864](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39151343864)
passed **85 PostgreSQL races**. The 37 distinct focused local cases cover the
incident-shaped fold, exact catalog binding, existing paid replay, immutable
catalog history and failure delivery boundaries. Merge
`3be5d6d40e9c029e90e458986f764b3aaa390f6f` has the exact tested tree
`0de120dce0ea2113f345d1a6a4b69179f02b824a`.

Both complete source closures were deployed before catalog activation, with
unchanged authentication:

| Function | Active version | Bundle SHA-256 |
| --- | --- | --- |
| `ask-bob` | 134; JWT required | `30c3066238d0ae78ae40bfa6cdbce254c4772a5366eefecbf198ce039e088010` |
| `bob-worker` | 102; existing private capability authentication | `e0dc42884c83bea1c84d17e2daf99498301e7eedf218465c5d7f8b79da1d3a52` |

Readback matched every executable source byte across 102/100 returned files.
The bundled type-only `cad-intake.ts` is empty after erasure; `provenance.ts`
and the worker's type-only `bob-request.ts` are omitted as expected. There are
no unexplained source differences.

| Source migration | Hosted version / name | Statement SHA-256 |
| --- | --- | --- |
| `20261018174324_bob_memory_pointer_scope.sql` | `20261018181618 / bob_memory_pointer_scope` | `90b8a6ac982045becfcfb5937064234a7be54def26f427813bfe071f465beb3a` |
| `20261018174325_bob_drawing_failure_notice.sql` | `20261018181623 / bob_drawing_failure_notice` | `b6fe0e2f6259dfbb1457ea4d76f713f6400276d260ca293f41920836911bad68` |

Hosted readback confirms exactly two changed active catalog definitions among
285, with all model/settings hashes unchanged. The live schema binds the incident
allowlist `[38,41,42,43,44]` and excludes current message 49. The installed notice
function body MD5 is `3c02514c074afa17cbbdb3d7fa4cfc29`; its private grant, security
definer and empty search path are preserved.

The same rollback-only hosted probe produced two consecutive notices before the
fix and one afterward. All three synthetic failure events remained, and an
intervening owner message received a fresh notice. Zero probe projects remained.
Before/after hashes confirm the actual owner's request headers, private packets,
budgets and entire transcript are unchanged. No owner message or CAD run was
submitted by this investigation. Existing terminal failures may be explicitly
retried as a new job with the active catalog; queued/running/paused jobs retain
their pinned manifest. A new verified saved drawing and private long-conversation
acceptance still require the owner's ordinary continuation.

Post-merge [live verification 39153429837](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39153429837)
passed with real Auth, member-scoped PostgREST, OpenAI calls, source disclosure,
image bytes and versioned knowledge. It also verified nonmember rejection,
the retired endpoint, guest history isolation and read-only natural-language
advice. [Pages deployment 39153429844](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39153429844)
succeeded. These probes do not establish the actual owner's private-memory or
saved-drawing acceptance. After the ordinary caller removed the test image,
the exact disposable release project was removed under identity, sole guest
membership, no-thread and no-media guards. Readback found zero matching project,
member, task, material or media rows; no real project was selected for cleanup.

## Lookup observation replay correction — 2026-10-18

**Prepared correction; required CI and deployment pending.** At 18:58:42 UTC,
the owner's mockup inspection stopped with `continuation_changed` at
`model:context-summary:3`, immediately after opening the selected image and
waiting for the context compactor. The AI response completed successfully. This
attempt made no project writes; its original owner request still required
confirmation before changes to the selected design.

The lookup RPC result was checkpointed, but its surrounding `retrievedAt` was
recreated on every worker. Ordinary model fingerprints ignore this metadata;
the compactor nests tool-output JSON inside its source JSON, where the new time
changed the exact waiting-call fingerprint. A focused regression using the
actual lookup, journal and continuation adapter reproduced the same failure
across an accepted AI wait with unchanged records and a moved worker clock.

New execution identities now record a per-read observation time independently
of the existing RPC checkpoint, preserving native tool bytes, source receipts,+nested operation order and strict replay checks. The production wiring covers
main, grounding, plan and CAD model lookups. Physical-source validation keeps its
existing gate sequence and adds no nested observation checkpoints. Failed/invalid reads retain
their original observation too. Fresh reads get fresh times; altered read scope
or unavailable observation checkpoints fail explicitly. In-flight identities
retain their existing sequence; terminal owner retries create new executions.
No historic transcript, construction, selected design, drawing packet or budget
was edited to recover the failed attempt. Behavior is owned by
[conversation context](ask-bob-conversations.md#retrieval-and-colleague-handoffs).
