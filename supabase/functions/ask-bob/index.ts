/** Bob uses OpenAI directly. Deploy with the membership migration and matching
 * frontend; see supabase/README.md for the coordinated rollout. */
import { serveBob } from '../_shared/serve-bob.ts'

Deno.serve(serveBob())
