import type { ContextAdapter, Item, ListRequest, Opened } from './dispatcher.ts'

export const MEDIA_BUCKET = 'bob-project-media'
export const MEDIA_MAX_BYTES = 6 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MEDIA_COLUMNS = 'id,project_id,title,purpose,content_type,byte_size,width,height,state,created_at,updated_at,bucket_id,object_path,media_links(area_id,task_id,step_id)'
export type MediaRow = {
  id: string; project_id: string; title: string; purpose: string; content_type: string;
  byte_size: number; width: number; height: number; state: string; updated_at: string; created_at: string;
  bucket_id: string; object_path: string; media_links?: { area_id: string | null; task_id: string | null; step_id: string | null }[];
}
export interface MediaTransport {
  count(signal: AbortSignal): Promise<number>
  list(request: ListRequest, signal: AbortSignal): Promise<MediaRow[]>
  read(id: string, signal: AbortSignal): Promise<MediaRow | null>
  download(row: MediaRow, signal: AbortSignal): Promise<Uint8Array>
}
function imageId(ref: string): string {
  const id = ref.startsWith('image:') ? ref.slice(6) : ''
  if (!UUID.test(id)) throw new Error('unavailable')
  return id.toLowerCase()
}
function checked(row: MediaRow | null, projectId: string, id?: string): MediaRow {
  if (!row || !UUID.test(row.id) || (id && row.id !== id) || row.project_id !== projectId || row.state !== 'ready' || row.bucket_id !== MEDIA_BUCKET || row.object_path !== `${projectId}/${row.id}`) throw new Error('unavailable')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(row.content_type) || !Number.isInteger(row.byte_size) || row.byte_size < 1 || row.byte_size > MEDIA_MAX_BYTES) throw new Error('unsupported_image')
  if (![row.width, row.height].every(n => Number.isInteger(n) && n > 0 && n <= 20000) || row.width * row.height > 48000000) throw new Error('unsupported_image')
  if (typeof row.title !== 'string' || row.title.length > 200 || typeof row.updated_at !== 'string') throw new Error('unavailable')
  return row
}
function item(row: MediaRow): Item {
  return { ref: `image:${row.id}`, title: row.title, purpose: row.purpose,
    width: row.width, height: row.height, created_at: row.created_at, updated_at: row.updated_at,
    links: (row.media_links ?? []).slice(0, 25).map(l => ({ area_id: l.area_id, task_id: l.task_id, step_id: l.step_id })),
    links_truncated: (row.media_links?.length ?? 0) > 25 }
}
function version(row: MediaRow): string { return `${row.updated_at}:${row.content_type}:${row.byte_size}:${row.width}x${row.height}` }
export function validImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)
  if (mime === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'
  return false
}
function base64(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(value)
}
/** Existing immutable-upload media model, caller-owned transport. No AI descriptions, database writes or persistent pixel cache. */
export function createMediaAdapter(projectId: string, transport: MediaTransport): ContextAdapter {
  return {
    category: 'images', prefix: 'image', count: transport.count,
    async list(request, signal) {
      if (request.after_id && !UUID.test(request.after_id)) throw new Error('invalid_cursor')
      const rows = await transport.list(request, signal)
      const safe = rows.slice(0, 13).map(r => checked(r, projectId))
      return { items: safe.slice(0, 12).map(item), next_cursor: safe.length > 12 ? safe[11].id : null }
    },
    async open(ref, signal): Promise<Opened> {
      const id = imageId(ref), row = checked(await transport.read(id, signal), projectId, id)
      const bytes = await transport.download(row, signal)
      if (bytes.byteLength !== row.byte_size || !validImageSignature(bytes, row.content_type)) throw new Error('invalid_image')
      const current = checked(await transport.read(id, signal), projectId, id)
      if (version(current) !== version(row)) throw new Error('context_changed')
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
      const sha256 = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
      return { item: { ...item(row), sha256 }, bytes: bytes.byteLength, version: version(row),
        image: { type: 'image_url', image_url: `data:${row.content_type};base64,${base64(bytes)}` },
        source: { projectId, dataset: 'image_pixels', recordId: id, label: `Bild öppnad: ${row.title}`,
          retrievedAt: new Date().toISOString(), updatedAt: row.updated_at, truth: 'unknown' } }
    },
    async current(ref, expected, signal) {
      try { const id = imageId(ref); return version(checked(await transport.read(id, signal), projectId, id)) === expected }
      catch { return false }
    },
  }
}
/** Bound the actual stream, not merely a mutable Content-Length / database size. */
export async function readImageResponse(response: Response, expected: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || !response.body || expected < 1 || expected > MEDIA_MAX_BYTES) throw new Error('unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > expected || total > MEDIA_MAX_BYTES) throw new Error('image_too_large')
      chunks.push(value)
    }
    if (total !== expected) throw new Error('image_size_changed')
    const result = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { result.set(c, offset); offset += c.length }
    return result
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
