/*
 * ask-launchpad — bob's window to whichever AI backend is configured.
 *
 * A thin per-app deployment of the shared Ask seam (_shared/launchpad.ts):
 * the Launchpad builders team when the LAUNCHPAD_* secrets are set, otherwise
 * OpenAI answering directly from bob's own data.
 *
 * Everything app-specific is the one line below, and both values are pinned
 * HERE, in source, at deploy time — never taken from the request:
 *
 *   app       bob's Launchpad workspace identity, and how AI settings and
 *             spend are attributed in the shared `ai` schema.
 *   dbSchema  the Postgres schema the briefing is read from. Pinned for the
 *             same reason as `app`: a browser must never be able to point
 *             this at a sibling app's data.
 *
 * A sibling app gets its own copy of this file under its own function slug.
 *
 * Deploy:   supabase functions deploy ask-launchpad --project-ref <ref>
 * Secrets:  see supabase/README.md
 */

import { serveLaunchpad } from '../_shared/launchpad.ts'

Deno.serve(serveLaunchpad({ app: 'bob', dbSchema: 'bob' }))
