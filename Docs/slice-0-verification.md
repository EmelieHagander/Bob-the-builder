# Slice 0 — implementation and verification

Status: **Slice 0 deployed; live OpenAI lookup verified** on 2026-09-09. PR #23 (the lookup contract) was
merged into main at `ab9158cfe07077ee0b52dac5271754e2bdaaef92` before this work.
The release also incorporates PR #24's installation changes from main
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
| Membership transition | Orphan preflight rejects; links preserved; confirmed invitations and atomic creator membership work | Reviewed mapping is now applied; the Test membership remains intact |
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
The following deployment section records the subsequent production changes.

A read-only configuration check found Bob's `ask-bob`/`global` OpenAI settings
enabled and its selected catalogue model active. This confirms routing configuration,
not the deployed API key or the success of a real model call.

The first CI run passed the nine tests and exposed five diagnostics from two
pre-existing shared-service declarations: nullable estimated cost and an async
logger declared as returning void. This branch corrects only those generic type
annotations; service runtime behavior is unchanged. Sibling repository copies
were already at different versions and need their normal canonical sync; this
branch does not claim byte identity with every sibling.

## Deployment evidence — 2026-09-09

- PR #25 merged as `5289c72d7fa0a86ff6252ab3a33b796dbe70fe3e` after the
  [final implementation CI](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34399066415)
  passed all gates. The [Pages release](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34399374166)
  completed successfully.
- The hosted registry records `20260909200654_bob_project_scope_and_bounded_lookup`.
  Its reviewed mapping linked the intended confirmed account to the entrance
  project while retaining Test. The repository source keeps its CLI authoring timestamp.
- `ask-bob` v1 is active with Auth verification; `ask-launchpad` v15 is the
  retirement response. OpenAI is the sole provider path.
- Hosted SQL checks under `authenticated` and the intended user's claims show
  both projects and the entrance materials. Guest claims show zero projects.
  These checks exercise hosted RLS, not an Auth HTTP login.
- All 122 pre-existing rows are identical after the migration; exactly one new
  member row was added. The private recovery snapshot passed exact local read-back
  for all 18 affected tables. It also preserves the previous edge bundle and
  relevant schema/policy/grant metadata; it is not a full shared-database backup.
- Bob's advisor errors/warnings were cleared. The remaining informational
  [no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  is intentional for `person_emails`: all client access is revoked, and only the
  guarded internal invitation functions read it. Other apps were not modified.

## Live OpenAI release check

The [live release check](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34400203806)
passed on `5ebb9b62ee15455ba9d4d5f2ff0ec1d6925ef727`, as did the
[Pages deployment](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34400203811).
It proved actual password authentication, denied entrance access (403), legacy
endpoint retirement (410), project creation and member-scoped material read-back,
then a real OpenAI tool call whose source evidence included the inserted material
outside the project-only briefing. The answer contained its recorded quantity, 37.

Two test setup errors were corrected before that pass: Node 20 lacked native
WebSocket for Supabase 2.110.2 (PR #26 moved the check to Node 24), and the fixture
used `missing` instead of the existing `needed` material status. Neither required
a change to the deployed app or edge functions. Both disposable projects were
subsequently removed, including their member/material rows. Only the two real
projects and their intended memberships remain.

`Live Bob release check` signs in with the existing public guest account, proves
entrance access is denied, creates a disposable project through the actual RPC,
and requires an OpenAI answer whose source evidence includes an inserted material
outside the briefing. It prints only the fixture project id and safe result messages.
An operator removes that exact project afterwards; no deletion RPC or service key
is introduced just for test cleanup. Never grant the public guest access to a real
project to make a test pass.

## Verification limits

The actual browser project-switch flow passes at three widths with fixture HTTP
responses. Manual screenshot inspection and a browser walkthrough with the real
owner's signed-in session were unavailable in this environment. Invitation claim
edge cases are proven by the real local Postgres suite; they do not represent a
complete live multi-user invitation acceptance test.
