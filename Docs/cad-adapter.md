# Bob CAD adapter — build123d foundation

**Status:** merged to main 2026-09-22; engine seam verified, not hosted as an app CAD service. This is the first Slice B geometry foundation. Main commit `a9861000e011aba5a511455dea354e5c9d88a989` contains the adapter and worker. It does not complete the drawing/cut/pick/Shopping use case.

Bob never sends Python, SQL, URLs or arbitrary CAD code to the geometry engine. Bob produces a bounded, versioned construction request. The adapter validates it and a separate stateless worker translates it to build123d/Open Cascade.

## First contract

Contract v1 uses canonical millimetres and supports only:
- reusable box definitions;
- reusable tube definitions;
- placed/rotated instances;
- front, right, top and isometric projections.

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

No Bob tool is registered yet. The next integration should wrap this worker in an authenticated, quota-bounded container/job transport and call it through `cad-adapter.ts`. Do not embed Open Cascade in the Edge function and do not let the model choose a host.

## Verification

`cad-worker/test_worker.py` imports the real pinned build123d package and must generate STEP plus four SVG views. `tests/cad-adapter.test.ts` checks the Bob-side contract and failure semantics.

The dedicated `CAD adapter` workflow installs Python 3.13 and build123d 0.13.0 on GitHub Actions and runs both layers. PR #96 and the post-merge main run both passed: the real engine generated STEP/SVG and the TypeScript contract tests passed. This proves the adapter/engine seam, not hosted CAD availability in Bob, model behavior, structural engineering or BOM/Shopping completion.

## Next

The September 24 product mandate makes this integration a delivery gap for
[UC-001 and UC-005](user-stories.md#product-mandate--2026-09-24), not an optional
alternative to the legacy storage-box tool. The existing generic engine must
become reachable through Bob, persist under Artifact identity, and return views
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
