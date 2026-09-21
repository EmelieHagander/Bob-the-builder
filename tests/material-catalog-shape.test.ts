import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalogWrite, parseCatalogRead, CATALOG_WRITE_TOOL, createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
const value = (value: string | null, unit: string | null = 'mm', truth = 'provided_spec', parameter: string | null = null, note = '') => ({ value, unit, truth, parameter, note })
const write = () => ({ action:'ensure',key:'sheet',kind:'material',record_id:null,expected_revision:0,name:'Plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:value('18')},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'Bygg en hylla',source_seq:null,request_quote:'Bygg en hylla' })
const query = () => ({entity:'materials',query:null,categories:[],profile_code:null,profile_revision:null,properties:{},after:null})

test('one general write schema accepts material definitions without stock, Shopping or object-name semantics',()=>{
  const parsed=parseCatalogWrite(write())
  assert(parsed);assert.equal(parsed.kind,'catalog');assert.equal(parsed.record_id,null)
  assert.equal(parsed.data.profile_code,'sheet_stock')
  for(const extra of ['project_id','stock_quantity','sql','table','approval','actor_id']) assert.equal(parseCatalogWrite({...write(),[extra]:'spoof'}),null)
})
test('arbitrary new category/profile codes need no parser update',()=>{
  const d=write();d.profile_code='new_authorised_profile';d.categories=['new_material','new_form'];d.properties={thickness:value('1.8','cm')}
  assert(parseCatalogWrite(d))
})
test('part parameters differ from unknown dimensions and materials cannot carry them',()=>{
  const d=write();d.properties={thickness:value(null,'mm','provided_spec','thickness')}
  assert.equal(parseCatalogWrite(d),null)
  const part={...d,kind:'part',material_id:'10000000-0000-4000-8000-000000000001',material_revision:1}
  assert(parseCatalogWrite(part))
  assert.equal(parseCatalogWrite({...part,material_revision:null}),null)
  assert.equal(parseCatalogWrite({...part,properties:{thickness:value(null,'mm','unknown',null)}}),null)
  assert(parseCatalogWrite({...part,properties:{thickness:value(null,'mm','unknown',null,'Not specified yet')}}))
})
test('full replacement requires an exact existing revision and keeps identity explicit',()=>{
  const id='10000000-0000-4000-8000-000000000001'
  assert(parseCatalogWrite({...write(),action:'revise',record_id:id,expected_revision:1}))
  assert.equal(parseCatalogWrite({...write(),action:'revise',record_id:id,expected_revision:0}),null)
  assert.equal(parseCatalogWrite({...write(),record_id:id}),null)
})
test('typed searches require the profile revision; unknown is never a wildcard',()=>{
  assert(parseCatalogRead('search_material_catalog',query()))
  assert.equal(parseCatalogRead('search_material_catalog',{...query(),properties:{thickness:value('18')}}),null)
  assert(parseCatalogRead('search_material_catalog',{...query(),profile_code:'sheet_stock',profile_revision:1,properties:{thickness:value('18')}}))
  assert.equal(parseCatalogRead('search_material_catalog',{...query(),profile_code:'sheet_stock',profile_revision:1,properties:{thickness:value(null,'mm','unknown',null,'unknown')}}),null)
  assert.equal(parseCatalogRead('search_material_catalog',{...query(),after:'not-a-uuid'}),null)
})
test('exact read accepts historical revisions and no arbitrary URI/table',()=>{
  assert(parseCatalogRead('read_material_catalog',{entity:'profile',id:'panel',revision:1}))
  assert(parseCatalogRead('read_material_catalog',{entity:'definition',id:'10000000-0000-4000-8000-000000000001',revision:2}))
  assert.equal(parseCatalogRead('read_material_catalog',{entity:'definition',id:'https://other-project',revision:1}),null)
})
test('specification values are not an executable code channel or fake measurement evidence',()=>{
  for (const props of [{thickness:value('18','mm','measured')},{thickness:{value:'18'}},JSON.parse('{"__proto__":{}}')]) assert.equal(parseCatalogWrite({...write(),properties:props}),null)
  assert.equal(parseCatalogWrite({...write(),source_kind:'manufacturer_verified'}),null)
  assert.equal(parseCatalogWrite({...write(),categories:['wood','wood']}),null)
})
test('failed reads do not masquerade as empty and cannot become evidence',async()=>{
  const sources:any[]=[], reader=createMaterialCatalogReader('A',async()=>({data:null,error:{code:'XX000'}}),async()=>true,sources)
  assert.equal((await reader.read('search_material_catalog',query())).status,'unavailable');assert(reader.partial);assert.equal(sources.length,0)
})
test('search stays metadata; exact authorized historical read adds versioned source',async()=>{
  const id='10000000-0000-4000-8000-000000000001', sources:any[]=[]
  const reader=createMaterialCatalogReader('A',async input=>({data:input.action==='search'?{status:'ok',projectId:'A',items:[{id,name:'Board'}],next_cursor:null,truncated:false}:{status:'ok',projectId:'A',record:{id,revision:2,name:'Board',recorded_at:'2026-09-21T12:00:00Z'}},error:null}),async()=>true,sources)
  await reader.read('search_material_catalog',query());assert.equal(sources.length,0)
  const result=await reader.read('read_material_catalog',{entity:'definition',id,revision:2});assert.equal(result.status,'ok');assert.equal(sources[0].recordId,`${id}@2`)
})
test('project revocation and bad envelopes are denied or unavailable, never disclosed',async()=>{
  let allowed=true
  const reader=createMaterialCatalogReader('A',async()=>{allowed=false;return {data:{status:'ok',projectId:'A',items:[]},error:null}},async()=>allowed,[])
  assert.equal((await reader.read('search_material_catalog',query())).status,'denied')
  const foreign=createMaterialCatalogReader('A',async()=>({data:{status:'empty',projectId:'B',items:[]},error:null}),async()=>true,[])
  assert.equal((await foreign.read('search_material_catalog',query())).status,'unavailable')
})
test('bounded timeout and budgets stop stalled or repetitive catalog calls',async()=>{
  const reader=createMaterialCatalogReader('A',async()=>new Promise(()=>{}),async()=>true,[],5)
  assert.equal((await reader.read('search_material_catalog',query())).status,'unavailable')
  for(let i=1;i<12;i++)await reader.read('read_material_catalog',{})
  assert.equal((await reader.read('search_material_catalog',query())).status,'budget_exhausted')
})
test('all write arguments are explicit and finite; no hidden ownership fields',()=>{
  assert.deepEqual(new Set(CATALOG_WRITE_TOOL.function.parameters.required),new Set(Object.keys(write())))
  assert.equal(parseCatalogWrite({...write(),expected_revision:NaN}),null)
  assert.equal(parseCatalogWrite({...write(),profile_revision:Infinity}),null)
})
