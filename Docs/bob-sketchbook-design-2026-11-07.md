# Sketchbook: read once, work on a copy, check, save once — design 2026-11-07

> **Status:** owner-approved 2026-11-07 ("Ja kör på rek!": A first, then B for
> constructions; private job table; one commit per assignment, milestones
> allowed). **Built and published 2026-11-07, 08:55 UTC**
> ([§6](#6-built-2026-11-07), [publication record](bob-runtime-path-audit-2026-11-04.md#publication-496-2026-11-07));
> not yet owner-run.
> **Owns:** the target write cycle for Bob and the build team (A: check
> before saving; B: a job-scoped working copy committed once).
> **Does not own:** the domain contracts it reuses — constructions
> ([artifacts.md](artifacts.md)), solutions ([solutions.md](solutions.md)),
> server-bound writes ([ask-bob-writes.md](ask-bob-writes.md)), FORM
> ([bob-delivery-flow.md](bob-delivery-flow.md#form-flow)).

## 1. Owner direction

Owner, 2026-11-07: "Försöker bob och teamet idag använda databasen som sin
hjärna? Och göra ändring live däri hela tiden utan att först bekräfta dom
'på papper'?" The intended process:

```
fetch relevant data
  |
work on it in the sketchbook (not in the project records)
  |
save only the changed data, controlled: update_construction{item_id, changed_field}
```

This is the plan → apply pattern (git working tree → commit; Terraform plan →
apply): read a pinned snapshot, work on a copy, run the same checks on the
copy, then commit once with only the changed fields, guarded by the read
revision, and read back.

## 2. Today — measured and found in code, database and docs

**Measured (since 2026-11-02).** 871 reads against 187 saves; Konrad read the
same construction 386 times. The bed construction went from revision 15 to
19 in nine minutes on 2026-11-06, one live revision per small change; the
bed solution gets two revisions per owner decision (v14 and v15 the same
minute on 2026-11-06, v16 and v17 on 2026-11-07). Each saved construction
revision starts a change set of follow-up work: 278 follow-up items are
pending (259 material requirements, 17 drawings), the oldest from
2026-10-21. Refusals arrive at save time.

**Half implemented — the pieces exist, in different places:**

| Step | Constructions | Solutions | Drawings (CAD) | Plans | Materials |
|---|---|---|---|---|---|
| Read once | worker knowledge reads; `view=work` packet | pinned `edit_ref` snapshot | saved checked construction | full plan snapshot | readers, no fixed packet |
| Working copy across calls | **no** — each call re-prepares from the head | **no** — a fresh `edit_ref` after each save | **yes** — `cadAssistant.candidate` + private drawing-request draft | **yes** — `savableProposal` | **no** |
| Check on the copy | partly: identity, compile, concept/form match, stale text; the full check (collisions, joints, materials) runs **after** the save | `parseDesignIntent`, concept issues; the 30 kB readback only after the save | review + code check | local validation + review | previews (`check_construction_cut_fit`) |
| Commit changed fields once | per call; `edit_construction_parts` upsert/remove by id, parameters by node id; solution + construction atomically (`commit_construction_work`) | per call, 1–40 changes, `bound_solution` | `save_cad_design` once | `save_compiled_project_plan` once | one record per call |

Building blocks ready for reuse:

- six non-writing `prepare_*` SQL functions (construction edit, parameter,
  role, consequence, legacy transition, construction work) that merge a
  change list into the current revision and return `{draft, next}`; the
  commit re-runs the merge under the project lock;
- pure checks that accept any draft (`checkConstruction`,
  `constructionEditIssues`, `checkConstructionEvidence`, lists);
- the two complete examples of hold-then-commit: the CAD candidate and the
  plan proposal, kept in the turn checkpoint;
- revision guards everywhere (`expected_revision`, `target_revision`,
  `key` retry receipts).

Decisions that went the other way: the 2026-10-26 FORM decision keeps
sketches as saved Solution revisions ("No new table … is created for a
sketch"); piece progress 2026-11-03 saved each piece before the next
(relaxed by worker gates 2026-11-07). The 2026-10-08 change package
(`revise_cad_candidate`, changes against the last candidate) was removed on
2026-10-18; its audit warns against reviving a free JSON-patch API. Finding
3 of the 2026-10-28 cost audit (make the known follow-on changes for one
request together) is still open.

## 3. Design A — check before saving (`mode: "check"`)

The same write tools take `mode: "check" | "save"` under a new pin
(`write_check_version 1`). `"check"` runs everything the save would run and
writes nothing:

- **Constructions** (`edit_construction_parts`, `change_construction_parameters`,
  `save_construction_draft`): the `prepare_*` RPC (no write) or the local
  recipe build, compile, `constructionEditIssues`, concept/form match, stale
  text, and the full `checkConstruction` on the prepared draft — today run
  only after the save.
- **Solutions** (`edit_project_record`, `create_solution_alternative`): the
  delta on the pinned snapshot, `parseDesignIntent`, concept issues, and the
  readback size against the 30,000-byte limit (computed from the would-be
  record; the database stays the final gate).
- **Result:** `{status: "checked", saved: false, diff, check, issues,
  limits}` where `diff` lists the changed items and fields by id, `issues`
  name field, rule and limit (rule B1), `limits` carries the remaining budget
  (rule B2). No revision, no receipt, no change set; it does not count as a
  write.
- A `"save"` with the same arguments after a clean `"check"` commits as
  today. The description tells the model to check large or uncertain
  changes first; nothing forces it.

Cost: one extra call when the model uses it. Effort: about a day; it reuses
existing functions and adds no table.

## 4. Design B — a job sketchbook for constructions, committed once

**Model.** A sketch is the pinned base revision plus an ordered change list,
not a full copy:

```
sketch = { construction_id, base_revision, changes: [ {parts…, parameters…, joints…, removes…} ], checked_at }
```

The current state is computed when needed by the existing merge
(`prepare_construction_edit` accepts upsert/remove lists per collection);
later changes to the same id replace earlier ones, a remove cancels an
earlier upsert of a new id.

**Where it lives.** A private, job-scoped table
`bob_private.construction_sketches` (job id, construction id, base revision,
change list, updated at), readable only by the job's worker, never by
drawings, materials, the plan or the UI, deleted when the job ends. It is not
project truth, survives a killed segment (the CPU kills in
[why Bob stands still](bob-runtime-path-audit-2026-11-04.md#why-bob-stands-still-2026-11-07)),
and keeps the turn checkpoint small.

**Tools (Konrad first).**

| Tool | Does | Writes project truth |
|---|---|---|
| `sketch_construction` | adds changes in the `edit_construction_parts` format to the sketch (opening it at the current head on first use); returns the merged diff and the full check of the merged draft | no |
| `read_construction_draft` (`view: "sketch"`) | reads the merged sketch like a saved revision | no |
| `commit_construction_sketch` | sends the composed change list once through the existing prepare/commit path with `expected_revision = base_revision`; one revision, one server check, one change set, readback | **yes, once** |
| `discard_construction_sketch` | drops the sketch | no |

**Rules.** Numbers in the sketch come from reads and parameter nodes (rule
A); every change is checked on the merged sketch before the commit (rule B).
If the base moved (`construction_changed`), the commit re-prepares the same
change list on the new head and returns the conflicts by item id instead of
saving. One commit per assignment by default; Konrad may commit at a plan
milestone the owner should see. Bob shows the committed revision; the
owner's chat answer is the review (2026-10-27).

**Effects.** One revision and one change set per assignment instead of one
per piece; drawings and material lists turn stale once, at the commit;
refusals become sketch check results; each sketch call is small, so an
answer fits the 120 s window; fewer full re-reads.

**Later, same pattern.** Solutions: accumulate changes per `edit_ref` and
commit once per decision (until then, a rule for Bob: one
`edit_project_record` with all changes of one decision — the tool already
takes 1–40). Materials: a sketch of requirements and allocations committed
together.

Effort: about two to three days for constructions (table and RLS, change-list
composition, three tools, pins, catalog, tests); solutions and materials
follow separately.

## 5. Decisions for the owner

1. Order: A first, then B for constructions, then solutions and materials.
2. Where the sketch lives: a private job-scoped table (recommended: survives
   killed segments, small checkpoint) or the turn checkpoint (no new table,
   more CPU and size per step).
3. When Konrad commits: once per assignment (recommended) or at each plan
   milestone.
4. Supersede for constructions the 2026-11-03 "save each piece before the
   next" direction, and record that the 2026-10-26 FORM decision (sketches as
   saved Solution revisions) stays for solutions until their own sketch step.

Owner, 2026-11-07: "Ja kör på rek!" — all four as recommended.

## 6. Built 2026-11-07

Built and tested locally; published 2026-11-07, 08:55 UTC (bob-worker v214,
ask-bob v246, [record](bob-runtime-path-audit-2026-11-04.md#publication-496-2026-11-07));
**not yet owner-run.**
Both behind pins new claimed jobs adopt from the catalog; pinned manifests
keep their behaviour.

**A — `write_check_version 1`.** `edit_project_record` takes `mode: "check" |
"save"`. A check calls `bob.bob_project_write_check`, which runs the same
caller-authorized write function in a subtransaction, fires the deferred
constraint triggers (`SET CONSTRAINTS ALL IMMEDIATE`) and rolls back on
purpose: every rule answers, including the 30,000-byte solution readback
behind `compact_design_intent_required`; nothing is saved, no receipt, no
write budget. The refusal now names the 30,000-byte limit. Constructions are
checked through B instead (a check would send a large construction twice).
Migrations `20261107080000_bob_project_write_check.sql`,
`20261107080100_bob_write_check_catalog.sql`.

**B — `construction_sketch_version 1`.**

- `edit_construction_parts` takes `mode: "sketch" | "save"`. A sketched change
  is composed with the open sketch (one entry per id, the latest wins; removing
  an id the sketch added drops it), prepared on the sketch's base revision by
  the same server merge, compiled, and checked whole in code
  (`checkConstruction` / the evidence check on the merged draft). It is stored
  only when it passes the same refusals a save would; nothing is saved.
- `commit_construction_sketch {record_id, action: commit | read | discard |
  rebase, key, change_note}` saves the sketch as **one** revision through the
  ordinary edit path (one receipt, one change set, the whole-model check of
  that revision), reads it, drops it, or moves it onto a revision saved after
  it began (removals already done there are dropped; a sketch that does not
  apply yet is kept there, unchecked, to be corrected).
- Store: `bob_private.construction_sketches` (thread + turn + construction),
  reached only through `bob.construction_sketch` by the claimed caller of the
  current turn; an earlier turn's sketch is deleted on the next call, and a
  finished job deletes its sketches (trigger on `bob_jobs`). Never read by
  drawings, materials, plans or the UI.
- Konrad: the commit tool is in his core focus. A sketched change, a read, a
  rebase or a discard is not a piece write, so several may follow in one
  batch; a commit is a save like any other piece write. Sketches still open
  when he stops reach Bob as `open_sketches: not_saved`.
- Migrations `20261107090000_construction_sketches.sql`,
  `20261107090100_bob_construction_sketch_catalog.sql` (after A's).

**Supersedes for constructions** the 2026-11-03 direction that Konrad saves
each piece before the next ([piece progress](ask-bob-tools.md)): with the
sketch pin he builds in the sketch and saves once per assignment or at a step
the owner should see. The 2026-10-26 FORM decision (sketches as saved
Solution revisions) stays for solutions until their own sketch step.

**Verification (local, focused).** PGlite: three sketched changes leave
revision 1, no receipt; one commit gives revision 2 and one receipt; a direct
save during a sketch makes the commit a conflict, rebase then commit gives
one revision with both; the stranger, anon and service role cannot reach a
sketch; a completed job leaves none; the database catalog equals the test
fixture and code validates the published schemas. A write check saves no
artifact, revision, receipt or change set. Worker loop: sketch calls are not
deferred, a commit defers what follows it, open sketches are reported. Deno
type check of ask-bob and bob-worker passes.

