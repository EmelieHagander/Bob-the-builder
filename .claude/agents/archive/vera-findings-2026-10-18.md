# Vera finding archive — 2026-10-18

Historical evidence only. Active work lives in [Vera's open findings](../vera-findings.md). Current media behavior is owned by [the media contract](../../../Docs/media-and-steps.md).

## FINDING-V01 — Reference images are labels/placeholders, not real project media

The earlier finding described the initial label-only Area reference-image UI and called for real uploaded/renderable project media, purposes, storage/authority and runtime consumption.

That general placeholder-only claim is superseded. At main `e0ee015`, the routed `AreaWorkstream` uses `ProjectImages`, Steps and Tasks use canonical attachments, and chat/volunteer views render authorized images. [PR #269](https://github.com/EmelieHagander/Bob-the-builder/pull/269) and [CI 39127570522](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39127570522) include image/retry/original-download and participant browser proof. The 2026-10-18 review inspected their rendered images; it did not perform a new live-owner upload.

This archives the obsolete missing-media claim, not all media usability concerns. Discoverability and point-of-work presentation remain open under V07. The unused `AreaDetail.tsx` and legacy demo placeholders must not be mistaken for the routed connected Area screen.
