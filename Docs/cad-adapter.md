# Bob CAD adapter — build123d foundation

**Status:** engine foundation merged 2026-09-22. The September 24 CAD-assistant integration is tracked in [PR #123](https://github.com/EmelieHagander/Bob-the-builder/pull/123), whose release record owns migration, Edge and Pages status; the hosted Modal service was subsequently verified in PR #126/#127 (deployment details below). This is the first Slice B geometry foundation. Main commit `a9861000e011aba5a511455dea354e5c9d88a989` contains the adapter and worker. It does not complete the drawing/cut/pick/Shopping use case.

Bob never sends Python, SQL, URLs or arbitrary CAD code to the geometry engine. Bob produces a bounded, versioned construction request. The adapter validates it and a separate stateless worker translates it to build123d/Open Cascade.

## First contract

Contract v1 uses canonical millimetres. The September 25 extension adds cylinder blanks, local subtractive cuts and explicit geometry checks while retaining old box/tube recipes:
- reusable box definitions;
- reusable tube definitions;
- solid cylinders and up to 16 local box/cylinder cuts per definition (256 total), for holes and notches;
- placed/rotated instances;
- front, right, top and isometric projections.

The worker rejects cuts that miss the part, erase it or split it into disconnected solids. Each reusable definition is constructed once. Blank dimensions remain the original definition dimensions, not a smaller post-cut bounding box.

Every new manifest reports exact solid overlap volumes after a bounding-box broad phase. At most 256 candidate pairs receive the exact check; skipped pairs produce **partial**, never an all-clear. Optional `clearances` request up to 16 actual minimum surface distances for named instance pairs. Optional `motions` request up to 16 conservative envelopes for straight translations of up to eight moving parts against up to 32 named obstacles. A clear envelope establishes no overlap for that specified translation; a possible obstruction needs inspection. Rotating hinges, deformation, fastener strength and loads are outside these checks. Intentional joint overlaps remain visible for review. Old manifests explicitly show that no check was recorded.

The drawing viewer counts actual instances, shows blank dimensions and cut counts, and exports a CSV cutting list from the exact displayed recipe. The material tool derives quantities from the current saved Artifact revision; [material-planning.md](material-planning.md) owns allowance, compatible stock/reuse and Shopping. A part's opaque `material_ref` is not a pinned product specification. Board/sheet nesting, grain direction and saw-kerf optimization remain distinct work; the list does not claim these were solved.

A bed, shelf or cabinet is therefore content assembled from the same generic definitions and instances, not a new server-side object type.

The construction model remains Bob-owned truth. The CAD engine does not own project authority, measurements, material identity, revision history, stock or Shopping. A definition may contain an opaque material reference, but the worker never dereferences it.

## Engine

The worker pins **build123d 0.13.0**. PyPI identifies the release as Apache-2.0 and compatible with Python 3.11–3.14. build123d is a parametric BREP framework on Open Cascade and documents STEP export plus `project_to_viewport` / `ExportSVG` for 3D-to-2D projections.

The dependency is pinned. An engine upgrade is an explicit adapter-version change, not an automatic latest-version rollout.

## Output

One accepted assembly creates:
- a STEP assembly;
- requested SVG views from the same build123d assembly;
- a manifest containing exact engine/version, assembly bounding box, per-instance bounding boxes and SHA-256 export hashes.

The TypeScript adapter validates the request again at the Bob boundary and validates the returned engine identity and export manifest. Failure, timeout or malformed output is `unavailable`; it never becomes an empty successful drawing.

## Security and limits

The request has finite counts and numeric bounds. It contains no file paths, expressions, code or network destinations. Output filenames are chosen by the worker. The first worker is deliberately stateless.

The integration registers `design_project_cad` and `save_cad_design`. The first returns a checked candidate; the second saves that exact candidate through the claimed-turn receipt ledger. `cad-transport.ts` uses a deployment-owned HTTPS endpoint and bearer token; neither comes from the model. Do not embed Open Cascade in the Edge function and do not let the model choose a host.

## Verification

`cad-worker/test_worker.py` imports the real pinned build123d package and must generate STEP plus four SVG views. `tests/cad-adapter.test.ts` checks the Bob-side contract and failure semantics.

The dedicated `CAD adapter` workflow installs Python 3.13 and build123d 0.13.0 on GitHub Actions and runs both layers. PR #96 and the post-merge main run both passed: the real engine generated STEP/SVG and the TypeScript contract tests passed. This proves the adapter/engine seam, not hosted CAD availability in Bob, model behavior, structural engineering or BOM/Shopping completion.

## Historical integration sequence (superseded by the integration below)

The September 24 product mandate makes this integration a delivery gap for
[UC-001 and UC-005](user-stories.md#product-mandate--2026-09-24), not an optional
alternative to the legacy storage-box tool. The existing generic engine must
remain reachable through Bob in the deployed environment, persist under Artifact identity, and return views
that the relevant project step can display. A passing engine fixture alone does
not satisfy that outcome. Do not add a `bed_v1` tool to work around the missing
integration.

After this seam passes:
1. pin exact catalog material/part revisions in construction definitions;
2. persist the assembly recipe under the existing Artifact identity;
3. add bounded generic machining operations (holes, then rectangular cuts/pockets);
4. derive stable part IDs and drawing views from that same revision;
5. derive cut/pick/material requirements from it;
6. feed only remaining requirements into Shopping.

Constraints and formulas need a declarative vocabulary. They must never be executable Python expressions.

## CAD assistant integration — 2026-09-24

Bob delegates an intent plus optional Area, component, plan Step and Artifact identities. A separate `cad-designer/cad` standard/high setting uses the shared Responses service. Its short role describes a remote construction designer; there are no bed/drawer object-specific branches.

Its own bounded loop can search current project/physical records, inspect materials, open project images, read an exact saved CAD assembly and render up to four candidates across ten model rounds. September 25 adds a three-round research stage, then a render/repair stage and a final inspection call; exact measurement verification has its own bounded lookups. The designer budget is at most five minutes within the overall turn deadline, with at most 100 seconds per model call. Context starts with the brief and grows through reads. It can fetch wider constraints; object scope is not an artificial data-access blindfold. Bob retains the conversation, project decisions and final save authority.

Images Bob has opened during the current turn are handed over by exact image ref
and reopened through the designer's caller-scoped adapter before its first call.
An unavailable selected reference stops that design attempt explicitly. A text
brief is not a substitute for the selected pixels. Images independently opened
by the designer use the same current-project/measurement grounding as Bob;
visual references do not override newer specifications. Existing image count,
byte and operation limits apply. Image authority/version is rechecked before
each designer call and after delivery. No project-wide automatic image scan or
new image store is introduced. The brief should make coordinate and viewing
directions explicit so that visual left/right is not confused with room axes.

Regression tests establish pixel handoff, fresh facts, unavailable-reference
failure and revocation before a later provider call. They do not establish
real-model fidelity to a particular reference or a finished construction drawing.

A detail selection uses exact instance IDs from a pinned source assembly. Definitions and placements are reused; the database rejects a changed/stale source and the UI flags later source changes. Changing the parent never silently rewrites a saved detail. Arbitrary construction revisions remain possible via a new bounded recipe.

`artifact_cad_revisions` stores recipe, verified export packet, source revision and optional component/plan-Step identity under the existing Artifact revision. Saves remain Concept and pass canonical target/measurement checks. A successful render does not certify structure, joints, site fit or measured truth. SVGs are displayed as image documents, not injected DOM; STEP is downloadable. Project-home previews and reusable work links are owned by [artifacts](artifacts.md#project-home-drawings-and-work-links--september-24-2026); Step links reopen an exact saved revision. Historical views survive a new turn and reload. Canonical archive/restore copies the exact CAD packet to the new revision. Generic Artifact revisions are rejected for CAD identities; only the guarded CAD save can replace their construction.

### Hosting boundary

Build `cad-worker/Dockerfile` and run behind HTTPS with a secret `BOB_CAD_TOKEN` of at least 32 characters. Set matching Edge secrets `BOB_CAD_URL=https://<host>/render` and `BOB_CAD_TOKEN`. The service accepts only authenticated POST `/render`, limits input to 256 KiB, runs geometry in a killable child process for at most 40 seconds and returns at most 6 MiB. It writes only a temporary directory, accepts no paths/code/URLs and logs no recipes or credentials. The transport checks engine/assembly identity, definitions, instance identity, bounds and every export hash. Configure provider resource/rate limits at deployment.

Modal deployment credentials and the deployed service are verified (September 24). PR #126/#127 deployed `https://emeliehagander--bob-cad-render.modal.run/render`; workflow [35988647873](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/35988647873) passed real STEP/four-SVG, dimension/hash and authorization checks. First authenticated request took 14.47 seconds. The owner reports both Edge secrets saved; named-member Bob/CAD save acceptance is still a separate in-progress check. If either Edge secret is missing, Bob gets `cad_engine unavailable` before any designer call; this is infrastructure, not a request for another design approval.

### On-demand Modal deployment

`cad-worker/modal_app.py` hosts the existing HTTP server as the `bob-cad` Modal app in the `main` Modal environment. It uses Python 3.13 and the pinned worker requirements, one CPU and 2 GiB memory per container, zero minimum/buffer containers and a 60-second idle window. It has no scheduled calls, GPU, persistent volume, application spend cap or global container-count cap. The existing request/geometry bounds remain in place. The worker subprocess runs as UID 10001 with only its runtime bearer secret; GitHub's Modal account credentials are never injected into it.

The `Deploy CAD to Modal` workflow uses GitHub environment `github-pages`. Setup:

For the existing installation, GitHub secret `BOB_CAD_TOKE` is also accepted as a fallback. The workflow maps it to runtime variable `BOB_CAD_TOKEN` in all three credential-consuming steps. If both names exist, `BOB_CAD_TOKEN` takes precedence. Supabase continues to use the canonical `BOB_CAD_TOKEN` name; this alias does not change or rotate the value.

1. Keep the verified `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` there. Add a distinct `BOB_CAD_TOKEN`: a password-manager-generated random value of 64 ASCII letters/digits (minimum 32, no whitespace). Keep the value in the password manager for the next step; never put it in chat, source or logs.
2. Run the workflow from main, or re-run its job after adding a missing secret. It checks secrets, runs the real engine tests, deploys the Modal app, then tests the live HTTPS endpoint using synthetic geometry. Runtime secret injection uses Modal's secret mechanism; no separate manual Modal secret is required.
3. Read `BOB_CAD_URL` from the successful workflow summary. In the existing Supabase project's **Edge Functions → Secrets**, set this URL (including `/render`) and the same `BOB_CAD_TOKEN`. Keep both out of the frontend/Vite environment. New Edge invocations read these secrets without a function redeploy.
4. Verify a named member's full Bob drawing-and-save journey. Deployment smoke tests establish hosted geometry and bearer authorization, not AI design quality, user permissions or project-save acceptance.

The live smoke test checks STEP plus all four SVG views, engine identity, dimensions, file hashes, missing/wrong bearer rejection and malformed recipe rejection. Its first authenticated render must complete within the existing 45-second Edge transport deadline; a slower cold start is a deployment failure, not an assumed success. The workflow outputs only the nonsecret endpoint and synthetic-test results. If rendering fails after deploy, investigate before connecting Bob; a failed smoke test does not automatically roll back the deployed app. Runtime-key rotation requires updating the GitHub secret, redeploying, and updating the matching Edge secret.

### Verification boundaries

Automated tests cover the assistant loop, source-part reuse, failed-repair invalidation, stale measurements, revoked access, canonical saves/retries, other-project denial, image recovery and navigable large records. CAD-worker CI runs the real pinned build123d engine. The foundations browser scenario includes saved CAD views, part dimensions, reload, project-Step navigation and protection from geometry loss through the generic editor at mobile/desktop widths. Controlled model responses establish orchestration, not real-model design quality. Whole-bed, drawer-detail and changed-parent named-member live acceptance remain separate gates; the worker is now hosted.

### Drawing prerequisites and completion — September 25

Before invoking the designer, the server reads the exact scoped selected target.
An absent Area target may inherit the Project target; an explicitly cleared Area
target cannot. No target returns an actionable prerequisite to Bob before spending
a design attempt. Bob can reuse/save the justified solution, select its revision,
and resume the drawing in the same delegated job. Target-read failure remains a
retrieval failure, not a missing design choice. Candidates must cite that exact
server-read target revision; the save rechecks canonical versions.

Prerequisite tools and an exact candidate's save tool become offered on the next
model round when their runtime conditions hold. Catalog activation, registration,
caller authority, budgets and the offered-tool fence remain mandatory. The parent
loop makes at most one completion review when a plan/CAD attempt is left unfinished.
It compares the original request with real results; it creates no new user request
or automatic approval. Provider retry bounds are owned by
[conversation recovery](ask-bob-conversations.md#durable-background-turns).
