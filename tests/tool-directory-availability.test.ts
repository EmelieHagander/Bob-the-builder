import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, TOOL_LIMITS, type ToolGate } from '../supabase/functions/_shared/project-tools/session.ts'
const browse={query:null,after_name:null}
const names=(tools:any[])=>tools.map(t=>t.function.name)
function setup(gate:ToolGate){
 let writes=0
 const session=createToolSession({definitions:[{version:1,spec:{type:'function',function:{name:'read_source',description:'Read',parameters:{}}},gate:()=>gate,execute:async()=>{writes++;return{status:'ok'}}}],
  readPolicy:async()=>({phase:'concept',tools:[{name:'read_source',description:'Read source',how_to:'Read safely',schema_version:1,always_load:true,preload_phases:[],active:true}]})})
 return {session,get writes(){return writes}}
}
test('directory survives exhausted domain budget without restoring that budget',async()=>{
 const f=setup('budget_exhausted')
 assert.deepEqual(names(await f.session.prepare()),['list_tools','load_tool'])
 const listed=await f.session.execute('list_tools',browse)
 assert.equal(listed.items[0].availability,'budget_exhausted')
 assert.equal((await f.session.execute('load_tool',{name:'read_source'})).status,'budget_exhausted')
 assert.deepEqual(names(await f.session.prepare()),['list_tools','load_tool'])
 assert.equal((await f.session.execute('read_source',{})).status,'budget_exhausted');assert.equal(f.writes,0)
})
test('missing-context tools can be diagnosed through the independently available directory',async()=>{
 const f=setup('missing_context')
 assert.deepEqual(names(await f.session.prepare()),['list_tools','load_tool'])
 assert.equal((await f.session.execute('list_tools',browse)).items[0].availability,'missing_context')
 assert.equal((await f.session.execute('load_tool',{name:'read_source'})).status,'missing_context')
 assert.equal(f.writes,0)
})
test('an empty or wholly denied catalog still has discovery but exposes no forbidden guidance',async()=>{
 const denied=setup('not_allowed');assert.deepEqual(names(await denied.session.prepare()),['list_tools','load_tool'])
 assert.deepEqual((await denied.session.execute('list_tools',browse)).items,[])
 const deniedPacket=await denied.session.execute('load_tool',{name:'read_source'})
 assert.equal(deniedPacket.status,'not_allowed');assert(!('tool' in deniedPacket));assert.equal(denied.writes,0)
 const empty=createToolSession({definitions:[],readPolicy:async()=>({phase:null,tools:[]})})
 assert.deepEqual(names(await empty.prepare()),['list_tools','load_tool'])
 assert.equal((await empty.execute('list_tools',browse)).status,'empty')
 assert.equal((await empty.execute('load_tool',{name:'read_source'})).status,'not_found')
})
test('directory retains its own finite budget and the final tool-free boundary',async()=>{
 const f=setup('budget_exhausted');await f.session.prepare()
 for(let i=0;i<TOOL_LIMITS.managementCalls;i++)assert.equal((await f.session.execute('list_tools',browse)).status,'ok')
 assert.deepEqual(await f.session.prepare(),[])
 assert.notEqual((await f.session.execute('load_tool',{name:'read_source'})).status,'loaded')
 const fresh=setup('budget_exhausted');await fresh.session.prepare();fresh.session.closeSurface()
 assert.equal((await fresh.session.execute('list_tools',browse)).status,'invalid')
 assert.equal(f.writes,0);assert.equal(fresh.writes,0)
})
