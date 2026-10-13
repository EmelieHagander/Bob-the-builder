import { parseCadAssemblyRequest, type CadAssemblyRequest } from './cad-adapter.ts'
import { CAD_WIREFRAME_BYTES, cadViewerSourceHash, parseCadViewerPin, parseCadWireframe, type CadViewerPin, type CadWireframe } from './cad-wireframe.ts'

type Claim = { status: 'claimed'; lease_token: string; attempt: number } | { status: 'ready'; payload: unknown } | { status: 'pending' } | { status: 'failed'; retry_allowed: boolean }
export type CadViewerDependencies = {
  authorize: (authorization: string, pin: CadViewerPin) => Promise<unknown>
  claim: (pin: CadViewerPin, hash: string, retry: boolean) => Promise<Claim>
  finish: (pin: CadViewerPin, hash: string, lease: string, payload: CadWireframe | null) => Promise<boolean>
  render: (recipe: CadAssemblyRequest, hash: string) => Promise<unknown>
}
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
export function createCadViewerHandler(deps: CadViewerDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return response(405, { error: 'method_not_allowed' })
    const authorization = req.headers.get('Authorization') ?? ''
    if (!/^Bearer \S+$/.test(authorization)) return response(401, { error: 'sign_in_required' })
    let raw: any
    try {
      if (Number(req.headers.get('content-length')) > 1024) return response(413, { error: 'request_too_large' })
      if (!req.body) return response(400, { error: 'invalid_request' })
      const reader = req.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024) return response(413, { error: 'request_too_large' })
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      raw = JSON.parse(new TextDecoder().decode(bytes))
    } catch { return response(400, { error: 'invalid_request' }) }
    const pin = parseCadViewerPin(raw)
    if (!pin || Object.keys(raw).some(key => !['project_id', 'artifact_id', 'revision', 'retry'].includes(key))
      || (raw.retry !== undefined && typeof raw.retry !== 'boolean')) return response(400, { error: 'invalid_request' })
    try {
      const recipe = parseCadAssemblyRequest(await deps.authorize(authorization, pin))
      if (!recipe) return response(403, { error: 'drawing_unavailable' })
      const hash = await cadViewerSourceHash(recipe)
      const claim = await deps.claim(pin, hash, raw.retry === true)
      let geometry: CadWireframe | null
      if (claim.status === 'pending' || claim.status === 'failed') return response(200, claim)
      if (claim.status === 'ready') {
        geometry = parseCadWireframe(claim.payload, recipe, hash)
        if (!geometry) return response(503, { error: 'invalid_cached_view' })
      } else {
        try {
          geometry = parseCadWireframe(await deps.render(recipe, hash), recipe, hash)
          if (!geometry) throw new Error('invalid_view')
          // Recheck caller authority and the exact source after the paid export.
          const current = parseCadAssemblyRequest(await deps.authorize(authorization, pin))
          if (!current || await cadViewerSourceHash(current) !== hash) {
            await deps.finish(pin, hash, claim.lease_token, null)
            return response(403, { error: 'drawing_unavailable' })
          }
          if (!await deps.finish(pin, hash, claim.lease_token, geometry)) return response(200, { status: 'pending' })
        } catch {
          await deps.finish(pin, hash, claim.lease_token, null)
          return response(200, { status: 'failed', retry_allowed: claim.attempt < 3 })
        }
      }
      // Cached output also requires fresh access; no signed public URL or browser-wide cache.
      const current = parseCadAssemblyRequest(await deps.authorize(authorization, pin))
      if (!current || await cadViewerSourceHash(current) !== hash) return response(403, { error: 'drawing_unavailable' })
      return response(200, { status: 'ready', source: pin, geometry })
    } catch { return response(503, { error: 'viewer_unavailable' }) }
  }
}
export function createCadWireframeTransport(endpoint: string | undefined, token: string | undefined, fetcher: typeof fetch = fetch) {
  return async (recipe: CadAssemblyRequest, hash: string) => {
    if (!endpoint || !token) throw new Error('cad_engine_unavailable')
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/render') throw new Error('cad_endpoint_invalid')
    url.pathname = '/wireframe'; url.search = ''; url.hash = ''
    const res = await fetcher(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe, source_hash: hash }), signal: AbortSignal.timeout(45000), redirect: 'error' })
    if (!res.ok || Number(res.headers.get('content-length')) > CAD_WIREFRAME_BYTES || !res.body) throw new Error('cad_view_unavailable')
    const reader = res.body.getReader(), chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > CAD_WIREFRAME_BYTES) throw new Error('cad_view_too_large')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const body = new Uint8Array(bytes); let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder().decode(body))
  }
}
