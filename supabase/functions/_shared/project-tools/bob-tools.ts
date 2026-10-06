import type { ConstructionTools } from '../construction-draft.ts'
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
import { createToolSession, type ToolDefinition, type ToolGate, type ToolPolicyReader, type ToolInstructions } from './session.ts'

/** Toolbox shelves, in presentation order. A shelf is orientation for Bob, not
 * authority; unknown tools land on the last shelf. */
export const TOOLBOX_SHELVES: { label: string; tools: string[] }[] = [
  { label: 'Project records and memory', tools: ['search_project_data', 'read_project_record_section', 'read_project_work', 'search_conversation_history'] },
  { label: 'Project, phases and Areas', tools: ['save_project_description', 'set_project_phase', 'update_project_schedule', 'save_project_area', 'archive_project_area'] },
  { label: 'Living plan', tools: ['compile_project_plan', 'edit_project_plan', 'audit_project_plan', 'save_compiled_project_plan', 'propose_project_plan', 'decide_project_plan', 'set_project_plan_focus', 'link_project_plan_task', 'link_project_plan_evidence'] },
  { label: 'Tasks and build days', tools: ['save_project_task', 'update_project_task_work', 'manage_task_readiness', 'delete_project_task', 'save_project_build_day', 'delete_project_build_day'] },
  { label: 'Measurements and design decisions', tools: ['save_project_measurement', 'archive_project_measurement', 'save_project_solution', 'select_project_target'] },
  { label: 'Drawings and CAD', tools: ['read_construction_draft', 'save_construction_draft', 'check_construction_draft', 'derive_construction_lists', 'design_project_cad', 'read_drawing_requests', 'read_drawing_request_work', 'link_drawing_gap', 'ensure_drawing_gap_task', 'cancel_drawing_request', 'restore_drawing_request', 'save_cad_design', 'link_project_drawing', 'save_project_building_plan', 'inspect_building_projection', 'save_project_stair', 'inspect_stair_options', 'create_project_room_layout', 'edit_project_room_layout', 'save_project_drawing'] },
  { label: 'Materials, stock and Shopping', tools: ['search_material_catalog', 'read_material_catalog', 'save_catalog_definition', 'manage_project_material', 'derive_cad_material_requirement', 'check_construction_cut_fit', 'delete_shopping_item'] },
  { label: 'Images and mockups', tools: ['list_project_category', 'open_project_item', 'describe_project_image', 'generate_project_image', 'attach_project_image', 'detach_project_image', 'finalize_project_image'] },
  { label: 'Building and site', tools: ['save_building_context'] },
  { label: 'Building knowledge', tools: ['search_building_knowledge'] },
]
const shelfOf = (name: string) => TOOLBOX_SHELVES.find(s => s.tools.includes(name))?.label ?? 'Other tools'

/** Sole handler-registration seam. Catalog names/descriptions are data; offering a
 * tool never grants authority. New handlers register here, not in the model loop. */
export function createBobToolSession(opts: {
  lookup: ReturnType<typeof createProjectLookup>; writer?: ProjectWriter;
  /** The owner's current message; when present, change provenance is server-filled. */
  message?: string;
  toolInstructions?: ToolInstructions;
  knowledgeReader?: KnowledgeReader;
  context?: WorkingContext; projectContext?: ProjectContext; readPolicy: ToolPolicyReader;
  operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; constructionTools?: ConstructionTools; planAssistant?: ReturnType<typeof createPlanAssistant>;
}) {
  const readGate = (): ToolGate => opts.lookup.remaining > 0 ? 'available' : 'budget_exhausted'
  const shelved = (def: ToolDefinition): ToolDefinition => ({ ...def, group: def.group ?? shelfOf(def.spec.function.name) })
  const registered: ToolDefinition[] = [
    { spec: SEARCH_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.search(v) },
    { spec: PROJECTION_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.inspectProjection(v) },
    { spec: STAIR_INSPECT_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.inspectStairs(v) },
    { spec: HISTORY_TOOL, version: 1, gate: () => !opts.context ? 'missing_context' : opts.context.history.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: v => opts.context!.history.search(v) },
    ...WRITE_TOOLS.map(spec => ({ spec, version: 1,
      ...(spec.function.name === 'propose_project_plan' ? { waitingFor: 'use save_compiled_project_plan for a plan compiled or edited in this turn' } : {}),
      gate: (): ToolGate => !opts.writer ? 'not_allowed'
        : spec.function.name==='propose_project_plan'&&opts.planAssistant?.compilationAttempted ? 'missing_context'
        : opts.writer.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.writer!.write(spec.function.name, v),
    })),
    ...(opts.projectContext?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => opts.projectContext!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.projectContext!.execute(spec.function.name, v),
    })),
    ...(opts.constructionTools?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => opts.constructionTools!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.constructionTools!.execute(spec.function.name, v),
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
      ...(opts.cadAssistant.lifecycleTools??[]).map(spec=>({spec,version:1,gate:():ToolGate=>opts.cadAssistant!.lifecycleRemaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.cadAssistant!.lifecycle(spec.function.name,v)})),
      ...opts.cadAssistant.tools.map(spec => ({spec,version:3,gate:():ToolGate=>opts.cadAssistant!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.cadAssistant!.consult(v)})),
      {spec:SAVE_CAD_TOOL,version:1,waitingFor:'appears when design_project_cad returns a reviewed candidate',
       gate:():ToolGate=>!opts.writer?'not_allowed':opts.writer.remaining<=0?'budget_exhausted':opts.cadAssistant!.candidate?'available':'missing_context',execute:async(v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||typeof (v as any).request_quote!=='string')return {status:'invalid'}
        const c=opts.cadAssistant!.candidate;if(!c)return {status:'missing_context'}
        const receipt=await opts.writer!.commit({kind:'cad',record_id:c.artifact_id,expected_updated_at:null,expected_revision:c.expected_revision,request_quote:(v as any).request_quote,data:c})
        if(receipt.status==='saved')await opts.cadAssistant!.markSaved()
        return receipt
      }},
    ]:[]),
    ...(opts.planAssistant?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => (spec.function.name==='edit_project_plan'?opts.planAssistant!.editRemaining:opts.planAssistant!.remaining) > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.planAssistant!.consult(spec.function.name, v),
    })),
    ...(opts.planAssistant ? [{
      spec:SAVE_COMPILED_PLAN_TOOL,version:1,waitingFor:'appears when compile_project_plan or edit_project_plan returns proposal_ready',
      gate:():ToolGate=>!opts.writer?'not_allowed':opts.writer.remaining<=0?'budget_exhausted':opts.planAssistant!.canSave?'available':'missing_context',
      execute:async(v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||typeof (v as any).request_quote!=='string') return {status:'invalid',saved:false}
        const proposal=opts.planAssistant!.compiledProposal
        if(!proposal) return {status:'missing_context',saved:false}
        return opts.writer!.write('propose_project_plan',{...proposal,request_quote:(v as any).request_quote})
      },
    }] : []),
  ]
  return createToolSession({ definitions: registered.map(shelved), readPolicy: opts.readPolicy, message: opts.message, toolInstructions: opts.toolInstructions })
}

/** Present shelves in their fixed order, and tools in shelf order. */
export function sortToolbox<T extends { name: string; group: string }>(entries: T[]): T[] {
  const shelfIndex = (group: string) => { const i = TOOLBOX_SHELVES.findIndex(s => s.label === group); return i < 0 ? TOOLBOX_SHELVES.length : i }
  const toolIndex = (e: T) => { const s = TOOLBOX_SHELVES.find(x => x.label === e.group); const i = s ? s.tools.indexOf(e.name) : -1; return i < 0 ? 999 : i }
  return entries.slice().sort((a, b) => shelfIndex(a.group) - shelfIndex(b.group) || toolIndex(a) - toolIndex(b) || (a.name < b.name ? -1 : 1))
}
