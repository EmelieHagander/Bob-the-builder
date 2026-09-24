import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { createVolunteerMediaHandler, type VolunteerImage } from '../_shared/volunteer-media-request.ts'

// This service client never reaches the browser. The capability RPC chooses the
// only permitted object; request-supplied bucket/path values are not accepted.
const url = Deno.env.get('SUPABASE_URL')
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
Deno.serve(createVolunteerMediaHandler({
  authorize: async (session, taskId, mediaId, drawing) => {
    if (!client) return null
    const result = drawing
      ? await client.schema('bob').rpc('volunteer_drawing_media', { p_secret: session, p_task: taskId, p_media: mediaId, p_drawing: drawing.id, p_revision: drawing.revision })
      : await client.schema('bob').rpc('volunteer_media', { p_secret: session, p_task: taskId, p_media: mediaId })
    return result.error ? null : result.data as VolunteerImage
  },
  download: async image => {
    if (!client) return null
    const result = await client.storage.from(image.bucket).download(image.path)
    return result.error ? null : result.data
  },
}))
