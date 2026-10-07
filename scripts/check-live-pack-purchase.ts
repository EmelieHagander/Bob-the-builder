// One natural-language K4 pack-purchase model trial, through ordinary member Auth.
// Bob derives the screw need from the saved shelf, records the cited product and
// publishes whole packs to Shopping. Code re-derives the pack arithmetic.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { planTestConfig, requirePlanTestMember } from './check-live-plan-assistant.mjs'
import { K3_PROJECT, K4_SOURCE } from './run-live-construction-drawing.mjs'
import { K4_SAVED_CUT_PLAN_TURN, K4_SAVED_CUT_PLAN_ID, assertK4CutFitCheckpoint } from './k4-cut-fit-checkpoint.mjs'

const SOURCE_URL = 'https://www.byggmax.se/traskruv-5-0x80-mm-c4-249581'
const { url, key, token, memberId } = planTestConfig({ ...process.env, BOB_PLAN_LIVE_CONFIRM: process.env.BOB_K4_LIVE_CONFIRM })
const projectId = process.env.BOB_K4_PROJECT_ID
assert.equal(projectId, K3_PROJECT)
const client = createClient(url, key, { db: { schema: 'bob' }, global: { headers: { Authorization: 'Bearer ' + token },
 fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) }, auth: { persistSession: false, autoRefreshToken: false } })
const checked = (r: any) => { assert(!r.error, 'Caller request failed; inspect this same turn without exposing credentials'); return r.data }
const rows = async (table: string) => checked(await client.from(table).select('*').eq('project_id', projectId))
const stable = (data: any[]) => [...data].sort((a, b) => String(a.requirement_id ?? a.article_id ?? a.id).localeCompare(String(b.requirement_id ?? b.article_id ?? b.id)) || (a.revision ?? 0) - (b.revision ?? 0))
await requirePlanTestMember(client, token, memberId)
const project = checked(await client.from('projects').select('id,name,type').eq('id', projectId).single())
assert(project.type === 'Verification' && project.name.startsWith('K2 model acceptance '))
const before = await rows('current_material_requirements'), beforeSources = await rows('material_requirement_construction_sources'), beforeHistory = await rows('material_requirement_revisions')
assertK4CutFitCheckpoint(before, beforeSources, beforeHistory)
const beforeIds = new Set(before.map((r: any) => r.id))
// Physical stock, reservations and construction geometry must not move.
const protectedTables = ['material_requirement_stock', 'material_requirement_components', 'material_requirement_shopping', 'stock_revisions', 'artifact_cad_revisions', 'material_cut_plans', 'material_cut_plan_revisions', 'material_cut_plan_requirements']
const snapshots = new Map<string, any[]>()
for (const table of protectedTables) snapshots.set(table, await rows(table))
for (const table of ['supplier_articles', 'pack_purchases', 'materials']) assert.equal((await rows(table)).length, 0, 'Inspect existing product/Shopping state before submitting another model turn')
const original = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
assert(original.source_state === 'current' && original.current_revision === 4)
const screwed = original.joints.filter((j: any) => j.method === 'screwed_butt').length
const thread = checked(await client.from('bob_threads').select('id').eq('project_id', projectId).eq('owner_user_id', memberId).eq('status', 'active').single())
const previous = checked(await client.from('bob_messages').select('turn_id,delivery_state').eq('thread_id', thread.id).eq('role', 'user').order('seq', { ascending: false }).limit(1).single())
assert.equal(previous.turn_id, K4_SAVED_CUT_PLAN_TURN); assert.equal(previous.delivery_state, 'completed')
const report: any = { projectId, sourceArtifact: K4_SOURCE, sourceRevision: 4, savedCutPlan: K4_SAVED_CUT_PLAN_ID, screwedJoints: screwed,
 startedAt: new Date().toISOString(), priorTurn: previous.turn_id, modelSubmitted: true, modelSemanticsReviewRequired: true,
 notProven: ['screw count per joint (estimate)', 'screw suitability/strength', 'price/availability', 'physical stock', 'purchase/delivery'] }
const reportPath = process.env.BOB_K4_REPORT ?? 'test-results/live-pack-purchase.json'
try {
 const turn = randomUUID(); report.turn = turn
 const message = 'Fortsätt med samma sparade hylla. Den ska skruvas ihop och jag vill att du gör skruvbehovet till en del av planen. '
  + 'Räkna fram hur många träskruvar 5,0 × 80 mm som behövs utifrån de skruvade fogarna i den aktuella sparade konstruktionen. Gör en egen rimlig uppskattning per fog och spara den som ett nytt materialbehov i styck, med uppskattningen och dess antaganden tydligt angivna som uppskattning. '
  + `Produktkälla, avläst från Byggmax produktsida ${SOURCE_URL} i dag: Träskruv 5,0x80 mm C4, härdad träskruv med försänkt huvud för användning inomhus och utomhus. `
  + 'Sidan visar förpackningarna 15 st, 200 st och 700 st. Bara 15-styckspaketet visar artikelnummer: ART.NR 249687, 40,95 kr. För 200 och 700 st visas inget artikelnummer. '
  + 'Välj förpackning själv, spara produkten med bara de uppgifter som källan faktiskt anger, och publicera ett förpackningsköp till Shopping för skruvbehovet. '
  + 'Inga skruvar finns i lager hos mig; skapa inga lagerposter. Ändra inte de två befintliga skivbehoven, konstruktionen eller den sparade kapplanen. '
  + 'Läs tillbaka det sparade köpet och redovisa antal förpackningar, totalt behov, överskott och vad som är uppskattat respektive hämtat från källan. Inget påstående om att skruven är verifierad för hållfasthet.'
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
  if (job.status === 'failed') throw Error('The same pack job failed; inspect it before any paid retry')
  if (job.status === 'completed') { completed = true; break }
  if (Date.now() > nextProgress) { console.log(JSON.stringify({ turn, status: job.status })); nextProgress = Date.now() + 30000 }
  await delay(5000)
 }
 assert(completed, 'Timed out: inspect this same job, never submit a duplicate')
 const answer = checked(await client.from('bob_messages').select('text,evidence,delivery_state').eq('thread_id', thread.id).eq('turn_id', turn).eq('role', 'assistant').single())
 assert.equal(answer.delivery_state, 'completed'); assert.equal(typeof answer.text, 'string'); assert(answer.text.length > 100)
 report.answer = answer.text; report.answerPartial = answer.evidence?.partial ?? null
 // Existing blanks, construction, cut plan and physical stock are unchanged.
 const requirements = await rows('current_material_requirements'), history = await rows('material_requirement_revisions')
 assert.deepEqual(stable(requirements.filter((r: any) => beforeIds.has(r.id))), stable(before))
 assert.deepEqual(stable(await rows('material_requirement_construction_sources')), stable(beforeSources))
 assert.deepEqual(stable(history.filter((r: any) => beforeIds.has(r.requirement_id))), stable(beforeHistory))
 for (const table of protectedTables) assert.deepEqual(stable(await rows(table)), stable(snapshots.get(table)!), `${table} changed`)
 const after = checked(await client.rpc('read_construction_draft', { p_project: projectId, p_artifact: K4_SOURCE, p_revision: 4 }))
 assert.equal(after.current_revision, 4)
 for (const key of ['recipe', 'joints', 'materials', 'parameters', 'open_questions']) assert.deepEqual(after[key], original[key])
 // Exactly one product, cited and not invented beyond the source.
 const articles = await rows('supplier_articles')
 assert.equal(articles.length, 1)
 const product = checked(await client.rpc('read_supplier_article', { p_project: projectId, p_article: articles[0].id, p_revision: null }))
 report.product = product
 assert.equal(product.source_url?.startsWith('https://www.byggmax.se/traskruv-5-0x80-mm-c4-'), true)
 assert.match(product.supplier, /byggmax/i)
 assert.equal(product.content_unit, 'pcs')
 // Only the 15-piece variant shows an article number, so any other choice invented one.
 assert.equal(product.article_number, '249687'); assert.equal(Number(product.content_per_purchase_unit), 15)
 assert(product.supported_fields.includes('content_per_purchase_unit') && product.supported_fields.includes('purchase_unit'))
 assert.equal(product.withdrawn, false)
 // Exactly one published pack purchase over the new, estimated screw need.
 const heads = await rows('pack_purchases')
 assert.equal(heads.length, 1); assert.equal(heads[0].article_id, articles[0].id)
 const purchase = checked(await client.rpc('read_pack_purchase', { p_project: projectId, p_article: heads[0].article_id, p_revision: null }))
 report.purchase = purchase
 assert.equal(purchase.published, true); assert.equal(purchase.source_state, 'current'); assert.equal(purchase.shopping_ready, true)
 assert.equal(purchase.physical_verified, false); assert.equal(purchase.suitability_verified, false)
 assert(purchase.needs.length >= 1)
 const added = requirements.filter((r: any) => !beforeIds.has(r.id))
 assert(added.length >= 1)
 for (const need of purchase.needs) {
  const r = added.find((x: any) => x.id === need.requirement_id)
  assert(r, 'Pack needs must be the new screw need, not a construction blank')
  assert.equal(r.revision, need.requirement_revision); assert.equal(r.unit, 'pcs'); assert.equal(r.archived, false)
  assert.equal(Number(r.stock_quantity), 0); assert.equal(Number(r.component_quantity), 0)
  assert(Number(r.required_quantity) > 0)
 }
 report.screwNeeds = added.map((r: any) => ({ id: r.id, name: r.name, required_quantity: r.required_quantity, required_with_waste: r.required_with_waste, basis: r.basis, assumptions: r.assumptions }))
 // Re-derive AC-14: aggregate exact needs, then round once to whole packs.
 const total = purchase.needs.reduce((sum: number, n: any) => sum + Number(added.find((r: any) => r.id === n.requirement_id).required_with_waste), 0)
 const count = Math.ceil(total / 15)
 assert.equal(Number(purchase.total_quantity), total)
 assert.equal(purchase.purchase_count, count)
 assert.equal(Number(purchase.surplus_quantity), count * 15 - total)
 const shopping = await rows('materials')
 assert.equal(shopping.length, 1); assert.equal(shopping[0].id, purchase.material_id); assert.equal(shopping[0].status, 'needed')
 assert.equal(shopping[0].qty, `${count} ${product.purchase_unit}`)
 const writes = answer.evidence?.writes ?? []
 assert(writes.some((w: any) => w.dataset === 'materials' && w.recordId === purchase.article_id && w.revision === purchase.revision), 'Answer evidence must cite the saved pack purchase')
 // Ordinary HTTP readback twice with the same session; no model request.
 report.readbackMs = []
 for (let i = 0; i < 2; i++) { const start = Date.now(); assert.deepEqual(checked(await client.rpc('read_pack_purchase', { p_project: projectId, p_article: purchase.article_id, p_revision: null })), purchase); report.readbackMs.push(Date.now() - start) }
 report.purchaseCount = count; report.totalQuantity = total; report.surplus = count * 15 - total
 report.recordPreservationPassed = true; report.passed = true
} catch {
 // Provider/assertion bodies may contain private data. The durable turn above
 // identifies the same job for diagnosis even after an uncertain HTTP response.
 report.passed = false; report.error = 'Pack verification stopped; inspect this same turn and caller readback before any retry'; process.exitCode = 1
} finally {
 report.finishedAt = new Date().toISOString(); await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({ projectId, turn: report.turn, jobId: report.jobId, status: report.jobStatus, passed: report.passed, purchaseCount: report.purchaseCount, modelSemanticsReviewRequired: true }))
}
