/*
 * ask-launchpad — bob's window to the Launchpad builders team.
 *
 * A thin per-app deployment of the shared Launchpad client (_shared/
 * launchpad.ts). Everything app-specific is the one line below: the app
 * identity is pinned HERE, in source, at deploy time — never taken from the
 * request — so this function can only ever reach bob's own Launchpad
 * workspace. A sibling app gets its own copy of this file under its own
 * function slug with its own app name.
 *
 * Deploy:   supabase functions deploy ask-launchpad --project-ref <ref>
 * Secrets:  see supabase/README.md (LAUNCHPAD_* function secrets)
 */

import { serveLaunchpad } from '../_shared/launchpad.ts'

Deno.serve(serveLaunchpad({ app: 'bob' }))
