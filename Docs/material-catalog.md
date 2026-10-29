# Material and part definition catalog — slice A

**Status: merged and deployed 2026-09-22.** PR #94 is merged. Hosted migration `material_catalog` is applied; Ask Bob v13 is pinned to main `a9861000e011aba5a511455dea354e5c9d88a989`. The catalog definition/search/write path is live, while named-member natural-language acceptance remains to be exercised by a real user.
This is the definition foundation for [BOB-UC-MATERIAL-ASSEMBLY-01](material-assembly-use-case.md), tracked by #93. It is not completion of that usecase, the generic geometry engine, a BOM, cut planner, picker or dynamic Shopping. PR #94 owns the exact CI and release evidence; acceptance requirements below are not passing-test claims.

## Ownership and actual schema

The usecase owns the cross-domain journey. This document owns this catalog's implemented schema, bounded commands and verification boundaries. [Artifacts](artifacts.md), [material planning](material-planning.md), [Building context](building-model.md), [tool access](ask-bob-tools.md), and [database setup](../db/README.md) retain their existing responsibilities.

The proposed separate material/part tables are refined to **one versioning mechanism with two explicit kinds**, not one ambiguous material/stock/shopping entity:

| Table | Responsibility |
|---|---|
| `bob.catalog_units` | Input/display unit code, physical dimension and exact multiplier to a dimensional basis. Length has the fixed basis mm. |
| `bob.catalog_categories` | Material, form and function axes, stable category codes, labels, aliases and same-axis parent links. |
| `bob.catalog_property_definitions` | Stable property meanings, value type and canonical unit; all length properties must use mm. |
| `bob.catalog_profiles`, `catalog_profile_revisions`, `catalog_profile_fields`, `catalog_profile_rules` | Published immutable field/rule revisions, required fields ([a left-out required field marks the definition incomplete](#optional-dimensions)), range bounds, ordering and supported declarative relations. |
| `bob.catalog_items`, `catalog_item_revisions` | Stable identity, project/shared scope, kind `material` or `part`, exact version, dynamic properties, source class, optional named parameters and exact material revision for parts. |
| `bob.catalog_item_categories` | Category links tied to an exact item revision. |
| `bob_private.catalog_item_provenance` | Private current/earlier user-message quote, thread/sequence and actor for newly written revisions; not ordinary collaborator-readable catalog content. |
| `bob.current_catalog_items` | Security-invoker current-version view; explicit project pinning is also enforced by the application RPC. |

`bob.materials` is still Shopping. `bob.stock_items` and existing requirements/allocations remain unchanged; household stock at home is the separate [normalized material model](#normalized-material-model). A catalog create never asserts stock exists. A part definition currently contains **parameterized specifications only**, with `geometry_status=definition_only`; no local geometric recipe, anchors, machining operations, placed instances or reference-to-Building is claimed yet. Those extend the exact identity/revision in slice B.

## Canonical working units — owner decision 2026-09-21

**All working length dimensions are stored in millimetres.** This includes width, depth, thickness, diameter, spacing, clearance and future length properties regardless of material or object name. New length properties cannot select cm, m, in or a custom length unit as their canonical unit. That is a database invariant, not an instruction the model must remember.

Input may still be expressed in supported length units. SQL normalizes before typed search, identity/equivalence and save. Thus `1.6 m`, `160 cm` and `1600 mm` denote the same working length; changing only its input unit cannot create a different complete definition. Fractional millimetres are retained using exact decimal arithmetic and the existing precision/range limits, never silently rounded to whole millimetres. Unknowns and unbound parameter slots retain null values, canonical mm and their original truth/parameter meaning.

`catalog_length_property_guard` protects future property definitions, and `catalog_length_storage_guard` rejects a persisted length wrapper whose unit is not mm, including privileged direct seed writes. The storage guard deliberately **rejects**, rather than silently converting an already-hashed raw record. Normalization belongs to the command before identity generation. Neither guard adds read/write grants or changes the project boundary.

Distinguish three representations:

- **Working specification:** normalized decimal value and mm, used for geometry, identity, comparisons and future dimensional requirements.
- **Original evidence/audit:** unchanged user text and private request payload, for example the original `1,6 m`. This is provenance, not a second working length. Conversion does not turn a design choice or estimate into a measurement.
- **Display:** a future list/view may render `1600 mm` as `1,6 m`. Display unit/formatting must not mutate the definition, revision, equivalence hash, material pin, stock or order.

Only lengths use mm. Counts, area, volume, mass, angles and designation text remain dimensionally distinct; litres and square metres must never be labelled mm. The existing catalog seeds use l for volume, m2 for area, kg for mass and pcs for counts. The future assembly engine uses mm for coordinates/lengths and explicitly typed other quantities. This clarifies the usecase's more general per-property canonical-unit proposal; dynamic property names and profiles remain data-driven.

This migration does **not** rewrite earlier measurement history, legacy text quantities, existing drawings or other applications' data. Historical source units remain interpretable under their original contracts. A later bridge must normalize those source values at ingestion into the new working model while pinning the original evidence revision. No bulk conversion of the shared production database is implied.

### Inches and nominal trade sizes

The existing unit dictionary now includes **`in`, length, multiplier 25.4**.
It means the modern international inch, exactly 25.4 mm, not a historical local
inch or a product designation. The definition is checked against
[NIST — SI Units: Length](https://www.nist.gov/pml/owm/si-units-length).
No unit conversion such as `2x4 = 45x95` is executed. **Owner decision 2026-10-29 (supersedes the earlier "no mapping is seeded" rule):** the reviewed starting list attaches trade aliases such as `2x4` and `2tum4` to the specific 45 × 95 size as search words. They find that size; Bob still reports and saves the actual mm dimensions, and an alias never changes a numeric value. [Normalized material model](#normalized-material-model).

In ordinary chat the user may write tum, inches or an inch mark. Bob separates
the unit from the value: `¾ tum` becomes `{value: "¾", unit: "in", ...}`;
`1 1/2"` becomes `{value: "1 1/2", unit: "in", ...}`. The **SQL command**, not
mental arithmetic by the model, converts the numeric input before typed search,
identity comparison and saving. The tool schema and loaded how-to describe this
syntax. The user never needs to format JSON. Free-text interpretation by a live
model remains a behavioral acceptance gate, not proven by numeric parser tests.

With `unit=in`, supported numeric strings are integers, decimal point/comma
(with at most six decimal places), simple fractions (`3/4`, `3/2`), mixed numbers
(`1 1/2`, proper fractional tail), and `¼ ½ ¾ ⅛ ⅜ ⅝ ⅞` alone or after a whole
number. Ordinary/nonbreaking spaces and the fraction slash are normalized.
Other units retain their existing decimal-dot API syntax. Unit suffixes in the
value, multiplication expressions, feet-and-inches strings and ambiguous
hyphenated numbers are not accepted as a scalar; the caller must supply an
unambiguous value/unit pair. This is not an arbitrary expression evaluator.

`catalog_input_quantity` retains numerator and denominator while applying the
unit multiplier. It checks exact divisibility at the existing six-decimal
canonical precision **before division**, so it never rounds a repeating fraction
into a false exact value. Examples:

| Input | Stored working length |
|---|---|
| `¾ in`, `0.75 in`, `0,75 in` | `19.05 mm` |
| `1½ in`, `1 1/2 in` | `38.1 mm` |
| `1/64 in` | `0.396875 mm` |
| `1/127 in` | `0.2 mm` (no intermediate inch-decimal rounding) |
| `1/3 in` or `1/128 in` | Explicit precision error; no save or silent rounding |

The precision bound is a storage contract, not a measurement-accuracy promise.
Negative/zero values still obey the selected property's positive range rules;
unknowns and unbound parameter slots remain null/mm. Source wording, source
classification and the original idempotency payload remain unchanged.

`nominal_size` is an existing **text** property with no unit. It is also available
on rectangular material, sheet material and panel profiles, alongside its prior
use for tubes. A trade label such as `2x4`, `tvåtumfyra` or `R 1/2` is kept in
that field and/or search aliases, independently of the working dimensions.
A missing section remains unknown; a label does not supply thickness, width or
pipe diameter. Actual numeric values require a supplied specification, measurement
source, or an explicitly labelled design choice. Different products with the
same trade name and different sections are not automatically interchangeable.
Nominal versus physical meaning cannot be certified from shape validation alone;
Bob must interpret and cite the source correctly.

This extends the existing catalog, not a separate imperial catalog/tool/schema.
No material products, vendor mappings or stock counts are created by the inch
seed. Input/storage/search support is implemented here; a selectable imperial
**Shopping display**, fractional formatter and general-drawing UI are still
future consuming features, not shipped by this change.

## Vocabulary and dynamic properties

The migration seeds vocabulary and seven example specification profiles: sheet material, panel part, rectangular profile, tube material, tube part, fastener and liquid. It seeds **no actual stock, vendor products or material/part records**. It is not the licensed reference-book seeding in [building-knowledge.md](building-knowledge.md).

Material and form are independent. PVC sheet and PVC tube share the PVC category; form/profile decide which properties are relevant. A category's parent is in the same axis, and cycles are rejected. Stable category structure, unit meaning and property meaning cannot be edited in place. Published profile fields/rules cannot be rewritten; an operator publishes a new version. Ordinary Bob/user commands cannot modify the shared dictionary or globally publish definitions.

Within the supported quantity/text/boolean types, authorized new vocabulary and profiles require no new table column, model tool or object-specific handler. Profile rules are a bounded `factor * left < / <= / = right` vocabulary, not arbitrary executable SQL/JavaScript. A new physical/geometric operation is not implemented merely by adding a profile.

Each property value is `{value, unit, truth, parameter, note}`. Stored numeric quantities use decimal **strings**, at most six fractional digits; inch input may also use the bounded fraction syntax above. SQL uses exact arithmetic, verifies unit dimension, normalizes lengths to mm and other quantities to their compatible canonical unit, rejects precision loss/range overflow, and applies profile bounds. The global absolute quantity bound is 1,000,000,000; the seeded geometric fields have narrower limits. Limits are system validation, not a manufacturing-accuracy promise.

18 mm and 1.8 cm normalize identically. Inner diameter, outer diameter and nominal designation are different keys. A supplied tube wall/radius relation is geometric validation only, not pressure/temperature certification. Optional fields may be omitted; critical unstated suitability must not be inferred from a successful schema validation.

Unknown is an explicit null with `truth=unknown` and a note, never zero or a search wildcard. Only part definitions may use a named parameter: null value, `truth=provided_spec`, and an explicit parameter name. A parameter is a design slot to bind in a future assembly, not a measured dimension or an automatic equation. Reusing a parameter name with incompatible types/units is rejected. Length parameters bind in mm after normalization, irrespective of the original input-unit label.

<a id="normalized-material-model"></a>
## Normalized material model — installed 2026-10-29

**Installed 2026-10-29 with the reviewed starting list** (21 materials, 30 sizes,
45 combinations; [evidence](foundation-verification.md#open-issues-closed-install-2026-10-29)). Owner decisions 2026-10-29: standard
materials, sizes and their combination are separate, and the database grows as
people and Bob add entries. The combination is this catalog's material
definition, so existing pins keep working; it now links to a material, a size
(both nullable), a unit and a weight. Shared entries added by people or Bob are
marked `unreviewed` until an operator reviews them. Unknown values stay null.

Sizes are in mm. For fasteners `width_mm` holds the nominal shank diameter,
`length_mm` the length and `depth_mm` stays null; the seed maps them onto the
`fastener` profile's `diameter` and `length`. Sheets map `depth_mm` to
`thickness`; rectangular profiles map `depth_mm` to `thickness` and `width_mm` to
`width`. A required dimension the list does not state is saved as `unknown`
with a note. Rolls (`roll_stock`) and single pieces (`piece`) use all-optional
profiles, so roofing felt, membranes and tiles can be listed without invented
measures. The seed's starting list (21 materials, 30 sizes, 45 combinations, 58
aliases) is generated from `scripts/data/standard-materials.json` into its own
migration; the owner approved it and it was applied on 2026-10-29. It states no
product, supplier, price or weight.

<a id="optional-dimensions"></a>
**Every property may be left out — installed 2026-10-29 (owner decision;
[evidence](foundation-verification.md#follow-ups-install-2026-10-29)).** Materials state different things: gravel has a material and a weight
but no width or length; a plank has length and width but no weight.
`20261029210000_optional_catalog_dimensions.sql` changes one rule in
`bob_private.catalog_normalize`: a profile field marked required no longer stops
a save. Leaving it out marks the definition incomplete (`has_unknown`), exactly
like an explicit unknown, so it gets no identity fingerprint. Two separately
requested incomplete definitions ("OSB for the floor" and "OSB for the roof",
thickness not yet known) are therefore never merged or silently reused, and
consumers that need the dimension still refuse it: the box construction check
reports the missing thickness or part dimension, and cut plans reject an
incomplete panel part. Profiles, their published revisions and the immutability
rule are unchanged, so saved and seeded definitions keep their identities and
filtered searches. A first draft relaxed the profiles themselves; an independent
review showed that let incomplete definitions merge, and it was replaced before
application. The migration also adds the form `bulk` (Lösvikt) with an
all-optional `bulk` profile and the material category `mineral.aggregate`
(Ballast: grus, sand, makadam). Weight stays on the combination
(`catalog_items.weight_kg`), and a plank's length on its size row
(`rectangular_profile` has no length field). No runtime or catalog publication
changes.

New manifests (`tools.search_material_catalog` `material_lookup_version` 1) send
an untyped material search to the combined lookup: one row per combination and
purchase place with household stock at home and the latest shared price. Typed
property searches, parts and older manifests keep the definition-only search.
[Database contract](../db/README.md#material-model).

Bob's `save_catalog_definition` still creates project definitions; saving new
definitions directly as shared and unreviewed is a separate follow-up because it
changes the write authority and identity scope.

## Search → read → ensure/revise

Catalog tools validate their declared argument shapes before database access.
The installed 2026-10-29 read contract (`tools.search_material_catalog` v3) allows omitted unused `profile_code` and
`profile_revision`, which code supplies as null. Vocabulary browsing still uses
`categories=[]`, `properties={}` and `query=null` for an unfiltered page. A profile
revision requires its code; typed property filters require both exact fields.
Writes never infer a profile or material identity. Unknown fields remain errors.
[Publication and verification](foundation-verification.md#creation-preparation-2026-10-29)
record its installation; manifests pinned before it keep the earlier all-fields contract.

Rejected shapes return field paths; rejected filter combinations explain the
correction. For definitions, copy published profile codes/revisions and category
axes from reads; the exact profile exposes its form category as `record.form`.
Known SQL category/profile/property rejections return fixed public repair
guidance, never raw database details.

Three tools are registered through the existing tool session, not hardwired into the model loop:

- `search_material_catalog`: bounded categories/profiles listing or material/part search by literal name/alias, descendant category and normalized typed property filters.
- `read_material_catalog`: exact definition or published profile; null revision reads current/latest, an explicit revision reads that historical version.
- `save_catalog_definition`: `ensure` a definition or `revise` an exact project identity with its current revision.

Search is metadata first, twelve results plus a cursor; exact read returns the properties, profile/revision, material pin, source class and parameters. A title match is only a candidate. Typed property filters require the exact profile version. Unknown filters, unsupported keys, wrong units and technical failures are not converted to an empty library. Full read results are bounded to 32 KB, twelve calls per turn and an abortable ten-second operation bound.

`ensure` atomically reuses a **complete exact normalized identity** or creates a project-private record. Names and aliases do not determine identity. Profile/category/material pins, normalized property wrappers (including uncertainty/notes), and definition notes do. A hash indexes identity, but an exact identity-document comparison verifies reuse. This deliberately conservative implementation is not semantic synonym/deduplication of free-text notes. Different meaningful specifications are not substituted automatically.

Incomplete definitions do not receive an equivalence hash; two separately requested unknowns are not assumed to describe the same item. An exact retry uses the existing private idempotency receipt. To use an existing incomplete definition, retain its exact ID instead of issuing another ensure. One per-project transaction lock and a unique identity index serialize competing creates; true multi-connection hosted concurrency remains a separate proof from PGlite's queued transactions.

`revise` keeps the stable ID and appends a version after optimistic revision checking. It cannot change kind or edit a shared definition. An exact no-op revise returns `reused` and does not create a new revision. On `revise`, `aliases: null` and `notes: null` explicitly preserve the current metadata; an empty alias array is an intentional clear, not a shorthand for unchanged. Bob should also avoid metadata-only revisions when the user's requested specification is already represented; existing aliases/notes are preserved unless the user actually asks to change them. Parts retain their exact material revision and cannot override overlapping known material fields. When a part profile uses a property already present on the pinned material revision, the server inherits that compatible property before validating the part profile. Bob therefore supplies the remaining part-specific required properties (for example panel length/width) as structured fields rather than duplicating material thickness or hiding dimensions in notes. A changed material marks the part's material source changed; it does not silently modify the saved part. This is not yet assembly source adoption or revision propagation.

## Authority, evidence and recovery

Production catalog reads and `bob_project_write_v7` use the **caller JWT** and explicit current project. Shared definitions may be read; private records from another project cannot be surfaced through an active-project search/read or linked by the writer, even for a member of both. Normal clients have no raw INSERT/UPDATE/DELETE on definitions or dictionary tables. RLS protects exposed tables; invoker reads and the guarded existing claimed-turn path enforce the command boundary. No shared-family/other-app data is changed.

The v7 writer delegates older kinds unchanged to v6. Catalog saves reuse claim ownership/generation, the current-message request quote, private receipt ledger, eight-write budget, atomic rollback, idempotent retries and fenced settlement. The source quote may cite an earlier user message in the same thread; that is evidence, not new authority. The current request must independently authorize the action. Source kind distinguishes a user statement from an AI design choice; exact quote validation is not semantic proof of correct interpretation.

A reuse receipt says **reused**, not created or updated, and pins the unchanged definition revision. New/changed definitions say created/updated. The browser evidence parser accepts reused only for catalog receipts; old write categories retain their contract. The existing receipt UI shows **Definition vN** for catalog rows and **Reused existing definitions** for reuse-only results, not a false new save. Receipt keys include revision and saved time so multiple events for one definition do not collide. These are existing chat disclosures, not a new catalog-management screen. Matching frontend receipt support is a coordinated deployment dependency.

Only exact definition reads add `catalog` evidence (`id@revision`). Search candidates do not become full specification evidence. Compact source states preserve unknowns and estimates and mark AI design choices as assessments. Actual field truth stays in the full record. Private user quotes/actors/threads and identity hashes are not copied into standard tool readback, compact receipts or shared source envelopes.

No automatic purchase, stock reservation, global publication or physical Building write follows from defining a material. No image is opened by these tools. Existing image choice, grounding and conversation compaction paths remain separate and unchanged in authority.

## Verification and release

Required coverage is represented by `material-catalog-shape.test.ts`, `material-catalog-evidence.test.ts`, `material-catalog-db.test.ts`, `material-catalog-mm.test.ts` and `material-catalog-inches.test.ts`: strict shapes, dynamic profiles, equivalent units, mm property/storage invariants, exact decimal/fractional inches, nominal-vs-physical sizes, source preservation, non-equivalent unknowns, exact history, part/material pinning, PVC in multiple forms, raw/RLS denial, project revocation, paging, atomic receipts and generation fencing. Inch tests run the actual tool parsers and migrated SQL commands; 384 generated fraction cases use an independent integer-rational expected result. These are not live-model interpretation tests. The real production tool session/turn orchestrator is exercised against an actually migrated PGlite database with an **injected provider response sequence**: list → load → profile/search → ensure material → ensure part → exact read → persisted transcript/receipts.

That scripted seven-round journey demonstrates transport/SQL wiring within the existing eight-round limit, not arbitrary language behavior, acceptable live latency or the whole assembly workflow. A more complex definition set may exceed the current turn budget; do not conceal partial results. Actual named-member model tests, hosted Auth/PostgREST and parallel concurrency remain release gates.

The focused production-build browser journey is `scripts/check-material-catalog-browser.mjs`, appended to the existing `verify:project` command without changing workflows or credentials. It exercises created/reused/revised catalog receipts, exact historical versions, a lost-response retry, reload, forged receipt rejection and project switching at 320/390/1280. All non-local network calls are blocked or fixture responses. Its assertions and screenshots prove UI behavior only, not live model/SQL behavior. PR #94 records which exact execution passed; existence of the script alone is not a passing gate. Ordinary existing browser gates must remain green too.

Migration source: `20260921095817_material_catalog.sql`. On 2026-09-22 a final hosted preflight confirmed zero catalog tables, no v7 writer and no prior source-version entry. The exact merged migration was then applied as hosted migration `20260922072632 material_catalog`. Readback verified 10 catalog tables, v7 present, `in = 25.4`, and zero non-mm canonical length properties. Do not edit/replay this source migration against production; future schema changes require a new migration.

Release evidence 2026-09-22: #94 final-head CI and dependency security were green before merge; Pages deploy from main succeeded; hosted Ask Bob v13 is active with JWT verification and exact main pin. Live grants were read back: anon has no catalog read/write RPC or table SELECT; authenticated has catalog SELECT and guarded read/write RPC but no raw INSERT. The three catalog tools are active. Remaining acceptance gap: a normal signed-in user should now exercise natural-language search/create/reuse/revise in the live app; the dedicated named-member probe was not run because no separate test-member session was configured.

Issue #93 remains open. This slice alone does not satisfy AC-08–19 or the whole live AC-24/25 journey: construction geometry, derived material requirements, cuts, pick lists, grouped Shopping and real-model end-to-end acceptance are still separate work.
