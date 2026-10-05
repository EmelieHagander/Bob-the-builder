import test from 'node:test'
import assert from 'node:assert/strict'
import { runAuthenticatedK3, runAuthenticatedK4, K3_PROJECT, K3_MEMBER, K3_PREVIOUS_TURN, K4_PREVIOUS_TURN, K4_DRAWING, K4_SOURCE } from '../scripts/run-live-construction-drawing.mjs'

const NOW = Date.UTC(2026, 9, 5)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = `header.${encode({ role: 'authenticated', sub: K3_MEMBER, exp: NOW / 1000 + 3600 })}.private-session`
const config = () => ({ VITE_SUPABASE_URL: 'https://yuobtgoidmmmwfqenkau.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test', BOB_USER_EMAIL: 'private@example.test',
  BOB_USER_PASSWORD: 'private-password', BOB_K3_PROJECT_ID: K3_PROJECT, BOB_K3_LIVE_CONFIRM: 'disposable-fixtures-only' })

function fixture(change = {}) {
  const calls = [], probes = [], logs = [], signouts = []
  const user = { id: K3_MEMBER, email: 'private@example.test', email_confirmed_at: 'confirmed', is_anonymous: false, ...change.user }
  const prior = change.k4 ? K4_PREVIOUS_TURN : K3_PREVIOUS_TURN
  const results = {
    projects: { data: { id: K3_PROJECT, name: 'K2 model acceptance fixture', type: 'Verification' } },
    bob_threads: { data: { id: 'thread' } },
    bob_messages: { data: { turn_id: prior, delivery_state: 'completed' } },
    artifact_cad_revisions: { data: change.k4 ? [{artifact_id:K4_DRAWING,artifact_revision:1,manifest:{bob_construction:{artifact_id:K4_SOURCE,revision:4}}}] : [] },
    current_material_requirements:{data:[]}, ...change.results,
  }
  const client = {
    auth: {
      signInWithPassword: async input => { calls.push('login'); assert.deepEqual(input, { email: 'private@example.test', password: 'private-password' });
        if (change.transport) throw new Error('SECRET private-password ' + token)
        return change.login ?? { data: { session: { access_token: token } } } },
      getUser: async supplied => { calls.push('getUser'); assert.equal(supplied, token); return { data: { user } } },
      signOut: async opts => { signouts.push(opts); return {} },
    },
    from: table => {
      calls.push(table)
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
        single: async () => results[table], then: (resolve, reject) => Promise.resolve(results[table]).then(resolve, reject) }
      return query
    },
    rpc: async (name, args) => { calls.push(name); assert.equal(name, 'bob_job_status');
      assert.deepEqual(args, { p_project: K3_PROJECT, p_turn: prior });
      return { data: { status: change.jobStatus ?? (change.k4 ? 'completed' : 'failed') } } },
  }
  const deps = {
    makeClient: (url, key, opts) => { assert.equal(opts.auth.persistSession, false); assert.equal(opts.auth.autoRefreshToken, false); return client },
    probe: async env => { probes.push(env); if (change.probeFails) throw new Error('SECRET private-password ' + token) },
    progress: message => logs.push(message), now: () => NOW,
  }
  return { deps, calls, probes, logs, signouts }
}

test('password login supplies only an independently verified ordinary session to the unchanged probe, once', async () => {
  const f = fixture(), result = await runAuthenticatedK3(config(), f.deps)
  assert.equal(result.passed, true); assert.equal(f.probes.length, 1)
  assert.equal(f.probes[0].BOB_TEST_MEMBER_ID, K3_MEMBER)
  assert.equal(f.probes[0].BOB_TEST_MEMBER_ACCESS_TOKEN, token)
  assert.equal(f.probes[0].BOB_K3_PROJECT_ID, K3_PROJECT)
  assert(!('BOB_USER_PASSWORD' in f.probes[0])); assert(!('BOB_USER_EMAIL' in f.probes[0]))
  assert.deepEqual(f.signouts, [{ scope: 'local' }])
  assert.doesNotMatch(JSON.stringify({ result, logs: f.logs }), /private-password|private-session|private@example/)
})

test('unsafe configuration and workflow reruns stop before sending any credentials', async () => {
  for (const changed of [ { VITE_SUPABASE_URL: 'https://other.invalid' }, { BOB_K3_PROJECT_ID: 'p_other' },
    { BOB_K3_LIVE_CONFIRM: '' }, { BOB_USER_PASSWORD: '' }, { GITHUB_RUN_ATTEMPT: '2' },
    { VITE_SUPABASE_ANON_KEY: `header.${encode({ role: 'service_role' })}.signature` } ]) {
    const f = fixture(), result = await runAuthenticatedK3({ ...config(), ...changed }, f.deps)
    assert.equal(result.phase, 'configuration'); assert.equal(f.calls.length, 0); assert.equal(f.probes.length, 0)
  }
})

test('denied or private transport errors stop before reads and never expose credentials', async () => {
  for (const change of [{ login: { error: { message: 'SECRET private-password' } } }, { transport: true }]) {
    const f = fixture(change), result = await runAuthenticatedK3(config(), f.deps)
    assert.equal(result.phase, 'authentication'); assert.deepEqual(f.calls, ['login']); assert.equal(f.probes.length, 0)
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private-password|private-session/)
  }
})

test('another member, guest, unconfirmed or anonymous user stops before fixture reads and signs out locally', async () => {
  for (const user of [{ id: 'other' }, { email: 'guest@bob.local' }, { email_confirmed_at: null }, { is_anonymous: true }]) {
    const f = fixture({ user }), result = await runAuthenticatedK3(config(), f.deps)
    assert.equal(result.phase, 'member_identity'); assert.deepEqual(f.calls, ['login', 'getUser'])
    assert.equal(f.probes.length, 0); assert.deepEqual(f.signouts, [{ scope: 'local' }])
  }
})

test('missing or foreign project, changed conversation, pending job and existing drawing stop without a model call', async () => {
  for (const change of [
    { results: { projects: { error: { message: 'denied' } } } },
    { results: { projects: { data: { id: 'other', name: 'K2 model acceptance fixture', type: 'Verification' } } } },
    { results: { bob_messages: { data: { turn_id: 'new-turn', delivery_state: 'completed' } } } },
    { results: { bob_messages: { data: { turn_id: K3_PREVIOUS_TURN, delivery_state: 'pending' } } } },
    { jobStatus: 'running' }, { jobStatus: 'queued' },
    { results: { artifact_cad_revisions: { data: [{ artifact_id: 'existing' }] } } },
  ]) {
    const f = fixture(change), result = await runAuthenticatedK3(config(), f.deps)
    assert.equal(result.passed, false); assert.equal(f.probes.length, 0)
    assert.deepEqual(f.signouts, [{ scope: 'local' }])
  }
})

test('failed or uncertain probe is never retried and still clears only its own session', async () => {
  const f = fixture({ probeFails: true }), result = await runAuthenticatedK3(config(), f.deps)
  assert.equal(result.passed, false); assert.equal(result.phase, 'probe'); assert.equal(f.probes.length, 1)
  assert.deepEqual(f.signouts, [{ scope: 'local' }]); assert.doesNotMatch(JSON.stringify(result), /SECRET|private-password|private-session/)
})

const configK4=()=>{
 const {BOB_K3_PROJECT_ID,BOB_K3_LIVE_CONFIRM,...rest}=config()
 return {...rest,BOB_K4_PROJECT_ID:BOB_K3_PROJECT_ID,BOB_K4_LIVE_CONFIRM:BOB_K3_LIVE_CONFIRM}
}
test('K4 reuses the credential boundary and requires the completed K3 checkpoint/drawing and no existing needs',async()=>{
 const f=fixture({k4:true}),r=await runAuthenticatedK4(configK4(),f.deps)
 assert.equal(r.passed,true);assert.equal(f.probes.length,1)
 assert.equal(f.probes[0].BOB_K4_PROJECT_ID,K3_PROJECT);assert.equal(f.probes[0].BOB_TEST_MEMBER_ACCESS_TOKEN,token)
 assert(!('BOB_USER_PASSWORD' in f.probes[0]));assert.deepEqual(f.signouts,[{scope:'local'}])
})
test('K4 cannot repeat or continue a changed, failed, mismatched or already-delivered fixture',async()=>{
 for(const change of [
  {jobStatus:'failed'},{jobStatus:'running'},
  {results:{bob_messages:{data:{turn_id:K3_PREVIOUS_TURN,delivery_state:'completed'}}}},
  {results:{artifact_cad_revisions:{data:[]}}},
  {results:{artifact_cad_revisions:{data:[{artifact_id:K4_DRAWING,artifact_revision:2,manifest:{bob_construction:{artifact_id:K4_SOURCE,revision:4}}}]}}},
  {results:{artifact_cad_revisions:{data:[{artifact_id:K4_DRAWING,artifact_revision:1,manifest:{bob_construction:{artifact_id:K4_SOURCE,revision:3}}}]}}},
  {results:{current_material_requirements:{data:[{id:'existing'}]}}},
  {results:{current_material_requirements:{error:{message:'SECRET private-password'}}}},
 ]){
  const f=fixture({k4:true,...change}),r=await runAuthenticatedK4(configK4(),f.deps)
  assert.equal(r.passed,false);assert.equal(f.probes.length,0);assert.doesNotMatch(JSON.stringify(r),/SECRET|private-password|private-session/)
  assert.deepEqual(f.signouts,[{scope:'local'}])
 }
 const f=fixture({k4:true}),r=await runAuthenticatedK4({...configK4(),GITHUB_RUN_ATTEMPT:'2'},f.deps)
 assert.equal(r.phase,'configuration');assert.equal(f.calls.length,0)
})
