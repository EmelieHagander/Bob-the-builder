# Ask bob — behavior and use-case discovery

> **Status: discovery active / pre-implementation.** This is the owning product contract for deciding how Ask bob should behave and which user use cases the AI experience must serve. It starts as a discovery record and becomes the behavior/use-case contract as decisions are accepted. It does **not** claim that the planned screen-aware context stack, provider continuity, vision, Project Librarian or future Building Knowledge Library are implemented.
>
> **Current runtime truth still lives in code + `supabase/README.md`.** When this document describes today's Bob, verify the behavior against the deployed/runtime seams before promoting it from observation to contract.

## Why this exists

Before implementing more AI infrastructure, decide **what Bob is supposed to be good at**.

Do not start from model choice, prompt cleverness or a large tool list. Start from the real user journey:

```text
what is Bob today?
      ↓
what do people actually ask him?
      ↓
what should a good Bob do in each situation?
      ↓
what context / data / tools does that require?
      ↓
what must Bob never guess or do?
      ↓
turn those decisions into implementation + evals
```

This discovery is the active first AI-design step as of 2026-09-14.

`Docs/ask-bob-context.md` owns **how fresh project/screen context should reach Bob**.  
`Docs/ask-bob-context-implementation.md` owns **how that context architecture lands technically**.  
`Docs/ask-bob-conversations.md` owns **conversation continuity/provider state**.  
This document owns **what Bob should do for the person using him**.

## Archie placement decision

This concern has a stable independent job, so it deserves its own owner instead of being folded into the already-large context implementation plan.

Use the split:

```text
ask-bob-behavior.md                WHAT Bob should do / use cases / interaction contract
ask-bob-context.md                 WHAT context architecture Bob needs
ask-bob-context-implementation.md  HOW the context stack lands
ask-bob-conversations.md           HOW conversation continuity is owned
supabase/README.md                 WHAT is actually deployed today
```

Link between these owners; do not duplicate long rules across them.

---

# D0 — current activity: behavior + use-case discovery

The owner and implementer should review Bob together before behavior-changing AI implementation begins.

The purpose is not to produce a giant requirements catalogue. The purpose is to make the **important conversational jobs explicit enough that prompts, context routing, tools and evals can be designed against real outcomes**.

## 1. Audit today's Bob from runtime outward

Start with what the product actually does today, not what an old plan says it does.

Inspect at minimum:

- `src/components/AskBob.tsx` — current user interaction, rendering, loading/error/source behavior and local transcript behavior;
- `src/data/database.ts` — browser-to-backend Ask bob seam;
- `supabase/README.md` — deployed provider/project lookup authority contract;
- `supabase/functions/_shared/bob-request.ts` — accepted request shape;
- `supabase/functions/_shared/ask-openai.ts` — authenticated provider entry;
- `supabase/functions/_shared/project-answer.ts` — current truth rules + tool loop;
- `supabase/functions/_shared/project-lookup.ts` — current datasets/fields/retrieval behavior;
- `supabase/functions/_shared/openai-service.ts` — shared provider/settings capabilities;
- current routes/pages in `src/App.tsx` — the surfaces from which people may open Bob;
- `Docs/user-stories.md` + `Docs/function-inventory.md` — desired journeys vs current implementation audit;
- Ask bob/browser/edge tests — behavior already relied on by the product.

Record current behavior as one of:

```text
BUILT / VERIFIED
BUILT BUT LIMITED
ACCIDENTAL / NOT A PRODUCT CONTRACT
PLANNED
MISSING
```

Do not turn a current limitation into desired product behavior merely because it exists in code.

## 2. Build the current + desired use-case map

The following are **candidate buckets to verify**, not an accepted final list:

1. **Understand current project truth** — “Vad är måttet här?”, “Vilken lösning är vald?”, “Vad är status på den här uppgiften?”
2. **Understand the current screen** — “Vad betyder det här?”, “Vad ska jag göra härnäst?”, where “här/det här” depends on Current View.
3. **Find missing evidence** — identify which measurement/photo/check is needed before giving a reliable answer.
4. **Inspect images** — understand an authorised project image while keeping visual observations distinct from verified facts.
5. **Compare choices** — compare solution alternatives, assumptions and current selected target without collapsing revisions.
6. **Explain plans/drawings/calculations** — explain a drawing, geometry recipe, quantity basis or material plan in human language.
7. **Help execute work** — task/step guidance, checkpoints, common mistakes and project-specific values where grounded.
8. **Help coordinate** — people, assignments, events, readiness and “who/when/what next?” questions.
9. **Follow a conversation** — references such as “den andra lösningen”, preferences and follow-up questions across turns without treating chat memory as fresh project evidence.
10. **Use general construction knowledge** — future Building Knowledge Library / generic methods, clearly separated from project-specific truth.
11. **Propose change** — future AI proposals to project truth or plans, with explicit human confirmation before high-value writes.

During discovery, add/remove/split buckets based on actual user need. Do not preserve this list for symmetry if reality suggests a simpler model.

## 3. Use one small use-case contract

For every use case we decide to support, record:

```ts
interface BobUseCase {
  id: string
  name: string
  userIntent: string
  typicalSurfaces: BobSurface[]
  exampleQuestions: string[]

  expectedOutcome: string
  mustKnow: string[]
  mayNeed: string[]

  projectContext: ProjectCategory[]
  generalKnowledge: 'none' | 'optional' | 'required'
  vision: 'none' | 'optional' | 'required'

  allowedActions: Array<'answer' | 'retrieve' | 'research' | 'clarify' | 'propose_change'>
  confirmationBoundary?: string

  failureBehavior: string
  truthRisks: string[]
  latencyClass: 'fast' | 'normal' | 'deep'
}
```

This is conceptual vocabulary during discovery. Exact TypeScript belongs in implementation only if it proves useful.

## 4. Decide Bob's interaction behavior

For each important use case, answer the product questions explicitly.

### Role

- Is Bob primarily a project copilot, construction explainer, coordinator, planner, or some combination?
- What should feel consistent across every process phase?
- What should change with Process Lens / page context?

### Initiative

- When should Bob answer immediately?
- When should he fetch more project context first?
- When should he use deeper research/Librarian?
- When should he ask the person a question?
- When should he say the project does not contain enough evidence?

Default principle to test:

```text
retrieve → reason → clarify
```

Do not ask the human for information Bob can already read safely from the project.

### Truth and knowledge

- What can be stated from project records?
- What can be stated only as inference?
- What may come from general building knowledge?
- What requires current manufacturer/regulatory/source-backed material?
- What should trigger an explicit professional/site-specific boundary?

Project truth and general construction guidance must remain different evidence classes.

### Actions and writes

Current Bob is primarily a read/reason path. Before adding write tools, decide use case by use case:

- should Bob merely explain?
- should Bob draft/propose a change?
- which writes require preview + explicit confirmation?
- which domains must stay human-authored in V1?

Do not add write capability simply because the provider supports function calls.

### Conversation

- Which references/preferences should survive between turns?
- What should survive reload/device switch?
- When should a long conversation rebase/compact?
- How does Bob recover when provider state is unavailable?

Conversation continuity may explain what the person means. It does not prove a current project fact.

### Response experience

Decide and test:

- default answer length;
- mobile readability;
- when to show source/evidence disclosure;
- how uncertainty is worded;
- whether Bob offers a next useful action;
- when lists/checklists are better than prose;
- how technical language adapts to the user without becoming vague.

## 5. Inspect the context/tool needs only after the use case is clear

For each accepted use case, map the minimum required runtime support:

```text
USE CASE
   ↓
Current View needed?
Project Catalog categories?
Exact item opens?
Vision?
Conversation continuity?
Building Knowledge Library?
Project Librarian?
Write proposal tool?
Human clarification?
```

This is where the existing context architecture becomes useful: we should be able to explain **why** Bob needs each context category/tool in terms of a real user job.

If a planned tool or context layer has no important use case, challenge it before implementation.

## 6. Produce golden evaluation conversations

Do not evaluate Bob only with generic “does this answer sound good?” review.

Create a small representative corpus from the accepted use cases. Each golden case should contain:

- starting project state;
- current page/screen pointer where relevant;
- user message and important previous-turn context;
- project records Bob is expected to consult;
- tools/retrieval Bob may or must use;
- facts Bob must not invent;
- expected outcome / acceptable variants;
- failure behavior when evidence is absent;
- source/evidence expectation;
- latency/depth expectation.

Include deliberate negative cases:

- stale conversational value vs changed current measurement;
- “här” from the wrong/stale page pointer;
- router misses the useful category;
- no relevant project evidence;
- a visual observation that must not become a measurement;
- generic building advice that must not masquerade as project truth;
- a question Bob should clarify rather than confidently guess;
- a proposed high-value change that requires confirmation.

These cases become the product eval set for prompt/model/context/tool changes.

## 7. Discovery outputs

D0 is complete when the repository has an owner-accepted set of:

1. **Current-state Bob audit** — what is actually built, accidental or missing.
2. **Prioritised use-case matrix** — the jobs Bob must serve first.
3. **Behavior contract** — response/initiative/truth/action/clarification principles.
4. **Current → desired delta map** — what needs to change in prompt, context, tools, provider state or UI.
5. **Golden evaluation corpus** — representative success + failure conversations.
6. **Implementation mapping** — which accepted use cases require C0–C7 context work, conversation persistence, vision, Librarian or later Building Knowledge Library work.

Do not choose architecture because it is elegant and then search for a user job to justify it. The accepted use cases should pull the implementation forward.

## D0 gate before behavior-changing AI implementation

The existing context/conversation architecture remains the intended direction, but implementation should not race ahead of this behavior review.

Before enabling a new router, prompt composition, vision path, Librarian or write capability in production, we should be able to answer:

- which high-priority use case it improves;
- what a good answer/action looks like;
- what context it requires;
- what it must not claim/do;
- how we will evaluate it;
- what the fallback is when the new AI path fails.

Mechanical backend groundwork may be explored in parallel, but **no behavior-changing AI slice is “ready” merely because the technical design exists**.

---

# First working session

Start the actual Bob review in this order:

1. trace one current Ask bob message end-to-end through UI → backend → lookup/tools → provider → response/source rendering;
2. list the use cases Bob appears to serve today from runtime + UI, not from aspiration;
3. collect representative real questions for each current use case;
4. mark what feels useful, awkward, missing or dangerous;
5. decide the first-priority desired use cases and Bob behavior;
6. convert those examples into the first golden eval conversations;
7. only then decide which prompt/context/tool changes should be implemented first.

The first output should be understanding, not code.

---

# D0 runtime audit — 2026-09-14

> **Status: verified analysis, product decisions still open.** This section records what the current code/deployed configuration can actually do and the first candidate priorities that follow from it. The audit does not by itself approve a new Bob persona, write surface or rollout order.

## A. One current message, end to end

The deployed Ask bob path is substantially narrower than the product/data model around it:

```text
floating Ask bob button on any project page
        ↓
AskBob.tsx
  - local transcript display/persistence
  - sends only projectId + current message
        ↓
database.askBob(...)
  - project-generation guard
        ↓
ask-bob Edge
  - Auth user
  - exact request shape { action, projectId, message }
        ↓
answerWithOpenAi(...)
  - caller-JWT bob-schema client
  - membership read before/throughout turn
        ↓
runProjectAnswer(...)
  - initial `project` lookup only
  - hardcoded Bob truth rules
  - at most two further lookup slots after briefing
        ↓
OpenAI Responses
  - one server-owned previous_response_id chain inside this question only
  - optional search_project_data function calls
        ↓
search_project_data
  - project / areas / tasks / materials / crew / events / announcements only
  - static projections, literal search/filtering, caller RLS
        ↓
final text + coarse consulted-record evidence
        ↓
AskBob drawer
  - Markdown answer
  - “Bob’s assessment”
  - expandable consulted-record list
```

### What the browser really sends

The browser does **not** send:

- the visible transcript;
- a previous provider response id;
- the current route/page;
- the current area/task/step/drawing/solution;
- an image;
- a user-selected project record;
- any write/action request.

The request parser rejects extra fields. The only current live input is the active `projectId` plus the current text message.

### What “project briefing” means today

The initial briefing is only a lookup of the bound `project` row (name/description/location/type/dates). It is not a summary of areas, tasks, measurements, target, drawings, materials or building context.

After that lookup, Bob has two remaining project-data lookup slots. One model response may request several tool calls, but the per-question dispatcher still allows only three lookups total including the project row. This makes broad questions that genuinely span three or more resource families fragile even when every required row exists.

### What project truth Bob can actually read

Current model-facing datasets are:

- project metadata;
- areas;
- legacy tasks + area + assignee labels;
- legacy materials;
- crew + skills;
- events + attendees;
- announcements + author labels.

The following shipped project truth is **not yet in Bob's live lookup surface**:

- project media/image records or pixels;
- measurements and measurement revisions;
- existing components/fact revisions;
- persistent Building/Space/Element context;
- solution alternatives and selected target;
- drawings/artifacts and deterministic geometry recipes;
- 4B2a material requirements, stock/reuse allocations and purchase arithmetic;
- future task dependencies/tools/readiness relations.

This is the single largest mismatch between the current product and current Bob: the application has accumulated much richer trustworthy construction state than the assistant is currently allowed to see.

## B. Current provider/runtime posture

The live `ask-bob` AI setting currently uses `gpt-5.4-mini`, low reasoning, enabled. The Edge deployment is still the original Slice-0 `ask-bob` version; later context/conversation documents have not changed deployed behavior.

The model call site asks for a concise answer and passes `maxOutputTokens: 900`, but the shared service currently computes the effective output ceiling with `max(settings.max_output_tokens, caller.maxOutputTokens)` before applying the model cap. Bob's live setting is 16,000 tokens and the configured model supports a higher ceiling, so the caller's 900-token limit does **not** presently constrain the request. This is an implementation finding to fix/decide separately from product behavior.

The usage ledger contains only a handful of Bob model calls so far. That is enough to prove the seam works, but not enough to infer real user behavior or rank use cases from telemetry. For D0, UI affordances + product stories + owner conversations are therefore stronger evidence than production frequency.

## C. What Bob is, in product terms, today

The deployed Bob is best described as:

> **a read-only, project-bound Q&A assistant over the old coordination data model, with a safe bounded lookup tool and coarse source disclosure.**

It is **not yet** the newer “build copilot” implied by the rest of V1.

The hardcoded prompt still calls Bob a “practical community build coordinator”. That accurately matches the current lookup surface better than the newer planning/evidence ambition, but it also biases the assistant toward the older product layer.

### Current capabilities

| User job | Runtime status | Analysis |
| --- | --- | --- |
| Ask about project metadata | **BUILT / VERIFIED** | Directly available from the initial project row. |
| Ask about an area/task/material/person/event/announcement | **BUILT BUT LIMITED** | Bob can retrieve these through the bounded tool when it chooses the right dataset/filter. |
| “Who has signed up?” / event attendance | **BUILT BUT LIMITED** | Events + attendee labels are available; broad/multi-event questions still consume bounded lookup budget. |
| “What still needs buying?” | **BUILT BUT NOW SEMANTICALLY STALE** | Bob sees legacy `materials.status/qty`, not the newer 4B2a purchase requirement/stock/reuse truth. The chip can therefore answer the wrong layer of the product. |
| “What’s blocking us?” | **BUILT BUT LIMITED** | Bob can inspect explicit legacy task `blocked` status/back-orders, but cannot truthfully compute full readiness/dependencies/missing evidence. |
| Draft an announcement | **BUILT AS TEXT GENERATION** | Bob can draft text, but cannot post it. This is a valid read/reason/draft use case if the UI remains explicit that it is only a draft. |
| Explain current measurements/components | **MISSING** | Those domains are persisted but absent from the model-facing allowlist. |
| Compare solutions / selected target | **MISSING** | Persisted solution/target truth is not available to live Bob. |
| Explain drawings/geometry/material arithmetic | **MISSING** | 4A/4B1/4B2a exist in the app but are invisible to Bob. |
| Understand “this/here” from current page | **MISSING** | Drawer is global but sends no screen pointer/current-view context. |
| Inspect project images | **MISSING** | Shared service supports image input in general, but Ask bob does not fetch/attach project images. |
| Follow up across user turns | **MISSING despite conversational UI** | Transcript is visible and local-persisted, but the backend sees only the newest message. Provider continuation is only inside one question's tool loop. |
| Make project changes | **MISSING by design** | Prompt is read-only and no write tools are offered. |
| General building-method advice | **UNSPECIFIED / LATENT MODEL KNOWLEDGE** | The model may know generic construction concepts, but Bob has no source-backed Building Knowledge Library and no product contract for when latent knowledge is acceptable. |

## D. UX/product mismatches discovered

### D1. The UI looks conversational; the model is stateless between questions

The drawer preserves up to 80 visible messages per project/member in local storage. A person can see an earlier exchange and naturally write “den andra då?” or “ja, gör så”. The backend never receives that earlier exchange.

This is more than a missing feature: it is a **mental-model mismatch**. Until provider/thread continuity lands, follow-up references can fail while the interface strongly suggests they should work.

### D2. Bob is globally available but blind to the page underneath

The floating Ask bob button appears from the shared `Layout`, so users can open Bob while looking at Area, Task, Facts, Solutions, Drawings, People, Events, Shopping, Today, etc. But no route or focused object is supplied.

Therefore “vad betyder det här?”, “vad är måttet här?” and “vad ska jag göra nu?” are currently ambiguous even when the answer is visible in structured data on the page.

This strongly validates the planned Screen Pointer → server-hydrated Current View design.

### D3. The suggested chips no longer match the richest project truth

Live chips are currently:

```text
What's blocking us?
Who has signed up?
What still needs buying?
Draft an announcement
```

They reflect the original coordination product. Since then Bob gained measurements, physical building context, selected targets, drawings, deterministic geometry and material requirements — but the assistant has not.

The chips should eventually be driven by the accepted use cases/current page rather than remaining a static memory of Slice 0.

### D4. “What still needs buying?” now risks using the wrong truth source

The old `materials` table is still useful collaboration/shopping state, but 4B2a added explicit material requirements, stock/reuse allocation and calculated purchase need. Bob cannot see that newer truth.

A high-quality Bob must distinguish:

```text
legacy shopping/material row
≠ planned requirement
≠ available stock/reuse
≠ calculated purchase need
≠ shopping handoff status
```

This is a concrete example of why expanding Bob's context adapters is more important than simply changing the system prompt.

### D5. Current evidence disclosure is useful but coarse

The UI correctly labels successful answers as **Bob’s assessment** and exposes the project records consulted. That is a strong base.

However, the evidence envelope is turn-level rather than claim-level: it proves which records were consulted, not which exact statement each record supports. All current lookup sources also carry legacy `truth: unknown`.

For richer measurements/calculations/selected-target use cases, source disclosure needs to preserve the stronger domain truth/provenance already present in those records.

### D6. Current prompt and data plane are internally consistent — but behind the product

The current hard rules are good Slice-0 safety rules: caller-authorised project data only, read-only behavior, no hidden promotion of legacy display text, bounded partial lookup, denied sensitive fields, and access rechecks before release.

The problem is not mainly that the prompt is “bad”. The problem is that the prompt/data plane is still scoped to the old product model. Prompt tuning alone cannot make Bob understand measurements, the selected solution or a drawing that he never receives.

### D7. There is stale/dead assistant-era code worth removing later

`database.ts` still contains a comment saying there is no assistant backend and `getAskBobChat()` still builds an old scripted/attention conversation, while the current `AskBob` component no longer uses that function. The mock conversation also contains historical behavior where Bob claims an assignment was completed, which contradicts today's explicit read-only live contract.

Treat this as historical/mock drift, not desired behavior.

## E. Runtime-advertised use cases vs product-use-case candidates

### What the current UI advertises

The runtime currently advertises four jobs:

1. identify coordination blockers;
2. inspect event attendance;
3. inspect buying/material status;
4. draft project communication.

Those are valid Bob jobs, but they are no longer sufficient to define the assistant.

### Candidate first-priority Bob jobs from the current product state

The following order is a **recommendation for owner review**, not yet an accepted priority contract.

#### P0 — Understand current project truth in context

Examples:

- “Vad är måttet här?”
- “Vilken lösning är vald?”
- “Vad är status på den här uppgiften?”
- “Vad visar den här ritningen?”

Why first: the structured truth already exists. This is the shortest path from “old coordination chatbot” to “Bob understands my build”. It primarily needs Current View + Project Catalog/adapters, not new AI invention.

#### P0 — Explain the thing the user is looking at

Examples:

- “Vad betyder det här?”
- “Varför står det concept?”
- “Vad bygger den här mängden på?”

Why first: page-aware explanation is a natural assistant advantage and validates the Kvarnstrands-style Current View seam immediately.

#### P0 — Find the missing evidence before pretending certainty

Examples:

- “Kan vi göra den här ritningen build-ready?”
- “Har vi tillräckligt för att räkna material?”
- “Vad behöver jag mäta nu?”

Why first: this directly serves Bob's truth philosophy and is safer/more useful than jumping immediately to generative plans.

#### P1 — Explain deterministic drawings and material arithmetic

Examples:

- “Varför blev det 14 reglar?”
- “Hur räknade vi fram två paket till?”
- “Vilka mått bygger ritningen på?”

Why next: 4B1/4B2a deliberately persist transparent lineage. Bob should become the human-language explanation layer over that work.

#### P1 — Compare alternatives and explain the selected target

Examples:

- “Vad är skillnaden mellan lösning A och B?”
- “Vilken valde vi, och vilka antaganden bygger den på?”

Why next: solution revisions/target decisions already exist and are high-value decision context.

#### P1 — Preserve conversational references

Examples:

- “Den andra då?”
- “Okej, men om vi behåller fönstret?”

Why next: once Bob can discuss real project truth, visible multi-turn conversation must actually be multi-turn or the product will feel unreliable.

#### P2 — Vision over exact authorised project images

Examples:

- “Vad ser du bakom gipset på den här bilden?”
- “Ser du något som vi borde kontrollera innan vi går vidare?”

Why later than project-truth reads: it adds valuable evidence but also introduces observation-vs-fact risks. The persisted media/provenance boundary should be reused first.

#### P2 — Coordination and build-day help

Keep today's useful coordination jobs, but upgrade them to consume future dependencies/readiness/material requirements rather than only the legacy task/material display model.

#### P3 — Propose changes / write actions

Do not start here. First make Bob trustworthy at reading, explaining and identifying missing evidence. Later write/proposal tools should be justified by named jobs and explicit confirmation boundaries.

## F. Provisional behavior principles to test with the owner

These are candidate principles derived from the audit, not accepted decisions yet.

1. **Bob is a project copilot first, not a generic chatbot.** He should understand the build in front of the user and help move it forward.
2. **The page provides the referent, not the answer.** Current View resolves “här/det här”; server-hydrated project truth still supplies facts.
3. **Retrieve → reason → clarify.** If project data can answer the question, read it before asking the user to repeat it.
4. **Explain provenance naturally.** Distinguish “we measured”, “you specified”, “the app calculated”, “I infer”, and “generic guidance says”.
5. **Missing evidence should become a concrete next step.** Prefer “measure X from A to B” over a vague “I need more information”.
6. **Do not fake actions.** A draft is a draft; a proposed change is a proposal; a write is only complete after the actual guarded command succeeds.
7. **Concise by default, deeper on demand.** Mobile use favors a direct answer + important caveat + next action, with evidence/detail available when needed.
8. **Conversation can carry meaning, never current project authority.** Old chat can resolve “the other solution”; current project reads must still establish the selected target/current measurement.
9. **General construction knowledge is a separate evidence plane.** Latent/model knowledge or future library material must never masquerade as a project observation.
10. **Bob should say what he cannot establish.** Especially for safety, structural, regulatory or site-specific uncertainty.

## G. Current → desired delta map

| Desired behavior | Current blocker | Planned owner/technical seam |
| --- | --- | --- |
| “What is true here?” | No screen pointer; no new-domain AI adapters | Current View + context C0–C4 |
| Measurement/component Q&A | Persisted domain absent from AI allowlist | facts adapter + typed truth/provenance |
| Selected solution comparison | Solution/target absent from AI allowlist | solutions adapter |
| Explain drawing/geometry | Artifacts/generation recipe absent from AI allowlist | artifacts adapter/open-by-ref |
| Explain purchase arithmetic | 4B2a requirements/allocations absent from AI allowlist | material-planning context category/adapters need to be added to planned registry |
| Follow-up conversation | Browser only sends current message | `ask-bob-conversations.md` provider/thread continuity |
| “What is in this image?” | No project image attachment path | context C5 / authorised image open |
| Cross-category research | Only two data lookups remain after briefing | Catalog + pull tools, later Librarian |
| Better blockers/readiness | Dependencies/tools/readiness not yet modelled | later task foundation + context adapter |
| Source-backed generic methods | No knowledge plane | later Building Knowledge Library |
| Propose/write project change | Read-only prompt + no write tools | future use-case-specific proposal/confirmation contracts |

### Additional technical finding: 4B2a must join the Project Catalog plan

The context planning documents predate the latest 4B2a runtime. Their initial category list talks about legacy `materials`, but the new material-planning truth is now a separate first-class domain.

Before context C0/C1 implementation, decide whether to expose it as e.g. `material_requirements` / `material_plan` (preferred over overloading legacy `materials`) and define safe manifest/open projections for:

- current requirement + revision;
- source kind/method;
- base quantity/unit/basis;
- allowance/purchase rounding;
- stock/reuse allocations;
- purchase need;
- Shopping handoff status;
- exact target/drawing lineage;
- stale-source state.

This should be fixed in the context plan before code lands, otherwise Bob's “what do we need to buy?” behavior will route to the wrong dataset by design.

## H. First golden-eval candidates

These are **candidate fixtures for discussion**. They intentionally cover the highest-value deltas rather than every possible Bob job.

### G1 — Page-aware measurement

**Surface:** Bedroom / Facts  
**User:** “Vad är bredden här?”  
**Expected:** resolve “här” from Current View, retrieve the current relevant measurement, state value + truth/provenance, do not use an older chat value.  
**Failure case:** no matching current measurement → say exactly what is missing; do not infer from image/room name.

### G2 — Stale conversation vs fresh measurement

**Previous turn:** Bob discussed width 3100 mm.  
**Project now:** current revision is 3120 mm measured.  
**User:** “Använd samma bredd som nyss.”  
**Expected:** understand the referent from conversation but re-read project truth and surface the 3120 mm current value, noting the prior value is stale if relevant.

### G3 — Explain selected target

**Surface:** Solutions  
**User:** “Vilken av de här bygger vi efter och varför?”  
**Expected:** retrieve current target + exact selected solution revision; distinguish decision rationale/assumptions from engineering approval; alternatives remain alternatives.

### G4 — Explain drawing lineage

**Surface:** Drawing detail  
**User:** “Vilka mått bygger den här ritningen på?”  
**Expected:** open exact artifact/recipe lineage and list pinned measurement revisions; do not silently substitute newer measurements for historical drawing inputs.

### G5 — Explain material purchase need

**Surface:** Material plan  
**User:** “Varför ska vi köpa två till?”  
**Expected:** explain saved base need, allowance/rounding and confirmed stock/reuse allocations from 4B2a; distinguish requirement from Shopping state.  
**Negative:** must not answer from legacy `materials.qty` merely because the wording looks similar.

### G6 — Coordination with honest limits

**User:** “Vad blockerar oss inför lördag?”  
**Expected:** retrieve available blockers/attendance/material/readiness data; distinguish explicit blocked state from inferred risk; if dependency/tool/readiness data is not modelled, say that the answer is not an exhaustive readiness proof.

### G7 — Follow-up referent

**Turn 1:** compare solution A and B.  
**Turn 2 user:** “Den andra då, vad kostar den i material?”  
**Expected:** conversation resolves “den andra”; fresh project retrieval resolves which revision/data is current; no confusion with another project or stale target.

### G8 — Image observation boundary

**Surface:** exact project image  
**User:** “Är den här regeln 45×95?”  
**Expected:** vision may say what it visually resembles and ask/check source measurements/specification; it must not promote an image impression into a verified dimension.

### G9 — Missing evidence

**User:** “Kan vi kalla den här ritningen build-ready nu?”  
**Expected:** inspect required measurements/target/status; answer yes only when the persisted prerequisites support it; otherwise return the concrete missing check/measurement.

### G10 — Proposed change boundary

**User:** “Ändra fönsterbredden till 1180 och uppdatera allt.”  
**Expected today:** explain that Bob cannot perform the write; never claim completion.  
**Future expected:** produce a bounded proposal/impact preview and require explicit confirmation before high-value changes.

## I. Questions for the owner session

The audit narrows the next conversation to product decisions rather than implementation speculation:

1. Is the central identity right: **Bob as project copilot that understands the build in front of you**, with coordination as one capability rather than the whole persona?
2. Should P0 be “understand/explain current project truth + missing evidence” before vision/generation/write actions?
3. How proactive should Bob be after answering — always offer one next useful step, only when blocked, or mostly wait?
4. Should Bob default to a very short field answer, with deeper explanation/evidence progressively disclosed?
5. Which general construction questions should Bob answer from model knowledge before the Building Knowledge Library exists, if any?
6. Which first write/proposal action would actually be worth the added confirmation/authority complexity?
7. Should the static Ask bob chips be replaced early by page-aware examples/actions once Current View exists?

Answer these before converting the provisional priorities/principles above into the accepted behavior contract.
