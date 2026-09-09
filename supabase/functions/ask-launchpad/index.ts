/** Bob's authenticated project lookup endpoint. The URL is retained for client
 * compatibility; Slice 0 uses direct OpenAI and rejects legacy Launchpad runs.
 * Model settings/billing remain in the unchanged shared AI service.
 * Deploy only with the membership migration and matching frontend; see README. */
import { serveLaunchpad } from '../_shared/launchpad.ts'

Deno.serve(serveLaunchpad({ app: 'bob', dbSchema: 'bob' }))
