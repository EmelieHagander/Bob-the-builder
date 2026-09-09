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
- Direct OpenAI tool continuation through the existing shared service. Model
  response ids stay server-side within one question. Access is rechecked before
  model calls and before releasing the result.
- AI assessment and consulted-record provenance in chat. Legacy display values
  retain unknown verification. No measurements, decisions or AI writes are added.
- Project/auth changes clear the drawer state and invalidate late responses,
  including switching A → B → A. Stale selected project ids require a fresh choice.
- OpenAI is Bob's permanent provider, as recorded in the owning
  [AI contract](../supabase/README.md). `ask-bob` is the new endpoint;
  `ask-launchpad` is only a 410 retirement response with no downstream calls.
- CI now drives the production frontend through sign-in, source disclosure,
  denied/unavailable/wrong-project responses, A → B → A during a delayed answer,
  draft reset, reload and sign-out at 320, 390 and 1280px. HTTP services are fixtures.
  Long source ids wrap, and send/close controls have 44px touch targets.

## Local and CI evidence — 2026-09-09

[CI run 34394120867](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34394120867)
passed on `84a17756e90c64aa9c2d8b3bdd12329ae5f02c7d`: nine tests, both edge
entry points, production builds, PWA checks, both installation browser flows and
the new Ask bob browser suite. The screenshots are retained in its
`installation-screenshots` artifact alongside the earlier PWA screenshot.

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
| Edge type check | Passed in CI for `ask-bob` and the retirement endpoint | Local dependency fetch was unavailable |
| Ask bob browser flow | Passed `verify:project` at 320, 390 and 1280px, including reachable 44px controls and no drawer overflow | Real production frontend; fixture Auth/PostgREST/AI responses, not a live provider test |
| Interactive visual pass | Local preview rejected by the cloud browser; downloaded CI screenshot URL returned HTTP 403 | CI screenshots exist, but have not been manually inspected in this session |

Reproduce the automated suite with `npm ci`, `npm test`, `npm run build` and
`npm run check:edge`. Dependencies are pinned for PGlite, tsx, Deno and the
Supabase migration CLI. CI runs tests, edge type checking and the build.

For the Ask bob browser suite, build with `VITE_SUPABASE_URL=https://pwa-proof.invalid`
and `VITE_SUPABASE_ANON_KEY=installation-test-only`, then run `npm run verify:project`
with `CHROME_PATH` pointing to an installed Chrome. These settings are fixtures,
never production credentials. Existing installation/PWA browser gates are preserved.

The local CLI initially tried a newer Supabase binary that could not start in
this environment. CLI 2.81.3 successfully created the timestamped migration.
No production database or Supabase function was modified.

A read-only configuration check found Bob's `ask-bob`/`global` OpenAI settings
enabled and its selected catalogue model active. This confirms routing configuration,
not the deployed API key or the success of a real model call.

The first CI run passed the nine tests and exposed five diagnostics from two
pre-existing shared-service declarations: nullable estimated cost and an async
logger declared as returning void. This branch corrects only those generic type
annotations; service runtime behavior is unchanged. Sibling repository copies
were already at different versions and need their normal canonical sync; this
branch does not claim byte identity with every sibling.

## Remaining release gates

1. The user identified the intended confirmed account on 2026-09-09. It is already
   a member of Test. The migration now takes an operator-reviewed mapping and
   preserves both memberships in the same transaction as the uniqueness/policy
   change. Local tests pass for approved and rejected mappings. A private recovery
   snapshot of 18 affected tables (122 rows) passed exact local read-back.
   Applying the coordinated transaction is the remaining step.
2. Follow the coordinated rollout in [db/README.md](../db/README.md).
   A normal main merge automatically publishes Pages but does not apply SQL or
   deploy edge functions. This implementation PR must not be merged as a
   frontend-only release.
3. In an accessible preview/staging environment, verify real Supabase JWT/
   PostgREST positive and denied calls; invitation claim and new project creation;
   a real OpenAI tool call reaching an item outside the project-only briefing.
4. Repeat the now-passing CI project-switch flow after the coordinated rollout
   with real sessions, and inspect desktop/mobile source disclosure.
5. Confirm OpenAI model settings/key availability and deploy the retirement
   response at the old endpoint. Launchpad is retired, with no re-enable gate.

`Live Bob release check` runs when its workflow/script first reaches main, or on
manual dispatch. It signs in with the existing public guest account, proves the
real entré project is denied, creates a disposable project through the actual RPC,
and requires a real OpenAI answer whose source evidence includes an inserted material
outside the briefing. It prints only the fixture project id and safe result messages.
An operator must delete that exact fixture project afterwards; no project-delete
RPC or service key is introduced just to clean up a test. Real project memberships
must never be granted to the public guest for this check.

The original Slice 0 exit is retained. Local implementation evidence does not
turn the remaining deployed-provider/browser checks into completed work.
