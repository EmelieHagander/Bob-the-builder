import {test} from 'node:test'
import assert from 'node:assert/strict'
import {boundDrawingArguments,drawingWorkerSpec,resolveDrawingWork,validDrawingWork,type DrawingWork} from '../supabase/functions/_shared/drawing-work.ts'
import {DESIGN_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
const c='10000000-0000-4000-8000-000000000001',d='20000000-0000-4000-8000-000000000001',q='30000000-0000-4000-8000-000000000001'
const source={artifact_id:c,revision:5},drawing={artifact_id:d,revision:2}
const work:DrawingWork={projectId:'A',construction:source,drawing,area_id:null,component_id:null,step_id:null,request_id:null}
function ports(extra:any={}){return {
 readConstruction:async(id:string|null)=>id?{status:'ok',projectId:'A',...source,source_state:'current',archived:false}:{status:'ok',projectId:'A',items:[{id:c,revision:5}],next_cursor:null,truncated:false},
 readDrawing:async()=>({...drawing,archived:false,construction_source:{artifact_id:c,revision:4},current_step_ids:[]}),
 linkedDrawings:async()=>[drawing],requests:async()=>[],loadRequest:async()=>null,...extra}}
test('server resolves the same drawing from the newer exact construction; a completed request is not selected',async()=>{
 const result=await resolveDrawingWork('A',[source],undefined,ports({requests:async()=>[{id:q,project_id:'A',status:'saved',scope:{artifact_id:d}}]}))
 assert.deepEqual(result,{status:'ready',binding:work})
 assert.deepEqual(await resolveDrawingWork('A',[source],drawing,ports()),result,'focused old drawing follows its exact freshly read source revision, preserving drawing identity')
})
test('missing explicit reads can only bind a unique complete project construction list',async()=>{
 assert.equal((await resolveDrawingWork('A',[],undefined,ports())).status,'ready')
 for(const changed of [{next_cursor:'more'},{truncated:true},{projectId:'B'}])
  assert.equal((await resolveDrawingWork('A',[],undefined,ports({readConstruction:async()=>({status:'ok',projectId:'A',items:[source],...changed})}))).reason,'construction_selection_unavailable')
})
test('wrong project, stale source, ambiguous identities or incomplete requests stop before dispatch',async()=>{
 const cases=[
  [ports({readConstruction:async()=>({status:'ok',projectId:'B',...source})}),'construction_source_unavailable'],
  [ports({readConstruction:async()=>({status:'ok',projectId:'A',...source,revision:6,source_state:'current'})}),'construction_revision_changed'],
  [ports({linkedDrawings:async()=>[drawing,{artifact_id:q,revision:1}]}),'drawing_selection_ambiguous'],
  [ports({readDrawing:async()=>({...drawing,revision:3})}),'drawing_revision_changed'],
  [ports({requests:async()=>Array(12).fill({})}),'drawing_requests_incomplete'],
  [ports({readDrawing:async()=>({...drawing,current_step_ids:['one','two']})}),'drawing_work_scope_ambiguous'],
 ] as const
 for(const [p,reason]of cases)assert.equal((await resolveDrawingWork('A',[source],undefined,p)).reason,reason)
 assert.equal((await resolveDrawingWork('A',[source,{artifact_id:q,revision:1}],undefined,ports())).reason,'construction_selection_ambiguous')
})
test('active request selection is exact, private and code-owned; paused or alias scopes are not guessed',async()=>{
 const pending={id:q,project_id:'A',status:'draft',scope:{artifact_id:d}}
 const p=ports({requests:async()=>[pending],loadRequest:async()=>({id:q,status:'draft',payload:{brief:{artifact_id:d}}})})
 assert.equal((await resolveDrawingWork('A',[source],undefined,p)).binding?.request_id,q)
 assert.equal((await resolveDrawingWork('A',[source],undefined,ports({...p,requests:async()=>[pending,pending]}))).reason,'drawing_request_ambiguous')
 assert.equal((await resolveDrawingWork('A',[source],undefined,ports({...p,loadRequest:async()=>({id:q,status:'paused'})}))).reason,'drawing_request_not_active')
 assert.equal((await resolveDrawingWork('A',[source],undefined,ports({...p,loadRequest:async()=>({id:q,status:'draft',payload:{brief:{artifact_id:c}}})}))).reason,'drawing_request_scope_changed')
})
test('Rita cannot supply source, destination, work or request IDs, including forged extra arguments',()=>{
 const spec=drawingWorkerSpec(DESIGN_CAD_TOOL),hidden=['request_id','artifact_id','construction_revision','area_id','component_id','step_id']
 for(const key of hidden){assert(!(key in (spec.function.parameters.properties as any)));assert(!(spec.function.parameters.required as string[]).includes(key));assert.equal(boundDrawingArguments('design_project_cad',{[key]:'forged'},work),null)}
 const args=boundDrawingArguments('design_project_cad',{brief:'Show front',handoff:{requirements:[]},views:['front']},work)!
 assert.equal(args.artifact_id,d);assert.equal(args.construction_revision,5);assert.equal(args.request_id,null)
 assert.equal(boundDrawingArguments('design_project_cad',{handoff:'invented'}, {...work,request_id:q})?.handoff,null,'resume preserves server-stored requirements')
 assert.deepEqual(boundDrawingArguments('read_construction_draft',{view:'parts'},work),{view:'parts',...source})
 assert(validDrawingWork(work,'A'));assert(!validDrawingWork(work,'B'));assert(!validDrawingWork({...work,construction:{...source,revision:0}},'A'))
})
