// Narrow release proof through real Auth, PostgREST and Storage. No AI calls.
// All files/metadata are cleaned up here. The operator removes the printed
// disposable project afterwards; project deletion is not a client capability.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const configured = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const url = /^[a-z0-9]{16,}$/.test(configured) ? 'https://' + configured + '.supabase.co' : configured.replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY?.trim()
assert.equal(url, 'https://yuobtgoidmmmwfqenkau.supabase.co', 'Use the explicitly configured Bob deployment')
assert(key, 'Publishable Supabase configuration is required')
const options = { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } }
const client = createClient(url, key, options)
const anonymous = createClient(url, key, options)
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwDLT/DwADeQHRghinsQAAAABJRU5ErkJggg==', 'base64')
let signedIn = false, project
const media = (action, id, data = {}) => client.rpc('media_command', { p_project: project.id, p_action: action, p_media: id, p_data: data })
try {
  assert(checked(await client.auth.signInWithPassword({ email: 'guest@bob.local', password: 'bob-guest-2026' })).session)
  signedIn = true
  const nonce = randomUUID()
  console.log('BOB_FOUNDATION_FIXTURE_RUN=' + nonce)
  project = checked(await client.rpc('create_project', { p_input: {
    name: 'Bob foundations verification ' + nonce,
    description: 'Disposable media/task foundation verification. No real project data.', type: 'Verification',
  } }))
  console.log('BOB_FOUNDATION_PROJECT_ID=' + project.id)
  const areaId = 'a_verify_' + randomUUID(), taskId = 't_verify_' + randomUUID()
  checked(await client.from('areas').insert({ id: areaId, project_id: project.id, slug: areaId, name: 'Verification area' }))
  checked(await client.from('tasks').insert({ id: taskId, area_id: areaId, name: 'Verify saved steps' }))
  const stepCommand = (action, step = null, data = {}) => client.rpc('task_steps_command', { p_project: project.id, p_task: taskId, p_action: action, p_step: step, p_data: data })
  const before = checked(await client.from('tasks').select('updated_at').eq('id', taskId).single())
  checked(await stepCommand('instructions', null, { instructions: 'Manually supplied verification instructions.', expected_updated_at: before.updated_at }))
  checked(await stepCommand('create', null, { title: 'Prepare fixture', instructions: 'Temporary test only.' }))
  checked(await stepCommand('create', null, { title: 'Check fixture', is_checkpoint: true, required: true }))
  let steps = checked(await client.from('task_steps').select('*').eq('project_id', project.id).eq('task_id', taskId).order('position'))
  assert.equal(steps.length, 2)
  const ordinary = steps[0], required = steps[1]
  checked(await stepCommand('move', required.id, { revision: required.revision, direction: 'up' }))
  assert((await stepCommand('edit', ordinary.id, { revision: ordinary.revision, title: 'Stale edit' })).error, 'A stale edit must be denied')
  assert((await client.from('tasks').update({ status: 'done' }).eq('id', taskId)).error, 'Required checks must block task completion')
  steps = checked(await client.from('task_steps').select('*').eq('project_id', project.id).eq('task_id', taskId).order('position'))
  assert.equal(steps[0].id, required.id)
  checked(await stepCommand('complete', required.id, { revision: steps[0].revision, completed: true }))
  checked(await client.from('tasks').update({ status: 'done' }).eq('id', taskId))
  const imageId = randomUUID()
  const image = checked(await media('reserve', imageId, {
    original_name: 'foundation-fixture.png', title: 'Disposable foundation image', purpose: 'instruction',
    content_type: 'image/png', byte_size: png.length, width: 1, height: 1,
    target_kind: 'step', target_id: ordinary.id,
  }))
  assert.equal(image.created_by, (await client.auth.getUser()).data.user.id, 'Uploader identity comes from the server')
  assert((await media('finalize', imageId)).error, 'No object means no completed upload')
  checked(await client.storage.from(image.bucket_id).upload(image.object_path, png, { contentType: 'image/png', upsert: false, cacheControl: '0' }))
  assert.equal(checked(await media('finalize', imageId)).state, 'ready')
  assert.equal(checked(await media('finalize', imageId)).state, 'ready', 'Finalisation is retryable')
  const downloaded = checked(await client.storage.from(image.bucket_id).download(image.object_path))
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png, 'The stored original must be returned byte for byte')
  assert((await anonymous.storage.from(image.bucket_id).download(image.object_path)).error, 'Unsigned member-free download is denied')
  assert(!(await fetch(url + '/storage/v1/object/public/' + image.bucket_id + '/' + image.object_path)).ok, 'Private images have no public download path')
  assert((await client.storage.from(image.bucket_id).upload(image.object_path, png, { contentType: 'image/png', upsert: true })).error, 'Original cannot be overwritten')
  assert((await client.storage.from(image.bucket_id).upload(image.object_path + '-unreserved', png, { contentType: 'image/png' })).error, 'Unreserved path is denied')
  assert((await client.from('media_assets').update({ state: 'deleting' }).eq('id', imageId)).error, 'Lifecycle cannot be changed through raw table writes')
  checked(await media('link', imageId, { target_kind: 'task', target_id: taskId }))
  // Match the actual database.ts embedded relation/filter, including the read-back.
  const attached = checked(await client.from('media_assets')
    .select('*,media_links(id,area_id,task_id,step_id),target:media_links!inner(area_id,task_id,step_id)')
    .eq('project_id', project.id).eq('target.step_id', ordinary.id))
  assert.equal(attached.length, 1)
  assert.equal(attached[0].media_links.length, 2)
  assert.equal(attached[0].object_path, image.object_path)
  const savedTask = checked(await client.from('tasks').select('instructions,status').eq('id', taskId).single())
  assert.equal(savedTask.instructions, 'Manually supplied verification instructions.')
  assert.equal(savedTask.status, 'done')
  assert.deepEqual(checked(await client.from('media_assets').select('id').eq('project_id', 'p_bygga_in_entren')), [])
  assert((await client.rpc('media_command', { p_project: 'p_bygga_in_entren', p_action: 'reserve', p_media: randomUUID(), p_data: {} })).error, 'Real project access stays denied')
  checked(await stepCommand('delete', ordinary.id, { revision: steps[1].revision }))
  const remaining = checked(await client.from('media_assets').select('id,media_links(id,step_id,task_id)').eq('id', imageId).single())
  assert.equal(remaining.media_links.length, 1, 'Deleting a step removes its link but keeps the original')
  assert.equal(remaining.media_links[0].task_id, taskId)
  checked(await media('begin_delete', imageId))
  assert((await media('finish_delete', imageId)).error, 'Existing bytes prevent premature metadata removal')
  console.log('Live foundation Auth/PostgREST/Storage: original bytes, private access, attachments, steps, stale edits and required checks passed. No AI invoked.')
} catch (error) {
  // No sessions, tokens, request objects or personal project records in logs.
  console.error('Live foundation verification failed: ' + error.message)
  process.exitCode = 1
} finally {
  if (project?.id && signedIn) {
    try {
      const images = checked(await client.from('media_assets').select('id,bucket_id,object_path').eq('project_id', project.id))
      for (const image of images) {
        checked(await media('begin_delete', image.id))
        checked(await client.storage.from(image.bucket_id).remove([image.object_path]))
        checked(await media('finish_delete', image.id))
      }
      assert.deepEqual(checked(await client.from('media_assets').select('id').eq('project_id', project.id)), [])
      console.log('All disposable image bytes, metadata and attachments removed through the normal API.')
    } catch (error) {
      console.error('Foundation fixture cleanup needs operator attention: ' + error.message)
      process.exitCode = 1
    }
  }
  if (signedIn) await client.auth.signOut({ scope: 'local' })
}
