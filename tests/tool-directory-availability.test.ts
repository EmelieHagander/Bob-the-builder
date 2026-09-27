import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, type ToolGate } from '../supabase/functions/_shared/project-tools/session.ts'

/** Tools Bob cannot use right now stay visible on the shelf with the reason, so he
 * knows his limits, but they are never offered or executed. */
const names=(tools:any[])=>tools.map(t=>t.function.name)
function setup(gate:ToolGate){
 let writes=0
 const session=createToolSession({definitions:[{version:1,group:'Records',waitingFor:'after the source is chosen',spec:{type:'function',function:{name:'read_source',description:'Read',parameters:{}}},gate:()=>gate,execute:async()=>{writes++;return{status:'ok'}}}],
  readPolicy:async()=>({phase:'concept',tools:[{name:'read_source',description:'Read source',how_to:'Read safely',schema_version:1,always_load:true,preload_phases:[],active:true}]})})
 return {session,get writes(){return writes}}
}
test('a used-up tool stays on the shelf as used up without restoring its budget',async()=>{
 const f=setup('budget_exhausted')
 assert.deepEqual(names(await f.session.prepare()),[])
 assert.deepEqual(f.session.toolbox,[{name:'read_source',group:'Records',state:'budget_exhausted'}])
 assert.equal((await f.session.execute('read_source',{})).status,'budget_exhausted');assert.equal(f.writes,0)
})
test('a tool waiting for a prerequisite is listed with that prerequisite',async()=>{
 const f=setup('missing_context')
 assert.deepEqual(names(await f.session.prepare()),[])
 assert.deepEqual(f.session.toolbox,[{name:'read_source',group:'Records',state:'waiting',waitingFor:'after the source is chosen'}])
 const result=await f.session.execute('read_source',{})
 assert.equal(result.status,'missing_context');assert.match(result.message,/after the source is chosen/);assert.equal(f.writes,0)
})
test('an empty or wholly denied catalog offers and lists nothing, and leaks no guidance',async()=>{
 const denied=setup('not_allowed');assert.deepEqual(names(await denied.session.prepare()),[])
 assert.deepEqual(denied.session.toolbox,[])
 const refused=await denied.session.execute('read_source',{})
 assert.equal(refused.status,'not_allowed');assert(!JSON.stringify(refused).includes('Read safely'));assert.equal(denied.writes,0)
 const empty=createToolSession({definitions:[],readPolicy:async()=>({phase:null,tools:[]})})
 assert.deepEqual(names(await empty.prepare()),[]);assert.deepEqual(empty.toolbox,[])
 assert.equal((await empty.execute('read_source',{})).status,'invalid')
})
