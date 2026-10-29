> **Dated evidence, 2026-10-29.** Independent review of the new material tables,
> written by a separate agent from the live database (read-only), local PGlite
> experiments and source. Owners: [material catalog](../material-catalog.md),
> [database](../../db/README.md#material-model). Follow-ups: B1 and S5/S9 were
> corrected before application ([verification](../foundation-verification.md#follow-ups-2026-10-29));
> the rest is planned in [State](../bob-delivery-flow.md#state). Scratch scripts it
> names (`exp1.mts` …) were not kept.

# Material model review — 2026-10-29

Scope: `20261029160000_material_model.sql` (MM), `20261029160100_standard_materials_seed.sql` (SEED), `20261029160200_material_lookup_catalog.sql`, the unapplied `20261029210000_optional_catalog_dimensions.sql` (OPT), and the existing catalog/stock/supplier model. Evidence comes from the live DB (read-only Management API, plus one simulated user inside `begin read only`), PGlite experiments (scripts `exp1.mts`, `exp2.mts`, `exp3.mts` in this folder), the focused `tests/material-model.test.ts` (10/10 pass), and source reading. **V** = verified by query or experiment. **S** = suspicion or reasoning only.

## Verdict

**Not a mess at the core, but a mess in waiting at the seams.** The live, used part is sound:
- The seed: 21 materials, 30 sizes, 45 combinations and 58 aliases. Counts are exact, there are no duplicates, and categories and forms are right.
- `bob.material_lookup`: project isolation holds, grants and RLS are tight, it runs in 15 ms live, and the live functions match the repo byte for byte.

Three things are not sound:
1. **Facts are copied, not owned.** Dimensions, names, form and material category live both on the new size/material rows and inside immutable catalog revisions. Nothing keeps them in step, and the five new columns on `bob.catalog_items` are mutable and unversioned on an entity whose whole contract is "exact immutable revisions".
2. **The shared-write model has no gate.** Anyone counted as a "participant", including members of a household from another app, can add aliases and prices that silently change every user's lookup. Aliases and articles attached to a *project-private* definition become readable by every signed-in user of all nine apps on the instance.
3. **The write side has no consumer.** No UI or Bob tool writes household stock, stores, prices or links, and all of those tables are empty live.

The unapplied OPT migration should not go in as written. It changes the identity contract so that an omitted dimension counts as "complete", which merges two different unknown definitions. It is also not needed for the gravel and plank examples it cites.

Everything flagged is cheap to fix **now**: the new tables hold 0 rows, project definitions hold 0 links, and nothing pins the seeded definitions yet (V).

---

## Blockers

### B1. OPT makes "omitted" mean "complete", so different unknown definitions merge (applies to the open PR)
- **Evidence (V, PGlite `exp2.mts`):** with OPT applied, `ensure` "OSB till golvet" (sheet_stock, no thickness) creates it with `has_unknown=false`. Then `ensure` "OSB till taket" with no thickness returns **`reused`** of the first record. Without OPT both calls fail with `catalog_missing_property:thickness`. A panel part with no length or width also gets an identity hash.
- **Cause:** `catalog_normalize` skips absent fields (`20260921095817_material_catalog.sql:221-223`). After OPT nothing is required (OPT:67), so `has_unknown` stays false and `fingerprint` is non-null (`20260922144500_catalog_preserve_metadata.sql:81-83`).
- **What it contradicts:** `Docs/material-catalog.md:202` ("two separately requested unknowns are not assumed to describe the same item"), `:115` ("Unknown is an explicit null with truth=unknown"), and CLAUDE.md "unknown stays unknown". `catalogSourceTruth` (`supabase/functions/_shared/material-catalog.ts:77-84`) would also label a sheet with no thickness `provided_spec` if it has any other property.
- **Failure scenario:** Bob saves "OSB for the floor" and "OSB for the roof", both with thickness not yet known. They become one definition. Revising one later (to 22 mm) silently changes what the other construction pins.
- **The cited examples don't need it (V, live profile fields):**
  - Gravel uses the new `bulk` profile, which is all-optional anyway.
  - A plank is `rectangular_profile` with width and thickness known. Its length is not a field, and weight is a column, not a profile field.
  - Only the roof sheet hit a required field, and it already had the documented explicit unknown (SEED:39-40).
- **Minimal fix:** apply only OPT's `bulk` form/profile and `mineral.aggregate` parts, and drop the blanket `update … set required=false` (OPT:67) and the trigger relaxation (OPT:55-56). If a genuinely dimension-less sheet is needed, add a new all-optional profile on form `sheet`. A new profile code avoids the "revision 2 hides old definitions" problem. If relaxation is still wanted, `catalog_normalize` must set `has_unknown=true` (no hash) when a quantity field of a geometric profile is absent.

### B2. Shared writes are ungated and leak project-private text. Latent today; must be fixed before any write path is wired
- **Who can write (V, `exp1`/`exp2`):** `bob_private.is_bob_participant` (MM:218-223) admits any user with an *active `shared.household_access` row*. That table is the cross-app family table: PostgREST exposes 12 schemas, 9 of them app schemas (`pgrst.db_schemas`, V live). A household-only user with no Bob project created a store, a material type, an alias and a price. The comment at MM:217, "Other apps' signed-in users cannot write Bob data", is false for household members. Live exposure today is 0: both active household users also have Bob people rows.
- **Alias poisoning (V):** an outsider added the alias "regel 2x4" to the 45×120 size. The lookup for "regel 2x4" then returned 45×120 rows with `unreviewed=false`. The `unreviewed` flag ignores aliases (MM:558), and aliases are returned as plain strings (MM:559-560, 449-450).
- **Price poisoning (V):** an outsider recorded 0.01 SEK and it became the "latest price" everyone sees (MM:573). Prices carry no review state.
- **Private text leak (V):** `add_material_alias` and `add_store_article` accept a *project-private* definition (`catalog_item_visible`, MM:250-253, 305, 359). The resulting rows sit in world-readable tables (`shared_read` policy, MM:196). A user in project B only, and the household-only user, could both read "Hemliga köksbänken A", its private `catalog_item_id` and `created_by`.
- **Minimal fix:**
  - Gate contributors on Bob project participation only.
  - Forbid shared aliases and articles that target project-private definitions. Put project aliases in the revision's `aliases` field instead.
  - Show only reviewed aliases (or flag unreviewed ones) in the lookup and in `catalog_item_spec`.
  - Give price rows a review/trust flag, or rank them by source, instead of "latest wins".

---

## Should fix

### S1. Mutable, unversioned links on a revisioned entity
- **Where:** `material_type_id`, `material_size_id`, `unit_code`, `weight_kg` and `review_status` sit on `bob.catalog_items` (MM:87-93). They are not in `identity_document`.
- **Evidence (V, `exp1`):** reading **historical revision 1** returns today's `spec` (MM:467 appends `catalog_item_spec(h.id)` whatever `p_revision` is). After revising the private sheet from 18 mm to 12 mm, rev 1 still read thickness 18 with size "5,0 × 80" and material "Gipsskruv".
- **No checks in `set_catalog_item_spec` (MM:315-331, V):** it accepted an 18 mm sheet linked to a *fastener* size, a *metal drywall-screw* material and unit `m`. It has no expected-revision check, receipt, provenance or claimed-turn writer. It replaces all fields wholesale: passing only `material_type_id` wiped `unit` and `weight_kg`. Any project member can call it through PostgREST.
- **Failure scenario:** a construction pins "Plywood 12 mm rev 1". Someone relinks the definition to a 15 mm size. Bob's readback of the pinned revision now shows 15 mm in `spec` and 12 mm in `properties`.
- **Fix:** move the five columns into `catalog_item_revisions` and the identity document, and change them only via `revise`. Cost now is 45 seeded rows and 0 project links. At minimum: add an expected revision, check type category = item material category, size form = item form, and unit dimension compatibility; and don't attach `spec` to historical reads.

### S2. Duplicated physical facts with no single owner
| Fact | Copies | Evidence |
|---|---|---|
| Dimensions | `material_sizes.{length,width,depth}_mm` vs revision `properties.{thickness,width,length,diameter}`, under different names (`depth_mm`↔`thickness`, `width_mm`↔`diameter` for fasteners) | SEED:39-45 copies once; S1 shows the drift (V) |
| Sheet format 1220×2440 | Size row and `nominal_size` text only. `sheet_stock` has no length/width fields (V live). Cut plans take the format from the caller or `stock_revisions.sheet_format`; `check_stock_sheet_format` checks thickness only (V live source) | A cut plan can use "Plywood 12 × 1220 × 2440" with a 1250×2500 format, unchecked |
| Name | Revision `name = material name + size label` (SEED:51) | Renaming the material type left the definition name stale (V `exp1`) |
| Form | `material_sizes.form_code` vs item form category vs profile form | Unchecked (V, S1) |
| Material category | `material_types.category_code` vs item material category | Unchecked (V, S1) |
| Aliases | `catalog_item_revisions.aliases` vs `material_aliases.catalog_item_id` | Both are searched |

- **Fix:** declare the revision properties the owner of physical dimensions. Treat the size row as a grouping/search key that is *validated* against the properties when linked (trigger), or derive it from them. Validate cut-plan stock formats against a linked size when one exists.

### S3. Two stock registers, no bridge, and the new one keeps no history
- `bob.household_stock` (MM:120-133) and `bob.stock_items`/`stock_revisions` (project, free-text name, append-only) have no link, and both are empty live (V).
- **Failure scenario:** a household records 10 planks at home. Two projects each record and allocate the same 10 in `stock_items`, giving 20 promised. Using them never decrements household stock.
- **No history:** `household_stock` is updated in place and removal is a hard delete (MM:416-429). That differs from every other Bob register.
- **No unit checks (V):** stock in `kg` for a `pcs` sheet was accepted, and so was a quantity with no unit.
- **Fix:** decide ownership (project stock references `household_stock.id`, or documented snapshot semantics), keep revisions, require a unit when a quantity is known, and check its dimension against the item unit.

### S4. Units for price, pack and weight are ambiguous
- `price_unit_code` uses `bob.catalog_units`, which has no `pack` unit (V live list).
- **Failure scenario:** a box of 200 screws costs 129 kr. With `pack_quantity=200, pack_unit_code=pcs, price_unit_code=pcs` it reads as 129 kr per screw (×200). With null, the basis is unknown.
- `weight_kg` (MM:91) has no defined basis: per `unit_code` (per m for timber, per m³ for gravel)? The docs' example "gravel has a weight" is really a bag, which is pack data.
- `store_articles.pack_*` duplicates `supplier_article_revisions.purchase_unit/content_per_purchase_unit/content_unit`, using a different vocabulary. The bridge `supplier_articles.store_article_id` (MM:187) has no writer anywhere (grep) and 0 rows live.
- **Null price (V):** recording a null price becomes the "current" price and hides the last known one.
- **Fix:** add `price_basis in ('unit','pack')`. Define `weight_kg` as mass per one `unit_code`, with a check that `unit_code` is not null and not `kg`. Exclude null-price rows from "current". Drop or wire the bridge column.

### S5. Lookup matching gives misleading candidates (seed aliases × match rule)
- **Cause:** MM:614-615 also matches when the *query contains* an alias of 3 or more characters. Combined with generic seed aliases ("skruv", "spik", "gips", "regel", "läkt") and no ranking (uuid order, MM:621), this produces wrong candidates.
- **Evidence (V live, as a simulated user):**
  - "utomhusskruv" returns 6 *indoor zinc* screws plus 2 outdoor ones.
  - "gipsskruv" returns gypsum boards and wood screws (PGlite).
  - "12x45" returns 45×95; "ankarspik" returns wire nails; "takläkt" returns all three batten sizes.
- **Fix:** match on whole tokens only, drop the generic aliases, and order exact alias/name hits first.

### S6. Lookup cost grows with items × aliases; the docs' index claim is false
- **Live EXPLAIN:** the alias test is a **Seq Scan on material_aliases per catalog item** (SubPlan 7, loops=45). `material_aliases_alias_idx` is never used by the lookup. The `matched` CTE filters every visible material before the limit.
- **Live total:** 15 ms and 2,749 buffers for 2 rows.
- **PGlite (`exp3.mts`):** 545 items/558 aliases took 54 ms; 2,045/2,058 took 607 ms, roughly quadratic. At about 10k entries this reaches the 8 s `authenticated` statement timeout (S).
- The test at `tests/material-model.test.ts:187-192` proves the index only for an equality query the lookup never runs. The db/README claim "Alias … lookups use their indexes" is false.
- **Fix:** resolve matching aliases first, with a token index or `pg_trgm` GIN. Collect type, size and item ids, then join to items. `catalog_read` (MM:529-530) has the same pattern.

### S7. Deleting a project fails when household stock points at its private definition
- **Evidence (V `exp1`):** `household_stock.catalog_item_id … on delete set null` (MM:123) plus `check(catalog_item_id is not null or name is not null)` (MM:132). Deleting project A failed with `23514` because a stock row carried only the item link.
- This breaks the operator and test-harness project cleanup paths.
- **Fix:** store a name snapshot on insert, or cascade.

### S8. Shared commands create wrong or empty rows
- **Size dedupe ignores the label (V):** `add_material_size` compares form and dimensions only (MM:285-286). "Rulle 1 × 15 m" returned the existing "Rulle 1 × 10 m" as `reused`.
- **No uniqueness on sizes:** a race creates duplicates.
- **Empty rows accepted (V):** `{}` creates a new empty store article on every call, and nameless material types are accepted repeatedly (the name index skips nulls).
- **Type dedupe matches name only:** "OSB/3" with category `plastic` reuses the wood row (S).
- **Fix:** require a name or label on shared rows, add a normalized unique index on sizes (form, dimensions, label), and reject articles with neither a store and article number nor a title.

### S9. Installed but unreachable; empty results read as "none"
- Only `material_lookup` has a runtime caller (`supabase/functions/_shared/ask-openai.ts:518-522`). `add_*`, `set_catalog_item_spec`, `save/remove_household_stock` and `record_store_price` are called only from tests (grep of src, functions and scripts).
- Live has 0 rows in household_stock, stores, store_articles and prices.
- Bob's tool text promises "household stock at home and the latest shared store prices". `stock_at_home: []` is a list, not null, so Bob can say "you have none at home".
- **Fix:** return `null` ("not recorded") until a write path exists, or wire one. Per CLAUDE.md, a committed migration is not runtime consumption.

---

## Minor

- **M1. Docs contradict the live schema:**
  - `Docs/material-catalog.md:132-135` sits in the *installed* section but says every profile field is optional and that `roll_stock` has "no dimension fields at all". Live, fields are still required and `roll_stock` has optional thickness, width and length.
  - The plank example ("length and width") doesn't match the model, which stores width and thickness.
  - The db/README index claim (S6) and the MM:217 comment (B2) are false.
  - The SEED header still says "for owner review".
- **M2.** Fasteners put diameter in `width_mm` (MM:58-59), which leaves Bob to apply the remapping via prompt text (lookup catalog `:8`). Tubes (outside diameter plus wall) can't be represented as a size. A `diameter_mm` column, or exposing `diameter_mm` for fasteners, is clearer.
- **M3. Seed details:**
  - Nail labels put length first ("100 × 3,4"), screws put diameter first ("4,0 × 50"), in the same form. This follows trade practice but is inconsistent within one form.
  - "Utomhusskruv, C4/rostfri" lumps two corrosion classes into one material.
  - The alias "13 mm gips" on a 12.5 mm board is fine as a trade word.
- **M4.** `review_status` is a nullable tri-state where null has no meaning on shared tables. It is effectively a constant on `catalog_items` (seed rows `reviewed`, project rows null).
- **M5.** Deleting a type or size uses `on delete set null`, which silently de-links shared combinations (V: deleting size 45×95 left 2 more size-less combinations). It also collides with the shared-combination unique index if an unsized combination already exists. `restrict` fits better.
- **M6.** No index on `supplier_articles.store_article_id`. `store_articles.store_id` is covered only by a partial index.
- **M7.** `created_by` and `recorded_by` user uuids, together with store and city, are readable by every signed-in user on the instance.
- **M8. Dead or unused:** the `bob.current_store_prices` view (no runtime reader), `bob_private.seed_length` after seeding, and `supplier_articles.store_article_id`.
- **M9. Size and stock limits:**
  - `material_sizes` holds 4 decimals while properties hold 6, so a 1/64 in size can't be stored.
  - `household_stock` can't record "6 pieces × 3.0 m".
- **M10.** The edge parser accepts a lookup-format cursor `<uuid>:<uuid>` for *parts* searches, and `catalog_read` then fails with 22P02. That returns an honest "invalid", so it is cosmetic.

---

## Checked and fine

- **Live = repo:** all 22 function bodies in MM match live exactly. Migrations are recorded in this order: `material_model` 173727, then `material_lookup_catalog` 174041, then `standard_materials_seed` 174121.
- **Grants (V live ACLs):**
  - `anon` has nothing.
  - `authenticated` has SELECT only on all 7 tables and the view, plus EXECUTE on the commands.
  - Commands are `security definer` with `search_path=''`.
  - `service_role` has full table rights.
  - `bob_private` is not exposed via PostgREST; RLS is enabled on every table.
- **Household isolation (V tests + `exp2`):** stock is visible only to active members. Another household's or an invited user's writes are denied, mismatched household/row pairs are denied, CAS returns `40001` on stale revisions, and prices cannot be updated or deleted.
- **`material_lookup` isolation (V):**
  - A non-member gets `42501`, and so does a household-only user.
  - A member of both A and B asking in project A for B's private id gets 0 rows.
  - `stock_at_home` contains only the caller's households.
  - `catalog_read`/`catalog_item_spec` are invoker functions and respect RLS.
- **Seed (V live):**
  - 21/30/45/58 as documented, with no duplicate aliases.
  - Every combination has exactly one material and one form category, and the profile matches the form.
  - Units are coherent (sheets, fasteners and tiles `pcs`; timber `m`; rolls and roof sheet `m2`).
  - 44 combinations have identity hashes; the roof sheet is the single explicit unknown.
- **2tum4:** there is one alias row, on the 45×95 *size*. It intentionally finds both C24 and pressure-treated 45×95. That is correct for a size word; it is not a duplicate.
- **Uniqueness:** the shared-combination index (material, size-or-zero) works. `material_aliases_target_idx` blocks duplicate aliases per target, and the coalesced uuid target is safe.
- **OPT trigger:** it allows only required→optional. Optional→required, bound changes and inserts into a published profile are all rejected (V).
- **The revision-2 alternative really is worse:** `catalog_read` filters on the exact `profile_revision` (MM:525), and the identity document contains `profile_revision` (`…catalog_preserve_metadata.sql:81`). So in-place is the cheaper route *if* relaxation is wanted at all (see B1).
- **Consumers of required dimensions fail closed:**
  - Cut-plan SQL checks for null thickness or format mismatch (`check_stock_sheet_format`, `cut_plan_sources`, live source).
  - The box checker reports `material_dimension_unknown` / `part_dimension_unknown` (`construction-checks.ts:82-99`).
  - `constructionPreview.ts:45` guards.
  - `construction-lists.ts:42` dereferences `thickness.value` unguarded, but is reached only after `concept_ready` (`construction-draft.ts:318,535`). That is brittle but currently safe.
- **No pins to shared seed definitions yet:** 0 part pins and 0 supplier pins. OPT's roof-sheet revision 2 is therefore harmless live, and the S1 migration would be cheap.
- **Performance today:** 15 ms live per lookup page; the price lateral uses `store_article_prices_article_idx`.
