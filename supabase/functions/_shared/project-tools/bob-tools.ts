import type { OperationalReader } from '../project-operations.ts'
import type { KnowledgeReader } from '../building-knowledge.ts'
import type { RecordDetailReader } from '../project-record-detail.ts'
import type { ProjectImageTools } from '../project-image-tools.ts'
import { SAVE_CAD_TOOL, type CadAssistant } from '../cad-assistant.ts'
import { SEARCH_TOOL, type createProjectLookup } from '../project-lookup.ts'
import { PROJECTION_TOOL } from '../project-building-plan.ts'
import { STAIR_INSPECT_TOOL } from '../project-stair.ts'
import { WRITE_TOOLS, type ProjectWriter } from '../project-write.ts'
import { HISTORY_TOOL, type WorkingContext } from '../bob-working-context.ts'
import type { ProjectContext } from '../project-context/dispatcher.ts'
import type { MaterialCatalogReader } from '../material-catalog.ts'
import { SAVE_COMPILED_PLAN_TOOL, type createPlanAssistant } from '../plan-assistant.ts'
import { createToolSession, type ToolDefinition, type ToolGate, type ToolPolicyReader } from './session.ts'

/** Sole handler-registration seam. Catalog names/forms/profiles are data; loading
 * never grants authority. New handlers register here, not in the model loop. */
export function createBobToolSession(opts: {
  lookup: ReturnType<typeof createProjectLookup>; writer?: ProjectWriter;
  knowledgeReader?: KnowledgeReader;
  context?: WorkingContext; projectContext?: ProjectContext; readPolicy: ToolPolicyReader;
  operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; planAssistant?: ReturnType<typeof createPlanAssistant>;
}) {
  const readGate = (): ToolGate => opts.lookup.remaining > 0 ? 'available' : 'budget_exhausted'
  const definitions: ToolDefinition[] = [
    { spec: SEARCH_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.search(v) },
    { spec: PROJECTION_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.inspectProjection(v) },
    { spec: STAIR_INSPECT_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.inspectStairs(v) },
    { spec: HISTORY_TOOL, version: 1, gate: () => !opts.context ? 'missing_context' : opts.context.history.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: v => opts.context!.history.search(v) },
    ...WRITE_TOOLS.map(spec => ({ spec, version: 1,
      gate: (): ToolGate => !opts.writer ? 'not_allowed'
        : spec.function.name==='propose_project_plan'&&opts.planAssistant?.compilationAttempted ? 'missing_context'
        : opts.writer.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.writer!.write(spec.function.name, v),
    })),
    ...(opts.projectContext?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => opts.projectContext!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.projectContext!.execute(spec.function.name, v),
    })),
    ...(opts.catalogReader?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => opts.catalogReader!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.catalogReader!.read(spec.function.name, v),
    })),
    ...(opts.operationalReader?.tools??[]).map(spec=>({spec,version:1,gate:():ToolGate=>opts.operationalReader!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.operationalReader!.execute(v)})),
    ...(opts.knowledgeReader?.tools??[]).map(spec=>({spec,version:1,gate:():ToolGate=>opts.knowledgeReader!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.knowledgeReader!.execute(v)})),
    ...(opts.recordReader?.tools??[]).map(spec=>({spec,version:1,gate:():ToolGate=>opts.recordReader!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.recordReader!.execute(v)})),
    ...(opts.imageTools?.tools??[]).map(spec=>({spec,version:1,gate:():ToolGate=>opts.imageTools!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.imageTools!.execute(spec.function.name,v)})),
    ...(opts.cadAssistant ? [
      ...opts.cadAssistant.tools.map(spec => ({spec,version:1,gate:():ToolGate=>opts.cadAssistant!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.cadAssistant!.consult(v)})),
      {spec:SAVE_CAD_TOOL,version:1,gate:():ToolGate=>!opts.writer?'not_allowed':opts.writer.remaining<=0?'budget_exhausted':opts.cadAssistant!.candidate?'available':'missing_context',execute:async(v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||typeof (v as any).request_quote!=='string')return {status:'invalid'}
        const c=opts.cadAssistant!.candidate;if(!c)return {status:'missing_context'}
        return opts.writer!.commit({kind:'cad',record_id:c.artifact_id,expected_updated_at:null,expected_revision:c.expected_revision,request_quote:(v as any).request_quote,data:c})
      }},
    ]:[]),
    ...(opts.planAssistant?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => opts.planAssistant!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.planAssistant!.consult(spec.function.name, v),
    })),
    ...(opts.planAssistant ? [{
      spec:SAVE_COMPILED_PLAN_TOOL,version:1,
      gate:():ToolGate=>!opts.writer?'not_allowed':opts.planAssistant!.canSave?'available':'missing_context',
      execute:async(v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||typeof (v as any).request_quote!=='string') return {status:'invalid',saved:false}
        const proposal=opts.planAssistant!.compiledProposal
        if(!proposal) return {status:'missing_context',saved:false}
        return opts.writer!.write('propose_project_plan',{...proposal,request_quote:(v as any).request_quote})
      },
    }] : []),
  ]
  return createToolSession({ definitions, readPolicy: opts.readPolicy })
}
