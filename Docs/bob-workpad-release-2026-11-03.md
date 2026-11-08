# Bob private workpads and verified Konrad renewal — release 2026-11-03

**Status: production schema, catalog and matching Edge source installed; owner/model acceptance outstanding.**

- GitHub PRs: [#419](https://github.com/EmelieHagander/Bob-the-builder/pull/419) merged as `84521b9c036e08cdad8472695506b9a3d8c0b30f`, then [#420](https://github.com/EmelieHagander/Bob-the-builder/pull/420) as `97c4e81fcec78efebd6bc9ced58d3210693cf89a`.
- Live project: `yuobtgoidmmmwfqenkau`. The dedicated FoxAndMouse DatabaseAccess connection returned `https://yuobtgoidmmmwfqenkau.supabase.co`; no account or project was inferred from the generic Supabase connection.
- Read-only preflight found no queued/running Bob jobs, no existing workpad table/RPC, `build_workers_version=1` and `worker_checkpoint_version=1`.

## Exact installation order and hosted readback

| Source migration / runtime | Hosted version | Readback |
| --- | --- | --- |
| `20261103121713_bob_agent_workpads.sql` | `20261103121713` | Private table and RPC exist; RLS enabled; `anon` and `authenticated` have no direct SELECT grant. |
| `bob-worker` | v186, JWT verification **off** (existing capability auth) | Source bundle contains all 134 files; changed modules and private workpad file match source byte for byte. Bundle SHA-256 `a3a1ad5e2d5a35cfe4e39cf6b1e6c0062152b73841a22f3c9724e9ec79146203`. |
| `ask-bob` | v218, JWT verification **on** | Source bundle contains all 136 files; changed modules and private workpad file match source byte for byte. Bundle SHA-256 `82ce142d7adbd2e150ba8cef34933f52380c532a0dd5c7a64ff8805aee551dae`. |
| `20261103122145_bob_agent_workpads_catalog.sql` | `20261103122145` | `contract.workpad_version=1`, `bob.tools.workpad_version=1`, `tools.update_workpad` registered and policy active. |
| `20261103122214_bob_worker_verified_renewal_catalog.sql` | `20261103122214` | `worker_verified_renewal_version=1`; pre-existing worker-checkpoint and toolbox version pins preserved. |

The migration tool stamped new live history versions at application time. The
original draft filenames (`20261103120000`, `20261103121000`, `20261103122000`)
were therefore renamed to these **actual hosted versions**, with the SQL
unchanged. Future migration tooling must see the hosted versions rather than
trying to reapply the same table, tool, or catalog activation under draft dates.

The first `ask-bob` upload returned a transient internal deployment error; the
readback still showed old v217. Retrying the **same reviewed bundle** succeeded
as v218. `bob-worker` v186 was read back before deploying `ask-bob`.

The post-migration security advisor reported `rls_enabled_no_policy` (INFO) on
the new `bob_private` table. This is intentional: access is exclusively through
the service-only, current-claim-checked `bob.bob_agent_workpad` RPC; public and
member grants stay revoked. Other pre-existing advisor notices were not changed
by this release.

## What was deliberately not exercised

- No GitHub Actions, paid model calls, test suites, or real owner-message smoke
  tests. The owner chose to defer these during rapid development.
- No frontend GitHub Pages deploy: this is a server-side runtime/catalog release.
- No claim that saved construction geometry has passed approval just because a
  `saved` receipt or private note exists.

**Remaining acceptance:** in ordinary project conversations, observe a fresh
Konrad job after a real construction save, a later successful `update_workpad`,
an exact revision readback, and at most two renewed chains. Compare input-token
and checkpoint growth against the 2026-11-03 Ladan failure. A first construction
that has **not saved anything yet** cannot use this renewal; splitting that first
save into reliable smaller parts remains separate work.
