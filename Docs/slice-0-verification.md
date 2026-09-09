# Slice 0 — implementation and verification

Status: implementation branch, **not deployed**. PR #23 (the lookup contract) was
merged into main at `ab9158cfe07077ee0b52dac5271754e2bdaaef92` before this work.
The branch also incorporates PR #24's installation changes from main
`794fe0a925f24a81193bcc765127610ac66e9c02`; its CI gates are preserved.

## What changed

- Protected per-project membership using the existing people/Auth link; atomic
  project creation; verified-email invitation claims; member-scoped RLS and
  immutable project/parent/auth keys; both-end relation checks; invoker today view.
- Explicit active project through Ask bob, fixed SQL dataset projections, caller
  JWT, three lookups including briefing, row/join/byte/time limits and safe errors.
- Direct OpenAI tool continuation through the unchanged shared service. Model
  response ids stay server-side within one question. Access is rechecked before
  model calls and before releasing the result.
- AI assessment and consulted-record provenance in chat. Legacy display values
  retain unknown verification. No measurements, decisions or AI writes are added.
- Project/auth changes clear the drawer state and invalidate late responses,
  including switching A → B → A. Stale selected project ids require a fresh choice.
- Bob's previous Launchpad branch is disabled, including legacy status/reply/
  artifact handles. The gateway's current partner contract does not implement
  partner-provided lookup tools; no speculative manifest/callback was added.

## Local evidence — 2026-09-09

| Check | Result | Practical limit |
| --- | --- | --- |
| TypeScript project compilation | Passed (`tsc -b`) | Frontend/type checking, not deployment |
| Vite production build | Passed (114 modules, including PR #24) | Built without live database env |
| Postgres migration + RLS suite | Passed on PGlite with real SQL/roles/RLS | Auth claims/users are fixtures; not hosted Supabase/PostgREST |
| Seven lookup projections | Passed: fixed fields, same-project joins, literal text search | No model-generated SQL |
| Positive/negative authority | Own project works; non-member/anonymous denied; cross-project keys/links rejected; view obeys RLS | Role-specific organiser permissions are outside Slice 0 |
| Membership transition | Orphan preflight rejects; links preserved; confirmed invitations and atomic creator membership work | Existing entré project still needs reviewed mapping |
| Limits/errors | Parent/join/UTF-8 byte caps, malformed args, timeout, empty vs error, lookup budget and revoked access tested | Does not benchmark large production datasets |
| HTTP → tools → SQL → answer | Passed using the actual request/answer dispatcher and real Postgres lookup | Model transport is deterministic fixture; **no live OpenAI call claimed** |
| Two-project reads and response generation | Separate results; A → B → A/sign-out invalidate old callbacks | Not a browser interaction test |
| Edge type check | Local attempt blocked fetching existing shared-service `esm.sh` import | CI runs the real Deno check |
| Visual/browser pass | Not completed: cloud browser rejected local preview with `ERR_BLOCKED_BY_CLIENT` | Must run in an accessible preview before release |

Reproduce the automated suite with `npm ci`, `npm test`, `npm run build` and
`npm run check:edge`. Dependencies are pinned for PGlite, tsx, Deno and the
Supabase migration CLI. CI runs tests, edge type checking and the build.

The local CLI initially tried a newer Supabase binary that could not start in
this environment. CLI 2.81.3 successfully created the timestamped migration.
No production database or Supabase function was modified.

## Remaining release gates

1. Review the intended authenticated member mapping for
   `p_bygga_in_entren` (currently zero links). Preserve all real data and intended
   collaborators. Apply the mapping separately before the policy migration.
2. Follow the coordinated rollout in [db/README.md](../db/README.md).
   A normal main merge automatically publishes Pages but does not apply SQL or
   deploy edge functions. This implementation PR must not be merged as a
   frontend-only release.
3. In an accessible preview/staging environment, verify real Supabase JWT/
   PostgREST positive and denied calls; invitation claim and new project creation;
   a real OpenAI tool call reaching an item outside the project-only briefing.
4. Drive Ask bob in project A, switch to B during a slow request, then back to A.
   Verify project title, fresh chat/draft, no old result, readable source disclosure,
   and usable desktop/mobile controls.
5. Confirm model settings/key availability on the direct path before switching
   off the old deployed provider. Launchpad remains unsupported until its own
   project workspace, run binding and lookup integration have live proof.

The original Slice 0 exit is retained. Local implementation evidence does not
turn the remaining deployed-provider/browser checks into completed work.
