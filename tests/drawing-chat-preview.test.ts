import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createArtifacts} from '../src/data/artifacts.ts'
function fixture(extra:Record<string,any>={},guard=()=>{}){
 const reads:{table:string;columns:string;filters:Record<string,unknown>}[]=[]
 const rows:any={artifact_revision_details:{project_id:'A',artifact_id:'drawing',revision:3,title:'Barn',archived:false},artifacts:{current_revision:3},artifact_source_status:{source_state:'current',source_reasons:[]},views:{views:['front','isometric_front_left']},preview:{preview:'PHN2Zy8+'},...extra}
 const client={from:(table:string)=>{
  let columns='',filters:Record<string,unknown>={}
  const chain={select:(s:string)=>{columns=s;return chain},eq:(k:string,v:unknown)=>{filters[k]=v;return chain},maybeSingle:async()=>{
   reads.push({table,columns,filters})
   const key=table==='artifact_cad_revisions'?columns==='views:recipe->views'?'views':'preview':table
   if(rows[key]?.error)return {data:null,error:rows[key].error}
   return {data:rows[key]??null,error:null}
  }};return chain
 }}
 return {adapter:createArtifacts(client as any,()=>guard),reads}
}
test('chat reads only the exact saved view through the canonical data owner; no full files or recipe',async()=>{
 const f=fixture(),result=await f.adapter.chatPreview('A','drawing',3)
 assert.equal(result?.svg,'PHN2Zy8+');assert.equal(result?.view,'isometric_front_left');assert.equal(result?.revision,3)
 for(const read of f.reads){assert.equal(read.filters.project_id,'A');assert(!read.columns.includes('*'));assert(!read.columns.includes('step'));assert(!read.columns.includes('manifest'))}
 assert.equal(f.reads.at(-1)?.columns,'preview:files->>isometric_front_left')
 assert.equal(f.reads.at(-1)?.filters.artifact_revision,3)
})
test('historical drawings retain their exact revision and source warning',async()=>{
 const f=fixture({artifacts:{current_revision:4},artifact_source_status:{source_state:'changed',source_reasons:['construction_source_changed']}})
 const result=await f.adapter.chatPreview('A','drawing',3)
 assert.equal(result?.revision,3);assert.equal(result?.latestRevision,4);assert.equal(result?.sourceStatus.source_state,'changed');assert(result?.svg)
})
test('unknown or denied sources withhold image bytes and never substitute a latest drawing',async()=>{
 for(const status of [null,{source_state:'unavailable',source_reasons:[]},{source_state:'invented'}]){
  const f=fixture({artifact_source_status:status}),result=await f.adapter.chatPreview('A','drawing',3)
  assert.equal(result?.svg,null);assert.equal(result?.sourceStatus.source_state,'unavailable');assert.equal(f.reads.length,4)
 }
 await assert.rejects(fixture({artifact_source_status:{error:{message:'permission denied'}}}).adapter.chatPreview('A','drawing',3))
})
test('construction receipts do not become broken drawings, and scope/access changes fail closed',async()=>{
 assert.equal(await fixture({views:null}).adapter.chatPreview('A','drawing',3),null)
 await assert.rejects(fixture({artifact_revision_details:null}).adapter.chatPreview('A','drawing',3),/unavailable/)
 await assert.rejects(fixture({artifact_revision_details:{project_id:'B',artifact_id:'drawing',revision:3}}).adapter.chatPreview('A','drawing',3),/mismatch/)
 let guards=0
 await assert.rejects(fixture({},()=>{if(++guards>2)throw Error('project_changed')}).adapter.chatPreview('A','drawing',3),/project_changed/)
})

test('preview respects the saved camera ordering instead of imposing another side',async()=>{
 const f=fixture({views:{views:['isometric','front','isometric_front_left','top']}})
 assert.equal((await f.adapter.chatPreview('A','drawing',3))?.view,'isometric')
 assert.equal(f.reads.at(-1)?.columns,'preview:files->>isometric')
})
