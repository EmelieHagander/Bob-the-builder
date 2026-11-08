import type { ToolSpec } from './project-tools/session.ts'

export type ConstructionRef = { artifact_id:string; revision:number }
export type DrawingWork = {
 projectId:string; construction:ConstructionRef; drawing:ConstructionRef|null;
 area_id:string|null; component_id:string|null; step_id:string|null; request_id:string|null;
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)
export const validConstructionRef=(v:any):v is ConstructionRef=>!!v&&uuid(v.artifact_id)&&Number.isSafeInteger(v.revision)&&v.revision>0&&Object.keys(v).sort().join(',')==='artifact_id,revision'
export function validDrawingWork(v:any,projectId:string):v is DrawingWork {
 return !!v&&Object.keys(v).sort().join(',')==='area_id,component_id,construction,drawing,projectId,request_id,step_id'&&v.projectId===projectId&&validConstructionRef(v.construction)&&(v.drawing===null||validConstructionRef(v.drawing))
  &&[v.area_id,v.component_id,v.step_id].every(x=>x===null||typeof x==='string'&&x.length>0&&x.length<=200)
  &&(v.request_id===null||uuid(v.request_id))
}
const fields:Record<string,string[]>={
 design_project_cad:['request_id','artifact_id','construction_revision','area_id','component_id','step_id'],
 read_construction_draft:['artifact_id','revision'],read_drawing_requests:['request_id','after_id'],
}
/** Worker routing belongs to the server. Neither a native schema nor a forged
 * tool call can replace the source, destination, work links or request. */
export function drawingWorkerSpec(spec:ToolSpec):ToolSpec {
 const hidden=fields[spec.function.name];if(!hidden)return spec
 const out=structuredClone(spec),parameters=out.function.parameters as any
 out.function.description={
  design_project_cad:'Render the saved construction bound to this drawing job. Choose views and describe the requested deliverable; source, destination, work links and request identity are supplied by code. A ready candidate still needs save_cad_design.',
  read_construction_draft:'Read pages of this drawing job’s exact construction revision. Use view, ids and returned cursors to inspect its saved parts, sources and results.',
  read_drawing_requests:'Read the saved request bound to this drawing job. A new job without a request returns its binding; completed historical requests are not selected.',
 }[spec.function.name]??out.function.description
 for(const key of hidden)delete parameters.properties?.[key]
 if(Array.isArray(parameters.required))parameters.required=parameters.required.filter((key:string)=>!hidden.includes(key))
 return out
}
export function boundDrawingArguments(name:string,raw:unknown,work:DrawingWork):Record<string,unknown>|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
 const args=raw as Record<string,unknown>
 if(fields[name]?.some(key=>Object.hasOwn(args,key)))return null
 if(name==='design_project_cad')return {...args,request_id:work.request_id,artifact_id:work.drawing?.artifact_id??work.construction.artifact_id,
  construction_revision:work.construction.revision,area_id:work.area_id,component_id:work.component_id,step_id:work.step_id,
  ...(work.request_id?{handoff:null}: {})}
 if(name==='read_construction_draft')return {...args,...work.construction}
 return {...args}
}

export async function resolveDrawingWork(projectId:string,sources:ConstructionRef[],focus:ConstructionRef|undefined,ports:{
 readConstruction:(id:string|null,revision:number|null)=>Promise<any>;
 readDrawing:(id:string,revision:number|null)=>Promise<any>;
 linkedDrawings:(sourceId:string)=>Promise<ConstructionRef[]>;
 requests:()=>Promise<unknown>;loadRequest:(id:string)=>Promise<any>;
}):Promise<{status:string;binding?:DrawingWork;reason?:string}>{
 const stop=(reason:string)=>({status:'needs_data',reason})
 let selected:ConstructionRef|undefined,focusedDrawing:ConstructionRef|undefined
 if(focus){
  const drawing=await ports.readDrawing(focus.artifact_id,null)
  if(drawing){
   if(drawing.revision!==focus.revision||drawing.archived)return stop('drawing_revision_changed')
   const source=drawing.construction_source??drawing.manifest?.bob_construction
   if(!source||!validConstructionRef({artifact_id:source.artifact_id,revision:source.revision}))return stop('drawing_construction_link_unavailable')
   selected=sources.find(ref=>ref.artifact_id===source.artifact_id)??{artifact_id:source.artifact_id,revision:source.revision};focusedDrawing=focus
  }else selected=focus
 }else{
  const unique=new Map(sources.map(s=>[s.artifact_id,s]))
  if(!unique.size){
   const list=await ports.readConstruction(null,null)
   if(list?.projectId!==projectId||list.status!=='ok'||!Array.isArray(list.items)||list.next_cursor||list.truncated)return stop('construction_selection_unavailable')
   for(const row of list.items){
    const ref={artifact_id:row.id,revision:row.revision}
    if(!validConstructionRef(ref))return stop('construction_selection_unavailable')
    unique.set(ref.artifact_id,ref)
   }
  }
  if(unique.size!==1)return stop(unique.size?'construction_selection_ambiguous':'construction_source_required')
  selected=[...unique.values()][0]
 }
 const current=await ports.readConstruction(selected.artifact_id,null)
 if(current?.projectId!==projectId||current.status!=='ok'||current.artifact_id!==selected.artifact_id||current.archived||current.source_state!=='current')return stop('construction_source_unavailable')
 if(current.revision!==selected.revision)return stop('construction_revision_changed')
 const linked=await ports.linkedDrawings(selected.artifact_id)
 if(linked.some(ref=>!validConstructionRef(ref)))return stop('drawing_binding_unavailable')
 const drawings=[...new Map(linked.map(ref=>[ref.artifact_id,ref])).values()]
 if(focusedDrawing&&!drawings.some(d=>d.artifact_id===focusedDrawing!.artifact_id&&d.revision===focusedDrawing!.revision))return stop('drawing_construction_link_changed')
 if(!focusedDrawing&&drawings.length>1)return stop('drawing_selection_ambiguous')
 const destination=focusedDrawing??drawings[0]??null
 const detail=destination?await ports.readDrawing(destination.artifact_id,null):null
 if(destination&&(!detail||detail.revision!==destination.revision||detail.archived))return stop('drawing_revision_changed')
 // A drawing linked to several plan steps keeps its links: a save with no
 // step changes none (the earlier path does the same). Refusing it left the
 // bed drawing that serves two steps impossible to redraw (Våningssäng 2,
 // 2026-11-08: every redraw stopped here, no drawing).
 const steps=detail?.current_step_ids
 const artifactId=destination?.artifact_id??selected.artifact_id
 const pending=await ports.requests()
 // The store's current list is bounded at twelve. Never infer absence from an
 // incomplete page and create a second operation for an omitted request.
 if(!Array.isArray(pending)||pending.length>=12)return stop('drawing_requests_incomplete')
 const matches=pending.filter(row=>row.project_id===projectId&&!['saved','cancelled'].includes(row.status)
  &&[artifactId,selected!.artifact_id].includes(row.scope?.artifact_id))
 if(matches.length>1)return stop('drawing_request_ambiguous')
 let requestId:string|null=null
 if(matches.length){
  const request=await ports.loadRequest(matches[0].id)
  if(!request||request.id!==matches[0].id||['saved','cancelled','paused'].includes(request.status))return stop('drawing_request_not_active')
  if(request.payload?.brief?.artifact_id!==artifactId)return stop('drawing_request_scope_changed')
  requestId=request.id
 }
 const binding:DrawingWork={projectId,construction:selected,drawing:destination,request_id:requestId,
  area_id:detail?.area_id??current.area_id??null,component_id:detail?.component_id??null,
  step_id:Array.isArray(steps)?steps.length===1?steps[0]:null:detail?.step_id??null}
 if(!validDrawingWork(binding,projectId))return stop('drawing_binding_unavailable')
 return {status:'ready',binding}
}
