from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    i = text.find(start)
    if i < 0:
        raise SystemExit(f'{label}: start not found')
    j = text.find(end, i + len(start))
    if j < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:i] + replacement.rstrip() + '\n\n' + text[j:]


def insert_after_line(text, contains, new_lines, label):
    lines = text.splitlines()
    matches = [i for i, line in enumerate(lines) if contains in line]
    if len(matches) != 1:
        raise SystemExit(f'{label}: expected one line containing {contains!r}, found {len(matches)}')
    i = matches[0]
    lines[i + 1:i + 1] = new_lines.strip('\n').splitlines()
    return '\n'.join(lines) + ('\n' if text.endswith('\n') else '')


# V1 execution marker: replace the whole current-status block so it cannot retain
# stale ordering from the earlier foundations lane.
path = 'Docs/v1-plan.md'
text = read(path)
section = '''## Current execution position — 2026-09-15

The numbered slices describe the product dependency chain, but implementation has intentionally followed a **foundations-first execution lane**. Later manual foundations may therefore be live while earlier AI gates remain deliberately deferred.

**Deployed / live-verified foundations:**

- Slice 0 — trust foundation;
- Slice 1A — real project media;
- Slice 1B — manual illustrated task steps;
- Slice 2A — measurements/provenance/history;
- Slice 2B — existing components;
- Slice 2C — persistent Site/Building/Level/Space/BuildingElement context, spatial relationships, Project/Area physical scope and accepted/proposed history;
- Slice 3A — alternatives + scope-safe selected target;
- Slice 4A — manual plans/drawings with exact target and measurement lineage;
- Slice 4B1 — deterministic `stud_wall_opening_v1` artifact geometry;
- Slice 4B2a — manual material requirements, stock/reuse allocation, purchase arithmetic and explicit Shopping handoff;
- Slice 4B2b — deterministic `stud_wall_net_area` material base quantity in the same requirement/Shopping path;
- collaboration foundation — opt-in household Building editing, explicit household project sharing and registration-free name-only volunteers, with hosted authority/media/revocation proof;
- Project/Area lifecycle foundation — explicit `ProjectPhase` / `AreaPhase`, scope-safe Project/Area targets and phase-aware Project/Area/Account/Today/Task surfaces;
- executable-work readiness foundation — Task→Task/checkpoint dependencies, required tools/information, canonical material readiness, named blockers and explicit human-confirmed `ready` state.

4B1/4B2a/4B2b are runtime truth. The first deterministic material calculator remains deliberately narrow; broader fastener/consumable/catalogue/engineering rules stay unknown/manual until an explicit deterministic rule is modelled. `Docs/foundation-verification.md` owns exact migration, advisor, browser and hosted evidence.

Household/friend sharing and name-only volunteers are also runtime truth at the currently available hosted fidelity. PR #61 closed the rollout with the sharing migrations, hardening migration, deployed `volunteer-media`, rollback-safe household authority proof and ordinary hosted volunteer/media/revocation proof. The one explicit external-fixture limitation is the accepted-Hearth-friend **positive** production path: production currently has no accepted friendship to exercise without fabricating another app's data. Denial when friendship is absent is live-verified; the product contract still requires the positive path once a real accepted friendship exists.

Project/Area phases and scope-safe target ownership are runtime truth. PR #60 delivered the lifecycle/scoped-target stack, PR #62/#63 closed its hosted proof, and #64–#67 carried Area scope and lifecycle context through Material Plan, Account, Today and Task Detail.

Executable readiness is now runtime truth too. PR #68 delivered the domain/UI foundation; source migration `20260915073000_executable_work_readiness.sql` is hosted as `20260915091153_bob_executable_work_readiness`. PR #70 added the ordinary hosted verifier. PR #73 made the phase fixture self-contained and source-synced the checkpoint-FK covering index, hosted as `20260915143912_bob_executable_work_readiness_fk_index`; the specific advisor finding is gone. Pages run `34984705428` and live foundation run `34984705122` are green on release tree `59929f997741e41555d1faef0a95769df9eb86d9`. The live run proves phase/tool/information/dependency/checkpoint/material blockers, stale-write denial, explicit Ready confirmation, re-review after newer material truth, Today visibility, completion and raw/anonymous/project isolation. Its exact disposable project was nonce-checked, had zero media and was operator-deleted with zero project/material/stock/artifact/media rows remaining.

**Still open by deliberate deferral:**

- Slice 1C — Bob vision over authorised project images;
- full Slice 2 AI consumption of measurements/evidence and Bob-assisted whole-plan ingestion;
- Slice 3B generated visual proposals/mockups;
- broader deterministic material rules beyond `stud_wall_net_area` where explicit formulas/coverage rules exist;
- the remaining executable-work contract beyond readiness: richer task scope/expected result, explicit work ordering/sequence semantics and Bob-proposed **human-confirmed** work breakdowns;
- Slice 5 generated/project-specific guidance plus structured progress/as-built completion.

**Current next implementation milestone:** finish the remaining **manual executable-work contract** on top of the now-live readiness foundation: richer task scope / expected result plus explicit ordered-work semantics that humans can edit and confirm. Do not make AI-generated work breakdowns project truth until that manual persistence/authority boundary exists.

The separate Ask Bob behavior discovery in PR #53 remains a parallel design lane. It should consume the persisted project/phase/building/solution/artifact/material/readiness truth rather than becoming a competing source of truth.

Area → physical-target mapping is backend-built and live-verified. A dedicated Area-side mapping editor remains a narrow follow-up; it is not a reason to reopen the sparse Building/Space foundation.

**Execution order from here:**

1. finish richer task scope/expected-result and explicit ordered-work/work-breakdown persistence with human confirmation;
2. add the minimum Slice 5 progress/as-built memory and one supported project-specific **How do I?** loop;
3. extend deterministic material rules only where explicit formulas/coverage rules and provenance are defined;
4. let the separate AI lane consume the persisted foundations with the same proposal/confirmation boundaries;
5. exercise the accepted-friend positive hosted path when production Hearth naturally has an accepted friendship — never fabricate Hearth data solely for Bob verification.

This section is the current execution marker. Detailed built/partial/gap truth still belongs to `Docs/function-inventory.md`; release scope and gates remain in this plan.'''
text = replace_between(text, '## Current execution position', '---', section, 'v1 execution section')
write(path, text)

# Foundation release evidence: replace stale prepared-sharing section and add the
# executable-readiness release record before the existing deterministic-material section.
path = 'Docs/foundation-verification.md'
text = read(path)
release = '''## Delivered household/project sharing and name-only volunteers

**Status:** household/project sharing and registration-free name-only volunteer participation are implemented, merged, migrated, deployed and live-verified at the currently available hosted fidelity. PR #52 delivered source; [PR #61](https://github.com/EmelieHagander/Bob-the-builder/pull/61) closed hosted rollout hardening and volunteer/media proof. The data/auth contract remains in `db/README.md`; Building authority remains owned by `Docs/building-model.md`.

Hosted migrations are:

| Source migration | Hosted registry |
|---|---|
| `20260913213712_household_project_sharing.sql` | `20260914172539_bob_household_project_sharing` |
| `20260913214355_household_account_sharing.sql` | `20260914172603_bob_household_account_sharing` |
| `20260914052752_volunteer_project_links.sql` | `20260914172820_bob_volunteer_project_links` |
| `20260914173410_sharing_rollout_hardening.sql` | `20260914174434_bob_sharing_rollout_hardening` |

`volunteer-media` is deployed ACTIVE v1 with `verify_jwt = false` intentionally; the function performs its own exact volunteer session/project capability checks before and after downloading private bytes.

A rollback-only hosted household authority proof confirms household Building editing and explicit project access, direct-only sharing administration, dynamic revocation, derived-crew non-authority and legacy-account isolation without persisting fixture grants. The ordinary post-merge [live foundation run 34876857240](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34876857240) proves organiser-created volunteer links, anonymous preview/join without an Auth identity, no-food allergy rejection, own task/check provenance, food-gated allergy + RSVP, exact private image bytes through `volunteer-media`, and immediate session/link revocation. [Pages 34876857611](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34876857611) is green on PR #61's merge.

**Explicit remaining external fixture:** production currently has no accepted Hearth friendship. Bob live-verifies denial when friendship is absent and rechecks friendship at invitation/acceptance, but the positive accepted-friend production path remains unexercised until a real accepted friendship exists. Do not fabricate or mutate Hearth friendship data merely to close this gate.

## Delivered executable-work readiness

**Status:** the first executable-work readiness foundation is implemented, merged, migrated, deployed and live-verified on 2026-09-15. PR #68 delivered product/runtime behavior; PR #70 added hosted proof; PR #73 closed release-fixture drift and recorded the checkpoint-FK index source.

Hosted migrations are:

| Source migration | Hosted registry |
|---|---|
| `20260915073000_executable_work_readiness.sql` | `20260915091153_bob_executable_work_readiness` |
| `20260915142646_executable_work_readiness_fk_index.sql` | `20260915143912_bob_executable_work_readiness_fk_index` |

The base release persists Task→Task/checkpoint dependencies, revisioned required tool/information needs and server-attributed readiness reviews. `current_task_readiness` derives named blockers from Area phase, manual task status, dependency/checkpoint state, canonical MaterialRequirement→Shopping state and required tool/information checks. Absence of blockers is only **unreviewed**; a human explicitly confirms `ready`, and newer readiness-source truth invalidates that confirmation.

PR #68's isolated suite passes 109+ domain/RLS tests and 320/390/1280 phase/readiness browser proof. Release hardening CI `34984048217` is green. The hosted performance advisor identified one checkpoint-FK covering-index gap; the follow-up index above clears that specific finding. Post-DDL security review reports no new readiness-specific finding.

The first post-#70 live run `34983414730` reached the new chain after facts/solutions/geometry/drawings/material/building had passed, then exposed **verification-fixture drift only**: the phase verifier assumed an earlier disposable task was still open even though another foundation proof had legitimately completed it. PR #73 made the phase projection proof self-contained; product phase/readiness semantics did not change.

Final [Pages 34984705428](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34984705428) and [live foundation run 34984705122](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34984705122) pass on release tree `59929f997741e41555d1faef0a95769df9eb86d9`. The ordinary authenticated hosted client proves explicit confirmation, phase/tool/information/dependency blockers, stale writes, task/checkpoint dependencies, canonical Shopping delivery, material-revision re-review, Today visibility, completion and project/raw/anonymous denial. The same run also passes sharing/name-only volunteer, Project/Area phase, material, drawing and Building-context proofs. No AI is invoked.

The final disposable project was `p_13c7166bfda04647ba1445e68f140438`, nonce `539e038f-853f-47a6-b7df-49b74dff53fb`. After normal image cleanup it was read-only checked for the exact verification name/description/type and zero media, then operator-deleted. Final counts are zero projects, material requirements, stock items, artifacts and media for that id.'''
text = replace_between(text, '## Household and project sharing — prepared source', '## Delivered deterministic material quantity (4B2b)', release, 'foundation release sections')
write(path, text)

# Current implementation inventory: replace stale sharing source status and add
# release deltas for lifecycle/readiness before the older deterministic section.
path = 'Docs/function-inventory.md'
text = read(path)
text = replace_once(
    text,
    'baseline before Slice 0 and milestones 1A/1B, 2A/2B, 2C, 3A, 4A, 4B1, 4B2a and the first narrow 4B2b calculator**.',
    'baseline before Slice 0 and milestones 1A/1B, 2A/2B, 2C, 3A, 4A, 4B1, 4B2a, the first narrow 4B2b calculator, household/name-only collaboration, Project/Area lifecycle and executable readiness**.',
    'inventory baseline marker',
)
inv_release = '''## Household/friend/name-only volunteer release delta — 2026-09-14

**Status:** household Building/project sharing and name-only volunteer participation are deployed/live-verified at current hosted fidelity. `db/README.md` owns authority and command semantics; `Docs/foundation-verification.md` owns exact release evidence.

| Capability | Current status |
|---|---|
| Existing household/friend authorities | **BUILT.** Bob reads active `shared` household access and accepted Hearth friendships only through guarded backend commands; it creates no parallel family/friend graph. |
| Household Building editing | **BUILT / LIVE.** Opted-in household members can edit ordinary accepted Building truth and accept proposals; direct Building members retain sharing administration and physical deletion. |
| Explicit project household audience | **BUILT / LIVE.** Project audience is explicit: private household choice, one household, or one exactly linked Building as source. Physical scope alone does not share project content. |
| Friend project invitations | **BUILT; positive live fixture externally pending.** Pending/accept/decline/revoke/leave lifecycle and missing-friend denial are deployed. Production has no accepted Hearth friendship, so the positive accepted-friend hosted case remains intentionally unexercised rather than fabricated. |
| Revocation / crew identity | **BUILT / LIVE.** Effective access is dynamic; derived crew rows are not permanent grants and independent access routes remain independent. |
| Legacy account isolation | **BUILT / LIVE boundary.** Account/notes use the explicit household boundary; the pristine legacy singleton remains unbound/inaccessible rather than being guessed. |
| Name-only volunteer | **BUILT / LIVE.** Link + name creates no Auth account; optional allergies are accepted only when food exists; own task/check/RSVP/profile actions, exact private media and immediate revocation are hosted-proven. |

## Project/Area lifecycle and executable-readiness release delta — 2026-09-15

**Status:** Project/Area lifecycle/scoped targets and the first executable-readiness foundation are merged, migrated, deployed and live-verified. Phase behavior is owned by `Docs/project-phases.md`; release evidence lives in `Docs/foundation-verification.md`.

| Capability | Current status |
|---|---|
| Project / Area lifecycle | **BUILT / LIVE.** Concept → Design → Planning → Build → Complete is explicit human-controlled state with audited reversible transitions and a Project completion guard. Legacy Areas remain unclassified until chosen. |
| Scope-safe selected targets | **BUILT / LIVE.** Project and Area pointers coexist; Area planning/drawings/material requirements bind to their relevant target scope without staling siblings. |
| Dependencies / checkpoints | **BUILT / LIVE.** Tasks can depend on another same-project task or checkpoint; cycles and stale/foreign writes are rejected. |
| Required tools / information | **BUILT / LIVE.** Revisioned task needs persist under guarded commands and appear as named readiness blockers until explicitly satisfied. |
| Canonical material readiness | **BUILT / LIVE.** Readiness consumes current MaterialRequirement→Shopping truth rather than duplicating material state; newer requirement truth invalidates prior review. |
| Explicit readiness | **BUILT / LIVE.** States are blocked / unreviewed / ready / complete. Clearing blockers never silently means Ready; a human confirms the current blocker-free plan. |
| Field surfaces | **BUILT / LIVE.** Task Detail exposes readiness, Area/Today prioritize ready work and retain explicitly Blocked work with named reasons. |
| Remaining executable-work scope | **PARTIAL.** Rich task scope/expected result, explicit work ordering/sequence and Bob-proposed human-confirmed work-breakdown generation remain next-slice work. |'''
text = replace_between(text, '## Household and friend sharing work — 2026-09-13', '## Deterministic geometry/material source status — 2026-09-14', inv_release, 'inventory release block')
repls = [
    ('Generated proposals, broader material/BOM rules, executable-work planning and structured progress/as-built history retain later gates.', 'Generated proposals, broader material/BOM rules, remaining work-breakdown generation and structured progress/as-built history retain later gates; explicit readiness is delivered.'),
    ('Broader calculators and downstream task readiness remain later.', 'Broader calculators remain later; executable readiness now consumes the canonical material state downstream.'),
    ('Generated proposal/mockup imagery, broader material rules and executable task planning remain later.', 'Generated proposal/mockup imagery, broader material rules and remaining task-scope/work-breakdown generation remain later; explicit readiness is delivered.'),
    ('Broader BOM rules, fasteners/consumables, task-material links, dependencies/tools/readiness and Bob/vision consumption remain later gates.', 'Broader BOM rules, fasteners/consumables, remaining work-breakdown/guidance and Bob/vision consumption remain later gates; dependency/tool/material readiness is delivered downstream.'),
]
for old, new in repls:
    if old in text:
        text = text.replace(old, new, 1)
write(path, text)

# Scope owner stays a prioritisation document, but record which part of the
# executable-work bucket is now shipped so later sessions do not rebuild it.
path = 'Docs/function-scope.md'
text = read(path)
marker = '# 8. Executable task plan\n'
note = '''
> **Implementation delta — 2026-09-15:** explicit Task→Task/checkpoint dependencies, required tool/information needs, canonical material readiness, named blockers and human-confirmed Ready are implemented and hosted-live-verified. The scope table below still owns prioritisation; richer task scope/expected result, explicit sequence/order and Bob-proposed human-confirmed work-breakdown generation remain open.
'''
text = replace_once(text, marker, marker + note, 'function scope readiness note')
write(path, text)

# DB map: promote sharing/volunteer status and add the deployed readiness model.
path = 'db/README.md'
text = read(path)
old_status_start = '> **Status:** specified / implementation in progress, 2026-09-13.'
status_end = '[`Docs/user-stories.md`](../Docs/user-stories.md) owns BOB-US-038 and BOB-US-059.'
i = text.find(old_status_start)
j = text.find(status_end, i)
if i < 0 or j < 0:
    raise SystemExit('db sharing status block not found')
new_status = '''> **Status:** implemented, merged, migrated and live-verified at current hosted fidelity. Source migrations `20260913213712_household_project_sharing.sql`, `20260913214355_household_account_sharing.sql`, `20260914052752_volunteer_project_links.sql` and `20260914173410_sharing_rollout_hardening.sql` are hosted as `20260914172539_bob_household_project_sharing`, `20260914172603_bob_household_account_sharing`, `20260914172820_bob_volunteer_project_links` and `20260914174434_bob_sharing_rollout_hardening`. PR #61 owns rollout hardening/hosted proof; `Docs/foundation-verification.md` owns exact evidence. The only explicit external-fixture limitation is the positive accepted-Hearth-friend production path because production currently has no accepted friendship; Bob does not fabricate Hearth data for verification.

'''
text = text[:i] + new_status + text[j:]
text = text.replace('extending the deployed Slice 0 baseline\nbelow when the new migration is applied.', 'extending and superseding the relevant deployed Slice 0 authority baseline below.', 1)
text = text.replace('### Legacy account boundary — release gate', '### Legacy account boundary — deployed', 1)
text = text.replace('The sharing rollout must replace that\nposture before exposing new friend access to the account shell. Source is prepared\nin `supabase/migrations/20260913214355_household_account_sharing.sql`; it is not yet\napplied or live-verified.', 'The sharing rollout replaces that posture before exposing new friend access to the account shell. `supabase/migrations/20260913214355_household_account_sharing.sql` is applied on hosted Supabase and the unbound/inaccessible legacy boundary is live-verified.', 1)
text = text.replace('Hosted application,\ndenied-access checks and normal-user binding/read-back proof remain release gates;\nprepared source does not establish that deployed account records are private.', 'Hosted denial and isolation checks are release-verified. A positive household binding remains a deliberate normal-user action for an eligible active household; no first-user/project/household fallback exists.', 1)
text = text.replace('**Prepared source, not deployed (2026-09-14).**', '**Deployed / live-verified at current hosted fidelity (2026-09-14).**', 1)
text = text.replace('Deploy\nthis function after the migration and before the frontend; global anonymous Auth\ndoes not need enabling. Loaded bytes already received cannot be recalled.', '`volunteer-media` is deployed ACTIVE v1 after the migration with this capability boundary; global anonymous Auth does not need enabling. Loaded bytes already received cannot be recalled.', 1)
text = text.replace('The household/friend extension above specifies the newer authority model; its source is not yet a deployment claim.', 'The deployed household/friend extension above supersedes the relevant authority parts of this older baseline.', 1)
text = insert_after_line(text, '| material stock / requirement revisions |', '| executable work readiness | `bob.task_dependencies`, `bob.task_needs`, `bob.task_readiness_reviews`; invoker `bob.task_dependency_status`, `bob.task_material_readiness`, `bob.current_task_readiness`; guarded `bob.work_plan_command` |', 'db map readiness row')
readiness_db = '''## Executable work readiness foundation

The first executable-work readiness foundation is deployed/live-verified. Source migration `supabase/migrations/20260915073000_executable_work_readiness.sql` is hosted as `20260915091153_bob_executable_work_readiness`; covering-index follow-up `supabase/migrations/20260915142646_executable_work_readiness_fk_index.sql` is hosted as `20260915143912_bob_executable_work_readiness_fk_index`.

`bob.task_dependencies` stores same-project Task→Task or Task→checkpoint prerequisites with cycle protection. `bob.task_needs` stores revisioned required `tool` / `information` checks. `bob.task_readiness_reviews` records explicit server-attributed human Ready confirmation. Security-invoker views expose dependency status, canonical material/Shopping readiness and one current readiness projection without duplicating MaterialRequirement truth.

Normal clients read these views under project RLS and mutate readiness only through guarded `bob.work_plan_command`. Clearing blockers yields `unreviewed`, never implicit `ready`; explicit confirmation is valid only for the current source fingerprint and is invalidated by newer dependency/need/material truth. Manual task `blocked` state remains separate and is itself a named blocker. `src/data/workPlan.ts` is the app adapter behind `database.ts`.

`Docs/v1-plan.md` owns the remaining executable-work release scope (richer task scope/expected result, explicit ordering and human-confirmed work-breakdown semantics). `Docs/foundation-verification.md` owns CI/browser/Pages/hosted proof and cleanup evidence.'''
text = replace_between(text, '## Wiring the app to it', '## Slice 0 membership and project policies', readiness_db + '\n\n## Wiring the app to it', 'db readiness section')
write(path, text)

# Documentation routing/status.
path = 'Docs/index.md'
text = read(path)
text = insert_after_line(text, '| material requirements, deterministic quantities, stock/reuse and Shopping handoff |', '| Project/Area lifecycle and phase-aware workstreams | `Docs/project-phases.md` + `Docs/project-phase-ui.md` |\n| task dependencies, tools/information needs and readiness | `Docs/v1-plan.md` → Executable work plan + `db/README.md` → Executable work readiness foundation + `src/data/workPlan.ts` |', 'index start rows')
text = text.replace('`db/README.md` → Household and friend sharing — specified/in-progress shared household/friend dependencies, explicit project access sources, invitation lifecycle, revocation and legacy account isolation; no deployed sharing claim until its release evidence is recorded.', '`db/README.md` → Household and friend sharing — deployed household/project authority, invitation/revocation and account isolation. The positive accepted-friend hosted case remains externally fixture-limited until production Hearth has an accepted friendship.', 1)
text = text.replace('`src/data/sharing.ts` — guarded household/project/friend-sharing adapter behind `database.ts`; its presence does not establish hosted RPC availability.', '`src/data/sharing.ts` — deployed guarded household/project/friend-sharing adapter behind `database.ts`; hosted authority/revocation evidence is recorded in `Docs/foundation-verification.md`.', 1)
text = text.replace('`src/data/volunteers.ts` + `src/pages/VolunteerProject.tsx` — prepared project-only guest capability adapter and name-only participant view; no Auth account registration.', '`src/data/volunteers.ts` + `src/pages/VolunteerProject.tsx` — deployed/live-verified project-only name-only participant capability; no Auth account registration.', 1)
text = insert_after_line(text, '- `Docs/material-planning.md` + `src/data/materialPlanning.ts`', '- `src/data/workPlan.ts` — deployed task dependency/tool/information/readiness adapter; server truth is exposed through RLS/security-invoker views and guarded `bob.work_plan_command`.', 'index data workPlan')
text = text.replace('- `Docs/material-planning.md` — **deployed 4B2a + first 4B2b material-planning contract** for manual requirements, the narrow `stud_wall_net_area` deterministic quantity, stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff. Broader BOM/fastener/consumable rules remain later scope until explicitly modelled.', '- `Docs/material-planning.md` — **deployed 4B2a + first 4B2b material-planning contract** for manual requirements, the narrow `stud_wall_net_area` deterministic quantity, stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff.\n- `Docs/project-phases.md` + `Docs/project-phase-ui.md` — **deployed lifecycle/workstream contract and UI blueprint** for explicit Project/Area phases, scope-safe planning context and phase-aware field surfaces.\n- `Docs/domain-dictionary.md` — canonical Bob/human terminology across Project, Area, Task, physical context, evidence, planning and readiness.', 1)
text = text.replace('`src/pages/AreaDetail.tsx` — tasks, materials, crew and reference-image surface.', '`src/pages/AreaWorkstream.tsx` — phase-aware Area workstream home with tasks, materials, images, planning links and readiness context.', 1)
text = text.replace('`Docs/foundation-verification.md` — media/steps, measurements/components, solution/target, plans/drawings, deterministic material planning and persistent building-context release evidence, deployed migrations, live Auth/PostgREST/Storage checks and limitations.', '`Docs/foundation-verification.md` — release evidence for media/steps, measurements/components, solutions/scoped targets, drawings/material planning, Building context, sharing/name-only volunteers, Project/Area phases and executable readiness.', 1)
write(path, text)

# Phase UI blueprint: readiness is no longer future-only.
path = 'Docs/project-phase-ui.md'
text = read(path)
text = replace_once(text, 'Future readiness behavior:', 'Current readiness behavior (delivered by the executable-work readiness foundation):', 'phase UI readiness heading')
old = '- if an explicitly scheduled task is not ready, label the reason rather than hiding it mysteriously.\n\nNo phase rail. No project setup controls.'
new = '- if an explicitly scheduled task is not ready, label the reason rather than hiding it mysteriously.\n\n`current_task_readiness` now supplies this state: blocker-free work remains **unreviewed** until a human confirms Ready, and newer dependency/need/material truth invalidates that review. Today keeps manually Blocked work visible with named reasons.\n\nNo phase rail. No project setup controls.'
text = replace_once(text, old, new, 'phase UI readiness note')
write(path, text)

# Adjacent domain-owner wording: these capabilities remain outside those models,
# but they are no longer globally absent.
path = 'Docs/material-planning.md'
text = read(path)
text = text.replace('- automatic task readiness;', '- task-readiness rules inside material planning; the deployed executable-work foundation consumes saved requirement/Shopping truth downstream;', 1)
text = text.replace('`Docs/v1-plan.md` owns release order and later executable-work-plan/broader-calculator gates;', '`Docs/v1-plan.md` owns release order, the remaining executable-work contract and broader-calculator gates;', 1)
write(path, text)

path = 'Docs/artifacts.md'
text = read(path)
text = text.replace('- task-material relations, dependencies, tools or readiness;', '- task-material/dependency/tool/readiness ownership inside the Artifact model; the deployed executable-work foundation consumes Artifact/material truth downstream;', 1)
write(path, text)

# Sanity assertions: no stale deployment-status phrases should survive in owners.
checks = {
    'Docs/v1-plan.md': ['Current next release milestone:** complete the hosted rollout', 'richer task/material/dependency/tool/readiness relations that turn'],
    'db/README.md': ['specified / implementation in progress, 2026-09-13', 'Prepared source, not deployed (2026-09-14)', 'source is not yet a deployment claim'],
    'Docs/function-inventory.md': ['**Status:** specified / implementation in progress.', '**Prepared source; browser and hosted delivery pending.**'],
    'Docs/project-phase-ui.md': ['Future readiness behavior:'],
}
for file, stale in checks.items():
    body = read(file)
    for phrase in stale:
        if phrase in body:
            raise SystemExit(f'{file}: stale phrase remains: {phrase}')

print('Sharing/readiness release docs patched successfully')
