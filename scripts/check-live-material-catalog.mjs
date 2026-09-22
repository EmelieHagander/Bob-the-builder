// Explicit, operator-run acceptance. Never falls back to the public guest,
// creates Auth users, changes grants or obtains a service-role credential.
// Run: node scripts/check-live-material-catalog.mjs
// Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable only),
// BOB_CATALOG_LIVE_CONFIRM=disposable-fixtures-only, BOB_TEST_MEMBER_ID and
// BOB_TEST_MEMBER_ACCESS_TOKEN from a dedicated verified test member session.
// Supply the token through a secure runner environment, never chat, code or logs.
// The candidate schema AND matching ask-bob release must already be available.
// An approved release operator must coordinate that controlled rollout separately.
// Creates at most two synthetic projects and requests five logical model turns.
// No production-house input, images, orders, stock or administrative Auth calls.
// Proof: test-results/live-material-catalog.json (override BOB_CATALOG_PROOF_PATH).
// Operator cleanup: verify each exact proof ID/name/description/type plus absence
// of media/artifacts, then remove ONLY these fixture projects and verify cascades.
// If creation timed out, id=null preserves the unique requested name for lookup.
// Never delete storage.objects rows to clean files. No automatic project-deletion
// endpoint is introduced. Cleanup and independent multi-actor races remain gates;
// tests_passed is evidence for this probe only and release_ready remains false.
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROJECT_URL = 'https://yuobtgoidmmmwfqenkau.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const FIXTURE_DESCRIPTION = 'Disposable material catalog acceptance. No real project data.'
const demand = (ok, code) => { if (!ok) throw new Error(code) }
function jwtRole(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role }
  catch { return null }
}

export function releaseConfig(env) {
  const raw = env.VITE_SUPABASE_URL?.trim()
  const url = raw === 'yuobtgoidmmmwfqenkau' ? PROJECT_URL : raw?.replace(/\/$/, '')
  demand(url === PROJECT_URL, 'catalog_test_wrong_project')
  demand(env.BOB_CATALOG_LIVE_CONFIRM === 'disposable-fixtures-only', 'catalog_test_opt_in_required')
  const key = env.VITE_SUPABASE_ANON_KEY?.trim(), token = env.BOB_TEST_MEMBER_ACCESS_TOKEN?.trim()
  const memberId = env.BOB_TEST_MEMBER_ID?.trim()
  demand(key && (key.startsWith('sb_publishable_') || jwtRole(key) === 'anon'), 'catalog_test_publishable_key_required')
  demand(token && jwtRole(token) === 'authenticated', 'catalog_test_member_session_required')
  demand(memberId && UUID.test(memberId), 'catalog_test_member_id_required')
  return { url, key, token, memberId }
}

function transport(config, fetcher) {
  return async (path, body, anonymous = false) => {
    const rest = path.startsWith('/rest/v1/'), headers = { apikey: config.key, 'Content-Type': 'application/json' }
    if (!anonymous) headers.Authorization = 'Bearer ' + config.token
    if (rest) { headers['Accept-Profile'] = 'bob'; headers['Content-Profile'] = 'bob' }
    let response
    try {
      response = await fetcher(config.url + path, { method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(240000), redirect: 'error' })
    } catch { throw new Error('catalog_test_transport_failed') }
    let data
    try { data = await response.json() } catch { throw new Error('catalog_test_invalid_json') }
    return { ok: response.ok, status: response.status, release: response.headers.get('X-Bob-Release'), data }
  }
}

// The token is verified by Auth; parsing its role above is rejection only, never authorization.
export async function preflight(config, expectedRelease, fetcher = fetch) {
  demand(typeof expectedRelease === 'string' && expectedRelease.startsWith('bob-material-catalog-'), 'catalog_test_expected_release_required')
  const request = transport(config, fetcher)
  const user = await request('/auth/v1/user')
  demand(user.ok && user.data?.id === config.memberId && user.data?.is_anonymous !== true
    && typeof user.data?.email === 'string' && user.data.email.length > 0
    && user.data.email.toLowerCase() !== 'guest@bob.local' && !!user.data.email_confirmed_at, 'catalog_test_named_member_required')
  const marker = await request('/functions/v1/ask-bob', { action: 'release_probe' })
  demand(marker.status === 409 && marker.data?.error === 'unsupported_action' && marker.release === expectedRelease, 'catalog_test_runtime_mismatch')
  const inch = await request('/rest/v1/catalog_units?code=eq.in&select=code,dimension,to_canonical')
  demand(inch.ok && Array.isArray(inch.data) && inch.data.length === 1 && inch.data[0].dimension === 'length'
    && String(inch.data[0].to_canonical) === '25.4', 'catalog_test_schema_not_ready')
  return request
}

export function validateAnswer(response, projectId, expectedRelease) {
  const a = response.data
  demand(response.ok && response.release === expectedRelease && a?.ok === true && a.backend === 'openai'
    && a.projectId === projectId && typeof a.summary === 'string' && a.summary.trim().length > 0
    && a.evidence?.kind === 'ai_assessment' && Array.isArray(a.evidence.sources)
    && a.evidence.partial === false, 'catalog_test_answer_failed_or_partial')
  demand(a.evidence.sources.every(s => s.projectId === projectId && s.dataset !== 'image_pixels')
    && (a.evidence.writes ?? []).every(w => w.projectId === projectId && w.dataset === 'catalog'), 'catalog_test_unexpected_evidence')
  demand(!/data:image|base64,|object_path|bucket_id|source_quote|source_thread/.test(JSON.stringify(a.evidence)), 'catalog_test_private_data_leak')
  return a
}

export async function runCatalogAcceptance(config, expectedRelease, { fetcher = fetch, report = () => {} } = {}) {
  const proof = { release: expectedRelease, started_at: new Date().toISOString(), tests_passed: false,
    cleanup_required: false, release_ready: false, fixtures: [], checks: [], limits: ['No multi-actor ensure race proof', 'Not the general assembly or Shopping engine'] }
  try {
    const request = await preflight(config, expectedRelease, fetcher)
    const must = async (path, body) => {
      const r = await request(path, body); demand(r.ok, 'catalog_test_api_failed'); return r.data
    }
    const mark = name => { proof.checks.push(name); report({ check: name, passed: true }) }
    const createFixture = async () => {
      const name = 'Bob catalog verification ' + randomUUID()
      const entry = { id: null, name, description: FIXTURE_DESCRIPTION, type: 'Verification' }
      proof.fixtures.push(entry); proof.cleanup_required = true
      report({ fixture_requested: name })
      const p = await must('/rest/v1/rpc/create_project', { p_input: { name, description: FIXTURE_DESCRIPTION, type: 'Verification' } })
      demand(typeof p?.id === 'string' && /^p_[a-zA-Z0-9_-]+$/.test(p.id), 'catalog_test_fixture_not_created')
      entry.id = p.id
      report({ fixture_project_id: p.id, fixture_name: name })
      const rows = await must('/rest/v1/projects?id=eq.' + encodeURIComponent(p.id) + '&select=id,name,description,type')
      demand(rows.length === 1 && rows[0].name === name && rows[0].description === FIXTURE_DESCRIPTION && rows[0].type === 'Verification', 'catalog_test_fixture_not_verified')
      return p.id
    }
    const projectId = await createFixture()
    const rows = table => must('/rest/v1/' + table + '?project_id=eq.' + encodeURIComponent(projectId) + '&select=id')
    const beforeStock = await rows('stock_items'), beforeShopping = await rows('materials')
    const catalog = async (project, change) => must('/rest/v1/rpc/catalog_read', { p_project: project, p_input: {
      action: 'read', kind: null, query: null, after: null, id: null, revision: null, profile_code: null, categories: [], properties: {}, ...change,
    } })
    const exact = async (id, revision) => {
      const r = await catalog(projectId, { id, revision }); demand(r.status === 'ok' && r.record?.id === id && r.record.revision === revision, 'catalog_test_readback_failed'); return r.record
    }
    const send = (message, clientTurnId) => request('/functions/v1/ask-bob', { action: 'send', projectId, message, clientTurnId })
    const ask = async message => {
      const started = Date.now(), r = validateAnswer(await send(message, randomUUID()), projectId, expectedRelease)
      report({ model_turn_ms: Date.now() - started }); return r
    }
    const receipt = (a, operation) => {
      const writes = (a.evidence.writes ?? []).filter(w => w.operation === operation)
      demand(writes.length === 1 && UUID.test(writes[0].recordId) && Number.isInteger(writes[0].revision), 'catalog_test_receipt_required')
      return writes[0]
    }
    const quantity = (r, field, value) => demand(r.properties?.[field]?.value === value && r.properties[field].unit === 'mm', 'catalog_test_mm_readback_mismatch')

    // Two real concurrent HTTP requests with one idempotency key. No model/tool fixtures.
    const message = 'Spara en materialdefinition med namnet Provskiva: plywood, tjocklek ¾ tum. Detta är min angivna specifikation. Bara materialdefinitionen, inga lagerposter, inköp, ritningar eller bilder.'
    const turn = randomUUID(), replies = await Promise.all([send(message, turn), send(message, turn)])
    const accepted = replies.filter(r => r.ok)
    demand(accepted.length >= 1 && replies.every(r => r.ok || (r.status === 409 && r.data?.error === 'turn_in_flight')), 'catalog_test_parallel_turn_failed')
    const created = validateAnswer(accepted[0], projectId, expectedRelease), matReceipt = receipt(created, 'created')
    for (const replay of accepted.slice(1)) demand(JSON.stringify(validateAnswer(replay, projectId, expectedRelease)) === JSON.stringify(created), 'catalog_test_replay_differed')
    const settledReplay = validateAnswer(await send(message, turn), projectId, expectedRelease)
    demand(JSON.stringify(settledReplay) === JSON.stringify(created), 'catalog_test_replay_differed')
    const mat = await exact(matReceipt.recordId, matReceipt.revision)
    demand(mat.kind === 'material' && mat.revision === 1, 'catalog_test_wrong_definition_kind'); quantity(mat, 'thickness', '19.05')
    demand((await rows('catalog_items')).length === 1, 'catalog_test_duplicate_definition')
    mark('real_model_inch_create_parallel_same_turn_and_exact_replay')

    const reuse = await ask('Provskivan är alltså 19,05 mm tjock. Återanvänd samma materialdefinition; skapa inte en ny. Kontrollera den sparade definitionen och tala om vilken version vi använder.')
    demand((await rows('catalog_items')).length === 1, 'catalog_test_reuse_created_duplicate')
    demand(reuse.evidence.sources.some(s => s.dataset === 'catalog' && s.recordId === mat.id + '@1')
      || (reuse.evidence.writes ?? []).some(w => w.recordId === mat.id && w.revision === 1 && w.operation === 'reused'), 'catalog_test_reuse_without_readback')
    mark('metric_followup_reuses_exact_material')

    const partAnswer = await ask('Skapa och spara en återanvändbar deldefinition med namnet Provpanel av Provskivan: längd 640 mm, bredd 320 mm och samma tjocklek som materialet. Koppla den till den befintliga materialdefinitionen. Enbart deldefinitionen, ingen ritning eller shopping.')
    const partReceipt = receipt(partAnswer, 'created'), part = await exact(partReceipt.recordId, partReceipt.revision)
    demand(part.kind === 'part' && part.material_id === mat.id && part.material_revision === 1, 'catalog_test_material_pin_missing')
    quantity(part, 'length', '640'); quantity(part, 'width', '320'); quantity(part, 'thickness', '19.05')
    mark('real_model_part_creation_pins_material')

    const revisionAnswer = await ask('Ändra samma Provpanel: endast längden ska bli 700 mm. Behåll bredd, tjocklek, materialkoppling och delens identitet. Spara rättelsen.')
    const revisionReceipt = receipt(revisionAnswer, 'updated')
    demand(revisionReceipt.recordId === part.id && revisionReceipt.revision === 2, 'catalog_test_revision_identity_changed')
    const revised = await exact(part.id, 2); quantity(revised, 'length', '700'); quantity(revised, 'width', '320'); quantity(revised, 'thickness', '19.05')
    demand(revised.material_id === mat.id && revised.material_revision === 1, 'catalog_test_revision_pin_changed')
    quantity(await exact(part.id, 1), 'length', '640')
    mark('real_model_correction_preserves_identity_and_history')

    const nominalAnswer = await ask('Spara även en separat materialdefinition för barrträregel med handelsbeteckningen 2x4 (tvåtumfyra). Jag har inte mätt tvärsnittet och har ingen leverantörsspecifikation. Spara därför bredd och tjocklek som okända, inte som antagna standardmått. Bara definitionen.')
    const nominalReceipt = receipt(nominalAnswer, 'created'), nominal = await exact(nominalReceipt.recordId, nominalReceipt.revision)
    demand(/2[x×]4/.test(nominal.properties?.nominal_size?.value ?? '') && nominal.properties.nominal_size.unit === null, 'catalog_test_nominal_label_missing')
    for (const field of ['width', 'thickness']) demand(nominal.properties?.[field]?.value === null && nominal.properties[field].truth === 'unknown' && nominal.properties[field].unit === 'mm', 'catalog_test_nominal_became_geometry')
    mark('real_model_trade_label_does_not_invent_dimensions')

    const foreignProject = await createFixture(), hidden = await catalog(foreignProject, { id: mat.id, revision: 1 })
    demand(hidden.status === 'not_found' && hidden.record === null, 'catalog_test_cross_project_read')
    const anon = await request('/rest/v1/rpc/catalog_read', { p_project: projectId, p_input: { action: 'read', id: mat.id } }, true)
    demand(anon.status === 401 || anon.status === 403, 'catalog_test_anonymous_read')
    const raw = await request('/rest/v1/catalog_items', { id: randomUUID(), project_id: projectId, kind: 'material', current_revision: 1 })
    demand(raw.status === 403 && raw.data?.code === '42501', 'catalog_test_raw_write_not_denied')
    demand((await rows('catalog_items')).length === 3 && (await rows('stock_items')).length === beforeStock.length
      && (await rows('materials')).length === beforeShopping.length, 'catalog_test_unexpected_domain_write')
    mark('hosted_project_pin_raw_write_denial_and_no_stock_or_shopping')
    proof.tests_passed = true
  } catch (error) {
    // Only our fixed codes leave the runner; never provider bodies, tokens or private account fields.
    proof.error = error instanceof Error && /^catalog_test_[a-z_]+$/.test(error.message) ? error.message : 'catalog_test_unexpected_failure'
  }
  proof.finished_at = new Date().toISOString()
  return proof
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const config = releaseConfig(process.env)
    const expected = JSON.parse(await readFile(new URL('../public/bob-release.json', import.meta.url), 'utf8')).release
    const proof = await runCatalogAcceptance(config, expected, { report: item => console.log(JSON.stringify(item)) })
    const path = process.env.BOB_CATALOG_PROOF_PATH || 'test-results/live-material-catalog.json'
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify({ tests_passed: proof.tests_passed, cleanup_required: proof.cleanup_required, error: proof.error ?? null }))
    // A passing behavior probe still needs operator cleanup and the separate multi-actor gate.
    if (!proof.tests_passed) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error && /^catalog_test_[a-z_]+$/.test(error.message) ? error.message : 'catalog_test_setup_failed')
    process.exitCode = 1
  }
}
