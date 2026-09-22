import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseConfig, preflight, validateAnswer, runCatalogAcceptance, FIXTURE_DESCRIPTION } from '../scripts/check-live-material-catalog.mjs'

const memberId = '00000000-0000-4000-8000-000000000001'
const token = role => 'fixture.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.not-a-real-signature'
const env = { VITE_SUPABASE_URL: 'https://yuobtgoidmmmwfqenkau.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  BOB_CATALOG_LIVE_CONFIRM: 'disposable-fixtures-only', BOB_TEST_MEMBER_ACCESS_TOKEN: token('authenticated'), BOB_TEST_MEMBER_ID: memberId }
const release = 'bob-material-catalog-2026-09-21'
const user = { id: memberId, email: 'catalog-fixture@example.test', email_confirmed_at: '2026-09-21T00:00:00Z', is_anonymous: false }
const json = (data, status = 200) => Response.json(data, { status, headers: { 'X-Bob-Release': release } })
const config = () => releaseConfig(env)
const answer = (sources = [], writes = []) => ({ ok: true, backend: 'openai', status: 'completed', projectId: 'p_a', summary: 'Fixture-only answer.',
  evidence: { kind: 'ai_assessment', partial: false, sources, writes } })
const envelope = a => ({ ok: true, status: 200, release, data: a })

// Protocol/control tests. No external request, real Auth session or model invocation.
test('live catalog runner requires explicit target, opt-in and a member session; no guest/service fallback', () => {
  assert.equal(config().url, env.VITE_SUPABASE_URL)
  assert.equal(releaseConfig({ ...env, VITE_SUPABASE_URL: 'yuobtgoidmmmwfqenkau' }).url, env.VITE_SUPABASE_URL)
  for (const patch of [
    { VITE_SUPABASE_URL: 'https://other.invalid' }, { BOB_CATALOG_LIVE_CONFIRM: '' },
    { VITE_SUPABASE_ANON_KEY: 'sb_secret_fixture' }, { VITE_SUPABASE_ANON_KEY: token('service_role') },
    { BOB_TEST_MEMBER_ACCESS_TOKEN: '' }, { BOB_TEST_MEMBER_ACCESS_TOKEN: token('service_role') },
    { BOB_TEST_MEMBER_ID: 'someone' },
  ]) assert.throws(() => releaseConfig({ ...env, ...patch }), /catalog_test_/)
})

test('preflight authenticates the real member, pins both releases and checks schema before fixture creation', async () => {
  const seen = []
  const request = await preflight(config(), release, async (url, opts) => {
    seen.push({ url, opts })
    assert.equal(opts.headers.Authorization, 'Bearer ' + env.BOB_TEST_MEMBER_ACCESS_TOKEN)
    assert.equal(opts.redirect, 'error')
    if (url.endsWith('/auth/v1/user')) return json(user)
    if (url.endsWith('/functions/v1/ask-bob')) { assert.deepEqual(JSON.parse(opts.body), { action: 'release_probe' }); return json({ error: 'unsupported_action' }, 409) }
    assert.equal(opts.headers['Accept-Profile'], 'bob')
    return json([{ code: 'in', dimension: 'length', to_canonical: 25.4 }])
  })
  assert.equal(typeof request, 'function'); assert.equal(seen.length, 3)
  assert(!seen.some(r => r.url.includes('create_project')))
})

test('guest, anonymous, unconfirmed, different and denied identities stop before probing or creating data', async () => {
  for (const [body, status] of [[{ ...user, email: 'GUEST@bob.local' }, 200], [{ ...user, is_anonymous: true }, 200],
    [{ ...user, email_confirmed_at: null }, 200], [{ ...user, id: 'other' }, 200], [{ error: 'denied' }, 401]]) {
    let calls = 0
    await assert.rejects(preflight(config(), release, async () => { calls++; return json(body, status) }), /named_member_required/)
    assert.equal(calls, 1)
  }
})

test('wrong runtime or missing catalog cannot create fixtures or invoke an answer', async () => {
  for (const fail of ['runtime', 'schema']) {
    let calls = 0
    const proof = await runCatalogAcceptance(config(), release, { fetcher: async url => {
      calls++
      if (url.endsWith('/auth/v1/user')) return json(user)
      if (url.endsWith('/functions/v1/ask-bob')) return fail === 'runtime' ? Response.json({ error: 'unsupported_action' }, { status: 409 }) : json({ error: 'unsupported_action' }, 409)
      return json({ code: '42P01' }, 404)
    } })
    assert.equal(proof.tests_passed, false); assert.equal(proof.cleanup_required, false)
    assert.deepEqual(proof.fixtures, []); assert.equal(calls, fail === 'runtime' ? 2 : 3)
  }
})

test('proof rejects partial responses, foreign evidence, unintended writes and image use', () => {
  for (const a of [
    { ...answer(), projectId: 'p_b' }, { ...answer(), backend: 'fixture' },
    { ...answer(), evidence: { ...answer().evidence, partial: true } },
    answer([{ projectId: 'p_b', dataset: 'catalog' }]), answer([{ projectId: 'p_a', dataset: 'image_pixels' }]),
    answer([], [{ projectId: 'p_a', dataset: 'tasks' }]),
    answer([{ projectId: 'p_a', dataset: 'catalog', source_quote: 'private' }]),
  ]) assert.throws(() => validateAnswer(envelope(a), 'p_a', release), /catalog_test_/)
  assert.equal(validateAnswer(envelope(answer()), 'p_a', release).ok, true)
})

test('transport failures are redacted rather than leaking tokens or provider bodies', async () => {
  const proof = await runCatalogAcceptance(config(), release, { fetcher: async () => { throw new Error('SECRET ' + env.BOB_TEST_MEMBER_ACCESS_TOKEN) } })
  assert.equal(proof.error, 'catalog_test_transport_failed')
  assert.doesNotMatch(JSON.stringify(proof), /SECRET|not-a-real-signature/)
})

function protocolFixture({ wrongThickness = false, inFlight = false } = {}) {
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003']
  const records = new Map(), turns = new Map(), projects = [], requests = [], reports = []
  let modelTurns = 0, inflightSent = false
  const q = v => ({ value: v, unit: 'mm', truth: v === null ? 'unknown' : 'provided_spec' })
  const fetcher = async (url, opts) => {
    const u = new URL(url), path = u.pathname, body = opts.body ? JSON.parse(opts.body) : null
    requests.push({ path, body, anonymous: !opts.headers.Authorization })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/catalog_units') return json([{ code: 'in', dimension: 'length', to_canonical: '25.4' }])
    if (path === '/rest/v1/rpc/create_project') {
      const p = { id: projects.length ? 'p_b' : 'p_a', ...body.p_input }; projects.push(p); return json(p)
    }
    if (path === '/rest/v1/projects') return json(projects.filter(p => 'eq.' + p.id === u.searchParams.get('id')))
    if (path === '/rest/v1/stock_items' || path === '/rest/v1/materials') return json([])
    if (path === '/rest/v1/catalog_items') return opts.method === 'POST' ? json({ code: '42501' }, 403) : json([...new Set([...records.values()].map(r => r.id))].map(id => ({ id })))
    if (path === '/rest/v1/rpc/catalog_read') {
      if (!opts.headers.Authorization) return json({ code: '42501' }, 401)
      const r = body.p_project === 'p_a' ? records.get(body.p_input.id + '@' + body.p_input.revision) : null
      return json({ status: r ? 'ok' : 'not_found', record: r ?? null, projectId: body.p_project })
    }
    assert.equal(path, '/functions/v1/ask-bob')
    if (body.action === 'release_probe') return json({ error: 'unsupported_action' }, 409)
    if (turns.has(body.clientTurnId)) {
      if (inFlight && !inflightSent) { inflightSent = true; return json({ error: 'turn_in_flight' }, 409) }
      return json(turns.get(body.clientTurnId))
    }
    modelTurns++
    let a
    const saved = (r, operation) => {
      records.set(r.id + '@' + r.revision, r)
      return answer([], [{ projectId: 'p_a', dataset: 'catalog', recordId: r.id, revision: r.revision, operation }])
    }
    if (modelTurns === 1) a = saved({ id: ids[0], kind: 'material', revision: 1, properties: { thickness: q(wrongThickness ? '19' : '19.05') } }, 'created')
    else if (modelTurns === 2) a = answer([{ projectId: 'p_a', dataset: 'catalog', recordId: ids[0] + '@1' }])
    else if (modelTurns === 3) a = saved({ id: ids[1], kind: 'part', revision: 1, material_id: ids[0], material_revision: 1,
      properties: { length: q('640'), width: q('320'), thickness: q('19.05') } }, 'created')
    else if (modelTurns === 4) a = saved({ ...records.get(ids[1] + '@1'), revision: 2, properties: { length: q('700'), width: q('320'), thickness: q('19.05') } }, 'updated')
    else { assert.equal(modelTurns, 5); a = saved({ id: ids[2], kind: 'material', revision: 1,
      properties: { nominal_size: { value: '2x4', unit: null }, width: q(null), thickness: q(null) } }, 'created') }
    turns.set(body.clientTurnId, a); return json(a)
  }
  return { fetcher, report: v => reports.push(v), reports, requests, projects, get modelTurns() { return modelTurns } }
}

test('complete fixture protocol exercises exact readback, correction, nominal sizes and cleanup reporting', async () => {
  const f = protocolFixture(), proof = await runCatalogAcceptance(config(), release, f)
  assert.equal(proof.tests_passed, true, proof.error); assert.equal(proof.cleanup_required, true)
  assert.equal(proof.fixtures.length, 2); assert(proof.fixtures.every(p => p.description === FIXTURE_DESCRIPTION))
  assert.equal(proof.checks.length, 6); assert.equal(f.modelTurns, 5)
  const turns = f.requests.filter(r => r.body?.action === 'send')
  assert.equal(turns.length, 7); assert.equal(turns[0].body.clientTurnId, turns[1].body.clientTurnId)
  assert.equal(turns[0].body.clientTurnId, turns[2].body.clientTurnId)
  assert.doesNotMatch(JSON.stringify(proof), /Bearer|not-a-real-signature|source_quote/)
})

test('a parallel in-flight response is handled without inventing a new turn or extra model call', async () => {
  const f = protocolFixture({ inFlight: true }), proof = await runCatalogAcceptance(config(), release, f)
  assert.equal(proof.tests_passed, true, proof.error); assert.equal(f.modelTurns, 5)
})

test('wrong numeric result fails the gate and retains the exact fixture identity for cleanup', async () => {
  const f = protocolFixture({ wrongThickness: true }), proof = await runCatalogAcceptance(config(), release, f)
  assert.equal(proof.tests_passed, false); assert.equal(proof.error, 'catalog_test_mm_readback_mismatch')
  assert.equal(proof.fixtures.length, 1); assert.equal(proof.cleanup_required, true); assert.equal(f.modelTurns, 1)
})

test('uncertain fixture creation preserves the unique requested name instead of claiming no cleanup is needed', async () => {
  const f = protocolFixture()
  const proof = await runCatalogAcceptance(config(), release, { fetcher: (url, opts) => {
    if (url.endsWith('/rpc/create_project')) throw new Error('Lost reply after possible commit')
    return f.fetcher(url, opts)
  } })
  assert.equal(proof.tests_passed, false); assert.equal(proof.cleanup_required, true)
  assert.equal(proof.release_ready, false); assert.equal(proof.fixtures.length, 1)
  assert.equal(proof.fixtures[0].id, null); assert.match(proof.fixtures[0].name, /^Bob catalog verification /)
})
