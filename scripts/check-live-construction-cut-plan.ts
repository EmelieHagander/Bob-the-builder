// One natural-language saved-plan model trial, through ordinary member Auth.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { planTestConfig, requirePlanTestMember } from './check-live-plan-assistant.mjs'
import { constructionCutFit } from '../supabase/functions/_shared/construction-cut-fit.ts'
import { constructionLists } from '../supabase/functions/_shared/construction-lists.ts'
import { K3_PROJECT, K4_SOURCE, K4_DRAWING } from './run-live-construction-drawing.mjs'
import { K4_CUT_PLAN_PREVIOUS_TURN, K4_SAVED_CUT_PLAN_TURN, K4_SAVED_CUT_PLAN_ID, assertK4CutFitCheckpoint } from './k4-cut-fit-checkpoint.mjs'

const { url, key, token, memberId } = planTestConfig({ ...process.env, BOB_PLAN_LIVE_CONFIRM: process.env.BOB_K4_LIVE_CONFIRM })
const readOnly = process.env.BOB_K4_VERIFY_ONLY === 'saved-plan'
const projectId = process.env.BOB_K4_PROJECT_ID
assert.equal(projectId, K3_PROJECT)
const client = createClient(url, key, { db: { schema: 'bob' }, global: { headers: { Authorization: 'Bearer ' + token },
 fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) }, auth: { persistSession: false, autoRefreshToken: false } })
const checked = (r: any) => { assert(!r.error, 'Caller request failed; inspect this same turn without exposing credentials'); return r.data }
const rows = async (table: string) => checked(await client.from(table).select('*').eq('project_id', projectId))
const stable = (data: any[]) => [...data].sort((a, b) => String(a.requirement_id ?? a.artifact_id ?? a.id).localeCompare(String(b.requirement_id ?? b.artifact_id ?? b.id)) || (a.revision ?? 0) - (b.revision ?? 0))
await requirePlanTestMember(client, token, memberId)
const project = checked(await client.from('projects').select('id,name,type').eq('id', projectId).single())
assert(project.type === 'Verification' && project.name.startsWith('K2 model acceptance '))
const original = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
assert(original.source_state === 'current' && original.current_revision === 4 && !original.archived)
const before = await rows('current_material_requirements'), beforeSources = await rows('material_requirement_construction_sources'), beforeHistory = await rows('material_requirement_revisions')
assertK4CutFitCheckpoint(before, beforeSources, beforeHistory)
const protectedTables = ['material_requirement_stock', 'material_requirement_components', 'material_requirement_shopping', 'materials', 'stock_revisions', 'artifact_cad_revisions']
const snapshots = new Map<string, any[]>()
for (const table of protectedTables) snapshots.set(table, await rows(table))
assert.equal(snapshots.get('artifact_cad_revisions')!.length, 1)
assert.equal(snapshots.get('artifact_cad_revisions')![0].artifact_id, K4_DRAWING)
for (const table of protectedTables.filter(t => !['artifact_cad_revisions', 'stock_revisions'].includes(t))) assert.equal(snapshots.get(table)!.length, 0)
for (const table of ['material_cut_plans','material_cut_plan_revisions','material_cut_plan_requirements']) assert.equal((await rows(table)).length, readOnly ? (table === 'material_cut_plan_requirements' ? 2 : 1) : 0, 'Inspect any existing saved plan before submitting another model turn')
const tool = checked(await client.from('tool_catalog').select('active,schema_version').eq('name', 'save_construction_cut_plan').single())
assert(tool.active && tool.schema_version === 1)
const thread = checked(await client.from('bob_threads').select('id').eq('project_id', projectId).eq('owner_user_id', memberId).eq('status', 'active').single())
const previous = checked(await client.from('bob_messages').select('turn_id,delivery_state').eq('thread_id', thread.id).eq('role', 'user').order('seq', { ascending: false }).limit(1).single())
assert.equal(previous.turn_id, readOnly ? K4_SAVED_CUT_PLAN_TURN : K4_CUT_PLAN_PREVIOUS_TURN); assert.equal(previous.delivery_state, 'completed')
assert.equal(checked(await client.rpc('bob_job_status', { p_project: projectId, p_turn: previous.turn_id })).status, 'completed')
const report: any = { projectId, sourceArtifact: K4_SOURCE, sourceRevision: 4, startedAt: new Date().toISOString(),
 priorTurn: previous.turn_id, readOnly, modelSubmitted: !readOnly, modelSemanticsReviewRequired: true,
 notProven: ['physical stock/product', 'optimal purchase count', 'reservations/Shopping', 'hardware/tool access', 'fabrication/strength'] }
const reportPath = process.env.BOB_K4_REPORT ?? 'test-results/live-construction-cut-plan.json'
try {
 const turn = readOnly ? K4_SAVED_CUT_PLAN_TURN : randomUUID(); report.turn = turn
 if (!readOnly) {
 const message = 'Fortsätt med samma sparade hylla och de två befintliga materialbehoven. Spara nu den konkreta kapplanen som vi just provade för en föreslagen plywoodskiva 2440 × 1220 × 21 mm, med 3 mm sågspår och 5 mm kanttrim på varje sida. Skivans fibrer går längs 2440 mm, gavlarnas längs 800 mm och hyllplanens längs 658 mm. Formatet är en uttrycklig hypotetisk provspecifikation, inte uppmätt eller tillgängligt lager och inte ett verifierat köpobjekt. Utgå från aktuell sparad konstruktionsrevision och exakt sparat material. Knyt planen till båda befintliga behoven utan att ändra deras identiteter, versioner eller historik. Återöppna det sparade resultatet och redovisa alla fem delars placeringar och kapordning samt vad som faktiskt sparats. Skapa inga lagerposter, gör ingen ny konstruktion eller ritning, reservera inget och skicka inget till Shopping. Fysisk materialkontroll, skruvprodukter och åtkomlig montering ska kvarstå som luckor; inget påstående om tillverkningsklart underlag.'
 console.log(JSON.stringify({ projectId, turn, status: 'submitting_once' }))
 const accepted = checked(await client.functions.invoke('ask-bob', { body: { action: 'send', projectId, clientTurnId: turn, message, background: true } }))
 assert.equal(accepted.status, 'accepted'); assert(accepted.jobId)
 report.jobId = accepted.jobId
 console.log(JSON.stringify({ projectId, turn, jobId: accepted.jobId, status: 'accepted' }))
 const until = Math.min(Date.now() + 12 * 60000, Date.parse(accepted.expiresAt) - 30000)
 let completed = false, nextProgress = Date.now() + 30000
 while (Date.now() < until) {
  const job = checked(await client.rpc('bob_job_status', { p_project: projectId, p_turn: turn }))
  report.jobStatus = job.status
  if (job.status === 'failed') throw Error('The same saved-plan job failed; inspect it before any paid retry')
  if (job.status === 'completed') { completed = true; break }
  if (Date.now() > nextProgress) { console.log(JSON.stringify({ turn, status: job.status })); nextProgress = Date.now() + 30000 }
  await delay(5000)
 }
 assert(completed, 'Timed out: inspect this same job, never submit a duplicate')
 } else { report.jobId = '1babf718-a586-4bf0-973a-9af75d08084f'; report.jobStatus = 'completed' }
 const requirements = await rows('current_material_requirements'), sources = await rows('material_requirement_construction_sources'), history = await rows('material_requirement_revisions')
 assertK4CutFitCheckpoint(requirements, sources, history)
 assert.deepEqual(stable(requirements), stable(before)); assert.deepEqual(stable(sources), stable(beforeSources)); assert.deepEqual(stable(history), stable(beforeHistory))
 for (const table of protectedTables) assert.deepEqual(stable(await rows(table)), stable(snapshots.get(table)!))
 const after = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
 assert.equal(after.current_revision, 4); assert.equal(after.source_state, 'current')
 for (const key of ['recipe', 'joints', 'materials', 'parameters', 'open_questions']) assert.deepEqual(after[key], original[key])
 const answer = checked(await client.from('bob_messages').select('text,evidence,delivery_state').eq('thread_id', thread.id).eq('turn_id', turn).eq('role', 'assistant').single())
 assert.equal(answer.delivery_state, 'completed'); assert.equal(typeof answer.text, 'string'); assert(answer.text.length > 100)
 const heads = await rows('material_cut_plans'), planHistory = await rows('material_cut_plan_revisions'), links = await rows('material_cut_plan_requirements')
 assert.equal(heads.length, 1); assert.equal(planHistory.length, 1); assert.equal(links.length, 2)
 const readStart = Date.now()
 const plan = checked(await client.rpc('read_material_cut_plan', { p_project: projectId, p_plan: heads[0].id, p_revision: 1 }))
 report.planReadMs = Date.now() - readStart
 if (readOnly) assert.equal(plan.id, K4_SAVED_CUT_PLAN_ID)
 assert.equal(plan.id, heads[0].id); assert.equal(plan.revision, 1); assert.equal(plan.current_revision, 1); assert.equal(plan.source_state, 'current')
 assert.equal(plan.artifact_id, K4_SOURCE); assert.equal(plan.artifact_revision, 4)
 assert.deepEqual(plan.requirements.map((p: any) => p.id).sort(), before.map(r => r.id).sort()); assert(plan.requirements.every((p: any) => p.revision === 1))
 assert.equal(plan.candidates.length, 1)
 const candidate = plan.candidates[0]
 for (const [key, expected] of Object.entries({ material_id: '766d4e1a-db42-4a0e-af25-da2739783fc4', material_revision: 1, length_mm: 2440, width_mm: 1220, thickness_mm: 21, count: 1, kerf_mm: 3, trim_mm: 5, grain: 'length', basis: 'provided_spec' })) assert.equal(candidate[key], expected)
 assert.deepEqual(plan.candidate_sources, [{ candidate_id: candidate.id, kind: 'hypothetical', record_id: null, revision: null }])
 assert.deepEqual([...plan.blank_grain].sort((a: any,b: any)=>a.definition_id.localeCompare(b.definition_id)), [{ definition_id: 'shelf_panel', axis: 'x' }, { definition_id: 'side_panel', axis: 'z' }])
 for (const key of ['stock_reserved','shopping_ready','fabrication_ready','input_evidence_verified']) assert.equal(plan[key], false)
 assert.equal(plan.saved, true); assert.equal(plan.capacity[0].available_sheets, null)
 const catalog = checked(await client.rpc('catalog_read', { p_project: projectId, p_input: { action: 'read', id: candidate.material_id, revision: 1, kind: null, query: null, after: null, profile_code: null, categories: [], properties: {} } }))
 const expected: any = constructionCutFit(constructionLists(original, new Map([[candidate.material_id + '@1', catalog.record]]), []), plan.candidates, plan.blank_grain)
 assert.equal(expected.status, 'feasible')
 for (const key of ['placements','cuts','offcuts','used_sheets']) assert.deepEqual(plan.layout[key], expected[key])
 assert.equal(plan.layout.placements.length, 5); assert.equal(plan.layout.cuts.length, 10)
 const writes = answer.evidence?.writes ?? []
 assert.equal(writes.length, 1); assert.equal(writes[0].dataset, 'cut_plans'); assert.equal(writes[0].recordId, plan.id); assert.equal(writes[0].revision, 1)
 // Repeat ordinary HTTP readback with the same session; no model request or writes.
 if (readOnly) {
  report.readbackMs = [report.planReadMs]
  for (let i=0;i<2;i++) { const start=Date.now(); const reread=checked(await client.rpc('read_material_cut_plan',{p_project:projectId,p_plan:plan.id,p_revision:1})); report.readbackMs.push(Date.now()-start); assert.deepEqual(reread,plan) }
 }
 report.cutPlanId = plan.id; report.cutPlanRevision = plan.revision; report.savedPlan = plan
 report.answer = answer.text; report.answerPartial = answer.evidence?.partial ?? null
 report.recordPreservationPassed = true; report.passed = true
} catch {
 // Provider/assertion bodies may contain private data. The durable turn above
 // identifies the same job for diagnosis even after an uncertain HTTP response.
 report.passed = false; report.error = 'Saved-plan verification stopped; inspect this same turn and caller readback before any retry'; process.exitCode = 1
} finally {
 report.finishedAt = new Date().toISOString(); await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({ projectId, turn: report.turn, jobId: report.jobId, status: report.jobStatus, passed: report.passed, modelSemanticsReviewRequired: true }))
}
