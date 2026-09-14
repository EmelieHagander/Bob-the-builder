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
