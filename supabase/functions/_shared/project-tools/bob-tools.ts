import { SUPERSEDED_PLAN_LINK_TOOLS, type PlanLinks } from '../project-plan-links.ts'
import type { BuildingScope } from '../project-building-scope.ts'
import { SUPERSEDED_WORK_TOOLS, WORK_RECORD_TOOLS_V2, WORK_VALUE_TOOL_NAMES, type WorkRecords } from '../project-work-records.ts'
import type { SolutionActions } from '../project-solution-actions.ts'
import type { ProjectEdits } from '../project-edits.ts'
import type { ConstructionTools } from '../construction-draft.ts'
import type { AiCatalogSession } from '../ai-catalog.ts'
import type { OrientationDirectoryReader } from '../bob-orientation-directory.ts'
import { bobColleagues, bobWorkflows } from '../bob-prompt.ts'
import { hasCalculatorContract, type ProjectCalculator } from '../project-calculator.ts'
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
import { READ_HISTORY_TOOL } from '../bob-memory-retrieval.ts'
import type { ProjectContext } from '../project-context/dispatcher.ts'
import type { MaterialCatalogReader } from '../material-catalog.ts'
import { SAVE_COMPILED_PLAN_TOOL, type createPlanAssistant } from '../plan-assistant.ts'
import { createToolSession, type ToolDefinition, type ToolGate, type ToolPolicyReader, type ToolInstructions } from './session.ts'
import { TASK_SOURCES_TOOL, readTaskSources } from '../task-sources.ts'
import { SOURCE_FINDINGS_TOOL, sourceReaderEnabled, type SourceReader } from '../source-reader.ts'

/** Toolbox shelves, in presentation order. A shelf is orientation for Bob, not
 * authority; unknown tools land on the last shelf. */
export const TOOLBOX_SHELVES: { label: string; tools: string[] }[] = [
  { label: 'Project records and memory', tools: ['change_task_readiness', 'read_work_context', 'edit_work_record', 'create_work_record', 'change_work_relation', 'change_work_state', 'read_model_feedback', 'record_model_feedback', 'read_solution_context', 'create_solution_alternative', 'select_solution_alternative', 'change_solution_evidence', 'read_project_edit_context', 'edit_project_record', 'search_project_data', 'read_project_orientation', 'read_project_record_section', 'read_project_work', 'search_conversation_history', 'read_conversation_message'] },
  { label: 'Project, phases and Areas', tools: ['save_project_description', 'set_project_phase', 'update_project_schedule', 'save_project_area', 'archive_project_area'] },
  { label: 'Living plan', tools: ['read_plan_link_context', 'change_plan_focus', 'change_plan_task_link', 'compile_project_plan', 'edit_project_plan', 'audit_project_plan', 'save_compiled_project_plan', 'propose_project_plan', 'decide_project_plan', 'set_project_plan_focus', 'link_project_plan_task', 'link_project_plan_evidence'] },
  { label: 'Tasks and build days', tools: ['save_project_task', 'update_project_task_work', 'manage_task_readiness', 'delete_project_task', 'save_project_build_day', 'delete_project_build_day'] },
  { label: 'Measurements and design decisions', tools: ['save_project_measurement', 'archive_project_measurement', 'save_project_solution', 'select_project_target'] },
  { label: 'Calculations', tools: ['calculate_project'] },
  { label: 'Drawings and CAD', tools: ['read_construction_delivery', 'read_construction_draft', 'save_construction_draft', 'edit_construction_parts', 'change_construction_parameters', 'transition_legacy_drawing', 'change_construction_roles', 'read_construction_changes', 'continue_construction_change', 'check_construction_draft', 'derive_construction_lists', 'design_project_cad', 'plan_cad_pieces', 'compose_cad_shell', 'read_cad_shell', 'link_cad_shell_steps', 'read_drawing_requests', 'read_drawing_request_work', 'link_drawing_gap', 'ensure_drawing_gap_task', 'cancel_drawing_request', 'restore_drawing_request', 'save_cad_design', 'link_project_drawing', 'save_project_building_plan', 'inspect_building_projection', 'save_project_stair', 'inspect_stair_options', 'create_project_room_layout', 'edit_project_room_layout', 'save_project_drawing'] },
  { label: 'Materials, stock and Shopping', tools: ['search_material_catalog', 'read_material_catalog', 'save_catalog_definition', 'manage_project_material', 'derive_cad_material_requirement', 'check_construction_cut_fit', 'save_construction_cut_plan', 'delete_shopping_item'] },
  { label: 'Images and mockups', tools: ['list_project_category', 'open_project_item', 'describe_project_image', 'generate_project_image', 'attach_project_image', 'detach_project_image', 'finalize_project_image'] },
  { label: 'Building and site', tools: ['read_building_scope', 'change_building_scope', 'save_building_context'] },
  { label: 'Building knowledge', tools: ['search_building_knowledge'] },
]
const shelfOf = (name: string) => TOOLBOX_SHELVES.find(s => s.tools.includes(name))?.label ?? 'Other tools'

/** Sole handler-registration seam. Catalog names/descriptions are data; offering a
 * tool never grants authority. New handlers register here, not in the model loop. */
/** Loaded from the first step of a turn whose thread has a pending drawing
 * request: the construction-drawing tools every such turn on 2026-10-20 read
 * one or a few at a time (7 manual loads each for read/check/design). */
/** Loaded from the first step of new turns: the project reading tools Bob
 * otherwise loaded with a separate describe_tool step first (2026-10-19..25:
 * 38 of 57 turns began with a manual-only step; these three were the most
 * loaded). Offering is not authority: policy and gates still apply. */
export const CORE_READ_PRELOAD = ['search_project_data', 'list_project_category', 'open_project_item']
/** The pinned catalog owns the small permanent bench, including discovery.
 * Descriptions and schemas still resolve through the normal catalog binding. */
export function catalogCoreTools(catalog: AiCatalogSession): string[] | null {
  const names = catalog.definition('bob.tools', 'tool_contract').definition.core_tools
  if (names === undefined) return null // Existing pinned jobs retain their preload behavior.
  if (!Array.isArray(names) || names.length < 1 || names.length > 6 || !names.includes('describe_tool')
    || new Set(names).size !== names.length || names.some(name => typeof name !== 'string'
      || !catalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + name && row.definition_kind === 'tool_contract')))
    throw new Error('core_tool_catalog_invalid')
  return names as string[]
}
/** Loaded from the first step when the project links no whole building
 * (2026-10-25: Bob answered from project data alone and missed the house). */
export const BUILDING_SCOPE_PRELOAD = ['read_building_scope', 'change_building_scope']
export const DRAWING_CONTINUATION_PRELOAD = ['read_construction_draft', 'check_construction_draft', 'design_project_cad',
  'read_drawing_requests', 'read_drawing_request_work', 'read_construction_changes', 'change_construction_parameters',
  'edit_construction_parts', 'save_cad_design']

export function createBobToolSession(opts: {
  aiCatalog?: AiCatalogSession;
  /** Tools of work already in progress, loaded without a describe_tool round. */
  preloadTools?: () => string[];
  calculator?: ProjectCalculator;
  orientationReader?: OrientationDirectoryReader;
  lookup: ReturnType<typeof createProjectLookup>; writer?: ProjectWriter;
  /** The owner's current message; when present, change provenance is server-filled. */
  message?: string;
  toolInstructions?: ToolInstructions;
  knowledgeReader?: KnowledgeReader;
  context?: WorkingContext; projectContext?: ProjectContext; readPolicy: ToolPolicyReader;
  /** FORM small source reader; offered only where a publication enables it. */
  sourceReader?: SourceReader;
  operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; constructionTools?: ConstructionTools; projectEdits?: ProjectEdits; solutionActions?: SolutionActions; workRecords?: WorkRecords; planLinks?: PlanLinks; buildingScope?: BuildingScope; planAssistant?: ReturnType<typeof createPlanAssistant>;
}) {
  const writeGate = (): ToolGate => !opts.writer ? 'not_allowed' : opts.writer.uncertain ? 'write_uncertain' : opts.writer.remaining > 0 ? 'available' : 'budget_exhausted'
  const readGate = (): ToolGate => opts.lookup.remaining > 0 ? 'available' : 'budget_exhausted'
  const boundEdits = !!opts.projectEdits && (!opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.edit_project_record'))
  const boundPlanLinks = !!opts.planLinks && (!opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.change_plan_task_link'))
  const boundWork = !!opts.workRecords && (!opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.edit_work_record'))
  const boundSolutions = !!opts.solutionActions && (!opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.create_solution_alternative'))
  const workVersion = (name: string): 1 | 2 => (WORK_VALUE_TOOL_NAMES as readonly string[]).includes(name)
    && opts.aiCatalog?.manifest().definitions.some(row => row.prompt_key === 'tools.' + name
      && (row.definition.envelope as { schema_version?: unknown })?.schema_version === 2) ? 2 : 1
  const refreshWorkValidation = opts.aiCatalog?.manifest().definitions.some(row => row.prompt_key === 'agent-contract.ask-bob'
    && [1, 2, 3].includes(row.metadata.work_completion_version as number)) ?? false
  const shelves = opts.aiCatalog?.definition('bob.tools', 'tool_contract').definition.shelves as typeof TOOLBOX_SHELVES | undefined
  const shelved = (def: ToolDefinition): ToolDefinition => ({ ...def, group: def.group ?? (shelves ? shelves.find(s => s.tools.includes(def.spec.function.name))?.label ?? 'Other tools' : shelfOf(def.spec.function.name)) })
  const registered: ToolDefinition[] = [
    { spec: SEARCH_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.search(v) },
    ...(opts.orientationReader ? opts.orientationReader.tools.map(spec => ({ spec, version: 1,
      gate: (): ToolGate => 'available', execute: (v: unknown) => opts.orientationReader!.execute(v) })) : []),
    { spec: PROJECTION_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.inspectProjection(v) },
    { spec: STAIR_INSPECT_TOOL, version: 1, gate: readGate, execute: v => opts.lookup.inspectStairs(v) },
    ...(opts.calculator&&(!opts.aiCatalog||hasCalculatorContract(opts.aiCatalog))?opts.calculator.tools.map(spec=>({spec,version:1,
      gate:():ToolGate=>opts.calculator!.remaining>0?'available':'budget_exhausted',execute:(v:unknown)=>opts.calculator!.execute(v)})):[]),
    { spec: HISTORY_TOOL, version: 1, gate: () => !opts.context ? 'missing_context' : opts.context.history.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: v => opts.context!.history.search(v) },
    ...(opts.context?.history.read && (!opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.read_conversation_message'))
      ? [{ spec: READ_HISTORY_TOOL, version: 1, gate: (): ToolGate => 'available', execute: (v: unknown) => opts.context!.history.read!(v) }] : []),
    ...(opts.projectEdits?.tools ?? []).filter(spec => !opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + spec.function.name)).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => spec.function.name === 'edit_project_record' ? writeGate() : opts.projectEdits!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.projectEdits!.execute(spec.function.name, v),
    })),
    ...(opts.solutionActions?.tools ?? []).filter(spec => !opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + spec.function.name)).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => ['read_solution_context', 'read_model_feedback'].includes(spec.function.name) ? opts.solutionActions!.remaining > 0 ? 'available' : 'budget_exhausted' : writeGate(),
      execute: (v: unknown) => opts.solutionActions!.execute(spec.function.name, v),
    })),
    ...(opts.workRecords?.tools ?? []).filter(spec => !opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + spec.function.name)).map(spec => ({
      spec: workVersion(spec.function.name) === 2 ? WORK_RECORD_TOOLS_V2.find(tool => tool.function.name === spec.function.name)! : spec,
      version: workVersion(spec.function.name),
      gate: (): ToolGate => spec.function.name === 'read_work_context' ? opts.workRecords!.remaining > 0 ? 'available' : 'budget_exhausted' : writeGate(),
      execute: (v: unknown) => opts.workRecords!.execute(spec.function.name, v, workVersion(spec.function.name), refreshWorkValidation),
    })),
    ...(opts.planLinks?.tools ?? []).filter(spec => !opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + spec.function.name)).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => spec.function.name === 'read_plan_link_context' ? opts.planLinks!.remaining > 0 ? 'available' : 'budget_exhausted' : writeGate(),
      execute: (v: unknown) => opts.planLinks!.execute(spec.function.name, v),
    })),
    // Only manifests that publish these contracts offer them; older pinned
    // manifests keep their own bench.
    ...(opts.buildingScope?.tools ?? []).filter(spec => !opts.aiCatalog || opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.' + spec.function.name)).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => spec.function.name === 'read_building_scope' ? opts.buildingScope!.remaining > 0 ? 'available' : 'budget_exhausted' : writeGate(),
      execute: (v: unknown) => opts.buildingScope!.execute(spec.function.name, v),
    })),
    ...WRITE_TOOLS.map(spec => ({ spec, version: spec.function.name === 'save_project_solution' ? 2 : 1,
      ...(spec.function.name === 'propose_project_plan' ? { waitingFor: opts.aiCatalog?.text('tools.waiting.plan-direct') ?? 'use save_compiled_project_plan for a plan compiled or edited in this turn' } : {}),
      gate: (): ToolGate => !opts.writer ? 'not_allowed'
        : boundPlanLinks && SUPERSEDED_PLAN_LINK_TOOLS.includes(spec.function.name) ? 'not_allowed'
        : boundWork && SUPERSEDED_WORK_TOOLS.includes(spec.function.name) ? 'not_allowed'
        : boundSolutions && ['save_project_solution', 'select_project_target'].includes(spec.function.name) ? 'not_allowed'
        : boundEdits && spec.function.name === 'save_project_description' ? 'not_allowed'
        : boundEdits && spec.function.name === 'save_project_solution' && opts.writer.unresolvedTools.includes('edit_project_record') ? 'missing_context'
        : spec.function.name==='propose_project_plan'&&opts.planAssistant?.compilationAttempted ? 'missing_context'
        : writeGate(),
      execute: (v: unknown) => boundEdits && spec.function.name === 'save_project_solution' && !!v && typeof v === 'object' && 'record_id' in v && v.record_id !== null
        ? opts.writer!.commitBound('edit_project_record', 'unbound', null).then(result => ({ ...result, message: 'No change made. Read the existing solution with read_project_edit_context and revise it through edit_project_record. Never create an alternative to repair a failed edit.' }))
        : opts.writer!.write(spec.function.name, v),
    })),
    ...(opts.projectContext?.tools ?? []).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => opts.projectContext!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.projectContext!.execute(spec.function.name, v),
    })),
    // New handlers can be installed before catalog activation; an older
    // durable manifest keeps its own bench instead of failing on the new row.
    ...(opts.constructionTools?.tools ?? []).filter(spec=>!['edit_construction_parts','change_construction_parameters','transition_legacy_drawing','change_construction_roles','read_construction_changes','continue_construction_change','read_construction_delivery'].includes(spec.function.name)||!opts.aiCatalog||opts.aiCatalog.manifest().definitions.some(row=>row.prompt_key==='tools.'+spec.function.name)).map(spec => ({ spec, version: 1,
      gate: (): ToolGate => ['save_construction_draft','edit_construction_parts','change_construction_parameters','transition_legacy_drawing','change_construction_roles','continue_construction_change','save_construction_cut_plan'].includes(spec.function.name) && writeGate() !== 'available' ? writeGate() : opts.constructionTools!.remaining > 0 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.constructionTools!.execute(spec.function.name, v),
    })),
    // FORM package 3 source packet: registered only where a publication carries
    // its contract; its policy stays inactive until owner-approved acceptance.
    ...(opts.aiCatalog?.manifest().definitions.some(row => row.prompt_key === 'tools.read_task_sources') ? [{ spec: TASK_SOURCES_TOOL, version: 1,
      gate: (): ToolGate => opts.lookup.remaining >= 2 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => readTaskSources(v, { projectId: opts.lookup.exportState().projectId, search: q => opts.lookup.search(q as any),
        construction: opts.constructionTools ? q => opts.constructionTools!.execute('read_construction_draft', q) : undefined }) }] : []),
    // Registered only with an enabled reader role; its policy gates the offer.
    ...(opts.sourceReader && opts.aiCatalog && sourceReaderEnabled(opts.aiCatalog) ? [{ spec: SOURCE_FINDINGS_TOOL, version: 1,
      gate: (): ToolGate => opts.sourceReader!.remaining > 0 && opts.lookup.remaining >= 2 ? 'available' : 'budget_exhausted',
      execute: (v: unknown) => opts.sourceReader!.execute(v, { search: q => opts.lookup.search(q as any),
        construction: opts.constructionTools ? q => opts.constructionTools!.execute('read_construction_draft', q) : undefined }) }] : []),
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
      {spec:SAVE_CAD_TOOL,version:1,readyContinuation:true,waitingFor:opts.aiCatalog?.text('tools.waiting.cad-ready') ?? 'appears when design_project_cad returns a reviewed candidate',
       gate:():ToolGate=>writeGate()!=='available'?writeGate():opts.cadAssistant!.candidate?'available':'missing_context',execute:async(v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||typeof (v as any).request_quote!=='string')return {status:'invalid'}
        const ready=await opts.cadAssistant!.candidateForSave();if(ready.status!=='ready')return ready
        const c=ready.candidate
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
      spec:SAVE_COMPILED_PLAN_TOOL,version:1,readyContinuation:true,waitingFor:opts.aiCatalog?.text('tools.waiting.plan-ready') ?? 'appears when compile_project_plan or edit_project_plan returns proposal_ready',
      gate:():ToolGate=>writeGate()!=='available'?writeGate():opts.planAssistant!.canSave?'available':'missing_context',
      execute:async(v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||typeof (v as any).request_quote!=='string') return {status:'invalid',saved:false}
        const proposal=opts.planAssistant!.compiledProposal
        if(!proposal) return {status:'missing_context',saved:false}
        // The plan colleague wrote this text; Bob cannot rewrite it in this call.
        return opts.writer!.write('propose_project_plan',{...proposal,request_quote:(v as any).request_quote},{humanText:false})
      },
    }] : []),
  ]
  return createToolSession({ definitions: registered.map(shelved), readPolicy: opts.readPolicy, message: opts.message, toolInstructions: opts.toolInstructions, ...(opts.preloadTools ? { preloadTools: opts.preloadTools } : {}),
    ...(opts.aiCatalog?.manifest().definitions.some(row=>row.prompt_key==='bob.tools'&&row.metadata?.construction_work_version===1)?{
      autoLoadReady:true,followups:opts.aiCatalog.definition('bob.tools','tool_contract').definition.operation_followups as import('./session.ts').ToolFollowup[],
    }:{}),
    selectiveTools: opts.aiCatalog?.manifest().definitions.some(row => row.prompt_key === 'bob.workflows' && row.metadata?.selective_tools_version === 1),
    ...(opts.aiCatalog ? { catalogTool: (name, parameters) => opts.aiCatalog!.tool(name, parameters),
      ...(opts.toolInstructions === 'lazy' ? { catalogColleagues: (name: string) => bobColleagues(opts.aiCatalog!, [name]),
        catalogWorkflows: () => bobWorkflows(opts.aiCatalog!) } : {}),
      feedback: (key, variables) => opts.aiCatalog!.text('tools.feedback.' + key, variables),
      catalogToolVersion: name => {
        const version = (opts.aiCatalog!.definition('tools.' + name, 'tool_contract').definition.envelope as { schema_version?: unknown })?.schema_version
        if (!Number.isSafeInteger(version) || Number(version) < 1) throw new Error('tool_catalog_unavailable')
        return Number(version)
      } } : {}) })
}

/** Present shelves in their fixed order, and tools in shelf order. */
export function sortToolbox<T extends { name: string; group: string }>(entries: T[], shelves = TOOLBOX_SHELVES): T[] {
  const shelfIndex = (group: string) => { const i = shelves.findIndex(s => s.label === group); return i < 0 ? shelves.length : i }
  const toolIndex = (e: T) => { const s = shelves.find(x => x.label === e.group); const i = s ? s.tools.indexOf(e.name) : -1; return i < 0 ? 999 : i }
  return entries.slice().sort((a, b) => shelfIndex(a.group) - shelfIndex(b.group) || toolIndex(a) - toolIndex(b) || (a.name < b.name ? -1 : 1))
}
