import {test}from'node:test'
import assert from'node:assert/strict'
import{createRecordDetailReader}from'../supabase/functions/_shared/project-record-detail.ts'
const args={dataset:'cad',record_id:'cad',revision:3,path:['recipe','units']}
test('CAD section uses bounded server projection and never retrieves full record in Edge',async()=>{
 let full=0;const reader=createRecordDetailReader(async()=>{full++;throw Error('full read forbidden')},async()=>true,{projectId:'p',readSection:async(id,revision,path)=>({status:'ok',projectId:'p',record_id:id,revision,path,data:'mm'})})
 assert.equal((await reader.execute(args)).data,'mm');assert.equal(full,0)
})
test('CAD projection readback rejects a foreign identity/revision/path and oversized transport',async()=>{
 for(const patch of [{projectId:'other'},{record_id:'other'},{revision:2},{path:[]},{data:'x'.repeat(27000)}]){
  const r=createRecordDetailReader(async()=>null,async()=>true,{projectId:'p',readSection:async()=>({status:'ok',projectId:'p',record_id:'cad',revision:3,path:args.path,data:'mm',...patch})})
  assert.equal((await r.execute(args)).status,'unavailable')
 }
})
