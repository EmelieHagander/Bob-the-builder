import type { ContextAdapter, Item, ListRequest, Opened } from './dispatcher.ts'

export const MEDIA_BUCKET = 'bob-project-media'
export const MEDIA_MAX_BYTES = 6 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MEDIA_COLUMNS = 'id,project_id,title,purpose,source_kind,content_type,byte_size,width,height,state,created_at,updated_at,bucket_id,object_path,media_links(area_id,task_id,step_id,plan_step_id)'
export type MediaRow = {
  id: string; project_id: string; title: string; purpose: string; content_type: string;
  byte_size: number; width: number; height: number; state: string; updated_at: string; created_at: string;
  bucket_id: string; object_path: string; source_kind?: string; media_links?: { area_id: string | null; task_id: string | null; step_id: string | null; plan_step_id?: string | null }[];
}
export interface MediaTransport {
  count(signal: AbortSignal): Promise<number>
  list(request: ListRequest, signal: AbortSignal): Promise<MediaRow[]>
  read(id: string, signal: AbortSignal): Promise<MediaRow | null>
  download(row: MediaRow, signal: AbortSignal): Promise<Uint8Array>
  descriptions?(ids: string[], signal: AbortSignal): Promise<{ media_id: string; source_version: string; description: string }[]>
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
  return { ref: `image:${row.id}`, project_id: row.project_id, title: row.title, purpose: row.purpose, source_kind: row.source_kind ?? 'unknown',
    width: row.width, height: row.height, created_at: row.created_at, updated_at: row.updated_at,
    links: (row.media_links ?? []).slice(0, 25).map(l => ({ area_id: l.area_id, task_id: l.task_id, step_id: l.step_id, plan_step_id: l.plan_step_id ?? null })),
    links_truncated: (row.media_links?.length ?? 0) > 25 }
}
function version(row: MediaRow): string {
  const links = (row.media_links ?? []).map(l => JSON.stringify([l.area_id,l.task_id,l.step_id,l.plan_step_id??null])).sort()
  return JSON.stringify([row.updated_at,row.content_type,row.byte_size,row.width,row.height,row.title,row.purpose,row.source_kind??'unknown',links])
}
export function validImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)
  if (mime === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'
  return false
}
// Encode 3-byte-aligned chunks, so the concatenation equals one btoa of the
// whole image without building a multi-megabyte binary string first.
function base64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 24576) {
    const chunk = bytes.subarray(i, i + 24576)
    let binary = ''
    for (let j = 0; j < chunk.length; j += 8192) binary += String.fromCharCode(...chunk.subarray(j, j + 8192))
    parts.push(btoa(binary))
  }
  return parts.join('')
}
async function pixels(projectId: string, transport: MediaTransport, row: MediaRow, signal: AbortSignal): Promise<{ bytes: Uint8Array; sha256: string }> {
  const bytes = await transport.download(row, signal)
  if (bytes.byteLength !== row.byte_size || !validImageSignature(bytes, row.content_type)) throw new Error('invalid_image')
  const current = checked(await transport.read(row.id, signal), projectId, row.id)
  if (version(current) !== version(row)) throw new Error('context_changed')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return { bytes, sha256: Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') }
}
/** Metadata checkpoints can defer pixels until a fresh provider submission. */
export function createMediaAdapter(projectId: string, transport: MediaTransport, deferred = false): ContextAdapter {
  return {
    category: 'images', prefix: 'image', count: transport.count,
    async list(request, signal) {
      if (request.after_id && !UUID.test(request.after_id)) throw new Error('invalid_cursor')
      const rows = await transport.list(request, signal)
      const safe = rows.slice(0, 13).map(r => checked(r, projectId))
      const descriptions = transport.descriptions && safe.length ? await transport.descriptions(safe.slice(0, 12).map(r => r.id), signal) : []
      return { items: safe.slice(0, 12).map(row => {
        const description = descriptions.find(d => d.media_id === row.id && d.source_version === version(row))
        return { ...item(row), ...(description ? { description: { text: description.description, source: 'ai_visual_observation', verified: false,
          note: 'Selection aid only. Open the image for visual detail; never treat this as a verified measurement.' } } : {}) }
      }), next_cursor: safe.length > 12 ? safe[11].id : null }
    },
    async open(ref, signal): Promise<Opened> {
      const id = imageId(ref), row = checked(await transport.read(id, signal), projectId, id)
      const source = { projectId, dataset: 'image_pixels' as const, recordId: id, label: `Bild öppnad: ${row.title}`,
        retrievedAt: new Date().toISOString(), updatedAt: row.updated_at, truth: 'unknown' as const }
      if (deferred) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(version(row))))
        const revision = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
        return { item: item(row), bytes: row.byte_size, version: version(row), source,
          image: { type: 'image_url', image_url: `private-image:${id}/${revision}` } }
      }
      const { bytes, sha256 } = await pixels(projectId, transport, row, signal)
      return { item: { ...item(row), sha256 }, bytes: bytes.byteLength, version: version(row),
        image: { type: 'image_url', image_url: `data:${row.content_type};base64,${base64(bytes)}` },
        source }
    },
    async current(ref, expected, signal) {
      try { const id = imageId(ref); return version(checked(await transport.read(id, signal), projectId, id)) === expected }
      catch { return false }
    },
  }
}
/** Caller-scoped access and exact revision are checked before and after downloading. */
export async function resolveMediaImage(projectId: string, transport: MediaTransport, record: Opened, signal: AbortSignal): Promise<string> {
  const adapter = createMediaAdapter(projectId, transport)
  if (!await adapter.current(record.item.ref, record.version, signal)) throw new Error('context_changed')
  const opened = await adapter.open(record.item.ref, signal)
  if (opened.version !== record.version) throw new Error('context_changed')
  return opened.image.image_url
}
/** Derived, expiring provider copy of one exact image revision. bob storage
 * stays the source; the provider file id is only a link back to it. */
export interface ProviderImageFiles {
  find(mediaId: string, revision: string, signal: AbortSignal): Promise<string | null>
  upload(bytes: Uint8Array, contentType: string, signal: AbortSignal): Promise<{ fileId: string; expiresAt: string }>
  save(entry: { mediaId: string; revision: string; updatedAt: string; sha256: string; fileId: string; expiresAt: string }, signal: AbortSignal): Promise<void>
}
const FILE_ID = /^file-[A-Za-z0-9_-]{1,120}$/
/** A stored provider file id for this exact revision, else upload once and
 * record it. Any provider-file failure falls back to the inline pixels, so a
 * missing cache never blocks a view. Unavailable lookups skip the cache. */
export async function resolveMediaImageFile(projectId: string, transport: MediaTransport, record: Opened, ref: string, files: ProviderImageFiles, signal: AbortSignal): Promise<string> {
  const revision = ref.slice(ref.lastIndexOf('/') + 1)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.version)))
  if (!/^[0-9a-f]{64}$/.test(revision) || Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') !== revision) throw new Error('context_changed')
  const adapter = createMediaAdapter(projectId, transport)
  if (!await adapter.current(record.item.ref, record.version, signal)) throw new Error('context_changed')
  const mediaId = record.source.recordId
  let known: string | null
  try { known = await files.find(mediaId, revision, signal) } catch { return resolveMediaImage(projectId, transport, record, signal) }
  if (known && FILE_ID.test(known)) return known
  const row = checked(await transport.read(mediaId, signal), projectId, mediaId)
  if (version(row) !== record.version) throw new Error('context_changed')
  const { bytes, sha256 } = await pixels(projectId, transport, row, signal)
  let uploaded: { fileId: string; expiresAt: string }
  try {
    uploaded = await files.upload(bytes, row.content_type, signal)
    if (!FILE_ID.test(uploaded.fileId)) throw new Error('invalid_file_id')
  } catch { return `data:${row.content_type};base64,${base64(bytes)}` }
  try { await files.save({ mediaId, revision, updatedAt: row.updated_at, sha256, fileId: uploaded.fileId, expiresAt: uploaded.expiresAt }, signal) }
  catch { /* used now; the next fresh request uploads again */ }
  return uploaded.fileId
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
