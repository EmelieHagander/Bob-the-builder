// Live release proof with the existing public guest account. Never grant this
// account access to a real project. The operator removes the printed fixture
// project afterwards; project deletion is deliberately not a client capability.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

const configured = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const url = /^[a-z0-9]{16,}$/.test(configured) ? `https://${configured}.supabase.co` : configured.replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY?.trim()
assert.equal(url, 'https://yuobtgoidmmmwfqenkau.supabase.co', 'Use the explicitly configured Bob deployment')
assert(key, 'Publishable Supabase configuration is required')
const client = createClient(url, key, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } })
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
let signedIn = false
let fixtureProject, fixtureImage
// Deliberately neutral metadata: the color can only come from actual pixels.
function colorFixture() {
  const crc = bytes => {
    let value = 0xffffffff
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type, bytes) => {
    const data = Buffer.concat([Buffer.from(type), bytes]), size = Buffer.alloc(4), checksum = Buffer.alloc(4)
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(data))
    return Buffer.concat([size, data, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(128, 0); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 2
  const rows = Buffer.alloc(128 * (128 * 3 + 1))
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) rows[y * 385 + 1 + x * 3] = 255
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
try {
  const auth = checked(await client.auth.signInWithPassword({ email: 'guest@bob.local', password: 'bob-guest-2026' }))
  assert(auth.session, 'A real Auth session is required')
  signedIn = true
  // The public guest is a non-member of the actual entrance project.
  assert.deepEqual(checked(await client.from('projects').select('id').eq('id', 'p_bygga_in_entren')), [])
  const denied = await client.functions.invoke('ask-bob', { body: { action: 'send', projectId: 'p_bygga_in_entren', message: 'Permission check' } })
  assert.equal(denied.error?.context?.status, 403, 'Real non-member must be denied by the edge boundary')
  const retired = await client.functions.invoke('ask-launchpad', { body: { action: 'status', taskId: 'retired-fixture' } })
  assert.equal(retired.error?.context?.status, 410, 'The legacy provider endpoint must be retired')
  checked(await client.rpc('claim_project_invites'))

  const nonce = randomUUID()
  const project = checked(await client.rpc('create_project', { p_input: { name: `Bob CI verification ${nonce}`, description: 'Disposable release verification fixture. Contains no real project data.', type: 'Verification' } }))
  assert(project?.id)
  fixtureProject = project.id
  console.log(`BOB_SMOKE_PROJECT_ID=${project.id}`)
  const materialId = `m_${randomUUID()}`
  const name = `Verification bolt ${nonce}`
  checked(await client.from('materials').insert({ id: materialId, project_id: project.id, name, qty: '37 pieces', status: 'needed' }))
  assert.deepEqual(checked(await client.from('materials').select('id').eq('id', materialId)), [{ id: materialId }])
  const answer = checked(await client.functions.invoke('ask-bob', { body: {
    action: 'send', projectId: project.id,
    message: `Slå upp materialet "${name}" med search_project_data. Vilket antal står registrerat? Svara kort och behandla antalet som obekräftad projektinformation.`,
  } }))
  assert.equal(answer.backend, 'openai')
  assert.equal(answer.projectId, project.id)
  assert.equal(answer.evidence?.kind, 'ai_assessment')
  assert(answer.evidence.sources.some(source => source.projectId === project.id && source.recordId === materialId), 'OpenAI must actually consult a material outside the project-only briefing')
  assert(answer.evidence.sources.every(source => source.projectId === project.id), 'Every source stays in the requested project')
  assert.match(answer.summary, /37/)
  console.log('Live Auth → member-scoped PostgREST → OpenAI tool → source disclosure: passed. Non-member: 403. Retired endpoint: 410.')

  const taskId = `t_${randomUUID()}`, taskName = `P3 focus ${nonce}`
  checked(await client.from('tasks').insert({ id: taskId, project_id: project.id, area_id: null, name: taskName,
    instructions: 'Prepare timber for indoor use. Its moisture has not been measured.' }))
  const imageId = randomUUID(), png = colorFixture()
  fixtureImage = checked(await client.rpc('media_command', { p_project: project.id, p_action: 'reserve', p_media: imageId, p_data: {
    original_name: 'p3-fixture.png', title: 'P3 visual fixture', purpose: 'reference', content_type: 'image/png',
    byte_size: png.length, width: 128, height: 128, target_kind: 'task', target_id: taskId,
  } }))
  fixtureImage.id = imageId
  checked(await client.storage.from(fixtureImage.bucket_id).upload(fixtureImage.object_path, png, { contentType: 'image/png', upsert: false }))
  checked(await client.rpc('media_command', { p_project: project.id, p_action: 'finalize', p_media: imageId, p_data: {} }))
  const focus = checked(await client.functions.invoke('ask-bob', { body: {
    action: 'send', projectId: project.id, screen: { surface: 'task', taskId },
    message: 'Vad heter uppgiften jag tittar på? Öppna bildens faktiska pixlar i "P3 visual fixture" med list_project_category och open_project_item och ange dess dominerande färg. Sök sedan search_building_knowledge med query "trä fukt" och jurisdiction "SE" och säg kort vilken kontroll uppgiften behöver. Gör inga projektändringar. Svara på svenska.',
  } }))
  assert.equal(focus.evidence?.currentView?.status, 'ok')
  assert.equal(focus.evidence.currentView.focus.task.id, taskId)
  assert.equal(focus.evidence.currentView.focus.task.name, taskName)
  assert(focus.evidence.sources.some(source => source.dataset === 'image_pixels' && source.recordId === imageId), 'Pixels must reach a successful real model call')
  assert(focus.evidence.references?.some(reference => reference.id === 'timber.moisture' && reference.version === '2026-09-30.1'), 'The model must consume the deployed knowledge package')
  assert.match(focus.summary, /röd|red/i, 'Neutral metadata cannot reveal the fixture color')
  const thread = checked(await client.from('bob_threads').select('id').eq('project_id', project.id).eq('owner_user_id', auth.user.id).eq('status', 'active').single())
  const history = checked(await client.from('bob_messages').select('role,evidence,delivery_state').eq('thread_id', thread.id).order('seq'))
  assert(history.some(row => row.role === 'assistant' && row.delivery_state === 'completed' && row.evidence?.currentView?.focus?.task?.id === taskId), 'The private focused answer is read back through the ordinary caller')
  console.log('P3 live caller focus → real image pixels → versioned knowledge → private answer readback: passed.')
} catch (error) {
  // Never serialize Supabase request objects, sessions, tokens or user records.
  console.error(`Live Bob verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  if (fixtureImage && fixtureProject) {
    try {
      checked(await client.rpc('media_command', { p_project: fixtureProject, p_action: 'begin_delete', p_media: fixtureImage.id, p_data: {} }))
      checked(await client.storage.from(fixtureImage.bucket_id).remove([fixtureImage.object_path]))
      checked(await client.rpc('media_command', { p_project: fixtureProject, p_action: 'finish_delete', p_media: fixtureImage.id, p_data: {} }))
      console.log('P3 fixture image bytes and metadata removed through ordinary caller commands.')
    } catch (error) { console.error(`P3 fixture image cleanup failed: ${error.message}`); process.exitCode = 1 }
  }
  if (signedIn) await client.auth.signOut({ scope: 'local' })
}
