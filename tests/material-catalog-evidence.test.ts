import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogSourceTruth, createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
import { isProjectWriteReceipt } from '../src/data/bobEvidence.ts'

const id='10000000-0000-4000-8000-000000000001'
const property=(truth:string)=>({value:truth==='unknown'?null:'18',unit:'mm',truth,parameter:null,note:''})
test('compact catalog evidence retains estimates, design choices and unknowns without pretending measurement',async()=>{
 for(const [source_kind,truth,has_unknown,expected] of [
  ['user_statement','provided_spec',false,'provided_spec'],['user_statement','estimated',false,'estimated'],
  ['user_statement','unknown',true,'unknown'],['design_choice','provided_spec',false,'ai_assessment'],
  ['seed','provided_spec',false,'unknown'],['user_statement','measured',false,'unknown'],
 ] as const){
  const record={id,revision:1,name:'Fixture',recorded_at:'2026-09-21T10:00:00Z',source_kind,has_unknown,properties:{thickness:property(truth)}}
  assert.equal(catalogSourceTruth(record),expected)
  const sources:any[]=[]
  const reader=createMaterialCatalogReader('A',async()=>({data:{status:'ok',projectId:'A',record},error:null}),async()=>true,sources)
  assert.equal((await reader.read('read_material_catalog',{entity:'definition',id,revision:1})).status,'ok')
  assert.equal(sources[0].truth,expected)
 }
 assert.equal(catalogSourceTruth({source_kind:'user_statement',has_unknown:false,properties:{}}),'unknown')
 assert.equal(catalogSourceTruth({source_kind:'user_statement',has_unknown:false,properties:{known:property('provided_spec'),estimated:property('estimated')}}),'estimated')
})
test('only exact catalog receipts may describe unchanged reuse; old write categories retain their contract',()=>{
 const receipt={projectId:'A',dataset:'catalog',recordId:id,label:'Plywood',operation:'reused',savedAt:'2026-09-21T10:00:00Z',revision:1}
 assert(isProjectWriteReceipt(receipt,'A'))
 assert(!isProjectWriteReceipt(receipt,'B'))
 for(const delta of [{dataset:'tasks'},{revision:0},{revision:undefined},{recordId:'not-an-id'}])assert(!isProjectWriteReceipt({...receipt,...delta},'A'))
})
