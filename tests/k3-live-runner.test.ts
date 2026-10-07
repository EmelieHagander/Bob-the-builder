import test from 'node:test'
import assert from 'node:assert/strict'
import { runAuthenticatedK3, runAuthenticatedK4, runAuthenticatedK4Recovery, runAuthenticatedK4CutFit, runAuthenticatedK4CutPlan, runAuthenticatedK4CutPlanReadback, runAuthenticatedK4PackPurchase, runAuthenticatedK4PackReadback, K3_PROJECT, K3_MEMBER, K3_PREVIOUS_TURN, K4_PREVIOUS_TURN, K4_DRAWING, K4_SOURCE } from '../scripts/run-live-construction-drawing.mjs'
import { K4_RECOVERY_TURN, K4_SAVED_REQUIREMENT } from '../scripts/k4-recovery-checkpoint.mjs'
import { K4_CUT_FIT_PREVIOUS_TURN, K4_CUT_PLAN_PREVIOUS_TURN, K4_SAVED_CUT_PLAN_TURN, K4_SAVED_CUT_PLAN_ID, K4_SHELF_REQUIREMENT, K4_PACK_RETRY_TURN, K4_PACK_TURN, K4_PACK_LEFTOVER_NEED, assertK4CutFitCheckpoint } from '../scripts/k4-cut-fit-checkpoint.mjs'

const NOW = Date.UTC(2026, 9, 5)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = `header.${encode({ role: 'authenticated', sub: K3_MEMBER, exp: NOW / 1000 + 3600 })}.private-session`
const config = () => ({ VITE_SUPABASE_URL: 'https://yuobtgoidmmmwfqenkau.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test', BOB_USER_EMAIL: 'private@example.test',
  BOB_USER_PASSWORD: 'private-password', BOB_K3_PROJECT_ID: K3_PROJECT, BOB_K3_LIVE_CONFIRM: 'disposable-fixtures-only' })

function recoveryRows() {
 const r = { id: K4_SAVED_REQUIREMENT, project_id: K3_PROJECT, revision: 1, artifact_id: K4_SOURCE, artifact_revision: 4, target_revision: 3,
  unit: 'pcs', source_kind: 'deterministic', method_key: 'construction_blank_pieces', method_version: '1', archived: false,
  target_changed: false, artifact_changed: false, stock_changed: false, component_changed: false,
  required_quantity: 2, required_with_waste: 2, purchase_quantity: 2, stock_quantity: 0, component_quantity: 0, waste_percent: 0, purchase_increment: 1,
  recorded_at: '2026-10-05T22:32:47.129181+00:00' }
 const s = { project_id: K3_PROJECT, requirement_id: K4_SAVED_REQUIREMENT, requirement_revision: 1, artifact_id: K4_SOURCE, artifact_revision: 4,
  definition_id: 'side_panel', quantity_mode: 'pieces', instance_ids: ['left_side', 'right_side'], blank_mm: { x: 21, y: 300, z: 800 },
  material_binding: { definition_id: 'side_panel', material_id: '766d4e1a-db42-4a0e-af25-da2739783fc4', material_revision: 1, part_id: null, part_revision: null } }
 return { current_material_requirements: { data: [r] }, material_requirement_construction_sources: { data: [s] },
  material_requirement_revisions: { data: [{ requirement_id: r.id, project_id: K3_PROJECT, revision: 1, recorded_at: r.recorded_at }] } }
}

function cutFitRows() {
 const data = recoveryRows()
 const r = { ...data.current_material_requirements.data[0], id: K4_SHELF_REQUIREMENT, required_quantity: 3, required_with_waste: 3, purchase_quantity: 3, recorded_at: '2026-10-06T07:46:56.68927+00:00' }
 data.current_material_requirements.data.push(r)
 data.material_requirement_construction_sources.data.push({ ...data.material_requirement_construction_sources.data[0], requirement_id: K4_SHELF_REQUIREMENT, definition_id: 'shelf_panel', instance_ids: ['bottom_panel', 'middle_shelf', 'top_panel'], blank_mm: { x: 658, y: 300, z: 21 }, material_binding: { ...data.material_requirement_construction_sources.data[0].material_binding, definition_id: 'shelf_panel' } })
 data.material_requirement_revisions.data.push({ requirement_id: r.id, project_id: K3_PROJECT, revision: 1, recorded_at: r.recorded_at })
 return data
}
function packRows() {
 const data = cutFitRows()
 data.current_material_requirements.data.push({ id: K4_PACK_LEFTOVER_NEED, project_id: K3_PROJECT, revision: 1, unit: 'pcs', archived: false, stock_quantity: 0, component_quantity: 0, required_quantity: 18 })
 data.material_requirement_revisions.data.push({ requirement_id: K4_PACK_LEFTOVER_NEED, project_id: K3_PROJECT, revision: 1 })
 return data
}
function fixture(change = {}) {
  const calls = [], probes = [], logs = [], signouts = []
  const user = { id: K3_MEMBER, email: 'private@example.test', email_confirmed_at: 'confirmed', is_anonymous: false, ...change.user }
  const prior = change.packReadback ? K4_PACK_TURN : change.pack ? K4_PACK_RETRY_TURN : change.readback ? K4_SAVED_CUT_PLAN_TURN : change.cutPlan ? K4_CUT_PLAN_PREVIOUS_TURN : change.cutFit ? K4_CUT_FIT_PREVIOUS_TURN : change.recovery ? K4_RECOVERY_TURN : change.k4 ? K4_PREVIOUS_TURN : K3_PREVIOUS_TURN
  const results = {
    projects: { data: { id: K3_PROJECT, name: 'K2 model acceptance fixture', type: 'Verification' } },
    bob_threads: { data: { id: 'thread' } },
    bob_messages: { data: { turn_id: prior, delivery_state: 'completed' } },
    artifact_cad_revisions: { data: change.k4 ? [{artifact_id:K4_DRAWING,artifact_revision:1,manifest:{bob_construction:{artifact_id:K4_SOURCE,revision:4}}}] : [] },
    material_cut_plans:{data:[]}, current_material_requirements:{data:[]}, ...(change.recovery ? recoveryRows() : {}), ...(change.pack ? packRows() : change.cutFit || change.cutPlan || change.readback ? cutFitRows() : {}), ...change.results,
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

test('K4 recovery uses the completed partial turn, exact retained need and original history before one model call', async () => {
 const f = fixture({ k4: true, recovery: true }), r = await runAuthenticatedK4Recovery(configK4(), f.deps)
 assert.equal(r.passed, true); assert.equal(f.probes.length, 1)
 assert(f.calls.includes('material_requirement_construction_sources')); assert(f.calls.includes('material_requirement_revisions'))
 assert(!('BOB_USER_PASSWORD' in f.probes[0])); assert.deepEqual(f.signouts, [{ scope: 'local' }])
})

test('K4 recovery fences a changed turn, need, quantity, source, allocation, stale state or history without a paid call', async () => {
 const invalid = []
 for (const [key, value] of Object.entries({ id: 'other', project_id: 'other', revision: 2, artifact_revision: 3,
  required_quantity: 3, purchase_quantity: 3, waste_percent: 5, purchase_increment: 2, stock_quantity: 1,
  archived: true, artifact_changed: true, target_changed: true, recorded_at: '2026-10-06T00:00:00Z' })) {
  const rows = recoveryRows(); rows.current_material_requirements.data[0][key] = value; invalid.push({ results: rows })
 }
 for (const [key, value] of Object.entries({ definition_id: 'shelf_panel', quantity_mode: 'area_xy', artifact_revision: 3,
  instance_ids: ['left_side'], blank_mm: { x: 21, y: 300, z: 801 }, material_binding: {} })) {
  const rows = recoveryRows(); rows.material_requirement_construction_sources.data[0][key] = value; invalid.push({ results: rows })
 }
 const extra = recoveryRows(); extra.current_material_requirements.data.push({ ...extra.current_material_requirements.data[0], id: 'another' })
 const revised = recoveryRows(); revised.material_requirement_revisions.data.push({ ...revised.material_requirement_revisions.data[0], revision: 2 })
 invalid.push({ results: extra }, { results: revised }, { results: { current_material_requirements: { data: [] } } },
  { results: { material_requirement_construction_sources: { data: [] } } },
  { results: { material_requirement_revisions: { error: { message: 'SECRET private-password' } } } },
  { results: { bob_messages: { data: { turn_id: K4_PREVIOUS_TURN, delivery_state: 'completed' } } } },
  { jobStatus: 'running' }, { jobStatus: 'failed' })
 for (const change of invalid) {
  const f = fixture({ k4: true, recovery: true, ...change }), r = await runAuthenticatedK4Recovery(configK4(), f.deps)
  assert.equal(r.passed, false); assert.equal(f.probes.length, 0)
  assert.deepEqual(f.signouts, [{ scope: 'local' }]); assert.doesNotMatch(JSON.stringify(r), /SECRET|private-password|private-session/)
 }
 const f = fixture({ k4: true, recovery: true }), r = await runAuthenticatedK4Recovery({ ...configK4(), GITHUB_RUN_ATTEMPT: '2' }, f.deps)
 assert.equal(r.phase, 'configuration'); assert.equal(f.calls.length, 0)
})

test('cut-fit login pins both completed needs and latest recovery turn, passes no password to the probe and signs out locally', async () => {
 const f = fixture({ k4: true, cutFit: true }), r = await runAuthenticatedK4CutFit(configK4(), f.deps)
 assert.equal(r.passed, true); assert.equal(f.probes.length, 1)
 assert.equal(f.probes[0].BOB_K4_REPORT, 'test-results/live-construction-cut-fit.json')
 assert(!('BOB_USER_PASSWORD' in f.probes[0])); assert.deepEqual(f.signouts, [{ scope: 'local' }])
 assert.doesNotMatch(JSON.stringify({ r, logs: f.logs }), /private-password|private-session|private@example/)
 const rows = cutFitRows(); assertK4CutFitCheckpoint(rows.current_material_requirements.data.reverse(), rows.material_requirement_construction_sources.data.reverse(), rows.material_requirement_revisions.data.reverse())
})
test('cut-fit refuses altered/missing/extra need identities, quantities, provenance and history before a paid call', async () => {
 const changes = [
  r => { r.current_material_requirements.data[1].required_quantity = 4 },
  r => { r.current_material_requirements.data[1].artifact_changed = true },
  r => { r.current_material_requirements.data[1].revision = 2 },
  r => { r.current_material_requirements.data[1].id = 'another' },
  r => { r.material_requirement_construction_sources.data[1].blank_mm.x = 600 },
  r => { r.material_requirement_construction_sources.data[1].instance_ids.pop() },
  r => { r.material_requirement_revisions.data[1].revision = 2 },
  r => { r.current_material_requirements.data.pop() },
  r => { r.current_material_requirements.data.push({ ...r.current_material_requirements.data[1] }) },
 ]
 for (const change of changes) {
  const results = cutFitRows(); change(results)
  const f = fixture({ k4: true, cutFit: true, results }), r = await runAuthenticatedK4CutFit(configK4(), f.deps)
  assert.equal(r.passed, false); assert.equal(f.probes.length, 0); assert.deepEqual(f.signouts, [{ scope: 'local' }])
 }
})
test('cut-fit refuses wrong/pending conversation, job uncertainty and workflow reruns without retrying', async () => {
 for (const change of [{ results: { bob_messages: { data: { turn_id: K4_RECOVERY_TURN, delivery_state: 'completed' } } } },
  { results: { bob_messages: { data: { turn_id: K4_CUT_FIT_PREVIOUS_TURN, delivery_state: 'pending' } } } }, { jobStatus: 'running' }, { jobStatus: 'failed' }]) {
  const f = fixture({ k4: true, cutFit: true, ...change }), r = await runAuthenticatedK4CutFit(configK4(), f.deps)
  assert.equal(r.passed, false); assert.equal(f.probes.length, 0)
 }
 const f = fixture({ k4: true, cutFit: true }), r = await runAuthenticatedK4CutFit({ ...configK4(), GITHUB_RUN_ATTEMPT: '2' }, f.deps)
 assert.equal(r.phase, 'configuration'); assert.equal(f.calls.length, 0)
})


test('saved-plan login pins the completed read-only turn, both exact needs and zero existing plans', async () => {
 const f=fixture({k4:true,cutPlan:true}),env={...config(),BOB_K4_PROJECT_ID:K3_PROJECT,BOB_K4_LIVE_CONFIRM:'disposable-fixtures-only'}
 const r=await runAuthenticatedK4CutPlan(env,f.deps)
 assert.equal(r.passed,true);assert.equal(f.probes.length,1);assert.equal(f.probes[0].BOB_K4_REPORT,'test-results/live-construction-cut-plan.json')
 assert(!('BOB_USER_PASSWORD' in f.probes[0]));assert(!('BOB_USER_EMAIL' in f.probes[0]));assert.deepEqual(f.signouts,[{scope:'local'}])
})
test('existing/unknown saved plans or changed conversation stop before a new paid save',async()=>{
 for(const results of [{material_cut_plans:{data:[{id:'existing-plan'}]}},{material_cut_plans:{error:{message:'private'}}},{bob_messages:{data:{turn_id:K4_CUT_FIT_PREVIOUS_TURN,delivery_state:'completed'}}},{bob_messages:{data:{turn_id:K4_CUT_PLAN_PREVIOUS_TURN,delivery_state:'pending'}}}]){
  const f=fixture({k4:true,cutPlan:true,results}),r=await runAuthenticatedK4CutPlan({...config(),BOB_K4_PROJECT_ID:K3_PROJECT,BOB_K4_LIVE_CONFIRM:'disposable-fixtures-only'},f.deps)
  assert.equal(r.passed,false);assert.equal(f.probes.length,0);assert.doesNotMatch(JSON.stringify(r),/private/)
 }
})


test('read-only saved-plan verification pins the completed turn and exact existing plan without forwarding credentials',async()=>{
 const f=fixture({k4:true,readback:true,results:{material_cut_plans:{data:[{id:K4_SAVED_CUT_PLAN_ID,current_revision:1,artifact_id:K4_SOURCE}]}}})
 const r=await runAuthenticatedK4CutPlanReadback(configK4(),f.deps)
 assert.equal(r.passed,true);assert.equal(f.probes.length,1);assert.equal(f.probes[0].BOB_K4_VERIFY_ONLY,'saved-plan')
 assert(!('BOB_USER_PASSWORD' in f.probes[0]));assert.deepEqual(f.signouts,[{scope:'local'}])
 for(const results of [{material_cut_plans:{data:[]}},{material_cut_plans:{data:[{id:'wrong-plan',current_revision:1,artifact_id:K4_SOURCE}]}},{bob_messages:{data:{turn_id:K4_CUT_PLAN_PREVIOUS_TURN,delivery_state:'completed'}}}]){
  const bad=fixture({k4:true,readback:true,results}),stopped=await runAuthenticatedK4CutPlanReadback(configK4(),bad.deps)
  assert.equal(stopped.passed,false);assert.equal(bad.probes.length,0)
 }
})

test('pack-purchase run pins the saved plan and leftover screw need, requires no existing product and submits through the probe once',async()=>{
 const saved={material_cut_plans:{data:[{id:K4_SAVED_CUT_PLAN_ID,current_revision:1,artifact_id:K4_SOURCE}]},supplier_articles:{data:[]}}
 const f=fixture({k4:true,readback:true,pack:true,results:saved})
 const r=await runAuthenticatedK4PackPurchase(configK4(),f.deps)
 assert.equal(r.passed,true);assert.equal(f.probes.length,1);assert(!('BOB_K4_VERIFY_ONLY' in f.probes[0]))
 assert.equal(f.probes[0].BOB_K4_REPORT,'test-results/live-pack-purchase.json')
 assert(!('BOB_USER_PASSWORD' in f.probes[0]));assert(!('BOB_USER_EMAIL' in f.probes[0]));assert.deepEqual(f.signouts,[{scope:'local'}])
 for(const results of [{...saved,supplier_articles:{data:[{id:'existing'}]}},{...saved,supplier_articles:{error:{message:'private'}}},{...saved,material_cut_plans:{data:[]}},{...saved,bob_messages:{data:{turn_id:K4_SAVED_CUT_PLAN_TURN,delivery_state:'completed'}}},{...saved,...cutFitRows()}]){
  const bad=fixture({k4:true,readback:true,pack:true,results}),stopped=await runAuthenticatedK4PackPurchase(configK4(),bad.deps)
  assert.equal(stopped.passed,false);assert.equal(bad.probes.length,0);assert.doesNotMatch(JSON.stringify(stopped),/private/)
 }
})

test('pack readback rechecks the saved pack turn read-only and never submits without the saved product',async()=>{
 const saved={material_cut_plans:{data:[{id:K4_SAVED_CUT_PLAN_ID,current_revision:1,artifact_id:K4_SOURCE}]},supplier_articles:{data:[{id:'saved'}]}}
 const f=fixture({k4:true,readback:true,pack:true,packReadback:true,results:saved})
 const r=await runAuthenticatedK4PackReadback(configK4(),f.deps)
 assert.equal(r.passed,true);assert.equal(f.probes.length,1);assert.equal(f.probes[0].BOB_K4_VERIFY_ONLY,'pack-purchase')
 for(const results of [{...saved,supplier_articles:{data:[]}},{...saved,bob_messages:{data:{turn_id:K4_PACK_RETRY_TURN,delivery_state:'completed'}}}]){
  const bad=fixture({k4:true,readback:true,pack:true,packReadback:true,results}),stopped=await runAuthenticatedK4PackReadback(configK4(),bad.deps)
  assert.equal(stopped.passed,false);assert.equal(bad.probes.length,0)
 }
})
