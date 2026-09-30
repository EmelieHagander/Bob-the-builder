// P4 partial acceptance: real read-only model calls plus ordinary caller media
// and name-only participant HTTP. This does not prove Bob writes, private member
// history, mobile rendering, construction safety or a complete UC. No Auth users
// or privileges are created. Remove only the reported disposable projects after
// inspecting them. Reports contain synthetic sources, never credentials.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const URL = 'https://yuobtgoidmmmwfqenkau.supabase.co'
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIHWP8z8Dwn4GBgYGJAQoAHgQCAfAmK1IAAAAASUVORK5CYII=', 'base64')
export function p4Config(env) {
  assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/, ''), URL)
  assert.equal(env.BOB_P4_LIVE_CONFIRM, 'disposable-fixtures-only', 'Explicit disposable-fixture scope required')
  const key = env.VITE_SUPABASE_ANON_KEY?.trim()
  let role; try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role } catch { /* publishable key */ }
  assert(key && (key.startsWith('sb_publishable_') || role === 'anon'), 'Publishable key required')
  const group = env.BOB_P4_GROUP ?? 'all'
  assert(['all', 'model', 'media'].includes(group), 'Unknown P4 group')
  const cases = (env.BOB_P4_CASES ?? 'shelf,bunk,porch,renovation').split(',')
  assert(cases.length > 0 && new Set(cases).size === cases.length && cases.every(id => ['shelf', 'bunk', 'porch', 'renovation'].includes(id)), 'Unknown/duplicate P4 case')
  return { url: URL, key, group, cases, report: env.BOB_P4_REPORT ?? 'test-results/live-p4.json' }
}

export function modelChecks(answer, projectId, requiredSources) {
  const sources = answer?.evidence?.sources ?? []
  return {
    backend: answer?.backend === 'openai',
    project: answer?.projectId === projectId,
    answer: typeof answer?.summary === 'string' && answer.summary.trim().length > 0,
    noWrites: !(answer?.evidence?.writes?.length),
    scopedSources: sources.length > 0 && sources.every(s => s.projectId === projectId),
    exactSources: requiredSources.length > 0 && requiredSources.every(id => sources.some(s => s.recordId === id)),
  }
}

const scenarios = [
  { id: 'shelf', name: 'Fristående hylla', brief: 'Fristående dekorativ hylla. Inga rumsmått eller vägginfästningar behövs för detta koncept. Inget är byggsäkerhetsgranskat.',
    measurements: [['Arbetsbredd', '60', 'cm'], ['Arbetsdjup', '25', 'cm'], ['Skivtjocklek', '18', 'mm']],
    question: 'Återge sparade arbetsmått i deras originalenheter och konvertera bredden till mm. Skilj dessa syntetiska arbetsmått från fysisk kontroll. Beskriv nästa möjliga konstruktionssteg.',
    correction: ['71', 'cm'], expected: /600/, corrected: /710/ },
  { id: 'bunk', name: 'Våningssäng med lådor', brief: 'Koncept för fristående våningssäng med två lådor. Madrassmåttet är valt konstruktionsmått. Lådornas fria rörelse och platsens höjd är okända. Befintlig vägg får inte antas vara primär bärning.',
    measurements: [['Vald madrassbredd', '900', 'mm'], ['Fri lådrörelse', null, 'mm'], ['Tillgänglig höjd', null, 'mm']],
    question: 'Samla de två saknade platsuppgifterna i en mätrunda och bevara det redan kända arbetsmåttet. Skilj konceptarbete från tillverkning och kvarstående säkerhetskontroller.',
    complement: ['650', 'mm'], complementIndex: 1, expected: /900/, corrected: /650/ },
  { id: 'porch', name: 'Veranda', brief: 'Veranda med tak, valt konceptmått 3000 × 4000 mm. Grund, mark, laster och befintlig infästning är ännu inte verifierade. En conceptskiss är inte tillverkningsunderlag.',
    measurements: [['Vald konceptbredd', '3000', 'mm'], ['Valt konceptdjup', '4000', 'mm'], ['Grunddjup', null, 'mm']],
    question: 'Skilj användbara konceptmått från saknad grund-/last-/infästningskontroll. Beskriv nästa möjliga arbete och vad som hindrar tillverkningsunderlag. Anta inte att något redan är byggt.', expected: /3000|3\s*m/ },
  { id: 'renovation', name: 'Flerrumsrenovering', brief: 'Renovering av flera rum över tre byggdagar. En avbokning och en materialförsening har rapporterats. Färdigt arbete ska bevaras. Inga verkliga deltagares tillgänglighet finns i detta syntetiska projekt.',
    measurements: [['Arbetsbredd i rum A', '240', 'cm'], ['Arbetsbredd i rum B', null, 'cm']],
    question: 'Läs uppgifternas verkliga status. Beskriv berört fortsatt arbete vid materialförseningen och avbokningen utan att återöppna utfört arbete eller hitta på deltagare. Det saknade måttet ska stå kvar som okänt.', expected: /240|2400/ },
]

export async function runP4(env = process.env) {
  const config = p4Config(env)
  const transport = async (input, init = {}) => {
    // One client request is bounded; no automatic paid-turn retry.
    const timeout = AbortSignal.timeout(String(input).includes('/functions/v1/ask-bob') ? 240000 : 30000)
    return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
  }
  const clientFor = headers => createClient(config.url, config.key, { db: { schema: 'bob' },
    global: { fetch: transport, ...(headers ? { headers } : {}) }, auth: { persistSession: false, autoRefreshToken: false } })
  const owner = clientFor(), anonymous = clientFor()
  const report = { scope: 'P4 partial: real read-only guest model; manual media; name-only participant HTTP',
    startedAt: new Date().toISOString(), fixtureProjects: [], results: [],
    notProven: ['Bob-driven save/link', 'named-member history/idempotency', 'mobile rendering', 'complete UC-001–005', 'construction safety'] }
  const persist = async () => { await mkdir(dirname(config.report), { recursive: true }); await writeFile(config.report, JSON.stringify(report, null, 2) + '\n') }
  const create = async name => {
    const project = checked(await owner.rpc('create_project', { p_input: {
      name: `Bob P4 verification ${name} ${randomUUID()}`, type: 'Verification',
      description: 'Disposable synthetic P4 acceptance fixture. Contains no real project data.',
    } }))
    report.fixtureProjects.push({ id: project.id, name: project.name }); await persist()
    console.log(`BOB_P4_PROJECT_ID=${project.id}`)
    return project.id
  }
  let signedIn = false
  try {
    const auth = checked(await owner.auth.signInWithPassword({ email: 'guest@bob.local', password: 'bob-guest-2026' }))
    assert(auth.session); signedIn = true
    // A fresh caller client represents readback without private chat history.
    const fresh = () => clientFor({ Authorization: `Bearer ${auth.session.access_token}` })
    if (config.group !== 'media') for (const scenario of scenarios.filter(s => config.cases.includes(s.id))) {
      const projectId = await create(scenario.id), taskId = `t_${randomUUID()}`
      checked(await owner.from('projects').update({ description: scenario.brief }).eq('id', projectId))
      checked(await owner.from('tasks').insert({ id: taskId, project_id: projectId, area_id: null, name: scenario.name,
        instructions: 'Syntetiskt underlag. Inget verkligt arbete verifierat.', status: scenario.id === 'renovation' ? 'done' : 'todo' }))
      const ids = []
      const evidence = (action, id, revision, subject, value, unit) => owner.rpc('evidence_command', {
        p_project: projectId, p_kind: 'measurement', p_action: action, p_record: id, p_expected: revision,
        p_data: { subject, value, unit, truth: value === null ? 'unknown' : 'estimated',
          source: value === null ? '' : 'Synthetic P4 working value; not field measurement', required: true, ...(action === 'create' ? { area_id: null } : {}),
          source_media_id: null, ...(action === 'revise' ? { change_note: 'Synthetic P4 correction/complement' } : {}) },
      })
      for (const [subject, value, unit] of scenario.measurements) {
        const id = randomUUID(); ids.push(id); checked(await evidence('create', id, 0, subject, value, unit))
      }
      const send = async (phase, message, expected) => {
        const turnId = randomUUID(), started = Date.now()
        const entry = { case: scenario.id, phase, projectId, turnId, sourceIds: ids, status: 'started', checks: {} }
        report.results.push(entry); await persist()
        try {
          const answer = checked(await fresh().functions.invoke('ask-bob', { body: { action: 'send', projectId,
            clientTurnId: turnId, screen: { surface: 'task', taskId },
            message: `Detta är ett syntetiskt acceptansprov. Läs aktuella projektmått och uppgiften med projektverktygen. Ändra inga poster och generera inga bilder eller ritningar i detta läsprov. Svara kort på svenska. ${message}` } }))
          entry.elapsedMs = Date.now() - started; entry.summary = answer.summary; entry.evidence = answer.evidence
          entry.checks = { ...modelChecks(answer, projectId, [...ids, taskId]), expectedValue: expected.test(answer.summary),
            focus: answer.evidence?.currentView?.focus?.task?.id === taskId }
          entry.status = Object.values(entry.checks).every(Boolean) ? 'passed_mechanical_checks' : 'failed'
          // A source receipt alone cannot judge a construction answer.
          entry.semanticReview = 'pending'
          await persist()
          console.log(JSON.stringify({ case: scenario.id, phase, turnId, status: entry.status, elapsedMs: entry.elapsedMs, checks: entry.checks }))
        } catch (error) {
          entry.status = 'failed'; entry.error = error.message; entry.elapsedMs = Date.now() - started; await persist()
          console.error(`P4 ${scenario.id}/${phase} failed: ${error.message}`)
        }
      }
      await send('initial', scenario.question, scenario.expected)
      if (scenario.correction || scenario.complement) {
        const index = scenario.complementIndex ?? 0, [value, unit] = scenario.correction ?? scenario.complement
        checked(await evidence('revise', ids[index], 1, scenario.measurements[index][0], value, unit))
        await send('fresh_read_after_change', scenario.correction
          ? 'Det sparade breddmåttet har rättats via den vanliga datavägen. Hämta den aktuella revisionen, återge originalenheten och omräkningen till mm; använd inte den ersatta bredden som arbetsmått.'
          : 'En av de saknade uppgifterna har kompletterats via den vanliga datavägen. Hämta aktuella revisioner och redovisa vad som nu är känt och vad som fortfarande behöver mätas. Fråga inte efter det som redan står sparat.', scenario.corrected)
      }
      assert.deepEqual(checked(await owner.from('bob_threads').select('id').eq('project_id', projectId)), [], 'Guest must remain local-only')
    }
    if (config.group !== 'model') {
      const projectId = await create('media'), assets = []
      const entry = { case: 'manual_shared_media', projectId, status: 'started', checks: {} }
      report.results.push(entry); await persist()
      const media = (action, id, data = {}) => owner.rpc('media_command', { p_project: projectId, p_action: action, p_media: id, p_data: data })
      try {
        const taskId = `t_${randomUUID()}`
        checked(await owner.from('tasks').insert({ id: taskId, project_id: projectId, area_id: null, name: 'P4 manual instructions' }))
        for (const title of ['Första instruktionen', 'Andra instruktionen']) checked(await owner.rpc('task_steps_command', {
          p_project: projectId, p_task: taskId, p_action: 'create', p_step: null,
          p_data: { title, instructions: 'Synthetic P4 instruction', is_checkpoint: false, required: false },
        }))
        const steps = checked(await owner.from('task_steps').select('id,title').eq('task_id', taskId).order('position'))
        assert.equal(steps.length, 2)
        const upload = async title => {
          const id = randomUUID()
          const asset = checked(await media('reserve', id, { title, original_name: 'p4.png', purpose: 'instruction',
            content_type: 'image/png', byte_size: png.length, width: 2, height: 2, target_kind: 'step', target_id: steps[0].id }))
          assets.push({ ...asset, id }); await persist()
          if (assets.length === 1) assert((await media('finalize', id)).error, 'Absent bytes must not finalise')
          checked(await owner.storage.from(asset.bucket_id).upload(asset.object_path, png, { contentType: 'image/png', upsert: false }))
          assert.equal(checked(await media('finalize', id)).state, 'ready')
          assert.equal(checked(await media('finalize', id)).state, 'ready')
          return id
        }
        const original = await upload('P4 shared original')
        checked(await media('link', original, { target_kind: 'step', target_id: steps[1].id }))
        checked(await media('link', original, { target_kind: 'step', target_id: steps[1].id }))
        let links = checked(await fresh().from('media_links').select('id,step_id').eq('media_id', original))
        assert.equal(links.length, 2, 'Reuse/retry must not duplicate link or original')
        const replacement = await upload('P4 replacement in first instruction')
        checked(await media('unlink', original, { link_id: links.find(l => l.step_id === steps[0].id).id }))
        links = checked(await fresh().from('media_links').select('id,step_id').eq('media_id', original))
        assert.deepEqual(links.map(l => l.step_id), [steps[1].id], 'Changing one instruction must preserve the other')
        assert.equal(checked(await fresh().from('media_assets').select('id').eq('project_id', projectId)).length, 2)
        const invite = randomBytes(32).toString('hex'), session = randomBytes(32).toString('hex')
        const link = checked(await owner.rpc('create_volunteer_link', { p_project: projectId, p_label: 'Disposable P4 participant', p_secret: invite, p_days: 1 }))
        checked(await anonymous.rpc('volunteer_join', { p_invite: invite, p_session: session, p_name: 'Synthetic P4 participant', p_allergies: null }))
        const detail = checked(await anonymous.rpc('volunteer_task', { p_secret: session, p_task: taskId }))
        const first = detail.steps.find(s => s.id === steps[0].id), second = detail.steps.find(s => s.id === steps[1].id)
        assert(Array.isArray(first?.images) && Array.isArray(second?.images), 'Participant detail must preserve image links to each instruction')
        assert(first.images.some(i => i.id === replacement) && !first.images.some(i => i.id === original))
        assert(second.images.some(i => i.id === original) && !second.images.some(i => i.id === replacement))
        const bytes = id => transport(config.url + '/functions/v1/volunteer-media', { method: 'POST',
          headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ session, taskId, mediaId: id }) })
        for (const id of [original, replacement]) {
          const response = await bytes(id); assert.equal(response.status, 200)
          assert.match(response.headers.get('cache-control') ?? '', /no-store/)
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
        }
        const managed = checked(await owner.rpc('volunteer_links_state', { p_project: projectId }))
        checked(await owner.rpc('revoke_volunteer_access', { p_project: projectId, p_link: null, p_session: managed.participants[0].id }))
        assert((await anonymous.rpc('volunteer_task', { p_secret: session, p_task: taskId })).error)
        assert.equal((await bytes(original)).status, 403)
        checked(await owner.rpc('revoke_volunteer_access', { p_project: projectId, p_link: link.id, p_session: null }))
        entry.checks = { missingBytesRejected: true, idempotentFinalize: true, sharedOriginal: true, linkRetry: true,
          independentReplacement: true, freshCallerReadback: true, participantInstructions: true, exactHttpBytes: true, revokedDenied: true }
        entry.status = 'passed'; await persist()
        console.log('P4 manual two-instruction reuse/replacement, fresh readback, participant HTTP bytes and revocation passed.')
      } catch (error) { entry.status = 'failed'; entry.error = error.message; await persist(); throw error }
      finally {
        for (const asset of assets) {
          checked(await media('begin_delete', asset.id))
          checked(await owner.storage.from(asset.bucket_id).remove([asset.object_path]))
          checked(await media('finish_delete', asset.id))
        }
        entry.mediaCleaned = true; await persist()
      }
    }
    assert(report.results.every(r => r.status === 'passed' || r.status === 'passed_mechanical_checks'), 'P4 checks failed; inspect report')
  } finally {
    report.finishedAt = new Date().toISOString(); await persist()
    if (signedIn) await owner.auth.signOut({ scope: 'local' })
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runP4().catch(error => {
  console.error(`P4 verification failed: ${error.message}`); process.exitCode = 1
})
