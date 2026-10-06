// One natural-language read-only model trial, through ordinary member Auth.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { planTestConfig, requirePlanTestMember } from './check-live-plan-assistant.mjs'
import { K3_PROJECT, K4_SOURCE, K4_DRAWING } from './run-live-construction-drawing.mjs'
import { K4_CUT_FIT_PREVIOUS_TURN, assertK4CutFitCheckpoint } from './k4-cut-fit-checkpoint.mjs'

const { url, key, token, memberId } = planTestConfig({ ...process.env, BOB_PLAN_LIVE_CONFIRM: process.env.BOB_K4_LIVE_CONFIRM })
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
const tool = checked(await client.from('tool_catalog').select('active,schema_version').eq('name', 'check_construction_cut_fit').single())
assert(tool.active && tool.schema_version === 1)
const thread = checked(await client.from('bob_threads').select('id').eq('project_id', projectId).eq('owner_user_id', memberId).eq('status', 'active').single())
const previous = checked(await client.from('bob_messages').select('turn_id,delivery_state').eq('thread_id', thread.id).eq('role', 'user').order('seq', { ascending: false }).limit(1).single())
assert.equal(previous.turn_id, K4_CUT_FIT_PREVIOUS_TURN); assert.equal(previous.delivery_state, 'completed')
assert.equal(checked(await client.rpc('bob_job_status', { p_project: projectId, p_turn: previous.turn_id })).status, 'completed')
const report: any = { projectId, sourceArtifact: K4_SOURCE, sourceRevision: 4, startedAt: new Date().toISOString(),
 priorTurn: previous.turn_id, modelSemanticsReviewRequired: true,
 notProven: ['physical stock/product', 'optimal purchase count', 'persisted cut plan', 'reservations/Shopping', 'hardware/tool access', 'fabrication/strength'] }
const reportPath = process.env.BOB_K4_REPORT ?? 'test-results/live-construction-cut-fit.json'
try {
 const turn = randomUUID(); report.turn = turn
 const message = 'Fortsätt med samma sparade hylla och de två befintliga materialbehoven. Undersök om alla fem obearbetade delarna går att kapa ur en föreslagen plywoodskiva 2440 × 1220 × 21 mm. Räkna med 3 mm sågspår och 5 mm kanttrim på varje sida. Skivans fiberriktning går längs 2440-måttet; gavlarna ska ha fibrerna längs sina 800 mm och hyllplanen längs sina 658 mm. Detta är uttryckliga provspecifikationer, inte uppmätt lager eller ett verifierat köpobjekt. Gör en konkret kapkontroll mot den aktuella sparade konstruktionsrevisionen och redovisa varje dels placering, mått och kapordningen. Kontrollera sedan ett alternativ på 10000 × 299 × 21 mm med samma sågspår och längsgående fibrer, men utan kanttrim: kan delarna tas ut trots att den totala arean räcker? Använd sparade delar och materialrevisioner och ge kontrollens faktiska resultat för båda formaten; en summerad area räcker inte som bevis. Bevara båda sparade behovens identiteter, versioner och historik. Spara inga nya poster, gör ingen ny konstruktion eller ritning, reservera inget lager och skicka inget till Shopping. Håll fysisk materialkontroll, skruvprodukter och åtkomlig montering som kvarstående luckor och gör inget påstående om tillverkningsklart underlag.'
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
  if (job.status === 'failed') throw Error('The same cut-fit job failed; inspect it before any paid retry')
  if (job.status === 'completed') { completed = true; break }
  if (Date.now() > nextProgress) { console.log(JSON.stringify({ turn, status: job.status })); nextProgress = Date.now() + 30000 }
  await delay(5000)
 }
 assert(completed, 'Timed out: inspect this same job, never submit a duplicate')
 const requirements = await rows('current_material_requirements'), sources = await rows('material_requirement_construction_sources'), history = await rows('material_requirement_revisions')
 assertK4CutFitCheckpoint(requirements, sources, history)
 assert.deepEqual(stable(requirements), stable(before)); assert.deepEqual(stable(sources), stable(beforeSources)); assert.deepEqual(stable(history), stable(beforeHistory))
 for (const table of protectedTables) assert.deepEqual(stable(await rows(table)), stable(snapshots.get(table)!))
 const after = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
 assert.equal(after.current_revision, 4); assert.equal(after.source_state, 'current')
 for (const key of ['recipe', 'joints', 'materials', 'parameters', 'open_questions']) assert.deepEqual(after[key], original[key])
 const answer = checked(await client.from('bob_messages').select('text,evidence,delivery_state').eq('thread_id', thread.id).eq('turn_id', turn).eq('role', 'assistant').single())
 assert.equal(answer.delivery_state, 'completed'); assert.equal(typeof answer.text, 'string'); assert(answer.text.length > 100)
 assert.equal(answer.evidence?.writes?.length ?? 0, 0, 'A read-only test must not produce writes')
 report.answer = answer.text; report.answerPartial = answer.evidence?.partial ?? null
 report.recordPreservationPassed = true; report.passed = true
} catch {
 // Provider/assertion bodies may contain private data. The durable turn above
 // identifies the same job for diagnosis even after an uncertain HTTP response.
 report.passed = false; report.error = 'Cut-fit trial stopped; inspect this same turn and caller readback before any retry'; process.exitCode = 1
} finally {
 report.finishedAt = new Date().toISOString(); await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({ projectId, turn: report.turn, jobId: report.jobId, status: report.jobStatus, passed: report.passed, modelSemanticsReviewRequired: true }))
}
