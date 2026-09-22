# CAD adapter — generic construction geometry

**Status: implementation branch `feat/cad-adapter`; not merged, deployed or connected to production Bob.**
This is slice B's geometry adapter foundation for `BOB-UC-MATERIAL-ASSEMBLY-01`. It consumes resolved construction geometry; it does not replace the material/part catalog, Artifact versioning, Building context, material planning or Shopping.

## Decision

Bob owns a small, versioned construction contract. A separate stateless worker translates that contract to build123d/OpenCascade. The model never writes or executes arbitrary Python, SQL, OpenCascade commands or file paths.

The first engine is **build123d 0.13.0**, pinned in `cad-worker/requirements.txt`. The adapter boundary is ours so the CAD engine or hosting can be replaced later without changing persisted construction semantics.

## Construction contract v1

All working geometry is millimetres. The root has exactly:

- `version: 1`;
- stable `assembly_id`;
- `units: "mm"`;
- `definitions`;
- `instances`;
- requested `views`.

V1 supports only reusable **geometric primitives**, not construction-object names:

- `box`: X/Y/Z size; covers rectangular profiles, boards and sheet parts after the domain layer has resolved dimensions;
- `tube`: outside diameter, wall thickness and length.

Definitions may pin an exact material-catalog part id/revision. That pin is lineage only: the CAD worker does not read Supabase, infer materials or modify the catalog.

Instances reference one definition and contain only world-space centre position and XYZ rotation. Multiple instances may reuse one definition. Stable instance/definition IDs are returned in the manifest and are the future bridge to drawing highlighting, part lists and BOM records.

Views are currently `front`, `right`, `top` and `isometric`. The worker derives each viewport from the final assembly bounding box and exports SVG with separate visible/hidden edge layers. It also exports one STEP assembly.

## Security and failure boundary

The worker is not a code-execution service.

- strict allowlist of root/definition/instance fields;
- finite dimensional limits and bounded item counts;
- no expression, script, URL, SQL or arbitrary build123d operation field;
- tube wall must be thinner than radius;
- unknown/unbound geometry never arrives here: the domain layer must resolve it or stop before CAD;
- internal HTTP endpoint requires a dedicated bearer secret; it is not a user/project authorization boundary;
- the Supabase/server adapter must enforce caller/project/Artifact authority before a CAD request and must verify assembly identity in the response;
- request/output sizes and worker timeout are bounded;
- render failures do not mutate project truth.

The worker returns generic errors and does not expose engine traces to Bob/users. It is stateless and uses temporary files for rendering. Production storage of STEP/SVG is deliberately not implemented in this slice; Artifact/media lineage must own that when connected.

## Source layout

- `supabase/functions/_shared/cad-adapter.ts` — TypeScript contract validator plus bounded internal HTTP client.
- `cad-worker/bob_cad_worker.py` — strict contract validation and build123d/OpenCascade translation.
- `cad-worker/http_server.py` — minimal internal stateless `/v1/render` service; bearer-token protected.
- `cad-worker/test_worker.py` — actual-engine STEP/SVG smoke against pinned build123d.
- `tests/cad-adapter.test.ts` — server-side contract/response boundary tests.

## Verification boundary

CI installs the pinned CAD dependency in Python 3.13 and runs the real worker smoke. Passing means the current construction fixture becomes OpenCascade geometry and produces non-empty STEP plus SVG views. TypeScript tests independently prove that arbitrary execution fields/object-specific generator names are rejected and response identity is checked.

This does **not** yet prove:

- production worker hosting or network/auth configuration;
- a persisted generic assembly schema in Supabase;
- Bob autonomously turning free text into a correct construction;
- holes/notches/cuts, arbitrary profiles, curves, constraints or collision semantics;
- automatic cut/pick/Shopping derivation;
- engineering or manufacturing correctness.

Those are later slices. Add operations as generic CAD vocabulary only when there is an acceptance case; do not add `bunk_bed_v1`, `shelf_v1`, etc.

## Next integration

The next database/application step should persist a versioned generic assembly that references exact catalog material/part versions, then send its resolved geometry to this adapter. The same assembly revision must drive drawing views and downstream part/cut/material records. Placement changes should alter instances, not part recipes; dimension constraints may explicitly cause part recalculation in the domain layer before CAD.
