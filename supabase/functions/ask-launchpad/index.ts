/** Retirement response for previously deployed clients. No provider or database
 * calls: old unbound requests must never be forwarded to the new endpoint. */
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

Deno.serve(request => request.method === 'OPTIONS'
  ? new Response(null, { status: 204, headers })
  : new Response(JSON.stringify({ ok: false, error: 'endpoint_retired' }), { status: 410, headers }))
