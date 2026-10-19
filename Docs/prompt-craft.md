# Prompt craft — slim, softcoded and story-led

> **Scope:** writing or substantially revising `CLAUDE.md`, Bob's coding
> subagents (`.claude/agents/*.md`) or runtime assistant prompts. This is an
> on-demand writing method, not a per-turn system prompt or a new authority
> surface. Exact product, AI and tool contracts stay with their owners.

## Three principles

**1. Stay slim.** Every always-loaded sentence costs attention on every
session. Say the job once; remove a sentence if removing it changes no
material decision or safe action. Current facts, incidents, schema,
migrations and full tool manuals belong in their owning documents, not
repeated in `CLAUDE.md` or agent prompts.

**2. Softcode, not hardcode.** Describe purpose, responsibility, good
judgement and the agent's working lane rather than enumerating scripts
and `ALWAYS/NEVER` reactions to past mistakes. A model should be able
to solve an unforeseen case by understanding its role. Keep exact
protocols and non-derivable safety/authority fences explicit.

**3. Storybook prompting.** Introduce a capable colleague to their
world: who they are, who needs them, what they can accomplish, what
neighbouring roles own and what a good result looks like. A coherent
role should make repeated behavioural instructions unnecessary; the
story does not rewrite permissions.

## Development instructions are prompts too

These principles also govern editing this repo's root `CLAUDE.md` and
every coding subagent, not only Bob's runtime persona. Keep the root
file a short map of shared purpose, authority and links. A specialist
prompt gives an identity, ownership lane, essential read paths and
handoff; it does not carry a duplicated domain specification.

Put exact paths, command names, schema fields, server-side authorization
and exceptional high-consequence boundaries where readers cannot infer
them. Put changing product truth in the existing canonical docs. A
rule absorbed into a role story must still make the previously forbidden
act impossible under that role; if it does not, keep the real fence.

## Autonomy is made possible by the system

A prompt saying `act autonomously` cannot expose an unavailable tool
or restore missing work. Before changing behaviour instructions after
a weak model result, investigate:

- **Access:** was the required capability offered, allowed and executable?
- **Context:** did the model receive the relevant source, state and history?
- **Execution:** did the operation return useful errors, save its work and resume reliably?
- **Outcome:** did the user obtain the complete, correct and verifiable result?

Repair the failing boundary. If all four are sound and the model still
judges poorly, revise the smallest role or tool explanation and compare
real user-task outcomes. Do not replace missing capability with more
rules, obligatory confirmations or extra classifiers.

Bob's authoritative tool surface is
[ask-bob-tools.md](ask-bob-tools.md); context, continuations and
completion are in [ask-bob-conversations.md](ask-bob-conversations.md);
observable product outcomes are in [user-stories.md](user-stories.md).
Keep this authoring guide separate from those implementation contracts.

## Provenance

Adapted locally from the owner-derived three principles documented in
Kvarnstrands (2026-09-10) and carried into the reusable
`template/project-start-kit/how-to/prompt-craft.md`. This Bob guide
owns its own authoring method; neither sibling repo is a runtime
dependency.
