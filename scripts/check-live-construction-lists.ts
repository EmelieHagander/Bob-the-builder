// Continue the retained K2/K3 fixture with a real named member, not seeded calls.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { planTestConfig, requirePlanTestMember } from './check-live-plan-assistant.mjs'
import { K3_PROJECT, K4_SOURCE, K4_DRAWING } from './run-live-construction-drawing.mjs'
import { K4_SAVED_REQUIREMENT, K4_RECOVERY_TURN, assertK4RecoveryCheckpoint } from './k4-recovery-checkpoint.mjs'

const { url, key, token, memberId } = planTestConfig({ ...process.env, BOB_PLAN_LIVE_CONFIRM: process.env.BOB_K4_LIVE_CONFIRM })
const projectId = process.env.BOB_K4_PROJECT_ID
assert.equal(projectId, K3_PROJECT)
const client = createClient(url, key, { db: { schema: 'bob' }, global: { headers: { Authorization: 'Bearer ' + token },
 fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) }, auth: { persistSession: false, autoRefreshToken: false } })
const checked = (r: any) => { assert(!r.error, 'Caller read/write failed; inspect the same scoped job without exposing credentials'); return r.data }
await requirePlanTestMember(client, token, memberId)
const project = checked(await client.from('projects').select('id,name,type').eq('id', projectId).single())
assert(project.type === 'Verification' && project.name.startsWith('K2 model acceptance '))
const original = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
assert(original.source_state === 'current' && original.current_revision === 4 && !original.archived)
const before = checked(await client.from('current_material_requirements').select('*').eq('project_id', projectId))
const beforeSources = checked(await client.from('material_requirement_construction_sources').select('*').eq('project_id', projectId))
const beforeHistory = checked(await client.from('material_requirement_revisions').select('*').eq('project_id', projectId))
assertK4RecoveryCheckpoint(before, beforeSources, beforeHistory)
for (const table of ['material_requirement_stock', 'material_requirement_components', 'materials'])
 assert.equal(checked(await client.from(table).select('*').eq('project_id', projectId)).length, 0)
const report: any = { projectId, sourceArtifact: K4_SOURCE, sourceRevision: 4, startedAt: new Date().toISOString(),
 recoveryOf: K4_RECOVERY_TURN, preservedRequirement: K4_SAVED_REQUIREMENT,
 notProven: ['raw-stock cutting fit/kerf/grain', 'hardware quantities/products', 'assembly tool access', 'fabrication/strength', 'Shopping', 'another participant/mobile'] }
const reportPath = process.env.BOB_K4_REPORT ?? 'test-results/live-construction-lists.json'
try {
 const turn = randomUUID()
 const message = 'Fortsätt samma uppdrag för den sparade hyllkonstruktionen och dess ritning efter förra skrivfelet. Gavlarnas behov om två obearbetade delar är redan sparat och ska behålla samma identitet, version och innehåll. Läs aktuella behov och slutför enbart det saknade behovet om tre liggande skivor i Material plan, räknat i antal obearbetade delar utan extra spill eller avrundning. Återläs båda behoven och redovisa stycklista, lokala kapmått och föreslagen monteringsordning för samma konstruktion. Behåll konstruktionens, delarnas och förbandens identiteter och mått; gör ingen ny konstruktion eller ritning och skriv inte om gavelbehovet. Råformat, sågspår, fiberriktning, skruvprodukter och verktygsåtkomst är inte bestämda och ska vara tydliga kvarstående luckor. Antal delar är inte antal inköpsskivor. Reservera inget lager och skicka inget till Shopping. Detta är fortsatt ett koncept, inte tillverkningsklart.'
 const accepted = checked(await client.functions.invoke('ask-bob', { body: { action: 'send', projectId, clientTurnId: turn, message, background: true } }))
 assert.equal(accepted.status, 'accepted'); assert(accepted.jobId)
 Object.assign(report, { turn, jobId: accepted.jobId })
 console.log(JSON.stringify({ projectId, turn, jobId: accepted.jobId, status: 'accepted' }))
 const until = Math.min(Date.now() + 12 * 60000, Date.parse(accepted.expiresAt) - 30000)
 let completed = false, nextProgress = Date.now() + 30000
 while (Date.now() < until) {
  const job = checked(await client.rpc('bob_job_status', { p_project: projectId, p_turn: turn }))
  report.jobStatus = job.status
  if (job.status === 'failed') throw Error('The same K4 job failed; inspect it before any paid retry')
  if (job.status === 'completed') { completed = true; break }
  if (Date.now() > nextProgress) { console.log(JSON.stringify({ turn, status: job.status })); nextProgress = Date.now() + 30000 }
  await delay(5000)
 }
 assert(completed, 'Timed out: inspect this same job, never submit a duplicate')
 const requirements = checked(await client.from('current_material_requirements').select('*').eq('project_id', projectId))
 const sources = checked(await client.from('material_requirement_construction_sources').select('*').eq('project_id', projectId))
 const retained = requirements.find((r: any) => r.id === K4_SAVED_REQUIREMENT)
 assert.deepEqual(retained, before[0], 'Recovery must not rewrite the retained need')
 assert.deepEqual(sources.filter((s: any) => s.requirement_id === K4_SAVED_REQUIREMENT), beforeSources)
 const retainedHistory = checked(await client.from('material_requirement_revisions').select('*').eq('project_id', projectId).eq('requirement_id', K4_SAVED_REQUIREMENT))
 assert.deepEqual(retainedHistory, beforeHistory, 'Recovery must preserve the original history exactly')
 const used = original.recipe.definitions.filter((d: any) => original.recipe.instances.some((i: any) => i.definition_id === d.id))
 assert.equal(requirements.length, used.length); assert.equal(sources.length, used.length)
 for (const d of used) {
  const rows = sources.filter((s: any) => s.definition_id === d.id)
  assert.equal(rows.length, 1)
  const source = rows[0], requirement = requirements.find((r: any) => r.id === source.requirement_id)
  const ids = original.recipe.instances.filter((i: any) => i.definition_id === d.id).map((i: any) => i.id).sort()
  assert(requirement && !requirement.archived && !requirement.target_changed && !requirement.artifact_changed)
  assert.equal(source.artifact_id, K4_SOURCE); assert.equal(source.artifact_revision, 4); assert.equal(source.requirement_revision, requirement.revision)
  assert.equal(source.quantity_mode, 'pieces'); assert.deepEqual(source.instance_ids, ids)
  assert.deepEqual(source.blank_mm, { x: d.x_mm, y: d.y_mm, z: d.z_mm })
  assert.deepEqual(source.material_binding, original.materials.find((m: any) => m.definition_id === d.id))
  assert.equal(Number(requirement.required_quantity), ids.length); assert.equal(Number(requirement.purchase_quantity), ids.length)
  assert.equal(Number(requirement.waste_percent), 0); assert.equal(Number(requirement.purchase_increment), 1)
  assert.equal(requirement.unit, 'pcs'); assert.equal(requirement.source_kind, 'deterministic'); assert.equal(requirement.method_key, 'construction_blank_pieces')
  assert.equal(requirement.method_version, '1'); assert.equal(requirement.artifact_id, K4_SOURCE); assert.equal(requirement.artifact_revision, 4)
  const reopened = checked(await client.rpc('read_project_work', { p_project: projectId, p_input: { resource: 'requirement', record_id: requirement.id, after_id: null } })).records[0]
  assert.equal(reopened.id, requirement.id); assert.equal(reopened.revision, requirement.revision); assert.equal(Number(reopened.required_quantity), ids.length)
 }
 for (const table of ['material_requirement_stock', 'material_requirement_components', 'materials'])
  assert.equal(checked(await client.from(table).select('*').eq('project_id', projectId)).length, 0, 'No allocation or Shopping from unverified blanks')
 const drawings = checked(await client.from('artifact_cad_revisions').select('artifact_id,artifact_revision').eq('project_id', projectId))
 assert.deepEqual(drawings, [{ artifact_id: K4_DRAWING, artifact_revision: 1 }])
 const after = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
 assert.equal(after.current_revision, 4); assert.deepEqual(after.recipe, original.recipe); assert.deepEqual(after.joints, original.joints); assert.deepEqual(after.materials, original.materials)
 const thread = checked(await client.from('bob_threads').select('id').eq('project_id', projectId).eq('owner_user_id', memberId).eq('status', 'active').single())
 const answer = checked(await client.from('bob_messages').select('evidence,delivery_state').eq('thread_id', thread.id).eq('turn_id', turn).eq('role', 'assistant').single())
 assert.equal(answer.delivery_state, 'completed')
 // This flag also covers truncated context reads; exact delivery is checked
 // above against caller-visible records, provenance and unchanged history.
 report.answerPartial = answer.evidence?.partial ?? null
 const receiptData = answer.evidence?.writes
 assert(Array.isArray(receiptData)); assert(!receiptData.some((r: any) => r.recordId === K4_SAVED_REQUIREMENT), 'No new write receipt for the retained need')
 assert(requirements.filter((r: any) => r.id !== K4_SAVED_REQUIREMENT).every((r: any) => receiptData.some((receipt: any) => receipt.recordId === r.id && receipt.revision === r.revision)))
 report.requirements = requirements.map((r: any) => ({ id: r.id, revision: r.revision, quantity: r.required_quantity, source: r.artifact_id, sourceRevision: r.artifact_revision }))
 report.sources = sources; report.passed = true; report.receipts = receiptData
} catch (error) {
 report.passed = false; report.error = error instanceof Error ? error.message : 'K4 acceptance failed'; process.exitCode = 1
} finally {
 report.finishedAt = new Date().toISOString(); await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({ projectId, turn: report.turn, status: report.jobStatus, passed: report.passed }))
}
