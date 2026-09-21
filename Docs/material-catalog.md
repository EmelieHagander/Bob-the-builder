# Material and part definition catalog — slice A

**Status: implementation branch / PR #94; not merged, not applied or deployed.**
This is the definition foundation for [BOB-UC-MATERIAL-ASSEMBLY-01](material-assembly-use-case.md), tracked by #93. It is not completion of that usecase, the generic geometry engine, a BOM, cut planner, picker or dynamic Shopping. PR #94 owns the exact CI and release evidence; acceptance requirements below are not passing-test claims.

## Ownership and actual schema

The usecase owns the cross-domain journey. This document owns this catalog's implemented schema, bounded commands and verification boundaries. [Artifacts](artifacts.md), [material planning](material-planning.md), [Building context](building-model.md), [tool access](ask-bob-tools.md), and [database setup](../db/README.md) retain their existing responsibilities.

The proposed separate material/part tables are refined to **one versioning mechanism with two explicit kinds**, not one ambiguous material/stock/shopping entity:

| Table | Responsibility |
|---|---|
| `bob.catalog_units` | Input/display unit code, physical dimension and exact multiplier to a dimensional basis. Length has the fixed basis mm. |
| `bob.catalog_categories` | Material, form and function axes, stable category codes, labels, aliases and same-axis parent links. |
| `bob.catalog_property_definitions` | Stable property meanings, value type and canonical unit; all length properties must use mm. |
| `bob.catalog_profiles`, `catalog_profile_revisions`, `catalog_profile_fields`, `catalog_profile_rules` | Published immutable field/rule revisions, required fields, range bounds, ordering and supported declarative relations. |
| `bob.catalog_items`, `catalog_item_revisions` | Stable identity, project/shared scope, kind `material` or `part`, exact version, dynamic properties, source class, optional named parameters and exact material revision for parts. |
| `bob.catalog_item_categories` | Category links tied to an exact item revision. |
| `bob_private.catalog_item_provenance` | Private current/earlier user-message quote, thread/sequence and actor for newly written revisions; not ordinary collaborator-readable catalog content. |
| `bob.current_catalog_items` | Security-invoker current-version view; explicit project pinning is also enforced by the application RPC. |

`bob.materials` is still Shopping. `bob.stock_items` and existing requirements/allocations remain unchanged. A catalog create never asserts stock exists. A part definition currently contains **parameterized specifications only**, with `geometry_status=definition_only`; no local geometric recipe, anchors, machining operations, placed instances or reference-to-Building is claimed yet. Those extend the exact identity/revision in slice B.

## Canonical working units — owner decision 2026-09-21

**All working length dimensions are stored in millimetres.** This includes width, depth, thickness, diameter, spacing, clearance and future length properties regardless of material or object name. New length properties cannot select cm, m or a custom length unit as their canonical unit. That is a database invariant, not an instruction the model must remember.

Input may still be expressed in supported length units. SQL normalizes before typed search, identity/equivalence and save. Thus `1.6 m`, `160 cm` and `1600 mm` denote the same working length; changing only its input unit cannot create a different complete definition. Fractional millimetres are retained using exact decimal arithmetic and the existing precision/range limits, never silently rounded to whole millimetres. Unknowns and unbound parameter slots retain null values, canonical mm and their original truth/parameter meaning.

`catalog_length_property_guard` protects future property definitions, and `catalog_length_storage_guard` rejects a persisted length wrapper whose unit is not mm, including privileged direct seed writes. The storage guard deliberately **rejects**, rather than silently converting an already-hashed raw record. Normalization belongs to the command before identity generation. Neither guard adds read/write grants or changes the project boundary.

Distinguish three representations:

- **Working specification:** normalized decimal value and mm, used for geometry, identity, comparisons and future dimensional requirements.
- **Original evidence/audit:** unchanged user text and private request payload, for example the original `1,6 m`. This is provenance, not a second working length. Conversion does not turn a design choice or estimate into a measurement.
- **Display:** a future list/view may render `1600 mm` as `1,6 m`. Display unit/formatting must not mutate the definition, revision, equivalence hash, material pin, stock or order.

Only lengths use mm. Counts, area, volume, mass, angles and designation text remain dimensionally distinct; litres and square metres must never be labelled mm. The existing catalog seeds use l for volume, m2 for area, kg for mass and pcs for counts. The future assembly engine uses mm for coordinates/lengths and explicitly typed other quantities. This clarifies the usecase's more general per-property canonical-unit proposal; dynamic property names and profiles remain data-driven.

This migration does **not** rewrite earlier measurement history, legacy text quantities, existing drawings or other applications' data. Historical source units remain interpretable under their original contracts. A later bridge must normalize those source values at ingestion into the new working model while pinning the original evidence revision. No bulk conversion of the shared production database is implied.

## Vocabulary and dynamic properties

The migration seeds vocabulary and seven example specification profiles: sheet material, panel part, rectangular profile, tube material, tube part, fastener and liquid. It seeds **no actual stock, vendor products or material/part records**. It is not the licensed reference-book seeding in [building-knowledge.md](building-knowledge.md).

Material and form are independent. PVC sheet and PVC tube share the PVC category; form/profile decide which properties are relevant. A category's parent is in the same axis, and cycles are rejected. Stable category structure, unit meaning and property meaning cannot be edited in place. Published profile fields/rules cannot be rewritten; an operator publishes a new version. Ordinary Bob/user commands cannot modify the shared dictionary or globally publish definitions.

Within the supported quantity/text/boolean types, authorized new vocabulary and profiles require no new table column, model tool or object-specific handler. Profile rules are a bounded `factor * left < / <= / = right` vocabulary, not arbitrary executable SQL/JavaScript. A new physical/geometric operation is not implemented merely by adding a profile.

Each property value is `{value, unit, truth, parameter, note}`. Numeric quantities use decimal **strings**, at most six fractional digits. SQL uses decimal arithmetic, verifies unit dimension, normalizes lengths to mm and other quantities to their compatible canonical unit, rejects precision loss/range overflow, and applies profile bounds. The global absolute quantity bound is 1,000,000,000; the seeded geometric fields have narrower limits. Limits are system validation, not a manufacturing-accuracy promise.

18 mm and 1.8 cm normalize identically. Inner diameter, outer diameter and nominal designation are different keys. A supplied tube wall/radius relation is geometric validation only, not pressure/temperature certification. Optional fields may be omitted; critical unstated suitability must not be inferred from a successful schema validation.

Unknown is an explicit null with `truth=unknown` and a note, never zero or a search wildcard. Only part definitions may use a named parameter: null value, `truth=provided_spec`, and an explicit parameter name. A parameter is a design slot to bind in a future assembly, not a measured dimension or an automatic equation. Reusing a parameter name with incompatible types/units is rejected. Length parameters bind in mm after normalization, irrespective of the original input-unit label.

## Search → read → ensure/revise

Three tools are registered through the existing tool session, not hardwired into the model loop:

- `search_material_catalog`: bounded categories/profiles listing or material/part search by literal name/alias, descendant category and normalized typed property filters.
- `read_material_catalog`: exact definition or published profile; null revision reads current/latest, an explicit revision reads that historical version.
- `save_catalog_definition`: `ensure` a definition or `revise` an exact project identity with its current revision.

Search is metadata first, twelve results plus a cursor; exact read returns the properties, profile/revision, material pin, source class and parameters. A title match is only a candidate. Typed property filters require the exact profile version. Unknown filters, unsupported keys, wrong units and technical failures are not converted to an empty library. Full read results are bounded to 32 KB, twelve calls per turn and an abortable ten-second operation bound.

`ensure` atomically reuses a **complete exact normalized identity** or creates a project-private record. Names and aliases do not determine identity. Profile/category/material pins, normalized property wrappers (including uncertainty/notes), and definition notes do. A hash indexes identity, but an exact identity-document comparison verifies reuse. This deliberately conservative implementation is not semantic synonym/deduplication of free-text notes. Different meaningful specifications are not substituted automatically.

Incomplete definitions do not receive an equivalence hash; two separately requested unknowns are not assumed to describe the same item. An exact retry uses the existing private idempotency receipt. To use an existing incomplete definition, retain its exact ID instead of issuing another ensure. One per-project transaction lock and a unique identity index serialize competing creates; true multi-connection hosted concurrency remains a separate proof from PGlite's queued transactions.

`revise` keeps the stable ID and appends a version after optimistic revision checking. It cannot change kind or edit a shared definition. Parts retain their exact material revision and cannot override overlapping known material fields. A changed material marks the part's material source changed; it does not silently modify the saved part. This is not yet assembly source adoption or revision propagation.

## Authority, evidence and recovery

Production catalog reads and `bob_project_write_v7` use the **caller JWT** and explicit current project. Shared definitions may be read; private records from another project cannot be surfaced through an active-project search/read or linked by the writer, even for a member of both. Normal clients have no raw INSERT/UPDATE/DELETE on definitions or dictionary tables. RLS protects exposed tables; invoker reads and the guarded existing claimed-turn path enforce the command boundary. No shared-family/other-app data is changed.

The v7 writer delegates older kinds unchanged to v6. Catalog saves reuse claim ownership/generation, the current-message request quote, private receipt ledger, eight-write budget, atomic rollback, idempotent retries and fenced settlement. The source quote may cite an earlier user message in the same thread; that is evidence, not new authority. The current request must independently authorize the action. Source kind distinguishes a user statement from an AI design choice; exact quote validation is not semantic proof of correct interpretation.

A reuse receipt says **reused**, not created or updated, and pins the unchanged definition revision. New/changed definitions say created/updated. The browser evidence parser accepts reused only for catalog receipts; old write categories retain their contract. The existing receipt UI shows **Definition vN** for catalog rows and **Reused existing definitions** for reuse-only results, not a false new save. Receipt keys include revision and saved time so multiple events for one definition do not collide. These are existing chat disclosures, not a new catalog-management screen. Matching frontend receipt support is a coordinated deployment dependency.

Only exact definition reads add `catalog` evidence (`id@revision`). Search candidates do not become full specification evidence. Compact source states preserve unknowns and estimates and mark AI design choices as assessments. Actual field truth stays in the full record. Private user quotes/actors/threads and identity hashes are not copied into standard tool readback, compact receipts or shared source envelopes.

No automatic purchase, stock reservation, global publication or physical Building write follows from defining a material. No image is opened by these tools. Existing image choice, grounding and conversation compaction paths remain separate and unchanged in authority.

## Verification and release

Required coverage is represented by `material-catalog-shape.test.ts`, `material-catalog-evidence.test.ts`, `material-catalog-db.test.ts` and `material-catalog-mm.test.ts`: strict shapes, dynamic profiles, equivalent units, mm property/storage invariants, fractional lengths, source preservation, non-equivalent unknowns, exact history, part/material pinning, PVC in multiple forms, raw/RLS denial, project revocation, paging, atomic receipts and generation fencing. The real production tool session/turn orchestrator is exercised against an actually migrated PGlite database with an **injected provider response sequence**: list → load → profile/search → ensure material → ensure part → exact read → persisted transcript/receipts.

That scripted seven-round journey demonstrates transport/SQL wiring within the existing eight-round limit, not arbitrary language behavior, acceptable live latency or the whole assembly workflow. A more complex definition set may exceed the current turn budget; do not conceal partial results. Actual named-member model tests, hosted Auth/PostgREST and parallel concurrency remain release gates.

The focused production-build browser journey is `scripts/check-material-catalog-browser.mjs`, appended to the existing `verify:project` command without changing workflows or credentials. It exercises created/reused/revised catalog receipts, exact historical versions, a lost-response retry, reload, forged receipt rejection and project switching at 320/390/1280. All non-local network calls are blocked or fixture responses. Its assertions and screenshots prove UI behavior only, not live model/SQL behavior. PR #94 records which exact execution passed; existence of the script alone is not a passing gate. Ordinary existing browser gates must remain green too.

Migration: `20260921095817_material_catalog.sql`. Its filename was generated by the repository's installed Supabase CLI 2.117.0 during CI #298 in an isolated directory; the temporary authoring test/candidate file were removed after authoring. Hosted read-only preflight on 2026-09-21 confirmed that the catalog tables, v7 writer and catalog migration are absent; the mm guards were therefore added to this still-unapplied candidate, not by rewriting deployed migration history.

Before rollout: reread current main/hosted schema and migration history; review exact diff, policy/grants/indexes and old-client receipt compatibility; verify the final ordinary test/Edge/build gates; apply only this additive migration; deploy the matching frontend and Edge code in a coordinated order; verify actual caller-JWT read/write/reuse/revision and independent named-member model behavior. Record runtime identity and rollback plan before claiming live. Roll back the Edge/frontend before removing additive schema. Never replay the shared database bootstrap.

Issue #93 remains open. This slice alone does not satisfy AC-08–19 or the whole live AC-24/25 journey: construction geometry, derived material requirements, cuts, pick lists, grouped Shopping and real-model end-to-end acceptance are still separate work.
