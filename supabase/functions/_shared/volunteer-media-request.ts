export interface VolunteerImage { bucket: string; path: string; contentType: string; byteSize: number }
export interface VolunteerDrawingImage { id: string; revision: number }
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const failure = (status: number) => new Response(JSON.stringify({ error: 'Image unavailable. Refresh the project and try again.' }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Public HTTP entry, with a project/session capability checked before and after
 * fetching bytes. No public bucket, Auth account, signed URL or credential log. */
export function createVolunteerMediaHandler(deps: {
  authorize: (session: string, taskId: string, mediaId: string, drawing?: VolunteerDrawingImage) => Promise<VolunteerImage | null>
  download: (image: VolunteerImage) => Promise<Blob | null>
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return failure(405)
    try {
      const reader = request.body?.getReader()
      if (!reader) return failure(400)
      const chunks: Uint8Array[] = []; let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2048) { await reader.cancel(); return failure(400) }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const body = JSON.parse(new TextDecoder().decode(bytes))
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['session', 'taskId', 'mediaId', 'drawingId', 'revision'].includes(key))
        || typeof body.session !== 'string' || !/^[0-9a-f]{64}$/.test(body.session)
        || typeof body.taskId !== 'string' || !body.taskId || body.taskId.length > 200
        || typeof body.mediaId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.mediaId)) return failure(400)
      const hasDrawing = 'drawingId' in body || 'revision' in body
      if (hasDrawing && (typeof body.drawingId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.drawingId)
        || !Number.isInteger(body.revision) || body.revision < 1 || body.revision > 2147483647)) return failure(400)
      const drawing = hasDrawing ? { id: body.drawingId, revision: body.revision } : undefined
      const image = await deps.authorize(body.session, body.taskId, body.mediaId, drawing)
      if (!image || image.bucket !== 'bob-project-media' || !['image/png', 'image/jpeg', 'image/webp'].includes(image.contentType)
        || !Number.isInteger(image.byteSize) || image.byteSize < 1 || image.byteSize > 6291456) return failure(403)
      const blob = await deps.download(image)
      if (!blob || blob.size !== image.byteSize) return failure(503)
      const current = await deps.authorize(body.session, body.taskId, body.mediaId, drawing)
      if (!current || current.path !== image.path || current.bucket !== image.bucket || current.contentType !== image.contentType || current.byteSize !== image.byteSize) return failure(403)
      return new Response(blob, { status: 200, headers: { ...cors, 'Content-Type': image.contentType, 'Content-Length': String(blob.size) } })
    } catch { return failure(400) }
  }
}
