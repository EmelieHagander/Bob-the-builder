// Regression checks for the actual data seam against synthetic HTTP-shaped reads.
// No network, credentials, production data, or writes are used.
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const requests = [], authSubscribers = []
let holdNotices = false, releaseNotices, noticeArrived
let holdProjects = false, releaseProjects, projectArrived
let scenario = 'settled', started = 0
const pid = 'audit-project', uid = '00000000-0000-4000-8000-000000000001'
const thread = '00000000-0000-4000-8000-000000000002'
const turn = '00000000-0000-4000-8000-000000000003'
const session = { user: { id: uid, email: 'fixture@example.invalid' } }
const project = { id: pid, slug: 'audit', name: 'Audit fixture', description: '', location: '', type: '', theme: 'birch', start_label: '', start_date: null, end_date: null, phase: 'concept' }
const member = { id: 'person-audit', name: 'Fixture', initials: 'F', color: '', role: 'organiser', diet: '', person_skills: [] }

globalThis.localStorage = { getItem: key => key === 'bob:active-project' ? pid : null, setItem() {}, removeItem() {} }
globalThis.window = new EventTarget()

function request(name, data, operations = []) {
  requests.push({ name, start: Math.round(performance.now() - started), operations })
  if (name === 'bob_delegation_notices' && holdNotices) { noticeArrived(); return new Promise(resolve => { releaseNotices = () => resolve({data,error:null}) }) }
  if (name === 'projects' && holdProjects) { projectArrived(); return new Promise(resolve => { releaseProjects = () => resolve({data,error:null}) }) }
  return new Promise(resolve => setTimeout(() => resolve({ data, error: null }), 10))
}
function query(table) {
  const operations = []
  let single = false
  const builder = new Proxy({}, { get(_, method) {
    if (method === 'then') return (resolve, reject) => {
      let rows = table === 'projects' ? [project] : table === 'people' ? [member] : table === 'bob_threads' ? [{id: thread}] : []
      if (table === 'bob_messages') rows = scenario === 'pending'
        ? [{ seq: 5, role: 'user', text: 'fixture', turn_id: turn, delivery_state: 'pending', updated_at: new Date().toISOString() }]
        : [{ seq: 6, role: 'assistant', text: 'fixture answer', turn_id: turn, delivery_state: 'completed' }, { seq: 5, role: 'user', text: 'fixture', turn_id: turn, delivery_state: 'completed' }]
      // Messages carry their joined active thread, as the real read does.
      if (table === 'bob_messages') rows = rows.map(row => ({ ...row, thread_id: thread }))
      return request(table, single ? rows[0] ?? null : rows, operations).then(resolve, reject)
    }
    if (['insert', 'update', 'delete', 'upsert'].includes(method)) throw new Error('Mutation blocked in audit fixture')
    return (...args) => { operations.push([method, ...args.map(a => a instanceof AbortSignal ? 'signal' : a)]); if (method === 'single' || method === 'maybeSingle') single = true; return builder }
  } })
  return builder
}
globalThis.__auditDb = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: () => request('auth.getUser', {user: session.user}),
    onAuthStateChange: cb => { authSubscribers.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
  },
  from: query,
  rpc: (name) => {
    if (name === 'claim_project_invites') return request('rpc.claim_project_invites', null)
    if (name === 'bob_job_status') {
      const result = {jobId:turn,status:'running',expiresAt:new Date(Date.now()+300000).toISOString()}
      return { abortSignal: () => request('rpc.bob_job_status', result) }
    }
    if (name === 'bob_chat_inbox') return { abortSignal: () => request('rpc.bob_chat_inbox', {threadId:thread,latestSeq:6,readSeq:6,unread:false}) }
    throw new Error('Unexpected fixture RPC: '+name)
  }
}
await mkdir('test-results',{recursive:true})
const folder = await mkdtemp('test-results/performance-data-')
const bundle = `${folder}/database.mjs`
await build({ entryPoints:['./src/data/database.ts'], outfile:bundle, bundle:true, platform:'node', format:'esm', logLevel:'error', plugins:[{
  name:'synthetic-database', setup(build) {
    build.onResolve({filter:/\/supabaseClient(?:\.ts)?$/}, () => ({path:'audit-client', namespace:'audit'}))
    build.onLoad({filter:/.*/, namespace:'audit'}, () => ({contents:'export const accountClient=globalThis.__auditDb; export const SUPABASE_URL=null; export const SUPABASE_ANON_KEY=null;',loader:'js'}))
  }
}] })
const db = await import(pathToFileURL(`${process.cwd()}/${bundle}`).href)
let invalidations=0, renewals=0
const unsubscribe=db.onAuthChange(()=>invalidations++)
const stopRefresh=db.onSessionRefresh(()=>renewals++)
for(const cb of authSubscribers) cb('INITIAL_SESSION',session)
function reset() { requests.length=0; started=performance.now() }
function result(label) {
  const counts={}; for(const r of requests) counts[r.name]=(counts[r.name]??0)+1
  return {label,requests:requests.length,counts,trace:structuredClone(requests)}
}
const results=[]
reset(); const boot = await Promise.all([db.getProject(),db.getProjects()]); assert.equal(boot[0].phase,'concept'); results.push(result('app boot project read')); assert.equal(requests.length,2)
reset(); await Promise.all([db.getProject(),db.getAreas(),db.getPeople(),db.getTasks(),db.getNextEvent(),db.getAnnouncements(),db.getCurrentUser()]); results.push(result('ProjectHome first six loaders plus Sidebar member; before child widgets')); assert.equal(requests.length,8); assert.equal(requests.filter(r=>r.name==='projects').length,1)
reset(); await db.getAskBobConversation(pid); results.push(result('cold chat initial read; completed turn'))
scenario='pending'; reset(); await db.getAskBobConversation(pid); results.push(result('cold chat initial read; active turn'))
reset(); await Promise.all([db.getBobInbox(pid),db.getBobInbox(pid)]); results.push(result('one overlapping shell and idle chat inbox cycle')); assert.equal(requests.length,1); assert.equal(requests[0].name,'rpc.bob_chat_inbox')
for(const event of ['SIGNED_IN','TOKEN_REFRESHED']) for(const cb of authSubscribers) cb(event,session)
assert.equal(invalidations,0); assert.equal(renewals,2)
const sameOwnerInvalidations = invalidations
holdNotices=true
const arrived = new Promise(resolve=>{noticeArrived=resolve})
let early, settled=false
const history = db.getAskBobConversation(pid,{onTranscript: value=>{early=value}}).then(value=>{settled=true;return value})
await arrived
assert(early.messages.some(message=>message.text==='fixture'))
assert.equal(early.pending,undefined,'Preview carries no write/job authority')
assert.equal(settled,false,'Preview arrives before notices and status settle')
releaseNotices(); holdNotices=false
assert((await history).pending,'Final status still reconciles the pending job')
holdProjects=true
const projectHeld = new Promise(resolve=>{projectArrived=resolve})
const oldRead = db.getProjects()
await projectHeld
db.setActiveProject('other-project')
releaseProjects(); holdProjects=false
await assert.rejects(oldRead,/changed/)
db.setActiveProject(pid)
for(const cb of authSubscribers) cb('SIGNED_IN',{user:{id:'other-owner',email:'other@example.invalid'}})
assert.equal(invalidations,1)
unsubscribe(); stopRefresh()
const report={kind:'data-seam regression fixture; counts are NOT production latency measurements',perRequestDelayMs:10,results,identicalUserAuthEvents:{events:2,invalidations:sameOwnerInvalidations}}
await writeFile('test-results/performance-reads.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({...report,results:results.map(({trace,...r})=>r)},null,2))

await rm(folder,{recursive:true,force:true})
