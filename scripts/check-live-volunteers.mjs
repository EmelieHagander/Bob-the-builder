// Hosted name-only volunteer proof inside the ordinary disposable foundation project.
// Uses real Auth for the organiser, anonymous PostgREST capability RPCs for the
// volunteer, and the deployed volunteer-media Edge function. No AI calls.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
const secret = () => randomBytes(32).toString('hex')

export async function verifyVolunteerAccess(client, anonymous, url, publishableKey, projectId, areaId, existingTaskId, imageId, expectedImageBytes) {
  const inviteSecret = secret()
  const sessionSecret = secret()
  const rejectedSession = secret()
  const link = checked(await client.rpc('create_volunteer_link', {
    p_project: projectId,
    p_label: 'Disposable hosted volunteer verification',
    p_secret: inviteSecret,
    p_days: 1,
  }))
  assert.equal(link.projectId, projectId)

  let managed = checked(await client.rpc('volunteer_links_state', { p_project: projectId }))
  assert(managed.links.some(item => item.id === link.id && item.revokedAt === null))

  let preview = checked(await anonymous.rpc('volunteer_preview', { p_secret: inviteSecret }))
  assert.equal(preview.projectId, projectId)
  assert.equal(preview.hasFood, false)
  assert((await anonymous.rpc('volunteer_join', {
    p_invite: inviteSecret,
    p_session: rejectedSession,
    p_name: 'Disposable rejected volunteer',
    p_allergies: 'Must be rejected without project food',
  })).error, 'Allergies must not be collected before this project has food planned')

  let state = checked(await anonymous.rpc('volunteer_join', {
    p_invite: inviteSecret,
    p_session: sessionSecret,
    p_name: 'Disposable hosted volunteer',
    p_allergies: null,
  }))
  assert.equal(state.projectId, projectId)
  assert.equal(state.hasFood, false)
  assert.equal(state.person.allergies, null)
  const personId = state.person.id

  let person = checked(await client.from('people').select('id,auth_user_id,access_origin,diet').eq('project_id', projectId).eq('id', personId).single())
  assert.equal(person.auth_user_id, null, 'Name-only participation must not create or attach an Auth identity')
  assert.equal(person.access_origin, 'derived')
  assert.equal(person.diet, '')

  const volunteerTaskId = 't_volunteer_' + randomUUID()
  checked(await client.from('tasks').insert({ id: volunteerTaskId, area_id: areaId, name: 'Disposable volunteer task' }))
  const taskBefore = checked(await client.from('tasks').select('updated_at').eq('id', volunteerTaskId).single())
  checked(await client.rpc('task_steps_command', {
    p_project: projectId, p_task: volunteerTaskId, p_action: 'instructions', p_step: null,
    p_data: { instructions: 'Disposable volunteer instructions.', expected_updated_at: taskBefore.updated_at },
  }))
  checked(await client.rpc('task_steps_command', {
    p_project: projectId, p_task: volunteerTaskId, p_action: 'create', p_step: null,
    p_data: { title: 'Disposable volunteer check', instructions: 'Hosted proof only.', is_checkpoint: true, required: true },
  }))
  const checkpoint = checked(await client.from('task_steps').select('*').eq('project_id', projectId).eq('task_id', volunteerTaskId).single())

  const tasks = checked(await anonymous.rpc('volunteer_feed', {
    p_secret: sessionSecret, p_section: 'tasks', p_after: null, p_limit: 30,
  }))
  assert.equal(tasks.projectId, projectId)
  assert(tasks.items.some(item => item.id === volunteerTaskId && item.mine === false))

  let task = checked(await anonymous.rpc('volunteer_task', { p_secret: sessionSecret, p_task: volunteerTaskId }))
  assert.equal(task.mine, false)
  task = checked(await anonymous.rpc('volunteer_task_action', {
    p_secret: sessionSecret, p_task: volunteerTaskId, p_action: 'claim', p_data: {},
  }))
  assert.equal(task.mine, true)
  task = checked(await anonymous.rpc('volunteer_task_action', {
    p_secret: sessionSecret, p_task: volunteerTaskId, p_action: 'check',
    p_data: { stepId: checkpoint.id, revision: checkpoint.revision, completed: true },
  }))
  const savedCheckpoint = checked(await client.from('task_steps').select('completed_by,completed_by_volunteer,completed_at,revision')
    .eq('project_id', projectId).eq('id', checkpoint.id).single())
  assert(savedCheckpoint.completed_at)
  assert.equal(savedCheckpoint.completed_by, null)
  assert.equal(savedCheckpoint.completed_by_volunteer, personId)
  task = checked(await anonymous.rpc('volunteer_task_action', {
    p_secret: sessionSecret, p_task: volunteerTaskId, p_action: 'status',
    p_data: { status: 'done', expectedUpdatedAt: task.updatedAt },
  }))
  assert.equal(task.status, 'done')

  const imageTask = checked(await anonymous.rpc('volunteer_task', { p_secret: sessionSecret, p_task: existingTaskId }))
  assert(imageTask.images.some(item => item.id === imageId), 'Volunteer task detail must expose only linked project image metadata')
  const mediaResponse = await fetch(url + '/functions/v1/volunteer-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey },
    body: JSON.stringify({ session: sessionSecret, taskId: existingTaskId, mediaId: imageId }),
  })
  assert.equal(mediaResponse.status, 200)
  assert.match(mediaResponse.headers.get('content-type') ?? '', /^image\/png/)
  assert.match(mediaResponse.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), expectedImageBytes, 'Volunteer media proxy must return the exact authorised original bytes')

  const eventId = 'e_volunteer_' + randomUUID()
  checked(await client.from('events').insert({
    id: eventId, project_id: projectId, slug: eventId, title: 'Disposable volunteer build day',
    food: 'Disposable hosted food fixture',
  }))
  state = checked(await anonymous.rpc('volunteer_state', { p_secret: sessionSecret }))
  assert.equal(state.hasFood, true)
  state = checked(await anonymous.rpc('volunteer_profile', {
    p_secret: sessionSecret,
    p_name: 'Disposable hosted volunteer',
    p_allergies: 'Disposable allergy fixture',
    p_expected: state.person.updatedAt,
  }))
  assert.equal(state.person.allergies, 'Disposable allergy fixture')
  person = checked(await client.from('people').select('diet,auth_user_id').eq('project_id', projectId).eq('id', personId).single())
  assert.equal(person.diet, 'Disposable allergy fixture')
  assert.equal(person.auth_user_id, null)

  const events = checked(await anonymous.rpc('volunteer_feed', {
    p_secret: sessionSecret, p_section: 'events', p_after: null, p_limit: 30,
  }))
  assert(events.items.some(item => item.id === eventId && item.food === 'Disposable hosted food fixture'))
  checked(await anonymous.rpc('volunteer_rsvp', { p_secret: sessionSecret, p_event: eventId, p_going: true }))
  assert.equal(checked(await client.from('event_attendees').select('person_id').eq('event_id', eventId).eq('person_id', personId)).length, 1)

  checked(await client.from('events').delete().eq('project_id', projectId).eq('id', eventId))
  state = checked(await anonymous.rpc('volunteer_state', { p_secret: sessionSecret }))
  assert.equal(state.hasFood, false)
  assert.equal(state.person.allergies, null, 'Stored allergy text must not be disclosed after project food is removed')
  assert((await anonymous.rpc('volunteer_profile', {
    p_secret: sessionSecret,
    p_name: 'Disposable hosted volunteer',
    p_allergies: 'Must not be accepted without food',
    p_expected: state.person.updatedAt,
  })).error, 'Volunteer profile must reject new allergy text when project food is no longer planned')

  managed = checked(await client.rpc('volunteer_links_state', { p_project: projectId }))
  const participant = managed.participants.find(item => item.personId === personId)
  assert(participant, 'Organiser must see the project-local volunteer participant without seeing a credential')
  checked(await client.rpc('revoke_volunteer_access', { p_project: projectId, p_link: null, p_session: participant.id }))
  assert((await anonymous.rpc('volunteer_state', { p_secret: sessionSecret })).error, 'Revoked volunteer session must fail on the next RPC')

  const revokedMedia = await fetch(url + '/functions/v1/volunteer-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey },
    body: JSON.stringify({ session: sessionSecret, taskId: existingTaskId, mediaId: imageId }),
  })
  assert.equal(revokedMedia.status, 403, 'Revoked volunteer session must lose private media immediately')
  checked(await client.rpc('revoke_volunteer_access', { p_project: projectId, p_link: link.id, p_session: null }))
  assert((await anonymous.rpc('volunteer_preview', { p_secret: inviteSecret })).error, 'Revoked invitation must stop future joins/previews')

  console.log('Live name-only volunteer: no Auth identity, no-food allergy rejection, own task/check provenance, food-gated allergy/RSPV, exact private Edge media, and immediate session/link revocation passed. No AI invoked.')
  return { personId, linkId: link.id }
}
