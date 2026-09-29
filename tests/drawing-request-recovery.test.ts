import {test} from 'node:test'
import assert from 'node:assert/strict'
import {drawingInputFingerprint} from '../supabase/functions/_shared/drawing-request-recovery.ts'
import {handoff} from './support/cad-review-fixture.ts'

test('P2 retry identity ignores clocks and prose but preserves source facts, image versions and scope',async()=>{
 const brief={request_id:null,brief:'Draw',handoff,area_id:null,step_id:null,component_id:null,artifact_id:null}
 const evidence={status:'ok',retrievedAt:'2026-09-01',records:[{id:'m',revision:1,value:'100',unit:'mm'}]}
 const images={versions:[['image:a','v1']]}
 const original=await drawingInputFingerprint(brief,evidence,images)
 assert.equal(await drawingInputFingerprint({...brief,request_id:'request',brief:'Please continue'},{...evidence,retrievedAt:'2026-09-02'},images),original)
 assert.equal(await drawingInputFingerprint({...brief,handoff:{...handoff,views:[...handoff.views].reverse()}},evidence,images),original)
 assert.notEqual(await drawingInputFingerprint(brief,{...evidence,records:[{...evidence.records[0],revision:2}]},images),original)
 assert.notEqual(await drawingInputFingerprint(brief,{...evidence,records:[{...evidence.records[0],value:'101'}]},images),original)
 assert.notEqual(await drawingInputFingerprint(brief,evidence,{versions:[['image:a','v2']]}),original)
 assert.notEqual(await drawingInputFingerprint({...brief,step_id:'new-step'},evidence,images),original)
 assert.notEqual(await drawingInputFingerprint(brief,{...evidence,status:'unavailable'},images),original)
})
