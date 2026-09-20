import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2'
import { MEDIA_BUCKET, MEDIA_COLUMNS, readImageResponse, type MediaRow, type MediaTransport } from './media.ts'

/** Caller JWT for BOTH metadata and private object download. No service-role domain reads. */
export function createMediaTransport(client: SupabaseClient<any, any, any>, opts: {
  projectId: string; url: string; key: string; authHeader: string; fetcher?: typeof fetch;
}): MediaTransport {
  const value = <T>(r: { data: T | null; error: unknown }): T => {
    if (r.error || r.data === null) throw new Error('unavailable')
    return r.data
  }
  const base = () => client.from('media_assets').select(MEDIA_COLUMNS)
    .eq('project_id', opts.projectId).eq('state', 'ready')
  return {
    async count(signal) {
      const r = await client.from('media_assets').select('id', { count: 'exact', head: true })
        .eq('project_id', opts.projectId).eq('state', 'ready').abortSignal(signal)
      if (r.error || r.count === null) throw new Error('unavailable')
      return r.count
    },
    async list(input, signal) {
      if (input.area_id) {
        value(await client.from('areas').select('id').eq('project_id', opts.projectId).eq('id', input.area_id).abortSignal(signal).maybeSingle())
      }
      let q = input.area_id ? client.from('media_assets')
        .select(MEDIA_COLUMNS + ',target:media_links!inner(area_id)').eq('project_id', opts.projectId)
        .eq('state', 'ready').eq('target.area_id', input.area_id) : base()
      if (input.query) q = q.ilike('title', '%' + input.query.replace(/[\\%_]/g, c => '\\' + c) + '%')
      if (input.after_id) q = q.gt('id', input.after_id)
      // Conditional select strings have different SDK-inferred shapes. The
      // adapter independently validates every returned row before disclosure.
      return value<unknown>(await q.order('id').limit(13).limit(26, { referencedTable: 'media_links' }).abortSignal(signal)) as MediaRow[]
    },
    async read(id, signal) {
      const r = await base().eq('id', id).limit(26, { referencedTable: 'media_links' }).abortSignal(signal).maybeSingle()
      if (r.error) throw new Error('unavailable')
      return r.data as unknown as MediaRow | null
    },
    async download(row, signal) {
      // Path has already been validated by the adapter. Check again at the I/O boundary.
      if (row.project_id !== opts.projectId || row.bucket_id !== MEDIA_BUCKET || row.object_path !== `${opts.projectId}/${row.id}`) throw new Error('unavailable')
      const path = row.object_path.split('/').map(encodeURIComponent).join('/')
      const response = await (opts.fetcher ?? fetch)(`${opts.url.replace(/\/$/, '')}/storage/v1/object/authenticated/${MEDIA_BUCKET}/${path}`, {
        headers: { apikey: opts.key, Authorization: opts.authHeader }, signal, redirect: 'error', cache: 'no-store',
      })
      if (response.headers.get('content-type')?.split(';')[0].trim() !== row.content_type) {
        await response.body?.cancel(); throw new Error('unavailable')
      }
      return readImageResponse(response, row.byte_size, signal)
    },
  }
}
