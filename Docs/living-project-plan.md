# Living project plan — steps, completion requirements and replanning

**Status: specified / not built.**

This document owns Bob's future **living project-plan model**: how a build moves from an idea through dynamic steps, how a step knows what is still missing, how evidence such as measurements/photos/drawings/material state satisfies those needs, who owns the work, and how Bob proposes changes as reality changes.

It does **not** replace the shipped task/readiness model, project facts, media, artifacts, material planning or collaboration authority. Those remain the runtime owners for what is built today. This contract defines the product model they should converge toward.

Related owners:

- [User stories](user-stories.md) — what users should be able to achieve.
- [Project facts](project-facts.md) — measurements/components and their provenance/history.
- [Media and steps](media-and-steps.md) — stored project images and current manual task-step behavior.
- [Artifacts](artifacts.md) — versioned drawings/plans and source lineage.
- [Material planning](material-planning.md) — requirements, stock/reuse and Shopping handoff.
- [Ask Bob tools](ask-bob-tools.md) — tool discovery/execution authority.
- [Ask Bob context](ask-bob-context.md) — runtime project-context selection.
- [Data/auth](../db/README.md) — current project membership, sharing and volunteer authority.

---

## 1. Product thesis

A build plan is **not a fixed checklist written once at project start**.

A useful construction plan is a versioned working model that becomes more precise as the project learns:

```
Idea
  ↓
initial design / investigation
  ↓
coarse future plan
  ↓
new measurements / discoveries / decisions
  ↓
revised active step + revised future plan
  ↓
build
  ↓
as-built evidence / further discoveries
  ↓
replan again when needed
```

Changing the plan because new evidence arrived is not an error. It is expected project behavior.

Bob's job is therefore not merely to generate tasks. Bob should help maintain an explicit answer to:

1. **Where are we now?**
2. **What does the current step aim to achieve?**
3. **What must be true before this step is complete?**
4. **Which requirements are already satisfied, missing, conflicting or stale?**
5. **Who is responsible for each piece of work?**
6. **What evidence supports completion?**
7. **What should happen next, given what we now know?**
8. **Has new information made the future plan worth changing?**

---

## 2. The project plan is dynamic data, not hard-coded construction phases

Bob may use ordinary construction concepts such as design, survey, demolition, framing, services, finishes and inspection when they make sense, but the database must not assume one universal sequence.

Different projects need different plans:

- hanging a shelf may need only a few steps;
- enclosing a veranda may require survey, design, ground/floor work, framing, openings, roof, weatherproofing and finishes;
- repairing a machine may use diagnosis → isolate fault → replace/test → reassemble;
- an old house renovation may discover hidden conditions that substantially change later work.

Therefore:

> **A project has a versioned ordered plan of Steps. Step kinds and completion requirements are data, not object-specific code paths.**

Bob can propose an initial plan from the user's idea and project/building context. Future steps may deliberately remain coarse until earlier uncertainty is resolved.

---

## 3. Core concepts

### 3.1 Project Plan

A Project Plan is the current approved sequence of project Steps plus its revision history.

It should retain at least:

- stable plan identity;
- revision;
- reason for the revision;
- actor/proposer;
- approval state;
- ordered step identities;
- source/evidence references used when proposing the revision;
- created/approved timestamps.

An approved revision becomes the current plan. Earlier revisions remain historical.

### 3.2 Step

A Step is a meaningful unit of project progress.

A step describes:

- **goal/result** — what should be achieved;
- **state** — e.g. planned / active / blocked / completed;
- **responsibility** — who owns the step or its requirements;
- **completion requirements** — what must be true before completion;
- **dependencies** — other steps/requirements that must precede it;
- **relevant context** — Area/Building/Space/Element/task/artifact references where applicable;
- **plan revision** — which approved plan introduced/currently defines it;
- **history** — prior versions and later changes.

A Step is not just a text task. It is the container for the state Bob needs to reason about project progression.

### 3.3 Completion Requirement

A Completion Requirement states one condition that should be satisfied before the step can be considered complete.

Examples:

- a dimension is known;
- a design choice is approved;
- a drawing exists at an accepted revision;
- a required photo has been captured;
- an inspection/check has been performed;
- a material requirement has been calculated;
- required material has been delivered;
- a task/action has been completed;
- a user has approved a proposal;
- a professional/site-specific check remains required.

Requirements should be **typed and structured**, while still allowing a human-readable description.

A requirement is not satisfied merely because matching words appear in a task description.

### 3.4 Evidence

Evidence is the project truth that satisfies or contradicts a requirement.

Evidence may include:

- Measurement / Project Fact revisions;
- photos/media;
- selected Solution revisions;
- Artifacts/drawings;
- material requirements;
- stock/purchase/delivery state;
- task/check completion;
- Building/Space/Element observations;
- explicit human approval;
- other typed future evidence.

The requirement keeps references to exact evidence identities/revisions where consequence warrants it.

### 3.5 Responsibility

Responsibility is explicit.

A Step or Completion Requirement may have an owner such as:

- Bob / AI;
- a signed-in project member;
- a household/friend collaborator with project authority;
- a registered project person;
- a name-only volunteer where their limited project capability permits it.

The model must distinguish:

- **responsible for doing/providing something**;
- **authorized to approve/change canonical project state**.

Assignment does not grant authority.

---

## 4. Completion is evidence-driven

The main state transition is:

```
missing
   ↓ evidence arrives
satisfied
```

But reality requires more states.

A useful minimum requirement state model is:

- **missing** — required evidence/result does not exist;
- **satisfied** — current acceptable evidence fulfills it;
- **conflicted** — multiple current facts disagree or the evidence is internally inconsistent;
- **stale** — the requirement was satisfied by evidence that is no longer current enough for the step;
- **waived** — explicitly removed/accepted as unnecessary by authorized decision;
- **not_applicable** — requirement became irrelevant because the plan changed.

The state should be derived where practical from project truth and explicit links, not maintained as an unrelated checkbox.

### Example — veranda measurement stop

Instead of a Step containing only:

> "Control-measure before cutting. 84 + 98 + 88 conflicts with 260."

the step can contain:

```text
Step: Verify existing geometry before detailed framing

Requirement: free wall width, left
Type: measurement
State: satisfied
Evidence: Measurement X revision 2 = 87 cm, recorded by Carl

Requirement: free wall width, right
Type: measurement
State: satisfied
Evidence: Measurement Y revision 2 = 83 cm, recorded by Carl

Requirement: reused door outer width
Type: measurement
State: satisfied
Evidence: Measurement Z revision 2 = 98 cm, recorded by Carl

Requirement: roof connection geometry
Type: measurement/check
State: missing
```

Bob no longer has to infer from an old paragraph whether the measurement work is still outstanding.

---

## 5. New facts, revisions and supersession

A new value does not always mean the old value should be deleted.

There are several distinct cases:

### Revision of the same observation

If the same measurement subject/reference is corrected or remeasured, it should use the existing Measurement identity and append a revision where possible.

The current revision becomes operational truth; older revisions remain historical.

### Refinement with a different reference definition

Sometimes a new measurement answers a more precise question than an older measurement.

Example:

- old: side distance including trim = 84 cm;
- new: free wall width excluding trim = 83 cm.

These are not automatically the same measurement identity.

The system should support relationships such as:

- **supersedes** — newer fact should be used instead of older operational fact for the stated purpose;
- **refines** — newer fact narrows/clarifies an earlier observation without pretending the original statement was false;
- **resolves** — evidence satisfies a Completion Requirement;
- **conflicts_with** — evidence disagrees and needs resolution.

Historical evidence stays available. Bob needs an explicit way to know which fact currently controls a requirement.

---

## 6. Initial planning by Bob

A project starts from an idea.

If the user chooses the AI-led route, Bob may propose an initial plan.

Bob should:

1. understand the desired outcome;
2. read relevant known project/building context;
3. identify major uncertainty;
4. propose a sequence of Steps;
5. define Completion Requirements for near-term steps;
6. keep distant steps appropriately coarse where information is not yet available;
7. assign proposed responsibilities where useful;
8. disclose important assumptions and unresolved professional/site-specific dependencies;
9. present the plan for approval before it becomes canonical where the change is consequential.

Bob should not create false precision in distant steps simply to make the plan look complete.

---

## 7. Replanning is a normal lifecycle operation

Bob may reconsider the plan at three important moments.

### When a Step starts

The project now knows more than when the future plan was first proposed.

Bob may review:

- new measurements;
- approved design;
- Building/site facts;
- current materials/stock;
- completed preceding work;
- newly discovered constraints.

Bob can propose changes to the active step and downstream steps.

### While a Step is active

New evidence may show that the step itself is incomplete or incorrectly scoped.

Bob may propose:

- adding/removing completion requirements;
- splitting the step;
- changing dependency order;
- changing responsibility;
- changing future steps.

The active step is allowed to evolve. The system should not treat this as project corruption.

### When a Step completes

Completion is a natural planning checkpoint.

Bob should be allowed to ask:

> Given what we learned in this step, is the remaining plan still the right plan?

If not, Bob creates a new proposed plan revision.

---

## 8. Plan changes require visible approval

Bob may reason and propose autonomously, but material plan changes must not silently rewrite the user's approved project.

A **Plan Change Proposal** should describe:

- what changes;
- why;
- which evidence caused the change;
- affected current/future Steps;
- affected completion requirements/responsibilities;
- important consequences for drawings/materials/Shopping/schedule where known.

The authorized user can:

- accept;
- reject;
- edit before acceptance.

Acceptance creates a new approved plan revision.

The UI/chat should make the replan explicit, e.g.:

> "The new roof measurements change the framing sequence. I propose moving roof connection design before wall cutting and adding one completion requirement to the current measurement step."

Bob does not need approval merely to **notice** that the plan may need changing. Approval applies to committing the consequential canonical change.

---

## 9. Completed Steps are historical truth

A completed Step should not be silently rewritten later.

If new information changes its interpretation, the system may:

- add a later corrective Step;
- propose reopening the completed Step;
- record that a later plan revision supersedes an assumption/output from the completed Step.

The original completion state and evidence remain traceable.

This supports future questions such as:

> "Why was this timber cut to this dimension?"

The answer should be able to follow the historical plan/evidence chain instead of reconstructing a story from current values.

---

## 10. Bob's working context should be a project story, not a database dump

This model changes what Storybook-style prompting should provide.

Bob should begin with a compact **working project briefing** in two levels:

```text
PLAN SPINE
✓ Step 1 — title
→ Step 2 — title
○ Step 3 — title
○ Step 4 — title

ACTIVE STEP WORKSPACE
Goal
Step Brief — Bob's compact self-prompt for this Step
Linked Tasks + operational status
Completion Requirements + evidence-derived state
Completion counts
Small recent-change signal/context
```

The Plan Spine always carries every current Step but only its identity/order/title/state. It is orientation, not a dump of future detail.

The Active Step Workspace is richer. The **Step Brief** is Bob's own concise working note: what this Step is for, what matters, important constraints and what to keep in mind. It is versioned with the Step and never outranks structured project facts, Tasks or Completion Requirement state.

This is the **story of the project state**.

It is not a replacement for tools.

Bob still uses project tools when the question requires exact detail:

- open the relevant Measurement revision;
- inspect a drawing;
- inspect material state;
- check a photograph;
- read downstream steps;
- compare a changed source.

There should be **no universal rule that Bob must always search measurements first**.

The desired behavior is:

1. the briefing tells Bob what kind of situation he is in;
2. Bob reasons about what information is relevant;
3. Bob chooses the appropriate tool/data source;
4. current project truth is available regardless of which collaborator created it.

---

## 11. Shared projects use one current project truth

Bob conversations remain private/thread-specific where appropriate.

Project truth does not.

If Carl records an authorized project measurement, that measurement is part of the same current project state Emelie sees.

A later Bob turn for another project member should not need access to Carl's private conversation to benefit from the resulting project fact.

Therefore:

- chat history explains references and intent;
- project records establish shared current state;
- the working project briefing is generated from shared project state;
- responsibility/provenance may identify who supplied evidence;
- data visibility still follows project/household/volunteer authority.

The actor who created a fact must not become an accidental visibility filter for that fact.

---

## 12. Relationship to current Tasks

The shipped `bob.tasks` model remains the executable-work runtime truth.

The product decision is now explicit:

- **Step and Task are separate entities.**
- A Step may organise/link many Tasks.
- **Step** answers: "what project result are we trying to get through?";
- **Task/action** answers: "what does a person/Bob actually do?";
- **Completion Requirement** answers: "what must be true before Bob may judge the Step complete?".

Task completion and Step completion are therefore intentionally different. A Step is not complete merely because every linked Task says done; its Completion Requirements still control the completion judgment. Conversely, a Requirement may be satisfied directly by evidence without a dedicated Task.

Task links are operational children of a stable Step identity rather than part of the immutable plan-revision decision. This lets Bob add or remove useful actions while working a Step without rewriting historical approved plan revisions. The current approved plan determines whether that stable Step is part of the active project story.

---

## 13. Relationship to current readiness

Current task readiness remains the shipped execution-safety/readiness mechanism.

Future Step completion is broader.

Examples:

- a task can be ready to perform while the parent Step is not complete;
- a Step may be blocked because a required decision or measurement is missing;
- a Step may be complete even though unrelated future materials are not purchased;
- a future task may not yet exist because the plan intentionally remains coarse.

Do not overload one readiness boolean to represent the entire living plan.

---

## 14. Versioning and authority principles

The future data design should preserve these invariants:

1. Project Plan revisions are immutable historical decisions.
2. Step identity should survive ordinary plan revisions where it is still conceptually the same Step.
3. Completion Requirements need stable identity and version/history where changes matter.
4. Evidence links pin exact source revisions when consequence warrants it.
5. Requirement state should not destroy contradictory/historical evidence.
6. Bob-generated plan changes preserve AI provenance.
7. Human approval is distinct from AI proposal.
8. Shared project facts are not thread-owned.
9. Assignment never widens authorization.
10. Completed history is not rewritten to make the present plan look cleaner.

Exact table/RPC names are **not decided by this product contract**.

---

## 15. Candidate lifecycle

A typical AI-led project may look like:

```
Idea
  ↓
Bob proposes Plan v1
  ↓ user approves
Step 1 active
  ↓ evidence / work
Step 1 complete
  ↓ Bob reviews future
Plan v2 proposed
  ↓ user approves
Step 2 active
  ↓ unexpected site condition
active Step revision proposed
  ↓ user approves
work continues
  ↓
...
  ↓
final Step complete
  ↓
project/as-built record
```

A user-led project may skip Bob's initial plan generation and create/edit the plan manually while still using the same Step / Completion Requirement / Evidence model.

---

## 16. Acceptance scenarios for a first implementation slice

These are product acceptance scenarios, **not passing-test claims**.

### A. Shared measurement satisfies another member's Step requirement

1. A Step has a missing measurement requirement.
2. Carl records the measurement through his authorized project access.
3. The requirement becomes satisfied or can be deterministically resolved to that evidence.
4. Emelie opens Bob in her own conversation.
5. Bob's project briefing says the requirement is satisfied.
6. Bob can inspect the exact measurement if needed.
7. Carl's private chat is never exposed.

### B. New measurement supersedes an obsolete working value

1. A Step is waiting on a dimension.
2. An older observation exists but is unsuitable/ambiguous.
3. A newer measurement is explicitly linked as superseding/refining it for this requirement.
4. The Step uses the newer value.
5. The older value remains visible in history.

### C. Bob revises future plan after measurement work

1. Design creates a coarse future framing plan.
2. Measurement Step completes.
3. New geometry makes one future Step unnecessary and requires a new roof-connection Step.
4. Bob proposes Plan v2 with reasons and affected Steps.
5. Nothing changes canonically until authorized acceptance.
6. Plan v1 remains inspectable.

### D. Active Step gains a new requirement

1. During an active framing-preparation Step, Bob discovers that roof geometry affects safe cutting.
2. Bob proposes adding a roof-geometry Completion Requirement to the active Step.
3. The change is visible and requires approval.
4. After approval, the Step remains active until that requirement is satisfied.

### E. Completed Step is not silently rewritten

1. A Step was completed using evidence valid at the time.
2. Later evidence shows corrective work is needed.
3. Bob proposes a corrective Step or explicit reopen.
4. Historical completion/evidence remains intact.

### F. Bob chooses tools from context rather than hard-coded lookup order

1. The briefing says the active Step is missing one roof measurement.
2. User asks "what's next?"
3. Bob recognizes the missing requirement from context.
4. Bob may inspect the relevant project fact/tool if exact detail is needed.
5. There is no global "always search measurements first" rule.
6. A different Step whose blocker is material delivery leads Bob toward material/Shopping data instead.

---

## 17. What is explicitly not decided yet

This document intentionally does not decide:

- exact SQL table/function names;
- whether Step replaces or contains current Task;
- the first database migration shape;
- exact UI presentation;
- automatic versus explicit evidence-matching thresholds;
- how broad semantic matching may be before human confirmation is required;
- whether plan approval can be delegated and at what authority levels;
- exact AI model/provider;
- construction-specific phase templates;
- code/permit/regulatory completion requirements.

Those belong to subsequent data/authority, Ask Bob runtime and UI contracts.

---

## 18. Implementation order implied by the model

A truthful implementation should probably proceed in slices:

1. **Plan / Step / Completion Requirement identity and revision model** with manual creation and evidence links.
2. **Requirement resolution from existing project facts** such as Measurements, decisions and images.
3. **Compact working-project briefing** consumed by Ask Bob.
4. **Bob plan/change proposals + approval flow**.
5. **Responsibility model** spanning Bob, members and permitted volunteers.
6. **Replanning checkpoints** on Step start/completion and relevant project changes.
7. Integration with drawings/material planning/Shopping/as-built evidence.

This ordering is guidance from the product model, not an approved release schedule.

---

## 19. Success condition

The model succeeds when Bob no longer has to reconstruct project status from stale prose.

At any point, Bob and the people building should be able to answer:

> **What are we doing now, what is still needed to finish this step, who owns it, what evidence do we already have, and what changed the plan?**

That shared answer is the living project plan.
