# Drawing inconsistency investigation — September 28, 2026

Baseline: main `75c1aeb` (PR #150). This investigation used a bounded read of the
reported drawing's metadata, its turn's content-free execution events, provider
error logs, and current relevant room measurements. No private conversation,
image, project identity or measurement values are reproduced here.

## Established incident sequence

- The displayed result is an AI-generated instruction image in the media system,
  not a CAD Artifact. Current records already contain wall-specific window/door
  offsets and widths; the inconsistent surrounding room is not explained simply
  by all those facts being absent.
- Between 07:24 and 07:34 UTC the CAD designer made nine successful provider calls
  and four failed calls. Each failed call lasted approximately 100 seconds; the
  corresponding service error is `The signal has been aborted`.
- The CAD tool returned unavailable. The turn recorded zero renders and zero
  independent reviews. Bob then generated an image, opened it, linked it and
  described it as usable drawing material. The delivery event correctly says
  partial, but that did not correct the model's claim to the owner.
- Completed-job checkpoints have been removed as designed. The original CAD
  arguments and the provider's unfinished output are unavailable. We cannot prove
  why the model needed longer, what it was about to draw, or that one particular
  loop defect caused those aborts. Increasing a timeout alone is not established
  as the repair.

## Reproduced application defects and changes

1. The tenth designer call previously received no tools, even with no geometry
   rendered. It can now render or report a blocker, just like earlier calls.
   A candidate rendered on that last call receives independent review without an
   eleventh designer call. Rejected output remains unsavable. No tool is forced.
2. Independent CAD review previously received designer-selected research plus a
   bounded project/measurement page. It now receives explicit project, Area,
   Step and Artifact identities and separate caller-scoped reads of project,
   approved plan (when Step-linked), measurements and physical room/element/
   relationship records. Pagination is bounded to four pages per dataset and
   120 KB overall; missing, failed or truncated coverage is explicit.
3. The image adapter omitted `source_kind` and `plan_step_id`; the actual pixel
   carrier additionally dropped purpose and attachment context. These now reach
   the inspecting model with project binding. A changed attachment or provenance
   invalidates the retained image context. Private storage paths remain excluded.
4. A shared, situational review instruction tells both Bob inspecting a design
   image and the independent CAD reviewer that earlier designs have had quality
   failures. It requires source-based checks of the full room, openings, compass
   and viewing directions, all views, dimension sums, counts and usable heights;
   findings must identify the conflicting source and concrete correction. It
   belongs at review time, not in Bob's permanent persona.
5. Image generation reports illustration provenance, unverified geometry and the
   exact review scope. Its guide explicitly excludes substituting for failed
   CAD. When CAD failed and an illustration was saved, the existing single
   completion note states that the dimensioned drawing remains unfinished. Bob
   still chooses tools and keeps responsibility for the reply.

## Verification and remaining limits

Regression tests exercise last-call rendering and rejection, independently read
room facts omitted by the designer, measurement pagination, denied/truncated
source reads, generated-image provenance and Step context through the provider
serializer, attachment revocation, and failed CAD followed by image generation
through the real Bob tool loop. Existing replay, exact candidate fingerprint,
source-revision, permission and review-schema checks remain in place.

These are controlled fixtures, not a claim of real-model drawing fidelity.
Local verification: 587/587 tests pass; production build and vocabulary check
pass. Both Bob Edge entry points type-check with a temporary local import map
because the existing shared service's esm.sh import is blocked in this workspace.
The shared service is unchanged; CI must check the original import.
The prompt is not a mathematical proof of room fit. No source measurements,
existing project images or owner records are changed by this patch. No schema,
shared AI adapter or governed model configuration change is required. Live
acceptance must inspect a new actual drawing against the owner's current facts;
deployment status belongs in the PR release evidence.
